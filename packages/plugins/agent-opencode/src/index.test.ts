import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import type { Session, RuntimeHandle, AgentLaunchConfig } from "@aoagents/ao-core";

const { mockAppendActivityEntry, mockReadLastActivityEntry, mockRecordTerminalActivity } =
  vi.hoisted(() => ({
    mockAppendActivityEntry: vi.fn().mockResolvedValue(undefined),
    mockReadLastActivityEntry: vi.fn().mockResolvedValue(null),
    mockRecordTerminalActivity: vi.fn().mockResolvedValue(undefined),
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

  it("generates base command without prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain("opencode session list --format json");
    expect(cmd).toContain("AO:sess-1");
  });

  it("uses --prompt with shell-escaped prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix it" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'Fix it'");
  });

  it("includes --model with shell-escaped value", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "claude-sonnet-4-5-20250929" }));
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929'");
  });

  it("combines prompt and model", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "Go", model: "claude-sonnet-4-5-20250929" }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt 'Go' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929'");
  });

  it("escapes single quotes in prompt (POSIX shell escaping)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's broken" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'it'\\''s broken'");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("--agent");
  });

  it("includes --agent flag when subagent is provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ subagent: "sisyphus" }));
    expect(cmd).toContain("--agent 'sisyphus'");
  });

  it("generates command with agent and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "sisyphus", prompt: "fix bug" }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt 'fix bug' --agent 'sisyphus'",
    );
    expect(cmd).toContain("--agent 'sisyphus'");
  });

  it("generates command with agent, model, and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({
        subagent: "sisyphus",
        model: "claude-sonnet-4-5-20250929",
        prompt: "fix the bug",
      }),
    );
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt 'fix the bug' --agent 'sisyphus' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--agent 'sisyphus");
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929");
  });

  it("shell-escapes sessionId in the discovery failure message", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ sessionId: "sess-1; rm -rf /" }));

    expect(cmd).toContain(
      "echo 'failed to discover OpenCode session ID for AO:sess-1; rm -rf /' >&2",
    );
  });

  it("keeps the fallback if-block shell-valid on one line", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain('if [ -z "$SES_ID" ]; then SES_ID=$(opencode session list --format json');
    expect(cmd).not.toContain("then;");
  });

  it("works with different agent names: oracle", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "oracle", prompt: "review code" }),
    );
    expect(cmd).toContain("--agent 'oracle'");
    expect(cmd).toContain("'review code'");
  });

  it("works with different agent names: librarian", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ subagent: "librarian", prompt: "find usages" }),
    );
    expect(cmd).toContain("--agent 'librarian");
    expect(cmd).toContain("'find usages'");
  });

  it("backward compatible: no agent flag when subagent not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "fix it" }));
    expect(cmd).not.toContain("--agent");
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'fix it'");
  });

  it("combines model and prompt without agent (backward compatible)", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ prompt: "Go", model: "claude-sonnet-4-5-20250929" }),
    );
    expect(cmd).not.toContain("--agent");
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt 'Go' --model 'claude-sonnet-4-5-20250929'",
    );
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929");
  });

  it("uses run bootstrap when systemPrompt is provided", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain("exec opencode --session \"$SES_ID\" --prompt 'You are an orchestrator'");
  });

  it("generates command with systemPrompt and task prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an orchestrator", prompt: "do the task" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
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
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd.length).toBeGreaterThan(500);
  });

  it("generates command with systemPromptFile via shell substitution", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md" }));
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID" --prompt "$(cat \'/tmp/prompt.md\')"');
  });

  it("escapes path in systemPromptFile", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/it's-prompt.md" }),
    );
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
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
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
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
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt \"$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')\" --agent 'sisyphus'",
    );
    expect(cmd).toContain("--agent 'sisyphus");
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
    expect(cmd).toContain("opencode run --format json --title 'AO:my-orchestrator'");
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
    expect(cmd).toContain(
      "opencode run --format json --title 'AO:sess-1' --agent 'sisyphus'",
    );
    expect(cmd).toContain(
      "exec opencode --session \"$SES_ID\" --prompt \"$(cat '/tmp/orchestrator.md'; printf '\\n\\n'; printf %s 'fix the bug')\" --agent 'sisyphus'",
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
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
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
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
    expect(cmd).toContain("opencode session list --format json");
    expect(cmd).toContain("AO:sess-1");
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

  it("uses existing session id with --title fallback", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
    expect(cmd).toContain('exec opencode --session "$SES_ID"');
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

  function mockOpencodeSessionRows(rows: Array<Record<string, unknown>>) {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") {
        return Promise.resolve({
          stdout: JSON.stringify(rows),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
  }

  function mockOpencodeSessionList(updated: string | number) {
    mockOpencodeSessionRows([{ id: "ses_abc123", updated }]);
  }

  it("returns idle when last activity is older than ready threshold", async () => {
    mockOpencodeSessionList(new Date(Date.now() - 120_000).toISOString());

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
    mockOpencodeSessionList(new Date(Date.now() - 45_000).toISOString());

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
    mockOpencodeSessionList(new Date(Date.now() - 10_000).toISOString());

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
    mockOpencodeSessionRows([{ id: "ses_abc123", updated: "not-a-date" }]);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: { opencodeSessionId: "ses_abc123" },
      }),
      60_000,
    );

    expect(state).toBeNull();
  });

  it("falls back to AO session title when opencodeSessionId metadata is missing", async () => {
    mockOpencodeSessionRows([
      {
        id: "ses_different",
        title: "AO:test-1",
        updated: new Date(Date.now() - 5_000).toISOString(),
      },
    ]);

    const state = await agent.getActivityState(
      makeSession({
        runtimeHandle: makeTmuxHandle(),
        metadata: {},
      }),
      60_000,
    );

    expect(state?.state).toBe("active");
  });

  it("returns null when opencode session list output is malformed JSON", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") return Promise.resolve({ stdout: "not json", stderr: "" });
      return Promise.reject(new Error("unexpected"));
    });

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

  function mockOpencodeSessionRows(rows: Array<Record<string, unknown>>) {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "opencode") {
        return Promise.resolve({ stdout: JSON.stringify(rows), stderr: "" });
      }
      return Promise.reject(new Error("unexpected"));
    });
  }

  it("returns session info when matching session found by metadata ID", async () => {
    mockOpencodeSessionRows([
      { id: "ses_abc123", title: "AO:test-1", updated: new Date().toISOString() },
    ]);

    const info = await agent.getSessionInfo(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
    );
    expect(info).not.toBeNull();
    expect(info!.agentSessionId).toBe("ses_abc123");
    expect(info!.summary).toBe("AO:test-1");
    expect(info!.summaryIsFallback).toBe(true);
  });

  it("returns session info when matching session found by title", async () => {
    mockOpencodeSessionRows([
      { id: "ses_xyz789", title: "AO:test-1", updated: new Date().toISOString() },
    ]);

    const info = await agent.getSessionInfo(makeSession({ metadata: {} }));
    expect(info).not.toBeNull();
    expect(info!.agentSessionId).toBe("ses_xyz789");
  });

  it("returns null when no matching session", async () => {
    mockOpencodeSessionRows([
      { id: "ses_other", title: "AO:different", updated: new Date().toISOString() },
    ]);

    const info = await agent.getSessionInfo(makeSession({ metadata: {} }));
    expect(info).toBeNull();
  });

  it("returns null when opencode command fails", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("opencode not found"));
    const info = await agent.getSessionInfo(makeSession());
    expect(info).toBeNull();
  });
});

