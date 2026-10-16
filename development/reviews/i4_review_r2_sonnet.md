# I-4 review, round 2 (Sonnet lens): `15757aae..30f1b31d`

Reviewer: ao-38 (Claude Sonnet 5.5). Subject: the two round-2 commits of ao-37 on top of `09c77de0`
(`730ad8f9`, `30f1b31d`), and the whole increment `15757aae..30f1b31d`. I wrote no code and made no commit. The
round-1 review (`i4_review_r1_sonnet.md`) is unchanged.

## Verdict: NOT-LAND-SAFE

1 blocker (B-2), 1 major (M-2), 2 minor (m-6, m-7), 2 notes (N-5, N-6).

The round fixes most of round 1. 13 of my 14 surviving mutants now die. The idle-pane false positives of B-1
are gone for text in the input box, in tool output and in `┃` transcript lines. But the new dialog rule is wrong
in both directions on the real TUI:

- A **real** permission or question dialog is drawn with `┃` on every line. The rule skips every `┃` line, so a
  real dialog reads `active`. `09c77de0` read `waiting_input`. (B-2a)
- **Assistant prose** has no `┃`. The rule reads it as dialog text. An idle pane whose last message holds
  `△ Permission required` (or `Allow once ... Reject`, or `↑↓ select ... enter submit`) on one line reads
  `waiting_input`. `ao send` then refuses to send. (B-2b)

The tests pass because they use a constructed dialog without `┃`. The code comment and the brief say that a real
dialog "needs a model turn". That is wrong. I made real dialogs with two API calls and no model turn (M-2).
The fix is small, and I measured one that gives the right answer on all 15 captures I have (B-2, "Fix").

## 1. Gates (my worktree at `30f1b31d`, `env -i`, fake `HOME` under `/tmp`, no `AO_*`)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | Done in 1.1s |
| `pnpm build` | all packages Done (twice) |
| plugin test (`--filter @aoagents/ao-plugin-agent-opencode test`) | `Test Files  2 passed (2)`, `Tests  201 passed (201)` (187 in round 1) |
| plugin typecheck | `tsc --noEmit`, no output |
| `pnpm lint` | `✖ 5 problems (0 errors, 5 warnings)` (all in files outside this increment: `spawn.ts`, `activity-log.ts`, `plugin-registry.ts`, `session-manager.ts`) |
| `pnpm typecheck` | all Done |
| full `pnpm test` | exit 0. 2296 passed, 29 skipped, 0 failed (core 948, cli 243, claude-code 208, codex 215, gemini 62, opencode 201, scm-github 140 + 5 skipped, integration 95 + 24 skipped, others 184). Round 1 had 2282 passed. |

The line `[session-manager] FAILED to deliver prompt to session app-1 after 3 attempts` in the full run is an
expected error-path log of a core test. The run exits 0.

## 2. Status of every round-1 finding

### Sonnet lens

| ID | Status | Evidence |
|---|---|---|
| B-1 classifier uses `includes()` on the whole capture | **PARTLY FIXED** | Fixed: marker text in the input box (4 markers, 80x24 and 200x50, live, no Enter), in tool output (live `session.shell` render with all markers, a diff and a wrapped 220-char line), in `┃` transcript lines, and `esc interrupt` in prose. All give `idle`. Not fixed: markers in assistant prose still give `waiting_input` (B-2b). New: real dialogs now give `active` (B-2a). |
| M-1 tests let 14 mutants live | **PARTLY FIXED** | 13 of 14 die (table in section 5). M12 (a `null` or wrong-shape `message.list` answer in the `failed` case) still lives. |
| m-2 `message.list` reads a default page | **FIXED** | `api-activity.ts:239` passes `type=user`, `order=desc`, `limit=1`. A test pins the params. The live 2.0.31 service accepts the form and applies the filter (section 6). |
| m-3 `void findOpenCodeSession` | **FIXED** | Helper, section header, `void` line and type import are gone. No caller is left (section 6). |
| N-1 needless `unknown` cast | **FIXED** | `api-activity.ts` reads `session["outcome"]` directly. |
| N-2 duplicate `detectActivity` tests | **FIXED in form, lost coverage** | `index.test.ts` holds one wiring test. The full set is in `api-activity.test.ts`. But three behaviors of `09c77de0` (empty → `idle`, whitespace → `idle`, unknown → `active`) have no test now (m-6). |
| N-3 stale test title | **FIXED** | Retitled to "returns active from the API when the AO JSONL is empty and a session is stored". The body matches. |

