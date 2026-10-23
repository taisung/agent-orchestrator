/**
 * Herdr fit-1 interim startup rule (owner decision OQ-F1 (b), 2026-10-22; the
 * fit-2 guard G replaces it), through `ao start` with the real session manager
 * (real `sm.list` and `spawnOrchestrator`) and the real runtime-herdr plugin.
 * Only `herdr` is a stand-in: it answers with the recorded 0.9.5 answers of
 * the live check (exit 1, one stderr line). Before fit F-1 those answers
 * rejected, so `ao start` refused. After F-1 a closed pane is `isAlive` false
 * (and `sm.list` shows the record killed and exited) and no server is
 * RUNTIME_NO_SERVER_ERROR_CODE. For a Herdr record neither may retire the old
 * orchestrator or start a second one, in either workspace mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import {
  getProjectBaseDir,
  getSessionsDir,
  isHerdrProcessRunning,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Session,
  type Workspace,
} from "@aoagents/ao-core";
import { herdrFixture, herdrRejection, type HerdrFixture } from "../herdr-fixtures.js";

const { mockConfigRef, registryRef, mockEnsureLifecycleWorker, herdrStandIn } = vi.hoisted(() => ({
  mockConfigRef: { current: null as unknown },
  registryRef: { current: null as unknown },
  mockEnsureLifecycleWorker: vi.fn(),
  herdrStandIn: {
    /** The recorded answer of `pane get`, and of `pane process-info`. */
    paneGet: null as unknown,
    processInfo: null as unknown,
    calls: [] as string[][],
  },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  // No real herdr or tmux runs: the callback form refuses them.
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    if (cmd === "herdr" || cmd === "tmux") throw new Error(`unexpected command: ${cmd}`);
    return (actual.execFile as (...args: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "herdr") throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
      herdrStandIn.calls.push(args);
      if (args[0] === "pane" && args[1] === "get") throw herdrStandIn.paneGet;
      if (args[0] === "pane" && args[1] === "process-info") throw herdrStandIn.processInfo;
      throw new Error(`unexpected herdr call: ${args.join(" ")}`);
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

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
import { create as createHerdrRuntime } from "@aoagents/ao-plugin-runtime-herdr";
import { registerStart } from "../../src/commands/start.js";

let tmpDir: string;
let config: OrchestratorConfig;
let sessionsDir: string;
let workspace: Workspace;
let program: Command;

const HANDLE = JSON.stringify({
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a", sessionId: "app" },
});

function setup(mode: "project" | "isolated"): void {
  const configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const projectPath = join(tmpDir, "my-app");
  mkdirSync(projectPath, { recursive: true });
  config = {
    configPath,
    port: 3000,
    defaults: { runtime: "herdr", agent: "stand-in", workspace: "stand-in", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        runtime: "herdr",
        orchestratorWorkspaceMode: mode,
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    readyThresholdMs: 300_000,
  } as OrchestratorConfig;
  mockConfigRef.current = config;

  // The real plugin; its terminal output is a stand-in.
  const runtime: Runtime = { ...createHerdrRuntime(), getOutput: vi.fn(async () => "") };
  // The agent reads its Herdr pane through core, as the retained agents do.
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "true",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    isProcessRunning: async (handle: { id: string }) =>
      isHerdrProcessRunning(handle.id, /stand-in/),
    getActivityState: async (session: Session) => {
      if (!session.runtimeHandle) return null;
      const running = await isHerdrProcessRunning(session.runtimeHandle.id, /stand-in/);
      return running ? null : { state: "exited" };
    },
    getSessionInfo: async () => null,
  } as unknown as Agent;
  workspace = {
    name: "stand-in",
    create: vi.fn(async () => {
      throw new Error("unexpected workspace create");
    }),
    destroy: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
  } as unknown as Workspace;
  registryRef.current = {
    get: (slot: string) =>
      slot === "runtime"
        ? runtime
        : slot === "agent"
          ? agent
          : slot === "workspace"
            ? workspace
            : null,
    list: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    loadBuiltins: vi.fn(),
    loadFromConfig: vi.fn(),
  } as unknown as PluginRegistry;

  sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });
}

