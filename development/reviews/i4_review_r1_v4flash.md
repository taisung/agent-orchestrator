# Blind review, round 1 — I-4: OpenCode activity, cost and session info from the 2.x API

**Reviewer**: ao-39, lens v4flash (DeepSeek V4.1 Flash). **Range**: `15757aae..09c77de0de179ef7dd09e7dddd6149e7dc3a2aba`.
**Author**: Muse Spark 1.3 Contributor (OpenCode, ao-37). **Date**: 2026-10-16.
**Host**: OpenCode **2.0.31** (global service PID 3252262). The notes measured 2.0.29; the saved 2.0.29
document at `/tmp/opencode-openapi.json` let me diff the two documents (§6 below).

## Verdict

**LAND-SAFE.**

The shipped code implements the brief faithfully: the cascade, the call budget, the cost mapping and the
2.x pane classifier all match A1–A5 and the design note, and I reproduced the intended behavior live in an
isolated store. No blocker. The findings below are a **coverage gap on two requirements that the brief
itself singles out**, one content-dependent classifier over-match, and three minors. None of them make the
current commit wrong; two of them would let a future change silently break a stated behavior.

**Counts: 0 blockers, 2 major, 5 minor.**

---

## Findings

### M-1 (major) — the permission/form check *before* `session.active` has no test; the mutant passes

`packages/plugins/agent-opencode/src/api-activity.ts:206` (permission/form branch) and `:211`
(`session.active` branch).

0010 M-1 is explicit: "`session.active` listed a session for the whole turn … It also listed sessions that
waited on a permission or a question." That is the entire reason the two lists must be checked before
`session.active`, and the review brief calls it out (review item 1, M-1). The shipped code has the right
order, but **no test exercises the conflict**: every `waiting_input` fixture sets `session.active` to
`{}` (e.g. `api-activity.test.ts:60, 79, 96`).

Evidence — I moved the two branches in a scratch copy (`git archive 09c77de0`) so `session.active` is
checked first, then ran the plugin suite:

```
##### MUTANT: 1: permission/form checks moved AFTER session.active
 Test Files  2 passed (2)
      Tests  187 passed (187)
--- failing tests ---
(empty)
```

Reproducer: swap the two blocks at `api-activity.ts:206-213` and run
`pnpm --filter @aoagents/ao-plugin-agent-opencode test`. All 187 tests stay green. With the swap, a session
that waits on a permission that is also `running` (the exact M-1 case) is reported `active` instead of
`waiting_input`, so `determineStatus` (`lifecycle-manager.ts:416`) returns `working` instead of
`needs_input`, and `ao send`'s busy check stops warning. A one-line regression here is invisible. **Fix:
add a test with a non-empty permission list *and* `session.active` holding the ID, asserting
`waiting_input`.**

### M-2 (major) — `esc interrupt` is matched anywhere, so an idle pane that quotes the phrase is `active`

`packages/plugins/agent-opencode/src/api-activity.ts:144` (and the doc comment at `:125`).

The doc comment says `active` is for "`esc interrupt` under the `╹▀▀▀` border", but the code does a bare
`terminalOutput.includes("esc interrupt")`, checked *before* the idle marker. Any idle pane whose content
merely contains the phrase is classified `active` — and the phrase is common in ao text (the I-4 brief
itself, the ao skills, the ao-communicate/ao-lifecycle docs all write "`esc interrupt`"). This reintroduces
the class of bug I-4 exists to fix (idle pane → `active` → `ao send` waits, JSONL stays `active`).

Evidence — real-pane classifier run against the built plugin
(`node classify.mjs`, fixtures from the real 2.0.31 idle capture, 0009 §5.1, and 0010 §11.5):

```
ok    expected=idle          got=idle          :: real 2.0.31 idle capture (full, 60 lines)
ok    expected=idle          got=idle          :: 0009 section 5.1 idle capture
ok    expected=active        got=active        :: census running fixture with footer ctrl+p commands
ok    expected=waiting_input got=waiting_input :: census permission fixture
ok    expected=waiting_input got=waiting_input :: census question fixture
WRONG expected=idle          got=active        :: IDLE pane quoting the words esc interrupt in its content
```