Out of round 2 on purpose, not re-reported: m-1 (9 processes per poll), m-4 (`ao send` delivery check), m-5
(`blocked` never decays), N-4 (1.x).

### V4.1 Flash lens (`i4_review_r1_v4flash.md`)

| ID | Status | Evidence |
|---|---|---|
| M-1 permission/form check before `session.active` untested | **FIXED** | Mutant M1 (checks moved after `session.active`) now fails 2 tests. |
| M-2 `esc interrupt` matched anywhere | **PARTLY FIXED** | `esc interrupt` now counts on the status row only. The real V4.1 Flash capture quotes the phrase in prose (line 27) and gives `idle`. The sibling defect for dialog markers in prose is open (B-2b). |
| m-1 parallelism untested | **FIXED** | Mutant M4 (sequential calls) fails the deferred-promise test. |
| m-2 failed-read → not blocked untested | **PARTLY FIXED** | M12b (a thrown read) dies. M12 (a `null` or wrong-shape read) lives. |
| m-3 `void findOpenCodeSession` | **FIXED** | As Sonnet m-3. |
| m-4 whole message history pulled | **FIXED** | As Sonnet m-2. |

Flash m-5 (`blocked` never decays) is out of round 2.

## 3. New findings

### B-2: the dialog rule never matches a real dialog, and it matches assistant prose (`api-activity.ts:144-163`, comment `:127-133`)

The rule (`:147-150`) skips every line that starts with `┃` after spaces, and takes `△ Permission required`,
`Allow once`+`Reject` and `↑↓ select`+`enter submit` as dialog text on the other lines. The comment says:
"transcript and input lines start with `┃` ... and dialog lines do not." That is false for dialogs, and
incomplete for prose.

**B-2a. Real dialogs are drawn with `┃` on every line, and they hide the status row.** I made real dialogs in
an isolated store, in a real `opencode --session` TUI in a private tmux pane, with no model turn (reproducer
below). Real captures at 80x24 (`capture-pane -p -S -20`, trailing blanks trimmed, the top tab bar and blank
lines left out). The permission dialog:

```
  ┃
  ┃  △ Permission required
  ┃    ← Access external directory /tmp/ao38r2/outside
  ┃
  ┃  Patterns
  ┃
  ┃  - /tmp/ao38r2/outside/*
  ┃
  ┃
  ┃   Allow once   Always allow   Reject  ctrl+f fullscreen  ⇆ select  enter con
  ┃
```

The question form with one field:

```
  ┃
  ┃  Questions
  ┃
  ┃  Do you prefer red or blue?
  ┃
  ┃  1. Red
  ┃  2. Blue
  ┃  3. Type your own answer
  ┃
  ┃  ↑↓ select  enter submit  esc dismiss
  ┃
```

The question form with two fields:

```
  ┃
  ┃  Questions
  ┃
  ┃  Color  Size  Submit
  ┃
  ┃  Red or blue?
  ┃
  ┃  1. Red
  ┃  2. Blue
  ┃
  ┃  ⇆ tab  ↑↓ select  enter confirm  esc dismiss
  ┃
```

Every line of each capture starts with `┃`. The last non-empty line is a bare `┃`. The status row is gone. The
200x50 captures have the same shape. The two-field form has no `enter submit`, so neither `09c77de0` nor
`30f1b31d` has any marker for it.

Results on the six real dialog captures (permission, one-field form, two-field form; 80x24 and 200x50; each at
`capture-pane -p -S -20`; the one-field form also at `-S -10`, the permission dialog also cut to its last 10
lines):

| Commit | Permission | One-field form | Two-field form |
|---|---|---|---|
| `15757aae` (1.x patterns) | `active` | `active` | `active` |
| `09c77de0` (`includes`) | `waiting_input` | `waiting_input` | `active` |
| `30f1b31d` (this round) | **`active`** | **`active`** | `active` |

