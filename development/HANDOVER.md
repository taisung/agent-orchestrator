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
| ao-46 | Claude Code Opus 5.5, branch `feat/killed-race-read-agent-task-md-in-your-worktree-and-execute`, on `0e3eabc2`. Round 5 done 20:41 EDT at `f06a1107` (no rebase, on top of `f35b665f`): whole fix `0e3eabc2..f06a1107` (round 1 `fb424675`, round 2 `b2aaea61` `5ca35afe` `bdd5efa0`, round 3 `fcea1114..e6e23c38`, round 4 `fb4127d3..f35b665f`, round 5 `b52e18df` `ef6c73d9` `ac8ca80b` `f06a1107`). Round 5: ownership check directly before each of 23 removal steps (only check-to-tmux-command gaps left); per-ID generation floor `sessions/.generations/<id>` raised on every delete, plus launch identity in every generation compare; restore failure and rollback keep a runtime that any record may own and name it; cleanup kill compares `pr`, `issue`, `status` and launch; lock helper Worker without `NODE_OPTIONS`; test children get `HOME`. Full run 2756 passed, 0 failed; report `~/.cache/agent-skills-haiku55-arc/reports/ao-46-killed-r5.md`; 19.72 USD this round, 100.91 USD session by `trial_cost.py` (status line 112.71 USD with subagents). Context 45%, meter `5h 7%`, `wk 12%` | round 9 dispatched 09:29:40 EDT 2026-10-21 (owner 1a 2a: r7 M-1 only, a strict archive listing in the prepared-session holder decision plus an audit of every `existsSync` or listing shortcut that feeds a removal decision in the code of this fix; `listArchivedSessionIds` unchanged for its other callers; review r8 will be a short re-check under rule 2a), brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-killed-fix-r9.md`, on top of `69d6f467`, no rebase, no amend; meter `5h 3%`, `wk 15%`; cost base 141.52 USD, 416,439,162 in / 1,882,629 out; router row r9 open; round 8 done 08:30 EDT 2026-10-21 at `0d3c05fe..69d6f467` (5 commits, no rebase, no amend): an explicit "unknown" rollback outcome keeps and names the runtime, prepared session, workspace, record and prompt file; `preparedSessionHolder` reads every active record and latest archive (unreadable is a holder); strict reads (`readRecordStrict`, `listRecordIds`) also in kill, start, restore, ledger and archived cleanup; `Workspace.destroy` back to `Promise<void>` with a typecheck-compiled compat fixture; m-1 names the kept orchestrator OpenCode session with its removal command; M-4 and M-5 unchanged. Full run 2852 passed; the reuse read-to-write window stays open (later round). Report `~/.cache/agent-skills-haiku55-arc/reports/ao-46-killed-r8.md`; 17.01 USD this round, 141.52 USD session. Orchestrator checks pass (files, no remote, only real-state write is its own record by worker 271579 at 07:41:17, no `generation` key); router rows r1 to r8 closed; round 7 done 23:57 EDT at `7294d978..0d3c05fe` (4 commits, no rebase, no amend): the orchestrator delete check uses its own reservation; optional `stillOwned` on `Workspace.destroy` (run before `git worktree remove` and before the `rmSync` fallback, a throw keeps it, returns `"kept" | undefined`); optional `stillUnheld` on `PreparedAgentSession.discard` (run before the interrupt and each removal). Full run 2804 passed; report `~/.cache/agent-skills-haiku55-arc/reports/ao-46-killed-r7.md`; 12.55 USD this round, 124.51 USD session (status line 139.17 USD). Type note: the `destroy` return type change breaks an out-of-tree plugin that declares `Promise<void>`. Orchestrator checks after round 7 pass (files, no remote, only real-state write is its own record by worker 271579 at 23:17:56, no `generation` key); router rows r1 to r7 closed |
| ao-47 | Codex, launched as gpt-6.1-sol; since 2026-10-21 01:00Z on gpt-6-astra (see the model note). Reviews r1 to r4 all NOT-LAND-SAFE, on `main` as `development/reviews/killed_status_review_r{1,2,3,4}_sol61.md`. r4 of `f35b665f..f06a1107` (done 21:17 EDT): all r3 findings fixed; 0 blockers; M-1 `deleteOpenCodeSession` retries (200/600 ms) remove an agent session without a fresh ownership check; M-2 `removeDeliveryLedger` waits for the ledger lock, then removes a ledger that a new owner names (`delivery-ledger.ts:560-563`, a file outside the allowed list); m-1 archive writes do not use the per-ID floor, so a number can repeat across active and archive (no harm shown); m-2 the removal table omits low-level removals. Worktree at `f06a1107`; reports `~/.cache/agent-skills-haiku55-arc/reports/ao-47-killed-review-r{1,2,3,4}.md`; Codex totals 32,163,437 in / 197,102 out | idle; review r7 of `0d3c05fe..69d6f467` done 08:50 EDT on gpt-6-astra under rule 2a: NOT-LAND-SAFE, 0 blockers, 1 major, 0 minors, on `main` as `development/reviews/killed_status_review_r7_astra6.md`. M-1: `preparedSessionHolder` (`session-manager.ts:1665`) calls `listArchivedSessionIds`, whose `existsSync` shortcut (`:639`) returns no IDs when the archive directory cannot be checked, so the decision finds no holder and removes the prepared session. r6 M-2, M-3 and m-1 fixed; follow-up list F-1 to F-7 does not block. Codex totals 44,621,001 in / 295,275 out; context 64% after its compaction; router rows r1 to r7 closed `in-review` |

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

**Router log**: the ao-46 rows r1 to r4 and the ao-47 review r1 row are closed `in-review`
(10.81, 18.53, 26.07, 25.78 and about 1.5 USD). The ao-47 review r2 and r3 rows are closed `in-review` (11,815,179 in / 62,824 out; 7,657,805 in / 47,170 out). The ao-46 r5 row is closed `in-review` (19.72 USD). The ao-47 review r4 row is closed `in-review` (5,964,359 in / 40,337 out). The ao-46 r6 row is open.

**Model note (ao-47, review r4)**: two Sol turns ended with `codex_error_info: cyber_policy` ("This
content was flagged for possible cybersecurity risk", 00:50:10Z and 00:58:08Z on 2026-10-21). At 01:00:01Z
`~/.codex/config.toml` changed to `model = "gpt-6-astra"` (a global default for every new Codex session) and
a user turn "continue" started; the owner made the switch (confirmed 2026-10-20, answer "1 yes"). Owner: ao-47 stays on gpt-6-astra for review r5 (2a), and the global default stays gpt-6-astra (3a); pin `--model` on every Codex spawn. The rest of review r4 (01:00-01:17Z, with the
final M-1 and M-2 evidence and the verdict) ran on gpt-6-astra xhigh. The router row r4 says so.

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
