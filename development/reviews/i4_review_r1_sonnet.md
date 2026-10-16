# I-4 review, round 1 (Sonnet lens): `15757aae..09c77de0`

Reviewer: Claude Sonnet 5.5 (ao-38), blind review, lens "sonnet". Date: 2026-10-16.
Author: Muse Spark 1.3 Contributor (OpenCode, ao-37). Worktree HEAD: `09c77de0 feat(plugin-opencode): read
activity, cost and session info from the 2.x API`. One commit, 4 files, `+715 -77`.

**Verdict: NOT-LAND-SAFE**

I found 1 blocker (B-1), 1 major (M-1), 5 minor findings (m-1 to m-5) and 4 notes. The cascade, the
cost mapping, the error handling and the fallback are correct, and they fix the 600 s `ao send` wait for a
normal idle pane. The blocker is in `detectActivity`: it matches its markers anywhere in the capture, so
text that is on the screen overrides the status row. On the real 2.0.31 TUI, an idle pane then reads
`active` or `waiting_input`. B-1 is cheap to fix. I read the author report only after review items 1 to 6.

Scale: B = the landed code behaves wrongly, and for some inputs worse than the base. M = a verified gap
that lets a regression pass. m = polish, an unstated change, or a low-probability risk. N = note.

## 1. Gates (my own runs, my worktree at `09c77de0`, `env -i`, fake `HOME` under `/tmp`, no `AO_*`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | `Done in 1.4s` |
| `pnpm build` | exit 0, last line `packages/cli build: Done` (7.4 s) |
| plugin `test` filter | `Test Files  2 passed (2)` / `Tests  187 passed (187)` (165 in `index.test.ts`, 22 in `api-activity.test.ts`) |
| plugin `typecheck` filter | `tsc --noEmit`, exit 0, no output |
| core `test` filter | `Test Files  37 passed (37)` / `Tests  948 passed (948)` |
| `pnpm lint` | `✖ 5 problems (0 errors, 5 warnings)`: `spawn.ts:339`, `activity-log.ts:91`, `plugin-registry.ts:232`, `session-manager.ts:1538`, `:1545`. None in the 4 files. |
| full `pnpm test` | exit 0. core 948, gemini 62, codex 215, notifier 26, claude-code 208, herdr 36, tracker 42, scm 140 (+5 skipped), runtime-tmux 30, worktree 50, opencode 187, integration 95 (+24 skipped), cli 243. Total 2282 passed, 29 skipped, 0 failed. |
| `pnpm format:check` | fails on 89 files, as at the base. `api-activity.ts` and `api-activity.test.ts` are Prettier-clean. `index.ts` and `index.test.ts` are not clean at the base `15757aae` either. |

These counts equal the author's (187, 948, 2282).

## 2. Findings

### B-1: `detectActivity` matches markers anywhere in the capture (`api-activity.ts:135-147`)

`classifyOpenCodePaneActivity` uses `includes()` on the whole capture. `△ Permission required`,
`Allow once` + `Reject`, and `↑↓ select` + `enter submit` give `waiting_input`. `esc interrupt` gives
`active`. Only after these does `ctrl+p commands` give `idle`. A transcript line, a tool output line or an
unsent line in the input box that holds one of these strings decides the state, even when the status row
says the pane is idle. The 1.x code looked at the last 5 lines only.

The callers pass a large window. `send.ts:171-173` uses `capture-pane -p -S -20`, which returns the visible
screen plus 20 history lines. `runtime-tmux/src/index.ts:82` passes no `-x` or `-y`, so a worker pane has
the tmux `default-size` (80x24 unless the tmux config changes it): 44 lines. The lifecycle uses
`getOutput(handle, 10)`. The callers:

- `ao send` busy check, `send.ts:178-206`. A false `active` makes `ao send` wait the full `--timeout`
  (600 s). That is the bug that I-4 should fix. A false `waiting_input` is worse than the base: after the
  timeout `ao send` prints "session is waiting for interactive input; not sending." and exits 1
  (`send.ts:193-201`). The base sent the message after the timeout.
- The core send confirmation, `session-manager.ts:2339`, `:2526-2545`.
- The terminal fallback of the lifecycle, `lifecycle-manager.ts:429-438`, when `getActivityState` is null.
- `recordActivity` (unchanged) writes the wrong state into the AO JSONL. The JSONL is now the API-down
  fallback, so a fresh false `waiting_input` shows as `needs_input` for up to 5 min when the API is down.

