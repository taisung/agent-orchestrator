/**
 * Round 8 of the killed-status fix (development/reviews/killed_status_review_r6_astra6.md).
 *
 * M-1: a check that cannot read the launch's own record is "unknown", never
 * "gone": the rollback keeps the runtime, the prepared agent session, the
 * workspace and the record, and names each one to the operator. M-2: the
 * prepared agent session stays while any other record, or the latest archive
 * of any session ID, names it (issue reuse gives it to another session). A
 * record or an archive that exists but cannot be read is a holder.
 *
 * The session manager and the files are real. An unreadable record is a real
 * `chmod 000` of a file in the test's temporary directory; every mode is
 * restored before an assertion reads the file. The plugins are stand-ins
 * that keep the contract (their own step awaits, another process acts
 * meanwhile, then they run the caller's check; a check that throws counts as
 * no).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
import { getProjectBaseDir, getWorktreesDir } from "../paths.js";
import type { PreparedAgentSession, RuntimeHandle } from "../types.js";
import {
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

let ctx: TestContext;
let sessionsDir: string;
let stderr: string[];
/** Paths whose mode a test changed, with the mode to restore. */
let modes: Array<{ path: string; mode: number }>;

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
  modes = [];
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  restoreModes();
  vi.restoreAllMocks();
  teardownTestContext(ctx);
});

/** Make `path` unreadable (a real mode change); `restoreModes` undoes it. */
function makeUnreadable(path: string, mode = 0o000): void {
  modes.push({ path, mode: path === sessionsDir ? 0o755 : 0o644 });
  chmodSync(path, mode);
}

function restoreModes(): void {
  for (const { path, mode } of modes.splice(0).reverse()) {
    if (existsSync(path)) chmodSync(path, mode);
  }
}

function recordPath(id: string): string {
  return join(sessionsDir, id);
}

function recordOf(id: string): Record<string, string> | null {
  return readMetadataRaw(sessionsDir, id);
}

function warnings(): string {
  return stderr.join("");
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

/**
 * Another process deletes the record of `id` without an archive (so no
 * archive names anything) and publishes a new launch of the ID.
 */
function replaceWithoutArchive(
  id: string,
  fields: Partial<Record<string, string>> = {},
  handle: RuntimeHandle = makeHandle("rt-new"),
): Record<string, string> {
  expect(deleteMetadata(sessionsDir, id, false)).toBe(true);
  expect(reserveSessionId(sessionsDir, id)).toBe(true);
  expect(
    updateMetadata(sessionsDir, id, {
      branch: "feat/new-launch",
      status: "working",
      project: "my-app",
      agent: "opencode",
      tmuxName: `hash-${id}`,
      createdAt: "2026-10-20T12:00:00.000Z",
      runtimeHandle: JSON.stringify(handle),
      reservationId: "",
      ...fields,
    }),
  ).toBe(true);
  return recordOf(id)!;
}

/** The newest archive file of `id`. */
function latestArchiveFile(id: string): string {
  const files = readdirSync(join(sessionsDir, "archive"))
    .filter((name) => name.startsWith(`${id}_`))
    .sort();
  return join(sessionsDir, "archive", files[files.length - 1]!);
}

/**
 * A spawn whose agent prepares `ses_prep` (created by this spawn) on a
 * managed worktree, then fails its post-launch setup (`beforeRollback` runs
 * there first). The prepared session keeps the contract: its own step awaits
 * (`during` runs there), then it asks the caller's check; the answers are
 * collected. The workspace destroy keeps the contract too.
 */
function preparedSpawn(options: { during?: () => void; beforeRollback?: () => void } = {}): {
  answers: (boolean | undefined)[];
  prepared: PreparedAgentSession;
  worktree: string;
} {
  const answers: (boolean | undefined)[] = [];
  const worktree = managedWorktree("app-1");
  vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
    path: worktree,
    branch: "session/app-1",
    sessionId: "app-1",
    projectId: "my-app",
  });
  contractDestroy();
  const prepared: PreparedAgentSession = {
    metadata: { opencodeSessionId: "ses_prep" },
    agentConfig: { opencodeSessionId: "ses_prep" },
    created: true,
    discard: vi.fn(async (stillUnheld?: () => boolean) => {
      await Promise.resolve();
      options.during?.();
      answers.push(stillUnheld?.());
    }),
  };
  ctx.mockAgent.prepareAgentSession = vi.fn(async () => prepared);
  vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
  ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
    options.beforeRollback?.();
    throw new Error("post-launch setup failed");
  });
  return { answers, prepared, worktree };
}

