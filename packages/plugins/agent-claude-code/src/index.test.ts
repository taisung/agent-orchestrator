import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GH_WRAPPER,
  GIT_WRAPPER,
  type Session,
  type RuntimeHandle,
  type ActivityState,
  type AgentLaunchConfig,
  type WorkspaceHooksConfig,
} from "@aoagents/ao-core";

// ---------------------------------------------------------------------------
// Hoisted mocks — available inside vi.mock factories
// ---------------------------------------------------------------------------
const {
  mockExecFileAsync,
  mockReaddir,
  mockReadFile,
  mockStat,
  mockHomedir,
  mockWriteFile,
  mockMkdir,
  mockChmod,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockStat: vi.fn(),
  mockHomedir: vi.fn(() => "/mock/home"),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockChmod: vi.fn().mockResolvedValue(undefined),
  mockExistsSync: vi.fn().mockReturnValue(false),
}));

vi.mock("node:child_process", () => {
  const fn = Object.assign((..._args: unknown[]) => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
  });
  return { execFile: fn };
});

vi.mock("node:fs/promises", () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  chmod: mockChmod,
}));

// Only existsSync is mocked: core's removeAoBinFromPath and the launch tests
// below use the real file system.
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof Fs>()),
  existsSync: mockExistsSync,
}));

vi.mock("node:os", () => ({
  homedir: mockHomedir,
}));

import { create, manifest, default as defaultExport, resetPsCache, METADATA_UPDATER_SCRIPT } from "./index.js";
import IDLE_BYPASS_307 from "./__fixtures__/claude-2.1.307-idle-bypass.txt?raw";
import IDLE_PASTE_HINT_307 from "./__fixtures__/claude-2.1.307-idle-paste-hint.txt?raw";
import RUNNING_01_306 from "./__fixtures__/claude-2.1.306-running-01.txt?raw";
import RUNNING_DIFFPANEL_306 from "./__fixtures__/claude-2.1.306-running-diffpanel.txt?raw";
import DIALOG_T1_304 from "./__fixtures__/claude-2.1.304-dialog-t1-01_before.txt?raw";
import DIALOG_T3_304 from "./__fixtures__/claude-2.1.304-dialog-t3-00b_after_down.txt?raw";
import DIALOG_T4_304 from "./__fixtures__/claude-2.1.304-dialog-t4-00c_typed_text.txt?raw";
import DIALOG_T5_OPEN_304 from "./__fixtures__/claude-2.1.304-dialog-t5-00_dialog_open.txt?raw";
import DIALOG_T5_PASTE1_304 from "./__fixtures__/claude-2.1.304-dialog-t5-paste1-03_verify1.txt?raw";
import DIALOG_T5_PASTE3_304 from "./__fixtures__/claude-2.1.304-dialog-t5-paste3-03_verify1.txt?raw";
import RUNNING_T2_00B_304 from "./__fixtures__/claude-2.1.304-running-t2-00b_after_key_2.txt?raw";
import RUNNING_T2_03_304 from "./__fixtures__/claude-2.1.304-running-t2-03_verify1.txt?raw";
import RUNNING_T4_304 from "./__fixtures__/claude-2.1.304-running-t4-03_verify1.txt?raw";
import RUNNING_T8_304 from "./__fixtures__/claude-2.1.304-running-t8-03_verify1.txt?raw";
import IDLE_T1_304 from "./__fixtures__/claude-2.1.304-idle-t1-03_verify1.txt?raw";
import IDLE_T2_INPUT_304 from "./__fixtures__/claude-2.1.304-idle-t2-02_input_text.txt?raw";
import IDLE_T5_PASTE4_304 from "./__fixtures__/claude-2.1.304-idle-t5-paste4-03_verify1.txt?raw";

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
    workspacePath: "/workspace/test-project",
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

function makeProcessHandle(pid?: number): RuntimeHandle {
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

function mockTmuxWithProcess(processName = "claude", tty = "/dev/ttys001", pid = 12345) {
  mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "tmux" && args[0] === "list-panes") {
      return Promise.resolve({ stdout: `${tty}\n`, stderr: "" });
    }
    if (cmd === "ps") {
      const ttyShort = tty.replace(/^\/dev\//, "");
      // Matches `ps -eo pid,tty,args` output format
      return Promise.resolve({
        stdout: `  PID TT       ARGS\n  ${pid} ${ttyShort}  ${processName}\n`,
        stderr: "",
      });
    }
    return Promise.reject(new Error(`Unexpected: ${cmd} ${args.join(" ")}`));
  });
}

function mockJsonlFiles(
  jsonlContent: string,
  files = ["session-abc123.jsonl"],
  mtime = new Date(1700000000000),
) {
  mockReaddir.mockResolvedValue(files);
  mockStat.mockResolvedValue({ mtimeMs: mtime.getTime(), mtime });
  mockReadFile.mockResolvedValue(jsonlContent);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  resetPsCache();
  mockHomedir.mockReturnValue("/mock/home");
});

