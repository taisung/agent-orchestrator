# TODO Tracking

Durable progress record for this fork. Dated events only; the current state lives in
[HANDOVER.md](HANDOVER.md). The plan is `0005_personal_fork_scope_and_trim_plan.md` §6 (Phases -1 to 6).

## Milestones and Progress

- 2026-08-11 — Phase -1 usage inventory recorded (`0006`). Retained-distribution trim executed as one
  commit `397b7dd1` (`0007`), ahead of Phases 0-4, on the operator's redirect.
- 2026-09-16 — two review rounds on `397b7dd1` fixed and merged into
  `fix/backport-upstream-activity-metadata` (`0008` §9-§10). Full suite: 1809 passed / 20 skipped / 0 failed.
- 2026-09-23 — `main` fast-forwarded `7441e1f8..112558b4` and pushed to `fork`. This closes `0007` §6 item 5.
- Remaining scope in `0005` §6, none started as of 2026-09-23 (checked against `ao session --help` and
  `ao spawn --help`):
  - Phase 0 — explicit lifecycle / agent / runtime / notification / archive profile decisions.
  - Phase 1 — reduced-distribution gate, CLI help snapshots, retirement report.
  - Phase 2 — spawn correctness: task-file spawn, `--branch`, `--base`, partial-workspace cleanup, batch manifest.
    Only `--model` exists today.
  - Phase 3 — runtime-agnostic supervision: `ao session output`, structured send results, Herdr preflight.
  - Phase 4 — `ao session integrate` / `ao session finish` with integration receipts.
  - Phase 6 — rewrite the `ao-*` skills (in `~/agent-skills`) against the new commands.
  - `0007` §6 conditional decisions 1-4 and 6 (GitHub lifecycle, desktop notifier, Gemini, archive policy,
    historical synthetic roots).
- 2026-10-14 to 2026-10-15 — the OpenCode 2.x arc (`0009`, `0010`), coordinated by the agent-skills
  orchestrator: the 2.x plugin fix, I-6 and I-1 landed and live (What Landed). On 2026-10-15 the work
  moved to this repo's own orchestrator session, with a profile in `~/agent-skills`.
- 2026-10-15 — `main` pushed to `origin` on the owner's word, a fast-forward from `273b62c1` (35 commits
  plus the commit that records the push): the 2.x plugin fix, I-6, I-1 and the docs. No I-2 or PATH
  round commit was on `main`. The old working-tree deletion of `test-ao-config2.yaml` was not committed.

## What Landed

- `397b7dd1` (2026-08-11) — trim to the retained headless profile: twelve package trees and the dashboard /
  web-terminal / openclaw / marketplace surfaces removed (`0007` §2-§3).
- `4ec45f5c`, `d9e34adf`, `44443972`, `4e920326`, `3e8ebff3` (2026-09-16, nex-2088) — review round 1:
  clean-checkout build, reject unavailable workspace plugin, `AO_STATE_ROOT` propagation, helper allowlist.
  Suite 1798 -> 1803 passed.
- `fc36b57c`, `e4dedce2`, `954e3997` (2026-09-16, nex-2090) — review round 2: `WRAPPER_VERSION` bump,
  Gemini uses the shared metadata helper, lifecycle worker receives `AO_STATE_ROOT`. Suite 1809 passed.
- 2026-09-23 — `main` = `fork/main` = `112558b4`. Rebuilt in place (`pnpm install && pnpm build`, all
  packages passed); `ao --version` 0.2.2, `ao doctor` tmux PASS.
- 2026-09-23 — branches deleted, local and on `fork`: `fix/backport-upstream-activity-metadata`,
  `feat/spawn-model-flag`, `feat/opencode-gemini-plugins`, `fix/397b7dd1-followups-r2-pre-rewrite`.
  Only `main` remains on both sides.
