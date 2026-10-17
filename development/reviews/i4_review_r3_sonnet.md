# I-4 review, round 3 (Sonnet lens): `15757aae..296b21b1`

Reviewer: ao-38 (Claude Sonnet 5.5). Subject: the round-3 commit of ao-37 (`296b21b1`, 3 files) on top of
`30f1b31d`, and the whole increment `15757aae..296b21b1`. I wrote no code and made no commit. My round-1 and
round-2 reviews are unchanged.

## Verdict: LAND-SAFE

0 blockers, 1 major (M-3, not a regression), 1 minor (m-8), 1 note (N-7).

The round fixes B-2 and everything else in my round-2 review. I tried to break the new rule on real dialogs and
on real prose. I found **no wrong `waiting_input`** anywhere. The new rule never reads dialog markers when the
status row exists. It reads only the bottom block of `┃` lines when the status row is gone. In the real TUI
that happens only for a dialog.

The remaining wrong answers are all wrong in the same direction: a real dialog reads `active`. That is what the
base (`15757aae`) and `09c77de0` returned for the same dialogs, so landing does not make any case worse. M-3
lists them with a one-marker fix that I measured. A lifecycle poll is not affected, because the API path reads
`permission.list` and `form.list`.

## 1. Gates (my worktree at `296b21b1`, `env -i`, fake `HOME` under `/tmp`, no `AO_*`)

| Gate | Result |
|---|---|
| `pnpm build` | all packages Done (the dist I used for every live run) |
| plugin test (`--filter @aoagents/ao-plugin-agent-opencode test`) | `Test Files  2 passed (2)`, `Tests  226 passed (226)` (201 in round 2) |
| plugin typecheck | `tsc --noEmit`, no output |
| `pnpm lint` | `✖ 5 problems (0 errors, 5 warnings)` (same 5 as in round 2, none in this increment) |
| `pnpm typecheck` | all Done |
| `pnpm build` (gate run) | all Done |
| full `pnpm test` | exit 0. 2321 passed, 29 skipped, 0 failed (core 948, cli 243, claude-code 208, codex 215, gemini 62, opencode 226, scm-github 140 + 5 skipped, integration 95 + 24 skipped, others 184). Round 2 had 2296. |

## 2. The classifier on the real TUI (item 1 of the brief)

All live runs: my own `opencode --session` TUI in a private tmux server (`-L ao38r3-tui`, started from a scratch
environment, 0 `AO_*` variables in the server and pane environments), isolated store with its own port
(service pid 3288953, not the global 3252262). I raised every dialog with `session.permission.create` (a session
with an `ask` ruleset) or `session.form.create` and I answered it with `session.permission.reply` (`reject`) or
`session.form.cancel`. No model turn: at the end `session.message.list` of the session holds one message, of
type `shell`, and `type=assistant` and `type=user` return empty lists. Typed text went into the input box only,
no Enter, cleared with `C-u`.

### 2.1 The three dialogs of the brief, two sizes, two windows

Each cell is the answer of the built `296b21b1` classifier. `capture-pane -p -S -20` and `-S -10` (the window of
`ao send` and the window of the lifecycle). The round-2 rule (`30f1b31d`) gave `active` for every dialog row.

| Dialog | 80x24 `-S -20` | 80x24 `-S -10` | 200x50 `-S -20` | 200x50 `-S -10` | after the reply or cancel |
|---|---|---|---|---|---|
| permission (`external_directory`, with `save`) | `waiting_input` | `waiting_input` | `waiting_input` | `waiting_input` | `idle` x4 |
| one-field form (options + custom answer) | `waiting_input` | `waiting_input` | `waiting_input` | `waiting_input` | `idle` (both sizes) |
| two-field form (`⇆ tab  ↑↓ select  enter confirm`) | `waiting_input` | `waiting_input` | `waiting_input` | `waiting_input` | `idle` (both sizes) |

Calls that made them (isolated service, `$ISO` = `env -i` with the four `XDG_*` under `/tmp/ao38r3/iso`):

```
$ISO opencode api session.create -d '{"title":"AO:x","location":{"directory":"/tmp/ao38r3/iso/work"},
  "permissions":[{"action":"*","resource":"*","effect":"ask"}]}'
$ISO opencode api session.permission.create --param sessionID=$SID \
  -d '{"action":"external_directory","resources":["/tmp/ao38r3/outside/*"],"save":["/tmp/ao38r3/outside/*"]}'
$ISO opencode api session.permission.reply --param sessionID=$SID --param requestID=$RID \
  -d '{"decision":"reject","message":"review probe"}'
$ISO opencode api session.form.create --param sessionID=$SID -d '{"title":"Questions","fields":[...]}'
$ISO opencode api session.form.cancel --param sessionID=$SID --param formID=$FID
```

