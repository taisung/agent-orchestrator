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
gpt-6-astra). Both were dispatched at 12:09 EDT on top of `c516cead`. R1 (exact tmux targets) LANDED as
`64ee65b4..5e8fc14b`, was built at 13:46 EDT and is live in both lifecycle workers since 13:47 EDT, so
the tmux prefix match (D-A) is fixed for every `ao` process of the new build. Until R2 lands, `ao` with
its tmux calls on another server (D-B, critical) stays live. Operating rules until then are in the Next
Session Start Prompt.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`.

| Session | State | Disposition |
| --- | --- | --- |
| ao-orchestrator | this session, primary checkout, `main`; record `working`/`stuck` since 2026-10-21 10:24:59 (`generation=1`) | transcript `~/.claude/projects/-home-taisung-local-agent-orchestrator/d1cd4fa3-37cc-4619-856a-56f78cdf584d.jsonl` since about 12:00 EDT (the earlier part: `aeb5b549-6146-4d51-af32-1a0ae26c77e4.jsonl`) |
| ao-orchestrator-1 | stale `killed` record, no worktree | leave |
| ao-51 | Codex `--model gpt-6-astra`, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-51`, branch `feat/same-id-design-review-read-agent-task-md-in-your-worktree-an`, moved to `c516cead`. Cross-family review of the design for R2 to R4; review file `development/reviews/same_id_design_review_r1_astra6.md` in its worktree (not committed); brief `~/.cache/agent-skills-haiku55-arc/brief-review-same-id-design-astra.md`, scratch `/tmp/aosdr`; dispatched 12:09 EDT. DONE 12:27 EDT: R2 NOT-SOUND, R3 NOT-SOUND, R4 SOUND-WITH-CHANGES (B-1 to B-7, M-1 to M-4), no R1 notes; review on `main` (`bee93ab3`); router row closed `in-review`. Idle; `weekly 81% left`, context 68% used RE-CHECK r2 of design r2 dispatched 13:37 EDT (branch fast-forwarded to `628e0fbf`; brief `brief-review-same-id-design-r2-astra.md`; review file `same_id_design_review_r2_astra6.md`; it also checks the effect of a name per launch on `fleet_watch.sh`, `ao_relaunch.py` and pane captures); DONE 13:55 EDT: R2a, R2b, R3a, R3b NOT-SOUND, R4 SOUND-WITH-CHANGES; 5 B, 3 M, 1 m (`same_id_design_review_r2_astra6.md`, on `main` at `3843a025`); router row closed `in-review` | ROUND 3 DONE 16:08 EDT: R4 SOUND; RW NOT-SOUND (B-1 a sourced old helper outlives the drain; M-1 inbox lifetime); R2b-1 NOT-SOUND (B-4 a legacy kill-by-name can destroy a new token launch); R2b-2 SOUND-WITH-CHANGES (M-2 failed association has no recovery); R3a NOT-SOUND (B-2 a `setsid` child escapes the process group); R3b NOT-SOUND (B-3 the API request is not bound to the locked store; M-3 reconciliation); RH SOUND-WITH-CHANGES (M-4); m-1 `any[]` in a test; 4 B, 4 M, 1 m; review on `main` at `58d1d0ac`; router row closed `in-review`; context 54%; the owner chooses the next step |
| ao-52 | Claude Code Opus 5.5, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-52`, branch `feat/same-id-design-r2-read-agent-task-md-in-your-worktree-and-ex`. Design r2 DONE (`628e0fbf`, on `main` as `development/reviews/same_id_design_r2_opus.md`; report `reports/ao-52_same_id_design_r2.report.md`). Branch moved with `reset --keep` to `cbfbc182` (= `main` + its two test commits as cherry-picks; its untracked design r2 copy was identical to `main` and was removed first). DESIGN r3 (owner "2a 3a 4a", 2026-10-21): R2b, R3a, R3b and the Herdr close; OD-17 (b) stable name plus a launch token that tmux checks before every pane mutation; the review table is the basis for OD-2 to OD-16; brief `brief-aofork-same-id-design-r3.md`, design file `same_id_design_r3_opus.md`, marker `/tmp/aosd3-marker`, servers `aosd3-*`. Brief and `running|` line written 14:13 EDT; the notice waited for the owner's attached client (`tmux a`, pid 3657573) and went out at 14:22 EDT after 626 s of client idle time; DONE 15:39 EDT at `c8a35d47` (`cbfbc182..c8a35d47`, 4 test commits: the r2 tmux and Herdr oracles corrected to measured behavior, 11 failing reproducers in 4 new r3 files); design `development/reviews/same_id_design_r3_opus.md` (2567 lines, on `main` at `8b17aeab`); round plan R4, RW (an append-only inbox replaces the unlocked shell writers), R2b-1 (token guard), R2b-2 (legacy resolver, associate, retire, inventory, `ao session where`), R3a (process-group supervisor with a journal), R3b (OpenCode store namespace), RH (optional Herdr close); new OD-18 to OD-21; full run 3006 passed, 22 expected fail, 29 skipped; report `reports/ao-52_same_id_design_r3.report.md`; router row closed `in-review` | keep: author of a design r4 if round 3 needs one |
| ao-54 | Claude Code Opus 5.5 (`--model claude-opus-5-5`), worktree `/home/taisung/.worktrees/agent-orchestrator/ao-54`, branch `feat/codex-send-idle-read-agent-task-md-in-your-worktree-and-exec`, base `09546110`. The Codex send fix (owner "4a"). DONE by 14:42 EDT at `4ec62a0a` (tip committed 14:30) (`09546110..4ec62a0a`: `8c4c9d81` Codex `detectActivity` reads a composer with no running-turn row as idle; `ccec6ee4` `paste-buffer -p` for long messages, for EVERY agent on the tmux path; `fae9bbc1` the verify loop gives one more Enter only to its own unsubmitted text and prints "processing" only for a running turn or an emptied composer; `4ec62a0a` docs). Gates 2958 passed, 4 expected fail, 29 skipped; 10.83 USD. Report `reports/ao-54_codex_send_idle.report.md` (follow-ups 5 to 9 at its end); router row closed `in-review` | ROUND 2 DONE 16:08 EDT at `4128c5a8` (`4ec62a0a..4128c5a8`, 3 commits): no key to a Codex pane after the send; the lines "processing", "not submitted: the text is still in the input box of <session> (tmux pane <target>)" and "could not confirm"; one shared parser `agent-codex/src/codex-screen.ts` (composer in column 0, a selection list only with a neighbour numbered row, the footer by position, a running turn wins in a doubt layout); tests pass with and without `-p` (revert of `ccec6ee4` checked in a scratch clone); 2978 passed, 4 expected fail, 29 skipped; open point: the old `hasUnsubmittedCodexInput` Enter still runs for the other agents (kept byte for byte by the brief); report `reports/ao-54_codex_send_idle_round2.report.md`; router row closed `in-review` |
| ao-56 | Codex `--model gpt-6-astra`, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-56`, branch fast-forwarded to `4ec62a0a`. REVIEW r1 of the Codex send fix (brief `brief-review-codex-send-idle-astra.md`, review file `codex_send_idle_review_r1_astra6.md`, marker `/tmp/aocsr-marker`, servers `aocsr-*`); a separate verdict for `ccec6ee4` (`-p`), and a live check for the orchestrator after the landing. Spawned 14:43 EDT; it read the brief by itself at 14:46. DONE 15:07 EDT: NOT-LAND-SAFE, 2 B (B-1 the rescue Enter accepts a prefix or any `[Pasted Content]` as its own text; B-2 a quoted transcript hides a running turn, so `detectActivity` answers idle), 2 M (M-1 disappearance printed as processing; M-2 a message that starts with `1. ` keeps the false active), 1 m (m-1 the three commits pass their tests only with `ccec6ee4`); `ccec6ee4` (`-p`): LAND-SEPARATELY, with a live check on one idle real pane of each agent type after the landing. Review on `main` at `1286943e`; router row closed `in-review` | ROUND 2 DONE 16:26 EDT: NOT-LAND-SAFE, 0 B, 3 M (all a false "processing": M-1 the doubt rule reads history words above a finished turn; M-2 a two-item numbered message reads as a menu and its words as activity; M-3 the CLI skips the approval priority of `detectActivity`), 7 follow-ups (F-7: a Codex pane whose metadata does not resolve falls back to Claude Code and its retry loop); `ccec6ee4` LAND-SEPARATELY (clean revert); review on `main`; router row closed `in-review` | keep for a short round-3 re-check |
| ao-55 | Claude Code Opus 5.5 (`--model claude-opus-5-5`), worktree `/home/taisung/.worktrees/agent-orchestrator/ao-55`, branch `feat/same-id-r2a-read-agent-task-md-in-your-worktree-and-execute`, base `cbfbc182`. SAME-ID R2a (owner "1a"). DONE by 15:00 EDT at `ac1cbf4b` (tip committed 14:53) (`cbfbc182..ac1cbf4b`, 8 commits, 27 files): `stopRuntime` with one added fallback row (a resolved destroy then "no server" is `destroyed`: a healthy kill of the last session ends the tmux server), refusal in kill, cleanup, rollback, orchestrator start, restore (N-2) and recovery, `ao session kill`/`restore` exit 1 with `Next:`, `ao status` shows `launchFailed`, the lifecycle gate, tmux `destroy` rejects other errors, Herdr `stop` answers `unknown`. Red mode R2 9 to 0 in the core r2 file only; full run green; 19.80 USD. Availability changes (report section 8): with no tmux server running, a kill, cleanup or restore refuses; `ao stop` exits 1 on a refusal before it stops the lifecycle worker. Report `reports/ao-55_same_id_r2a.report.md`; router row closed `in-review` | ROUND 2 DONE 16:06 EDT at `3612c2fd` (`ac1cbf4b..3612c2fd`, 7 commits): restore runs the workspace checks before the copy-back, decides the old stop before any workspace change, and on a refusal removes only its own copy-back under the record lock (the conditional-transaction form of review r1); `stopRuntime` never rejects; `ao stop` and runtime-only cleanup report refusals with `Next:`; the Herdr text says a retry cannot help; core 1552 tests, full run green; report `reports/ao-55_same_id_r2a_round2.report.md`; router row closed `in-review` |
| ao-57 | Codex `--model gpt-6-astra`, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-57`, branch fast-forwarded to `ac1cbf4b`. REVIEW r1 of R2a (brief `brief-review-same-id-r2a-astra.md`, review file `same_id_r2a_review_r1_astra6.md`, marker `/tmp/aor2ar-marker`, servers `aor2ar-*`); it also rates the availability changes. Spawned 15:03 EDT; it read the brief by itself at 15:05. DONE 15:20 EDT: NOT-LAND-SAFE, 0 B, 1 M (M-1: a refused restore has already copied the archived record back and recreated the worktree, `session-manager.ts:4307`, `:4345` before the gate at `:4383`), 1 m (m-1: `stopRuntime` can reject on a thrown null-prototype object or a throwing getter), F-1 old kill skip guards, F-2 recovery assessment trust, F-3 outer CLI diagnostics (`ao stop`, `ao send`, cleanup print no `Next:`); every availability change rated correct; 6 mutants caught; gates pass. Review on `main` at `6dd4d948`; router row closed `in-review` | ROUND 2 DONE 16:21 EDT: NOT-LAND-SAFE, 0 B, 1 M (new M-1: `releaseCopyBack`, `session-manager.ts:1571`, deletes by `launchIdentity` without the generation, so a refused archived restore deletes a `claimPR` or a metadata update made during the stop; the generation in the predicate makes 111 tests pass in a scratch copy), round-1 M-1 partly fixed, m-1 and F-3 fixed; F-1 to F-4 follow-ups (F-4: the copy-back is no operation lock; correct the comment at `:4344` and the report); review on `main`; router row closed `in-review`; context 41% | keep for a short round-3 re-check |

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
form), and the branches of ao-51 (`feat/same-id-design-review-...`) and ao-52 (`feat/same-id-design-r2-...`),
both at `628e0fbf` (ao-52's 50 design-r2 tests, `a5d57b41` and `628e0fbf`, not on `main`).

**Lifecycle workers**: 3624110 (this config, started 2026-10-21 13:46:55) and 3626937 (agent-skills,
13:47:07), both on the R1 build (`5e8fc14b`, built 13:46:27), restarted by exact PID with
`~/agent-skills/scripts/restart_lifecycle.py <pid> --do` after a dry run (1470866 → 3624110, 1471311 →
3626937). No session record changed at the restart. Every brief protects these PIDs (check with `ps` at
dispatch; the running ao-51 brief still names the old PIDs 1470866 and 1471311). The
workers of Nexus, VSF and the Nexus config of this fork do not run until their orchestrators run
`ao start`. The global OpenCode service does not run: an `opencode api` call starts one with the
caller's environment.

**Watchers**: PID 426718 watches ao-57 since 15:04, state `~/.cache/fleet_watch/ao-sameid-r2arev-2026-10-21`.
PID 122818 watches ao-56 since 14:47, state `~/.cache/fleet_watch/ao-codexsend-rev-2026-10-21`.
PID 3845635 watches ao-55 since 14:11, state `~/.cache/fleet_watch/ao-sameid-r2a-2026-10-21`.
PID 3760585 watches ao-54 since 14:04, state `~/.cache/fleet_watch/ao-codexsend-2026-10-21`.
PID 3636904 watches ao-51 since 13:48:13, state `~/.cache/fleet_watch/ao-sameid-d2rev-2026-10-21`. PID 2833081 watches ao-52 since 12:38:07, state
`~/.cache/fleet_watch/ao-sameid-d2-2026-10-21`. Stopped by TERM: 2334310 (ao-50, ao-51) and 2937469
(ao-53) at 13:48:10, 2238373 (ao-49) at 12:25:51, 1346791
(ao-48) at 12:02:39, and 3020940 (ao-46, ao-47) at 11:40:01; each log ends with `EXIT signal SIGTERM`.

Killed on the owner's word (2026-10-21 12:26 EDT): ao-49. Its helpers landed in `~/agent-skills` as
`f121d03` (fast-forward from `2baef80`; orchestrator review: no blocker, four minors in the router row;
`tests/run_all.sh` passed all 15 suites, log `~/.cache/agent-skills-haiku55-arc/run_all-main-f121d03.log`)
and were pushed on the owner's word. Report, brief and the worker's `run_all.out` are in
`~/.cache/agent-skills-haiku55-arc/reports/ao-49_*`. The record is archived
(`ao-49_2026-10-21T16-26-01-276Z`), its branch is deleted (an ancestor of `main`), and `/tmp/ao49hs` with
its orchestrator-prompt snapshot is removed.

Killed on the owner's word (2026-10-21 13:48 EDT, "3a"): ao-50 (R1 author) and ao-53 (R1 reviewer), after
the R1 landing and rebuild. Their reports are in `~/.cache/agent-skills-haiku55-arc/reports/ao-50_*` and
`ao-53_*` (equal to the worktree copies), and both reviews are on `main`. Records archived
(`ao-50_2026-10-21T17-48-21-044Z`, `ao-53_2026-10-21T17-48-21-589Z`); worktrees removed. Their branches
and the ao-48 branch had no `+` line in `git cherry main`, so all three are deleted.
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

**Same-ID arc**: in progress - R1 (ao-50) runs; review r1 of the R2 to R4 design found R2 and R3 not
sound, so the design revision r2 (ao-52) runs, and ao-51 re-checks it. OD-2 to OD-10, OD-12 and OD-13
to OD-16 wait for that re-check.
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

1. **Same-ID round R1, exact tmux targets** - LANDED on `main` as `64ee65b4..5e8fc14b` (2026-10-21, review r2 LAND-SAFE); built 13:46 EDT and live in both lifecycle workers since 13:47 EDT (owner "1a"). Was DISPATCHED to ao-50 (owner "1a", 2026-10-21: OD-1a `=name`
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
2. **Design of R2 to R4, then the remaining owner decisions** - review r1 by ao-51 is DONE (R2 and R3
   NOT-SOUND, R4 SOUND-WITH-CHANGES; `development/reviews/same_id_design_review_r1_astra6.md`). The
   design revision r2 by ao-52 is DONE (`development/reviews/same_id_design_r2_opus.md`, 50 new tests
   at `628e0fbf`, not on `main`). Its re-check by ao-51 is DONE (2026-10-21 13:55 EDT,
   `development/reviews/same_id_design_review_r2_astra6.md`): R2a, R2b, R3a, R3b NOT-SOUND, R4
   SOUND-WITH-CHANGES, 5 blockers (B-1 stop and send act on a reusable name; B-2 the Herdr pre-check can
   close a replacement; B-3 the lock descriptor does not reach grandchildren; B-4 the OpenCode quarantine
   is per project, the lock per store; B-5 the rollout leaves the unlocked shell writers active), 3 majors
   (M-1 the N-3 test oracle; M-2 a name per launch breaks `fleet_watch.sh` and `ao_relaunch.py`; M-3
   legacy association and retire are incomplete), 1 minor (m-1 R4 malformed git output). Landable alone
   now: the R2a core subset (refusals only, with the Herdr close kept unknown) and R4 with m-1. For
   OD-17 the reviewer prefers (b), a stable name with a launch-token guard. The owner answered
   "1a 2a 3a 4a" (2026-10-21, about 14:06 EDT):
   - 1a: the R2a core subset starts now (ao-55, Opus 5.5, then a Codex review); R4 with m-1 follows
     after R2a lands (both change `session-manager.ts`).
   - 2a: ao-52 writes design r3 for R2b, R3a, R3b and the Herdr close; ao-51 re-checks it (round 3).
   - 3a: OD-17 is (b): a stable tmux name (host tools keep working) plus a launch token that tmux checks
     before every pane mutation. No name per launch.
   - 4a: the review's table is the working basis for OD-2 to OD-16; the owner decides the final list
     after round 3.
   - Both ao-55 and ao-52 start from `cbfbc182` (`main` with R1 plus ao-52's 50 r2 tests). ao-55 changes
     only the R2a markings of the core r2 test file; design r3 does not touch that file.
   - Context: R2b and R3 are HIGH; R3a is the largest. R4 (fail-open reads F-8 to F-11) is medium and
     small.
3. **`ao send` to an idle Codex pane says "processing" for an unsubmitted paste** - ao-54 DONE at
   `4ec62a0a` (owner "4a", 2026-10-21; Known Issues, first entry); review r1 by ao-56 is DONE:
   NOT-LAND-SAFE (2 B, 2 M, 1 m; `development/reviews/codex_send_idle_review_r1_astra6.md`), and `-p`
   (`ccec6ee4`) lands separately. The owner answered "1a 2a 3a 4a" (2026-10-21, about 15:33 EDT): no
   automatic Enter for Codex (1a); `ccec6ee4` lands as its own commit with the round, one rebuild, then
   the live check on a real Codex pane and a real Claude Code pane (2a); a short re-check by ao-56 (3a);
   R2a round 2 by ao-55 with M-1, m-1, F-3 except `send.ts` and the Herdr hint, re-check by ao-57 (4a).
   Both rounds DISPATCHED 15:35 EDT. After both re-checks: one landing, one rebuild, one restart of the
   lifecycle workers (on the owner's word), then the live check of review r1 section "Post-landing check". Note: the same
   verify loop printed "could not confirm" for three Claude Code panes today while their turns ran (the
   spinner words `Cultivating…` and `Infusing…`); the fix covers only Codex.
4. **claude-code `detectActivity` dialog fix** - one worker round (Known Issues, the 2026-10-20 entry).
5. **Killed-status r8 m-1** - a small worker change (generation-floor read or doc text).
6. **I-5 follow-ups, project guide, test isolation, `0005` phases** - as before; owner choice.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect `main` =
   `origin/main` at the commit that records the handover close. ` D test-ao-config2.yaml` is an old working-tree
   deletion; leave it and never commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao session ls -p
   agent-orchestrator` - expect ao-51, ao-52 and ao-54 to ao-57, and the orchestrator records. `ps -o pid=,args= -p
   3624110,3626937,2833081,3636904,3760585,3845635,122818,426718` - expect the two lifecycle workers and the six watchers.
