import type { ObservabilityLevel } from "./observability.js";

/**
 * Agent Orchestrator — Core Type Definitions
 *
 * This file defines ALL interfaces and types that the system uses.
 * Every plugin, CLI command, and web API route builds against these.
 *
 * Architecture: 8 plugin slots + core services
 *   1. Runtime    — where sessions execute (tmux, docker, k8s, process)
 *   2. Agent      — AI coding tool (claude-code, codex, aider)
 *   3. Workspace  — code isolation (worktree, clone)
 *   4. Tracker    — issue tracking (github, linear, jira)
 *   5. SCM        — source platform + PR/CI/reviews (github, gitlab)
 *   6. Notifier   — push notifications (desktop, slack, webhook)
 *   7. Terminal   — human interaction UI (iterm2, web, none)
 *   8. Lifecycle Manager (core, not pluggable)
 */

// =============================================================================
// SESSION
// =============================================================================

/** Unique session identifier, e.g. "my-app-1", "backend-12" */
export type SessionId = string;

/** Session lifecycle states */
export type SessionStatus =
  | "spawning"
  | "working"
  | "pr_open"
  | "ci_failed"
  | "review_pending"
  | "changes_requested"
  | "approved"
  | "mergeable"
  | "merged"
  | "cleanup"
  | "needs_input"
  | "stuck"
  | "errored"
  | "killed"
  | "idle"
  | "done"
  | "terminated";

/** Activity state as detected by the agent plugin */
export type ActivityState =
  | "active" // agent is processing (thinking, writing code)
  | "ready" // agent finished its turn, alive and waiting for input
  | "idle" // agent has been inactive for a while (stale)
  | "waiting_input" // agent is asking a question / permission prompt
  | "blocked" // agent hit an error or is stuck
  | "exited"; // agent process is no longer running

/** Activity state constants */
export const ACTIVITY_STATE = {
  ACTIVE: "active" as const,
  READY: "ready" as const,
  IDLE: "idle" as const,
  WAITING_INPUT: "waiting_input" as const,
  BLOCKED: "blocked" as const,
  EXITED: "exited" as const,
} satisfies Record<string, ActivityState>;

/** Result of activity detection, carrying both the state and an optional timestamp. */
export interface ActivityDetection {
  state: ActivityState;
  /** When activity was last observed (e.g., agent log file mtime) */
  timestamp?: Date;
}

/** A single entry in the AO activity JSONL log, written by agent plugins. */
export interface ActivityLogEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** Activity state derived from terminal output or agent-native data */
  state: ActivityState;
  /** What triggered this state classification */
  source: "terminal" | "native";
  /** Raw terminal snippet that caused waiting_input/blocked (for debugging) */
  trigger?: string;
}

/** Default threshold (ms) before a "ready" session becomes "idle". */
export const DEFAULT_READY_THRESHOLD_MS = 300_000; // 5 minutes

/** Default window (ms) for "active" state — activity newer than this is "active", older is "ready". */
export const DEFAULT_ACTIVE_WINDOW_MS = 30_000; // 30 seconds

/**
 * Time (ms) after a launch or a restore during which an agent process that is
 * not yet visible does not count as exited while its runtime is alive. The
 * lifecycle measures it from the record's `restoredAt` (written by restore),
 * else `createdAt` (written by spawn); a record with neither gets no grace.
 */
export const LAUNCH_GRACE_MS = 60_000; // 60 seconds

/**
 * How long the lifecycle holds back a negative answer that cannot tell an
 * error from an exit (codex, gemini and opencode `isProcessRunning`,
 * runtime-herdr `isAlive`, the Herdr pane reads answer `false` on an error)
 * in polls where no probed session answers alive (C2). When the same session
 * gives such answers in consecutive polls for this long, the lifecycle
 * persists `killed`. In memory per session and launch, from the first such
 * poll; a positive or an unknown answer, or a new launch of the session ID,
 * starts it again.
 *
 * The bound applies only in a poll in which two or more sessions gave a
 * probe outcome and none of them answered alive. In any other poll (a single
 * probed session, as in a single-session `check()` or a fleet of one, or a
 * poll in which another session answers alive) such an answer follows the
 * two-poll rule (C1): `killed` at the second negative poll in a row of the
 * same launch, without this bound. Killed records that are only re-checked
 * (C3) give no outcome and do not count.
 */
export const AMBIGUOUS_NEGATIVE_BOUND_MS = 300_000; // 5 minutes

/**
 * How long the lifecycle counts "no runtime server" (a `Runtime.isAlive`
 * rejection with RUNTIME_NO_SERVER_ERROR_CODE) as unknown. When the same
 * session (the same launch of it) gives this answer in consecutive polls for
 * this long, and in at least two polls, the lifecycle persists `killed` with
 * `killedReason=runtime`. A short outage (a hidden or unreachable socket)
 * stays below it. A new launch of the session ID starts it again.
 */
export const NO_SERVER_BOUND_MS = 300_000; // 5 minutes

/**
 * `code` of a `Runtime.isAlive` rejection when no runtime server runs at all
 * (tmux: "no server running on ...", or no socket file). See `Runtime.isAlive`.
 */
export const RUNTIME_NO_SERVER_ERROR_CODE = "ERR_RUNTIME_NO_SERVER";

/** Session status constants */
export const SESSION_STATUS = {
  SPAWNING: "spawning" as const,
  WORKING: "working" as const,
  PR_OPEN: "pr_open" as const,
  CI_FAILED: "ci_failed" as const,
  REVIEW_PENDING: "review_pending" as const,
  CHANGES_REQUESTED: "changes_requested" as const,
  APPROVED: "approved" as const,
  MERGEABLE: "mergeable" as const,
  MERGED: "merged" as const,
  CLEANUP: "cleanup" as const,
  NEEDS_INPUT: "needs_input" as const,
  STUCK: "stuck" as const,
  ERRORED: "errored" as const,
  IDLE: "idle" as const,
  KILLED: "killed" as const,
  DONE: "done" as const,
  TERMINATED: "terminated" as const,
} satisfies Record<string, SessionStatus>;

/** Statuses that indicate the session is in a terminal (dead) state. */
export const TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "killed",
  "terminated",
  "done",
  "cleanup",
  "errored",
  "merged",
]);

/** Activity states that indicate the session is no longer running. */
export const TERMINAL_ACTIVITIES: ReadonlySet<ActivityState> = new Set(["exited"]);

/** Statuses that must never be restored (e.g. already merged). */
export const NON_RESTORABLE_STATUSES: ReadonlySet<SessionStatus> = new Set(["merged"]);

/** Check if a session is in a terminal (dead) state. */
export function isTerminalSession(session: {
  status: SessionStatus;
  activity: ActivityState | null;
}): boolean {
  return (
    TERMINAL_STATUSES.has(session.status) ||
    (session.activity !== null && TERMINAL_ACTIVITIES.has(session.activity))
  );
}

/** Check if a session can be restored. */
export function isRestorable(session: {
  status: SessionStatus;
  activity: ActivityState | null;
}): boolean {
  return isTerminalSession(session) && !NON_RESTORABLE_STATUSES.has(session.status);
}

/** A running agent session */
export interface Session {
  /** Unique session ID, e.g. "my-app-3" */
  id: SessionId;

  /** Which project this session belongs to */
  projectId: string;

  /** Current lifecycle status */
  status: SessionStatus;

