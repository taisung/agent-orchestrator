import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import type { Session, RuntimeHandle, AgentLaunchConfig } from "@aoagents/ao-core";

const { mockAppendActivityEntry, mockReadLastActivityEntry, mockRecordTerminalActivity, mockGetOpenCodeSession } =
  vi.hoisted(() => ({
    mockAppendActivityEntry: vi.fn().mockResolvedValue(undefined),
    mockReadLastActivityEntry: vi.fn().mockResolvedValue(null),
    mockRecordTerminalActivity: vi.fn().mockResolvedValue(undefined),
    mockGetOpenCodeSession: vi.fn(),
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
});

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

  it("generates a base command that makes the session through the API", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain('"title":"AO:sess-1"');
  });

  it("holds no version probe: the Node gate refuses old binaries before the pane starts", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model, prompt: "Go" }));
    expect(cmd).not.toContain("OC_MAJOR");
    expect(cmd).not.toContain("opencode --version");
  });

  it("makes the titled session without run --command or a title lookup", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model, prompt: "Go" }));
    expect(cmd).not.toContain("run --format json");
    expect(cmd).not.toContain("--command");
    expect(cmd).not.toContain("opencode session list");
  });

  it("uses --prompt with shell-escaped prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix it" }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'Fix it'");
  });

  it("stores the model in the API body and passes no --model to the TUI", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model }));
    expect(cmd).toContain('"providerID":"opencode-go"');
    expect(cmd).toContain('"id":"muse-spark-1.3-contributor"');
    expect(cmd).not.toContain("--model");
  });

  it("combines prompt and model", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Go", model }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"providerID":"opencode-go"');
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'Go'");
    expect(cmd).not.toContain("--model");
  });

  it("escapes single quotes in prompt (POSIX shell escaping)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's broken" }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'it'\\''s broken'");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("--agent");
    expect(cmd).not.toContain('"agent"');
  });

  it("stores the agent in the API body when subagent is provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ subagent: "sisyphus" }));
    expect(cmd).toContain('"agent":"sisyphus"');
    expect(cmd).not.toContain("--agent");
  });

  it("generates command with agent and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "sisyphus", prompt: "fix bug" }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"agent":"sisyphus"');
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'fix bug'");
    expect(cmd).not.toContain("--agent");
  });

  it("generates command with agent, model, and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "sisyphus", model, prompt: "fix the bug" }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"providerID":"opencode-go"');
    expect(cmd).toContain('"agent":"sisyphus"');
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'fix the bug'");
    expect(cmd).not.toContain("--agent");
    expect(cmd).not.toContain("--model");
  });

  it("shell-escapes sessionId in the discovery failure message", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ sessionId: "sess-1; rm -rf /" }));

    expect(cmd).toContain(
      "echo 'failed to discover OpenCode session ID for AO:sess-1; rm -rf /' >&2",
    );
  });

  it("keeps the open-or-fail shape shell-valid on one line", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain('[ -n "$SES_ID" ] && exec opencode');
    expect(cmd).not.toContain("then;");
  });

  it("works with different agent names: oracle", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "oracle", prompt: "review code" }),
    );
    expect(cmd).toContain('"agent":"oracle"');
    expect(cmd).toContain("'review code'");
    expect(cmd).not.toContain("--agent");
  });

  it("works with different agent names: librarian", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "librarian", prompt: "find usages" }),
    );
    expect(cmd).toContain('"agent":"librarian"');
    expect(cmd).toContain("'find usages'");
    expect(cmd).not.toContain("--agent");
  });

  it("backward compatible: no agent key when subagent not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "fix it" }));
    expect(cmd).not.toContain('"agent"');
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'fix it'");
  });

  it("combines model and prompt without agent (backward compatible)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Go", model }));
    expect(cmd).not.toContain('"agent"');
    expect(cmd).toContain('"providerID":"opencode-go"');
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'Go'");
    expect(cmd).not.toContain("--model");
  });

  it("uses API create when systemPrompt is provided", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator" }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'You are an orchestrator'");
  });

  it("generates command with systemPrompt and task prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator", prompt: "do the task" }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain(
      `exec opencode --session "$SES_ID" --prompt 'You are an orchestrator

do the task'`,
    );
  });

  it("escapes single quotes in systemPrompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPrompt: "it's important" }));
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'it'\\''s important'");
  });

  it("handles very long systemPrompt", () => {
    const longPrompt = "A".repeat(500);
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPrompt: longPrompt }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd.length).toBeGreaterThan(500);
  });

  it("generates command with systemPromptFile via shell substitution", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md" }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('exec opencode --session "$SES_ID" --prompt "$(cat \'/tmp/prompt.md\')"');
  });

  it("escapes path in systemPromptFile", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/it's-prompt.md" }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt \"$(cat '/tmp/it'\\''s-prompt.md')\"",
    );
  });

  it("systemPromptFile takes precedence over systemPrompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPrompt: "direct prompt",
        systemPromptFile: "/tmp/file-prompt.md",
      }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain(
      'exec opencode --session "$SES_ID" --prompt "$(cat \'/tmp/file-prompt.md\')"',
    );
    expect(cmd).not.toContain("direct prompt");
  });

  it("combines systemPromptFile with subagent and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPromptFile: "/tmp/orchestrator.md",
        subagent: "sisyphus",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"agent":"sisyphus"');
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt \"$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')\"",
    );
    expect(cmd).not.toContain("--agent");
    expect(cmd).toContain(
      "$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')",
    );
  });

  it("generates orchestrator-style systemPromptFile launch", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        sessionId: "my-orchestrator",
        permissions: "permissionless",
        systemPromptFile: "/tmp/orchestrator.md",
      }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"title":"AO:my-orchestrator"');
    expect(cmd).toContain(
      'exec opencode --session "$SES_ID" --prompt "$(cat \'/tmp/orchestrator.md\')"',
    );
  });

  it("combines systemPromptFile with subagent and prompt - shell escape", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        systemPromptFile: "/tmp/orchestrator.md",
        subagent: "sisyphus",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('"agent":"sisyphus"');
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt \"$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')\"",
    );
    expect(cmd).toContain(
      "$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')",
    );
  });

  it("handles prompt with special characters", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "fix $PATH/to/file and `rm -rf /unquoted/path`" }),
    );
    expect(cmd).toContain("'fix $PATH/to/file and `rm -rf /unquoted/path`");
  });

  it("handles prompt with newlines", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "line1\nline2\nline3" }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain("'line1");
  });

  it("handles prompt with backticks", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "use `backticks` and $vars`" }));
    expect(cmd).toContain("'use `backticks` and $vars`");
  });

  it("handles prompt with dollar signs", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "cost is $100" }));
    expect(cmd).toContain("'cost is $100'");
  });

  it("handles prompt with double quotes", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: 'say "hello" and "goodbye"' }));
    expect(cmd).toContain('\'say "hello" and "goodbye"\'');
  });

  it("handles prompt with unicode characters", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "fix bug in café.js file" }));
    expect(cmd).toContain("'fix bug in café.js file'");
  });

  it("handles prompt with semicolons", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "line1; line2; line3" }));
    expect(cmd).toContain("'line1; line2; line3");
  });

  it("handles empty prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "" }));
    expect(cmd).toContain("opencode api session.create");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain('"title":"AO:sess-1"');
    expect(cmd).not.toContain("--prompt");
  });

  it("uses existing session id", () => {
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

    expect(cmd).toBe("opencode --session 'ses_abc123' --prompt 'continue'");
  });

  it("runs the version probe in Node and puts none in the pane command", () => {
    const fresh = agent.getLaunchCommand(makeLaunchConfig());
    const existing = agent.getLaunchCommand(
      makeLaunchConfig({
        projectConfig: {
          name: "my-project",
          repo: "owner/repo",
          path: "/workspace/repo",
          defaultBranch: "main",
          sessionPrefix: "my",
          agentConfig: { opencodeSessionId: "ses_abc123" },
        },
      }),
    );

    // The second command takes the existing-session path, not session.create.
    expect(fresh).toContain("opencode api session.create");
    expect(existing).toBe("opencode --session 'ses_abc123'");
    // One Node-side probe per command, and no probe text in either pane command.
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
    expect(fresh).not.toContain("--version");
    expect(existing).not.toContain("--version");
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

  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("returns idle when prompt char visible", () => {
    expect(agent.detectActivity("some output\n> ")).toBe("idle");
    expect(agent.detectActivity("some output\n$ ")).toBe("idle");
  });

  it("returns waiting_input for Y/N confirmation", () => {
    expect(agent.detectActivity("Apply changes?\n(Y)es/(N)o")).toBe("waiting_input");
  });

  it("returns waiting_input for approval required", () => {
    expect(agent.detectActivity("output\napproval required for this action")).toBe("waiting_input");
  });

  it("returns waiting_input for proceed prompt", () => {
    expect(agent.detectActivity("Do you want to proceed?")).toBe("waiting_input");
  });

  it("returns waiting_input for allow prompt", () => {
    expect(agent.detectActivity("Allow file creation?")).toBe("waiting_input");
  });

  it("returns active for non-empty terminal output", () => {
    expect(agent.detectActivity("opencode is working\n")).toBe("active");
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
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_abc123");
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

  it("returns null when no session ID is stored (no title search)", async () => {
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: {} }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBeNull();
    expect(mockGetOpenCodeSession).not.toHaveBeenCalled();
    // A4: the version probe still runs, so a refused binary reports the
    // version problem instead of only the missing mapping.
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("returns null when the stored session is gone (no title replacement)", async () => {
    mockGetOpenCodeSession.mockResolvedValue(null);
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_gone" } }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBeNull();
    expect(mockGetOpenCodeSession).toHaveBeenCalledWith("ses_gone");
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
  it("does not include --session for invalid opencodeSessionId in launch command", () => {
    const agent = create();

    const invalidIds = ["invalid", "SES_uppercase", "ses_", "ses spaces here", "", "ses-123"];

    for (const invalidId of invalidIds) {
      const cmd = agent.getLaunchCommand(
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
      );

      expect(cmd).not.toContain(`--session '${invalidId}'`);
      expect(cmd).toContain("opencode api session.create");
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

  it("falls back to opencode API when activity JSONL is empty", async () => {
    mockReadLastActivityEntry.mockResolvedValueOnce(null);
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

describe("launch command against the OpenCode 2.x CLI", () => {
  const agent = create();
  const model = "opencode-go/muse-spark-1.3-contributor";
  const subagent = "plan";
  const prompt = "Reply with OK";

  it("opens the TUI on the created session", () => {
    const config = makeLaunchConfig({ model, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
      sessionId: "ses_gen",
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.tuiCalls).toHaveLength(1);
    const tui = run.tuiCalls[0]!;
    expect(flagValue(tui, "--session")).toBe("ses_gen");
    expect(flagValue(tui, "--prompt")).toBe(prompt);
  });

  it("makes the titled session through the API, with no TUI model flags", () => {
    const config = makeLaunchConfig({ model, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), {});

    expect(run.runCalls).toHaveLength(0);
    const [create] = run.apiCalls;
    expect(create?.[1]).toBe("session.create");
    const body = JSON.parse(flagValue(create!, "-d")!);
    expect(body.title).toBe(`AO:${config.sessionId}`);
    expect(modelRefToCli(body.model)).toBe(model);
    expect(body.agent).toBe(subagent);
    expect(body.location).toEqual({ directory: realpathSync(workDir) });
    expect(flagValue(run.tuiCalls[0]!, "--model")).toBeUndefined();
    expect(flagValue(run.tuiCalls[0]!, "--agent")).toBeUndefined();
  });

  it("reads the created session back, then opens the TUI on it with the requested settings", () => {
    const variantModel = `${model}#xhigh`;
    const config = makeLaunchConfig({ model: variantModel, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
      sessionId: "ses_gen",
    });

    expect(run.status).toBe(0);
    expect(flagValue(run.tuiCalls[0]!, "--session")).toBe("ses_gen");
    expect(run.tuiSession?.title).toBe(`AO:${config.sessionId}`);
    expect(run.tuiSession?.directory).toBe(realpathSync(workDir));
    expectSettings(run.tuiSession, { model: variantModel, agent: subagent });
    expect(run.apiOperations).toEqual(["session.create", "session.get"]);
    expect(flagValue(run.apiCalls[1]!, "--param")).toBe("sessionID=ses_gen");
    expect(run.listCalls).toHaveLength(0);
  });

  it("keeps the model variant in the API model reference", () => {
    const variantModel = `${model}#xhigh`;
    const command = agent.getLaunchCommand(makeLaunchConfig({ model: variantModel }));
    const run = runAgainstFakeCli(command, {});

    const body = JSON.parse(flagValue(run.apiCalls[0]!, "-d")!);
    expect(modelRefToCli(body.model)).toBe(variantModel);
    expect(body.model.variant).toBeDefined();
  });

  it("stops with an error when the create returns no session ID", () => {
    const config = makeLaunchConfig({ model, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
      createOutput: "",
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(
      `failed to discover OpenCode session ID for AO:${config.sessionId}`,
    );
    expect(run.tuiCalls).toHaveLength(0);
  });

  it("stops before it makes a session when the model has no provider", () => {
    const providerless = "muse-spark-1.3-contributor";
    const command = agent.getLaunchCommand(makeLaunchConfig({ model: providerless }));
    const run = runAgainstFakeCli(command, {});

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(providerless);
    expect(run.apiCalls).toHaveLength(0);
    expect(run.tuiCalls).toHaveLength(0);
  });
});

describe("2.x launch when session.create fails or returns no session ID", () => {
  const agent = create();
  const config = makeLaunchConfig({ prompt: "Reply with OK" });
  const title = `AO:${config.sessionId}`;
  const request = { model: "opencode-go/muse-spark-1.3-contributor#xhigh", agent: "plan" };
  // An older session with the same AO title, other settings and another task's conversation.
  const older = {
    id: "ses_older",
    title,
    updated: 1,
    model: { providerID: "opencode", id: "big-pickle", variant: "default" },
    agent: "build",
    conversation: "ANOTHER_TASK",
  };
  const { id: _olderId, ...olderStored } = older;
  const settingCases = [
    { label: "model and agent", model: request.model, agent: request.agent },
    { label: "model only", model: request.model },
    { label: "agent only", agent: request.agent },
    { label: "no model and no agent" },
  ];

  function launch(settings: { model?: string; agent?: string }): string {
    return agent.getLaunchCommand({ ...config, model: settings.model, subagent: settings.agent });
  }

  it.each(settingCases)(
    "a failed create does not open the older session with the same title ($label)",
    (settings) => {
      const run = runAgainstFakeCli(launch(settings), {
        apiFail: ["session.create"],
        list: [older],
      });

      expect(run.status).toBe(1);
      expect(run.tuiCalls).toHaveLength(0);
      expect(run.stderr).toContain("HTTP 500 Internal Server Error");
      expect(run.stderr).toContain(`failed to create the OpenCode session ${title}`);
      expect(run.apiOperations).toEqual(["session.create"]);
      expect(run.listCalls).toHaveLength(0);
      expect(run.store[older.id]).toEqual(olderStored);
    },
  );

  it("a failed create without a session with the title stops with status 1", () => {
    const run = runAgainstFakeCli(launch(request), {
      apiFail: ["session.create"],
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain(`failed to create the OpenCode session ${title}`);
    expect(run.store).toEqual({});
  });

  // Exit 0 does not show that a session with the title came from this create.
  const unusableOutputs = [
    { label: "empty output", output: "" },
    { label: "malformed ID", output: JSON.stringify({ data: { id: "bad id" } }) },
    { label: "ID without the ses_ prefix", output: JSON.stringify({ data: { id: "session-1" } }) },
    { label: "output that is not JSON", output: "not json" },
  ];

  it.each(unusableOutputs)(
    "a create that exits 0 with $label stops without a title lookup",
    ({ output }) => {
      const newer = { ...older, id: "ses_newer", updated: 2 };
      const { id: _newerId, ...newerStored } = newer;
      const run = runAgainstFakeCli(launch(request), {
        createOutput: output,
        list: [older, newer],
      });

      expect(run.status).toBe(1);
      expect(run.tuiCalls).toHaveLength(0);
      expect(run.stderr).toContain(`failed to discover OpenCode session ID for ${title}`);
      expect(run.apiOperations).toEqual(["session.create"]);
      expect(run.listCalls).toHaveLength(0);
      expect(run.store).toEqual({ [older.id]: olderStored, [newer.id]: newerStored });
    },
  );

  it.each(settingCases)(
    "a create that exits 0 without output stops without a title lookup ($label)",
    (settings) => {
      const run = runAgainstFakeCli(launch(settings), {
        createOutput: "",
        list: [older],
      });

      expect(run.status).toBe(1);
      expect(run.tuiCalls).toHaveLength(0);
      expect(run.listCalls).toHaveLength(0);
      expect(run.store[older.id]).toEqual(olderStored);
    },
  );
});

describe("2.x launch checks the settings that session.create stored", () => {
  const agent = create();
  const config = makeLaunchConfig({ prompt: "Reply with OK" });
  const created = "ses_created";
  const request = { model: "opencode-go/muse-spark-1.3-contributor#xhigh", agent: "plan" };
  const otherModel = { providerID: "opencode", id: "big-pickle", variant: "default" };
  const otherAgent = "build";

  function launch(settings: { model?: string; agent?: string }): string {
    return agent.getLaunchCommand({ ...config, model: settings.model, subagent: settings.agent });
  }

  it.each([
    { label: "another agent", createStores: { agent: otherAgent } },
    { label: "another model", createStores: { model: otherModel } },
  ])("stops with status 1 and no TUI when the service stores $label", ({ createStores }) => {
    const run = runAgainstFakeCli(launch(request), {
      sessionId: created,
      createStores,
    });

    expect(run.store[created]).toBeDefined();
    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.apiOperations).toEqual(["session.create", "session.get"]);
    expect(run.stderr).toContain(
      `OpenCode stored agent ${JSON.stringify(run.store[created]!.agent)}`,
    );
    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${created}`);
  });

  it("stops when the stored variant differs from a request without a variant", () => {
    const { providerID, id } = otherModel;
    const run = runAgainstFakeCli(launch({ model: modelRefToCli({ providerID, id }) }), {
      sessionId: created,
      createStores: { model: { providerID, id, variant: "xhigh" } },
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
  });

  it.each([
    { label: "session.get fails", options: { apiFail: ["session.get"] } },
    { label: "session.get prints the session and exits 1", options: { getExit: 1 } },
  ])("stops with status 1 and no TUI when $label", ({ options }) => {
    const run = runAgainstFakeCli(launch(request), {
      sessionId: created,
      ...options,
    });

    expectSettings(run.store[created], request);
    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${created}`);
  });

  it.each([
    {
      label: "only the model",
      settings: { model: request.model },
      createStores: { agent: otherAgent },
    },
    {
      label: "only the agent",
      settings: { agent: request.agent },
      createStores: { model: otherModel },
    },
  ])("checks $label when only that is requested", ({ settings, createStores }) => {
    const run = runAgainstFakeCli(launch(settings), {
      sessionId: created,
      createStores,
    });

    expect(run.status).toBe(0);
    expect(flagValue(run.tuiCalls[0]!, "--session")).toBe(created);
    expectSettings(run.tuiSession, settings, createStores);
    expect(run.apiOperations).toEqual(["session.create", "session.get"]);
  });

  it("runs no readback when no model and no agent were requested", () => {
    const run = runAgainstFakeCli(launch({}), {
      sessionId: created,
      createStores: { model: otherModel, agent: otherAgent },
    });

    expect(run.status).toBe(0);
    expect(flagValue(run.tuiCalls[0]!, "--session")).toBe(created);
    expect(run.apiOperations).toEqual(["session.create"]);
  });
});

describe("existing-session and restore commands against the OpenCode 2.x CLI", () => {
  const agent = create();
  const model = "opencode-go/glm-5.3#xhigh";
  const subagent = "plan";
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

  function reuseConfig(overrides: Partial<AgentLaunchConfig> = {}): AgentLaunchConfig {
    return makeLaunchConfig({
      projectConfig: { ...project, agentConfig: { opencodeSessionId: existingId } },
      prompt: "continue",
      ...overrides,
    });
  }

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

  it("resumes without a model or agent through the same plain command", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig()), {});

    expect(run.status).toBe(0);
    expect(run.apiCalls).toHaveLength(0);
    expect(run.tuiCalls).toEqual([["--session", existingId, "--prompt", "continue"]]);
  });

  it("stores the model and agent on the session, then opens the TUI without them", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {
      list: [existing],
    });

    expect(run.status).toBe(0);
    expect(run.apiOperations).toEqual([
      "session.switchModel",
      "session.switchAgent",
      "session.get",
    ]);
    for (const call of run.apiCalls) {
      expect(flagValue(call, "--param")).toBe(`sessionID=${existingId}`);
    }
    expect(run.tuiCalls).toEqual([["--session", existingId, "--prompt", "continue"]]);
    expectSettings(run.tuiSession, { model, agent: subagent });
  });

  it.each([
    { label: "resume", command: async () => agent.getLaunchCommand(reuseConfig({ model })) },
    { label: "restore", command: () => restoreCommand(model) },
  ])("$label stops with status 1 and no TUI when session.switchModel fails", async (c) => {
    const run = runAgainstFakeCli(await c.command(), {
      list: [existing],
      apiFail: ["session.switchModel"],
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${existingId}`);
    expect(run.store[existingId]?.model).toEqual(existing.model);
  });

  it("resume stops with status 1 and no TUI when the session does not exist", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {});

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain("HTTP 404 Not Found");
  });

  it("resume stops with status 1 and no TUI when session.switchAgent fails after the model switch", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {
      list: [existing],
      apiFail: ["session.switchAgent"],
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.apiOperations).toEqual(["session.switchModel", "session.switchAgent"]);
    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${existingId}`);
  });

  it.each([
    { label: "resume", command: async () => agent.getLaunchCommand(reuseConfig({ model })) },
    { label: "restore", command: () => restoreCommand(model) },
  ])(
    "$label stops with status 1 and no TUI when session.get prints the session and exits 1",
    async (c) => {
      const run = runAgainstFakeCli(await c.command(), {
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

  it("resume stops with status 1 and no TUI when the readback differs from the request", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {
      list: [existing],
      apiIgnore: ["session.switchAgent"],
    });

    expect(run.status).toBe(1);
    expect(run.tuiCalls).toHaveLength(0);
    expect(run.stderr).toContain(JSON.stringify(existing.agent));
  });

  it.each([
    {
      label: "resume",
      command: async (m: string) => agent.getLaunchCommand(reuseConfig({ model: m, subagent })),
    },
    { label: "restore", command: (m: string) => restoreCommand(m) },
  ])(
    "$label stops with status 1 before any API call when the model has no provider",
    async (c) => {
      const providerless = "glm-5.3";
      const run = runAgainstFakeCli(await c.command(providerless), {
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

  function launchError(): Error | undefined {
    try {
      agent.getLaunchCommand(makeLaunchConfig());
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
  ])("accepts $label: the launch proceeds and detect() finds it", ({ output }) => {
    versionOutput(output);
    expect(launchError()).toBeUndefined();
    expect(agent.getLaunchCommand(makeLaunchConfig())).toContain("opencode api session.create");
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
  ])("refuses $label ($output): the message names the floor and what it found", ({ output }) => {
    versionOutput(`${output}\n`);
    const error = launchError();
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("2.0.29 or later");
    expect(error!.message).toContain(`found ${output}`);
    expect(detect()).toBe(false);
  });

  it("refuses empty output and says the probe printed nothing, not that the binary is missing", () => {
    versionOutput("\n");
    const error = launchError();
    expect(error!.message).toContain("printed nothing");
    expect(error!.message).not.toContain("not found");
    expect(detect()).toBe(false);
  });

  it("refuses a missing binary and says it is not on PATH", () => {
    probeFails({ code: "ENOENT" });
    const error = launchError();
    expect(error!.message).toContain("2.0.29 or later");
    expect(error!.message).toContain("not found on PATH");
    expect(detect()).toBe(false);
  });

  it("refuses a probe that runs past its bound and says so", () => {
    probeFails({ code: "ETIMEDOUT", status: null, signal: "SIGKILL" });
    const error = launchError();
    expect(error!.message).toContain("no answer within");
    expect(detect()).toBe(false);
  });

  it("refuses a failed run even when stdout holds a supported version, and names the status", () => {
    probeFails({ status: 3, signal: null, stdout: "opencode v2.0.29\n" });
    const error = launchError();
    expect(error!.message).toContain("exited with status 3");
    expect(error!.message).toContain("opencode v2.0.29");
    expect(error!.message).not.toContain("not found");
    expect(detect()).toBe(false);
  });

  it("refuses a probe stopped by a signal and names the signal", () => {
    probeFails({ status: null, signal: "SIGTERM" });
    expect(launchError()!.message).toContain("stopped by SIGTERM");
  });

  it("refuses a binary that cannot run and names the error code", () => {
    probeFails({ code: "EACCES" });
    expect(launchError()!.message).toContain("EACCES");
  });

  it("bounds the probe and keeps its stderr off the terminal", () => {
    agent.getLaunchCommand(makeLaunchConfig());
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

  it("keeps the message on one line when the output has several lines", () => {
    versionOutput("opencode dev\nsecond line\n");
    const message = launchError()!.message;
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

  it("probes even when it finds no session, so a refused binary names the version", async () => {
    const restore = await agent.getRestoreCommand!(makeSession({ metadata: {} }), project);
    expect(restore).toBeNull();
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);

    // The caller then falls back to getLaunchCommand, which probes again:
    // one restore probe, one launch probe.
    agent.getLaunchCommand(makeLaunchConfig());
    expect(mockExecFileSync).toHaveBeenCalledTimes(2);
  });
});