3. `head -1 /home/taisung/.worktrees/agent-orchestrator/ao-5{1,2,4,5,6,7}/.agent_report.md` - a `running|` line
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

Until R2 lands: run `ao` only from a shell on the default tmux server (never inside a private server
pane, never with another `TMUX` or `TMUX_TMPDIR`); use `ao send --no-wait` to Claude Code panes; do one
operation on a session ID at a time. After every send to a Codex pane, capture it: `ao send` prints
"processing" for an unsubmitted paste (Known Issues); send one bare Enter only on your own text. The
prefix-match rule ended with the R1 rebuild (13:46 EDT) for `ao`; a raw `tmux -t` of your own still
needs `=name` or `=name:`.

Landmines. Spawn with a pointer title that says to wait for `.agent_task.md`; every brief forbids push
and PR in section 0, protects the lifecycle PIDs 3624110 and 3626937, and requires `env -i` with a fake
`HOME` for every `ao`, `node` and test call, `env -u TMUX tmux -L <unique>` for every tmux call (a missing
`TMUX_TMPDIR` directory falls back to the real default server), and an empty `find ~/.agent-orchestrator
-maxdepth 3 -newer <marker> ...` at the end; check it yourself. Pin `--model` on every spawn; the Codex
default is gpt-6-astra, and Sol stops on lock and race texts (`cyber_policy`). Keep Codex briefs in plain
words. The gitleaks hook reads JSON `"key"` and `"token"` fields as secrets; never bypass it. Clear a stuck
cherry-pick with `--quit`, never `--abort`. Kill only exact PIDs; never `pkill` or `killall`. Commit
messages are `docs(development): ...` with no `Co-Authored-By` trailer and no emoji. Ask the owner before
any push.
