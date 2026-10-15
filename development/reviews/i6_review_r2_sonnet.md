# I-6 review, round 2: re-check of `d8c666b1..41562abb`

Reviewer: Sonnet 5.5 (the round-1 reviewer, ao-7). Date: 2026-10-14.
Worktree HEAD: `41562abb test(cli): pin the OpenCode install call site and its package`.
Range: one commit, three files: `packages/cli/src/commands/start.ts` (1 line),
`packages/cli/__tests__/commands/start.test.ts`, `.github/workflows/integration-tests.yml` (1 line).

**Verdict: LAND-SAFE**

Round-1 M-1 is closed. Round-1 m-2, m-3, m-5, m-6 and N-1 are closed. I found 0 blockers, 0 new
majors, 2 new minor findings (m-7, m-8) and 2 notes. Two round-1 items stay open by the
orchestrator's decision: m-1 (`npm ls` timeout) and m-4 (export surface). I checked that m-1 still
reproduces.

Scale (same as round 1): B = the landed code behaves wrongly or unsafely. M = a verified gap that
lets a regression pass. m = polish or a low-probability risk.

## 1. Command summaries (my own runs, in my worktree at `41562abb`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | `Done in 1.3s` |
| `pnpm build` | exit 0, last line `packages/cli build: Done` |
| `pnpm --filter @aoagents/ao-cli test` | `Test Files  19 passed (19)` / `Tests  243 passed (243)` |
| `pnpm --filter @aoagents/ao-cli typecheck` | `tsc --noEmit`, exit 0, no output |
| `pnpm lint` | `✖ 6 problems (0 errors, 6 warnings)`. Same 6 as round 1. None in the changed files. |
| `npx prettier --check` on the 3 changed files | `All matched files use Prettier code style!` |

The test count rose from 239 to 243: 3 call-site tests and 1 catch-branch test.

## 2. Round-1 items

### M-1: closed

My round-1 mutants, re-run in a new scratch copy of the worktree (no `.git`, outside the worktree).
Each mutant changes only the scratch `start.ts`. The tests are the committed `start.test.ts`
(39 tests). Control with the author's `start.ts`: `Tests  39 passed (39)`.

| Mutant | Result | Failing tests |
|---|---|---|
| M1: call site always runs `selected.args` (detection result dropped) | 1 failed, 38 passed | call site: legacy present |
| M3: call site always appends `--force` for OpenCode | 2 failed, 37 passed | call site: legacy absent; legacy present |
| M4: OpenCode branch runs for every agent (`if (true)`) | 1 failed, 38 passed | call site: another agent, no detection |
| M5: `OPENCODE_NPM_PACKAGE = "@opencode/cli-wrong"` | 3 failed, 36 passed | option table; call site absent; call site present |
| M11: notice print removed from the call site | 1 failed, 38 passed | call site: legacy present |
| M8: `hasLegacy` inverted in `buildOpenCodeInstallArgs` | 4 failed, 35 passed | 2 helper tests, 2 call-site tests |
| M9: `--json` dropped from the detection argv | 2 failed, 37 passed | the 2 detection tests |
| M10: detection runs `npm install` instead of `npm ls` | 2 failed, 37 passed | the 2 detection tests |
| M2 (round 1 m-5): catch branch ignores `err.stdout` | 1 failed, 38 passed | "detects legacy present from err.stdout when npm exits nonzero" |

All nine mutants fail at least one test. In round 1, M1, M3, M4, M5, M11 and M2 all passed 35 of 35.

The author's table shows M3 and M4 at "1 failed". My M3 gives 2 failed. The mutation text can
differ. It changes no conclusion.

**No test runs a real npm.** I ran the 39 tests with `PATH` set to a stub dir first, then the Node
dir. The stub `npm` appends every call to a log file. Over the control run and the nine mutant
runs, the log file was never created. I also checked that the net works: a `spawn("npm", ...)`
under the same `PATH` reached the stub and wrote `STUB npm --version-probe-not-real`. The call-site
tests go through `createConfigOnly` with `spawn` mocked (`spawnCalls`), `promptSelect` mocked, and
`exec` mocked. `promptSelect` defaults to `"skip"` in `beforeEach`, so no other test can reach an
install.