### 2.2 More real dialogs, and the attacks

| Input (all real renders, 80x24 and 200x50 unless said) | `296b21b1` |
|---|---|
| permission without `save` (`Allow once   Reject`) | `waiting_input` |
| permission `edit` with a diff body (header scrolled out of 24 rows, button row stays) | `waiting_input` |
| boolean field (`1. Yes 2. No`, `↑↓ select  enter submit`) | `waiting_input` |
| three-field form (select first) | `waiting_input` |
| **palette open (`ctrl+p`) over a pending permission** | `waiting_input` (both sizes); still pending after `Escape` closed the palette |
| permission dialog at 70 / 60 / 50 / 40 / 30 / 24 columns | `waiting_input` x5, `active` at 24 |
| one-field form at 70 / 60 / 50 / 40 / 30 / 24 columns | `waiting_input` x3, `active` at 40 and below (the hint wraps: `↑↓` and `select` land on different rows) |
| idle pane, each marker typed into the input box (6 texts, both sizes, no Enter) | `idle` x12; `idle` after `C-u` |
| idle pane with a marker-heavy tool block in the transcript (live `session.shell`) | `idle` at heights 24, 14, 10, 9, 8 |
| tmux copy mode (scrolled up with a tmux command, same capture call) | `idle` (the capture does not change) |
| prose: a 5-space line with a marker, put in a **real** idle capture (6 texts x 2 captures) | `idle` x12 (round 2: `waiting_input` for 3 of the 6 texts) |
| real idle (Muse, V4.1 Flash) and real busy samples | `idle`, `idle`, `active` |
| window height 7 / 6 / 5 (the TUI drops the status row, the transcript is out of view) | `active` (unknown stays `active`) |

Typed texts: `the esc interrupt rule`, `choose Allow once or Reject`, `icon: △ Permission required`,
`keys ↑↓ select then enter submit`, `hint ⇆ tab  ↑↓ select  enter confirm  esc dismiss`,
`ctrl+p commands and esc interrupt`.

The questions of the brief:

- **A toast or a palette as the last line.** The toast is an overlay at `position: absolute; top: 1; right: 2`
  (bundle, the toast view next to `N$`), so it cannot be the last line of a normal pane. I could not raise one.
  The palette is a box above the status row. Over an idle pane it leaves the row (`idle`). Over a dialog it
  leaves the button or hint row at the bottom (`waiting_input`).
- **A tool-output `┃` block at the bottom of a busy pane whose status row is cut off by the window.** The
  `-S -N` windows start N lines above the top of the screen and end at the bottom row, so they never cut the
  status row. The TUI itself drops the row only for a dialog and for a pane of 7 rows or fewer. At 7 rows the
  transcript is out of view, so there is no `┃` block with a marker to read. I found no input that gives a
  wrong `waiting_input`.
- **A narrow pane.** See the two width rows above. The accepted comment (`api-activity.ts:148-149`) names the
  status row only (N-7).

### 2.3 Inputs that give a wrong state

Only **wrong in one direction**: a real dialog reads `active` where it should read `waiting_input`.

- Forms whose current field is free text, a number or an integer, a multiselect, or an external link (M-3).
- A one-field form at 40 columns or fewer; a permission dialog at 24 columns (N-7).
- By source reading only, not live (they need key presses, which the brief does not allow): the second stage of
  a permission dialog after the user picks `Always allow` or `Reject` (title `Always allow` / `Reject
  permission`, hint `⇆ select  enter confirm  esc cancel`), and the review tab of a multi-field form. In the
  source (`function Zn`) these screens have neither the `△ Permission required` title nor `Allow once`.

None is a regression. See "No regression" in section 5.

## 3. Status of the round-2 findings

### Sonnet lens

