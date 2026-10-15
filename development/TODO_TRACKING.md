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
  Not pushed, not rebuilt.

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

## Known Issues

- **A rebuild does not reach running lifecycle workers.** Node loads `dist` at process start. On 2026-09-23
  after the rebuild, five `ao lifecycle-worker` processes still ran pre-rebuild code: `Coding-Orchestrator`
  (pid 57829), `Nexus` (60414), `my-project` (1770808), `FleetMonitor` (2303231), `agent-skills` (3054071).
  Restarting them affects live fleets in other projects.
- **No `ao` project and no profile for this repository.** No `agent-orchestrator.yaml` here, and
  `~/agent-skills/skills/shared/ao-profiles/` has no profile for it. The handover skill therefore has no
  `HANDOVER_PUSH`, `TRAILER_POLICY`, or `HANDOVER_SECTIONS` values for this repo.
- **Trailer policy not written down here.** 17 of the 30 commits merged on 2026-09-23 carry
  `Co-Authored-By: Claude`. `~/agent-skills` and Nexus forbid the trailer (owner, 2026-09-17); this repo has no
  rule.
- **Orphan stash**: `stash@{0}: WIP on feat/opencode-gemini-plugins: 5e2a783` — that branch no longer exists.
  Not inspected, not dropped.
- **State root size**: `~/.agent-orchestrator` held 1,275 entries on 2026-09-23. `0007` counted 1,174 historical
  synthetic roots on 2026-08-11; their cleanup needs separate authorization (`0007` §6 item 6).
