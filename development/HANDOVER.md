# Handover

**Last Updated**: 2026-10-22
**Latest Code Commit**: 56a385fb (docs: make rows 3, 4, 9 and 11 of the absence table exact) - the last commit of same-ID R4; built and live since 2026-10-22 10:00 EDT
**Session Summary**: [0012_summary_session_2026_10_21_to_22.md](0012_summary_session_2026_10_21_to_22.md)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

Two rounds landed on 2026-10-22, and both are built, live in both lifecycle workers and pushed:

- the claude-code `detectActivity` round, `63932b9a..9938d5d1` (built 07:46 EDT; live check PASS on Claude
  Code 2.1.308). A regular `ao send` to an idle Claude Code pane now sends at once.
- same-ID R4, the strict reads, `32c687b2..56a385fb` (21 commits, review r4 LAND-SAFE by ao-60; gates of
  `main` `193d2c9e` PASS: 3464 passed, 1 expected fail, 29 skipped, red 0/16/6/0). Built 10:00:04 to
  10:00:11 EDT; lifecycle workers restarted by exact PID (2002324 → **3830765**, 2002831 → **3830929**). Live
  check PASS 10:02 EDT: 5 polls each, 0 failures, health `ok`, no live session `killed` or `exited`.

`origin/main` = `main` after the last docs push (close record below). CI passed 4 of 4 for the R4 push
(`511c697e`) and for the handover push (`116cf549`).

The same-ID arc has R1, R2a and R4 on `main`. Its remaining rounds are RW, R2b-1, R2b-2 (in design), then
R3a, R3b, RH and RO (later, owner "5b"). Design r8 of RW and R2b-2 is DONE and is in re-check by ao-62.
The claude-code follow-ups F-6 and m-1 are DONE on a branch (ao-54, `6ea435a8`), and review r1 by ao-60
found them LAND-SAFE at 10:24 EDT (0 B, 0 M, 0 m); the landing waits for the owner's word. The design
re-check runs at the handover; its watcher reports to `ao-orchestrator`.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees under
`/home/taisung/.worktrees/agent-orchestrator/`. Briefs and reports: `~/.cache/agent-skills-haiku55-arc/`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`. Transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/d1cd4fa3-37cc-4619-856a-56f78cdf584d.jsonl` | a new session continues here |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |
| ao-52 | Claude Code Opus 5.5, branch `feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex` at `48c26129`. Design r8 DONE 09:57 EDT: design `development/reviews/same_id_design_r8_opus.md` (on `main`), tests `fe5d6575..48c26129` (4 test commits, not on `main`), report `reports/ao-52_same_id_design_r8.report.md`; router row closed `in-review` | idle; the r8 re-check is done (SOUND-WITH-CHANGES, 3 M): the next step is design r9 on the owner's word. Watcher 2833081 |
| ao-54 | Claude Code Opus 5.5, branch `feat/claude-strict-process` at `6ea435a8`, base `b97a2500`. F-6 and m-1 DONE 09:53 EDT (5 commits, 5 files +590 -71; owner "go 1a" allowed 4 `index.test.ts` oracle changes); report `reports/ao-54_claude_strict_process.report.md`; router row closed `in-review` | idle; waits for review r1. Watcher 3760585 |
| ao-60 | Codex `gpt-6-astra` xhigh, branch `review/claude-strict-process` at `6ea435a8`. REVIEW r1 of F-6 and m-1 DONE 10:24 EDT: LAND-SAFE for `b97a2500..6ea435a8` (0 B, 0 M, 0 m); merge with `main` `511c697e` (merge tree `5b039aca`) builds and passes 3541 passed, 1 expected fail, 29 skipped; red 0/16/6/0; new follow-up F-9; review `development/reviews/claude_strict_process_review_r1_astra6.md` (on `main`); router row closed `in-review`; rollout `~/.codex/sessions/2026/10/21/rollout-2026-10-21T23-44-26-01a161b5-cb34-7da3-af23-97acdd286c51.jsonl` | idle; can run the gates of `main` after the F-6 landing. Watcher 2246299 |
| ao-62 | Codex `gpt-6-astra` xhigh, branch `review/same-id-design-r8` at `48c26129`. RE-CHECK r8 DONE 10:28 EDT: RW SOUND-WITH-CHANGES, R2b-2 SOUND-WITH-CHANGES (0 B, 3 M, 0 m): r7 M-1, M-2, M-3 partly closed, m-1 closed; new M-1 (RW) recovery removes the active record without the directory `fsync` of the archive and of the moved inbox; M-2 (R2b-2) the replacement creation order drops r7's existing-session fence before the launch and copy-back record writes; M-3 (both) the core caller tests reject the required `launchToken`, and all 29 core r8 tests pass with every inbox `fsync` removed; review `development/reviews/same_id_design_review_r8_astra6.md` (on `main`); router row closed `in-review`; context 83% | idle. Watcher 2610857 |