Who sees these strings: the fork's own OpenCode workers. `api-activity.ts`, `index.ts` and both test files
contain all of the literals. The skill text of `ao-communicate` (0009 section 10) names `esc interrupt`.

Evidence 1, the real 2.0.31 TUI, no model turn. I started `opencode --session <id>` in an isolated store, in
private tmux panes of 80x24, 120x40 and 200x50. All three idle panes give `idle` (correct). Then I typed
text into the input box with `tmux send-keys -l`, without Enter, and classified `capture-pane -p -S -10`:

| Text in the input box (not sent) | `detectActivity` | Right answer |
|---|---|---|
| `see skills ao-communicate: the esc interrupt rule` | `active` | `idle` |
| `the dialog says Allow once or Reject` | `waiting_input` | `idle` |
| `icon: △ Permission required` | `waiting_input` | `idle` |
| (box cleared) | `idle` | `idle` |

In every case the status row of the pane still ended with `ctrl+p commands`. The isolated session had 0
messages afterwards. Separately, the open ctrl+p command palette (no typed text) gave `idle`.

Evidence 2, source code on the screen. I built a pane from the real idle capture
(`ao-37-idle-done-2.0.31.txt`, its last 6 rows) plus the 13 source lines `api-activity.ts:135-147`, each with
the `┃` prefix of the TUI, and showed it in a private tmux pane. Both builds, called as `send.ts` calls
them (`capture-pane -p -S -20`, then `agent.detectActivity`):

| Pane | Base `15757aae` | Head `09c77de0` |
|---|---|---|
| real idle capture | `active` | `idle` |
| same idle capture + the source lines on screen | `active` | `waiting_input` |

Reproducer (head build, after `pnpm build`, from the worktree root). Put the last 6 rows of the real capture
in `pane-idle.txt`. Make `pane.txt` from the line `  ┃  icon: △ Permission required` plus those 6 rows. Run:

```
env -i HOME=/tmp/x PATH=<node dir>:/usr/bin:/bin node --input-type=module -e 'import fs from "node:fs"; const a=(await import("./packages/plugins/agent-opencode/dist/index.js")).default.create(); console.log(a.detectActivity(fs.readFileSync(0,"utf8")))' < pane.txt
```

I ran it: `pane-idle.txt` prints `idle`, `pane.txt` prints `waiting_input`.

Not wrong: a real busy pane. `esc interrupt` is checked before `ctrl+p commands`, so a pane that shows
both gives `active` (mutant M20 shows that no test pins this order, see M-1).

Fix, small: decide from the status row. It is the last non-empty line of the capture, under the `╹▀▀▀`
border. Idle if it ends in `ctrl+p commands`; busy if it holds `esc interrupt`. Match the dialog markers as
whole trimmed lines, because in the real capture the transcript and the input text carry the `┃` prefix and
the dialog lines do not. I have no real permission or question capture (those need a model turn), so check
the whole-line form against a real dialog before you land it. Add tests: the real 2.0.31 idle capture, the 80x24
idle capture, and each marker typed into the input box.

### M-1: the tests let 3 of the 5 required mutants live, and more (`api-activity.test.ts`, `index.test.ts`)

I made 36 mutants in a scratch copy and ran the committed tests against each. 22 are caught, 14 live. The
brief names five mutants (item 8). Three of them live:

| Brief mutant | Result |
|---|---|
| M1 permission and form checks after the `session.active` check | **lives**, 187/187 pass |
| M2 `blocked` without the newer-`user` check | caught (1 test) |
| M3 5000 ms bound removed from the calls | **lives**, 187/187 pass |
| M4 the four calls in sequence | **lives**, 187/187 pass |
| M5 `outputTokens` without `reasoning` | caught (1 test) |

Why they live: every `waiting_input` test uses `session.active` = `{}` (`api-activity.test.ts:60`, `:79`), so
the order of the checks is never tested. 0010 section 3 (M-1) says that this order is the point: a session
that waits on a permission is also in `session.active`. The call mock ignores `timeoutMs` and the params.
`api-activity.test.ts:232-234` tests the constant (`toBeLessThan(10_000)`), not the use of it. No test
holds a call open, so nothing can tell parallel from sequential.

