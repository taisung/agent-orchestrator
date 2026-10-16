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

- `5884f9ad..9f06dc25` (2026-10-15, the `~/.ao/bin` PATH fix, 13 commits) - Codex, Gemini and OpenCode
  panes get the ao `git` and `gh` wrappers on their PATH (the tmux client now carries the built PATH, so
  no typed `export PATH` and no `/usr/local/bin` promotion); the wrappers write only true values (the
  real HEAD branch of the session's own worktree, `pr=` and `pr_open` on a recognised PR URL, never
  `merged`) and guard against recursion by file identity; Claude Code keeps its own hook only (owner
  decision M-4 a): its launches remove every inherited ao wrapper directory (physical resolution, every
  `*/.ao/bin` reserved for ao) and every relative PATH entry, and set an empty `GH_PATH`. Authors: Muse
  ao-15 (round 1), Opus 5.5 ao-19 (rounds 2 to 4). Reviews: ao-18 Opus r1, ao-23 sol-6-1 r2 to r4
  (`development/reviews/aobin_path_review_r{1..4}_*.md`); r4 LAND-SAFE under the owner's stop rule.
  Cherry-picked; the fix files equal the reviewed `608b2b6b`. Pushed at 19:44 EDT. **Live** since the
  rebuild at 19:43 EDT and the lifecycle-worker restarts at 19:43 (no `ao` spawn, start or restore was
  in flight). The owner text is in the r4 review, section "Owner text audit and corrected text".
  Known limits: a user-made chain of nine or more dangling symlinks to a future wrapper directory
  survives the filter; shell startup files can add the wrappers or a relative entry back inside a pane
  (this host's startup adds `.`); the Claude hook's quoted-branch and direct-merge limits remain; Herdr
  is not measured.

- `f63b5b99..6d2e8262` (2026-10-15, I-2 of note `0009`, 9 commits) - one OpenCode API helper (`execFile`
  with an args array, a bound on every call, a cut answer never parsed), lookup, reuse, remove and
  interrupt by the stored ID only (owner Q7), a spawn-time discovery wait with exact title, real
  directory and created-time filters, a host-wide launch lock per real directory and title in
  `/tmp/ao-opencode-launch-<uid>` (owner, mode 0700 and no symlink checked), a pending marker that clears
  only on evidence (an explicit tmux negative for the recorded earlier pane on its recorded socket, then
  a finished create since `startedAt` or a 25 s age), a liveness guard for shared IDs whatever the
  holder's status, and restore refusals that keep the old pane. Authors: Muse ao-14 (r1), Opus 5.5 ao-1
  (r2), astra ao-25, ao-27, ao-28 (r3 to r5, owner-named under R3). Reviews: Sonnet 5.5 ao-16 and V4.1
  Flash ao-17 (r1), sol-6-1 ao-24 (r2), Opus 5.5 ao-26 (r3 to r5) (`development/reviews/i2_review_*.md`);
  r5 LAND-SAFE under the owner's stop rule. Cherry-picked; the I-2 files equal the reviewed `bfa5af45`
  except the 3 PATH-fix exports in `packages/core/src/index.ts`; ao-26 built and tested that combined
  state. Pushed at 19:44 EDT. **Live** since the same rebuild and restarts.
  Known limits: a marker whose tmux server exited with its last session needs the printed `rm -r`, and
  the failure line for an uncertain `send-keys` failure then wrongly promises recovery (r5 m-8,
  availability only); Herdr markers and markers without a socket need the manual path; another tmux
  server that answers still counts as proof of death for the holder guard; every creator of the same
  title and directory must use the protocol (an old build or a manual create can bypass the lock, but
  can no longer settle a marker while the earlier pane lives); I-3 (Node-side create) removes the title
  evidence at the root.

- `14bb4670` (2026-10-15, ao-31, Muse; owner word "delete release.yml") - `ci: remove the npm release
  workflow`: `.github/workflows/release.yml` is gone, so a push no longer tries to publish the upstream
  `@aoagents` packages. Receipts checked by the orchestrator (python/L0/LOW): only that file deleted, the
  five other workflows parse. Kept on purpose: the `release` and `version-packages` scripts in
  `package.json` (`:23-24`, `pnpm -r build && changeset publish` can still be run by hand) and `.changeset/`.
  Pushed at 21:10 EDT: the push started no Release run.

- `854690c3` (2026-10-15, ao-30, Muse; owner word "go ahead with the restore model fix") - `fix(core):
  keep the spawn --model through restore`, the code of the reviewed `781a3a6e`. `ao spawn --model X` now
  writes `model=X` into the session metadata, and every later operation on a worker (restore, the restore
  before `send`, the archive restore, the fallback launch) uses it before the config. `Agent.getRestoreCommand`
  takes an optional third argument, the effective model, and all four plugins use it first; Codex order:
  effective model, then config, then the model in Codex's own session data. An orchestrator stores no
  model. Blind review by Opus 5.5 (ao-32, `development/reviews/restore_model_review_r1_opus.md`):
  **LAND-SAFE**, 0 B, 0 M, 3 m, 5 notes, live checks on Claude Code (`--resume` path) and Codex.
  **Behaviour change (m-1, correct, not stated in the commit):** a session spawned without `--model` now
  restores on the role-scoped model (`worker.agentConfig.model`, or the orchestrator keys) that its spawn
  used, not on the shared `agentConfig.model`. Open minors: m-1 has no worker-role test; m-2 the new
  lines are not in Prettier style (CI has no format check); m-3 one restore-before-send assertion checks
  a literal of its own mock. **Live** since the owner's rebuild of the primary checkout on 2026-10-15 at
  21:09 EDT and the lifecycle-worker restarts at 21:09:24 to 21:09:37. Sessions spawned before the rebuild have no `model=` line and still restore
  on the config model (N-3): add the line to the session file by hand before such a restore. Pushed at
  21:10 EDT (`c831caff..972f13ef`, with `14bb4670`): CI, Integration Tests, Security and Onboarding passed,
  and no Release run started.

- `458786e6` (2026-10-15, ao-30, Muse; owner word "go ahead with the restore follow-ups") - `fix(core): use
  the spawn permission mode on restore`, the code of the reviewed `6088fc6b`. Restore passed the raw
  project config to `getRestoreCommand`, so (a) a worker with `worker.agentConfig.permissions: default`
  under a shared `permissionless` restored WITH `--dangerously-skip-permissions` (Claude Code; also the
  Codex approval flags and Gemini `--yolo`), and (b) an orchestrator restored without its forced
  `permissionless` mode. Core now passes the role-merged `agentConfig` of the restore launch config (no
  interface change). Also m-1 (role-model test), m-2 (format of the new hunks), m-3 (the mock assertion).
  Blind review r2 by Opus 5.5 (ao-32, `development/reviews/restore_model_review_r2_opus.md`): **LAND-SAFE**,
  N-2 and m-1 to m-3 fixed, 0 B, 1 M, 3 m, 4 notes; cases (a) and (b) shown live against the base for
  Claude Code, Codex and Gemini. M-1 (no test guards the Claude Code restore flag: two mutants survive),
  m-4 (JSDoc) and m-5 (copied mapping) are closed by `120f500a` (round 3, ao-30; receipts only):
  `test(agent-claude-code): guard the restore permission flag` adds 4 real-output restore tests (both
  mutants of the review now fail 2 tests each), one JSDoc sentence in `types.ts`, and one core mock style.
  The orchestrator re-ran the tests under a fake `HOME`: claude-code 174 of 174, the core restore files 13
  of 13, typecheck exit 0. **Live** since the owner's rebuild on 2026-10-15 at 22:39 EDT and the
  lifecycle-worker restarts at 22:39:55 to 22:40:08. Pushed at 22:40 EDT (`9b77bdac..d013e400`): CI,
  Integration Tests, Security and Onboarding passed.

- `5b488fdb` (2026-10-15, ao-30, Muse; owner "option 1" for N-1 and m-6) - `fix(core): store the spawn
  model and permission mode of every worker`, the code of the reviewed `cfb64f67`. Spawn of a worker
  stores `model=` (the effective model, when defined) and `permissions=` (the effective mode; `default` for
  a config object with no mode); every later operation on a worker uses them before the current config,
  through `resolveSelectionForSession`; a malformed stored mode maps to `default`; orchestrators store
  nothing; records without the keys follow the config. Blind review r3 by Opus 5.5 (ao-32,
  `development/reviews/restore_model_review_r3_opus.md`): **LAND-SAFE**, m-6 fixed, N-1 partly fixed, 0 B,
  1 M, 4 m, 5 notes; live on Claude Code and Codex in both directions, on the archive and active paths.
  M-2 (no test guards the archive copy-back of `permissions=`), m-7 (the fail-safe `default` is not the
  strictest mode for Codex: `suggest` adds `--ask-for-approval untrusted`) and m-8 (comments describe a
  "no mode" case that a YAML config never has) are closed by `25a56f30` (`fix(core): fail safe to suggest for
  a malformed stored mode`, ao-30): a damaged stored mode now gives `suggest`, which is byte-identical to
  `default` for Claude Code, Gemini and OpenCode and adds `--ask-for-approval untrusted` for Codex; the
  "no mode" value stays `default`. Re-check r4 by Opus 5.5 (`restore_model_review_r4_opus.md`):
  **LAND-SAFE**, M-2 and m-7 fixed, m-8 partly fixed, 0 B, 0 M. Open cosmetic minors: m-11 (the new Codex
  test repeats `index.test.ts:1285-1305`), m-12 (the test name at `restore-permissions.test.ts:258` says the
  loader "always sets permissionless"). N-15: a Codex worker with a damaged record now waits for approval
  (`waiting_input`). Live since the rebuild of 2026-10-16 at 07:54 EDT; pushed `19f027c2..c8bccfb2`.

- `5cbe84b3` (2026-10-16, ao-33, Muse; owner "fix m-10") - `fix(core): limit metadata helper to wrapper
  keys to block privilege escalation`, the code of the reviewed `63567df0`. `update_ao_metadata` in
  `~/.ao/bin/ao-metadata-helper.sh` takes only `pr`, `status pr_open` and `branch`; any other key or value
  writes nothing, prints one stderr line and returns 1; the Claude hook's `update_metadata_key` gets the
  same limit plus `status merged` (its own old `gh pr merge` write); the AGENTS.md text drops the generic
  call; `WRAPPER_VERSION` 0.2.4. Blind review by Opus 5.5 (ao-32,
  `development/reviews/helper_keys_review_r1_opus.md`): **LAND-SAFE**, m-10 fixed for the documented path
  (live: a restore after the refused calls keeps the stored mode; the base raises it), 0 B, 1 M, 2 m, 8
  notes. **M-3, rollout condition:** a resident process with the 0.2.3 code (the five lifecycle workers)
  installs the old helper again on its next automatic restore, so after the rebuild restart them, then
  check `cat ~/.ao/bin/.ao-version` (0.2.4, after the next Codex, Gemini or OpenCode spawn or restore) and
  `grep -c refusing ~/.ao/bin/ao-metadata-helper.sh` (2). N-17: an agent with shell access can still write
  the record file directly. **Live and pushed** (owner, 2026-10-16: "rebuild now, then push"): `pnpm build`
  at 07:54 EDT (exit 0); the five lifecycle workers restarted by exact PID at 07:54:55 to 07:55:08
  (agent-skills 3432870, agent-orchestrator 3433219 for the Nexus config and 3434840 for this config,
  Nexus 3433850, VSF 3434817); pushed `19f027c2..c8bccfb2` (CI, Integration Tests, Security and Onboarding
  passed). M-3 check passed: the ao-34 spawn at 08:00:42 installed `.ao-version` 0.2.4, and the helper
  holds 2 `refusing` lines.

- `0ec55a64` (2026-10-16, ao-34, Muse; owner "fix m-13") - `fix(core): validate stored branch names before
  git to block option injection`, the code of the reviewed `bb81cf7a` (same `packages/` tree). One core rule
  `isSafeBranchName` (git `check-ref-format --branch` without the `@{-N}` expansion, plus a leading `-` and
  the name `@` refused) and `isSafePrUrl`; gates before any `git` call at spawn, orchestrator spawn,
  `claim-pr` and restore, and in the worktree plugin `create` and `restore` (plus `--` in 5
  `git worktree add` calls); `branch` and `pr` value checks in the helper and the Claude hook;
  `WRAPPER_VERSION` 0.2.5. Blind review by Opus 5.5 (ao-32,
  `development/reviews/branch_check_review_r1_opus.md`): **LAND-SAFE**, m-13 fixed (live: restore refuses
  `-Bvictim` and other option values, `victim` keeps its commit, the base resets it), 0 B, 0 M, 3 m, 9
  notes. **Rollout condition (M-3 again):** until the five lifecycle workers restart on the new build, their
  restore path has no gate, and their installs write the 0.2.4 helper over 0.2.5. **Live and pushed**
  (owner, 2026-10-16: "roll out now"): `pnpm build` at 10:45 EDT (exit 0, 12 Done); the five lifecycle
  workers restarted by exact PID at 10:45:11 to 10:45:24 (agent-skills 1218013, agent-orchestrator 1218338
  for the Nexus config and 1219143 for this config, Nexus 1218695, VSF 1218968); pushed
  `c8bccfb2..ac0f662a`. M-3 check passed: the ao-35 spawn at 10:46:44 installed `.ao-version` 0.2.5, and
  the helper holds 4 `refusing` lines.

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

- **I-3 and I-4 in progress** (owner, 2026-10-16: "go ahead with priority 2"). Dispatched at 13:08 EDT,
  meter `5h 0%`, `wk 33%`, both on `15757aae`, router rows open, watcher PID 107999.
  - **I-3** (create in Node, launch check, no title discovery; python L1 HIGH): author ao-36, Opus 5.5 by
    the owner's choice (the router default was Muse; the I-2 precedent needed 5 rounds). Reviewer:
    gpt-6.1-sol (Codex), the cross-family lens for an Opus author at HIGH. Brief
    `~/.cache/agent-skills-haiku55-arc/brief-aofork-i3-create.md`. Owner decisions: remove the I-2 launch
    lock, its pending marker and `waitForOpenCodeSession`; the model check runs before the create
    (`model.list`). **Landing gate:** the tool-environment check (0010 §14 item 3, one model turn in an
    API-only session) is deferred by the owner; I-3 does not land until it runs or the owner accepts the
    risk. The good path with a real TUI also needs an owner-approved probe. ao-36 finished `ad5daa51` at
    14:05 EDT (3 commits, 13 files: hooks `prepareAgentSession` and `confirmLaunch`, create and readback
    in Node with the pane environment, model check on `providerID` plus `id`, lock and title discovery
    removed; full suite 2228 passed, 29 skipped; live (a) to (d) in an isolated store; 15 mutants fail
    tests). Its D3 base run wrote 7 markers and 2 leases into the real lock directory
    `/tmp/ao-opencode-launch-44402` (all named its own vitest PID) and removed them; the orchestrator
    checked that the directory is empty. It also ran `npx tsc` once (removed). Author open items: the
    double warning on `promptDelivered=false` (`cli/src/commands/spawn.ts:132-138`), a stale comment in
    `getRestoreCommand`, two cut `model.list` answers fail the spawn (fail-closed). First-poll `killed`
    race: I-3 shortens it but does not remove it (needs `lifecycle-manager.ts`). Blind review r1
    dispatched at 14:07 EDT to ao-40 (gpt-6.1-sol, xhigh; Codex weekly 80% left): brief
    `brief-review-i3-r1-sol.md`, review file `i3_review_r1_sol61.md`, watcher PID 1378201.
    **Review r1** (`development/reviews/i3_review_r1_sol61.md`, about 1.41 USD): NOT-LAND-SAFE. B-1 the
    pre-pane record publishes the ID before the pane exists, so the shared-ID guard calls the holder dead
    and a concurrent issue spawn with the `delete` strategy removes the first spawn's new session (live
    reproducer); M-1 the launch check accepts `bash -c sleep 60 opencode --session <id>`; M-2 an old
    `user` message confirms a new prompt on a reused session; m-1 the reuse resolver and the delete path
    still use the caller's environment; m-2 two cut `model.list` answers fail the spawn; m-3 the double
    warning; m-4 the stale restore comment. The reviewer rates the old first-poll `killed` race major
    (I-3 lengthens the window before the pane exists). **Owner (2026-10-16): the race is a separate item
    after I-3.** **Round 2** dispatched to ao-36 at 14:31 EDT: brief `brief-aofork-i3-r2.md` (launcher
    PID plus start time as ownership evidence that does not depend on `status`, executable identity from
    structured process data, a `user` message baseline for a reused session, the pane environment for the
    resolver, `model.list` through a file, one warning in `cli/src/commands/spawn.ts`, the comment fix).
  - **I-4** (activity, cost and session info from the API; python L1 MEDIUM): author ao-37, Muse.
    Reviewers: Sonnet 5.5 and V4.1 Flash. Brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i4-activity.md`.
    New code in `agent-opencode/src/api-activity.ts`; no core change. Owner decision: a long tool call
    shows `active` for its whole length (no cap; a stall rule belongs to I-7). ao-37 finished `09c77de0`
    at 13:24 EDT (4 plugin files; full suite 2282 passed, 29 skipped; its mutants fail tests; isolated
    store 2.0.31, no model turn; cleanup checked by the orchestrator). Blind review r1 dispatched at
    13:32 EDT (meter `5h 2%`, `wk 34%`): ao-38 (Sonnet 5.5) and ao-39 (V4.1 Flash), worktrees moved to
    `09c77de0`, brief `~/.cache/agent-skills-haiku55-arc/brief-review-i4-r1.md`, review files
    `i4_review_r1_{sonnet,v4flash}.md`, a real 2.0.31 idle pane in `i4_real_panes/`, watcher PID 628202.
    The host OpenCode is now v2.0.31 (the global service restarted at 12:16:17, not by a worker of this
    fleet); the measurements of 0010 are of 2.0.29. ao-36 saw a non-blocking hook error after a `cd` into
    a package: `/bin/sh: 1: .claude/metadata-updater.sh: not found` (the Claude hook path is relative).
    **Review r1** (`development/reviews/i4_review_r1_{sonnet,v4flash}.md`): Sonnet NOT-LAND-SAFE (B-1,
    M-1, m-1 to m-5, N-1 to N-4; 6.75 USD), V4.1 Flash LAND-SAFE with M-1 and M-2 (0.10 USD). Both found
    the same defect: the pane classifier matches its markers anywhere in the capture, so unsent input-box
    text flips an idle pane to `active` or `waiting_input` (live on 2.0.31; then `ao send` refuses to
    send). Both found the same test gaps (permission before `session.active`, parallel calls, failed
    message read; Sonnet: 14 of 36 mutants live, among them another ID in `session.active`). Schemas
    used by I-4 are byte-identical in 2.0.29 and 2.0.31. **Round 2** dispatched to ao-37 at 14:05 EDT:
    brief `brief-aofork-i4-r2.md` (status-row classifier, the test gaps, `message.list` with
    `type=user order=desc limit=1`, remove `findOpenCodeSession`, N-1 to N-3); real 2.0.31 panes in
    `i4_real_panes/`; the same two lenses re-check. **Kept out of round 2:** m-1 Sonnet (9 `opencode api`
    processes per session and poll, not 4; a shared `session.active` per tick needs a core change);
    m-5 (an API `blocked` never decays; one `stuck` and one notification, no loop; owner to decide);
    m-4 Sonnet (the `ao send` delivery check can now fail on a fast reply; for I-5); N-4 (a 1.x pane).
  - Both edit `agent-opencode/src/index.ts` in different functions; the second cherry-pick may need a
    worker rebase.
- **The `ao spawn` base prompt tells workers to push and open a PR** (2026-10-16). ao-35 (m-15 to m-17)
  pushed `feat/branchcheck2-muse-read-agent-task-md-in-your-worktree-and-ex` (`7f34bf4d`) to `origin` and
  opened PR #2 at 11:16 EDT, although its brief needed `git branch -r --contains HEAD` to print nothing.
  ao-34 had reported the same conflict one round earlier and did not push. The PR CI passed except
  Dependency Review ("not supported on this repository": the Dependency graph setting is off). The
  orchestrator told ao-35 at once to stop all push and PR work. On the owner's word PR #2 was closed and the
  remote branch deleted at 11:31 EDT; `7f34bf4d` stays local. Every author brief must forbid push and PR work in section 0 and say that this overrides the
  spawn prompt.

- **Minors of the m-13 review** (2026-10-16, ao-32, `branch_check_review_r1_opus.md`). **m-15 to m-17
  landed on `main` as `cd39ea9d`** (cherry-pick of `7f34bf4d`, ao-35 Muse, owner 2026-10-16: "fix m-15 to
  m-17"; `WRAPPER_VERSION` 0.2.6). **Live** on the owner's word (2026-10-16: build, restart, push): the
  primary checkout was rebuilt at 12:12 EDT, and the five lifecycle workers were restarted by exact PID at
  12:13 EDT (now 3215891, 3215991, 3216043, 3216103, 3216178), because of M-3: a resident 0.2.5 process
  writes 0.2.5 back, and it writes the 0.2.5 Claude hook into every workspace it restores (the hook file
  has no version check). `main` pushed. **Open:** `cat ~/.ao/bin/.ao-version` shows 0.2.5 until the next
  Codex, Gemini or OpenCode spawn; check that it shows 0.2.6 then. Blind review r2 by
  Opus 5.5 (ao-32, `development/reviews/branch_check_review_r2_opus.md`, 8.42 USD): **LAND-SAFE**, m-15,
  m-16 and m-17 fixed live and by tests, 0 B, 0 M. The worker gate now sits inside
  `if (plugins.workspace)`, but a spawn with no workspace plugin throws at `session-manager.ts:1211-1219`
  before the reservation, so no unchecked branch is stored. **Open:** **m-18** (not new; r1 missed it) the
  bash `pr` checks (`agent-workspace-hooks.ts:250-252`, `agent-claude-code/src/index.ts:139-141`) and both
  `pr` extracts (helper `:433`, hook `:224`) still depend on the locale: their bracket ranges follow the
  collation order, so under `en_US.UTF-8` (the host `LANG`) they accept 4,225 table URLs that
  `isSafePrUrl` refuses; live, the `gh` wrapper stores `pr=…/pull/7١` and core reads PR #7 (low: the value
  reaches only `gh` read calls). N-34 the hook branch extract stops at U+2028 and U+2029; N-35 no test
  checks that the locale change stays inside the function (a mutant without `local` passes); N-36 the hook
  locale test uses 13 fixed names, not the shared table; N-37 no `LANG`-only test case; N-38 count
  correction (213 code points). N-27 to N-29 below stay open. Text of the round-1 minors: **m-15** (new in `0ec55a64`) a spawn that the new gate refuses (for example `ao spawn x.lock`,
  free-text branch `feat/x.lock`) leaves an empty reserved session record, shown as `[spawning]` in
  `ao session ls`; the gate at `session-manager.ts:1275` throws before the `try` whose `catch` deletes the
  reservation. **m-16** the bash copies of the rule use `[[:cntrl:]]`, which in a UTF-8 locale also matches
  34 non-ASCII code points (U+0080 to U+009F, U+2028, U+2029) that git and the TypeScript rule accept; the
  wrapper then does not record such a real branch (exit code unchanged). **m-17** the hook `pr` end
  anchor has no test (mutant survives). Notes: N-27 the new error texts print the stored value raw (an
  escape sequence reaches the terminal; suggest `JSON.stringify`); N-28 core still reads `pr` with the
  unanchored `parsePrFromUrl` and does not compare it with `project.repo` (read-only effect); N-29 a
  refused value ends the Claude hook with exit 1 and no JSON (a non-blocking hook error).

- **A worker's direct `node` script wrote into the real state root** (2026-10-16, ao-34, m-13 D2). The
  brief said to use a scratch `AO_STATE_ROOT` and never to write a real session record, but the script
  called the session manager without it and left `~/.agent-orchestrator/e91fe6412cc5-repo/sessions/demo-2`
  (`branch=-Bvictim`, `project=demo`) at 08:21:42. Its report said its `/tmp` state was removed. The
  orchestrator found it with the new branch rule, checked that nothing else in the state root was new,
  and removed the three paths by literal path. Briefs now ask for an empty
  `find ~/.agent-orchestrator -maxdepth 1 -newer <marker>` at the end.

- **Fixed by `0ec55a64`, live since 2026-10-16 10:45: a stored `branch` value reaches `git worktree add` as an option at restore** (2026-10-16, helper review
  m-13; old, the same on the base). The helper and the Claude hook check only the key, so `branch=-Bvictim`
  is stored; restore runs `git worktree add <path> -Bvictim` (`packages/plugins/workspace-worktree/src/index.ts:276`,
  no `--`), and git resets the free branch `victim` (live: it lost its own commit, which stays in the
  reflog). The orchestrator process runs that git command, outside the agent sandbox. Suggested fix: refuse
  a `branch` value that `git check-ref-format --branch` refuses or that starts with `-`, in the helper, the
  hook and restore. The `pr` value has no check either. **In progress** (owner, 2026-10-16: "fix m-13"):
  author ao-34 (Muse), brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-branch-check.md` (one core
  branch-name rule, gates in restore and the worktree plugin, value checks in the helper and the hook,
  `WRAPPER_VERSION` 0.2.5). ao-34 finished `bb81cf7a` (11 files); the blind review by Opus 5.5 (ao-32)
  runs. Its landing needs one more rebuild and restart
  (M-3: a 0.2.4 process puts its own helper back).