So the pane `waiting_input` does not work on the real TUI. It is a regression against `09c77de0` and equal to
the base. The rule can only fire on an invented dialog (the census shapes in `api-activity.test.ts:529-546`).

**B-2b. Assistant prose has no `┃`.** In both real idle captures every line of the final assistant message
(lines 15-50 of the V4.1 Flash capture, and lines 43-50 of the Muse capture) starts with five spaces and no
`┃`. That message always sits just above the input box, inside the `-S -20` window of `ao send`. A worker on
this plugin often writes these strings (tests, reviews, reports). Reproducer on the built plugin:

```
$ env -i HOME=/tmp/fake PATH=... node scripts/repro.mjs      # imports dist/api-activity.js
(b) idle pane, prose has a marker  -> waiting_input
(b) same pane without the marker   -> idle
```

(The pane is the real V4.1 Flash idle capture with one prose line
`The dialog shows △ Permission required with Allow once, Always allow, Reject.` added. The same result for
`Hint row: ↑↓ select  enter submit  esc dismiss` and for `Check the line: Allow once   Always allow   Reject`.)

**Effect.**

- `send.ts:171-206`: for B-2b the idle pane reads `waiting_input`. `ao send` waits `--timeout` (600 s) and exits
  1 with "session is waiting for interactive input; not sending". It stays so until the message scrolls out or
  another message arrives. `--no-wait` is the only way round it.
- `send.ts:171-206`: for B-2a a pending dialog reads `active`. `ao send` waits, prints "Timeout waiting for
  idle. Sending anyway." and sends the text plus Enter into the dialog. From the 2.0.31 bundle source
  (`function Zn`, the permission dialog), Enter confirms the highlighted option. I did not type into a dialog
  (the brief allows typing only in the input box), so this is read from the source, not proven live.
- `lifecycle-manager.ts:429-438` (only when `getActivityState` returns `null`): B-2a misses `needs_input`,
  B-2b invents it. `session-manager.ts:2526-2546` reads `waiting_input` transitions of the same classifier.
- The API path is right. With a real pending permission in the isolated store, the built
  `getApiActivityState` returns `waiting_input`, and `idle` after I rejected it. So the lifecycle is fine while
  the API answers. The pane rule matters for `ao send`, for the delivery check, and when the API is down.

**Fix (measured).** When the status row exists, it decides. Look for dialog markers only when the status row is
absent, and strip the leading `┃` and spaces first, so the real dialog lines match:

```ts
const lines = out.split("\n");
const last = [...lines].reverse().find((l) => l.trim()) ?? "";
if (last.includes("esc interrupt")) return "active";
if (last.includes("ctrl+p commands")) return "idle";
// no status row: a dialog hides it
for (const l of lines) {
  const t = l.replace(/^\s*┃?\s*/, "");
  if (t.startsWith("△ Permission required")) return "waiting_input";
  if (t.includes("Allow once") && t.includes("Reject")) return "waiting_input";
  if (t.includes("↑↓ select") && /enter (submit|confirm|choose)/.test(t)) return "waiting_input";
}
return "active";
```

I ran this rule on 15 captures: the two real idle captures (`idle`, `idle`), the real busy sample (`active`),
the live tool-output render at both sizes (`idle`, `idle`), the live palette (`idle`), a real idle capture with
a marker in its input box line (`idle`), two prose-marker panes (`idle`, `idle`), and the six real dialogs (all
`waiting_input`). 15 of 15 right. The
remaining hole is a pane that has no status row and has a marker in prose (a pane narrower than about 45
columns, N-6). To close it too, match markers only in the bottom `┃` block.

**Reproducer for B-2a (no model turn, isolated store only).**