Reading of the new call-site tests (`start.test.ts:1076-1158`):
- Each asserts the whole argv with `toEqual` on `spawnCalls`: absent gives
  `[["npm", ["install","-g","@opencode/cli"]]]`; present gives the same plus `"--force"`.
- The Codex test compares `spawnCalls` with the table row and asserts that no `exec` call named
  `npm`. That is a relation to the row, not a copy.
- Each test also reads the logged output (`--force` absent or present, `opencode-ai` in the notice).

### m-2: closed

`start.ts:428` is now `args: ["install", "-g", OPENCODE_NPM_PACKAGE]`. `grep` finds the literal
`@opencode/cli` once in `start.ts` (line 340, the constant). The prompt hint and the install argv now
read the same constant. M5 is killed by the table test and by both OpenCode call-site tests.

### m-3: closed

`npx prettier --check` passes on `start.ts`, `start.test.ts` and the workflow file. The two
`toHaveBeenCalledWith("npm", [` hunks are in the Prettier form.

### m-5: closed (the test is positive; the npm claim in its comment is not shown, see m-8)

The new test "detects legacy present from err.stdout when npm exits nonzero" makes `exec` reject with
an error whose `stdout` lists `opencode-ai`. It expects `true`. Mutant M2 fails it (above).

Is it "real"? The rejection shape is real: Node's promisified `execFile` puts `stdout`, `stderr` and
`code` on the rejection. In round 1 and again now, a stub `npm` that prints a JSON with
`opencode-ai` and exits 1, run through the compiled `resolveOpenCodeInstall`, gave
`["install","-g","@opencode/cli","--force"]` with the notice.

Real npm never produced "exit nonzero and the package listed". In round 1 I tried 4 states (two
listed the package, both with exit 0). Now I tried 4 more (`npm_config_prefix` on a fake root, read-only `npm ls -g opencode-ai --depth=0 --json`):
- a package with an unmet `peerDependencies` entry: exit 0, package listed;
- a package whose version is invalid for another package's range: exit 0, package listed;
- a package with a missing `optionalDependencies` entry: exit 0, package listed;
- a package with a missing `dependencies` entry: exit 0, package listed.

The author found the same on a different set (including a corrupt `package.json`).

### m-6: closed

The new body is wrapped: the longest line is 67 characters (round 1: one line of 369). The subject is
`test(cli): pin the OpenCode install call site and its package` (61 characters). The body gives the
WHY and names the five mutants. It matches my round-1 table.

### N-1: closed in the file, with a caveat (m-7)

`.github/workflows/integration-tests.yml:44` is now `npm install -g @opencode/cli`. See section 4
for the whole job.

## 3. New findings

### m-7 (minor): the "nothing else assumes 1.x" claim for the CI job rests on a grep for package names

Evidence is in section 4. The author's report says a grep over `packages/integration-tests` finds no
`opencode-ai` or `@opencode/cli`, "so nothing else in the job assumes 1.x". That grep tests names,
not behavior. The job runs `pnpm test:integration`, which includes
`packages/integration-tests/src/agent-opencode.integration.test.ts`. That file contains:
- a live block (`:106-178`) that runs `opencode run 'Say hello and nothing else'` and expects
  `getActivityState` `null` while the agent runs and `getSessionInfo` `null`;
- static `getLaunchCommand` assertions on the 1.x text (`opencode run --format json --title ...
  --command true`, `:184-361`, for example `:206` and `:219`).

The static assertions read plugin source, not the binary, so the new install cannot change them. The
live block changes: before this commit CI paired the plugin with the 1.19.0 binary, and now it pairs
the plugin with 2.0.29. The block is gated (binary on `PATH`, a credential, and
`opencode run 'Say hello'` ending within 20 s), so a failure there becomes a silent skip, or a red
run on a push to `main` where the secrets exist. I could not check which, because it needs a model
command, and the brief forbids those. Nothing in the workflow edit is wrong. Watch the first CI run
that has the secrets, and record the result in the next handover.

### m-8 (minor): the new test comment states an npm behavior that nobody reproduced

`start.test.ts:1033-1034`: "npm can reject yet still print the package on stdout". In the 6 real
`npm ls -g opencode-ai --depth=0 --json` states where the package was listed (2 in round 1, 4 now)
and in the 4 listed states on the author's side, npm exited 0. Every exit 1 had no package listed. The branch is a sound defense against the Node
rejection shape, and the test is useful. The comment states a fact that no run supports. Rewrite it,
for example: "Node's execFile rejection carries stdout; read it before defaulting to absent."

