/**
 * Herdr fit-2 (design development/reviews/herdr_fit2_design_r11_opus.md
 * sections 4.6 and 5.2.4 step 7; fit-2a commit 4): every probe and stop of an
 * old record goes through the runtime of its handle (`runtimeForHandle`). A
 * runtime in LAUNCH_END_UNPROVEN_RUNTIMES that is not loaded gives no
 * runtime: no other runtime answers for it (unknown, or no probe). Restore
 * refuses a damaged handle that names herdr, or that a Herdr project stored.
 * Through the built core with the real runtime-herdr plugin (or none) and a
 * tmux stand-in that records each call with its handle. Startup keeps fit-1's
 * interim refusal until fit-2b (design 8.1, T-7.8a).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as ChildProcess from "node:child_process";

const herdr = vi.hoisted(() => ({
  bin: "",
  calls: [] as string[][],
  /** The answer of `pane get`: a rejection to throw, or a pane to answer. */
  paneGet: null as unknown,
}));

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
        if (args[0] === "pane" && args[1] === "get" && herdr.paneGet instanceof Error) {
          throw herdr.paneGet;
        }
        if (args[0] === "pane" && args[1] === "get") {
          return {
            stdout: JSON.stringify({ id: "cli:pane:get", result: herdr.paneGet }),
            stderr: "",
          };
        }
        throw new Error(`unexpected herdr call: ${args.join(" ")}`);
      }
      if (cmd === "herdr" || cmd === "tmux") {
        throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
      }
      return promisify(actual.execFile)(cmd, args, ...(rest as [ChildProcess.ExecFileOptions]));
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeStopUnconfirmedError,
  createSessionManager,
  deleteMetadata,
  getSessionsDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
  type Workspace,
} from "@aoagents/ao-core";
import { create } from "../index.js";
import { herdrCliFailure } from "./herdr-fixtures.js";

const HERDR_HANDLE: RuntimeHandle = {
  id: "w3:p2",
  runtimeName: "herdr",
  data: { workspaceId: "w3", paneId: "w3:p2", terminalId: "term_a" },
};
/** A handle text that does not parse, but names herdr. */
const DAMAGED_HERDR = '{"id":"w3:p2","runtimeName":"herdr","data":{"workspaceId":"w3"';
/** A handle text that does not parse and does not name herdr. */
const DAMAGED_OTHER = '{"id":"app-1","runtimeName":"tm';

const PANE_NOT_FOUND = () =>
  herdrCliFailure("herdr pane get w3:p2", "cli:pane:get", "pane_not_found", "pane w3:p2 not found");

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-fit2-startup-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  herdr.calls = [];
  herdr.paneGet = PANE_NOT_FOUND();
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  herdr.bin = join(binDir, "herdr");
  writeFileSync(herdr.bin, "");
  chmodSync(herdr.bin, 0o755);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

interface StandInCall {
  method: string;
  handle?: RuntimeHandle;
}

/** A tmux stand-in that records each call with its handle and answers isAlive false. */
function tmuxStandIn(): { runtime: Runtime; calls: StandInCall[] } {
  const calls: StandInCall[] = [];
  const runtime = {
    name: "tmux",
    create: async (config: { sessionId: string }) => {
      calls.push({ method: "create" });
      return { id: config.sessionId, runtimeName: "tmux", data: {} };
    },
    destroy: async (handle: RuntimeHandle) => {
      calls.push({ method: "destroy", handle });
    },
    isAlive: async (handle: RuntimeHandle) => {
      calls.push({ method: "isAlive", handle });
      return false;
    },
    sendMessage: async (handle: RuntimeHandle) => {
      calls.push({ method: "sendMessage", handle });
    },
    getOutput: async (handle: RuntimeHandle) => {
      calls.push({ method: "getOutput", handle });
      return "";
    },
  } as unknown as Runtime;
  return { runtime, calls };
}

interface Harness {
  sm: ReturnType<typeof createSessionManager>;
  sessionsDir: string;
  projectPath: string;
  tmuxCalls: StandInCall[];
  workspaceCalls: string[];
  file(id: string): string;
  dir(): string[];
}