**Closed by this handover**: ao-55 (author of R2a and R4; R4 is landed). See "Close record" below.

**Lifecycle workers (now)**: 3830765 (this config) and 3830929 (agent-skills), restarted 2026-10-22 10:00
EDT by exact PID on the build of `36c4b18b` (source `56a385fb`). Pid files:
`~/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid` and
`~/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid`. The workers of Nexus, VSF and the
Nexus config of this fork do not run until their orchestrators run `ao start`. The global OpenCode service
does not run: an `opencode api` call starts one with the caller's environment.

**Watchers** (each watches one session, `-o ao-orchestrator --fallback ao-orchestrator -i 60 -s 20`):
2833081 ao-52 (`~/.cache/fleet_watch/ao-sameid-d2-2026-10-21`), 3760585 ao-54
(`~/.cache/fleet_watch/ao-codexsend-2026-10-21`), 2246299 ao-60 (`~/.cache/fleet_watch/ao-r4r2-rev-2026-10-21`),
2610857 ao-62 (`~/.cache/fleet_watch/ao-62`). Start form: `FLEET_WATCH_STATE=<state dir> setsid nohup bash
/home/taisung/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w /home/taisung/.worktrees/agent-orchestrator
--fallback ao-orchestrator -i 60 -s 20 --preseed <id> <id> < /dev/null > <state dir>/nohup.out 2>&1 &`. Stop
with TERM only, then check that the process ended.

**Router log** (`development/artifacts/model_router_log/log.csv`): open row ao-60 (gates of `main` after the F-6 landing). Close a row with `router_log.py close ... --landed in-review` and token counts:
Codex from the last `total_token_usage` of the rollout, Claude from `trial_cost.py opus-5-5=<jsonl>` (input
= input + cache read + cache creation); subtract the sums of the earlier rows of that session. Eight rows
of 2026-10-15 still have `landed=pending`.

**CI**: 4 of 4 workflows passed for `511c697e` (last at 10:09:12 EDT) and for `116cf549` (last at 10:17:42 EDT).

**Local branches**: `main`; `i3-r2-pre-rebase` (keep: two commits that `main` has only in rewritten
form); `review/same-id-design-r7` (kept, see the close record); the four branches of the live sessions
(above). The close record lists what this handover deleted.

**Codex model**: the global `~/.codex/config.toml` default is gpt-6-astra. Pin `--model` on every spawn;
gpt-6.1-sol stops on lock and race texts (`cyber_policy`, Known Issues traps).

### Close record

- **Push**: `b97a2500..511c697e` at 10:03:00 (R4 and 9 docs commits) and `511c697e..116cf549` at 10:06:57
  (the handover commit), both fast-forward, owner answer "16c"; CI 4 of 4 passed for each. The summary
  doc (`1118b876`, owner request) and this close record go out in one more fast-forward docs push.
