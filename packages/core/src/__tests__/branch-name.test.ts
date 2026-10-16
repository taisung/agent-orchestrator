import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isSafeBranchName, isSafePrUrl } from "../utils/branch-name.js";
import { AO_METADATA_HELPER } from "../agent-workspace-hooks.js";

// m-13: one table of names checked against both copies of the rule:
// the TypeScript copy (isSafeBranchName) and the bash copy (the installed
// helper from a fake HOME). D1 requires the valid names below plus names
// with "." and "_" inside; the invalid names cover every case of brief 2.1.
// m-16: C1 controls (U+0080-U+009F) and U+2028/U+2029 are valid: git and
// the TypeScript rule accept them, and the bash copies must agree in both
// the C and a UTF-8 locale.
export const VALID_BRANCH_NAMES = [
  "main",
  "feat/x",
  "session/demo-1",
  "orchestrator/ao-orchestrator-1",
  "feat/helperkeys-muse-read-agent-task-md-in-your-worktree-and-exec",
  "feat/a.b",
  "feat/a_b",
  "v1.0",
  "a_b-c.d/e_f-g.h",
  "Foo",
  "123",
  "a/b/c",
  "feature-1",
  "a-b",
  "a/b-c",
  "a./b",
  "a/-b",
  "@@",
  "a@b",
  "a@@b",
  "head",
  "foo/HEAD",
  "feat/n\u0085x",
  "feat/c\u0080d",
  "feat/e\u009Ff",
  "feat/a\u2028b",
  "feat/a\u2029b",
];

export const INVALID_BRANCH_NAMES = [
  "",
  "-Bvictim",
  "-foo",
  "-",
  "--",
  "-a/b",
  " ",
  "a b",
  "a\tb",
  "a\nb",
  "a\rb",
  "a\x7fb",
  "\x1fa",
  "a..b",
  "..",
  "...",
  "foo..bar",
  "a~b",
  "a^b",
  "a:b",
  "a?b",
  "a*b",
  "a[b",
  "a\\b",
  "a@{b}",
  "@{",
  "@{-1}",
  "@",
  "/a",
  "a/",
  "a//b",
  "/",
  ".a",
  "a/.b",
  "foo/.bar",
  ".",
  "./foo",
  "foo/./bar",
  "a.lock",
  "foo.lock",
  "foo/bar.lock",
  "foo.lock/bar",
  ".lock",
  "a.",
  "foo/bar.",
  "foo/.",
  "HEAD",
];

export const VALID_PR_URLS = [
  "https://github.com/o/r/pull/1",
  "https://github.com/owner/repo/pull/42",
  "https://github.com/my-org/my.repo-name/pull/123",
  "https://github.com/A/B/pull/999999",
  "https://github.com/a-b/c_d.e/pull/7",
];

export const INVALID_PR_URLS = [
  "notaurl",
  "",
  "https://github.com/o/r/pull/",
  "https://github.com/o/r/pull/abc",
  "https://github.com/o/pull/1",
  "https://github.com/o/r/issues/1",
  "http://github.com/o/r/pull/1",
  "https://github.com/o/r/pull/1/extra",
  "https://github.com/o/r/pull/1?x=1",
  " https://github.com/o/r/pull/1",
  "https://github.com/o/r/pull/1 ",
  "https://gitlab.com/o/r/pull/1",
  "https://github.com/o/r/pull/-1",
  "javascript:alert(1)",
];

describe("isSafeBranchName", () => {
  it.each(VALID_BRANCH_NAMES)("accepts valid %j", (name) => {
    expect(isSafeBranchName(name)).toBe(true);
  });

  it.each(INVALID_BRANCH_NAMES)("refuses invalid %j", (name) => {
    expect(isSafeBranchName(name)).toBe(false);
  });
});

describe("isSafePrUrl", () => {
  it.each(VALID_PR_URLS)("accepts valid %j", (url) => {
    expect(isSafePrUrl(url)).toBe(true);
  });

  it.each(INVALID_PR_URLS)("refuses invalid %j", (url) => {
    expect(isSafePrUrl(url)).toBe(false);
  });
});