All 14 survivors:

| Mutant | What no test pins |
|---|---|
| M1 | permission/form before `session.active` |
| M3 | `timeoutMs` passed to the 4 calls (M33: also to `session.message.list`) |
| M4 | the 4 calls run in parallel |
| M12, M12b | a failed `session.message.list` read means "not blocked" (A1 step 6) |
| M14 | the age rule reads `time.idle` before `time.updated` (all fixtures set both equal) |
| M15 | `inputTokens` adds `cache.read` and `cache.write` (fixture has cache 0/0) |
| M20 | `esc interrupt` is checked before `ctrl+p commands` |
| M23 | only `user` messages count in the newer-message scan |
| M27 | a record with neither `time.updated` nor `time.idle` gives null |
| M29 | `session.active` lists only this ID: `Object.keys(activeData).length > 0` also passes |
| M31, M32 | the param name `sessionID` |

M29 is the worst. `session.active` is global. A map that holds any other busy worker would make every worker
`active`, and stuck detection would stop for the fleet. No test puts a different ID in the map.

What the tests do well: 22 mutants die, among them the global `form.list` (M30, 16 failures), `interrupted`
as `blocked`, the JSONL override (M9, 6 failures), the missing fallback (M8, 4 failures), and the
`getSessionInfo` bound (M18, via `expect.any(Number)`).

Fix: add (a) a test with a permission pending and the ID in `session.active`, expecting `waiting_input`;
(b) a test with another ID in `session.active`; (c) assertions on `timeoutMs` and `params` of each call;
(d) a test with deferred promises that shows the 4 calls are open at once; (e) failed `message.list` reads
for `blocked`; (f) fixtures with `time.idle` older than `time.updated`, and with non-zero cache.

### m-1: the cost of a lifecycle poll is 9 `opencode api` processes per session, not 4

A2 counts calls per `getActivityState`. The callers call it twice per poll. With the real core, a fake
`opencode` that logs each call, and one OpenCode session in a private tmux pane:

| Build | `opencode api` processes per session and poll (measured) | Where |
|---|---|---|
| base `15757aae` | 3 (all `session.get`) | list enrich: `getActivityState` 1 + `getSessionInfo` 1 (`session-manager.ts:1165`, `:1178`); `determineStatus`: `getActivityState` 1 (`lifecycle-manager.ts:414`) |
| head `09c77de0` | 9 (4 + 1 + 4); 11 when `outcome` is `failed` | the same three call sites: 4 + 1 + 4, and one extra `session.message.list` for each `getActivityState` in the failed case |

I counted the calls with a fake `opencode` that logs every call, driven by the real session manager and
lifecycle manager (3 polls for the failed case, 2 polls plus one `sm.get` for the normal case). So I-4
triples the process count. The author report and the brief give "4 per session and poll".

Measured on this host (read-only, one real session id from `session.list`, the plugin build, `env -i`):

- One `getActivityState`: 148 to 200 ms (5 runs). One `getSessionInfo`: 124 ms.
- One `opencode api` call: user 0.18 s + sys 0.05 s, 92 MB peak RSS.
- Lifecycle poll model (list enrich, then `determineStatus`), all sessions in parallel:
  1 session 423 ms / 9 processes; 5 sessions 497 ms / 45; 10 sessions 790 ms / 90.
- `ao status` with 10 sessions: list enrich 448 ms (50 processes) + `status.ts:102` `getSessionInfo` 153 ms
  (10 processes) = about 0.6 s, 60 processes.
- CPU: 225 processes cost 47.6 CPU-s in my run, 0.21 CPU-s each. A 10-session poll costs about 19 CPU-s,
  about 0.6 core on average at a 30 s interval, in bursts of 40 concurrent processes (about 3.7 GB RSS for
  0.3 to 0.45 s). The host has 36 cores and 125 GB. This is harmless here. It scales with sessions.
- All sessions run in parallel: `session-manager.ts:1950-1990` (`Promise.all`), `lifecycle-manager.ts:1316`
  (`Promise.allSettled`).
- A slow or hung service does not stall the loop. A fake `opencode` that sleeps: one `getActivityState`
  returns null after 5010 ms (bound 5000). `sm.list()` with 10 sessions returns after 10231 ms
  (activity 5 s + info 5 s, in parallel across sessions, inside the 12 s race at `session-manager.ts:1974`).
  Then `determineStatus` adds 5 s. So a poll takes about 15 s of the 30 s interval. The re-entrancy guard
  (`lifecycle-manager.ts:1296`) skips a poll that overlaps.
