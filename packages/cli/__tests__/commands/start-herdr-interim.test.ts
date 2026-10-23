/**
 * An old Herdr orchestrator at `ao start` (owner decision OQ-F1 (b),
 * 2026-10-22), through the real session manager (real `sm.list`,
 * `findReusableOrchestrators` and `spawnOrchestrator`) and the real
 * runtime-herdr plugin. Only `herdr` is a stand-in: it answers with the
 * recorded 0.9.5 answers of the live check (exit 1, one stderr line), and a
 * healthy `status server --json` for the plugin's preflight. After fit F-1 a
 * closed pane is `isAlive` false (and `sm.list` shows the record killed and
 * exited) and no server is RUNTIME_NO_SERVER_ERROR_CODE. For a Herdr record
 * neither may retire the old orchestrator or start a second one, in either
 * workspace mode. fit-1 refused in the CLI with interim texts; Herdr fit-2
 * (design r11 5.3.10, fit-2b commit 6) leaves a Herdr record to core, which
 * blocks the start with message M, or reuses a live project-mode record
 * (OQ-F13 (a)).
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

const { mockConfigRef, registryRef, mockEnsureLifecycleWorker, herdrStandIn, oraLog } = vi.hoisted(
  () => ({
    oraLog: [] as Array<[string, string | undefined]>,
    mockConfigRef: { current: null as unknown },
    registryRef: { current: null as unknown },
    mockEnsureLifecycleWorker: vi.fn(),
    herdrStandIn: {
      /** The plugin's own binary (a file that never runs). */
      bin: "",
      /**
       * The recorded answer of `pane get`, and of `pane process-info`: an Error
       * is thrown (a failure), anything else is the `{ stdout, stderr }` answer.
       */
      paneGet: null as unknown,
      processInfo: null as unknown,
      calls: [] as string[][],
    },
  }),
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  // No real herdr or tmux runs: the callback form refuses them.
  const execFile = ((cmd: string, ...rest: unknown[]) => {
    if (cmd === "herdr" || cmd === herdrStandIn.bin || cmd === "tmux") {
      throw new Error(`unexpected command: ${cmd}`);
    }
    return (actual.execFile as (...args: unknown[]) => unknown)(cmd, ...rest);
  }) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "herdr" && cmd !== herdrStandIn.bin) {
        throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
      }
      herdrStandIn.calls.push(args);
      const { herdrFixture: fixture } = await import("../herdr-fixtures.js");
      const answer =
        args[0] === "pane" && args[1] === "get"
          ? herdrStandIn.paneGet
          : args[0] === "pane" && args[1] === "process-info"
            ? herdrStandIn.processInfo
            : args[0] === "status" && args[1] === "server"
              ? { stdout: fixture("closedpane_status_server_json").stdout, stderr: "" }
              : new Error(`unexpected herdr call: ${args.join(" ")}`);
      if (answer instanceof Error) throw answer;
      return answer;
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
    // Each call is logged as [method, text], so a test can read the spinner lines.
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

let tmpDir: string;
let config: OrchestratorConfig;
let sessionsDir: string;
let workspace: Workspace;
let runtimeCreate: ReturnType<typeof vi.fn>;
let program: Command;

const HANDLE = JSON.stringify({
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a", sessionId: "app" },
});

/**
 * `creates`: the review r1 M-1 reproducer. `runtime.create` is a stand-in
 * spy (no herdr runs) and the workspace answers a new scratch directory, so a
 * second orchestrator, if the start makes one, is made and recorded.
 */
