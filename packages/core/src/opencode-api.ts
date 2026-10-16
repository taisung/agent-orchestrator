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
 *     "missing"). No spawn path searches by title (row 23, I-3).
 *   - `removeOpenCodeSession` / `interruptOpenCodeSession`: throw; `kill`
 *     purge warns and archives anyway, `cleanup` records an error entry.
 *   - The spawn calls (`listOpenCodeModels`, `createOpenCodeSession`, the
 *     switches, `hasOpenCodeUserMessage`): throw; the OpenCode plugin's
 *     `prepareAgentSession` fails the spawn before the pane starts, and its
 *     `confirmLaunch` counts a failed message read as "not seen yet".
 * - The child's stderr is captured (`stdio` pipe) and never inherits the
 *   terminal. It is only used to build the thrown error message.
 * - Exit code 0 is never proof of a complete answer (0010 section 11.1):
 *   stdout must parse as JSON and have the expected envelope (`data` for
 *   get/list, any JSON for interrupt, empty or JSON for remove). A parse
 *   failure throws `OpenCodeApiIncompleteAnswerError` with `cause`, so a
 *   truncated pipe read becomes an error, not a silent empty result. Every
 *   answer of these operations is one JSON object, and a prefix of an object
 *   never parses. The title search reads pages of
 *   `OPENCODE_SESSION_LIST_PAGE_SIZE`, so one answer stays far below the
 *   262144-byte pipe size where 0010 section 11.1 saw cut answers.
 *   `model.list` (about 470 KB) cannot page, so it retries once on a cut.
 * - A spawn passes the session's own environment (`env`): the call then runs
 *   with the environment that the pane gets, not with the `AO_*` values of
 *   the `ao` process (0010 sections 11.2 and 14 item 3).
 * - It never reads the service password: `opencode api` adds the auth itself
 *   (0009 section 2). No `service.json` is read.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";

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

/**
 * An `opencode api` call that exited 0 with empty or unparsable stdout: the
 * answer was cut (0010 section 11.1), not empty. A caller can ask again.
 */
export class OpenCodeApiIncompleteAnswerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpenCodeApiIncompleteAnswerError";
  }
}

/** Largest `opencode api` answer observed (model.list, 473846 bytes on 2.0.31); 64 MiB leaves headroom. */
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
  /**
   * The environment of the session that the call works for: the map that
   * core passes to `runtime.create`. When set, the child gets the `ao`
   * process environment without its `AO_*` variables, plus this map (the map
   * wins). Without it, the child inherits the `ao` process environment.
   */
  env?: Record<string, string>;
}

