import type { OrchestratorConfig, PluginRegistry, Runtime, Workspace } from "../types.js";
import {
  GENERATION_KEY,
  deleteMetadata,
  holdsExpected,
  launchIdentity,
  readMetadataRaw,
  updateMetadataIf,
} from "../metadata.js";
import { getSessionsDir } from "../paths.js";
import { validateStatus } from "../utils/validation.js";
import { sessionFromMetadata } from "../utils/session-from-metadata.js";
import type { RecoveryAssessment, RecoveryResult, RecoveryContext } from "./types.js";

/**
 * B-1 (round 4): the version of the record that the assessment read. The
 * probes of the assessment awaited, so an action writes or archives only
 * while the record is still that version: the same generation (any Node
 * writer increments it), status and PR (the bash helpers change those
 * without a new generation), and launch. A kill, restore, new launch or new
 * reservation in between keeps its record, and the action fails.
 */
function assessedVersion(rawMetadata: Record<string, string>): Record<string, string> {
  return {
    [GENERATION_KEY]: rawMetadata[GENERATION_KEY] ?? "",
    status: rawMetadata["status"] ?? "",
    pr: rawMetadata["pr"] ?? "",
    ...launchIdentity(rawMetadata),
  };
}

const RECORD_CHANGED = "the session record changed after the assessment; nothing was written";

