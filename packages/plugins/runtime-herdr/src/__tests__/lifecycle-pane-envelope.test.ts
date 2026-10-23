/**
 * Same-ID R4 round 4 (review r3, M-1), through the lifecycle manager (the
 * built core) with the real runtime-herdr plugin. herdr answers a pane only
 * inside a `result` object. Over two polls of one worker, a `pane get` body
 * with a top-level pane and no result object keeps app-1 `working`. On
 * c02c0c02 the plugin read that pane, its replaced terminal answered dead,
 * and the second poll wrote `killed`. The same replaced terminal inside a
 * result object and a lone `pane_not_found` are the controls: two polls
 * persist `killed`.
 *
 * Only `herdr` is a stand-in. app-2 (pane w7:p2) is live, so the poll is not
 * a probe outage, and the agent stand-in answers that its process runs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

const child = vi.hoisted(() => ({
  body: "",
  /** When set, app-1's `pane get` rejects with it (the 0.9.5 failure form). */
  rejection: null as Error | null,
  /** Every herdr call, as its argument list. */
  calls: [] as string[][],
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
      if (cmd === "herdr") child.calls.push(args);
      if (cmd === "herdr" && args[0] === "pane" && args[1] === "get") {
        if (args[2] === "w7:p2") {
          const pane = { pane_id: "w7:p2", terminal_id: "term_a" };
          return { stdout: JSON.stringify({ id: "cli:test", result: { pane } }), stderr: "" };
        }
        if (child.rejection) throw child.rejection;
        return { stdout: child.body, stderr: "" };
      }
      throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import {
  NO_SERVER_BOUND_MS,
  createLifecycleManager,
  createSessionManager,
  getSessionsDir,
  isHerdrProcessRunning,
  readMetadataRaw,
  readObservabilitySummary,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Session,
} from "@aoagents/ao-core";
import { create } from "../index.js";
import { herdrFixture, herdrRejection } from "./herdr-fixtures.js";

/** app-1's pane with a terminal that is not the one of its handle (term_a). */
const REPLACED = { pane_id: "w7:p1", terminal_id: "term_b" };

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-herdr-lifecycle-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  child.body = "";
  child.rejection = null;
  child.calls = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

/**
 * `withoutHandle`: app-3 has a record without a runtime handle, so core gives
 * it the session-name handle `app-3` (W-8). The stand-in agent reads its pane
 * through core `isHerdrProcessRunning`, as the retained agents do.
 */
function setup(options: { withoutHandle?: boolean } = {}) {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "herdr", agent: "stand-in", workspace: "worktree", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "stand-in",
        runtime: "herdr",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });

  // The real plugin; only its terminal output is a stand-in.
  const runtime: Runtime = { ...create(), getOutput: vi.fn(async () => "") };
  const agent = {
    name: "stand-in",
    processName: "stand-in",
    getLaunchCommand: () => "true",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async (session: Session) => {
      if (session.id === "app-3" && session.runtimeHandle) {
        const running = await isHerdrProcessRunning(session.runtimeHandle.id, /stand-in/);
        return { state: running ? "active" : "exited" };
      }
      return session.id === "app-2" ? { state: "active" } : null;
    },
    isProcessRunning: async () => true,
    getSessionInfo: async () => null,
  } as unknown as Agent;
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) => (slot === "runtime" ? runtime : slot === "agent" ? agent : null)),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;

  for (const [index, id] of ["app-1", "app-2"].entries()) {
    const worktree = join(root, id);
    mkdirSync(worktree);
    writeMetadata(sessionsDir, id, {
      project: "my-app",
      agent: "stand-in",
      status: "working",
      branch: "main",
      prAutoDetect: "off",
      worktree,
      createdAt: "2026-01-01T00:00:00.000Z",
      runtimeHandle: JSON.stringify({
        id: `w7:p${index + 1}`,
        runtimeName: "herdr",
        data: { terminalId: "term_a" },
      }),
    });
  }
  if (options.withoutHandle) {
    const worktree = join(root, "app-3");
    mkdirSync(worktree);
    writeMetadata(sessionsDir, "app-3", {
      project: "my-app",
      agent: "stand-in",
      status: "working",
      branch: "main",
      prAutoDetect: "off",
      worktree,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  }
  const sessionManager = createSessionManager({ config, registry });
  const lifecycle = createLifecycleManager({
    config,
    registry,
    sessionManager,
    projectId: "my-app",
  });
  return { config, sessionsDir, lifecycle, sessionManager };
}

/** Run `count` polls of one worker; each ends when the health record changes. */
async function poll(
  config: OrchestratorConfig,
  lifecycle: ReturnType<typeof createLifecycleManager>,
  count: number,
): Promise<void> {
  const health = () =>
    readObservabilitySummary(config).projects["my-app"]?.health["lifecycle.worker"];
  try {
    for (let i = 0; i < count; i++) {
      const before = health()?.correlationId;
      lifecycle.start(3_600_000);
      lifecycle.stop();
      await vi.waitFor(() => expect(health()?.correlationId).not.toBe(before), {
        timeout: 5_000,
        interval: 5,
      });
    }
  } finally {
    lifecycle.stop();
  }
}

describe("same-id R4 round 4 (review r3, M-1): the lifecycle with the real runtime-herdr plugin", () => {
  for (const [label, body] of [
    ["without a result (review r3)", { id: "cli:test", pane: REPLACED }],
    ["with a null result (review r3)", { id: "cli:test", result: null, pane: REPLACED }],
    ["with a scalar result (review r3)", { id: "cli:test", result: 12, pane: REPLACED }],
  ] as const) {
    it(`keeps app-1 working over two polls when herdr answers a top-level pane ${label}`, async () => {
      child.body = JSON.stringify(body);
      const { config, sessionsDir, lifecycle } = setup();
      await poll(config, lifecycle, 2);
      expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
    });
  }

  it("control: the same replaced terminal inside a result object gives app-1 killed after two polls", async () => {
    child.body = JSON.stringify({ id: "cli:test", result: { pane: REPLACED } });
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("runtime");
  });

  it("control: a lone pane_not_found error gives app-1 killed after two polls", async () => {
    child.body = JSON.stringify({
      id: "cli:test",
      error: { code: "pane_not_found", message: "Pane not found" },
    });
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 2);
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("runtime");
  });
});

