/**
 * Round 5 of the killed-status fix (development/reviews/killed_status_review_r3_sol61.md).
 *
 * Rule 1.0.1: each runtime destroy, worktree destroy, record delete or
 * archive, and agent-session removal reads the current record again directly
 * before the step, with no await between the check and the step. Rule 1.0.2:
 * a generation never repeats for a session ID.
 *
 * Each test runs the real session manager; a stand-in callback of a slow
 * step changes the record as another process would.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../session-manager.js";
import {
  GENERATION_FLOOR_DIR,
  deleteMetadata,
  listMetadata,
  readArchivedMetadataRaw,
  readMetadataRaw,
  reserveSessionId,
  reserveSessionRecord,
  updateArchivedMetadata,
  updateMetadata,
  writeMetadata,
} from "../metadata.js";
import { getProjectBaseDir, getWorktreesDir } from "../paths.js";
import { interruptOpenCodeSession, removeOpenCodeSession } from "../opencode-api.js";
import { removeDeliveryLedger } from "../delivery-ledger.js";
import { scanAllSessions } from "../recovery/scanner.js";
import type * as DeliveryLedger from "../delivery-ledger.js";
import type * as OpenCodeApi from "../opencode-api.js";
import type * as FsPromises from "node:fs/promises";
import type {
  PRInfo,
  PluginRegistry,
  PreparedAgentSession,
  RuntimeHandle,
  Tracker,
} from "../types.js";
import {
  createMockRegistry,
  createMockSCM,
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

/** Stand-in hooks that run inside a slow step, as another process would act meanwhile. */
const hooks = vi.hoisted(() => ({
  /** Runs inside the interrupt of an OpenCode session. */
  duringInterrupt: null as null | (() => void),
  /** Runs inside the removal of an OpenCode session (a stand-in that removes nothing). */
  duringRemove: null as null | (() => void),
  /**
   * Runs once inside the read of `/proc/<pid>/stat` for this pid (a launcher
   * check), after `skip` such reads.
   */
  duringProcRead: null as null | { pid: string; run: () => void; skip?: number },
}));
vi.mock("../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    removeOpenCodeSession: vi.fn(async () => {
      hooks.duringRemove?.();
    }),
    interruptOpenCodeSession: vi.fn(async () => {
      hooks.duringInterrupt?.();
      return { interrupted: true };
    }),
  };
});
vi.mock("../delivery-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLedger>();
  return { ...actual, removeDeliveryLedger: vi.fn(async () => undefined) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    readFile: vi.fn(async (...args: Parameters<typeof actual.readFile>) => {
      const hook = hooks.duringProcRead;
      if (hook && String(args[0]) === `/proc/${hook.pid}/stat`) {
        if (hook.skip) {
          hook.skip -= 1;
        } else {
          hooks.duringProcRead = null;
          hook.run();
        }
      }
      return actual.readFile(...args);
    }),
  };
});

let ctx: TestContext;
let sessionsDir: string;

