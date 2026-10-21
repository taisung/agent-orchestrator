/**
 * Round 8 of the killed-status fix (review r6, M-1 and M-2), through the
 * session manager with the real OpenCode plugin.
 *
 * M-1: a record that cannot be read is "unknown", never "no owner". A
 * replacement record that names the prepared session and becomes unreadable
 * during the interrupt keeps the session; a record that is unreadable before
 * the rollback keeps the runtime and the session too. M-2: issue reuse gives
 * the prepared session to another AO session (a second real `spawn` for the
 * same issue) while the rollback of the first spawn waits; the rollback then
 * keeps it, also during a failed first removal, and so does a holder in the
 * latest archive of another AO ID.
 *
 * Round 9 (review r7, M-1): an archive directory that cannot be checked (its
 * parent has mode 000, or `sessions/archive` is a symlink loop) is unknown,
 * not "no archives": the prepared session stays and core names it.
 *
 * The plugin and the session manager (the built core) are real, and so are
 * the files: an unreadable record is a real `chmod 000` of a file in the
 * test's temporary directory, restored before an assertion reads it. The
 * OpenCode API calls are stand-ins in the core module that runs them (no
 * `opencode` process runs), and so is the version probe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const api = vi.hoisted(() => ({
  interrupt: vi.fn(async (_id: string) => ({ interrupted: true }) as { interrupted: boolean }),
  remove: vi.fn(async (_id: string): Promise<void> => undefined),
  create: vi.fn(async () => ({ id: "ses_prepared", title: "AO:app-1" })),
  get: vi.fn(async (id: string) => ({ id, title: "AO:app-1" }) as { id: string } | null),
  /** Runs inside the interrupt, as another process would act meanwhile. */
  duringInterrupt: null as null | (() => void | Promise<void>),
  /** Runs inside each removal attempt; a throw fails that attempt. */
  duringRemove: null as null | ((attempt: number) => void | Promise<void>),
}));

// The core module that runs `opencode api`: both the session manager (issue
// reuse) and the plugin (through the core index) call these stand-ins.
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
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
  type Session,
  type Workspace,
} from "@aoagents/ao-core";
import { create } from "./index.js";

let root: string;
let stderr: string[];
let modes: Array<{ path: string; mode: number }>;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-opencode-holders-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  modes = [];
  api.duringInterrupt = null;
  api.duringRemove = null;
  api.interrupt.mockClear();
  api.remove.mockClear();
  api.create.mockClear();
  api.get.mockClear();
  let attempts = 0;
  api.interrupt.mockImplementation(async () => {
    await api.duringInterrupt?.();
    return { interrupted: true };
  });
  api.remove.mockImplementation(async () => {
    attempts += 1;
    await api.duringRemove?.(attempts);
  });
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  restoreModes();
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

function makeUnreadable(path: string): void {
  modes.push({ path, mode: statSync(path).mode & 0o7777 });
  chmodSync(path, 0o000);
}

function restoreModes(): void {
  for (const { path, mode } of modes.splice(0).reverse()) {
    if (existsSync(path)) chmodSync(path, mode);
  }
}

function failFirstRemove(during: () => void | Promise<void> = () => undefined): void {
  api.duringRemove = async (attempt) => {
    if (attempt > 1) return;
    await during();
    throw new Error("transient: the service restarted");
  };
}

const KEPT_LINE = /kept the OpenCode session ses_prepared that this spawn created/;

/**
 * A project with the real OpenCode plugin. The post-launch setup of app-1
 * fails (its rollback runs); every other spawn starts. The launch check is a
 * stand-in (the real one reads `/proc` for an OpenCode process).
 */
function setup(options: { beforeRollback?: (sessionsDir: string) => void } = {}) {
  const projectPath = join(root, "my-app");
  mkdirSync(projectPath, { recursive: true });
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const config: OrchestratorConfig = {
    configPath,
    port: 3000,
    readyThresholdMs: 300_000,
    defaults: {
      runtime: "mock",
      agent: "opencode",
      workspace: "mock-ws",
      notifiers: [],
    },
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
      return {
        path,
        branch: `feat/${cfg.sessionId}`,
        sessionId: cfg.sessionId,
        projectId: "my-app",
      };
    }),
    destroy: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
  } as unknown as Workspace;
  // The real plugin; no workspace hooks (they install PATH wrappers).
  const agent: Agent = {
    ...create(),
    setupWorkspaceHooks: undefined,
    postLaunchSetup: async (session: Session) => {
      if (session.id !== "app-1") return;
      options.beforeRollback?.(sessionsDir);
      throw new Error("post-launch setup failed");
    },
    confirmLaunch: async () => ({}),
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
  return { sessionsDir, sm, runtime };
}

