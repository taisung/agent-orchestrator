/**
 * Lifecycle Manager — state machine + polling loop + reaction engine.
 *
 * Periodically polls all sessions and:
 * 1. Detects state transitions (spawning → working → pr_open → etc.)
 * 2. Emits events on transitions
 * 3. Triggers reactions (auto-handle CI failures, review comments, etc.)
 * 4. Escalates to human notification when auto-handling fails
 *
 * Reference: scripts/claude-session-status, scripts/claude-review-check
 */

import { randomUUID } from "node:crypto";
import {
  SESSION_STATUS,
  PR_STATE,
  CI_STATUS,
  TERMINAL_STATUSES,
  LAUNCH_GRACE_MS,
  AMBIGUOUS_NEGATIVE_BOUND_MS,
  NO_SERVER_BOUND_MS,
  RUNTIME_NO_SERVER_ERROR_CODE,
  type LifecycleManager,
  type SessionManager,
  type SessionId,
  type SessionStatus,
  type EventType,
  type OrchestratorEvent,
  type OrchestratorConfig,
  type ReactionConfig,
  type ReactionResult,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
  type Agent,
  type SCM,
  type Notifier,
  type Session,
  type EventPriority,
  type ProjectConfig,
  type PREnrichmentData,
  type CICheck,
} from "./types.js";
import { GENERATION_KEY, launchIdentity, updateMetadataIf } from "./metadata.js";
import { validateStatus } from "./utils/validation.js";
import { prIdentityKey } from "./utils/pr.js";
import { getSessionsDir } from "./paths.js";
import { createCorrelationId, createProjectObserver } from "./observability.js";
import { resolveNotifierTarget } from "./notifier-resolution.js";
import { resolveAgentSelection, resolveSessionRole } from "./agent-selection.js";

/** Parse a duration string like "10m", "30s", "1h" to milliseconds. */
function parseDuration(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 3_600_000;
    default:
      return 0;
  }
}

/** Infer a reasonable priority from event type. */
function inferPriority(type: EventType): EventPriority {
  if (type.includes("stuck") || type.includes("needs_input") || type.includes("errored")) {
    return "urgent";
  }
  if (type.startsWith("summary.")) {
    return "info";
  }
  if (
    type.includes("approved") ||
    type.includes("ready") ||
    type.includes("merged") ||
    type.includes("completed")
  ) {
    return "action";
  }
  if (type.includes("fail") || type.includes("changes_requested") || type.includes("conflicts")) {
    return "warning";
  }
  return "info";
}

/** Create an OrchestratorEvent with defaults filled in. */
function createEvent(
  type: EventType,
  opts: {
    sessionId: SessionId;
    projectId: string;
    message: string;
    priority?: EventPriority;
    data?: Record<string, unknown>;
  },
): OrchestratorEvent {
  return {
    id: randomUUID(),
    type,
    priority: opts.priority ?? inferPriority(type),
    sessionId: opts.sessionId,
    projectId: opts.projectId,
    timestamp: new Date(),
    message: opts.message,
    data: opts.data ?? {},
  };
}

/** Determine which event type corresponds to a status transition. */
function statusToEventType(_from: SessionStatus | undefined, to: SessionStatus): EventType | null {
  switch (to) {
    case "working":
      return "session.working";
    case "pr_open":
      return "pr.created";
    case "ci_failed":
      return "ci.failing";
    case "review_pending":
      return "review.pending";
    case "changes_requested":
      return "review.changes_requested";
    case "approved":
      return "review.approved";
    case "mergeable":
      return "merge.ready";
    case "merged":
      return "merge.completed";
    case "needs_input":
      return "session.needs_input";
    case "stuck":
      return "session.stuck";
    case "errored":
      return "session.errored";
    case "killed":
      return "session.killed";
    default:
      return null;
  }
}

/** Map event type to reaction config key. */
function eventToReactionKey(eventType: EventType): string | null {
  switch (eventType) {
    case "ci.failing":
      return "ci-failed";
    case "review.changes_requested":
      return "changes-requested";
    case "automated_review.found":
      return "bugbot-comments";
    case "merge.conflicts":
      return "merge-conflicts";
    case "merge.ready":
      return "approved-and-green";
    case "session.stuck":
      return "agent-stuck";
    case "session.needs_input":
      return "agent-needs-input";
    case "session.killed":
      return "agent-exited";
    case "summary.all_complete":
      return "all-complete";
    default:
      return null;
  }
}

function transitionLogLevel(status: SessionStatus): "info" | "warn" | "error" {
  const eventType = statusToEventType(undefined, status);
  if (!eventType) {
    return "info";
  }
  const priority = inferPriority(eventType);
  if (priority === "urgent") {
    return "error";
  }
  if (priority === "warning") {
    return "warn";
  }
  return "info";
}

/** Why a session was persisted as killed (the record's `killedReason`). */
type KilledReason = "runtime" | "agent-exited" | "pr-closed";

/** determineStatus result: this poll has no evidence to change the status. */
const KEEP_STATUS = Symbol("keep-status");

/**
 * What the liveness probes of one session said in a poll:
 * - "alive": the runtime answered that the session exists.
 * - "gone": an authoritative negative: an authoritative runtime answered that
 *   the session does not exist, or an authoritative agent found no agent
 *   process after the launch grace (see AUTHORITATIVE_RUNTIMES).
 * - "ambiguous": a negative from a plugin that also answers it on an error.
 * - "no-server": the runtime reported that no server runs at all.
 * - "failed": a probe could not run (any other rejection, a thrown agent
 *   check, also after the runtime answered alive).
 * Unset when no probe gave an answer (no stored handle, a killed record, an
 * agent within the launch grace).
 */
type ProbeOutcome = "alive" | "gone" | "ambiguous" | "no-server" | "failed";

/** What determineStatus learned from the liveness probes of one session. */
interface ProbeResult {
  outcome?: ProbeOutcome;
  killedReason?: KilledReason;
}

/**
 * The runtimes and agents whose negative answer is authoritative: they answer
 * false only when the check ran and found nothing, and reject when it could
 * not run (CLAUDE.md, the `isProcessRunning` rule). An agent's answer counts
 * as authoritative only on an authoritative runtime: claude-code reads Herdr
 * panes through core `herdr.ts`, which answers "no process" on an error.
 * codex, gemini and opencode `isProcessRunning` still answer false on an
 * error, so their negatives are "ambiguous". runtime-herdr `isAlive` answers
 * false only for `pane_not_found` or a pane with another terminal, and
 * rejects when it cannot answer (Herdr fit-1). Herdr stays non-authoritative
 * all the same: a herdr server can run where the selected endpoint does not
 * reach it, so its negative does not prove that the session ended (Herdr
 * fit-2, design r11 5.6).
 */
const AUTHORITATIVE_RUNTIMES: ReadonlySet<string> = new Set(["tmux"]);
const AUTHORITATIVE_AGENTS: ReadonlySet<string> = new Set(["claude-code"]);

/** A rejection of Runtime.isAlive that reports that no runtime server runs. */
function isNoServerRejection(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === RUNTIME_NO_SERVER_ERROR_CODE
  );
}

/**
 * Consecutive negative polls of one launch of a session in this worker.
 * "negative": "gone" or "ambiguous" answers (C1, and the C2 bound).
 * "no-server": the runtime reported no server (the NO_SERVER_BOUND_MS rule).
 * `firstAt` is the clock of the first poll of the run. `launch` (M-1, round
 * 4) is the launch key of the record in that poll; a poll of another launch
 * of the same session ID starts a new run.
 */
interface NegativeStreak {
  kind: "negative" | "no-server";
  firstAt: number;
  polls: number;
  launch: string;
}

/**
 * M-1 (round 4): the launch of a record as one key: its launch identity
 * (`launchIdentity`: reservation ID, `runtimeHandle`, `tmuxName`,
 * `createdAt`, `restoredAt`). A spawn, a restore or a new reservation of the
 * session ID changes it; a status, PR or bookkeeping write (reactions,
 * dispatch hashes, `generation`) does not.
 */
function launchKeyOf(metadata: Readonly<Record<string, string>>): string {
  return JSON.stringify(launchIdentity(metadata));
}

/**
 * The version of a record that a poll read, for a write that any other Node
 * write must cancel: its generation plus its launch identity (round 5, B-2).
 * The active records of an ID never repeat a generation (an archived copy has
 * its own series; this compare reads the active record), so the generation
 * alone tells versions apart among active records of this build. The launch
 * identity also rejects a new
 * launch whose record has no generation (an earlier build wrote it).
 */
function readVersionOf(metadata: Readonly<Record<string, string>>): Record<string, string> {
  return { [GENERATION_KEY]: metadata[GENERATION_KEY] ?? "", ...launchIdentity(metadata) };
}