- **`~/agent-skills/skills/ao-lifecycle/SKILL.md:854-860` documents the generic `update_ao_metadata <key>
  <value>` call** (helper review m-14). After `5cbe84b3` only `pr`, `status pr_open` and `branch` work, and
  other calls fail loudly. That text belongs to `as-orchestrator`. On the owner's word a note went to
  `as-orchestrator` on 2026-10-16 at about 07:56 EDT.

- **Owner decisions from review r3 of option 1** (2026-10-15, ao-32; decided by the owner on 2026-10-15:
  "keep the default, accept m-9, fix m-10"). The YAML `permissionless` default stays. m-9 is accepted as a
  known limit. m-10 goes to ao-33. (1) m-9: a worker spawned with no
  model in any config and no `--model` stores no `model=`, so a later config model reaches its restore;
  option: treat a record with `permissions=` but no `model=` as "spawned with no model" and drop the
  config model on restore. (2) m-10: the documented metadata helper `update_ao_metadata <key> <value>`
  (`packages/core/src/agent-workspace-hooks.ts:240-241`, AGENTS.md text `:465-477`) accepts any key, so an
  agent can raise its own restore mode with `permissions permissionless` (live, Codex), as it already
  could with `role orchestrator` (r2 N-8); option: limit the helper to `pr`, `status`, `branch` and drop
  the generic call from AGENTS.md. (3) m-8: a YAML project with no `permissions` key runs its workers
  `permissionless`, because `AgentPermissionSchema` defaults to it (`packages/core/src/config.ts:132-135`).

