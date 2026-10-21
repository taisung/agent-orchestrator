/**
 * Defect test of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). It fails on ce49c9fd for
 * the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failure as a
 * plain test. Round R3 (the launch identity), item F-3 of review r7.
 *
 * F-3: issue reuse reads the stored mapping of another record, awaits
 * `session.get`, and only then writes the mapping into its own record
 * (session-manager.ts `resolveOpenCodeSessionReuse`, then the spawn's
 * `own.write`). A rollback whose holder check runs in that window finds no
 * holder and removes the session that the reusing spawn then stores.
 *
 * The plugin and the session manager (the built core) are real, and so are
 * the record files (a temporary directory). The OpenCode API calls are
 * stand-ins in the core module that runs them (no `opencode` process runs),
 * and so is the version probe (as in rollback-holders.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = vi.hoisted(() => ({
  interrupt: vi.fn(async (_id: string) => ({ interrupted: true }) as { interrupted: boolean }),
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  create: vi.fn(async () => ({ id: "ses_prepared", title: "AO:app-1" })),
  get: vi.fn(async (id: string) => ({ id, title: "AO:app-1" }) as { id: string } | null),
}));

vi.mock("../../../core/dist/opencode-api.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createOpenCodeSession: api.create,
    getOpenCodeSession: api.get,
    interruptOpenCodeSession: api.interrupt,
    removeOpenCodeSession: api.remove,
    getNewestOpenCodeUserMessage: vi.fn(async () => null),
  };
});

vi.mock("node:child_process", () => ({
  execFile: (cmd: string) => {
    throw new Error(`unexpected command: ${cmd}`);
  },
  execFileSync: (cmd: string, args: string[]) => {
    if (cmd === "opencode" && args[0] === "--version") return "opencode v2.0.29\n";
    throw new Error(`unexpected command: ${cmd}`);
  },
}));

import {
  createSessionManager,
  getSessionsDir,
  readMetadataRaw,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Session,
  type Workspace,
} from "@aoagents/ao-core";
import { create } from "./index.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-same-id-reuse-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  api.interrupt.mockClear();
  api.remove.mockClear();
  api.create.mockClear();
  api.get.mockReset();
  api.get.mockImplementation(async (id: string) => ({ id, title: "AO:app-1" }));
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

/**
 * A project with the real OpenCode plugin. The post-launch setup of app-1
 * awaits `beforeRollback` and then fails, so its rollback runs after it.
 */
function setup(beforeRollback: () => Promise<void>) {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: { runtime: "mock", agent: "opencode", workspace: "mock-ws", notifiers: [] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: projectPath,
        defaultBranch: "main",
        sessionPrefix: "app",
        agent: "opencode",
        runtime: "mock",
        workspace: "mock-ws",
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
  } as unknown as OrchestratorConfig;
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });
  const runtime = {
    name: "mock",
    create: vi.fn(async (cfg: { sessionId: string }) => ({
      id: `rt-${cfg.sessionId}`,
      runtimeName: "mock",
      data: {},
    })),
    destroy: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    getOutput: vi.fn(async () => ""),
    isAlive: vi.fn(async () => true),
  } as unknown as Runtime;
  const workspace = {
    name: "mock-ws",
    create: vi.fn(async (cfg: { sessionId: string }) => {
      const path = join(root, `ws-${cfg.sessionId}`);
      mkdirSync(path, { recursive: true });
      return { path, branch: `feat/${cfg.sessionId}`, sessionId: cfg.sessionId, projectId: "my-app" };
    }),
    destroy: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
  } as unknown as Workspace;
  const agent: Agent = {
    ...create(),
    setupWorkspaceHooks: undefined,
    postLaunchSetup: async (session: Session) => {
      if (session.id !== "app-1") return;
      await beforeRollback();
      throw new Error("post-launch setup failed");
    },
    confirmLaunch: async () => ({}),
  };
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) =>
      slot === "runtime" ? runtime : slot === "agent" ? agent : slot === "workspace" ? workspace : null,
    ),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;
  return { sessionsDir, sm: createSessionManager({ config, registry }) };
}

describe("[same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get", () => {
  defect("a rollback during another spawn's session.get does not remove the session that the spawn then stores", async () => {
    // The first `session.get` of ses_prepared after the trigger is the
    // reuse check of the second spawn: it waits until the test releases it.
    const gate: { armed: boolean; entered?: () => void; release?: () => void } = { armed: false };
    const entered = new Promise<void>((resolve) => (gate.entered = resolve));
    const released = new Promise<void>((resolve) => (gate.release = resolve));
    api.get.mockImplementation(async (id: string) => {
      if (gate.armed && id === "ses_prepared") {
        gate.armed = false;
        gate.entered?.();
        await released;
      }
      return { id, title: "AO:app-1" };
    });
    const second: { spawn?: Promise<Session> } = {};
    const { sessionsDir, sm } = setup(async () => {
      // app-1 runs on ses_prepared (it created it, for INT-1). A second
      // spawn for INT-1 selects that mapping and waits in session.get.
      gate.armed = true;
      second.spawn = sm.spawn({ projectId: "my-app", issueId: "INT-1" });
      await entered;
    });

    // app-1's post-launch setup fails; its rollback runs while app-2 waits.
    await expect(sm.spawn({ projectId: "my-app", issueId: "INT-1" })).rejects.toThrow(
      "post-launch setup failed",
    );
    gate.release?.();
    await second.spawn?.catch(() => undefined);

    const stored = readMetadataRaw(sessionsDir, "app-2")?.["opencodeSessionId"];
    const removed = api.remove.mock.calls.some(([id]) => id === "ses_prepared");
    // Measured: the rollback removed ses_prepared (no record named it yet),
    // and app-2 then stored it as its own session.
    expect(
      { app2Stores: stored ?? null, removed },
      "a record names an OpenCode session that the rollback removed",
    ).not.toEqual({ app2Stores: "ses_prepared", removed: true });
  });
});
