/**
 * Defect tests of the same-ID design revision r2 (ao-52, design file
 * development/reviews/same_id_design_r2_opus.md), for the counterexamples of
 * review r1 (development/reviews/same_id_design_review_r1_astra6.md) that a
 * unit test of core can show:
 *
 * - B-6 (round R2): a runtime stop that cannot be confirmed must stop the
 *   caller. Today `destroy` resolves nothing and every caller swallows its
 *   rejection, so the kill, the cleanup kill, the launch rollback and the
 *   recovery cleanup remove the worktree and the record of a session whose
 *   runtime may still run. The lifecycle lets an agent's negative overwrite a
 *   runtime probe that could not answer.
 * - B-7 (round R4): strict reads through the whole decision: the content of
 *   the latest archive in `hasOtherOpenCodeRecord`, a rejection of
 *   `workspace.exists` in the recovery validator, and the core Herdr helper,
 *   which answers "no process" for every failure.
 *
 * Each `defect` test fails on c516cead for the measured reason; the `it`
 * tests are controls that pass on c516cead and must stay green (a fix that
 * never removes anything, or never answers "gone", fails them).
 *
 * The B-6 tests use only the Runtime methods of c516cead (`destroy`,
 * `isAlive`): a fix that adds an acknowledged stop to the runtime plugins
 * must still handle a runtime without it (destroy, then a liveness check).
 *
 * Marking as in design r1 section 8.1: `defect(...)` is `it.fails`, and
 * `SAME_ID_DEFECTS=red` makes it a plain test. Each describe names its round.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import type * as OpenCodeApi from "../opencode-api.js";

/** Child processes: `herdr` goes to the stand-in below; every other command fails. */
const proc = vi.hoisted(() => ({
  herdr: null as null | ((args: string[]) => string),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const run = (cmd: string, args: string[]): string => {
    if (cmd === "herdr" && proc.herdr) return proc.herdr(args);
    throw Object.assign(new Error(`unexpected command: ${cmd}`), { code: "ENOENT" });
  };
  const execFile = ((cmd: string, args: string[], ...rest: unknown[]) => {
    const callback = rest.find((r) => typeof r === "function") as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    queueMicrotask(() => {
      try {
        callback?.(null, run(cmd, args), "");
      } catch (err) {
        callback?.(err as Error, "", (err as { stderr?: string }).stderr ?? "");
      }
    });
  }) as unknown as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => ({ stdout: run(cmd, args), stderr: "" }),
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

const api = vi.hoisted(() => ({
  remove: vi.fn(async (_id: string) => undefined),
  interrupt: vi.fn(async (_id: string) => ({ interrupted: true })),
}));

vi.mock("../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    removeOpenCodeSession: api.remove,
    interruptOpenCodeSession: api.interrupt,
    getOpenCodeSession: vi.fn(async () => null),
  };
});

import { createSessionManager } from "../session-manager.js";
import { createLifecycleManager } from "../lifecycle-manager.js";
import { readObservabilitySummary } from "../observability.js";
import {
  readArchivedMetadataRaw,
  readMetadataRaw,
  updateMetadata,
  writeMetadata,
} from "../metadata.js";
import { generateConfigHash, getWorktreesDir } from "../paths.js";
import { cleanupSession } from "../recovery/actions.js";
import { validateSession } from "../recovery/validator.js";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryAssessment } from "../recovery/types.js";
import { isHerdrProcessRunning } from "../herdr.js";
import {
  LAUNCH_GRACE_MS,
  type ActivityDetection,
  type LifecycleManager,
  type PluginRegistry,
  type Runtime,
  type RuntimeHandle,
  type SCM,
} from "../types.js";
import {
  createMockPlugins,
  createMockRegistry,
  createMockSCM,
  createTestEnvironment,
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
  type TestEnvironment,
} from "./test-utils.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

/** A test that needs a mode-000 file; root reads it anyway. */
function defectUnlessRoot(name: string, fn: () => Promise<void>): void {
  if (process.getuid?.() === 0) it.skip(name, fn);
  else defect(name, fn);
}

