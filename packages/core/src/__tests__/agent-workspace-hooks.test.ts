import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  AO_METADATA_HELPER,
  GH_WRAPPER,
  GIT_WRAPPER,
  WRAPPER_VERSION,
  buildAgentPath,
  removeAoBinFromPath,
  setupPathWrapperWorkspace,
} from "../agent-workspace-hooks.js";

const { mockWriteFile, mockMkdir, mockReadFile, mockRename } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  mockReadFile: vi.fn(),
  mockRename: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  rename: mockRename,
}));

vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

describe("buildAgentPath", () => {
  it("prepends ao bin dir to PATH", () => {
    const result = buildAgentPath("/usr/bin:/bin");
    expect(result).toMatch(/^\/home\/testuser\/.ao\/bin:/);
    expect(result).toContain("/usr/bin");
    expect(result).toContain("/bin");
  });

  it("deduplicates entries", () => {
    const result = buildAgentPath("/usr/local/bin:/usr/bin:/usr/local/bin");
    const entries = result.split(":");
    const unique = new Set(entries);
    expect(entries.length).toBe(unique.size);
  });

  it("uses default PATH when basePath is undefined", () => {
    const result = buildAgentPath(undefined);
    expect(result).toMatch(/^\/home\/testuser\/.ao\/bin:/);
    expect(result).toContain("/usr/bin");
  });

  it("keeps the inherited order after the ao bin dir and adds no /usr/local/bin", () => {
    // /usr/local/bin can hold old agent binaries (claude, codex, gemini) that
    // must not shadow the user's copies; GH_PATH already selects gh.
    expect(buildAgentPath("/home/u/.local/bin:/usr/bin:/usr/local/bin:/bin")).toBe(
      "/home/testuser/.ao/bin:/home/u/.local/bin:/usr/bin:/usr/local/bin:/bin",
    );
    expect(buildAgentPath(undefined)).toBe("/home/testuser/.ao/bin:/usr/bin:/bin");
  });
});

