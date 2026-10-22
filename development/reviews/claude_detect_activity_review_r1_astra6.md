# Claude Code activity / send verification review

**LAND-SAFE for `48f500af..53cfd6a8`: 0 blockers, 0 majors, 1 minor (m-1).** The demonstrated idle/bypass and fullscreen-dialog defects are fixed. The generic verification change meets Amendment 1's per-capture rule and preserves the other states' behavior. This verdict accepts the explicitly bounded layout and capture/key limits below; it is not evidence that every possible Claude Code layout is recognized.

Reviewer ao-56, 2026-10-22 EDT; branch `review/claude-detect-activity`, HEAD `53cfd6a802b7620a4c85c3f4d1435d0a979b8c0a`. No source edits or worktree commits. The author brief and Amendment 1 were read before testing; the author report was first read after independent screen classification, source review and the base/head probes for items 1 and 2. The results below are my runs. The brief overrides the launch instructions to push/open a PR: neither was done.

## Independent observations

- Marker `/tmp/aocdr1-marker`; scratch `/tmp/aocdr1/ao56`. Every helper/node/pnpm/test/CLI uses env -i, fake HOME and TMPDIR. PATH has no agent binary; gh denies network operations; tmux unsets TMUX and selects a private server. Gate, replay and other scratch work use only owned resources. Protected workers are 1294181/1294364; no real pane is read.
- All 17 committed fixtures are independently byte-equal to their originals (full SHA-256 matching across the fixture, live-check and as-77 source directories). The built plugin gives their expected states. The six 2.1.304 dialogs change active→waiting_input; three 2.1.304 idle screens change active→idle; four 2.1.304 running screens stay active. Both 2.1.306 running screens change waiting_input→active. 2.1.307 idle-bypass changes waiting_input→idle; **idle-paste-hint changes active→idle**, not waiting_input→idle: its footer has no bypass text.
- The parser finds the last pure rule row within four footer rows, then the preceding pure rule and its prompt. A running answer requires the first column-zero non-panel row above that input box to match the spinner/time pattern. Blank/indented rows and panel borders are skipped. A recognized input box takes precedence over all message/footer words. Without one, a bare final prompt is idle, a numbered-choice dialog is waiting_input, old prompt phrases are checked in the final five rows, and other screens remain active.
- The new non-Codex verification branch calls detectActivity once per capture. waiting_input now prints the answer line and returns with no retry key; active still prints processing; queued text and all nonwaiting retry cases retain their ordering. The initial C-u/text/Enter precedes this loop. A dialog appearing after an idle capture can still receive the retained retry Enter; the new branch is not an atomic capture-and-key guard.
- The Codex branch, idle wait and paste are unchanged. However, the now-unused isActive helper was removed outside the permitted verify loop; this is a literal byte-equality exception, not a behavioral change.
- Synthetic narrow/wrapped probes expose limits: a continuation starting in column zero hides a genuine spinner; wrapping before its time token also returns idle. An indented continuation after a complete spinner/time prefix is active. A fifth footer row hides the input box and returns the fallback active. A column-zero background row between spinner and box stops the scan; its indented counterpart does not. These are derived layouts, not new real captures.
- An indented quoted numbered list with no input box (`● Here is an example:\n  ❯ 1. Red\n    2. Blue`) changes active→waiting_input. The new dialog predicate accepts it without requiring a rule or excluding the preceding transcript header. Assessment and reproducible tests follow.
- The scratch combination is clean: merge base `75f1c98be3b45b37c51cc8eb665f0d01149a55e7`; `git merge-tree --write-tree 8e9efe95 53cfd6a8` returns tree `04f2263aa7b740bd655c6914bfd2dbedeaca6563`. The independent main merge uses base `48f500afb5a0e43e626fcd084a2fba86c805ffc8` and returns `a5706b3afa480b0b5108115328a5bc643262548c`. No branch merge or commit was made.

## Finding

**m-1 — a quoted numbered list can become a dialog when the live input box is absent.** File `packages/plugins/agent-claude-code/src/index.ts:708`, particularly lines 713–716. Category: **made by this range**, in the new `showsChoiceDialog`; nonblocking minor because the reproduction requires a view without the current input box and no supplied real capture demonstrates that view with such a quote. It causes false refusal/false dialog reporting, not an unintended answer key.

Reproducer, using the built plugin's `create().detectActivity`:

```text
● Here is an example:
  ❯ 1. Red
    2. Blue
```

Base: `active`. Head: `waiting_input`. The upward scan reaches row zero without finding a rule, then accepts the indented choices; the preceding transcript header is not considered. A private tmux replay of these exact rows (`cdr-10`) printed `Waiting for cdr-10 to become idle...`, then `Timeout waiting for cdr-10: session is waiting for interactive input; not sending.`, exit 1, no key. Appending the normal live input box changes the answer to `idle`, correctly. The shipped quoted-permission test always retains that box and therefore does not cover this case. Consider requiring evidence of a dialog boundary and rejecting a quote within a transcript entry; preserve the six real dialog fixtures. Do not infer that every no-box view is a dialog.

