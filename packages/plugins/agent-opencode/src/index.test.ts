import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import type * as FsPromises from "node:fs/promises";
import {
  OpenCodeApiIncompleteAnswerError,
  OpenCodeApiTimeoutError,
  SessionNotRestorableError,
  type Session,
  type RuntimeHandle,
  type AgentLaunchConfig,
  type OpenCodeApiModel,
  type PreparedAgentSession,
} from "@aoagents/ao-core";

const {
  mockAppendActivityEntry,
  mockReadLastActivityEntry,
  mockRecordTerminalActivity,
  mockGetOpenCodeSession,
  mockCallOpenCodeApi,
  mockCreateOpenCodeSession,
  mockListOpenCodeModels,
  mockSwitchOpenCodeSessionModel,
  mockSwitchOpenCodeSessionAgent,
  mockHasOpenCodeUserMessage,
  mockGetNewestOpenCodeUserMessage,
  mockInterruptOpenCodeSession,
  mockRemoveOpenCodeSession,
  mockGetHerdrPaneProcesses,
  procCmdlines,
} = vi.hoisted(() => ({
  mockAppendActivityEntry: vi.fn().mockResolvedValue(undefined),
  mockReadLastActivityEntry: vi.fn().mockResolvedValue(null),
  mockRecordTerminalActivity: vi.fn().mockResolvedValue(undefined),
  mockGetOpenCodeSession: vi.fn(),
  mockCallOpenCodeApi: vi.fn(),
  mockCreateOpenCodeSession: vi.fn(),
  mockListOpenCodeModels: vi.fn(),
  mockSwitchOpenCodeSessionModel: vi.fn(),
  mockSwitchOpenCodeSessionAgent: vi.fn(),
  mockHasOpenCodeUserMessage: vi.fn(),
  mockGetNewestOpenCodeUserMessage: vi.fn(),
  mockInterruptOpenCodeSession: vi.fn(),
  mockRemoveOpenCodeSession: vi.fn(),
  mockGetHerdrPaneProcesses: vi.fn(),
  /** The argument vectors that `/proc/<pid>/cmdline` gives, by PID (M-1). */
  procCmdlines: new Map<number, string[]>(),
}));

const mockExecFileAsync = vi.fn();
const mockExecFileSync = vi.fn();

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    appendActivityEntry: mockAppendActivityEntry,
    readLastActivityEntry: mockReadLastActivityEntry,
    recordTerminalActivity: mockRecordTerminalActivity,
    getOpenCodeSession: (...args: unknown[]) => (mockGetOpenCodeSession as (...a: unknown[]) => unknown)(...args),
    callOpenCodeApi: (...args: unknown[]) => (mockCallOpenCodeApi as (...a: unknown[]) => unknown)(...args),
    // The I-3 session calls of prepareAgentSession, discard and confirmLaunch.
    createOpenCodeSession: mockCreateOpenCodeSession,
    listOpenCodeModels: mockListOpenCodeModels,
    switchOpenCodeSessionModel: mockSwitchOpenCodeSessionModel,
    switchOpenCodeSessionAgent: mockSwitchOpenCodeSessionAgent,
    hasOpenCodeUserMessage: mockHasOpenCodeUserMessage,
    getNewestOpenCodeUserMessage: mockGetNewestOpenCodeUserMessage,
    interruptOpenCodeSession: mockInterruptOpenCodeSession,
    removeOpenCodeSession: mockRemoveOpenCodeSession,
    getHerdrPaneProcesses: mockGetHerdrPaneProcesses,
  };
});

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      const result = mockExecFileAsync(...args.slice(0, -1));
      if (result && typeof result.then === "function") {
        result
          .then((r: { stdout: string; stderr: string }) => callback(null, r))
          .catch((e: Error) => callback(e));
      }
    }
  },
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// The launch check reads `/proc/<pid>/cmdline` (M-1); every other path is the real file.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const readFile = async (path: unknown, ...rest: unknown[]): Promise<unknown> => {
    const match = /^\/proc\/(\d+)\/cmdline$/.exec(String(path));
    if (!match) return (actual.readFile as (...a: unknown[]) => Promise<unknown>)(path, ...rest);
    const argv = procCmdlines.get(Number(match[1]));
    if (!argv) throw Object.assign(new Error(`ENOENT: ${String(path)}`), { code: "ENOENT" });
    return `${argv.join("\0")}\0`;
  };
  return { ...actual, readFile, default: { ...actual, readFile } };
});

import { create, detect, manifest, default as defaultExport } from "./index.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-1",
    projectId: "test-project",
    status: "working",
    activity: "active",
    branch: "feat/test",
    issueId: null,
    pr: null,
    workspacePath: "/workspace/test",
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

function makeTmuxHandle(id = "test-session"): RuntimeHandle {
  return { id, runtimeName: "tmux", data: {} };
}
function makeProcessHandle(pid?: number | string): RuntimeHandle {
  return { id: "proc-1", runtimeName: "process", data: pid !== undefined ? { pid } : {} };
}
function makeLaunchConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
  return {
    sessionId: "sess-1",
    projectConfig: {
      name: "my-project",
      repo: "owner/repo",
      path: "/workspace/repo",
      defaultBranch: "main",
      sessionPrefix: "my",
    },
    ...overrides,
  };
}
function mockTmuxWithProcess(processName: string, found = true) {
  mockExecFileAsync.mockImplementation((cmd: string) => {
    if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
    if (cmd === "ps") {
      const line = found ? `  789 ttys003  ${processName}` : "  789 ttys003  bash";
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n${line}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error("unexpected"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The plugin gates on the Node-resolved `opencode --version` before the pane
  // starts. Tests that need another version override this per test.
  mockExecFileSync.mockImplementation((cmd: string) => {
    if (cmd === "opencode") return "opencode v2.0.29\n";
    throw new Error(`unexpected command: ${cmd}`);
  });
  // `session.get` by stored ID (rows 5 and 6). Defaults to 404 (no session);
  // tests that need a session override per test. No title search.
  mockGetOpenCodeSession.mockResolvedValue(null);
  // I-4 API lists: default to empty (no permission, no form, not active).
  mockCallOpenCodeApi.mockImplementation((operation: string) => {
    if (operation === "session.permission.list") return Promise.resolve({ data: [] });
    if (operation === "session.form.list") return Promise.resolve({ data: [] });
    if (operation === "session.active") return Promise.resolve({ data: {} });
    if (operation === "session.message.list")
      return Promise.resolve({ data: [], cursor: { previous: null, next: null } });
    return Promise.reject(new Error(`unexpected operation: ${operation}`));
  });
  mockCreateOpenCodeSession.mockResolvedValue({ id: "ses_made", title: "AO:sess-1" });
  mockListOpenCodeModels.mockResolvedValue(FLEET_PIN_MODELS);
  mockSwitchOpenCodeSessionModel.mockResolvedValue(undefined);
  mockSwitchOpenCodeSessionAgent.mockResolvedValue(undefined);
  mockHasOpenCodeUserMessage.mockResolvedValue(false);
  mockGetNewestOpenCodeUserMessage.mockResolvedValue(null);
  procCmdlines.clear();
  mockInterruptOpenCodeSession.mockResolvedValue(undefined);
  mockRemoveOpenCodeSession.mockResolvedValue(undefined);
  mockGetHerdrPaneProcesses.mockResolvedValue([]);
});

/**
 * The two fleet pins as `opencode api model.list` printed them on 2.0.31
 * (0010 section 11.4): the model check matches `providerID` and `id`.
 */
const FLEET_PIN_MODELS: OpenCodeApiModel[] = [
  {
    id: "muse-spark-1.3-contributor",
    modelID: "muse-spark-1.3-contributor",
    providerID: "opencode-go",
    family: "muse",
    name: "Muse Spark 1.3 Contributor",
    variants: [{ id: "minimal" }, { id: "low" }, { id: "medium" }, { id: "high" }, { id: "xhigh" }],
    status: "active",
    enabled: true,
  },
  {
    id: "deepseek-v4.1-flash",
    modelID: "deepseek-v4.1-flash",
    providerID: "opencode-go",
    family: "deepseek-flash",
    name: "DeepSeek V4.1 Flash",
    variants: [{ id: "low" }, { id: "high" }, { id: "max" }],
    status: "active",
    enabled: true,
  },
];

describe("plugin manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "opencode",
      slot: "agent",
      description: "Agent plugin: OpenCode",
      version: "0.1.0",
      displayName: "OpenCode",
    });
  });

  it("create() returns agent with correct name and processName", () => {
    const agent = create();
    expect(agent.name).toBe("opencode");
    expect(agent.processName).toBe("opencode");
  });

  it("default export is a valid PluginModule", () => {
    expect(defaultExport.manifest).toBe(manifest);
    expect(typeof defaultExport.create).toBe("function");
  });
});

