/**
 * Round 9 of the killed-status fix (development/reviews/killed_status_review_r7_astra6.md,
 * M-1, item 3): the holder checks of this fix never take a failed check as
 * "not there". These cases sit between two synchronous calls (a listing that
 * found a record or an archive, then the read of it), so no real file change
 * can reach them. The `node:fs` boundary is a stand-in here: `existsSync`
 * answers false for a listed record (as for a path that it cannot check),
 * or the read of the archive directory fails after the listing read it.
 * Everything else (the session manager, the files) is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../session-manager.js";
import {
  deleteMetadata,
  readArchivedMetadataRaw,
  readMetadataRaw,
  updateArchivedMetadata,
  updateMetadata,
  writeMetadata,
} from "../metadata.js";
import { getWorktreesDir } from "../paths.js";
import { interruptOpenCodeSession, removeOpenCodeSession } from "../opencode-api.js";
import { removeDeliveryLedger } from "../delivery-ledger.js";
import type * as DeliveryLedger from "../delivery-ledger.js";
import type * as Fs from "node:fs";
import type * as OpenCodeApi from "../opencode-api.js";
import type { PreparedAgentSession } from "../types.js";
import {
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

const hooks = vi.hoisted(() => ({
  /** Paths for which `existsSync` answers false although they are there. */
  hidden: new Set<string>(),
  /** A directory whose `readdirSync` fails with EACCES after `skip` reads. */
  failReaddir: null as null | { dir: string; skip: number },
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const existsSync = (path: Fs.PathLike): boolean =>
    hooks.hidden.has(String(path)) ? false : actual.existsSync(path);
  const readdirSync = ((...args: Parameters<typeof actual.readdirSync>) => {
    const fail = hooks.failReaddir;
    if (fail && String(args[0]) === fail.dir) {
      if (fail.skip > 0) {
        fail.skip -= 1;
      } else {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${fail.dir}'`), {
          code: "EACCES",
        });
      }
    }
    return actual.readdirSync(...args);
  }) as typeof actual.readdirSync;
  return { ...actual, existsSync, readdirSync, default: { ...actual, existsSync, readdirSync } };
});
vi.mock("../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    removeOpenCodeSession: vi.fn(async () => undefined),
    interruptOpenCodeSession: vi.fn(async () => ({ interrupted: true })),
  };
});
vi.mock("../delivery-ledger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLedger>();
  return { ...actual, removeDeliveryLedger: vi.fn(async () => undefined) };
});

let ctx: TestContext;
let sessionsDir: string;
let stderr: string[];

beforeEach(() => {
  hooks.hidden.clear();
  hooks.failReaddir = null;
  vi.mocked(removeOpenCodeSession).mockClear();
  vi.mocked(interruptOpenCodeSession).mockClear();
  vi.mocked(removeDeliveryLedger).mockClear();
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  hooks.hidden.clear();
  hooks.failReaddir = null;
  vi.restoreAllMocks();
  teardownTestContext(ctx);
});

function warnings(): string {
  return stderr.join("");
}

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

/**
 * A spawn whose agent prepares `ses_prep` (created by this spawn), then
 * fails its post-launch setup (`beforeRollback` runs there first). The
 * prepared session keeps the contract: its own step awaits (`during` runs
 * there), then it asks the caller's check; a check that throws counts as no.
 */
function preparedSpawn(options: { during?: () => void; beforeRollback?: () => void } = {}): {
  answers: (boolean | "throw" | undefined)[];
  prepared: PreparedAgentSession;
} {
  const answers: (boolean | "throw" | undefined)[] = [];
  const worktree = managedWorktree("app-1");
  vi.mocked(ctx.mockWorkspace.create).mockResolvedValue({
    path: worktree,
    branch: "session/app-1",
    sessionId: "app-1",
    projectId: "my-app",
  });
  const prepared: PreparedAgentSession = {
    metadata: { opencodeSessionId: "ses_prep" },
    agentConfig: { opencodeSessionId: "ses_prep" },
    created: true,
    discard: vi.fn(async (stillUnheld?: () => boolean) => {
      await Promise.resolve();
      options.during?.();
      try {
        answers.push(stillUnheld?.());
      } catch {
        answers.push("throw");
      }
    }),
  };
  ctx.mockAgent.prepareAgentSession = vi.fn(async () => prepared);
  vi.mocked(ctx.mockRuntime.create).mockResolvedValue(makeHandle("rt-spawned"));
  ctx.mockAgent.postLaunchSetup = vi.fn(async () => {
    options.beforeRollback?.();
    throw new Error("post-launch setup failed");
  });
  return { answers, prepared };
}