describe("plugin manifest & exports", () => {
  it("has correct manifest", () => {
    expect(manifest).toEqual({
      name: "claude-code",
      slot: "agent",
      description: "Agent plugin: Claude Code CLI",
      version: "0.1.0",
      displayName: "Claude Code",
    });
  });

  it("create() returns an agent with correct name and processName", () => {
    const agent = create();
    expect(agent.name).toBe("claude-code");
    expect(agent.processName).toBe("claude");
    expect(agent.promptDelivery).toBe("post-launch");
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

  it("generates base command without shell syntax", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "default" }));
    expect(cmd).toBe("claude");
    // Must not contain shell operators (execFile-safe)
    expect(cmd).not.toContain("&&");
    expect(cmd).not.toContain("unset");
  });

  it("includes --dangerously-skip-permissions when permissions=permissionless", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "permissionless" }));
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("treats legacy permissions=skip as permissionless", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ permissions: "skip" as unknown as AgentLaunchConfig["permissions"] }),
    );
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("maps permissions=auto-edit to no-prompt mode on Claude", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "auto-edit" }));
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("shell-escapes model argument", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ model: "claude-opus-4-6" }));
    expect(cmd).toContain("--model 'claude-opus-4-6'");
  });

  it("does not include -p flag (prompt delivered post-launch)", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ prompt: "Fix the bug" }));
    expect(cmd).not.toContain("-p");
    expect(cmd).not.toContain("Fix the bug");
  });

  it("combines all options without prompt", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ permissions: "permissionless", model: "opus", prompt: "Hello" }),
    );
    expect(cmd).toBe("claude --dangerously-skip-permissions --model 'opus'");
  });

  it("omits --dangerously-skip-permissions when permissions=default", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig({ permissions: "default" }));
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("omits optional flags when not provided", () => {
    const cmd = agent.getLaunchCommand(makeLaunchConfig());
    expect(cmd).not.toContain("--model");
    expect(cmd).not.toContain("-p");
  });

  it("includes --append-system-prompt alongside omitted -p", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPrompt: "You are a helper", prompt: "Do the task" }),
    );
    expect(cmd).toContain("--append-system-prompt");
    expect(cmd).toContain("You are a helper");
    // -p as a standalone flag (not substring of --append-system-prompt)
    expect(cmd).not.toMatch(/\s-p\s/);
    expect(cmd).not.toContain("Do the task");
  });

  it("uses systemPromptFile via shell substitution alongside omitted -p", () => {
    const cmd = agent.getLaunchCommand(
      makeLaunchConfig({ systemPromptFile: "/tmp/prompt.md", prompt: "Do the task" }),
    );
    expect(cmd).toContain('--append-system-prompt "$(cat');
    expect(cmd).toContain("/tmp/prompt.md");
    expect(cmd).not.toMatch(/\s-p\s/);
    expect(cmd).not.toContain("Do the task");
  });
});

