# CI no-dashboard review, round 2: restore the config-load step, remove the last dashboard lint config

Range: `git diff ebc8e25b 353ef189` (two commits, two files). Reviewer: Sonnet 5.5. Date: 2026-10-15.
Worktree HEAD: `353ef189 chore(lint): drop dashboard web ignores from eslint config`.
Commits: `b6d85710 test(integration): restore sync config-load step and drop dead port key`, `353ef189`.
Author: ao-20 (Muse). Risk: LOW (CI, test and lint configuration only). I reviewed round 1 (`0a81e224`, now
`ebc8e25b` on `main`) and returned LAND-SAFE.

**Verdict: LAND-SAFE**

Finding counts: 0 blockers, 0 majors, 3 minor, 3 notes.

Scale (same as round 1): B = the commit breaks something or is unsafe to land. M = the commit works, but a
verified gap lets a regression pass. m = polish or dead config with no effect. n = a fact for the owner,
no action in these commits.

Status of the round-1 findings that round 2 acts on:

| Round-1 finding | Status | Evidence |
|---|---|---|
| M-1: no CI step ran `ao` on the test configuration | **Fixed** | New step 6 at `onboarding-test.sh:89-91`. The path audit in section 3 shows it cannot block, prompt, install, serve or call `gh`. |
| m-1: `port: 9000` in the step 4 configuration | **Fixed** | The line is gone. It is the only change in step 4. `grep` for the D2 pattern in `.github/ tests/` prints nothing. |
| m-2: dashboard entries in `eslint.config.js` | **Fixed as scoped** | The five ignore entries and the Next.js block are gone. `pnpm lint` is identical before and after. Two more dashboard-origin entries remain (m-1 and m-2 below). `.gitignore` is untouched on purpose (out of scope in the round-2 brief). |

## 1. Commands that I ran (read-only, in my worktree)

No Docker on this host, so I did not run the container. I did not run `onboarding-test.sh`, `run-test.sh`,
`scripts/setup.sh`, `ao start`, any installer or any tmux command.

| Check | Result |
|---|---|
| `git diff --stat ebc8e25b HEAD` | `eslint.config.js` 13 deletions, `tests/integration/onboarding-test.sh` 4 insertions and 1 deletion. Two files. |
| Step 4 and steps 1 to 5: `diff` of the new lines 1-88 against the old lines 1-89 without the `port: 9000` line | `IDENTICAL`. The only other hunk is the new step 6 after `end_step "Step 5..."`. |
| `bash -n tests/integration/onboarding-test.sh` | exit 0 |
| D2 grep `dashboard\|websocket\|14800\|14801\|9000\|browser` in `.github/ tests/` | prints nothing |
| D3 grep `dist-server\|\.next\|packages/web\|next\.config\|postcss\|Next\.js` in `eslint.config.js` | prints nothing |
| Lint before: `pnpm exec eslint -c <copy of ebc8e25b:eslint.config.js> .` | exit 0, `6 problems (0 errors, 6 warnings)` |
| Lint after: `pnpm lint` at `353ef189` | exit 0, `6 problems (0 errors, 6 warnings)` |
| `diff` of the two lint outputs | identical (only the process ID in a warning line differs). The 6 warnings are `spawn.ts:339`, `activity-log.ts:91`, `plugin-registry.ts:232`, `session-manager.ts:1269,1276`, `agent-opencode/src/index.ts:433`. |
| `git branch -r --contains 353ef189` | prints nothing. `git branch --contains` shows only the three `feat/ci...` worktree branches, not `main`. |
| Commit messages (`LC_ALL=C grep`) | no `Co-Authored-By`, no `Signed-off-by`, no issue number, ASCII only. Subjects are 71 and 58 characters. Both bodies give the WHY. |

How I ran the lint. The worktree has no `node_modules`. `pnpm install --frozen-lockfile --offline` with a
scratch `HOME` fails with `ERR_PNPM_NO_OFFLINE_TARBALL` (the store is under the real `HOME`). I linked the
root `node_modules` of the `ao-20` worktree into my worktree for the two runs and removed the link after.
ESLint only reads it. Versions match the lockfile of run `38771289585`: `eslint 10.2.0`,
`typescript-eslint 8.58.1`, `@eslint/js 10.0.1`. The root `package.json` and `pnpm-lock.yaml` did not
change in round 2. For the "before" run I put a copy of the old config in the worktree root (untracked) and
removed it after. `git status` shows only `.agent_report.md` and `.agent_task.md` (untracked).

