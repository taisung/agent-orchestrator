# Handover

**Last Updated**: 2026-10-15
**Latest Code Commit**: 6abab58d (test(agent-opencode): pin the existing-session path in the probe test)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The OpenCode 2.x arc (note `0009`, increments I-0 to I-7) is half done. I-1 (drop 1.x, require 2.0.29)
and I-6 (`ao start` installs `@opencode/cli`) are on `main` and live: the primary checkout was rebuilt
on the owner's word on 2026-10-15 at 10:19 EDT, and the five lifecycle workers were restarted at 10:20.
Note `0010` (the M-1 to M-8 measurements) is on `main`. **I-2 round 3 runs, by astra (ao-25, Codex)**:
round 1 (ao-14, Muse) failed both lenses (B-1 no spawn mapping, B-2 cross-fleet bind, M-1, M-2). Round 2
(`3b2bb918..3c1d04c9`, ao-1, Opus 5.5) fixed most findings, but sol-6-1 (ao-24) returned NOT-LAND-SAFE:
B-1, two overlapping starts with the same title and directory both store the first pane's session, and
a purge in the second fleet removes it (real on this host: the Nexus config holds a second
`agent-orchestrator` project with the same path and `sessionPrefix: ao`); M-1, the shared-ID guard
reads a terminal status such as `merged` as a dead holder although its pane is alive. Both ladder rungs
failed, so on 2026-10-15 the owner named astra (R3). Its reviewer is Opus 5.5 (cross-family). **PATH fix
round 3 runs, by ao-19 (Opus 5.5)**: round 1 (`4eadc823`, ao-15, Muse) failed its Opus review (ao-18);
round 2 (`4eadc823..b21bb304`, ao-19) fixed or recorded every round-1 finding, but sol-6-1 (ao-23)
returned NOT-LAND-SAFE: M-1, a Claude Code pane started from inside a Codex, Gemini or OpenCode pane
inherits the `~/.ao/bin` wrappers, against the owner's hook-only rule; m-1, m-2. Under R7 the owner
chose round 3 by ao-19; ao-23 re-checks. **The onboarding CI cleanup landed** (`ebc8e25b`, `c9a7ed93`,
`19d99667`, ao-20, Muse, LAND-SAFE by Sonnet 5.5 and V4.1 Flash in both rounds). On the owner's word,
`main` was pushed to `origin` on 2026-10-15 at 12:42 EDT (`origin/main` = `70d19d70`). The later
commits on `main`, among them the CI cleanup, are not pushed.

**Outage, 2026-10-15 11:41:47 EDT**: ao-16 ran `tmux kill-server` with `TMUX` set, which stopped the
host's default tmux server and every session of every fleet (TODO Known Issues). The owner restarted
both orchestrators at 11:42. This session (started 11:42:10) found the cause, and on the owner's word
restored ao-18 (11:49) and ao-16 (11:56), each with a `.agent_resume.md` that names the cause and the
tmux rule.

Until 2026-10-15 the agent-skills orchestrator (`as-orchestrator`) coordinated this work. From this
handover on, this fork's own orchestrator owns I-2 to I-5 and the PATH arc. `as-orchestrator` keeps I-7
(the agent-skills protocol text, CRITICAL there) and the Sonnet 5.5 trial ledger.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees in
`/home/taisung/.worktrees/agent-orchestrator/<id>`.

