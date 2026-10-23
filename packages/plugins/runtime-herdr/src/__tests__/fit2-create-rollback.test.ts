/**
 * Herdr fit-2 F-4 (design development/reviews/herdr_fit2_design_r11_opus.md
 * sections 4.4, 4.5 and 5.2): a failed Herdr create keeps the record, the
 * worktree, the agent session and the script, and the launch claims are
 * settled by their owner. Through the built core (createSessionManager) with
 * the real runtime-herdr plugin and the real worktree workspace plugin on a
 * temporary git repository. Only `herdr` is a stand-in: a mocked
 * `node:child_process` answers its calls and keeps its own state (the
 * workspaces it made, the runs it admitted). `node:fs` is wrapped so that a
 * test can make one record write, read or directory check fail (the
 * publication rule, 4.5). Two agent stand-ins: a Claude Code shape (no
 * prepared agent session) and an OpenCode shape (prepareAgentSession,
 * confirmLaunch, getRestoreCommand, postLaunchSetup; it records its discards
 * and starts no agent). The assertions that need fit-2b (startup admission,
 * the F-9 retirement and the status line) come with it (design 8.1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as ChildProcess from "node:child_process";
import type * as Fs from "node:fs";
import type * as FsPromises from "node:fs/promises";

type ExecOut = { stdout: string; stderr: string };
type HerdrHook = (args: string[], answer: () => Promise<ExecOut>) => Promise<ExecOut>;

/** The stand-in `herdr`: its answers, its state and every call. */
const herdr = vi.hoisted(() => {
  const ok = (id: string, result: unknown): ExecOut => ({
    stdout: JSON.stringify({ id, result }),
    stderr: "",
  });
  const state = {
    bin: "",
    status: "",
    calls: [] as string[][],
    next: 7,
    /** The workspaces made: workspace ID -> its root pane and terminal. */
    workspaces: new Map<string, { pane: string; terminal: string }>(),
    /** The `pane run` calls that the stand-in admitted (their arguments). */
    admitted: [] as string[][],
    /** Per command ("workspace create", "pane run", ...): replaces the answer. */
    on: {} as Record<string, HerdrHook | undefined>,
    reset(): void {
      state.calls = [];
      state.next = 7;
      state.workspaces = new Map();
      state.admitted = [];
      state.on = {};
    },
    /** The default answer of the stand-in. */
    async answer(args: string[]): Promise<ExecOut> {
      const key = `${args[0]} ${args[1]}`;
      if (key === "status server") return { stdout: state.status, stderr: "" };
      if (key === "workspace create") {
        const id = `w${state.next++}`;
        const pane = `${id}:p1`;
        const terminal = `term_${id}`;
        state.workspaces.set(id, { pane, terminal });
        return ok("cli:workspace:create", {
          workspace: { workspace_id: id },
          root_pane: { pane_id: pane, terminal_id: terminal, workspace_id: id },
        });
      }
      if (key === "pane run") {
        state.admitted.push(args);
        return ok("cli:request", {});
      }
      if (key === "pane get") {
        for (const ws of state.workspaces.values()) {
          if (ws.pane === args[2]) {
            return ok("cli:pane:get", {
              pane: {
                pane_id: ws.pane,
                terminal_id: ws.terminal,
                agent: "stand-in",
                agent_status: "idle",
              },
            });
          }
        }
        const line = JSON.stringify({
          id: "cli:pane:get",
          error: { code: "pane_not_found", message: `pane ${args[2]} not found` },
        });
        throw Object.assign(new Error(`Command failed: herdr ${args.join(" ")}\n${line}\n`), {
          code: 1,
          signal: null,
          killed: false,
          stdout: "",
          stderr: `${line}\n`,
        });
      }
      throw new Error(`unexpected herdr call: ${args.join(" ")}`);
    },
  };
  return state;
});

