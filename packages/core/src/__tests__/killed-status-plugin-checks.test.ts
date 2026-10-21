/**
 * Round 7 of the killed-status fix (development/reviews/killed_status_review_r5_astra6.md).
 *
 * M-2: the workspace plugin's `destroy` awaits inside its step. Core passes
 * its ownership check to it, and the plugin runs it again directly before
 * each of its own removal calls. These tests use stand-in plugins that keep
 * that contract (their own step awaits, another process acts meanwhile, then
 * they run the check); the real plugins are tested in their own packages,
 * also through the session manager.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../session-manager.js";
import {
  deleteMetadata,
  readArchivedMetadataRaw,
  readMetadataRaw,
  reserveSessionId,
  updateMetadata,
  writeMetadata,
} from "../metadata.js";
import { getWorktreesDir } from "../paths.js";
import { cleanupSession } from "../recovery/actions.js";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryAssessment } from "../recovery/types.js";
import type { RuntimeHandle } from "../types.js";
import {
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

let ctx: TestContext;
let sessionsDir: string;

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

function recordOf(id: string): Record<string, string> | null {
  return readMetadataRaw(sessionsDir, id);
}

function managedWorktree(id: string): string {
  const project = ctx.config.projects["my-app"]!;
  const path = join(getWorktreesDir(ctx.config.configPath, project.path), id);
  mkdirSync(path, { recursive: true });
  return path;
}

/** A launched record of `id` (the shape that a spawn writes after `runtime.create`). */
function launchedRecord(id: string, fields: Partial<Record<string, string>> = {}): void {
  writeMetadata(sessionsDir, id, {
    worktree: join(ctx.tmpDir, `ws-${id}`),
    branch: "feat/old",
    status: "working",
    project: "my-app",
    tmuxName: `hash-${id}`,
    createdAt: "2026-10-20T10:00:00.000Z",
    runtimeHandle: JSON.stringify(makeHandle(`rt-${id}`)),
  });
  if (Object.keys(fields).length > 0) updateMetadata(sessionsDir, id, fields);
}

