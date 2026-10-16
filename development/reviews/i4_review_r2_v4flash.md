# Blind review, round 2 — I-4 re-check, whole increment `15757aae..30f1b31d`

**Reviewer**: ao-39, lens v4flash (DeepSeek V4.1 Flash), same reviewer as round 1. **Round-2 commits**:
`730ad8f9` (classifier scope + tests + message.list + dead-helper removal) and `30f1b31d` (one M27 test).
**Host**: OpenCode 2.0.31 (global service PID 3252262). Date: 2026-10-16.
Round-1 review (not edited): `development/reviews/i4_review_r1_v4flash.md`.

## Verdict

**NOT-LAND-SAFE** for the increment `15757aae..30f1b31d`.

Round 2 is a large, honest improvement: the input-box and `┃`-transcript false positives are gone, and
every design mutant I could re-create is now caught. But the round-1 classifier defect is only **partly**
fixed: the real 2.0.31 TUI renders the assistant's final answer **without** the `┃` prefix, so a dialog
marker in that visible text still yields a false `waiting_input` on an idle pane — the exact screen-text-
overrides-status-row bug, with a worse-than-base consequence (`ao send` refuses). One blocker remains.

**Counts: 1 blocker, 0 major, 2 minor.**

---

## Status of the round-1 findings

### Sonnet (ao-38)

| ID | Status | Evidence |
|---|---|---|
| **B-1** markers anywhere in the capture | **Partly fixed** | Input box and `┃` transcript lines fixed (live + mutant CI1/R1classifier, below). Non-`┃` final-answer lines still decide → my **B-1**. |
| **M-1** 14 surviving mutants | **Fixed** | All 11 API/classifier mutants I re-ran now fail tests (table below); Sonnet's M1/M3/M4/M12/M14/M15/M20/M23/M27/M29/M31/M33 are covered. |
| **m-2** `message.list` default page | **Fixed** | `params: { sessionID, type: "user", order: "desc", limit: "1" }` (`api-activity.ts:242`); one test asserts the exact params; isolated store accepts the form (`{"data":[],"cursor":{…}}`). |
| **m-3** `void findOpenCodeSession` | **Fixed** | Helper, its section header and the `OpenCodeApiSession` import removed (`index.ts`); `grep findOpenCodeSession src` → only fixture text. `getOpenCodeSession` still used at `index.ts:605`. |
| **N-1** needless `unknown` cast | **Fixed** | `getSessionOutcome` reads `session["outcome"]` (`api-activity.ts:179`). |
| **N-2** duplicated `detectActivity` tests | **Fixed** | Full set now in `api-activity.test.ts:471-556`; `index.test.ts` keeps one wiring test. |
| **N-3** stale test title | **Fixed** | Renamed to "returns active from the API when the AO JSONL is empty and a session is stored". |

### V4.1 Flash (mine)

| ID | Status | Evidence |
|---|---|---|
| **M-1** order (permission/form before `session.active`) | **Fixed** | Mutant `M1_order` now fails 2 tests (`…permission waits and session.active also holds this ID`, `…form waits…`). |
| **M-2** `esc interrupt` matched anywhere | **Mostly fixed** | Now status-row-only; the round-1 whole-capture classifier mutant fails 9 tests. **Residual: a false `waiting_input` from dialog markers in non-`┃` answer text → my B-1.** |
| **m-1** parallel calls untested | **Fixed** | Mutant `M4_seq` fails the deferred-promise test. |
| **m-2** failed `message.list` → not blocked | **Fixed** | Mutant `M12_readok` fails the M12 test. |
| **m-3** dead helper | **Fixed** | Removed. |
| **m-4** unbounded `message.list` | **Fixed** | `type=user&limit=1` (see m-2 above). |

Deliberately out of round 2 (not reported again per the brief): Sonnet m-1, m-4, m-5, Flash m-5, N-4.

---

## New findings

### B-1 (blocker) — dialog markers on the assistant's final-answer lines are not `┃`-prefixed, so an idle pane reads `waiting_input`

`packages/plugins/agent-opencode/src/api-activity.ts:143-148` (the dialog loop). This is the open part of
Sonnet's round-1 B-1 and my round-1 M-2.

The fix assumes "transcript and input lines start with `┃`" (code comment `:130-134`, brief section 1). That
is **false for the assistant's final answer**: in both real 2.0.31 captures the *tool/command* blocks carry
`┃`, but the **assistant message body is rendered with a 5-space indent and no `┃`**. So the loop skips the
tool lines and scans exactly the worker-authored text, which can contain the census literals.

Evidence — counts of non-`┃` non-empty lines and the marker positions, from the orchestrator's real
captures (unchanged files):

