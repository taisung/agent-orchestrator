# Handover

**Last Updated**: 2026-10-20
**Latest Code Commit**: 5069e114 (docs(opencode): name every release of an attempt lock in the spec)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The fork's part of the OpenCode 2.x arc is complete. I-5 (`ao send` and the lifecycle reactions reach an
OpenCode worker through `session.prompt`, with a delivery ledger and kernel-released locks) is on `main`
as `633c6c5f..5069e114`, built at 09:49 EDT, live in the five lifecycle workers since 09:52 EDT, and
pushed. Its real-TUI check passed at 10:12 EDT: one `ao send` was admitted with the printed input ID, no
text was pasted, and the tool of that turn saw the worker's `AO_SESSION_ID` and `~/.ao/bin/gh`. I-3 and
I-4 are live since 2026-10-19 and 2026-10-17. `~/.ao/bin` is 0.2.6, unchanged since 2026-10-16 12:16.

**Update 2026-10-20 11:30 EDT.** The host restarted at 10:42:25 EDT. The five lifecycle workers and the
global OpenCode service (PID 15920) of this handover stopped then. The owner ran `ao start` at 11:19:55;
its new orchestrator record read `status=killed` 171 ms after its `createdAt` (Priority 1, live). The
owner chose Priority 1: ao-46 (Claude Code, Opus 5.5) investigates it, dispatched 11:26 EDT, brief
`~/.cache/agent-skills-haiku55-arc/brief-aofork-killed-status.md`, meter `5h 6%`, `wk 6%`.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`; new record since `ao start` at 11:19:56, reads `status=killed` (mtime 11:19:56.244) | transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/aeb5b549-6146-4d51-af32-1a0ae26c77e4.jsonl` |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |
| ao-46 | Claude Code Opus 5.5, branch `feat/killed-race-read-agent-task-md-in-your-worktree-and-execute`, on `0e3eabc2`. Round 4 done 19:02 EDT at `f35b665f` (no rebase, on top of `e6e23c38`): whole fix `0e3eabc2..f35b665f` (round 1 `fb424675`, round 2 `b2aaea61` `5ca35afe` `bdd5efa0`, round 3 `fcea1114..e6e23c38`, round 4 `fb4127d3` `053d7d5d` `2d86ebab` `f35b665f`). Round 4: B-1 version compares in claimPR, restore, spawn, orchestrator start, kill, cleanup, remap, I-5 ledger key and recovery actions (generation or launch identity, random `reservationId` per reservation), no create in the generic writers; M-1 run, bounds and tracked status keyed to the launch; m-1 to m-3 and the fixture. Full run 2709 passed, 0 failed; live M-1 case on the shipped 5-minute bound; report `~/.cache/agent-skills-haiku55-arc/reports/ao-46-killed-r4.md`; 25.78 USD this round, 81.19 USD session by `trial_cost.py` (status line 90.25 USD with its subagents). Context 37%, meter `5h 3%`, `wk 11%` | idle; keep for a round 5 if review r3 fails; router rows r1 to r4 closed `in-review`; orchestrator checks after round 4: files on the allowed list (`recovery/actions.ts` justified by the audit), no CLI or plugin change, no remote contains `f35b665f`, real records and `~/.ao/bin` unchanged, its only real-state write is its own record by worker 271579 (17:24:10.783, no `generation`) |
| ao-47 | Codex gpt-6.1-sol. Review r1 of `e751a3ee..b8a43f5f` and review r2 of `0e3eabc2..e6e23c38`: both NOT-LAND-SAFE, on `main` as `development/reviews/killed_status_review_r1_sol61.md` and `..._r2_sol61.md`. Review r3 of `e6e23c38..f35b665f` dispatched 19:06:15 EDT, brief `~/.cache/agent-skills-haiku55-arc/brief-review-killed-r3-sol.md`, output `development/reviews/killed_status_review_r3_sol61.md` (uncommitted, in its worktree). Worktree moved by `merge --ff-only` to `f35b665f`; its untracked r2 copy stays. Context 78% at dispatch (brief says write as you work); cost base 18,541,273 in / 109,595 out | review r3 running; router row r3 open |

Retired in this session, each after a check that its branch is on `main` by patch and its review files
equal `main` (reports, briefs and review originals in `~/.cache/agent-skills-haiku55-arc/reports/`):
ao-41 (I-5 author), ao-42 and ao-43 (reviewers, stopped by a content filter), ao-44 (reviewer r4 and the
r5 check), ao-45 (the real-TUI check worker, purged). Their five branches are deleted. `ao session
cleanup` at this handover removed the OpenCode session of the archived ao-35 (404 now).

**Local branches kept** (from earlier cleanups): `i3-r2-pre-rebase` holds two commits that `main` has
only in rewritten form (`7aa587e5` create the OpenCode session before the pane starts, `dab0ba43` check
the launch on the exact argv) - keep it. On the owner's word (2026-10-20, after the handover commit)
the seven older worker branches with no `+` in `git cherry main` and no merge commit were deleted
(`feat/branchcheck2-muse-*`, `feat/i3create-opus-*`, `feat/i3rev-sol-*`, `feat/i4activity-muse-*`,
`feat/i4rev-sonnet-*`, `feat/i4rev-v4flash-*`, `feat/restoremodelrev-opus-*`). `main` and
`i3-r2-pre-rebase` are the only local branches. `git worktree list` shows only the primary checkout, and
`/home/taisung/.worktrees/agent-orchestrator/` is empty.

