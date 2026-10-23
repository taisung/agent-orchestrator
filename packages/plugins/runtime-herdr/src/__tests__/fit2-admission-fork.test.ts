/**
 * Herdr fit-2 F-7 (design development/reviews/herdr_fit2_design_r11_opus.md
 * sections 4.9, 5.3.1 and 8, T-7.21, T-7.21c and D2-b; fit-2b commit 5): two
 * processes that start an orchestrator of one project at the same time admit
 * one launch. Each start runs the built core in its own Node process (a fork
 * of a script that this test writes into its temporary root), with a runtime
 * stand-in named `herdr` and a workspace stand-in that append each create to
 * one shared log file. The stages of the admission (`deps.admission.onStage`)
 * go to the test over IPC, and a start waits at the stages that the test
 * names until the test lets it go on. No real herdr runs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getSessionsDir } from "@aoagents/ao-core";

const CORE_URL = pathToFileURL(join(import.meta.dirname, "../../../../core/dist/index.js")).href;

/** The start that each fork runs: a project in isolated mode on the herdr stand-in. */
const CHILD = String.raw`
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
if (!process.env.AO_STATE_ROOT) {
  process.stderr.write("fit2b child: AO_STATE_ROOT is not set\n");
  process.exit(2);
}
const core = await import(process.env.FIT2B_CORE_URL);
const args = JSON.parse(process.env.FIT2B_ARGS);
const note = (line) => appendFileSync(args.log, args.label + " " + line + "\n");
const goes = new Map();
const arrived = new Set();
process.on("message", (message) => {
  const resolve = goes.get(message.go);
  if (resolve) {
    goes.delete(message.go);
    resolve();
  } else arrived.add(message.go);
});
const waitFor = (name) =>
  arrived.delete(name) ? Promise.resolve() : new Promise((resolve) => goes.set(name, resolve));
const send = (message) => process.send({ label: args.label, pid: process.pid, ...message });
const config = {
  configPath: args.configPath,
  port: 3000,
  readyThresholdMs: 300000,
  defaults: { runtime: "herdr", agent: "stand-in", workspace: "stand-in", notifiers: [] },
  projects: {
    "my-app": {
      name: "My App",
      repo: "org/my-app",
      path: args.projectPath,
      defaultBranch: "main",
      sessionPrefix: "app",
      agent: "stand-in",
      runtime: "herdr",
      workspace: "stand-in",
      orchestratorWorkspaceMode: "isolated",
    },
  },
  notifiers: {},
  notificationRouting: { urgent: [], action: [], warning: [], info: [] },
  reactions: {},
};
const runtime = {
  name: "herdr",
  async create(cfg) {
    // The runtime name is the config hash plus the session ID.
    note("runtime create " + cfg.sessionId.replace(/^[0-9a-f]{12}-/, ""));
    send({ stage: "runtime-create" });
    await waitFor("runtime-create");
    return { id: "w9:p1", runtimeName: "herdr", data: { terminalId: "term_w9" } };
  },
  async destroy() {},
  async stop() {
    return { outcome: "unknown", detail: "the stand-in stops nothing" };
  },
  async isAlive() {
    return true;
  },
  async sendMessage() {},
  async getOutput() {
    return "";
  },
};
const workspace = {
  name: "stand-in",
  async create(cfg) {
    note("workspace create " + cfg.sessionId);
    const path = join(args.root, "worktrees", args.label + "-" + cfg.sessionId);
    mkdirSync(path, { recursive: true });
    return { path, branch: cfg.branch, sessionId: cfg.sessionId, projectId: cfg.projectId };
  },
  async destroy() {},
  async exists() {
    return true;
  },
  async list() {
    return [];
  },
};
const agent = {
  name: "stand-in",
  processName: "stand-in",
  getLaunchCommand: () => "stand-in --run",
  getEnvironment: () => ({}),
  detectActivity: () => "idle",
  getActivityState: async () => null,
  isProcessRunning: async () => true,
  getSessionInfo: async () => null,
};
const registry = {
  register() {},
  get: (slot) => (slot === "runtime" ? runtime : slot === "agent" ? agent : slot === "workspace" ? workspace : null),
  list: () => [],
  loadBuiltins: async () => undefined,
  loadFromConfig: async () => undefined,
};
const sm = core.createSessionManager({
  config,
  registry,
  admission: {
    waitMs: args.waitMs,
    onStage: async (stage, info) => {
      send({ stage, selected: info.selected });
      if (args.pauseAt.includes(stage)) await waitFor(stage);
    },
  },
});
try {
  const session = await sm.spawnOrchestrator({ projectId: "my-app" });
  send({ result: "started", id: session.id });
} catch (err) {
  send({
    result: "refused",
    reason: err && err.reason,
    blocking: (err && err.blocking ? err.blocking : []).map((b) => [b.sessionId, b.kind, b.launcherPid]),
    message: String(err && err.message),
  });
}
process.disconnect();
`;

