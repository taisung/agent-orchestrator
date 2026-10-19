import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type * as Fs from "node:fs";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  readMetadata,
  readMetadataRaw,
  readArchivedMetadataRaw,
  writeMetadata,
  updateMetadata,
  deleteMetadata,
  listMetadata,
  reserveSessionId,
} from "../metadata.js";

/**
 * M-5: every synchronous `node:fs` call can be watched (`after` runs once the
 * call returns or throws) or made to fail (`fail` returns the error to throw
 * instead of the call). The probe itself runs with the probe off.
 */
const fsProbe = vi.hoisted(() => ({
  after: null as ((call: string) => void) | null,
  fail: null as ((call: string) => Error | undefined) | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value !== "function" || !name.endsWith("Sync")) continue;
    const call = value as (...args: unknown[]) => unknown;
    wrapped[name] = (...args: unknown[]) => {
      const error = fsProbe.fail?.(name);
      if (error) throw error;
      try {
        return call(...args);
      } finally {
        const after = fsProbe.after;
        if (after) {
          fsProbe.after = null;
          try {
            after(name);
          } finally {
            fsProbe.after = after;
          }
        }
      }
    };
  }
  return { ...wrapped, default: wrapped };
});

let dataDir: string;

beforeEach(() => {
  fsProbe.after = null;
  fsProbe.fail = null;
  dataDir = join(tmpdir(), `ao-test-metadata-${randomUUID()}`);
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  fsProbe.after = null;
  fsProbe.fail = null;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("writeMetadata + readMetadata", () => {
  it("writes and reads basic metadata", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/worktree",
      branch: "feat/test",
      status: "working",
    });

    const meta = readMetadata(dataDir, "app-1");
    expect(meta).not.toBeNull();
    expect(meta!.worktree).toBe("/tmp/worktree");
    expect(meta!.branch).toBe("feat/test");
    expect(meta!.status).toBe("working");
  });

  it("writes and reads optional fields", () => {
    writeMetadata(dataDir, "app-2", {
      worktree: "/tmp/w",
      branch: "main",
      status: "pr_open",
      issue: "https://linear.app/team/issue/INT-100",
      pr: "https://github.com/org/repo/pull/42",
      prAutoDetect: "off",
      summary: "Implementing feature X",
      project: "my-app",
      createdAt: "2025-01-01T00:00:00.000Z",
      runtimeHandle: '{"id":"tmux-1","runtimeName":"tmux"}',
    });

    const meta = readMetadata(dataDir, "app-2");
    expect(meta).not.toBeNull();
    expect(meta!.issue).toBe("https://linear.app/team/issue/INT-100");
    expect(meta!.pr).toBe("https://github.com/org/repo/pull/42");
    expect(meta!.prAutoDetect).toBe("off");
    expect(meta!.summary).toBe("Implementing feature X");
    expect(meta!.project).toBe("my-app");
    expect(meta!.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(meta!.runtimeHandle).toBe('{"id":"tmux-1","runtimeName":"tmux"}');
  });

  it("returns null for nonexistent session", () => {
    const meta = readMetadata(dataDir, "nonexistent");
    expect(meta).toBeNull();
  });

  it("produces key=value format matching bash scripts", () => {
    writeMetadata(dataDir, "app-3", {
      worktree: "/tmp/w",
      branch: "feat/INT-123",
      status: "working",
      issue: "https://linear.app/team/issue/INT-123",
    });

    const content = readFileSync(join(dataDir, "app-3"), "utf-8");
    expect(content).toContain("worktree=/tmp/w\n");
    expect(content).toContain("branch=feat/INT-123\n");
    expect(content).toContain("status=working\n");
    expect(content).toContain("issue=https://linear.app/team/issue/INT-123\n");
  });

  it("omits optional fields that are undefined", () => {
    writeMetadata(dataDir, "app-4", {
      worktree: "/tmp/w",
      branch: "main",
      status: "spawning",
    });

    const content = readFileSync(join(dataDir, "app-4"), "utf-8");
    expect(content).not.toContain("issue=");
    expect(content).not.toContain("pr=");
    expect(content).not.toContain("summary=");
  });

  it("serializes pinnedSummary field when present", () => {
    writeMetadata(dataDir, "app-5", {
      worktree: "/tmp/w",
      branch: "feat/test",
      status: "working",
      pinnedSummary: "First quality summary",
    });

    const content = readFileSync(join(dataDir, "app-5"), "utf-8");
    expect(content).toContain("pinnedSummary=First quality summary\n");
  });
});

