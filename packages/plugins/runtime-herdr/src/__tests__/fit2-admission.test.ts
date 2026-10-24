/**
 * Herdr fit-2 F-7 (design development/reviews/herdr_fit2_design_r11_opus.md
 * sections 4.7, 4.9 and 5.3; fit-2b commit 5): core admits at most one Herdr
 * orchestrator launch per project. The admission lock A, the rounds, G1 (the
 * selection), G2 (the reuse predicate R1 to R8) and message M, through the
 * built core (createSessionManager) with the real runtime-herdr plugin. Only
 * `herdr` is a stand-in: a mocked `node:child_process` answers each call by
 * the HERDR_SOCKET_PATH of that call (a pinned handle sets it), and the
 * caller's own endpoint answers a healthy, compatible `status server --json`.
 * The workspace and agent plugins are stand-ins that record their calls.
 * Review r1 (fit-2b r2): sol M-2 and argon M-2 (the reuse re-read after the
 * hooks, G1 row 4), argon M-3 (the reuse-only decision under A, its answer
 * after round 3) and argon m-2 (a read error at the reuse re-read).
 * "Nothing written" means: every file under the test root byte-equal before
 * and after, and no workspace, hooks or runtime create call.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as ChildProcess from "node:child_process";

type ExecOut = { stdout: string; stderr: string };
type HerdrHook = (
  args: string[],
  socket: string,
  answer: () => Promise<ExecOut>,
) => Promise<ExecOut>;

/** The stand-in `herdr`: its servers, its panes and every call. */
const herdr = vi.hoisted(() => {
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
    /** The socket of the caller's own endpoint (no pin). */
    callerSocket: "",
    /** The answer of `status server --json` at the caller's endpoint. */
    status: "",
    calls: [] as Array<{ args: string[]; socket: string }>,
    next: 7,
    /** The panes that run: pane ID -> its socket and terminal. */
    panes: new Map<string, { socket: string; terminal: string }>(),
    /** Sockets with no server. */
    dead: new Set<string>(),
    /** Per command ("workspace create", "pane get", ...): replaces the answer. */
    on: {} as Record<string, HerdrHook | undefined>,
    /** The launch scripts of the admitted runs. */
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
  return state;
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
        const socket =
          options?.env?.["HERDR_SOCKET_PATH"] ??
          process.env["HERDR_SOCKET_PATH"] ??
          herdr.callerSocket;
        herdr.calls.push({ args, socket });
        const hook = herdr.on[`${args[0]} ${args[1]}`];
        return hook
          ? hook(args, socket, () => herdr.answer(args, socket))
          : herdr.answer(args, socket);
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

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WorkspaceMissingError,
  createSessionManager,
  deleteMetadata,
  getSessionsDir,
  isOrchestratorStartBlockedError,
  launchIdentityToken,
  readMetadataRaw,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type RuntimeHandle,
  type Session,
  type SessionManagerDeps,
  type Workspace,
  type WorkspaceInfo,
} from "@aoagents/ao-core";
import { create } from "../index.js";
import { statusRunningAt } from "./herdr-fixtures.js";

const SOCKET = "/tmp/aofit2b-herdr/caller.sock";
/** The socket of an old launch whose server is gone. */
const OLD_SOCKET = "/tmp/aofit2b-herdr/old.sock";
/** A launch claim of another process (not running), in the record's form. */
const OTHER_CLAIM = { launchPid: "2147483000", launchPidStart: "stat:12345" };
const PENDING = JSON.stringify({
  id: "",
  runtimeName: "herdr",
  data: { createIncomplete: "create-pending" },
});
const FIXED = "app-orchestrator";

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-fit2b-admission-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  herdr.reset();
  herdr.callerSocket = SOCKET;
  herdr.status = statusRunningAt(SOCKET).stdout;
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  herdr.bin = join(binDir, "herdr");
  writeFileSync(herdr.bin, "");
  chmodSync(herdr.bin, 0o755);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const script of herdr.scripts) rmSync(script, { force: true });
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

type Mode = "project" | "isolated";

interface Harness {
  sessionsDir: string;
  projectPath: string;
  /** A session manager of this project (a caller of its own). */
  sm(admission?: SessionManagerDeps["admission"]): ReturnType<typeof createSessionManager>;
  /** "create <id>", "restore <id>", "destroy <path>". */
  workspaceCalls: string[];
  hookCalls: string[];
  /** Runs inside the workspace plugin's `create` and `restore`, before they answer. */
  onWorkspace: { create?: () => Promise<void>; restore?: () => Promise<void> };
  /** isProcessRunning of the agent stand-in. */
  agentRuns: { value: boolean };
  /** Runs inside the agent's postLaunchSetup. */
  onPostLaunch: { run?: () => Promise<void> };
  /** Runs inside the agent's setupWorkspaceHooks, after the call is recorded. */
  onHooks: { run?: () => Promise<void> };
}