  /** Activity state from agent plugin (null = not yet determined) */
  activity: ActivityState | null;

  /** Git branch name */
  branch: string | null;

  /** Issue identifier (if working on an issue) */
  issueId: string | null;

  /** PR info (once PR is created) */
  pr: PRInfo | null;

  /** Workspace path on disk */
  workspacePath: string | null;

  /** Runtime handle for communicating with the session */
  runtimeHandle: RuntimeHandle | null;

  /** Agent session info (summary, cost, etc.) */
  agentInfo: AgentSessionInfo | null;

  /** When the session was created */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** When this session was last restored (undefined if never restored) */
  restoredAt?: Date;

  /** Metadata key-value pairs */
  metadata: Record<string, string>;
}

export function isOrchestratorSession(
  session: { id: SessionId; metadata?: Record<string, string> },
  sessionPrefix?: string,
  allSessionPrefixes?: string[],
): boolean {
  if (session.metadata?.["role"] === "orchestrator" || session.id.endsWith("-orchestrator")) {
    return true;
  }
  if (!sessionPrefix) {
    return false;
  }
  const escaped = sessionPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^${escaped}-orchestrator-\\d+$`).test(session.id)) {
    return false;
  }
  // Guard against cross-project false positives: if the session ID is a plain
  // numbered worker for any other known prefix (e.g. prefix "app-orchestrator"
  // matches "app-orchestrator-1" as a worker), it is not an orchestrator.
  if (allSessionPrefixes) {
    for (const prefix of allSessionPrefixes) {
      if (prefix === sessionPrefix) continue;
      if (new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(session.id)) {
        return false;
      }
    }
  }
  return true;
}

/** Config for creating a new session */
export interface SessionSpawnConfig {
  projectId: string;
  issueId?: string;
  branch?: string;
  prompt?: string;
  /** Override the agent plugin for this session (e.g. "codex", "claude-code") */
  agent?: string;
  /** Override the agent model for this session (e.g. "sonnet", "gpt-5.6-terra") */
  model?: string;
  /** Override the OpenCode subagent for this session (e.g. "sisyphus", "oracle") */
  subagent?: string;
  /** Decomposition context — ancestor task chain (passed to prompt builder) */
  lineage?: string[];
  /** Decomposition context — sibling task descriptions (passed to prompt builder) */
  siblings?: string[];
}

/** Config for creating an orchestrator session */
export interface OrchestratorSpawnConfig {
  projectId: string;
  systemPrompt?: string;
}

// =============================================================================
// RUNTIME — Plugin Slot 1
// =============================================================================

/**
 * Runtime determines WHERE and HOW agent sessions execute.
 * tmux, docker, kubernetes, child processes, SSH, cloud sandboxes, etc.
 */
export interface Runtime {
  readonly name: string;

  /** Create a new session environment and return a handle */
  create(config: RuntimeCreateConfig): Promise<RuntimeHandle>;

  /** Destroy a session environment */
  destroy(handle: RuntimeHandle): Promise<void>;

  /** Send a text message/prompt to the running agent */
  sendMessage(handle: RuntimeHandle, message: string): Promise<void>;

  /** Capture recent output from the session */
  getOutput(handle: RuntimeHandle, lines?: number): Promise<string>;

  /**
   * Check if the session environment is still alive.
   * Resolves `false` only when the runtime answers that the session does not
   * exist. Rejects when it cannot tell (server unreachable, timeout, unknown
   * failure), with the failure as `cause`; callers treat a rejection as
   * "unknown", never as dead. A rejection whose `code` is
   * RUNTIME_NO_SERVER_ERROR_CODE means that no runtime server runs at all, so
   * no session can exist; only a caller that replaces a dead session on a
   * human command (`spawnOrchestrator`) acts on it.
   */
  isAlive(handle: RuntimeHandle): Promise<boolean>;

  /**
   * Get resource metrics (uptime, memory, etc.). runtime-tmux reports the age
   * of the tmux session itself (`#{session_created}`), so a new session under
   * an old name shows its own age; the lifecycle compares it with the
   * handle's `createdAt` before it moves a killed record back to working.
   */
  getMetrics?(handle: RuntimeHandle): Promise<RuntimeMetrics>;

  /** Get info needed to attach a human to this session (for Terminal plugin) */
  getAttachInfo?(handle: RuntimeHandle): Promise<AttachInfo>;
}

export interface RuntimeCreateConfig {
  sessionId: SessionId;
  workspacePath: string;
  launchCommand: string;
  environment: Record<string, string>;
}

/** Opaque handle returned by runtime.create() */
export interface RuntimeHandle {
  /** Runtime-specific identifier (tmux session name, container ID, pod name, etc.) */
  id: string;
  /** Which runtime created this handle */
  runtimeName: string;
  /** Runtime-specific data */
  data: Record<string, unknown>;
}

export interface RuntimeMetrics {
  uptimeMs: number;
  memoryMb?: number;
  cpuPercent?: number;
}

export interface AttachInfo {
  /** How to connect: tmux attach, docker exec, SSH, web URL, etc. */
  type: "tmux" | "docker" | "ssh" | "web" | "process";
  /** For tmux: session name. For docker: container ID. For web: URL. */
  target: string;
  /** Optional: command to run to attach */
  command?: string;
}

// =============================================================================
// AGENT — Plugin Slot 2
// =============================================================================

/**
 * Agent adapter for a specific AI coding tool.
 * Knows how to launch, detect activity, and extract session info.
 */
export interface Agent {
  readonly name: string;

  /** Process name to look for (e.g. "claude", "codex", "gemini") */
  readonly processName: string;

  /**
   * How the initial prompt should be delivered to the agent.
   * - "inline" (default): prompt is included in the launch command (e.g. -p flag)
   * - "post-launch": prompt is sent via runtime.sendMessage() after the agent starts,
   *   keeping the agent in interactive mode. Use this for agents where inlining
   *   the prompt causes one-shot/exit behavior (e.g. Claude Code's -p flag).
   */
  readonly promptDelivery?: "inline" | "post-launch";

  /** Get the shell command to launch this agent */
  getLaunchCommand(config: AgentLaunchConfig): string;

  /** Get environment variables for the agent process */
  getEnvironment(config: AgentLaunchConfig): Record<string, string>;

  /**
   * Detect what the agent is currently doing from terminal output.
   * @deprecated Use getActivityState() instead - this uses hacky terminal parsing.
   */
  detectActivity(terminalOutput: string): ActivityState;

  /**
   * Get current activity state using agent-native mechanism (JSONL, SQLite, etc.).
   * This is the preferred method for activity detection.
   * @param readyThresholdMs - ms before "ready" becomes "idle" (default: DEFAULT_READY_THRESHOLD_MS)
   */
  getActivityState(session: Session, readyThresholdMs?: number): Promise<ActivityDetection | null>;

  /**
   * Check if agent process is running (given runtime handle).
   * Resolves `false` when the check ran and found no agent process (also when
   * the runtime answers that the pane does not exist). Rejects when the check
   * cannot run (for example `tmux` or `ps` fails); callers treat a rejection as
   * "unknown", never as "not running".
   */
  isProcessRunning(handle: RuntimeHandle): Promise<boolean>;

  /** Extract information from agent's internal data (summary, cost, session ID) */
  getSessionInfo(session: Session): Promise<AgentSessionInfo | null>;

