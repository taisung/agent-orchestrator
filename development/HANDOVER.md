# Handover

**Last Updated**: 2026-10-22
**Latest Code Commit**: a20883a0 (test(agents): check the Herdr PID tests against the core they run on) - the last commit of the claude-code F-6 and m-1 round; built and live since 2026-10-22 10:43 EDT
**Session Summary**: [0012_summary_session_2026_10_21_to_22.md](0012_summary_session_2026_10_21_to_22.md)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

Three rounds landed on 2026-10-22. Each is built, live in both lifecycle workers and pushed (TODO What
Landed):

- the claude-code `detectActivity` round, `63932b9a..9938d5d1` (built 07:46 EDT). A regular `ao send` to an
  idle Claude Code pane sends at once.
- same-ID R4, the strict reads, `32c687b2..56a385fb` (built 10:00 EDT).
- the claude-code F-6 and m-1 round, `3c16e89b..a20883a0` (owner "17a"; gates PASS: 3541 passed, 1 expected
  fail, 29 skipped). Built 10:43:19 to 10:43:26 EDT; lifecycle workers restarted by exact PID (3830765 →
  **65891**, 3830929 → **68422**). Live check PASS: 4 polls each, 0 failures, health `ok`; the Claude Code
  sessions read `working` or `stuck`, none `killed` or `exited`. Pushed `8ae3efba..dee08849` at 10:45:23.

**The owner's focus for the next session is Herdr** (answer "18a"): a live check of AO on Herdr 0.9.5,
then the RH round (Next Priorities 1). The owner updated `herdr` from 0.8.0 to **0.9.5** at 10:31:34 EDT.

The same-ID arc has R1, R2a and R4 on `main`. Design r8 of RW and R2b-2 got re-check r8 by ao-62:
SOUND-WITH-CHANGES for both (0 B, 3 M, 0 m). Design r9 waits for the owner's word (Next Priorities 2).
No worker session and no watcher exists at the handover: the owner asked between 10:51 and 10:54 EDT to clean up the
inactive agents, worktrees and branches, so ao-52, ao-60 and ao-62 are closed too. New workers start the
next tasks.

**Update 2026-10-22 11:20 EDT**: the owner ran `ao stop`, then `exit`, then `ao start`. `ao start` created no
orchestrator session (Known Issues, first entry). This orchestrator now runs in a tmux session `0` that the owner
made by hand at 11:02:45; AO does not know it, and the record `ao-orchestrator` reads `killed`. So no watcher can
reach this pane: the orchestrator waits on a worker's report file with a background loop. Owner answer "1":
ao-63 (Claude Code Opus 5.5) fixes both defects, a Codex review follows. Do not run `ao start` before the fix
lands and is built: the record is terminal now, so `ao start` would start a second orchestrator Claude.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees under
`/home/taisung/.worktrees/agent-orchestrator/` (now empty). Briefs and reports: `~/.cache/agent-skills-haiku55-arc/`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`. Transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/d1cd4fa3-37cc-4619-856a-56f78cdf584d.jsonl` | a new session continues here |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |
| ao-63 | Claude Code Opus 5.5, branch `feat/aosns-read-agent-task-md-in-your-worktree-and-execute-it-it`, `dc7815d2..f095f5ce` (4 commits: `c29d6310` start probe, `f2103c5c` detached stop, `67fd166b` docs, `f095f5ce` tests). Report copy `reports/ao-63_start_no_server.report.md`; router row closed in-review | done 11:57; keep until landed |
| ao-64 | Codex gpt-6-astra xhigh, branch `review/start-no-server` at `f095f5ce`. Spawned 12:06:37, brief `brief-review-start-no-server-astra.md` (review file `development/reviews/start_no_server_review_r1_astra6.md`, scratch `/tmp/aosnr`, servers `aosnr-*`, no `ao send`); read its brief by itself 12:07; router row open. Codex weekly limit 22% left at 12:07 | running; the orchestrator's background loop reads `.agent_report.md`. No watcher |

**Closed by this handover**: ao-55 (R4 landed), ao-54 (F-6 landed), and ao-52, ao-60, ao-62 (idle, owner
"clean up inactive agents, worktrees, and branches"). See "Close record" below.

