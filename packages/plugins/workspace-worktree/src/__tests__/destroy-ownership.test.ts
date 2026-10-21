/**
 * Round 7 of the killed-status fix (review r5, M-2): `destroy` awaits
 * `git rev-parse` and `git worktree remove`, and every launch of a session ID
 * uses the same worktree path. The caller's ownership check runs directly
 * before each removal step (the git remove and the fallback); a check that
 * answers false or throws keeps the directory.
 *
 * The plugin and the session manager are real, and so is the file system (a
 * temporary directory). Only the `git` child process is a stand-in: it runs
 * the change of another process inside the call, as that process would act
 * meanwhile.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

/** The `git` stand-in: each call goes to `handler`; every other command fails. */
const git = vi.hoisted(() => ({
  calls: [] as string[][],
  handler: null as null | ((args: string[]) => Promise<string>),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const execFile = ((...args: Parameters<typeof actual.execFile>) =>
    actual.execFile(...args)) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "git" || !git.handler) throw new Error(`unexpected command: ${cmd}`);
      git.calls.push(args);
      return { stdout: `${await git.handler(args)}\n`, stderr: "" };
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import {
  createSessionManager,
  deleteMetadata,
  getSessionsDir,
  getWorktreesDir,
  readMetadataRaw,
  writeMetadata,
  type Agent,
  type OrchestratorConfig,
  type PluginRegistry,
  type Runtime,
} from "@aoagents/ao-core";
import { create } from "../index.js";

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-worktree-destroy-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  git.calls = [];
  git.handler = null;
});

afterEach(() => {
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

/** A worktree directory with one file of the launch that made it. */
function worktreeAt(path: string, launch = "old"): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "launch.txt"), launch);
  return path;
}

/** A new launch writes its own file into the shared path. */
function newLaunchFileIn(path: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "new-launch.txt"), "uncommitted work of the new launch");
}

/** rev-parse answers with the repository; `remove` runs as given. */
function gitAnswers(remove: () => void, revParse: () => void = () => undefined): void {
  git.handler = async (args) => {
    if (args[0] === "rev-parse") {
      revParse();
      return join(root, "repo", ".git");
    }
    if (args[0] === "worktree" && args[1] === "remove") {
      remove();
      return "";
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
}

function failingRemove(during: () => void = () => undefined): () => void {
  return () => {
    during();
    throw new Error("fatal: cannot remove the worktree");
  };
}

const REMOVE = ["worktree", "remove", "--force"];

describe("workspace.destroy() with an ownership check (round 7, M-2)", () => {
  it("a new launch during git rev-parse: no git remove, no fallback, the result is kept", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let owner = "old";
    gitAnswers(failingRemove(), () => {
      owner = "new";
      newLaunchFileIn(path);
    });

    const result = await create().destroy(path, () => owner === "old");

    expect(result).toBe("kept");
    expect(git.calls.map((args) => args[0])).toEqual(["rev-parse"]);
    expect(existsSync(join(path, "new-launch.txt"))).toBe(true);
  });

  it("a new launch during a failed git worktree remove: the fallback does not run", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let owner = "old";
    gitAnswers(
      failingRemove(() => {
        owner = "new";
        newLaunchFileIn(path);
      }),
    );

    const result = await create().destroy(path, () => owner === "old");

    expect(result).toBe("kept");
    expect(git.calls).toEqual([
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      [...REMOVE, path],
    ]);
    expect(existsSync(join(path, "new-launch.txt"))).toBe(true);
    expect(existsSync(join(path, "launch.txt"))).toBe(true);
  });

  it("a check that throws before the git remove keeps the worktree", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    gitAnswers(failingRemove());

    const result = await create().destroy(path, () => {
      throw new Error("the record could not be read");
    });

    expect(result).toBe("kept");
    expect(git.calls.map((args) => args[0])).toEqual(["rev-parse"]);
    expect(existsSync(join(path, "launch.txt"))).toBe(true);
  });

  it("a check that throws before the fallback keeps the worktree: a broad catch gives no permission", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let checks = 0;
    gitAnswers(failingRemove());

    const result = await create().destroy(path, () => {
      checks += 1;
      if (checks > 1) throw new Error("the record could not be read");
      return true;
    });

    expect(result).toBe("kept");
    expect(checks).toBe(2);
    expect(existsSync(join(path, "launch.txt"))).toBe(true);
  });

  it("a failed rev-parse with a new launch meanwhile keeps the directory (the fallback is the only step)", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let owner = "old";
    git.handler = async () => {
      owner = "new";
      newLaunchFileIn(path);
      throw new Error("fatal: not a git repository");
    };

    const result = await create().destroy(path, () => owner === "old");

    expect(result).toBe("kept");
    expect(existsSync(join(path, "new-launch.txt"))).toBe(true);
  });

  it("control: nothing changes, the failed git remove falls back and removes the directory", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let checks = 0;
    gitAnswers(failingRemove());

    const result = await create().destroy(path, () => {
      checks += 1;
      return true;
    });

    expect(result).toBeUndefined();
    expect(checks).toBe(2);
    expect(existsSync(path)).toBe(false);
  });

  it("control: nothing changes, a git remove that works needs one check and no fallback", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    let checks = 0;
    gitAnswers(() => rmSync(path, { recursive: true, force: true }));

    const result = await create().destroy(path, () => {
      checks += 1;
      return true;
    });

    expect(result).toBeUndefined();
    expect(checks).toBe(1);
    expect(existsSync(path)).toBe(false);
  });

  it("control: without a check the plugin works as before (the fallback removes the directory)", async () => {
    const path = worktreeAt(join(root, "worktrees", "app-1"));
    gitAnswers(failingRemove(() => newLaunchFileIn(path)));

    const result = await create().destroy(path);

    expect(result).toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });
});

