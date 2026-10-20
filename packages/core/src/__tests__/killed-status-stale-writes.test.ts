/**
 * Round 4 of the killed-status fix (development/reviews/killed_status_review_r2_sol61.md, B-1):
 * an operation that reads a session record, awaits a slow step (a checkout,
 * `runtime.create`, a probe) and then writes never commits a stale decision.
 * It writes only into the version that it decided from or wrote last; when
 * the record was archived, replaced by a new reservation or a newer launch
 * (or, for a version compare, written by another process), it writes
 * nothing, and no writer recreates a missing record.
 *
 * Each test runs the real session manager (or recovery action); a stand-in
 * callback of the slow step changes the record as another process would.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
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
import { interruptOpenCodeSession, removeOpenCodeSession } from "../opencode-api.js";
import { cleanupSession, escalateSession, recoverSession } from "../recovery/actions.js";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryAssessment } from "../recovery/types.js";
import type * as DeliveryLedger from "../delivery-ledger.js";
import type * as OpenCodeApi from "../opencode-api.js";
import type { OrchestratorConfig, PluginRegistry, RuntimeHandle, SCM } from "../types.js";
import {
  createMockRegistry,
  createMockSCM,
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

/**
 * remap's OpenCode discovery, replaced by a stand-in (no OpenCode call):
 * `during` runs inside the discovery, as another process would change the
 * record meanwhile; the stand-in then finds one candidate.
 */
const discovery = vi.hoisted(() => ({
  during: null as null | (() => void),
  /** Runs inside the removal of an OpenCode session (a stand-in that removes nothing). */
  duringRemove: null as null | (() => void),
  /** Runs inside the removal of a delivery ledger (a stand-in that removes nothing). */
  duringLedgerRemove: null as null | (() => void),
}));
vi.mock("../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    findOpenCodeSessionsByTitle: vi.fn(async () => {
      discovery.during?.();
      return [{ id: "ses_fresh", title: "AO:app-1" }];
    }),
    removeOpenCodeSession: vi.fn(async () => {
      discovery.duringRemove?.();
    }),
    interruptOpenCodeSession: vi.fn(async () => ({ interrupted: true })),
  };
});
vi.mock("../delivery-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLedger>();
  return {
    ...actual,
    removeDeliveryLedger: vi.fn(async () => {
      discovery.duringLedgerRemove?.();
    }),
  };
});

let ctx: TestContext;
let sessionsDir: string;
let config: OrchestratorConfig;