  /**
   * Optional: get a launch command that resumes a previous session.
   * Returns null if no previous session is found (caller falls back to getLaunchCommand).
   * Core passes `project` with `agentConfig` set to the role-merged launch config of this
   * session (the spawn's model and permission mode); read the model and the permission
   * mode only from there.
   * @param effectiveModel - the resolved model for this session (persisted spawn
   *   --model override, else the config model). Plugins must prefer it over
   *   `project.agentConfig.model` so a spawn override survives a restore.
   *   It is optional for backward compatibility with direct two-arg callers.
   */
  getRestoreCommand?(
    session: Session,
    project: ProjectConfig,
    effectiveModel?: string,
  ): Promise<string | null>;

  /** Optional: run setup after agent is launched (e.g. configure MCP servers) */
  postLaunchSetup?(session: Session): Promise<void>;

  /**
   * Optional: make the agent's own session ready before the pane starts
   * (OpenCode: the model check, then `session.create` or the switch of a
   * reused session, then a readback). Core calls it on spawn and orchestrator
   * start, after the workspace exists and before `getLaunchCommand` and
   * `runtime.create`. Core writes `metadata` to the session record before
   * `runtime.create` and merges `agentConfig` into the launch config that
   * `getLaunchCommand` gets. A throw fails the spawn before any pane starts;
   * the hook removes what it created itself before it throws.
   */
  prepareAgentSession?(
    config: AgentLaunchConfig,
    context: AgentSessionPrepareContext,
  ): Promise<PreparedAgentSession>;

  /**
   * Optional: prove that the pane runs the agent on the prepared session,
   * within `options.timeoutMs`. Core calls it after `runtime.create` and
   * `postLaunchSetup`, and only when `prepareAgentSession` ran. A throw fails
   * the spawn: core destroys the runtime, calls `prepared.discard()`, destroys
   * the workspace and deletes the record.
   */
  confirmLaunch?(
    session: Session,
    prepared: PreparedAgentSession,
    options: AgentLaunchConfirmOptions,
  ): Promise<AgentLaunchConfirmation>;

  /**
   * Optional (I-5): true when `deliverMessage` can deliver to this session
   * (OpenCode: the record holds a valid stored session ID). Core and the CLI
   * call it to choose the delivery path. When it is absent or false, the
   * session keeps the runtime path (`runtime.sendMessage`).
   */
  canDeliverMessage?(session: Session): boolean;

  /**
   * Optional (I-5): throws when `deliverMessage` can never deliver `message`
   * (OpenCode: the `session.prompt` body is over the argument limit). Core
   * calls it before it prepares the session, so a message that can never go
   * causes no restore.
   */
  checkMessage?(message: string): void;

  /**
   * Optional (I-5): deliver `message` through the agent's own API instead of
   * the runtime (OpenCode: `session.prompt`). Core calls it after it prepared
   * the session (a dead runtime or agent process is restored first, a
   * `spawning` session is waited for), and only when `canDeliverMessage` is
   * true. It replaces `runtime.sendMessage` and the screen-diff confirmation:
   * it returns the record of the admitted message, or throws.
   *
   * Right before its API call, the hook gets the input ID from
   * `attempt.begin`: core persists that ID in the delivery ledger of the
   * agent session first, and gives back the ID of an earlier attempt of the
   * same text that may have been admitted (its admission stayed unknown, or
   * the attempt ended without a settle that wrote, for example because its
   * process ended), so the service admits one logical send at most once.
   * When `begin` throws, nothing may be sent. Without `attempt`, the hook
   * mints an ID that nothing persists.
   *
   * `AgentNotAttachedError` (thrown before `begin`) means that nothing was
   * delivered because the interactive agent process that the delivery needs
   * does not run on the session; core then restores the session once and
   * calls the hook again. Thrown after `begin`, it is final (no restore). `restore` replaces the pane only when
   * `isRestorable` is true (a terminal status or an exited agent, never
   * `merged`), so a pane under a `working` record that runs another agent
   * process stays, and the send fails; a live pane under a `killed` or `done`
   * record is replaced (inherited behavior).
   * After `begin`, an `AgentDeliveryError` with `admission: "none"` means
   * that the service admitted nothing; every other throw after `begin`
   * leaves the admission unknown. The hook calls the API once per call.
   */
  deliverMessage?(
    session: Session,
    message: string,
    attempt?: AgentDeliveryAttempt,
  ): Promise<AgentMessageDelivery>;

  /**
   * Optional: Set up agent-specific hooks/config in the workspace for automatic metadata updates.
   * Called once per workspace during ao init/start and when creating new worktrees.
   *
   * Each agent plugin implements this for their own config format:
   * - Claude Code: writes .claude/settings.json with PostToolUse hook
   * - Codex: whatever config mechanism Codex uses
   * - Aider: .aider.conf.yml or similar
   * - OpenCode: its own config
   *
   * CRITICAL: lifecycle and status reporting depend on metadata being auto-updated when agents
   * run git/gh commands. Without this, PRs created by agents never show up.
   */
  setupWorkspaceHooks?(workspacePath: string, config: WorkspaceHooksConfig): Promise<void>;

  /**
   * Optional: Record an activity observation to the session's JSONL activity log.
   * Called by the lifecycle manager during each poll cycle with captured terminal output.
   *
   * Plugins classify the terminal output (via detectActivity) and append a JSONL entry
   * to `{session.workspacePath}/.ao/activity.jsonl`. The next `getActivityState()` call
   * reads from this file to detect states like `waiting_input` and `blocked`.
   *
   * Agents with native JSONL (Claude Code, Codex) should NOT implement this — their
   * `getActivityState` already reads richer data from the agent's own session files.
   */
  recordActivity?(session: Session, terminalOutput: string): Promise<void>;
}

export interface AgentLaunchConfig {
  sessionId: SessionId;
  projectConfig: ProjectConfig;
  issueId?: string;
  prompt?: string;
  permissions?: AgentPermissionInput;
  model?: string;
  /**
   * System prompt to pass to the agent for orchestrator context.
   * - Claude Code: --append-system-prompt
   * - Codex: --system-prompt or AGENTS.md
   * - Aider: --system-prompt flag
   * - OpenCode: equivalent mechanism
   *
   * For short prompts only. For long prompts, use systemPromptFile instead
   * to avoid shell/tmux truncation issues.
   */
  systemPrompt?: string;
  /**
   * Path to a file containing the system prompt.
   * Preferred over systemPrompt for long prompts (e.g. orchestrator prompts)
   * because inlining 2000+ char prompts in shell commands causes truncation.
   *
   * When set, takes precedence over systemPrompt.
   * - Claude Code: --append-system-prompt "$(cat /path/to/file)"
   * - Codex/Aider: similar shell substitution
   */
  systemPromptFile?: string;
  /**
   * Specialized OpenCode subagent to use (e.g., sisyphus, oracle, librarian).
   * Requires oh-my-opencode to be installed.
   * Use --subagent flag to select the subagent.
   */
  subagent?: string;
}

/** What `Agent.prepareAgentSession` gets besides the launch config. */
export interface AgentSessionPrepareContext {
  /** The workspace that the pane starts in. */
  workspacePath: string;
  /**
   * The environment map that core passes to `runtime.create` for this
   * session: the agent environment plus the session's own `AO_*` values. Every
   * external call of the hook runs with it, never with the `AO_*` values of
   * the `ao` process (which, for a spawn from an orchestrator, are the
   * orchestrator's).
   */
  environment: Record<string, string>;
}

