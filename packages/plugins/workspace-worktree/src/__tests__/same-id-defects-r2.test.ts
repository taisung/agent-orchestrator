/**
 * Defect tests of the same-ID design revision r2 (ao-52, design file
 * development/reviews/same_id_design_r2_opus.md), review r1 B-7 item 2 (round
 * R4): the worktree plugin's `exists` answers false for every failure, so a
 * caller cannot tell "the path is missing" from "git could not run". A
 * missing `git` binary (spawn ENOENT) is not a missing path; a timeout or an
 * unexpected answer cannot prove absence either.
 *
 * Each `defect` test fails on c516cead for the measured reason; the `it`
 * tests are controls that pass on c516cead and must stay green, so that an
 * ordinary missing path or a directory that is not a worktree still reads
 * as "no workspace".
 *
 * Marking as in design r1 section 8.1: `defect(...)` is `it.fails`, and
 * `SAME_ID_DEFECTS=red` makes it a plain test. The file system is real (a
 * temporary directory); only the `git` child process is a stand-in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

/** The `git` stand-in: each call goes to `handler`; every other command fails. */
const git = vi.hoisted(() => ({
  handler: null as null | ((args: string[]) => Promise<string>),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const execFile = ((...args: Parameters<typeof actual.execFile>) =>
    actual.execFile(...args)) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[]) => {
      if (cmd !== "git" || !git.handler) throw new Error(`unexpected command: ${cmd}`);
      return { stdout: `${await git.handler(args)}\n`, stderr: "" };
    },
  });
  return { ...actual, execFile, default: { ...actual, execFile } };
});

import { create } from "../index.js";

const RED = process.env["SAME_ID_DEFECTS"] === "red";
function defect(name: string, fn: () => Promise<void>): void {
  (RED ? it : it.fails)(name, fn);
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ao-same-id-r2-worktree-"));
  git.handler = null;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function existingDirectory(): string {
  const path = join(root, "ws-app-1");
  mkdirSync(path, { recursive: true });
  return path;
}

describe("[same-id R4] B-7 item 2: workspace exists tells a missing path from a check that could not run", () => {
  defect(
    "exists rejects when the git binary cannot start (spawn ENOENT) for an existing directory",
    async () => {
      const path = existingDirectory();
      git.handler = async () => {
        throw Object.assign(new Error("spawn git ENOENT"), {
          code: "ENOENT",
          errno: -2,
          syscall: "spawn git",
        });
      };
      // Measured in code (workspace-worktree/src/index.ts:264-274): every
      // failure answers false; recovery then reads "no workspace".
      await expect(create().exists!(path)).rejects.toThrow();
    },
  );

  defect("exists rejects when git times out for an existing directory", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw Object.assign(new Error("Command failed: git rev-parse --is-inside-work-tree"), {
        killed: true,
        signal: "SIGTERM",
        code: null,
      });
    };
    await expect(create().exists!(path)).rejects.toThrow();
  });

  it("control: a path that does not exist answers false", async () => {
    git.handler = async () => {
      throw new Error("git must not run for a missing path");
    };
    await expect(create().exists!(join(root, "missing"))).resolves.toBe(false);
  });

  it("control: an existing directory that is not a git work tree answers false", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw Object.assign(new Error("Command failed: git rev-parse"), {
        code: 128,
        stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      });
    };
    await expect(create().exists!(path)).resolves.toBe(false);
  });

  it("control: a git work tree answers true", async () => {
    const path = existingDirectory();
    git.handler = async () => "true";
    await expect(create().exists!(path)).resolves.toBe(true);
  });
});
