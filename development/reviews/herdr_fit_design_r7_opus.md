# Herdr 0.9.5 fit round, design r7 (ao-65), 2026-10-22

Author: ao-65 (Claude Opus 5.5), 2026-10-22 about 20:00 to 20:30 EDT. Baseline `main` `541becfb`. No product
code changed. This design answers review r6 of the RH design
([`rh_design_review_r6_sol61.md`](rh_design_review_r6_sol61.md), ao-69, NOT-SOUND) for the fit round only,
after the owner split the fit round out (2026-10-22 19:57). RH-A and RH-B stay design-only; a Herdr `stop`
keeps answering `unknown` and closes nothing (OD-19 (a)).

This file replaces the fit parts of [RH design r6](rh_design_r6_opus.md) (sections 5, 6 and the fit row of 7).
It is self-contained: an implementer needs this file, the fixtures it names (all under
`development/artifacts/herdr_095_live_check/`) and the code at `541becfb`. Line numbers are those of
`541becfb` (the `packages/` tree is equal to `9f37813a`).

No measurement was made for r7 (section 15).

## 0. Review findings and their state in r7

| Finding | What the review requires (short) | State in r7 | Section |
| --- | --- | --- | --- |
| r6 **M-1** (F-4 retained pane invisible to core rollback) | A structured partial-create failure that carries the handle and the cleanup evidence to core; worker and orchestrator rollback keep the worktree, the prepared agent session and an ownership-checked failed-launch record with the partial handle whenever the stop is not confirmed; end-to-end tests (failure before the command submission, a timeout after admission, a refused or replaced cleanup) with zero unbound closes and zero removals on uncertainty | **Answered.** `RuntimeCreatePartialError` (core) carries the handle and the stage; runtime-herdr throws it for every failure after a workspace may exist; core writes the partial handle into its own record, then stops through `stopRuntime` (Herdr: `unknown`), so nothing is removed and the record gets `launchFailed`. Restore records a partial handle too. Record state and recovery named | 5.4 |
| r6 **M-2** (startup routes around the death checks) | Select old Herdr records for the startup check independently of status and activity; the isolated core path gets the guard before it reserves; when `ao start` refuses, the message, the recovery; tests: persisted `killed`/`runtime`, hidden live old server, unreachable pin, healthy caller endpoint, CLI and direct core, both modes, enrichment to `exited`; no new runtime, no reservation | **Answered.** Guard G in core `spawnOrchestrator`, before its first write, reads every active orchestrator record of the project from disk (not `list()`); one shared core classifier decides for core and CLI; message M; owner recovery through F-9 (or by hand, OQ-F2) | 5.7, 5.9 |
| r6 **m-1** (two evidence claims) | Correct the EOF interval wording; supply or withdraw the `node:ffi` claim | **Corrected**: 0.01 to 0.22 ms in the 10 samples, a sample and not a bound. The `node:ffi` probe was not saved: the claim is withdrawn as not retained | 13 |
| r6 **m-2** (spawn preflight caller) | Add `cli/src/commands/spawn.ts` to F-7 with a test against a selected binary and endpoint that differ from the ambient ones | **Answered.** A runtime's own `preflight()` (optional `Runtime` method) checks exactly what its `create()` will use; `ao spawn` and `ao start` call it for the selected runtime | 5.7 |
| r6 **OQ-14** (reachable missing or replaced pane at startup) | Reviewer prefers (b): no such answer is startup authority | **Put to the owner** as OQ-F1 with the residual of each option; one constant selects the branch | 5.7, 14 |
| r6 fit row F-1 | Add no-server tests through terminal-record startup | T-7.1, T-7.4 | 5.1, 5.7 |
| r6 fit row F-2 | The synthesized session-name handle makes no call | T-2.3 | 5.2 |
| r6 fit row F-3 | The later-poll test names the polling stage and asserts every prompt and raw-input call | T-3.3, T-3.4 | 5.3 |
| r6 fit row F-4 | Partial failure through core rollback, timeout after admission | = M-1 | 5.4 |
| r6 fit row F-5 | Good as designed | unchanged | 5.5 |
| r6 fit row F-6 | All four agents and OpenCode's second call site; a path pin is not a content or run identity | T-6.9, T-6.10; stated in 4.4 | 5.6 |
| r6 fit row F-7 | Status-independent selection, direct-core guard, stronger replacement predicate, spawn caller; a preflight is never death evidence; reuse never depends on the caller's endpoint | = M-2, m-2, the startup part of M-3 | 5.7 |
| r6 fit row F-8 | Sync the R4 table, `CLAUDE.md` and comments after the implementation | 5.8, 8 | 5.8 |
| r5 M-2 (partly closed in r6) | Keep the runtime resources through core rollback | = M-1 | 5.4 |
| r5 M-4 (partly closed in r6) | Status and isolated bypass, terminal-liveness authority, OQ-14 | G and OQ-F1; the S-based part is RH | 5.7, 12 |
| r6 **B-1**, **B-2**, **M-3** | RH findings | **Deferred** to a later RH round (one line each on what it must answer) | 12 |

## 1. Results

1. **Nine items, F-1 to F-9.** F-1 to F-8 are r6's items with the review r6 corrections. F-9 (the owner's
   retire action for a Herdr record) is new and depends on OQ-F2.
2. **M-1 (F-4).** A failed Herdr create closes nothing and never loses its resources: the plugin throws a
   typed partial-create error with the handle of what may exist; core writes that handle into its own record
   and stops it through the normal stop, which for Herdr answers `unknown`. The worktree, the prepared agent
   session, the record (with `launchFailed`) and the prompt file stay. Only a failure that proves that no
   workspace exists keeps today's rollback.
3. **M-2 (F-7).** Startup selects old Herdr orchestrator records from disk, whatever their status, activity,
   `killedReason` or `launchFailed`. Before RH, no Herdr answer proves that a launch ended (OQ-F1 (b)): `ao
   start` and direct `spawnOrchestrator` refuse, before any write, while such a record is neither reused nor
   retired. The message names the record, the pane, the socket and the next action.
4. **The no-server code** is mapped for Herdr (W-6), and its contract changes: it proves "no session" only
   for runtimes outside `LAUNCH_END_UNPROVEN_RUNTIMES` (`herdr`). tmux, and every test runtime, keep their
   behavior.
5. **m-2.** `ao spawn` and `ao start` ask the selected runtime's own `preflight()`, so the readiness check
   uses the binary and endpoint that `create()` will pin.
6. **Size: 17 product files** (16 with a behavior change, one comment-only), about 1,100 product lines and
   2,000 test lines, 8 commits. That is M+ (larger than r6's M): M-1 adds core rollback, M-2 adds the startup
   guard, F-9 adds a command option.

## 2. Scope

### 2.1 Step 1 defects (live check section 10)

| W | Defect | Item | In this round |
| --- | --- | --- | --- |
| W-1 | `isAlive` rejects for the 0.9.5 `pane_not_found` on stderr (`closedpane_pane_get`, `closedws_pane_get`) | F-1 | fixed |
| W-2 | `getHerdrPaneProcesses` rejects for the 0.9.5 `pane_not_found` (`closedpane_pane_process_info`) | F-1 | fixed |
| W-3 | `blocked` counts as settled; `agent_blocked` from `agent prompt`; a forced restore hides it; `ao send` prints a stack trace (`blocked_herdr_agent_prompt`, `ao_send_blocked`) | F-3 | fixed |
| W-4 | A short turn from `done` can be delivered up to 3 times (`shortturn_ao_send_from_done`) | none | **deferred** to the later send round (r6 OQ-5) |
| W-5a | The create cleanup closes the workspace without a check (`index.ts:365-369`) | F-4 | fixed, with M-1 |
| W-5b | `destroy` closes without a check and swallows every error (`index.ts:395-407`) | F-5 | fixed |
| W-6 | No server: `server_not_running` on stderr, not mapped (`noserver_never_pane_get`) | F-1, F-7 | fixed |
| W-7 | `getOutput` comment: `recent-unwrapped` returns shell text (`otherterm_pane_read_recent_unwrapped`) | F-8 | fixed (comment) |
| W-8 | A record without a handle gets a session-name handle; herdr is called with it (`badid_pane_process_info_session_name`) | F-2 | fixed |
| W-9 | Comment: pane IDs "can be reused after a workspace is closed" | F-8 | fixed (comment) |

Further items: F-6 (the pins, r5 M-3), F-7 (startup, r5 M-4 and r6 M-2), F-9 (the owner's retire action,
OQ-F2).

### 2.2 What the round does not touch

RH stays design-only: no launch identity S, no observation domain, no connected-socket guard, no socket
client, no `absent` or `destroyed` from the Herdr stop, no S-based `isAlive` (RH-2), no bound agent check.
The Herdr `stop` (`index.ts:418-433`) keeps answering `unknown`; after the round, no AO code path sends
`pane close` or `workspace close`. Review r6 B-1, B-2 and M-3 stay open (section 12). W-4 stays open.

## 3. The facts this round uses

### 3.1 CLI answers on 0.9.5

| Form | When | Fixtures |
| --- | --- | --- |
| exit 0, the result envelope on stdout | success | `live_*`, `ao_status_1_pane_get` |
| **exit 1, empty stdout, one stderr line `{"id":<command ID>,"error":{"code":...,"message":...}}`** (key order varies) | an error that the server answered, and the CLI's own `server_not_running` and `protocol_mismatch` | `closedpane_pane_get`, `closedpane_pane_process_info`, `closedpane_pane_run`, `blocked_herdr_agent_prompt` (`error` before `id`), `noserver_never_pane_get`, `noserver_never_workspace_create`, `r5_b_ping_protocol_19` |
| exit 1, Rust debug text on stderr | `EACCES`, a garbage or partial answer, a closed connection | `r5_c_socket_mode_000_cli`, `r5_b0_status_server_json` |
| exit 0, the error envelope on stdout | 0.8.0 (still accepted, R4 contract) | R4 tests |

The command IDs (measured):

| CLI call | `id` | Fixture |
| --- | --- | --- |
| `pane get` | `cli:pane:get` | `closedpane_pane_get` |
| `pane process-info` | `cli:pane:process_info` | `closedpane_pane_process_info` |
| `pane read` | `cli:pane:read` | `closedpane_pane_read_visible` |
| `pane run`, `pane send-text`, `pane send-keys` | `cli:request` | `closedpane_pane_run`, `closedpane_pane_send_text`, `closedpane_pane_send_keys` |
| `agent prompt` | `cli:agent:prompt` | `closedpane_agent_prompt`, `blocked_herdr_agent_prompt` |
| `workspace create` | `cli:workspace:create` | `noserver_never_workspace_create` |
| `workspace close`, `pane close` | `cli:workspace:close`, `cli:pane:close` | `noserver_never_workspace_close`, `closedws_pane_close` (no AO caller after F-5) |

The CLI's no-server message starts with `no herdr server is running at ` (`noserver_never_pane_get`,
`r5_c_stale_socket_file_cli`). A server that sends `server_not_running` itself is passed through by the CLI
with its own message (`r5_b_pane_get_server_not_running_from_server`: `fake server says so`, no prefix).
A pane operation is a ping connection, then the request connection; a call whose ping fails sends no request
(`r5_b_cli_forms_log`, `r5_b0_requests_log`).