## Accepted limits and follow-ups

- **L-1 — unobserved layouts, not demonstrated failures of the captured 2.1.30x layouts.** `index.ts:663–700,733`, `docs/DEVELOPMENT.md:328`. I independently reproduced the documented false-idle limits: a running row split before its time (`✻ Waddling…\n  (15s · ↓ 692 tokens)`) and a column-zero continuation (`✻ Waddling… (15s · ↓ 692 tokens · t\nhinking with xhigh effort)`) both read `idle` above a normal box. A complete spinner/time prefix followed by an indented continuation reads `active`. A column-zero `1 agent running in background` between spinner and box hides the spinner; an indented version does not. These are derived plausible layouts, not captures from a real renderer at a narrow width. If emitted, the new false-idle answer would bypass the wait and could trigger retained retries; this is a new heuristic limit, not an old defect being relabeled. I accept it for this bounded fixture-supported fix because there is no real capture establishing those layouts, the docs explicitly delimit them, and all supplied running captures pass. Follow up with real narrow/queued/background layouts before claiming broader support.
- **L-2 — initial Enter and capture-to-key races remain.** `send.ts:312–350,363–364,433–440`. A regular send can capture idle, then have a dialog open before its initial Enter. Likewise, a verify capture of idle can be followed by a dialog before that check's retained retry. `--no-wait` explicitly skips the guard and its initial Enter can answer a question; the new branch prevents only later retries once a capture reads `waiting_input`. Existing mechanism retained by Amendment 1, whose all-other-states rule explicitly requires those retries. Corrected 2.1.304 idle classification now reaches those existing retry paths; do not call that an unconditional no-Enter guarantee. A first-check dialog gets only the send's Enter; idle at check 1 then dialog at check 2 gets one retry, and at check 3 gets two. The author's section-0 ambiguity is resolved in favor of the amendment's explicit per-check rule, as the review brief restates it.
- **L-3 — fallback layouts and provenance.** More than four footer rows, bash `!`, slash menus and unmatched input structures use the fallback (often `active`); an idle pane may therefore wait to timeout and then send. Five-footer-row probe: `active`. Stale spinner rows separated only by skipped rows can remain `active`. No real 2.1.30x permission capture was supplied: the numbered Yes/No screen passes a derived test only. A proposed permission screen that retains a normal input box would be `idle` by box precedence; there is no evidence that the supported renderer does that. The actual AskUserQuestion/free-text/review captures all pass. ASCII-space `❯ 1. ...` is treated as a choice; real composer rows here have NBSP and numbered NBSP input reads idle.
- **F-1 — older classifier/output limitations outside this change.** Gemini's unchanged last-five-row `/approve|confirm/i` can mistake quoted prose for a prompt if its bare prompt is not visible. The new generic branch will truthfully reflect that plugin answer with the answer line, even if the classifier is wrong; it sends fewer keys than before. OpenCode screens that its unchanged detector reads `active` (including the 2.x idle case mentioned in the brief) still produce `processing`, not the new answer line. The available real 2.0.31 idle MUSE/V4FLASH fixtures actually read `idle`, and the available permission/form fixtures read `waiting_input`; I did not fabricate a new 2.x capture. API-capable OpenCode sessions bypass this tmux verification loop entirely. The old fallback to the default Claude plugin when context resolution fails, automatic tmux buffer concurrency, and timeout-to-send-on-active behavior are unchanged.

Reviewer-only derived tests in the scratch copy: 3 failed, 2 passed. Failures are m-1 and the two L-1 wraps; controls are the quote with a live box (`idle`) and indented continuation after a complete spinner (`active`). These tests deliberately assert the broader desired interpretation. They are not part of the green repository gate, and their failures are not concealed in that total.

## Amendment 1 audit

`git diff 48f500af 53cfd6a8 -- packages/cli/src/commands/send.ts` has exactly two hunks: removal of the unused `isActive` helper (base lines 64–66), and the generic loop at head lines 408–427. After excluding those two regions, a byte comparison of the entire file is equal. The Codex branch, idle wait, paste function, queued-message helper, old unsubmitted-input helper, routing and final unconfirmed output are byte-equal.

Thus **literal whole-file-outside-loop byte equality has one exception**, the unused helper removal. I accept that mechanical cleanup: `isActive` had exactly the one replaced caller, and retaining it would create an unused-function lint error. There is no extra behavioral change. This is stated explicitly rather than calling the entire rest of the file byte-equal.