describe("M-1 (round 9): a record that the listing found is never 'not there'", () => {
  it("kill with purge: existsSync answers false for a listed record that names the OpenCode session: the session stays", async () => {
    launchedRecord("app-1", {
      worktree: managedWorktree("app-1"),
      agent: "opencode",
      opencodeSessionId: "ses_old",
    });
    launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_old" });
    hooks.hidden.add(join(sessionsDir, "app-2"));
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.kill("app-1", { purgeOpenCode: true })).rejects.toThrow(
      "the record of app-2 exists but was not read",
    );

    expect(interruptOpenCodeSession).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    hooks.hidden.clear();
    expect(recordOf("app-1")).toMatchObject({ opencodeSessionId: "ses_old" });
    expect(recordOf("app-2")).toMatchObject({ opencodeSessionId: "ses_old" });
  });

  it("ledger retry: existsSync answers false for a listed record that names the key: the ledger stays", async () => {
    launchedRecord("app-1", { agent: "opencode", opencodeSessionId: "ses_arch" });
    deleteMetadata(sessionsDir, "app-1", true);
    updateArchivedMetadata(sessionsDir, "app-1", {
      opencodeCleanedAt: "2026-10-21T10:00:00Z",
      opencodeLedgerPending: "ses_arch",
    });
    launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_arch" });
    hooks.hidden.add(join(sessionsDir, "app-2"));
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.cleanup("my-app");

    expect(removeDeliveryLedger).not.toHaveBeenCalled();
    expect(warnings()).toMatch(
      /could not remove the delivery ledger .* of OpenCode session ses_arch of app-1 \(the record of app-2 exists but was not read\); the next `ao session cleanup` tries again/,
    );
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"]).toBe(
      "ses_arch",
    );
  });

  it("control: the same ledger retry with the record readable and naming another key: the ledger goes", async () => {
    launchedRecord("app-1", { agent: "opencode", opencodeSessionId: "ses_arch" });
    deleteMetadata(sessionsDir, "app-1", true);
    updateArchivedMetadata(sessionsDir, "app-1", {
      opencodeCleanedAt: "2026-10-21T10:00:00Z",
      opencodeLedgerPending: "ses_arch",
    });
    launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.cleanup("my-app");

    expect(removeDeliveryLedger).toHaveBeenCalledTimes(1);
    expect(
      readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"],
    ).toBeUndefined();
  });
});

describe("M-1 (round 9): a read error of the latest archive after the listing is a holder", () => {
  it("before the hook: the archive directory read fails after the listing: core keeps the session without a call to discard", async () => {
    launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" });
    deleteMetadata(sessionsDir, "app-2", true);
    const { answers, prepared } = preparedSpawn({
      // The listing reads the directory once; the read of the latest archive fails.
      beforeRollback: () => {
        hooks.failReaddir = { dir: join(sessionsDir, "archive"), skip: 1 };
      },
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(prepared.discard).not.toHaveBeenCalled();
    expect(answers).toEqual([]);
    expect(warnings()).toMatch(
      /kept the agent session of a failed launch \(ses_prep\): the latest archive of app-2 could not be read \(EACCES/,
    );
  });

  it("during the hook's own wait: the check answers no (not a throw), and core names the session", async () => {
    launchedRecord("app-2", { agent: "opencode", opencodeSessionId: "ses_other" });
    deleteMetadata(sessionsDir, "app-2", true);
    const { answers } = preparedSpawn({
      during: () => {
        hooks.failReaddir = { dir: join(sessionsDir, "archive"), skip: 1 };
      },
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await expect(sm.spawn({ projectId: "my-app" })).rejects.toThrow("post-launch setup failed");

    expect(answers).toEqual([false]);
    expect(warnings()).toMatch(/\(ses_prep\): the latest archive of app-2 could not be read/);
  });
});
