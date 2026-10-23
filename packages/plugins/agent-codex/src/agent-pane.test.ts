/**
 * Session relaunch (2026-10-22), review r2 M-1: the process check of
 * codex reads the agent's own pane when core names it
 * (`RuntimeHandle.data.agentPane`, the pane that the record binds to its
 * last launch), never the session's current window, which the owner can
 * change. A handle that names no pane is read as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as NodeChildProcess from "node:child_process";
import { AGENT_PANE_FORMAT, type RuntimeHandle } from "@aoagents/ao-core";

const { mockExecFileAsync } = vi.hoisted(() => ({ mockExecFileAsync: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  const fn = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { ...actual, execFile: fn };
});

import { create } from "./index.js";

const agent = create();

/** `ps -eo pid,tty,args`: the agent on pts/5, a shell on pts/4. */
const PS = [
  "    PID TT       COMMAND",
  "      1 ?        /sbin/init splash",
  "   4242 pts/4    -bash",
  "   4301 pts/5    codex --model x",
  "",
].join("\n");

function handle(data: Record<string, unknown> = { agentPane: "%2" }): RuntimeHandle {
  return { id: "app-1", runtimeName: "tmux", data };
}

/** tmux answers `listPanes()` for list-panes, ps answers PS. */
function answer(listPanes: () => Promise<{ stdout: string; stderr: string }>): void {
  mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "tmux" && args[0] === "list-panes") return listPanes();
    if (cmd === "ps") return Promise.resolve({ stdout: PS, stderr: "" });
    return Promise.reject(new Error(`unexpected: ${cmd} ${args.join(" ")}`));
  });
}

function panes(stdout: string): () => Promise<{ stdout: string; stderr: string }> {
  return () => Promise.resolve({ stdout, stderr: "" });
}

/** A failed tmux call, with the fields that execFile sets. */
function tmuxFailure(stderr: string): () => Promise<never> {
  return () =>
    Promise.reject(
      Object.assign(new Error("Command failed: tmux list-panes"), {
        code: 1,
        signal: null,
        killed: false,
        stderr,
      }),
    );
}

function listPanesCalls(): unknown[] {
  return mockExecFileAsync.mock.calls
    .filter((call: unknown[]) => call[0] === "tmux")
    .map((call: unknown[]) => call[1]);
}

beforeEach(() => {
  mockExecFileAsync.mockReset();
});

describe("codex isProcessRunning: the agent's pane (review r2 M-1)", () => {
  it("reads only the agent's pane by its ID and finds the agent on that pane's terminal", async () => {
    answer(panes("%1 app-1 /dev/pts/4\n%2 app-1 /dev/pts/5\n"));

    expect(await agent.isProcessRunning(handle())).toBe(true);
    expect(listPanesCalls()).toEqual([["list-panes", "-t", "%2", "-F", AGENT_PANE_FORMAT]]);
  });

  it("answers false when the agent runs only on another pane of the window", async () => {
    answer(panes("%2 app-1 /dev/pts/4\n%7 app-1 /dev/pts/5\n"));

    expect(await agent.isProcessRunning(handle())).toBe(false);
  });

  it("answers false when tmux answers that the agent's pane does not exist", async () => {
    answer(tmuxFailure("can't find pane: %2\n"));

    expect(await agent.isProcessRunning(handle())).toBe(false);
  });

  it("answers false when the agent's pane now belongs to another session", async () => {
    answer(panes("%2 other /dev/pts/5\n"));

    expect(await agent.isProcessRunning(handle())).toBe(false);
  });

  it.each([
    ["an answer without the pane", panes("%3 app-1 /dev/pts/5\n")],
    ["a malformed answer", panes("/dev/pts/5\n")],
    ["an empty answer", panes("")],
    ["a missing pane of another ID", tmuxFailure("can't find pane: %9\n")],
    ["no tmux server", tmuxFailure("no server running on /tmp/tmux-1000/default\n")],
  ])("rejects %s", async (_name, listPanes) => {
    answer(listPanes);

    await expect(agent.isProcessRunning(handle())).rejects.toThrow();
  });

  it("reads the session's current window as before when the handle names no pane", async () => {
    answer(panes("/dev/pts/5\n"));

    expect(await agent.isProcessRunning(handle({}))).toBe(true);
    expect(listPanesCalls()).toEqual([["list-panes", "-t", "=app-1:", "-F", "#{pane_tty}"]]);
  });
});
