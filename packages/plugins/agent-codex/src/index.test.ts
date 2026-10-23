import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GH_WRAPPER,
  GIT_WRAPPER,
  PREFERRED_GH_PATH,
  type Session,
  type RuntimeHandle,
  type AgentLaunchConfig,
  type AgentSpecificConfig,
} from "@aoagents/ao-core";

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockExecFileAsync,
  mockWriteFile,
  mockMkdir,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockStat,
  mockLstat,
  mockOpen,
  mockCreateReadStream,
  mockHomedir,
  mockReadLastJsonlEntry,
  mockAppendFile,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockRename: vi.fn().mockResolvedValue(undefined),
  mockStat: vi.fn(),
  mockLstat: vi.fn(),
  mockOpen: vi.fn(),
  mockCreateReadStream: vi.fn(),
  mockHomedir: vi.fn(() => "/mock/home"),
  mockReadLastJsonlEntry: vi.fn(),
  mockAppendFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => {
  const fn = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { execFile: fn };
});

vi.mock("node:fs/promises", () => ({
  appendFile: mockAppendFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  readdir: mockReaddir,
  rename: mockRename,
  stat: mockStat,
  lstat: mockLstat,
  open: mockOpen,
}));

vi.mock("node:crypto", () => ({
  randomBytes: () => ({ toString: () => "abc123" }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  createReadStream: mockCreateReadStream,
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readLastJsonlEntry: mockReadLastJsonlEntry,
  };
});

import { Readable } from "node:stream";
import {
  create,
  manifest,
  default as defaultExport,
  resolveCodexBinary,
  readCodexScreen,
  _resetSessionFileCache,
} from "./index.js";
import {
  DERIVED_MID_TURN_PASTE_0163,
  DERIVED_SUBMITTED_RUNNING_0163,
  REAL_IDLE_EMPTY_0163,
  REAL_UNSUBMITTED_PASTE_0163,
  REVIEW_B2_NESTED_PROMPT,
  REVIEW_M2_NUMBERED_MESSAGE,
  REVIEW_R2_M1_QUOTED_PROMPT,
  REVIEW_R2_M2_NUMBERED_LIST,
  REVIEW_R2_M3_APPROVAL,
  RUNNING_ROW_0163,
} from "./__fixtures__/panes-0.163.0.js";
import RUNNING_01 from "./__fixtures__/codex-0.163.0-running-01.txt?raw";
import RUNNING_02 from "./__fixtures__/codex-0.163.0-running-02.txt?raw";
import RUNNING_03 from "./__fixtures__/codex-0.163.0-running-03.txt?raw";
import RUNNING_04 from "./__fixtures__/codex-0.163.0-running-04.txt?raw";
import RUNNING_05 from "./__fixtures__/codex-0.163.0-running-05.txt?raw";
import RUNNING_06 from "./__fixtures__/codex-0.163.0-running-06.txt?raw";

/** The six real captures of a running turn (see `__fixtures__/panes-0.163.0.ts`). */
const REAL_RUNNING: Array<[string, string]> = [
  ["01", RUNNING_01],
  ["02", RUNNING_02],
  ["03", RUNNING_03],
  ["04", RUNNING_04],
  ["05", RUNNING_05],
  ["06", RUNNING_06],
];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
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
  mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "tmux" && args[0] === "list-panes") {
      return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
    }
    if (cmd === "ps") {
      const line = found ? `  789 ttys003  ${processName}` : "  789 ttys003  bash";
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n${line}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error(`Unexpected: ${cmd} ${args.join(" ")}`));
  });
}

/**
 * Create a mock file handle for `open()` that returns `content` from `read()`.
 * Used by sessionFileMatchesCwd which reads only the first 4 KB.
 */
function makeFakeFileHandle(content: string) {
  const buf = Buffer.from(content, "utf-8");
  return {
    read: vi
      .fn()
      .mockImplementation((buffer: Buffer, offset: number, length: number, _position: number) => {
        const bytesToCopy = Math.min(length, buf.length);
        buf.copy(buffer, offset, 0, bytesToCopy);
        return Promise.resolve({ bytesRead: bytesToCopy, buffer });
      }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Set up mockOpen so that any `open(path, "r")` call returns a fake handle
 * reading `content`. This is used by sessionFileMatchesCwd.
 */
function setupMockOpen(content: string) {
  mockOpen.mockResolvedValue(makeFakeFileHandle(content));
}

/**
 * Create a Readable stream from a string. Used to mock createReadStream
 * for the streaming JSONL parser (streamCodexSessionData).
 */
function makeContentStream(content: string): Readable {
  return Readable.from(Buffer.from(content, "utf-8"));
}

/**
 * Set up mockCreateReadStream to return a readable stream with the given content.
 * Used by getSessionInfo/getRestoreCommand which now stream files line-by-line.
 */
function setupMockStream(content: string) {
  mockCreateReadStream.mockReturnValue(makeContentStream(content));
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSessionFileCache();
  mockHomedir.mockReturnValue("/mock/home");
  // Default: open() returns a handle with empty content (no session_meta match).
  // Session tests call setupMockOpen(content) to override.
  mockOpen.mockResolvedValue(makeFakeFileHandle(""));
  // Default: lstat rejects (no subdirectories). Session tests override as needed.
  mockLstat.mockRejectedValue(new Error("ENOENT"));
  // Default: createReadStream returns an empty stream. Session tests call
  // setupMockStream(content) to override.
  mockCreateReadStream.mockReturnValue(makeContentStream(""));
});

// =========================================================================
// Manifest & Exports
// =========================================================================
describe("plugin manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "codex",
      slot: "agent",
      description: "Agent plugin: OpenAI Codex CLI",
      version: "0.1.1",
      displayName: "OpenAI Codex",
    });
  });

  it("create() returns agent with correct name and processName", () => {
    const agent = create();
    expect(agent.name).toBe("codex");
    expect(agent.processName).toBe("codex");
  });

  it("default export is a valid PluginModule", () => {
    expect(defaultExport.manifest).toBe(manifest);
    expect(typeof defaultExport.create).toBe("function");
  });
});

// =========================================================================
// getLaunchCommand
// =========================================================================
describe("getLaunchCommand", () => {
  const agent = create();

  it("generates base command", () => {
    expect(agent.getLaunchCommand(makeLaunchConfig())).toBe(
      "'codex' -c check_for_update_on_startup=false",
    );
  });

  it("includes bypass flag when permissions=permissionless", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "permissionless" }));
    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cmd).not.toContain("--ask-for-approval");
    expect(cmd).not.toContain("--full-auto");
  });

  it("treats legacy permissions=skip as permissionless", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ permissions: "skip" as unknown as AgentLaunchConfig["permissions"] }),
    );
    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("includes --ask-for-approval never when permissions=auto-edit", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "auto-edit" }));
    expect(cmd).toContain("--ask-for-approval never");
  });

  it("includes --ask-for-approval untrusted when permissions=suggest", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "suggest" }));
    expect(cmd).toContain("--ask-for-approval untrusted");
  });

  it("omits approval flags when permissions=default", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "default" }));
    expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cmd).not.toContain("--ask-for-approval");
    expect(cmd).not.toContain("--full-auto");
  });

  it("includes --model with shell-escaped value", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "gpt-4o" }));
    expect(cmd).toContain("--model 'gpt-4o'");
  });

  it("appends shell-escaped prompt with -- separator", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix it" }));
    expect(cmd).toContain("-- 'Fix it'");
  });

  it("combines all options", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ permissions: "permissionless", model: "o3", prompt: "Go" }),
    );
    expect(cmd).toBe(
      "'codex' -c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox --model 'o3' -c model_reasoning_effort=high -- 'Go'",
    );
  });

  it("escapes single quotes in prompt (POSIX shell escaping)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's broken" }));
    expect(cmd).toContain("-- 'it'\\''s broken'");
  });

  it("escapes dangerous characters in prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "$(rm -rf /); `evil`; $HOME" }));
    // Single-quoted strings prevent shell expansion
    expect(cmd).toContain("-- '$(rm -rf /); `evil`; $HOME'");
  });

  it("includes -c model_instructions_file when systemPromptFile is set", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md" }));
    expect(cmd).toContain("-c model_instructions_file='/tmp/prompt.md'");
  });

  it("prefers systemPromptFile over systemPrompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md", systemPrompt: "Ignored" }),
    );
    expect(cmd).toContain("model_instructions_file='/tmp/prompt.md'");
    expect(cmd).not.toContain("'Ignored'");
  });

  it("includes -c developer_instructions when systemPrompt is set", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPrompt: "Be helpful" }));
    expect(cmd).toContain("-c developer_instructions='Be helpful'");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cmd).not.toContain("--ask-for-approval");
    expect(cmd).not.toContain("--model");
    expect(cmd).toContain("-c check_for_update_on_startup=false");
    expect(cmd).not.toContain("model_reasoning_effort");
  });

  it("always includes -c check_for_update_on_startup=false", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "gpt-4o", prompt: "Fix it" }));
    expect(cmd).toContain("-c check_for_update_on_startup=false");
  });

  // -- Reasoning effort tests --
  describe("reasoning effort", () => {
    it("adds model_reasoning_effort=high for o3 model", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "o3" }));
      expect(cmd).toContain("-c model_reasoning_effort=high");
    });

    it("adds model_reasoning_effort=high for o3-mini model", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "o3-mini" }));
      expect(cmd).toContain("-c model_reasoning_effort=high");
    });

    it("adds model_reasoning_effort=high for o4-mini model", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "o4-mini" }));
      expect(cmd).toContain("-c model_reasoning_effort=high");
    });

    it("adds model_reasoning_effort=high for O3 (case-insensitive)", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "O3" }));
      expect(cmd).toContain("-c model_reasoning_effort=high");
    });

    it("adds model_reasoning_effort=high for O4-MINI (case-insensitive)", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "O4-MINI" }));
      expect(cmd).toContain("-c model_reasoning_effort=high");
    });

    it("does NOT add reasoning effort for gpt-4o model", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "gpt-4o" }));
      expect(cmd).not.toContain("model_reasoning_effort");
    });

    it("does NOT add reasoning effort for gpt-4.1 model", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "gpt-4.1" }));
      expect(cmd).not.toContain("model_reasoning_effort");
    });

    it("does NOT add reasoning effort when no model specified", () => {
      const cmd = agent.getLaunchCommand(makeLaunchConfig());
      expect(cmd).not.toContain("model_reasoning_effort");
    });
  });
});