interface Message {
  label: string;
  pid: number;
  stage?: string;
  selected?: number;
  result?: "started" | "refused";
  id?: string;
  reason?: string;
  blocking?: Array<[string, string, number | undefined]>;
  message?: string;
}

interface Child {
  proc: ChildProcess;
  messages: Message[];
  /** Resolves with the first message that `test` accepts (also one that came before). */
  next(test: (m: Message) => boolean, timeoutMs?: number): Promise<Message | null>;
  go(stage: string): void;
  exited: Promise<number | null>;
}

let root: string;
let children: Child[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-fit2b-fork-"));
  children = [];
});

afterEach(() => {
  for (const child of children) {
    if (child.proc.exitCode === null && child.proc.signalCode === null) child.proc.kill("SIGKILL");
  }
  rmSync(root, { recursive: true, force: true });
});

interface Project {
  stateRoot: string;
  configPath: string;
  projectPath: string;
  sessionsDir: string;
  log: string;
}

/** A project under `root`; with `alias`, the state root lies below a symlink `alias` -> `real`. */
function project(options: { alias?: boolean } = {}): Project {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  let stateRoot = join(root, "state");
  if (options.alias) {
    mkdirSync(join(root, "real"), { recursive: true });
    symlinkSync(join(root, "real"), join(root, "alias"));
    stateRoot = join(root, "alias", "state");
  }
  const saved = process.env["AO_STATE_ROOT"];
  process.env["AO_STATE_ROOT"] = stateRoot;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  if (saved === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = saved;
  const log = join(root, "creates.log");
  writeFileSync(log, "");
  writeFileSync(join(root, "child.mjs"), CHILD);
  return { stateRoot, configPath, projectPath, sessionsDir, log };
}

function start(p: Project, label: string, options: { pauseAt?: string[]; waitMs?: number }): Child {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AO_") && key !== "NODE_OPTIONS" && !key.startsWith("VITEST"))
      env[key] = value;
  }
  env["AO_STATE_ROOT"] = p.stateRoot;
  env["FIT2B_CORE_URL"] = CORE_URL;
  env["FIT2B_ARGS"] = JSON.stringify({
    label,
    root,
    log: p.log,
    configPath: p.configPath,
    projectPath: p.projectPath,
    pauseAt: options.pauseAt ?? [],
    waitMs: options.waitMs ?? 10_000,
  });
  const proc = fork(join(root, "child.mjs"), [], {
    env,
    execArgv: [],
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const messages: Message[] = [];
  const listeners = new Set<(m: Message) => void>();
  proc.on("message", (m: Message) => {
    messages.push(m);
    for (const listener of listeners) listener(m);
  });
  const exited = new Promise<number | null>((resolve) => proc.on("exit", (code) => resolve(code)));
  const child: Child = {
    proc,
    messages,
    next(test, timeoutMs = 20_000) {
      const seen = messages.find(test);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          resolve(null);
        }, timeoutMs);
        const listener = (m: Message): void => {
          if (!test(m)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(m);
        };
        listeners.add(listener);
      });
    },
    go(stage) {
      if (proc.connected) proc.send({ go: stage });
    },
    exited,
  };
  children.push(child);
  return child;
}

const stage = (name: string) => (m: Message) => m.stage === name;
const result = (m: Message) => m.result !== undefined;

function creates(p: Project): string[] {
  return readFileSync(p.log, "utf-8").split("\n").filter(Boolean).sort();
}

function records(p: Project): string[] {
  return existsSync(p.sessionsDir)
    ? readdirSync(p.sessionsDir)
        .filter((name) => name !== "archive")
        .sort()
    : [];
}