/** The status that this worker last saw for one launch of a session. */
interface TrackedStatus {
  status: SessionStatus;
  launch: string;
}

/** What the probes of one poll say about the probes themselves. */
interface ProbeOutage {
  /**
   * C2: two or more sessions were probed and none answered alive. An
   * "ambiguous" negative is then not persisted until the same session gave
   * such answers for AMBIGUOUS_NEGATIVE_BOUND_MS. A "gone" answer is never
   * held back.
   */
  holdAmbiguous: boolean;
  /** The worker health is `warn` for this poll. */
  warn: boolean;
  reason?: string;
  outcomes: Record<SessionId, ProbeOutcome>;
}

/** No probe outage (a single-session check). */
const NO_OUTAGE: ProbeOutage = { holdAmbiguous: false, warn: false, outcomes: {} };

/** One session's status decision in a poll, before anything is persisted. */
interface StatusEvaluation {
  session: Session;
  oldStatus: SessionStatus;
  newStatus: SessionStatus;
  probe: ProbeResult;
}

/**
 * A killed record that the poll re-checks: the kill came from a liveness probe,
 * or it predates `killedReason` and has no PR (a PR-driven kill always has one).
 */
function isRecoverableKill(metadata: Record<string, string>): boolean {
  if (metadata["status"] !== SESSION_STATUS.KILLED) return false;
  const reason = metadata["killedReason"];
  if (reason === "runtime" || reason === "agent-exited") return true;
  return !reason && !metadata["pr"];
}

/** The record's last launch: a valid `restoredAt`, else `createdAt`; NaN when neither parses. */
function launchedAt(metadata: Record<string, string>): number {
  const restoredAt = Date.parse(metadata["restoredAt"] ?? "");
  return Number.isFinite(restoredAt) ? restoredAt : Date.parse(metadata["createdAt"] ?? "");
}

/**
 * True while the record's last launch or restore is younger than
 * LAUNCH_GRACE_MS. A launch time in the future (a clock that went back, a
 * wrong value) gives no grace, so no value can extend it.
 */
function isWithinLaunchGrace(metadata: Record<string, string>, now: number): boolean {
  const at = launchedAt(metadata);
  return Number.isFinite(at) && at <= now && now - at < LAUNCH_GRACE_MS;
}

/** Tolerance of the C3 identity check: see isSameLaunch. */
const LAUNCH_IDENTITY_BEFORE_MS = 15_000;
const LAUNCH_IDENTITY_AFTER_MS = 1_000;

/**
 * C3 identity: true when the live tmux session is the one that the stored
 * handle launched. runtime-tmux writes `createdAt` (ms) into the handle after
 * its `new-session` and launch keys, and its getMetrics reports the age of
 * the tmux session (`#{session_created}`, whole seconds). The tmux session
 * must be created at most 15 s before and at most 1 s after the stored time;
 * a new session under the old name is younger and fails. A handle without
 * `createdAt`, no getMetrics, or a failed report gives false. A non-tmux
 * runtime gives true: runtime-herdr `isAlive` already refuses a pane whose
 * terminal ID differs from the stored one.
 */
async function isSameLaunch(runtime: Runtime, handle: RuntimeHandle): Promise<boolean> {
  if (runtime.name !== "tmux") return true;
  const stored = handle.data["createdAt"];
  if (typeof stored !== "number" || !Number.isFinite(stored) || !runtime.getMetrics) return false;
  const metrics = await runtime.getMetrics(handle).catch(() => null);
  if (!metrics || !Number.isFinite(metrics.uptimeMs)) return false;
  const lag = stored - (Date.now() - metrics.uptimeMs);
  return lag >= -LAUNCH_IDENTITY_AFTER_MS && lag <= LAUNCH_IDENTITY_BEFORE_MS;
}

export interface LifecycleManagerDeps {
  config: OrchestratorConfig;
  registry: PluginRegistry;
  sessionManager: SessionManager;
  /** When set, only poll sessions belonging to this project. */
  projectId?: string;
}

/** Track attempt counts for reactions per session. */
interface ReactionTracker {
  attempts: number;
  firstTriggered: Date;
}