describe("getLaunchCommand", () => {
  const agent = create();
  const model = "opencode-go/muse-spark-1.3-contributor";
  const id = "ses_prepared";

  /** A launch config that carries the ID that prepareAgentSession made (I-3). */
  function prepared(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
    const base = makeLaunchConfig(overrides);
    return {
      ...base,
      projectConfig: {
        ...base.projectConfig,
        agentConfig: { ...base.projectConfig.agentConfig, opencodeSessionId: id },
      },
    };
  }

  it("returns exactly exec opencode --session '<id>' without a prompt", () => {
    expect(agent.getLaunchCommand(prepared())).toBe("exec opencode --session 'ses_prepared'");
  });

  it("returns exactly exec opencode --session '<id>' --prompt '<prompt>' with a prompt", () => {
    expect(agent.getLaunchCommand(prepared({ prompt: "Fix it" }))).toBe(
      "exec opencode --session 'ses_prepared' --prompt 'Fix it'",
    );
  });

  it("throws without a session ID: there is no pane-side create", () => {
    expect(() => agent.getLaunchCommand(makeLaunchConfig({ prompt: "Go" }))).toThrow(
      "no OpenCode session ID for sess-1: prepareAgentSession must create the session",
    );
  });

  it("holds no opencode api call, no title lookup and no version probe", () => {
    const cmd = agent.getLaunchCommand(prepared({ model, subagent: "plan", prompt: "Go" }));
    expect(cmd).not.toContain("opencode api");
    expect(cmd).not.toContain("session list");
    expect(cmd).not.toContain("--version");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("passes no --model or --agent to the TUI: the session holds them", () => {
    const cmd = agent.getLaunchCommand(prepared({ model, subagent: "sisyphus", prompt: "Go" }));
    expect(cmd).toBe("exec opencode --session 'ses_prepared' --prompt 'Go'");
  });

  it("escapes single quotes in prompt (POSIX shell escaping)", () => {
    expect(agent.getLaunchCommand(prepared({ prompt: "it's broken" }))).toBe(
      "exec opencode --session 'ses_prepared' --prompt 'it'\\''s broken'",
    );
  });

  it("generates command with systemPrompt", () => {
    expect(agent.getLaunchCommand(prepared({ systemPrompt: "You are an orchestrator" }))).toBe(
      "exec opencode --session 'ses_prepared' --prompt 'You are an orchestrator'",
    );
  });

  it("generates command with systemPrompt and task prompt", () => {
    expect(
      agent.getLaunchCommand(
        prepared({ systemPrompt: "You are an orchestrator", prompt: "do the task" }),
      ),
    ).toBe(`exec opencode --session 'ses_prepared' --prompt 'You are an orchestrator

do the task'`);
  });

  it("escapes single quotes in systemPrompt", () => {
    expect(agent.getLaunchCommand(prepared({ systemPrompt: "it's important" }))).toBe(
      "exec opencode --session 'ses_prepared' --prompt 'it'\\''s important'",
    );
  });

  it("generates command with systemPromptFile via shell substitution", () => {
    expect(agent.getLaunchCommand(prepared({ systemPromptFile: "/tmp/prompt.md" }))).toBe(
      `exec opencode --session 'ses_prepared' --prompt "$(cat '/tmp/prompt.md')"`,
    );
  });

  it("escapes path in systemPromptFile", () => {
    expect(agent.getLaunchCommand(prepared({ systemPromptFile: "/tmp/it's-prompt.md" }))).toBe(
      `exec opencode --session 'ses_prepared' --prompt "$(cat '/tmp/it'\\''s-prompt.md')"`,
    );
  });

  it("systemPromptFile takes precedence over systemPrompt", () => {
    const cmd = agent.getLaunchCommand(
      prepared({ systemPrompt: "direct prompt", systemPromptFile: "/tmp/file-prompt.md" }),
    );
    expect(cmd).toBe(
      `exec opencode --session 'ses_prepared' --prompt "$(cat '/tmp/file-prompt.md')"`,
    );
  });

  it("combines systemPromptFile with the task prompt", () => {
    expect(
      agent.getLaunchCommand(
        prepared({ systemPromptFile: "/tmp/orchestrator.md", prompt: "fix the bug" }),
      ),
    ).toBe(
      "exec opencode --session 'ses_prepared' --prompt \"$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')\"",
    );
  });

  it.each([
    ["special characters", "fix $PATH/to/file and `rm -rf /unquoted/path`"],
    ["newlines", "line1\nline2\nline3"],
    ["backticks", "use `backticks` and $vars`"],
    ["dollar signs", "cost is $100"],
    ["double quotes", 'say "hello" and "goodbye"'],
    ["unicode characters", "fix bug in café.js file"],
    ["semicolons", "line1; line2; line3"],
  ])("keeps a prompt with %s inside one single-quoted word", (_label, prompt) => {
    expect(agent.getLaunchCommand(prepared({ prompt }))).toBe(
      `exec opencode --session 'ses_prepared' --prompt '${prompt}'`,
    );
  });

  it("handles empty prompt", () => {
    expect(agent.getLaunchCommand(prepared({ prompt: "" }))).toBe(
      "exec opencode --session 'ses_prepared'",
    );
  });

  it("uses the reused session ID in the same way", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        projectConfig: {
          name: "my-project",
          repo: "owner/repo",
          path: "/workspace/repo",
          defaultBranch: "main",
          sessionPrefix: "my",
          agentConfig: { opencodeSessionId: "ses_abc123" },
        },
        prompt: "continue",
      }),
    );
    expect(cmd).toBe("exec opencode --session 'ses_abc123' --prompt 'continue'");
  });
});

describe("getEnvironment", () => {
  const agent = create();

  it("sets AO_SESSION_ID but not AO_PROJECT_ID (caller's responsibility)", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
    expect(env["AO_PROJECT_ID"]).toBeUndefined();
  });

  it("sets AO_ISSUE_ID when provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig({ issueId: "GH-42" }));
    expect(env["AO_ISSUE_ID"]).toBe("GH-42");
  });

  it("omits AO_ISSUE_ID when not provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_ISSUE_ID"]).toBeUndefined();
  });
});

describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when opencode found on tmux pane TTY", async () => {
    mockTmuxWithProcess("opencode");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when opencode not on tmux pane TTY", async () => {
    mockTmuxWithProcess("opencode", false);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true for process handle with alive PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(123, 0);
    killSpy.mockRestore();
  });

  it("returns false for process handle with dead PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(await agent.isProcessRunning(makeProcessHandle(123))).toBe(false);
    killSpy.mockRestore();
  });

  it("returns false for unknown runtime without PID", async () => {
    const handle: RuntimeHandle = { id: "x", runtimeName: "other", data: {} };
    expect(await agent.isProcessRunning(handle)).toBe(false);
  });

  it("returns false on tmux command failure", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux not running"));
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("returns true when PID exists but throws EPERM", async () => {
    const epermErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw epermErr;
    });
    expect(await agent.isProcessRunning(makeProcessHandle(789))).toBe(true);
    killSpy.mockRestore();
  });

  it("finds opencode on any pane in multi-pane session", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") {
        return Promise.resolve({ stdout: "/dev/ttys001\n/dev/ttys002\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  bash\n  200 ttys002  opencode run hello\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });
});

describe("detectActivity — terminal output classification", () => {
  const agent = create();

  it("delegates to the 2.x pane classifier: the real idle Muse capture is idle", async () => {
    const { REAL_IDLE_MUSE_2031 } = await import("./__fixtures__/panes-2.0.31.js");
    expect(agent.detectActivity(REAL_IDLE_MUSE_2031)).toBe("idle");
  });
});

describe("getActivityState", () => {
  const agent = create();

  function mockTmuxRunning() {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
  }

  function mockOpencodeSessionGet(updated: number | undefined) {
    mockTmuxRunning();
    mockGetOpenCodeSession.mockResolvedValue(
      updated === undefined
        ? { id: "ses_abc123", time: {} }
        : { id: "ses_abc123", time: { updated } },
    );
  }

  function mockOpencodeSessionList(updated: number) {
    mockOpencodeSessionGet(updated);
  }

  it("returns exited when there is no runtime handle", async () => {
    const state = await agent.getActivityState(makeSession({ runtimeHandle: null }));
    expect(state?.state).toBe("exited");
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
    expect(mockCallOpenCodeApi).not.toHaveBeenCalled();
  });

  it("returns active from the native session.active signal even when time.idle is old", async () => {
    mockTmuxRunning();
    const old = Date.now() - 600_000;
    mockGetOpenCodeSession.mockResolvedValue({
      id: "ses_abc123",
      time: { updated: old, idle: old },
      outcome: "succeeded",
    });
    mockCallOpenCodeApi.mockImplementation((operation: string) => {
      if (operation === "session.permission.list") return Promise.resolve({ data: [] });
      if (operation === "session.form.list") return Promise.resolve({ data: [] });
      if (operation === "session.active")
        return Promise.resolve({ data: { ses_abc123: { type: "running" } } });
      return Promise.reject(new Error(`unexpected operation: ${operation}`));
    });

    const before = Date.now();
    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("active");
    expect(state?.timestamp.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(mockGetOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(mockCallOpenCodeApi).toHaveBeenCalledTimes(3);
  });

  it("returns idle when last activity is older than ready threshold", async () => {
    mockOpencodeSessionList(Date.now() - 120_000);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("idle");
  });

  it("returns ready when last activity is between active window and ready threshold", async () => {
    mockOpencodeSessionList(Date.now() - 45_000);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("ready");
  });

  it("returns active when last activity is recent", async () => {
    mockOpencodeSessionList(Date.now() - 10_000);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("active");
  });

  it("returns null when matching session has invalid updated timestamp", async () => {
    mockOpencodeSessionGet(undefined);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state).toBeNull();
  });

  it("does not fall back to AO session title when opencodeSessionId metadata is missing", async () => {
    // I-2 rows 5 and 6: no title search. Without a stored ID the lookup
    // returns null even though a session with the title exists.
    mockTmuxRunning();
    mockGetOpenCodeSession.mockResolvedValue(null);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: {},
      }),
      60_000,
    );

    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
    expect(mockCallOpenCodeApi).not.toHaveBeenCalled();
    expect(state).toBeNull();
  });

  it("returns null when session.get throws (falls back with no JSONL entry)", async () => {
    mockTmuxRunning();
    mockGetOpenCodeSession.mockRejectedValue(new Error("hang"));

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
    );

    expect(state).toBeNull();
  });

  it("does not let a JSONL waiting_input override an API answer with empty lists", async () => {
    mockTmuxRunning();
    const old = Date.now() - 120_000;
    mockGetOpenCodeSession.mockResolvedValue({
      id: "ses_abc123",
      time: { updated: old, idle: old },
      outcome: "succeeded",
    });
    mockReadLastActivityEntry.mockResolvedValue({
      entry: { ts: new Date().toISOString(), state: "waiting_input", source: "terminal" },
      modifiedAt: new Date(),
    });

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state?.state).toBe("idle");
    expect(mockReadLastActivityEntry).not.toHaveBeenCalled();
    mockReadLastActivityEntry.mockReset();
    mockReadLastActivityEntry.mockResolvedValue(null);
  });
});

