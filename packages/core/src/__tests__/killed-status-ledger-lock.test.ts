/**
 * Round 6 of the killed-status fix (development/reviews/killed_status_review_r4_sol61.md, M-2).
 *
 * The removal of a delivery ledger waits for the ledger lock; a session can
 * take the OpenCode session (and so the ledger) during that wait. The check
 * that no active record names the key runs again after the lock is held,
 * directly before the removal; a kept ledger keeps its key in the archive.
 *
 * Each test runs the real session manager, the real ledger module and the
 * real ledger lock. The test holds the lock itself; a pass-through wrapper
 * of `holdDeliveryLock` tells it when the removal starts to wait.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
import { getDeliveryLedgerDir } from "../paths.js";
import {
  deliveryLedgerLockName,
  deliveryLedgerPath,
  readDeliveryLedger,
  type DeliveryEntry,
} from "../delivery-ledger.js";
import { holdDeliveryLock, tryHoldDeliveryLock, type DeliveryLock } from "../delivery-lock.js";
import { removeOpenCodeSession } from "../opencode-api.js";
import type * as DeliveryLockModule from "../delivery-lock.js";
import type * as OpenCodeApi from "../opencode-api.js";
import {
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

const hooks = vi.hoisted(() => ({
  /** Runs once when a caller starts to wait for the lock `name` (the real wait follows). */
  onLockWait: null as null | { name: string; run: () => void },
}));
vi.mock("../delivery-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DeliveryLockModule>();
  return {
    ...actual,
    holdDeliveryLock: vi.fn((name: string, waitMs: number) => {
      const held = actual.holdDeliveryLock(name, waitMs);
      const hook = hooks.onLockWait;
      if (hook && hook.name === name) {
        hooks.onLockWait = null;
        hook.run();
      }
      return held;
    }),
  };
});
vi.mock("../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    removeOpenCodeSession: vi.fn(async () => undefined),
    interruptOpenCodeSession: vi.fn(async () => ({ interrupted: true })),
  };
});

const KEY = "ses_shared";

let ctx: TestContext;
let sessionsDir: string;
let ledgerDir: string;
let testLock: DeliveryLock | null;

beforeEach(() => {
  hooks.onLockWait = null;
  vi.mocked(holdDeliveryLock).mockClear();
  vi.mocked(removeOpenCodeSession).mockClear();
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
  ledgerDir = getDeliveryLedgerDir(ctx.config.configPath, ctx.config.projects["my-app"]!.path);
  testLock = null;
});

afterEach(() => {
  testLock?.release();
  teardownTestContext(ctx);
});

function recordOf(id: string): Record<string, string> | null {
  return readMetadataRaw(sessionsDir, id);
}

/** A valid version-2 ledger of KEY with one fresh `unknown` entry (an unresolved send). */
function freshLedger(): void {
  mkdirSync(ledgerDir, { recursive: true });
  const now = new Date().toISOString();
  const entry: DeliveryEntry = {
    inputId: "msg_unresolved1",
    textSha256: "a".repeat(64),
    createdAt: now,
    updatedAt: now,
    state: "unknown",
    owner: { pid: process.pid, token: randomUUID() },
  };
  writeFileSync(
    deliveryLedgerPath(ledgerDir, KEY),
    JSON.stringify({ version: 2, key: KEY, entries: [entry] }),
  );
  expect(readDeliveryLedger(ledgerDir, KEY)).toHaveLength(1);
}

/** Another process publishes a working launch of `id` that sends through KEY. */
function publishOwner(id: string): Record<string, string> {
  writeMetadata(sessionsDir, id, {
    worktree: join(ctx.tmpDir, `ws-${id}`),
    branch: "feat/new-owner",
    status: "working",
    project: "my-app",
    agent: "opencode",
    tmuxName: `hash-${id}`,
    createdAt: "2026-10-20T12:00:00.000Z",
    runtimeHandle: JSON.stringify(makeHandle(`rt-${id}`)),
  });
  expect(updateMetadata(sessionsDir, id, { opencodeSessionId: KEY })).toBe(true);
  return recordOf(id)!;
}

/**
 * The test holds the real ledger lock. When the removal starts to wait for
 * it, `during` runs, and the test frees the lock 100 ms later.
 */
async function holdLedgerLockUntilWait(during: () => void): Promise<void> {
  const name = deliveryLedgerLockName(ledgerDir, KEY);
  testLock = await tryHoldDeliveryLock(name);
  expect(testLock).not.toBeNull();
  hooks.onLockWait = {
    name,
    run: () => {
      during();
      setTimeout(() => testLock?.release(), 100);
    },
  };
}