function setup(options: { mode?: Mode; strategy?: "reuse" | "delete" } = {}): Harness {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "herdr", agent: "stand-in", workspace: "stand-in", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "stand-in",
        runtime: "herdr",
        workspace: "stand-in",
        orchestratorWorkspaceMode: options.mode ?? "project",
        orchestratorSessionStrategy: options.strategy ?? "reuse",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });

  const runtime = create({ binPath: herdr.bin });
  const workspaceCalls: string[] = [];
  const hookCalls: string[] = [];
  const onWorkspace: Harness["onWorkspace"] = {};
  const agentRuns = { value: true };
  const onPostLaunch: Harness["onPostLaunch"] = {};
  const onHooks: Harness["onHooks"] = {};
  const info = (cfg: { sessionId: string; projectId: string; branch: string }, path: string) =>
    ({
      path,
      branch: cfg.branch,
      sessionId: cfg.sessionId,
      projectId: cfg.projectId,
    }) as WorkspaceInfo;
  const workspace = {
    name: "stand-in",
    create: async (cfg: { sessionId: string; projectId: string; branch: string }) => {
      workspaceCalls.push(`create ${cfg.sessionId}`);
      await onWorkspace.create?.();
      const path = join(root, "worktrees", cfg.sessionId);
      mkdirSync(path, { recursive: true });
      return info(cfg, path);
    },
    destroy: async (path: string) => {
      workspaceCalls.push(`destroy ${path}`);
    },
    exists: async (path: string) => existsSync(path),
    restore: async (
      cfg: { sessionId: string; projectId: string; branch: string },
      path: string,
    ) => {
      workspaceCalls.push(`restore ${cfg.sessionId}`);
      await onWorkspace.restore?.();
      mkdirSync(path, { recursive: true });
      return info(cfg, path);
    },
    list: async () => [],
  } as unknown as Workspace;
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "stand-in --run",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    // No agent process in a live pane reads as exited (as pane process-info).
    getActivityState: async () =>
      agentRuns.value ? null : { state: "exited", timestamp: new Date() },
    isProcessRunning: async () => agentRuns.value,
    getSessionInfo: async () => null,
    setupWorkspaceHooks: async (path: string) => {
      hookCalls.push(path);
      await onHooks.run?.();
    },
    postLaunchSetup: async () => {
      await onPostLaunch.run?.();
    },
  } as unknown as Agent;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string, name: string) => {
      if (slot === "runtime") return name === "herdr" ? runtime : null;
      if (slot === "agent") return agent;
      if (slot === "workspace") return workspace;
      return null;
    }),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;
  return {
    sessionsDir,
    projectPath,
    sm: (admission) =>
      createSessionManager({ config, registry, ...(admission ? { admission } : {}) }),
    workspaceCalls,
    hookCalls,
    onWorkspace,
    agentRuns,
    onPostLaunch,
    onHooks,
  };
}

/** A pinned Herdr handle of a launch in pane `pane` at `socket`. */
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

/** A legacy Herdr handle (before the pins). */
function legacy(pane: string, terminal: string): RuntimeHandle {
  return {
    id: pane,
    runtimeName: "herdr",
    data: { workspaceId: pane.split(":")[0], paneId: pane, terminalId: terminal },
  };
}

/** A pane that runs at `socket` with `terminal`. */
function paneRuns(pane: string, terminal: string, socket = SOCKET): void {
  herdr.panes.set(pane, { socket, terminal });
}

/**
 * Write a whole record as another process would: the next generation, a temp
 * file, a rename onto the record name. Answers the record as written.
 */
function writeRecord(h: Harness, id: string, data: Record<string, string>): Record<string, string> {
  const path = join(h.sessionsDir, id);
  const current = readMetadataRaw(h.sessionsDir, id);
  const generation = String(Number(current?.["generation"] ?? "0") + 1);
  const record = { ...data, generation };
  const text =
    Object.entries(record)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n";
  writeFileSync(`${path}.tmp.fit2b`, text);
  renameSync(`${path}.tmp.fit2b`, path);
  return record;
}

