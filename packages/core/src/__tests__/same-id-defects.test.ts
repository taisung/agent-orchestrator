/**
 * Defect tests of the same-ID design round (ao-48, design file
 * development/reviews/same_id_design_r1_opus.md). Each test fails on
 * ce49c9fd for the measured reason and describes the wanted behavior.
 *
 * Marking: `defect(...)` is `it.fails`, so the full suite stays green while
 * the defect is there, and the test turns red (vitest: "Expect test to fail")
 * as soon as a fix makes it pass. The fix round then changes `defect` to `it`.
 * Run `SAME_ID_DEFECTS=red pnpm vitest run same-id` to see the failures as
 * plain tests. Each describe names its implementation round (R1, R3, R4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type * as ChildProcess from "node:child_process";
import type * as OpenCodeApi from "../opencode-api.js";

/** Child processes: `tmux` goes to the stand-in below; every other command fails. */
const proc = vi.hoisted(() => ({
  tmux: null as null | ((args: string[]) => string),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const run = (cmd: string, args: string[]): string => {
    if (cmd === "tmux" && proc.tmux) return proc.tmux(args);
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

import {
  capturePane,
  getPaneTTY,
  hasSession,
  killSession,
  sendKeys,
} from "../tmux.js";
import { createSessionManager } from "../session-manager.js";
import { readMetadataRaw, writeMetadata } from "../metadata.js";
import { validateSession } from "../recovery/validator.js";
import type { RuntimeHandle, Session } from "../types.js";
import { setupTestContext, teardownTestContext, type TestContext } from "./test-utils.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

/** A test that needs a mode-000 directory; root reads it anyway. Same-ID R4 made it a plain test. */
function itUnlessRoot(name: string, fn: () => Promise<void>): void {
  if (process.getuid?.() === 0) it.skip(name, fn);
  else it(name, fn);
}

/** Wait until `promise` settles, at most `ms` (a serialized competitor may wait for us). */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  await Promise.race([promise.then(() => undefined, () => undefined), sleep(ms)]);
}

// ---------------------------------------------------------------------------
// R1: the exported core tmux helpers (D-A)
// ---------------------------------------------------------------------------

/**
 * One tmux 3.4 server with the given sessions: a target is tried as an exact
 * name, then as the start of one name; `=name` (with or without `:`) matches
 * exactly (measured, design file Q1).
 */
function tmuxWith(names: string[]) {
  const sessions = new Map(names.map((n, i) => [n, { tty: `/dev/pts/${50 + i}`, keys: [] as string[] }]));
  const find = (target: string) => {
    const part = target.split(":")[0]!;
    if (part.startsWith("=")) return sessions.get(part.slice(1));
    const exact = sessions.get(part);
    if (exact) return exact;
    const prefixed = [...sessions.keys()].filter((n) => n.startsWith(part));
    return prefixed.length === 1 ? sessions.get(prefixed[0]!) : undefined;
  };
  proc.tmux = (args) => {
    const target = args[args.indexOf("-t") + 1] ?? "";
    const session = args.includes("-t") ? find(target) : undefined;
    if (args.includes("-t") && !session) {
      throw Object.assign(new Error(`tmux ${args[0]} failed`), {
        code: 1,
        stderr: `can't find session: ${target.split(":")[0]!.replace(/^=/, "")}\n`,
      });
    }
    switch (args[0]) {
      case "has-session":
        return "";
      case "kill-session":
        for (const [name, s] of sessions) if (s === session) sessions.delete(name);
        return "";
      case "send-keys":
        session!.keys.push(...args.slice(args.indexOf("-t") + 2).filter((a) => a !== "-l"));
        return "";
      case "paste-buffer":
        session!.keys.push("[paste]");
        return "";
      case "load-buffer":
        return "";
      case "capture-pane":
        return `screen of the session with tty ${session!.tty}`;
      case "list-panes":
        return `${session!.tty}\n`;
      default:
        throw new Error(`tmux stand-in: unsupported ${args.join(" ")}`);
    }
  };
  return sessions;
}

describe("[same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix", () => {
  afterEach(() => {
    proc.tmux = null;
  });

  it("hasTmuxSession answers false for a dead name while one live name starts with it", async () => {
    tmuxWith(["kr-10"]);
    await expect(hasSession("kr-1")).resolves.toBe(false);
  });

  it("killTmuxSession of a dead name does not end the live session", async () => {
    const sessions = tmuxWith(["kr-10"]);
    await killSession("kr-1").catch(() => undefined);
    expect([...sessions.keys()]).toEqual(["kr-10"]);
  });

  it("tmuxSendKeys to a dead name types nothing into another session", async () => {
    const sessions = tmuxWith(["kr-10"]);
    await sendKeys("kr-1", "hello").catch(() => undefined);
    expect(sessions.get("kr-10")!.keys).toEqual([]);
  });

  it("tmuxCapturePane of a dead name does not read another session's screen", async () => {
    tmuxWith(["kr-10"]);
    const screen = await capturePane("kr-1").catch(() => "");
    expect(screen).not.toContain("/dev/pts/50");
  });

  it("getTmuxPaneTTY of a dead name does not answer another session's pane", async () => {
    tmuxWith(["kr-10"]);
    await expect(getPaneTTY("kr-1")).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R3: the launch identity (D-C, F-5 for a runtime destroy by name)
// ---------------------------------------------------------------------------

describe("[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestContext();
  });

  afterEach(() => {
    teardownTestContext(ctx);
  });

  defect("kill and restore of one ID: the active record at the end names a live runtime", async () => {
    // A runtime that, like tmux, knows its sessions by name only: every
    // launch of app-1 uses the name hash-app-1.
    const live = new Set<string>();
    const competitor: { restore?: Promise<Session> } = {};
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    vi.mocked(ctx.mockRuntime.create).mockImplementation(async (cfg) => {
      live.add(cfg.sessionId);
      return { id: cfg.sessionId, runtimeName: "mock", data: {} };
    });
    vi.mocked(ctx.mockRuntime.isAlive).mockImplementation(async (h: RuntimeHandle) => live.has(h.id));
    vi.mocked(ctx.mockRuntime.destroy).mockImplementation(async (h: RuntimeHandle) => {
      if (!competitor.restore) {
        // The kill's check passed directly before this command. While the
        // command runs, a restore of app-1 (`ao send`, a lifecycle reaction)
        // relaunches the session under the same name.
        competitor.restore = sm.restore("app-1");
        await settledWithin(competitor.restore, 500);
      }
      live.delete(h.id);
    });
    vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(false);
    const worktree = join(ctx.tmpDir, "ws-app-1");
    mkdirSync(worktree, { recursive: true });
    // app-1's pane died; its record still says working.
    writeMetadata(ctx.sessionsDir, "app-1", {
      worktree,
      branch: "feat/old",
      status: "working",
      project: "my-app",
      tmuxName: "hash-app-1",
      createdAt: "2026-10-21T10:00:00.000Z",
      runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
    });

    await sm.kill("app-1").catch(() => undefined);
    await competitor.restore?.catch(() => undefined);

    const record = readMetadataRaw(ctx.sessionsDir, "app-1");
    if (record !== null) {
      const handle = JSON.parse(record["runtimeHandle"] ?? "{}") as { id?: string };
      // Measured: the restore created hash-app-1 and wrote its launch, then
      // the kill's destroy by name ended it.
      expect(
        live.has(handle.id ?? ""),
        `the active record (restoredAt=${record["restoredAt"] ?? "none"}) names a runtime that no longer runs`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// R4: older reads that answer "nothing" when they cannot check (D-D)
// ---------------------------------------------------------------------------

describe("[same-id R4] D-D: older reads that answer 'nothing' when they cannot check", () => {
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

  /** `sessions/archive` becomes a symlink to itself: `existsSync` answers false (ELOOP). */
  function archiveCannotBeChecked(): void {
    const archive = join(ctx.sessionsDir, "archive");
    symlinkSync(archive, archive);
    expect(existsSync(archive)).toBe(false);
  }

  it("spawn does not take a session number while the archive directory cannot be checked", async () => {
    // The archive may hold app-1 (round-9 audit: the session numbers read
    // `listArchivedSessionIds`, whose `existsSync` answers "no archives").
    archiveCannotBeChecked();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    await sm.spawn({ projectId: "my-app" }).catch(() => undefined);
    expect(
      readMetadataRaw(ctx.sessionsDir, "app-1"),
      "the spawn took app-1 without a check of the archive",
    ).toBeNull();
  });

  it("cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked", async () => {
    // app-1 (OpenCode, dead runtime) runs on ses_shared; the archive of
    // another ID that issue reuse gave ses_shared to is behind the archive
    // directory, which cannot be checked.
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
    archiveCannotBeChecked();
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(false);
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    await sm.cleanup("my-app").catch(() => undefined);
    // Measured in code: `hasOtherOpenCodeRecord` reads the old listing and
    // answers "no other record", so the cleanup kill purges the session.
    expect(api.remove).not.toHaveBeenCalled();
  });

  itUnlessRoot(
    "recovery: a workspace that cannot be checked does not give a live session the cleanup action",
    async () => {
      const parent = join(ctx.tmpDir, "locked");
      const worktree = join(parent, "ws-app-1");
      mkdirSync(worktree, { recursive: true });
      chmodSync(parent, 0o000);
      try {
        vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
        vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(true);
        const rawMetadata = {
          worktree,
          branch: "feat/live",
          status: "working",
          project: "my-app",
          runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
        };
        const assessment = await validateSession(
          {
            sessionId: "app-1",
            projectId: "my-app",
            project: ctx.config.projects["my-app"]!,
            sessionsDir: ctx.sessionsDir,
            rawMetadata,
          },
          ctx.config,
          ctx.mockRegistry,
          { escalatePartial: false },
        );
        // Measured in code (validator.ts:78-92): `existsSync` answers false
        // for a path it cannot check, the live session reads "partial", and
        // with escalatePartial false the action is "cleanup" (the runtime
        // is destroyed, recovery/actions.ts:166).
        expect(assessment.action).not.toBe("cleanup");
      } finally {
        chmodSync(parent, 0o755);
      }
    },
  );
});