function writeOrchestrator(id: string, extra: Record<string, string> = {}): void {
  writeMetadata(sessionsDir, id, {
    worktree: id === "app-orchestrator" ? config.projects["my-app"]!.path : join(tmpDir, id),
    branch: id === "app-orchestrator" ? "main" : `orchestrator/${id}`,
    status: "working",
    role: "orchestrator",
    project: "my-app",
    runtimeHandle: HANDLE,
    ...extra,
  });
}

/** Every file of the sessions directory (also the archive) with its content. */
function sessionsListing(): Record<string, string> {
  const listing: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else listing[`${prefix}${entry.name}`] = readFileSync(path, "utf-8");
    }
  };
  walk(sessionsDir, "");
  return listing;
}

function errors(): string {
  return vi
    .mocked(console.error)
    .mock.calls.map((c) => c.join(" "))
    .join("\n");
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-start-herdr-interim-"));
  herdrStandIn.calls = [];
  mockEnsureLifecycleWorker.mockResolvedValue({
    running: true,
    started: false,
    pid: 12345,
    pidFile: "/tmp/lifecycle-worker.pid",
    logFile: "/tmp/lifecycle-worker.log",
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
  if (config) {
    rmSync(getProjectBaseDir(config.configPath, config.projects["my-app"]!.path), {
      recursive: true,
      force: true,
    });
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const ANSWERS: Array<[string, HerdrFixture, HerdrFixture]> = [];
function answers(): Array<[string, HerdrFixture, HerdrFixture]> {
  if (ANSWERS.length === 0) {
    ANSWERS.push(
      [
        "the 0.9.5 pane_not_found answer",
        herdrFixture("closedpane_pane_get"),
        herdrFixture("closedpane_pane_process_info"),
      ],
      [
        "the 0.9.5 no-server answer",
        herdrFixture("noserver_never_pane_get"),
        herdrFixture("noserver_stopped_pane_process_info"),
      ],
    );
  }
  return ANSWERS;
}

describe("ao start with an old Herdr orchestrator, through the real session manager (fit-1 interim)", () => {
  for (const [mode, id] of [
    ["project", "app-orchestrator"],
    ["isolated", "app-orchestrator-1"],
  ] as const) {
    for (const index of [0, 1]) {
      for (const [persisted, extra] of [
        ["working", {}],
        ["killed by the lifecycle (runtime)", { status: "killed", killedReason: "runtime" }],
      ] as const) {
        it(`${mode} mode, answer ${index + 1}, a record ${persisted}: exit 1, record kept, no new orchestrator`, async () => {
          const [label, paneGet, processInfo] = answers()[index]!;
          herdrStandIn.paneGet = herdrRejection(paneGet);
          herdrStandIn.processInfo = herdrRejection(processInfo);
          setup(mode);
          writeOrchestrator(id, extra);
          const before = sessionsListing();

          await expect(program.parseAsync(["node", "test", "start"]), label).rejects.toThrow(
            "process.exit(1)",
          );

          expect(errors()).toContain(`Cannot tell whether orchestrator session ${id} is alive (`);
          expect(errors()).toContain(
            "It is neither reused nor replaced, and no new orchestrator was started. Check the runtime and run `ao start` again.",
          );
          // `sm.list` adds `prAutoDetect=off` to an orchestrator record (as
          // before the fit); nothing else is written, archived or added (the
          // archive is sessions/archive).
          const after = sessionsListing();
          expect(Object.keys(after)).toEqual(Object.keys(before));
          const record = readMetadataRaw(sessionsDir, id);
          expect(record?.["runtimeHandle"]).toBe(HANDLE);
          expect(record?.["status"]).toBe(extra.status ?? "working");
          expect(workspace.create).not.toHaveBeenCalled();
          expect(
            herdrStandIn.calls.filter((args) => args[0] !== "pane" || !args.includes("w3:p2")),
          ).toEqual([]);
        });
      }
    }
  }
});