/** The rejection of a tmux probe that could not answer (a hidden or rebound socket, review B-5). */
function probeError(): Error {
  return Object.assign(
    new Error("tmux could not answer: the recorded server runs, its socket is gone"),
    {
      code: "ERR_RUNTIME_PROBE",
    },
  );
}

// ---------------------------------------------------------------------------
// R2, B-6: the callers of a runtime stop that cannot be confirmed
// ---------------------------------------------------------------------------

describe("[same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller", () => {
  let ctx: TestContext;
  let sessionsDir: string;

  beforeEach(() => {
    ctx = setupTestContext();
    ({ sessionsDir } = ctx);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // The workspace plugin keeps the contract of round 7: it runs the
    // caller's check directly before it removes the directory.
    vi.mocked(ctx.mockWorkspace.destroy).mockImplementation(async (path, stillOwned) => {
      await Promise.resolve();
      let owned: boolean;
      try {
        owned = stillOwned ? stillOwned() : true;
      } catch {
        owned = false;
      }
      if (owned) rmSync(path, { recursive: true, force: true });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardownTestContext(ctx);
  });

  function managedWorktree(id: string): string {
    const project = ctx.config.projects["my-app"]!;
    const path = join(getWorktreesDir(ctx.config.configPath, project.path), id);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "work.txt"), "uncommitted work of the live agent");
    return path;
  }

  function launchedRecord(id: string, worktree: string, fields: Record<string, string> = {}): void {
    writeMetadata(sessionsDir, id, {
      worktree,
      branch: `feat/${id}`,
      status: "working",
      project: "my-app",
      tmuxName: `hash-${id}`,
      createdAt: "2026-10-21T10:00:00.000Z",
      runtimeHandle: JSON.stringify(makeHandle(`rt-${id}`)),
    });
    if (Object.keys(fields).length > 0) updateMetadata(sessionsDir, id, fields);
  }

  /** The runtime cannot stop the session and cannot tell whether it runs (review B-5, B-6). */
  function stopUnknown(): void {
    vi.mocked(ctx.mockRuntime.destroy).mockRejectedValue(probeError());
    vi.mocked(ctx.mockRuntime.isAlive).mockRejectedValue(probeError());
  }

  it("kill: a destroy that rejects keeps the worktree and the record", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", worktree);
    stopUnknown();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1").catch(() => undefined);

    // Measured on c516cead: killRecord swallows the rejection
    // (session-manager.ts:2889-2893), removes the worktree and archives.
    expect(existsSync(worktree), "the worktree of a session that may still run was removed").toBe(
      true,
    );
    expect(readMetadataRaw(sessionsDir, "app-1"), "the record was archived").not.toBeNull();
  });

  it(
    "kill: a destroy that resolves while the session still runs keeps the worktree and the record",
    async () => {
      // A guarded destroy that kept the session (another launch, an
      // unsupported comparison) resolves like a completed kill (review B-6).
      const worktree = managedWorktree("app-1");
      launchedRecord("app-1", worktree);
      vi.mocked(ctx.mockRuntime.destroy).mockResolvedValue(undefined);
      vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await sm.kill("app-1").catch(() => undefined);

      expect(existsSync(worktree), "the worktree of a running session was removed").toBe(true);
      expect(readMetadataRaw(sessionsDir, "app-1"), "the record was archived").not.toBeNull();
    },
  );

  it("control: kill of a session whose runtime stops removes the worktree and archives the record", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", worktree);
    let alive = true;
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      alive = false;
    });
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async () => alive);
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1");

    expect(existsSync(worktree)).toBe(false);
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).not.toBeNull();
  });

  it(
    "cleanup of a merged PR: a destroy that rejects keeps the worktree and the record",
    async () => {
      // The PR and issue routes do not probe the runtime first (review B-6,
      // the per-command table): the kill's own destroy must decide.
      const worktree = managedWorktree("app-1");
      launchedRecord("app-1", worktree, {
        status: "pr_open",
        pr: "https://github.com/org/repo/pull/10",
      });
      stopUnknown();
      const scm: SCM = createMockSCM({ getPRState: vi.fn().mockResolvedValue("merged") });
      const registry: PluginRegistry = createMockRegistry({
        runtime: ctx.mockRuntime,
        agent: ctx.mockAgent,
        workspace: ctx.mockWorkspace,
        scm,
      });
      const sm = createSessionManager({ config: ctx.config, registry });

      await sm.cleanup("my-app").catch(() => undefined);

      expect(existsSync(worktree), "the worktree of a session that may still run was removed").toBe(
        true,
      );
      expect(readMetadataRaw(sessionsDir, "app-1"), "the record was archived").not.toBeNull();
    },
  );

  it("launch rollback: a destroy that rejects keeps the workspace and the record", async () => {
    const worktree = managedWorktree("app-1");
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path: worktree,
      branch: "session/app-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    vi.mocked(ctx.mockRuntime.destroy).mockRejectedValue(probeError());
    // The pane that the failed launch started still runs.
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      throw new Error("post-launch setup failed");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    // Measured on c516cead: rollbackLaunch swallows the rejection
    // (session-manager.ts:1758-1762), then removes the workspace and the record.
    expect(existsSync(worktree), "the workspace of a runtime that may still run was removed").toBe(
      true,
    );
    expect(
      readMetadataRaw(sessionsDir, "app-1"),
      "the record that names the runtime was released",
    ).not.toBeNull();
  });

  it(
    "orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one",
    async () => {
      // The delete strategy replaces a live orchestrator: today the destroy
      // rejection is dropped (session-manager.ts:2352-2354), the record is
      // deleted and a second orchestrator starts while the first may still run.
      const project = ctx.config.projects["my-app"]!;
      project.orchestratorWorkspaceMode = "project";
      project.orchestratorSessionStrategy = "delete";
      mkdirSync(project.path, { recursive: true });
      launchedRecord("app-orchestrator", project.path, { role: "orchestrator" });
      const before = readMetadataRaw(sessionsDir, "app-orchestrator");
      vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
      vi.mocked(ctx.mockRuntime.destroy).mockRejectedValue(probeError());
      vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orchestrator-2"));
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await sm
        .spawnOrchestrator({ projectId: "my-app", systemPrompt: "orchestrate" })
        .catch(() => undefined);

      expect(ctx.mockRuntime.create, "a second orchestrator was started").not.toHaveBeenCalled();
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")).toEqual(before);
    },
  );

  it("control: orchestrator start replaces a live orchestrator whose destroy completes", async () => {
    const project = ctx.config.projects["my-app"]!;
    project.orchestratorWorkspaceMode = "project";
    project.orchestratorSessionStrategy = "delete";
    mkdirSync(project.path, { recursive: true });
    launchedRecord("app-orchestrator", project.path, { role: "orchestrator" });
    let alive = true;
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async () => alive);
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      alive = false;
    });
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orchestrator-2"));
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "orchestrate" });

    expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toContain(
      "rt-orchestrator-2",
    );
  });

  /** app-1's pane still runs, but its agent exited: a restore relaunches it (step 7, then 8). */
  function restorableRecord(): string {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", worktree);
    vi.mocked(ctx.mockAgent.getActivityState).mockResolvedValue({ state: "exited" });
    vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(false);
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-app-1-restored"));
    return worktree;
  }

  it("restore: a destroy of the old pane that rejects creates no second runtime", async () => {
    // Today step 7 drops the rejection (session-manager.ts:4256-4262) and
    // step 8 creates a runtime. With a tmux name per launch (design r2,
    // R2b), tmux no longer refuses the second session by its name, so two
    // launches of app-1 would run.
    restorableRecord();
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    vi.mocked(ctx.mockRuntime.destroy).mockRejectedValue(probeError());
    const before = readMetadataRaw(sessionsDir, "app-1");
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.restore("app-1").catch(() => undefined);

    expect(ctx.mockRuntime.create, "a second runtime of app-1 was created").not.toHaveBeenCalled();
    expect(readMetadataRaw(sessionsDir, "app-1")?.["runtimeHandle"]).toBe(
      before?.["runtimeHandle"],
    );
  });

  it("control: restore relaunches a session whose old pane stops", async () => {
    restorableRecord();
    let alive = true;
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async () => alive);
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      alive = false;
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.restore("app-1");

    expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
    expect(readMetadataRaw(sessionsDir, "app-1")?.["runtimeHandle"]).toContain("rt-app-1-restored");
  });

  it("recovery cleanup: a destroy that rejects keeps the worktree and the record", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", worktree);
    const rawMetadata = readMetadataRaw(sessionsDir, "app-1")!;
    vi.mocked(ctx.mockRuntime.destroy).mockRejectedValue(probeError());
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    const assessment = {
      sessionId: "app-1",
      projectId: "my-app",
      classification: "partial",
      action: "cleanup",
      reason: "partial",
      runtimeAlive: true,
      runtimeHandle: makeHandle("rt-app-1"),
      workspaceExists: true,
      workspacePath: worktree,
      agentProcessRunning: false,
      agentActivity: null,
      metadataValid: true,
      metadataStatus: "working",
      rawMetadata,
    } as RecoveryAssessment;

    const result = await cleanupSession(assessment, ctx.config, ctx.mockRegistry, {
      configPath: ctx.config.configPath,
      recoveryConfig: { ...DEFAULT_RECOVERY_CONFIG, logPath: join(ctx.tmpDir, "recovery.log") },
      dryRun: false,
    });

    // Measured on c516cead: recovery/actions.ts:164-169 swallows the
    // rejection, removes the worktree and archives the record.
    expect(existsSync(worktree), "the worktree of a session that may still run was removed").toBe(
      true,
    );
    expect(readMetadataRaw(sessionsDir, "app-1"), "the record was archived").not.toBeNull();
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2, B-6 (lifecycle): an agent's negative must not overwrite an unknown runtime
// ---------------------------------------------------------------------------

describe("[same-id R2] B-6: the lifecycle keeps a session whose runtime probe could not answer", () => {
  let env: TestEnvironment;
  let lifecycle: LifecycleManager | null = null;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  afterEach(() => {
    lifecycle?.stop();
    lifecycle = null;
    env.cleanup();
  });

  const EXITED: ActivityDetection = { state: "exited", timestamp: new Date() };

  function handleOf(sessionId: string): RuntimeHandle {
    return {
      id: `${generateConfigHash(env.config.configPath)}-${sessionId}`,
      runtimeName: "tmux",
      data: {},
    };
  }

  function writeRecord(sessionId: string): void {
    const handle = handleOf(sessionId);
    writeMetadata(env.sessionsDir, sessionId, {
      worktree: "/tmp",
      branch: "main",
      status: "working",
      tmuxName: handle.id,
      project: "my-app",
      createdAt: new Date(Date.now() - LAUNCH_GRACE_MS - 60_000).toISOString(),
      runtimeHandle: JSON.stringify(handle),
    });
  }

  function status(sessionId: string): string {
    return readMetadataRaw(env.sessionsDir, sessionId)?.["status"] ?? "(none)";
  }

  /** app-1: the runtime probe rejects (unknown) and the agent says exited; app-2 is alive. */
  function start(agentName: string, runtimeOfApp1: "unknown" | "alive"): LifecycleManager {
    const plugins = createMockPlugins();
    const runtime: Runtime = { ...plugins.runtime, name: "tmux", getMetrics: vi.fn() };
    const agent = { ...plugins.agent, name: agentName };
    vi.mocked(runtime.isAlive).mockImplementation(async (handle: RuntimeHandle) => {
      if (handle.id === handleOf("app-1").id && runtimeOfApp1 === "unknown") throw probeError();
      return true;
    });
    vi.mocked(agent.getActivityState).mockImplementation(async (session) =>
      session.id === "app-1" ? EXITED : { state: "active" },
    );
    vi.mocked(agent.isProcessRunning).mockImplementation(
      async (handle: RuntimeHandle) => handle.id !== handleOf("app-1").id,
    );
    const registry = createMockRegistry({ runtime, agent });
    const sessionManager = createSessionManager({ config: env.config, registry });
    lifecycle = createLifecycleManager({
      config: env.config,
      registry,
      sessionManager,
      projectId: "my-app",
    });
    return lifecycle;
  }

  function workerHealth() {
    return readObservabilitySummary(env.config).projects["my-app"]?.health["lifecycle.worker"];
  }

  async function pollOnce(lm: LifecycleManager): Promise<void> {
    const before = workerHealth()?.correlationId;
    lm.start(3_600_000);
    lm.stop();
    await vi.waitFor(() => expect(workerHealth()?.correlationId).not.toBe(before), {
      timeout: 2_000,
      interval: 5,
    });
  }

  for (const agentName of ["codex", "claude-code"]) {
    defect(
      `${agentName}: a runtime probe that rejects plus the agent's 'exited' does not reach killed`,
      async () => {
        writeRecord("app-1");
        writeRecord("app-2");
        const lm = start(agentName, "unknown");
        for (let poll = 0; poll < 3; poll++) await pollOnce(lm);
        // Measured on c516cead: lifecycle-manager.ts:640-642 stores the
        // rejection as "failed", :658 still runs the agent check, and :680-684
        // replace "failed" by the agent's negative; app-2 answers alive, so
        // nothing holds it back and app-1 is killed at the second poll.
        expect(status("app-1"), "a session whose runtime could not be checked was killed").toBe(
          "working",
        );
      },
    );
  }

  it("control: codex: the runtime answers alive and the agent says exited: killed at the second poll", async () => {
    writeRecord("app-1");
    writeRecord("app-2");
    const lm = start("codex", "alive");
    await pollOnce(lm);
    expect(status("app-1")).toBe("working");
    await pollOnce(lm);
    expect(status("app-1")).toBe("killed");
    expect(status("app-2")).toBe("working");
  });
});

// ---------------------------------------------------------------------------
// R4, B-7: strict reads through the whole decision
// ---------------------------------------------------------------------------

describe("[same-id R4] B-7 item 1: hasOtherOpenCodeRecord reads the content of the latest archive", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestContext();
    api.remove.mockClear();
    api.interrupt.mockClear();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardownTestContext(ctx);
  });

  function deadOpenCodeSession(): void {
    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree: join(ctx.tmpDir, "ws-app-1"),
      branch: "feat/INT-1",
      status: "working",
      project: "my-app",
      agent: "opencode",
      opencodeSessionId: "ses_shared",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-21T10:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
    });
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(false);
  }

  defectUnlessRoot(
    "cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name",
    async () => {
      deadOpenCodeSession();
      // The archive directory is readable; the latest archive of app-2 (issue
      // reuse gave it ses_shared) cannot be read (review B-7 item 1).
      const archive = join(ctx.sessionsDir, "archive");
      mkdirSync(archive, { recursive: true });
      const holder = join(archive, "app-2_2026-10-21T10-00-00-000Z");
      writeFileSync(holder, "opencodeSessionId=ses_shared\n", { mode: 0o000 });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
      try {
        await sm.cleanup("my-app").catch(() => undefined);
        // Measured (review B-7, and on c516cead here): readArchivedMetadataRaw
        // answers null for the unreadable file, hasOtherOpenCodeRecord answers
        // "no other record", and the cleanup kill removes the session.
        expect(api.remove).not.toHaveBeenCalled();
      } finally {
        chmodSync(holder, 0o600);
      }
    },
  );

  it("control: no archive and no other record name the session: the cleanup removes it", async () => {
    deadOpenCodeSession();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    await sm.cleanup("my-app");
    expect(api.remove).toHaveBeenCalledTimes(1);
    expect(api.remove.mock.calls[0]?.[0]).toBe("ses_shared");
  });
});

