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
} from "node:fs";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  AgentNotAttachedError,
  isAgentDeliveryError,
  isAgentNotAttachedError,
  isIssueNotFoundError,
  isRestorable,
  NON_RESTORABLE_STATUSES,
  RUNTIME_NO_SERVER_ERROR_CODE,
  SessionLaunchInProgressError,
  SessionNotFoundError,
  SessionNotRestorableError,
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
  PR_STATE,
} from "./types.js";
import {
  readMetadataRaw,
  readArchivedMetadataRaw,
  updateArchivedMetadata,
  updateMetadataIf,
  GENERATION_KEY,
  RESERVATION_KEY,
  deleteMetadata,
  holdsExpected,
  launchIdentity,
  listMetadata,
  reserveSessionRecord,
} from "./metadata.js";
import { buildPrompt } from "./prompt-builder.js";
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
import { isDeliveryLockSupported } from "./delivery-lock.js";
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
import { sessionFromMetadata } from "./utils/session-from-metadata.js";
import { safeJsonParse } from "./utils/validation.js";
import { isSafeBranchName } from "./utils/branch-name.js";
import { resolveAgentSelection, resolveSessionRole } from "./agent-selection.js";
import { exactPaneTarget, exactSessionTarget } from "./tmux.js";
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
 * The foreground command of the session's pane, `TMUX_PANE_GONE` when the
 * session does not exist, or null when tmux could not answer. tmux 3.4
 * prints empty format values and exits 0 for a target that does not exist,
 * so empty output means gone, not unknown.
 */
async function getTmuxForegroundCommand(
  sessionName: string,
): Promise<string | typeof TMUX_PANE_GONE | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", exactPaneTarget(sessionName), "#{pane_current_command}"],
      { timeout: 5_000 },
    );
    const command = stdout.trim();
    return command.length > 0 ? command : TMUX_PANE_GONE;
  } catch {
    return null;
  }
}

/**
 * Liveness of an orchestrator record before `spawnOrchestrator` reuses or
 * replaces it. A rejected probe is unknown, so the record is neither reused nor
 * archived. The one exception is a runtime with no server at all
 * (RUNTIME_NO_SERVER_ERROR_CODE): no session can exist then, as after a host
 * restart, and `ao start` must be able to launch a new orchestrator.
 */
async function isOrchestratorRuntimeAlive(
  runtime: Runtime,
  handle: RuntimeHandle,
  sessionId: SessionId,
): Promise<boolean> {
  try {
    return await runtime.isAlive(handle);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
    if (code === RUNTIME_NO_SERVER_ERROR_CODE) return false;
    throw new Error(
      `Cannot tell whether session ${sessionId} is alive, so it is neither reused nor replaced. Check the runtime and retry.`,
      { cause: err },
    );
  }
}

/** Reconstruct a Session object from raw metadata key=value pairs. */
function metadataToSession(
  sessionId: SessionId,
  meta: Record<string, string>,
  projectId: string,
  createdAt?: Date,
  modifiedAt?: Date,
): Session {
  return sessionFromMetadata(sessionId, meta, {
    projectId,
    createdAt,
    lastActivityAt: modifiedAt ?? new Date(),
  });
}

