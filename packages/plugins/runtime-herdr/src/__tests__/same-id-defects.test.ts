/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests.
 *
 * D-D (round-9 audit, "other-plugin liveness answers false on an error"):
 * `getPane` catches every failure of the herdr CLI and answers null, so
 * `isAlive` answers false when the check could not run. The lifecycle counts
 * such a negative as "ambiguous" and persists killed after two polls (five
 * minutes in an outage poll), the recovery classifies the session as dead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  execFileSync: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify:
    (_fn: unknown) =>
    (...args: any[]) =>
      mockExecFile(...args),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

const { create } = await import("../index.js");

// Same-ID R4 made every defect of this file a plain test, so no `defect`
// marking is left.

const HANDLE = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: { workspaceId: "w7", paneId: "w7:p1", terminalId: "term_abc", sessionId: "app-1" },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("[same-id R4] D-D: runtime-herdr isAlive answers false when it cannot check", () => {
  it("isAlive rejects when the herdr command times out", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("Command failed: herdr pane get w7:p1"), {
        code: null,
        killed: true,
        signal: "SIGTERM",
        stdout: "",
        stderr: "",
      }),
    );
    await expect(create().isAlive(HANDLE)).rejects.toThrow();
  });

  it("isAlive rejects when the herdr binary cannot start", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("spawn herdr ENOENT"), { code: "ENOENT", errno: -2 }),
    );
    await expect(create().isAlive(HANDLE)).rejects.toThrow();
  });
});