beforeEach(() => {
  hooks.duringInterrupt = null;
  hooks.duringRemove = null;
  hooks.duringProcRead = null;
  vi.mocked(removeOpenCodeSession).mockClear();
  vi.mocked(interruptOpenCodeSession).mockClear();
  vi.mocked(removeDeliveryLedger).mockClear();
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

/** A PID that no process has: the launcher check reads its stat file and finds none. */
const DEAD_PID = "2147483646";
const PR1 = "https://github.com/org/my-app/pull/1";
const PR2 = "https://github.com/org/my-app/pull/2";

function recordOf(id: string): Record<string, string> | null {
  return readMetadataRaw(sessionsDir, id);
}

function generationOf(record: Record<string, string> | null): number {
  return Number(record?.["generation"]);
}

function managedWorktree(id = "app-1"): string {
  const project = ctx.config.projects["my-app"]!;
  const path = join(getWorktreesDir(ctx.config.configPath, project.path), id);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A launched record of `id` (the shape that a spawn writes after `runtime.create`). */
function launchedRecord(
  id: string,
  fields: Partial<Record<string, string>> = {},
  handle: RuntimeHandle = makeHandle(`rt-${id}`),
): void {
  writeMetadata(sessionsDir, id, {
    worktree: join(ctx.tmpDir, `ws-${id}`),
    branch: "feat/old",
    status: "working",
    project: "my-app",
    tmuxName: `hash-${id}`,
    createdAt: "2026-10-20T10:00:00.000Z",
    runtimeHandle: JSON.stringify(handle),
  });
  if (Object.keys(fields).length > 0) updateMetadata(sessionsDir, id, fields);
}

/** Another process archives the record and reserves its ID again. */
function archiveAndReserve(id: string): Record<string, string> {
  deleteMetadata(sessionsDir, id, true);
  expect(reserveSessionId(sessionsDir, id)).toBe(true);
  return recordOf(id)!;
}

/** Another process archives the record and publishes a full new launch of the ID. */
function publishNewLaunch(
  id: string,
  handle: RuntimeHandle = makeHandle("rt-new"),
  fields: Partial<Record<string, string>> = {},
): Record<string, string> {
  archiveAndReserve(id);
  expect(
    updateMetadata(sessionsDir, id, {
      worktree: join(ctx.tmpDir, `ws-${id}`),
      branch: "feat/new-launch",
      status: "spawning",
      project: "my-app",
      tmuxName: `hash-${id}`,
      createdAt: "2026-10-20T12:00:00.000Z",
      runtimeHandle: JSON.stringify(handle),
      reservationId: "",
      ...fields,
    }),
  ).toBe(true);
  return recordOf(id)!;
}

/** Collect what the session manager tells the operator on stderr. */
function captureWarnings(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("B-1: a failed restore stops its runtime only when no record may own it", () => {
  function killedRecord(): void {
    mkdirSync(join(ctx.tmpDir, "ws-app-1"), { recursive: true });
    launchedRecord("app-1", { status: "killed", killedReason: "runtime" }, makeHandle("rt-old"));
  }

  it("review case: a replacement with the same runtime name keeps its runtime and its record", async () => {
    killedRecord();
    // Both launches of the ID use the same tmux name. The other process
    // stops this restore's runtime and creates its own under that name.
    const shared = makeHandle("hash-app-1");
    let replacement: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      replacement = publishNewLaunch("app-1", shared, { status: "working" });
      return shared;
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored .*its runtime mock hash-app-1 was kept/,
    );
    expect(recordOf("app-1")).toEqual(replacement);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalledWith(shared);
  });

  it("a replacement that names the runtime by its tmux name only keeps it too", async () => {
    killedRecord();
    const created = makeHandle("hash-app-1");
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      publishNewLaunch("app-1", makeHandle("rt-other"), { tmuxName: "hash-app-1" });
      return created;
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(/was kept/);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalledWith(created);
  });

  it("control: the record is gone and nothing names the runtime, so it is stopped", async () => {
    killedRecord();
    const created = makeHandle("hash-app-1");
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      deleteMetadata(sessionsDir, "app-1", true);
      return created;
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 was removed \(archived or deleted\) while it was restored; its new runtime was stopped/,
    );
    expect(recordOf("app-1")).toBeNull();
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(created);
  });

  it("control: a launched replacement that names another runtime does not own this one", async () => {
    killedRecord();
    const created = makeHandle("rt-restored");
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      publishNewLaunch("app-1", makeHandle("rt-new"), { tmuxName: "hash-other" });
      return created;
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(/its new runtime was stopped/);
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(created);
  });
});

describe("M-1: the launch rollback reads the record again before each step", () => {
  function managedSpawnWorkspace(): string {
    const path = managedWorktree();
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path,
      branch: "session/app-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    return path;
  }

  /** An agent that prepares its session (created by this spawn) under `id`. */
  function preparedAgent(id: string): PreparedAgentSession {
    const prepared: PreparedAgentSession = {
      metadata: { opencodeSessionId: id },
      agentConfig: { opencodeSessionId: id },
      created: true,
      discard: vi.fn(async () => undefined),
    };
    ctx.mockAgent.prepareAgentSession = vi.fn(async () => prepared);
    return prepared;
  }

  it("review case: a replacement published during the rollback runtime destroy keeps the shared worktree", async () => {
    const worktree = managedSpawnWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    let replacement: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      // Another process archives, reserves and publishes a replacement with
      // the same managed worktree path.
      replacement = publishNewLaunch("app-1", makeHandle("rt-new"), { worktree });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-spawned"));
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalledWith(worktree);
    expect(recordOf("app-1")).toEqual(replacement);
  });

  it("a replacement during the rollback runtime destroy that names the prepared agent session keeps it", async () => {
    managedSpawnWorkspace();
    const prepared = preparedAgent("ses_prep");
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      // A kill and a restore of the ID: the restored launch runs on the same
      // agent session.
      publishNewLaunch("app-1", makeHandle("rt-new"), { opencodeSessionId: "ses_prep" });
    });
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    try {
      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    } finally {
      warnings.restore();
    }
    expect(prepared.discard).not.toHaveBeenCalled();
    expect(warnings.lines.join("")).toMatch(
      /kept the agent session of a failed launch \(ses_prep\)/,
    );
  });

  it("an archive during the rollback runtime destroy keeps the prepared agent session that the archive names", async () => {
    managedSpawnWorkspace();
    const prepared = preparedAgent("ses_prep");
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      deleteMetadata(sessionsDir, "app-1", true);
    });
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    try {
      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    } finally {
      warnings.restore();
    }
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBe("ses_prep");
    expect(prepared.discard).not.toHaveBeenCalled();
  });

  it("a replacement during the prepared-session discard keeps the shared worktree", async () => {
    const worktree = managedSpawnWorkspace();
    const prepared = preparedAgent("ses_prep");
    vi.mocked(prepared.discard).mockImplementation(async () => {
      publishNewLaunch("app-1", makeHandle("rt-new"), { worktree });
    });
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    expect(prepared.discard).toHaveBeenCalled();
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalledWith(worktree);
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("control: an unchanged failed launch stops its runtime, removes its agent session, worktree and record", async () => {
    const worktree = managedSpawnWorkspace();
    const prepared = preparedAgent("ses_prep");
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-spawned"));
    expect(prepared.discard).toHaveBeenCalled();
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledWith(worktree);
    expect(recordOf("app-1")).toBeNull();
  });
});