**Lifecycle workers (now)**: 65891 (this config) and 68422 (agent-skills), restarted 2026-10-22 10:43 EDT
by exact PID on the build of `dee08849` (source `a20883a0`). Pid files:
`~/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid` and
`~/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid`. The workers of Nexus, VSF and the
Nexus config of this fork do not run until their orchestrators run `ao start`. The global OpenCode service
does not run: an `opencode api` call starts one with the caller's environment.

**Watchers**: none runs (the last three stopped 10:54:35 EDT). Give each new worker one watcher. Start form:
`FLEET_WATCH_STATE=<state dir> setsid nohup bash /home/taisung/agent-skills/scripts/fleet_watch.sh -o
ao-orchestrator -w /home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20
--preseed <id> <id> < /dev/null > <state dir>/nohup.out 2>&1 &`. Stop with TERM only, then check that the
process ended.

**Router log** (`development/artifacts/model_router_log/log.csv`): no open row. Close a row with
`router_log.py close ... --landed in-review` and token counts: Codex from the last `total_token_usage` of
the rollout, Claude from `trial_cost.py opus-5-5=<jsonl>` (input = input + cache read + cache creation);
subtract the sums of the earlier rows of that session. The rows of the rounds landed on 2026-10-21 and
2026-10-22 (except R1) still read `landed=in-review`; eight rows of 2026-10-15 read `landed=pending`.

**Codex**: the global `~/.codex/config.toml` default is gpt-6-astra; pin `--model` on every spawn
(gpt-6.1-sol stops on lock and race texts, Known Issues traps). The weekly limit of the Codex account was
22% left at 10:46 EDT: plan the reviews of the next session with that.

**Local branches**: `main`; `i3-r2-pre-rebase` (keep: two commits that `main` has only in rewritten
form); `feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex` at `48c26129` (keep: 17 test commits
`73fb5b13..48c26129`, the failing reproducers of the same-ID design r2 to r8, not on `main`; the base of
design r9 and of the RW and R2b-2 rounds). No other branch and no worker worktree exists.

### Close record

- **Pushes** (all fast-forward, owner answers "16c" and "17a"): `b97a2500..511c697e` at 10:03:00 (R4 and 9
  docs commits), `511c697e..116cf549` at 10:06:57 (the first handover), `116cf549..8ae3efba` at 10:18:10
  (the summary doc `1118b876` and the first close record), `8ae3efba..dee08849` at 10:45:23 (F-6 and 4 docs
  commits). CI passed 4 of 4 for `511c697e` and `116cf549`. For `dee08849`, CI, Security and Integration Tests passed;
  the one job of the Onboarding Integration Test (run 39798472621) passed at 10:46:52 EDT, but the run status
  still read `in_progress` at 10:57:37 (a GitHub status delay; its last update was 10:45:56).
- **Watcher retirement** (ao-lifecycle, Session Cleanup), each by TERM, each log ends with `EXIT signal
  SIGTERM`, each `watch.pid` removed, and the `grep -Flzx` check of each state found no process:
  3845635 (ao-55) at 10:07:03 and 3760585 (ao-54) at 10:45:47. Their escalations "the fleet is unwatched"
  covered only that session. Then 2833081 (ao-52), 2246299 (ao-60) and 2610857 (ao-62) at 10:54:35, all
  three ended by 10:54:38.
- **Sessions**: `ao session cleanup -p agent-orchestrator` found no sessions to clean up. `ao session kill`
  archived ao-55 at 10:07:20 (`ao-55_2026-10-22T14-07-20-702Z`) and ao-54 at 10:45:57
  (`ao-54_2026-10-22T14-45-57-812Z`), then ao-52, ao-60 and ao-62 at 10:54:45 to 10:54:46
  (`ao-52_2026-10-22T14-54-45-500Z`, `ao-60_2026-10-22T14-54-46-011Z`, `ao-62_2026-10-22T14-54-46-453Z`), and
  removed their tmux sessions and worktrees. Before each kill: the last report was saved under `reports/`,
  every other untracked file was equal to its copy on `main`, and no client was attached.
