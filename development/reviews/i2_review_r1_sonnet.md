# Review R1: I-2 one OpenCode API helper, ID-based lookup, remove and interrupt (`c949f902..1c2a93b6`) (reviewer: Sonnet 5.5)

**Verdict: NOT-LAND-SAFE**

2 blockers, 2 major, 6 minor. The helper is sound: `execFile` with an args array, a 10 s bound on every call,
stderr captured, a 404 becomes `null`, and a cut answer never parses (0 silent partial results in 40 runs). Remove,
interrupt and restore-with-a-stored-ID behave as designed on the real 2.0.29 binary. The blockers are in the way
the stored OpenCode session ID gets into the metadata. After I-2, no new OpenCode worker gets a stored ID (B-1),
and the one writer that is left binds the session of another fleet when a title collides (B-2). Both are
reproduced live. Both come from the same place: row 23 stays as it was, but I-2 removed every other path that
repaired the mapping and moved the title search from a project-scoped CLI list to a host-wide API list.

Reviewed at `1c2a93b6` (`git log --oneline -1` matches). Host: Linux, Node v25.7.0, `opencode v2.0.29` at
`/home/taisung/.opencode/bin/opencode`. I read the author's report only after items 1 to 6 of the brief.

Method in short: build and test in this worktree; a scratch copy of the reviewed tree and a scratch copy of
`c949f902` under `/tmp` (built, used for the A/B runs and the mutants); an isolated OpenCode service (pid 30076,
not the global pid 4171365; all four XDG variables under `/tmp/ao16-sonnet-iso`, port 49871) for every write; the
global service for read-only calls only (`server.info`, `session.list`, `session.get`, `model.list`). Live `ao`
runs used the built `ao` of this worktree, a scratch config and repository, `AO_STATE_ROOT` under `/tmp`, a
fake `HOME`, and a fake `opencode` front that sends `--version`, `api` and `session` to the real binary on the
isolated store and never starts the TUI (so no model turn).

## Process note (my own errors, no effect on the review result)

- At 11:41 I listed and then killed four `ao-inttest-*` tmux sessions on the DEFAULT tmux server without `-L`
  (I believed they came from my own aborted integration run, because their creation time matched). At 11:41:47 a
  probe with `TMUX_TMPDIR` set, but with `TMUX` still set, ran `kill-server` on the default server and stopped
  every tmux session on the host. The orchestrator restored this session. From then on every tmux command of mine
  ran with `env -u TMUX`, and the integration tests ran only from a script that unsets `TMUX` and sets a short
  `TMUX_TMPDIR`. All integration results below are from the second set of runs.
- The first integration run (before the outage) is not used.

## Findings

### B-1: after I-2 no new OpenCode worker has a stored session ID, so purge, restore and the send check do nothing for it

- Files: `packages/core/src/session-manager.ts:1186-1207` (spawn, row 23), `:1608-1627` (orchestrator, row 23),
  `:836-842` (the title mapping that `list` and `get` used to run is gone), `:1788-1800` (kill purge),
  `:2425-2436` (restore), `:1979-1982` (send).
- Cause: since `b90ac08f` the pane script creates the OpenCode session (`opencode api session.create` runs in
  the pane after `runtime.create` returns). The spawn-time title search of row 23 runs right after
  `postLaunchSetup`, so it runs BEFORE the create. At `c949f902` this lost race did no harm, because
  `ensureOpenCodeSessionMapping` (on every `list` and `get`), kill purge, restore and send each ran their own
  title search and stored the ID later. I-2 removed all four. Row 23 is now the only writer of
  `opencodeSessionId`, and it cannot win.