/** Faults of the record file and the sessions directory (the publication rule). */
const fsFault = vi.hoisted(() => ({
  /** The record file under watch and its sessions directory. */
  record: "",
  dir: "",
  /** The next renames onto `record`: throw before the rename, or after it. */
  renames: [] as Array<"before" | "after">,
  /** Every rename onto `record` throws before its effect. */
  renameAlways: false,
  /** The content of the last rename that threw before its effect. */
  lastFailedContent: "",
  /** existsSync(dir) answers false this many times. */
  dirFalse: 0,
  /** Runs before each read of `record`, with its count since the last arm(). */
  onRead: null as null | ((n: number) => void),
  /** These reads of `record` (counted since the last arm()) throw EIO. */
  failReads: [] as number[],
  reads: 0,
  /** The log of watched calls since the last arm(): "read", "dir", "rename". */
  log: [] as string[],
  /** Throw EACCES for the next write of a launch script. */
  scriptWriteFails: false,
  /** readFile of this process's /proc stat throws (readLaunchClaim answers null). */
  noStartTime: false,
  arm(): void {
    this.reads = 0;
    this.log = [];
  },
  reset(): void {
    this.record = "";
    this.dir = "";
    this.renames = [];
    this.renameAlways = false;
    this.lastFailedContent = "";
    this.dirFalse = 0;
    this.onRead = null;
    this.failReads = [];
    this.reads = 0;
    this.log = [];
    this.scriptWriteFails = false;
    this.noStartTime = false;
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const eio = (syscall: string, path: string) =>
    Object.assign(new Error(`EIO: i/o error, ${syscall} '${path}'`), {
      code: "EIO",
      errno: -5,
      syscall,
      path,
    });
  const renameSync = ((from: Fs.PathLike, to: Fs.PathLike) => {
    if (fsFault.record && String(to) === fsFault.record) {
      const mode = fsFault.renameAlways ? "before" : fsFault.renames.shift();
      fsFault.log.push(mode ? `rename:${mode}` : "rename");
      if (mode === "before") {
        fsFault.lastFailedContent = actual.readFileSync(from, "utf-8");
        actual.rmSync(from, { force: true });
        throw eio("rename", String(to));
      }
      actual.renameSync(from, to);
      if (mode === "after") throw eio("rename", String(to));
      return;
    }
    actual.renameSync(from, to);
  }) as typeof actual.renameSync;
  const existsSync = ((path: Fs.PathLike) => {
    if (fsFault.dir && String(path) === fsFault.dir) {
      fsFault.log.push("dir");
      if (fsFault.dirFalse > 0) {
        fsFault.dirFalse -= 1;
        return false;
      }
    }
    return actual.existsSync(path);
  }) as typeof actual.existsSync;
  const readFileSync = ((path: Fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (fsFault.record && String(path) === fsFault.record) {
      fsFault.reads += 1;
      const n = fsFault.reads;
      const hook = fsFault.onRead;
      if (hook) hook(n);
      fsFault.log.push("read");
      if (fsFault.failReads.includes(n)) throw eio("open", String(path));
    }
    return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof actual.readFileSync;
  const writeFileSync = ((file: Fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    if (fsFault.scriptWriteFails && /ao-herdr-launch-[^/]*\.sh$/.test(String(file))) {
      fsFault.scriptWriteFails = false;
      throw Object.assign(new Error(`EACCES: permission denied, open '${String(file)}'`), {
        code: "EACCES",
      });
    }
    return (actual.writeFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof actual.writeFileSync;
  const wrapped = { ...actual, renameSync, existsSync, readFileSync, writeFileSync };
  return { ...wrapped, default: wrapped };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  const readFile = ((path: unknown, ...rest: unknown[]) => {
    if (fsFault.noStartTime && String(path) === `/proc/${process.pid}/stat`) {
      return Promise.reject(
        Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
      );
    }
    return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof actual.readFile;
  const wrapped = { ...actual, readFile };
  return { ...wrapped, default: wrapped };
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
        herdr.calls.push(args);
        const hook = herdr.on[`${args[0]} ${args[1]}`];
        return hook ? hook(args, () => herdr.answer(args)) : herdr.answer(args);
      }
      if (cmd === "herdr" || cmd === "tmux") {
        throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
      }
      return promisify(actual.execFile)(cmd, args, ...(rest as [ChildProcess.ExecFileOptions]));
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

// The plugin's waits resolve at once.
vi.mock("node:timers/promises", () => ({
  setTimeout: () => Promise.resolve(),
}));

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  RuntimeStopUnconfirmedError,
  SessionLaunchInProgressError,
  createSessionManager,
  getProjectBaseDir,
  getSessionsDir,
  getWorktreesDir,
  isRuntimeCreatePartialError,
  readMetadataRaw,
  updateMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type PreparedAgentSession,
  type Runtime,
  type RuntimeHandle,
  type SCM,
  type Workspace,
} from "@aoagents/ao-core";
import { create } from "../index.js";
import {
  herdrCliFailure,
  herdrFormsLogEntry,
  herdrRejection,
  herdrTimeout,
  statusRunningAt,
} from "./herdr-fixtures.js";

const SOCKET = "/tmp/aofit2-herdr/herdr.sock";
const AGENT_SESSION = "ses_fit2_prepared";
/** A launch claim of another process (not running), in the record's form. */
const OTHER_CLAIM = { launchPid: "2147483000", launchPidStart: "stat:12345" };
const PENDING = JSON.stringify({
  id: "",
  runtimeName: "herdr",
  data: { createIncomplete: "create-pending" },
});

type Shape = "cc" | "oc";
type Mode = "project" | "isolated";

let root: string;
let warnings: string[];
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-fit2-create-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  herdr.reset();
  fsFault.reset();
  herdr.status = statusRunningAt(SOCKET).stdout;
  warnings = [];
  const write = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    const text = String(chunk);
    if (text.startsWith("ao: ")) {
      warnings.push(text.trimEnd());
      return true;
    }
    return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  fsFault.reset();
  for (const args of herdr.admitted) rmSync(args[4] ?? "", { force: true });
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=fit2", "-c", "user.email=fit2@example.invalid", ...args],
    { cwd, encoding: "utf-8" },
  );
}

/** The worktree plugin's built module, by path (runtime-herdr does not depend on it). */
async function worktreePlugin(): Promise<{
  create: (config?: Record<string, unknown>) => Workspace;
}> {
  const url = pathToFileURL(
    join(import.meta.dirname, "../../../workspace-worktree/dist/index.js"),
  ).href;
  return (await import(url)) as { create: (config?: Record<string, unknown>) => Workspace };
}

interface Harness {
  sm: ReturnType<typeof createSessionManager>;
  agentName: string;
  sessionsDir: string;
  projectPath: string;
  configPath: string;
  worktreeDir: string;
  runtime: Runtime;
  agent: Agent;
  discards: string[];
  destroys: string[];
  /** The record file of `id`; the fs faults watch it. */
  watch(id: string): string;
  record(id: string): Record<string, string> | null;
  file(id: string): string;
}

async function setup(
  options: {
    shape?: Shape;
    mode?: Mode;
    agent?: Partial<Agent>;
    workspace?: Partial<Workspace>;
    scm?: Partial<SCM>;
  } = {},
): Promise<Harness> {
  const shape = options.shape ?? "cc";
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  git(projectPath, "init", "-q", "-b", "main");
  writeFileSync(join(projectPath, "README.md"), "fit-2\n");
  git(projectPath, "add", "README.md");
  git(projectPath, "commit", "-q", "-m", "init");
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const agentName = shape === "cc" ? "cc-shape" : "oc-shape";
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "herdr", agent: agentName, workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: agentName,
        runtime: "herdr",
        workspace: "worktree",
        scm: options.scm ? { plugin: "stand-in" } : undefined,
        orchestratorWorkspaceMode: options.mode ?? "isolated",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });

  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  herdr.bin = join(binDir, "herdr");
  writeFileSync(herdr.bin, "");
  chmodSync(herdr.bin, 0o755);
  const runtime = create({ binPath: herdr.bin });

  const discards: string[] = [];
  const destroys: string[] = [];
  // Core removes only a worktree under its managed root.
  const worktreeDir = getWorktreesDir(configPath, projectPath);
  const realWorkspace = (await worktreePlugin()).create({ worktreeDir });
  const workspace: Workspace = {
    ...realWorkspace,
    destroy: async (path, stillOwned) => {
      destroys.push(path);
      return realWorkspace.destroy(path, stillOwned);
    },
    ...options.workspace,
  };

  const base = {
    name: agentName,
    processName: agentName,
    getLaunchCommand: () => `${agentName} --run`,
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async () => null,
    isProcessRunning: async () => true,
    getSessionInfo: async () => null,
    postLaunchSetup: async () => undefined,
  };
  const prepared = (): PreparedAgentSession => ({
    metadata: { opencodeSessionId: AGENT_SESSION },
    agentConfig: {},
    created: true,
    discard: async () => {
      discards.push(AGENT_SESSION);
    },
  });
  const agent = {
    ...base,
    ...(shape === "oc"
      ? {
          prepareAgentSession: async () => prepared(),
          confirmLaunch: async () => ({}),
          getRestoreCommand: async () => `${agentName} --resume`,
        }
      : {}),
    ...options.agent,
  } as unknown as Agent;
  const scm = options.scm ? ({ name: "stand-in", ...options.scm } as unknown as SCM) : null;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string, name: string) => {
      if (slot === "runtime") return name === "herdr" ? runtime : null;
      if (slot === "agent") return name === agentName ? agent : null;
      if (slot === "workspace") return workspace;
      if (slot === "scm") return scm;
      return null;
    }),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;

  return {
    sm: createSessionManager({ config, registry }),
    agentName,
    sessionsDir,
    projectPath,
    configPath,
    worktreeDir,
    runtime,
    agent,
    discards,
    destroys,
    watch(id: string): string {
      fsFault.dir = sessionsDir;
      fsFault.record = join(sessionsDir, id);
      return fsFault.record;
    },
    record: (id: string) => readMetadataRaw(sessionsDir, id),
    file: (id: string) => readFileSync(join(sessionsDir, id), "utf-8"),
  };
}

/** The herdr commands made, as "<word> <word>". */
function commands(): string[] {
  return herdr.calls.map((args) => `${args[0]} ${args[1]}`);
}

function expectNoClose(): void {
  expect(commands()).not.toContain("workspace close");
  expect(commands()).not.toContain("pane close");
}

function handleOf(record: Record<string, string> | null): RuntimeHandle {
  return JSON.parse(record?.["runtimeHandle"] ?? "null") as RuntimeHandle;
}

/** The launch claim of this process as core writes it. */
function ownClaimOf(record: Record<string, string> | null): boolean {
  return record?.["launchPid"] === String(process.pid) && !!record?.["launchPidStart"];
}

/** `pane run` admits the run, then fails the way `failure` says. */
function runFails(failure: () => Error): void {
  herdr.on["pane run"] = async (args) => {
    herdr.admitted.push(args);
    throw failure();
  };
}

const runTimesOut = () => runFails(() => herdrTimeout("herdr pane run"));

function q1(socket: string, id = "cli:request"): Error {
  return herdrCliFailure(
    "herdr call",
    id,
    "server_not_running",
    `no herdr server is running at ${socket}; run \`herdr\` to start or attach it`,
  );
}

async function spawnError(h: Harness): Promise<unknown> {
  return h.sm.spawn({ projectId: "my-app" }).catch((e: unknown) => e);
}

async function startError(h: Harness, systemPrompt?: string): Promise<unknown> {
  return h.sm
    .spawnOrchestrator({ projectId: "my-app", ...(systemPrompt ? { systemPrompt } : {}) })
    .catch((e: unknown) => e);
}

/** A worktree of the project for a hand-made record, as a spawn makes it. */
function makeWorktree(h: Harness, id: string, branch = `session/${id}`): string {
  const path = join(h.worktreeDir, "my-app", id);
  mkdirSync(join(h.worktreeDir, "my-app"), { recursive: true });
  git(h.projectPath, "worktree", "add", "-q", "-b", branch, "--", path, "main");
  return path;
}

/**
 * Write a whole record as another process would: the next generation, a temp
 * file, a rename onto the record name. (writeMetadata keeps only the known
 * keys, and a reservation is internal to core.) Answers the file's text.
 */
function writeRecord(h: Harness, id: string, data: Record<string, string>): string {
  const path = join(h.sessionsDir, id);
  const current = readMetadataRaw(h.sessionsDir, id);
  const generation = String(Number(current?.["generation"] ?? "0") + 1);
  const text =
    Object.entries({ ...data, generation })
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n";
  writeFileSync(`${path}.tmp.fit2`, text);
  renameSync(`${path}.tmp.fit2`, path);
  return text;
}

/** A new reservation of the ID with P and another claim (a replacement). */
function replaceWithReservation(h: Harness, id: string): string {
  return writeRecord(h, id, {
    reservationId: "res_other",
    runtimeHandle: PENDING,
    ...(id.includes("orchestrator") ? { role: "orchestrator" } : {}),
    ...OTHER_CLAIM,
  });
}

describe("Herdr fit-2 F-4: a worker whose create fails keeps its launch (T-4.2 to T-4.4)", () => {
  /** The kept failed launch of a worker: 5.2.5. */
  function expectKeptWorker(h: Harness, stage: string): Record<string, string> {
    const record = h.record("app-1");
    expect(record).not.toBeNull();
    const handle = handleOf(record);
    expect(handle.runtimeName).toBe("herdr");
    expect(handle.data["createIncomplete"]).toBe(stage);
    expect(handle.data["herdrSocket"]).toBe(SOCKET);
    expect(record?.["status"]).toBe("spawning");
    expect(record?.["launchFailed"]).toMatch(/^Failed to launch agent in herdr pane w7:p1/);
    expect(record?.["launchFailed"]).toContain("runtime stop unconfirmed (unknown)");
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(record).not.toHaveProperty("reservationId");
    expect(existsSync(record?.["worktree"] ?? "")).toBe(true);
    expect(h.discards).toEqual([]);
    expect(h.destroys).toEqual([]);
    expectNoClose();
    return record ?? {};
  }

  for (const shape of ["cc", "oc"] as const) {
    it(`T-4.2 (${shape}): writeLaunchScript throws; the record has the partial handle, not P`, async () => {
      const h = await setup({ shape });
      fsFault.scriptWriteFails = true;
      const err = await spawnError(h);
      expect(isRuntimeCreatePartialError(err)).toBe(true);
      expect(err).toMatchObject({ stage: "launch-not-submitted" });
      const record = expectKeptWorker(h, "launch-not-submitted");
      expect(handleOf(record).id).toBe("w7:p1");
      expect(commands()).toEqual(["status server", "workspace create"]);
      if (shape === "oc") expect(record["opencodeSessionId"]).toBe(AGENT_SESSION);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        /^ao: the failed launch of app-1 was not rolled back: runtime stop unconfirmed \(unknown\)/,
      );
    });

    it(`T-4.2 (${shape}): pane run answers Q1; the script is removed, the launch kept`, async () => {
      const h = await setup({ shape });
      herdr.on["pane run"] = async () => {
        throw q1(SOCKET);
      };
      const err = await spawnError(h);
      expect(err).toMatchObject({ stage: "launch-not-submitted" });
      expectKeptWorker(h, "launch-not-submitted");
      expect(commands()).toEqual(["status server", "workspace create", "pane run"]);
    });
  }

  it("T-4.3: a timeout after the admission; launch-unconfirmed, the script kept", async () => {
    const h = await setup({ shape: "oc" });
    runTimesOut();
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    expectKeptWorker(h, "launch-unconfirmed");
    expect(herdr.admitted).toHaveLength(1);
    expect(existsSync(herdr.admitted[0][4])).toBe(true);
  });

  it("T-4.3b: workspace create makes w7, then answers an unknown F1 code", async () => {
    const h = await setup({ shape: "oc" });
    herdr.on["workspace create"] = async (_args, answer) => {
      await answer();
      throw herdrCliFailure(
        "herdr workspace create",
        "cli:workspace:create",
        "zz_unknown_code",
        "x",
      );
    };
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "workspace-unconfirmed", handle: { id: "" } });
    const record = h.record("app-1");
    expect(handleOf(record)).toMatchObject({
      id: "",
      data: { createIncomplete: "workspace-unconfirmed" },
    });
    expect(record?.["launchFailed"]).toMatch(
      /^herdr workspace create did not confirm a workspace for session \S+-app-1 \(zz_unknown_code: x\); AO closed nothing; then runtime stop unconfirmed \(unknown\)/,
    );
    expect(record?.["opencodeSessionId"]).toBe(AGENT_SESSION);
    expect(record).not.toHaveProperty("launchPid");
    expect(existsSync(record?.["worktree"] ?? "")).toBe(true);
    expect(h.discards).toEqual([]);
    expect(herdr.workspaces.has("w7")).toBe(true);
    expectNoClose();
  });

  it("T-4.3b: pane run admits the run, then answers pane_not_found; the script kept", async () => {
    const h = await setup({ shape: "oc" });
    runFails(() =>
      herdrCliFailure("herdr pane run", "cli:request", "pane_not_found", "pane w7:p1 not found"),
    );
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    expectKeptWorker(h, "launch-unconfirmed");
    expect(existsSync(herdr.admitted[0][4])).toBe(true);
  });

  it("T-4.4: the pane has another terminal after the run; terminalAfterRun is recorded", async () => {
    const h = await setup();
    herdr.on["pane get"] = async (args) => ({
      stdout: JSON.stringify({
        id: "cli:pane:get",
        result: { pane: { pane_id: args[2], terminal_id: "term_restarted" } },
      }),
      stderr: "",
    });
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = expectKeptWorker(h, "launch-unconfirmed");
    expect(handleOf(record).data).toMatchObject({
      terminalId: "term_w7",
      terminalAfterRun: "term_restarted",
    });
  });
});

