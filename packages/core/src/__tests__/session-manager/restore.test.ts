import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { getSessionsDir, getStateRoot } from "../../paths.js";
import { writeMetadata, readMetadataRaw, deleteMetadata } from "../../metadata.js";
import {
  SessionNotRestorableError,
  WorkspaceMissingError,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Agent,
  type Workspace,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";
import { installMockOpencodeApi } from "./opencode-helpers.js";

let ctx: TestContext;
let tmpDir: string;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockAgent: Agent;
let mockWorkspace: Workspace;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;
let originalPath: string | undefined;

beforeEach(() => {
  ctx = setupTestContext();
  ({
    tmpDir,
    sessionsDir,
    mockRuntime,
    mockAgent,
    mockWorkspace,
    mockRegistry,
    config,
    originalPath,
  } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("restore", () => {
  it("restores a killed session with existing workspace", async () => {
    // Create a workspace directory that exists
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      issue: "TEST-1",
      pr: "https://github.com/org/my-app/pull/10",
      createdAt: "2025-01-01T00:00:00.000Z",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    const restored = await sm.restore("app-1");

    expect(restored.id).toBe("app-1");
    expect(restored.status).toBe("spawning");
    expect(restored.activity).toBe("active");
    expect(restored.workspacePath).toBe(wsPath);
    expect(restored.branch).toBe("feat/TEST-1");
    expect(restored.runtimeHandle).toEqual(makeHandle("rt-1"));
    expect(restored.restoredAt).toBeInstanceOf(Date);

    // Verify old runtime was destroyed before creating new one
    expect(mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-old"));
    expect(mockRuntime.create).toHaveBeenCalled();
    // Verify metadata was updated (not rewritten)
    const meta = readMetadataRaw(sessionsDir, "app-1");
    expect(meta!["status"]).toBe("spawning");
    expect(meta!["restoredAt"]).toBeDefined();
    // Verify original fields are preserved
    expect(meta!["issue"]).toBe("TEST-1");
    expect(meta!["pr"]).toBe("https://github.com/org/my-app/pull/10");
    expect(meta!["createdAt"]).toBe("2025-01-01T00:00:00.000Z");
  });

  it("passes the resolved AO_STATE_ROOT to the restored runtime", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });
    const previousStateRoot = process.env["AO_STATE_ROOT"];
    const rawStateRoot = `${tmpDir}/state/../custom-state`;

    try {
      process.env["AO_STATE_ROOT"] = rawStateRoot;
      const resolvedStateRoot = getStateRoot();
      const customSessionsDir = getSessionsDir(config.configPath!, config.projects["my-app"]!.path);
      mkdirSync(customSessionsDir, { recursive: true });
      writeMetadata(customSessionsDir, "app-1", {
        worktree: wsPath,
        branch: "feat/TEST-1",
        status: "killed",
        project: "my-app",
        runtimeHandle: JSON.stringify(makeHandle("rt-old")),
      });
      const sm = createSessionManager({ config, registry: mockRegistry });

      await sm.restore("app-1");

      const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createCall.environment).toMatchObject({ AO_STATE_ROOT: resolvedStateRoot });
      expect(resolvedStateRoot).not.toBe(rawStateRoot);
    } finally {
      if (previousStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
      else process.env["AO_STATE_ROOT"] = previousStateRoot;
    }
  });

  it("continues restore even if old runtime destroy fails", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    // Make destroy throw — should not block restore while the runtime
    // answers that the old session is gone (same-ID R2a: "absent").
    const failingRuntime = {
      ...mockRuntime,
      destroy: vi.fn().mockRejectedValue(new Error("session not found")),
      isAlive: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(makeHandle("rt-new")),
    };

    const registryWithFailingDestroy: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return failingRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithFailingDestroy });
    const restored = await sm.restore("app-1");

    expect(restored.status).toBe("spawning");
    expect(failingRuntime.destroy).toHaveBeenCalled();
    expect(failingRuntime.create).toHaveBeenCalled();
  });

  it("recreates workspace when missing and plugin supports restore", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    // DO NOT create the directory — it's missing

    const mockWorkspaceWithRestore: Workspace = {
      ...mockWorkspace,
      exists: vi.fn().mockResolvedValue(false),
      restore: vi.fn().mockResolvedValue({
        path: wsPath,
        branch: "feat/TEST-1",
        sessionId: "app-1",
        projectId: "my-app",
      }),
    };

    const registryWithRestore: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspaceWithRestore;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "terminated",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithRestore });
    const restored = await sm.restore("app-1");

    expect(restored.id).toBe("app-1");
    expect(mockWorkspaceWithRestore.restore).toHaveBeenCalled();
    expect(mockRuntime.create).toHaveBeenCalled();
  });

  it("throws SessionNotRestorableError for merged sessions", async () => {
    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "merged",
      project: "my-app",
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.restore("app-1")).rejects.toThrow(SessionNotRestorableError);
  });

  it("throws SessionNotRestorableError for working sessions", async () => {
    writeMetadata(sessionsDir, "app-1", {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      project: "my-app",
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.restore("app-1")).rejects.toThrow(SessionNotRestorableError);
  });

  it("throws WorkspaceMissingError when workspace gone and no restore method", async () => {
    const wsPath = join(tmpDir, "nonexistent-ws");

    const mockWorkspaceNoRestore: Workspace = {
      ...mockWorkspace,
      exists: vi.fn().mockResolvedValue(false),
      // No restore method
    };

    const registryNoRestore: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgent;
        if (slot === "workspace") return mockWorkspaceNoRestore;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryNoRestore });
    await expect(sm.restore("app-1")).rejects.toThrow(WorkspaceMissingError);
  });

  it("restores a session from archive when active metadata is deleted", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    // Create metadata, then delete it (which archives it)
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      issue: "TEST-1",
      pr: "https://github.com/org/my-app/pull/10",
      createdAt: "2025-01-01T00:00:00.000Z",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    // Archive it (deleteMetadata with archive=true is the default)
    deleteMetadata(sessionsDir, "app-1");

    // Verify active metadata is gone
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();

    // Restore should find it in archive
    const sm = createSessionManager({ config, registry: mockRegistry });
    const restored = await sm.restore("app-1");

    expect(restored.id).toBe("app-1");
    expect(restored.status).toBe("spawning");
    expect(restored.branch).toBe("feat/TEST-1");
    expect(restored.workspacePath).toBe(wsPath);

    // Verify active metadata was recreated
    const meta = readMetadataRaw(sessionsDir, "app-1");
    expect(meta).not.toBeNull();
    expect(meta!["issue"]).toBe("TEST-1");
    expect(meta!["pr"]).toBe("https://github.com/org/my-app/pull/10");
  });

  it("restores from archive with multiple archived versions (picks latest)", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    // Manually create two archive entries with different timestamps
    const archiveDir = join(sessionsDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    // Older archive — has stale branch
    writeFileSync(
      join(archiveDir, "app-1_2025-01-01T00-00-00-000Z"),
      "worktree=" + wsPath + "\nbranch=old-branch\nstatus=killed\nproject=my-app\n",
    );

    // Newer archive — has correct branch
    writeFileSync(
      join(archiveDir, "app-1_2025-06-15T12-00-00-000Z"),
      "worktree=" +
        wsPath +
        "\nbranch=feat/latest\nstatus=killed\nproject=my-app\n" +
        "runtimeHandle=" +
        JSON.stringify(makeHandle("rt-old")) +
        "\n",
    );

    const sm = createSessionManager({ config, registry: mockRegistry });
    const restored = await sm.restore("app-1");

    expect(restored.branch).toBe("feat/latest");
  });

  it("throws for nonexistent session (not in active or archive)", async () => {
    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.restore("nonexistent")).rejects.toThrow("not found");
  });

  it("does not recreate active metadata when the agent refuses an archive restore", async () => {
    // The OpenCode plugin refuses a restore without a stored OpenCode session
    // ID (I-2 A4). Core asks the agent before it copies the archive back, so a
    // refusal leaves no active record and touches neither the workspace nor
    // the old runtime.
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });
    const refusingAgent: Agent = {
      ...mockAgent,
      name: "opencode",
      getRestoreCommand: vi
        .fn()
        .mockRejectedValue(
          new SessionNotRestorableError("app-1", "no stored OpenCode session ID for app-1"),
        ),
    };
    const registryWithRefusal: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return refusingAgent;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      agent: "opencode",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    deleteMetadata(sessionsDir, "app-1");

    const sm = createSessionManager({ config, registry: registryWithRefusal });
    await expect(sm.restore("app-1")).rejects.toThrow(SessionNotRestorableError);

    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("does not recreate active metadata from archive when session is not restorable", async () => {
    const wsPath = join(tmpDir, "ws-app-archive-non-restorable");
    mkdirSync(wsPath, { recursive: true });

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "main",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_archive_valid",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    deleteMetadata(sessionsDir, "app-1", true);

    const sm = createSessionManager({ config, registry: mockRegistry });
    await expect(sm.restore("app-1")).rejects.toThrow(SessionNotRestorableError);

    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
  });

  describe("OpenCode session without a stored ID", () => {
    function refusingRegistry(error: Error): { registry: PluginRegistry; agent: Agent } {
      const agent: Agent = {
        ...mockAgent,
        name: "opencode",
        getRestoreCommand: vi.fn().mockRejectedValue(error),
      };
      const registry: PluginRegistry = {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return agent;
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };
      return { registry, agent };
    }

    function writeUnmappedSession(wsPath: string): void {
      writeMetadata(sessionsDir, "app-1", {
        worktree: wsPath,
        branch: "feat/TEST-1",
        status: "killed",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses bad id",
        runtimeHandle: JSON.stringify(makeHandle("rt-old")),
      });
    }

    it("reports the agent's version refusal, not only the missing mapping (M-1)", async () => {
      // The OpenCode plugin runs its version gate before its "no stored ID"
      // check. Core must not answer "no stored ID" on its own first.
      const wsPath = join(tmpDir, "ws-app-restore-refused-binary");
      mkdirSync(wsPath, { recursive: true });
      const { registry, agent } = refusingRegistry(
        new Error("ao needs OpenCode 2.0.29 or later (found 1.18.35)"),
      );
      writeUnmappedSession(wsPath);

      const sm = createSessionManager({ config, registry });
      await expect(sm.restore("app-1")).rejects.toThrow(
        "ao needs OpenCode 2.0.29 or later (found 1.18.35)",
      );
      expect(agent.getRestoreCommand).toHaveBeenCalled();
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
    });

    it("does not search by title when the agent refuses the restore", async () => {
      // A same-title session exists in the workspace; a restore must still
      // not bind it (owner Q7: no title search on restore).
      const wsPath = join(tmpDir, "ws-app-restore-invalid-map");
      mkdirSync(wsPath, { recursive: true });
      const apiLogPath = join(tmpDir, "opencode-restore-api.log");
      const mockBin = installMockOpencodeApi(
        tmpDir,
        [{ id: "ses_restore_title_match", title: "AO:app-1", directory: wsPath }],
        { apiLogPath },
      );
      process.env.PATH = `${mockBin}:${originalPath ?? ""}`;
      const { registry } = refusingRegistry(
        new SessionNotRestorableError("app-1", "no stored OpenCode session ID for app-1"),
      );
      writeUnmappedSession(wsPath);

      const sm = createSessionManager({ config, registry });
      await expect(sm.restore("app-1")).rejects.toThrow(SessionNotRestorableError);

      const apiCalls = existsSync(apiLogPath) ? readFileSync(apiLogPath, "utf-8") : "";
      expect(apiCalls).not.toContain("session.list");
      expect(readMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe("ses bad id");
    });
  });

  it("uses orchestratorModel when restoring orchestrator sessions", async () => {
    const wsPath = join(tmpDir, "ws-app-orchestrator-restore");
    mkdirSync(wsPath, { recursive: true });

    const configWithOrchestratorModel: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
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
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({
      config: configWithOrchestratorModel,
      registry: mockRegistry,
    });
    await sm.restore("app-orchestrator");

    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ model: "orchestrator-model" }),
    );
  });

  it("forwards configured subagent when restoring sessions", async () => {
    const wsPath = join(tmpDir, "ws-app-restore-subagent");
    mkdirSync(wsPath, { recursive: true });

    const configWithSubagent: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "my-app": {
          ...config.projects["my-app"],
          agentConfig: {
            subagent: "oracle",
          },
        },
      },
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-SUBAGENT",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config: configWithSubagent, registry: mockRegistry });
    await sm.restore("app-1");

    expect(mockAgent.getLaunchCommand).toHaveBeenCalledWith(
      expect.objectContaining({ subagent: "oracle" }),
    );
  });

  it("uses getRestoreCommand when available", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    const mockAgentWithRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue("claude --resume abc123"),
    };

    const registryWithAgentRestore: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgentWithRestore;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "errored",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithAgentRestore });
    await sm.restore("app-1");

    expect(mockAgentWithRestore.getRestoreCommand).toHaveBeenCalled();
    // Verify runtime.create was called with the restore command
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toBe("claude --resume abc123");
  });

  it("falls back to getLaunchCommand when getRestoreCommand returns null", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    const mockAgentWithNullRestore: Agent = {
      ...mockAgent,
      getRestoreCommand: vi.fn().mockResolvedValue(null),
    };

    const registryWithNullRestore: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return mockAgentWithNullRestore;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-1",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithNullRestore });
    await sm.restore("app-1");

    expect(mockAgentWithNullRestore.getRestoreCommand).toHaveBeenCalled();
    expect(mockAgent.getLaunchCommand).toHaveBeenCalled();
    const createCall = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.launchCommand).toBe("mock-agent --start");
  });

  describe("when the agent refuses the restore", () => {
    function registryWith(agent: Agent): PluginRegistry {
      return {
        ...mockRegistry,
        get: vi.fn().mockImplementation((slot: string) => {
          if (slot === "runtime") return mockRuntime;
          if (slot === "agent") return agent;
          if (slot === "workspace") return mockWorkspace;
          return null;
        }),
      };
    }

    beforeEach(() => {
      const wsPath = join(tmpDir, "ws-app-1");
      mkdirSync(wsPath, { recursive: true });
      writeMetadata(sessionsDir, "app-1", {
        worktree: wsPath,
        branch: "feat/TEST-1",
        status: "killed",
        project: "my-app",
        runtimeHandle: JSON.stringify(makeHandle("rt-old")),
      });
    });

    it("keeps the old runtime when getRestoreCommand throws", async () => {
      const refusingAgent: Agent = {
        ...mockAgent,
        getRestoreCommand: vi.fn().mockRejectedValue(new Error("agent refused the restore")),
      };
      const sm = createSessionManager({ config, registry: registryWith(refusingAgent) });

      await expect(sm.restore("app-1")).rejects.toThrow("agent refused the restore");

      expect(mockRuntime.destroy).not.toHaveBeenCalled();
      expect(mockRuntime.create).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-1")!["status"]).toBe("killed");
    });

    it("keeps the old runtime when the fallback getLaunchCommand throws", async () => {
      const refusingAgent: Agent = {
        ...mockAgent,
        getRestoreCommand: vi.fn().mockResolvedValue(null),
        getLaunchCommand: vi.fn().mockImplementation(() => {
          throw new Error("agent refused the launch");
        }),
      };
      const sm = createSessionManager({ config, registry: registryWith(refusingAgent) });

      await expect(sm.restore("app-1")).rejects.toThrow("agent refused the launch");

      expect(mockRuntime.destroy).not.toHaveBeenCalled();
      expect(mockRuntime.create).not.toHaveBeenCalled();
    });

    it("destroys the old runtime only after the restore command is ready", async () => {
      const calls: string[] = [];
      const orderedAgent: Agent = {
        ...mockAgent,
        getRestoreCommand: vi.fn().mockImplementation(async () => {
          calls.push("getRestoreCommand");
          return "agent --resume";
        }),
      };
      (mockRuntime.destroy as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        calls.push("destroy");
      });
      (mockRuntime.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        calls.push("create");
        return makeHandle("rt-new");
      });
      const sm = createSessionManager({ config, registry: registryWith(orderedAgent) });

      await sm.restore("app-1");

      expect(calls).toEqual(["getRestoreCommand", "destroy", "create"]);
      expect(mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-old"));
    });
  });

  it("preserves original createdAt/issue/PR metadata", async () => {
    const wsPath = join(tmpDir, "ws-app-1");
    mkdirSync(wsPath, { recursive: true });

    const originalCreatedAt = "2024-06-15T10:00:00.000Z";
    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-42",
      status: "killed",
      project: "my-app",
      issue: "TEST-42",
      pr: "https://github.com/org/my-app/pull/99",
      summary: "Implementing feature X",
      createdAt: originalCreatedAt,
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.restore("app-1");

    const meta = readMetadataRaw(sessionsDir, "app-1");
    expect(meta!["createdAt"]).toBe(originalCreatedAt);
    expect(meta!["issue"]).toBe("TEST-42");
    expect(meta!["pr"]).toBe("https://github.com/org/my-app/pull/99");
    expect(meta!["summary"]).toBe("Implementing feature X");
    expect(meta!["branch"]).toBe("feat/TEST-42");
  });

  it("does not overwrite restored status/runtime metadata when postLaunchSetup is a no-op", async () => {
    const wsPath = join(tmpDir, "ws-app-post-launch-noop");
    mkdirSync(wsPath, { recursive: true });

    const agentWithNoopPostLaunch: Agent = {
      ...mockAgent,
      postLaunchSetup: vi.fn().mockResolvedValue(undefined),
    };

    const registryWithNoopPostLaunch: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return agentWithNoopPostLaunch;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-77",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithNoopPostLaunch });
    await sm.restore("app-1");

    const meta = readMetadataRaw(sessionsDir, "app-1");
    expect(meta!["status"]).toBe("spawning");
    expect(meta!["runtimeHandle"]).toBe(JSON.stringify(makeHandle("rt-1")));
    expect(meta!["restoredAt"]).toBeDefined();
  });

  it("persists only metadata updates produced by postLaunchSetup", async () => {
    const wsPath = join(tmpDir, "ws-app-post-launch-metadata");
    mkdirSync(wsPath, { recursive: true });

    const agentWithMetadataUpdate: Agent = {
      ...mockAgent,
      postLaunchSetup: vi.fn().mockImplementation(async (session) => {
        session.metadata = {
          ...session.metadata,
          opencodeSessionId: "ses_from_post_launch",
        };
      }),
    };

    const registryWithMetadataUpdate: PluginRegistry = {
      ...mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return mockRuntime;
        if (slot === "agent") return agentWithMetadataUpdate;
        if (slot === "workspace") return mockWorkspace;
        return null;
      }),
    };

    writeMetadata(sessionsDir, "app-1", {
      worktree: wsPath,
      branch: "feat/TEST-78",
      status: "killed",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });

    const sm = createSessionManager({ config, registry: registryWithMetadataUpdate });
    await sm.restore("app-1");

    const meta = readMetadataRaw(sessionsDir, "app-1");
    expect(meta!["status"]).toBe("spawning");
    expect(meta!["runtimeHandle"]).toBe(JSON.stringify(makeHandle("rt-1")));
    expect(meta!["opencodeSessionId"]).toBe("ses_from_post_launch");
  });
});
