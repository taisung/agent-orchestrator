/**
 * One OpenCode API helper in core, used by core and by the OpenCode plugin
 * (owner Q2 of note 0009).
 *
 * It runs `opencode api <operation>` with `execFile` (never a shell string),
 * parses the JSON, returns `null` for a 404 (a session that does not exist),
 * and throws every other error with `cause`.
 *
 * Safety properties (0009 section 2, 0010 section 11.1):
 * - Every call has a bounded timeout (`OPENCODE_API_TIMEOUT_MS` by default).
 *   Callers treat a timeout as "unavailable", never as "does not exist":
 *   - `getOpenCodeSession`: throws; `findOpenCodeSession` (plugin) catches and
 *     falls back to JSONL, `getSessionInfo` returns null, reuse skips the
 *     candidate, restore propagates (so a hanging binary fails within the
 *     bound instead of waiting 40 s), kill purge swallows (best effort).
 *   - `listOpenCodeSessionsByTitle`: throws; `remap` propagates (manual repair
 *     reports the hang instead of "missing"), spawn post-launch (row 23)
 *     treats it as "not discovered" and continues without a mapping.
 *   - `removeOpenCodeSession` / `interruptOpenCodeSession`: throw; `kill`
 *     purge swallows (archive anyway), `cleanup` records an error entry.
 * - The child's stderr is captured (`stdio` pipe) and never inherits the
 *   terminal. It is only used to build the thrown error message.
 * - Exit code 0 is never proof of a complete answer (0010 section 11.1):
 *   stdout must parse as JSON and have the expected envelope (`data` for
 *   get/list, any JSON for interrupt, empty or JSON for remove). A parse
 *   failure throws with `cause`, so a truncated pipe read becomes an error,
 *   not a silent empty result. Measured on 2.0.29 with answers larger than
 *   262144 bytes (see the helper test and the report D2).
 * - It never reads the service password: `opencode api` adds the auth itself
 *   (0009 section 2). No `service.json` is read.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bound on every `opencode api` call. 2.0.29 answers a get in about 0.14 s. */
export const OPENCODE_API_TIMEOUT_MS = 10_000;

/** Largest `opencode api` answer observed (model.list, 458898 bytes); 64 MiB leaves headroom. */
export const OPENCODE_API_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** A session record as `session.get` / `session.list` report it inside `data`. */
export interface OpenCodeApiSession {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
    idle?: number;
  };
  agent?: string;
  model?: {
    providerID?: string;
    id?: string;
    variant?: string;
  };
  [key: string]: unknown;
}

export interface OpenCodeApiOptions {
  /** Query/path params, sent as `--param key=value`. */
  params?: Record<string, string>;
  /** Request body, sent as `-d <json>`. */
  body?: unknown;
  /** Override for the bounded timeout. */
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Buffer) return value.toString("utf-8");
  return String(value ?? "");
}

/**
 * True when the failed call is a 404 for a session that does not exist.
 * 2.0.29 prints `{"_tag":"SessionNotFoundError",...}` to stdout and
 * `HTTP 404 Not Found` to stderr, and exits 1.
 */
function isSessionNotFound(stdout: string, stderr: string): boolean {
  if (/HTTP\s+404\b/i.test(stderr)) return true;
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed) && parsed["_tag"] === "SessionNotFoundError") return true;
    if (isRecord(parsed) && typeof parsed["message"] === "string") {
      return /session not found/i.test(parsed["message"]);
    }
    return false;
  } catch {
    return /session\s*not\s*found/i.test(trimmed);
  }
}

function buildArgs(
  operation: string,
  options?: OpenCodeApiOptions,
): string[] {
  const args = ["api", operation];
  const params = options?.params ?? {};
  for (const [key, value] of Object.entries(params)) {
    args.push("--param", `${key}=${value}`);
  }
  if (options?.body !== undefined) {
    args.push("-d", JSON.stringify(options.body));
  }
  return args;
}

/**
 * Run one `opencode api` operation and return the parsed JSON.
 * Returns `null` only for a 404 (session does not exist). Throws every other
 * error with `cause` set to the exec failure or parse failure. A successful
 * exit with unparsable stdout throws (truncated pipe read, 0010 section 11.1),
 * except that `session.remove` (HTTP 204, empty body) returns `null` as
 * success with no body.
 */
