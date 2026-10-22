# 0012 Session summary: same-ID R1, R2a and R4, and the two `ao send` fixes (2026-10-21 to 2026-10-22)

**Session**: `ao-orchestrator` (Claude Code, Opus 5.5), primary checkout, `main`. Transcript
`~/.claude/projects/-home-taisung-local-agent-orchestrator/d1cd4fa3-37cc-4619-856a-56f78cdf584d.jsonl`.
**Period**: from the handover close of 2026-10-21 11:40 EDT (`567f75be`) to the final handover of 2026-10-22
after the F-6 landing (pushed 10:45 EDT) and its close steps.
**State at the end**: [HANDOVER.md](HANDOVER.md). Durable records: [TODO_TRACKING.md](TODO_TRACKING.md)
(What Landed, D-8, Known Issues).

## 1. Result

- Six code rounds landed on `main`, each after a cross-family review with the verdict LAND-SAFE, and each
  is built, live in both lifecycle workers and pushed: same-ID R1, same-ID R2a, the Codex send fix, the
  claude-code `detectActivity` round, same-ID R4, and the claude-code F-6 and m-1 round.
- Up to the first handover, `main` grew by 169 commits (`567f75be..116cf549`): 69 worker commits (tests,
  fixes, docs; 2 of them `docs(development)` commits inside the R2a range) by clean cherry-pick, and 100
  orchestrator commits (`docs(development): ...`: reviews, designs, records, the router log). The F-6
  landing added 5 worker commits after it.