function setup(options: {
  selects: "tmux" | "herdr";
  herdrLoaded: boolean;
  mode?: "project" | "isolated";
  strategy?: "reuse" | "delete";
}): Harness {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: options.selects, agent: "stand-in", workspace: "stand-in", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "stand-in",
        runtime: options.selects,
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

  const tmux = tmuxStandIn();
  const runtimes: Record<string, Runtime> = { tmux: tmux.runtime };
  if (options.herdrLoaded) runtimes["herdr"] = create({ binPath: herdr.bin });
  const workspaceCalls: string[] = [];
  const workspace = {
    name: "stand-in",
    create: async () => {
      workspaceCalls.push("create");
      throw new Error("unexpected workspace create");
    },
    destroy: async (path: string) => {
      workspaceCalls.push(`destroy ${path}`);
    },
    exists: async (path: string) => existsSync(path),
    restore: async () => {
      workspaceCalls.push("restore");
      throw new Error("unexpected workspace restore");
    },
    list: async () => [],
  } as unknown as Workspace;
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "true",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async () => null,
    isProcessRunning: async () => false,
    getSessionInfo: async () => null,
  } as unknown as Agent;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string, name: string) => {
      if (slot === "runtime") return runtimes[name] ?? null;
      if (slot === "agent") return agent;
      if (slot === "workspace") return workspace;
      return null;
    }),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;
  return {
    sm: createSessionManager({ config, registry }),
    sessionsDir,
    projectPath,
    tmuxCalls: tmux.calls,
    workspaceCalls,
    file: (id: string) => readFileSync(join(sessionsDir, id), "utf-8"),
    dir: () => readdirSync(sessionsDir).sort(),
  };
}

/** A record of `id` with the given handle text (a worker, or the orchestrator role). */
function writeRecord(h: Harness, id: string, runtimeHandle: string, status = "killed"): string {
  const worktree = join(root, "worktrees", id);
  mkdirSync(worktree, { recursive: true });
  writeMetadata(h.sessionsDir, id, {
    worktree,
    branch: id.includes("orchestrator") ? "main" : `session/${id}`,
    status,
    project: "my-app",
    agent: "stand-in",
    createdAt: "2026-10-01T00:00:00.000Z",
    runtimeHandle,
    ...(id.includes("orchestrator") ? { role: "orchestrator" } : {}),
  });
  return worktree;
}

/**
 * A record's text without the keys of today's repair on read of an
 * orchestrator record (it adds `prAutoDetect=off` and a generation), so that
 * "unchanged" means no write of the operation under test.
 */
function withoutReadRepair(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.startsWith("generation=") && !line.startsWith("prAutoDetect="))
    .join("\n");
}

function tmuxCallsWithHerdrHandle(h: Harness): StandInCall[] {
  return h.tmuxCalls.filter((call) => call.handle?.runtimeName === "herdr");
}

const CANNOT_TELL =
  "Cannot tell whether session app-orchestrator is alive, so it is neither reused nor replaced. Check the runtime and retry.";

