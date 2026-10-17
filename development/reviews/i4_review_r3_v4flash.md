# Blind review, round 3 — I-4 re-check, whole increment `15757aae..296b21b1`

**Reviewer**: ao-39, lens v4flash (DeepSeek V4.1 Flash), same reviewer as rounds 1-2. **Round-3 commit**:
`296b21b1` (classifier reads dialogs from the bottom `┃` block; real dialog fixtures). **Host**: OpenCode
2.0.31 (global service PID 3252262). Date: 2026-10-16. Earlier reviews (not edited):
`i4_review_r1_v4flash.md`, `i4_review_r2_v4flash.md`.

## Verdict

**LAND-SAFE** for the increment `15757aae..296b21b1`.

Both round-2 blockers are fixed and I reproduced the fix on **real dialogs** in my own isolated store (a
capability round 1 and 2 lacked): a real permission dialog, a one-field form and a two-field form all give
`waiting_input` at 80x24 and 200x50 with both the `-S -20` and `-S -10` windows, and `idle` after reply or
cancel; prose markers no longer fire. No wrong state at the default 80x24. Two minor findings remain, both
in the narrow-pane / block-boundary area, plus the already-accepted N-6.

**Counts: 0 blockers, 0 major, 2 minor.**

---

## The classifier as shipped (`api-activity.ts:137-193`)

1. Empty/whitespace-only capture → `idle`.
2. The status row is the last non-empty line: holds `esc interrupt` → `active`; else holds
   `ctrl+p commands` → `idle`. When a status row is present, dialog markers are never read.
3. Otherwise (a real dialog hides the status row): walk from the last non-empty line **upward** over the
   bottom block of contiguous `┃` lines, stopping at the first empty or non-`┃` line; strip `^\s*┃\s*`;
   `△ Permission required` at the start → `waiting_input`; `Allow once` + `Reject` on one line →
   `waiting_input`; `↑↓ select` + `enter submit|confirm|choose` on one line → `waiting_input`.
4. Anything else → `active`.

This matches the brief and the Sonnet B-2 "Fix", tightened with the bottom-block restriction.

## Round-2 findings — status

| Finding | Status | Evidence |
|---|---|---|
| **Sonnet B-2a** real dialogs (drawn with `┃`) read `active` | **Fixed** | Live isolated: real permission, one-field form, two-field form at 80x24 and 200x50, `-S -20` and `-S -10` all `waiting_input`; after `permission.reply reject` / `form.cancel` all `idle`. |
| **Sonnet B-2b** prose markers read `waiting_input` | **Fixed** | Triangle / Allow+Reject / select+submit placed in a real 5-space answer line of the real idle captures → `idle` (edge run); real tests pin it (`api-activity.test.ts:626-657`). |
| **Sonnet M-2** tests pin an invented shape | **Fixed** | Six real dialog captures added to `__fixtures__/panes-2.0.31.ts:21-31`; the "needs a model turn" premise is removed from the fixture header and code comment. |
| **Sonnet m-6** 7 classifier mutants live | **Fixed** | Re-ran M21, C5, C6, C8, C9, C11, C12: all caught now (table below). |
| **Sonnet m-7** bound value unpinned | **Fixed** | `expect(OPENCODE_ACTIVITY_API_TIMEOUT_MS).toBeLessThan(10_000)` (`api-activity.test.ts:172`); mutant M3b now fails 1 test. |
| **Sonnet N-6** narrow idle → `active` | **Accepted as a comment** | Confirmed live: 50/45 cols → `idle`, 40/35 cols → `active`. Comment present (`api-activity.ts:161-162`). |
| **Sonnet M12** null/wrong-shape `message.list` → `blocked` | **Fixed** | Two new tests (`:274`, `:290`); mutant `readOk = true` fails 2 tests. |
| **Flash B-1** prose markers read `waiting_input` | **Fixed** | As B-2b. |
| **Flash m-6** a real `┃` dialog line is skipped | **Fixed** | Live real dialogs → `waiting_input`. |
| **Flash m-7** classifier tests only mutate `┃` lines | **Fixed** | Real-dialog tests and the prose-marker tests added. |

## New findings

### m-8 (minor) — the bottom-`┃`-block boundary is not pinned by any test

`api-activity.ts:165-176` (the block builder) and `:170` (`if (!line.trimStart().startsWith("┃")) break;`).
Two mutants of the boundary survive the whole suite (226/226):

- `for (const line of block)` → `for (const line of lines)` (scan every line, not just the block): **lives**.
- drop `if (!line.trimStart().startsWith("┃")) break;` (let the block run past non-`┃` lines): **lives**.

