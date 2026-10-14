import {
  DEFAULT_READY_THRESHOLD_MS,
  DEFAULT_ACTIVE_WINDOW_MS,
  shellEscape,
  buildAgentPath,
  readLastActivityEntry,
  checkActivityLogState,
  getActivityFallbackState,
  recordTerminalActivity,
  setupPathWrapperWorkspace,
  PREFERRED_GH_PATH,
  asValidOpenCodeSessionId,
  HERDR_RUNTIME_NAME,
  isHerdrProcessRunning,
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
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface OpenCodeSessionListEntry {
  id: string;
  title?: string;
  updated?: string | number;
}

function parseUpdatedTimestamp(updated: string | number | undefined): Date | null {
  if (typeof updated === "number") {
    if (!Number.isFinite(updated)) return null;
    const date = new Date(updated);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof updated !== "string") return null;

  const trimmed = updated.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+$/.test(trimmed)) {
    const epochMs = Number(trimmed);
    if (!Number.isFinite(epochMs)) return null;
    const date = new Date(epochMs);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) return null;
  return new Date(parsedMs);
}

function parseSessionList(raw: string): OpenCodeSessionListEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is OpenCodeSessionListEntry => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return asValidOpenCodeSessionId(record["id"]) !== undefined;
  });
}

/**
 * Parse JSON stream lines from `opencode run --format json` output.
 * Each line is a JSON object. We look for objects containing a session_id field.
 * The step_start event typically contains the session_id.
 */
function buildSessionIdCaptureScript(): string {
  const script = `
let buffer = '';
let captured = null;
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (captured) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      const sid = (typeof obj.session_id === 'string' && obj.session_id) || (typeof obj.sessionID === 'string' && obj.sessionID);
      if (sid && /^ses_[A-Za-z0-9_-]+$/.test(sid)) {
        captured = sid;
      }
    } catch {}
  }
}).on('end', () => {
  if (buffer.trim()) {
    try {
      const obj = JSON.parse(buffer.trim());
      const sid = (typeof obj.session_id === 'string' && obj.session_id) || (typeof obj.sessionID === 'string' && obj.sessionID);
      if (sid && /^ses_[A-Za-z0-9_-]+$/.test(sid)) {
        captured = sid;
      }
    } catch {}
  }
  if (captured) {
    process.stdout.write(captured);
    process.exit(0);
  }
  process.exit(1);
});
  `.trim();
  return script.replace(/\n/g, " ").replace(/\s+/g, " ");
}

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
 * model and agent (argv[1]). Exit 1 and show the stored values when they differ.
 * 2.x stores a model without a variant as variant `default`.
 */
function buildApiSettingsCheckScript(): string {
  const script = `
let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  const want = JSON.parse(process.argv[1]);
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

function buildSessionLookupScript(): string {
  const script = `
let input = '';
process.stdin.on('data', c => input += c).on('end', () => {
  const title = process.argv[1];
  let rows;
  try { rows = JSON.parse(input); } catch { process.exit(1); }
  if (!Array.isArray(rows)) process.exit(1);
  const isValidId = id => /^ses_[A-Za-z0-9_-]+$/.test(id);
  const timestamp = value => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
    }
    return Number.NEGATIVE_INFINITY;
  };
  const matches = rows
    .filter(r => r && r.title === title && typeof r.id === 'string' && isValidId(r.id))
    .sort((a, b) => {
      const ta = timestamp(a.updated);
      const tb = timestamp(b.updated);
      if (ta === tb) return 0;
      return tb - ta;
    });
  if (matches.length === 0) process.exit(1);
  process.stdout.write(matches[0].id);
});
  `.trim();
  return script.replace(/\n/g, " ").replace(/\s+/g, " ");
}

// =============================================================================
// OpenCode CLI Generations
// =============================================================================

/**
 * First OpenCode major version whose CLI stores the model and agent on the session
 * through `opencode api`. 2.x removed `opencode run --command` (the 1.x way to make
 * a titled session without a model turn) and the TUI's `--model`/`--agent` flags.
 * Launch and restore commands read `opencode --version` in the pane and branch on
 * this value, so they follow whichever binary the pane's PATH resolves.
 */
const OPENCODE_API_MAJOR = 2;

/** `opencode --version` prints `1.18.35` on 1.x and `opencode v2.0.29` on 2.x. */
const OPENCODE_MAJOR_PROBE =
  "OC_MAJOR=$(opencode --version 2>/dev/null | sed -n 's/^[^0-9]*\\([0-9][0-9]*\\)\\..*$/\\1/p' | head -n 1)";

/** Unknown or unparsable versions take the 1.x branch, which was the only behavior before 2.x. */
function branchOnOpenCodeMajor(apiCommand: string, legacyCommand: string): string {
  return `if [ "\${OC_MAJOR:-0}" -ge ${OPENCODE_API_MAJOR} ]; then ${apiCommand}; else ${legacyCommand}; fi`;
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
  const message = `OpenCode ${OPENCODE_API_MAJOR}.x needs the model as provider/model[#variant], got: ${model}`;
  return `echo ${shellEscape(message)} >&2; exit 1`;
}

