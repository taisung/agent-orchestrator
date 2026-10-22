/**
 * Review r1 M-3 (2026-10-22): `ao start` with the real session manager (real
 * `sm.list` and `spawnOrchestrator`, not mocks) and a runtime whose `isAlive`
 * answers a value that is not a boolean. Whether the record stays a candidate
 * (the probe of `ao start` decides) or the agent reports it exited (then
 * `spawnOrchestrator` decides), the answer is unknown: no new orchestrator,
 * the record kept, exit 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getArchiveDir,
  getProjectBaseDir,
  getSessionsDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
} from "@aoagents/ao-core";

const { mockConfigRef, registryRef, mockEnsureLifecycleWorker } = vi.hoisted(() => ({
  mockConfigRef: { current: null as unknown },
  registryRef: { current: null as unknown },
  mockEnsureLifecycleWorker: vi.fn(),
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    loadConfig: (path?: string) => (path ? actual.loadConfig(path) : mockConfigRef.current),
  };
});

vi.mock("../../src/lib/create-session-manager.js", async () => {
  const core = await import("@aoagents/ao-core");
  return {
    getSessionManager: async (config: OrchestratorConfig) =>
      core.createSessionManager({ config, registry: registryRef.current as PluginRegistry }),
    getPluginRegistry: async () => registryRef.current,
  };
});

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  ensureLifecycleWorker: mockEnsureLifecycleWorker,
  stopLifecycleWorker: vi.fn(),
  startDetachedStop: vi.fn(),
}));

vi.mock("../../src/lib/shell.js", () => ({
  tmux: vi.fn(),
  exec: vi.fn(),
  execSilent: vi.fn().mockResolvedValue(null),
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: vi.fn().mockResolvedValue([]),
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("ora", () => ({
  default: () => {
    const spinner = {
      start: () => spinner,
      stop: () => spinner,
      succeed: () => spinner,
      fail: () => spinner,
      info: () => spinner,
      text: "",
    };
    return spinner;
  },
}));

vi.mock("../../src/lib/prompts.js", () => ({ promptSelect: vi.fn(), promptConfirm: vi.fn() }));

vi.mock("../../src/lib/caller-context.js", () => ({
  isHumanCaller: vi.fn().mockReturnValue(false),
  getCallerType: vi.fn().mockReturnValue("agent"),
}));

import { Command } from "commander";
import { registerStart } from "../../src/commands/start.js";

let tmpDir: string;
let config: OrchestratorConfig;
let sessionsDir: string;
let runtime: Runtime;
let agent: Agent;
let program: Command;

const OLD_HANDLE = JSON.stringify({ id: "rt-old", runtimeName: "mock", data: {} });

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-start-malformed-"));
  const configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const projectPath = join(tmpDir, "my-app");
  mkdirSync(projectPath, { recursive: true });
  config = {
    configPath,
    port: 3000,
    defaults: { runtime: "mock", agent: "mock-agent", workspace: "mock-ws", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        orchestratorWorkspaceMode: "project",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    readyThresholdMs: 300_000,
  } as OrchestratorConfig;
  mockConfigRef.current = config;
  mockEnsureLifecycleWorker.mockResolvedValue({
    running: true,
    started: false,
    pid: 12345,
    pidFile: "/tmp/lifecycle-worker.pid",
    logFile: "/tmp/lifecycle-worker.log",
  });

  runtime = {
    name: "mock",
    create: vi.fn().mockResolvedValue({ id: "rt-new", runtimeName: "mock", data: {} }),
    destroy: vi.fn().mockResolvedValue(undefined),
    isAlive: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getOutput: vi.fn().mockResolvedValue(""),
  } as unknown as Runtime;
  agent = {
    name: "mock-agent",
    processName: "mock",
    getLaunchCommand: vi.fn().mockReturnValue("mock-agent --start"),
    getEnvironment: vi.fn().mockReturnValue({}),
    detectActivity: vi.fn().mockReturnValue("active"),
    getActivityState: vi.fn().mockResolvedValue(null),
    isProcessRunning: vi.fn().mockResolvedValue(false),
    getSessionInfo: vi.fn().mockResolvedValue(null),
  } as unknown as Agent;
  registryRef.current = {
    get: (slot: string) => (slot === "runtime" ? runtime : slot === "agent" ? agent : null),
    list: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    loadBuiltins: vi.fn(),
    loadFromConfig: vi.fn(),
  } as unknown as PluginRegistry;

  sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });
  writeMetadata(sessionsDir, "app-orchestrator", {
    worktree: projectPath,
    branch: "main",
    status: "working",
    role: "orchestrator",
    project: "my-app",
    runtimeHandle: OLD_HANDLE,
  });

  program = new Command();
  program.exitOverride();
  registerStart(program);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(getProjectBaseDir(config.configPath, config.projects["my-app"]!.path), {
    recursive: true,
    force: true,
  });
  rmSync(tmpDir, { recursive: true, force: true });
});

function errors(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((c) => c.join(" "))
    .join("\n");
}

describe("ao start with a malformed isAlive answer, through the real session manager (review r1 M-3)", () => {
  it.each([
    { answer: "undefined", value: undefined },
    { answer: "null", value: null },
    { answer: "0", value: 0 },
  ])(
    "isAlive answers $answer, record still a candidate: the probe of ao start refuses",
    async ({ answer, value }) => {
      vi.mocked(runtime.isAlive).mockResolvedValue(value as unknown as boolean);

      await expect(program.parseAsync(["node", "test", "start"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(errors()).toContain(
        `Cannot tell whether orchestrator session app-orchestrator is alive (the liveness check of mock session rt-old answered ${answer}, not true or false).`,
      );
      expect(runtime.create).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(OLD_HANDLE);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["status"]).toBe("working");
      const archiveDir = getArchiveDir(config.configPath, config.projects["my-app"]!.path);
      expect(existsSync(archiveDir) ? readdirSync(archiveDir) : []).toEqual([]);
    },
  );

  it.each([
    { answer: "undefined", value: undefined },
    { answer: "null", value: null },
    { answer: "0", value: 0 },
  ])(
    "isAlive answers $answer, the agent reports exited: spawnOrchestrator refuses",
    async ({ answer, value }) => {
      vi.mocked(runtime.isAlive).mockResolvedValue(value as unknown as boolean);
      vi.mocked(agent.getActivityState).mockResolvedValue({ state: "exited" });

      await expect(program.parseAsync(["node", "test", "start"])).rejects.toThrow(
        "process.exit(1)",
      );

      expect(errors()).toContain(
        `Failed to setup orchestrator: Cannot tell whether session app-orchestrator is alive (the liveness check answered ${answer}, not true or false), so it is neither reused nor replaced.`,
      );
      expect(runtime.create).not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toBe(OLD_HANDLE);
      const archiveDir = getArchiveDir(config.configPath, config.projects["my-app"]!.path);
      expect(existsSync(archiveDir) ? readdirSync(archiveDir) : []).toEqual([]);
    },
  );
});