/** Create a LifecycleManager instance. */
export function createLifecycleManager(deps: LifecycleManagerDeps): LifecycleManager {
  const { config, registry, sessionManager, projectId: scopedProjectId } = deps;
  const observer = createProjectObserver(config, "lifecycle-manager");

  /**
   * The status that this worker last saw for each session, with its launch
   * (M-1, round 4): a tracked status of another launch of the same session
   * ID does not count (see trackedStatus).
   */
  const states = new Map<SessionId, TrackedStatus>();
  /**
   * C1 and the bounds: the current run of negative polls of each session and
   * launch. A second negative poll in a row persists killed (C1), except for
   * the bounded cases (see decideStatus). In memory only: a restarted worker
   * needs two negative polls again.
   */
  const negativeStreaks = new Map<SessionId, NegativeStreak>();

  /** The tracked status of this launch of the session; undefined for another launch. */
  function trackedStatus(session: Session): SessionStatus | undefined {
    const tracked = states.get(session.id);
    return tracked && tracked.launch === launchKeyOf(session.metadata) ? tracked.status : undefined;
  }

  function trackStatus(session: Session, status: SessionStatus): void {
    states.set(session.id, { status, launch: launchKeyOf(session.metadata) });
  }
  const reactionTrackers = new Map<string, ReactionTracker>(); // "sessionId:reactionKey"
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false; // re-entrancy guard
  let allCompleteEmitted = false; // guard against repeated all_complete

  /**
   * Cache for PR enrichment data within a single poll cycle.
   * Cleared at the start of each pollAll() call.
   * Key format: "${owner}/${repo}#${number}"
   */
  const prEnrichmentCache = new Map<string, PREnrichmentData>();

  /**
   * Per-session timestamp of last review backlog API check.
   * Used to throttle getPendingComments/getAutomatedComments to at most once per 2 minutes.
   * In-memory only — resets on restart (acceptable since it's a rate-limit hint, not state).
   */
  const lastReviewBacklogCheckAt = new Map<SessionId, number>();

  /** Throttle interval for review backlog API calls (2 minutes). */
  const REVIEW_BACKLOG_THROTTLE_MS = 2 * 60 * 1000;

  /**
   * Populate the PR enrichment cache using batch GraphQL queries.
   * This is called once per poll cycle to fetch data for all PRs efficiently.
   */
  async function populatePREnrichmentCache(sessions: Session[]): Promise<void> {
    // Clear previous cache
    prEnrichmentCache.clear();

    // Collect all unique PRs
    const prs = sessions.map((s) => s.pr).filter((pr): pr is NonNullable<typeof pr> => pr !== null);

    // Deduplicate by stable identity key. Uses prIdentityKey rather than a raw
    // `owner/repo#number` template so PRs whose URL doesn't decompose into
    // owner/repo (e.g. GitLab MRs) fall back to the URL instead of colliding.
    const uniquePRs = Array.from(new Map(prs.map((pr) => [prIdentityKey(pr), pr])).values());

    if (uniquePRs.length === 0) return;

    // Group by SCM plugin and batch fetch for each group
    const prsByPlugin = new Map<string, typeof uniquePRs>();
    for (const pr of uniquePRs) {
      // Find the project for this PR
      const project = Object.values(config.projects).find((p) => {
        const [owner, repo] = p.repo.split("/");
        return owner === pr.owner && repo === pr.repo;
      });
      if (!project?.scm?.plugin) continue;

      const pluginKey = project.scm.plugin;
      if (!prsByPlugin.has(pluginKey)) {
        prsByPlugin.set(pluginKey, []);
      }
      const pluginPRs = prsByPlugin.get(pluginKey);
      if (pluginPRs) {
        pluginPRs.push(pr);
      }
    }

    // Fetch enrichment data for each plugin's PRs
    for (const [pluginKey, pluginPRs] of prsByPlugin) {
      const scm = registry.get<SCM>("scm", pluginKey);
      if (!scm?.enrichSessionsPRBatch) continue;

      const batchStartTime = Date.now();
      try {
        const enrichmentData = await scm.enrichSessionsPRBatch(pluginPRs, {
          recordSuccess(_data) {
            const batchDuration = Date.now() - batchStartTime;
            observer?.recordOperation({
              metric: "graphql_batch",
              operation: "batch_enrichment",
              correlationId: createCorrelationId("graphql-batch"),
              outcome: "success",
              projectId: scopedProjectId,
              durationMs: batchDuration,
              data: {
                plugin: pluginKey,
                prCount: pluginPRs.length,
                prKeys: pluginPRs.map((pr) => `${pr.owner}/${pr.repo}#${pr.number}`),
              },
              level: "info",
            });
          },
          recordFailure(data) {
            const batchDuration = Date.now() - batchStartTime;
            observer?.recordOperation({
              metric: "graphql_batch",
              operation: "batch_enrichment",
              correlationId: createCorrelationId("graphql-batch"),
              outcome: "failure",
              reason: data.error,
              level: "warn",
              data: {
                plugin: pluginKey,
                prCount: pluginPRs.length,
                error: data.error,
                durationMs: batchDuration,
              },
            });
          },
          log(level, message) {
            // Log to stderr for observability
            process.stderr.write(
              JSON.stringify({
                source: "ao-graphql-batch",
                level,
                message,
                plugin: pluginKey,
                timestamp: new Date().toISOString(),
              }) + "\n",
            );
          },
        });

        // Merge into cache
        for (const [key, data] of enrichmentData) {
          prEnrichmentCache.set(key, data);
        }
      } catch (err) {
        // Batch fetch failed - individual calls will still work
        const errorMsg = err instanceof Error ? err.message : String(err);
        const batchCorrelationId = createCorrelationId("batch-enrichment");
        observer?.recordOperation?.({
          metric: "lifecycle_poll",
          operation: "batch_enrichment",
          correlationId: batchCorrelationId,
          outcome: "failure",
          reason: errorMsg,
          level: "warn",
          data: { plugin: pluginKey, prCount: pluginPRs.length },
        });
      }
    }
  }

  /** Check if idle time exceeds the agent-stuck threshold. */
  function isIdleBeyondThreshold(session: Session, idleTimestamp: Date): boolean {
    const stuckReaction = getReactionConfigForSession(session, "agent-stuck");
    const thresholdStr = stuckReaction?.threshold;
    if (typeof thresholdStr !== "string") return false;
    const stuckThresholdMs = parseDuration(thresholdStr);
    if (stuckThresholdMs <= 0) return false;
    const idleMs = Date.now() - idleTimestamp.getTime();
    return idleMs > stuckThresholdMs;
  }

  /** Determine current status for a session by polling plugins. */
  /**
   * Resolve the runtime for a session from its HANDLE, falling back to project
   * config only when the session has none.
   *
   * A session must be driven by the runtime it was created under. Resolving from
   * config instead means that after the project's configured runtime changes, the
   * poll loop probes live sessions with a plugin that knows nothing about them —
   * reporting them killed and reading empty terminal output.
   */
  function runtimeForSession(session: Session, project: ProjectConfig): Runtime | null {
    const name = session.runtimeHandle?.runtimeName ?? project.runtime ?? config.defaults.runtime;
    return registry.get<Runtime>("runtime", name);
  }

  /**
   * C3: probe a recoverable killed record. Working only when the runtime
   * answers alive AND the live session is the one that the record launched
   * (isSameLaunch) AND the agent process runs AND the agent's activity is not
   * "exited" (the signal that gave the kill; without it the two signals of an
   * agent that disagree would move the record between killed and working).
   * Any other answer, including a rejected probe, keeps it killed.
   */
  async function recoverKilledStatus(
    session: Session,
    project: ProjectConfig,
    agent: Agent | null,
  ): Promise<SessionStatus | typeof KEEP_STATUS> {
    const handle = session.runtimeHandle;
    const runtime = handle ? runtimeForSession(session, project) : null;
    if (!handle || !runtime || !agent) return KEEP_STATUS;
    // A rejection is unknown here; unknown never recovers (and never kills).
    const alive = await runtime.isAlive(handle).catch(() => false);
    if (!alive) return KEEP_STATUS;
    // A new session under the old name is not this record's launch.
    if (!(await isSameLaunch(runtime, handle))) return KEEP_STATUS;
    const running = await agent.isProcessRunning(handle).catch(() => false);
    if (!running) return KEEP_STATUS;
    const activity = await agent
      .getActivityState(session, config.readyThresholdMs)
      .catch(() => null);
    return activity?.state === "exited" ? KEEP_STATUS : SESSION_STATUS.WORKING;
  }

  async function determineStatus(
    session: Session,
    probe: ProbeResult,
  ): Promise<SessionStatus | typeof KEEP_STATUS> {
    const project = config.projects[session.projectId];
    if (!project) return session.status;

    // B: probe only a handle that the record stores (the enrichment rule,
    // session-manager ensureHandleAndEnrich). A record without one is a spawn
    // that has not written its handle yet; a handle made from the session ID
    // probes the wrong tmux name and reads as dead.
    if (!session.metadata["runtimeHandle"] && !session.metadata["tmuxName"]?.trim()) {
      return KEEP_STATUS;
    }

    const agentName = resolveAgentSelection({
      role: resolveSessionRole(
        session.id,
        session.metadata,
        project.sessionPrefix,
        Object.values(config.projects).map((p) => p.sessionPrefix),
      ),
      project,
      defaults: config.defaults,
      persistedAgent: session.metadata["agent"],
    }).agentName;
    const agent = registry.get<Agent>("agent", agentName);
    const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;

    if (isRecoverableKill(session.metadata)) {
      return recoverKilledStatus(session, project, agent);
    }

    // Track activity state across steps so stuck detection can run after PR checks
    let detectedIdleTimestamp: Date | null = null;

    // A: a just-launched agent is not visible for a while after its pane
    // starts. While the runtime is not known dead, "exited" keeps the status.
    const inLaunchGrace = isWithinLaunchGrace(session.metadata, Date.now());

    // 1. Check if runtime is alive. A rejected probe is unknown, not dead;
    // "no server" counts as unknown for NO_SERVER_BOUND_MS (decideStatus).
    const runtime = session.runtimeHandle ? runtimeForSession(session, project) : null;
    const runtimeAuthoritative = !!runtime && AUTHORITATIVE_RUNTIMES.has(runtime.name);
    if (session.runtimeHandle && runtime) {
      let alive: boolean | undefined;
      try {
        alive = await runtime.isAlive(session.runtimeHandle);
      } catch (err) {
        probe.outcome = isNoServerRejection(err) ? "no-server" : "failed";
      }
      if (alive === false) {
        probe.outcome = runtimeAuthoritative ? "gone" : "ambiguous";
        probe.killedReason = "runtime";
        return SESSION_STATUS.KILLED;
      }
      if (alive === true) probe.outcome = "alive";
    }
    const agentNegative: ProbeOutcome =
      runtimeAuthoritative && !!agent && AUTHORITATIVE_AGENTS.has(agent.name)
        ? "gone"
        : "ambiguous";
    // Same-ID R2a, the gate (design r2 section 2.7): an agent negative
    // ("exited", or isProcessRunning() false) counts only after a runtime
    // positive. While the runtime probe failed (or no runtime plugin could
    // probe the stored handle), the negative keeps the status and the
    // outcome stays as it is, so a session whose runtime could not be checked
    // is never killed by its agent's answer alone. Agent positives still
    // classify. "no server" skips the agent check below.
    const agentNegativeCounts = probe.outcome === "alive";

    // 2. Check agent activity — prefer JSONL-based detection (runtime-agnostic).
    // With no runtime server there is no pane to read: skip it.
    if (agent && session.runtimeHandle && probe.outcome !== "no-server") {
      try {
        // If the agent implements recordActivity, capture terminal output and record
        // BEFORE calling getActivityState so the JSONL has fresh data to read.
        if (agent.recordActivity && session.workspacePath) {
          try {
            const runtime = runtimeForSession(session, project);
            const terminalOutput = runtime
              ? await runtime.getOutput(session.runtimeHandle, 10)
              : "";
            if (terminalOutput) {
              await agent.recordActivity(session, terminalOutput);
            }
          } catch {
            // Non-fatal — activity recording is best-effort
          }
        }

        // Try JSONL-based activity detection first (reads agent's session files directly)
        const activityState = await agent.getActivityState(session, config.readyThresholdMs);
        if (activityState) {
          if (activityState.state === "waiting_input") return "needs_input";
          if (activityState.state === "exited") {
            if (inLaunchGrace || !agentNegativeCounts) return KEEP_STATUS;
            probe.outcome = agentNegative;
            probe.killedReason = "agent-exited";
            return SESSION_STATUS.KILLED;
          }

          if (
            (activityState.state === "idle" || activityState.state === "blocked") &&
            activityState.timestamp
          ) {
            detectedIdleTimestamp = activityState.timestamp;
          }

          // active/ready/idle (below threshold)/blocked (below threshold) —
          // proceed to PR checks below
        } else {
          // getActivityState returned null — fall back to terminal output parsing
          const runtime = runtimeForSession(session, project);
          const terminalOutput = runtime ? await runtime.getOutput(session.runtimeHandle, 10) : "";
          if (terminalOutput) {
            const activity = agent.detectActivity(terminalOutput);
            if (activity === "waiting_input") return "needs_input";

            const processAlive = await agent.isProcessRunning(session.runtimeHandle);
            if (!processAlive) {
              if (inLaunchGrace || !agentNegativeCounts) return KEEP_STATUS;
              probe.outcome = agentNegative;
              probe.killedReason = "agent-exited";
              return SESSION_STATUS.KILLED;
            }
          }
        }
      } catch {
        // The agent check could not run (a failing `ps`): the session is not
        // confirmed alive, also when its runtime answered alive.
        probe.outcome = "failed";
        // On probe failure, preserve current stuck/needs_input state rather
        // than letting the fallback at the bottom coerce them to "working"
        if (
          session.status === SESSION_STATUS.STUCK ||
          session.status === SESSION_STATUS.NEEDS_INPUT
        ) {
          return session.status;
        }
      }
    }

    // 3. Auto-detect PR by branch if metadata.pr is missing.
    //    This is critical for agents without auto-hook systems (Codex, Aider,
    //    OpenCode) that can't reliably write pr=<url> to metadata on their own.
    //    Skip orchestrator sessions — they sit on the base branch (e.g. master)
    //    and should never own a PR.
    if (
      !session.pr &&
      scm &&
      session.branch &&
      session.metadata["prAutoDetect"] !== "off" &&
      session.metadata["role"] !== "orchestrator" &&
      !session.id.endsWith("-orchestrator")
    ) {
      try {
        const detectedPR = await scm.detectPR(session, project);
        if (detectedPR) {
          session.pr = detectedPR;
          // Persist PR URL so subsequent polls don't need to re-query.
          // Don't write status here — step 4 below will determine the
          // correct status (merged, ci_failed, etc.) on this same cycle.
          // 1.2: only into the record version that this poll read (its
          // generation and, round 5 B-2, its launch).
          const sessionsDir = getSessionsDir(config.configPath, project.path);
          const written = updateMetadataIf(
            sessionsDir,
            session.id,
            readVersionOf(session.metadata),
            { pr: detectedPR.url },
          );
          if (written) session.metadata = written;
        }
      } catch {
        // SCM detection failed — will retry next poll
      }
    }

    // 4. Check PR state if PR exists
    if (session.pr && scm) {
      try {
        // Try to use cached enrichment data from batch GraphQL query
        const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
        const cachedData = prEnrichmentCache.get(prKey);

        if (cachedData) {
          // Use cached enrichment data - avoids individual API calls
          if (cachedData.state === PR_STATE.MERGED) return "merged";
          if (cachedData.state === PR_STATE.CLOSED) {
            probe.killedReason = "pr-closed";
            return SESSION_STATUS.KILLED;
          }

          // Check CI
          if (cachedData.ciStatus === CI_STATUS.FAILING) return "ci_failed";

          // Check reviews
          if (cachedData.reviewDecision === "changes_requested") return "changes_requested";
          if (cachedData.reviewDecision === "approved" || cachedData.reviewDecision === "none") {
            // Check merge readiness — treat "none" (no reviewers required)
            // as "approved" so CI-green PRs reach "mergeable" status
            // and fire the merge.ready event / approved-and-green reaction.
            if (cachedData.mergeable) return "mergeable";
            if (cachedData.reviewDecision === "approved") return "approved";
          }
          if (cachedData.reviewDecision === "pending") return "review_pending";

          // 4b. Post-PR stuck detection: agent has a PR open but is idle beyond
          // threshold. This catches the case where step 2's stuck check was
          // bypassed (getActivityState returned null) or the idle timestamp
          // wasn't available during step 2 but the session has been at pr_open
          // for a long time. Without this, sessions get stuck at "pr_open" forever.
          if (detectedIdleTimestamp && isIdleBeyondThreshold(session, detectedIdleTimestamp)) {
            return "stuck";
          }

          return "pr_open";
        }

        // Fall back to individual API calls if no cached data
        const prState = await scm.getPRState(session.pr);
        if (prState === PR_STATE.MERGED) return "merged";
        if (prState === PR_STATE.CLOSED) {
          probe.killedReason = "pr-closed";
          return SESSION_STATUS.KILLED;
        }

        // Check CI
        const ciStatus = await scm.getCISummary(session.pr);
        if (ciStatus === CI_STATUS.FAILING) return "ci_failed";

        // Check reviews
        const reviewDecision = await scm.getReviewDecision(session.pr);
        if (reviewDecision === "changes_requested") return "changes_requested";
        if (reviewDecision === "approved" || reviewDecision === "none") {
          // Check merge readiness — treat "none" (no reviewers required)
          // as "approved" so CI-green PRs reach "mergeable" status
          // and fire the merge.ready event / approved-and-green reaction.
          const mergeReady = await scm.getMergeability(session.pr);
          if (mergeReady.mergeable) return "mergeable";
          if (reviewDecision === "approved") return "approved";
        }
        if (reviewDecision === "pending") return "review_pending";

        // 4b. Post-PR stuck detection: agent has a PR open but is idle beyond
        // threshold. This catches the case where step 2's stuck check was
        // bypassed (getActivityState returned null) or the idle timestamp
        // wasn't available during step 2 but the session has been at pr_open
        // for a long time. Without this, sessions get stuck at "pr_open" forever.
        if (detectedIdleTimestamp && isIdleBeyondThreshold(session, detectedIdleTimestamp)) {
          return "stuck";
        }

        return "pr_open";
      } catch {
        // SCM check failed — keep current status
      }
    }

    // 5. Post-all stuck detection: if we detected idle in step 2 but had no PR,
    // still check stuck threshold. This handles agents that finish without creating a PR.
    if (detectedIdleTimestamp && isIdleBeyondThreshold(session, detectedIdleTimestamp)) {
      return "stuck";
    }

    // 6. Default: if agent is active, it's working
    if (
      session.status === "spawning" ||
      session.status === SESSION_STATUS.STUCK ||
      session.status === SESSION_STATUS.NEEDS_INPUT
    ) {
      return "working";
    }
    return session.status;
  }

  /** Execute a reaction for a session. */
  async function executeReaction(
    sessionId: SessionId,
    projectId: string,
    reactionKey: string,
    reactionConfig: ReactionConfig,
  ): Promise<ReactionResult> {
    const trackerKey = `${sessionId}:${reactionKey}`;
    let tracker = reactionTrackers.get(trackerKey);

    if (!tracker) {
      tracker = { attempts: 0, firstTriggered: new Date() };
      reactionTrackers.set(trackerKey, tracker);
    }

    // Increment attempts before checking escalation
    tracker.attempts++;

    // Check if we should escalate
    const maxRetries = reactionConfig.retries ?? Infinity;
    const escalateAfter = reactionConfig.escalateAfter;
    let shouldEscalate = false;

    if (tracker.attempts > maxRetries) {
      shouldEscalate = true;
    }

    if (typeof escalateAfter === "string") {
      const durationMs = parseDuration(escalateAfter);
      if (durationMs > 0 && Date.now() - tracker.firstTriggered.getTime() > durationMs) {
        shouldEscalate = true;
      }
    }

    if (typeof escalateAfter === "number" && tracker.attempts > escalateAfter) {
      shouldEscalate = true;
    }

    if (shouldEscalate) {
      // Escalate to human
      const event = createEvent("reaction.escalated", {
        sessionId,
        projectId,
        message: `Reaction '${reactionKey}' escalated after ${tracker.attempts} attempts`,
        data: { reactionKey, attempts: tracker.attempts },
      });
      await notifyHuman(event, reactionConfig.priority ?? "urgent");
      return {
        reactionType: reactionKey,
        success: true,
        action: "escalated",
        escalated: true,
      };
    }

    // Execute the reaction action
    const action = reactionConfig.action ?? "notify";

    switch (action) {
      case "send-to-agent": {
        if (reactionConfig.message) {
          try {
            await sessionManager.send(sessionId, reactionConfig.message);

            return {
              reactionType: reactionKey,
              success: true,
              action: "send-to-agent",
              message: reactionConfig.message,
              escalated: false,
            };
          } catch {
            // Send failed — allow retry on next poll cycle (don't escalate immediately)
            return {
              reactionType: reactionKey,
              success: false,
              action: "send-to-agent",
              escalated: false,
            };
          }
        }
        break;
      }

      case "notify": {
        const event = createEvent("reaction.triggered", {
          sessionId,
          projectId,
          message: `Reaction '${reactionKey}' triggered notification`,
          data: { reactionKey },
        });
        await notifyHuman(event, reactionConfig.priority ?? "info");
        return {
          reactionType: reactionKey,
          success: true,
          action: "notify",
          escalated: false,
        };
      }

      case "auto-merge": {
        // Auto-merge is handled by the SCM plugin
        // For now, just notify
        const event = createEvent("reaction.triggered", {
          sessionId,
          projectId,
          message: `Reaction '${reactionKey}' triggered auto-merge`,
          data: { reactionKey },
        });
        await notifyHuman(event, "action");
        return {
          reactionType: reactionKey,
          success: true,
          action: "auto-merge",
          escalated: false,
        };
      }
    }

    return {
      reactionType: reactionKey,
      success: false,
      action,
      escalated: false,
    };
  }

  function clearReactionTracker(sessionId: SessionId, reactionKey: string): void {
    reactionTrackers.delete(`${sessionId}:${reactionKey}`);
  }

  function getReactionConfigForSession(
    session: Session,
    reactionKey: string,
  ): ReactionConfig | null {
    const project = config.projects[session.projectId];
    const globalReaction = config.reactions[reactionKey];
    const projectReaction = project?.reactions?.[reactionKey];
    const reactionConfig = projectReaction
      ? { ...globalReaction, ...projectReaction }
      : globalReaction;
    return reactionConfig ? (reactionConfig as ReactionConfig) : null;
  }

  /**
   * Merge lifecycle bookkeeping keys into the record. 1.2: only into the
   * record version that this poll read or last wrote (its generation and,
   * round 5, its launch: readVersionOf), so no archived or reserved record
   * is recreated and no newer launch is changed.
   * When the record changed, nothing is written; the next poll reads it again.
   */
  function updateSessionMetadata(session: Session, updates: Partial<Record<string, string>>): void {
    const project = config.projects[session.projectId];
    if (!project) return;

    const sessionsDir = getSessionsDir(config.configPath, project.path);
    const written = updateMetadataIf(
      sessionsDir,
      session.id,
      readVersionOf(session.metadata),
      updates,
    );
    if (written) session.metadata = written;
  }

  function makeFingerprint(ids: string[]): string {
    return [...ids].sort().join(",");
  }

  async function maybeDispatchReviewBacklog(
    session: Session,
    oldStatus: SessionStatus,
    newStatus: SessionStatus,
    transitionReaction?: { key: string; result: ReactionResult | null },
  ): Promise<void> {
    const project = config.projects[session.projectId];
    if (!project || !session.pr) return;

    const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;
    if (!scm) return;

    const humanReactionKey = "changes-requested";
    const automatedReactionKey = "bugbot-comments";

    if (TERMINAL_STATUSES.has(newStatus)) {
      clearReactionTracker(session.id, humanReactionKey);
      clearReactionTracker(session.id, automatedReactionKey);
      lastReviewBacklogCheckAt.delete(session.id);
      updateSessionMetadata(session, {
        lastPendingReviewFingerprint: "",
        lastPendingReviewDispatchHash: "",
        lastPendingReviewDispatchAt: "",
        lastAutomatedReviewFingerprint: "",
        lastAutomatedReviewDispatchHash: "",
        lastAutomatedReviewDispatchAt: "",
      });
      return;
    }

    // Throttle review backlog API calls to at most once per 2 minutes.
    // Comments don't change faster than this in practice, and the SCM calls
    // (getPendingComments + getAutomatedComments) consume API quota on every poll.
    //
    // Exception: bypass throttle when a transition reaction just fired for a
    // review reaction key. The transitionReaction branch records
    // lastPendingReviewDispatchHash, which requires the current fingerprint from
    // the API. If we throttle here, that metadata never gets written and the
    // next unthrottled poll sees a "new" fingerprint, clears the reaction tracker,
    // and fires a duplicate dispatch.
    const hasRelevantTransition =
      transitionReaction?.key === humanReactionKey ||
      transitionReaction?.key === automatedReactionKey;
    if (!hasRelevantTransition) {
      const lastCheckAt = lastReviewBacklogCheckAt.get(session.id) ?? 0;
      if (Date.now() - lastCheckAt < REVIEW_BACKLOG_THROTTLE_MS) {
        return;
      }
    }
    lastReviewBacklogCheckAt.set(session.id, Date.now());

    const [pendingResult, automatedResult] = await Promise.allSettled([
      scm.getPendingComments(session.pr),
      scm.getAutomatedComments(session.pr),
    ]);

    // null means "failed to fetch" — preserve existing metadata.
    // [] means "confirmed no comments" — safe to clear.
    const pendingComments =
      pendingResult.status === "fulfilled" && Array.isArray(pendingResult.value)
        ? pendingResult.value
        : null;
    const automatedComments =
      automatedResult.status === "fulfilled" && Array.isArray(automatedResult.value)
        ? automatedResult.value
        : null;

    // --- Pending (human) review comments ---
    // null = SCM fetch failed; skip processing to preserve existing metadata.
    if (pendingComments !== null) {
      const pendingFingerprint = makeFingerprint(pendingComments.map((comment) => comment.id));
      const lastPendingFingerprint = session.metadata["lastPendingReviewFingerprint"] ?? "";
      const lastPendingDispatchHash = session.metadata["lastPendingReviewDispatchHash"] ?? "";

      if (
        pendingFingerprint !== lastPendingFingerprint &&
        transitionReaction?.key !== humanReactionKey
      ) {
        clearReactionTracker(session.id, humanReactionKey);
      }
      if (pendingFingerprint !== lastPendingFingerprint) {
        updateSessionMetadata(session, {
          lastPendingReviewFingerprint: pendingFingerprint,
        });
      }

      if (!pendingFingerprint) {
        clearReactionTracker(session.id, humanReactionKey);
        updateSessionMetadata(session, {
          lastPendingReviewFingerprint: "",
          lastPendingReviewDispatchHash: "",
          lastPendingReviewDispatchAt: "",
        });
      } else if (
        transitionReaction?.key === humanReactionKey &&
        transitionReaction.result?.success
      ) {
        if (lastPendingDispatchHash !== pendingFingerprint) {
          updateSessionMetadata(session, {
            lastPendingReviewDispatchHash: pendingFingerprint,
            lastPendingReviewDispatchAt: new Date().toISOString(),
          });
        }
      } else if (
        !(oldStatus !== newStatus && newStatus === "changes_requested") &&
        pendingFingerprint !== lastPendingDispatchHash
      ) {
        const reactionConfig = getReactionConfigForSession(session, humanReactionKey);
        if (
          reactionConfig &&
          reactionConfig.action &&
          (reactionConfig.auto !== false || reactionConfig.action === "notify")
        ) {
          const result = await executeReaction(
            session.id,
            session.projectId,
            humanReactionKey,
            reactionConfig,
          );
          if (result.success) {
            updateSessionMetadata(session, {
              lastPendingReviewDispatchHash: pendingFingerprint,
              lastPendingReviewDispatchAt: new Date().toISOString(),
            });
          }
        }
      }
    }

    // --- Automated (bot) review comments ---
    if (automatedComments !== null) {
      const automatedFingerprint = makeFingerprint(automatedComments.map((comment) => comment.id));
      const lastAutomatedFingerprint = session.metadata["lastAutomatedReviewFingerprint"] ?? "";
      const lastAutomatedDispatchHash = session.metadata["lastAutomatedReviewDispatchHash"] ?? "";

      if (automatedFingerprint !== lastAutomatedFingerprint) {
        clearReactionTracker(session.id, automatedReactionKey);
        updateSessionMetadata(session, {
          lastAutomatedReviewFingerprint: automatedFingerprint,
        });
      }

      if (!automatedFingerprint) {
        clearReactionTracker(session.id, automatedReactionKey);
        updateSessionMetadata(session, {
          lastAutomatedReviewFingerprint: "",
          lastAutomatedReviewDispatchHash: "",
          lastAutomatedReviewDispatchAt: "",
        });
      } else if (automatedFingerprint !== lastAutomatedDispatchHash) {
        const reactionConfig = getReactionConfigForSession(session, automatedReactionKey);
        if (
          reactionConfig &&
          reactionConfig.action &&
          (reactionConfig.auto !== false || reactionConfig.action === "notify")
        ) {
          const result = await executeReaction(
            session.id,
            session.projectId,
            automatedReactionKey,
            reactionConfig,
          );
          if (result.success) {
            updateSessionMetadata(session, {
              lastAutomatedReviewDispatchHash: automatedFingerprint,
              lastAutomatedReviewDispatchAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  /**
   * Format CI check failures into a human-readable message for the agent.
   * Includes check names, statuses, and links for debugging.
   */
  function formatCIFailureMessage(failedChecks: CICheck[]): string {
    const lines = ["CI checks are failing on your PR. Here are the failed checks:", ""];
    for (const check of failedChecks) {
      const status = check.conclusion ?? check.status;
      const link = check.url ? ` — ${check.url}` : "";
      lines.push(`- **${check.name}**: ${status}${link}`);
    }
    lines.push("", "Investigate the failures, fix the issues, and push again.");
    return lines.join("\n");
  }

  /**
   * Dispatch CI failure details to the agent session when new or changed
   * failures are detected. Follows the same fingerprinting/deduplication
   * pattern as maybeDispatchReviewBacklog().
   */
  async function maybeDispatchCIFailureDetails(
    session: Session,
    _oldStatus: SessionStatus,
    newStatus: SessionStatus,
    transitionReaction?: { key: string; result: ReactionResult | null },
  ): Promise<void> {
    const project = config.projects[session.projectId];
    if (!project || !session.pr) return;

    const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;
    if (!scm) return;

    const ciReactionKey = "ci-failed";

    // Clear tracking when PR is closed/merged
    if (newStatus === "merged" || newStatus === "killed") {
      clearReactionTracker(session.id, ciReactionKey);
      updateSessionMetadata(session, {
        lastCIFailureFingerprint: "",
        lastCIFailureDispatchHash: "",
        lastCIFailureDispatchAt: "",
      });
      return;
    }

    // Only dispatch CI details when in ci_failed state
    if (newStatus !== "ci_failed") {
      // CI is no longer failing — clear tracking so next failure is dispatched fresh
      const lastFingerprint = session.metadata["lastCIFailureFingerprint"] ?? "";
      if (lastFingerprint) {
        clearReactionTracker(session.id, ciReactionKey);
        updateSessionMetadata(session, {
          lastCIFailureFingerprint: "",
          lastCIFailureDispatchHash: "",
          lastCIFailureDispatchAt: "",
        });
      }
      return;
    }

    // Fetch individual CI checks for failure details.
    // Use batch enrichment data when available to avoid an extra REST call;
    // fall back to getCIChecks() when the batch didn't run this cycle.
    const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
    const cachedEnrichment = prEnrichmentCache.get(prKey);

    let checks: CICheck[];
    if (cachedEnrichment?.ciChecks !== undefined) {
      checks = cachedEnrichment.ciChecks;
    } else {
      try {
        checks = await scm.getCIChecks(session.pr);
      } catch {
        // Failed to fetch checks — skip this cycle
        return;
      }
    }

    const failedChecks = checks.filter(
      (c) => c.status === "failed" || c.conclusion?.toUpperCase() === "FAILURE",
    );
    if (failedChecks.length === 0) return;

    const ciFingerprint = makeFingerprint(
      failedChecks.map((c) => `${c.name}:${c.status}:${c.conclusion ?? ""}`),
    );
    const lastCIFingerprint = session.metadata["lastCIFailureFingerprint"] ?? "";
    const lastCIDispatchHash = session.metadata["lastCIFailureDispatchHash"] ?? "";

    // Reset reaction tracker when failure set changes
    if (ciFingerprint !== lastCIFingerprint && transitionReaction?.key !== ciReactionKey) {
      clearReactionTracker(session.id, ciReactionKey);
    }
    if (ciFingerprint !== lastCIFingerprint) {
      updateSessionMetadata(session, {
        lastCIFailureFingerprint: ciFingerprint,
      });
    }

    // If transition already sent a ci-failed reaction with the static message,
    // skip this cycle but do NOT record dispatch hash — the next poll will send
    // the detailed CI failure info with check names and URLs.
    if (transitionReaction?.key === ciReactionKey && transitionReaction.result?.success) {
      return;
    }

    // Skip if we already dispatched this exact failure set
    if (ciFingerprint === lastCIDispatchHash) return;

    // Dispatch CI failure details directly via sessionManager.send() rather than
    // executeReaction() to avoid consuming the ci-failed reaction's retry budget.
    // The transition reaction owns escalation; this is a follow-up info delivery.
    const reactionConfig = getReactionConfigForSession(session, ciReactionKey);
    if (
      reactionConfig &&
      reactionConfig.action &&
      (reactionConfig.auto !== false || reactionConfig.action === "notify")
    ) {
      const detailedMessage = formatCIFailureMessage(failedChecks);

      try {
        if (reactionConfig.action === "send-to-agent") {
          await sessionManager.send(session.id, detailedMessage);
        } else {
          // For "notify" action, send to human notifiers instead
          const event = createEvent("ci.failing", {
            sessionId: session.id,
            projectId: session.projectId,
            message: detailedMessage,
            data: { failedChecks: failedChecks.map((c) => c.name) },
          });
          await notifyHuman(event, reactionConfig.priority ?? "warning");
        }

        updateSessionMetadata(session, {
          lastCIFailureDispatchHash: ciFingerprint,
          lastCIFailureDispatchAt: new Date().toISOString(),
        });
      } catch {
        // Send failed — will retry on next poll cycle
      }
    }
  }

  /**
   * Dispatch merge conflict notifications to the agent session.
   * Conflicts are detected from the PR enrichment cache or getMergeability()
   * and dispatched independently of the session status (conflicts can coexist
   * with ci_failed, changes_requested, etc.).
   */
  async function maybeDispatchMergeConflicts(
    session: Session,
    newStatus: SessionStatus,
  ): Promise<void> {
    const project = config.projects[session.projectId];
    if (!project || !session.pr) return;

    const scm = project.scm?.plugin ? registry.get<SCM>("scm", project.scm.plugin) : null;
    if (!scm) return;

    const conflictReactionKey = "merge-conflicts";

    // Clear tracking when PR is closed/merged
    if (newStatus === "merged" || newStatus === "killed") {
      clearReactionTracker(session.id, conflictReactionKey);
      updateSessionMetadata(session, {
        lastMergeConflictDispatched: "",
      });
      return;
    }

    // Only check for conflicts on open PRs
    if (
      newStatus !== "pr_open" &&
      newStatus !== "ci_failed" &&
      newStatus !== "review_pending" &&
      newStatus !== "changes_requested" &&
      newStatus !== "approved" &&
      newStatus !== "mergeable"
    ) {
      return;
    }

    // Check for conflicts using cached enrichment data or fallback to individual call.
    // When batch enrichment ran (cachedData is present), use its hasConflicts value
    // to avoid 3 redundant REST calls from getMergeability() — the batch already
    // fetched the mergeable/mergeStateStatus fields via GraphQL.
    const prKey = `${session.pr.owner}/${session.pr.repo}#${session.pr.number}`;
    const cachedData = prEnrichmentCache.get(prKey);

    let hasConflicts: boolean;
    if (cachedData) {
      // Batch ran — trust its data (undefined means CONFLICTING wasn't set → no conflicts)
      hasConflicts = cachedData.hasConflicts ?? false;
    } else {
      // Batch didn't run this cycle — fall back to individual API call
      try {
        const mergeReadiness = await scm.getMergeability(session.pr);
        hasConflicts = !mergeReadiness.noConflicts;
      } catch {
        return;
      }
    }

    const lastDispatched = session.metadata["lastMergeConflictDispatched"] ?? "";

    if (hasConflicts) {
      // Already dispatched for current conflict state — skip
      if (lastDispatched === "true") return;

      const reactionConfig = getReactionConfigForSession(session, conflictReactionKey);
      if (
        reactionConfig &&
        reactionConfig.action &&
        (reactionConfig.auto !== false || reactionConfig.action === "notify")
      ) {
        try {
          if (reactionConfig.action === "send-to-agent") {
            const message =
              reactionConfig.message ??
              "Your branch has merge conflicts. Rebase on the default branch and resolve them.";
            await sessionManager.send(session.id, message);
          } else {
            const event = createEvent("merge.conflicts", {
              sessionId: session.id,
              projectId: session.projectId,
              message: `${session.id}: PR has merge conflicts`,
            });
            await notifyHuman(event, reactionConfig.priority ?? "warning");
          }

          updateSessionMetadata(session, {
            lastMergeConflictDispatched: "true",
          });
        } catch {
          // Send failed — will retry on next poll cycle
        }
      }
    } else if (lastDispatched === "true") {
      // Conflicts resolved — clear so we can re-dispatch if they recur
      clearReactionTracker(session.id, conflictReactionKey);
      updateSessionMetadata(session, {
        lastMergeConflictDispatched: "",
      });
    }
  }

  /** Send a notification to all configured notifiers. */
  async function notifyHuman(event: OrchestratorEvent, priority: EventPriority): Promise<void> {
    const eventWithPriority = { ...event, priority };
    const notifierNames = config.notificationRouting[priority] ?? config.defaults.notifiers;

    for (const name of notifierNames) {
      const target = resolveNotifierTarget(config, name);
      const notifier =
        registry.get<Notifier>("notifier", target.reference) ??
        registry.get<Notifier>("notifier", target.pluginName);
      if (notifier) {
        try {
          await notifier.notify(eventWithPriority);
        } catch {
          // Notifier failed — not much we can do
        }
      }
    }
  }

  /**
   * B and 1.2: persist a status only when the record is still the version
   * that this poll read: the same `generation` (any Node writer increments
   * it), `status`, handle and `pr` (the bash metadata helpers change `pr` and
   * `status` without a new generation). The read, the compare and the rename
   * run under the record lock. When the compare fails (a spawn, a restore, a
   * claim or an archive changed the record during the probes) or the lock is
   * not free, nothing is written and the next poll decides from the new
   * record. C3: a killed status carries its `killedReason`; any other status
   * removes it. Returns null when written, else the reason.
   */
  function persistStatus(
    session: Session,
    status: SessionStatus,
    killedReason: KilledReason | undefined,
  ): string | null {
    const project = config.projects[session.projectId];
    if (!project) return "project not configured";

    const updates: Record<string, string> =
      status === SESSION_STATUS.KILLED
        ? { status, ...(killedReason && { killedReason }) }
        : { status, killedReason: "" };
    let written: Record<string, string> | null;
    try {
      written = updateMetadataIf(
        getSessionsDir(config.configPath, project.path),
        session.id,
        {
          ...readVersionOf(session.metadata),
          status: session.metadata["status"],
          pr: session.metadata["pr"],
        },
        updates,
      );
    } catch (err) {
      return `record not written: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!written) return "record changed during the poll; status not written";
    session.metadata = written;
    return null;
  }

  /** Probe one session and decide its status; persists nothing. */
  async function evaluateSession(listed: Session): Promise<StatusEvaluation> {
    // Use tracked state if available; otherwise use the persisted metadata status
    // (not session.status, which list() may have already overwritten for dead runtimes).
    // This ensures transitions are detected after a lifecycle manager restart.
    const tracked = trackedStatus(listed);
    const oldStatus =
      tracked ?? ((listed.metadata?.["status"] as SessionStatus | undefined) || listed.status);
    // list() and get() set status=killed in memory when their own isAlive
    // answered false. That answer is not confirmed, so this poll decides from
    // its own probes and the persisted status (C1).
    const session =
      listed.status === SESSION_STATUS.KILLED && listed.metadata["status"] !== SESSION_STATUS.KILLED
        ? { ...listed, status: validateStatus(listed.metadata["status"]) }
        : listed;
    const probe: ProbeResult = {};
    const decided = await determineStatus(session, probe);
    const newStatus = decided === KEEP_STATUS ? oldStatus : decided;
    return { session, oldStatus, newStatus, probe };
  }

  /**
   * C1, C2 and the bounds (1.1): which status this poll may persist.
   * - A PR-driven kill (`pr-closed`) is persisted at once.
   * - "gone" (authoritative) persists killed at the second negative poll in a
   *   row of this worker; no outage holds it back.
   * - "ambiguous" does the same, except in a poll where no probed session
   *   answered alive (C2): then only after AMBIGUOUS_NEGATIVE_BOUND_MS of
   *   such answers from the first negative poll of the run.
   * - "no-server" keeps the status until the same session reported no server
   *   in consecutive polls for NO_SERVER_BOUND_MS, then killed (`runtime`).
   * - Any other answer (alive, a failed probe, no answer) ends the run.
   * A session whose answers alternate between negative and positive or
   * unknown starts a new run each time, so it is never persisted as killed.
   * M-1 (round 4): a run belongs to one launch (launchKeyOf). When the record
   * names another launch (a restore, or an archive plus a new reservation
   * and launch of the same ID), its first negative poll starts a new run:
   * the replacement gets its own two polls and its own 5 minutes.
   */
  function decideStatus(
    evaluation: StatusEvaluation,
    outage: ProbeOutage,
    now: number,
  ): { status: SessionStatus; killedReason?: KilledReason } {
    const { session, oldStatus, newStatus, probe } = evaluation;
    const outcome = probe.outcome;
    const launch = launchKeyOf(session.metadata);
    const stored = negativeStreaks.get(session.id);
    const streak = stored?.launch === launch ? stored : undefined;

    if (newStatus === SESSION_STATUS.KILLED && probe.killedReason === "pr-closed") {
      negativeStreaks.delete(session.id);
      return { status: newStatus, killedReason: "pr-closed" };
    }

    if (outcome === "no-server") {
      const run: NegativeStreak =
        streak?.kind === "no-server"
          ? { ...streak, polls: streak.polls + 1 }
          : { kind: "no-server", firstAt: now, polls: 1, launch };
      if (run.polls >= 2 && now - run.firstAt >= NO_SERVER_BOUND_MS) {
        negativeStreaks.delete(session.id);
        return { status: SESSION_STATUS.KILLED, killedReason: "runtime" };
      }
      negativeStreaks.set(session.id, run);
      return { status: newStatus === SESSION_STATUS.KILLED ? oldStatus : newStatus };
    }

    if ((outcome === "gone" || outcome === "ambiguous") && newStatus === SESSION_STATUS.KILLED) {
      const run: NegativeStreak =
        streak?.kind === "negative"
          ? { ...streak, polls: streak.polls + 1 }
          : { kind: "negative", firstAt: now, polls: 1, launch };
      const held =
        outcome === "ambiguous" &&
        outage.holdAmbiguous &&
        now - run.firstAt < AMBIGUOUS_NEGATIVE_BOUND_MS;
      if (run.polls >= 2 && !held) {
        negativeStreaks.delete(session.id);
        return { status: newStatus, killedReason: probe.killedReason };
      }
      negativeStreaks.set(session.id, run);
      return { status: oldStatus };
    }

    negativeStreaks.delete(session.id);
    return { status: newStatus, killedReason: probe.killedReason };
  }

  /** Persist one session's evaluated status and handle the transition. */
  async function applyEvaluation(
    evaluation: StatusEvaluation,
    outage: ProbeOutage,
    now: number,
  ): Promise<void> {
    const { session, oldStatus } = evaluation;
    const { status: newStatus, killedReason } = decideStatus(evaluation, outage, now);
    let transitionReaction: { key: string; result: ReactionResult | null } | undefined;

    if (newStatus !== oldStatus) {
      const correlationId = createCorrelationId("lifecycle-transition");
      const notWritten = persistStatus(session, newStatus, killedReason);
      if (notWritten) {
        // The record changed under the poll (or its lock was not free): no
        // transition happened. Forget the tracked status and the negative run
        // so the next poll decides from the new record.
        states.delete(session.id);
        negativeStreaks.delete(session.id);
        observer.recordOperation({
          metric: "lifecycle_poll",
          operation: "lifecycle.transition",
          outcome: "failure",
          correlationId,
          projectId: session.projectId,
          sessionId: session.id,
          reason: notWritten,
          data: { oldStatus, newStatus },
          level: "info",
        });
        return;
      }
      // State transition detected
      trackStatus(session, newStatus);
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.transition",
        outcome: "success",
        correlationId,
        projectId: session.projectId,
        sessionId: session.id,
        data: { oldStatus, newStatus },
        level: transitionLogLevel(newStatus),
      });

      // Reset allCompleteEmitted when any session becomes active again
      if (!TERMINAL_STATUSES.has(newStatus)) {
        allCompleteEmitted = false;
      }

      // Clear reaction trackers for the old status so retries reset on state changes
      const oldEventType = statusToEventType(undefined, oldStatus);
      if (oldEventType) {
        const oldReactionKey = eventToReactionKey(oldEventType);
        if (oldReactionKey) {
          clearReactionTracker(session.id, oldReactionKey);
        }
      }

      // Handle transition: notify humans and/or trigger reactions
      const eventType = statusToEventType(oldStatus, newStatus);
      if (eventType) {
        let reactionHandledNotify = false;
        const reactionKey = eventToReactionKey(eventType);

        if (reactionKey) {
          const reactionConfig = getReactionConfigForSession(session, reactionKey);

          if (reactionConfig && reactionConfig.action) {
            // auto: false skips automated agent actions but still allows notifications
            if (reactionConfig.auto !== false || reactionConfig.action === "notify") {
              const reactionResult = await executeReaction(
                session.id,
                session.projectId,
                reactionKey,
                reactionConfig,
              );
              transitionReaction = { key: reactionKey, result: reactionResult };
              // Reaction is handling this event — suppress immediate human notification.
              // "send-to-agent" retries + escalates on its own; "notify"/"auto-merge"
              // already call notifyHuman internally. Notifying here would bypass the
              // delayed escalation behaviour configured via retries/escalateAfter.
              reactionHandledNotify = true;
            }
          }
        }

        // For transitions not already notified by a reaction, notify humans.
        // All priorities (including "info") are routed through notificationRouting
        // so the config controls which notifiers receive each priority level.
        if (!reactionHandledNotify) {
          const priority = inferPriority(eventType);
          const event = createEvent(eventType, {
            sessionId: session.id,
            projectId: session.projectId,
            message: `${session.id}: ${oldStatus} → ${newStatus}`,
            data: { oldStatus, newStatus },
          });
          await notifyHuman(event, priority);
        }
      }
    } else {
      // No transition but track current state
      trackStatus(session, newStatus);
    }

    // Pin first quality summary for title stability
    if (
      session.agentInfo?.summary &&
      !session.agentInfo.summaryIsFallback &&
      !session.metadata["pinnedSummary"]
    ) {
      const trimmed = session.agentInfo.summary.replace(/[\n\r]/g, " ").trim();
      if (trimmed.length >= 5) {
        try {
          updateSessionMetadata(session, { pinnedSummary: trimmed });
        } catch {
          // Non-critical: title just won't be pinned this cycle
        }
      }
    }

    await Promise.allSettled([
      maybeDispatchReviewBacklog(session, oldStatus, newStatus, transitionReaction),
      maybeDispatchCIFailureDetails(session, oldStatus, newStatus, transitionReaction),
      maybeDispatchMergeConflicts(session, newStatus),
    ]);
  }

  /**
   * C2: a poll in which two or more sessions were probed and none answered
   * alive can be a probe outage (an unreachable tmux socket or a failing `ps`
   * looks like this) and not a mass exit. Only "ambiguous" negatives are then
   * held back (bounded, see decideStatus): after D, an outage of tmux or `ps`
   * gives rejections or "no server", never an authoritative "gone". The health
   * is `warn` in such a poll unless every answer is an authoritative "gone"
   * (a real mass exit). Recoverable killed records are not counted: they are
   * expected to answer dead, and their probes set no outcome.
   */
  function probeOutage(evaluations: StatusEvaluation[]): ProbeOutage {
    const probed = evaluations.filter((e) => e.probe.outcome !== undefined);
    const noneAlive = probed.length >= 2 && probed.every((e) => e.probe.outcome !== "alive");
    if (!noneAlive) return NO_OUTAGE;
    const outcomes = Object.fromEntries(
      probed.map((e) => [e.session.id, e.probe.outcome as ProbeOutcome]),
    );
    const holdAmbiguous = probed.some((e) => e.probe.outcome === "ambiguous");
    const warn = probed.some((e) => e.probe.outcome !== "gone");
    if (!warn) return { holdAmbiguous, warn, outcomes };
    return {
      holdAmbiguous,
      warn,
      reason:
        "probe outage: no probed session could be confirmed alive in one poll " +
        "(probes that could not run, no runtime server, or answers that cannot tell an " +
        "error from an exit; check the tmux server and ps); such answers persist killed " +
        "only after 5 minutes",
      outcomes,
    };
  }

  /** Run one polling cycle across all sessions. */
  async function pollAll(): Promise<void> {
    const correlationId = createCorrelationId("lifecycle-poll");
    const startedAt = Date.now();
    // Re-entrancy guard: skip if previous poll is still running
    if (polling) return;
    polling = true;

    try {
      const sessions = await sessionManager.list(scopedProjectId);

      // Include sessions that are active OR whose status changed from what we last saw
      // (e.g., list() detected a dead runtime and marked it "killed" — we need to
      // process that transition even though the new status is terminal)
      // C3: also re-check a killed record whose kill came from a liveness probe.
      // M-3: also a record whose persisted status is not terminal while list()
      // reports it killed in memory, also when this worker has no tracked
      // status for it (a new worker over a session that died before it started).
      const sessionsToCheck = sessions.filter((s) => {
        if (!TERMINAL_STATUSES.has(s.status)) return true;
        if (isRecoverableKill(s.metadata)) return true;
        if (s.metadata["status"] && !TERMINAL_STATUSES.has(validateStatus(s.metadata["status"]))) {
          return true;
        }
        const tracked = trackedStatus(s);
        return tracked !== undefined && tracked !== s.status;
      });

      // Populate PR enrichment cache using batch GraphQL queries
      // This reduces API calls from N×3 to 1 per poll cycle
      await populatePREnrichmentCache(sessionsToCheck);

      // Probe all sessions concurrently, then persist: the outage check needs
      // every probe of this poll before anything is written.
      const evaluated = await Promise.allSettled(sessionsToCheck.map((s) => evaluateSession(s)));
      const evaluations: StatusEvaluation[] = [];
      evaluated.forEach((result, index) => {
        if (result.status === "fulfilled") {
          evaluations.push(result.value);
        } else {
          // An evaluation that failed is no negative answer: end the session's run.
          const failedId = sessionsToCheck[index]?.id;
          if (failedId) negativeStreaks.delete(failedId);
        }
      });
      const outage = probeOutage(evaluations);
      const now = Date.now();
      await Promise.allSettled(evaluations.map((e) => applyEvaluation(e, outage, now)));

      // Prune stale entries from states, reactionTrackers, and lastReviewBacklogCheckAt
      // for sessions that no longer appear in the session list (e.g., after kill/cleanup)
      const currentSessionIds = new Set(sessions.map((s) => s.id));
      for (const trackedId of states.keys()) {
        if (!currentSessionIds.has(trackedId)) {
          states.delete(trackedId);
        }
      }
      for (const streakId of negativeStreaks.keys()) {
        if (!currentSessionIds.has(streakId)) {
          negativeStreaks.delete(streakId);
        }
      }
      for (const trackerKey of reactionTrackers.keys()) {
        const sessionId = trackerKey.split(":")[0];
        if (sessionId && !currentSessionIds.has(sessionId)) {
          reactionTrackers.delete(trackerKey);
        }
      }
      for (const sessionId of lastReviewBacklogCheckAt.keys()) {
        if (!currentSessionIds.has(sessionId)) {
          lastReviewBacklogCheckAt.delete(sessionId);
        }
      }

      // Check if all sessions are complete (trigger reaction only once)
      const activeSessions = sessions.filter((s) => !TERMINAL_STATUSES.has(s.status));
      if (sessions.length > 0 && activeSessions.length === 0 && !allCompleteEmitted) {
        allCompleteEmitted = true;

        // Execute all-complete reaction if configured
        const reactionKey = eventToReactionKey("summary.all_complete");
        if (reactionKey) {
          const reactionConfig = config.reactions[reactionKey];
          if (reactionConfig && reactionConfig.action) {
            if (reactionConfig.auto !== false || reactionConfig.action === "notify") {
              await executeReaction("system", "all", reactionKey, reactionConfig as ReactionConfig);
            }
          }
        }
      }
      if (scopedProjectId) {
        observer.recordOperation({
          metric: "lifecycle_poll",
          operation: "lifecycle.poll",
          outcome: "success",
          correlationId,
          projectId: scopedProjectId,
          durationMs: Date.now() - startedAt,
          data: { sessionCount: sessions.length, activeSessionCount: activeSessions.length },
          level: "info",
        });
        observer.setHealth({
          surface: "lifecycle.worker",
          status: outage.warn ? "warn" : "ok",
          projectId: scopedProjectId,
          correlationId,
          ...(outage.reason && { reason: outage.reason }),
          details: {
            projectId: scopedProjectId,
            sessionCount: sessions.length,
            activeSessionCount: activeSessions.length,
            ...(outage.warn && {
              probeOutageSessions: Object.keys(outage.outcomes),
              probeOutcomes: outage.outcomes,
            }),
          },
        });
      }
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : String(err);
      observer.recordOperation({
        metric: "lifecycle_poll",
        operation: "lifecycle.poll",
        outcome: "failure",
        correlationId,
        projectId: scopedProjectId,
        durationMs: Date.now() - startedAt,
        reason: errorReason,
        level: "error",
      });
      observer.setHealth({
        surface: "lifecycle.worker",
        status: "error",
        projectId: scopedProjectId,
        correlationId,
        reason: errorReason,
        details: scopedProjectId ? { projectId: scopedProjectId } : { projectScope: "all" },
      });
    } finally {
      polling = false;
    }
  }

  return {
    start(intervalMs = 30_000): void {
      if (pollTimer) return; // Already running
      pollTimer = setInterval(() => void pollAll(), intervalMs);
      // Run immediately on start
      void pollAll();
    },

    stop(): void {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },

    getStates(): Map<SessionId, SessionStatus> {
      return new Map([...states].map(([id, tracked]) => [id, tracked.status]));
    },

    async check(sessionId: SessionId): Promise<void> {
      const session = await sessionManager.get(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      // One session cannot show an outage (C2 needs two); C1 and the
      // no-server bound still apply.
      await applyEvaluation(await evaluateSession(session), NO_OUTAGE, Date.now());
    },
  };
}
