/**
 * Same-ID R2a: the stop of a runtime, with an outcome that a caller can act
 * on (design r2 section 2.6). Every core caller that stops a runtime goes
 * through `stopRuntime`, and only `destroyed` and `absent` let it go on: no
 * workspace removal, no record archive or delete, and no new runtime for the
 * session ID after `other-launch` or `unknown`.
 */
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  type Runtime,
  type RuntimeHandle,
  type RuntimeStopOutcome,
  type SessionId,
} from "./types.js";

/** The outcomes that let a caller go on. */
export type ConfirmedRuntimeStop = Extract<RuntimeStopOutcome, { outcome: "destroyed" | "absent" }>;

/** The outcomes that stop a caller: it keeps the record, the workspace and the ID. */
export type UnconfirmedRuntimeStop = Exclude<RuntimeStopOutcome, ConfirmedRuntimeStop>;

/** True for `destroyed` and `absent`, the only outcomes after which a caller goes on. */
export function isRuntimeStopConfirmed(stop: RuntimeStopOutcome): stop is ConfirmedRuntimeStop {
  return stop.outcome === "destroyed" || stop.outcome === "absent";
}

/**
 * The `unknown` detail when AO cannot read the runtime plugin or its answer:
 * a property or a value threw while `stopRuntime` read it (review r1, m-1).
 * It names nothing that comes from the plugin, so it cannot throw itself.
 */
export const RUNTIME_STOP_UNREADABLE_DETAIL =
  "AO could not read the runtime plugin or its answer to the stop (a property or a value threw), so nothing confirms that the session stopped";

/** The text for a value that cannot be shown (its conversion throws). */
const UNSHOWABLE = "a value that cannot be shown as text";

/** `String(value)`, or UNSHOWABLE when the conversion throws. */
function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return UNSHOWABLE;
  }
}

/** The error text on one line, at most 200 characters. It never throws. */
function errorText(err: unknown): string {
  let text: string;
  try {
    const message: unknown = err instanceof Error ? err.message : err;
    text = safeString(message);
  } catch {
    text = UNSHOWABLE;
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** A value for a message: JSON where it can, at most 120 characters. It never throws. */
function describeValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? safeString(value);
  } catch {
    text = safeString(value);
  }
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** True when a rejection of `Runtime.isAlive` reports that no runtime server runs. */
function isNoServerRejection(err: unknown): boolean {
  try {
    return (
      !!err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === RUNTIME_NO_SERVER_ERROR_CODE
    );
  } catch {
    // A `code` that cannot be read is no proof that no server runs.
    return false;
  }
}

/**
 * The answer of a `Runtime.stop` as an outcome, or null when it is not a
 * valid one. `absent` needs its evidence and the other two need their detail:
 * an answer without them cannot tell the operator what happened. Each field
 * is read once and copied, so a getter cannot change the answer later. A
 * getter that throws makes this function throw; `stopRuntime` turns that
 * into RUNTIME_STOP_UNREADABLE_DETAIL.
 */
function asStopOutcome(value: unknown): RuntimeStopOutcome | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as Record<string, unknown>;
  const outcome = answer["outcome"];
  switch (outcome) {
    case "destroyed":
      return { outcome: "destroyed" };
    case "absent": {
      const evidence = answer["evidence"];
      return nonEmptyString(evidence) ? { outcome: "absent", evidence } : null;
    }
    case "other-launch":
    case "unknown": {
      const detail = answer["detail"];
      if (!nonEmptyString(detail)) return null;
      if (outcome === "other-launch") return { outcome, detail };
      const cause = answer["cause"];
      return { outcome, detail, ...(cause !== undefined && { cause }) };
    }
    default:
      return null;
  }
}

/**
 * Stop the runtime of `handle` and say what happened. It never rejects: when
 * AO cannot read the plugin or its answer (a getter or a conversion throws),
 * the answer is `unknown` with RUNTIME_STOP_UNREADABLE_DETAIL and the error
 * as `cause` (review r1, m-1).
 *
 * With `runtime.stop`: its answer. A `stop` that rejects, or that answers a
 * value that is not a valid outcome, gives `unknown` (with the rejection as
 * `cause`).
 *
 * Without it (runtime-tmux in R2a, a third-party runtime): `destroy`, then
 * `isAlive`:
 *
 * | destroy  | isAlive                                   | outcome     |
 * | -------- | ----------------------------------------- | ----------- |
 * | resolves | false                                     | `destroyed` |
 * | resolves | rejects with RUNTIME_NO_SERVER_ERROR_CODE | `destroyed` |
 * | rejects  | false                                     | `absent`    |
 * | either   | true                                      | `unknown`   |
 * | rejects  | rejects (also with no server)             | `unknown`   |
 * | resolves | rejects with any other code               | `unknown`   |
 * | either   | answers a value that is not a boolean     | `unknown`   |
 *
 * The second row is the only one beyond design r2 section 2.6: the runtime
 * acknowledged the stop and then reported that no server runs at all, so no
 * session can exist (the contract of RUNTIME_NO_SERVER_ERROR_CODE). tmux
 * ends a server when its last session ends, so a healthy kill of the last
 * session on a server answers exactly this. After a destroy that rejected,
 * "no server" stays unknown: a server whose socket is gone still runs its
 * sessions (design r2 B-5).
 *
 * Compatibility limit of the fallback: it is useful only under an
 * authoritative-false `isAlive` contract (`Runtime.isAlive`: false only when
 * the runtime answered that the session does not exist, a rejection when it
 * cannot tell). A plugin that answers false when its probe fails gains no
 * stronger evidence from this wrap: that false gives `destroyed` or `absent`,
 * and the caller removes the workspace of a session that may still run. Such
 * a plugin needs its own `stop`.
 */
