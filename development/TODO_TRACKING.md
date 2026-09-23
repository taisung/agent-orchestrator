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
