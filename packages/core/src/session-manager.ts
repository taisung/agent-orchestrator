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
import { execFile } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
  isIssueNotFoundError,
  isRestorable,
  NON_RESTORABLE_STATUSES,
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
  PR_STATE,
} from "./types.js";
import {
  readMetadataRaw,
  readArchivedMetadataRaw,
  updateArchivedMetadata,
  writeMetadata,
  updateMetadata,
  deleteMetadata,
  listMetadata,
  reserveSessionId,
} from "./metadata.js";
import { buildPrompt } from "./prompt-builder.js";
import {
  getSessionsDir,
  getStateRoot,
  getWorktreesDir,
  getProjectBaseDir,
  generateConfigHash,
  generateTmuxName,
  validateAndStoreOrigin,
} from "./paths.js";
import { asValidOpenCodeSessionId } from "./opencode-session-id.js";
import {
  getOpenCodeSession,
  findOpenCodeSessionsByTitle,
  waitForOpenCodeSession,
  removeOpenCodeSession,
  interruptOpenCodeSession,
  OpenCodeApiTimeoutError,
  OPENCODE_API_TIMEOUT_MS,
  type OpenCodeApiSession,
} from "./opencode-api.js";
import {
  acquireOpenCodeLaunchLock,
  OPENCODE_SPAWN_DISCOVERY_WINDOW_MS,
  type OpenCodeLaunchLock,
} from "./opencode-launch-lock.js";
import { normalizeOrchestratorSessionStrategy } from "./orchestrator-session-strategy.js";
import { sessionFromMetadata } from "./utils/session-from-metadata.js";
import { safeJsonParse } from "./utils/validation.js";
import { resolveAgentSelection, resolveSessionRole } from "./agent-selection.js";

const execFileAsync = promisify(execFile);
const OPENCODE_DISCOVERY_TIMEOUT_MS = OPENCODE_API_TIMEOUT_MS;
const OPENCODE_INTERACTIVE_DISCOVERY_TIMEOUT_MS = OPENCODE_API_TIMEOUT_MS;

/**
 * Pause between two searches of that wait. One search is one `opencode api`
 * process (about 0.14 s and 0.2 s of CPU); a 500 ms pause keeps the wait
 * under half a core and adds at most about 0.5 s after the pane's create.
 */
const OPENCODE_SPAWN_DISCOVERY_POLL_MS = 500;

