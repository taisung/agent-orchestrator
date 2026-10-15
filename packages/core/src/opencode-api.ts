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
 *   - `listOpenCodeSessionsByTitle` / `findOpenCodeSessionsByTitle`: throw;
 *     `remap` propagates (manual repair reports the hang instead of
 *     "missing").
 *   - `waitForOpenCodeSession` (spawn and orchestrator start, row 23): a
 *     failed search counts as "not found yet"; the whole wait is bounded by
 *     its window, and the spawn goes on without a mapping when it ends.
 *   - `removeOpenCodeSession` / `interruptOpenCodeSession`: throw; `kill`
 *     purge warns and archives anyway, `cleanup` records an error entry.
 * - The child's stderr is captured (`stdio` pipe) and never inherits the
 *   terminal. It is only used to build the thrown error message.
 * - Exit code 0 is never proof of a complete answer (0010 section 11.1):
 *   stdout must parse as JSON and have the expected envelope (`data` for
 *   get/list, any JSON for interrupt, empty or JSON for remove). A parse
 *   failure throws with `cause`, so a truncated pipe read becomes an error,
 *   not a silent empty result. Every answer of these operations is one JSON
 *   object, and a prefix of an object never parses. The title search reads
 *   pages of `OPENCODE_SESSION_LIST_PAGE_SIZE`, so one answer stays far below
 *   the 262144-byte pipe size where 0010 section 11.1 saw cut answers.
 * - It never reads the service password: `opencode api` adds the auth itself
 *   (0009 section 2). No `service.json` is read.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bound on every `opencode api` call. 2.0.29 answers a get in about 0.14 s. */
export const OPENCODE_API_TIMEOUT_MS = 10_000;

/**
 * An `opencode api` call that the bound stopped. A caller that retries can
 * stop at this error: a service that did not answer within the bound does not
 * answer the next try sooner, and each try costs the full bound again.
 */
export class OpenCodeApiTimeoutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenCodeApiTimeoutError";
  }
}

/** Largest `opencode api` answer observed (model.list, 458898 bytes); 64 MiB leaves headroom. */
export const OPENCODE_API_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * Page size of the title search. A 2.0.29 session record is about 410 bytes,
 * so a page is about 20 KB: far below the 262144-byte pipe size where
 * 0010 section 11.1 saw `opencode api` stop early with exit 0.
 */
export const OPENCODE_SESSION_LIST_PAGE_SIZE = 50;

/**
 * Most pages that one title search reads (1000 records). A title search that
 * needs more refuses with an error instead of returning a partial result.
 */
export const OPENCODE_SESSION_LIST_MAX_PAGES = 20;

