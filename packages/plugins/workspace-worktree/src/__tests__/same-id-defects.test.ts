/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests. All tests here belong to round R3 (the launch identity).
 *
 * D-C: every launch of a session ID uses the same worktree path, so a step
 * that awaits can act on the worktree of a newer launch. The plugin and the
 * session manager (the built core) are real, and so is the file system (a
 * temporary directory). Only the `git` child process is a stand-in. Two
 * kinds of competitor act during a git command:
 * - another real operation of the same session manager (`kill`, `restore`):
 *   a fix that serializes the operations of one ID may make it wait or
 *   refuse, so these tests assert the end state only;
 * - another process that writes the record with the public metadata
 *   functions (an `ao` of an older build during the rollout, or any writer
 *   outside a lease): only a check of the record directly before the
 *   removal keeps the newer launch's files.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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
  type ProjectConfig,
  type Runtime,
  type RuntimeHandle,
  type Session,
} from "@aoagents/ao-core";
import { create } from "../index.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

let root: string;
const originalStateRoot = process.env["AO_STATE_ROOT"];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-same-id-worktree-"));
  process.env["AO_STATE_ROOT"] = join(root, "state");
  git.calls = [];
  git.handler = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStateRoot === undefined) delete process.env["AO_STATE_ROOT"];
  else process.env["AO_STATE_ROOT"] = originalStateRoot;
  rmSync(root, { recursive: true, force: true });
});

/** The files that a newer launch keeps in the shared path (uncommitted work). */
function newLaunchWorkIn(path: string, sub = "."): string {
  const dir = join(path, sub);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "new-launch.txt");
  writeFileSync(file, "uncommitted work of the newer launch");
  return file;
}

/** Wait until `promise` settles, at most `ms` (a serialized competitor may wait for us). */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([promise.then(() => undefined, () => undefined), sleep(ms)]);
}

interface Setup {
  sm: ReturnType<typeof createSessionManager>;
  sessionsDir: string;
  worktreeDir: string;
  projectPath: string;
  runtime: Runtime;
}

/**
 * A project with the real worktree plugin (worktrees under the managed
 * root of the state directory), a stand-in runtime and agent, and
 * `symlinks: ["shared"]` (the source exists in the project).
 */
function setup(options: { runtimeAlive?: boolean } = {}): Setup {
  const configPath = join(root, "agent-orchestrator.yaml");
  writeFileSync(configPath, "projects: {}\n");
  const projectPath = join(root, "my-app");
  mkdirSync(join(projectPath, "shared"), { recursive: true });
  writeFileSync(join(projectPath, "shared", "source.txt"), "shared source");
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
        symlinks: ["shared"],
      },
    },
    notifiers: {},
    notificationRouting: { urgent: [], action: [], warning: [], info: [] },
    reactions: {},
    readyThresholdMs: 300_000,
  };
  const sessionsDir = getSessionsDir(configPath, projectPath);
  mkdirSync(sessionsDir, { recursive: true });
  const worktreeDir = getWorktreesDir(configPath, projectPath);
  let launches = 0;
  const runtime = {
    name: "mock",
    create: vi.fn(async (): Promise<RuntimeHandle> => {
      launches += 1;
      return { id: "hash-app-1", runtimeName: "mock", data: { launch: launches } };
    }),
    destroy: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    getOutput: vi.fn(async () => ""),
    isAlive: vi.fn(async () => options.runtimeAlive ?? true),
  } as unknown as Runtime;
  const agent = {
    name: "mock-agent",
    processName: "mock",
    getLaunchCommand: () => "mock-agent --start",
    getEnvironment: () => ({}),
    detectActivity: () => "idle",
    getActivityState: async () => ({ state: "idle" }),
    isProcessRunning: async () => false,
    getSessionInfo: async () => null,
  } as unknown as Agent;
  const workspace = create({ worktreeDir });
  const registry = {
    register: vi.fn(),
    get: vi.fn((slot: string) =>
      slot === "runtime" ? runtime : slot === "agent" ? agent : slot === "workspace" ? workspace : null,
    ),
    list: vi.fn(() => []),
    loadBuiltins: vi.fn(async () => undefined),
    loadFromConfig: vi.fn(async () => undefined),
  } as unknown as PluginRegistry;
  const sm = createSessionManager({ config, registry });
  return { sm, sessionsDir, worktreeDir, projectPath, runtime };
}

/** The worktree path of app-1 under the plugin's rule. */
function pathOf(s: Setup, id = "app-1"): string {
  return join(s.worktreeDir, "my-app", id);
}

/** Another process archives app-1 and publishes its own launch of the ID on `worktree`. */
function publishReplacement(s: Setup, worktree: string): Record<string, string> {
  deleteMetadata(s.sessionsDir, "app-1", true);
  writeMetadata(s.sessionsDir, "app-1", {
    worktree,
    branch: "feat/new-launch",
    status: "working",
    project: "my-app",
    tmuxName: "hash-app-1",
    createdAt: "2026-10-21T12:00:00.000Z",
    runtimeHandle: JSON.stringify({ id: "rt-new", runtimeName: "mock", data: {} }),
  });
  return readMetadataRaw(s.sessionsDir, "app-1")!;
}

