/**
 * Herdr fit-1 interim startup rule (owner decision OQ-F1 (b), 2026-10-22; the
 * fit-2 guard G replaces it). After fit F-1, herdr 0.9.5 answers a closed pane
 * with `isAlive` false and a socket with no server with
 * RUNTIME_NO_SERVER_ERROR_CODE. Before F-1 both rejected, so `spawnOrchestrator`
 * refused. For a record whose runtime is Herdr neither answer is "gone": a
 * Herdr server can still run the launch where the endpoint does not reach it,
 * so the record is neither archived nor deleted and no orchestrator starts.
 * Project mode is the only mode whose core path reads the old record
 * (isolated mode reserves the next ID; fit-2 G adds the check there).
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

const HERDR_HANDLE = {
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a" },
};

/** The rejection of runtime-herdr `isAlive` for the 0.9.5 no-server answer (F-1). */
function herdrNoServer(): Error {
  return Object.assign(
    new Error(
      "herdr pane get w3:p2 could not answer: herdr error server_not_running: no herdr server is running at /tmp/aohd/herdr.sock",
    ),
    { code: RUNTIME_NO_SERVER_ERROR_CODE },
  );
}

const REFUSAL =
  "Cannot tell whether session app-orchestrator is alive, so it is neither reused nor replaced. Check the runtime and retry.";

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, mockRuntime, mockRegistry, config } = ctx);
  config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
});

afterEach(() => {
  teardownTestContext(ctx);
});

function writeOrchestrator(handle: unknown): void {
  writeMetadata(sessionsDir, "app-orchestrator", {
    worktree: config.projects["my-app"]!.path,
    branch: "main",
    status: "working",
    role: "orchestrator",
    project: "my-app",
    runtimeHandle: JSON.stringify(handle),
  });
}

describe("spawnOrchestrator() with an old Herdr orchestrator record (fit-1 interim)", () => {
  for (const [label, answer] of [
    [
      "isAlive false (pane_not_found or another terminal)",
      () => vi.mocked(mockRuntime.isAlive).mockResolvedValue(false),
    ],
    ["the no-server code", () => vi.mocked(mockRuntime.isAlive).mockRejectedValue(herdrNoServer())],
  ] as const) {
    it(`project mode, ${label}: refuses as for an unknown answer, keeps the record, starts nothing`, async () => {
      writeOrchestrator(HERDR_HANDLE);
      const before = readMetadataRaw(sessionsDir, "app-orchestrator");
      answer();
      vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
      const sm = createSessionManager({ config, registry: mockRegistry });

      const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(REFUSAL);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")).toEqual(before);
      expect(readArchivedMetadataRaw(sessionsDir, "app-orchestrator")).toBeNull();
      expect(mockRuntime.create).not.toHaveBeenCalled();
      expect(mockRuntime.destroy).not.toHaveBeenCalled();
    });
  }

  it("project mode: a live Herdr record is reused as before", async () => {
    writeOrchestrator(HERDR_HANDLE);
    vi.mocked(mockRuntime.isAlive).mockResolvedValue(true);
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(session.metadata["orchestratorSessionReused"]).toBe("true");
    expect(mockRuntime.create).not.toHaveBeenCalled();
  });

  it("control: a record of another runtime that answers false is archived and replaced as before", async () => {
    writeOrchestrator(makeHandle("rt-old"));
    vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
    vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
    const sm = createSessionManager({ config, registry: mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(session.id).toBe("app-orchestrator");
    expect(readArchivedMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-old")),
    );
    expect(mockRuntime.create).toHaveBeenCalledTimes(1);
  });
});