/** Another process archives the record of `id` and publishes a new launch of the ID. */
function publishNewLaunch(
  id: string,
  fields: Partial<Record<string, string>> = {},
  handle: RuntimeHandle = makeHandle("rt-new"),
): Record<string, string> {
  deleteMetadata(sessionsDir, id, true);
  expect(reserveSessionId(sessionsDir, id)).toBe(true);
  expect(
    updateMetadata(sessionsDir, id, {
      branch: "feat/new-launch",
      status: "working",
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

/**
 * A workspace plugin that keeps the round-7 contract: its own step awaits
 * (`during` runs there, as another process acts meanwhile), then it runs the
 * caller's check directly before it removes the directory.
 */
function contractDestroy(during: () => void = () => undefined): void {
  vi.mocked(ctx.mockWorkspace.destroy).mockImplementation(async (path, stillOwned) => {
    await Promise.resolve();
    during();
    if (stillOwned && !stillOwned()) return "kept";
    rmSync(path, { recursive: true, force: true });
    return undefined;
  });
}

describe("M-2 (round 7): core passes its ownership check to the workspace destroy", () => {
  it("kill: a new launch during the plugin's own wait keeps the worktree and ends the kill", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", { worktree });
    let replacement: Record<string, string> | undefined;
    contractDestroy(() => {
      replacement = publishNewLaunch("app-1", { worktree });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1")).rejects.toThrow(
      /Session app-1 changed while it was killed .*its worktree, agent session and record were kept/,
    );
    expect(existsSync(worktree)).toBe(true);
    expect(recordOf("app-1")).toEqual(replacement);
  });

  it("control: kill, nothing changes, the plugin removes the worktree and the record is archived", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", { worktree });
    contractDestroy();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1");

    expect(existsSync(worktree)).toBe(false);
    expect(recordOf("app-1")).toBeNull();
  });

  /** A spawn whose launch fails after the managed worktree exists. */
  function failingSpawnWorkspace(): string {
    const worktree = managedWorktree("app-1");
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path: worktree,
      branch: "session/app-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    vi.mocked(ctx.mockRuntime.create).mockRejectedValue(new Error("runtime creation failed"));
    return worktree;
  }

  it("spawn rollback: a new launch during the plugin's own wait keeps the worktree", async () => {
    const worktree = failingSpawnWorkspace();
    let replacement: Record<string, string> | undefined;
    contractDestroy(() => {
      replacement = publishNewLaunch("app-1", { worktree });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("runtime creation failed");
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledTimes(1);
    expect(existsSync(worktree)).toBe(true);
    expect(recordOf("app-1")).toEqual(replacement);
  });

  it("control: spawn rollback, nothing changes, the worktree and the reservation go", async () => {
    const worktree = failingSpawnWorkspace();
    contractDestroy();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("runtime creation failed");
    expect(existsSync(worktree)).toBe(false);
    expect(recordOf("app-1")).toBeNull();
  });

  /** An isolated orchestrator start (app-orchestrator-1) on its own worktree. */
  function isolatedOrchestratorWorkspace(): string {
    const worktree = join(ctx.tmpDir, "orchestrator-ws");
    mkdirSync(worktree, { recursive: true });
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path: worktree,
      branch: "orchestrator/app-orchestrator-1",
      sessionId: "app-orchestrator-1",
      projectId: "my-app",
    });
    return worktree;
  }

  it("orchestrator, a failed workspace hook: a new launch during the plugin's own wait keeps the worktree", async () => {
    const worktree = isolatedOrchestratorWorkspace();
    ctx.mockAgent.setupWorkspaceHooks = vi.fn(async () => {
      throw new Error("workspace hooks failed");
    });
    let replacement: Record<string, string> | undefined;
    contractDestroy(() => {
      replacement = publishNewLaunch("app-orchestrator-1", { worktree });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "workspace hooks failed",
    );
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledTimes(1);
    expect(existsSync(worktree)).toBe(true);
    expect(recordOf("app-orchestrator-1")).toEqual(replacement);
  });

  it("orchestrator, a failed launch: a new launch during the plugin's own wait keeps the worktree", async () => {
    const worktree = isolatedOrchestratorWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockRejectedValue(new Error("runtime creation failed"));
    let replacement: Record<string, string> | undefined;
    contractDestroy(() => {
      replacement = publishNewLaunch("app-orchestrator-1", { worktree });
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "runtime creation failed",
    );
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledTimes(1);
    expect(existsSync(worktree)).toBe(true);
    expect(recordOf("app-orchestrator-1")).toEqual(replacement);
  });

  it("control: orchestrator, a failed launch, nothing changes: the worktree and the reservation go", async () => {
    const worktree = isolatedOrchestratorWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockRejectedValue(new Error("runtime creation failed"));
    contractDestroy();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "runtime creation failed",
    );
    expect(existsSync(worktree)).toBe(false);
    expect(recordOf("app-orchestrator-1")).toBeNull();
  });

  function assessment(): RecoveryAssessment {
    const rawMetadata = recordOf("app-1")!;
    return {
      sessionId: "app-1",
      projectId: "my-app",
      classification: "dead",
      action: "cleanup",
      reason: "dead",
      runtimeAlive: false,
      runtimeHandle: makeHandle("rt-app-1"),
      workspaceExists: true,
      workspacePath: rawMetadata["worktree"] ?? null,
      agentProcessRunning: false,
      agentActivity: null,
      metadataValid: true,
      metadataStatus: "working",
      rawMetadata,
    } as RecoveryAssessment;
  }

  const recoveryContext = () => ({
    configPath: ctx.config.configPath,
    recoveryConfig: { ...DEFAULT_RECOVERY_CONFIG, logPath: join(ctx.tmpDir, "recovery.log") },
    dryRun: false,
  });

  it("recovery cleanup: a new launch during the plugin's own wait keeps the worktree and its record", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", { worktree });
    const assessed = assessment();
    let replacement: Record<string, string> | undefined;
    contractDestroy(() => {
      replacement = publishNewLaunch("app-1", { worktree });
    });

    const result = await cleanupSession(assessed, ctx.config, ctx.mockRegistry, recoveryContext());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/changed after the assessment; nothing was written/);
    expect(existsSync(worktree)).toBe(true);
    expect(recordOf("app-1")).toEqual(replacement);
  });

  it("control: recovery cleanup, nothing changes, the worktree goes and the record is archived", async () => {
    const worktree = managedWorktree("app-1");
    launchedRecord("app-1", { worktree });
    const assessed = assessment();
    contractDestroy();

    const result = await cleanupSession(assessed, ctx.config, ctx.mockRegistry, recoveryContext());

    expect(result.success).toBe(true);
    expect(existsSync(worktree)).toBe(false);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({ status: "terminated" });
  });
});