At each generic check the classifier is called exactly once. `waiting_input` prints the separate answer line and returns exit 0; `active` prints processing; otherwise queued text prints queued; otherwise the old unsubmitted-input branch can send Enter even on the last check; otherwise checks 1/2 send Enter and check 3 ends unconfirmed. The latter rescue rule remains applicable to all three non-Codex agents despite its old function name. For the running Claude captures, the result is now **processing with no retry**, replacing the old bypass-induced retries/unconfirmed. Processing means a turn is visible, not that this particular message started it.

## Test audit and mutation method

Worktree tests use the real plugin with mocked tmux, fake timers and exact key-vector assertions. New tests total 44: 26 plugin and 18 CLI. The hash test and real captures do not normalize fixture bytes. Independently matched all 17 byte-for-byte against the external originals, rather than merely trusting the test's hash constants.

Existing test changes are intentional oracle corrections: the bypass-permissions waiting assertion now requires `active` for the standalone phrase and `idle` for the real idle pane; the old priority test drops the `Writing...\nbypass all future permissions...` waiting assertion. Other prior assertions remain. This removes the defect's old oracle, not useful coverage of an actual permission dialog. The numbered permission prompt, old Yes/No prompt and real dialogs have separate positive checks.

Scratch base method: archive `48f500af`, retain its production plugin and send code, overlay only the new fixture files and head plugin/CLI test files; compile the base plugin before built probes. Head control: scratch archive `53cfd6a8`. Both run plugin `src/index.test.ts` and CLI `__tests__/commands/send-claude-code.test.ts`. Head: **138 + 18 passed**. Base: **117 pass/21 fail + 1 pass/17 fail**. Of the 26 new plugin cases, 20 fail base; hash provenance, four already-correct 2.1.304 running captures and the no-dialog-after-reply control correctly pass base. The additional failing plugin case is the deliberately corrected old bypass oracle. The sole base CLI pass is the unchanged stays-idle retry control. Full failing names are recorded below.

Mutants applied one at a time in the scratch head, restored after each run. No production file in this worktree was mutated. Each mutant was caught:

| Variant | Plugin pass/fail | CLI pass/fail | Exit codes |
| --- | --- | --- | --- |
| Unchanged head | 138 / 0 | 18 / 0 | 0 / 0 |
| Base with new tests | 117 / 21 | 1 / 17 | 1 / 1 |
| Restore bypass regex ahead of box handling | 128 / 10 | 9 / 9 | 1 / 1 |
| Spinner words anywhere in a box screen | 135 / 3 | 18 / 0 | 1 / 0 |
| Remove generic waiting_input check | 138 / 0 | 9 / 9 | 0 / 1 |
| My fourth: remove numbered-dialog dispatch | 130 / 8 | 9 / 9 | 1 / 1 |

The words-anywhere mutant checks `/Working|Thinking|Waddling|Orchestrating|esc to interrupt|… \(/i` over the whole output. It is killed specifically by transcript/composer/ended-turn controls; real fixtures alone would miss it. The no-dialog mutant is killed by six real dialogs, trimmed-screen and derived-permission controls, plus the nine Claude-related CLI dialog checks. Removing the new waiting branch is equivalent in relevant behavior to head plugin with base send and reproduces the author's nine failing Amendment 1 tests. The author report's heading says five commits, but its list and Git both contain four; no finding depends on that typo.

## Gates and combination

Every pnpm/node/helper call used `env -i HOME=/tmp/aocdr1/ao56/home PATH=/tmp/aocdr1/ao56/bin:/usr/bin:/bin TMPDIR=/tmp/aocdr1/ao56/tmp LANG=C.UTF-8`. PATH checks returned `None` for `claude`, `codex`, `gemini`, `opencode`, `ao`. Only node/pnpm launchers, an offline gh stub and a tmux shim were added. The shim unsets TMUX and selects `aocdr1-gates-ao56`; replay selects `aocdr1-live-ao56`. No real agent/model turn or network gh call.