```
ao-37-idle-done-2.0.31.txt         : 12 non-┃ non-empty lines, e.g. "     Report complete — final verification."
ao-39-idle-done-2.0.31-v4flash.txt : 33 non-┃ non-empty lines, e.g. "     The review is complete. Summary:"
    (the ┃ lines are the tool/command blocks, e.g. "  ┃  $ head -n 1 .agent_report.md | cat -A")
```

Reproducer (built plugin at `30f1b31d`, run from the worktree root under `env -i`): take a real idle capture,
replace one real 5-space answer line with a census marker, classify. The status row is untouched
(`ctrl+p commands`), yet:

```
ao-37-idle-done-2.0.31.txt
  as-is                                                       -> idle
  answer line "Report complete — final verification." replaced by "icon: △ Permission required" -> waiting_input
  the status row is unchanged: "· $0.09  ctrl+p commands"
ao-39-idle-done-2.0.31-v4flash.txt
  as-is                                                       -> idle
  answer line "+ Thought · 3.9s" replaced by "icon: △ Permission required"                       -> waiting_input
  the status row is unchanged: "· $0.10  ctrl+p commands"
```

Same result for `Allow once   Always allow   Reject` and `↑↓ select  enter submit`.

Consequences (round-1 reasoning still holds, with the `-S -20` window of `ao send`):
`ao send`'s busy check (`send.ts:178-206`) reads `capture-pane -p -S -20`; a false `waiting_input` makes it
wait the full `--timeout` and then print "session is waiting for interactive input; not sending." and exit 1
(`send.ts:193-201`) — **worse than the base**, which sent after the timeout. The lifecycle fallback
(`lifecycle-manager.ts:429-438`) and `recordActivity` → JSONL → `needs_input` are also exposed, though the
lifecycle's `getOutput(handle, 10)` window usually ends at the box border and hides the answer text. ao
workers discuss this repo, whose sources, tests and briefs all contain these literals, so the text is
realistic.

Suggested fix: do not treat every non-`┃` line as dialog-eligible. Recognise a dialog by its own structure
(e.g. the leading `△`/`↑↓` at the start of a line, and/or require the dialog to sit between the last
`╹▀▀▀` border and the box), or invert the filter so only lines that begin with a dialog glyph count. Add a
test with a marker on a **real, non-`┃` answer line** (the current tests only mutate `┃` lines, see m-7).

### m-6 (minor) — a dialog line that does carry `┃` would be missed, and no real dialog is available to decide

The brief asks what happens "if a real dialog line starts with `┃`". With the current rule the line is
skipped, the state falls through to the status row, and — because the census says a dialog shows no
`esc interrupt` while the status row still ends in `ctrl+p commands` — the result is `idle`, i.e. a **missed**
`waiting_input` (`ao send` would send into the dialog; lifecycle would not flag `needs_input`). No real
permission or question capture exists (it needs a model turn), so the `┃` assumption is unverified in both
directions; the code comment says so. Recorded for I-5/I-7 when a real dialog can be captured.

### m-7 (minor) — the new classifier tests only mutate `┃` lines

`api-activity.test.ts:472-527`: `withTranscriptText` replaces `TRANSCRIPT_LINE` (a `  ┃   …` line) and
`withInputBoxText` replaces the `  ┃` box line. Both are `┃` lines, so the tests pass trivially under the
`startsWith("┃")` skip and never exercise a non-`┃` answer line — the case that fails (B-1). Add the
real-answer-line fixture.

---

## Mutants re-run on `30f1b31d` (scratch copy, `git archive 30f1b31d`)

Baseline: 201 passed. Every mutation below was applied alone, then the plugin suite ran.

| Mutant | Result |
|---|---|
| `M1_order` permission/form after `session.active` | **caught**, 2 fail |
| `M3_timeout` `timeoutMs` removed from the 4 calls | **caught**, 1 fail (M3/M33) |
| `M4_seq` four calls sequential | **caught**, 1 fail (deferred) |
| `M12_readok` failed `message.list` ⇒ blocked | **caught**, 1 fail |
| `M14_base` `updated ?? idle` | **caught**, 1 fail |
| `M15_cache` `inputTokens` without cache | **caught**, 1 fail |
| `M20_status` `ctrl+p` checked before `esc interrupt` | **caught**, 1 fail |
| `M23_user` non-`user` messages clear `blocked` | **caught**, 1 fail |
| `M27_notimes` early no-times check dropped | **caught**, 1 fail |
| `M29_anyid` `Object.keys(activeData).length > 0` | **caught**, 1 fail |
| `M31_param` `sessionId` instead of `sessionID` | **caught**, 1 fail |
| `R1classifier` round-1 `includes()` on the whole capture | **caught**, 9 fail (incl. the real V4Flash idle capture) |
| `CI1_noskip` check dialog markers on `┃` lines too | **caught**, 6 fail |
| `CI2_noesc` drop the `esc interrupt` status-row check | **caught**, 1 fail |