describe("T-7.8a: the start probes an old Herdr record through herdr (fit-1's interim refusal)", () => {
  for (const strategy of ["reuse", "delete"] as const) {
    it(`(1) herdr loaded, its pane answers pane_not_found; strategy ${strategy}`, async () => {
      const h = setup({ selects: "tmux", herdrLoaded: true, strategy });
      writeRecord(h, "app-orchestrator", JSON.stringify(HERDR_HANDLE), "working");
      const before = h.file("app-orchestrator");
      const entries = h.dir();
      await expect(h.sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(CANNOT_TELL);
      expect(herdr.calls).toEqual([["pane", "get", "w3:p2"]]);
      expect(h.tmuxCalls).toEqual([]);
      expect(h.file("app-orchestrator")).toBe(before);
      expect(h.dir()).toEqual(entries);
    });

    it(`(2) no herdr plugin loaded: unknown with zero runtime calls; strategy ${strategy}`, async () => {
      const h = setup({ selects: "tmux", herdrLoaded: false, strategy });
      writeRecord(h, "app-orchestrator", JSON.stringify(HERDR_HANDLE), "working");
      const before = h.file("app-orchestrator");
      const entries = h.dir();
      const err = await h.sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
      expect((err as Error).message).toBe(CANNOT_TELL);
      expect(((err as Error).cause as Error).message).toBe("no runtime plugin herdr is loaded");
      expect(herdr.calls).toEqual([]);
      expect(h.tmuxCalls).toEqual([]);
      expect(h.file("app-orchestrator")).toBe(before);
      expect(h.dir()).toEqual(entries);
    });
  }

  it("(3) herdr loaded, its pane alive; strategy delete: the stop goes through herdr and refuses", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: true, strategy: "delete" });
    herdr.paneGet = {
      pane: { pane_id: "w3:p2", terminal_id: "term_a", agent: "stand-in", agent_status: "idle" },
    };
    writeRecord(h, "app-orchestrator", JSON.stringify(HERDR_HANDLE), "working");
    const before = h.file("app-orchestrator");
    const entries = h.dir();
    const err = await h.sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toMatch(
      /^runtime stop unconfirmed \(unknown\): the Herdr close cannot yet check the terminal .*; its record kept; no second orchestrator was started$/,
    );
    // The probe, and no herdr call for the stop (it closes nothing).
    expect(herdr.calls).toEqual([["pane", "get", "w3:p2"]]);
    expect(h.tmuxCalls).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
    expect(h.file("app-orchestrator")).toBe(before);
    expect(h.dir()).toEqual(entries);
  });
});

describe("T-7.8c: restore of a Herdr record while the project selects tmux", () => {
  it("refuses at step 7 with herdr's unknown; zero tmux calls, nothing created", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: true });
    writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE));
    const before = h.file("app-1");
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toMatch(
      /^runtime stop unconfirmed \(unknown\): the Herdr close cannot yet check the terminal/,
    );
    expect(h.tmuxCalls).toEqual([]);
    expect(h.workspaceCalls).toEqual([]);
    expect(herdr.calls.every((args) => args[0] === "pane" && args[1] === "get")).toBe(true);
    expect(h.file("app-1")).toBe(before);
  });
});

describe("T-7.8d: kill and list with a Herdr handle while no herdr plugin is loaded", () => {
  it("kill refuses with 'no runtime plugin herdr is loaded'; nothing removed", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: false });
    const worktree = writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE));
    const before = h.file("app-1");
    const err = await h.sm.kill("app-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toBe(
      "runtime stop unconfirmed (unknown): no runtime plugin herdr is loaded; record and worktree kept",
    );
    expect(h.file("app-1")).toBe(before);
    expect(existsSync(worktree)).toBe(true);
    expect(h.dir()).toEqual(["app-1"]);
    expect(h.tmuxCalls).toEqual([]);
  });

  it("list keeps the stored status with zero calls of the project's runtime", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: false });
    writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE), "working");
    const [session] = await h.sm.list("my-app");
    expect(session?.status).toBe("working");
    expect(h.tmuxCalls).toEqual([]);
  });

  it("control: an unloaded mock-family handle; kill skips the stop and goes on, list uses tmux", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: false });
    const mockHandle = JSON.stringify({ id: "mock-1", runtimeName: "mock", data: {} });
    writeRecord(h, "app-1", mockHandle, "working");
    await h.sm.list("my-app");
    expect(h.tmuxCalls.map((call) => [call.method, call.handle?.runtimeName])).toEqual([
      ["isAlive", "mock"],
    ]);
    await h.sm.kill("app-1");
    expect(readMetadataRaw(h.sessionsDir, "app-1")).toBeNull();
    expect(h.tmuxCalls).toHaveLength(1);
  });
});