- **Branches** (log `~/.cache/agent-skills-haiku55-arc/branch-cleanup-2026-10-22-handover.log`): no branch
  had a merge commit. Deleted with `-d` (ancestors of `main`): `validate/main-r4` 193d2c9e,
  `feat/sdr7-review-read-agent-task-md-in-your-worktree-and-execute` 407ee00d. Deleted with `-D` (no `+`
  line in `git cherry main`): `feat/same-id-r4` e3860672 (21 `-`), `review/same-id-r4-r2` 8e9efe95 (12 `-`),
  `review/same-id-r4-r3` c02c0c02 (18 `-`), `review/same-id-r4-r4` e3860672 (21 `-`),
  `feat/claude-detect-activity` 53cfd6a8 (4 `-`), `feat/claude-strict-process` 6ea435a8 (5 `-`),
  `review/claude-strict-process` 6ea435a8 (5 `-`); `validate/main-claude-strict` 33a2c74c with `-d` (an
  ancestor of `main`). Deleted with `-D` because the tip is a commit of the kept design-test branch (no
  commit lost): `review/same-id-design-r7` fe5d6575 and `review/same-id-design-r8` 48c26129. KEPT:
  `feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex` (17 `+` commits) and `i3-r2-pre-rebase`.

## Open and Blocked Items

**Herdr**: the next focus (owner "18a") - see Next Priorities 1. Until RH lands, a Herdr session cannot be
stopped by `ao`: its `stop` answers `unknown`, so kill, cleanup and restore refuse (R2a, OD-19 (a)).
**Same-ID arc**: in progress - re-check r8 found RW and R2b-2 SOUND-WITH-CHANGES (3 M); design r9 waits for
the owner's word. R2b-1 needs RW first. R3a, R3b, RH and RO come later (owner "5b"); the owner now moves RH
forward. All owner decisions OD-2 to OD-29 are in TODO D-8.
**R4 follow-ups F-1 to F-9**: open - Known Issues, the same-ID entry and the claude-code entry. F-1 and F-2
belong to R2b and R3; F-3, F-4, F-5, F-7, F-8 and F-9 are small worker changes; owner choice.
**Codex send limits**: L-1 and L-2, `development/reviews/codex_send_idle_review_r4_astra6.md`, with its
follow-ups F-1 to F-7. L-1 occurred at 10:28 EDT: the weekly-limit row gave a false "could not confirm"
(Known Issues, Codex send entry).
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

0. **Finish the `ao start` / `ao stop` round (ao-63)** - it runs now (Known Issues, first entry). After its
   `done|`: a Codex gpt-6-astra review, then landing, gates of `main`, build, restart of 65891 and 68422 by
   exact PID, live check and push, each on the owner's word. Then run `ao start` from a shell OUTSIDE tmux to
   get an AO-managed orchestrator again, and continue there.
   - Then **`ao session relaunch <id> [--continue]`** (owner, 2026-10-22: a separate worker round after the
     ao-63 fix lands, because both change the launch code): restart the agent in its existing pane with the
     launch command that `ao` builds at that time; `--continue` keeps a Claude Code conversation. Known
     Issues, the feature entry; the helper `~/agent-skills/scripts/ao_relaunch.py` (`save` before `/exit`,
     `run` after) is the model and the stopgap. It can run beside Herdr step 1 (other code).