Round-1 survivors are closed. The one behavior not pinned by any test is B-1 (marker on a non-`┃` line).

## No regression

`git diff api-activity.ts 09c77de0..30f1b31d` touches only the doc comment, the classifier, the `outcome`
cast and the `session.message.list` params. The cascade, the four-call budget, the `blocked`/`interrupted`
rules and `mapSessionCost` are byte-identical. Live, isolated (service PID 1649689 on port 49581, all four
XDG under `/tmp`), built worktree under `env -i`:

```
getActivityState: 150 ms -> {"state":"idle","timestamp":"2026-10-16T18:22:12.551Z"}   (old time.updated, no time.idle)
getSessionInfo  : 135 ms -> {summary:"AO-REVIEW-I4R2: live", agentSessionId:"ses_eba0…", cost:{0,0,0}}
after session.remove (404): getActivityState -> null ; getSessionInfo -> null
```

Live pane classifier, private tmux panes `opencode --session <id>` (no model turn) at **80x24** and
**200x50**, pane `environ` had 0 `AO_*`; each marker typed into the **input box** with `send-keys -l` (no
Enter), `capture-pane -p -S -20`:

```
80x24 : idle->idle; box "see … the esc interrupt rule"->idle; box "the dialog says Allow once or Reject"->idle;
        box "icon: △ Permission required"->idle; box "↑↓ select  enter submit"->idle; (cleared)->idle
200x50: same five results, all idle
```

The input-box line carries `┃` (`  ┃  icon: △ Permission required`), so the box false positive of round 1 is
fixed. Real idle captures, the busy last-3 sample, the 80x24 cut and the 0009 §5.1 capture all classify
correctly (idle/active/idle/idle).

## Gates (worktree at `30f1b31d`, `env -i`, fake `HOME`, no `AO_*`)

- `pnpm install` → Done; `pnpm build` → Done.
- plugin `test`: **2 files, 201 passed**. plugin `typecheck`: `tsc --noEmit`, pass.
- `pnpm lint`: **0 errors, 5 warnings** (pre-existing; none in the round-2 files).
- `pnpm typecheck`: all packages Done.
- full `pnpm test`: **2296 passed, 29 skipped, 0 failed** (core 948, gemini 62, codex 215, notifier 26,
  claude-code 208, herdr 36, tracker 42, scm 140(+5skip), runtime-tmux 30, workspace-worktree 50, opencode
  201, integration 95(+24skip), cli 243).

## Scope and commits

`git diff --name-only 09c77de0..30f1b31d` lists exactly the five allowed files
(`__fixtures__/panes-2.0.31.ts`, `api-activity.ts`, `api-activity.test.ts`, `index.ts`, `index.test.ts`).
`git branch -r --contains 30f1b31d` prints nothing. Both messages are conventional, WHY-first, ASCII, no
`Co-Authored-By`, no emoji, no issue number. `09c77de0` is not amended.

## Checked and found correct

- The status-row rule: last non-empty line, `esc interrupt` before `ctrl+p commands`, marker matched
  anywhere on the row (the 0009 §5.1 trailing directory still gives `idle`).
- The input-box and `┃`-transcript false positives are fixed (live and mutants).
- All eleventh+ round-1 API/classifier mutants are now caught; the cascade is unchanged; the cost mapping
  and the failed-read rule are untouched.
- `message.list` uses `type=user&order=desc&limit=1`; the service accepts it.
- The dead helper is gone with no dangling import or caller.
- Gates green; scope and commit messages clean.

## Cleanup

- Private tmux server killed with `tmux -L <sock> kill-server`; both TUI panes and the isolated service
  (PID 1649689) stopped. Global service 3252262 and the lifecycle workers (3215891, 3215991, 3216043,
  3216103, 3216178) untouched; other sessions' `opencode` processes (incl. ao-38's `ao38r2-tui`) untouched.
- `ps -o pid,args -u "$(id -u)"` filtered by `i4r2-v4flash-1643769` → **(none)**; the exact PIDs I started
  (1649689, 1650085, 1659103) are gone.
- `~/.ao/bin` identical before and after (4 files, mtimes `12:16:13.966…/.967…/.968…`, `.ao-version` 5 B).
- `find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/i4r2-v4flash-1643769-marker` → **empty**. All `/tmp`
  state removed (219 MiB scratch copy, XDG store, tmux socket).