/** A session record as `session.get` / `session.list` report it inside `data`. */
export interface OpenCodeApiSession {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
    idle?: number;
  };
  /** The directory that the creator gave; the pane gives its working directory. */
  location?: {
    directory?: string;
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

function buildArgs(operation: string, options?: OpenCodeApiOptions): string[] {
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
      // `execFile` always pipes stdout and stderr: it does not pass a `stdio`
      // option on to `spawn` (checked on Node 25.7.0), so the child's stderr
      // is captured here and never reaches the terminal.
    });
    stdout = errorText(result.stdout);
    stderr = errorText(result.stderr);
  } catch (err) {
    const execErr = err as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      killed?: boolean;
      signal?: NodeJS.Signals | null;
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
          : (execErr.message ?? String(err)).trim().slice(0, 500);
    // A real `execFile` timeout kills the child and reports `killed: true`,
    // `signal: "SIGTERM"` and no `code` (measured on Node 25). A maxBuffer
    // overflow also kills the child but reports its own code and no `killed`.
    if (execErr.killed === true) {
      throw new OpenCodeApiTimeoutError(
        `opencode api ${operation} did not answer within ${timeoutMs} ms: ${detail}`,
        { cause: err },
      );
    }
    throw new Error(`opencode api ${operation} failed: ${detail}`, { cause: err });
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

function createdAt(session: OpenCodeApiSession): number {
  const created = session.time?.created;
  return typeof created === "number" && Number.isFinite(created) ? created : 0;
}

/** Newest first by `time.created`. */
function byCreatedDesc(a: OpenCodeApiSession, b: OpenCodeApiSession): number {
  return createdAt(b) - createdAt(a);
}

/**
 * `session.list --param search=<title>` plus an exact title match (0009
 * section 3: `search` is a substring, so filter after the search). The search
 * spans every project of the service, so a caller that knows the session's
 * directory passes it: the service filters on it (`--param directory=`, an
 * exact match on 2.0.29) and this function checks `location.directory` again
 * after the call.
 *
 * It follows `cursor.next` until the list ends, because the search is a
 * substring and an old exact title can sit behind many newer substring
 * matches (`AO:ao-1` also matches `AO:ao-10` to `AO:ao-199`). On 2.0.29 a
 * page shorter than the limit is the last one (the service still sends a
 * `next` cursor, and the page after it is empty). More than
 * `OPENCODE_SESSION_LIST_MAX_PAGES` pages is an error, never a partial result.
 *
 * `timeoutMs` bounds the whole search, not one page. Throws on timeout and on
 * every other error (with `cause`); callers treat it as unavailable.
 */
export async function listOpenCodeSessionsByTitle(
  title: string,
  options?: { directory?: string; timeoutMs?: number },
): Promise<OpenCodeApiSession[]> {
  const deadline = Date.now() + (options?.timeoutMs ?? OPENCODE_API_TIMEOUT_MS);
  const directory = options?.directory;
  const exact: OpenCodeApiSession[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < OPENCODE_SESSION_LIST_MAX_PAGES; page++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new OpenCodeApiTimeoutError(
        `opencode api session.list did not answer within ${options?.timeoutMs ?? OPENCODE_API_TIMEOUT_MS} ms: the search for ${title} ran out of time after ${page} pages`,
      );
    }
    const parsed = await callOpenCodeApi("session.list", {
      params: {
        search: title,
        limit: String(OPENCODE_SESSION_LIST_PAGE_SIZE),
        ...(directory !== undefined ? { directory } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      },
      timeoutMs: remainingMs,
    });
    if (parsed === null) return exact.sort(byCreatedDesc);
    if (!isRecord(parsed) || !Array.isArray(parsed["data"])) {
      throw new Error("opencode api session.list returned JSON without data array", {
        cause: new Error(JSON.stringify(parsed).slice(0, 500)),
      });
    }
    const records = parsed["data"] as unknown[];
    for (const entry of records) {
      const session = asSessionRecord(entry);
      if (!session || session.title !== title) continue;
      if (directory !== undefined && session.location?.directory !== directory) continue;
      exact.push(session);
    }

    const next = isRecord(parsed["cursor"]) ? parsed["cursor"]["next"] : undefined;
    if (
      records.length < OPENCODE_SESSION_LIST_PAGE_SIZE ||
      typeof next !== "string" ||
      next.length === 0
    ) {
      return exact.sort(byCreatedDesc);
    }
    cursor = next;
  }

  throw new Error(
    `opencode api session.list: the search for ${title} has more than ${OPENCODE_SESSION_LIST_MAX_PAGES} pages of ${OPENCODE_SESSION_LIST_PAGE_SIZE}; refusing a partial result`,
  );
}

/** Filters for the sessions that can belong to one AO session. */
export interface OpenCodeSessionMatch {
  /** Exact title, for example `AO:ao-12`. */
  title: string;
  /** Accept only sessions whose `location.directory` is one of these paths. */
  directories: readonly string[];
  /** Accept only sessions created at or after this time (epoch ms). */
  createdAtOrAfter?: number;
}

/**
 * The sessions that match `match`, newest first: exact title, a directory of
 * `match.directories`, and (when given) created at or after
 * `match.createdAtOrAfter`. Searches each directory once; `timeoutMs` bounds
 * the whole call. Throws like `listOpenCodeSessionsByTitle`.
 */
export async function findOpenCodeSessionsByTitle(
  match: OpenCodeSessionMatch,
  timeoutMs: number = OPENCODE_API_TIMEOUT_MS,
): Promise<OpenCodeApiSession[]> {
  const deadline = Date.now() + timeoutMs;
  const byId = new Map<string, OpenCodeApiSession>();
  for (const directory of new Set(match.directories)) {
    const remainingMs = Math.max(1, deadline - Date.now());
    for (const session of await listOpenCodeSessionsByTitle(match.title, {
      directory,
      timeoutMs: remainingMs,
    })) {
      if (match.createdAtOrAfter !== undefined && createdAt(session) < match.createdAtOrAfter) {
        continue;
      }
      byId.set(session.id, session);
    }
  }
  return [...byId.values()].sort(byCreatedDesc);
}

export type OpenCodeSessionWaitResult =
  | { status: "found"; session: OpenCodeApiSession }
  | { status: "ambiguous"; sessions: OpenCodeApiSession[] }
  | { status: "not-found"; lastError?: unknown };

/**
 * Wait until exactly one session matches `match`, for at most `windowMs`
 * (row 23, spawn and orchestrator start, until I-3 creates the session in
 * Node). The pane creates its session only after `runtime.create` returns,
 * so the first search usually runs too early; this searches again every
 * `pollMs`. A failed search (timeout or another error) counts as "not found
 * yet". Each search gets only the time left in the window, so the whole wait
 * ends within `windowMs` plus one process exit.
 *
 * Two or more matches end the wait as "ambiguous": the caller must not pick
 * one (two fleets with the same session prefix and the same directory can
 * start the same title at the same time).
 */
export async function waitForOpenCodeSession(
  match: OpenCodeSessionMatch,
  windowMs: number,
  pollMs: number,
): Promise<OpenCodeSessionWaitResult> {
  const deadline = Date.now() + windowMs;
  let lastError: unknown;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      const sessions = await findOpenCodeSessionsByTitle(
        match,
        Math.min(OPENCODE_API_TIMEOUT_MS, remainingMs),
      );
      const [only, ...others] = sessions;
      if (only && others.length === 0) return { status: "found", session: only };
      if (only) return { status: "ambiguous", sessions };
    } catch (err) {
      lastError = err;
    }
    const pauseMs = Math.min(pollMs, deadline - Date.now());
    if (pauseMs <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return { status: "not-found", ...(lastError !== undefined ? { lastError } : {}) };
}

/**
 * `session.remove` by ID (rows 9, 21). A 404 (already removed) is success and
 * returns; every other error throws with `cause` after the caller's retries.
 */
export async function removeOpenCodeSession(sessionId: string, timeoutMs?: number): Promise<void> {
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
  if (
    isRecord(parsed) &&
    isRecord(parsed["data"]) &&
    typeof parsed["data"]["interrupted"] === "boolean"
  ) {
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