describe("getSessionInfo", () => {
  const agent = create();

  it("returns session info when matching session found by metadata ID", async () => {
    mockGetOpenCodeSession.mockResolvedValue({
      id: "ses_abc123",
      title: "AO:test-1",
      time: { updated: Date.now() },
    });

    const info = await agent.getSessionInfo(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
    );
    expect(info).not.toBeNull();
    expect(info!.agentSessionId).toBe("ses_abc123");
    expect(info!.summary).toBe("AO:test-1");
    expect(info!.summaryIsFallback).toBe(true);
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_abc123", expect.any(Number));
  });

  it("returns null when no stored session ID exists (no title search)", async () => {
    const info = await agent.getSessionInfo(makeSession({ metadata: {} }));
    expect(info).toBeNull();
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
  });

  it("returns null when the stored session is gone (404, no title replacement)", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);
    const info = await agent.getSessionInfo(
      makeSession({ metadata: { opencodeSessionId: "ses_gone" } }),
    );
    expect(info).toBeNull();
  });

  it("returns null when opencode command fails", async () => {
    mockGetOpenCodeSession.mockRejectedValue(new Error("opencode not found"));
    const info = await agent.getSessionInfo(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
    );
    expect(info).toBeNull();
  });
});

// =========================================================================
// getRestoreCommand
// =========================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  it("returns restore command from metadata session ID", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBe("opencode --session 'ses_abc123'");
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_abc123");
  });

  it("stores the project model through the API instead of a TUI flag", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      {
        name: "proj",
        repo: "o/r",
        path: "/p",
        defaultBranch: "main",
        sessionPrefix: "p",
        agentConfig: { model: "opencode-go/muse-spark-1.3-contributor" },
      },
    );
    expect(cmd).toContain("opencode api session.switchModel");
    expect(cmd).toContain('"providerID":"opencode-go"');
    expect(cmd).not.toContain("--model");
  });

  it("prefers the effective (persisted spawn) model over the config model", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      {
        name: "proj",
        repo: "o/r",
        path: "/p",
        defaultBranch: "main",
        sessionPrefix: "p",
        agentConfig: { model: "opencode-go/config-model" },
      },
      "opencode-go/spawn-model-X",
    );
    expect(cmd).toContain("spawn-model-X");
    expect(cmd).not.toContain("config-model");
  });

  it("uses the effective model when the config has none", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
      "opencode-go/spawn-model-X",
    );
    expect(cmd).toContain("spawn-model-X");
  });

  it("restore with stored default reads no mode, like a launch with no mode", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const launch = agent.getLaunchCommand(
      makeLaunchConfig({
        projectConfig: {
          name: "proj",
          repo: "o/r",
          path: "/p",
          defaultBranch: "main",
          sessionPrefix: "p",
          agentConfig: { opencodeSessionId: "ses_abc123" },
        },
      }),
    );
    const restore = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      {
        name: "proj",
        repo: "o/r",
        path: "/p",
        defaultBranch: "main",
        sessionPrefix: "p",
        agentConfig: { permissions: "default" },
      },
    );
    expect(launch).not.toContain("session.switchModel");
    expect(restore).toBe("opencode --session 'ses_abc123'");
  });

  it("refuses the restore when no session ID is stored, and names remap (no title search)", async () => {
    const restore = agent.getRestoreCommand!(
      makeSession({ metadata: {} }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    await expect(restore).rejects.toBeInstanceOf(SessionNotRestorableError);
    await expect(restore).rejects.toThrow(
      "no stored OpenCode session ID for test-1; run `ao session remap test-1`",
    );
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
    // A4: the version probe runs first, so a refused binary reports the
    // version problem instead of only the missing mapping.
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("refuses the restore when the stored session is gone (m-1, no title replacement)", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);
    const restore = agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_gone" } }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    await expect(restore).rejects.toBeInstanceOf(SessionNotRestorableError);
    await expect(restore).rejects.toThrow("the stored OpenCode session ses_gone is gone");
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_gone");
  });

  it("does not restore when session.get fails for another reason", async () => {
    mockGetOpenCodeSession.mockRejectedValue(new Error("opencode api session.get failed: HTTP 500"));
    await expect(
      agent.getRestoreCommand!(
        makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
        { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
      ),
    ).rejects.toThrow("HTTP 500");
  });
});

// =========================================================================
// setupWorkspaceHooks + postLaunchSetup
// =========================================================================
describe("setupWorkspaceHooks", () => {
  const agent = create();

  it("is defined (delegates to shared setupPathWrapperWorkspace)", () => {
    expect(agent.setupWorkspaceHooks).toBeDefined();
    expect(typeof agent.setupWorkspaceHooks).toBe("function");
  });
});

describe("postLaunchSetup", () => {
  const agent = create();

  it("is defined", () => {
    expect(agent.postLaunchSetup).toBeDefined();
  });

  it("does nothing when workspacePath is null", async () => {
    await agent.postLaunchSetup!(makeSession({ workspacePath: null }));
  });
});

// =========================================================================
// getEnvironment — PATH wrapping
// =========================================================================
describe("getEnvironment PATH", () => {
  const agent = create();

  it("prepends ~/.ao/bin to PATH", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["PATH"]).toMatch(/\.ao\/bin/);
  });

  it("sets GH_PATH", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["GH_PATH"]).toBe("/usr/local/bin/gh");
  });
});

describe("invalid session ID rejection", () => {
  it("refuses an invalid opencodeSessionId instead of building a launch command", () => {
    const agent = create();

    const invalidIds = ["invalid", "SES_uppercase", "ses_", "ses spaces here", "", "ses-123"];

    for (const invalidId of invalidIds) {
      expect(() =>
        agent.getLaunchCommand(
          makeLaunchConfig({
            projectConfig: {
              name: "my-project",
              repo: "owner/repo",
              path: "/workspace/repo",
              defaultBranch: "main",
              sessionPrefix: "my",
              agentConfig: { opencodeSessionId: invalidId },
            },
            prompt: "continue",
          }),
        ),
      ).toThrow("no OpenCode session ID");
    }
  });

  it("only accepts valid ses_ prefix session IDs", () => {
    const agent = create();

    const validIds = ["ses_abc123", "ses_test-session", "ses_12345"];

    for (const validId of validIds) {
      const cmd = agent.getLaunchCommand(
        makeLaunchConfig({
          projectConfig: {
            name: "my-project",
            repo: "owner/repo",
            path: "/workspace/repo",
            defaultBranch: "main",
            sessionPrefix: "my",
            agentConfig: { opencodeSessionId: validId },
          },
          prompt: "continue",
        }),
      );

      expect(cmd).toContain(`--session '${validId}'`);
    }
  });
});

// =========================================================================
// recordActivity
// =========================================================================
describe("recordActivity", () => {
  const agent = create();

  it("is defined", () => {
    expect(agent.recordActivity).toBeDefined();
  });

  it("does nothing when workspacePath is null", async () => {
    await agent.recordActivity!(makeSession({ workspacePath: null }), "some output");
    expect(mockRecordTerminalActivity).not.toHaveBeenCalled();
  });

  it("delegates to recordTerminalActivity", async () => {
    await agent.recordActivity!(makeSession(), "opencode is working");
    expect(mockRecordTerminalActivity).toHaveBeenCalledWith(
      "/workspace/test",
      "opencode is working",
      expect.any(Function),
    );
  });
});

// =========================================================================
// getActivityState — reads from activity JSONL
// =========================================================================
describe("getActivityState with activity JSONL", () => {
  const agent = create();

  it("returns waiting_input from activity JSONL", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "waiting_input", source: "terminal" },
      modifiedAt: new Date(),
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("waiting_input");
  });

  it("returns blocked from activity JSONL", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "blocked", source: "terminal" },
      modifiedAt: new Date(),
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
    );
    expect(result?.state).toBe("blocked");
  });

  it("returns active from the API when the AO JSONL is empty and a session is stored", async () => {
    mockTmuxWithProcess("opencode");
    mockGetOpenCodeSession.mockResolvedValue({
      id: "ses_abc123",
      title: "AO:test-1",
      time: { updated: Date.now() - 5_000 },
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle(), metadata: { opencodeSessionId: "ses_abc123" } }),
      60_000,
    );
    expect(result?.state).toBe("active");
  });

  it("falls back to JSONL entry state when session lookup misses", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "active", source: "terminal" },
      modifiedAt: new Date(),
    });
    mockGetOpenCodeSession.mockResolvedValue(null);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
      60_000,
    );
    expect(result?.state).toBe("active");
  });

  it("falls back to JSONL entry with age decay — old entry becomes idle", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date(Date.now() - 120_000).toISOString(), state: "active", source: "terminal" },
      modifiedAt: new Date(Date.now() - 120_000),
    });
    mockGetOpenCodeSession.mockResolvedValue(null);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
      60_000,
    );
    expect(result?.state).toBe("idle");
  });

  it("returns null when both session lookup and JSONL are unavailable", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce(null);
    mockGetOpenCodeSession.mockResolvedValue(null);

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
      60_000,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// herdr runtime — isProcessRunning
//
// herdr owns the PTY and reports a pane's foreground processes directly. Before
// this branch existed a herdr handle matched neither the tmux nor the process
// runtime and fell through to the PID lookup, so every herdr session reported
// exited. See development/0003 §4.1.
// ---------------------------------------------------------------------------
describe("isProcessRunning — herdr runtime", () => {
  const herdrHandle = {
    id: "w8:p1",
    runtimeName: "herdr",
    data: { workspaceId: "w8", terminalId: "term_abc" },
  } as any;

  function paneProcesses(processes: unknown[]) {
    return {
      stdout: JSON.stringify({
        id: "cli:pane:process_info",
        result: { process_info: { foreground_processes: processes }, type: "pane_process_info" },
      }),
      stderr: "",
    };
  }

  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  it("is true when opencode runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "opencode --model sonnet", name: "opencode", pid: 42 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(true);
  });

  it("queries herdr for the pane instead of scanning tmux", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "opencode --model sonnet", name: "opencode", pid: 42 }]),
    );

    const agent = create();
    await agent.isProcessRunning(herdrHandle);

    const [bin, args] = mockExecFileAsync.mock.calls[0];
    expect(bin).toBe("herdr");
    expect(args).toEqual(["pane", "process-info", "--pane", "w8:p1"]);
    expect(mockExecFileAsync.mock.calls.every((c: any[]) => c[0] !== "tmux")).toBe(true);
  });

  it("is false when only an unrelated process runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "bash", name: "bash", pid: 7 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(false);
  });

  it("is false when herdr is unavailable", async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error("ENOENT"));

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(false);
  });
});