- The full test run grew from 2938 passed (gates of R1) to 3541 passed, 1 expected fail, 29 skipped (gates
  of `main` after F-6). The same-ID red defects fell to R1 0, R2 16, R3 6, R4 0 (from 17, 8, 6, 11 in
  ao-48's first set; ao-52 added more R2 and R4 reproducers on the way).
- The same-ID design went through revisions r2 to r8 and reviews r1 to r8. All owner decisions OD-1 to
  OD-29 are recorded (TODO D-8). Re-check r8 found RW and R2b-2 SOUND-WITH-CHANGES (3 M); design r9 waits
  for the owner's word.
- The owner updated `herdr` from 0.8.0 to 0.9.5 and set Herdr (a live check, then the RH round) as the
  focus of the next session (answer "18a").

## 2. What landed

Details, file lists and every measured number are in [TODO_TRACKING.md "What Landed"](TODO_TRACKING.md#what-landed).

| Round | Range on `main` | Author | Reviewer | Rounds / reviews | What it does |
| --- | --- | --- | --- | --- | --- |
| same-ID R1, exact tmux targets | `64ee65b4..5e8fc14b` (8 commits) | ao-50 (Opus 5.5), tests by ao-48 | ao-53 (Codex gpt-6-astra) | 2 / 2 | every tmux call with a target uses `=name` or `=name:`; a name outside `[a-zA-Z0-9_-]` is refused; the prefix match of plain `-t` targets (D-A) is gone |
| same-ID R2a, refusals only | `f98aa6e7..18810ae4` (21 commits) | ao-55 (Opus 5.5), tests by ao-52 | ao-57 (Codex gpt-6-astra) | 4 / 4 | kill, cleanup, restore and stop keep the record and the worktree after an unconfirmed runtime stop and name the next action |
| `ao send` to a Codex pane | `2c5c4f88..e3be12a9` (15 commits) | ao-54 (Opus 5.5) | ao-56 (Codex gpt-6-astra) | 4 / 4 | "processing" only for a real running status block; no key after the message; long messages as a bracketed paste (`paste-buffer -p`, for every agent) |
| claude-code `detectActivity` | `63932b9a..9938d5d1` (4 commits) | ao-54 | ao-56 | 1 (with Amendment 1) / 1 | reads the input box, not words; a dialog is `waiting_input`; the verify loop sends no Enter into a dialog; a regular send to an idle pane sends at once |
| same-ID R4, strict reads | `32c687b2..56a385fb` (21 commits) | ao-55 | ao-57 (r1), ao-60 (r2 to r4) | 4 / 4 | 11 reads answer "gone" only for an exact, well-formed absence form (table "Absence forms of the R4 reads" in `docs/DEVELOPMENT.md`); every other answer rejects as unknown |
| claude-code F-6 and m-1 | `3c16e89b..a20883a0` (5 commits) | ao-54 | ao-60 | 1 (one block, owner "go 1a") / 1 | `findClaudeProcess` uses R4's absence forms, so a malformed `ps`, tmux or Herdr answer no longer makes a live Claude Code session `killed`; a quoted numbered list is no dialog |

Also landed, in `~/agent-skills`: the session helpers of ao-49 as `f121d03` (fast-forward, pushed on the
owner's word).

Landing procedure used for every round: `git merge-tree --write-tree main <tip>`, a cherry-pick of the
reviewed range (no `-x`), a check that the tree equals the merge-tree result, the gates of `main` by a Codex
worker, `pnpm build` in the primary checkout, a restart of the lifecycle workers by exact PID, a live
check, and the push. Every step after the review waited for the owner's word.

## 3. Builds, restarts and live checks

| Build (EDT) | Source | Lifecycle workers (this config, agent-skills) | Live check |
| --- | --- | --- | --- |
| 2026-10-21 13:46:27 | R1 `5e8fc14b` | 1470866 → 3624110, 1471311 → 3626937 | no session record changed at the restart |
| 2026-10-21 22:37:15 to :21 | R2a and the Codex send fix (combined gates `dbbaf472`: 3225 passed, 11 expected fail) | 3624110 → 1294181, 3626937 → 1294364 | 22:41 to 22:59 on disposable ao-58 (Codex 0.163.0, gpt-6-luna) and ao-59 (Claude Code 2.1.307, Haiku 5.5): Codex PASS; Claude Code found the old footer pattern (fixed by the next round) |
| 2026-10-22 07:46:03 to :10 | claude-code round (gates `ce93ba67`: 3269 passed) | 1294181 → 2002324, 1294364 → 2002831 | 07:47 to 07:56 on disposable ao-61 (Claude Code 2.1.308, Sonnet 5.5): PASS |
| 2026-10-22 10:00:04 to :11 | R4 (gates `193d2c9e`: 3464 passed) | 2002324 → 3830765, 2002831 → 3830929 | 10:02: 5 polls each, 0 failures, health `ok`, no live session `killed` or `exited` |
| 2026-10-22 10:43:19 to :26 | F-6 and m-1 (gates `33a2c74c`: 3541 passed) | 3830765 → 65891, 3830929 → 68422 | 4 polls each, 0 failures, health `ok`; the Claude Code sessions read `working` or `stuck` |

`WRAPPER_VERSION` stayed 0.2.6, and `~/.ao/bin` did not change at any build.

## 4. Pushes

| Time (EDT) | Range | Content | CI |
| --- | --- | --- | --- |
| 2026-10-21 13:49:58 | `567f75be..09546110` | R1 and its records | 4 of 4 passed |
| 2026-10-21 23:02:16 | `09546110..48f500af` | R2a, the Codex send fix, the live check | 4 of 4 passed |
| 2026-10-22 08:01:24 | `48f500af..7051f71d` | the claude-code round (17 commits) | 4 of 4 passed |
| 2026-10-22 08:24:02 | `7051f71d..407ee00d` | docs: the cleanup record | 4 of 4 passed |
| 2026-10-22 09:02:02 | `407ee00d..b97a2500` | docs: design r7, reviews, answers "10a" to "14a" | 4 of 4 passed |
| 2026-10-22 10:03:02 | `b97a2500..511c697e` | R4 (21 commits) and 9 docs commits | 4 of 4 passed (last at 10:09:12) |
| 2026-10-22 10:06:58 | `511c697e..116cf549` | the handover | 4 of 4 passed (last at 10:17:42) |
| 2026-10-22 10:18:10 | `116cf549..8ae3efba` | this summary and the first close record | - |
| 2026-10-22 10:45:23 | `8ae3efba..dee08849` | F-6 and m-1 (5 commits) and 4 docs commits | see HANDOVER close record |

All pushes were fast-forward. No force-push, no PR.

## 5. The same-ID design

The arc fixes "launches that share a tmux name, a tmux server and a worktree path" (design r1 by ao-48,
before this session). R1, R2a and R4 are landed. The remaining rounds are RW (record writes through an
inbox and a stopped-fleet barrier), R2b-1 (launch-token guard), R2b-2 (legacy resolver, association,
creation fence, audit), then R3a, R3b, RH and RO later (owner "5b").

| Design | Author | Review | Reviewer | Verdict of the review |
| --- | --- | --- | --- | --- |
| r1 (before this session) | ao-48 | r1 | ao-51 | R2, R3 NOT-SOUND; R4 SOUND-WITH-CHANGES |
| r2 | ao-52 | r2 | ao-51 | R2a, R2b, R3a, R3b NOT-SOUND; R4 SOUND-WITH-CHANGES (5 B, 3 M, 1 m) |
| r3 | ao-52 | r3 | ao-51 | R4 SOUND; RW, R2b-1, R3a, R3b NOT-SOUND; R2b-2, RH SOUND-WITH-CHANGES (4 B, 4 M, 1 m) |
| r4 | ao-52 | r4 | ao-51 | R2b-1 SOUND; RH SOUND-WITH-CHANGES; RW, R2b-2, R3a, R3b, RO NOT-SOUND |
| r5 (RW, R2b-2 only) | ao-52 | r5 | ao-51 | both NOT-SOUND (2 B, 2 M) |
| r6 | ao-52 | r6 | ao-51 | RW NOT-SOUND, R2b-2 SOUND-WITH-CHANGES (1 B, 2 M) |
| r7 | ao-52 | r7 | ao-62 (new reviewer; ao-51 was at 90% context) | both SOUND-WITH-CHANGES (0 B, 3 M, 1 m) |
| r8 | ao-52 | r8 | ao-62 | running at the end |

Main design choices (decisions in TODO D-8): a stable tmux name with a launch token that tmux checks before
every pane mutation (OD-17 (b)), no name per launch; a stopped-fleet barrier for RW; an unreadable process
identity blocks admission unless the owner allows that exact PID and start time (OD-27 (b)); a fence for
pending names on a running server, with the no-server case a named residual until R3a (OD-28 (b)); the
core r5 race tests scope their allows with a test-only `processScope` (OD-29 (a)).

## 6. Sessions

Token counts are the sums of the router log rows (`development/artifacts/model_router_log/log.csv`).

| Session | Agent and model | Work in this session | Input / output tokens | Disposition at the end |
| --- | --- | --- | --- | --- |
| ao-49 | Claude Code, Opus 5.5 | session helpers in `~/agent-skills` (`f121d03`) | 6.6M / 91K | killed 2026-10-21 12:26 |
| ao-50 | Claude Code, Opus 5.5 | R1 author (2 rounds) | 49.6M / 169K | killed 13:48 |
| ao-51 | Codex, gpt-6-astra | design reviewer r1 to r6 | 26.2M / 211K | killed 2026-10-22 08:19 (context 90%) |
| ao-52 | Claude Code, Opus 5.5 | design r2 to r8 | 319.1M / 2.18M | killed 2026-10-22 10:54 (owner cleanup) |
| ao-53 | Codex, gpt-6-astra | R1 reviewer (2 reviews) | 7.3M / 60K | killed 13:48 |
| ao-54 | Claude Code, Opus 5.5 | Codex send fix (4 rounds), claude-code `detectActivity`, F-6 and m-1 | 166.9M / 948K | killed by the handover 10:45 |
| ao-55 | Claude Code, Opus 5.5 | R2a (4 rounds), R4 (4 rounds) | 294.9M / 1.21M | killed by the handover 10:07 |
| ao-56 | Codex, gpt-6-astra | Codex send and claude-code reviewer, gate runs | 23.0M / 193K | killed 08:19 |
| ao-57 | Codex, gpt-6-astra | R2a reviewer r1 to r4, R4 review r1 | 18.7M / 137K | killed 08:19 (context 90%) |
| ao-58, ao-59, ao-61 | Codex gpt-6-luna; Claude Code Haiku 5.5; Claude Code Sonnet 5.5 | disposable live-check sessions | not logged | killed after each check |
| ao-60 | Codex, gpt-6-astra | R4 reviewer r2 to r4, gates of `main` after R4 and after F-6, F-6 review r1 | 18.4M / 149K | killed 10:54 (owner cleanup) |
| ao-62 | Codex, gpt-6-astra | design reviewer r7, re-check r8 | 10.2M / 65K | killed 10:54 (owner cleanup) |

Every author was Claude Code on Opus 5.5 and every reviewer was Codex on gpt-6-astra (cross-family). Every
brief forbade push and PR, protected the lifecycle PIDs, and required `env -i` with a fake `HOME`, private
tmux servers (`env -u TMUX tmux -L <unique>`) and an empty `find -newer <marker>` check at the end.

## 7. Problems found and what changed

- **`ao send` to an idle Codex pane printed "processing" for a paste that stayed in the composer** (13:36,
  2026-10-21). Until the fix landed, every Codex send was captured and got one bare Enter only on the
  orchestrator's own text. Fixed by the Codex send round.
- **A regular `ao send` to an idle Claude Code pane in bypass mode was refused**: the old footer pattern
  read the idle pane as `waiting_input` (measured 22:45, 2026-10-21, 3 of 3 sends refused). Until the fix,
  sends to Claude Code panes used `--no-wait`. Fixed by the claude-code `detectActivity` round.
- **A clean `git merge-tree` did not prove that two rounds pass together** (ao-54, 2026-10-22): F-6 and R4
  merged as text, but 3 tests failed on the merged tree. Recorded as a trap in Known Issues; the F-6
  review runs the suites on the merge with `main`.
- **Worker blocks on a pinned old answer**: ao-55 (R4 item 8) and ao-54 (F-6) each stopped with `blocked`
  when an existing test pinned a fail-open answer that the fix removes. The owner allowed exact oracle
  changes (R4 Amendment 1; "go 1a" for 4 tests of `agent-claude-code/src/index.test.ts`).
- **Rule slip in design r4**: one Herdr run of ao-52 made an update-check network connection before its
  config was written; its own isolation check stopped it, and no real file was read.
- **The owner answered in a worker pane**: "go 1a" was typed directly into the ao-54 pane at 09:20:04; the
  orchestrator found it in the ao-54 transcript and recorded it.
- **Orchestrator errors, corrected**: an estimated time ("09:0x") in the handover, corrected to the
  measured "by 09:01:40" in `b97a2500`; a wrong count of unpushed commits in a status answer (said 2, was
  3). Rule kept: take every time from `date` or a file time.
- **Harness limits found in the live checks**: the Claude Code harness blocks a foreground `sleep 150`
  (`python3 -c "import time; time.sleep(150)"` ran); the verify loop printed a false "could not confirm"
  after a 1 s reply.

## 8. Open at the end

The full list is in [HANDOVER.md "Open and Blocked Items"](HANDOVER.md). The items of this session:

- Herdr (the focus of the next session): a live check of AO on 0.9.5, then the RH round. Until RH, `ao`
  cannot stop a Herdr session (its `stop` answers `unknown`).
- Same-ID design r9 for re-check r8 M-1 to M-3, on the owner's word.
- R4 follow-ups F-1 to F-9 (TODO Known Issues); F-8 makes codex, gemini and opencode reject a handle with
  no positive PID, as Claude Code does after F-6; F-9 is the 5-second `ps` cache of claude-code.
- Codex send limits L-1 and L-2 and its follow-ups F-1 to F-7
  (`development/reviews/codex_send_idle_review_r4_astra6.md`); claude-code limits L-1 to L-3
  (`development/reviews/claude_detect_activity_review_r1_astra6.md`).
- The router log rows of the landed rounds of R2a, the Codex send fix, both claude-code rounds and R4
  still read `landed=in-review` (the R1 rows of ao-50 and ao-53 read `5e8fc14b`).

## 9. References

- Reviews and designs of this session: `development/reviews/same_id_design_r{2..8}_opus.md`,
  `same_id_design_review_r{1..7}_astra6.md`, `same_id_r1_review_r{1,2}_astra6.md`,
  `same_id_r2a_review_r{1..4}_astra6.md`, `same_id_r4_review_r{1..4}_astra6.md`,
  `codex_send_idle_review_r{1..4}_astra6.md`, `claude_detect_activity_review_r1_astra6.md`,
  `combined_gates_r2a_codex_send_astra6.md`, `gates_main_claude_detect_astra6.md`, `gates_main_r4_astra6.md`.
- Briefs, worker reports and branch-cleanup logs: `~/.cache/agent-skills-haiku55-arc/` (`brief-*.md`,
  `reports/`, `branch-cleanup-2026-10-22*.log`).
- Live-check evidence: `~/.cache/agent-skills-haiku55-arc/live-check-2026-10-21/` and
  `live-check-2026-10-22/`.
- Rules added to `docs/DEVELOPMENT.md` by the landed rounds: "tmux Targets", the R2a stop outcome, the
  Claude Code screen rule, "Absence forms of the R4 reads".
