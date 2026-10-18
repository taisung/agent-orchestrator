import {
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  shellEscape,
  buildAgentPath,
  readLastActivityEntry,
  getActivityFallbackState,
  recordTerminalActivity,
  setupPathWrapperWorkspace,
  PREFERRED_GH_PATH,
  asValidOpenCodeSessionId,
  getOpenCodeSession,
  createOpenCodeSession,
  listOpenCodeModels,
  findOpenCodeModelProblem,
  switchOpenCodeSessionModel,
  switchOpenCodeSessionAgent,
  hasOpenCodeUserMessage,
  getNewestOpenCodeUserMessage,
  interruptOpenCodeSession,
  removeOpenCodeSession,
  OpenCodeApiTimeoutError,
  OPENCODE_API_TIMEOUT_MS,
  HERDR_RUNTIME_NAME,
  getHerdrPaneProcesses,
  isHerdrProcessRunning,
  SessionNotRestorableError,
  type Agent,
  type AgentSessionInfo,
  type AgentLaunchConfig,
  type AgentLaunchConfirmation,
  type AgentLaunchConfirmOptions,
  type AgentSessionPrepareContext,
  type ActivityDetection,
  type ActivityState,
  type PluginModule,
  type PreparedAgentSession,
  type ProjectConfig,
  type RuntimeHandle,
  type Session,
  type WorkspaceHooksConfig,
  type OpenCodeAgentConfig,
  type OpenCodeApiSession,
  type OpenCodeModelRef,
  type OpenCodeUserMessageMark,
} from "@aoagents/ao-core";
import {
  classifyOpenCodePaneActivity,
  getApiActivityState,
  getApiSessionInfo,
} from "./api-activity.js";
import { execFile, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Compare the session that `opencode api session.get` prints with the requested
 * model and agent (argv[2]). Exit 1 when session.get exited nonzero (argv[1]),
 * whatever it printed, and show the stored values when they differ from the request.
 * 2.x stores a model without a variant as variant `default`.
 */
function buildApiSettingsCheckScript(): string {
  const script = `
let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  const status = process.argv[1];
  if (status !== '0') { process.stderr.write(input + 'opencode api session.get exited with status ' + status + '\\n'); process.exit(1); }
  const want = JSON.parse(process.argv[2]);
  let got;
  try { got = JSON.parse(input).data; } catch {}
  if (!got || typeof got !== 'object') { process.stderr.write(input); process.exit(1); }
  const variant = m => m.variant || 'default';
  const modelOk = !want.model || (!!got.model && got.model.providerID === want.model.providerID && got.model.id === want.model.id && variant(got.model) === variant(want.model));
  const agentOk = !want.agent || got.agent === want.agent;
  if (modelOk && agentOk) process.exit(0);
  process.stderr.write('OpenCode stored agent ' + JSON.stringify(got.agent) + ' and model ' + JSON.stringify(got.model) + '\\n');
  process.exit(1);
});
  `.trim();
  return script.replace(/\n/g, " ").replace(/\s+/g, " ");
}

// =============================================================================
// OpenCode Version Gate
// =============================================================================

interface OpenCodeVersion {
  major: number;
  minor: number;
  patch: number;
  /** True for a semver pre-release such as `2.1.0-beta.1`. */
  prerelease: boolean;
}

/**
 * Minimum OpenCode version this plugin supports (owner decision Q9 of note
 * 0009: a minimum, not a major pin). Only 2.0.29 is measured, and the 2.x API
 * surface this plugin drives (`session.create`, `session.get`,
 * `session.switchModel`, `session.switchAgent`) is read from the 2.0.29
 * document, so anything older is refused and any later 2.x or later major is
 * accepted.
 */
const OPENCODE_MIN_VERSION: OpenCodeVersion = { major: 2, minor: 0, patch: 29, prerelease: false };

/** The floor as text, derived from the one definition above. */
const OPENCODE_MIN_VERSION_TEXT = `${OPENCODE_MIN_VERSION.major}.${OPENCODE_MIN_VERSION.minor}.${OPENCODE_MIN_VERSION.patch}`;

/**
 * Bound on `opencode --version`. 2.0.29 answers in about 0.1 s; the bound only
 * stops a hanging binary from blocking `ao spawn`, `ao start` and
 * `ao session restore`, which call the probe synchronously.
 */
const OPENCODE_VERSION_TIMEOUT_MS = 10_000;

/**
 * One line of `opencode --version` output that starts with a version:
 * `opencode v2.0.29` on 2.x, `1.18.35` on 1.x, with an optional semver
 * pre-release (`-beta.1`), build suffix (`+abc`) and text after a space.
 */
const OPENCODE_VERSION_LINE =
  /^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?(?:\s.*)?$/;

/**
 * Parse the first line of the output that starts with a version, so a notice
 * that only contains a number (`update available 1.2.3`) cannot decide.
 * Output without such a line (empty output, `opencode dev`) parses to null.
 */
function parseOpenCodeVersion(output: string): OpenCodeVersion | null {
  for (const line of output.split(/\r?\n/)) {
    const match = OPENCODE_VERSION_LINE.exec(line.trim());
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (![major, minor, patch].every(Number.isSafeInteger)) return null;
    return { major, minor, patch, prerelease: match[4] !== undefined };
  }
  return null;
}

/**
 * Semver order against the floor. A pre-release of a later version
 * (`2.1.0-beta.1`) is past the floor and is accepted. A pre-release of the
 * floor itself (`2.0.29-beta.1`) comes before the floor, as semver orders it,
 * and is refused: the minimum is the measured 2.0.29 release.
 */
function isAtLeastMinimum(version: OpenCodeVersion): boolean {
  const floor = OPENCODE_MIN_VERSION;
  if (version.major !== floor.major) return version.major > floor.major;
  if (version.minor !== floor.minor) return version.minor > floor.minor;
  if (version.patch !== floor.patch) return version.patch > floor.patch;
  return !version.prerelease;
}

/** Short, one-line form of the probe output for the refusal message. */
function summarizeVersionOutput(output: string): string {
  const text = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" | ");
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

type OpenCodeVersionCheck = { supported: true } | { supported: false; reason: string };

/**
 * Run `opencode --version` and decide. The probe uses the Node process PATH,
 * the same lookup the pane's shell performs unless the user's shell init
 * reorders PATH. Each outcome that is not positive evidence of a supported
 * release is a refusal with its own reason: a missing binary, no answer within
 * the bound, a failed run (also when stdout holds a version, because a failing
 * `--version` is not a working binary), empty output, and output that is not a
 * version at or past the floor. stderr is discarded so it does not reach the
 * terminal of `ao spawn`.
 */
function checkOpenCodeVersion(): OpenCodeVersionCheck {
  let output: string;
  try {
    output = execFileSync("opencode", ["--version"], {
      encoding: "utf-8",
      timeout: OPENCODE_VERSION_TIMEOUT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      status?: number | null;
      signal?: NodeJS.Signals | null;
      stdout?: string | Buffer | null;
    };
    if (error.code === "ENOENT") {
      return { supported: false, reason: "opencode not found on PATH" };
    }
    if (error.code === "ETIMEDOUT") {
      return {
        supported: false,
        reason: `opencode --version gave no answer within ${OPENCODE_VERSION_TIMEOUT_MS / 1000} s`,
      };
    }
    const stdout = error.stdout ? summarizeVersionOutput(String(error.stdout)) : "";
    const how =
      typeof error.status === "number"
        ? `exited with status ${error.status}`
        : error.signal
          ? `was stopped by ${error.signal}`
          : `could not run (${error.code ?? error.message})`;
    return {
      supported: false,
      reason: `opencode --version ${how}${stdout ? `, output: ${stdout}` : ""}`,
    };
  }

  const summary = summarizeVersionOutput(output);
  if (summary.length === 0) {
    return { supported: false, reason: "opencode --version printed nothing" };
  }
  const version = parseOpenCodeVersion(output);
  if (version && isAtLeastMinimum(version)) return { supported: true };
  return { supported: false, reason: `found ${summary}` };
}

/**
 * Fail an explicit spawn or restore before the pane starts. `session-manager.ts`
 * calls `getLaunchCommand` and `getRestoreCommand` before `runtime.create` (and,
 * on restore, before it destroys the old runtime), inside paths that clean up
 * on a throw, so `ao spawn`, `ao start` and `ao session restore` exit nonzero
 * without opening a TUI.
 */
function assertSupportedOpenCodeVersion(): void {
  const check = checkOpenCodeVersion();
  if (check.supported) return;
  throw new Error(`ao needs OpenCode ${OPENCODE_MIN_VERSION_TEXT} or later (${check.reason})`);
}

/** Split `provider/model[#variant]` (the CLI `--model` form) into the 2.x API model reference. */
function toOpenCodeModelRef(model: string): OpenCodeModelRef | undefined {
  const slash = model.indexOf("/");
  if (slash <= 0) return undefined;
  const [id, variant] = model.slice(slash + 1).split("#", 2);
  if (!id) return undefined;
  return { providerID: model.slice(0, slash), id, ...(variant ? { variant } : {}) };
}

/**
 * The failure commands stop the script with status 1 and open no TUI, so the pane
 * never runs OpenCode with settings other than the requested ones.
 */
function invalidModelCommand(model: string): string {
  return `echo ${shellEscape(invalidModelMessage(model))} >&2; exit 1`;
}

function invalidModelMessage(model: string): string {
  return `OpenCode ${OPENCODE_MIN_VERSION.major}.x needs the model as provider/model[#variant], got: ${model}`;
}

/** `sessionWord` is the shell word that expands to the session ID. */
function settingsFailureCommand(sessionWord: string): string {
  return `echo ${shellEscape("failed to set the OpenCode model or agent for")} ${sessionWord} >&2; exit 1`;
}

/** `sessionParam` is the shell word for `--param`, for example `'sessionID=ses_...'`. */
function buildApiSessionCall(
  operation: string,
  sessionParam: string,
  body?: Record<string, unknown>,
): string {
  return [
    "opencode",
    "api",
    operation,
    "--param",
    sessionParam,
    ...(body ? ["-d", shellEscape(JSON.stringify(body))] : []),
  ].join(" ");
}

/**
 * 2.x: read the session back with `session.get`. The command succeeds only when
 * session.get exits 0 and the stored model and agent equal the request. The checker
 * gets the exit status, because a pipeline into it would hide a failed session.get.
 */
function buildApiSettingsReadback(
  sessionParam: string,
  modelRef: OpenCodeModelRef | undefined,
  agent: string | undefined,
): string {
  const expected = { ...(modelRef ? { model: modelRef } : {}), ...(agent ? { agent } : {}) };
  return `{ OC_GET=$(${buildApiSessionCall("session.get", sessionParam)}); OC_GET_STATUS=$?; printf '%s\\n' "$OC_GET" | node -e ${shellEscape(buildApiSettingsCheckScript())} "$OC_GET_STATUS" ${shellEscape(JSON.stringify(expected))}; }`;
}

/**
 * 2.x: store the model and agent on an existing session through the API, then read
 * them back. The command succeeds only when the stored values equal the request.
 */
function buildApiSettingsCommand(
  sessionParam: string,
  modelRef: OpenCodeModelRef | undefined,
  agent: string | undefined,
): string {
  return [
    ...(modelRef
      ? [buildApiSessionCall("session.switchModel", sessionParam, { model: modelRef })]
      : []),
    ...(agent ? [buildApiSessionCall("session.switchAgent", sessionParam, { agent })] : []),
    buildApiSettingsReadback(sessionParam, modelRef, agent),
  ].join(" && ");
}

/** 2.x: store the model and agent on the session through the API, then open the TUI on it. */
function buildApiResumeCommand(
  sessionId: string,
  promptOptions: string[],
  model?: string,
  agent?: string,
): string {
  const modelRef = model ? toOpenCodeModelRef(model) : undefined;
  if (model && !modelRef) return invalidModelCommand(model);

  const settings = buildApiSettingsCommand(shellEscape(`sessionID=${sessionId}`), modelRef, agent);
  const tuiCommand = ["opencode", "--session", shellEscape(sessionId), ...promptOptions].join(" ");
  return `if ${settings}; then ${tuiCommand}; else ${settingsFailureCommand(shellEscape(sessionId))}; fi`;
}

/**
 * Open the TUI on an existing OpenCode session with an optional prompt, model and agent.
 * The model and agent are stored on the session through `opencode api` before the TUI
 * opens; the TUI never takes model or agent flags (2.x rejects them).
 */
function buildResumeCommand(
  sessionId: string,
  options: { promptValue?: string; model?: string; agent?: string },
): string {
  const promptOptions = options.promptValue ? ["--prompt", options.promptValue] : [];
  // Without a model or agent, the command opens the session as stored.
  if (!options.model && !options.agent) {
    return ["opencode", "--session", shellEscape(sessionId), ...promptOptions].join(" ");
  }

  return buildApiResumeCommand(sessionId, promptOptions, options.model, options.agent);
}

// =============================================================================
// Session Preparation and Launch Check (I-3)
// =============================================================================

/** The pane must hold the matching process this long before the launch counts. */
const LAUNCH_SETTLE_MS = 1_000;

/** Pause between two pane process checks. */
const PANE_POLL_MS = 250;

/** Pause between two reads of the session's `user` messages. */
const PROMPT_POLL_MS = 500;

/**
 * What the launch prompt check compares with (M-2). A session that this spawn
 * created starts with no `user` message, so any one counts (`none`). A reused
 * session can hold older ones: only a message newer than the newest one
 * before the pane started counts (`mark`). When that read failed, no message
 * can prove the delivery (`unknown`).
 */
type PromptBaseline =
  | { kind: "none" }
  | { kind: "mark"; mark: OpenCodeUserMessageMark }
  | { kind: "unknown"; reason: string };

/** The state of a prepared session that `confirmLaunch` and `discard` need. */
interface PreparedState {
  /** The map that core passes to `runtime.create`. */
  env: Record<string, string>;
  promptBaseline: PromptBaseline;
}

const preparedStates = new WeakMap<PreparedAgentSession, PreparedState>();

/** The error text on one line, for an operator line. */
function oneLine(err: unknown): string {
  const text = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim();
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** The prompt shell word of the launch command, or undefined when there is no prompt. */
function buildPromptValue(config: AgentLaunchConfig): string | undefined {
  if (config.prompt) {
    if (config.systemPromptFile) {
      return `"$(cat ${shellEscape(config.systemPromptFile)}; printf '\\n\\n'; printf %s ${shellEscape(config.prompt)})"`;
    }
    if (config.systemPrompt) {
      return shellEscape(`${config.systemPrompt}\n\n${config.prompt}`);
    }
    return shellEscape(config.prompt);
  }
  if (config.systemPromptFile) {
    return `"$(cat ${shellEscape(config.systemPromptFile)})"`;
  }
  if (config.systemPrompt) {
    return shellEscape(config.systemPrompt);
  }
  return undefined;
}

/**
 * Compare the stored session with the requested model and agent. Returns null
 * when they match, else the stored values. 2.x stores a model without a
 * variant as variant `default`.
 */
function storedSettingsMismatch(
  stored: OpenCodeApiSession,
  modelRef: OpenCodeModelRef | undefined,
  agent: string | undefined,
): string | null {
  const variant = (model: { variant?: string }) => model.variant || "default";
  const modelOk =
    !modelRef ||
    (!!stored.model &&
      stored.model.providerID === modelRef.providerID &&
      stored.model.id === modelRef.id &&
      variant(stored.model) === variant(modelRef));
  const agentOk = !agent || stored.agent === agent;
  if (modelOk && agentOk) return null;
  return `OpenCode stored agent ${JSON.stringify(stored.agent)} and model ${JSON.stringify(stored.model)}`;
}

/** Read the session back and throw when the stored model or agent differs from the request. */
async function assertStoredSettings(
  sessionId: string,
  modelRef: OpenCodeModelRef | undefined,
  agent: string | undefined,
  env: Record<string, string>,
): Promise<void> {
  const stored = await getOpenCodeSession(sessionId, undefined, env);
  if (!stored) {
    throw new Error(
      `failed to set the OpenCode model or agent for ${sessionId}: session.get answered 404`,
    );
  }
  const mismatch = storedSettingsMismatch(stored, modelRef, agent);
  if (mismatch) {
    throw new Error(`failed to set the OpenCode model or agent for ${sessionId}: ${mismatch}`);
  }
}

/** The model check before any create or switch (0010 sections 5.3 and 11.4). */
async function assertOpenCodeModelAvailable(
  model: string,
  modelRef: OpenCodeModelRef,
  env: Record<string, string>,
): Promise<void> {
  const models = await listOpenCodeModels({ env });
  const problem = findOpenCodeModelProblem(models, modelRef);
  if (problem) {
    throw new Error(`OpenCode cannot run the model ${model}: ${problem}`);
  }
}

/**
 * The prepared session. `discard` removes the session only when this spawn
 * created it: it interrupts a turn that the pane may have started, then
 * removes the session. It never throws; a failure gets one operator line.
 */
function preparedOpenCodeSession(
  sessionId: string,
  created: boolean,
  env: Record<string, string>,
  promptBaseline: PromptBaseline,
): PreparedAgentSession {
  let discarded = false;
  const prepared: PreparedAgentSession = {
    metadata: { opencodeSessionId: sessionId },
    agentConfig: { opencodeSessionId: sessionId },
    created,
    async discard() {
      if (!created || discarded) return;
      discarded = true;
      try {
        await interruptOpenCodeSession(sessionId, OPENCODE_API_TIMEOUT_MS, env);
      } catch {
        // Best effort: the remove runs even when the interrupt fails.
      }
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await removeOpenCodeSession(sessionId, OPENCODE_API_TIMEOUT_MS, env);
          return;
        } catch (err) {
          lastError = err;
          if (err instanceof OpenCodeApiTimeoutError) break;
        }
      }
      process.stderr.write(
        `ao: could not remove the OpenCode session ${sessionId} that this spawn created (${oneLine(lastError)}); remove it with \`opencode api session.remove --param sessionID=${sessionId}\`.\n`,
      );
    },
  };
  preparedStates.set(prepared, { env, promptBaseline });
  return prepared;
}

/**
 * M-2: the newest `user` message of a reused session, read before the pane
 * starts. A failed read gives `unknown`: the spawn goes on, and the launch
 * prompt check then reports `promptDelivered: false`.
 */
async function readPromptBaseline(
  sessionId: string,
  env: Record<string, string>,
): Promise<PromptBaseline> {
  try {
    const mark = await getNewestOpenCodeUserMessage(sessionId, { env });
    return mark ? { kind: "mark", mark } : { kind: "none" };
  } catch (err) {
    return { kind: "unknown", reason: oneLine(err) };
  }
}

/** The file names of the OpenCode executable (the npm package installs `.opencode`). */
const OPENCODE_EXECUTABLE_NAMES = new Set(["opencode", ".opencode"]);

/** Interpreters that can run the OpenCode script as their main script. */
const SCRIPT_INTERPRETER_NAMES = new Set(["node", "bun"]);

/**
 * M-1: true when the argument vector of a process (from `/proc/<pid>/cmdline`,
 * so the argument boundaries are exact) runs OpenCode on `sessionId`.
 * argv[0] must have the file name `opencode` or `.opencode` (any directory),
 * or be `node` or `bun` whose main script, argv[1], has such a file name.
 * Then `--session <id>` or `--session=<id>` must be one of the options of
 * that OpenCode process (before a `--`). A shell whose `-c` text names
 * OpenCode is argv[0] `bash` with one text argument, so it does not count.
 *
 * M-3: an interpreter option before the script makes the main script
 * unknown: `--require <file>`, `--import <file>` and `--loader <file>` take
 * a file that is not the main script, and `-e <code>` runs no script. So an
 * interpreter counts only when argv[1] is the OpenCode script itself.
 */
function argvOpensSession(argv: readonly string[], sessionId: string): boolean {
  const program = argv[0];
  if (!program) return false;
  let optionsStart: number;
  if (OPENCODE_EXECUTABLE_NAMES.has(basename(program))) {
    optionsStart = 1;
  } else if (SCRIPT_INTERPRETER_NAMES.has(basename(program))) {
    const script = argv[1] ?? "";
    if (script.startsWith("-") || !OPENCODE_EXECUTABLE_NAMES.has(basename(script))) return false;
    optionsStart = 2;
  } else {
    return false;
  }
  for (let i = optionsStart; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") return false;
    if (arg === `--session=${sessionId}`) return true;
    if (arg === "--session" && argv[i + 1] === sessionId) return true;
  }
  return false;
}

/**
 * The argument vector of process `pid` from `/proc/<pid>/cmdline` (NUL
 * separated), or null when it cannot be read: the process is gone, it is a
 * zombie (empty file), or the host has no `/proc`. Such a process does not
 * count as OpenCode, so the launch check never passes on a guess.
 */
async function readProcessArgv(pid: number): Promise<string[] | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let raw: string;
  try {
    raw = await readFile(`/proc/${pid}/cmdline`, "utf-8");
  } catch {
    return null;
  }
  if (raw.length === 0) return null;
  const argv = raw.split("\0");
  if (argv[argv.length - 1] === "") argv.pop();
  return argv.length > 0 ? argv : null;
}