describe("readMetadataRaw", () => {
  it("reads arbitrary key=value pairs", () => {
    writeFileSync(
      join(dataDir, "raw-1"),
      "worktree=/tmp/w\nbranch=main\ncustom_key=custom_value\n",
      "utf-8",
    );

    const raw = readMetadataRaw(dataDir, "raw-1");
    expect(raw).not.toBeNull();
    expect(raw!["worktree"]).toBe("/tmp/w");
    expect(raw!["custom_key"]).toBe("custom_value");
  });

  it("returns null for nonexistent session", () => {
    expect(readMetadataRaw(dataDir, "nope")).toBeNull();
  });

  it("handles comments and empty lines", () => {
    writeFileSync(
      join(dataDir, "raw-2"),
      "# This is a comment\n\nkey1=value1\n\n# Another comment\nkey2=value2\n",
      "utf-8",
    );

    const raw = readMetadataRaw(dataDir, "raw-2");
    expect(raw).toEqual({ key1: "value1", key2: "value2" });
  });

  it("handles values containing equals signs", () => {
    writeFileSync(
      join(dataDir, "raw-3"),
      'runtimeHandle={"id":"foo","data":{"key":"val"}}\n',
      "utf-8",
    );

    const raw = readMetadataRaw(dataDir, "raw-3");
    expect(raw!["runtimeHandle"]).toBe('{"id":"foo","data":{"key":"val"}}');
  });
});

describe("updateMetadata", () => {
  it("updates specific fields while preserving others", () => {
    writeMetadata(dataDir, "upd-1", {
      worktree: "/tmp/w",
      branch: "main",
      status: "spawning",
    });

    updateMetadata(dataDir, "upd-1", {
      status: "working",
      pr: "https://github.com/org/repo/pull/1",
    });

    const meta = readMetadata(dataDir, "upd-1");
    expect(meta!.status).toBe("working");
    expect(meta!.pr).toBe("https://github.com/org/repo/pull/1");
    expect(meta!.worktree).toBe("/tmp/w");
    expect(meta!.branch).toBe("main");
  });

  it("deletes keys set to empty string", () => {
    writeMetadata(dataDir, "upd-2", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
      summary: "doing stuff",
    });

    updateMetadata(dataDir, "upd-2", { summary: "" });

    const raw = readMetadataRaw(dataDir, "upd-2");
    expect(raw!["summary"]).toBeUndefined();
    expect(raw!["status"]).toBe("working");
  });

  it("creates file if it does not exist", () => {
    updateMetadata(dataDir, "upd-3", { status: "new", branch: "test" });

    const raw = readMetadataRaw(dataDir, "upd-3");
    expect(raw).toEqual({ status: "new", branch: "test" });
  });

  it("ignores undefined values", () => {
    writeMetadata(dataDir, "upd-4", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    updateMetadata(dataDir, "upd-4", { status: "pr_open", summary: undefined });

    const meta = readMetadata(dataDir, "upd-4");
    expect(meta!.status).toBe("pr_open");
    expect(meta!.summary).toBeUndefined();
  });
});