// =========================================================================
// getEnvironment
// =========================================================================
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

  it("prepends ~/.ao/bin to PATH for shell wrappers", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["PATH"]).toMatch(/^.*\/\.ao\/bin:/);
  });

  it("PATH starts with the ao bin dir specifically", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["PATH"]?.startsWith("/mock/home/.ao/bin:")).toBe(true);
  });

  it("keeps the inherited order after ~/.ao/bin (no /usr/local/bin promotion)", () => {
    // GH_PATH selects gh; a promoted /usr/local/bin would shadow newer user
    // copies of codex, claude and gemini.
    const originalPath = process.env["PATH"];
    process.env["PATH"] = "/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin";
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      expect(env["PATH"]).toBe(
        "/mock/home/.ao/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin",
      );
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("sets CODEX_DISABLE_UPDATE_CHECK=1 to suppress interactive update prompts", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["CODEX_DISABLE_UPDATE_CHECK"]).toBe("1");
  });

  it("sets GH_PATH to preferred wrapper target", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["GH_PATH"]).toBe(PREFERRED_GH_PATH);
  });

  it("deduplicates ao and /usr/local/bin entries", () => {
    const originalPath = process.env["PATH"];
    process.env["PATH"] = "/mock/home/.ao/bin:/usr/local/bin:/usr/bin:/usr/local/bin";
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      expect(env["PATH"]).toBe("/mock/home/.ao/bin:/usr/local/bin:/usr/bin");
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("falls back to /usr/bin:/bin when process.env.PATH is undefined", () => {
    const originalPath = process.env["PATH"];
    delete process.env["PATH"];
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      expect(env["PATH"]).toBe("/mock/home/.ao/bin:/usr/bin:/bin");
    } finally {
      process.env["PATH"] = originalPath;
    }
  });
});