1. **Herdr: a live check of AO on Herdr 0.9.5, then the RH round** (owner "18a").
   - State: `~/.local/bin/herdr` is 0.9.5 (the owner ran `herdr update`; binary replaced 10:31:34 EDT). No
     0.8.0 copy exists; a rollback takes the asset `herdr-linux-x86_64` of release v0.8.0 (`gh release
     download v0.8.0 -R ogulcancelik/herdr -p herdr-linux-x86_64`). No herdr server runs. No AO session uses
     Herdr. `~/.config/herdr/` holds the owner's real config and logs.
   - AO's Herdr code on `main`: `runtime-herdr` `create`, `sendMessage` (send and check delivery, doc 0004
     §5), `getOutput`, `isAlive` (R4: false only for the `pane_not_found` code of the error envelope or the
     requested pane with another terminal), `getAttachInfo`; `stop` answers `unknown` and closes nothing;
     `destroy` closes the workspace with no check. The core helper `getHerdrPaneProcesses` is strict (R4
     row 8); claude-code on a Herdr pane rejects a malformed answer (F-6).
   - Everything was measured on 0.8.0 (protocol 19) only: R4's Herdr rows 8 and 9, the RH design (section 7 of
     `development/reviews/same_id_design_r4_opus.md`), the campaigns of doc 0004 (2026-08). No worker brief
     has allowed a real herdr process so far; ao-52's prototypes used an isolated 0.8.0 server, and its first
     run made an update-check network connection at start (design r4 rule slip).
   - Release notes since 0.8.0 on AO's paths: v0.9.0 `workspace close` of a primary workspace with open
     worktree workspaces needs `--group`; v0.9.2 an agent's first task counts as `done` (the settle step of
     `sendMessage` waits for `idle`, `done` or `blocked`); v0.9.4 closing the only pane of a workspace asks
     first (`ui.confirm_close`; the effect on the API is not stated).
   - Step 1, live check (owner's word; one worker, scratch only): a private herdr session (`--session
     <unique>`) with a scratch `HOME` and config, never the owner's `~/.config/herdr`; decide in the brief
     whether the update-check connection is allowed. Measure the version and the protocol (`ping`), then AO
     on a scratch config with `runtime: herdr`: spawn, `ao status` activity (doc 0004 §4.2: the last-activity
     column is blank), `ao send` (send-and-check timing on 0.9.5), `isAlive`, the R4 answer forms (`pane get`
     envelope, `pane_not_found`), the kill refusal, and the three release-note paths. A stand-in agent
     process covers the runtime paths; a real agent turn needs the owner's word. Save the real answers as
     fixtures, and list what doc 0004 must change.
   - Step 2, RH design revision (a new Claude Code Opus 5.5 author, from design r4 section 7): fix review
     r4 M-4 (the ID check rejects the IDs that herdr emits) with the IDs measured in step 1, name the
     qualified version and protocol of 0.9.5, and state what RH needs from RW, R2b and R3. Re-check by a new
     Codex gpt-6-astra reviewer.
   - Step 3, the RH implementation, review, landing, rebuild and live check, each on the owner's word.
   - Expected outcome: a measured table of AO's Herdr paths on 0.9.5, then an RH design that the reviewer
     finds SOUND, then `ao session kill` that stops a Herdr session safely.
2. **Same-ID design r9** - re-check r8 (`development/reviews/same_id_design_review_r8_astra6.md`): M-1 (RW)
   recovery must make the directory durable (`fsync` of the archive directory and of the moved inbox) before
   it removes the active record; M-2 (R2b-2) keep r7's existing-session fence in the replacement creation
   order; M-3 (both) the core caller tests must accept the required `launchToken` and check the durability
   order. On the owner's word: design r9 by a new Claude Code Opus 5.5 author on a new branch from
   `feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex` (`48c26129`), with design r8 and review r8 as its
   input (template `brief-aofork-same-id-design-r8.md`; commit the design to `main` before the reviewer
   pointer), re-check by a new Codex reviewer. It can run beside Herdr step 1 (other files).
3. **F-8, F-9 and the small R4 follow-ups** - F-8: codex, gemini and opencode reject a handle with no
   positive PID, as Claude Code does now. F-9: the 5-second `ps` cache of claude-code keeps a "no process"
   answer for up to 5 s after a process starts. Owner choice.
4. **Killed-status r8 m-1, I-5 follow-ups, project guide, test isolation, `0005` phases** - owner choice.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect `main` =
   `origin/main` at the commit of this handover. ` D test-ao-config2.yaml` is an old working-tree deletion;
   leave it and never commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao session ls -p
   agent-orchestrator` - expect only `ao-orchestrator` and the stale `ao-orchestrator-1`. `ps -o pid=,args= -p
   65891,68422` - expect the two lifecycle workers.
   `herdr --version` - expect 0.9.5.
3. Ask the owner for the Herdr step 1 and design r9 decisions (Next Priorities 1 and 2), in plain text with
   numbered options.

## Key Files

- `development/0004_running_ao_on_the_herdr_runtime.md` - configuration, the send-and-check rule (§5),
  rollout (§7) and known gaps (§8); written on 0.8.0 in 2026-08, before R2a and R4.
- `packages/plugins/runtime-herdr/src/index.ts` - `create`, `destroy`, `stop` (the R2a refusal),
  `sendMessage`, `isAlive`, `parseHerdrResult`.
- `docs/DEVELOPMENT.md` "Absence forms of the R4 reads" - rows 8 and 9 are the Herdr forms.
- `development/reviews/same_id_design_r4_opus.md` section 7 (RH) and
  `development/reviews/same_id_design_review_r4_astra6.md` M-4.
- `development/reviews/same_id_design_r8_opus.md` and `same_id_design_review_r8_astra6.md` - design r9.
- `~/.cache/agent-skills-haiku55-arc/` - briefs (`brief-aofork-same-id-design-r8.md`,
  `brief-review-same-id-design-r8-astra.md`, `brief-validate-main-f6-astra.md` as templates), `reports/`,
  `backup/`, and `restart_lifecycle.py` (`<pid>` dry run, `<pid> --do`).

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): the F-6 and m-1 round (`3c16e89b..a20883a0`), same-ID R4,
  the claude-code `detectActivity` round, the Codex send fix, R2a, R1.
