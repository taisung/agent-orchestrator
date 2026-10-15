# CI no-dashboard review, round 1: remove the dashboard parts of the onboarding CI test

Range: `git diff 5ad7e1ce 0a81e224` (one commit, two files). Reviewer: Sonnet 5.5. Date: 2026-10-15.
Worktree HEAD: `0a81e224 ci(integration): remove dashboard steps from onboarding test`.
Author: ao-20 (Muse). Risk: LOW (CI and test files only).

**Verdict: LAND-SAFE**

Finding counts: 0 blockers, 1 major, 2 minor, 4 notes.

Scale used here: B = the commit breaks something or is unsafe to land. M = the commit does what the owner
asked, but a verified gap lets a regression pass. m = polish or dead config with no effect. n = a fact
for the owner, no action in this commit. The commit removes only dashboard, web-terminal and browser
parts. The reduced job should pass on the next push (section 3). The major finding (M-1) is a loss of
coverage that the brief itself caused. It is a follow-up, not a reason to hold the commit.

## 1. Commands that I ran (read-only, in my worktree)

No Docker on this host, so I did not run the container. I did not run `onboarding-test.sh`,
`run-test.sh`, `scripts/setup.sh` or any installer. No tmux command. No `pnpm test`.

| Check | Result |
|---|---|
| `git diff --stat 5ad7e1ce 0a81e224` | 2 files: `docker-compose.yml` 9 deletions, `onboarding-test.sh` 101 deletions. 0 insertions. |
| Steps 1 to 5: `diff` of lines 1-89, old against new | `IDENTICAL`. The only hunk is `@@ -87,107 +87,6 @@`: it starts after the `end_step "Step 5..."` line. |
| `bash -n tests/integration/onboarding-test.sh` | exit 0 |
| `shellcheck` | not installed on this host. By reading: the removal adds no new warning. |
| YAML parse, `python3 -I` + PyYAML `safe_load` | `docker-compose.yml` and `onboarding-test.yml` both parse to a dict |
| D3 grep `dashboard\|websocket\|14800\|14801\|9000\|browser` in `.github/ tests/` | one hit: `tests/integration/onboarding-test.sh:71:port: 9000` (see m-1) |
| Summary tail: lines 1-38 and 90-108 copied to a scratch file, run with `env -i` and a scratch `HOME` | exit 0, prints `Total onboarding time: 3s`, the `GITHUB_ACTIONS` branch is skipped. This is a copy of the tail only. It does not run steps 1 to 5. |
| `git diff --stat 70d19d70 0a81e224 -- packages scripts pnpm-lock.yaml package.json` | empty: the source that run `38771289585` built is the source of the next run |
| `git branch -r --contains 0a81e224` | prints nothing. `git branch --contains` shows only the three `feat/ci...` worktree branches, not `main`. |
| Commit message | no trailer, no emoji, no issue number. Subject is 59 characters. The body gives the WHY. |

## 2. Findings

### M-1 (major): the removed step 6 was the only step that ran `ao` on the test configuration

Files: `tests/integration/onboarding-test.sh` (old lines 90-112, removed), step 5 at lines 82-88.
Source: `packages/cli/src/commands/start.ts:877`, `:909`, `:967`, `:1068`.

The brief and the author report call step 6 a "dashboard" start. In the headless fork it is not. In
`runStartup`, `ao start --no-orchestrator` sets `shouldStartLifecycle = false` (line 877) and skips the
orchestrator block (line 909). It starts no server. It loads the config (line 1068), resolves the
project, checks that tmux exists, prints a summary, and returns. The only `process.exit(1)` on this
path is in the `catch` block (line 1105), so a run that reaches the summary exits with code 0.

The CI log of run `38771289585` shows exactly this. After `Waiting for dashboard to start...` the log
prints `Starting orchestrator for test-project`, `✓ Startup complete` and `Config:
/tmp/ao-test-project/agent-orchestrator.yaml`. About 0.8 s later the loop finds that the process is
gone and prints `Dashboard process died`. The process did not die. It finished. So the step failed
for a reason that is not a dashboard bug, and the dashboard polls in it were the only dashboard part.