beforeEach(() => {
  discovery.during = null;
  discovery.duringRemove = null;
  discovery.duringLedgerRemove = null;
  vi.mocked(removeOpenCodeSession).mockClear();
  vi.mocked(interruptOpenCodeSession).mockClear();
  ctx = setupTestContext();
  ({ sessionsDir, config } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

const PR2 = "https://github.com/org/my-app/pull/2";

function recordOf(id: string): Record<string, string> | null {
  return readMetadataRaw(sessionsDir, id);
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
function publishNewLaunch(id: string, handle: RuntimeHandle = makeHandle("rt-new")): void {
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
    }),
  ).toBe(true);
}

describe("1.1 item 1: claimPR writes only into the version it read before the checkout", () => {
  function claimRegistry(checkoutPR: SCM["checkoutPR"]): PluginRegistry {
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
      checkoutPR,
    });
    return createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: ctx.mockWorkspace,
      scm,
    });
  }

  it("review case 1: an archive plus a new reservation of the ID during the checkout fails the claim and keeps the reservation", async () => {
    launchedRecord("app-1");
    let reservation: Record<string, string> | null = null;
    const sm = createSessionManager({
      config,
      registry: claimRegistry(
        vi.fn(async () => {
          reservation = archiveAndReserve("app-1");
          return true;
        }),
      ),
    });

    await expect(sm.claimPR("app-1", "2")).rejects.toThrow(
      /Session app-1 changed while PR #2 was claimed .*its record was not written/,
    );
    expect(recordOf("app-1")).toEqual(reservation);
    expect(recordOf("app-1")?.["pr"]).toBeUndefined();
    expect(recordOf("app-1")?.["status"]).toBeUndefined();
  });

  it("review case 2: a full new launch published during the checkout fails the claim and keeps the new launch", async () => {
    launchedRecord("app-1");
    const sm = createSessionManager({
      config,
      registry: claimRegistry(
        vi.fn(async () => {
          publishNewLaunch("app-1");
          return true;
        }),
      ),
    });
    const before = () => recordOf("app-1");

    await expect(sm.claimPR("app-1", "2")).rejects.toThrow(/Session app-1 changed while PR #2/);
    expect(before()).toMatchObject({
      status: "spawning",
      branch: "feat/new-launch",
      runtimeHandle: JSON.stringify(makeHandle("rt-new")),
    });
    expect(before()?.["pr"]).toBeUndefined();
  });

  it("any other Node write during the checkout (a new generation) fails the claim", async () => {
    launchedRecord("app-1");
    const sm = createSessionManager({
      config,
      registry: claimRegistry(
        vi.fn(async () => {
          updateMetadata(sessionsDir, "app-1", { status: "killed", killedReason: "runtime" });
          return true;
        }),
      ),
    });

    await expect(sm.claimPR("app-1", "2")).rejects.toThrow(/Session app-1 changed while PR #2/);
    expect(recordOf("app-1")).toMatchObject({ status: "killed", killedReason: "runtime" });
    expect(recordOf("app-1")?.["pr"]).toBeUndefined();
  });

  it("a new launch before the checkout stops the claim before any checkout", async () => {
    launchedRecord("app-1");
    const checkoutPR = vi.fn().mockResolvedValue(true);
    const registry = claimRegistry(checkoutPR);
    const scm = registry.get<SCM>("scm", "github")!;
    vi.mocked(scm.getPRState).mockImplementation(async () => {
      publishNewLaunch("app-1");
      return "open";
    });
    const sm = createSessionManager({ config, registry });

    await expect(sm.claimPR("app-1", "2")).rejects.toThrow(/nothing was checked out or written/);
    expect(checkoutPR).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch", status: "spawning" });
  });

  it("does not clear the PR of a takeover record that changed during the checkout", async () => {
    launchedRecord("app-1");
    launchedRecord("app-old", { pr: PR2, status: "pr_open", branch: "feat/two" });
    const sm = createSessionManager({
      config,
      registry: claimRegistry(
        vi.fn(async () => {
          // The old owner moves on to another PR meanwhile.
          updateMetadata(sessionsDir, "app-old", {
            pr: "https://github.com/org/my-app/pull/3",
          });
          return true;
        }),
      ),
    });

    const result = await sm.claimPR("app-1", "2");

    expect(result.takenOverFrom).toEqual(["app-old"]);
    expect(recordOf("app-1")).toMatchObject({ pr: PR2, status: "pr_open" });
    expect(recordOf("app-old")?.["pr"]).toBe("https://github.com/org/my-app/pull/3");
  });

  it("control: a claim with no change in between writes the PR and takes over the old owner", async () => {
    launchedRecord("app-1");
    launchedRecord("app-old", { pr: PR2, status: "pr_open", branch: "feat/two" });
    const sm = createSessionManager({
      config,
      registry: claimRegistry(vi.fn().mockResolvedValue(true)),
    });

    await sm.claimPR("app-1", "2");

    expect(recordOf("app-1")).toMatchObject({ pr: PR2, status: "pr_open", branch: "feat/two" });
    expect(recordOf("app-old")?.["pr"]).toBeUndefined();
  });
});