/** The git answers of a repository without origin, whose main branch exists. */
async function baseGit(args: string[]): Promise<string | undefined> {
  if (args[0] === "remote") throw new Error("error: No such remote 'origin'");
  if (args[0] === "rev-parse" && args[1] === "--verify") return "";
  if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true";
  if (args[0] === "rev-parse" && args[1] === "--path-format=absolute") return join(root, "repo", ".git");
  if (args[0] === "worktree" && args[1] === "prune") return "";
  return undefined;
}

describe("[same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree", () => {
  defect("create does not remove a worktree that another launch made at the path during the checkout", async () => {
    const worktreeDir = join(root, "worktrees");
    const path = join(worktreeDir, "my-app", "app-1");
    let replaced = false;
    let newFile = "";
    git.handler = async (args) => {
      const base = await baseGit(args);
      if (base !== undefined) return base;
      if (args[0] === "worktree" && args[1] === "add" && args[2] === "-b") {
        throw new Error("fatal: a branch named 'feat/INT-1' already exists");
      }
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(path, { recursive: true });
        return "";
      }
      if (args[0] === "checkout") {
        // Meanwhile a kill removed this path and a newer launch of the ID
        // made its own worktree there (review r6, M-4).
        rmSync(path, { recursive: true, force: true });
        newFile = newLaunchWorkIn(path);
        replaced = true;
        throw new Error("error: pathspec 'feat/INT-1' did not match");
      }
      if (args[0] === "worktree" && args[1] === "remove") {
        rmSync(args.at(-1)!, { recursive: true, force: true });
        return "";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    const project: ProjectConfig = {
      name: "My App",
      repo: "org/my-app",
      path: join(root, "my-app"),
      defaultBranch: "main",
      sessionPrefix: "app",
    };
    await create({ worktreeDir })
      .create({ projectId: "my-app", project, sessionId: "app-1", branch: "feat/INT-1" })
      .catch(() => undefined);
    // Measured: `git worktree remove --force <path>` runs after the failed
    // checkout and removes the newer launch's files.
    expect(
      !replaced || existsSync(newFile),
      `the newer launch's worktree was removed; git calls: ${JSON.stringify(git.calls.map((a) => a.slice(0, 3)))}`,
    ).toBe(true);
  });
});

describe("[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files", () => {
  defect("spawn: postCreate keeps the files of another launch that took the record and the path during the git add", async () => {
    const s = setup();
    const path = pathOf(s);
    let newFile = "";
    git.handler = async (args) => {
      const base = await baseGit(args);
      if (base !== undefined) return base;
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(path, { recursive: true });
        // Another process archives the reservation and publishes its launch
        // on the same path; its `shared` holds real files (review r6, M-5).
        publishReplacement(s, path);
        newFile = newLaunchWorkIn(path, "shared");
        return "";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    await s.sm.spawn({ projectId: "my-app" }).catch(() => undefined);
    // Measured: postCreate removes `shared` recursively and links it to the
    // project's directory before the spawn finds its record replaced.
    expect(existsSync(newFile), "postCreate removed the newer launch's shared/ files").toBe(true);
  });

  defect("restore: postCreate keeps the files of another launch that took the record and the path during the git add", async () => {
    const s = setup({ runtimeAlive: false });
    const path = pathOf(s);
    // An archived launch of app-1 whose worktree the kill removed.
    writeMetadata(s.sessionsDir, "app-1", {
      worktree: path,
      branch: "feat/old",
      status: "killed",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-21T10:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
    });
    deleteMetadata(s.sessionsDir, "app-1", true);
    let newFile = "";
    git.handler = async (args) => {
      const base = await baseGit(args);
      if (base !== undefined) return base;
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(path, { recursive: true });
        publishReplacement(s, path);
        newFile = newLaunchWorkIn(path, "shared");
        return "";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    await s.sm.restore("app-1").catch(() => undefined);
    expect(existsSync(newFile), "postCreate removed the newer launch's shared/ files").toBe(true);
  });
});

describe("[same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it", () => {
  defect("kill and restore of one ID: the active record at the end still has its worktree", async () => {
    // app-1 runs no more (its pane died); its worktree holds its work.
    const s = setup({ runtimeAlive: false });
    const path = pathOf(s);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "work.txt"), "work of app-1");
    writeMetadata(s.sessionsDir, "app-1", {
      worktree: path,
      branch: "feat/old",
      status: "working",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-21T10:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
    });
    const competitor: { restore?: Promise<Session> } = {};
    git.handler = async (args) => {
      const base = await baseGit(args);
      if (base !== undefined) return base;
      if (args[0] === "worktree" && args[1] === "remove") {
        if (!competitor.restore) {
          // The kill's check passed directly before this command. While git
          // runs, a restore of app-1 (`ao send`, a lifecycle reaction)
          // relaunches the session on the same worktree.
          competitor.restore = s.sm.restore("app-1");
          await settledWithin(competitor.restore, 500);
        }
        rmSync(args.at(-1)!, { recursive: true, force: true });
        return "";
      }
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(args[args.indexOf("--") + 1]!, { recursive: true });
        return "";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    await s.sm.kill("app-1").catch(() => undefined);
    await competitor.restore?.catch(() => undefined);
    const record = readMetadataRaw(s.sessionsDir, "app-1");
    // Measured: the restore wrote its launch into the record, then the
    // kill's `git worktree remove --force` removed the worktree under it.
    if (record !== null) {
      expect(
        existsSync(record["worktree"] ?? ""),
        `the active record (restoredAt=${record["restoredAt"] ?? "none"}) has no worktree`,
      ).toBe(true);
    }
  });
});