| Worktree command | Result |
| --- | --- |
| `CI=true HUSKY=0 pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| `pnpm build` | exit 0; 12 package `build: Done` lines |
| `pnpm --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode --filter @aoagents/ao-cli test` | exit 0; Claude 241, Codex 280, Gemini 67, OpenCode 322, CLI 323 passed |
| `pnpm lint` | exit 0; `5 problems (0 errors, 5 warnings)` in unchanged files |
| `pnpm typecheck` | exit 0; 13 package `typecheck: Done` lines |
| One `pnpm -r --no-bail test` | exit 0; **3269 passed, 11 expected fail, 29 skipped, 0 unexpected failures** |
| `SAME_ID_DEFECTS=red`, 14 defect files across nine packages | **R1 0, R2 16, R3 6, R4 22** failures, total 44; 48 controls passed |

The five lint warnings are `spawn.ts:333`, `activity-log.ts:91`, `plugin-registry.ts:232`, `session-manager.ts:2335,2342`. None is in the reviewed diff. No extra full-suite retry was used to obtain green.

Main advanced by documentation during review. Rechecked at main `8f2bf3fec0ac16d5016a47b13ea266ced865d9c8`: `git merge-base main 53cfd6a8` is `48f500afb5a0e43e626fcd084a2fba86c805ffc8`; `git merge-tree --write-tree main 53cfd6a8` exits 0 and returns **`2fbd0b6d45916b2b0778fc0872dc73d444857d18`**. This supersedes the earlier main merge-tree result in the work log.

For the required R4 combination, `git merge-base --all 8e9efe95 53cfd6a8` returns only **`75f1c98be3b45b37c51cc8eb665f0d01149a55e7`**. Thus it is the unique base used by the actual `git merge-tree --write-tree 8e9efe95 53cfd6a8`, which exits 0 with **`04f2263aa7b740bd655c6914bfd2dbedeaca6563`**, no conflicts. Archived that tree into scratch, built all packages first (exit 0, 12 Done lines), then ran the full Claude and CLI package suites, not just changed tests:

```text
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/cli test:  Test Files  23 passed (23)
packages/cli test:       Tests  323 passed (323)
```

No worktree merge, branch reset or commit was used. Both clean merges were checked again after the suites.

Commit audit: four consecutive single-parent commits on `48f500af`, `0375c0a8 → bf54d8cf → 8b1f1e1f → 53cfd6a8`. All have conventional subjects and explanatory WHY bodies; no Co-Authored-By, emoji or issue number. `git branch -r --contains 53cfd6a8` prints nothing. The core and Codex plugin trees are unchanged by the range.

## What is correct

- Real idle/bypass, running/diff-panel and paste-hint screens are distinguished by their input box and adjacent spinner structure; all supplied 2.1.304 fullscreen dialogs are recognized.
- A normal input box excludes transcript/composer quotations from state, and a completed turn stops the spinner search.
- The waiting-input check precedes both queued-message handling and every generic verification retry. Tests assert keys and output, not merely a classifier result.
- Base regressions, the four independent mutations, full gates, private replay and the actual merged-tree suites provide complementary evidence; none requires a model turn or touches real pane contents.

## Detailed evidence

The following fixture, failing-test and replay tables were generated from my recorded results before scratch cleanup.

### Fixture states and provenance

All hashes are full SHA-256; external sources were read only. A = `/home/taisung/agent-skills/development/artifacts/dialog_paste_2026_10_20/captures/`; F = `/home/taisung/.cache/agent-skills-haiku55-arc/fixtures/`. Names below are relative to the Claude plugin `src/__fixtures__/`.

| Fixture | Base → head | Why head has that answer |
| --- | --- | --- |
| `claude-2.1.304-dialog-t1-01_before.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply |
| `claude-2.1.304-dialog-t3-00b_after_down.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply; moved cursor still open |
| `claude-2.1.304-dialog-t4-00c_typed_text.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply; free-text selection still open |
| `claude-2.1.304-dialog-t5-00_dialog_open.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply |
| `claude-2.1.304-dialog-t5-paste1-03_verify1.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply |
| `claude-2.1.304-dialog-t5-paste3-03_verify1.txt` | active → waiting_input | No input box; last choice cursor and another numbered choice, no following reply; Submit/Cancel review |
| `claude-2.1.304-idle-t1-03_verify1.txt` | active → idle | Input box; nearest column-zero row is a completed-turn/transcript row, not a spinner |
| `claude-2.1.304-idle-t2-02_input_text.txt` | active → idle | Input box; nearest column-zero row is a completed-turn/transcript row, not a spinner |
| `claude-2.1.304-idle-t5-paste4-03_verify1.txt` | active → idle | Input box; nearest column-zero row is a completed-turn/transcript row, not a spinner |
| `claude-2.1.304-running-t2-00b_after_key_2.txt` | active → active | Input box; `✶ Combobulating… (2s · ↓ 126 tokens)` |
| `claude-2.1.304-running-t2-03_verify1.txt` | active → active | Input box; `· Cooking… (1s · thinking)` |
| `claude-2.1.304-running-t4-03_verify1.txt` | active → active | Input box; `✢ Garnishing… (3s · ↓ 164 tokens · thinking)` |
| `claude-2.1.304-running-t8-03_verify1.txt` | active → active | Input box; `✽ Whatchamacalliting… (1s)` |
| `claude-2.1.306-running-01.txt` | waiting_input → active | Input box; `✻ Waddling… (15s · ↓ 692 tokens · thinking with xhigh effort)` |
| `claude-2.1.306-running-diffpanel.txt` | waiting_input → active | Input box; `✢ Orchestrating… (10m 23s · ↓ 52.1k tokens · thinking with xhigh effort)` past panel border/text |
| `claude-2.1.307-idle-bypass.txt` | waiting_input → idle | Input box; nearest column-zero row is a completed-turn/transcript row, not a spinner |
| `claude-2.1.307-idle-paste-hint.txt` | active → idle | Input box; nearest column-zero row is a completed-turn/transcript row, not a spinner |

