/**
 * Runtime plugin: herdr (https://herdr.dev) — an agent-aware terminal workspace server.
 *
 * Every command goes through the `herdr` CLI, which speaks to a long-running server
 * over a unix socket and answers in JSON. The server is shared: it may already be
 * running with the user's own workspaces in it, so this plugin creates and destroys
 * only the workspaces it owns and never stops the server.
 *
 * Behaviour here is grounded in the measured spike recorded in
 * `development/0003_herdr_assessment_and_the_runtime_plugin_option.md` §8. The
 * non-obvious findings that shape this file:
 *
 *   - An agent launched with `pane run` is auto-detected by herdr's content rules,
 *     so AO's own launch command (with its `--model` / permission flags) is preserved
 *     verbatim. `agent start` would run the bare executable and silently drop them.
 *   - `--source recent-unwrapped` reads the FULL scrollback of an alt-screen TUI agent,
 *     which `tmux capture-pane` cannot (0001 §4). But it returns empty for a pane with
 *     no detected agent, so `getOutput` falls back to `visible`.
 *   - `agent prompt` immediately after launch is silently dropped while herdr is still
 *     settling (0003 §8.2). `sendMessage` gates on a settled state first.
 *   - Agents are addressable by pane id only. `pane rename` sets a display label that
 *     agent targeting does NOT resolve.
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PluginModule,
  type Runtime,
  type RuntimeCreateConfig,
  type RuntimeHandle,
  type RuntimeMetrics,
  type AttachInfo,
} from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

export const manifest = {
  name: "herdr",
  slot: "runtime" as const,
  description: "Runtime plugin: herdr agent-aware terminal workspaces",
  version: "0.1.0",
};

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
/** How long to wait for herdr to detect an agent in the pane before prompting it. */
const DEFAULT_SETTLE_TIMEOUT_MS = 15_000;
const SETTLE_POLL_INTERVAL_MS = 500;
/** How long to wait for evidence that a prompt was actually consumed. */
const DEFAULT_DELIVERY_TIMEOUT_MS = 12_000;
const DELIVERY_POLL_INTERVAL_MS = 400;
/** How many times to re-send a prompt that produced no evidence of delivery. */
const DEFAULT_SEND_ATTEMPTS = 3;

/** States in which herdr considers an agent able to accept a prompt. */
const SETTLED_STATES = new Set(["idle", "done", "blocked"]);

/** Only allow safe characters in session IDs — they become workspace labels. */
const SAFE_SESSION_ID = /^[a-zA-Z0-9_-]+$/;

export interface HerdrRuntimeConfig {
  /** Path to the `herdr` binary. Defaults to `herdr` on PATH. */
  binPath?: string;
  /** Timeout for individual herdr CLI calls. */
  commandTimeoutMs?: number;
  /** How long `sendMessage` waits for an agent to appear before prompting. */
  settleTimeoutMs?: number;
  /** How long to wait for evidence a prompt was consumed before re-sending. */
  deliveryTimeoutMs?: number;
  /** How many send attempts before falling back to raw terminal input. */
  sendAttempts?: number;
}

interface HerdrPane {
  pane_id: string;
  terminal_id?: string;
  workspace_id?: string;
  agent?: string | null;
  agent_status?: string;
}

function assertValidSessionId(id: string): void {
  if (!SAFE_SESSION_ID.test(id)) {
    throw new Error(`Invalid session ID "${id}": must match ${SAFE_SESSION_ID}`);
  }
}

/**
 * herdr answers `{"id":...,"result":{...}}` on success and `{"error":{"code","message"}}`
 * on failure, both with exit code 0 — so the error has to be read out of the body.
 */
function parseHerdrResult(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Read commands (`pane read`) answer with raw terminal text, not JSON.
    return { text: trimmed };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;

  const error = obj.error;
  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    throw new Error(`herdr error ${String(e.code ?? "unknown")}: ${String(e.message ?? "")}`);
  }

  const result = obj.result;
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return obj;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toPane(value: unknown): HerdrPane | null {
  const rec = asRecord(value);
  if (!rec || typeof rec.pane_id !== "string") return null;
  return {
    pane_id: rec.pane_id,
    terminal_id: typeof rec.terminal_id === "string" ? rec.terminal_id : undefined,
    workspace_id: typeof rec.workspace_id === "string" ? rec.workspace_id : undefined,
    agent: typeof rec.agent === "string" ? rec.agent : null,
    agent_status: typeof rec.agent_status === "string" ? rec.agent_status : undefined,
  };
}

/**
 * Write the launch command to a temp script.
 *
 * `pane run` takes argv, not a shell string, but AO hands us an arbitrary shell
 * command (pipes, quoting, env prefixes). Running it as a script preserves the
 * command exactly instead of trying to tokenize it. The script deletes itself so
 * nothing is left in tmp once the agent is up.
 */