| ID | Status | Evidence |
|---|---|---|
| B-2a real dialogs read `active` | **FIXED** | 6 real captures in the fixtures give `waiting_input`; my own 6 + 8 more shapes (sections 2.1, 2.2) give `waiting_input`. Gaps of the same family: M-3. |
| B-2b prose with a marker reads `waiting_input` | **FIXED** | 12 prose variants on real idle captures give `idle`; 12 typed-marker runs give `idle`. The round-2 rule restored as a mutant fails 16 tests. |
| M-2 tests pin an invented shape | **FIXED** | `__fixtures__/panes-2.0.31.ts` holds 6 real dialog captures (made with the create calls, verbatim, with size and window in the header). Each is tested for `waiting_input`. The premise "needs a model turn" is gone from the code comment and the fixture header. The two constructed dialog tests now use `┃` on every line. |
| m-6 seven classifier mutants live | **FIXED** | All 7 die (table in section 4). |
| m-7 the 5000 ms bound not pinned | **FIXED** | `expect(OPENCODE_ACTIVITY_API_TIMEOUT_MS).toBeLessThan(10_000)` (`api-activity.test.ts:171-173`). Mutant M3b (30 000) fails it. |
| N-6 narrow pane reads `active` | **ACCEPTED as a comment** | `api-activity.ts:148-149` says so. The comment is too narrow (N-7). |
| M12 `null` / wrong-shape `message.list` in the `failed` case | **FIXED** | Two tests (`... answers null ...`, `... answers a wrong shape ...`). Mutant M12 (`readOk` starts `true`) fails both. |

### V4.1 Flash lens (`i4_review_r2_v4flash.md`)

| ID | Status | Evidence |
|---|---|---|
| B-1 dialog markers on non-`┃` answer lines read `waiting_input` | **FIXED** | Same as my B-2b. The prose tests replace real answer lines of the real Muse and V4.1 Flash captures. |
| m-6 a dialog line that carries `┃` is missed | **FIXED** | Same as my B-2a. All 6 real dialogs carry `┃` on every line and read `waiting_input`. |
| m-7 the tests only mutate `┃` lines | **FIXED** | The prose tests change real non-`┃` lines. The round-2 rule fails 16 tests. |

## 4. Mutants (re-run of rounds 1 and 2, plus new ones)

Scratch copy of the plugin `src` at `296b21b1` (`/tmp/<unique>/packages/plugins/mut`, deps from my worktree).
Baseline 226/226. I applied each mutant alone, ran the whole plugin suite, and restored the file. 64 mutants:
**59 die, 5 live** (4 real gaps and 1 equivalent mutant, m-8).

**The mutants that lived in round 2 (m-6, m-7, M12), now:**

| Mutant | Now | Failing tests |
|---|---|---|
| M21 unknown output → `idle` | dies (5) | `gives active for ctrl+p commands in the transcript with a toast as the last line`, `gives active for unknown output`, and 3 more |
| C5 `ctrl+p commands` on the whole capture | dies (1) | `gives active for ctrl+p commands in the transcript with a toast as the last line` |
| C6 empty capture → `active` | dies (2) | `gives idle for empty capture`, `gives idle for whitespace-only capture` |
| C8 `Allow once` OR `Reject` | dies (2) | `is not a dialog with only Allow once in place`, `... only Reject ...` |
| C9 `↑↓ select` OR `enter ...` | dies (1) | `is not a dialog with only select in place` |
| C11 triangle rule removed | dies (1) | `gives waiting_input for only the triangle marker in place` |
| C12 `Allow once` rule removed | dies (1) | `gives waiting_input for only Allow once with Reject in place` |
| M3b bound 5 000 → 30 000 | dies (1) | `pins the per-call bound below the helper default of 10 s` |
| M12 `readOk` starts `true` | dies (2) | the `null` and the wrong-shape tests |

**Rule restore.** The round-2 classifier (`30f1b31d`) dies with 16 failing tests. The round-1 classifier
(`includes` on the whole capture) dies with 18.

**My 14 round-1 survivors and the rest of the API mutants** (M1-M33, C14-C16): all die, as in round 2 (for
example M1: 2 tests, M4: the deferred-promise test, M20: the real busy sample, M23, M27, M29, M31-M33).

**New mutants for the block rule:** C3, C4, C10, C13, B3 (no prefix strip), B5/B5b/B5c (one of
`submit`/`confirm`/`choose` dropped), B6 (trailing blank rows not skipped), B7 (only the last line of the
block), B9 (skip the bottom two lines) all die. These live:

| Mutant | What no test pins |
|---|---|
| B1 the walk does not stop at a non-`┃` line | the block ends at the first non-`┃` line |
| B1b the walk skips non-`┃` lines and keeps climbing | same |
| B4 the triangle is matched anywhere in the line (`includes`) | the triangle counts only at the line start |
| B8 the scan reads the whole capture, not the block | the scan is limited to the block |
| B2 the walk does not stop at a blank line | **equivalent**: the `┃` check already stops at a blank line |

