/**
 * Herdr fit-2 F-7 at `ao start` (design development/reviews/herdr_fit2_design_r11_opus.md
 * section 5.3.5 and the CLI rows of 5.3.10; fit-2b commit 6): the CLI splits
 * the orchestrator candidates by G1's predicate, leaves a Herdr record to
 * core's reuse decision and admission, asks the selected runtime's
 * preflight, and prints core's block (message M) as it is. Through `ao start`
 * with the real session manager and the real runtime-herdr plugin (its own
 * binary is a file that never runs). Only `herdr` is a stand-in: a mocked
 * `node:child_process` answers each call by the HERDR_SOCKET_PATH of that
 * call (a pinned handle sets it), and the caller's own endpoint answers
 * `status server --json`. The workspace and agent plugins are stand-ins
 * that record their calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import {
  getProjectBaseDir,
  getSessionsDir,
  readMetadataRaw,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
  type SessionManager,
  type Workspace,
} from "@aoagents/ao-core";

type ExecOut = { stdout: string; stderr: string };
type HerdrHook = (args: string[], answer: () => Promise<ExecOut>) => Promise<ExecOut>;

const { mockConfigRef, registryRef, smHooks, mockEnsureLifecycleWorker, herdr, oraLog, tmux } =
  vi.hoisted(() => {
    const ok = (id: string, result: unknown): ExecOut => ({
      stdout: JSON.stringify({ id, result }),
      stderr: "",
    });
    const failure = (args: string[], id: string, code: string, message: string): Error => {
      const line = JSON.stringify({ id, error: { code, message } });
      return Object.assign(new Error(`Command failed: herdr ${args.join(" ")}\n${line}\n`), {
        code: 1,
        signal: null,
        killed: false,
        stdout: "",
        stderr: `${line}\n`,
      });
    };
    const state = {
      bin: "",
      callerSocket: "",
      status: "",
      calls: [] as Array<{ args: string[]; socket: string }>,
      next: 7,
      panes: new Map<string, { socket: string; terminal: string }>(),
      dead: new Set<string>(),
      on: {} as Record<string, HerdrHook | undefined>,
      scripts: [] as string[],
      reset(): void {
        state.calls = [];
        state.next = 7;
        state.panes = new Map();
        state.dead = new Set();
        state.on = {};
        state.scripts = [];
      },
      async answer(args: string[], socket: string): Promise<ExecOut> {
        const key = `${args[0]} ${args[1]}`;
        if (state.dead.has(socket)) {
          throw failure(
            args,
            `cli:${args[0]}:${args[1]}`,
            "server_not_running",
            `no herdr server is running at ${socket}; run \`herdr\` to start or attach it`,
          );
        }
        if (key === "status server") return { stdout: state.status, stderr: "" };
        if (key === "workspace create") {
          const id = `w${state.next++}`;
          const pane = `${id}:p1`;
          const terminal = `term_${id}`;
          state.panes.set(pane, { socket, terminal });
          return ok("cli:workspace:create", {
            workspace: { workspace_id: id },
            root_pane: { pane_id: pane, terminal_id: terminal, workspace_id: id },
          });
        }
        if (key === "pane run") {
          state.scripts.push(args[4] ?? "");
          return ok("cli:request", {});
        }
        if (key === "pane get") {
          const pane = state.panes.get(args[2] ?? "");
          if (pane && pane.socket === socket) {
            return ok("cli:pane:get", {
              pane: {
                pane_id: args[2],
                terminal_id: pane.terminal,
                agent: "stand-in",
                agent_status: "idle",
              },
            });
          }
          throw failure(args, "cli:pane:get", "pane_not_found", `pane ${args[2]} not found`);
        }
        throw new Error(`unexpected herdr call: ${args.join(" ")}`);
      },
    };
    return {
      mockConfigRef: { current: null as unknown },
      registryRef: { current: null as unknown },
      /** Wraps of the CLI's session manager: marks around each `list`, a hook before the reuse decision. */
      smHooks: {
        marks: [] as string[],
        beforeReuse: null as null | (() => void),
        spawnOrchestratorCalls: 0,
      },
      mockEnsureLifecycleWorker: vi.fn(),
      herdr: state,
      oraLog: [] as Array<[string, string | undefined]>,
      tmux: { calls: [] as Array<{ method: string; handle?: RuntimeHandle }> },
    };
  });

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  // No real herdr or tmux runs: the callback form refuses them.
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    if (cmd === herdr.bin || cmd === "herdr" || cmd === "tmux") {
      throw new Error(`unexpected command: ${cmd}`);
    }
    return (actual.execFile as (...args: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[], ...rest: unknown[]) => {
      if (cmd === herdr.bin) {
        const options = rest[0] as { env?: NodeJS.ProcessEnv } | undefined;
        const socket = options?.env?.["HERDR_SOCKET_PATH"] ?? herdr.callerSocket;
        herdr.calls.push({ args, socket });
        const hook = herdr.on[`${args[0]} ${args[1]}`];
        return hook ? hook(args, () => herdr.answer(args, socket)) : herdr.answer(args, socket);
      }
      if (cmd === "herdr" || cmd === "tmux") {
        throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
      }
      return promisify(actual.execFile)(cmd, args, ...(rest as [ChildProcess.ExecFileOptions]));
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

// The plugin's waits resolve at once (core's bounds use the global timers).
vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
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
    getSessionManager: async (config: OrchestratorConfig) => {
      const sm = core.createSessionManager({
        config,
        registry: registryRef.current as PluginRegistry,
      });
      return {
        ...sm,
        list: async (projectId?: string) => {
          smHooks.marks.push("list:start");
          try {
            return await sm.list(projectId);
          } finally {
            smHooks.marks.push("list:end");
          }
        },
        findReusableOrchestrators: async (projectId: string) => {
          smHooks.beforeReuse?.();
          return sm.findReusableOrchestrators(projectId);
        },
        spawnOrchestrator: async (...args: Parameters<SessionManager["spawnOrchestrator"]>) => {
          smHooks.spawnOrchestratorCalls += 1;
          return sm.spawnOrchestrator(...args);
        },
      };
    },
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
  exec: vi.fn().mockResolvedValue({ stdout: "tmux 3.4", stderr: "" }),
  execSilent: vi.fn().mockResolvedValue("tmux 3.4"),
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: vi.fn().mockResolvedValue([]),
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("ora", () => ({
  default: () => {
    const logged = (method: string) => (text?: string) => {
      oraLog.push([method, text]);
      return spinner;
    };
    const spinner = {
      start: logged("start"),
      stop: logged("stop"),
      succeed: logged("succeed"),
      fail: logged("fail"),
      info: logged("info"),
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
import { herdrFixture } from "../herdr-fixtures.js";

/** The recorded healthy `status server --json` answer, with another socket. */
function statusAt(socket: string): string {
  const status = JSON.parse(herdrFixture("closedpane_status_server_json").stdout) as Record<
    string,
    unknown
  >;
  return JSON.stringify({ ...status, socket });
}

const SOCKET = "/tmp/aofit2b-cli/caller.sock";
const OLD_SOCKET = "/tmp/aofit2b-cli/old.sock";
const OTHER_CLAIM = { launchPid: "2147483000", launchPidStart: "stat:12345" };
const PENDING = JSON.stringify({
  id: "",
  runtimeName: "herdr",
  data: { createIncomplete: "create-pending" },
});
const FIXED = "app-orchestrator";

let tmpDir: string;
let config: OrchestratorConfig;
let sessionsDir: string;
let workspaceCalls: string[];
let agentRuns: { value: boolean };
let onPostLaunch: { run?: () => Promise<void> };
let sm: () => SessionManager;

interface Options {
  mode?: "project" | "isolated";
  selects?: "herdr" | "tmux";
  /** The project's runtime is a stand-in named herdr that records each call (T-7.9b). */
  recordingHerdr?: Array<{ method: string; handle?: RuntimeHandle }>;
}

async function setup(options: Options = {}): Promise<void> {
  const configPath = join(tmpDir, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const projectPath = join(tmpDir, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const selects = options.selects ?? "herdr";
  config = {
    configPath,
    port: 3000,
    defaults: { runtime: selects, agent: "stand-in", workspace: "stand-in", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        runtime: selects,
        orchestratorWorkspaceMode: options.mode ?? "project",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    readyThresholdMs: 300_000,
  } as OrchestratorConfig;
  mockConfigRef.current = config;

  herdr.bin = join(tmpDir, "bin", "herdr");
  mkdirSync(join(tmpDir, "bin"), { recursive: true });
  writeFileSync(herdr.bin, "", { mode: 0o755 });
  const realHerdr = createHerdrRuntime({ binPath: herdr.bin });
  const recording = options.recordingHerdr;
  const herdrRuntime: Runtime = recording
    ? ({
        name: "herdr",
        create: async () => {
          recording.push({ method: "create" });
          throw new Error("unexpected create");
        },
        destroy: async (handle: RuntimeHandle) => {
          recording.push({ method: "destroy", handle });
        },
        isAlive: async (handle: RuntimeHandle) => {
          recording.push({ method: "isAlive", handle });
          return true;
        },
        sendMessage: async () => undefined,
        getOutput: async () => "",
      } as unknown as Runtime)
    : { ...realHerdr, getOutput: async () => "" };
  const tmuxRuntime = {
    name: "tmux",
    create: async () => {
      tmux.calls.push({ method: "create" });
      throw new Error("unexpected tmux create");
    },
    destroy: async (handle: RuntimeHandle) => {
      tmux.calls.push({ method: "destroy", handle });
    },
    isAlive: async (handle: RuntimeHandle) => {
      tmux.calls.push({ method: "isAlive", handle });
      return false;
    },
    sendMessage: async () => undefined,
    getOutput: async () => "",
  } as unknown as Runtime;
  workspaceCalls = [];
  agentRuns = { value: true };
  onPostLaunch = {};
  const workspace = {
    name: "stand-in",
    create: async (cfg: { sessionId: string; projectId: string; branch: string }) => {
      workspaceCalls.push(`create ${cfg.sessionId}`);
      const path = join(tmpDir, "worktrees", cfg.sessionId);
      mkdirSync(path, { recursive: true });
      return { path, branch: cfg.branch, sessionId: cfg.sessionId, projectId: cfg.projectId };
    },
    destroy: async (path: string) => {
      workspaceCalls.push(`destroy ${path}`);
    },
    exists: async () => true,
    list: async () => [],
  } as unknown as Workspace;
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "stand-in --run",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async () =>
      agentRuns.value ? null : { state: "exited", timestamp: new Date() },
    isProcessRunning: async () => agentRuns.value,
    getSessionInfo: async () => null,
    postLaunchSetup: async () => {
      await onPostLaunch.run?.();
    },
  } as unknown as Agent;
  const registry = {
    get: (slot: string, name: string) =>
      slot === "runtime"
        ? name === "herdr"
          ? herdrRuntime
          : name === "tmux"
            ? tmuxRuntime
            : null
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
  registryRef.current = registry;
  const core = await import("@aoagents/ao-core");
  sm = () => core.createSessionManager({ config, registry });

  sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });
}

function pinned(pane: string, terminal: string, socket = SOCKET): RuntimeHandle {
  return {
    id: pane,
    runtimeName: "herdr",
    data: {
      workspaceId: pane.split(":")[0],
      paneId: pane,
      terminalId: terminal,
      sessionId: "app",
      herdrBin: herdr.bin,
      herdrSocket: socket,
    },
  };
}

function paneRuns(pane: string, terminal: string, socket = SOCKET): void {
  herdr.panes.set(pane, { socket, terminal });
}

function writeRecord(id: string, data: Record<string, string>): Record<string, string> {
  const path = join(sessionsDir, id);
  const current = readMetadataRaw(sessionsDir, id);
  const generation = String(Number(current?.["generation"] ?? "0") + 1);
  const record = { ...data, generation };
  writeFileSync(
    `${path}.tmp.fit2b`,
    Object.entries(record)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
  renameSync(`${path}.tmp.fit2b`, path);
  return record;
}

function orchestrator(
  id: string,
  handle: RuntimeHandle | string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const worktree = id === FIXED ? config.projects["my-app"]!.path : join(tmpDir, "worktrees", id);
  mkdirSync(worktree, { recursive: true });
  return writeRecord(id, {
    worktree,
    branch: id === FIXED ? "main" : `orchestrator/${id}`,
    status: "working",
    role: "orchestrator",
    project: "my-app",
    agent: "stand-in",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...(handle === null
      ? {}
      : { runtimeHandle: typeof handle === "string" ? handle : JSON.stringify(handle) }),
    ...extra,
  });
}

/** Every record of the sessions directory (also the archive), without today's read repair. */
function sessionsListing(): Record<string, string> {
  const listing: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else
        listing[`${prefix}${entry.name}`] = readFileSync(path, "utf-8")
          .split("\n")
          .filter((line) => !line.startsWith("generation=") && !line.startsWith("prAutoDetect="))
          .join("\n");
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

function herdrCommands(): string[] {
  return herdr.calls.map((call) => `${call.args[0]} ${call.args[1]}`);
}

async function start(): Promise<"exit 0" | "exit 1"> {
  const program = new Command();
  program.exitOverride();
  registerStart(program);
  try {
    await program.parseAsync(["node", "test", "start"]);
    return "exit 0";
  } catch (err) {
    if (err instanceof Error && err.message === "process.exit(1)") return "exit 1";
    throw err;
  }
}

/** Exit 1 with message M: the first line and the block of `id`, with no prefix. */
function expectM(id: string, state: string): void {
  expect(errors()).toContain(
    "No new orchestrator was started for project my-app: AO cannot tell that every earlier herdr orchestrator launch of the project ended.",
  );
  expect(errors()).toContain(`${id}: ${state}`);
  expect(errors()).not.toContain("Failed to setup orchestrator:");
  expect(oraLog).toContainEqual(["fail", "No new orchestrator was started"]);
  expect(oraLog.some(([, text]) => text?.startsWith("Using existing orchestrator"))).toBe(false);
}

/** A blocked start with nothing written and no create. */
async function expectBlocked(id: string, state: string): Promise<void> {
  const before = sessionsListing();
  expect(await start()).toBe("exit 1");
  expectM(id, state);
  expect(sessionsListing()).toEqual(before);
  expect(workspaceCalls).toEqual([]);
  expect(herdrCommands().filter((c) => c === "workspace create" || c === "pane run")).toEqual([]);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ao-start-herdr-guard-"));
  herdr.reset();
  herdr.callerSocket = SOCKET;
  herdr.status = statusAt(SOCKET);
  tmux.calls = [];
  oraLog.length = 0;
  smHooks.marks = [];
  smHooks.beforeReuse = null;
  smHooks.spawnOrchestratorCalls = 0;
  mockEnsureLifecycleWorker.mockResolvedValue({
    running: true,
    started: false,
    pid: 12345,
    pidFile: "/tmp/lifecycle-worker.pid",
    logFile: "/tmp/lifecycle-worker.log",
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const script of herdr.scripts) rmSync(script, { force: true });
  if (config) {
    rmSync(getProjectBaseDir(config.configPath, config.projects["my-app"]!.path), {
      recursive: true,
      force: true,
    });
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("T-7.3 (CLI): list() shows the record killed and exited; the start is blocked", () => {
  for (const mode of ["project", "isolated"] as const) {
    it(`${mode} mode: exit 1 with message M; nothing written`, async () => {
      await setup({ mode });
      const id = mode === "project" ? FIXED : `${FIXED}-1`;
      orchestrator(id, pinned("w3:p2", "term_a"));
      await expectBlocked(
        id,
        mode === "project"
          ? "status working. Herdr pane w3:p2"
          : "status working, an isolated record. Herdr pane w3:p2",
      );
      expect(errors()).toContain(
        "herdr answered that the pane does not exist or that it has another terminal.",
      );
    });
  }
});

describe("T-7.3d (CLI): an exited agent in a live pane", () => {
  it("project mode: reused by core, no create", async () => {
    await setup();
    agentRuns.value = false;
    paneRuns("w3:p2", "term_a");
    orchestrator(FIXED, pinned("w3:p2", "term_a"));
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", "Orchestrator session reused"]);
    expect(workspaceCalls).toEqual([]);
    expect(herdrCommands()).not.toContain("workspace create");
  });

  it("isolated mode: exit 1 with message M (not-reused, an isolated record)", async () => {
    await setup({ mode: "isolated" });
    agentRuns.value = false;
    paneRuns("w3:p2", "term_a");
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    await expectBlocked(`${FIXED}-1`, "status working, an isolated record.");
  });
});

describe("T-7.4b: a persisted killed Herdr record, which is no CLI candidate", () => {
  it("exit 1 with message M; nothing written; zero workspace create", async () => {
    await setup({ mode: "isolated" });
    herdr.dead.add(OLD_SOCKET);
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a", OLD_SOCKET), {
      status: "killed",
      killedReason: "runtime",
    });
    await expectBlocked(`${FIXED}-1`, "status killed, its status is killed.");
    expect(errors()).toContain(": no herdr server answers at the socket.");
  });
});

describe("T-7.5 (CLI): a kept failed launch with a live pane, and P with a dead claim", () => {
  for (const mode of ["project", "isolated"] as const) {
    const id = mode === "project" ? FIXED : `${FIXED}-1`;
    it(`${mode} mode: launchFailed with a live pane is not reused`, async () => {
      await setup({ mode });
      paneRuns("w3:p2", "term_a");
      orchestrator(id, pinned("w3:p2", "term_a"), {
        status: "spawning",
        launchFailed: "Failed to launch agent in herdr pane w3:p2",
      });
      await expectBlocked(id, "status spawning, launch failed, its launch failed.");
    });

    it(`${mode} mode: P with a dead claim is create-incomplete`, async () => {
      await setup({ mode });
      orchestrator(id, PENDING, { status: "spawning", ...OTHER_CLAIM });
      await expectBlocked(id, "status spawning, create create-pending.");
      expect(errors()).toContain("AO did not record the endpoint of this launch");
    });
  }
});

describe("T-7.6: a non-terminal Herdr candidate whose pin has no server", () => {
  it("core's reuse decision returns none; core blocks; exit 1 with message M", async () => {
    await setup();
    herdr.dead.add(OLD_SOCKET);
    orchestrator(FIXED, pinned("w3:p2", "term_a", OLD_SOCKET));
    await expectBlocked(FIXED, "status working. Herdr pane w3:p2");
    expect(errors()).toContain(": no herdr server answers at the socket.");
    // The CLI's own probe made none: the pane calls are the list's, the
    // reuse decision's and core's.
    expect(smHooks.spawnOrchestratorCalls).toBe(1);
  });
});

describe("T-7.7 and T-7.7b (CLI): a live Herdr orchestrator", () => {
  it("T-7.7: project mode, strategy reuse: Using existing orchestrator session, no new runtime", async () => {
    await setup();
    paneRuns("w3:p2", "term_a");
    orchestrator(FIXED, pinned("w3:p2", "term_a"));
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}`]);
    expect(smHooks.spawnOrchestratorCalls).toBe(0);
    expect(workspaceCalls).toEqual([]);
  });

  it("T-7.7: a live isolated record through the CLI: Using existing orchestrator session", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}-1`]);
    expect(workspaceCalls).toEqual([]);
  });

  it("T-7.7b: a live record with status killed in isolated mode: blocked, not-reused", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"), { status: "killed" });
    await expectBlocked(`${FIXED}-1`, "status killed, its status is killed.");
  });
});

describe("T-7.8 (CLI): the project now selects tmux", () => {
  it("blocked (the project now selects tmux); zero tmux calls with the Herdr handle; the record unchanged", async () => {
    await setup({ selects: "tmux" });
    paneRuns("w3:p2", "term_a");
    orchestrator(FIXED, pinned("w3:p2", "term_a"));
    await expectBlocked(FIXED, "status working, the project now selects tmux.");
    expect(tmux.calls.filter((call) => call.handle?.runtimeName === "herdr")).toEqual([]);
  });
});

describe("T-7.9b: CLI routing of a handle without runtimeName on a Herdr project", () => {
  it("only sm.list probes it; after the last list no call; core blocks it, damaged", async () => {
    const calls: Array<{ method: string; handle?: RuntimeHandle }> = [];
    await setup({ recordingHerdr: calls });
    const handle = { id: "w3:p2", data: {} };
    orchestrator(FIXED, JSON.stringify(handle));
    const log: string[] = [];
    // The marks of sm.list and the stand-in's calls in one order.
    const record = calls.push.bind(calls);
    calls.push = (...items) => {
      for (const item of items) log.push(`${item.method} ${item.handle?.id ?? ""}`);
      return record(...items);
    };
    const marks = smHooks.marks;
    smHooks.marks = new Proxy(marks, {
      get(target, key, receiver) {
        if (key === "push") {
          return (...items: string[]) => {
            log.push(...items);
            return target.push(...items);
          };
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const before = sessionsListing();

    expect(await start()).toBe("exit 1");

    const lastList = log.lastIndexOf("list:end");
    expect(lastList).toBeGreaterThan(-1);
    // Inside each sm.list: exactly one isAlive with that handle.
    let inside = 0;
    for (let i = 0, open = false; i < log.length; i++) {
      if (log[i] === "list:start") open = true;
      else if (log[i] === "list:end") open = false;
      else if (open && log[i] === "isAlive w3:p2") inside += 1;
    }
    expect(inside).toBe(log.filter((entry) => entry === "list:start").length);
    // After the last sm.list returns: zero runtime calls with that handle.
    expect(log.slice(lastList + 1).filter((entry) => entry.endsWith(" w3:p2"))).toEqual([]);
    expect(readMetadataRaw(sessionsDir, FIXED)?.["status"]).toBe("working");
    expectM(FIXED, "status working.");
    expect(errors()).toContain("Its runtime handle cannot be read (");
    expect(sessionsListing()).toEqual(before);
  });
});

describe("T-7.11 and T-7.11b: the selected endpoint cannot take a launch", () => {
  for (const [label, status, text] of [
    [
      "T-7.11: no server at the selected endpoint",
      () => JSON.stringify({ ...JSON.parse(statusAt(SOCKET)), running: false }),
      `no herdr server runs at ${SOCKET}; start one: herdr server`,
    ],
    [
      "T-7.11b: the selected endpoint answers compatible false",
      () => JSON.stringify({ ...JSON.parse(statusAt(SOCKET)), compatible: false }),
      `the herdr server at ${SOCKET} is not compatible with this herdr client`,
    ],
  ] as const) {
    it(`${label}: preflight rejects; exit 1 before spawnOrchestrator; nothing written`, async () => {
      await setup();
      herdr.status = status();
      const before = sessionsListing();
      expect(await start()).toBe("exit 1");
      expect(errors()).toContain(text);
      expect(smHooks.spawnOrchestratorCalls).toBe(0);
      expect(sessionsListing()).toEqual(before);
      expect(workspaceCalls).toEqual([]);
      expect(herdrCommands()).toEqual(["status server"]);
    });
  }
});

/** A gate that a stand-in awaits until the test opens it. */
function gate(): {
  wait: Promise<void>;
  open: () => void;
  reached: Promise<void>;
  reach: () => void;
} {
  let open = (): void => undefined;
  let reach = (): void => undefined;
  const wait = new Promise<void>((resolve) => (open = resolve));
  const reached = new Promise<void>((resolve) => (reach = resolve));
  return { wait, open, reached, reach };
}

describe("T-7.20 (CLI): ao start while a direct core start is paused in pane run", () => {
  it("B exit 1 (in-progress, this process); no workspace create by B; then C reuses A's record", async () => {
    await setup({ mode: "isolated" });
    const paused = gate();
    herdr.on["pane run"] = async (args, answer) => {
      paused.reach();
      await paused.wait;
      herdr.on["pane run"] = undefined;
      return answer();
    };
    const a = sm().spawnOrchestrator({ projectId: "my-app" });
    await paused.reached;
    expect(await start()).toBe("exit 1");
    expectM(`${FIXED}-1`, `launch in progress by ao process ${process.pid}.`);
    expect(workspaceCalls).toEqual([`create ${FIXED}-1`]);
    paused.open();
    await a;
    oraLog.length = 0;
    vi.mocked(console.error).mockClear();
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}-1`]);
    expect(workspaceCalls).toEqual([`create ${FIXED}-1`]);
  });
});

describe("T-7.22 (CLI): a workspace-mode change", () => {
  it("a live isolated record while the project is now in project mode: the CLI reuses it", async () => {
    await setup({ mode: "project" });
    paneRuns("w3:p2", "term_a");
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}-1`]);
    expect(workspaceCalls).toEqual([]);
  });

  it("a live fixed-ID record while the project is now isolated: the CLI reuses it", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(FIXED, pinned("w3:p2", "term_a"));
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}`]);
    expect(workspaceCalls).toEqual([]);
  });
});

describe("T-7.27: ao start after another start published its handle", () => {
  it("B: no reuse while A's claim is live; exit 1 with in-progress; C reuses after A completes", async () => {
    await setup({ mode: "isolated" });
    const paused = gate();
    onPostLaunch.run = async () => {
      paused.reach();
      await paused.wait;
    };
    const a = sm().spawnOrchestrator({ projectId: "my-app" });
    await paused.reached;
    onPostLaunch.run = undefined;
    // A's record has its handle (published) and A's live claim.
    const record = readMetadataRaw(sessionsDir, `${FIXED}-1`);
    expect(JSON.parse(record?.["runtimeHandle"] ?? "{}")).toMatchObject({ id: "w7:p1" });
    expect(record?.["launchPid"]).toBe(String(process.pid));
    expect(await start()).toBe("exit 1");
    expectM(`${FIXED}-1`, `launch in progress by ao process ${process.pid}.`);
    expect(workspaceCalls).toEqual([`create ${FIXED}-1`]);
    paused.open();
    await a;
    oraLog.length = 0;
    vi.mocked(console.error).mockClear();
    expect(await start()).toBe("exit 0");
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}-1`]);
    expect(workspaceCalls).toEqual([`create ${FIXED}-1`]);
  });
});

/** The launch claim of this process in the record's form. */
function ownClaim(): Record<string, string> {
  const stat = readFileSync("/proc/self/stat", "utf-8");
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  return { launchPid: String(process.pid), launchPidStart: `stat:${start}` };
}

describe("T-7.28: the record changes during the CLI's reuse decision", () => {
  /** During the first pane get of the reuse decision, `change` runs once. */
  function onReuseProbe(change: () => void): void {
    smHooks.beforeReuse = () => {
      let done = false;
      herdr.on["pane get"] = async (_args, answer) => {
        if (!done) {
          done = true;
          change();
        }
        return answer();
      };
    };
  }

  it("a new launch identity: probed again, and the new identity is reused when it answers alive", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    let probes = 0;
    onReuseProbe(() => {
      writeRecord(`${FIXED}-1`, { ...record, restoredAt: "2026-10-02T00:00:00.000Z" });
    });
    const countProbes = smHooks.beforeReuse;
    smHooks.beforeReuse = () => {
      countProbes?.();
      const hook = herdr.on["pane get"];
      herdr.on["pane get"] = async (args, answer) => {
        probes += 1;
        return hook ? hook(args, answer) : answer();
      };
    };
    expect(await start()).toBe("exit 0");
    expect(probes).toBe(2);
    expect(oraLog).toContainEqual(["succeed", `Using existing orchestrator session: ${FIXED}-1`]);
    expect(readMetadataRaw(sessionsDir, `${FIXED}-1`)?.["restoredAt"]).toBe(
      "2026-10-02T00:00:00.000Z",
    );
  });

  it("launchFailed written: none reusable; core blocks (not-reused); exit 1 with message M", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    onReuseProbe(() => {
      writeRecord(`${FIXED}-1`, { ...record, launchFailed: "a failure of another process" });
    });
    expect(await start()).toBe("exit 1");
    expectM(`${FIXED}-1`, "status working, launch failed, its launch failed.");
    expect(workspaceCalls).toEqual([]);
  });

  it("replaced by a new reservation with P: none reusable; core blocks (in-progress)", async () => {
    await setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(`${FIXED}-1`, pinned("w3:p2", "term_a"));
    onReuseProbe(() => {
      writeRecord(`${FIXED}-1`, {
        reservationId: "res_other",
        runtimeHandle: PENDING,
        role: "orchestrator",
        project: "my-app",
        status: "spawning",
        ...ownClaim(),
      });
    });
    expect(await start()).toBe("exit 1");
    expectM(`${FIXED}-1`, `launch in progress by ao process ${process.pid}.`);
    expect(workspaceCalls).toEqual([]);
  });
});