describe("AO_METADATA_HELPER", () => {
  it("updates metadata under the configured state root and rejects paths outside it", () => {
    const stateRoot = mkdtempSync("/var/tmp/ao-x-");
    const outsideRoot = mkdtempSync("/var/tmp/ao-outside-");
    const sessionsDir = join(stateRoot, "instance", "sessions");
    const outsideSessionsDir = join(outsideRoot, "instance", "sessions");
    const helperPath = join(stateRoot, "ao-metadata-helper.sh");
    const sessionId = "app-1";
    const metadataPath = join(sessionsDir, sessionId);
    const outsideMetadataPath = join(outsideSessionsDir, sessionId);

    try {
      mkdirSync(sessionsDir, { recursive: true });
      mkdirSync(outsideSessionsDir, { recursive: true });
      writeFileSync(helperPath, AO_METADATA_HELPER);
      writeFileSync(metadataPath, "status=working\n");
      writeFileSync(outsideMetadataPath, "status=working\n");

      const runHelper = (dataDir: string): void => {
        execFileSync(
          "bash",
          [
            "-c",
            'source "$1"; update_ao_metadata "$2" "$3"',
            "bash",
            helperPath,
            "status",
            "pr_open",
          ],
          {
            env: {
              ...process.env,
              AO_STATE_ROOT: stateRoot,
              AO_DATA_DIR: dataDir,
              AO_SESSION: sessionId,
            },
          },
        );
      };

      runHelper(sessionsDir);
      expect(readFileSync(metadataPath, "utf8")).toBe("status=pr_open\n");

      runHelper(outsideSessionsDir);
      expect(readFileSync(outsideMetadataPath, "utf8")).toBe("status=working\n");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  describe("key allowlist (m-10)", () => {
    function runHelperOnce(
      helperPath: string,
      env: NodeJS.ProcessEnv,
      key: string,
      value: string,
    ): { code: number; stderr: string } {
      try {
        const stderr = execFileSync(
          "bash",
          ["-c", 'source "$1"; update_ao_metadata "$2" "$3"', "bash", helperPath, key, value],
          { env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
        );
        void stderr;
        return { code: 0, stderr: "" };
      } catch (err: unknown) {
        const e = err as { status?: number; stderr?: string | Buffer };
        const stderr = typeof e.stderr === "string" ? e.stderr : String(e.stderr ?? "");
        return { code: e.status ?? 1, stderr };
      }
    }

    function makeHelperEnv(): {
      stateRoot: string;
      sessionsDir: string;
      helperPath: string;
      record: string;
      baseEnv: NodeJS.ProcessEnv;
    } {
      const stateRoot = mkdtempSync("/tmp/ao-helper-allow-");
      const sessionsDir = join(stateRoot, "sessions");
      const helperPath = join(stateRoot, "ao-metadata-helper.sh");
      const record = join(sessionsDir, "app-1");
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(helperPath, AO_METADATA_HELPER);
      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        AO_STATE_ROOT: stateRoot,
        AO_DATA_DIR: sessionsDir,
        AO_SESSION: "app-1",
      };
      return { stateRoot, sessionsDir, helperPath, record, baseEnv };
    }

    it.each([
      ["pr", "https://github.com/o/r/pull/42"],
      ["status", "pr_open"],
      ["branch", "feat/worker-x"],
    ])("writes allowed key %s=%s", (key, value) => {
      const fx = makeHelperEnv();
      try {
        writeFileSync(fx.record, "status=working\n");
        const result = runHelperOnce(fx.helperPath, fx.baseEnv, key, value);
        expect(result.code).toBe(0);
        expect(readFileSync(fx.record, "utf8")).toContain(`${key}=${value}`);
      } finally {
        rmSync(fx.stateRoot, { recursive: true, force: true });
      }
    });

    it.each([
      ["permissions", "permissionless"],
      ["model", "model-X"],
      ["role", "orchestrator"],
      ["agent", "claude-code"],
      ["status", "merged"],
      ["status", "done"],
      ["unknownkey", "x"],
    ])("refuses %s=%s: writes nothing, names the key on stderr, non-zero exit", (key, value) => {
      const fx = makeHelperEnv();
      try {
        writeFileSync(fx.record, "status=working\nbranch=main\n");
        const before = readFileSync(fx.record, "utf8");
        const result = runHelperOnce(fx.helperPath, fx.baseEnv, key, value);
        expect(result.code).not.toBe(0);
        expect(result.stderr.trim().split("\n")).toHaveLength(1);
        expect(result.stderr).toContain(key);
        expect(readFileSync(fx.record, "utf8")).toBe(before);
      } finally {
        rmSync(fx.stateRoot, { recursive: true, force: true });
      }
    });

    it("refuses the review reproducer: permissions and role writes change nothing", () => {
      const fx = makeHelperEnv();
      try {
        writeFileSync(fx.record, "permissions=default\nrole=worker\nstatus=working\n");
        const before = readFileSync(fx.record, "utf8");
        expect(runHelperOnce(fx.helperPath, fx.baseEnv, "permissions", "permissionless").code).not.toBe(
          0,
        );
        expect(runHelperOnce(fx.helperPath, fx.baseEnv, "role", "orchestrator").code).not.toBe(0);
        expect(readFileSync(fx.record, "utf8")).toBe(before);
      } finally {
        rmSync(fx.stateRoot, { recursive: true, force: true });
      }
    });
  });
});

describe("setupPathWrapperWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("creates ao bin directory", async () => {
    await setupPathWrapperWorkspace("/workspace");
    expect(mockMkdir).toHaveBeenCalledWith("/home/testuser/.ao/bin", { recursive: true });
  });

  it("writes wrapper scripts when version marker is missing", async () => {
    await setupPathWrapperWorkspace("/workspace");
    // atomicWriteFile writes to .tmp then renames
    expect(mockRename).toHaveBeenCalled();
    // .ao/AGENTS.md is written directly
    const agentsMdWrites = mockWriteFile.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes(".ao/AGENTS.md"),
    );
    expect(agentsMdWrites).toHaveLength(1);
  });

  it("skips wrapper rewrite when version matches and files are current", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve(WRAPPER_VERSION);
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve(GH_WRAPPER);
      if (p.endsWith("/git")) return Promise.resolve(GIT_WRAPPER);
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    // A current marker plus current files suppresses all helper/wrapper rewrites.
    const renamedPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(renamedPaths.filter((p: string) => p.includes("/gh."))).toHaveLength(0);
    expect(renamedPaths.filter((p: string) => p.includes("/git."))).toHaveLength(0);
  });

  it("repairs a missing wrapper file when the version marker matches", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve(WRAPPER_VERSION);
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve(GH_WRAPPER);
      if (p.endsWith("/git")) return Promise.reject(new Error("ENOENT"));
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    // Missing git wrapper must be rewritten even though the marker matches.
    expect(mockRename).toHaveBeenCalled();
    const renamedTmpPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[0]));
    const renamedDestPaths = mockRename.mock.calls.map((c: unknown[]) => String(c[1]));
    const allRenamed = [...renamedTmpPaths, ...renamedDestPaths];
    expect(allRenamed.some((p: string) => p.includes("/git"))).toBe(true);
  });

  it("repairs a stale wrapper file when the version marker matches", async () => {
    mockReadFile.mockImplementation((path: string) => {
      const p = String(path);
      if (p.endsWith(".ao-version")) return Promise.resolve(WRAPPER_VERSION);
      if (p.endsWith("ao-metadata-helper.sh")) return Promise.resolve(AO_METADATA_HELPER);
      if (p.endsWith("/gh")) return Promise.resolve("# stale gh\n");
      if (p.endsWith("/git")) return Promise.resolve(GIT_WRAPPER);
      return Promise.reject(new Error("ENOENT"));
    });

    await setupPathWrapperWorkspace("/workspace");

    expect(mockRename).toHaveBeenCalled();
  });

  it("writes .ao/AGENTS.md with session context", async () => {
    await setupPathWrapperWorkspace("/workspace");

    const agentsMdWrites = mockWriteFile.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes(".ao/AGENTS.md"),
    );
    expect(agentsMdWrites).toHaveLength(1);
    expect(String(agentsMdWrites[0][1])).toContain("Agent Orchestrator");
  });

  it("AGENTS.md has no generic update call and says wrappers own the record", async () => {
    const { AO_AGENTS_MD_SECTION } = await import("../agent-workspace-hooks.js");
    expect(AO_AGENTS_MD_SECTION).not.toContain("update_ao_metadata <key>");
    expect(AO_AGENTS_MD_SECTION).not.toContain("<value>");
    expect(AO_AGENTS_MD_SECTION).toContain("wrappers update the session metadata");
    expect(AO_AGENTS_MD_SECTION).toContain("Do not edit the session record");
  });

  it("bumps WRAPPER_VERSION so installs rewrite the helper and wrappers", async () => {
    expect(WRAPPER_VERSION).toBe("0.2.5");
    expect(AO_METADATA_HELPER).toContain("allowed: pr, status, branch");
  });
});

