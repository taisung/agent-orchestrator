/**
 * The tmux foreground read of `send` (same-ID design, round R1). It reads
 * `#{pane_current_command}` with an exact pane target, and empty output
 * means that the session is gone: tmux 3.4 prints empty format values and
 * exits 0 for a target that does not exist. A gone pane never counts as
 * ready; a read that tmux could not answer does not hold the wait.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as ChildProcess from "node:child_process";

/** `tmux display-message` answers with `foreground`, or fails when it is an Error. */
const proc = vi.hoisted(() => ({
  calls: [] as string[][],
  foreground: "" as string | Error,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const run = (cmd: string, args: string[]): string => {
    if (cmd === "tmux" && args[0] === "display-message") {
      proc.calls.push(args);
      if (proc.foreground instanceof Error) throw proc.foreground;
      return proc.foreground;
    }
    throw Object.assign(new Error(`unexpected command: ${cmd} ${args.join(" ")}`), {
      code: "ENOENT",
    });
  };
  const execFile = ((cmd: string, args: string[], ...rest: unknown[]) => {
    const callback = rest.find((r) => typeof r === "function") as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    queueMicrotask(() => {
      try {
        callback?.(null, run(cmd, args), "");
      } catch (err) {
        callback?.(err as Error, "", "");
      }
    });
  }) as unknown as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => ({ stdout: run(cmd, args), stderr: "" }),
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import { createSessionManager } from "../../session-manager.js";
import { updateMetadata, writeMetadata } from "../../metadata.js";
import { setupTestContext, teardownTestContext, type TestContext } from "../test-utils.js";

let ctx: TestContext;

/** The launch of a relaunch that bound the pane %5. */
const BOUND_LAUNCH = "5e0c2b7a-1d3f-4a6b-9c8d-7e6f5a4b3c2d";

beforeEach(() => {
  ctx = setupTestContext();
  proc.calls = [];
  // A spawning session on tmux whose runtime and agent answer "running".
  writeMetadata(ctx.sessionsDir, "app-1", {
    worktree: "/tmp",
    branch: "main",
    status: "spawning",
    project: "my-app",
    runtimeHandle: JSON.stringify({ id: "rt-1", runtimeName: "tmux", data: {} }),
  });
  vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
  vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(true);
  vi.mocked(ctx.mockRuntime.getOutput).mockResolvedValue("agent ready");
});

afterEach(() => {
  vi.useRealTimers();
  teardownTestContext(ctx);
});

/** Start a send, then report whether runtime.sendMessage ran within `ms`. */
async function sentWithin(ms: number): Promise<{ sent: boolean; done: Promise<void> }> {
  vi.useFakeTimers();
  const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
  const done = sm.send("app-1", "hello");
  await vi.advanceTimersByTimeAsync(ms);
  return { sent: vi.mocked(ctx.mockRuntime.sendMessage).mock.calls.length > 0, done };
}

describe("send: the tmux foreground read before delivery", () => {
  it("reads the foreground command of the exact pane", async () => {
    proc.foreground = `${ctx.mockAgent.processName}\n`;

    const { done } = await sentWithin(5_000);
    await done;

    expect(proc.calls[0]).toEqual([
      "display-message",
      "-p",
      "-t",
      "=rt-1:",
      "#{pane_current_command}",
    ]);
  });

  it("reads and sends to the pane that a relaunch bound, not the current window (review r2 M-1)", async () => {
    // The binding of a relaunch: the token and the pane of the last launch.
    const at = new Date(Date.now() - 3_600_000).toISOString();
    updateMetadata(ctx.sessionsDir, "app-1", {
      createdAt: at,
      restoredAt: at,
      launchToken: BOUND_LAUNCH,
      launchTokenAt: at,
      launchPane: "%5",
    });
    proc.foreground = `${ctx.mockAgent.processName}\n`;

    const { done } = await sentWithin(5_000);
    await done;

    expect(proc.calls[0]).toEqual(["display-message", "-p", "-t", "%5", "#{pane_current_command}"]);
    const handle = vi.mocked(ctx.mockRuntime.sendMessage).mock.calls[0][0];
    expect(handle.data["agentPane"]).toBe("%5");
    expect(vi.mocked(ctx.mockAgent.isProcessRunning).mock.calls[0][0].data["agentPane"]).toBe("%5");
  });

  it("delivers once the agent runs in the foreground", async () => {
    proc.foreground = `${ctx.mockAgent.processName}\n`;

    const { sent, done } = await sentWithin(5_000);
    await done;

    expect(sent).toBe(true);
  });

  it("keeps waiting while tmux prints empty output for the pane (the session is gone)", async () => {
    proc.foreground = "\n";

    const { sent, done } = await sentWithin(10_000);
    expect(sent).toBe(false);

    // The wait still ends at its bound (20 s), as for any pane that is not ready.
    await vi.advanceTimersByTimeAsync(15_000);
    await done;
    expect(ctx.mockRuntime.sendMessage).toHaveBeenCalled();
  });

  it("does not hold the wait when tmux cannot answer", async () => {
    proc.foreground = Object.assign(new Error("Command failed: tmux display-message"), {
      code: 1,
      stderr: "no server running on /tmp/tmux-1000/default\n",
    });

    const { sent, done } = await sentWithin(5_000);
    await done;

    expect(sent).toBe(true);
  });
});