export async function recoverSession(
  assessment: RecoveryAssessment,
  config: OrchestratorConfig,
  registry: PluginRegistry,
  context: RecoveryContext,
): Promise<RecoveryResult> {
  const { sessionId, projectId, rawMetadata } = assessment;
  const recoveryCount = rawMetadata["recoveryCount"]
    ? parseInt(rawMetadata["recoveryCount"], 10) + 1
    : 1;

  if (context.dryRun) {
    if (recoveryCount > context.recoveryConfig.maxRecoveryAttempts) {
      return {
        success: true,
        sessionId,
        action: "escalate",
        requiresManualIntervention: true,
        reason: `Exceeded max recovery attempts (${context.recoveryConfig.maxRecoveryAttempts})`,
      };
    }

    return {
      success: true,
      sessionId,
      action: "recover",
    };
  }

  try {
    const now = new Date().toISOString();
    const preservedStatus = validateStatus(rawMetadata["status"]);

    const project = config.projects[projectId];
    const sessionsDir = getSessionsDir(config.configPath, project.path);

    if (recoveryCount > context.recoveryConfig.maxRecoveryAttempts) {
      const escalated = updateMetadataIf(sessionsDir, sessionId, assessedVersion(rawMetadata), {
        status: "stuck",
        escalatedAt: now,
        escalationReason: `Exceeded max recovery attempts (${context.recoveryConfig.maxRecoveryAttempts})`,
        recoveryCount: String(recoveryCount),
      });
      if (!escalated) {
        return { success: false, sessionId, action: "escalate", error: RECORD_CHANGED };
      }

      return {
        success: true,
        sessionId,
        action: "escalate",
        requiresManualIntervention: true,
        reason: `Exceeded max recovery attempts (${context.recoveryConfig.maxRecoveryAttempts})`,
      };
    }

    const recovered = updateMetadataIf(sessionsDir, sessionId, assessedVersion(rawMetadata), {
      status: preservedStatus,
      restoredAt: now,
      recoveryCount: String(recoveryCount),
    });
    if (!recovered) {
      return { success: false, sessionId, action: "recover", error: RECORD_CHANGED };
    }

    const updatedMetadata = {
      ...rawMetadata,
      status: preservedStatus,
      restoredAt: now,
      recoveryCount: String(recoveryCount),
    };

    const session = sessionFromMetadata(sessionId, updatedMetadata, {
      projectId: assessment.projectId,
      status: preservedStatus,
      runtimeHandle: assessment.runtimeHandle,
      lastActivityAt: new Date(),
      restoredAt: new Date(now),
    });

    return {
      success: true,
      sessionId,
      action: "recover",
      session,
    };
  } catch (error) {
    return {
      success: false,
      sessionId,
      action: "recover",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function cleanupSession(
  assessment: RecoveryAssessment,
  config: OrchestratorConfig,
  registry: PluginRegistry,
  context: RecoveryContext,
): Promise<RecoveryResult> {
  const { sessionId, projectId, rawMetadata, runtimeAlive, workspaceExists } = assessment;

  if (context.dryRun) {
    return {
      success: true,
      sessionId,
      action: "cleanup",
    };
  }

  try {
    const project = config.projects[projectId];
    const sessionsDir = getSessionsDir(config.configPath, project.path);
    // B-1 (round 4): nothing is destroyed for a record that changed after
    // the assessment (the runtime name and the worktree path are the same
    // for every launch of the ID).
    const current = readMetadataRaw(sessionsDir, sessionId);
    if (!current || !holdsExpected(current, assessedVersion(rawMetadata))) {
      return { success: false, sessionId, action: "cleanup", error: RECORD_CHANGED };
    }
    // Prefer the runtime recorded on the handle — destroying a session with the
    // wrong runtime plugin silently leaves it running.
    const runtimeName =
      assessment.runtimeHandle?.runtimeName || project.runtime || config.defaults.runtime;
    const workspaceName = project.workspace ?? config.defaults.workspace;
    const runtime = registry.get<Runtime>("runtime", runtimeName);
    const workspace = registry.get<Workspace>("workspace", workspaceName);

    if (runtimeAlive && assessment.runtimeHandle && runtime) {
      try {
        await runtime.destroy(assessment.runtimeHandle);
      } catch {
        // ignore cleanup errors
      }
    }

    // B-1 (round 4): the destroy awaited; a new launch of the ID meanwhile
    // uses the same worktree path, so stop before it is removed.
    const unchanged = (): boolean => {
      const now = readMetadataRaw(sessionsDir, sessionId);
      return !!now && holdsExpected(now, assessedVersion(rawMetadata));
    };
    if (!unchanged()) {
      return { success: false, sessionId, action: "cleanup", error: RECORD_CHANGED };
    }

    const workspacePath = rawMetadata["worktree"];
    if (workspacePath && workspaceExists && workspace) {
      // Round 7 (M-2): the plugin's git steps await; it runs the same check
      // again directly before each removal step. A kept worktree ends the
      // action as the check above does. Round 8 (M-3): `destroy` returns
      // nothing, so `kept` records the last answer of this check: a no or a
      // throw (the plugin removes nothing after either) keeps the worktree.
      let kept = false;
      const stillUnchanged = (): boolean => {
        let answer = false;
        try {
          answer = unchanged();
        } finally {
          kept = !answer;
        }
        return answer;
      };
      try {
        await workspace.destroy(workspacePath, stillUnchanged);
      } catch {
        // ignore cleanup errors
      }
      if (kept) {
        return { success: false, sessionId, action: "cleanup", error: RECORD_CHANGED };
      }
    }

    const terminated = updateMetadataIf(sessionsDir, sessionId, assessedVersion(rawMetadata), {
      status: "terminated",
      terminatedAt: new Date().toISOString(),
      terminationReason: "cleanup",
    });
    if (!terminated) {
      return { success: false, sessionId, action: "cleanup", error: RECORD_CHANGED };
    }

    deleteMetadata(sessionsDir, sessionId, true, {
      [GENERATION_KEY]: terminated[GENERATION_KEY],
      ...launchIdentity(terminated),
    });

    return {
      success: true,
      sessionId,
      action: "cleanup",
    };
  } catch (error) {
    return {
      success: false,
      sessionId,
      action: "cleanup",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function escalateSession(
  assessment: RecoveryAssessment,
  config: OrchestratorConfig,
  _registry: PluginRegistry,
  context: RecoveryContext,
): Promise<RecoveryResult> {
  const { sessionId, projectId, reason, rawMetadata } = assessment;

  if (context.dryRun) {
    return {
      success: true,
      sessionId,
      action: "escalate",
      requiresManualIntervention: true,
      reason,
    };
  }

  try {
    const project = config.projects[projectId];
    const sessionsDir = getSessionsDir(config.configPath, project.path);

    const escalated = updateMetadataIf(sessionsDir, sessionId, assessedVersion(rawMetadata), {
      status: "stuck",
      escalatedAt: new Date().toISOString(),
      escalationReason: reason,
    });
    if (!escalated) {
      return {
        success: false,
        sessionId,
        action: "escalate",
        error: RECORD_CHANGED,
        requiresManualIntervention: true,
      };
    }

    return {
      success: true,
      sessionId,
      action: "escalate",
      requiresManualIntervention: true,
      reason,
    };
  } catch (error) {
    return {
      success: false,
      sessionId,
      action: "escalate",
      error: error instanceof Error ? error.message : String(error),
      requiresManualIntervention: true,
    };
  }
}

export async function executeAction(
  assessment: RecoveryAssessment,
  config: OrchestratorConfig,
  registry: PluginRegistry,
  context: RecoveryContext,
): Promise<RecoveryResult> {
  switch (assessment.action) {
    case "recover":
      return recoverSession(assessment, config, registry, context);
    case "cleanup":
      return cleanupSession(assessment, config, registry, context);
    case "escalate":
      return escalateSession(assessment, config, registry, context);
    case "skip":
    default:
      return {
        success: true,
        sessionId: assessment.sessionId,
        action: "skip",
      };
  }
}