/** One line for the operator on stderr, where the command itself still succeeds. */
function warnOperator(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Only retained-runtime failures known to precede command delivery can discard uncertainty. */
function failedBeforeCommandDelivery(runtimeName: string, error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cmd = "cmd" in error && typeof error.cmd === "string" ? error.cmd : "";
  if (runtimeName === "tmux") return cmd.startsWith("tmux new-session ");
  // Herdr wraps every pane.run failure; these top-level errors are from workspace.create.
  if (runtimeName === "herdr")
    return (
      /^\S+ workspace create /.test(cmd) ||
      error.message.startsWith("herdr error ") ||
      error.message.startsWith("herdr workspace create returned no usable pane")
    );
  return false;
}

/** The error text on one line: an `execFile` message ends with a newline. */
function shortErrorText(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Release errors must not replace the launch/setup error that caused cleanup. */
function releaseOpenCodeLaunchLock(lock: OpenCodeLaunchLock | undefined, failed: boolean): void {
  try {
    lock?.release();
  } catch (error) {
    if (!failed) throw error;
    warnOperator(`ao: could not release the OpenCode launch lock: ${shortErrorText(error)}`);
  }
}

async function recordFailedOpenCodeLaunch(
  lock: OpenCodeLaunchLock | undefined,
  handle: RuntimeHandle,
  error: unknown,
): Promise<void> {
  if (!lock) return;
  try {
    if (failedBeforeCommandDelivery(handle.runtimeName, error)) {
      lock.cancel();
    } else if (lock.pending) {
      // The runtime may already have removed the pane after failed delivery.
      // Its known name and server still allow a later explicit absence check.
      await lock.recordRuntime(handle);
      const recovery =
        handle.runtimeName === "tmux"
          ? `A fresh start can recover once the recorded pane is proven gone and ${(OPENCODE_SPAWN_DISCOVERY_WINDOW_MS + OPENCODE_API_TIMEOUT_MS) / 1000} s have elapsed since launch.`
          : "This runtime requires manual recovery.";
      warnOperator(`ao: uncertain OpenCode launch ${handle.id}. ${recovery} ${lock.recoveryHint}`);
    }
  } catch (cleanupError) {
    warnOperator(
      `ao: could not update the failed OpenCode launch marker: ${shortErrorText(cleanupError)}. ${lock.recoveryHint}`,
    );
  } finally {
    releaseOpenCodeLaunchLock(lock, true);
  }
}

/**
 * The directories that the OpenCode session of a workspace can carry in
 * `location.directory`. The pane sends `process.cwd()`, which is the real
 * path, so a workspace path behind a symlink is searched under both names.
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
 * Row 23 (until I-3): wait for the pane of a new session to create its
 * OpenCode session, and return the ID to store. A session is accepted only
 * when its title is exactly `AO:<sessionId>`, its `location.directory` is
 * this session's workspace, and it was created at or after `launchStartedAt`
 * while holding the host-wide launch lock. The lock prevents another fleet
 * with the same title and workspace from creating during this window. When the wait ends
 * without one match, the spawn still succeeds, and the operator gets one
 * line that names `ao session remap`.
 */
async function discoverNewOpenCodeSession(
  sessionId: string,
  workspacePath: string,
  launchStartedAt: number,
  recoveryHint: string,
): Promise<string | undefined> {
  const title = `AO:${sessionId}`;
  try {
    const result = await waitForOpenCodeSession(
      {
        title,
        directories: openCodeDirectoriesFor(workspacePath),
        createdAtOrAfter: launchStartedAt,
      },
      OPENCODE_SPAWN_DISCOVERY_WINDOW_MS,
      OPENCODE_SPAWN_DISCOVERY_POLL_MS,
    );
    if (result.status === "found") return result.session.id;
    if (result.status === "ambiguous") {
      warnOperator(
        `ao: ${result.sessions.length} OpenCode sessions titled ${title} in ${workspacePath} were created during this start (${result.sessions.map((s) => s.id).join(", ")}); none is stored for ${sessionId}. Run \`ao session remap ${sessionId}\` to list them. ${recoveryHint}`,
      );
      return undefined;
    }
    const lastError =
      result.lastError !== undefined
        ? ` Last search error: ${shortErrorText(result.lastError)}`
        : "";
    warnOperator(
      `ao: no OpenCode session titled ${title} appeared in ${workspacePath} within ${OPENCODE_SPAWN_DISCOVERY_WINDOW_MS / 1000} s, so ${sessionId} has no stored OpenCode session ID. Run \`ao session remap ${sessionId}\` when its pane shows the OpenCode TUI. Further fresh launches need proof that the earlier pane is gone, plus a matching create or an elapsed create window. ${recoveryHint}${lastError}`,
    );
    return undefined;
  } catch (err) {
    warnOperator(
      `ao: the search for the OpenCode session of ${sessionId} failed (${shortErrorText(err)}). Run \`ao session remap ${sessionId}\` when its pane shows the OpenCode TUI. ${recoveryHint}`,
    );
    return undefined;
  }
}

async function deleteOpenCodeSession(sessionId: string): Promise<void> {
  const validatedSessionId = asValidOpenCodeSessionId(sessionId);
  if (!validatedSessionId) return;
  // Rows 9 and 21: `session.remove` by ID. A 404 (already removed) is success.
  // On another error, retry, then throw with `cause` from the helper; `kill`
  // purge warns (and archives anyway), `cleanup` records an error entry. A
  // timeout ends the retries: three tries of a hanging service cost three
  // full bounds (about 30 s) and the third answers no sooner than the first.
  const retryDelaysMs = [0, 200, 600];
  let lastError: unknown;
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      await removeOpenCodeSession(validatedSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS);
      return;
    } catch (err) {
      lastError = err;
      if (err instanceof OpenCodeApiTimeoutError) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function interruptThenRemoveOpenCodeSession(sessionId: string): Promise<void> {
  const validatedSessionId = asValidOpenCodeSessionId(sessionId);
  if (!validatedSessionId) return;
  // Row 20 (`ao session kill --purge-session`): stop a running loop before
  // the delete. The interrupt is best effort (a 404 is already gone, and the
  // remove runs even when the interrupt hangs). The remove throws after its
  // retries; the `kill` caller warns and archives anyway. `cleanup` never
  // calls this (archived sessions are not running).
  try {
    await interruptOpenCodeSession(validatedSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS);
  } catch {
    // Best effort: fall through to the remove even when the interrupt hangs.
  }
  await deleteOpenCodeSession(validatedSessionId);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTmuxForegroundCommand(sessionName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["display-message", "-p", "-t", sessionName, "#{pane_current_command}"],
      { timeout: 5_000 },
    );
    const command = stdout.trim();
    return command.length > 0 ? command : null;
  } catch {
    return null;
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

  function updateMetadataPreservingMtime(
    sessionsDir: string,
    sessionName: string,
    updates: Partial<Record<string, string>>,
    modifiedAt?: Date,
  ): void {
    const metaPath = join(sessionsDir, sessionName);
    let preservedMtime = modifiedAt;
    if (!preservedMtime) {
      try {
        preservedMtime = statSync(metaPath).mtime;
      } catch {
        preservedMtime = undefined;
      }
    }

    updateMetadata(sessionsDir, sessionName, updates);

    if (!preservedMtime) return;
    try {
      utimesSync(metaPath, preservedMtime, preservedMtime);
    } catch {
      void 0;
    }
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
      updateMetadataPreservingMtime(
        sessionsDir,
        repaired.sessionName,
        updates,
        repaired.modifiedAt,
      );
      repaired.raw = applyMetadataUpdatesToRaw(repaired.raw, updates);
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
        updateMetadataPreservingMtime(sessionsDir, record.sessionName, updates, record.modifiedAt);
        record.raw = applyMetadataUpdatesToRaw(record.raw, updates);
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

  function markArchivedOpenCodeCleanup(sessionsDir: string, sessionId: SessionId): void {
    updateArchivedMetadata(sessionsDir, sessionId, {
      opencodeSessionId: "",
      opencodeCleanedAt: new Date().toISOString(),
    });
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

  function hasOtherOpenCodeRecord(
    sessionsDir: string,
    sessionId: string,
    openCodeId: string,
  ): boolean {
    return (
      listMetadata(sessionsDir).some(
        (id) =>
          id !== sessionId &&
          readMetadataRaw(sessionsDir, id)?.["opencodeSessionId"] === openCodeId,
      ) ||
      listArchivedSessionIds(sessionsDir).some(
        (id) => readArchivedMetadataRaw(sessionsDir, id)?.["opencodeSessionId"] === openCodeId,
      )
    );
  }

  async function openCodeHolderReason(
    project: ProjectConfig,
    id: string,
    raw: Record<string, string>,
  ): Promise<string | undefined> {
    const unknown = `session ${id} may still use it (liveness could not be checked)`;
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
              await execFileAsync("tmux", ["has-session", "-t", `=${handle.id}`], {
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
  }): Promise<string | undefined> {
    // Row 24: reuse by the stored ID only, no title discovery (owner Q7).
    // The orchestrator `delete` strategy deletes stored IDs only, too; an
    // older OpenCode session that no metadata stores is not found by title.
    const { sessionsDir, project, criteria, strategy } = options;
    if (strategy === "ignore") return undefined;

    const candidateIds = findOpenCodeSessionIds(sessionsDir, criteria);

    if (strategy === "delete") {
      for (const openCodeSessionId of [...new Set(candidateIds)]) {
        // m-4: keep an ID that another live AO session still runs in. The
        // orchestrator path replaces the session with its own ID, so that
        // record does not count as another holder.
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
        await deleteOpenCodeSession(openCodeSessionId);
      }
      return undefined;
    }

    // Reuse: return the first stored ID that still exists (`session.get`).
    // A stored ID that is gone (404) is not replaced by a title match (D5).
    // On timeout or another error the candidate is skipped, so a hanging
    // service does not block the spawn; the spawn proceeds without reuse.
    for (const openCodeSessionId of [...new Set(candidateIds)]) {
      try {
        const existing = await getOpenCodeSession(openCodeSessionId, OPENCODE_DISCOVERY_TIMEOUT_MS);
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
  ): Promise<{
    num: number;
    sessionId: string;
    tmuxName: string | undefined;
  }> {
    const usedNumbers = new Set<number>();
    for (const sessionName of [
      ...listMetadata(sessionsDir),
      ...listArchivedSessionIds(sessionsDir),
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

      if (!usedNumbers.has(num) && reserveSessionId(sessionsDir, sessionId)) {
        return { num, sessionId, tmuxName };
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
  ): { num: number; sessionId: string; tmuxName: string | undefined } {
    const orchestratorPrefix = `${project.sessionPrefix}-orchestrator`;
    const usedNumbers = new Set<number>();

    const orchestratorPattern = new RegExp(`^${escapeRegex(orchestratorPrefix)}-(\\d+)$`);
    for (const sessionName of [
      ...listMetadata(sessionsDir),
      ...listArchivedSessionIds(sessionsDir),
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
        if (reserveSessionId(sessionsDir, sessionId)) {
          return { num, sessionId, tmuxName };
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
    // C-04: a worker spawned with --model keeps it via the persisted
    // `model=` metadata key. It wins over the config (spawnModelOverride is
    // first in the worker rule). Orchestrators never persist a model
    // (OrchestratorSpawnConfig has no model), and the orchestrator rule has
    // no spawn override, so a stray `model=` key is ignored for them.
    const persistedModel = metadata["model"];
    return resolveAgentSelection({
      role,
      project,
      defaults: config.defaults,
      persistedAgent: metadata["agent"],
      ...(role === "worker" && typeof persistedModel === "string" && persistedModel.length > 0
        ? { spawnModelOverride: persistedModel }
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
    const { sessionId, tmuxName } = await reserveNextSessionIdentity(project, sessionsDir);

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
    if (plugins.workspace) {
      try {
        const wsInfo = await plugins.workspace.create({
          projectId: spawnConfig.projectId,
          project,
          sessionId,
          branch,
        });
        workspacePath = wsInfo.path;

        // Run post-create hooks — clean up workspace on failure
        if (plugins.workspace.postCreate) {
          try {
            await plugins.workspace.postCreate(wsInfo, project);
          } catch (err) {
            if (shouldDestroyWorkspacePath(project, spawnConfig.projectId, workspacePath)) {
              try {
                await plugins.workspace.destroy(workspacePath);
              } catch {
                /* best effort */
              }
            }
            throw err;
          }
        }
      } catch (err) {
        // Clean up reserved session ID on workspace failure
        try {
          deleteMetadata(sessionsDir, sessionId, false);
        } catch {
          /* best effort */
        }
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

    // Get agent launch config and create runtime — clean up workspace on failure
    const opencodeIssueSessionStrategy = project.opencodeIssueSessionStrategy ?? "reuse";
    const reusedOpenCodeSessionId =
      plugins.agent.name === "opencode" && spawnConfig.issueId
        ? await resolveOpenCodeSessionReuse({
            sessionsDir,
            project,
            criteria: { issueId: spawnConfig.issueId },
            strategy: opencodeIssueSessionStrategy,
          })
        : undefined;
    const agentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
        },
      },
      issueId: spawnConfig.issueId,
      prompt: composedPrompt,
      permissions: selection.permissions,
      model: selection.model,
      subagent: spawnConfig.subagent ?? selection.subagent,
    };

    let launchLock: OpenCodeLaunchLock | undefined;
    let launchStartedAt = 0;
    let handle: RuntimeHandle;
    try {
      const launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
      const environment = plugins.agent.getEnvironment(agentLaunchConfig);
      if (plugins.agent.name === "opencode" && !reusedOpenCodeSessionId) {
        launchLock = await acquireOpenCodeLaunchLock(workspacePath, `AO:${sessionId}`);
        launchStartedAt = await launchLock.start();
      }

      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId, // Use tmux name for runtime if available
        workspacePath,
        launchCommand,
        environment: {
          ...environment,
          AO_SESSION: sessionId,
          AO_DATA_DIR: sessionsDir, // Pass sessions directory (not root dataDir)
          AO_SESSION_NAME: sessionId, // User-facing session name
          ...(tmuxName && { AO_TMUX_NAME: tmuxName }), // Tmux session name if using new arch
          AO_CALLER_TYPE: "agent",
          AO_PROJECT_ID: spawnConfig.projectId,
          AO_CONFIG_PATH: config.configPath,
          AO_STATE_ROOT: getStateRoot(),
        },
      });
    } catch (err) {
      await recordFailedOpenCodeLaunch(
        launchLock,
        { id: tmuxName ?? sessionId, runtimeName: plugins.runtime.name, data: {} },
        err,
      );
      // Clean up workspace and reserved ID if agent config or runtime creation failed
      if (
        plugins.workspace &&
        shouldDestroyWorkspacePath(project, spawnConfig.projectId, workspacePath)
      ) {
        try {
          await plugins.workspace.destroy(workspacePath);
        } catch {
          /* best effort */
        }
      }
      try {
        // A marker keeps this number reserved so the next worker gets a different key.
        if (launchLock?.pending) updateMetadata(sessionsDir, sessionId, { status: "killed" });
        deleteMetadata(sessionsDir, sessionId, launchLock?.pending ?? false);
      } catch {
        /* best effort */
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
      metadata: {
        ...(reusedOpenCodeSessionId ? { opencodeSessionId: reusedOpenCodeSessionId } : {}),
      },
    };

    let setupFailed = false;
    try {
      await launchLock?.recordRuntime(handle);
      // C-04: persist the spawn --model override so later operations
      // (restore, send's restore-for-delivery) reuse it before the config.
      // Only `ao spawn` supplies a model (batch-spawn has no --model flag).
      writeMetadata(sessionsDir, sessionId, {
        worktree: workspacePath,
        branch,
        status: "spawning",
        tmuxName, // Store tmux name for mapping
        issue: spawnConfig.issueId,
        project: spawnConfig.projectId,
        agent: selection.agentName, // Persist agent name for lifecycle manager
        model:
          typeof spawnConfig.model === "string" && spawnConfig.model.length > 0
            ? spawnConfig.model
            : undefined,
        createdAt: new Date().toISOString(),
        runtimeHandle: JSON.stringify(handle),
        opencodeSessionId: reusedOpenCodeSessionId,
      });

      if (plugins.agent.postLaunchSetup) {
        await plugins.agent.postLaunchSetup(session);
      }

      if (plugins.agent.name === "opencode" && !session.metadata["opencodeSessionId"]) {
        // Row 23 (until I-3): wait for the pane to create this session's
        // OpenCode session and store its ID, for every issue strategy (the
        // strategy decides about older sessions, not about this one). Never
        // throws: when the wait ends without one match, the spawn succeeds
        // without a mapping and the operator gets the `ao session remap` line.
        const discovered = await discoverNewOpenCodeSession(
          sessionId,
          workspacePath,
          launchStartedAt,
          launchLock?.recoveryHint ?? "",
        );
        if (discovered) {
          session.metadata["opencodeSessionId"] = discovered;
        }
      }

      if (Object.keys(session.metadata || {}).length > 0) {
        updateMetadata(sessionsDir, sessionId, session.metadata);
      }
      if (session.metadata["opencodeSessionId"]) launchLock?.complete();
    } catch (err) {
      setupFailed = true;
      // Clean up runtime and workspace on post-launch failure
      try {
        await plugins.runtime.destroy(handle);
      } catch {
        /* best effort */
      }
      if (
        plugins.workspace &&
        shouldDestroyWorkspacePath(project, spawnConfig.projectId, workspacePath)
      ) {
        try {
          await plugins.workspace.destroy(workspacePath);
        } catch {
          /* best effort */
        }
      }
      try {
        // A marker keeps this number reserved so the next worker gets a different key.
        if (launchLock?.pending) updateMetadata(sessionsDir, sessionId, { status: "killed" });
        deleteMetadata(sessionsDir, sessionId, launchLock?.pending ?? false);
      } catch {
        /* best effort */
      }
      throw err;
    } finally {
      releaseOpenCodeLaunchLock(launchLock, setupFailed);
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
    } else if (agentLaunchConfig.prompt) {
      session.metadata["promptDelivered"] = "true";
    }

    if (session.metadata["promptDelivered"]) {
      updateMetadata(sessionsDir, sessionId, session.metadata);
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
      const existingOrchestrator = existingRaw?.["runtimeHandle"]
        ? metadataToSession(sessionId, existingRaw, orchestratorConfig.projectId)
        : null;
      if (existingOrchestrator?.runtimeHandle) {
        const existingAlive = await plugins.runtime
          .isAlive(existingOrchestrator.runtimeHandle)
          .catch(() => false);
        if (
          existingAlive &&
          (orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore")
        ) {
          const persistedRaw = readMetadataRaw(sessionsDir, sessionId);
          if (persistedRaw?.["runtimeHandle"]) {
            const persisted = metadataToSession(
              sessionId,
              persistedRaw,
              orchestratorConfig.projectId,
            );
            persisted.metadata["orchestratorSessionReused"] = "true";
            return persisted;
          }
          await plugins.runtime.destroy(existingOrchestrator.runtimeHandle).catch(() => undefined);
          deleteMetadata(sessionsDir, sessionId, false);
        } else if (existingAlive) {
          await plugins.runtime.destroy(existingOrchestrator.runtimeHandle).catch(() => undefined);
          deleteMetadata(sessionsDir, sessionId, false);
        } else {
          deleteMetadata(
            sessionsDir,
            sessionId,
            orchestratorSessionStrategy === "reuse" || orchestratorSessionStrategy === "ignore",
          );
        }
      }

      let reserved = reserveSessionId(sessionsDir, sessionId);
      if (!reserved) {
        const concurrentRaw = readMetadataRaw(sessionsDir, sessionId);
        const concurrentSession = concurrentRaw?.["runtimeHandle"]
          ? metadataToSession(sessionId, concurrentRaw, orchestratorConfig.projectId)
          : null;
        if (concurrentSession?.runtimeHandle) {
          const concurrentAlive = await plugins.runtime
            .isAlive(concurrentSession.runtimeHandle)
            .catch(() => false);
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
            );
            reserved = reserveSessionId(sessionsDir, sessionId);
          }
        } else {
          reserved = reserveSessionId(sessionsDir, sessionId);
        }
        if (!reserved) {
          throw new Error(`Session ${sessionId} already exists but is not in a reusable state`);
        }
      }
    } else {
      // Reserve a new unique orchestrator identity (e.g. {prefix}-orchestrator-1, -2, …).
      // Each isolated orchestrator gets its own numbered session and workspace.
      const identity = reserveNextOrchestratorIdentity(project, sessionsDir);
      sessionId = identity.sessionId;
      tmuxName = identity.tmuxName;
      branch = `orchestrator/${sessionId}`;

      if (!plugins.workspace) {
        try {
          deleteMetadata(sessionsDir, sessionId, false);
        } catch {
          /* best effort */
        }
        throw new Error(
          `spawnOrchestrator requires a workspace plugin but none is configured for project '${orchestratorConfig.projectId}'`,
        );
      }

      try {
        const wsInfo = await plugins.workspace.create({
          projectId: orchestratorConfig.projectId,
          project,
          sessionId,
          branch,
        });
        workspacePath = wsInfo.path;
      } catch (err) {
        try {
          deleteMetadata(sessionsDir, sessionId, false);
        } catch {
          /* best effort */
        }
        throw err;
      }

      try {
        if (plugins.agent.setupWorkspaceHooks) {
          await plugins.agent.setupWorkspaceHooks(workspacePath, { dataDir: sessionsDir });
        }
      } catch (err) {
        try {
          await plugins.workspace.destroy(workspacePath);
        } catch {
          /* best effort */
        }
        try {
          deleteMetadata(sessionsDir, sessionId, false);
        } catch {
          /* best effort */
        }
        throw err;
      }
    }

    const cleanupOrchestratorMetadataAndWorkspace = async (promptFile?: string): Promise<void> => {
      if (orchestratorWorkspaceMode === "isolated" && plugins.workspace) {
        try {
          await plugins.workspace.destroy(workspacePath);
        } catch {
          /* best effort */
        }
      }
      try {
        deleteMetadata(sessionsDir, sessionId, false);
      } catch {
        /* best effort */
      }
      if (promptFile) {
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
        await cleanupOrchestratorMetadataAndWorkspace(systemPromptFile);
        throw err;
      }
    }

    let reusableOpenCodeSessionId: string | undefined;
    try {
      reusableOpenCodeSessionId =
        plugins.agent.name === "opencode" && orchestratorSessionStrategy === "reuse"
          ? await resolveOpenCodeSessionReuse({
              sessionsDir,
              project,
              criteria: { sessionId },
              strategy: "reuse",
            })
          : undefined;
      if (plugins.agent.name === "opencode" && orchestratorSessionStrategy === "delete") {
        await resolveOpenCodeSessionReuse({
          sessionsDir,
          project,
          criteria: { sessionId },
          strategy: "delete",
        });
      }
    } catch (err) {
      await cleanupOrchestratorMetadataAndWorkspace(systemPromptFile);
      throw err;
    }

    // Get agent launch config — uses systemPromptFile, no issue/tracker interaction.
    // Orchestrator ALWAYS gets permissionless mode — it must run ao CLI commands autonomously.
    const agentLaunchConfig = {
      sessionId,
      projectConfig: {
        ...project,
        agentConfig: {
          ...selection.agentConfig,
          permissions: "permissionless" as const,
          ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
        },
      },
      permissions: "permissionless" as const,
      model: selection.model,
      systemPromptFile,
      subagent: selection.subagent,
    };

    // An agent can refuse the launch (for example an unsupported binary version).
    // Clean up like any later failure, so a refused orchestrator spawn leaves no
    // worktree, reserved metadata or prompt file behind.
    let launchCommand: string;
    let environment: Record<string, string>;
    try {
      launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
      environment = plugins.agent.getEnvironment(agentLaunchConfig);
    } catch (err) {
      await cleanupOrchestratorMetadataAndWorkspace(systemPromptFile);
      throw err;
    }

    let launchLock: OpenCodeLaunchLock | undefined;
    let launchStartedAt = 0;

    // Serialize before recording time: another fleet can share this title and
    // directory. A previous unresolved launch refuses before any new pane.
    let handle: RuntimeHandle;
    try {
      if (plugins.agent.name === "opencode" && !reusableOpenCodeSessionId) {
        launchLock = await acquireOpenCodeLaunchLock(workspacePath, `AO:${sessionId}`);
        launchStartedAt = await launchLock.start();
      }
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
          AO_CALLER_TYPE: "orchestrator",
          AO_PROJECT_ID: orchestratorConfig.projectId,
          AO_CONFIG_PATH: config.configPath,
          AO_STATE_ROOT: getStateRoot(),
        },
      });
    } catch (err) {
      await recordFailedOpenCodeLaunch(
        launchLock,
        { id: tmuxName ?? sessionId, runtimeName: plugins.runtime.name, data: {} },
        err,
      );
      await cleanupOrchestratorMetadataAndWorkspace(systemPromptFile);
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
      metadata: {
        ...(reusableOpenCodeSessionId ? { opencodeSessionId: reusableOpenCodeSessionId } : {}),
      },
    };

    let setupFailed = false;
    try {
      await launchLock?.recordRuntime(handle);
      writeMetadata(sessionsDir, sessionId, {
        worktree: workspacePath,
        branch,
        status: "working",
        role: "orchestrator",
        tmuxName,
        project: orchestratorConfig.projectId,
        agent: selection.agentName,
        createdAt: new Date().toISOString(),
        runtimeHandle: JSON.stringify(handle),
        opencodeSessionId: reusableOpenCodeSessionId,
      });

      if (plugins.agent.postLaunchSetup) {
        await plugins.agent.postLaunchSetup(session);
      }

      if (plugins.agent.name === "opencode" && !session.metadata["opencodeSessionId"]) {
        // Row 23 (until I-3): the same wait as a worker spawn, for every
        // orchestrator strategy. Never throws; see `discoverNewOpenCodeSession`.
        const discovered = await discoverNewOpenCodeSession(
          sessionId,
          workspacePath,
          launchStartedAt,
          launchLock?.recoveryHint ?? "",
        );
        if (discovered) {
          session.metadata["opencodeSessionId"] = discovered;
        }
      }

      if (Object.keys(session.metadata || {}).length > 0) {
        updateMetadata(sessionsDir, sessionId, session.metadata);
      }
      if (session.metadata["opencodeSessionId"]) launchLock?.complete();
    } catch (err) {
      setupFailed = true;
      // Clean up runtime on post-launch failure
      try {
        await plugins.runtime.destroy(handle);
      } catch {
        /* best effort */
      }
      await cleanupOrchestratorMetadataAndWorkspace(systemPromptFile);
      throw err;
    } finally {
      releaseOpenCodeLaunchLock(launchLock, setupFailed);
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
    const { raw, sessionsDir, project, projectId } = requireSessionRecord(sessionId);

    const cleanupAgent = resolveSelectionForSession(project, sessionId, raw).agentName;

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
          try {
            await runtimePlugin.destroy(handle);
          } catch {
            // Runtime might already be gone
          }
        }
      }
    }

    const worktree = raw["worktree"];
    if (worktree && shouldDestroyWorkspacePath(project, projectId, worktree)) {
      const workspacePlugin = project
        ? resolvePlugins(project).workspace
        : registry.get<Workspace>("workspace", config.defaults.workspace);
      if (workspacePlugin) {
        try {
          await workspacePlugin.destroy(worktree);
        } catch {
          // Workspace might already be gone
        }
      }
    }

    let didPurgeOpenCodeSession = false;
    if (options?.purgeOpenCode === true && cleanupAgent === "opencode") {
      // Row 20: `session.interrupt`, then `session.remove`, by the stored ID
      // only (no title discovery). A failure still archives the AO session
      // without `opencodeCleanedAt`, so `ao session cleanup` retries the
      // removal; the operator gets one line that says so (m-5).
      const mappedOpenCodeSessionId = asValidOpenCodeSessionId(raw["opencodeSessionId"]);
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
        try {
          await interruptThenRemoveOpenCodeSession(mappedOpenCodeSessionId);
          didPurgeOpenCodeSession = true;
        } catch (err) {
          warnOperator(
            `ao: could not remove OpenCode session ${mappedOpenCodeSessionId} of ${sessionId} (${shortErrorText(err)}); \`ao session cleanup\` retries the removal.`,
          );
        }
      }
    }

    // Archive metadata
    deleteMetadata(sessionsDir, sessionId, true);
    if (didPurgeOpenCodeSession) {
      markArchivedOpenCodeCleanup(sessionsDir, sessionId);
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
          try {
            const alive = await plugins.runtime.isAlive(session.runtimeHandle);
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
          } catch {
            // Can't check — skip
          }
        }

        if (shouldKill) {
          if (!options?.dryRun) {
            await kill(session.id, { purgeOpenCode: shouldPurgeOpenCode });
          }
          pushKilled(session.projectId, session.id);
        } else {
          pushSkipped(session.projectId, session.id);
        }
      } catch (err) {
        result.errors.push({
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
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
          pushSkipped(projectKey, archivedId);
          continue;
        }
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
            try {
              await deleteOpenCodeSession(mappedOpenCodeSessionId);
              markArchivedOpenCodeCleanup(sessionsDir, archivedId);
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
    const { raw, project } = requireSessionRecord(sessionId);

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

    let prepared = await prepareSession();

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

    const conflictingSessions = new Set<SessionId>();
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
        conflictingSessions.add(sessionName);
      }
    }

    const takenOverFrom = [...conflictingSessions];

    const workspacePath = raw["worktree"];
    if (!workspacePath) {
      throw new Error(`Session ${sessionId} has no workspace to check out PR #${pr.number}`);
    }

    const branchChanged = await scm.checkoutPR(pr, workspacePath);

    updateMetadata(sessionsDir, sessionId, {
      pr: pr.url,
      status: "pr_open",
      branch: pr.branch,
      prAutoDetect: "",
    });

    for (const previousSessionId of takenOverFrom) {
      const previousRaw = readMetadataRaw(sessionsDir, previousSessionId);
      if (!previousRaw) continue;

      updateMetadata(sessionsDir, previousSessionId, {
        pr: "",
        prAutoDetect: "off",
        ...(PR_TRACKING_STATUSES.has(previousRaw["status"] ?? "") ? { status: "working" } : {}),
      });
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

    if (active) {
      updateMetadata(sessionsDir, sessionId, { opencodeSessionId: candidate.id });
    } else {
      // An archive purged earlier carries `opencodeCleanedAt`, and `cleanup`
      // skips such a record; clear it so the new ID is removed in its turn.
      updateArchivedMetadata(sessionsDir, sessionId, {
        opencodeSessionId: candidate.id,
        opencodeCleanedAt: "",
      });
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
      const restoreCmd = await plugins.agent.getRestoreCommand(session, project, selection.model);
      launchCommand = restoreCmd ?? plugins.agent.getLaunchCommand(agentLaunchConfig);
    } else {
      launchCommand = plugins.agent.getLaunchCommand(agentLaunchConfig);
    }

    const environment = plugins.agent.getEnvironment(agentLaunchConfig);

    if (fromArchive) {
      // C-04: keep the persisted spawn model when copying the archive back.
      writeMetadata(sessionsDir, sessionId, {
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
        createdAt: raw["createdAt"],
        runtimeHandle: raw["runtimeHandle"],
        opencodeSessionId: raw["opencodeSessionId"],
        pinnedSummary: raw["pinnedSummary"],
      });
    }

    // 6. Check workspace
    const workspaceExists = plugins.workspace?.exists
      ? await plugins.workspace.exists(workspacePath)
      : existsSync(workspacePath);

    if (!workspaceExists) {
      // Try to restore workspace if plugin supports it
      if (!plugins.workspace?.restore) {
        throw new WorkspaceMissingError(workspacePath, "workspace plugin does not support restore");
      }
      if (!session.branch) {
        throw new WorkspaceMissingError(workspacePath, "branch metadata is missing");
      }
      try {
        const wsInfo = await plugins.workspace.restore(
          {
            projectId,
            project,
            sessionId,
            branch: session.branch,
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
    }

    // 7. Destroy old runtime if still alive (e.g. tmux session survives agent crash)
    if (session.runtimeHandle) {
      try {
        await plugins.runtime.destroy(session.runtimeHandle);
      } catch {
        // Best effort — may already be gone
      }
    }

    // 8. Create runtime (reuse tmuxName from metadata)
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

    // 9. Update metadata — merge updates, preserving existing fields
    const now = new Date().toISOString();
    updateMetadata(sessionsDir, sessionId, {
      status: "spawning",
      runtimeHandle: JSON.stringify(handle),
      restoredAt: now,
    });

    // 10. Run postLaunchSetup (non-fatal)
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
          updateMetadata(sessionsDir, sessionId, metadataUpdates);
        }
      } catch {
        // Non-fatal — session is already running
      }
    }

    return restoredSession;
  }

  return { spawn, spawnOrchestrator, restore, list, get, kill, cleanup, send, claimPR, remap };
}