- **Watcher retirement** (ao-lifecycle, Session Cleanup): watcher 3845635 (ao-55, state
  `~/.cache/fleet_watch/ao-sameid-r2a-2026-10-21`) stopped by TERM at 10:07:03; its log ends with
  `EXIT signal SIGTERM`, its `watch.pid` is removed, and the `grep -Flzx` check of its state found no
  process. Its escalation "the fleet is unwatched" covers only ao-55; the four other watchers run.
- **Session cleanup**: `ao session cleanup -p agent-orchestrator` found no sessions to clean up. ao-55 was
  killed at 10:07:20 with `ao session kill`: record archived as `ao-55_2026-10-22T14-07-20-702Z`, tmux
  session and worktree removed. Before the kill: only `.agent_report.md` and `.agent_task.md` were
  untracked, its last report is saved as `reports/ao-55_same_id_r4_round4.report.md`, no client was attached.
- **Branches** (log `~/.cache/agent-skills-haiku55-arc/branch-cleanup-2026-10-22-handover.log`): no branch
  had a merge commit. Deleted with `-d` (ancestors of `main`): `validate/main-r4` 193d2c9e,
  `feat/sdr7-review-read-agent-task-md-in-your-worktree-and-execute` 407ee00d. Deleted with `-D` (no `+`
  line in `git cherry main`): `feat/same-id-r4` e3860672 (21 `-`), `review/same-id-r4-r2` 8e9efe95 (12 `-`),
  `review/same-id-r4-r3` c02c0c02 (18 `-`), `review/same-id-r4-r4` e3860672 (21 `-`),
  `feat/claude-detect-activity` 53cfd6a8 (4 `-`). KEPT: `review/same-id-design-r7` fe5d6575 with 13 `+`
  commits (design test commits of ao-52, not on `main`); its tip is an ancestor of ao-52's branch, so it
  can go with that branch.

## Open and Blocked Items

