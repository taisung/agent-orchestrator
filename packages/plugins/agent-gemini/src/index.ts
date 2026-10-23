import {
  shellEscape,
  HERDR_RUNTIME_NAME,
  exactPaneTarget,
  AGENT_PANE_FORMAT,
  agentPaneOf,
  agentPaneTty,
  isTmuxPaneGone,
  isHerdrProcessRunning,
  setupPathWrapperWorkspace,
  buildAgentPath,
  PREFERRED_GH_PATH,
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
      // The wrappers skip every ao wrapper file when they look for the real
      // binary, so there's no infinite recursion. Use buildAgentPath (lazy
      // homedir) so HOME mocking in tests and per-spawn HOME works.
      env["PATH"] = buildAgentPath(process.env["PATH"]);
      env["GH_PATH"] = PREFERRED_GH_PATH;

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
      // Same-ID R4 (B-7 item 10): false only when the check ran and found no
      // agent: a `ps` list without it, or the tmux server's answer that the
      // pane does not exist ("can't find session: <name>", or "no current
      // target" from a server without sessions). Every other failure rejects
      // with the cause (a `tmux` or `ps` that cannot run or answer, "no server
      // running", a timeout), so a caller reads unknown, never "exited".
      // Round 2 (M-2): a call that succeeds with a malformed answer rejects
      // too (empty or other text from tmux, a `ps` reply that is not a
      // process list): it proves nothing about the agent.
      // Built before any call: a name that the helper refuses is not a pane
      // that the check found without the agent, so the call rejects.
      const agentPane = agentPaneOf(handle);
      const paneTarget =
        handle.runtimeName === "tmux" && handle.id
          ? (agentPane ?? exactPaneTarget(handle.id))
          : null;
      const processRe = /(?:^|\/)gemini(?:\s|$)/;

      // herdr owns the PTY and reports a pane's foreground processes directly,
      // so neither the tmux TTY scan nor the process-runtime PID applies. The
      // core helper rejects when herdr cannot answer. Herdr fit F-6: the
      // handle carries the pins (binary and socket) of its launch.
      if (handle.runtimeName === HERDR_RUNTIME_NAME && handle.id) {
        return isHerdrProcessRunning(handle, processRe);
      }

      if (paneTarget) {
        let ttyOut: string;
        try {
          if (agentPane) {
            // Session relaunch (review r2 M-1): only the agent's own pane,
            // never the session's current window, which the owner can change.
            // A pane that now belongs to another session is not this agent's.
            const { stdout } = await execFileAsync(
              "tmux",
              ["list-panes", "-t", agentPane, "-F", AGENT_PANE_FORMAT],
              { timeout: 30_000 },
            );
            const tty = agentPaneTty(stdout, agentPane, handle.id);
            if (tty === null) return false;
            ttyOut = tty;
          } else {
            ({ stdout: ttyOut } = await execFileAsync(
              "tmux",
              ["list-panes", "-t", paneTarget, "-F", "#{pane_tty}"],
              { timeout: 30_000 },
            ));
          }
        } catch (err: unknown) {
          if (agentPane && isTmuxPaneGone(err, agentPane)) return false;
          // Round 3 (M-4): only tmux's own answer for this target is a missing
          // pane: a call that ended with exit code 1 (no signal, no timeout)
          // whose whole diagnostic is "can't find session: <name>", or "no
          // current target" from a server that has no session (tmux 3.4). A
          // line for another target, a line among others, or a killed call
          // says nothing about this pane.
          const failure = err as {
            code?: unknown;
            signal?: unknown;
            killed?: unknown;
            stderr?: unknown;
          };
          const diagnostic =
            typeof failure.stderr === "string" ? failure.stderr.replace(/\n$/, "") : undefined;
          if (
            failure.code === 1 &&
            !failure.signal &&
            failure.killed !== true &&
            (diagnostic === `can't find session: ${handle.id}` ||
              diagnostic === "no current target")
          ) {
            return false;
          }
          throw new Error(`gemini: tmux list-panes -t ${paneTarget} failed`, { cause: err });
        }
        // One TTY path per pane; a dead pane keeps its TTY.
        const ttys = ttyOut
          .trim()
          .split("\n")
          .map((t) => t.trim());
        if (!ttys.every((t) => /^\/dev\/\S+$/.test(t))) {
          throw new Error(
            `gemini: tmux list-panes -t ${paneTarget} answered ${JSON.stringify(ttyOut.trim().slice(0, 80))}, not a list of pane TTYs`,
          );
        }

        let psOut: string;
        try {
          ({ stdout: psOut } = await execFileAsync("ps", ["-eo", "pid,tty,args"], {
            timeout: 30_000,
          }));
        } catch (err: unknown) {
          throw new Error("gemini: ps -eo pid,tty,args failed", { cause: err });
        }
        // The header, then one "PID TTY ARGS" row per process (ps lists itself).
        // Round 3 (M-2): a PID is a positive safe integer; one row with another
        // PID (0, or too large to be exact) rejects the whole reply.
        const [psHeader = "", ...psRows] = psOut.trimEnd().split("\n");
        if (
          !/^\s*PID\s+TTY?\s+(?:ARGS|COMMAND|CMD)\s*$/.test(psHeader) ||
          psRows.length === 0 ||
          !psRows.every((row) => {
            const pid = /^\s*([1-9]\d*)\s+\S+\s+\S/.exec(row)?.[1];
            return pid !== undefined && Number.isSafeInteger(Number(pid));
          })
        ) {
          throw new Error(
            `gemini: ps -eo pid,tty,args answered a reply that is not a process list (first line ${JSON.stringify(psHeader.slice(0, 80))})`,
          );
        }
        const ttySet = new Set(ttys.map((t) => t.replace(/^\/dev\//, "")));
        for (const line of psRows) {
          const cols = line.trimStart().split(/\s+/);
          if (!ttySet.has(cols[1] ?? "")) continue;
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
          // EPERM: the process exists, but this user cannot signal it. Any
          // other answer of signal 0 (ESRCH) says that the process is gone.
          if (err instanceof Error && "code" in err && err.code === "EPERM") {
            return true;
          }
          return false;
        }
      }

      return false;
    },

    async getSessionInfo(_session: Session): Promise<AgentSessionInfo | null> {
      // Cannot reliably scope session files to a specific workspace — see
      // getActivityState comment. Return null to avoid cross-session data leaks.
      return null;
    },

    async getRestoreCommand(
      _session: Session,
      project: ProjectConfig,
      effectiveModel?: string,
    ): Promise<string | null> {
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

      // C-04: prefer the persisted spawn --model override (effectiveModel)
      // over the live config so a restore keeps the spawn model.
      const model = effectiveModel ?? (project.agentConfig?.model as string | undefined);
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
