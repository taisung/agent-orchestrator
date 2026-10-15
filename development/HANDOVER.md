# Handover

**Last Updated**: 2026-10-15
**Latest Code Commit**: 6abab58d (test(agent-opencode): pin the existing-session path in the probe test)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The OpenCode 2.x arc (note `0009`, increments I-0 to I-7) is half done. I-1 (drop 1.x, require 2.0.29)
and I-6 (`ao start` installs `@opencode/cli`) are on `main` and live: the primary checkout was rebuilt
on the owner's word on 2026-10-15 at 10:19 EDT, and the five lifecycle workers were restarted at 10:20.
Note `0010` (the M-1 to M-8 measurements) is on `main`. **I-2 is authored and waits for its review**:
ao-14 (Muse) reported `done` at `1c2a93b6`, range `c949f902..1c2a93b6`, three commits. A separate arc,
the `~/.ao/bin` PATH bug, runs in ao-15 (Muse, HIGH). `main` is `825b0dbc`, 26 commits ahead of
`origin/main` (`273b62c1`); nothing of this arc is pushed.

Until 2026-10-15 the agent-skills orchestrator (`as-orchestrator`) coordinated this work. From this
handover on, this fork's own orchestrator owns I-2 to I-5 and the PATH arc. `as-orchestrator` keeps I-7
(the agent-skills protocol text, CRITICAL there) and the Sonnet 5.5 trial ledger.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees in
`/home/taisung/.worktrees/agent-orchestrator/<id>`.

| Session | Model | State | Branch tip | Disposition |
| --- | --- | --- | --- | --- |
| ao-1 | Claude Opus 5.5 | idle, about 20% context | `39549455` | every commit is on `main` by patch (`git cherry` all `-`); keep as the R7 rung or a HIGH author, or kill |
| ao-14 | Muse (OpenCode 2.x) | done, I-2 | `1c2a93b6` | the author of I-2; keep for a round 2 |
| ao-15 | Muse (OpenCode 2.x) | running, PATH arc | from `825b0dbc` | wait for its report |
| ao-orchestrator | Claude Opus 5.5 | this session, in the primary checkout on `main` | `main` | `ao-orchestrator-2` (a mistaken start in a worktree) was killed by the owner; `as-orchestrator` removed the empty branches `orchestrator/ao-orchestrator-1` and `-2` (both at `273b62c1`, `git cherry` empty) |

**Watcher**: PID 4106781, `~/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w
/home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed
ao-1@... ao-14@... ao-15@...`, state `~/.cache/fleet_watch/ao-opencode2-2026-10-14/`, run with
`AO_CONFIG_PATH` set to `CONFIG_PATH`. `as-orchestrator` moved it to this session on 2026-10-15 at about
11:40 EDT. To add or remove a worker, stop it by the PID in `watch.pid`, remove `watch.pid`, and start
it again with the same options and the new `--preseed` list.

**Lifecycle worker** of this project: PID 3544115 (restarted 2026-10-15 10:20 EDT on the I-1 build).

**Router rows still open in the agent-skills log** (`~/agent-skills/development/artifacts/model_router_log/log.csv`):
ao-14 (I-2 author) and ao-15 (PATH author). Close them there with `~/agent-skills/scripts/router_log.py
close --log <that file>`. Open every new row in this fork's log (profile `ROUTER_LOG`, `--create` on the
first one).

## Open and Blocked Items

**I-2 review**: open - ao-14 done at `1c2a93b6` - dispatch the router's reviewer pair for
python/L1/MEDIUM with a Muse author: Sonnet 5.5 (`--agent claude-code --model claude-sonnet-5-5`) and
V4.1 Flash (`--agent opencode --model opencode-go/deepseek-v4.1-flash`). Model the brief on
`~/.cache/agent-skills-haiku55-arc/brief-review-i1-r2.md`. Points for the review: the hanging-binary
restore now takes about 21 s (three bounded 10 s calls, not one); `session.interrupt` answered
`{"interrupted":false}` at the top level, not under `data`; `includeTitleDiscoveryForSessionId` stays in
the `resolveOpenCodeSessionReuse` signature, unused; the truncation check (D2 of the report).
**PATH arc**: running - ao-15 - wait for its report; the router's reviewer is one blind cross-family
lens, Opus 5.5 (debugging/L1/HIGH). If ao-15 reports `partial` because the fix needs
`session-manager.ts` or the OpenCode plugin, order that part after I-2 lands.
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

1. **Review I-2** - two blind lenses on `c949f902..1c2a93b6`, then land by fast-forward or cherry-pick.
   - Context: I-2 changes cleanup and reuse for every OpenCode session; after a rebuild every fleet runs
     it. A rebuild needs the owner's word, then a lifecycle restart.
   - Expected outcome: two LAND-SAFE verdicts, `main` holds I-2, the tree equals the reviewed tree.
2. **Land the PATH fix** - review by Opus 5.5, then land; a rebuild puts the wrappers on every pane of
   every fleet, so tell the owner what changes for a worker's `git` and `gh` calls before the rebuild.
3. **I-3 and I-4** (after I-2), **then I-5** - route each with `~/agent-skills/scripts/routing.py route`;
   I-3 and I-5 are HIGH by the profile.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect
   `main`, ahead of `origin/main`, at `825b0dbc` or the handover commit.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao status` - find this
   session's name and the state of ao-1, ao-14 and ao-15.
3. The watcher already notifies this session (PID 4106781, Live Sessions). Check it with
   `ps -p $(cat ~/.cache/fleet_watch/ao-opencode2-2026-10-14/watch.pid)`.
4. Read `~/.cache/agent-skills-haiku55-arc/ao-14-report-i2.md`, then write the two I-2 review briefs.

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

The OpenCode 2.x arc follows note `0009` §13. I-1 and I-6 are live. I-2 is authored by ao-14 at
`1c2a93b6` and needs its two blind reviews (Sonnet 5.5 and V4.1 Flash). ao-15 works on the separate
`~/.ao/bin` PATH arc (HIGH; one Opus 5.5 review). ao-1 (Opus 5.5) is idle. The watcher already notifies
this session, so your first action is to brief the I-2 reviewers.

Landmines. OpenCode 2.x workers are eager: write `.agent_task.md` first, then send one `ao send
--no-wait`; a plain `ao send` waits 600 s, because the plugin still reads an idle 2.x pane as active
(I-4 fixes it). `ao spawn` bases a worktree on `origin/main` (`273b62c1`), so fast-forward each new
worktree to `main` before you write its brief. Before a new brief to a reused session, set line 1 of its
`.agent_report.md` to `running|...` (D-30 of agent-skills). Workers never push, never build in the
primary checkout, never write a global OpenCode file or `~/.ao/bin`, never read a `service.json`, and
write to OpenCode only on an isolated store (0009 §2). Kill only exact PIDs; never `pkill`. No
`Co-Authored-By` trailer and no emoji. `ao send` text has no quotes, apostrophes, backticks, `$`,
parentheses or semicolons.

Ask the owner before any push. The open owner decisions are in Open and Blocked Items.
