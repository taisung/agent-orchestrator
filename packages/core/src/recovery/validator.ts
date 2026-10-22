import { lstatSync } from "node:fs";
import {
  TERMINAL_STATUSES as TERMINAL_STATUSES_SET,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Agent,
  type Workspace,
  type RuntimeHandle,
  type SessionStatus,
  type ActivityState,
} from "../types.js";
import { safeJsonParse, validateStatus } from "../utils/validation.js";
import type { ScannedSession } from "./scanner.js";
import {
  DEFAULT_RECOVERY_CONFIG,
  type RecoveryAssessment,
  type RecoveryClassification,
  type RecoveryAction,
  type RecoveryConfig,
} from "./types.js";
import { resolveAgentSelection, resolveSessionRole } from "../agent-selection.js";

export async function validateSession(
  scanned: ScannedSession,
  config: OrchestratorConfig,
  registry: PluginRegistry,
  recoveryConfigInput?: Partial<RecoveryConfig>,
): Promise<RecoveryAssessment> {
  const { sessionId, projectId, project, rawMetadata } = scanned;

  const agentName = resolveAgentSelection({
    role: resolveSessionRole(
      sessionId,
      rawMetadata,
      project.sessionPrefix,
      Object.values(config.projects).map((p) => p.sessionPrefix),
    ),
    project,
    defaults: config.defaults,
    persistedAgent: rawMetadata["agent"],
  }).agentName;
  const workspaceName = project.workspace ?? config.defaults.workspace;

  const workspacePath = rawMetadata["worktree"] || null;
  const runtimeHandleStr = rawMetadata["runtimeHandle"];
  const runtimeHandle = runtimeHandleStr ? safeJsonParse<RuntimeHandle>(runtimeHandleStr) : null;

  // Prefer the runtime the session was actually created under. Recovery runs
  // against sessions that may predate a change to the project's configured
  // runtime, and probing them with the wrong plugin reports them all dead.
  const runtimeName = runtimeHandle?.runtimeName || project.runtime || config.defaults.runtime;

  const runtime = registry.get<Runtime>("runtime", runtimeName);
  const agent = registry.get<Agent>("agent", agentName);
  const workspace = registry.get<Workspace>("workspace", workspaceName);
  const metadataStatus = validateStatus(rawMetadata["status"]);
  const recoveryConfig: RecoveryConfig = {
    ...DEFAULT_RECOVERY_CONFIG,
    ...(recoveryConfigInput ?? {}),
  };

  // A rejected probe means "unknown", never dead (CLAUDE.md, the
  // isProcessRunning rule): such a session gets no action (m-2).
  let probeError: string | null = null;
  const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

  let runtimeAlive = false;
  if (runtime && runtimeHandle) {
    try {
      runtimeAlive = await runtime.isAlive(runtimeHandle);
    } catch (err) {
      runtimeAlive = false;
      probeError = `runtime probe could not run: ${describe(err)}`;
    }
  }

  // Same-ID R4 (B-7 items 5 and 6): only a path that does not exist
  // (`ENOENT`) and a workspace check that answers false are "no workspace".
  // A path that cannot be checked (`EACCES`, `ELOOP`, I/O) or a workspace
  // check that rejects is unknown, so the session gets no action.
  let workspaceExists = false;
  if (workspacePath) {
    let pathMissing = false;
    try {
      lstatSync(workspacePath);
      workspaceExists = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") pathMissing = true;
      else probeError ??= `workspace path check could not run: ${describe(err)}`;
    }
    if (pathMissing && workspace?.exists) {
      try {
        // Same-ID R4 round 3: only `false` is "no workspace"; an answer that
        // is not a boolean says nothing, so it is unknown too.
        const answer: unknown = await workspace.exists(workspacePath);
        if (typeof answer === "boolean") workspaceExists = answer;
        else probeError ??= `workspace check answered ${String(answer)}, not true or false`;
      } catch (err) {
        probeError ??= `workspace check could not run: ${describe(err)}`;
      }
    }
  }

  let agentProcessRunning = false;
  const agentActivity: ActivityState | null = null;
  if (agent && runtimeHandle) {
    try {
      agentProcessRunning = await agent.isProcessRunning(runtimeHandle);
    } catch (err) {
      agentProcessRunning = false;
      probeError ??= `agent process check could not run: ${describe(err)}`;
    }
  }

  const metadataValid = Object.keys(rawMetadata).length > 0;
  // Unknown liveness: "partial" with no action, so no cleanup, no escalation
  // write and no recovery acts on a probe that could not answer.
  const classification = probeError
    ? "partial"
    : classifySession(runtimeAlive, workspaceExists, agentProcessRunning, metadataStatus);
  const action = probeError
    ? "skip"
    : determineAction(classification, metadataStatus, recoveryConfig);

  return {
    sessionId,
    projectId,
    classification,
    action,
    reason: probeError
      ? `Liveness unknown (${probeError}); no action`
      : getReason(classification, runtimeAlive, workspaceExists, agentProcessRunning),
    runtimeAlive,
    runtimeHandle,
    workspaceExists,
    workspacePath,
    agentProcessRunning,
    agentActivity,
    metadataValid,
    metadataStatus,
    rawMetadata,
  };
}

function classifySession(
  runtimeAlive: boolean,
  workspaceExists: boolean,
  agentProcessRunning: boolean,
  metadataStatus: SessionStatus,
): RecoveryClassification {
  if (runtimeAlive && workspaceExists && agentProcessRunning) {
    return "live";
  }

  if (!runtimeAlive && !workspaceExists) {
    if (TERMINAL_STATUSES_SET.has(metadataStatus)) {
      return "unrecoverable";
    }
    return "dead";
  }

  if (runtimeAlive && !workspaceExists) {
    return "partial";
  }

  if (!runtimeAlive && workspaceExists) {
    return "dead";
  }

  if (runtimeAlive && workspaceExists && !agentProcessRunning) {
    return "partial";
  }

  return "partial";
}

function determineAction(
  classification: RecoveryClassification,
  _metadataStatus: SessionStatus,
  recoveryConfig: RecoveryConfig,
): RecoveryAction {
  switch (classification) {
    case "live":
      return "recover";
    case "dead":
      return recoveryConfig.autoCleanup ? "cleanup" : "escalate";
    case "partial":
      return recoveryConfig.escalatePartial ? "escalate" : "cleanup";
    case "unrecoverable":
      return "skip";
    default:
      return "skip";
  }
}

function getReason(
  classification: RecoveryClassification,
  runtimeAlive: boolean,
  workspaceExists: boolean,
  agentProcessRunning: boolean,
): string {
  switch (classification) {
    case "live":
      return "Session is running normally";
    case "dead":
      return `Runtime ${runtimeAlive ? "alive" : "dead"}, workspace ${workspaceExists ? "exists" : "missing"}`;
    case "partial":
      return `Incomplete state: runtime=${runtimeAlive}, workspace=${workspaceExists}, agent=${agentProcessRunning}`;
    case "unrecoverable":
      return "Session is in terminal state";
    default:
      return "Unknown classification";
  }
}

export { classifySession, determineAction };