// =========================================================================
// Launch and restore commands run against a fake OpenCode 2.x CLI.
// The fake copies the CLI behavior measured on 2.0.29: no `run` command,
// no TUI model or agent flags, and an `opencode api` that keeps the
// sessions in a JSON store, so a test can read the model and agent of the
// session that the TUI opens. The version gate runs in Node before the
// pane starts, so the fake has no version branch.
// =========================================================================

const OPENCODE_2 = "opencode v2.0.29";

const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FAKE_OC_LOG, JSON.stringify(argv) + "\\n");
// FAKE_OC_CREATE: session.create prints this text, exit 0 and makes no session.
const rawCreate = env.FAKE_OC_CREATE;
const failing = (env.FAKE_OC_API_FAIL || "").split(",");
const ignored = (env.FAKE_OC_API_IGNORE || "").split(",");
let store = {};
try { store = JSON.parse(fs.readFileSync(env.FAKE_OC_STORE, "utf-8")); } catch {}
const save = () => fs.writeFileSync(env.FAKE_OC_STORE, JSON.stringify(store));
// 2.0.29 stores a model without a variant as variant "default".
const storedModel = (m) => ({ providerID: m.providerID, id: m.id, variant: m.variant || "default" });
function fail(message, code = 1) {
  process.stderr.write(message + "\\n");
  process.exit(code);
}
function flags(command, args, allowed) {
  const given = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i])) fail("Unrecognized flag: " + args[i] + " in command " + command);
    given[args[i]] = args[i + 1];
  }
  return given;
}
if (argv[0] === "--version") {
  process.stdout.write(env.FAKE_OC_VERSION + "\\n");
  process.exit(0);
}
if (argv[0] === "api") {
  const operation = argv[1];
  const given = flags("opencode api", argv.slice(2), ["-d", "--param"]);
  if (failing.includes(operation)) {
    process.stdout.write(JSON.stringify({ _tag: "InternalServerError" }) + "\\n");
    fail("HTTP 500 Internal Server Error");
  }
  if (operation === "session.create") {
    const body = JSON.parse(given["-d"]);
    if (rawCreate !== undefined) {
      process.stdout.write(rawCreate);
      process.exit(0);
    }
    // FAKE_OC_CREATE_STORES: settings that the service stores in place of the request.
    const stores = JSON.parse(env.FAKE_OC_CREATE_STORES || "{}");
    const session = { title: body.title, updated: Date.now(), directory: body.location && body.location.directory };
    const model = stores.model || body.model;
    const agent = stores.agent || body.agent;
    if (model) session.model = storedModel(model);
    if (agent) session.agent = agent;
    store[env.FAKE_OC_SESSION] = session;
    save();
    process.stdout.write(JSON.stringify({ data: { id: env.FAKE_OC_SESSION, ...session } }) + "\\n");
    process.exit(0);
  }
  const id = (given["--param"] || "").replace(/^sessionID=/, "");
  const session = store[id];
  if (!session) {
    process.stdout.write(JSON.stringify({ _tag: "SessionNotFoundError", sessionID: id }) + "\\n");
    fail("HTTP 404 Not Found");
  }
  if (operation === "session.get") {
    process.stdout.write(JSON.stringify({ data: { id, ...session } }) + "\\n");
    // FAKE_OC_GET_EXIT: session.get prints the stored session, then exits with this status.
    if (env.FAKE_OC_GET_EXIT) fail("readback failed after the body", Number(env.FAKE_OC_GET_EXIT));
    process.exit(0);
  }
  if (ignored.includes(operation)) process.exit(0);
  if (operation === "session.switchModel") session.model = storedModel(JSON.parse(given["-d"]).model);
  else if (operation === "session.switchAgent") session.agent = JSON.parse(given["-d"]).agent;
  else fail("unknown operation " + operation);
  save();
  process.exit(0);
}
flags("opencode", argv, ["--session", "--prompt"]);
process.exit(0);
`;

type ActualChildProcess = typeof ChildProcess;

let actualChildProcess: ActualChildProcess;
let fakeRoot: string;
let fakeBin: string;
let workDir: string;
let callLog: string;
let storeFile: string;

beforeAll(async () => {
  actualChildProcess = await vi.importActual<ActualChildProcess>("node:child_process");
  fakeRoot = mkdtempSync(join(tmpdir(), "ao-opencode-cli-"));
  fakeBin = join(fakeRoot, "bin");
  workDir = join(fakeRoot, "work");
  callLog = join(fakeRoot, "calls.jsonl");
  storeFile = join(fakeRoot, "sessions.json");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  writeFileSync(join(fakeBin, "opencode"), FAKE_OPENCODE, { mode: 0o755 });
});

afterAll(() => {
  rmSync(fakeRoot, { recursive: true, force: true });
});

interface FakeModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

/** A session in the fake's store, as `opencode api session.get` reports it. */
interface FakeSession {
  title: string;
  updated: number;
  directory?: string;
  model?: FakeModelRef;
  agent?: string;
  /** Marks the conversation of another task. */
  conversation?: string;
}

interface FakeCliOptions {
  sessionId?: string;
  /** Sessions that exist before the command runs. */
  list?: Array<FakeSession & { id: string }>;
  /** `session.create` prints this text, exit 0 and makes no session. */
  createOutput?: string;
  /** Settings that `session.create` stores and returns, in place of the request or in addition to it. */
  createStores?: { model?: FakeModelRef; agent?: string };
  /** API operations that fail with HTTP 500 and exit 1. */
  apiFail?: string[];
  /** Switch operations that exit 0 but do not store the value. */
  apiIgnore?: string[];
  /** `session.get` prints the stored session, then exits with this status. */
  getExit?: number;
}

function fakeCliEnv(options: FakeCliOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
    FAKE_OC_LOG: callLog,
    FAKE_OC_STORE: storeFile,
    FAKE_OC_VERSION: OPENCODE_2,
    FAKE_OC_SESSION: options.sessionId ?? "ses_fakecreated",
    ...(options.createOutput !== undefined ? { FAKE_OC_CREATE: options.createOutput } : {}),
    ...(options.createStores
      ? { FAKE_OC_CREATE_STORES: JSON.stringify(options.createStores) }
      : {}),
    ...(options.apiFail ? { FAKE_OC_API_FAIL: options.apiFail.join(",") } : {}),
    ...(options.apiIgnore ? { FAKE_OC_API_IGNORE: options.apiIgnore.join(",") } : {}),
    ...(options.getExit !== undefined ? { FAKE_OC_GET_EXIT: String(options.getExit) } : {}),
  };
}

/** Run a generated command in bash, as the tmux and herdr runtimes do, and return each fake CLI call. */
function runAgainstFakeCli(command: string, options: FakeCliOptions) {
  writeFileSync(callLog, "");
  const seeded = (options.list ?? []).map(({ id, ...session }) => [id, session]);
  writeFileSync(storeFile, JSON.stringify(Object.fromEntries(seeded)));
  const result = actualChildProcess.spawnSync("bash", ["-c", command], {
    cwd: workDir,
    env: fakeCliEnv(options),
    encoding: "utf-8",
    timeout: 20_000,
  });
  const calls = readFileSync(callLog, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
  const store = JSON.parse(readFileSync(storeFile, "utf-8")) as Record<string, FakeSession>;
  const tuiCalls = calls.filter((argv) => argv[0] === "--session");
  const tuiSessionId = tuiCalls[0] ? flagValue(tuiCalls[0], "--session") : undefined;
  return {
    status: result.status,
    stderr: result.stderr,
    calls,
    tuiCalls,
    apiCalls: calls.filter((argv) => argv[0] === "api"),
    apiOperations: calls.filter((argv) => argv[0] === "api").map((argv) => argv[1]),
    runCalls: calls.filter((argv) => argv[0] === "run"),
    listCalls: calls.filter((argv) => argv[0] === "session" && argv[1] === "list"),
    store,
    /** The stored session that the TUI opened, after every API call of the command. */
    tuiSession: tuiSessionId ? store[tuiSessionId] : undefined,
  };
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** Inverse of the plugin's model split: the API reference must name the same CLI model. */
function modelRefToCli(ref: FakeModelRef): string {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`;
}

/** The stored session holds the requested model and agent; a setting not requested stays as `before`. */
function expectSettings(
  stored: FakeSession | undefined,
  request: { model?: string; agent?: string },
  before?: Pick<FakeSession, "model" | "agent">,
) {
  expect(stored).toBeDefined();
  if (request.model) expect(modelRefToCli(stored!.model!)).toBe(request.model);
  else expect(stored!.model).toEqual(before?.model);
  if (request.agent) expect(stored!.agent).toBe(request.agent);
  else expect(stored!.agent).toEqual(before?.agent);
}