| Session | Model | State | Branch tip | Disposition |
| --- | --- | --- | --- | --- |
| ao-1 | Claude Opus 5.5 | idle, done, NOT-LAND-SAFE | `3c1d04c9` | I-2 round 2 author; row closed; round 3 went to astra | brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r2.md`; model pinned in its worktree `.claude/settings.local.json`; its branch was moved to `main` (all old commits on `main` by patch) |
| ao-19 | Claude Opus 5.5 | done at `4affc2e3` | `4affc2e3` | PATH round 3: `removeAoBinFromPath` in core, Claude Code launches drop every inherited wrapper directory and set an empty `GH_PATH`; plan check passed; `f9e85891` alone fails lint, `4affc2e3` fixes it; earlier: round 2 failed sol-6-1 M-1 (nested Claude Code launches inherit the wrappers); brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-aobin-path-r3.md`; its context compacted before round 3 |
| ao-25 | GPT-6-Astra (Codex) | done at `0080cf87` | `0080cf87` | one `fix(core)` commit: a host-wide launch lock in `/tmp/ao-opencode-launch-<uid>` with a pending marker that has no expiry, and a liveness guard; plan check passed; earlier: owner-named (R3); fixes sol-6-1 B-1 and M-1; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r3.md`; reviewer Opus 5.5 |
| ao-23 | GPT-6.1-Sol (Codex) | re-checking PATH round 3 | `4affc2e3` | brief `~/.cache/agent-skills-haiku55-arc/brief-review-aobin-path-r3-sol.md`; earlier: PATH round 2: M-1 a Claude Code pane inherits the wrappers from a parent that has them; m-1, m-2; review `development/reviews/aobin_path_review_r2_sol61.md`; row closed; R7 next step is the owner |
| ao-24 | GPT-6.1-Sol (Codex) | idle, done, NOT-LAND-SAFE | `3c1d04c9` | I-2 round 2: B-1 overlapping starts with the same title and directory bind and purge the first pane's session; M-1 the shared-ID guard skips a live holder with a terminal status; review `development/reviews/i2_review_r2_sol61.md`; row closed; R7 next step is the owner |
| ao-26 | Claude Opus 5.5 | reviewing I-2 round 3 | `0080cf87` | cross-family lens of the astra author; model pinned in its worktree; brief `~/.cache/agent-skills-haiku55-arc/brief-review-i2-r3-opus.md`; asked to judge the pending-marker trade-off closely |
| ao-20 | Muse (OpenCode 2.x) | idle, done, landed | `353ef189` | round 1 landed as `ebc8e25b`; round 2 restores a synchronous config-load step 6, deletes `port: 9000`, and removes the dead `packages/web` entries of `eslint.config.js`; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-ci-nodash-r2.md` |
| ao-21 | Claude Sonnet 5.5 | idle, done, LAND-SAFE | `353ef189` | lens 1 of 2; round 1 LAND-SAFE (M-1, m-1, m-2); brief `~/.cache/agent-skills-haiku55-arc/brief-review-ci-nodash-r2-sonnet.md` |
| ao-22 | V4.1 Flash (OpenCode 2.x) | idle, done, LAND-SAFE | `353ef189` | lens 2 of 2; round 1 LAND-SAFE (3 minors); brief `~/.cache/agent-skills-haiku55-arc/brief-review-ci-nodash-r2-v4flash.md` |
| ao-14 | Muse (OpenCode 2.x) | down since the outage, done | `1c2a93b6` | the round-1 author of I-2; R7 moved round 2 away; kill it when I-2 lands |
| ao-15 | Muse (OpenCode 2.x) | down since the outage, done | `345f1e6e` | the round-1 author of the PATH fix; kill it when the fix lands |
| ao-16 | Claude Sonnet 5.5 | idle, done | `1c2a93b6` | I-2 lens 1, verdict recorded, row closed, its scratch processes stopped; kill it when I-2 lands |
| ao-17 | V4.1 Flash (OpenCode 2.x) | down, done | `1c2a93b6` | I-2 lens 2, verdict recorded, row closed; kill it when I-2 lands |
| ao-18 | Claude Opus 5.5 | idle, done | `345f1e6e` | the PATH lens, verdict recorded, row closed; kill it when the fix lands |
| ao-orchestrator | Claude Opus 5.5 | this session, started 11:42:10 by the owner after the outage, in the primary checkout on `main` | `main` | the transcript of the session before the outage is `~/.claude/projects/-home-taisung-local-agent-orchestrator/ad7a5f39-b7cb-480d-93dc-576ac541a826.jsonl` |

**Watcher**: PID 3549329, `~/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator
-w /home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed
ao-23@... ao-26@...`, state `~/.cache/fleet_watch/ao-opencode2-2026-10-14/`, run with `AO_CONFIG_PATH` set to
`CONFIG_PATH`. It survived the outage (it is not in tmux). To add or remove a worker, stop it by the PID
in `watch.pid`, remove `watch.pid`, and start it again with the same options and the new `--preseed`
list.