## 5. New findings

### M-3 (major, not a regression): other real forms read `active` (`api-activity.ts:182`)

The form marker is `↑↓ select` together with `enter submit|confirm|choose` on one line. The hint line of a real
form depends on the type of its current field. I raised each type with `session.form.create` (no model turn)
and classified the real render at 80x24 and 200x50:

| Field type (current field) | Real hint line | `296b21b1` |
|---|---|---|
| string with options | `↑↓ select  enter submit  esc dismiss` | `waiting_input` |
| boolean | `↑↓ select  enter submit  esc dismiss` | `waiting_input` |
| several fields, select first | `⇆ tab  ↑↓ select  enter confirm  esc dismiss` | `waiting_input` |
| **string, no options** | `⇆ tab  enter confirm  esc dismiss` | **`active`** |
| **integer** | `⇆ tab  enter confirm  esc dismiss` | **`active`** |
| **multiselect** | `⇆ tab  ↑↓ select  enter toggle  esc dismiss` | **`active`** |
| **external (link)** | `⇆ tab  enter open link  c copy  esc dismiss` | **`active`** |

Every form hint ends in `esc dismiss`. `09c77de0` and the base read these four as `active` too, so this is not
a regression. Effect: while such a form is open, `ao send` waits `--timeout`, prints "Sending anyway", and
types into the form. The lifecycle is not affected while the API answers (`session.form.list`).

Fix (measured): add one more marker, `esc dismiss` on a line of the bottom block. I ran `296b21b1` plus this
marker on every real dialog capture I made (38 files: the dialogs, the palette runs and the narrow runs): the four rows above turn to `waiting_input`, and no
other answer changes. The idle, busy and prose captures are not affected, because the marker is read only when
the status row is gone. Add the real captures of these four forms to the fixtures.

Reproducer (isolated store only, same setup as section 2.1):

```
$ISO opencode api session.form.create --param sessionID=$SID \
  -d '{"title":"Questions","fields":[{"key":"q0","title":"Name","description":"Branch name?","type":"string"}]}'
env -u TMUX tmux -L <unique> capture-pane -t <session> -p -S -20 | node classify.mjs     # -> active
# also: "type":"integer" ; "type":"multiselect" with "options":[...] ; "type":"external" with "url":"..."
```

Cancel with `session.form.cancel`.

### m-8 (minor): the block boundary and the line-start rule have no test (`api-activity.test.ts:604-730`)

Four mutants live (B1, B1b, B4, B8; B2 is equivalent). The test "a dialog marker above the bottom block with a
status row last" ends in a status row, so the classifier returns before it reads the block. No test has a
pane without a status row where the boundary matters. In the real TUI this has no effect today, because the
status row is gone only for a dialog. Two tests close it. I checked that both pass on `296b21b1` and that they
kill the four mutants:

```ts
// B1, B1b, B8: a stale marker block above a prose line is outside the bottom block
classifyOpenCodePaneActivity(
  ["  ┃  △ Permission required", "     some assistant prose", "  ┃"].join("\n"),
) → "active"
// B4: the triangle counts only at the start of the line
classifyOpenCodePaneActivity(["  ┃", "  ┃  icon: △ Permission required", "  ┃"].join("\n")) → "active"
```

### N-7 (note): the "accepted" comment is narrower than the real behavior (`api-activity.ts:148-149`)

The comment names the status row of a pane of about 40 columns. A real one-field form also reads `active` at 40
columns and fewer, because the hint wraps (`↑↓` / `select`, `enter` / `submit`). A permission dialog reads
`active` at 24 columns (title `Permission`, buttons on separate rows). A pane of 7 rows or fewer has no status
row, and an idle pane reads `active`. Say "narrow or short pane: the markers wrap or drop, and the pane reads
`active`".

## 6. No regression

- **Cascade, call budget, cost mapping.** `git diff 30f1b31d..296b21b1 -- api-activity.ts`: every hunk is in
  the classifier or its comment (lines 123-186). No hunk touches the API cascade, the `message.list` params,
  the 5000 ms bound, the age rule or the token sums. `index.ts` and `index.test.ts` are not in the commit.
- **Round-2 fixes.** All stay: M1, M3, M4, M12b, M14, M15, M20, M23, M27, M29, M31-M33 still die (section 4);
  no caller of `findOpenCodeSession`; the `message.list` form is unchanged.