The `WRONG` fixture is an ordinary idle pane (status row `ctrl+p commands`, no running row) whose scrollback
contains the sentence "the pane's `esc interrupt` rule is a 1.x fact". Note the author's own real capture
did not contain the phrase, so the primary case works; the defect is the missing border/position
requirement the comment promises. This is content-dependent, hence major rather than blocker. **Fix: either
put `ctrl+p commands` before `esc interrupt` when there is no running border, or require the phrase to sit
on the running row (e.g. `╹▀▀▀` … `esc interrupt`), or drop the `esc interrupt` check and rely on
`session.active` for the API path.**

### m-1 (minor) — the four calls' parallelism (A2) has no test; the sequential mutant passes

`api-activity.ts:178-191` (the `Promise.all`). A2 requires the four calls to run in parallel. Mutating them
to four sequential `await`s leaves the suite green:

```
##### MUTANT: 4: the four calls made in sequence
 Test Files  2 passed (2)
      Tests  187 passed (187)
--- failing tests ---
(empty)
```

The shipped code is parallel (measured below), so this is a test gap, not a defect: a regression would
multiply the per-session poll cost four-fold with nothing to catch it. **Fix: assert the four calls start
before the first resolves (e.g. record invocation order with a deferred promise).**

### m-2 (minor) — "a failed `session.message.list` read means *not* blocked" has no test

`api-activity.ts:234` (`if (readOk && …)`). A1 step 6 says a failed read of the message list must be
treated as "not blocked" and continue with the age rule. Removing the `readOk` guard (treating a failed
read as blocked) leaves the suite green:

```
##### MUTANT: 8: blocked even when the message list read fails
 Test Files  2 passed (2)
      Tests  187 passed (187)
```

**Fix: add a case where `outcome:"failed"` and `session.message.list` rejects, asserting the age-rule state
(not `blocked`).**

### m-3 (minor) — `void findOpenCodeSession;` is a dead-code workaround, not the clean form

`packages/plugins/agent-opencode/src/index.ts:502-505`.

`findOpenCodeSession` (`index.ts:377-387`) is now referenced only by `void findOpenCodeSession;`
(`grep -n findOpenCodeSession index.ts` → `377` def, `502` comment, `505` the `void`). The author brief
section 2 says: "remove a helper there only if it becomes unused." The clean form is to delete the helper
and the `void` line; keeping a function alive with a no-op statement to satisfy `no-unused-vars` is noise.
The tension with A5 ("do not change `findOpenCodeSession`") is real and the author flagged it
(`.agent_report.md:103-104`); section 2 explicitly permits removal, so removal wins. Not a defect.

### m-4 (minor) — the `blocked` branch pulls the whole message history

`api-activity.ts:220-222`. The extra `session.message.list` passes only `sessionID`, no `limit` and no
`type`. Measured against the global service (read-only, no prompt):

```
session ses_eba4e6e11ffe0naaqTrf5GJeg2: no-limit 180 ms, bytes(no-limit) 262144 (pipe-cut)
session ses_eba3ac87dffeGiDC5kjl34itRW: no-limit 192 ms, bytes(no-limit) 588080
```

On this host it is fast and `execFile` (64 MiB buffer) does not truncate, but the answer grows with the
conversation. `session.message.list` accepts `type` and `limit`; the code only needs the newest `user`
message. For a very large failed session the call can approach the 5000 ms bound, and a timeout becomes
`readOk=false`, silently losing `blocked`. **Fix: `--param type=user --param limit=1` (order defaults to
`desc`, verified: the returned cursor decodes to `"order":"desc"`).**

### m-5 (minor / observation) — API `blocked` does not decay by itself

`api-activity.ts:234-236`. Unlike the JSONL `blocked` (5-minute staleness cap,
`activity-log.ts:23,190`), the API `blocked` has a fixed timestamp (`time.idle`) and stays `blocked` until
a new turn overwrites `outcome`. Asked by the brief: it does **not** decay at the plugin layer, and there
is **no notifier or reaction loop** — `determineStatus` folds `blocked` into `detectedIdleTimestamp`
(`lifecycle-manager.ts:419-424`), the agent-stuck rule (`:557`) turns it into `stuck` once `time.idle` is
past the threshold, and `checkSession` fires events only when `newStatus !== oldStatus`
(`lifecycle-manager.ts:1191`). So a permanently failed session settles at `stuck`, once. A side effect is
that `session.activity` keeps reading `blocked` in `ao status` forever; that is the brief's chosen rule,
recorded here as an observation, not a defect.

---

## What I checked and found correct