/** The agent session that `prepareAgentSession` made ready. */
export interface PreparedAgentSession {
  /** Keys that core writes to the session record before `runtime.create`. */
  metadata: Record<string, string>;
  /** Values that core merges into `projectConfig.agentConfig` for `getLaunchCommand`. */
  agentConfig: Record<string, unknown>;
  /** True when this call created the agent session; false when it reused one. */
  created: boolean;
  /**
   * Remove the agent session when this call created it; a reused session is
   * never removed. Best effort: it never throws, and it tells the operator
   * when the removal fails.
   */
  discard(): Promise<void>;
}

export interface AgentLaunchConfirmOptions {
  /** Bound on the proof that the pane runs the agent on the prepared session. */
  timeoutMs: number;
  /** True when the launch command gives the agent a prompt. */
  promptExpected: boolean;
  /** Bound on the wait for the prompt to reach the agent session. */
  promptTimeoutMs: number;
}

export interface AgentLaunchConfirmation {
  /** Whether the launch prompt reached the agent; absent when the agent cannot tell. */
  promptDelivered?: boolean;
}

/** A pending human answer that a delivered message waits behind. */
export type AgentPendingInput = "permission" | "question";

/** What `Agent.deliverMessage` reports for one admitted message (I-5). */
export interface AgentMessageDelivery {
  /** The agent's ID of the admitted input (OpenCode: the inbox item ID, `msg_...`). */
  inputId: string;
  /** How the agent schedules the input (OpenCode: `queue`, after the last answer of a running turn). */
  mode: string;
  /** True when the agent ran a turn at the send, so the input waits for that turn; absent when unknown. */
  busy?: boolean;
  /** The pending human answers that the input waits behind (empty: none); absent when unknown. */
  waitsFor?: readonly AgentPendingInput[];
  /** True when the answer of the admission was lost and a read-back of the session found the input. */
  recovered?: boolean;
  /**
   * True when the service answered with an input that an earlier attempt with
   * the same input ID admitted: this send admitted nothing new.
   */
  replayed?: boolean;
}

/**
 * The input ID of one logical send (I-5). `begin` is called by the agent
 * once, right before its API call, with the agent's ID generator and `key`,
 * the agent session that gets the input (OpenCode: the stored `ses_...`
 * ID). Core keeps one delivery ledger per key. Before it resolves, it holds
 * the attempt lock of this attempt (a lock that the OS releases, held until
 * the send ends) and writes the entry (state `sending`) under the ledger
 * lock. It resolves the ID to use: the ID of an earlier attempt of the same
 * text to the same key that may have been admitted and that is not in
 * flight, or a new ID from `mint`. It rejects when the ID cannot be
 * persisted; then the agent sends nothing.
 */
export interface AgentDeliveryAttempt {
  begin(mint: () => string, key: string): Promise<string>;
}

/** How `SessionManager.deliver` sent one message. */
export type SessionMessageDelivery =
  | {
      route: "agent";
      delivery: AgentMessageDelivery;
      /**
       * I-5 (M-5): the message was admitted, but the delivery ledger could
       * not mark the entry `admitted` (the write failed three times). While
       * this process runs (at most 11 min), a send of the same text gets a
       * new ID; after this process ends, a send of the same text to the same
       * agent session in the 10 min after this one can reuse the ID and
       * admit nothing new. Absent when the ledger recorded the admission.
       */
      admissionUnrecorded?: true;
    }
  | { route: "runtime" };

export interface WorkspaceHooksConfig {
  /** Data directory where session metadata files are stored */
  dataDir: string;
  /** Optional session ID (may not be known at ao init time) */
  sessionId?: string;
}

export interface AgentSessionInfo {
  /** Agent's auto-generated summary of what it's working on */
  summary: string | null;
  /** True when summary is a fallback (e.g. truncated first user message), not a real agent summary */
  summaryIsFallback?: boolean;
  /** Agent's internal session ID (for resume) */
  agentSessionId: string | null;
  /** Estimated cost so far */
  cost?: CostEstimate;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

// =============================================================================
// WORKSPACE — Plugin Slot 3
// =============================================================================

/**
 * Workspace manages code isolation — how each session gets its own copy of the repo.
 */
export interface Workspace {
  readonly name: string;

  /** Create an isolated workspace for a session */
  create(config: WorkspaceCreateConfig): Promise<WorkspaceInfo>;

  /**
   * Destroy a workspace.
   *
   * `stillOwned` (optional, round 7): the caller's ownership check. Every
   * launch of a session ID can use the same workspace path, and the plugin's
   * own steps await. The plugin runs the check directly before each step
   * that removes files (also a fallback or a retry), with no await between
   * the check and the step. When it answers false or throws, the plugin
   * removes nothing more and resolves `"kept"`. Without it, the plugin works
   * as before and resolves `undefined`.
   */
  destroy(workspacePath: string, stillOwned?: () => boolean): Promise<"kept" | undefined>;

  /** List existing workspaces for a project */
  list(projectId: string): Promise<WorkspaceInfo[]>;

  /** Optional: run hooks after workspace creation (symlinks, installs, etc.) */
  postCreate?(info: WorkspaceInfo, project: ProjectConfig): Promise<void>;

  /** Optional: check if a workspace exists and is a valid git repo */
  exists?(workspacePath: string): Promise<boolean>;

  /** Optional: restore a workspace (e.g. recreate a worktree for an existing branch) */
  restore?(config: WorkspaceCreateConfig, workspacePath: string): Promise<WorkspaceInfo>;
}

export interface WorkspaceCreateConfig {
  projectId: string;
  project: ProjectConfig;
  sessionId: SessionId;
  branch: string;
}

export interface WorkspaceInfo {
  path: string;
  branch: string;
  sessionId: SessionId;
  projectId: string;
}

// =============================================================================
// TRACKER — Plugin Slot 4
// =============================================================================

/**
 * Issue/task tracker integration — GitHub Issues, Linear, Jira, etc.
 */
export interface Tracker {
  readonly name: string;

  /** Fetch issue details */
  getIssue(identifier: string, project: ProjectConfig): Promise<Issue>;

  /** Check if issue is completed/closed */
  isCompleted(identifier: string, project: ProjectConfig): Promise<boolean>;

  /** Generate a URL for the issue */
  issueUrl(identifier: string, project: ProjectConfig): string;

  /** Extract a human-readable label from an issue URL (e.g., "INT-1327", "#42") */
  issueLabel?(url: string, project: ProjectConfig): string;

  /** Generate a git branch name for the issue */
  branchName(identifier: string, project: ProjectConfig): string;

  /** Generate a prompt for the agent to work on this issue */
  generatePrompt(identifier: string, project: ProjectConfig): Promise<string>;

  /** Optional: list issues with filters */
  listIssues?(filters: IssueFilters, project: ProjectConfig): Promise<Issue[]>;

  /** Optional: update issue state */
  updateIssue?(identifier: string, update: IssueUpdate, project: ProjectConfig): Promise<void>;