describe("T-7.8e: cleanup of a Herdr worker while the project selects tmux", () => {
  it("herdr loaded, its pane gone: the rule asks herdr, the kill refuses, the record kept", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: true });
    writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE), "working");
    const before = h.file("app-1");
    const result = await h.sm.cleanup("my-app");
    expect(tmuxCallsWithHerdrHandle(h)).toEqual([]);
    expect(h.tmuxCalls).toEqual([]);
    expect(herdr.calls.length).toBeGreaterThan(0);
    expect(herdr.calls.every((args) => args.join(" ") === "pane get w3:p2")).toBe(true);
    expect(result.killed).toEqual([]);
    expect(result.errors.map((entry) => entry.sessionId)).toEqual(["app-1"]);
    expect(result.errors[0]?.error).toMatch(/^kept: runtime stop unconfirmed \(unknown\)/);
    expect(h.file("app-1")).toBe(before);
  });

  it("no herdr plugin loaded: no probe for the record, no kill", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: false });
    writeRecord(h, "app-1", JSON.stringify(HERDR_HANDLE), "working");
    const before = h.file("app-1");
    const result = await h.sm.cleanup("my-app");
    expect(h.tmuxCalls).toEqual([]);
    expect(result.killed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual(["app-1"]);
    expect(h.file("app-1")).toBe(before);
  });
});

describe("T-7.26d: restore refuses a damaged handle that names herdr or that a Herdr project stored", () => {
  const cases: Array<[string, "tmux" | "herdr", string, string]> = [
    ["a worker on a Herdr project", "herdr", "app-1", DAMAGED_HERDR],
    ["an orchestrator on a Herdr project", "herdr", "app-orchestrator", DAMAGED_HERDR],
    ["a worker on a tmux project, the text names herdr", "tmux", "app-1", DAMAGED_HERDR],
    [
      "an orchestrator on a tmux project, the text names herdr",
      "tmux",
      "app-orchestrator",
      DAMAGED_HERDR,
    ],
    ["a worker on a Herdr project, the text names nothing", "herdr", "app-1", DAMAGED_OTHER],
  ];
  for (const [label, selects, id, text] of cases) {
    it(label, async () => {
      const h = setup({ selects, herdrLoaded: true });
      writeRecord(h, id, text);
      const before = h.file(id);
      const err = await h.sm.restore(id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
      expect((err as Error).message).toBe(
        `runtime stop unconfirmed (unknown): the runtime handle of ${id} cannot be read (${text.slice(0, 80)}); ` +
          "retire it by hand; nothing was restored: this restore did not change the record or the workspace, " +
          "and no new runtime was created",
      );
      // No transition write (the worker record is byte-equal).
      if (id.includes("orchestrator"))
        expect(withoutReadRepair(h.file(id))).toBe(withoutReadRepair(before));
      else expect(h.file(id)).toBe(before);
      expect(h.workspaceCalls).toEqual([]);
      expect(h.tmuxCalls).toEqual([]);
      expect(herdr.calls).toEqual([]);
    });
  }

  it("an archived record: refused, and the copy-back released as today", async () => {
    const h = setup({ selects: "herdr", herdrLoaded: true });
    writeRecord(h, "app-1", DAMAGED_HERDR);
    deleteMetadata(h.sessionsDir, "app-1", true);
    const archived = readdirSync(join(h.sessionsDir, "archive"));
    const err = await h.sm.restore("app-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeStopUnconfirmedError);
    expect((err as Error).message).toMatch(/the runtime handle of app-1 cannot be read/);
    expect(readMetadataRaw(h.sessionsDir, "app-1")).toBeNull();
    expect(readdirSync(join(h.sessionsDir, "archive"))).toEqual(archived);
    expect(h.workspaceCalls).toEqual([]);
    expect(herdr.calls).toEqual([]);
  });

  it("control: a tmux project and a damaged text that does not name herdr: today's skip, a tmux create", async () => {
    const h = setup({ selects: "tmux", herdrLoaded: true });
    writeRecord(h, "app-1", DAMAGED_OTHER);
    const restored = await h.sm.restore("app-1");
    expect(restored.runtimeHandle?.runtimeName).toBe("tmux");
    expect(h.tmuxCalls.map((call) => call.method)).toContain("create");
    expect(herdr.calls).toEqual([]);
  });
});