/**
 * A workspace destroy that keeps the round-7 contract: its own step awaits
 * (`during` runs there), then it runs the caller's check directly before it
 * removes the directory; a check that throws counts as no.
 */
function contractDestroy(during: () => void = () => undefined): void {
  vi.mocked(ctx.mockWorkspace.destroy).mockImplementation(async (path, stillOwned) => {
    await Promise.resolve();
    during();
    let owned: boolean;
    try {
      owned = stillOwned ? stillOwned() : true;
    } catch {
      owned = false;
    }
    if (owned) rmSync(path, { recursive: true, force: true });
  });
}

describe.skipIf(process.getuid?.() === 0)(
  "M-1 (round 8): a check that cannot read the record keeps every resource of the rollback",
  () => {
    it("review case 1: a replacement that names the prepared session becomes unreadable during the hook's own wait (no archive names it)", async () => {
      let replacement: Record<string, string> | undefined;
      const { answers, worktree } = preparedSpawn({
        during: () => {
          replacement = replaceWithoutArchive("app-1", { opencodeSessionId: "ses_prep" });
          makeUnreadable(recordPath("app-1"));
        },
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([false]);
      expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
      expect(warnings()).toMatch(
        /kept the agent session of a failed launch \(ses_prep\): the record of app-1 could not be read \(EACCES/,
      );
      // The later steps cannot read the record either: the worktree and the
      // record stay, and each is named.
      expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
      expect(existsSync(worktree)).toBe(true);
      expect(warnings()).toMatch(
        new RegExp(
          `kept the workspace ${worktree} of a failed launch: the record of app-1 could not be read`,
        ),
      );
      expect(warnings()).toMatch(
        /kept the record of a failed launch: the record of app-1 could not be read/,
      );
      restoreModes();
      expect(recordOf("app-1")).toEqual(replacement);
    });

    it("review case 2: the record is unreadable before the rollback: the runtime, the agent session, the workspace and the record stay", async () => {
      let replacement: Record<string, string> | undefined;
      const { answers, prepared, worktree } = preparedSpawn({
        beforeRollback: () => {
          // The replacement names the same runtime and the prepared session.
          replacement = replaceWithoutArchive(
            "app-1",
            { opencodeSessionId: "ses_prep" },
            makeHandle("rt-spawned"),
          );
          makeUnreadable(recordPath("app-1"));
        },
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
      expect(warnings()).toMatch(
        /kept runtime mock rt-spawned of a failed launch: the record of app-1 could not be read \(EACCES/,
      );
      expect(prepared.discard).not.toHaveBeenCalled();
      expect(answers).toEqual([]);
      expect(warnings()).toMatch(
        /kept the agent session of a failed launch \(ses_prep\): the record of app-1 could not be read/,
      );
      expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
      expect(existsSync(worktree)).toBe(true);
      expect(warnings()).toMatch(/kept the record of a failed launch/);
      restoreModes();
      expect(recordOf("app-1")).toEqual(replacement);
    });

    it("control: the record stays readable and unchanged: every resource goes and nothing is kept", async () => {
      const { answers, worktree } = preparedSpawn();
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(ctx.mockRuntime.destroy).toHaveBeenCalledTimes(1);
      expect(answers).toEqual([true]);
      expect(existsSync(worktree)).toBe(false);
      expect(recordOf("app-1")).toBeNull();
      expect(warnings()).not.toMatch(/kept/);
    });

    it("the workspace step: the record becomes unreadable during the plugin's own wait: the worktree and the record stay", async () => {
      const worktree = managedWorktree("app-1");
      vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
        path: worktree,
        branch: "session/app-1",
        sessionId: "app-1",
        projectId: "my-app",
      });
      vi.mocked(ctx.mockRuntime.create).mockRejectedValue(new Error("runtime creation failed"));
      contractDestroy(() => makeUnreadable(recordPath("app-1")));
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("runtime creation failed");

      expect(ctx.mockWorkspace.destroy).toHaveBeenCalledTimes(1);
      expect(existsSync(worktree)).toBe(true);
      expect(warnings()).toMatch(
        new RegExp(
          `kept the workspace ${worktree} of a failed launch: the record of app-1 could not be read`,
        ),
      );
      expect(warnings()).toMatch(/kept the record of a failed launch/);
      restoreModes();
      // The reservation of the failed spawn stays: it was not released unread.
      expect(recordOf("app-1")).toMatchObject({ reservationId: expect.any(String) });
    });

    it("a sessions directory that cannot be searched is not gone: the runtime, the session, the workspace and the record stay", async () => {
      const { answers, prepared, worktree } = preparedSpawn({
        // Read but no search permission: `existsSync` of the record answers
        // false, but the record is not gone.
        beforeRollback: () => makeUnreadable(sessionsDir, 0o600),
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
      expect(prepared.discard).not.toHaveBeenCalled();
      expect(answers).toEqual([]);
      expect(ctx.mockWorkspace.destroy).not.toHaveBeenCalled();
      expect(existsSync(worktree)).toBe(true);
      expect(warnings()).toMatch(/kept runtime mock rt-spawned of a failed launch/);
      expect(warnings()).toMatch(/kept the agent session of a failed launch \(ses_prep\)/);
      expect(warnings()).toMatch(/kept the record of a failed launch/);
      restoreModes();
      expect(recordOf("app-1")).toMatchObject({ opencodeSessionId: "ses_prep" });
    });

    it("orchestrator start: an unreadable record keeps the shared prompt file and names it", async () => {
      ctx.config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
      const project = ctx.config.projects["my-app"]!;
      const promptFile = join(
        getProjectBaseDir(ctx.config.configPath, project.path),
        "orchestrator-prompt-app-orchestrator.md",
      );
      vi.mocked(ctx.mockRuntime.create).mockImplementation(async () => {
        makeUnreadable(recordPath("app-orchestrator"));
        throw new Error("runtime creation failed");
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(
        sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "review" }),
      ).rejects.toThrow("runtime creation failed");

      expect(existsSync(promptFile)).toBe(true);
      expect(warnings()).toMatch(
        /kept the prompt file .*orchestrator-prompt-app-orchestrator\.md of a failed start: the record of app-orchestrator could not be read/,
      );
    });
  },
);

describe.skipIf(process.getuid?.() === 0)(
  "M-2 (round 8): the prepared session stays while another record or archive of any ID names it",
  () => {
    it("issue reuse: another AO session takes the prepared session during the hook's own wait: the check answers no", async () => {
      const { answers } = preparedSpawn({
        during: () => launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_prep" }),
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([false]);
      expect(warnings()).toMatch(
        /kept the agent session of a failed launch \(ses_prep\): the record of app-2 names it/,
      );
      // The failed launch still owned its own record, so it releases it.
      expect(recordOf("app-1")).toBeNull();
      expect(recordOf("app-2")).toMatchObject({ opencodeSessionId: "ses_prep" });
    });

    it("the latest archive of another AO ID names the prepared session: the check answers no", async () => {
      const { answers } = preparedSpawn({
        during: () => {
          launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_prep" });
          deleteMetadata(sessionsDir, "app-2", true);
        },
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([false]);
      expect(warnings()).toMatch(/the latest archive of app-2 names it/);
    });

    it("an unreadable record of another AO ID is a holder", async () => {
      const { answers } = preparedSpawn({
        during: () => {
          launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" });
          makeUnreadable(recordPath("app-2"));
        },
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([false]);
      expect(warnings()).toMatch(/the record of app-2 could not be read \(EACCES/);
    });

    it("an unreadable latest archive of another AO ID is a holder", async () => {
      const { answers } = preparedSpawn({
        during: () => {
          launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" });
          deleteMetadata(sessionsDir, "app-2", true);
          makeUnreadable(latestArchiveFile("app-2"));
        },
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([false]);
      expect(warnings()).toMatch(/the latest archive of app-2 could not be read/);
    });

    it("a holder before the hook runs: core keeps the session without a call to discard", async () => {
      const { answers, prepared } = preparedSpawn({
        beforeRollback: () =>
          launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_prep" }),
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(prepared.discard).not.toHaveBeenCalled();
      expect(answers).toEqual([]);
      expect(warnings()).toMatch(/the record of app-2 names it/);
    });

    it("control: other records and archives name other sessions: the check answers yes", async () => {
      launchedRecord("app-3", { agent: "opencode", opencodeSessionId: "ses_three" });
      deleteMetadata(sessionsDir, "app-3", true);
      const { answers } = preparedSpawn({
        during: () =>
          launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" }),
      });
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

      expect(answers).toEqual([true]);
      expect(recordOf("app-1")).toBeNull();
      expect(warnings()).not.toMatch(/kept/);
    });
  },
);