// =========================================================================
// isProcessRunning
// =========================================================================
describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when codex found on tmux pane TTY", async () => {
    mockTmuxWithProcess("codex");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when codex not on tmux pane TTY", async () => {
    mockTmuxWithProcess("codex", false);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("rejects when tmux list-panes returns empty", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow();
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
    // Must NOT call external commands — could match wrong session
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it("rejects on tmux command failure", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux not running"));
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow();
  });

  // Same-ID R4 (B-7 item 10): false only for the server's answer that the
  // pane does not exist; a tmux or ps that cannot answer rejects with the cause.
  it("rejects 'can't find window', which tmux does not answer for a session-only target (round 3, M-4)", async () => {
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("Command failed: tmux list-panes"), {
        code: 1,
        stderr: "can't find window: test-session\n",
      }),
    );
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow();
    expect(mockExecFileAsync).not.toHaveBeenCalledWith("ps", expect.anything(), expect.anything());
  });

  it("returns false when a server with no session answers 'no current target'", async () => {
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("Command failed: tmux list-panes"), {
        code: 1,
        stderr: "no current target\n",
      }),
    );
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("rejects when no tmux server runs at the socket", async () => {
    const noServer = Object.assign(new Error("Command failed: tmux list-panes"), {
      code: 1,
      stderr: "no server running on /tmp/tmux-1000/default\n",
    });
    mockExecFileAsync.mockRejectedValue(noServer);
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toMatchObject({
      cause: noServer,
    });
  });

  it("rejects with the ps failure as cause when ps cannot run", async () => {
    const psFailure = Object.assign(new Error("Command failed: ps -eo pid,tty,args"), { code: 1 });
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys002\n", stderr: "" });
      return Promise.reject(psFailure);
    });
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toMatchObject({
      message: "codex: ps -eo pid,tty,args failed",
      cause: psFailure,
    });
  });

  // Same-ID R4 round 2 (review r1, M-2): a call that succeeds with a
  // malformed answer proves nothing about the agent, so it rejects. A valid
  // list without the agent stays false.
  const VALID_PS = "    PID TT       COMMAND\n  123 pts/73   /bin/bash\n";
  function mockPaneAnswers(tty: string, ps: string) {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: tty, stderr: "" });
      if (cmd === "ps") return Promise.resolve({ stdout: ps, stderr: "" });
      return Promise.reject(new Error(`Unexpected: ${cmd}`));
    });
  }

  it("rejects when tmux answers text that is not a pane TTY", async () => {
    mockPaneAnswers("unavailable\n", VALID_PS);
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(
      /not a list of pane TTYs/,
    );
    expect(mockExecFileAsync).not.toHaveBeenCalledWith("ps", expect.anything(), expect.anything());
  });

  it("rejects when ps succeeds with a reply that is not a process list", async () => {
    mockPaneAnswers("/dev/pts/73\n", "procfs temporarily unavailable\n");
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  it("rejects when ps answers only its header", async () => {
    mockPaneAnswers("/dev/pts/73\n", "    PID TT       COMMAND\n");
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  it("rejects when one ps row is malformed", async () => {
    mockPaneAnswers("/dev/pts/73\n", `${VALID_PS}ps: output truncated\n`);
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  it("control: a valid list on a Linux pane TTY without codex answers false", async () => {
    mockPaneAnswers("/dev/pts/73\n", VALID_PS);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("control: a valid list with codex on the pane TTY answers true", async () => {
    mockPaneAnswers("/dev/pts/73\n", `${VALID_PS}  124 pts/73   /usr/bin/codex\n`);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  // Same-ID R4 round 3 (review r2, M-2): a PID is a positive safe integer;
  // one row with another PID rejects the whole reply. A valid list without
  // the agent stays false (the control above).
  it("rejects a ps row with PID 0", async () => {
    mockPaneAnswers("/dev/pts/73\n", "    PID TT       COMMAND\n      0 pts/73   /bin/bash\n");
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  it("rejects a ps row with a PID too large to be exact", async () => {
    mockPaneAnswers(
      "/dev/pts/73\n",
      "    PID TT       COMMAND\n999999999999999999999 pts/73   /bin/bash\n",
    );
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  it("rejects a valid list with one more row whose PID is 0", async () => {
    mockPaneAnswers("/dev/pts/73\n", `${VALID_PS}      0 pts/9    /bin/sh\n`);
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(/not a process list/);
  });

  // Same-ID R4 round 3 (review r2, M-4): only a tmux call that ended with
  // exit code 1 and whose whole diagnostic is tmux's missing-target line for
  // this session ("can't find session: test-session", or "no current target")
  // is a missing pane. Every other failure rejects, and no ps runs.
  function tmuxFails(failure: Record<string, unknown>) {
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("Command failed: tmux list-panes"), failure),
    );
  }

  for (const [label, failure] of [
    [
      "the missing-target line names another session",
      { code: 1, stderr: "can't find session: unrelated\n" },
    ],
    [
      "'no current target' comes after another line",
      { code: 1, stderr: "server unavailable\nno current target\n" },
    ],
    [
      "the line for this session comes with another line",
      { code: 1, stderr: "can't find session: test-session\nlost server\n" },
    ],
    [
      "the call was killed (a timeout) with the line for this session",
      { code: null, killed: true, signal: "SIGTERM", stderr: "can't find session: test-session\n" },
    ],
    ["the call has another exit code", { code: 2, stderr: "can't find session: test-session\n" }],
    ["the call has no exit code", { stderr: "can't find session: test-session\n" }],
  ] as const) {
    it(`rejects a tmux failure where ${label}`, async () => {
      tmuxFails(failure);
      await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(
        "tmux list-panes -t =test-session: failed",
      );
      expect(mockExecFileAsync).not.toHaveBeenCalledWith(
        "ps",
        expect.anything(),
        expect.anything(),
      );
    });
  }

  it("control: exit code 1 and 'can't find session: <name>' for this session answer false", async () => {
    tmuxFails({ code: 1, stderr: "can't find session: test-session\n" });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
    expect(mockExecFileAsync).not.toHaveBeenCalledWith("ps", expect.anything(), expect.anything());
  });

  it("rejects with the helper's error, before any tmux or ps call, for a name that is not a safe tmux name", async () => {
    // A pane with codex on it: an answer from tmux would be true.
    mockTmuxWithProcess("codex");
    await expect(agent.isProcessRunning(makeTmuxHandle("bad name"))).rejects.toThrow(
      'Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/',
    );
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it("returns true when PID exists but throws EPERM", async () => {
    const epermErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw epermErr;
    });
    expect(await agent.isProcessRunning(makeProcessHandle(789))).toBe(true);
    killSpy.mockRestore();
  });

  it("finds codex on any pane in multi-pane session", async () => {
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "list-panes") {
        return Promise.resolve({ stdout: "/dev/ttys001\n/dev/ttys002\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  bash\n  200 ttys002  codex --model o3\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("does not match similar process names like codex-something", async () => {
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "list-panes") {
        return Promise.resolve({ stdout: "/dev/ttys001\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  /usr/bin/codex-helper\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("handles string PID by converting to number", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(await agent.isProcessRunning(makeProcessHandle("456"))).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(456, 0);
    killSpy.mockRestore();
  });

  it("returns false for non-numeric PID", async () => {
    expect(await agent.isProcessRunning(makeProcessHandle("not-a-pid"))).toBe(false);
  });
});

// =========================================================================
// detectActivity — terminal output classification
// =========================================================================
describe("detectActivity", () => {
  const agent = create();

  // -- Idle states --
  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("returns idle when last line is a bare > prompt", () => {
    expect(agent.detectActivity("some output\n> ")).toBe("idle");
  });

  it("returns idle when last line is a bare $ prompt", () => {
    expect(agent.detectActivity("some output\n$ ")).toBe("idle");
  });

  it("returns idle when last line is a bare # prompt", () => {
    expect(agent.detectActivity("some output\n# ")).toBe("idle");
  });

  it("returns idle when prompt follows historical activity indicators", () => {
    // Key regression test: historical active output in the buffer
    // should NOT override an idle prompt on the last line.
    expect(agent.detectActivity("✶ Reading files\nDone.\n> ")).toBe("idle");
    expect(agent.detectActivity("Working on task (esc to interrupt)\nFinished.\n$ ")).toBe("idle");
  });

  // -- Waiting input states --
  it("returns waiting_input for approval required text", () => {
    expect(agent.detectActivity("some output\napproval required\n")).toBe("waiting_input");
  });

  it("returns waiting_input for (y)es / (n)o prompt", () => {
    expect(agent.detectActivity("Do you want to continue?\n(y)es / (n)o\n")).toBe("waiting_input");
  });

  it("returns waiting_input when permission prompt follows historical activity", () => {
    // Permission prompt at the bottom should NOT be overridden by historical
    // spinner/esc output higher in the buffer.
    expect(agent.detectActivity("✶ Writing files\nDone.\napproval required\n")).toBe(
      "waiting_input",
    );
    expect(agent.detectActivity("Working (esc to interrupt)\nFinished\n(y)es / (n)o\n")).toBe(
      "waiting_input",
    );
  });

  // -- Active states --
  it("returns active for non-empty terminal output with no special patterns", () => {
    expect(agent.detectActivity("codex is running some task\n")).toBe("active");
  });

  it("returns active when (esc to interrupt) is present", () => {
    expect(agent.detectActivity("Working on task (esc to interrupt)\n")).toBe("active");
  });

  it("returns active for spinner symbols with -ing words", () => {
    expect(agent.detectActivity("✶ Reading files\n")).toBe("active");
    expect(agent.detectActivity("⏺ Writing to disk\n")).toBe("active");
    expect(agent.detectActivity("✽ Searching codebase\n")).toBe("active");
    expect(agent.detectActivity("⏳ Installing packages\n")).toBe("active");
  });

  it("returns active (not idle) for spinner symbol without -ing word", () => {
    // Spinner symbols alone without -ing words should still fall through to active
    expect(agent.detectActivity("✶ done\n")).toBe("active");
  });

  it("returns active for multi-line output with activity in the middle", () => {
    expect(agent.detectActivity("Starting\n(esc to interrupt)\nstill going\n")).toBe("active");
  });
});

// =========================================================================
// detectActivity — Codex 0.163.0 screens (src/__fixtures__/panes-0.163.0.ts)
// =========================================================================
describe("detectActivity on Codex 0.163.0 screens", () => {
  const agent = create();

  /** The composer, status line and footer of the real idle capture (its last 4 lines). */
  const IDLE_BOTTOM = REAL_IDLE_EMPTY_0163.trimEnd().split("\n").slice(-4);

  /** Indented transcript lines with `row` at `distance` lines above the composer, then IDLE_BOTTOM. */
  function screenWithRowAbove(row: string, distance: number): string {
    const transcript = Array.from({ length: 12 }, (_, i) => `  transcript line ${i + 1}`);
    transcript[transcript.length - distance] = row;
    return [...transcript, ...IDLE_BOTTOM].join("\n");
  }

  /** The screen as `detectActivity` reads it, and the parser's answer: the two must agree. */
  function readBoth(screen: string): [string, boolean] {
    return [agent.detectActivity(screen), readCodexScreen(screen).runningTurn];
  }

  it("returns idle for the real idle screen (placeholder and '? for shortcuts' footer)", () => {
    expect(agent.detectActivity(REAL_IDLE_EMPTY_0163)).toBe("idle");
  });

  it.each(REAL_RUNNING)(
    "returns active for real running capture %s, and the parser reads a running turn",
    (_n, capture) => {
      expect(readBoth(capture)).toEqual(["active", true]);
    },
  );

  it("returns idle for the real screen whose composer holds an unsubmitted paste", () => {
    // Text in the composer with no running-turn row is not a running turn:
    // the paste waits for an Enter.
    expect(agent.detectActivity(REAL_UNSUBMITTED_PASTE_0163)).toBe("idle");
  });

  it("returns active when the running-turn row is above a composer that holds text", () => {
    expect(agent.detectActivity(DERIVED_MID_TURN_PASTE_0163)).toBe("active");
  });

  it("returns active when the running-turn row is above the empty composer", () => {
    expect(agent.detectActivity(DERIVED_SUBMITTED_RUNNING_0163)).toBe("active");
  });

  it("returns waiting_input for an approval prompt in the tail, before it reads the composer", () => {
    const lines = REAL_IDLE_EMPTY_0163.trimEnd().split("\n");
    const prompt = lines.length - IDLE_BOTTOM.length;
    const withApproval = (text: string): string =>
      [...lines.slice(0, prompt), text, ...lines.slice(prompt)].join("\n");

    expect(agent.detectActivity(withApproval("  approval required"))).toBe("waiting_input");
    expect(agent.detectActivity(withApproval("  Run pnpm test? (y)es / (n)o"))).toBe(
      "waiting_input",
    );
  });

  it("returns idle when an old running-turn row is in the scrollback far above the composer", () => {
    expect(agent.detectActivity(`${RUNNING_ROW_0163}\n${REAL_IDLE_EMPTY_0163}`)).toBe("idle");
  });

  it("reads the running-turn row only in the status block directly above the composer", () => {
    expect(agent.detectActivity(screenWithRowAbove(RUNNING_ROW_0163, 1))).toBe("active");
    expect(agent.detectActivity(screenWithRowAbove(RUNNING_ROW_0163, 2))).toBe("idle");
    expect(agent.detectActivity(screenWithRowAbove(RUNNING_ROW_0163, 8))).toBe("idle");

    // Blank rows: up to two, as in every real running capture.
    const withBlanks = (blanks: number): string =>
      screenWithRowAbove(RUNNING_ROW_0163, 1).replace(
        `${RUNNING_ROW_0163}\n`,
        `${RUNNING_ROW_0163}\n${"\n".repeat(blanks)}`,
      );
    expect(readBoth(withBlanks(1))).toEqual(["active", true]);
    expect(readBoth(withBlanks(2))).toEqual(["active", true]);
    expect(readBoth(withBlanks(3))).toEqual(["idle", false]);
  });

  it("returns idle for a status block with a row of another kind above the composer", () => {
    // Derived from real capture 02: one row that is not a "└" row and not
    // blank between the Tip row and the two blank rows, or in place of the
    // Tip row. The status row is then a row of the transcript.
    const tip = "  └ Tip: Type / to open the command popup; Tab autocompletes slash commands.\n";
    expect(RUNNING_02).toContain(tip);
    for (const other of ["    + Show details", "  Worked for 1s", "  the turn ended"]) {
      expect(readBoth(RUNNING_02.replace(tip, `${tip}${other}\n`))).toEqual(["idle", false]);
      expect(readBoth(RUNNING_02.replace(tip, `${other}\n`))).toEqual(["idle", false]);
    }
  });

  it("never reads the words of transcript rows as a running turn, with or without a 'Worked for' line", () => {
    const working = REAL_IDLE_EMPTY_0163.replace(
      "  were cleaned up. No commit or PR created, as required by the brief.",
      "  Working tree clean. Running the suite again changed nothing.",
    );
    expect(working).not.toBe(REAL_IDLE_EMPTY_0163);
    expect(agent.detectActivity(working)).toBe("idle");

    const noTurnEnd = working.replace(/\n {2}Worked for 18m 30s • 1:56 PM\n/, "\n");
    expect(noTurnEnd).not.toBe(working);
    expect(agent.detectActivity(noTurnEnd)).toBe("idle");
  });

  it("never reads the composer text or the footer as activity", () => {
    const busyWords = REAL_UNSUBMITTED_PASTE_0163.replace(
      "› Your .agent_task.md is replaced",
      "› Working (5m 47s • esc to interrupt) Running Thinking",
    );
    expect(busyWords).not.toBe(REAL_UNSUBMITTED_PASTE_0163);
    expect(agent.detectActivity(busyWords)).toBe("idle");
  });

  it("does not read the numbered cursor row of a selection list as the composer", () => {
    // Derived from strings in the 0.163.0 binary, not captured: an approval
    // view draws numbered rows, and keys typed into it choose an option.
    const approvalView = [
      ...REAL_IDLE_EMPTY_0163.trimEnd().split("\n").slice(0, -4),
      "  Would you like to run the following command?",
      "",
      "  $ pnpm test",
      "",
      "› 1. Yes, proceed (y)",
      "  2. No, and tell Codex what to do differently (esc)",
    ].join("\n");
    expect(agent.detectActivity(approvalView)).not.toBe("idle");

    // The cursor on the second option: the numbered row above it is an option row.
    const secondOption = approvalView
      .replace("› 1. Yes, proceed (y)", "  1. Yes, proceed (y)")
      .replace("  2. No, and tell", "› 2. No, and tell");
    expect(secondOption).not.toBe(approvalView);
    expect(agent.detectActivity(secondOption)).not.toBe("idle");

    // The same view with no key hints: the "Yes," and "No," labels still
    // make it a selection list, so the stricter rule of review r2 M-2 does
    // not read it as an idle composer.
    const noKeyHints = approvalView.replace(" (y)", "").replace(" (esc)", "");
    expect(noKeyHints).not.toBe(approvalView);
    expect(agent.detectActivity(noKeyHints)).not.toBe("idle");
  });

  it("M-2: reads a composer whose text starts with '1. ' as a composer when no option row is next to it", () => {
    expect(agent.detectActivity(REVIEW_M2_NUMBERED_MESSAGE)).toBe("idle");
  });

  it("B-2: returns active for a running turn whose composer quotes a transcript", () => {
    // The indented "›" row and the "Worked for" row are message text below
    // the composer's prompt row; the running-turn row is directly above it.
    expect(agent.detectActivity(REVIEW_B2_NESTED_PROMPT)).toBe("active");
  });

  it("never reads a running-turn row in the composer text, also below an indented prompt row", () => {
    // The composer of the unsubmitted capture holds a message that quotes a
    // running-turn row and a prompt row; no turn runs.
    const lines = REAL_UNSUBMITTED_PASTE_0163.trimEnd().split("\n");
    const quoted = [
      ...lines.slice(0, 3),
      "› why does this pane say:",
      `  ${RUNNING_ROW_0163}`,
      "  › draft",
      ...lines.slice(-3),
    ].join("\n");
    expect(agent.detectActivity(quoted)).toBe("idle");
  });

  it("reads no running turn above a 'Worked for' row, also when the composer text quotes a prompt row", () => {
    // Derived: the running-turn row is a row of the transcript here, not the
    // status row directly above the composer. A quoted prompt row in the
    // composer text does not change that.
    const quoted = [
      RUNNING_ROW_0163,
      "  Worked for 1s",
      "› examine this transcript",
      "  › examine this transcript",
      "  tab to queue message",
    ].join("\n");
    expect(agent.detectActivity(quoted)).toBe("idle");

    const plain = quoted.replace("  › examine this transcript", "  and say what it shows");
    expect(plain).not.toBe(quoted);
    expect(agent.detectActivity(plain)).toBe("idle");
  });

  it("review r2 M-1: returns idle for a composer that quotes a prompt row below a finished turn", () => {
    expect(readBoth(REVIEW_R2_M1_QUOTED_PROMPT)).toEqual(["idle", false]);
  });

  it("review r2 M-2: returns idle for a composer that holds a two-item numbered message", () => {
    expect(readBoth(REVIEW_R2_M2_NUMBERED_LIST)).toEqual(["idle", false]);
  });

  it("review r2 M-3: returns waiting_input for an approval prompt, and the parser reads no running turn", () => {
    // detectActivity gave waiting_input at 4128c5a8 too; the parser that
    // `ao send` also reads gave a running turn there.
    expect(readBoth(REVIEW_R2_M3_APPROVAL)).toEqual(["waiting_input", false]);
  });

  it("keeps the controls: the B-2 screen, the real running row and the two captured idle screens", () => {
    // REAL_IDLE_EMPTY_0163 has the idle layout: "Worked for 18m 30s • 1:56 PM"
    // and two blank rows above the composer.
    expect(REAL_IDLE_EMPTY_0163).toContain("  Worked for 18m 30s • 1:56 PM\n\n\n› Ask Codex");
    expect(readBoth(REVIEW_B2_NESTED_PROMPT)).toEqual(["active", true]);
    expect(readBoth(DERIVED_MID_TURN_PASTE_0163)).toEqual(["active", true]);
    expect(readBoth(DERIVED_SUBMITTED_RUNNING_0163)).toEqual(["active", true]);
    expect(readBoth(REAL_IDLE_EMPTY_0163)).toEqual(["idle", false]);
    expect(readBoth(REAL_UNSUBMITTED_PASTE_0163)).toEqual(["idle", false]);
  });

  it("keeps the older forms: a bare prompt and the 'tab to queue message' footer", () => {
    expect(agent.detectActivity("some output\n› ")).toBe("idle");
    expect(agent.detectActivity("output\n› draft\ntab to queue message")).toBe("idle");
  });
});

// =========================================================================
// recordActivity + getActivityState — the real running captures
// =========================================================================
describe("recordActivity and getActivityState on Codex 0.163.0 screens", () => {
  const agent = create();
  const session = makeSession({
    runtimeHandle: makeTmuxHandle(),
    workspacePath: "/workspace/test",
  });
  const logPath = "/workspace/test/.ao/activity.jsonl";

  /**
   * Keep the AO activity log in memory: `appendFile` adds to it and `open`
   * reads it, so the activity-log code of core runs unchanged. The process
   * is alive, and Codex has no native session JSONL.
   */
  function useMemoryActivityLog(): void {
    let log = "";
    let mtime = new Date();
    mockTmuxWithProcess("codex");
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    mockAppendFile.mockImplementation(async (path: string, data: string) => {
      if (path !== logPath) throw new Error(`Unexpected appendFile: ${path}`);
      log += data;
      mtime = new Date();
    });
    mockOpen.mockImplementation(async (path: string) => {
      if (path !== logPath) return makeFakeFileHandle("");
      if (log === "") throw new Error("ENOENT");
      const buf = Buffer.from(log, "utf-8");
      return {
        stat: async () => ({ size: buf.length, mtime }),
        read: async (buffer: Buffer, offset: number, length: number, position: number) => {
          const bytesRead = buf.copy(buffer, offset, position, position + length);
          return { bytesRead, buffer };
        },
        close: async () => {},
      };
    });
  }

  afterEach(() => {
    // The other tests keep the default: appendFile resolves.
    mockAppendFile.mockReset().mockResolvedValue(undefined);
  });

  /** The state of each entry that recordActivity appended to the log. */
  function recordedStates(): string[] {
    return mockAppendFile.mock.calls.map(
      (call) => (JSON.parse(String(call[1])) as { state: string }).state,
    );
  }

  it.each(REAL_RUNNING)(
    "records and returns active for real running capture %s (no native JSONL)",
    async (_n, capture) => {
      useMemoryActivityLog();
      await agent.recordActivity!(session, capture);
      const state = (await agent.getActivityState(session))?.state;
      expect([recordedStates(), state]).toEqual([["active"], "active"]);
    },
  );

  it("records and returns idle for the real idle capture (control)", async () => {
    useMemoryActivityLog();
    await agent.recordActivity!(session, REAL_IDLE_EMPTY_0163);
    const state = (await agent.getActivityState(session))?.state;
    expect([recordedStates(), state]).toEqual([["idle"], "idle"]);
  });
});

// =========================================================================
// getActivityState
// =========================================================================
describe("getActivityState", () => {
  const agent = create();

  it("returns exited when no runtimeHandle", async () => {
    const session = makeSession({ runtimeHandle: null });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("exited");
    expect(result?.timestamp).toBeInstanceOf(Date);
  });

  it("rejects when the process check cannot run", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux not running"));
    const session = makeSession({ runtimeHandle: makeTmuxHandle() });
    await expect(agent.getActivityState(session)).rejects.toThrow();
  });

  it("returns null when process is running but no workspacePath", async () => {
    mockTmuxWithProcess("codex");
    const session = makeSession({ runtimeHandle: makeTmuxHandle(), workspacePath: undefined });
    expect(await agent.getActivityState(session)).toBeNull();
  });

  it("returns null when process is running but no session file found", async () => {
    mockTmuxWithProcess("codex");
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    expect(await agent.getActivityState(session)).toBeNull();
  });

  it("returns active when session file was recently modified", async () => {
    mockTmuxWithProcess("codex");
    const content = '{"type":"session_meta","cwd":"/workspace/test"}\n';
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    mockStat.mockResolvedValue({ mtimeMs: Date.now(), mtime: new Date() });
    // Mock readLastJsonlEntry to return a recent entry
    mockReadLastJsonlEntry.mockResolvedValue({
      lastType: "tool_call",
      modifiedAt: new Date(),
    });

    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("active");
    expect(result?.timestamp).toBeInstanceOf(Date);
  });

  it("returns idle when session file is stale", async () => {
    mockTmuxWithProcess("codex");
    const content = '{"type":"session_meta","cwd":"/workspace/test"}\n';
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    const staleTime = Date.now() - 600_000;
    mockStat.mockResolvedValue({ mtimeMs: staleTime, mtime: new Date(staleTime) });
    // Mock readLastJsonlEntry to return a stale entry
    mockReadLastJsonlEntry.mockResolvedValue({
      lastType: "assistant_message",
      modifiedAt: new Date(staleTime),
    });

    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("idle");
    expect(result?.timestamp).toBeInstanceOf(Date);
  });

  it("returns waiting_input for approval_request entry type", async () => {
    mockTmuxWithProcess("codex");
    const content = '{"type":"session_meta","cwd":"/workspace/test"}\n';
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    mockStat.mockResolvedValue({ mtimeMs: Date.now(), mtime: new Date() });
    mockReadLastJsonlEntry.mockResolvedValue({
      lastType: "approval_request",
      modifiedAt: new Date(),
    });

    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("waiting_input");
  });

  it("returns blocked for error entry type", async () => {
    mockTmuxWithProcess("codex");
    const content = '{"type":"session_meta","cwd":"/workspace/test"}\n';
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    mockStat.mockResolvedValue({ mtimeMs: Date.now(), mtime: new Date() });
    mockReadLastJsonlEntry.mockResolvedValue({
      lastType: "error",
      modifiedAt: new Date(),
    });

    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("blocked");
  });

  it("returns ready for assistant_message entry type", async () => {
    mockTmuxWithProcess("codex");
    const content = '{"type":"session_meta","cwd":"/workspace/test"}\n';
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    mockStat.mockResolvedValue({ mtimeMs: Date.now(), mtime: new Date() });
    mockReadLastJsonlEntry.mockResolvedValue({
      lastType: "assistant_message",
      modifiedAt: new Date(),
    });

    const session = makeSession({
      runtimeHandle: makeTmuxHandle(),
      workspacePath: "/workspace/test",
    });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("ready");
  });

  // Real Codex wraps the semantic type in payload.type on event_msg records.
  // Before payloadType was honored these all matched the generic `event_msg`
  // case and decayed to ready/idle, so waiting_input/blocked never surfaced.
  describe("payload-wrapped event_msg records", () => {
    function mockPayloadEntry(payloadType: string, modifiedAt = new Date()) {
      mockTmuxWithProcess("codex");
      mockReaddir.mockResolvedValue(["sess.jsonl"]);
      setupMockOpen('{"type":"session_meta","cwd":"/workspace/test"}\n');
      mockStat.mockResolvedValue({ mtimeMs: modifiedAt.getTime(), mtime: modifiedAt });
      mockReadLastJsonlEntry.mockResolvedValue({
        lastType: "event_msg",
        payloadType,
        modifiedAt,
      });
      return makeSession({
        runtimeHandle: makeTmuxHandle(),
        workspacePath: "/workspace/test",
      });
    }

    it.each([
      ["approval_request", "waiting_input"],
      ["exec_approval_request", "waiting_input"],
      ["apply_patch_approval_request", "waiting_input"],
      ["error", "blocked"],
      ["stream_error", "blocked"],
    ])("classifies payload.type=%s as %s", async (payloadType, expected) => {
      const session = mockPayloadEntry(payloadType);
      const result = await agent.getActivityState(session);
      expect(result?.state).toBe(expected);
    });

    it.each(["task_started", "agent_reasoning", "exec_command_begin", "exec_command_end"])(
      "classifies fresh payload.type=%s as active",
      async (payloadType) => {
        const session = mockPayloadEntry(payloadType);
        const result = await agent.getActivityState(session);
        expect(result?.state).toBe("active");
      },
    );

    it.each(["task_complete", "turn_aborted", "agent_message", "token_count"])(
      "classifies fresh payload.type=%s as ready",
      async (payloadType) => {
        const session = mockPayloadEntry(payloadType);
        const result = await agent.getActivityState(session);
        expect(result?.state).toBe("ready");
      },
    );

    it("still decays a stale approval-free payload to idle", async () => {
      const stale = new Date(Date.now() - 600_000);
      const session = mockPayloadEntry("task_complete", stale);
      const result = await agent.getActivityState(session);
      expect(result?.state).toBe("idle");
    });

    it("surfaces waiting_input even when the approval entry is stale", async () => {
      // An approval prompt does not stop being a prompt because it is old —
      // this is exactly the stuck-worker case the dashboard must report.
      const stale = new Date(Date.now() - 600_000);
      const session = mockPayloadEntry("approval_request", stale);
      const result = await agent.getActivityState(session);
      expect(result?.state).toBe("waiting_input");
    });

    it("falls back to the envelope type when payloadType is absent", async () => {
      mockTmuxWithProcess("codex");
      mockReaddir.mockResolvedValue(["sess.jsonl"]);
      setupMockOpen('{"type":"session_meta","cwd":"/workspace/test"}\n');
      mockStat.mockResolvedValue({ mtimeMs: Date.now(), mtime: new Date() });
      mockReadLastJsonlEntry.mockResolvedValue({
        lastType: "tool_call",
        payloadType: null,
        modifiedAt: new Date(),
      });

      const session = makeSession({
        runtimeHandle: makeTmuxHandle(),
        workspacePath: "/workspace/test",
      });
      const result = await agent.getActivityState(session);
      expect(result?.state).toBe("active");
    });
  });

  it("returns exited when process handle has dead PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const session = makeSession({ runtimeHandle: makeProcessHandle(999) });
    const result = await agent.getActivityState(session);
    expect(result?.state).toBe("exited");
    expect(result?.timestamp).toBeInstanceOf(Date);
    killSpy.mockRestore();
  });
});

// =========================================================================
// getSessionInfo — Codex JSONL parsing
// =========================================================================
describe("getSessionInfo", () => {
  const agent = create();

  // Helper to build JSONL content from lines
  function jsonl(...lines: Record<string, unknown>[]): string {
    return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  }

  it("returns null when workspacePath is null", async () => {
    expect(await agent.getSessionInfo(makeSession({ workspacePath: null }))).toBeNull();
  });

  it("returns null when workspacePath is undefined", async () => {
    expect(await agent.getSessionInfo(makeSession({ workspacePath: undefined }))).toBeNull();
  });

  it("returns null when ~/.codex/sessions/ directory does not exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("returns null when sessions directory is empty", async () => {
    mockReaddir.mockResolvedValue([]);
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("returns null when no session files match the workspace cwd", async () => {
    mockReaddir.mockResolvedValue(["session-abc.jsonl"]);
    const content = jsonl({ type: "session_meta", cwd: "/other/workspace", model: "gpt-4o" });
    setupMockOpen(content);
    mockReadFile.mockResolvedValue(content);
    expect(
      await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" })),
    ).toBeNull();
  });

  it("returns session info with cost and model when matching session found", async () => {
    const sessionContent = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "o3-mini" },
      {
        type: "event_msg",
        msg: {
          type: "token_count",
          input_tokens: 1000,
          output_tokens: 500,
          cached_tokens: 200,
          reasoning_tokens: 100,
        },
      },
      {
        type: "event_msg",
        msg: {
          type: "token_count",
          input_tokens: 2000,
          output_tokens: 300,
          cached_tokens: 0,
          reasoning_tokens: 0,
        },
      },
    );

    mockReaddir.mockResolvedValue(["session-123.jsonl"]);
    setupMockOpen(sessionContent);
    setupMockStream(sessionContent);
    mockReadFile.mockResolvedValue(sessionContent);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));

    expect(result).not.toBeNull();
    expect(result!.agentSessionId).toBe("session-123");
    expect(result!.summary).toBe("Codex session (o3-mini)");
    expect(result!.summaryIsFallback).toBe(true);
    expect(result!.cost).toBeDefined();
    // cached_tokens/reasoning_tokens are subsets, not additive
    // input: 1000 + 2000 = 3000
    // output: 500 + 300 = 800
    expect(result!.cost!.inputTokens).toBe(3000);
    expect(result!.cost!.outputTokens).toBe(800);
    expect(result!.cost!.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("picks the most recently modified matching session file", async () => {
    const oldContent = jsonl({ type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" });
    const newContent = jsonl({ type: "session_meta", cwd: "/workspace/test", model: "o3" });

    mockReaddir.mockResolvedValue(["old-session.jsonl", "new-session.jsonl"]);
    mockOpen.mockImplementation(async (path: string) => {
      if (path.includes("old-session")) return makeFakeFileHandle(oldContent);
      if (path.includes("new-session")) return makeFakeFileHandle(newContent);
      throw new Error("ENOENT");
    });
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("old-session")) return Promise.resolve(oldContent);
      if (path.includes("new-session")) return Promise.resolve(newContent);
      return Promise.reject(new Error("ENOENT"));
    });
    mockCreateReadStream.mockImplementation((path: string) => {
      if (path.includes("old-session")) return makeContentStream(oldContent);
      if (path.includes("new-session")) return makeContentStream(newContent);
      return makeContentStream("");
    });
    mockStat.mockImplementation((path: string) => {
      if (path.includes("old-session")) return Promise.resolve({ mtimeMs: 1000 });
      if (path.includes("new-session")) return Promise.resolve({ mtimeMs: 2000 });
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));

    expect(result).not.toBeNull();
    expect(result!.agentSessionId).toBe("new-session");
    expect(result!.summary).toBe("Codex session (o3)");
  });

  it("handles corrupt/malformed JSONL lines gracefully", async () => {
    const content =
      '{"type":"session_meta","cwd":"/workspace/test","model":"gpt-4o"}\n' +
      "not valid json\n" +
      '{"type":"event_msg","msg":{"type":"token_count","input_tokens":500,"output_tokens":200}}\n';

    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));

    expect(result).not.toBeNull();
    expect(result!.cost!.inputTokens).toBe(500);
    expect(result!.cost!.outputTokens).toBe(200);
  });

  it("returns null summary when no model in session_meta", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test" },
      { type: "event_msg", msg: { type: "token_count", input_tokens: 100, output_tokens: 50 } },
    );

    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));

    expect(result).not.toBeNull();
    expect(result!.summary).toBeNull();
    // Verify cost was actually parsed from the stream (not just defaulting to undefined)
    expect(result!.cost).toBeDefined();
    expect(result!.cost!.inputTokens).toBe(100);
    expect(result!.cost!.outputTokens).toBe(50);
  });

  it("returns undefined cost when no token_count events", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { type: "event_msg", msg: { type: "other_event" } },
    );

    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));

    expect(result).not.toBeNull();
    expect(result!.cost).toBeUndefined();
    // Verify model was actually parsed from the stream (not just defaulting to null)
    expect(result!.summary).toContain("gpt-4o");
  });

  it("handles unreadable session files gracefully", async () => {
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    // open() finds matching session_meta, but readFile fails for full parse
    setupMockOpen(jsonl({ type: "session_meta", cwd: "/workspace/test" }));
    mockStat.mockResolvedValue({ mtimeMs: 1000 });
    mockReadFile.mockRejectedValue(new Error("EACCES"));
    mockCreateReadStream.mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(
      await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" })),
    ).toBeNull();
  });

  it("skips session files when stat throws", async () => {
    const content = jsonl({ type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" });
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockRejectedValue(new Error("EACCES"));

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));
    // stat failed so no bestMatch can be established
    expect(result).toBeNull();
  });

  it("returns null when session JSONL has only empty/malformed lines", async () => {
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    // open() finds matching session_meta for cwd check
    setupMockOpen(jsonl({ type: "session_meta", cwd: "/workspace/test" }));
    // readFile (full parse) returns only garbage
    mockReadFile.mockResolvedValue("not json\n\n   \n");
    setupMockStream("not json\n\n   \n");
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));
    // With streaming parser, garbage lines are skipped gracefully and a result
    // is returned with null summary and undefined cost (no valid data extracted).
    expect(result).not.toBeNull();
    expect(result!.summary).toBeNull();
    expect(result!.cost).toBeUndefined();
  });

  it("finds session files in date-sharded subdirectories (YYYY/MM/DD)", async () => {
    // Simulate ~/.codex/sessions/2026/02/24/rollout-abc.jsonl
    mockReaddir.mockImplementation((dir: string) => {
      if (dir.endsWith("sessions")) return Promise.resolve(["2026"]);
      if (dir.endsWith("2026")) return Promise.resolve(["02"]);
      if (dir.endsWith("02")) return Promise.resolve(["24"]);
      if (dir.endsWith("24")) return Promise.resolve(["rollout-abc.jsonl"]);
      return Promise.resolve([]);
    });
    // lstat is used by collectJsonlFiles to check subdirectories (avoids symlink cycles)
    mockLstat.mockResolvedValue({ isDirectory: () => true });
    // stat is used by findCodexSessionFile to get mtimeMs of matching JSONL files
    mockStat.mockResolvedValue({ mtimeMs: 2000 });
    const content = jsonl({ type: "session_meta", cwd: "/workspace/test", model: "o3-mini" });
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));
    expect(result).not.toBeNull();
    expect(result!.agentSessionId).toBe("rollout-abc");
    expect(result!.summary).toBe("Codex session (o3-mini)");
  });

  it("ignores non-JSONL files in sessions directory", async () => {
    mockReaddir.mockResolvedValue(["notes.txt", "config.json", "sess.jsonl"]);
    const content = jsonl({ type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" });
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    // Non-JSONL entries trigger lstat to check isDirectory()
    mockLstat.mockResolvedValue({ isDirectory: () => false });
    // stat is used to get mtimeMs for matching JSONL files
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const result = await agent.getSessionInfo(makeSession({ workspacePath: "/workspace/test" }));
    expect(result).not.toBeNull();
    // With streaming parser, readFile is no longer used for full parse;
    // cwd check uses open(), data extraction uses createReadStream.
    const readFileCalls = mockReadFile.mock.calls.filter(
      (call: string[]) => typeof call[0] === "string" && call[0].includes("sessions/"),
    );
    expect(readFileCalls.length).toBe(0); // streaming replaces readFile for full parse
  });
});