- **Workers leave `ao spawn` lifecycle workers running** (2026-10-15, review r2 N-6). `ao spawn` starts a
  detached `ao lifecycle-worker`; ao-30's live runs left four (2919552, 2953478, 3670285, 3674356), with
  their scratch HOME and state removed and a PATH that reaches the real `/usr/bin/tmux` and `/usr/bin/gh`.
  The orchestrator checked and stopped them by exact PID at 21:58. Briefs now say: stop the PID in
  `<state root>/<hash>-<project>/lifecycle-worker.pid` before the tmux server, and quote an empty
  process list. Protocol text for as-orchestrator.

- **Restore follow-ups from the reviews of `854690c3` and `458786e6`** (2026-10-15, ao-32). N-2 is fixed by
  `458786e6`. m-6 (r2), decided with N-1 by the owner on 2026-10-15 ("option 1": store the spawn model and permission
  mode of every worker at spawn; a worker follow-up): the permission mode is not stored at
  spawn, so a config edit after the spawn changes it on restore (live: `worker` changed to
  `permissionless` after the spawn, and the restore added the skip flag). N-1, an owner decision: a
  session spawned without `--model` still restores on the config model of restore time, also when Codex
  recorded another one; to close it, store the effective model of every worker at spawn, but then a
  config edit no longer reaches existing sessions. N-2, worker follow-up: the restore commands read
  `permissions` from the raw `project.agentConfig`, not from the role-merged selection that spawn uses
  (`agent-claude-code/src/index.ts:879`, `agent-codex/src/index.ts:653`, `agent-gemini/src/index.ts:251`).
  N-7: the third argument now always equals `project.agentConfig.model`. N-5: an external agent plugin with the two-argument `getRestoreCommand` still type-checks and keeps the
  config model. Process note N-4: ao-30 used `git stash` for its base check, and the stash stack is
  shared by all worktrees; the stack still holds only the old `feat/opencode-gemini-plugins` entry.

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
- **The first lifecycle poll can mark a just-spawned session `killed`** (found 2026-10-15 by ao-1, rated
  major and pre-existing by sol-6-1 in the I-2 round-2 review). The first poll can move a session from
  `spawning` to `killed` before its pane starts the agent; some return to `working` on the next poll,
  some stay `killed` with a live pane. Seen on the I-2 build and on `3b2bb918`. A running agent with a
  terminal status also defeats any guard that reads the status as proof of a dead pane (I-2 round-2
  M-1). Seen live on the new build on 2026-10-15 at 19:58: ao-29 (OpenCode) was `killed`
  within a minute of its spawn and stayed so while its pane ran. Because `isRestorable()` treats `killed` as
  terminal, an `ao send` to such a session restores it first (a pane relaunch). Lifecycle worker follow-up.
