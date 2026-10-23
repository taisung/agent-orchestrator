import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PREFERRED_GH_PATH,
  type Session,
  type RuntimeHandle,
  type AgentLaunchConfig,
  type ProjectConfig,
} from "@aoagents/ao-core";
import { execFileSync } from "node:child_process";
import type * as NodeChildProcess from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockExecFileAsync,
  mockWriteFile,
  mockMkdir,
  mockReadFile,
  mockReaddir,
  mockRename,
  mockHomedir,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockRename: vi.fn().mockResolvedValue(undefined),
  mockHomedir: vi.fn(() => "/mock/home"),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>();
  const fn = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { ...actual, execFile: fn };
});

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  readdir: mockReaddir,
  rename: mockRename,
}));

vi.mock("node:crypto", () => ({
  randomBytes: () => ({ toString: () => "abc123" }),
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

import { create, manifest, default as defaultExport } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
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

function makeProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "my-project",
    repo: "owner/repo",
    path: "/workspace/repo",
    defaultBranch: "main",
    sessionPrefix: "my",
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
  mockHomedir.mockReturnValue("/mock/home");
});

// =========================================================================
// Manifest & Exports
// =========================================================================
describe("plugin manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "gemini",
      slot: "agent",
      description: "Agent plugin: Gemini CLI",
      version: "0.1.0",
    });
  });

  it("create() returns agent with correct name and processName", () => {
    const agent = create();
    expect(agent.name).toBe("gemini");
    expect(agent.processName).toBe("gemini");
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

  it("generates base command without prompt", () => {
    expect(agent.getLaunchCommand(makeLaunchConfig())).toBe("gemini");
  });

  it("uses -p flag with shell-escaped prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix the bug" }));
    expect(cmd).toBe("gemini -p 'Fix the bug'");
  });

  it("includes -m with shell-escaped model", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "gemini-2.5-pro" }));
    expect(cmd).toBe("gemini -m 'gemini-2.5-pro'");
  });

  it("combines --yolo, model, and prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ permissions: "skip", model: "gemini-2.5-pro", prompt: "Go" }),
    );
    expect(cmd).toBe("gemini --yolo -m 'gemini-2.5-pro' -p 'Go'");
  });

  it("adds --yolo flag for skip permissions", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "skip" }));
    expect(cmd).toBe("gemini --yolo");
  });

  it("adds --yolo flag for permissionless mode (normalized from skip)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "permissionless" }));
    expect(cmd).toBe("gemini --yolo");
  });

  it("does not add --yolo for default permissions", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "default" }));
    expect(cmd).not.toContain("--yolo");
  });

  it("escapes single quotes in prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "it's broken" }));
    expect(cmd).toContain("-p 'it'\\''s broken'");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).not.toContain("-m");
    expect(cmd).not.toContain("-p");
    expect(cmd).not.toContain("--yolo");
  });

  it("prepends cp to write systemPromptFile to GEMINI.md", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/ao-prompt.md", prompt: "Go" }),
    );
    expect(cmd).toBe("cp '/tmp/ao-prompt.md' GEMINI.md && gemini -p 'Go'");
  });

  it("prepends printf to write inline systemPrompt to GEMINI.md", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are an agent", prompt: "Go" }),
    );
    expect(cmd).toBe("printf '%s' 'You are an agent' > GEMINI.md && gemini -p 'Go'");
  });

  it("prefers systemPromptFile over systemPrompt when both set", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md", systemPrompt: "ignored" }),
    );
    expect(cmd).toContain("cp '/tmp/prompt.md' GEMINI.md &&");
    expect(cmd).not.toContain("printf");
  });

  it("does not prepend anything when no system prompt", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Go" }));
    expect(cmd).toBe("gemini -p 'Go'");
    expect(cmd).not.toContain("&&");
  });
});