describe("Herdr fit-2 F-4: an orchestrator whose create fails keeps its launch (T-4.5, T-4.6)", () => {
  const failures: Array<[string, () => void, string]> = [
    [
      "the script cannot be written",
      () => (fsFault.scriptWriteFails = true),
      "launch-not-submitted",
    ],
    ["a timeout after the admission", runTimesOut, "launch-unconfirmed"],
    [
      "another terminal after the run",
      () =>
        (herdr.on["pane get"] = async (args) => ({
          stdout: JSON.stringify({
            id: "cli:pane:get",
            result: { pane: { pane_id: args[2], terminal_id: "term_restarted" } },
          }),
          stderr: "",
        })),
      "launch-unconfirmed",
    ],
  ];
  for (const [label, arrange, stage] of failures) {
    it(`T-4.5 (project mode): ${label}`, async () => {
      const h = await setup({ shape: "oc", mode: "project" });
      const before = git(h.projectPath, "status", "--porcelain", "--ignored");
      arrange();
      const err = await startError(h, "be the orchestrator");
      expect(err).toMatchObject({ stage });
      const record = h.record("app-orchestrator");
      expect(handleOf(record).data["createIncomplete"]).toBe(stage);
      expect(record?.["role"]).toBe("orchestrator");
      expect(record?.["status"]).toBe("working");
      expect(record?.["launchFailed"]).toMatch(/^Failed to launch agent in herdr pane w7:p1/);
      expect(record).not.toHaveProperty("launchPid");
      const prompt = join(
        getProjectBaseDir(h.configPath, h.projectPath),
        "orchestrator-prompt-app-orchestrator.md",
      );
      expect(readFileSync(prompt, "utf-8")).toBe("be the orchestrator");
      expect(git(h.projectPath, "status", "--porcelain", "--ignored")).toBe(before);
      expect(h.discards).toEqual([]);
      expectNoClose();
    });
  }

  it("T-4.6 (isolated mode): a timeout keeps the worktree and the numbered record", async () => {
    const h = await setup({ shape: "cc", mode: "isolated" });
    runTimesOut();
    const err = await startError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = h.record("app-orchestrator-1");
    expect(handleOf(record)).toMatchObject({
      id: "w7:p1",
      data: { createIncomplete: "launch-unconfirmed" },
    });
    expect(record?.["worktree"]).toBe(join(h.worktreeDir, "my-app", "app-orchestrator-1"));
    expect(existsSync(record?.["worktree"] ?? "")).toBe(true);
    expect(record).not.toHaveProperty("launchPid");
    expect(h.destroys).toEqual([]);
    expectNoClose();
  });
});

describe("Herdr fit-2 F-4: a record that changed during the launch (T-4.7, T-4.7b)", () => {
  it("T-4.7: replaced during the create; nothing removed, nothing written to the new record", async () => {
    const h = await setup({ shape: "oc" });
    let replaced = "";
    runFails(() => {
      replaced = replaceWithReservation(h, "app-1");
      return herdrTimeout("herdr pane run");
    });
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    expect(h.file("app-1")).toBe(replaced);
    expect(h.discards).toEqual([]);
    expect(h.destroys).toEqual([]);
    expect(existsSync(join(h.worktreeDir, "my-app", "app-1"))).toBe(true);
    expectNoClose();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("its record was replaced");
    expect(warnings[0]).toContain(
      `herdr pane w7:p1 (terminal term_w7, workspace w7, socket ${SOCKET})`,
    );
    expect(warnings[0]).toContain(`worktree ${join(h.worktreeDir, "my-app", "app-1")}`);
    expect(warnings[0]).toContain(`agent session ${AGENT_SESSION}`);
  });

  it("T-4.7b: replaced by a new reservation with P before postLaunchSetup throws", async () => {
    let replaced = "";
    // The harness, for the agent hook that runs after setup.
    const late: { h?: Harness } = {};
    const h = await setup({
      shape: "oc",
      agent: {
        postLaunchSetup: async () => {
          if (!late.h) return;
          replaced = replaceWithReservation(late.h, "app-1");
          throw new Error("postLaunchSetup failed");
        },
      },
    });
    late.h = h;
    const err = await spawnError(h);
    expect((err as Error).message).toBe("postLaunchSetup failed");
    expect(h.file("app-1")).toBe(replaced);
    expect(h.discards).toEqual([]);
    expect(h.destroys).toEqual([]);
    expectNoClose();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("its record was replaced");
    expect(warnings[0]).toContain("herdr pane w7:p1");
  });
});