/** An orchestrator record of `id` with a handle (text or object). */
function orchestrator(
  h: Harness,
  id: string,
  handle: RuntimeHandle | string | null,
  extra: Record<string, string> = {},
): Record<string, string> {
  const worktree = id === FIXED ? h.projectPath : join(root, "worktrees", id);
  mkdirSync(worktree, { recursive: true });
  return writeRecord(h, id, {
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

/** Every file and directory under the test root, with its content. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const key = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) out[key] = `-> ${readlinkSync(path)}`;
      else if (entry.isDirectory()) {
        out[`${key}/`] = "";
        walk(path, key);
      } else out[key] = readFileSync(path, "utf-8");
    }
  };
  walk(root, "");
  return out;
}

/** A snapshot without the keys of today's read repair of an orchestrator record. */
function withoutReadRepair(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([key, text]) => [
      key,
      text
        .split("\n")
        .filter((line) => !line.startsWith("generation=") && !line.startsWith("prAutoDetect="))
        .join("\n"),
    ]),
  );
}

/** The herdr commands made, as "<word> <word>". */
function commands(): string[] {
  return herdr.calls.map((call) => `${call.args[0]} ${call.args[1]}`);
}

/** The herdr commands of a create (none for a blocked start). */
function createCommands(): string[] {
  return commands().filter((c) => c !== "pane get");
}

async function startError(sm: ReturnType<Harness["sm"]>): Promise<unknown> {
  return sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
}

/** A blocked start as [ID, kind, reason]. */
function rows(err: unknown): Array<[string, string, string]> {
  expect(isOrchestratorStartBlockedError(err)).toBe(true);
  if (!isOrchestratorStartBlockedError(err)) return [];
  expect(err.reason).toBe("records");
  return err.blocking.map((b) => [b.sessionId, b.kind, b.reason]);
}

function answers(err: unknown): Array<string | undefined> {
  return isOrchestratorStartBlockedError(err) ? err.blocking.map((b) => b.answer) : [];
}

/** A start that the records block, with nothing written. */
async function expectBlocked(
  h: Harness,
  expected: Array<[string, string, string]>,
): Promise<Error> {
  const before = snapshot();
  const err = await startError(h.sm());
  expect(rows(err)).toEqual(expected);
  expect(snapshot()).toEqual(before);
  expect(h.workspaceCalls).toEqual([]);
  expect(h.hookCalls).toEqual([]);
  expect(createCommands()).toEqual([]);
  return err as Error;
}

/** The launch claim of this process in the record's form (a live launcher). */
function thisProcessClaim(): Record<string, string> {
  const stat = readFileSync("/proc/self/stat", "utf-8");
  const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  return { launchPid: String(process.pid), launchPidStart: `stat:${start}` };
}

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

describe("T-7.1: a persisted killed record whose pin has no server", () => {
  for (const mode of ["project", "isolated"] as const) {
    it(`${mode} mode: blocked, not-reused (status killed); nothing written`, async () => {
      const h = setup({ mode });
      herdr.dead.add(OLD_SOCKET);
      const id = mode === "project" ? FIXED : `${FIXED}-1`;
      const record = orchestrator(h, id, pinned("w3:p2", "term_a", OLD_SOCKET), {
        status: "killed",
        killedReason: "runtime",
      });
      const err = await expectBlocked(h, [[id, "not-reused", "its status is killed"]]);
      expect(answers(err)).toEqual(["no herdr server answers at the socket"]);
      const worktree = mode === "project" ? h.projectPath : join(root, "worktrees", id);
      expect(err.message).toBe(
        [
          "No new orchestrator was started for project my-app: AO cannot tell that every earlier herdr orchestrator launch of the project ended.",
          `${id}: status killed, its status is killed. Herdr pane w3:p2 (terminal term_a), workspace w3, worktree ${worktree}, socket ${OLD_SOCKET}: no herdr server answers at the socket.`,
          `  Check:  HERDR_SOCKET_PATH='${OLD_SOCKET}' '${herdr.bin}' pane get 'w3:p2'`,
          `  If it runs, use it:  ao session attach '${id}'`,
          `  If it does not run, or after you close it:  ao session kill '${id}' --confirm-runtime-closed '${launchIdentityToken(record)}'`,
          "Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.",
        ].join("\n"),
      );
      // R6 decides before any probe; the one call fills message M.
      expect(herdr.calls).toEqual([{ args: ["pane", "get", "w3:p2"], socket: OLD_SOCKET }]);
    });
  }
});

describe("T-7.2: a working record whose pane is gone or has another terminal", () => {
  for (const [label, prepare] of [
    ["pane_not_found", () => undefined],
    ["another terminal", () => paneRuns("w3:p2", "term_other")],
  ] as const) {
    it(`${label}: blocked, unproven; nothing written`, async () => {
      const h = setup();
      prepare();
      orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
      const err = await expectBlocked(h, [
        [
          FIXED,
          "unproven",
          "herdr answered that the pane does not exist or that it has another terminal",
        ],
      ]);
      // One probe outside A; message M reuses its answer.
      expect(commands()).toEqual(["pane get"]);
      expect(err.message).toContain(`${FIXED}: status working. Herdr pane w3:p2`);
    });
  }
});

describe("T-7.3: list() shows the record killed and exited; the start is still blocked", () => {
  for (const mode of ["project", "isolated"] as const) {
    it(`${mode} mode, direct core: blocked; nothing written`, async () => {
      const h = setup({ mode });
      const id = mode === "project" ? FIXED : `${FIXED}-1`;
      orchestrator(h, id, pinned("w3:p2", "term_a"));
      const listed = (await h.sm().list("my-app")).find((s: Session) => s.id === id);
      expect(listed?.status).toBe("killed");
      expect(listed?.activity).toBe("exited");
      herdr.calls = [];
      // Project mode: R1 to R8 pass and the probe does not prove the pane
      // alive (unproven). Isolated mode: R8 fails first (design 4.7), with
      // the same answer in message M.
      const err = await expectBlocked(h, [
        mode === "project"
          ? [
              id,
              "unproven",
              "herdr answered that the pane does not exist or that it has another terminal",
            ]
          : [id, "not-reused", "an isolated record"],
      ]);
      expect(answers(err)).toEqual([
        "herdr answered that the pane does not exist or that it has another terminal",
      ]);
      expect(commands()).toEqual(["pane get"]);
    });
  }
});

describe("T-7.3d: an exited agent in a live pane", () => {
  it("project mode, strategy reuse: reused (G reads no activity), no create", async () => {
    const h = setup();
    h.agentRuns.value = false;
    paneRuns("w3:p2", "term_a");
    orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    const listed = await h.sm().list("my-app");
    expect(listed[0]?.activity).toBe("exited");
    const session = await h.sm().spawnOrchestrator({ projectId: "my-app" });
    expect(session.id).toBe(FIXED);
    expect(session.metadata["orchestratorSessionReused"]).toBe("true");
    expect(h.workspaceCalls).toEqual([]);
    expect(createCommands()).toEqual([]);
  });

  it("isolated mode: blocked, not-reused (an isolated record); nothing written", async () => {
    const h = setup({ mode: "isolated" });
    h.agentRuns.value = false;
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    const err = await expectBlocked(h, [[`${FIXED}-1`, "not-reused", "an isolated record"]]);
    expect(answers(err)).toEqual([
      "the pane runs, but the record is not reusable (an isolated record)",
    ]);
  });
});

describe("T-7.3b and T-7.3c: the legacy exit-0 answers of herdr 0.8.0", () => {
  const forms: Array<[string, ExecOut]> = [
    [
      "the exit-0 pane_not_found envelope",
      {
        stdout: JSON.stringify({
          id: "cli:pane:get",
          error: { code: "pane_not_found", message: "pane w3:p2 not found" },
        }),
        stderr: "",
      },
    ],
    [
      "a pane_info with another terminal",
      {
        stdout: JSON.stringify({
          id: "cli:pane:get",
          result: { pane: { pane_id: "w3:p2", terminal_id: "term_other" } },
        }),
        stderr: "",
      },
    ],
  ];
  for (const [label, answer] of forms) {
    it(`T-7.3b, project mode, strategy delete, ${label}: blocked; nothing written`, async () => {
      const h = setup({ strategy: "delete" });
      herdr.on["pane get"] = async () => answer;
      orchestrator(h, FIXED, legacy("w3:p2", "term_a"));
      await expectBlocked(h, [
        [
          FIXED,
          "not-reused",
          "the strategy delete would stop it, and a Herdr stop cannot confirm before RH",
        ],
      ]);
      expect(readdirSync(h.sessionsDir)).toEqual([FIXED]);
    });

    it(`T-7.3c, isolated mode, ${label}: blocked; no second ID is reserved`, async () => {
      const h = setup({ mode: "isolated" });
      herdr.on["pane get"] = async () => answer;
      orchestrator(h, `${FIXED}-1`, legacy("w3:p2", "term_a"));
      await expectBlocked(h, [[`${FIXED}-1`, "not-reused", "an isolated record"]]);
      expect(readdirSync(h.sessionsDir)).toEqual([`${FIXED}-1`]);
    });
  }
});

describe("T-7.5: a kept failed launch with a live pane, and P with a dead claim", () => {
  for (const mode of ["project", "isolated"] as const) {
    const id = mode === "project" ? FIXED : `${FIXED}-1`;
    it(`${mode} mode: launchFailed with a live pane is not reused`, async () => {
      const h = setup({ mode });
      paneRuns("w3:p2", "term_a");
      orchestrator(h, id, pinned("w3:p2", "term_a"), {
        status: "spawning",
        launchFailed: "Failed to launch agent in herdr pane w3:p2",
      });
      const err = await expectBlocked(h, [[id, "not-reused", "its launch failed"]]);
      expect(err.message).toContain(`${id}: status spawning, launch failed, its launch failed.`);
    });

    it(`${mode} mode: P with a dead claim is create-incomplete`, async () => {
      const h = setup({ mode });
      orchestrator(h, id, PENDING, { status: "spawning", ...OTHER_CLAIM });
      const err = await expectBlocked(h, [[id, "create-incomplete", "create create-pending"]]);
      expect(answers(err)).toEqual(["AO has no pane ID for this launch"]);
      expect(err.message).toContain(
        "  AO did not record the endpoint of this launch: it is the endpoint of the ao process that started it",
      );
      expect(err.message).toContain(`  Check:  'herdr' workspace list (look for the label`);
      expect(err.message).not.toContain("If it runs, use it");
      // No pane ID, so no probe at all.
      expect(herdr.calls).toEqual([]);
    });
  }
});

describe("T-7.7 and T-7.7b: a live Herdr orchestrator", () => {
  it("T-7.7: project mode, strategy reuse: reused, no new runtime", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    const session = await h.sm().spawnOrchestrator({ projectId: "my-app" });
    expect(session.id).toBe(FIXED);
    expect(session.metadata["orchestratorSessionReused"]).toBe("true");
    expect(session.runtimeHandle).toEqual(pinned("w3:p2", "term_a"));
    expect(commands()).toEqual(["pane get"]);
    expect(h.workspaceCalls).toEqual([]);
    // The admitted step ran the project-mode hooks, as today.
    expect(h.hookCalls).toEqual([h.projectPath]);
    expect(launchIdentityToken(readMetadataRaw(h.sessionsDir, FIXED)!)).toBe(
      launchIdentityToken(record),
    );
  });

  it("T-7.7b: a live isolated record in a direct core call: blocked, not-reused", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    await expectBlocked(h, [[`${FIXED}-1`, "not-reused", "an isolated record"]]);
  });
});

