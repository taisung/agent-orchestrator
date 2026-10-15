# Handover

**Last Updated**: 2026-10-15
**Latest Code Commit**: 6abab58d (test(agent-opencode): pin the existing-session path in the probe test)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The OpenCode 2.x arc (note `0009`, increments I-0 to I-7) is half done. I-1 (drop 1.x, require 2.0.29)
and I-6 (`ao start` installs `@opencode/cli`) are on `main` and live: the primary checkout was rebuilt
on the owner's word on 2026-10-15 at 10:19 EDT, and the five lifecycle workers were restarted at 10:20.
Note `0010` (the M-1 to M-8 measurements) is on `main`. **I-2 review round 1 runs** on
`c949f902..1c2a93b6` (ao-14, Muse, three commits): ao-17 (V4.1 Flash) returned NOT-LAND-SAFE (M-1: the
A4 version message is unreachable when no OpenCode session ID is stored, because core throws before
`getRestoreCommand`; 2 minors), `development/reviews/i2_review_r1_v4flash.md`; ao-16 (Sonnet 5.5) still
reviews. **The PATH arc review runs**: ao-15 (Muse) reported `done` at `345f1e6e` (one commit on
`825b0dbc`), and ao-18 (Opus 5.5) reviews it. `main` is 30 commits ahead of `origin/main`
(`273b62c1`); nothing of this arc is pushed.

**Outage, 2026-10-15 11:41:47 EDT**: ao-16 ran `tmux kill-server` with `TMUX` set, which stopped the
host's default tmux server and every session of every fleet (TODO Known Issues). The owner restarted
both orchestrators at 11:42. This session (started 11:42:10) found the cause, and on the owner's word
restored ao-18 (11:49) and ao-16 (11:56), each with a `.agent_resume.md` that names the cause and the
tmux rule. ao-1, ao-14, ao-15 and ao-17 stay down until a round needs them.

Until 2026-10-15 the agent-skills orchestrator (`as-orchestrator`) coordinated this work. From this
handover on, this fork's own orchestrator owns I-2 to I-5 and the PATH arc. `as-orchestrator` keeps I-7
(the agent-skills protocol text, CRITICAL there) and the Sonnet 5.5 trial ledger.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees in
`/home/taisung/.worktrees/agent-orchestrator/<id>`.

| Session | Model | State | Branch tip | Disposition |
| --- | --- | --- | --- | --- |
| ao-1 | Claude Opus 5.5 | down since the outage | `39549455` | every commit is on `main` by patch (`git cherry` all `-`); restore only if a HIGH author is needed, else kill |
| ao-14 | Muse (OpenCode 2.x) | down since the outage, done, I-2 | `1c2a93b6` | the author of I-2; restore it for round 2 |
| ao-15 | Muse (OpenCode 2.x) | down since the outage, done, PATH arc | `345f1e6e` | the author of the PATH fix; restore it if ao-18 asks for a round 2 |
| ao-16 | Claude Sonnet 5.5 | restored 11:56, reviewing I-2 | `1c2a93b6` | lens 1 of 2; model pinned in its worktree `.claude/settings.local.json` (restore drops the spawn `--model`); it owns the stop of its scratch PIDs 30076, 75282, 88977, 75249, 88944 |
| ao-17 | V4.1 Flash (OpenCode 2.x) | down, done | `1c2a93b6` | lens 2 of 2, verdict recorded and router row closed; kill it when I-2 lands |
| ao-18 | Claude Opus 5.5 | restored 11:49, reviewing the PATH fix | `345f1e6e` | the single cross-family lens; it owns the stop of its scratch tmux server PID 78379 |
| ao-orchestrator | Claude Opus 5.5 | this session, started 11:42:10 by the owner after the outage, in the primary checkout on `main` | `main` | the transcript of the session before the outage is `~/.claude/projects/-home-taisung-local-agent-orchestrator/ad7a5f39-b7cb-480d-93dc-576ac541a826.jsonl` |

**Watcher**: PID 4193251, `~/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w
/home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed ao-1@...
ao-14@... ao-15@... ao-16@... ao-17@... ao-18@...`, state `~/.cache/fleet_watch/ao-opencode2-2026-10-14/`,
run with `AO_CONFIG_PATH` set to `CONFIG_PATH`. It survived the outage (it is not in tmux). To add or
remove a worker, stop it by the PID in `watch.pid`, remove `watch.pid`, and start it again with the
same options and the new `--preseed` list.

**Lifecycle worker** of this project: PID 3876010 (started 2026-10-15 11:07:17, `AO_CONFIG_PATH` set to
`CONFIG_PATH`, cwd `REPO_PATH`). PID 3544115 no longer runs. A leaked scratch lifecycle worker from
ao-5 still runs: PID 3062995 (`/tmp/ao-i1/config`, cwd deleted); the owner has not ruled on its stop.

**Router rows**: in this fork's log (profile `ROUTER_LOG`), ao-16 and ao-18 are open, ao-17 is closed.
In the agent-skills log (`~/agent-skills/development/artifacts/model_router_log/log.csv`), ao-14 (I-2
author) and ao-15 (PATH author) are open; close them there with `~/agent-skills/scripts/router_log.py
close --log <that file>`.

## Open and Blocked Items

**I-2 review**: running - ao-16 (Sonnet 5.5) - ao-17 returned NOT-LAND-SAFE (M-1 plus 2 minors);
wait for ao-16, reconcile both reviews, then send round 2 to ao-14. Briefs:
`~/.cache/agent-skills-haiku55-arc/brief-review-i2-r1-{sonnet,v4flash}.md`.
**PATH arc review**: running - ao-18 (Opus 5.5) on `825b0dbc..345f1e6e` - the fix touches no file of
I-2. Brief `~/.cache/agent-skills-haiku55-arc/brief-review-aobin-path-r1-opus.md`.
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

1. **Finish the I-2 review** - read the ao-16 review, reconcile it with ao-17, restore ao-14 and send
   round 2 (M-1 of ao-17 at least), re-review, then land by fast-forward or cherry-pick.
   - Context: I-2 changes cleanup and reuse for every OpenCode session; after a rebuild every fleet runs
     it. A rebuild needs the owner's word, then a lifecycle restart.
   - Expected outcome: two LAND-SAFE verdicts, `main` holds I-2, the tree equals the reviewed tree.
2. **Land the PATH fix** - after the ao-18 verdict; a rebuild puts the wrappers on every pane of every
   fleet, so tell the owner what changes for a worker's `git` and `gh` calls before the rebuild.
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

The OpenCode 2.x arc follows note `0009` §13. I-1 and I-6 are live. I-2 (ao-14 at `1c2a93b6`) is in
review round 1: V4.1 Flash (ao-17) returned NOT-LAND-SAFE, and Sonnet 5.5 (ao-16) still reviews. The
`~/.ao/bin` PATH fix (ao-15 at `345f1e6e`, HIGH) is in review by Opus 5.5 (ao-18). The watcher already
notifies this session, so your first action is to read the sentinels of ao-16 and ao-18.

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