// =========================================================================
// getRestoreCommand — conversation resume
// =========================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  function jsonl(...lines: Record<string, unknown>[]): string {
    return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  }

  function makeProjectConfig(overrides: Record<string, unknown> = {}) {
    return {
      name: "test-project",
      repo: "owner/repo",
      path: "/workspace/repo",
      defaultBranch: "main",
      sessionPrefix: "test",
      ...overrides,
    };
  }

  it("returns null when workspacePath is null", async () => {
    const session = makeSession({ workspacePath: null });
    expect(await agent.getRestoreCommand!(session, makeProjectConfig())).toBeNull();
  });

  it("returns null when workspacePath is undefined", async () => {
    const session = makeSession({ workspacePath: undefined });
    expect(await agent.getRestoreCommand!(session, makeProjectConfig())).toBeNull();
  });

  it("returns null when no matching session file found", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const session = makeSession({ workspacePath: "/workspace/test" });
    expect(await agent.getRestoreCommand!(session, makeProjectConfig())).toBeNull();
  });

  it("returns null when session has no threadId", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { role: "user", content: "Some prompt" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    // Native resume requires a threadId
    expect(await agent.getRestoreCommand!(session, makeProjectConfig())).toBeNull();
  });

  it("builds native resume command with codex resume <threadId>", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-abc-123" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(session, makeProjectConfig());

    expect(cmd).not.toBeNull();
    expect(cmd).toContain("'codex' resume");
    expect(cmd).toContain("-c check_for_update_on_startup=false");
    expect(cmd).toContain("thread-abc-123");
  });

  it("includes bypass flag when project config permissions=permissionless", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "permissionless" },
      }),
    );

    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cmd).not.toContain("--ask-for-approval");
  });

  it("treats legacy project config permissions=skip as permissionless", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "skip" as unknown as AgentSpecificConfig["permissions"] },
      }),
    );

    expect(cmd).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("includes --ask-for-approval never from project config", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "auto-edit" },
      }),
    );

    expect(cmd).toContain("--ask-for-approval never");
    expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("includes --ask-for-approval untrusted from project config", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "suggest" },
      }),
    );

    expect(cmd).toContain("--ask-for-approval untrusted");
  });

  it("maps a stored suggest mode to --ask-for-approval untrusted on restore", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "suggest" },
      }),
    );

    expect(cmd).toContain("--ask-for-approval untrusted");
    expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("places flags before positional threadId in resume command", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "o3-mini" },
      { threadId: "thread-order-test" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { permissions: "auto-edit", model: "o3-mini" },
      }),
    );

    expect(cmd).not.toBeNull();
    // threadId should come after all flags
    const threadIdIdx = cmd!.indexOf("thread-order-test");
    const flagIdx = cmd!.indexOf("--ask-for-approval");
    const modelIdx = cmd!.indexOf("--model");
    expect(flagIdx).toBeLessThan(threadIdIdx);
    expect(modelIdx).toBeLessThan(threadIdIdx);
  });

  it("includes model from project config (overrides session model)", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({
        agentConfig: { model: "o3-mini" },
      }),
    );

    expect(cmd).toContain("--model 'o3-mini'");
    expect(cmd).toContain("-c model_reasoning_effort=high");
  });

  it("falls back to session model when project config has no model", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "o4-mini" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(session, makeProjectConfig());

    expect(cmd).toContain("--model 'o4-mini'");
    expect(cmd).toContain("-c model_reasoning_effort=high");
  });

  it("prefers the effective (persisted spawn) model over config and session models", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test", model: "gpt-4o" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(
      session,
      makeProjectConfig({ agentConfig: { model: "config-model" } }),
      "spawn-model-X",
    );

    expect(cmd).toContain("--model 'spawn-model-X'");
    expect(cmd).not.toContain("config-model");
    expect(cmd).not.toContain("gpt-4o");
  });

  it("uses the effective model when config and session models are absent", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    const cmd = await agent.getRestoreCommand!(session, makeProjectConfig(), "spawn-model-X");

    expect(cmd).toContain("--model 'spawn-model-X'");
  });

  it("restore with stored default matches a launch with no mode (no approval flags)", async () => {
    const content = jsonl(
      { type: "session_meta", cwd: "/workspace/test" },
      { threadId: "thread-1" },
    );
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    setupMockOpen(content);
    setupMockStream(content);
    mockReadFile.mockResolvedValue(content);
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const launch = agent.getLaunchCommand(makeLaunchConfig());
    const restore = await agent.getRestoreCommand!(
      makeSession({ workspacePath: "/workspace/test" }),
      makeProjectConfig({ agentConfig: { permissions: "default" } }),
    );

    for (const cmd of [launch, restore]) {
      expect(cmd).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(cmd).not.toContain("--ask-for-approval");
    }
  });

  it("handles unreadable session files gracefully", async () => {
    mockReaddir.mockResolvedValue(["sess.jsonl"]);
    // open() finds matching session_meta for cwd check
    setupMockOpen(jsonl({ type: "session_meta", cwd: "/workspace/test" }));
    // readFile (full parse) fails
    mockReadFile.mockRejectedValue(new Error("EACCES"));
    mockCreateReadStream.mockImplementation(() => {
      throw new Error("EACCES");
    });
    mockStat.mockResolvedValue({ mtimeMs: 1000 });

    const session = makeSession({ workspacePath: "/workspace/test" });
    expect(await agent.getRestoreCommand!(session, makeProjectConfig())).toBeNull();
  });
});