describe("[same-id R4] B-7 item 2: the recovery validator keeps a workspace check that rejects as unknown", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    teardownTestContext(ctx);
  });

  async function assess(exists: () => Promise<boolean>) {
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(true);
    ctx.mockWorkspace.exists = vi.fn(exists);
    return validateSession(
      {
        sessionId: "app-1",
        projectId: "my-app",
        project: ctx.config.projects["my-app"]!,
        sessionsDir: ctx.sessionsDir,
        rawMetadata: {
          worktree: join(ctx.tmpDir, "missing-path"),
          branch: "feat/live",
          status: "working",
          project: "my-app",
          runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
        },
      },
      ctx.config,
      ctx.mockRegistry,
      { escalatePartial: false },
    );
  }

  defect(
    "a workspace.exists that rejects (git could not start) gives a live session no action",
    async () => {
      const assessment = await assess(async () => {
        throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
      });
      // Measured (review B-7 item 2, and on c516cead here): validator.ts:87-93
      // swallows the rejection as "no workspace", and the live session gets
      // the cleanup action (the runtime is destroyed, recovery/actions.ts:166).
      expect(assessment.action).toBe("skip");
      expect(assessment.reason).toMatch(/workspace/i);
    },
  );

  it("control: a workspace.exists that answers false is an authoritative 'missing' (not unknown)", async () => {
    const assessment = await assess(async () => false);
    expect(assessment.action).not.toBe("skip");
  });
});

