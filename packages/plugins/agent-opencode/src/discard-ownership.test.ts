/**
 * Round 7 of the killed-status fix (review r5, M-3): the prepared-session
 * `discard` awaits an interrupt and tries the removal twice. Another AO
 * session can take the OpenCode session meanwhile (a new launch or a restore
 * of the same AO ID). The caller's ownership check runs directly before the
 * interrupt and before each removal attempt; a check that answers false or
 * throws keeps the session, and the operator gets one line that names it.
 *
 * The plugin and the session manager are real. The OpenCode API calls are
 * stand-ins (no `opencode` process runs), and so is the version probe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = vi.hoisted(() => ({
  interrupt: vi.fn(async (_id: string) => ({ interrupted: true }) as { interrupted: boolean }),
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  create: vi.fn(async () => ({ id: "ses_prepared", title: "AO:app-1" })),
  /** Runs inside the interrupt, as another process would act meanwhile. */
  duringInterrupt: null as null | (() => void),
  /** Runs inside each removal attempt; a throw fails that attempt. */
  duringRemove: null as null | ((attempt: number) => void),
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createOpenCodeSession: api.create,
    interruptOpenCodeSession: api.interrupt,
    removeOpenCodeSession: api.remove,
  };
});

// The version gate reads `opencode --version`; the stand-in answers a
// supported version. Every other child process fails the test.
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
  deleteMetadata,
  getSessionsDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type AgentLaunchConfig,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Workspace,
} from "@aoagents/ao-core";
import { create } from "./index.js";

let root: string;
let workspacePath: string;
let stderr: string[];
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-opencode-discard-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  workspacePath = join(root, "ws-app-1");
  mkdirSync(workspacePath, { recursive: true });
  api.duringInterrupt = null;
  api.duringRemove = null;
  api.interrupt.mockClear();
  api.remove.mockClear();
  api.create.mockClear();
  let attempts = 0;
  api.interrupt.mockImplementation(async () => {
    api.duringInterrupt?.();
    return { interrupted: true };
  });
  api.remove.mockImplementation(async () => {
    attempts += 1;
    api.duringRemove?.(attempts);
  });
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

function failFirstRemove(during: () => void = () => undefined): void {
  api.duringRemove = (attempt) => {
    if (attempt > 1) return;
    during();
    throw new Error("transient: the service restarted");
  };
}

const KEPT_LINE = /kept the OpenCode session ses_prepared that this spawn created/;

describe("prepared-session discard with an ownership check (round 7, M-3)", () => {
  async function prepared() {
    const config: AgentLaunchConfig = {
      sessionId: "app-1",
      projectConfig: {
        name: "My App",
        repo: "org/my-app",
        path: join(root, "my-app"),
        defaultBranch: "main",
        sessionPrefix: "app",
      },
    };
    const session = await create().prepareAgentSession!(config, {
      workspacePath,
      environment: { AO_SESSION: "app-1", PATH: "/usr/bin" },
    });
    expect(session.created).toBe(true);
    return session;
  }

  it("a new launch that names the session during the interrupt: no removal", async () => {
    const session = await prepared();
    let owner = "old";
    api.duringInterrupt = () => {
      owner = "new";
    };

    await session.discard(() => owner === "old");

    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(KEPT_LINE);
  });

  it("a new launch that names the session during a failed first removal: no second attempt", async () => {
    const session = await prepared();
    let owner = "old";
    failFirstRemove(() => {
      owner = "new";
    });

    await session.discard(() => owner === "old");

    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(stderr.join("")).toMatch(KEPT_LINE);
    expect(stderr.join("")).not.toMatch(/could not remove/);
  });

  it("a check that throws keeps the session: no interrupt, no removal", async () => {
    const session = await prepared();

    await expect(
      session.discard(() => {
        throw new Error("the record could not be read");
      }),
    ).resolves.toBeUndefined();

    expect(api.interrupt).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(
      /kept the OpenCode session ses_prepared .*the ownership check failed \(the record could not be read\)/,
    );
  });

  it("a check that throws before the second attempt keeps the session too", async () => {
    const session = await prepared();
    let checks = 0;
    failFirstRemove();

    await session.discard(() => {
      checks += 1;
      if (checks > 2) throw new Error("the record could not be read");
      return true;
    });

    expect(checks).toBe(3);
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(stderr.join("")).toMatch(KEPT_LINE);
  });

  it("control: nothing changes, the first removal fails and the second removes the session", async () => {
    const session = await prepared();
    let checks = 0;
    failFirstRemove();

    await session.discard(() => {
      checks += 1;
      return true;
    });

    expect(checks).toBe(3);
    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(stderr.join("")).toBe("");
  });

  it("a kept session is not marked discarded: a later discard decides again with its own check", async () => {
    const session = await prepared();

    await session.discard(() => false);
    expect(api.interrupt).not.toHaveBeenCalled();
    await session.discard(() => true);
    await session.discard(() => true);

    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledTimes(1);
  });
});