- Evidence (scratch config, fake `opencode` that logs every call, isolated store):

      I-2 build (1c2a93b6), 4 spawns:
      11:34:12.305 session.list --param search=AO:sc-1 --param limit=50    (ao, post-launch)
      11:34:12.362 session.create -d {"title":"AO:sc-1",...}                (pane, 57 ms later)
      sc-2: list 11:34:30.766 / create 11:34:30.804 (38 ms)  sc-3: 57 ms  sc-4: 57 ms
      sessions/sc-1..sc-4: 0 of 4 hold opencodeSessionId; after `ao session ls` and 30 s of lifecycle worker: still 0.

      Baseline c949f902, same flow (bs-2):
      list 11:36:49.524 / create 11:36:49.576 -> not mapped right after spawn (same race)
      `ao session ls` -> bs-2 now holds opencodeSessionId=ses_ebfca82f4ffeBxGvL0Qjh3k6Dk

- Effect for every OpenCode worker spawned on an I-2 build:
  - `ao session kill --purge-session` and `ao session cleanup` find no stored ID and delete nothing, so the
    OpenCode session stays in the global store (it has 350 sessions today). The command still prints
    `Session sc-4 killed.` (checked: purge of an unmapped worker made no `opencode api` call, and its session
    `AO:sc-4` is still in the store)
  - `ao session restore` fails with `no stored OpenCode session ID for sc-1; run ao session remap sc-1 ...` until
    the operator runs `remap` by hand for each session.
  - Activity uses the JSONL fallback only, and the send confirmation loses its `time.updated` check.
- Why it blocks: the global `ao` of this host runs this fork after a rebuild, and every worker of every fleet
  that uses OpenCode takes this path. The increment was meant to make cleanup and restore safer, and it leaves
  both without an ID. I-3 (create in Node, store the ID before the pane starts) removes the cause, but I-2 is not
  safe to land alone.
- Fix, any one of: (a) land I-3 together with I-2; (b) make the row-23 discovery wait for the pane (poll the
  exact title for a few seconds) and accept a session only when `location.directory` equals the worker's
  worktree path (see B-2); (c) keep a mapping repair on `list`/`get`/`kill`, with the same directory filter.
  A test must spawn through a runtime double that creates the session after `runtime.create` returns.

### B-2: the title search is host-wide, so spawn binds another fleet's session and `kill --purge-session` deletes it

- Files: `packages/core/src/opencode-api.ts:233-256` (`listOpenCodeSessionsByTitle`, no `directory` or `project`
  filter), used by `session-manager.ts:151-163` for row 22 (remap) and row 23 (spawn and orchestrator start).
- Cause: `opencode api session.list` spans every project (0009 section 3). The CLI list that the old code used
  saw only the project of the current directory. A title is `AO:<id>`, and an `<id>` is unique only inside one
  fleet. Two fleets with the same `sessionPrefix` give the same title. The helper returns all exact matches
  newest first, and spawn takes the first.
