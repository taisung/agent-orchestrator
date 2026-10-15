# Review — I-6, round 1: `ao start` installs OpenCode 2.x from `@opencode/cli`

**Reviewer**: DeepSeek V4.1 Flash
**Range reviewed**: `git diff 439c16fb d8c666b1` (one commit, `d8c666b1`).
**Files**: `packages/cli/src/commands/start.ts`, `packages/cli/__tests__/commands/start.test.ts`.
**Worktree HEAD**: `d8c666b1` (verified `git log --oneline -1`). Not rebased.
**Date**: 2026-10-14.
**Method**: read the full diff and both files; ran the read-only detection (`npm ls -g`,
`npm view`) and the exported detection function end-to-end against the real npm; ran the required
`pnpm` checks in the worktree; ran the new tests against the pre-change `start.ts` in a hardlink
scratch copy under `/tmp` to test non-vacuity. No tracked file was edited, nothing committed, nothing
pushed, no `--force`/global install run.

## Verdict

**LAND-SAFE**

The option now names `@opencode/cli`, `--force` and the one-line notice appear only when
`opencode-ai` is installed globally, detection is read-only and cannot throw or stop `ao start`,
every other agent option is unchanged, and the whole install-prompt path is gated behind a TTY. The
new tests are non-vacuous and run no real npm. Only minor findings below; none changes the decision.

## Findings

### m-1 — `promptInstallAgentRuntime` wiring is not covered by any test (helpers only)

`packages/cli/src/commands/start.ts:458-466`. The 8 new tests exercise `AGENT_INSTALL_OPTIONS`,
`buildOpenCodeInstallArgs`, `openCodeInstallNotice`, `isLegacyOpenCodeInstalled` and
`resolveOpenCodeInstall`, but nothing asserts that the `opencode` branch actually calls
`resolveOpenCodeInstall`, prints `resolved.notice` and passes `resolved.args` to
`runInteractiveCommand`. A future edit could drop the `if (selected.id === "opencode")` wiring and
every test would still pass.

```
$ grep -nE "promptInstallAgentRuntime|runInteractive" packages/cli/__tests__/commands/start.test.ts
(no output)
```

Not a regression: this prompt path was untested before the change too, and `canPromptForInstall()`
needs a real TTY (`IS_TTY` is false under vitest), so it is hard to reach. Minor.

### m-2 — detection passes no timeout to `exec`

`packages/cli/src/commands/start.ts:361-367`. `isLegacyOpenCodeInstalled` calls `exec("npm", [...])`,
and `exec` (`packages/cli/src/lib/shell.ts:11`) sets no `timeout`. A hung `npm ls -g` would block the
interactive install prompt indefinitely.

This matches the surrounding code — the other `exec`/`execSilent` calls in `start.ts` (git, gh, tmux)
also omit a timeout — so it is not a new risk class, and `npm ls -g <pkg>` is a fast local read. Minor.

### m-3 — the choice hint still shows the no-`--force` command

`packages/cli/src/commands/start.ts:439-445`. The runtime picker's hint is built from
`[option.cmd, ...option.args]`, i.e. `npm install -g @opencode/cli`, because legacy state is not
known until after selection. When `opencode-ai` is present the executed command gains `--force` and
the notice explains it, so the user is not misled about *why*; the hint just understates the exact
argv at selection time. Cosmetic. Minor.

## What I checked and found correct

- **Scope.** `git diff --stat 439c16fb d8c666b1` = exactly the two files, `212 insertions(+),
  4 deletions(-)`. No config, docs or other agent touched. `git branch -r --contains d8c666b1`
  prints nothing (not pushed).
- **Option name.** `AGENT_INSTALL_OPTIONS` opencode entry is `["install","-g","@opencode/cli"]`
  (`start.ts:428`); claude-code, codex and gemini entries unchanged (`start.ts:410,416,422`).
- **Facts behind the design.** `npm view @opencode/cli version bin` → `2.0.29`,
  `bin = { opencode: 'bin/opencode.exe', opencode2: 'bin/opencode.exe' }`; `npm view opencode-ai
  version` → `1.19.0`; `npm view opencode-ai bin` → `{ opencode: ... }`. Both own the `opencode`
  bin, so the `--force` premise holds.
- **Detection, absent (real run).** `npm ls -g opencode-ai --depth=0 --json` exits `1` and prints
  `{\n  "name": "lib"\n}` on stdout. Promisified `execFile` rejects with `code:1`,
  `stdout:"{\n  \"name\": \"lib\"\n}\n"`, `stderr:""`; `hasLegacyOpenCodePackage` parses that and
  returns false. End-to-end through the built module:
  `isLegacyOpenCodeInstalled() -> false`,
  `resolveOpenCodeInstall() -> {"args":["install","-g","@opencode/cli"],"notice":null}`.
- **Detection, present shape.** Real `npm ls -g npm --depth=0 --json` prints
  `{ "name": "lib", "dependencies": { "npm": { "version": "11.18.0", "overridden": false } } }`;
  the `dependencies` key is exactly what the code inspects (`start.ts:345-347`).
- **Failure modes.** npm missing → `execFile` rejects with no string `stdout` → returns false.
  Non-JSON output → `JSON.parse` throws inside `hasLegacyOpenCodePackage` → false. Error with output
  only on stderr → string `stdout` empty → false. A failed detection resolves to the same no-flag
  plan as absent and never throws, and the caller is inside a `try/catch` anyway
  (`start.ts:457-475`), so it cannot stop `ao start`. No path adds `--force` unless
  `dependencies["opencode-ai"]` is present, so no false positive.
- **Prefix parity.** Both detection and install use `-g` with no `--prefix`, through the same npm on
  `PATH`, so they share one global prefix.
- **Tests non-vacuous.** `npx vitest run __tests__/commands/start.test.ts` against the `439c16fb`
  `start.ts` (hardlink scratch copy in `/tmp`, original untouched): `Tests 8 failed | 27 passed
  (35)` — all 8 new OpenCode tests fail, all 27 pre-existing pass.
- **Tests run no real npm.** `exec` is mocked in `start.test.ts:48-56` (`exec: mockExec`); the new
  tests set `mockExec` before each call. No `spawnSync`/`child_process` use in the test file.
- **Assertions are relational.** `buildOpenCodeInstallArgs`/`resolveOpenCodeInstall` tests compare
  present-vs-absent runs (`length + 1`, prefix `slice` equality, `not.toContain(flag)`,
  null-vs-non-null notice) rather than hard-coding the argv array. The only literals are the required
  contract values (`@opencode/cli`, `--force`).
- **Commit hygiene.** `fix(cli): install OpenCode 2.x from npm @opencode/cli`; body explains WHY
  (npm `opencode-ai` stops at 1.19.0); no `Co-Authored-By` trailer, no emoji, no issue number.
- **Required commands** (worktree, `d8c666b1`):
  - `pnpm build` → all packages `Done`.
  - `pnpm --filter @aoagents/ao-cli test` → `Test Files 19 passed (19)`,
    `Tests 239 passed (239)`; `start.test.ts` 35 tests.
  - `pnpm --filter @aoagents/ao-cli typecheck` → `tsc --noEmit`, no errors.
  - `pnpm lint` → `0 errors, 6 warnings`, all 6 pre-existing and none in the two changed files.