What the removal costs. Step 6 was the only place where the built `ao` read the file that step 4
writes (`loadConfig`, the Zod schema, `resolveProject`). Step 5 only runs `[ ! -f agent-orchestrator.yaml ]`
on a file that step 4 just wrote, so it cannot fail. After this commit the job checks `setup.sh` and
`ao --version` and nothing else. A break in config loading on a fresh install does not turn the job red.

Is it covered elsewhere? In part. `packages/cli/__tests__/commands/start.test.ts:304-600` tests project
resolution through `ao start --no-orchestrator`, but with mocks, in the `ci.yml` test job. I searched
`packages/integration-tests/src`: no test runs `ao start` or `loadConfig`. No CI job runs the built
binary on a config.

Steps 7, 8 and 9 did not check anything that the headless fork ships. Step 9 created a tmux session and
a metadata file, but it asserted nothing about them: the tmux call ends in `|| true` and the only
assertion was `curl` on the dashboard page. The metadata path `/tmp/ao-test-data/test-project-orchestrator`
is not the hashed layout that `CLAUDE.md` documents. tmux presence is already checked by `setup.sh` (log line
`[ok] tmux 3.3a`). Step 10 only stopped the dashboard.

Fix (follow-up, owner's decision; it adds a step, which the author brief forbade). Put a synchronous
step where step 6 was: no `&`, no `curl`, no wait loop, no `kill`:

```bash
# Step 6: ao reads the test configuration
start_step "Step 6: Load configuration with ao"
ao start --no-orchestrator || fail_step "Step 6: ao start --no-orchestrator failed"
end_step "Step 6: Configuration loaded by ao"
```

The shell is still in `/tmp/ao-test-project` after step 4, so `loadConfig()` finds the file. The log
shows that this command reaches `Startup complete` in the container, and the code path then returns
with exit code 0. The `gh` CLI is not logged in there, and the command does not call it. I did not run
this step: there is no Docker here and the rules forbid the script.

### m-1 (minor): `port: 9000` in the step 4 configuration is a dead dashboard setting

File: `tests/integration/onboarding-test.sh:71`.

`port` is a legacy dashboard key. `packages/core/src/config.ts:252` keeps `port: z.number().default(3000)`
and `packages/core/src/types.ts:1016-1017` marks the field `@deprecated Legacy dashboard setting; ignored
by the headless distribution.` I searched all non-test source in `packages/`: the only two hits are those
two definition lines. Nothing reads `config.port`. The value 9000 is the port that old step 6 polled.
After this commit nothing in the job reads the file, so the line has no effect at all. It is exactly
what the owner's ask ("Clean up any dashboard-related CI") covers.

The author kept it because the brief said "keep steps 1 to 5 unchanged". The author followed the brief.
The brief rule was too wide here. Impact: none at run time. The Zod schema accepts any number, and
`OrchestratorConfigSchema` is not `.strict()`. If the line goes away, the default 3000 applies, which is
ignored too.

Fix: delete line 71 (`port: 9000`) from the heredoc. Step 4 is the only place that changes. After
that, the D3 grep prints nothing.

### m-2 (minor): dashboard entries remain in the lint config that `ci.yml` runs

Files: `eslint.config.js:10` (`**/dist-server/**`), `:12` (`**/.next/**`), `:14-16`
(`packages/web/next-env.d.ts`, `next.config.js`, `postcss.config.mjs`), `:82-88` (the block "Relaxed
rules for Next.js pages/components" for `packages/web/**`). `ci.yml:25` runs `pnpm lint`, which reads
this file. The same applies to `.gitignore:5` (`.next/`), `:10` (`packages/web/screenshots/`) and `:58`
(`packages/web/agent-orchestrator.yaml`).

`packages/web` does not exist (`ls packages` shows `ao cli core integration-tests plugins`), so every
one of these entries matches nothing. No effect on any job.

These files are outside the five files that the author brief allows. Fix: one `chore:` commit with its
own scope. Remove the five ignore lines and the override block in `eslint.config.js`, and the three
`.gitignore` lines. Run `pnpm lint` after.

### Notes (no action in this commit)

**n-1: the log upload never has files.** `.github/workflows/onboarding-test.yml:48-55` uploads
`tests/integration/*.log` on failure. No step and no script writes a `*.log` file there, and the
removed dashboard steps did not write one either (step 6 did not redirect output). In runs
`38771254497` and `35874500765` the upload step shows `success`, and the GitHub API lists 0 artifacts
for both runs. This is old and
not dashboard-related. The failure output is already in the `Run onboarding test` step.

**n-2: the `paths` triggers.** `onboarding-test.yml:5-9` lists `packages/**`, `scripts/setup.sh`,
`tests/integration/**` and the workflow file. They still make sense: `setup.sh` still builds all
packages and the job still runs it. Gap that is not new: a pull request that changes only `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml` or `tsconfig.base.json` does not start the job, but `setup.sh`
reads all four. The `push` to `main` has no filter, so every push runs it, including `docs(development)`
pushes. The "Extract metrics" step (lines 37-41) still works. The container is named by
`container_name: ao-onboarding-test` in the compose file, `docker logs` reads a stopped container, and
the `Total onboarding time` line is printed at script line 100.

**n-3: two old dead spots in the script.** Lines 104-106 write to `$GITHUB_OUTPUT` when `$GITHUB_ACTIONS`
is set. `docker-compose.yml:10-12` passes only `NODE_ENV` and `CI`, so the branch never runs in the
container. If it ran, an empty `$GITHUB_OUTPUT` fails under `set -e` (I tested: `bash: line 1: : No
such file or directory`, exit 1). Also the comment at line 84 says `ao init`. Neither is dashboard-related.

**n-4: the brief's facts.** The brief says the job "failed on every run since 2026-07-13". The run list
shows 8 runs, all `failure`, the first on 2026-05-15 (runs `25933483387`, `25933534768`), which is
before the trim `397b7dd1` of 2026-08-11. So the job has never been green in the visible history, and
the logs of the runs before 2026-10-15 are not readable (`HTTP 410` or empty), so I cannot say which
step failed in them. Also the commit message says the script "started ao as a dashboard". M-1 shows
that is not what the command did. This is a wording point only. I do not ask for an amend.

## 3. Review items

**Item 1: only dashboard parts were removed?** Yes for every removed line, with one qualification (M-1).

| Removed | Dashboard, web terminal or browser only? |
|---|---|
| Step 6: `DASHBOARD_PID`, 30 s wait loop, `curl localhost:9000`, `Dashboard not responding` | The loop and the `curl` are dashboard-only. The command inside, `ao start --no-orchestrator`, ships in the fork (M-1). |
| Step 7: `/api/sessions` and `/api/events` | Dashboard only. |
| Step 8: port 14801 `/health` | Web terminal only. |
| Step 9: tmux session, metadata file, `curl /sessions/...` | The only assertion is the dashboard page. The tmux and metadata lines assert nothing. |
| Step 10: `kill $DASHBOARD_PID`, `kill -9`, `pkill -f "node.*next.*dev"`, `pkill -f "tsx.*terminal"` | Dashboard and Next.js only. The removal also drops two kill-by-name commands. |
| Compose `ports` block (9000, 14800, 14801) with its comments | Dashboard and web terminal only. |
| Compose `shm_size: 2gb` ("browser-based tests (future)") | Browser only. |

`Dockerfile` and `run-test.sh` hold no dashboard line. The author is right to leave them. `curl` in the
`Dockerfile` is still needed for the `gh` keyring (line 16). `tmux` is still needed by `setup.sh`.

**Item 2: steps 1 to 5 and the result. Will the reduced job pass on the next push? Yes, with low risk.**

1. Run `38771289585` (and the run before it, `38771254497`) print `✓` for steps 1 to 5. They fail only at
   `✗ Step 6: Dashboard process died`.
2. No code in `packages/`, `scripts/` or the lockfile changed between that run and `0a81e224`. The next
   run builds the same source.
3. Steps 1 to 5 are byte-identical. After step 5 the script runs only `date` arithmetic and `echo`. With
   `set -e` nothing there can fail. I ran that tail alone: exit 0, and it prints the line that the
   workflow greps.
4. `docker compose up --abort-on-container-exit --exit-code-from onboarding-test` then returns 0. The
   metrics step finds the line. `docker compose down -v` runs.

Risks:

- I did not run the container. There is no Docker here. The claim rests on the log and on reading.
- The image build and step 2 use the network (`apt`, `cli.github.com`, the npm registry, Docker Hub).
  All of them worked on 2026-10-15. A network fault can still turn the job red. The `npm install -g pnpm`
  in `Dockerfile:13` is not pinned, but `package.json` pins `pnpm@9.15.4` and the log shows `pnpm 9.15.4`.
- No known-green baseline exists (n-4).
- The job stays green even if `ao` cannot read its config (M-1).

**Item 3: `port: 9000`.** See m-1. Severity minor. Fix: delete line 71.

**Item 4: any other dashboard-related CI.** Searched: `.github/`, `tests/`, `scripts/`, root
`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.changeset/config.json`, `eslint.config.js`,
`.gitignore`, `.husky`, `packages/integration-tests`.

| Where | What | Action |
|---|---|---|
| `tests/integration/onboarding-test.sh:71` | `port: 9000` | m-1 |
| `eslint.config.js:10,12,14-16,82-88`; `.gitignore:5,10,58` | `packages/web`, `.next`, `dist-server` entries | m-2 |
| `.github/workflows/ci.yml`, `coverage.yml`, `integration-tests.yml`, `release.yml`, `security.yml` | no dashboard, web, Next.js, Playwright or port reference | none |
| root `package.json` scripts | `build lint typecheck test test:integration release ...`: no dashboard script | none |
| `pnpm-workspace.yaml`, `.changeset/config.json` | list only retained packages | none |
| `pnpm-lock.yaml` | 14 importers, none from a removed package. `@vitest/browser-playwright` (lines 2174, 2190) is an optional peer of `vitest`, not a leftover. | none |
| `scripts/` | hits are the words "next": `setup.sh:167`, `claude-integrator-session:10`, `claude-spawn-on-branch:40` | none |
| `packages/integration-tests/src/metadata-lifecycle.integration.test.ts:51,67,303-333` | `dashboardPort`. It runs in `integration-tests.yml:55`. It tests a field that core still has (`metadata.ts:98,148`, `types.ts:1395`). | none now. Remove it together with the core field, in a runtime change. |

Not CI, so outside the owner's ask and outside the five allowed files: the hidden `--no-dashboard` option
(`packages/cli/src/commands/start.ts:997`, passed by `start.test.ts:311,332,352,371,385`), the
deprecated `port`, `terminalPort`, `directTerminalPort` keys (`config.ts:252-254`, `types.ts:1016-1023`),
`DASHBOARD_FIXES_SUMMARY.md` and `test-ao-config.yaml:3` (`port: 3000`) in the repository root.

**Item 5: the workflow file.** Unchanged and still sound. The `paths` triggers, the metrics step and
the log upload are covered in n-1 and n-2. `timeout-minutes: 15` is now far above the run time (the
container ran 20 s in run `38771289585`, from 16:43:43 to 16:44:03). That is harmless.

**Item 6: scope and commit.** Only the two allowed files. Conventional subject `ci(integration): ...`.
The body gives the WHY (the fork is headless since `397b7dd1`, the job failed at step 6). No
`Co-Authored-By`, no emoji, no issue number. The diff has no added line. `git branch -r --contains
0a81e224` prints nothing.

## 4. Recommendation

Land `0a81e224` as it is. It turns a job that failed at step 6 into one that should pass, and it removes
no check that the fork needs for the dashboard. Then, in this order, as the owner decides:

1. M-1 plus m-1 in one small commit on the same two files: restore a synchronous `ao start
   --no-orchestrator` step and delete `port: 9000`.
2. m-2 in a separate `chore:` commit.