## 2. Findings

### m-1 (minor): `test-clipboard*` ignores in `eslint.config.js` are web-terminal leftovers

File: `eslint.config.js:12-13` (`"test-clipboard*.mjs"`, `"test-clipboard*.sh"`).

These two lines were added by `bba13165 feat: implement DirectTerminal with XDA clipboard support (#55)`.
That commit built the web terminal: it says "Fixes clipboard functionality in web terminal", and it adds
`packages/web/server/direct-terminal-ws.ts`. No file matches either pattern (`ls test-clipboard*` finds
nothing, and `git log --all -- 'test-clipboard*'` finds no commit that ever tracked one). So the entries
are scratch-file ignores for the removed web terminal. They match nothing.

The author did not remove them. The brief said to remove "the entries that exist only for the removed
dashboard package `packages/web` and its build" and listed five lines and one block. These two lines are in
the same list but not in the brief's list, and the brief's D3 grep has no `clipboard` word, so the check
passes while the lines stay.

Impact: none at run time. Fix: delete lines 12-13. `pnpm lint` stays the same.

### m-2 (minor): the `scripts/**/*.js` override block in `eslint.config.js` matches no file

File: `eslint.config.js:77-91` (the block "Scripts directory - Node.js environment").

The block was added by `eaea131a` in the same commit that added `scripts/rebuild-node-pty.js`. That file
is the only `.js` or `.mjs` file that `scripts/` ever had (`git log --all -- 'scripts/*.js'` lists only
`eaea131a`, `59971029` and `397b7dd1`). Its header says it "rebuilds node-pty ... fixes DirectTerminal
posix_spawnp failed errors": node-pty is the web terminal's PTY. The trim `397b7dd1` deleted it.
`ls scripts` shows no `.js` or `.mjs` file now. The block gives Node globals and `no-console: off` to
files that do not exist.

Impact: none at run time. The block is generic and harmless, so the owner may keep it for future scripts.
Fix: delete lines 77-91 (and the blank line before them). Keep the next block (`packages/ao/bin/**/*.js`,
lines 93-105): `packages/ao/bin/ao.js` exists and matches.

### m-3 (minor): the new step 6 has no comment line

File: `tests/integration/onboarding-test.sh:89`.

Steps 1 to 5 each have a `# Step N: ...` comment line before `start_step` (lines 40, 45, 52, 60, 81).
The new step 6 starts straight with `start_step`. The old step 6 had `# Step 6: Start orchestrator (in
background)`. This is style only. Fix: add `# Step 6: ao reads the test configuration` above line 89.

### Notes (no action in these commits)

**n-1: `.eslintignore` is dead and holds web entries.** `.eslintignore:10` (`packages/*/dist-server/`) and
`:23-25` (`packages/web/.next/`, `packages/web/next-env.d.ts`). ESLint 10 does not read this file. Every
lint run prints `ESLintIgnoreWarning: The ".eslintignore" file is no longer supported`. `.prettierignore:3`
(`.next/`) is the same kind of leftover, but `ci.yml` runs no Prettier step. Both files are outside the two
allowed files, and `.gitignore` and friends are not CI. Fix, if the owner wants it: one `chore:` commit
that deletes `.eslintignore`.

**n-2: step 6 depends on one flag meaning two things.** In `runStartup`, `shouldStartLifecycle` is
`opts?.orchestrator !== false` (`start.ts:877`). So `--no-orchestrator` also skips the lifecycle worker.
Today that is why the step is a pure configuration check. If a later change splits the two, this step
starts a lifecycle worker in the container. The step is then easy to find, because it fails or hangs
visibly in CI. No action now.

**n-3: the steps of round 1 that stay open on purpose.** The `$GITHUB_OUTPUT` branch (script lines
107-109 now), the empty log upload (`onboarding-test.yml:48-55`), the obsolete compose `version` key, the
`paths` triggers and the missing green baseline are not changed. The round-2 brief puts them out of scope.
They are not dashboard-related.

## 3. Review items

### Item 1: the new step 6 (path audit of `ao start --no-orchestrator`)

New lines (`onboarding-test.sh:89-91`):

