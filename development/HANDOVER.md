# Handover

**Last Updated**: 2026-09-23
**Latest Code Commit**: 112558b4 (docs(development): 0008 addendum -- round 2 of the 397b7dd1 review fixed via nex-2090 and merged (954e3997))
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)

## Current Status

The trimmed headless fork and both `397b7dd1` review rounds are on `main`, pushed to `fork`, and built in
place. `main` is the only branch, locally and on `fork`. None of the product phases in `0005` §6 (0 to 4, 6)
have started. Work on this fork moves here from the `~/agent-skills` orchestrator worktree
`as-orchestrator-2`, which the owner deletes after this handover.

## Live Sessions and Worktrees

None for this repository. It has no `ao` project. `git worktree list` shows only the primary checkout.

## Open and Blocked Items

**Lifecycle workers run pre-rebuild code**: open - five `ao lifecycle-worker` processes started before the
2026-09-23 rebuild (TODO_TRACKING "Known Issues"). Round-2 fixes, for example `AO_STATE_ROOT` passed to the
lifecycle worker, are not live until they restart - owner decides when to restart, because Nexus and
Coding-Orchestrator fleets use them.
**Project guide does not name HANDOVER.md**: open - `CLAUDE.md` and `AGENTS.md` have no session-start
instruction - add "read `development/HANDOVER.md` first" to both in one commit (the owner's rule: never add a
rule to only one of them).
**No `ao` profile for this repo**: open - `~/agent-skills/skills/shared/ao-profiles/` has none, so push policy,
trailer policy and standing sections are unset - fill `TEMPLATE.md` as `agent-orchestrator.md` in
`~/agent-skills` with the owner's values, or record that this repo stays without one.
**Trailer policy**: open - 17 of 30 merged commits carry `Co-Authored-By: Claude`; no rule here - owner
decides. Until then, add no trailer (the rule in `~/agent-skills` and Nexus).
**`0007` §6 decisions 1-4, 6**: blocked on owner - GitHub lifecycle, desktop notifier, Gemini, archive policy,
historical synthetic roots.
**Orphan stash** `stash@{0}` (WIP on the deleted `feat/opencode-gemini-plugins`): open - inspect with
`git stash show -p stash@{0}`, then keep or drop on the owner's word.

## Next Priorities

1. **Choose the next product phase** - read `0005` §6 and ask the owner whether Phase 2 (spawn correctness)
   comes next.
   - Context: the skills in `~/agent-skills` still work around the missing features: pointer titles, rebase
     after spawn, a tmux scrape for output, deleting branches by hand. Phase 2 removes the first two.
     `0008` §7 adds `ao spawn --route` as a candidate.
   - Expected outcome: one phase with an exit gate, briefed to a worker per D-3.
2. **Restart lifecycle workers on the owner's word** - then check `ps -o lstart= -p <pid>` is later than the
   2026-09-23 build.
   - Expected outcome: every `ao lifecycle-worker` started after the rebuild.
3. **Fix the guide pointer and the profile** (Open items 2 and 3).

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect
   `main...fork/main`, clean, at the handover commit or later.
2. `pgrep -af lifecycle-worker` and `ps -o pid,lstart,args -C node | grep lifecycle-worker` - check whether
   the workers were restarted.
3. Read `development/0005_personal_fork_scope_and_trim_plan.md` §6 and §11, then ask the owner for the next
   phase.

## Key Files

- `development/0005_personal_fork_scope_and_trim_plan.md` §6 - the phase plan and exit gates.
- `development/0007_retained_distribution_trim_execution.md` §6 - owner decisions still open.
- `development/0008_model_routing_single_source_and_tiered_assignment.md` §7-§10 - spawn ideas and the
  worker-isolation recipe.
- `packages/cli/src/commands/spawn.ts`, `packages/core/src/session-manager.ts` - Phase 2 surface.
- `~/agent-skills/skills/ao-*/SKILL.md` - the operating manual; Phase 6 rewrites it.

## Durable References

- [TODO_TRACKING.md - Milestones and Progress](TODO_TRACKING.md#milestones-and-progress): phases not started.
- [D-1](TODO_TRACKING.md#decisions) `main` is canonical; [D-2](TODO_TRACKING.md#decisions) pre-rewrite branch
  discarded; [D-3](TODO_TRACKING.md#decisions) no worker builds in the primary checkout.
- [Known Issues](TODO_TRACKING.md#known-issues).

## Next Session Start Prompt

You work on the personal `ao` fork at `/home/taisung/local/agent-orchestrator`, remote `fork`
(`github.com/taisung/agent-orchestrator`). `main` is canonical (D-1). On 2026-09-23 it was fast-forwarded to
`112558b4`, which holds the headless trim `397b7dd1` and both review rounds (suite 1809 passed / 20 skipped on
2026-09-16). It was pushed and rebuilt, and every other branch was deleted. No product phase from `0005` §6 has
started. `ao spawn` has `--model` but no `--branch`, `--base` or task file, and `ao session` has no `output`,
`integrate` or `finish`.

The global `ao` runs from this checkout's `packages/cli/dist`. Every `ao` fleet on the host (Nexus,
Coding-Orchestrator, FleetMonitor, agent-skills) uses it. Do not build here while a worker runs, and brief
workers to build in their own worktree with `AO_STATE_ROOT` under `/tmp` and `tmux -L` (D-3). A rebuild does not
reach the running `ao lifecycle-worker` processes. They need a restart, and the owner decides when.

Start with the First Actions above. Then ask the owner which phase comes next. Phase 2 is the recommendation,
because it removes the pointer-title and post-spawn-rebase workarounds in the `ao-*` skills. Also ask for the
open policy values: push policy, `Co-Authored-By` trailer (add none until told), and whether this repo gets an
`ao` profile in `~/agent-skills`.

Commits use conventional format (`CLAUDE.md` "Commits"). A gitleaks pre-commit hook runs. Stage files by name.