// =========================================================================
// getRestoreCommand
// =========================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  it("returns restore command from metadata session ID", async () => {
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBe("opencode --session 'ses_abc123'");
  });

  it("includes model flag from project config", async () => {
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: "ses_abc123" } }),
      {
        name: "proj",
        repo: "o/r",
        path: "/p",
        defaultBranch: "main",
        sessionPrefix: "p",
        agentConfig: { model: "claude-sonnet-4-5-20250929" },
      },
    );
    expect(cmd).toContain("--model 'claude-sonnet-4-5-20250929'");
  });

  it("returns null when no session ID found", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("opencode not found"));
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: {} }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBeNull();
  });

  it("falls back to title-based lookup", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "opencode") {
        return Promise.resolve({
          stdout: JSON.stringify([{ id: "ses_found", title: "AO:test-1" }]),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: {} }),
      { name: "proj", repo: "o/r", path: "/p", defaultBranch: "main", sessionPrefix: "p" },
    );
    expect(cmd).toBe("opencode --session 'ses_found'");
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

describe("session ID capture from JSON stream", () => {
  it("validates session_id format with ses_ prefix", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("session_id");
    expect(cmd).toContain("sessionID");
    expect(cmd).toContain("/^ses_[A-Za-z0-9_-]+$/");
  });

  it("parses JSON lines and extracts session_id or sessionID field", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("JSON.parse(trimmed)");
    expect(cmd).toContain("obj.session_id");
    expect(cmd).toContain("obj.sessionID");
  });

  it("handles buffer accumulation for partial lines", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("buffer.split");
    expect(cmd).toContain("buffer = lines.pop()");
  });
});