```
I=/tmp/<unique>; mkdir -p $I/{home,data,config,state,cache,work}; git -C $I/work init -q -b main
ISO="env -i HOME=$I/home XDG_DATA_HOME=$I/data XDG_CONFIG_HOME=$I/config XDG_STATE_HOME=$I/state XDG_CACHE_HOME=$I/cache PATH=$HOME/.opencode/bin:/usr/bin:/bin"
$ISO opencode service set port <free port>; $ISO opencode service start
$ISO opencode api server.info                       # the pid must NOT be the global service pid
SID=$($ISO opencode api session.create -d '{"title":"AO:x","location":{"directory":"'$I'/work"},
  "permissions":[{"action":"*","resource":"*","effect":"ask"}]}' | jq -r .data.id)
env -u TMUX tmux -L <unique> new-session -d -x 80 -y 24 -c $I/work "$ISO opencode --session $SID"
$ISO opencode api session.permission.create --param sessionID=$SID \
  -d '{"action":"external_directory","resources":["/tmp/x/*"],"save":["/tmp/x/*"]}' &     # waits for a reply
env -u TMUX tmux -L <unique> capture-pane -t <session> -p -S -20 | node classify.mjs     # -> active
$ISO opencode api session.form.create --param sessionID=$SID \
  -d '{"title":"Questions","fields":[{"key":"q0","type":"string","title":"C","description":"Red or blue?",
  "options":[{"value":"Red","label":"Red"},{"value":"Blue","label":"Blue"}]}]}'
```

Cancel with `session.form.cancel` and `session.permission.reply` (`decision: reject`). Stop the tmux server and
the service by PID.

### M-2: the dialog tests pin a shape that the TUI never draws, on a premise that is wrong (`api-activity.test.ts:529-546`, `__fixtures__/panes-2.0.31.ts:1-11`, `api-activity.ts:141-142`)

The two dialog tests build the dialog from lines without `┃` ("constructed census ... shape"). Real dialogs
have `┃` on every line (B-2a). The fixture header and the code comment say that a real capture "needs a model
turn". That premise comes from the brief. It is wrong: `session.permission.create` and `session.form.create`
are in the 2.0.31 OpenAPI, and they make the real dialogs without a model turn. So the tests certify a rule
that never fires, and the comment tells the next maintainer that the rule is verified.

Fix: add the real dialog captures of B-2a (this file has them) to `__fixtures__/panes-2.0.31.ts`, name them
real, and test each one for `waiting_input`. Add the prose case of B-2b (a marker in an unbordered line of an
idle capture → `idle`). Remove the premise from the comment.

### m-6: 7 classifier mutants live (`api-activity.test.ts:471-556`)

| Mutant | Result |
|---|---|
| M21 unknown output → `idle` instead of `active` | **lives**, 201/201 |
| C6 empty capture → `active` instead of `idle` | **lives** |
| C5 `ctrl+p commands` matched on the whole capture, not only on the status row | **lives** |
| C8 `Allow once` OR `Reject` (instead of AND) | **lives** |
| C9 `↑↓ select` OR `enter submit` (instead of AND) | **lives** |
| C11 the `△ Permission required` rule removed | **lives** |
| C12 the `Allow once`+`Reject` rule removed | **lives** |

`09c77de0` tested "empty → idle", "whitespace → idle" and "unknown non-empty output → active" in
`index.test.ts`. The N-2 clean-up removed those three tests and added none in `api-activity.test.ts`. So M21
and C6, which round 1 caught, live now. C11 and C12 live because the census fixture holds both markers: each
rule is covered by the other. Fix: one test per rule with only that marker, one empty, one whitespace-only, one
unknown output, one pane that holds `ctrl+p commands` in the transcript and ends in a toast (→ `active`).
After the B-2 fix these tests move to the real shapes.

### m-7: the 5000 ms bound is no longer pinned (`api-activity.test.ts:139-163`)

Mutant M3b, `OPENCODE_ACTIVITY_API_TIMEOUT_MS = 5_000` → `30_000`, passes 201/201. The new call-shape test
compares `timeoutMs` with the imported constant, so the value can drift. `09c77de0` had a constant-only
`toBeLessThan(10_000)` test that I called weak in round 1. The round removed it as redundant. It was weak, but
it was the only test of the value. The core default is 10 s, and A2 asks for less. Fix: one assertion
`expect(OPENCODE_ACTIVITY_API_TIMEOUT_MS).toBeLessThan(10_000)` next to the call-shape test.

### N-5: stale reference to the removed helper (`packages/core/src/opencode-api.ts:12`)