describe("bash and TypeScript copies agree on the whole table", () => {
  function makeHelperEnv(): {
    root: string;
    helperPath: string;
    record: string;
    env: NodeJS.ProcessEnv;
  } {
    const root = mkdtempSync("/tmp/ao-branch-table-");
    const sessionsDir = join(root, "sessions");
    const helperPath = join(root, "ao-metadata-helper.sh");
    const record = join(sessionsDir, "app-1");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(helperPath, AO_METADATA_HELPER);
    writeFileSync(record, "status=working\n");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AO_STATE_ROOT: root,
      AO_DATA_DIR: sessionsDir,
      AO_SESSION: "app-1",
    };
    return { root, helperPath, record, env };
  }

  function bashAccepts(
    helperPath: string,
    env: NodeJS.ProcessEnv,
    key: string,
    value: string,
  ): boolean {
    try {
      execFileSync(
        "bash",
        ["-c", 'source "$1"; update_ao_metadata "$2" "$3"', "bash", helperPath, key, value],
        { env, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
      );
      return true;
    } catch {
      return false;
    }
  }

  // m-16: the bash check is byte-based (LC_ALL=C inside the function), so it
  // agrees with TypeScript in C and in UTF-8 locales. Without the fix, the
  // C1/U+2028/U+2029 valid names fail in a UTF-8 locale.
  it.each(["C", "C.UTF-8", "en_US.UTF-8"])(
    "branch table: bash agrees with TypeScript in locale %s",
    (locale) => {
      const fx = makeHelperEnv();
      const localeEnv = {
        ...fx.env,
        LC_ALL: locale,
        LC_CTYPE: locale,
        LANG: locale,
      };
      try {
        for (const name of [...VALID_BRANCH_NAMES, ...INVALID_BRANCH_NAMES]) {
          const ts = isSafeBranchName(name);
          const bash = bashAccepts(fx.helperPath, localeEnv, "branch", name);
          expect(
            bash,
            `bash/TS disagree on branch ${JSON.stringify(name)} (ts=${ts} bash=${bash}) in locale ${locale}`,
          ).toBe(ts);
        }
      } finally {
        rmSync(fx.root, { recursive: true, force: true });
      }
    },
  );

  it("pr table: bash agrees with TypeScript", () => {
    const fx = makeHelperEnv();
    try {
      for (const url of [...VALID_PR_URLS, ...INVALID_PR_URLS]) {
        const ts = isSafePrUrl(url);
        const bash = bashAccepts(fx.helperPath, fx.env, "pr", url);
        expect(
          bash,
          `bash/TS disagree on pr ${JSON.stringify(url)} (ts=${ts} bash=${bash})`,
        ).toBe(ts);
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  it("helper refuses bad branch and bad pr with one stderr line naming the key", () => {
    const fx = makeHelperEnv();
    try {
      const run = (
        key: string,
        value: string,
      ): { code: number; stderr: string; before: string; after: string } => {
        writeFileSync(fx.record, "status=working\nbranch=main\n");
        const before = readFileSync(fx.record, "utf8");
        try {
          const stderr = execFileSync(
            "bash",
            ["-c", 'source "$1"; update_ao_metadata "$2" "$3"', "bash", fx.helperPath, key, value],
            { env: fx.env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
          );
          void stderr;
          return { code: 0, stderr: "", before, after: readFileSync(fx.record, "utf8") };
        } catch (err: unknown) {
          const e = err as { status?: number; stderr?: string | Buffer };
          const stderr = typeof e.stderr === "string" ? e.stderr : String(e.stderr ?? "");
          return {
            code: e.status ?? 1,
            stderr,
            before,
            after: readFileSync(fx.record, "utf8"),
          };
        }
      };

      for (const bad of ["-Bvictim", "", "a b", "a..b", "HEAD", "@"]) {
        const r = run("branch", bad);
        expect(r.code, `branch ${JSON.stringify(bad)}`).not.toBe(0);
        expect(r.stderr.trim().split("\n")).toHaveLength(1);
        expect(r.stderr).toContain("branch");
        expect(r.after).toBe(r.before);
      }
      for (const bad of ["notaurl", "", "https://github.com/o/r/issues/1"]) {
        const r = run("pr", bad);
        expect(r.code, `pr ${JSON.stringify(bad)}`).not.toBe(0);
        expect(r.stderr.trim().split("\n")).toHaveLength(1);
        expect(r.stderr).toContain("pr");
        expect(r.after).toBe(r.before);
      }
      for (const good of ["main", "feat/x"]) {
        const r = run("branch", good);
        expect(r.code, `branch ${good}`).toBe(0);
      }
      for (const good of ["https://github.com/o/r/pull/42"]) {
        const r = run("pr", good);
        expect(r.code, `pr ${good}`).toBe(0);
      }
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
