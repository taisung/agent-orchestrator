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
import { RUNTIME_NO_SERVER_ERROR_CODE } from "./types.js";

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
 * herdr's answer that a pane does not exist: the code of its error envelope,
 * on stdout at exit 0 (0.8.0) or in the 0.9.5 failure form (readHerdrCliFailure).
 */
const PANE_NOT_FOUND_CODE = "pane_not_found";

/**
 * Herdr fit F-1: the `id` of herdr's error answer for each CLI call that AO
 * makes, by the first two words of the call (measured on 0.9.5,
 * development/artifacts/herdr_095_live_check). A call that is not in the
 * table gets no reading of its failure form.
 */
export const HERDR_CLI_IDS: Readonly<Record<string, string>> = Object.freeze({
  "pane get": "cli:pane:get",
  "pane process-info": "cli:pane:process_info",
  "pane read": "cli:pane:read",
  "pane run": "cli:request",
  "pane send-text": "cli:request",
  "pane send-keys": "cli:request",
  "agent prompt": "cli:agent:prompt",
  "workspace create": "cli:workspace:create",
});

/** The code and message of herdr's error answer in the 0.9.5 failure form. */
export interface HerdrCliFailure {
  code: string;
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Herdr fit F-1: herdr 0.9.5 answers an error with exit 1, empty stdout and
 * one stderr line `{"id":<command ID>,"error":{"code":...,"message":...}}`
 * (0.8.0 wrote the envelope to stdout with exit 0). This reads that form from
 * a rejection of `execFile`, and only that form: the exit code 1 with no
 * signal and no timeout (`killed`), stdout exactly empty, stderr one line
 * (one trailing `\n` at most, no `\r`) that is a JSON object with exactly the
 * keys `id` and `error`, `id` the expected command ID, and `error` an object
 * with exactly a non-empty text `code` and a text `message`. Any other
 * failure is null: the caller treats it as a check that could not run. The
 * herdr CLI drops trailing server lines, so this trusts the CLI's output, not
 * the server's wire.
 */
export function readHerdrCliFailure(err: unknown, expectedId: string): HerdrCliFailure | null {
  if (!expectedId || !isPlainObject(err)) return null;
  if (err.code !== 1 || (err.signal !== undefined && err.signal !== null)) return null;
  if (err.killed === true || err.stdout !== "" || typeof err.stderr !== "string") return null;
  const line = err.stderr.endsWith("\n") ? err.stderr.slice(0, -1) : err.stderr;
  if (line.includes("\n") || line.includes("\r")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !hasExactlyKeys(parsed, ["id", "error"])) return null;
  if (parsed.id !== expectedId) return null;
  const error = parsed.error;
  if (!isPlainObject(error) || !hasExactlyKeys(error, ["code", "message"])) return null;
  if (typeof error.code !== "string" || !error.code || typeof error.message !== "string") {
    return null;
  }
  return { code: error.code, message: error.message };
}

/** The message with which the herdr CLI says that no server answers at its socket. */
const HERDR_NO_SERVER_PREFIX = "no herdr server is running at ";

/**
 * Herdr fit F-1: the CLI's own answer that no server listens at the selected
 * socket (`server_not_running` with its message prefix). A server that sends
 * `server_not_running` itself has another message, and is not this answer.
 */
export function isHerdrNoServer(failure: HerdrCliFailure | null): boolean {
  return (
    failure?.code === "server_not_running" && failure.message.startsWith(HERDR_NO_SERVER_PREFIX)
  );
}

/** Herdr fit F-2: herdr's pane ID grammar, `w<n>:p<m>` in bijective base 32. */
export const HERDR_PANE_ID_RE = /^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$/;

/**
 * Herdr fit F-2: true only for an ID in herdr's pane ID grammar (the alphabet
 * `123456789ABCDEFGHJKMNPQRSTVWXYZ0`, lowercase `w` and `p`, nothing else). AO
 * makes no herdr call with any other ID: a session name (the handle that
 * core makes for a record without one) names no pane.
 */
export function isHerdrPaneId(id: unknown): id is string {
  return typeof id === "string" && HERDR_PANE_ID_RE.test(id);
}

/**
 * A malformed or failed answer of `herdr pane process-info`: the check could
 * not run. An answer in the 0.9.5 failure form keeps its `herdrCode`, and the
 * CLI's no-server answer has `code` RUNTIME_NO_SERVER_ERROR_CODE.
 */
function herdrCannotAnswer(
  paneId: string,
  detail: string,
  cause?: unknown,
  failure?: HerdrCliFailure,
): Error {
  const err = new Error(
    `herdr pane process-info --pane ${paneId} could not answer: ${detail}`,
    cause === undefined ? undefined : { cause },
  );
  if (!failure) return err;
  return Object.assign(
    err,
    { herdrCode: failure.code },
    isHerdrNoServer(failure) ? { code: RUNTIME_NO_SERVER_ERROR_CODE } : {},
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
 * Round 3 (M-3): `pane_not_found` counts only in an answer without a
 * result, and a list counts only when its `process_info.pane_id` (when the
 * answer has one) is the requested pane.
 * Herdr fit F-1: `pane_not_found` in the 0.9.5 failure form (exit 1, the
 * stderr line with the ID `cli:pane:process_info`) is the same answer; the
 * CLI's no-server answer rejects with `code` RUNTIME_NO_SERVER_ERROR_CODE.
 * F-2: a non-empty ID outside herdr's pane ID grammar rejects with no call.
 * Callers treat the rejection as unknown, never as "nothing running".
 */
export async function getHerdrPaneProcesses(paneId: string): Promise<HerdrPaneProcess[]> {
  if (!paneId) return [];
  if (!isHerdrPaneId(paneId)) {
    throw new Error(
      `herdr pane process-info: ${JSON.stringify(paneId)} is not a herdr pane ID; no herdr call was made`,
    );
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("herdr", ["pane", "process-info", "--pane", paneId], {
      timeout: HERDR_COMMAND_TIMEOUT_MS,
    }));
  } catch (err) {
    const failure = readHerdrCliFailure(err, HERDR_CLI_IDS["pane process-info"]);
    if (failure?.code === PANE_NOT_FOUND_CODE) return [];
    if (failure) {
      throw herdrCannotAnswer(
        paneId,
        `herdr error ${failure.code}: ${failure.message}`,
        err,
        failure,
      );
    }
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

  // herdr 0.8.0 reports failures in the body with exit code 0, so an `error`
  // key here means the pane lookup failed rather than succeeded with no
  // processes (0.9.5 exits 1 with the envelope on stderr, read above).
  // Round 3 (M-3): an answer with both an error and a result contradicts
  // itself, so neither part is evidence.
  const envelope = parsed as Record<string, unknown>;
  const hasResult = envelope.result !== undefined && envelope.result !== null;
  if (envelope.error !== undefined && envelope.error !== null) {
    if (hasResult) throw herdrCannotAnswer(paneId, "the answer has both an error and a result");
    if (typeof envelope.error !== "object" || Array.isArray(envelope.error)) {
      throw herdrCannotAnswer(paneId, "the answer has an error that is not an object");
    }
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

  // Round 3 (M-3): the list is evidence about the requested pane only. An
  // answer that names its pane (`pane_id`, as herdr does) must name this one.
  const infoPaneId = (info as Record<string, unknown>).pane_id;
  if (infoPaneId !== undefined && infoPaneId !== paneId) {
    throw herdrCannotAnswer(paneId, `the answer is for pane ${JSON.stringify(infoPaneId)}`);
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
