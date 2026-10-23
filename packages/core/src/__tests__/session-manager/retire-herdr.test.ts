/**
 * Herdr fit-2 F-9 (design development/reviews/herdr_fit2_design_r11_opus.md
 * section 5.4; fit-2b commit 7): the owner's retirement of a Herdr record
 * with an OpenCode session, through the real session manager. The herdr
 * runtime is a stand-in with the plugin's answers (a stop that cannot
 * confirm, an `isAlive` false); the OpenCode API is mocked. The cases with
 * the real herdr plugin are in runtime-herdr `fit2-create-rollback.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import {
  launchIdentityToken,
  readArchivedMetadataRaw,
  readMetadataRaw,
  updateMetadata,
  writeMetadata,
} from "../../metadata.js";
import { getWorktreesDir } from "../../paths.js";
import { interruptOpenCodeSession, removeOpenCodeSession } from "../../opencode-api.js";
import type * as DeliveryLedger from "../../delivery-ledger.js";
import type * as OpenCodeApi from "../../opencode-api.js";
import type * as FsPromises from "node:fs/promises";
import type { PluginRegistry, Runtime, RuntimeHandle } from "../../types.js";
import { setupTestContext, teardownTestContext, type TestContext } from "../test-utils.js";

const hooks = vi.hoisted(() => ({
  /** Runs once inside the read of `/proc/<pid>/stat` for this pid (a launcher check). */
  duringProcRead: null as null | { pid: string; run: () => void },
}));

vi.mock("../../opencode-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof OpenCodeApi>();
  return {
    ...actual,
    removeOpenCodeSession: vi.fn(async () => undefined),
    interruptOpenCodeSession: vi.fn(async () => ({ interrupted: true })),
  };
});
vi.mock("../../delivery-ledger.js", async (importOriginal) => {
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
        hooks.duringProcRead = null;
        hook.run();
      }
      return actual.readFile(...args);
    }),
  };
});

let ctx: TestContext;
let sessionsDir: string;
let herdrRuntime: Runtime;
let registry: PluginRegistry;

/** A PID that no process has: the launcher check reads its stat file and finds none. */
const DEAD_PID = "2147483646";
const OPENCODE_SESSION = "ses_retire";
const HANDLE: RuntimeHandle = {
  id: "w7:p1",
  runtimeName: "herdr",
  data: { workspaceId: "w7", paneId: "w7:p1", terminalId: "term_w7" },
};

beforeEach(() => {
  hooks.duringProcRead = null;
  vi.mocked(removeOpenCodeSession).mockClear();
  vi.mocked(interruptOpenCodeSession).mockClear();
  ctx = setupTestContext();
  ({ sessionsDir } = ctx);
  // The plugin's answers for a closed pane: the stop cannot confirm, and
  // the pane does not exist.
  herdrRuntime = {
    ...ctx.mockRuntime,
    name: "herdr",
    stop: vi.fn(async () => ({
      outcome: "unknown" as const,
      detail: "the Herdr close cannot yet check the terminal at close time",
    })),
    isAlive: vi.fn(async () => false),
  };
  registry = {
    ...ctx.mockRegistry,
    get: vi.fn((slot: string, name: string) =>
      slot === "runtime" && name === "herdr"
        ? herdrRuntime
        : ctx.mockRegistry.get(slot as never, name),
    ),
  } as unknown as PluginRegistry;
});

afterEach(() => {
  teardownTestContext(ctx);
});

/** A kept Herdr launch of an OpenCode session, in a managed worktree. */
function keptOpenCodeRecord(id = "app-1"): string {
  const project = ctx.config.projects["my-app"]!;
  const worktree = join(getWorktreesDir(ctx.config.configPath, project.path), id);
  mkdirSync(worktree, { recursive: true });
  writeMetadata(sessionsDir, id, {
    worktree,
    branch: `session/${id}`,
    status: "spawning",
    project: "my-app",
    agent: "opencode",
    createdAt: "2026-10-20T10:00:00.000Z",
    runtimeHandle: JSON.stringify(HANDLE),
  });
  updateMetadata(sessionsDir, id, {
    opencodeSessionId: OPENCODE_SESSION,
    launchFailed: "Failed to launch agent in herdr pane w7:p1: confirmLaunch failed",
  });
  return worktree;
}

