/**
 * Herdr fit-2: the typed errors of a runtime create, a refused send and a
 * blocked orchestrator start. Each guard checks the `code` and the whole
 * shape, never `instanceof` alone, so it accepts an error from another copy
 * of core (a plugin can bundle its own). The module has no runtime import:
 * delivery-lock.ts imports it, and child processes of the lock tests load
 * both alone.
 */

import type { RuntimeHandle } from "./types.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a handle of the stored shape: a non-null, non-array object with a
 * string `id`, a non-empty string `runtimeName` and a non-null, non-array
 * object `data`.
 */
export function isWellFormedHandle(value: unknown): value is RuntimeHandle {
  return (
    isObjectRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["runtimeName"] === "string" &&
    value["runtimeName"] !== "" &&
    isObjectRecord(value["data"])
  );
}

/** `code` of RuntimeCreatePartialError. */
export const RUNTIME_CREATE_PARTIAL_ERROR_CODE = "ERR_RUNTIME_CREATE_PARTIAL";

/** `code` of RuntimeSendRefusedError. */
export const RUNTIME_SEND_REFUSED_ERROR_CODE = "ERR_RUNTIME_SEND_REFUSED";

/** `code` of OrchestratorStartBlockedError. */
export const ORCHESTRATOR_START_BLOCKED_ERROR_CODE = "ERR_ORCHESTRATOR_START_BLOCKED";

/**
 * How far a failed create came, by what may exist in the runtime:
 * - `workspace-unconfirmed`: a workspace request was sent, and its answer
 *   does not confirm a usable workspace (none, or one without a usable pane);
 * - `launch-not-submitted`: the workspace exists, and no launch request
 *   reached the runtime;
 * - `launch-unconfirmed`: a launch request was sent, and nothing confirms
 *   that the agent runs in the pane of the handle.
 */
export type RuntimeCreateStage =
  | "workspace-unconfirmed"
  | "launch-not-submitted"
  | "launch-unconfirmed";

const CREATE_STAGES: ReadonlySet<string> = new Set([
  "workspace-unconfirmed",
  "launch-not-submitted",
  "launch-unconfirmed",
]);

/**
 * Thrown by `Runtime.create` when something of the session may exist in the
 * runtime (a request was sent, an answer is unknown, a cleanup is not
 * confirmed). `handle` names what may exist; the runtime closed nothing, and
 * core keeps the record, the workspace and the agent session (a kept failed
 * launch). See `Runtime.create`.
 */
export class RuntimeCreatePartialError extends Error {
  readonly code = RUNTIME_CREATE_PARTIAL_ERROR_CODE;
  readonly closed = "nothing" as const;
  readonly handle: RuntimeHandle;
  readonly stage: RuntimeCreateStage;

  constructor(
    message: string,
    details: { handle: RuntimeHandle; stage: RuntimeCreateStage; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "RuntimeCreatePartialError";
    this.handle = details.handle;
    this.stage = details.stage;
  }
}

/** True for RuntimeCreatePartialError, also from another copy of core. */
export function isRuntimeCreatePartialError(err: unknown): err is RuntimeCreatePartialError {
  if (typeof err !== "object" || err === null) return false;
  const value = err as Record<string, unknown>;
  return (
    value["code"] === RUNTIME_CREATE_PARTIAL_ERROR_CODE &&
    isWellFormedHandle(value["handle"]) &&
    typeof value["stage"] === "string" &&
    CREATE_STAGES.has(value["stage"]) &&
    value["closed"] === "nothing"
  );
}

/**
 * Whether a refused send admitted anything: `none` (no prompt of this send
 * reached the agent), or `earlier-attempt-unconfirmed` (an earlier prompt of
 * this send was sent, and its delivery was not seen).
 */
export type RuntimeSendAdmission = "none" | "earlier-attempt-unconfirmed";

const SEND_ADMISSIONS: ReadonlySet<string> = new Set(["none", "earlier-attempt-unconfirmed"]);

/**
 * Thrown by `Runtime.sendMessage` when the agent is blocked and waits for
 * input (`agent_blocked`). The runtime sent no raw text and no key after it:
 * they could answer the agent's question. Core does not restore the session
 * for it; the operator answers the agent in its pane.
 */
export class RuntimeSendRefusedError extends Error {
  readonly code = RUNTIME_SEND_REFUSED_ERROR_CODE;
  readonly reason = "agent_blocked" as const;
  readonly admitted: RuntimeSendAdmission;
  /** The pane ID of the agent. */
  readonly target: string;
  /** Where the send stopped, for example "first settle wait". */
  readonly stage: string;

