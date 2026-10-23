# Herdr fit-2 design r8 (ao-65), 2026-10-22

Author: ao-65 (Claude Opus 5.5), 2026-10-22, from about 21:10 EDT. Baseline `main` `389b8dfe` (its
`packages/` tree is equal to `541becfb`). No product code changed. This design answers review r7 of the fit
design ([`herdr_fit_design_review_r7_sol61.md`](herdr_fit_design_review_r7_sol61.md), ao-71, NOT-SOUND,
0 blocking, 3 major, 4 minor) for **fit-2**, the safety part of the fit round, after the owner split the round
(2026-10-22 21:07).

fit-2 = F-3 (a blocked agent is a refusal), F-4 (a failed create closes nothing and keeps everything), F-7
(startup admits at most one Herdr orchestrator per project, with `Runtime.preflight()`), F-9 (the owner's
retire action) and the rest of F-8 (contracts and documents). It builds on **fit-1** (section 2), which a
worker (ao-73) implements now from [fit design r7](herdr_fit_design_r7_opus.md). This file is
self-contained: an implementer needs this file, the fit-1 tip, the fixtures it names (all under
`development/artifacts/herdr_095_live_check/`) and the code. Line numbers are those of `389b8dfe`; fit-1
moves some of them (section 2.3).

One small measurement was made for r8 (section 3.1, fixtures `r8_*`).

## 0. Review r7 findings and their answers

| Finding | What the review requires (short) | Answer in r8 | Section |
| --- | --- | --- | --- |
| **M-1** G leaves an in-flight isolated launch outside its selection; no admission boundary | A project admission boundary for G and the reservation; in-progress orchestrator reservations count (runtime and role persisted early); a damaged known-Herdr record counts as unknown; protect the interval until a handle or a partial failure is published; revalidate ownership and reuse after awaited probes; name deferred limits; tests: paused create, two simultaneous isolated starts, CLI and direct core, workspace-mode change | **Answered.** (1) An admission lock A per project (a kernel-released abstract Unix socket, the existing `holdDeliveryLock`) covers G and the reservation, in every orchestrator start and every orchestrator restore. (2) For a runtime in `LAUNCH_END_UNPROVEN_RUNTIMES`, the reservation record is born with `role` and a **pending handle** (`runtimeName` `herdr`, empty ID, `createIncomplete: create-pending`) and with the launch claim, also for agents without `prepareAgentSession`. So every later G sees the launch from its first byte on disk until the real or the partial handle replaces the pending one. (3) G1 also selects damaged known-Herdr records and handleless records with a live launcher. (4) Every decision on an awaited probe re-reads the record and checks the launch identity and the reuse conditions. (5) Limits L-1 to L-5 are named | 4.4 to 4.7, 5.3 (limits 5.3.8) |
| **M-2** F-4 treats an arbitrary create error envelope as proof of no workspace | Ordinary rollback only for a qualified pre-submission or no-side-effect condition, with a supported-code list and evidence; any other F1 error, an unknown code, an unqualified legacy envelope: `RuntimeCreatePartialError(workspace-unconfirmed)`; the same for `launch-refused` and its script; a stand-in that records the creation or the admission and then answers an error | **Answered.** Rule Q (4.3): three qualified conditions, each measured: Q0 the endpoint check (now also `compatible === true`), Q1 the CLI's own no-server text with the pinned socket, Q2 the CLI's own `protocol_mismatch` texts. r8 shows that Q1 and Q2 send no `workspace.create` and no `pane.send_input` request. Every other failure is a partial create. `launch-refused` is removed: a `pane run` failure outside Q is `launch-unconfirmed`, and the script stays | 3.1, 4.3, 5.2 |
| **M-3** G's reuse exemption has no safe dispatch after the project's runtime changes | Every old-record probe and stop through `registry.get("runtime", handle.runtimeName)`, no fallback to the new runtime; block a mismatch before G2 (as T-7.8) or reuse safely and revise T-7.8; test project mode with a live Herdr record and a tmux stand-in, zero tmux calls, the concurrent fixed-ID branch | **Answered.** `runtimeForHandle` (4.5) at every old-record site of core (startup branches, restore step 7, kill, list enrichment). For a handle of a runtime in the set, a missing plugin is unknown, never a fallback. G2 reuses only a record whose runtime is the selected runtime (OQ-F4 (a), recommended): T-7.8 stays "blocked" | 4.5, 4.6, 5.3 |
| **m-1** the eight-commit order is not green | API member before its use; split the create-test migration; give intermediate oracles | fit-1 already took the discovery-call migration and leaves `preflight()` to fit-2. The fit-2 order (section 7) puts every new type and export in commit 1, before its first use, and names the intermediate oracles | 7 |
| **m-2** public contract and file list omit the doctor distinction | `Runtime.create` partial-error contract and `closed: "nothing"` in `types.ts` and the plugin guidance of `CLAUDE.md`; the `doctor.ts` comment; the count | Contract text in 4.2 and 8; `doctor.ts` is a comment-only file of the list; **14 product files** (15 if fit-1 did not change the lifecycle comment) | 4.2, 6, 8 |
| **m-3** two current-code statements are wrong | A nonzero `execFile` rejection has the numeric `code` 1; an empty Herdr ID with no PID rejects in Claude Code but answers false in Codex, Gemini and OpenCode | Both corrected (3.3). fit-1 keeps the agent fallbacks unchanged; fit-2 does not change them either and relies on the lifecycle's runtime-positive gate; the retained-record matrix (5.2.6) says so | 3.3, 5.2.6 |
| **m-4** T-7.4 can pass without the new CLI handling | Exact formatting assertion; a CLI-to-real-core test with a persisted `killed` record; legacy exit-0 missing and replaced-pane answers at startup | T-7.4 asserts the exact printed text; T-7.4b runs the CLI on the real core; T-7.3b and T-7.3c use the 0.8.0 exit-0 answers, which are red on `389b8dfe` | 5.3.9 |
| Review section "F-9 and owner recovery" | Accept and refuse lists; removal scope; the owner's check before the attestation; no other command gets the override; the race between inspection and command; shell quoting | F-9 takes a **launch token** that the refusal and message M print; it refuses when the record now names another launch. Accept and refuse lists, removal scope and the owner's check in 5.4 | 5.4 |
| Review section "Partial-create contract and retained-record consumers" | `ao status`, kill, cleanup, restore (second restore), start, lifecycle, `ao send` | One row per consumer with its behavior and its test; `ao send` to a kept failed launch is not uniformly unsendable (OQ-F5) | 5.2.6 |
| Review section "Acceptance, API": `HerdrPinError` absent from the error table; the partial-error guard must check the whole shape | Define its guard and code if relied on; check the shape across core copies | Error table 4.1 lists `HerdrPinError` (fit-1) with its code; the guards check the code and the whole shape | 4.1 |
| Review acceptance notes (T-4.8, T-4.10, T-7.14, T-3.6) | Specific setups | Applied in the test tables | 5 |
| Owner decisions OQ-F1 (b), OQ-F2 (a), OQ-F3 (b) | | Applied: no Herdr answer retires an old orchestrator at startup (the r7 constant `HERDR_NEGATIVE_RETIRES_AT_STARTUP` is removed); F-9 with the review's safeguards; two rounds | 2.2 |

## 1. Results

1. **M-1.** Startup admits at most one Herdr orchestrator per project. An admission lock A serializes G and
   the reservation of every orchestrator start and restore of the project. A Herdr launch is visible to G
   from the moment its record exists, because the reservation itself carries the pending handle. A launch
   in progress, a crashed launch, a failed launch, a damaged record and a record that no probe can prove
   ended all block a new start.
2. **M-2.** A failed Herdr create runs the ordinary rollback only for three measured pre-request
   conditions (Q0, Q1, Q2). Every other failure keeps the worktree, the agent session, the record and the
   launch script, as a "kept failed launch".
3. **M-3.** Core probes and stops an old record only through the runtime that its handle names. A Herdr
   record is never asked through tmux, and a missing Herdr plugin is unknown.
4. **F-9.** `ao session kill <id> --confirm-runtime-closed <token>` retires a Herdr record on the owner's
   word, only while the record still names the launch that the owner checked.
5. **Size: 14 product files** (13 with a behavior or API change, `doctor.ts` comment-only; 15 if fit-1 left
   the lifecycle comment), about 1,400 product lines and 2,600 test lines, 8 commits on top of fit-1. That
   is **L**. The risk is in commits 3 and 5 (core rollback and admission).

## 2. The base: fit-1 and the owner's decisions

### 2.1 What fit-1 delivers (from r7 and the fit-1 brief)

fit-1 = F-1, F-2, F-6, F-5 and their docs, plus an interim startup guard. fit-2 uses these names; the
implementer checks them on the fit-1 tip first (gate G0, section 7). If fit-1 named an export differently,
use fit-1's name; if a behavior differs, stop and report.