describe("T-7.9: damaged records", () => {
  for (const [label, handle, kind, reason] of [
    [
      "a handle text that does not parse but names herdr",
      '{"id":"w3:p2","runtimeName":"herdr","data":{"workspaceId":"w3"',
      "damaged",
      "its runtime handle cannot be read",
    ],
    [
      "a handle without runtimeName in a Herdr project",
      JSON.stringify({ id: "w3:p2", data: {} }),
      "damaged",
      "its runtime handle cannot be read",
    ],
    [
      "malformed pins",
      JSON.stringify({
        ...legacy("w3:p2", "term_a"),
        data: { herdrBin: "herdr", herdrSocket: SOCKET },
      }),
      "unproven",
      "its herdr pins are malformed",
    ],
  ] as const) {
    it(`${label}: blocked, ${kind}; zero herdr calls`, async () => {
      const h = setup();
      orchestrator(h, FIXED, handle);
      const err = await expectBlocked(h, [[FIXED, kind, reason]]);
      expect(herdr.calls).toEqual([]);
      if (kind === "damaged") {
        expect(err.message).toContain(
          `Its runtime handle cannot be read (${handle.slice(0, 80)}). Retire it by hand: docs/DEVELOPMENT.md, "Retire a Herdr record by hand".`,
        );
        expect(err.message).not.toContain("--confirm-runtime-closed");
      } else {
        expect(answers(err)).toEqual(["its herdr pins are malformed"]);
      }
    });
  }
});

