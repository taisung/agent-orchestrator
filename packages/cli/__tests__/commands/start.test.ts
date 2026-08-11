/**
 * Tests for `ao start` and `ao stop` commands.
 *
 * Uses --no-orchestrator where needed to isolate project resolution from
 * orchestrator-session infrastructure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";
import type { SessionManager } from "@aoagents/ao-core";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockExec,
  mockExecSilent,
  mockConfigRef,
  mockSessionManager,
  mockEnsureLifecycleWorker,
  mockStopLifecycleWorker,
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
  default: () => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    text: "",
  }),
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
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  ensureLifecycleWorker: (...args: unknown[]) => mockEnsureLifecycleWorker(...args),
  stopLifecycleWorker: (...args: unknown[]) => mockStopLifecycleWorker(...args),
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
import { registerStart, registerStop, createConfigOnly } from "../../src/commands/start.js";

let tmpDir: string;
let program: Command;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-start-test-"));

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
  mockProcessCwd.mockReset();
});

afterEach(() => {
  if (cwdSpy) cwdSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
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
  it("stops the orchestrator session and lifecycle worker", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockResolvedValue(undefined);
    mockExec.mockResolvedValue({ stdout: "12345", stderr: "" });

    await program.parseAsync(["node", "test", "stop"]);

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

  it("passes purge flag when stopping orchestrator with --purge-session", async () => {
    mockConfigRef.current = makeConfig({ "my-app": makeProject() });
    mockSessionManager.get.mockResolvedValue({ id: "app-orchestrator", status: "running" });
    mockSessionManager.kill.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "stop", "--purge-session"]);

    expect(mockSessionManager.kill).toHaveBeenCalledWith("app-orchestrator", {
      purgeOpenCode: true,
    });
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
