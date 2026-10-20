/**
 * A rejected `Runtime.isAlive` or `Agent.isProcessRunning` means "the probe
 * could not tell" (an unreachable tmux server, a failing `ps`, a timeout). No
 * session-manager caller may turn it into killed, a restore, an archive, a
 * worktree removal or a cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata, readMetadataRaw, readArchivedMetadataRaw } from "../../metadata.js";
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Workspace,
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
let mockWorkspace: Workspace;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

beforeEach(() => {
  ctx = setupTestContext();
  ({ tmpDir, sessionsDir, mockRuntime, mockAgent, mockWorkspace, mockRegistry, config } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

/** The rejection of runtime-tmux when the server cannot be reached. */
function unreachable(code = "ERR_RUNTIME_PROBE"): Error {
  return Object.assign(new Error("tmux has-session -t rt-1 could not answer: timed out"), {
    code,
  });
}

function writeWorker(sessionId: string, worktree: string): void {
  writeMetadata(sessionsDir, sessionId, {
    worktree,
    branch: "feat/x",
    status: "working",
    project: "my-app",
    runtimeHandle: JSON.stringify(makeHandle("rt-1")),
  });
}

describe("list() and get()", () => {
  it("do not report killed on a rejected isAlive", async () => {
    writeWorker("app-1", "/tmp");
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(unreachable());

    const sm = createSessionManager({ config, registry: mockRegistry });

    expect((await sm.get("app-1"))?.status).toBe("working");
    expect((await sm.list("my-app")).map((s) => s.status)).toEqual(["working"]);
  });
});

describe("cleanup()", () => {
  it.each([
    { probe: "isAlive rejects (probe failure)", code: "ERR_RUNTIME_PROBE" },
    { probe: "isAlive rejects (no server)", code: RUNTIME_NO_SERVER_ERROR_CODE },
  ])("skips a session when $probe", async ({ code }) => {
    const worktree = join(tmpDir, "ws-app-1");
    mkdirSync(worktree, { recursive: true });
    writeWorker("app-1", worktree);
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(unreachable(code));

    const sm = createSessionManager({ config, registry: mockRegistry });
    const result = await sm.cleanup();

    expect(result.killed).not.toContain("app-1");
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockWorkspace.destroy).not.toHaveBeenCalled();
    expect(existsSync(worktree)).toBe(true);
  });
});

describe("send()", () => {
  it.each([
    { probe: "isAlive rejects", runtime: true, agent: false },
    { probe: "isProcessRunning rejects", runtime: false, agent: true },
  ])("does not restore when $probe, and delivers to the stored handle", async (probe) => {
    const worktree = join(tmpDir, "ws-app-1");
    mkdirSync(worktree, { recursive: true });
    writeWorker("app-1", worktree);
    if (probe.runtime) vi.mocked(mockRuntime.isAlive).mockRejectedValue(unreachable());
    if (probe.agent) {
      vi.mocked(mockAgent.isProcessRunning).mockRejectedValue(new Error("ps failed"));
    }
    vi.mocked(mockRuntime.getOutput).mockResolvedValueOnce("before").mockResolvedValueOnce("after");

    const sm = createSessionManager({ config, registry: mockRegistry });
    await sm.send("app-1", "Fix the CI failures");

    expect(mockRuntime.create).not.toHaveBeenCalled();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(makeHandle("rt-1"), "Fix the CI failures");
    expect(readMetadataRaw(sessionsDir, "app-1")?.["restoredAt"]).toBeUndefined();
  });
});

describe("spawnOrchestrator() in project mode", () => {
  beforeEach(() => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    config.projects["my-app"]!.orchestratorSessionStrategy = "reuse";
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: config.projects["my-app"]!.path,
      branch: "main",
      status: "working",
      role: "orchestrator",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-existing")),
    });
  });

  it("neither reuses nor archives the record when isAlive rejects", async () => {
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(unreachable());
    const sm = createSessionManager({ config, registry: mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "Cannot tell whether session app-orchestrator is alive",
    );

    expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-existing")),
    );
    expect(readArchivedMetadataRaw(sessionsDir, "app-orchestrator")).toBeNull();
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("replaces the record when the runtime reports that no server runs (host restart)", async () => {
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(unreachable(RUNTIME_NO_SERVER_ERROR_CODE));
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(session.id).toBe("app-orchestrator");
    expect(mockRuntime.create).toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-new")),
    );
  });
});
