/**
 * herdr command wrappers — process introspection for the herdr runtime.
 *
 * Agent plugins decide whether their process is alive by inspecting the runtime
 * handle. Under tmux they resolve the pane TTY and scan `ps`; under the process
 * runtime they signal a stored PID. herdr exposes the foreground processes of a
 * pane directly, so neither approach applies and a herdr handle would otherwise
 * fall through to the PID branch, find nothing, and report every session exited.
 *
 * Uses child_process.execFile for safe command execution (no shell injection).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HERDR_COMMAND_TIMEOUT_MS = 10_000;

/** Runtime name used by the herdr runtime plugin's handles. */
export const HERDR_RUNTIME_NAME = "herdr";

/** A single foreground process reported for a herdr pane. */
export interface HerdrPaneProcess {
  pid: number;
  name: string;
  cmdline: string;
}

interface RawProcess {
  pid?: unknown;
  name?: unknown;
  cmdline?: unknown;
  argv?: unknown;
}

/**
 * List the foreground processes running in a herdr pane.
 *
 * Returns an empty array when herdr is unavailable, the pane is gone, or the
 * response cannot be parsed — callers treat that as "nothing running".
 */
export async function getHerdrPaneProcesses(paneId: string): Promise<HerdrPaneProcess[]> {
  if (!paneId) return [];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("herdr", ["pane", "process-info", "--pane", paneId], {
      timeout: HERDR_COMMAND_TIMEOUT_MS,
    }));
  } catch {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];

  // herdr reports failures in the body with exit code 0, so an `error` key here
  // means the pane lookup failed rather than succeeded with no processes.
  const envelope = parsed as Record<string, unknown>;
  if (envelope.error) return [];

  const result = envelope.result;
  if (typeof result !== "object" || result === null) return [];

  const info = (result as Record<string, unknown>).process_info;
  if (typeof info !== "object" || info === null) return [];

  const raw = (info as Record<string, unknown>).foreground_processes;
  if (!Array.isArray(raw)) return [];

  const processes: HerdrPaneProcess[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const proc = entry as RawProcess;

    const name = typeof proc.name === "string" ? proc.name : "";
    const cmdline =
      typeof proc.cmdline === "string"
        ? proc.cmdline
        : Array.isArray(proc.argv)
          ? proc.argv.filter((a): a is string => typeof a === "string").join(" ")
          : "";
    const pid = typeof proc.pid === "number" ? proc.pid : 0;

    if (!name && !cmdline) continue;
    processes.push({ pid, name, cmdline });
  }

  return processes;
}

/**
 * Check whether a process matching `processRe` is running in a herdr pane.
 *
 * `processRe` is the same regex agent plugins apply to `ps` output under tmux —
 * it is tested against each process's full command line, and against the bare
 * process name so agents installed under a dot-prefixed binary still match.
 */
export async function isHerdrProcessRunning(paneId: string, processRe: RegExp): Promise<boolean> {
  const processes = await getHerdrPaneProcesses(paneId);
  return processes.some((proc) => processRe.test(proc.cmdline) || processRe.test(proc.name));
}