- Evidence (isolated store; a session `AO:sc-5` in `/tmp/ao16-sonnet-iso/other-fleet` stands for another
  fleet's session; then `ao spawn` as `sc-5`):

      I-2 build:  sc-5 metadata: opencodeSessionId=ses_ebfca2452ffe5ps7eZmOGACGSv   (the other fleet's session)
                  its own session ses_ebfca2090ffeiKKT7gREctObMK was created 46 ms later and stays unmapped
      ao session kill sc-5 --purge-session:
                  11:37:21.955 session.interrupt --param sessionID=ses_ebfca2452ffe5ps7eZmOGACGSv
                  11:37:22.122 session.remove    --param sessionID=ses_ebfca2452ffe5ps7eZmOGACGSv
                  session.get on that ID -> 404; the other fleet's session is gone, the worker's own one leaked
      Baseline c949f902, same test (bs-3 with a decoy AO:bs-3 in the other directory):
                  bs-3 mapped to its OWN session ses_ebfc9e04e..., decoy untouched

- Today the global store holds 45 `AO:` titles and 0 duplicates (read-only check of 350 sessions), so no loss has
  happened yet. The risk is real on this host: the fork, agent-skills, Nexus and VSF fleets run from separate
  configs with their own prefixes and counters, and one new fleet with an `ao` or `as` prefix is enough.
- Brief item 3 names this hazard. The stored ID of the purge comes from metadata, as required, but row 23 writes
  that metadata from a title search. The brief says row 23 stays unchanged, but its backend changed with the
  helper, and that widened the scope.
- Fix: filter on `location.directory === <worker worktree path>` (the pane creates the session with
  `location.directory = process.cwd()`, `index.ts` `buildApiSessionBodyScript`), or pass `--param directory=`.
  For `ao session remap` do the same, or print the directory of each candidate and refuse an ambiguous match.

### M-1: A4 is half done: a refused binary with no stored ID still reports only the missing mapping

- File: `packages/core/src/session-manager.ts:2425-2436`; comment at `:2427-2431`; plugin
  `packages/plugins/agent-opencode/src/index.ts:643`.
- Core throws `SessionNotRestorableError` for a missing stored ID before it calls `getRestoreCommand`. The
  plugin probe that the author added (`assertSupportedOpenCodeVersion()` even with no ID) is therefore never
  reached on the `ao session restore` path. The comment says the opposite ("a refused binary still reports the
  version problem ... once the restore command is built below").
- Reproducer (fake `--version` printing `1.18.35`, session `sc-1` with no stored ID):

      $ ao session restore sc-1
      Cannot restore: no stored OpenCode session ID for sc-1; run `ao session remap sc-1` to re-discover it by exact title

  With a stored ID the version error does appear (`ao needs OpenCode 2.0.29 or later (found 1.18.35)`), so only
  the combination that the I-1 open minor named is wrong. The operator on a 1.x host is sent to `remap`, which
  then fails with an unrelated `opencode api` error.
- Tests: the plugin test "probes even when it finds no session" calls the plugin directly and passes. The core
  restore test uses a good binary. No test combines the two.
- Fix: in core, call the agent's restore/launch gate before the "no stored ID" error, or let `getRestoreCommand`
  throw the remap error itself after its probe.

### M-2: the new tests do not pin several behaviours that the brief requires (7 of 18 mutants survive)

I made a scratch copy of the reviewed tree and ran 18 single-line mutants against the new tests. 11 are killed.
These 7 survive:

| Mutant | Survives in | What it shows |
|---|---|---|
| A: `stdio: "inherit"` added to the `execFile` options | `opencode-api.test.ts` (9 pass) | "keeps the child stderr off the terminal" (`:113`) only checks `timeout` and `maxBuffer`; D1 "stderr not passed through" is not tested |
| E: top-level `{"interrupted":true}` read as `false` | helper test | the real 2.0.29 shape (`{"interrupted":false}` at top level, measured) is never parsed by a test; the mock answers `{"data":{...}}` |
| G: `limit` param dropped from the list call | helper and communication tests | nothing pins the page size |
| I: `session.remove` BEFORE `session.interrupt` | `lifecycle.test.ts` (23 pass) | row 20 is "interrupt, then remove"; the test uses `toContain` on both names, not their order |
| K: kill purge falls back to a title search when no ID is stored | lifecycle and session-manager tests | nothing checks that purge with no stored ID calls no `session.list` |
| L: reuse returns the candidate when `session.get` times out or throws | all spawn tests (82 pass) | brief item 4 "a timeout skips the candidate" has no test |
| M: orchestrator reuse replaces a gone stored ID with a title match | spawn tests | the D5 test covers the issue path only |

More gaps:
- No automated test of the hanging binary (D4 "returns within the bound"). `installMockOpencodeApi` has an
  `apiDelaySeconds` option and no test uses it (`grep` finds no caller). The 20 s figure exists only in the report.
- The timeout test mocks `code: "ETIMEDOUT"`. A real `execFile` timeout sets `killed: true` and
  `signal: "SIGTERM"` and no such code. The production branch that works (`signal === "SIGTERM"`, I measured it)
  is not the one under test.
- `spawn.test.ts:1545-1546`: the orchestrator `delete` test wraps its assertions in `if (existsSync(log))`. With
  no deletion at all it asserts nothing.
- "has a bounded timeout" asserts `toBe(10_000)`, a copy of the source literal (mutant C is killed, but only by
  the literal).
- Fidelity of the mock (`opencode-helpers.ts`): 404 shape (stdout `SessionNotFoundError`, stderr `HTTP 404 Not
  Found`, exit 1) and the empty exit-0 body of `session.remove` match the real binary (checked on the isolated
  store). The `interrupt` shape does not (see E). The mock never produces a cut exit-0 answer.
- Non-vacuity as asked: with the new core and plugin tests run against the `c949f902` sources, `opencode-api.test.ts`
  fails to load (module missing) and 20 tests fail in 5 more files (`communication` remap x5, `lifecycle` x4,
  `restore` x1, `spawn` x5, `session-manager.test.ts` retry loop x5); 9 plugin tests fail (`getActivityState` x4,
  `getRestoreCommand` x3, `getSessionInfo` x1, version gate x1). The author named 2. Most of these are the old
  tests rewritten to the new mock, so they prove the change, not the safety properties above.

## Minor

### m-1: restore of a session whose stored OpenCode session is gone (404) reports success and opens the TUI on the dead ID

- File: `index.ts:646-649` (comment) and `session-manager.ts:2543-2548`. `getRestoreCommand` returns `null` on a
  404, and the comment says "the caller falls back to a fresh launch". The caller calls `getLaunchCommand` with
  `agentConfig.opencodeSessionId` still set to the gone ID, which returns the resume form.
- Reproducer: `session.remove` of the stored ID, kill the pane, `ao session restore sc-2` prints
  `Branch: session/sc-2`, `Attach: ...` (success), the pane runs `opencode --session 'ses_ebfcca0dd...'`, and the
  metadata keeps the gone ID. The old runtime was already destroyed. The new `session.get` check changes nothing
  for the operator.
- Fix: throw `SessionNotRestorableError` ("the stored OpenCode session is gone") from `getRestoreCommand`, before
  core destroys the old runtime. Fix the comment.

### m-2: the title search reads one page of 50 and ignores the cursor

- File: `opencode-api.ts:238`. `search` is a substring, the order is newest first, so an old exact title falls
  off the page when 50 newer sessions contain it (`AO:ao-1` also matches `ao-10` to `ao-19` and `ao-100` to
  `ao-199`).
- Reproduced in the isolated store: titles `AO:z-1`, `AO:z-10..69`, `AO:z-100..160` (72 substring matches): the
  page holds 50, `AO:z-1` is not in it, `listOpenCodeSessionsByTitle("AO:z-1")` returns `[]`, and `remap` would
  say "mapping is missing". The global store has too few matches to show it today.
- Fix: follow `cursor.next` until the exact title appears or the list ends, or raise the limit.

### m-3: dead parameters, a dead argument and stale docs after removing title discovery

- `session-manager.ts:836-842` and `:1979-1982` keep unused parameters alive with `void effectiveAgentName;
  void sessionName; void sessionsDir;`. Remove the parameters.
- `:1508` still passes `includeTitleDiscoveryForSessionId: true`; the function ignores it. The behaviour change
  is real: `orchestratorSessionStrategy: delete` used to delete an unmapped old orchestrator session found by
  title, and now deletes stored IDs only. That fits owner Q7, but it is not recorded. Answer to brief item 4: no
  caller still expects title discovery through the flag, except this one call, which is now a no-op.
- `docs/opencode-workflows-spec.md:40,48,54,94` still describe title discovery on delete, send and remap.

### m-4: a purge can interrupt and remove an OpenCode session that another AO session uses (pre-existing, interrupt is new)

- `findOpenCodeSessionIds` (`session-manager.ts:547-579`) collects stored IDs of live AND archived sessions of the
  same issue, and reuse puts the ID into the new session's metadata. Two AO sessions then share one OpenCode ID.
  `kill --purge-session` or `cleanup` of the old one removes the session the new one runs in. The old CLI delete
  did the same. I-2 adds `session.interrupt` to the kill path, which also stops a running turn of the other
  session. Code reading only; not run live (it needs an issue tracker). A guard "no other live AO session
  holds this ID" would close it.

### m-5: a failed purge is silent and can take 41 s

- With `opencode api` hanging, `ao session kill sc-3 --purge-session` took 41.06 s (interrupt 10 s, remove 3 x
  10 s, 0.8 s of delays), printed `Session sc-3 killed.`, exit 0, and left the OpenCode session. The archive has
  no `opencodeCleanedAt`, and a later `ao session cleanup` removed the session (verified: it ran
  `session.remove` and wrote `opencodeCleanedAt`). The retry path works. The operator only gets no hint that the
  purge failed. The silent `catch { void 0 }` was already there.

### m-6: scope and process

- `packages/core/src/__tests__/session-manager.test.ts` changed (72 lines). Brief section 3 allows
  `__tests__/session-manager/*`, not this file (0009 section 13 names it). The brief says to stop and report
  `blocked` for a file outside the list.
- The helper header (`opencode-api.ts:27-28`) says the measurement is "see the helper test and the report D2".
  The helper test has no measurement.
- The author's "integration with `opencode` present" run (104 passed, 15 skipped) differs from mine (95 passed,
  24 skipped). The extra tests fit the live `describe` block of `agent-opencode.integration.test.ts`, which runs
  `opencode run 'Say hello'` when `~/.local/share/opencode/auth.json` exists. On this host that is a model turn
  on the global service. I cannot confirm it from the report. I ran the package with a fake `HOME` so that block
  skips. A future brief should say so.

## Answers to the review items

**1. A1, the helper.** `execFile("opencode", args)` with an args array; no shell. `timeout: 10_000` on every call
(`OPENCODE_API_TIMEOUT_MS`), `maxBuffer` 64 MiB. Stderr is piped: a fake child that wrote `NOISE-ON-STDERR` and a
valid answer left 0 bytes on the parent's stderr (the unit test cannot show this, see M-2 mutant A). 404 becomes
`null` for `get`, `remove` and `interrupt`; the shapes match the real binary (exit 1, stdout
`{"_tag":"SessionNotFoundError",...}`, stderr `HTTP 404 Not Found`). Every other error is thrown with `cause`. No
read of `service.json`, the password or `auth.json` anywhere in the diff.

Callers and the timeout policy (checked against the header; they match):

| Function | Callers | On timeout |
|---|---|---|
| `getOpenCodeSession` | plugin `findOpenCodeSession` (activity, info); plugin `getRestoreCommand`; core reuse; core send timestamp | find: caught, JSONL fallback; info: `null`; restore: throws after 10 s (measured 10.02 s); reuse: candidate skipped (untested, M-2 L); send: `undefined`, pane checks |
| `listOpenCodeSessionsByTitle` | `remap`; spawn and orchestrator post-launch (row 23) | `remap` fails with the error; row 23 swallows |
| `removeOpenCodeSession` | `deleteOpenCodeSession`: kill purge, cleanup, `delete` strategy | 3 tries; kill swallows; cleanup records an error; `delete` strategy aborts the spawn |
| `interruptOpenCodeSession` | kill purge only | swallowed, then remove |

**2. Truncation.**
(a) No. Every answer of an I-2 operation is one JSON object (or empty for `remove`), and a prefix of an object is
never valid JSON. In 40 helper runs under a busy event loop, 0 cut answers parsed. Empty output is accepted only for
`session.remove`, whose real answer is empty (measured: exit 0, 0 bytes).
(b) Real sizes (read-only, global): `session.get` 477 bytes, a 50-record `session.list` 20603 bytes (about 410 bytes per
record), 350 records 160311 bytes. No I-2 caller can reach 262144 bytes; the biggest, the title search, is capped by
`limit 50` (20603 bytes). Through the helper, with the event loop blocked 0, 400 and 1000 ms after the spawn: `session.list`
limit 50: 24 of 24 ok; limit 200: 24 of 24 ok; limit 1000 (160 KB): 8 of 8 ok when free and 16 of 16 throw
`incomplete JSON with exit 0` when blocked; `model.list` (458 KB), blocked 400 ms: 4 of 5 throw. What the operator
sees when every call throws, for example in `remap`: `Failed to remap session sc-1: Error: opencode api
session.list returned incomplete JSON with exit 0 (got 45 chars)`. The message does not say that a retry may help.
(c) "Check the JSON, no file" is acceptable for I-2, because all its answers are far below the size where the
pipe loses data in my runs. I-4 will read `session.message.list` and `experimental.session.stats`, which are large;
that increment must write stdout to a file (or a descriptor), because a check that throws on every call would
leave it with no data at all. I-2 should keep `limit` fixed or follow the cursor (m-2), not raise it to 1000.

**3. Remove and interrupt reach only this session's own ID.** The paths to `removeOpenCodeSession` are
`deleteOpenCodeSession` (called by reuse `delete`, `cleanup` of archived sessions, kill purge) and the interrupt is
called only from `interruptThenRemoveOpenCodeSession` (kill purge). Every ID is `asValidOpenCodeSessionId(raw[
"opencodeSessionId"])` from metadata, never a fresh title search. But the stored value itself can come from a
title search (B-2), and one stored ID can be shared by several AO sessions (m-4). With `{"interrupted":false}` at
the top level, the helper returns `{interrupted:false}`; the caller ignores the value and removes. Measured: the
purge ran interrupt at 11:37:21.955 and remove at 11:37:22.122. When remove still fails after its retries, kill
archives the session without `opencodeCleanedAt`, and `ao session cleanup` retries (m-5). Not measured:
interrupt with a running turn (needs a model turn).

**4. Reuse and restore.** Reuse: the first stored ID for which `session.get` answers is returned; a 404 is skipped
and never replaced by a title match (D5 test passes; mutant M shows the orchestrator path is not tested); a timeout
skips the candidate in the code (untested). Restore: a stored ID gives one `session.get`, then
`opencode --session '<id>'` (checked live); no stored ID gives the A4 remap message (M-1 for the refused-binary
case); a refused binary with a stored ID names the version (checked). Row 22 (`remap`) matches the exact title
only, newest first (checked, with the cross-project limit of B-2 and the page limit of m-2). Row 10 is
`session.get` by ID (send timestamp). `includeTitleDiscoveryForSessionId`: see m-3.

**5. Bounded time (fake `opencode`, `--version` fast, `api` hangs, structured as `exec sleep` and as a plain
`sleep` child; both give the same result because `execFile` destroys the pipes on a timeout).**

| Operation | Measured |
|---|---|
| plugin `getRestoreCommand` | 10.02 s, throws `opencode api session.get failed within 10000 ms` |
| plugin `getSessionInfo` | 10.01 s, returns `null` |
| `ao session restore` (agent exited, pane alive) | 20.47 s: one enrich `getSessionInfo` (10 s) + the restore check (10 s); the old runtime is kept |
| `ao session ls` | 20.3 s (I did not trace why the 12 s cap in `list()` does not end it sooner) |
| `ao session kill --purge-session` | 41.06 s (m-5) |

The author's "about 21 s" is right (I measured two bounded calls, not three). I did not re-measure the 40 s of
`c949f902`; its code has `timeout: 30_000` in `findOpenCodeSession`. Lifecycle poll: a real lifecycle worker on
the I-2 build made 3 `session.get` calls per mapped OpenCode session per 30 s tick (11:35:12.03, .14, .38 and the
same triple at 11:35:42 and 11:36:12): `list()` enrich calls `getActivityState` and `getSessionInfo`, and the
lifecycle calls `getActivityState` itself. One call costs about 0.12 s wall, 0.2 s CPU and 92 MB peak RSS (5 runs
against the global service: 0.10 to 0.13 s). That is about 0.6 s CPU per session per tick. By the code at `c949f902` (not
measured) the same path made 3 CLI list calls per session plus one shared list per `list()` (3N+1), so the
poll cost is equal or slightly lower (3N). Acceptable for this increment. Watch it when I-4 adds more calls per session. With a hanging
service one session costs up to 30 s per tick (10 s x 3).

**6. No change outside I-2.** The plugin diff has 11 hunks: imports, the removed `parseUpdatedTimestamp` and
`parseSessionList`, `findOpenCodeSession`, a comment in `getActivityState`, `getRestoreCommand`. None is inside
`getLaunchCommand`, `buildResumeCommand` or the `buildApi*` builders; those are byte-identical (the one hunk
header that names `buildResumeCommand` is the section comment after it). Rows 1 to 4, 7 and 8 are unchanged.
Row 23 is the exception: the code lines changed (a `try`/`catch` was added) and, more important, its backend
changed from a project-scoped CLI list to the host-wide API list, which is the cause of B-1 and B-2.

**7. Tests.** D1: 9 helper tests pass, with the gaps of M-2. D2: re-measured, see item 2. D3: I ran kill purge
(interrupt then remove, 404 on a second remove), remap (exact title) and cleanup (retry of a failed purge) live.
D4: see items 4 and 5. D5: unit test only for the issue path. D6: item 6. D7: M-2. D8 (my runs, fake `HOME`, own
tmux server):

      pnpm --filter @aoagents/ao-core test              Test Files 32 passed (32)   Tests 653 passed (653)
      pnpm --filter @aoagents/ao-plugin-agent-opencode test      Tests 159 passed (159)
      pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck exit 0
      integration, opencode hidden from PATH            Test Files 10 passed | 3 skipped (13)   Tests 95 passed | 24 skipped (119)
      integration, opencode on PATH                     Test Files 10 passed | 3 skipped (13)   Tests 95 passed | 24 skipped (119)
      pnpm lint                                         0 errors, 5 warnings (all five exist at c949f902)
      pnpm test (full)                                  exit 0: core 653, gemini 56, claude-code 154, notifier 26, codex 215,
                                                        herdr 36, scm-github 140 (+5 skipped), tracker 42, worktree 46,
                                                        tmux 26, opencode 159, integration 95 (+24 skipped), cli 243
                                                        = 1891 passed, 29 skipped
      pnpm typecheck                                    exit 0
      pnpm build                                        exit 0

D9: item 9.

**8. The author's open points.** The 21 s restore: bounded and acceptable; severity none (an enrich call on a
session that restore replaces anyway could be skipped, a minor optimisation). The `interrupted` shape: confirmed,
2.0.29 answers `{"interrupted":false}` at the top level; the helper handles both shapes; the mock and the tests
use the wrong one (M-2 mutant E); severity minor. The unused parameter: m-3; severity minor.

**9. Scope and commits.** Files: all in the allowed list except `session-manager.test.ts` (m-6). Messages:
`feat(core): ...`, `feat(core): ...`, `feat(agent-opencode): ...`, each with a WHY body, no `Co-Authored-By`, no
emoji, no issue number (checked with a grep on the three bodies). `git branch -r --contains 1c2a93b6` prints
nothing.

## What I found correct

- The helper contract: args array, no shell, bound on every call, stderr off the terminal, 404 to `null`,
  other errors with `cause`, no password read.
- A cut answer never reaches a caller as data: 40 busy-loop runs, 0 silent partial results; throws at 160 KB and
  458 KB.
- Real 2.0.29 shapes are handled: empty 204 body of `session.remove`, the 404 shape on `get`, `remove` and
  `interrupt`, and the top-level `interrupted` object.
- Kill purge order and retries (interrupt, then remove at 0, 200 and 600 ms), the archive when the purge fails,
  and the later `cleanup` retry that recovered the leaked session.
- Restore with a stored ID: one `session.get`, then `opencode --session '<id>'`; a refused binary with a stored
  ID names the version; a hanging binary fails in 10 s per call and keeps the old pane.
- The plugin has no title fallback; activity falls back to the JSONL decay when `session.get` fails.
- Launch, resume and restore command strings are untouched; the suite is green; the commits follow the rules.

## Cleanup (done at the end of the review)

Stopped by exact PID: the isolated service 30076, the scratch lifecycle workers 75249 and 88944, the scratch tmux
servers 75282 and 88977, with their fake panes. Removed `/tmp/ao16-sonnet-iso`, `/tmp/ao16-sonnet-live`,
`/tmp/ao16-sonnet-base`, `/tmp/ao16-sonnet-mut`, `/tmp/ao16-sonnet-it` and the scratchpad files. No tracked file
was changed and nothing was committed.