The intended test "a dialog marker in a `┃` block that is NOT at the bottom (a status row follows) → idle"
(`api-activity.test.ts:722-729`) does not exercise the boundary: the status row returns `idle` before the
block scan. So the rule "only the bottom contiguous `┃` block decides" has no behavior test.

Reachability note (why this is minor, not a blocker): the reachable false positive is a capture with **no
status row** whose bottom `┃` block quotes a marker — e.g. a tool-output block `  ┃  △ Permission required`
with the status row absent. I built that input and the shipped code returns `waiting_input` (a false
positive), but the real callers (`capture-pane -p -S -20` in `send.ts`, `capture-pane -S -10` via
`runtime-tmux.getOutput`) always include the whole visible screen, whose last line is the status row. So it
is not reached in normal operation; the herdr runtime's capture is untested (Sonnet §9).

Reproducer: take the real V4Flash idle capture, drop the `╹▀▀` border and the `ctrl+p commands` status row,
then append `  ┃  $ cat api-activity.ts` / `  ┃  △ Permission required` / `  ┃`; the classifier prints
`waiting_input`. Suggested test: a marker in a `┃` line separated from the bottom bare `┃` by a blank line →
`active`.

### m-9 (minor) — a real question form at a narrow width is missed when its hint line wraps

`api-activity.ts:181-186` (the `↑↓ select` + `enter confirm` check, same line only).

My live isolated two-field form at 80x24 and 200x50 → `waiting_input`, but at **45 columns** the hint row
wraps and the two markers land on different lines:

```
  ┃  ⇆    ↑↓       enter       esc
  ┃  tab  select   confirm     dismiss
```

No stripped line holds both `↑↓ select` and `enter confirm`, so the classifier returns `active` (measured at
widths 45, 40 and 35). The one-field form survives at 45 but fails at 40; the permission dialog survives to
35 because its `△ Permission required` is at the start of its own line. This is the dialog-side sibling of
N-6 (which accepts the idle-side narrow case): `ao send` would see `active` and paste the message plus Enter
into the dialog. Default worker panes are 80x24 (`runtime-tmux` passes no `-x/-y`), so this needs a
narrow/resized pane. Suggested: also accept `↓ select` + `enter` when the two markers are on adjacent lines,
or match `enter confirm|submit|choose` without requiring `↑↓ select` on the same line.

## What I checked on the real TUI (brief item 1)

Isolated store, own port (service PID 3283315, not global 3252262), all four XDG under `/tmp`, private
`tmux -L` panes at 80x24 and 200x50, no model turn, pane `environ` had 0 `AO_*`. Dialogs raised with
`session.permission.create -d '{"action":"external_directory","resources":["/tmp/x/*"],"save":["/tmp/x/*"]}'`
and `session.form.create` (one-field and two-field bodies); answered with `session.permission.reply`
(`reject`) and `session.form.cancel`.

| Input | `-S -20` / `-S -10` | right answer |
|---|---|---|
| idle (no dialog), 80x24 and 200x50 | `idle` / `idle` | `idle` ✔ |
| real permission dialog, 80x24 and 200x50 | `waiting_input` / `waiting_input` | `waiting_input` ✔ |
| after `permission.reply reject` | `idle` / `idle` | `idle` ✔ |
| real one-field form, both sizes | `waiting_input` / `waiting_input` | `waiting_input` ✔ |
| after `form.cancel` | `idle` / `idle` | `idle` ✔ |
| real two-field form, both sizes | `waiting_input` / `waiting_input` | `waiting_input` ✔ |
| after `form.cancel` | `idle` / `idle` | `idle` ✔ |
| 4 markers typed into the input box (no Enter), both sizes | `idle` | `idle` ✔ |
| command palette open (C-p) | `idle` | `idle` ✔ |
| two-field form at 60 / 45 / 40 / 35 cols | `waiting_input` / `active` / `active` / `active` | m-9 |
| one-field form at 60 / 45 / 40 cols | `waiting_input` / `waiting_input` / `active` | m-9 |
| permission dialog at 60 / 45 / 40 / 35 cols | all `waiting_input` | ✔ |
| idle at 50 / 45 / 40 / 35 cols | `idle` / `idle` / `active` / `active` | N-6 (accepted) |
| prose marker in a real answer line (triangle / Allow+Reject / select+submit) | `idle` | `idle` ✔ |
| `┃` marker block above the status row | `idle` | `idle` ✔ |
| status row replaced by a toast | `active` | `active` ✔ |

