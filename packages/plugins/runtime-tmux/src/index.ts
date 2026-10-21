import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PluginModule,
  type Runtime,
  type RuntimeCreateConfig,
  type RuntimeHandle,
  type RuntimeMetrics,
  type AttachInfo,
  shellEscape,
  exactPaneTarget,
  exactSessionTarget,
  RUNTIME_NO_SERVER_ERROR_CODE,
} from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);
const TMUX_COMMAND_TIMEOUT_MS = 5_000;

export const manifest = {
  name: "tmux",
  slot: "runtime" as const,
  description: "Runtime plugin: tmux sessions",
  version: "0.1.0",
};

/** Only allow safe characters in session IDs */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function assertValidSessionId(id: string): void {
  if (!SAFE_SESSION_ID.test(id)) {
    throw new Error(`Invalid session ID "${id}": must match ${SAFE_SESSION_ID}`);
  }
}

function writeLaunchScript(command: string): string {
  const scriptPath = join(tmpdir(), `ao-launch-${randomUUID()}.sh`);
  const content = `#!/usr/bin/env bash\nrm -- "$0" 2>/dev/null || true\n${command}\n`;
  writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  return `bash ${shellEscape(scriptPath)}`;
}

/**
 * tmux 3.4 answers that a target does not exist with "can't find session: X"
 * (has-session), "can't find window: X" (list-panes on a missing session) or
 * "can't find pane: X", and with "no current target" when its server runs
 * with no session at all (`exit-empty off`). Only these mean "gone"; any
 * other failure is unknown.
 */
const TMUX_TARGET_NOT_FOUND = /^(?:can't find (?:session|window|pane): |no current target$)/m;

/** tmux could not reach a server: a stale socket, or no socket file at all. */
const TMUX_NO_SERVER =
  /^(?:no server running on |error connecting to .* \(No such file or directory\)$)/m;

/** A tmux probe that could not tell whether the session exists. */
export class TmuxProbeError extends Error {
  readonly code: string;

  constructor(message: string, code: string, options: { cause: unknown }) {
    super(message, options);
    this.name = "TmuxProbeError";
    this.code = code;
  }
}

function tmuxStderr(err: unknown): string {
  if (err && typeof err === "object" && "stderr" in err && typeof err.stderr === "string") {
    return err.stderr;
  }
  return "";
}

/** True when tmux answered that the target session, window or pane does not exist. */
function isTmuxTargetNotFound(err: unknown): boolean {
  return TMUX_TARGET_NOT_FOUND.test(tmuxStderr(err));
}

/** Wrap a failed tmux probe; the code tells "no server at all" from other failures. */
function tmuxProbeError(command: string, err: unknown): TmuxProbeError {
  const stderr = tmuxStderr(err).trim();
  const timedOut = !!err && typeof err === "object" && "killed" in err && err.killed === true;
  const detail = timedOut
    ? `timed out after ${TMUX_COMMAND_TIMEOUT_MS} ms`
    : stderr || (err instanceof Error ? err.message : String(err));
  const code = TMUX_NO_SERVER.test(stderr) ? RUNTIME_NO_SERVER_ERROR_CODE : "ERR_RUNTIME_PROBE";
  return new TmuxProbeError(`tmux ${command} could not answer: ${detail}`, code, { cause: err });
}

/** Run a tmux command and return stdout */
async function tmux(...args: string[]): Promise<string> {
  return runTmux(args);
}

/** Run a tmux command with an optional client environment and return stdout */
async function runTmux(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: TMUX_COMMAND_TIMEOUT_MS,
    ...(env && { env }),
  });
  return stdout.trimEnd();
}