describe("[same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check", () => {
  afterEach(() => {
    proc.herdr = null;
  });

  const CLAUDE_RE = /(?:^|\/)claude(?:\s|$)/;

  function herdrAnswers(answer: () => string): void {
    proc.herdr = () => answer();
  }

  function processInfo(processes: unknown[]): string {
    return JSON.stringify({
      id: "cli:pane:process_info",
      result: {
        process_info: { foreground_processes: processes, pane_id: "w7:p1", shell_pid: 2 },
        type: "pane_process_info",
      },
    });
  }

  const failures: [string, () => string][] = [
    [
      "the herdr binary cannot start",
      () => {
        throw Object.assign(new Error("spawn herdr ENOENT"), { code: "ENOENT", errno: -2 });
      },
    ],
    [
      "the herdr command times out",
      () => {
        throw Object.assign(new Error("Command failed: herdr pane process-info"), {
          killed: true,
          signal: "SIGTERM",
          code: null,
        });
      },
    ],
    ["herdr answers text that is not JSON", () => "herdr: internal error\n"],
    [
      "herdr answers an error envelope that is not 'pane not found'",
      () => JSON.stringify({ error: { code: "server_unavailable", message: "no server" } }),
    ],
    ["herdr answers a result without process_info", () => JSON.stringify({ id: "x", result: {} })],
  ];

  for (const [label, answer] of failures) {
    defect(`isHerdrProcessRunning rejects when ${label}`, async () => {
      herdrAnswers(answer);
      // Measured in code (core/src/herdr.ts:43-76): every failure answers []
      // and so "no agent process"; all four agents call it for Herdr panes.
      await expect(isHerdrProcessRunning("w7:p1", CLAUDE_RE)).rejects.toThrow();
    });
  }

  it("control: an explicit 'pane not found' answers false", async () => {
    herdrAnswers(() => JSON.stringify({ error: { code: "pane_not_found", message: "gone" } }));
    await expect(isHerdrProcessRunning("w7:p1", CLAUDE_RE)).resolves.toBe(false);
  });

  it("control: a valid empty process list answers false", async () => {
    herdrAnswers(() => processInfo([]));
    await expect(isHerdrProcessRunning("w7:p1", CLAUDE_RE)).resolves.toBe(false);
  });

  it("control: a listed agent process answers true", async () => {
    herdrAnswers(() =>
      processInfo([
        { pid: 4242, name: "claude", cmdline: "claude --model sonnet", argv: ["claude"] },
      ]),
    );
    await expect(isHerdrProcessRunning("w7:p1", CLAUDE_RE)).resolves.toBe(true);
  });
});