describe("Herdr fit-2 F-4: controls with today's rollback (T-4.8, T-4.8b, T-4.9)", () => {
  const r8 = (section: string) => herdrFormsLogEntry("r8_cli_forms_log.txt", section);

  it("T-4.8: workspace create answers Q1 for the endpoint's socket", async () => {
    const h = await setup({ shape: "oc" });
    herdr.on["workspace create"] = async () => {
      throw q1(SOCKET, "cli:workspace:create");
    };
    const err = await spawnError(h);
    expect(isRuntimeCreatePartialError(err)).toBe(false);
    expect(err).toMatchObject({ herdrCode: "server_not_running", code: "ERR_RUNTIME_NO_SERVER" });
    expect(h.record("app-1")).toBeNull();
    expect(existsSync(join(h.worktreeDir, "my-app", "app-1"))).toBe(false);
    expect(h.discards).toEqual([AGENT_SESSION]);
    expect(commands()).toEqual(["status server", "workspace create"]);
  });

  for (const section of ["r8_ws_create_ping_protocol_19", "r8_ws_create_ping_protocol_23"]) {
    it(`T-4.8: workspace create answers Q2 (${section})`, async () => {
      const h = await setup({ shape: "oc" });
      herdr.on["workspace create"] = async () => {
        throw herdrRejection(r8(section));
      };
      const err = await spawnError(h);
      expect(err).toMatchObject({ herdrCode: "protocol_mismatch" });
      expect(h.record("app-1")).toBeNull();
      expect(existsSync(join(h.worktreeDir, "my-app", "app-1"))).toBe(false);
      expect(h.discards).toEqual([AGENT_SESSION]);
      expect(commands()).toEqual(["status server", "workspace create"]);
    });
  }

  it("T-4.8b: the server is not compatible; no workspace create, today's rollback", async () => {
    const h = await setup({ shape: "oc" });
    herdr.status = r8("r8_status_json_ping_protocol_19").stdout;
    const err = await spawnError(h);
    expect(isRuntimeCreatePartialError(err)).toBe(false);
    expect((err as Error).message).toMatch(/is not compatible with this herdr client/);
    expect(h.record("app-1")).toBeNull();
    expect(existsSync(join(h.worktreeDir, "my-app", "app-1"))).toBe(false);
    expect(h.discards).toEqual([AGENT_SESSION]);
    expect(commands()).toEqual(["status server"]);
  });

  it("T-4.9: a successful create; the handle with the pins, P replaced, no claim left", async () => {
    const h = await setup({ shape: "cc" });
    const session = await h.sm.spawn({ projectId: "my-app" });
    expect(session.runtimeHandle).toMatchObject({
      id: "w7:p1",
      data: { herdrBin: herdr.bin, herdrSocket: SOCKET, terminalId: "term_w7" },
    });
    expect(commands()).toEqual(["status server", "workspace create", "pane run", "pane get"]);
    const record = h.record("app-1");
    expect(handleOf(record)).toEqual(session.runtimeHandle);
    expect(handleOf(record).data).not.toHaveProperty("createIncomplete");
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(record).not.toHaveProperty("launchFailed");
    expect(warnings).toEqual([]);
  });
});

/** The launch of a restore test: an old launch time that a restore replaces. */
const OLD_RESTORED_AT = "2026-10-02T00:00:00.000Z";

/**
 * A terminal record without a runtime handle, so that restore reaches step 9
 * (5.2.8 T-4.10). An orchestrator ID gets the orchestrator role and branch.
 * `worktree: false` names a managed worktree path that does not exist.
 */
function handlelessRecord(
  h: Harness,
  id: string,
  options: { worktree?: boolean; extra?: Record<string, string> } = {},
): string {
  const orchestrator = id.includes("orchestrator");
  const branch = orchestrator ? `orchestrator/${id}` : `session/${id}`;
  const worktree =
    options.worktree === false ? join(h.worktreeDir, "my-app", id) : makeWorktree(h, id, branch);
  writeRecord(h, id, {
    worktree,
    branch,
    status: "killed",
    project: "my-app",
    agent: h.agentName,
    createdAt: "2026-10-01T00:00:00.000Z",
    restoredAt: OLD_RESTORED_AT,
    ...(orchestrator ? { role: "orchestrator" } : {}),
    ...options.extra,
  });
  return worktree;
}

/** A kept failed launch as fit-2 leaves it (5.2.5), written by hand. */
function keptRecord(
  h: Harness,
  id: string,
  handle: Partial<RuntimeHandle> & { data: Record<string, unknown> },
  extra: Record<string, string> = {},
): string {
  const worktree = makeWorktree(h, id);
  writeRecord(h, id, {
    worktree,
    branch: `session/${id}`,
    status: "spawning",
    project: "my-app",
    agent: h.agentName,
    createdAt: "2026-10-01T00:00:00.000Z",
    runtimeHandle: JSON.stringify({ id: "w7:p1", runtimeName: "herdr", ...handle }),
    launchFailed:
      "Failed to launch agent in herdr pane w7:p1 (launch-unconfirmed): transport failure",
    ...extra,
  });
  return worktree;
}

/** The pins and IDs of the stand-in's first workspace, as a handle stores them. */
function pinnedData(stage?: string): Record<string, unknown> {
  return {
    workspaceId: "w7",
    paneId: "w7:p1",
    terminalId: "term_w7",
    herdrBin: herdr.bin,
    herdrSocket: SOCKET,
    ...(stage ? { createIncomplete: stage } : {}),
  };
}

