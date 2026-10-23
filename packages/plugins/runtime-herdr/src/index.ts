/**
 * Runtime plugin: herdr (https://herdr.dev) — an agent-aware terminal workspace server.
 *
 * Every command goes through the `herdr` CLI, which speaks to a long-running server
 * over a unix socket and answers in JSON. The server is shared: it may already be
 * running with the user's own workspaces in it, so this plugin creates workspaces,
 * closes none and never stops the server. herdr reuses pane and workspace IDs, so a
 * close by ID could reach another terminal: a failed create keeps what it made and
 * says so (`RuntimeCreatePartialError`, Herdr fit-2 F-4), and `destroy` refuses
 * (fit F-5).
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
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HERDR_CLI_IDS,
  RUNTIME_NO_SERVER_ERROR_CODE,
  RuntimeCreatePartialError,
  RuntimeSendRefusedError,
  herdrExecOptions,
  herdrInvocationFor,
  herdrPreRequestRefusal,
  isHerdrNoServer,
  isHerdrPaneId,
  readHerdrCliFailure,
  resolveHerdrEndpoint,
  type HerdrCliFailure,
  type HerdrEndpoint,
  type HerdrInvocation,
  type PluginModule,
  type Runtime,
  type RuntimeCreateConfig,
  type RuntimeCreateStage,
  type RuntimeHandle,
  type RuntimeMetrics,
  type RuntimeSendAdmission,
  type RuntimeStopOutcome,
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

/**
 * States in which herdr considers an agent able to accept a prompt. Herdr
 * fit-2 F-3: `blocked` is not one of them. A blocked agent waits for an
 * answer to its own question (a permission prompt); a prompt or raw text
 * could answer that question, so `sendMessage` refuses instead.
 */
const SETTLED_STATES = new Set(["idle", "done"]);

/** The agent state in which `sendMessage` refuses (F-3). */
const BLOCKED_STATE = "blocked";

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
 * herdr answers `{"id":...,"result":{...}}` on success with exit code 0. herdr
 * 0.8.0 answers a failure `{"error":{"code","message"}}` with exit code 0 too, so
 * the error has to be read out of the body; 0.9.5 exits 1 and writes it to
 * stderr (`herdrCallError`). With `requireResult` (same-ID R4 round 4, M-1),
 * only a `result` object answers.
 */
function parseHerdrResult(stdout: string, requireResult = false): Record<string, unknown> {
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
  if (error !== undefined && error !== null) {
    // Same-ID R4 round 3 (M-3): an error that is not an object, or an answer
    // with both an error and a result, is malformed: it throws without a
    // `herdrCode`, so no caller reads its code as evidence.
    if (typeof error !== "object") {
      throw new Error(`herdr answered an error that is not an object: ${JSON.stringify(error)}`);
    }
    const e = error as Record<string, unknown>;
    if (obj.result !== undefined && obj.result !== null) {
      throw new Error(`herdr answered both an error (${String(e.code ?? "unknown")}) and a result`);
    }
    throw Object.assign(
      new Error(`herdr error ${String(e.code ?? "unknown")}: ${String(e.message ?? "")}`),
      { herdrCode: e.code },
    );
  }

  const result = obj.result;
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  // Same-ID R4 round 4 (review r3, M-1): for a read that decides a negative,
  // a body without a `result` object (none, null, a scalar or a list) is
  // malformed, also with a top-level `pane`. It throws without a `herdrCode`.
  if (requireResult) {
    throw new Error(
      `herdr answered without a result object (result: ${JSON.stringify(result) ?? "absent"})`,
    );
  }
  return obj;
}

/**
 * Same-ID R4 (B-7 item 9): herdr's explicit answer that a pane does not
 * exist. Round 2 (M-3): only the `pane_not_found` code of herdr's error
 * envelope (`herdrCode`), never text: a command that fails (herdr cannot
 * start, a timeout, a signal, a non-zero exit) has no `herdrCode`, whatever
 * its message or binary path holds. Herdr fit F-1: the envelope counts on
 * stdout at exit 0 (0.8.0, set by parseHerdrResult) and in the exact 0.9.5
 * failure form (set by herdrCallError). Any other failure means that the
 * check could not run.
 */
