# I-6 review, round 1: `ao start` installs OpenCode 2.x from npm `@opencode/cli`

Range: `git diff 439c16fb d8c666b1` (one commit, two files). Reviewer: Sonnet 5.5. Date: 2026-10-14.
Worktree HEAD: `d8c666b1 fix(cli): install OpenCode 2.x from npm @opencode/cli`.

**Verdict: LAND-SAFE**

Finding counts: 0 blockers, 1 major, 6 minor, 3 notes.

Scale used here: B = the landed code behaves wrongly or unsafely. M = the code works today, but a
verified gap lets a regression pass. m = polish or a low-probability risk. The production code is
correct in every case I ran (section 2). The major finding is a test gap (M-1). A reproducer test is
ready, and it kills every mutant that the shipped tests miss. Add it in this commit or in the next.

## 1. Command summaries (my own runs, in my worktree)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | `Done in 1.3s` (one WARN: the `ao` bin link in `packages/ao` needs a built cli, harmless) |
| `pnpm build` | exit 0, last line `packages/cli build: Done` |
| `pnpm --filter @aoagents/ao-cli test` | `Test Files  19 passed (19)` / `Tests  239 passed (239)` |
| `pnpm --filter @aoagents/ao-cli typecheck` | `tsc --noEmit`, exit 0, no output |
| `pnpm lint` | `✖ 6 problems (0 errors, 6 warnings)`. None is in `start.ts` or `start.test.ts`. |
| `npx prettier --check` on the two files | `[warn] packages/cli/__tests__/commands/start.test.ts` (see m-3) |

## 2. Findings

### M-1 (major): the call site and the installed package name have no test

Files: `packages/cli/src/commands/start.ts:458-466` (call site), `:380` (package constant),
`packages/cli/__tests__/commands/start.test.ts:905-1019`.

No shipped test calls `promptInstallAgentRuntime`. The eight new tests call the helpers
(`buildOpenCodeInstallArgs`, `openCodeInstallNotice`, `isLegacyOpenCodeInstalled`,
`resolveOpenCodeInstall`) and read the `AGENT_INSTALL_OPTIONS` table. Nothing checks that the prompt
path uses the helper result. Nothing checks which argv reaches `spawn`.

Evidence. I copied the worktree (without `.git`) to the scratchpad, changed only the copy of
`start.ts`, and ran the shipped `start.test.ts` (35 tests) against each mutant:

| Mutant (in the scratch copy) | Shipped tests |
|---|---|
| M1: call site always runs `selected.args` (detection result dropped) | 35 passed, mutant survives |
| M3: call site always appends `--force` for OpenCode | 35 passed, survives |
| M4: the OpenCode branch runs for every agent (`if (true)`) | 35 passed, survives |
| M5: `OPENCODE_NPM_PACKAGE = "@opencode/cli-wrong"` (the package npm really installs) | 35 passed, survives |
| M11: the notice print removed from the call site | 35 passed, survives |
| M8: `hasLegacy` inverted in `buildOpenCodeInstallArgs` | 2 failed, killed |
| M9: `--json` dropped from the detection argv | 2 failed, killed |
| M10: detection runs `npm install` instead of `npm ls` | 2 failed, killed |

M5 is the sharpest case. The test "names @opencode/cli for OpenCode" reads the table row, which only
feeds the prompt hint. The package that npm installs comes from a second literal, the constant at
`start.ts:340`. No test reads that constant. The user-visible result (what `ao start` runs, and when
it adds `--force` and prints the line) is the behavior the brief asks to pin, and no test pins it.

The author report says `promptInstallAgentRuntime` cannot run under vitest because `IS_TTY` is false.
That is not a blocker. `IS_TTY` is read once at import (`start.ts:59`). `vi.hoisted` can set
`process.stdin.isTTY` and `process.stdout.isTTY` before the import. `spawn` and `promptSelect` mock
cleanly.

Reproducer (full file: `/tmp/claude-44402/-home-taisung--worktrees-agent-orchestrator-ao-7/8508cd21-641a-497f-adce-4e32be3df30c/scratchpad/start-wiring-scratch.test.ts`;
it is the header of `start.test.ts` plus the block below). It never reaches a real npm: `spawn` is
mocked, `exec` is mocked, and `PATH` points to a stub `npm` that only logs. The stub log stayed empty.

