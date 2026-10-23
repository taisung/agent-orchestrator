/**
 * Session relaunch (2026-10-22): the two runtime-tmux additions that a
 * relaunch uses on an existing pane, `listPanes` and `runInPane`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { RUNTIME_NO_SERVER_ERROR_CODE, type RuntimeHandle } from "@aoagents/ao-core";

vi.mock("node:child_process", () => {
  const mockExecFile = vi.fn();
  (mockExecFile as any)[Symbol.for("nodejs.util.promisify.custom")] = vi.fn();
  return { execFile: mockExecFile };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, readFileSync: vi.fn() };
});

const mockExecFileCustom = (childProcess.execFile as any)[
  Symbol.for("nodejs.util.promisify.custom")
] as ReturnType<typeof vi.fn>;
const expectedTmuxOptions = { timeout: 5_000 };
const FORMAT = "#{pane_id} #{pane_tty} #{pane_pid} #{pane_current_command}";

function mockTmuxSuccess(stdout = "") {
  mockExecFileCustom.mockResolvedValueOnce({ stdout: stdout + "\n", stderr: "" });
}

function mockTmuxFailure(command: string, stderr: string) {
  mockExecFileCustom.mockRejectedValueOnce(
    Object.assign(new Error(`Command failed: tmux ${command}\n${stderr}`), {
      code: 1,
      killed: false,
      signal: null,
      stdout: "",
      stderr,
    }),
  );
}

function makeHandle(id: string): RuntimeHandle {
  return { id, runtimeName: "tmux", data: { createdAt: 1000, workspacePath: "/tmp/ws" } };
}

/**
 * /proc/<pid>/stat of each shell: `[pgrp, tpgid]` (fields 5 and 8), or
 * undefined for a process that /proc does not show.
 */
let procStat: Record<number, [number, number] | undefined>;

import {
  create,
  emptyPromptProblem,
  freshPromptProblem,
  parsePaneSnapshot,
  TmuxProbeError,
  type PaneSnapshot,
} from "../index.js";

const SNAPSHOT_FORMAT =
  "#{cursor_x} #{cursor_y} #{history_size} #{history_limit} #{pane_height} #{pane_in_mode} #{alternate_on}";

/** The tmux arguments of one pane snapshot (the cursor, then the screen, in one call). */
function snapshotArgs(paneId: string): string[] {
  return [
    "display-message",
    "-p",
    "-t",
    paneId,
    SNAPSHOT_FORMAT,
    ";",
    "capture-pane",
    "-p",
    "-t",
    paneId,
  ];
}

/** A snapshot answer: the cursor fields, then the visible rows. */
function screen(
  cursor: { x: number; y: number; size?: number; limit?: number; mode?: 0 | 1 },
  rows: string[],
  height = 6,
): string {
  const head = `${cursor.x} ${cursor.y} ${cursor.size ?? 0} ${cursor.limit ?? 2000} ${height} ${cursor.mode ?? 0} 0`;
  return [head, ...rows].join("\n");
}

function snap(answer: string): PaneSnapshot {
  const parsed = parsePaneSnapshot(answer);
  if (!parsed) throw new Error(`not a snapshot: ${answer}`);
  return parsed;
}

/** The pane after the first C-c of a normal bash: the owner's line, then a fresh prompt. */
const AFTER_FIRST = screen({ x: 10, y: 1 }, [
  "bash-5.2$ ^Cuch owner-1; touch owner-2",
  "bash-5.2$",
]);
/** The same pane after the second C-c: the echo, then another fresh prompt. */
const AFTER_SECOND = screen({ x: 10, y: 2 }, [
  "bash-5.2$ ^Cuch owner-1; touch owner-2",
  "bash-5.2$ ^C",
  "bash-5.2$",
]);

beforeEach(() => {
  vi.resetAllMocks();
  procStat = {};
  vi.mocked(fs.readFileSync).mockImplementation(((path: string) => {
    const pid = Number(/^\/proc\/(\d+)\/stat$/.exec(String(path))?.[1]);
    const ids = procStat[pid];
    if (!ids) throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    return `${pid} (bash) S 1 ${ids[0]} ${ids[0]} 34816 ${ids[1]} 4194560 0 0`;
  }) as typeof fs.readFileSync);
});