function setup(mode: "project" | "isolated", opts: { creates?: boolean } = {}): void {
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

  // The real plugin with its own binary; its terminal output is a stand-in.
  herdrStandIn.bin = join(tmpDir, "bin", "herdr");
  mkdirSync(join(tmpDir, "bin"), { recursive: true });
  writeFileSync(herdrStandIn.bin, "", { mode: 0o755 });
  runtimeCreate = vi.fn(async () => ({ id: "w4:p1", runtimeName: "herdr", data: {} }));
  const runtime: Runtime = {
    ...createHerdrRuntime({ binPath: herdrStandIn.bin }),
    getOutput: vi.fn(async () => ""),
    ...(opts.creates ? { create: runtimeCreate } : {}),
  };
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
    create: vi.fn(async (cfg: { sessionId: string; projectId: string; branch: string }) => {
      if (!opts.creates) throw new Error("unexpected workspace create");
      const path = join(tmpDir, `wt-${cfg.sessionId}`);
      mkdirSync(path, { recursive: true });
      return { path, branch: cfg.branch, sessionId: cfg.sessionId, projectId: cfg.projectId };
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
  oraLog.length = 0;
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

/** The herdr calls of the start: the pane calls name only w3:p2; the preflight asks status. */
function expectOnlyThisPane(): void {
  expect(
    herdrStandIn.calls.filter(
      (args) =>
        !(args[0] === "pane" && args.includes("w3:p2")) &&
        !(args[0] === "status" && args[1] === "server"),
    ),
  ).toEqual([]);
}

/** Exit 1 with message M (no prefix): the block of `id` with its `<state>` and answer. */
function expectMessageM(id: string, state: string, answer: string): void {
  expect(errors()).toContain(
    "No new orchestrator was started for project my-app: AO cannot tell that every earlier herdr orchestrator launch of the project ended.",
  );
  expect(errors()).toContain(`${id}: ${state}. Herdr pane w3:p2 (terminal term_a), workspace w3`);
  expect(errors()).toContain(`: ${answer}.`);
  expect(errors()).toContain(`  If it runs, use it:  ao session attach '${id}'`);
  expect(errors()).not.toContain("Failed to setup orchestrator:");
  expect(oraLog).toContainEqual(["fail", "No new orchestrator was started"]);
}

describe("ao start with an old Herdr orchestrator, through the real session manager (fit-2 G)", () => {
  const ANSWER_TEXT = [
    "herdr answered that the pane does not exist or that it has another terminal",
    "no herdr server answers at the socket",
  ];
  for (const [mode, id] of [
    ["project", "app-orchestrator"],
    ["isolated", "app-orchestrator-1"],
  ] as const) {
    for (const index of [0, 1]) {
      for (const [persisted, extra] of [
        ["working", {}],
        ["killed by the lifecycle (runtime)", { status: "killed", killedReason: "runtime" }],
      ] as const) {
        it(`${mode} mode, answer ${index + 1}, a record ${persisted}: exit 1 with message M, record kept, no new orchestrator`, async () => {
          const [label, paneGet, processInfo] = answers()[index]!;
          herdrStandIn.paneGet = herdrRejection(paneGet);
          herdrStandIn.processInfo = herdrRejection(processInfo);
          setup(mode);
          writeOrchestrator(id, extra);
          const before = sessionsListing();

          await expect(program.parseAsync(["node", "test", "start"]), label).rejects.toThrow(
            "process.exit(1)",
          );

          // Was (fit-1 interim): "Cannot tell whether orchestrator session ...".
          // A record persisted working passes R6, and in project mode the probe
          // does not prove the pane alive (unproven). In isolated mode R8 fails
          // first (an isolated record). A persisted killed fails R6 before any
          // probe (core's persisted status does not depend on `sm.list`).
          const state =
            "status" in extra
              ? "status killed, its status is killed"
              : mode === "project"
                ? "status working"
                : "status working, an isolated record";
          expectMessageM(id, state, ANSWER_TEXT[index]!);
          // `sm.list` adds `prAutoDetect=off` to an orchestrator record (as
          // before the fit); nothing else is written, archived or added (the
          // archive is sessions/archive).
          const after = sessionsListing();
          expect(Object.keys(after)).toEqual(Object.keys(before));
          const record = readMetadataRaw(sessionsDir, id);
          expect(record?.["runtimeHandle"]).toBe(HANDLE);
          expect(record?.["status"]).toBe(extra.status ?? "working");
          expect(workspace.create).not.toHaveBeenCalled();
          expectOnlyThisPane();
        });
      }
    }
  }
});

/** A recorded 0.9.5 answer of a live pane, with the IDs of the record's handle. */
function liveAnswers(): { paneGet: unknown; processInfo: unknown } {
  const paneGet = herdrFixture("ao_status_1_pane_get");
  const processInfo = herdrFixture("live_pane_process_info");
  return {
    paneGet: {
      stdout: paneGet.stdout
        .replaceAll("w1M:p1", "w3:p2")
        .replaceAll("w1M:t1", "w3:t1")
        .replaceAll('"w1M"', '"w3"')
        .replaceAll("term_65e7387f8075441", "term_a"),
      stderr: "",
    },
    // The pane's processes (bash and claude): the stand-in agent's process is
    // not among them, so `sm.list` shows a record that is not terminal with
    // activity `exited`.
    processInfo: { stdout: processInfo.stdout.replaceAll("w3:p1", "w3:p2"), stderr: "" },
  };
}

describe("ao start with a held Herdr orchestrator whose pane runs (note 2, review r1 M-1)", () => {
  for (const [mode, id] of [
    ["project", "app-orchestrator"],
    ["isolated", "app-orchestrator-1"],
  ] as const) {
    for (const [persisted, extra] of [
      [
        "killed by the lifecycle after the F1 outage bound",
        { status: "killed", killedReason: "runtime" },
      ],
      ["working, with activity exited", {}],
    ] as const) {
      // Was (note 2): exit 1 with the still-runs refusal in every case. Now
      // core decides: a persisted killed fails R6, an isolated record fails
      // R8, and a project-mode record that runs is reused (OQ-F13 (a)).
      const reusedHere = mode === "project" && !("status" in extra);
      it(`${mode} mode, a record ${persisted}, the pane answers alive: ${reusedHere ? "exit 0, reused" : "exit 1 with message M"}, nothing created`, async () => {
        const live = liveAnswers();
        herdrStandIn.paneGet = live.paneGet;
        herdrStandIn.processInfo = live.processInfo;
        setup(mode, { creates: true });
        writeOrchestrator(id, extra);
        const before = sessionsListing();
        const recordBefore = readMetadataRaw(sessionsDir, id);

        if (reusedHere) {
          await program.parseAsync(["node", "test", "start"]);
          expect(oraLog).toContainEqual(["succeed", "Orchestrator session reused"]);
          expect(errors()).toBe("");
        } else {
          await expect(program.parseAsync(["node", "test", "start"])).rejects.toThrow(
            "process.exit(1)",
          );
          const reason = "status" in extra ? "its status is killed" : "an isolated record";
          expectMessageM(
            id,
            `status ${extra.status ?? "working"}, ${reason}`,
            `the pane runs, but the record is not reusable (${reason})`,
          );
        }
        expect(runtimeCreate).not.toHaveBeenCalled();
        expect(workspace.create).not.toHaveBeenCalled();
        const after = sessionsListing();
        expect(Object.keys(after)).toEqual(Object.keys(before));
        expect(after).not.toHaveProperty("app-orchestrator-2");
        // The record keeps every value. `sm.list` adds `prAutoDetect=off` to an
        // orchestrator record (as before the fit), and that write raises
        // `generation`; nothing else changes.
        const recordAfter = readMetadataRaw(sessionsDir, id);
        const { generation: _before, ...keptBefore } = recordBefore ?? {};
        const { generation: _after, prAutoDetect: _added, ...keptAfter } = recordAfter ?? {};
        expect(keptAfter).toEqual(keptBefore);
        expect(recordAfter?.["status"]).toBe(extra.status ?? "working");
        expect(recordAfter?.["runtimeHandle"]).toBe(HANDLE);
        expectOnlyThisPane();
      });
    }
  }
});
