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

import { create, TmuxProbeError } from "../index.js";

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
  it("targets the pane ID in every call: checks it, ends its mode, sends C-c, types the command literally, then Enter", async () => {
    procStat = { 4242: [4242, 4242] };
    mockTmuxSuccess("app-1 4242");
    mockTmuxSuccess();
    mockTmuxSuccess();
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
      ["tmux", ["send-keys", "-t", "%7", "-l", "bash '/tmp/ao-launch-1.sh'"], expectedTmuxOptions],
      ["tmux", ["send-keys", "-t", "%7", "Enter"], expectedTmuxOptions],
    ]);
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
    mockTmuxFailure("send-keys", "can't find pane: %7\n");

    const err = await create().runInPane!(
      makeHandle("app-1"),
      "%7",
      "bash '/tmp/ao-launch-1.sh'",
    ).catch((e: unknown) => e);

    expect((err as Error).message).toBe("Failed to type the command into tmux pane %7");
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(mockExecFileCustom).toHaveBeenCalledTimes(4);
  });
});
