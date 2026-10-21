# Handover

**Last Updated**: 2026-10-21
**Latest Code Commit**: 8fe2e1aa (docs: state that an archive directory that cannot be checked keeps the session) - the last commit of the killed-status fix; built and live since 2026-10-21 10:25 EDT, pushed
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The killed-status fix (Priority 1 of the last handover) is landed, built, live in both lifecycle
workers and pushed (What Landed, `6361a663..8fe2e1aa`; decisions D-6 and D-7). `ao-orchestrator` reads
`working` (or `stuck` while idle) since the first poll of the new worker. `as-orchestrator`
(agent-skills) reads `killed`, and that is correct: its tmux session and its `claude` process no longer
exist; a new `ao start` in agent-skills gives it a new record.

The next arc is "launches that share a tmux name, a tmux server and a worktree path". Its design is done
(ao-48, `development/reviews/same_id_design_r1_opus.md`) with 42 failing defect tests on ao-48's branch
(`c516cead`, not on `main`). The owner answered "1a 2a" (2026-10-21 12:05 EDT): R1 starts now with OD-1a
and OD-11a (author ao-50), and a cross-family review of the design for R2 to R4 comes first (ao-51,
gpt-6-astra). Both were dispatched at 12:09 EDT on top of `c516cead`. Until R1 and R2 land, two destructive
defects stay live: the tmux prefix match (D-A) and `ao` with its tmux calls on another server (D-B,
critical). Operating rules until then are in the Next Session Start Prompt.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`; record `working`/`stuck` since 2026-10-21 10:24:59 (`generation=1`) | transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/aeb5b549-6146-4d51-af32-1a0ae26c77e4.jsonl` |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |
| ao-50 | Claude Code Opus 5.5 (`--model claude-opus-5-5`), worktree `/home/taisung/.worktrees/agent-orchestrator/ao-50`, branch `feat/same-id-r1-read-agent-task-md-in-your-worktree-and-execute-i`, moved to `c516cead` before the brief. Same-ID R1 author (exact tmux targets); brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-same-id-r1.md`, scratch `/tmp/aosr1`; dispatched 12:09 EDT; router row open | on its `done`: spawn the R1 code review (Codex, `--model gpt-6-astra` pinned) on `c516cead..<tip>` |
| ao-51 | Codex `--model gpt-6-astra`, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-51`, branch `feat/same-id-design-review-read-agent-task-md-in-your-worktree-an`, moved to `c516cead`. Cross-family review of the design for R2 to R4; review file `development/reviews/same_id_design_review_r1_astra6.md` in its worktree (not committed); brief `~/.cache/agent-skills-haiku55-arc/brief-review-same-id-design-astra.md`, scratch `/tmp/aosdr`; dispatched 12:09 EDT; Codex `weekly 83% left` at dispatch; router row open. It may send one `note|none|R1 note in the review file` | on its `done`: copy the review to `main`, then ask the owner OD-2 to OD-10 and OD-12 with the review's options |
| ao-49 | Claude Code Opus 5.5, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-49` (not used: the work is in the scratch clone `/tmp/ao49hs/agent-skills`, branch `feat/ao-session-helpers`). Writes `scripts/restart_lifecycle.py` and `scripts/ao_relaunch.py` with tests for `~/agent-skills` (owner "1a 2 yes"); dispatched 11:58:30 EDT, brief `~/.cache/agent-skills-haiku55-arc/brief-agentskills-session-helpers.md`; router row open; watcher PID 2238373 (state `~/.cache/fleet_watch/ao-helpers-2026-10-21`) | on its `done`: review the diff, cherry-pick into `~/agent-skills`, run `bash tests/run_all.sh` there, ask the owner before a push of `~/agent-skills`; then kill ao-49 |

Closed by this handover (2026-10-21 11:40 EDT): ao-46 (the killed-status author) and ao-47 (its
reviewer). Before the kills: their final reports are saved, and every review copy in ao-47 equals its
copy on `main`. `ao session cleanup -p agent-orchestrator` found nothing to clean. `ao session kill`
archived both records (`ao-46_2026-10-21T15-40-19-910Z`, `ao-47_2026-10-21T15-40-20-419Z`) and removed
their tmux sessions and worktrees. Both branches had no merge commit and no `+` line in `git cherry main`
(34 `-` each), so both are deleted (each was at `ce49c9fd`). Reports, briefs and review originals:
`~/.cache/agent-skills-haiku55-arc/reports/` and `~/.cache/agent-skills-haiku55-arc/brief-*.md`.

Killed on the owner's word (2026-10-21 12:02 EDT): ao-48 (the design author). Before the kill: its report
and brief are saved as `~/.cache/agent-skills-haiku55-arc/reports/ao-48_same_id_design_r1.{report,task}.md`,
its design copy equals `main`, and its watcher 1346791 was stopped by TERM (log `EXIT signal SIGTERM`).
`ao session kill` archived the record (`ao-48_2026-10-21T16-02-48-504Z`) and removed its tmux session and
worktree.

**Local branches**: `main`, `i3-r2-pre-rebase` (keep: two commits that `main` has only in rewritten
form), the ao-48 branch `feat/same-id-design-read-agent-task-md-in-your-worktree-and-execu` at `c516cead`
(the only `+` line of `git cherry main`; keep until R1 lands, the ao-50 and ao-51 branches also hold it).

**Lifecycle workers**: 1470866 (this config, started 2026-10-21 10:24:58) and 1471311 (agent-skills,
10:25:01), both on the fix build. Every brief protects these PIDs (check with `ps` at dispatch). The
workers of Nexus, VSF and the Nexus config of this fork do not run until their orchestrators run
`ao start`. The global OpenCode service does not run: an `opencode api` call starts one with the
caller's environment.

**Watchers**: PID 2334310 watches ao-50 and ao-51 since 12:09:08, state
`~/.cache/fleet_watch/ao-sameid-r1-2026-10-21`. PID 2238373 watches ao-49, state
`~/.cache/fleet_watch/ao-helpers-2026-10-21`. Stopped by TERM: 1346791 (ao-48) at 12:02:39, and 3020940
(ao-46, ao-47) at 11:40:01; both logs end with `EXIT signal SIGTERM`.
Start form: `FLEET_WATCH_STATE=<state dir> setsid nohup bash
/home/taisung/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w
/home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed <id> ...
< /dev/null`; session names after all flags; read a worker's report before `--preseed`.

**Router log**: every row of this arc is closed; ao-46 r1 to r9 and ao-47 r1 to r8 are `landed=8fe2e1aa`;
the ao-48 design row is `in-review`. Eight rows of 2026-10-15 still have `landed=pending`.

**Codex model**: the global `~/.codex/config.toml` default is gpt-6-astra since 2026-10-21 01:00Z (the
owner's `/model` in ao-47). Pin `--model` on every Codex spawn; the owner used Astra for the reviews after
Sol stopped on `cyber_policy` (Known Issues traps).

## Open and Blocked Items

**Same-ID arc**: in progress - R1 (ao-50) and the design review of R2 to R4 (ao-51) run; OD-2 to OD-10
and OD-12 wait for that review.
**Killed-status r8 m-1**: open - `readGenerationFloor` (`packages/core/src/metadata.ts:506-516`)
answers 0 on a read error, so a generation can repeat; `docs/DEVELOPMENT.md:446` says "never repeats".
No removal bypass (every compare also checks the launch identity). A small worker change: harden the read
or qualify the text.
**claude-code `detectActivity` dialog fix**: open - it waited for the killed-status fix, which has landed
(Known Issues). A worker change in `agent-claude-code/src/index.ts`.
**I-5 follow-ups**: open - m-4 (warning text), the duplicated child runner of the lock and ledger tests,
a 2.0.32 measurement of the I-4-era M-4 and M-5 (needs a model turn and the owner's word).
**Other code items**: `ao stop` on a launching orchestrator exits 1 before the lifecycle stop;
`recovery/actions.ts:149` (no shipped caller); OpenCode reuse with a model after the worktree is gone
fails (`LocationNotFoundError`); the project-mode orchestrator record drop; a guard that warns when the
OpenCode service environment holds `AO_*`; the hidden `--no-dashboard` option
(`packages/cli/src/commands/start.ts:997`).
**Test isolation**: open - tests leave state in the real `~/.agent-orchestrator` and in
`/tmp/ao-test-state-*`; a root `pnpm test` without a fake `HOME` makes OpenCode model turns.
**Project guide**: open - `CLAUDE.md` and `AGENTS.md` do not name `development/HANDOVER.md` as the first
read; `CLAUDE.md` still says "getEnvironment must include `~/.ao/bin`" and its core utilities list lacks
`removeAoBinFromPath`, `GH_WRAPPER` and `GIT_WRAPPER`. A worker change.
**Review minors kept open**: N-27, N-28, m-11, m-12, m-18 (owner: stays open); known limits m-9 (owner
accepted), N-17.
**I-5 accepted limits** (D-5): non-Linux refusal of the agent route; another local user can hold a lock
name.
**Dependency Review on PRs**: open - owner decision - the repository's Dependency graph setting is off.
**Owner decisions carried forward**: the global OpenCode permissions that allow every action; the orphan
stash (`stash@{0}` on `feat/opencode-gemini-plugins`); `0007` §6 decisions 1 to 4 and 6; `0005` Phases
0 to 4 and 6; the trailer policy of this fork (none written; add no trailer).
**Q3 event stream**: blocked by D-4 - I-4 polls.
**Minors from I-1 and I-6**: I-6 m-7 and m-8, the `npm ls` timeout, the export surface, the picker hint;
I-1: the refusal message omits the probe's stderr, a refused spawn leaves its branch.
**agent-skills protocol text** (owned by `as-orchestrator`, I-7): `env -u TMUX` with every `tmux -L`,
private servers only from the scratch environment, the lifecycle-worker PID cleanup, the no-push rule;
add the missing-`TMUX_TMPDIR` fallback.

## Next Priorities

1. **Same-ID round R1, exact tmux targets** - DISPATCHED to ao-50 (owner "1a", 2026-10-21: OD-1a `=name`
   for session targets, `=name:` for window and pane targets; OD-11a order R1, R2, R4, R3).
   - Context: design sections 2 and 7. 47 production call sites in runtime-tmux, core (`tmux.ts`,
     `session-manager.ts:522`), the four agent plugins (`list-panes`), the CLI (`lib/shell.ts:57`,
     `commands/send.ts`, `commands/session.ts`) and `integration-tests/src/helpers/tmux.ts`; empty
     `display-message` output means "gone"; new helpers refuse names outside `[a-zA-Z0-9_-]`; core
     exports grow (no break). Risk LOW, size S. Author: ao-50 on top of `c516cead` (no rebase). Review:
     a new Codex session with `--model gpt-6-astra` pinned (cross-family, routing rule for HIGH
     architecture; R1 itself is LOW). After LAND-SAFE: cherry-pick `ce49c9fd..<tip>` (it applies to
     `main` cleanly when the source is still equal), rebuild and restart on the owner's word.
   - Expected outcome: the 17 `[same-id R1]` tests pass as normal `it` tests (flip them from `defect()`),
     old tests that pin plain argument vectors updated, full run green.
2. **Design review of R2 to R4, then the remaining owner decisions** - the review is DISPATCHED to ao-51
   (owner "2a", 2026-10-21; gpt-6-astra). After it, ask the owner OD-2 to OD-10 and OD-12 (design
   section 9) with the review's options.
   - Context: R2 (server and launch identity) and R3 (per-ID lease, F-1, F-2, F-3, F-6) are HIGH; R3 is
     the largest. R4 (fail-open reads F-8 to F-11) is medium and small.
   - Expected outcome: a review file `development/reviews/same_id_design_review_r1_<model>.md`, then
     the owner's choices, then R2.
3. **claude-code `detectActivity` dialog fix** - one worker round (Known Issues, the 2026-10-20 entry).
4. **Killed-status r8 m-1** - a small worker change (generation-floor read or doc text).
5. **I-5 follow-ups, project guide, test isolation, `0005` phases** - as before; owner choice.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect `main` =
   `origin/main` at the commit that records the handover close. ` D test-ao-config2.yaml` is an old working-tree
   deletion; leave it and never commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao session ls -p
   agent-orchestrator` - expect ao-49, ao-50, ao-51 and the orchestrator records. `ps -o pid=,args= -p
   1470866,1471311,2238373,2334310` - expect the two lifecycle workers and the two watchers.