// =========================================================================
// getEnvironment
// =========================================================================
describe("getEnvironment", () => {
  const agent = create();

  it("sets AO_SESSION_ID", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
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
    expect(env["PATH"]).toMatch(/^\/mock\/home\/\.ao\/bin:/);
  });

  it("sets GH_PATH to the preferred gh binary", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["GH_PATH"]).toBe(PREFERRED_GH_PATH);
  });

  it("deduplicates PATH entries via buildAgentPath", () => {
    const origPath = process.env["PATH"];
    process.env["PATH"] = "/mock/home/.ao/bin:/usr/local/bin:/usr/bin:/usr/local/bin";
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      const entries = (env["PATH"] ?? "").split(":");
      expect(new Set(entries).size).toBe(entries.length);
      expect(entries[0]).toBe("/mock/home/.ao/bin");
    } finally {
      process.env["PATH"] = origPath;
    }
  });
});

// =========================================================================
// isProcessRunning
// =========================================================================
describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when gemini found on tmux pane TTY", async () => {
    mockTmuxWithProcess("gemini");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when gemini not on tmux pane TTY", async () => {
    mockTmuxWithProcess("gemini", false);
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
      message: "gemini: ps -eo pid,tty,args failed",
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

  it("rejects when tmux list-panes returns empty", async () => {
    mockPaneAnswers("", VALID_PS);
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(
      /not a list of pane TTYs/,
    );
    expect(mockExecFileAsync).not.toHaveBeenCalledWith("ps", expect.anything(), expect.anything());
  });

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

  it("control: a valid list on a Linux pane TTY without gemini answers false", async () => {
    mockPaneAnswers("/dev/pts/73\n", VALID_PS);
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("control: a valid list with gemini on the pane TTY answers true", async () => {
    mockPaneAnswers("/dev/pts/73\n", `${VALID_PS}  124 pts/73   /usr/bin/gemini\n`);
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
    // A pane with gemini on it: an answer from tmux would be true.
    mockTmuxWithProcess("gemini");
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

  it("finds gemini on any pane in multi-pane session", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") {
        return Promise.resolve({ stdout: "/dev/ttys001\n/dev/ttys002\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  bash\n  200 ttys002  gemini -p hello\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });
});

// =========================================================================
// detectActivity
// =========================================================================
describe("detectActivity", () => {
  const agent = create();

  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  ")).toBe("idle");
  });

  it("returns active for non-empty terminal output", () => {
    expect(agent.detectActivity("gemini is working\n")).toBe("active");
  });

  it("returns idle when last line is a prompt character", () => {
    expect(agent.detectActivity("some output\n> ")).toBe("idle");
  });

  it("returns waiting_input for approval prompts", () => {
    expect(agent.detectActivity("Do you approve this?\n(y)es (n)o")).toBe("waiting_input");
  });
});

// =========================================================================
// getActivityState
// =========================================================================
describe("getActivityState", () => {
  const agent = create();

  it("returns exited when no runtimeHandle", async () => {
    const result = await agent.getActivityState(makeSession({ runtimeHandle: null }));
    expect(result?.state).toBe("exited");
  });

  it("rejects when the process check cannot run", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("tmux not running"));
    await expect(
      agent.getActivityState(makeSession({ runtimeHandle: makeTmuxHandle() })),
    ).rejects.toThrow();
  });

  it("returns null when process is running (cannot scope sessions per workspace)", async () => {
    mockTmuxWithProcess("gemini");
    const result = await agent.getActivityState(makeSession({ runtimeHandle: makeTmuxHandle() }));
    expect(result).toBeNull();
  });
});

// =========================================================================
// getSessionInfo
// =========================================================================
describe("getSessionInfo", () => {
  const agent = create();

  it("always returns null (cannot scope sessions per workspace)", async () => {
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
    expect(await agent.getSessionInfo(makeSession({ workspacePath: "/some/path" }))).toBeNull();
  });
});

// =========================================================================
// getRestoreCommand
// =========================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  it("returns null when no Gemini sessions exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const cmd = await agent.getRestoreCommand!(makeSession(), makeProjectConfig());
    expect(cmd).toBeNull();
  });

  it("returns gemini -r latest when sessions exist", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const cmd = await agent.getRestoreCommand!(makeSession(), makeProjectConfig());
    expect(cmd).toBe("gemini -r latest");
  });

  it("includes --yolo when permissions is permissionless", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const project = makeProjectConfig({ agentConfig: { permissions: "permissionless" } });
    const cmd = await agent.getRestoreCommand!(makeSession(), project);
    expect(cmd).toBe("gemini --yolo -r latest");
  });

  it("includes -m when model is configured", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const project = makeProjectConfig({ agentConfig: { model: "gemini-2.5-pro" } });
    const cmd = await agent.getRestoreCommand!(makeSession(), project);
    expect(cmd).toBe("gemini -m 'gemini-2.5-pro' -r latest");
  });

  it("includes both --yolo and -m when both configured", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const project = makeProjectConfig({
      agentConfig: { permissions: "skip", model: "gemini-2.5-pro" },
    });
    const cmd = await agent.getRestoreCommand!(makeSession(), project);
    expect(cmd).toBe("gemini --yolo -m 'gemini-2.5-pro' -r latest");
  });

  it("prefers the effective (persisted spawn) model over the config model", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const project = makeProjectConfig({ agentConfig: { model: "config-model" } });
    const cmd = await agent.getRestoreCommand!(makeSession(), project, "spawn-model-X");
    expect(cmd).toBe("gemini -m 'spawn-model-X' -r latest");
  });

  it("uses the effective model when the config has none", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const cmd = await agent.getRestoreCommand!(makeSession(), makeProjectConfig(), "spawn-model-X");
    expect(cmd).toBe("gemini -m 'spawn-model-X' -r latest");
  });

  it("restore with stored default matches a launch with no mode (no --yolo)", async () => {
    mockReaddir.mockResolvedValue(["project-1"]);
    const launch = agent.getLaunchCommand(makeLaunchConfig());
    const restore = await agent.getRestoreCommand!(
      makeSession(),
      makeProjectConfig({ agentConfig: { permissions: "default" } }),
    );
    expect(launch).not.toContain("--yolo");
    expect(restore).not.toContain("--yolo");
  });
});