// =========================================================================
// getEnvironment
// =========================================================================
describe("getEnvironment", () => {
  const agent = create();

  it("sets CLAUDECODE to empty string (replaces unset in command)", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["CLAUDECODE"]).toBe("");
  });

  it("sets AO_SESSION_ID but not AO_PROJECT_ID (caller's responsibility)", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_SESSION_ID"]).toBe("sess-1");
    expect(env["AO_PROJECT_ID"]).toBeUndefined();
  });

  it("sets AO_ISSUE_ID when provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig({ issueId: "INT-100" }));
    expect(env["AO_ISSUE_ID"]).toBe("INT-100");
  });

  it("does not set AO_ISSUE_ID when not provided", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["AO_ISSUE_ID"]).toBeUndefined();
  });

  it("sets no PATH when the inherited PATH holds only absolute entries and no wrappers", () => {
    // Such a PATH reaches the pane unchanged, as before ao had wrappers: no
    // PATH that could resolve another `claude` binary.
    vi.stubEnv("PATH", "/usr/bin/:/bin:/usr/bin");
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      expect(env).not.toHaveProperty("PATH");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("removes relative entries from the inherited PATH and keeps the absolute ones", () => {
    vi.stubEnv("PATH", "/usr/bin::.:tools:/bin");
    try {
      const env = agent.getEnvironment(makeLaunchConfig());
      expect(env["PATH"]).toBe("/usr/bin:/bin");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sets an empty GH_PATH (the PostToolUse hook is the only metadata writer)", () => {
    const env = agent.getEnvironment(makeLaunchConfig());
    expect(env["GH_PATH"]).toBe("");
  });
});

// =========================================================================
// Launch from a parent whose PATH holds the ao wrappers
//
// `ao spawn`, `ao start` or `ao session restore` run in a Codex, Gemini or
// OpenCode pane inherit that pane's PATH with ~/.ao/bin and its GH_PATH. All
// three build the launch environment from getEnvironment, and the runtime
// starts the pane with the launch environment over the parent environment:
// runtime-tmux runs the tmux client with process.env plus the PATH of the
// launch environment (tmux gives the pane the client's PATH), and -e values
// win over the server environment, which this parent can have started. So a
// real process started that way must find no wrapper.
// =========================================================================
describe("launch from a parent whose PATH holds the ao wrappers", () => {
  const agent = create();
  const basePath = "/usr/bin:/bin";
  let root: string;
  let home: string;
  let binDir: string;

  function installWrappers(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gh"), GH_WRAPPER, { mode: 0o755 });
    writeFileSync(join(dir, "git"), GIT_WRAPPER, { mode: 0o755 });
  }

  /** The parent environment, and the launch environment over it. */
  function environments(parentEntry: string): {
    parent: NodeJS.ProcessEnv;
    child: NodeJS.ProcessEnv;
  } {
    const parent = {
      ...process.env,
      PATH: `${parentEntry}:${basePath}`,
      GH_PATH: join(binDir, "gh"),
    };
    vi.stubEnv("PATH", parent.PATH);
    vi.stubEnv("GH_PATH", parent.GH_PATH);
    const launchEnv = agent.getEnvironment(makeLaunchConfig());
    vi.unstubAllEnvs();
    return { parent, child: { ...parent, ...launchEnv } };
  }

  async function runBash(script: string, env: NodeJS.ProcessEnv, cwd?: string): Promise<string> {
    const { spawnSync } = await vi.importActual<typeof ChildProcess>("node:child_process");
    return spawnSync("bash", ["-c", script], { env, cwd, encoding: "utf8" }).stdout;
  }

  async function launch(
    parentEntry: string,
  ): Promise<{ path: string; ghPath: string; found: string }> {
    const stdout = await runBash(
      'printf "%s\\n" "$PATH"; printenv GH_PATH || echo unset; type -ap git gh',
      environments(parentEntry).child,
    );
    const [path = "", ghPath = "", ...found] = stdout.split("\n");
    return { path, ghPath, found: found.join("\n") };
  }

  beforeEach(() => {
    root = mkdtempSync("/tmp/ao-claude-launch-");
    home = join(root, "home");
    binDir = join(home, ".ao", "bin");
    installWrappers(binDir);
    mockHomedir.mockReturnValue(home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  const spellings: Array<[string, () => string]> = [
    ["this HOME's ~/.ao/bin", () => binDir],
    ["a trailing slash", () => `${binDir}/`],
    ["a doubled slash", () => binDir.replace("/.ao/bin", "/.ao//bin")],
    ["a leading ~", () => "~/.ao/bin"],
    [
      "a symlink to it",
      () => {
        symlinkSync(binDir, join(root, "aolink"));
        return join(root, "aolink");
      },
    ],
    [
      "the wrapper directory of another HOME",
      () => {
        installWrappers(join(root, "other-home", ".ao", "bin"));
        return join(root, "other-home", ".ao", "bin");
      },
    ],
    [
      "a wrapper copy in another directory",
      () => {
        installWrappers(join(root, "copy"));
        return join(root, "copy");
      },
    ],
    [
      "a wrapper directory that an install creates later",
      () => join(root, "new-home", ".ao", "bin"),
    ],
    [
      "a symlink followed by .. (the kernel follows the link first)",
      () => {
        mkdirSync(join(home, ".ao", "subdir"));
        mkdirSync(join(root, "lexical"));
        symlinkSync(join(home, ".ao", "subdir"), join(root, "lexical", "link"));
        return `${join(root, "lexical", "link")}/../bin`;
      },
    ],
  ];

  it("the pane gets no wrapper through a relative entry, also after a cd", async () => {
    // relative-link points at the wrappers in the pane's first directory and
    // in the directory it changes to, so the parent PATH reaches the
    // wrappers from both.
    for (const dir of ["ws", "other"]) {
      mkdirSync(join(root, dir));
      symlinkSync(binDir, join(root, dir, "relative-link"));
    }
    const wrappersBeforeAndAfterCd = [
      "wrappers() {",
      "  local name file line",
      "  for name in git gh; do",
      '    for file in $(type -ap "$name"); do',
      '      line=$(sed -n 2p "$file")',
      '      if [[ "$line" == "# ao $name wrapper"* ]]; then echo "$PWD $file"; fi',
      "    done",
      "  done",
      "}",
      'printf "%s\\n" "$PATH"; wrappers; cd ../other && wrappers',
    ].join("\n");
    const { parent, child } = environments("relative-link");

    // The parent environment alone reaches the wrappers before and after the cd.
    const control = await runBash(wrappersBeforeAndAfterCd, parent, join(root, "ws"));
    expect(control).toContain(`${join(root, "ws")} relative-link/git`);
    expect(control).toContain(`${join(root, "other")} relative-link/gh`);

    const pane = await runBash(wrappersBeforeAndAfterCd, child, join(root, "ws"));
    expect(pane).toBe(`${basePath}\n`);
  });

  it.each(spellings)("the pane gets no wrapper and no GH_PATH for %s", async (_, spell) => {
    const result = await launch(spell());
    expect(result.path).toBe(basePath);
    expect(result.ghPath).toBe("");
    expect(result.found).not.toContain(root);
    expect(result.found).toMatch(/\/git$/m);
  });
});

// =========================================================================
// isProcessRunning
// =========================================================================
describe("isProcessRunning", () => {
  const agent = create();

  it("returns true when claude is found on tmux pane TTY", async () => {
    mockTmuxWithProcess("claude");
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("returns false when no claude on tmux pane TTY", async () => {
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys002\n", stderr: "" });
      if (cmd === "ps")
        return Promise.resolve({
          stdout: "  PID TT       ARGS\n  999 ttys002  bash\n",
          stderr: "",
        });
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("rejects when tmux list-panes returns empty (F-6)", async () => {
    // An empty answer is not a list of panes: it proves nothing about claude.
    mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(
      "not a list of pane TTYs",
    );
  });

  it("returns true for process runtime with alive PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    expect(await agent.isProcessRunning(makeProcessHandle(999))).toBe(true);
    expect(killSpy).toHaveBeenCalledWith(999, 0);
    killSpy.mockRestore();
  });

  it("returns false for process runtime with dead PID", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    });
    expect(await agent.isProcessRunning(makeProcessHandle(999))).toBe(false);
    killSpy.mockRestore();
  });

  it("rejects for unknown runtime without PID (no pgrep fallback) (F-6)", async () => {
    // No pane and no PID: the check cannot run, so it is no evidence of exit.
    const handle: RuntimeHandle = { id: "x", runtimeName: "other", data: {} };
    await expect(agent.isProcessRunning(handle)).rejects.toThrow(
      "no pane and no valid PID to check",
    );
    // Must NOT call pgrep — could match wrong session
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  it("rejects when tmux command fails", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("fail"));
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toThrow(
      "tmux list-panes -t =test-session: failed",
    );
  });

  it("returns false when tmux answers that the pane does not exist", async () => {
    // tmux 3.4: list-panes -t =<name>: on a missing session prints
    // "can't find session: <name>" (F-6: "can't find window" rejects).
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("Command failed: tmux list-panes"), {
        code: 1,
        stderr: "can't find session: test-session\n",
      }),
    );
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
    expect(mockExecFileAsync).not.toHaveBeenCalledWith("ps", expect.anything(), expect.anything());
  });

  it("returns false when a server with no session answers 'no current target' (m-1)", async () => {
    // tmux 3.4, `exit-empty off`, the last session ended: list-panes prints this.
    mockExecFileAsync.mockRejectedValue(
      Object.assign(new Error("Command failed: tmux list-panes"), {
        code: 1,
        stderr: "no current target\n",
      }),
    );
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });

  it("rejects with the ps failure as cause when ps cannot run", async () => {
    const psFailure = Object.assign(new Error("Command failed: ps -eo pid,tty,args"), { code: 1 });
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if (cmd === "tmux") return Promise.resolve({ stdout: "/dev/ttys002\n", stderr: "" });
      return Promise.reject(psFailure);
    });
    await expect(agent.isProcessRunning(makeTmuxHandle())).rejects.toMatchObject({
      message: "claude-code: ps -eo pid,tty,args failed",
      cause: psFailure,
    });
  });

  it("returns true when PID exists but throws EPERM", async () => {
    const epermErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw epermErr;
    });
    expect(await agent.isProcessRunning(makeProcessHandle(789))).toBe(true);
    killSpy.mockRestore();
  });

  it("finds claude on any pane in multi-pane session", async () => {
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "list-panes") {
        return Promise.resolve({ stdout: "/dev/ttys001\n/dev/ttys002\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  bash\n  200 ttys002  claude -p test\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(true);
  });

  it("does not match similar process names like claude-code", async () => {
    mockExecFileAsync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "tmux" && args[0] === "list-panes") {
        return Promise.resolve({ stdout: "/dev/ttys001\n", stderr: "" });
      }
      if (cmd === "ps") {
        return Promise.resolve({
          stdout: "  PID TT ARGS\n  100 ttys001  /usr/bin/claude-code\n",
          stderr: "",
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    expect(await agent.isProcessRunning(makeTmuxHandle())).toBe(false);
  });
});

// =========================================================================
// detectActivity — terminal output classification
// =========================================================================
describe("detectActivity", () => {
  const agent = create();

  it("returns idle for empty terminal output", () => {
    expect(agent.detectActivity("")).toBe("idle");
  });

  it("returns idle for whitespace-only terminal output", () => {
    expect(agent.detectActivity("   \n  \n  ")).toBe("idle");
  });

  it("returns active when 'esc to interrupt' is visible", () => {
    expect(agent.detectActivity("Working... esc to interrupt\n")).toBe("active");
  });

  it("returns active when Thinking indicator is visible", () => {
    expect(agent.detectActivity("Thinking...\n")).toBe("active");
  });

  it("returns active when Reading indicator is visible", () => {
    expect(agent.detectActivity("Reading file src/index.ts\n")).toBe("active");
  });

  it("returns active when Writing indicator is visible", () => {
    expect(agent.detectActivity("Writing to src/main.ts\n")).toBe("active");
  });

  it("returns active when Searching indicator is visible", () => {
    expect(agent.detectActivity("Searching codebase...\n")).toBe("active");
  });

  it("returns waiting_input for permission prompt (Y/N)", () => {
    expect(agent.detectActivity("Do you want to proceed? (Y)es / (N)o\n")).toBe("waiting_input");
  });

  it("returns waiting_input for 'Do you want to proceed?' prompt", () => {
    expect(agent.detectActivity("Do you want to proceed?\n")).toBe("waiting_input");
  });

  it("never reads the bypass permissions text as waiting_input", () => {
    // The footer of every session that ao starts says `⏵⏵ bypass permissions
    // on`: a mode, not a prompt. A line with no input box keeps the default.
    expect(agent.detectActivity("bypass all future permissions for this session\n")).toBe("active");
    expect(agent.detectActivity(IDLE_BYPASS_307)).toBe("idle");
  });

  it("returns active when queued message indicator is visible", () => {
    expect(agent.detectActivity("Press up to edit queued messages\n")).toBe("active");
  });

  it("returns idle when shell prompt is visible", () => {
    expect(agent.detectActivity("some output\n> ")).toBe("idle");
    expect(agent.detectActivity("some output\n$ ")).toBe("idle");
  });

  it("returns idle when prompt follows historical activity indicators", () => {
    // Key regression test: historical "Reading file..." output in the buffer
    // should NOT override an idle prompt on the last line.
    expect(agent.detectActivity("Reading file src/index.ts\nWriting to out.ts\n❯ ")).toBe("idle");
    expect(agent.detectActivity("Thinking...\nSearching codebase...\n$ ")).toBe("idle");
  });

  it("returns waiting_input when permission prompt follows historical activity", () => {
    // Permission prompt at the bottom should NOT be overridden by historical
    // "Reading"/"Thinking" output higher in the buffer.
    expect(
      agent.detectActivity("Reading file src/index.ts\nThinking...\nDo you want to proceed?\n"),
    ).toBe("waiting_input");
    expect(agent.detectActivity("Searching codebase...\n(Y)es / (N)o\n")).toBe("waiting_input");
  });

  it("returns active for non-empty output with no special patterns", () => {
    expect(agent.detectActivity("some random terminal output\n")).toBe("active");
  });
});

// =========================================================================
// detectActivity on real Claude Code 2.1.304 to 2.1.307 screens
// =========================================================================
// The 2.1.306 and 2.1.307 files are real 98x60 panes of 2026-10-21 (ao-59
// idle, ao-55 and ao-52 running), copied byte for byte from the
// orchestrator's fixtures. The 2.1.304 files are the 120x50 fullscreen
// captures of as-77 (2026-10-20, `dialog_paste_2026_10_20/captures/`, the
// trial and file name are in each name). On 48f500af every 2.1.304 file
// reads `active`, and every 2.1.306 and 2.1.307 file reads `waiting_input`
// (the bypass footer).
describe("detectActivity on Claude Code 2.1.304 to 2.1.307 screens", () => {
  const agent = create();

  const FIXTURES: Record<string, string> = {
    "claude-2.1.307-idle-bypass.txt": IDLE_BYPASS_307,
    "claude-2.1.307-idle-paste-hint.txt": IDLE_PASTE_HINT_307,
    "claude-2.1.306-running-01.txt": RUNNING_01_306,
    "claude-2.1.306-running-diffpanel.txt": RUNNING_DIFFPANEL_306,
    "claude-2.1.304-dialog-t1-01_before.txt": DIALOG_T1_304,
    "claude-2.1.304-dialog-t3-00b_after_down.txt": DIALOG_T3_304,
    "claude-2.1.304-dialog-t4-00c_typed_text.txt": DIALOG_T4_304,
    "claude-2.1.304-dialog-t5-00_dialog_open.txt": DIALOG_T5_OPEN_304,
    "claude-2.1.304-dialog-t5-paste1-03_verify1.txt": DIALOG_T5_PASTE1_304,
    "claude-2.1.304-dialog-t5-paste3-03_verify1.txt": DIALOG_T5_PASTE3_304,
    "claude-2.1.304-running-t2-00b_after_key_2.txt": RUNNING_T2_00B_304,
    "claude-2.1.304-running-t2-03_verify1.txt": RUNNING_T2_03_304,
    "claude-2.1.304-running-t4-03_verify1.txt": RUNNING_T4_304,
    "claude-2.1.304-running-t8-03_verify1.txt": RUNNING_T8_304,
    "claude-2.1.304-idle-t1-03_verify1.txt": IDLE_T1_304,
    "claude-2.1.304-idle-t2-02_input_text.txt": IDLE_T2_INPUT_304,
    "claude-2.1.304-idle-t5-paste4-03_verify1.txt": IDLE_T5_PASTE4_304,
  };

  /** The SHA-256 of the source files (the orchestrator's fixtures and the as-77 captures). */
  const SOURCE_SHA256: Record<string, string> = {
    "claude-2.1.307-idle-bypass.txt":
      "83f9fcc94eb8a7c3b00d959cb604cd6972dfcac56857583943d962101a9de331",
    "claude-2.1.307-idle-paste-hint.txt":
      "f2e40810d3c002940b065b7f31c78d733a28b878eeb2f0cb47d7d16e53fc5212",
    "claude-2.1.306-running-01.txt":
      "fba92a4cd48aa0f66249004ce8a3c0494129183a6768923ef98c81480c890d55",
    "claude-2.1.306-running-diffpanel.txt":
      "3d4436bfe226856446230a61fd623cc1b44cb9c37ad365c25cdfefb56b4b7623",
    "claude-2.1.304-dialog-t1-01_before.txt":
      "267ba2d0587b949f0ddeeb676946068de7a94b7e36ebb383994f990cc1cbd48e",
    "claude-2.1.304-dialog-t3-00b_after_down.txt":
      "507f2d19d7250934481e7d8a60c313e476167480b3782746e99fab9eac9ed88d",
    "claude-2.1.304-dialog-t4-00c_typed_text.txt":
      "bf484662cf614a56866b99ada0bc8b150be73cbb3dabbb03c0851efee990ca16",
    "claude-2.1.304-dialog-t5-00_dialog_open.txt":
      "f339bb1fe8eae0a7f0ed4eeb23b9871524ab48488f16444375e6410a650be4b6",
    "claude-2.1.304-dialog-t5-paste1-03_verify1.txt":
      "0110b0af58267270b6f49839a836181560a0c4067acbad3300882cfa37aa1e4e",
    "claude-2.1.304-dialog-t5-paste3-03_verify1.txt":
      "625b6a14e1a99547e83738301dd69fc2c7430e211a5fa080d15bfcdb9acb9317",
    "claude-2.1.304-running-t2-00b_after_key_2.txt":
      "99b471f3b9ccb7866b5e041000ccd0928469216c6f1ba93049937ffc85ee0a21",
    "claude-2.1.304-running-t2-03_verify1.txt":
      "d593f4865d1835d828b43777b0ffa2c0116f960a9a01311ecf5ec12e2d600dd0",
    "claude-2.1.304-running-t4-03_verify1.txt":
      "0ffb8897fac95ee46213d4b24d7b7f9309f8eff76146ab1fa8e11aa458afe8f5",
    "claude-2.1.304-running-t8-03_verify1.txt":
      "41636e2d4a4eeef3e228abebc1fdd655549563bc1b9b175ecd3bc41f4bc23c8f",
    "claude-2.1.304-idle-t1-03_verify1.txt":
      "c036944289ab2dee486a0fd3c10e2978312c74481ecbb95297e09bf17ea40b18",
    "claude-2.1.304-idle-t2-02_input_text.txt":
      "82e1de7bfdb258a840bf40b70dbce6ad1dc74ceb02b85acf0d268e697ac14dc4",
    "claude-2.1.304-idle-t5-paste4-03_verify1.txt":
      "b3395a47a1fa83046810b0391c426ab2f23e990dd6e4b5a7e6bea11e5ed12035",
  };

  /** The state of each real screen: from the name, `dialog` reads `waiting_input`. */
  const EXPECTED: Array<[string, ActivityState]> = Object.keys(FIXTURES).map((name) => [
    name,
    name.includes("-dialog-") ? "waiting_input" : name.includes("-running-") ? "active" : "idle",
  ]);

  const SPINNER_01 = "✻ Waddling… (15s · ↓ 692 tokens · thinking with xhigh effort)";
  const DONE_ROW = "✻ Brewed for 4s · done 10:41 PM";
  const PROMPT_ROW = "❯\u00a0";

  /** A real screen with its only row `row` replaced by `rows`. */
  function replaceRow(screen: string, row: string, rows: string[]): string {
    const all = screen.replace(/\n$/, "").split("\n");
    expect(all.filter((line) => line === row)).toHaveLength(1);
    const at = all.indexOf(row);
    return [...all.slice(0, at), ...rows, ...all.slice(at + 1)].join("\n") + "\n";
  }

  /** IDLE_BYPASS_307 with the input box, the status line and the footer replaced by `rows`. */
  function replaceBox(rows: string[]): string {
    const all = IDLE_BYPASS_307.replace(/\n$/, "").split("\n");
    expect(all.slice(-4, -3)).toEqual([PROMPT_ROW]);
    return [...all.slice(0, -5), ...rows].join("\n") + "\n";
  }

  it("keeps the real screens byte for byte (the SHA-256 of the source files)", () => {
    const sums = Object.fromEntries(
      Object.entries(FIXTURES).map(([name, screen]) => [
        name,
        createHash("sha256").update(screen, "utf8").digest("hex"),
      ]),
    );
    expect(sums).toEqual(SOURCE_SHA256);
  });

  it.each(EXPECTED)("reads real screen %s as %s", (name, state) => {
    expect(agent.detectActivity(FIXTURES[name] ?? "")).toBe(state);
  });

  it("reads the real screens the same with the trailing line end and blank rows left out", () => {
    for (const [name, state] of EXPECTED) {
      expect([name, agent.detectActivity((FIXTURES[name] ?? "").trimEnd())]).toEqual([name, state]);
    }
  });

  it("reads a spinner row that a message quotes in the transcript of an idle pane as idle", () => {
    const quoted = replaceRow(IDLE_BYPASS_307, DONE_ROW, [
      "● The pane showed this row:",
      `  ${SPINNER_01}`,
    ]);
    expect(agent.detectActivity(quoted)).toBe("idle");

    const userTurn = replaceRow(IDLE_BYPASS_307, DONE_ROW, [`❯ ${SPINNER_01}`]);
    expect(agent.detectActivity(userTurn)).toBe("idle");
  });

  it("reads a spinner row text in the input box as idle", () => {
    expect(
      agent.detectActivity(replaceRow(IDLE_BYPASS_307, PROMPT_ROW, [`${PROMPT_ROW}${SPINNER_01}`])),
    ).toBe("idle");
    expect(
      agent.detectActivity(
        replaceRow(IDLE_BYPASS_307, PROMPT_ROW, [`${PROMPT_ROW}look at this`, `  ${SPINNER_01}`]),
      ),
    ).toBe("idle");
  });

  it("reads a spinner row with a transcript entry between it and the input box as idle", () => {
    const ended = replaceRow(RUNNING_01_306, SPINNER_01, [SPINNER_01, "● Done."]);
    expect(agent.detectActivity(ended)).toBe("idle");

    const doneRow = replaceRow(RUNNING_01_306, SPINNER_01, [SPINNER_01, "", DONE_ROW]);
    expect(agent.detectActivity(doneRow)).toBe("idle");
  });

  it("reads a running turn past blank, indented and panel rows (real layouts, more blank rows)", () => {
    const blanks = replaceRow(RUNNING_01_306, SPINNER_01, [SPINNER_01, "", "", "", "", ""]);
    expect(agent.detectActivity(blanks)).toBe("active");

    const tip = replaceRow(RUNNING_01_306, SPINNER_01, [
      SPINNER_01,
      "  ⎿  Tip: Use /voice to enable push-to-talk dictation",
    ]);
    expect(agent.detectActivity(tip)).toBe("active");
  });

  it("reads a quoted permission prompt in a message or in the input box as idle", () => {
    const quoted = replaceRow(IDLE_BYPASS_307, DONE_ROW, [
      "● The pane asked:",
      "  Do you want to proceed?",
      "  ❯ 1. Yes",
      "    2. No",
    ]);
    expect(agent.detectActivity(quoted)).toBe("idle");

    const input = replaceRow(IDLE_BYPASS_307, PROMPT_ROW, [
      `${PROMPT_ROW}Do you want to proceed? (Y)es / (N)o`,
    ]);
    expect(agent.detectActivity(input)).toBe("idle");

    const running = replaceRow(RUNNING_01_306, SPINNER_01, [
      "● Do you want to proceed?",
      "  (Y)es / (N)o",
      "",
      SPINNER_01,
    ]);
    expect(agent.detectActivity(running)).toBe("active");
  });

  it("reads a permission prompt in place of the input box as waiting_input (derived layout)", () => {
    // No real capture of a 2.1.30x permission prompt exists: the rows below
    // are derived. The real AskUserQuestion captures above are real.
    const prompt = replaceBox([
      "─".repeat(98),
      " Bash command",
      "",
      "   sleep 40",
      "   Wait 40 seconds",
      "",
      " Do you want to proceed?",
      " ❯ 1. Yes",
      "   2. Yes, and don't ask again for sleep commands in /tmp/scratch",
      "   3. No",
      "",
      " Esc to cancel · Tab to amend · ctrl+e to explain",
    ]);
    expect(agent.detectActivity(prompt)).toBe("waiting_input");
  });

  it("reads no dialog for a numbered user turn above a reply, with no input box in view", () => {
    const screen = replaceBox([
      "❯ 1. Fix the tests",
      "  2. Run the gates",
      "",
      "● I start with the tests.",
    ]);
    expect(agent.detectActivity(screen)).toBe("active");
  });
});

// =========================================================================
// getSessionInfo — JSONL parsing
// =========================================================================
describe("getSessionInfo", () => {
  const agent = create();

  it("returns null when workspacePath is null", async () => {
    expect(await agent.getSessionInfo(makeSession({ workspacePath: null }))).toBeNull();
  });

  it("returns null when project directory does not exist", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("returns null when no JSONL files in project dir", async () => {
    mockReaddir.mockResolvedValue(["readme.txt", "config.yaml"]);
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("filters out agent- prefixed JSONL files", async () => {
    mockReaddir.mockResolvedValue(["agent-toolkit.jsonl"]);
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("returns null when JSONL file is empty", async () => {
    mockJsonlFiles("");
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  it("returns null when JSONL has only malformed lines", async () => {
    mockJsonlFiles("not json\nalso not json\n");
    expect(await agent.getSessionInfo(makeSession())).toBeNull();
  });

  describe("path conversion", () => {
    it("converts workspace path to Claude project dir path", async () => {
      mockJsonlFiles('{"type":"user","message":{"content":"hello"}}');
      await agent.getSessionInfo(makeSession({ workspacePath: "/Users/dev/.worktrees/ao/ao-3" }));
      expect(mockReaddir).toHaveBeenCalledWith(
        "/mock/home/.claude/projects/-Users-dev--worktrees-ao-ao-3",
      );
    });
  });

  describe("summary extraction", () => {
    it("extracts summary from last summary event and marks as not fallback", async () => {
      const jsonl = [
        '{"type":"summary","summary":"First summary"}',
        '{"type":"user","message":{"content":"do something"}}',
        '{"type":"summary","summary":"Latest summary"}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("Latest summary");
      expect(result?.summaryIsFallback).toBe(false);
    });

    it("falls back to first user message and marks as fallback", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"Implement the login feature"}}',
        '{"type":"assistant","message":{"content":"I will implement..."}}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("Implement the login feature");
      expect(result?.summaryIsFallback).toBe(true);
    });

    it("truncates long user message to 120 chars", async () => {
      const longMsg = "A".repeat(200);
      const jsonl = `{"type":"user","message":{"content":"${longMsg}"}}`;
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("A".repeat(120) + "...");
      expect(result!.summary!.length).toBe(123);
      expect(result?.summaryIsFallback).toBe(true);
    });

    it("returns null summary when no summary and no user messages", async () => {
      const jsonl = '{"type":"assistant","message":{"content":"Hello"}}';
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBeNull();
      expect(result?.summaryIsFallback).toBeUndefined();
    });

    it("skips user messages with empty content", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"   "}}',
        '{"type":"user","message":{"content":"Real content"}}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("Real content");
      expect(result?.summaryIsFallback).toBe(true);
    });
  });

  describe("session ID extraction", () => {
    it("extracts session ID from filename", async () => {
      mockJsonlFiles('{"type":"user","message":{"content":"hi"}}', ["abc-def-123.jsonl"]);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.agentSessionId).toBe("abc-def-123");
    });
  });

  describe("cost estimation", () => {
    it("aggregates usage.input_tokens and usage.output_tokens", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"type":"assistant","usage":{"input_tokens":1000,"output_tokens":500}}',
        '{"type":"assistant","usage":{"input_tokens":2000,"output_tokens":300}}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost?.inputTokens).toBe(3000);
      expect(result?.cost?.outputTokens).toBe(800);
      expect(result?.cost?.estimatedCostUsd).toBeCloseTo(0.009 + 0.012, 6);
    });

    it("includes cache tokens in input count", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"type":"assistant","usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":500,"cache_creation_input_tokens":200}}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost?.inputTokens).toBe(800);
      expect(result?.cost?.outputTokens).toBe(50);
    });

    it("uses costUSD field when present", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"costUSD":0.05}',
        '{"costUSD":0.03}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost?.estimatedCostUsd).toBeCloseTo(0.08);
    });

    it("prefers costUSD over estimatedCostUsd to avoid double-counting", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"costUSD":0.10,"estimatedCostUsd":0.10}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      // Should use costUSD only, not sum both
      expect(result?.cost?.estimatedCostUsd).toBeCloseTo(0.1);
    });

    it("falls back to estimatedCostUsd when costUSD is absent", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"estimatedCostUsd":0.12}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost?.estimatedCostUsd).toBeCloseTo(0.12);
    });

    it("uses direct inputTokens/outputTokens fields", async () => {
      const jsonl = [
        '{"type":"user","message":{"content":"hi"}}',
        '{"inputTokens":5000,"outputTokens":1000}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost?.inputTokens).toBe(5000);
      expect(result?.cost?.outputTokens).toBe(1000);
    });

    it("returns undefined cost when no usage data", async () => {
      const jsonl = '{"type":"user","message":{"content":"hi"}}';
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.cost).toBeUndefined();
    });
  });

  describe("file selection", () => {
    it("picks the most recently modified JSONL file", async () => {
      mockReaddir.mockResolvedValue(["old.jsonl", "new.jsonl"]);
      mockStat.mockImplementation((path: string) => {
        if (path.endsWith("old.jsonl")) {
          return Promise.resolve({ mtimeMs: 1000, mtime: new Date(1000) });
        }
        return Promise.resolve({ mtimeMs: 2000, mtime: new Date(2000) });
      });
      mockReadFile.mockResolvedValue('{"type":"user","message":{"content":"hi"}}');
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.agentSessionId).toBe("new");
    });

    it("skips JSONL files that fail stat", async () => {
      mockReaddir.mockResolvedValue(["broken.jsonl", "good.jsonl"]);
      mockStat.mockImplementation((path: string) => {
        if (path.endsWith("broken.jsonl")) {
          return Promise.reject(new Error("ENOENT"));
        }
        return Promise.resolve({ mtimeMs: 1000, mtime: new Date(1000) });
      });
      mockReadFile.mockResolvedValue('{"type":"user","message":{"content":"hi"}}');
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.agentSessionId).toBe("good");
    });
  });

  describe("malformed JSONL handling", () => {
    it("skips malformed lines and parses valid ones", async () => {
      const jsonl = [
        "not valid json",
        '{"type":"summary","summary":"Good summary"}',
        "{truncated",
        "",
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("Good summary");
    });

    it("skips JSON null, array, and primitive values", async () => {
      const jsonl = [
        "null",
        "42",
        '"just a string"',
        "[1,2,3]",
        '{"type":"summary","summary":"Valid object"}',
      ].join("\n");
      mockJsonlFiles(jsonl);
      const result = await agent.getSessionInfo(makeSession());
      expect(result?.summary).toBe("Valid object");
    });

    it("handles readFile failure gracefully", async () => {
      mockReaddir.mockResolvedValue(["session.jsonl"]);
      mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
      mockReadFile.mockRejectedValue(new Error("EACCES"));
      const result = await agent.getSessionInfo(makeSession());
      expect(result).toBeNull();
    });
  });
});

