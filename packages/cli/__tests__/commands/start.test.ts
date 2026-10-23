/**
 * Tests for `ao start` and `ao stop` commands.
 *
 * Uses --no-orchestrator where needed to isolate project resolution from
 * orchestrator-session infrastructure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import {
  RUNTIME_NO_SERVER_ERROR_CODE,
  RuntimeStopUnconfirmedError,
  type SessionManager,
} from "@aoagents/ao-core";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { spawnCalls } = vi.hoisted(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return { spawnCalls: [] as Array<[string, string[]]> };
});

vi.mock("node:child_process", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  return {
    ...actual,
    spawn: ((cmd: string, args: string[]) => {
      spawnCalls.push([cmd, args]);
      const emitter = new EventEmitter();
      setImmediate(() => emitter.emit("close", 0));
      return emitter;
    }) as unknown as typeof actual.spawn,
  };
});

vi.mock("../../src/lib/prompts.js", () => ({
  promptSelect: vi.fn(),
  promptConfirm: vi.fn(),
}));

const {
  mockExec,
  mockExecSilent,
  mockConfigRef,
  mockSessionManager,
  mockEnsureLifecycleWorker,
  mockStopLifecycleWorker,
  mockStartDetachedStop,
  mockRuntime,
  oraLog,
} = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockExecSilent: vi.fn(),
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockSessionManager: {
    list: vi.fn(),
    kill: vi.fn(),
    cleanup: vi.fn(),
    get: vi.fn(),
    spawn: vi.fn(),
    spawnOrchestrator: vi.fn(),
    send: vi.fn(),
    claimPR: vi.fn(),
  },
  mockEnsureLifecycleWorker: vi.fn(),
  mockStopLifecycleWorker: vi.fn(),
  mockStartDetachedStop: vi.fn(),
  mockRuntime: { name: "tmux", isAlive: vi.fn() },
  oraLog: [] as Array<[string, string | undefined]>,
}));

const { mockProcessCwd } = vi.hoisted(() => ({
  mockProcessCwd: vi.fn<[], string>(),
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: vi.fn(),
  exec: mockExec,
  execSilent: mockExecSilent,
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: vi.fn().mockResolvedValue([]),
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("ora", () => ({
  default: () => {
    // Each call is logged as [method, text], so a test can read the spinner lines.
    const logged = (method: string) =>
      function (this: unknown, text?: string) {
        oraLog.push([method, text]);
        return this;
      };
    return {
      start: vi.fn(logged("start")),
      stop: vi.fn(logged("stop")),
      succeed: vi.fn(logged("succeed")),
      fail: vi.fn(logged("fail")),
      info: vi.fn(logged("info")),
      text: "",
    };
  },
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  const normalizeOrchestratorSessionStrategy =
    actual.normalizeOrchestratorSessionStrategy ??
    ((strategy: string | undefined) => {
      if (strategy === "kill-previous" || strategy === "delete-new") return "delete";
      if (strategy === "ignore-new") return "ignore";
      return strategy ?? "reuse";
    });

  return {
    ...actual,
    normalizeOrchestratorSessionStrategy,
    loadConfig: (path?: string) => {
      if (path) return actual.loadConfig(path);
      return mockConfigRef.current;
    },
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async (): Promise<SessionManager> => mockSessionManager as SessionManager,
  getPluginRegistry: async () => ({
    get: (slot: string, name: string) =>
      slot === "runtime" && name === "tmux" ? mockRuntime : null,
  }),
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  ensureLifecycleWorker: (...args: unknown[]) => mockEnsureLifecycleWorker(...args),
  stopLifecycleWorker: (...args: unknown[]) => mockStopLifecycleWorker(...args),
  startDetachedStop: (...args: unknown[]) => mockStartDetachedStop(...args),
}));

vi.mock("../../src/lib/preflight.js", () => ({
  preflight: {
    checkTmux: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: vi.fn().mockReturnValue(true),
  getCallerType: vi.fn().mockReturnValue("human"),
}));

vi.mock("../../src/lib/detect-env.js", () => ({
  detectEnvironment: vi.fn().mockResolvedValue({
    git: {
      isRepo: true,
      remoteUrl: null,
      ownerRepo: null,
      currentBranch: "main",
      defaultBranch: "main",
    },
    tools: { hasTmux: true, hasGh: false, ghAuthed: false },
    apiKeys: { hasLinear: false, hasSlack: false },
  }),
}));

vi.mock("../../src/lib/detect-agent.js", () => ({
  detectAgentRuntime: vi.fn().mockResolvedValue("claude-code"),
  detectAvailableAgents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/lib/project-detection.js", () => ({
  detectProjectType: vi.fn().mockReturnValue({ languages: [], frameworks: [] }),
  generateRulesFromTemplates: vi.fn().mockReturnValue(null),
  formatProjectTypeForDisplay: vi.fn().mockReturnValue(""),
}));

// Mock node:process so that `import { cwd } from "node:process"` in start.ts
// can be intercepted per-test via mockProcessCwd.
vi.mock("node:process", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("node:process")>();
  return {
    ...actual,
    cwd: () => {
      const override = mockProcessCwd();
      return override ?? actual.cwd();
    },
  };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { Command } from "commander";
import {
  registerStart,
  registerStop,
  createConfigOnly,
  AGENT_INSTALL_OPTIONS,
  buildOpenCodeInstallArgs,
  openCodeInstallNotice,
  isLegacyOpenCodeInstalled,
  resolveOpenCodeInstall,
} from "../../src/commands/start.js";
import { promptSelect, promptConfirm } from "../../src/lib/prompts.js";

let tmpDir: string;
let program: Command;
let cwdSpy: ReturnType<typeof vi.spyOn>;

// Defect B: `ao stop` reads these to find that it runs inside the session that
// it stops. A test run inside tmux or an AO pane must not see the outer values.
const CALLER_SESSION_ENV = ["AO_SESSION", "AO_SESSION_NAME", "TMUX", "TMUX_PANE"] as const;
const savedCallerEnv: Partial<Record<(typeof CALLER_SESSION_ENV)[number], string>> = {};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-start-test-"));
  spawnCalls.length = 0;
  oraLog.length = 0;
  for (const key of CALLER_SESSION_ENV) {
    savedCallerEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }

  program = new Command();
  program.exitOverride();
  registerStart(program);
  registerStop(program);

  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  mockSessionManager.list.mockReset();
  mockSessionManager.list.mockResolvedValue([]);
  mockSessionManager.get.mockReset();
  mockSessionManager.spawnOrchestrator.mockReset();
  mockSessionManager.kill.mockReset();
  mockExec.mockReset();
  mockExecSilent.mockReset();
  // Default command availability:
  // - git and tmux are installed
  // - gh auth is unavailable (clone falls through to git SSH/HTTPS)
  mockExecSilent.mockImplementation(async (cmd: string, args: string[] = []) => {
    if (cmd === "git" && args[0] === "--version") return "git version 2.43.0";
    if (cmd === "tmux" && args[0] === "-V") return "tmux 3.4";
    if (cmd === "gh" && args[0] === "--version") return null;
    if (cmd === "gh" && args[0] === "auth" && args[1] === "status") return null;
    return null;
  });
  mockEnsureLifecycleWorker.mockReset();
  mockEnsureLifecycleWorker.mockResolvedValue({
    running: true,
    started: true,
    pid: 12345,
    pidFile: "/tmp/lifecycle-worker.pid",
    logFile: "/tmp/lifecycle-worker.log",
  });
  mockStopLifecycleWorker.mockReset();
  mockStopLifecycleWorker.mockResolvedValue(true);
  mockStartDetachedStop.mockReset();
  mockRuntime.isAlive.mockReset();
  mockProcessCwd.mockReset();
  // Install-prompt defaults: skip the runtime install and decline optional
  // tool installs, preserving the pre-TTY behavior for tests that never
  // exercise the install path.
  vi.mocked(promptSelect).mockReset();
  vi.mocked(promptSelect).mockResolvedValue("skip");
  vi.mocked(promptConfirm).mockReset();
  vi.mocked(promptConfirm).mockResolvedValue(false);
});

afterEach(() => {
  if (cwdSpy) cwdSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  for (const key of CALLER_SESSION_ENV) {
    const saved = savedCallerEnv[key];
    if (saved === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = saved;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(projects: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return {
    configPath: join(tmpDir, "agent-orchestrator.yaml"),
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: [],
    },
    projects,
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  };
}

function makeProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "My App",
    repo: "org/my-app",
    path: join(tmpDir, "main-repo"),
    defaultBranch: "main",
    sessionPrefix: "app",
    ...overrides,
  };
}

/** The hidden flag of the `ao stop` that runs in the detached process (defect B). */
const DETACHED_STOP = "--detached-stop-process";