function tokenOf(id: string): string {
  return launchIdentityToken(readMetadataRaw(sessionsDir, id) ?? {});
}

describe("Herdr fit-2 F-9 with an OpenCode session (T-9.8c, T-9.10)", () => {
  it("T-9.10: without --purge-session the OpenCode session is kept", async () => {
    keptOpenCodeRecord();
    const sm = createSessionManager({ config: ctx.config, registry });
    await sm.kill("app-1", { confirmRuntimeClosed: tokenOf("app-1") });
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    const archived = readArchivedMetadataRaw(sessionsDir, "app-1");
    expect(archived).toMatchObject({ retiredBy: "owner", opencodeSessionId: OPENCODE_SESSION });
    expect(archived).not.toHaveProperty("opencodeCleanedAt");
    expect(interruptOpenCodeSession).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
  });

  it("T-9.10: with --purge-session the OpenCode session is purged", async () => {
    keptOpenCodeRecord();
    const sm = createSessionManager({ config: ctx.config, registry });
    await sm.kill("app-1", { purgeOpenCode: true, confirmRuntimeClosed: tokenOf("app-1") });
    expect(readMetadataRaw(sessionsDir, "app-1")).toBeNull();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toMatchObject({
      retiredBy: "owner",
      opencodeCleanedAt: expect.any(String),
    });
    expect(interruptOpenCodeSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(removeOpenCodeSession).mock.calls[0]?.[0]).toBe(OPENCODE_SESSION);
  });

  it("T-9.8c: a replacement in the purge holder lookup after the retire write; no interrupt, no removal, no archive", async () => {
    const worktree = keptOpenCodeRecord();
    const token = tokenOf("app-1");
    // A dead launch of another session names the same OpenCode session; its
    // launcher check is the await of the holder lookup.
    writeMetadata(sessionsDir, "app-2", {
      worktree: join(ctx.tmpDir, "ws-app-2"),
      branch: "session/app-2",
      status: "spawning",
      project: "my-app",
      agent: "opencode",
    });
    updateMetadata(sessionsDir, "app-2", {
      opencodeSessionId: OPENCODE_SESSION,
      launchPid: DEAD_PID,
      launchPidStart: "stat:1",
    });
    hooks.duringProcRead = {
      pid: DEAD_PID,
      run: () => {
        updateMetadata(sessionsDir, "app-1", { restoredAt: "2026-10-21T00:00:00.000Z" });
      },
    };
    const sm = createSessionManager({ config: ctx.config, registry });

    await expect(
      sm.kill("app-1", { purgeOpenCode: true, confirmRuntimeClosed: token }),
    ).rejects.toThrow(
      /Session app-1 changed while it was killed .*its agent session and record were kept/,
    );

    expect(interruptOpenCodeSession).not.toHaveBeenCalled();
    expect(removeOpenCodeSession).not.toHaveBeenCalled();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")).toBeNull();
    // The retire keys of step 8 stay in the record; their token no longer
    // names it.
    const record = readMetadataRaw(sessionsDir, "app-1");
    expect(record).toMatchObject({ retiredBy: "owner", retiredIdentityToken: token });
    expect(tokenOf("app-1")).not.toBe(token);
    // The managed worktree was removed before the purge (the mock workspace).
    expect(ctx.mockWorkspace.destroy).toHaveBeenCalledWith(worktree, expect.any(Function));
    expect(existsSync(worktree)).toBe(true);
  });

  it("control: the retirement makes one isAlive with the handle and no other runtime call", async () => {
    keptOpenCodeRecord();
    const sm = createSessionManager({ config: ctx.config, registry });
    await sm.kill("app-1", { confirmRuntimeClosed: tokenOf("app-1") });
    expect(herdrRuntime.stop).toHaveBeenCalledTimes(1);
    expect(herdrRuntime.isAlive).toHaveBeenCalledTimes(1);
    expect(herdrRuntime.isAlive).toHaveBeenCalledWith(HANDLE);
    expect(herdrRuntime.destroy).not.toHaveBeenCalled();
    expect(readArchivedMetadataRaw(sessionsDir, "app-1")?.["retireEvidence"]).toBe(
      "herdr answered that the pane does not exist or that it has another terminal",
    );
  });
});