- `b90ac08f`, `6d204435`, `8ae92e83` (2026-10-14, ao-1, Claude Opus 5.5; dispatched by the agent-skills
  orchestrator) — the OpenCode plugin starts sessions on OpenCode 2.x as well as 1.x. OpenCode 2.0.29 (on
  this host from 2026-10-14 16:22 EDT) refuses `opencode run --command`, so every `ao spawn --agent opencode`
  left a bash pane while `ao spawn` reported success. The pane reads `opencode --version`. On 2.x it creates
  the session with `opencode api session.create`, reads its model and agent back with `session.get`, and
  opens the TUI only when they equal the request. A create that fails or gives no usable id stops with
  exit 1 and no title lookup. Resume and restore change settings with `session.switchModel` and
  `session.switchAgent`, and exit 1 on a failed switch or readback. The 1.x commands are byte-identical.
  `detect()` runs `opencode --version`. Blind review by ao-2 (Codex gpt-6.1-sol): round 1 NOT-LAND-SAFE (M-1,
  m-1), round 2 NOT-LAND-SAFE (B-1, M-2, m-2, all by injected faults), round 3 LAND-SAFE with 0 findings;
  `development/reviews/ao_opencode2_r{1,2,3}_review_codex_sol61.md`. Plugin tests 148 passed; full suite 1860
  passed / 20 skipped (author). `main` fast-forwarded `273b62c1..8ae92e83`; the landed tree equals the
  reviewed tree. Not pushed. Rebuilt in place on the owner's word (D-3), 2026-10-14 21:11 EDT: `pnpm install`
  and `pnpm build`, all 12 packages `Done`; `ao --version` 0.2.2. A live `ao spawn --agent opencode` probe from
  the agent-skills config opened the TUI on `AO:as-63` and answered `OK`. On 2.x the TUI submits the launch
  prompt (1.x did not). All five running `ao lifecycle-worker` processes were restarted on the owner's word at
  21:24-21:26 EDT by exact PID with their old environment and cwd; all report health `ok`. `ao doctor` prints `FAIL launcher entrypoint is missing`: `scripts/ao-doctor.sh:264` checks
  `packages/agent-orchestrator/bin/ao.js`, which `4fcdc674` removed; the check is stale, not the build. The
  owner keeps the host on OpenCode 2.x; a later arc drops the 1.x branch, moves `ao send`,
  activity and cost to `opencode api`, and fixes the `ao start` install (`npm install -g opencode-ai` has no
  2.x release). That arc is tracked in `~/agent-skills/development/TODO_TRACKING.md`, Known Issues.
- `2ef9c3a3` (2026-10-14, ao-1) — `development/0009_opencode_2x_api_fit_design.md`, the design of the
  OpenCode 2.x API fit (increments I-1 to I-7); review section 17 and the owner's answers in section 18
  (`96db1f72`, `64cd3750`, `439c16fb`).
- `d8c666b1`, `41562abb` (2026-10-14, ao-6, Muse; increment I-6 of 0009) — `ao start` installs OpenCode
  with `npm install -g @opencode/cli`, and adds `--force` with a one-line notice when npm `opencode-ai` is
  installed globally (read-only `npm ls -g opencode-ai --depth=0 --json`). The package name has one
  source. `.github/workflows/integration-tests.yml` installs `@opencode/cli`. Review: round 1 LAND-SAFE by
  V4.1 Flash (3 minors) and by Sonnet 5.5 (M-1: no test reached the call site; 5 call-site mutants
  survived); round 2 added call-site tests that kill all 5, re-check LAND-SAFE (m-7: watch the first CI
  run with secrets, its live OpenCode block now meets 2.0.29; m-8: one test comment). Left open: a timeout
  on `npm ls` (needs `lib/shell.ts`), the export surface, the picker hint. `ao-cli` tests 243 passed.
  Reviews `development/reviews/i6_review_r{1,2}_*.md`. Fast-forward, tree equal to the reviewed tree.
  Not pushed. Rebuilt in place on the owner's word (D-3), 2026-10-14 23:30 EDT, at `20af1efa` (I-6 and
  docs only; I-1 is not on `main`): all 12 packages `Done`; the built `resolveOpenCodeInstall()` returns
  `npm install -g @opencode/cli` with no notice on this host (`npm ls -g opencode-ai` exit 1); the plugin
  `dist` is unchanged. I-6 is not used by the lifecycle workers, so they were not restarted.
