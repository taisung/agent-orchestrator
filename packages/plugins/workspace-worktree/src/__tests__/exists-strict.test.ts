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
 *
 * Round 2 (review r1, M-1): false only when git's whole stderr is its
 * discovery diagnostic, not when the text appears in it (a quoted path can
 * hold it). These tests fail on fa2f7ac8; the last group runs the real git
 * binary (no stand-in) on a repository that git refuses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ChildProcess from "node:child_process";

/**
 * The `git` stand-in: each call goes to `handler`; every other command fails.
 * With `real`, `git` runs the real binary.
 */
const git = vi.hoisted(() => ({
  handler: null as null | ((args: string[]) => Promise<string>),
  calls: 0,
  options: undefined as undefined | { env?: Record<string, string | undefined> },
  real: false,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const realExecFileAsync = promisify(actual.execFile);
  const execFile = ((...args: Parameters<typeof actual.execFile>) =>
    actual.execFile(...args)) as typeof actual.execFile;
  Object.defineProperty(execFile, promisify.custom, {
    value: async (cmd: string, args: string[], options: ChildProcess.ExecFileOptions) => {
      if (cmd === "git" && git.real) return realExecFileAsync(cmd, args, options);
      if (cmd !== "git" || !git.handler) throw new Error(`unexpected command: ${cmd}`);
      git.calls += 1;
      git.options = options;
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
  git.options = undefined;
  git.real = false;
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

describe("same-id R4 round 2 (review r1, M-1): only git's whole discovery diagnostic is absence", () => {
  it("rejects git's exit 128 for dubious ownership of a path that holds 'not a git repository'", async () => {
    const path = join(root, "not a git repository");
    mkdirSync(path);
    git.handler = async () => {
      throw gitFailure(
        128,
        `fatal: detected dubious ownership in repository at '${path}'\n` +
          "To add an exception for this directory, call:\n\n" +
          `\tgit config --global --add safe.directory '${path}'\n`,
      );
    };
    await expect(create().exists!(path)).rejects.toThrow(/could not run/);
  });

  it("rejects git's exit 128 when the diagnostic comes with another line", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(
        128,
        "warning: unable to access '/home/u/.config/git/attributes': Permission denied\n" +
          "fatal: not a git repository (or any of the parent directories): .git\n",
      );
    };
    await expect(create().exists!(path)).rejects.toThrow(/could not run/);
  });

  it("runs git in the C locale, so that the diagnostic is git's own text", async () => {
    const path = existingDirectory();
    git.handler = async () => "true";
    await expect(create().exists!(path)).resolves.toBe(true);
    expect(git.options?.env?.["LC_ALL"]).toBe("C");
  });

  it("control: git's exit 128 'up to mount point' diagnostic answers false", async () => {
    const path = existingDirectory();
    git.handler = async () => {
      throw gitFailure(
        128,
        "fatal: not a git repository (or any parent up to mount point /dev)\n" +
          "Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n",
      );
    };
    await expect(create().exists!(path)).resolves.toBe(false);
  });
});

describe("same-id R4 round 2 (review r1, M-1): the real git binary", () => {
  const VARIABLES = [
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CEILING_DIRECTORIES",
    "GIT_TEST_ASSUME_DIFFERENT_OWNER",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]));
    // No user or system configuration (a safe.directory entry), and no
    // repository above the temporary directory.
    process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    process.env["GIT_CEILING_DIRECTORIES"] = root;
    delete process.env["GIT_TEST_ASSUME_DIFFERENT_OWNER"];
    git.real = true;
  });

  afterEach(() => {
    for (const name of VARIABLES) {
      if (saved[name] === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = saved[name];
    }
  });

  it("rejects a repository at a path named 'not a git repository' that git refuses (dubious ownership)", async () => {
    const path = join(root, "not a git repository");
    execFileSync("git", ["init", "--quiet", path], { stdio: "ignore" });
    await expect(create().exists!(path)).resolves.toBe(true);

    // git's test switch: the repository belongs to another user.
    process.env["GIT_TEST_ASSUME_DIFFERENT_OWNER"] = "1";
    const err = await create().exists!(path).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(((err as Error).cause as { stderr?: unknown }).stderr)).toContain(
      "detected dubious ownership",
    );
  });

  it("control: a directory outside any repository answers false", async () => {
    const path = join(root, "plain");
    mkdirSync(path);
    await expect(create().exists!(path)).resolves.toBe(false);
  });
});
