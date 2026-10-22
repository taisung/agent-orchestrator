import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getHerdrPaneProcesses, type RuntimeHandle, type Session } from "@aoagents/ao-core";

// F-6: `isProcessRunning` answers false only for explicit, well-formed
// evidence of absence (the forms of same-ID R4 for the other agents). Every
// other answer rejects with the cause, and callers read the rejection as
// unknown, so the lifecycle never writes `killed` for a live session because
// a check gave a malformed or ambiguous answer.

const { mockExecFileAsync } = vi.hoisted(() => ({ mockExecFileAsync: vi.fn() }));

vi.mock("node:child_process", () => {
  const fn = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { execFile: fn };
});

import { create, resetPsCache } from "./index.js";

const agent = create();

function tmuxHandle(id = "app-1"): RuntimeHandle {
  return { id, runtimeName: "tmux", data: {} };
}

function herdrHandle(id = "w8:p1"): RuntimeHandle {
  return { id, runtimeName: "herdr", data: { workspaceId: "w8", terminalId: "term_abc" } };
}

function pidHandle(pid: unknown): RuntimeHandle {
  return { id: "proc-1", runtimeName: "process", data: pid === undefined ? {} : { pid } };
}

/** A failed `tmux list-panes`, with the fields that execFile sets. */
function tmuxFailure(fields: Record<string, unknown>): Error {
  return Object.assign(new Error("Command failed: tmux list-panes"), fields);
}

/** The header of `ps -eo pid,tty,args` from procps on Linux. */
const PS_HEADER = "    PID TT       COMMAND";

function psReply(rows: string[], header = PS_HEADER): string {
  return [header, ...rows].join("\n") + "\n";
}

const PS_WITHOUT_CLAUDE = psReply([
  "      1 ?        /sbin/init splash",
  "   4242 pts/4    -bash",
  "   4300 pts/5    /usr/bin/claude-code --help",
]);
const PS_WITH_CLAUDE = psReply([
  "      1 ?        /sbin/init splash",
  "   4242 pts/4    -bash",
  "   4301 pts/4    claude --dangerously-skip-permissions",
]);

/** tmux answers `ttyOut` for list-panes, and ps answers `psOut`. */
function mockPane(ttyOut: string, psOut: string): void {
  mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "tmux" && args[0] === "list-panes") {
      return Promise.resolve({ stdout: ttyOut, stderr: "" });
    }
    if (cmd === "ps") return Promise.resolve({ stdout: psOut, stderr: "" });
    return Promise.reject(new Error(`unexpected: ${cmd} ${args.join(" ")}`));
  });
}

function psCalls(): number {
  return mockExecFileAsync.mock.calls.filter((call: unknown[]) => call[0] === "ps").length;
}

/** The JSON reply of `herdr pane process-info` with these foreground processes. */
function herdrReply(processes: unknown[]): { stdout: string; stderr: string } {
  return {
    stdout: JSON.stringify({
      id: "cli:pane:process_info",
      result: { process_info: { foreground_processes: processes }, type: "pane_process_info" },
    }),
    stderr: "",
  };
}

