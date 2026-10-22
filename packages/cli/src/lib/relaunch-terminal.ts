/**
 * Session relaunch (2026-10-22): the caller side of `ao session relaunch`.
 *
 * When the command runs in the session's own pane, `ao` is the pane's
 * foreground process, so keys typed into the pane would reach `ao` and not
 * the pane's shell. The agent then runs as a child of `ao` on the inherited
 * terminal, and `ao` waits for it. Core gives this caller only a launch
 * script that `exec`s the agent (review r1 M-2), so the child is the agent
 * itself: a signal that `ao` passes on reaches the agent, and the child ends
 * only when the agent ends.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readlinkSync } from "node:fs";
import { constants as osConstants } from "node:os";
import type { SessionRelaunchChild, SessionRelaunchLaunch } from "@aoagents/ao-core";

/** A terminal device path, for example `/dev/pts/4` or `/dev/tty1`. */
const TERMINAL_DEVICE = /^\/dev\/(?:pts\/\d+|tty[A-Za-z0-9]*)$/;

/**
 * The caller's terminal: the device of stdin, else of stderr, else of
 * stdout; null when none of them is a terminal. The comparison with the
 * pane's terminal is the only evidence of "in the session's own pane":
 * `AO_SESSION` and `TMUX` are inherited by any process that the pane starts.
 */
export function callerTerminal(readLink: (path: string) => string = readlinkSync): string | null {
  for (const fd of [0, 2, 1]) {
    try {
      const target = readLink(`/proc/self/fd/${fd}`);
      if (TERMINAL_DEVICE.test(target)) return target;
    } catch {
      // Not readable (no /proc, or the descriptor is closed): try the next one.
    }
  }
  return null;
}

/** The terminal signals that reach the whole foreground group: the child handles them. */
const IGNORED_SIGNALS = ["SIGINT", "SIGQUIT"] as const;

/** The signals that end `ao`: passed on to the child, then `ao` waits for it. */
const FORWARDED_SIGNALS = ["SIGTERM", "SIGHUP"] as const;

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Run the launch script as a child of `ao` on the inherited terminal (the
 * script execs the agent, so the child is the agent). While the child runs,
 * `ao` ignores SIGINT and SIGQUIT (the terminal sends them to the child too)
 * and passes SIGTERM and SIGHUP on to the child, and `ao` ends only after the
 * child ended, so the pane's shell never gets the terminal back while the
 * agent still runs. `exited` resolves with the child's exit code, 128 plus
 * the signal number when a signal ended it, or 127 when it could not start.
 */
export function runInCallerTerminal(
  launch: SessionRelaunchLaunch,
  spawn: Spawn = nodeSpawn,
): SessionRelaunchChild {
  const child = spawn("bash", [launch.script], { cwd: launch.cwd, stdio: "inherit" });
  const ignore = (): void => {};
  const forwarders = FORWARDED_SIGNALS.map((signal) => {
    const forward = (): void => {
      child.kill(signal);
    };
    process.on(signal, forward);
    return [signal, forward] as const;
  });
  for (const signal of IGNORED_SIGNALS) process.on(signal, ignore);

  const exited = new Promise<number>((resolve) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      for (const [signal, forward] of forwarders) process.removeListener(signal, forward);
      for (const signal of IGNORED_SIGNALS) process.removeListener(signal, ignore);
      resolve(code);
    };
    child.on("error", () => finish(127));
    child.on("exit", (code, signal) => {
      if (code !== null) finish(code);
      else finish(128 + (signal ? (osConstants.signals[signal] ?? 0) : 0));
    });
  });
  return { exited };
}
