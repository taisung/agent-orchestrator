/**
 * Session Manager — CRUD for agent sessions.
 *
 * Orchestrates Runtime, Agent, and Workspace plugins to:
 * - Spawn new sessions (create workspace → create runtime → launch agent)
 * - List sessions (from metadata + live runtime checks)
 * - Kill sessions (agent → runtime → workspace cleanup)
 * - Cleanup completed sessions (PR merged / issue closed)
 * - Send messages to running sessions
 *
 * Reference: scripts/claude-ao-session, scripts/send-to-session
 */

import {
  statSync,
  existsSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
  unlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import {
  AgentNotAttachedError,
  isAgentDeliveryError,
  isAgentNotAttachedError,
  isIssueNotFoundError,
  isLaunchEndUnproven,
  isRestorable,
  isUnprovenLaunchRecord,
  LAUNCH_GRACE_MS,
  NON_RESTORABLE_STATUSES,
  RUNTIME_NO_SERVER_ERROR_CODE,
  SESSION_STATUS,
  SessionLaunchInProgressError,
  SessionNotFoundError,
  SessionNotRestorableError,
  SessionRelaunchRefusedError,
  TERMINAL_STATUSES,
  WorkspaceMissingError,
  type OpenCodeSessionManager,
  type Session,
  type SessionId,
  type SessionSpawnConfig,
  type OrchestratorSpawnConfig,
  type CleanupResult,
  type ClaimPROptions,
  type ClaimPRResult,
  type OrchestratorConfig,
  type ProjectConfig,
  type Runtime,
  type Agent,
  type Workspace,
  type Tracker,
  type SCM,
  type PluginRegistry,
  type RuntimeHandle,
  type Issue,
  type AgentLaunchConfig,
  type AgentLaunchConfirmation,
  type AgentDeliveryAttempt,
  type AgentMessageDelivery,
  type PreparedAgentSession,
  type SessionMessageDelivery,
  type SessionRelaunchChild,
  type SessionRelaunchOptions,
  type SessionRelaunchPlan,
  type SessionRelaunchResult,
  type SessionStatus,
  type RuntimePaneState,
  type RuntimeStopOutcome,
  type SessionKillOptions,
  PR_STATE,
} from "./types.js";
import {
  readMetadataRaw,
  readMetadataStrict,
  readArchivedMetadataRaw,
  readArchivedMetadataStrict,
  updateArchivedMetadata,
  updateMetadataIf,
  GENERATION_KEY,
  RESERVATION_KEY,
  deleteMetadata,
  holdsExpected,
  launchIdentity,
  launchIdentityToken,
  listMetadata,
  reserveSessionRecord,
  withRecordLock,
} from "./metadata.js";
import { buildPrompt } from "./prompt-builder.js";
import { generateOrchestratorPrompt } from "./orchestrator-prompt.js";
import { HERDR_RUNTIME_NAME, isHerdrPaneId, isHerdrPinError } from "./herdr.js";
import { shellEscape } from "./utils.js";
import {
  getSessionsDir,
  getStateRoot,
  getWorktreesDir,
  getProjectBaseDir,
  getDeliveryLedgerDir,
  generateConfigHash,
  generateTmuxName,
  validateAndStoreOrigin,
} from "./paths.js";
import {
  beginDelivery,
  DELIVERY_UNRECORDED_HOLD_MS,
  deliveryLedgerPath,
  removeDeliveryLedger,
  removeExpiredDeliveryLedgers,
  settleDelivery,
  type DeliveryAttempt,
} from "./delivery-ledger.js";
import {
  admissionLock,
  holdDeliveryLock,
  isDeliveryLockSupported,
  type DeliveryLock,
} from "./delivery-lock.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import {
  getOpenCodeSession,
  findOpenCodeSessionsByTitle,
  removeOpenCodeSession,
  interruptOpenCodeSession,
  OpenCodeApiTimeoutError,
  OPENCODE_API_TIMEOUT_MS,
  type OpenCodeApiSession,
} from "./opencode-api.js";
import { normalizeOrchestratorSessionStrategy } from "./orchestrator-session-strategy.js";
import {
  OrchestratorStartBlockedError,
  isRuntimeCreatePartialError,
  isRuntimeSendRefusedError,
  isWellFormedHandle,
  type BlockingLaunch,
  type BlockingLaunchKind,
  type OrchestratorStartBlockedReason,
  type RuntimeCreatePartialError,
} from "./runtime-errors.js";
import { sessionFromMetadata } from "./utils/session-from-metadata.js";
import { safeJsonParse } from "./utils/validation.js";
import { isSafeBranchName } from "./utils/branch-name.js";
import { resolveAgentSelection, resolveSessionRole } from "./agent-selection.js";
import { AGENT_PANE_KEY, agentPaneOf, exactPaneTarget, exactSessionTarget } from "./tmux.js";
import {
  isRuntimeStopConfirmed,
  isRuntimeStopUnconfirmedError,
  RuntimeStopUnconfirmedError,
  stopRuntime,
  type UnconfirmedRuntimeStop,
} from "./runtime-stop.js";

const execFileAsync = promisify(execFile);
const OPENCODE_DISCOVERY_TIMEOUT_MS = OPENCODE_API_TIMEOUT_MS;
const OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS = OPENCODE_API_TIMEOUT_MS;

/**
 * Bound on `Agent.confirmLaunch`: the pane must run the agent on its prepared
 * session within it (0009 section 11 step 2).
 */
const LAUNCH_CONFIRM_TIMEOUT_MS = 15_000;

/**
 * Bound on the wait for the launch prompt to reach the agent session. as-63
 * showed the first `user` message 1.5 s after the TUI started.
 */
const LAUNCH_PROMPT_CONFIRM_TIMEOUT_MS = 10_000;

/**
 * Session relaunch (2026-10-22): the bound on each liveness answer that a
 * relaunch needs before it acts. No answer in time is unknown, and unknown
 * refuses.
 */
const RELAUNCH_PROBE_TIMEOUT_MS = 10_000;

/** How often a relaunch looks for the agent process after the start. */
const RELAUNCH_CONFIRM_POLL_MS = 500;

/** Immediate tries of the end-state write of a relaunch, before the later tries. */
const RELAUNCH_SETTLE_TRIES = 3;

/**
 * The first wait before a later try of the end-state write (review r1 M-3);
 * it doubles up to RELAUNCH_SETTLE_RETRY_MAX_MS.
 */
const RELAUNCH_SETTLE_RETRY_MS = 1_000;
const RELAUNCH_SETTLE_RETRY_MAX_MS = 30_000;

/**
 * Session relaunch (review r1 M-1, M-4): the record keys of a launch's token.
 * A spawn, an orchestrator start and a relaunch write a new random token
 * (`AgentLaunchConfig.launchToken`), the launch time that it belongs to
 * (`createdAt` of a spawn, `restoredAt` of a relaunch) and, for a relaunch,
 * the pane ID. They count only while that launch time is still the
 * record's last launch: a restore (which does not write them) changes
 * `restoredAt`, so the token of the launch before it no longer counts.
 */
const LAUNCH_TOKEN_KEY = "launchToken";
const LAUNCH_TOKEN_AT_KEY = "launchTokenAt";
const LAUNCH_PANE_KEY = "launchPane";

/**
 * The foreground commands of a pane that shows a shell prompt. A relaunch
 * from another shell types its launch line only into one of these.
 */
const RELAUNCH_SHELLS: ReadonlySet<string> = new Set([
  "bash",
  "zsh",
  "sh",
  "dash",
  "fish",
  "ksh",
  "mksh",
  "tcsh",
  "csh",
]);

/** A shell variable name, for the `export` lines of a relaunch script. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Session relaunch: write the launch script of a relaunch, as runtime-tmux
 * writes one for a long launch command (`ao-launch-<uuid>.sh` in the temp
 * directory, mode 0700, it removes itself). It goes to the workspace and
 * exports the relaunch environment before the launch command, so the agent
 * gets the environment of a spawn whether the pane's shell or the caller
 * runs it. With `exec` (a launch command that is one simple command), bash
 * replaces itself with the agent, so a signal to the script's process
 * reaches the agent itself (review r1 M-2).
 */
function writeRelaunchScript(
  workspacePath: string,
  environment: Record<string, string>,
  launchCommand: string,
  exec: boolean,
): string {
  const exports = Object.entries(environment).map(([key, value]) => {
    if (!ENV_NAME.test(key)) {
      throw new Error(`Invalid environment variable name for a relaunch: ${JSON.stringify(key)}`);
    }
    return `export ${key}=${shellEscape(value)}`;
  });
  const scriptPath = join(tmpdir(), `ao-launch-${randomUUID()}.sh`);
  const content = [
    "#!/usr/bin/env bash",
    'rm -- "$0" 2>/dev/null || true',
    `cd -- ${shellEscape(workspacePath)} || exit 1`,
    ...exports,
    exec ? `exec ${launchCommand}` : launchCommand,
    "",
  ].join("\n");
  writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  return scriptPath;
}

/** Shell words that start a compound command, so `exec <word> ...` does not work. */
const SHELL_RESERVED_WORDS: ReadonlySet<string> = new Set([
  "!",
  "[[",
  "{",
  "case",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "select",
  "then",
  "time",
  "until",
  "while",
]);

/**
 * Session relaunch (review r1 M-2): true when `command` is one simple shell
 * command that `exec` can replace bash with. Its first word is a plain
 * command name (not a variable assignment, not a reserved word), and no
 * control operator, redirection, grouping, backquote or newline is outside
 * quotes. A `$(...)` command substitution counts when its own text follows
 * the same rule (Claude Code: `--append-system-prompt "$(cat '<file>')"`).
 */
function isExecableCommand(command: string): boolean {
  const first = /^([^\s'"\\]+)(?:\s|$)/.exec(command)?.[1];
  if (!first || first.includes("=") || first.includes("$") || SHELL_RESERVED_WORDS.has(first)) {
    return false;
  }
  // Scan from `start` until the end (depth 0) or the `)` of a `$(` (depth > 0).
  const scan = (start: number, depth: number): number => {
    let i = start;
    let quoted = false;
    while (i < command.length) {
      const char = command[i];
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (!quoted && char === "'") {
        const end = command.indexOf("'", i + 1);
        if (end < 0) return -1;
        i = end + 1;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        i += 1;
        continue;
      }
      if (char === "$" && command[i + 1] === "(") {
        const end = scan(i + 2, depth + 1);
        if (end < 0) return -1;
        i = end + 1;
        continue;
      }
      if (char === "`" || char === "\n") return -1;
      if (!quoted) {
        if (char === ")" && depth > 0) return i;
        if (";&|<>(){}".includes(char)) return -1;
      }
      i += 1;
    }
    return depth === 0 && !quoted ? i : -1;
  };
  return scan(0, 0) === command.length;
}

/**
 * The record's last launch time as stored: a valid `restoredAt`, else
 * `createdAt` (the string of `lastLaunchOf`).
 */
function lastLaunchValue(raw: Readonly<Record<string, string>>): string {
  const restoredAt = raw["restoredAt"] ?? "";
  return Number.isFinite(Date.parse(restoredAt)) ? restoredAt : (raw["createdAt"] ?? "");
}

/**
 * The launch token and pane of the record's last launch, or null when the
 * last launch wrote none (a restore, or a launch of an older build).
 */
function lastLaunchBinding(
  raw: Readonly<Record<string, string>>,
): { token: string; pane: string | null } | null {
  const token = raw[LAUNCH_TOKEN_KEY];
  const at = raw[LAUNCH_TOKEN_AT_KEY];
  if (!token || !at || at !== lastLaunchValue(raw)) return null;
  return { token, pane: raw[LAUNCH_PANE_KEY] || null };
}

/**
 * Session relaunch: true when the record's status lets a relaunch go on. A
 * terminal status refuses, except a kill that a liveness probe gave (the
 * rule of the lifecycle's `isRecoverableKill`: `killedReason` `runtime` or
 * `agent-exited`, or a kill from before the key without a PR). That is the
 * record of an agent that ended while its pane can still run it.
 */
function isRelaunchableStatus(raw: Readonly<Record<string, string>>): boolean {
  const status = raw["status"] ?? "";
  if (status === SESSION_STATUS.KILLED) return isRecoverableKillRecord(raw);
  return !TERMINAL_STATUSES.has(status as SessionStatus);
}

/** A killed record whose kill came from a liveness probe (see isRelaunchableStatus). */
function isRecoverableKillRecord(raw: Readonly<Record<string, string>>): boolean {
  if (raw["status"] !== SESSION_STATUS.KILLED) return false;
  const reason = raw["killedReason"];
  return reason === "runtime" || reason === "agent-exited" || (!reason && !raw["pr"]);
}

/**
 * The record's last launch: a valid `restoredAt`, else `createdAt` (the
 * lifecycle's `launchedAt`); NaN when neither parses.
 */
function lastLaunchOf(raw: Readonly<Record<string, string>>): number {
  const restoredAt = Date.parse(raw["restoredAt"] ?? "");
  return Number.isFinite(restoredAt) ? restoredAt : Date.parse(raw["createdAt"] ?? "");
}

/**
 * Session relaunch: the answer of `check` within RELAUNCH_PROBE_TIMEOUT_MS.
 * A rejection, or no answer in time, throws.
 */
async function answerWithin<T>(what: string, check: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${what} did not answer within ${RELAUNCH_PROBE_TIMEOUT_MS / 1000} s`),
            ),
          RELAUNCH_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Session relaunch (review r1 M-7): how `run` ended within `ms`: its value,
 * its rejection, or no answer in time (the promise is then left alone).
 */
async function outcomeWithin<T>(
  run: () => Promise<T>,
  ms: number,
): Promise<{ kind: "value"; value: T } | { kind: "error"; error: unknown } | { kind: "timeout" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run().then(
        (value) => ({ kind: "value" as const, value }),
        (error: unknown) => ({ kind: "error" as const, error }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), Math.max(0, ms));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Session relaunch: `answerWithin`, and only a boolean is an answer (an
 * answer that is not a boolean is no proof either way, review r1 M-3).
 */
async function booleanAnswerWithin(what: string, check: () => Promise<unknown>): Promise<boolean> {
  const answer = await answerWithin(what, check);
  if (typeof answer !== "boolean") {
    throw new Error(`${what} answered ${String(answer)}, not true or false`);
  }
  return answer;
}

/** One line for the operator on stderr, where the command itself still succeeds. */
function warnOperator(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** The error text on one line: an `execFile` message ends with a newline. */
function shortErrorText(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** The `code` of a Node file-system error, or undefined. */
function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** The entries of a directory; none when it does not exist. Another error throws. */
function readdirOrEmpty(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if (errorCode(err) === "ENOENT") return [];
    throw err;
  }
}

/**
 * Round 8 (M-1): throw unless the record file of `sessionId` is missing. A
 * path that cannot be checked (`existsSync` answers false for it too) or a
 * file that is there now is not "gone".
 */
function assertNoRecordFile(sessionsDir: string, sessionId: string): void {
  try {
    statSync(join(sessionsDir, sessionId));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return;
    throw err;
  }
  throw new Error(`the record of ${sessionId} exists but was not read`);
}

/**
 * Round 8 (M-1): `readMetadataRaw`, but null only when the record file is
 * missing. A record that cannot be read or checked throws.
 */
function readRecordStrict(sessionsDir: string, sessionId: string): Record<string, string> | null {
  const record = readMetadataRaw(sessionsDir, sessionId);
  if (!record) assertNoRecordFile(sessionsDir, sessionId);
  return record;
}

/**
 * Round 8 (M-1): the session IDs that have a record file, as `listMetadata`
 * lists them, but an entry that cannot be checked throws: `listMetadata`
 * leaves it out, and a holder check must not miss a record that it cannot
 * read.
 */
function listRecordIds(sessionsDir: string): string[] {
  return readdirOrEmpty(sessionsDir).filter((id) => {
    if (id === "archive" || id.startsWith(".") || !/^[a-zA-Z0-9_-]+$/.test(id)) return false;
    try {
      return statSync(join(sessionsDir, id)).isFile();
    } catch (err) {
      if (errorCode(err) === "ENOENT") return false;
      throw err;
    }
  });
}

/**
 * The result of a check of a launch's own record (see `ownLaunchRecord`).
 * Round 8 (M-1): "unknown" when the check could not read the record.
 */
type LaunchCheck =
  | { state: "own" | "gone" | "replaced"; current: Record<string, string> | null }
  | { state: "unknown"; current: null; error: unknown };

/** A workspace that a failed launch removes (see `rollbackLaunch`). */
interface RollbackWorkspace {
  path: string;
  /** The plugin destroy, with the rollback's check as `stillOwned`. */
  destroy(stillOwned: () => boolean): Promise<void>;
}

/**
 * Remove the agent session that this spawn created, on a failed spawn. The
 * hook never throws by contract; a throw anyway must not replace the error
 * that caused the cleanup. Round 7 (M-3): `stillUnheld` goes to the hook,
 * which runs it before each of its calls.
 */
async function discardPreparedSession(
  prepared: PreparedAgentSession | undefined,
  stillUnheld?: () => boolean,
): Promise<void> {
  if (!prepared) return;
  try {
    await prepared.discard(stillUnheld);
  } catch (err) {
    warnOperator(
      `ao: could not remove the agent session of a failed spawn: ${shortErrorText(err)}`,
    );
  }
}

/** The launch config with the values of `prepareAgentSession` in `agentConfig`. */
function withPreparedAgentConfig(
  launchConfig: AgentLaunchConfig,
  prepared: PreparedAgentSession,
): AgentLaunchConfig {
  return {
    ...launchConfig,
    projectConfig: {
      ...launchConfig.projectConfig,
      agentConfig: { ...launchConfig.projectConfig.agentConfig, ...prepared.agentConfig },
    },
  };
}

/** The operator line when `confirmLaunch` did not see the launch prompt arrive. */
function warnLaunchPromptNotSeen(sessionId: string): void {
  warnOperator(
    `ao: ${sessionId} runs, but its launch prompt did not show in the agent session within ${LAUNCH_PROMPT_CONFIRM_TIMEOUT_MS / 1000} s. Check the pane with \`ao session attach ${sessionId}\`, and send the task with \`ao send ${sessionId}\` if the agent waits.`,
  );
}

/** True when the launch command gives the agent a prompt. */
function launchHasPrompt(launchConfig: AgentLaunchConfig): boolean {
  return Boolean(launchConfig.prompt || launchConfig.systemPromptFile || launchConfig.systemPrompt);
}

/**
 * B-1: record keys that name the `ao` process of a launch in progress. A
 * spawn with `prepareAgentSession` reserves the record with them in it (M-5:
 * the record never exists without them), keeps them through `confirmLaunch`,
 * and then removes them; a failed launch deletes the whole record. While
 * that process runs, the shared-ID guard counts the record as a live holder,
 * also before its pane exists, and `kill`, `restore`, `remap` and an
 * orchestrator start refuse to remove or replace the record. The rule does
 * not read `status`, which the lifecycle's first poll can overwrite with
 * `killed`.
 */
const LAUNCH_PID_KEY = "launchPid";
const LAUNCH_PID_START_KEY = "launchPidStart";

/** The update that removes the launch keys. */
const CLEARED_LAUNCH_CLAIM: Record<string, string> = {
  [LAUNCH_PID_KEY]: "",
  [LAUNCH_PID_START_KEY]: "",
};

/**
 * The start time of process `pid`, so that a reused PID does not count:
 * field 22 of `/proc/<pid>/stat` (clock ticks since boot). Without `/proc`,
 * the text of `ps -o lstart=`. Null when the process does not exist or is a
 * zombie.
 */
async function processStartToken(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (existsSync("/proc/self/stat")) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf-8");
      // Field 2 (the command name) can hold spaces and parentheses.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z" || fields[0] === "X") return null;
      const start = fields[19];
      return start && /^\d+$/.test(start) ? `stat:${start}` : null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "lstart=", "-p", String(pid)], {
      timeout: 1_500,
    });
    const start = stdout.trim();
    return start ? `ps:${start}` : null;
  } catch {
    return null;
  }
}

/** The launch keys of this `ao` process, or null when its start time cannot be read. */
async function currentLaunchClaim(): Promise<Record<string, string> | null> {
  const start = await processStartToken(process.pid);
  return start ? { [LAUNCH_PID_KEY]: String(process.pid), [LAUNCH_PID_START_KEY]: start } : null;
}

/**
 * The launch keys of this `ao` process for a spawn that prepares its agent
 * session. The spawn reads them before it reserves the record, and the
 * reservation creates the record with them. Without a readable start time
 * the reservation is empty and the launch goes on unprotected, as before
 * B-1, and the operator gets one line that says so.
 */
async function readLaunchClaim(): Promise<Record<string, string> | null> {
  const claim = await currentLaunchClaim();
  if (!claim) {
    warnOperator(
      `ao: could not read the start time of ao process ${process.pid}; until the pane of this launch runs, another ao command can take it for a dead launch.`,
    );
  }
  return claim;
}

/**
 * The PID of the `ao` process that still launches this record: the recorded
 * PID runs and has the recorded start time. Null when the record has no
 * launch keys, when that process is gone (a crashed launcher does not
 * protect its ID), or when the PID now names another process.
 */
async function liveLaunchOwner(raw: Record<string, string>): Promise<number | null> {
  const pidText = raw[LAUNCH_PID_KEY];
  const recordedStart = raw[LAUNCH_PID_START_KEY];
  if (!pidText || !recordedStart || !/^\d+$/.test(pidText)) return null;
  const pid = Number(pidText);
  const start = await processStartToken(pid);
  return start !== null && start === recordedStart ? pid : null;
}

/**
 * B-2: refuse to remove or replace a record while its launch is in progress.
 * The launcher would go on and write the record again (with an agent session
 * that the refused operation removed), and both commands would report
 * success. A dead launcher (gone, zombie, or its PID reused) does not block.
 */
async function assertNoLiveLauncher(
  sessionId: SessionId,
  raw: Record<string, string>,
  action: string,
): Promise<void> {
  const launcher = await liveLaunchOwner(raw);
  if (launcher !== null) throw new SessionLaunchInProgressError(sessionId, launcher, action);
}

/**
 * Herdr fit-2 (design r11 4.4): the pending handle P of a launch whose create
 * runtime is in LAUNCH_END_UNPROVEN_RUNTIMES. Spawn and start write it in the
 * reservation, and restore in its transition write, before any runtime of
 * the launch exists: a crashed launch then leaves a record that names its
 * runtime. Its empty ID names no pane, so no probe or stop calls the runtime.
 */
function pendingHandle(runtimeName: string): RuntimeHandle {
  return { id: "", runtimeName, data: { createIncomplete: "create-pending" } };
}

/** The launch keys of this process as a launch wrote them (currentLaunchClaim). */
type LaunchClaim = Readonly<Record<string, string>>;

/**
 * One clear of an own launch claim (Herdr fit-2 4.5 and session relaunch,
 * design r11 section 6): one conditional write of the cleared claim while
 * the record holds the claim pair `claim` (and `identity`, when given).
 * "done": written; "retry": the write answered null, which proves nothing
 * (the record changed, or `existsSync` could not check the directory).
 * With `extra` (the relaunch's end state), the record is read first under
 * the same lock: "gone" when it does not hold those values, else the write
 * adds `extra(current)`.
 */
function clearOwnLaunchClaimOnce(
  sessionsDir: string,
  sessionId: SessionId,
  claim: LaunchClaim,
  options: {
    identity?: Readonly<Record<string, string>>;
    extra?: (current: Readonly<Record<string, string>>) => Record<string, string>;
  } = {},
): "done" | "gone" | "retry" {
  const expected = { ...(options.identity ?? {}), ...claim };
  const { extra } = options;
  return withRecordLock(sessionsDir, sessionId, () => {
    let updates: Record<string, string> = { ...CLEARED_LAUNCH_CLAIM };
    if (extra) {
      const current = readMetadataRaw(sessionsDir, sessionId);
      if (!current || !holdsExpected(current, expected)) return "gone";
      updates = { ...updates, ...extra(current) };
    }
    return updateMetadataIf(sessionsDir, sessionId, expected, updates) ? "done" : "retry";
  });
}

/**
 * Herdr fit-2 (design r11 4.5): clear this operation's own launch claim
 * `ownClaim` while the record holds `identity` (the launch identity of this
 * operation's last own write) and that claim pair; no write when `ownClaim`
 * is null. "settled": cleared. "nothing": the record is gone, names another
 * launch, or holds other claim values (a later operation's claim, or none);
 * another operation's claim is never cleared. An attempt that does not take
 * effect is no proof (`updateMetadataIf` answers null also when `existsSync`
 * cannot check the directory): one strict read follows, and while the record
 * still holds both, one more attempt. A second attempt without effect
 * throws, and so does a read or write error.
 */
function settleOwnClaim(
  sessionsDir: string,
  sessionId: SessionId,
  identity: Readonly<Record<string, string>>,
  ownClaim: LaunchClaim | null,
): "settled" | "nothing" {
  if (!ownClaim) return "nothing";
  const attempt = () => clearOwnLaunchClaimOnce(sessionsDir, sessionId, ownClaim, { identity });
  if (attempt() === "done") return "settled";
  const current = readRecordStrict(sessionsDir, sessionId);
  if (!current || !holdsExpected(current, { ...identity, ...ownClaim })) return "nothing";
  if (attempt() === "done") return "settled";
  throw new Error(
    `the launch claim of ${sessionId} could not be cleared: its record held this launch and its claim, and the clear took no effect twice`,
  );
}

/**
 * Herdr fit-2 (design r11 4.5): "ao: the launch claim of <id> may remain
 * (<error>); ...", for a settlement that threw.
 */
function claimMayRemainWarning(sessionId: SessionId, ownClaim: LaunchClaim, err: unknown): string {
  return `ao: the launch claim of ${sessionId} may remain (${shortErrorText(err)}); while ao process ${ownClaim[LAUNCH_PID_KEY]} (start ${ownClaim[LAUNCH_PID_START_KEY]}) runs, AO treats the launch as in progress.`;
}