// =========================================================================
// resolveCodexBinary
// =========================================================================
describe("resolveCodexBinary", () => {
  it("returns path from `which` when codex is found", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "/usr/local/bin/codex\n", stderr: "" });
    const result = await resolveCodexBinary();
    expect(result).toBe("/usr/local/bin/codex");
    expect(mockExecFileAsync).toHaveBeenCalledWith("which", ["codex"], { timeout: 10_000 });
  });

  it("falls back to common locations when `which` fails", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockImplementation((path: string) => {
      if (path === "/usr/local/bin/codex") {
        return Promise.resolve({ mtimeMs: 1000 });
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await resolveCodexBinary();
    expect(result).toBe("/usr/local/bin/codex");
  });

  it("checks /opt/homebrew/bin/codex as fallback", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockImplementation((path: string) => {
      if (path === "/opt/homebrew/bin/codex") {
        return Promise.resolve({ mtimeMs: 1000 });
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await resolveCodexBinary();
    expect(result).toBe("/opt/homebrew/bin/codex");
  });

  it("checks ~/.cargo/bin/codex as fallback (Rust-based codex)", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockImplementation((path: string) => {
      if (path === "/mock/home/.cargo/bin/codex") {
        return Promise.resolve({ mtimeMs: 1000 });
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await resolveCodexBinary();
    expect(result).toBe("/mock/home/.cargo/bin/codex");
  });

  it("checks ~/.npm/bin/codex as fallback", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockImplementation((path: string) => {
      if (path === "/mock/home/.npm/bin/codex") {
        return Promise.resolve({ mtimeMs: 1000 });
      }
      return Promise.reject(new Error("ENOENT"));
    });

    const result = await resolveCodexBinary();
    expect(result).toBe("/mock/home/.npm/bin/codex");
  });

  it("returns 'codex' when not found anywhere", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveCodexBinary();
    expect(result).toBe("codex");
  });

  it("returns 'codex' when `which` returns empty stdout", async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveCodexBinary();
    expect(result).toBe("codex");
  });
});

// =========================================================================
// postLaunchSetup — binary resolution
// =========================================================================
describe("postLaunchSetup", () => {
  it("has postLaunchSetup method", () => {
    const agent = create();
    expect(typeof agent.postLaunchSetup).toBe("function");
  });

  it("runs setup when session has workspacePath", async () => {
    const agent = create();
    // which fails, stat fails → resolves to "codex"
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockRejectedValue(new Error("ENOENT"));
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.postLaunchSetup!(makeSession({ workspacePath: "/workspace/test" }));
    expect(mockMkdir).toHaveBeenCalled();
  });

  it("returns early when session has no workspacePath", async () => {
    const agent = create();
    mockExecFileAsync.mockRejectedValue(new Error("not found"));
    mockStat.mockRejectedValue(new Error("ENOENT"));
    await agent.postLaunchSetup!(makeSession({ workspacePath: undefined }));
    expect(mockMkdir).not.toHaveBeenCalled();
  });

  it("resolves binary and uses it in getLaunchCommand after postLaunchSetup", async () => {
    const agent = create();
    mockExecFileAsync.mockResolvedValue({ stdout: "/opt/bin/codex\n", stderr: "" });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    // Before postLaunchSetup, binary is "codex"
    expect(agent.getLaunchCommand(makeLaunchConfig())).toBe(
      "'codex' -c check_for_update_on_startup=false",
    );

    // After postLaunchSetup resolves the binary
    await agent.postLaunchSetup!(makeSession({ workspacePath: "/workspace/test" }));

    // Now getLaunchCommand should use the resolved binary
    expect(agent.getLaunchCommand(makeLaunchConfig())).toBe(
      "'/opt/bin/codex' -c check_for_update_on_startup=false",
    );
  });
});

// =========================================================================
// setupWorkspaceHooks — file writing behavior
// =========================================================================
describe("setupWorkspaceHooks", () => {
  const agent = create();

  /** The current wrapper version: the marker that a first install writes. */
  async function currentWrapperVersion(): Promise<string> {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data", sessionId: "sess-1" });
    const markerWrite = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes(".ao-version.tmp."),
    );
    mockWriteFile.mockClear();
    mockRename.mockClear();
    return String(markerWrite?.[1]);
  }

  it("has setupWorkspaceHooks method", () => {
    expect(typeof agent.setupWorkspaceHooks).toBe("function");
  });

  it("creates ~/.ao/bin directory", async () => {
    // Version marker doesn't exist — triggers full install
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    expect(mockMkdir).toHaveBeenCalledWith("/mock/home/.ao/bin", { recursive: true });
  });

  it("writes ao-metadata-helper.sh with executable permissions via atomic write", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // Atomic write: writes to .tmp file first, then renames
    const helperWriteCall = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes("ao-metadata-helper.sh.tmp."),
    );
    expect(helperWriteCall).toBeDefined();
    expect(helperWriteCall![1]).toContain("update_ao_metadata()");
    expect(helperWriteCall![2]).toEqual({ encoding: "utf-8", mode: 0o755 });

    // Then renamed to final path
    const helperRenameCall = mockRename.mock.calls.find(
      (call: string[]) => typeof call[1] === "string" && call[1].endsWith("ao-metadata-helper.sh"),
    );
    expect(helperRenameCall).toBeDefined();
  });

  it("writes gh and git wrappers atomically when version marker is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // gh wrapper: written to temp, then renamed
    const ghWriteCall = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes("/gh.tmp."),
    );
    expect(ghWriteCall).toBeDefined();
    expect(ghWriteCall![1]).toContain("ao gh wrapper");

    const ghRenameCall = mockRename.mock.calls.find(
      (call: string[]) => typeof call[1] === "string" && call[1].endsWith("/gh"),
    );
    expect(ghRenameCall).toBeDefined();

    // git wrapper: written to temp, then renamed
    const gitWriteCall = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes("/git.tmp."),
    );
    expect(gitWriteCall).toBeDefined();
    expect(gitWriteCall![1]).toContain("ao git wrapper");

    const gitRenameCall = mockRename.mock.calls.find(
      (call: string[]) => typeof call[1] === "string" && call[1].endsWith("/git"),
    );
    expect(gitRenameCall).toBeDefined();
  });

  it("sets executable permissions on gh and git wrappers via writeFile mode", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    const ghWriteCall = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes("/gh.tmp."),
    );
    expect(ghWriteCall![2]).toEqual({ encoding: "utf-8", mode: 0o755 });

    const gitWriteCall = mockWriteFile.mock.calls.find(
      (call: [string, string, object]) =>
        typeof call[0] === "string" && call[0].includes("/git.tmp."),
    );
    expect(gitWriteCall![2]).toEqual({ encoding: "utf-8", mode: 0o755 });
  });

  it("repairs wrapper writes when version marker matches but files are missing", async () => {
    // Marker matches current version but wrapper files are missing —
    // the install must repair them (old code skipped on marker alone).
    const version = await currentWrapperVersion();
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === "string" && path.endsWith(".ao-version")) {
        return Promise.resolve(version);
      }
      // Wrapper files and AGENTS.md read attempts
      return Promise.reject(new Error("ENOENT"));
    });

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // Must write wrappers when files are missing even though the marker matches.
    const wrapperWrites = mockWriteFile.mock.calls.filter(
      (call: [string, string, object]) =>
        typeof call[0] === "string" &&
        (call[0].includes("ao-metadata-helper.sh.tmp.") ||
          call[0].includes("/gh.tmp.") ||
          call[0].includes("/git.tmp.")),
    );
    expect(wrapperWrites.length).toBeGreaterThan(0);
  });

  it("writes version marker after installing wrappers", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // Version marker is also atomically written, after the three scripts
    const tmpWrites = mockWriteFile.mock.calls.filter(
      (call: [string, string, object]) => typeof call[0] === "string" && call[0].includes(".tmp."),
    );
    const versionWriteCall = tmpWrites[tmpWrites.length - 1];
    expect(versionWriteCall?.[0]).toContain(".ao-version.tmp.");
    expect(versionWriteCall![1]).toMatch(/^\d+\.\d+\.\d+$/);

    const versionRenameCall = mockRename.mock.calls.find(
      (call: string[]) => typeof call[1] === "string" && call[1].endsWith(".ao-version"),
    );
    expect(versionRenameCall).toBeDefined();
  });

  it("writes ao session context to .ao/AGENTS.md", async () => {
    // Version marker matches (skip wrapper install)
    const version = await currentWrapperVersion();
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === "string" && path.endsWith(".ao-version")) {
        return Promise.resolve(version);
      }
      return Promise.reject(new Error("ENOENT"));
    });

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    const agentsMdCall = mockWriteFile.mock.calls.find(
      (call: string[]) => typeof call[0] === "string" && call[0].includes(".ao/AGENTS.md"),
    );
    expect(agentsMdCall).toBeDefined();
    expect(agentsMdCall![1]).toContain("Agent Orchestrator (ao) Session");
  });

  it("uses atomic write (temp + rename) to prevent partial reads from concurrent sessions", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // Every wrapper file should be written to a .tmp file first, then renamed
    // This ensures concurrent readers never see a partially written file
    const tmpWrites = mockWriteFile.mock.calls.filter(
      (call: [string, string, object]) => typeof call[0] === "string" && call[0].includes(".tmp."),
    );
    const renames = mockRename.mock.calls;

    // We expect atomic writes for: helper, gh, git, version marker = 4
    expect(tmpWrites.length).toBe(4);
    expect(renames.length).toBe(4);

    // Each rename should move a .tmp file to the final path
    for (const [src, dst] of renames) {
      expect(src).toContain(".tmp.");
      expect(dst).not.toContain(".tmp.");
    }
  });

  it("writes .ao/AGENTS.md without modifying repo-tracked AGENTS.md", async () => {
    const version = await currentWrapperVersion();
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === "string" && path.endsWith(".ao-version")) {
        return Promise.resolve(version);
      }
      return Promise.reject(new Error("ENOENT"));
    });

    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // Should write to .ao/AGENTS.md, NOT to workspace root AGENTS.md
    const allWrites = mockWriteFile.mock.calls.filter(
      (call: string[]) => typeof call[0] === "string" && call[0].endsWith("AGENTS.md"),
    );
    expect(allWrites).toHaveLength(1);
    expect(allWrites[0]![0]).toContain(".ao/AGENTS.md");
  });
});