describe("T-7.20 and T-7.20b: a start while another start of the project is paused", () => {
  for (const [label, pauseIn] of [
    ["T-7.20: A pauses inside pane run", "pane run"],
    ["T-7.20b: A pauses inside the workspace plugin's create", "workspace"],
  ] as const) {
    it(`${label}: B blocked in-progress with this PID, no workspace create by B`, async () => {
      const h = setup({ mode: "isolated" });
      const paused = gate();
      if (pauseIn === "pane run") {
        herdr.on["pane run"] = async (_args, _socket, answer) => {
          paused.reach();
          await paused.wait;
          return answer();
        };
      } else {
        h.onWorkspace.create = async () => {
          paused.reach();
          await paused.wait;
        };
      }
      const a = h.sm().spawnOrchestrator({ projectId: "my-app" });
      await paused.reached;
      const creates = h.workspaceCalls.length;
      const errB = await startError(h.sm());
      expect(rows(errB)).toEqual([
        [`${FIXED}-1`, "in-progress", `launch in progress by ao process ${process.pid}`],
      ]);
      expect(errB).toHaveProperty(
        "message",
        expect.stringContaining(
          `  Wait for ao process ${process.pid}; if it hangs, stop that process, then run ao start again.`,
        ),
      );
      expect(h.workspaceCalls).toHaveLength(creates);
      paused.open();
      const session = await a;
      expect(session.id).toBe(`${FIXED}-1`);
      expect(h.workspaceCalls).toEqual([`create ${FIXED}-1`]);
      // A third start: the isolated record of A is not reused by core (R8).
      const errC = await startError(h.sm());
      expect(rows(errC)).toEqual([[`${FIXED}-1`, "not-reused", "an isolated record"]]);
      expect(h.workspaceCalls).toEqual([`create ${FIXED}-1`]);
    });
  }
});