describe("M-2: cleanup kills only while the facts of its decision hold", () => {
  function prInfo(number: number, url: string): PRInfo {
    return {
      number,
      url,
      title: `PR ${number}`,
      owner: "org",
      repo: "my-app",
      branch: `feat/pr-${number}`,
      baseBranch: "main",
      isDraft: false,
    };
  }

  function registryWith(scm: ReturnType<typeof createMockSCM>): PluginRegistry {
    return createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
  }

  it("review case: a claim of open PR #2 during the closed-PR query of PR #1 keeps the session", async () => {
    const worktree = managedWorktree();
    launchedRecord("app-1", { worktree, pr: PR1, status: "pr_open" });
    let sm: ReturnType<typeof createSessionManager> | null = null;
    const scm = createMockSCM({
      resolvePR: vi.fn().mockResolvedValue(prInfo(2, PR2)),
      checkoutPR: vi.fn().mockResolvedValue(true),
      getPRState: vi.fn(async (pr: PRInfo) => {
        if (pr.url === PR1) {
          // The real claim of PR #2 lands while the query of PR #1 runs.
          await sm!.claimPR("app-1", "2");
          return "closed";
        }
        return "open";
      }),
    });
    sm = createSessionManager({ config: ctx.config, registry: registryWith(scm) });

    const result = await sm.cleanup("my-app");

    expect(recordOf("app-1")).toMatchObject({ pr: PR2, status: "pr_open" });
    expect(result.killed).not.toContain("app-1");
    expect(result.errors.map((entry) => entry.error)).toEqual([
      expect.stringMatching(/Session app-1 changed while it was checked for cleanup/),
    ]);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
  });

  it("a status change by a bash helper (no new generation) during the issue check keeps the session", async () => {
    launchedRecord("app-1", { issue: "INT-1", status: "working" });
    const before = recordOf("app-1")!;
    const tracker: Tracker = {
      name: "mock",
      getIssue: vi.fn(),
      isCompleted: vi.fn(async () => {
        // `sed` and `mv` of the helper: no lock, no new generation.
        const raw = { ...recordOf("app-1")!, status: "pr_open" };
        writeFileSync(
          join(sessionsDir, "app-1"),
          Object.entries(raw)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(""),
        );
        return true;
      }),
      issueUrl: vi.fn(() => ""),
      branchName: vi.fn(() => "feat/int-1"),
      generatePrompt: vi.fn(async () => ""),
    };
    const base = createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: ctx.mockWorkspace,
    });
    const registry: PluginRegistry = {
      ...base,
      get: ((slot: string, name?: string) =>
        slot === "tracker"
          ? tracker
          : base.get(slot as never, name as never)) as PluginRegistry["get"],
    };
    const sm = createSessionManager({ config: ctx.config, registry });

    const result = await sm.cleanup("my-app");

    expect(tracker.isCompleted).toHaveBeenCalled();
    expect(result.killed).not.toContain("app-1");
    expect(recordOf("app-1")).toMatchObject({
      status: "pr_open",
      generation: before["generation"],
    });
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
  });

  it("a claim of another PR during the cleanup runtime destroy keeps the worktree and the record", async () => {
    const worktree = managedWorktree();
    launchedRecord("app-1", { worktree, pr: PR1, status: "pr_open" });
    const scm = createMockSCM({ getPRState: vi.fn().mockResolvedValue("merged") });
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      updateMetadata(sessionsDir, "app-1", { pr: PR2, status: "pr_open" });
    });
    const sm = createSessionManager({ config: ctx.config, registry: registryWith(scm) });

    const result = await sm.cleanup("my-app");

    expect(result.killed).not.toContain("app-1");
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ pr: PR2 });
  });

  it("control: a direct kill keeps the launch-only compare (a PR change during the kill does not stop it)", async () => {
    launchedRecord("app-1", { pr: PR1, status: "pr_open" });
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      updateMetadata(sessionsDir, "app-1", { pr: PR2 });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1");

    expect(recordOf("app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({ pr: PR2 });
  });

  it("control: an unchanged merged PR is cleaned up", async () => {
    launchedRecord("app-1", { pr: PR1, status: "pr_open" });
    const scm = createMockSCM({ getPRState: vi.fn().mockResolvedValue("merged") });
    const sm = createSessionManager({ config: ctx.config, registry: registryWith(scm) });

    const result = await sm.cleanup("my-app");

    expect(result.killed).toContain("app-1");
    expect(recordOf("app-1")).toBeNull();
  });
});