The module comment still says "`findOpenCodeSession` (plugin) catches and falls back to JSONL". The helper is
gone. The file is outside the files that the round allows, so only note it for the next increment that touches
core.

### N-6: a narrow terminal turns an idle pane into `active`

tmux resizes a window to fit the client that attaches to it. I resized my private pane: 70, 60 and 50 columns still
show `ctrl+p commands` on the status row (`idle`). At 40 columns the row is only the directory, and the idle
pane reads `active`. This follows the stated rule "unknown stays `active`". Say it in the comment, or accept.

## 4. What I tried on the classifier (item 1 of the brief)

All live runs: my own `opencode --session` TUI in a private tmux server (`-L`), isolated store, own port
(service pid 1764428, not the global 3252262), scratch environment, 0 `AO_*` variables in the server and pane
environments. Typed text went into the input box only, no Enter, cleared with `C-u`. I made no model turn (the
session stayed without an assistant message).

| Input | `09c77de0` | `30f1b31d` |
|---|---|---|
| real Muse idle capture (fixture) | `idle` | `idle` |
| real V4.1 Flash idle capture (quotes `esc interrupt` in prose) | `active` | `idle` |
| real busy last-3-lines sample (row holds `esc interrupt` and `ctrl+p commands`) | `active` | `active` |
| real idle capture cut to its last 24 lines | `idle` | `idle` |
| my live idle TUI, 80x24 and 200x50, `-S -20` (200x50 row has a trailing directory) | `idle` | `idle` |
| typed `the esc interrupt rule`, both sizes | `active` | `idle` |
| typed `choose Allow once or Reject`, both sizes | `waiting_input` | `idle` |
| typed `icon: △ Permission required`, both sizes | `waiting_input` | `idle` |
| typed `keys ↑↓ select then enter submit`, both sizes | `waiting_input` | `idle` |
| after `C-u`, both sizes | `idle` | `idle` |
| live tool output (`session.shell`: 4 markers, a diff, a 220-char line that wraps), both sizes | `waiting_input` | `idle` |
| live command palette open (`ctrl+p`), 80x24 | `waiting_input` (from the transcript) | `idle` |
| live width 70 / 60 / 50 / 40 | - | `idle` / `idle` / `idle` / **`active`** (N-6) |
| prose line with `△ Permission required`, `Allow once...Reject`, or `↑↓ select...enter submit` | `waiting_input` | **`waiting_input`** (B-2b) |
| prose line with `esc interrupt` | `active` | `idle` |
| real permission dialog, 80x24 and 200x50, `-S -20` and `-S -10` | `waiting_input` | **`active`** (B-2a) |
| real question form, one field | `waiting_input` | **`active`** (B-2a) |
| real question form, two fields | `active` | `active` |

Answers to the questions of the brief:

- **Lines without `┃`.** The TUI draws assistant prose without `┃` (bullets and wrapped lines too: lines 15-52
  of the V4.1 Flash capture). It draws tool output with `┃`, including diff lines and wrapped long lines (live
  render). Code blocks in assistant prose I could not make (no model turn), so not verified. Prose is the hole
  (B-2b).
- **A toast or a palette as the last line.** The palette is a box above the status row; the row stays and the
  result is `idle`. I could not make a toast. By the rule, a last line without `esc interrupt` or
  `ctrl+p commands` gives `active`.
- **Windows.** `getOutput(handle, 10)` is `capture-pane -S -10`, and `ao send` uses `-S -20`. In tmux the start
  line is relative to the top of the visible screen, so both windows hold the whole screen plus 10 or 20
  history lines. On a real dialog both gave the same answer. The window size does not change any result.
- **Status row with a trailing directory.** The real 200x50 idle row ends with the directory
  (`ctrl+p commands    /tmp/...:main`). `includes()` on the row handles it. `idle`.
- **A real dialog line starts with `┃`.** This is the case, for every line (B-2a). The rule never fires and the
  pane reads `active`.

## 5. Mutants (re-run of round 1, plus new ones)

Scratch copy of the plugin `src` at `30f1b31d` in `/tmp/<unique>/packages/plugins/mut` (core and deps from my
worktree). Baseline: 201/201. I applied each mutant alone, ran the whole plugin suite, and restored the file.
52 mutants: 43 die, 9 live.