function isPaneNotFound(err: unknown): boolean {
  return (err as { herdrCode?: unknown } | null)?.herdrCode === "pane_not_found";
}

/** A rejection whose `code` says that no herdr server answers at the socket. */
function isNoServer(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === RUNTIME_NO_SERVER_ERROR_CODE;
}

/** The command ID of herdr's error answer for a call (HERDR_CLI_IDS), or "" for none. */
function cliIdOf(args: readonly string[]): string {
  const key = `${args[0] ?? ""} ${args[1] ?? ""}`;
  return Object.hasOwn(HERDR_CLI_IDS, key) ? HERDR_CLI_IDS[key] : "";
}

/**
 * Herdr fit F-1: the error of a failed herdr call. herdr 0.9.5's error answer
 * (readHerdrCliFailure, with the call's command ID) throws as the 0.8.0
 * envelope does, with `herdrCode`, and the CLI's no-server answer also has
 * `code` RUNTIME_NO_SERVER_ERROR_CODE. Every other failure is thrown as it
 * is: no `herdrCode`, and its `code` stays the one of `execFile` (an exit
 * number or an errno name).
 */
function herdrCallError(args: readonly string[], err: unknown): unknown {
  const failure = readHerdrCliFailure(err, cliIdOf(args));
  if (!failure) return err;
  return Object.assign(
    new Error(`herdr error ${failure.code}: ${failure.message}`, { cause: err }),
    { herdrCode: failure.code },
    isHerdrNoServer(failure) ? { code: RUNTIME_NO_SERVER_ERROR_CODE } : {},
  );
}

/**
 * Herdr fit-2: the 0.9.5 failure form of a failed call (readHerdrCliFailure).
 * For the wrapper of herdrCallError (an error with `herdrCode`) it reads the
 * wrapped rejection, so the reader checks the exit code, the empty stdout, the
 * one stderr line and the command ID itself. The 0.8.0 envelope at exit 0 has
 * no such form: null.
 */
function cliFailureOf(err: unknown, args: readonly string[]): HerdrCliFailure | null {
  const wrapped = typeof (err as { herdrCode?: unknown } | null)?.herdrCode === "string";
  return readHerdrCliFailure(wrapped ? (err as { cause?: unknown }).cause : err, cliIdOf(args));
}

/** The first line of a failure, for a message: its stderr, else its message. */
function firstLineOf(err: unknown): string {
  const stderr = (err as { stderr?: unknown } | null)?.stderr;
  const text =
    typeof stderr === "string" && stderr.trim()
      ? stderr
      : err instanceof Error
        ? err.message
        : String(err);
  return text.trim().split("\n")[0] ?? "";
}

/**
 * Herdr fit-2: the cause of a failed create call, for its message: the F1
 * code and text, the 0.8.0 error envelope, or "transport failure: <the first
 * stderr line>" (a timeout, a signal, another exit, text that is not herdr's
 * form).
 */
function createCauseOf(err: unknown, args: readonly string[]): string {
  const failure = cliFailureOf(err, args);
  if (failure) return `${failure.code}: ${failure.message}`;
  if (typeof (err as { herdrCode?: unknown } | null)?.herdrCode === "string") {
    return err instanceof Error ? err.message : String(err);
  }
  return `transport failure: ${firstLineOf(err)}`;
}

/** Herdr fit F-2: the refusal of a pane call for an ID outside herdr's grammar. */
function notAPaneId(operation: string, id: unknown): Error {
  return new Error(
    `herdr ${operation}: ${JSON.stringify(id)} is not a herdr pane ID; no herdr call was made`,
  );
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
  try {
    writeFileSync(scriptPath, content, { encoding: "utf-8", mode: 0o700 });
  } catch (err) {
    // Herdr fit-2: no partial script stays (no run can have read it).
    removeLaunchScript(scriptPath);
    throw err;
  }
  return scriptPath;
}