- **A private tmux server started from a worker shell gives its panes the real `HOME`** (found
  2026-10-15 by ao-26 in the I-2 round-5 re-check, its own isolation breach). With only `TMUX` removed,
  the new server's global environment held the reviewer's real `HOME`, so the panes' login shells put the
  real `opencode` first on `PATH`; two panes made model turns on the GLOBAL OpenCode service
  (`ses_ebe4c58ecffexfEl81wt8iCk4y`, `ses_ebe4c1ae5ffeUF3dHbjY63ravQ`, about 0.005 USD; the orchestrator
  prompt ran there, ao-26 found no trace in the real state root or `~/.ao/bin` and no spawned worker).
  Not removed (the global service is read-only for workers; the owner may remove them). Rule for every
  brief from now: start every private tmux server from the scratch environment (fake `HOME`, scratch
  `PATH`), and check each pane's `HOME` and `opencode` before a run.
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
- **`ao session restore` dropped the spawn `--model` of a Claude Code session** (found 2026-10-15; fixed by
  `854690c3`, live since the rebuild of 21:09 EDT). The
  claude-code `getRestoreCommand` adds `--model` only from `project.agentConfig.model`, and the session
  metadata stores no model, so a session spawned with `--model claude-sonnet-5-5` restores on the host
  default (`opus`). This breaks `CLAUDE.md` C-04. Follow-up for a worker (restore path, HIGH). Do not fix
  a worker's model with `/model`: on 2026-10-15 at 11:51 `/model claude-opus-5-5` on ao-18 also rewrote
  `~/.claude/settings.json` (`"opus"` to `"claude-opus-5-5"`); the orchestrator put back `"opus"` at once.
- **The Release workflow failed on every push to `main`** (removed by `14bb4670`; kept for the record) (seen on `70d19d70` and on `c831caff`, the push
  of 2026-10-15 at 19:44 EDT). It runs `changesets/action` with `publish: pnpm release`; with no pending
  changeset it tries to publish every `@aoagents/*` package. The repository has no `NPM_TOKEN`, and the
  action then tries npm trusted publishing by OIDC ("No NPM_TOKEN found, but OIDC is available"), which
  fails with `ENEEDAUTH`, so nothing was published. If a token or a trusted-publisher entry for this
  repository is ever added, the fork would publish under the upstream scope. It needs a workflow change
  (`.github/workflows/`, an owner decision). With no secrets, the live OpenCode block of Integration
  Tests skips, so I-6 m-7 stays open. **The Onboarding Integration Test passes** since the CI cleanup: on
  `c831caff` (run 38825354653) step 6 ran `ao start --no-orchestrator`, printed "Startup complete" and
  passed; CI, Integration Tests and Security passed too.
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