// =============================================================================
// The wrappers themselves: real bash, real git, a real metadata file.
// node:fs/promises is mocked above, so these tests use the sync node:fs API.
// =============================================================================

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run a wrapper in its own process group. A wrapper that finds itself again
 * recurses without end, so on timeout the whole group is killed: a broken
 * guard fails the test instead of using up the user's process limit. The
 * timeout stays below the 5 s test timeout, so the kill always comes first.
 */
function runScript(
  file: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env, detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        // group already gone
      }
    }, opts.timeoutMs ?? 4_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

interface WrapperFixture {
  root: string;
  binDir: string;
  repo: string;
  sessionsDir: string;
  record: string;
  env: NodeJS.ProcessEnv;
  realGit: (cwd: string, ...args: string[]) => string;
  readKey: (key: string) => string | undefined;
}

function makeWrapperFixture(): WrapperFixture {
  const root = mkdtempSync("/tmp/ao-wrapper-run-");
  const home = join(root, "home");
  const binDir = join(home, ".ao", "bin");
  const repo = join(root, "repo");
  const sessionsDir = join(root, "state", "sessions");
  const record = join(sessionsDir, "app-1");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(repo, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(binDir, "ao-metadata-helper.sh"), AO_METADATA_HELPER, { mode: 0o755 });
  writeFileSync(join(binDir, "gh"), GH_WRAPPER, { mode: 0o755 });
  writeFileSync(join(binDir, "git"), GIT_WRAPPER, { mode: 0o755 });

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  // The real git, never through the wrapper: fixture setup only.
  const realGit = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env: baseEnv, encoding: "utf8" });

  realGit(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.txt"), "one\n");
  realGit(repo, "add", ".");
  realGit(repo, "commit", "-q", "-m", "init");
  realGit(repo, "branch", "feat/worker-x");
  realGit(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(record, `project=app\nworktree=${repo}\nbranch=main\nstatus=working\n`);

  return {
    root,
    binDir,
    repo,
    sessionsDir,
    record,
    env: {
      ...baseEnv,
      PATH: `${binDir}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      AO_STATE_ROOT: join(root, "state"),
      AO_DATA_DIR: sessionsDir,
      AO_SESSION: "app-1",
    },
    realGit,
    readKey: (key: string) =>
      readFileSync(record, "utf8")
        .split("\n")
        .find((line) => line.startsWith(`${key}=`))
        ?.slice(key.length + 1),
  };
}

describe("GIT_WRAPPER branch tracking", () => {
  let fx: WrapperFixture;
  const git = (args: string[], cwd?: string): Promise<ScriptResult> =>
    runScript(join(fx.binDir, "git"), args, { cwd: cwd ?? fx.repo, env: fx.env });

  beforeEach(() => {
    fx = makeWrapperFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it.each([
    [["checkout", "-b", "feat/a"], "feat/a"],
    [["switch", "-c", "feat/b"], "feat/b"],
    [["checkout", "-q", "-b", "feat/q"], "feat/q"],
    [["switch", "-q", "-c", "feat/sq"], "feat/sq"],
    [["checkout", "-B", "feat/big-b"], "feat/big-b"],
    [["switch", "feat/worker-x"], "feat/worker-x"],
  ])("git %j stores the branch that HEAD names", async (args, expected) => {
    const result = await git(args);
    expect(result.code).toBe(0);
    expect(fx.realGit(fx.repo, "symbolic-ref", "--short", "HEAD").trim()).toBe(expected);
    expect(fx.readKey("branch")).toBe(expected);
  });

  it("stores the branch of `git -C <own worktree> checkout -b` from another directory", async () => {
    const result = await git(["-C", fx.repo, "checkout", "-b", "feat/c"], fx.root);
    expect(result.code).toBe(0);
    expect(fx.readKey("branch")).toBe("feat/c");
  });

  it.each([[["checkout", "--", "src/a.txt"]], [["checkout", "origin/main", "--", "src/a.txt"]]])(
    "git %j keeps the branch (HEAD still names main)",
    async (args) => {
      writeFileSync(join(fx.repo, "src", "a.txt"), "changed\n");
      const result = await git(args);
      expect(result.code).toBe(0);
      expect(fx.readKey("branch")).toBe("main");
    },
  );

  it.each([[["switch", "--detach", "origin/main"]], [["checkout", "origin/main"]]])(
    "git %j writes nothing when HEAD is detached",
    async (args) => {
      await git(["switch", "feat/worker-x"]);
      const result = await git(args);
      expect(result.code).toBe(0);
      expect(fx.realGit(fx.repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("HEAD");
      expect(fx.readKey("branch")).toBe("feat/worker-x");
    },
  );

  it("follows a switch to a feature branch and back to main", async () => {
    await git(["switch", "feat/worker-x"]);
    expect(fx.readKey("branch")).toBe("feat/worker-x");
    await git(["checkout", "main"]);
    expect(fx.readKey("branch")).toBe("main");
  });

  it("writes nothing for a checkout in a work tree that is not the session's own", async () => {
    // As `ao spawn` from the orchestrator pane does: check out the worker
    // branch in the new worktree, with the orchestrator's AO_SESSION.
    const other = join(fx.root, "worker-wt");
    fx.realGit(fx.repo, "worktree", "add", "-q", "--detach", other);
    const result = await git(["checkout", "feat/worker-x"], other);
    expect(result.code).toBe(0);
    expect(fx.realGit(other, "symbolic-ref", "--short", "HEAD").trim()).toBe("feat/worker-x");
    expect(fx.readKey("branch")).toBe("main");
  });

  it("stores the full branch name when a tag has the same name", async () => {
    fx.realGit(fx.repo, "tag", "feat/same");
    const result = await git(["checkout", "-b", "feat/same"]);
    expect(result.code).toBe(0);
    expect(fx.readKey("branch")).toBe("feat/same");
  });

  it("writes nothing and keeps git's exit code when the checkout fails", async () => {
    const result = await git(["checkout", "no-such-branch"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("no-such-branch");
    expect(fx.readKey("branch")).toBe("main");
  });

  it("passes other commands through with git's own output", async () => {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(result).toMatchObject({ code: 0, stdout: "main\n", stderr: "" });
  });

  it("runs git and writes nothing without a session record", async () => {
    const env = { ...fx.env, AO_SESSION: "no-such-session" };
    const result = await runScript(join(fx.binDir, "git"), ["checkout", "-b", "feat/n"], {
      cwd: fx.repo,
      env,
    });
    expect(result.code).toBe(0);
    expect(fx.readKey("branch")).toBe("main");
  });

  it("falls back to a no-op update_ao_metadata when the helper is missing", async () => {
    rmSync(join(fx.binDir, "ao-metadata-helper.sh"));
    const result = await git(["checkout", "-b", "feat/no-helper"]);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("command not found");
    expect(result.stderr).toContain("Switched to a new branch");
    expect(fx.readKey("branch")).toBe("main");
  });
});

describe("wrapper recursion guard", () => {
  let fx: WrapperFixture;

  beforeEach(() => {
    fx = makeWrapperFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  const spellings: Array<[string, (binDir: string) => string]> = [
    ["a trailing slash", (binDir) => `${binDir}/`],
    ["a doubled slash", (binDir) => binDir.replace("/.ao/bin", "/.ao//bin")],
    [
      "a symlinked directory",
      (binDir) => {
        const link = join(binDir, "..", "..", "bin-link");
        symlinkSync(binDir, link);
        return link;
      },
    ],
  ];

  it.each(spellings)(
    "git finds the real git when PATH names its directory with %s",
    async (_, spell) => {
      const entry = spell(fx.binDir);
      const result = await runScript(join(entry, "git"), ["--version"], {
        cwd: fx.repo,
        env: { ...fx.env, PATH: `${entry}:${fx.env["PATH"]}` },
        timeoutMs: 3_000,
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/^git version /);
    },
  );

  it.each(spellings)(
    "gh finds the real gh when PATH names its directory with %s",
    async (_, spell) => {
      const entry = spell(fx.binDir);
      const fakeDir = join(fx.root, "fake-gh");
      mkdirSync(fakeDir);
      writeFileSync(join(fakeDir, "gh"), '#!/usr/bin/env bash\necho "fake-gh out: $*"\n', {
        mode: 0o755,
      });
      const otherBin = join(fx.root, "other-home", ".ao", "bin");
      mkdirSync(otherBin, { recursive: true });
      copyFileSync(join(fx.binDir, "gh"), join(otherBin, "gh"));
      chmodSync(join(otherBin, "gh"), 0o755);
      const { GH_PATH: _ghPath, ...env } = fx.env;
      const result = await runScript(join(entry, "gh"), ["api", "x"], {
        cwd: fx.repo,
        env: { ...env, PATH: `${entry}:${otherBin}:${fakeDir}:${fx.env["PATH"]}` },
        timeoutMs: 3_000,
      });
      expect(result.timedOut).toBe(false);
      expect(result).toMatchObject({ code: 0, stdout: "fake-gh out: api x\n" });
    },
  );

  it("git skips another ao wrapper copy on PATH (another HOME or version)", async () => {
    const otherBin = join(fx.root, "other-home", ".ao", "bin");
    mkdirSync(otherBin, { recursive: true });
    copyFileSync(join(fx.binDir, "git"), join(otherBin, "git"));
    chmodSync(join(otherBin, "git"), 0o755);
    const result = await runScript(join(fx.binDir, "git"), ["--version"], {
      cwd: fx.repo,
      env: { ...fx.env, PATH: `${fx.binDir}:${otherBin}:${fx.env["PATH"]}` },
      timeoutMs: 3_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
  });
});

describe("removeAoBinFromPath", () => {
  let fx: WrapperFixture;
  const rest = "/usr/bin:/bin";

  beforeEach(() => {
    fx = makeWrapperFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it("returns the same string when the PATH holds only absolute entries and no wrappers", () => {
    // Trailing slashes and duplicates stay as they are.
    const clean = `/usr/local/bin/:${fx.root}/ao/bin:${fx.root}/.ao/bin2:/usr/bin:/usr/bin`;
    expect(removeAoBinFromPath(clean)).toBe(clean);
  });

  it("removes every relative entry: the shell resolves it against the current directory", () => {
    // Empty, ".", a name, a "../" path and ~user (not expanded here) all
    // depend on the directory at lookup time, so after a cd each one can
    // reach a wrapper directory.
    expect(removeAoBinFromPath(":/a::.:relative-link:../x:~user/bin:/b:")).toBe("/a:/b");
  });

  it("keeps a directory with a git that is not an ao wrapper", () => {
    const dir = join(fx.root, "tools");
    mkdirSync(dir);
    writeFileSync(join(dir, "git"), "#!/usr/bin/env bash\n# some other git wrapper\n", {
      mode: 0o755,
    });
    expect(removeAoBinFromPath(`${dir}:${rest}`)).toBe(`${dir}:${rest}`);
  });

  const spellings: Array<[string, (fx: WrapperFixture) => string]> = [
    ["its own name", (f) => f.binDir],
    ["a trailing slash", (f) => `${f.binDir}/`],
    ["a doubled slash", (f) => f.binDir.replace("/.ao/bin", "/.ao//bin")],
    ["a dot segment", (f) => f.binDir.replace("/.ao/bin", "/.ao/./bin")],
    [
      "a symlink to it",
      (f) => {
        symlinkSync(f.binDir, join(f.root, "aolink"));
        return join(f.root, "aolink");
      },
    ],
    [
      "a symlink to it before the install creates it",
      (f) => {
        symlinkSync(join(f.root, "later-home", ".ao", "bin"), join(f.root, "dangling"));
        return join(f.root, "dangling");
      },
    ],
    [
      "the wrapper directory of another HOME",
      (f) => {
        const other = join(f.root, "other-home", ".ao", "bin");
        mkdirSync(other, { recursive: true });
        copyFileSync(join(f.binDir, "git"), join(other, "git"));
        return other;
      },
    ],
    [
      "the wrapper directory of a HOME with no install yet",
      (f) => join(f.root, "new-home", ".ao", "bin"),
    ],
    [
      "a .ao/bin symlink to an empty directory (an install writes through it)",
      (f) => {
        mkdirSync(join(f.root, "elsewhere"));
        mkdirSync(join(f.root, "link-home", ".ao"), { recursive: true });
        symlinkSync(join(f.root, "elsewhere"), join(f.root, "link-home", ".ao", "bin"));
        return join(f.root, "link-home", ".ao", "bin");
      },
    ],
    [
      "a gh wrapper copy in another directory",
      (f) => {
        const copy = join(f.root, "copy");
        mkdirSync(copy);
        copyFileSync(join(f.binDir, "gh"), join(copy, "gh"));
        return copy;
      },
    ],
    ["a leading ~ (homedir is /home/testuser)", () => "~/.ao/bin"],
    [
      "a symlink followed by .. (link/../bin reaches .ao/bin)",
      (f) => {
        mkdirSync(join(f.root, "home", ".ao", "subdir"));
        mkdirSync(join(f.root, "lexical"));
        symlinkSync(join(f.root, "home", ".ao", "subdir"), join(f.root, "lexical", "link"));
        return join(f.root, "lexical", "link") + "/../bin";
      },
    ],
    [
      "a symlink followed by .. before the install creates .ao/bin",
      (f) => {
        mkdirSync(join(f.root, "later-home", ".ao", "subdir"), { recursive: true });
        mkdirSync(join(f.root, "lexical"));
        symlinkSync(join(f.root, "later-home", ".ao", "subdir"), join(f.root, "lexical", "link"));
        return join(f.root, "lexical", "link") + "/../bin";
      },
    ],
    [
      "a symlink followed by .. that reaches a gh wrapper copy",
      (f) => {
        mkdirSync(join(f.root, "copydir", "sub"), { recursive: true });
        copyFileSync(join(f.binDir, "gh"), join(f.root, "copydir", "gh"));
        mkdirSync(join(f.root, "lexical"));
        symlinkSync(join(f.root, "copydir", "sub"), join(f.root, "lexical", "link"));
        return join(f.root, "lexical", "link") + "/..";
      },
    ],
  ];

  it.each(spellings)("removes a wrapper directory named with %s", (_, spell) => {
    const entry = spell(fx);
    expect(removeAoBinFromPath(`${entry}:${rest}`)).toBe(rest);
  });

  it("removes a .ao/bin that holds another tool's git and no ao marker: the name is ao's", () => {
    // An ao install for that HOME would replace this git with the wrapper
    // while the pane runs, so the directory goes even now.
    const toolDir = join(fx.root, "not-ao", ".ao", "bin");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, "git"), "#!/usr/bin/env bash\n# real private git tool\n", {
      mode: 0o755,
    });
    expect(removeAoBinFromPath(`${toolDir}:${rest}`)).toBe(rest);
  });

  it("keeps an entry that names .ao/bin only after a lexical collapse of ..", () => {
    // <root>/.ao/link/../bin is <root>/plain/bin for the kernel: link is
    // followed before "..". That directory is not an ao wrapper directory.
    mkdirSync(join(fx.root, "plain", "sub"), { recursive: true });
    mkdirSync(join(fx.root, "plain", "bin"));
    mkdirSync(join(fx.root, ".ao"));
    symlinkSync(join(fx.root, "plain", "sub"), join(fx.root, ".ao", "link"));
    const entry = join(fx.root, ".ao", "link") + "/../bin";
    expect(removeAoBinFromPath(`${entry}:${rest}`)).toBe(`${entry}:${rest}`);
  });

  it("removes every wrapper entry and keeps the others in order", () => {
    const path = `/a:${fx.binDir}:/b:${fx.binDir}/:/c:/home/testuser/.ao/bin`;
    expect(removeAoBinFromPath(path)).toBe("/a:/b:/c");
  });
});

describe("GH_WRAPPER", () => {
  let fx: WrapperFixture;
  let fakeGh: string;
  const prUrl = "https://github.com/o/r/pull/42";

  const gh = (args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<ScriptResult> =>
    runScript(join(fx.binDir, "gh"), args, {
      cwd: fx.repo,
      env: { ...fx.env, GH_PATH: fakeGh, ...extraEnv },
      timeoutMs: 3_000,
    });

  beforeEach(() => {
    fx = makeWrapperFixture();
    const fakeDir = join(fx.root, "fake-gh");
    mkdirSync(fakeDir);
    fakeGh = join(fakeDir, "gh");
    writeFileSync(
      fakeGh,
      [
        "#!/usr/bin/env bash",
        'echo "fake-gh progress: $*" >&2',
        `if [[ "$1/$2" == "pr/create" ]]; then echo "${prUrl}"; else echo "fake-gh out: $*"; fi`,
        'if [[ -n "$FAKE_GH_EXIT" ]]; then exit "$FAKE_GH_EXIT"; fi',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it("gh pr create stores pr and status=pr_open and keeps stderr on stderr", async () => {
    const result = await gh(["pr", "create", "--title", "t", "--body", "b"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${prUrl}\n`);
    expect(result.stderr).toBe("fake-gh progress: pr create --title t --body b\n");
    expect(fx.readKey("pr")).toBe(prUrl);
    expect(fx.readKey("status")).toBe("pr_open");
  });

  it("gh pr create writes nothing and keeps gh's exit code when gh fails", async () => {
    const result = await gh(["pr", "create", "--fill"], { FAKE_GH_EXIT: "4" });
    expect(result.code).toBe(4);
    expect(fx.readKey("pr")).toBeUndefined();
    expect(fx.readKey("status")).toBe("working");
  });

  it.each([[["pr", "merge", "42", "--squash"]], [["pr", "merge", "--auto", "--squash"]]])(
    "gh %j writes no status=merged",
    async (args) => {
      writeFileSync(fx.record, `worktree=${fx.repo}\npr=${prUrl}\nstatus=pr_open\n`);
      const result = await gh(args);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(`fake-gh out: ${args.join(" ")}\n`);
      expect(fx.readKey("status")).toBe("pr_open");
    },
  );

  it("ignores a GH_PATH that points back at the wrapper and finds gh on PATH", async () => {
    const fakeDir = join(fx.root, "fake-gh");
    const result = await gh(["api", "x"], {
      GH_PATH: `${fx.binDir}//gh`,
      PATH: `${fx.binDir}:${fakeDir}:${fx.env["PATH"]}`,
    });
    expect(result.timedOut).toBe(false);
    expect(result).toMatchObject({ code: 0, stdout: "fake-gh out: api x\n" });
  });

  it("falls back to a no-op update_ao_metadata when the helper is missing", async () => {
    rmSync(join(fx.binDir, "ao-metadata-helper.sh"));
    const result = await gh(["pr", "create", "--fill"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("fake-gh progress: pr create --fill\n");
    expect(fx.readKey("pr")).toBeUndefined();
  });

  it("a refused helper call can never fail the wrapped gh: wrappers save exit code, set no errexit", async () => {
    // The wrappers call only allowed keys (pr, status pr_open), so they never
    // hit the refusal path. Even if the helper refused, the wrapper saves the
    // real binary's exit code first and exits with it, with no `set -e`.
    expect(GH_WRAPPER).not.toMatch(/set\s+-e/);
    expect(GH_WRAPPER).toContain("PIPESTATUS[0]");
    expect(GH_WRAPPER).toContain("exit $exit_code");
    // Live: a helper that refuses everything still leaves gh's output and exit code intact.
    writeFileSync(
      join(fx.binDir, "ao-metadata-helper.sh"),
      '#!/usr/bin/env bash\nupdate_ao_metadata() { echo "ao-metadata-helper: refusing key \'$1\'" >&2; return 1; }\n',
      { mode: 0o755 },
    );
    const result = await gh(["pr", "create", "--title", "t"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${prUrl}\n`);
    expect(fx.readKey("pr")).toBeUndefined();
  });

  it("a refused helper call can never fail the wrapped git", async () => {
    expect(GIT_WRAPPER).not.toMatch(/set\s+-e/);
    expect(GIT_WRAPPER).toContain("exit_code=$?");
    expect(GIT_WRAPPER).toContain("exit $exit_code");
  });
});