// Herdr fit F-1 (W-1, W-6): herdr 0.9.5 answers `pane get` of a closed pane,
// and of a socket with no server, with exit 1 and one stderr line (the
// recorded answers of the live check). Before the fit, both rejections had no
// herdrCode and no no-server code, so every poll was a failed probe.
describe("Herdr fit F-1: the lifecycle reads the 0.9.5 failure form", () => {
  it("T-1.6: the 0.9.5 pane_not_found answer gives app-1 killed after two polls", async () => {
    child.rejection = herdrRejection(herdrFixture("closedpane_pane_get"));
    const { config, sessionsDir, lifecycle } = setup();
    await poll(config, lifecycle, 1);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");
    await poll(config, lifecycle, 1);
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("runtime");
    expect(readMetadataRaw(sessionsDir, "app-2")?.["status"]).toBe("working");
  });

  it("T-1.7: the 0.9.5 no-server answer keeps app-1 below NO_SERVER_BOUND_MS, then kills it (runtime)", async () => {
    child.rejection = herdrRejection(herdrFixture("noserver_never_pane_get"));
    const { sessionsDir, lifecycle } = setup();
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    vi.setSystemTime(start);

    await lifecycle.check("app-1");
    vi.setSystemTime(start + NO_SERVER_BOUND_MS - 1_000);
    await lifecycle.check("app-1");
    // An "ambiguous" negative would be killed here (second poll); a failed
    // probe would never be.
    expect(readMetadataRaw(sessionsDir, "app-1")?.["status"]).toBe("working");

    vi.setSystemTime(start + NO_SERVER_BOUND_MS);
    await lifecycle.check("app-1");
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record?.["status"]).toBe("killed");
    expect(record?.["killedReason"]).toBe("runtime");
  });
});

// Herdr fit F-2 (W-8, `badid_pane_process_info_session_name`): core gives a
// record without a handle the handle `{ id: <session name> }`. Before the fit,
// list() and the lifecycle called herdr with that name.
describe("Herdr fit F-2: a session-name handle makes no herdr call", () => {
  it("T-2.3: real core list() and one lifecycle poll make no herdr call for app-3, and keep its status", async () => {
    child.body = JSON.stringify({
      id: "cli:test",
      result: { pane: { pane_id: "w7:p1", terminal_id: "term_a" } },
    });
    const { config, sessionsDir, lifecycle, sessionManager } = setup({ withoutHandle: true });

    const listed = await sessionManager.list("my-app");
    expect(listed.find((s) => s.id === "app-3")?.status).toBe("working");
    await poll(config, lifecycle, 1);

    expect(child.calls.filter((args) => args.includes("app-3"))).toEqual([]);
    expect(readMetadataRaw(sessionsDir, "app-3")?.["status"]).toBe("working");
  });
});
