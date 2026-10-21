/**
 * Same-ID R2a: every caller of a runtime stop goes on only after `destroyed`
 * or `absent` (design r2 section 2.6, the callers table). Each caller runs
 * with each outcome of an optional `Runtime.stop`, and with the fallback of
 * a runtime without it whose destroy resolves while the session still runs
 * (review r2: the resolved-but-live case). On a refusal the record, the
 * worktree and the runtime calls stay unchanged and no runtime is created;
 * `destroyed` and `absent` are the healthy controls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../session-manager.js";
import {
  deleteMetadata,
  readArchivedMetadataRaw,
  readMetadataRaw,
  updateMetadata,
  writeMetadata,
} from "../metadata.js";
import { getWorktreesDir } from "../paths.js";
import { cleanupSession } from "../recovery/actions.js";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryAssessment } from "../recovery/types.js";
import { isRuntimeStopUnconfirmedError } from "../runtime-stop.js";
import type { PluginRegistry, RuntimeStopOutcome, SCM, Tracker } from "../types.js";
import {
  createMockRegistry,
  createMockSCM,
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

/** How the runtime answers the stop. */
type Mode = "destroyed" | "absent" | "other-launch" | "unknown" | "fallback: still runs";

const MODES: Mode[] = ["destroyed", "absent", "other-launch", "unknown", "fallback: still runs"];

/** The outcome that a caller sees for each mode. */
const OUTCOME: Record<Mode, RuntimeStopOutcome["outcome"]> = {
  destroyed: "destroyed",
  absent: "absent",
  "other-launch": "other-launch",
  unknown: "unknown",
  "fallback: still runs": "unknown",
};

function goesOn(mode: Mode): boolean {
  return mode === "destroyed" || mode === "absent";
}

let ctx: TestContext;
let sessionsDir: string;
let stderr: string[];

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  // The workspace plugin runs the caller's check directly before it removes.
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

/**
 * Set how the runtime answers the stop. `aliveBeforeStop` is the liveness
 * that the caller's own checks read before it stops the runtime.
 */
function stopAnswers(mode: Mode, aliveBeforeStop = true): void {
  if (mode === "fallback: still runs") {
    // No Runtime.stop: destroy resolves, and the session still runs after it.
    let destroyed = false;
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      destroyed = true;
    });
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async () =>
      destroyed ? true : aliveBeforeStop,
    );
    return;
  }
  const answers: Record<Exclude<Mode, "fallback: still runs">, RuntimeStopOutcome> = {
    destroyed: { outcome: "destroyed" },
    absent: { outcome: "absent", evidence: "the runtime said: no such session" },
    "other-launch": { outcome: "other-launch", detail: "the address now names another launch" },
    unknown: { outcome: "unknown", detail: "the runtime server did not answer" },
  };
  ctx.mockRuntime.stop = vi.fn(async () => answers[mode]);
  vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(aliveBeforeStop);
}

/** The runtime calls that a refusal must not make. */
function expectNoRuntimeChange(mode: Mode): void {
  expect(ctx.mockRuntime.create, "a runtime was created").not.toHaveBeenCalled();
  if (mode !== "fallback: still runs") {
    expect(ctx.mockRuntime.stop).toHaveBeenCalledTimes(1);
    expect(ctx.mockRuntime.destroy, "destroy ran beside Runtime.stop").not.toHaveBeenCalled();
  }
}

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

function expectKept(worktree: string, before: Record<string, string> | null): void {
  expect(existsSync(worktree), "the worktree was removed").toBe(true);
  expect(readFileSync(join(worktree, "work.txt"), "utf-8")).toBe(
    "uncommitted work of the live agent",
  );
  expect(readMetadataRaw(sessionsDir, "app-1"), "the record changed").toEqual(before);
  expect(readArchivedMetadataRaw(sessionsDir, "app-1"), "the record was archived").toBeNull();
}

function expectRemoved(worktree: string): void {
  expect(existsSync(worktree)).toBe(false);
  expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
  expect(readArchivedMetadataRaw(sessionsDir, "app-1")).not.toBeNull();
}

