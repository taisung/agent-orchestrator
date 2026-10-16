/**
 * OpenCode 2.x activity, cost and session info from the API (note 0009 I-4).
 *
 * This file holds the new API code so `index.ts` changes only its import
 * block, `detectActivity`, `getActivityState` and `getSessionInfo`. It uses
 * `callOpenCodeApi` and `getOpenCodeSession` from `@aoagents/ao-core` with a
 * plugin timeout below the helper default, and takes every operation name,
 * parameter name and answer shape from `opencode api GET /openapi.json`
 * (2.0.31 isolated store, same document as 0009 section 3).
 *
 * Operations used:
 * - `session.permission.list` with `--param sessionID=<id>`, answer
 *   `{"data": Permission.Request[]}`.
 * - `session.form.list` with `--param sessionID=<id>`, answer
 *   `{"data": Form.Info[]}` (per session; never the global `form.list`,
 *   which missed a pending form, 0010 section 5.2).
 * - `session.active` with no params, answer `{"data": {ses_...: {type:
 *   "running"}}}` ("foreground Session drains currently owned by this
 *   OpenCode process. Sessions absent from the result are inactive").
 * - `session.get` with `--param sessionID=<id>`, answer `{"data":
 *   Session.Info}` with `id, title, cost (Money.USD number), tokens
 *   (TokenUsage.Info {input, output, reasoning, cache {read, write}}),
 *   outcome ("succeeded" | "failed" | "interrupted"), time {created,
 *   updated, idle?, viewed?, archived?}}`. 404 is `SessionNotFoundError`.
 * - `session.message.list` with `--param sessionID=<id> --param type=user
 *   --param order=desc --param limit=1`, answer `{"data":
 *   Session.Message.Info[], cursor: {previous, next}}`; a `user` message
 *   carries `time.created`. Used only for the `failed` blocked check, one
 *   small record.
 */

import {
  callOpenCodeApi,
  getOpenCodeSession,
  type ActivityDetection,
  type ActivityState,
  type AgentSessionInfo,
  type CostEstimate,
  type OpenCodeApiSession,
} from "@aoagents/ao-core";

/**
 * Bound on every `opencode api` call made from this plugin. Below the core
 * helper default (`OPENCODE_API_TIMEOUT_MS`, 10 s), so the worst case of one
 * `getActivityState` (four parallel calls plus one conditional message list)
 * is about two bounds, far below the 30 s lifecycle poll. No retry inside
 * one poll.
 */
export const OPENCODE_ACTIVITY_API_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toValidTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function parseDataArray(raw: unknown): unknown[] | null {
  if (!isRecord(raw)) return null;
  const data = raw["data"];
  if (!Array.isArray(data)) return null;
  return data;
}

function parseActiveData(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const data = raw["data"];
  if (!isRecord(data)) return null;
  return data;
}

function getLastUserMessageTime(messages: unknown[]): number | null {
  let latest: number | null = null;
  for (const entry of messages) {
    if (!isRecord(entry)) continue;
    if (entry["type"] !== "user") continue;
    const time = entry["time"];
    if (!isRecord(time)) continue;
    const created = toValidTimestamp(time["created"]);
    if (created === null) continue;
    if (latest === null || created > latest) latest = created;
  }
  return latest;
}

function toFiniteNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Map a `session.get` record to a `CostEstimate` (0009 section 7, Q8):
 * `inputTokens = input + cache.read + cache.write`,
 * `outputTokens = output + reasoning`, `estimatedCostUsd = cost`.
 * Returns undefined unless every number is finite and not negative, in
 * which case the caller leaves `cost` out.
 */
export function mapSessionCost(record: Record<string, unknown>): CostEstimate | undefined {
  const cost = toFiniteNonNegative(record["cost"]);
  const tokens = record["tokens"];
  if (cost === null || !isRecord(tokens)) return undefined;
  const input = toFiniteNonNegative(tokens["input"]);
  const output = toFiniteNonNegative(tokens["output"]);
  const reasoning = toFiniteNonNegative(tokens["reasoning"]);
  const cache = tokens["cache"];
  if (input === null || output === null || reasoning === null || !isRecord(cache)) {
    return undefined;
  }
  const read = toFiniteNonNegative(cache["read"]);
  const write = toFiniteNonNegative(cache["write"]);
  if (read === null || write === null) return undefined;
  return {
    inputTokens: input + read + write,
    outputTokens: output + reasoning,
    estimatedCostUsd: cost,
  };
}

/**
 * Classify a 2.x TUI pane from its screen structure (0010 section 11.5,
 * real 2.0.31 captures in `src/__fixtures__/panes-2.0.31.ts`).
 *
 * Exact rules:
 * - Empty capture → `idle`.
 * - Dialog markers count only on lines that are not transcript or input
 *   text: in the real captures, transcript and input lines start with `┃`
 *   after the leading spaces, and dialog lines do not. On such a line,
 *   `△ Permission required` → `waiting_input`; `Allow once` with `Reject`
 *   on the same line → `waiting_input`; `↑↓ select` with `enter submit`
 *   on the same line → `waiting_input`.
 * - Otherwise the status row decides: it is the last non-empty line of the
 *   capture. It holds `esc interrupt` → `active` (checked first: a real busy
 *   status row also holds `ctrl+p commands`); else it holds
 *   `ctrl+p commands` → `idle`. The marker is matched anywhere on the status
 *   row itself (the 0009 section 5.1 idle row carries a trailing directory
 *   after `ctrl+p commands`); transcript and input lines never decide.
 * - Unknown output stays `active`.
 *
 * No real permission or question dialog capture exists (those need a model
 * turn); the dialog shapes above come from the 0010 section 11.5 census.
 */