**Same-ID arc**: in progress - design r8 of RW and R2b-2 in re-check (ao-62). R2b-1 needs RW, R2a and the
Codex send fix first (R2a and the fix are on `main`). R3a, R3b, RH and RO come later (owner "5b"). All
owner decisions OD-2 to OD-29 are in TODO D-8.
**R4 follow-ups F-1 to F-8**: open - listed in Known Issues, the same-ID entry ("Later round launches of
one ID share a name and a path"). F-6 is in review; F-1 and F-2 belong to R2b and R3; F-3, F-4, F-5, F-7
and F-8 are small worker changes; owner choice.
**claude-code F-6 and m-1**: review r1 LAND-SAFE (ao-60, 10:24 EDT) - `b97a2500..6ea435a8`; the landing
waits for the owner's word. Follow-up F-9 (Known Issues, claude-code entry).
**Codex send limits**: L-1 (a wrapped status row) and L-2 (any two-space `└ ` row counts as a status row),
`development/reviews/codex_send_idle_review_r4_astra6.md`; its follow-ups F-1 to F-7 are in that file.
**Killed-status r8 m-1**: open - `readGenerationFloor` (`packages/core/src/metadata.ts`) answers 0 on a read
error, so a generation can repeat; `docs/DEVELOPMENT.md` says "never repeats". A small worker change.
**I-5 follow-ups**: open - m-4 (warning text), the duplicated child runner of the lock and ledger tests,
a 2.0.32 measurement of the I-4-era M-4 and M-5 (needs a model turn and the owner's word).
**Other code items**: `ao stop` on a launching orchestrator exits 1 before the lifecycle stop;
`recovery/actions.ts:149` (no shipped caller); OpenCode reuse with a model after the worktree is gone
fails (`LocationNotFoundError`); the project-mode orchestrator record drop; a guard that warns when the
OpenCode service environment holds `AO_*`; the hidden `--no-dashboard` option
(`packages/cli/src/commands/start.ts`).
**Test isolation**: open - tests leave state in the real `~/.agent-orchestrator` and in
`/tmp/ao-test-state-*`; a root `pnpm test` without a fake `HOME` makes OpenCode model turns.
**Project guide**: open - `CLAUDE.md` and `AGENTS.md` do not name `development/HANDOVER.md` as the first
read; `CLAUDE.md` still says "getEnvironment must include `~/.ao/bin`", and its core utilities list lacks
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

1. **Land F-6 and m-1** - review r1 by ao-60 is LAND-SAFE (10:24 EDT,
   `development/reviews/claude_strict_process_review_r1_astra6.md`).
   - Owner "17a" (10:26 EDT): LANDED on `main` at 10:27 as `3c16e89b..a20883a0` (clean cherry-pick of
     `b97a2500..6ea435a8`, 5 commits; tree equal to the `git merge-tree` result `d779318c`), NOT built yet.
     Next: gates by ao-60, build, restart, live check, push.
   - The chain, as for R4: `git merge-tree --write-tree main 6ea435a8` (the merge
     base is `b97a2500`), `git cherry-pick b97a2500..6ea435a8`, check that the tree equals the merge-tree
     result, gates of `main` by a Codex worker on a new branch, `pnpm build`, restart 3830765 and 3830929
     by exact PID, live check, push.
   - Context: F-6 decides whether the lifecycle writes `killed` for a live Claude Code session, the
     orchestrator pane included. ao-54 found that a clean `git merge-tree` with R4 still failed 3 tests on
     the merged tree (Known Issues traps); the review ran the full suite on the merge with `main`
     `511c697e` (merge tree `5b039aca`): 3541 passed, 1 expected fail, 29 skipped.
   - Expected outcome: a malformed `ps`, tmux or Herdr answer keeps a live Claude Code session `working`
     after two polls; `ao status` shows every live Claude Code session `working` after the restart.
2. **Design re-check r8 (ao-62)** - read `development/reviews/same_id_design_review_r8_astra6.md`.
   - Both SOUND: the owner decides the order of the implementation rounds RW, R2b-2 and R2b-1.
   - SOUND-WITH-CHANGES or NOT-SOUND: design r9 by ao-52 (template
     `brief-aofork-same-id-design-r8.md`; commit the design to `main` before the reviewer pointer),
     re-check by ao-62.
   - Context: r8 answers r7 M-1 (atomic archive publication), M-2 (creation fence for every spawn caller
     and restore, guarded bootstrap), M-3 (discriminating tests), m-1 (audit by a durable
     `tmuxLaunchToken`).
3. **F-8, then the small R4 follow-ups** - F-8 makes codex, gemini and opencode reject a handle with no
   positive PID, as Claude Code does after F-6; one worker after F-6 lands. F-3, F-4, F-5 and F-7 on the
   owner's choice.
4. **Killed-status r8 m-1, I-5 follow-ups, project guide, test isolation, `0005` phases** - owner choice.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect `main` =
   `origin/main` at the handover commit. ` D test-ao-config2.yaml` is an old working-tree deletion; leave it
   and never commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao session ls -p
   agent-orchestrator` - expect ao-52, ao-54, ao-60, ao-62 and the orchestrator records. `ps -o pid=,args= -p
   3830765,3830929,2833081,3760585,2246299,2610857` - expect the two lifecycle workers and the four watchers.
3. `head -1 /home/taisung/.worktrees/agent-orchestrator/ao-{52,54,60,62}/.agent_report.md` - a `running|`
   line means the round still runs. On `done|` from ao-60 or ao-62: copy the review to `main`, close the
   router row, commit, then ask the owner (Next Priorities 1 and 2).

## Key Files

- `development/reviews/claude_strict_process_review_r1_astra6.md` and
  `development/reviews/same_id_design_review_r8_astra6.md` - the two reviews that run (in the reviewers'
  worktrees until copied).
- `development/reviews/same_id_design_r8_opus.md` (section 0 is the response table) and
  `same_id_design_review_r7_astra6.md`.
- `docs/DEVELOPMENT.md` "Absence forms of the R4 reads" - the 11-row table that F-6 applies to Claude Code.
- `packages/plugins/agent-claude-code/src/index.ts` - `findClaudeProcess`, `isProcessRunning`,
  `showsChoiceDialog` (F-6 and m-1).
- `~/.cache/agent-skills-haiku55-arc/` - briefs (`brief-review-claude-strict-process-astra.md`,
  `brief-review-same-id-design-r8-astra.md`, `brief-aofork-same-id-design-r8.md`,
  `brief-validate-main-r4-astra.md` as templates), `reports/`, `backup/`, and `restart_lifecycle.py`
  (`<pid>` dry run, `<pid> --do`).

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): same-ID R4 (`32c687b2..56a385fb`), the claude-code
  `detectActivity` round (`63932b9a..9938d5d1`), R2a, the Codex send fix, R1, the killed-status fix.
- [Decisions](TODO_TRACKING.md#decisions): D-3 (no worker builds in the primary checkout), D-6 (what
  blocks landing in a review of a race fix), D-7, D-8 (same-ID OD-2 to OD-29).
- [Known Issues](TODO_TRACKING.md#known-issues): the same-ID entry with F-1 to F-8, "Traps found in the
  killed-status and same-ID rounds" (now with the merge-tree trap), the claude-code `detectActivity` entry
  (F-6 and m-1), the Codex send entry, "Traps found in the I-5 rounds".

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this host
runs from this checkout's `dist`, so every fleet runs what you land after a rebuild. Only you rebuild, only
on the owner's word (D-3), and a rebuild reaches a running `ao lifecycle-worker` only after a restart by
exact PID with `~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py` (now 3830765 and 3830929).

Same-ID R4 and the claude-code `detectActivity` round are landed, live and pushed. Two Codex reviews run
and report through watchers: ao-60 reviews F-6 and m-1 of ao-54 (`b97a2500..6ea435a8`), and ao-62
re-checks design r8 of RW and R2b-2 by ao-52. Do First Actions 1 to 3, then act on each `done|` line as
Next Priorities 1 and 2 say. Ask the owner in plain text with numbered options (a watcher can paste into
this pane, so never open an AskUserQuestion dialog).

Operating rules until R2b and R3 land: run `ao` only from a shell on the default tmux server (never inside
a private server pane, never with another `TMUX` or `TMUX_TMPDIR`); do one operation on a session ID at a
time. A regular `ao send` to an idle Claude Code pane works since 07:46 EDT. For Codex use `--no-wait`,
then capture the pane; send one bare Enter only on your own text. A raw `tmux -t` of your own needs
`=name` or `=name:`. Before a paste into a worker pane, check that the owner is not attached and active
there (`tmux list-clients`; activity within the last 10 minutes means hold).

Landmines. Spawn with a pointer title that says to wait for `.agent_task.md`; every brief forbids push
and PR in section 0, protects the lifecycle PIDs, and requires `env -i` with a fake `HOME` for every `ao`,
`node` and test call, `env -u TMUX tmux -L <unique>` for every tmux call, and an empty `find
~/.agent-orchestrator -maxdepth 3 -newer <marker> ...` at the end; check it yourself. Pin `--model` on every
spawn. Commit a design or review to `main` before you send its reviewer the pointer. Before a branch switch
in a worker tree, compare with `cmp` the untracked files that the target branch tracks and move them to
`~/.cache/agent-skills-haiku55-arc/backup/`. Use `set -o pipefail` and check HEAD before `ao send`. A clean
`git merge-tree` is no proof that two rounds pass together: run the suites on the merged tree. The gitleaks
hook reads JSON `"key"` and `"token"` fields as secrets; never bypass it. Kill only exact PIDs; never
`pkill` or `killall`. Commit messages are `docs(development): ...` with no `Co-Authored-By` trailer and no
emoji. Ask the owner before any push.