3. `head -1 /home/taisung/.worktrees/agent-orchestrator/ao-5{0,1}/.agent_report.md` - a `running|` line
   means the round still runs; act on `done|` as the Live Sessions table says.

## Key Files

- `development/reviews/same_id_design_r1_opus.md` - the design: section 2 (call sites), 3 (server
  identity), 4 (D-C options), 5 (fail-open reads), 6 (rollout), 7 (rounds), 9 (owner decisions), 12
  (a runtime-tmux prototype of R1 and R2), 13 (reproducer scripts).
- ao-48's commit `c516cead` - ten `same-id-defects` test files; `SAME_ID_DEFECTS=red` shows the failures.
- `packages/plugins/runtime-tmux/src/index.ts`, `packages/core/src/tmux.ts`,
  `packages/core/src/session-manager.ts`, `packages/cli/src/lib/shell.ts`,
  `packages/cli/src/commands/send.ts`, `packages/cli/src/commands/session.ts` - the R1 call sites.
- `docs/DEVELOPMENT.md` "Record writes" - the rules that the killed-status fix added.
- `development/reviews/killed_status_review_r8_astra6.md` - the follow-up list F-1 to F-11.
- `~/.cache/agent-skills-haiku55-arc/` - briefs (`brief-aofork-same-id-design.md`,
  `brief-aofork-killed-fix-r9.md`, `brief-review-killed-r8-astra.md` as templates), `reports/`, and
  `restart_lifecycle.py` (`<pid>` dry run, `<pid> --do`).

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): the killed-status fix entry (`6361a663..8fe2e1aa`), I-5.
- [Decisions](TODO_TRACKING.md#decisions): D-3 (no worker builds in the primary checkout), D-4, D-5,
  D-6 (what blocks landing in a review of a race fix), D-7 (killed-status design choices).
- [Known Issues](TODO_TRACKING.md#known-issues): "Traps found in the killed-status and same-ID rounds",
  "tmux `-t` targets match by prefix", "`ao` with its tmux calls on another server", the claude-code
  `detectActivity` entry, "Traps found in the I-5 rounds", the spawn prompt that tells workers to push.
- The killed-status block in Known Issues ("Live sessions read `status=killed`", now FIXED) holds every
  round, review, cost and the later-round entry "launches of one ID share a name and a path".

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this host
runs from this checkout's `dist`, so every fleet runs what you land after a rebuild. Only you rebuild, only
on the owner's word (D-3), and a rebuild reaches a running `ao lifecycle-worker` only after a restart by
exact PID with `~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py`.

The killed-status fix is live and pushed. The same-ID arc has a finished design and failing tests
(`c516cead`). R1 runs in ao-50, and the design review of R2 to R4 runs in ao-51. Do First Actions 1 to 3.
Ask the owner in plain text with numbered options (a watcher can paste into this pane, so never open an
AskUserQuestion dialog).

Until R1 and R2 land: run `ao` only from a shell on the default tmux server (never inside a private
server pane, never with another `TMUX` or `TMUX_TMPDIR`); do not kill or clean up a dead session whose
name is a prefix of exactly one live name (`ao-4` while only `ao-48` lives); use `ao send --no-wait` to
Claude Code panes; do one operation on a session ID at a time.

Landmines. Spawn with a pointer title that says to wait for `.agent_task.md`; every brief forbids push
and PR in section 0, protects the lifecycle PIDs 1470866 and 1471311, and requires `env -i` with a fake
`HOME` for every `ao`, `node` and test call, `env -u TMUX tmux -L <unique>` for every tmux call (a missing
`TMUX_TMPDIR` directory falls back to the real default server), and an empty `find ~/.agent-orchestrator
-maxdepth 3 -newer <marker> ...` at the end; check it yourself. Pin `--model` on every spawn; the Codex
default is gpt-6-astra, and Sol stops on lock and race texts (`cyber_policy`). Keep Codex briefs in plain
words. The gitleaks hook reads JSON `"key"` and `"token"` fields as secrets; never bypass it. Clear a stuck
cherry-pick with `--quit`, never `--abort`. Kill only exact PIDs; never `pkill` or `killall`. Commit
messages are `docs(development): ...` with no `Co-Authored-By` trailer and no emoji. Ask the owner before
any push.