/** The record with `updates` merged as `updateMetadataIf` merges them (undefined keeps a key). */
function mergedRecord(
  record: Readonly<Record<string, string>>,
  updates: Partial<Record<string, string>>,
): Record<string, string> {
  const next: Record<string, string> = { ...record };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** The answer of publishOwnLaunch. */
type OwnPublication =
  | { outcome: "written"; record: Record<string, string> }
  | { outcome: "not-own" }
  | {
      outcome: "unwritable";
      before: Record<string, string>;
      after: Record<string, string>;
      lastRead: "pending" | "unknown";
      error: unknown;
    };

/**
 * Herdr fit-2 (design r11 4.5, the publication rule): put this launch's
 * runtime handle into its own record, `owned`. Two fixed identities, computed
 * once from `owned` and the exact `updates`: `before` (the record as this
 * launch wrote it last) and `after` (that record with the updates). An
 * attempt writes `updates` only while the record holds `before`. An attempt
 * that throws or answers null is undecided, and one strict read decides it:
 * the record holds `after` (the attempt took effect, also when it threw):
 * written; it holds `before`: one retry with the same `updates` (after the
 * retry: unwritable); it holds neither, or no record: not own; the read
 * throws: unwritable. At most two writes and two reads; only a record that
 * holds the fixed `after` is adopted.
 */
function publishOwnLaunch(
  sessionsDir: string,
  sessionId: SessionId,
  owned: Readonly<Record<string, string>>,
  updates: Partial<Record<string, string>>,
): OwnPublication {
  const before = launchIdentity(owned);
  const after = launchIdentity(mergedRecord(owned, updates));
  for (let attempt = 1; ; attempt++) {
    let error: unknown = new Error(
      `the conditional write of the record of ${sessionId} took no effect`,
    );
    try {
      const written = updateMetadataIf(sessionsDir, sessionId, before, updates);
      if (written) return { outcome: "written", record: written };
    } catch (err) {
      error = err;
    }
    let current: Record<string, string> | null;
    try {
      current = readRecordStrict(sessionsDir, sessionId);
    } catch (readErr) {
      return { outcome: "unwritable", before, after, lastRead: "unknown", error: readErr };
    }
    if (current && holdsExpected(current, after)) return { outcome: "written", record: current };
    if (!current || !holdsExpected(current, before)) return { outcome: "not-own" };
    if (attempt >= 2) return { outcome: "unwritable", before, after, lastRead: "pending", error };
  }
}

/**
 * Herdr fit-2 (design r11 4.5): the handle publication of a spawn or start
 * could not be decided (the record cannot be read or written now). The
 * post-create catch passes it to the rollback, which removes nothing.
 */
class LaunchRecordUnwritableError extends Error {
  constructor(
    sessionId: SessionId,
    readonly before: Record<string, string>,
    readonly after: Record<string, string>,
    readonly lastRead: "pending" | "unknown",
    readonly handle: RuntimeHandle,
    cause: unknown,
  ) {
    super(
      `the record of ${sessionId} could not be written with the handle of this launch (${lastRead === "pending" ? "it still held its state before the write" : "it could not be read"}): ${shortErrorText(cause)}`,
      { cause },
    );
    this.name = "LaunchRecordUnwritableError";
  }
}

/** The pane, terminal, workspace and socket of a Herdr handle, for a warning. */
function describeHandleInMemory(handle: RuntimeHandle): string {
  const text = (key: string): string => {
    const value = handle.data?.[key];
    return typeof value === "string" && value ? value : "unknown";
  };
  return `${handle.runtimeName} pane ${handle.id || "unknown"} (terminal ${text("terminalId")}, workspace ${text("workspaceId")}, socket ${text("herdrSocket")})`;
}

/**
 * The end of every text that points to a retirement (design r11 4.5): the
 * owner's check, then F-9 with the identity token of the launch.
 */
function retireLine(sessionId: SessionId, token: string): string {
  return `Check the runtime by hand (design 5.4.3), then retire the record: ao session kill ${sessionId} --confirm-runtime-closed ${token}.`;
}

/**
 * Herdr fit-2 (design r11 4.5, the unwritable path): the record of a launch
 * cannot be read or written now. AO removes nothing (no stop, no
 * agent-session discard, no workspace removal, no release, no copy-back
 * removal) and keeps the handle in memory, which may already be on disk.
 * With an own claim it makes the final owner-conditional settlements: on the
 * fixed `before`, and when that takes no effect, on the fixed `after` (with
 * no strict read after them: the warning covers the uncertain case). Then it
 * warns once, with the variant that says what AO knows.
 */
function keepUnwritableLaunch(context: {
  sessionsDir: string;
  sessionId: SessionId;
  error: unknown;
  handle: RuntimeHandle;
  worktree: string;
  agentSession: string;
  before: Readonly<Record<string, string>>;
  after?: Readonly<Record<string, string>>;
  ownClaim: LaunchClaim | null;
}): void {
  const { sessionsDir, sessionId, ownClaim } = context;
  const recordFile = join(sessionsDir, sessionId);
  const settleOn = (identity: Readonly<Record<string, string>>): "done" | "none" | "threw" => {
    if (!ownClaim) return "none";
    try {
      return clearOwnLaunchClaimOnce(sessionsDir, sessionId, ownClaim, { identity }) === "done"
        ? "done"
        : "none";
    } catch {
      return "threw";
    }
  };
  let settled: "before" | "after" | null = null;
  const onBefore = settleOn(context.before);
  if (onBefore === "done") settled = "before";
  else if (onBefore === "none" && context.after && settleOn(context.after) === "done") {
    settled = "after";
  }
  const beforeHandle = safeJsonParse<RuntimeHandle>(context.before["runtimeHandle"] ?? "");
  const beforeText =
    beforeHandle?.data?.["createIncomplete"] === "create-pending"
      ? "the pending handle"
      : `the handle of pane ${beforeHandle?.id || "unknown"}`;
  const claimText = ownClaim
    ? `The launch claim of ao process ${ownClaim[LAUNCH_PID_KEY]} (start ${ownClaim[LAUNCH_PID_START_KEY]}) may remain in the record, and the record may hold the pending handle or the handle above. While that process runs, AO treats the launch as in progress, and ao start, kill and F-9 refuse it.`
    : "The record may hold the pending handle or the handle above.";
  // Not settled: the record may hold either fixed identity; F-9 refuses
  // a token that no longer names the record and prints the current one.
  const beforeToken = launchIdentityToken(context.before);
  const afterToken = context.after ? launchIdentityToken(context.after) : null;
  const retire =
    settled === "before"
      ? retireLine(sessionId, beforeToken)
      : settled === "after" && afterToken
        ? retireLine(sessionId, afterToken)
        : `${retireLine(sessionId, "<identity token>")} The identity token is ${beforeToken} while the record holds this launch's state before the write${afterToken ? `, and ${afterToken} while it holds the handle above` : ""}; ao status shows it.`;
  const variant =
    settled === "before"
      ? `AO cleared its launch claim while the record held this launch's state before the write (${beforeText}). The handle above is not recorded.`
      : settled === "after"
        ? "The record holds the handle above: the write took effect although it threw. AO cleared its launch claim."
        : `${claimText} Check runtimeHandle, restoredAt, launchPid and launchPidStart in ${recordFile} before you retire the record.`;
  warnOperator(
    `ao: the record of ${sessionId} could not be read or written (${shortErrorText(context.error)}), so AO removed nothing: no runtime stop, no agent-session discard, no workspace removal and no record removal. ` +
      `The handle of this launch: ${describeHandleInMemory(context.handle)}; record file ${recordFile}; worktree ${context.worktree}; agent session ${context.agentSession}. ` +
      `${variant} ${retire}`,
  );
}

/**
 * m-13: refuse a stored or external branch that is not safe for git.
 * The check runs before any `git`/`gh` call; a refusal runs no git.
 */
function assertSafeBranchForSession(sessionId: string, branch: string): void {
  if (!isSafeBranchName(branch)) {
    throw new Error(
      `Session ${sessionId}: branch metadata "${branch}" is not valid: not a valid branch name`,
    );
  }
}

/**
 * The directories that the OpenCode session of a workspace can carry in
 * `location.directory`. A spawn sends the real path of the workspace (the
 * pane of earlier builds sent `process.cwd()`, also the real path), so a
 * workspace path behind a symlink is searched under both names.
 */
function openCodeDirectoriesFor(workspacePath: string): string[] {
  const directories = [resolve(workspacePath)];
  try {
    directories.push(realpathSync(workspacePath));
  } catch {
    // A missing path has no real path; the given path is the only candidate.
  }
  return [...new Set(directories)];
}

function describeOpenCodeCandidate(session: OpenCodeApiSession): string {
  const created = session.time?.created;
  const createdText =
    typeof created === "number" && Number.isFinite(created)
      ? new Date(created).toISOString()
      : "unknown";
  return `${session.id}  directory ${session.location?.directory ?? "unknown"}  created ${createdText}`;
}

/**
 * Remove an OpenCode session. True when it is gone (removed, a 404, or no
 * valid ID); false when `stillUnheld` answered false and the session stays.
 */
async function deleteOpenCodeSession(
  sessionId: string,
  stillUnheld: () => boolean,
  env?: Record<string, string>,
): Promise<boolean> {
  const validatedSessionId = asValidOpenCodeSessionId(sessionId);
  if (!validatedSessionId) return true;
  // Rows 9 and 21: `session.remove` by ID. A 404 (already removed) is success.
  // On another error, retry, then throw with `cause` from the helper; `kill`
  // purge warns (and archives anyway), `cleanup` records an error entry. A
  // timeout ends the retries: three tries of a hanging service cost three
  // full bounds (about 30 s) and the third answers no sooner than the first.
  // Round 6 (M-1): the retries wait, and another session can take the ID
  // meanwhile. `stillUnheld` is the caller's ownership check; it runs
  // directly before each attempt, with no await between the check and the
  // attempt. When it answers false, no further attempt is made. An error
  // that it throws ends the attempts and goes to the caller unchanged.
  const retryDelaysMs = [0, 200, 600];
  let lastError: unknown;
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!stillUnheld()) return false;
    try {
      await removeOpenCodeSession(validatedSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS, env);
      return true;
    } catch (err) {
      lastError = err;
      if (err instanceof OpenCodeApiTimeoutError) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function interruptOpenCodeSessionBestEffort(sessionId: string): Promise<void> {
  const validatedSessionId = asValidOpenCodeSessionId(sessionId);
  if (!validatedSessionId) return;
  // Row 20 (`ao session kill --purge-session`): stop a running loop before
  // the delete. The interrupt is best effort (a 404 is already gone, and the
  // remove runs even when the interrupt hangs). The `kill` caller removes
  // the session after it checks the record again (round 5, 1.0.1); the
  // remove throws after its retries, and the kill warns and archives anyway.
  // `cleanup` never interrupts (archived sessions are not running).
  try {
    await interruptOpenCodeSession(validatedSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS);
  } catch {
    // Best effort: fall through to the remove even when the interrupt hangs.
  }
}

/** Escape regex metacharacters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Get the next session number for a project. */
function getNextSessionNumber(existingSessions: string[], prefix: string): number {
  let max = 0;
  const pattern = new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`);
  for (const name of existingSessions) {
    const match = name.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max + 1;
}

function getSessionNumber(sessionId: string, prefix: string): number | undefined {
  const match = sessionId.match(new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`));
  if (!match) return undefined;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const PR_TRACKING_STATUSES: ReadonlySet<string> = new Set([
  "pr_open",
  "ci_failed",
  "review_pending",
  "changes_requested",
  "approved",
  "mergeable",
]);

const STALE_PR_OWNERSHIP_STATUSES: ReadonlySet<string> = new Set([
  ...PR_TRACKING_STATUSES,
  "merged",
]);

const SEND_RESTORE_READY_TIMEOUT_MS = 5_000;
const SEND_RESTORE_READY_POLL_MS = 500;
const SEND_CONFIRMATION_ATTEMPTS = 6;
const SEND_CONFIRMATION_POLL_MS = 500;
const SEND_CONFIRMATION_OUTPUT_LINES = 20;
const SEND_BOOTSTRAP_READY_TIMEOUT_MS = 20_000;
const SEND_BOOTSTRAP_STABLE_POLLS = 2;

/** SHA-256 (hex) of the UTF-8 message text: the delivery ledger compares sends by it. */
function messageSha256(message: string): string {
  return createHash("sha256").update(message, "utf-8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The answer of `getTmuxForegroundCommand` when no session of that exact name exists. */
const TMUX_PANE_GONE = Symbol("tmux pane gone");

/**
 * The foreground command of the session's pane (the agent's pane when the
 * handle names one, review r2 M-1), `TMUX_PANE_GONE` when the session or
 * that pane does not exist, or null when tmux could not answer. tmux 3.4
 * prints empty format values and exits 0 for a target that does not exist,
 * so empty output means gone, not unknown. The agent's pane counts only
 * while it belongs to the handle's session (review r3 M-3: a pane keeps its
 * ID when it moves to another session); a moved pane is gone.
 */
async function getTmuxForegroundCommand(
  handle: RuntimeHandle,
): Promise<string | typeof TMUX_PANE_GONE | null> {
  const agentPane = agentPaneOf(handle);
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      agentPane
        ? ["display-message", "-p", "-t", agentPane, "#{session_name} #{pane_current_command}"]
        : ["display-message", "-p", "-t", exactPaneTarget(handle.id), "#{pane_current_command}"],
      { timeout: 5_000 },
    );
    let command = stdout.trim();
    if (agentPane) {
      const owner = `${handle.id} `;
      if (!command.startsWith(owner)) return TMUX_PANE_GONE;
      command = command.slice(owner.length).trim();
    }
    return command.length > 0 ? command : TMUX_PANE_GONE;
  } catch {
    return null;
  }
}

/** Herdr fit-2 (design r11 4.2): the default wait for the admission lock A. */
const ADMISSION_WAIT_MS = 30_000;

/** Herdr fit-2 (design r11 4.7): the core bound of each probe, and of each stop under A. */
const ADMISSION_PROBE_TIMEOUT_MS = 10_000;

/** Herdr fit-2 (design r11 5.3.2): the admission rounds of one operation. */
const ADMISSION_ROUNDS = 3;

/** A bound in milliseconds as text, for example "10 s" or "0.2 s". */
function secondsText(ms: number): string {
  return `${ms / 1000} s`;
}

/** The first line of an error text, at most 200 characters. */
function firstErrorLine(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).split("\n")[0]?.trim() ?? "";
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/**
 * Herdr fit-2 (design r11 4.7): the answer of the classifier for an old
 * orchestrator record. `notBoolean` marks an answer of `isAlive` that is not
 * a boolean (review r1 M-3, 2026-10-22: `undefined`, `null` or `0` from a
 * faulty plugin is no proof of death).
 */
export type OrchestratorLiveness =
  | { state: "alive" }
  | { state: "ended"; reason: string }
  | { state: "unknown"; reason: string; cause?: unknown; notBoolean?: boolean };

/**
 * Herdr fit-2 (design r11 4.7): the liveness of an old orchestrator record by
 * one `isAlive` of `runtime` (the handle's runtime, `runtimeForHandle`) with
 * the core bound `probeTimeoutMs`. `isAlive` true is alive. A runtime outside
 * LAUNCH_END_UNPROVEN_RUNTIMES has ended when it answers false or rejects
 * with RUNTIME_NO_SERVER_ERROR_CODE (no session can exist then, as after a
 * host restart). For a runtime in the set (herdr) neither is "ended" (owner
 * decision OQ-F1 (b)): a server can still run the launch where the endpoint
 * does not reach it, and pane IDs come back after a restart, so before RH no
 * Herdr answer proves that a launch ended. No plugin, any other rejection, an
 * answer that is not a boolean and no answer in time are unknown.
 */
export async function classifyOrchestratorLiveness(
  runtime: Runtime | null,
  handle: RuntimeHandle,
  probeTimeoutMs: number = ADMISSION_PROBE_TIMEOUT_MS,
): Promise<OrchestratorLiveness> {
  const runtimeName = handle.runtimeName || runtime?.name || "unknown";
  const unproven = isLaunchEndUnproven(runtimeName);
  if (!runtime) return { state: "unknown", reason: `no ${runtimeName} runtime plugin is loaded` };
  const answer = await outcomeWithin(async () => runtime.isAlive(handle), probeTimeoutMs);
  if (answer.kind === "timeout") {
    return {
      state: "unknown",
      reason: `the ${runtimeName} check did not answer within ${secondsText(probeTimeoutMs)}`,
    };
  }
  if (answer.kind === "error") {
    const err = answer.error;
    if (isHerdrPinError(err)) {
      return { state: "unknown", reason: `its ${runtimeName} pins are malformed`, cause: err };
    }
    if (errorCode(err) === RUNTIME_NO_SERVER_ERROR_CODE) {
      return unproven
        ? {
            state: "unknown",
            reason: `no ${runtimeName} server answers at the socket`,
            cause: err,
          }
        : { state: "ended", reason: `no ${runtimeName} server runs (${firstErrorLine(err)})` };
    }
    return {
      state: "unknown",
      reason: `the ${runtimeName} check failed: ${firstErrorLine(err)}`,
      cause: err,
    };
  }
  if (answer.value === true) return { state: "alive" };
  if (answer.value === false) {
    return unproven
      ? {
          state: "unknown",
          reason: `${runtimeName} answered that the pane does not exist or that it has another terminal`,
        }
      : { state: "ended", reason: `${runtimeName} answered that ${handle.id} does not exist` };
  }
  return {
    state: "unknown",
    reason: `the liveness check answered ${String(answer.value)}, not true or false`,
    notBoolean: true,
  };
}

/**
 * The liveness of a project-mode orchestrator record of a runtime outside
 * LAUNCH_END_UNPROVEN_RUNTIMES, before `spawnOrchestrator` reuses or replaces
 * it (today's rule, with the classifier): true is alive, false is ended;
 * unknown throws, so the record is neither reused nor archived. Core G
 * decides a record of a runtime in the set before this runs; the classifier
 * never answers "ended" for one.
 */
async function outsideSetOrchestratorAlive(
  runtime: Runtime | null,
  handle: RuntimeHandle,
  sessionId: SessionId,
  probeTimeoutMs: number,
): Promise<boolean> {
  const liveness = await classifyOrchestratorLiveness(runtime, handle, probeTimeoutMs);
  if (liveness.state === "alive") return true;
  if (liveness.state === "ended") return false;
  if (liveness.notBoolean) {
    throw new Error(
      `Cannot tell whether session ${sessionId} is alive (${liveness.reason}), so it is neither reused nor replaced. Check the runtime and retry.`,
    );
  }
  throw new Error(
    `Cannot tell whether session ${sessionId} is alive, so it is neither reused nor replaced. Check the runtime and retry.`,
    { cause: liveness.cause ?? new Error(liveness.reason) },
  );
}

/**
 * Herdr fit-2 (design r11 5.3.8): a record that blocks an orchestrator start,
 * with what message M needs beyond BlockingLaunch.
 */
interface BlockedRecord {
  launch: BlockingLaunch;
  /** `<state>` of message M. */
  state: string;
  /** The `createIncomplete` stage of the stored handle. */
  stage?: string;
  /** The label of the herdr workspace (the session or tmux name). */
  label: string;
  /** True when the stored handle has both pins (herdrBin, herdrSocket). */
  pinned: boolean;
}

/** The lines of one record in message M (design r11 5.3.8); each value in a command is shell-quoted. */
function blockedRecordLines(record: BlockedRecord): string[] {
  const { launch, state } = record;
  const id = launch.sessionId;
  if (launch.kind === "in-progress") {
    return [
      `${id}: ${state}.`,
      `  Wait for ao process ${launch.launcherPid}; if it hangs, stop that process, then run ao start again.`,
    ];
  }
  if (launch.kind === "damaged") {
    return [
      `${id}: ${state}. Its runtime handle cannot be read (${launch.handle ?? ""}). Retire it by hand: docs/DEVELOPMENT.md, "Retire a Herdr record by hand".`,
    ];
  }
  const worktree = launch.worktree ?? "unknown";
  const lines = [
    `${id}: ${state}. Herdr pane ${launch.pane || "(none)"} (terminal ${launch.terminal ?? "unknown"}), workspace ${launch.workspace ?? "unknown"}, worktree ${worktree}, socket ${launch.socket ?? "not recorded"}: ${launch.answer ?? "not checked"}.`,
  ];
  const bin = shellEscape(launch.bin ?? HERDR_RUNTIME_NAME);
  const at =
    record.pinned && launch.socket ? `HERDR_SOCKET_PATH=${shellEscape(launch.socket)} ` : "";
  const lookFor = `(look for the label ${shellEscape(record.label)} and the cwd ${shellEscape(worktree)})`;
  if (record.stage === "create-pending") {
    lines.push(
      `  AO did not record the endpoint of this launch: it is the endpoint of the ao process that started it (its HERDR_SOCKET_PATH, else its HERDR_SESSION, else the default socket).`,
      `  Check:  ${bin} workspace list ${lookFor}`,
    );
  } else if (!launch.pane) {
    lines.push(`  Check:  ${at}${bin} workspace list ${lookFor}`);
  } else {
    lines.push(`  Check:  ${at}${bin} pane get ${shellEscape(launch.pane)}`);
    lines.push(`  If it runs, use it:  ao session attach ${shellEscape(id)}`);
  }
  lines.push(
    `  If it does not run, or after you close it:  ao session kill ${shellEscape(id)} --confirm-runtime-closed ${shellEscape(launch.identityToken)}`,
  );
  return lines;
}

/** Message M (design r11 5.3.8): the message of a start that records block. */
function blockedStartMessage(projectId: string, records: readonly BlockedRecord[]): string {
  return [
    `No new orchestrator was started for project ${projectId}: AO cannot tell that every earlier herdr orchestrator launch of the project ended.`,
    ...records.flatMap(blockedRecordLines),
    "Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.",
  ].join("\n");
}

/** Herdr fit-2 (design r11 4.1, 5.3.8): an OrchestratorStartBlockedError with one sentence. */
function startBlocked(
  projectId: string,
  reason: Exclude<OrchestratorStartBlockedReason, "records">,
  cause?: unknown,
  detail?: string,
): OrchestratorStartBlockedError {
  const message =
    reason === "records-unreadable"
      ? `The session records of project ${projectId} could not be read (${shortErrorText(cause)}); no orchestrator was started.`
      : reason === "admission-busy"
        ? `Another ao process is admitting an orchestrator for project ${projectId} now. Run ao start again after it ends.`
        : reason === "admission-unsupported"
          ? "This platform has no admission lock; AO starts no herdr orchestrator here."
          : reason === "admission-path"
            ? `AO cannot fix the admission path of project ${projectId} (${detail ?? shortErrorText(cause)}); no orchestrator was started.`
            : `The orchestrator records of project ${projectId} changed during the check; run ao start again.`;
  return new OrchestratorStartBlockedError(message, { projectId, reason, cause });
}

/** Reconstruct a Session object from raw metadata key=value pairs. */
function metadataToSession(
  sessionId: SessionId,
  meta: Record<string, string>,
  projectId: string,
  createdAt?: Date,
  modifiedAt?: Date,
): Session {
  const session = sessionFromMetadata(sessionId, meta, {
    projectId,
    createdAt,
    lastActivityAt: modifiedAt ?? new Date(),
  });
  // Session relaunch (review r2 M-1): the pane that the record binds to its
  // last launch is the agent's pane, for every reader of the agent.
  const pane = lastLaunchBinding(meta)?.pane;
  if (session.runtimeHandle && pane) {
    session.runtimeHandle = withAgentPane(session.runtimeHandle, pane);
  }
  return session;
}

/**
 * Session relaunch (review r2 M-1): a tmux handle that names the agent's
 * pane (AGENT_PANE_KEY), so its process check, its activity and the
 * lifecycle read that pane and not the session's current window. Kept in
 * memory only; the stored handle never has it. Another runtime's handle is
 * returned as it is.
 */
function withAgentPane(handle: RuntimeHandle, paneId: string): RuntimeHandle {
  if (handle.runtimeName !== "tmux" || !/^%\d+$/.test(paneId)) return handle;
  return { ...handle, data: { ...handle.data, [AGENT_PANE_KEY]: paneId } };
}

/**
 * Herdr fit-2 (design r11 4.2): a stage of an orchestrator admission, for the
 * test hook `SessionManagerDeps.admission.onStage`.
 */
export type AdmissionStage =
  | "subject-fixed"
  | "lock-held"
  | "sessions-dir-ready"
  | "before-reservation"
  | "transition-written";

export interface SessionManagerDeps {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  /**
   * Herdr fit-2 (design r11 4.2), for tests: the wait for the admission lock
   * A (`waitMs`, default 30 000), the core bound of each probe and of each
   * stop under A (`probeTimeoutMs`, default 10 000), and a hook that each
   * admission awaits at its stages (`info.selected`: the records that G1
   * selected in the round, 0 before G1 runs). Production code passes nothing.
   */
  admission?: {
    waitMs?: number;
    probeTimeoutMs?: number;
    onStage?: (stage: AdmissionStage, info: { selected: number }) => Promise<void>;
  };
}

/** Create a SessionManager instance. */
export function createSessionManager(deps: SessionManagerDeps): OpenCodeSessionManager {
  const { config, registry } = deps;

  interface LocatedSession {
    raw: Record<string, string>;
    sessionsDir: string;
    project: ProjectConfig;
    projectId: string;
  }

  interface ActiveSessionRecord {
    sessionName: string;
    raw: Record<string, string>;
    modifiedAt?: Date;
  }

  /**
   * Get the sessions directory for a project.
   */
  function getProjectSessionsDir(project: ProjectConfig): string {
    return getSessionsDir(config.configPath, project.path);
  }

  function normalizePath(path: string): string {
    return resolve(path).replace(/\/$/, "");
  }

  function isPathInside(path: string, parentPath: string): boolean {
    const normalizedPath = normalizePath(path);
    const normalizedParent = normalizePath(parentPath);
    return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
  }

  function getManagedWorkspaceRoots(project: ProjectConfig, projectId?: string): string[] {
    const roots = [getWorktreesDir(config.configPath, project.path)];
    const legacyIds = new Set<string>();
    if (projectId) {
      legacyIds.add(projectId);
    }
    legacyIds.add(basename(project.path));

    for (const id of legacyIds) {
      roots.push(join(homedir(), ".worktrees", id));
    }

    return roots;
  }

  function shouldDestroyWorkspacePath(
    project: ProjectConfig | undefined,
    projectId: string | undefined,
    workspacePath: string,
  ): boolean {
    if (!project) return false;
    if (normalizePath(workspacePath) === normalizePath(project.path)) return false;

    const roots = getManagedWorkspaceRoots(project, projectId);
    return roots.some((root) => isPathInside(workspacePath, root));
  }

  function listArchivedSessionIds(sessionsDir: string): string[] {
    const archiveDir = join(sessionsDir, "archive");
    if (!existsSync(archiveDir)) return [];
    const ids = new Set<string>();
    for (const file of readdirSync(archiveDir)) {
      const match = file.match(/^([a-zA-Z0-9_-]+)_\d/);
      if (match?.[1]) ids.add(match[1]);
    }
    return [...ids];
  }

  /**
   * Round 9 (M-1): `listArchivedSessionIds` for a holder decision. Only a
   * missing archive directory (`ENOENT`) has no archives: `existsSync`
   * answers false also for a directory that it cannot check (`EACCES` on a
   * parent, `ELOOP`), so any other error of the directory read throws.
   */
  function listArchivedSessionIdsStrict(sessionsDir: string): string[] {
    const ids = new Set<string>();
    for (const file of readdirOrEmpty(join(sessionsDir, "archive"))) {
      const match = file.match(/^([a-zA-Z0-9_-]+)_\d/);
      if (match?.[1]) ids.add(match[1]);
    }
    return [...ids];
  }

  /**
   * Same-ID R4 (B-7 item 1): the archived session IDs that a new session
   * number must not take. An archive directory that cannot be listed stops
   * the allocation before any reservation: an archive in it may hold the
   * next number. Only a missing directory (`ENOENT`) has no archives.
   */
  function listArchivedSessionIdsForAllocation(sessionsDir: string): string[] {
    try {
      return listArchivedSessionIdsStrict(sessionsDir);
    } catch (err) {
      const archiveDir = join(sessionsDir, "archive");
      throw new Error(
        `Cannot choose a session number: the archive directory ${archiveDir} could not be listed (${shortErrorText(err)}), and an archived session may hold the next number; nothing was created. Make ${archiveDir} readable (or remove it when it holds no archive), then try again`,
        { cause: err },
      );
    }
  }

  function isOrchestratorSessionRecord(
    sessionId: string,
    raw: Record<string, string> | null | undefined,
    sessionPrefix?: string,
  ): boolean {
    if (!raw) return false;
    if (raw["role"] === "orchestrator" || sessionId.endsWith("-orchestrator")) return true;
    // Check the -orchestrator-N pattern only when the prefix is known so the
    // regex is anchored to the project prefix, preventing false-positives when
    // the user-configured sessionPrefix itself ends with "-orchestrator".
    if (sessionPrefix) {
      return new RegExp(`^${escapeRegex(sessionPrefix)}-orchestrator-\\d+$`).test(sessionId);
    }
    return false;
  }

  function isCleanupProtectedSession(
    project: ProjectConfig,
    sessionId: string,
    metadata?: Record<string, string> | null,
  ): boolean {
    return isOrchestratorSessionRecord(sessionId, metadata ?? {}, project.sessionPrefix);
  }

  function applyMetadataUpdatesToRaw(
    raw: Record<string, string>,
    updates: Partial<Record<string, string>>,
  ): Record<string, string> {
    let next = { ...raw };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if (value === "") {
        const { [key]: _removed, ...rest } = next;
        void _removed;
        next = rest;
        continue;
      }
      next[key] = value;
    }
    return next;
  }

  /**
   * The repair on read. 1.2: it writes only into the record version that it
   * read (`generation`, plus `pr` and `status`, which the bash metadata
   * helpers change without a new generation); when the record changed or is
   * gone, it writes nothing and the next read repairs again. Returns the
   * written record, or null.
   */
  function updateMetadataPreservingMtime(
    sessionsDir: string,
    sessionName: string,
    readRaw: Readonly<Record<string, string>>,
    updates: Partial<Record<string, string>>,
    modifiedAt?: Date,
  ): Record<string, string> | null {
    const metaPath = join(sessionsDir, sessionName);
    let preservedMtime = modifiedAt;
    if (!preservedMtime) {
      try {
        preservedMtime = statSync(metaPath).mtime;
      } catch {
        preservedMtime = undefined;
      }
    }

    // Round 5 (B-2): the launch too, so a record of an earlier build without
    // a generation that a new launch replaced is not repaired from this read.
    const written = updateMetadataIf(
      sessionsDir,
      sessionName,
      {
        [GENERATION_KEY]: readRaw[GENERATION_KEY],
        ...launchIdentity(readRaw),
        pr: readRaw["pr"],
        status: readRaw["status"],
      },
      updates,
    );

    if (!written || !preservedMtime) return written;
    try {
      utimesSync(metaPath, preservedMtime, preservedMtime);
    } catch {
      void 0;
    }
    return written;
  }

  function repairSingleSessionMetadataOnRead(
    sessionsDir: string,
    record: ActiveSessionRecord,
    sessionPrefix?: string,
  ): ActiveSessionRecord {
    const repaired = { ...record, raw: { ...record.raw } };
    if (!isOrchestratorSessionRecord(repaired.sessionName, repaired.raw, sessionPrefix)) {
      return repaired;
    }

    const updates: Partial<Record<string, string>> = {};
    if (repaired.raw["role"] !== "orchestrator") {
      updates["role"] = "orchestrator";
    }
    if (repaired.raw["pr"]) {
      updates["pr"] = "";
    }
    if (repaired.raw["prAutoDetect"] !== "off") {
      updates["prAutoDetect"] = "off";
    }
    if (STALE_PR_OWNERSHIP_STATUSES.has(repaired.raw["status"] ?? "")) {
      updates["status"] = "working";
    }

    if (Object.keys(updates).length > 0) {
      const written = updateMetadataPreservingMtime(
        sessionsDir,
        repaired.sessionName,
        repaired.raw,
        updates,
        repaired.modifiedAt,
      );
      repaired.raw = written ?? applyMetadataUpdatesToRaw(repaired.raw, updates);
    }

    return repaired;
  }

  function sessionMetadataTimestamp(record: ActiveSessionRecord): number {
    const metadataTimestamp = Date.parse(record.raw["restoredAt"] ?? record.raw["createdAt"] ?? "");
    if (record.modifiedAt) return record.modifiedAt.getTime();
    return Number.isNaN(metadataTimestamp) ? 0 : metadataTimestamp;
  }

  function repairSessionMetadataOnRead(
    sessionsDir: string,
    records: ActiveSessionRecord[],
    sessionPrefix?: string,
  ): ActiveSessionRecord[] {
    const repaired = records.map((record) => ({ ...record, raw: { ...record.raw } }));
    const duplicatePRAttachments = new Map<string, ActiveSessionRecord[]>();

    for (const record of repaired) {
      if (isOrchestratorSessionRecord(record.sessionName, record.raw, sessionPrefix)) {
        record.raw = repairSingleSessionMetadataOnRead(sessionsDir, record, sessionPrefix).raw;
        continue;
      }

      const prUrl = record.raw["pr"];
      if (!prUrl) continue;

      const attached = duplicatePRAttachments.get(prUrl) ?? [];
      attached.push(record);
      duplicatePRAttachments.set(prUrl, attached);
    }

    for (const attachedRecords of duplicatePRAttachments.values()) {
      if (attachedRecords.length < 2) continue;

      const [owner, ...staleRecords] = [...attachedRecords].sort((a, b) => {
        const trackingDiff =
          Number(PR_TRACKING_STATUSES.has(b.raw["status"] ?? "")) -
          Number(PR_TRACKING_STATUSES.has(a.raw["status"] ?? ""));
        if (trackingDiff !== 0) return trackingDiff;

        const timestampDiff = sessionMetadataTimestamp(b) - sessionMetadataTimestamp(a);
        if (timestampDiff !== 0) return timestampDiff;

        return b.sessionName.localeCompare(a.sessionName);
      });

      void owner;

      for (const record of staleRecords) {
        const updates: Partial<Record<string, string>> = {
          pr: "",
          prAutoDetect: "off",
          ...(PR_TRACKING_STATUSES.has(record.raw["status"] ?? "") ? { status: "working" } : {}),
        };
        const written = updateMetadataPreservingMtime(
          sessionsDir,
          record.sessionName,
          record.raw,
          updates,
          record.modifiedAt,
        );
        record.raw = written ?? applyMetadataUpdatesToRaw(record.raw, updates);
      }
    }

    return repaired;
  }

  function loadActiveSessionRecords(project: ProjectConfig): ActiveSessionRecord[] {
    const sessionsDir = getProjectSessionsDir(project);
    if (!existsSync(sessionsDir)) return [];

    const records = listMetadata(sessionsDir).flatMap((sessionName) => {
      const raw = readMetadataRaw(sessionsDir, sessionName);
      if (!raw) return [];

      let modifiedAt: Date | undefined;
      try {
        modifiedAt = statSync(join(sessionsDir, sessionName)).mtime;
      } catch {
        void 0;
      }

      return [{ sessionName, raw, modifiedAt } satisfies ActiveSessionRecord];
    });

    return repairSessionMetadataOnRead(sessionsDir, records, project.sessionPrefix);
  }

  /**
   * Mark the archived record whose OpenCode session was removed. B-1 (round
   * 4): only an archive that still names that OpenCode session (a newer
   * archive of the ID that names another one keeps its ID).
   */
  function markArchivedOpenCodeCleanup(
    sessionsDir: string,
    sessionId: SessionId,
    removedOpenCodeSessionId: string,
  ): void {
    updateArchivedMetadata(
      sessionsDir,
      sessionId,
      { opencodeSessionId: "", opencodeCleanedAt: new Date().toISOString() },
      { opencodeSessionId: removedOpenCodeSessionId },
    );
  }

  function sortSessionIdsForReuse(ids: string[]): string[] {
    const numericSuffix = (id: string): number | undefined => {
      const match = id.match(/-(\d+)$/);
      if (!match) return undefined;
      const parsed = Number.parseInt(match[1], 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    };

    return [...ids].sort((a, b) => {
      const aNum = numericSuffix(a);
      const bNum = numericSuffix(b);
      if (aNum !== undefined && bNum !== undefined && aNum !== bNum) {
        return bNum - aNum;
      }
      if (aNum !== undefined && bNum === undefined) return -1;
      if (aNum === undefined && bNum !== undefined) return 1;
      return b.localeCompare(a);
    });
  }

  function findOpenCodeSessionIds(
    sessionsDir: string,
    criteria: { issueId?: string; sessionId?: string },
  ): string[] {
    const matchesCriteria = (id: string, raw: Record<string, string> | null): boolean => {
      if (!raw) return false;
      if (raw["agent"] !== "opencode") return false;
      if (criteria.issueId !== undefined && raw["issue"] !== criteria.issueId) return false;
      if (criteria.sessionId !== undefined && id !== criteria.sessionId) return false;
      return true;
    };

    const ids: string[] = [];
    const maybeAdd = (id: string, raw: Record<string, string> | null) => {
      if (!matchesCriteria(id, raw)) return;
      const mapped = asValidOpenCodeSessionId(raw?.["opencodeSessionId"]);
      if (!mapped) return;
      ids.push(mapped);
    };

    for (const id of sortSessionIdsForReuse(listMetadata(sessionsDir))) {
      maybeAdd(id, readMetadataRaw(sessionsDir, id));
    }
    for (const id of sortSessionIdsForReuse(listArchivedSessionIds(sessionsDir))) {
      maybeAdd(id, readArchivedMetadataRaw(sessionsDir, id));
    }

    if (criteria.sessionId) {
      maybeAdd(criteria.sessionId, readArchivedMetadataRaw(sessionsDir, criteria.sessionId));
    }

    return [...new Set(ids)];
  }

  /**
   * Lifecycle status is not evidence of death: a merged or prematurely killed
   * session can still have a live pane. Only two explicit negative liveness
   * checks allow removal; missing handles/plugins, errors and hangs keep the ID.
   * No enrichment or API title search runs as part of this guard.
   */
  async function findLiveOpenCodeSessionHolder(
    sessionsDir: string,
    project: ProjectConfig,
    openCodeSessionId: string,
    exceptSessionId?: SessionId,
  ): Promise<string | undefined> {
    for (const id of listMetadata(sessionsDir)) {
      if (id === exceptSessionId) continue;
      const raw = readMetadataRaw(sessionsDir, id);
      if (!raw || asValidOpenCodeSessionId(raw["opencodeSessionId"]) !== openCodeSessionId)
        continue;
      const reason = await openCodeHolderReason(project, id, raw);
      if (reason) return reason;
    }
    return undefined;
  }

  /**
   * Whether a record other than `sessionId` names OpenCode session
   * `openCodeId`: an active record, or the latest archive of any ID.
   * Same-ID R4 (B-7 items 2 to 4): the reads are strict, and a read that
   * fails answers "held" (true), never "no other record": an active entry
   * that cannot be checked (`listMetadata` leaves it out), an active record
   * that cannot be read, an archive directory that cannot be listed, and a
   * latest archive that cannot be read. Only a missing file or directory
   * (`ENOENT`) names nothing. Round 3 (M-5): a record or latest archive
   * whose content is not a well-formed record (a line without "=", a key
   * that comes twice) also answers "held"; only a well-formed record that
   * does not name `openCodeId` is "not this session".
   */
  function hasOtherOpenCodeRecord(
    sessionsDir: string,
    sessionId: string,
    openCodeId: string,
  ): boolean {
    try {
      for (const id of listRecordIds(sessionsDir)) {
        if (id === sessionId) continue;
        if (readMetadataStrict(sessionsDir, id)?.["opencodeSessionId"] === openCodeId) return true;
      }
      for (const id of listArchivedSessionIdsStrict(sessionsDir)) {
        // The ID has an archive file, so a null here is a removal since.
        const archived = readArchivedMetadataStrict(sessionsDir, id);
        if (!archived || archived["opencodeSessionId"] === openCodeId) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  async function openCodeHolderReason(
    project: ProjectConfig,
    id: string,
    raw: Record<string, string>,
  ): Promise<string | undefined> {
    const unknown = `session ${id} may still use it (liveness could not be checked)`;
    // B-1: a launch in progress publishes the ID before its pane exists, so
    // a missing pane is no evidence of death while its `ao` process runs.
    const launcher = await liveLaunchOwner(raw);
    if (launcher !== null) {
      return `the launch of session ${id} by ao process ${launcher} is in progress`;
    }
    // M-4: a launch that died before the record named its pane (the launch
    // keys and a reused ID only) is a dead holder. Only an old record without
    // launch keys keeps its ID when its liveness cannot be checked.
    if (raw[LAUNCH_PID_KEY] && !raw["runtimeHandle"] && !raw["tmuxName"]) return undefined;
    const handle = raw["runtimeHandle"]
      ? safeJsonParse<RuntimeHandle>(raw["runtimeHandle"])
      : raw["tmuxName"]
        ? {
            id: raw["tmuxName"],
            runtimeName: project.runtime ?? config.defaults.runtime,
            data: {},
          }
        : null;
    if (!handle || !handle.id || !handle.runtimeName || !handle.data) return unknown;
    const runtime = registry.get<Runtime>("runtime", handle.runtimeName);
    const agent = registry.get<Agent>(
      "agent",
      resolveSelectionForSession(project, id, raw).agentName,
    );
    if (!runtime || !agent) return unknown;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const state = await Promise.race([
        (async () => {
          if (await runtime.isAlive(handle)) return "live";
          // The retained runtimes swallow query errors as false. For tmux,
          // require an explicit missing-session diagnostic from an answering server.
          // Herdr has no authoritative negative in the Runtime contract;
          // retain its ID until that contract can distinguish unavailable.
          if (handle.runtimeName === "herdr") return "unknown";
          if (handle.runtimeName === "tmux") {
            try {
              await execFileAsync("tmux", ["has-session", "-t", exactSessionTarget(handle.id)], {
                timeout: 1_500,
              });
              return "live";
            } catch (error) {
              const failure = error as { code?: unknown; stderr?: unknown };
              if (
                failure.code !== 1 ||
                typeof failure.stderr !== "string" ||
                !/can't find session:/.test(failure.stderr)
              ) {
                return "unknown";
              }
            }
          }
          return (await agent.isProcessRunning(handle)) ? "live" : "dead";
        })(),
        new Promise<"unknown">((resolve) => {
          timer = setTimeout(() => resolve("unknown"), 2_000);
        }),
      ]);
      if (state === "live") return `live session ${id} uses it`;
      if (state !== "dead") return unknown;
    } catch {
      return unknown;
    } finally {
      clearTimeout(timer);
    }
    return undefined;
  }

  async function resolveOpenCodeSessionReuse(options: {
    sessionsDir: string;
    project: ProjectConfig;
    criteria: { issueId?: string; sessionId?: string };
    strategy: "reuse" | "delete" | "ignore";
    /** m-1: the environment of the pane that the spawn starts. */
    env?: Record<string, string>;
    /**
     * Round 7 (M-1): the record that the orchestrator start reserved. The
     * delete checks skip the records of `criteria.sessionId`; with `own`, a
     * removal runs only while that ID's record is still this start's.
     */
    own?: OwnLaunchRecord;
  }): Promise<string | undefined> {
    // Row 24: reuse by the stored ID only, no title discovery (owner Q7).
    // The orchestrator `delete` strategy deletes stored IDs only, too; an
    // older OpenCode session that no metadata stores is not found by title.
    const { sessionsDir, project, criteria, strategy, env, own } = options;
    if (strategy === "ignore") return undefined;

    const candidateIds = findOpenCodeSessionIds(sessionsDir, criteria);

    if (strategy === "delete") {
      for (const openCodeSessionId of [...new Set(candidateIds)]) {
        // m-4: keep an ID that another live AO session still runs in. The
        // orchestrator path replaces the session with its own ID, so that
        // record does not count as another holder.
        const namers = openCodeNamers(sessionsDir, openCodeSessionId, criteria.sessionId);
        if (
          await findLiveOpenCodeSessionHolder(
            sessionsDir,
            project,
            openCodeSessionId,
            criteria.sessionId,
          )
        ) {
          continue;
        }
        // Round 5 (1.0.1): the holder check awaited; a record that took the
        // ID meanwhile was not checked, so the session stays. Round 6 (M-1):
        // the compare runs directly before each removal attempt. Round 7
        // (M-1): the compare skips the orchestrator's own ID, so a new
        // reservation or launch of that ID is seen only through `own`: the
        // session stays unless the ID's record is still this start's (a
        // record that is gone or cannot be read keeps it too). Round 8
        // (m-1): a later start finds a kept session only while a record or
        // the latest archive of an ID names it, and another archive of the
        // ID (an archived empty reservation) hides an older one. So each
        // kept session is named to the operator with the removal command.
        // Why the last check kept the session; `takenMeanwhile` when another
        // record took the ID (that record names it, so it stays findable).
        const takenMeanwhile = "another session took the ID during the check";
        let keptBecause: string | undefined;
        const stillUnheld = (): boolean => {
          const checked = own?.checkOrUnknown();
          if (checked?.state === "unknown") {
            keptBecause = `the record of ${criteria.sessionId} could not be read (${shortErrorText(checked.error)})`;
          } else if (checked?.state === "gone") {
            keptBecause = `the record of ${criteria.sessionId} that this start reserved is gone (archived or deleted)`;
          } else if (checked?.state === "replaced") {
            keptBecause = `another reservation, launch or restore of ${criteria.sessionId} replaced the record that this start reserved`;
          } else {
            try {
              keptBecause =
                openCodeNamers(sessionsDir, openCodeSessionId, criteria.sessionId) === namers
                  ? undefined
                  : takenMeanwhile;
            } catch (err) {
              keptBecause = `the records that may name it could not be read (${shortErrorText(err)})`;
            }
          }
          return keptBecause === undefined;
        };
        const removed = await deleteOpenCodeSession(openCodeSessionId, stillUnheld, env);
        if (!removed && keptBecause !== undefined && keptBecause !== takenMeanwhile) {
          const of = criteria.sessionId ?? `issue ${criteria.issueId ?? "?"}`;
          warnOperator(
            `ao: kept OpenCode session ${openCodeSessionId} of ${of}: ${keptBecause}. A later start may not find it; remove it with \`opencode api session.remove --param sessionID=${openCodeSessionId}\` if no session uses it.`,
          );
        }
      }
      return undefined;
    }

    // Reuse: return the first stored ID that still exists (`session.get`).
    // A stored ID that is gone (404) is not replaced by a title match (D5).
    // On timeout or another error the candidate is skipped, so a hanging
    // service does not block the spawn; the spawn proceeds without reuse.
    for (const openCodeSessionId of [...new Set(candidateIds)]) {
      try {
        const existing = await getOpenCodeSession(
          openCodeSessionId,
          OPENCODE_DISCOVERY_TIMEOUT_MS,
          env,
        );
        if (existing) return openCodeSessionId;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async function listRemoteSessionNumbers(project: ProjectConfig): Promise<number[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-remote", "--heads", "origin", `session/${project.sessionPrefix}-*`],
        {
          cwd: project.path,
          timeout: 5_000,
        },
      );

      return stdout
        .split("\n")
        .flatMap((line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return [];

          const ref = trimmed.split(/\s+/)[1] ?? "";
          const match = ref.match(
            new RegExp(`refs/heads/session/${escapeRegex(project.sessionPrefix)}-(\\d+)$`),
          );
          if (!match) return [];

          const parsed = Number.parseInt(match[1], 10);
          return Number.isNaN(parsed) ? [] : [parsed];
        })
        .filter((num: number, index: number, values: number[]) => values.indexOf(num) === index);
    } catch {
      return [];
    }
  }

  async function reserveNextSessionIdentity(
    project: ProjectConfig,
    sessionsDir: string,
    initial: Record<string, string> | null,
  ): Promise<{
    num: number;
    sessionId: string;
    tmuxName: string | undefined;
    record: Record<string, string>;
  }> {
    const usedNumbers = new Set<number>();
    for (const sessionName of [
      ...listMetadata(sessionsDir),
      ...listArchivedSessionIdsForAllocation(sessionsDir),
    ]) {
      const num = getSessionNumber(sessionName, project.sessionPrefix);
      if (num !== undefined) usedNumbers.add(num);
    }
    for (const num of await listRemoteSessionNumbers(project)) {
      usedNumbers.add(num);
    }

    let num = getNextSessionNumber(
      [...usedNumbers].map((value) => `${project.sessionPrefix}-${value}`),
      project.sessionPrefix,
    );
    for (let attempts = 0; attempts < 10_000; attempts++) {
      const sessionId = `${project.sessionPrefix}-${num}`;
      const tmuxName = config.configPath
        ? generateTmuxName(config.configPath, project.sessionPrefix, num)
        : undefined;

      const record = usedNumbers.has(num)
        ? null
        : reserveSessionRecord(sessionsDir, sessionId, initial ?? undefined);
      if (record) {
        return { num, sessionId, tmuxName, record };
      }

      usedNumbers.add(num);
      num += 1;
    }

    throw new Error(
      `Failed to reserve session ID after 10000 attempts (prefix: ${project.sessionPrefix})`,
    );
  }

  /**
   * Reserve a unique orchestrator identity ({prefix}-orchestrator-N) for a worktree-based orchestrator.
   * Unlike worker sessions, orchestrator IDs are assigned locally without remote branch checks.
   */
  function reserveNextOrchestratorIdentity(
    project: ProjectConfig,
    sessionsDir: string,
    initial: Record<string, string> | null,
  ): {
    num: number;
    sessionId: string;
    tmuxName: string | undefined;
    record: Record<string, string>;
  } {
    const orchestratorPrefix = `${project.sessionPrefix}-orchestrator`;
    const usedNumbers = new Set<number>();

    const orchestratorPattern = new RegExp(`^${escapeRegex(orchestratorPrefix)}-(\\d+)$`);
    for (const sessionName of [
      ...listMetadata(sessionsDir),
      ...listArchivedSessionIdsForAllocation(sessionsDir),
    ]) {
      const match = sessionName.match(orchestratorPattern);
      if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) usedNumbers.add(parsed);
      }
    }

    // Build worker-ID patterns for all other projects. If another project has
    // sessionPrefix === orchestratorPrefix (e.g. project B has prefix "app-orchestrator"),
    // then its workers are named "app-orchestrator-1", "app-orchestrator-2", etc. — which
    // would collide with our orchestrator IDs. Detect this impossible configuration early.
    for (const [otherProjectId, otherProject] of Object.entries(config.projects)) {
      const otherPrefix = otherProject.sessionPrefix ?? otherProjectId;
      if (otherPrefix === project.sessionPrefix) continue;
      if (otherPrefix === orchestratorPrefix) {
        // Another project's workers are "{otherPrefix}-\d+" which equals "{orchestratorPrefix}-\d+".
        // Every candidate ID we would generate collides — fail immediately with a clear message.
        throw new Error(
          `Cannot spawn orchestrator for project "${project.sessionPrefix}": the orchestrator ID prefix "${orchestratorPrefix}" ` +
            `conflicts with the session prefix of project "${otherProjectId}" ("${otherPrefix}"). ` +
            `Rename one of the project sessionPrefix values to avoid this overlap.`,
        );
      }
    }

    let num = 1;
    for (let attempts = 0; attempts < 10_000; attempts++) {
      if (!usedNumbers.has(num)) {
        const sessionId = `${orchestratorPrefix}-${num}`;
        const tmuxName = config.configPath
          ? generateTmuxName(config.configPath, orchestratorPrefix, num)
          : undefined;
        const record = reserveSessionRecord(sessionsDir, sessionId, initial ?? undefined);
        if (record) {
          return { num, sessionId, tmuxName, record };
        }
      }
      num += 1;
    }

    throw new Error(
      `Failed to reserve orchestrator session ID after 10000 attempts (prefix: ${orchestratorPrefix})`,
    );
  }

  /** Resolve which plugins to use for a project. */
  function resolvePlugins(project: ProjectConfig, agentName?: string) {
    const runtime = registry.get<Runtime>("runtime", project.runtime ?? config.defaults.runtime);
    const agent = registry.get<Agent>("agent", agentName ?? project.agent ?? config.defaults.agent);
    const workspace = registry.get<Workspace>(
      "workspace",
      project.workspace ?? config.defaults.workspace,
    );
    // After config validation, plugin is always set if tracker/scm exists
    // (either from user config or auto-generated from package/path)
    const tracker = project.tracker?.plugin
      ? registry.get<Tracker>("tracker", project.tracker.plugin)
      : null;
    const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;

    return { runtime, agent, workspace, tracker, scm };
  }

  function resolveSelectionForSession(
    project: ProjectConfig,
    sessionId: string,
    metadata: Record<string, string>,
  ) {
    const role = resolveSessionRole(
      sessionId,
      metadata,
      project.sessionPrefix,
      Object.values(config.projects).map((p) => p.sessionPrefix),
    );
    // C-04 + stored spawn identity: a worker keeps its spawn model via the
    // persisted `model=` key (spawnModelOverride is first in the worker rule)
    // and its spawn permission mode via the persisted `permissions=` key,
    // which wins over the current config so a later config edit cannot
    // change existing sessions. Orchestrators persist neither
    // (OrchestratorSpawnConfig has no model; the mode is forced
    // permissionless at spawn and restore), so stray keys of either kind
    // are ignored for them. A record without the keys (spawned before the
    // change) keeps the legacy behaviour: the current config applies.
    const persistedModel = metadata["model"];
    const persistedPermissions = metadata["permissions"];
    return resolveAgentSelection({
      role,
      project,
      defaults: config.defaults,
      persistedAgent: metadata["agent"],
      ...(role === "worker" && typeof persistedModel === "string" && persistedModel.length > 0
        ? { spawnModelOverride: persistedModel }
        : {}),
      ...(role === "worker" && persistedPermissions !== undefined
        ? { persistedPermissionsOverride: persistedPermissions }
        : {}),
    });
  }

  function findSessionRecord(sessionId: SessionId): LocatedSession | null {
    for (const [projectId, project] of Object.entries(config.projects)) {
      const sessionsDir = getProjectSessionsDir(project);
      const raw = readMetadataRaw(sessionsDir, sessionId);
      if (!raw) continue;

      let modifiedAt: Date | undefined;
      try {
        modifiedAt = statSync(join(sessionsDir, sessionId)).mtime;
      } catch {
        modifiedAt = undefined;
      }

      const repaired = repairSingleSessionMetadataOnRead(
        sessionsDir,
        { sessionName: sessionId, raw, modifiedAt },
        project.sessionPrefix,
      );

      return { raw: repaired.raw, sessionsDir, project, projectId };
    }

    return null;
  }

  function requireSessionRecord(sessionId: SessionId): LocatedSession {
    const located = findSessionRecord(sessionId);
    if (!located) {
      throw new SessionNotFoundError(sessionId);
    }
    return located;
  }

  /**
   * Herdr fit-2 F-9 (design r11 5.4.2 step 1, review r1 sol M-1): the record
   * as stored, read strictly and with no read repair, so that a refusal
   * changes nothing. A record that cannot be read or checked throws.
   */
  function requireSessionRecordStrict(sessionId: SessionId): LocatedSession {
    for (const [projectId, project] of Object.entries(config.projects)) {
      const sessionsDir = getProjectSessionsDir(project);
      const raw = readRecordStrict(sessionsDir, sessionId);
      if (raw) return { raw, sessionsDir, project, projectId };
    }
    throw new SessionNotFoundError(sessionId);
  }

  /**
   * Ensure session has a runtime handle (fabricate one if missing) and enrich
   * with live runtime state + activity detection. Used by both list() and get().
   */
  async function ensureHandleAndEnrich(
    session: Session,
    sessionName: string,
    project: ProjectConfig,
    plugins: ReturnType<typeof resolvePlugins>,
  ): Promise<void> {
    // I-2: no title auto-discovery here (owner Q7). The stored ID comes from
    // the spawn (row 23) or from a manual `ao session remap` (row 22).
    const tmuxNameFromMetadata = session.metadata["tmuxName"]?.trim();
    const hasTmuxNameFromMetadata =
      typeof tmuxNameFromMetadata === "string" && tmuxNameFromMetadata.length > 0;
    const handleFromMetadata = session.runtimeHandle !== null || hasTmuxNameFromMetadata;
    if (!handleFromMetadata) {
      session.runtimeHandle = {
        id: sessionName,
        runtimeName: project.runtime ?? config.defaults.runtime,
        data: {},
      };
    } else if (!session.runtimeHandle && hasTmuxNameFromMetadata) {
      session.runtimeHandle = {
        id: tmuxNameFromMetadata,
        runtimeName: project.runtime ?? config.defaults.runtime,
        data: {},
      };
    }
    await enrichSessionWithRuntimeState(session, plugins, handleFromMetadata);
  }

  /**
   * Enrich session with live runtime state (alive/exited) and activity detection.
   * Mutates the session object in place.
   */
  const TERMINAL_SESSION_STATUSES = new Set(["killed", "done", "merged", "terminated", "cleanup"]);

  async function enrichSessionWithRuntimeState(
    session: Session,
    plugins: ReturnType<typeof resolvePlugins>,
    handleFromMetadata: boolean,
  ): Promise<void> {
    // Resolve the runtime from the HANDLE, not from config. A session created
    // under one runtime must keep being probed by that runtime even after the
    // project's configured runtime changes, otherwise flipping the default
    // routes live sessions to a plugin that knows nothing about them.
    // Herdr fit-2 (design r11 4.6): a handle of a runtime in
    // LAUNCH_END_UNPROVEN_RUNTIMES that is not loaded gets no probe.
    const runtime = session.runtimeHandle
      ? runtimeForHandle(session.runtimeHandle, plugins.runtime)
      : plugins.runtime;

    // Check runtime liveness first — regardless of session status. A terminal
    // status must not force activity to "exited" while the agent is still alive:
    // an agent commonly keeps working in tmux after its PR is merged.
    //
    // Liveness is only trusted when the handle came from metadata. Fabricated
    // handles (constructed as fallback for external sessions) should NOT override
    // status to "killed" — we don't know if the session ever had a tmux session,
    // and we'd clobber meaningful statuses like "pr_open".
    if (handleFromMetadata && session.runtimeHandle && runtime) {
      try {
        // Only false is dead. An answer that is not a boolean is no answer
        // (review r1 M-3, 2026-10-22), as a rejection: the stored status stays.
        const alive: unknown = await runtime.isAlive(session.runtimeHandle);
        if (alive === false) {
          // Process confirmed dead. Only claim "killed" if the session wasn't
          // already in a terminal state — otherwise keep merged/done/cleanup.
          if (!TERMINAL_SESSION_STATUSES.has(session.status)) {
            session.status = "killed";
          }
          session.activity = "exited";
          return;
        }
      } catch {
        // Can't check liveness — continue to activity detection
      }
    }

    // Detect activity independently of runtime handle and session status.
    // Activity detection reads JSONL files on disk — it only needs workspacePath,
    // not a runtime handle. Gating on runtimeHandle caused sessions created by
    // external scripts (which don't store runtimeHandle) to always show "unknown".
    if (plugins.agent) {
      try {
        const detected = await plugins.agent.getActivityState(session, config.readyThresholdMs);
        if (detected !== null) {
          session.activity = detected.state;
          if (detected.timestamp && detected.timestamp > session.lastActivityAt) {
            session.lastActivityAt = detected.timestamp;
          }
        }
      } catch {
        // Can't detect activity — keep existing value
      }

      // Enrich with live agent session info (summary, cost).
      try {
        const info = await plugins.agent.getSessionInfo(session);
        if (info) {
          session.agentInfo = info;
        }
      } catch {
        // Can't get session info — keep existing values
      }
    }
  }

  /**
   * B-1 (round 4): the error of an operation that read a record, waited, and
   * then found that the record is no longer the version it decided from. A
   * record that is gone was archived or deleted; a record that is there was
   * replaced (a new reservation, another launch or restore of the ID) or,
   * for a version compare, written by another process.
   */
  function recordChangedError(
    sessionsDir: string,
    sessionId: SessionId,
    during: string,
    outcome: string,
  ): Error {
    // Round 8 (M-1): the message only; a record that cannot be read is
    // named as such, and the read error does not replace this error.
    let state: "gone" | "changed" | "unreadable";
    try {
      state = readRecordStrict(sessionsDir, sessionId) === null ? "gone" : "changed";
    } catch {
      state = "unreadable";
    }
    return new Error(
      state === "gone"
        ? `Session ${sessionId} was removed (archived or deleted) while ${during}; ${outcome}`
        : state === "unreadable"
          ? `Session ${sessionId} could not be read while ${during}; ${outcome}`
          : `Session ${sessionId} changed while ${during} (a new reservation, launch or restore of the ID, or another write); ${outcome}`,
    );
  }

  /**
   * Review r1 (M-1): remove the archive copy-back of a refused restore again,
   * and say what happened, for the refusal message. Only while the record
   * still holds the values of that copy-back as it was written, and without
   * an archive copy: the archive that it came from stays the latest one.
   * Review r2 (M-1): the copy-back is an active record during the stop, so
   * another operation can write to it (a PR claim, a status or summary
   * update) without a change of the launch identity. The delete compares the
   * launch identity (with the reservation ID), the generation (every Node
   * write raises it) and, review r3 (M-1), `pr`, `status` and `branch`: the
   * bash metadata helpers write these three keys with `sed` and `mv` and keep
   * the generation. A record where one of them changed stays, and so does a
   * record that another operation put in its place. Not detected: a write
   * of another key that keeps the generation, and an unlocked write between
   * the locked read and the unlink.
   */
  function releaseCopyBack(
    sessionsDir: string,
    sessionId: SessionId,
    copyBack: Readonly<Record<string, string>>,
  ): string {
    const rest = "this restore did not change the workspace, and no new runtime was created";
    try {
      const unchanged = {
        ...launchIdentity(copyBack),
        [GENERATION_KEY]: copyBack[GENERATION_KEY] ?? "",
        pr: copyBack["pr"] ?? "",
        status: copyBack["status"] ?? "",
        branch: copyBack["branch"] ?? "",
      };
      if (deleteMetadata(sessionsDir, sessionId, false, unchanged)) {
        return `nothing was restored: the archive copy-back of this restore was removed again, ${rest}`;
      }
      const current = readMetadataRaw(sessionsDir, sessionId);
      if (current === null) {
        return `nothing was restored: the archive copy-back of this restore is already gone (another operation on the ID removed it), ${rest}`;
      }
      if (holdsExpected(current, launchIdentity(copyBack))) {
        return `the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of ${sessionId} with that write and was not removed; ${rest}; check that record with \`ao session ls\` before you restore again, because a restore now reads the active record and not the archive`;
      }
      return `the active record of ${sessionId} is no longer the archive copy-back of this restore (another operation on the ID replaced it) and was not removed; ${rest}`;
    } catch (err) {
      return `the archive copy-back of this restore could not be removed (${shortErrorText(err)}), so an active record of ${sessionId} stays; ${rest}`;
    }
  }

  /** True when the record's stored runtime handle names the runtime of `handle`. */
  function recordNamesRuntime(
    record: Readonly<Record<string, string>> | null,
    handle: RuntimeHandle,
  ): boolean {
    const stored = record?.["runtimeHandle"]
      ? safeJsonParse<RuntimeHandle>(record["runtimeHandle"])
      : null;
    return !!stored && stored.id === handle.id && stored.runtimeName === handle.runtimeName;
  }

  /**
   * Round 5 (B-1, M-1): whether a runtime that this process created, and
   * whose launch no longer owns the record, may still belong to the record
   * that is there now. Read the record directly before the destroy (no
   * await in between). A runtime name is the same for every launch of the
   * ID, so a record that names the runtime (by handle or tmux name), and a
   * reservation or a launch that has no runtime handle yet (it can create
   * the same name at any time, or created it and did not write it yet),
   * may own it. Herdr fit-2: so does a record whose stored handle has
   * `data.createIncomplete` (the pending handle P or a partial handle). Only
   * no record, or a launched record that names another runtime, shows that
   * no record owns it.
   */
  function recordMayOwnRuntime(
    record: Readonly<Record<string, string>> | null,
    handle: RuntimeHandle,
  ): boolean {
    if (!record) return false;
    if (!record["runtimeHandle"]) return true;
    // Herdr fit-2 (design r11 4.4): a record with the pending handle P or a
    // partial handle may own it too, as a record without a handle does.
    const stored = safeJsonParse<{ data?: unknown }>(record["runtimeHandle"]);
    const data = stored && typeof stored === "object" ? stored.data : undefined;
    if (data && typeof data === "object" && "createIncomplete" in data) return true;
    return recordNamesRuntime(record, handle) || record["tmuxName"] === handle.id;
  }

  /**
   * Round 5 (1.0.1): the active records other than `exceptId` that name
   * OpenCode session `openCodeId`, with their launch identity. A removal
   * takes it before its awaited holder check and compares it again directly
   * before the removal: a record that took the ID (issue reuse, a restore)
   * or a new launch of a holder during the check keeps the session.
   */
  function openCodeNamers(sessionsDir: string, openCodeId: string, exceptId?: string): string {
    const namers: string[] = [];
    // Round 8 (M-1): a record that cannot be checked or read throws; it is
    // never left out of the compare. Round 9 (M-1): also after the listing
    // (readMetadataRaw answers null when existsSync cannot check the path).
    for (const id of listRecordIds(sessionsDir)) {
      if (id === exceptId) continue;
      const raw = readRecordStrict(sessionsDir, id);
      if (!raw || asValidOpenCodeSessionId(raw["opencodeSessionId"]) !== openCodeId) continue;
      namers.push(`${id}=${JSON.stringify(launchIdentity(raw))}`);
    }
    return namers.sort().join("\n");
  }

  /**
   * B-1 (round 4): the record of a launch in progress (a spawn or an
   * orchestrator start), from its reservation on. Each write goes only into
   * the version that this launch wrote last, compared by its launch identity
   * (`launchIdentity`): when the record was archived or deleted, or another
   * reservation, launch or restore of the ID replaced it, nothing is written
   * and the write throws. Writes that keep the launch (a status write of the
   * lifecycle, the repair on read, a bash helper) do not stop it.
   */
  function ownLaunchRecord(
    sessionsDir: string,
    sessionId: SessionId,
    reserved: Record<string, string>,
  ) {
    let owned = reserved;
    const check = (): {
      state: "own" | "gone" | "replaced";
      current: Record<string, string> | null;
    } => {
      // Round 8 (M-1): readMetadataRaw answers null also when the path
      // cannot be checked (existsSync); only a missing file is gone.
      const current = readRecordStrict(sessionsDir, sessionId);
      if (!current) return { state: "gone", current };
      return {
        state: holdsExpected(current, launchIdentity(owned)) ? "own" : "replaced",
        current,
      };
    };
    /**
     * Herdr fit-2: put a runtime handle into the own record by the
     * publication rule (publishOwnLaunch); a written or adopted record
     * becomes the own record.
     */
    const publishOutcome = (updates: Partial<Record<string, string>>): OwnPublication => {
      const published = publishOwnLaunch(sessionsDir, sessionId, owned, updates);
      if (published.outcome === "written") owned = published.record;
      return published;
    };
    return {
      sessionsDir,
      sessionId,
      write(updates: Partial<Record<string, string>>, during: string): void {
        const written = updateMetadataIf(sessionsDir, sessionId, launchIdentity(owned), updates);
        if (!written) {
          throw recordChangedError(sessionsDir, sessionId, during, "its record was not written");
        }
        owned = written;
      },
      /** Herdr fit-2: the launch identity of this launch's last own write. */
      identity(): Record<string, string> {
        return launchIdentity(owned);
      },
      publishOutcome,
      /**
       * `publishOutcome` for a spawn or start: not own throws today's
       * recordChangedError, unwritable throws LaunchRecordUnwritableError
       * with the handle in memory.
       */
      publish(
        updates: Partial<Record<string, string>>,
        during: string,
        handle: RuntimeHandle,
      ): void {
        const published = publishOutcome(updates);
        if (published.outcome === "not-own") {
          throw recordChangedError(sessionsDir, sessionId, during, "its record was not written");
        }
        if (published.outcome === "unwritable") {
          throw new LaunchRecordUnwritableError(
            sessionId,
            published.before,
            published.after,
            published.lastRead,
            handle,
            published.error,
          );
        }
      },
      /**
       * The record now, and whether it is still this launch, gone, or
       * replaced. It throws when it cannot read the record.
       */
      check,
      /**
       * Round 8 (M-1): `check`, with a read error as "unknown" (the error
       * is in `error`). It never throws. Unknown is never "gone": a step
       * that removes a resource keeps it on "unknown".
       */
      checkOrUnknown(): LaunchCheck {
        try {
          return check();
        } catch (error) {
          return { state: "unknown", current: null, error };
        }
      },
      /** True when `record` is a version of this launch (its launch identity). */
      holds(record: Readonly<Record<string, string>>): boolean {
        return holdsExpected(record, launchIdentity(owned));
      },
      /** Delete the record without an archive, only while it is still this launch. */
      release(): void {
        deleteMetadata(sessionsDir, sessionId, false, launchIdentity(owned));
      },
    };
  }

  type OwnLaunchRecord = ReturnType<typeof ownLaunchRecord>;

  /**
   * Round 8 (M-2): a record other than this launch's own record that names
   * one of the values of `values` (the agent session that this launch
   * prepared), or undefined. It reads what issue reuse and the kill holder
   * checks read: every active record and the latest archive of each session
   * ID. Only the active record that still holds this launch's identity is
   * left out (compared by launch identity, not by the ID); an archive counts
   * also when it is a copy of this launch, because a restore runs on it.
   * Round 8 (M-1): a record or an archive that exists but cannot be read is
   * a holder, and so is a read error of the directories; no read error
   * counts as "names nothing". Round 9 (M-1): the archive directory too:
   * only a missing one (`ENOENT`) has no archives, and a directory that
   * cannot be checked or read is a holder.
   */
  function preparedSessionHolder(
    own: OwnLaunchRecord,
    values: Readonly<Record<string, string>>,
  ): string | undefined {
    const { sessionsDir } = own;
    const names = (record: Readonly<Record<string, string>>): boolean =>
      Object.entries(values).some(([key, value]) => value !== "" && record[key] === value);
    let ids: string[];
    let archivedIds: string[];
    try {
      ids = listRecordIds(sessionsDir);
    } catch (err) {
      return `the records could not be listed (${shortErrorText(err)})`;
    }
    try {
      archivedIds = listArchivedSessionIdsStrict(sessionsDir);
    } catch (err) {
      return `the archives could not be listed (${shortErrorText(err)})`;
    }
    for (const id of ids) {
      let record: Record<string, string> | null;
      try {
        record = readRecordStrict(sessionsDir, id);
      } catch (err) {
        return `the record of ${id} could not be read (${shortErrorText(err)})`;
      }
      if (!record || (id === own.sessionId && own.holds(record))) continue;
      if (names(record)) return `the record of ${id} names it`;
    }
    for (const id of archivedIds) {
      // The ID has an archive file, so a null here is a read error (which
      // readArchivedMetadataRaw answers as null) or a removal since. Round 9
      // (M-1): its directory read throws on an error; that is a holder too.
      let archived: Record<string, string> | null;
      try {
        archived = readArchivedMetadataRaw(sessionsDir, id);
      } catch (err) {
        return `the latest archive of ${id} could not be read (${shortErrorText(err)})`;
      }
      if (!archived) return `the latest archive of ${id} could not be read`;
      if (names(archived)) return `the latest archive of ${id} names it`;
    }
    return undefined;
  }

  /** The argument of rollbackLaunch and keepUnconfirmedLaunch. */
  interface LaunchRollback {
    own: OwnLaunchRecord;
    runtime?: Runtime;
    handle?: RuntimeHandle;
    prepared?: PreparedAgentSession;
    workspace?: RollbackWorkspace;
    /** The error that failed the launch, for `launchFailed`. */
    failure?: unknown;
    /**
     * Herdr fit-2: the record that a partial create publishes with its handle
     * (given only with a RuntimeCreatePartialError).
     */
    partialRecord?: Partial<Record<string, string>>;
    /** Herdr fit-2: the launch claim that this launch wrote, or null. */
    ownClaim?: LaunchClaim | null;
  }

  /** The worktree and the agent session of a failed launch, for a warning. */
  function keptResourcesOf(rollback: LaunchRollback, handle: RuntimeHandle) {
    const workspacePath = handle.data?.["workspacePath"];
    return {
      worktree:
        rollback.workspace?.path ??
        (typeof workspacePath === "string" && workspacePath ? workspacePath : "unknown"),
      agentSession: rollback.prepared
        ? Object.values(rollback.prepared.metadata).join(", ") || "unnamed"
        : "none prepared",
    };
  }

  /**
   * Herdr fit-2 F-4 (design r11 5.2.3): the rollback of a launch whose
   * runtime is in LAUNCH_END_UNPROVEN_RUNTIMES (a partial create, or a
   * failure after a create). True when the launch is kept: nothing is removed
   * then. False only after a confirmed stop; the caller goes on with the
   * ordinary removals.
   * 0. A handle publication that could not be decided: the unwritable path.
   * 1. The record is gone or replaced (this strict read proves it): remove
   *    and write nothing, warn once. It cannot be read: the unwritable path.
   * 2. A partial create: publish its handle (the publication rule; P goes).
   * 3. Stop through the handle's runtime (runtimeForHandle); Herdr answers
   *    `unknown`, so keepUnconfirmedLaunch keeps everything, writes
   *    `launchFailed` and settles the claim.
   */
  async function keepUnprovenLaunch(
    rollback: LaunchRollback,
    runtime: Runtime,
    handle: RuntimeHandle,
  ): Promise<boolean> {
    const { own } = rollback;
    const ownClaim = rollback.ownClaim ?? null;
    const kept = keptResourcesOf(rollback, handle);
    const unwritable = (
      error: unknown,
      before: Readonly<Record<string, string>>,
      after?: Readonly<Record<string, string>>,
    ): true => {
      keepUnwritableLaunch({
        sessionsDir: own.sessionsDir,
        sessionId: own.sessionId,
        error,
        handle,
        before,
        after,
        ownClaim,
        ...kept,
      });
      return true;
    };
    const notOwn = (state: "gone" | "replaced" | "not-own"): true => {
      warnOperator(
        `ao: kept the failed launch of ${own.sessionId}: its record was ${state === "gone" ? "removed (archived or deleted)" : "replaced (another reservation, launch or restore of the ID)"} during the launch, so AO removed nothing and wrote nothing. ` +
          `Kept: ${describeHandleInMemory(handle)}; worktree ${kept.worktree}; agent session ${kept.agentSession}. ` +
          "Check the runtime by hand (design 5.4.3), and remove by hand only what no session uses.",
      );
      return true;
    };
    // 0.
    if (rollback.failure instanceof LaunchRecordUnwritableError) {
      return unwritable(rollback.failure.cause, rollback.failure.before, rollback.failure.after);
    }
    // 1.
    const checked = own.checkOrUnknown();
    if (checked.state === "unknown") return unwritable(checked.error, own.identity());
    if (checked.state !== "own") return notOwn(checked.state);
    // 2.
    if (rollback.partialRecord) {
      const published = own.publishOutcome({
        ...rollback.partialRecord,
        runtimeHandle: JSON.stringify(handle),
        [RESERVATION_KEY]: "",
      });
      if (published.outcome === "not-own") return notOwn("not-own");
      if (published.outcome === "unwritable") {
        return unwritable(published.error, published.before, published.after);
      }
    }
    // 3. Through the handle's runtime (design r11 5.2.3, 4.6); one in the set
    // that is not loaded is an unconfirmed stop.
    const handleRuntime = runtimeForHandle(handle, runtime);
    const stopped = handleRuntime
      ? await stopRuntime(handleRuntime, handle)
      : notLoadedStop(handle);
    if (!isRuntimeStopConfirmed(stopped)) {
      keepUnconfirmedLaunch(rollback, handle, stopped);
      return true;
    }
    return false;
  }

  /**
   * B-1 (round 4): undo a launch that failed. The record and the workspace
   * are removed only while the record is still this launch (or gone): a new
   * reservation, launch or restore of the same ID uses the same worktree
   * path and runtime name, so they stay for it. The runtime of this launch
   * is stopped only while no other record may own it (recordMayOwnRuntime:
   * a restore after a kill reuses the tmux name). The agent session that
   * this launch prepared is removed only while no other record and no
   * archive of any ID names it (preparedSessionHolder, round 8 M-2: issue
   * reuse gives it to another session, and a restore of an archived record
   * runs on it). Round 5 (M-1): each step reads the record again directly
   * before it (the earlier steps await), with no await between the check
   * and the step. Round 7 (M-2, M-3): the agent hook and the workspace
   * plugin await inside their step, so each gets the same check and runs it
   * again directly before each of its own calls. Round 8 (M-1): a check that
   * cannot read the record is "unknown", never "gone": the runtime, the
   * agent session, the workspace and the record stay. Every step is best
   * effort; a runtime, agent session, workspace or record that stays is
   * named to the operator, except a workspace that stays for a new launch
   * of the ID. Same-ID R2a: a runtime stop that is not confirmed
   * (`stopRuntime` answers `other-launch` or `unknown`) ends the rollback
   * there (keepUnconfirmedLaunch): the agent session, the workspace and the
   * record stay, and the record gets `launchFailed`. The answer says
   * whether that happened. Herdr fit-2 F-4: a runtime in
   * LAUNCH_END_UNPROVEN_RUNTIMES goes through keepUnprovenLaunch first.
   */
  async function rollbackLaunch(rollback: LaunchRollback): Promise<{ stopUnconfirmed: boolean }> {
    const { own } = rollback;
    const unreadable = (error: unknown): string =>
      `the record of ${own.sessionId} could not be read (${shortErrorText(error)})`;
    if (rollback.runtime && rollback.handle && isLaunchEndUnproven(rollback.handle.runtimeName)) {
      // Herdr fit-2 F-4: only a confirmed stop (a later RH-B) goes on below.
      if (await keepUnprovenLaunch(rollback, rollback.runtime, rollback.handle)) {
        return { stopUnconfirmed: true };
      }
    } else if (rollback.runtime && rollback.handle) {
      const handle = rollback.handle;
      const checked = own.checkOrUnknown();
      const keptBecause =
        checked.state === "unknown"
          ? unreadable(checked.error)
          : checked.state === "replaced" && recordMayOwnRuntime(checked.current, handle)
            ? "another launch of the ID may own it"
            : undefined;
      if (keptBecause === undefined) {
        const stopped = await stopRuntime(rollback.runtime, handle);
        if (!isRuntimeStopConfirmed(stopped)) {
          keepUnconfirmedLaunch(rollback, handle, stopped);
          return { stopUnconfirmed: true };
        }
      } else {
        warnOperator(
          `ao: kept runtime ${handle.runtimeName ?? "?"} ${handle.id} of a failed launch: ${keptBecause}; stop it by hand if no session uses it.`,
        );
      }
    }
    if (rollback.prepared) {
      const prepared = rollback.prepared;
      // The last answer of the decision: why the session stays, or undefined.
      let heldBy = preparedSessionHolder(own, prepared.metadata);
      if (heldBy === undefined) {
        await discardPreparedSession(prepared, () => {
          heldBy = preparedSessionHolder(own, prepared.metadata);
          return heldBy === undefined;
        });
      }
      if (heldBy !== undefined && prepared.created) {
        warnOperator(
          `ao: kept the agent session of a failed launch (${Object.values(prepared.metadata).join(", ")}): ${heldBy}.`,
        );
      }
    }
    if (rollback.workspace) {
      const workspace = rollback.workspace;
      let unread: { error: unknown } | undefined;
      // A replaced record keeps the workspace for its launch; unknown keeps it too.
      const ownOrGone = (): boolean => {
        const checked = own.checkOrUnknown();
        if (checked.state === "unknown") unread = { error: checked.error };
        return checked.state === "own" || checked.state === "gone";
      };
      if (ownOrGone()) {
        try {
          await workspace.destroy(ownOrGone);
        } catch {
          /* best effort */
        }
      }
      if (unread) {
        warnOperator(
          `ao: kept the workspace ${workspace.path} of a failed launch: ${unreadable(unread.error)}; remove it by hand if no session uses it.`,
        );
      }
    }
    // Conditional: it deletes only a record that is still this launch, and
    // never a record that it cannot read.
    const last = own.checkOrUnknown();
    if (last.state === "unknown") {
      warnOperator(
        `ao: kept the record of a failed launch: ${unreadable(last.error)}; remove it by hand if no session uses it.`,
      );
    } else {
      try {
        own.release();
      } catch {
        /* best effort */
      }
    }
    return { stopUnconfirmed: false };
  }

  /**
   * Same-ID R2a: the rollback of a launch whose runtime stop is not
   * confirmed. The runtime may still run, so nothing that it may use goes:
   * the agent session, the workspace and the record stay (review r2: a
   * stopped own runtime alone never allows the removal of a workspace that
   * another record may own, and an unknown stop keeps both). The record,
   * while it is still this launch, gets `launchFailed` (`ao status` shows
   * it); the operator gets the outcome and the next action. Herdr fit-2: then
   * it settles the launch's own claim (settleOwnClaim).
   */
  function keepUnconfirmedLaunch(
    rollback: LaunchRollback,
    handle: RuntimeHandle,
    stopped: UnconfirmedRuntimeStop,
  ): void {
    const { own } = rollback;
    const checked = own.checkOrUnknown();
    const kept = [
      ...(checked.state === "own" ? ["record"] : []),
      ...(rollback.workspace ? [`workspace ${rollback.workspace.path}`] : []),
      ...(rollback.prepared?.created
        ? [`agent session ${Object.values(rollback.prepared.metadata).join(", ")}`]
        : []),
    ];
    const refusal = new RuntimeStopUnconfirmedError({
      sessionId: own.sessionId,
      handle,
      stop: stopped,
      kept: kept.length > 0 ? `${kept.join(", ")} kept` : "nothing removed",
      retry: `ao session kill ${own.sessionId}`,
    });
    const failure =
      rollback.failure === undefined ? "" : `${shortErrorText(rollback.failure)}; then `;
    const launchFailed = `${failure}${refusal.message}`.replace(/\s+/g, " ").trim().slice(0, 600);
    let unrecorded = "";
    if (checked.state === "own") {
      try {
        own.write({ launchFailed }, "the rollback recorded the failed launch");
      } catch (err) {
        unrecorded = ` The record does not name the failure: ${shortErrorText(err)}.`;
      }
    }
    warnOperator(
      `ao: the failed launch of ${own.sessionId} was not rolled back: ${refusal.message}. ${refusal.hint}${unrecorded}`,
    );
    // Herdr fit-2 (design r11 4.5): the kept launch no longer runs a launch
    // of this process, so its own claim goes (compared by the identity of its
    // last own write; another operation's claim stays).
    const ownClaim = rollback.ownClaim ?? null;
    if (ownClaim) {
      try {
        settleOwnClaim(own.sessionsDir, own.sessionId, own.identity(), ownClaim);
      } catch (err) {
        warnOperator(claimMayRemainWarning(own.sessionId, ownClaim, err));
      }
    }
  }

  /**
   * Herdr fit-2 (design r11 4.6): the runtime that answers for an old
   * record's handle. A registered `handle.runtimeName` gives that plugin; a
   * runtime in LAUNCH_END_UNPROVEN_RUNTIMES that is not registered gives null
   * (no other runtime may answer for it); any other case gives `fallback`,
   * today's runtime of the site. A new launch still creates through the
   * project's selected runtime.
   */
  function runtimeForHandle(
    handle: RuntimeHandle,
    fallback: Runtime | null | undefined,
  ): Runtime | null {
    const name = handle.runtimeName;
    if (name) {
      const registered = registry.get<Runtime>("runtime", name);
      if (registered) return registered;
      if (isLaunchEndUnproven(name)) return null;
    }
    return fallback ?? null;
  }

  /** The `unknown` stop of a handle whose runtime is not loaded (runtimeForHandle null). */
  function notLoadedStop(handle: RuntimeHandle): UnconfirmedRuntimeStop {
    return { outcome: "unknown", detail: `no runtime plugin ${handle.runtimeName} is loaded` };
  }

  /**
   * Herdr fit-2 (design r11 4.4, 4.5): the `initial` of a launch's
   * reservation. A create runtime in LAUNCH_END_UNPROVEN_RUNTIMES starts the
   * record with the pending handle P, `launchFields` and the claim; any other
   * runtime keeps today's record (the claim only, when the launch took one).
   */
  function reservationInitial(
    runtimeName: string,
    ownClaim: LaunchClaim | null,
    launchFields: Record<string, string> = {},
  ): Record<string, string> | null {
    if (!isLaunchEndUnproven(runtimeName)) return ownClaim ? { ...ownClaim } : null;
    return {
      ...launchFields,
      ...(ownClaim ?? {}),
      runtimeHandle: JSON.stringify(pendingHandle(runtimeName)),
    };
  }

  /** Herdr fit-2 (design r11 4.2): the bounds and the stage hook of each admission. */
  const admission = {
    waitMs: deps.admission?.waitMs ?? ADMISSION_WAIT_MS,
    probeTimeoutMs: deps.admission?.probeTimeoutMs ?? ADMISSION_PROBE_TIMEOUT_MS,
    async stage(stage: AdmissionStage, selected: number): Promise<void> {
      await deps.admission?.onStage?.(stage, { selected });
    },
  };

  /**
   * Herdr fit-2 (design r11 5.3.1): a runtime stop under A, with the core
   * bound. No answer in time is `unknown`; nothing else changes.
   */
  async function stopWithinBound(
    runtime: Runtime,
    handle: RuntimeHandle,
  ): Promise<RuntimeStopOutcome> {
    const answer = await outcomeWithin(
      () => stopRuntime(runtime, handle),
      admission.probeTimeoutMs,
    );
    if (answer.kind === "value") return answer.value;
    return {
      outcome: "unknown" as const,
      detail:
        answer.kind === "timeout"
          ? `the ${runtime.name} stop did not answer within ${secondsText(admission.probeTimeoutMs)}`
          : `the ${runtime.name} stop failed: ${shortErrorText(answer.error)}`,
      ...(answer.kind === "error" ? { cause: answer.error } : {}),
    };
  }

  /** A record that G1 selected (design r11 5.3.3), as this round read it. */
  interface AdmissionRecord {
    id: string;
    raw: Record<string, string>;
    /** launchIdentityToken of `raw`: the key of its probe answers. */
    token: string;
    /** The PID of its live launch owner (R1), or null. */
    owner: number | null;
  }

  /** The decision of G2 for one record (design r11 4.7). */
  interface AdmissionJudgement {
    record: AdmissionRecord;
    /** Why it blocks; undefined while R1 to R6 (and R8 for a start) pass. */
    block?: { kind: BlockingLaunchKind; reason: string };
    /** Its handle of a runtime in LAUNCH_END_UNPROVEN_RUNTIMES (R2), when it has one. */
    handle?: RuntimeHandle;
  }

  const answerKey = (record: AdmissionRecord): string => `${record.id}\0${record.token}`;

  /**
   * Herdr fit-2 G1 (design r11 5.3.3): the known-Herdr orchestrator records
   * of a project, read strictly, whatever their status, activity,
   * `killedReason` or `launchFailed`, and whatever the project's runtime is
   * now: a stored handle that `isUnprovenLaunchRecord` accepts (rows 1 to 3),
   * or no handle and a live launch owner while the project selects a runtime
   * of the set (row 4). A record that cannot be listed or read refuses the
   * start (`records-unreadable`).
   */
  async function selectOrchestratorRecords(
    projectId: string,
    project: ProjectConfig,
    sessionsDir: string,
    selectedRuntime: string,
    excludeId?: string,
  ): Promise<AdmissionRecord[]> {
    let ids: string[];
    try {
      ids = listRecordIds(sessionsDir);
    } catch (err) {
      throw startBlocked(projectId, "records-unreadable", err);
    }
    const selected: AdmissionRecord[] = [];
    for (const id of ids) {
      if (id === excludeId) continue;
      let raw: Record<string, string> | null;
      try {
        raw = readRecordStrict(sessionsDir, id);
      } catch (err) {
        throw startBlocked(projectId, "records-unreadable", err);
      }
      if (!raw || !isOrchestratorSessionRecord(id, raw, project.sessionPrefix)) continue;
      const byHandle = isUnprovenLaunchRecord(raw, selectedRuntime);
      if (!byHandle && (raw["runtimeHandle"] || !isLaunchEndUnproven(selectedRuntime))) continue;
      const owner = await liveLaunchOwner(raw);
      // Row 5: no handle and no live owner is not selected (today's rule, L-2).
      if (!byHandle && owner === null) continue;
      selected.push({ id, raw, token: launchIdentityToken(raw), owner });
    }
    return selected;
  }

  /**
   * Herdr fit-2 G2 (design r11 4.7): decide a selected record from its fields
   * by R1 to R6, and for a start by R8 (`r8` answers the reason when R8
   * fails). A restore blocks on every record that it selects. R7 (an `alive`
   * answer for this identity token) is applied apart (`withAnswer`).
   */
  function judgeOrchestratorRecord(
    record: AdmissionRecord,
    selectedRuntime: string,
    options: { r8?: (id: string) => string | undefined; restoreOf?: string },
  ): AdmissionJudgement {
    // R1.
    if (record.owner !== null) {
      return {
        record,
        block: { kind: "in-progress", reason: `launch in progress by ao process ${record.owner}` },
      };
    }
    // R2.
    const text = record.raw["runtimeHandle"] ?? "";
    const parsed = text ? safeJsonParse<unknown>(text) : null;
    if (!isWellFormedHandle(parsed) || !isLaunchEndUnproven(parsed.runtimeName)) {
      return {
        record,
        block: { kind: "damaged", reason: "its runtime handle cannot be read" },
      };
    }
    const handle = parsed;
    const blocks = (kind: BlockingLaunchKind, reason: string): AdmissionJudgement => ({
      record,
      handle,
      block: { kind, reason },
    });
    // R3.
    const stage = handle.data["createIncomplete"];
    if (stage !== undefined) return blocks("create-incomplete", `create ${String(stage)}`);
    // R4 to R6.
    if (record.raw["launchFailed"]) return blocks("not-reused", "its launch failed");
    if (handle.runtimeName !== selectedRuntime) {
      return blocks("not-reused", `the project now selects ${selectedRuntime}`);
    }
    const status = record.raw["status"] ?? "";
    if (TERMINAL_STATUSES.has(status as SessionStatus)) {
      return blocks("not-reused", `its status is ${status}`);
    }
    // R8.
    const r8 = options.r8?.(record.id);
    if (r8) return blocks("not-reused", r8);
    if (options.restoreOf) {
      return blocks("not-reused", `the restore of ${options.restoreOf} would launch next to it`);
    }
    return { record, handle };
  }

  /** R7: a record that passes R1 to R6 (and R8) blocks `unproven` unless its answer is `alive`. */
  function withAnswer(
    judged: AdmissionJudgement,
    answers: ReadonlyMap<string, OrchestratorLiveness>,
  ): AdmissionJudgement {
    if (judged.block || !judged.handle) return judged;
    const answer = answers.get(answerKey(judged.record));
    if (!answer || answer.state === "alive") return judged;
    return { ...judged, block: { kind: "unproven", reason: answer.reason } };
  }

  /** The probe of one record outside A (design r11 5.3.2), through its handle's runtime and pins. */
  async function probeAdmissionRecord(handle: RuntimeHandle): Promise<OrchestratorLiveness> {
    return classifyOrchestratorLiveness(
      runtimeForHandle(handle, null),
      handle,
      admission.probeTimeoutMs,
    );
  }

  /**
   * Herdr fit-2 (design r11 5.3.2, 5.3.8): the error of a blocked admission.
   * With A released, each blocking record with a pane ID in herdr's grammar
   * gets one probe (an answer of the rounds for its identity token is
   * reused), in parallel, to fill `answer` in message M; these probes decide
   * nothing.
   */
  async function blockedAdmission(
    projectId: string,
    project: ProjectConfig,
    blocking: readonly AdmissionJudgement[],
    answers: Map<string, OrchestratorLiveness>,
  ): Promise<OrchestratorStartBlockedError> {
    const answerOf = async (judged: AdmissionJudgement): Promise<string | undefined> => {
      const { handle, block } = judged;
      if (!handle || block?.kind === "in-progress") return undefined;
      if (!isHerdrPaneId(handle.id)) return "AO has no pane ID for this launch";
      const key = answerKey(judged.record);
      let answer = answers.get(key);
      if (!answer) {
        answer = await probeAdmissionRecord(handle);
        answers.set(key, answer);
      }
      if (answer.state !== "alive") return answer.reason;
      return `the pane runs, but the record is not reusable (${block?.reason ?? "it is not reusable"})`;
    };
    const filled = await Promise.all(blocking.map(answerOf));
    const records = blocking.map((judged, index): BlockedRecord => {
      const { record, handle, block } = judged;
      const raw = record.raw;
      const data = handle?.data ?? {};
      const text = (key: string): string | undefined => {
        const value = data[key];
        return typeof value === "string" && value ? value : undefined;
      };
      const kind = block?.kind ?? "unproven";
      const status = raw["status"] || "unknown";
      const stage =
        typeof data["createIncomplete"] === "string" ? data["createIncomplete"] : undefined;
      const state =
        kind === "in-progress"
          ? (block?.reason ?? "launch in progress")
          : [
              `status ${status}`,
              ...(raw["launchFailed"] ? ["launch failed"] : []),
              ...(stage ? [`create ${stage}`] : []),
              ...(kind === "not-reused" && block ? [block.reason] : []),
            ].join(", ");
      const launch: BlockingLaunch = {
        sessionId: record.id,
        kind,
        reason: block?.reason ?? "",
        status,
        launchFailed: Boolean(raw["launchFailed"]),
        ...(kind === "damaged" ? { handle: (raw["runtimeHandle"] ?? "").slice(0, 80) } : {}),
        ...(handle && handle.id ? { pane: handle.id } : {}),
        ...(text("terminalId") ? { terminal: text("terminalId") } : {}),
        ...(text("workspaceId") ? { workspace: text("workspaceId") } : {}),
        worktree:
          raw["worktree"] || join(getWorktreesDir(config.configPath, project.path), record.id),
        ...(text("herdrSocket") ? { socket: text("herdrSocket") } : {}),
        ...(text("herdrBin") ? { bin: text("herdrBin") } : {}),
        ...(filled[index] !== undefined ? { answer: filled[index] } : {}),
        ...(record.owner !== null ? { launcherPid: record.owner } : {}),
        identityToken: record.token,
      };
      return {
        launch,
        state,
        ...(stage ? { stage } : {}),
        label: text("sessionId") ?? raw["tmuxName"] ?? record.id,
        pinned: Object.hasOwn(data, "herdrBin") && Object.hasOwn(data, "herdrSocket"),
      };
    });
    return new OrchestratorStartBlockedError(blockedStartMessage(projectId, records), {
      projectId,
      reason: "records",
      blocking: records.map((record) => record.launch),
    });
  }

  /** What an admission round decided when no record needed a probe. */
  type AdmissionDecision<T> =
    | { kind: "done"; value: T }
    | { kind: "blocked"; blocking: AdmissionJudgement[] }
    | { kind: "next" };

  /** One admission (design r11 5.3.2): start, restore or reuse-only. */
  interface AdmissionRun<T> {
    mode: "start" | "restore" | "reuse-only";
    projectId: string;
    project: ProjectConfig;
    sessionsDir: string;
    /** Start and restore: the create runtime is in LAUNCH_END_UNPROVEN_RUNTIMES. */
    createInSet: boolean;
    /** Restore: its own ID, which G leaves out. */
    excludeId?: string;
    /** Start: the reason when R8 fails for a record, else undefined. */
    r8?: (id: string) => string | undefined;
    /**
     * The decision of a round in which no record needs a probe, under A. It
     * runs the admitted step and answers its result, or "blocked", or "next"
     * (a change: the next round decides). `checkSubject` checks that the real
     * path of the sessions directory is still the subject.
     */
    decide(round: {
      judged: AdmissionJudgement[];
      answers: ReadonlyMap<string, OrchestratorLiveness>;
      checkSubject: () => void;
      selected: number;
    }): Promise<AdmissionDecision<T>>;
    /** Reuse-only: the answer after round 3 from the last round's records. */
    exhausted?(judged: AdmissionJudgement[], answers: ReadonlyMap<string, OrchestratorLiveness>): T;
  }

  /**
   * Herdr fit-2 F-7 (design r11 4.9, 5.3.1, 5.3.2): the admission rounds. The
   * subject of lock A is fixed once, before A. Each round holds A (busy:
   * `admission-busy`), makes (start) and checks the sessions directory, reads
   * the records (G1) and decides them (G2). A round in which a record needs a
   * probe releases A and probes outside A; its answer counts only for the
   * identity token that it probed. No Herdr call runs under A. After three
   * rounds with a record that still needs a probe: `records-changed` (a
   * reuse-only decision answers what it can). On a platform without the lock
   * (OQ-F6 (a)) a start or restore whose create runtime is in the set, or
   * whose G1 (read without A) selects a record, refuses
   * (`admission-unsupported`); a reuse-only decision runs without A.
   */
  async function runAdmission<T>(run: AdmissionRun<T>): Promise<T> {
    const { mode, projectId, project, sessionsDir } = run;
    const { subject, name } = admissionLock(sessionsDir, projectId);
    await admission.stage("subject-fixed", 0);
    const selectedRuntime = project.runtime ?? config.defaults.runtime;
    const supported = isDeliveryLockSupported();
    const answers = new Map<string, OrchestratorLiveness>();
    const checkSubject = (made?: string): void => {
      let real: string;
      try {
        real = realpathSync(sessionsDir);
      } catch (err) {
        throw startBlocked(
          projectId,
          "admission-path",
          err,
          `${errorCode(err) ?? "unknown error"} at ${sessionsDir}`,
        );
      }
      if (real !== subject) {
        throw startBlocked(
          projectId,
          "admission-path",
          undefined,
          `the real path of ${sessionsDir} is now ${real}, not ${subject}${made ? `; the empty directories that this start made stay, from ${made} on` : ""}`,
        );
      }
    };
    const sessionsDirExists = (): boolean => {
      try {
        return statSync(sessionsDir).isDirectory();
      } catch (err) {
        if (errorCode(err) === "ENOENT") return false;
        throw startBlocked(
          projectId,
          "admission-path",
          err,
          `${errorCode(err) ?? "unknown error"} at ${sessionsDir}`,
        );
      }
    };
    const judgeAll = (records: AdmissionRecord[]): AdmissionJudgement[] =>
      records.map((record) =>
        judgeOrchestratorRecord(record, selectedRuntime, {
          ...(mode === "start" && run.r8 ? { r8: run.r8 } : {}),
          ...(mode === "restore" && run.excludeId ? { restoreOf: run.excludeId } : {}),
        }),
      );

    if (!supported && mode !== "reuse-only") {
      const selected = sessionsDirExists()
        ? await selectOrchestratorRecords(
            projectId,
            project,
            sessionsDir,
            selectedRuntime,
            run.excludeId,
          )
        : [];
      if (run.createInSet || selected.length > 0)
        throw startBlocked(projectId, "admission-unsupported");
      // Nothing to admit against, and no lock: today's path.
      if (mode === "start") mkdirSync(sessionsDir, { recursive: true });
      const decided = await run.decide({
        judged: [],
        answers,
        checkSubject: () => {},
        selected: 0,
      });
      if (decided.kind === "done") return decided.value;
      throw startBlocked(projectId, "records-changed");
    }

    let lastJudged: AdmissionJudgement[] = [];
    for (let round = 1; round <= ADMISSION_ROUNDS; round++) {
      const lock: DeliveryLock | null = supported
        ? await holdDeliveryLock(name, admission.waitMs)
        : null;
      if (supported && !lock) throw startBlocked(projectId, "admission-busy");
      let toProbe: AdmissionJudgement[];
      let blocking: AdmissionJudgement[] | undefined;
      try {
        await admission.stage("lock-held", 0);
        let hasDir: boolean;
        if (mode === "start") {
          const made = mkdirSync(sessionsDir, { recursive: true }) ?? undefined;
          checkSubject(made);
          hasDir = true;
        } else {
          hasDir = sessionsDirExists();
          if (hasDir) checkSubject();
        }
        await admission.stage("sessions-dir-ready", 0);
        const selected = hasDir
          ? await selectOrchestratorRecords(
              projectId,
              project,
              sessionsDir,
              selectedRuntime,
              run.excludeId,
            )
          : [];
        const judged = judgeAll(selected);
        lastJudged = judged;
        toProbe =
          mode === "restore"
            ? []
            : judged.filter((j) => !j.block && j.handle && !answers.has(answerKey(j.record)));
        if (toProbe.length === 0) {
          const decided = await run.decide({
            judged,
            answers,
            checkSubject,
            selected: selected.length,
          });
          if (decided.kind === "done") return decided.value;
          if (decided.kind === "blocked") blocking = decided.blocking;
        }
      } finally {
        lock?.release();
      }
      if (blocking) throw await blockedAdmission(projectId, project, blocking, answers);
      // After round 3 no round reads the records again, so a probe then decides nothing.
      if (toProbe.length > 0 && round < ADMISSION_ROUNDS) {
        await Promise.all(
          toProbe.map(async (judged) => {
            if (!judged.handle) return;
            answers.set(answerKey(judged.record), await probeAdmissionRecord(judged.handle));
          }),
        );
      }
    }
    if (run.exhausted) return run.exhausted(lastJudged, answers);
    throw startBlocked(projectId, "records-changed");
  }

  // Define methods as local functions so `this` is not needed
  async function spawn(spawnConfig: SessionSpawnConfig): Promise<Session> {
    const project = config.projects[spawnConfig.projectId];
    if (!project) {
      throw new Error(`Unknown project: ${spawnConfig.projectId}`);
    }

    const selection = resolveAgentSelection({
      role: "worker",
      project,
      defaults: config.defaults,
      spawnAgentOverride: spawnConfig.agent,
      spawnModelOverride: spawnConfig.model,
    });
    const plugins = resolvePlugins(project, selection.agentName);
    if (!plugins.runtime) {
      throw new Error(`Runtime plugin '${project.runtime ?? config.defaults.runtime}' not found`);
    }

    if (!plugins.agent) {
      throw new Error(`Agent plugin '${selection.agentName}' not found`);
    }

    const workspaceName = project.workspace ?? config.defaults.workspace;
    if (!plugins.workspace) {
      const availableWorkspaces = registry
        .list("workspace")
        .map((manifest) => manifest.name)
        .sort();
      throw new Error(
        `workspace "${workspaceName}" is not available; available: ${availableWorkspaces.join(", ") || "none"}`,
      );
    }

    // Validate issue exists BEFORE creating any resources
    let resolvedIssue: Issue | undefined;
    if (spawnConfig.issueId && plugins.tracker) {
      try {
        // Fetch and validate the issue exists
        resolvedIssue = await plugins.tracker.getIssue(spawnConfig.issueId, project);
      } catch (err) {
        // Issue fetch failed - determine why
        if (isIssueNotFoundError(err)) {
          // Ad-hoc issue string — proceed without tracker context.
          // Branch will be generated as feat/{issueId} (line 329-331)
        } else {
          // Other error (auth, network, etc) - fail fast
          throw new Error(`Failed to fetch issue ${spawnConfig.issueId}: ${err}`, { cause: err });
        }
      }
    }

    // Get the sessions directory for this project
    const sessionsDir = getProjectSessionsDir(project);

    // Validate and store .origin file (new architecture only)
    if (config.configPath) {
      validateAndStoreOrigin(config.configPath, project.path);
    }

    // Determine session ID — atomically reserve to prevent concurrent collisions.
    // Herdr fit-2 (design r11 4.5): a launch whose create runtime is in
    // LAUNCH_END_UNPROVEN_RUNTIMES takes the launch claim too, and its
    // reservation holds the pending handle P (reservationInitial).
    const unproven = isLaunchEndUnproven(plugins.runtime.name);
    const ownClaim = plugins.agent.prepareAgentSession || unproven ? await readLaunchClaim() : null;
    const {
      sessionId,
      tmuxName,
      record: reservedRecord,
    } = await reserveNextSessionIdentity(
      project,
      sessionsDir,
      reservationInitial(plugins.runtime.name, ownClaim),
    );
    // B-1 (round 4): every later write of this spawn goes only into its own record.
    const own = ownLaunchRecord(sessionsDir, sessionId, reservedRecord);

    // Determine branch name — explicit branch always takes priority
    let branch: string;
    if (spawnConfig.branch) {
      branch = spawnConfig.branch;
    } else if (spawnConfig.issueId && plugins.tracker && resolvedIssue) {
      branch = plugins.tracker.branchName(spawnConfig.issueId, project);
    } else if (spawnConfig.issueId) {
      // If the issueId is already branch-safe (e.g. "INT-9999"), use as-is.
      // Otherwise sanitize free-text (e.g. "fix login bug") into a valid slug.
      const id = spawnConfig.issueId;
      const isBranchSafe = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
      const slug = isBranchSafe
        ? id
        : id
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 60)
            .replace(/^-+|-+$/g, "");
      branch = `feat/${slug || sessionId}`;
    } else {
      branch = `session/${sessionId}`;
    }

    // Create workspace (if workspace plugin is available)
    let workspacePath = project.path;
    // The workspace that a rollback removes; none outside the managed roots.
    const spawnWorkspace = (): RollbackWorkspace | undefined => {
      const workspace = plugins.workspace;
      const path = workspacePath;
      if (!workspace || !shouldDestroyWorkspacePath(project, spawnConfig.projectId, path)) {
        return undefined;
      }
      return { path, destroy: (stillOwned) => workspace.destroy(path, stillOwned) };
    };
    if (plugins.workspace) {
      let workspaceCreated = false;
      try {
        // m-13: refuse an external branch before any git runs. Inside the
        // try so a refusal deletes the reservation via the catch below.
        assertSafeBranchForSession(sessionId, branch);

        const wsInfo = await plugins.workspace.create({
          projectId: spawnConfig.projectId,
          project,
          sessionId,
          branch,
        });
        workspacePath = wsInfo.path;
        workspaceCreated = true;

        // Run post-create hooks — clean up workspace on failure
        if (plugins.workspace.postCreate) {
          await plugins.workspace.postCreate(wsInfo, project);
        }
      } catch (err) {
        // Clean up the workspace and the reserved session ID on failure.
        await rollbackLaunch({
          own,
          workspace: workspaceCreated ? spawnWorkspace() : undefined,
        });
        throw err;
      }
    }

    // Generate prompt with validated issue
    let issueContext: string | undefined;
    if (spawnConfig.issueId && plugins.tracker && resolvedIssue) {
      try {
        issueContext = await plugins.tracker.generatePrompt(spawnConfig.issueId, project);
      } catch {
        // Non-fatal: continue without detailed issue context
        // Silently ignore errors - caller can check if issueContext is undefined
      }
    }

    const composedPrompt = buildPrompt({
      project,
      projectId: spawnConfig.projectId,
      issueId: spawnConfig.issueId,
      issueContext,
      userPrompt: spawnConfig.prompt,
      lineage: spawnConfig.lineage,
      siblings: spawnConfig.siblings,
    });

    // The environment of the pane: the agent environment plus this session's
    // own AO_* values. It is built before the launch, so the agent session
    // can be prepared with exactly this environment (I-3).
    const paneEnvironment = (agentEnvironment: Record<string, string>): Record<string, string> => ({
      ...agentEnvironment,
      AO_SESSION: sessionId,
      AO_DATA_DIR: sessionsDir, // Pass sessions directory (not root dataDir)
      AO_SESSION_NAME: sessionId, // User-facing session name
      ...(tmuxName && { AO_TMUX_NAME: tmuxName }), // Tmux session name if using new arch
      AO_CALLER_TYPE: "agent",
      AO_PROJECT_ID: spawnConfig.projectId,
      AO_CONFIG_PATH: config.configPath,
      AO_STATE_ROOT: getStateRoot(),
    });

    // Get agent launch config and create runtime — clean up workspace on failure
    const baseLaunchConfig: AgentLaunchConfig = {
      sessionId,
      projectConfig: { ...project, agentConfig: { ...selection.agentConfig } },
      issueId: spawnConfig.issueId,
      prompt: composedPrompt,
      permissions: selection.permissions,
      model: selection.model,
      subagent: spawnConfig.subagent ?? selection.subagent,
    };
    // m-1: an agent that prepares its session gets the pane environment
    // before the reuse resolver, so every spawn API call (the resolver's
    // too) runs with the environment of the pane.
    // m-5: both run inside the rollback, so a throw from the agent
    // environment or from the resolver removes the workspace and the
    // reservation, as a later launch failure does.
    const opencodeIssueSessionStrategy = project.opencodeIssueSessionStrategy ?? "reuse";
    let preparedEnvironment: Record<string, string> | undefined;
    let reusedOpenCodeSessionId: string | undefined;
    try {
      preparedEnvironment = plugins.agent.prepareAgentSession
        ? paneEnvironment(plugins.agent.getEnvironment(baseLaunchConfig))
        : undefined;
      reusedOpenCodeSessionId =
        plugins.agent.name === "opencode" && spawnConfig.issueId
          ? await resolveOpenCodeSessionReuse({
              sessionsDir,
              project,
              criteria: { issueId: spawnConfig.issueId },
              strategy: opencodeIssueSessionStrategy,
              env: preparedEnvironment,
            })
          : undefined;
    } catch (err) {
      await rollbackLaunch({ own, workspace: spawnWorkspace() });
      throw err;
    }
    // Session relaunch (review r1 M-1, M-4): a new token of this launch. The
    // agent gives it to its process alone; the record keeps it with the
    // launch time, so `relaunch --continue` knows the conversation of this
    // launch's agent from the conversation of any other claude.
    const launchToken = randomUUID();
    const agentLaunchConfig: AgentLaunchConfig = {
      ...baseLaunchConfig,
      launchToken,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
        },
      },
    };

    let prepared: PreparedAgentSession | undefined;
    // The launch time of the write before `runtime.create` (a prepared launch,
    // or a launch in LAUNCH_END_UNPROVEN_RUNTIMES), so that later writes keep it.
    let preCreateAt: string | undefined;
    // The launch fields that every write of this launch stores.
    const launchFields = (createdAt: string) => ({
      worktree: workspacePath,
      branch,
      status: "spawning",
      tmuxName,
      issue: spawnConfig.issueId,
      project: spawnConfig.projectId,
      agent: selection.agentName,
      model: selection.model,
      permissions: selection.permissions ?? "default",
      createdAt,
    });
    // The agent metadata of this launch (the prepared or the reused agent session).
    const launchMetadata = (): Record<string, string> =>
      prepared
        ? { ...prepared.metadata }
        : { ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}) };
    // Stored spawn identity: every worker persists its effective model
    // (selection.model, which is the explicit --model when given) and its
    // effective permission mode ("default" when the config object sets no
    // mode — the YAML loader always sets one, its default is
    // `permissionless` — so that a later config edit cannot add one).
    // Later operations reuse both before the config. Only `ao spawn`
    // supplies a model (batch-spawn has no --model flag); the mode comes
    // from the config.
    const launchedRecordFor = (launched: RuntimeHandle) => {
      const launchCreatedAt = preCreateAt ?? new Date().toISOString();
      return {
        ...launchFields(launchCreatedAt),
        [LAUNCH_TOKEN_KEY]: launchToken,
        [LAUNCH_TOKEN_AT_KEY]: launchCreatedAt,
        runtimeHandle: JSON.stringify(launched),
        opencodeSessionId: launchMetadata()["opencodeSessionId"],
      };
    };
    let handle: RuntimeHandle;
    try {
      let launchCommand: string;
      let environment: Record<string, string>;
      if (plugins.agent.prepareAgentSession && preparedEnvironment) {
        environment = preparedEnvironment;
        // B-1: the record names the reused agent session before the prepare
        // switches it. The launch keys of this `ao` process are in the record
        // since the reservation, so the shared-ID guard does not take the
        // record for a dead holder while its pane does not exist yet.
        if (reusedOpenCodeSessionId) {
          own.write(
            { opencodeSessionId: reusedOpenCodeSessionId },
            "the spawn stored its reused agent session",
          );
        }
        // I-3: the agent makes its own session ready before the pane starts
        // (OpenCode: model check, then create or the switch of a reused
        // session, then readback). A throw fails the spawn here: no pane.
        prepared = await plugins.agent.prepareAgentSession(agentLaunchConfig, {
          workspacePath,
          environment,
        });
        // Store the prepared values before the pane starts, so an `ao spawn`
        // that dies later leaves a record that names the agent session.
        preCreateAt = new Date().toISOString();
        own.write(
          { ...launchFields(preCreateAt), ...prepared.metadata, [RESERVATION_KEY]: "" },
          "the spawn prepared its agent session",
        );
        launchCommand = plugins.agent.getLaunchCommand(
          withPreparedAgentConfig(agentLaunchConfig, prepared),
        );
      } else {
        launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
        environment = paneEnvironment(plugins.agent.getEnvironment(agentLaunchConfig));
        // Herdr fit-2 (design r11 5.2.2): the launch fields go into the record
        // before the create, as a prepared launch stores them, so a crashed
        // launch leaves a record that names its worktree and agent. The
        // write merges: P and the claim stay.
        if (unproven) {
          preCreateAt = new Date().toISOString();
          own.write(
            { ...launchFields(preCreateAt), [RESERVATION_KEY]: "" },
            "the spawn stored its launch",
          );
        }
      }

      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId, // Use tmux name for runtime if available
        workspacePath,
        launchCommand,
        environment,
      });
    } catch (err) {
      if (isRuntimeCreatePartialError(err)) {
        // Herdr fit-2 F-4: something of the session may exist in the runtime,
        // so the record (with the partial handle), the workspace and the
        // agent session stay (rollbackLaunch for a runtime in the set).
        await rollbackLaunch({
          own,
          prepared,
          workspace: spawnWorkspace(),
          runtime: plugins.runtime,
          handle: err.handle,
          failure: err,
          partialRecord: launchedRecordFor(err.handle),
          ownClaim,
        });
      } else {
        // Remove only an agent session that this spawn created (never a reused
        // one), the workspace and the reserved ID.
        await rollbackLaunch({ own, prepared, workspace: spawnWorkspace() });
      }
      throw err;
    }

    // Write metadata and run post-launch setup — clean up on failure
    const session: Session = {
      id: sessionId,
      projectId: spawnConfig.projectId,
      status: "spawning",
      activity: "active",
      branch,
      issueId: spawnConfig.issueId ?? null,
      pr: null,
      workspacePath,
      runtimeHandle: handle,
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: launchMetadata(),
    };

    let confirmation: AgentLaunchConfirmation | undefined;
    try {
      // B-1: a merge (into the own record only), so the launch keys stay
      // until `confirmLaunch` proves that the pane runs the agent on its
      // session. The reservation ID goes: the launch identity now names it.
      // Herdr fit-2 (design r11 4.5): for a runtime in the set the write is a
      // publication (a write that threw or took no effect is decided by a
      // strict read).
      const launchedRecord = { ...launchedRecordFor(handle), [RESERVATION_KEY]: "" };
      if (unproven) own.publish(launchedRecord, "the spawn started its runtime", handle);
      else own.write(launchedRecord, "the spawn started its runtime");

      if (plugins.agent.postLaunchSetup) {
        await plugins.agent.postLaunchSetup(session);
      }

      // I-3: prove that the pane runs the agent on the prepared session. A
      // throw (dead pane, timeout) fails the spawn and cleans up below.
      if (prepared && plugins.agent.confirmLaunch) {
        confirmation = await plugins.agent.confirmLaunch(session, prepared, {
          timeoutMs: LAUNCH_CONFIRM_TIMEOUT_MS,
          promptExpected: launchHasPrompt(agentLaunchConfig),
          promptTimeoutMs: LAUNCH_PROMPT_CONFIRM_TIMEOUT_MS,
        });
      }

      if (prepared) {
        own.write(session.metadata, "the spawn confirmed its launch");
      } else if (Object.keys(session.metadata || {}).length > 0) {
        own.write(session.metadata, "the spawn set up its agent");
      }
      // B-1: the launch is confirmed; from now on the pane rule applies.
      // Herdr fit-2 (design r11 4.5): only this launch's own claim goes,
      // compared by the identity of its last own write.
      settleOwnClaim(sessionsDir, sessionId, own.identity(), ownClaim);
    } catch (err) {
      // Clean up runtime and workspace on post-launch failure. The runtime
      // goes first, so no pane still uses the agent session that is removed.
      await rollbackLaunch({
        own,
        runtime: plugins.runtime,
        handle,
        prepared,
        workspace: spawnWorkspace(),
        failure: err,
        ownClaim,
      });
      throw err;
    }

    // Send initial prompt post-launch for agents that need it (e.g. Claude Code
    // exits after -p, so we send the prompt after it starts in interactive mode).
    // This is intentionally outside the try/catch above — a prompt delivery failure
    // should NOT destroy the session. The agent is running; user can retry with `ao send`.
    let promptDelivered = false;
    if (plugins.agent.promptDelivery === "post-launch" && agentLaunchConfig.prompt) {
      const maxRetries = 3;
      const baseDelayMs = 3_000;
      let lastError: Error | undefined;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Wait for agent to start and be ready for input
          // Use exponential backoff: 3s, 6s, 9s between attempts
          await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
          await plugins.runtime.sendMessage(handle, agentLaunchConfig.prompt);
          promptDelivered = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          console.error(
            `[session-manager] Prompt delivery attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
          );
        }
      }

      if (!promptDelivered) {
        console.error(
          `[session-manager] FAILED to deliver prompt to session ${sessionId} after ${maxRetries} attempts. ` +
            `User must send manually with 'ao send'. Last error: ${lastError?.message}`,
        );
      }

      session.metadata["promptDelivered"] = String(promptDelivered);
    } else if (confirmation?.promptDelivered !== undefined) {
      // The agent checked its own session for the prompt (I-3).
      session.metadata["promptDelivered"] = String(confirmation.promptDelivered);
      if (!confirmation.promptDelivered) warnLaunchPromptNotSeen(sessionId);
    } else if (agentLaunchConfig.prompt) {
      session.metadata["promptDelivered"] = "true";
    }

    if (session.metadata["promptDelivered"]) {
      try {
        own.write(session.metadata, "the spawn delivered its prompt");
      } catch (err) {
        // B-1: a kill, restore or new reservation replaced this launch after
        // it started; its delivery note does not belong to that record.
        if (own.check().state === "own") throw err;
        warnOperator(`ao: ${shortErrorText(err)}`);
      }
    }

    return session;
  }

  async function spawnOrchestrator(orchestratorConfig: OrchestratorSpawnConfig): Promise<Session> {
    const project = config.projects[orchestratorConfig.projectId];
    if (!project) {
      throw new Error(`Unknown project: ${orchestratorConfig.projectId}`);
    }

    const selection = resolveAgentSelection({
      role: "orchestrator",
      project,
      defaults: config.defaults,
    });
    const plugins = resolvePlugins(project, selection.agentName);
    if (!plugins.runtime) {
      throw new Error(`Runtime plugin '${project.runtime ?? config.defaults.runtime}' not found`);
    }
    if (!plugins.agent) {
      throw new Error(`Agent plugin '${selection.agentName}' not found`);
    }

    const orchestratorSessionStrategy = normalizeOrchestratorSessionStrategy(
      project.orchestratorSessionStrategy,
    );
    const orchestratorWorkspaceMode = project.orchestratorWorkspaceMode ?? "isolated";

    // Get the sessions directory for this project
    const sessionsDir = getProjectSessionsDir(project);

    let branch: string;
    let workspacePath: string;
    // Herdr fit-2 (design r11 4.4, 4.5): as for a worker spawn, a create
    // runtime in LAUNCH_END_UNPROVEN_RUNTIMES takes the launch claim, and the
    // reservation holds the pending handle P with the orchestrator role.
    const unproven = isLaunchEndUnproven(plugins.runtime.name);
    const ownClaim = plugins.agent.prepareAgentSession || unproven ? await readLaunchClaim() : null;
    const reservation = reservationInitial(plugins.runtime.name, ownClaim, {
      role: "orchestrator",
    });

    /**
     * Same-ID R2a: stop a live orchestrator before this start replaces it.
     * Only `destroyed` or `absent` goes on; anything else throws, so the
     * start removes no record and creates no runtime. Herdr fit-2 (design
     * r11 5.3.1): it runs under A, with the core bound.
     */
    const orchestratorRuntime = plugins.runtime;
    const orchestratorAgent = plugins.agent;
    const stopOrchestratorOrRefuse = async (handle: RuntimeHandle, kept: string): Promise<void> => {
      // Herdr fit-2 (design r11 4.6): through the handle's runtime; one that
      // is in the set and not loaded is an unconfirmed stop.
      const handleRuntime = runtimeForHandle(handle, orchestratorRuntime);
      const stopped = handleRuntime
        ? await stopWithinBound(handleRuntime, handle)
        : notLoadedStop(handle);
      if (!isRuntimeStopConfirmed(stopped)) {
        throw new RuntimeStopUnconfirmedError({
          sessionId: `${project.sessionPrefix}-orchestrator`,
          handle,
          stop: stopped,
          kept,
          retry: "ao start",
        });
      }
    };

    const fixedId = `${project.sessionPrefix}-orchestrator`;
    const fixedTmuxName = config.configPath
      ? `${generateConfigHash(config.configPath)}-${fixedId}`
      : undefined;
    const selectedRuntime = project.runtime ?? config.defaults.runtime;
    const reusesLiveRecord =
      orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore";
    /** Herdr fit-2 R8 (design r11 4.7): the reason when this start may not reuse a record. */
    const r8 = (id: string): string | undefined => {
      if (id !== fixedId) return "an isolated record";
      if (orchestratorWorkspaceMode !== "project") {
        return `the workspace mode is now ${orchestratorWorkspaceMode}`;
      }
      if (!reusesLiveRecord) {
        return `the strategy ${orchestratorSessionStrategy} would stop it, and a Herdr stop cannot confirm before RH`;
      }
      return undefined;
    };
    /** True when G1 would select `raw` (a record of the set that appeared during the launch step). */
    const selectedByG1 = async (raw: Record<string, string>): Promise<boolean> =>
      isUnprovenLaunchRecord(raw, selectedRuntime) ||
      (!raw["runtimeHandle"] &&
        isLaunchEndUnproven(selectedRuntime) &&
        (await liveLaunchOwner(raw)) !== null);

    type StartAdmitted =
      | { reused: Session }
      | { reserved: Record<string, string>; sessionId: string; tmuxName: string | undefined };

    /**
     * The launch step of project mode, under A (design r11 5.3.2): today's
     * branch for a fixed-ID record of a runtime outside the set, with the
     * dispatch of 4.6 and each runtime call bounded; then the subject check
     * and the reservation with P. A record of the set that appears here is
     * decided by the next round.
     */
    const reserveProjectMode = async (
      checkSubject: () => void,
      selected: number,
    ): Promise<AdmissionDecision<StartAdmitted>> => {
      const id = fixedId;
      const existingRaw = readMetadataRaw(sessionsDir, id);
      if (existingRaw && (await selectedByG1(existingRaw))) return { kind: "next" };
      // B-2: another `ao start` still launches this orchestrator. Its rollback
      // or its later writes would hit the record that this start makes, so
      // neither reuse nor replace it.
      if (existingRaw) await assertNoLiveLauncher(id, existingRaw, "replace");
      const existingOrchestrator = existingRaw?.["runtimeHandle"]
        ? metadataToSession(id, existingRaw, orchestratorConfig.projectId)
        : null;
      // B-1 (round 4): the liveness check awaits; the old orchestrator is
      // stopped and its record removed only while the record still names
      // the launch that was checked. Another start that replaced it in the
      // meantime keeps its record (the reservation below then fails, and
      // the concurrent path decides again from the new record).
      const stillNames = (read: Record<string, string>): boolean => {
        const current = readMetadataRaw(sessionsDir, id);
        return !!current && holdsExpected(current, launchIdentity(read));
      };
      if (existingRaw && existingOrchestrator?.runtimeHandle) {
        const existingAlive = await outsideSetOrchestratorAlive(
          runtimeForHandle(existingOrchestrator.runtimeHandle, plugins.runtime),
          existingOrchestrator.runtimeHandle,
          id,
          admission.probeTimeoutMs,
        );
        if (existingAlive && reusesLiveRecord) {
          // Round 8 (M-1): null only for a missing record; a record that
          // cannot be read throws and keeps the runtime.
          const persistedRaw = readRecordStrict(sessionsDir, id);
          if (persistedRaw?.["runtimeHandle"]) {
            if (await selectedByG1(persistedRaw)) return { kind: "next" };
            const persisted = metadataToSession(id, persistedRaw, orchestratorConfig.projectId);
            persisted.metadata["orchestratorSessionReused"] = "true";
            return { kind: "done", value: { reused: persisted } };
          }
          // The record is gone (another process archived or deleted it)
          // while its runtime still runs: no record names that runtime, so
          // it is stopped before this start uses the ID and its runtime name.
          // A record without a handle is another start's reservation, and
          // it is kept (the reservation below then fails).
          // Same-ID R2a: only a confirmed stop lets the start use the ID.
          if (!persistedRaw) {
            await stopOrchestratorOrRefuse(
              existingOrchestrator.runtimeHandle,
              "no record names it; no new orchestrator was started",
            );
          }
        } else if (existingAlive) {
          if (stillNames(existingRaw)) {
            // Same-ID R2a: the record is deleted, and a new orchestrator
            // started, only after a confirmed stop of the live one.
            await stopOrchestratorOrRefuse(
              existingOrchestrator.runtimeHandle,
              "its record kept; no second orchestrator was started",
            );
            deleteMetadata(sessionsDir, id, false, launchIdentity(existingRaw));
          }
        } else {
          deleteMetadata(sessionsDir, id, reusesLiveRecord, launchIdentity(existingRaw));
        }
      }

      await admission.stage("before-reservation", selected);
      checkSubject();
      let reservedRecord = reserveSessionRecord(sessionsDir, id, reservation ?? undefined);
      if (!reservedRecord) {
        const concurrentRaw = readMetadataRaw(sessionsDir, id);
        if (concurrentRaw && (await selectedByG1(concurrentRaw))) return { kind: "next" };
        if (concurrentRaw) await assertNoLiveLauncher(id, concurrentRaw, "replace");
        const concurrentSession = concurrentRaw?.["runtimeHandle"]
          ? metadataToSession(id, concurrentRaw, orchestratorConfig.projectId)
          : null;
        if (concurrentRaw && concurrentSession?.runtimeHandle) {
          const concurrentAlive = await outsideSetOrchestratorAlive(
            runtimeForHandle(concurrentSession.runtimeHandle, plugins.runtime),
            concurrentSession.runtimeHandle,
            id,
            admission.probeTimeoutMs,
          );
          if (concurrentAlive && reusesLiveRecord) {
            concurrentSession.metadata["orchestratorSessionReused"] = "true";
            return { kind: "done", value: { reused: concurrentSession } };
          }
          if (!concurrentAlive) {
            deleteMetadata(sessionsDir, id, reusesLiveRecord, launchIdentity(concurrentRaw));
            checkSubject();
            reservedRecord = reserveSessionRecord(sessionsDir, id, reservation ?? undefined);
          }
        } else {
          checkSubject();
          reservedRecord = reserveSessionRecord(sessionsDir, id, reservation ?? undefined);
        }
        if (!reservedRecord) {
          throw new Error(`Session ${id} already exists but is not in a reusable state`);
        }
      }
      return {
        kind: "done",
        value: { reserved: reservedRecord, sessionId: id, tmuxName: fixedTmuxName },
      };
    };

    // Herdr fit-2 F-7 (design r11 5.3.2): the admission of this start. G
    // blocks a known-Herdr orchestrator record that it cannot reuse; it
    // reuses only the project-mode record that R accepts with an `alive`
    // answer for its identity token. Nothing is written before the admitted
    // step, which runs under A: the `.origin` file, the project-mode hooks,
    // then the reuse, or the old-record branch and the reservation with P.
    const admitted = await runAdmission<StartAdmitted>({
      mode: "start",
      projectId: orchestratorConfig.projectId,
      project,
      sessionsDir,
      createInSet: unproven,
      r8,
      decide: async ({ judged, answers, checkSubject, selected }) => {
        const decided = judged.map((entry) => withAnswer(entry, answers));
        const blocking = decided.filter((entry) => entry.block);
        if (blocking.length > 0) return { kind: "blocked", blocking };
        const candidate = decided.find((entry) => entry.handle);
        // Validate and store .origin file before reserving any identity so that
        // a validation failure does not leave an orphaned metadata entry.
        if (config.configPath) {
          validateAndStoreOrigin(config.configPath, project.path);
        }
        if (orchestratorWorkspaceMode === "project" && orchestratorAgent.setupWorkspaceHooks) {
          await orchestratorAgent.setupWorkspaceHooks(project.path, { dataDir: sessionsDir });
        }
        if (candidate) {
          // r10: the hooks awaited, so the record must still hold the
          // identity token of the deciding round and pass R1 to R6; else the
          // next round decides.
          const current = readRecordStrict(sessionsDir, candidate.record.id);
          if (!current || launchIdentityToken(current) !== candidate.record.token) {
            return { kind: "next" };
          }
          const again = judgeOrchestratorRecord(
            { ...candidate.record, raw: current, owner: await liveLaunchOwner(current) },
            selectedRuntime,
            { r8 },
          );
          if (again.block) return { kind: "next" };
          const persisted = metadataToSession(
            candidate.record.id,
            current,
            orchestratorConfig.projectId,
          );
          persisted.metadata["orchestratorSessionReused"] = "true";
          return { kind: "done", value: { reused: persisted } };
        }
        if (orchestratorWorkspaceMode === "project") {
          return reserveProjectMode(checkSubject, selected);
        }
        // Reserve a new unique orchestrator identity (e.g. {prefix}-orchestrator-1, -2, …).
        // Each isolated orchestrator gets its own numbered session and workspace.
        await admission.stage("before-reservation", selected);
        checkSubject();
        const identity = reserveNextOrchestratorIdentity(project, sessionsDir, reservation);
        return {
          kind: "done",
          value: {
            reserved: identity.record,
            sessionId: identity.sessionId,
            tmuxName: identity.tmuxName,
          },
        };
      },
    });
    if ("reused" in admitted) return admitted.reused;

    const sessionId = admitted.sessionId;
    const tmuxName = admitted.tmuxName;
    // B-1 (round 4): the record that this start reserved; its writes go there only.
    const own: OwnLaunchRecord = ownLaunchRecord(sessionsDir, sessionId, admitted.reserved);
    if (orchestratorWorkspaceMode === "project") {
      branch = project.defaultBranch;
      workspacePath = project.path;
    } else {
      branch = `orchestrator/${sessionId}`;

      try {
        // m-13: refuse an unsafe branch before any git runs. Inside the
        // try so a refusal deletes the reservation via the catch below,
        // the same order as the worker spawn path.
        assertSafeBranchForSession(sessionId, branch);

        if (!plugins.workspace) {
          throw new Error(
            `spawnOrchestrator requires a workspace plugin but none is configured for project '${orchestratorConfig.projectId}'`,
          );
        }

        const wsInfo = await plugins.workspace.create({
          projectId: orchestratorConfig.projectId,
          project,
          sessionId,
          branch,
        });
        workspacePath = wsInfo.path;
      } catch (err) {
        await rollbackLaunch({ own });
        throw err;
      }

      try {
        if (plugins.agent.setupWorkspaceHooks) {
          await plugins.agent.setupWorkspaceHooks(workspacePath, { dataDir: sessionsDir });
        }
      } catch (err) {
        const isolatedWorkspace = plugins.workspace;
        await rollbackLaunch({
          own,
          workspace: {
            path: workspacePath,
            destroy: (stillOwned) => isolatedWorkspace.destroy(workspacePath, stillOwned),
          },
        });
        throw err;
      }
    }

    const workspacePlugin = plugins.workspace;
    // Undo a failed start (see rollbackLaunch) and remove its prompt file.
    const rollbackOrchestratorLaunch = async (
      promptFile: string | undefined,
      failed: {
        handle?: RuntimeHandle;
        prepared?: PreparedAgentSession;
        failure?: unknown;
        partialRecord?: Partial<Record<string, string>>;
        ownClaim?: LaunchClaim | null;
      } = {},
    ): Promise<void> => {
      const { stopUnconfirmed } = await rollbackLaunch({
        own,
        runtime: plugins.runtime ?? undefined,
        handle: failed.handle,
        prepared: failed.prepared,
        failure: failed.failure,
        partialRecord: failed.partialRecord,
        ownClaim: failed.ownClaim,
        workspace:
          orchestratorWorkspaceMode === "isolated" && workspacePlugin
            ? {
                path: workspacePath,
                destroy: (stillOwned) => workspacePlugin.destroy(workspacePath, stillOwned),
              }
            : undefined,
      });
      // Round 5: the prompt file name is the same for every start of the
      // ID; it stays when another start replaced the record. Round 8 (M-1):
      // it stays too when the record cannot be read. Same-ID R2a: and when
      // the runtime that may read it could not be confirmed stopped.
      if (!promptFile || stopUnconfirmed) return;
      const checked = own.checkOrUnknown();
      if (checked.state === "unknown") {
        warnOperator(
          `ao: kept the prompt file ${promptFile} of a failed start: the record of ${sessionId} could not be read (${shortErrorText(checked.error)}).`,
        );
      } else if (checked.state !== "replaced") {
        try {
          unlinkSync(promptFile);
        } catch {
          /* best effort */
        }
      }
    };

    // Write system prompt to a file to avoid shell/tmux truncation.
    // Long prompts (2000+ chars) get mangled when inlined in shell commands
    // via tmux send-keys or paste-buffer. File-based approach is reliable.
    let systemPromptFile: string | undefined;
    if (orchestratorConfig.systemPrompt) {
      try {
        const baseDir = getProjectBaseDir(config.configPath, project.path);
        mkdirSync(baseDir, { recursive: true });
        systemPromptFile = join(baseDir, `orchestrator-prompt-${sessionId}.md`);
        writeFileSync(systemPromptFile, orchestratorConfig.systemPrompt, "utf-8");
      } catch (err) {
        await rollbackOrchestratorLaunch(systemPromptFile);
        throw err;
      }
    }

    // The environment of the pane, as for a worker spawn (I-3).
    const paneEnvironment = (agentEnvironment: Record<string, string>): Record<string, string> => ({
      ...agentEnvironment,
      AO_SESSION: sessionId,
      AO_DATA_DIR: sessionsDir,
      AO_SESSION_NAME: sessionId,
      ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
      AO_CALLER_TYPE: "orchestrator",
      AO_PROJECT_ID: orchestratorConfig.projectId,
      AO_CONFIG_PATH: config.configPath,
      AO_STATE_ROOT: getStateRoot(),
    });

    // Get agent launch config — uses systemPromptFile, no issue/tracker interaction.
    // Orchestrator ALWAYS gets permissionless mode — it must run ao CLI commands autonomously.
    const baseLaunchConfig: AgentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: { ...selection.agentConfig, permissions: "permissionless" as const },
      },
      permissions: "permissionless" as const,
      model: selection.model,
      systemPromptFile,
      subagent: selection.subagent,
    };
    // m-1: the pane environment before the resolver, as for a worker spawn.
    // m-5: inside the rollback, so a throw removes the workspace, the
    // reservation and the prompt file.
    let preparedEnvironment: Record<string, string> | undefined;
    let reusableOpenCodeSessionId: string | undefined;
    try {
      preparedEnvironment = plugins.agent.prepareAgentSession
        ? paneEnvironment(plugins.agent.getEnvironment(baseLaunchConfig))
        : undefined;
      reusableOpenCodeSessionId =
        plugins.agent.name === "opencode" && orchestratorSessionStrategy === "reuse"
          ? await resolveOpenCodeSessionReuse({
              sessionsDir,
              project,
              criteria: { sessionId },
              strategy: "reuse",
              env: preparedEnvironment,
            })
          : undefined;
      if (plugins.agent.name === "opencode" && orchestratorSessionStrategy === "delete") {
        await resolveOpenCodeSessionReuse({
          sessionsDir,
          project,
          criteria: { sessionId },
          strategy: "delete",
          env: preparedEnvironment,
          own,
        });
      }
    } catch (err) {
      await rollbackOrchestratorLaunch(systemPromptFile);
      throw err;
    }

    // Session relaunch (review r1 M-1, M-4): a new token of this launch. The
    // agent gives it to its process alone; the record keeps it with the
    // launch time, so `relaunch --continue` knows the conversation of this
    // launch's agent from the conversation of any other claude.
    const launchToken = randomUUID();
    const agentLaunchConfig: AgentLaunchConfig = {
      ...baseLaunchConfig,
      launchToken,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          permissions: "permissionless" as const,
          ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
        },
      },
    };

    // An agent can refuse the launch (for example an unsupported binary version,
    // or a model that OpenCode does not list). Clean up like any later failure,
    // so a refused orchestrator spawn leaves no worktree, reserved metadata or
    // prompt file behind.
    let prepared: PreparedAgentSession | undefined;
    // The launch time of the write before `runtime.create` (a prepared launch,
    // or a launch in LAUNCH_END_UNPROVEN_RUNTIMES), so that later writes keep it.
    let preCreateAt: string | undefined;
    // The launch fields that every write of this start stores.
    const launchFields = (createdAt: string) => ({
      worktree: workspacePath,
      branch,
      status: "working",
      role: "orchestrator",
      tmuxName,
      project: orchestratorConfig.projectId,
      agent: selection.agentName,
      createdAt,
    });
    // The agent metadata of this start (the prepared or the reused agent session).
    const launchMetadata = (): Record<string, string> =>
      prepared
        ? { ...prepared.metadata }
        : {
            ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
          };
    const launchedRecordFor = (launched: RuntimeHandle) => {
      const launchCreatedAt = preCreateAt ?? new Date().toISOString();
      return {
        ...launchFields(launchCreatedAt),
        [LAUNCH_TOKEN_KEY]: launchToken,
        [LAUNCH_TOKEN_AT_KEY]: launchCreatedAt,
        runtimeHandle: JSON.stringify(launched),
        opencodeSessionId: launchMetadata()["opencodeSessionId"],
      };
    };
    let launchCommand: string;
    let environment: Record<string, string>;
    try {
      if (plugins.agent.prepareAgentSession && preparedEnvironment) {
        // I-3: the same claim, create, store and check as a worker spawn.
        environment = preparedEnvironment;
        if (reusableOpenCodeSessionId) {
          own.write(
            { opencodeSessionId: reusableOpenCodeSessionId },
            "the start stored its reused agent session",
          );
        }
        prepared = await plugins.agent.prepareAgentSession(agentLaunchConfig, {
          workspacePath,
          environment,
        });
        preCreateAt = new Date().toISOString();
        own.write(
          { ...launchFields(preCreateAt), ...prepared.metadata, [RESERVATION_KEY]: "" },
          "the start prepared its agent session",
        );
        launchCommand = plugins.agent.getLaunchCommand(
          withPreparedAgentConfig(agentLaunchConfig, prepared),
        );
      } else {
        launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
        environment = paneEnvironment(plugins.agent.getEnvironment(agentLaunchConfig));
        // Herdr fit-2 (design r11 5.2.2): the launch fields go into the record
        // before the create; the write merges, so P and the claim stay.
        if (unproven) {
          preCreateAt = new Date().toISOString();
          own.write(
            { ...launchFields(preCreateAt), [RESERVATION_KEY]: "" },
            "the start stored its launch",
          );
        }
      }
    } catch (err) {
      await rollbackOrchestratorLaunch(systemPromptFile, { prepared });
      throw err;
    }

    let handle: RuntimeHandle;
    try {
      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId,
        workspacePath,
        launchCommand,
        environment,
      });
    } catch (err) {
      // Herdr fit-2 F-4: a partial create keeps the record (with the partial
      // handle), the workspace, the agent session and the prompt file.
      await rollbackOrchestratorLaunch(
        systemPromptFile,
        isRuntimeCreatePartialError(err)
          ? {
              prepared,
              handle: err.handle,
              failure: err,
              partialRecord: launchedRecordFor(err.handle),
              ownClaim,
            }
          : { prepared },
      );
      throw err;
    }

    // Write metadata and run post-launch setup
    const session: Session = {
      id: sessionId,
      projectId: orchestratorConfig.projectId,
      status: "working",
      activity: "active",
      branch,
      issueId: null,
      pr: null,
      workspacePath,
      runtimeHandle: handle,
      agentInfo: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: launchMetadata(),
    };

    try {
      // B-1: a merge (into the own record only), so the launch keys stay
      // until the launch is confirmed. Herdr fit-2 (design r11 4.5): for a
      // runtime in the set the write is a publication.
      const launchedRecord = { ...launchedRecordFor(handle), [RESERVATION_KEY]: "" };
      if (unproven) own.publish(launchedRecord, "the start started its runtime", handle);
      else own.write(launchedRecord, "the start started its runtime");

      if (plugins.agent.postLaunchSetup) {
        await plugins.agent.postLaunchSetup(session);
      }

      // I-3: prove that the pane runs the agent on the prepared session.
      if (prepared && plugins.agent.confirmLaunch) {
        const confirmation = await plugins.agent.confirmLaunch(session, prepared, {
          timeoutMs: LAUNCH_CONFIRM_TIMEOUT_MS,
          promptExpected: launchHasPrompt(agentLaunchConfig),
          promptTimeoutMs: LAUNCH_PROMPT_CONFIRM_TIMEOUT_MS,
        });
        if (confirmation.promptDelivered !== undefined) {
          session.metadata["promptDelivered"] = String(confirmation.promptDelivered);
          if (!confirmation.promptDelivered) warnLaunchPromptNotSeen(sessionId);
        }
      }

      if (prepared) {
        own.write(session.metadata, "the start confirmed its launch");
      } else if (Object.keys(session.metadata || {}).length > 0) {
        own.write(session.metadata, "the start set up its agent");
      }
      // B-1: the launch is confirmed; from now on the pane rule applies.
      // Herdr fit-2 (design r11 4.5): only this start's own claim goes.
      settleOwnClaim(sessionsDir, sessionId, own.identity(), ownClaim);
    } catch (err) {
      // Clean up runtime on post-launch failure. The runtime goes first, so no
      // pane still uses the agent session that is removed.
      await rollbackOrchestratorLaunch(systemPromptFile, {
        handle,
        prepared,
        failure: err,
        ownClaim,
      });
      throw err;
    }

    return session;
  }

  /**
   * Herdr fit-2 (design r11 5.3.2, 5.3.5): the reuse-only decision for the
   * CLI. It answers the known-Herdr orchestrator records of the project that
   * R accepts (R1 to R7, without R8: any workspace mode and any strategy),
   * read strictly under A in the deciding round, each with an `alive` answer
   * for its identity token. It writes nothing and admits nothing. After three
   * rounds with a record that still needs a probe, it answers the records
   * that are reusable and drops the rest.
   */
  async function findReusableOrchestrators(projectId: string): Promise<Session[]> {
    const project = config.projects[projectId];
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const reusable = (
      judged: AdmissionJudgement[],
      answers: ReadonlyMap<string, OrchestratorLiveness>,
    ): Session[] =>
      judged
        .filter(
          (entry) =>
            !entry.block && entry.handle && answers.get(answerKey(entry.record))?.state === "alive",
        )
        .map((entry) => metadataToSession(entry.record.id, entry.record.raw, projectId));
    return runAdmission<Session[]>({
      mode: "reuse-only",
      projectId,
      project,
      sessionsDir: getProjectSessionsDir(project),
      createInSet: false,
      decide: async ({ judged, answers }) => ({ kind: "done", value: reusable(judged, answers) }),
      exhausted: reusable,
    });
  }

  async function list(projectId?: string): Promise<Session[]> {
    const allSessions = Object.entries(config.projects).flatMap(([entryProjectId, project]) => {
      if (projectId && entryProjectId !== projectId) return [];
      return loadActiveSessionRecords(project).map((record) => ({
        sessionName: record.sessionName,
        projectId: entryProjectId,
        raw: record.raw,
      }));
    });

    const tasks = allSessions.map(async ({ sessionName, projectId: sessionProjectId, raw }) => {
      const project = config.projects[sessionProjectId];
      if (!project) return null;

      const sessionsDir = getProjectSessionsDir(project);

      let createdAt: Date | undefined;
      let modifiedAt: Date | undefined;
      try {
        const metaPath = join(sessionsDir, sessionName);
        const stats = statSync(metaPath);
        createdAt = stats.birthtime;
        modifiedAt = stats.mtime;
      } catch {
        // If stat fails, timestamps will fall back to current time
      }

      const session = metadataToSession(sessionName, raw, sessionProjectId, createdAt, modifiedAt);
      const selection = resolveSelectionForSession(project, sessionName, raw);
      const effectiveAgentName = selection.agentName;
      const plugins = resolvePlugins(project, effectiveAgentName);

      let enrichTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const enrichTimeout = new Promise<void>((resolve) => {
        enrichTimeoutId = setTimeout(resolve, OPENCODE_DISCOVERY_TIMEOUT_MS + 2_000);
      });
      const enrichPromise = ensureHandleAndEnrich(session, sessionName, project, plugins).catch(
        () => {},
      );
      try {
        await Promise.race([enrichPromise, enrichTimeout]);
      } finally {
        if (enrichTimeoutId) {
          clearTimeout(enrichTimeoutId);
        }
      }

      return session;
    });

    const resolved = await Promise.all(tasks);
    return resolved.filter((session): session is Session => session !== null);
  }

  async function get(sessionId: SessionId): Promise<Session | null> {
    // Try to find the session in any project's sessions directory
    for (const [projectId, project] of Object.entries(config.projects)) {
      const sessionsDir = getProjectSessionsDir(project);
      const raw = readMetadataRaw(sessionsDir, sessionId);
      if (!raw) continue;

      // Get file timestamps for createdAt/lastActivityAt
      let createdAt: Date | undefined;
      let modifiedAt: Date | undefined;
      try {
        const metaPath = join(sessionsDir, sessionId);
        const stats = statSync(metaPath);
        createdAt = stats.birthtime;
        modifiedAt = stats.mtime;
      } catch {
        // If stat fails, timestamps will fall back to current time
      }

      const repaired = repairSingleSessionMetadataOnRead(
        sessionsDir,
        { sessionName: sessionId, raw, modifiedAt },
        project.sessionPrefix,
      );

      const session = metadataToSession(sessionId, repaired.raw, projectId, createdAt, modifiedAt);

      const selection = resolveSelectionForSession(project, sessionId, repaired.raw);
      const effectiveAgentName = selection.agentName;
      const plugins = resolvePlugins(project, effectiveAgentName);
      await ensureHandleAndEnrich(session, sessionId, project, plugins);

      return session;
    }

    return null;
  }

  async function kill(sessionId: SessionId, options?: SessionKillOptions): Promise<void> {
    return killRecord(sessionId, options);
  }

  /**
   * Herdr fit-2 F-9 (design r11 5.4.2 steps 2 and 3): the handle of a record
   * that the owner may retire with `confirmRuntimeClosed`, or a refusal that
   * changes nothing. Only a handle of a runtime in
   * LAUNCH_END_UNPROVEN_RUNTIMES (any status, a kept failed launch, P, an
   * empty ID, malformed pins) with the identity token of the record.
   */
  function retirableHandle(
    sessionId: SessionId,
    raw: Record<string, string>,
    token: string,
  ): RuntimeHandle {
    const text = raw["runtimeHandle"];
    const byHand =
      'retire it by hand (docs/DEVELOPMENT.md, "Retire a Herdr record by hand"); nothing was changed';
    if (!text) {
      throw new Error(
        `Session ${sessionId} has no runtime handle, so --confirm-runtime-closed names no launch of it; ${byHand}`,
      );
    }
    const parsed = safeJsonParse<unknown>(text);
    if (!isWellFormedHandle(parsed)) {
      throw new Error(
        `The runtime handle of ${sessionId} cannot be read (${text.slice(0, 80)}); ${byHand}`,
      );
    }
    if (!isLaunchEndUnproven(parsed.runtimeName)) {
      throw new Error(
        `Session ${sessionId} is a ${parsed.runtimeName} record: the ${parsed.runtimeName} stop confirms itself, so --confirm-runtime-closed does not apply; run ao session kill ${sessionId}. Nothing was changed.`,
      );
    }
    const current = launchIdentityToken(raw);
    if (token !== current) {
      throw new Error(
        `Session ${sessionId}: the record now names another launch (identity token ${current}); check it again before you retire it. Nothing was changed.`,
      );
    }
    return parsed;
  }

  /**
   * Herdr fit-2 F-9 (design r11 5.4.2 step 7): after a stop that cannot
   * confirm, one `isAlive` of the handle with its pins and the core bound.
   * A pane that runs refuses; any other answer is the evidence that the
   * owner's word stands on.
   */
  async function retireEvidence(
    sessionId: SessionId,
    runtime: Runtime,
    handle: RuntimeHandle,
  ): Promise<string> {
    const liveness = await classifyOrchestratorLiveness(runtime, handle, admission.probeTimeoutMs);
    if (liveness.state === "alive") {
      const socket =
        typeof handle.data["herdrSocket"] === "string" ? handle.data["herdrSocket"] : "";
      throw new Error(
        `Session ${sessionId} was not retired: herdr shows pane ${handle.id} with its terminal${socket ? ` at ${socket}` : ""}: the session runs; close it first. Nothing was changed.`,
      );
    }
    const cause =
      liveness.state === "unknown" && liveness.cause ? `: ${firstErrorLine(liveness.cause)}` : "";
    return `${liveness.reason}${cause}`.slice(0, 200);
  }

  /**
   * Round 5 (M-2): the values that a cleanup decision to kill used: the PR
   * and the issue that it checked, the status, and the launch. A claim of
   * another PR, an issue change, a status write (by Node or by a bash
   * helper) or a new launch since the read makes the decision stale.
   */
  function cleanupDecisionOf(metadata: Readonly<Record<string, string>>): Record<string, string> {
    return {
      pr: metadata["pr"] ?? "",
      issue: metadata["issue"] ?? "",
      status: metadata["status"] ?? "",
      ...launchIdentity(metadata),
    };
  }

  /**
   * The kill. B-1 (round 4): the record is archived only while it still names
   * the launch that this kill read (its launch identity), so a restore, a
   * new launch or a new reservation of the ID during the kill keeps its
   * record, and the kill throws. A status or PR write of another process
   * does not stop a direct kill. `decidedFrom` (cleanup): the record that a
   * caller decided to kill from before it awaited. Round 5 (M-2): the kill
   * then compares the facts of that decision too (`cleanupDecisionOf`: PR,
   * issue and status, plus the launch identity); a record where one of them
   * changed is not touched at all, and a change during the kill stops the
   * later steps. Round 5 (1.0.1): each step reads the record directly
   * before it, with no await between the check and the step. Same-ID R2a:
   * a runtime stop that is not confirmed (`stopRuntime` answers
   * `other-launch` or `unknown`) throws RuntimeStopUnconfirmedError before
   * any removal, so the worktree, the agent session and the record stay.
   */
  async function killRecord(
    sessionId: SessionId,
    options?: SessionKillOptions,
    decidedFrom?: Readonly<Record<string, string>>,
  ): Promise<void> {
    // Herdr fit-2 F-9 (design r11 5.4.2): the owner's word that the runtime
    // is closed, for the launch that the identity token names. A direct
    // kill only; each refusal changes nothing, so F-9 reads the record
    // strictly and without the read repair (review r1 sol M-1).
    const retireToken = decidedFrom ? undefined : options?.confirmRuntimeClosed;
    const { raw, sessionsDir, project, projectId } =
      retireToken !== undefined
        ? requireSessionRecordStrict(sessionId)
        : requireSessionRecord(sessionId);
    const expected = decidedFrom ? cleanupDecisionOf(decidedFrom) : launchIdentity(raw);
    if (decidedFrom && !holdsExpected(raw, expected)) {
      throw recordChangedError(
        sessionsDir,
        sessionId,
        "it was checked for cleanup",
        "it was not killed",
      );
    }
    if (retireToken !== undefined) retirableHandle(sessionId, raw, retireToken);
    // B-2: the launcher does not watch for a kill; it would go on and write
    // the record again, maybe with an agent session that this kill removed.
    await assertNoLiveLauncher(sessionId, raw, "kill");

    const cleanupAgent = resolveSelectionForSession(project, sessionId, raw).agentName;

    // B-1 (round 4): the destroy steps await. A restore (or a new launch) of
    // the ID meanwhile uses the same worktree path and the same agent
    // session, so the later steps stop when the record names another launch
    // (or, for cleanup, when a fact of its decision changed). A record that
    // is gone (another kill archived it) does not stop them.
    // Round 8 (M-1): a record that cannot be read or checked throws, so it
    // stops the kill too.
    const stopWhenReplaced = (kept: string): void => {
      const current = readRecordStrict(sessionsDir, sessionId);
      if (current && !holdsExpected(current, expected)) {
        throw recordChangedError(sessionsDir, sessionId, "it was killed", kept);
      }
    };

    // Destroy runtime — prefer handle.runtimeName to find the correct plugin
    if (raw["runtimeHandle"]) {
      const handle = safeJsonParse<RuntimeHandle>(raw["runtimeHandle"]);
      if (handle) {
        // Herdr fit-2 (design r11 4.6): a handle of a runtime in
        // LAUNCH_END_UNPROVEN_RUNTIMES that is not loaded refuses (nothing
        // removed); another runtime that is not loaded skips the stop, as before.
        const runtimePlugin = handle.runtimeName
          ? runtimeForHandle(handle, null)
          : (registry.get<Runtime>(
              "runtime",
              project ? (project.runtime ?? config.defaults.runtime) : config.defaults.runtime,
            ) ?? null);
        if (!runtimePlugin && isLaunchEndUnproven(handle.runtimeName)) {
          throw new RuntimeStopUnconfirmedError({
            sessionId,
            handle,
            stop: notLoadedStop(handle),
            kept: "record and worktree kept",
            retry: decidedFrom ? "ao session cleanup" : `ao session kill ${sessionId}`,
          });
        }
        if (runtimePlugin) {
          // Round 5 (1.0.1): the launcher check awaited. What is left is the
          // window between this read and the tmux command (the runtime name
          // is the same for every launch of the ID; no record compare can
          // close it).
          stopWhenReplaced("nothing was destroyed; run the kill again");
          // Same-ID R2a: only a confirmed stop (destroyed or absent) lets the
          // kill remove the worktree and archive the record. Anything else
          // keeps both: the session may still run in them.
          const stopped = await stopRuntime(runtimePlugin, handle);
          if (!isRuntimeStopConfirmed(stopped) && retireToken === undefined) {
            const retry = decidedFrom ? "ao session cleanup" : `ao session kill ${sessionId}`;
            const refusal = new RuntimeStopUnconfirmedError({
              sessionId,
              handle,
              stop: stopped,
              kept: "record and worktree kept",
              retry,
            });
            // Herdr fit-2 F-9 (design r11 5.4.2): the hint of a Herdr kill
            // refusal names the owner's retirement.
            if (
              decidedFrom ||
              stopped.outcome !== "unknown" ||
              !isLaunchEndUnproven(handle.runtimeName)
            ) {
              throw refusal;
            }
            throw new RuntimeStopUnconfirmedError({
              sessionId,
              handle,
              stop: {
                ...stopped,
                next: `${refusal.hint}\nAfter you check and close it, retire the record: ao session kill ${sessionId} --confirm-runtime-closed ${launchIdentityToken(raw)}`,
              },
              kept: "record and worktree kept",
              retry,
            });
          }
          if (!isRuntimeStopConfirmed(stopped)) {
            // F-9 steps 7 and 8: the evidence, then one conditional write of
            // the retire keys on the launch identity. They are not identity
            // keys, so the checks below still compare the launch read here.
            const evidence = await retireEvidence(sessionId, runtimePlugin, handle);
            const retired = updateMetadataIf(sessionsDir, sessionId, launchIdentity(raw), {
              retiredBy: "owner",
              retiredAt: new Date().toISOString(),
              retireEvidence: evidence,
              retiredIdentityToken: retireToken ?? "",
            });
            if (!retired) {
              throw recordChangedError(
                sessionsDir,
                sessionId,
                "it was retired",
                "it was not retired: nothing was written or removed",
              );
            }
          }
        }
      }
    }

    const keptWorktree = "its worktree, agent session and record were kept; run the kill again";
    stopWhenReplaced(keptWorktree);
    const worktree = raw["worktree"];
    if (worktree && shouldDestroyWorkspacePath(project, projectId, worktree)) {
      const workspacePlugin = project
        ? resolvePlugins(project).workspace
        : registry.get<Workspace>("workspace", config.defaults.workspace);
      if (workspacePlugin) {
        // Round 7 (M-2): the plugin's git steps await; it runs this check
        // again directly before each removal step. A replaced record keeps
        // the worktree and ends the kill as the check above does.
        let replaced: Error | undefined;
        try {
          await workspacePlugin.destroy(worktree, () => {
            try {
              stopWhenReplaced(keptWorktree);
              return true;
            } catch (err) {
              replaced = err instanceof Error ? err : new Error(String(err));
              return false;
            }
          });
        } catch {
          // Workspace might already be gone
        }
        if (replaced) throw replaced;
      }
    }

    let didPurgeOpenCodeSession = false;
    if (options?.purgeOpenCode === true && cleanupAgent === "opencode") {
      stopWhenReplaced("its agent session and record were kept; run the kill again");
      // Row 20: `session.interrupt`, then `session.remove`, by the stored ID
      // only (no title discovery). A failure still archives the AO session
      // without `opencodeCleanedAt`, so `ao session cleanup` retries the
      // removal; the operator gets one line that says so (m-5).
      const mappedOpenCodeSessionId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
      const namers = mappedOpenCodeSessionId
        ? openCodeNamers(sessionsDir, mappedOpenCodeSessionId, sessionId)
        : "";
      const holder = mappedOpenCodeSessionId
        ? await findLiveOpenCodeSessionHolder(
            sessionsDir,
            project,
            mappedOpenCodeSessionId,
            sessionId,
          )
        : undefined;

      if (mappedOpenCodeSessionId && holder) {
        // m-4: issue reuse gave this ID to a live session too; an interrupt
        // would stop its running turn. Not marked cleaned, so a later
        // `ao session cleanup` removes it once no live session holds it.
        warnOperator(
          `ao: kept OpenCode session ${mappedOpenCodeSessionId} of ${sessionId}: ${holder}.`,
        );
      } else if (mappedOpenCodeSessionId) {
        // Round 5 (1.0.1): the holder check awaited. Check this record and
        // the other records that name the ID directly before the interrupt
        // and again before the removal (the interrupt awaits).
        const stillUnheld = (): boolean => {
          stopWhenReplaced("its agent session and record were kept; run the kill again");
          if (openCodeNamers(sessionsDir, mappedOpenCodeSessionId, sessionId) === namers) {
            return true;
          }
          warnOperator(
            `ao: kept OpenCode session ${mappedOpenCodeSessionId} of ${sessionId}: another session took the ID during the check; \`ao session cleanup\` removes it once no live session holds it.`,
          );
          return false;
        };
        if (stillUnheld()) {
          await interruptOpenCodeSessionBestEffort(mappedOpenCodeSessionId);
          // Round 6 (M-1): the check runs directly before each removal
          // attempt (the retries wait). A replaced record ends the kill as
          // the first check does, not as a failed removal.
          let replaced: Error | undefined;
          try {
            didPurgeOpenCodeSession = await deleteOpenCodeSession(mappedOpenCodeSessionId, () => {
              try {
                return stillUnheld();
              } catch (err) {
                replaced = err instanceof Error ? err : new Error(String(err));
                return false;
              }
            });
          } catch (err) {
            warnOperator(
              `ao: could not remove OpenCode session ${mappedOpenCodeSessionId} of ${sessionId} (${shortErrorText(err)}); \`ao session cleanup\` retries the removal.`,
            );
          }
          if (replaced) throw replaced;
        }
      }
    }

    // Archive metadata (B-1: only the launch that this kill read; M-2: for
    // cleanup, only while the facts of its decision still hold).
    const archived = deleteMetadata(sessionsDir, sessionId, true, expected);
    if (didPurgeOpenCodeSession) {
      const removedId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
      if (removedId) markArchivedOpenCodeCleanup(sessionsDir, sessionId, removedId);
      await removeLedgerOfRemovedSession(project, sessionsDir, raw["opencodeSessionId"], sessionId);
    }
    // Round 9 (M-1): deleteMetadata answers false also when existsSync cannot
    // check the sessions directory, and readMetadataRaw then answers null; a
    // record that cannot be checked may still be there, so the kill fails.
    let remains: boolean;
    try {
      remains = !archived && readRecordStrict(sessionsDir, sessionId) !== null;
    } catch {
      remains = true;
    }
    if (remains) {
      throw recordChangedError(
        sessionsDir,
        sessionId,
        "it was killed",
        "its record was not archived; run the kill again",
      );
    }
  }

  /**
   * I-5: the OpenCode session is removed, so no send can use its delivery
   * ledger any more. A kill without purge keeps the ledger (a restore keeps
   * the stored session ID). The archive mark clears `opencodeSessionId`, so
   * a removal that fails (m-2) writes the key to the archived record as
   * `opencodeLedgerPending`; the next `ao session cleanup` tries again and
   * clears that key only after the file is gone (`retry`).
   */
  async function removeLedgerOfRemovedSession(
    project: ProjectConfig,
    sessionsDir: string,
    openCodeSessionId: string | undefined,
    aoSessionId: SessionId,
    retry = false,
  ): Promise<void> {
    const key = asValidOpenCodeSessionId(openCodeSessionId);
    if (!key) return;
    const dir = getDeliveryLedgerDir(config.configPath, project.path);
    try {
      // Round 5 (1.0.1): no active record may name the key (a record that
      // names it sends through this ledger). Round 6 (M-2): the removal
      // waits for the ledger lock, so the decisive check runs after the lock
      // is held, directly before the removal; this first one only saves the
      // wait. A kept ledger keeps its key in the archive (the catch below).
      // Round 8 (M-1): a record that cannot be checked or read throws (the
      // catch below keeps the ledger); it is never left out. Round 9 (M-1):
      // also after the listing (readMetadataRaw answers null when existsSync
      // cannot check the path).
      const namerOf = (): string | undefined =>
        listRecordIds(sessionsDir).find(
          (id) =>
            asValidOpenCodeSessionId(readRecordStrict(sessionsDir, id)?.["opencodeSessionId"]) ===
            key,
        );
      const early = namerOf();
      if (early) throw new Error(`session ${early} names OpenCode session ${key}`);
      let late: string | undefined;
      const outcome = await removeDeliveryLedger(dir, key, () => {
        late = namerOf();
        return late === undefined;
      });
      if (outcome === "kept") throw new Error(`session ${late} names OpenCode session ${key}`);
    } catch (err) {
      let kept: boolean;
      try {
        // B-1 (round 4): the ledger removal waits for its lock; a newer
        // archive of the ID can appear meanwhile. Never write over another
        // pending key (that ledger would lose its retry). The key names its
        // own ledger, so it can go into an archive that has none.
        const pending =
          readArchivedMetadataRaw(sessionsDir, aoSessionId)?.["opencodeLedgerPending"] ?? "";
        kept =
          (pending === "" || pending === key) &&
          updateArchivedMetadata(
            sessionsDir,
            aoSessionId,
            { opencodeLedgerPending: key },
            { opencodeLedgerPending: pending },
          );
      } catch {
        kept = false;
      }
      // m-3: without the key, only the sweep can remove the file, and the
      // sweep keeps a ledger that is not valid (fail closed).
      const then = kept
        ? "the next `ao session cleanup` tries again"
        : "it could not be marked for a retry either. A later `ao session cleanup` removes it only when it is a valid ledger whose entries are all older than 10 min; if it is not valid, check that no ao process sends to this session, then remove the file by hand";
      warnOperator(
        `ao: could not remove the delivery ledger ${deliveryLedgerPath(dir, key)} of OpenCode session ${key} of ${aoSessionId} (${shortErrorText(err)}); ${then}.`,
      );
      return;
    }
    if (!retry) return;
    try {
      // B-1 (round 4): only the archive whose pending key is this ledger.
      updateArchivedMetadata(
        sessionsDir,
        aoSessionId,
        { opencodeLedgerPending: "" },
        { opencodeLedgerPending: key },
      );
    } catch (err) {
      warnOperator(
        `ao: removed the delivery ledger ${deliveryLedgerPath(dir, key)} of ${aoSessionId}, but could not clear its key opencodeLedgerPending (${shortErrorText(err)}); the next \`ao session cleanup\` clears it.`,
      );
    }
  }

  /**
   * I-5 (m-2): remove the ledgers of a project that have no live entry and
   * whose lock is free, and old temp files of a failed write. A ledger that
   * stays gets one line; the next `ao session cleanup` tries again.
   */
  async function removeExpiredLedgers(project: ProjectConfig): Promise<void> {
    const sweep = await removeExpiredDeliveryLedgers(
      getDeliveryLedgerDir(config.configPath, project.path),
    );
    for (const failure of sweep.failed) {
      warnOperator(
        `ao: could not remove the expired delivery ledger ${failure.path} (${shortErrorText(failure.error)}); the next \`ao session cleanup\` tries again.`,
      );
    }
  }

  async function cleanup(
    projectId?: string,
    options?: { dryRun?: boolean; purgeOpenCode?: boolean },
  ): Promise<CleanupResult> {
    const result: CleanupResult = { killed: [], skipped: [], errors: [] };
    const sessions = await list(projectId);
    const activeSessionKeys = new Set(
      sessions.map((session) => `${session.projectId}:${session.id}`),
    );

    const killedKeys = new Set<string>();
    const skippedKeys = new Set<string>();

    const toEntryKey = (entryProjectId: string, id: string): string => `${entryProjectId}:${id}`;
    const fromEntryKey = (entryKey: string): { projectId: string; id: string } => {
      const separatorIndex = entryKey.indexOf(":");
      if (separatorIndex === -1) {
        return { projectId: "", id: entryKey };
      }
      return {
        projectId: entryKey.slice(0, separatorIndex),
        id: entryKey.slice(separatorIndex + 1),
      };
    };

    const pushKilled = (entryProjectId: string, id: string): void => {
      const key = toEntryKey(entryProjectId, id);
      skippedKeys.delete(key);
      killedKeys.add(key);
    };

    const pushSkipped = (entryProjectId: string, id: string): void => {
      const key = toEntryKey(entryProjectId, id);
      if (killedKeys.has(key)) return;
      skippedKeys.add(key);
    };

    const shouldPurgeOpenCode = options?.purgeOpenCode !== false;

    for (const session of sessions) {
      try {
        const project = config.projects[session.projectId];
        if (!project) {
          pushSkipped(session.projectId, session.id);
          continue;
        }

        if (isCleanupProtectedSession(project, session.id, session.metadata)) {
          pushSkipped(session.projectId, session.id);
          continue;
        }

        // B-1: a session whose launch is still in progress has no pane yet;
        // that is no reason to kill it or to remove its agent session.
        if ((await liveLaunchOwner(session.metadata)) !== null) {
          pushSkipped(session.projectId, session.id);
          continue;
        }

        const plugins = resolvePlugins(project);
        let shouldKill = false;

        // Check if PR is merged
        if (session.pr && plugins.scm) {
          try {
            const prState = await plugins.scm.getPRState(session.pr);
            if (prState === PR_STATE.MERGED || prState === PR_STATE.CLOSED) {
              shouldKill = true;
            }
          } catch {
            // Can't check PR — skip
          }
        }

        // Check if issue is completed
        if (!shouldKill && session.issueId && plugins.tracker) {
          try {
            const completed = await plugins.tracker.isCompleted(session.issueId, project);
            if (completed) shouldKill = true;
          } catch {
            // Can't check issue — skip
          }
        }

        // Check if runtime is dead. Herdr fit-2 (design r11 4.6): through the
        // handle's runtime; a runtime in the set that is not loaded gets no
        // probe, and this rule kills nothing.
        const deadCheckRuntime = session.runtimeHandle
          ? runtimeForHandle(session.runtimeHandle, plugins.runtime)
          : null;
        if (!shouldKill && session.runtimeHandle && deadCheckRuntime) {
          const handle = session.runtimeHandle;
          try {
            const alive = await deadCheckRuntime.isAlive(handle);
            if (!alive) {
              // Do not archive an OpenCode holder on an uncertain negative and
              // thereby remove it from the archived-purge guard below.
              const agentName = resolveSelectionForSession(
                project,
                session.id,
                session.metadata,
              ).agentName;
              const mappedId = asValidOpenCodeSessionId(session.metadata["opencodeSessionId"]);
              const reason =
                agentName === "opencode" &&
                mappedId &&
                hasOtherOpenCodeRecord(getProjectSessionsDir(project), session.id, mappedId)
                  ? await openCodeHolderReason(project, session.id, session.metadata)
                  : undefined;
              if (reason) warnOperator(`ao: kept ${session.id}: ${reason}.`);
              else shouldKill = true;
            }
          } catch (err) {
            // Review r1 (F-3): a probe that cannot answer keeps the session,
            // as before, and the result now says so, as on the other routes.
            result.errors.push({
              sessionId: session.id,
              error:
                `kept: the runtime check of ${handle.runtimeName} session ${handle.id} could not answer ` +
                `(${shortErrorText(err)}), so nothing shows that the session stopped. ` +
                `Check the session by hand (when no ${handle.runtimeName} server runs, start one so that ` +
                `it can answer), then run \`ao session cleanup\` again.`,
            });
            continue;
          }
        }

        if (shouldKill) {
          if (!options?.dryRun) {
            // B-1 (round 4): the checks awaited; kill only the launch they
            // read. M-2 (round 5): and only while its PR, issue and status
            // are still the ones that the checks used.
            await killRecord(session.id, { purgeOpenCode: shouldPurgeOpenCode }, session.metadata);
          }
          pushKilled(session.projectId, session.id);
        } else {
          pushSkipped(session.projectId, session.id);
        }
      } catch (err) {
        // Same-ID R2a: on every route (runtime, merged PR, closed issue) the
        // kill's own stop decides. An unconfirmed stop keeps the session; it
        // is reported with the outcome and the next action.
        result.errors.push({
          sessionId: session.id,
          error: isRuntimeStopUnconfirmedError(err)
            ? `kept: ${err.message}. ${err.hint}`
            : err instanceof Error
              ? err.message
              : String(err),
        });
      }
    }

    for (const [projectKey, project] of Object.entries(config.projects)) {
      if (projectId && projectKey !== projectId) continue;

      const sessionsDir = getProjectSessionsDir(project);
      for (const archivedId of listArchivedSessionIds(sessionsDir)) {
        if (activeSessionKeys.has(`${projectKey}:${archivedId}`)) continue;

        const archived = readArchivedMetadataRaw(sessionsDir, archivedId);
        if (!archived) continue;

        if (isCleanupProtectedSession(project, archivedId, archived)) {
          pushSkipped(projectKey, archivedId);
          continue;
        }

        const cleanupAgent = resolveSelectionForSession(project, archivedId, archived).agentName;
        const mappedOpenCodeSessionId = asValidOpenCodeSessionId(archived["opencodeSessionId"]);
        if (cleanupAgent === "opencode" && archived["opencodeCleanedAt"]) {
          // m-2: the OpenCode session is removed. A ledger removal that
          // failed after that removal is tried again here, until the file
          // is gone.
          const pendingLedger = archived["opencodeLedgerPending"];
          if (pendingLedger && !options?.dryRun) {
            await removeLedgerOfRemovedSession(
              project,
              sessionsDir,
              pendingLedger,
              archivedId,
              true,
            );
          }
          pushSkipped(projectKey, archivedId);
          continue;
        }
        const namers =
          cleanupAgent === "opencode" && mappedOpenCodeSessionId && shouldPurgeOpenCode
            ? openCodeNamers(sessionsDir, mappedOpenCodeSessionId)
            : "";
        const holder =
          cleanupAgent === "opencode" && mappedOpenCodeSessionId && shouldPurgeOpenCode
            ? await findLiveOpenCodeSessionHolder(
                sessionsDir,
                project,
                mappedOpenCodeSessionId,
                archivedId,
              )
            : undefined;
        if (holder) {
          warnOperator(
            `ao: kept OpenCode session ${mappedOpenCodeSessionId} of ${archivedId}: ${holder}.`,
          );
          // m-4: a live session still runs in this OpenCode session (issue
          // reuse); remove it only once no live session holds it.
          pushSkipped(projectKey, archivedId);
        } else if (cleanupAgent === "opencode" && mappedOpenCodeSessionId && shouldPurgeOpenCode) {
          if (!options?.dryRun) {
            // Round 5 (1.0.1): the holder check awaited, and it skips this
            // ID. Directly before the removal the ID still has no active
            // record (a restore copies the archive back and runs on the same
            // OpenCode session; the active list of this cleanup is older),
            // and the active records that name this OpenCode session are
            // still the ones from before the check. Round 6 (M-1): this
            // check runs directly before each removal attempt.
            // Round 8 (M-1): an active record that cannot be read or
            // checked throws (an error entry below), never "no record".
            const unchanged = (): boolean =>
              readRecordStrict(sessionsDir, archivedId) === null &&
              openCodeNamers(sessionsDir, mappedOpenCodeSessionId) === namers;
            try {
              if (!(await deleteOpenCodeSession(mappedOpenCodeSessionId, unchanged))) {
                warnOperator(
                  `ao: kept OpenCode session ${mappedOpenCodeSessionId} of ${archivedId}: its records changed during the check; the next \`ao session cleanup\` checks again.`,
                );
                pushSkipped(projectKey, archivedId);
                continue;
              }
              markArchivedOpenCodeCleanup(sessionsDir, archivedId, mappedOpenCodeSessionId);
              await removeLedgerOfRemovedSession(
                project,
                sessionsDir,
                mappedOpenCodeSessionId,
                archivedId,
              );
            } catch (err) {
              result.errors.push({
                sessionId: archivedId,
                error: `Failed to delete OpenCode session ${mappedOpenCodeSessionId}: ${err instanceof Error ? err.message : String(err)}`,
              });
              continue;
            }
          }
          pushKilled(projectKey, archivedId);
        } else {
          pushSkipped(projectKey, archivedId);
        }
      }

      if (!options?.dryRun) await removeExpiredLedgers(project);
    }

    const allEntryKeys = [...killedKeys, ...skippedKeys];
    const idCounts = new Map<string, number>();
    for (const entryKey of allEntryKeys) {
      const { id } = fromEntryKey(entryKey);
      idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    }

    const formatEntry = (entryKey: string): string => {
      const { projectId: entryProjectId, id } = fromEntryKey(entryKey);
      return (idCounts.get(id) ?? 0) > 1 ? `${entryProjectId}:${id}` : id;
    };

    result.killed = [...killedKeys].map(formatEntry);
    result.skipped = [...skippedKeys].map(formatEntry);

    return result;
  }

  async function send(sessionId: SessionId, message: string): Promise<void> {
    const result = await deliver(sessionId, message);
    // I-5 (M-5): the message was admitted, so the send succeeds; a lifecycle
    // reaction that records its dispatch records a true delivery. The line
    // tells the operator what the unrecorded admission can still cause.
    if (result.route === "agent" && result.admissionUnrecorded) {
      warnOperator(
        `ao: input ${result.delivery.inputId} was admitted to ${sessionId}, but the delivery ledger could not record it. While this process runs (at most ${DELIVERY_UNRECORDED_HOLD_MS / 60_000} min), a send of the same text gets a new ID; after this process ends, a send of the same text in the 10 min after this one can reuse the ID and admit nothing new.`,
      );
    }
  }

  async function deliver(sessionId: SessionId, message: string): Promise<SessionMessageDelivery> {
    const sendStartedAt = Date.now();
    const { raw, project, projectId } = requireSessionRecord(sessionId);

    const selection = resolveSelectionForSession(project, sessionId, raw);
    const selectedAgent = selection.agentName;
    // I-2: no title discovery before a send (owner Q7). Only the stored ID is
    // used; a session without one sends through the runtime with no API
    // timestamp check.
    const parsedHandle = raw["runtimeHandle"]
      ? safeJsonParse<RuntimeHandle>(raw["runtimeHandle"])
      : null;
    const runtimeName = parsedHandle?.runtimeName ?? project.runtime ?? config.defaults.runtime;
    const agentName = selectedAgent;

    const runtimePlugin = registry.get<Runtime>("runtime", runtimeName);
    if (!runtimePlugin) {
      throw new Error(`No runtime plugin for session ${sessionId}`);
    }

    const agentPlugin = registry.get<Agent>("agent", agentName);
    if (!agentPlugin) {
      throw new Error(`No agent plugin for session ${sessionId}`);
    }

    const captureOutput = async (handle: RuntimeHandle): Promise<string> => {
      try {
        return (await runtimePlugin.getOutput(handle, SEND_CONFIRMATION_OUTPUT_LINES)) ?? "";
      } catch {
        return "";
      }
    };

    const detectActivityFromOutput = (output: string) => {
      if (!output) return null;
      try {
        return agentPlugin.detectActivity(output);
      } catch {
        return null;
      }
    };

    const hasQueuedMessage = (output: string): boolean => {
      return output.includes("Press up to edit queued messages");
    };

    const getOpenCodeSessionUpdatedAt = async (): Promise<number | undefined> => {
      const mappedSessionId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
      if (agentName !== "opencode" || !mappedSessionId) {
        return undefined;
      }

      // Row 10: `session.get` by the stored ID. On 404, timeout or another
      // error, return undefined so the send confirmation falls back to the
      // pane-output checks instead of failing the send.
      try {
        const existing = await getOpenCodeSession(mappedSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS);
        const updated = existing?.time?.updated;
        return typeof updated === "number" && Number.isFinite(updated) ? updated : undefined;
      } catch {
        return undefined;
      }
    };

    const waitForInteractiveReadiness = async (
      session: Session,
      timeoutMs: number,
    ): Promise<void> => {
      const handle = session.runtimeHandle;
      if (!handle) {
        return;
      }

      const deadline = Date.now() + timeoutMs;
      let lastSettledOutput: string | null = null;
      let stablePolls = 0;

      while (true) {
        const [runtimeAlive, processRunning, output, foregroundCommand] = await Promise.all([
          runtimePlugin.isAlive(handle).catch(() => true),
          agentPlugin.isProcessRunning(handle).catch(() => true),
          captureOutput(handle),
          handle.runtimeName === "tmux"
            ? getTmuxForegroundCommand(handle)
            : Promise.resolve(agentPlugin.processName),
        ]);

        const outputReady = output.trim().length > 0;
        // null (tmux could not answer) does not hold the wait; a gone pane does.
        const foregroundReady =
          foregroundCommand === null || foregroundCommand === agentPlugin.processName;
        const settledOutput = outputReady ? output.trimEnd() : null;
        const isStable = settledOutput !== null && settledOutput === lastSettledOutput;

        if (
          runtimeAlive &&
          processRunning &&
          foregroundReady &&
          (hasQueuedMessage(output) || isStable)
        ) {
          stablePolls += 1;
          if (stablePolls >= SEND_BOOTSTRAP_STABLE_POLLS) {
            return;
          }
        } else {
          stablePolls = 0;
        }

        lastSettledOutput = settledOutput;

        if (Date.now() >= deadline) {
          return;
        }

        await sleep(SEND_RESTORE_READY_POLL_MS);
      }
    };

    const waitForRestoredSession = async (restoredSession: Session): Promise<void> => {
      const handle = restoredSession.runtimeHandle;
      if (!handle) {
        return;
      }

      const deadline = Date.now() + SEND_RESTORE_READY_TIMEOUT_MS;
      while (true) {
        const [runtimeAlive, processRunning, output, foregroundCommand] = await Promise.all([
          runtimePlugin.isAlive(handle).catch(() => true),
          agentPlugin.isProcessRunning(handle).catch(() => true),
          captureOutput(handle),
          handle.runtimeName === "tmux"
            ? getTmuxForegroundCommand(handle)
            : Promise.resolve(agentPlugin.processName),
        ]);

        // null (tmux could not answer) does not hold the wait; a gone pane does.
        const foregroundReady =
          foregroundCommand === null || foregroundCommand === agentPlugin.processName;

        if (runtimeAlive && foregroundReady && (processRunning || output.trim().length > 0)) {
          return;
        }

        if (Date.now() >= deadline) {
          return;
        }

        await sleep(SEND_RESTORE_READY_POLL_MS);
      }
    };

    const restoreForDelivery = async (reason: string, session: Session): Promise<Session> => {
      if (NON_RESTORABLE_STATUSES.has(session.status)) {
        throw new Error(`Cannot send to session ${sessionId}: ${reason}`);
      }

      try {
        const restored = await restore(sessionId);
        await waitForRestoredSession(restored);
        return restored;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot send to session ${sessionId}: ${reason} (${detail})`, {
          cause: err,
        });
      }
    };

    const prepareSession = async (forceRestore = false): Promise<Session> => {
      const current = await get(sessionId);
      if (!current) {
        throw new SessionNotFoundError(sessionId);
      }

      const handle =
        current.runtimeHandle ??
        ({
          id: sessionId,
          runtimeName,
          data: {},
        } satisfies RuntimeHandle);
      const normalized = current.runtimeHandle ? current : { ...current, runtimeHandle: handle };

      if (forceRestore || isRestorable(normalized)) {
        return restoreForDelivery(
          forceRestore
            ? "session needed to be restarted before delivery"
            : "session is not running",
          normalized,
        );
      }

      let [runtimeAlive, processRunning] = await Promise.all([
        runtimePlugin.isAlive(handle).catch(() => true),
        agentPlugin.isProcessRunning(handle).catch(() => true),
      ]);

      if (normalized.status === "spawning" && runtimeAlive) {
        await waitForInteractiveReadiness(normalized, SEND_BOOTSTRAP_READY_TIMEOUT_MS);
        [runtimeAlive, processRunning] = await Promise.all([
          runtimePlugin.isAlive(handle).catch(() => true),
          agentPlugin.isProcessRunning(handle).catch(() => true),
        ]);
      }

      if (!runtimeAlive || !processRunning) {
        return restoreForDelivery(
          !runtimeAlive ? "runtime is not alive" : "agent process is not running",
          normalized,
        );
      }

      return normalized;
    };

    const sendWithConfirmation = async (session: Session): Promise<void> => {
      const handle = session.runtimeHandle;
      if (!handle) {
        throw new Error(`Session ${sessionId} has no runtime handle`);
      }

      const baselineOutput = await captureOutput(handle);
      const baselineActivity = detectActivityFromOutput(baselineOutput) ?? session.activity;
      const baselineUpdatedAt = await getOpenCodeSessionUpdatedAt();

      await runtimePlugin.sendMessage(handle, message);

      for (let attempt = 1; attempt <= SEND_CONFIRMATION_ATTEMPTS; attempt++) {
        // Sleep before each check (including the first) so the runtime has time
        // to reflect the message in its output.
        await sleep(SEND_CONFIRMATION_POLL_MS);

        const output = await captureOutput(handle);
        const activity = detectActivityFromOutput(output) ?? session.activity;
        const updatedAt = await getOpenCodeSessionUpdatedAt();
        const delivered =
          (baselineUpdatedAt !== undefined &&
            updatedAt !== undefined &&
            updatedAt > baselineUpdatedAt) ||
          hasQueuedMessage(output) ||
          (output.length > 0 && output !== baselineOutput) ||
          (baselineActivity !== "active" && activity === "active") ||
          (baselineActivity !== "waiting_input" && activity === "waiting_input");

        if (delivered) {
          return;
        }
      }

      // Message was already sent via runtimePlugin.sendMessage above — if we
      // cannot *confirm* delivery (e.g. agent is slow to show output), treat it
      // as a soft success rather than throwing.  Throwing here caused the caller
      // to report failure, which prevented the dispatch-hash from updating and
      // led to duplicate messages on the next poll cycle.
      return;
    };

    // I-5: the agent delivers the message itself (OpenCode: `session.prompt`
    // after its TUI check), so `runtime.sendMessage` and the screen-diff
    // confirmation do not run. Only `AgentNotAttachedError` (nothing was
    // delivered) restores, and only once per send; every other error is
    // final. `restore` replaces the pane only when `isRestorable` is true (a
    // terminal status or an exited agent, never `merged`): a pane under a
    // `working` record that runs another agent process stays, and the send
    // fails with both reasons, but a live pane under a `killed` or `done`
    // record is replaced (inherited behavior, not changed by I-5).
    const deliverMessage = agentPlugin.deliverMessage?.bind(agentPlugin);

    // I-5 (B-1, B-2, B-3, M-2, M-3, M-5): one input ID per logical send.
    // `begin` persists the ID in the delivery ledger of the agent session (a
    // file of its own under a lock that the OS releases, keyed by the agent
    // session, so a record write, a kill, the archive and a restore keep it)
    // before the agent's API call. It gives back the ID of an earlier
    // attempt of the same text that may have been admitted: its admission
    // stayed `unknown`, or the attempt ended (its process ended, or its
    // settle could not write) while no process holds its attempt lock. So a
    // retry by any caller (CLI, lifecycle reaction, review-check) in any
    // process cannot admit the message twice. An attempt in flight holds its
    // attempt lock, so a concurrent send of the same text gets its own ID.
    const ledgerDir = getDeliveryLedgerDir(config.configPath, project.path);
    const textSha256 = messageSha256(message);
    let begun: { key: string; attempt: DeliveryAttempt } | undefined;
    const settleDeliveryAttempt = async (
      outcome: "admitted" | "unknown" | "none",
    ): Promise<boolean> => {
      const current = begun;
      if (!current) return true;
      begun = undefined;
      // Never throws: the outcome of the API call is final at this point.
      // False only when the `admitted` mark or the write of the outcome
      // failed; see `settleDelivery` for what stays.
      return settleDelivery({
        dir: ledgerDir,
        key: current.key,
        attempt: current.attempt,
        outcome,
      });
    };
    const attempt: AgentDeliveryAttempt = {
      async begin(mint: () => string, key: string): Promise<string> {
        try {
          const started = await beginDelivery({ dir: ledgerDir, key, textSha256, mint });
          begun = { key, attempt: started };
          return started.inputId;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Cannot send to session ${sessionId}: the input ID cannot be persisted (${detail}); nothing was sent`,
            { cause: err },
          );
        }
      },
    };

    const deliverThroughAgent = async (
      session: Session,
      hook: (
        session: Session,
        message: string,
        attempt: AgentDeliveryAttempt,
      ) => Promise<AgentMessageDelivery>,
    ): Promise<AgentMessageDelivery> => {
      let notAttached: Error & { reason?: string };
      try {
        return await hook(session, message, attempt);
      } catch (err) {
        const restoredBySend =
          session.restoredAt !== undefined && session.restoredAt.getTime() >= sendStartedAt;
        // A hook throws `AgentNotAttachedError` before `begin` (the OpenCode
        // hook does). After `begin` it is final: the caller keeps the entry
        // `unknown`, and there is no restore and no second `begin`.
        if (
          !isAgentNotAttachedError(err) ||
          begun !== undefined ||
          restoredBySend ||
          NON_RESTORABLE_STATUSES.has(session.status)
        ) {
          throw err;
        }
        notAttached = err;
      }
      let restored: Session;
      try {
        restored = await prepareSession(true);
      } catch (restoreErr) {
        const detail = restoreErr instanceof Error ? restoreErr.message : String(restoreErr);
        throw new AgentNotAttachedError(
          sessionId,
          `${notAttached.reason ?? notAttached.message}; the restore for a second try failed (${detail})`,
          { cause: restoreErr },
        );
      }
      return hook(restored, message, attempt);
    };

    // I-5: a message that the agent can never deliver fails here, before
    // `prepareSession` can restore a dead session for it. The route is
    // chosen from the record; a restore keeps the stored session ID.
    if (
      deliverMessage &&
      agentPlugin.canDeliverMessage?.(metadataToSession(sessionId, raw, projectId)) === true
    ) {
      // I-5 (M-4): the ledger needs a lock that the OS releases; without it
      // (macOS) the agent route refuses before any restore.
      if (!isDeliveryLockSupported()) {
        throw new Error(
          `Cannot send to session ${sessionId}: delivery through the ${selectedAgent} API needs a lock that the OS releases (a Linux abstract Unix socket), and ${process.platform} has none; nothing was sent`,
        );
      }
      agentPlugin.checkMessage?.(message);
    }

    let prepared = await prepareSession();

    if (deliverMessage && agentPlugin.canDeliverMessage?.(prepared) === true) {
      let delivery: AgentMessageDelivery;
      try {
        delivery = await deliverThroughAgent(prepared, deliverMessage);
      } catch (err) {
        // A definite refusal admitted nothing; every other failure after
        // `begin` may have admitted the message, so its ID stays reusable.
        await settleDeliveryAttempt(
          isAgentDeliveryError(err) && err.admission === "none" ? "none" : "unknown",
        );
        throw err;
      }
      const recorded = await settleDeliveryAttempt("admitted");
      return {
        route: "agent",
        delivery,
        ...(recorded ? {} : { admissionUnrecorded: true as const }),
      };
    }

    try {
      await sendWithConfirmation(prepared);
    } catch (err) {
      // Herdr fit-2 F-3: the agent is blocked and waits for input. A restore
      // would not answer it (and refuses for Herdr); the operator answers it in
      // the pane, so the refusal goes to the caller unchanged.
      if (isRuntimeSendRefusedError(err)) throw err;
      const shouldRetryWithRestore =
        prepared.restoredAt === undefined && !NON_RESTORABLE_STATUSES.has(prepared.status);

      if (!shouldRetryWithRestore) {
        if (err instanceof Error) {
          throw err;
        }
        throw new Error(String(err), { cause: err });
      }

      prepared = await prepareSession(true);
      try {
        await sendWithConfirmation(prepared);
      } catch (retryErr) {
        if (retryErr instanceof Error) {
          throw retryErr;
        }
        throw new Error(String(retryErr), { cause: retryErr });
      }
    }
    return { route: "runtime" };
  }

  async function claimPR(
    sessionId: SessionId,
    prRef: string,
    options?: ClaimPROptions,
  ): Promise<ClaimPRResult> {
    const reference = prRef.trim();
    if (!reference) throw new Error("PR reference is required");

    const { raw, sessionsDir, project, projectId } = requireSessionRecord(sessionId);
    if (isOrchestratorSessionRecord(sessionId, raw, project.sessionPrefix)) {
      throw new Error(`Session ${sessionId} is an orchestrator session and cannot claim PRs`);
    }

    const plugins = resolvePlugins(
      project,
      resolveSelectionForSession(project, sessionId, raw).agentName,
    );
    const scm = plugins.scm;
    if (!scm?.resolvePR || !scm.checkoutPR) {
      throw new Error(
        `SCM plugin ${project.scm?.plugin ? `"${project.scm.plugin}" ` : ""}does not support claiming existing PRs`,
      );
    }

    const pr = await scm.resolvePR(reference, project);
    const prState = await scm.getPRState(pr);
    if (prState !== PR_STATE.OPEN) {
      throw new Error(`Cannot claim PR #${pr.number} because it is ${prState}`);
    }

    // B-1 (round 4): the version of each record that the takeover decision reads.
    const conflictingSessions = new Map<SessionId, Record<string, string>>();
    const activeRecords = loadActiveSessionRecords(project).filter(
      (record) => record.sessionName !== sessionId,
    );

    for (const { sessionName, raw: otherRaw } of activeRecords) {
      if (!otherRaw || isOrchestratorSessionRecord(sessionName, otherRaw, project.sessionPrefix))
        continue;

      const samePr = otherRaw["pr"] === pr.url;
      const sameBranch =
        otherRaw["branch"] === pr.branch && (otherRaw["prAutoDetect"] ?? "on") !== "off";

      if (samePr || sameBranch) {
        conflictingSessions.set(sessionName, otherRaw);
      }
    }

    const takenOverFrom = [...conflictingSessions.keys()];

    const workspacePath = raw["worktree"];
    if (!workspacePath) {
      throw new Error(`Session ${sessionId} has no workspace to check out PR #${pr.number}`);
    }

    // m-13: refuse an external PR branch before any git runs.
    assertSafeBranchForSession(sessionId, pr.branch);

    // B-1 (round 4): the version that the claim writes into, read just before
    // the checkout; it must still be the launch that the claim started from.
    const beforeCheckout = readMetadataRaw(sessionsDir, sessionId);
    if (!beforeCheckout || !holdsExpected(beforeCheckout, launchIdentity(raw))) {
      throw recordChangedError(
        sessionsDir,
        sessionId,
        `PR #${pr.number} was resolved`,
        "nothing was checked out or written; check the session and claim again",
      );
    }

    const branchChanged = await scm.checkoutPR(pr, workspacePath);

    // B-1 (round 4): write only into that version: the same generation (any
    // Node writer increments it) and the same launch. A record that a kill
    // archived is not recreated; a new reservation, a newer launch or any
    // other write during the checkout keeps its record, and the claim fails.
    const claimed = updateMetadataIf(
      sessionsDir,
      sessionId,
      { [GENERATION_KEY]: beforeCheckout[GENERATION_KEY], ...launchIdentity(beforeCheckout) },
      { pr: pr.url, status: "pr_open", branch: pr.branch, prAutoDetect: "" },
    );
    if (!claimed) {
      throw recordChangedError(
        sessionsDir,
        sessionId,
        `PR #${pr.number} was claimed`,
        "its record was not written; check the session and claim again",
      );
    }

    for (const [previousSessionId, previousRaw] of conflictingSessions) {
      // Only into the version that the takeover decision read: a record that
      // changed or was archived meanwhile keeps what it holds.
      updateMetadataIf(
        sessionsDir,
        previousSessionId,
        {
          [GENERATION_KEY]: previousRaw[GENERATION_KEY],
          ...launchIdentity(previousRaw),
          pr: previousRaw["pr"],
          status: previousRaw["status"],
        },
        {
          pr: "",
          prAutoDetect: "off",
          ...(PR_TRACKING_STATUSES.has(previousRaw["status"] ?? "") ? { status: "working" } : {}),
        },
      );
    }

    let githubAssigned = false;
    let githubAssignmentError: string | undefined;
    if (options?.assignOnGithub) {
      if (!scm.assignPRToCurrentUser) {
        githubAssignmentError = `SCM plugin "${scm.name}" does not support assigning PRs`;
      } else {
        try {
          await scm.assignPRToCurrentUser(pr);
          githubAssigned = true;
        } catch (err) {
          githubAssignmentError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return {
      sessionId,
      projectId,
      pr,
      branchChanged,
      githubAssigned,
      githubAssignmentError,
      takenOverFrom,
    };
  }

  /** The latest archived record of `sessionId`, in the first project that has one (like `restore`). */
  function findArchivedSessionRecord(sessionId: SessionId): LocatedSession | null {
    for (const [projectId, project] of Object.entries(config.projects)) {
      const sessionsDir = getProjectSessionsDir(project);
      const raw = readArchivedMetadataRaw(sessionsDir, sessionId);
      if (raw) return { raw, sessionsDir, project, projectId };
    }
    return null;
  }

  async function remap(sessionId: SessionId, force = false): Promise<string> {
    // A killed session is archived, and its refused restore tells the
    // operator to run `ao session remap`, so remap also repairs the latest
    // archived record when there is no active one.
    const active = findSessionRecord(sessionId);
    const located = active ?? findArchivedSessionRecord(sessionId);
    if (!located) {
      throw new SessionNotFoundError(sessionId);
    }
    const { raw, sessionsDir, project } = located;
    // B-2: the launcher writes the mapping of its own record.
    await assertNoLiveLauncher(sessionId, raw, "remap");

    const selection = resolveSelectionForSession(project, sessionId, raw);
    const selectedAgent = selection.agentName;
    if (selectedAgent !== "opencode") {
      throw new Error(`Session ${sessionId} is not using the opencode agent`);
    }

    const mapped = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
    if (mapped && !force) return mapped;

    // Row 22: manual repair only. The exact title `AO:<id>` in this session's
    // workspace (B-2: the search spans every project of the service, and two
    // fleets with the same session prefix give the same title). More than one
    // candidate is refused with the list; this never picks one. On timeout
    // the helper throws, so a hanging binary reports as a hang, not as
    // "missing".
    const title = `AO:${sessionId}`;
    const workspacePath = raw["worktree"] || project.path;
    const candidates = await findOpenCodeSessionsByTitle(
      { title, directories: openCodeDirectoriesFor(workspacePath) },
      OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS,
    );
    const [candidate] = candidates;
    if (!candidate) {
      throw new Error(
        `OpenCode session mapping is missing for ${sessionId}: no OpenCode session titled ${title} in ${workspacePath}`,
      );
    }
    if (candidates.length > 1) {
      throw new Error(
        [
          `${candidates.length} OpenCode sessions titled ${title} in ${workspacePath}; refusing to pick one for ${sessionId}:`,
          ...candidates.map((entry) => `  ${describeOpenCodeCandidate(entry)}`),
        ].join("\n"),
      );
    }

    const holder = await findLiveOpenCodeSessionHolder(
      sessionsDir,
      project,
      candidate.id,
      sessionId,
    );
    if (holder) {
      throw new Error(`Cannot remap ${sessionId} to OpenCode session ${candidate.id}: ${holder}.`);
    }

    // B-1 (round 4): the discovery awaited; write only into the launch that
    // remap read, while it still holds the mapping that remap replaces.
    const decided = { ...launchIdentity(raw), opencodeSessionId: raw["opencodeSessionId"] };
    const written = active
      ? updateMetadataIf(sessionsDir, sessionId, decided, { opencodeSessionId: candidate.id }) !==
        null
      : // An archive purged earlier carries `opencodeCleanedAt`, and `cleanup`
        // skips such a record; clear it so the new ID is removed in its turn.
        updateArchivedMetadata(
          sessionsDir,
          sessionId,
          { opencodeSessionId: candidate.id, opencodeCleanedAt: "" },
          decided,
        );
    if (!written) {
      throw active
        ? recordChangedError(
            sessionsDir,
            sessionId,
            "it was remapped",
            "the mapping was not written; run the remap again",
          )
        : new Error(
            `The archived record of ${sessionId} changed while it was remapped (a restore or a newer archive of the ID); the mapping was not written; run the remap again`,
          );
    }
    return candidate.id;
  }

  async function restore(sessionId: SessionId): Promise<Session> {
    // 1. Find session metadata across all projects (active first, then archive)
    let raw: Record<string, string> | null = null;
    let sessionsDir: string | null = null;
    let project: ProjectConfig | undefined;
    let projectId: string | undefined;
    let fromArchive = false;

    const activeRecord = findSessionRecord(sessionId);
    if (activeRecord) {
      raw = activeRecord.raw;
      sessionsDir = activeRecord.sessionsDir;
      project = activeRecord.project;
      projectId = activeRecord.projectId;
    }

    // Fall back to archived metadata (killed/cleaned sessions)
    if (!raw) {
      for (const [key, proj] of Object.entries(config.projects)) {
        const dir = getProjectSessionsDir(proj);
        const archived = readArchivedMetadataRaw(dir, sessionId);
        if (archived) {
          raw = archived;
          sessionsDir = dir;
          project = proj;
          projectId = key;
          fromArchive = true;
          break;
        }
      }
    }

    if (!raw || !sessionsDir || !project || !projectId) {
      throw new SessionNotFoundError(sessionId);
    }
    // B-2: a launch in progress has no pane yet, so it looks dead and
    // restorable; a restore would start a second pane for it.
    await assertNoLiveLauncher(sessionId, raw, "restore");

    const selection = resolveSelectionForSession(project, sessionId, raw);

    // 2. Reconstruct Session from metadata and enrich with live runtime state.
    //    metadataToSession sets activity: null, so without enrichment a crashed
    //    session (status "working", agent exited) would not be detected as terminal
    //    and isRestorable would reject it.
    const session = metadataToSession(sessionId, raw, projectId);
    const plugins = resolvePlugins(project, selection.agentName);
    await enrichSessionWithRuntimeState(session, plugins, true);

    // 3. Validate restorability
    if (!isRestorable(session)) {
      if (NON_RESTORABLE_STATUSES.has(session.status)) {
        throw new SessionNotRestorableError(sessionId, `status is "${session.status}"`);
      }
      throw new SessionNotRestorableError(sessionId, "session is not in a terminal state");
    }

    // 4. Validate required plugins (plugins already resolved above for enrichment)
    if (!plugins.runtime) {
      throw new Error(`Runtime plugin '${project.runtime ?? config.defaults.runtime}' not found`);
    }
    if (!plugins.agent) {
      throw new Error(`Agent plugin '${selection.agentName}' not found`);
    }

    // 5. Get launch command — try restore command first, fall back to fresh launch.
    //    This runs before any change: before the archive is copied back, the
    //    workspace is recreated or the old runtime is destroyed. An agent can
    //    refuse the restore, and a refusal must change nothing and leave the
    //    surviving pane and its scrollback in place. The OpenCode plugin
    //    refuses here (I-2 A4, M-1, m-1): its version gate runs first, so a
    //    refused binary names the version problem even when no OpenCode
    //    session ID is stored; then a missing stored ID and a stored session
    //    that is gone (404) each raise `SessionNotRestorableError`.
    const workspacePath = raw["worktree"] || project.path;
    let launchCommand: string;
    const agentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(selection.role === "orchestrator" ? { permissions: "permissionless" as const } : {}),
          ...(session.metadata?.opencodeSessionId
            ? { opencodeSessionId: session.metadata.opencodeSessionId }
            : {}),
        },
      },
      issueId: session.issueId ?? undefined,
      permissions: selection.role === "orchestrator" ? "permissionless" : selection.permissions,
      model: selection.model,
      subagent: selection.subagent,
    };

    if (plugins.agent.getRestoreCommand) {
      // N-2: pass the same agentConfig the spawn used (role-merged, with the
      // orchestrator permissionless override). Plugins read model and
      // permissions from project.agentConfig, so a restore can neither gain
      // permissions nor lose the spawn model. The third argument stays for
      // backward compatibility with two-argument implementers.
      const restoreProject = {
        ...project,
        agentConfig: agentLaunchConfig.projectConfig.agentConfig,
      };
      const restoreCmd = await plugins.agent.getRestoreCommand(
        session,
        restoreProject,
        selection.model,
      );
      launchCommand = restoreCmd ?? plugins.agent.getLaunchCommand(agentLaunchConfig);
    } else {
      launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
    }

    const environment = plugins.agent.getEnvironment(agentLaunchConfig);

    // Herdr fit-2 (design r11 5.2.4): a create runtime in
    // LAUNCH_END_UNPROVEN_RUNTIMES takes a launch claim (in the transition
    // write 7a), and its handle writes follow the publication rule.
    const unproven = isLaunchEndUnproven(plugins.runtime.name);
    const ownClaim = unproven ? await readLaunchClaim() : null;

    // 6. Check the workspace. Review r1 (M-1): only checks here, no change.
    //    A refused restore changes nothing: the missing workspace is
    //    recreated in step 8, after the old runtime stop is confirmed.
    const workspaceExists = plugins.workspace?.exists
      ? await plugins.workspace.exists(workspacePath)
      : existsSync(workspacePath);
    let branchToRestore: string | null = null;
    if (!workspaceExists) {
      // Try to restore workspace if plugin supports it
      if (!plugins.workspace?.restore) {
        throw new WorkspaceMissingError(workspacePath, "workspace plugin does not support restore");
      }
      if (!session.branch) {
        throw new WorkspaceMissingError(workspacePath, "branch metadata is missing");
      }
      // m-13: refuse a stored branch before any git runs. This covers the
      // archive restore (fromArchive copies the same stored branch back) and
      // the restore-before-send path (restoreForDelivery calls restore()).
      assertSafeBranchForSession(sessionId, session.branch);
      branchToRestore = session.branch;
    }

    // B-1 (round 4): the version that this restore owns. Every later write
    // compares its launch identity: an archive, a new reservation, or another
    // restore or launch of the ID stops the restore, and nothing is written.
    let owned: Record<string, string> = raw;
    const stillOwned = (): boolean => {
      const current = readMetadataRaw(sessionsDir, sessionId);
      return !!current && holdsExpected(current, launchIdentity(owned));
    };
    // 7a. Herdr fit-2 (design r11 5.2.4): `transition` keeps what the
    //     write-back puts back.
    let transition:
      | {
          before: { runtimeHandle: string; restoredAt: string };
          publishedClaim: Readonly<Record<string, string>>;
        }
      | undefined;

    /**
     * 6b. From an archive: the copy-back. Herdr fit-2 (design r11 5.2.4): for
     * an orchestrator record under A, directly after the subject check.
     */
    const copyBackArchive = (checkSubject?: () => void): void => {
      if (!fromArchive) return;
      // Keep the stored spawn identity when copying the archive back. The
      // copy-back is a reservation: it never writes over an active record
      // (another restore or a new reservation), and only while the latest
      // archive is still the one that this restore read. While it exists, no
      // other reservation of the ID can be made (a spawn, or the copy-back of
      // a restore that read the archive before it). It is not an operation
      // lock (review r2, F-4): an operation that reads it as an active record
      // (another restore, an orchestrator start, a PR claim, a kill, a
      // lifecycle write) can still act on it during the stop in step 7. One
      // operation per ID is same-ID R3.
      const copyBack: Record<string, string | undefined> = {
        worktree: raw["worktree"] ?? "",
        branch: raw["branch"] ?? "",
        status: raw["status"] ?? "killed",
        role: raw["role"],
        tmuxName: raw["tmuxName"],
        issue: raw["issue"],
        pr: raw["pr"],
        prAutoDetect:
          raw["prAutoDetect"] === "off" ? "off" : raw["prAutoDetect"] === "on" ? "on" : undefined,
        summary: raw["summary"],
        project: raw["project"],
        agent: raw["agent"],
        model: raw["model"],
        permissions: raw["permissions"],
        createdAt: raw["createdAt"],
        runtimeHandle: raw["runtimeHandle"],
        opencodeSessionId: raw["opencodeSessionId"],
        pinnedSummary: raw["pinnedSummary"],
      };
      checkSubject?.();
      const reserved = reserveSessionRecord(
        sessionsDir,
        sessionId,
        Object.fromEntries(
          Object.entries(copyBack).filter((entry): entry is [string, string] => !!entry[1]),
        ),
        launchIdentity(raw),
      );
      if (!reserved) {
        throw new Error(
          `Session ${sessionId} changed while it was restored (another restore or a new reservation of the ID, or a newer archive); nothing was changed`,
        );
      }
      owned = reserved;
    };

    /**
     * Steps 7 and 7a. Herdr fit-2 (design r11 5.2.4): for an orchestrator
     * record of a create runtime in the set, under A (`underA`): the stop has
     * the core bound, and the subject check comes directly before the
     * transition write.
     */
    const stopAndTransition = async (underA?: { checkSubject: () => void }): Promise<void> => {
      // B-1 (round 4): the checks above awaited. Stop before the old runtime
      // is stopped when another process changed the launch meanwhile (the
      // runtime name is the same for every launch of the ID).
      if (!stillOwned()) {
        throw recordChangedError(
          sessionsDir,
          sessionId,
          "it was restored",
          "no runtime was destroyed or created",
        );
      }

      // 7. Stop the old runtime if still alive (e.g. tmux session survives agent
      // crash). Same-ID R2a (N-2): only a confirmed stop (destroyed or absent)
      // lets the restore go on. Review r1 (M-1): the stop runs before the
      // workspace is recreated, and a refusal removes the archive copy-back of
      // this restore again while it still holds the values that
      // releaseCopyBack compares (review r2 and r3, M-1), so a refused restore
      // with no other operation on the ID leaves the record, the archive and
      // the workspace as they were. A copy-back where one of those values
      // changed during the stop, or that another operation replaced, stays,
      // and the refusal says so.
      //    Herdr fit-2 (design r11 4.6, 5.2.4): the stop goes through the
      //    handle's runtime; one in LAUNCH_END_UNPROVEN_RUNTIMES that is not
      //    loaded is unknown. A runtimeHandle text that gives no handle but
      //    names herdr (or a project whose runtime is in the set) refuses like
      //    an unconfirmed stop: a skipped stop would let a second launch start
      //    next to a launch that no handle names.
      const refuseStep7 = (handle: RuntimeHandle, stopped: UnconfirmedRuntimeStop): never => {
        throw new RuntimeStopUnconfirmedError({
          sessionId,
          handle,
          stop: stopped,
          kept: fromArchive
            ? releaseCopyBack(sessionsDir, sessionId, owned)
            : "nothing was restored: this restore did not change the record or the workspace, and no new runtime was created",
          retry: `ao session restore ${sessionId}`,
        });
      };
      if (session.runtimeHandle) {
        const handleRuntime = runtimeForHandle(session.runtimeHandle, plugins.runtime);
        const stopped = !handleRuntime
          ? notLoadedStop(session.runtimeHandle)
          : underA
            ? await stopWithinBound(handleRuntime, session.runtimeHandle)
            : await stopRuntime(handleRuntime, session.runtimeHandle);
        if (!isRuntimeStopConfirmed(stopped)) refuseStep7(session.runtimeHandle, stopped);
      } else if (raw["runtimeHandle"] && isUnprovenLaunchRecord(raw, plugins.runtime?.name)) {
        const text = raw["runtimeHandle"];
        refuseStep7(
          { id: "", runtimeName: HERDR_RUNTIME_NAME, data: {} },
          {
            outcome: "unknown",
            detail: `the runtime handle of ${sessionId} cannot be read (${text.slice(0, 80)}); retire it by hand`,
          },
        );
      }

      // 7a. Herdr fit-2 (design r11 5.2.4): the transition write. Before any
      //     runtime of this restore exists, the record gets the pending handle
      //     P, a new launch time and this process's claim, compared by the
      //     launch identity and the claim values as read.
      if (unproven && plugins.runtime) {
        const readClaim = {
          [LAUNCH_PID_KEY]: owned[LAUNCH_PID_KEY] ?? "",
          [LAUNCH_PID_START_KEY]: owned[LAUNCH_PID_START_KEY] ?? "",
        };
        underA?.checkSubject();
        const transitioned = updateMetadataIf(
          sessionsDir,
          sessionId,
          { ...launchIdentity(owned), ...readClaim },
          {
            runtimeHandle: JSON.stringify(pendingHandle(plugins.runtime.name)),
            restoredAt: new Date().toISOString(),
            ...(ownClaim ?? {}),
          },
        );
        if (!transitioned) {
          throw recordChangedError(
            sessionsDir,
            sessionId,
            "it was restored",
            "its old runtime was stopped; no runtime was created",
          );
        }
        transition = {
          before: {
            runtimeHandle: owned["runtimeHandle"] ?? "",
            restoredAt: owned["restoredAt"] ?? "",
          },
          publishedClaim: ownClaim ?? readClaim,
        };
        owned = transitioned;
        if (underA) await admission.stage("transition-written", 0);
      }
    };

    // 6a. Herdr fit-2 F-7 (design r11 5.2.4, 5.3.2): the restore of an
    //     orchestrator record is an admission in restore mode: the subject,
    //     then A; G without this ID, and any record that it selects blocks
    //     (no probe). Under A: the copy-back and, for a create runtime in the
    //     set, the old runtime's stop and the transition write; then A is
    //     released (7b), and P and the claim carry the protection. For a
    //     create runtime outside the set A covers 6a and 6b only. A worker
    //     restore takes no A (L-3).
    if (isOrchestratorSessionRecord(sessionId, raw, project.sessionPrefix)) {
      await runAdmission<undefined>({
        mode: "restore",
        projectId,
        project,
        sessionsDir,
        createInSet: unproven,
        excludeId: sessionId,
        decide: async ({ judged, checkSubject }) => {
          if (judged.length > 0) return { kind: "blocked", blocking: judged };
          copyBackArchive(checkSubject);
          if (unproven) await stopAndTransition({ checkSubject });
          return { kind: "done", value: undefined };
        },
      });
      if (!unproven) await stopAndTransition();
    } else {
      copyBackArchive();
      await stopAndTransition();
    }
    /**
     * Herdr fit-2 (design r11 5.2.4): undo the transition write after a
     * failure that left nothing in the runtime (step 8, a plain create
     * error). It compares the exact claim state that 7a published and
     * clears claim keys only when this restore took its own claim.
     */
    const writeBackTransition = (): void => {
      if (!transition) return;
      let failure = "";
      try {
        const written = updateMetadataIf(
          sessionsDir,
          sessionId,
          { ...launchIdentity(owned), ...transition.publishedClaim },
          {
            runtimeHandle: transition.before.runtimeHandle,
            restoredAt: transition.before.restoredAt,
            ...(ownClaim ? CLEARED_LAUNCH_CLAIM : {}),
          },
        );
        if (written) return;
      } catch (err) {
        failure = ` (${shortErrorText(err)})`;
      }
      warnOperator(
        `ao: AO could not write back the record of ${sessionId}${failure}; it may keep the pending handle of this restore${ownClaim ? " and this process's launch claim" : ""}; check runtimeHandle, restoredAt, launchPid and launchPidStart, then retire it with F-9. ${retireLine(sessionId, launchIdentityToken(owned))}`,
      );
    };
    /** The worktree and agent session of this restore, for the unwritable warning. */
    const restoreResources = () => ({
      worktree: workspacePath,
      agentSession: session.metadata?.opencodeSessionId ?? "none recorded",
    });
    /**
     * Herdr fit-2 (design r11 5.2.4 step 9): a partial create. Its handle and
     * the cause go into the own record by the publication rule; then the
     * claim is settled on the new identity. The runtime, the workspace and
     * the agent session stay.
     */
    const keepPartialRestore = (err: RuntimeCreatePartialError): void => {
      const published = publishOwnLaunch(sessionsDir, sessionId, owned, {
        status: "spawning",
        runtimeHandle: JSON.stringify(err.handle),
        launchFailed: err.message.replace(/\s+/g, " ").trim().slice(0, 600),
      });
      if (published.outcome === "written") {
        owned = published.record;
        try {
          settleOwnClaim(sessionsDir, sessionId, launchIdentity(owned), ownClaim);
        } catch (settleErr) {
          if (ownClaim) warnOperator(claimMayRemainWarning(sessionId, ownClaim, settleErr));
        }
      } else if (published.outcome === "not-own") {
        const socket = err.handle.data?.["herdrSocket"];
        err.message = `${err.message} The record of ${sessionId} changed during the restore: its runtime ${err.handle.id || "(no pane)"} at ${typeof socket === "string" ? socket : "an unknown socket"} was kept; check it by hand.`;
      } else {
        keepUnwritableLaunch({
          sessionsDir,
          sessionId,
          error: published.error,
          handle: err.handle,
          before: published.before,
          after: published.after,
          ownClaim,
          ...restoreResources(),
        });
      }
    };

    // 8. Recreate a missing workspace, now that the old runtime is stopped.
    if (branchToRestore !== null && plugins.workspace?.restore) {
      try {
        const wsInfo = await plugins.workspace.restore(
          {
            projectId,
            project,
            sessionId,
            branch: branchToRestore,
          },
          workspacePath,
        );

        // Run post-create hooks on restored workspace
        if (plugins.workspace.postCreate) {
          await plugins.workspace.postCreate(wsInfo, project);
        }
      } catch (err) {
        writeBackTransition();
        throw new WorkspaceMissingError(
          workspacePath,
          `restore failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // B-1 (round 4): the workspace step awaited. Stop before a runtime is
      // created when another process changed the launch meanwhile.
      if (!stillOwned()) {
        throw recordChangedError(
          sessionsDir,
          sessionId,
          "it was restored",
          "its old runtime was stopped, and no new runtime was created",
        );
      }
    }

    // 9. Create runtime (reuse tmuxName from metadata)
    const tmuxName = raw["tmuxName"];
    let handle: RuntimeHandle;
    try {
      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId,
        workspacePath,
        launchCommand,
        environment: {
          ...environment,
          AO_SESSION: sessionId,
          AO_DATA_DIR: sessionsDir,
          AO_SESSION_NAME: sessionId,
          ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
          AO_CALLER_TYPE: "agent",
          ...(projectId && { AO_PROJECT_ID: projectId }),
          AO_CONFIG_PATH: config.configPath,
          AO_STATE_ROOT: getStateRoot(),
        },
      });
    } catch (err) {
      if (!unproven) throw err;
      if (!isRuntimeCreatePartialError(err)) {
        // Herdr fit-2: a plain error left nothing in the runtime.
        writeBackTransition();
        throw err;
      }
      keepPartialRestore(err);
      throw err;
    }

    // 10. Update metadata — merge updates, preserving existing fields. B-1
    // (round 4): only into the version that this restore owns. When it was
    // archived, or another reservation, restore or launch replaced it, the
    // restore throws. Round 5 (B-1): the new runtime is stopped only when the
    // record read directly before the destroy shows that no record owns it
    // (recordMayOwnRuntime). Another launch of the ID can stop this runtime
    // and create its own under the same name before this write, so "created
    // a moment ago" is no proof; a runtime that stays is named in the error.
    const now = new Date().toISOString();
    const restoredUpdates = {
      status: "spawning",
      runtimeHandle: JSON.stringify(handle),
      restoredAt: now,
      [RESERVATION_KEY]: "",
    };
    // Herdr fit-2 (design r11 5.2.4 step 10): for a runtime in the set the
    // write is a publication; only its strict read proves "not own".
    let restoredRecord: Record<string, string> | null;
    if (unproven) {
      const published = publishOwnLaunch(sessionsDir, sessionId, owned, restoredUpdates);
      if (published.outcome === "unwritable") {
        keepUnwritableLaunch({
          sessionsDir,
          sessionId,
          error: published.error,
          handle,
          before: published.before,
          after: published.after,
          ownClaim,
          ...restoreResources(),
        });
        const text = (key: string): string => {
          const value = handle.data?.[key];
          return typeof value === "string" && value ? value : "unknown";
        };
        throw new Error(
          `the restore of ${sessionId} created herdr pane ${handle.id} (workspace ${text("workspaceId")}, socket ${text("herdrSocket")}); AO could not confirm that its record holds it: ${shortErrorText(published.error)}`,
          { cause: published.error },
        );
      }
      restoredRecord = published.outcome === "written" ? published.record : null;
    } else {
      restoredRecord = updateMetadataIf(
        sessionsDir,
        sessionId,
        launchIdentity(owned),
        restoredUpdates,
      );
    }
    if (!restoredRecord) {
      let mayOwn: boolean;
      try {
        mayOwn = recordMayOwnRuntime(readRecordStrict(sessionsDir, sessionId), handle);
      } catch {
        // Round 8 (M-1): a record that cannot be read may own the runtime too.
        mayOwn = true;
      }
      if (mayOwn) {
        throw recordChangedError(
          sessionsDir,
          sessionId,
          "it was restored",
          `its record was not written, and its runtime ${handle.runtimeName ?? "?"} ${handle.id} was kept because the record now there may own that runtime name; stop it by hand if no session uses it`,
        );
      }
      // Same-ID R2a: the error says whether the stop of the new runtime was
      // confirmed; an unconfirmed one names the runtime to stop by hand.
      const stopped = await stopRuntime(plugins.runtime, handle);
      throw recordChangedError(
        sessionsDir,
        sessionId,
        "it was restored",
        isRuntimeStopConfirmed(stopped)
          ? "its new runtime was stopped and its record was not written"
          : `its record was not written, and the stop of its new runtime ${handle.runtimeName ?? "?"} ${handle.id} was not confirmed (${stopped.outcome}: ${stopped.detail}); stop it by hand if no session uses it`,
      );
    }
    owned = restoredRecord;

    // 11. Run postLaunchSetup (non-fatal)
    const restoredSession: Session = {
      ...session,
      status: "spawning",
      activity: "active",
      workspacePath,
      runtimeHandle: handle,
      restoredAt: new Date(now),
    };

    if (plugins.agent.postLaunchSetup) {
      try {
        const metadataBeforePostLaunch = { ...(restoredSession.metadata ?? {}) };
        await plugins.agent.postLaunchSetup(restoredSession);

        const metadataAfterPostLaunch = restoredSession.metadata ?? {};
        const metadataUpdates = Object.fromEntries(
          Object.entries(metadataAfterPostLaunch).filter(
            ([key, value]) => metadataBeforePostLaunch[key] !== value,
          ),
        );

        if (Object.keys(metadataUpdates).length > 0) {
          // B-1 (round 4): only while the record is still this restore's launch.
          updateMetadataIf(sessionsDir, sessionId, launchIdentity(owned), metadataUpdates);
        }
      } catch {
        // Non-fatal — session is already running
      }
    }

    // 12. Herdr fit-2 (design r11 4.5): only this restore's own claim goes,
    //     compared by the identity that step 10 wrote or adopted.
    if (ownClaim) {
      try {
        settleOwnClaim(sessionsDir, sessionId, launchIdentity(owned), ownClaim);
      } catch (err) {
        warnOperator(claimMayRemainWarning(sessionId, ownClaim, err));
      }
    }

    return restoredSession;
  }

  /**
   * Session relaunch (2026-10-22): start the agent of a session again in its
   * existing tmux pane, after its agent process ended (for example after
   * `/exit`), with the launch command that AO builds now, as `restore`
   * builds it. See `docs/DEVELOPMENT.md`, "Session relaunch (2026-10-22)".
   *
   * Every check runs before the first change, and a refusal throws
   * `SessionRelaunchRefusedError` and changes nothing. Then one
   * compare-and-set under the record lock takes the launch claim (the launch
   * keys of this `ao` process, as a spawn holds them), starts the launch
   * grace (`restoredAt`, as a restore) and stores the token and the pane of
   * this launch. While the claim lives, a `restore`, `kill`, `remap`,
   * orchestrator start or relaunch that starts later refuses
   * (`assertNoLiveLauncher`); a restore or kill that started before the
   * claim is not excluded (review r1 M-6, see the docs). From another shell,
   * the runtime types the launch line into the pane's shell (`runInPane`, by
   * the pane's ID); from the session's own pane, the caller runs it as its
   * own child (`runInCallerTerminal`), and the script `exec`s the agent.
   * Then the relaunch waits, bounded by one deadline for every awaited call
   * (review r1 M-7), for the agent process. The end state: the claim always
   * goes (later tries while this process lives, review r1 M-3). Agent seen
   * running: a recoverable `killed` status becomes `working`. Agent absent
   * (a definite "not running", a failed start, or the caller's child ended):
   * `restoredAt` and the launch token go back to their values before the
   * relaunch. Unknown (no definite answer in time, the agent may run): the
   * new `restoredAt` and token stay. The status is never set to `spawning`.
   */
  async function relaunch(
    sessionId: SessionId,
    options: SessionRelaunchOptions = {},
  ): Promise<SessionRelaunchResult> {
    const refuse = (reason: string, next: string): never => {
      throw new SessionRelaunchRefusedError(sessionId, reason, next);
    };
    const restoreNext = `restore it with \`ao session restore ${sessionId}\` (that replaces its tmux session)`;

    // 1. The active record. A killed and archived session is restored, not relaunched.
    const located = findSessionRecord(sessionId);
    if (!located) {
      return findArchivedSessionRecord(sessionId)
        ? refuse("it has no active record (it was killed and archived)", restoreNext)
        : refuse("no session has this ID", "check the ID with `ao session ls`");
    }
    const { raw, sessionsDir, project, projectId } = located;

    // 2. Another launch of the ID: live launch keys (a relaunch, an OpenCode
    //    spawn or start), a reservation (a spawn, start or archive restore
    //    before its runtime exists), or a launch younger than the launch
    //    grace (a Claude Code spawn or start writes no launch keys, and its
    //    agent can still be starting).
    const launcher = await liveLaunchOwner(raw);
    if (launcher !== null) {
      refuse(
        `ao process ${launcher} is still launching it`,
        `wait until that launch ends (or stop ao process ${launcher}), then try again`,
      );
    }
    if (raw[RESERVATION_KEY]) {
      refuse(
        "its record is the reservation of a launch in progress (a spawn, an orchestrator start or a restore)",
        "wait until that launch ends, then try again",
      );
    }
    const launchedAt = lastLaunchOf(raw);
    const sinceLaunch = Date.now() - launchedAt;
    if (Number.isFinite(launchedAt) && sinceLaunch >= 0 && sinceLaunch < LAUNCH_GRACE_MS) {
      refuse(
        `its last launch was ${Math.floor(sinceLaunch / 1000)} s ago, and that launch can still be starting its agent`,
        `wait ${Math.ceil((LAUNCH_GRACE_MS - sinceLaunch) / 1000)} s, then try again`,
      );
    }

    // 3. The status.
    if (!isRelaunchableStatus(raw)) {
      const reason = raw["killedReason"];
      refuse(
        `its status is "${raw["status"] ?? "unknown"}"${reason ? ` (${reason})` : ""}`,
        "a session in this state is not relaunched; spawn a new session for new work",
      );
    }

    // 4. The runtime pane of the record (C-04: the handle's runtime, never the config's).
    const session = metadataToSession(sessionId, raw, projectId);
    const handle = session.runtimeHandle;
    if (!handle) return refuse("its record names no runtime pane", restoreNext);
    if (handle.runtimeName === HERDR_RUNTIME_NAME) {
      refuse(
        "it runs in a Herdr pane, and a Herdr relaunch waits for the Herdr live check",
        "restart its agent by hand in its Herdr pane",
      );
    }
    if (handle.runtimeName !== "tmux") {
      refuse(
        `its runtime is "${handle.runtimeName}", and only a tmux pane can be relaunched`,
        restoreNext,
      );
    }
    const runtime = registry.get<Runtime>("runtime", handle.runtimeName);
    const listPanes = runtime?.listPanes?.bind(runtime);
    const runInPane = runtime?.runInPane?.bind(runtime);
    if (!runtime || !listPanes || !runInPane) {
      return refuse(
        `runtime plugin "${handle.runtimeName}" cannot run a command in an existing pane`,
        "update the runtime plugin",
      );
    }

    // 5. The agent of the record (C-04).
    const selection = resolveSelectionForSession(project, sessionId, raw);
    const agent = registry.get<Agent>("agent", selection.agentName);
    if (!agent) {
      return refuse(`agent plugin "${selection.agentName}" is not available`, "install it");
    }
    if (agent.prepareAgentSession) {
      refuse(
        `agent ${agent.name} prepares its own session before its pane starts, and a relaunch does not do that`,
        restoreNext,
      );
    }

    // 6. Liveness: the tmux session exists, the agent process does not run
    //    (in the pane that the record binds, which `handle` names, else in
    //    the session's current window; review r2 M-1), and the pane of the
    //    agent is known (the bound pane, which must still exist, else the
    //    only pane of the session; review r1 M-1, r2 M-4). From another
    //    shell, that pane's own shell must wait for input.
    const probe = async (what: string, check: () => Promise<unknown>): Promise<boolean> => {
      try {
        return await booleanAnswerWithin(what, check);
      } catch (err) {
        return refuse(
          `${what} could not tell (${shortErrorText(err)})`,
          "check the tmux server and `ps`, then try again",
        );
      }
    };
    if (!(await probe("the tmux liveness check", () => runtime.isAlive(handle)))) {
      refuse(`its tmux session ${handle.id} does not exist`, restoreNext);
    }
    if (await probe("the agent process check", () => agent.isProcessRunning(handle))) {
      refuse(
        `its agent process (${agent.processName}) still runs`,
        "end the agent first (Claude Code: /exit), then try again",
      );
    }
    let panes: RuntimePaneState[] | null = null;
    try {
      panes = await answerWithin("the pane check", () => listPanes(handle));
    } catch (err) {
      refuse(
        `the pane check could not tell (${shortErrorText(err)})`,
        "check the tmux server, then try again",
      );
    }
    if (!panes) return refuse(`its tmux session ${handle.id} does not exist`, restoreNext);
    const binding = lastLaunchBinding(raw);
    // The pane that the last launch bound is the agent's pane. The one-pane
    // rule is only for a record that binds none: a bound pane that is gone
    // is not replaced by another pane of the session (review r2 M-4).
    if (binding?.pane && !panes.some((p) => p.paneId === binding.pane)) {
      refuse(
        `the pane ${binding.pane} of its last launch no longer exists in tmux session ${handle.id}`,
        `start its agent by hand in a pane of the session, or ${restoreNext}`,
      );
    }
    const pane = binding?.pane
      ? panes.find((p) => p.paneId === binding.pane)
      : panes.length === 1
        ? panes[0]
        : undefined;
    if (!pane) {
      return refuse(
        `its tmux session ${handle.id} has ${panes.length} panes, and its record does not name the pane of its agent`,
        `close the other windows and panes of tmux session ${handle.id} (keep the agent's pane), then try again`,
      );
    }
    // Every check of the agent after the start reads this pane (review r2 M-1).
    const agentHandle = withAgentPane(handle, pane.paneId);
    const runInCallerTerminal = options.runInCallerTerminal;
    const inOwnPane = !!options.callerTty && options.callerTty === pane.tty;
    if (inOwnPane && !runInCallerTerminal) {
      refuse(
        "this command runs in the session's own pane, and this caller cannot start the agent here",
        "run the relaunch from another shell",
      );
    }
    // Review r2: in the own pane the agent gets the terminal of `ao`, which
    // only a foreground job owns.
    if (inOwnPane && options.callerForeground === false) {
      refuse(
        "this ao process runs in the background of the session's own pane, so its agent would not own the terminal",
        "run `ao session relaunch` in the foreground of the pane (without &), or from another shell",
      );
    }
    if (inOwnPane && options.callerForeground === null) {
      refuse(
        "AO cannot tell whether this ao process is the foreground job of the session's own pane (no /proc)",
        "run the relaunch from another shell",
      );
    }
    if (!inOwnPane) {
      if (!RELAUNCH_SHELLS.has(pane.foregroundCommand) || pane.shellIdle === false) {
        refuse(
          `its pane ${pane.paneId} runs ${pane.foregroundCommand}, not a shell that waits for input`,
          "end that program in the pane, or run the relaunch in the pane itself, then try again",
        );
      }
      if (pane.shellIdle !== true) {
        refuse(
          `the runtime cannot tell whether the shell of its pane ${pane.paneId} waits for input`,
          "start the agent by hand in its pane",
        );
      }
    }

    // 7. The conversation to continue: only the one that the agent of the
    //    last launch recorded, by that launch's token and pane (R-2).
    let conversation: { id: string; source: string } | undefined;
    if (options.continueConversation) {
      const getOwnConversationId = agent.getOwnConversationId?.bind(agent);
      if (!getOwnConversationId) {
        return refuse(
          `agent ${agent.name} cannot continue a conversation by its ID`,
          "relaunch without --continue to start a new conversation",
        );
      }
      if (!binding) {
        return refuse(
          "its last launch has no launch token (a restore, or a launch by an older AO build), so the conversation of its agent is not known",
          "relaunch without --continue to start a new conversation",
        );
      }
      let lookup: Awaited<ReturnType<NonNullable<Agent["getOwnConversationId"]>>>;
      try {
        lookup = await answerWithin("the conversation lookup", () =>
          getOwnConversationId(session, {
            dataDir: sessionsDir,
            launchToken: binding.token,
            pane: { id: pane.paneId, tty: pane.tty },
          }),
        );
      } catch (err) {
        return refuse(
          `the ID of its own conversation could not be read (${shortErrorText(err)})`,
          "relaunch without --continue to start a new conversation",
        );
      }
      if (lookup.id === null) {
        return refuse(
          `the ID of its own conversation is not known: ${lookup.reason}`,
          "relaunch without --continue to start a new conversation, or resume the conversation by hand in the pane",
        );
      }
      conversation = { id: lookup.id, source: lookup.source };
    }

    // 8. The launch command and the environment, as restore builds them
    //    (steps 5 and 9 of restore), with a new launch token. An
    //    orchestrator keeps its permissionless mode and gets the
    //    orchestrator prompt of this build in the prompt file of
    //    spawnOrchestrator (written after the claim, step 10).
    const workspacePath = raw["worktree"] || project.path;
    const orchestrator = selection.role === "orchestrator";
    const systemPromptFile = orchestrator
      ? join(
          getProjectBaseDir(config.configPath, project.path),
          `orchestrator-prompt-${sessionId}.md`,
        )
      : undefined;
    const launchToken = randomUUID();
    const launchConfig: AgentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(orchestrator ? { permissions: "permissionless" as const } : {}),
        },
      },
      issueId: session.issueId ?? undefined,
      permissions: orchestrator ? "permissionless" : selection.permissions,
      model: selection.model,
      subagent: selection.subagent,
      launchToken,
      ...(systemPromptFile ? { systemPromptFile } : {}),
      ...(conversation ? { continueConversationId: conversation.id } : {}),
    };
    const launchCommand = agent.getLaunchCommand(launchConfig);
    const exec = isExecableCommand(launchCommand);
    if (inOwnPane && !exec) {
      refuse(
        "its launch command is not one simple command, so this pane cannot run its agent as a child of ao",
        "run the relaunch from another shell",
      );
    }
    const tmuxName = raw["tmuxName"];
    const environment: Record<string, string> = {
      ...agent.getEnvironment(launchConfig),
      AO_SESSION: sessionId,
      AO_DATA_DIR: sessionsDir,
      AO_SESSION_NAME: sessionId,
      ...(tmuxName && { AO_TMUX_NAME: tmuxName }),
      AO_CALLER_TYPE: orchestrator ? "orchestrator" : "agent",
      AO_PROJECT_ID: projectId,
      AO_CONFIG_PATH: config.configPath,
      AO_STATE_ROOT: getStateRoot(),
    };

    // 9. The launch claim, the launch grace and the token and pane of this
    //    launch: one compare-and-set against the launch identity and the
    //    launch keys as read (a dead launcher's keys are replaced). A second
    //    relaunch fails here or at step 2.
    const claim = await currentLaunchClaim();
    if (!claim) {
      return refuse(
        `the start time of ao process ${process.pid} cannot be read, so the relaunch cannot hold its launch claim`,
        "try again; if it repeats, use `ao session restore`",
      );
    }
    const claimedAt = new Date().toISOString();
    const claimed = updateMetadataIf(
      sessionsDir,
      sessionId,
      {
        ...launchIdentity(raw),
        [LAUNCH_PID_KEY]: raw[LAUNCH_PID_KEY] ?? "",
        [LAUNCH_PID_START_KEY]: raw[LAUNCH_PID_START_KEY] ?? "",
      },
      {
        ...claim,
        restoredAt: claimedAt,
        [LAUNCH_TOKEN_KEY]: launchToken,
        [LAUNCH_TOKEN_AT_KEY]: claimedAt,
        [LAUNCH_PANE_KEY]: pane.paneId,
      },
    );
    if (!claimed) {
      return refuse(
        "its record changed while the relaunch checked it (another launch, a restore or a kill of the ID)",
        "check it with `ao session ls`, then try again",
      );
    }
    const warnings: string[] = [];
    const warn = (message: string): void => {
      warnings.push(message);
      options.onWarning?.(message);
    };

    /**
     * The end state, written only while the record holds this relaunch's
     * launch keys (nobody else can take them while this process lives).
     * The keys always go. "running": a recoverable `killed` status (the
     * lifecycle can persist it between `/exit` and the relaunch) becomes
     * `working`. "absent": `restoredAt`, the token and the pane get their
     * values before the relaunch back. "unknown": the agent may run, so the
     * new values stay. When the write fails (an I/O error, or a compare
     * that fails three times), the failure is reported at once and later
     * tries run while this process lives (review r1 M-3): an `ao` that
     * stays for the agent's life never holds the claim for that life.
     */
    const before = {
      restoredAt: raw["restoredAt"] ?? "",
      [LAUNCH_TOKEN_KEY]: raw[LAUNCH_TOKEN_KEY] ?? "",
      [LAUNCH_TOKEN_AT_KEY]: raw[LAUNCH_TOKEN_AT_KEY] ?? "",
      [LAUNCH_PANE_KEY]: raw[LAUNCH_PANE_KEY] ?? "",
    };
    const ownKeys = {
      [LAUNCH_PID_KEY]: claim[LAUNCH_PID_KEY],
      [LAUNCH_PID_START_KEY]: claim[LAUNCH_PID_START_KEY],
    };
    // The shared clear of an own claim (clearOwnLaunchClaimOnce, Herdr fit-2):
    // the relaunch compares its claim pair only, and adds its end state.
    const settleOnce = (state: SessionRelaunchResult["agentState"]): "done" | "gone" | "retry" =>
      clearOwnLaunchClaimOnce(sessionsDir, sessionId, ownKeys, {
        extra: (current) => {
          const updates: Record<string, string> = {};
          if (state === "running" && isRecoverableKillRecord(current)) {
            updates["status"] = SESSION_STATUS.WORKING;
          }
          if (state === "absent" && current["restoredAt"] === claimedAt)
            Object.assign(updates, before);
          return updates;
        },
      });
    const settle = (state: SessionRelaunchResult["agentState"]): void => {
      let tries = 0;
      const attempt = (): boolean => {
        tries += 1;
        let outcome: "done" | "gone" | "retry";
        let failure = "its record changed during each write";
        try {
          outcome = settleOnce(state);
        } catch (err) {
          outcome = "retry";
          failure = shortErrorText(err);
        }
        if (outcome === "gone") {
          warn(
            `the record of ${sessionId} was replaced or removed during the relaunch; the relaunch did not write its end state`,
          );
          return true;
        }
        if (outcome === "done") {
          if (tries > RELAUNCH_SETTLE_TRIES) {
            warn(`the launch keys of ${sessionId} were cleared at try ${tries}`);
          }
          return true;
        }
        if (tries === RELAUNCH_SETTLE_TRIES) {
          warn(
            `the launch keys of ${sessionId} could not be cleared yet (${failure}); this ao process tries again while it runs, and a restore, kill or stop of the session refuses until then`,
          );
        }
        return false;
      };
      for (let i = 0; i < RELAUNCH_SETTLE_TRIES; i++) if (attempt()) return;
      let delay = RELAUNCH_SETTLE_RETRY_MS;
      const later = (): void => {
        if (attempt()) return;
        delay = Math.min(delay * 2, RELAUNCH_SETTLE_RETRY_MAX_MS);
        setTimeout(later, delay).unref();
      };
      // The timer does not keep this process alive: an ao that ends leaves
      // keys of a dead process, which no launch check counts.
      setTimeout(later, delay).unref();
    };

    // 10. The prompt file, the workspace hooks (before the agent reads its
    //     settings, so its SessionStart hook records its conversation) and
    //     the launch script.
    let script: string;
    try {
      if (systemPromptFile) {
        mkdirSync(getProjectBaseDir(config.configPath, project.path), { recursive: true });
        writeFileSync(
          systemPromptFile,
          generateOrchestratorPrompt({ config, projectId, project }),
          "utf-8",
        );
      }
      const setupHooks = agent.setupWorkspaceHooks?.bind(agent);
      if (setupHooks) {
        await answerWithin("the setup of the workspace hooks", () =>
          setupHooks(workspacePath, { dataDir: sessionsDir, sessionId }),
        );
      }
      script = writeRelaunchScript(workspacePath, environment, launchCommand, exec);
    } catch (err) {
      settle("absent");
      throw new Error(
        `The relaunch of ${sessionId} could not prepare its launch (${shortErrorText(err)}); no agent was started`,
        { cause: err },
      );
    }

    // 11. The start, within one deadline for every awaited call after it.
    const plan: SessionRelaunchPlan = {
      sessionId,
      mode: inOwnPane ? "caller-terminal" : "pane",
      agentName: agent.name,
      ...(selection.model ? { model: selection.model } : {}),
      launchCommand,
      ...(conversation ? { conversation } : {}),
    };
    const deadline = Date.now() + LAUNCH_CONFIRM_TIMEOUT_MS;
    const startFailed = (err: unknown): never => {
      try {
        rmSync(script, { force: true });
      } catch (rmErr) {
        warn(`the launch script ${script} could not be removed (${shortErrorText(rmErr)})`);
      }
      settle("absent");
      throw new Error(
        `The relaunch of ${sessionId} could not start its agent (${shortErrorText(err)})`,
        { cause: err },
      );
    };
    let child: SessionRelaunchChild | undefined;
    try {
      options.onStart?.(plan);
      if (inOwnPane && runInCallerTerminal) {
        child = runInCallerTerminal({ script, cwd: workspacePath });
      }
    } catch (err) {
      startFailed(err);
    }
    if (!child) {
      const typed = await outcomeWithin(
        () => runInPane(handle, pane.paneId, `bash ${shellEscape(script)}`),
        deadline - Date.now(),
      );
      // A failure means nothing ran (the runtime typed no Enter); no answer
      // in time means the line may run, so the check below decides.
      if (typed.kind === "error") startFailed(typed.error);
    }

    // 12. The bounded wait for the agent process (the spawn bound). Each
    //     check gets only the time left; an answer that is not true or
    //     false, a rejection or no answer is unknown (the agent may run); a
    //     child that ended is absent.
    let childEnded = false;
    child?.exited.then(
      () => {
        childEnded = true;
      },
      () => {
        childEnded = true;
      },
    );
    let agentState: SessionRelaunchResult["agentState"] | null = null;
    let lastAnswer: "absent" | "unknown" = "unknown";
    for (;;) {
      if (childEnded) {
        agentState = "absent";
        break;
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      const answer = await outcomeWithin(() => agent.isProcessRunning(agentHandle), left);
      if (childEnded) {
        agentState = "absent";
        break;
      }
      if (answer.kind === "value" && answer.value === true) {
        agentState = "running";
        break;
      }
      lastAnswer = answer.kind === "value" && answer.value === false ? "absent" : "unknown";
      const wait = Math.min(RELAUNCH_CONFIRM_POLL_MS, deadline - Date.now());
      if (wait <= 0) break;
      await sleep(wait);
    }
    const finalState = agentState ?? lastAnswer;

    // 13. The end state, then postLaunchSetup (bounded, non-fatal), as restore.
    settle(finalState);
    const postLaunchSetup = agent.postLaunchSetup?.bind(agent);
    if (finalState === "running" && postLaunchSetup) {
      const relaunched: Session = {
        ...session,
        runtimeHandle: agentHandle,
        workspacePath,
        restoredAt: new Date(),
      };
      const metadataBefore = { ...(relaunched.metadata ?? {}) };
      const setup = await outcomeWithin(
        () => postLaunchSetup(relaunched),
        RELAUNCH_PROBE_TIMEOUT_MS,
      );
      if (setup.kind === "value") {
        const updates = Object.fromEntries(
          Object.entries(relaunched.metadata ?? {}).filter(
            ([key, value]) => metadataBefore[key] !== value,
          ),
        );
        if (Object.keys(updates).length > 0) {
          updateMetadataIf(sessionsDir, sessionId, launchIdentity(claimed), updates);
        }
      } else {
        warn(
          `the post-launch setup of agent ${agent.name} ${setup.kind === "timeout" ? `did not finish within ${RELAUNCH_PROBE_TIMEOUT_MS / 1000} s` : `failed (${shortErrorText(setup.error)})`}; the agent runs`,
        );
      }
    }

    return {
      plan,
      running: finalState === "running",
      agentState: finalState,
      warnings,
      ...(child ? { child } : {}),
    };
  }

  return {
    spawn,
    spawnOrchestrator,
    findReusableOrchestrators,
    restore,
    relaunch,
    list,
    get,
    kill,
    cleanup,
    send,
    deliver,
    claimPR,
    remap,
  };
}
