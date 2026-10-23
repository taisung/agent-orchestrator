/**
 * An old Herdr orchestrator record at `spawnOrchestrator` (owner decision
 * OQ-F1 (b), 2026-10-22). After fit F-1, herdr 0.9.5 answers a closed pane
 * with `isAlive` false and a socket with no server with
 * RUNTIME_NO_SERVER_ERROR_CODE. For a record whose runtime is Herdr neither
 * answer is "gone": a Herdr server can still run the launch where the
 * endpoint does not reach it, so the record is neither archived nor deleted
 * and no orchestrator starts. fit-1 refused with an interim text; Herdr
 * fit-2 G (design r11 5.3.10) refuses with OrchestratorStartBlockedError
 * (`records`, kind `unproven`) and message M. The project selects herdr
 * (R5); the non-strict mock registry answers the mock runtime for it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../../session-manager.js";
import {
  writeMetadata,
  readMetadataRaw,
  readArchivedMetadataRaw,
  launchIdentityToken,
} from "../../metadata.js";
import { isOrchestratorStartBlockedError } from "../../runtime-errors.js";
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

/** Message M (design r11 5.3.8) for the record of `writeOrchestrator(HERDR_HANDLE)`. */
function messageM(token: string, answer: string): string {
  return [
    "No new orchestrator was started for project my-app: AO cannot tell that every earlier herdr orchestrator launch of the project ended.",
    `app-orchestrator: status working. Herdr pane w3:p2 (terminal term_a), workspace w3, worktree ${config.projects["my-app"]!.path}, socket not recorded: ${answer}.`,
    "  Check:  'herdr' pane get 'w3:p2'",
    "  If it runs, use it:  ao session attach 'app-orchestrator'",
    `  If it does not run, or after you close it:  ao session kill 'app-orchestrator' --confirm-runtime-closed '${token}'`,
    "Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.",
  ].join("\n");
}

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, mockRuntime, mockRegistry, config } = ctx);
  config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
  config.projects["my-app"]!.runtime = "herdr";
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

describe("spawnOrchestrator() with an old Herdr orchestrator record (fit-2 G)", () => {
  for (const [label, answer, text] of [
    [
      "isAlive false (pane_not_found or another terminal)",
      () => vi.mocked(mockRuntime.isAlive).mockResolvedValue(false),
      "herdr answered that the pane does not exist or that it has another terminal",
    ],
    [
      "the no-server code",
      () => vi.mocked(mockRuntime.isAlive).mockRejectedValue(herdrNoServer()),
      "no herdr server answers at the socket",
    ],
  ] as const) {
    it(`project mode, ${label}: blocked (unproven) with message M, keeps the record, starts nothing`, async () => {
      writeOrchestrator(HERDR_HANDLE);
      const before = readMetadataRaw(sessionsDir, "app-orchestrator");
      answer();
      vi.mocked(mockRuntime.create).mockResolvedValue(makeHandle("rt-new"));
      const sm = createSessionManager({ config, registry: mockRegistry });

      const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);

      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      if (!isOrchestratorStartBlockedError(err)) return;
      expect(err.reason).toBe("records");
      expect(err.blocking.map((b) => [b.sessionId, b.kind])).toEqual([
        ["app-orchestrator", "unproven"],
      ]);
      expect(err.message).toBe(messageM(launchIdentityToken(before!), text));
      // One probe outside A; message M reuses its answer for the same identity token.
      expect(mockRuntime.isAlive).toHaveBeenCalledTimes(1);
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