describe("launch command against the OpenCode 2.x CLI (I-3)", () => {
  const agent = create();
  const model = "opencode-go/muse-spark-1.3-contributor";
  const subagent = "plan";

  function preparedConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
    const base = makeLaunchConfig(overrides);
    return {
      ...base,
      projectConfig: {
        ...base.projectConfig,
        agentConfig: { ...base.projectConfig.agentConfig, opencodeSessionId: "ses_prepared" },
      },
    };
  }

  it("opens the TUI on the prepared session and runs no opencode api call in the pane", () => {
    const prompt = "Reply with OK";
    const run = runAgainstFakeCli(
      agent.getLaunchCommand(preparedConfig({ model, subagent, prompt })),
      {},
    );

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.apiCalls).toHaveLength(0);
    expect(run.listCalls).toHaveLength(0);
    expect(run.tuiCalls).toEqual([["--session", "ses_prepared", "--prompt", prompt]]);
  });

  it.each([
    ["quotes and shell characters", 'it\'s $HOME and `date`; "x" \\ end'],
    ["newlines", "line1\nline2\n\nline4"],
  ])("gives the TUI the exact prompt with %s", (_label, prompt) => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(preparedConfig({ prompt })), {});

    expect(run.status).toBe(0);
    expect(run.tuiCalls).toEqual([["--session", "ses_prepared", "--prompt", prompt]]);
  });

  it("gives the TUI the prompt file and the task prompt", () => {
    const promptFile = join(fakeRoot, "orchestrator prompt's.md");
    writeFileSync(promptFile, "You are the orchestrator.");
    const run = runAgainstFakeCli(
      agent.getLaunchCommand(preparedConfig({ systemPromptFile: promptFile, prompt: "Go" })),
      {},
    );

    expect(run.status).toBe(0);
    expect(run.tuiCalls).toEqual([
      ["--session", "ses_prepared", "--prompt", "You are the orchestrator.\n\nGo"],
    ]);
  });
});

describe("restore commands against the OpenCode 2.x CLI", () => {
  const agent = create();
  const model = "opencode-go/glm-5.3#xhigh";
  const existingId = "ses_existing";
  // The existing session holds other settings than the request, as 2.0.29 stores them.
  const existing = {
    id: existingId,
    title: "AO:p-1",
    updated: 1,
    model: { providerID: "opencode", id: "big-pickle", variant: "default" },
    agent: "build",
  };
  const project = {
    name: "proj",
    repo: "o/r",
    path: "/p",
    defaultBranch: "main",
    sessionPrefix: "p",
  };

  async function restoreCommand(projectModel: string): Promise<string> {
    // The Node-side `session.get` verification reads the fake store through
    // the mock (the fake binary runs in a child bash, not in this process).
    mockGetOpenCodeSession.mockResolvedValue({
      id: existingId,
      title: existing.title,
      time: { updated: existing.updated },
    });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: existingId } }),
      { ...project, agentConfig: { model: projectModel } },
    );
    return cmd!;
  }

  it("restore stops with status 1 and no TUI when session.switchModel fails", async () => {
    const run = runAgainstFakeCli(await restoreCommand(model), {
      list: [existing],
      apiFail: ["session.switchModel"],
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${existingId}`);
    expect(run.store[existingId]?.model).toEqual(existing.model);
  });

  it("restore stops with status 1 and no TUI when session.get prints the session and exits 1", async () => {
    const run = runAgainstFakeCli(await restoreCommand(model), {
      list: [existing],
      getExit: 1,
    });

      expectSettings(run.store[existingId], { model, agent: existing.agent });
      expect(run.status).toBe(1);
      expect(run.tuiCalls).toHaveLength(0);
      expect(run.stderr).toContain("opencode api session.get exited with status 1");
      expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${existingId}`);
    },
  );

  it("restore stops with status 1 before any API call when the model has no provider", async () => {
    const providerless = "glm-5.3";
    const run = runAgainstFakeCli(await restoreCommand(providerless), {
      list: [existing],
    });

      expect(run.status).toBe(1);
      expect(run.apiCalls).toHaveLength(0);
      expect(run.tuiCalls).toHaveLength(0);
      expect(run.stderr).toContain(providerless);
    },
  );

  it("restore applies the project model through the API, with no TUI model flag", async () => {
    const run = runAgainstFakeCli(await restoreCommand(model), { list: [existing] });

    expect(run.status).toBe(0);
    expect(run.tuiCalls).toHaveLength(1);
    const tui = run.tuiCalls[0]!;
    expect(flagValue(tui, "--session")).toBe(existingId);
    expect(flagValue(tui, "--model")).toBeUndefined();
    expectSettings(run.tuiSession, { model, agent: existing.agent });
  });
});