  /** Optional: create a new issue */
  createIssue?(input: CreateIssueInput, project: ProjectConfig): Promise<Issue>;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  url: string;
  state: "open" | "in_progress" | "closed" | "cancelled";
  labels: string[];
  assignee?: string;
  priority?: number;
}

export interface IssueFilters {
  state?: "open" | "closed" | "all";
  labels?: string[];
  assignee?: string;
  limit?: number;
}

export interface IssueUpdate {
  state?: "open" | "in_progress" | "closed";
  labels?: string[];
  removeLabels?: string[];
  assignee?: string;
  comment?: string;
}

export interface CreateIssueInput {
  title: string;
  description: string;
  labels?: string[];
  assignee?: string;
  priority?: number;
}

// =============================================================================
// SCM — Plugin Slot 5
// =============================================================================

/**
 * Source code management platform — PR lifecycle, CI checks, code reviews.
 * This is the richest plugin interface, covering the full PR pipeline.
 */
export interface SCM {
  readonly name: string;

  verifyWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookVerificationResult>;

  parseWebhook?(
    request: SCMWebhookRequest,
    project: ProjectConfig,
  ): Promise<SCMWebhookEvent | null>;

  // --- PR Lifecycle ---

  /** Detect if a session has an open PR (by branch name) */
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>;

  /** Resolve a PR reference (number or URL) into canonical PR metadata. */
  resolvePR?(reference: string, project: ProjectConfig): Promise<PRInfo>;

  /** Assign a PR to the currently authenticated user, if supported. */
  assignPRToCurrentUser?(pr: PRInfo): Promise<void>;

  /** Check out the PR branch into a workspace. Returns true if branch changed. */
  checkoutPR?(pr: PRInfo, workspacePath: string): Promise<boolean>;

  /** Get current PR state */
  getPRState(pr: PRInfo): Promise<PRState>;

  /** Get PR summary with stats (state, title, additions, deletions). Optional. */
  getPRSummary?(pr: PRInfo): Promise<{
    state: PRState;
    title: string;
    additions: number;
    deletions: number;
  }>;

  /** Merge a PR */
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>;

  /** Close a PR without merging */
  closePR(pr: PRInfo): Promise<void>;

  // --- CI Tracking ---

  /** Get individual CI check statuses */
  getCIChecks(pr: PRInfo): Promise<CICheck[]>;

  /** Get overall CI summary */
  getCISummary(pr: PRInfo): Promise<CIStatus>;

  // --- Review Tracking ---

  /** Get all reviews on a PR */
  getReviews(pr: PRInfo): Promise<Review[]>;

  /** Get the overall review decision */
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>;

  /** Get pending (unresolved) review comments */
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>;

  /** Get automated review comments (bots, linters, security scanners) */
  getAutomatedComments(pr: PRInfo): Promise<AutomatedComment[]>;

  // --- Merge Readiness ---

  /** Check if PR is ready to merge */
  getMergeability(pr: PRInfo): Promise<MergeReadiness>;

  /**
   * Batch fetch PR data for multiple PRs in a single GraphQL query.
   * Used by the orchestrator to poll all active sessions efficiently.
   *
   * This is an optimization method that, when implemented, can dramatically
   * reduce API calls by fetching data for multiple PRs in one request
   * instead of calling getPRState/getCISummary/getReviewDecision separately
   * for each PR.
   *
   * @param prs - Array of PR information to fetch data for
   * @param observer - Optional observer for batch operation metrics
   * @returns Map keyed by "${owner}/${repo}#${number}" containing enrichment data
   */
  enrichSessionsPRBatch?(
    prs: PRInfo[],
    observer?: BatchObserver,
  ): Promise<Map<string, PREnrichmentData>>;
}

// --- PR Types ---

export interface PRInfo {
  number: number;
  url: string;
  title: string;
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  isDraft: boolean;
}

export type PRState = "open" | "merged" | "closed";

/** PR state constants */
export const PR_STATE = {
  OPEN: "open" as const,
  MERGED: "merged" as const,
  CLOSED: "closed" as const,
} satisfies Record<string, PRState>;

export type MergeMethod = "merge" | "squash" | "rebase";

export interface SCMWebhookRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  rawBody?: Uint8Array;
  path?: string;
  query?: Record<string, string | string[] | undefined>;
}

export interface SCMWebhookVerificationResult {
  ok: boolean;
  reason?: string;
  deliveryId?: string;
  eventType?: string;
}

export type SCMWebhookEventKind = "pull_request" | "ci" | "review" | "comment" | "push" | "unknown";

export interface SCMWebhookEvent {
  provider: string;
  kind: SCMWebhookEventKind;
  action: string;
  rawEventType: string;
  deliveryId?: string;
  projectId?: string;
  repository?: {
    owner: string;
    name: string;
  };
  prNumber?: number;
  branch?: string;
  sha?: string;
  timestamp?: Date;
  data: Record<string, unknown>;
}

// --- CI Types ---

export interface CICheck {
  name: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  url?: string;
  conclusion?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export type CIStatus = "pending" | "passing" | "failing" | "none";

/** CI status constants */
export const CI_STATUS = {
  PENDING: "pending" as const,
  PASSING: "passing" as const,
  FAILING: "failing" as const,
  NONE: "none" as const,
} satisfies Record<string, CIStatus>;

// --- Review Types ---

export interface Review {
  author: string;
  state: "approved" | "changes_requested" | "commented" | "dismissed" | "pending";
  body?: string;
  submittedAt: Date;
}

export type ReviewDecision = "approved" | "changes_requested" | "pending" | "none";

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  path?: string;
  line?: number;
  isResolved: boolean;
  createdAt: Date;
  url: string;
}

export interface AutomatedComment {
  id: string;
  botName: string;
  body: string;
  path?: string;
  line?: number;
  severity: "error" | "warning" | "info";
  createdAt: Date;
  url: string;
}

// --- Merge Readiness ---

export interface MergeReadiness {
  mergeable: boolean;
  ciPassing: boolean;
  approved: boolean;
  noConflicts: boolean;
  blockers: string[];
}

/**
 * Batch enrichment data returned by SCM plugins.
 * Contains all the information the orchestrator needs for status detection.
 */
export interface PREnrichmentData {
  /** Current PR state */
  state: PRState;
  /** Overall CI status */
  ciStatus: CIStatus;
  /** Review decision */
  reviewDecision: ReviewDecision;
  /** Whether the PR is mergeable based on CI, reviews, and merge state */
  mergeable: boolean;
  /** PR title */
  title?: string;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
  /** Whether PR is a draft */
  isDraft?: boolean;
  /** Whether PR has merge conflicts */
  hasConflicts?: boolean;
  /** Whether PR is behind base branch */
  isBehind?: boolean;
  /** List of blockers preventing merge */
  blockers?: string[];
  /** Individual CI check results (populated from batch enrichment when available) */
  ciChecks?: CICheck[];
}

/**
 * Observer for GraphQL batch PR enrichment operations.
 * Used by SCM plugins to report batch success/failure to the observability system.
 */
export interface BatchObserver {
  /** Record a successful batch enrichment */
  recordSuccess(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    durationMs: number;
  }): void;
  /** Record a failed batch enrichment */
  recordFailure(data: {
    batchIndex: number;
    totalBatches: number;
    prCount: number;
    error: string;
    durationMs: number;
  }): void;
  /** Log a message at a specific level */
  log(level: ObservabilityLevel, message: string): void;
}

// =============================================================================
// NOTIFIER — Plugin Slot 6 (PRIMARY INTERFACE)
// =============================================================================

/**
 * Notifier is the PRIMARY interface between the orchestrator and the human.
 * The human walks away after spawning agents. Notifications bring them back.
 *
 * Push, not pull. The human never polls.
 */