describe("T-7.21: two simultaneous isolated starts in one process", () => {
  it("exactly one reaches workspace create; the other is blocked in-progress (or busy)", async () => {
    const h = setup({ mode: "isolated" });
    // The launch that gets through waits in pane run until the other start
    // has its answer, so its claim is live while the other decides.
    const otherAnswered = gate();
    herdr.on["pane run"] = async (_args, _socket, answer) => {
      await otherAnswered.wait;
      return answer();
    };
    const start = () =>
      h
        .sm()
        .spawnOrchestrator({ projectId: "my-app" })
        .catch((err: unknown) => {
          otherAnswered.open();
          throw err;
        });
    const results = await Promise.allSettled([start(), start()]);
    expect(h.workspaceCalls).toEqual([`create ${FIXED}-1`]);
    expect(commands().filter((c) => c === "workspace create")).toHaveLength(1);
    const started = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const reason = (refused[0] as PromiseRejectedResult).reason as unknown;
    expect(isOrchestratorStartBlockedError(reason)).toBe(true);
    if (!isOrchestratorStartBlockedError(reason)) return;
    if (reason.reason === "records") {
      expect(reason.blocking.map((b) => [b.sessionId, b.kind])).toEqual([
        [`${FIXED}-1`, "in-progress"],
      ]);
    } else {
      expect(reason.reason).toBe("admission-busy");
    }
    expect(readdirSync(h.sessionsDir)).toEqual([`${FIXED}-1`]);
  });
});

describe("T-7.22: a workspace-mode change, direct core", () => {
  it("a live isolated record while the project is now in project mode: blocked", async () => {
    const h = setup({ mode: "project" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    await expectBlocked(h, [[`${FIXED}-1`, "not-reused", "an isolated record"]]);
  });

  it("a live fixed-ID record while the project is now isolated: blocked", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    await expectBlocked(h, [[FIXED, "not-reused", "the workspace mode is now isolated"]]);
  });
});

describe("T-7.23: the revalidation of a probed record", () => {
  it("each probe changes the launch identity: never reused; records-changed after round 3", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    let n = 0;
    let last: Record<string, string> = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    herdr.on["pane get"] = async (_args, _socket, answer) => {
      n += 1;
      // A restore of the record by another process: a new restoredAt.
      last = writeRecord(h, FIXED, { ...last, restoredAt: `2026-10-0${n}T00:00:00.000Z` });
      return answer();
    };
    const workspaces = h.workspaceCalls.length;
    const err = await startError(h.sm());
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
    expect(err).toMatchObject({ reason: "records-changed" });
    expect((err as Error).message).toBe(
      "The orchestrator records of project my-app changed during the check; run ao start again.",
    );
    // Rounds 1 and 2 probe; round 3 reads a new identity token again, and no
    // probe after round 3 decides anything.
    expect(n).toBe(2);
    expect(h.workspaceCalls).toHaveLength(workspaces);
    expect(h.hookCalls).toEqual([]);
    expect(readMetadataRaw(h.sessionsDir, FIXED)).toEqual(last);
  });

  it("the probe writes launchFailed: the next round does not reuse the record (R4)", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    let written = record;
    herdr.on["pane get"] = async (_args, _socket, answer) => {
      if (!written["launchFailed"]) {
        written = writeRecord(h, FIXED, {
          ...record,
          launchFailed: "a failure of another process",
        });
      }
      return answer();
    };
    const err = await startError(h.sm());
    expect(rows(err)).toEqual([[FIXED, "not-reused", "its launch failed"]]);
    expect(launchIdentityToken(written)).toBe(launchIdentityToken(record));
    expect(readMetadataRaw(h.sessionsDir, FIXED)).toEqual(written);
    expect(h.hookCalls).toEqual([]);
  });
});

describe("r2 sol M-2 and argon M-2: the reuse re-read after the awaited hooks (design r11 5.3.2)", () => {
  it("the hooks write launchFailed: not reused; the next round blocks it (R4)", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    let written = record;
    h.onHooks.run = async () => {
      h.onHooks.run = undefined;
      written = writeRecord(h, FIXED, { ...record, launchFailed: "a failure during the hooks" });
    };
    const err = await startError(h.sm());
    expect(rows(err)).toEqual([[FIXED, "not-reused", "its launch failed"]]);
    expect(launchIdentityToken(written)).toBe(launchIdentityToken(record));
    expect(readMetadataRaw(h.sessionsDir, FIXED)).toEqual(written);
    expect(h.hookCalls).toEqual([h.projectPath]);
    expect(createCommands()).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
  });

  it("the hooks write only another restoredAt: not reused; records-changed after round 3", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    let written = record;
    h.onHooks.run = async () => {
      h.onHooks.run = undefined;
      written = writeRecord(h, FIXED, { ...record, restoredAt: "2026-10-05T00:00:00.000Z" });
    };
    const err = await startError(h.sm());
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
    expect(err).toMatchObject({ reason: "records-changed" });
    expect(launchIdentityToken(written)).not.toBe(launchIdentityToken(record));
    expect(readMetadataRaw(h.sessionsDir, FIXED)).toEqual(written);
    // Round 1 probed the old identity; round 3 reads the new one, and no
    // probe after round 3 decides anything.
    expect(commands()).toEqual(["pane get"]);
    expect(h.hookCalls).toEqual([h.projectPath]);
    expect(h.workspaceCalls).toEqual([]);
  });

  it("the hooks write a live launch claim: not reused; the next round blocks it in-progress (R1)", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    const record = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    let written = record;
    h.onHooks.run = async () => {
      h.onHooks.run = undefined;
      written = writeRecord(h, FIXED, { ...record, ...thisProcessClaim() });
    };
    const err = await startError(h.sm());
    expect(rows(err)).toEqual([
      [FIXED, "in-progress", `launch in progress by ao process ${process.pid}`],
    ]);
    expect(launchIdentityToken(written)).toBe(launchIdentityToken(record));
    expect(readMetadataRaw(h.sessionsDir, FIXED)).toEqual(written);
    expect(h.hookCalls).toEqual([h.projectPath]);
    expect(createCommands()).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
  });
});