// =========================================================================
// I-3: the session is made in Node before the pane starts
// =========================================================================
describe("prepareAgentSession (I-3)", () => {
  const agent = create();
  const env = {
    AO_SESSION: "sess-1",
    AO_CALLER_TYPE: "agent",
    PATH: "/fake-home/.ao/bin:/usr/bin",
  };
  const museRef = { providerID: "opencode-go", id: "muse-spark-1.3-contributor", variant: "xhigh" };
  let root: string;
  let workspace: string;
  let workspaceLink: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "ao-opencode-prepare-"));
    workspace = join(root, "ws");
    mkdirSync(workspace);
    workspaceLink = join(root, "ws-link");
    symlinkSync(workspace, workspaceLink);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** session.get answers with what the request stored. */
  function readbackStores(model?: Record<string, string>, agentName?: string) {
    mockGetOpenCodeSession.mockImplementation(async (id: string) => ({
      id,
      title: "AO:sess-1",
      ...(model ? { model } : {}),
      ...(agentName ? { agent: agentName } : {}),
    }));
  }

  function prepare(overrides: Partial<AgentLaunchConfig> = {}, workspacePath = workspaceLink) {
    return agent.prepareAgentSession!(makeLaunchConfig(overrides), {
      workspacePath,
      environment: env,
    });
  }

  it("runs the version gate, the model check, the create and the readback in this order", async () => {
    const order: string[] = [];
    mockExecFileSync.mockImplementation(() => {
      order.push("version");
      return "opencode v2.0.31\n";
    });
    mockListOpenCodeModels.mockImplementation(async () => {
      order.push("model.list");
      return FLEET_PIN_MODELS;
    });
    mockCreateOpenCodeSession.mockImplementation(async () => {
      order.push("session.create");
      return { id: "ses_made", title: "AO:sess-1" };
    });
    mockGetOpenCodeSession.mockImplementation(async (id: string) => {
      order.push("session.get");
      return { id, title: "AO:sess-1", model: { ...museRef }, agent: "plan" };
    });

    const prepared = await prepare({
      model: "opencode-go/muse-spark-1.3-contributor#xhigh",
      subagent: "plan",
    });

    expect(order).toEqual(["version", "model.list", "session.create", "session.get"]);
    expect(mockCreateOpenCodeSession).toHaveBeenCalledWith(
      {
        title: "AO:sess-1",
        model: museRef,
        agent: "plan",
        // The real path: OpenCode stores the directory that it is given.
        location: { directory: realpathSync(workspace) },
      },
      { env },
    );
    expect(prepared.metadata).toEqual({ opencodeSessionId: "ses_made" });
    expect(prepared.agentConfig).toEqual({ opencodeSessionId: "ses_made" });
    expect(prepared.created).toBe(true);
  });

  it("runs every opencode api call with the pane environment", async () => {
    readbackStores({ ...museRef }, "plan");
    await prepare({ model: "opencode-go/muse-spark-1.3-contributor#xhigh", subagent: "plan" });

    expect(mockListOpenCodeModels).toHaveBeenCalledWith({ env });
    expect(mockCreateOpenCodeSession.mock.calls[0]![1]).toEqual({ env });
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_made", undefined, env);
  });

  it.each([
    ["opencode-go/muse-spark-1.3-contributor#xhigh", "xhigh"],
    ["opencode-go/deepseek-v4.1-flash", "default"],
  ])("accepts the fleet pin %s", async (model, variant) => {
    const [providerID, rest] = model.split("/") as [string, string];
    const id = rest.split("#")[0]!;
    readbackStores({ providerID, id, variant });

    const prepared = await prepare({ model });

    expect(prepared.metadata["opencodeSessionId"]).toBe("ses_made");
  });

  it("refuses a model that model.list does not have, before any create", async () => {
    await expect(prepare({ model: "ao1m-none/none" })).rejects.toThrow(
      "OpenCode cannot run the model ao1m-none/none: model.list has no model ao1m-none/none",
    );
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
    expect(mockSwitchOpenCodeSessionModel).not.toHaveBeenCalled();
  });

  it("refuses a variant that the model does not have, before any create", async () => {
    await expect(prepare({ model: "opencode-go/deepseek-v4.1-flash#xhigh" })).rejects.toThrow(
      "has no variant xhigh",
    );
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
  });

  it("refuses a model without a provider before any API call", async () => {
    await expect(prepare({ model: "glm-5.3" })).rejects.toThrow("glm-5.3");
    expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
  });

  it("fails the spawn when model.list cannot answer, and makes no session", async () => {
    mockListOpenCodeModels.mockRejectedValue(
      new OpenCodeApiIncompleteAnswerError("opencode api model.list printed an incomplete answer"),
    );
    await expect(prepare({ model: "opencode-go/deepseek-v4.1-flash" })).rejects.toThrow(
      "incomplete answer",
    );
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
  });

  it("skips the model check and the readback without a model or agent", async () => {
    const prepared = await prepare();

    expect(mockListOpenCodeModels).not.toHaveBeenCalled();
    expect(mockCreateOpenCodeSession).toHaveBeenCalledWith(
      { title: "AO:sess-1", location: { directory: realpathSync(workspace) } },
      { env },
    );
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
    expect(prepared.created).toBe(true);
  });

  it("makes no session when the workspace path cannot be resolved", async () => {
    await expect(prepare({}, join(workspace, "missing"))).rejects.toThrow(
      "cannot resolve the OpenCode workspace",
    );
    expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
  });

  it("removes nothing when the create fails", async () => {
    mockCreateOpenCodeSession.mockRejectedValue(
      new Error("opencode api session.create failed: HTTP 500"),
    );
    await expect(prepare()).rejects.toThrow("HTTP 500");
    expect(mockRemoveOpenCodeSession).not.toHaveBeenCalled();
  });

  it.each([
    ["another agent", { ...museRef }, "build"],
    ["another model", { providerID: "opencode", id: "big-pickle", variant: "default" }, "plan"],
    ["another variant", { ...museRef, variant: "low" }, "plan"],
  ])(
    "removes the created session and throws when the readback shows %s",
    async (_label, model, agentName) => {
      readbackStores(model, agentName);
      await expect(
        prepare({ model: "opencode-go/muse-spark-1.3-contributor#xhigh", subagent: "plan" }),
      ).rejects.toThrow("failed to set the OpenCode model or agent for ses_made");
      expect(mockInterruptOpenCodeSession).toHaveBeenCalledWith(
        "ses_made",
        expect.any(Number),
        env,
      );
      expect(mockRemoveOpenCodeSession).toHaveBeenCalledWith("ses_made", expect.any(Number), env);
    },
  );

  it("removes the created session when the readback answers 404", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);
    await expect(prepare({ subagent: "plan" })).rejects.toThrow("session.get answered 404");
    expect(mockRemoveOpenCodeSession).toHaveBeenCalledTimes(1);
  });

  describe("a reused session ID", () => {
    function reuse(overrides: Partial<AgentLaunchConfig> = {}) {
      return prepare({
        projectConfig: {
          name: "my-project",
          repo: "owner/repo",
          path: "/workspace/repo",
          defaultBranch: "main",
          sessionPrefix: "my",
          agentConfig: { opencodeSessionId: "ses_old" },
        },
        ...overrides,
      });
    }

    it("switches the model and agent, reads them back, and makes no session", async () => {
      readbackStores({ ...museRef }, "plan");
      const prepared = await reuse({
        model: "opencode-go/muse-spark-1.3-contributor#xhigh",
        subagent: "plan",
      });

      expect(mockListOpenCodeModels).toHaveBeenCalledTimes(1);
      expect(mockSwitchOpenCodeSessionModel).toHaveBeenCalledWith("ses_old", museRef, { env });
      expect(mockSwitchOpenCodeSessionAgent).toHaveBeenCalledWith("ses_old", "plan", { env });
      expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_old", undefined, env);
      expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
      expect(prepared.metadata).toEqual({ opencodeSessionId: "ses_old" });
      expect(prepared.created).toBe(false);
    });

    it("runs no switch and no readback without a model or agent, only the prompt baseline read", async () => {
      const prepared = await reuse();

      expect(mockSwitchOpenCodeSessionModel).not.toHaveBeenCalled();
      expect(mockSwitchOpenCodeSessionAgent).not.toHaveBeenCalled();
      expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
      expect(mockGetNewestOpenCodeUserMessage).toHaveBeenCalledWith("ses_old", { env });
      expect(prepared.created).toBe(false);
    });

    it("reads the prompt baseline after the switches and the readback (M-2)", async () => {
      const order: string[] = [];
      readbackStores({ ...museRef }, "plan");
      mockSwitchOpenCodeSessionModel.mockImplementation(async () => {
        order.push("switchModel");
      });
      mockGetNewestOpenCodeUserMessage.mockImplementation(async () => {
        order.push("baseline");
        return { id: "msg_old", created: 1_000 };
      });
      await reuse({ model: "opencode-go/muse-spark-1.3-contributor#xhigh", subagent: "plan" });
      expect(order).toEqual(["switchModel", "baseline"]);
    });

    it("does not fail the spawn when the baseline read fails", async () => {
      mockGetNewestOpenCodeUserMessage.mockRejectedValue(new Error("HTTP 500"));
      await expect(reuse()).resolves.toMatchObject({ created: false });
    });

    it("never removes the reused session: not on a readback mismatch, not on discard", async () => {
      readbackStores({ ...museRef }, "build");
      await expect(reuse({ subagent: "plan" })).rejects.toThrow(
        "failed to set the OpenCode model or agent for ses_old",
      );

      const prepared = await reuse();
      await prepared.discard();

      expect(mockInterruptOpenCodeSession).not.toHaveBeenCalled();
      expect(mockRemoveOpenCodeSession).not.toHaveBeenCalled();
    });

    it("fails when the switch fails, and makes no session", async () => {
      mockSwitchOpenCodeSessionModel.mockRejectedValue(
        new Error("opencode api session.switchModel: the session ses_old does not exist"),
      );
      await expect(reuse({ model: "opencode-go/deepseek-v4.1-flash" })).rejects.toThrow(
        "does not exist",
      );
      expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
    });
  });

  describe("discard of a created session", () => {
    it("reads no prompt baseline for a session that it created", async () => {
      await prepare();
      expect(mockGetNewestOpenCodeUserMessage).not.toHaveBeenCalled();
    });

    it("interrupts, then removes, with the pane environment, and only once", async () => {
      const order: string[] = [];
      mockInterruptOpenCodeSession.mockImplementation(async () => {
        order.push("interrupt");
      });
      mockRemoveOpenCodeSession.mockImplementation(async () => {
        order.push("remove");
      });
      const prepared = await prepare();

      await prepared.discard();
      await prepared.discard();

      expect(order).toEqual(["interrupt", "remove"]);
      expect(mockRemoveOpenCodeSession).toHaveBeenCalledWith("ses_made", expect.any(Number), env);
    });

    it("removes even when the interrupt fails", async () => {
      mockInterruptOpenCodeSession.mockRejectedValue(new Error("HTTP 500"));
      const prepared = await prepare();
      await prepared.discard();
      expect(mockRemoveOpenCodeSession).toHaveBeenCalledTimes(1);
    });

    it("tries the remove twice, then writes one operator line and does not throw", async () => {
      mockRemoveOpenCodeSession.mockRejectedValue(new Error("HTTP 500 Internal Server Error"));
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const prepared = await prepare();
        await expect(prepared.discard()).resolves.toBeUndefined();

        expect(mockRemoveOpenCodeSession).toHaveBeenCalledTimes(2);
        const lines = write.mock.calls.map((call) => String(call[0]));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("could not remove the OpenCode session ses_made");
        expect(lines[0]).toContain("opencode api session.remove --param sessionID=ses_made");
      } finally {
        write.mockRestore();
      }
    });

    it("does not try again after a timeout", async () => {
      mockRemoveOpenCodeSession.mockRejectedValue(
        new OpenCodeApiTimeoutError("opencode api session.remove timed out"),
      );
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const prepared = await prepare();
        await prepared.discard();
        expect(mockRemoveOpenCodeSession).toHaveBeenCalledTimes(1);
      } finally {
        write.mockRestore();
      }
    });
  });
});