/** The child environment for `OpenCodeApiOptions.env`. */
function sessionChildEnvironment(env: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AO_")) base[key] = value;
  }
  return { ...base, ...env };
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
      // is captured here and never reaches the terminal. With `env`, Node
      // also looks up `opencode` on that PATH, as the pane does.
      ...(options?.env ? { env: sessionChildEnvironment(options.env) } : {}),
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
    throw new OpenCodeApiIncompleteAnswerError(
      `opencode api ${operation} returned empty output with exit 0`,
      { cause: new Error(`stdout length 0, stderr: ${stderr.trim().slice(0, 200)}`) },
    );
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (parseErr) {
    throw new OpenCodeApiIncompleteAnswerError(
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
  env?: Record<string, string>,
): Promise<OpenCodeApiSession | null> {
  const parsed = await callOpenCodeApi("session.get", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(env ? { env } : {}),
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

/**
 * `session.remove` by ID (rows 9, 21). A 404 (already removed) is success and
 * returns; every other error throws with `cause` after the caller's retries.
 */
export async function removeOpenCodeSession(
  sessionId: string,
  timeoutMs?: number,
  env?: Record<string, string>,
): Promise<void> {
  await callOpenCodeApi("session.remove", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(env ? { env } : {}),
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
  env?: Record<string, string>,
): Promise<{ interrupted: boolean } | null> {
  const parsed = await callOpenCodeApi("session.interrupt", {
    params: { sessionID: sessionId },
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(env ? { env } : {}),
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

// =============================================================================
// Spawn calls (I-3: the session is created in Node before the pane starts)
// =============================================================================

/** A model reference of the 2.x API (`Model.Ref`: `providerID`, `id`, optional `variant`). */
export interface OpenCodeModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

/** Options of the spawn calls: the session's environment and a bound. */
export interface OpenCodeSpawnCallOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
}

function spawnCallOptions(options: OpenCodeSpawnCallOptions | undefined): OpenCodeApiOptions {
  return {
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.env ? { env: options.env } : {}),
  };
}

/**
 * One `model.list` entry (`Model.Info`, `GET /api/model`), the fields that the
 * model check reads. `id` is the key that `Model.Ref.id` names: measured on
 * 2.0.31, `providerID` + `id` is unique over all 586 entries, while 26
 * `providerID` + `modelID` keys hold more than one entry (`openai/gpt-6.1-sol`
 * is the `modelID` of `gpt-6.1-sol`, `-fast`, `-pro` and `-ultrafast`).
 */
export interface OpenCodeApiModel {
  id: string;
  providerID: string;
  modelID?: string;
  enabled?: boolean;
  variants?: Array<{ id?: unknown }>;
  [key: string]: unknown;
}

/**
 * `model.list`. The answer is about 470 KB, above the 262144-byte pipe size
 * where 0010 section 11.1 saw `opencode api` stop early with exit 0, and the
 * operation has no paging. A cut answer (empty or incomplete JSON) is asked
 * again once, so one cut does not fail a spawn. Throws on timeout, on every
 * other error and on a second cut.
 */
export async function listOpenCodeModels(
  options?: OpenCodeSpawnCallOptions,
): Promise<OpenCodeApiModel[]> {
  let parsed: unknown;
  for (let attempt = 1; ; attempt++) {
    try {
      parsed = await callOpenCodeApi("model.list", spawnCallOptions(options));
      break;
    } catch (err) {
      if (attempt >= 2 || !(err instanceof OpenCodeApiIncompleteAnswerError)) throw err;
    }
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["data"])) {
    throw new Error("opencode api model.list returned JSON without data array", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  return (parsed["data"] as unknown[]).filter(
    (entry): entry is OpenCodeApiModel =>
      isRecord(entry) && typeof entry["id"] === "string" && typeof entry["providerID"] === "string",
  );
}

/**
 * The model check before `session.create` (0010 sections 5.3 and 11.4:
 * create accepts a model that has no route). Returns null when `models` has
 * an entry with the requested `providerID` and `id` that is `enabled` and,
 * for a requested variant, lists it; else the reason for the refusal. The
 * variant `default` is what 2.x stores for a model without a variant, so it
 * needs no listed entry.
 */
export function findOpenCodeModelProblem(
  models: readonly OpenCodeApiModel[],
  ref: OpenCodeModelRef,
): string | null {
  const name = `${ref.providerID}/${ref.id}`;
  const entry = models.find((model) => model.providerID === ref.providerID && model.id === ref.id);
  if (!entry) return `model.list has no model ${name}`;
  if (entry.enabled !== true) return `model ${name} is not enabled`;
  if (ref.variant && ref.variant !== "default") {
    const variants = Array.isArray(entry.variants) ? entry.variants : [];
    if (!variants.some((variant) => isRecord(variant) && variant["id"] === ref.variant)) {
      return `model ${name} has no variant ${ref.variant}`;
    }
  }
  return null;
}

/** The body of `session.create` that a spawn sends. */
export interface OpenCodeSessionCreateBody {
  title: string;
  model?: OpenCodeModelRef;
  agent?: string;
  location: { directory: string };
}

/**
 * `session.create`. Returns the new session; throws when the call fails, and
 * when the answer holds no valid session ID (then no ID is known, so nothing
 * can be removed).
 */
export async function createOpenCodeSession(
  body: OpenCodeSessionCreateBody,
  options?: OpenCodeSpawnCallOptions,
): Promise<OpenCodeApiSession> {
  const parsed = await callOpenCodeApi("session.create", {
    body,
    ...spawnCallOptions(options),
  });
  const session = isRecord(parsed) ? asSessionRecord(parsed["data"]) : null;
  if (!session || !asValidOpenCodeSessionId(session.id)) {
    throw new Error("opencode api session.create returned no usable session ID", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  return session;
}

async function switchOpenCodeSession(
  operation: "session.switchModel" | "session.switchAgent",
  sessionId: string,
  body: Record<string, unknown>,
  options?: OpenCodeSpawnCallOptions,
): Promise<void> {
  const parsed = await callOpenCodeApi(operation, {
    params: { sessionID: sessionId },
    body,
    ...spawnCallOptions(options),
  });
  if (parsed === null) {
    throw new Error(`opencode api ${operation}: OpenCode session ${sessionId} does not exist`);
  }
}

/** `session.switchModel` on an existing session (row 4). Throws on any failure, also on a 404. */
export async function switchOpenCodeSessionModel(
  sessionId: string,
  model: OpenCodeModelRef,
  options?: OpenCodeSpawnCallOptions,
): Promise<void> {
  await switchOpenCodeSession("session.switchModel", sessionId, { model }, options);
}

/** `session.switchAgent` on an existing session (row 4). Throws on any failure, also on a 404. */
export async function switchOpenCodeSessionAgent(
  sessionId: string,
  agent: string,
  options?: OpenCodeSpawnCallOptions,
): Promise<void> {
  await switchOpenCodeSession("session.switchAgent", sessionId, { agent }, options);
}

/**
 * True when the session has a `user` message (`session.message.list` with
 * `type=user`, one entry): the launch prompt reached the session. A 404
 * answers false. Throws on timeout and on every other error.
 */
export async function hasOpenCodeUserMessage(
  sessionId: string,
  options?: OpenCodeSpawnCallOptions,
): Promise<boolean> {
  const parsed = await callOpenCodeApi("session.message.list", {
    params: { sessionID: sessionId, type: "user", limit: "1" },
    ...spawnCallOptions(options),
  });
  if (parsed === null) return false;
  if (!isRecord(parsed) || !Array.isArray(parsed["data"])) {
    throw new Error("opencode api session.message.list returned JSON without data array", {
      cause: new Error(JSON.stringify(parsed).slice(0, 500)),
    });
  }
  return (parsed["data"] as unknown[]).some(
    (message) => isRecord(message) && message["type"] === "user",
  );
}