export function classifyOpenCodePaneActivity(terminalOutput: string): ActivityState {
  if (terminalOutput.trim().length === 0) return "idle";
  for (const line of terminalOutput.split("\n")) {
    if (line.trimStart().startsWith("┃")) continue;
    if (line.includes("△ Permission required")) return "waiting_input";
    if (line.includes("Allow once") && line.includes("Reject")) return "waiting_input";
    if (line.includes("↑↓ select") && line.includes("enter submit")) return "waiting_input";
  }
  const lines = terminalOutput.split("\n");
  let statusRow: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line !== undefined && line.trim().length > 0) {
      statusRow = line;
      break;
    }
  }
  if (statusRow === null) return "idle";
  if (statusRow.includes("esc interrupt")) return "active";
  if (statusRow.includes("ctrl+p commands")) return "idle";
  return "active";
}

interface ValidSessionTimes {
  updated: number | null;
  idle: number | null;
}

function getSessionTimes(session: OpenCodeApiSession): ValidSessionTimes {
  return {
    updated: toValidTimestamp(session.time?.updated),
    idle: toValidTimestamp(session.time?.idle),
  };
}

function getSessionOutcome(session: OpenCodeApiSession): string | null {
  const outcome = session["outcome"];
  return typeof outcome === "string" ? outcome : null;
}

/**
 * The 2.x cascade over the API (A1 steps 3 to 6). Returns a detection on a
 * positive API record, or null when there is no usable API signal (timeout,
 * error, 404, or unexpected shape). The caller falls through to the AO JSONL
 * fallback (`getActivityFallbackState`) on null, and to null only when there
 * is no data at all.
 *
 * At most four `opencode api` calls in the common case, plus one conditional
 * `session.message.list` when `outcome == "failed"`.
 */
export async function getApiActivityState(
  sessionId: string,
  activeWindowMs: number,
  thresholdMs: number,
): Promise<ActivityDetection | null> {
  const timeoutMs = OPENCODE_ACTIVITY_API_TIMEOUT_MS;
  const [permissionRaw, formRaw, activeRaw, session] = await Promise.all([
    callOpenCodeApi("session.permission.list", {
      params: { sessionID: sessionId },
      timeoutMs,
    }).catch(() => null),
    callOpenCodeApi("session.form.list", {
      params: { sessionID: sessionId },
      timeoutMs,
    }).catch(() => null),
    callOpenCodeApi("session.active", { timeoutMs }).catch(() => null),
    getOpenCodeSession(sessionId, timeoutMs).catch(() => null),
  ]);

  if (permissionRaw === null || formRaw === null || activeRaw === null || session === null) {
    return null;
  }
  const permissions = parseDataArray(permissionRaw);
  const forms = parseDataArray(formRaw);
  const activeData = parseActiveData(activeRaw);
  if (permissions === null || forms === null || activeData === null) return null;

  const { updated, idle } = getSessionTimes(session);
  if (updated === null && idle === null) return null;

  if (permissions.length > 0 || forms.length > 0) {
    const stamp = updated ?? Date.now();
    return { state: "waiting_input", timestamp: new Date(stamp) };
  }

  if (Object.hasOwn(activeData, sessionId)) {
    return { state: "active", timestamp: new Date() };
  }

  const outcome = getSessionOutcome(session);
  if (outcome === "failed" && idle !== null) {
    let readOk = false;
    let lastUser: number | null = null;
    try {
      const messageRaw = await callOpenCodeApi("session.message.list", {
        params: { sessionID: sessionId, type: "user", order: "desc", limit: "1" },
        timeoutMs,
      });
      if (messageRaw !== null) {
        const messages = parseDataArray(messageRaw);
        if (messages !== null) {
          readOk = true;
          lastUser = getLastUserMessageTime(messages);
        }
      }
    } catch {
      readOk = false;
    }
    if (readOk && (lastUser === null || lastUser <= idle)) {
      return { state: "blocked", timestamp: new Date(idle) };
    }
  }

  const base = idle ?? updated;
  if (base === null) return null;
  const ageMs = Math.max(0, Date.now() - base);
  const stamp = new Date(base);
  if (ageMs <= activeWindowMs) return { state: "active", timestamp: stamp };
  if (ageMs <= thresholdMs) return { state: "ready", timestamp: stamp };
  return { state: "idle", timestamp: stamp };
}

/**
 * Cost and tokens from `session.get` (A3). One `opencode api` call. Returns
 * null on no session (404) and on timeout, error, or unexpected shape, as
 * today. `summary` is the title with `summaryIsFallback: true`, plus
 * `agentSessionId`. `cost` is left out unless every number is finite and not
 * negative.
 */
export async function getApiSessionInfo(sessionId: string): Promise<AgentSessionInfo | null> {
  let session: OpenCodeApiSession | null;
  try {
    session = await getOpenCodeSession(sessionId, OPENCODE_ACTIVITY_API_TIMEOUT_MS);
  } catch {
    return null;
  }
  if (!session) return null;
  const record = session as unknown as Record<string, unknown>;
  const cost = mapSessionCost(record);
  return {
    summary: typeof session.title === "string" ? session.title : null,
    summaryIsFallback: true,
    agentSessionId: session.id,
    ...(cost ? { cost } : {}),
  };
}