describe("1.0.1: kill reads the record directly before each step", () => {
  function openCodeRecord(fields: Partial<Record<string, string>> = {}): string {
    const worktree = managedWorktree();
    launchedRecord("app-1", {
      worktree,
      agent: "opencode",
      opencodeSessionId: "ses_old",
      ...fields,
    });
    return worktree;
  }

  it("a new launch during the launcher check: nothing is destroyed", async () => {
    openCodeRecord({ launchPid: DEAD_PID, launchPidStart: "stat:1" });
    hooks.duringProcRead = { pid: DEAD_PID, run: () => publishNewLaunch("app-1") };
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*nothing was destroyed; run the kill again/,
    );
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("a new launch during the holder check: no interrupt, no removal, and the record stays", async () => {
    openCodeRecord();
    // A dead launch of another session names the same ID; its launcher
    // check is the await of the holder check.
    writeMetadata(sessionsDir, "app-2", {
      worktree: join(ctx.tmpDir, "ws-app-2"),
      branch: "feat/two",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_old",
    });
    updateMetadata(sessionsDir, "app-2", { launchPid: DEAD_PID, launchPidStart: "stat:1" });
    hooks.duringProcRead = {
      pid: DEAD_PID,
      run: () => publishNewLaunch("app-1", makeHandle("rt-new"), { opencodeSessionId: "ses_old" }),
    };
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*its agent session and record were kept/,
    );
    expect(interruptOpenCodeSession).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("a new launch during the OpenCode interrupt: the agent session is not removed, and the record stays", async () => {
    openCodeRecord();
    hooks.duringInterrupt = () =>
      publishNewLaunch("app-1", makeHandle("rt-new"), { opencodeSessionId: "ses_old" });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*its agent session and record were kept/,
    );
    expect(interruptOpenCodeSession).toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("another session takes the OpenCode session during the interrupt: it is not removed", async () => {
    openCodeRecord();
    launchedRecord("app-2");
    hooks.duringInterrupt = () => {
      updateMetadata(sessionsDir, "app-2", { agent: "opencode", opencodeSessionId: "ses_old" });
    };
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    try {
      await sm.kill("app-1", { purgeOpenCode: true });
    } finally {
      warnings.restore();
    }
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(warnings.lines.join("")).toMatch(
      /kept OpenCode session ses_old of app-1: another session took the ID/,
    );
    // The kill itself goes on: the record is archived, not marked cleaned.
    expect(recordOf("app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeUndefined();
  });

  it("the ledger of a removed OpenCode session stays while an active record names it", async () => {
    openCodeRecord();
    launchedRecord("app-2");
    hooks.duringRemove = () => {
      updateMetadata(sessionsDir, "app-2", { agent: "opencode", opencodeSessionId: "ses_old" });
    };
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    try {
      await sm.kill("app-1", { purgeOpenCode: true });
    } finally {
      warnings.restore();
    }
    expect(removeOpenCodeSession).toHaveBeenCalled();
    expect(removeDeliveryLedger).not.toHaveBeenCalled();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"]).toBe(
      "ses_old",
    );
    expect(warnings.lines.join("")).toMatch(/session app-2 names OpenCode session ses_old/);
  });

  it("control: an unchanged OpenCode kill interrupts, removes the session and its ledger, and archives", async () => {
    openCodeRecord();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1", { purgeOpenCode: true });

    expect(removeOpenCodeSession).toHaveBeenCalled();
    expect(removeDeliveryLedger).toHaveBeenCalled();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeCleanedAt"]).toBeDefined();
  });
});

describe("1.0.1: the cleanup purge of an archived OpenCode session reads the records directly before", () => {
  function archivedOpenCodeRecord(): void {
    launchedRecord("app-1", { agent: "opencode", opencodeSessionId: "ses_arch" });
    deleteMetadata(sessionsDir, "app-1", true);
    // A dead launch of another session names the same ID; its launcher
    // check is the await of the holder check.
    writeMetadata(sessionsDir, "app-2", {
      worktree: join(ctx.tmpDir, "ws-app-2"),
      branch: "feat/two",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_arch",
    });
    updateMetadata(sessionsDir, "app-2", { launchPid: DEAD_PID, launchPidStart: "stat:1" });
  }

  it("a restore of the archived ID after the active list of the cleanup keeps the OpenCode session", async () => {
    archivedOpenCodeRecord();
    // The first launcher check of app-2 is in the active loop: the restore
    // lands before the purge decides, and the holder check skips app-1.
    hooks.duringProcRead = {
      pid: DEAD_PID,
      run: () => {
        const archived = readArchivedMetadataRaw(sessionsDir, "app-1")!;
        expect(reserveSessionRecord(sessionsDir, "app-1", archived)).not.toBeNull();
      },
    };
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    let result;
    try {
      result = await sm.cleanup("my-app");
    } finally {
      warnings.restore();
    }
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(result.killed).not.toContain("app-1");
    expect(warnings.lines.join("")).toMatch(
      /kept OpenCode session ses_arch of app-1: its records changed/,
    );
  });

  it("a new launch of a holder during its check keeps the OpenCode session", async () => {
    archivedOpenCodeRecord();
    // The second launcher check of app-2 is the holder check of the purge.
    // Meanwhile app-2 is launched again on the same OpenCode session; the
    // check answers from the dead launch that it read.
    hooks.duringProcRead = {
      pid: DEAD_PID,
      skip: 1,
      run: () => {
        publishNewLaunch("app-2", makeHandle("rt-app-2-new"), {
          agent: "opencode",
          opencodeSessionId: "ses_arch",
        });
      },
    };
    const warnings = captureWarnings();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    try {
      await sm.cleanup("my-app");
    } finally {
      warnings.restore();
    }
    expect(hooks.duringProcRead).toBeNull();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(warnings.lines.join("")).toMatch(
      /kept OpenCode session ses_arch of app-1: its records changed/,
    );
  });

  it("control: with no change during the check, the archived OpenCode session is removed", async () => {
    archivedOpenCodeRecord();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const result = await sm.cleanup("my-app");

    expect(removeOpenCodeSession).toHaveBeenCalledWith("ses_arch", expect.anything(), undefined);
    expect(result.killed).toContain("app-1");
  });
});

describe("1.0.2: a generation never repeats for a session ID", () => {
  function launched(id = "app-1"): number {
    launchedRecord(id);
    return generationOf(recordOf(id));
  }

  it("the review's reproducer: a delete without archive plus a new reservation continues above it", () => {
    const before = launched();
    deleteMetadata(sessionsDir, "app-1", false);
    expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
    expect(generationOf(recordOf("app-1"))).toBe(before + 1);
  });

  it("an archive plus a new reservation continues above the archive and the deleted record", () => {
    const before = launched();
    deleteMetadata(sessionsDir, "app-1", true);
    // Archive bookkeeping writes increment the archived copy too.
    updateArchivedMetadata(sessionsDir, "app-1", { opencodeCleanedAt: "2026-10-20T10:00:00Z" });
    const archived = generationOf(readArchivedMetadataRaw(sessionsDir, "app-1"));
    expect(archived).toBe(before + 1);
    expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
    expect(generationOf(recordOf("app-1"))).toBe(archived + 1);
  });

  it("an archive copy-back (restore) continues above every earlier version", () => {
    const before = launched();
    deleteMetadata(sessionsDir, "app-1", true);
    const archived = readArchivedMetadataRaw(sessionsDir, "app-1")!;
    expect(reserveSessionRecord(sessionsDir, "app-1", archived, archived)).not.toBeNull();
    expect(generationOf(recordOf("app-1"))).toBe(before + 1);
  });

  it("an archive whose files are gone later: the floor still keeps the generation", () => {
    const before = launched();
    deleteMetadata(sessionsDir, "app-1", true);
    rmSync(join(sessionsDir, "archive"), { recursive: true, force: true });
    expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
    expect(generationOf(recordOf("app-1"))).toBe(before + 1);
  });

  it("a full write over a missing record after a delete without archive continues above it", () => {
    const before = launched();
    deleteMetadata(sessionsDir, "app-1", false);
    writeMetadata(sessionsDir, "app-1", { worktree: "/tmp", branch: "main", status: "working" });
    expect(generationOf(recordOf("app-1"))).toBe(before + 1);
  });

  it("a launch rollback (spawn) followed by a new reservation continues above the rolled-back launch", async () => {
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    let rolledBack = 0;
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      rolledBack = generationOf(recordOf("app-1"));
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");
    expect(recordOf("app-1")).toBeNull();
    expect(rolledBack).toBeGreaterThan(1);
    expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
    expect(generationOf(recordOf("app-1"))).toBe(rolledBack + 1);
  });

  it("many delete and reservation rounds, with and without archive, never repeat a generation", () => {
    const seen = new Set<number>();
    launched();
    for (let round = 0; round < 6; round++) {
      const generation = generationOf(recordOf("app-1"));
      expect(seen.has(generation)).toBe(false);
      seen.add(generation);
      deleteMetadata(sessionsDir, "app-1", round % 2 === 0);
      expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
      updateMetadata(sessionsDir, "app-1", { branch: `feat/round-${round}` });
    }
  });

  it("the floor state looks like no session to any reader", async () => {
    launched();
    deleteMetadata(sessionsDir, "app-1", false);
    expect(existsSync(join(sessionsDir, GENERATION_FLOOR_DIR, "app-1"))).toBe(true);
    expect(readdirSync(sessionsDir)).toContain(GENERATION_FLOOR_DIR);

    expect(listMetadata(sessionsDir)).toEqual([]);
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    expect(await sm.list("my-app")).toEqual([]);
    expect(await sm.get("app-1")).toBeNull();
    expect(await sm.cleanup("my-app")).toEqual({ killed: [], skipped: [], errors: [] });
    expect(scanAllSessions(ctx.config)).toEqual([]);
  });
});

describe("1.0.1: the delete strategy of a spawn reads the records directly before the removal", () => {
  /** An opencode agent, the delete strategy, and an archived session of the issue. */
  function deleteStrategySetup(): PluginRegistry {
    ctx.config.projects["my-app"]!.opencodeIssueSessionStrategy = "delete";
    launchedRecord("app-7", { agent: "opencode", issue: "INT-1", opencodeSessionId: "ses_issue" });
    deleteMetadata(sessionsDir, "app-7", true);
    // A dead launch of another session names the same ID; its launcher
    // check is the await of the holder check.
    writeMetadata(sessionsDir, "app-8", {
      worktree: join(ctx.tmpDir, "ws-app-8"),
      branch: "feat/eight",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_issue",
    });
    updateMetadata(sessionsDir, "app-8", { launchPid: DEAD_PID, launchPidStart: "stat:1" });
    return createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: { ...ctx.mockAgent, name: "opencode" },
      workspace: ctx.mockWorkspace,
    });
  }

  it("a new launch of a holder during its check keeps the OpenCode session", async () => {
    const registry = deleteStrategySetup();
    // Meanwhile app-8 is launched again on the same OpenCode session; the
    // check answers from the dead launch that it read.
    hooks.duringProcRead = {
      pid: DEAD_PID,
      run: () =>
        publishNewLaunch("app-8", makeHandle("rt-app-8-new"), {
          agent: "opencode",
          opencodeSessionId: "ses_issue",
        }),
    };
    const sm = createSessionManager({ config: ctx.config, registry });

    await sm.spawn({ projectId: "my-app", issueId: "INT-1" });

    expect(removeOpenCodeSession).not.toHaveBeenCalled();
  });

  it("control: with no change during the check, the OpenCode session of the issue is removed", async () => {
    const registry = deleteStrategySetup();
    const sm = createSessionManager({ config: ctx.config, registry });

    await sm.spawn({ projectId: "my-app", issueId: "INT-1" });

    expect(removeOpenCodeSession).toHaveBeenCalledWith("ses_issue", expect.anything(), undefined);
  });
});

describe("rollback of a project-mode orchestrator start: the shared prompt file", () => {
  function promptFile(): string {
    const project = ctx.config.projects["my-app"]!;
    return join(
      getProjectBaseDir(ctx.config.configPath, project.path),
      "orchestrator-prompt-app-orchestrator.md",
    );
  }

  it("a replacement start during the failed start keeps the prompt file", async () => {
    ctx.config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orch"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      publishNewLaunch("app-orchestrator", makeHandle("rt-new"), { tmuxName: "hash-new" });
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(
      sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "You are the orchestrator." }),
    ).rejects.toThrow("post-launch setup failed");
    expect(recordOf("app-orchestrator")).toMatchObject({ branch: "feat/new-launch" });
    expect(existsSync(promptFile())).toBe(true);
  });

  it("control: a failed start that still owns its record removes the prompt file", async () => {
    ctx.config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orch"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(
      sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "You are the orchestrator." }),
    ).rejects.toThrow("post-launch setup failed");
    expect(recordOf("app-orchestrator")).toBeNull();
    expect(existsSync(promptFile())).toBe(false);
  });
});