- `e6e6f7c9`, `5a313fa1` (round 1, ao-5, Muse) and `a310ae17`, `51f006ff`, `2e71ecf6`, `d52f6ca3`,
  `6abab58d` (round 2, ao-1, Claude Opus 5.5) (2026-10-15; increment I-1 of 0009) — the OpenCode plugin
  drops the 1.x branch and needs OpenCode 2.0.29 or later (owner Q9). `detect()` hides an older or
  missing OpenCode; an explicit spawn or restore fails with a message that names the reason (owner Q6).
  The version probe runs in Node, stops after 10 s, and keeps its stderr off the terminal. Core: a
  refused orchestrator launch now cleans up its worktree, metadata and prompt file, as a refused worker
  spawn does; `restore()` builds the restore command before it destroys the old runtime, so a refused
  restore keeps the old pane (checked against the claude-code, codex, gemini and opencode plugins). The
  integration launch tests run against a fake 2.0.29, so CI needs no OpenCode. Review: round 1
  NOT-LAND-SAFE by Sonnet 5.5 and by V4.1 Flash (B-1: 14 integration tests needed a host OpenCode;
  M-1: the orchestrator-launch leak; M-2: no probe timeout); R7 moved round 2 to Opus; round 2
  LAND-SAFE by V4.1 Flash and by Muse, 3 minors each. Open minors: a restore with a hanging binary
  waits about 40 s (the older `findOpenCodeSession` timeout is 30 s; I-2 removes it); a refused binary
  with no stored session ID fails in core discovery with a message that does not name the version; a
  refused spawn leaves its branch; the lifecycle worker can mark a reserved ID `killed` during the
  10 s probe (seen 1 of 2 runs); the refusal message omits the probe's stderr. Author suite: 1890
  passed, 20 skipped. Reviews `development/reviews/i1_review_r{1,2}_*.md`. Cherry-picked onto
  `3e161305`; the tree equals the reviewed `39549455` except this file. Not pushed. Rebuilt in place on
  the owner's word (D-3), 2026-10-15 10:19 EDT, at `57c9ff04`: all 12 packages `Done`; the built
  plugin's `detect()` returns `true` in 104 ms on OpenCode 2.0.29, and its launch command is the 2.x
  `opencode api session.create` form (built in Node, no session created). The five `ao lifecycle-worker`
  processes were restarted on the owner's word at 10:20:25-10:20:38 EDT by exact PID with their old
  environment and cwd: agent-skills 3544066, this fork 3544115, the Nexus-config `agent-orchestrator`
  3545801, Nexus 3546224, VSF 3546244; each PID file holds the new PID, and all five still ran after
  more than two 30 s poll intervals with no new error line in their logs.