**Lifecycle workers** (since the host restart of 2026-10-20 10:42): 271579 (this config, started by
`ao start` at 11:19:55) and 321413 (agent-skills, 11:25:30). The workers of Nexus, VSF and the Nexus
config of this fork do not run until their orchestrators run `ao start`. Every brief must protect the
live ones (check with `ps` at dispatch), not the old 105049, 105142, 105154, 106266, 106285. The global OpenCode service does not run (old PID 15920): an
`opencode api` call starts one with the caller's environment.

**Watcher**: PID 3020940 since 14:09:50, state `/home/taisung/.cache/fleet_watch/ao-killed-2026-10-20`,
watching ao-46 and ao-47 (the first watcher, PID 337062, stopped by TERM at 14:09:40 to add ao-47). Start command: `FLEET_WATCH_STATE=<state dir> setsid nohup bash
/home/taisung/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w
/home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed <id> ...
< /dev/null`. `--preseed` is a flag with no value; put the session names after all flags (the old state
directory holds `--preseed.*` files from a call that read it as a session name). `--preseed` records
the current first line as handled, so read a worker's report first.

**Router log**: the four ao-46 rows (r1 to r4) and the ao-47 review r1 row are closed `in-review`
(10.81, 18.53, 26.07, 25.78 and about 1.5 USD). The ao-47 review r2 row is closed `in-review` (11,815,179 in / 62,824 out). The ao-47 review r3 row is open.

**Owner decisions of 2026-10-20**: fix A+B+C+D in one round by ao-46; the real records `ao-orchestrator`
and `as-orchestrator` stay `killed` until fix C is live (its first poll must correct them).
After review r1 (answers 1a 2a 3a 4a): ao-46 writes round 3; a tmux "not found" is a death that the
outage rule never blocks, and the outage rule (only for plugins that answer false on an error) and "no
tmux server" each turn into `killed` after 5 minutes; a per-record kernel-released lock and a generation
counter for every Node writer, with `pr` in the compare, and the bash helper stays outside the lock (no
`WRAPPER_VERSION` change); the minor items are in round 3. Eight rows of 2026-10-15 still have
`landed=pending` (TODO Known Issues, "Traps found in the I-5 rounds").

## Open and Blocked Items

