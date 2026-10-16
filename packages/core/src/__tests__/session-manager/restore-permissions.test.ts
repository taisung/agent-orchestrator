import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { deleteMetadata, readMetadataRaw, updateMetadata, writeMetadata } from "../../metadata.js";
import type {
  OrchestratorConfig,
  PluginRegistry,
  Runtime,
  Agent,
  AgentPermissionMode,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let tmpDir: string;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockAgent: Agent;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

beforeEach(() => {
  ctx = setupTestContext();
  ({ tmpDir, sessionsDir, mockRuntime, mockAgent, mockRegistry, config } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

function registryWith(agent: Agent): PluginRegistry {
  return {
    ...mockRegistry,
    get: vi.fn().mockImplementation((slot: string) => {
      if (slot === "runtime") return mockRuntime;
      if (slot === "agent") return agent;
      if (slot === "workspace") return ctx.mockWorkspace;
      return null;
    }),
  } as PluginRegistry;
}

// The per-plugin flag mapping is tested in the plugin packages (M-1); this
// file keeps one style (claude-code, the default agent) to show the core
// behaviour: core passes the role-merged agentConfig as the restore project.
function makePermissionMock(): Agent {
  return {
    ...mockAgent,
    getRestoreCommand: vi.fn().mockImplementation(async (_s, project) => {
      const perms = project.agentConfig?.permissions as string | undefined;
      const model = project.agentConfig?.model as string | undefined;
      const parts: string[] = ["mock-agent", "--resume", "ses-1"];
      if (perms === "permissionless" || perms === "auto-edit") {
        parts.push("--dangerously-skip-permissions");
      }
      if (model) parts.push("--model", model);
      return parts.join(" ");
    }),
  };
}

function configWithPermissions(
  shared?: AgentPermissionMode,
  worker?: AgentPermissionMode,
): OrchestratorConfig {
  return {
    ...config,
    projects: {
      ...config.projects,
      "my-app": {
        ...config.projects["my-app"]!,
        agentConfig: { ...(shared ? { permissions: shared } : {}) },
        worker: { agentConfig: { ...(worker ? { permissions: worker } : {}) } },
      },
    },
  };
}

function writeWorkerSession(wsName: string): void {
  const wsPath = join(tmpDir, wsName);
  mkdirSync(wsPath, { recursive: true });
  writeMetadata(sessionsDir, "app-1", {
    worktree: wsPath,
    branch: "feat/TEST-1",
    status: "killed",
    project: "my-app",
    runtimeHandle: JSON.stringify(makeHandle("rt-old")),
  });
}

function writeOrchestratorSession(wsName: string): void {
  const wsPath = join(tmpDir, wsName);
  mkdirSync(wsPath, { recursive: true });
  writeMetadata(sessionsDir, "app-orchestrator", {
    worktree: wsPath,
    branch: "main",
    status: "killed",
    project: "my-app",
    role: "orchestrator",
    runtimeHandle: JSON.stringify(makeHandle("rt-old")),
  });
}

async function restoreCommand(agent: Agent, sessionId: string): Promise<string> {
  const sm = createSessionManager({ config, registry: registryWith(agent) });
  await sm.restore(sessionId);
  const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
  return createCall.launchCommand as string;
}

describe("restore permissions (N-2)", () => {
  it("case (a): shared permissionless + worker default restores without the flag", async () => {
    config = configWithPermissions("permissionless", "default");
    writeWorkerSession("ws-perm-a-claude");
    const cmd = await restoreCommand(makePermissionMock(), "app-1");
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("case (b): orchestrator with shared default restores with the flag", async () => {
    config = configWithPermissions("default", undefined);
    writeOrchestratorSession("ws-perm-b-claude");
    const cmd = await restoreCommand(makePermissionMock(), "app-orchestrator");
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("shared and role agree (both permissionless) restores with the flag", async () => {
    config = configWithPermissions("permissionless", "permissionless");
    writeWorkerSession("ws-perm-agree-claude");
    const cmd = await restoreCommand(makePermissionMock(), "app-1");
    expect(cmd).toContain("--dangerously-skip-permissions");
  });
});

describe("restore role model (m-1)", () => {
  it("a worker without --model restores on worker.agentConfig.model", async () => {
    const wsPath = join(tmpDir, "ws-role-model");
    mkdirSync(wsPath, { recursive: true });
    const configWithRoleModel: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: { model: "shared-model" },
          worker: { agentConfig: { model: "worker-role-model" } },
        },
      },
    };
    config = configWithRoleModel;
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    const seen: Array<string | undefined> = [];
    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, _p, effectiveModel) => {
        seen.push(effectiveModel);
        return `mock-agent --resume --model ${effectiveModel}`;
      }),
    };
    const sm = createSessionManager({
      config: configWithRoleModel,
      registry: registryWith(agentWithRestore),
    });
    await sm.restore("app-1");
    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "worker-role-model",
    );
    expect(seen).toEqual(["worker-role-model"]);
  });
});

describe("stored spawn identity (owner option 1)", () => {
  function writeStoredSession(wsName: string, stored: Record<string, string>): void {
    const wsPath = join(tmpDir, wsName);
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
      ...stored,
    });
  }

  function configWithModelAndPermissions(
    model?: string,
    shared?: AgentPermissionMode,
  ): OrchestratorConfig {
    return {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: {
            ...(model ? { model } : {}),
            ...(shared ? { permissions: shared } : {}),
          },
        },
      },
    };
  }

  it("spawn stores the effective model and mode; a later config edit does not reach restore", async () => {
    config = configWithModelAndPermissions("model-A", "default");
    const wsPath = join(tmpDir, "ws-spawn-stored");
    mkdirSync(wsPath, { recursive: true });
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path: wsPath,
      branch: "feat/TEST-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app" });

    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(raw?.["model"]).toBe("model-A");
    expect(raw?.["permissions"]).toBe("default");
    updateMetadata(sessionsDir, "app-1", { status: "killed" });
    vi.mocked(mockRuntime.create).mockClear();

    config = configWithModelAndPermissions("model-B", "permissionless");
    const seen: Array<string | undefined> = [];
    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, project, effectiveModel) => {
        seen.push(effectiveModel);
        const perms = project.agentConfig?.permissions as string | undefined;
        return `mock-agent --resume --perms ${perms ?? "none"} --model ${effectiveModel ?? "none"}`;
      }),
    };
    const sm2 = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm2.restore("app-1");

    expect(seen).toEqual(["model-A"]);
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("--perms default");
    expect(createCall.launchCommand).toContain("--model model-A");
    expect(createCall.launchCommand).not.toContain("model-B");
    expect(createCall.launchCommand).not.toContain("permissionless");
  });

  it("a config object with no mode stores default (the YAML loader always sets permissionless)", async () => {
    const wsPath = join(tmpDir, "ws-spawn-no-mode");
    mkdirSync(wsPath, { recursive: true });
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path: wsPath,
      branch: "feat/TEST-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app" });

    expect(readMetadataRaw(sessionsDir, "app-1")?.["permissions"]).toBe("default");
    expect(readMetadataRaw(sessionsDir, "app-1")?.["model"]).toBeUndefined();
    updateMetadata(sessionsDir, "app-1", { status: "killed" });
    vi.mocked(mockRuntime.create).mockClear();

    config = configWithPermissions("permissionless", "permissionless");
    const cmd = await restoreCommand(makePermissionMock(), "app-1");
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("stored permissionless wins when the config is changed to default", async () => {
    writeStoredSession("ws-stored-perm", { permissions: "permissionless" });
    config = configWithPermissions("default", "default");
    const cmd = await restoreCommand(makePermissionMock(), "app-1");
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it.each(["", "bogus", "PERMISSIONLESS", "skip!"])(
    "malformed stored permissions %j resolves to suggest",
    async (stored) => {
      const wsPath = join(tmpDir, "ws-malformed");
      mkdirSync(wsPath, { recursive: true });
      const lines = [
        `worktree=${wsPath}`,
        "branch=feat/TEST-1",
        "status=killed",
        "project=my-app",
        `permissions=${stored}`,
        `runtimeHandle=${JSON.stringify(makeHandle("rt-old"))}`,
      ];
      writeFileSync(join(sessionsDir, "app-1"), `${lines.join("\n")}\n`);
      expect(readFileSync(join(sessionsDir, "app-1"), "utf-8")).toContain("permissions=");

      config = configWithPermissions("permissionless", "permissionless");
      const seen: Array<unknown> = [];
      const agentWithRestore: Agent = {
        ...mockAgent,
        getRestoreCommand: vi.fn().mockImplementation(async (_s, project) => {
          seen.push(project.agentConfig?.permissions);
          return "mock-agent --resume";
        }),
      };
      const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
      await sm.restore("app-1");
      expect(seen).toEqual(["suggest"]);
    },
  );

  it("a record without the keys follows the current config", async () => {
    writeStoredSession("ws-legacy", {});
    config = configWithModelAndPermissions("model-B", "permissionless");
    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, project, effectiveModel) => {
        return `mock-agent --resume --perms ${project.agentConfig?.permissions} --model ${effectiveModel}`;
      }),
    };
    const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm.restore("app-1");
    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "model-B",
    );
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("--perms permissionless");
    expect(createCall.launchCommand).toContain("--model model-B");
  });

  it("an orchestrator ignores stray stored model and mode keys", async () => {
    const wsPath = join(tmpDir, "ws-orch-stray");
    mkdirSync(wsPath, { recursive: true });
    const configWithOrchModel: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: { model: "shared-model", orchestratorModel: "orch-model" },
        },
      },
    };
    config = configWithOrchModel;
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: wsPath,
      branch: "main",
      status: "killed",
      project: "my-app",
      role: "orchestrator",
      model: "stray-model",
      permissions: "default",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, project, effectiveModel) => {
        const perms = project.agentConfig?.permissions as string | undefined;
        return `mock-agent --resume --perms ${perms} --model ${effectiveModel}`;
      }),
    };
    const sm = createSessionManager({
      config: configWithOrchModel,
      registry: registryWith(agentWithRestore),
    });
    await sm.restore("app-orchestrator");
    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "orch-model",
    );
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("--perms permissionless");
    expect(createCall.launchCommand).not.toContain("stray-model");
  });

  it("restore-before-send uses the stored model and mode", async () => {
    writeStoredSession("ws-send-stored", { model: "model-A", permissions: "default" });
    config = configWithModelAndPermissions("model-B", "permissionless");

    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, project, effectiveModel) => {
        const perms = project.agentConfig?.permissions as string | undefined;
        return `mock-agent --resume --perms ${perms} --model ${effectiveModel}`;
      }),
    };
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-restored"));
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");

    const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm.send("app-1", "hello");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "model-A",
    );
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("--perms default");
    expect(createCall.launchCommand).toContain("--model model-A");
  });

  it("kill (archive) + restore + restore keeps the stored default mode", async () => {
    const wsPath = join(tmpDir, "ws-arch");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      permissions: "default",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    deleteMetadata(sessionsDir, "app-1"); // archive, as `ao session kill` does
    config = configWithPermissions("permissionless", "permissionless");
    const agent: Agent = {
      ...mockAgent,
      getRestoreCommand: vi
        .fn()
        .mockImplementation(async (_s, p) => `mock --resume --perms ${p.agentConfig?.permissions}`),
    };
    const sm = createSessionManager({ config, registry: registryWith(agent) });
    await sm.restore("app-1");
    const storedAfterArchiveRestore = readMetadataRaw(sessionsDir, "app-1")?.["permissions"];
    updateMetadata(sessionsDir, "app-1", { status: "killed" });
    vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
    await sm.restore("app-1");
    const calls = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls;
    expect({
      first: calls[0]![0].launchCommand,
      storedAfterArchiveRestore,
      second: calls.at(-1)![0].launchCommand,
    }).toEqual({
      first: "mock --resume --perms default",
      storedAfterArchiveRestore: "default",
      second: "mock --resume --perms default",
    });
  });
});
