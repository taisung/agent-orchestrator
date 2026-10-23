# Herdr fit-2 design r9 (ao-65), 2026-10-22

Author: ao-65 (Claude Opus 5.5), 2026-10-22, from about 22:50 EDT. No product code changed. This design
replaces [fit-2 design r8](herdr_fit2_design_r8_opus.md) and answers its two blind reviews:
[sol](herdr_fit2_design_review_r8_sol61.md) (ao-74, Codex gpt-6.1-sol: NOT-SOUND, 0 blocking, 3 major,
5 minor) and [Muse](herdr_fit2_design_review_r8_muse13.md) (ao-75, OpenCode Muse Spark 1.3:
SOUND-WITH-CHANGES, 0 major, 6 minor).

fit-2 = F-3 (a blocked agent is a refusal), F-4 (a failed create closes nothing and keeps everything), F-7
(startup admits at most one Herdr orchestrator launch per project, with `Runtime.preflight()`), F-9 (the
owner's retire action) and the rest of F-8 (contracts and documents). It builds on **fit-1**, which now
exists as code on the branch `feat/fit1-impl-read-agent-task-md-in-your-worktree-once-it-exists`
(`389b8dfe..e322e338`, plus `9d51982b`, which restores the base formatting of five agent-plugin files and
changes no behavior). fit-1 is not on `main`. Section 2 states fit-1 from that code.

**Baselines and line numbers.** `main` `cd09479b` (its `packages/` tree equals `389b8dfe`) and the fit-1 tip
`9d51982b`. A line number in a file that fit-1 changed (core `session-manager.ts`, `herdr.ts`, `types.ts`,
`index.ts`; runtime-herdr `index.ts`; CLI `start.ts`, `session.ts`) is that of `9d51982b`. Every other file
that this design names is equal on both baselines.

This file is self-contained: an implementer needs this file, the fit-1 tip, the fixtures that it names (all
under `development/artifacts/herdr_095_live_check/`) and the code. One small measurement was made for r9
(section 3.1, fixtures `r9_*`).

## 0. The findings of both r8 reviews and their answers

The rows merge the duplicates that the brief names (Muse m-1 = sol m-2, Muse m-3 = sol m-5, Muse m-6 with
sol m-1, Muse m-4 with sol's section "Admission limits, R3 ownership and relaunch integration"). IDs are
those of each review.

| Finding | What the review requires (short) | Answer in r9 | Section |
| --- | --- | --- | --- |
| **sol M-1** The name of lock A changes across the first `mkdir` under a symlinked parent, so two processes can both pass G | An invariant canonical subject, fixed for the operation and used by every admission path; refuse an unexpected lookup failure; a two-process first-start test with a symlinked parent and a pause after the directory creation: exactly one workspace and runtime launch | **Answered.** The subject is the real path of the nearest existing ancestor plus the missing suffix. Only a component that does not exist (`realpath` and `lstat` both `ENOENT`) makes the walk go up; every other lookup state refuses (`admission-path`). Each admission path (start, restore, the CLI's reuse decision) computes the subject once, before A. Under A a start creates the directory and checks that its real path equals the subject, and it checks again directly before the reservation. The r9 Node check: the r8 rule gives two lock names before and after the `mkdir`, the r9 rule one. T-7.21c is the two-process test | 3.1, 4.9, 5.3.1, 5.3.10 |
| **sol M-2** The CLI reuse shortcut bypasses the live-launch rule and the post-probe revalidation | One shared admission and reuse decision for the CLI shortcut (project and isolated candidates): a fresh strict read, the same launch identity, no live launcher, no `launchFailed` or incomplete marker, a fresh runtime-match decision after every awaited probe and before reuse; keep the isolated CLI reuse control; real-core CLI tests: paused after the handle is published, and the record replaced or failed during the CLI probe | **Answered.** Core exports `SessionManager.findReusableOrchestrators(projectId)`. It runs the same admission rounds and the same reuse predicate R as core G (4.7, 5.3.2), in a "reuse only" mode that accepts any workspace mode. The CLI no longer probes a candidate whose handle names a runtime in the set; it asks core. A launch keeps its claim until its success settlement (after `postLaunchSetup` and `confirmLaunch`), so a paused launch is `in-progress` and never reused. T-7.27, T-7.28; control T-7.7 | 4.5, 4.7, 5.3.2, 5.3.5, 5.3.10 |
| **sol M-3** A successful restore of a prepared agent has no claim release | Claim ownership and settlement for spawn, start and restore, with and without `prepareAgentSession`; restore releases its own claim (conditional) on success and every settled failure, also a nonfatal setup exception and a write conflict; warn and keep the resources when the settlement cannot be recorded; settle a kept post-create failure; never clear a later operation's claim; a resident-process test with an OpenCode-shaped stand-in | **Answered.** One owner-aware settlement write (4.5) compares the launch identity **and** this operation's own claim values, so it never clears another operation's claim. The table of 4.5 gives, per operation and agent kind, where the claim is taken and how each end path settles it. Restore settles after step 11 (also after a caught `postLaunchSetup` exception) and on each failure after its transition write. `keepUnconfirmedLaunch` settles a kept failed launch, for every runtime. A settlement that cannot be written warns and removes nothing. T-4.16 to T-4.18 | 4.5, 5.2.3, 5.2.4 |
| **sol m-1** + **Muse m-6** Restore holds A across the workspace creation; no timeout bounds the hold of A | One restore protocol with its rollback and tests; the probe timeouts that bound A | **Answered.** No Herdr call runs under A: a reuse probe runs with A released, and the next round uses its answer only while the record keeps the probed identity (5.3.2). The calls that still run under A (the probe and the stop of an old tmux record) have a core bound of 10 s each. Restore holds A for G, the copy-back, the old runtime's stop decision and the **transition write** (the pending handle and the claim); it releases A before the workspace restore. A failed workspace restore and a plain create error write the transition back. T-7.26b, T-7.26c, T-7.29 | 5.2.4, 5.3.1, 5.3.2 |
| **sol m-2** + **Muse m-1** The token's `ao status` display, its data path and home file, the file count | Status plumbing, rendering, JSON policy and tests in a commit; name the token's home file; correct the count | **Answered.** `launchIdentityToken()` lives in core `metadata.ts`, next to `launchIdentity`, and `index.ts` exports it. `status.ts` computes it from the record and prints it; `--json` gets `identityToken` and `createIncomplete` (additive). `launchFailed` never holds the token. Commit 7. **17 product files** | 4.8, 5.5, 7 |
| **sol m-3** "Every old-record probe" omits cleanup; kill's fallback is not today's | Dispatch cleanup's old-handle probe; state the behavior for a missing plugin per site | **Answered.** The table of 4.6 gives each site its behavior for a registered handle runtime, a missing runtime of the set and a missing runtime outside the set. Cleanup is in it; kill keeps today's skip for a missing runtime outside the set. T-7.8e | 4.6 |
| **sol m-4** T-9.8 cannot inject a replacement after the retire write | Split the test by checkpoint; include a failed retire write | **Answered.** T-9.8a (replacement during step 7: the retire write fails), T-9.8b (after the retire write, in the workspace removal callback), T-9.8c (after the retire write, in the purge holder lookup) | 5.4.5 |
| **sol m-5** + **Muse m-3** `recordMayOwnRuntime` does match an empty ID | Correct the fact and the rationale; keep the conservative result | **Answered.** 3.3 states the code. fit-2 keeps the conservative result: a record whose stored handle has `createIncomplete` "may own" any runtime, as a handleless reservation did before. For a runtime in the set, a rollback whose record is not its own removes nothing at all (5.2.3). T-4.7b | 3.3, 4.4, 5.2.3 |
| **Muse m-2** Q1's "pinned `herdrSocket`" does not exist yet at step 2 | Name the value that step 2 compares | **Answered.** Q1 compares with `endpoint.socket` of step 1. Steps 2 and 5 both run with `HERDR_SOCKET_PATH=endpoint.socket`, and the handle stores that value as `herdrSocket` | 4.3 |
| **Muse m-4** + sol section "Admission limits, R3 ownership and relaunch integration" | Name the overlap with `feat/session-relaunch` and the rule for the second landing; keep L-1 to L-5 with their conditions; do not count the claims as R3 or relaunch M-6 | **Answered.** Section 6 names each shared key, function and path, which side adapts, and the rule for the second landing. fit-2 does not complete same-ID R3 or relaunch M-6. The limits carry sol's conditions, with an upgrade step for L-2 and L-5 | 5.3.9, 6 |
| **Muse m-5** Evidence cited as files that are sections of one log | Cite the sections | **Answered.** Each citation names the log file and the section | 3.1, 4.3 |
| **Muse D-F1** fit-1 was not verifiable | | fit-1 is code now. Section 2 states it from `9d51982b` and names 12 differences from what r8 assumed. Gate G0 stays | 2, 8 |
| sol, fixture note: the newer-protocol `pane run` form was inferred | Label it or measure it | **Measured** in r9: exit 1, `cli:request` `protocol_mismatch` "client protocol 22 is older than server protocol 23; ...", ping only (`r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23`) | 3.1 |
| sol, OQ-F5 wording | Do not say that the post-run check prevents a later send to a changed terminal | Applied: OQ-F5 names the separate liveness check and send, errors read as unknown, and RH B-2 | 11 |
| sol, smaller notes: the guard shape; the Q2 trust boundary; `readLaunchClaim` can answer null; each race test fails when its own fix is undone | | Applied | 4.1, 4.3, 4.5, 8 |

## 1. Results

1. **Admission (sol M-1, sol m-1, Muse m-6).** Every orchestrator start and orchestrator restore takes a lock
   A whose name derives from a canonical subject that does not change across the first `mkdir`. Under A run
   only local work and bounded calls for records outside the set; no Herdr call runs under A. A Herdr launch
   is visible to G from its first byte on disk, also during a restore's workspace step.
2. **CLI reuse (sol M-2).** The CLI reuses a Herdr orchestrator only through core's
   `findReusableOrchestrators`, which applies the same predicate R as G: no live launcher, no failure
   marker, the same runtime, a non-terminal status, an `alive` answer for the same launch identity in the
   deciding round.
3. **Claims (sol M-3).** Every claim that fit-2 writes has an owner and a settlement on each end path. The
   settlement compares the launch identity and the own claim values. A restore in a resident process
   leaves no claim.
4. **Failed create (r8 M-2, kept).** A failed Herdr create runs the ordinary rollback only for the three
   measured pre-request conditions Q0, Q1, Q2. Every other failure keeps the worktree, the agent session,
   the record and the launch script.
5. **Dispatch (r8 M-3, sol m-3).** Every probe and stop of an old record goes through the runtime that its
   handle names; each site states its behavior for a missing plugin.
6. **Owner retire (F-9).** `ao session kill <id> --confirm-runtime-closed <identity-token>`, with the token
   in message M, the kill refusal and `ao status`.
7. **Size.** 17 product files (15 with a behavior, type or API change; 2 comment-only), about 1,750 product
   lines and 3,400 test lines, 8 commits on top of fit-1. That is **L**. OQ-F12 asks whether to split it
   into two rounds.

## 2. The base: fit-1 as built

### 2.1 What fit-2 uses (read from `9d51982b`)

| Name | Where | Behavior that fit-2 relies on |
| --- | --- | --- |
| `readHerdrCliFailure(err, expectedId)`, type `HerdrCliFailure` | core `herdr.ts:91` | `{ code, message }` only for the exact 0.9.5 form: exit 1, no signal, not killed, stdout exactly empty, one stderr line (at most one trailing `\n`, no `\r`), a JSON object with exactly `id` and `error`, `id` = `expectedId`, `error` with exactly a non-empty text `code` and a text `message`. Else `null` |
| `isHerdrNoServer(failure)` | `herdr.ts:122` | `server_not_running` and the prefix `no herdr server is running at ` |
| `HERDR_CLI_IDS` | `herdr.ts:52` | keyed by the call's first two words: `pane get` `cli:pane:get`, `pane process-info` `cli:pane:process_info`, `pane read` `cli:pane:read`, `pane run`, `pane send-text`, `pane send-keys` `cli:request`, `agent prompt` `cli:agent:prompt`, `workspace create` `cli:workspace:create` |
| `HERDR_PANE_ID_RE`, `isHerdrPaneId` | `herdr.ts:129`, `:137` | the pane ID grammar |
| `resolveHerdrEndpoint({ binPath, env })`, type `HerdrEndpoint` | `herdr.ts:253-284` | `{ bin, socket, running }`: an absolute executable (a bare name is searched in the absolute `PATH` entries), then `<bin> status server --json` with `env` and a 10 s limit. Rejects a missing binary, a failed call, text that is not JSON, no boolean `running`, a socket that is not an absolute path without control characters. **It reads no `compatible`** |
| `herdrInvocationFor(handle, legacyBin)`, `herdrExecOptions`, type `HerdrInvocation` | `herdr.ts:295-326` | both pins: `{ bin: herdrBin, env: { ...process.env, HERDR_SOCKET_PATH: herdrSocket } }`; neither: `{ bin: legacyBin, env: undefined }`; anything else throws `HerdrPinError` with zero calls |
| `HerdrPinError`, `HERDR_PIN_ERROR_CODE` | `herdr.ts:158-171` | `readonly code = "ERR_HERDR_PIN"`, message "the herdr pins of this record are malformed: ...". **No guard function** |
| `getHerdrPaneProcesses`, `isHerdrProcessRunning` | `herdr.ts:377`, `:520` | take `string \| RuntimeHandle`; an empty ID answers `[]` with no call; another ID outside the grammar rejects with no call; malformed pins reject with no call |
| runtime-herdr `cliIdOf(args)`, `herdrCallError(args, err)` (internal) | `index.ts:178-200` | an F1 failure becomes `Error("herdr error <code>: <message>", { cause: <the execFile rejection> })` with `herdrCode`, plus `code` `ERR_RUNTIME_NO_SERVER` for the CLI's no-server answer; every other failure is thrown as it is |
| runtime-herdr `create` | `index.ts:428-512` | call 0 `resolveHerdrEndpoint` (`running` false: plain error "no herdr server runs at <socket>; start one: herdr server"); call 1 `workspace create` with `pinned` (`HERDR_SOCKET_PATH=endpoint.socket`); no `workspace_id`, or a root pane outside the grammar: plain error "herdr workspace create returned no usable pane ..."; `writeLaunchScript`; call 2 `pane run`; on any failure there, call 3 `workspace close` (`:478`) and a plain error "Failed to launch agent in herdr pane ..."; the handle stores `herdrBin` and `herdrSocket` |
| runtime-herdr `destroy`, `stop` | `index.ts:516`, `:532` | `destroy` refuses with zero calls; `stop` answers `unknown` with zero calls |
| runtime-herdr `isAlive` | `index.ts:626-646` | an ID outside the grammar (also `""`) rejects with no call; one `pane get` with the pins and `commandTimeoutMs` (10 s); `false` only for `pane_not_found` or another terminal; no server rejects with `ERR_RUNTIME_NO_SERVER`; malformed pins reject |
| runtime-herdr `sendMessage` | `index.ts:561-603` | an ID outside the grammar rejects with no call; `SETTLED_STATES` (`:71`) still holds `blocked` |
| core `isOrchestratorRuntimeAlive` (interim) | `session-manager.ts:571-603` | `herdrRecord = (handle.runtimeName \|\| runtime.name) === "herdr"`; for such a record `false` and no-server throw "Cannot tell whether session <id> is alive, so it is neither reused nor replaced. ..."; its callers pass the **project's** runtime (`:2527`, `:2588`) |
| CLI interim | `start.ts:888-980`, `:1044-1050` | `hasStoredHandle`, `recordRuntimeName`, `isHerdrProbeTerminal` (a Herdr record that `sm.list` shows terminal is still probed when its persisted status is missing, not terminal or `killed`), `checkOrchestratorLiveness` (Herdr `false` and no-server: unknown) |
| CLI `session attach` | `session.ts` | the grammar check and the pins |
| docs | `docs/DEVELOPMENT.md`, `types.ts`, `CLAUDE.md` | R4 rows 8 and 9; the interim startup paragraph with the by-hand recovery; the `RUNTIME_NO_SERVER_ERROR_CODE` and `isAlive` texts |
| test helpers | `herdr-fixtures.ts` in core `src/__tests__/`, runtime-herdr `src/__tests__/` and CLI `__tests__/` | `herdrFixture`, `herdrRejection`, `statusRunning()` (no `compatible` key), `STATUS_SOCKET`, `standInHerdrOnPath` |
| interim tests | core `src/__tests__/session-manager/orchestrator-herdr-start.test.ts`; runtime-herdr `fit-startup-interim.test.ts`; CLI `start.test.ts` ("start command — old Herdr orchestrators (fit-1 interim)") and `start-herdr-interim.test.ts` | the refusal "Cannot tell whether ..." |

### 2.2 Differences from what r8 assumed (fit-2 follows the code)

1. runtime-herdr `herdr()` takes no `expectedId`: the command ID comes from `cliIdOf(args)`. Rule Q (4.3)
   reads the F1 failure from the wrapper's `cause` with that ID.
2. fit-1 has no `isHerdrPinError`. Commit 1 adds it (it checks `code === "ERR_HERDR_PIN"` and a string
   `message`).
3. `resolveHerdrEndpoint` reads no `compatible`. Commit 3 adds it (Q0).
4. The `running` refusal of `create` reads "no herdr server runs at <socket>; start one: herdr server". Q0
   keeps it and adds a text for `compatible` (5.2.1).
5. The CLI interim guard has a third part, `isHerdrProbeTerminal`. Commit 6 removes it with the other two.
6. The interim tests are the four files of 2.1. Commits 5 and 6 change their oracles (5.3.10).
7. fit-1 did not change `lifecycle-manager.ts` (`:214-222`, the authoritative-runtime comment). It is a
   fit-2 file now, no longer conditional.
8. The fit-1 test "reads the failure form of every call with its own command ID (workspace create)"
   (`fit-reads.test.ts:189`) uses the session-form no-server text (`noserver_never_workspace_create`). That
   text is not Q1 (4.3), so fit-2 changes the oracle (5.2.7). AO's pinned calls never get that form: with
   `HERDR_SOCKET_PATH` and `HERDR_SESSION` both set, the CLI ends the text with "run \`herdr\` to start or
   attach it" (`r5_path_env_socket_and_env_session.cmd`).
9. The fit-1 test "reads the pane run failure with the command ID cli:request" (`fit-reads.test.ts:208`)
   expects the `workspace close` and a plain error. fit-2 changes it (5.2.7).
10. A root pane outside the grammar gives fit-1's plain "no usable pane" error. fit-2 makes it a partial
    `workspace-unconfirmed` with the same text.
11. fit-1's core interim function probes through the project's runtime (it reads `handle.runtimeName` only
    to decide "Herdr"), so a Herdr record in a project that now selects tmux is probed through tmux. Commit 4
    fixes it (4.6).
12. fit-1 open question 2: a Herdr record with a persisted `killed` status whose pane answers alive is passed
    over by the CLI, which then starts a second orchestrator. fit-2's G blocks it (`not-reused`, a terminal
    status).

### 2.3 The owner's decisions that stay

- **OQ-F3 (b):** two rounds; this is the second.
- **OQ-F1 (b):** before RH-A, no Herdr answer retires an old orchestrator at startup. The classifier never
  answers "ended" for a Herdr record.
- **OQ-F2 (a):** F-9, with the safeguards of review r7.
- RH-A and RH-B stay design-only; a Herdr `stop` answers `unknown` (OD-19 (a)).

### 2.4 What fit-2 replaces in fit-1

- The core interim `isOrchestratorRuntimeAlive`: by G, the classifier and R (commit 5).
- The CLI's Herdr branches of `checkOrchestratorLiveness` and `isHerdrProbeTerminal`: by the core reuse
  decision (commit 6).
- The create cleanup close of runtime-herdr (`index.ts:474-483`) (commit 3).
- The interim paragraph of `docs/DEVELOPMENT.md`: by the fit-2 texts (commit 8).

## 3. Facts

### 3.1 Measurements (r8 and r9)

r8: a fake server at `HERDR_SOCKET_PATH` logged each connection; the real herdr 0.9.5 CLI made the calls;
`strace` recorded 13 `connect()` calls, all `AF_UNIX` (`r8_strace_connects.txt`). r9 (new): the same setup
for one more case, `pane run` against a server whose ping answers protocol 23, with the protocol-19 case as
the control of the run (2 `connect()` calls, both `AF_UNIX`, `r9_strace_connects.txt`); and a Node check of
the admission subject rule (pure `node:fs`, `node:path`, `node:crypto`; no product module, no socket, no
child). No real herdr server, no tmux, no `ao` ran in either round.

| Case | CLI answer | Connections at the fake server | Evidence |
| --- | --- | --- | --- |
| `workspace create`, ping answers protocol 19 | exit 1, F1 `cli:workspace:create` `protocol_mismatch` "client protocol 22 is newer than server protocol 19; restart the Herdr server ..." | 1 (ping only): no `workspace.create` | `r8_cli_forms_log.txt`, section `r8_ws_create_ping_protocol_19` |
| `workspace create`, ping answers protocol 23 | exit 1, `protocol_mismatch` "client protocol 22 is older than server protocol 23; upgrade the Herdr client before using this command" | 1 (ping only) | section `r8_ws_create_ping_protocol_23` |
| `pane run`, ping answers protocol 19 | exit 1, `cli:request` `protocol_mismatch`, the "newer" text | 1 (ping only): no `pane.send_input` | section `r8_pane_run_ping_protocol_19`; repeated in `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_19_control` |
| **`pane run`, ping answers protocol 23 (r9)** | exit 1, `cli:request` `protocol_mismatch` "client protocol 22 is older than server protocol 23; upgrade the Herdr client before using this command" | 1 (ping only): no `pane.send_input` | `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23` |
| `status server --json`, ping answers protocol 19 and 23 | exit 0, `"running":true`, `"compatible":false`, `"endpoint_compatible":true` | 1 (ping only) | `r8_status_json_ping_protocol_19.json`, `r8_status_json_ping_protocol_23.json` |
| `workspace create`, a stale socket file | exit 1, F1 `server_not_running` "no herdr server is running at <socket>; run \`herdr\` to start or attach it" | 0 (one `AF_UNIX` connect, refused) | `r8_cli_forms_log.txt`, section `r8_ws_create_stale_socket_file`; `r8_strace_connects.txt` |
| `pane run`, a stale socket file | the same with `cli:request` | 0 | section `r8_pane_run_stale_socket_file` |
| `workspace create`, the server answers the request with `zz_unknown_code` | exit 1, F1 with that code | 2: the request was sent | section `r8_ws_create_error_after_request` |
| `workspace create`, the server answers the request with `server_not_running` and the CLI's prefix | exit 1, "no herdr server is running at /tmp/aohd5/fake/elsewhere.sock" (no suffix) | 2: the request was sent | section `r8_ws_create_server_sends_cli_no_server_text` |
| `pane run`, the server answers the request with `pane_not_found` | exit 1, F1 `cli:request` `pane_not_found` | 2: `pane.send_input` was sent | section `r8_pane_run_pane_not_found_after_request` |
| **Admission subject (r9)**: a symlinked parent (`alias` → `real`) and three missing components | r8 rule (`realpath`, else `resolve`): `.../alias/...` before the `mkdir`, `.../real/...` after: two lock names. r9 rule (4.9): `.../real/...` before and after: one name. A file as a component (`ENOTDIR`) and a dangling symlink: the r9 rule refuses; the r8 rule falls back to the lexical path | — | `r9_admission_subject_check.txt`; the script `r9_admission_subject_script.txt` |

Other facts of the same kind: a real 0.9.5 server answers `"compatible":true` (`closedpane_status_server_json.json`);
with no server the field is `null` (`noserver_never_status_server_json.json`). The protocol-19 text has more
sentences after "; " (a `\n` inside the JSON string); the stderr line is still one line. With
`HERDR_SOCKET_PATH` and `HERDR_SESSION` both set, the CLI uses the socket path, and its no-server text ends
"run \`herdr\` to start or attach it" (`r5_path_env_socket_and_env_session.cmd`); the session form "run \`herdr
session attach <name>\` to start or attach it" appears without `HERDR_SOCKET_PATH`
(`noserver_never_workspace_create`). Limits: the fake server answers the ping and logs requests; it models no
workspace. A server that imitates the CLI's exact texts (R-Q, 4.3) is not measured.

### 3.2 Code facts that fit-2 uses (fit-1 tip)

- **Launch claim.** `launchPid` and `launchPidStart` (`session-manager.ts:286-293`); `processStartToken` (field
  22 of `/proc/<pid>/stat`, else `ps -o lstart=`); `currentLaunchClaim` (`:327`); `readLaunchClaim` (`:339`;
  it warns and answers `null` when the start time cannot be read); `liveLaunchOwner` (`:355`);
  `assertNoLiveLauncher` (`:370`); `CLEARED_LAUNCH_CLAIM` (`:290`). A launch takes a claim only when its agent
  has `prepareAgentSession` (`:2074`, `:2477`); only agent-opencode has it. The clears (`:2360-2364`,
  `:2913-2918`) come after `confirmLaunch` and compare the launch identity only. Restore takes no claim.
- **Records.** `reserveSessionRecord` (`metadata.ts:900-924`) creates the directory first (`:907`), then
  under the record lock publishes the complete record with `link`. `recordLockName` (`:234-241`) uses the
  real path, else the lexical path. `updateMetadataIf(dir, id, expected, updates)` compares any keys
  (`:656-676`). `LAUNCH_IDENTITY_KEYS` (`:331-337`): `reservationId`, `runtimeHandle`, `tmuxName`,
  `createdAt`, `restoredAt`.
- **Lock.** `holdDeliveryLock(name, waitMs)`; `isDeliveryLockSupported()` is true only on Linux;
  `deliveryLockName(kind: "ledger" | "attempt" | "record", subject)` (`delivery-lock.ts:33-48`, `:100-110`).
  A second bind of a held name fails, also in the same process.
- **Start today.** `validateAndStoreOrigin` (`:2469`), the claim (`:2477`). Project mode:
  `setupWorkspaceHooks` (`:2507`), the existing record (`:2510`), its probe (`:2527`) and stop (`:2484-2496`)
  through the project's runtime, the reservation (`:2581`), the concurrent branch (`:2582-2615`). Isolated:
  `reserveNextOrchestratorIdentity` (`:2621`, reservation `:1385`), workspace create, hooks (`:2653`). Then the
  prompt file, the agent preparation, `runtime.create` (`:2847`), the handle write (`:2894`),
  `postLaunchSetup`, `confirmLaunch`, the clear (`:2913`).
- **Restore today** (`:4286-4646`). `assertNoLiveLauncher` (`:4323`); steps 2 to 6 write nothing; the archive
  copy-back (`:4459`); step 7 stops the old handle through the **project's** runtime (`:4491-4514`); step 8
  `workspace.restore` and `postCreate` (`:4516-4549`; the worktree plugin prunes, may fetch and runs `git
  worktree add`); step 9 `create` (`:4552-4569`) with no catch; step 10 the conditional write (`:4571-4613`);
  step 11 a nonfatal `postLaunchSetup` (`:4616-4642`).
- **Rollback.** `rollbackLaunch` (`:1874-1960`): with a runtime and a handle, a replaced record that may own
  the runtime keeps the runtime with a warning (`:1886-1906`), and the rollback then still discards a prepared
  agent session that no other record names (`:1907-1922`). `keepUnconfirmedLaunch` (`:1971-2011`) writes
  `launchFailed` (capped at 600 characters) and keeps the claim.
- **OpenCode holder.** `openCodeHolderReason` (`:1072-1140`): a record with launch keys and no handle is a
  dead holder (`:1087`); a handle with an empty ID is "unknown" (`:1097`), so the OpenCode session stays held.
- **Presentation.** `ao start` wraps a core error as "Failed to setup orchestrator: ..." (`start.ts:1127`);
  the top-level handler prints `Error:` and the message and exits 1 (`:1267-1273`).
- **Send.** The core restore retry (`session-manager.ts:4025-4046`); the CLI's non-tmux delegation
  (`send.ts:356`).
- **Status.** `SessionInfo.launchFailed` (`status.ts:46`), `printLaunchFailed` (`:229-232`); `--json` prints
  `SessionInfo[]` (`:321-390`).
- **Timeouts.** runtime-tmux 5 s per command (`runtime-tmux/src/index.ts:22`; it has no `stop`, so
  `stopRuntime` makes `destroy` and `isAlive`); runtime-herdr `commandTimeoutMs` 10 s (`:60`); core
  `herdr.ts` 10 s (`:21`). The registry gives built-in runtimes no config, so these defaults apply.

### 3.3 Corrected code statements (sol m-5, Muse m-3)

- `recordNamesRuntime` (`session-manager.ts:1671-1680`) compares `id` and `runtimeName` for equality with no
  non-empty check: two Herdr handles with `id: ""` match. `recordMayOwnRuntime` (`:1692-1699`) answers `true`
  for a record without `runtimeHandle`. r8's sentence "`recordMayOwnRuntime` never matches an empty ID" was
  wrong.
- With P (4.4), a reservation record has a stored handle. Without a change, `recordMayOwnRuntime(P-record,
  h)` for a real handle `h` would answer `false`, where a handleless reservation answered `true`. fit-2 keeps
  the earlier conservative answer (4.4).
- The r7 m-3 statements stay as r8 corrected them: a nonzero `execFile` rejection has a numeric `code`; for a
  Herdr handle with an empty ID, claude-code's process check rejects and codex, gemini and opencode answer
  `false`. fit-1 changed only the argument of these calls (the handle, its report section 1.2). A false agent
  answer alone has no lifecycle authority (`lifecycle-manager.ts:662`, the runtime-positive gate).

## 4. Shared definitions (new in fit-2)

### 4.1 Error types (`core/src/runtime-errors.ts`, new; exported from `index.ts`)

Each guard checks the `code` and the whole shape, never `instanceof` alone, so it accepts an error from
another copy of core.

| Class | `code` | Fields | Guard checks |
| --- | --- | --- | --- |
| `RuntimeCreatePartialError` | `ERR_RUNTIME_CREATE_PARTIAL` | `handle` (what may exist), `stage` ∈ {`workspace-unconfirmed`, `launch-not-submitted`, `launch-unconfirmed`}, `closed: "nothing"`, `cause` | `code`; `handle` a non-null, non-array object with a string `id`, a non-empty string `runtimeName` and a non-null, non-array object `data`; `stage` in the set; `closed === "nothing"` |
| `RuntimeSendRefusedError` | `ERR_RUNTIME_SEND_REFUSED` | `reason: "agent_blocked"`, `admitted` ∈ {`none`, `earlier-attempt-unconfirmed`}, `target` (pane ID), `stage` | `code`; `reason`; `admitted` in the set; `target` and `stage` strings |
| `OrchestratorStartBlockedError` | `ERR_ORCHESTRATOR_START_BLOCKED` | `projectId`, `reason` ∈ {`records`, `records-unreadable`, `records-changed`, `admission-busy`, `admission-unsupported`, `admission-path`}, `blocking: BlockingLaunch[]` | `code`; `projectId` a string; `reason` in the set; `blocking` an array |
| `HerdrPinError` (fit-1, `herdr.ts`) | `ERR_HERDR_PIN` | the message | `isHerdrPinError` (commit 1): `code` and a string `message` |

`BlockingLaunch`: `sessionId`, `kind` (4.7), `reason` (text), `status`, `launchFailed` (boolean), `handle`
(the stored text, first 80 characters, when it does not parse), `pane`, `terminal`, `workspace`, `worktree`,
`socket`, `bin`, `answer` (text, filled after A), `launcherPid` (for `in-progress`), `identityToken` (4.8).

### 4.2 The unproven set and the contracts (`core/src/types.ts`)

- `LAUNCH_END_UNPROVEN_RUNTIMES: ReadonlySet<string> = new Set(["herdr"])` and `isLaunchEndUnproven(name)`.
  Doc: "Runtimes whose answers do not prove that a launch ended: a server can run where the recorded endpoint
  does not reach it, and pane IDs come back after a restart. Startup never retires a record of such a runtime
  on a runtime answer."
- `Runtime.create` doc (replaces "Create a new session environment and return a handle"):

  > Create a session environment and return its handle. On failure, a runtime throws a plain error only when
  > nothing of the session can exist in it: no request reached the runtime, or the runtime removed what it
  > made. Core then runs the ordinary rollback: it discards a prepared agent session, removes the workspace
  > and releases the reservation. When something may exist (a request was sent, an answer is unknown, a
  > cleanup is not confirmed), the runtime throws `RuntimeCreatePartialError` with the handle of what may
  > exist and `closed: "nothing"`; it closes nothing, and core keeps the record, the workspace and the agent
  > session (a "kept failed launch"). runtime-herdr follows this with the measured conditions of its rule Q.
  > runtime-tmux keeps its earlier behavior (it kills the tmux session that it made, best effort, before it
  > throws); these Herdr measurements do not qualify it.

- `Runtime.preflight?(): Promise<void>` (optional): "Check that `create()` can start a session now, with the
  binary and endpoint that `create()` will use. Throws a message for the operator. A readiness sample, not a
  reservation of the endpoint, and never evidence about an existing session."
- `SessionManager.findReusableOrchestrators(projectId): Promise<Session[]>` (commit 5; 5.3.2).
- `SessionManager.kill` options: `{ purgeOpenCode?: boolean; confirmRuntimeClosed?: string }` (commit 7).
- `SessionManagerDeps.admission?: { waitMs?: number; probeTimeoutMs?: number; onStage?: (stage:
  AdmissionStage) => Promise<void> }`, for tests: `waitMs` (default 30 000), `probeTimeoutMs` (default
  10 000), and a hook at the stages `subject-fixed`, `lock-held`, `sessions-dir-ready`, `before-reservation`,
  `transition-written`. Production code passes nothing.

### 4.3 Rule Q: the qualified no-request conditions of a Herdr create

Core `herdr.ts` exports `herdrPreRequestRefusal(failure: HerdrCliFailure | null, socket: string): "no-server" |
"protocol" | null`. The plugin computes `failure` from the rejection of its call: for fit-1's wrapper (an
error with `herdrCode`) `readHerdrCliFailure(err.cause, cliIdOf(args))`, else `readHerdrCliFailure(err,
cliIdOf(args))`. So fit-1's reader has already checked the exit code, the empty stdout, the one stderr line
and the expected command ID.

| Condition | Exact form | Why no request was sent | Evidence |
| --- | --- | --- | --- |
| **Q0** endpoint check | `resolveHerdrEndpoint` fails, or answers `running !== true`, or `compatible !== true` | it is a ping; `create` sends nothing after it | `r8_status_json_ping_protocol_19.json`, `r8_status_json_ping_protocol_23.json` (`compatible` false); `noserver_never_status_server_json` (`null`); `r5_b0_requests_log` |
| **Q1** CLI no-server | `code === "server_not_running"` and `message === "no herdr server is running at " + socket + "; run \`herdr\` to start or attach it"`. `socket` is `endpoint.socket` of step 1: steps 2 and 5 both run with `HERDR_SOCKET_PATH=endpoint.socket`, and the handle stores that value as `herdrSocket` | the CLI found no listener | `r8_cli_forms_log.txt`, sections `r8_ws_create_stale_socket_file` and `r8_pane_run_stale_socket_file` (0 connections); `r5_path_env_socket_and_env_session.cmd` (this text under AO's pins) |
| **Q2** CLI protocol refusal | `code === "protocol_mismatch"` and `message` matches `/^client protocol \d+ is (newer\|older) than server protocol \d+; /` | the CLI refused after the ping | `r8_cli_forms_log.txt`, sections `r8_ws_create_ping_protocol_19`, `r8_ws_create_ping_protocol_23`, `r8_pane_run_ping_protocol_19`; `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23` |

Anything else is not qualified: another F1 code; `server_not_running` with another socket, with no suffix,
or with the session-form suffix (`r8_cli_forms_log.txt` section `r8_ws_create_server_sends_cli_no_server_text`;
`r5_b_pane_get_server_not_running_from_server`; `noserver_never_workspace_create`); the 0.8.0 exit-0 error
envelope; Rust text; a timeout; a signal; an exit code other than 1.

**Trust boundary, residual R-Q.** Q1 is an exact full message. Q2 is a prefix (the rest of the message
varies with the socket and the version). A server that answers a request in the exact F1 form with the Q1
text (its socket in it) or with a message that begins with the Q2 prefix would look like a pre-request
refusal: AO would run the ordinary rollback while the server may have made a workspace or admitted the
input. herdr 0.9.5 makes these texts in the CLI; no measured server sends them. The rule does not defend
against a server that imitates the CLI. OQ-F7.

### 4.4 The pending handle P

For a launch whose create runtime is in `LAUNCH_END_UNPROVEN_RUNTIMES`:

- `P = { id: "", runtimeName: <runtime>, data: { createIncomplete: "create-pending" } }`.
- **Written** by spawn and start in the reservation's `initial` (atomic `link`): worker
  `reserveNextSessionIdentity` (`:1283`, reservation `:1317`); orchestrator project mode `reserveSessionRecord`
  (`:2581`, `:2608`, `:2611`) and isolated `reserveNextOrchestratorIdentity` (`:2621`, reservation `:1385`),
  with `role: "orchestrator"` and the claim (4.5). Written by restore in its transition write (5.2.4), after
  the old runtime's stop decision.
- **Replaced** by the success handle write; by the partial handle (5.2.3); on a plain error, spawn and start
  delete the reservation (the ordinary rollback), and restore writes the transition back (5.2.4).

**The consumers of P** (corrected, sol m-5):

| Consumer | Answer for a record with P | Source |
| --- | --- | --- |
| runtime-herdr `isAlive` | rejects with no call (`""` is outside the grammar) | `index.ts:626-633` |
| runtime-herdr `stop` | `unknown`, no call | `index.ts:532` |
| core row 8 `getHerdrPaneProcesses` | `[]`, no call | `herdr.ts:377` |
| agent `isProcessRunning` | claude-code rejects; codex, gemini, opencode answer `false`; not authoritative | 3.3 |
| `recordNamesRuntime(P-record, P)` | `true` (two empty IDs) | `:1671` |
| `recordMayOwnRuntime(record, h)` | **fit-2:** `true` for a record whose stored handle has `data.createIncomplete` (any stage), as for a handleless record. So a reservation keeps the conservative answer that it had before fit-2 | `:1692` |
| `openCodeHolderReason` | "unknown": the OpenCode session stays held. Before fit-2, a crashed handleless launch was a dead holder (`:1087`); now the owner releases it with F-9 | `:1097` |
| G, the reuse decision | live claim: `in-progress`; dead claim: `create-incomplete` | 5.3 |
| kill | live claim: launch in progress; dead claim: the Herdr stop answers `unknown`, so the kill refuses | `:3076`, `:3094-3125` |
| F-9 | accepts a dead claim; no call for the empty ID | 5.4 |
| `ao status` | `launch incomplete (create-pending; identity token <t>)` | 5.5 |
| list enrichment, the lifecycle | the probe rejects; the stored status stays | |
| send | `sendMessage` rejects with no call | `index.ts:563` |
| relaunch (if it has landed) | refuses a Herdr handle | section 6 |

No consumer depends on an ownership exclusion for P. The conservative answers and the Herdr stop's `unknown`
keep every resource. tmux and the test runtimes write no P: their records keep their shape.

### 4.5 Launch claims: ownership and settlement (sol M-3)

**Owner.** A claim is the pair `{ launchPid, launchPidStart }` of the `ao` process that wrote it
(`currentLaunchClaim`). The operation that writes a claim keeps the pair (`ownClaim`) and is its only owner.

**Who takes a claim.** Spawn and start: `claimNeeded = !!agent.prepareAgentSession ||
isLaunchEndUnproven(createRuntime.name)`, in the reservation (`initial`). Restore:
`isLaunchEndUnproven(createRuntime.name)`, in the transition write (5.2.4). A tmux restore takes none, as
today. When `readLaunchClaim()` answers `null` (no readable start time; it warns), the launch has no claim: P
still makes G block (`create-incomplete`), but no process is its `in-progress` owner. The claim is a launch
marker, not an infallible process-ownership protocol.

**Claim writes compare.** The reservation creates a new record (`link`). The restore transition compares the
launch identity and the claim values as read. `assertNoLiveLauncher` runs before both. No fit-2 write puts a
claim over a live one.

**The settlement write.** `settleOwnClaim(own, ownClaim)`; no write when `ownClaim` is `null`:

```ts
updateMetadataIf(sessionsDir, sessionId,
  { ...launchIdentity(owned), launchPid: ownClaim.launchPid, launchPidStart: ownClaim.launchPidStart },
  CLEARED_LAUNCH_CLAIM);
```

- Written: done.
- `null`: the record is gone, names another launch, or holds other claim values (a later operation's claim,
  or none). Nothing to settle. It never clears another operation's claim; today's clears compare the launch
  identity only.
- Throws (an I/O error, the record lock not obtained): the row's failure handling below.

The other values of an end path (the agent's `session.metadata`, `launchFailed`, a partial handle) go in the
write directly before the settlement, with today's compare on the launch identity (`own.write`, or
`updateMetadataIf` on `launchIdentity(owned)` in restore; not own: today's `recordChangedError`). So other
claim values with the same launch identity stop neither the launch's own data nor its result, and the
settlement leaves them as they are (T-4.18). When that earlier write changes the launch identity (a partial
handle), the settlement compares the new identity.

**Settlement per operation.**

| Operation and agent | Claim taken | Success settles | Failure paths |
| --- | --- | --- | --- |
| spawn, prepared agent (OpenCode), any runtime | in the reservation | after `confirmLaunch`: today's write (`:2360-2364`) keeps `session.metadata` and loses `...CLEARED_LAUNCH_CLAIM`; then `settleOwnClaim(own, claim)` | before or in `create` with a plain error: the ordinary rollback deletes the record, with the claim. A partial (set runtime): 5.2.3, the `keepUnconfirmedLaunch` write clears it. A post-create failure (`postLaunchSetup`, `confirmLaunch`, a write): the rollback; when it keeps the launch (a set runtime, or an unconfirmed stop of any runtime), the `keepUnconfirmedLaunch` write clears it; a confirmed stop deletes the record. Not own: nothing to settle |
| spawn, unprepared agent, set runtime | in the reservation | after today's last write of the success `try` (`:2365-2366`, after `postLaunchSetup`): `settleOwnClaim(own, claim)` | as above |
| spawn, unprepared agent, other runtime | none | — | — |
| start (orchestrator), both workspace modes | as spawn | as spawn (`:2913-2920`) | as spawn; the prompt file stays when the launch is kept (today) |
| restore, set create runtime, any agent (also a prepared one: restore calls neither `prepareAgentSession` nor `confirmLaunch`) | in the transition write | after step 11, also after a caught `postLaunchSetup` exception | step 8 failure and step 9 plain error: the transition write-back clears it; step 9 partial: the settlement after the partial write; step 10 conflict: not own, nothing to settle |
| restore, other create runtime | none (today) | — | — |

**When the settlement write throws.** Spawn and start: the success write is part of the `try`, as today's
clear is, so the error goes to the existing catch (for a set runtime: a kept failed launch, whose
`keepUnconfirmedLaunch` tries the settlement again). In `keepUnconfirmedLaunch` and in restore: warn once, "ao:
the launch claim of <id> stays (<error>); while ao process <pid> runs, AO treats the launch as in progress",
remove nothing more, and go on (restore returns its result). No resource is removed because of a settlement.

A crashed launch leaves a claim of a dead process: `liveLaunchOwner` answers `null`, and G, kill and F-9 judge
the record by its handle (P: `create-incomplete`).

### 4.6 Dispatch by the handle's runtime, per site (sol m-3)

`runtimeForHandle(handle, fallback)`: a registered `handle.runtimeName` gives that plugin; a `runtimeName` in
the set that is not registered gives `null`; any other case gives the site's `fallback` (today's runtime of
the site).

| Site | Today (fit-1 tip) | fit-2, handle runtime registered | Not registered, runtime in the set | Not registered, other runtime | Test |
| --- | --- | --- | --- | --- | --- |
| Start: probe of the project-mode record (`:2527`) and of the concurrent branch (`:2588`) | project's runtime | the handle's | unknown: blocked | project's runtime (today) | T-7.8, T-7.8b |
| Start: `stopOrchestratorOrRefuse` (`:2484-2496`) | project's runtime | the handle's | unconfirmed: refuse | project's runtime (today) | T-7.8 |
| Restore step 7 (`:4491-4514`) | project's runtime | the handle's | unknown: refuse | project's runtime (today) | T-7.8c |
| Kill (`:3094-3125`) | `handle.runtimeName ?? project's runtime`; a missing plugin skips the stop and the kill goes on | the same | **refuse**: `RuntimeStopUnconfirmedError` (`unknown`, "no runtime plugin <name> is loaded"); nothing removed | **today's skip, kept**: the stop is skipped, the kill goes on | T-7.8d |
| List enrichment (`:1532-1536`) | the handle's, else the project's runtime | the handle's | no probe; the stored status stays | project's runtime (today) | T-7.8d |
| Cleanup, the rule "runtime is dead" (`:3436-3440`) | project's runtime | the handle's | no probe; this rule kills nothing | project's runtime (today) | T-7.8e |
| G, the reuse decision, the probes for message M | — | the handle's | unknown | — | 5.3 |
| Unchanged (already by the handle): send (`:3639-3648`; a missing plugin throws), `openCodeHolderReason` (`:1098`; unknown), the lifecycle (`lifecycle-manager.ts:559-562`) | | | | | |
| Unchanged (the runtime that made the handle): the rollback stops of spawn (`:2373`) and start (`:2676`), restore step 10 (`:4604`) | | | | | |

A new launch still creates through the project's selected runtime.

### 4.7 The classifier, the reuse predicate R and the blocking kinds (core, exported)

`classifyOrchestratorLiveness(runtime | null, handle)` returns `alive`, `ended` (with a reason) or `unknown`
(with a reason). Each probe has a core bound, `probeTimeoutMs` (10 000): no answer in time is `unknown` ("the
<runtime> check did not answer within 10 s").

| Answer | Runtime outside the set | Runtime in the set (herdr) |
| --- | --- | --- |
| no plugin (`runtimeForHandle` gave `null`) | unknown | unknown |
| `isAlive` `true` | alive | alive |
| `isAlive` `false` | ended | **unknown** (OQ-F1 (b)) |
| rejects with `RUNTIME_NO_SERVER_ERROR_CODE` | ended | **unknown** |
| rejects otherwise, not a boolean, no answer in time | unknown | unknown |

**R, the reuse predicate** (one function, used by G and by `findReusableOrchestrators`). A known-Herdr
orchestrator record is reusable when, read strictly under A in the deciding round:

- **R1** it has no live launch owner (`liveLaunchOwner` is `null`);
- **R2** its `runtimeHandle` parses to an object with a string `id`, a `runtimeName` in the set and an object
  `data`;
- **R3** the handle has no `data.createIncomplete`;
- **R4** the record has no `launchFailed`;
- **R5** `handle.runtimeName` equals the project's selected runtime (OQ-F4 (a));
- **R6** its persisted `status` is not in `TERMINAL_STATUSES`;
- **R7** a probe of this launch (the same identity token, 4.8) answered `alive`.

G of a start adds **R8**: the record is the project-mode ID `<prefix>-orchestrator`, the workspace mode is
`project`, and the strategy is `reuse` or `ignore`. The reuse-only decision has no R8: it accepts any
workspace mode and any strategy, as the CLI does today.

**Blocking kinds** (`BlockingLaunch.kind`): `in-progress` (R1 fails), `damaged` (R2 fails), `create-incomplete`
(R3), `not-reused` (R4, R5, R6 or R8 fails; `reason` names which: "its launch failed", "the project now
selects <runtime>", "its status is <s>", "an isolated record", "the workspace mode is now <m>", "the strategy
<s> would stop it, and a Herdr stop cannot confirm before RH"), `unproven` (R7: the probe answered anything but
`alive`).

### 4.8 The identity token

`launchIdentityToken(record)` (core `metadata.ts`, next to `launchIdentity`; exported from `index.ts`): the
first 16 hex characters of SHA-256 over `JSON.stringify(LAUNCH_IDENTITY_KEYS.map((key) => record[key] ??
""))`. It changes with a reservation, a spawn, a restore (transition and success writes), a partial-handle
write and a relaunch claim (its `restoredAt`). A status, `launchFailed`, claim or retire-key write does not
change it. Message M, the Herdr kill refusal and `ao status` print it; F-9 needs it; the reuse decision uses it
as the key of its probe answers. It is not a secret.

**Name.** The relaunch branch writes a record key `launchToken`: a random token that it gives to the agent
(section 6). So fit-2 says "identity token" everywhere and writes no key named `launchToken`. r8's
`launchToken(raw)` is renamed.

### 4.9 The admission subject and lock A (sol M-1)

`admissionLock(sessionsDir): { subject, name }` (core `delivery-lock.ts`), with `name =
deliveryLockName("admission", subject)`; `"admission"` joins the kind union.

**The subject.**

1. `current = resolve(sessionsDir)`; `missing = []`.
2. `realpathSync(current)` succeeds: `subject = join(<real path>, ...missing)` (in path order). Done.
3. It fails with `ENOENT`, and `lstatSync(current)` also fails with `ENOENT`: put `basename(current)` at the
   front of `missing`, set `current = dirname(current)`, go to 2. At the root: refuse.
4. Any other result refuses: `realpathSync` fails with `ENOTDIR`, `EACCES`, `ELOOP`, `ENAMETOOLONG`, `EIO` or
   another code; or `realpathSync` fails with `ENOENT` while `lstatSync` finds the entry (a dangling symlink).
   The refusal is `OrchestratorStartBlockedError` with `reason: "admission-path"`: "AO cannot fix the
   admission path of project <p> (<code> at <path>); no orchestrator was started."

**Why it is invariant.** AO creates a missing sessions directory with `mkdirSync(..., { recursive: true })`,
which makes real directories. After that, the real path of the directory is the real path of the earlier
nearest existing ancestor plus the same suffix. So a caller before and a caller after the `mkdir` get the same
subject and the same name (`r9_admission_subject_check.txt`).

**Fixed for the operation.** Each admission path (5.3.1) computes the subject once, before it takes A, and
every check of the operation uses it:

- Under A, a start creates the directory when it is missing, then requires `realpathSync(sessionsDir) ===
  subject`. A difference releases A and refuses (`admission-path`); the empty directories that it made stay,
  and the message names them.
- Directly before the reservation (a start), and before the copy-back and the transition write (a restore),
  with no await in between, the same check runs again.
- A reuse-only decision and a restore make no directory. When the directory exists, they make the check; when
  it does not exist, there is no record to decide on.

**Residual R-A.** A rename or a symlink swap of a component of the state directory by another party, during
two simultaneous starts, can still put two admissions into one physical directory under two names: the last
check and the `link` are two system calls. AO itself makes no such change. OQ-F9.

## 5. The items

### 5.1 F-3: a blocked agent is a refusal (W-3)

**Files.** runtime-herdr `index.ts` (`SETTLED_STATES` `:71`, `waitForSettledAgent`, `sendMessage` `:561-603`);
core `session-manager.ts` (the send retry `:4025-4046`); CLI `send.ts` (`:356`).

**Before.** `blocked` counts as settled, so AO prompts a blocked agent; herdr answers `agent_blocked` (exit
1); core forces a restore, which refuses, and `ao send` prints a stack trace that names the restore
(`ao_send_blocked`).

**After.**

- `SETTLED_STATES` = `idle`, `done`. `waitForSettledAgent` stops at the first poll that shows `blocked`.
- `sendMessage` throws `RuntimeSendRefusedError` (`reason` `agent_blocked`) when: (1) the first settle wait sees
  `blocked` (`admitted` `none`, stage "first settle wait"); (2) an `agent prompt` answers the F1 `agent_blocked`
  (`herdrCode` from fit-1's wrapper; `admitted` `none` for attempt 1, `earlier-attempt-unconfirmed` after an
  earlier prompt of this call; stage "agent prompt, attempt n"); (3) the settle wait after a prompt sees
  `blocked` (`earlier-attempt-unconfirmed`, stage "settle wait after attempt n").
- After a refusal: no `send-text` and no `send-keys` (raw text and Enter could answer the permission prompt).
- In `promptWasConsumed` (from `idle`), `blocked` stays "consumed": a delivery, not a refusal.
- Core `send` (`:4025`): `isRuntimeSendRefusedError(err)` throws it unchanged, before the restore retry.
- CLI `send.ts:356`: catch the refusal, print one line to stderr, exit 1: `ao send: <session>: not sent: the
  agent in herdr pane <pane> is blocked and waits for input (agent_blocked). Answer it in the pane (ao session
  attach <session>), then send again.` With `earlier-attempt-unconfirmed`, add `An earlier prompt of this send
  may have been delivered; check the pane before you send again.` No stack.

W-4 (duplicate delivery from `done`) stays open for the later send round.

**Oracle change.** runtime-herdr `index.test.ts:363` "treats blocked as settled — a prompt is how you answer a
blocked agent": old: an `agent prompt` is sent; new: a refusal, `admitted` `none`, zero `agent prompt`, zero
`send-text`, zero `send-keys`.

| ID | Test | Expected |
| --- | --- | --- |
| T-3.1 | The first settle poll answers `blocked` | refusal, `none`, stage "first settle wait"; zero prompts, zero raw input |
| T-3.2 | Gate `idle`; attempt 1 answers the `blocked_herdr_agent_prompt` line | refusal, `none`; one prompt; zero raw input |
| T-3.3 | Attempt 1 succeeds, no consumption is seen, the settle wait after it answers `blocked` | refusal, `earlier-attempt-unconfirmed`, stage "settle wait after attempt 1"; one prompt; zero raw input |
| T-3.4 | Attempt 2 answers `agent_blocked` | refusal, `earlier-attempt-unconfirmed`, stage "agent prompt, attempt 2"; two prompts; zero raw input |
| T-3.5 | Control: from `idle`, the consumption poll shows `blocked` | delivered; one prompt |
| T-3.6 | Core `send` with the refusal, once with each `admitted` value | zero `restore`; the error keeps `code` and `admitted`; control: another send error keeps the one restore retry |
| T-3.7 | CLI with each `admitted` value | exit 1; exactly the one or two sentences above on stderr; nothing on stdout; no stack |

### 5.2 F-4: a failed create closes nothing and keeps everything (W-5a, r6 M-1, r7 M-2, sol M-3)

**Files.** runtime-herdr `index.ts` (`create` `:428-512`, `writeLaunchScript` `:233`); core `herdr.ts`
(`herdrPreRequestRefusal`, `compatible` in `resolveHerdrEndpoint`); core `session-manager.ts` (the worker catch
`:2290-2295`, the orchestrator catch `:2853-2856`, `rollbackLaunch` `:1874-1960`, `keepUnconfirmedLaunch`
`:1971-2011`, `recordMayOwnRuntime` `:1692`, the success paths, restore `:4286-4646`, P and the claims of 4.4
and 4.5).

**Before (fit-1 tip).** A failed `pane run` closes the new workspace by its ID with no check and throws a plain
error. Core's catch runs `rollbackLaunch` without the runtime and the handle, so it discards the prepared agent
session, removes the worktree and releases the reservation, while the agent may run.

#### 5.2.1 The plugin's create steps

| Step | Failure | Result | Script |
| --- | --- | --- | --- |
| 1. `resolveHerdrEndpoint` (fit-1) | any failure; `running !== true` (fit-1 text "no herdr server runs at <socket>; start one: herdr server"); **`compatible !== true`** (new: "the herdr server at <socket> is not compatible with this herdr client (version <v>, protocol <n>); restart it with this herdr") | plain error (Q0) | none written |
| 2. `workspace create` | Q1 or Q2 (4.3), command ID `cli:workspace:create` | plain error with `herdrCode` (and the no-server `code` for Q1) | none written |
| | any other failure: another F1 code or text, the 0.8.0 exit-0 error envelope, Rust text, a timeout, a signal, another exit | partial, `workspace-unconfirmed`, handle `id` `""` | none written |
| 3. the answer | no text `workspace_id`; no root pane in the pane grammar; no non-empty text `terminal_id` | partial, `workspace-unconfirmed`, with what parsed; the message keeps "returned no usable pane" | none written |
| 4. `writeLaunchScript` | throws | partial, `launch-not-submitted` | none, or a partial file that the plugin removes |
| 5. `pane run <P> bash <script>` | Q1 or Q2, command ID `cli:request` | partial, `launch-not-submitted` | removed |
| | any other failure (also F1 `pane_not_found` after the request, section `r8_pane_run_pane_not_found_after_request`) | partial, `launch-unconfirmed` | **kept** |
| 6. `pane get <P>` (new) | not P with terminal T of step 3: `pane_not_found`, another terminal (kept as `terminalAfterRun`), any failure | partial, `launch-unconfirmed` | kept |
| | P with T | success: the handle | the script removes itself |

The partial handle: the fields of a success handle (`id` P, `workspaceId`, `paneId`, `terminalId`,
`sessionId`, `workspacePath`, `createdAt`, `herdrBin`, `herdrSocket`), plus `createIncomplete: <stage>` and,
when known, `terminalAfterRun`. For `workspace-unconfirmed`: `id` `""` and what parsed. The messages:
`workspace-unconfirmed` "herdr workspace create did not confirm a workspace for session <s> (<cause>); AO
closed nothing" (or step 3's "... returned no usable pane ..."); the launch stages "Failed to launch agent in
herdr pane <P> (<stage>): <cause>. Workspace <w>, terminal <T>, socket <socket>. AO closed nothing." `<cause>`
is the F1 code and text, or "transport failure: <first stderr line>". `create` has no `workspace close` and no
`pane close`.

Step 6 is a check, not a binding (RH B-2 stays open): it makes a restart between `workspace create` and `pane
run` visible; a restart after it is not seen.

#### 5.2.2 Core: the worker and orchestrator catches

Worker (`:2290-2295`):

```ts
} catch (err) {
  if (isRuntimeCreatePartialError(err)) {
    await rollbackLaunch({ own, prepared, workspace: spawnWorkspace(), runtime: plugins.runtime,
      handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle), ownClaim });
  } else {
    await rollbackLaunch({ own, prepared, workspace: spawnWorkspace() });   // today's plain-error path
  }
  throw err;
}
```

Orchestrator (`:2853-2856`): the catch calls `rollbackOrchestratorLaunch` (`:2670`), which already passes
`runtime: plugins.runtime` and the workspace of isolated mode to `rollbackLaunch`. Its `failed` argument gets
two more optional fields, `partialRecord` and `ownClaim`, which it passes on:

```ts
} catch (err) {
  await rollbackOrchestratorLaunch(systemPromptFile, isRuntimeCreatePartialError(err)
    ? { prepared, handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle), ownClaim }
    : { prepared });                                                     // today's plain-error path
  throw err;
}
```

The post-create catch of the orchestrator (`:2925`, `{ handle, prepared, failure: err }`) and of the worker
pass `ownClaim` too, so that `keepUnconfirmedLaunch` can settle (4.5). `launchedRecordFor(handle)` is the
record that the success path writes today (worker `:2321-2343`, orchestrator `:2879-2894`), moved into one
local function per path.

#### 5.2.3 Core: `rollbackLaunch` for a runtime in the set

When `rollback.runtime` and `rollback.handle` are given and `isLaunchEndUnproven(handle.runtimeName)` (a
partial error, or a post-create failure of a Herdr launch):

1. `own.checkOrUnknown()`. Not own (gone, replaced, unknown): remove nothing (no stop, no agent-session discard,
   no workspace removal, no release), write nothing, settle nothing; warn once with the handle (pane,
   workspace, socket), the worktree, the agent session and the record state; return `{ stopUnconfirmed: true
   }`. This also covers the post-create path where today a replaced record keeps the runtime but the rollback
   still discards the agent session (`:1907-1922`).
2. With `partialRecord`: `own.write({ ...partialRecord, runtimeHandle: JSON.stringify(handle),
   [RESERVATION_KEY]: "" })` replaces P. A failed write: as step 1.
3. `stopRuntime(runtimeForHandle(handle, rollback.runtime), handle)`. Herdr answers `unknown`, so
   `keepUnconfirmedLaunch` runs: today's `launchFailed` write (identity compare), then `settleOwnClaim(own,
   ownClaim)` (4.5), and the rollback ends with nothing removed.
4. A confirmed stop (a later RH-B) goes on as today.

For a runtime outside the set, `rollbackLaunch` keeps today's steps. One change applies to every runtime:
after its `launchFailed` write, `keepUnconfirmedLaunch` settles the own claim with `settleOwnClaim` (today it
keeps the claim).

`recordMayOwnRuntime` (`:1692`): a record whose stored handle has `data.createIncomplete` answers `true` (4.4).

The orchestrator's prompt file stays when the launch is kept (`stopUnconfirmed`, today).

#### 5.2.4 Restore (sol m-1, sol M-3)

For a record whose create runtime (`plugins.runtime`) is in the set; the steps of today keep their numbers.

1. Steps 1 to 6 as today (no write). `assertNoLiveLauncher` (`:4323`). Before step 6 ends: `ownClaim = await
   readLaunchClaim()` (it may be `null`, 4.5).
2. **6a.** An orchestrator record (`isOrchestratorSessionRecord`): the admission in restore mode (5.3.2). The
   subject, then A; G without this ID; any selected record blocks; no probe. Busy, unsupported, path: refuse,
   nothing written.
3. **6b.** From an archive: the subject check, then the copy-back (`:4459`); under A for an orchestrator.
4. **7.** `stillOwned` (today). Then the stop of the old handle through `runtimeForHandle(oldHandle,
   plugins.runtime)` (4.6); under A it has the 10 s core bound. Not confirmed: refuse as today
   (`releaseCopyBack`), release A.
5. **7a. The transition write.** The subject check, then `updateMetadataIf(sessionsDir, id, {
   ...launchIdentity(owned), launchPid: owned.launchPid ?? "", launchPidStart: owned.launchPidStart ?? "" },
   { runtimeHandle: JSON.stringify(P), restoredAt: <now>, ...(ownClaim ?? {}) })`. `null`: throw
   `recordChangedError(..., "its old runtime was stopped; no runtime was created")`, release A. Keep `before
   = { runtimeHandle: <its value before>, restoredAt: <its value before> }`; `owned` = the written record.
6. **7b.** Release A. From here on, P and the claim carry the protection: a start's G sees the restore
   (`in-progress`, or `create-incomplete` when no claim could be read).
7. **8.** The workspace restore (today), outside A. A throw: the **transition write-back**, `updateMetadataIf(...,
   { ...launchIdentity(owned), ...ownClaim }, { runtimeHandle: before.runtimeHandle, restoredAt:
   before.restoredAt, ...CLEARED_LAUNCH_CLAIM })` (an empty value removes the key); `null` or a throw: warn
   ("the record of <id> keeps its pending handle; check it, then retire it with F-9"). Then throw today's
   `WorkspaceMissingError`. The copy-back stays (today's behavior after a step-8 failure). After step 8,
   `stillOwned` (today): a change throws `recordChangedError` with no write-back (not own).
8. **9.** `create`. A plain error (Q0, Q1, Q2): the transition write-back, then throw the error. A
   `RuntimeCreatePartialError`: the write `updateMetadataIf(..., launchIdentity(owned), { status: "spawning",
   runtimeHandle: <partial>, launchFailed: <cause, at most 600 characters> })`, then `settleOwnClaim` on the
   new identity; `null` or a throw of the first write adds "its runtime <pane> at <socket> was kept; check it
   by hand" to the error (and no settlement). Throw.
9. **10.** The success write (today: a compare on the launch identity, here `owned` after 7a). `null`:
   today's path (`recordMayOwnRuntime`: keep; the Herdr stop answers `unknown`: keep), and nothing to settle
   (not own).
10. **11.** `postLaunchSetup` (nonfatal, today).
11. **12.** `settleOwnClaim(owned, ownClaim)`. A throw: warn (4.5); `null`: nothing. Return the session.

For a create runtime outside the set: today's steps, with the dispatch of 4.6 at step 7; an orchestrator record
holds A for 6a and 6b only.

A second restore of a record with P or a partial handle stops at step 7 (Herdr `unknown`) and creates nothing.

#### 5.2.5 The record state "kept failed launch"

An active record with the partial handle (`createIncomplete`), `launchFailed`, the launch's normal keys
(`worktree`, `branch`, `agent`, `createdAt`; `status` `spawning` for a worker and a restore, `working` for an
orchestrator), the prepared agent session's keys, and **no launch claim** (4.5). The worktree, the agent
session, the prompt file (orchestrator) and, for `launch-unconfirmed`, the launch script stay. A **crashed
launch** (the `ao` process ended inside the launch) leaves P (`create-pending`) with a dead claim: the same
state without `launchFailed`.

#### 5.2.6 The consumers of a kept failed launch

| Consumer | Behavior after fit-2 | Test |
| --- | --- | --- |
| `ao status`, `get`, `list` | The stored partial handle stays. The line `launch failed: <text> (identity token <t>)` (5.5). A grammar pane ID that answers `false` may enrich the shown status to `killed`/`exited` (memory only); a rejected probe (empty ID, no server) keeps it. The 600-character cap applies to `launchFailed` only; pane, workspace, socket and stage stay readable in the stored handle | T-4.12 |
| `ao session kill` (no F-9) | After the launcher check, the Herdr stop answers `unknown` (no call, also for an empty ID or malformed pins), and the kill refuses before the worktree removal and the archive; the hint names F-9 with the identity token | T-4.11 |
| `ao session cleanup` | Orchestrators are skipped; a live launcher is skipped; a worker that reaches `killRecord` meets the same refusal. Cleanup never passes `confirmRuntimeClosed` | T-4.13 |
| `ao session restore` | Step 7 stops through the handle's runtime (4.6): Herdr `unknown`, so restore refuses before any workspace or runtime step | T-4.10, T-4.10b |
| `ao start` | G blocks it (`create-incomplete`); the reuse decision never reuses it (R3) | T-7.5 |
| Lifecycle | Probes may change the shown or persisted status; they call no kill, cleanup or restore. G does not read status | T-7.1 |
| `ao send` | No special policy (OQ-F5 (a)). `prepareSession` may try a restore when enrichment says exited or no agent; that refuses for Herdr. A `launch-unconfirmed` partial whose pane runs the agent with terminal T passes readiness and **receives the send**. An empty-ID partial waits for readiness, then `sendMessage` rejects with no call. A partial whose terminal changed answers `isAlive` `false`, so the send path tries a restore, which refuses | T-4.14 |

**Owner recovery of a kept failed launch.** Check it as 5.4.3 says, close the pane by hand when it belongs to
this launch, then F-9 with the identity token.

#### 5.2.7 Oracle changes

| Test (fit-1 tip) | Old oracle | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:178` "closes the workspace when the launch fails, leaving nothing in the shared server" | `argsOf(3)` is `workspace close w7` | zero `workspace close` and `pane close`; `RuntimeCreatePartialError`, `launch-unconfirmed` (a plain `Error` of `pane run` is not Q), handle `w7`, `w7:p1`, `term_abc`, the pins; the script file kept; the message still matches `/Failed to launch agent/` |
| `index.test.ts:189` "surfaces a herdr error body even though the CLI exits 0" | rejects `/workspace_create_failed.*no such dir/` | the same text, now in a partial `workspace-unconfirmed`; two calls |
| `index.test.ts:199` "throws when the response carries no usable pane" | rejects `/no usable pane/` | the same text; a partial `workspace-unconfirmed` with `workspaceId` `w7` |
| the create tests of `index.test.ts` (`:127`, `:146`, `:164`; fit-1 indices: call 0 status, 1 create, 2 run) | three calls | a fourth call `pane get` (index 3) that answers P with T; calls 0 to 2 unchanged; `STATUS_RUNNING` and `statusRunning()` get `"compatible":true` |
| `fit-reads.test.ts:189` "reads the failure form of every call with its own command ID (workspace create)" | rejects with `herdrCode` `server_not_running` and `code` `ERR_RUNTIME_NO_SERVER`; two calls | the session-form text is not Q1: a partial `workspace-unconfirmed`, `id` `""`, whose `cause` has that `herdrCode` and `code`; two calls. A new sibling test with the exact pinned Q1 text gives the plain error with both codes |
| `fit-reads.test.ts:208` "reads the pane run failure with the command ID cli:request" | the `workspace close` and a plain error with `cause.herdrCode` `pane_not_found` | a partial `launch-unconfirmed` whose `cause` has `herdrCode` `pane_not_found`; three calls; no `workspace close` |
| fit-1 `T-2.1` create tests (`fit-reads.test.ts:264`) | rejects `/no usable pane/`, two calls | unchanged; the error is a partial `workspace-unconfirmed` |
| core tests where `runtime.create` throws a plain error | today's rollback | unchanged |
| core tests of a prepared launch's clear (`:2360`, `:2913`) | the claim cleared after `confirmLaunch` | unchanged result, through `settleOwnClaim` |

#### 5.2.8 Acceptance tests

Plugin tests in runtime-herdr `index.test.ts`. End-to-end tests in a new runtime-herdr file
`src/__tests__/fit2-create-rollback.test.ts`: built core (`createSessionManager`), the real plugin, a stand-in
`herdr` through mocked `node:child_process` (the pattern of `lifecycle-pane-envelope.test.ts`) that keeps its
own state (workspaces made, inputs admitted), a real worktree workspace plugin on a temp git repo, and agent
stand-ins: a Claude Code shape (no `prepareAgentSession`) and an OpenCode shape (`prepareAgentSession`,
`confirmLaunch`, `getRestoreCommand`, `postLaunchSetup`; it records its discards and starts no agent).

| ID | Case | Expected |
| --- | --- | --- |
| T-4.1 | Plugin: each row of 5.2.1 | the stated result and script state; zero `workspace close`, zero `pane close` in every row |
| T-4.1b | Q near misses: `server_not_running` with another socket; with the session-form suffix; with no suffix; `protocol_mismatch` with another text; the 0.8.0 exit-0 envelope; the Q1 text on `pane run` with a socket other than `endpoint.socket` | each is a partial (`workspace-unconfirmed` for create, `launch-unconfirmed` for run) |
| T-4.2 | Worker, before the submission: `writeLaunchScript` throws; and `pane run` answers Q1 | spawn rejects with the partial; zero closes; the worktree exists; zero agent-session discards; the record has the partial handle, `launchFailed`, `status` `spawning`, no claim; `own` advanced |
| T-4.3 | Worker, a timeout after the admission: the stand-in records the `pane run` admission, then rejects with `killed: true`, `signal: "SIGTERM"` | as T-4.2, `launch-unconfirmed`; the script kept |
| T-4.3b | **Records, then errors (r7 M-2):** `workspace create` makes `w7` in the stand-in's state, then answers F1 `zz_unknown_code`; `pane run` records the admission, then answers F1 `pane_not_found` | create: partial `workspace-unconfirmed`, the worktree, the agent session and the record kept; run: partial `launch-unconfirmed`, the script kept; zero closes |
| T-4.4 | Worker: step 6 answers another terminal | `launch-unconfirmed`, `terminalAfterRun` recorded |
| T-4.5 | Orchestrator, project mode, T-4.2 to T-4.4 | the record `<prefix>-orchestrator` kept with the partial handle; the prompt file kept; the project directory unchanged |
| T-4.6 | Orchestrator, isolated mode, T-4.3 | the worktree and the numbered record kept |
| T-4.7 | The record is replaced during the create (the stand-in rewrites the launch identity before `pane run` answers) | zero closes, zero removals, zero agent-session discards, no write to the new record; one warning that names the pane, the socket, the worktree and the agent session |
| T-4.7b | **Replaced by P (sol m-5, Muse m-3):** a successful create, then `postLaunchSetup` throws after the test replaced the record by a new reservation with P (OpenCode shape) | `recordMayOwnRuntime` is `true`; zero stops, zero agent-session discards, zero workspace removals; the new reservation byte-equal; one warning |
| T-4.8 | Control: discovery succeeds, then `workspace create` answers the exact Q1 text with `endpoint.socket`; and Q2 (both texts) | today's rollback: the worktree removed, the reservation released, the agent session discarded; no herdr call after `workspace create` |
| T-4.8b | Control: `status server --json` answers `compatible: false` (`r8_status_json_ping_protocol_19.json`) | plain error; zero `workspace create`; today's rollback |
| T-4.9 | Control: a successful create (Claude Code shape) | the handle with the pins; one `pane get` after the run; P replaced; no claim left |
| T-4.10 | Restore of a **terminal handleless** record (so step 9 is reached) on a Herdr project; `pane run` times out | the record has the partial handle, `launchFailed`, the new `restoredAt`, no claim; nothing removed |
| T-4.10b | A second restore after T-4.10 | refuses at step 7 (`unknown`); zero `workspace create` |
| T-4.10c | Restore, step 9 answers Q1 | `runtimeHandle` and `restoredAt` as before the restore; no claim; nothing created |
| T-4.11 to T-4.14 | The consumer rows of 5.2.6 | as stated there; T-4.11 with a valid, an empty-ID and a malformed-pin partial; T-4.13 a worker partial with a merged PR and with a pane that answers `pane_not_found`; T-4.14 the three send cases with exact call counts |
| T-4.15 | **In-flight create:** the stand-in never answers `pane run`; the test reads the record while the call waits | the record has P (`create-pending`), `role` (orchestrator) and a live claim with this process's PID |
| T-4.16 | **Resident restore (sol M-3):** in the test process, a restore of a terminal handleless Herdr record with the OpenCode shape (a stored `opencodeSessionId`); create succeeds; `postLaunchSetup` throws once | the restore resolves; the record has the real handle and **no** `launchPid`/`launchPidStart`; then, in the same process: `kill` refuses with the Herdr stop's `unknown`, not `SessionLaunchInProgressError`; a `spawnOrchestrator` is blocked with kind `unproven` or `not-reused`, not `in-progress` |
| T-4.16b | As T-4.16, but the settlement write throws (the test makes the record's write fail once) | the restore still resolves; one warning that names the claim; the claim stays; `kill` in the same process refuses as in progress; nothing removed |
| T-4.17 | **Kept post-create failures (sol M-3):** spawn and start (both modes), with each agent shape; `postLaunchSetup` (Claude Code shape) or `confirmLaunch` (OpenCode shape) throws after a successful create | a kept failed launch: the real handle, `launchFailed`, no claim; in the same process `kill` refuses with `unknown` and F-9 is not refused as "in progress" |
| T-4.18 | **A later claim survives:** during `postLaunchSetup` the test writes other claim values into the record (another PID and start, no identity change) | after the success settlement those values are byte-equal; the success write of the launch is in the record |

### 5.3 F-7: startup admits at most one Herdr orchestrator launch per project

**Files.** core `types.ts`, `index.ts`, `delivery-lock.ts` (the kind, `admissionLock`), `session-manager.ts`
(`spawnOrchestrator` `:2438-2930`, restore of an orchestrator record, `findReusableOrchestrators`, the dispatch
sites of 4.6, `isOrchestratorRuntimeAlive` `:571-603` replaced), `runtime-stop.ts` (`:221`); runtime-herdr
`index.ts` (`preflight`); CLI `start.ts` (`:880-1157`), `spawn.ts` (`runSpawnPreflight` `:67-85`),
`lib/preflight.ts`, `doctor.ts` (comment `:187-192`).

#### 5.3.1 Lock A: who takes it and what runs under it (sol M-1, sol m-1, Muse m-6)

- **Name:** `admissionLock(getProjectSessionsDir(project))` (4.9). Each admission path calls the same function
  for the same project, so all of them use one name for one sessions directory.
- **Who takes it:** `spawnOrchestrator` (both workspace modes, every strategy); `restore` of an orchestrator
  record (`isOrchestratorSessionRecord`); `findReusableOrchestrators`. Worker spawns and worker restores do not
  (L-3).
- **Wait:** `holdDeliveryLock(name, waitMs)` with `waitMs` 30 000 by default. Not obtained in time:
  `OrchestratorStartBlockedError` `reason: "admission-busy"`: "Another ao process is admitting an orchestrator
  for project <p> now. Run ao start again after it ends." Nothing written.
- **Platform without the lock** (`isDeliveryLockSupported()` false): a start or a restore whose create runtime
  is in the set, or whose G1 (read without A) selects a record, refuses (`admission-unsupported`; OQ-F6 (a)).
  A start of a runtime outside the set with no selected record runs as today. `findReusableOrchestrators`
  runs its rounds without A there: it admits nothing.
- **What runs under A:** the subject check and the `mkdir`; G1 (strict reads); G2 (record fields and
  `liveLaunchOwner`, which reads `/proc`); for a start: `validateAndStoreOrigin`, the project-mode
  `setupWorkspaceHooks` (local files), the project-mode branch for a record **outside** the set (today's probe
  and stop through tmux), the reservation with P and the claim; for a restore: the copy-back, the old
  runtime's stop and the transition write.
- **What never runs under A:** any Herdr call (the reuse probe and the probes for message M run between rounds
  or after the last round, 5.3.2); the workspace create or restore; the agent preparation; `runtime.create`.
- **The hold bound.** Each runtime call under A has the core bound `probeTimeoutMs` (10 000; no answer in
  time: unknown for a probe, `unknown` for a stop). A Herdr-only admission holds A for local work only. With a
  tmux record in project mode: at most one probe and one stop, so about 20 s at most (each tmux command also
  has tmux's own 5 s limit). A restore: at most one stop (tmux) or none (Herdr: no call; no handle). The
  default wait (30 s) is longer than the longest hold, so a waiter normally gets A; when it does not, it
  refuses `admission-busy` and creates nothing.

#### 5.3.2 The admission rounds

One procedure for the three modes: `start`, `restore` (with the own ID excluded) and `reuse-only`.

```text
subject, name = admissionLock(sessionsDir)              # refuses admission-path
answers = {}                                            # key: sessionId + identity token
for round in 1, 2, 3:
  hold A (busy: admission-busy)
  start: mkdir -p sessionsDir; every mode: check realpath(sessionsDir) == subject (when it exists)
  G1: select the known-Herdr orchestrator records (strict reads; an error: records-unreadable)
  G2: decide each record from its fields, R1 to R6 (and R8 for a start), and the answers
      a record that passes and has no answer for its identity token: "needs a probe"
  if no record needs a probe:
     start:      any blocking record: release A, then throw records (M, 5.3.8)
                 a reuse candidate with the answer alive: the admitted step "reuse"
                 no Herdr record: the admitted step "launch"
     restore:    any selected record: release A, then throw records; else the admitted step
     reuse-only: release A, return the reusable sessions
     the admitted step runs under A, then A is released
  else:
     release A; probe the records that need a probe, in parallel, each with probeTimeoutMs,
     through runtimeForHandle and the record's pins; answers[id + token] = the classifier's answer
after round 3 with a record that still needs a probe:
  start, restore: throw records-changed; reuse-only: return the records that are reusable, drop the rest
```

- The probe answer counts only for the identity token that was probed. A record that changed between the
  probe and the next round has a new token and needs a new probe (the revalidation of r7 M-1 and sol M-2).
- In the deciding round, R1 to R6 are read again under A. So a record that got a live launcher, a
  `launchFailed`, a `createIncomplete`, another runtime or a terminal status after the probe is not reused,
  also when its identity did not change.
- Only these records can need a probe: a start: the R8 candidate; a reuse-only decision: every record that
  passes R1 to R6. A restore needs none.
- **The admitted step of a start** (under A): `validateAndStoreOrigin`; project mode: `setupWorkspaceHooks`;
  then "reuse": the strict re-read of the candidate, `orchestratorSessionReused=true`, return; or "launch":
  project mode: today's branch for a fixed-ID record outside the set (dispatch 4.6, each call bounded), then
  the subject check and the reservation with P; isolated mode: the subject check and the reservation with P.
  The concurrent branch (`:2582-2615`) for a record outside the set keeps today's logic with 4.6; a fixed-ID
  record of the set that appears there is decided by the next round (the start throws `records-changed`
  after round 3).
- **The admitted step of a restore:** 5.2.4 steps 6b to 7b.
- **After a blocked decision,** with A released: each blocking record with a grammar pane ID gets one probe
  (cached answers are reused), in parallel, each with `probeTimeoutMs`, to fill `answer` in message M. These
  probes decide nothing.

#### 5.3.3 G1: the selection

G1 reads every active record (`listRecordIds`, `readRecordStrict` each; an error: `records-unreadable`), keeps
the records that `isOrchestratorSessionRecord(id, raw, prefix)` accepts, and of those the **known-Herdr**
records, whatever their `status`, `activity`, `killedReason` or `launchFailed`, and whatever the project's
runtime is now:

| Record | Known-Herdr when | Kind if it blocks |
| --- | --- | --- |
| `runtimeHandle` parses to an object with a string `id`, a string `runtimeName` and an object `data` | `runtimeName` in the set | by R (4.7) |
| `runtimeHandle` parses but has no string `runtimeName` | the project's selected runtime is in the set | `damaged` |
| `runtimeHandle` does not parse, or has the wrong shape otherwise | its text matches `/"runtimeName"\s*:\s*"herdr"/`, or the project's selected runtime is in the set | `damaged` |
| no `runtimeHandle`, a live launch owner | the project's selected runtime is in the set | `in-progress` |
| no `runtimeHandle`, no live owner | not selected (today's rule; limit L-2) | |

#### 5.3.4 Runtime mismatch (r7 M-3, OQ-F4)

Recommended (a): **block.** A Herdr record is never reused when the project now selects another runtime (R5),
and no other runtime probes or stops it (4.6). T-7.8 keeps its oracle "blocked". A tmux record while the
project now selects herdr keeps today's rules (outside G, L-1).

#### 5.3.5 The CLI (`start.ts`, sol M-2)

1. `ensureTmux` runs when `project.runtime ?? config.defaults.runtime` is `tmux` (was `defaults.runtime`).
2. Candidates from `sm.list(projectId)` as today (orchestrator records that are not terminal). fit-1's
   `isHerdrProbeTerminal` hold is removed: a terminal Herdr record is not a CLI candidate, and core G blocks it.
3. The candidates are split: (a) a stored handle whose `runtimeName` is in the set: left to core; (b) a stored
   handle of another runtime: today's `checkOrchestratorLiveness` (without fit-1's Herdr branches); (c) no
   stored handle (also a handle that does not parse): today's `unchecked` rule (OQ-F10).
4. When (a) is not empty: `reusable = await sm.findReusableOrchestrators(projectId)`.
5. `existing` = (b) alive ∪ (c) ∪ `reusable`. Not empty: "Using existing orchestrator session: <id>" for the
   most recent by the snapshot's `lastActivityAt` (a core session that is not in the snapshot sorts last), and
   no core start. This keeps the isolated CLI reuse control.
6. Else (b) unknown: today's refusal; (b) gone: today's information line.
7. An orchestrator will be created (not `--no-orchestrator`): the selected runtime's readiness,
   `preflight.checkSelectedRuntime(runtime, name)` (new, `lib/preflight.ts`: `tmux` → `checkTmux()`; another
   runtime → `runtime.preflight?.()`), then `sm.spawnOrchestrator`.
8. An `OrchestratorStartBlockedError` (guard by code) from step 4 or step 7: `spinner.fail("No new orchestrator
   was started")`, then rethrow **the same error object**, so the top-level handler prints `Error:` and exactly
   its message, with no "Failed to setup orchestrator:" prefix. Other errors keep the prefix.

Why this closes sol M-2. The CLI's own probe and snapshot no longer decide a reuse of a Herdr record. Core
decides with a strict read under A, after its probe, with R1 to R7 for the same identity token. A launch that
published its handle still has its claim until its success settlement (4.5), so R1 fails during
`postLaunchSetup` and `confirmLaunch`.

#### 5.3.6 Preflight and `ao spawn` (r6 m-2)

- runtime-herdr `preflight()`: `resolveHerdrEndpoint({ binPath, env: process.env })` with its own `binPath`;
  rejects when the binary is missing, `running !== true` or `compatible !== true`. It caches nothing.
- `spawn.ts` `runSpawnPreflight`: the registry's runtime instance for `project.runtime ?? defaults.runtime`
  (`getPluginRegistry`, cached at `create-session-manager.ts:32`, the same instance that the session manager
  uses) and `checkSelectedRuntime`. It runs before `sm.spawn`.
- `doctor.ts` keeps the ambient `checkHerdr()`. Its comment (`:187-192`) changes to: "External-service probes
  per runtime. tmux uses the same check as `ao spawn`. herdr is an ambient check (bare `herdr` on PATH, the
  caller's socket); `ao spawn` and `ao start` ask the selected runtime's `preflight()`, which uses the plugin's
  own binary, so the two verdicts can differ."

#### 5.3.7 `runtime-stop.ts`

The fallback row "destroy resolves, `isAlive` rejects with no-server → `destroyed`" (`:221`) applies only to a
runtime outside the set (a guard for 4.2; Herdr has `stop`).

#### 5.3.8 When a start refuses, the message, the recovery

A start (CLI or direct core) refuses before any write when G finds a blocking record, when the records cannot
be read, when A is busy or unsupported, when the admission path cannot be fixed, or when the records change in
three rounds. It reuses, and does not refuse, only a live record that R accepts: core's project-mode record, or
any workspace mode through the CLI. With `--no-orchestrator`, nothing of this runs.

**Message M** (`OrchestratorStartBlockedError.message` for `reason: "records"`; each `<...>` in a command is
shell-quoted with `shellEscape`):

```text
No new orchestrator was started for project <project>: AO cannot tell that every earlier herdr orchestrator launch of the project ended.
<id>: <state>. Herdr pane <pane> (terminal <T>), workspace <ws>, worktree <path>, socket <socket>: <answer>.
  Check:  HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>
  If it runs, use it:  ao session attach <id>
  If it does not run, or after you close it:  ao session kill <id> --confirm-runtime-closed <identity-token>
Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.
```

One block per record. `<state>`: `status <s>[, launch failed][, create <stage>][, <reason of not-reused>]`, or
`launch in progress by ao process <pid>`. Variants: an empty pane ID: `Check:  HERDR_SOCKET_PATH=<socket> <bin>
workspace list` (look for the label `<session>` and the cwd `<path>`); `in-progress`: `Wait for ao process
<pid>; if it hangs, stop that process, then run ao start again.` (no kill line); `damaged`: `Its runtime handle
cannot be read (<first 80 characters>). Retire it by hand: docs/DEVELOPMENT.md, "Retire a Herdr record by
hand".` (no F-9 line; F-9 refuses it). `<answer>` (after A): "herdr answered that the pane does not exist",
"herdr shows the pane with another terminal (<T'>)", "no herdr server answers at the socket", "the herdr check
failed: <first line>", "the herdr check did not answer within 10 s", "the pane runs, but the record is not
reusable (<why>)", "its herdr pins are malformed", "no herdr runtime plugin is loaded", "AO has no pane ID for
this launch".

The other reasons print one sentence each: `records-unreadable` ("The session records of project <p> could not
be read (<error>); no orchestrator was started."), `admission-busy` (5.3.1), `admission-unsupported` ("This
platform has no admission lock; AO starts no herdr orchestrator here."), `admission-path` (4.9),
`records-changed` ("The orchestrator records of project <p> changed during the check; run ao start again.").

#### 5.3.9 Deferred limits (sol's conditions)

- **L-1** tmux and test-runtime orchestrator records are outside G. The guarantee is narrow: a fit-2 start or
  restore never admits a second Herdr orchestrator launch next to a known-Herdr orchestrator record of the
  project (any status) or an in-flight Herdr launch of a fit-2 build. A tmux and a Herdr orchestrator, and two
  tmux orchestrators, can still exist (today's behavior). No document says "one orchestrator per project".
- **L-2** Core G does not select a handleless orchestrator record without a live launcher: a launch of a build
  before fit-2 that crashed inside a Herdr create. P cannot be added to such a record. The CLI keeps today's
  rule for it (it counts as the existing orchestrator; OQ-F10). **Upgrade step** (owner, before the first
  fit-2 start): for each Herdr project, list the orchestrator records without `runtimeHandle`, for example
  `grep -L '^runtimeHandle=' <sessions dir>/*-orchestrator*`; check each as 5.4.3 (`workspace list` by label
  and cwd); retire each by hand (5.4.4).
- **L-3** Worker spawns have no project-wide admission rule (distinct worker IDs are intended). Same-ID
  serialization of restore and kill is same-ID R3, not fit-2.
- **L-4** A is per sessions directory: two AO configs in different directories for one repository are two
  projects and are not serialized. This does not cover two names for one directory, which 4.9 removes (R-A
  stays).
- **L-5** An `ao` build before fit-2 takes no A and writes no P. **Deployment constraint:** stop every `ao`
  process of the old build (lifecycle workers, resident `ao` processes, watchers that run `ao`) before the first
  fit-2 start. fit-2 has no fence against an old binary (that is the RW round).

#### 5.3.10 Oracle changes and acceptance tests

**Oracle changes.**

- Commit 5: the core interim tests (`orchestrator-herdr-start.test.ts`: `false` and no-server give the exact
  refusal; runtime-herdr `fit-startup-interim.test.ts`: project mode refuses) expect `OrchestratorStartBlockedError`
  (`records`, kind `unproven`) and message M instead of "Cannot tell whether session ...". Their controls stay:
  a live Herdr record is reused (strategy `reuse`); a record of another runtime with `false` is archived and
  replaced. The record-equality and no-archive assertions stay.
- Commit 6: the CLI interim tests (`start.test.ts` "start command — old Herdr orchestrators (fit-1 interim)",
  both modes; `start-herdr-interim.test.ts`) expect exit 1 with message M (no prefix). The "killed record whose
  pane runs is passed over" control becomes **blocked** (`not-reused`, status `killed`; 2.2 item 12). The
  controls "a live working record is reused", "a `done` record is not probed" (core blocks it: it is a
  known-Herdr record; the oracle changes to blocked with kind `not-reused`, status `done`) and "a tmux record
  that `sm.list` showed killed is not probed and a new orchestrator starts" (unchanged) are restated with these
  results.
- The no-server controls with runtime `tmux` (`start.test.ts:1042` A1) and `mock`
  (`orchestrator-no-server-start.test.ts:52`, `:80`) keep their oracles. `preflight.test.ts` (`checkHerdr`)
  keeps its oracles.

**Acceptance tests.** Core tests in a new runtime-herdr file `src/__tests__/fit2-startup.test.ts` (built core,
the real plugin, a stand-in `herdr` that answers by the `HERDR_SOCKET_PATH` of each call; the caller's own
endpoint answers a healthy, compatible `status server --json`). CLI tests in `start.test.ts`, `spawn.test.ts`
(mocked core) and a new `start-herdr-guard.test.ts` on the real core. "Nothing written" means: the sessions
directory listing and each record byte-equal before and after; no reservation, no `.origin` write, no hooks
write, no prompt file, no worktree; zero `workspace create`.

| ID | Case | Expected |
| --- | --- | --- |
| T-7.1 | Persisted `status=killed`, `killedReason=runtime`, a pinned Herdr handle; the pin answers F1 no-server; a healthy caller endpoint; direct core; project and isolated mode | blocked, kind `not-reused` (status `killed`); nothing written |
| T-7.2 | `status=working`, the pin answers F1 `pane_not_found`; and another terminal | blocked, `unproven`; nothing written |
| T-7.3 | `status=working`, enriched to `activity=exited` by the real `list()` before the start; both modes | blocked |
| T-7.3b | **Legacy exit-0 answers (r7 m-4):** the pin answers the 0.8.0 exit-0 `pane_not_found` envelope; and a 0.8.0 `pane_info` with another terminal; project mode, strategy `delete`; direct core | blocked; nothing written (on `389b8dfe` the record is archived and a second orchestrator starts; on the fit-1 tip the interim message) |
| T-7.3c | T-7.3b in isolated mode | blocked (on `389b8dfe` a second ID is reserved) |
| T-7.4 | CLI, mocked core: `sm.spawnOrchestrator` rejects with an `OrchestratorStartBlockedError` | exit 1; `console.error` receives exactly (`"\nError:"` in red, `err.message`); no "Failed to setup orchestrator"; spinner fail text "No new orchestrator was started"; no "Starting a new one", no "Orchestrator session created" |
| T-7.4b | **CLI to real core:** a persisted `killed` Herdr orchestrator record (not a CLI candidate) | exit 1 with M; nothing written; zero `workspace create` |
| T-7.5 | A Herdr record with `launchFailed` and a live pane; a record with P and a dead claim | not reused (CLI and core); blocked (`not-reused`, `create-incomplete`); both modes |
| T-7.6 | A non-terminal Herdr candidate that the pin answers no-server (CLI, real core) | the reuse decision returns none; core blocks; exit 1 with M |
| T-7.7 | **Control:** a live, reusable Herdr orchestrator, project mode, strategy `reuse` (CLI and core); a live isolated one through the CLI | reused; no new runtime; the CLI prints "Using existing orchestrator session" |
| T-7.7b | A live isolated Herdr orchestrator in a direct core call; a live one with `status=killed` through the CLI in isolated mode | blocked, `not-reused` |
| T-7.8 | **Runtime mismatch:** project mode, the project now selects `tmux`; a live fixed-ID Herdr record without `launchFailed`; a registered tmux stand-in that would answer `false` and records its calls; strategies `reuse` and `delete`; direct core and CLI | blocked (`not-reused`, "the project now selects tmux"); **zero tmux calls with the Herdr handle**; the record unchanged |
| T-7.8b | **Concurrent fixed-ID branch:** a tmux record while the project now selects herdr; the tmux stand-in's `isAlive` writes a new fixed-ID tmux record so the reservation fails and the concurrent branch runs | zero herdr calls with a tmux handle; the branch probes through the tmux stand-in |
| T-7.8c | Restore of a Herdr record while the project selects tmux | refuses at step 7 (herdr `unknown`); zero tmux calls |
| T-7.8d | Kill and list with a Herdr handle while no herdr plugin is registered | kill refuses, nothing removed; list keeps the stored status with zero calls of the project's runtime. Controls: an unregistered `mock`-family handle: kill skips the stop and goes on (today); list uses the project's runtime (today) |
| T-7.8e | **Cleanup (sol m-3):** a Herdr worker (no PR) while the project now selects tmux; the Herdr stand-in answers `pane_not_found`; and no herdr plugin registered | first case: zero tmux calls with the Herdr handle; the rule asks herdr, the kill that follows refuses (`unknown`), the record kept; second case: no probe for the record, no kill |
| T-7.9 | Damaged records: a handle that does not parse but names herdr; a handle without `runtimeName` in a Herdr project; malformed pins | blocked, `damaged` (malformed pins: `unproven`, answer "its herdr pins are malformed"); zero calls for them |
| T-7.10 | Control: tmux and `mock` no-server records | "gone" and a new orchestrator, as today |
| T-7.11 | Herdr project, the selected endpoint has no server, no old record | `preflight()` rejects; exit 1 before `spawnOrchestrator`; nothing written |
| T-7.11b | The selected endpoint answers `compatible: false` | the same |
| T-7.12 | `--no-orchestrator` | no preflight, no admission (unchanged) |
| T-7.13 | `ensureTmux` follows `project.runtime` in both directions | no tmux check for a Herdr project; a check for a tmux project |
| T-7.14 | `ao spawn` on a Herdr project with a registered runtime made by `create({ binPath })`; the ambient `herdr` healthy, the selected one unavailable | exit 1 with the plugin's message; the ambient `herdr` never runs; `sm.spawn` not called |
| T-7.15 | `ao spawn` on a tmux project | `checkTmux` as today |
| T-7.16 | `runtime-stop.ts`: a stop-less runtime named `herdr` whose `isAlive` rejects with no-server after a resolved destroy | `unknown`; control: a stop-less `mock` keeps `destroyed` |
| T-7.20 | **Paused create:** start A (isolated, Claude Code shape) pauses inside `pane run`; then start B; direct core, and CLI B on the real core | B blocked (`in-progress`, this process's PID); B makes zero `workspace create`; A completes; a third start is blocked (direct core: `not-reused`, isolated) or reuses through the CLI |
| T-7.20b | As T-7.20 with A paused inside the workspace plugin's `create` (before `runtime.create`) | B blocked (`in-progress`) |
| T-7.21 | **Two simultaneous isolated starts:** `Promise.all` of two direct core starts on an empty project; and a forked Node process that runs the built core on the same state root | exactly one reaches `workspace create`; the other is blocked (`in-progress`) or busy |
| T-7.21c | **First start under a symlinked parent (sol M-1):** `AO_STATE_ROOT` below `alias` → `real`; the sessions directory does not exist. Process 1 (a forked Node process on the built core) pauses at the stage `sessions-dir-ready` (after the `mkdir`, under A). Process 2 (another fork) starts and reports the stage `subject-fixed`; the test then releases process 1, whose stand-in `pane run` waits until process 2 has answered | exactly one `workspace create` and one runtime create over both processes; process 2 blocked (`in-progress`, process 1's PID) or busy. **D2:** with the r8 subject rule, process 2 takes another lock name and both launch |
| T-7.22 | **Workspace-mode change:** a live isolated Herdr record `-orchestrator-1` while the project is now in project mode; and a live fixed-ID record while it is now isolated; direct core and CLI | direct core: blocked (`not-reused`); CLI: reuses the live record (no create) |
| T-7.23 | **Revalidation:** during G's probe the stand-in rewrites the record's launch identity (a restore); and writes `launchFailed` | the next round sees the new token or `launchFailed`; the record is not reused; after three changes `records-changed`; nothing written |
| T-7.24 | **A busy:** the test holds the admission name; `waitMs` 50 | `admission-busy`; nothing written |
| T-7.25 | **No lock on the platform:** `isDeliveryLockSupported` mocked false; a Herdr start; and a `mock` start | Herdr: `admission-unsupported`, nothing written; `mock`: as today |
| T-7.25b | **Admission path:** a file where a component of the sessions directory must be; a dangling symlink as a component | `admission-path`; nothing written; zero `workspace create` |
| T-7.26 | Restore of an orchestrator record while another Herdr orchestrator record exists | blocked by G (the restored record excluded); zero runtime calls for the create |
| T-7.26b | **Paused workspace restore (sol m-1):** restore of a terminal handleless orchestrator record on a Herdr project, workspace missing; the stand-in workspace plugin pauses in `restore` | during the pause, a start in the same process gets A within 50 ms (`waitMs` 50: no `admission-busy`) and is blocked `in-progress` on the restored record (P and the claim are on disk); then the restore goes on and creates |
| T-7.26c | **Failed workspace restore (sol m-1):** the stand-in workspace plugin throws in `restore` | `WorkspaceMissingError`; A is free right after (a start gets it within 50 ms); the record's `runtimeHandle` and `restoredAt` as before the transition; no claim; the copy-back stays |
| T-7.27 | **CLI after the handle is published (sol M-2):** start A (direct core, isolated, Claude Code shape) pauses in `postLaunchSetup` after its handle write; then `ao start` B on the real core | B's reuse decision returns none (R1: A's live claim); B: exit 1 with M (`launch in progress by ao process <pid>`); zero `workspace create` by B; no "Using existing orchestrator session". After A completes, `ao start` C reuses A's record (no create) |
| T-7.28 | **CLI probe race (sol M-2):** a live reusable isolated Herdr record; during B's reuse probe (the stand-in's `pane get`), the stand-in rewrites the record's identity; and in a second run writes `launchFailed`; and in a third run replaces the record by a new reservation with P | B does not reuse the stale candidate: the first run probes again in the next round and reuses only the new identity when it answers alive; the second and third runs: none reusable, core blocks (`not-reused` / `in-progress`), exit 1 with M |
| T-7.29 | **No Herdr call under A (Muse m-6):** a reuse candidate whose `pane get` never answers; `probeTimeoutMs` 200 | while the probe waits, another start in the same process gets A within 50 ms; the first start ends blocked, `unproven`, answer "the herdr check did not answer within ..." |

### 5.4 F-9: the owner retires a Herdr record (OQ-F2 (a))

#### 5.4.1 The command

`ao session kill <session> --confirm-runtime-closed <identity-token>`; core `kill(id, { confirmRuntimeClosed:
token })`. No other command or option gets it: `cleanup`, `restore`, the lifecycle, `ao start` and the send
path never pass it, and their option types do not have it.

#### 5.4.2 What it accepts, refuses, removes and keeps

Steps, in order; each refusal changes nothing:

1. Read the record strictly. Missing or unreadable: refuse.
2. **Accept** only a record whose `runtimeHandle` parses to an object with a string `id`, an object `data` and a
   `runtimeName` in the set: any status (also terminal), `launchFailed`, P or a partial handle, an empty ID,
   malformed pins. **Refuse** a tmux or other runtime's record ("the tmux stop confirms itself"), a record
   without `runtimeHandle`, and a handle that does not parse or has no `runtimeName` ("retire it by hand",
   5.4.4).
3. The token must equal `launchIdentityToken(raw)`. Else refuse: "the record now names another launch
   (identity token <new>); check it again before you retire it".
4. `assertNoLiveLauncher` (a live launch claim refuses).
5. The handle's runtime plugin must be registered (4.6). Else refuse.
6. `stopRuntime`. Confirmed (a later RH): go on as a normal kill.
7. Unconfirmed: one `isAlive(handle)` with the pins, with the core bound of 10 s. `true`: refuse ("herdr shows
   pane <pane> with its terminal at <socket>: the session runs; close it first"). `false`, any rejection, a pin
   error, a non-boolean, no answer in time: the owner's statement decides.
8. One conditional write on the launch identity: `retiredBy=owner`, `retiredAt`, `retireEvidence=<the answer of
   step 7, at most 200 characters>`, `retiredIdentityToken=<token>`. A failed write stops the operation, with
   nothing written and nothing removed.
9. The rest of the kill as today, with `stopWhenReplaced` (the launch identity read in step 1) directly before
   each removal and inside the plugin callbacks: the worktree removal only for a managed worktree (the project
   checkout is never removed, `:674-684`, `shouldDestroyWorkspacePath`); the OpenCode session only with `--purge-session`; the archive
   through `deleteMetadata` (generation floor and record lock kept), with the retire keys in the archived
   record.

**It keeps:** the project checkout, the agent session (without `--purge-session`), the herdr server, its
workspaces and panes (F-9 sends no herdr request other than the one read of step 7), the prompt file.

The retire keys of step 8 are not launch-identity keys, so `stopWhenReplaced` still holds after step 8. When a
later step stops on a replacement, the retire keys stay in the record version that step 8 wrote; their
`retiredIdentityToken` differs from the record's current token, and no reader acts on them.

Without the option nothing changes, except the hint of a Herdr kill refusal: "After you check and close it,
retire the record: ao session kill <id> --confirm-runtime-closed <identity-token>".

#### 5.4.3 The owner's check before the attestation

Message M, the kill refusal and `ao status` print what the check needs; the owner can also read the record
file. Pin values in commands are shell-quoted.

1. Read the stored handle: pane ID, expected `terminalId`, `workspaceId`, `workspacePath`, the label (the
   session or tmux name), `herdrBin`, `herdrSocket`, `createIncomplete`.
2. At the pinned endpoint: `HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>` and `... pane process-info --pane
   <pane>`. Compare `terminal_id` with the stored one, and the processes and their cwd with the worktree.
3. Empty pane ID: `... workspace list`; look for the label and the cwd.
4. Malformed pins: find the endpoint by hand (`<bin> status server --json` with a candidate
   `HERDR_SOCKET_PATH`); a failed AO read is not a check.
5. A missing pane at the pinned endpoint does not find a hidden old server. Also check that no process has its
   working directory in the worktree, for example `find /proc/[0-9]*/cwd -maxdepth 0 -lname '<worktree>*'
   2>/dev/null`.
6. Close the pane by hand when it belongs to this launch. Then run F-9 with the identity token that the check
   used.

#### 5.4.4 Records that F-9 refuses

A damaged record (no readable handle) is retired by hand, as the procedure in `docs/DEVELOPMENT.md` says: stop
the project's lifecycle worker, check as 5.4.3, move the record to `sessions/archive/<id>_<UTC time>`, remove a
managed worktree with `git worktree remove`. This skips AO's record lock and generation floor: an emergency
procedure.

**Residual (as review r7 states it).** A wrong attestation can remove a worktree that a hidden launch still
uses. The token removes the race between the owner's check and the command only for changes that AO records.

#### 5.4.5 Tests

| ID | Case | Expected |
| --- | --- | --- |
| T-9.1 | Herdr record, `isAlive` true | refused; the record and the worktree byte-equal |
| T-9.2 | `isAlive` false, the right token | archived with the retire keys; the managed worktree removed; the agent session kept; zero herdr close calls |
| T-9.3 | The pin answers no-server | archived; `retireEvidence` names it |
| T-9.4 | An empty-ID partial; P with a dead claim; malformed pins | archived (zero herdr calls for the empty ID and the malformed pins) |
| T-9.5 | A tmux record with the option; a record without a handle; an unparseable handle | refused; nothing changed |
| T-9.6 | A wrong token; the record restored between the token and the command | refused, the new token printed; nothing changed |
| T-9.7 | A live launcher | refused |
| T-9.8a | **Replacement during step 7 (sol m-4):** the stand-in's `pane get` rewrites the record's launch identity, then answers `pane_not_found` | the retire write (step 8) fails: no retire keys in the record, nothing removed, no archive; the error says that the record changed |
| T-9.8b | **Replacement after the retire write, in the workspace removal (sol m-4):** step 8 succeeds; the stand-in workspace plugin's `destroy` rewrites the record's launch identity in its awaited preamble, then calls `stillOwned` | the callback answers false: no worktree removal; the kill throws `recordChangedError`; no archive; the agent session kept |
| T-9.8c | **Replacement after the retire write, in the purge holder lookup (sol m-4):** `--purge-session` with an OpenCode-shaped record; step 8 succeeds; the stand-in holder lookup rewrites the record's identity | `stillUnheld` throws: no OpenCode interrupt, no session removal, no archive |
| T-9.9 | Project mode (`<prefix>-orchestrator`) | archived; the project directory unchanged |
| T-9.10 | A prepared OpenCode session without `--purge-session`; with it | kept; purged |
| T-9.11 | Without the option | today's refusal plus the hint line with the identity token |
| T-9.12 | `cleanup` over a Herdr worker partial | refuses as before; `kill` is never called with `confirmRuntimeClosed` (a spy) |
| T-9.13 | CLI: the option reaches core; exit 0 and 1; a missing token value | commander error, no core call |

### 5.5 `ao status` shows the identity token (sol m-2, Muse m-1)

- Core `metadata.ts`: `launchIdentityToken(record)` (4.8), exported from `index.ts` (commit 1).
- CLI `status.ts`: `SessionInfo` gets `identityToken: string | null` and `createIncomplete: string | null`.
  Both are set only when `session.metadata.runtimeHandle` parses to a handle whose `runtimeName` is in the set
  (`isLaunchEndUnproven`); else `null`. The token is computed from `session.metadata` (the raw record, which
  `sessionFromMetadata` keeps), never read from `launchFailed`.
- Human output (`printLaunchFailed`, `:229-232`): a record with `launchFailed` prints `launch failed: <text>`,
  plus ` (identity token <t>)` for a runtime in the set. A set-runtime record with `createIncomplete` and no
  `launchFailed` (a crashed launch) prints `launch incomplete (<stage>; identity token <t>)`. Other records:
  as today.
- JSON (`--json`): the two keys are added to each `SessionInfo` object; no key changes or goes away;
  `launchFailed` keeps its capped text.
- Tests (`status.test.ts`, next to the existing oracle at `:586-609`): a Herdr kept failed launch (the line has
  `identity token <t>` with `t = launchIdentityToken(record)`); P with a dead claim (`launch incomplete
  (create-pending; identity token <t>)`); a tmux kept failed launch (today's line, no token); JSON (both keys
  for the Herdr record, `null` for tmux); the token changes after a restore write and not after a status write.
- Commit 7.

### 5.6 F-8: the contracts and documents of fit-2

- `types.ts`: the texts of 4.2 (commit 1; the `SessionManager` and `kill` additions in commits 5 and 7).
- `CLAUDE.md`, "Plugin Standards", "Error Handling": add "A runtime's `create` throws a plain error only when
  nothing of the session can exist in the runtime; otherwise it throws `RuntimeCreatePartialError` with the
  handle of what may exist and `closed: "nothing"`, and closes nothing. Core keeps the record, the workspace and
  the agent session then. runtime-tmux keeps its best-effort kill of its own session; the Herdr measurements do
  not qualify it." "Interface Implementation": add the optional `preflight()`. The `isAlive` sentence of fit-1:
  add "at startup, core admits no second Herdr orchestrator launch next to an earlier Herdr orchestrator record
  and takes no Herdr answer as proof that a launch ended".
- `docs/DEVELOPMENT.md`: replace fit-1's interim paragraph with G and the reuse decision (5.3.2, 5.3.5, 5.3.8),
  the limits and the upgrade steps (5.3.9), the kept failed launch (5.2.5), the claim settlement (4.5), F-9
  (5.4) and "Retire a Herdr record by hand" (5.4.4).
- `lifecycle-manager.ts` (`:214-222`): the comment of `AUTHORITATIVE_RUNTIMES` says that runtime-herdr `isAlive`
  answers `false` only for `pane_not_found` or another terminal and rejects when it cannot answer (fit-1), and
  that Herdr stays non-authoritative because a server can run where the endpoint does not reach it.
- `doctor.ts`: the comment of 5.3.6.
- The F-8 comment rows of r7 that fit-1 did not change (check on the base): runtime-herdr `index.ts` comments
  (the create cleanup comment `:470-472`, the file header), core `herdr.ts` comments that name the create close.
- Doc 0004 after the round (development, not in the round's commits).

## 6. The merge with `feat/session-relaunch` (Muse m-4, sol)

Read: `git diff 3e366a01 7a20242f -- packages/core/src/session-manager.ts` and the section "Session relaunch
(2026-10-22)" of `docs/DEVELOPMENT.md` on that branch (tip `7a20242f`; relaunch review r4 on `main`
`9c1d117a` is NOT-LAND-SAFE with two new majors in the Claude Code hook and keeps M-6 open as an accepted
limit). Relaunch works only on tmux records: it refuses a Herdr handle ("a Herdr relaunch waits for the Herdr
live check") and an agent with `prepareAgentSession`.

**Shared record keys.**

| Key | fit-2 | relaunch | At the merge |
| --- | --- | --- | --- |
| `launchPid`, `launchPidStart` | written in the reservation for a set-runtime launch also without `prepareAgentSession`, and in the restore transition; settled by `settleOwnClaim` (identity and own values) | its claim CAS (identity and the claim values as read); `settleOnce` compares only its own values under the record lock, with later tries while the process lives | one settlement helper: extract relaunch's `settle` (own values, record lock, retries) and give it an optional identity compare; fit-2 uses it with the identity, relaunch without (it writes `restoredAt` back on "absent") |
| `restoredAt` | the restore transition writes it before `create` and writes it back on a step-8 failure or a plain create error | the claim writes it; "absent" writes it back | both write it only with their own claim compare; relaunch's `lastLaunchBinding` (token valid only while `launchTokenAt` equals the last launch time) treats a fit-2 restore like today's restore: the earlier binding stops counting |
| `runtimeHandle` | P and partial handles (Herdr only) | reads; refuses Herdr | no conflict |
| `reservationId` | P is born in a reservation, which keeps the key until the launch write | refuses a record with the key | no conflict: relaunch refuses fit-2's in-flight records |
| `launchToken`, `launchTokenAt`, `launchPane` | none; the identity token (4.8) has another name and is not stored | written by spawn, start (`launchedRecord`) and relaunch | fit-2's `launchedRecordFor()` keeps relaunch's two keys of spawn and start, so a partial record carries them too |
| retire keys (`retiredBy`, `retiredAt`, `retireEvidence`, `retiredIdentityToken`) | new | none | no conflict |

**Shared functions and paths.**

- `liveLaunchOwner`, `assertNoLiveLauncher`, `currentLaunchClaim`, `readLaunchClaim`, `CLEARED_LAUNCH_CLAIM`:
  both use them unchanged.
- `spawn` and `spawnOrchestrator`: relaunch adds the launch token to `agentLaunchConfig` and to
  `launchedRecord` (`:2321-2343`, `:2878-2894` of the fit-1 tip); fit-2 moves `launchedRecord` into
  `launchedRecordFor()`, adds P and the claim to the reservations, and replaces the claim clears by
  `settleOwnClaim`. Textual conflicts in the same hunks.
- `restore`: fit-2 rewrites steps 6 to 12 (5.2.4); relaunch does not change `restore`.
- `kill`: fit-2 changes the dispatch and adds F-9; relaunch does not change `kill`.
- `metadataToSession`: relaunch adds `withAgentPane` (tmux only); fit-2 does not change it.
- `types.ts`: both add to `Runtime` (fit-2 `preflight?`; relaunch `listPanes?`, `runInPane?`) and to
  `SessionManager` (fit-2 `findReusableOrchestrators`, the kill option; relaunch `relaunch`), and both export
  new names in `index.ts`. Adjacent additions.
- CLI `session.ts` (fit-2 the kill option; relaunch the `relaunch` command) and `send.ts` (fit-2 the refusal in
  the non-tmux delegation `:356`; relaunch the tmux path): different hunks of the same files.
- `docs/DEVELOPMENT.md`: two new sections.

**Who adapts.** The round that lands second adapts to the first; neither waits for the other (OQ-F11 (b)).
When relaunch is on `main` before the fit-2 implementation starts, the fit-2 implementer starts from that
`main` (gate G0) and adapts at once. When fit-2 is built on fit-1 first, the round that lands second rebases
and adapts. The adaptation is the same in both cases: `launchedRecordFor()` keeps relaunch's keys; one
settlement helper (above); the `types.ts`, `index.ts`, `session.ts` and `send.ts` additions merged. The rule
for the second landing: both test sets stay green, that is every test file that `git diff --name-only
3e366a01 7a20242f` lists (among them core `relaunch.test.ts` and `relaunch-settle.test.ts`, CLI
`session-relaunch.test.ts`), and fit-2's T-4.16 to T-4.18, T-7.20, T-7.21c, T-7.26b, T-7.27.

**What fit-2 does not complete.** fit-2's claims are launch markers for G and for the kill and restore checks
of a running launch. They are not the per-ID lease of same-ID R3 (operation, workspace and OpenCode ownership),
and they do not close relaunch M-6: fit-2's restore takes its claim only after the old runtime's stop (step 7),
and `kill` (also F-9) takes no claim. M-6 needs restore and kill to take a claim by compare-and-set before any
awaited destructive or allocating step and to release only their own claim on every end path. fit-2's
transition write already has that compare form (the launch identity and the claim as read), so R3 can move it
before step 7 later.

## 7. Product files

| # | File | Items | Kind |
| --- | --- | --- | --- |
| 1 | `packages/core/src/runtime-errors.ts` (new) | F-3, F-4, F-7 | API |
| 2 | `packages/core/src/types.ts` | F-4, F-7, F-9 | API and contract text |
| 3 | `packages/core/src/index.ts` | exports | API addition |
| 4 | `packages/core/src/herdr.ts` | F-4 (rule Q, `compatible`), `isHerdrPinError` | behavior |
| 5 | `packages/core/src/metadata.ts` | `launchIdentityToken` | API addition |
| 6 | `packages/core/src/delivery-lock.ts` | the `admission` kind, `admissionLock` | API addition, behavior |
| 7 | `packages/core/src/session-manager.ts` | F-3, F-4, F-7, F-9 | behavior |
| 8 | `packages/core/src/runtime-stop.ts` | F-7 | behavior (guard) |
| 9 | `packages/core/src/lifecycle-manager.ts` | F-8 | comment only |
| 10 | `packages/plugins/runtime-herdr/src/index.ts` | F-3, F-4, F-7 (`preflight`), F-8 comments | behavior |
| 11 | `packages/cli/src/commands/send.ts` | F-3 | behavior |
| 12 | `packages/cli/src/commands/start.ts` | F-7 | behavior |
| 13 | `packages/cli/src/commands/spawn.ts` | F-7 | behavior |
| 14 | `packages/cli/src/commands/session.ts` | F-9 | behavior |
| 15 | `packages/cli/src/commands/status.ts` | the token display | behavior |
| 16 | `packages/cli/src/lib/preflight.ts` | F-7 | behavior |
| 17 | `packages/cli/src/commands/doctor.ts` | F-8 | comment only |

**17 product files**: 15 with a behavior, type or API change, 2 comment-only. Against r8's 14: `status.ts` (sol
m-2), `metadata.ts` (the token's home, Muse m-1) and `lifecycle-manager.ts` (no longer conditional, 2.2 item 7).
No agent plugin changes. Docs: `CLAUDE.md`, `docs/DEVELOPMENT.md`.

Tests (new or changed): runtime-herdr `index.test.ts`, `fit-reads.test.ts`, `fit-startup-interim.test.ts`, new
`fit2-create-rollback.test.ts`, new `fit2-startup.test.ts`, `herdr-fixtures.ts`; core `runtime-errors.test.ts`
(new), `herdr.test.ts`, `metadata` and `delivery-lock` tests (the token, the subject), `runtime-stop.test.ts`,
`orchestrator-herdr-start.test.ts`, session-manager tests for send, kill, cleanup, restore and the dispatch
sites, `herdr-fixtures.ts`; CLI `send.test.ts`, `start.test.ts`, `start-herdr-interim.test.ts`, new
`start-herdr-guard.test.ts`, `spawn.test.ts`, `session.test.ts`, `status.test.ts`, `lib/preflight.test.ts`,
`herdr-fixtures.ts`.

## 8. Implementation order, commits, gates and size

**G0, before commit 1.** On the base (the fit-1 tip, or `main` once fit-1 has landed; and with relaunch when it
has landed, section 6): check the names of 2.1 with `git grep`; run the full gate set once; record the
`SAME_ID_DEFECTS=red` failing set (21 tests on the fit-1 tip, its report section 7). If a name differs, use the
base's name; if a behavior differs, stop and report.

| # | Commit | Content | Intermediate oracles |
| --- | --- | --- | --- |
| 1 | `feat(core): add the fit-2 error types, names and contracts` | `runtime-errors.ts` with the guards; `LAUNCH_END_UNPROVEN_RUNTIMES`, `isLaunchEndUnproven`; `Runtime.preflight?`; the `Runtime.create` doc; `herdrPreRequestRefusal`; `isHerdrPinError`; `launchIdentityToken`; the `admission` kind and `admissionLock`; exports | additive; new unit tests only: the guards across copies; rule Q with the r8 and r9 texts and the near misses of T-4.1b; the token; the subject (a symlinked parent before and after a `mkdir`, `ENOTDIR`, a dangling symlink) |
| 2 | `fix: refuse a send to a blocked herdr agent` | F-3 (plugin, core send, CLI send) | `index.test.ts:363` changes |
| 3 | `fix: keep the resources of a failed herdr create` | F-4: plugin steps 1 to 6 (Q, `compatible`, the post-run `pane get`, no close); core catches; `rollbackLaunch` for a set runtime; `keepUnconfirmedLaunch` settles; P and the claims of spawn and start; `settleOwnClaim` on every success path; the restore transition and its settlement (5.2.4 without A); `recordMayOwnRuntime` | 5.2.7. fit-1's interim startup tests stay green: they use persisted records with handles. A concurrent project-mode reservation of a set runtime now has P, so the interim guard refuses it as unknown instead of "already exists but is not in a reusable state"; no existing test meets that case with herdr |
| 4 | `fix: probe and stop an old record through its own runtime` | 4.6 at every listed site (the startup sites still call fit-1's interim function, now with the handle's runtime) | none changed; T-7.8c, T-7.8d, T-7.8e added |
| 5 | `fix: admit at most one herdr orchestrator launch per project` | A with the subject, the rounds and the bounds; G for start and restore; R; the classifier; `findReusableOrchestrators`; `runtime-stop.ts`; message M; the core interim guard removed | the core interim tests expect `OrchestratorStartBlockedError` and M (5.3.10). The CLI still has its interim guard and refuses with its own text before it calls core; a blocked error that reaches the CLI keeps the old prefix (the CLI tests mock core, so they stay green; `start-herdr-interim.test.ts` still sees the CLI's own refusal) |
| 6 | `fix: ao start and ao spawn follow the core admission` | CLI start (5.3.5), `checkSelectedRuntime`, runtime-herdr `preflight()`, `spawn.ts`, the `doctor.ts` comment | the CLI interim tests change (5.3.10) |
| 7 | `feat: retire a herdr record on the owner's word` | F-9 (the kill option, core steps, the CLI option, the hint) and the status display (5.5) | the Herdr kill refusal text gains the hint line; `status.test.ts` gains the token cases |
| 8 | `docs: the herdr fit-2 contracts` | 5.6 | review |

**Gates.** Each commit: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the tests of the changed packages,
under `env -i` with a scratch `HOME`. After commit 8: the full `pnpm -r --no-bail test` with a fake `HOME` and
no agent binary or `herdr` on `PATH` (the root run has the live OpenCode block); `SAME_ID_DEFECTS=red`: **the
failing set must equal the G0 set** (no fit-2 test is a red-set defect test, and no red-set test concerns a
Herdr create or startup). **D2 non-vacuity:** undo each fix in a scratch copy and name the tests that fail.
Each race test must fail when its **own** fix is undone, not only because another layer blocks: the r8 subject
rule (T-7.21c), the core reuse decision in the CLI (T-7.27, T-7.28), `settleOwnClaim` (T-4.16, T-4.17, T-4.18),
the restore transition and the release of A before step 8 (T-7.26b, T-7.26c), P (T-4.15, T-7.20), the probe
outside A (T-7.29), G (T-7.1 to T-7.5), rule Q (T-4.1b, T-4.3b), the dispatch (T-7.8 to T-7.8e), the F-9 token
(T-9.6) and the retire write (T-9.8a). No live herdr run is part of the gate. With relaunch landed: its test
files too.

**Size.** About 1,750 product lines (F-3 120; F-4 with P, the claims and the settlement 450; dispatch 110; A,
the subject, the rounds, G and R 500; CLI and preflight 190; F-9 170; status 50; commit 1 160) and about 3,400
test lines. **L**, at its upper end. The risk is in commits 3 and 5. OQ-F12.

## 9. Texts for the documents (after the implementation)

- `types.ts`: 4.2. `CLAUDE.md`, `docs/DEVELOPMENT.md`, `lifecycle-manager.ts`, `doctor.ts`: 5.6 and 5.3.6.
- Doc 0004 after fit-2: section 1 (a failed create keeps its resources; the startup admission; F-9), the R4
  notes (rule Q), section 8 (recovery).

## 10. What fit-2 keeps as it is

- The lifecycle's status rules (the outage rule, `isRecoverableKill`); Herdr stays non-authoritative.
- W-4 (duplicate delivery from `done`), the raw-text fallback when no agent is detected, the delivery
  timeouts.
- `ao doctor`'s ambient check; runtime-herdr `detect()`.
- The agent empty-ID fallbacks (3.3).
- The Herdr `stop` (`unknown`, no close); no AO path sends `pane close` or `workspace close`.
- Outside the round: RH (r6 B-1: proof that S's session ended; B-2: binding the launch submission to S's
  listener; M-3: S-based liveness separate from retire authority). G keeps retire authority off until RH.
- Same-ID R3 and relaunch M-6 (section 6).

## 11. Open questions for the owner

| OQ | Question | Options and residuals | Recommendation | Changed since r8 |
| --- | --- | --- | --- | --- |
| **OQ-F4** | A live Herdr orchestrator while the project now selects another runtime | **(a) Block** (T-7.8 "blocked"): the owner retires it (F-9) or switches the runtime back. **(b) Reuse** through the herdr plugin (safe with 4.6); the old runtime stays without a word; T-7.8 becomes "reused" | **(a)** | no |
| **OQ-F5** | `ao send` to a kept failed launch | **(a) No special policy**, documented and tested (5.2.6): a `launch-unconfirmed` pane whose agent runs with terminal T gets the send. The send's liveness check and its input are separate calls, a failed check reads as unknown, and RH B-2 does not bind the submission, so a send can still reach a terminal that changed after the check. **(b) Refuse** a send to a record with `createIncomplete` (a new core guard; a new policy) | **(a)** | wording only (sol): r8 said that the post-run check sends nothing to a changed terminal; that was too strong |
| **OQ-F6** | A platform without the abstract-socket lock (macOS) | **(a) Refuse** a Herdr orchestrator start or restore there (the delivery-ledger precedent); the reuse-only decision runs without A (it admits nothing). **(b) Run G without A**; two simultaneous starts can both pass G | **(a)** | no (one clarification: the reuse-only decision) |
| **OQ-F7** | The rule Q residual R-Q (4.3) | **(a) Qualify Q0, Q1, Q2** with the r8 and r9 evidence. The trust boundary: Q1 is an exact full message, Q2 a prefix; a server that imitates the CLI's text in the F1 form could get an ordinary rollback. **(b) Qualify only Q0**: every create failure after the endpoint check keeps the resources (more kept failed launches, for example on every protocol skew between the check and the create) | **(a)**, if the owner accepts R-Q; else (b) | yes: new evidence (`pane run` against protocol 23, r9) and the exact boundary text |
| **OQ-F8** | The F-9 token | **(a) Required** (5.4.1): a launch that changes between the owner's check and the command refuses. **(b) No token**: the inspection-to-command race of review r7 stays | **(a)** | name only: "identity token" (4.8) |
| **OQ-F9** (new) | The admission subject (sol M-1) | **(a) The canonical subject of 4.9** (the real path of the nearest existing ancestor plus the suffix), with a refusal on an unexpected lookup state; residual R-A (a third party swaps a state-directory component during two starts). **(b) The lexical path** (`resolve(sessionsDir)`): stable for one string, but two spellings of one directory (an `AO_STATE_ROOT` through a symlink in one shell, without it in another) get two names. **(c) A subject from the configuration** (config hash and project ID, no path): one name for one config, but two state roots for one config would share a lock and still be two directories | **(a)** | new |
| **OQ-F10** (new) | The CLI's candidates without a parseable stored handle | **(a) Today's rule** (5.3.5 step 3 (c)): they count as the existing orchestrator; the CLI prints "Using existing orchestrator session" and starts nothing. **(b) Leave them to core:** a damaged one blocks with message M; a handleless one with no live launcher is not selected (L-2), so isolated mode can start a second orchestrator next to it | **(a)**: no new launch next to a record that AO cannot judge | new |
| **OQ-F11** (new) | The order of fit-2 and `feat/session-relaunch` | **(a) Build fit-2 after relaunch lands**, adapting once (section 6). **(b) Build fit-2 now on fit-1;** the round that lands second adapts by the rules of section 6 | **(b)**: fit-2 does not depend on relaunch (relaunch refuses Herdr records), and its safety fixes need not wait for relaunch's review rounds | new |
| **OQ-F12** (new) | The size of the round | **(a) One round** of 8 commits (L, about 1,750 product and 3,400 test lines). **(b) Two rounds:** fit-2a = commits 1 to 4 (F-3, F-4 with P and the claims, the dispatch), fit-2b = commits 5 to 8 (admission, CLI, F-9, status, docs). After fit-2a, fit-1's interim guard still refuses at startup, and a kept failed launch is retired by hand until fit-2b | **(b)**: each round is M, and the two risky commits (3 and 5) get separate reviews | new |

The owner decided OQ-F1 (b), OQ-F2 (a) and OQ-F3 (b) (section 2.3). The r6 questions OQ-1, OQ-2, OQ-6 (fit-1
implements their (a)), OQ-5 (W-4 later), OQ-7 (admission in core, strict records, the selected runtime's
readiness) and OQ-9 (no handoff for a record without S) keep the recommendation (a); fit-2 follows it.

## 12. Measurements, deviations and checks

- **Measurement r9** (section 3.1): the isolation of the step 2 brief with the names of this round: marker
  `/tmp/aohd6-marker`, root `/tmp/aohd6`, a scratch `HOME` and XDG directories, a git identity in the scratch
  `~/.gitconfig`, `env -i` and a link-only `PATH` (`herdr` linked, never moved; `python3`; `strace`; `node`).
  No herdr server, no tmux, no `ao`, no network: 2 `connect()` calls, both `AF_UNIX`. Fixtures:
  `r9_cli_forms_log.txt`, `r9_forms_script.txt` (the Python script as text), `r9_strace_connects.txt`,
  `r9_admission_subject_check.txt`, `r9_admission_subject_script.txt` (the Node script as text). Cleanup: no own
  process, the herdr directories unchanged, `~/.ao/bin` unchanged, `/tmp/aohd6` and the marker removed.
- **Deviations from r8.**
  1. The CLI's reuse of a Herdr record moved into core (`findReusableOrchestrators`, a new `SessionManager`
     method).
  2. No Herdr call runs under A; the reuse probe runs between admission rounds (r8: one probe under A).
  3. Restore writes P and its claim after step 7 and before the workspace restore (r8: before step 9), also
     for a worker restore.
  4. For a set runtime, every rollback with a handle whose record is not its own removes nothing (r8: the
     partial path only).
  5. `recordMayOwnRuntime` treats a `createIncomplete` handle as "may own".
  6. The token is renamed "identity token" (relaunch's `launchToken` key), and the retire key
     `retireToken` is renamed `retiredIdentityToken`.
  7. Every claim clear compares the own claim values, also the clear of a prepared tmux launch; and
     `keepUnconfirmedLaunch` clears the own claim for every runtime (today it keeps it).
  8. A core 10 s bound on each probe, and on each stop under A (also tmux).
  9. 17 product files (r8: 14, or 15).
  10. Doc 0004: the fit-1 state (implemented on a branch, not landed), the fit-2 pointer (r9), and the r9
      `pane run` fact.
- **Checks.** `git status -s` shows only this file, doc 0004, the `r9_` fixtures and the `.agent_*` files;
  `git diff --exit-code -- packages` passes.