### 3.2 `herdr status server --json`

Exit 0 with and without a server. With one: `"running":true`, `version`, `protocol`, `socket`
(`closedpane_status_server_json`). Without: `"running":false`, `version` null, `socket`
(`noserver_never_status_server_json`). A fake server that answers the ping wrongly: exit 1, Rust text
(`r5_b0_status_server_json`). The socket comes from this order: `--session`, `HERDR_SOCKET_PATH`,
`HERDR_SESSION`, `$XDG_CONFIG_HOME/herdr/herdr.sock`, `$HOME/.config/herdr/herdr.sock` (`r5_path_*`). AO never
passes `--session`, so `HERDR_SOCKET_PATH` in the call's environment decides.

### 3.3 IDs, restarts, launches

- Pane IDs `w<n>:p<m>`, each number bijective base 32 over `123456789ABCDEFGHJKMNPQRSTVWXYZ0`. Measured
  through `w0`, `w11` (`ids/workspace_create_g32.json`, `g33.json`) and `p1`..`pZ`, `p0`, `p11`..`p13`
  (`r6_f_pane_counter_log`). Longer IDs are an extrapolation of the same rule.
- No reuse within one server run. After a restart, the server restores the workspaces with the same pane
  IDs and a new `terminal_id` (step 1 section 5.3, `otherterm_pane_get`, `r6_c_race_log`).
- `pane run` submits the command by pane ID only, with no expected shell or terminal (`r5_b_cli_forms_log`,
  `b_req_pane_run`). So a restart between `workspace create` and `pane run` can start the agent in the
  restored pane of the new server.

### 3.4 Code facts

- Runtime plugins get no config from the registry: `loadBuiltins` and `loadFromConfig` call `register(mod)`
  (`core/src/plugin-registry.ts:449`, `:510`), which calls `create(undefined)` (`:409-411`). So the herdr
  `binPath` is `herdr` on every registry path; only a direct `create({ binPath })` (the tests) sets it.
- Core never calls `Runtime.destroy` for a runtime with `stop` (`core/src/runtime-stop.ts`, `stopOrThrow`).
- Every core create site: worker `session-manager.ts:2265`, orchestrator `:2828`, restore `:4535`.
- `ensureHandleAndEnrich` gives a record without a handle the handle `{id: <session name>}`
  (`session-manager.ts:1482-1487`); list enrichment writes `killed` in memory on `isAlive` false (`:1532-1539`).
- `ao start` reuses non-terminal orchestrator records whose liveness is alive or unchecked, and calls
  `spawnOrchestrator` when none is (`cli/src/commands/start.ts:997-1078`); core project mode archives or
  deletes an old record without a stop when `isOrchestratorRuntimeAlive` is false (`session-manager.ts:2552-2559`,
  `:2582-2590`); isolated mode reserves the next ID with no look at older records (`:2599-2606`).
- The lifecycle persists `killed` (`killedReason=runtime`) after "no-server" answers for `NO_SERVER_BOUND_MS`
  (`lifecycle-manager.ts:1577-1588`), and after two non-authoritative negatives (`:1590-1605`). It runs no
  kill, cleanup or restore by itself.

## 4. Shared definitions (core)

### 4.1 The F1 reader (`core/src/herdr.ts`, new export `readHerdrCliFailure`)

`readHerdrCliFailure(err, expectedId)` returns `{ code, message }` only for this form, else `null`:

- `err` is an object with the numeric `code` 1, no `signal`, and `killed` not `true` (not a timeout);
- `err.stdout` is the empty string;
- `err.stderr` is a string; after the removal of one trailing `\n`, it has no `\n` and no `\r`;
- it parses as a JSON object (not an array, not null) with exactly the keys `id` and `error`;
- `id` equals `expectedId` (an empty `id` or another command's ID fails);
- `error` is an object with exactly the keys `code` (a non-empty string) and `message` (a string).

`isHerdrNoServer(failure)`: `code` is `server_not_running` and `message` starts with
`no herdr server is running at `. The CLI drops trailing server lines (`r5_b_pane_get_two_lines`), so F1
trusts the CLI boundary; it does not qualify the wire.

### 4.2 The command ID table (`core/src/herdr.ts`, new export `HERDR_CLI_IDS`)

A map from the first two CLI words to the ID of 3.1: `pane get`, `pane process-info`, `pane read`,
`pane run`, `pane send-text`, `pane send-keys`, `agent prompt`, `workspace create`. Every AO call names its
expected ID from this table. A call that is not in the table gets no F1 classification.

### 4.3 The pane ID grammar (`core/src/herdr.ts`, new exports `HERDR_PANE_ID_RE`, `isHerdrPaneId`)

`^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$` (the alphabet of 3.3; lowercase `w` and `p`; no space, no
newline). Workspace IDs: `^w[0-9A-HJKMNP-TV-Z]+$`.

### 4.4 The pins (`core/src/herdr.ts`, new exports `resolveHerdrEndpoint`, `herdrInvocationFor`)

`resolveHerdrEndpoint({ binPath, env })`:

1. **The binary.** `binPath` absolute: normalize it; it must be a regular file with an execute bit
   (`statSync`, `accessSync(X_OK)`). `binPath` a bare name (default `herdr`): search the absolute directories
   of `env.PATH` in order (skip empty and relative entries) for such a file; keep the absolute path; do not
   resolve symlinks. `binPath` relative with a slash: reject with a message that names the setting (no guess
   from the cwd). Not found: reject ("herdr is not installed ...").
2. **The endpoint.** `<bin> status server --json` with `env`, 10 s limit. Exit 0 and a JSON object with a
   boolean `running` and a `socket` string that is absolute and has no control character; else reject
   ("herdr status server answered ..."). Returns `{ bin, socket, running }`.

The handle of a new create stores `herdrBin` and `herdrSocket` in `handle.data`.

`herdrInvocationFor(handle, legacyBin)`:

- both keys present, strings, absolute, no control character: `{ bin: herdrBin, env: { ...process.env,
  HERDR_SOCKET_PATH: herdrSocket } }`;
- neither key (every record made before the round): `{ bin: legacyBin, env: undefined }` (today's call,
  documented as environment-dependent);
- anything else (one key, a relative path, a newline, a non-string): throw `HerdrPinError` ("the herdr pins
  of this record are malformed: ..."). The caller makes no call.

A path pin is not a content pin (the file at the path can change) and not a server-run identity (another
server can listen at the same path later). It removes the dependence on the caller's `PATH` and herdr
environment, nothing more.

### 4.5 Error types (`core/src/runtime-errors.ts`, new file, exported from `index.ts`)

Each has a stable `code` and a guard that also accepts an error from another copy of core (by `code` and
shape), as `isRuntimeStopUnconfirmedError` does.

| Class | `code` | Fields | Thrown by |
| --- | --- | --- | --- |
| `RuntimeCreatePartialError` | `ERR_RUNTIME_CREATE_PARTIAL` | `handle: RuntimeHandle` (what may exist), `stage: "workspace-unconfirmed" \| "launch-not-submitted" \| "launch-refused" \| "launch-unconfirmed"`, `closed: "nothing"`, `cause` | `Runtime.create` (runtime-herdr) |
| `RuntimeSendRefusedError` | `ERR_RUNTIME_SEND_REFUSED` | `reason: "agent_blocked"`, `admitted: "none" \| "earlier-attempt-unconfirmed"`, `target` (pane ID), `stage` (text) | `Runtime.sendMessage` (runtime-herdr) |
| `OrchestratorStartBlockedError` | `ERR_ORCHESTRATOR_START_BLOCKED` | `projectId`, `blocking: BlockingLaunch[]` (5.7) | `spawnOrchestrator` (core) |

### 4.6 Constants and the no-server contract (`core/src/types.ts`)

- `LAUNCH_END_UNPROVEN_RUNTIMES: ReadonlySet<string> = new Set(["herdr"])`: runtimes whose answers do not
  prove at startup that a launch ended (a server can run where the endpoint does not reach it; pane IDs come
  back after a restart).
- `HERDR_NEGATIVE_RETIRES_AT_STARTUP: boolean`: `false` for OQ-F1 (b) (recommended), `true` for (a).
- The `Runtime.isAlive` doc (`types.ts:324-333`) and the `RUNTIME_NO_SERVER_ERROR_CODE` doc (`:129-133`) say:
  "no server answers at the runtime's endpoint. For a runtime outside `LAUNCH_END_UNPROVEN_RUNTIMES` (tmux),
  no session can exist then. For herdr a server can still run where the endpoint does not reach it, so the
  code is no proof that a session ended."
- Optional `Runtime.preflight?(): Promise<void>`: "Check that `create()` can start a session now, with
  exactly the binary and endpoint that `create()` will use. Throws a message for the operator. A readiness
  check: never evidence about an existing session."

## 5. The items

Each item: files and functions, the behavior before and after, the oracle changes (old oracle → new oracle),
and the acceptance tests with their expected results. "Zero calls" means zero `execFile` calls of the herdr
binary, counted by the test's stand-in.

### 5.1 F-1: the 0.9.5 failure form (W-1, W-2, W-6)

**Files and functions.** core `herdr.ts` (`readHerdrCliFailure`, `isHerdrNoServer`, `HERDR_CLI_IDS`,
`getHerdrPaneProcesses`, `herdrCannotAnswer`); runtime-herdr `index.ts` (`herdr`, `herdrResult`,
`getPaneStrict`); core `types.ts` (contract text, 4.6).

**Before.** A 0.9.5 error answer makes `execFile` reject; the rejection has no `herdrCode` and no `code`.
`isAlive` of a closed pane rejects; `getHerdrPaneProcesses` of a closed pane rejects; no-server rejects
without `RUNTIME_NO_SERVER_ERROR_CODE`.

**After.**

- runtime-herdr `herdr(expectedId, ...)` and `herdrResult(expectedId, ...)`: on a rejection, the F1 reader
  with the call's ID. An F1 failure throws `Error("herdr error <code>: <message>", { cause })` with
  `herdrCode` = the code, and `code` = `RUNTIME_NO_SERVER_ERROR_CODE` when `isHerdrNoServer`. Any other
  rejection is thrown as it is: no `herdrCode`, and its `code` stays `execFile`'s own (an exit number or an
  errno name), never `RUNTIME_NO_SERVER_ERROR_CODE`. The success branch and the 0.8.0 exit-0 branch
  (`parseHerdrResult`) are unchanged; a successful `pane read` stays raw text.
- `getPaneStrict`: `pane_not_found` from either channel gives `null` (unchanged rule: only `herdrCode`). Its
  wrapper error copies `code` `RUNTIME_NO_SERVER_ERROR_CODE` from the cause to its own top level, because
  the lifecycle and startup read `err.code`.
- core `getHerdrPaneProcesses`: on a rejection, the F1 reader with `cli:pane:process_info`: `pane_not_found`
  gives `[]`; no-server rejects through `herdrCannotAnswer` with `code` `RUNTIME_NO_SERVER_ERROR_CODE`; every
  other failure rejects as today.
- R4 row 8 and row 9 get the new text of section 8.

**Meaning of no-server.** It means "no listener answers at the selected path". With F-7, it never decides
startup for Herdr. The lifecycle keeps its outage rule: `killed` (`runtime`) after `NO_SERVER_BOUND_MS`. That
is a status for `ao status`; F-7 makes sure that no status is startup authority for a Herdr record, and the
kill, cleanup and restore of a Herdr record already refuse (stop `unknown`).

**Oracle changes.** None. The R4 near misses keep their oracles because they fail the F1 form:
`core/src/__tests__/herdr.test.ts:163` (stderr without `id`, code `server_unavailable`), `:173`
(`pane_not_found` on stdout with exit 1), runtime-herdr `index.test.ts:449` (an `Error` without exit code
and stderr), `:476` (stderr without `id`).

**Acceptance tests.**

| ID | Test | Expected |
| --- | --- | --- |
| T-1.1 | Fixture lines `closedpane_pane_get`, `closedws_pane_get` as rejections (code 1, empty stdout, the stderr line) | `isAlive` false |
| T-1.2 | `closedpane_pane_process_info`, `closedws_pane_process_info` | `getHerdrPaneProcesses` `[]`; `isHerdrProcessRunning` false |
| T-1.3 | `noserver_never_pane_get`, `noserver_stopped_pane_process_info` | reject with `code` `RUNTIME_NO_SERVER_ERROR_CODE` (row 9 through `getPaneStrict`, row 8 through `herdrCannotAnswer`) |
| T-1.4 | Near misses of the form, each for rows 8 and 9: stdout not empty; two stderr lines; exit 2; a signal; `killed: true`; a `result` key; `id` `""`; `id` `cli:pane:get` on row 8 and `cli:pane:process_info` on row 9; `error` null, an array, without `code`, with an extra key; `r5_c_socket_mode_000_cli` (Rust `EACCES` text) | reject; no `herdrCode`; no no-server code |
| T-1.4b | The F1 form with another code: `r5_b_ping_protocol_19` (`protocol_mismatch`, the CLI's own refusal); `server_unavailable`; `r5_b_pane_get_server_not_running_from_server` (`server_not_running` without the prefix) | reject (no `false`, no `[]`); `herdrCode` is that code; no no-server code |
| T-1.5 | The 0.8.0 controls (exit 0 envelopes) | unchanged results |
| T-1.6 | Lifecycle with the real plugin (pattern of `lifecycle-pane-envelope.test.ts`): app-1 `pane get` answers the F1 `pane_not_found` line | `killed` after two polls (as the 0.8.0 control) |
| T-1.7 | Same, F1 no-server | probe outcome "no-server"; the status stays below `NO_SERVER_BOUND_MS`; `killed` (`runtime`) after it, with two polls |

### 5.2 F-2: the pane ID grammar (W-8)

**Files and functions.** core `herdr.ts` (`getHerdrPaneProcesses`); runtime-herdr `index.ts` (`isAlive`,
`getPaneStrict`, `sendMessage`, `getOutput`, `create`).

**Before.** Any string goes to herdr: the lifecycle and `list()` call `pane process-info --pane aohd-1` for
a session-name handle.

**After.** Every pane call checks `isHerdrPaneId` first, with no call on a failure:

| Reader | Empty ID | Non-empty ID outside the grammar |
| --- | --- | --- |
| row 8, `getHerdrPaneProcesses` | `[]` (R4, unchanged) | reject ("not a herdr pane ID") |
| row 9, `isAlive` | reject | reject |
| `sendMessage` | reject | reject |
| `getOutput` | `""` | `""` |
| `create` (the root pane of the `workspace create` answer) | partial create (F-4, `workspace-unconfirmed`) | partial create |

The agents keep their `handle.id` test (`&& handle.id`): an empty ID does not reach core and rejects in the
agent, as today.

**Oracle changes.** None (no current test uses a non-grammar ID with an expected call).

**Acceptance tests.**

| ID | Test | Expected |
| --- | --- | --- |
| T-2.1 | `aohd-1`, `w1m:p1`, `wI:p1`, `w1:pL`, `W1:p1`, ` w1:p1`, `w1:p1 `, `w1:p1\n`, `w1:p` | zero calls; the results of the table |
| T-2.2 | `w1R:p1`, `w0:p1`, `w11:p13`, `w4:p0`, `w1P:pZ` | the call is made |
| T-2.3 | Real core `list()` and one lifecycle poll with a record without a handle, on a Herdr project (the session-name handle) | zero herdr calls; the status is kept |

### 5.3 F-3: a blocked agent is a refusal (W-3)

**Files and functions.** runtime-herdr `index.ts` (`SETTLED_STATES` `:62`, `waitForSettledAgent`,
`sendMessage` `:447-477`); core `runtime-errors.ts`; core `session-manager.ts` (send retry `:4005-4027`);
CLI `send.ts` (`:355-359`).

**Before.** `blocked` counts as settled, so AO prompts a blocked agent; herdr answers `agent_blocked` (exit
1); core then forces a restore, which refuses, and `ao send` prints a stack trace that names the restore
(`ao_send_blocked`).

**After.**

- `SETTLED_STATES` = `idle`, `done`.
- `waitForSettledAgent` stops at the first poll that shows the agent `blocked` and reports it.
- `sendMessage` throws `RuntimeSendRefusedError` with `reason` `agent_blocked` when: (1) the first settle
  wait sees `blocked` (`admitted` `none`); (2) an `agent prompt` answers the F1 `agent_blocked` (`admitted`
  `none` for attempt 1, `earlier-attempt-unconfirmed` after an earlier prompt of this call); (3) the settle
  wait after a prompt sees `blocked` (`earlier-attempt-unconfirmed`). `stage` names the step ("first settle
  wait", "agent prompt, attempt n", "settle wait after attempt n").
- After a refusal there is no `send-text` and no `send-keys` (raw text and Enter could answer the agent's
  permission prompt).
- In `promptWasConsumed` (from `idle`), `blocked` stays "consumed" (the agent took the prompt and asks for a
  permission); that is a delivery, not a refusal.
- core `send` (`:4007`): a `RuntimeSendRefusedError` is thrown as it is, before the restore retry. Other
  errors keep the retry.
- CLI `send.ts:356`: a `try` around `sessionManager.send`; a refusal prints one line to stderr and exits 1:
  `ao send: <session>: not sent: the agent in herdr pane <pane> is blocked and waits for input
  (agent_blocked). Answer it in the pane (ao session attach <session>), then send again.` With
  `earlier-attempt-unconfirmed` the line adds: `An earlier prompt of this send may have been delivered; check
  the pane before you send again.` No stack trace.

**Oracle changes.**

| Test | Old oracle | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:304` "treats blocked as settled — a prompt is how you answer a blocked agent" | `agent prompt` is sent to a blocked agent | refusal `agent_blocked`, `admitted` `none`; zero `agent prompt`, zero `send-text`, zero `send-keys` |

**Acceptance tests.**

| ID | Test | Expected |
| --- | --- | --- |
| T-3.1 | The first settle poll answers `blocked` | refusal, `admitted` `none`, `stage` "first settle wait"; zero prompt, zero raw input |
| T-3.2 | Gate `idle`, attempt 1 `agent prompt` answers the `blocked_herdr_agent_prompt` line | refusal, `none`; exactly one prompt; zero raw |
| T-3.3 | Attempt 1 prompt succeeds, no evidence of consumption, the settle wait after attempt 1 answers `blocked` | refusal, `earlier-attempt-unconfirmed`, `stage` "settle wait after attempt 1"; exactly one prompt; zero raw |
| T-3.4 | Attempt 2 `agent prompt` answers `agent_blocked` | refusal, `earlier-attempt-unconfirmed`, stage "agent prompt, attempt 2"; exactly two prompts; zero raw |
| T-3.5 | From `idle`, the consumption poll shows `blocked` | delivered (no error); one prompt |
| T-3.6 | core `send` with the refusal | zero `restore` calls; the error keeps its `code`; control: another send error keeps the one restore retry |
| T-3.7 | CLI `ao send` with the refusal from `sm.send` | exit 1; one stderr line with `agent_blocked` and the pane; no stack; nothing on stdout |

### 5.4 F-4: a failed create closes nothing and keeps everything (W-5a, review r6 M-1, r5 M-2)

**Files and functions.** runtime-herdr `index.ts` (`create` `:331-393`, `writeLaunchScript`); core
`runtime-errors.ts`; core `session-manager.ts` (worker catch `:2271-2276`, orchestrator catch `:2834-2837`,
`rollbackLaunch` `:1855-1941`, `keepUnconfirmedLaunch` `:1952-1992`, restore step 9 `:4533-4550`).

**Before.** A failed `pane run` closes the new workspace by its ID without a check (`:365`) and throws a
plain error. Core's catch calls `rollbackLaunch` without the runtime and the handle, so it skips the stop
gate, may discard the prepared agent session, destroys the worktree and releases the reservation. A
timed-out `pane run` may already have started the agent.

**After, the plugin.** `create` runs these steps (with F-6 pins and the F-2 grammar):

| Step | Failure | What may exist | Result |
| --- | --- | --- | --- |
| 1. `resolveHerdrEndpoint` (4.4) | any, or `running` false | nothing (no create sent) | a plain error ("no herdr server runs at <socket>; start one: herdr server", or the binary message) |
| 2. `workspace create` | the F1 form with `cli:workspace:create` (any code, also the CLI's no-server) | nothing: the server refused, or the CLI sent nothing | a plain error with `herdrCode` (and the no-server `code`) |
| | the 0.8.0 error envelope at exit 0 | nothing | a plain error (as today) |
| | a timeout, a signal, another exit, Rust text, a stderr that is not F1 | unknown: a workspace with the label may exist | partial, `workspace-unconfirmed`, handle `id` `""` |
| 3. the answer | no text `workspace_id` in the grammar, no root pane in the grammar of that workspace, no non-empty text `terminal_id` | probably a workspace | partial, `workspace-unconfirmed`, with what parsed |
| 4. `writeLaunchScript` | throws | the workspace and its shell | partial, `launch-not-submitted` |
| 5. `pane run P bash <script>` | the F1 no-server form (the CLI sent nothing) | the workspace, on a server that the pin does not reach | partial, `launch-not-submitted` |
| | another F1 code (the server refused, or the CLI refused, as with `protocol_mismatch`), or the 0.8.0 error envelope | the workspace, or a replaced pane | partial, `launch-refused` |
| | a timeout, a signal, Rust text, any other failure | the agent may run | partial, `launch-unconfirmed` |
| 6. `pane get P` after the run (new) | not the pane P with the terminal T of step 3: `pane_not_found`, another terminal (kept as `terminalAfterRun`), any failure | the agent may run, maybe on a replaced server (3.3) | partial, `launch-unconfirmed` |
| | P with T | | success: the handle |

The partial handle is the handle of a success (`id` P, `workspaceId`, `paneId`, `terminalId`, `sessionId`,
`workspacePath`, `createdAt`, `herdrBin`, `herdrSocket`) plus `createIncomplete: <stage>` (and
`terminalAfterRun` when step 6 saw another terminal). For `workspace-unconfirmed` it has `id` `""` and the
fields that parsed. The error message names the stage, the workspace, the pane, the terminal, the socket and
the cause (the F1 code, or "transport failure: <first stderr line>"), and says "AO closed nothing". For
`launch-not-submitted` and `launch-refused` the plugin removes its script file; for `launch-unconfirmed` it
leaves it (the script removes itself when it runs). No `workspace close` and no `pane close` exist in
`create` any more.

Step 6 is new: it makes a restart between `workspace create` and `pane run` (3.3) a visible failure instead of
a handle that names terminal T while the agent runs under another terminal. It is not a binding (review r6
B-2 stays open for RH): a restart after step 6 is not seen.

**After, core.** `rollbackLaunch` gets an optional `partialRecord`. Both create catches do this when
`isRuntimeCreatePartialError(err)`:

```ts
await rollbackLaunch({
  own, prepared, workspace: <as today>, runtime: plugins.runtime,
  handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle),
});
throw err;
```

`launchedRecordFor(handle)` is the record that the success path writes today (worker `:2307-2320`,
orchestrator `:2861-2872`), moved into a local function so that both paths write the same keys. With
`partialRecord`, `rollbackLaunch` first does:

1. `own.checkOrUnknown()`. Not `own` (gone, replaced, unknown): remove nothing (no stop, no agent session
   discard, no workspace destroy, no release); warn once with the handle (pane, workspace, socket), the
   worktree, the agent session and the record state; return `{ stopUnconfirmed: true }`.
2. `own.write({ ...partialRecord, runtimeHandle: JSON.stringify(handle), [RESERVATION_KEY]: "",
   launchFailed: "<cause>; the runtime create did not complete (<stage>)" })`. A failed write: as step 1.
3. Then the existing runtime step: `stopRuntime(runtime, handle)`. Herdr answers `unknown`, so
   `keepUnconfirmedLaunch` writes the final `launchFailed` (the cause, then the refusal) and the rollback ends
   with nothing removed. A confirmed stop (a later RH-B) continues with today's rollback.

The orchestrator's `rollbackOrchestratorLaunch` already keeps the prompt file when `stopUnconfirmed`.
Restore step 9: a partial error writes `{ status: "spawning", runtimeHandle: <partial>, restoredAt,
[RESERVATION_KEY]: "", launchFailed }` with `updateMetadataIf` on the restore's own launch identity, then
throws; a failed write adds "its runtime <pane> at <socket> was kept; check it by hand" to the error. A
plain error (nothing created) keeps today's paths everywhere.

**The record state: "kept failed launch".** An active record with `runtimeHandle` (the partial handle, with
`createIncomplete`), `launchFailed`, the launch's normal keys (`worktree`, `branch`, `agent`, `createdAt`,
`status` `spawning` for a worker, `working` for an orchestrator) and the prepared agent session's keys.
`ao status` shows it with `launch failed: ...` (`cli/src/commands/status.ts:230`). The worktree and the agent
session stay. Its stop answers `unknown`, so `ao session kill`, cleanup and restore refuse; `ao start` never
reuses it and refuses while it remains (F-7, G2 and G3).

**The owner's recovery.**

1. Read the record: `ao status` (the `launch failed` line names the pane, the workspace and the socket).
2. Check the pane with the pinned endpoint: `HERDR_SOCKET_PATH=<socket> <herdrBin> pane get <pane>` and
   `... pane process-info --pane <pane>`. For `workspace-unconfirmed`, look for a workspace with the
   session's label: `... workspace list`.
3. Close the pane by hand when it belongs to this launch (`... pane close <pane>`, or in the herdr UI).
4. Retire the record: with F-9, `ao session kill <session> --confirm-runtime-closed` (it removes the worktree
   and archives the record); without F-9, by hand (OQ-F2 (b)). Until one of them, the record and the worktree
   stay (as for every Herdr record before RH).

**Oracle changes.**

| Test | Old oracle | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:140` "closes the workspace when the launch fails, leaving nothing in the shared server" | `workspace close w7` after a failed `pane run` | zero `workspace close` and `pane close`; a `RuntimeCreatePartialError` (`launch-unconfirmed` for a plain `Error`) whose handle names `w7`, `w7:p1`, `term_abc` and the pins |
| runtime-herdr `index.test.ts:158` "throws when the response carries no usable pane" | rejects `/no usable pane/` | the same text, and the error is a partial, `workspace-unconfirmed`, with `workspaceId` `w7` (strengthened) |
| runtime-herdr `index.test.ts:99`, `:114`, `:129` (create calls) | `workspace create` is call 0, `pane run` call 1 | `status server --json` is call 0, `workspace create` call 1, `pane run` call 2, `pane get` call 3; the asserted arguments are unchanged; `:129` also asserts `herdrBin` and `herdrSocket` |
| core tests where `runtime.create` throws a plain error | today's rollback | unchanged (a plain error proves nothing was created only for the Herdr steps 1 and 2; core keeps today's rollback for every plain error) |

**Acceptance tests.** Plugin tests in runtime-herdr `index.test.ts`; end-to-end tests in a new runtime-herdr
file `src/__tests__/fit-create-rollback.test.ts` with the built core (`createSessionManager`), the real
plugin, a stand-in `herdr` through mocked `node:child_process` (the pattern of
`lifecycle-pane-envelope.test.ts`), a real worktree workspace plugin on a temp git repo, and an agent
stand-in with `prepareAgentSession` that records its discards.

| ID | Case | Expected |
| --- | --- | --- |
| T-4.1 | Plugin: each row of the step table | the stated result; zero `workspace close`, zero `pane close` in every row |
| T-4.2 | Worker, failure before the command submission: `writeLaunchScript` throws; and `pane run` answers the F1 no-server line | spawn rejects with the partial error; zero closes; the worktree exists; zero agent-session discards; the record exists with the partial handle, `launchFailed`, `status` `spawning`; its launch identity is the written one; `ao status` data shows `launchFailed` |
| T-4.3 | Worker, a timeout after admission: the stand-in records `pane run`, then rejects with `killed: true`, `signal: "SIGTERM"` | as T-4.2, stage `launch-unconfirmed`; the script file is kept |
| T-4.4 | Worker, refused or replaced: `pane run` answers the F1 `pane_not_found` line; and step 6 answers another terminal | as T-4.2, stages `launch-refused` and `launch-unconfirmed` (`terminalAfterRun` recorded) |
| T-4.5 | Orchestrator, project mode, T-4.2 to T-4.4 | the record `<prefix>-orchestrator` kept with the partial handle; the prompt file kept; the project directory untouched |
| T-4.6 | Orchestrator, isolated mode, T-4.3 | the worktree kept; the numbered record kept |
| T-4.7 | Another launch replaced the record during the create (the test rewrites the launch identity before `pane run` answers) | zero closes, zero removals, no write to the new record; one warning that names the pane, the socket, the worktree and the agent session |
| T-4.8 | Control: `workspace create` answers the F1 no-server line | today's rollback: the worktree removed, the reservation released, the created agent session discarded; zero herdr calls after `workspace create` |
| T-4.9 | Control: a successful create | the handle with the pins; one `pane get` after the run |
| T-4.10 | Restore of a record without a handle (Herdr), `pane run` times out | the record names the partial handle and `launchFailed`; nothing removed |
| T-4.11 | After T-4.3: `ao session kill <id>` (core `kill`) | refuses (stop `unknown`); the record and the worktree stay |

### 5.5 F-5: `destroy` refuses (W-5b)

**Files and functions.** runtime-herdr `index.ts` (`destroy` `:395-407`).

**Before.** `destroy` closes the recorded workspace (or the pane) without a check and swallows every error.
No core caller uses it.

**After.** `destroy` throws, with zero calls: "runtime-herdr destroy closes nothing: herdr reuses pane and
workspace IDs, so a close by ID could reach another terminal (same-ID R2a). Use the stop; close the
workspace by hand after you check it."

**Oracle changes** (deliberate; review r6 agrees with them; the owner decides them with OQ-6, section 14).

| Test | Old oracle | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:166` "closes the owned workspace, never the server" | `workspace close w7` | rejects; zero calls |
| `index.test.ts:175` "falls back to closing the pane when no workspace id was recorded" | `pane close w7:p1` | rejects; zero calls |
| `index.test.ts:183` "swallows errors when the workspace is already gone" | resolves | rejects; zero calls |
| `same-id-defects-r2.test.ts:108` N-1 `defect(...)` "destroy does not close the workspace or pane when the pane ID now names another terminal" | `it.fails` (red under `SAME_ID_DEFECTS=red`) | a plain `it` (fixed); the red count drops by 1 |
| `same-id-defects-r2.test.ts:121` control "destroy closes the recorded workspace while its pane has the recorded terminal" | closes `w7` | "destroy refuses and closes nothing, also with the recorded terminal": zero close calls |

**Acceptance tests.** T-5.1: `destroy` with a workspace ID, a pane ID only, an empty handle: rejects, zero
calls. T-5.2: the stop's `unknown` control (`index.test.ts:247`, "core stopRuntime uses it instead of
destroy: unknown, and no close") is unchanged.

### 5.6 F-6: the pins (r5 M-3)

**Files and functions.** core `herdr.ts` (`resolveHerdrEndpoint`, `herdrInvocationFor`,
`getHerdrPaneProcesses(target: string | RuntimeHandle)`, `isHerdrProcessRunning(target, re)`); runtime-herdr
`index.ts` (`create`, `herdr`, `herdrResult`, `readPane`, a new `preflight`); agents: claude-code
(`:617`), codex (`:581`), gemini (`:194`), opencode (`:661`, `:1340`); CLI `session.ts` (attach `:154-221`).

**Before.** Every call runs `herdr` (or the configured `binPath`) with the caller's `PATH` and environment,
so another `PATH`, `HERDR_SOCKET_PATH` or `HERDR_SESSION` reaches another binary or server.

**After.**

- `create` resolves the pins first (4.4 and F-4 step 1) and stores them in the handle.
- Every later call for the handle uses `herdrInvocationFor(handle, legacyBin)` (4.4): runtime-herdr
  (`isAlive`, `sendMessage`, `getOutput`), core rows 8 and 9, the agents' Herdr checks, and attach. A
  malformed pin rejects with zero calls (`getOutput`: `""` with zero calls).
- core `getHerdrPaneProcesses` and `isHerdrProcessRunning` accept a string (the public API of
  `core/src/index.ts`, unchanged: legacy behavior) or a handle (pins). The agents pass the handle:
  `isHerdrProcessRunning(handle, re)`, `getHerdrPaneProcesses(handle)`.
- attach: `spawn(bin, ["agent", "attach", target], { stdio: "inherit", env })` with the invocation of the
  handle; a malformed pin: exit 1 with the pin message, no spawn; a target outside the grammar: exit 1.
- runtime-herdr `preflight()`: `resolveHerdrEndpoint({ binPath, env: process.env })` with its own `binPath`;
  rejects when the binary is missing or `running` is false. Used by F-7.

**Oracle changes.** None. `index.test.ts:633` ("honours a custom binPath") and `:639` ("defaults to herdr on
PATH") use the legacy `HANDLE` (no pins) and keep their oracles. The gemini test (`index.test.ts:885`,
`bin` `herdr`) uses a legacy handle and keeps its oracle.

**Acceptance tests.**

| ID | Test | Expected |
| --- | --- | --- |
| T-6.1 | create: `PATH` has a stand-in `herdr` in a temp directory | `status server --json` runs with that absolute path; the handle has it as `herdrBin` and the answer's socket as `herdrSocket` |
| T-6.2 | `PATH` changed after the create | later calls run `herdrBin` |
| T-6.3 | `HERDR_SOCKET_PATH` and `HERDR_SESSION` of the caller changed after the create | every call has `HERDR_SOCKET_PATH=<herdrSocket>` |
| T-6.4 | `binPath` `./bin/herdr`; a bare name not on `PATH`; an absolute path that is a directory or not executable | create rejects naming the cause; zero calls of any `herdr` |
| T-6.5 | `status server --json`: `running` false; `socket` relative, with `\n`, missing; not JSON; exit 1 Rust text (`r5_b0_status_server_json`) | create rejects before `workspace create` |
| T-6.6 | A legacy handle (no keys) | today's call (`binPath` or `herdr`, no env override) |
| T-6.7 | One key; a relative key; a key with a control character; a number | `isAlive`, `sendMessage`, rows 8 and 9 reject with zero calls; `getOutput` `""` with zero calls |
| T-6.8 | attach with pins; legacy; malformed | `spawn` of `herdrBin` with the env; `herdr`; exit 1, no spawn |
| T-6.9 | Each of the four agents' `isProcessRunning` with a pinned handle (core built, `node:child_process` mocked) | the call runs `herdrBin` with `HERDR_SOCKET_PATH`; a legacy handle runs `herdr` |
| T-6.10 | opencode `findPaneOpenCodeProcess` (`:661`, the send and launch checks) with a pinned handle | as T-6.9 |

### 5.7 F-7: startup keeps every old Herdr launch it cannot prove ended (r5 M-4, r6 M-2, startup part of r6 M-3, m-2, OQ-14)

**Files and functions.** core `types.ts` (4.6); core `session-manager.ts` (`isOrchestratorRuntimeAlive`
`:562-584` replaced by `classifyOrchestratorLiveness`; `spawnOrchestrator` `:2419-2911`: the guard G, the
project-mode branches `:2508-2597`); core `runtime-errors.ts` (`OrchestratorStartBlockedError`); core
`runtime-stop.ts` (the no-server row of the fallback, `:221-224`); core `index.ts` (exports); CLI `start.ts`
(`checkOrchestratorLiveness` `:895-928`, `runStartup` `:934-1079`); CLI `lib/preflight.ts`; CLI `spawn.ts`
(`runSpawnPreflight` `:67-85`).

**Before.**

- The CLI selects reuse candidates after it drops terminal records (`start.ts:997-1001`): a Herdr
  orchestrator that the lifecycle wrote `killed` (outage rule, or two negatives), or that `list()` enriched to
  `killed` or `exited`, is never checked.
- No-server is "gone" for every runtime (`start.ts:923`, `session-manager.ts:572`).
- Core project mode archives or deletes an old record on `false` without a stop (`:2552-2559`, `:2582-2590`);
  isolated mode reserves a new ID with no look at old records (`:2599-2606`).
- `ao start` runs `ensureTmux` from `defaults.runtime` only (`start.ts:942`) and no Herdr preflight; `ao spawn`
  runs the ambient `checkHerdr()` (`spawn.ts:77`).

**After: the shared classifier (core, exported).**
`classifyOrchestratorLiveness(runtime | null, handle, record)` returns
`{ state: "alive" } | { state: "ended"; reason } | { state: "unknown"; reason; next? }`:

| Answer of `runtime.isAlive(handle)` | Runtime outside `LAUNCH_END_UNPROVEN_RUNTIMES` (tmux, test runtimes) | Herdr |
| --- | --- | --- |
| no runtime plugin loaded; a Herdr pin error | unknown | unknown |
| `true` | alive | alive |
| `false` | ended | ended only when `HERDR_NEGATIVE_RETIRES_AT_STARTUP` (OQ-F1 (a)) and the record has no `launchFailed`; else unknown |
| rejects with `RUNTIME_NO_SERVER_ERROR_CODE` | ended | unknown |
| rejects otherwise; not a boolean | unknown | unknown |

For Herdr, `next` is the recovery text of message M. Core uses it in place of `isOrchestratorRuntimeAlive`
(ended = the old `false`; unknown throws). The CLI's `checkOrchestratorLiveness` returns its states
(alive → alive, ended → gone, unknown → unknown), so core and CLI cannot disagree.

**After: the guard G (core `spawnOrchestrator`).** It runs after `sessionsDir` is known (`:2444`) and before
the first write (`validateAndStoreOrigin` `:2448`, and before `setupWorkspaceHooks` `:2488`), in both
workspace modes and for every strategy:

- **G1, selection.** List the active records of `sessionsDir` (`listRecordIds`; read each with
  `readRecordStrict`; a list or read error blocks with "the records could not be read"). Keep each record
  that `isOrchestratorSessionRecord(id, raw, prefix)` accepts and whose `runtimeHandle` parses to a handle
  whose `runtimeName` is in `LAUNCH_END_UNPROVEN_RUNTIMES`, **whatever its `status`, `activity`,
  `killedReason` or `launchFailed`**, and whatever the project's runtime is now. A record without
  `runtimeHandle`, or with a handle that does not parse, is not selected (today's "unchecked" rule).
  Retirement is only the archive (or delete) of a record. A `killed` status, also `killedReason=runtime` from
  the lifecycle's outage rule, is a status that a probe gave, not a retirement.
- **G2, reuse.** A selected record is not blocking only when (i) the classifier answers alive, it has no
  `launchFailed`, and it is the project-mode record (`<prefix>-orchestrator`) in project mode, which the
  existing branch then reuses (strategy `reuse` or `ignore`) or refuses (any other strategy: the stop answers
  `unknown`); or (ii) the classifier answers ended (only under OQ-F1 (a)).
- **G3, creation.** Any other selected record blocks: throw `OrchestratorStartBlockedError` with one
  `BlockingLaunch` per record (`sessionId`, `status`, `launchFailed` yes or no, `pane`, `workspace`,
  `socket`, `bin`, `answer`). Nothing is written: no `.origin`, no hooks, no reservation, no workspace, no
  runtime.

The project-mode branches after G use the classifier: alive as today; ended as today (archive or delete,
only for tmux, test runtimes, or Herdr under OQ-F1 (a)); unknown throws (for Herdr, the blocked error). The
concurrent branch (`:2564-2597`) does the same. G reads `isAlive` once per selected record; the project
branch reads again, and a changed answer can only make it refuse.

**After: the CLI (`start.ts`).**

1. `ensureTmux` runs when `project.runtime ?? config.defaults.runtime` is `tmux` (was `defaults.runtime`).
2. Reuse candidates as today, minus Herdr records with `launchFailed`.
3. `checkOrchestratorLiveness` uses the core classifier. A Herdr unknown prints its `next`.
4. When an orchestrator will be created (not with `--no-orchestrator`, no reuse, no unknown): the selected
   runtime's readiness check, before `spawnOrchestrator`: `preflight.checkSelectedRuntime(runtime, name)`
   (new in `lib/preflight.ts`): `tmux` → `checkTmux`; another runtime → `runtime.preflight?.()`.
5. An `OrchestratorStartBlockedError` from `spawnOrchestrator` prints message M (no "Starting a new one" line,
   no stack) and exits 1.

**After: `ao spawn` (`spawn.ts`, m-2).** `runSpawnPreflight` gets the registry's runtime instance for
`project.runtime ?? defaults.runtime` and calls `checkSelectedRuntime`. For Herdr that is the plugin's own
`preflight()`, with its own `binPath` and the process environment: the same inputs as its `create()`. It runs
before `sm.spawn`, so a failure makes no reservation and no worktree. `ao doctor` keeps the ambient
`checkHerdr()` (a diagnostic, not a gate).

**After: `runtime-stop.ts`.** The fallback's row "destroy resolves, `isAlive` rejects with no-server →
`destroyed`" applies only to a runtime outside `LAUNCH_END_UNPROVEN_RUNTIMES` (Herdr has `stop`, so this is a
guard for the contract of 4.6, not a behavior change today).

**When `ao start` refuses (OQ-F1 (b), recommended).** It refuses, before any write, when an active
orchestrator record of the project has a Herdr handle and is not reused: a record with any status (also
`killed`, `done`, `errored`) or activity (also `exited`), a record with `launchFailed`, a record whose pane
the pinned endpoint does not show (`pane_not_found`, another terminal), a record whose endpoint does not
answer (no server at the pin, a hidden or moved server), a record whose pins are malformed, and a live record
that is not reused (any ID other than `<prefix>-orchestrator` in project mode; in isolated mode, a record that
the CLI did not reuse because its status or activity is terminal, and any live record in a direct core call).
It does not refuse when the CLI reuses a live, non-terminal record without `launchFailed`, or when the
project-mode record `<prefix>-orchestrator` is live and has no `launchFailed` (its existing branch reuses it,
also with a terminal status, as today, or refuses through its stop). It does not look at tmux records
(today's rules). With `--no-orchestrator` it does neither.

**Message M** (`OrchestratorStartBlockedError.message`, printed as it is by `ao start`):

```text
No new orchestrator was started for project <project>: AO cannot tell that the launch of orchestrator <id> ended.
  <id>: status <status><, launch failed>; herdr pane <pane> (workspace <ws>) at <socket>: <answer>.
Before RH, AO takes no herdr answer as proof that a launch ended. It keeps the record and starts no second orchestrator.
Check the pane:  HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>
If the orchestrator still runs, use it:  ao session attach <id>
If it does not run, or after you close its pane, retire the record:  ao session kill <id> --confirm-runtime-closed
Then run ao start again.
```

One `<id>` line per blocking record. `<answer>` is one of: "herdr answered that the pane does not exist",
"herdr shows the pane with another terminal (<T'> instead of <T>)", "no herdr server answers at the socket",
"the herdr check failed: <first line>", "the pane runs, but the record is <status> / its launch failed",
"its herdr pins are malformed", "no herdr runtime plugin is loaded". Without F-9 (OQ-F2 (b)), the retire line
names the by-hand steps of 5.9.

**Owner recovery.** As in 5.4: check the pane at the pinned socket; if the orchestrator runs, attach and use
it (the lifecycle moves a `killed` record with `killedReason=runtime` back when its runtime answers alive);
if not, close the pane and retire the record (F-9); then `ao start`.

**Oracle changes.** None. The no-server tests use runtime `tmux` (`cli/__tests__/commands/start.test.ts:1033`
A1) or `mock` (`core/src/__tests__/session-manager/orchestrator-no-server-start.test.ts:52`, `:80`), which are
outside `LAUNCH_END_UNPROVEN_RUNTIMES`, so they keep "gone" and their new orchestrator. `preflight.test.ts`
(`checkHerdr`) keeps its oracles (doctor's check is unchanged).

**Acceptance tests.** Core tests in a new runtime-herdr file `src/__tests__/fit-startup.test.ts` (built core,
real plugin, stand-in `herdr` that answers by the `HERDR_SOCKET_PATH` of each call: the pinned old socket
answers as the case says; a call without it, the caller's endpoint, answers a healthy `status server --json`
and would accept `workspace create`). CLI tests in `start.test.ts` and `spawn.test.ts` (mocked core).

| ID | Case | Expected |
| --- | --- | --- |
| T-7.1 | Persisted record `status=killed`, `killedReason=runtime`, Herdr handle with pins; the pin answers the F1 no-server line (a hidden live old server is represented by no answer at the pin); a healthy caller endpoint; direct `spawnOrchestrator`; project mode and isolated mode | `OrchestratorStartBlockedError`; zero `workspace create`, zero `pane run`; the sessions directory listing and the old record are byte-equal before and after; no reservation, no `.origin` write, no prompt file, no worktree, no hooks write |
| T-7.2 | As T-7.1, the pin answers the F1 `pane_not_found` line; and another terminal | (b): as T-7.1. (a): project mode archives the record and creates; isolated mode creates `-N+1` |
| T-7.3 | As T-7.1 with a record `status=working` that `list()` enriches to `activity=exited` (the agent stand-in answers not running) before the selection, through the real `list()` then `spawnOrchestrator`, in project mode and isolated mode | as T-7.1 |
| T-7.4 | CLI `ao start`, the mocked `sm.list` gives the record of T-7.1 as `killed`; `sm.spawnOrchestrator` rejects with the blocked error | exit 1; stderr has message M; no "does not run ... Starting a new one" line; no "Orchestrator session created" |
| T-7.5 | A Herdr record with `launchFailed` whose pane is alive | not reused (CLI and core); blocked, both modes |
| T-7.6 | A non-terminal Herdr candidate whose pin answers no-server (CLI) | the CLI's unknown path, exit 1, with the Herdr `next`; `spawnOrchestrator` not called |
| T-7.7 | Control: a live non-terminal Herdr orchestrator, project mode, strategy `reuse` (CLI and direct core); and a live isolated one through the CLI | reused; no new runtime (unchanged) |
| T-7.7b | A live isolated Herdr orchestrator in a direct core `spawnOrchestrator`; and a live one with `status=killed` through the CLI, isolated mode | blocked (`answer`: the pane runs, but it is not reused) |
| T-7.8 | A Herdr record and a project whose runtime is now `tmux` | blocked |
| T-7.9 | A Herdr record with malformed pins | blocked; zero calls for it |
| T-7.10 | Control: tmux and `mock` no-server records | "gone" and a new orchestrator, as today (A1, defect-A tests) |
| T-7.11 | `ao start` on a Herdr project whose selected endpoint has no server, no old record | the plugin's `preflight()` rejects; exit 1 before `spawnOrchestrator`; no reservation |
| T-7.12 | `ao start --no-orchestrator` on that project | no preflight, no guard (unchanged) |
| T-7.13 | `ensureTmux` follows `project.runtime`: a Herdr project with `defaults.runtime: tmux`; a tmux project with `defaults.runtime: herdr` | no tmux check; a tmux check |
| T-7.14 | `ao spawn` on a Herdr project: the test registers a herdr runtime made with `create({ binPath })` that differs from the ambient `herdr`; its `preflight()` fails (selected endpoint unavailable) while the ambient `herdr` would pass | exit 1 with the plugin's message; the ambient `herdr` is never run; `sm.spawn` not called; no reservation, no worktree |
| T-7.15 | `ao spawn` on a tmux project | `checkTmux` as today |
| T-7.16 | `runtime-stop.ts`: a stop-less runtime named `herdr` whose `isAlive` rejects with no-server after a resolved destroy | `unknown` (control: a stop-less `mock` runtime keeps `destroyed`) |

### 5.8 F-8: comments and documents (W-7, W-9)

**Files.** runtime-herdr `index.ts` (`:16-18` and `:479-482`: `recent-unwrapped` returns the shell text of a
pane without an agent in the measured case, and `visible` is the fallback on an error or an empty or
whitespace-only answer; `:94-97`: 0.8.0 exit 0 and 0.9.5 exit 1 with stderr; `:384-386`: no reuse within a
server run, the same pane IDs with new terminals after a restart); core `herdr.ts` (`:37`, `:91-92`: the two
channels); core `lifecycle-manager.ts` (`:214-222`: since R4 the Herdr reads reject when they cannot answer;
the comment still says they answer false); `docs/DEVELOPMENT.md` (rows 8 and 9, section 8); `CLAUDE.md` (the
`isAlive` sentence, section 8). Review only: a reviewer reads each changed comment against the code.

### 5.9 F-9: the owner's retire action for a Herdr record (new, OQ-F2)

**Files and functions.** core `types.ts` (`SessionManager.kill` options `:1723`); core `session-manager.ts`
(`killRecord` `:3040-3227`); CLI `session.ts` (`session kill` `:224-247`).

**Why.** Before RH, the stop of every Herdr record answers `unknown`, so `ao session kill` can never retire
one. F-4 and F-7 add records that must be retired before `ao start` creates another orchestrator. Without an
AO action the owner edits the state root by hand (5.9.1), which skips AO's record lock and generation floor.

**After.** `ao session kill <session> --confirm-runtime-closed` (core `kill(id, { confirmRuntimeClosed:
true })`):

1. The record's handle must name a runtime in `LAUNCH_END_UNPROVEN_RUNTIMES`; otherwise refuse at once
   ("--confirm-runtime-closed is only for herdr records; the tmux stop confirms itself"), nothing changed.
2. `assertNoLiveLauncher` as today (no retire while a launch of the ID runs).
3. `stopRuntime` as today. Confirmed (a later RH): continue as a normal kill.
4. Unconfirmed: one `isAlive(handle)` read with the pins. `true`: refuse ("herdr shows pane <pane> with its
   terminal at <socket>: the session runs; close it first"), nothing changed. Anything else (`false`, any
   rejection, a pin error): the owner's statement decides. A conditional write on the launch identity adds
   `retiredBy=owner`, `retiredAt`, `retireEvidence=<answer>` to the record.
5. The rest of the kill as today: the worktree removal (`stopWhenReplaced` before each step), the OpenCode
   purge when asked, the archive.

Without the option nothing changes, except that the refusal of a Herdr kill adds the line "After you close
it, retire the record: ao session kill <id> --confirm-runtime-closed". `ao session cleanup`, restore and the
lifecycle never use it.

**Residual.** A wrong statement (a hidden server still runs the launch, so the pinned read does not show it)
removes the worktree under a live agent. The owner accepts this per command; AO refuses only when its own
read shows the pane alive.

**Acceptance tests.** T-9.1: Herdr record, `isAlive` true: refused; the record and the worktree are equal
before and after. T-9.2: `false`: archived (with `retiredBy=owner`), the worktree removed. T-9.3: the pin
answers no-server: archived, `retireEvidence` names it. T-9.4: a tmux record with the option: refused, nothing
changed. T-9.5: without the option: today's refusal plus the new line. T-9.6: a live launcher: refused. T-9.7:
a record replaced during the read: the kill stops, nothing removed. T-9.8: CLI: the option reaches core; exit
codes 0 and 1; the hint line.

#### 5.9.1 By hand (OQ-F2 (b), or before the round lands)

Stop the lifecycle worker of the project first. Close the pane in herdr. Move
`~/.agent-orchestrator/<hash>-<project>/sessions/<id>` to `.../sessions/archive/<id>_<UTC time with - for :
and .>`. Remove the worktree with `git worktree remove <worktree>` (isolated orchestrator and workers only).
These steps skip AO's record lock and its generation floor.

## 6. Files and count

| # | File | Items | Kind |
| --- | --- | --- | --- |
| 1 | `packages/core/src/herdr.ts` | F-1, F-2, F-6 | behavior |
| 2 | `packages/core/src/runtime-errors.ts` (new) | F-3, F-4, F-7 | behavior |
| 3 | `packages/core/src/types.ts` | F-1, F-6, F-7, F-9 | behavior and contract text |
| 4 | `packages/core/src/index.ts` | exports | API addition only |
| 5 | `packages/core/src/session-manager.ts` | F-3, F-4, F-7, F-9 | behavior |
| 6 | `packages/core/src/runtime-stop.ts` | F-7 | behavior (guard) |
| 7 | `packages/core/src/lifecycle-manager.ts` | F-8 | comment only |
| 8 | `packages/plugins/runtime-herdr/src/index.ts` | F-1 to F-6, F-8 | behavior |
| 9 | `packages/plugins/agent-claude-code/src/index.ts` | F-6 | behavior |
| 10 | `packages/plugins/agent-codex/src/index.ts` | F-6 | behavior |
| 11 | `packages/plugins/agent-gemini/src/index.ts` | F-6 | behavior |
| 12 | `packages/plugins/agent-opencode/src/index.ts` | F-6 (two call sites) | behavior |
| 13 | `packages/cli/src/commands/send.ts` | F-3 | behavior |
| 14 | `packages/cli/src/commands/start.ts` | F-7 | behavior |
| 15 | `packages/cli/src/commands/spawn.ts` | F-7 (m-2) | behavior |
| 16 | `packages/cli/src/commands/session.ts` | F-6, F-9 | behavior |
| 17 | `packages/cli/src/lib/preflight.ts` | F-7 | behavior |

**17 product files**: 16 with a behavior or API change, one comment-only. Without F-9 (OQ-F2 (b)) the count
stays 17 (F-9 touches files that other items touch). r6 counted 13; review r6 asked for at least 14 (with
`spawn.ts`); r7 adds `runtime-errors.ts` (M-1), `runtime-stop.ts` (the contract guard) and
`lifecycle-manager.ts` (the comment that r6 listed under F-8 but did not count).

Tests (new or changed): runtime-herdr `index.test.ts`, `same-id-defects-r2.test.ts`, new
`fit-create-rollback.test.ts`, new `fit-startup.test.ts`, `lifecycle-pane-envelope.test.ts` (T-1.6, T-1.7);
core `herdr.test.ts`, `runtime-stop.test.ts`, session-manager tests for send (T-3.6) and kill (T-9.x); the four
agents' `index.test.ts`; CLI `send.test.ts`, `start.test.ts`, `spawn.test.ts`, `session.test.ts`,
`lib/preflight.test.ts`. Docs: `docs/DEVELOPMENT.md`, `CLAUDE.md`, doc 0004.

## 7. Implementation order, commits, gates and size

One worker, one round, eight commits in this order. Each commit builds on the one before and keeps the tree
green.

| # | Commit | Items | Main tests |
| --- | --- | --- | --- |
| 1 | `feat(core): read the herdr 0.9.5 failure form and the pane ID grammar` | F-1, F-2 (core `herdr.ts`, runtime-herdr reads) | T-1.x, T-2.x |
| 2 | `feat(runtime-herdr): pin the herdr binary and socket per handle` | F-6 | T-6.x |
| 3 | `fix(runtime-herdr): destroy refuses` | F-5 | T-5.x and the oracle changes |
| 4 | `fix: keep the resources of a failed herdr create` | F-4 (plugin, `runtime-errors.ts`, core rollback, restore) | T-4.x |
| 5 | `fix: refuse a send to a blocked herdr agent` | F-3 | T-3.x |
| 6 | `fix: keep old herdr orchestrators at startup` | F-7 (classifier, G, CLI, spawn, preflight, runtime-stop) | T-7.x |
| 7 | `feat: retire a herdr record on the owner's word` | F-9 (only after OQ-F2 (a)) | T-9.x |
| 8 | `docs: the herdr 0.9.5 fit` | F-8 | review |

**Gates.**

- Each commit: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the tests of the changed packages, all under
  `env -i` with a scratch `HOME`.
- After commit 8: the full `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test`, the test run with a
  fake `HOME` (the root run includes the live OpenCode block).
- **`SAME_ID_DEFECTS=red pnpm test`** before commit 1 and after commit 8. The failing set after the round
  must be the set before it minus exactly the runtime-herdr N-1 test (`same-id-defects-r2.test.ts:108`). Any
  other change in the set fails the gate. Record both counts in the report.
- No live herdr run is part of the round's gate. A live check on a scratch server (the isolation of the
  step 2 brief) after the round is optional: create, a failed create (`pane run` to a stopped server), `ao
  start` with a `killed` record, F-9.