// =========================================================================
// Shell wrapper content verification
// =========================================================================
describe("shell wrapper content", () => {
  const agent = create();

  beforeEach(() => {
    // Force wrapper installation by making version marker miss
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  async function getWrapperContent(name: string): Promise<string> {
    await agent.setupWorkspaceHooks!("/workspace/test", {
      dataDir: "/data",
      sessionId: "sess-1",
    });

    // With atomic writes, content is written to a .tmp. file
    const call = mockWriteFile.mock.calls.find(
      (c: [string, string, object]) => typeof c[0] === "string" && c[0].includes(`/${name}.tmp.`),
    );
    return call ? (call[1] as string) : "";
  }

  describe("metadata helper", () => {
    it("contains update_ao_metadata function", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      expect(content).toContain("update_ao_metadata()");
    });

    it("uses AO_DATA_DIR and AO_SESSION env vars", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      expect(content).toContain("AO_DATA_DIR");
      expect(content).toContain("AO_SESSION");
    });

    it("escapes sed metacharacters in values", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      // Should contain the sed escaping logic for &, |, and \
      expect(content).toContain("escaped_value");
      expect(content).toMatch(/sed.*\\\\&/);
    });

    it("uses atomic temp file + mv pattern", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      expect(content).toContain("temp_file");
      expect(content).toContain("mv");
    });

    it("validates session name has no path separators", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      // Rejects session names containing / or ..
      expect(content).toContain("*/*");
      expect(content).toContain("*..*");
    });

    it("limits keys to pr, status=pr_open and branch (m-10)", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      expect(content).toContain("allowed: pr, status, branch");
      expect(content).toContain('[[ "$value" != "pr_open" ]]');
      expect(content).toContain("refusing key");
    });

    it("validates ao_dir is an absolute path under expected locations", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      // Only allows paths under $HOME/.ao/, $HOME/.agent-orchestrator/, or /tmp/
      expect(content).toContain('$HOME"/.ao/*');
      expect(content).toContain('$HOME"/.agent-orchestrator/*');
      expect(content).toContain("/tmp/*");
    });

    it("resolves symlinks and verifies file stays within ao_dir", async () => {
      const content = await getWrapperContent("ao-metadata-helper.sh");
      expect(content).toContain("pwd -P");
      expect(content).toContain("real_ao_dir");
      expect(content).toContain("real_dir");
    });
  });

  describe("gh wrapper", () => {
    it("installs the shared core gh wrapper", async () => {
      // Core runs this script in its own tests (agent-workspace-hooks.test.ts):
      // the recursion guard for every spelling and wrapper copy, GH_PATH,
      // pr create and pr merge. So this test checks only that Codex installs
      // that script, not how the script is written.
      expect(await getWrapperContent("gh")).toBe(GH_WRAPPER);
    });

    it("uses exec for non-PR commands (transparent passthrough)", async () => {
      const content = await getWrapperContent("gh");
      expect(content).toContain('exec "$real_gh"');
    });

    it("extracts PR URL from gh pr create output", async () => {
      const content = await getWrapperContent("gh");
      expect(content).toContain("https://github");
      expect(content).toContain("update_ao_metadata pr");
    });

    it("never writes status=merged (the lifecycle reads the PR state)", async () => {
      const content = await getWrapperContent("gh");
      expect(content).not.toContain("status merged");
    });

    it("cleans up temp file on exit", async () => {
      const content = await getWrapperContent("gh");
      expect(content).toContain("trap");
      expect(content).toContain("rm -f");
    });
  });

  describe("git wrapper", () => {
    it("installs the shared core git wrapper", async () => {
      // Core runs this script in its own tests: the recursion guard, the
      // branch that HEAD names after checkout or switch, and no write for
      // another work tree.
      expect(await getWrapperContent("git")).toBe(GIT_WRAPPER);
    });

    it("only updates metadata on success (exit code 0)", async () => {
      const content = await getWrapperContent("git");
      expect(content).toContain("exit_code -eq 0");
    });

    it("sources the metadata helper", async () => {
      const content = await getWrapperContent("git");
      expect(content).toContain("source");
      expect(content).toContain("ao-metadata-helper.sh");
    });
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

  it("is true when codex runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "codex --model gpt-5.6-terra", name: "codex", pid: 42 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(true);
  });

  it("queries herdr for the pane instead of scanning tmux", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "codex --model gpt-5.6-terra", name: "codex", pid: 42 }]),
    );

    const agent = create();
    await agent.isProcessRunning(herdrHandle);

    const [bin, args] = mockExecFileAsync.mock.calls[0];
    expect(bin).toBe("herdr");
    expect(args).toEqual(["pane", "process-info", "--pane", "w8:p1"]);
    expect(mockExecFileAsync.mock.calls.every((c: any[]) => c[0] !== "tmux")).toBe(true);
  });

  // Herdr fit F-6 (T-6.9): the agent passes the handle, so a pinned launch is
  // read at its own binary and socket, whatever the caller's environment.
  it("runs a pinned handle's herdrBin with HERDR_SOCKET_PATH, and a legacy handle's herdr as before", async () => {
    const saved = process.env["HERDR_SOCKET_PATH"];
    process.env["HERDR_SOCKET_PATH"] = "/tmp/caller/other.sock";
    try {
      mockExecFileAsync.mockResolvedValue(
        paneProcesses([{ cmdline: "codex --model gpt-5.6-terra", name: "codex", pid: 42 }]),
      );
      const agent = create();

      const pinned = {
        ...herdrHandle,
        data: {
          ...herdrHandle.data,
          herdrBin: "/opt/herdr/bin/herdr",
          herdrSocket: "/tmp/aohd/herdr.sock",
        },
      };
      expect(await agent.isProcessRunning(pinned)).toBe(true);
      expect(await agent.isProcessRunning(herdrHandle)).toBe(true);

      const [pinnedBin, pinnedArgs, pinnedOptions] = mockExecFileAsync.mock.calls[0];
      expect(pinnedBin).toBe("/opt/herdr/bin/herdr");
      expect(pinnedArgs).toEqual(["pane", "process-info", "--pane", "w8:p1"]);
      expect(pinnedOptions.env.HERDR_SOCKET_PATH).toBe("/tmp/aohd/herdr.sock");
      const [legacyBin, , legacyOptions] = mockExecFileAsync.mock.calls[1];
      expect(legacyBin).toBe("herdr");
      expect(legacyOptions).not.toHaveProperty("env");
    } finally {
      if (saved === undefined) delete process.env["HERDR_SOCKET_PATH"];
      else process.env["HERDR_SOCKET_PATH"] = saved;
    }
  });

  it("is false when only an unrelated process runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "bash", name: "bash", pid: 7 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(false);
  });

  it("rejects when herdr is unavailable", async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error("ENOENT"));

    const agent = create();
    await expect(agent.isProcessRunning(herdrHandle)).rejects.toThrow();
  });
});