export async function stopRuntime(
  runtime: Runtime,
  handle: RuntimeHandle,
): Promise<RuntimeStopOutcome> {
  try {
    return await stopOrThrow(runtime, handle);
  } catch (err) {
    return { outcome: "unknown", detail: RUNTIME_STOP_UNREADABLE_DETAIL, cause: err };
  }
}

/**
 * `stopRuntime` without its outer guard. A rejection of `stop`, `destroy` or
 * `isAlive` is an answer and gives its own outcome here; only a failure to
 * read the plugin or an answer throws.
 */
async function stopOrThrow(runtime: Runtime, handle: RuntimeHandle): Promise<RuntimeStopOutcome> {
  const target = `${safeString(runtime.name)} session ${safeString(handle.id)}`;

  const stop = runtime.stop;
  if (stop) {
    let answer: unknown;
    try {
      answer = await stop.call(runtime, handle);
    } catch (err) {
      return {
        outcome: "unknown",
        detail: `the stop of ${target} failed: ${errorText(err)}`,
        cause: err,
      };
    }
    return (
      asStopOutcome(answer) ?? {
        outcome: "unknown",
        detail: `the stop of ${target} answered a value that is not a stop outcome: ${describeValue(answer)}`,
      }
    );
  }

  const destroy = runtime.destroy;
  const isAlive = runtime.isAlive;
  let destroyFailed = false;
  let destroyError: unknown;
  try {
    await destroy.call(runtime, handle);
  } catch (err) {
    destroyFailed = true;
    destroyError = err;
  }
  const destroyText = destroyFailed
    ? `the destroy of ${target} failed (${errorText(destroyError)})`
    : `the destroy of ${target} completed`;
  const destroyCause = destroyFailed ? { cause: destroyError } : {};

  let alive: unknown;
  try {
    alive = await isAlive.call(runtime, handle);
  } catch (err) {
    const noServer = isNoServerRejection(err);
    if (noServer && !destroyFailed) return { outcome: "destroyed" };
    return {
      outcome: "unknown",
      detail: noServer
        ? `${destroyText}, and no ${safeString(runtime.name)} server answers, so nothing can confirm that the session stopped (${errorText(err)}); when no server runs, start one so that it can answer`
        : `${destroyText}, and the liveness check failed (${errorText(err)})`,
      cause: destroyFailed
        ? new AggregateError([destroyError, err], `${destroyText}; the liveness check failed`)
        : err,
    };
  }

  if (alive === false) {
    return destroyFailed
      ? {
          outcome: "absent",
          evidence: `${safeString(runtime.name)} answered that ${safeString(handle.id)} does not exist, after ${destroyText}`,
        }
      : { outcome: "destroyed" };
  }
  if (alive === true) {
    return {
      outcome: "unknown",
      detail: `${destroyText}, but the session still runs`,
      ...destroyCause,
    };
  }
  return {
    outcome: "unknown",
    detail: `${destroyText}, and the liveness check answered ${describeValue(alive)}, not true or false`,
    ...destroyCause,
  };
}

/** `code` of a RuntimeStopUnconfirmedError. */
export const RUNTIME_STOP_UNCONFIRMED_ERROR_CODE = "ERR_RUNTIME_STOP_UNCONFIRMED";

/**
 * A caller refused to go on because the runtime stop was not confirmed
 * (`other-launch` or `unknown`). The message names the outcome, its detail
 * and what the caller kept; `hint` is the next action for the operator.
 */
export class RuntimeStopUnconfirmedError extends Error {
  readonly code = RUNTIME_STOP_UNCONFIRMED_ERROR_CODE;
  readonly sessionId: SessionId;
  readonly outcome: UnconfirmedRuntimeStop["outcome"];
  readonly detail: string;
  readonly hint: string;

  constructor(params: {
    sessionId: SessionId;
    handle: RuntimeHandle;
    stop: UnconfirmedRuntimeStop;
    /** What the caller kept, for example "record and worktree kept". */
    kept: string;
    /** The command that tries again, for example `ao session kill app-1`. */
    retry: string;
  }) {
    const { sessionId, handle, stop, kept, retry } = params;
    super(
      `runtime stop unconfirmed (${stop.outcome}): ${stop.detail}; ${kept}`,
      stop.outcome === "unknown" && stop.cause !== undefined ? { cause: stop.cause } : undefined,
    );
    this.name = "RuntimeStopUnconfirmedError";
    this.sessionId = sessionId;
    this.outcome = stop.outcome;
    this.detail = stop.detail;
    this.hint =
      `Check ${handle.runtimeName} session ${handle.id} by hand and stop it if it still runs, ` +
      `then run \`${retry}\` again. AO goes on only when the runtime answers that the session ` +
      `stopped or does not exist.`;
  }
}

/** True for a RuntimeStopUnconfirmedError, also one from another copy of core. */
export function isRuntimeStopUnconfirmedError(err: unknown): err is RuntimeStopUnconfirmedError {
  return (
    err instanceof RuntimeStopUnconfirmedError ||
    (!!err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === RUNTIME_STOP_UNCONFIRMED_ERROR_CODE &&
      typeof (err as { hint?: unknown }).hint === "string")
  );
}