`session.message.list --param type=user` of the session at the end: `{"data":[],…}`; permission and form
lists empty (every dialog answered or cancelled before teardown). Questions from the brief: a real dialog
**does** start every line with `┃` (the round-2 m-6 skip is the bug this round fixes); a toast while a dialog
shows could not be produced (no model turn); the palette stays above the status row and does not change the
result.

## Mutants re-run on `296b21b1` (scratch copy, `git archive 296b21b1`)

Baseline 226 passed. Every mutation applied alone, then the plugin suite.

| Mutant | Result |
|---|---|
| round-2 rule (dialog markers on all non-`┃` lines) | **caught**, 13 fail |
| round-1 `includes()` on the whole capture (dialog part) | **caught**, 4 fail |
| M21 unknown output → `idle` (Sonnet m-6) | **caught**, 5 fail |
| C5 `ctrl+p commands` on the whole capture | **caught**, 1 fail |
| C6 empty capture → `active` | **caught**, 2 fail |
| C8 `Allow once` OR `Reject` | **caught**, 2 fail |
| C9 `↑↓ select` OR `enter …` | **caught**, 1 fail |
| C11 triangle rule removed | **caught**, 1 fail |
| C12 Allow/Reject rule removed | **caught**, 1 fail |
| M3b bound `5_000` → `30_000` (Sonnet m-7) | **caught**, 1 fail |
| M12 `let readOk = false` → `true` (Sonnet M12) | **caught**, 2 fail |
| **block builder over all lines (`for … of lines`)** | **lives** → m-8 |
| **block builder without the non-`┃` stop** | **lives** → m-8 |
| My round-2 API mutants (`M1_order`, `M3_timeout`, `M4_seq`, `M14_base`, `M15_cache`, `M20_status`, `M23_user`, `M27_notimes`, `M29_anyid`, `M31_param`) | **all caught** (2/1/1/1/1/1/1/1/1/1 fail) |

## No regression

`git diff 30f1b31d..296b21b1 -- api-activity.ts` changes only `classifyOpenCodePaneActivity` and its
comment. The cascade, the four-call budget, the `failed`/`interrupted` rules, the `message.list` params
(`type=user order=desc limit=1`) and `mapSessionCost` are byte-identical. Only the classifier, the fixtures
and the tests changed.

## Gates (worktree at `296b21b1`, `env -i`, fake `HOME`, no `AO_*`)

- plugin `test`: **2 files, 226 passed**. plugin `typecheck`: `tsc --noEmit`, pass.
- `pnpm lint`: **0 errors, 5 warnings** (pre-existing, none in the changed files).
- `pnpm typecheck`: all Done. `pnpm build`: Done through cli.
- full `pnpm test`: **2321 passed, 29 skipped, 0 failed** (core 948, gemini 62, codex 215, notifier 26,
  claude-code 208, herdr 36, tracker 42, scm 140(+5skip), runtime-tmux 30, worktree 50, opencode 226,
  integration 95(+24skip), cli 243).

## Scope and commit

`git diff --name-only 30f1b31d..296b21b1` lists exactly the three allowed files (`__fixtures__/panes-2.0.31.ts`,
`api-activity.test.ts`, `api-activity.ts`). `git branch -r --contains 296b21b1` prints nothing. The message is
conventional, WHY-first, ASCII, no `Co-Authored-By`, no emoji, no issue number; `30f1b31d` is not amended.

## Checked and found correct

- The classifier rule matches the brief; every real dialog at the default sizes gives `waiting_input`, and
  `idle` after resolve; input-box and prose markers are ignored.
- The six new fixtures are verbatim real captures with honest provenance.
- The round-2 coverage holes (Sonnet m-6, m-7, M12; my m-7) are filled and pinned by tests.
- No regression of the cascade/budget/cost; gates green; scope and message clean.

## Cleanup

- Private `tmux -L` server killed; all TUI panes stopped; isolated service PID **3283315** stopped (global
  3252262 and the lifecycle workers 3215891, 3215991, 3216043, 3216103, 3216178 untouched); every dialog
  answered or cancelled (permission and form lists empty).
- `ps -o pid,args -u "$(id -u)"` filtered by `i4r3-v4flash-3281723` → **(none)**; exact service PID gone.
- `~/.ao/bin` identical before and after (4 files, mtimes `12:16:13.966…/.967…/.968…`, `.ao-version` 5 B).
- `find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/i4r3-v4flash-3281723-marker` → **empty**. All `/tmp`
  state removed (219 MiB scratch copy, XDG store, tmux socket).