**Lifecycle `killed` status**: open - live records read `status=killed` (the orchestrator record since
2026-10-16 14:56:51), so the lifecycle worker does not poll them; a new worker can also go `spawning` to
`killed` at the first poll (ao-29). Cause not analyzed. Priority 1 below.
**I-5 follow-ups**: open - m-4 (the double-failure warning omits that the sweep also removes `admitted`
entries; text in `i5_review_r5_sol61.md`), the duplicated child runner of the lock and ledger tests,
and a 2.0.32 measurement of the I-4-era M-4 and M-5 (needs a model turn and the owner's word).
**Other code items**: `ao stop` on a launching orchestrator exits 1 before the lifecycle stop;
`recovery/actions.ts:149` (no shipped caller); OpenCode reuse with a model after the worktree is gone
fails (`LocationNotFoundError`); the project-mode orchestrator record drop; a guard that warns when the
OpenCode service environment holds `AO_*`; the hidden `--no-dashboard` option
(`packages/cli/src/commands/start.ts:997`).
**Test isolation**: open - tests leave state in the real `~/.agent-orchestrator` and many
`/tmp/ao-test-state-*` directories; an inherited `AO_STATE_ROOT` is not removed by the test setup. A
worker change.
**Project guide**: open - `CLAUDE.md` and `AGENTS.md` do not name `development/HANDOVER.md` as the first
read; `CLAUDE.md` still says "getEnvironment must include `~/.ao/bin`" and its core utilities list lacks
`removeAoBinFromPath`, `GH_WRAPPER` and `GIT_WRAPPER`. A worker change.
**Review minors kept open**: N-27, N-28, m-11, m-12, m-18 (owner: stays open); known limits m-9 (owner
accepted), N-17.
**I-5 accepted limits** (D-5): non-Linux refusal of the agent route; another local user can hold a
lock name. Owner decision only if AO ever runs on macOS or on a shared host.
**Dependency Review on PRs**: open - owner decision - it fails because the repository's Dependency graph
setting is off. Turn the setting on, or let a worker remove the job.
**Owner decisions carried forward**: the global OpenCode permissions that allow every action; the orphan
stash (`stash@{0}` on `feat/opencode-gemini-plugins`); `0007` §6 decisions 1 to 4 and 6.
**Q3 event stream**: blocked by D-4 (no worker reads the service password) - I-4 polls.
**Minors from I-1 and I-6**: I-6 m-7 and m-8, the `npm ls` timeout, the export surface, the picker hint;
I-1: the refusal message omits the probe's stderr, a refused spawn leaves its branch.
**agent-skills protocol text** (owned by `as-orchestrator`, I-7): `env -u TMUX` with every `tmux -L`,
private servers only from the scratch environment, the lifecycle-worker PID cleanup, the no-push rule.

## Next Priorities

Ask the owner which one to start; route it with `~/agent-skills/scripts/routing.py route`.

1. **Lifecycle `killed` status** - one investigation worker (route `debugging`; HIGH by the profile: the
   lifecycle state of every session).
   - Context: TODO Known Issues "Live sessions read `status=killed`" and the first-poll race in
     "Follow-ups after I-3". One write gave every record of this project `status=killed` at
     2026-10-16 14:56:51 while the panes ran. Workers spawned since then read `working`.
   - Expected outcome: a measured cause in `lifecycle-manager.ts` or the metadata writers, a reproducer
     in a scratch state root, and a fix brief. No change to the real records before the cause is known.
2. **I-5 follow-ups** - one small author round: m-4 text, optional shared test runner. LOW.
3. **Project guide and test isolation** - one worker each; LOW and MEDIUM.
4. **`0005` Phases 0 to 4** - none started; owner decision on scope.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect
   `main` = `origin/main` at the handover commit. ` D test-ao-config2.yaml` is an old working-tree
   deletion; leave it and never commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao status` - expect no
   worker. `ps -o pid=,args= -p 105049,105142,105154,106266,106285` - expect the five lifecycle workers.
3. Ask the owner which of Next Priorities to start.

## Key Files

- `packages/core/src/lifecycle-manager.ts` - the poll loop and the status transitions (priority 1).
- `packages/core/src/metadata.ts` - the record writers (`updateMetadata`, archive).
- `packages/core/src/delivery-ledger.ts`, `packages/core/src/delivery-lock.ts` - the I-5 ledger and locks.
- `packages/core/src/session-manager.ts` - `deliver`, `send`, `cleanup` (the archived OpenCode purge).
- `docs/opencode-workflows-spec.md` section 4, item 6 - the I-5 contract and its limits.
- `development/reviews/i5_review_r4_sol61.md`, `i5_review_r5_sol61.md` - the last I-5 reviews.
- `~/.cache/agent-skills-haiku55-arc/` - every brief of the arc, `reports/`, and `restart_lifecycle.py`
  (`<pid>` dry run, `<pid> --do`).

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): the I-5 entry (`633c6c5f..5069e114`, rollout, real-TUI
  check, costs), I-3, I-4.
- [Decisions](TODO_TRACKING.md#decisions): D-3 (no worker builds in the primary checkout), D-4 (no worker
  reads the OpenCode service password), D-5 (the I-5 design and its accepted limits).
- [Known Issues](TODO_TRACKING.md#known-issues): "Traps found in the I-5 rounds" (content filter, gitleaks,
  cherry-pick sequencer, cleanup purge, old router rows), "Live sessions read `status=killed`", the I-5
  round history, the spawn prompt that tells workers to push, M-3 (a resident process reinstalls its
  own helper version).

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this host
runs from this checkout's `dist`, so every fleet (Nexus, VSF, agent-skills, this fork) runs what you land
after a rebuild. Only you rebuild, only on the owner's word (D-3). A rebuild does not reach a running
`ao lifecycle-worker`: restart each by exact PID with `~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py`.

The OpenCode 2.x arc of this fork is complete: I-5 is live and pushed, and its real-TUI check passed. No
worker runs and no priority is chosen. Do First Actions 1 to 3, then start the priority that the owner
picks. Priority 1, the stale `killed` status of live records, is the only known defect that stops
lifecycle reactions for a session.

Landmines. Spawn with a prompt that says to wait for `.agent_task.md`, then place the brief and `ao send`
a start line; set line 1 of a reused worker's report to `running|` before a new brief. The spawn prompt
tells workers to push and open a PR: every brief forbids it in section 0. Every worker live run uses a
scratch `AO_STATE_ROOT`, `env -i` for every `ao`, `node` and `opencode api` call, a fake `HOME` for every
`pnpm test`, `env -u TMUX tmux -L <unique>`, and ends with an empty
`find ~/.agent-orchestrator -maxdepth 3 -newer <marker> ...` and an empty
`find ~/.agent-orchestrator -path '*deliveries*'` outside a real send; check both yourself. Briefs protect
the new lifecycle PIDs above. With I-5 live, `ao send` to an OpenCode worker with a stored ID goes
through the API and fails (nothing pasted) when its pane runs a TUI on another session. A Codex reviewer
stops on texts about breaking locks, `kill -9` steps or other local users: use plain words, and move to
a new session after a stop. The gitleaks hook reads JSON `"key"` and `"token"` fields as secrets; never
bypass it. Clear a stuck cherry-pick with `--quit`, never `--abort`. Kill only exact PIDs; never `pkill`
or `killall`. Commit messages are `docs(development): ...` with no `Co-Authored-By` trailer and no
emoji. Ask the owner before any push.