```bash
start_step "Step 6: Load configuration with ao"
ao start --no-orchestrator || fail_step "Step 6: ao start --no-orchestrator failed"
end_step "Step 6: Configuration loaded by ao"
```

It is synchronous: no `&`, no `curl`, no wait loop, no `kill`. With `set -e`, the `||` list means a
nonzero exit of `ao` calls `fail_step`, which prints the error and runs `exit 1`. So a nonzero exit fails
the job. The shell is still in `/tmp/ao-test-project` after step 4 (step 5 does not `cd`), so the config
search from the working directory finds the file.

The path, from my own read of `packages/cli/src/commands/start.ts` and `packages/core/src/config.ts`:

1. `program.ts` registers the commands. No I/O. The same import graph loads for `ao --version` in step 3,
   which passed in the container.
2. The action. `projectArg` is empty, so the URL branch (`start.ts:1013`) and the path branch (`:1019`)
   are skipped. The `else` branch runs `loadConfig()` at `:1068`.
3. `loadConfig` (`config.ts:717`): walk up from the working directory with `existsSync`
   (`AO_CONFIG_PATH` is not set in the container), `readFileSync`, `parseYaml`, `validateConfig`.
   `validateConfig` is pure: the Zod parse, `expandPaths`, `applyProjectDefaults` (name, session prefix,
   `scm` and `tracker` set to `{ plugin: "github" }`, no plugin load), `applyDefaultReactions`,
   `collectExternalPluginConfigs` (finds none: no `package` or `path` key), `validateProjectUniqueness`.
   No spawn, no network, no file write.
4. `resolveProject(config, undefined)` (`:1078`): one project, so it returns at `:93-95`. The prompt
   (`:106-121`) is only for several projects with no match.
5. `opts?.interactive` is unset, so the agent prompt is skipped (`:1082`).
6. `runStartup(config, "test-project", project, { orchestrator: false })`:
   - `config.defaults?.runtime ?? "tmux"` gives `tmux`, so `ensureTmux()` runs (`:873`, body `:833-855`).
     This is the **only external command on the path**: `execFile("tmux", ["-V"])` through `execSilent`
     (`shell.ts:24`, no shell). `tmux -V` prints the version and starts no server. The image has tmux
     (`Dockerfile:7`, and `[ok] tmux 3.3a` in the log).
   - If tmux were missing: `askYesNo("Install tmux now?", true, false)` returns `false` without a prompt,
     because `canPromptForInstall()` is `isHumanCaller() && IS_TTY` (`:156-158`, `:201-206`) and
     `docker compose up` gives no TTY. The code then prints the install hints and runs `process.exit(1)`.
     So the failure is a clean nonzero exit, not a hang.
   - `shouldStartLifecycle` is `false` (`:877`): `ensureLifecycleWorker` is skipped (`:888-905`).
   - The orchestrator block is skipped (`:909`): no `getSessionManager`, no `sm.list`, no
     `spawnOrchestrator`, no tmux session, no agent launch.
   - It prints the summary (`:967`, `:984`) and returns.
7. No handle stays open. Node exits with code 0. The only `process.exit(1)` calls on the path are in the
   action's `catch` (`:1105`, after it prints `Error:`) and in `ensureTmux`.

Can it block, prompt, start a long-running process, a server, an install or a `gh` call? **No.** Every
other external call in `start.ts` sits in code that this path does not reach: `git --version` (`:308`,
`:316`), `npm` (`:361`, `:409-427`), `gh` (`:492-495`, `:678`), `git clone` and `git` (`:508`, `:515`,
`:723`, `:730`). Those belong to the URL start, the config auto-create and the install prompts.

Can it exit nonzero on a good config? Not on this config. The run in the old log is the proof. In run
`38771289585` the same command ran in this image with the same config plus `port: 9000`. The log shows
`Starting orchestrator for test-project`, `✓ Startup complete` and `Config:
/tmp/ao-test-project/agent-orchestrator.yaml`. It shows no `Error:` and no tmux hint. The process was gone
less than one second later. Every failing path prints before it exits, so the exit code was 0. The one
change since then is the missing `port` line, and the schema default covers it (`config.ts:252`,
`port: z.number().default(3000)`).