/** `sessionWord` is the shell word that expands to the session ID. */
function settingsFailureCommand(sessionWord: string): string {
  return `echo ${shellEscape("failed to set the OpenCode model or agent for")} ${sessionWord} >&2; exit 1`;
}

/** The 1.x TUI and `opencode run` flags for the agent and model. */
function buildLegacySessionOptions(model?: string, agent?: string): string[] {
  return [
    ...(agent ? ["--agent", shellEscape(agent)] : []),
    ...(model ? ["--model", shellEscape(model)] : []),
  ];
}

/**
 * 2.x: store the model and agent on an existing session through the API, then read
 * them back. The command succeeds only when the stored values equal the request.
 * `sessionParam` is the shell word for `--param`, for example `'sessionID=ses_...'`.
 */
function buildApiSettingsCommand(
  sessionParam: string,
  modelRef: OpenCodeModelRef | undefined,
  agent: string | undefined,
): string {
  const apiCall = (operation: string, body?: Record<string, unknown>) =>
    [
      "opencode",
      "api",
      operation,
      "--param",
      sessionParam,
      ...(body ? ["-d", shellEscape(JSON.stringify(body))] : []),
    ].join(" ");
  const expected = { ...(modelRef ? { model: modelRef } : {}), ...(agent ? { agent } : {}) };
  return [
    ...(modelRef ? [apiCall("session.switchModel", { model: modelRef })] : []),
    ...(agent ? [apiCall("session.switchAgent", { agent })] : []),
    `${apiCall("session.get")} | node -e ${shellEscape(buildApiSettingsCheckScript())} ${shellEscape(JSON.stringify(expected))}`,
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
 * 1.x takes the model and agent as TUI flags. 2.x rejects those flags, so the command
 * stores them on the session through `opencode api` before it opens the TUI.
 */
function buildResumeCommand(
  sessionId: string,
  options: { promptValue?: string; model?: string; agent?: string },
): string {
  const promptOptions = options.promptValue ? ["--prompt", options.promptValue] : [];
  const legacyOptions = buildLegacySessionOptions(options.model, options.agent);
  const legacyCommand = [
    "opencode",
    "--session",
    shellEscape(sessionId),
    ...promptOptions,
    ...legacyOptions,
  ].join(" ");
  // Without a model or agent, both generations accept the same command.
  if (legacyOptions.length === 0) return legacyCommand;

  const apiCommand = buildApiResumeCommand(sessionId, promptOptions, options.model, options.agent);
  return `${OPENCODE_MAJOR_PROBE}; ${branchOnOpenCodeMajor(apiCommand, legacyCommand)}`;
}

// =============================================================================
// Session List Helpers
// =============================================================================

/**
 * Query OpenCode's session list and find the matching session for this AO session.
 * Tries metadata `opencodeSessionId` first, then falls back to title matching.
 */
async function findOpenCodeSession(
  session: Session,
): Promise<OpenCodeSessionListEntry | null> {
  try {
    const { stdout } = await execFileAsync(
      "opencode",
      ["session", "list", "--format", "json"],
      { timeout: 30_000 },
    );

    const sessions = parseSessionList(stdout);

    // Prefer exact ID match from metadata
    if (session.metadata?.opencodeSessionId) {
      const match = sessions.find((s) => s.id === session.metadata.opencodeSessionId);
      if (match) return match;
    }

    // Fallback: title match — pick the most recently updated session
    // to avoid binding to a stale session when titles collide.
    const titleMatches = sessions.filter((s) => s.title === `AO:${session.id}`);
    if (titleMatches.length === 0) return null;
    if (titleMatches.length === 1) return titleMatches[0]!;
    return titleMatches.reduce((best, s) => {
      const bestTs = parseUpdatedTimestamp(best.updated)?.getTime() ?? 0;
      const sTs = parseUpdatedTimestamp(s.updated)?.getTime() ?? 0;
      return sTs > bestTs ? s : best;
    });
  } catch {
    return null;
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

    getLaunchCommand(config: AgentLaunchConfig): string {
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
      const legacyOptions = buildLegacySessionOptions(config.model, config.subagent);
      const promptOptions = promptValue ? ["--prompt", promptValue] : [];
      const tuiCommand = ["exec", "opencode", "--session", '"$SES_ID"', ...promptOptions].join(" ");
      const findByTitle = `SES_ID=$(opencode session list --format json | node -e ${shellEscape(buildSessionLookupScript())} ${shellEscape(title)})`;
      const missingSessionError = shellEscape(
        `failed to discover OpenCode session ID for AO:${config.sessionId}`,
      );
      const openTuiOrFail = (command: string) =>
        `[ -n "$SES_ID" ] && ${command}; echo ${missingSessionError} >&2; exit 1`;

      // 1.x: `run --command true` makes the titled session, then fails on the unknown
      // command without a model turn; its JSON error event carries the session ID.
      const runCommand = [
        "opencode",
        "run",
        "--format",
        "json",
        "--title",
        shellEscape(title),
        ...legacyOptions,
        "--command",
        "true",
      ].join(" ");
      const legacyCommand = [
        `SES_ID=$(${runCommand} | node -e ${shellEscape(buildSessionIdCaptureScript())})`,
        `if [ -z "$SES_ID" ]; then ${findByTitle}; fi`,
        openTuiOrFail([tuiCommand, ...legacyOptions].join(" ")),
      ].join("; ");

      // 2.x: the API makes the titled session with its model and agent, without a model turn.
      const modelRef = config.model ? toOpenCodeModelRef(config.model) : undefined;
      const createBody = JSON.stringify({
        title,
        ...(modelRef ? { model: modelRef } : {}),
        ...(config.subagent ? { agent: config.subagent } : {}),
      });
      // A failed create makes no session. A session with the title is then an older
      // one from an earlier AO session with the same ID, so the command stops.
      const apiCreate = `if OC_CREATE=$(opencode api session.create -d "$(node -e ${shellEscape(buildApiSessionBodyScript())} ${shellEscape(createBody)})"); then SES_ID=$(printf '%s\\n' "$OC_CREATE" | node -e ${shellEscape(buildApiSessionIdCaptureScript())}); else [ -z "$OC_CREATE" ] || printf '%s\\n' "$OC_CREATE" >&2; echo ${shellEscape(`failed to create the OpenCode session ${title}`)} >&2; exit 1; fi`;
      // A create that succeeds without a usable ID falls back to the newest session with
      // the title. That can be an older session with other settings, so the command
      // stores the requested settings on it and opens the TUI only after a readback.
      const settingsCheck =
        modelRef || config.subagent
          ? `; if [ -n "$SES_ID" ]; then ${buildApiSettingsCommand('"sessionID=$SES_ID"', modelRef, config.subagent)} || { ${settingsFailureCommand('"$SES_ID"')}; }; fi`
          : "";
      const apiCommand =
        config.model && !modelRef
          ? invalidModelCommand(config.model)
          : [
              apiCreate,
              `if [ -z "$SES_ID" ]; then ${findByTitle}${settingsCheck}; fi`,
              openTuiOrFail(tuiCommand),
            ].join("; ");

      return `${OPENCODE_MAJOR_PROBE}; ${branchOnOpenCodeMajor(apiCommand, legacyCommand)}`;
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
      if (!terminalOutput.trim()) return "idle";

      const lines = terminalOutput.trim().split("\n");
      const lastLine = lines[lines.length - 1]?.trim() ?? "";

      // OpenCode's input prompt — agent is idle
      if (/^[>$#]\s*$/.test(lastLine)) return "idle";

      // Check the last few lines for permission/confirmation prompts
      const tail = lines.slice(-5).join("\n");
      if (/\(Y\)es.*\(N\)o/i.test(tail)) return "waiting_input";
      if (/approval required/i.test(tail)) return "waiting_input";
      if (/Do you want to proceed\?/i.test(tail)) return "waiting_input";
      if (/Allow .+\?/i.test(tail)) return "waiting_input";

      return "active";
    },

    async getActivityState(
      session: Session,
      readyThresholdMs?: number,
    ): Promise<ActivityDetection | null> {
      const threshold = readyThresholdMs ?? DEFAULT_READY_THRESHOLD_MS;
      const activeWindowMs = Math.min(DEFAULT_ACTIVE_WINDOW_MS, threshold);

      // Check if process is running first
      const exitedAt = new Date();
      if (!session.runtimeHandle) return { state: "exited", timestamp: exitedAt };
      const running = await this.isProcessRunning(session.runtimeHandle);
      if (!running) return { state: "exited", timestamp: exitedAt };

      // 1. Check AO activity JSONL first (written by recordActivity from terminal output).
      //    This is the only source of waiting_input/blocked states for OpenCode.
      let activityResult: Awaited<ReturnType<typeof readLastActivityEntry>> = null;
      if (session.workspacePath) {
        activityResult = await readLastActivityEntry(session.workspacePath);
        const activityState = checkActivityLogState(activityResult);
        if (activityState) return activityState;
      }

      // 2. Fallback: query OpenCode's session list API for timestamp-based detection
      const targetSession = await findOpenCodeSession(session);
      if (targetSession) {
        const lastActivity = parseUpdatedTimestamp(targetSession.updated);

        if (lastActivity) {
          const ageMs = Math.max(0, Date.now() - lastActivity.getTime());
          if (ageMs <= activeWindowMs) {
            return { state: "active", timestamp: lastActivity };
          }
          if (ageMs <= threshold) {
            return { state: "ready", timestamp: lastActivity };
          }
          return { state: "idle", timestamp: lastActivity };
        }
      }

      // 3. Fallback: use JSONL entry with age-based decay when session list is unavailable.
      const fallback = getActivityFallbackState(activityResult, activeWindowMs, threshold);
      if (fallback) return fallback;

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
      const targetSession = await findOpenCodeSession(session);
      if (!targetSession) return null;

      return {
        summary: targetSession.title ?? null,
        summaryIsFallback: true,
        agentSessionId: targetSession.id,
        // OpenCode doesn't expose token/cost data in session list
      };
    },

    async getRestoreCommand(session: Session, project: ProjectConfig): Promise<string | null> {
      // Try metadata first, then query OpenCode's session list
      const sessionId =
        asValidOpenCodeSessionId(session.metadata?.opencodeSessionId) ??
        (await findOpenCodeSession(session))?.id ??
        null;

      if (!sessionId) return null;

      const agentConfig = project.agentConfig as OpenCodeAgentConfig | undefined;
      return buildResumeCommand(sessionId, { model: agentConfig?.model as string | undefined });
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
  try {
    // `opencode version` is no version command: 1.x reads "version" as a project
    // directory and still exits 0, 2.x exits 1. `--version` exits 0 on both.
    execFileSync("opencode", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export default { manifest, create, detect } satisfies PluginModule<Agent>;