export interface SessionManagerDeps {
  config: OrchestratorConfig;
  registry: PluginRegistry;
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
   * (`ENOENT`) names nothing.
   */
  function hasOtherOpenCodeRecord(
    sessionsDir: string,
    sessionId: string,
    openCodeId: string,
  ): boolean {
    try {
      for (const id of listRecordIds(sessionsDir)) {
        if (id === sessionId) continue;
        if (readRecordStrict(sessionsDir, id)?.["opencodeSessionId"] === openCodeId) return true;
      }
      for (const id of listArchivedSessionIdsStrict(sessionsDir)) {
        // The ID has an archive file, so a null here is a read error (which
        // readArchivedMetadataRaw answers as null) or a removal since.
        const archived = readArchivedMetadataRaw(sessionsDir, id);
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
    launchClaim: Record<string, string> | null,
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
        : reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
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
    launchClaim: Record<string, string> | null,
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
        const record = reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
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
    const handleRuntimeName = session.runtimeHandle?.runtimeName;
    const runtime =
      handleRuntimeName && handleRuntimeName !== plugins.runtime?.name
        ? (registry.get<Runtime>("runtime", handleRuntimeName) ?? plugins.runtime)
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
        const alive = await runtime.isAlive(session.runtimeHandle);
        if (!alive) {
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
   * may own it. Only no record, or a launched record that names another
   * runtime, shows that no record owns it.
   */
  function recordMayOwnRuntime(
    record: Readonly<Record<string, string>> | null,
    handle: RuntimeHandle,
  ): boolean {
    if (!record) return false;
    if (!record["runtimeHandle"]) return true;
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
   * whether that happened.
   */
  async function rollbackLaunch(rollback: {
    own: OwnLaunchRecord;
    runtime?: Runtime;
    handle?: RuntimeHandle;
    prepared?: PreparedAgentSession;
    workspace?: RollbackWorkspace;
    /** The error that failed the launch, for `launchFailed`. */
    failure?: unknown;
  }): Promise<{ stopUnconfirmed: boolean }> {
    const { own } = rollback;
    const unreadable = (error: unknown): string =>
      `the record of ${own.sessionId} could not be read (${shortErrorText(error)})`;
    if (rollback.runtime && rollback.handle) {
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
   * it); the operator gets the outcome and the next action.
   */
  function keepUnconfirmedLaunch(
    rollback: {
      own: OwnLaunchRecord;
      prepared?: PreparedAgentSession;
      workspace?: RollbackWorkspace;
      failure?: unknown;
    },
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

    // Determine session ID — atomically reserve to prevent concurrent collisions
    const launchClaim = plugins.agent.prepareAgentSession ? await readLaunchClaim() : null;
    const {
      sessionId,
      tmuxName,
      record: reservedRecord,
    } = await reserveNextSessionIdentity(project, sessionsDir, launchClaim);
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
    const agentLaunchConfig: AgentLaunchConfig = {
      ...baseLaunchConfig,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
        },
      },
    };

    let prepared: PreparedAgentSession | undefined;
    let preparedCreatedAt: string | undefined;
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
        preparedCreatedAt = new Date().toISOString();
        own.write(
          {
            worktree: workspacePath,
            branch,
            status: "spawning",
            tmuxName,
            issue: spawnConfig.issueId,
            project: spawnConfig.projectId,
            agent: selection.agentName,
            model: selection.model,
            permissions: selection.permissions ?? "default",
            createdAt: preparedCreatedAt,
            ...prepared.metadata,
            [RESERVATION_KEY]: "",
          },
          "the spawn prepared its agent session",
        );
        launchCommand = plugins.agent.getLaunchCommand(
          withPreparedAgentConfig(agentLaunchConfig, prepared),
        );
      } else {
        launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
        environment = paneEnvironment(plugins.agent.getEnvironment(agentLaunchConfig));
      }

      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId, // Use tmux name for runtime if available
        workspacePath,
        launchCommand,
        environment,
      });
    } catch (err) {
      // Remove only an agent session that this spawn created (never a reused
      // one), the workspace and the reserved ID.
      await rollbackLaunch({ own, prepared, workspace: spawnWorkspace() });
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
      metadata: prepared
        ? { ...prepared.metadata }
        : { ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}) },
    };

    let confirmation: AgentLaunchConfirmation | undefined;
    try {
      // Stored spawn identity: every worker persists its effective model
      // (selection.model, which is the explicit --model when given) and its
      // effective permission mode ("default" when the config object sets no
      // mode — the YAML loader always sets one, its default is
      // `permissionless` — so that a later config edit cannot add one).
      // Later operations reuse both before the config. Only `ao spawn`
      // supplies a model (batch-spawn has no --model flag); the mode comes
      // from the config.
      const launchedRecord = {
        worktree: workspacePath,
        branch,
        status: "spawning",
        tmuxName, // Store tmux name for mapping
        issue: spawnConfig.issueId,
        project: spawnConfig.projectId,
        agent: selection.agentName, // Persist agent name for lifecycle manager
        model: selection.model,
        permissions: selection.permissions ?? "default",
        createdAt: preparedCreatedAt ?? new Date().toISOString(),
        runtimeHandle: JSON.stringify(handle),
        opencodeSessionId: session.metadata["opencodeSessionId"],
      };
      // B-1: a merge (into the own record only), so the launch keys stay
      // until `confirmLaunch` proves that the pane runs the agent on its
      // session. The reservation ID goes: the launch identity now names it.
      own.write({ ...launchedRecord, [RESERVATION_KEY]: "" }, "the spawn started its runtime");

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
        // B-1: the launch is confirmed; from now on the pane rule applies.
        own.write(
          { ...session.metadata, ...CLEARED_LAUNCH_CLAIM },
          "the spawn confirmed its launch",
        );
      } else if (Object.keys(session.metadata || {}).length > 0) {
        own.write(session.metadata, "the spawn set up its agent");
      }
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

    // Validate and store .origin file before reserving any identity so that
    // a validation failure does not leave an orphaned metadata entry.
    if (config.configPath) {
      validateAndStoreOrigin(config.configPath, project.path);
    }

    let sessionId: string;
    let tmuxName: string | undefined;
    let branch: string;
    let workspacePath: string;
    // B-1 (round 4): the record that this start reserved; its writes go there only.
    let own: OwnLaunchRecord;
    const launchClaim = plugins.agent.prepareAgentSession ? await readLaunchClaim() : null;

    /**
     * Same-ID R2a: stop a live orchestrator before this start replaces it.
     * Only `destroyed` or `absent` goes on; anything else throws, so the
     * start removes no record and creates no runtime.
     */
    const orchestratorRuntime = plugins.runtime;
    const stopOrchestratorOrRefuse = async (handle: RuntimeHandle, kept: string): Promise<void> => {
      const stopped = await stopRuntime(orchestratorRuntime, handle);
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

    if (orchestratorWorkspaceMode === "project") {
      sessionId = `${project.sessionPrefix}-orchestrator`;
      tmuxName = config.configPath
        ? `${generateConfigHash(config.configPath)}-${sessionId}`
        : undefined;
      branch = project.defaultBranch;
      workspacePath = project.path;

      if (plugins.agent.setupWorkspaceHooks) {
        await plugins.agent.setupWorkspaceHooks(workspacePath, { dataDir: sessionsDir });
      }

      const existingRaw = readMetadataRaw(sessionsDir, sessionId);
      // B-2: another `ao start` still launches this orchestrator. Its rollback
      // or its later writes would hit the record that this start makes, so
      // neither reuse nor replace it.
      if (existingRaw) await assertNoLiveLauncher(sessionId, existingRaw, "replace");
      const existingOrchestrator = existingRaw?.["runtimeHandle"]
        ? metadataToSession(sessionId, existingRaw, orchestratorConfig.projectId)
        : null;
      // B-1 (round 4): the liveness check awaits; the old orchestrator is
      // stopped and its record removed only while the record still names
      // the launch that was checked. Another start that replaced it in the
      // meantime keeps its record (the reservation below then fails, and
      // the concurrent path decides again from the new record).
      const stillNames = (read: Record<string, string>): boolean => {
        const current = readMetadataRaw(sessionsDir, sessionId);
        return !!current && holdsExpected(current, launchIdentity(read));
      };
      if (existingRaw && existingOrchestrator?.runtimeHandle) {
        const existingAlive = await isOrchestratorRuntimeAlive(
          plugins.runtime,
          existingOrchestrator.runtimeHandle,
          sessionId,
        );
        if (
          existingAlive &&
          (orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore")
        ) {
          // Round 8 (M-1): null only for a missing record; a record that
          // cannot be read throws and keeps the runtime.
          const persistedRaw = readRecordStrict(sessionsDir, sessionId);
          if (persistedRaw?.["runtimeHandle"]) {
            const persisted = metadataToSession(
              sessionId,
              persistedRaw,
              orchestratorConfig.projectId,
            );
            persisted.metadata["orchestratorSessionReused"] = "true";
            return persisted;
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
            deleteMetadata(sessionsDir, sessionId, false, launchIdentity(existingRaw));
          }
        } else {
          deleteMetadata(
            sessionsDir,
            sessionId,
            orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore",
            launchIdentity(existingRaw),
          );
        }
      }

      let reservedRecord = reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
      if (!reservedRecord) {
        const concurrentRaw = readMetadataRaw(sessionsDir, sessionId);
        if (concurrentRaw) await assertNoLiveLauncher(sessionId, concurrentRaw, "replace");
        const concurrentSession = concurrentRaw?.["runtimeHandle"]
          ? metadataToSession(sessionId, concurrentRaw, orchestratorConfig.projectId)
          : null;
        if (concurrentRaw && concurrentSession?.runtimeHandle) {
          const concurrentAlive = await isOrchestratorRuntimeAlive(
            plugins.runtime,
            concurrentSession.runtimeHandle,
            sessionId,
          );
          if (
            concurrentAlive &&
            (orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore")
          ) {
            concurrentSession.metadata["orchestratorSessionReused"] = "true";
            return concurrentSession;
          }
          if (!concurrentAlive) {
            deleteMetadata(
              sessionsDir,
              sessionId,
              orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore",
              launchIdentity(concurrentRaw),
            );
            reservedRecord = reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
          }
        } else {
          reservedRecord = reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
        }
        if (!reservedRecord) {
          throw new Error(`Session ${sessionId} already exists but is not in a reusable state`);
        }
      }
      own = ownLaunchRecord(sessionsDir, sessionId, reservedRecord);
    } else {
      // Reserve a new unique orchestrator identity (e.g. {prefix}-orchestrator-1, -2, …).
      // Each isolated orchestrator gets its own numbered session and workspace.
      const identity = reserveNextOrchestratorIdentity(project, sessionsDir, launchClaim);
      sessionId = identity.sessionId;
      tmuxName = identity.tmuxName;
      branch = `orchestrator/${sessionId}`;
      own = ownLaunchRecord(sessionsDir, sessionId, identity.record);

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
      failed: { handle?: RuntimeHandle; prepared?: PreparedAgentSession; failure?: unknown } = {},
    ): Promise<void> => {
      const { stopUnconfirmed } = await rollbackLaunch({
        own,
        runtime: plugins.runtime ?? undefined,
        handle: failed.handle,
        prepared: failed.prepared,
        failure: failed.failure,
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

    const agentLaunchConfig: AgentLaunchConfig = {
      ...baseLaunchConfig,
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
    let preparedCreatedAt: string | undefined;
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
        preparedCreatedAt = new Date().toISOString();
        own.write(
          {
            worktree: workspacePath,
            branch,
            status: "working",
            role: "orchestrator",
            tmuxName,
            project: orchestratorConfig.projectId,
            agent: selection.agentName,
            createdAt: preparedCreatedAt,
            ...prepared.metadata,
            [RESERVATION_KEY]: "",
          },
          "the start prepared its agent session",
        );
        launchCommand = plugins.agent.getLaunchCommand(
          withPreparedAgentConfig(agentLaunchConfig, prepared),
        );
      } else {
        launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
        environment = paneEnvironment(plugins.agent.getEnvironment(agentLaunchConfig));
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
      await rollbackOrchestratorLaunch(systemPromptFile, { prepared });
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
      metadata: prepared
        ? { ...prepared.metadata }
        : {
            ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
          },
    };

    try {
      const launchedRecord = {
        worktree: workspacePath,
        branch,
        status: "working",
        role: "orchestrator",
        tmuxName,
        project: orchestratorConfig.projectId,
        agent: selection.agentName,
        createdAt: preparedCreatedAt ?? new Date().toISOString(),
        runtimeHandle: JSON.stringify(handle),
        opencodeSessionId: session.metadata["opencodeSessionId"],
      };
      // B-1: a merge (into the own record only), so the launch keys stay
      // until the launch is confirmed.
      own.write({ ...launchedRecord, [RESERVATION_KEY]: "" }, "the start started its runtime");

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
        // B-1: the launch is confirmed; from now on the pane rule applies.
        own.write(
          { ...session.metadata, ...CLEARED_LAUNCH_CLAIM },
          "the start confirmed its launch",
        );
      } else if (Object.keys(session.metadata || {}).length > 0) {
        own.write(session.metadata, "the start set up its agent");
      }
    } catch (err) {
      // Clean up runtime on post-launch failure. The runtime goes first, so no
      // pane still uses the agent session that is removed.
      await rollbackOrchestratorLaunch(systemPromptFile, { handle, prepared, failure: err });
      throw err;
    }

    return session;
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

  async function kill(sessionId: SessionId, options?: { purgeOpenCode?: boolean }): Promise<void> {
    return killRecord(sessionId, options);
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
    options?: { purgeOpenCode?: boolean },
    decidedFrom?: Readonly<Record<string, string>>,
  ): Promise<void> {
    const { raw, sessionsDir, project, projectId } = requireSessionRecord(sessionId);
    const expected = decidedFrom ? cleanupDecisionOf(decidedFrom) : launchIdentity(raw);
    if (decidedFrom && !holdsExpected(raw, expected)) {
      throw recordChangedError(
        sessionsDir,
        sessionId,
        "it was checked for cleanup",
        "it was not killed",
      );
    }
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
        const runtimePlugin = registry.get<Runtime>(
          "runtime",
          handle.runtimeName ??
            (project ? (project.runtime ?? config.defaults.runtime) : config.defaults.runtime),
        );
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
          if (!isRuntimeStopConfirmed(stopped)) {
            throw new RuntimeStopUnconfirmedError({
              sessionId,
              handle,
              stop: stopped,
              kept: "record and worktree kept",
              retry: decidedFrom ? "ao session cleanup" : `ao session kill ${sessionId}`,
            });
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

        // Check if runtime is dead
        if (!shouldKill && session.runtimeHandle && plugins.runtime) {
          const handle = session.runtimeHandle;
          try {
            const alive = await plugins.runtime.isAlive(handle);
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
            ? getTmuxForegroundCommand(handle.id)
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
            ? getTmuxForegroundCommand(handle.id)
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
    if (fromArchive) {
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
    }
    const stillOwned = (): boolean => {
      const current = readMetadataRaw(sessionsDir, sessionId);
      return !!current && holdsExpected(current, launchIdentity(owned));
    };

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
    if (session.runtimeHandle) {
      const stopped = await stopRuntime(plugins.runtime, session.runtimeHandle);
      if (!isRuntimeStopConfirmed(stopped)) {
        throw new RuntimeStopUnconfirmedError({
          sessionId,
          handle: session.runtimeHandle,
          stop: stopped,
          kept: fromArchive
            ? releaseCopyBack(sessionsDir, sessionId, owned)
            : "nothing was restored: this restore did not change the record or the workspace, and no new runtime was created",
          retry: `ao session restore ${sessionId}`,
        });
      }
    }

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
    const handle = await plugins.runtime.create({
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

    // 10. Update metadata — merge updates, preserving existing fields. B-1
    // (round 4): only into the version that this restore owns. When it was
    // archived, or another reservation, restore or launch replaced it, the
    // restore throws. Round 5 (B-1): the new runtime is stopped only when the
    // record read directly before the destroy shows that no record owns it
    // (recordMayOwnRuntime). Another launch of the ID can stop this runtime
    // and create its own under the same name before this write, so "created
    // a moment ago" is no proof; a runtime that stays is named in the error.
    const now = new Date().toISOString();
    const restoredRecord = updateMetadataIf(sessionsDir, sessionId, launchIdentity(owned), {
      status: "spawning",
      runtimeHandle: JSON.stringify(handle),
      restoredAt: now,
      [RESERVATION_KEY]: "",
    });
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

    return restoredSession;
  }

  return {
    spawn,
    spawnOrchestrator,
    restore,
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
