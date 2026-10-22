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

/** herdr's answer that a pane does not exist: the code of its error envelope (exit 0). */
const PANE_NOT_FOUND_CODE = "pane_not_found";

/** A malformed or failed answer of `herdr pane process-info`: the check could not run. */
function herdrCannotAnswer(paneId: string, detail: string, cause?: unknown): Error {
  return new Error(
    `herdr pane process-info --pane ${paneId} could not answer: ${detail}`,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * List the foreground processes running in a herdr pane.
 *
 * Same-ID R4 (B-7 item 8): an empty array only for herdr's explicit
 * `pane_not_found` and for a valid empty process list. Every other answer
 * rejects with the cause, because the check could not run: herdr cannot
 * start, a timeout or a signal, text that is not JSON, another error
 * envelope, a reply without `result.process_info.foreground_processes` as a
 * list, and an entry of that list that is not an object or has no name and
 * no command line (it may be the agent).
 * Round 2 (M-3): `pane_not_found` counts only as the `code` of the error
 * envelope of a command that exits 0, never as text: a command that fails
 * rejects whatever its message or binary path holds. An entry with a field
 * of the wrong type (`pid` not a positive integer, `name` or `cmdline` not a
 * string, `argv` not a list of strings) rejects the whole reply.
 * Callers treat the rejection as unknown, never as "nothing running".
 */
export async function getHerdrPaneProcesses(paneId: string): Promise<HerdrPaneProcess[]> {
  if (!paneId) return [];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("herdr", ["pane", "process-info", "--pane", paneId], {
      timeout: HERDR_COMMAND_TIMEOUT_MS,
    }));
  } catch (err) {
    throw herdrCannotAnswer(paneId, "the command failed", err);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (err) {
    throw herdrCannotAnswer(paneId, "the answer is not JSON", err);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw herdrCannotAnswer(paneId, "the answer is not an object");
  }

  // herdr reports failures in the body with exit code 0, so an `error` key here
  // means the pane lookup failed rather than succeeded with no processes.
  const envelope = parsed as Record<string, unknown>;
  if (envelope.error) {
    const error = envelope.error as Record<string, unknown>;
    if (error.code === PANE_NOT_FOUND_CODE) return [];
    throw herdrCannotAnswer(
      paneId,
      `herdr error ${String(error.code ?? "unknown")}: ${String(error.message ?? "")}`,
    );
  }

  const result = envelope.result;
  if (typeof result !== "object" || result === null) {
    throw herdrCannotAnswer(paneId, "the answer has no result");
  }

  const info = (result as Record<string, unknown>).process_info;
  if (typeof info !== "object" || info === null) {
    throw herdrCannotAnswer(paneId, "the answer has no process_info");
  }

  const raw = (info as Record<string, unknown>).foreground_processes;
  if (!Array.isArray(raw)) {
    throw herdrCannotAnswer(paneId, "the answer has no list of foreground_processes");
  }

  const processes: HerdrPaneProcess[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      throw herdrCannotAnswer(paneId, "a foreground process is not an object");
    }
    const proc = entry as RawProcess;
    if (typeof proc.pid !== "number" || !Number.isSafeInteger(proc.pid) || proc.pid <= 0) {
      throw herdrCannotAnswer(paneId, "a foreground process has no valid pid");
    }
    if (proc.name !== undefined && typeof proc.name !== "string") {
      throw herdrCannotAnswer(paneId, "a foreground process has a name that is not text");
    }
    if (proc.cmdline !== undefined && typeof proc.cmdline !== "string") {
      throw herdrCannotAnswer(paneId, "a foreground process has a cmdline that is not text");
    }
    if (
      proc.argv !== undefined &&
      !(Array.isArray(proc.argv) && proc.argv.every((a) => typeof a === "string"))
    ) {
      throw herdrCannotAnswer(
        paneId,
        "a foreground process has an argv that is not a list of text",
      );
    }

    const name = typeof proc.name === "string" ? proc.name : "";
    const cmdline =
      typeof proc.cmdline === "string"
        ? proc.cmdline
        : Array.isArray(proc.argv)
          ? proc.argv.join(" ")
          : "";
    const pid = proc.pid;

    if (!name && !cmdline) {
      throw herdrCannotAnswer(paneId, "a foreground process has no name and no command line");
    }
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
 * False only when herdr answered (`pane_not_found`, or a list without the
 * agent); rejects when the check could not run (see getHerdrPaneProcesses).
 */
export async function isHerdrProcessRunning(paneId: string, processRe: RegExp): Promise<boolean> {
  const processes = await getHerdrPaneProcesses(paneId);
  return processes.some((proc) => processRe.test(proc.cmdline) || processRe.test(proc.name));
}