- `ebc8e25b` (2026-10-15, ao-20, Muse; on the owner's ask "Clean up any dashboard-related CI") - the
  onboarding CI test no longer starts or polls the removed dashboard: steps 6 to 10 of
  `tests/integration/onboarding-test.sh` (dashboard start and API, WebSocket health, terminal page, the
  kills, two of them `pkill -f`) and the compose `ports` and `shm_size` are gone; steps 1 to 5 are
  byte-identical. Review: round 1 LAND-SAFE by V4.1 Flash (3 minors) and by Sonnet 5.5 (M-1: the old
  step 6 ran `ao start --no-orchestrator`, which loads the test config and exits 0, so it was the job's
  only config-load check and not a dashboard start, a brief error; m-1 the dead `port: 9000`; m-2 dead
  `packages/web` entries in `eslint.config.js`). Reviews `development/reviews/ci_nodash_review_r1_*.md`.
  Cherry-picked; the tree equals the reviewed `0a81e224` outside `development/`.
- `c9a7ed93`, `19d99667` (2026-10-15, ao-20, round 2 of the CI cleanup) - the onboarding test gets a
  synchronous step 6, `ao start --no-orchestrator || fail_step ...`, so the job again checks that the
  built `ao` loads the test config (the author's audit of that path: one external command, `tmux -V`;
  no lifecycle worker, server, `gh`, `npm` or install); `port: 9000` is gone; `eslint.config.js` loses
  the five dead `packages/web`, `.next` and `dist-server` ignores and the Next.js rule block (`pnpm lint`
  0 errors, 6 warnings before and after). Re-check LAND-SAFE by Sonnet 5.5 (3 minors: the
  `test-clipboard*` ignores and the `scripts/**/*.js` block are web-terminal leftovers, step 6 has no
  comment line) and by V4.1 Flash (2 minors: dead web entries in `.eslintignore`, which ESLint 10 no
  longer reads; a blank heredoc line). Reviews `development/reviews/ci_nodash_review_r2_*.md`.
  Cherry-picked; the tree equals the reviewed `353ef189` outside `development/`. Not pushed. No build:
  CI and lint files only. The first CI run on `main` after a push is the live check of step 6.

## Decisions

**D-1 — `main` is the canonical integration branch** (2026-09-23): the fork's work had lived on
`fix/backport-upstream-activity-metadata`, 30 commits ahead of `main` with `main` 0 ahead, so a fast-forward
needed no merge commit. This answers the `0005` Phase -1 item "select the canonical integration branch".

**D-2 — `fix/397b7dd1-followups-r2-pre-rewrite` discarded, not merged** (2026-09-23): it was the pre-rewrite
copy of round 2 (`3ca79ef5`..`73548990`). Rewritten versions landed as `fc36b57c`, `e4dedce2`, `954e3997`. Its
only differences were an older `typeof import(...)` style in two test files and a missing 14-line `0008`
addendum.

**D-3 — no worker builds in the primary checkout** (2026-09-16, `0008` §9): the global `ao` is a link to
`packages/cli/dist/index.js` in `/home/taisung/local/agent-orchestrator`. A worker builds and tests in its own
worktree with `AO_STATE_ROOT` under `/tmp` and an isolated `tmux -L` server. Only the orchestrator rebuilds
the primary checkout, and only on the owner's word.

**D-4 — no worker reads the OpenCode service password** (owner, 2026-10-15: "Keep the M-3 password
closed for now"). The event-stream part of M-3 (0010) stays unmeasured, so the Q3 choice in 0009
section 18 stays open, and I-4 polls with `opencode api`, which adds the auth itself. Recorded as D-34
in `~/agent-skills/development/TODO_TRACKING.md`.

## Known Issues

- **A reviewer stopped the host's default tmux server** (2026-10-15 11:41:47 EDT). The I-2 reviewer
  ao-16 (Sonnet 5.5) ran `TMUX_TMPDIR=/tmp/ao16-sonnet-it tmux new-session -d -s probe && ... &&
  TMUX_TMPDIR=/tmp/ao16-sonnet-it tmux kill-server` in its own pane shell. That shell had `TMUX` set,
  and with `TMUX` set and no `-L` or `-S`, tmux uses the socket in `TMUX` and ignores `TMUX_TMPDIR`
  (checked read-only: `TMUX_TMPDIR=/tmp/socktest-none tmux display-message -p '#{socket_path}'` printed
  `/tmp/tmux-44402/default`). Every session on the default server ended: this fork's ao-1 and ao-14 to
  ao-18, both orchestrators, and the other fleets, Nexus included. The brief (line 90) said `tmux -L
  <unique-name>`. Ruled out: ao-18 ran no tmux command from 11:39 to 11:43; the ao-15 and ao-17
  OpenCode sessions were idle from 11:23:25 and 11:34:24; the repository tests have no `kill-server`;
  as-orchestrator ruled out as-64. Not touched: `scripts/fleet_watch.sh` and `tests/test_fleet_watch.sh`
  of agent-skills. Rule for every brief from now: each tmux command uses `-L <unique-name>` and runs
  with `TMUX` removed (`env -u TMUX`). Lifecycle workers, the watcher, and the private tmux servers of
  ao-16 and ao-18 survived. On the owner's word, ao-18 was restored at 11:49 and ao-16 at 11:56, each
  with a `.agent_resume.md` that names the cause and the rule; ao-16's model is pinned in its worktree
  `.claude/settings.local.json`.
- **"The integration package with `opencode` present" makes model turns on the global OpenCode
  service** (found 2026-10-15 by the I-2 reviewer ao-16, m-6). The live block of
  `packages/integration-tests/src/agent-opencode.integration.test.ts` runs `opencode run 'Say hello'`
  when `~/.local/share/opencode/auth.json` exists, and it does on this host. A read-only
  `session.list` of the global store shows 10 sessions titled like "Greeting request", created
  11:06:44 to 11:21:01 in `/tmp` and `/tmp/ao-inttest-opencode-*`: two per run, five runs, during the
  work of ao-14 and ao-15 (the two at 11:20-11:21 come after ao-14 finished, so ao-15 ran at least
  those). The briefs asked for that run, so the workers kept their brief; the brief broke the rule
  "global service read-only, no model turn". The sessions stay in the global store (owner,
  2026-10-15: leave them). Rule for every brief from now: run the integration package with a fake `HOME`, so the
  live block skips. Earlier arcs (I-1, I-6) asked for the same run and are not checked.
- **A full `pnpm test` in a worker pane leaks into the real state** (found 2026-10-15 by ao-1, I-2 round
  2). Run at 16:46:57Z with the real `HOME` and the worker's `AO_*` variables, it made two more model
  turns on the global OpenCode service (`ses_ebf89d5bcffe2gNXDKbG5frCqF`, `ses_ebf89c1e5ffeFjai3ZvtCwBo5F`,
  "Greeting request", 16:47:28Z and 16:47:33Z) and wrote 49 test directories into the real
  `/home/taisung/.agent-orchestrator`, because the core and CLI tests use `AO_STATE_ROOT` from the
  environment when it is set. ao-1 also matched an earlier global pair (2026-10-14 23:53:42Z and
  23:53:44Z) to its I-1 full run. Other test directories were born at 12:41:58, 12:42:44, 12:43:34 and
  12:50:01 local by another run, not attributed. None of it was removed. Rule for every brief from now:
  every `pnpm test`, not only the integration package, runs with a fake `HOME` and with every `AO_*`
  variable removed. A test-isolation fix (tests that ignore an inherited `AO_STATE_ROOT`) is a worker
  follow-up.
- **`ao session restore` drops the spawn `--model` of a Claude Code session** (found 2026-10-15). The
  claude-code `getRestoreCommand` adds `--model` only from `project.agentConfig.model`, and the session
  metadata stores no model, so a session spawned with `--model claude-sonnet-5-5` restores on the host
  default (`opus`). This breaks `CLAUDE.md` C-04. Follow-up for a worker (restore path, HIGH). Do not fix
  a worker's model with `/model`: on 2026-10-15 at 11:51 `/model claude-opus-5-5` on ao-18 also rewrote
  `~/.claude/settings.json` (`"opus"` to `"claude-opus-5-5"`); the orchestrator put back `"opus"` at once.
- **Two GitHub workflows fail on every push to `main`** (seen on the push of 2026-10-15, `70d19d70`).
  CI, Integration Tests and Security passed. **Onboarding Integration Test** waits for a dashboard
  ("Waiting for dashboard to start..." then "Dashboard process died"); the headless trim removed the
  dashboard, and the workflow has failed on every run since 2026-07-13. **Release** runs
  `changesets/action` with `publish: pnpm release`; with no pending changeset it tries to publish every
  `@aoagents/*` package and fails with `ENEEDAUTH`, because the repository has no secrets (no
  `NPM_TOKEN`), so nothing was published. If a token is ever added, the fork would publish under the
  upstream scope. Both need a workflow change (`.github/workflows/`, an owner decision). With no
  secrets, the live OpenCode block of Integration Tests skips, so I-6 m-7 stays open.
- **A rebuild does not reach running lifecycle workers.** Node loads `dist` at process start. On 2026-09-23
  after the rebuild, five `ao lifecycle-worker` processes still ran pre-rebuild code: `Coding-Orchestrator`
  (pid 57829), `Nexus` (60414), `my-project` (1770808), `FleetMonitor` (2303231), `agent-skills` (3054071).
  Restarting them affects live fleets in other projects.
- **No `ao` project and no profile for this repository** (closed 2026-10-15). The root
  `agent-orchestrator.yaml` (gitignored, `.gitignore:61`) holds the project `agent-orchestrator`
  (prefix `ao`, tmux prefix `60756641ca25`); the OpenCode 2.x arc ran its workers under it from
  2026-10-14. The owner added `orchestratorWorkspaceMode: project` on 2026-10-15: without it, `ao start`
  made the orchestrator in a worktree at the old `origin/main` (`ao-orchestrator-2`). The profile is
  `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`.
- **A second `agent-orchestrator` entry in `/Data1/NgFEP/Nexus/agent-orchestrator.yaml`**, with the same
  path and `sessionPrefix: ao`, a different tmux prefix (`6513108c38cb`) and state, its own lifecycle
  worker, and the `ao start` default rule "Always run tests before pushing." An `ao` call that loads the
  Nexus config sees a different `ao-N` numbering. Pin `AO_CONFIG_PATH` to this repo's config.
- **Trailer policy not written down here.** 17 of the 30 commits merged on 2026-09-23 carry
  `Co-Authored-By: Claude`. `~/agent-skills` and Nexus forbid the trailer (owner, 2026-09-17); this repo has no
  rule. Since 2026-10-14 every brief and every orchestrator commit here carries none (0 of the commits of
  the OpenCode 2.x arc); the owner has not ruled for this repo.
- **Orphan stash**: `stash@{0}: WIP on feat/opencode-gemini-plugins: 5e2a783` — that branch no longer exists.
  Not inspected, not dropped.
- **State root size**: `~/.agent-orchestrator` held 1,275 entries on 2026-09-23. `0007` counted 1,174 historical
  synthetic roots on 2026-08-11; their cleanup needs separate authorization (`0007` §6 item 6).