describe("runtime.listPanes()", () => {
  it("lists every pane of every window with its ID, TTY, foreground command and shell state", async () => {
    procStat = { 101: [101, 101], 202: [202, 250] };
    mockTmuxSuccess(
      ["%3 /dev/pts/4 101 bash", "%9 /dev/pts/7 202 vim", "%12 /dev/pts/8 303 my tool"].join("\n"),
    );

    const panes = await create().listPanes!(makeHandle("app-1"));

    expect(panes).toEqual([
      { paneId: "%3", tty: "/dev/pts/4", foregroundCommand: "bash", shellIdle: true },
      { paneId: "%9", tty: "/dev/pts/7", foregroundCommand: "vim", shellIdle: false },
      { paneId: "%12", tty: "/dev/pts/8", foregroundCommand: "my tool", shellIdle: null },
    ]);
    expect(mockExecFileCustom).toHaveBeenCalledWith(
      "tmux",
      ["list-panes", "-s", "-t", "=app-1", "-F", FORMAT],
      expectedTmuxOptions,
    );
  });

  it("answers null only when tmux answers that the session does not exist", async () => {
    mockTmuxFailure("list-panes", "can't find session: =app-1\n");

    expect(await create().listPanes!(makeHandle("app-1"))).toBeNull();
  });

  it("rejects with the no-server code when no tmux server runs", async () => {
    mockTmuxFailure("list-panes", "no server running on /tmp/tmux-1000/default\n");

    const err = await create().listPanes!(makeHandle("app-1")).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TmuxProbeError);
    expect((err as TmuxProbeError).code).toBe(RUNTIME_NO_SERVER_ERROR_CODE);
  });

  it.each([
    [""],
    ["%3 /dev/pts/4 101"],
    ["3 /dev/pts/4 101 bash"],
    ["%3 pts/4 101 bash"],
    ["%3 /dev/pts/4 x bash"],
    ["%3 /dev/pts/4 101  "],
    ["%3_/dev/pts/4_101_bash"],
    ["%3 /dev/pts/4 101 bash\ngarbage"],
  ])("rejects an answer that is not a list of panes: %j", async (answer) => {
    mockTmuxSuccess(answer);

    await expect(create().listPanes!(makeHandle("app-1"))).rejects.toThrow(/not a list of panes/);
  });

  it("rejects without a tmux call for a handle ID that is not a safe tmux name", async () => {
    await expect(create().listPanes!(makeHandle("bad.name"))).rejects.toThrow(
      /^Invalid tmux session name/,
    );
    expect(mockExecFileCustom).not.toHaveBeenCalled();
  });
});