export interface Notifier {
  readonly name: string;

  /** Push a notification to the human */
  notify(event: OrchestratorEvent): Promise<void>;

  /** Push a notification with actionable buttons/links */
  notifyWithActions?(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void>;

  /** Post a message to a channel (for team-visible notifiers like Slack) */
  post?(message: string, context?: NotifyContext): Promise<string | null>;
}

export interface NotifyAction {
  label: string;
  url?: string;
  callbackEndpoint?: string;
}

export interface NotifyContext {
  sessionId?: SessionId;
  projectId?: string;
  prUrl?: string;
  channel?: string;
}

// =============================================================================
// TERMINAL — Plugin Slot 7
// =============================================================================

/**
 * Terminal manages how humans view/interact with running sessions.
 * Opens IDE tabs, browser windows, or terminal sessions.
 */
export interface Terminal {
  readonly name: string;

  /** Open a session for human interaction */
  openSession(session: Session): Promise<void>;

  /** Open all sessions for a project */
  openAll(sessions: Session[]): Promise<void>;

  /** Check if a session is already open in a tab/window */
  isSessionOpen?(session: Session): Promise<boolean>;
}

// =============================================================================
// EVENTS
// =============================================================================

/** Priority levels for events — determines notification routing */
export type EventPriority = "urgent" | "action" | "warning" | "info";

/** All orchestrator event types */
export type EventType =
  // Session lifecycle
  | "session.spawned"
  | "session.working"
  | "session.exited"
  | "session.killed"
  | "session.idle"
  | "session.stuck"
  | "session.needs_input"
  | "session.errored"
  // PR lifecycle
  | "pr.created"
  | "pr.updated"
  | "pr.merged"
  | "pr.closed"
  // CI
  | "ci.passing"
  | "ci.failing"
  | "ci.fix_sent"
  | "ci.fix_failed"
  // Reviews
  | "review.pending"
  | "review.approved"
  | "review.changes_requested"
  | "review.comments_sent"
  | "review.comments_unresolved"
  // Automated reviews
  | "automated_review.found"
  | "automated_review.fix_sent"
  // Merge
  | "merge.ready"
  | "merge.conflicts"
  | "merge.completed"
  // Reactions
  | "reaction.triggered"
  | "reaction.escalated"
  // Summary
  | "summary.all_complete";

/** An event emitted by the orchestrator */
export interface OrchestratorEvent {
  id: string;
  type: EventType;
  priority: EventPriority;
  sessionId: SessionId;
  projectId: string;
  timestamp: Date;
  message: string;
  data: Record<string, unknown>;
}

// =============================================================================
// REACTIONS
// =============================================================================

/** A configured automatic reaction to an event */
export interface ReactionConfig {
  /** Whether this reaction is enabled */
  auto: boolean;

  /** What to do: send message to agent, notify human, auto-merge */
  action: "send-to-agent" | "notify" | "auto-merge";

  /** Message to send (for send-to-agent) */
  message?: string;

  /** Priority for notifications */
  priority?: EventPriority;

  /** How many times to retry send-to-agent before escalating */
  retries?: number;

  /** Escalate to human notification after this many failures or this duration */
  escalateAfter?: number | string;

  /** Threshold duration for time-based triggers (e.g. "10m" for stuck detection) */
  threshold?: string;

  /** Whether to include a summary in the notification */
  includeSummary?: boolean;
}

export interface ReactionResult {
  reactionType: string;
  success: boolean;
  action: string;
  message?: string;
  escalated: boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Top-level orchestrator configuration (from agent-orchestrator.yaml) */
export interface OrchestratorConfig {
  /**
   * Path to the config file (set automatically during load).
   * Used for hash-based directory structure.
   * All paths are auto-derived from this location.
   */
  configPath: string;

  /** @deprecated Legacy dashboard setting; ignored by the headless distribution. */
  port?: number;

  /** @deprecated Legacy dashboard setting; ignored by the headless distribution. */
  terminalPort?: number;

  /** @deprecated Legacy dashboard setting; ignored by the headless distribution. */
  directTerminalPort?: number;

  /** Milliseconds before a "ready" session becomes "idle" (default: 300000 = 5 min) */
  readyThresholdMs: number;

  /** Default plugin selections */
  defaults: DefaultPlugins;

  /** Installer-managed external plugin descriptors */
  plugins?: InstalledPluginConfig[];

  /** Project configurations */
  projects: Record<string, ProjectConfig>;

  /** Notification channel configs */
  notifiers: Record<string, NotifierConfig>;

  /** Notification routing by priority */
  notificationRouting: Record<EventPriority, string[]>;

  /** Default reaction configs */
  reactions: Record<string, ReactionConfig>;

  /**
   * Internal: External plugin entries collected from inline tracker/scm/notifier configs.
   * Used by plugin-registry for manifest validation. Set automatically during config validation.
   */
  _externalPluginEntries?: ExternalPluginEntryRef[];
}

/**
 * Structured location of an external plugin config.
 * Used to update config with manifest.name after loading (avoids parsing dotted strings).
 */
export type ExternalPluginLocation =
  | { kind: "project"; projectId: string; configType: "tracker" | "scm" }
  | { kind: "notifier"; notifierId: string };

/**
 * Reference to an external plugin config (from inline tracker/scm/notifier configs).
 * Used for manifest.name validation during plugin loading.
 */
export interface ExternalPluginEntryRef {
  /** Where this config came from (for error messages) */
  source: string;
  /** Structured location for updating config (avoids parsing source string) */
  location: ExternalPluginLocation;
  /** The slot this plugin fills */
  slot: "tracker" | "scm" | "notifier";
  /** npm package name (if specified) */
  package?: string;
  /** Local path (if specified) */
  path?: string;
  /**
   * Expected plugin name (manifest.name).
   * Only set when user explicitly specified `plugin` field.
   * When undefined, any manifest.name is accepted and config is updated with it.
   */
  expectedPluginName?: string;
}

export interface DefaultPlugins {
  runtime: string;
  agent: string;
  workspace: string;
  notifiers: string[];
  orchestrator?: {
    agent?: string;
  };
  worker?: {
    agent?: string;
  };
}

export type InstalledPluginSource = "npm" | "local";

export interface InstalledPluginConfig {
  /** Stable logical plugin name used in config and CLI UX */
  name: string;

  /** Where the plugin should be resolved from */
  source: InstalledPluginSource;

  /** Package name for an already installed npm plugin */
  package?: string;

  /** Informational requested version/range; AO does not install it */
  version?: string;

  /** Filesystem path for local plugins */
  path?: string;

  /** Enable flag (defaults to true) */
  enabled?: boolean;
}

export interface RoleAgentConfig {
  agent?: string;
  agentConfig?: AgentSpecificConfig;
}

export interface ProjectConfig {
  /** Display name */
  name: string;

  /** GitHub repo in "owner/repo" format */
  repo: string;

  /** Local path to the repo */
  path: string;

  /** Default branch (main, master, next, develop, etc.) */
  defaultBranch: string;

  /** Session name prefix (e.g. "app" → "app-1", "app-2") */
  sessionPrefix: string;

  /** Override default runtime */
  runtime?: string;

  /** Override default agent */
  agent?: string;

  /** Override default workspace */
  workspace?: string;

  /** Issue tracker configuration */
  tracker?: TrackerConfig;

  /** SCM configuration (usually inferred from repo) */
  scm?: SCMConfig;