**Size.** About 1,100 product lines (F-4 about 250, F-7 about 300, F-1 and F-2 about 150, F-6 about 200,
F-3 about 120, F-9 about 80) and about 2,000 test lines. That is **M+**: more than r6's M, because of M-1, M-2
and F-9. The risk is in F-4 and F-7 (core safety behavior); F-1, F-2, F-5, F-6 and F-8 are low risk. If the
owner wants a smaller first step, OQ-F3 (b) splits the round after commit 3.

## 8. Text for the documents (written by the round, after the implementation)

- `docs/DEVELOPMENT.md`, R4 **row 8**, third column: "`pane_not_found` as the `code` of herdr's error
  envelope, either on stdout with exit 0 and `result` absent or null (0.8.0), or in the 0.9.5 form (exit 1,
  empty stdout, one stderr line with exactly `id` `cli:pane:process_info` and `error` with exactly `code` and
  `message`), for a pane ID in herdr's grammar: `[]`. An empty pane ID: `[]` with no call." Fifth column,
  added: "a non-empty ID outside the grammar: reject with no call; the 0.9.5 form with `server_not_running`
  and the message prefix `no herdr server is running at `: reject with `RUNTIME_NO_SERVER_ERROR_CODE`; any
  other form: reject; a pinned handle runs its `herdrBin` with `HERDR_SOCKET_PATH`; malformed pins: reject
  with no call."