describe("confirmLaunch (I-3)", () => {
  const agent = create();
  const env = { AO_SESSION: "sess-1", PATH: "/fake-home/.ao/bin:/usr/bin" };
  const quick = { timeoutMs: 400, promptExpected: false, promptTimeoutMs: 300 };

  async function preparedSession(): Promise<PreparedAgentSession> {
    return agent.prepareAgentSession!(makeLaunchConfig(), {
      workspacePath: tmpdir(),
      environment: env,
    });
  }

  function tmuxSession(): Session {
    return makeSession({ id: "sess-1", runtimeHandle: makeTmuxHandle("abc-sess-1") });
  }

  function herdrSession(): Session {
    return makeSession({
      id: "sess-1",
      runtimeHandle: { id: "w8:p1", runtimeName: "herdr", data: {} },
    });
  }

  /** One pane process: its PID, its TTY, and the argv that `/proc/<pid>/cmdline` gives. */
  type PaneRow = [pid: number, tty: string, argv: string[]];

  /**
   * The pane TTY is pts/7; `calls` gives the `ps` rows of each call in turn
   * (the last one repeats). `ps` prints only the PID and the TTY; the argv
   * comes from `/proc`.
   */
  function paneProcesses(...calls: PaneRow[][]) {
    let call = 0;
    for (const rows of calls) {
      for (const [pid, , argv] of rows) procCmdlines.set(pid, argv);
    }
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux") {
        expect(args).toEqual(["list-panes", "-t", "abc-sess-1", "-F", "#{pane_tty}"]);
        return Promise.resolve({ stdout: "/dev/pts/7\n", stderr: "" });
      }
      if (cmd === "ps") {
        const rows = calls[Math.min(call++, calls.length - 1)]!;
        const lines = rows.map(([pid, tty]) => `${String(pid).padStart(7)} ${tty}`);
        return Promise.resolve({ stdout: `${lines.join("\n")}\n`, stderr: "" });
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
  }

  /** The herdr pane's foreground processes; their argv comes from `/proc`. */
  function herdrProcesses(...rows: Array<[pid: number, argv: string[]]>) {
    for (const [pid, argv] of rows) procCmdlines.set(pid, argv);
    mockGetHerdrPaneProcesses.mockResolvedValue(
      rows.map(([pid, argv]) => ({
        pid,
        name: argv[0]!.split("/").pop()!,
        cmdline: argv.join(" "),
      })),
    );
  }

  const OPENS = "the pane of sess-1 did not run OpenCode on session ses_made within 0.4 s";

  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  it("confirms when the pane runs opencode on the session and the process stays", async () => {
    paneProcesses([[4242, "pts/7", ["/home/u/.opencode/bin/opencode", "--session", "ses_made"]]]);
    const result = await agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick);

    expect(result).toEqual({});
    expect(mockHasOpenCodeUserMessage).not.toHaveBeenCalled();
    const psCall = mockExecFileAsync.mock.calls.find((call: unknown[]) => call[0] === "ps");
    expect(psCall?.[1]).toEqual(["-eo", "pid=,tty="]);
  });

  it("matches --session=<id> and the .opencode binary name", async () => {
    paneProcesses([
      [4242, "pts/7", ["/home/u/.opencode/bin/.opencode", "--session=ses_made", "--prompt", "x"]],
    ]);
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).resolves.toEqual({});
  });

  /**
   * M-3: the argv form of the real OpenCode TUI processes in the panes of
   * ao-37 and ao-39 (read from `/proc/<pid>/cmdline` on 2026-10-18; exe
   * `/home/taisung/.opencode/bin/opencode`): the bare name, then the session,
   * then a prompt of many lines in one argument.
   */
  const REAL_TUI_ARGV = [
    "opencode",
    "--session",
    "ses_made",
    "--prompt",
    "You are an AI coding agent managed by the Agent Orchestrator (ao).\n\n## Session Lifecycle\n- Focus on the assigned task.",
  ];

  /** M-3: the review's row, a node preload file named opencode before the main script. */
  const PRELOAD_ARGV = [
    "node",
    "--require",
    "/x/opencode",
    "/x/server.js",
    "--session",
    "ses_made",
  ];

  it.each([
    ["the real TUI argv of ao-37 and ao-39 (M-3)", REAL_TUI_ARGV],
    ["node", ["node", "/usr/lib/node_modules/opencode-ai/bin/opencode", "--session", "ses_made"]],
    ["bun", ["/home/u/.bun/bin/bun", "/x/opencode", "--prompt", "Go", "--session", "ses_made"]],
  ])("accepts the wrapper row %s on tmux (M-1)", async (_name, argv) => {
    paneProcesses([[4242, "pts/7", argv]]);
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).resolves.toEqual({});
  });

  it.each([
    // The review's row: a shell whose -c text only names OpenCode.
    ["a shell -c text", ["/bin/bash", "-c", "sleep 60 opencode --session ses_made"]],
    ["a shell script named opencode", ["/bin/sh", "/tmp/bin/opencode", "--session", "ses_made"]],
    // `-e` takes the code text that follows it; that text is not a script.
    ["node -e with a code text", ["node", "-e", "/x/opencode", "--session", "ses_made"]],
    ["node --eval=", ["node", "--eval=1", "/x/opencode", "--session", "ses_made"]],
    ["node on another script", ["node", "/x/server.js", "/x/opencode", "--session", "ses_made"]],
    // M-3: an interpreter option before the main script; the file after
    // --require, -r, --import or --loader is not the main script.
    ["a node preload named opencode (M-3)", PRELOAD_ARGV],
    [
      "node -r <preload> (M-3)",
      ["node", "-r", "/x/opencode", "/x/server.js", "--session=ses_made"],
    ],
    [
      "node --import <file> (M-3)",
      ["node", "--import", "/x/.opencode", "/x/a.mjs", "--session=ses_made"],
    ],
    [
      "node --loader <file> (M-3)",
      ["node", "--loader", "/x/opencode", "/x/a.mjs", "--session=ses_made"],
    ],
    ["node --require=<preload> (M-3)", ["node", "--require=/x/opencode", "--session", "ses_made"]],
    // M-3: also an option that takes no value hides the main script position.
    [
      "node with any option first (M-3)",
      ["node", "--no-warnings", "/x/bin/.opencode", "--session=ses_made"],
    ],
    ["bun with any option first (M-3)", ["bun", "--smol", "/x/opencode", "--session", "ses_made"]],
    ["the ID only in the prompt text", ["opencode", "--prompt", "use --session ses_made"]],
    ["--session after --", ["opencode", "--", "--session", "ses_made"]],
    ["a binary that only ends in opencode", ["/x/not-opencode", "--session", "ses_made"]],
  ])("rejects %s on tmux (M-1)", async (_name, argv) => {
    paneProcesses([[4242, "pts/7", argv]]);
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).rejects.toThrow(OPENS);
  });

  it("does not count a pane process whose /proc entry is gone", async () => {
    paneProcesses([[4242, "pts/7", ["opencode", "--session", "ses_made"]]]);
    procCmdlines.delete(4242);
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).rejects.toThrow(OPENS);
  });

  it("does not count opencode on another session or in another pane", async () => {
    paneProcesses([
      [4242, "pts/7", ["opencode", "--session", "ses_other"]],
      [4243, "pts/9", ["opencode", "--session", "ses_made"]],
      [4244, "pts/7", ["bash"]],
    ]);
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).rejects.toThrow(OPENS);
  });

  it("does not count a process that exits at once", async () => {
    paneProcesses(
      [[4242, "pts/7", ["opencode", "--session", "ses_made"]]],
      [[4244, "pts/7", ["bash"]]],
    );
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick),
    ).rejects.toThrow("did not run OpenCode on session ses_made");
  });

  it("does not count a process that exits before the settle time", async () => {
    // A 2 s bound gives a 500 ms settle time: two sightings 250 ms apart are too short.
    paneProcesses(
      [[4242, "pts/7", ["opencode", "--session", "ses_made"]]],
      [[4242, "pts/7", ["opencode", "--session", "ses_made"]]],
      [[4244, "pts/7", ["bash"]]],
    );
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), { ...quick, timeoutMs: 2_000 }),
    ).rejects.toThrow("did not run OpenCode on session ses_made within 2 s");
  });

  it("fails at once when the pane is gone", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") {
        return Promise.reject(
          Object.assign(new Error("Command failed"), {
            stderr: "can't find session: abc-sess-1\n",
          }),
        );
      }
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    const started = Date.now();
    await expect(
      agent.confirmLaunch!(tmuxSession(), await preparedSession(), {
        ...quick,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("the pane of sess-1 is gone");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("gives promptDelivered true when the session shows a user message, with the pane environment", async () => {
    paneProcesses([[4242, "pts/7", ["opencode", "--session", "ses_made", "--prompt", "Go"]]]);
    mockHasOpenCodeUserMessage.mockResolvedValueOnce(false).mockResolvedValue(true);

    const result = await agent.confirmLaunch!(tmuxSession(), await preparedSession(), {
      ...quick,
      promptExpected: true,
      promptTimeoutMs: 3_000,
    });

    expect(result).toEqual({ promptDelivered: true });
    expect(mockHasOpenCodeUserMessage).toHaveBeenCalledWith(
      "ses_made",
      expect.objectContaining({ env }),
    );
    // A created session has no baseline: any user message counts.
    expect(mockHasOpenCodeUserMessage.mock.calls[0]![1]).not.toHaveProperty("after");
  });

  it("counts a failed read as not seen yet", async () => {
    paneProcesses([[4242, "pts/7", ["opencode", "--session", "ses_made", "--prompt", "Go"]]]);
    mockHasOpenCodeUserMessage.mockRejectedValueOnce(new Error("HTTP 500")).mockResolvedValue(true);

    const result = await agent.confirmLaunch!(tmuxSession(), await preparedSession(), {
      ...quick,
      promptExpected: true,
      promptTimeoutMs: 3_000,
    });
    expect(result).toEqual({ promptDelivered: true });
  });

  it("gives promptDelivered false when no user message shows within the bound", async () => {
    paneProcesses([[4242, "pts/7", ["opencode", "--session", "ses_made", "--prompt", "Go"]]]);

    const result = await agent.confirmLaunch!(tmuxSession(), await preparedSession(), {
      ...quick,
      promptExpected: true,
    });
    expect(result).toEqual({ promptDelivered: false });
    expect(mockHasOpenCodeUserMessage).toHaveBeenCalled();
  });

  describe("a reused session with older user messages (M-2)", () => {
    /** The session's user messages, newest last, as the service would list them. */
    let messages: Array<{ id: string; created: number }>;

    beforeEach(() => {
      messages = [{ id: "msg_old", created: 1_000 }];
      // The service side of the two helpers: the newest message, and the
      // comparison of core's `hasOpenCodeUserMessage` with `after`.
      mockGetNewestOpenCodeUserMessage.mockImplementation(async () => messages.at(-1) ?? null);
      mockHasOpenCodeUserMessage.mockImplementation(
        async (_id: string, options: { after?: { id: string; created: number } }) => {
          const newest = messages.at(-1);
          if (!options.after) return newest !== undefined;
          return (
            !!newest && newest.id !== options.after.id && newest.created >= options.after.created
          );
        },
      );
      paneProcesses([[4242, "pts/7", ["opencode", "--session", "ses_old", "--prompt", "Go"]]]);
    });

    async function reusedSession(): Promise<PreparedAgentSession> {
      return agent.prepareAgentSession!(
        makeLaunchConfig({
          projectConfig: {
            name: "my-project",
            repo: "owner/repo",
            path: "/workspace/repo",
            defaultBranch: "main",
            sessionPrefix: "my",
            agentConfig: { opencodeSessionId: "ses_old" },
          },
        }),
        { workspacePath: tmpdir(), environment: env },
      );
    }

    const withPrompt = { ...quick, promptExpected: true, promptTimeoutMs: 1_200 };

    it("gives promptDelivered false when only the old message exists", async () => {
      const prepared = await reusedSession();
      const result = await agent.confirmLaunch!(tmuxSession(), prepared, withPrompt);

      expect(result).toEqual({ promptDelivered: false });
      expect(mockGetNewestOpenCodeUserMessage).toHaveBeenCalledWith("ses_old", { env });
      expect(mockHasOpenCodeUserMessage).toHaveBeenCalledWith(
        "ses_old",
        expect.objectContaining({ env, after: { id: "msg_old", created: 1_000 } }),
      );
    });

    it("gives promptDelivered true when a newer message arrives after the pane starts", async () => {
      const prepared = await reusedSession();
      // The TUI submits the launch prompt after the baseline read.
      messages.push({ id: "msg_new", created: 2_000 });
      const result = await agent.confirmLaunch!(tmuxSession(), prepared, withPrompt);

      expect(result).toEqual({ promptDelivered: true });
    });

    it("counts any message when the reused session had none", async () => {
      messages = [];
      const prepared = await reusedSession();
      messages.push({ id: "msg_first", created: 3_000 });
      const result = await agent.confirmLaunch!(tmuxSession(), prepared, withPrompt);

      expect(result).toEqual({ promptDelivered: true });
      expect(mockHasOpenCodeUserMessage.mock.calls[0]![1]).not.toHaveProperty("after");
    });

    it("gives promptDelivered false at once when the baseline read failed", async () => {
      mockGetNewestOpenCodeUserMessage.mockRejectedValue(new Error("HTTP 500"));
      const prepared = await reusedSession();
      messages.push({ id: "msg_new", created: 2_000 });
      const result = await agent.confirmLaunch!(tmuxSession(), prepared, withPrompt);

      expect(result).toEqual({ promptDelivered: false });
      expect(mockHasOpenCodeUserMessage).not.toHaveBeenCalled();
    });
  });

  it("reads the herdr pane processes on the herdr runtime", async () => {
    herdrProcesses([77, ["/home/u/.opencode/bin/opencode", "--session", "ses_made"]]);

    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).resolves.toEqual({});
    expect(mockGetHerdrPaneProcesses).toHaveBeenCalledWith("w8:p1");
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it("accepts the real TUI argv of ao-37 and ao-39 on herdr (M-3)", async () => {
    herdrProcesses([76, ["/bin/zsh"]], [77, REAL_TUI_ARGV]);
    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).resolves.toEqual({});
  });

  it("rejects a node preload named opencode on herdr (M-3)", async () => {
    herdrProcesses([77, PRELOAD_ARGV]);
    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).rejects.toThrow(OPENS);
  });

  it("accepts a node wrapper row on herdr (M-1)", async () => {
    herdrProcesses(
      [76, ["/bin/zsh"]],
      [77, ["node", "/usr/lib/node_modules/opencode-ai/bin/.opencode", "--session", "ses_made"]],
    );
    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).resolves.toEqual({});
  });

  it("rejects the shell row on herdr, also when herdr's flat text looks like opencode (M-1)", async () => {
    procCmdlines.set(77, ["/bin/bash", "-c", "sleep 60 opencode --session ses_made"]);
    mockGetHerdrPaneProcesses.mockResolvedValue([
      { pid: 77, name: "opencode", cmdline: "opencode --session ses_made" },
    ]);
    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).rejects.toThrow(OPENS);
  });

  it("fails when the herdr pane never runs opencode on the session", async () => {
    herdrProcesses([77, ["opencode", "--session", "ses_other"]]);
    await expect(
      agent.confirmLaunch!(herdrSession(), await preparedSession(), quick),
    ).rejects.toThrow("did not run OpenCode on session ses_made");
  });

  it("fails closed on a runtime that it cannot check", async () => {
    const session = makeSession({ id: "sess-1", runtimeHandle: makeProcessHandle(42) });
    await expect(agent.confirmLaunch!(session, await preparedSession(), quick)).rejects.toThrow(
      "cannot check the OpenCode launch on runtime process",
    );
  });

  it("fails without a runtime handle", async () => {
    await expect(
      agent.confirmLaunch!(makeSession({ runtimeHandle: null }), await preparedSession(), quick),
    ).rejects.toThrow("no runtime handle");
  });
});

