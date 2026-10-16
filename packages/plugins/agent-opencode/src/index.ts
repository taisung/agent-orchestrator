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
  HERDR_RUNTIME_NAME,
  isHerdrProcessRunning,
  SessionNotRestorableError,
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
  type OpenCodeAgentConfig,
} from "@aoagents/ao-core";
import {
  classifyOpenCodePaneActivity,
  getApiActivityState,
  getApiSessionInfo,
} from "./api-activity.js";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Read the session ID from the single JSON document that
 * `opencode api session.create` prints (`{"data":{"id":"ses_..."}}`).
 * On anything else, echo the response to stderr so the pane shows the API error.
 */
function buildApiSessionIdCaptureScript(): string {
  const script = `
let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  let sid;
  try { sid = JSON.parse(input).data.id; } catch {}
  if (typeof sid === 'string' && /^ses_[A-Za-z0-9_-]+$/.test(sid)) {
    process.stdout.write(sid);
    process.exit(0);
  }
  process.stderr.write(input);
  process.exit(1);
});
  `.trim();
  return script.replace(/\n/g, " ").replace(/\s+/g, " ");
}

/**
 * Add the pane's working directory to a `session.create` body. The 2.x background
 * service otherwise files the session under its own directory, where
 * `opencode session list` run from the worktree cannot see it.
 */
function buildApiSessionBodyScript(): string {
  const script = `
const body = JSON.parse(process.argv[1]);
body.location = { directory: process.cwd() };
process.stdout.write(JSON.stringify(body));
  `.trim();
  return script.replace(/\n/g, " ").replace(/\s+/g, " ");
}

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

interface OpenCodeModelRef {
  providerID: string;
  id: string;
  variant?: string;
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
  const message = `OpenCode ${OPENCODE_MIN_VERSION.major}.x needs the model as provider/model[#variant], got: ${model}`;
  return `echo ${shellEscape(message)} >&2; exit 1`;
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

    getLaunchCommand(config: AgentLaunchConfig): string {
      assertSupportedOpenCodeVersion();
      const existingSessionId = asValidOpenCodeSessionId(
        (config.projectConfig.agentConfig as OpenCodeAgentConfig | undefined)?.opencodeSessionId,
      );

      let promptValue: string | undefined;
      if (config.prompt) {
        if (config.systemPromptFile) {
          promptValue = `"$(cat ${shellEscape(config.systemPromptFile)}; printf '\\n\\n'; printf %s ${shellEscape(config.prompt)})"`;
        } else if (config.systemPrompt) {
          promptValue = shellEscape(`${config.systemPrompt}\n\n${config.prompt}`);
        } else {
          promptValue = shellEscape(config.prompt);
        }
      } else if (config.systemPromptFile) {
        promptValue = `"$(cat ${shellEscape(config.systemPromptFile)})"`;
      } else if (config.systemPrompt) {
        promptValue = shellEscape(config.systemPrompt);
      }

      if (existingSessionId) {
        return buildResumeCommand(existingSessionId, {
          promptValue,
          model: config.model,
          agent: config.subagent,
        });
      }

      const title = `AO:${config.sessionId}`;
      const promptOptions = promptValue ? ["--prompt", promptValue] : [];
      const tuiCommand = ["exec", "opencode", "--session", '"$SES_ID"', ...promptOptions].join(" ");
      const missingSessionError = shellEscape(
        `failed to discover OpenCode session ID for AO:${config.sessionId}`,
      );
      const openTuiOrFail = (command: string) =>
        `[ -n "$SES_ID" ] && ${command}; echo ${missingSessionError} >&2; exit 1`;

      // The API makes the titled session with its model and agent, without a model turn.
      const modelRef = config.model ? toOpenCodeModelRef(config.model) : undefined;
      const createBody = JSON.stringify({
        title,
        ...(modelRef ? { model: modelRef } : {}),
        ...(config.subagent ? { agent: config.subagent } : {}),
      });
      // The TUI opens only on the ID that this create returned. There is no title
      // lookup: a session with the title can be an older one from an earlier AO session
      // with the same ID, and its conversation belongs to another task. Thus a failed
      // create, or a create without a usable ID in its output, stops the command.
      const apiCreate = `if OC_CREATE=$(opencode api session.create -d "$(node -e ${shellEscape(buildApiSessionBodyScript())} ${shellEscape(createBody)})"); then SES_ID=$(printf '%s\\n' "$OC_CREATE" | node -e ${shellEscape(buildApiSessionIdCaptureScript())}) || { echo ${missingSessionError} >&2; exit 1; }; else [ -z "$OC_CREATE" ] || printf '%s\\n' "$OC_CREATE" >&2; echo ${shellEscape(`failed to create the OpenCode session ${title}`)} >&2; exit 1; fi`;
      // The service can store other settings than the request, so the command reads the
      // new session back and checks only the requested model and agent.
      const settingsCheck =
        modelRef || config.subagent
          ? [
              `${buildApiSettingsReadback('"sessionID=$SES_ID"', modelRef, config.subagent)} || { ${settingsFailureCommand('"$SES_ID"')}; }`,
            ]
          : [];
      const apiCommand =
        config.model && !modelRef
          ? invalidModelCommand(config.model)
          : [apiCreate, ...settingsCheck, openTuiOrFail(tuiCommand)].join("; ");

      return apiCommand;
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
      // over the live config. Only the model flag changes here; the launch
      // lock, marker, discovery wait and holder guard (I-2) are untouched.
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