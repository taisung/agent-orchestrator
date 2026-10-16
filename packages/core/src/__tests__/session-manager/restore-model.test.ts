import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata, readMetadataRaw, deleteMetadata } from "../../metadata.js";
import type { OrchestratorConfig, PluginRegistry, Runtime, Agent } from "../../types.js";
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

describe("restore model (C-04)", () => {
  it("persists the spawn --model and uses it at launch", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app", model: "spawn-model-X" });

    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(raw?.["model"]).toBe("spawn-model-X");
    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ model: "spawn-model-X" }),
    );
  });

  it("stores no model when spawn gives none", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.spawn({ projectId: "my-app" });

    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(raw?.["model"]).toBeUndefined();
  });

  it("restore passes the persisted model to getRestoreCommand", async () => {
    const wsPath = join(tmpDir, "ws-restore-model");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      model: "spawn-model-X",
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
    const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm.restore("app-1");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "spawn-model-X",
    );
    expect(seen).toEqual(["spawn-model-X"]);
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("spawn-model-X");
  });

  it("restore falls back to getLaunchCommand with the persisted model", async () => {
    const wsPath = join(tmpDir, "ws-restore-fallback");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      model: "spawn-model-X",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const agentWithNullRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue(null),
    };
    const sm = createSessionManager({ config, registry: registryWith(agentWithNullRestore) });
    await sm.restore("app-1");

    expect(agentWithNullRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "spawn-model-X",
    );
    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ model: "spawn-model-X" }),
    );
  });

  it("restores with the config model when no spawn model was stored", async () => {
    const wsPath = join(tmpDir, "ws-restore-config");
    mkdirSync(wsPath, { recursive: true });
    const configWithModel: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: { model: "config-model" },
        },
      },
    };
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue("mock-agent --resume"),
    };
    const sm = createSessionManager({
      config: configWithModel,
      registry: registryWith(agentWithRestore),
    });
    await sm.restore("app-1");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "config-model",
    );
    expect(mockAgent.getLaunchCommand).not.toHaveBeenCalled();
  });

  it("a config model changed after spawn does not override the persisted model", async () => {
    const wsPath = join(tmpDir, "ws-restore-stale-config");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      model: "spawn-model-X",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const configWithNewModel: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: { model: "new-config-model" },
        },
      },
    };
    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue("mock-agent --resume"),
    };
    const sm = createSessionManager({
      config: configWithNewModel,
      registry: registryWith(agentWithRestore),
    });
    await sm.restore("app-1");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "spawn-model-X",
    );
  });

  it("restore-before-send uses the persisted model", async () => {
    const wsPath = join(tmpDir, "ws-send-restore");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      model: "spawn-model-X",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockImplementation(async (_s, _p, effectiveModel) => {
        return `mock-agent --resume --model ${effectiveModel}`;
      }),
    };
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-restored"));
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");

    const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm.send("app-1", "hello");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "spawn-model-X",
    );
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toContain("spawn-model-X");
  });

  it("ignores a stray persisted model for orchestrator sessions", async () => {
    const wsPath = join(tmpDir, "ws-orch-model");
    mkdirSync(wsPath, { recursive: true });
    const configWithModels: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"]!,
          agentConfig: {
            model: "worker-model",
            orchestratorModel: "orchestrator-model",
          },
        },
      },
    };
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: wsPath,
      branch: "main",
      status: "killed",
      project: "my-app",
      role: "orchestrator",
      // A stray key that an orchestrator spawn never writes (it has no --model).
      model: "stray-worker-model",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue(null),
    };
    const sm = createSessionManager({
      config: configWithModels,
      registry: registryWith(agentWithRestore),
    });
    await sm.restore("app-orchestrator");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "orchestrator-model",
    );
  });

  it("keeps the persisted model when restoring from archive", async () => {
    const wsPath = join(tmpDir, "ws-archive-model");
    mkdirSync(wsPath, { recursive: true });
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      model: "spawn-model-X",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    deleteMetadata(sessionsDir, "app-1");

    const agentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue("mock-agent --resume"),
    };
    const sm = createSessionManager({ config, registry: registryWith(agentWithRestore) });
    await sm.restore("app-1");

    expect(agentWithRestore.getRestoreCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "spawn-model-X",
    );
    expect(readMetadataRaw(sessionsDir, "app-1")?.["model"]).toBe("spawn-model-X");
  });
});