describe("spawn rollback through the session manager with the real OpenCode plugin (round 7, M-3)", () => {
  function setup() {
    const configPath = join(root, "agent-orchestrator.yaml");
    writeFileSync(configPath, "projects: {}\n");
    const projectPath = join(root, "my-app");
    mkdirSync(projectPath, { recursive: true });
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      defaults: { runtime: "mock", agent: "opencode", workspace: "mock-ws", notifiers: [] },
      projects: {
        "my-app": {
          name: "My App",
          repo: "org/my-app",
          path: projectPath,
          defaultBranch: "main",
          sessionPrefix: "app",
        },
      },
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
      readyThresholdMs: 300_000,
    };
    const sessionsDir = getSessionsDir(configPath, projectPath);
    mkdirSync(sessionsDir, { recursive: true });
    const runtime = {
      name: "mock",
      create: vi.fn(async () => ({ id: "rt-spawned", runtimeName: "mock", data: {} })),
      destroy: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => undefined),
      getOutput: vi.fn(async () => ""),
      isAlive: vi.fn(async () => true),
    } as unknown as Runtime;
    const workspace = {
      name: "mock-ws",
      create: vi.fn(async () => ({
        path: workspacePath,
        branch: "session/app-1",
        sessionId: "app-1",
        projectId: "my-app",
      })),
      destroy: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    } as unknown as Workspace;
    // The real plugin; no workspace hooks (they install PATH wrappers), and
    // a post-launch failure that sends the spawn into its rollback.
    const agent: Agent = {
      ...create(),
      setupWorkspaceHooks: undefined,
      postLaunchSetup: async () => {
        throw new Error("post-launch setup failed");
      },
    };
    const registry = {
      register: vi.fn(),
      get: vi.fn((slot: string) =>
        slot === "runtime"
          ? runtime
          : slot === "agent"
            ? agent
            : slot === "workspace"
              ? workspace
              : null,
      ),
      list: vi.fn(() => []),
      loadBuiltins: vi.fn(async () => undefined),
      loadFromConfig: vi.fn(async () => undefined),
    } as unknown as PluginRegistry;
    const sm = createSessionManager({ config, registry });
    return { sessionsDir, sm };
  }

  /** Another process archives app-1 and publishes a new launch that runs on ses_prepared. */
  function publishReplacement(sessionsDir: string): Record<string, string> {
    deleteMetadata(sessionsDir, "app-1", true);
    writeMetadata(sessionsDir, "app-1", {
      worktree: workspacePath,
      branch: "feat/new-launch",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_prepared",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-20T12:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "rt-new", runtimeName: "mock", data: {} }),
    });
    return readMetadataRaw(sessionsDir, "app-1")!;
  }

  it("review case A: a new launch on ses_prepared during the interrupt keeps it", async () => {
    const { sessionsDir, sm } = setup();
    let replacement: Record<string, string> | undefined;
    api.duringInterrupt = () => {
      replacement = publishReplacement(sessionsDir);
    };

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
    expect(stderr.join("")).toMatch(KEPT_LINE);
  });

  it("review case B: a new launch on ses_prepared during a failed first removal: no second attempt", async () => {
    const { sessionsDir, sm } = setup();
    let replacement: Record<string, string> | undefined;
    failFirstRemove(() => {
      replacement = publishReplacement(sessionsDir);
    });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
    expect(stderr.join("")).toMatch(KEPT_LINE);
  });

  it("control: nothing changes, the second attempt removes ses_prepared and the rollback ends", async () => {
    const { sessionsDir, sm } = setup();
    failFirstRemove();

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(api.remove).toHaveBeenLastCalledWith(
      "ses_prepared",
      expect.any(Number),
      expect.any(Object),
    );
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(stderr.join("")).not.toMatch(KEPT_LINE);
  });
});