describe("title-based fallback sorting with newest-first", () => {
  it("sorts by updated timestamp (newest first) when multiple sessions have the same title", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("opencode session list --format json");

    expect(cmd).toContain("sort((a, b) =>");
    expect(cmd).toContain("tb - ta");
  });

  it("validates session IDs with ses_ prefix pattern", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("isValidId");
    expect(cmd).toContain("/^ses_[A-Za-z0-9_-]+$/");
  });

  it("handles numeric and string timestamps in sorting", () => {
    const agent = create();
    const cmd = agent.getLaunchCommand(makeLaunchConfig());

    expect(cmd).toContain("typeof value ===");
    expect(cmd).toContain("Number.isFinite");
    expect(cmd).toContain("Date.parse(value)");
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
      expect(cmd).toContain("opencode run --format json --title 'AO:sess-1'");
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
    // Mock opencode session list returning recent activity
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") {
        return Promise.resolve({
          stdout: JSON.stringify([
            { id: "ses_abc123", title: "AO:test-1", updated: new Date(Date.now() - 5_000).toISOString() },
          ]),
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle(), metadata: { opencodeSessionId: "ses_abc123" } }),
      60_000,
    );
    expect(result?.state).toBe("active");
  });

  it("falls back to JSONL entry state when session list fails", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce({
      entry: { ts: new Date().toISOString(), state: "active", source: "terminal" },
      modifiedAt: new Date(),
    });
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") return Promise.resolve({ stdout: "[]", stderr: "" });
      return Promise.reject(new Error("unexpected"));
    });

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
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") return Promise.resolve({ stdout: "[]", stderr: "" });
      return Promise.reject(new Error("unexpected"));
    });

    const result = await agent.getActivityState(
      makeSession({ runtimeHandle: makeTmuxHandle() }),
      60_000,
    );
    expect(result?.state).toBe("idle");
  });

  it("returns null when both session list and JSONL are unavailable", async () => {
    mockTmuxWithProcess("opencode");
    mockReadLastActivityEntry.mockResolvedValueOnce(null);
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys003\n", stderr: "" });
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  789 ttys003  opencode\n",
          stderr: "",
        });
      }
      if (cmd === "opencode") return Promise.resolve({ stdout: "[]", stderr: "" });
      return Promise.reject(new Error("unexpected"));
    });

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
// Launch and restore commands run against fake OpenCode 1.x and 2.x CLIs.
// The fake copies the CLI behavior measured on 1.18.35 and 2.0.29: 2.x
// rejects `run --command` and the TUI's --model/--agent, and only 2.x
// has `opencode api`.
// =========================================================================

const OPENCODE_1 = "1.18.35";
const OPENCODE_2 = "opencode v2.0.29";
const GENERATIONS = [
  { name: "1.x", version: OPENCODE_1 },
  { name: "2.x", version: OPENCODE_2 },
] as const;

