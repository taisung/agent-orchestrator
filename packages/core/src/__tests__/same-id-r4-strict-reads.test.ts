/**
 * Same-ID R4 (design r2 section 3, B-7): a read that a destructive or
 * allocating decision uses keeps "explicitly gone" (`ENOENT`) as its only
 * negative, and every other failure is unknown. The R4 tests of the defect
 * files cover the first case of each item; these tests add the side-effect
 * checks of item 1 (no reservation, no workspace and no runtime after a
 * strict listing fails) and the cases of items 2, 3 and 5 that the defect
 * files do not cover. Each test fails on 75f1c98b; the controls pass there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";
import type * as OpenCodeApi from "../opencode-api.js";

/** Child processes: every command fails to start (no git, tmux or ps runs). */
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const fail = (cmd: string) =>
    Object.assign(new Error(`unexpected command: ${cmd}`), { code: "ENOENT" });
  const execFile = ((cmd: string, _args: string[], ...rest: unknown[]) => {
    const callback = rest.find((r) => typeof r === "function") as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    queueMicrotask(() => callback?.(fail(cmd), "", ""));
  }) as unknown as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string) => {
      throw fail(cmd);
    },
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

import { createSessionManager } from "../session-manager.js";
import { readMetadataRaw, writeMetadata } from "../metadata.js";
import { validateSession } from "../recovery/validator.js";
import { setupTestContext, teardownTestContext, type TestContext } from "./test-utils.js";

/** A test that needs a mode-000 entry; root reads it anyway. */
function itUnlessRoot(name: string, fn: () => Promise<void>): void {
  if (process.getuid?.() === 0) it.skip(name, fn);
  else it(name, fn);
}

let ctx: TestContext;
let stderr: string[];

beforeEach(() => {
  ctx = setupTestContext();
  api.remove.mockClear();
  api.interrupt.mockClear();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  teardownTestContext(ctx);
});

/** The entries of the sessions directory other than the archive directory. */
function sessionEntries(): string[] {
  return readdirSync(ctx.sessionsDir).filter((name) => name !== "archive");
}

/** `sessions/archive` becomes a symlink to itself: a read of it fails with `ELOOP`. */
function archiveLoops(): void {
  const archive = join(ctx.sessionsDir, "archive");
  symlinkSync(archive, archive);
  expect(existsSync(archive)).toBe(false);
}

// ---------------------------------------------------------------------------
// Item 1: the session numbers read the archive directory strictly
// ---------------------------------------------------------------------------