**Lifecycle worker** of this project: PID 3876010 (started 2026-10-15 11:07:17, `AO_CONFIG_PATH` set to
`CONFIG_PATH`, cwd `REPO_PATH`). PID 3544115 no longer runs. The leaked scratch lifecycle worker of
ao-5 (PID 3062995, `/tmp/ao-i1/config`, cwd deleted) was stopped by exact PID on the owner's word at
12:25.

**Router rows**: in this fork's log (profile `ROUTER_LOG`), ao-19 and ao-25 (authors), ao-23 (second row, PATH round-3 re-check) and ao-26 (I-2 round-3 reviewer)
are open; ao-1, ao-20, ao-21,
ao-22, ao-23 and ao-24 are closed; ao-16,
ao-17 and ao-18 (reviewers) are closed.
In the agent-skills log (`~/agent-skills/development/artifacts/model_router_log/log.csv`), ao-14 (I-2
author) and ao-15 (PATH author) are open; close them there with `~/agent-skills/scripts/router_log.py
close --log <that file>`.

## Open and Blocked Items

**I-2 round 2**: running - ao-1 (Opus 5.5) - reviews `development/reviews/i2_review_r1_{sonnet,v4flash}.md`;
the round-2 review goes to sol-6-1 (`--agent codex --model gpt-6.1-sol`), Opus author at HIGH.
**PATH fix round 2**: running - ao-19 (Opus 5.5) - review `development/reviews/aobin_path_review_r1_opus.md`;
owner M-4 (a): Claude Code keeps its hook only; the round-2 review goes to sol-6-1. The fix touches no
file of I-2; if it needs `session-manager.ts` or the OpenCode plugin, it reports `partial`.
**Global OpenCode store**: closed - the owner keeps the 10 "Greeting request" sessions from the
integration live block (TODO Known Issues).
**Restore drops the spawn model**: open - TODO Known Issues - a worker fix in the claude-code
`getRestoreCommand` and the session metadata (HIGH).
**Tmux rule in the agent-skills protocol text**: open - the owner decides whether as-orchestrator adds
"`env -u TMUX` with every `tmux -L`" to the ao-spawn brief text.
**Owner decisions**: open - the `AO_*` variables of nex-orchestrator in the global OpenCode service
environment (restart the service from a clean shell, or not); the global OpenCode permissions that
allow every action (keep, or pass a session ruleset); the trailer rule for this fork (TODO Known
Issues); the orphan stash; `0007` §6 decisions 1-4 and 6.
**Q3 event stream**: blocked by fork D-4 (no worker reads the service password) - I-4 polls.
**Project guide does not name HANDOVER.md**: open - `CLAUDE.md` and `AGENTS.md` have no session-start
instruction - add "read `development/HANDOVER.md` first" to both in one commit.
**Minors kept open**: I-6 m-7 (watch the first CI run with secrets: its live OpenCode block now meets
2.0.29), I-6 m-8 (one test comment), the `npm ls` timeout, the export surface, the picker hint; I-1: the
lifecycle worker can mark a reserved ID `killed` during the 10 s probe (seen 1 of 2 runs), the refusal
message omits the probe's stderr, a refused spawn leaves its branch; for I-3: `session.create` accepts a
model with no provider route, and the `status=killed` write after the M-6 spawn.

## Next Priorities

1. **Review and land I-2** - when ao-25 (astra) reports, plan-check its diff, brief a fresh Opus 5.5
   reviewer (blind, cross-family) on `3c1d04c9..<tip>` and the whole `49369f18..<tip>`, then land by
   cherry-pick (the branch is not on `main`).
   - Context: I-2 changes spawn-time discovery, cleanup, reuse and restore for every OpenCode session;
     after a rebuild every fleet runs it. A rebuild needs the owner's word, then a lifecycle restart.
   - Expected outcome: LAND-SAFE, `main` holds I-2, the tree equals the reviewed tree.
2. **Review and land the PATH fix** - when ao-19 reports, reset ao-23's report line 1 and brief it on
   `b21bb304..<tip>`; before the rebuild, give the owner ao-19's D9 text (what changes for a worker's
   `git` and `gh` calls). Both PATH round 3 and I-2 round 3 may touch `packages/core/src/index.ts`
   (exports only): a cherry-pick conflict there goes to a worker.