describe("kill through the session manager with the real worktree plugin (round 7, M-2)", () => {
  function setup() {
    const configPath = join(root, "agent-orchestrator.yaml");
    writeFileSync(configPath, "projects: {}\n");
    const projectPath = join(root, "my-app");
    mkdirSync(projectPath, { recursive: true });
    const config: OrchestratorConfig = {
      configPath,
      port: 3000,
      defaults: { runtime: "mock", agent: "mock-agent", workspace: "worktree", notifiers: [] },
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
    const worktree = worktreeAt(join(getWorktreesDir(configPath, projectPath), "app-1"));
    const runtime = {
      name: "mock",
      create: vi.fn(),
      destroy: vi.fn(async () => undefined),
      sendMessage: vi.fn(),
      getOutput: vi.fn(async () => ""),
      isAlive: vi.fn(async () => false),
    } as unknown as Runtime;
    const agent = { name: "mock-agent", processName: "mock" } as unknown as Agent;
    const workspace = create();
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
    writeMetadata(sessionsDir, "app-1", {
      worktree,
      branch: "feat/old",
      status: "working",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-20T10:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "rt-old", runtimeName: "mock", data: {} }),
    });
    const sm = createSessionManager({ config, registry });
    return { sessionsDir, worktree, sm };
  }

  /** Another process archives app-1 and publishes a new launch on the same worktree path. */
  function publishReplacement(sessionsDir: string, worktree: string): Record<string, string> {
    deleteMetadata(sessionsDir, "app-1", true);
    writeMetadata(sessionsDir, "app-1", {
      worktree,
      branch: "feat/new-launch",
      status: "working",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-20T12:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "rt-new", runtimeName: "mock", data: {} }),
    });
    newLaunchFileIn(worktree);
    return readMetadataRaw(sessionsDir, "app-1")!;
  }

  const KEPT =
    /Session app-1 changed while it was killed .*its worktree, agent session and record were kept/;

  it("review case, window 1: a new launch during git rev-parse keeps its worktree and its record", async () => {
    const { sessionsDir, worktree, sm } = setup();
    let replacement: Record<string, string> | undefined;
    gitAnswers(failingRemove(), () => {
      replacement = publishReplacement(sessionsDir, worktree);
    });

    await expect(sm.kill("app-1")).rejects.toThrow(KEPT);
    expect(git.calls.map((args) => args[0])).toEqual(["rev-parse"]);
    expect(existsSync(join(worktree, "new-launch.txt"))).toBe(true);
    expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
  });

  it("review case, window 2: a new launch during a failed git remove keeps its worktree (no fallback)", async () => {
    const { sessionsDir, worktree, sm } = setup();
    let replacement: Record<string, string> | undefined;
    gitAnswers(
      failingRemove(() => {
        replacement = publishReplacement(sessionsDir, worktree);
      }),
    );

    await expect(sm.kill("app-1")).rejects.toThrow(KEPT);
    expect(git.calls.map((args) => args[0])).toEqual(["rev-parse", "worktree"]);
    expect(existsSync(join(worktree, "new-launch.txt"))).toBe(true);
    expect(readMetadataRaw(sessionsDir, "app-1")).toEqual(replacement);
  });

  it("control: nothing changes, the failed git remove falls back, the worktree goes and the record is archived", async () => {
    const { sessionsDir, worktree, sm } = setup();
    gitAnswers(failingRemove());

    await sm.kill("app-1");

    expect(existsSync(worktree)).toBe(false);
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
  });
});