beforeEach(() => {
  mockExecFileAsync.mockReset();
  resetPsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isProcessRunning: tmux list-panes (F-6)", () => {
  it.each([
    ["can't find session: app-1\n"],
    ["can't find session: app-1"],
    ["no current target\n"],
  ])(
    "control: exit code 1 and the whole answer %j answer false, with no ps call",
    async (stderr) => {
      mockExecFileAsync.mockRejectedValue(tmuxFailure({ code: 1, stderr }));
      expect(await agent.isProcessRunning(tmuxHandle())).toBe(false);
      expect(psCalls()).toBe(0);
    },
  );

  it.each([
    ["the line names another session", { code: 1, stderr: "can't find session: app-10\n" }],
    [
      "can't find window, which tmux answers only for a window target",
      { code: 1, stderr: "can't find window: app-1\n" },
    ],
    ["can't find pane", { code: 1, stderr: "can't find pane: app-1\n" }],
    [
      "the line among other lines",
      { code: 1, stderr: "warning: one\ncan't find session: app-1\n" },
    ],
    ["the line with a second newline", { code: 1, stderr: "can't find session: app-1\n\n" }],
    ["exit code 2", { code: 2, stderr: "can't find session: app-1\n" }],
    [
      "no exit code: killed at the timeout",
      { code: null, signal: "SIGTERM", killed: true, stderr: "can't find session: app-1\n" },
    ],
    ["a signal", { code: 1, signal: "SIGKILL", stderr: "can't find session: app-1\n" }],
    ["killed", { code: 1, killed: true, stderr: "can't find session: app-1\n" }],
    ["no stderr", { code: 1 }],
    ["no server", { code: 1, stderr: "no server running on /tmp/tmux-1000/default\n" }],
    [
      "no socket",
      {
        code: 1,
        stderr: "error connecting to /tmp/tmux-1000/default (No such file or directory)\n",
      },
    ],
    ["tmux cannot start", { code: "ENOENT" }],
  ])("rejects with the cause when tmux fails with %s", async (_, fields) => {
    const failure = tmuxFailure(fields);
    mockExecFileAsync.mockRejectedValue(failure);
    await expect(agent.isProcessRunning(tmuxHandle())).rejects.toMatchObject({
      message: "claude-code: tmux list-panes -t =app-1: failed",
      cause: failure,
    });
    expect(psCalls()).toBe(0);
  });

  it.each([
    ["an empty answer", ""],
    ["a blank line", "\n"],
    ["a TTY name that is not a path", "pts/4\n"],
    ["a TTY path and other text", "/dev/pts/4\nwarning: one\n"],
    ["an empty line between two TTY paths", "/dev/pts/4\n\n/dev/pts/5\n"],
  ])("rejects %s of a successful list-panes, with no ps call", async (_, ttyOut) => {
    // The ps reply has claude on pts/4: a pass must not come from the scan.
    mockPane(ttyOut, PS_WITH_CLAUDE);
    await expect(agent.isProcessRunning(tmuxHandle())).rejects.toThrow("not a list of pane TTYs");
    expect(psCalls()).toBe(0);
  });

  it("control: a valid list on a Linux pane TTY without claude answers false", async () => {
    mockPane("/dev/pts/4\n", PS_WITHOUT_CLAUDE);
    expect(await agent.isProcessRunning(tmuxHandle())).toBe(false);
  });

  it("control: a valid list with claude on a pane TTY answers true, also on the second pane", async () => {
    mockPane("/dev/pts/4\n", PS_WITH_CLAUDE);
    expect(await agent.isProcessRunning(tmuxHandle())).toBe(true);

    resetPsCache();
    mockPane("/dev/pts/9\n/dev/pts/4\n", PS_WITH_CLAUDE);
    expect(await agent.isProcessRunning(tmuxHandle())).toBe(true);
  });
});

describe("isProcessRunning: the ps reply (F-6)", () => {
  it.each([
    ["an empty reply", ""],
    ["a header only", psReply([])],
    ["rows with no header", "   4242 pts/4    -bash\n"],
    ["another header", psReply(["   4242 pts/4    -bash"], "  UID   PID TT  COMMAND")],
    ["a malformed row", psReply(["   4242 pts/4    -bash", "garbage"])],
    ["a row with no arguments", psReply(["   4242 pts/4    -bash", "   4243 pts/4"])],
    ["a blank row between rows", psReply(["   4242 pts/4    -bash", "", "   4243 pts/5    vim"])],
    ["a row with PID 0", psReply(["      0 pts/4    -bash"])],
    ["a negative PID", psReply(["     -5 pts/4    -bash"])],
    ["a PID with a leading zero", psReply(["  04242 pts/4    -bash"])],
    ["a PID too large to be exact", psReply(["123456789012345678901 pts/4 -bash"])],
  ])("rejects %s, which is not a process list", async (_, psOut) => {
    // No row names claude: the old scan read each of these as "no process".
    mockPane("/dev/pts/4\n", psOut);
    await expect(agent.isProcessRunning(tmuxHandle())).rejects.toThrow(
      "claude-code: ps -eo pid,tty,args answered a reply that is not a process list",
    );
  });

  it.each([
    ["procps (Linux)", "    PID TT       COMMAND"],
    ["BSD", "  PID TTY      ARGS"],
    ["CMD", "  PID TT  CMD"],
  ])("control: reads the %s header", async (_, header) => {
    mockPane(
      "/dev/pts/4\n",
      psReply(["   4301 pts/4    /usr/local/bin/claude --resume x"], header),
    );
    expect(await agent.isProcessRunning(tmuxHandle())).toBe(true);

    resetPsCache();
    mockPane("/dev/pts/4\n", psReply(["   4242 pts/4    -bash"], header));
    expect(await agent.isProcessRunning(tmuxHandle())).toBe(false);
  });
});