const FAKE_OPENCODE = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FAKE_OC_LOG, JSON.stringify(argv) + "\\n");
const major = Number((env.FAKE_OC_VERSION.match(/(\\d+)\\./) || [])[1] || 0);
const v2 = major >= 2;
const silent = env.FAKE_OC_CREATE === "none";
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
if (argv[0] === "version") fail("Error: Failed to change directory to version", v2 ? 1 : 0);
if (argv[0] === "session" && argv[1] === "list") {
  process.stdout.write(env.FAKE_OC_LIST || "[]");
  process.exit(0);
}
if (argv[0] === "run") {
  const runFlags = ["--format", "--title", "--model", "--agent", "--session"];
  flags("opencode run", argv.slice(1), v2 ? runFlags : [...runFlags, "--command"]);
  if (!silent) {
    process.stdout.write(JSON.stringify({ type: "error", sessionID: env.FAKE_OC_SESSION }) + "\\n");
  }
  process.exit(0);
}
if (argv[0] === "api") {
  if (!v2) fail("Error: Failed to change directory to api", 0);
  const given = flags("opencode api", argv.slice(2), ["-d", "--param"]);
  if (argv[1] === "session.create") {
    const title = JSON.parse(given["-d"]).title;
    if (!silent) process.stdout.write(JSON.stringify({ data: { id: env.FAKE_OC_SESSION, title } }));
    process.exit(0);
  }
  if (env.FAKE_OC_API_FAIL) fail("HTTP 404 Not Found");
  process.exit(0);
}
flags("opencode", argv, v2 ? ["--session", "--prompt"] : ["--session", "--prompt", "--model", "--agent"]);
process.exit(0);
`;

type ActualChildProcess = typeof ChildProcess;

let actualChildProcess: ActualChildProcess;
let fakeRoot: string;
let fakeBin: string;
let workDir: string;
let callLog: string;

beforeAll(async () => {
  actualChildProcess = await vi.importActual<ActualChildProcess>("node:child_process");
  fakeRoot = mkdtempSync(join(tmpdir(), "ao-opencode-cli-"));
  fakeBin = join(fakeRoot, "bin");
  workDir = join(fakeRoot, "work");
  callLog = join(fakeRoot, "calls.jsonl");
  mkdirSync(fakeBin);
  mkdirSync(workDir);
  writeFileSync(join(fakeBin, "opencode"), FAKE_OPENCODE, { mode: 0o755 });
});

afterAll(() => {
  rmSync(fakeRoot, { recursive: true, force: true });
});

interface FakeCliOptions {
  version: string;
  sessionId?: string;
  list?: Array<{ id: string; title: string; updated: number }>;
  createOutput?: "none";
  apiFail?: boolean;
}

function fakeCliEnv(options: FakeCliOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
    FAKE_OC_LOG: callLog,
    FAKE_OC_VERSION: options.version,
    FAKE_OC_SESSION: options.sessionId ?? "ses_fakecreated",
    FAKE_OC_LIST: JSON.stringify(options.list ?? []),
    ...(options.createOutput ? { FAKE_OC_CREATE: options.createOutput } : {}),
    ...(options.apiFail ? { FAKE_OC_API_FAIL: "1" } : {}),
  };
}

/** Run a generated command in bash, as the tmux and herdr runtimes do, and return each fake CLI call. */
function runAgainstFakeCli(command: string, options: FakeCliOptions) {
  writeFileSync(callLog, "");
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
  return {
    status: result.status,
    stderr: result.stderr,
    calls,
    tuiCalls: calls.filter((argv) => argv[0] === "--session"),
    apiCalls: calls.filter((argv) => argv[0] === "api"),
    runCalls: calls.filter((argv) => argv[0] === "run"),
  };
}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

/** Inverse of the plugin's model split: the API reference must name the same CLI model. */
function modelRefToCli(ref: { providerID: string; id: string; variant?: string }): string {
  return `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}`;
}

describe("launch command against OpenCode 1.x and 2.x CLIs", () => {
  const agent = create();
  const model = "opencode-go/muse-spark-1.3-contributor";
  const subagent = "plan";
  const prompt = "Reply with OK";

  it.each(GENERATIONS)("$name: opens the TUI on the captured session", ({ version }) => {
    const config = makeLaunchConfig({ model, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
      version,
      sessionId: "ses_gen",
    });

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.tuiCalls).toHaveLength(1);
    const tui = run.tuiCalls[0]!;
    expect(flagValue(tui, "--session")).toBe("ses_gen");
    expect(flagValue(tui, "--prompt")).toBe(prompt);
  });

  it("2.x: makes the titled session through the API, without run --command or TUI model flags", () => {
    const config = makeLaunchConfig({ model, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), { version: OPENCODE_2 });

    expect(run.calls.some((argv) => argv.includes("--command"))).toBe(false);
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

  it("1.x: keeps run --command with the title, model and agent, then passes them to the TUI", () => {
    const config = makeLaunchConfig({ model, subagent, prompt });
    const run = runAgainstFakeCli(agent.getLaunchCommand(config), { version: OPENCODE_1 });

    expect(run.apiCalls).toHaveLength(0);
    const [runCall] = run.runCalls;
    expect(flagValue(runCall!, "--title")).toBe(`AO:${config.sessionId}`);
    expect(flagValue(runCall!, "--command")).toBe("true");
    const tui = run.tuiCalls[0]!;
    for (const flag of ["--model", "--agent"]) {
      expect(flagValue(tui, flag)).toBe(flagValue(runCall!, flag));
    }
    expect(flagValue(tui, "--model")).toBe(model);
    expect(flagValue(tui, "--agent")).toBe(subagent);
  });

  it("2.x: keeps the model variant in the API model reference", () => {
    const variantModel = `${model}#xhigh`;
    const command = agent.getLaunchCommand(makeLaunchConfig({ model: variantModel }));
    const run = runAgainstFakeCli(command, { version: OPENCODE_2 });

    const body = JSON.parse(flagValue(run.apiCalls[0]!, "-d")!);
    expect(modelRefToCli(body.model)).toBe(variantModel);
    expect(body.model.variant).toBeDefined();
  });

  it.each(GENERATIONS)(
    "$name: falls back to the newest session list entry with the AO title",
    ({ version }) => {
      const config = makeLaunchConfig({ model, prompt });
      const title = `AO:${config.sessionId}`;
      const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
        version,
        createOutput: "none",
        list: [
          { id: "ses_older", title, updated: 1 },
          { id: "ses_newer", title, updated: 2 },
          { id: "ses_other", title: "AO:another", updated: 3 },
        ],
      });

      expect(run.calls.some((argv) => argv[0] === "session" && argv[1] === "list")).toBe(true);
      expect(run.status).toBe(0);
      expect(run.tuiCalls).toHaveLength(1);
      expect(flagValue(run.tuiCalls[0]!, "--session")).toBe("ses_newer");
    },
  );

  it.each(GENERATIONS)(
    "$name: stops with an error when neither capture nor lookup finds the session",
    ({ version }) => {
      const config = makeLaunchConfig({ model, prompt });
      const run = runAgainstFakeCli(agent.getLaunchCommand(config), {
        version,
        createOutput: "none",
      });

      expect(run.status).toBe(1);
      expect(run.stderr).toContain(
        `failed to discover OpenCode session ID for AO:${config.sessionId}`,
      );
      expect(run.tuiCalls).toHaveLength(0);
    },
  );

  it("takes the 1.x branch when the version output has no version number", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(makeLaunchConfig({ model })), {
      version: "opencode dev",
    });

    expect(run.apiCalls).toHaveLength(0);
    expect(flagValue(run.runCalls[0]!, "--command")).toBe("true");
  });

  it("2.x: stops before it makes a session when the model has no provider", () => {
    const providerless = "muse-spark-1.3-contributor";
    const command = agent.getLaunchCommand(makeLaunchConfig({ model: providerless }));
    const run = runAgainstFakeCli(command, { version: OPENCODE_2 });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain(providerless);
    expect(run.apiCalls).toHaveLength(0);
    expect(run.tuiCalls).toHaveLength(0);
  });

  it("1.x: passes a model without provider through to OpenCode as before", () => {
    const providerless = "muse-spark-1.3-contributor";
    const command = agent.getLaunchCommand(makeLaunchConfig({ model: providerless }));
    const run = runAgainstFakeCli(command, { version: OPENCODE_1 });

    expect(flagValue(run.runCalls[0]!, "--model")).toBe(providerless);
    expect(flagValue(run.tuiCalls[0]!, "--model")).toBe(providerless);
  });
});