describe("kill", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "removes the worktree and archives the record" : "refuses; record, worktree and runtime unchanged"}`, async () => {
      const worktree = managedWorktree("app-1");
      launchedRecord("app-1", worktree);
      stopAnswers(mode);
      const before = readMetadataRaw(sessionsDir, "app-1");
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      const result = await sm.kill("app-1").then(
        () => null,
        (err: unknown) => err,
      );

      if (goesOn(mode)) {
        expect(result).toBeNull();
        expectRemoved(worktree);
        return;
      }
      expect(isRuntimeStopUnconfirmedError(result)).toBe(true);
      expect((result as Error).message).toContain(`runtime stop unconfirmed (${OUTCOME[mode]})`);
      expect((result as Error).message).toContain("record and worktree kept");
      expect((result as { hint: string }).hint).toContain("`ao session kill app-1`");
      expectKept(worktree, before);
      expectNoRuntimeChange(mode);
      expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
    });
  }
});

describe("cleanup, every route", () => {
  type Route = "runtime" | "merged PR" | "closed issue";

  function registryFor(route: Route): PluginRegistry {
    const scm: SCM = createMockSCM({
      getPRState: vi.fn().mockResolvedValue(route === "merged PR" ? "merged" : "open"),
    });
    const tracker = {
      name: "github",
      isCompleted: vi.fn().mockResolvedValue(route === "closed issue"),
    } as unknown as Tracker;
    const base = createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
    return {
      ...base,
      get: vi.fn((slot: string, name?: string) =>
        slot === "tracker" ? tracker : base.get(slot as never, name as never),
      ) as PluginRegistry["get"],
    };
  }

  for (const route of ["runtime", "merged PR", "closed issue"] as Route[]) {
    for (const mode of MODES) {
      it(`${route} route, ${mode}: ${goesOn(mode) ? "cleaned" : "kept and reported"}`, async () => {
        const worktree = managedWorktree("app-1");
        launchedRecord("app-1", worktree, {
          status: route === "merged PR" ? "pr_open" : "working",
          ...(route === "merged PR" && { pr: "https://github.com/org/repo/pull/10" }),
          ...(route === "closed issue" && { issue: "INT-7" }),
        });
        // The runtime route kills a session whose runtime answers dead; the PR
        // and issue routes do not probe first, so the session still runs.
        stopAnswers(mode, route !== "runtime");
        const before = readMetadataRaw(sessionsDir, "app-1");
        const sm = createSessionManager({ config: ctx.config, registry: registryFor(route) });

        const result = await sm.cleanup("my-app");

        if (goesOn(mode)) {
          expect(result.killed).toContain("app-1");
          expectRemoved(worktree);
          return;
        }
        expect(result.killed).not.toContain("app-1");
        const error = result.errors.find((e) => e.sessionId === "app-1")?.error ?? "";
        expect(error).toMatch(/^kept: runtime stop unconfirmed/);
        expect(error).toContain(`(${OUTCOME[mode]})`);
        expect(error).toContain("`ao session cleanup`");
        expectKept(worktree, before);
        expectNoRuntimeChange(mode);
      });
    }
  }
});

describe("launch rollback", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "removes the workspace and the record" : "keeps the workspace and the record, with launchFailed"}`, async () => {
      const worktree = managedWorktree("app-1");
      vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
        path: worktree,
        branch: "session/app-1",
        sessionId: "app-1",
        projectId: "my-app",
      });
      vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
      stopAnswers(mode);
      ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
        throw new Error("post-launch setup failed");
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      // The launch created its own runtime; the rollback creates none.
      expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
      if (goesOn(mode)) {
        expect(existsSync(worktree)).toBe(false);
        expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
        return;
      }
      expect(existsSync(worktree), "the workspace of a runtime that may run was removed").toBe(
        true,
      );
      const record = readMetadataRaw(sessionsDir, "app-1");
      expect(record?.["runtimeHandle"]).toBe(JSON.stringify(makeHandle("rt-spawned")));
      expect(record?.["launchFailed"]).toContain("post-launch setup failed");
      expect(record?.["launchFailed"]).toContain(`runtime stop unconfirmed (${OUTCOME[mode]})`);
      expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
      if (mode !== "fallback: still runs") {
        expect(ctx.mockRuntime.stop).toHaveBeenCalledTimes(1);
        expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
      }
      const warned = stderr.join("");
      expect(warned).toContain("the failed launch of app-1 was not rolled back");
      expect(warned).toContain("`ao session kill app-1`");
    });
  }
});