describe("runtime.runInPane()", () => {
  it("targets the pane ID in every call: checks it, ends its mode, sends C-c twice with a read after each, types the command literally, then Enter", async () => {
    procStat = { 4242: [4242, 4242] };
    mockTmuxSuccess("app-1 4242");
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess(AFTER_FIRST);
    mockTmuxSuccess();
    mockTmuxSuccess(AFTER_SECOND);
    mockTmuxSuccess();
    mockTmuxSuccess();

    await create().runInPane!(makeHandle("app-1"), "%7", "bash '/tmp/ao-launch-1.sh'");

    expect(mockExecFileCustom.mock.calls).toEqual([
      [
        "tmux",
        ["display-message", "-p", "-t", "%7", "#{session_name} #{pane_pid}"],
        expectedTmuxOptions,
      ],
      ["tmux", ["copy-mode", "-q", "-t", "%7"], expectedTmuxOptions],
      ["tmux", ["send-keys", "-t", "%7", "C-c"], expectedTmuxOptions],
      ["tmux", snapshotArgs("%7"), expectedTmuxOptions],
      ["tmux", ["send-keys", "-t", "%7", "C-c"], expectedTmuxOptions],
      ["tmux", snapshotArgs("%7"), expectedTmuxOptions],
      ["tmux", ["send-keys", "-t", "%7", "-l", "bash '/tmp/ao-launch-1.sh'"], expectedTmuxOptions],
      ["tmux", ["send-keys", "-t", "%7", "Enter"], expectedTmuxOptions],
    ]);
  });

  it("types nothing when the second C-c changes nothing (a shell that ignores SIGINT; review r2 M-2)", async () => {
    procStat = { 4242: [4242, 4242] };
    // The owner's text stays before the cursor: it looks like a prompt line.
    const ignored = screen({ x: 22, y: 0 }, ["bash-5.2$ touch owner"]);
    mockTmuxSuccess("app-1 4242");
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess(ignored);
    mockTmuxSuccess();
    mockExecFileCustom.mockResolvedValue({ stdout: ignored + "\n", stderr: "" });

    await expect(create().runInPane!(makeHandle("app-1"), "%7", "true")).rejects.toThrow(
      /did not show a fresh, empty prompt line after C-c \(the second C-c changed nothing .*\), so nothing was typed/,
    );
    const typed = mockExecFileCustom.mock.calls.filter((call) => call[1].includes("-l"));
    expect(typed).toEqual([]);
    expect(mockExecFileCustom.mock.calls.filter((call) => call[1].includes("Enter"))).toEqual([]);
  });

  it("types nothing and sends no second C-c when the first C-c leaves no prompt (a SIGINT trap that reads; review r2 M-2)", async () => {
    procStat = { 4242: [4242, 4242] };
    const reading = screen({ x: 0, y: 0 }, ["bash-5.2$ ^Cuch owner"]);
    mockTmuxSuccess("app-1 4242");
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockExecFileCustom.mockResolvedValue({ stdout: reading + "\n", stderr: "" });

    await expect(create().runInPane!(makeHandle("app-1"), "%7", "true")).rejects.toThrow(
      /\(after the first C-c: no prompt before the cursor\), so nothing was typed/,
    );
    const keys = mockExecFileCustom.mock.calls.filter((call) => call[1][0] === "send-keys");
    expect(keys).toEqual([["tmux", ["send-keys", "-t", "%7", "C-c"], expectedTmuxOptions]]);
  });

  it("sends no key to a pane of another session", async () => {
    procStat = { 4242: [4242, 4242] };
    mockTmuxSuccess("other-session 4242");

    await expect(create().runInPane!(makeHandle("app-1"), "%7", "true")).rejects.toThrow(
      /tmux pane %7 belongs to "other-session", not to session app-1/,
    );
    expect(mockExecFileCustom).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a job runs in the foreground", { 4242: [4242, 5000] as [number, number] }],
    ["/proc cannot tell", {}],
  ])("sends no key when %s", async (_name, stat) => {
    procStat = stat;
    mockTmuxSuccess("app-1 4242");

    await expect(create().runInPane!(makeHandle("app-1"), "%7", "true")).rejects.toThrow(
      /The shell of tmux pane %7 does not wait for input now/,
    );
    expect(mockExecFileCustom).toHaveBeenCalledTimes(1);
  });

  it("rejects a pane ID that is not a tmux pane ID without a tmux call", async () => {
    await expect(create().runInPane!(makeHandle("app-1"), "=app-1:", "true")).rejects.toThrow(
      /Invalid tmux pane ID/,
    );
    expect(mockExecFileCustom).not.toHaveBeenCalled();
  });

  it("rejects with the pane and the tmux failure as cause, and presses no Enter after a failed type", async () => {
    procStat = { 4242: [4242, 4242] };
    mockTmuxSuccess("app-1 4242");
    mockTmuxSuccess();
    mockTmuxSuccess();
    mockTmuxSuccess(AFTER_FIRST);
    mockTmuxSuccess();
    mockTmuxSuccess(AFTER_SECOND);
    mockTmuxFailure("send-keys", "can't find pane: %7\n");

    const err = await create().runInPane!(
      makeHandle("app-1"),
      "%7",
      "bash '/tmp/ao-launch-1.sh'",
    ).catch((e: unknown) => e);

    expect((err as Error).message).toBe("Failed to type the command into tmux pane %7");
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(mockExecFileCustom).toHaveBeenCalledTimes(7);
  });
});

describe("getOutput and sendMessage: the agent's pane (review r2 M-1)", () => {
  const bound: RuntimeHandle = { ...makeHandle("app-1"), data: { agentPane: "%5" } };

  it("captures the agent's pane when the handle names one, else the current pane", async () => {
    mockTmuxSuccess("agent screen");
    mockTmuxSuccess("current screen");

    expect(await create().getOutput(bound, 10)).toBe("agent screen");
    expect(await create().getOutput(makeHandle("app-1"), 10)).toBe("current screen");
    expect(mockExecFileCustom.mock.calls.map((call) => call[1])).toEqual([
      ["capture-pane", "-t", "%5", "-p", "-S", "-10"],
      ["capture-pane", "-t", "=app-1:", "-p", "-S", "-10"],
    ]);
  });

  it("sends a message to the agent's pane when the handle names one", async () => {
    mockExecFileCustom.mockResolvedValue({ stdout: "", stderr: "" });

    await create().sendMessage(bound, "hello");

    const targets = mockExecFileCustom.mock.calls.map((call) => call[1][2]);
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["%5"]));
  });
});