describe("version gate", () => {
  const agent = create();

  function versionOutput(output: string) {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "opencode") return output;
      throw new Error(`unexpected command: ${cmd}`);
    });
  }

  /** Make the probe fail the way execFileSync fails (the error carries code, status, signal, stdout). */
  function probeFails(fields: Record<string, unknown>) {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error("probe failed"), fields);
    });
  }

  /** The gate runs in prepareAgentSession, before any API call and before the pane (I-3). */
  async function launchError(): Promise<Error | undefined> {
    try {
      await agent.prepareAgentSession!(makeLaunchConfig(), {
        workspacePath: tmpdir(),
        environment: {},
      });
    } catch (err) {
      return err as Error;
    }
    return undefined;
  }

  it.each([
    { output: "opencode v2.0.29\n", label: "the measured floor" },
    { output: "opencode v2.0.30\n", label: "a later patch" },
    { output: "opencode v2.1.0\n", label: "a later minor" },
    { output: "opencode v10.0.0\n", label: "a later major" },
    { output: "2.1.0-beta.1\n", label: "a pre-release past the floor" },
    { output: "opencode v2.0.29+build.7\n", label: "build metadata on the floor" },
    {
      output: "update available 1.2.3\nopencode v2.0.29\n",
      label: "a notice line before the version",
    },
    { output: "opencode v2.1.0 (abc123)\n", label: "text after the version" },
  ])("accepts $label: the launch proceeds and detect() finds it", async ({ output }) => {
    versionOutput(output);
    expect(await launchError()).toBeUndefined();
    expect(mockCreateOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(detect()).toBe(true);
  });

  it.each([
    { output: "1.18.35", label: "1.x" },
    { output: "opencode v2.0.28", label: "one patch below the floor" },
    { output: "opencode v2.0.9", label: "an older 2.x patch" },
    { output: "2.0.29-beta.1", label: "a pre-release of the floor, which semver orders first" },
    { output: "2.0.28-rc.1", label: "a pre-release below the floor" },
    { output: "2.0", label: "a version without a patch" },
    { output: "opencode dev", label: "output without a version number" },
    { output: "built from 2.0.30", label: "a version that does not start the line" },
  ])(
    "refuses $label ($output): the message names the floor and what it found",
    async ({ output }) => {
      versionOutput(`${output}\n`);
      const error = await launchError();
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toContain("2.0.29 or later");
      expect(error!.message).toContain(`found ${output}`);
      // The gate refuses before any API call: no session, no pane.
      expect(mockListOpenCodeModels).not.toHaveBeenCalled();
      expect(mockCreateOpenCodeSession).not.toHaveBeenCalled();
      expect(detect()).toBe(false);
    },
  );

  it("refuses empty output and says the probe printed nothing, not that the binary is missing", async () => {
    versionOutput("\n");
    const error = await launchError();
    expect(error!.message).toContain("printed nothing");
    expect(error!.message).not.toContain("not found");
    expect(detect()).toBe(false);
  });

  it("refuses a missing binary and says it is not on PATH", async () => {
    probeFails({ code: "ENOENT" });
    const error = await launchError();
    expect(error!.message).toContain("2.0.29 or later");
    expect(error!.message).toContain("not found on PATH");
    expect(detect()).toBe(false);
  });

  it("refuses a probe that runs past its bound and says so", async () => {
    probeFails({ code: "ETIMEDOUT", status: null, signal: "SIGKILL" });
    const error = await launchError();
    expect(error!.message).toContain("no answer within");
    expect(detect()).toBe(false);
  });

  it("refuses a failed run even when stdout holds a supported version, and names the status", async () => {
    probeFails({ status: 3, signal: null, stdout: "opencode v2.0.29\n" });
    const error = await launchError();
    expect(error!.message).toContain("exited with status 3");
    expect(error!.message).toContain("opencode v2.0.29");
    expect(error!.message).not.toContain("not found");
    expect(detect()).toBe(false);
  });

  it("refuses a probe stopped by a signal and names the signal", async () => {
    probeFails({ status: null, signal: "SIGTERM" });
    expect((await launchError())!.message).toContain("stopped by SIGTERM");
  });

  it("refuses a binary that cannot run and names the error code", async () => {
    probeFails({ code: "EACCES" });
    expect((await launchError())!.message).toContain("EACCES");
  });

  it("bounds the probe and keeps its stderr off the terminal", async () => {
    expect(await launchError()).toBeUndefined();
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = mockExecFileSync.mock.calls[0] as [
      string,
      string[],
      { timeout?: number; stdio?: unknown[] },
    ];
    expect(cmd).toBe("opencode");
    expect(args).toEqual(["--version"]);
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.stdio?.[2]).toBe("ignore");
  });

  it("keeps the message on one line when the output has several lines", async () => {
    versionOutput("opencode dev\nsecond line\n");
    const message = (await launchError())!.message;
    expect(message).not.toContain("\n");
    expect(message).toContain("opencode dev | second line");
  });
});

describe("version gate on restore", () => {
  const agent = create();
  const project = {
    name: "proj",
    repo: "o/r",
    path: "/p",
    defaultBranch: "main",
    sessionPrefix: "p",
  };

  it("refuses the restore of a known session on an old binary", async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "opencode") return "1.18.35\n";
      throw new Error(`unexpected command: ${cmd}`);
    });
    await expect(
      agent.getRestoreCommand!(
        makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
        project,
      ),
    ).rejects.toThrow("found 1.18.35");
  });

  it("runs one probe when it returns a restore command", async () => {
    mockGetOpenCodeSession.mockResolvedValue({ id: "ses_abc123", title: "AO:test-1" });
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      project,
    );
    expect(cmd).toBe("opencode --session 'ses_abc123'");
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("names the version when an old binary meets a session with no stored ID (M-1)", async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "opencode") return "1.18.35\n";
      throw new Error(`unexpected command: ${cmd}`);
    });
    const restore = agent.getRestoreCommand!(makeSession({ metadata: {} }), project);
    await expect(restore).rejects.toThrow("found 1.18.35");
    await expect(restore).rejects.not.toThrow("no stored OpenCode session ID");
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
  });
});