The step 4 configuration names no agent. Does it matter? **No, not on this path.** `defaults.agent` takes
the schema default `claude-code` and `project.agent` is empty. Nothing on the path reads either. The agent
is read only by the session manager, the lifecycle worker and the plugin registry, and the path loads none
of them. The `claude` binary is not in the image (`WARNING: Claude CLI is not installed` in the step 2 log),
and that does not matter for the same reason. It would matter for a step that spawns a session.

Comparison with the author's D5 list. I agree with every point, and the line numbers match (`:93-95`,
`:873`, `:877`, `:909`, `:967`, `:984`, `:1068`, `:1082`, `:1105`). The author gives `:888-904` for the
skipped worker block. The closing brace is at `:905`. That is a one-line difference with no effect. The author says that the tmux install is
not tried in CI because `askYesNo` returns `false`. I checked it in code (`:156-158`, `:201-206`) and it is
right. I add three facts: the post-processing in `validateConfig` is pure, a missing tmux ends in
`exit(1)` and not in a hang, and the old log is a direct run of the same command in the same image.

### Item 2: `port: 9000`

Gone. `git diff ebc8e25b HEAD -- tests/integration/onboarding-test.sh` shows one deleted line in step 4
(`-port: 9000`). The `diff` of the two files, with that one line filtered out of the old file, is empty
for lines 1-88. Nothing else in step 4 changed. `dataDir` and `worktreeDir` stay. The schema strips these
two keys because it does not know them, and they do no harm.

### Item 3: `eslint.config.js`

The 13 deletions are: `**/dist-server/**`, `**/.next/**`, `packages/web/next-env.d.ts`,
`packages/web/next.config.js`, `packages/web/postcss.config.mjs` and the "Relaxed rules for Next.js
pages/components" block (`files: ["packages/web/**/*.tsx", "packages/web/**/*.ts"]`).

Every removed entry matched nothing:

- `packages/web` does not exist. `ls packages` shows `ao cli core integration-tests plugins`, and
  `git ls-files packages/web` is empty.
- No package produces `dist-server` or `.next`. `grep` over every `package.json`, `tsconfig*.json` and
  `*.config.*` under `packages/` and the root finds no `dist-server`, no `.next`, no `next` dependency and
  no `next build|dev|start` script. The author notes `packages/cli/src/lib/project-detection.ts:50`. I read
  it: it tests whether a user project depends on `next`. It builds nothing.
- `pnpm lint` has the same result before and after (section 1).

No other dashboard-only entry is left? **Two are left**: m-1 (`test-clipboard*`, lines 12-13) and m-2 (the
`scripts/**/*.js` block, lines 77-91). The `packages/ao/bin/**/*.js` block matches `ao.js`, and the other
blocks are generic. Both findings are minor and have no effect.

### Item 4: any dashboard-related CI left

Searched `.github/`, `tests/`, `eslint.config.js`, `scripts/setup.sh`, `scripts/ao-doctor.sh` and
`scripts/try-pr.sh` (the only script that a workflow runs is `scripts/setup.sh`, through the onboarding
job) for `dashboard`, `websocket`, `14800`, `14801`, `9000`, `3000`, `browser`, `playwright`, `Next.js`,
`next dev|build|start`, `packages/web`, `ao-web`, `terminal-web`, `node-pty`, `xterm`, `clipboard`,
`dist-server`, `.next`, `shm_size` and `ports:`.

The only hits are `eslint.config.js:12-13` (m-1). `.github/workflows/*.yml` and `tests/integration/*`
have none. `eslint.config.js:77-91` has no keyword hit but is a leftover (m-2). `.eslintignore` and
`.prettierignore` are n-1: not read by CI. `.gitignore` is out of scope.

### Item 5: scope and commits

Only `tests/integration/onboarding-test.sh` and `eslint.config.js` changed. The two commits are
`test(integration): ...` and `chore(lint): ...`, as the brief asks, and each body gives the WHY. The
`test(integration)` body states the correction of the round-1 brief (the command is not a dashboard start).
No `Co-Authored-By`, no emoji, no issue number. `git branch -r --contains 353ef189` prints nothing.

## 4. Recommendation

Land `b6d85710` and `353ef189` as they are. The job should pass on the next run, and now it checks that the
built `ao` reads the test configuration. The first live run on `main` is the real check of step 6 (no Docker
here). If the owner wants the lint config fully clean, one more `chore(lint)` commit removes m-1 and m-2
and can add m-3 in the script. These are cosmetic.