export async function callOpenCodeApi(
  operation: string,
  options?: OpenCodeApiOptions,
): Promise<unknown | null> {
  const timeoutMs = options?.timeoutMs ?? OPENCODE_API_TIMEOUT_MS;
  const args = buildArgs(operation, options);
  let stdout: string;
  let stderr: string;
  try {
    const result = await execFileAsync("opencode", args, {
      timeout: timeoutMs,
      maxBuffer: OPENCODE_API_MAX_BUFFER_BYTES,
      // No `stdio`: `execFile` pipes stdout/stderr by default, so the child's
      // stderr is captured here and never inherits the terminal.
    });
    stdout = errorText(result.stdout);
    stderr = errorText(result.stderr);
  } catch (err) {
    const execErr = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number | null;
      signal?: NodeJS.Signals | null;
      code?: string;
    };
    const outText = errorText(execErr.stdout ?? "");
    const errText = errorText(execErr.stderr ?? "");
    if (isSessionNotFound(outText, errText)) {
      return null;
    }
    const detail =
      errText.trim().length > 0
        ? errText.trim().slice(0, 500)
        : outText.trim().length > 0
          ? outText.trim().slice(0, 500)
          : (execErr.message ?? String(err)).slice(0, 500);
    const timedOut =
      execErr.code === "ETIMEDOUT" ||
      /timed?out/i.test(execErr.message ?? "") ||
      execErr.signal === "SIGTERM";
    throw new Error(
      `opencode api ${operation} failed${timedOut ? ` within ${timeoutMs} ms` : ""}: ${detail}`,
      { cause: err },
    );
  }

  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    // `session.remove` answers 204 with no body; every other operation must
    // print JSON, so empty output is a truncation, not a result.
    if (operation === "session.remove") return null;
    throw new Error(`opencode api ${operation} returned empty output with exit 0`, {
      cause: new Error(`stdout length 0, stderr: ${stderr.trim().slice(0, 200)}`),
    });
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (parseErr) {
    throw new Error(
      `opencode api ${operation} returned incomplete JSON with exit 0 (got ${trimmed.length} chars)`,
      { cause: parseErr },
    );
  }
}

function asSessionRecord(value: unknown): OpenCodeApiSession | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  if (typeof id !== "string" || id.length === 0) return null;
  return value as OpenCodeApiSession;
}

/**
 * `session.get` by the stored ID. Returns the session, or `null` when the
 * service answers 404. Throws on timeout and on every other error (with
 * `cause`), and on a truncated exit-0 answer.
 */
export async function getOpenCodeSession(
  sessionId: string,
  timeoutMs?: number,
): Promise<OpenCodeApiSession | null> {
  const parsed = await callOpenCodeApi("session.get", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  if (parsed === null) return null;
  if (!isRecord(parsed) || !("data" in parsed)) {
    throw new Error("opencode api session.get returned JSON without data", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  const session = asSessionRecord(parsed["data"]);
  if (!session) {
    throw new Error("opencode api session.get returned data without an id", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  return session;
}

/**
 * `session.list --param search=<title>` plus an exact title match (0009
 * section 3: `search` is a substring, so filter after the search). Used only
 * by the manual `ao session remap` (row 22) and, until I-3, by the spawn-time
 * title discovery (row 23). Everywhere else reuses the stored ID only.
 * Throws on timeout (with `cause`); callers treat it as unavailable.
 */
export async function listOpenCodeSessionsByTitle(
  title: string,
  timeoutMs?: number,
): Promise<OpenCodeApiSession[]> {
  const parsed = await callOpenCodeApi("session.list", {
    params: { search: title, limit: "50" },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  if (parsed === null) return [];
  if (!isRecord(parsed) || !Array.isArray(parsed["data"])) {
    throw new Error("opencode api session.list returned JSON without data array", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  const exact = (parsed["data"] as unknown[]).flatMap((entry) => {
    const session = asSessionRecord(entry);
    if (!session) return [];
    if (session.title !== title) return [];
    return [session];
  });
  // Newest first by time.updated, like the old CLI discovery, so a remap
  // binds the latest session when exact duplicates exist.
  return exact.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
}

/**
 * `session.remove` by ID (rows 9, 21). A 404 (already removed) is success and
 * returns; every other error throws with `cause` after the caller's retries.
 */
export async function removeOpenCodeSession(
  sessionId: string,
  timeoutMs?: number,
): Promise<void> {
  await callOpenCodeApi("session.remove", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
}

/**
 * `session.interrupt` by ID (row 20, before the remove). Returns the
 * `interrupted` flag, or `null` when the session does not exist (404).
 * Throws on timeout and on every other error (with `cause`).
 */
export async function interruptOpenCodeSession(
  sessionId: string,
  timeoutMs?: number,
): Promise<{ interrupted: boolean } | null> {
  const parsed = await callOpenCodeApi("session.interrupt", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  if (parsed === null) return null;
  if (isRecord(parsed) && isRecord(parsed["data"]) && typeof parsed["data"]["interrupted"] === "boolean") {
    return { interrupted: parsed["data"]["interrupted"] as boolean };
  }
  if (isRecord(parsed) && typeof parsed["interrupted"] === "boolean") {
    return { interrupted: parsed["interrupted"] as boolean };
  }
  // Some 2.x builds answer `{}` on an already-idle session; treat as done.
  if (isRecord(parsed)) return { interrupted: false };
  throw new Error("opencode api session.interrupt returned unexpected JSON", {
    cause: new Error(JSON.stringify(parsed).slice(0, 500)),
  });
}