function writeLaunchScript(command: string): string {
  const scriptPath = join(tmpdir(), `ao-herdr-launch-${randomUUID()}.sh`);
  const content = `#!/usr/bin/env bash\nrm -- "$0" 2>/dev/null || true\n${command}\n`;
  writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  return scriptPath;
}

export function create(config?: Record<string, unknown>): Runtime {
  // Validate once here and close over the result — plugin methods must not re-validate.
  const raw = (config ?? {}) as HerdrRuntimeConfig;
  const bin = typeof raw.binPath === "string" && raw.binPath.trim() ? raw.binPath : "herdr";
  const commandTimeoutMs =
    typeof raw.commandTimeoutMs === "number" && raw.commandTimeoutMs > 0
      ? raw.commandTimeoutMs
      : DEFAULT_COMMAND_TIMEOUT_MS;
  const settleTimeoutMs =
    typeof raw.settleTimeoutMs === "number" && raw.settleTimeoutMs >= 0
      ? raw.settleTimeoutMs
      : DEFAULT_SETTLE_TIMEOUT_MS;
  const deliveryTimeoutMs =
    typeof raw.deliveryTimeoutMs === "number" && raw.deliveryTimeoutMs >= 0
      ? raw.deliveryTimeoutMs
      : DEFAULT_DELIVERY_TIMEOUT_MS;
  const sendAttempts =
    typeof raw.sendAttempts === "number" && raw.sendAttempts > 0
      ? raw.sendAttempts
      : DEFAULT_SEND_ATTEMPTS;

  /** Run a herdr CLI command and return its parsed `result` object. */
  async function herdr(...args: string[]): Promise<Record<string, unknown>> {
    const { stdout } = await execFileAsync(bin, args, { timeout: commandTimeoutMs });
    return parseHerdrResult(stdout);
  }

  /** Read a pane, returning raw terminal text (read commands answer in text, not JSON). */
  async function readPane(paneId: string, source: string, lines: number): Promise<string> {
    const { stdout } = await execFileAsync(
      bin,
      ["pane", "read", paneId, "--source", source, "--lines", String(lines)],
      { timeout: commandTimeoutMs },
    );
    return stdout.trimEnd();
  }

  async function getPane(paneId: string): Promise<HerdrPane | null> {
    try {
      const result = await herdr("pane", "get", paneId);
      return toPane(result.pane);
    } catch {
      return null;
    }
  }

  /**
   * Block until herdr reports an agent in the pane, in a state that accepts input.
   * Returns the observed state, or null on timeout.
   *
   * NOTE: this is necessary but NOT sufficient for delivery. herdr reports
   * `idle` as soon as it recognises the agent's prompt box, which happens
   * seconds before the agent can actually consume input — measured at ~1.5s
   * after launch for claude, where a prompt is accepted by herdr and silently
   * discarded. Delivery must be verified separately; see `promptWasConsumed`.
   */
  async function waitForSettledAgent(paneId: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const pane = await getPane(paneId);
      if (pane?.agent && pane.agent_status && SETTLED_STATES.has(pane.agent_status)) {
        return pane.agent_status;
      }
      if (Date.now() >= deadline) return null;
      await sleep(SETTLE_POLL_INTERVAL_MS);
    }
  }

  /**
   * Watch for evidence that a prompt was actually consumed.
   *
   * A consumed prompt drives the agent into `working` (and on to `done`). A
   * discarded one leaves it sitting in the state it was already in — measured:
   * a dropped prompt left claude at `idle` with 0 tokens for 12s straight,
   * while a delivered one reached `working` within ~1.5s.
   *
   * Starting from `idle`, any departure from `idle` is evidence. Starting from
   * a state a previous turn left behind (`done`/`blocked`), only `working`
   * distinguishes a new turn from the old one.
   */
  async function promptWasConsumed(
    paneId: string,
    stateBeforeSend: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = (await getPane(paneId))?.agent_status;
      if (status === "working") return true;
      if (stateBeforeSend === "idle" && status && status !== "idle" && status !== "unknown") {
        return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(DELIVERY_POLL_INTERVAL_MS);
    }
  }

  return {
    name: "herdr",

    async create(createConfig: RuntimeCreateConfig): Promise<RuntimeHandle> {
      assertValidSessionId(createConfig.sessionId);

      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(createConfig.environment ?? {})) {
        envArgs.push("--env", `${key}=${value}`);
      }

      const result = await herdr(
        "workspace",
        "create",
        "--cwd",
        createConfig.workspacePath,
        "--label",
        createConfig.sessionId,
        ...envArgs,
        "--no-focus",
      );

      const workspace = asRecord(result.workspace);
      const rootPane = toPane(result.root_pane);
      const workspaceId = typeof workspace?.workspace_id === "string" ? workspace.workspace_id : "";
      if (!rootPane || !workspaceId) {
        throw new Error(
          `herdr workspace create returned no usable pane for session "${createConfig.sessionId}"`,
        );
      }

      // Launch the agent. Tear the workspace down on failure so a half-created
      // session never lingers in the shared server.
      try {
        const scriptPath = writeLaunchScript(createConfig.launchCommand);
        await herdr("pane", "run", rootPane.pane_id, "bash", scriptPath);
      } catch (err: unknown) {
        try {
          await herdr("workspace", "close", workspaceId);
        } catch {
          // Best-effort cleanup.
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to launch agent in herdr pane "${rootPane.pane_id}": ${msg}`, {
          cause: err,
        });
      }

      return {
        // Agents are addressable by pane id only — a pane's display label is not a
        // valid agent target — so the pane id is the handle identity.
        id: rootPane.pane_id,
        runtimeName: "herdr",
        data: {
          workspaceId,
          paneId: rootPane.pane_id,
          // Pane ids are positional (`w3:p1`) and can be reused after a workspace is
          // closed. terminal_id is unique per terminal, so it is kept to detect a
          // recycled pane id in isAlive().
          terminalId: rootPane.terminal_id ?? "",
          sessionId: createConfig.sessionId,
          workspacePath: createConfig.workspacePath,
          createdAt: Date.now(),
        },
      };
    },

    async destroy(handle: RuntimeHandle): Promise<void> {
      const workspaceId =
        typeof handle.data.workspaceId === "string" ? handle.data.workspaceId : "";
      try {
        if (workspaceId) {
          await herdr("workspace", "close", workspaceId);
        } else {
          await herdr("pane", "close", handle.id);
        }
      } catch {
        // Already gone — that's fine.
      }
    },

    /**
     * Deliver a message, verifying it was actually consumed and re-sending if not.
     *
     * A six-worker campaign showed that waiting for a settled agent is not enough:
     * herdr accepts `agent prompt` and returns success while the agent is still
     * starting, and the text is discarded with no error anywhere. Send-and-verify
     * is the only thing that closes it, which is the same conclusion 0001 §3 drew
     * about `ao send` — trust a durable signal, never a success string.
     *
     * `--wait` is deliberately not used: it does not track turns, so an unrelated
     * turn's completion can satisfy it.
     */
    async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
      const settledState = await waitForSettledAgent(handle.id, settleTimeoutMs);

      if (settledState) {
        for (let attempt = 1; attempt <= sendAttempts; attempt++) {
          const before = (await getPane(handle.id))?.agent_status ?? settledState;
          await herdr("agent", "prompt", handle.id, message);
          if (await promptWasConsumed(handle.id, before, deliveryTimeoutMs)) return;
          // No evidence it landed. The agent is almost certainly still warming
          // up, so let it settle again before retrying rather than hammering.
          await waitForSettledAgent(handle.id, settleTimeoutMs);
        }
      }

      // Either no agent was ever detected, or every prompt attempt was discarded.
      // Fall back to raw terminal input, which reaches a pane that herdr has not
      // classified as an agent at all.
      await herdr("pane", "send-text", handle.id, message);
      await sleep(300);
      await herdr("pane", "send-keys", handle.id, "Enter");

      // Report failure rather than returning a false success: an undelivered
      // instruction that reads as delivered is exactly the failure mode that cost
      // a worker its brief in 0001 §5.
      if (settledState && !(await promptWasConsumed(handle.id, "idle", deliveryTimeoutMs))) {
        throw new Error(
          `herdr agent in pane "${handle.id}" did not consume the message after ` +
            `${sendAttempts} attempts and a raw terminal fallback`,
        );
      }
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      // recent-unwrapped reaches the full scrollback of an alt-screen TUI agent,
      // which is the whole point of this runtime (0001 §4). It returns empty for a
      // pane with no detected agent, so fall back to the visible viewport.
      try {
        const recent = await readPane(handle.id, "recent-unwrapped", lines);
        if (recent.trim()) return recent;
      } catch {
        // Fall through to visible.
      }

      try {
        return await readPane(handle.id, "visible", lines);
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      const pane = await getPane(handle.id);
      if (!pane) return false;

      // Guard against a recycled pane id pointing at somebody else's terminal.
      const expected = typeof handle.data.terminalId === "string" ? handle.data.terminalId : "";
      if (expected && pane.terminal_id && pane.terminal_id !== expected) return false;

      return true;
    },

    async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
      const createdAt =
        typeof handle.data.createdAt === "number" ? handle.data.createdAt : Date.now();
      return { uptimeMs: Date.now() - createdAt };
    },

    async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
      // AttachInfo["type"] has no herdr member; "process" is the honest fit, and
      // consumers that understand `command` get the exact attach invocation.
      return {
        type: "process",
        target: handle.id,
        command: `herdr agent attach ${handle.id}`,
      };
    },
  };
}

/** Report whether a herdr server is reachable — the binary alone is not enough. */
export function detect(): boolean {
  try {
    const stdout = execFileSync("herdr", ["status", "server"], {
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /status:\s*running/.test(stdout);
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Runtime>;