**Review item 1 — the cascade (`api-activity.ts:176-241`).** Each step matches A1 and 0010: permission/form
before `session.active` (`:206` before `:211`); all four must answer the expected shape else null (`:193-204`);
`active` timestamp is `now` (`:212`, 0010 §10); `outcome "failed"` + no newer `user` → `blocked` with
`time.idle` (`:216-237`); `interrupted` is not `blocked` and decays by age like `succeeded` (`:217-239`); age of
`time.idle` else `time.updated` (`:218-241`). `lastUser <= idle` uses the latest `user` `time.created`
(`getLastUserMessageTime`, `:71-83`). I found no input that yields a wrong state in the shipped code.

**Review item 2 — the callers.** `lifecycle-manager.ts:414` (via `determineStatus`), `session-manager.ts:1165`
(list enrichment) and `:1178`/`status.ts:102,494` (`getSessionInfo`), `send.ts:59,183` and
`session-manager.ts:2342` (`detectActivity`), restore (`getRestoreCommand` uses `getOpenCodeSession`
unchanged). I confirmed the claim on the base: reverting `detectActivity` to the 1.x regexes returns
`active` for the idle 2.x capture, so the base `ao send` wait (`send.ts:178-207`) would run to its 600 s
timeout; the new classifier returns `idle` for that pane, so the wait breaks at once. `session-manager`
delivery confirmation still works (it keys on the OpenCode `updated` timestamp, unchanged).

**Review item 3 — cost of a poll (measured, read-only).** Four calls for one session:
`session.permission.list 139 ms`, `session.form.list 125 ms`, `session.active 150 ms`,
`session.get 128 ms`. They run in parallel per session and **across sessions**:
`pollAll` does `Promise.allSettled(sessionsToCheck.map((s) => checkSession(s)))`
(`lifecycle-manager.ts:1316`), and `sessionManager.list()` enriches all sessions via `Promise.all`
(`session-manager.ts:1950,1990`). So 10 OpenCode sessions ≈ one ~150 ms round (≈300 ms with the sequential
`getSessionInfo`), not 10×; one `ao status` is the same shape. A slow service is bounded: with a fake
`opencode` that sleeps, one `getActivityState` returned in **5013 ms** (one bound, calls parallel) and
`getSessionInfo` in **5005 ms**, so a worst-case tick is ~2 bounds and the 30 s interval
(`lifecycle-manager.ts:1403`) with its re-entrancy guard (`:1296`) is not at risk. `session.active` is
re-fetched once per session (10 identical calls for 10 sessions) — a small redundancy the design note
(§5.5) anticipated sharing later.