export function create(): Runtime {
  return {
    name: "tmux",

    async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
      assertValidSessionId(config.sessionId);
      const sessionName = config.sessionId;

      // Build environment flags: -e KEY=VALUE for each env var
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(config.environment ?? {})) {
        envArgs.push("-e", `${key}=${value}`);
      }

      // Create tmux session in detached mode.
      // tmux 3.4 gives a new pane the PATH of the client that runs
      // `new-session` when that client is not attached (spawn.c: "only
      // unattached clients"), not the `-e PATH` value. So the client runs with
      // the built PATH, and the pane's login shell then applies its startup
      // files on top of it. `-e PATH` stays, so the session environment
      // (`show-environment`) still holds it. Node also looks up the tmux
      // binary with this PATH.
      const panePath = config.environment?.["PATH"];
      await runTmux(
        ["new-session", "-d", "-s", sessionName, "-c", config.workspacePath, ...envArgs],
        panePath ? { ...process.env, PATH: panePath } : undefined,
      );

      // Send the launch command — clean up the session if this fails.
      // Use a temp script for long commands so the pane shows a short
      // invocation instead of a pasted wall of shell. Exact targets: if the
      // new session ends first, a plain target would reach another session
      // whose name starts with this one.
      const pane = exactPaneTarget(sessionName);
      try {
        if (config.launchCommand.length > 200) {
          const invocation = writeLaunchScript(config.launchCommand);
          await tmux("send-keys", "-t", pane, "-l", invocation);
          await sleep(300);
          await tmux("send-keys", "-t", pane, "Enter");
        } else {
          await tmux("send-keys", "-t", pane, config.launchCommand, "Enter");
        }
      } catch (err: unknown) {
        try {
          await tmux("kill-session", "-t", exactSessionTarget(sessionName));
        } catch {
          // Best-effort cleanup
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to send launch command to session "${sessionName}": ${msg}`, {
          cause: err,
        });
      }

      return {
        id: sessionName,
        runtimeName: "tmux",
        data: {
          createdAt: Date.now(),
          workspacePath: config.workspacePath,
        },
      };
    },

    /**
     * Resolves when tmux killed the session or answered that it does not
     * exist. Every other failure (no server, a timeout, an unknown error)
     * rejects with the failure as `cause` (same-ID R2a): core `stopRuntime`
     * then asks `isAlive`, and a caller goes on only after a confirmed stop.
     */
    async destroy(handle: RuntimeHandle): Promise<void> {
      const target = exactSessionTarget(handle.id);
      try {
        await tmux("kill-session", "-t", target);
      } catch (err: unknown) {
        if (isTmuxTargetNotFound(err)) return;
        throw tmuxProbeError(`kill-session -t ${target}`, err);
      }
    },

    async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
      const pane = exactPaneTarget(handle.id);
      // Clear any partial input
      await tmux("send-keys", "-t", pane, "C-u");

      // For long or multiline messages, use load-buffer + paste-buffer
      // Use randomUUID to avoid temp file collisions on concurrent sends
      if (message.includes("\n") || message.length > 200) {
        const bufferName = `ao-${randomUUID()}`;
        const tmpPath = join(tmpdir(), `ao-send-${randomUUID()}.txt`);
        writeFileSync(tmpPath, message, { encoding: "utf-8", mode: 0o600 });
        try {
          await tmux("load-buffer", "-b", bufferName, tmpPath);
          await tmux("paste-buffer", "-b", bufferName, "-t", pane, "-d");
        } finally {
          // Clean up temp file and tmux buffer (in case paste-buffer failed
          // and the -d flag didn't delete it)
          try {
            unlinkSync(tmpPath);
          } catch {
            // ignore cleanup errors
          }
          try {
            await tmux("delete-buffer", "-b", bufferName);
          } catch {
            // Buffer may already be deleted by -d flag — that's fine
          }
        }
      } else {
        // Use -l (literal) so text like "Enter" or "Space" isn't interpreted
        // as tmux key names
        await tmux("send-keys", "-t", pane, "-l", message);
      }

      // Small delay to let tmux process the pasted text before pressing Enter.
      // Without this, Enter can arrive before the text is fully rendered.
      await sleep(300);
      await tmux("send-keys", "-t", pane, "Enter");
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      try {
        return await tmux(
          "capture-pane",
          "-t",
          exactPaneTarget(handle.id),
          "-p",
          "-S",
          `-${lines}`,
        );
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      const target = exactSessionTarget(handle.id);
      try {
        await tmux("has-session", "-t", target);
        return true;
      } catch (err: unknown) {
        // Only tmux's own "not found" answer is dead. An unreachable server, a
        // timeout or any other failure rejects: callers keep the session.
        if (isTmuxTargetNotFound(err)) return false;
        throw tmuxProbeError(`has-session -t ${target}`, err);
      }
    },

    async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
      // The age of the tmux session itself, so a new session under an old
      // name shows its own age (the lifecycle compares it with the handle's
      // createdAt). `list-sessions` and an exact name: a `-t` target also
      // matches a session whose name only starts with this one. The number
      // comes first (tmux prints a tab in a format as "_").
      const listed = await tmux("list-sessions", "-F", "#{session_created} #{session_name}").catch(
        (err: unknown) => {
          throw tmuxProbeError("list-sessions", err);
        },
      );
      for (const line of listed.split("\n")) {
        const space = line.indexOf(" ");
        const seconds = Number.parseInt(line.slice(0, space), 10);
        if (space > 0 && line.slice(space + 1) === handle.id && Number.isFinite(seconds)) {
          return { uptimeMs: Math.max(0, Date.now() - seconds * 1000) };
        }
      }
      throw new Error(`tmux session ${handle.id} not found`);
    },

    async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
      const target = exactSessionTarget(handle.id);
      return {
        type: "tmux",
        target,
        // Quoted: zsh expands a word that starts with "=" to a command path.
        command: `tmux attach -t ${shellEscape(target)}`,
      };
    },
  };
}

export default { manifest, create } satisfies PluginModule<Runtime>;