- 4 parallel `opencode api` calls with no service running: all 4 answered in 0.48 s, and exactly one
  `opencode serve --service` started. There is no start race.

Fix options (not blockers): fetch `session.active` once per tick for all sessions (0009 section 5.5 says
so); or let the lifecycle reuse the `session.activity` that `list()` just set. A5 forbids a longer cache
without a test, and the second needs a core change. Say the true figure in the docs.

### m-2: `session.message.list` reads a default page where one record is enough (`api-activity.ts:220-223`)

The `blocked` check calls `session.message.list` with no `limit`, `type` or `order`. I measured in the
isolated store (150 `agent-switched` messages made with `session.switchAgent`, no model turn): the default is
50 messages, newest first (the cursor holds `"order":"desc"`). A real failed session has assistant messages
with tool parts, so the page can be large. 0010 section 11.1 shows that a large answer through the pipe can
be cut with exit 0 under a busy event loop. The helper catches a cut answer (see section 3, item 4), but then
`readOk` is false and the state flips from `blocked` to `idle` for that poll. The fake probe confirms it:
a cut or empty `message.list` in the failed case gives `idle`.

Fix: `--param type=user --param order=desc --param limit=1`. I checked that this form is accepted and returns
`{"data":[],...}` in a session with no user message. It returns one small record.

### m-3: `void findOpenCodeSession;` (`index.ts:501-505`)