describe("B-2: the claim takeover compares the launch of the old owner too", () => {
  /** A record of an earlier build (no generation) that owns PR #2. */
  function oldBuildOwner(handleId: string): string {
    return [
      `worktree=${join(ctx.tmpDir, "ws-app-old")}`,
      "branch=feat/two",
      "status=pr_open",
      `pr=${PR2}`,
      "project=my-app",
      "tmuxName=hash-app-old",
      "createdAt=2026-10-20T10:00:00.000Z",
      `runtimeHandle=${JSON.stringify(makeHandle(handleId))}`,
      "",
    ].join("\n");
  }

  function claimRegistry(checkoutPR: () => Promise<boolean>): PluginRegistry {
    const scm = createMockSCM({
      resolvePR: vi.fn().mockResolvedValue({
        number: 2,
        url: PR2,
        title: "Two",
        owner: "org",
        repo: "my-app",
        branch: "feat/two",
        baseBranch: "main",
        isDraft: false,
      }),
      checkoutPR: vi.fn(checkoutPR),
    });
    return createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
  }

  it("an earlier build's new launch of the old owner during the checkout keeps its PR", async () => {
    launchedRecord("app-1");
    const ownerFile = join(sessionsDir, "app-old");
    writeFileSync(ownerFile, oldBuildOwner("rt-old"));
    const sm = createSessionManager({
      config: ctx.config,
      registry: claimRegistry(async () => {
        // An earlier build replaces the old owner with a new launch: the
        // same PR and status, no generation.
        writeFileSync(ownerFile, oldBuildOwner("rt-old-relaunched"));
        return true;
      }),
    });

    await sm.claimPR("app-1", "2");

    expect(recordOf("app-1")).toMatchObject({ pr: PR2, status: "pr_open" });
    expect(recordOf("app-old")).toMatchObject({
      pr: PR2,
      runtimeHandle: JSON.stringify(makeHandle("rt-old-relaunched")),
    });
  });

  it("control: an unchanged old owner of an earlier build is taken over", async () => {
    launchedRecord("app-1");
    writeFileSync(join(sessionsDir, "app-old"), oldBuildOwner("rt-old"));
    const sm = createSessionManager({
      config: ctx.config,
      registry: claimRegistry(async () => true),
    });

    await sm.claimPR("app-1", "2");

    expect(recordOf("app-old")?.["pr"]).toBeUndefined();
  });
});