/** Remove a launch script that no `pane run` received, best effort. */
function removeLaunchScript(scriptPath: string): void {
  try {
    rmSync(scriptPath, { force: true });
  } catch {
    // Best effort: a script that stays names no session and runs nothing.
  }
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

  /**
   * Herdr fit F-6: the calls for a handle use its pins (herdrInvocationFor):
   * a pinned launch runs its own binary at its own socket; a handle made
   * before the pins runs `bin` with the caller's environment, as before.
   * Malformed pins throw HerdrPinError before any call.
   */
  function invocationFor(handle: RuntimeHandle): HerdrInvocation {
    return herdrInvocationFor(handle, bin);
  }

  /** Run a herdr CLI command and return its stdout; a failure throws herdrCallError. */
  async function herdrStdout(invocation: HerdrInvocation, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        invocation.bin,
        args,
        herdrExecOptions(invocation, commandTimeoutMs),
      );
      return stdout;
    } catch (err: unknown) {
      throw herdrCallError(args, err);
    }
  }

  /** Run a herdr CLI command and return its parsed `result` object. */
  async function herdr(
    invocation: HerdrInvocation,
    ...args: string[]
  ): Promise<Record<string, unknown>> {
    return parseHerdrResult(await herdrStdout(invocation, args));
  }

  /** `herdr` for a read that decides a negative: only a `result` object answers. */
  async function herdrResult(
    invocation: HerdrInvocation,
    ...args: string[]
  ): Promise<Record<string, unknown>> {
    return parseHerdrResult(await herdrStdout(invocation, args), true);
  }

  /** Read a pane, returning raw terminal text (read commands answer in text, not JSON). */
  async function readPane(
    invocation: HerdrInvocation,
    paneId: string,
    source: string,
    lines: number,
  ): Promise<string> {
    const { stdout } = await execFileAsync(
      invocation.bin,
      ["pane", "read", paneId, "--source", source, "--lines", String(lines)],
      herdrExecOptions(invocation, commandTimeoutMs),
    );
    return stdout.trimEnd();
  }

  /**
   * Same-ID R4 (B-7 item 9): the pane, or null only for herdr's explicit
   * `pane_not_found`. Rejects with the cause when the check could not run:
   * another error envelope, a reply without a pane, a command that fails
   * (herdr cannot start, a timeout, a signal, a non-zero exit), and (round
   * 2, M-3) a reply for another pane, which says nothing about this one.
   * Round 3 (M-3): also a contradictory envelope (see parseHerdrResult) and
   * a `terminal_id` that is not text, which shows neither the same nor a
   * replaced terminal.
   * Round 4 (review r3, M-1): the pane counts only inside a `result` object;
   * a top-level `pane` is no answer of herdr.
   * Herdr fit F-1: `pane_not_found` from either channel is null; the wrapper
   * keeps the no-server `code` of its cause, which the lifecycle and startup
   * read. F-2: an ID outside herdr's pane ID grammar rejects with no call.
   */
  async function getPaneStrict(
    invocation: HerdrInvocation,
    paneId: string,
  ): Promise<HerdrPane | null> {
    if (!isHerdrPaneId(paneId)) throw notAPaneId("pane get", paneId);
    let result: Record<string, unknown>;
    try {
      result = await herdrResult(invocation, "pane", "get", paneId);
    } catch (err) {
      if (isPaneNotFound(err)) return null;
      const detail = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
      throw Object.assign(
        new Error(`herdr pane get ${paneId} could not answer: ${detail}`, { cause: err }),
        isNoServer(err) ? { code: RUNTIME_NO_SERVER_ERROR_CODE } : {},
      );
    }
    const pane = toPane(result.pane);
    if (!pane) throw new Error(`herdr pane get ${paneId} answered without a pane`);
    if (pane.pane_id !== paneId) {
      throw new Error(`herdr pane get ${paneId} answered for another pane (${pane.pane_id})`);
    }
    const terminalId = asRecord(result.pane)?.terminal_id;
    if (terminalId !== undefined && terminalId !== null && typeof terminalId !== "string") {
      throw new Error(
        `herdr pane get ${paneId} answered a terminal_id that is not text (${JSON.stringify(terminalId)})`,
      );
    }
    return pane;
  }

  /**
   * The pane for the delivery waits (`sendMessage`), null for any failure:
   * a wait polls again, and no stop or removal decides from it.
   */
  async function getPane(invocation: HerdrInvocation, paneId: string): Promise<HerdrPane | null> {
    return getPaneStrict(invocation, paneId).catch(() => null);
  }

  /**
   * Block until herdr reports an agent in the pane, in a state that accepts input.
   * Returns the observed state, or null on timeout. Herdr fit-2 F-3: it stops
   * at the first poll that shows `blocked`, and returns that state, also when
   * herdr names no agent (its PaneInfo allows `agent: null`; review r2 m-1).
   *
   * NOTE: this is necessary but NOT sufficient for delivery. herdr reports
   * `idle` as soon as it recognises the agent's prompt box, which happens
   * seconds before the agent can actually consume input — measured at ~1.5s
   * after launch for claude, where a prompt is accepted by herdr and silently
   * discarded. Delivery must be verified separately; see `promptWasConsumed`.
   */
  async function waitForSettledAgent(
    invocation: HerdrInvocation,
    paneId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const pane = await getPane(invocation, paneId);
      if (pane?.agent_status === BLOCKED_STATE) return BLOCKED_STATE;
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
   * Starting from `idle`, any departure from `idle` is evidence (also
   * `blocked`: the prompt started a turn that now asks a question). Starting
   * from a state a previous turn left behind (`done`), only `working`
   * distinguishes a new turn from the old one.
   */
  async function promptWasConsumed(
    invocation: HerdrInvocation,
    paneId: string,
    stateBeforeSend: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const status = (await getPane(invocation, paneId))?.agent_status;
      if (status === "working") return true;
      if (stateBeforeSend === "idle" && status && status !== "idle" && status !== "unknown") {
        return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(DELIVERY_POLL_INTERVAL_MS);
    }
  }

  /**
   * The endpoint of this plugin's own binary (`binPath`) and the caller's
   * environment, when a compatible server runs there; else it rejects. The
   * binary is missing, or the status call fails: the rejection of
   * resolveHerdrEndpoint.
   */
  async function usableEndpoint(): Promise<HerdrEndpoint> {
    const endpoint = await resolveHerdrEndpoint({ binPath: bin, env: process.env });
    if (endpoint.running !== true) {
      throw new Error(`no herdr server runs at ${endpoint.socket}; start one: herdr server`);
    }
    if (endpoint.compatible !== true) {
      throw new Error(
        `the herdr server at ${endpoint.socket} is not compatible with this herdr client ` +
          `(version ${endpoint.version ?? "unknown"}, protocol ${endpoint.protocol ?? "unknown"}); restart it with this herdr`,
      );
    }
    return endpoint;
  }

  return {
    name: "herdr",

    /**
     * Herdr fit-2 (design r11 5.3.6): the readiness of this plugin's binary
     * and endpoint, for `ao start` and `ao spawn` (create step 1 without the
     * create). It caches nothing.
     */
    async preflight(): Promise<void> {
      await usableEndpoint();
    },

    async create(createConfig: RuntimeCreateConfig): Promise<RuntimeHandle> {
      assertValidSessionId(createConfig.sessionId);

      // Herdr fit-2 F-4 (design r11 5.2.1): a failed create closes nothing.
      // It throws a plain error only when no request of this create reached
      // the server (rule Q: step 1, and the CLI's own refusals of steps 2 and
      // 5); otherwise it throws RuntimeCreatePartialError with the handle of
      // what may exist, and core keeps the record, the worktree and the agent
      // session (a kept failed launch).
      const { sessionId, workspacePath } = createConfig;

      // Step 1 (Q0). Herdr fit F-6: pin the binary and the server endpoint
      // first, and make every call of this launch with them; the handle
      // stores them for every later call (herdrInvocationFor).
      const endpoint = await usableEndpoint();
      const pinned: HerdrInvocation = {
        bin: endpoint.bin,
        env: { ...process.env, HERDR_SOCKET_PATH: endpoint.socket },
      };
      const createdAt = Date.now();
      /** The handle data of this launch: the parsed IDs, the session and the pins. */
      const launchData = (ids: {
        workspaceId?: string;
        paneId?: string;
        terminalId?: string;
      }): Record<string, unknown> => ({
        ...ids,
        sessionId,
        workspacePath,
        createdAt,
        herdrBin: endpoint.bin,
        herdrSocket: endpoint.socket,
      });
      /** Rule Q: a failure of the CLI that sent no request to the pinned server. */
      const refusedBeforeRequest = (err: unknown, args: readonly string[]): boolean =>
        herdrPreRequestRefusal(cliFailureOf(err, args), endpoint.socket) !== null;

      // Step 2: the workspace.
      const envArgs: string[] = [];
      for (const [key, value] of Object.entries(createConfig.environment ?? {})) {
        envArgs.push("--env", `${key}=${value}`);
      }
      const createArgs = [
        "workspace",
        "create",
        "--cwd",
        workspacePath,
        "--label",
        sessionId,
        ...envArgs,
        "--no-focus",
      ];
      const workspaceUnconfirmed = (
        message: string,
        ids: { workspaceId?: string; paneId?: string; terminalId?: string },
        cause?: unknown,
      ): RuntimeCreatePartialError =>
        new RuntimeCreatePartialError(message, {
          handle: {
            id: "",
            runtimeName: "herdr",
            data: { ...launchData(ids), createIncomplete: "workspace-unconfirmed" },
          },
          stage: "workspace-unconfirmed",
          cause,
        });
      let result: Record<string, unknown>;
      try {
        result = await herdr(pinned, ...createArgs);
      } catch (err: unknown) {
        // Q1 and Q2: the plain error of the wrapper, with its herdrCode (and
        // the no-server code for Q1).
        if (refusedBeforeRequest(err, createArgs)) throw err;
        throw workspaceUnconfirmed(
          `herdr workspace create did not confirm a workspace for session ${sessionId} (${createCauseOf(err, createArgs)}); AO closed nothing`,
          {},
          err,
        );
      }

      // Step 3: the answer. Herdr fit F-2: a root pane ID outside herdr's
      // grammar is no usable pane; no call is made with it.
      const workspace = asRecord(result.workspace);
      const rootPane = toPane(result.root_pane);
      const workspaceId = typeof workspace?.workspace_id === "string" ? workspace.workspace_id : "";
      const paneId = rootPane && isHerdrPaneId(rootPane.pane_id) ? rootPane.pane_id : "";
      const terminalId = rootPane?.terminal_id ?? "";
      if (!workspaceId || !paneId || !terminalId) {
        throw workspaceUnconfirmed(
          `herdr workspace create returned no usable pane for session "${sessionId}"; AO closed nothing`,
          {
            ...(workspaceId ? { workspaceId } : {}),
            ...(paneId ? { paneId } : {}),
            ...(terminalId ? { terminalId } : {}),
          },
        );
      }
      const ids = { workspaceId, paneId, terminalId };
      const launchFailed = (
        stage: Exclude<RuntimeCreateStage, "workspace-unconfirmed">,
        cause: string,
        err?: unknown,
        extra: Record<string, unknown> = {},
      ): RuntimeCreatePartialError =>
        new RuntimeCreatePartialError(
          `Failed to launch agent in herdr pane ${paneId} (${stage}): ${cause}. ` +
            `Workspace ${workspaceId}, terminal ${terminalId}, socket ${endpoint.socket}. AO closed nothing.`,
          {
            handle: {
              id: paneId,
              runtimeName: "herdr",
              data: { ...launchData(ids), createIncomplete: stage, ...extra },
            },
            stage,
            cause: err,
          },
        );

      // Step 4: the launch script.
      let scriptPath: string;
      try {
        scriptPath = writeLaunchScript(createConfig.launchCommand);
      } catch (err: unknown) {
        throw launchFailed(
          "launch-not-submitted",
          `the launch script could not be written: ${firstLineOf(err)}`,
          err,
        );
      }

      // Step 5: the launch. A refusal of the CLI (rule Q) sent nothing, so
      // the script goes; after any other failure the server may run it, so it
      // stays.
      const runArgs = ["pane", "run", paneId, "bash", scriptPath];
      try {
        await herdr(pinned, ...runArgs);
      } catch (err: unknown) {
        if (refusedBeforeRequest(err, runArgs)) {
          removeLaunchScript(scriptPath);
          throw launchFailed("launch-not-submitted", createCauseOf(err, runArgs), err);
        }
        throw launchFailed("launch-unconfirmed", createCauseOf(err, runArgs), err);
      }

      // Step 6: the pane still has the terminal of step 3. A check, not a
      // binding: it shows a server restart between the create and the run,
      // not one after it.
      let paneAfterRun: HerdrPane | null;
      try {
        paneAfterRun = await getPaneStrict(pinned, paneId);
      } catch (err: unknown) {
        throw launchFailed(
          "launch-unconfirmed",
          `after the run, ${(err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim()}`,
          err,
        );
      }
      if (!paneAfterRun) {
        throw launchFailed(
          "launch-unconfirmed",
          `after the run, herdr pane get ${paneId} answered pane_not_found`,
        );
      }
      if (paneAfterRun.terminal_id !== terminalId) {
        throw launchFailed(
          "launch-unconfirmed",
          `after the run, herdr pane get ${paneId} answered terminal ${paneAfterRun.terminal_id ?? "none"}, not ${terminalId}`,
          undefined,
          paneAfterRun.terminal_id ? { terminalAfterRun: paneAfterRun.terminal_id } : {},
        );
      }

      return {
        // Agents are addressable by pane id only — a pane's display label is not a
        // valid agent target — so the pane id is the handle identity.
        id: paneId,
        runtimeName: "herdr",
        // Pane ids are positional (`w3:p1`) and can be reused after a workspace is
        // closed. terminal_id is unique per terminal, so it is kept to detect a
        // recycled pane id in isAlive().
        data: launchData(ids),
      };
    },

    /**
     * Herdr fit F-5 (W-5b): destroy closes nothing and makes no herdr call.
     * It closed the recorded workspace (or pane) by its ID with no check and
     * swallowed every error, but herdr reuses pane and workspace IDs, so a
     * close by ID could reach another terminal (same-ID R2a, N-1). Core never
     * calls it (`stopRuntime` uses `stop`); a direct caller gets this refusal.
     */
    async destroy(_handle: RuntimeHandle): Promise<void> {
      throw new Error(
        "runtime-herdr destroy closes nothing: herdr reuses pane and workspace IDs, so a close by ID " +
          "could reach another terminal (same-ID R2a). Use the stop; close the workspace by hand after you check it.",
      );
    },

    /**
     * Same-ID R2a: the stop answers `unknown` and closes nothing. Pane and
     * workspace IDs are positional and herdr reuses them, and a check before
     * the close cannot cover a replacement that takes the IDs between the
     * check and the close (same-ID review r2, B-2). Until herdr offers a close
     * that names the terminal itself, AO keeps the record and the worktree of
     * a Herdr session; the operator closes the workspace by hand. A retry
     * gives the same answer, so `next` says that instead of a retry.
     */
    async stop(handle: RuntimeHandle): Promise<RuntimeStopOutcome> {
      const workspaceId =
        typeof handle.data.workspaceId === "string" ? handle.data.workspaceId : "";
      const terminal = workspaceId ? `workspace ${workspaceId}` : `pane ${handle.id}`;
      return {
        outcome: "unknown",
        detail:
          `the Herdr close cannot yet check the terminal at close time (same-ID review r2, B-2): ` +
          `herdr reuses pane and workspace IDs, so a close of ${terminal} ` +
          `could reach another terminal; nothing was closed. Close it by hand in herdr after you check that it is this session`,
        next:
          `Close herdr ${terminal} by hand after you check that it belongs to this session. ` +
          `AO cannot stop a Herdr session yet: a retry of this command gives the same refusal, ` +
          `and AO keeps the record and the worktree of this session until it can check the terminal at close time.`,
      };
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
      // Herdr fit F-2: no prompt, read or raw input for an ID outside the grammar.
      if (!isHerdrPaneId(handle.id)) throw notAPaneId("send", handle.id);
      const invocation = invocationFor(handle);
      // Herdr fit-2 F-3: a blocked agent waits for an answer to its own
      // question. AO sends it nothing more: no prompt, no raw text and no key
      // (any of them could answer the question), and the caller gets a typed
      // refusal. `admitted` says whether an earlier prompt of this send may
      // have reached the agent.
      const refuse = (admitted: RuntimeSendAdmission, stage: string, cause?: unknown): never => {
        throw new RuntimeSendRefusedError(
          `herdr agent in pane ${handle.id} is blocked and waits for input (agent_blocked); ` +
            `nothing more was sent (${stage})` +
            (admitted === "none" ? "" : "; an earlier prompt of this send may have been delivered"),
          { admitted, target: handle.id, stage, cause },
        );
      };
      const settledState = await waitForSettledAgent(invocation, handle.id, settleTimeoutMs);
      if (settledState === BLOCKED_STATE) refuse("none", "first settle wait");

      if (settledState) {
        for (let attempt = 1; attempt <= sendAttempts; attempt++) {
          const before = (await getPane(invocation, handle.id))?.agent_status ?? settledState;
          try {
            await herdr(invocation, "agent", "prompt", handle.id, message);
          } catch (err) {
            if ((err as { herdrCode?: unknown } | null)?.herdrCode === "agent_blocked") {
              refuse(
                attempt === 1 ? "none" : "earlier-attempt-unconfirmed",
                `agent prompt, attempt ${attempt}`,
                err,
              );
            }
            throw err;
          }
          if (await promptWasConsumed(invocation, handle.id, before, deliveryTimeoutMs)) return;
          // No evidence it landed. The agent is almost certainly still warming
          // up, so let it settle again before retrying rather than hammering.
          const settledAgain = await waitForSettledAgent(invocation, handle.id, settleTimeoutMs);
          if (settledAgain === BLOCKED_STATE) {
            refuse("earlier-attempt-unconfirmed", `settle wait after attempt ${attempt}`);
          }
        }
      }

      // Either no agent was ever detected, or every prompt attempt was discarded.
      // Fall back to raw terminal input, which reaches a pane that herdr has not
      // classified as an agent at all.
      await herdr(invocation, "pane", "send-text", handle.id, message);
      await sleep(300);
      await herdr(invocation, "pane", "send-keys", handle.id, "Enter");

      // Report failure rather than returning a false success: an undelivered
      // instruction that reads as delivered is exactly the failure mode that cost
      // a worker its brief in 0001 §5.
      if (
        settledState &&
        !(await promptWasConsumed(invocation, handle.id, "idle", deliveryTimeoutMs))
      ) {
        throw new Error(
          `herdr agent in pane "${handle.id}" did not consume the message after ` +
            `${sendAttempts} attempts and a raw terminal fallback`,
        );
      }
    },

    async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
      // Herdr fit F-2: an ID outside herdr's grammar names no pane to read.
      if (!isHerdrPaneId(handle.id)) return "";
      // Herdr fit F-6: malformed pins read nothing.
      let invocation: HerdrInvocation;
      try {
        invocation = invocationFor(handle);
      } catch {
        return "";
      }
      // recent-unwrapped reaches the full scrollback of an alt-screen TUI agent,
      // which is the whole point of this runtime (0001 §4). It returns empty for a
      // pane with no detected agent, so fall back to the visible viewport.
      try {
        const recent = await readPane(invocation, handle.id, "recent-unwrapped", lines);
        if (recent.trim()) return recent;
      } catch {
        // Fall through to visible.
      }

      try {
        return await readPane(invocation, handle.id, "visible", lines);
      } catch {
        return "";
      }
    },

    async isAlive(handle: RuntimeHandle): Promise<boolean> {
      // Same-ID R4 (B-7 item 9): false only for `pane_not_found` and for a
      // pane ID that names another terminal; rejects when herdr cannot answer.
      // Herdr fit F-1, F-2: `pane_not_found` also in the 0.9.5 failure form;
      // no server at the socket rejects with RUNTIME_NO_SERVER_ERROR_CODE; an
      // empty ID or one outside the grammar rejects with no call. F-6: the
      // handle's pins; malformed pins reject with no call.
      if (!isHerdrPaneId(handle.id)) throw notAPaneId("pane get", handle.id);
      const pane = await getPaneStrict(invocationFor(handle), handle.id);
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