3. **Fix the restore model** (HIGH), then **I-3 and I-4** (after I-2), **then I-5** - route each with
   `~/agent-skills/scripts/routing.py route`; I-3 and I-5 are HIGH by the profile.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect
   `main`, ahead of `origin/main`, at the handover commit. `D test-ao-config2.yaml` in the status is an
   old working-tree deletion that this arc did not make; leave it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao status`, then read
   the first line of `.agent_report.md` of ao-16 and ao-18 (sentinels first).
3. Check the watcher: `ps -p $(cat ~/.cache/fleet_watch/ao-opencode2-2026-10-14/watch.pid)`.

## Key Files

- `development/0009_opencode_2x_api_fit_design.md` - §4 the mapping table, §13 the staged plan, §17 the
  review minors, §18 the owner's answers Q1 to Q9.
- `development/0010_opencode_2x_model_turn_measurements.md` - §11.1 pipe truncation, §13 plan changes,
  §15 review corrections.
- `packages/core/src/opencode-api.ts` (on ao-14's branch) - the I-2 helper.
- `~/.cache/agent-skills-haiku55-arc/` - every brief, report and review of the arc;
  `restart_lifecycle.py` there restarts one lifecycle worker by exact PID (`<pid>` dry run, `<pid> --do`).
- `~/agent-skills/skills/ao-spawn`, `ao-communicate`, `ao-lifecycle`, `handover` - the protocol.

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): the OpenCode 2.x plugin fix, 0009, I-6, I-1, the
  rebuilds of 2026-10-14 21:11 and 2026-10-15 10:19.
- [D-3](TODO_TRACKING.md#decisions) no worker builds in the primary checkout; [D-4](TODO_TRACKING.md#decisions)
  no worker reads the OpenCode service password.
- [Known Issues](TODO_TRACKING.md#known-issues): a rebuild does not reach running lifecycle workers; the
  second `agent-orchestrator` entry in the Nexus config.
- `~/agent-skills/development/TODO_TRACKING.md` Known Issues: the full arc history up to 2026-10-15.

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this
host runs from this checkout's `dist`, so every fleet (Nexus, VSF, agent-skills, this fork) runs what you
land after a rebuild, and only you rebuild, only on the owner's word (D-3). A rebuild does not reach a
running `ao lifecycle-worker`: restart each by exact PID with
`~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py`, on the owner's word.

The OpenCode 2.x arc follows note `0009` §13. I-1 and I-6 are live. I-2 round 2 is authored by ao-1
(Opus 5.5), and the `~/.ao/bin` PATH fix round 2 by ao-19 (Opus 5.5); both reviews go to sol-6-1. The
watcher already notifies this session, so your first action is to read the sentinels of ao-1 and
ao-19.

Landmines. OpenCode 2.x workers are eager: write `.agent_task.md` first, then send one `ao send
--no-wait`; a plain `ao send` waits 600 s, because the plugin still reads an idle 2.x pane as active
(I-4 fixes it). `ao spawn` bases a worktree on `origin/main` (`273b62c1`), so fast-forward each new
worktree to `main` before you write its brief. Before a new brief to a reused session, set line 1 of its
`.agent_report.md` to `running|...` (D-30 of agent-skills). Workers never push, never build in the
primary checkout, never write a global OpenCode file or `~/.ao/bin`, never read a `service.json`, and
write to OpenCode only on an isolated store (0009 §2). Every tmux command of a worker uses
`-L <unique-name>` with `TMUX` removed (`env -u TMUX`): `TMUX_TMPDIR` alone does not isolate inside a
pane, and on 2026-10-15 one `tmux kill-server` stopped every fleet. Do not send `/model` to a worker: it
rewrites the host-wide default in `~/.claude/settings.json`. `ao session restore` of a Claude worker
takes the host default model, so pin a model in the worktree's `.claude/settings.local.json` first.
Kill only exact PIDs; never `pkill`. No
`Co-Authored-By` trailer and no emoji. `ao send` text has no quotes, apostrophes, backticks, `$`,
parentheses or semicolons.

Ask the owner before any push. The open owner decisions are in Open and Blocked Items.