- **Row 9**, third column: "False: `pane_not_found` as in row 8, with `id` `cli:pane:get` for the 0.9.5
  form, for a pane ID in the grammar; or exit 0 and a `result` whose `pane` has the requested `pane_id` and a
  text `terminal_id` that is not the handle's non-empty `terminalId`." Fifth column, added: "an empty or
  non-grammar ID: reject with no call; the no-server and pin rules of row 8."
- The no-server text of section "Runtime stops" and of the startup rule: as 4.6, and the guard G.
- `CLAUDE.md`, the `isAlive` sentence: "runtime-herdr `isAlive` likewise answers false only for the
  `pane_not_found` code of herdr's error envelope, on stdout at exit 0 (0.8.0) or in the exact stderr form at
  exit 1 with the command's ID (0.9.5), for a pane ID in herdr's grammar, or the requested pane with another
  terminal; at startup no Herdr answer retires an old orchestrator (the fit round's guard)."
- Doc 0004: sections 1, 5a and 8 after the round (what AO reads, the pins, the kept failed launch, the startup
  refusal, F-9).

## 9. What the round keeps as it is

- The lifecycle rules: Herdr stays non-authoritative (`AUTHORITATIVE_RUNTIMES` = tmux), the outage rule
  (`killed` after `NO_SERVER_BOUND_MS`) applies to Herdr's new no-server code, `isRecoverableKill` moves a
  `killed` (`runtime`) record back when the runtime answers alive.
- Send delivery from `idle` and `done` (W-4), the raw-text fallback when no agent is ever detected, the
  delivery timeouts.
- `ao doctor`'s ambient `checkHerdr()`; runtime-herdr `detect()`.
- Worker spawns do not look at older Herdr workers (no startup guard for workers; not a review finding).
- The no-handoff rule for every record without S (r6 OQ-9).

## 10. How the round prepares RH

The handle keys `herdrBin`, `herdrSocket` and `createIncomplete` stay stable for RH. RH-A adds S to the same
handle; F-4's partial path and core's partial record let RH-B's stop clean a failed create once its stop can
confirm. G's selection and the classifier keep Herdr records out of startup authority until RH decides how
an S-based answer may retire one (review r6 M-3).

## 11. Interaction with the owner's decisions

OD-19 (a) (Herdr stop `unknown`) holds. OD-24 (a) (a moved socket leaves the session `unknown`) holds and is
applied at startup by G. OD-14 is not used. The design follows the recommended answers (a) of r6 OQ-1, OQ-2,
OQ-5, OQ-6, OQ-7 and OQ-9 (the basis of F-1, F-6, W-4, F-4 and F-5, F-7 and section 9), which review r6
supports. The owner has not answered them yet; section 14 asks again, and OQ-6 and OQ-7 change with M-1 and
M-2.

## 12. Deferred RH items (open for a later RH round)

- **Review r6 B-1** (an empty, changing `/proc` scan does not prove that S's session ended): the RH round must
  give an observation protocol that establishes containment or quiescence of S's session (tested through the
  production seam with the fork-and-exit interleaving), or keep `absent` and `destroyed` off, or broaden
  R-H1 to same-session descendants that the scan misses, with a fresh owner decision; for the stop and for the
  agent check's `[]`.
- **Review r6 B-2** (S is captured before an unbound launch): the RH round must bind the launch submission to
  the qualified listener and run that captured S (for example the raw `pane.send_input` under the
  connected-socket guard), or withhold a usable S and keep the partial resources whenever the association
  cannot be shown; with a capture-to-submit restart test. The fit's post-run `pane get` (F-4 step 6) narrows
  the window but is not a binding.
- **Review r6 M-3** (terminal liveness used as retire authority): the RH round must keep `isAlive` (S-based)
  separate from the authority to retire or replace a launch, and say which stronger evidence and owner gates
  allow startup to retire a Herdr record; G keeps that authority off until then.

## 13. Corrections of r6 evidence claims (review r6 m-1)

- **EOF interval.** r6 section 2.2 said herdr closes the connection "0.04 to 0.22 ms after the newline". The
  10 samples of `r6_a_framing_log` give 0.01 ms (`a_pane_close_second`: newline 85.77, EOF 85.78) to 0.22 ms
  (`a_pane_close_second_again`). Correct wording: "in the 10 samples, EOF came 0.01 to 0.22 ms after the
  newline (times rounded to 0.01 ms); this is a sample, not a bound". The read-to-EOF rule does not change.
- **`node:ffi`.** r6 section 2.3 said that Node 25.7 has no `node:ffi` (`ERR_UNKNOWN_BUILTIN_MODULE`) and
  named `r6_h_exec_and_tools_log`. That log has only `h_exec_bash`; the probe was run but not saved. The claim
  is **withdrawn as not retained**. The saved, narrower observation is `r5_g_node_peer_api.txt` (no peer
  credential method in Node's `net` API). The fit round does not use either; an RH round that relies on the
  absence of an FFI must measure it again and save it.

## 14. Open questions for the owner

| OQ | Question | Options and residuals | Recommendation |
| --- | --- | --- | --- |
| **OQ-F1** (r6 OQ-14, changed) | May a reachable negative (`pane_not_found`, or the pane with another terminal, at the record's pinned endpoint) retire an old Herdr orchestrator at startup, before RH-A? | **(a) Yes, as R4 row 9** (`HERDR_NEGATIVE_RETIRES_AT_STARTUP = true`; not for records with `launchFailed`). Residual: a hidden old server (one that runs where the pin no longer reaches it, while a new server answers at the pin) keeps running the old orchestrator; AO archives its record without a stop (project mode) and starts a second orchestrator on the same project. **(b) No** (`false`). Residual: no safety residual from herdr answers; every ended Herdr orchestrator needs an owner action (F-9, or by hand) before `ao start` makes a new one. In both: `isAlive` keeps its R4 answers for status, attach and the lifecycle | **(b)** (the reviewer's preference), with F-9 |
| **OQ-F2** (new) | How does the owner retire a Herdr record before RH? | **(a) F-9**: `ao session kill <id> --confirm-runtime-closed`; AO refuses when its pinned read shows the pane alive; otherwise it removes the worktree and archives on the owner's word. Residual: a wrong statement removes the worktree under a live hidden launch. **(b) By hand** (5.9.1). Residual: the same, plus by-hand errors (no record lock, no generation floor). **(c) Not at all**: Herdr records and worktrees stay until RH-A | **(a)** |
| **OQ-F3** (new) | One round or two? | **(a) One round**, eight commits (section 7), one review. **(b) Two rounds**: fit-1 = commits 1 to 3 (reads, pins, destroy: S, low risk), fit-2 = commits 4 to 8 (safety behavior: M) | **(a)**, because F-7's tests need F-1's no-server code and F-6's pins |
| r6 OQ-6 (changed by M-1) | Both unbound close paths refuse | (a) yes, and a failed create keeps every resource through core (F-4) | **(a)** |
| r6 OQ-7 (changed by M-2) | Conservative startup and a parameterized preflight | (a) yes, with G (status-independent, in core, both modes) and the runtime's own `preflight()` | **(a)** |
| r6 OQ-1, OQ-2, OQ-5, OQ-9 (unchanged) | CLI reads with F1; pins in the fit; W-4 later; no handoff for records without S | as recommended in r6 and supported by review r6; not yet answered by the owner | **(a)** each |

## 15. Measurements, deviations and checks

- **Measurements: none.** Every fact of sections 3 and 13 comes from saved fixtures of step 1, r5 and r6 and
  from the code at `541becfb`. No herdr, tmux, ao, node or pnpm command ran for r7; no scratch tree
  `/tmp/aohd4` and no marker were made. So the cleanup checks of the step 1 brief do not apply.
- **Deviations.** The design adds F-9, a new command option, which the brief did not name; it is gated on
  OQ-F2 and needed for a recovery that works before RH (the brief's example recovery, `ao session kill` after
  the owner checks the old pane, refuses for every Herdr record until RH, because the stop answers
  `unknown`). Doc 0004 got three pointer and fact edits
  (the fit design moved from r6 to r7; a failed create keeps its resources after the round).
- **Checks.** `git status -s` shows only this file, doc 0004 and the `.agent_*` files;
  `git diff --exit-code -- packages` passes.