| fit-1 name (core `herdr.ts` unless named) | Behavior that fit-2 relies on |
| --- | --- |
| `readHerdrCliFailure(err, expectedId)` | `{ code, message }` only for the exact 0.9.5 form (exit 1, empty stdout, one stderr line with exactly `id` and `error`, `id` = the expected ID); else `null` |
| `isHerdrNoServer(failure)` | `server_not_running` with the prefix `no herdr server is running at ` |
| `HERDR_CLI_IDS` | the command IDs: `cli:pane:get`, `cli:pane:process_info`, `cli:pane:read`, `cli:request` (`pane run`, `send-text`, `send-keys`), `cli:agent:prompt`, `cli:workspace:create` |
| `HERDR_PANE_ID_RE`, `isHerdrPaneId` | the pane ID grammar; no herdr call for an ID outside it (row 9 rejects; row 8 `[]` for an empty ID) |
| `resolveHerdrEndpoint({ binPath, env })` | `{ bin, socket, running }` from an absolute executable and `status server --json`; rejects a missing binary or a malformed answer |
| `herdrInvocationFor(handle, legacyBin)`, `HerdrPinError` | a pinned handle runs `herdrBin` with `HERDR_SOCKET_PATH=herdrSocket`; a legacy handle runs as before; malformed pins throw `HerdrPinError` with zero calls |
| `getHerdrPaneProcesses`, `isHerdrProcessRunning` | accept `string \| RuntimeHandle` |
| runtime-herdr `herdr(expectedId, ...)`, `herdrResult(...)` | an F1 failure throws an `Error` with `herdrCode`, and with `code` `RUNTIME_NO_SERVER_ERROR_CODE` for no-server, and `cause` = the `execFile` rejection |
| runtime-herdr `create` | call 0 `status server --json` (pins), call 1 `workspace create`, call 2 `pane run`; stores `herdrBin` and `herdrSocket` in `handle.data`; on a failed `pane run` it still closes the workspace (`index.ts:365`, removed by fit-2) |
| runtime-herdr `destroy` | refuses with zero calls (F-5) |
| core `isOrchestratorRuntimeAlive` and CLI `checkOrchestratorLiveness` | **interim guard**: for a record whose runtime is Herdr, neither the no-server code nor `isAlive` false answers "gone"; both answer as unknown (today's refusal and message). tmux unchanged |
| `docs/DEVELOPMENT.md` | a note that the startup guard is interim, with the by-hand recovery of an old Herdr orchestrator record |

### 2.2 The owner's decisions (2026-10-22 21:07)

- **OQ-F3 (b):** two rounds; this is the second.
- **OQ-F1 (b):** before RH-A, no Herdr answer retires an old orchestrator at startup. So the classifier never
  answers "ended" for a Herdr record, and the r7 constant `HERDR_NEGATIVE_RETIRES_AT_STARTUP` is not built.
- **OQ-F2 (a):** F-9, with the safeguards of review r7 (section 5.4).

### 2.3 What fit-2 removes or replaces from fit-1

- The interim guard of `isOrchestratorRuntimeAlive` (core) is replaced by the classifier and G (commit 5);
  the interim guard of `checkOrchestratorLiveness` (CLI) by the classifier (commit 6). fit-1's tests of the
  interim guard change their expected message (section 7, intermediate oracles).
- The create cleanup close of runtime-herdr (`index.ts:365-369`) is removed (commit 3).
- The interim note in `docs/DEVELOPMENT.md` is replaced by the G rule and the F-9 recovery (commit 8).

## 3. Facts

### 3.1 New r8 measurement: which create and run failures send no request

A fake server at `HERDR_SOCKET_PATH` logged every connection; the real herdr 0.9.5 CLI made the calls;
`strace` recorded 13 `connect()` calls, all `AF_UNIX` (`r8_strace_connects.txt`). No real herdr server ran.
Log: `r8_cli_forms_log.txt`; the script: `r8_forms_script.txt` (saved as text).

| Case | CLI answer | Connections at the fake server |
| --- | --- | --- |
| `workspace create`, ping answers protocol 19 | exit 1, F1 `cli:workspace:create` `protocol_mismatch` "client protocol 22 is newer than server protocol 19; ..." | 1 (ping only): **no `workspace.create` request** |
| `pane run`, ping answers protocol 19 | exit 1, F1 `cli:request` `protocol_mismatch`, same text | 1 (ping only): **no `pane.send_input` request** |
| `workspace create`, ping answers protocol 23 | exit 1, F1 `protocol_mismatch` "client protocol 22 is older than server protocol 23; upgrade the Herdr client before using this command" | 1 (ping only) |
| `status server --json`, protocol 19 and 23 | **exit 0, `"running":true`, `"compatible":false`**, `"endpoint_compatible":true`, the server's version and protocol (`r8_status_json_ping_protocol_19.json`, `_23.json`) | 1 (ping only) |
| `workspace create`, a stale socket file | exit 1, F1 `server_not_running` "no herdr server is running at `<socket>`; run \`herdr\` to start or attach it" | 0 |
| `pane run`, a stale socket file | the same, with `cli:request` | 0 |
| `workspace create`, the server answers the request with `zz_unknown_code` | exit 1, F1 with that code | 2: **the request was sent** |
| `workspace create`, the server answers the request with `server_not_running` and the CLI's prefix | exit 1, F1 `server_not_running` "no herdr server is running at /tmp/aohd5/fake/elsewhere.sock" | 2: **the request was sent**; the code and the prefix alone do not prove a pre-request refusal |
| `pane run`, the server answers the request with `pane_not_found` | exit 1, F1 `cli:request` `pane_not_found` | 2: the `pane.send_input` request was sent |

A real 0.9.5 server reports `"compatible":true` (`closedpane_status_server_json.json`); with no server the
field is `null` (`noserver_never_status_server_json.json`). Step 1 measured the session form of the no-server
text, "...; run \`herdr session attach <name>\` to start or attach it" (`noserver_never_workspace_create`);
with `HERDR_SOCKET_PATH`, which AO's pins always set, the text ends "run \`herdr\` to start or attach it".

### 3.2 Facts from earlier rounds that fit-2 uses

- The F1 form, the command IDs and the near misses: fit-1 (section 2.1); fixtures `closedpane_*`,
  `blocked_herdr_agent_prompt`, `noserver_never_*`, `r5_b_*`.
- `pane run` is `pane.send_input` with the text and Enter, by pane ID only (`r5_b_cli_forms_log`); a restart
  restores the same pane IDs with new terminals (step 1 section 5.3, `otherterm_pane_get`).
- The Herdr `stop` answers `unknown` and closes nothing (`runtime-herdr/src/index.ts:418-433`).
- Built-in runtimes get no config from the registry (`plugin-registry.ts:449`, `:510`, `:411`).
- The core lock: `holdDeliveryLock(name, waitMs)` binds a Linux abstract Unix socket; the kernel frees it when
  the process ends (also `kill -9`); a second bind gets `EADDRINUSE`, also in the same process
  (`core/src/delivery-lock.ts:1-24`, `:71-110`). `isDeliveryLockSupported()` is true only on Linux.
- Launch claim: `launchPid` and `launchPidStart` in the reservation; `liveLaunchOwner` answers the PID while
  that process runs with that start time (`session-manager.ts:285-375`). Today only a launch whose agent has
  `prepareAgentSession` writes it (`:2055`, `:2458`), and only agent-opencode has that method. So a Claude
  Code orchestrator launch has no claim.
- `isOrchestratorSessionRecord` accepts `role=orchestrator`, an ID that ends with `-orchestrator`, and
  `<prefix>-orchestrator-<n>` (`:711-725`): an isolated reservation matches by its ID before any `role`
  write.
- Project mode already refuses a handleless fixed-ID record: the reservation fails and the concurrent branch
  throws "already exists but is not in a reusable state" (`:2560-2597`).
- Dispatch today: list enrichment uses the handle's runtime and falls back to the project's runtime when that
  plugin is not registered (`:1513-1516`); kill uses the handle's runtime and skips the stop when the plugin
  is not registered (`:3078-3105`); restore stops the old handle through the project's runtime (`:4483`);
  startup probes and stops through the project's runtime (`:2465`, `:2509`, `:2570`); the CLI probes through
  the handle's runtime (`start.ts:906-907`); the lifecycle uses the handle's runtime (`lifecycle-manager.ts:560`).
- `keepUnconfirmedLaunch` writes `launchFailed` (capped at 600 characters) and keeps the launch claim
  (`:1952-1992`).
- runtime-tmux `create` kills the tmux session that it made, best effort, before it throws a plain error
  (`runtime-tmux/src/index.ts`, the `catch` after `send-keys`).
- `ao start` prints a startup error as `Error:` plus the error's message and exits 1
  (`start.ts:1214-1220`); today it wraps a `spawnOrchestrator` error as "Failed to setup orchestrator: ..."
  (`:1071-1075`).

### 3.3 Corrected code statements (review r7 m-3)

- A nonzero `execFile` rejection has a numeric `code` (1 for herdr's error exit). What it lacked before
  fit-1 is `herdrCode` and `RUNTIME_NO_SERVER_ERROR_CODE`.
- For a Herdr handle with an empty ID and no PID, `isProcessRunning` **rejects** in agent-claude-code
  (`index.ts:661-664`) but answers **false** in agent-codex (`:681`), agent-gemini (`:294`) and
  agent-opencode (`:1440`). fit-1 keeps these fallbacks and fit-2 does not change them. A false agent answer
  alone is no lifecycle authority: the runtime-positive gate (`lifecycle-manager.ts:662`) needs a runtime
  answer, and the Herdr runtime rejects an empty ID with no call.

## 4. Shared definitions (new in fit-2)

### 4.1 Error types (`core/src/runtime-errors.ts`, new; exported from `index.ts`)

Each guard accepts an error from another copy of core: it checks the `code` and the whole shape, never
`instanceof` alone.

| Class | `code` | Fields | Guard checks |
| --- | --- | --- | --- |
| `RuntimeCreatePartialError` | `ERR_RUNTIME_CREATE_PARTIAL` | `handle` (what may exist), `stage` ∈ {`workspace-unconfirmed`, `launch-not-submitted`, `launch-unconfirmed`}, `closed: "nothing"`, `cause` | `code`; `handle` an object with a string `id`, a non-empty string `runtimeName` and an object `data`; `stage` in the set; `closed === "nothing"` |
| `RuntimeSendRefusedError` | `ERR_RUNTIME_SEND_REFUSED` | `reason: "agent_blocked"`, `admitted` ∈ {`none`, `earlier-attempt-unconfirmed`}, `target` (pane ID), `stage` (text) | `code`; `reason`; `admitted` in the set; `target` a string |
| `OrchestratorStartBlockedError` | `ERR_ORCHESTRATOR_START_BLOCKED` | `projectId`, `reason` ∈ {`records`, `records-unreadable`, `admission-busy`, `admission-unsupported`, `records-changed`}, `blocking: BlockingLaunch[]` | `code`; `projectId` a string; `reason` in the set; `blocking` an array |
| `HerdrPinError` (fit-1, `herdr.ts`) | `ERR_HERDR_PIN` | the malformed key | `code`. If fit-1 gave it no `code` or no guard, commit 1 adds `code` and `isHerdrPinError` |

`BlockingLaunch`: `sessionId`, `kind` (4.6), `status`, `launchFailed` (yes or no), `handle` (the stored text
when it does not parse), `pane`, `terminal`, `workspace`, `worktree`, `socket`, `bin`, `answer` (text),
`launcherPid` (for `in-progress`), `token` (4.7).

### 4.2 The unproven set and the create contract (`core/src/types.ts`)

- `LAUNCH_END_UNPROVEN_RUNTIMES: ReadonlySet<string> = new Set(["herdr"])`, with
  `isLaunchEndUnproven(name)`. Doc: "runtimes whose answers do not prove that a launch ended: a server can
  run where the recorded endpoint does not reach it, and pane IDs come back after a restart. Startup never
  retires a record of such a runtime on a runtime answer."
- `Runtime.create` doc (replaces "Create a new session environment and return a handle"):

  > Create a session environment and return its handle. On failure, a runtime throws a plain error only when
  > nothing of the session can exist in it: no request reached the runtime, or the runtime removed what it
  > made. Core then runs the ordinary rollback: it discards a prepared agent session, removes the workspace
  > and releases the reservation. When something may exist (a request was sent, an answer is unknown, a
  > cleanup is not confirmed), the runtime throws `RuntimeCreatePartialError` with the handle of what may
  > exist and `closed: "nothing"`; it closes nothing, and core keeps the record, the workspace and the agent
  > session (a "kept failed launch"). runtime-herdr follows this with the qualified conditions of its
  > rule Q. runtime-tmux keeps its earlier behavior (it kills the tmux session that it made, best effort,
  > before it throws) and is not re-qualified.

- `Runtime.preflight?(): Promise<void>` (optional): "Check that `create()` can start a session now, with the
  binary and endpoint that `create()` will use. Throws a message for the operator. A readiness sample, not a
  reservation of the endpoint, and never evidence about an existing session."
- `SessionManager.kill` options: `{ purgeOpenCode?: boolean; confirmRuntimeClosed?: string }` (the token;
  commit 7).

### 4.3 Rule Q: the qualified no-side-effect conditions of a Herdr create

Core `herdr.ts` exports `herdrPreRequestRefusal(failure, call, socket)`: `"no-server" | "protocol" | null`.
It answers non-null only for these forms (the `failure` comes from `readHerdrCliFailure(err.cause,
expectedId)` of fit-1, so the exit code, the empty stdout, the one-line stderr and the command ID are already
checked):

| Condition | Exact form | Why no request was sent | Evidence |
| --- | --- | --- | --- |
| **Q0** endpoint check | `status server --json` fails, answers `running !== true`, or answers `compatible !== true` | it is a ping; `create` sends no create request after it | `r8_status_json_ping_protocol_19.json` (`running` true, `compatible` false), `noserver_never_status_server_json`, `r5_b0_requests_log` |
| **Q1** CLI no-server | `code === "server_not_running"` and `message === "no herdr server is running at " + socket + "; run \`herdr\` to start or attach it"`, where `socket` is the handle's pinned `herdrSocket` | the CLI found no listener and connected to nothing | `r8_ws_create_stale_socket_file`, `r8_pane_run_stale_socket_file` (0 connections) |
| **Q2** CLI protocol refusal | `code === "protocol_mismatch"` and `message` matches `^client protocol \d+ is (newer\|older) than server protocol \d+; ` | the CLI refused after the ping, before the request | `r8_ws_create_ping_protocol_19`, `_23`, `r8_pane_run_ping_protocol_19` (ping only) |

Anything else is not qualified: another F1 code (also `server_not_running` with another text, as
`r8_ws_create_server_sends_cli_no_server_text` and `r5_b_pane_get_server_not_running_from_server` show), the
0.8.0 exit-0 error envelope, Rust text, a timeout, a signal, an exit code other than 1.

**Residual R-Q.** A server that answers a request with exactly the CLI's Q1 text (with the pinned socket in
it) or a Q2 text would look like a pre-request refusal; AO would then run the ordinary rollback while the
server may have made a workspace. herdr 0.9.5 makes these codes in the CLI; no measured server sends them.
The rule does not defend against a server that imitates the CLI.

### 4.4 The pending handle and the launch claim (core, the three create sites)

For a launch whose selected runtime is in `LAUNCH_END_UNPROVEN_RUNTIMES`:

- **Pending handle** `P = { id: "", runtimeName: <runtime>, data: { createIncomplete: "create-pending" } }`.
- **Launch claim** for every such launch (today only with `prepareAgentSession`):
  `claimNeeded = !!plugins.agent.prepareAgentSession || isLaunchEndUnproven(runtime.name)`.
- **Worker spawn** (`reserveNextSessionIdentity` `:2060`, its reservation `:1298`) and **orchestrator
  start** (isolated `reserveNextOrchestratorIdentity` `:2602`, its reservation `:1366`; project mode
  `reserveSessionRecord` `:2562`, `:2589`, `:2592`):
  the reservation's `initial` is `{ ...launchClaim, runtimeHandle: JSON.stringify(P) }`, plus
  `role: "orchestrator"` for an orchestrator. `reserveSessionRecord` publishes the record with `link`, so the
  record never exists without them.
- **Restore** (step 9, `:4533`): before `create`, `updateMetadataIf(owned identity, { runtimeHandle: P,
  restoredAt: <now>, ...launchClaim })`; a failed write throws `recordChangedError` with "no runtime was
  created"; `owned` advances to the result.
- **Success:** the existing handle write replaces `P` (`:2307-2320`, `:2861-2872`, `:4561`). When the claim
  was taken only for the unproven runtime (no `prepareAgentSession`), the last write of the success path also
  clears it (`CLEARED_LAUNCH_CLAIM`), as the prepared path does after `confirmLaunch`.
- **Partial failure:** the partial handle replaces `P` (5.2.3), and the claim is cleared when the rollback
  ends.
- **Plain failure before or in create:** the ordinary rollback releases the reservation, as today.

`P` is a valid handle of a runtime in the set with an empty ID. Every consumer already treats it safely
after fit-1: Herdr `isAlive` rejects an empty ID with no call; the Herdr stop answers `unknown` with no
call; core row 8 answers `[]` for an empty ID; `recordMayOwnRuntime` never matches an empty ID. So kill,
cleanup and restore refuse a record with `P`, and G selects it. tmux and the test runtimes write no `P` and
no extra claim: their records keep their shape.

### 4.5 Dispatch by the handle's runtime (core)

`runtimeForHandle(handle, fallback)`:

- `handle.runtimeName` a non-empty string and registered: `registry.get("runtime", handle.runtimeName)`.
- `handle.runtimeName` in `LAUNCH_END_UNPROVEN_RUNTIMES` and not registered: `null` (the caller treats it as
  unknown or refuses).
- any other case: `fallback` (today's behavior, kept for the test runtimes; in production tmux and herdr
  are both built-ins).

It replaces `plugins.runtime` in every probe and stop of an **old** record: the startup branches
(`stopOrchestratorOrRefuse` `:2465`, the probes `:2509`, `:2570`), restore step 7 (`:4483`), kill
(`:3079-3083`, where a missing plugin of a set runtime now refuses instead of skipping the stop), list
enrichment (`:1514-1516`, where a missing plugin of a set runtime now skips the probe instead of the fallback),
and the classifier (4.6). A **new** launch still creates through the project's selected runtime.

### 4.6 The classifier, the reuse predicate and the blocking kinds (core, exported)

`classifyOrchestratorLiveness(runtime | null, handle)` returns `alive`, `ended` (with a reason) or `unknown`
(with a reason):

| Answer | Runtime outside the set (tmux, test runtimes) | Runtime in the set (herdr) |
| --- | --- | --- |
| no plugin (`runtimeForHandle` gave `null`) | unknown | unknown |
| `isAlive` `true` | alive | alive |
| `isAlive` `false` | ended | **unknown** (OQ-F1 (b)) |
| rejects with `RUNTIME_NO_SERVER_ERROR_CODE` | ended | **unknown** |
| rejects otherwise, or not a boolean | unknown | unknown |

`isReusableOrchestrator(raw, handle, selectedRuntimeName)`: for a handle of a runtime in the set, true only
when the record has no `launchFailed`, `handle.data.createIncomplete` is absent, and `handle.runtimeName ===
selectedRuntimeName` (OQ-F4 (a)); for any other handle, true (today's rules).

Blocking kinds of `BlockingLaunch.kind`: `in-progress` (a live launch owner), `create-incomplete` (a pending
or partial handle, no live owner), `not-reused` (alive but not reusable, or alive in another workspace mode
or with a terminal status), `unproven` (any answer other than alive), `damaged` (4.7, G1).

### 4.7 The launch token

`launchToken(raw)`: the first 16 hex characters of SHA-256 over `JSON.stringify(LAUNCH_IDENTITY_KEYS.map(
(key) => raw[key] ?? ""))` (`metadata.ts:332-338`). It changes when a reservation, spawn, restore or
partial-handle write changes the launch; a status, `launchFailed` or retire-key write does not change it.
Message M, the Herdr kill refusal and `ao status` (the `launch failed` line) print it. F-9 needs it.

## 5. The items

### 5.1 F-3: a blocked agent is a refusal (W-3)

**Files.** runtime-herdr `index.ts` (`SETTLED_STATES` `:62`, `waitForSettledAgent`, `sendMessage`
`:447-477`); core `session-manager.ts` (send retry `:4005-4027`); CLI `send.ts` (`:355-359`).

**Before.** `blocked` counts as settled, so AO prompts a blocked agent; herdr answers `agent_blocked`
(exit 1); core forces a restore, which refuses, and `ao send` prints a stack trace that names the restore
(`ao_send_blocked`).

**After.**

- `SETTLED_STATES` = `idle`, `done`. `waitForSettledAgent` stops at the first poll that shows `blocked`.
- `sendMessage` throws `RuntimeSendRefusedError` (`reason` `agent_blocked`) when: (1) the first settle wait
  sees `blocked` (`admitted` `none`, stage "first settle wait"); (2) an `agent prompt` answers the F1
  `agent_blocked` (`herdrCode` from fit-1; `admitted` `none` for attempt 1, `earlier-attempt-unconfirmed`
  after an earlier prompt of this call; stage "agent prompt, attempt n"); (3) the settle wait after a
  prompt sees `blocked` (`earlier-attempt-unconfirmed`, stage "settle wait after attempt n").
- After a refusal: no `send-text`, no `send-keys` (raw text and Enter could answer the permission prompt).
- In `promptWasConsumed` (from `idle`), `blocked` stays "consumed": a delivery, not a refusal.
- core `send` (`:4007`): `isRuntimeSendRefusedError(err)` → throw it unchanged, before the restore retry.
- CLI `send.ts:356`: catch the refusal, print one line to stderr, exit 1: `ao send: <session>: not sent: the
  agent in herdr pane <pane> is blocked and waits for input (agent_blocked). Answer it in the pane (ao session
  attach <session>), then send again.` With `earlier-attempt-unconfirmed`, add `An earlier prompt of this send
  may have been delivered; check the pane before you send again.` No stack.

W-4 (duplicate delivery from `done`) stays open for the later send round; F-3 does not change it.

**Oracle change.** runtime-herdr `index.test.ts:304` "treats blocked as settled — a prompt is how you answer
a blocked agent": old: an `agent prompt` is sent; new: refusal, `admitted` `none`, zero `agent prompt`, zero
`send-text`, zero `send-keys`.

| ID | Test | Expected |
| --- | --- | --- |
| T-3.1 | First settle poll answers `blocked` | refusal, `none`, stage "first settle wait"; zero prompt, zero raw input |
| T-3.2 | Gate `idle`; attempt 1 answers the `blocked_herdr_agent_prompt` line | refusal, `none`; one prompt; zero raw |
| T-3.3 | Attempt 1 succeeds, no consumption seen, the settle wait after it answers `blocked` | refusal, `earlier-attempt-unconfirmed`, stage "settle wait after attempt 1"; one prompt; zero raw |
| T-3.4 | Attempt 2 answers `agent_blocked` | refusal, `earlier-attempt-unconfirmed`, stage "agent prompt, attempt 2"; two prompts; zero raw |
| T-3.5 | Control: from `idle`, the consumption poll shows `blocked` | delivered; one prompt |
| T-3.6 | core `send` with the refusal, once with each `admitted` value | zero `restore`; the error keeps `code` and `admitted`; control: another send error keeps the one restore retry |
| T-3.7 | CLI with each `admitted` value | exit 1; exactly the one or two sentences above on stderr; nothing on stdout; no stack |

### 5.2 F-4: a failed create closes nothing and keeps everything (W-5a, review r6 M-1, review r7 M-2)

**Files.** runtime-herdr `index.ts` (`create` `:331-393`, `writeLaunchScript`); core `herdr.ts`
(`herdrPreRequestRefusal`, `resolveHerdrEndpoint` gets `compatible`); core `session-manager.ts` (worker
catch `:2271-2276`, orchestrator catch `:2834-2837`, `rollbackLaunch` `:1855-1941`, restore step 9
`:4533-4550`, the pending handle and claim of 4.4).

**Before (after fit-1).** A failed `pane run` closes the new workspace by its ID without a check and throws a
plain error; core's catch runs `rollbackLaunch` without the runtime and the handle, so it discards the
prepared agent session, removes the worktree and releases the reservation, while the agent may run.

#### 5.2.1 The plugin's create steps

| Step | Failure | Result | Script |
| --- | --- | --- | --- |
| 1. `resolveHerdrEndpoint` (fit-1) | any failure; `running !== true`; **`compatible !== true`** (new) | plain error: "no compatible herdr server runs at `<socket>` (...)" (Q0) | none written |
| 2. `workspace create` | Q1 or Q2 (4.3) with `cli:workspace:create` | plain error with `herdrCode` (and the no-server `code` for Q1) | none written |
| | any other failure: another F1 code or text, the 0.8.0 exit-0 error envelope, Rust text, timeout, signal, other exit | partial, `workspace-unconfirmed`, handle `id` `""` | none written |
| 3. the answer | no `workspace_id` in the workspace grammar; no root pane in the pane grammar with that workspace prefix; no non-empty text `terminal_id` | partial, `workspace-unconfirmed`, with what parsed | none written |
| 4. `writeLaunchScript` | throws | partial, `launch-not-submitted` | none, or a partial file that the plugin removes |
| 5. `pane run P bash <script>` | Q1 or Q2 with `cli:request` | partial, `launch-not-submitted` | removed |
| | any other failure (also F1 `pane_not_found` after the request, as `r8_pane_run_pane_not_found_after_request`) | partial, `launch-unconfirmed` | **kept** |
| 6. `pane get P` (new) | not P with terminal T of step 3: `pane_not_found`, another terminal (kept as `terminalAfterRun`), any failure | partial, `launch-unconfirmed` | kept |
| | P with T | success: the handle | the script removes itself |

The partial handle: the fields of a success handle (`id` P, `workspaceId`, `paneId`, `terminalId`,
`sessionId`, `workspacePath`, `createdAt`, `herdrBin`, `herdrSocket`) plus `createIncomplete: <stage>` and,
when known, `terminalAfterRun`; for `workspace-unconfirmed`, `id` `""` and what parsed. The message names the
stage, the workspace, the pane, the terminal, the socket, the cause (the F1 code and text, or "transport
failure: <first stderr line>") and "AO closed nothing". `create` has no `workspace close` and no `pane close`.

Step 6 is a check, not a binding (RH B-2 stays open): it makes a restart between `workspace create` and
`pane run` visible; a restart after it is not seen.

#### 5.2.2 Core: the worker and orchestrator catches

```ts
} catch (err) {
  if (isRuntimeCreatePartialError(err)) {
    await rollbackLaunch({ own, prepared, workspace /* as today */, runtime: plugins.runtime,
      handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle) });
  } else {
    await rollbackLaunch({ own, prepared, workspace /* as today */ });   // today's plain-error path
  }
  throw err;
}
```

`launchedRecordFor(handle)` is the record that the success path writes today (worker `:2307-2320`,
orchestrator `:2861-2872`), moved into one local function per path.

#### 5.2.3 Core: `rollbackLaunch` with `partialRecord`

1. `own.checkOrUnknown()`. Not `own` (gone, replaced, unknown): remove nothing (no stop, no agent-session
   discard, no workspace removal, no release), write nothing; warn once with the handle (pane, workspace,
   socket), the worktree, the agent session and the record state; return `{ stopUnconfirmed: true }`.
2. `own.write({ ...partialRecord, runtimeHandle: JSON.stringify(handle), [RESERVATION_KEY]: "" })` (it
   replaces the pending handle). A failed write: as step 1.
3. `stopRuntime(runtime, handle)`. Herdr: `unknown`, so `keepUnconfirmedLaunch` writes `launchFailed` and the
   rollback ends with nothing removed. A confirmed stop (a later RH-B) goes on as today.
4. The launch claim is cleared (`own.write(CLEARED_LAUNCH_CLAIM)`, only while `own`), so `ao session kill`
   and F-9 are not refused as "in progress" while the failed `ao` process still runs.

The orchestrator's prompt file stays (`stopUnconfirmed`, as today).

#### 5.2.4 Restore step 9

- **A partial error:** `updateMetadataIf(owned identity, { status: "spawning", runtimeHandle: <partial>,
  restoredAt, [RESERVATION_KEY]: "", launchFailed: <cause> })`, clear the claim, then throw. A failed write
  adds "its runtime <pane> at <socket> was kept; check it by hand" to the error.
- **A plain error** (Q0, Q1, Q2: nothing was created): `updateMetadataIf` on the owned identity writes back
  the record's earlier `runtimeHandle` and `restoredAt` (empty when there was none) and clears the claim, so
  the record is as before the restore. A failed write names the record in the error.
- A second restore of a record with a partial or pending handle stops at step 7 (Herdr `unknown`) and creates
  nothing.

#### 5.2.5 The record state "kept failed launch"

An active record with the partial handle (`createIncomplete`), `launchFailed`, the launch's normal keys
(`worktree`, `branch`, `agent`, `createdAt`; `status` `spawning` for a worker and a restore, `working` for an
orchestrator), the prepared agent session's keys, and no launch claim. The worktree, the agent session, the
prompt file (orchestrator) and, for `launch-unconfirmed`, the launch script stay. A **crashed launch** (the
`ao` process ended inside `create`) leaves the pending handle `create-pending` with a dead claim; it is the
same state without `launchFailed`.

#### 5.2.6 The consumers of a kept failed launch (review r7 table)

| Consumer | Behavior after fit-2 | Test |
| --- | --- | --- |
| `ao status`, `get`, `list` | The stored partial handle stays; `launch failed: ...` (`status.ts:230`) and the token show. A grammar pane ID that answers `false` may enrich the shown status to `killed`/`exited` (memory only); a rejected probe (empty ID, no server) keeps it. The 600-character cap applies to `launchFailed` only; pane, workspace, socket and stage stay readable in the stored handle | T-4.12: stored and shown data, with a `workspace-unconfirmed` (empty ID) partial and a `launch-unconfirmed` one |
| `ao session kill` (no F-9) | After the launcher check, the Herdr stop answers `unknown` (no call, also for an empty ID or malformed pins) and the kill refuses before the worktree removal and the archive (`:3093-3101`); the hint names F-9 with the token | T-4.11: valid, empty-ID and malformed-pin partials |
| `ao session cleanup` | Orchestrators are skipped (`:3380`); a live launcher is skipped (`:3387`); a worker that reaches `killRecord` meets the same refusal. Cleanup never passes `confirmRuntimeClosed` | T-4.13: a worker partial with a merged PR (the PR route) and with a runtime negative (a grammar pane that answers `pane_not_found`): both kept |
| `ao session restore` | Step 7 stops through the handle's runtime (4.5): Herdr `unknown`, so restore refuses before any workspace or runtime step; a handleless record whose project now selects Herdr writes `P` before `create` (4.4) | T-4.10 and T-4.10b (a second restore after T-4.10 creates nothing) |
| `ao start` | The record blocks (G, kind `create-incomplete`); the CLI never reuses it | T-7.5 |
| Lifecycle | Probes may change the shown or persisted status (`killed` after the outage rule); they call no kill, cleanup or restore. G ignores status | T-7.1 |
| `ao send` | No special policy (OQ-F5 (a)). `prepareSession` (`:3779-3823`) may try a restore when enrichment says exited or no agent; that refuses for Herdr. A `launch-unconfirmed` partial whose pane runs the agent with terminal T passes readiness and **receives the send**. An empty-ID partial waits for readiness, then `sendMessage` rejects with no call. A partial whose terminal changed answers `isAlive` false, so the send path tries a restore, which refuses | T-4.14: the three cases, with exact call counts |

**Owner recovery of a kept failed launch.** Check it as 5.4.3 says, close the pane by hand when it belongs to
this launch, then F-9 with the token.

**Oracle changes.**

| Test | Old oracle (after fit-1) | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:140` "closes the workspace when the launch fails, leaving nothing in the shared server" | `workspace close w7` after a failed `pane run` | zero `workspace close` and `pane close`; `RuntimeCreatePartialError`, `launch-unconfirmed` (a plain `Error` from `pane run` is not Q), handle `w7`, `w7:p1`, `term_abc`, the pins; the script file kept |
| runtime-herdr `index.test.ts:158` "throws when the response carries no usable pane" | rejects `/no usable pane/` | the same text; a partial `workspace-unconfirmed` with `workspaceId` `w7` |
| runtime-herdr create tests (fit-1 indices: call 0 status, 1 create, 2 run) | three calls | a fourth call `pane get` (index 3) answering P with T; the asserted arguments of calls 0 to 2 unchanged; the status answer of the test helper gets `"compatible":true` |
| core tests where `runtime.create` throws a plain error | today's rollback | unchanged |

**Acceptance tests.** Plugin tests in runtime-herdr `index.test.ts`. End-to-end tests in a new runtime-herdr
file `src/__tests__/fit2-create-rollback.test.ts`: built core (`createSessionManager`), the real plugin, a
stand-in `herdr` through mocked `node:child_process` (pattern of `lifecycle-pane-envelope.test.ts`) that keeps
its own state (workspaces made, inputs admitted), a real worktree workspace plugin on a temp git repo, and an
agent stand-in with `prepareAgentSession` that records its discards.

| ID | Case | Expected |
| --- | --- | --- |
| T-4.1 | Plugin: each row of 5.2.1 | the stated result and script state; zero `workspace close`, zero `pane close` in every row |
| T-4.1b | Q near misses: `server_not_running` with another socket in the text; with the session ending; `protocol_mismatch` with another text; the 0.8.0 exit-0 error envelope; Q1 text on `pane run` with a different socket | each is a partial (`workspace-unconfirmed` for create, `launch-unconfirmed` for run) |
| T-4.2 | Worker, before the submission: `writeLaunchScript` throws; and `pane run` answers Q1 | spawn rejects with the partial error; zero closes; the worktree exists; zero agent-session discards; the record has the partial handle, `launchFailed`, `status` `spawning`, no claim; `own` advanced |
| T-4.3 | Worker, timeout after admission: the stand-in records the `pane run` admission, then rejects with `killed: true`, `signal: "SIGTERM"` | as T-4.2, `launch-unconfirmed`; the script kept |
| T-4.3b | **Stand-in records then errors (review M-2):** `workspace create` makes `w7` in the stand-in's state, then answers F1 `zz_unknown_code`; and `pane run` records the admission, then answers F1 `pane_not_found` | create: partial `workspace-unconfirmed`, the worktree, the agent session and the record kept; run: partial `launch-unconfirmed`, the script kept; zero closes |
| T-4.4 | Worker: step 6 answers another terminal | `launch-unconfirmed`, `terminalAfterRun` recorded |
| T-4.5 | Orchestrator, project mode, T-4.2 to T-4.4 | the record `<prefix>-orchestrator` kept with the partial handle; the prompt file kept; the project directory unchanged |
| T-4.6 | Orchestrator, isolated mode, T-4.3 | the worktree and the numbered record kept |
| T-4.7 | The record is replaced during the create (the stand-in rewrites the launch identity before `pane run` answers) | zero closes, zero removals, no write to the new record; one warning that names the pane, the socket, the worktree and the agent session |
| T-4.8 | Control: discovery succeeds, then `workspace create` answers the exact Q1 text with the pinned socket; and Q2 (both texts) | today's rollback: the worktree removed, the reservation released, the agent session discarded; no herdr call after `workspace create` |
| T-4.8b | Control: `status server --json` answers `compatible: false` (`r8_status_json_ping_protocol_19.json`) | plain error; zero `workspace create`; today's rollback |
| T-4.9 | Control: a successful create | the handle with the pins; one `pane get` after the run; the pending handle replaced; no claim left (Claude Code agent stand-in without `prepareAgentSession`) |
| T-4.10 | Restore of a **terminal handleless** record (so step 9 is reached) on a Herdr project, `pane run` times out | the record has the partial handle, `launchFailed`, `restoredAt`; nothing removed |
| T-4.10b | A second restore after T-4.10 | refuses at step 7 (`unknown`); zero `workspace create` |
| T-4.10c | Restore, step 9 answers Q1 | the record's `runtimeHandle` is as before the restore; nothing created |
| T-4.11 to T-4.14 | The consumer rows of 5.2.6 | as stated there |
| T-4.15 | **Crash inside create:** the stand-in never answers `pane run`; the test reads the record while the call waits | the record has `P` (`create-pending`), `role` (orchestrator) and a live claim with this process's PID |

### 5.3 F-7: startup admits at most one Herdr orchestrator per project (r5 M-4, r6 M-2, r7 M-1, M-3, m-4)

**Files.** core `types.ts`, `index.ts`, `session-manager.ts` (`spawnOrchestrator` `:2419-2911`, restore of an
orchestrator record `:4267-4480`, the dispatch sites of 4.5, `isOrchestratorRuntimeAlive` `:562-584` replaced),
`delivery-lock.ts` (a lock kind `admission`), `runtime-stop.ts` (`:221`); runtime-herdr `index.ts`
(`preflight`); CLI `start.ts` (`checkOrchestratorLiveness` `:895-928`, `runStartup` `:934-1079`), `spawn.ts`
(`runSpawnPreflight` `:67-85`), `lib/preflight.ts`, `doctor.ts` (comment `:187-189`).

#### 5.3.1 The admission lock A

- Name: `deliveryLockName("admission", <real path of sessionsDir>)` (the resolved path when it does not
  exist yet, as `recordLockName` does). `delivery-lock.ts` adds `"admission"` to the kind union.
- Held with `holdDeliveryLock(name, admissionWaitMs)` (default 30 000 ms; a session-manager option for
  tests) by: `spawnOrchestrator`, from before G until the reservation is published (or the start reuses or
  throws); and `restore` of an orchestrator record (`isOrchestratorSessionRecord`), from before G (so before
  the archive copy-back, its first write) until the pending handle is written before step 9. A restore whose
  create runtime is outside the set releases A after G and the copy-back. Released in a `finally`.
- Not obtained in time: `OrchestratorStartBlockedError` `reason: "admission-busy"`: "Another ao process is
  admitting an orchestrator for project <p> now. Run ao start again after it ends." Nothing written.
- Platform without the lock (`isDeliveryLockSupported()` false): a start or restore that selects a runtime
  in the set, or whose G1 selects any record, refuses (`admission-unsupported`; OQ-F6 (a)); a start of a
  runtime outside the set with no selected record runs as today, without A.
- A is held across G's one reuse probe (5.3.2), the project-mode hooks setup and the reservation; never
  across `workspace create`, the agent preparation or `runtime.create`. After A is released, the published
  record (pending handle, claim) carries the protection (4.4).

#### 5.3.2 The guard G (core `spawnOrchestrator`, and restore of an orchestrator record)

G runs under A, after `sessionsDir` is known (`:2444`) and before the first write (`validateAndStoreOrigin`
`:2448`, `setupWorkspaceHooks` `:2488`), in both workspace modes and for every strategy. A restore runs G with
its own record excluded.

- **G1, selection.** List the active records (`listRecordIds`; `readRecordStrict` each). A list or read error
  blocks (`records-unreadable`). Keep each record that `isOrchestratorSessionRecord(id, raw, prefix)` accepts
  and that is **known-Herdr**, whatever its `status`, `activity`, `killedReason` or `launchFailed`, and
  whatever the project's runtime is now:

  | Record | Known-Herdr when | Kind if it blocks |
  | --- | --- | --- |
  | `runtimeHandle` parses to an object with a string `id`, a string `runtimeName` and an object `data` | `runtimeName` in the set | by the rules below |
  | `runtimeHandle` parses but has no string `runtimeName` | the project's selected runtime is in the set | `damaged` |
  | `runtimeHandle` does not parse, or has the wrong shape otherwise | its text matches `/"runtimeName"\s*:\s*"herdr"/`, or the project's selected runtime is in the set | `damaged` |
  | no `runtimeHandle`, a live launch owner (`liveLaunchOwner`) | the project's selected runtime is in the set | `in-progress` |
  | no `runtimeHandle`, no live owner | not selected (today's rule; limit L-2) | |

- **G2, decision per selected record** (in this order):
  1. A live launch owner: `in-progress`.
  2. `damaged`: blocks.
  3. `handle.data.createIncomplete` present (pending or partial): `create-incomplete`.
  4. Not `isReusableOrchestrator` (4.6): `not-reused`.
  5. Not the project-mode record (`<prefix>-orchestrator` while the mode is `project`): `not-reused`. This
     covers every isolated record in a direct core call, and every record of the other workspace mode.
  6. Else probe once: `classifyOrchestratorLiveness(runtimeForHandle(handle, null), handle)`. `alive`: the
     reuse candidate (G3). Anything else: `unproven`.
- **G3, revalidation and result.** After the probe, re-read the record (`readRecordStrict`) and require the
  same launch identity (`holdsExpected(current, launchIdentity(probed))`), still no `launchFailed`, and the
  same `runtimeName`. A difference: G runs again from G1, at most three rounds, then refuses
  (`records-changed`). Any blocking record: throw `OrchestratorStartBlockedError` (`reason: "records"`),
  nothing written. No blocking record: the start goes on under A (project mode: the existing branch with the
  reuse candidate; isolated mode: the reservation, born with `P`).
- **After A is released**, for a blocked start only, G probes each blocking record that has a grammar pane ID
  once (through its own runtime and pins) to fill `answer` in message M; this probe decides nothing.

The project-mode branch after G (`:2495-2597`) uses the classifier with `runtimeForHandle` (4.5): for a
record of a runtime in the set, G's probed answer is used while the record still holds the probed launch
identity; `alive` with strategy `reuse` or `ignore` returns the record (after the reuse revalidation above);
`alive` with another strategy stops through the handle's runtime (Herdr: `unknown`, so it refuses); unknown
throws the blocked error. The concurrent branch (`:2564-2597`) does the same. For tmux and the test runtimes
the branches keep today's logic with the handle's runtime.

#### 5.3.3 Runtime mismatch (review r7 M-3, OQ-F4)

Recommended (a): **block.** A Herdr record is never reused when the project now selects another runtime (G2
step 4), and no other runtime ever probes or stops it (4.5). T-7.8 keeps its oracle "blocked". The owner
changed the runtime on purpose; reuse would keep the old runtime without a word, and the new runtime cannot
stop the old one. Option (b) (reuse it through the herdr plugin) is safe with 4.5 but keeps the old runtime;
it would change T-7.8 to "reused".

#### 5.3.4 The CLI (`start.ts`)

1. `ensureTmux` runs when `project.runtime ?? config.defaults.runtime` is `tmux` (was `defaults.runtime`).
2. Candidates as today (orchestrator, non-terminal), probed with the core classifier through
   `runtimeForHandle` (the CLI already resolves the handle's runtime, `:906`).
3. A candidate of a runtime in the set is reused only when the classifier answers `alive` and
   `isReusableOrchestrator` is true; otherwise the CLI neither reuses it nor refuses by itself: it leaves the
   decision to core G (step 5). The fit-1 interim refusal of the CLI is removed.
4. A candidate outside the set: today's rules (alive reuse, `ended` info line "does not run ... Starting a
   new one", unknown refusal).
5. When an orchestrator will be created (not `--no-orchestrator`, no reuse): the selected runtime's
   readiness, `preflight.checkSelectedRuntime(runtime, name)` (new, `lib/preflight.ts`): `tmux` →
   `checkTmux()`; another runtime → `runtime.preflight?.()`. Then `sm.spawnOrchestrator`.
6. An `OrchestratorStartBlockedError` (guard by code): `spinner.fail("No new orchestrator was started")`, then
   rethrow **the same error object**, so the top-level handler prints `Error:` and exactly message M, with no
   "Failed to setup orchestrator:" prefix. Other errors keep the prefix.

#### 5.3.5 Preflight and `ao spawn` (r6 m-2)

- runtime-herdr `preflight()`: `resolveHerdrEndpoint({ binPath, env: process.env })` with its own `binPath`;
  rejects when the binary is missing, `running !== true` or `compatible !== true`. It caches nothing.
- `spawn.ts` `runSpawnPreflight`: the registry's runtime instance for `project.runtime ??
  defaults.runtime` (`getPluginRegistry`, cached at `create-session-manager.ts:32`, the same instance that
  the session manager uses) and `checkSelectedRuntime`. It runs before `sm.spawn`.
- `doctor.ts` keeps the ambient `checkHerdr()`. Its comment (`:187-189`) changes to: "External-service probes
  per runtime. tmux uses the same check as `ao spawn`. herdr is an ambient check (bare `herdr` on PATH, the
  caller's socket); `ao spawn` and `ao start` ask the selected runtime's `preflight()`, which uses the
  plugin's own binary, so the two verdicts can differ."

#### 5.3.6 `runtime-stop.ts`

The fallback row "destroy resolves, `isAlive` rejects with no-server → `destroyed`" (`:221`) applies only to a
runtime outside the set (a guard for 4.2; Herdr has `stop`).

#### 5.3.7 When a start refuses, the message, the recovery

A start (CLI or direct core) refuses before any write when G finds a blocking record (any kind of 4.6), when
the records cannot be read, when A is busy or unsupported, or when the records change three times during G.
It reuses, and does not refuse, only a live, reusable project-mode record (core) or a live, reusable
candidate (CLI). tmux records stay outside G (limit L-1). With `--no-orchestrator`, nothing of this runs.

**Message M** (`OrchestratorStartBlockedError.message` for `reason: "records"`; each `<...>` in a command is
shell-quoted with `shellEscape`):

```text
No new orchestrator was started for project <project>: AO cannot tell that every earlier herdr orchestrator launch of the project ended.
<id>: <state>. Herdr pane <pane> (terminal <T>), workspace <ws>, worktree <path>, socket <socket>: <answer>.
  Check:  HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>
  If it runs, use it:  ao session attach <id>
  If it does not run, or after you close it:  ao session kill <id> --confirm-runtime-closed <token>
Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.
```

One block per record. `<state>`: `status <s>[, launch failed][, create <stage>]`, or `launch in progress
by ao process <pid>`. Variants: an empty pane ID: `Check:  HERDR_SOCKET_PATH=<socket> <bin> workspace list`
(look for the label `<session>` and the cwd `<path>`); `in-progress`: `Wait for ao process <pid>; if it hangs,
stop that process, then run ao start again.` (no kill line); `damaged`: `Its runtime handle cannot be read
(<first 80 characters>). Retire it by hand: docs/DEVELOPMENT.md, "Retire a Herdr record by hand".` (no F-9
line, F-9 refuses it). `<answer>` (after A, 5.3.2): "herdr answered that the pane does not exist", "herdr
shows the pane with another terminal (<T'>)", "no herdr server answers at the socket", "the herdr check
failed: <first line>", "the pane runs, but the record is not reusable (<why>)", "its herdr pins are
malformed", "no herdr runtime plugin is loaded", "AO has no pane ID for this launch".

The other reasons print one sentence each: `records-unreadable` ("The session records of project <p> could
not be read (<error>); no orchestrator was started."), `admission-busy` (5.3.1), `admission-unsupported`
("This platform has no admission lock; AO starts no herdr orchestrator here."), `records-changed` ("The
orchestrator records of project <p> changed during the check; run ao start again.").

#### 5.3.8 Deferred concurrency limits (review r7 M-1)

- **L-1** tmux and test-runtime orchestrator records are outside G: two simultaneous isolated tmux starts can
  still make two orchestrators, and a tmux and a Herdr orchestrator can exist after a runtime change (today's
  behavior). A serializes them but G does not select them.
- **L-2** A handleless orchestrator record with no live launcher is not selected: a launch by an `ao` build
  before fit-2 that crashed inside a Herdr create. After fit-2, every Herdr reservation is born with `P`.
- **L-3** Worker spawns have no admission rule (there is no one-worker-per-project rule).
- **L-4** A is per sessions directory: two AO configs in different directories for the same repository are
  two projects (their records are in two state directories) and are not serialized.
- **L-5** An `ao` binary before fit-2 that runs during the upgrade takes no A and writes no `P`.

#### 5.3.9 Oracle changes and acceptance tests

**Oracle changes.** fit-1's interim-guard tests (core and CLI; "a Herdr record with the F1 no-server answer,
and with the F1 `pane_not_found` answer, in both workspace modes: no archive, no deletion, no new
orchestrator, exit 1 with today's refusal"): their expected error changes from today's "Cannot tell whether
session ..." text to `OrchestratorStartBlockedError` with message M (core: commit 5; CLI: commit 6). The
no-server controls with runtime `tmux` (`start.test.ts:1033` A1) and `mock`
(`orchestrator-no-server-start.test.ts:52`, `:80`) keep their oracles. `preflight.test.ts` (`checkHerdr`)
keeps its oracles.

**Acceptance tests.** Core tests in a new runtime-herdr file `src/__tests__/fit2-startup.test.ts` (built
core, real plugin, stand-in `herdr` that answers by the `HERDR_SOCKET_PATH` of each call; the caller's own
endpoint answers a healthy, compatible `status server --json` and would accept `workspace create`). CLI tests
in `start.test.ts`, `spawn.test.ts` (mocked core), and a new `start-herdr-guard.test.ts` on the real core.
"Nothing written" means: the sessions directory listing and each record byte-equal before and after; no
reservation, no `.origin` write, no hooks write, no prompt file, no worktree; zero `workspace create`.

| ID | Case | Expected |
| --- | --- | --- |
| T-7.1 | Persisted `status=killed`, `killedReason=runtime`, a pinned Herdr handle; the pin answers F1 no-server (a hidden old server is represented by no answer at the pin); a healthy caller endpoint; direct core; project and isolated mode | blocked, kind `unproven`; nothing written |
| T-7.2 | As T-7.1, the pin answers F1 `pane_not_found`; and another terminal | blocked; nothing written |
| T-7.3 | `status=working`, enriched to `activity=exited` by the real `list()` before the start; both modes | blocked |
| T-7.3b | **Legacy exit-0 answers (review m-4):** the pin answers the 0.8.0 exit-0 `pane_not_found` envelope; and a 0.8.0 `pane_info` with another terminal; project mode, strategy `delete`; direct core | blocked, nothing written. On `389b8dfe` the same test is red (the record is archived and a second orchestrator starts); after fit-1 it refuses with the interim message |
| T-7.3c | T-7.3b in isolated mode | blocked; on `389b8dfe` a second ID is reserved |
| T-7.4 | CLI, mocked core: `sm.spawnOrchestrator` rejects with an `OrchestratorStartBlockedError` | exit 1; `console.error` receives exactly (`"\nError:"` in red, `err.message`) with the same message string; stderr has no "Failed to setup orchestrator"; spinner fail text "No new orchestrator was started"; no "Starting a new one", no "Orchestrator session created". (An error-presentation test.) |
| T-7.4b | **CLI to real core:** `ao start` with the real session manager, the real runtime-herdr plugin and a stand-in herdr; a persisted `killed` Herdr orchestrator record (not a candidate of the CLI) | exit 1 with message M; nothing written; zero `workspace create` |
| T-7.5 | A Herdr record with `launchFailed` and a live pane; a record with `P` and a dead claim | not reused (CLI and core); blocked (`not-reused`, `create-incomplete`); both modes |
| T-7.6 | A non-terminal Herdr candidate that the pin answers no-server (CLI, real core) | the CLI does not refuse by itself; core blocks; exit 1 with M |
| T-7.7 | Control: a live, reusable Herdr orchestrator, project mode, strategy `reuse` (CLI and core); a live isolated one through the CLI | reused; no new runtime |
| T-7.7b | A live isolated Herdr orchestrator in a direct core call; a live one with `status=killed` through the CLI in isolated mode | blocked, `not-reused` |
| T-7.8 | **Runtime mismatch (M-3):** project mode, the project now selects `tmux`; a live fixed-ID Herdr record without `launchFailed`; a registered tmux stand-in that would answer `false` and records its calls; strategies `reuse` and `delete`; direct core and CLI | blocked (`not-reused`, "the project now selects tmux"); **zero tmux calls with the Herdr handle**; the record unchanged |
| T-7.8b | **Concurrent fixed-ID branch (M-3):** a tmux record while the project now selects herdr; the tmux stand-in's `isAlive` writes a new fixed-ID tmux record (another writer) so the reservation fails and the concurrent branch runs | zero herdr calls with a tmux handle; the branch probes through the tmux stand-in |
| T-7.8c | Restore of a Herdr record while the project selects tmux | refuses at step 7 (herdr `unknown`); zero tmux calls |
| T-7.8d | Kill and list with a Herdr handle while no herdr plugin is registered | kill refuses, nothing removed; list keeps the stored status with zero calls of the project's runtime; control: an unregistered `mock`-family handle keeps today's fallback |
| T-7.9 | Damaged records: a handle that does not parse but names herdr; a handle without `runtimeName` in a Herdr project; malformed pins | blocked, `damaged` (malformed pins: `unproven`, answer "its herdr pins are malformed"); zero calls for them |
| T-7.10 | Control: tmux and `mock` no-server records | "gone" and a new orchestrator, as today |
| T-7.11 | Herdr project, the selected endpoint has no server, no old record | the plugin's `preflight()` rejects; exit 1 before `spawnOrchestrator`; nothing written |
| T-7.11b | The selected endpoint answers `compatible: false` | the same |
| T-7.12 | `--no-orchestrator` | no preflight, no G (unchanged) |
| T-7.13 | `ensureTmux` follows `project.runtime` in both directions | no tmux check for a Herdr project; a check for a tmux project |
| T-7.14 | `ao spawn` on a Herdr project with a registered runtime made by `create({ binPath })`; the ambient `herdr` healthy, the selected one unavailable | exit 1 with the plugin's message; the ambient `herdr` never runs; `sm.spawn` not called |
| T-7.15 | `ao spawn` on a tmux project | `checkTmux` as today |
| T-7.16 | `runtime-stop.ts`: a stop-less runtime named `herdr` whose `isAlive` rejects with no-server after a resolved destroy | `unknown`; control: a stop-less `mock` keeps `destroyed` |
| T-7.20 | **Paused create (M-1):** start A (isolated, Claude Code stand-in without `prepareAgentSession`) pauses inside `pane run`; then start B; direct core, and CLI B against real core | B blocked (`in-progress`, the PID of this process); B makes zero `workspace create`; A then completes; a third start is blocked (`not-reused`: isolated) or reuses through the CLI |
| T-7.20b | As T-7.20 with A paused inside the workspace plugin's `create` (before `runtime.create`) | B blocked (`in-progress`) |
| T-7.21 | **Two simultaneous isolated starts (M-1):** `Promise.all` of two direct core starts on an empty project; and a two-process variant (a forked Node process that runs the built core on the same state root) | exactly one reaches `workspace create`; the other is blocked (`in-progress`) or busy |
| T-7.22 | **Workspace-mode change (M-1):** a live isolated Herdr record `-orchestrator-1` while the project is now in project mode; and a live fixed-ID record while it is now isolated; direct core and CLI | direct core: blocked (`not-reused`); CLI: reuses the live candidate (no create), as today |
| T-7.23 | **Revalidation:** during G's probe the stand-in rewrites the record's launch identity (a restore); and writes `launchFailed` | G runs again; the changed record is not reused; after three changes `records-changed`; nothing written |
| T-7.24 | **A busy:** the test holds the admission name; `admissionWaitMs` 50 | `admission-busy`; nothing written |
| T-7.25 | **No lock on the platform:** `isDeliveryLockSupported` mocked false; a Herdr start; and a `mock` start | Herdr: `admission-unsupported`, nothing written; `mock`: as today |
| T-7.26 | Restore of an orchestrator record while another Herdr orchestrator record exists | blocked by G (the restored record excluded); zero runtime calls for the create |

### 5.4 F-9: the owner retires a Herdr record (OQ-F2 (a))

#### 5.4.1 The command

`ao session kill <session> --confirm-runtime-closed <token>`; core `kill(id, { confirmRuntimeClosed: token
})`. No other command or option gets it: `cleanup`, `restore`, the lifecycle, `ao start` and the send path
never pass it, and their option types do not have it.

#### 5.4.2 What it accepts, refuses, removes and keeps

Steps, in order; each refusal changes nothing:

1. Read the record strictly. Missing or unreadable: refuse.
2. **Accept** only a record whose `runtimeHandle` parses to an object with a string `id`, an object `data`
   and a `runtimeName` in the set: any status (also terminal), `launchFailed`, a pending or partial handle,
   an empty ID, malformed pins. **Refuse** a tmux or other runtime's record ("the tmux stop confirms
   itself"), a record without `runtimeHandle`, a handle that does not parse or has no `runtimeName` ("retire
   it by hand", 5.4.4).
3. The token must equal `launchToken(raw)`. Else refuse: "the record now names another launch (token
   <new>); check it again before you retire it".
4. `assertNoLiveLauncher` (a live launch claim refuses).
5. The handle's runtime plugin must be registered (4.5). Else refuse.
6. `stopRuntime`. Confirmed (a later RH): go on as a normal kill.
7. Unconfirmed: one `isAlive(handle)` with the pins. `true`: refuse ("herdr shows pane <pane> with its terminal
   at <socket>: the session runs; close it first"). `false`, any rejection, a pin error, a non-boolean: the
   owner's statement decides.
8. One conditional write on the launch identity: `retiredBy=owner`, `retiredAt`, `retireEvidence=<the answer
   of step 7, at most 200 characters>`, `retireToken=<token>`. A failed write stops the operation.
9. The rest of the kill as today, with `stopWhenReplaced` directly before each removal and inside the plugin
   callbacks: the worktree removal only for a managed worktree (the project checkout is never removed,
   `:655-664`); the OpenCode session only with `--purge-session` (`:3137`); the archive through
   `deleteMetadata` (generation floor and record lock kept), with the retire keys in the archived record.

**It keeps:** the project checkout, the agent session (without `--purge-session`), the herdr server, its
workspaces and panes (F-9 sends no herdr request other than the one read of step 7), the prompt file.

Without the option nothing changes, except the hint of a Herdr kill refusal: "After you check and close it,
retire the record: ao session kill <id> --confirm-runtime-closed <token>".

#### 5.4.3 The owner's check before the attestation

Message M and the kill refusal print what the check needs; the owner can also read the record file. Pin
values in commands are shell-quoted.

1. Read the stored handle: pane ID, expected `terminalId`, `workspaceId`, `workspacePath`, the label (the
   session or tmux name), `herdrBin`, `herdrSocket`, `createIncomplete`.
2. At the pinned endpoint: `HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>` and `... pane process-info
   --pane <pane>`. Compare `terminal_id` with the stored one, and the processes and their cwd with the
   worktree.
3. Empty pane ID: `... workspace list`; look for the label and the cwd.
4. Malformed pins: find the endpoint by hand (`<bin> status server --json` with a candidate
   `HERDR_SOCKET_PATH`); a failed AO read is not a check.
5. A missing pane at the pinned endpoint does not find a hidden old server. Also check that no process has
   its working directory in the worktree, for example `find /proc/[0-9]*/cwd -maxdepth 0 -lname
   '<worktree>*' 2>/dev/null`.
6. Close the pane by hand when it belongs to this launch. Then run F-9 with the token that the check used.

#### 5.4.4 Records that F-9 refuses

A damaged record (no readable handle) is retired by hand, as the procedure in `docs/DEVELOPMENT.md` says:
stop the project's lifecycle worker, check as 5.4.3, move the record to `sessions/archive/<id>_<UTC time>`,
remove a managed worktree with `git worktree remove`. This skips AO's record lock and generation floor: an
emergency procedure.

**Residual (as review r7 states it).** A wrong attestation can remove a worktree that a hidden launch still
uses. The token removes the race between the owner's check and the command only for changes that AO records.

#### 5.4.5 Tests

| ID | Case | Expected |
| --- | --- | --- |
| T-9.1 | Herdr record, `isAlive` true | refused; the record and the worktree byte-equal |
| T-9.2 | `isAlive` false, the right token | archived with the retire keys; the managed worktree removed; the agent session kept; zero herdr close calls |
| T-9.3 | The pin answers no-server | archived; `retireEvidence` names it |
| T-9.4 | An empty-ID partial; a pending handle with a dead claim; malformed pins | archived (zero herdr calls for the empty ID and the malformed pins) |
| T-9.5 | A tmux record with the option; a record without a handle; an unparseable handle | refused; nothing changed |
| T-9.6 | A wrong token; the record restored between the token and the command | refused, the new token printed; nothing changed |
| T-9.7 | A live launcher | refused |
| T-9.8 | The record replaced after the retire write (the stand-in's `isAlive` rewrites it) | the kill stops before any removal |
| T-9.9 | Project mode (`<prefix>-orchestrator`) | archived; the project directory unchanged |
| T-9.10 | A prepared OpenCode session without `--purge-session`; with it | kept; purged |
| T-9.11 | Without the option | today's refusal plus the hint line with the token |
| T-9.12 | `cleanup` over a Herdr worker partial | refuses as before; the session manager's `kill` is never called with `confirmRuntimeClosed` (a spy) |
| T-9.13 | CLI: the option reaches core; exit 0 and 1; a missing token value | commander error, no core call |

### 5.5 F-8: the contracts and documents of fit-2

- `types.ts`: the texts of 4.2 (commit 1).
- `CLAUDE.md`, "Plugin Standards", "Error Handling": add "A runtime's `create` throws a plain error only when
  nothing of the session can exist in the runtime; otherwise it throws `RuntimeCreatePartialError` with the
  handle of what may exist and `closed: "nothing"`, and closes nothing. Core keeps the record, the workspace
  and the agent session then." "Interface Implementation": add the optional `preflight()`. The `isAlive`
  sentence of fit-1: add "at startup, core admits at most one Herdr orchestrator per project and takes no
  Herdr answer as proof that a launch ended".
- `docs/DEVELOPMENT.md`: replace fit-1's interim note with the G rule (5.3.7), the kept failed launch
  (5.2.5), F-9 (5.4) and "Retire a Herdr record by hand" (5.4.4).
- `doctor.ts`: the comment of 5.3.5.
- The F-8 rows of r7 that fit-1 did not change (check on the fit-1 tip): runtime-herdr `index.ts` comments
  (`:16-18`, `:94-97`, `:384-386`, `:479-482`), core `herdr.ts` (`:37`, `:91-92`), `lifecycle-manager.ts`
  (`:214-222`).
- Doc 0004 after the round (development, not in the round's commits).

## 6. Product files

| # | File | Items | Kind |
| --- | --- | --- | --- |
| 1 | `packages/core/src/runtime-errors.ts` (new) | F-3, F-4, F-7 | API |
| 2 | `packages/core/src/types.ts` | F-4, F-7, F-9 | API and contract text |
| 3 | `packages/core/src/index.ts` | exports | API addition |
| 4 | `packages/core/src/herdr.ts` | F-4 (rule Q, `compatible`), `isHerdrPinError` if needed | behavior |
| 5 | `packages/core/src/delivery-lock.ts` | F-7 (lock kind) | type |
| 6 | `packages/core/src/session-manager.ts` | F-3, F-4, F-7, F-9 | behavior |
| 7 | `packages/core/src/runtime-stop.ts` | F-7 | behavior (guard) |
| 8 | `packages/plugins/runtime-herdr/src/index.ts` | F-3, F-4, F-7 (`preflight`) | behavior |
| 9 | `packages/cli/src/commands/send.ts` | F-3 | behavior |
| 10 | `packages/cli/src/commands/start.ts` | F-7 | behavior |
| 11 | `packages/cli/src/commands/spawn.ts` | F-7 | behavior |
| 12 | `packages/cli/src/commands/session.ts` | F-9 | behavior |
| 13 | `packages/cli/src/lib/preflight.ts` | F-7 | behavior |
| 14 | `packages/cli/src/commands/doctor.ts` | F-8 | comment only |
| (15) | `packages/core/src/lifecycle-manager.ts` | F-8 | comment only, if fit-1 did not change it |

**14 product files** (15 with the conditional comment): 13 with a behavior, type or API change, one or two
comment-only. No agent plugin changes in fit-2 (F-6 is fit-1). Docs: `CLAUDE.md`, `docs/DEVELOPMENT.md`.
Tests (new or changed): runtime-herdr `index.test.ts`, new `fit2-create-rollback.test.ts`, new
`fit2-startup.test.ts`; core `runtime-errors.test.ts` (new), `herdr.test.ts`, `runtime-stop.test.ts`,
session-manager tests for send, kill, restore and the dispatch sites; CLI `send.test.ts`, `start.test.ts`,
new `start-herdr-guard.test.ts`, `spawn.test.ts`, `session.test.ts`, `lib/preflight.test.ts`.

## 7. Implementation order, commits, gates and size

**G0, before commit 1.** On the fit-1 tip: check the names of 2.1 with `git grep`; run the full gate set
once and record the `SAME_ID_DEFECTS=red` failing set (the fit-2 reference).

| # | Commit | Content | Intermediate oracles |
| --- | --- | --- | --- |
| 1 | `feat(core): add the runtime error types and the create contract` | `runtime-errors.ts` with guards; `LAUNCH_END_UNPROVEN_RUNTIMES`; `Runtime.preflight?`; the `Runtime.create` doc; `herdrPreRequestRefusal`; `isHerdrPinError` if missing; the `admission` lock kind; `launchToken`; exports | additive; new unit tests only (guards across copies, rule Q with the `r8_` texts and the near misses of T-4.1b) |
| 2 | `fix: refuse a send to a blocked herdr agent` | F-3 (plugin, core send, CLI send) | `index.test.ts:304` changes |
| 3 | `fix: keep the resources of a failed herdr create` | F-4: plugin steps 1 to 6 (Q, `compatible`, post-run `pane get`, no close); core catches and `rollbackLaunch`; restore step 9; the pending handle and the claim (4.4) | the create-test index migration (call 3 `pane get`), `:140`, `:158`. fit-1's interim startup tests stay green: they use persisted records with handles. A concurrent project-mode reservation of a runtime in the set now has `P`, so the interim guard refuses it as unknown instead of "already exists but is not in a reusable state"; no existing test meets that case with herdr |
| 4 | `fix: probe and stop an old record through its own runtime` | 4.5 at every listed site (the startup sites still call fit-1's interim function, now with the handle's runtime) | none; T-7.8c, T-7.8d added |
| 5 | `fix: admit at most one herdr orchestrator per project` | A, G, the classifier, `isReusableOrchestrator`, the restore admission, `runtime-stop.ts`, message M; the interim `isOrchestratorRuntimeAlive` removed | fit-1's **core** interim tests expect `OrchestratorStartBlockedError` and M; the CLI still has its interim guard, and a blocked error reaches the CLI with the old "Failed to setup orchestrator:" prefix (the CLI tests mock core, so they stay green) |
| 6 | `fix: ao start and ao spawn follow the core admission` | CLI start (5.3.4), `checkSelectedRuntime`, runtime-herdr `preflight()`, `spawn.ts`, the `doctor.ts` comment | fit-1's **CLI** interim tests change to the classifier path and M |
| 7 | `feat: retire a herdr record on the owner's word` | F-9: kill option, core steps, CLI option, the hint | the Herdr kill refusal text gains the hint line (its tests) |
| 8 | `docs: the herdr fit-2 contracts` | 5.5 | review |

**Gates.** Each commit: `pnpm build`, `pnpm typecheck`, `pnpm lint`, the tests of the changed packages, under
`env -i` with a scratch `HOME`. After commit 8: the full `pnpm -r --no-bail test` with a fake `HOME` and no
agent binary or `herdr` on `PATH` (the root run has the live OpenCode block); `SAME_ID_DEFECTS=red`: **the
failing set must equal the G0 set** (no fit-2 test is a red-set defect test, and no red-set test concerns a
Herdr create or startup); D2-style non-vacuity: undo each of F-3, F-4 (rule Q, the pending handle), M-3
dispatch, A, G and F-9 in a scratch copy, and name the tests that fail. No live herdr run is part of the
gate.

**Size.** About 1,400 product lines (F-3 120, F-4 with 4.4 330, dispatch 90, A and G 380, CLI and preflight
170, F-9 170, commit 1 140) and about 2,600 test lines. **L.** The risk is in commits 3 and 5.

## 8. Texts for the documents (after the implementation)

- `types.ts`: 4.2. `CLAUDE.md`, `docs/DEVELOPMENT.md`, `doctor.ts`: 5.5 and 5.3.5.
- Doc 0004 after fit-2: section 1 (the failed create keeps its resources; the startup admission; F-9), the
  R4 notes (rule Q), section 8 (recovery).

## 9. What fit-2 keeps as it is

- The lifecycle's status rules (the outage rule, `isRecoverableKill`), and Herdr stays non-authoritative.
- W-4 (duplicate delivery from `done`), the raw-text fallback when no agent is detected, the delivery
  timeouts.
- `ao doctor`'s ambient check; runtime-herdr `detect()`.
- The agent empty-ID fallbacks (3.3).
- The Herdr `stop` (`unknown`, no close); no AO path sends `pane close` or `workspace close`.
- Outside the round: RH (r6 B-1: proof that S's session ended; B-2: binding the launch submission to S's
  listener; M-3: S-based liveness separate from retire authority). G keeps retire authority off until RH.

## 10. Open questions for the owner

| OQ | Question | Options and residuals | Recommendation |
| --- | --- | --- | --- |
| **OQ-F4** (new, M-3) | A live Herdr orchestrator while the project now selects another runtime | **(a) Block** (T-7.8 "blocked"): the owner retires it (F-9) or switches the runtime back. **(b) Reuse** through the herdr plugin (safe with 4.5); the old runtime stays without a word; T-7.8 becomes "reused" | **(a)** |
| **OQ-F5** (new) | `ao send` to a kept failed launch | **(a) No special policy**, documented and tested (5.2.6): a `launch-unconfirmed` pane whose agent runs with terminal T gets the send. **(b) Refuse** a send to a record with `createIncomplete` (a new core guard) | **(a)**: the post-run check already sends nothing to a changed terminal |
| **OQ-F6** (new) | A platform without the abstract-socket lock (macOS) | **(a) Refuse** a Herdr orchestrator start or restore there (the delivery-ledger precedent). **(b) Run G without A**; residual: two simultaneous starts can both pass G | **(a)** |
| **OQ-F7** (new) | The rule Q residual R-Q (4.3) | **(a) Qualify Q0, Q1, Q2** with the r8 evidence; a server that imitates the CLI's text could get an ordinary rollback. **(b) Qualify only Q0**: every create failure after the endpoint check keeps the resources (more kept failed launches, for example on every protocol mismatch between check and create) | **(a)** |
| **OQ-F8** (new) | The F-9 token | **(a) Required** (5.4.1): a launch that changes between the owner's check and the command refuses. **(b) No token**: the review's inspection-to-command race stays | **(a)** |

The owner decided OQ-F1 (b), OQ-F2 (a) and OQ-F3 (b) (section 2.2). The r6 questions OQ-1, OQ-2, OQ-6
(fit-1 implements their (a)), OQ-5 (W-4 later), OQ-7 (changed by M-1 and M-3: admission in core, strict
records, the selected runtime's readiness) and OQ-9 (no handoff for a record without S) keep the
recommendation (a); fit-2 follows it.

## 11. Measurements, deviations and checks

- **Measurement r8** (section 3.1): the isolation of the step 2 brief with the names of this round: marker
  `/tmp/aohd5-marker`, root `/tmp/aohd5`, a scratch `HOME` and XDG directories, a git identity in the scratch
  `~/.gitconfig`, `env -i` and a link-only `PATH` (`herdr` linked, never moved; `python3`; `strace`). No herdr
  server, no tmux, no `ao`, no network (13 `connect()` calls, all `AF_UNIX`). Fixtures: `r8_cli_forms_log.txt`,
  `r8_forms_script.txt` (the script as text), `r8_strace_connects.txt`, `r8_status_json_ping_protocol_19.json`,
  `r8_status_json_ping_protocol_23.json`. Cleanup: no own process, the herdr directories unchanged,
  `~/.ao/bin` unchanged, `/tmp/aohd5` and the marker removed.
- **Deviations.** (1) Rule Q drops the r7 stage `launch-refused` (review M-2). (2) The pending handle and the
  launch claim also protect worker spawns and restores of a runtime in the set, not only orchestrators (one
  mechanism for the three create sites). (3) G also runs for a restore of an orchestrator record. (4) Doc
  0004 gets the r8 facts and the fit-1 and fit-2 pointers.
- **Checks.** `git status -s` shows only this file, doc 0004, the `r8_` fixtures and the `.agent_*` files;
  `git diff --exit-code -- packages` passes.
