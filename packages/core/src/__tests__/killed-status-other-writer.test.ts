/**
 * Round 5 (B-2): two version compares whose read and write are in one
 * synchronous section, so only another process can write between them. A
 * stand-in hook in `node:fs` writes there as such a process would.
 *
 * - The repair on read compares the generation and the launch. A record of
 *   an earlier build has no generation, so only the launch tells a new
 *   launch of such a record from the one that was read. The hook is the
 *   mtime read (`statSync`) right after the record read.
 * - The recovery cleanup archives only the record that it just marked
 *   terminated (its generation and its launch). An earlier build's merge
 *   keeps the `generation` key unchanged, so only the launch tells its new
 *   launch apart. The hook is the rename of the terminated write.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Fs from "node:fs";
import { createSessionManager } from "../session-manager.js";
import { readArchivedMetadataRaw, readMetadataRaw, writeMetadata } from "../metadata.js";
import { cleanupSession } from "../recovery/actions.js";
import { DEFAULT_RECOVERY_CONFIG, type RecoveryAssessment } from "../recovery/types.js";
import {
  makeHandle,
  setupTestContext,
  teardownTestContext,
  type TestContext,
} from "./test-utils.js";

const hooks = vi.hoisted(() => ({
  /** Runs once at the first `statSync` of `path` after a read of it. */
  afterRead: null as null | { path: string; run: () => void },
  readSeen: false,
  /** Runs once right after a rename onto `path`. */
  afterRename: null as null | { path: string; run: () => void },
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (hooks.afterRead && String(args[0]) === hooks.afterRead.path) hooks.readSeen = true;
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
    renameSync: ((...args: Parameters<typeof actual.renameSync>) => {
      actual.renameSync(...args);
      const hook = hooks.afterRename;
      if (hook && String(args[1]) === hook.path) {
        hooks.afterRename = null;
        hook.run();
      }
    }) as typeof actual.renameSync,
    statSync: ((...args: Parameters<typeof actual.statSync>) => {
      const hook = hooks.afterRead;
      if (hook && hooks.readSeen && String(args[0]) === hook.path) {
        hooks.afterRead = null;
        hook.run();
      }
      return actual.statSync(...args);
    }) as typeof actual.statSync,
  };
});

let ctx: TestContext;

beforeEach(() => {
  hooks.afterRead = null;
  hooks.readSeen = false;
  hooks.afterRename = null;
  ctx = setupTestContext();
});

afterEach(() => {
  teardownTestContext(ctx);
});

const PR1 = "https://github.com/org/my-app/pull/1";

/** An orchestrator record of an earlier build (no generation) that still holds a PR. */
function oldBuildOrchestrator(handleId: string): string {
  return [
    `worktree=${ctx.tmpDir}`,
    "branch=main",
    "status=pr_open",
    `pr=${PR1}`,
    "project=my-app",
    "tmuxName=hash-app-orchestrator",
    "createdAt=2026-10-20T10:00:00.000Z",
    `runtimeHandle=${JSON.stringify(makeHandle(handleId))}`,
    "",
  ].join("\n");
}

describe("B-2 (round 5): the repair on read compares the launch", () => {
  it("a new launch of an earlier build between the read and the write is not repaired from the read", async () => {
    const file = join(ctx.sessionsDir, "app-orchestrator");
    writeFileSync(file, oldBuildOrchestrator("rt-old"));
    hooks.afterRead = {
      path: file,
      run: () => writeFileSync(file, oldBuildOrchestrator("rt-relaunched")),
    };
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.list("my-app");

    const record = readMetadataRaw(ctx.sessionsDir, "app-orchestrator");
    expect(record).toMatchObject({
      runtimeHandle: JSON.stringify(makeHandle("rt-relaunched")),
      pr: PR1,
      status: "pr_open",
    });
    expect(record?.["role"]).toBeUndefined();
  });

  it("control: an unchanged orchestrator record of an earlier build is repaired", async () => {
    const file = join(ctx.sessionsDir, "app-orchestrator");
    writeFileSync(file, oldBuildOrchestrator("rt-old"));
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    await sm.list("my-app");

    const record = readMetadataRaw(ctx.sessionsDir, "app-orchestrator");
    expect(record).toMatchObject({ role: "orchestrator", prAutoDetect: "off", status: "working" });
    expect(record?.["pr"]).toBeUndefined();
  });
});

describe("B-2 (round 5): the recovery cleanup archives only the launch that it marked terminated", () => {
  function launched(): Record<string, string> {
    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree: join(ctx.tmpDir, "ws-app-1"),
      branch: "feat/old",
      status: "working",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-20T10:00:00.000Z",
      runtimeHandle: JSON.stringify(makeHandle("rt-app-1")),
    });
    return readMetadataRaw(ctx.sessionsDir, "app-1")!;
  }

  function assessment(rawMetadata: Record<string, string>): RecoveryAssessment {
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
    } as RecoveryAssessment;
  }

  const context = () => ({
    configPath: ctx.config.configPath,
    recoveryConfig: { ...DEFAULT_RECOVERY_CONFIG, logPath: join(ctx.tmpDir, "recovery.log") },
    dryRun: false,
  });

  it("an earlier build's merge of a new launch right after the terminated write is not archived", async () => {
    const raw = launched();
    const file = join(ctx.sessionsDir, "app-1");
    hooks.afterRename = {
      path: file,
      run: () => {
        // An earlier build's merge (a restore): the other keys stay, the
        // generation key too, without a new value.
        const current = readMetadataRaw(ctx.sessionsDir, "app-1")!;
        const merged = {
          ...current,
          status: "spawning",
          runtimeHandle: JSON.stringify(makeHandle("rt-relaunched")),
          restoredAt: "2026-10-20T12:00:00.000Z",
        };
        writeFileSync(
          file,
          Object.entries(merged)
            .map(([key, value]) => `${key}=${value}\n`)
            .join(""),
        );
      },
    };

    await cleanupSession(assessment(raw), ctx.config, ctx.mockRegistry, context());

    expect(hooks.afterRename).toBeNull();
    expect(readMetadataRaw(ctx.sessionsDir, "app-1")).toMatchObject({
      runtimeHandle: JSON.stringify(makeHandle("rt-relaunched")),
      restoredAt: "2026-10-20T12:00:00.000Z",
    });
    expect(readArchivedMetadataRaw(ctx.sessionsDir, "app-1")).toBeNull();
  });

  it("control: with no other write, the terminated record is archived", async () => {
    const raw = launched();

    const result = await cleanupSession(assessment(raw), ctx.config, ctx.mockRegistry, context());

    expect(result.success).toBe(true);
    expect(readMetadataRaw(ctx.sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(ctx.sessionsDir, "app-1")).toMatchObject({
      status: "terminated",
    });
  });
});