  constructor(
    message: string,
    details: { admitted: RuntimeSendAdmission; target: string; stage: string; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "RuntimeSendRefusedError";
    this.admitted = details.admitted;
    this.target = details.target;
    this.stage = details.stage;
  }
}

/** True for RuntimeSendRefusedError, also from another copy of core. */
export function isRuntimeSendRefusedError(err: unknown): err is RuntimeSendRefusedError {
  if (typeof err !== "object" || err === null) return false;
  const value = err as Record<string, unknown>;
  return (
    value["code"] === RUNTIME_SEND_REFUSED_ERROR_CODE &&
    value["reason"] === "agent_blocked" &&
    typeof value["admitted"] === "string" &&
    SEND_ADMISSIONS.has(value["admitted"]) &&
    typeof value["target"] === "string" &&
    typeof value["stage"] === "string"
  );
}

/** Why an orchestrator start was blocked. */
export type OrchestratorStartBlockedReason =
  | "records"
  | "records-unreadable"
  | "records-changed"
  | "admission-busy"
  | "admission-unsupported"
  | "admission-path";

const START_BLOCKED_REASONS: ReadonlySet<string> = new Set([
  "records",
  "records-unreadable",
  "records-changed",
  "admission-busy",
  "admission-unsupported",
  "admission-path",
]);

/** Why a record blocks an orchestrator start. */
export type BlockingLaunchKind =
  | "in-progress"
  | "damaged"
  | "create-incomplete"
  | "not-reused"
  | "unproven";

/** A record that blocks an orchestrator start, with what the operator needs to check it. */
export interface BlockingLaunch {
  sessionId: string;
  kind: BlockingLaunchKind;
  /** Why it blocks, as text. */
  reason: string;
  status: string;
  launchFailed: boolean;
  /** The stored handle text (its first 80 characters) when it does not parse. */
  handle?: string;
  pane?: string;
  terminal?: string;
  workspace?: string;
  worktree?: string;
  socket?: string;
  bin?: string;
  /** The answer of the probe, as text. */
  answer?: string;
  /** The ao process that still launches it (`in-progress`). */
  launcherPid?: number;
  /** `launchIdentityToken` of the record. */
  identityToken: string;
}

/**
 * Thrown when an orchestrator start of project `projectId` starts nothing:
 * a record blocks it (`blocking`), or the admission cannot run. Nothing was
 * written for the start.
 */
export class OrchestratorStartBlockedError extends Error {
  readonly code = ORCHESTRATOR_START_BLOCKED_ERROR_CODE;
  readonly projectId: string;
  readonly reason: OrchestratorStartBlockedReason;
  readonly blocking: BlockingLaunch[];

  constructor(
    message: string,
    details: {
      projectId: string;
      reason: OrchestratorStartBlockedReason;
      blocking?: BlockingLaunch[];
      cause?: unknown;
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "OrchestratorStartBlockedError";
    this.projectId = details.projectId;
    this.reason = details.reason;
    this.blocking = details.blocking ?? [];
  }
}

/** True for OrchestratorStartBlockedError, also from another copy of core. */
export function isOrchestratorStartBlockedError(
  err: unknown,
): err is OrchestratorStartBlockedError {
  if (typeof err !== "object" || err === null) return false;
  const value = err as Record<string, unknown>;
  return (
    value["code"] === ORCHESTRATOR_START_BLOCKED_ERROR_CODE &&
    typeof value["projectId"] === "string" &&
    typeof value["reason"] === "string" &&
    START_BLOCKED_REASONS.has(value["reason"]) &&
    Array.isArray(value["blocking"])
  );
}