**My 14 round-1 survivors, now:**

| Mutant | Now | Test that kills it |
|---|---|---|
| M1 permission/form after `session.active` | dies (2) | `returns waiting_input when a form waits and session.active also holds this ID (M1)` and the permission twin |
| M3 `timeoutMs` removed | dies (1) | `passes timeoutMs and sessionID params to each call including message.list (M3 M33)` |
| M33 `message.list` without `timeoutMs` | dies (1) | same test |
| M31, M32 param key `sessionID` → `sessionId` | die (1 each) | same test |
| M4 four calls in sequence | dies (1) | `starts all four calls before the first resolves (M4 deferred promises)` |
| M12b thrown read counted as readable | dies (1) | `follows the age rule when the message.list read fails in the failed case (M12)` |
| **M12** `let readOk = false` → `true` | **lives** | none. A `null` or `{data:"bad"}` answer makes `blocked` instead of `idle`. |
| M14 age reads `time.updated` first | dies (1) | `ages by time.idle when time.updated is newer (M14)` |
| M15 `inputTokens` without cache | dies (1) | `maps constructed cost fixture with reasoning and cache in the token sums (M15)` |
| M20 `ctrl+p commands` before `esc interrupt` | dies (1) | `gives active for the real busy last-3-lines sample ... (M20)` |
| M23 non-`user` message clears `blocked` | dies (1) | `stays blocked when only a non-user message is newer than time.idle (M23)` |
| M27 no-times early return dropped | dies (1) | `returns null with no times even when a permission list is non-empty (M27)` |
| M29 any key in `session.active` counts | dies (1) | `is not active when session.active holds only another session ID (M29)` |

13 of 14 die. M27 dies only through the test that `30f1b31d` added (a pending permission with no times).

**M12 reproducer.** A scratch test with `session.get` = `{time:{updated,idle}, outcome:"failed"}` and
`session.message.list` returning `null` (a 404) or `{data:"bad"}` (a wrong shape):

```
30f1b31d as is:           2 passed   (idle, idle)
mutant readOk = true:     2 failed   (expected 'blocked' to be 'idle')
```

**The other 22 round-1 mutants.** 20 die, as in round 1: M2, M5, M6, M7, M7b, M8, M9, M10, M11, M13, M16,
M17, M18, M19, M22, M24, M25, M26, M28, M30 (for example M9: 6 tests, M30: 24 tests, M24: 7 tests). Two live
now, and a test of `09c77de0` killed both: M21 (unknown output → `idle`, m-6) and M3b (the bound value, m-7).
The round-1 classifier mutant (`includes()` on the whole capture, C1) now dies with 9 failing tests.

**New classifier mutants:** C2 (the `┃` skip removed) dies (6), C3 (status row = first line) dies (13), C4
(`esc interrupt` on the whole capture) dies (3), C7 (`┃` skip without `trimStart`) dies (6), C10 (no idle-row
rule) dies (13), C13 (question rule removed) dies (1), C14-C16 (`message.list` params `type`, `order`, `limit`)
die (1 each). C5, C6, C8, C9, C11, C12 live (m-6). M21 lives (m-6). M3b lives (m-7).

## 6. No regression

- **Cascade, call budget, cost mapping.** `git diff 09c77de0..30f1b31d -- api-activity.ts` changes only: the
  classifier, the `message.list` params, and the cast. The order of checks, the 5000 ms bound, the 4 parallel
  calls (+1 in the `failed` case), the age rule and the token sums are untouched. Tests assert the 3+1 calls
  and the 4th conditional call.
- **`message.list` form on the live service.** In the isolated 2.0.31 store: `session.message.list` with
  `type=user order=desc limit=1` returns `{"data":[],"cursor":{...}}`, and with `type=shell limit=1` returns the
  shell message. So the server applies the filter (the shell message does not leak into `type=user`). The
  OpenAPI lists `limit`, `order`, `cursor` and `type` (enum with `user`) as query params. I could not make a
  `user` message without a model turn, so the newest-first order on real user messages rests on the round-1
  check and on the OpenAPI text.