/** Mock process.cwd() to return a specific directory (avoids process.chdir in workers). */
function mockCwd(dir: string): void {
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
}

/** Create a fake git repo directory with an origin remote URL. */
function createFakeRepo(dir: string, remoteUrl: string, files?: Record<string, string>): void {
  mkdirSync(join(dir, ".git", "refs", "remotes", "origin"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(dir, ".git", "refs", "remotes", "origin", "main"), "abc\n");
  writeFileSync(join(dir, ".git", "config"), `[remote "origin"]\n\turl = ${remoteUrl}\n`);
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
  }
}

// ---------------------------------------------------------------------------
// resolveProject (tested through `ao start --no-orchestrator`)
// ---------------------------------------------------------------------------

describe("start command — project resolution", () => {
  it("uses single project when no arg given", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });

    await program.parseAsync(["node", "test", "start", "--no-dashboard", "--no-orchestrator"]);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("My App");
    expect(output).toContain("Startup complete");
  });

  it("uses explicit project arg when given", async () => {
    mockConfigRef.current = makeConfig({
      frontend: makeProject({ name: "Frontend", sessionPrefix: "fe" }),
      backend: makeProject({ name: "Backend", sessionPrefix: "api" }),
    });

    await program.parseAsync([
      "node",
      "test",
      "start",
      "backend",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Backend");
  });

  it("errors when explicit project not found", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });

    await expect(
      program.parseAsync([
        "node",
        "test",
        "start",
        "nonexistent",
        "--no-dashboard",
        "--no-orchestrator",
      ]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain("not found");
  });

  it("errors when multiple projects and no arg", async () => {
    mockConfigRef.current = makeConfig({
      frontend: makeProject({ name: "Frontend" }),
      backend: makeProject({ name: "Backend" }),
    });

    await expect(
      program.parseAsync(["node", "test", "start", "--no-dashboard", "--no-orchestrator"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain("Multiple projects");
  });

  it("errors when no projects configured", async () => {
    mockConfigRef.current = makeConfig({});

    await expect(
      program.parseAsync(["node", "test", "start", "--no-dashboard", "--no-orchestrator"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain("No projects configured");
  });
});

// ---------------------------------------------------------------------------
// URL detection — `ao start <url>` triggers handleUrlStart
// ---------------------------------------------------------------------------

describe("start command — URL argument", () => {
  it("reuses existing clone and generates config", async () => {
    const repoDir = join(tmpDir, "DevOS");
    createFakeRepo(repoDir, "https://github.com/ComposioHQ/DevOS.git", {
      "package.json": "{}",
      "pnpm-lock.yaml": "",
    });
    mockCwd(tmpDir);

    await program.parseAsync([
      "node",
      "test",
      "start",
      "https://github.com/ComposioHQ/DevOS",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    // Config should have been generated
    expect(existsSync(join(repoDir, "agent-orchestrator.yaml"))).toBe(true);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Reusing existing clone");
    expect(output).toContain("Startup complete");
  });

  it("clones repo via gh when gh auth is available", async () => {
    const repoDir = join(tmpDir, "my-app");
    mockCwd(tmpDir);

    // gh auth status succeeds
    mockExecSilent.mockResolvedValue("Logged in");

    mockExec.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "gh" && args[0] === "repo" && args[1] === "clone") {
        createFakeRepo(repoDir, "https://github.com/owner/my-app.git", {
          "Cargo.toml": "",
        });
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await program.parseAsync([
      "node",
      "test",
      "start",
      "https://github.com/owner/my-app",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    expect(mockExec).toHaveBeenCalledWith(
      "gh",
      ["repo", "clone", "owner/my-app", repoDir, "--", "--depth", "1"],
      expect.anything(),
    );

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Startup complete");
  });

  it("falls back to git clone when gh is unavailable", async () => {
    const repoDir = join(tmpDir, "my-app");
    mockCwd(tmpDir);

    // gh auth status fails (not installed or not logged in)
    mockExecSilent.mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "git" && args[0] === "--version") return "git version 2.43.0";
      if (cmd === "tmux" && args[0] === "-V") return "tmux 3.4";
      if (cmd === "gh" && args[0] === "auth" && args[1] === "status") return null;
      return null;
    });

    mockExec.mockImplementation(async (cmd: string, args: string[]) => {
      // SSH attempt fails
      if (cmd === "git" && args[0] === "clone" && args[3]?.startsWith("git@")) {
        throw new Error("Permission denied (publickey)");
      }
      // HTTPS fallback succeeds
      if (cmd === "git" && args[0] === "clone") {
        createFakeRepo(repoDir, "https://github.com/owner/my-app.git", {
          "Cargo.toml": "",
        });
        return { stdout: "", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    await program.parseAsync([
      "node",
      "test",
      "start",
      "https://github.com/owner/my-app",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    // Should have tried SSH first, then HTTPS
    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "git@github.com:owner/my-app.git", repoDir],
      expect.anything(),
    );
    expect(mockExec).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "https://github.com/owner/my-app.git", repoDir],
      expect.anything(),
    );

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Startup complete");
  });

  it("uses existing config when repo already has agent-orchestrator.yaml", async () => {
    const repoDir = join(tmpDir, "configured-app");
    createFakeRepo(repoDir, "https://github.com/owner/configured-app.git");
    mockCwd(tmpDir);

    writeFileSync(
      join(repoDir, "agent-orchestrator.yaml"),
      [
        "port: 4000",
        "defaults:",
        "  runtime: tmux",
        "  agent: claude-code",
        "  workspace: worktree",
        "  notifiers: [desktop]",
        "projects:",
        "  configured-app:",
        "    name: Configured App",
        "    repo: owner/configured-app",
        `    path: ${repoDir}`,
        "    defaultBranch: main",
        "    sessionPrefix: ca",
      ].join("\n"),
    );

    await program.parseAsync([
      "node",
      "test",
      "start",
      "https://github.com/owner/configured-app",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Using existing config");
    expect(output).toContain("Configured App");
  });

  it("resolves correct project when existing config has multiple projects", async () => {
    const repoDir = join(tmpDir, "multi-proj");
    createFakeRepo(repoDir, "https://github.com/org/multi-proj.git");
    mockCwd(tmpDir);

    writeFileSync(
      join(repoDir, "agent-orchestrator.yaml"),
      [
        "port: 4000",
        "defaults:",
        "  runtime: tmux",
        "  agent: claude-code",
        "  workspace: worktree",
        "  notifiers: [desktop]",
        "projects:",
        "  frontend:",
        "    name: Frontend",
        "    repo: org/other-repo",
        `    path: ${repoDir}/frontend`,
        "    defaultBranch: main",
        "    sessionPrefix: fe",
        "  multi-proj:",
        "    name: Multi Proj",
        "    repo: org/multi-proj",
        `    path: ${repoDir}`,
        "    defaultBranch: main",
        "    sessionPrefix: mp",
      ].join("\n"),
    );

    await program.parseAsync([
      "node",
      "test",
      "start",
      "https://github.com/org/multi-proj",
      "--no-dashboard",
      "--no-orchestrator",
    ]);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    // Should pick "Multi Proj" by matching repo field, not error with "Multiple projects"
    expect(output).toContain("Multi Proj");
    expect(output).toContain("Startup complete");
  });

  it("fails on clone error with descriptive message", async () => {
    mockCwd(tmpDir);
    mockExec.mockRejectedValue(new Error("fatal: repository not found"));

    await expect(
      program.parseAsync([
        "node",
        "test",
        "start",
        "https://github.com/owner/nonexistent",
        "--no-dashboard",
        "--no-orchestrator",
      ]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain("Failed to clone");
  });
});

describe("start command — non-interactive install safety", () => {
  function hasPrivilegedInstallAttempt(): boolean {
    return mockExec.mock.calls.some((call) => {
      const cmd = String(call[0]);
      const args = Array.isArray(call[1]) ? (call[1] as string[]) : [];
      const joined = `${cmd} ${args.join(" ")}`;
      return joined.includes(" install ") && (cmd === "sudo" || cmd === "brew" || cmd === "winget");
    });
  }

  it("does not auto-install tmux when missing in non-interactive mode", async () => {
    const { isHumanCaller } = await import("../../src/lib/caller-context.js");
    vi.mocked(isHumanCaller).mockReturnValue(false);

    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockExecSilent.mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "git" && args[0] === "--version") return "git version 2.43.0";
      if (cmd === "tmux" && args[0] === "-V") return null;
      if (cmd === "gh" && args[0] === "--version") return null;
      if (cmd === "gh" && args[0] === "auth" && args[1] === "status") return null;
      return null;
    });

    await expect(
      program.parseAsync(["node", "test", "start", "--no-dashboard", "--no-orchestrator"]),
    ).rejects.toThrow("process.exit(1)");

    expect(hasPrivilegedInstallAttempt()).toBe(false);
    expect(mockExec.mock.calls.some((call) => String(call[0]) === "tmux")).toBe(false);
  });

  it("does not auto-install git when missing in non-interactive URL start", async () => {
    const { isHumanCaller } = await import("../../src/lib/caller-context.js");
    vi.mocked(isHumanCaller).mockReturnValue(false);

    mockCwd(tmpDir);
    mockExecSilent.mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "git" && args[0] === "--version") return null;
      if (cmd === "tmux" && args[0] === "-V") return "tmux 3.4";
      if (cmd === "gh" && args[0] === "--version") return null;
      if (cmd === "gh" && args[0] === "auth" && args[1] === "status") return null;
      return null;
    });

    await expect(
      program.parseAsync([
        "node",
        "test",
        "start",
        "https://github.com/owner/nonexistent",
        "--no-dashboard",
        "--no-orchestrator",
      ]),
    ).rejects.toThrow("process.exit(1)");

    expect(hasPrivilegedInstallAttempt()).toBe(false);
    expect(
      mockExec.mock.calls.some((call) => {
        const cmd = String(call[0]);
        const args = Array.isArray(call[1]) ? (call[1] as string[]) : [];
        return cmd === "git" && args[0] === "clone";
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle startup
// ---------------------------------------------------------------------------

describe("start command — lifecycle worker", () => {
  it("skips lifecycle with --no-orchestrator", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });

    await program.parseAsync(["node", "test", "start", "--no-orchestrator"]);

    expect(mockEnsureLifecycleWorker).not.toHaveBeenCalled();
  });

  it("starts lifecycle for the selected project", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });

    mockSessionManager.get.mockResolvedValue(null);
    mockSessionManager.spawnOrchestrator.mockResolvedValue({ id: "app-orchestrator" });

    await program.parseAsync(["node", "test", "start"]);

    expect(mockEnsureLifecycleWorker).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: expect.any(String) }),
      "my-app",
    );
  });
});

describe("start command — orchestrator session strategy display", () => {
  function getLoggedOutput(): string {
    return vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
  }

  it("shows reused messaging when strategy is reuse and metadata marks the session reused", async () => {
    mockConfigRef.current = makeConfig({
      "my-app": makeProject({ orchestratorSessionStrategy: "reuse" }),
    });

    mockSessionManager.get.mockResolvedValue({
      id: "app-orchestrator",
      runtimeHandle: { id: "tmux-session-1" },
    });
    mockSessionManager.spawnOrchestrator.mockResolvedValue({
      id: "app-orchestrator",
      runtimeHandle: { id: "tmux-session-1" },
      metadata: { orchestratorSessionReused: "true" },
    });

    await program.parseAsync(["node", "test", "start", "--no-dashboard"]);

    const output = getLoggedOutput();
    expect(output).toContain("reused existing session (app-orchestrator)");
    expect(output).not.toContain("tmux attach -t tmux-session-1");
  });

  it("falls back to attach messaging when strategy is reuse but metadata is missing", async () => {
    mockConfigRef.current = makeConfig({
      "my-app": makeProject({ orchestratorSessionStrategy: "reuse" }),
    });

    mockSessionManager.get.mockResolvedValue({
      id: "app-orchestrator",
      runtimeHandle: { id: "tmux-session-1" },
    });
    mockSessionManager.spawnOrchestrator.mockResolvedValue({
      id: "app-orchestrator",
      runtimeHandle: { id: "tmux-session-1" },
    });

    await program.parseAsync(["node", "test", "start", "--no-dashboard"]);

    const output = getLoggedOutput();
    expect(output).toContain("ao session attach app-orchestrator");
    expect(output).not.toContain("reused existing session");
  });

  it.each(["delete", "ignore", "delete-new", "ignore-new", "kill-previous"] as const)(
    "uses ao session attach when strategy is %s and --no-dashboard",
    async (orchestratorSessionStrategy) => {
      mockConfigRef.current = makeConfig({
        "my-app": makeProject({ orchestratorSessionStrategy }),
      });

      mockSessionManager.get.mockResolvedValue({
        id: "app-orchestrator",
        runtimeHandle: { id: "tmux-session-1" },
      });
      mockSessionManager.spawnOrchestrator.mockResolvedValue({
        id: "app-orchestrator",
        runtimeHandle: { id: "tmux-session-1" },
        metadata: { orchestratorSessionReused: "true" },
      });

      await program.parseAsync(["node", "test", "start", "--no-dashboard"]);

      const output = getLoggedOutput();
      expect(output).toContain("ao session attach app-orchestrator");
      expect(output).not.toContain("reused existing session");
    },
  );

  it("handles existing orchestrator sessions by selecting the most recent", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });

    // Return an existing orchestrator session
    mockSessionManager.list.mockResolvedValue([
      {
        id: "app-orchestrator",
        projectId: "my-app",
        metadata: { role: "orchestrator" },
        lastActivityAt: new Date(),
        runtimeHandle: { id: "tmux-session-existing" },
      },
    ]);

    await program.parseAsync(["node", "test", "start"]);

    const output = getLoggedOutput();
    expect(output).toContain("ao session attach app-orchestrator");

    // Should NOT spawn a new orchestrator when existing ones exist
    expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ao stop
// ---------------------------------------------------------------------------

describe("stop command", () => {
  // Defect B, review r1 M-1: the stop of an existing record runs in the
  // detached process (`ao stop <project> --detached-stop-process`), so the
  // tests of the in-process stop run that command.
  it("stops the orchestrator session and lifecycle worker", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockResolvedValue(undefined);
    mockExec.mockResolvedValue({ stdout: "12345", stderr: "" });

    await program.parseAsync(["node", "test", "stop", "my-app", DETACHED_STOP]);

    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-orchestrator", {
      purgeOpenCode: false,
    });
    expect(mockStopLifecycleWorker).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: expect.any(String) }),
      "my-app",
    );
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("Orchestrator stopped");
  });

  it("handles missing orchestrator session gracefully", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue(null);
    mockExec.mockRejectedValue(new Error("no process"));

    await program.parseAsync(["node", "test", "stop"]);

    expect(mockSessionManager.kill).not.toHaveBeenCalled();
    expect(mockStopLifecycleWorker).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: expect.any(String) }),
      "my-app",
    );
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("is not running");
  });

  it("a stop refusal prints the outcome, the detail and the next action, and exits 1 (review r1, F-3)", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockRejectedValue(
      new RuntimeStopUnconfirmedError({
        sessionId: "app-orchestrator",
        handle: { id: "hash-app-orchestrator", runtimeName: "tmux", data: {} },
        stop: {
          outcome: "unknown",
          detail: "the destroy of tmux session hash-app-orchestrator failed",
        },
        kept: "record and worktree kept",
        retry: "ao session kill app-orchestrator",
      }),
    );

    await expect(
      program.parseAsync(["node", "test", "stop", "my-app", DETACHED_STOP]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain(
      "Failed to stop orchestrator session app-orchestrator: runtime stop unconfirmed (unknown): the destroy of tmux session hash-app-orchestrator failed; record and worktree kept",
    );
    expect(errors).toContain(
      "Next: Check tmux session hash-app-orchestrator by hand and stop it if it still runs, then run `ao stop my-app` again.",
    );
    expect(errors).toContain("The lifecycle worker was not stopped.");
    expect(errors).not.toContain("ao session kill");
    expect(mockStopLifecycleWorker).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("another kill error keeps the generic message and exit 1", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockRejectedValue(new Error("disk full"));

    await expect(
      program.parseAsync(["node", "test", "stop", "my-app", DETACHED_STOP]),
    ).rejects.toThrow("process.exit(1)");

    const errors = vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(errors).toContain("disk full");
    expect(errors).not.toContain("Next:");
    expect(mockStopLifecycleWorker).not.toHaveBeenCalled();
  });

  it("passes purge flag when stopping orchestrator with --purge-session", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "stop", "my-app", "--purge-session", DETACHED_STOP]);

    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-orchestrator", {
      purgeOpenCode: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Defect A (2026-10-22): `ao start` and an orchestrator with no server
// ---------------------------------------------------------------------------

describe("start command — orchestrator liveness (defect A)", () => {
  const handle = { id: "hash-app-orchestrator", runtimeName: "tmux", data: {} };

  /** An orchestrator record as `sm.list` returns it: a stored handle, status working. */
  function orchestratorRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "app-orchestrator",
      projectId: "my-app",
      status: "working",
      activity: null,
      metadata: { role: "orchestrator", runtimeHandle: JSON.stringify(handle) },
      runtimeHandle: handle,
      lastActivityAt: new Date(),
      ...overrides,
    };
  }

  function errors(): string {
    return vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
  }

  beforeEach(() => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.spawnOrchestrator.mockResolvedValue({
      id: "app-orchestrator",
      metadata: {},
    });
  });

  it("A1: a runtime with no server at all starts a new orchestrator and says so", async () => {
    mockSessionManager.list.mockResolvedValue([orchestratorRecord()]);
    mockRuntime.isAlive.mockRejectedValue(
      Object.assign(
        new Error(
          "tmux has-session -t =hash-app-orchestrator could not answer: no server running on /tmp/tmux-1000/default",
        ),
        { code: RUNTIME_NO_SERVER_ERROR_CODE },
      ),
    );

    await program.parseAsync(["node", "test", "start"]);

    expect(mockSessionManager.spawnOrchestrator).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.spawnOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "my-app" }),
    );
    expect(mockRuntime.isAlive).toHaveBeenCalledWith(handle);
    expect(oraLog).toContainEqual([
      "info",
      "Orchestrator session app-orchestrator does not run: no tmux server runs (tmux has-session -t =hash-app-orchestrator could not answer: no server running on /tmp/tmux-1000/default). Starting a new one.",
    ]);
    expect(oraLog).toContainEqual(["succeed", "Orchestrator session created"]);
    expect(oraLog.some(([, text]) => text?.startsWith("Using existing orchestrator session"))).toBe(
      false,
    );
  });

  it("A2: a live orchestrator is reused as before, with no second session", async () => {
    mockSessionManager.list.mockResolvedValue([orchestratorRecord()]);
    mockRuntime.isAlive.mockResolvedValue(true);

    await program.parseAsync(["node", "test", "start"]);

    expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
    expect(oraLog).toContainEqual([
      "succeed",
      "Using existing orchestrator session: app-orchestrator",
    ]);
    const output = vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
    expect(output).toContain("ao session attach app-orchestrator");
  });

  it.each([
    {
      answer: "a timeout",
      probe: () =>
        mockRuntime.isAlive.mockRejectedValue(
          Object.assign(
            new Error(
              "tmux has-session -t =hash-app-orchestrator could not answer: timed out after 5000 ms",
            ),
            { code: "ERR_RUNTIME_PROBE" },
          ),
        ),
      reason:
        "tmux has-session -t =hash-app-orchestrator could not answer: timed out after 5000 ms",
    },
    {
      answer: "an answer that is not a boolean",
      probe: () => mockRuntime.isAlive.mockResolvedValue("yes"),
      reason:
        "the liveness check of tmux session hash-app-orchestrator answered yes, not true or false",
    },
  ])(
    "A3: an unknown liveness ($answer) starts no orchestrator, claims no reuse, and exits 1",
    async ({ probe, reason }) => {
      mockSessionManager.list.mockResolvedValue([orchestratorRecord()]);
      probe();

      await expect(program.parseAsync(["node", "test", "start"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
      expect(
        oraLog.some(([, text]) => text?.startsWith("Using existing orchestrator session")),
      ).toBe(false);
      expect(errors()).toContain(
        `Cannot tell whether orchestrator session app-orchestrator is alive (${reason}). It is neither reused nor replaced, and no new orchestrator was started. Check the runtime and run \`ao start\` again.`,
      );
      const output = vi
        .mocked(console.log)
        .mock.calls.map((c) => c.join(" "))
        .join("\n");
      expect(output).not.toContain("Startup complete");
    },
  );

  it("A3: a gone orchestrator next to an unknown one still starts nothing", async () => {
    mockSessionManager.list.mockResolvedValue([
      orchestratorRecord(),
      orchestratorRecord({
        id: "app-orchestrator-1",
        runtimeHandle: { ...handle, id: "hash-app-orchestrator-1" },
      }),
    ]);
    mockRuntime.isAlive.mockImplementation(async (h: { id: string }) => {
      if (h.id === "hash-app-orchestrator") return false;
      throw Object.assign(new Error("tmux has-session could not answer: timed out"), {
        code: "ERR_RUNTIME_PROBE",
      });
    });

    await expect(program.parseAsync(["node", "test", "start"])).rejects.toThrow("process.exit(1)");

    expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
    expect(errors()).toContain(
      "Cannot tell whether orchestrator session app-orchestrator-1 is alive (tmux has-session could not answer: timed out).",
    );
  });

  it("A2: a live orchestrator is reused even when another candidate is unknown", async () => {
    // The unknown candidate is the most recent one, so a reuse by recency alone picks it.
    mockSessionManager.list.mockResolvedValue([
      orchestratorRecord({ lastActivityAt: new Date(1_000) }),
      orchestratorRecord({
        id: "app-orchestrator-1",
        runtimeHandle: { ...handle, id: "hash-app-orchestrator-1" },
        lastActivityAt: new Date(2_000),
      }),
    ]);
    mockRuntime.isAlive.mockImplementation(async (h: { id: string }) => {
      if (h.id === "hash-app-orchestrator") return true;
      throw Object.assign(new Error("tmux has-session could not answer: timed out"), {
        code: "ERR_RUNTIME_PROBE",
      });
    });

    await program.parseAsync(["node", "test", "start"]);

    expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
    expect(oraLog).toContainEqual([
      "succeed",
      "Using existing orchestrator session: app-orchestrator",
    ]);
  });

  it.each([
    { terminal: "status killed", overrides: { status: "killed" } },
    { terminal: "activity exited", overrides: { activity: "exited" } },
  ])(
    "A4: a terminal record ($terminal) starts a new orchestrator without a probe",
    async ({ overrides }) => {
      mockSessionManager.list.mockResolvedValue([orchestratorRecord(overrides)]);

      await program.parseAsync(["node", "test", "start"]);

      expect(mockRuntime.isAlive).not.toHaveBeenCalled();
      expect(mockSessionManager.spawnOrchestrator).toHaveBeenCalledTimes(1);
      expect(oraLog).toContainEqual(["succeed", "Orchestrator session created"]);
    },
  );

  it("a record with no stored handle is not probed and is reused as before", async () => {
    mockSessionManager.list.mockResolvedValue([
      orchestratorRecord({ metadata: { role: "orchestrator" } }),
    ]);

    await program.parseAsync(["node", "test", "start"]);

    expect(mockRuntime.isAlive).not.toHaveBeenCalled();
    expect(mockSessionManager.spawnOrchestrator).not.toHaveBeenCalled();
    expect(oraLog).toContainEqual([
      "succeed",
      "Using existing orchestrator session: app-orchestrator",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Defect B (2026-10-22), review r1 M-1 and M-2: the stop of an existing
// orchestrator record runs in a detached process, from every caller
// ---------------------------------------------------------------------------

describe("stop command — the stop runs in a detached process (defect B)", () => {
  const handle = { id: "hash-app-orchestrator", runtimeName: "tmux", data: {} };
  /** Today's stdout and stderr of a stop that works, as the detached process writes them. */
  const STOPPED = {
    stdout: "Lifecycle worker stopped\n\n✓ Orchestrator stopped\n\n  Projects: my-app\n\n",
    stderr: "- Stopping orchestrator session\n✔ Orchestrator session stopped\n",
  };
  /** Today's stderr of a refused kill (its stdout is empty), as the detached process writes it. */
  const REFUSED_STDERR =
    "- Stopping orchestrator session\n✖ Orchestrator session not stopped\n\nFailed to stop orchestrator session app-orchestrator: runtime stop unconfirmed (unknown): the destroy failed; record and worktree kept\nNext: Check tmux session hash-app-orchestrator by hand and stop it if it still runs, then run `ao stop my-app` again.\nThe lifecycle worker was not stopped.\n";
  let stdoutLog: string;
  let stderrLog: string;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;

  function written(): string {
    return stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
  }

  function writtenToStderr(): string {
    return stderrWrite.mock.calls.map((c) => String(c[0])).join("");
  }

  function logged(): string {
    return vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
  }

  function errors(): string {
    return vi
      .mocked(console.error)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
  }

  /** The detached stop, as `startDetachedStop` returns it, with what it wrote to its logs. */
  function detachedStop(
    output: { stdout?: string; stderr?: string },
    done: () => Promise<number | null>,
  ): void {
    writeFileSync(stdoutLog, output.stdout ?? "");
    writeFileSync(stderrLog, output.stderr ?? "");
    mockStartDetachedStop.mockImplementation(() => ({
      pid: 4321,
      stdoutLog,
      stderrLog,
      done: done(),
    }));
  }

  /** A detached stop that ends when the test calls the returned function. */
  function runningDetachedStop(): (code: number) => void {
    writeFileSync(stdoutLog, "");
    writeFileSync(stderrLog, "");
    let finish: (code: number) => void = () => {};
    mockStartDetachedStop.mockImplementation(() => ({
      pid: 4321,
      stdoutLog,
      stderrLog,
      done: new Promise<number>((resolve) => {
        finish = resolve;
      }),
    }));
    return (code) => finish(code);
  }

  /** A stream write that ends at once: it calls its callback (with `error`, when one is given). */
  function callWriteCallback(this: unknown, ...args: unknown[]): boolean {
    const callback = args.find((arg) => typeof arg === "function") as
      | ((err?: Error | null) => void)
      | undefined;
    callback?.(null);
    return true;
  }

  function expectNoStopInThisProcess(): void {
    expect(mockSessionManager.kill).not.toHaveBeenCalled();
    expect(mockStopLifecycleWorker).not.toHaveBeenCalled();
    expect(mockStartDetachedStop).toHaveBeenCalledTimes(1);
  }

  beforeEach(() => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({
      id: "app-orchestrator",
      status: "working",
      runtimeHandle: handle,
    });
    mockSessionManager.kill.mockResolvedValue(undefined);
    stdoutLog = join(tmpDir, "orchestrator-stop-test.stdout.log");
    stderrLog = join(tmpDir, "orchestrator-stop-test.stderr.log");
    // A write "ends" at once: its callback runs (the relay awaits it, review r2 M-1).
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(callWriteCallback);
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(callWriteCallback);
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("from outside: the stop runs detached, and its stdout, stderr and exit code 0 are this command's", async () => {
    detachedStop(STOPPED, () => Promise.resolve(0));

    await program.parseAsync(["node", "test", "stop"]);

    expectNoStopInThisProcess();
    expect(mockStartDetachedStop).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: expect.any(String) }),
      "my-app",
      ["stop", "my-app", DETACHED_STOP],
    );
    expect(logged().match(/Stopping orchestrator for/g)).toHaveLength(1);
    expect(written()).toBe(STOPPED.stdout);
    expect(writtenToStderr()).toBe(STOPPED.stderr);
    expect(process.exit).not.toHaveBeenCalled();
    expect(errors()).toBe("");
  });

  it("from outside: a refused kill gives today's text on stderr and exit code 1, with no line of its own", async () => {
    detachedStop({ stderr: REFUSED_STDERR }, () => Promise.resolve(1));

    await program.parseAsync(["node", "test", "stop"]);

    expectNoStopInThisProcess();
    expect(written()).toBe("");
    expect(writtenToStderr()).toBe(REFUSED_STDERR);
    expect(errors()).toBe("");
    // Review r2 M-1: the exit code is set, so the process ends after its output.
    expect(process.exitCode).toBe(1);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("ends with the exit code of the detached process", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    detachedStop({}, () => Promise.resolve(3));

    await program.parseAsync(["node", "test", "stop"]);

    expect(process.exitCode).toBe(3);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("a detached process ended by a signal: exit 1, and the logs are named", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    detachedStop({ stderr: "- Stopping orchestrator session\n" }, () => Promise.resolve(null));

    await program.parseAsync(["node", "test", "stop"]);

    expect(process.exitCode).toBe(1);
    expect(process.exit).not.toHaveBeenCalled();
    expect(writtenToStderr()).toBe(
      "- Stopping orchestrator session\n" +
        `\nThe detached stop was ended by a signal; its output: ${stdoutLog} and ${stderrLog}\n`,
    );
  });

  it("an output error of stdout ends only the stdout copy, is reported on stderr, and keeps the exit code", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    stdoutWrite.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((err?: Error | null) => void)
        | undefined;
      callback?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      return false;
    });
    detachedStop(STOPPED, () => Promise.resolve(7));

    await program.parseAsync(["node", "test", "stop"]);

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    expect(writtenToStderr()).toBe(
      STOPPED.stderr +
        `ao stop: could not write the stdout of the detached stop (write EPIPE); all of it is in ${stdoutLog}\n`,
    );
    expect(writtenToStderr()).not.toContain("did not start");
    expect(process.exitCode).toBe(7);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("inside the pane (AO_SESSION names the session): the same detached stop", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    detachedStop(STOPPED, () => Promise.resolve(0));

    await program.parseAsync(["node", "test", "stop"]);

    expectNoStopInThisProcess();
    expect(written()).toBe(STOPPED.stdout);
    expect(writtenToStderr()).toBe(STOPPED.stderr);
  });

  it("M-1: an empty #{session_name} answer cannot make this process do the stop", async () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,123,0";
    process.env["TMUX_PANE"] = "%999999";
    mockExecSilent.mockImplementation(async (cmd: string, args: string[] = []) =>
      cmd === "tmux" && args[0] === "display-message" ? "" : null,
    );
    detachedStop(STOPPED, () => Promise.resolve(0));

    await program.parseAsync(["node", "test", "stop"]);

    expectNoStopInThisProcess();
  });

  it("M-1: TMUX without TMUX_PANE cannot make this process do the stop", async () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,123,0";
    detachedStop(STOPPED, () => Promise.resolve(0));

    await program.parseAsync(["node", "test", "stop"]);

    expectNoStopInThisProcess();
  });

  it("M-2: a tmux lookup that does not answer cannot hold the stop (no lookup is made)", async () => {
    process.env["TMUX"] = "/tmp/tmux-1000/default,123,0";
    process.env["TMUX_PANE"] = "%7";
    mockExecSilent.mockImplementation((cmd: string, args: string[] = []) =>
      cmd === "tmux" && args[0] === "display-message"
        ? new Promise<string | null>(() => {})
        : Promise.resolve(null),
    );
    detachedStop(STOPPED, () => Promise.resolve(0));

    const finished = await Promise.race([
      program.parseAsync(["node", "test", "stop"]).then(() => "finished"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting after 1 s"), 1_000)),
    ]);

    expect(finished).toBe("finished");
    expectNoStopInThisProcess();
    expect(mockExecSilent).not.toHaveBeenCalledWith(
      "tmux",
      expect.arrayContaining(["display-message"]),
    );
  });

  it("passes --purge-session on to the detached process", async () => {
    detachedStop({}, () => Promise.resolve(0));

    await program.parseAsync(["node", "test", "stop", "--purge-session"]);

    expect(mockStartDetachedStop).toHaveBeenCalledWith(expect.anything(), "my-app", [
      "stop",
      "my-app",
      "--purge-session",
      DETACHED_STOP,
    ]);
  });

  it("copies the output while the detached stop runs, not only at its end", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const finish = runningDetachedStop();

    const run = program.parseAsync(["node", "test", "stop"]);
    await vi.waitFor(() => expect(mockStartDetachedStop).toHaveBeenCalled());
    writeFileSync(stderrLog, "- Stopping orchestrator session\n");
    await vi.waitFor(() => expect(writtenToStderr()).toBe("- Stopping orchestrator session\n"), {
      timeout: 2_000,
    });
    appendFileSync(stderrLog, "✔ Orchestrator session stopped\n");
    writeFileSync(stdoutLog, "Lifecycle worker stopped\n");
    finish(0);
    await run;

    expect(writtenToStderr()).toBe(
      "- Stopping orchestrator session\n✔ Orchestrator session stopped\n",
    );
    expect(written()).toBe("Lifecycle worker stopped\n");
  });

  it("Ctrl-C ends only this process: the stop goes on, and the PID and the logs are named", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const finish = runningDetachedStop();
    const listenersBefore = process.listenerCount("SIGINT");

    const run = program.parseAsync(["node", "test", "stop"]);
    await vi.waitFor(() => expect(process.listenerCount("SIGINT")).toBe(listenersBefore + 1));
    expect(() => process.emit("SIGINT")).toThrow("process.exit(130)");

    expect(writtenToStderr()).toContain(
      `ao stop: the stop goes on in the detached process (PID 4321); its output: ${stdoutLog} and ${stderrLog}`,
    );
    expect(mockSessionManager.kill).not.toHaveBeenCalled();
    finish(0);
    await run;
    expect(process.listenerCount("SIGINT")).toBe(listenersBefore);
  });

  /** A stderr write mock that holds back the callback of the Ctrl-C note. */
  function holdCtrlCNote(): { release(): void } {
    let held: ((err?: Error | null) => void) | undefined;
    stderrWrite.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((err?: Error | null) => void)
        | undefined;
      if (String(args[0]).includes("the stop goes on")) held = callback;
      else callback?.(null);
      return true;
    });
    return { release: () => held?.(null) };
  }

  it("Ctrl-C on a slow stderr: exit 130 only after the note is written (review r2 M-1)", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const finish = runningDetachedStop();
    const note = holdCtrlCNote();
    const listenersBefore = process.listenerCount("SIGINT");

    const run = program.parseAsync(["node", "test", "stop"]);
    await vi.waitFor(() => expect(process.listenerCount("SIGINT")).toBe(listenersBefore + 1));
    process.emit("SIGINT");

    expect(writtenToStderr()).toContain("ao stop: the stop goes on in the detached process");
    expect(process.exit).not.toHaveBeenCalled();
    expect(() => note.release()).toThrow("process.exit(130)");
    finish(0);
    await run;
  });

  it("Ctrl-C when the reader does not take the note: exit 130 after 2 s", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const finish = runningDetachedStop();
    holdCtrlCNote();
    const listenersBefore = process.listenerCount("SIGINT");

    const run = program.parseAsync(["node", "test", "stop"]);
    await vi.waitFor(() => expect(process.listenerCount("SIGINT")).toBe(listenersBefore + 1));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      process.emit("SIGINT");
      vi.advanceTimersByTime(1_999);
      expect(process.exit).not.toHaveBeenCalled();
      expect(() => vi.advanceTimersByTime(1)).toThrow("process.exit(130)");
    } finally {
      vi.useRealTimers();
    }
    finish(0);
    await run;
  });

  /** The progress note of a detached stop that still runs after 30 s. */
  const STILL_RUNS = (): string =>
    "ao stop: the stop still runs in the detached process (PID 4321) after 30 s; " +
    `Ctrl-C leaves it running; its output: ${stdoutLog} and ${stderrLog}\n`;

  it("a stop that still runs after 30 s: one note names the PID and the logs, and the wait goes on", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stderrLog, "- Stopping orchestrator session\n");

      await vi.advanceTimersByTimeAsync(29_900);
      expect(writtenToStderr()).toBe("- Stopping orchestrator session\n");
      await vi.advanceTimersByTimeAsync(200);
      expect(writtenToStderr()).toBe("- Stopping orchestrator session\n" + STILL_RUNS());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writtenToStderr().match(/still runs/g)).toHaveLength(1);
      expect(process.exit).not.toHaveBeenCalled();

      appendFileSync(stderrLog, "✔ Orchestrator session stopped\n");
      finish(0);
      await run;
      expect(writtenToStderr()).toBe(
        "- Stopping orchestrator session\n" + STILL_RUNS() + "✔ Orchestrator session stopped\n",
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stop that ends before 30 s: no note, and no timer is left to hold this process", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      await vi.advanceTimersByTimeAsync(29_000);
      finish(0);
      await run;

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writtenToStderr()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the progress note goes to stdout when stderr has an output error", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    stderrWrite.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((err?: Error | null) => void)
        | undefined;
      callback?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      return false;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stderrLog, "- Stopping orchestrator session\n");

      await vi.advanceTimersByTimeAsync(30_100);
      expect(written()).toBe(STILL_RUNS());
      expect(stderrWrite).toHaveBeenCalledTimes(1);

      finish(0);
      await run;
      expect(written()).toBe(
        STILL_RUNS() +
          `ao stop: could not write the stderr of the detached stop (write EPIPE); all of it is in ${stderrLog}\n`,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("review r4 m-1: the progress note goes to stdout when its own stderr write finds the output error", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    stderrWrite.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((err?: Error | null) => void)
        | undefined;
      callback?.(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      return false;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // The logs stay empty, so the note is the first write to stderr.
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);

      await vi.advanceTimersByTimeAsync(30_100);
      expect(writtenToStderr()).toBe(STILL_RUNS());
      expect(written()).toBe(STILL_RUNS());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(stdoutWrite).toHaveBeenCalledTimes(1);

      // The relay keeps the error of stderr and reports it at the end.
      appendFileSync(stderrLog, "✔ Orchestrator session stopped\n");
      finish(0);
      await run;
      expect(stderrWrite).toHaveBeenCalledTimes(1);
      expect(written()).toBe(
        STILL_RUNS() +
          `ao stop: could not write the stderr of the detached stop (write EPIPE); all of it is in ${stderrLog}\n`,
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  /** Holds back the callback of each write of `write` until `release`; later writes end at once. */
  function holdWrites(write: ReturnType<typeof vi.spyOn>): { release(): void } {
    const held: Array<(err?: Error | null) => void> = [];
    let holding = true;
    write.mockImplementation((...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((err?: Error | null) => void)
        | undefined;
      if (!holding) callback?.(null);
      else if (callback) held.push(callback);
      return !holding;
    });
    return {
      release: () => {
        holding = false;
        held.splice(0).forEach((callback) => callback(null));
      },
    };
  }

  it("review r4 m-2: a stdout copy that waits for a slow reader does not hold back the note on stderr", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const stdout = holdWrites(stdoutWrite);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stderrLog, "- Stopping orchestrator session\n");
      writeFileSync(stdoutLog, "Lifecycle worker stopped\n");

      await vi.advanceTimersByTimeAsync(29_900);
      expect(written()).toBe("Lifecycle worker stopped\n"); // Its callback is held.
      expect(writtenToStderr()).toBe("- Stopping orchestrator session\n");
      await vi.advanceTimersByTimeAsync(200);
      expect(writtenToStderr()).toBe("- Stopping orchestrator session\n" + STILL_RUNS());

      stdout.release();
      appendFileSync(stderrLog, "✔ Orchestrator session stopped\n");
      finish(0);
      await run;
      expect(writtenToStderr()).toBe(
        "- Stopping orchestrator session\n" + STILL_RUNS() + "✔ Orchestrator session stopped\n",
      );
      expect(written()).toBe("Lifecycle worker stopped\n");
      expect(process.exitCode).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("review r4: a stop that ends while the stdout copy waits for a slow reader gets no note after 30 s", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const stdout = holdWrites(stdoutWrite);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stdoutLog, "Lifecycle worker stopped\n");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(written()).toBe("Lifecycle worker stopped\n"); // Its callback is held.

      finish(0);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(writtenToStderr()).toBe("");
      stdout.release();
      await run;
      expect(writtenToStderr()).toBe("");
      expect(written()).toBe("Lifecycle worker stopped\n");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the note waits for a stderr chunk write to end, and is not written when the stop ended meanwhile", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const stderr = holdWrites(stderrWrite);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stderrLog, "- Stopping orchestrator session\n");

      await vi.advanceTimersByTimeAsync(30_100);
      expect(writtenToStderr()).toBe("- Stopping orchestrator session\n"); // Its callback is held.
      appendFileSync(stderrLog, "✔ Orchestrator session stopped\n");
      finish(0);
      await vi.advanceTimersByTimeAsync(0);
      stderr.release();
      await run;
      expect(writtenToStderr()).toBe(
        "- Stopping orchestrator session\n✔ Orchestrator session stopped\n",
      );
      expect(written()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a note that is due during a stderr chunk write goes after that chunk, and before the next", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    const stderr = holdWrites(stderrWrite);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const finish = runningDetachedStop();
      const run = program.parseAsync(["node", "test", "stop"]);
      writeFileSync(stderrLog, "- Stopping orchestrator");

      await vi.advanceTimersByTimeAsync(30_100);
      expect(writtenToStderr()).toBe("- Stopping orchestrator"); // Its callback is held.
      appendFileSync(stderrLog, " session\n");
      stderr.release();
      await vi.advanceTimersByTimeAsync(200);
      expect(writtenToStderr()).toBe("- Stopping orchestrator" + STILL_RUNS() + " session\n");

      finish(0);
      await run;
      expect(writtenToStderr().match(/still runs/g)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a detached process that does not start changes nothing and names the next action", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    detachedStop({}, () => Promise.reject(new Error("spawn ao ENOENT")));

    await program.parseAsync(["node", "test", "stop"]);

    expect(process.exitCode).toBe(1);
    expect(process.exit).not.toHaveBeenCalled();
    expect(writtenToStderr()).toContain(
      "The detached stop did not start (spawn ao ENOENT); nothing was stopped. Check that this ao can run, then run `ao stop my-app` again.",
    );
    expect(mockSessionManager.kill).not.toHaveBeenCalled();
    expect(mockStopLifecycleWorker).not.toHaveBeenCalled();
  });

  it("the detached process kills first, then stops the lifecycle worker, and prints no heading", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";

    await program.parseAsync(["node", "test", "stop", "my-app", DETACHED_STOP]);

    expect(mockStartDetachedStop).not.toHaveBeenCalled();
    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-orchestrator", {
      purgeOpenCode: false,
    });
    expect(mockStopLifecycleWorker).toHaveBeenCalledTimes(1);
    expect(mockSessionManager.kill.mock.invocationCallOrder[0]).toBeLessThan(
      mockStopLifecycleWorker.mock.invocationCallOrder[0],
    );
    expect(logged()).toContain("Orchestrator stopped");
    expect(logged()).not.toContain("Stopping orchestrator for");
  });

  it("the detached process keeps the lifecycle worker after a refused kill (same-ID R2a)", async () => {
    mockSessionManager.kill.mockRejectedValue(
      new RuntimeStopUnconfirmedError({
        sessionId: "app-orchestrator",
        handle,
        stop: {
          outcome: "unknown",
          detail: "the destroy of tmux session hash-app-orchestrator failed",
        },
        kept: "record and worktree kept",
        retry: "ao session kill app-orchestrator",
      }),
    );

    await expect(
      program.parseAsync(["node", "test", "stop", "my-app", DETACHED_STOP]),
    ).rejects.toThrow("process.exit(1)");

    expect(errors()).toContain("The lifecycle worker was not stopped.");
    expect(mockStopLifecycleWorker).not.toHaveBeenCalled();
  });

  it("a missing record needs no detached process, also inside a pane of that name", async () => {
    process.env["AO_SESSION"] = "app-orchestrator";
    mockSessionManager.get.mockResolvedValue(null);

    await program.parseAsync(["node", "test", "stop"]);

    expect(mockStartDetachedStop).not.toHaveBeenCalled();
    expect(mockSessionManager.kill).not.toHaveBeenCalled();
    expect(mockStopLifecycleWorker).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// autoCreateConfig — config generation defaults
// ---------------------------------------------------------------------------

describe("start command — autoCreateConfig", () => {
  it("generates config with empty notifiers array (no desktop notifier added by default)", async () => {
    const { detectEnvironment } = await import("../../src/lib/detect-env.js");
    vi.mocked(detectEnvironment).mockResolvedValue({
      isGitRepo: false,
      gitRemote: null,
      ownerRepo: null,
      currentBranch: null,
      defaultBranch: null,
      hasTmux: true,
      hasGh: false,
      ghAuthed: false,
      hasLinearKey: false,
      hasSlackWebhook: false,
    });

    const { detectProjectType } = await import("../../src/lib/project-detection.js");
    vi.mocked(detectProjectType).mockReturnValue({ languages: [], frameworks: [] });

    const { detectAvailableAgents, detectAgentRuntime } =
      await import("../../src/lib/detect-agent.js");
    vi.mocked(detectAvailableAgents).mockResolvedValue([]);
    vi.mocked(detectAgentRuntime).mockResolvedValue("claude-code");

    // start.ts uses `import { cwd } from "node:process"` which is intercepted
    // by the node:process mock defined at the top of this file.
    mockProcessCwd.mockReturnValue(tmpDir);

    await createConfigOnly();

    const configPath = join(tmpDir, "agent-orchestrator.yaml");
    expect(existsSync(configPath)).toBe(true);

    const content = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(content) as { defaults?: { notifiers?: unknown[] } };
    expect(parsed.defaults?.notifiers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// OpenCode 2.x install option — `npm install -g @opencode/cli` with --force
// only when legacy `opencode-ai` owns the `opencode` bin.
// Detection is read-only (`npm ls -g opencode-ai --depth=0 --json`); every
// npm call here is mocked, so no test installs or removes a global package.
// Assertions compare the present/absent runs against each other (relations),
// not against a copied literal of the install command.
// ---------------------------------------------------------------------------

describe("start command — OpenCode 2.x install option", () => {
  function packageArgOf(optionId: string): string | undefined {
    const option = AGENT_INSTALL_OPTIONS.find((o) => o.id === optionId);
    // The npm package is the non-flag arg after "install -g".
    return option?.args.find((a) => !a.startsWith("-") && a !== "install");
  }

  function mockNpmLsSuccess(stdout: string): void {
    mockExec.mockResolvedValue({ stdout, stderr: "" });
  }

  function mockNpmLsFailure(stdout: string | null): void {
    if (stdout === null) {
      mockExec.mockRejectedValue(new Error("npm not found"));
      return;
    }
    mockExec.mockRejectedValue(
      Object.assign(new Error("Command failed: npm ls -g opencode-ai"), {
        stdout,
        stderr: "",
        code: 1,
      }),
    );
  }

  it("names @opencode/cli for OpenCode and leaves other agents unchanged", () => {
    expect(packageArgOf("opencode")).toBe("@opencode/cli");
    expect(packageArgOf("opencode")).not.toBe("opencode-ai");
    expect(packageArgOf("claude-code")).toBe("@anthropic-ai/claude-code");
    expect(packageArgOf("codex")).toBe("@openai/codex");
    expect(packageArgOf("gemini")).toBe("@google/gemini-cli");
  });

  it("adds exactly one trailing flag when legacy is present, and none when absent", () => {
    const without = buildOpenCodeInstallArgs(false);
    const withLegacy = buildOpenCodeInstallArgs(true);

    expect(withLegacy.length).toBe(without.length + 1);
    expect(withLegacy.slice(0, -1)).toEqual(without);
    expect(without).not.toContain(withLegacy[withLegacy.length - 1]);
    expect(withLegacy[withLegacy.length - 1]).toBe("--force");
  });

  it("emits a reasoned notice only when legacy is present", () => {
    const absentNotice = openCodeInstallNotice(false);
    const presentNotice = openCodeInstallNotice(true);

    expect(absentNotice).toBeNull();
    expect(presentNotice).not.toBeNull();
    expect(presentNotice ?? "").toContain("opencode-ai");
    expect(presentNotice ?? "").toContain("--force");
  });

  it("detects legacy present from the read-only npm ls JSON", async () => {
    mockNpmLsSuccess(
      JSON.stringify({
        name: "lib",
        dependencies: { "opencode-ai": { version: "1.19.0", overridden: false } },
      }),
    );

    await expect(isLegacyOpenCodeInstalled()).resolves.toBe(true);
    expect(mockExec).toHaveBeenCalledWith("npm", [
      "ls",
      "-g",
      "opencode-ai",
      "--depth=0",
      "--json",
    ]);
  });

  it("detects legacy absent from the read-only npm ls exit-1 shape", async () => {
    // Real `npm ls -g opencode-ai --depth=0 --json` with nothing installed
    // exits 1 and still prints `{ "name": "lib" }` on stdout.
    mockNpmLsFailure('{\n  "name": "lib"\n}\n');

    await expect(isLegacyOpenCodeInstalled()).resolves.toBe(false);
    expect(mockExec).toHaveBeenCalledWith("npm", [
      "ls",
      "-g",
      "opencode-ai",
      "--depth=0",
      "--json",
    ]);
  });

  it("treats a failed detection as absent without throwing", async () => {
    mockNpmLsFailure(null);

    await expect(isLegacyOpenCodeInstalled()).resolves.toBe(false);
  });

  it("detects legacy present from err.stdout when npm exits nonzero", async () => {
    // npm can reject yet still print the package on stdout; the catch
    // branch parses that output instead of defaulting to absent.
    mockNpmLsFailure(
      JSON.stringify({
        name: "lib",
        dependencies: { "opencode-ai": { version: "1.19.0", overridden: false } },
      }),
    );

    await expect(isLegacyOpenCodeInstalled()).resolves.toBe(true);
  });

  it("resolves the install plan relationally: present adds the flag and notice, absent adds neither", async () => {
    mockNpmLsSuccess(
      JSON.stringify({
        name: "lib",
        dependencies: { "opencode-ai": { version: "1.19.0", overridden: false } },
      }),
    );
    const present = await resolveOpenCodeInstall();

    mockNpmLsFailure('{\n  "name": "lib"\n}\n');
    const absent = await resolveOpenCodeInstall();

    expect(present.args.length).toBe(absent.args.length + 1);
    expect(present.args.slice(0, -1)).toEqual(absent.args);
    expect(absent.args).not.toContain(present.args[present.args.length - 1]);
    expect(absent.notice).toBeNull();
    expect(present.notice).not.toBeNull();
  });

  it("resolves a failed detection like the absent case, without throwing", async () => {
    mockNpmLsFailure(null);
    const failed = await resolveOpenCodeInstall();

    mockNpmLsFailure('{\n  "name": "lib"\n}\n');
    const absent = await resolveOpenCodeInstall();

    expect(failed.args).toEqual(absent.args);
    expect(failed.notice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OpenCode install call site — through `promptInstallAgentRuntime` via
// `createConfigOnly`, asserting the argv that reaches `spawn`. `spawn` and
// the prompts are mocked, and `exec` is mocked, so no real npm runs.
// ---------------------------------------------------------------------------

describe("start command — OpenCode install call site", () => {
  const presentStdout = JSON.stringify({
    name: "lib",
    dependencies: { "opencode-ai": { version: "1.19.0", overridden: false } },
  });

  async function runInstallChoice(choice: string): Promise<void> {
    const { detectEnvironment } = await import("../../src/lib/detect-env.js");
    vi.mocked(detectEnvironment).mockResolvedValue({
      isGitRepo: false,
      gitRemote: null,
      ownerRepo: null,
      currentBranch: null,
      defaultBranch: null,
      hasTmux: true,
      hasGh: false,
      ghAuthed: false,
      hasLinearKey: false,
      hasSlackWebhook: false,
    });
    const { detectProjectType } = await import("../../src/lib/project-detection.js");
    vi.mocked(detectProjectType).mockReturnValue({ languages: [], frameworks: [] });
    const { detectAvailableAgents, detectAgentRuntime } =
      await import("../../src/lib/detect-agent.js");
    vi.mocked(detectAvailableAgents).mockResolvedValue([]);
    vi.mocked(detectAgentRuntime).mockResolvedValue("claude-code");
    const { isHumanCaller } = await import("../../src/lib/caller-context.js");
    vi.mocked(isHumanCaller).mockReturnValue(true);
    vi.mocked(promptSelect).mockResolvedValue(choice);
    mockProcessCwd.mockReturnValue(tmpDir);
    await createConfigOnly();
  }

  function loggedOutput(): string {
    return vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(" "))
      .join("\n");
  }

  it("opencode with legacy absent installs @opencode/cli with no --force and no notice", async () => {
    mockExec.mockRejectedValue(
      Object.assign(new Error("Command failed: npm ls -g opencode-ai"), {
        stdout: '{\n  "name": "lib"\n}\n',
        stderr: "",
        code: 1,
      }),
    );

    await runInstallChoice("opencode");

    expect(spawnCalls).toEqual([["npm", ["install", "-g", "@opencode/cli"]]]);
    expect(loggedOutput()).not.toContain("--force");
  });

  it("opencode with legacy present adds --force and prints the one-line notice", async () => {
    mockExec.mockResolvedValue({ stdout: presentStdout, stderr: "" });

    await runInstallChoice("opencode");

    expect(spawnCalls).toEqual([["npm", ["install", "-g", "@opencode/cli", "--force"]]]);
    const logged = loggedOutput();
    expect(logged).toContain("--force");
    expect(logged).toContain("opencode-ai");
  });

  it("another agent with legacy present keeps its own row and runs no detection", async () => {
    mockExec.mockResolvedValue({ stdout: presentStdout, stderr: "" });

    await runInstallChoice("codex");

    const codex = AGENT_INSTALL_OPTIONS.find((o) => o.id === "codex");
    expect(spawnCalls).toEqual([[codex?.cmd, codex?.args]]);
    expect(mockExec.mock.calls.some((c) => c[0] === "npm")).toBe(false);
    expect(loggedOutput()).not.toContain("--force");
  });
});