describe("same-id R4, B-7 item 1: no session number while the archive directory cannot be listed", () => {
  it("spawn refuses with the reason, before any reservation, workspace or runtime", async () => {
    archiveLoops();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const err = await sm.spawn({ projectId: "my-app" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain(
      `Cannot choose a session number: the archive directory ${join(ctx.sessionsDir, "archive")} could not be listed (`,
    );
    expect(message).toContain("nothing was created");
    expect(message).toMatch(/ELOOP/);
    expect(sessionEntries(), "a reservation or record was written").toEqual([]);
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
  });

  itUnlessRoot("spawn refuses for an archive directory that cannot be read (EACCES)", async () => {
    const archive = join(ctx.sessionsDir, "archive");
    mkdirSync(archive, { recursive: true });
    chmodSync(archive, 0o000);
    try {
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
      const err = await sm.spawn({ projectId: "my-app" }).catch((e: unknown) => e);

      expect((err as Error).message).toContain("Cannot choose a session number");
      expect((err as Error).message).toMatch(/EACCES/);
      expect(sessionEntries()).toEqual([]);
      expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
      expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
    } finally {
      chmodSync(archive, 0o755);
    }
  });

  it("an isolated orchestrator start refuses with the reason, before any reservation, workspace or runtime", async () => {
    archiveLoops();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const err = await sm.spawnOrchestrator({ projectId: "my-app" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Cannot choose a session number");
    expect(sessionEntries().filter((name) => !name.startsWith("."))).toEqual([]);
    expect(readMetadataRaw(ctx.sessionsDir, "app-orchestrator-1")).toBeNull();
    expect(ctx.mockWorkspace.create).not.toHaveBeenCalled();
    expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
  });

  it("control: a missing archive directory (ENOENT) has no archives, so spawn takes app-1", async () => {
    expect(existsSync(join(ctx.sessionsDir, "archive"))).toBe(false);
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const session = await sm.spawn({ projectId: "my-app" });

    expect(session.id).toBe("app-1");
    expect(ctx.mockRuntime.create).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Items 2 and 3: the cleanup's OpenCode holder check reads the active
// records strictly
// ---------------------------------------------------------------------------

describe("same-id R4, B-7 items 2 and 3: the cleanup keeps an OpenCode session that an unreadable record may name", () => {
  /** app-1: OpenCode on ses_shared, its runtime dead. */
  function deadOpenCodeSession(): void {
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
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(false);
  }

  function expectKept(result: {
    killed: string[];
    skipped: string[];
    errors: Array<{ sessionId: string; error: string }>;
  }): void {
    expect(result.killed).not.toContain("app-1");
    expect(result.skipped).toContain("app-1");
    expect(result.errors.filter((e) => e.sessionId === "app-1")).toEqual([]);
    expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();
    expect(readMetadataRaw(ctx.sessionsDir, "app-1")?.["opencodeSessionId"]).toBe("ses_shared");
    expect(stderr.join("")).toContain("ao: kept app-1: live session app-1 uses it.");
  }

  it("item 2: an active entry that cannot be checked (ELOOP) keeps the session, with the holder reason", async () => {
    deadOpenCodeSession();
    // `listMetadata` leaves this entry out; it may be a record that names ses_shared.
    symlinkSync(join(ctx.sessionsDir, "app-2"), join(ctx.sessionsDir, "app-2"));
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    expectKept(await sm.cleanup("my-app"));
  });

  itUnlessRoot(
    "item 3: an active record that becomes unreadable (EACCES) after the cleanup listed it keeps the session, with the holder reason",
    async () => {
      deadOpenCodeSession();
      writeMetadata(ctx.sessionsDir, "app-2", {
        worktree: join(ctx.tmpDir, "ws-app-2"),
        branch: "feat/INT-2",
        status: "working",
        project: "my-app",
        agent: "opencode",
        opencodeSessionId: "ses_other",
      });
      const record = join(ctx.sessionsDir, "app-2");
      // A record that cannot be read when the cleanup lists the sessions
      // stops the whole cleanup (the listing throws), so the record becomes
      // unreadable between that listing and the holder check: in the
      // runtime check of app-1, which answers "dead".
      vi.mocked(ctx.mockRuntime.isAlive).mockImplementationOnce(async () => {
        chmodSync(record, 0o000);
        return false;
      });
      try {
        const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
        // On 75f1c98b the read throws inside the runtime check's try: the
        // session is kept, but the result names the runtime check
        // ("the runtime check of mock session hash-app-1 could not answer").
        // app-2 itself gets the read error as its own result.
        const result = await sm.cleanup("my-app");
        expectKept(result);
        expect(result.errors.map((e) => e.sessionId)).toEqual(["app-2"]);
      } finally {
        chmodSync(record, 0o644);
      }
    },
  );

  // Same-ID R4 round 3 (review r2, M-5): a record or latest archive whose
  // content is not a well-formed record may name the session, so the
  // cleanup keeps it. Each case removed ses_shared on 8e9efe95 (the lenient
  // parser read the record as naming nothing).
  function writeOtherRecord(place: "active" | "archive", content: string): void {
    const dir = place === "archive" ? join(ctx.sessionsDir, "archive") : ctx.sessionsDir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, place === "archive" ? "app-2_2026-10-20T00-00-00-000Z" : "app-2"),
      content,
    );
  }

  for (const place of ["active", "archive"] as const) {
    for (const [label, content] of [
      ["a line without a delimiter (review r2)", "opencodeSessionId\n"],
      ["a line with an empty key", "project=my-app\n=ses_shared\n"],
      ["a key that comes twice", "opencodeSessionId=ses_shared\nopencodeSessionId=ses_other\n"],
    ] as const) {
      it(`round 3 (M-5): a malformed ${place} record with ${label} keeps the session, with the holder reason`, async () => {
        deadOpenCodeSession();
        writeOtherRecord(place, content);
        const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

        expectKept(await sm.cleanup("my-app"));
      });
    }
  }

  for (const [label, place, content] of [
    [
      "an active record with comments and blank lines that names another OpenCode session",
      "active",
      "# written by hand\n\nproject=my-app\nstatus=working\nopencodeSessionId=ses_other\n",
    ],
    ["an empty latest archive", "archive", ""],
  ] as const) {
    it(`round 3 (M-5) control: ${label} is not a holder, so the cleanup removes the session`, async () => {
      deadOpenCodeSession();
      writeOtherRecord(place, content);
      const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

      const result = await sm.cleanup("my-app");

      expect(result.killed).toContain("app-1");
      expect(api.remove.mock.calls.map((call) => call[0])).toEqual(["ses_shared"]);
    });
  }

  it("round 3 (M-5) control: a well-formed archive that names the session keeps it", async () => {
    deadOpenCodeSession();
    writeOtherRecord("archive", "project=my-app\nopencodeSessionId=ses_shared\n");
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    expectKept(await sm.cleanup("my-app"));
  });

  it("control: no other record and no archive name the session, so the cleanup removes it", async () => {
    deadOpenCodeSession();
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const result = await sm.cleanup("my-app");

    expect(result.killed).toContain("app-1");
    expect(readMetadataRaw(ctx.sessionsDir, "app-1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item 5: the recovery validator checks the workspace path with lstat
// ---------------------------------------------------------------------------

describe("same-id R4, B-7 item 5: the recovery validator keeps a path that cannot be checked as unknown", () => {
  async function assess(worktree: string) {
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(true);
    return validateSession(
      {
        sessionId: "app-1",
        projectId: "my-app",
        project: ctx.config.projects["my-app"]!,
        sessionsDir: ctx.sessionsDir,
        rawMetadata: {
          worktree,
          branch: "feat/live",
          status: "working",
          project: "my-app",
          runtimeHandle: JSON.stringify({ id: "hash-app-1", runtimeName: "mock", data: {} }),
        },
      },
      ctx.config,
      ctx.mockRegistry,
      { escalatePartial: false },
    );
  }

  it("a path under a symlink loop (ELOOP) gives a live session no action", async () => {
    const loop = join(ctx.tmpDir, "loop");
    symlinkSync(loop, loop);

    const assessment = await assess(join(loop, "ws-app-1"));

    expect(assessment.action).toBe("skip");
    expect(assessment.reason).toMatch(
      /^Liveness unknown \(workspace path check could not run: .*ELOOP/,
    );
  });

  itUnlessRoot(
    "a path under a parent that cannot be read (EACCES) gives a live session no action",
    async () => {
      const parent = join(ctx.tmpDir, "locked");
      mkdirSync(join(parent, "ws-app-1"), { recursive: true });
      chmodSync(parent, 0o000);
      try {
        const assessment = await assess(join(parent, "ws-app-1"));

        expect(assessment.action).toBe("skip");
        expect(assessment.reason).toMatch(
          /^Liveness unknown \(workspace path check could not run: .*EACCES/,
        );
      } finally {
        chmodSync(parent, 0o755);
      }
    },
  );

  it("control: a path that does not exist (ENOENT) is 'no workspace', not unknown", async () => {
    const assessment = await assess(join(ctx.tmpDir, "missing-path"));

    expect(assessment.workspaceExists).toBe(false);
    expect(assessment.action).not.toBe("skip");
    expect(assessment.reason).not.toMatch(/Liveness unknown/);
  });

  it("control: an existing path is a workspace", async () => {
    mkdirSync(join(ctx.tmpDir, "ws-app-1"));

    const assessment = await assess(join(ctx.tmpDir, "ws-app-1"));

    expect(assessment.workspaceExists).toBe(true);
    expect(assessment.action).not.toBe("skip");
  });
});