describe("1.1 item 2: restore writes only into the version that it owns", () => {
  function killedRecord(id = "app-1"): void {
    const ws = join(ctx.tmpDir, `ws-${id}`);
    mkdirSync(ws, { recursive: true });
    launchedRecord(id, { status: "killed", killedReason: "runtime" }, makeHandle("rt-old"));
  }

  it("review case 3: an archive during runtime.create is not recreated, and the new runtime is stopped", async () => {
    killedRecord();
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      deleteMetadata(sessionsDir, "app-1", true);
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 was removed \(archived or deleted\) while it was restored; its new runtime was stopped/,
    );
    expect(recordOf("app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({ status: "killed" });
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-restored"));
  });

  it("review case 3: an archive plus a new reservation during runtime.create keeps the reservation", async () => {
    killedRecord();
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      reservation = archiveAndReserve("app-1");
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored/,
    );
    expect(recordOf("app-1")).toEqual(reservation);
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-restored"));
  });

  it("a newer launch published during runtime.create keeps its record", async () => {
    killedRecord();
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      publishNewLaunch("app-1");
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored/,
    );
    expect(recordOf("app-1")).toMatchObject({
      status: "spawning",
      branch: "feat/new-launch",
      runtimeHandle: JSON.stringify(makeHandle("rt-new")),
    });
  });

  it("from the archive: a kill and a new reservation after the copy-back keep the reservation", async () => {
    killedRecord();
    deleteMetadata(sessionsDir, "app-1", true);
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      // The copy-back of this restore exists now; another process kills it
      // and reserves the ID again.
      expect(recordOf("app-1")?.["reservationId"]).toBeDefined();
      reservation = archiveAndReserve("app-1");
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored/,
    );
    expect(recordOf("app-1")).toEqual(reservation);
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-restored"));
  });

  it("from the archive: another restore's copy-back of the same archive is told apart by its reservation ID", async () => {
    killedRecord();
    deleteMetadata(sessionsDir, "app-1", true);
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      // A kill archives this restore's copy-back; a second restore copies the
      // same content back (its own reservation ID).
      const archived = readArchivedMetadataRaw(sessionsDir, "app-1")!;
      deleteMetadata(sessionsDir, "app-1", true);
      expect(
        reserveSessionId(sessionsDir, "app-1", {
          worktree: archived["worktree"]!,
          branch: archived["branch"]!,
          status: "killed",
          runtimeHandle: archived["runtimeHandle"]!,
          createdAt: archived["createdAt"]!,
          tmuxName: archived["tmuxName"]!,
        }),
      ).toBe(true);
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });
    const other = () => recordOf("app-1");

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored/,
    );
    expect(other()).toMatchObject({
      status: "killed",
      runtimeHandle: JSON.stringify(makeHandle("rt-old")),
    });
    expect(other()?.["restoredAt"]).toBeUndefined();
  });

  it("from the archive: an active record that appeared after the read is not overwritten, and nothing starts", async () => {
    killedRecord();
    deleteMetadata(sessionsDir, "app-1", true);
    let concurrent: Record<string, string> | null = null;
    vi.mocked(ctx.mockAgent.getEnvironment).mockImplementation(() => {
      // Between this restore's archive read and its copy-back, another
      // restore copies the archive back first.
      if (!concurrent) {
        publishNewLaunch("app-1");
        concurrent = recordOf("app-1");
      }
      return {};
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(
      /Session app-1 changed while it was restored \(another restore or a new reservation of the ID, or a newer archive\); nothing was changed/,
    );
    expect(recordOf("app-1")).toEqual(concurrent);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
  });

  it("from the archive: a newer archive of the ID after the read is not replaced by the older one", async () => {
    killedRecord();
    deleteMetadata(sessionsDir, "app-1", true);
    let done = false;
    vi.mocked(ctx.mockAgent.getEnvironment).mockImplementation(() => {
      // A restore and a kill of the ID run in between: the latest archive
      // now names another launch.
      if (!done) {
        done = true;
        publishNewLaunch("app-1");
        deleteMetadata(sessionsDir, "app-1", true);
      }
      return {};
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.restore("app-1")).rejects.toThrow(/a newer archive\); nothing was changed/);
    expect(recordOf("app-1")).toBeNull();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
  });

  it("a launch change during the workspace step stops the restore before it destroys the old runtime", async () => {
    killedRecord();
    vi.mocked(ctx.mockAgent.getEnvironment).mockImplementation(() => ({}));
    const workspaceExists = vi.fn(async () => {
      publishNewLaunch("app-1");
      return true;
    });
    const registry = createMockRegistry({
      runtime: ctx.mockRuntime,
      agent: ctx.mockAgent,
      workspace: { ...ctx.mockWorkspace, exists: workspaceExists },
    });
    const sm = createSessionManager({ config, registry });

    await expect(sm.restore("app-1")).rejects.toThrow(/no runtime was destroyed or created/);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("the post-launch delta is not written into a record that another launch replaced", async () => {
    killedRecord();
    ctx.mockAgent.postLaunchSetup = vi.fn(async (session) => {
      publishNewLaunch("app-1");
      session.metadata = { ...session.metadata, hookMarker: "restore-1" };
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.restore("app-1");

    expect(recordOf("app-1")?.["hookMarker"]).toBeUndefined();
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
  });

  it("control: a status write of the lifecycle during runtime.create does not stop the restore", async () => {
    killedRecord();
    ctx.mockAgent.postLaunchSetup = vi.fn(async (session) => {
      session.metadata = { ...session.metadata, hookMarker: "restore-1" };
    });
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      updateMetadata(sessionsDir, "app-1", { lastCIFailureDispatchHash: "abc" });
      return makeHandle("rt-restored");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    const restored = await sm.restore("app-1");

    expect(restored.status).toBe("spawning");
    expect(recordOf("app-1")).toMatchObject({
      status: "spawning",
      runtimeHandle: JSON.stringify(makeHandle("rt-restored")),
      lastCIFailureDispatchHash: "abc",
      hookMarker: "restore-1",
    });
    expect(recordOf("app-1")?.["reservationId"]).toBeUndefined();
  });

  it("control: a restore from the archive writes one record with the next generations", async () => {
    killedRecord();
    const archivedGeneration = Number(recordOf("app-1")!["generation"]);
    deleteMetadata(sessionsDir, "app-1", true);
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.restore("app-1");

    expect(recordOf("app-1")).toMatchObject({
      status: "spawning",
      runtimeHandle: JSON.stringify(makeHandle("rt-1")),
      // The copy-back (a reservation) and the restore write.
      generation: String(archivedGeneration + 2),
    });
    expect(recordOf("app-1")?.["reservationId"]).toBeUndefined();
  });
});

describe("1.1 item 3: spawn writes only into its own reservation and launch", () => {
  function managedWorkspace(): string {
    const project = config.projects["my-app"]!;
    const path = join(getWorktreesDir(config.configPath, project.path), "app-1");
    mkdirSync(path, { recursive: true });
    vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
      path,
      branch: "session/app-1",
      sessionId: "app-1",
      projectId: "my-app",
    });
    return path;
  }

  it("a kill of the reservation during the workspace step: no record is recreated, the workspace goes", async () => {
    const workspace = managedWorkspace();
    vi.mocked(ctx.mockWorkspace.create).mockImplementation(async () => {
      deleteMetadata(sessionsDir, "app-1", true);
      return { path: workspace, branch: "session/app-1", sessionId: "app-1", projectId: "my-app" };
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    // The workspace step itself does not write; the first write after it fails.
    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(
      /Session app-1 was removed \(archived or deleted\) while the spawn started its runtime/,
    );
    expect(recordOf("app-1")).toBeNull();
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-1"));
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledWith(workspace);
  });

  it("an archive plus a new reservation during runtime.create: the new reservation stays, and so does the shared workspace", async () => {
    const workspace = managedWorkspace();
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      reservation = archiveAndReserve("app-1");
      return makeHandle("rt-spawned");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(
      /Session app-1 changed while the spawn started its runtime/,
    );
    expect(recordOf("app-1")).toEqual(reservation);
    // The new reservation names no runtime: this spawn's runtime is stopped.
    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-spawned"));
    // The worktree path of the ID is the new reservation's too.
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalledWith(workspace);
  });

  it("a delete without archive plus a new reservation is told apart by the reservation ID", async () => {
    managedWorkspace();
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
      deleteMetadata(sessionsDir, "app-1", false);
      expect(reserveSessionId(sessionsDir, "app-1")).toBe(true);
      reservation = recordOf("app-1");
      return makeHandle("rt-spawned");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(/Session app-1 changed/);
    expect(recordOf("app-1")).toEqual(reservation);
  });

  it("a kill and a restore (same runtime name) during post-launch setup: the restored launch keeps its record and runtime", async () => {
    const workspace = managedWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-shared"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async (session) => {
      // A kill and a restore of the ID: the restored launch uses the same
      // runtime name (tmux names derive from the session ID).
      publishNewLaunch("app-1", makeHandle("rt-shared"));
      session.metadata = { ...session.metadata, hookMarker: "spawn" };
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow(
      /Session app-1 changed while the spawn set up its agent/,
    );
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch", status: "spawning" });
    expect(recordOf("app-1")?.["hookMarker"]).toBeUndefined();
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalledWith(workspace);
  });

  it("a replacement after the spawn finished its launch: the prompt note is not written, the spawn returns", async () => {
    managedWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    // The launch is written; a kill and a restore replace it before the
    // prompt note (no post-launch delivery: the note follows the launch).
    ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
      publishNewLaunch("app-1");
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    let session;
    try {
      session = await sm.spawn({ projectId: "my-app", prompt: "Go" });
    } finally {
      stderr.mockRestore();
    }

    expect(session.id).toBe("app-1");
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    expect(recordOf("app-1")?.["promptDelivered"]).toBeUndefined();
    expect(lines.join("")).toMatch(
      /ao: Session app-1 changed while the spawn delivered its prompt .*its record was not written/,
    );
  });

  it("control: a lifecycle write during post-launch setup does not stop the spawn", async () => {
    managedWorkspace();
    vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
    ctx.mockAgent.postLaunchSetup = vi.fn(async (session) => {
      updateMetadata(sessionsDir, "app-1", { status: "working" });
      session.metadata = { ...session.metadata, hookMarker: "spawn" };
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    const session = await sm.spawn({ projectId: "my-app" });

    expect(session.id).toBe("app-1");
    expect(recordOf("app-1")).toMatchObject({
      status: "working",
      hookMarker: "spawn",
      runtimeHandle: JSON.stringify(makeHandle("rt-spawned")),
    });
    expect(recordOf("app-1")?.["reservationId"]).toBeUndefined();
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
  });
});

describe("1.1 item 3: an orchestrator start writes only into its own record", () => {
  it("isolated mode: an archive plus a new reservation during the workspace step keeps the reservation", async () => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "isolated";
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockWorkspace.create).mockImplementation(async (wsConfig) => {
      reservation = archiveAndReserve(wsConfig.sessionId);
      return {
        path: join(ctx.tmpDir, "orch-ws"),
        branch: wsConfig.branch,
        sessionId: wsConfig.sessionId,
        projectId: "my-app",
      };
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      /Session app-orchestrator-1 changed while the start started its runtime/,
    );
    expect(recordOf("app-orchestrator-1")).toEqual(reservation);
  });

  it("project mode: a replacement during the liveness check of the old orchestrator is not destroyed or deleted", async () => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    config.projects["my-app"]!.orchestratorSessionStrategy = "delete";
    launchedRecord("app-orchestrator", { role: "orchestrator" }, makeHandle("rt-orch-old"));
    let replacement: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (handle) => {
      if (handle.id === "rt-orch-old" && !replacement) {
        publishNewLaunch("app-orchestrator", makeHandle("rt-orch-other"));
        replacement = recordOf("app-orchestrator");
        return true;
      }
      return true;
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    // The reservation fails on the replacement's record, which is alive.
    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "Session app-orchestrator already exists but is not in a reusable state",
    );
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalledWith(makeHandle("rt-orch-old"));
    expect(recordOf("app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-orch-other")),
    );
  });
});

describe("1.1 item 3: an orchestrator start that reuses a live orchestrator", () => {
  beforeEach(() => {
    config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
    config.projects["my-app"]!.orchestratorSessionStrategy = "reuse";
    launchedRecord("app-orchestrator", { role: "orchestrator" }, makeHandle("rt-orch-old"));
  });

  it("a record archived during the liveness check: its orphan runtime is stopped, and a new start follows", async () => {
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (handle) => {
      if (handle.id === "rt-orch-old") deleteMetadata(sessionsDir, "app-orchestrator", true);
      return true;
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    const session = await sm.spawnOrchestrator({ projectId: "my-app" });

    expect(ctx.mockRuntime.destroy).toHaveBeenCalledWith(makeHandle("rt-orch-old"));
    expect(session.metadata["orchestratorSessionReused"]).toBeUndefined();
    expect(recordOf("app-orchestrator")?.["runtimeHandle"]).toBe(
      JSON.stringify(makeHandle("rt-1")),
    );
  });

  it("a reservation of another start during the liveness check is kept, and no runtime is stopped", async () => {
    let reservation: Record<string, string> | null = null;
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (handle) => {
      if (handle.id === "rt-orch-old" && !reservation) {
        reservation = archiveAndReserve("app-orchestrator");
      }
      return true;
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.spawnOrchestrator({ projectId: "my-app" })).rejects.toThrow(
      "Session app-orchestrator already exists but is not in a reusable state",
    );
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(recordOf("app-orchestrator")).toEqual(reservation);
  });
});

describe("1.1 item 3: kill and cleanup archive only the launch they read", () => {
  /** A launched OpenCode record of app-1 in a managed worktree (a kill destroys it). */
  function managedOpenCodeRecord(): string {
    const project = config.projects["my-app"]!;
    const worktree = join(getWorktreesDir(config.configPath, project.path), "app-1");
    mkdirSync(worktree, { recursive: true });
    launchedRecord("app-1", { worktree, agent: "opencode", opencodeSessionId: "ses_old" });
    return worktree;
  }

  it("a restore during the runtime destroy: the worktree, agent session and record stay, and the kill fails", async () => {
    const worktree = managedOpenCodeRecord();
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      // The restored launch uses the same worktree and OpenCode session.
      publishNewLaunch("app-1");
      updateMetadata(sessionsDir, "app-1", { worktree, opencodeSessionId: "ses_old" });
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*its worktree, agent session and record were kept; run the kill again/,
    );
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
  });

  it("a restore during the worktree destroy: the agent session and the record stay", async () => {
    managedOpenCodeRecord();
    vi.mocked(ctx.mockWorkspace.destroy).mockImplementation(async () => {
      publishNewLaunch("app-1");
      updateMetadata(sessionsDir, "app-1", { agent: "opencode", opencodeSessionId: "ses_old" });
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*its agent session and record were kept; run the kill again/,
    );
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    expect(interruptOpenCodeSession).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
  });

  it("a restore during the OpenCode removal: the record is not archived, and the kill fails", async () => {
    managedOpenCodeRecord();
    discovery.duringRemove = () => publishNewLaunch("app-1");
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      /Session app-1 changed while it was killed .*its record was not archived; run the kill again/,
    );
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    // The only archive is the old launch's (the other process archived it).
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({ branch: "feat/old" });
  });

  it("a failed ledger removal does not write over the pending key of a newer archive", async () => {
    managedOpenCodeRecord();
    discovery.duringLedgerRemove = () => {
      // A restore and a kill of the ID leave a newer archive with its own key.
      publishNewLaunch("app-1");
      updateMetadata(sessionsDir, "app-1", { opencodeLedgerPending: "ses_newer" });
      deleteMetadata(sessionsDir, "app-1", true);
      throw new Error("ledger busy");
    };
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await sm.kill("app-1", { purgeOpenCode: true });
    } finally {
      stderr.mockRestore();
    }

    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({
      branch: "feat/new-launch",
      opencodeLedgerPending: "ses_newer",
    });
    expect(lines.join("")).toMatch(/could not be marked for a retry either/);
  });

  it("control: a failed ledger removal marks the archive of this kill for a retry", async () => {
    managedOpenCodeRecord();
    discovery.duringLedgerRemove = () => {
      throw new Error("ledger busy");
    };
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await sm.kill("app-1", { purgeOpenCode: true });
    } finally {
      stderr.mockRestore();
    }

    expect(vi.mocked(removeOpenCodeSession).mock.calls.map((call) => call[0])).toEqual(["ses_old"]);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({
      branch: "feat/old",
      opencodeLedgerPending: "ses_old",
    });
  });

  it("control: a status write of the lifecycle during the kill does not stop the archive", async () => {
    launchedRecord("app-1");
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async () => {
      updateMetadata(sessionsDir, "app-1", { status: "killed", killedReason: "runtime" });
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.kill("app-1");

    expect(recordOf("app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({ status: "killed" });
  });

  it("cleanup does not kill a newer launch that replaced the dead one during its checks", async () => {
    launchedRecord("app-1");
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (handle) => {
      if (handle.id === "rt-app-1") {
        // Dead; meanwhile a restore publishes a newer launch.
        if (recordOf("app-1")?.["runtimeHandle"] === JSON.stringify(makeHandle("rt-app-1"))) {
          publishNewLaunch("app-1");
        }
        return false;
      }
      return true;
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    const result = await sm.cleanup("my-app");

    expect(result.killed).not.toContain("app-1");
    expect(result.errors.map((entry) => entry.sessionId)).toEqual(["app-1"]);
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
  });
});

describe("1.1 item 3: remap writes the mapping only into the launch it read", () => {
  function openCodeRecord(): void {
    launchedRecord("app-1", { agent: "opencode", opencodeSessionId: "ses_stale" });
  }

  it("a new launch during the discovery keeps its record, and the remap fails", async () => {
    openCodeRecord();
    discovery.during = () => publishNewLaunch("app-1");
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.remap("app-1", true)).rejects.toThrow(
      /Session app-1 changed while it was remapped .*the mapping was not written; run the remap again/,
    );
    expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch" });
    expect(recordOf("app-1")?.["opencodeSessionId"]).toBeUndefined();
  });

  it("another mapping written during the discovery is not replaced", async () => {
    openCodeRecord();
    discovery.during = () => {
      updateMetadata(sessionsDir, "app-1", { opencodeSessionId: "ses_other_remap" });
    };
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.remap("app-1", true)).rejects.toThrow(/the mapping was not written/);
    expect(recordOf("app-1")?.["opencodeSessionId"]).toBe("ses_other_remap");
  });

  it("an archived record: a newer archive of the ID after the read is not written", async () => {
    openCodeRecord();
    deleteMetadata(sessionsDir, "app-1", true);
    discovery.during = () => {
      publishNewLaunch("app-1");
      deleteMetadata(sessionsDir, "app-1", true);
    };
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await expect(sm.remap("app-1", true)).rejects.toThrow(
      "The archived record of app-1 changed while it was remapped (a restore or a newer archive of the ID); the mapping was not written; run the remap again",
    );
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({
      branch: "feat/new-launch",
    });
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeSessionId"]).toBeUndefined();
  });

  it("control: a status write during the discovery does not stop the remap", async () => {
    openCodeRecord();
    discovery.during = () => {
      updateMetadata(sessionsDir, "app-1", { status: "idle" });
    };
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    expect(await sm.remap("app-1", true)).toBe("ses_fresh");
    expect(recordOf("app-1")).toMatchObject({ status: "idle", opencodeSessionId: "ses_fresh" });
  });
});

describe("1.1 item 3: cleanup marks only the archive that names what it removed", () => {
  /** An archived OpenCode record of app-1 with `fields`. */
  function archivedOpenCodeRecord(fields: Record<string, string>): void {
    launchedRecord("app-1", { agent: "opencode", ...fields });
    deleteMetadata(sessionsDir, "app-1", true);
  }

  /** During the removal, a restore and a kill of the ID leave a newer archive with `fields`. */
  function newerArchive(fields: Record<string, string>): () => void {
    return () => {
      publishNewLaunch("app-1");
      updateMetadata(sessionsDir, "app-1", { agent: "opencode", ...fields });
      deleteMetadata(sessionsDir, "app-1", true);
    };
  }

  it("the purge mark does not clear the OpenCode session ID of a newer archive", async () => {
    archivedOpenCodeRecord({ opencodeSessionId: "ses_old" });
    discovery.duringRemove = newerArchive({ opencodeSessionId: "ses_newer" });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.cleanup("my-app");

    const latest = readArchivedMetadataRaw(sessionsDir, "app-1");
    expect(latest).toMatchObject({ branch: "feat/new-launch", opencodeSessionId: "ses_newer" });
    expect(latest?.["opencodeCleanedAt"]).toBeUndefined();
  });

  it("the cleared ledger key is only the one that was removed, not a newer archive's own key", async () => {
    archivedOpenCodeRecord({
      opencodeCleanedAt: "2026-10-20T10:00:00.000Z",
      opencodeLedgerPending: "ses_old",
    });
    discovery.duringLedgerRemove = newerArchive({
      opencodeCleanedAt: "2026-10-20T11:00:00.000Z",
      opencodeLedgerPending: "ses_newer",
    });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.cleanup("my-app");

    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({
      branch: "feat/new-launch",
      opencodeLedgerPending: "ses_newer",
    });
  });

  it("control: with no newer archive, the mark and the key clear go into the archive that was read", async () => {
    archivedOpenCodeRecord({ opencodeSessionId: "ses_old" });
    const sm = createSessionManager({ config, registry: ctx.mockRegistry });

    await sm.cleanup("my-app");

    const latest = readArchivedMetadataRaw(sessionsDir, "app-1");
    expect(latest?.["opencodeSessionId"]).toBeUndefined();
    expect(latest?.["opencodeCleanedAt"]).toBeDefined();
  });
});

describe("1.1 item 3: the recovery actions write only the assessed version", () => {
  function assessment(overrides: Partial<RecoveryAssessment> = {}): RecoveryAssessment {
    const rawMetadata = recordOf("app-1")!;
    return {
      sessionId: "app-1",
      projectId: "my-app",
      classification: "dead",
      action: "cleanup",
      reason: "dead",
      runtimeAlive: false,
      runtimeHandle: makeHandle("rt-app-1"),
      workspaceExists: false,
      workspacePath: rawMetadata["worktree"] ?? null,
      agentProcessRunning: false,
      agentActivity: null,
      metadataValid: true,
      metadataStatus: "working",
      rawMetadata,
      ...overrides,
    } as RecoveryAssessment;
  }

  const context = () => ({
    configPath: config.configPath,
    recoveryConfig: { ...DEFAULT_RECOVERY_CONFIG, logPath: join(ctx.tmpDir, "recovery.log") },
    dryRun: false,
  });

  it.each(["recover", "escalate", "cleanup"] as const)(
    "%s: a new launch after the assessment keeps its record",
    async (action) => {
      launchedRecord("app-1");
      const assessed = assessment({ action });
      publishNewLaunch("app-1");
      const run = { recover: recoverSession, escalate: escalateSession, cleanup: cleanupSession }[
        action
      ];

      const result = await run(assessed, config, ctx.mockRegistry, context());

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/changed after the assessment; nothing was written/);
      expect(recordOf("app-1")).toMatchObject({ branch: "feat/new-launch", status: "spawning" });
      expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    },
  );

  it.each(["recover", "escalate", "cleanup"] as const)(
    "%s: an archived record is not recreated",
    async (action) => {
      launchedRecord("app-1");
      const assessed = assessment({ action });
      deleteMetadata(sessionsDir, "app-1", true);
      const run = { recover: recoverSession, escalate: escalateSession, cleanup: cleanupSession }[
        action
      ];

      const result = await run(assessed, config, ctx.mockRegistry, context());

      expect(result.success).toBe(false);
      expect(recordOf("app-1")).toBeNull();
    },
  );
});

describe("1.1 item 4: the generic writers never create or recreate a record", () => {
  it("updateMetadata, updateMetadataIf and deleteMetadata leave a missing record missing", async () => {
    const { updateMetadataIf } = await import("../metadata.js");
    expect(updateMetadata(sessionsDir, "app-9", { status: "working" })).toBe(false);
    expect(updateMetadataIf(sessionsDir, "app-9", {}, { status: "working" })).toBeNull();
    expect(deleteMetadata(sessionsDir, "app-9", true)).toBe(false);
    expect(recordOf("app-9")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-9")).toBeNull();
  });

  it("deleteMetadata with expected values deletes only a record that holds them", () => {
    launchedRecord("app-1");
    expect(deleteMetadata(sessionsDir, "app-1", true, { runtimeHandle: "other" })).toBe(false);
    expect(recordOf("app-1")).not.toBeNull();
    expect(
      deleteMetadata(sessionsDir, "app-1", true, {
        runtimeHandle: JSON.stringify(makeHandle("rt-app-1")),
      }),
    ).toBe(true);
    expect(recordOf("app-1")).toBeNull();
  });

  it("a record file written by an old build keeps working with the writers", () => {
    writeFileSync(join(sessionsDir, "app-1"), "status=working\nbranch=main\n");
    expect(updateMetadata(sessionsDir, "app-1", { summary: "x" })).toBe(true);
    expect(recordOf("app-1")).toEqual({
      status: "working",
      branch: "main",
      summary: "x",
      generation: "1",
    });
  });
});
