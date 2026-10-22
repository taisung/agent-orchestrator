/**
 * Defect tests of the same-ID design revision r2 (ao-52, design file
 * development/reviews/same_id_design_r2_opus.md), for runtime-herdr:
 *
 * - review r1 B-7 item 3 (round R4): herdr answers a failure in the body with
 *   exit code 0 (`{"error": {...}}`, runtime-herdr/src/index.ts:94-123).
 *   `getPane` catches every failure and answers null, so `isAlive` answers
 *   false for an error envelope that is not "pane not found" and for a
 *   reply that has no pane.
 * - N-1 of design r2 (round R2, the Herdr part of B-6): pane IDs are reused
 *   after a workspace closes (the guard in `isAlive`), but `destroy` closes
 *   the recorded workspace or pane without that guard, so a stale handle can
 *   close another session's terminal.
 *
 * Each `defect` test fails on c516cead for the measured reason; the `it`
 * tests are controls that pass on c516cead and must stay green.
 * Marking as in design r1 section 8.1: `defect(...)` is `it.fails`, and
 * `SAME_ID_DEFECTS=red` makes it a plain test.
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

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

const HANDLE = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: { workspaceId: "w7", paneId: "w7:p1", terminalId: "term_abc", sessionId: "app-1" },
};

/** herdr's answer to each call: `pane get` gets `pane`, every other command succeeds. */
function herdrWith(pane: () => string): string[][] {
  const calls: string[][] = [];
  mockExecFile.mockImplementation(async (_bin: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "pane" && args[1] === "get") return { stdout: pane(), stderr: "" };
    return { stdout: JSON.stringify({ id: "x", result: {} }), stderr: "" };
  });
  return calls;
}

const paneOf = (terminalId: string) =>
  JSON.stringify({
    id: "cli:pane:get",
    result: { pane: { pane_id: "w7:p1", terminal_id: terminalId, workspace_id: "w7" } },
  });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("[same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane'", () => {
  it("isAlive rejects when herdr answers an error envelope that is not 'pane not found'", async () => {
    herdrWith(() =>
      JSON.stringify({ error: { code: "server_unavailable", message: "no server" } }),
    );
    await expect(create().isAlive(HANDLE)).rejects.toThrow();
  });

  it("isAlive rejects when herdr answers a reply without a pane", async () => {
    herdrWith(() => JSON.stringify({ id: "cli:pane:get", result: {} }));
    await expect(create().isAlive(HANDLE)).rejects.toThrow();
  });

  it("control: an explicit 'pane not found' envelope answers false", async () => {
    herdrWith(() => JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }));
    await expect(create().isAlive(HANDLE)).resolves.toBe(false);
  });

  it("control: a pane ID that now names another terminal answers false", async () => {
    herdrWith(() => paneOf("term_someone_else"));
    await expect(create().isAlive(HANDLE)).resolves.toBe(false);
  });

  it("control: the recorded pane with its terminal answers true", async () => {
    herdrWith(() => paneOf("term_abc"));
    await expect(create().isAlive(HANDLE)).resolves.toBe(true);
  });
});

describe("[same-id R2] N-1: runtime-herdr destroy closes a reused pane ID", () => {
  defect(
    "destroy does not close the workspace or pane when the pane ID now names another terminal",
    async () => {
      const calls = herdrWith(() => paneOf("term_someone_else"));
      await create()
        .destroy(HANDLE)
        .catch(() => undefined);
      // Measured in code (runtime-herdr/src/index.ts:321-333): destroy runs
      // `workspace close w7` with no check of the terminal.
      expect(calls.filter((args) => args.includes("close"))).toEqual([]);
    },
  );

  it("control: destroy closes the recorded workspace while its pane has the recorded terminal", async () => {
    const calls = herdrWith(() => paneOf("term_abc"));
    await create().destroy(HANDLE);
    expect(
      calls.some((args) => args[0] === "workspace" && args[1] === "close" && args[2] === "w7"),
    ).toBe(true);
  });
});