describe("T-7.21: two simultaneous isolated starts in two processes", () => {
  it("exactly one reaches workspace create; the other is blocked in-progress (or busy)", async () => {
    const p = project();
    const one = start(p, "one", {});
    const two = start(p, "two", {});
    // The start that gets through waits in its runtime create until the
    // other one has its answer, so its claim is live while the other decides.
    const first = await Promise.race([
      one.next(result).then((m) => ["one", m] as const),
      two.next(result).then((m) => ["two", m] as const),
      one.next(stage("runtime-create")).then(() => ["one-create", null] as const),
      two.next(stage("runtime-create")).then(() => ["two-create", null] as const),
    ]);
    const winner = first[0] === "one" || first[0] === "two-create" ? two : one;
    const loser = winner === one ? two : one;
    const refused = await loser.next(result);
    winner.go("runtime-create");
    const started = await winner.next(result);
    expect(started).toMatchObject({ result: "started", id: "app-orchestrator-1" });
    expect(refused?.result).toBe("refused");
    if (refused?.reason === "records") {
      expect(refused.blocking).toEqual([["app-orchestrator-1", "in-progress", winner.proc.pid]]);
    } else {
      expect(refused?.reason).toBe("admission-busy");
    }
    const label = winner === one ? "one" : "two";
    expect(creates(p)).toEqual([
      `${label} runtime create app-orchestrator-1`,
      `${label} workspace create app-orchestrator-1`,
    ]);
    expect(records(p)).toEqual(["app-orchestrator-1"]);
    await Promise.all([one.exited, two.exited]);
  }, 60_000);
});

describe("T-7.21c: the first start under a symlinked parent", () => {
  it("one launch over both processes; process 2 waits for A and is blocked in-progress", async () => {
    const p = project({ alias: true });
    expect(existsSync(p.sessionsDir)).toBe(false);
    const one = start(p, "one", { pauseAt: ["before-reservation"] });
    expect(await one.next(stage("before-reservation"))).toMatchObject({ selected: 0 });
    // Process 1 holds A at before-reservation: the mkdir ran, no reservation yet.
    expect(existsSync(p.sessionsDir)).toBe(true);
    expect(records(p)).toEqual([]);
    const two = start(p, "two", { waitMs: 10_000 });
    expect(await two.next(stage("subject-fixed"))).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(two.messages.map((m) => m.stage)).not.toContain("lock-held");
    one.go("before-reservation");
    const answer = await two.next(result);
    one.go("runtime-create");
    expect(await one.next(result)).toMatchObject({ result: "started", id: "app-orchestrator-1" });
    expect(answer?.result).toBe("refused");
    if (answer?.reason === "records") {
      expect(answer.blocking).toEqual([["app-orchestrator-1", "in-progress", one.proc.pid]]);
    } else {
      expect(answer?.reason).toBe("admission-busy");
    }
    expect(two.messages.map((m) => m.stage)).not.toContain("before-reservation");
    expect(creates(p)).toEqual([
      "one runtime create app-orchestrator-1",
      "one workspace create app-orchestrator-1",
    ]);
    expect(records(p)).toEqual(["app-orchestrator-1"]);
    await Promise.all([one.exited, two.exited]);
  }, 60_000);
});

describe("D2-b: the schedule of T-7.21c with one more barrier (design r11 8)", () => {
  it("process 2 never reaches before-reservation while process 1 waits there; one launch", async () => {
    const p = project({ alias: true });
    const one = start(p, "one", { pauseAt: ["before-reservation"] });
    expect(await one.next(stage("before-reservation"))).toMatchObject({ selected: 0 });
    const two = start(p, "two", { pauseAt: ["before-reservation"], waitMs: 10_000 });
    // With distinct lock names (the r8 subject rule) process 2 reports
    // before-reservation with info.selected 0 here, and no record is on disk.
    const reached = await two.next(stage("before-reservation"), 1_500);
    const recordsWhileBothWait = records(p);
    one.go("before-reservation");
    if (reached) two.go("before-reservation");
    one.go("runtime-create");
    two.go("runtime-create");
    const answers = await Promise.all([one.next(result), two.next(result)]);
    await Promise.all([one.exited, two.exited]);
    expect({
      processTwoReachedTheBarrier: reached !== null,
      recordsWhileBothWait,
      results: answers.map((m) => [m?.label, m?.result, m?.reason ?? m?.id]),
      creates: creates(p),
      records: records(p),
    }).toEqual({
      processTwoReachedTheBarrier: false,
      recordsWhileBothWait: [],
      results: [
        ["one", "started", "app-orchestrator-1"],
        ["two", "refused", "records"],
      ],
      creates: ["one runtime create app-orchestrator-1", "one workspace create app-orchestrator-1"],
      records: ["app-orchestrator-1"],
    });
  }, 60_000);
});
