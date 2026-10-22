/**
 * Defect A (2026-10-22): `ao start` hands an orchestrator record whose runtime
 * has no server at all (RUNTIME_NO_SERVER_ERROR_CODE) to `spawnOrchestrator`.
 * This pins what that path does with the old record and the old runtime: no
 * server means that no session can exist, so the old runtime is not stopped
 * (`stopRuntime` is not reached: its destroy-then-isAlive would answer
 * `unknown` with no server), the record is archived (project mode) or left to
 * the lifecycle (isolated mode), and a new launch starts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata, readMetadataRaw, readArchivedMetadataRaw } from "../../metadata.js";
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let sessionsDir: string;
let mockRuntime: Runtime;
let mockRegistry: PluginRegistry;
let config: OrchestratorConfig;

/** The rejection of runtime-tmux `isAlive` when no tmux server runs. */
function noServer(): Error {
  return Object.assign(
    new Error(
      "tmux has-session -t =rt-old could not answer: no server running on /tmp/tmux-1000/default",
    ),
    { code: RUNTIME_NO_SERVER_ERROR_CODE },
  );
}

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, mockRuntime, mockRegistry, config } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("spawnOrchestrator() after a no-server answer (defect A)", () => {
  it("project mode: archives the old record with its handle, stops no runtime, and launches a new one", async () => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    writeMetadata(sessionsDir, "app-orchestrator", {
      worktree: config.projects["my-app"]!.path,
      branch: "main",
      status: "working",
      role: "orchestrator",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(noServer());
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(session.id).toBe("app-orchestrator");
    expect(session.metadata["orchestratorSessionReused"]).toBeUndefined();
    const archived = readArchivedMetadataRaw(sessionsDir, "app-orchestrator");
    expect(archived?.["runtimeHandle"]).toBe(JSON.stringify(makeHandle("rt-old")));
    expect(archived?.["status"]).toBe("working");
    expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-new")),
    );
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
  });

  it("isolated mode: starts the next ID, stops no runtime, and leaves the old record to the lifecycle", async () => {
    writeMetadata(sessionsDir, "app-orchestrator-1", {
      worktree: "/tmp/ws-old",
      branch: "orchestrator/app-orchestrator-1",
      status: "working",
      role: "orchestrator",
      project: "my-app",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    vi.mocked(mockRuntime.isAlive).mockRejectedValue(noServer());
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(session.id).toBe("app-orchestrator-2");
    expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["status"]).toBe("working");
    expect(readMetadataRaw(sessionsDir, "app-orchestrator-1")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-old")),
    );
    expect(mockRuntime.destroy).not.toHaveBeenCalled();
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
  });
});