**Review item 4 — errors and the fallback.** Timeout, other error, 404 and wrong shape each return `null` →.
JSONL fallback (`api-activity.ts:193-204`), covered by `api-activity.test.ts:178-214`. A **cut, exit-0**
answer is caught: `callOpenCodeApi` throws on unparsable JSON (`opencode-api.ts:205-222`), so a fake
`opencode` printing `{"data":` and exiting 0 gave `getActivityState → waiting_input` from the JSONL, not a
wrong API state (`getActivityState: 15 ms`). A JSONL `waiting_input` never overrides a non-empty API answer
(live: with a fresh JSONL `waiting_input`, the API's `active` won), and a fresh JSONL `waiting_input`
surfaces when the API is down (live: `waiting_input` after 5020 ms).

**Review item 5 — `detectActivity`.** See M-2. The idle captures from 0009 §5.1, the real 2.0.31 pane
(full and last-10-lines) and the census running/permission/question fixtures all classify correctly. The
1.x patterns are gone; a 1.x pane would now misclassify, but the version gate (I-1) refuses `< 2.0.29`, so
nothing 1.x runs under this plugin. The retained integration assertions
(`packages/integration-tests/.../agent-opencode.integration.test.ts:493-509`) still pass on the new
classifier (empty/whitespace → `idle`, generic text → `active`).

**Review item 6 — `getSessionInfo` / field types.** `mapSessionCost` (`api-activity.ts:96-118`) maps
`inputTokens = input + cache.read + cache.write`, `outputTokens = output + reasoning`,
`estimatedCostUsd = cost`, and omits `cost` unless every number is finite and non-negative. Live against the
isolated store: `{"summary":"AO-REVIEW-I4: live","agentSessionId":"ses_…","cost":{"inputTokens":0,"outputTokens":0,"estimatedCostUsd":0}}`.
I diffed the saved 2.0.29 document against the live 2.0.31 `GET /openapi.json`: all schemas this commit
consumes (`Session.Info`, `TokenUsage.Info`, `Money.USD`, `Session.Message.User`, `Session.Message.Idle`,
`SessionActive`, `SessionMessagesResponse`, `Session.Message.Info`, `Permission.Ruleset`, `Form.Info`) are
**byte-identical** (285 → 286 schemas, 142 operations both). `Session.Info.time` still requires
`created`+`updated` with `idle` optional; `outcome` enum unchanged; `Session.Message.User.time.created`
required. **No consumed field changed from 2.0.29 to 2.0.31.**

**Review item 7 — the `void` line.** m-3 above.

**Review item 10 — scope and commit.** `git diff --name-only 15757aae..09c77de0` lists exactly the four
allowed files. `git branch -r --contains 09c77de0` prints nothing. The message is conventional, WHY-first,
no `Co-Authored-By`, no emoji, no issue number. `checkActivityLogState` is no longer imported by the plugin
but stays a core export (still tested in `core/__tests__/activity-log.test.ts`) — fine.

---

## Gates (all under `env -i HOME=/tmp/<fake>`, no `AO_*`)

- `pnpm install` — Done.
- `pnpm build` — Done (core → 12 plugins → cli).
- plugin `test`: **2 files, 187 passed**. plugin `typecheck`: `tsc --noEmit`, pass.
- core `test`: **37 files, 948 passed**.
- `pnpm lint`: **0 errors, 5 warnings** (all pre-existing, none in the four files).
- `pnpm typecheck`: all packages Done. `pnpm test` (full): **2282 passed, 29 skipped, 0 failed**
  (core 948, gemini 62, codex 215, notifier 26, claude-code 208, herdr 36, scm 140+5skip, tracker 42,
  runtime-tmux 30, workspace-worktree 50, opencode 187, integration 95+24skip, cli 243).

Independent mutants (scratch copy of `09c77de0` via `git archive`): caught — `blocked` without the
newer-`user` check (1 fail), 5000 ms bound removed (1 fail), `outputTokens` without `reasoning` (1 fail),
JSONL fallback removed (4 fail), `detectActivity` reverted to 1.x (3 fail). **Not caught** — reordered
permission/form vs `session.active` (M-1), sequential four calls (m-1), failed-read→blocked (m-2).

## Live, isolated store (no model turn)

Isolated service `{"version":"2.0.31","pid":892461}` on port 49477 (NOT the global PID 3252262); all four
XDG under `/tmp`. One session created, no prompt. Built plugin under `env -i`:

```
PHASE A (live session, no JSONL)
 getActivityState: 163 ms -> {"state":"active","timestamp":"2026-10-16T17:42:11.245Z"}   (time.updated)
 getSessionInfo  : 117 ms -> {summary:"AO-REVIEW-I4: live", agentSessionId:"ses_eba3…", cost:{0,0,0}}
PHASE A' (fresh JSONL waiting_input present)  -> still "active": JSONL does not override the API
PHASE B (session removed, 404)  getActivityState -> waiting_input (JSONL fallback, 161 ms); getSessionInfo -> null
PHASE C (fake opencode sleeping)  getActivityState: 5013 ms -> null ; getSessionInfo: 5005 ms -> null
PHASE D (fake + fresh JSONL)      getActivityState: 5020 ms -> waiting_input
truncated-JSON fake (exit 0)      getActivityState: 15 ms -> waiting_input (cut answer caught)
```

## Cleanup

- Isolated service PID **892461** stopped with `opencode service stop` (all XDG under `/tmp`). Global
  service **3252262** untouched. Port 49477 has no listener.
- `ps -o pid,args -u "$(id -u)"` filtered by my unique token `i4rev-v4flash-675835` → **(none)**; no stray
  `sleep 30`; exact-PID check of 892461 → header only. The five lifecycle workers (3215891, 3215991,
  3216043, 3216103, 3216178) were never touched.
- `~/.ao/bin` unchanged: same four files, mtimes `12:16:13.966933494/.967933468/.968933443`, `.ao-version`
  5 bytes (identical before and after).
- `find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/i4rev-v4flash-675835-marker` → **empty** (printed
  before the marker was removed). All `/tmp` state removed (219 MiB scratch copy included).