/** A record file's text as its keys (the key=value format of core). */
function parseRecord(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

async function killError(h: Harness, id: string): Promise<unknown> {
  return h.sm.kill(id).catch((e: unknown) => e);
}

describe("Herdr fit-2 F-4: restore of a Herdr record (T-4.10 to T-4.10c)", () => {
  it("T-4.10: pane run times out; the partial handle, launchFailed and a new restoredAt; no claim", async () => {
    const h = await setup({ shape: "oc" });
    const worktree = handlelessRecord(h, "app-1");
    runTimesOut();
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(isRuntimeCreatePartialError(err)).toBe(true);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = h.record("app-1");
    expect(handleOf(record)).toMatchObject({
      id: "w7:p1",
      data: { createIncomplete: "launch-unconfirmed", herdrSocket: SOCKET },
    });
    expect(record?.["status"]).toBe("spawning");
    expect(record?.["launchFailed"]).toMatch(
      /^Failed to launch agent in herdr pane w7:p1 \(launch-unconfirmed\): transport failure/,
    );
    expect(record?.["restoredAt"]).not.toBe(OLD_RESTORED_AT);
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(existsSync(worktree)).toBe(true);
    expect(existsSync(herdr.admitted[0][4])).toBe(true);
    expect(h.destroys).toEqual([]);
    expectNoClose();
    expect(warnings).toEqual([]);
  });

  it("T-4.10b: a second restore of that kept launch refuses at step 7; no workspace create", async () => {
    const h = await setup({ shape: "oc" });
    handlelessRecord(h, "app-1");
    runTimesOut();
    await h.sm.restore("app-1").catch(() => undefined);
    const kept = h.file("app-1");
    // The pane no longer answers (closed by hand), so the record reads as dead.
    herdr.workspaces.clear();
    herdr.calls = [];
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toMatch(/^runtime stop unconfirmed \(unknown\)/);
    expect(commands()).not.toContain("workspace create");
    expect(commands()).not.toContain("pane run");
    expect(h.file("app-1")).toBe(kept);
    expectNoClose();
  });

  it("T-4.10c: step 9 answers Q1; runtimeHandle and restoredAt as before, no claim, nothing created", async () => {
    const h = await setup({ shape: "oc" });
    handlelessRecord(h, "app-1");
    herdr.on["workspace create"] = async () => {
      throw q1(SOCKET, "cli:workspace:create");
    };
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(isRuntimeCreatePartialError(err)).toBe(false);
    expect(err).toMatchObject({ herdrCode: "server_not_running" });
    const record = h.record("app-1");
    expect(record).not.toHaveProperty("runtimeHandle");
    expect(record?.["restoredAt"]).toBe(OLD_RESTORED_AT);
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(herdr.workspaces.size).toBe(0);
    expect(warnings).toEqual([]);
  });
});

describe("Herdr fit-2 F-4: the consumers of a kept failed launch (T-4.11 to T-4.14)", () => {
  it("T-4.11: kill refuses before the worktree removal and the archive, with no herdr call", async () => {
    const h = await setup();
    const variants: Array<[string, Record<string, unknown>, string]> = [
      ["app-1", pinnedData("launch-unconfirmed"), "w7:p1"],
      ["app-2", { ...pinnedData("workspace-unconfirmed"), paneId: undefined }, ""],
      ["app-3", { ...pinnedData("launch-unconfirmed"), herdrSocket: "relative.sock" }, "w7:p1"],
    ];
    for (const [id, data, pane] of variants) {
      const worktree = keptRecord(h, id, { id: pane, data });
      const before = h.file(id);
      const err = await killError(h, id);
      expect(err, id).toBeInstanceOf(RuntimeStopUnconfirmedError);
      expect((err as Error).message, id).toMatch(
        /^runtime stop unconfirmed \(unknown\): .*; record and worktree kept$/,
      );
      expect(h.file(id), id).toBe(before);
      expect(existsSync(worktree), id).toBe(true);
    }
    expect(herdr.calls).toEqual([]);
    expect(h.destroys).toEqual([]);
  });

  it("T-4.12: get and list keep the stored partial handle; only a false probe enriches", async () => {
    const h = await setup();
    // app-1: a grammar pane that herdr no longer has; app-2: an empty ID.
    keptRecord(h, "app-1", { data: pinnedData("launch-unconfirmed") });
    keptRecord(h, "app-2", { id: "", data: pinnedData("workspace-unconfirmed") });
    const files = [h.file("app-1"), h.file("app-2")];
    const one = await h.sm.get("app-1");
    const two = await h.sm.get("app-2");
    expect(one?.status).toBe("killed");
    expect(two?.status).toBe("spawning");
    expect(one?.runtimeHandle).toEqual(handleOf(h.record("app-1")));
    expect(two?.runtimeHandle).toEqual(handleOf(h.record("app-2")));
    const listed = await h.sm.list("my-app");
    expect(listed.map((session) => session.id).sort()).toEqual(["app-1", "app-2"]);
    expect([h.file("app-1"), h.file("app-2")]).toEqual(files);
    // The empty ID makes no call; the grammar pane is probed.
    expect(herdr.calls.every((args) => args[2] === "w7:p1")).toBe(true);
  });

  it("T-4.13: cleanup keeps a worker partial with a merged PR and one whose pane is gone", async () => {
    const h = await setup({ scm: { getPRState: async () => "merged" } });
    const merged = keptRecord(
      h,
      "app-1",
      { data: pinnedData("launch-unconfirmed") },
      { pr: "https://github.com/org/my-app/pull/7" },
    );
    const gone = keptRecord(h, "app-2", { data: pinnedData("launch-unconfirmed") });
    // app-1's pane runs; app-2 names a pane that herdr does not have.
    herdr.workspaces.set("w7", { pane: "w7:p1", terminal: "term_w7" });
    writeRecord(h, "app-2", {
      ...(h.record("app-2") ?? {}),
      runtimeHandle: JSON.stringify({
        id: "w8:p1",
        runtimeName: "herdr",
        data: { ...pinnedData("launch-unconfirmed"), workspaceId: "w8", paneId: "w8:p1" },
      }),
    });
    const files = [h.file("app-1"), h.file("app-2")];
    const result = await h.sm.cleanup("my-app");
    expect(result.killed).toEqual([]);
    const kept = result.errors.map((entry) => entry.sessionId).sort();
    expect(kept).toEqual(["app-1", "app-2"]);
    for (const entry of result.errors) {
      expect(entry.error, entry.sessionId).toMatch(/^kept: runtime stop unconfirmed \(unknown\)/);
    }
    expect([h.file("app-1"), h.file("app-2")]).toEqual(files);
    expect(existsSync(merged)).toBe(true);
    expect(existsSync(gone)).toBe(true);
    expect(h.destroys).toEqual([]);
    expectNoClose();
  });
});

describe("Herdr fit-2 F-4: a launch in flight holds P, the claim and its fields (T-4.15)", () => {
  const cases: Array<[string, Shape, "spawn" | "start", string]> = [
    ["worker, Claude Code shape", "cc", "spawn", "app-1"],
    ["worker, OpenCode shape", "oc", "spawn", "app-1"],
    ["isolated orchestrator, Claude Code shape", "cc", "start", "app-orchestrator-1"],
    ["isolated orchestrator, OpenCode shape", "oc", "start", "app-orchestrator-1"],
  ];
  for (const [label, shape, operation, id] of cases) {
    it(label, async () => {
      const h = await setup({ shape, mode: "isolated" });
      let release: (() => void) | undefined;
      let running: (() => void) | undefined;
      const inRun = new Promise<void>((resolve) => (running = resolve));
      herdr.on["pane run"] = (args) =>
        new Promise<ExecOut>((_resolve, reject) => {
          herdr.admitted.push(args);
          release = () => reject(herdrTimeout("herdr pane run"));
          running?.();
        });
      const launch =
        operation === "spawn"
          ? h.sm.spawn({ projectId: "my-app" }).catch((e: unknown) => e)
          : h.sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
      await inRun;
      const record = h.record(id);
      expect(record?.["runtimeHandle"]).toBe(PENDING);
      expect(ownClaimOf(record)).toBe(true);
      expect(record?.["worktree"]).toBe(join(h.worktreeDir, "my-app", id));
      expect(record?.["branch"]).toBe(
        operation === "spawn" ? `session/${id}` : `orchestrator/${id}`,
      );
      expect(record?.["agent"]).toBe(h.agentName);
      expect(record?.["createdAt"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(record?.["status"]).toBe(operation === "spawn" ? "spawning" : "working");
      if (operation === "start") expect(record?.["role"]).toBe("orchestrator");
      if (shape === "oc") expect(record?.["opencodeSessionId"]).toBe(AGENT_SESSION);
      expect(record).not.toHaveProperty("reservationId");
      expect(record).not.toHaveProperty("launchFailed");
      release?.();
      expect(await launch).toMatchObject({ stage: "launch-unconfirmed" });
    });
  }
});

describe("Herdr fit-2 F-4: the resident restore settles its own claim (T-4.16, T-4.16b)", () => {
  it("T-4.16: postLaunchSetup throws once; the restore resolves with no claim; kill refuses unknown", async () => {
    let throwOnce = true;
    const h = await setup({
      shape: "oc",
      mode: "isolated",
      agent: {
        postLaunchSetup: async () => {
          if (!throwOnce) return;
          throwOnce = false;
          throw new Error("postLaunchSetup failed");
        },
      },
    });
    const worktree = handlelessRecord(h, "app-orchestrator-1", {
      extra: { opencodeSessionId: AGENT_SESSION },
    });
    const restored = await h.sm.restore("app-orchestrator-1");
    expect(restored.runtimeHandle?.id).toBe("w7:p1");
    const record = h.record("app-orchestrator-1");
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    const err = await killError(h, "app-orchestrator-1");
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect(err).not.toBeInstanceOf(SessionLaunchInProgressError);
    expect(existsSync(worktree)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("T-4.16b: the settlement write throws; one warning, the claim stays, kill refuses in progress", async () => {
    const h = await setup({
      shape: "oc",
      mode: "isolated",
      agent: {
        postLaunchSetup: async () => {
          // Step 11 writes nothing; the next record write is step 12.
          fsFault.renames.push("before");
          throw new Error("postLaunchSetup failed");
        },
      },
    });
    const worktree = handlelessRecord(h, "app-orchestrator-1", {
      extra: { opencodeSessionId: AGENT_SESSION },
    });
    h.watch("app-orchestrator-1");
    const restored = await h.sm.restore("app-orchestrator-1");
    expect(restored.runtimeHandle?.id).toBe("w7:p1");
    const record = h.record("app-orchestrator-1");
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(ownClaimOf(record)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(
      `ao: the launch claim of app-orchestrator-1 may remain (EIO: i/o error, rename '${fsFault.record}'); ` +
        `while ao process ${process.pid} (start ${record?.["launchPidStart"]}) runs, AO treats the launch as in progress.`,
    );
    const err = await killError(h, "app-orchestrator-1");
    expect(err).toBeInstanceOf(SessionLaunchInProgressError);
    expect(existsSync(worktree)).toBe(true);
    expect(h.record("app-orchestrator-1")).not.toBeNull();
  });
});

describe("Herdr fit-2 F-4: kept post-create failures settle the claim (T-4.17, T-4.18)", () => {
  const cases: Array<[string, Shape, "spawn" | Mode, string]> = [
    ["spawn, Claude Code shape (postLaunchSetup)", "cc", "spawn", "app-1"],
    ["spawn, OpenCode shape (confirmLaunch)", "oc", "spawn", "app-1"],
    ["start in project mode, Claude Code shape", "cc", "project", "app-orchestrator"],
    ["start in project mode, OpenCode shape", "oc", "project", "app-orchestrator"],
    ["start in isolated mode, Claude Code shape", "cc", "isolated", "app-orchestrator-1"],
    ["start in isolated mode, OpenCode shape", "oc", "isolated", "app-orchestrator-1"],
  ];
  for (const [label, shape, operation, id] of cases) {
    it(`T-4.17: ${label}`, async () => {
      const failing =
        shape === "cc"
          ? {
              postLaunchSetup: async () => {
                throw new Error("postLaunchSetup failed");
              },
            }
          : {
              confirmLaunch: async () => {
                throw new Error("confirmLaunch failed");
              },
            };
      const h = await setup({
        shape,
        mode: operation === "spawn" ? "isolated" : operation,
        agent: failing,
      });
      const err = operation === "spawn" ? await spawnError(h) : await startError(h);
      expect((err as Error).message).toMatch(/failed$/);
      const record = h.record(id);
      const handle = handleOf(record);
      expect(handle).toMatchObject({ id: "w7:p1", data: pinnedData() });
      expect(handle.data).not.toHaveProperty("createIncomplete");
      expect(record?.["launchFailed"]).toMatch(/failed; then runtime stop unconfirmed \(unknown\)/);
      expect(record).not.toHaveProperty("launchPid");
      expect(record).not.toHaveProperty("launchPidStart");
      const kill = await killError(h, id);
      expect(kill).toBeInstanceOf(RuntimeStopUnconfirmedError);
      expect(h.discards).toEqual([]);
      expect(h.destroys).toEqual([]);
      expectNoClose();
    });
  }

  it("T-4.18: a later claim written during postLaunchSetup survives the success settlement", async () => {
    let after = "";
    const late: { h?: Harness } = {};
    const h = await setup({
      shape: "cc",
      agent: {
        postLaunchSetup: async () => {
          if (!late.h) return;
          updateMetadata(late.h.sessionsDir, "app-1", OTHER_CLAIM);
          after = late.h.file("app-1");
        },
      },
    });
    late.h = h;
    const session = await h.sm.spawn({ projectId: "my-app" });
    // The later claim values stay byte-equal; the launch's own later write
    // (today's promptDelivered) is in the record too.
    const record = h.record("app-1");
    expect(parseRecord(after)).toMatchObject(OTHER_CLAIM);
    expect({
      launchPid: record?.["launchPid"],
      launchPidStart: record?.["launchPidStart"],
    }).toEqual(OTHER_CLAIM);
    expect(handleOf(record)).toEqual(session.runtimeHandle);
    expect(record?.["promptDelivered"]).toBe("true");
    expect(warnings).toEqual([]);
  });
});

/**
 * The herdr calls of T-4.14's sends. (a): the probes of get and the send's
 * checks, three readiness polls, the baseline and confirmation reads, the
 * settle wait, the state before the prompt, one prompt, its consumption
 * check; no raw input. (c): one probe for get and one for the restore's
 * enrichment; the restore refuses at step 7 with no call.
 */
const SEND_A_COUNTS: Record<string, number> = { "pane get": 9, "pane read": 5, "agent prompt": 1 };
const SEND_B_ERROR =
  /^Cannot send to session app-1: session needed to be restarted before delivery \(Session app-1 cannot be restored: session is not in a terminal state\)$/;
const SEND_C_COUNTS: Record<string, number> = { "pane get": 2 };

describe("Herdr fit-2 F-4: a send to a kept failed launch (T-4.14)", () => {
  function counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const command of commands()) out[command] = (out[command] ?? 0) + 1;
    return out;
  }

  it("a launch-unconfirmed partial whose pane runs the agent with terminal T receives the send", async () => {
    const h = await setup();
    keptRecord(h, "app-1", { data: pinnedData("launch-unconfirmed") });
    herdr.workspaces.set("w7", { pane: "w7:p1", terminal: "term_w7" });
    let prompted = false;
    herdr.on["pane read"] = async () => ({
      stdout: prompted ? "working on it\n" : "ready\n",
      stderr: "",
    });
    herdr.on["agent prompt"] = async () => {
      prompted = true;
      return { stdout: JSON.stringify({ id: "cli:agent:prompt", result: {} }), stderr: "" };
    };
    herdr.on["pane get"] = async (_args, answer) => {
      const out = await answer();
      return prompted
        ? {
            stdout: out.stdout.replace('"agent_status":"idle"', '"agent_status":"working"'),
            stderr: "",
          }
        : out;
    };
    await h.sm.send("app-1", "go on");
    expect(counts()).toEqual(SEND_A_COUNTS);
    expect(herdr.calls.find((args) => args[0] === "agent")).toEqual([
      "agent",
      "prompt",
      "w7:p1",
      "go on",
    ]);
  });

  it("an empty-ID partial waits for readiness, then the send rejects with no herdr call", async () => {
    const h = await setup();
    keptRecord(h, "app-1", { id: "", data: pinnedData("workspace-unconfirmed") });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let outcome: unknown = "pending";
      const sending = h.sm.send("app-1", "go on").then(
        () => (outcome = "resolved"),
        (err: unknown) => (outcome = err),
      );
      for (let i = 0; i < 120 && outcome === "pending"; i++) await vi.advanceTimersByTimeAsync(500);
      await sending;
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toMatch(SEND_B_ERROR);
    } finally {
      vi.useRealTimers();
    }
    expect(herdr.calls).toEqual([]);
  });

  it("a partial whose terminal changed answers isAlive false; the send's restore refuses", async () => {
    const h = await setup();
    keptRecord(h, "app-1", { data: pinnedData("launch-unconfirmed") });
    herdr.workspaces.set("w7", { pane: "w7:p1", terminal: "term_new" });
    const before = h.file("app-1");
    const err = await h.sm.send("app-1", "go on").catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /^Cannot send to session app-1: session is not running \(runtime stop unconfirmed \(unknown\)/,
    );
    expect(counts()).toEqual(SEND_C_COUNTS);
    expect(h.file("app-1")).toBe(before);
  });
});

/** The claim values of a later operation (another process), not running. */
const LATER_CLAIM = { launchPid: "2147483001", launchPidStart: "stat:23456" };

describe("Herdr fit-2 F-4: a claimless restore writes its transition back (T-4.19a to T-4.19d)", () => {
  const WRITE_BACK =
    "ao: AO could not write back the record of app-1; it may keep the pending handle of this restore; " +
    'check runtimeHandle, restoredAt, launchPid and launchPidStart, then retire it by hand (docs/DEVELOPMENT.md, "Retire a Herdr record by hand").';

  async function claimless(options: {
    worktree: boolean;
    restore?: (h: Harness) => Promise<never>;
  }): Promise<Harness> {
    const late: { h?: Harness } = {};
    const h = await setup({
      workspace: options.restore
        ? {
            restore: async () => {
              if (!late.h || !options.restore) throw new Error("no harness");
              return options.restore(late.h);
            },
          }
        : undefined,
    });
    late.h = h;
    handlelessRecord(h, "app-1", { worktree: options.worktree, extra: OTHER_CLAIM });
    fsFault.noStartTime = true;
    return h;
  }

  function expectAsBefore(h: Harness): void {
    const record = h.record("app-1");
    expect(record).not.toHaveProperty("runtimeHandle");
    expect(record?.["restoredAt"]).toBe(OLD_RESTORED_AT);
    expect({
      launchPid: record?.["launchPid"],
      launchPidStart: record?.["launchPidStart"],
    }).toEqual(OTHER_CLAIM);
    expect(warnings.filter((line) => line.includes("could not write back"))).toEqual([]);
  }

  it("T-4.19a: the workspace restore throws; the record as before, the dead claim kept", async () => {
    const h = await claimless({
      worktree: false,
      restore: async () => {
        throw new Error("git worktree add failed");
      },
    });
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("WorkspaceMissingError");
    expect((err as Error).message).toContain("restore failed: git worktree add failed");
    expectAsBefore(h);
    expect(herdr.calls).toEqual([]);
  });

  it("T-4.19b: step 9 answers Q1; the record as before, nothing created", async () => {
    const h = await claimless({ worktree: true });
    herdr.on["workspace create"] = async () => {
      throw q1(SOCKET, "cli:workspace:create");
    };
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(err).toMatchObject({ herdrCode: "server_not_running" });
    expectAsBefore(h);
    expect(herdr.workspaces.size).toBe(0);
  });

  it("T-4.19c: a later claim during the workspace restore; no write-back, one warning", async () => {
    let later = "";
    const h = await claimless({
      worktree: false,
      restore: async (harness) => {
        updateMetadata(harness.sessionsDir, "app-1", LATER_CLAIM);
        later = harness.file("app-1");
        throw new Error("git worktree add failed");
      },
    });
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect((err as Error).name).toBe("WorkspaceMissingError");
    expect(h.file("app-1")).toBe(later);
    expect(h.record("app-1")?.["runtimeHandle"]).toBe(PENDING);
    expect(h.record("app-1")).toMatchObject(LATER_CLAIM);
    expect(warnings.filter((line) => line.includes("could not write back"))).toEqual([WRITE_BACK]);
  });

  it("T-4.19d: a later claim during the create, then Q1; no write-back, one warning", async () => {
    let later = "";
    const h = await claimless({ worktree: true });
    herdr.on["workspace create"] = async () => {
      updateMetadata(h.sessionsDir, "app-1", LATER_CLAIM);
      later = h.file("app-1");
      throw q1(SOCKET, "cli:workspace:create");
    };
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(err).toMatchObject({ herdrCode: "server_not_running" });
    expect(h.file("app-1")).toBe(later);
    expect(h.record("app-1")?.["runtimeHandle"]).toBe(PENDING);
    expect(warnings.filter((line) => line.includes("could not write back"))).toEqual([WRITE_BACK]);
  });
});

/** Arm `fault` for the first record write after the create (its last call is `pane get`). */
function afterCreate(fault: () => void): void {
  herdr.on["pane get"] = async (_args, answer) => {
    const out = await answer();
    herdr.on["pane get"] = undefined;
    fsFault.arm();
    fault();
    return out;
  };
}

/** Arm `fault` when `pane run` fails after its admission (a partial create). */
function afterPartialRun(fault: () => void): void {
  runFails(() => {
    fsFault.arm();
    fault();
    return herdrTimeout("herdr pane run");
  });
}

const ORCH = "app-orchestrator-1";

async function residentRestore(agent?: Partial<Agent>) {
  const h = await setup({ shape: "oc", mode: "isolated", agent });
  const worktree = handlelessRecord(h, ORCH, { extra: { opencodeSessionId: AGENT_SESSION } });
  const recordFile = h.watch(ORCH);
  return { h, worktree, recordFile };
}

function renamesLogged(): string[] {
  return fsFault.log.filter((entry) => entry.startsWith("rename"));
}

const BY_HAND =
  'Check the runtime by hand (design 5.4.3), then retire the record by hand (docs/DEVELOPMENT.md, "Retire a Herdr record by hand").';

describe("Herdr fit-2 F-4: the publication rule at restore step 10 (T-4.20a to T-4.20e)", () => {
  it("T-4.20a: one write throws before its effect; the strict read, one retry, then success", async () => {
    const { h } = await residentRestore();
    afterCreate(() => fsFault.renames.push("before"));
    const restored = await h.sm.restore(ORCH);
    const record = h.record(ORCH);
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    expect(renamesLogged().slice(0, 2)).toEqual(["rename:before", "rename"]);
    expect(await killError(h, ORCH)).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect(warnings).toEqual([]);
  });

  it("T-4.20b: the partial write throws once; the retry writes it, then the claim is settled", async () => {
    const { h, worktree } = await residentRestore();
    afterPartialRun(() => fsFault.renames.push("before"));
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = h.record(ORCH);
    expect(handleOf(record)).toMatchObject({
      id: "w7:p1",
      data: { createIncomplete: "launch-unconfirmed" },
    });
    expect(record?.["launchFailed"]).toMatch(/^Failed to launch agent in herdr pane w7:p1/);
    expect(record).not.toHaveProperty("launchPid");
    expect(renamesLogged().slice(0, 2)).toEqual(["rename:before", "rename"]);
    expect(existsSync(worktree)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("T-4.20c: every write fails from step 10 on; the warning 'not settled', P and the claim stay", async () => {
    const { h, worktree, recordFile } = await residentRestore();
    afterCreate(() => (fsFault.renameAlways = true));
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    fsFault.renameAlways = false;
    expect((err as Error).message).toBe(
      `the restore of ${ORCH} created herdr pane w7:p1 (workspace w7, socket ${SOCKET}); ` +
        `AO could not confirm that its record holds it: EIO: i/o error, rename '${recordFile}'`,
    );
    const record = h.record(ORCH);
    expect(record?.["runtimeHandle"]).toBe(PENDING);
    expect(ownClaimOf(record)).toBe(true);
    expect(warnings).toHaveLength(1);
    const warning = warnings[0];
    expect(warning).toBe(
      `ao: the record of ${ORCH} could not be read or written (EIO: i/o error, rename '${recordFile}'), so AO removed nothing: ` +
        "no runtime stop, no agent-session discard, no workspace removal and no record removal. " +
        `The handle of this launch: herdr pane w7:p1 (terminal term_w7, workspace w7, socket ${SOCKET}); ` +
        `record file ${recordFile}; worktree ${worktree}; agent session ${AGENT_SESSION}. ` +
        `The launch claim of ao process ${process.pid} (start ${record?.["launchPidStart"]}) may remain in the record, ` +
        "and the record may hold the pending handle or the handle above. While that process runs, AO treats the launch " +
        `as in progress, and ao start and kill refuse it. Check runtimeHandle, restoredAt, launchPid and launchPidStart in ${recordFile} ` +
        `before you retire the record. ${BY_HAND}`,
    );
    expect(warning).not.toMatch(/another launch/);
    expect(await killError(h, ORCH)).toBeInstanceOf(SessionLaunchInProgressError);
    expect(existsSync(worktree)).toBe(true);
    expectNoClose();
  });

  it("T-4.20d: the write and its retry fail; the settlement on 'before' clears the claim", async () => {
    const { h, recordFile } = await residentRestore();
    afterCreate(() => fsFault.renames.push("before", "before"));
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/AO could not confirm that its record holds it/);
    const record = h.record(ORCH);
    expect(record?.["runtimeHandle"]).toBe(PENDING);
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      "AO cleared its launch claim while the record held this launch's state before the write (the pending handle). " +
        `The handle above is not recorded. ${BY_HAND}`,
    );
    expect(warnings[0]).toContain(`record file ${recordFile}`);
    expect(renamesLogged()).toEqual(["rename:before", "rename:before", "rename"]);
  });

  it("T-4.20e (1): the write throws and the record is replaced before the read: not own", async () => {
    const { h, worktree } = await residentRestore();
    let replaced = "";
    afterCreate(() => {
      fsFault.renames.push("before");
      fsFault.onRead = (n) => {
        if (n === 2) replaced = replaceWithReservation(h, ORCH);
      };
    });
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /its runtime herdr w7:p1 was kept because the record now there may own that runtime name/,
    );
    expect(h.file(ORCH)).toBe(replaced);
    expect(renamesLogged()).toEqual(["rename:before", "rename"]);
    expect(existsSync(worktree)).toBe(true);
    expectNoClose();
  });

  it("T-4.20e (2): the write takes effect, then throws; the read shows 'after', no retry", async () => {
    const { h } = await residentRestore();
    afterCreate(() => fsFault.renames.push("after"));
    const restored = await h.sm.restore(ORCH);
    const record = h.record(ORCH);
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    // The publication once, then the settlement of step 12.
    expect(renamesLogged()).toEqual(["rename:after", "rename"]);
    expect(warnings).toEqual([]);
  });
});

describe("Herdr fit-2 F-4: the handle publication of spawn and start (T-4.20f, T-4.20g)", () => {
  function expectLaunched(h: Harness, id: string, handle: RuntimeHandle | null | undefined): void {
    const record = h.record(id);
    expect(handleOf(record)).toEqual(handle);
    expect(record).not.toHaveProperty("launchFailed");
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    expect(h.destroys).toEqual([]);
    expect(warnings).toEqual([]);
  }

  it("T-4.20f (1): spawn; the handle write throws before its effect; the retry writes", async () => {
    const h = await setup();
    h.watch("app-1");
    afterCreate(() => fsFault.renames.push("before"));
    const session = await h.sm.spawn({ projectId: "my-app" });
    expectLaunched(h, "app-1", session.runtimeHandle);
    expect(renamesLogged().slice(0, 2)).toEqual(["rename:before", "rename"]);
  });

  it("T-4.20f (2): spawn; the handle write takes effect, then throws; no retry", async () => {
    const h = await setup();
    h.watch("app-1");
    afterCreate(() => fsFault.renames.push("after"));
    const session = await h.sm.spawn({ projectId: "my-app" });
    expectLaunched(h, "app-1", session.runtimeHandle);
    // The publication once, the settlement, then today's promptDelivered write.
    expect(renamesLogged()).toEqual(["rename:after", "rename", "rename"]);
  });

  it("T-4.20f (3): start in isolated mode; the handle write throws before its effect", async () => {
    const h = await setup({ mode: "isolated" });
    h.watch(ORCH);
    afterCreate(() => fsFault.renames.push("before"));
    const session = await h.sm.spawnOrchestrator({ projectId: "my-app" });
    expectLaunched(h, ORCH, session.runtimeHandle);
    expect(renamesLogged().slice(0, 2)).toEqual(["rename:before", "rename"]);
  });

  for (const run of ["(i) another claim pair", "(ii) this process's claim pair"] as const) {
    it(`T-4.20g ${run}: a replacement that differs only in restoredAt is not own`, async () => {
      const h = await setup();
      h.watch("app-1");
      let replaced = "";
      afterCreate(() => {
        fsFault.renames.push("before");
        fsFault.onRead = (n) => {
          if (n !== 2) return;
          const failed = parseRecord(fsFault.lastFailedContent);
          replaced = writeRecord(h, "app-1", {
            worktree: failed["worktree"] ?? "",
            branch: failed["branch"] ?? "",
            status: "spawning",
            tmuxName: failed["tmuxName"] ?? "",
            createdAt: failed["createdAt"] ?? "",
            runtimeHandle: failed["runtimeHandle"] ?? "",
            restoredAt: "2026-10-23T00:00:01.000Z",
            ...(run.startsWith("(i)")
              ? OTHER_CLAIM
              : {
                  launchPid: failed["launchPid"] ?? "",
                  launchPidStart: failed["launchPidStart"] ?? "",
                }),
          });
        };
      });
      const err = await spawnError(h);
      expect((err as Error).message).toMatch(
        /^Session app-1 changed while the spawn started its runtime/,
      );
      expect(h.file("app-1")).toBe(replaced);
      expect(renamesLogged()).toEqual(["rename:before", "rename"]);
      expect(existsSync(join(h.worktreeDir, "my-app", "app-1"))).toBe(true);
      expect(h.destroys).toEqual([]);
      expectNoClose();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("its record was replaced");
      expect(warnings[0]).toContain(
        `herdr pane w7:p1 (terminal term_w7, workspace w7, socket ${SOCKET})`,
      );
    });
  }
});

describe("Herdr fit-2 F-4: undecided attempts and their strict reads (T-4.21a to T-4.21e)", () => {
  it("T-4.21a: the retry takes effect, then throws; the second read shows 'after'", async () => {
    const { h } = await residentRestore();
    afterCreate(() => fsFault.renames.push("before", "after"));
    const restored = await h.sm.restore(ORCH);
    const record = h.record(ORCH);
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    expect(renamesLogged()).toEqual(["rename:before", "rename:after", "rename"]);
    expect(warnings).toEqual([]);
  });

  it("T-4.21b: the partial retry takes effect, then throws; the claim settled on the new identity", async () => {
    const { h, worktree } = await residentRestore();
    afterPartialRun(() => fsFault.renames.push("before", "after"));
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = h.record(ORCH);
    expect(handleOf(record).data["createIncomplete"]).toBe("launch-unconfirmed");
    expect(record?.["launchFailed"]).toMatch(/^Failed to launch agent in herdr pane w7:p1/);
    expect(record).not.toHaveProperty("launchPid");
    expect(renamesLogged()).toEqual(["rename:before", "rename:after", "rename"]);
    expect(existsSync(worktree)).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("T-4.21c: spawn; the rollback's partial retry takes effect, then throws; a kept failed launch", async () => {
    const h = await setup();
    h.watch("app-1");
    afterPartialRun(() => fsFault.renames.push("before", "after"));
    const err = await spawnError(h);
    expect(err).toMatchObject({ stage: "launch-unconfirmed" });
    const record = h.record("app-1");
    expect(handleOf(record).data["createIncomplete"]).toBe("launch-unconfirmed");
    expect(record?.["launchFailed"]).toContain("runtime stop unconfirmed (unknown)");
    expect(record).not.toHaveProperty("launchPid");
    expect(renamesLogged()).toEqual(["rename:before", "rename:after", "rename", "rename"]);
    expect(existsSync(record?.["worktree"] ?? "")).toBe(true);
    expect(h.destroys).toEqual([]);
    expectNoClose();
  });

  it("T-4.21d: an uncertain null while the record is still own; the strict read, then the retry", async () => {
    const { h } = await residentRestore();
    afterCreate(() => (fsFault.dirFalse = 1));
    const restored = await h.sm.restore(ORCH);
    const record = h.record(ORCH);
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    expect(fsFault.log.slice(0, 5)).toEqual(["dir", "read", "dir", "read", "rename"]);
    expect(warnings).toEqual([]);
  });

  it("T-4.21d control: a null because the record was replaced first is not own", async () => {
    const { h } = await residentRestore();
    let replaced = "";
    afterCreate(() => {
      replaced = replaceWithReservation(h, ORCH);
      fsFault.arm();
    });
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /was kept because the record now there may own that runtime name/,
    );
    expect(h.file(ORCH)).toBe(replaced);
    expect(renamesLogged()).toEqual([]);
  });

  it("T-4.21e (1): unwritable with last read unknown; the settlement on 'after' clears the claim", async () => {
    const { h, worktree } = await residentRestore();
    afterCreate(() => {
      fsFault.renames.push("before", "after");
      fsFault.failReads = [4];
    });
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /AO could not confirm that its record holds it: EIO: i\/o error, open/,
    );
    const record = h.record(ORCH);
    expect(handleOf(record).id).toBe("w7:p1");
    expect(record).not.toHaveProperty("launchPid");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      `The record holds the handle above: the write took effect although it threw. AO cleared its launch claim. ${BY_HAND}`,
    );
    expect(renamesLogged()).toEqual(["rename:before", "rename:after", "rename"]);
    expect(existsSync(worktree)).toBe(true);
    expectNoClose();
  });

  it("T-4.21e (2): both attempts fail and a replacement comes before the second read: not own", async () => {
    const { h, worktree } = await residentRestore();
    let replaced = "";
    afterCreate(() => {
      fsFault.renames.push("before", "before");
      fsFault.onRead = (n) => {
        if (n === 4) replaced = replaceWithReservation(h, ORCH);
      };
    });
    const err = await h.sm.restore(ORCH).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(
      /was kept because the record now there may own that runtime name/,
    );
    expect(h.file(ORCH)).toBe(replaced);
    expect(renamesLogged()).toEqual(["rename:before", "rename:before", "rename"]);
    expect(existsSync(worktree)).toBe(true);
    expect(warnings).toEqual([]);
  });
});

describe("Herdr fit-2 F-4: the ordinary settlement after an uncertain null (r11 check m-2)", () => {
  it("the first claim clear answers null; one strict read, one retry, no claim left", async () => {
    const { h } = await residentRestore({
      postLaunchSetup: async () => {
        // Step 11 writes nothing; the next record call is the step-12 clear.
        fsFault.arm();
        fsFault.dirFalse = 1;
      },
    });
    const restored = await h.sm.restore(ORCH);
    const log = [...fsFault.log];
    const record = h.record(ORCH);
    expect(handleOf(record)).toEqual(restored.runtimeHandle);
    expect(record).not.toHaveProperty("launchPid");
    expect(record).not.toHaveProperty("launchPidStart");
    // The null, exactly one strict read, the retry (its own check and write).
    expect(log).toEqual(["dir", "read", "dir", "read", "rename"]);
    expect(warnings).toEqual([]);
    const err = await killError(h, ORCH);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect(err).not.toBeInstanceOf(SessionLaunchInProgressError);
  });

  it("control: a later claim pair before the read; the record byte-equal, no retry", async () => {
    let later = "";
    const late: { h?: Harness } = {};
    const { h } = await residentRestore({
      postLaunchSetup: async () => {
        fsFault.arm();
        fsFault.dirFalse = 1;
        fsFault.onRead = (n) => {
          if (n !== 1 || !late.h) return;
          updateMetadata(late.h.sessionsDir, ORCH, LATER_CLAIM);
          later = late.h.file(ORCH);
        };
      },
    });
    late.h = h;
    await h.sm.restore(ORCH);
    expect(h.file(ORCH)).toBe(later);
    // Only the control's own write renamed the record.
    expect(renamesLogged()).toEqual(["rename"]);
    expect(warnings).toEqual([]);
  });
});