- **API path on a real request.** The built `getApiActivityState` on the isolated session: `idle` with no
  request, `waiting_input` with a real pending permission, `idle` after the reject.
- **`findOpenCodeSession`.** `grep -rnw` over `packages/**/*.ts`: no caller. Two hits remain: a comment in core
  (N-5) and quoted transcript text inside the fixture strings. `OpenCodeApiSession` is no longer imported in
  `index.ts`. `getOpenCodeSession` is still used by `getRestoreCommand`.
- **A failed read still means not blocked** for a thrown read (M12b dies). Not for a `null` or wrong-shape
  read in the tests (M12).

## 7. Scope and commits

- `git diff --name-only 09c77de0..30f1b31d`: `__fixtures__/panes-2.0.31.ts`, `api-activity.test.ts`,
  `api-activity.ts`, `index.test.ts`, `index.ts` (all under `packages/plugins/agent-opencode/src/`). All five
  are allowed. `15757aae..30f1b31d` lists the same five files.
- Two commits, conventional (`feat(plugin-opencode)`, `test(plugin-opencode)`), both with the WHY. No
  `Co-Authored-By`, no emoji, no issue number.
- `git branch -r --contains 30f1b31d` prints nothing.
- The fixture file holds real captures of two other workers' panes. It has no secret. It does contain a Unix
  user name in an `ls -la` line. That is harmless in a personal fork.

## 8. Checked and found correct

- The cascade and the call budget of round 1, unchanged.
- The status-row rule for idle and busy panes: every idle, typed-marker, tool-output, palette and 50-70 column
  case I made gives `idle`, and the busy row gives `active` (`esc interrupt` first).
- The `message.list` form `type=user order=desc limit=1`: accepted, filtered, and pinned by a test.
- The 13 killed mutants, each with a test that names the mutant.
- The removal of the dead helper and its import.
- The commit hygiene and the scope.
- The classifier comment is honest about the one thing the author knew: no dialog capture existed in the
  author's hands. The premise was only wrong because the brief said so.

## 9. Not verified

- A toast as the last line (I could not trigger one).
- Code blocks in assistant prose (needs a model turn).
- Typing into or answering a real dialog, and a live `ao send` into one (would press Enter in a dialog). The
  effect of Enter in a dialog is read from the bundle source.
- Widths below 40 columns, and heights other than 24 and 50.
- Herdr panes (the classifier input from the Herdr runtime).
- The newest-first order of `message.list` on real user messages.

## 10. How I ran everything, and cleanup

Everything ran under `env -i` with a fake `HOME`; `pnpm install` and `pnpm build` used the real `HOME` for the
offline pnpm store only. The isolated store had all four `XDG_*` under one `/tmp` directory and its own port.
I checked that the `server.info` pid (1764428) was not the global service (3252262) before the first write.
I ran no real `gh`, no `ao` command, no push and no commit. The global service got only `server.info` and
`GET /openapi.json` calls.

The cleanup block follows (appended after the last command, with the real output).

### Cleanup (real output, run after the last command)

```
$ ps -o pid,args -u "$(id -u)" | grep -E "ao38r2|ao38rev|ao-38/" | grep -v grep | grep -v "ps -o"
(end of list)

$ ls /tmp | grep -E "ao38"        # only the round-2 marker is left, it is removed after the find
ao38r2-marker

$ ls -la --time-style=full-iso ~/.ao/bin        # after
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

(before, taken at the start of this round: the same six lines, same sizes, same times 2026-10-16 12:16:13.96x -0400)

$ find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao38r2-marker
(end of find)

$ for p in 3252262 3215891 3215991 3216043 3216103 3216178; do kill -0 $p && echo alive $p; done
alive (untouched) 3252262
alive (untouched) 3215891
alive (untouched) 3215991
alive (untouched) 3216043
alive (untouched) 3216103
alive (untouched) 3216178

$ git status --short; git log --oneline -1
?? .agent_report.md
?? .agent_task.md
?? development/reviews/i4_review_r1_sonnet.md
?? development/reviews/i4_review_r2_sonnet.md
30f1b31d test(plugin-opencode): pin the no-times null rule even with a pending permission
```