describe("deleteMetadata", () => {
  it("deletes metadata file and archives it", () => {
    writeMetadata(dataDir, "del-1", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    deleteMetadata(dataDir, "del-1", true);

    expect(existsSync(join(dataDir, "del-1"))).toBe(false);
    const archiveDir = join(dataDir, "archive");
    expect(existsSync(archiveDir)).toBe(true);
    const files = readdirSync(archiveDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^del-1_/);
  });

  it("deletes without archiving when archive=false", () => {
    writeMetadata(dataDir, "del-2", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    deleteMetadata(dataDir, "del-2", false);

    expect(existsSync(join(dataDir, "del-2"))).toBe(false);
    expect(existsSync(join(dataDir, "archive"))).toBe(false);
  });

  it("is a no-op for nonexistent session", () => {
    expect(() => deleteMetadata(dataDir, "nope")).not.toThrow();
  });
});

describe("readArchivedMetadataRaw", () => {
  it("reads the latest archived metadata for a session", () => {
    const archiveDir = join(dataDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    writeFileSync(
      join(archiveDir, "app-1_2025-01-01T00-00-00-000Z"),
      "branch=old-branch\nstatus=killed\n",
    );
    writeFileSync(
      join(archiveDir, "app-1_2025-06-15T12-00-00-000Z"),
      "branch=new-branch\nstatus=killed\n",
    );

    const raw = readArchivedMetadataRaw(dataDir, "app-1");
    expect(raw).not.toBeNull();
    expect(raw!["branch"]).toBe("new-branch");
  });

  it("does not match archives of session IDs sharing a prefix", () => {
    const archiveDir = join(dataDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    // "app" should NOT match "app_v2_..." (belongs to session "app_v2")
    writeFileSync(
      join(archiveDir, "app_v2_2025-01-01T00-00-00-000Z"),
      "branch=wrong\nstatus=killed\n",
    );

    expect(readArchivedMetadataRaw(dataDir, "app")).toBeNull();
  });

  it("correctly matches when similar-prefix sessions coexist in archive", () => {
    const archiveDir = join(dataDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    // Archive for "app" — timestamp starts with digit
    writeFileSync(
      join(archiveDir, "app_2025-06-15T12-00-00-000Z"),
      "branch=correct\nstatus=killed\n",
    );
    // Archive for "app_v2" — should not be matched by "app"
    writeFileSync(
      join(archiveDir, "app_v2_2025-01-01T00-00-00-000Z"),
      "branch=wrong\nstatus=killed\n",
    );

    const raw = readArchivedMetadataRaw(dataDir, "app");
    expect(raw).not.toBeNull();
    expect(raw!["branch"]).toBe("correct");

    const rawV2 = readArchivedMetadataRaw(dataDir, "app_v2");
    expect(rawV2).not.toBeNull();
    expect(rawV2!["branch"]).toBe("wrong");
  });

  it("returns null when no archive exists for session", () => {
    const archiveDir = join(dataDir, "archive");
    mkdirSync(archiveDir, { recursive: true });

    writeFileSync(
      join(archiveDir, "other-session_2025-01-01T00-00-00-000Z"),
      "branch=main\nstatus=killed\n",
    );

    expect(readArchivedMetadataRaw(dataDir, "app-1")).toBeNull();
  });

  it("returns null when archive directory does not exist", () => {
    expect(readArchivedMetadataRaw(dataDir, "app-1")).toBeNull();
  });

  it("integrates with deleteMetadata archive", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/w",
      branch: "feat/test",
      status: "killed",
      issue: "TEST-1",
    });

    deleteMetadata(dataDir, "app-1", true);

    // Active metadata should be gone
    expect(readMetadataRaw(dataDir, "app-1")).toBeNull();

    // Archived metadata should be readable
    const archived = readArchivedMetadataRaw(dataDir, "app-1");
    expect(archived).not.toBeNull();
    expect(archived!["branch"]).toBe("feat/test");
    expect(archived!["issue"]).toBe("TEST-1");
  });
});

describe("atomic writes", () => {
  it("writeMetadata leaves no .tmp files behind", () => {
    writeMetadata(dataDir, "atomic-1", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    const files = readdirSync(dataDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
    // Verify the actual file was written correctly
    const meta = readMetadata(dataDir, "atomic-1");
    expect(meta!.status).toBe("working");
  });

  it("updateMetadata leaves no .tmp files behind", () => {
    writeMetadata(dataDir, "atomic-2", {
      worktree: "/tmp/w",
      branch: "main",
      status: "spawning",
    });

    updateMetadata(dataDir, "atomic-2", { status: "working" });

    const files = readdirSync(dataDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
    const meta = readMetadata(dataDir, "atomic-2");
    expect(meta!.status).toBe("working");
  });

  it("concurrent writeMetadata calls do not produce corrupt files", () => {
    // Simulate rapid sequential writes (synchronous, so they serialize naturally,
    // but each individual write must be atomic — no partial content)
    for (let i = 0; i < 20; i++) {
      writeMetadata(dataDir, "atomic-3", {
        worktree: "/tmp/w",
        branch: `branch-${i}`,
        status: "working",
        summary: `iteration ${i}`,
      });
    }

    const meta = readMetadata(dataDir, "atomic-3");
    expect(meta).not.toBeNull();
    expect(meta!.branch).toBe("branch-19");
    expect(meta!.summary).toBe("iteration 19");

    // No leftover temp files
    const files = readdirSync(dataDir);
    const tmpFiles = files.filter((f) => f.includes(".tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("restoredAt persistence", () => {
  it("roundtrips restoredAt through writeMetadata and readMetadata", () => {
    const now = new Date().toISOString();
    writeMetadata(dataDir, "restore-1", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
      restoredAt: now,
    });

    const meta = readMetadata(dataDir, "restore-1");
    expect(meta).not.toBeNull();
    expect(meta!.restoredAt).toBe(now);
  });

  it("restoredAt is persisted in the key=value file", () => {
    const now = "2026-03-01T12:00:00.000Z";
    writeMetadata(dataDir, "restore-2", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
      restoredAt: now,
    });

    const content = readFileSync(join(dataDir, "restore-2"), "utf-8");
    expect(content).toContain(`restoredAt=${now}`);
  });

  it("restoredAt is undefined when not set", () => {
    writeMetadata(dataDir, "restore-3", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    const meta = readMetadata(dataDir, "restore-3");
    expect(meta!.restoredAt).toBeUndefined();
  });

  it("updateMetadata can set restoredAt on an existing session", () => {
    writeMetadata(dataDir, "restore-4", {
      worktree: "/tmp/w",
      branch: "main",
      status: "working",
    });

    const now = new Date().toISOString();
    updateMetadata(dataDir, "restore-4", { restoredAt: now });

    const meta = readMetadata(dataDir, "restore-4");
    expect(meta!.restoredAt).toBe(now);
  });
});

describe("listMetadata", () => {
  it("lists all session IDs", () => {
    writeMetadata(dataDir, "app-1", { worktree: "/tmp", branch: "a", status: "s" });
    writeMetadata(dataDir, "app-2", { worktree: "/tmp", branch: "b", status: "s" });
    writeMetadata(dataDir, "app-3", { worktree: "/tmp", branch: "c", status: "s" });

    const list = listMetadata(dataDir);
    expect(list).toHaveLength(3);
    expect(list.sort()).toEqual(["app-1", "app-2", "app-3"]);
  });

  it("excludes archive directory and dotfiles", () => {
    writeMetadata(dataDir, "app-1", { worktree: "/tmp", branch: "a", status: "s" });
    mkdirSync(join(dataDir, "archive"), { recursive: true });
    writeFileSync(join(dataDir, ".hidden"), "x", "utf-8");

    const list = listMetadata(dataDir);
    expect(list).toEqual(["app-1"]);
  });

  it("returns empty array when sessions dir does not exist", () => {
    const emptyDir = join(tmpdir(), `ao-test-empty-${randomUUID()}`);
    const list = listMetadata(emptyDir);
    expect(list).toEqual([]);
    // no cleanup needed since dir was never created
  });
});

describe("reserveSessionId (M-5)", () => {
  const claim = { launchPid: "4242", launchPidStart: "stat:99" };

  function errnoError(code: string): Error {
    return Object.assign(new Error(`${code}: injected`), { code });
  }

  it("with a claim, the record holds the claim from the first moment it exists", () => {
    const views: Array<{ call: string; listed: string[]; raw: Record<string, string> | null }> = [];
    fsProbe.after = (call) => {
      // What another process can read between two file system calls.
      views.push({
        call,
        listed: listMetadata(dataDir),
        raw: readMetadataRaw(dataDir, "app-1"),
      });
    };
    let reserved: boolean;
    try {
      reserved = reserveSessionId(dataDir, "app-1", claim);
    } finally {
      fsProbe.after = null;
    }

    expect(reserved).toBe(true);
    const withRecord = views.filter((view) => view.raw !== null);
    // The record appeared during the call, and never without the claim.
    expect(withRecord.length).toBeGreaterThan(0);
    for (const view of withRecord) expect(view).toMatchObject({ raw: claim });
    for (const view of views) {
      expect(view.listed).toEqual(view.raw === null ? [] : ["app-1"]);
    }
    expect(readMetadataRaw(dataDir, "app-1")).toEqual(claim);
    expect(readdirSync(dataDir)).toEqual(["app-1"]);
  });

  it("two reservations of one ID: the first wins, the second returns false, no temp file stays", () => {
    expect(reserveSessionId(dataDir, "app-1", claim)).toBe(true);
    expect(reserveSessionId(dataDir, "app-1", { launchPid: "77", launchPidStart: "stat:1" })).toBe(
      false,
    );
    expect(reserveSessionId(dataDir, "app-1")).toBe(false);
    expect(readMetadataRaw(dataDir, "app-1")).toEqual(claim);

    // A claim does not win over an empty reservation either.
    expect(reserveSessionId(dataDir, "app-2")).toBe(true);
    expect(reserveSessionId(dataDir, "app-2", claim)).toBe(false);
    expect(readFileSync(join(dataDir, "app-2"), "utf-8")).toBe("");

    expect(readdirSync(dataDir).sort()).toEqual(["app-1", "app-2"]);
  });

  it("without a claim, makes the same empty record as before", () => {
    expect(reserveSessionId(dataDir, "app-1")).toBe(true);
    expect(reserveSessionId(dataDir, "app-2", {})).toBe(true);
    expect(readFileSync(join(dataDir, "app-1"), "utf-8")).toBe("");
    expect(readFileSync(join(dataDir, "app-2"), "utf-8")).toBe("");
    expect(readMetadataRaw(dataDir, "app-1")).toEqual({});
    expect(reserveSessionId(dataDir, "app-1")).toBe(false);
    expect(readdirSync(dataDir).sort()).toEqual(["app-1", "app-2"]);
  });

  it.each([
    ["the link (a file system without hard links)", "linkSync", "EPERM"],
    ["the temp file write (a full disk)", "writeFileSync", "ENOSPC"],
    ["the temp file create", "openSync", "EACCES"],
  ])("a failure of %s throws and leaves no temp file and no record", (_what, call, code) => {
    fsProbe.fail = (name) => (name === call ? errnoError(code) : undefined);
    let thrown: unknown;
    try {
      reserveSessionId(dataDir, "app-1", claim);
    } catch (err) {
      thrown = err;
    } finally {
      fsProbe.fail = null;
    }

    expect((thrown as Error).message).toBe(`Could not reserve session app-1 in ${dataDir}`);
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe(code);
    expect(readdirSync(dataDir)).toEqual([]);
    expect(reserveSessionId(dataDir, "app-1", claim)).toBe(true);
    expect(readdirSync(dataDir)).toEqual(["app-1"]);
  });
});

describe("metadata value injection hardening", () => {
  // The metadata file is line-delimited key=value. `summary` and `pinnedSummary`
  // carry free text produced by the agent, so an unescaped newline lets that text
  // forge additional metadata keys on the next read.
  it("does not let a newline in summary forge another key", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/wt",
      branch: "feat/x",
      status: "working",
      summary: "did the thing\nstatus=merged",
    });

    const meta = readMetadata(dataDir, "app-1");
    expect(meta?.status).toBe("working");
    expect(meta?.summary).toBe("did the thing status=merged");
  });

  it("neutralizes carriage returns as well as newlines", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/wt",
      branch: "feat/x",
      status: "working",
      pinnedSummary: "line one\r\nworktree=/etc/passwd",
    });

    const meta = readMetadata(dataDir, "app-1");
    expect(meta?.worktree).toBe("/tmp/wt");
    expect(meta?.pinnedSummary).toBe("line one  worktree=/etc/passwd");
  });

  it("keeps the file to exactly one line per written key", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/wt",
      branch: "feat/x",
      status: "working",
      summary: "a\nb\nc\nd",
    });

    const raw = readFileSync(join(dataDir, "app-1"), "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(4);
  });

  it("still preserves '=' inside values", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/wt",
      branch: "feat/x",
      status: "working",
      summary: "ran FOO=bar baz",
    });

    expect(readMetadata(dataDir, "app-1")?.summary).toBe("ran FOO=bar baz");
  });

  it("applies the same hardening on updateMetadata", () => {
    writeMetadata(dataDir, "app-1", {
      worktree: "/tmp/wt",
      branch: "feat/x",
      status: "working",
    });
    updateMetadata(dataDir, "app-1", { summary: "oops\nstatus=killed" });

    const meta = readMetadata(dataDir, "app-1");
    expect(meta?.status).toBe("working");
  });
});