async function withWarnings<T>(run: () => Promise<T>): Promise<{ value: T; text: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  try {
    const value = await run();
    return { value, text: lines.join("") };
  } finally {
    spy.mockRestore();
  }
}

describe("M-2 (round 6): the ledger removal checks the records after it holds the ledger lock", () => {
  /** An archived OpenCode session that is removed; its ledger removal failed before. */
  function archivedPendingLedger(): void {
    writeMetadata(sessionsDir, "app-1", {
      worktree: join(ctx.tmpDir, "ws-app-1"),
      branch: "feat/old",
      status: "killed",
      project: "my-app",
      agent: "opencode",
    });
    deleteMetadata(sessionsDir, "app-1", true);
    expect(
      updateArchivedMetadata(sessionsDir, "app-1", {
        opencodeCleanedAt: "2026-10-20T11:00:00.000Z",
        opencodeLedgerPending: KEY,
      }),
    ).toBe(true);
  }

  /** A live OpenCode session record whose kill with purge removes its ledger. */
  function openCodeRecord(): void {
    writeMetadata(sessionsDir, "app-1", {
      worktree: join(ctx.tmpDir, "ws-app-1"),
      branch: "feat/old",
      status: "working",
      project: "my-app",
      agent: "opencode",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-20T10:00:00.000Z",
      runtimeHandle: JSON.stringify(makeHandle("rt-app-1")),
    });
    expect(updateMetadata(sessionsDir, "app-1", { opencodeSessionId: KEY })).toBe(true);
  }

  it("review case: a new owner of the key during the lock wait of the cleanup retry keeps the ledger and the pending key", async () => {
    archivedPendingLedger();
    freshLedger();
    let owner: Record<string, string> | undefined;
    await holdLedgerLockUntilWait(() => {
      owner = publishOwner("app-2");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const { value: result, text } = await withWarnings(() => sm.cleanup("my-app"));

    expect(hooks.onLockWait).toBeNull();
    expect(holdDeliveryLock).toHaveBeenCalledWith(
      deliveryLedgerLockName(ledgerDir, KEY),
      expect.any(Number),
    );
    expect(recordOf("app-2")).toEqual(owner);
    expect(readDeliveryLedger(ledgerDir, KEY)).toHaveLength(1);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"]).toBe(KEY);
    expect(result.errors).toEqual([]);
    expect(text).toMatch(
      /could not remove the delivery ledger .*ses_shared\.json of OpenCode session ses_shared of app-1 \(session app-2 names OpenCode session ses_shared\); the next `ao session cleanup` tries again/,
    );
  });

  it("control: the cleanup retry with no change during the lock wait removes the ledger and clears the pending key", async () => {
    archivedPendingLedger();
    freshLedger();
    await holdLedgerLockUntilWait(() => undefined);
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const { value: result, text } = await withWarnings(() => sm.cleanup("my-app"));

    expect(hooks.onLockWait).toBeNull();
    expect(existsSync(deliveryLedgerPath(ledgerDir, KEY))).toBe(false);
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["opencodeLedgerPending"] ?? "").toBe("");
    expect(result.errors).toEqual([]);
    expect(text).not.toMatch(/delivery ledger/);
  });

  it("kill with purge: a new owner of the key during the lock wait keeps the ledger, and the archive gets the pending key", async () => {
    openCodeRecord();
    freshLedger();
    let owner: Record<string, string> | undefined;
    await holdLedgerLockUntilWait(() => {
      owner = publishOwner("app-2");
    });
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const { text } = await withWarnings(() => sm.kill("app-1", { purgeOpenCode: true }));

    expect(hooks.onLockWait).toBeNull();
    expect(removeOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(recordOf("app-2")).toEqual(owner);
    expect(readDeliveryLedger(ledgerDir, KEY)).toHaveLength(1);
    const archived = readArchivedMetadataRaw(sessionsDir, "app-1");
    expect(archived?.["opencodeCleanedAt"]).toBeDefined();
    expect(archived?.["opencodeLedgerPending"]).toBe(KEY);
    expect(text).toMatch(
      /\(session app-2 names OpenCode session ses_shared\); the next `ao session cleanup` tries again/,
    );
  });

  it("control: kill with purge and no change during the lock wait removes the ledger", async () => {
    openCodeRecord();
    freshLedger();
    await holdLedgerLockUntilWait(() => undefined);
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.kill("app-1", { purgeOpenCode: true });

    expect(hooks.onLockWait).toBeNull();
    expect(existsSync(deliveryLedgerPath(ledgerDir, KEY))).toBe(false);
    const archived = readArchivedMetadataRaw(sessionsDir, "app-1");
    expect(archived?.["opencodeCleanedAt"]).toBeDefined();
    expect(archived?.["opencodeLedgerPending"] ?? "").toBe("");
  });
});