Original file match and SHA-256 (one source is named when duplicate originals match):

- `claude-2.1.304-dialog-t1-01_before.txt`: `A/t1_one_question_nowait_short/01_before.txt`; `267ba2d0587b949f0ddeeb676946068de7a94b7e36ebb383994f990cc1cbd48e`.
- `claude-2.1.304-dialog-t3-00b_after_down.txt`: `A/t3_moved_selection_nowait_short/00b_after_down_owner_moves_to_blue.txt`; `507f2d19d7250934481e7d8a60c313e476167480b3782746e99fab9eac9ed88d`.
- `claude-2.1.304-dialog-t4-00c_typed_text.txt`: `A/t4_free_text_field_nowait_short/00c_owner_typed_green_please.txt`; `bf484662cf614a56866b99ada0bc8b150be73cbb3dabbb03c0851efee990ca16`.
- `claude-2.1.304-dialog-t5-00_dialog_open.txt`: `A/t5_three_questions_four_pastes/00_dialog_open.txt`; `f339bb1fe8eae0a7f0ed4eeb23b9871524ab48488f16444375e6410a650be4b6`.
- `claude-2.1.304-dialog-t5-paste1-03_verify1.txt`: `A/t5_three_questions_four_pastes/paste1/03_verify1.txt`; `0110b0af58267270b6f49839a836181560a0c4067acbad3300882cfa37aa1e4e`.
- `claude-2.1.304-dialog-t5-paste3-03_verify1.txt`: `A/t5_three_questions_four_pastes/paste3/03_verify1.txt`; `625b6a14e1a99547e83738301dd69fc2c7430e211a5fa080d15bfcdb9acb9317`.
- `claude-2.1.304-idle-t1-03_verify1.txt`: `A/t1_one_question_nowait_short/03_verify1.txt`; `c036944289ab2dee486a0fd3c10e2978312c74481ecbb95297e09bf17ea40b18`.
- `claude-2.1.304-idle-t2-02_input_text.txt`: `A/t2_moved_selection_nowait_short/02_after_text_before_enter.txt`; `82e1de7bfdb258a840bf40b70dbce6ad1dc74ceb02b85acf0d268e697ac14dc4`.
- `claude-2.1.304-idle-t5-paste4-03_verify1.txt`: `A/t5_three_questions_four_pastes/paste4/03_verify1.txt`; `b3395a47a1fa83046810b0391c426ab2f23e990dd6e4b5a7e6bea11e5ed12035`.
- `claude-2.1.304-running-t2-00b_after_key_2.txt`: `A/t2_moved_selection_nowait_short/00b_after_key_2.txt`; `99b471f3b9ccb7866b5e041000ccd0928469216c6f1ba93049937ffc85ee0a21`.
- `claude-2.1.304-running-t2-03_verify1.txt`: `A/t2_moved_selection_nowait_short/03_verify1.txt`; `d593f4865d1835d828b43777b0ffa2c0116f960a9a01311ecf5ec12e2d600dd0`.
- `claude-2.1.304-running-t4-03_verify1.txt`: `A/t4_free_text_field_nowait_short/03_verify1.txt`; `0ffb8897fac95ee46213d4b24d7b7f9309f8eff76146ab1fa8e11aa458afe8f5`.
- `claude-2.1.304-running-t8-03_verify1.txt`: `A/t8_wait_path_owner_answers_first/03_verify1.txt`; `41636e2d4a4eeef3e228abebc1fdd655549563bc1b9b175ecd3bc41f4bc23c8f`.
- `claude-2.1.306-running-01.txt`: `F/claude-2.1.306-running-01.txt`; `fba92a4cd48aa0f66249004ce8a3c0494129183a6768923ef98c81480c890d55`.
- `claude-2.1.306-running-diffpanel.txt`: `F/claude-2.1.306-running-diffpanel.txt`; `3d4436bfe226856446230a61fd623cc1b44cb9c37ad365c25cdfefb56b4b7623`.
- `claude-2.1.307-idle-bypass.txt`: `F/claude-2.1.307-idle-bypass.txt`; `83f9fcc94eb8a7c3b00d959cb604cd6972dfcac56857583943d962101a9de331`.
- `claude-2.1.307-idle-paste-hint.txt`: `F/claude-2.1.307-idle-paste-hint.txt`; `f2e40810d3c002940b065b7f31c78d733a28b878eeb2f0cb47d7d16e53fc5212`.

I also classified the additional ao-59 capture files in the live-check record. Their filenames containing “running” are not ground truth: the inspected screens show completed turns/idle input, and head reads idle. No additional misclassified real running capture was found there.

### Exact base and mutant failures

Suite prefixes are retained below to make each name unambiguous. These are JSON-reporter results, not names predicted from the mutation.

**base**

plugin: 117 passed, 21 failed, exit 1.