describe("r2 argon m-2: a read error at the reuse re-read refuses as G1 does", () => {
  it("the record cannot be read after the hooks: records-unreadable; no reuse, no create", async () => {
    const h = setup();
    paneRuns("w3:p2", "term_a");
    orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    h.onHooks.run = async () => {
      h.onHooks.run = undefined;
      // A directory at the record's path: the strict read throws EISDIR.
      rmSync(join(h.sessionsDir, FIXED));
      mkdirSync(join(h.sessionsDir, FIXED));
    };
    const err = await startError(h.sm());
    expect(isOrchestratorStartBlockedError(err)).toBe(true);
    expect(err).toMatchObject({ reason: "records-unreadable", projectId: "my-app" });
    expect((err as Error).message).toMatch(
      /^The session records of project my-app could not be read \(EISDIR: .*\); no orchestrator was started\.$/,
    );
    expect(h.hookCalls).toEqual([h.projectPath]);
    expect(createCommands()).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
  });
});

describe("r2 argon M-2: G1 row 4, no handle and a live launch owner (design r11 5.3.3)", () => {
  for (const mode of ["isolated", "project"] as const) {
    const id = mode === "project" ? FIXED : `${FIXED}-1`;
    it(`${mode} mode: blocked in-progress; no second launch`, async () => {
      const h = setup({ mode });
      orchestrator(h, id, null, { status: "spawning", ...thisProcessClaim() });
      await expectBlocked(h, [
        [id, "in-progress", `launch in progress by ao process ${process.pid}`],
      ]);
      expect(readdirSync(h.sessionsDir)).toEqual([id]);
    });
  }
});

describe("r2 argon M-3: findReusableOrchestrators (design r11 5.3.1, 5.3.2)", () => {
  it("it waits for lock A: while a start holds A, it refuses admission-busy", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    const paused = gate();
    const holder = startError(
      h.sm({
        onStage: async (stage) => {
          if (stage === "lock-held") {
            paused.reach();
            await paused.wait;
          }
        },
      }),
    );
    await paused.reached;
    try {
      const err = await h
        .sm({ waitMs: 50 })
        .findReusableOrchestrators?.("my-app")
        .catch((e: unknown) => e);
      expect(isOrchestratorStartBlockedError(err)).toBe(true);
      expect(err).toMatchObject({ reason: "admission-busy" });
      expect(commands()).toEqual([]);
    } finally {
      paused.open();
    }
    expect(rows(await holder)).toEqual([[`${FIXED}-1`, "not-reused", "an isolated record"]]);
    // A is free again: the same call answers the live record.
    const reusable = await h.sm({ waitMs: 50 }).findReusableOrchestrators?.("my-app");
    expect(reusable?.map((s) => s.id)).toEqual([`${FIXED}-1`]);
  });

  it("after round 3 it answers the reusable records and drops the one that changes in every round", async () => {
    const h = setup({ mode: "isolated" });
    paneRuns("w3:p2", "term_a");
    paneRuns("w4:p1", "term_b");
    orchestrator(h, `${FIXED}-1`, pinned("w3:p2", "term_a"));
    let changing = orchestrator(h, `${FIXED}-2`, pinned("w4:p1", "term_b"));
    let n = 0;
    herdr.on["pane get"] = async (args, _socket, answer) => {
      if (args[2] === "w4:p1") {
        n += 1;
        changing = writeRecord(h, `${FIXED}-2`, {
          ...changing,
          restoredAt: `2026-10-0${n}T00:00:00.000Z`,
        });
      }
      return answer();
    };
    const reusable = await h.sm().findReusableOrchestrators?.("my-app");
    expect(reusable?.map((s) => s.id)).toEqual([`${FIXED}-1`]);
    // Rounds 1 and 2 probe the changing record; no probe after round 3.
    expect(n).toBe(2);
    expect(readMetadataRaw(h.sessionsDir, `${FIXED}-2`)).toEqual(changing);
    expect(createCommands()).toEqual([]);
  });
});

