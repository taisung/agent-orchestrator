import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata } from "../../metadata.js";
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