  /** Files/dirs to symlink into workspaces */
  symlinks?: string[];

  /** Commands to run after workspace creation */
  postCreate?: string[];

  /** Agent-specific configuration */
  agentConfig?: AgentSpecificConfig;

  orchestrator?: RoleAgentConfig;

  worker?: RoleAgentConfig;

  /** Per-project reaction overrides */
  reactions?: Record<string, Partial<ReactionConfig>>;

  /** Inline rules/instructions passed to every agent prompt */
  agentRules?: string;

  /** Path to a file containing agent rules (relative to project path) */
  agentRulesFile?: string;

  /** Rules for the orchestrator agent (stored, reserved for future use) */
  orchestratorRules?: string;

  /**
   * Where orchestrator sessions run:
   * - isolated: dedicated workspace plugin instance (default)
   * - project: run directly in project.path using a single legacy orchestrator session
   */
  orchestratorWorkspaceMode?: "isolated" | "project";

  orchestratorSessionStrategy?:
    | "reuse"
    | "delete"
    | "ignore"
    | "delete-new"
    | "ignore-new"
    | "kill-previous";

  opencodeIssueSessionStrategy?: "reuse" | "delete" | "ignore";

  /** Task decomposition configuration */
  decomposer?: {
    /** Enable auto-decomposition for backlog issues (default: false) */
    enabled: boolean;
    /** Max recursion depth (default: 3) */
    maxDepth: number;
    /** Model to use for decomposition (default: claude-sonnet-4-20250514) */
    model: string;
    /** Require human approval before executing decomposed plans (default: true) */
    requireApproval: boolean;
  };
}

export interface TrackerConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input, inferred from repo (github/gitlab), or auto-generated from
   * package/path via generateTempPluginName(). The optional typing exists for raw config
   * input before validation. Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-tracker-jira") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  /** Plugin-specific config (e.g. teamId for Linear) */
  [key: string]: unknown;
}

export interface SCMConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input, inferred from repo (github/gitlab), or auto-generated from
   * package/path via generateTempPluginName(). The optional typing exists for raw config
   * input before validation. Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-scm-bitbucket") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  webhook?: SCMWebhookConfig;
  [key: string]: unknown;
}

export interface SCMWebhookConfig {
  enabled?: boolean;
  path?: string;
  secretEnvVar?: string;
  signatureHeader?: string;
  eventHeader?: string;
  deliveryHeader?: string;
  maxBodyBytes?: number;
}

export interface NotifierConfig {
  /**
   * Plugin name (manifest.name). Required when using built-in plugins.
   * Optional when `package` or `path` is specified (will be inferred from manifest).
   * When both plugin and package/path are specified, manifest.name must match plugin.
   *
   * POST-VALIDATION INVARIANT: After validateConfig(), this field is ALWAYS populated.
   * Either from user input or auto-generated from package/path via generateTempPluginName().
   * The optional typing exists for raw config input before validation.
   * Downstream code can safely assume non-null after validation.
   */
  plugin?: string;
  /** npm package name for external plugins (e.g. "@acme/ao-plugin-notifier-teams") */
  package?: string;
  /** Local filesystem path for external plugins (relative to config file or absolute) */
  path?: string;
  [key: string]: unknown;
}

export interface AgentSpecificConfig {
  permissions?: AgentPermissionMode;
  model?: string;
  orchestratorModel?: string;
  [key: string]: unknown;
}

export interface OpenCodeAgentConfig extends AgentSpecificConfig {
  opencodeSessionId?: string;
}

/**
 * Canonical cross-agent permission policy mode.
 *
 * Semantics:
 * - permissionless: run without interactive permission prompts (most permissive mode).
 * - default: use the agent's normal/default permission model.
 * - auto-edit: automatically approve edit actions where the agent supports granular approval policies.
 * - suggest: conservative mode that asks for approval on higher-risk/untrusted actions where supported.
 *
 * Note: Not every agent exposes all granular policies; plugins map these modes to
 * their closest supported behavior.
 */
export type AgentPermissionMode = "permissionless" | "default" | "auto-edit" | "suggest";

/** Backward-compatible legacy alias accepted in config parsing. */
export type LegacyAgentPermissionMode = "skip";

/** Raw permission input (supports legacy aliases). */
export type AgentPermissionInput = AgentPermissionMode | LegacyAgentPermissionMode;

/** Normalize legacy aliases to canonical permission modes. */
export function normalizeAgentPermissionMode(
  mode: string | undefined,
): AgentPermissionMode | undefined {
  if (!mode) return undefined;
  if (
    mode !== "permissionless" &&
    mode !== "default" &&
    mode !== "auto-edit" &&
    mode !== "suggest"
  ) {
    if (mode === "skip") return "permissionless";
    return undefined;
  }
  return mode;
}

// =============================================================================
// PLUGIN SYSTEM
// =============================================================================

/** Plugin slot types */
export type PluginSlot =
  | "runtime"
  | "agent"
  | "workspace"
  | "tracker"
  | "scm"
  | "notifier"
  | "terminal";

/** Plugin manifest — what every plugin exports */
export interface PluginManifest {
  /** Plugin name (e.g. "tmux", "claude-code", "github") */
  name: string;

  /** Which slot this plugin fills */
  slot: PluginSlot;

  /** Human-readable description */
  description: string;

  /** Version */
  version: string;

  /** Human-readable display name (e.g. "Claude Code") */
  displayName?: string;
}

/** What a plugin module must export */
export interface PluginModule<T = unknown> {
  manifest: PluginManifest;
  create(config?: Record<string, unknown>): T;

  /** Optional: detect whether this plugin's runtime/binary is available on the system. */
  detect?(): boolean;
}

// =============================================================================
// SESSION METADATA (flat file format)
// =============================================================================

/**
 * Session metadata stored as flat key=value files.
 * Matches the existing bash script format for backwards compatibility.
 *
 * Note: In the new architecture, session files are named with user-facing names
 * (e.g., "int-1") and contain a tmuxName field for the globally unique tmux name
 * (e.g., "a3b4c5d6e7f8-int-1").
 */
export interface SessionMetadata {
  worktree: string;
  branch: string;
  status: string;
  tmuxName?: string; // Globally unique tmux session name (includes hash)
  issue?: string;
  pr?: string;
  prAutoDetect?: "on" | "off";
  summary?: string;
  project?: string;
  agent?: string; // Agent plugin name (e.g. "codex", "claude-code") — persisted for lifecycle
  model?: string; // Spawn --model override (C-04) — persisted for restore
  permissions?: string; // Spawn permission mode (effective; "default" when the config object
  // sets no mode — the YAML loader always sets one, default `permissionless`) — persisted for restore
  createdAt?: string;
  runtimeHandle?: string;
  restoredAt?: string;
  role?: string; // "orchestrator" for orchestrator sessions
  dashboardPort?: number;
  terminalWsPort?: number;
  directTerminalWsPort?: number;
  opencodeSessionId?: string;
  pinnedSummary?: string; // First quality summary, pinned for display stability
}

// =============================================================================
// SERVICE INTERFACES (core, not pluggable)
// =============================================================================