describe("orchestrator start, delete strategy: replacement of a live orchestrator", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "replaces it" : "refuses; its record stays and no second one starts"}`, async () => {
      const project = ctx.config.projects["my-app"]!;
      project.orchestratorWorkspaceMode = "project";
      project.orchestratorSessionStrategy = "delete";
      mkdirSync(project.path, { recursive: true });
      launchedRecord("app-orchestrator", project.path, { role: "orchestrator" });
      stopAnswers(mode);
      vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orchestrator-2"));
      const before = readMetadataRaw(sessionsDir, "app-orchestrator");
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      const result = await sm
        .spawnOrchestrator({ projectId: "my-app", systemPrompt: "orchestrate" })
        .then(
          () => null,
          (err: unknown) => err,
        );

      if (goesOn(mode)) {
        expect(result).toBeNull();
        expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
        expect(readMetadataRaw(sessionsDir, "app-orchestrator")?.["runtimeHandle"]).toContain(
          "rt-orchestrator-2",
        );
        return;
      }
      expect(isRuntimeStopUnconfirmedError(result)).toBe(true);
      expect((result as Error).message).toContain(`runtime stop unconfirmed (${OUTCOME[mode]})`);
      expect((result as { hint: string }).hint).toContain("`ao start`");
      expect(readMetadataRaw(sessionsDir, "app-orchestrator")).toEqual(before);
      expectNoRuntimeChange(mode);
    });
  }
});

describe("orchestrator start, reuse strategy: the orphan runtime of an archived record", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "stops it and starts a new one" : "refuses; no record and no runtime for the ID"}`, async () => {
      const project = ctx.config.projects["my-app"]!;
      project.orchestratorWorkspaceMode = "project";
      project.orchestratorSessionStrategy = "reuse";
      mkdirSync(project.path, { recursive: true });
      launchedRecord("app-orchestrator", project.path, { role: "orchestrator" });
      stopAnswers(mode);
      // The record is archived while its liveness is checked; its runtime runs.
      const liveness = vi.mocked(ctx.mockRuntime.isAlive).getMockImplementation();
      vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (handle) => {
        if (readMetadataRaw(sessionsDir, "app-orchestrator")) {
          deleteMetadata(sessionsDir, "app-orchestrator", true);
        }
        return liveness ? liveness(handle) : true;
      });
      vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-orchestrator-2"));
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      const result = await sm
        .spawnOrchestrator({ projectId: "my-app", systemPrompt: "orchestrate" })
        .then(
          () => null,
          (err: unknown) => err,
        );

      if (goesOn(mode)) {
        expect(result).toBeNull();
        expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
        return;
      }
      expect(isRuntimeStopUnconfirmedError(result)).toBe(true);
      expect(readMetadataRaw(sessionsDir, "app-orchestrator"), "a record was reserved").toBeNull();
      expectNoRuntimeChange(mode);
    });
  }
});

describe("restore (N-2)", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "relaunches" : "refuses; no second runtime, record and worktree unchanged"}`, async () => {
      const worktree = managedWorktree("app-1");
      launchedRecord("app-1", worktree);
      vi.mocked(ctx.mockAgent.getActivityState).mockResolvedValue({ state: "exited" });
      vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(false);
      vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-app-1-restored"));
      stopAnswers(mode);
      const before = readMetadataRaw(sessionsDir, "app-1");
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      const result = await sm.restore("app-1").then(
        () => null,
        (err: unknown) => err,
      );

      if (goesOn(mode)) {
        expect(result).toBeNull();
        expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
        expect(readMetadataRaw(sessionsDir, "app-1")?.["runtimeHandle"]).toContain(
          "rt-app-1-restored",
        );
        return;
      }
      expect(isRuntimeStopUnconfirmedError(result)).toBe(true);
      expect((result as Error).message).toContain("no new runtime was created");
      expect((result as { hint: string }).hint).toContain("`ao session restore app-1`");
      expectKept(worktree, before);
      expectNoRuntimeChange(mode);
    });
  }
});

describe("recovery cleanupSession", () => {
  for (const mode of MODES) {
    it(`${mode}: ${goesOn(mode) ? "removes the worktree and archives" : "fails; worktree and record kept"}`, async () => {
      const worktree = managedWorktree("app-1");
      launchedRecord("app-1", worktree);
      const rawMetadata = readMetadataRaw(sessionsDir, "app-1")!;
      stopAnswers(mode);
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

      if (goesOn(mode)) {
        expect(result.success).toBe(true);
        expectRemoved(worktree);
        return;
      }
      expect(result.success).toBe(false);
      expect(result.error).toContain(`runtime stop unconfirmed (${OUTCOME[mode]})`);
      expectKept(worktree, rawMetadata);
      expectNoRuntimeChange(mode);
    });
  }
});