describe("isProcessRunning: the Herdr pane list (F-6)", () => {
  it.each([
    ["no PID", { cmdline: "claude --model sonnet", name: "claude" }],
    ["PID 0", { cmdline: "claude --model sonnet", name: "claude", pid: 0 }],
    ["a PID that is text", { cmdline: "claude --model sonnet", name: "claude", pid: "42" }],
  ])("never reads a claude process with %s as no process", async (_, proc) => {
    // Core decides whether such a list is valid: this core gives PID 0 for
    // the entry, and the core of same-ID R4 rejects the whole reply. The
    // plugin answers true for the first and rejects with the second, never
    // false.
    mockExecFileAsync.mockResolvedValueOnce(herdrReply([proc]));
    const coreReadsList = await getHerdrPaneProcesses("w8:p1").then(
      () => true,
      () => false,
    );
    mockExecFileAsync.mockResolvedValueOnce(herdrReply([proc]));
    if (coreReadsList) {
      expect(await agent.isProcessRunning(herdrHandle())).toBe(true);
    } else {
      await expect(agent.isProcessRunning(herdrHandle())).rejects.toThrow();
    }
  });

  it("control: a claude process with a PID answers true, and a list without claude false", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      herdrReply([{ cmdline: "claude --model sonnet", name: "claude", pid: 42 }]),
    );
    expect(await agent.isProcessRunning(herdrHandle())).toBe(true);

    mockExecFileAsync.mockResolvedValueOnce(
      herdrReply([{ cmdline: "bash", name: "bash", pid: 7 }]),
    );
    expect(await agent.isProcessRunning(herdrHandle())).toBe(false);
  });
});

describe("isProcessRunning: a handle with no pane, and a stored PID (F-6)", () => {
  it.each([
    ["a tmux handle", { id: "", runtimeName: "tmux", data: {} }],
    ["a Herdr handle", { id: "", runtimeName: "herdr", data: {} }],
  ])("rejects %s with an empty ID: the check cannot run", async (_, handle) => {
    const kill = vi.spyOn(process, "kill");
    await expect(agent.isProcessRunning(handle as RuntimeHandle)).rejects.toThrow(
      "claude-code: no pane and no valid PID to check",
    );
    expect(kill).not.toHaveBeenCalled();
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it.each([
    ["no PID", undefined],
    ["PID 0", 0],
    ["a negative PID", -1],
    ["a PID that is not an integer", 1.5],
    ["NaN", Number.NaN],
    ["a PID too large to be exact", Number.MAX_SAFE_INTEGER + 2],
    ["empty text", ""],
    ["text that is not a number", "abc"],
    ["text 0", "0"],
    ["text with a leading zero", "012"],
    ["text with a space", " 12"],
    ["text in exponent form", "1e3"],
  ])("rejects %s without a signal: the check cannot run", async (_, pid) => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    await expect(agent.isProcessRunning(pidHandle(pid))).rejects.toThrow(
      "claude-code: no pane and no valid PID to check",
    );
    expect(kill).not.toHaveBeenCalled();
  });

  it("control: ESRCH answers false, EPERM and a delivered signal 0 answer true", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    expect(await agent.isProcessRunning(pidHandle(4242))).toBe(false);

    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    });
    expect(await agent.isProcessRunning(pidHandle(4242))).toBe(true);

    kill.mockImplementationOnce(() => true);
    expect(await agent.isProcessRunning(pidHandle("4242"))).toBe(true);
    expect(kill).toHaveBeenLastCalledWith(4242, 0);
  });

  it.each([
    ["another error code", Object.assign(new Error("kill EINVAL"), { code: "EINVAL" })],
    ["an error with no code", new Error("ESRCH")],
    ["a value that is not an error", "ESRCH"],
  ])("rejects with the cause when signal 0 fails with %s", async (_, thrown) => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw thrown;
    });
    await expect(agent.isProcessRunning(pidHandle(4242))).rejects.toMatchObject({
      message: "claude-code: kill(4242, 0) failed",
      cause: thrown,
    });
  });
});

describe("getActivityState with a malformed process answer (F-6)", () => {
  function session(): Session {
    return {
      id: "app-1",
      projectId: "app",
      status: "working",
      activity: "active",
      branch: "feat/x",
      issueId: null,
      pr: null,
      workspacePath: "/workspace/app",
      runtimeHandle: tmuxHandle(),
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    };
  }

  it("answers null (unknown), not exited, when ps answers a reply that is not a process list", async () => {
    mockPane("/dev/pts/4\n", psReply([]));
    expect(await agent.getActivityState(session())).toBeNull();
  });

  it("answers null (unknown), not exited, when tmux names another session", async () => {
    mockExecFileAsync.mockRejectedValue(
      tmuxFailure({ code: 1, stderr: "can't find session: app-10\n" }),
    );
    expect(await agent.getActivityState(session())).toBeNull();
  });

  it("control: answers exited for a valid list without claude", async () => {
    mockPane("/dev/pts/4\n", PS_WITHOUT_CLAUDE);
    expect(await agent.getActivityState(session())).toMatchObject({ state: "exited" });
  });
});
