/**
 * Same-ID R4 (design r2 section 3 item 7, with the m-1 change of design r3
 * section 4): `exists` answers true only for a `git rev-parse
 * --is-inside-work-tree` that exits 0 with `true`, and false only for a path
 * that `lstat` finds missing (`ENOENT`) or for git's exit 128 "not a git
 * repository". Every other answer rejects: a path that cannot be checked, an
 * I/O error, another git failure, and a success with other output. The spawn
 * ENOENT, timeout and control cases are in same-id-defects-r2.test.ts.
 *
 * The file system is real (a temporary directory); only the `git` child
 * process is a stand-in. Each test fails on 75f1c98b, where every failure
 * answered false and any success answered true.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

/** The `git` stand-in: each call goes to `handler`; every other command fails. */
const git = vi.hoisted(() => ({
  handler: null as null | ((args: string[]) => Promise<string>),
  calls: 0,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const execFile = ((...args: Parameters<typeof actual.execFile>) =>
    actual.execFile(...args)) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "git" || !git.handler) throw new Error(`unexpected command: ${cmd}`);
      git.calls += 1;
      return { stdout: `${await git.handler(args)}\n`, stderr: "" };
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import { create } from "../index.js";

/** A test that needs a mode-000 directory; root reads it anyway. */
function itUnlessRoot(name: string, fn: () => Promise<void>): void {
  if (process.getuid?.() === 0) it.skip(name, fn);
  else it(name, fn);
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-same-id-r4-worktree-"));
  git.handler = null;
  git.calls = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function existingDirectory(): string {
  const path = join(root, "ws-app-1");
  mkdirSync(path, { recursive: true });
  return path;
}

/** A git failure with an exit code and a stderr text, as `execFile` rejects. */
function gitFailure(code: number, stderr: string): Error {
  return Object.assign(new Error("Command failed: git rev-parse --is-inside-work-tree"), {
    code,
    stderr,
  });
}

describe("same-id R4, B-7 item 7: workspace exists rejects for an answer that proves nothing", () => {
  it("rejects a git success whose output is not 'true' (malformed success)", async () => {
    const path = existingDirectory();
    git.handler = async () => "false";
    await expect(create().exists!(path)).rejects.toThrow(/not "true"/);
  });

  it("rejects a git success with empty output", async () => {
    const path = existingDirectory();
    git.handler = async () => "";
    await expect(create().exists!(path)).rejects.toThrow(/not "true"/);
  });

  it("rejects git's exit 128 for an I/O error", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(
        128,
        "fatal: Unable to read current working directory: Input/output error\n",
      );
    };
    await expect(create().exists!(path)).rejects.toThrow();
  });

  it("rejects git's exit 128 for a repository that git refuses (dubious ownership)", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(128, `fatal: detected dubious ownership in repository at '${path}'\n`);
    };
    await expect(create().exists!(path)).rejects.toThrow();
  });

  it("rejects git's 'not a git repository' text with another exit code", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(1, "fatal: not a git repository (or any of the parent directories): .git\n");
    };
    await expect(create().exists!(path)).rejects.toThrow();
  });

  itUnlessRoot(
    "rejects a path under a parent that cannot be read (EACCES), and runs no git",
    async () => {
      const parent = join(root, "locked");
      mkdirSync(join(parent, "ws-app-1"), { recursive: true });
      chmodSync(parent, 0o000);
      git.handler = async () => "true";
      try {
        const err = await create().exists!(join(parent, "ws-app-1")).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect(((err as Error).cause as NodeJS.ErrnoException).code).toBe("EACCES");
        expect(git.calls).toBe(0);
      } finally {
        chmodSync(parent, 0o755);
      }
    },
  );

  it("rejects a path under a symlink loop (ELOOP), and runs no git", async () => {
    const loop = join(root, "loop");
    symlinkSync(loop, loop);
    git.handler = async () => "true";
    const err = await create().exists!(join(loop, "ws-app-1")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(((err as Error).cause as NodeJS.ErrnoException).code).toBe("ELOOP");
    expect(git.calls).toBe(0);
  });

  it("control: git's exit 128 'not a git repository' answers false", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(
        128,
        "fatal: not a git repository (or any of the parent directories): .git\n",
      );
    };
    await expect(create().exists!(path)).resolves.toBe(false);
  });

  it("control: a missing path answers false and runs no git", async () => {
    git.handler = async () => "true";
    await expect(create().exists!(join(root, "missing"))).resolves.toBe(false);
    expect(git.calls).toBe(0);
  });
});