```ts
const { spawnCalls } = vi.hoisted(() => {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  return { spawnCalls: [] as Array<[string, string[]]> };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  return { ...actual, spawn: (cmd: string, args: string[]) => {
    spawnCalls.push([cmd, args]);
    const e = new EventEmitter(); setImmediate(() => e.emit("close", 0)); return e; } };
});
vi.mock("../../src/lib/prompts.js", () => ({ promptSelect: vi.fn(), promptConfirm: vi.fn() }));
// per test: re-mock detectEnvironment, detectAvailableAgents -> [], isHumanCaller -> true
// (the suite's afterEach vi.restoreAllMocks() clears them), then: await createConfigOnly();
it("opencode, legacy absent", ...) // spawnCalls equals [["npm", ["install","-g","@opencode/cli"]]], no "--force" logged
it("opencode, legacy present", ...) // spawnCalls equals [["npm", [..., "@opencode/cli","--force"]]], "--force" logged
it("codex, legacy present", ...)   // spawnCalls equals the codex table row, and no "npm ls" ran
```

Result on the author's `start.ts`: 3 passed. Against the mutants: M1 killed (1 failed), M3 killed
(2 failed), M4 killed (1 failed), M5 killed (2 failed), M11 killed (1 failed).

Fix: add these three tests to `start.test.ts`, in the shape above.

### m-1 (minor): `npm ls` has no timeout; a hung npm blocks `ao start`

File: `start.ts:359-376`; `packages/cli/src/lib/shell.ts:11-21` (`exec` takes no timeout option).

The code never throws, so a failed detection cannot crash `ao start`. A hung npm is a different
case. I ran the compiled `resolveOpenCodeInstall` with a stub `npm` that runs `sleep 20`. After 8
seconds the driver had printed nothing, and `timeout 8` ended it with exit 124. The user sees
"Installing OpenCode..." and then nothing, until Ctrl-C. The risk is low: `npm ls -g` reads only
local files. The same helper has no timeout at the other `exec` call sites either. If the owner
wants one, `execFile` supports `timeout`, and a killed child lands in the existing `catch`, which
returns `false`. `exec` needs a `timeout` option for that.

### m-2 (minor): the package name has two sources of truth

Files: `start.ts:340` and `:428`.

`AGENT_INSTALL_OPTIONS` holds the literal `"@opencode/cli"` (used for the prompt hint only). The
install argv comes from `OPENCODE_NPM_PACKAGE` (`start.ts:380`). The call site drops `selected.args`
for OpenCode. If the two drift, the prompt shows one package and npm installs another (mutant M5, and
no test fails). Fix: write the row as `args: ["install", "-g", OPENCODE_NPM_PACKAGE]`. A test that
checks `buildOpenCodeInstallArgs(false)` equals the row args would also pin it.

### m-3 (minor): the test file is not Prettier-clean

File: `start.test.ts:967-970` and `:979-982`.

`npx prettier --check` fails on the file. Prettier wants the `toHaveBeenCalledWith("npm", [` form with
one array element per line. The file at `439c16fb` is clean (I checked with `--stdin-filepath`). No
CI workflow and no husky hook runs `format:check`, so nothing enforces it. `CLAUDE.md` lists
`pnpm format:check` as a project command.

### m-4 (minor): wider export surface than the code needs

File: `start.ts:340-341`, `:359`, `:379`, `:385`, `:397`, `:405`.

The commit exports seven new names. `OPENCODE_NPM_PACKAGE` and `LEGACY_OPENCODE_NPM_PACKAGE` are
imported nowhere else (`grep` over `packages`, excluding `dist`). Make them non-exported. The other
five exports are for the tests, which is common. If M-1 is fixed through the prompt path, the
helper exports can go back to private.

### m-5 (minor): the catch branch that reads `err.stdout` has no positive test

File: `start.ts:369-375`; `start.test.ts:973-983`.

When npm exits 1, the code still parses `err.stdout`. The tests feed this branch only the absent
shape (`{"name":"lib"}`), so `false` is the answer with or without the parse. Mutant M2 (the branch
always returns `false`) leaves 35 of 35 tests green. I also could not make real npm reach this branch
with `opencode-ai` listed: with a healthy install, an install with an unmet dependency, and two
packages that depend on `opencode-ai` without it installed, npm gave exit 0 with the package, or
exit 1 with `{"name":"lib"}`. The branch is a defense that I could not reach with real npm. Add one
test that rejects with `stdout` that lists `opencode-ai`, or remove the branch.

### m-6 (minor): the commit body is one 369-character line

The commit message is otherwise correct (section 3). The body has no line breaks. The last six
commits before the range wrap at 74 characters or fewer.

## 3. Notes (not defects of this commit)

- **N-1.** `.github/workflows/integration-tests.yml:44` still runs `npm install -g opencode-ai`
  (npm `latest` is `1.19.0`, from `npm view`). It is outside the I-6 file list in section 13 of
  `0009`. The CI integration job still installs OpenCode 1.x. Decide whether another increment
  covers it.
- **N-2.** Section 8 of `0009` also proposes to "print the curl installer as the alternative hint".
  The owner's answer Q1 (section 18) does not include it, and this commit does not add it.