// =========================================================================
// METADATA_UPDATER_SCRIPT — content verification (unit tests)
// =========================================================================
describe("METADATA_UPDATER_SCRIPT content", () => {
  it("contains clean_command stripping logic for cd prefixes", () => {
    expect(METADATA_UPDATER_SCRIPT).toContain('clean_command="$command"');
    expect(METADATA_UPDATER_SCRIPT).toMatch(/while.*clean_command.*cd/);
  });

  it("uses $clean_command (not $command) for all regex-based command detection", () => {
    const lines = METADATA_UPDATER_SCRIPT.split("\n");
    for (const line of lines) {
      // Skip comment lines, the initial assignment, and the stripping logic itself
      if (line.trim().startsWith("#")) continue;
      if (line.includes('clean_command="$command"')) continue;
      if (line.includes("while") && line.includes("clean_command")) continue;

      // Any regex match line (=~) should use $clean_command, NOT $command
      if (line.includes("=~") && line.includes("command")) {
        expect(line).toContain("clean_command");
        expect(line).not.toMatch(/"\$command"/);
      }
    }
  });

  it("does NOT use ^-anchored regexes directly on $command for gh/git detection", () => {
    // The old buggy patterns matched $command with ^ anchor.
    // After the fix, ^ is still used but on $clean_command (which has cd stripped).
    expect(METADATA_UPDATER_SCRIPT).not.toMatch(
      /"\$command"\s*=~\s*\^gh/,
    );
    expect(METADATA_UPDATER_SCRIPT).not.toMatch(
      /"\$command"\s*=~\s*\^git/,
    );
  });

  it("strips cd prefixes with both && and ; delimiters", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(/&&\|;/);
  });

  it("handles multiple chained cd commands via while loop", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(/while.*clean_command/);
  });

  it("detects gh pr create on clean_command", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(
      /"\$clean_command"\s*=~\s*\^gh\[/,
    );
  });

  it("detects git checkout -b on clean_command", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(
      /"\$clean_command"\s*=~\s*\^git\[.*checkout/,
    );
  });

  it("detects gh pr merge on clean_command", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(
      /"\$clean_command"\s*=~\s*\^gh\[.*merge/,
    );
  });

  it("limits update_metadata_key to the keys the hook writes (m-10)", () => {
    expect(METADATA_UPDATER_SCRIPT).toContain("allowed: pr, status, branch");
    expect(METADATA_UPDATER_SCRIPT).toContain('update_metadata_key "pr"');
    expect(METADATA_UPDATER_SCRIPT).toContain('update_metadata_key "status" "pr_open"');
    expect(METADATA_UPDATER_SCRIPT).toContain('update_metadata_key "branch"');
  });

  it("refuses privileged status values in update_metadata_key", () => {
    expect(METADATA_UPDATER_SCRIPT).toMatch(/pr_open.*merged|merged.*pr_open/);
  });
});