## 4. The whole CI job (item 3)

`.github/workflows/integration-tests.yml` (one job, `ubuntu-latest`, Node 20, 20-minute timeout):
checkout, pnpm, Node, `apt-get install tmux`, `tmux start-server`, three global npm installs (Claude
Code, Codex, OpenCode), `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test:integration` with
`ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

- The install line: a fresh runner has no `opencode-ai`, so no `bin` conflict and no `--force` needed.
  `npm view @opencode/cli` shows no `engines` field, so Node 20 is fine. It has `os` linux and `cpu`
  x64 support, an `@opencode/cli-linux-x64` optional package, and a `postinstall` script
  (`node ./postinstall.mjs`) that the default `npm install -g` runs.
- The job itself names no OpenCode version and sets no OpenCode flag.
- No other workflow in `.github` mentions OpenCode.
- What the job runs does assume 1.x in places: m-7.

## 5. No regression, no change outside the round-2 items (items 4 and 6)

- The compiled `resolveOpenCodeInstall` from my `41562abb` build, same cases as round 1:
  - real npm, host prefix, `opencode-ai` absent: `["install","-g","@opencode/cli"]`, notice `null`;
  - real npm, fake prefix with `opencode-ai@1.19.0`: `[..., "--force"]` and the notice;
  - real npm, fake prefix where another package depends on `opencode-ai` but it is not installed: no
    `--force`;
  - stub npm giving non-JSON, `null`, or a stderr-only error: no `--force`, no throw;
  - npm missing: no `--force`, no throw;
  - stub npm printing the package and exiting 1: `--force`.
- The hung-npm case from round 1 m-1 still hangs (`timeout 8` ended the driver with exit 124). It is
  out of scope for round 2 by the orchestrator's decision. It stays open.
- `git diff d8c666b1 41562abb -- packages/cli/src/commands/start.ts` is one line: the table row. No
  other source file changed. The test diff has: the two Prettier hunks, the hoisted TTY and mock
  setup, the `beforeEach` defaults, one catch-branch test, and the call-site block.
- Scope: three files, one commit (`git log --oneline d8c666b1..41562abb`). `grep -ci co-authored`
  gives 0. No non-ASCII character, no `#<number>` in the message.
  `git branch -r --contains 41562abb` prints nothing.

## 6. Notes (not defects)

- **N-4.** The hoisted block sets `process.stdin.isTTY` and `process.stdout.isTTY` to `true` for the
  whole file, and mocks `spawn` and the prompts for the whole file. That is needed because `IS_TTY`
  is read once at import (`start.ts:59`). `promptSelect` defaults to `"skip"` and `promptConfirm` to
  `false` in `beforeEach`. All 243 tests pass, and the earlier tests in the file pass as before.
- **N-5.** The tests keep real npm away only through the `spawn` mock. If a later edit imports
  `spawn` under another module specifier, the mock may not apply, and a call-site test would run a
  real `npm install -g @opencode/cli` on the developer's machine. A cheap hardening is a
  `PATH` guard in the hoisted block, as in my round-1 scratch test. I did not find this to be a defect
  now: my stub net saw zero calls.

## 7. What I checked and found correct

- M-1: nine mutants, each fails at least one test; no real npm in any run (stub log never created;
  net proven).
- m-2: one constant names the package, in the table row and in the install argv.
- m-3: Prettier passes on all three changed files.
- m-5: the catch-branch test is positive and kills M2; the rejection shape is real.
- m-6: the body is wrapped (longest line 67).
- N-1: the workflow line is `@opencode/cli`; the rest of the job read in full; caveat m-7.
- Round-1 behavior: unchanged in 9 cases (section 5).
- Scope and message: three files, one commit, no trailer, no emoji, no issue number, not on any
  remote branch. HEAD is `41562abb`.
- Hygiene of this review: no commit, no push, no PR. I ran no `npm install`, no `ao` command and no
  model command. The only npm commands were `npm view` and `npm ls` (read-only), plus `npm --version`
  style probes that hit my stub. The scratch copy, the stubs and the fake prefixes are in the
  scratchpad only.