- **N-3.** What `--force` does (`config.md` of the installed npm 11.18.0): it allows clobbering
  non-npm files in global installs, and it allows installs when `engines` do not match, even with
  `--engine-strict`. The commit adds it only when `opencode-ai` is present, which is the owner's
  choice in Q1. After the install, `opencode-ai` stays installed with its `opencode` bin replaced.

## 4. What I checked and found correct

**Behavior (brief item 1).**
- The OpenCode row is `["install", "-g", "@opencode/cli"]` (`start.ts:428`). The diff changes no
  other row. Only `export` is added to the table.
- `--force` and the one-line notice appear only on the OpenCode path, and only when detection says
  `opencode-ai` is present. The notice reads: `opencode-ai is installed globally, adding --force to
  replace its opencode bin.` Detection runs only after the user picks OpenCode.
- I ran the compiled `resolveOpenCodeInstall` (`packages/cli/dist/commands/start.js`, my build)
  against real npm with `npm_config_prefix` set to a fake global root. That is read-only, and no
  install ran:
  - healthy fake `opencode-ai@1.19.0`: `["install","-g","@opencode/cli","--force"]` plus the notice;
  - host prefix, `opencode-ai` absent: `["install","-g","@opencode/cli"]`, notice `null`;
  - a global package that depends on `opencode-ai` while it is not installed: no `--force`.

**Detection (item 2).**
- `npm ls -g opencode-ai --depth=0 --json`, `opencode-ai` absent, host prefix: exit 1, stdout
  `{"name":"lib"}`, stderr empty. With a present fake: exit 0, stdout
  `{"name":"lib","dependencies":{"opencode-ai":{"version":"1.19.0","overridden":false}}}`. With a
  missing prefix directory: exit 254, stdout a JSON `error` object, stderr `npm error ...`.
- The code reads the right place. Exit 0 parses `stdout`. A rejected `exec` parses `err.stdout`
  when it is a non-empty string. Otherwise the answer is `false`.
- Failure cases, each run through the compiled code with a stub or an empty `PATH`. All gave no
  `--force`, no notice, and no throw: npm missing (empty `PATH` dir), stdout `this is not json`,
  stdout `null`, stderr-only error with exit 1. A stub that prints a JSON with `opencode-ai` and
  exits 1 gave `--force` (this is the m-5 branch, correct).
- Same npm prefix: `exec` passes `env: undefined` (inherits `process.env`), and `spawn` in
  `runInteractiveCommand` inherits too. Both use the same `PATH`, the same cwd, and the same npm
  config. `start.ts` never calls `chdir`. My `npm_config_prefix` runs show detection follows the
  inherited environment.
- A hung npm: m-1. A timeout is the only way a failed detection stops `ao start`.

**Tests (item 3).**
- Against the `start.ts` of `439c16fb` (scratch copy, my worktree untouched), `start.test.ts` gives
  `Tests  8 failed | 27 passed (35)`. The 8 are exactly the new tests. Seven fail with `TypeError: ...
  is not a function` and one with `Cannot read properties of undefined (reading 'find')`. No
  assertion fails, because the helpers do not exist there. This shows the new tests depend on the
  new code. It does not show they pin the behavior (M-1).
- The `--force` and notice tests assert relations (one more arg, equal prefix, `null` against
  non-null, present against absent). Mutant M8 (inverted flag) fails 2 tests. The detection tests
  assert the exact read-only argv. That is a copy of a source string, but it is also the read-only
  contract, and M9 and M10 fail 2 tests each. The "other agents unchanged" test copies three package
  names from the table.
- No shipped test runs a real npm command or installs anything. `exec` is `mockExec` through
  `vi.mock("../../src/lib/shell.js")`, and no new test reaches `spawn`.
- Counts match the author report: `start.test.ts` has 35 tests (27 before), 239 in the package.

**Scope and message (item 4).**
- `git diff --stat 439c16fb d8c666b1`: two files, `start.ts` and `start.test.ts`. One commit in the
  range.
- Subject `fix(cli): install OpenCode 2.x from npm @opencode/cli` (53 characters). The body gives
  the WHY (npm `opencode-ai` stops at 1.19.0; both packages own the `opencode` bin). `grep -ci
  co-authored` gives 0. No non-ASCII character, no `#<number>`.
- `git branch -r --contains d8c666b1` prints nothing. `git log --oneline -1` shows `d8c666b1`.
- `npm view @opencode/cli version bin`: `2.0.29`, bins `opencode` and `opencode2`. `npm view
  opencode-ai version`: `1.19.0`. Both match section 8 of `0009`.

**Hygiene of this review.** I made no commit, no push, no PR. I ran no `npm install`, no `ao`
command, no model command. The worktree status is clean except the untracked task file and this
review file. The scratch copy and the stubs are in the scratchpad only.
