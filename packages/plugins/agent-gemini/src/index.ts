import {
  shellEscape,
  HERDR_RUNTIME_NAME,
  isHerdrProcessRunning,
  setupPathWrapperWorkspace,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type ActivityDetection,
  type ActivityState,
  type PluginModule,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizePermissionMode(
  mode: string | undefined,
): "permissionless" | "default" | "auto-edit" | "suggest" | undefined {
  if (!mode) return undefined;
  if (mode === "skip") return "permissionless";
  if (
    mode === "permissionless" ||
    mode === "default" ||
    mode === "auto-edit" ||
    mode === "suggest"
  ) {
    return mode;
  }
  return undefined;
}

/** Shared bin directory for ao shell wrappers (prepended to PATH) */
const AO_BIN_DIR = join(homedir(), ".ao", "bin");

// =============================================================================
// Plugin Manifest
// =============================================================================

export const manifest = {
  name: "gemini",
  slot: "agent" as const,
  description: "Agent plugin: Gemini CLI",
  version: "0.1.0",
};

// =============================================================================
// Gemini Session Detection
// =============================================================================

/** Gemini session directory: ~/.gemini/tmp/ */
const GEMINI_TMP_DIR = join(homedir(), ".gemini", "tmp");

/**
 * Check if any Gemini session data exists under ~/.gemini/tmp/.
 * Used by getRestoreCommand to guard against `gemini -r latest` when no
 * prior session exists.
 */
async function hasGeminiSessions(): Promise<boolean> {
  try {
    const dirs = await readdir(GEMINI_TMP_DIR);
    return dirs.length > 0;
  } catch {
    return false;
  }
}

// =============================================================================
// Agent Implementation
// =============================================================================

function createGeminiAgent(): Agent {
  return {
    name: "gemini",
    processName: "gemini",

    getLaunchCommand(config: AgentLaunchConfig): string {
      // Gemini CLI auto-reads GEMINI.md from workspace root as its system prompt.
      // Since there's no --system-prompt CLI flag, we write the file before launching
      // via a compound shell command. The tmux session is cd'd into the workspace,
      // so relative paths work. systemPromptFile is preferred (avoids shell truncation
      // for long prompts); inline systemPrompt is a fallback.
      let prefix = "";
      if (config.systemPromptFile) {
        prefix = `cp ${shellEscape(config.systemPromptFile)} GEMINI.md && `;
      } else if (config.systemPrompt) {
        prefix = `printf '%s' ${shellEscape(config.systemPrompt)} > GEMINI.md && `;
      }

      const parts: string[] = ["gemini"];

      // --yolo auto-approves all actions (equivalent to "permissionless" mode)
      if (normalizePermissionMode(config.permissions) === "permissionless") {
        parts.push("--yolo");
      }

      if (config.model) {
        parts.push("-m", shellEscape(config.model));
      }

      if (config.prompt) {
        // -p <prompt> for headless mode
        parts.push("-p", shellEscape(config.prompt));
      }

      return prefix + parts.join(" ");
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {};
      env["AO_SESSION_ID"] = config.sessionId;
      // NOTE: AO_PROJECT_ID is the caller's responsibility (spawn.ts sets it)
      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }

      // Prepend ~/.ao/bin to PATH so our gh/git wrappers intercept commands.
      env["PATH"] = `${AO_BIN_DIR}:${process.env["PATH"] ?? "/usr/bin:/bin"}`;

      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      if (!terminalOutput.trim()) return "idle";

      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";

      // If Gemini is showing its input prompt, it's idle
      if (/^[>$#]\s*$/.test(lastLine)) return "idle";

      // Check last few lines for approval prompts
      const tail = lines.slice(-5).join("\n");
      if (/approve|confirm/i.test(tail)) return "waiting_input";
      if (/\(y\)es.*\(n\)o/i.test(tail)) return "waiting_input";

      return "active";
    },

    async getActivityState(
      session: Session,
      _readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      // Check if process is running first
      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (!running) return { state: "exited", timestamp: exitedAt };

      // NOTE: Gemini stores sessions under ~/.gemini/tmp/{project-id}/chats/ but
      // there is no documented mapping from workspace path to project-id. Scanning
      // all projects and picking the globally newest file (as before) would attribute
      // one session's activity to another when multiple Gemini sessions run in
      // parallel. Until Gemini provides per-workspace session scoping, we return
      // null (unknown) rather than returning potentially incorrect data.
      //
      // TODO: Implement proper per-session activity detection when Gemini exposes
      //       a workspace-to-project-id mapping.
      return null;
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      try {
        // herdr owns the PTY and reports a pane's foreground processes directly,
        // so neither the tmux TTY scan nor the process-runtime PID applies.
        if (handle.runtimeName === HERDR_RUNTIME_NAME && handle.id) {
          return await isHerdrProcessRunning(handle.id, /(?:^|\/)gemini(?:\s|$)/);
        }

        if (handle.runtimeName === "tmux" && handle.id) {
          const { stdout: ttyOut } = await execFileAsync(
            "tmux",
            ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
            { timeout: 30_000 },
          );
          const ttys = ttyOut
            .trim()
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          if (ttys.length === 0) return false;

          const { stdout: psOut } = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
            timeout: 30_000,
          });
          const ttySet = new Set(ttys.map((t) => t.replace(/^\/dev\//, "")));
          const processRe = /(?:^|\/)gemini(?:\s|$)/;
          for (const line of psOut.split("\n")) {
            const cols = line.trimStart().split(/\s+/);
            if (cols.length < 3 || !ttySet.has(cols[1] ?? "")) continue;
            const args = cols.slice(2).join(" ");
            if (processRe.test(args)) {
              return true;
            }
          }
          return false;
        }

        const rawPid = handle.data["pid"];
        const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            return true;
          } catch (err: unknown) {
            if (err instanceof Error && "code" in err && err.code === "EPERM") {
              return true;
            }
            return false;
          }
        }

        return false;
      } catch {
        return false;
      }
    },

    async getSessionInfo(_session: Session): Promise<AgentSessionInfo | null> {
      // Cannot reliably scope session files to a specific workspace — see
      // getActivityState comment. Return null to avoid cross-session data leaks.
      return null;
    },

    async getRestoreCommand(_session: Session, project: ProjectConfig): Promise<string | null> {
      // Check if any Gemini session exists before returning a restore command.
      // Without this guard, `gemini -r latest` would fail when no prior session
      // exists, and the caller couldn't fall back to getLaunchCommand.
      const hasSession = await hasGeminiSessions();
      if (!hasSession) return null;

      // Gemini CLI supports -r latest to resume the most recent session
      const parts: string[] = ["gemini"];

      if (
        normalizePermissionMode(project.agentConfig?.permissions as string | undefined) ===
        "permissionless"
      ) {
        parts.push("--yolo");
      }

      const model = project.agentConfig?.model as string | undefined;
      if (model) {
        parts.push("-m", shellEscape(model));
      }

      parts.push("-r", "latest");

      return parts.join(" ");
    },

    async setupWorkspaceHooks(workspacePath: string, _config: WorkspaceHooksConfig): Promise<void> {
      await setupPathWrapperWorkspace(workspacePath);
    },

    async postLaunchSetup(session: Session): Promise<void> {
      if (!session.workspacePath) return;
      await setupPathWrapperWorkspace(session.workspacePath);
    },
  };
}

// =============================================================================
// Plugin Export
// =============================================================================

export function create(): Agent {
  return createGeminiAgent();
}

export default { manifest, create } satisfies PluginModule<Agent>;