// =========================================================================
// setupWorkspaceHooks / postLaunchSetup — hook path (symlink safety)
// =========================================================================
describe("hook setup — relative path (symlink-safe)", () => {
  const agent = create();

  /** Extract the hook command from the settings.json that was written */
  function getWrittenHookCommand(): string {
    const settingsWrite = mockWriteFile.mock.calls.find(
      ([path]: unknown[]) => typeof path === "string" && path.endsWith("settings.json"),
    );
    expect(settingsWrite).toBeDefined();
    const parsed = JSON.parse(settingsWrite![1] as string);
    return parsed.hooks.PostToolUse[0].hooks[0].command;
  }

  it("setupWorkspaceHooks writes a relative hook command (not absolute)", async () => {
    await agent.setupWorkspaceHooks!(
      "/Users/equinox/.worktrees/integrator/integrator-5",
      {} as WorkspaceHooksConfig,
    );

    const hookCommand = getWrittenHookCommand();
    expect(hookCommand).toBe(".claude/metadata-updater.sh");
    expect(hookCommand).not.toMatch(/^\//);
  });

  it("postLaunchSetup writes a relative hook command (not absolute)", async () => {
    await agent.postLaunchSetup!(
      makeSession({ workspacePath: "/Users/equinox/.worktrees/integrator/integrator-10" }),
    );

    const hookCommand = getWrittenHookCommand();
    expect(hookCommand).toBe(".claude/metadata-updater.sh");
    expect(hookCommand).not.toMatch(/^\//);
  });

  it("different worktree paths produce identical settings.json content", async () => {
    await agent.setupWorkspaceHooks!(
      "/Users/equinox/.worktrees/integrator/integrator-5",
      {} as WorkspaceHooksConfig,
    );
    const settingsWrite1 = mockWriteFile.mock.calls.find(
      ([path]: unknown[]) => typeof path === "string" && path.endsWith("settings.json"),
    );
    const content1 = settingsWrite1![1] as string;

    mockWriteFile.mockClear();

    await agent.setupWorkspaceHooks!(
      "/Users/equinox/.worktrees/integrator/integrator-10",
      {} as WorkspaceHooksConfig,
    );
    const settingsWrite2 = mockWriteFile.mock.calls.find(
      ([path]: unknown[]) => typeof path === "string" && path.endsWith("settings.json"),
    );
    const content2 = settingsWrite2![1] as string;

    expect(content1).toBe(content2);
  });

  it("updates an existing absolute hook path to relative", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  type: "command",
                  command:
                    "/Users/equinox/.worktrees/integrator/integrator-5/.claude/metadata-updater.sh",
                  timeout: 5000,
                },
              ],
            },
          ],
        },
      }),
    );

    await agent.setupWorkspaceHooks!(
      "/Users/equinox/.worktrees/integrator/integrator-10",
      {} as WorkspaceHooksConfig,
    );

    const hookCommand = getWrittenHookCommand();
    expect(hookCommand).toBe(".claude/metadata-updater.sh");
  });

  it("still writes the script file to the correct absolute filesystem path", async () => {
    await agent.setupWorkspaceHooks!(
      "/Users/equinox/.worktrees/integrator/integrator-5",
      {} as WorkspaceHooksConfig,
    );

    const scriptWrite = mockWriteFile.mock.calls.find(
      ([path]: unknown[]) => typeof path === "string" && path.endsWith("metadata-updater.sh"),
    );
    expect(scriptWrite).toBeDefined();
    expect(scriptWrite![0]).toBe(
      "/Users/equinox/.worktrees/integrator/integrator-5/.claude/metadata-updater.sh",
    );
  });

  it("skips postLaunchSetup when workspacePath is null", async () => {
    await agent.postLaunchSetup!(makeSession({ workspacePath: null }));
    expect(mockWriteFile).not.toHaveBeenCalled();
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

  it("is true when claude runs in the pane", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "claude --model sonnet", name: "claude", pid: 42 }]),
    );

    const agent = create();
    expect(await agent.isProcessRunning(herdrHandle)).toBe(true);
  });

  it("queries herdr for the pane instead of scanning tmux", async () => {
    mockExecFileAsync.mockResolvedValueOnce(
      paneProcesses([{ cmdline: "claude --model sonnet", name: "claude", pid: 42 }]),
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

  it("rejects when herdr is unavailable", async () => {
    mockExecFileAsync.mockRejectedValueOnce(new Error("ENOENT"));

    const agent = create();
    await expect(agent.isProcessRunning(herdrHandle)).rejects.toThrow();
  });
});

// =========================================================================
// getRestoreCommand — persisted spawn model (C-04)
// =========================================================================
describe("getRestoreCommand", () => {
  const agent = create();

  function makeProject(overrides: Record<string, unknown> = {}) {
    return {
      name: "proj",
      repo: "o/r",
      path: "/p",
      defaultBranch: "main",
      sessionPrefix: "p",
      ...overrides,
    };
  }

  it("prefers the effective (persisted spawn) model over the config model", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { model: "config-model" } }) as never,
      "spawn-model-X",
    );
    expect(cmd).toContain("--model 'spawn-model-X'");
    expect(cmd).not.toContain("config-model");
    expect(cmd).toContain("--resume 'abc123-def456'");
  });

  it("uses the effective model when the config has none", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject() as never,
      "spawn-model-X",
    );
    expect(cmd).toContain("--model 'spawn-model-X'");
  });

  it("falls back to the config model when no effective model is given", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { model: "config-model" } }) as never,
    );
    expect(cmd).toContain("--model 'config-model'");
  });

  it("gives no skip flag when permissions is default", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { permissions: "default" } }) as never,
    );
    expect(cmd).toContain("--resume 'abc123-def456'");
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("gives the skip flag when permissions is permissionless", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { permissions: "permissionless" } }) as never,
    );
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("gives the skip flag when permissions is auto-edit", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { permissions: "auto-edit" } }) as never,
    );
    expect(cmd).toContain("--dangerously-skip-permissions");
  });

  it("gives no skip flag when no permissions key is set", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const cmd = await agent.getRestoreCommand!(makeSession(), makeProject() as never);
    expect(cmd).toContain("--resume 'abc123-def456'");
    expect(cmd).not.toContain("--dangerously-skip-permissions");
  });

  it("restore with stored default matches a launch with no mode (no skip flag)", async () => {
    mockReaddir.mockResolvedValue(["abc123-def456.jsonl"]);
    mockStat.mockResolvedValue({ mtimeMs: 1000, mtime: new Date(1000) });
    const launch = agent.getLaunchCommand(makeLaunchConfig());
    const restore = await agent.getRestoreCommand!(
      makeSession(),
      makeProject({ agentConfig: { permissions: "default" } }) as never,
    );
    expect(launch).not.toContain("--dangerously-skip-permissions");
    expect(restore).not.toContain("--dangerously-skip-permissions");
  });
});