describe("T-7.26 to T-7.26c: restore of an orchestrator record", () => {
  it("T-7.26: another Herdr orchestrator record blocks the restore (its own ID excluded)", async () => {
    const h = setup({ mode: "isolated" });
    orchestrator(h, `${FIXED}-1`, null, { status: "killed" });
    paneRuns("w3:p2", "term_a");
    orchestrator(h, `${FIXED}-2`, pinned("w3:p2", "term_a"));
    const before = withoutReadRepair(snapshot());
    const err = await h
      .sm()
      .restore(`${FIXED}-1`)
      .catch((e: unknown) => e);
    expect(rows(err)).toEqual([
      [`${FIXED}-2`, "not-reused", `the restore of ${FIXED}-1 would launch next to it`],
    ]);
    // The restore's read of an orchestrator record repairs it (prAutoDetect,
    // generation), as today; nothing else is written.
    expect(withoutReadRepair(snapshot())).toEqual(before);
    expect(createCommands()).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
  });

  it("T-7.26b: during a paused workspace restore a start gets A at once and is blocked in-progress", async () => {
    const h = setup({ mode: "isolated" });
    orchestrator(h, `${FIXED}-1`, null, { status: "killed" });
    rmSync(join(root, "worktrees", `${FIXED}-1`), { recursive: true, force: true });
    const paused = gate();
    h.onWorkspace.restore = async () => {
      paused.reach();
      await paused.wait;
    };
    const restore = h.sm().restore(`${FIXED}-1`);
    await paused.reached;
    const record = readMetadataRaw(h.sessionsDir, `${FIXED}-1`);
    expect(record?.["runtimeHandle"]).toBe(PENDING);
    expect(record?.["launchPid"]).toBe(String(process.pid));
    // waitMs 50: A is free (no admission-busy), and P with the claim blocks.
    const err = await startError(h.sm({ waitMs: 50 }));
    expect(rows(err)).toEqual([
      [`${FIXED}-1`, "in-progress", `launch in progress by ao process ${process.pid}`],
    ]);
    paused.open();
    const restored = await restore;
    expect(restored.runtimeHandle?.id).toBe("w7:p1");
    expect(createCommands()).toContain("workspace create");
    expect(h.workspaceCalls).toEqual([`restore ${FIXED}-1`]);
  });

  it("T-7.26c: a failed workspace restore frees A and puts back the record (the copy-back stays)", async () => {
    const h = setup({ mode: "isolated" });
    orchestrator(h, `${FIXED}-1`, null, { status: "killed" });
    rmSync(join(root, "worktrees", `${FIXED}-1`), { recursive: true, force: true });
    deleteMetadata(h.sessionsDir, `${FIXED}-1`, true);
    expect(readMetadataRaw(h.sessionsDir, `${FIXED}-1`)).toBeNull();
    h.onWorkspace.restore = async () => {
      throw new Error("the workspace cannot be made");
    };
    const err = await h
      .sm()
      .restore(`${FIXED}-1`)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceMissingError);
    // A is free right after: a reuse-only decision with waitMs 50 gets it.
    await expect(h.sm({ waitMs: 50 }).findReusableOrchestrators?.("my-app")).resolves.toEqual([]);
    // The copy-back stays; the write-back put back its runtimeHandle and
    // restoredAt (it has neither) and cleared this process's claim.
    const record = readMetadataRaw(h.sessionsDir, `${FIXED}-1`);
    expect(record).not.toBeNull();
    expect(record?.["status"]).toBe("killed");
    expect(record).not.toHaveProperty("runtimeHandle");
    expect(record).not.toHaveProperty("restoredAt");
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(createCommands()).toEqual([]);
  });
});

describe("T-7.29: no Herdr call under A", () => {
  it("while the probe waits, another start gets A; both end unproven (no answer within 0.2 s)", async () => {
    const h = setup();
    orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
    const hung: Array<() => void> = [];
    const probing = gate();
    herdr.on["pane get"] = () =>
      new Promise<ExecOut>((_resolve, reject) => {
        probing.reach();
        hung.push(() => reject(new Error("released by the test")));
      });
    try {
      const first = startError(h.sm({ probeTimeoutMs: 200 }));
      await probing.reached;
      const stages: string[] = [];
      const second = await startError(
        h.sm({
          waitMs: 50,
          probeTimeoutMs: 200,
          onStage: async (stage) => {
            stages.push(stage);
          },
        }),
      );
      expect(stages).toContain("lock-held");
      for (const err of [await first, second]) {
        expect(rows(err)).toEqual([
          [FIXED, "unproven", "the herdr check did not answer within 0.2 s"],
        ]);
      }
      expect(h.workspaceCalls).toEqual([]);
    } finally {
      for (const release of hung) release();
    }
  });
});
