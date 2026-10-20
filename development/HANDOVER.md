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

No worker runs. No priority is chosen for the next session: the owner picks one of Next Priorities.
`main` holds the handover commit; the push of `main` follows it on the owner's word of 2026-10-20.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`; its record reads `status=killed` (stale since 2026-10-16) | transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/0c0f59c9-cc89-4ba3-972b-58a61b9f8390.jsonl` |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |

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

**Lifecycle workers** (since 2026-10-20 09:52): agent-skills 105049, agent-orchestrator 105142 (Nexus
config) and 106285 (this config), Nexus 105154, VSF 106266. Every brief must protect these PIDs, not
the old 19579, 19624, 19636, 19653, 19689. The global OpenCode service is PID 15920 with no `AO_*`.

**Watcher**: stopped at this handover with TERM (PID 851965, 10:23:55 EDT), because no worker runs. To
start it again: `FLEET_WATCH_STATE=/home/taisung/.cache/fleet_watch/ao-opencode2-2026-10-14 setsid nohup
bash /home/taisung/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w
/home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed
<id>@/home/taisung/.worktrees/agent-orchestrator ... < /dev/null`. `--preseed` records the current first
line as handled, so read a worker's report first.

**Router log**: every row of this session is closed. Eight rows of 2026-10-15 still have
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