describe("freshPromptProblem: the evidence of a fresh, empty input line (review r2 M-2)", () => {
  it("accepts a new prompt line below the echo of the second C-c", () => {
    expect(freshPromptProblem(snap(AFTER_FIRST), snap(AFTER_SECOND))).toBeNull();
  });

  it("accepts the new prompt at the bottom row, scrolled by the line that the history gained", () => {
    const a = screen(
      { x: 10, y: 3, size: 7 },
      ["line7", "line8", "bash-5.2$ ^Cho tail", "bash-5.2$"],
      4,
    );
    const b = screen(
      { x: 10, y: 3, size: 8 },
      ["line8", "bash-5.2$ ^Cho tail", "bash-5.2$ ^C", "bash-5.2$"],
      4,
    );
    expect(freshPromptProblem(snap(a), snap(b))).toBeNull();
  });

  it("accepts a scroll when the history is full (its size stays at its limit)", () => {
    const a = screen(
      { x: 10, y: 3, size: 3, limit: 3 },
      ["line7", "line8", "bash-5.2$ ^Cho tail", "bash-5.2$"],
      4,
    );
    const b = screen(
      { x: 10, y: 3, size: 3, limit: 3 },
      ["line8", "bash-5.2$ ^Cho tail", "bash-5.2$ ^C", "bash-5.2$"],
      4,
    );
    expect(freshPromptProblem(snap(a), snap(b))).toBeNull();
  });

  it("accepts a prompt of two lines and a shell that does not echo ^C", () => {
    const a = screen({ x: 2, y: 2 }, ["$ ^Cowner", "~/repo", "$"]);
    const b = screen({ x: 2, y: 4 }, ["$ ^Cowner", "~/repo", "$", "~/repo", "$"]);
    expect(freshPromptProblem(snap(a), snap(b))).toBeNull();
  });

  it("refuses when the second C-c changed nothing (SIGINT ignored, text before the cursor)", () => {
    const a = screen({ x: 21, y: 0 }, ["bash-5.2$ touch owner"]);
    expect(freshPromptProblem(snap(a), snap(a))).toMatch(/changed nothing/);
  });

  it("refuses text after the cursor, a row without a prompt, and a mode", () => {
    expect(emptyPromptProblem(snap(screen({ x: 10, y: 0 }, ["bash-5.2$ ; touch owner"])))).toBe(
      "text after the cursor",
    );
    expect(emptyPromptProblem(snap(screen({ x: 0, y: 1 }, ["bash-5.2$ ^Cuch owner", ""])))).toBe(
      "no prompt before the cursor",
    );
    expect(emptyPromptProblem(snap(screen({ x: 10, y: 0, mode: 1 }, ["bash-5.2$"])))).toMatch(
      /mode/,
    );
  });

  it("refuses a later row whose text before the cursor is not the same prompt", () => {
    const b = screen({ x: 10, y: 2 }, [
      "bash-5.2$ ^Cuch owner-1; touch owner-2",
      "bash-5.2$ ^C",
      "other> xx",
    ]);
    expect(freshPromptProblem(snap(AFTER_FIRST), snap(b))).toMatch(/no new prompt line/);
  });

  it("refuses when a full history allows more than one reading of the scrolled screen", () => {
    // Every row above the cursor is the same, so no scroll and a scroll of
    // one line (with a prompt of two lines) both fit.
    const echo = "bash-5.2$ ^C";
    const a = screen({ x: 10, y: 2, size: 3, limit: 3 }, [echo, echo, "bash-5.2$"], 4);
    const b = screen({ x: 10, y: 3, size: 3, limit: 3 }, [echo, echo, echo, "bash-5.2$"], 4);
    expect(freshPromptProblem(snap(a), snap(b))).toMatch(/more than one way/);
  });

  it("parses only a cursor line and at most pane_height rows", () => {
    expect(parsePaneSnapshot("10 1 0 2000 2 0 0\nbash-5.2$\n\nextra")).toBeNull();
    expect(parsePaneSnapshot("10 x 0 2000 2 0 0\nbash-5.2$")).toBeNull();
    expect(parsePaneSnapshot("10 1 0 2000 2 0 0\na\nb")).toEqual({
      cursorX: 10,
      cursorY: 1,
      historySize: 0,
      historyLimit: 2000,
      plain: true,
      rows: ["a", "b"],
    });
  });
});