describe("existing-session and restore commands against OpenCode 1.x and 2.x CLIs", () => {
  const agent = create();
  const model = "opencode-go/glm-5.3";
  const subagent = "plan";
  const existingId = "ses_existing";
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

  it.each(GENERATIONS)(
    "$name: resumes without a model or agent through the same plain command",
    ({ version }) => {
      const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig()), { version });

      expect(run.status).toBe(0);
      expect(run.apiCalls).toHaveLength(0);
      expect(run.tuiCalls).toEqual([["--session", existingId, "--prompt", "continue"]]);
    },
  );

  it("2.x: stores the model and agent on the session, then opens the TUI without them", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {
      version: OPENCODE_2,
    });

    expect(run.status).toBe(0);
    const byOperation = new Map(run.apiCalls.map((argv) => [argv[1], argv]));
    const switchModel = byOperation.get("session.switchModel")!;
    const switchAgent = byOperation.get("session.switchAgent")!;
    for (const call of [switchModel, switchAgent]) {
      expect(flagValue(call, "--param")).toBe(`sessionID=${existingId}`);
    }
    expect(modelRefToCli(JSON.parse(flagValue(switchModel, "-d")!).model)).toBe(model);
    expect(JSON.parse(flagValue(switchAgent, "-d")!).agent).toBe(subagent);
    expect(run.tuiCalls).toEqual([["--session", existingId, "--prompt", "continue"]]);
  });

  it("1.x: passes the model and agent to the TUI and calls no API", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model, subagent })), {
      version: OPENCODE_1,
    });

    expect(run.status).toBe(0);
    expect(run.apiCalls).toHaveLength(0);
    const tui = run.tuiCalls[0]!;
    expect(flagValue(tui, "--model")).toBe(model);
    expect(flagValue(tui, "--agent")).toBe(subagent);
  });

  it("2.x: does not open the TUI when the API cannot set the model", () => {
    const run = runAgainstFakeCli(agent.getLaunchCommand(reuseConfig({ model })), {
      version: OPENCODE_2,
      apiFail: true,
    });

    expect(run.stderr).toContain(`failed to set the OpenCode model or agent for ${existingId}`);
    expect(run.tuiCalls).toHaveLength(0);
  });

  it.each(GENERATIONS)("$name: restore applies the project model", async ({ version, name }) => {
    const cmd = await agent.getRestoreCommand!(
      makeSession({ metadata: { opencodeSessionId: existingId } }),
      { ...project, agentConfig: { model } },
    );
    const run = runAgainstFakeCli(cmd!, { version });

    expect(run.status).toBe(0);
    expect(run.tuiCalls).toHaveLength(1);
    const tui = run.tuiCalls[0]!;
    expect(flagValue(tui, "--session")).toBe(existingId);
    if (name === "2.x") {
      expect(flagValue(tui, "--model")).toBeUndefined();
      const [switchModel] = run.apiCalls;
      expect(modelRefToCli(JSON.parse(flagValue(switchModel!, "-d")!).model)).toBe(model);
    } else {
      expect(flagValue(tui, "--model")).toBe(model);
      expect(run.apiCalls).toHaveLength(0);
    }
  });
});

describe("detect", () => {
  it.each(GENERATIONS)("$name: finds the opencode binary", ({ version }) => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[], opts: object) =>
      actualChildProcess.execFileSync(cmd, args, { ...opts, env: fakeCliEnv({ version }) }),
    );
    writeFileSync(callLog, "");

    expect(detect()).toBe(true);
  });

  it("is false when the opencode binary cannot run", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(detect()).toBe(false);
  });
});