- **Against the base and `09c77de0`.** For every real dialog I made, `296b21b1` is never worse than the base
  (`active` for all of them) and never worse than `09c77de0`. I ran the `09c77de0` rule on the narrow and on the
  four missed captures: it reads `active` for the permission dialog at 24 columns, the one-field form at 40
  columns and fewer, and the free-text, integer, multiselect and external forms. `296b21b1` gives the same
  answers there. It never gives a `waiting_input` on a real non-dialog pane.
- **Kept out on purpose, not re-reported:** N-5, Sonnet m-1, m-4, m-5, N-4, Flash m-5.

## 7. Scope and commit

- `git diff --name-only 30f1b31d..296b21b1`: `__fixtures__/panes-2.0.31.ts`, `api-activity.test.ts`,
  `api-activity.ts` (all under `packages/plugins/agent-opencode/src/`). All three are allowed by the round-3
  brief. `15757aae..296b21b1` lists the five files of the increment.
- One commit, `296b21b1 feat(plugin-opencode): read dialogs from the bottom box block, never from prose`, with
  the WHY. No `Co-Authored-By`, no emoji, no issue number.
- `git branch -r --contains 296b21b1` prints nothing.
- The fixtures hold the six real captures verbatim, with the real `/tmp/ao37-r3-*` working directory at the
  right end of the last `┃` row of the 200-column captures (the rule needs this case, and it handles it). They
  hold no `/home` path and no secret. The brief asked for captures at `-S -20` and `-S -10`. The fixtures hold
  `-S -20` only. Both windows gave the same answer in my runs, so this is a nit.

## 8. Checked and found correct

- All three dialogs of the brief at both sizes and both windows, and the idle answer after the reply.
- Eight more dialog shapes, the palette over a dialog, and permission dialogs down to 30 columns.
- Prose, typed markers, tool output, palette, copy mode: no wrong `waiting_input` in any run.
- The structure of the rule: the status row decides first, and the block is read only when the row is gone.
  That is why no prose or transcript line can ever reach a marker.
- The fixture file: real, verbatim, sized and named, with an honest header.
- The tests: 25 new ones, each real dialog, each rule with only its marker, the "alone" negatives, empty,
  whitespace, unknown, the toast, the bound, and the two M12 inputs. 59 of 64 mutants die.
- Commit hygiene, scope, and the gates.

## 9. Not verified

- A toast (I could not raise one; the bundle puts it at the top right).
- The second stage of a permission dialog and the review tab of a form (need key presses).
- A fullscreen dialog (`ctrl+f`, needs a key press in the dialog).
- A busy pane at a narrow width (needs a model turn): whether `esc interrupt` stays on the row there.
- Herdr panes; widths below 24 columns; heights above 50.

## 10. How I ran everything, and cleanup

Everything ran under `env -i` with a fake `HOME`. The isolated store had all four `XDG_*` under one `/tmp`
directory and its own port. I checked that the `server.info` pid (3288953) was not the global service (3252262)
before the first write. I ran no real `gh`, no `ao` command, no push and no commit. The global service got only
`server.info` and `GET /openapi.json` calls. I stopped the tmux server (3291393), its pane processes (3291405,
3291425, 3291410, 3291430) and the service (3288953) by exact PID. I replied to or cancelled every dialog I
raised before I stopped the service.

The cleanup block follows (appended after the last command, with the real output).

### Cleanup (real output, run after the last command)

```
$ ps -o pid,args -u "$(id -u)" | grep -E "ao38r3|ao38r2|ao38rev|fakehome" | grep -v grep | grep -v "ps -o"
(end of list)

$ ls /tmp | grep -E "ao38"        # only the round-3 marker is left, it is removed after the find
ao38r3-marker
$ ls /tmp/tmux-$(id -u) | grep ao38        # private tmux sockets
ao38r2-tui
ao38rev-lc
ao38rev-pane
ao38rev-tui
(end)

$ ls -la --time-style=full-iso ~/.ao/bin        # after
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

(before, taken at the start of this round: the same six entries, same sizes, same times 2026-10-16 12:16:13.96x -0400)

$ find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao38r3-marker
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
?? development/reviews/i4_review_r3_sonnet.md
296b21b1 feat(plugin-opencode): read dialogs from the bottom box block, never from prose
```

Four stale socket files of dead private tmux servers from my rounds 1 and 2 were still in the tmux socket
directory. No server used them. I removed them by exact name:

```
$ ls /tmp/tmux-$(id -u) | grep ao38
(end)
```