- [Decisions](TODO_TRACKING.md#decisions): D-3 (no worker builds in the primary checkout), D-6 (what
  blocks landing in a review of a race fix), D-8 (same-ID OD-2 to OD-29; OD-19 (a) is the Herdr stop
  refusal, OD-24 the moved-socket limit of RH).
- [Known Issues](TODO_TRACKING.md#known-issues): the same-ID entry with F-1 to F-8, the claude-code entry
  with F-9, "Traps found in the killed-status and same-ID rounds" (the `git merge-tree` trap), the Codex send
  entry (the weekly-limit row).

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this host
runs from this checkout's `dist`, so every fleet runs what you land after a rebuild. Only you rebuild, only
on the owner's word (D-3), and a rebuild reaches a running `ao lifecycle-worker` only after a restart by
exact PID with `~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py` (now 65891 and 68422).

The owner wants this session to focus on Herdr. Same-ID R4 and both claude-code rounds are landed, live and
pushed; no worker session and no watcher exists. `herdr` is 0.9.5 now, but AO's Herdr code was measured only on 0.8.0, and until the
RH round lands `ao` cannot stop a Herdr session. Do First Actions 1 to 3, then propose Herdr step 1 (a
scratch-only live check on 0.9.5) as Next Priorities 1 describes, and ask about design r9. Ask the owner in
plain text with numbered options (a watcher can paste into this pane, so never open an AskUserQuestion
dialog).

Operating rules until R2b and R3 land: run `ao` only from a shell on the default tmux server (never inside
a private server pane, never with another `TMUX` or `TMUX_TMPDIR`); do one operation on a session ID at a
time. A regular `ao send` to an idle Claude Code pane works. For Codex use `--no-wait`, then capture the
pane; send one bare Enter only on your own text; "could not confirm" can be false (the weekly-limit row). A
raw `tmux -t` of your own needs `=name` or `=name:`. Before a paste into a worker pane, check that the owner
is not attached and active there (`tmux list-clients`; activity within the last 10 minutes means hold).

Landmines. Spawn with a pointer title that says to wait for `.agent_task.md`; every brief forbids push
and PR in section 0, protects the lifecycle PIDs, and requires `env -i` with a fake `HOME` for every `ao`,
`node` and test call, `env -u TMUX tmux -L <unique>` for every tmux call, and an empty `find
~/.agent-orchestrator -maxdepth 3 -newer <marker> ...` at the end; check it yourself. A Herdr brief also
needs a private herdr session and a scratch herdr config, never the owner's `~/.config/herdr` or a herdr
server that the owner uses. Pin `--model` on every spawn. Commit a design or review to `main` before you
send its reviewer the pointer. Before a branch switch in a worker tree, compare with `cmp` the untracked
files that the target branch tracks and move them to `~/.cache/agent-skills-haiku55-arc/backup/`. Use `set
-o pipefail` and check HEAD before `ao send`. A clean `git merge-tree` is no proof that two rounds pass
together: run the suites on the merged tree. The gitleaks hook reads JSON `"key"` and `"token"` fields as
secrets; never bypass it. Kill only exact PIDs; never `pkill` or `killall`. Commit messages are
`docs(development): ...` with no `Co-Authored-By` trailer and no emoji. Ask the owner before any push.