Both callers of `findOpenCodeSession` were replaced (base `:539`, `:627`), so the helper (`index.ts:377`) is
dead code. A runtime `void` statement keeps it alive to silence `no-unused-vars`. Its doc comment ("so
activity falls back to JSONL and session info reports no data") is now false. Section 2 of the brief allows
removing a helper that becomes unused, and A5 forbids changing it: the two lines conflict, and the author
reported it. The clean form is to delete the helper with its section header (`index.ts:365-389`), the
`void` line with its comment, and the type import `OpenCodeApiSession` (`index.ts:27`). I checked this on a
scratch copy of `09c77de0`: `tsc --noEmit` prints nothing and `eslint` exits 0. `getOpenCodeSession` stays
in use (`getRestoreCommand`, `index.ts:635`).

### m-4: the `ao send` delivery check is reachable now (`send.ts:233-253`, not in the commit)

With the base, an OpenCode pane always read `active`, so "Message sent and processing" printed at the first
check, true or not. With the fix, the check is honest, and it can fail: if the pane does not show `esc
interrupt` at the polls (2 s, 5 s, 8 s), the loop sends up to 2 extra `Enter` keys and prints "Message sent
— could not confirm it was received". Real `ao send --timeout 8 scr-1` against a static idle pane
(scratch project, private tmux, stub `opencode`):

| Build | Output | Time |
|---|---|---|
| base | `Waiting for scr-1 to become idle...` / `Timeout waiting for idle. Sending anyway.` / `Message sent and processing` | 12.9 s (8 s wait) |
| head | `Message sent — could not confirm it was received` | 8.9 s (no wait; 3 delivery polls) |

A pane that never turns busy is my fixture, not the real TUI. But a reply that finishes in under 2 s
(0010 section 6: PONG in 1.2 s) can leave the pane idle at every poll. The extra `Enter` on an empty input
box is probably harmless, but I did not measure it. Not an I-4 defect. Record it for I-5, which replaces
this path.

### m-5: `blocked` never decays

The rule keeps `blocked` while `outcome == "failed"` and no newer `user` message exists
(`api-activity.ts:215-237`). It has no age cap. I ran it with a failed turn that ended 20 min, 1 day and 30
days ago: `blocked` each time, timestamp `time.idle`. The AO JSONL path caps `blocked` at 5 min
(`ACTIVITY_INPUT_STALENESS_MS`), so the two paths disagree. What the lifecycle does with it, measured with
the real lifecycle manager (3 polls, 4 s apart, `agent-stuck` reaction at the default `10m`, notifier stub):
`working` → `stuck` once, one `notify-send --urgency=critical URGENT [scr-1] Reaction 'agent-stuck'
triggered notification`, then no further notification and no further transition. `blocked` is treated like
`idle` in the lifecycle (`lifecycle-manager.ts:419-424`). It does not loop and does not repeat. `ao status`
shows a red `blocked` for a failed worker for ever, until a human sends a message. This follows the brief.
Decide whether an old failed worker should keep the red label.

### Notes

- N-1. The `outcome` read in `api-activity.ts:162` casts through `unknown`, but `OpenCodeApiSession` has an
  index signature (`opencode-api.ts:94`). The cast is not needed.
- N-2. `detectActivity` tests exist in both files with the same fixtures. They use the 3-line 0009 capture,
  not the real 2.0.31 capture. Use the real files (see B-1).
- N-3. `index.test.ts` drops the line `mockReadLastActivityEntry.mockResolvedValueOnce(null)` from the test
  "falls back to opencode API when activity JSONL is empty". The test still passes. The title is now stale.
- N-4. After I-1, a 1.x binary is refused at launch. A running 1.x pane now reads `active` unless it shows
  the 2.x footer. I did not test 1.x. The host runs 2.0.31 only.

## 3. Review items 1 to 10

### Item 1, the cascade

I read `getApiActivityState` (`api-activity.ts:176-246`) against 0010 M-1, M-2, M-3 and section 13, and ran
it live and against a fake `opencode`.

- Order: four parallel calls; any null, error, 404 or bad shape gives null (`:195-201`); no time at all gives
  null (`:204`); permission or form list not empty gives `waiting_input` (`:206`) before `session.active`
  (`:211`) gives `active`, timestamp now. This is the order that M-1 needs. Correct in the code, untested (M-1
  mutant M1).
- `outcome` and `time.idle` describe the last finished turn (M-2): the `failed` branch runs only when the ID
  is not in `session.active`, so a running turn hides the stale `failed`. Correct.
- `interrupted` falls to the age rule (M-3): live fake run gives `idle`, no `blocked`. Correct.
- I found no input where the cascade gives a wrong state against the design. Wrong or doubtful inputs are
  outside the cascade: B-1 (pane text), a permission asked by a subagent session (not measured, see
  section 5), and a stale form that "comes back" (0010 section 5.5, same as the design).
- `blocked`: see m-5. It never decays. The lifecycle and notifier: one `stuck` transition and one urgent
  notification per stuck episode, no repeat per poll, no reaction loop (3 polls measured).
- A new session with no prompt reads `active` with timestamp `time.updated`, then `ready` after 30 s, then
  `idle` after the threshold. Live: `active`, `ts` equal to `time.updated`.

### Item 2, the callers

| Caller | Source | Change for an OpenCode session |
|---|---|---|
| Lifecycle status | `lifecycle-manager.ts:395-450` | `getActivityState` is API-first now. `waiting_input` gives `needs_input`; `exited` gives `killed`; `idle` or `blocked` with a timestamp feeds stuck detection (`:419-424`, `:511`, `:545`, `:557`); null gives the pane fallback with the new classifier (B-1). `recordActivity` still runs first. |
| Session enrich | `session-manager.ts:1165`, `:1178` (used by `list`, `get`, `restore` at `:2816`) | Same calls. `session.activity`, `lastActivityAt` and `agentInfo` (now with `cost`). Restore: the `exited` step is unchanged. |
| `ao status` | `status.ts:282` (`sm.list`), `:102` | +1 `getSessionInfo` per session. Nothing prints `cost`. `status.ts:494` builds a session with empty metadata: no stored ID, no API call. |
| `ao send` busy check | `send.ts:178-206` | Idle pane gives `idle` (fix). B-1 for marker text. m-4 for the delivery check. |
| Core send confirmation | `session-manager.ts:2339`, `:2526-2545` | Activity transitions can now be seen. Same B-1 exposure. |
| Stuck detection | `lifecycle-manager.ts:338-347` | An idle OpenCode worker reaches `stuck` after the `agent-stuck` threshold, as before (age of `time.idle` instead of CLI `updated`). A long tool call stays `active` (owner decision). |

The 600 s claim, checked on the base with the real `ao send` (m-4 table): the base waited the whole
`--timeout` on an idle pane and then said "Sending anyway". The base `detectActivity` gives `active` for the
real idle capture (also shown in B-1). The head gives `idle` and does not wait. The claim is true, and the fix
works for a normal idle pane.

### Item 3, cost of a poll

See m-1. Numbers: 9 processes (11 if `failed`) per session and poll, 0.8 s for 10 healthy sessions, about
15 s for 10 sessions with a hung service, no stall of the loop.

### Item 4, errors and the fallback

Fake `opencode` that prints a cut answer (`{"data":[`) with exit 0, an empty answer with exit 0, or sleeps
(`exec sleep 60`), per operation, with the real core helper and the built plugin:

| Case | No JSONL | Fresh JSONL `waiting_input` |
|---|---|---|
| cut answer on `session.permission.list`, `.form.list`, `.active`, `.get` | null | `waiting_input` |
| empty answer on the same 4 | null | (same code path) |
| hung service (all calls) | null after 5010 ms | `waiting_input` after 5013 ms |
| one hung call (`session.active`) | null after 5010 ms | |
| cut or empty `session.message.list` in the failed case | `idle` (not `blocked`) | |
| `getSessionInfo`, hung service / cut `session.get` | null after 5005 ms / 6 ms | |

The helper turns exit 0 with unparsable output into an error (`opencode-api.ts:205-222`), so a cut answer
never becomes an empty list. Isolated live run: a JSONL `waiting_input` written 0 s ago does not override a
live session whose lists are empty (result `active`). After `session.remove` (404), the same fresh JSONL entry
gives `waiting_input`. The raw 404 of `session.permission.list`, `.form.list` and `.message.list` on a removed
ID gives null in the helper. A malformed ID and an unknown well-formed ID give null.

### Item 5, `detectActivity`

See B-1. Real idle panes at 80x24, 120x40 and 200x50 on 2.0.31, the real ao-37 idle capture, the 0009 5.1
capture, and the ctrl+p palette all give `idle`. Marker text in the transcript or the input box gives a wrong
state. A bare shell prompt (`user@host:~/wt$ `) gives `active`, as at the base (the 1.x rule only matched a
bare `$`). The question and permission markers are only tested on constructed text (those dialogs need a model
turn). 1.x: see N-4.

### Item 6, `getSessionInfo`

`mapSessionCost` (`api-activity.ts:99-118`) gives `inputTokens = input + cache.read + cache.write`,
`outputTokens = output + reasoning`, `estimatedCostUsd = cost`, and returns undefined (no `cost`) if any
number is missing, negative or not finite. Live: a new session gives `cost: {0, 0, 0}`; the real session
`ses_eba4e6e11ffe0naaqTrf5GJeg2` gives `{inputTokens: 17242378, outputTokens: 74830, estimatedCostUsd:
0.09115838}`. A 404, a timeout and a cut answer give null. The 2.0.31 `GET /openapi.json` (277296 bytes,
global service, read only), `Session.Info`: required `id projectID cost tokens time location`; `cost` is
`Money.USD` = `number`; `tokens` required `input output reasoning cache{read, write}`, all `number`;
`outcome` enum `succeeded|failed|interrupted`; `time` `{created, updated}` required, `idle viewed archived`
optional numbers; `SessionActive` = `{type: "running"}` only. The field names and types in 0009 sections 5.2
and 7 are the same in 2.0.31. I could not diff against 2.0.29: that document is not on disk (0009 gives
276536 bytes; 2.0.31 is 760 bytes bigger). `session.permission.list` and `session.form.list` can answer 404
with `LocationNotFoundError` as well as `SessionNotFoundError`; the helper treats any `HTTP 404` as null.

### Item 7, `void findOpenCodeSession`

See m-3. The clean form is deletion.

### Item 8, tests

See M-1 for the 36 mutants. The other tests assert results (state, timestamp, cost values, call counts) and
not copies of literals, with two exceptions: the constant test at `api-activity.test.ts:232-234`, and the
pane tests, whose fixtures are constructed.

### Item 9, live, isolated, no model turn

Isolated store under `/tmp`, all four `XDG_*` there, port 49551, `server.info` pid 1025247 (not the global
3252262), built worktree under `env -i`:

| Step | Result |
|---|---|
| `session.create`, no prompt | record keys `id,projectID,cost,tokens,time,title,location`; no `outcome`, no `idle` |
| `getActivityState` | `active`, timestamp = `time.updated` (source: age rule, no `time.idle`), 213 ms |
| `getSessionInfo` | `{"summary":"AO:ao38rev-live","summaryIsFallback":true,"agentSessionId":"ses_…","cost":{"inputTokens":0,"outputTokens":0,"estimatedCostUsd":0}}`, 558 ms |
| after `session.remove` | `getActivityState` null (147 ms), `getSessionInfo` null (105 ms) |
| fresh JSONL `waiting_input` + session alive | `active` (JSONL does not win) |
| fresh JSONL `waiting_input` + 404 | `waiting_input` |
| fake `opencode`, `exec sleep 60` | `getActivityState` null after 5010 ms; with a fresh JSONL `waiting_input` after 5013 ms; `getSessionInfo` null after 5005 ms |

### Item 10, scope and commit

`git diff --name-only 15757aae..09c77de0` lists only the 4 files of the brief. In `index.ts` only the import
block, `detectActivity`, `getActivityState`, `getSessionInfo`, and the removed `parseApiUpdatedTimestamp`
changed. The subject is `feat(plugin-opencode): ...` (76 characters); the body states the WHY in one 492-char
line. No `Co-Authored-By`, no emoji, no issue number, ASCII only. `git branch -r --contains 09c77de0` prints
nothing.

## 4. Checked and found correct

- The cascade order, the `failed` + newer-user rule, `interrupted` by age, the age windows, the null rule.
- Four calls in parallel in the code (`Promise.all`), each bounded at 5000 ms; the message call is bounded.
- Cut, empty, timed-out, 404 and bad-shape answers each give the JSONL fallback. A JSONL `waiting_input`
  never overrides a live answer, and it still shows when the API is down.
- `getSessionInfo`: mapping, bad-number rule, null on 404 and on error, bound.
- The tests for the seven required `getActivityState` cases exist and pass; they cover the JSONL fallback
  group (`index.test.ts:1089-1180`).
- Real 2.0.31 idle panes at three sizes give `idle`. `ao send` no longer waits on an idle pane.
- Lifecycle `blocked` gives one `stuck` and one notification, with no loop.
- Gates, scope, commit message, no remote branch.

## 5. Not verified

- A permission that a subagent (child session) asks. `session.permission.list` is "owned by a session", so the
  parent list is probably empty while the parent is in `session.active`. That would give `active`. Needs a
  model turn.
- Real permission and question dialogs (only the 0010 census text exists).
- `interrupted` decaying like `succeeded` (inferred in 0010, not measured).
- The size of a real failed session's `session.message.list` page. `session.message.list` is not on the list of
  read operations that the brief allows on the global service, so I did not call it there.
- The extra `Enter` keys of m-4 on a real TUI.
- What the 760 extra bytes of the 2.0.31 OpenAPI document are.

## 6. How I ran everything, and cleanup

- Every `node`, `ao`, `pnpm` and `opencode` call ran under `env -i` with a fake or scratch `HOME` and a
  scratch `PATH`. The calls against the global service used the real `HOME` (the CLI finds the service
  there) and were only `server.info`, `session.active`, `GET /openapi.json`, `session.list --param limit=10`,
  and the four operations of `getApiActivityState` / `getApiSessionInfo` for one existing session id. I never
  read a `service.json`. No model turn anywhere. No real `gh`, no push, no commit.
- Private tmux servers (all `-L`, started from a scratch environment, `/proc/<pid>/environ` checked: 0 `AO_*`
  variables, also in the panes): `ao38rev-pane` (pid 1084680), `ao38rev-lc` (pid 1156070, pane process
  1156071), `ao38rev-tui` (pid 1181569, three TUI panes). The first isolated OpenCode service (pid 1025247)
  was stopped with `opencode service stop` (all four `XDG_*` under `/tmp`). The race test started a second
  one (pid 1097808). I stopped the three tmux servers and the service by exact PID with `kill`.
- The global service 3252262 and the lifecycle workers 3215891, 3215991, 3216043, 3216103, 3216178 were
  running before and after; I did not signal them.
- `/tmp/ao38rev` removed. `/tmp/ao38rev-marker` (empty) stays, so the `find` below can be run again.

After cleanup:

```
$ ps -o pid,args -u "$(id -u)" | grep ao38rev | grep -v grep | grep -v 'ps -o'
(empty)

$ ls -la --time-style=full-iso ~/.ao/bin          # identical to the listing before my work
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

$ find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao38rev-marker
(empty)
```