/**
 * Another process deletes app-1 without an archive (no archive names
 * anything) and publishes a new launch that runs on ses_prepared.
 */
function replaceWithoutArchive(
  sessionsDir: string,
  runtimeHandle = JSON.stringify({ id: "rt-new", runtimeName: "mock", data: {} }),
): Record<string, string> {
  expect(deleteMetadata(sessionsDir, "app-1", false)).toBe(true);
  writeMetadata(sessionsDir, "app-1", {
    worktree: join(root, "ws-app-1"),
    branch: "feat/new-launch",
    status: "working",
    project: "my-app",
    agent: "opencode",
    opencodeSessionId: "ses_prepared",
    tmuxName: "hash-app-1",
    createdAt: "2026-10-21T12:00:00.000Z",
    runtimeHandle,
  });
  return readMetadataRaw(sessionsDir, "app-1")!;
}

describe.skipIf(process.getuid?.() === 0)(
  "M-1 (round 8): an unreadable record keeps the prepared session and the runtime",
  () => {
    it("review case 1: a replacement that names ses_prepared becomes unreadable during the interrupt (no archive names it): no removal", async () => {
      const { sessionsDir, sm } = setup();
      let replacement: Record<string, string> | undefined;
      api.duringInterrupt = () => {
        replacement = replaceWithoutArchive(sessionsDir);
        makeUnreadable(join(sessionsDir, "app-1"));
      };

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(api.interrupt).toHaveBeenCalledTimes(1);
      expect(api.remove).not.toHaveBeenCalled();
      expect(stderr.join("")).toMatch(KEPT_LINE);
      expect(stderr.join("")).toMatch(
        /kept the agent session of a failed launch \(ses_prepared\): the record of app-1 could not be read \(EACCES/,
      );
      restoreModes();
      expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
    });

    it("review case 2: the record is unreadable before the rollback: no runtime destroy, no interrupt, no removal", async () => {
      let replacement: Record<string, string> | undefined;
      let launched: string | undefined;
      const { sessionsDir, sm, runtime } = setup({
        beforeRollback: (dir) => {
          // The replacement names the runtime of this launch and ses_prepared.
          launched = readMetadataRaw(dir, "app-1")!["runtimeHandle"];
          replacement = replaceWithoutArchive(dir, launched);
          makeUnreadable(join(dir, "app-1"));
        },
      });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(runtime.destroy).not.toHaveBeenCalled();
      expect(api.interrupt).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalled();
      const runtimeId = (JSON.parse(launched!) as { id: string }).id;
      expect(stderr.join("")).toContain(
        `kept runtime mock ${runtimeId} of a failed launch: the record of app-1 could not be read`,
      );
      expect(stderr.join("")).toMatch(
        /kept the agent session of a failed launch \(ses_prepared\): the record of app-1 could not be read/,
      );
      restoreModes();
      expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
    });
  },
);

describe("M-2 (round 8): issue reuse by another AO session during the rollback keeps the prepared session", () => {
  it("review case: a second spawn for INT-1 (app-2) reuses ses_prepared during the interrupt of app-1: no removal", async () => {
    const { sessionsDir, sm } = setup();
    let second: Session | undefined;
    api.duringInterrupt = async () => {
      second = await sm.spawn({ projectId: "my-app", issueId: "INT-1" });
    };

    await expect(sm.spawn({ projectId: "my-app", issueId: "INT-1" })).rejects.toThrow(
      "post-launch setup failed",
    );

    expect(second?.id).toBe("app-2");
    expect(api.get).toHaveBeenCalledWith("ses_prepared", expect.any(Number), expect.any(Object));
    expect(readMetadataRaw(sessionsDir, "app-2")).toMatchObject({
      opencodeSessionId: "ses_prepared",
    });
    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(KEPT_LINE);
    expect(stderr.join("")).toMatch(/\(ses_prepared\): the record of app-2 names it/);
    // app-1 still owned its own record, so its rollback released it.
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
  });

  it("the same case during a failed first removal: no second attempt", async () => {
    const { sessionsDir, sm } = setup();
    let second: Session | undefined;
    failFirstRemove(async () => {
      second = await sm.spawn({ projectId: "my-app", issueId: "INT-1" });
    });

    await expect(sm.spawn({ projectId: "my-app", issueId: "INT-1" })).rejects.toThrow(
      "post-launch setup failed",
    );

    expect(second?.id).toBe("app-2");
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(readMetadataRaw(sessionsDir, "app-2")).toMatchObject({
      opencodeSessionId: "ses_prepared",
    });
    expect(stderr.join("")).toMatch(KEPT_LINE);
  });

  it("a holder in the latest archive of another AO ID keeps the session", async () => {
    const { sessionsDir, sm } = setup();
    api.duringInterrupt = () => {
      writeMetadata(sessionsDir, "app-7", {
        worktree: join(root, "ws-app-7"),
        branch: "feat/INT-7",
        status: "killed",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_prepared",
      });
      deleteMetadata(sessionsDir, "app-7", true);
    };

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(api.remove).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(/\(ses_prepared\): the latest archive of app-7 names it/);
  });

  it("control: no other holder, the record stays readable and unchanged: the second attempt removes ses_prepared", async () => {
    const { sessionsDir, sm, runtime } = setup();
    failFirstRemove();

    await expect(sm.spawn({ projectId: "my-app", issueId: "INT-1" })).rejects.toThrow(
      "post-launch setup failed",
    );

    expect(runtime.destroy).toHaveBeenCalledTimes(1);
    expect(api.interrupt).toHaveBeenCalledTimes(1);
    expect(api.remove).toHaveBeenCalledTimes(2);
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(stderr.join("")).not.toMatch(/kept/);
  });
});

describe.skipIf(process.getuid?.() === 0)(
  "M-1 (round 9): an archive directory that cannot be checked keeps the prepared session",
  () => {
    /**
     * Another process archives app-2 (it names ses_prepared), then the
     * archive directory moves below a scratch parent and `sessions/archive`
     * links to it: the archive is still there, behind that parent.
     */
    function archiveBehindParent(sessionsDir: string): string {
      writeMetadata(sessionsDir, "app-2", {
        worktree: join(root, "ws-app-2"),
        branch: "feat/INT-2",
        status: "killed",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_prepared",
      });
      expect(deleteMetadata(sessionsDir, "app-2", true)).toBe(true);
      const parent = join(root, "archive-parent");
      mkdirSync(parent);
      renameSync(join(sessionsDir, "archive"), join(parent, "archive"));
      symlinkSync(join(parent, "archive"), join(sessionsDir, "archive"));
      return parent;
    }

    function latestArchiveOf(sessionsDir: string, id: string): string {
      const dir = join(sessionsDir, "archive");
      const files = readdirSync(dir)
        .filter((name) => name.startsWith(`${id}_`))
        .sort();
      return readFileSync(join(dir, files[files.length - 1]!), "utf-8");
    }

    it("review reproducer: the archive of app-2 names ses_prepared, and its parent becomes mode 000 during the interrupt of app-1: no removal, the session is named", async () => {
      const { sessionsDir, sm } = setup();
      let existsAnswer: boolean | undefined;
      api.duringInterrupt = () => {
        makeUnreadable(archiveBehindParent(sessionsDir));
        existsAnswer = existsSync(join(sessionsDir, "archive"));
      };

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(existsAnswer).toBe(false);
      expect(api.interrupt).toHaveBeenCalledTimes(1);
      expect(api.remove).not.toHaveBeenCalled();
      expect(stderr.join("")).toMatch(KEPT_LINE);
      expect(stderr.join("")).toMatch(
        /kept the agent session of a failed launch \(ses_prepared\): the archives could not be listed \(EACCES/,
      );
      restoreModes();
      expect(latestArchiveOf(sessionsDir, "app-2")).toContain("opencodeSessionId=ses_prepared");
    });

    it("a symlink loop at sessions/archive during the interrupt: no removal, the session is named", async () => {
      const { sessionsDir, sm } = setup();
      api.duringInterrupt = () => {
        symlinkSync("archive", join(sessionsDir, "archive"));
      };

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(api.remove).not.toHaveBeenCalled();
      expect(stderr.join("")).toMatch(KEPT_LINE);
      expect(stderr.join("")).toMatch(/\(ses_prepared\): the archives could not be listed \(ELOOP/);
    });

    it("control: the archive directory is missing (ENOENT) during the interrupt: ses_prepared is removed", async () => {
      const { sessionsDir, sm } = setup();
      let archiveError: string | undefined;
      api.duringInterrupt = () => {
        try {
          statSync(join(sessionsDir, "archive"));
        } catch (err) {
          archiveError = (err as NodeJS.ErrnoException).code;
        }
      };

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(archiveError).toBe("ENOENT");
      expect(api.remove).toHaveBeenCalledTimes(1);
      expect(stderr.join("")).not.toMatch(/kept/);
    });
  },
);