// =========================================================================
// setupWorkspaceHooks — shared shell wrapper creation + .ao/AGENTS.md
// =========================================================================
describe("setupWorkspaceHooks", () => {
  const agent = create();

  it("creates ~/.ao/bin directory", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });
    expect(mockMkdir).toHaveBeenCalledWith("/mock/home/.ao/bin", { recursive: true });
  });

  it("writes ao-metadata-helper.sh", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const helperCalls = mockWriteFile.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("ao-metadata-helper"),
    );
    expect(helperCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("installs the shared helper that updates metadata under a /var/tmp state root", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const helperCall = mockWriteFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("ao-metadata-helper.sh.tmp."),
    );
    expect(helperCall).toBeDefined();
    const helperContent = String(helperCall?.[1]);
    expect(helperContent).toContain("local ao_state_root=");

    const stateRoot = mkdtempSync("/var/tmp/ao-gemini-state-");
    const sessionsDir = join(stateRoot, "instance", "sessions");
    const helperPath = join(stateRoot, "ao-metadata-helper.sh");
    const metadataPath = join(sessionsDir, "gemini-1");

    try {
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(helperPath, helperContent);
      writeFileSync(metadataPath, "status=working\n");

      execFileSync(
        "bash",
        ["-c", 'source "$1"; update_ao_metadata status pr_open', "bash", helperPath],
        {
          env: {
            ...process.env,
            AO_STATE_ROOT: stateRoot,
            AO_DATA_DIR: sessionsDir,
            AO_SESSION: "gemini-1",
          },
        },
      );

      expect(readFileSync(metadataPath, "utf8")).toBe("status=pr_open\n");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("installs a helper that refuses privileged keys (m-10)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const helperCall = mockWriteFile.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("ao-metadata-helper.sh.tmp."),
    );
    const helperContent = String(helperCall?.[1]);
    expect(helperContent).toContain("allowed: pr, status, branch");
    expect(helperContent).toContain('[[ "$value" != "pr_open" ]]');
  });

  it("writes gh and git wrappers when version marker is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const writtenFiles = mockWriteFile.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writtenFiles.some((f: string) => f.includes("/gh.tmp."))).toBe(true);
    expect(writtenFiles.some((f: string) => f.includes("/git.tmp."))).toBe(true);
  });

  it("repairs gh/git wrappers when version marker is current but files are missing", async () => {
    // The current version is the marker that a first install writes.
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });
    const markerWrite = mockWriteFile.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes(".ao-version.tmp."),
    );
    const currentVersion = String(markerWrite?.[1]);
    expect(currentVersion).toMatch(/^\d+\.\d+\.\d+$/);
    mockWriteFile.mockClear();

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes(".ao-version")) return Promise.resolve(currentVersion);
      return Promise.reject(new Error("ENOENT"));
    });

    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    // A matching marker with missing files must be repaired.
    const writtenFiles = mockWriteFile.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(writtenFiles.some((f: string) => f.includes("/gh.tmp."))).toBe(true);
    expect(writtenFiles.some((f: string) => f.includes("/git.tmp."))).toBe(true);
  });

  it("writes session context to .ao/AGENTS.md without modifying the repository AGENTS.md", async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes("AGENTS.md")) return Promise.resolve("# Existing content\n");
      return Promise.reject(new Error("ENOENT"));
    });

    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const agentsMdCalls = mockWriteFile.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("AGENTS.md"),
    );
    expect(agentsMdCalls.length).toBe(1);
    expect(agentsMdCalls[0][0]).toBe("/workspace/test/.ao/AGENTS.md");
    const content = agentsMdCalls[0][1] as string;
    expect(content).toContain("Agent Orchestrator (ao) Session");
    expect(content).not.toContain("# Existing content");
  });

  it("creates .ao/AGENTS.md if it does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const agentsMdCalls = mockWriteFile.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("AGENTS.md"),
    );
    expect(agentsMdCalls.length).toBe(1);
    expect(agentsMdCalls[0][0]).toBe("/workspace/test/.ao/AGENTS.md");
    const content = agentsMdCalls[0][1] as string;
    expect(content).toContain("Agent Orchestrator (ao) Session");
  });

  it("rewrites deterministic .ao/AGENTS.md content on repeated setup", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });
    await agent.setupWorkspaceHooks!("/workspace/test", { dataDir: "/data" });

    const agentsMdCalls = mockWriteFile.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("AGENTS.md"),
    );
    expect(agentsMdCalls).toHaveLength(2);
    expect(agentsMdCalls[0][0]).toBe("/workspace/test/.ao/AGENTS.md");
    expect(agentsMdCalls[1]).toEqual(agentsMdCalls[0]);
  });
});

// =========================================================================
// postLaunchSetup
// =========================================================================
describe("postLaunchSetup", () => {
  const agent = create();

  it("delegates to workspace setup when workspacePath is set", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await agent.postLaunchSetup!(makeSession({ workspacePath: "/workspace/test" }));
    expect(mockMkdir).toHaveBeenCalledWith("/mock/home/.ao/bin", { recursive: true });
  });

  it("does nothing when workspacePath is null", async () => {
    await agent.postLaunchSetup!(makeSession({ workspacePath: null }));
    expect(mockMkdir).not.toHaveBeenCalled();
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

  it("is true when gemini runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "gemini --model pro", name: "gemini", pid: 42 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(true);
  });

  it("queries herdr for the pane instead of scanning tmux", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "gemini --model pro", name: "gemini", pid: 42 }]),
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
        paneProcesses([{ cmdline: "gemini --model pro", name: "gemini", pid: 42 }]),
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