- `detectActivity never reads the bypass permissions text as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.307-idle-bypass.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.307-idle-paste-hint.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.306-running-01.txt as active`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.306-running-diffpanel.txt as active`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t1-01_before.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t3-00b_after_down.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t4-00c_typed_text.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-00_dialog_open.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-paste1-03_verify1.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-paste3-03_verify1.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-idle-t1-03_verify1.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-idle-t2-02_input_text.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-idle-t5-paste4-03_verify1.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads the real screens the same with the trailing line end and blank rows left out`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row that a message quotes in the transcript of an idle pane as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row text in the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row with a transcript entry between it and the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a running turn past blank, indented and panel rows (real layouts, more blank rows)`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a quoted permission prompt in a message or in the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a permission prompt in place of the input box as waiting_input (derived layout)`

cli: 1 passed, 17 failed, exit 1.

- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) sends at once to the idle screen claude-2.1.307-idle-bypass.txt in a regular send`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) sends at once to the idle screen claude-2.1.307-idle-paste-hint.txt in a regular send`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits while the pane runs a turn, and sends when it is idle`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t1-01_before.txt and refuses at the timeout, with no key`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t5-00_dialog_open.txt and refuses at the timeout, with no key`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t5-paste3-03_verify1.txt and refuses at the timeout, with no key`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) prints processing for a running turn at the first check, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t1-01_before.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-00_dialog_open.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-paste3-03_verify1.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line when a dialog shows at the first check of a regular send`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key idle, then a dialog: the idle check keeps its retry Enter, the dialog check sends no key`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for a dialog at the last check, after two retry Enters to an idle screen`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to an OpenCode pane that reads waiting_input (real 2.0.31 capture REAL_DIALOG_PERMISSION_80_S20)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to an OpenCode pane that reads waiting_input (real 2.0.31 capture REAL_DIALOG_FORM1_80_S20)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to a Gemini pane that reads waiting_input (derived approval prompt)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key keeps the queued line, the processing line and the retry rules for screens that do not wait`

**bypass**

plugin: 128 passed, 10 failed, exit 1.

- `detectActivity never reads the bypass permissions text as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.307-idle-bypass.txt as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.306-running-01.txt as active`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.306-running-diffpanel.txt as active`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads the real screens the same with the trailing line end and blank rows left out`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row that a message quotes in the transcript of an idle pane as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row text in the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row with a transcript entry between it and the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a running turn past blank, indented and panel rows (real layouts, more blank rows)`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a quoted permission prompt in a message or in the input box as idle`

cli: 9 passed, 9 failed, exit 1.

- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) sends at once to the idle screen claude-2.1.307-idle-bypass.txt in a regular send`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) sends at once to the idle screen claude-2.1.307-idle-paste-hint.txt in a regular send`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits while the pane runs a turn, and sends when it is idle`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) prints processing for a running turn at the first check, with no retry Enter`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) keeps the retry Enters of the loop for a pane that stays idle (unchanged loop)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line when a dialog shows at the first check of a regular send`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key idle, then a dialog: the idle check keeps its retry Enter, the dialog check sends no key`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for a dialog at the last check, after two retry Enters to an idle screen`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key keeps the queued line, the processing line and the retry rules for screens that do not wait`

**spinner_words**

plugin: 135 passed, 3 failed, exit 1.

- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row that a message quotes in the transcript of an idle pane as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row text in the input box as idle`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a spinner row with a transcript entry between it and the input box as idle`

cli: 18 passed, 0 failed, exit 0.


**no_waiting**

plugin: 138 passed, 0 failed, exit 0.


cli: 9 passed, 9 failed, exit 1.

- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t1-01_before.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-00_dialog_open.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-paste3-03_verify1.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line when a dialog shows at the first check of a regular send`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key idle, then a dialog: the idle check keeps its retry Enter, the dialog check sends no key`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for a dialog at the last check, after two retry Enters to an idle screen`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to an OpenCode pane that reads waiting_input (real 2.0.31 capture REAL_DIALOG_PERMISSION_80_S20)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to an OpenCode pane that reads waiting_input (real 2.0.31 capture REAL_DIALOG_FORM1_80_S20)`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key sends no retry Enter to a Gemini pane that reads waiting_input (derived approval prompt)`

**no_dialog**

plugin: 130 passed, 8 failed, exit 1.

- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t1-01_before.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t3-00b_after_down.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t4-00c_typed_text.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-00_dialog_open.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-paste1-03_verify1.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads real screen claude-2.1.304-dialog-t5-paste3-03_verify1.txt as waiting_input`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads the real screens the same with the trailing line end and blank rows left out`
- `detectActivity on Claude Code 2.1.304 to 2.1.307 screens reads a permission prompt in place of the input box as waiting_input (derived layout)`

cli: 9 passed, 9 failed, exit 1.

- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t1-01_before.txt and refuses at the timeout, with no key`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t5-00_dialog_open.txt and refuses at the timeout, with no key`
- `ao send to a Claude Code 2.1.304 to 2.1.307 pane (real screens) waits at the dialog claude-2.1.304-dialog-t5-paste3-03_verify1.txt and refuses at the timeout, with no key`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t1-01_before.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-00_dialog_open.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for the dialog claude-2.1.304-dialog-t5-paste3-03_verify1.txt after a --no-wait send, with no retry Enter`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line when a dialog shows at the first check of a regular send`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key idle, then a dialog: the idle check keeps its retry Enter, the dialog check sends no key`
- `the verify loop: a pane that waits for an answer gets a line of its own and no key prints the line for a dialog at the last check, after two retry Enters to an idle screen`