/** Session manager — CRUD for sessions */
export interface SessionManager {
  spawn(config: SessionSpawnConfig): Promise<Session>;
  spawnOrchestrator(config: OrchestratorSpawnConfig): Promise<Session>;
  restore(sessionId: SessionId): Promise<Session>;
  list(projectId?: string): Promise<Session[]>;
  get(sessionId: SessionId): Promise<Session | null>;
  kill(sessionId: SessionId, options?: { purgeOpenCode?: boolean }): Promise<void>;
  cleanup(
    projectId?: string,
    options?: { dryRun?: boolean; purgeOpenCode?: boolean },
  ): Promise<CleanupResult>;
  send(sessionId: SessionId, message: string): Promise<void>;
  /**
   * Optional (I-5): `send` that also reports the route and, for an agent
   * delivery, the record of `Agent.deliverMessage`. Same behavior and same
   * errors as `send`.
   */
  deliver?(sessionId: SessionId, message: string): Promise<SessionMessageDelivery>;
  claimPR(sessionId: SessionId, prRef: string, options?: ClaimPROptions): Promise<ClaimPRResult>;
}

/** OpenCode-specific session manager with remap capability */
export interface OpenCodeSessionManager extends SessionManager {
  /** Remap session to OpenCode session ID, returns the mapped OpenCode session ID */
  remap(sessionId: SessionId, force?: boolean): Promise<string>;
}

export interface ClaimPROptions {
  assignOnGithub?: boolean;
  takeover?: boolean;
}

export interface ClaimPRResult {
  sessionId: SessionId;
  projectId: string;
  pr: PRInfo;
  branchChanged: boolean;
  githubAssigned: boolean;
  githubAssignmentError?: string;
  takenOverFrom: SessionId[];
}

/** Type guard to check if a SessionManager supports OpenCode-specific remap operation */
export function isOpenCodeSessionManager(sm: SessionManager): sm is OpenCodeSessionManager {
  return typeof (sm as OpenCodeSessionManager).remap === "function";
}

export interface CleanupResult {
  killed: string[];
  skipped: string[];
  errors: Array<{ sessionId: string; error: string }>;
}

/** Lifecycle manager — state machine + reaction engine */
export interface LifecycleManager {
  /** Start the lifecycle polling loop */
  start(intervalMs?: number): void;

  /** Stop the lifecycle polling loop */
  stop(): void;

  /** Get current state for all sessions */
  getStates(): Map<SessionId, SessionStatus>;

  /** Force-check a specific session now */
  check(sessionId: SessionId): Promise<void>;
}

/** Plugin registry — discovery + loading */
export interface PluginRegistry {
  /** Register a plugin, optionally with config to pass to create() */
  register(plugin: PluginModule, config?: Record<string, unknown>): void;

  /** Get a plugin by slot and name */
  get<T>(slot: PluginSlot, name: string): T | null;

  /** List plugins for a slot */
  list(slot: PluginSlot): PluginManifest[];

  /** Load built-in plugins, optionally with orchestrator config for plugin settings */
  loadBuiltins(
    config?: OrchestratorConfig,
    importFn?: (pkg: string) => Promise<unknown>,
  ): Promise<void>;

  /** Load plugins from config (npm packages, local paths) */
  loadFromConfig(
    config: OrchestratorConfig,
    importFn?: (pkg: string) => Promise<unknown>,
  ): Promise<void>;
}

// =============================================================================
// ERROR DETECTION HELPERS
// =============================================================================

/**
 * Detect if an error indicates that an issue was not found in the tracker.
 * Used by spawn validation to distinguish "not found" from other errors (auth, network, etc).
 *
 * Uses specific patterns to avoid matching infrastructure errors like "API key not found",
 * "Team not found", "Configuration not found", etc.
 */
export function isIssueNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = (err as Error).message?.toLowerCase() || "";

  // Match issue-specific not-found patterns
  return (
    (message.includes("issue") &&
      (message.includes("not found") || message.includes("does not exist"))) ||
    message.includes("no issue found") ||
    message.includes("could not find issue") ||
    // GitHub: "no issue found" or "could not resolve to an Issue"
    message.includes("could not resolve to an issue") ||
    // Linear: "Issue <id> not found" or "No issue with identifier"
    message.includes("no issue with identifier") ||
    // GitHub: "invalid issue format" (ad-hoc free-text strings)
    message.includes("invalid issue format")
  );
}

/** Thrown when a session cannot be restored (e.g. merged, still working). */
export class SessionNotRestorableError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly reason: string,
  ) {
    super(`Session ${sessionId} cannot be restored: ${reason}`);
    this.name = "SessionNotRestorableError";
  }
}

/** Thrown when a workspace is missing and cannot be recreated. */
export class WorkspaceMissingError extends Error {
  constructor(
    public readonly path: string,
    public readonly detail?: string,
  ) {
    super(`Workspace missing at ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "WorkspaceMissingError";
  }
}

/**
 * Thrown when an operation would remove or replace a session record while
 * another `ao` process still launches it (B-2): the record's launch keys
 * name a process that runs with the recorded start time.
 */
export class SessionLaunchInProgressError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly launcherPid: number,
    action: string,
  ) {
    super(
      `Cannot ${action} session ${sessionId}: ao process ${launcherPid} is still launching it. ` +
        `Stop ao process ${launcherPid} or wait for the launch to finish, then try again.`,
    );
    this.name = "SessionLaunchInProgressError";
  }
}

/** Thrown when a session lookup fails (session does not exist). */
export class SessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

/**
 * Thrown by `Agent.deliverMessage` when the interactive agent process that
 * the delivery needs does not run on the session (OpenCode: no TUI on the
 * stored session ID). Nothing was delivered, so core can restore the session
 * and try once more.
 */
export class AgentNotAttachedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Cannot deliver to session ${sessionId}: ${reason}`, options);
    this.name = "AgentNotAttachedError";
  }
}

/** True for `AgentNotAttachedError`, also from another copy of this module. */
export function isAgentNotAttachedError(err: unknown): err is AgentNotAttachedError {
  return (
    err instanceof AgentNotAttachedError ||
    (err instanceof Error && err.name === "AgentNotAttachedError")
  );
}

/**
 * Whether a failed agent delivery admitted the message: `none` (the service
 * refused it, or the call never started) or `unknown` (it may be admitted, now
 * or later).
 */
export type AgentDeliveryAdmission = "none" | "unknown";

/**
 * Thrown by `Agent.deliverMessage` after `AgentDeliveryAttempt.begin`, for
 * the input `inputId`. Core clears the pending entry for `admission: "none"`
 * and keeps it as `unknown` otherwise, so a later send of the same text
 * reuses the ID.
 */
export class AgentDeliveryError extends Error {
  constructor(
    public readonly inputId: string,
    public readonly admission: AgentDeliveryAdmission,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AgentDeliveryError";
  }
}

/** True for `AgentDeliveryError`, also from another copy of this module. */
export function isAgentDeliveryError(err: unknown): err is AgentDeliveryError {
  return (
    err instanceof AgentDeliveryError ||
    (err instanceof Error &&
      err.name === "AgentDeliveryError" &&
      typeof (err as { inputId?: unknown }).inputId === "string" &&
      ((err as { admission?: unknown }).admission === "none" ||
        (err as { admission?: unknown }).admission === "unknown"))
  );
}

/** Thrown when no agent-orchestrator.yaml config file can be found. */
export class ConfigNotFoundError extends Error {
  constructor(message?: string) {
    super(message ?? "No agent-orchestrator.yaml found. Run `ao start` to create one.");
    this.name = "ConfigNotFoundError";
  }
}
