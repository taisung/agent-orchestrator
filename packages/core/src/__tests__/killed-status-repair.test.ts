/**
 * Round 5 (B-2): the repair on read writes only into the version that it
 * read, compared with its generation and its launch. A record of an earlier
 * build has no generation, so only the launch tells a new launch of such a
 * record from the one that was read.
 *
 * The repair reads and writes in one synchronous section; another process
 * can write between the read and the locked write only. A stand-in hook in
 * `statSync` (the mtime read right after the record read) writes there as
 * such a process would.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Fs from "node:fs";
import { createSessionManager } from "../session-manager.js";
import { readMetadataRaw } from "../metadata.js";
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
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (hooks.afterRead && String(args[0]) === hooks.afterRead.path) hooks.readSeen = true;
      return actual.readFileSync(...args);
    }) as typeof actual.readFileSync,
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