### Private replay on the worktree build

Independent Python raw-terminal stub, alternate screen, 180×80, no agent/model. Before each send the entire captured pane matched the start fixture after trimming only trailing screen padding; all ten passed this equality check. The fixture content was not reflowed or reconstructed. A short message `Review replay message.` is read as raw bytes, and only its Enter redraws the specified after-fixture. A separate logging tmux shim records exact argv; both logs agree. Config `/tmp/aocdr1/ao56/replay.yaml`, scratch state root `/tmp/aocdr1/ao56/state`, private server `aocdr1-live-ao56`. Every CLI call used the built `packages/cli/dist/index.js` with explicit scratch AO_CONFIG_PATH/AO_STATE_ROOT.

Regular cases used `--timeout 1`; the unchanged five-second polling interval means refusal occurs after about 5.5 s. No-wait cases bypass the wait. The following are observed wall times, not simulated timers.

**cdr-1 — idle**, exit 0, 3.132 s, 1 total Enter(s), stub PID 2566302.

```text
Message sent and processing
```

tmux keys: `[{"t": 0.479, "argv": ["send-keys", "-t", "=cdr-1:", "C-u"]}, {"t": 0.729, "argv": ["send-keys", "-t", "=cdr-1:", "-l", "Review replay message."]}, {"t": 1.07, "argv": ["send-keys", "-t", "=cdr-1:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-2 — hint**, exit 0, 3.129 s, 1 total Enter(s), stub PID 2568798.

```text
Message sent and processing
```

tmux keys: `[{"t": 0.478, "argv": ["send-keys", "-t", "=cdr-2:", "C-u"]}, {"t": 0.704, "argv": ["send-keys", "-t", "=cdr-2:", "-l", "Review replay message."]}, {"t": 1.051, "argv": ["send-keys", "-t", "=cdr-2:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-3 — running**, exit 0, 8.170 s, 1 total Enter(s), stub PID 2568821.

```text
Waiting for cdr-3 to become idle...
Timeout waiting for idle. Sending anyway.
Message sent and processing
```

tmux keys: `[{"t": 5.501, "argv": ["send-keys", "-t", "=cdr-3:", "C-u"]}, {"t": 5.739, "argv": ["send-keys", "-t", "=cdr-3:", "-l", "Review replay message."]}, {"t": 6.09, "argv": ["send-keys", "-t", "=cdr-3:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-4 — dialog**, exit 1, 5.474 s, 0 total Enter(s), stub PID 2568929.

```text
Waiting for cdr-4 to become idle...
Timeout waiting for cdr-4: session is waiting for interactive input; not sending.
```

tmux keys: `[]`.

Pane bytes: `""`.

**cdr-5 — review**, exit 1, 5.446 s, 0 total Enter(s), stub PID 2569021.

```text
Waiting for cdr-5 to become idle...
Timeout waiting for cdr-5: session is waiting for interactive input; not sending.
```

tmux keys: `[]`.

Pane bytes: `""`.

**cdr-6 — dialog-no-wait**, exit 0, 3.023 s, 1 total Enter(s), stub PID 2571607.

```text
Message sent — the pane waits for an answer: check cdr-6 (tmux pane =cdr-6:)
```

tmux keys: `[{"t": 0.343, "argv": ["send-keys", "-t", "=cdr-6:", "C-u"]}, {"t": 0.588, "argv": ["send-keys", "-t", "=cdr-6:", "-l", "Review replay message."]}, {"t": 0.943, "argv": ["send-keys", "-t", "=cdr-6:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-7 — review-no-wait**, exit 0, 3.045 s, 1 total Enter(s), stub PID 2571749.

```text
Message sent — the pane waits for an answer: check cdr-7 (tmux pane =cdr-7:)
```

tmux keys: `[{"t": 0.372, "argv": ["send-keys", "-t", "=cdr-7:", "C-u"]}, {"t": 0.614, "argv": ["send-keys", "-t", "=cdr-7:", "-l", "Review replay message."]}, {"t": 0.968, "argv": ["send-keys", "-t", "=cdr-7:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-8 — idle-to-dialog**, exit 0, 3.083 s, 1 total Enter(s), stub PID 2571849.

```text
Message sent — the pane waits for an answer: check cdr-8 (tmux pane =cdr-8:)
```

tmux keys: `[{"t": 0.418, "argv": ["send-keys", "-t", "=cdr-8:", "C-u"]}, {"t": 0.659, "argv": ["send-keys", "-t", "=cdr-8:", "-l", "Review replay message."]}, {"t": 1.008, "argv": ["send-keys", "-t", "=cdr-8:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r"`.

**cdr-9 — idle-retained**, exit 0, 9.185 s, 3 total Enter(s), stub PID 2571876.

```text
Message sent — could not confirm it was received
```

tmux keys: `[{"t": 0.351, "argv": ["send-keys", "-t", "=cdr-9:", "C-u"]}, {"t": 0.597, "argv": ["send-keys", "-t", "=cdr-9:", "-l", "Review replay message."]}, {"t": 0.938, "argv": ["send-keys", "-t", "=cdr-9:", "Enter"]}, {"t": 3.027, "argv": ["send-keys", "-t", "=cdr-9:", "Enter"]}, {"t": 6.116, "argv": ["send-keys", "-t", "=cdr-9:", "Enter"]}]`.

Pane bytes: `"\u0015Review replay message.\r\r\r"`.

**cdr-10 — quoted**, exit 1, 5.471 s, 0 total Enter(s), stub PID 2574364.

```text
Waiting for cdr-10 to become idle...
Timeout waiting for cdr-10: session is waiting for interactive input; not sending.
```

tmux keys: `[]`.

Pane bytes: `""`.

The idle/hint cases redraw running-01/diffpanel on the send’s Enter; cdr-8 redraws t1 dialog. Other cases keep their screen. The immediate sends have no Waiting line and begin typing at +0.48 s; only delivery/verification sleeps account for the remaining time. Running cdr-3 first types at +5.50 s. No-wait cdr-6/7 and first-check dialog cdr-8 have exactly the initial clear/text/Enter vector and no extra key. cdr-9 demonstrates the deliberately retained two retries. cdr-10 is the derived m-1 case, not a claimed real capture.

### Full gate package totals

```text
packages/core test:       Tests  1548 passed | 11 expected fail (1559)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  280 passed (280)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  323 passed (323)
```

## Final isolation and cleanup audit

All recorded node/test PIDs and replay PIDs were checked via `/proc`: **[]** remained. A broader command/cwd scan for owned review helpers, excluding this audit and its ancestors, also returned **[]**. Replay stub PIDs were 2566302, 2568798, 2568821, 2568929, 2569021, 2571607, 2571749, 2571849, 2571876, 2574364; keeper 2566297; private server 2566296. Each was terminated by its exact owned PID, with no pattern kill. Gate helpers had exited normally.

Private server probes (then stale owned sockets removed):

```text
aocdr1-gates-ao56: exit 1; no server running on /tmp/tmux-44402/aocdr1-gates-ao56
aocdr1-live-ao56: exit 1; no server running on /tmp/tmux-44402/aocdr1-live-ao56
```

Before deleting the fake HOME, restored the worktree dependency links with `CI=true HUSKY=0 pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3`, exit 0. This uses the permanent existing store so removing reviewer scratch does not break the worktree. No lockfile or tracked source changed.

Required real-state check:

```text
$ find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aocdr1-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54

```

Every entry is attributed below. These were read only for the audit; no reviewer command used the real config/state root.

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions 2026-10-22 00:03:34.985560728 -0400
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52 2026-10-21 23:58:34.865298954 -0400
generation=27
status=stuck
createdAt=2026-10-21T16:37:54.484Z
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54 2026-10-22 00:03:34.985560728 -0400
generation=30
status=working
createdAt=2026-10-21T18:03:19.256Z
```

- `sessions/ao-52`: existing protected worker, status stuck; the real lifecycle log contains its working→stuck transition. This is consistent with the real worker's state update, not a reviewer write.
- `sessions/ao-54`: existing author session, status working. It is an external session update (lifecycle/author hook or the orchestrator's read repair); the record alone cannot identify which external writer. Every reviewer CLI invocation had explicit scratch state/config, so none targeted it. I do not assign an exact writer without evidence.
- `sessions`: parent directory changed by these external session-record replacements.

`ls -la --time-style=full-iso ~/.ao/bin`, before and after, byte-identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

No capture/read of a real pane, no lifecycle-worker stop, no real agent process, no model turn, no network gh, no push/PR, no commit/rebase/pull, no write to the author's `/tmp/aocd`. Protected workers 1294181 and 1294364 and all named real sessions were untouched. Git tracked diff is empty. The only worktree outputs are this review and the requested local status report (plus the supplied task file).

Final cleanup completed: `/tmp/aocdr1` and `/tmp/aocdr1-marker` removed; both owned private socket files removed. Permanent dependency-store links verified. `.agent_report.md` published by atomic rename after drafting its body; earlier reports retained below.