/** The first PID in `pids` whose process runs OpenCode on `sessionId`, or null. */
async function findOpenCodeProcess(
  pids: readonly number[],
  sessionId: string,
): Promise<number | null> {
  for (const pid of pids) {
    const argv = await readProcessArgv(pid);
    if (argv && argvOpensSession(argv, sessionId)) return pid;
  }
  return null;
}

/** The pane is gone: tmux answered that its session, window or server does not exist. */
class PaneGoneError extends Error {}

/**
 * The PID of the pane process that runs OpenCode on `sessionId`, or null.
 * The runtime gives the PIDs of the pane (herdr: its foreground processes;
 * tmux: the processes on the pane TTY), and `/proc` gives their exact
 * argument vectors (M-1). Throws `PaneGoneError` when tmux says that the
 * pane is gone; any other failure counts as "not yet".
 */
async function findPaneOpenCodeProcess(
  handle: RuntimeHandle,
  sessionId: string,
): Promise<number | null> {
  if (handle.runtimeName === HERDR_RUNTIME_NAME && handle.id) {
    const processes = await getHerdrPaneProcesses(handle.id);
    return findOpenCodeProcess(
      processes.map((proc) => proc.pid),
      sessionId,
    );
  }
  if (handle.runtimeName === "tmux" && handle.id) {
    let ttyOut: string;
    try {
      ({ stdout: ttyOut } = await execFileAsync(
        "tmux",
        ["list-panes", "-t", handle.id, "-F", "#{pane_tty}"],
        { timeout: 5_000 },
      ));
    } catch (err) {
      const stderr = String((err as { stderr?: unknown }).stderr ?? "");
      if (
        /can't find (?:session|window|pane)|no server running|error connecting to/i.test(stderr)
      ) {
        throw new PaneGoneError(stderr.trim(), { cause: err });
      }
      return null;
    }
    const ttys = new Set(
      ttyOut
        .split("\n")
        .map((tty) => tty.trim().replace(/^\/dev\//, ""))
        .filter(Boolean),
    );
    if (ttys.size === 0) return null;
    const { stdout: psOut } = await execFileAsync("ps", ["-eo", "pid=,tty="], {
      timeout: 5_000,
    });
    const panePids: number[] = [];
    for (const line of psOut.split("\n")) {
      const cols = line.trim().split(/\s+/);
      if (cols.length !== 2 || !ttys.has(cols[1] ?? "")) continue;
      const pid = Number(cols[0]);
      if (Number.isSafeInteger(pid)) panePids.push(pid);
    }
    return findOpenCodeProcess(panePids, sessionId);
  }
  throw new Error(
    `cannot check the OpenCode launch on runtime ${handle.runtimeName}: only tmux and herdr panes can be checked`,
  );
}

/**
 * Wait until the pane runs OpenCode on `sessionId` (0009 section 11 step 2).
 * The same process must still run `settleMs` after it was first seen, so a
 * process that exits at once (a failed TUI start) does not count. Throws when
 * the pane is gone, or when the bound ends first.
 */
async function waitForPaneOnSession(
  session: Session,
  sessionId: string,
  timeoutMs: number,
): Promise<void> {
  const handle = session.runtimeHandle;
  if (!handle) {
    throw new Error(`cannot check the OpenCode launch of ${session.id}: no runtime handle`);
  }
  const settleMs = Math.min(LAUNCH_SETTLE_MS, Math.floor(timeoutMs / 4));
  const deadline = Date.now() + timeoutMs;
  let candidate: { pid: number; since: number } | undefined;
  for (;;) {
    let pid: number | null;
    try {
      pid = await findPaneOpenCodeProcess(handle, sessionId);
    } catch (err) {
      if (err instanceof PaneGoneError) {
        throw new Error(
          `the pane of ${session.id} is gone; OpenCode did not stay open on session ${sessionId} (${oneLine(err)})`,
          { cause: err },
        );
      }
      throw err;
    }
    const now = Date.now();
    if (pid === null) {
      candidate = undefined;
    } else if (candidate?.pid !== pid) {
      candidate = { pid, since: now };
    } else if (now - candidate.since >= settleMs) {
      return;
    }
    if (now >= deadline) {
      throw new Error(
        `the pane of ${session.id} did not run OpenCode on session ${sessionId} within ${timeoutMs / 1000} s`,
      );
    }
    await sleep(Math.min(PANE_POLL_MS, Math.max(1, deadline - now)));
  }
}

/**
 * Wait for a `user` message of the session that the baseline does not
 * already hold: the TUI submitted the launch prompt (as-63: 1.5 s after the
 * TUI started). A failed read counts as "not seen yet". Returns false when
 * the bound ends first, and at once when the baseline is unknown (M-2).
 */
async function waitForUserMessage(
  sessionId: string,
  timeoutMs: number,
  state: PreparedState | undefined,
): Promise<boolean> {
  const baseline = state?.promptBaseline ?? { kind: "none" };
  if (baseline.kind === "unknown") return false;
  const env = state?.env;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remainingMs = deadline - Date.now();
    try {
      if (
        await hasOpenCodeUserMessage(sessionId, {
          ...(env ? { env } : {}),
          ...(baseline.kind === "mark" ? { after: baseline.mark } : {}),
          timeoutMs: Math.max(1, Math.min(OPENCODE_API_TIMEOUT_MS, remainingMs)),
        })
      ) {
        return true;
      }
    } catch {
      // Not seen yet; the next read tries again within the bound.
    }
    const leftMs = deadline - Date.now();
    if (leftMs <= 0) return false;
    await sleep(Math.min(PROMPT_POLL_MS, leftMs));
  }
}

// =============================================================================
// Plugin Manifest
// =============================================================================

export const manifest = {
  name: "opencode",
  slot: "agent" as const,
  description: "Agent plugin: OpenCode",
  version: "0.1.0",
  displayName: "OpenCode",
};

// =============================================================================
// Agent Implementation
// =============================================================================

function createOpenCodeAgent(): Agent {
  return {
    name: "opencode",
    processName: "opencode",

    /**
     * I-3: the session exists before the pane starts (`prepareAgentSession`
     * created or switched it, and core passes its ID in `agentConfig`). The
     * pane only opens the TUI on it: no `opencode api` call runs in the pane.
     * Without an ID this throws, because there is no pane-side create.
     */
    getLaunchCommand(config: AgentLaunchConfig): string {
      const sessionId = asValidOpenCodeSessionId(
        (config.projectConfig.agentConfig as OpenCodeAgentConfig | undefined)?.opencodeSessionId,
      );
      if (!sessionId) {
        throw new Error(
          `no OpenCode session ID for ${config.sessionId}: prepareAgentSession must create the session before the launch command`,
        );
      }
      const promptValue = buildPromptValue(config);
      return [
        "exec",
        "opencode",
        "--session",
        shellEscape(sessionId),
        ...(promptValue ? ["--prompt", promptValue] : []),
      ].join(" ");
    },

    /**
     * I-3 (0009 section 11): make the OpenCode session ready in Node before
     * the pane starts, in this order: the version gate, the model check, then
     * `session.create` (or, for a reused ID, `session.switchModel` and
     * `session.switchAgent`), then the `session.get` readback. Every
     * `opencode api` call runs with the pane's environment. A throw fails the
     * spawn; a session that this call created is removed before the throw.
     */
    async prepareAgentSession(
      config: AgentLaunchConfig,
      context: AgentSessionPrepareContext,
    ): Promise<PreparedAgentSession> {
      // m-1: the version probe keeps the PATH of the `ao` process, not the
      // pane's: it is the same gate as `detect()` and restore use, and the
      // pane PATH only puts `~/.ao/bin` (the gh and git wrappers) first.
      // Every `opencode api` call below runs with the pane environment.
      assertSupportedOpenCodeVersion();
      const env = context.environment;
      const modelRef = config.model ? toOpenCodeModelRef(config.model) : undefined;
      if (config.model && !modelRef) throw new Error(invalidModelMessage(config.model));
      const agent = config.subagent;

      if (config.model && modelRef) {
        await assertOpenCodeModelAvailable(config.model, modelRef, env);
      }

      // Row 4 in Node: a reused session gets the requested settings, and it
      // is never removed (`created: false`).
      const reusedId = asValidOpenCodeSessionId(
        (config.projectConfig.agentConfig as OpenCodeAgentConfig | undefined)?.opencodeSessionId,
      );
      if (reusedId) {
        if (modelRef) await switchOpenCodeSessionModel(reusedId, modelRef, { env });
        if (agent) await switchOpenCodeSessionAgent(reusedId, agent, { env });
        if (modelRef || agent) await assertStoredSettings(reusedId, modelRef, agent, env);
        // M-2: the session already holds the prompts of earlier spawns.
        const promptBaseline = await readPromptBaseline(reusedId, env);
        return preparedOpenCodeSession(reusedId, false, env, promptBaseline);
      }

      let directory: string;
      try {
        directory = realpathSync(context.workspacePath);
      } catch (err) {
        throw new Error(`cannot resolve the OpenCode workspace ${context.workspacePath}`, {
          cause: err,
        });
      }
      const created = await createOpenCodeSession(
        {
          title: `AO:${config.sessionId}`,
          ...(modelRef ? { model: modelRef } : {}),
          ...(agent ? { agent } : {}),
          location: { directory },
        },
        { env },
      );
      const prepared = preparedOpenCodeSession(created.id, true, env, { kind: "none" });
      if (modelRef || agent) {
        // The service can store other settings than the request.
        try {
          await assertStoredSettings(created.id, modelRef, agent, env);
        } catch (err) {
          await prepared.discard();
          throw err;
        }
      }
      return prepared;
    },

    /**
     * I-3 (0009 section 11 steps 2 and 3): the pane must run an `opencode`
     * process on the prepared session ID within `timeoutMs`; else this throws
     * and core fails the spawn. With a prompt, it then waits for a `user`
     * message of the session (for a reused session, one newer than the
     * newest one before the pane started): seen gives `promptDelivered:
     * true`, not seen within `promptTimeoutMs` gives `false` (the spawn
     * still succeeds).
     */
    async confirmLaunch(
      session: Session,
      prepared: PreparedAgentSession,
      options: AgentLaunchConfirmOptions,
    ): Promise<AgentLaunchConfirmation> {
      const sessionId = asValidOpenCodeSessionId(prepared.metadata["opencodeSessionId"]);
      if (!sessionId) {
        throw new Error(
          `cannot check the OpenCode launch of ${session.id}: no prepared session ID`,
        );
      }
      await waitForPaneOnSession(session, sessionId, options.timeoutMs);
      if (!options.promptExpected) return {};
      const delivered = await waitForUserMessage(
        sessionId,
        options.promptTimeoutMs,
        preparedStates.get(prepared),
      );
      return { promptDelivered: delivered };
    },

    getEnvironment(config: AgentLaunchConfig): Record<string, string> {
      const env: Record<string, string> = {};
      env["AO_SESSION_ID"] = config.sessionId;
      // NOTE: AO_PROJECT_ID is the caller's responsibility (spawn.ts sets it)
      if (config.issueId) {
        env["AO_ISSUE_ID"] = config.issueId;
      }

      // Prepend ~/.ao/bin to PATH so our gh/git wrappers intercept commands.
      env["PATH"] = buildAgentPath(process.env["PATH"]);
      env["GH_PATH"] = PREFERRED_GH_PATH;

      return env;
    },

    detectActivity(terminalOutput: string): ActivityState {
      return classifyOpenCodePaneActivity(terminalOutput);
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

      // 1. Process check first, unchanged: no runtime handle or not running → exited.
      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (!running) return { state: "exited", timestamp: exitedAt };

      // 2. No stored valid opencodeSessionId → make no API call; go to step 7.
      const storedId = asValidOpenCodeSessionId(session.metadata?.opencodeSessionId);
      if (storedId) {
        try {
          const apiState = await getApiActivityState(storedId, activeWindowMs, threshold);
          if (apiState) return apiState;
        } catch {
          // No API signal; fall through to the JSONL fallback below.
        }
      }

      // 7. Fallback, required: the AO JSONL is read only here, so a JSONL
      // waiting_input never overrides an API answer with empty lists. It
      // surfaces a fresh waiting_input or blocked when the API is unavailable.
      let activityResult: Awaited<ReturnType<typeof readLastActivityEntry>> = null;
      if (session.workspacePath) {
        activityResult = await readLastActivityEntry(session.workspacePath);
      }
      const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
      if (fallback) return fallback;

      // 8. Null only when there is no data at all.
      return null;
    },

    async recordActivity(session: Session, terminalOutput: string): Promise<void> {
      if (!session.workspacePath) return;
      await recordTerminalActivity(session.workspacePath, terminalOutput, (output) =>
        this.detectActivity(output),
      );
    },

    async isProcessRunning(handle: RuntimeHandle): Promise<boolean> {
      try {
        // herdr owns the PTY and reports a pane's foreground processes directly,
        // so neither the tmux TTY scan nor the process-runtime PID applies.
        if (handle.runtimeName === HERDR_RUNTIME_NAME && handle.id) {
          return await isHerdrProcessRunning(handle.id, /(?:^|\/)opencode(?:\s|$)/);
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
          const processRe = /(?:^|\/)opencode(?:\s|$)/;
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

    async getSessionInfo(session: Session): Promise<AgentSessionInfo | null> {
      const storedId = asValidOpenCodeSessionId(session.metadata?.opencodeSessionId);
      if (!storedId) return null;
      try {
        return await getApiSessionInfo(storedId);
      } catch {
        return null;
      }
    },

    async getRestoreCommand(
      session: Session,
      project: ProjectConfig,
      effectiveModel?: string,
    ): Promise<string> {
      // Rows 5 and 6: resume the stored ID only; no title search on restore
      // (owner Q7). Core calls this before it changes anything (archive,
      // workspace, old runtime), so each refusal below keeps the old pane.
      //
      // 1. The version gate runs first, so a refused binary names the version
      //    problem even when no ID is stored (A4, M-1).
      assertSupportedOpenCodeVersion();
      const storedId = asValidOpenCodeSessionId(session.metadata?.opencodeSessionId);
      if (!storedId) {
        throw new SessionNotRestorableError(
          session.id,
          `no stored OpenCode session ID for ${session.id}; run \`ao session remap ${session.id}\` to find it by its exact title in its workspace`,
        );
      }
      // 2. The stored session must still exist. A 404 refuses (m-1): a fresh
      //    launch or a resume of the gone ID would open a TUI on the wrong
      //    conversation. A timeout or another error throws from the helper,
      //    so a hanging binary fails within its bound.
      const existing = await getOpenCodeSession(storedId);
      if (!existing) {
        throw new SessionNotRestorableError(
          session.id,
          `the stored OpenCode session ${storedId} is gone (session.get answered 404)`,
        );
      }

      const agentConfig = project.agentConfig as OpenCodeAgentConfig | undefined;
      // C-04: prefer the persisted spawn --model override (effectiveModel)
      // over the live config. Only the model flag changes here. Restore has
      // no I-3 prepare or launch check: the resume command sets the stored
      // session's model in the pane, then opens the TUI on that session.
      return buildResumeCommand(storedId, {
        model: effectiveModel ?? (agentConfig?.model as string | undefined),
      });
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
  return createOpenCodeAgent();
}

export function detect(): boolean {
  return checkOpenCodeVersion().supported;
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;