# Herdr fit-2 design r8 review — 2026-10-22

NOT-SOUND

Counts: **0 blocking, 3 major, 5 minor findings**, with IDs local to this review. The admission-lock subject can change during first directory creation; the CLI reuse shortcut still lacks launch-claim exclusion and post-probe revalidation; and the new restore claim has no specified successful settlement for a prepared agent. Rule Q substantially closes r7's rollback qualification finding for the measured CLI, subject to the explicit R-Q decision. The implementation plan needs another revision before fit-2 is ready.

Baseline: `0488d24d` (verified with `git log --oneline -1`). This is an independent source/design audit, not an implementation or a live Herdr measurement. The unlanded fit-1 spec and brief are the base, not code assumed to be present at HEAD. Product behavior below is source-composed unless explicitly identified as the isolated standard-library check.

## Initial isolation evidence

Created `/tmp/aofr8-marker` before source review. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Review notes, before consulting the author report

Read the r8 design, review r7, and the requested fit-1 sections/brief in that order. R8 explicitly replaces both interim startup guards and leaves RH-A/RH-B out. The proposed pending handle is published in the atomic reservation, with a claim even for agents lacking `prepareAgentSession`; that closes the specific handleless in-flight reservation window of r7 on paper. The remaining checks concern the CLI reuse shortcut, restore lock ordering/claims, publication failures, exact Q qualification, and the consumer/file-list contract.

Source cross-check notes (still before the author's report):

- `session-manager.ts:2055` and `:2458` currently acquire claims only for prepared agents; atomic publication at `metadata.ts:900`–`:955` can carry the proposed initial role/pending handle/claim without changing metadata's API. `own.write` advances its launch identity (`session-manager.ts:1734`–`:1739`).
- The CLI's candidate reuse branch (`start.ts:1008`–`:1059`) uses a snapshot across awaited probes and does not call core. R8 §5.3.4 specifies a classifier and reuse predicate there, but no fresh record read, live-claim check or admission lock for this shortcut; §5.3.2 G3 only governs core G. This needs an explicit reuse protocol and test.
- R8 §4.7/§5.2.6 promises a token in `ao status`'s failed-launch line, but `status.ts:229`–`:232` prints only `info.launchFailed`, and `status.ts` is absent from §6's 14/15-file list.
- Restore's missing-workspace path awaits `workspace.restore` and `postCreate` (`session-manager.ts:4497`–`:4512`) before step 9. R8 holds A until its step-9 pending write (§5.3.1), while also saying A never spans workspace creation. The transition ordering must be made explicit.

Additional independent admission check: §5.3.1 derives A from `realpath(sessionsDir)` when present and `resolve(sessionsDir)` when missing, following `metadata.ts:234`–`:241`. Those need not name the same lock across first directory creation when a parent is a symlink. Unlike admission, `reserveSessionRecord` creates the directory before computing its record lock (`metadata.ts:907`–`:908`). The first-start name transition needs qualification; a second process can enter after mkdir and before the first reservation's link publication.

Isolated standard-library check of the specified lock-subject algorithm (no product import or socket): under `env -i HOME=/tmp/aofr8/home TMPDIR=/tmp/aofr8/tmp PATH=/tmp/aofr8/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`, with only a Node link on PATH, a symlinked parent yielded:

```json
{"before":"/tmp/aofr8/alias/sessions","after":"/tmp/aofr8/real/sessions","beforeLock":"ao-delivery-44402-admission-d8dbe8f5b9ef855cea30521a85e1935a","afterLock":"ao-delivery-44402-admission-592685b08281f0222c722deb87069a94","sameLock":false}
```

This proves the proposed name is unstable; the two-process admission execution is source-composed, not a product test. No Unix socket or external command was started by the Node check.

Only after the above source/fixture reading and independent notes did I read the author's r8 report (the r8 section at the top) and r8 brief. They repeat the no-create-under-A, every-old-record dispatch and revalidation assertions; they supply no extra protocol resolving the gaps above. The report's older appended rounds were not used as independent evidence for r8.

## Findings

### M-1 — A's name changes across first mkdir under a symlinked parent, allowing two admissions

**Design:** §5.3.1, lines 485–486; §4.4; T-7.21. **Source:** `packages/core/src/metadata.ts:234`–`:241` (`recordLockName`'s realpath/resolve rule), `:907`–`:908` (mkdir precedes the record lock), `:945`–`:955` (reservation publication); `packages/core/src/session-manager.ts:1329`–`:1366` (numbered allocation); `packages/core/src/delivery-lock.ts:45`–`:48` (subject hashing).

The specified fallback is not a stable name. For a missing sessions directory under a symlinked state-root parent, the first caller hashes its lexical absolute path. Once that caller creates the directory, a second caller hashes its real path. The isolated Node check quoted above produces different names even with exactly the same `sessionsDir` argument before and after mkdir. This is one physical sessions directory, not L-4's two state directories.

A source-composed execution: A takes the lexical lock, passes empty G, and enters reservation. After mkdir but before link publication, B takes the different realpath lock and also passes empty G. Per-record locking can serialize publication of `-orchestrator-1`, but it cannot undo B's earlier successful G: the losing numbered allocator retries `-orchestrator-2`. Both starts then reach workspace/runtime creation. Holding A across reservation is insufficient when the two callers hold different A names. This window crosses processes, so synchronous mkdir/link in one Node thread does not close it.

**Required:** derive an invariant canonical subject before acquiring A, including when the leaf does not exist (for example canonicalize the nearest existing ancestor and append the missing suffix, refusing unexpected lookup failures). Keep that subject fixed through the operation and use it in every admission path. Add a two-process first-start test with a symlinked parent, a controlled pause after directory creation and before reservation publication, and assert exactly one workspace/runtime launch. The existing concurrency tests on already-created temp directories do not cover this.

### M-2 — CLI reuse bypasses the live-launch rule and the promised post-probe revalidation

**Design:** §4.6, §5.3.2 G2/G3, §5.3.4 steps 2–3, §5.3.7; T-7.20/T-7.23. **Source:** `packages/cli/src/commands/start.ts:1008`–`:1059`; `packages/core/src/session-manager.ts:2875`–`:2906` and `:2324`–`:2358` (handle publication precedes awaited setup/confirmation); `:354`–`:375` (launcher check).

R8 only gives core G the admission lock and a fresh record read after probing. The CLI still probes the `sm.list()` snapshot and takes its own successful-reuse branch without calling `spawnOrchestrator`. Its proposed `isReusableOrchestrator` checks failure, incomplete-create marker and runtime match, but **not a live launch claim**. No CLI step rereads launch identity or `launchFailed` after its awaited liveness check.

This creates two uncovered executions. First, pause start A after it publishes its successful Herdr handle and before `postLaunchSetup`/`confirmLaunch` finishes. Its record is nonterminal, has no `createIncomplete`/`launchFailed`, and still has a live launcher. CLI B sees `alive`, passes the proposed reuse predicate, and reports successful startup. Core G would refuse exactly this record as `in-progress`. A can subsequently fail setup and keep a failed launch. Second, replace the record or write `launchFailed` during the CLI's probe: B still reuses its stale candidate. R8's T-7.23 exercises core G, and its paused-create cases stop while P is still present; neither tests these shortcuts.

**Required:** specify a shared admission/reuse decision for the CLI shortcut, including isolated candidates, rather than assuming a later call to core G. Require a strict fresh read, matching launch identity, no live launcher, no `launchFailed`/incomplete marker, and a fresh runtime-match/reuse decision after every relevant awaited probe and before returning reuse. Preserve the intended isolated CLI reuse control. Add real-core CLI tests paused after handle publication and with record replacement/failure during the CLI probe. Merely applying the shared liveness classifier does not supply these checks.

### M-3 — Successful restore of a prepared agent has no claim-release path

**Design:** §4.4, especially lines 237–242; §5.2.4–§5.2.5; §7 commit 3. **Source:** `packages/core/src/session-manager.ts:4361`–`:4381`, `:4533`–`:4566`, `:4595`–`:4628`; contrast spawn's prepared-agent clearing at `:2332`–`:2347` and orchestrator clearing at `:2882`–`:2901`. OpenCode supplies both `prepareAgentSession` and `getRestoreCommand` (`packages/plugins/agent-opencode/src/index.ts:1100`, `:1453`).

R8 adds P and a claim to all Herdr restores. Its explicit success clearing applies when the claim was taken **only** for the unproven runtime, with no `prepareAgentSession`; it assumes the prepared path clears after `confirmLaunch`. That is true for spawn/start, not restore. Restore builds a restore command, creates a runtime, updates the handle, optionally runs nonfatal `postLaunchSetup`, and returns. It never calls `prepareAgentSession` or `confirmLaunch`, and its existing final metadata update clears no claim.

Use a terminal handleless Herdr record with a valid stored OpenCode session, the same reachability setup used by T-4.10, but make create succeed. Under the written changes it acquires a claim and has no prescribed release. A direct-core or delivery-triggered restore in a long-lived AO process can therefore remain `in-progress` for that process's entire lifetime even after restoration completed and the agent exited. G, kill/F-9, cleanup and another restore then see a live launcher. An ordinary CLI restore exiting quickly can hide this defect.

The end-path audit should also cover a successful create followed by a setup/confirmation failure: today's generic `keepUnconfirmedLaunch` keeps the claim, whereas r8's new explicit clearing is described under the `partialRecord` rollback. A kept post-create failure should not remain owned indefinitely by a resident caller either.

**Required:** define claim ownership and settlement separately for spawn, start and restore, for both kinds of agent. Restore must conditionally release its own claim on success and every settled failure, including nonfatal setup exceptions and write-conflict/error paths; warn and retain resources if settlement cannot be recorded. Include a resident-process test with an OpenCode-shaped stand-in and no new agent/model process, plus retained post-create failures. Do not use an unconditional clear that could erase a later operation's claim.

### m-1 — Restore holds A across workspace creation despite the stated lock boundary

**Design:** §5.3.1 lines 489–499 and §4.4's step-9 pending write. **Source:** `packages/core/src/session-manager.ts:4497`–`:4512`; `packages/plugins/workspace-worktree/src/index.ts:324`–`:352`.

The restore hold lasts until P is written just before runtime create in step 9. Step 8 first awaits `workspace.restore` and `postCreate`; the retained workspace plugin performs prune, optional fetch and `git worktree add` there. This is awaited workspace creation under A. It contradicts both the design and author report's claim that A never spans workspace creation. A stalled restore can hold project admission indefinitely while other callers time out.

**Required:** give the restore transition its own ordering: retain the old handle until its stop decision, then publish an owned, recognizable pending reservation/claim before releasing A and doing workspace restoration. Specify rollback of that transition if workspace restoration fails. Alternatively explicitly revise the lock boundary and justify its blocking behavior; the present two incompatible instructions are not implementable as one protocol. Add a test paused inside workspace restore and another where it throws, checking A's release and the retained record.

### m-2 — The token's status display is absent from the product and test lists

**Design:** §4.7 line 295, §5.2.6 T-4.12, §6, §7. **Source:** `packages/cli/src/commands/status.ts:29`–`:47`, `:87`, `:229`–`:232`; existing status oracle at `packages/cli/__tests__/commands/status.test.ts:586`–`:609`.

The design promises the computed launch token in the failed-launch line. Today's `SessionInfo` carries only the failure text, and its renderer prints only that text. Updating the failure string in core would not satisfy the promised token contract: `launchFailed` is capped at 600 characters, can predate the current launch, and does not change with launch identity. `status.ts` and its test are absent from the complete file list and commit allocations.

**Required:** add status's token derivation/data plumbing/rendering and tests to the product/test list and allocate them to a commit after the token export. State the JSON policy too. The minimum becomes **15 product files, 16 with the conditional lifecycle comment**, rather than 14/15. Keep stored identity separate from capped diagnostic text.

### m-3 — “Every old-record probe” omits cleanup, and the generic kill fallback is not today's behavior

**Design:** §4.5, §3.2 dispatch facts, §6–§7 commit 4; T-7.8d. **Source:** `packages/core/src/session-manager.ts:3417`–`:3422` (cleanup), `:3075`–`:3105` (kill), `:1513`–`:1517` (list fallback).

Cleanup still directly calls the newly configured `plugins.runtime.isAlive` with an old handle. R8's supposedly exhaustive replacement sites do not name it. For example, a Herdr worker with a tmux-selected project can be probed through tmux before kill's correctly dispatched Herdr stop refuses. That stop prevents removal, so this is not another proven destructive bypass; it does contradict the dispatch contract and zero-wrong-runtime-call objective. TODO_TRACKING's same-ID follow-up F-3 already identifies this site.

Also, a missing non-Herdr plugin does not currently have a fallback in kill: the registry lookup is null and the stop is skipped. List alone has the specified fallback. Applying the proposed generic fallback at kill changes that behavior and can call the project's runtime with a foreign handle. The test's phrase “today's fallback” cannot cover both sites.

**Required:** include cleanup's old-handle probe in the dispatch migration and test a Herdr worker after a runtime change, with zero tmux calls on that handle. Define non-set compatibility per call site: preserve kill's current behavior or explicitly propose/test the change, rather than attributing list's fallback to kill. Keep the missing-Herdr-plugin refusal unchanged.

### m-4 — T-9.8 cannot inject its promised replacement after the retire write

**Design:** §5.4.2 steps 7–9 and §5.4.5 T-9.8 (line 763). **Source:** `packages/core/src/session-manager.ts:3108`–`:3128`, `:3167`–`:3191`, `:3204` (removal checkpoints).

T-9.8 says replacement occurs **after** the retirement write, through the stand-in's `isAlive`. But the sole `isAlive` call is step 7, and the retire CAS is step 8; no such call occurs afterward. That injection tests the retirement CAS refusing a pre-write replacement, not the checks protecting resources after retirement is recorded.

**Required:** split the tests. Replace during step 7 to prove step 8 writes nothing and removes nothing. Then replace after a successful step-8 write, during an awaited workspace-removal preamble or purge-holder lookup, so the actual `stillOwned`/`stillUnheld` callback must stop removal. Assert no worktree/agent-session removal and no archive of the replacement. Include a failed conditional retire write explicitly. These tests must exercise different checkpoints.

### m-5 — The pending-handle rationale misstates `recordMayOwnRuntime`

**Design:** §4.4 lines 247–250. **Source:** `packages/core/src/session-manager.ts:1652`–`:1659`, `:1673`–`:1679`.

The assertion that `recordMayOwnRuntime` “never matches an empty ID” is false. `recordNamesRuntime` compares IDs for equality with no nonempty check, so two Herdr handles with `id: ""` match. A handleless record also returns true from `recordMayOwnRuntime`. These are conservative “may own” answers; this correction does not justify weakening them or imply unsafe deletion.

**Required:** correct the claimed fact and the pending-handle consumer rationale. Retain the conservative ownership result and rely on Herdr's empty-ID read rejection/unknown stop, not a nonexistent ownership exclusion.

## Closure of review r7

“Closed” means adequate at design level, subject to implementation and stated owner choices. The unlanded fit-1 implementation was not inspected.

| r7 item | State in r8 | Evidence / qualification |
| --- | --- | --- |
| M-1, admission and in-flight reservations | Partly closed | Atomic P/role/claim publication covers the originally paused create, and core G rereads after probes. New M-1/M-2 leave the admission name and CLI reuse outside that proof; new M-3/m-1 leave restore settlement/order incomplete. |
| M-2, unqualified rollback | Closed for the measured CLI, conditional on OQ-F7 | Q0 precedes mutation; Q1/Q2 have request-count evidence, unknown and legacy failures retain resources, and `launch-refused` is removed. Exact server imitation remains explicitly outside Q's trust boundary. |
| M-3, dispatch and mismatch | Substantially closed; partly open | Core startup, concurrent fixed-ID, restore, kill and list sites are specified; missing Herdr plugins stay unknown; mismatch blocks. Cleanup is omitted and kill's generic compatibility rule is misstated (m-3). |
| m-1, API-before-use/commit order | Closed for the original dependency defect | Commit 1 adds `Runtime.preflight?`; plugin use waits until commit 6. Fit-1 owns discovery-call migration, fit-2 commit 3 owns post-run call migration. Revised findings require additional commit/test allocation. |
| m-2, public contracts/doctor/file count | Partly closed | The create contract, CLAUDE plugin guidance and doctor comment are explicit. The newly promised status-token behavior makes the file list incomplete (m-2). |
| m-3, numeric exit/agent fallbacks | Closed | §3.3 matches numeric `execFile` code and the four actual agent branches, with the runtime-positive lifecycle gate kept. The separate new pending-ownership factual error is m-5 here. |
| m-4, weak CLI acceptance | Closed for that test | T-7.4 now asserts exact arguments/no wrapping; T-7.4b uses real core and a persisted killed record; T-7.3b/c cover exit-0 legacy negatives. CLI-reuse races are separate missing tests (M-2). |
| F-9 safeguards | Closed in principal policy; tests need repair | Accept/refuse scope, live-launch refusal, pins, managed-directory removal, archive/floor preservation, purge opt-in and token CAS are present. T-9.8 needs m-4's sequencing correction. |
| Retained-record consumers | Mostly closed | §5.2.6 explicitly covers status, default kill, cleanup, restore/retry, start, lifecycle and send. Status-token plumbing and claim settlement remain missing. |

## r6/r5 carry-forward table

These states concern the fit portion only. RH proof obligations remain deferred rather than silently counted as fixed.

| Earlier item | State in r8 | Basis |
| --- | --- | --- |
| r6 M-1, core partial-create rollback | Closed in the intended error flow | All three create sites receive a partial handle; owner-checked publication precedes an unknown Herdr stop, which retains runtime/worktree/agent/record/prompt. Unknown ownership writes nothing and warns. Claim completion is the separate M-3 here. |
| r6 M-2, status-independent/isolated startup | Partly closed | Strict disk selection ignores terminal/enriched status and works in both workspace modes; stable admission and CLI reuse still need M-1/M-2. |
| r6 m-1, EOF range/unretained ffi claim | Closed, preserved | R8 makes neither the withdrawn ffi claim nor a new universal EOF bound; it preserves r7's scoped corrections. No new qualification of EOF is implied. |
| r6 m-2, selected spawn preflight | Closed at design level | Selected registry instance, custom binary test, optional preflight API and corrected ambient-doctor comment are explicit. |
| r6 OQ-14 / OQ-F1 | Decided and applied | Owner chose (b): no Herdr answer retires at startup before RH-A. False and no-server both remain unknown in the classifier. |
| r5 M-2, unbound close cleanup | Closed across the two specs | Fit-1 F-5 refuses destroy; fit-2 removes create's close and qualifies plain errors through Q. No automatic bound close is introduced. |
| r5 M-3, executable/socket pins | Closed in the fit-1 base spec | Absolute executable/socket, malformed-pin refusal and legacy controls are specified; r8 uses them. A path pin is not a server-incarnation or content pin. |
| r5 M-4, conservative startup | Partly closed | Correct refusal policy and selected readiness; new M-1/M-2 prevent full closure. |
| r5 m-2, doc 0004 wording/scope | Closed, preserved | `git show 0488d24d` retains today's two close paths, labels fit-1 unlanded and fit-2 unbuilt, and adds bounded fixture-backed facts. |
| F-1 / F-2 / F-5 / F-6 | Base spec, out of implementation scope | The requested fit-1 sections and brief supply each dependency, including grammar/no-call behavior and pins. |
| F-3 | Closed at design level | Typed refusal preserves admission uncertainty; core avoids restore retry; CLI has precise text/no stack; idle-consumption control is kept. |
| F-4 | Closed at principal retention level | Q plus partial publication/unknown stop closes r7's arbitrary-F1 escape; resident claim settlement still needs M-3. |
| F-7 | Partly closed | Admission/revalidation gaps above remain. |
| F-8 | Partly closed | Contracts/doctor are covered; status-token file count and new factual text require corrections. |
| W-4 | Explicitly deferred | No new claim that sends from `done` are deduplicated. |
| r6 B-1/B-2/M-3 (RH) | Deferred | Session-ended proof, submission binding and S-based liveness/retirement separation are not supplied by fit-2. |

## Admission limits, R3 ownership and relaunch integration

The existing abstract-socket primitive is suitable: kernel release, same-process exclusion and bounded wait already exist (`delivery-lock.ts:74`–`:106`). The new lock kind is additive. G preceding origin/hooks/reservation, P born in the atomic link publication, and P remaining after a crash are the right shape. The guard must remain independent of lifecycle's enriched/persisted killed status. G3's identity check also correctly does not cancel solely for a status bookkeeping write. The first-directory canonicalization and the CLI shortcut still require the changes above.

| Limit | Assessment |
| --- | --- |
| L-1, tmux/test records outside G | Acceptable only with the stated narrow guarantee: no second Herdr admission from a participating fit-2 start. Mixed-runtime and multiple tmux orchestrators remain possible. Do not advertise universal one-orchestrator-per-project exclusion. |
| L-2, old handleless/dead-claim records | A real upgrade limitation, not evidence of death. Accept only with an owner audit/recovery of pre-fit-2 in-flight/crashed launches; P cannot retrofit those records. |
| L-3, workers have no project-wide admission rule | Acceptable: distinct worker IDs are intended. Same-ID restore/kill serialization is a different requirement, not solved by this exemption. |
| L-4, different sessions directories/configs | Acceptable project boundary. It does not excuse different A names for the same physical directory (M-1). |
| L-5, old binaries participate in no new protocol | Real and acceptable only as an explicit deployment constraint. A stopped/checked old fleet is needed for a strong upgrade guarantee; fit-2 does not implement the separate RW fence. |

Using launch claims for unprepared Herdr agents is limited overlap with the same-ID arc R3, which TODO_TRACKING describes as a per-ID lease covering operation/workspace/OpenCode ownership (`development/TODO_TRACKING.md:1364`–`:1374`; `docs/DEVELOPMENT.md:573`–`:575`). A is a per-project admission lock; P and `launchPid`/`launchPidStart` are launch markers. They do **not** replace that lease. Workers remain outside A, kill never acquires an operation claim, and restore only writes the new marker just before create. Existing `readLaunchClaim` can also warn and return null when it cannot read this process's start identity (`session-manager.ts:338`–`:345`); P still conservatively blocks Herdr starts, but this is not an infallible process-ownership protocol.

The unlanded relaunch branch has an explicit reverse-order M-6 design: **both restore and kill** must acquire a shared CAS operation claim before awaited destructive/allocation work, compare the old claim as well as launch identity, carry it through callbacks, and conditionally release their own claim on every end path. This is stated in `development/reviews/session_relaunch_review_r2_sol61.md:93`–`:99` and r3 `:155`–`:159`. R8 does not discuss that integration. Its restore claim at step 9 is too late to close M-6; adding no-preparation launch claims alone cannot close it, and clearing by launch identity alone must not erase a future different claim on the same identity.

There is no need to expand fit-2 into tmux relaunch/R3. Name the shared-key/restore/kill integration conflict explicitly, retain the outstanding M-6 limitation, and reserve one owner-aware settlement protocol for the eventual merge. The new claim work must not be reported as completion of R3 or relaunch M-6. No relaunch code, branch or other session was changed or executed in this review.

## Rule Q, retained resources and F-9

Q0 is safe by control flow: only endpoint discovery has run. Q1 is deliberately narrower than fit-1's no-server read mapping: it needs the exact pinned socket and suffix. Q2 uses a measured CLI-generated protocol prefix with the strict F1 envelope and expected command ID. The fixture log shows those request suppressions and separately proves that arbitrary F1 codes and server-supplied no-server prefixes can arrive **after** mutation submission. This is the important distinction missing from r7.

The tables correctly distinguish Q **during workspace create** (plain error) from the same refusal **during pane run** (partial `launch-not-submitted`, because a workspace already exists). No arbitrary F1, exit-0 legacy error, transport error, timeout or signal authorizes ordinary create rollback. The unknown post-run terminal result is a partial; it cannot become deletion authority. Keeping a launch script means AO does not unlink an existing script after possible admission: an executed script can already have removed itself, as today's script does (`runtime-herdr/index.ts:186`). No fixture proves all possible server error atomicity, and none is needed if those cases conservatively retain resources.

F-9 is an expressly authorized owner attestation, not a stronger Herdr stop. Its accept list includes terminal/failed/empty-ID/malformed-pin records, and its refuse list includes wrong runtime, unreadable or absent handle, wrong token, live launcher and missing Herdr plugin. Requiring the SHA-derived token strengthens the human-check-to-command boundary for AO-recorded launch changes. The conditional retire write and each existing removal check must remain separate requirements; one successful CAS cannot authorize later removal of a replacement.

The removal scope follows actual kill: project checkout excluded by `shouldDestroyWorkspacePath`, agent session retained unless purge, archive through `deleteMetadata` with generation floor/lock. The server, workspaces, panes and prompt file stay. The malformed-pin override and hidden-server residual are deliberate owner choices, so the manual inspection must include expected terminal, path/label, endpoint and processes. The damaged-handle emergency procedure explicitly bypasses normal lock/floor discipline and should remain an emergency instruction. No cleanup/restore/send/lifecycle option gets the attestation. T-9.8 must be repaired as m-4 states.

Automatic confirmed cleanup/second restore still depends on a later qualified RH stop; a terminal read after `pane run` does not bind that earlier input to the original listener/terminal. Fit-2's conservative G and owner attestation do not themselves require RH-A/RH-B to ship.

## Fit-1 base, API and implementation plan

The requested fit-1 sections and brief provide every named dependency: F1 reader/IDs/no-server mapping, pane grammar, endpoint resolution/pins and handle-compatible process readers, destroy refusal, interim startup guard and docs. `HerdrPinError`'s code/guard may need the additive commit-1 completion already specified by r8; `compatible` is expressly new in fit-2. Fit-1 supplies no `Runtime.preflight`, consistently with its brief §2 point 3. Its discovery fs mock/call-index migration belongs to fit-1; r8 only adds post-run pane get. G0 should verify actual exported names and behavior on the future fit-1 tip rather than assuming the unlanded implementation matches.

Replacing core's interim `isOrchestratorRuntimeAlive` in commit 5 and CLI's interim `checkOrchestratorLiveness` in commit 6 is a clean split if both packages' distinct oracles move with those commits. The shared classifier keeps Herdr negatives unknown, the runtime mismatch blocks before exemption, and `runtime-stop.ts:221` gains the stop-less Herdr no-server guard without changing mock/tmux controls. `Runtime.preflight?` is additive and uncached; `getPluginRegistry` already supplies the same selected instance to preflight and session manager (`create-session-manager.ts:32`, `:57`–`:61`). Doctor's ambient check is an intentional different diagnostic, and its corrected comment says so.

The public API can remain additive: new errors/guards/types/constants/classifier/token/dispatch helpers, optional preflight, optional kill token. Keep every current `core/src/index.ts` export, including legacy string readers and stop/session-manager exports. The partial-create guard should validate non-null, non-array handle/data objects and all stated required fields/stage/closed value across core copies. CLAUDE's plugin instructions must state the partial-error obligation and no-close policy; the explicitly grandfathered best-effort tmux create behavior must not be presented as newly qualified by these Herdr fixtures.

The eight-commit dependency order fixes r7's preflight-before-interface error. Commit 2's blocked oracle and commit 3's create-close/no-pane/fourth-call oracles match inspected tests at runtime-herdr `index.test.ts:140`, `:158`, `:304`. Commits 5 and 6 separately migrate core/CLI interim refusal messages, commit 7 adds the hint/owner option, and commit 8 documents the resulting behavior. Add status's behavior/test allocation, complete restore settlement, and fix admission naming/reuse before declaring every intermediate commit green. The unlanded fit-1 tip and its tests are not available in this worktree, so a green eight-commit execution is **not verified** by this review.

The size **L** is reasonable; the cited 1,400 product/2,600 test lines are estimates, not a complete patch budget. Canonical-path admission, CLI reuse and restore end-path tests will add work. The highest risk remains the create/rollback and admission commits. The final red-set equality gate is appropriate on the actual fit-1 base: N-1 has already moved out with fit-1, so fit-2 should not quietly repair or weaken the deferred R3/RH defect set.

## Acceptance audit

These are source/design failure reasons, not claims that unimplemented tests were run. Controls need to pass before fit-2; it would be incorrect to require every row to fail before the change.

| Tests | Distinguishing failure before fit-2 / control |
| --- | --- |
| T-3.1–T-3.4 | Blocked belongs to settled today; later waits proceed, and prompt errors are untyped. Exact attempt/raw-input counts expose F-3. |
| T-3.5 | Existing idle-to-blocked consumption control; intentionally not red. |
| T-3.6–T-3.7 | Core's generic catch restores; CLI lacks typed refusal text. Test both admission values and the retry error's shape. |
| T-4.1–T-4.7, T-4.3b | Plugin closes or throws plain error and core lacks the partial handle. Real-worktree/discard/record/script assertions expose composition; injected mutation-before-error makes arbitrary F1 decisively unsafe. |
| T-4.8 | Ordinary-rollback control. Discovery must first succeed; exact Q1/Q2 then arrive from workspace create. |
| T-4.8b | New compatible=false check; before fit-2 discovery does not enforce it. |
| T-4.9 | Success itself is a control; new fourth pane get, pending publication and claim clearing are the fit-2 oracles. |
| T-4.10 / T-4.10b/c | Terminal handleless setup reaches create; new pending/partial restoration is red. Repeated partial stop refusal is an existing-stop control applied to newly persisted state. Add the successful prepared-agent resident case (M-3). |
| T-4.11–T-4.14 | Valid-handle kill refusal and terminal mismatch/send behavior largely pre-exist; assert the actual retained partial state and the new hint/token. Status token requires m-2's omitted file. |
| T-4.15 | Paused runtime create must expose P/role/claim before a returned handle; baseline lacks P. This is an in-flight record test, not a test that actually kills a child mid-create. |
| T-7.1–T-7.3c | Isolated direct core lacks G; project F1 refusal already exists on fit-1, so typed message/no preliminary writes distinguish it. Legacy exit-0 negatives compare against pre-fit-1 behavior, but are conservative controls on fit-1. |
| T-7.4 / T-7.4b | Exact no-prefix presentation distinguishes CLI handling; real-core persisted-killed composition separately proves G is reached. |
| T-7.5–T-7.9 | Incomplete/failed/mismatched/damaged/unloaded-plugin selections and dispatch assertions distinguish new paths. Healthy project/isolated CLI reuse remains a control; add post-publication/probe-race cases (M-2). |
| T-7.10, T-7.12, T-7.15 | Non-Herdr/no-orchestrator controls; not independent defect tests. |
| T-7.11/b, T-7.13–T-7.14 | Fresh selected-runtime readiness, per-project tmux choice and custom-bin divergence are new. “Nothing written” is scoped to the defined session/origin/hooks/prompt/worktree effects, not an assertion that a running fleet/lifecycle cannot write independently. |
| T-7.16 | Existing stop-less fallback promotes destroy-resolved/no-server to destroyed; the new set guard must make Herdr unknown, mock unchanged. |
| T-7.20/b–T-7.26 | New A/P/G concurrency, revalidation, unsupported platform and restore exclusion. Add first-mkdir symlink interleaving and paused workspace restore; existing setups do not establish those properties. |
| T-9.1–T-9.7, T-9.9–T-9.13 | Option/API/token/retire keys are new; directory/purge/cleanup controls prove scope. No-option default refusal pre-exists; the hint is new. |
| T-9.8 | Incorrect injection ordering as written; split pre-retire CAS refusal from post-retire callback protection (m-4). |

The design names the principal existing oracle migrations. The missing status behavior adds its status tests; restore success/claim settlement and cleanup dispatch add further required oracles. The new race assertions must fail when their own fix is removed, not merely because a different layer also blocks the operation. Preserve the proposed D2 scratch reversions and baseline/end `SAME_ID_DEFECTS=red` comparison.

## Independent code-fact spot checks

Line references are the checked `0488d24d` product tree. Fit-1 behavior is attributed to its spec, not falsely reported as today's implementation.

| # | Claim | Independent evidence |
| --- | --- | --- |
| 1 | Runtime registry loading supplies no runtime config today | `plugin-registry.ts:411`, `:449`, `:510`: omitted config reaches `create`; notifier has its separate configured branch. R8 §3.2 is correct. |
| 2 | Exactly three production create paths | `session-manager.ts:2265`, `:2828`, `:4535`: worker, orchestrator, restore. All three are included by F-4. |
| 3 | Current create catches miss runtime-stop retention | `session-manager.ts:2274`, `:2835` provide no runtime handle; `rollbackLaunch` requires both at `:1867`. R8's supplied partial handle is necessary. |
| 4 | Conditional owner writes advance ownership | `session-manager.ts:1735`–`:1739`; `metadata.ts:331`–`:351`: identity has reservation ID, runtimeHandle, tmuxName, createdAt, restoredAt, not status/claim/generation. The proposed token uses exactly that limited identity. |
| 5 | Reservation is complete before publication | `metadata.ts:916`–`:923`, `:945`–`:955`: complete temp contents then hard link. P/role/claim can be atomic without metadata API changes. |
| 6 | Claims currently depend on agent preparation | `session-manager.ts:2055`, `:2458`; only retained OpenCode supplies preparation (`agent-opencode/index.ts:1100`). R8's broader claim policy is a real change. |
| 7 | Retained failure text is capped and claim currently retained | `session-manager.ts:1980`–`:1984` caps at 600 and only writes `launchFailed`; no claim clear. R8 §3.2 is correct, making new settlement requirements material. |
| 8 | Core startup/restore dispatch uses selected runtime today | `session-manager.ts:2465`, `:2509`–`:2511`, `:2570`–`:2572`, `:4483`; CLI already resolves recorded runtime at `start.ts:906`–`:907`. The specified dispatch fixes target genuine sites. |
| 9 | List and kill differ on missing plugin | `session-manager.ts:1513`–`:1517` falls back; `:3079`–`:3105` skips an unavailable plugin. R8's broad fallback compatibility claim needs m-3. |
| 10 | Cleanup is another old-handle/project-runtime probe | `session-manager.ts:3421`. Absent from r8's purported exhaustive dispatch list (m-3). |
| 11 | Blocked delivery and fallback exist today | `runtime-herdr/index.ts:62`, `:448`–`:466`; generic core restore retry at `session-manager.ts:4007`–`:4025`; non-tmux CLI delegates at `send.ts:355`–`:358`. F-3's typed exception must cross those boundaries. |
| 12 | Empty-ID agent fallbacks differ | Claude rejects at `agent-claude-code/index.ts:661`–`:664`; Codex/Gemini/OpenCode return false at `:681`, `:294`, `:1440`. Runtime-positive lifecycle gate is `lifecycle-manager.ts:662`. R8 §3.3 corrects r7. |
| 13 | Project checkout is excluded and purge is opt-in for kill | `session-manager.ts:661`–`:664`, `:3137`, `:3204`; archive raises the generation floor at `metadata.ts:704`–`:716`. F-9 reuses meaningful existing safeguards. |
| 14 | Doctor is ambient; registry is shared | `doctor.ts:187`–`:195`, `preflight.ts:44`, `create-session-manager.ts:32`, `:57`–`:61`. Parameterless selected-instance preflight and the doctor comment are justified. |
| 15 | CLI's candidate list excludes terminal records | `start.ts:997`–`:1001`; presentation wrapping is at `:1071`–`:1075`, top-level message/exit at `:1214`–`:1220`. This supports r8's real-core killed-record and exact-format tests. |
| 16 | Restore's success has no preparation/confirmation/claim settlement | `session-manager.ts:4361`–`:4381`, `:4561`–`:4566`, `:4607`–`:4628`. R8's prepared-path analogy does not cover restore (M-3). |
| 17 | Abstract-lock identity is subject-derived and Linux-only | `delivery-lock.ts:33`–`:48`, `:74`–`:106`; realpath/resolve fallback at `metadata.ts:234`–`:241`. The primitive works; the new subject algorithm needs M-1. |
| 18 | Pending empty IDs can match ownership | `session-manager.ts:1659`, `:1677`–`:1679`. R8 §4.4's contrary factual statement is wrong (m-5), conservatively rather than destructively. |

Additional product sources inspected include all existing files of §6's list, the relevant runtime/API/plugin guidance in `CLAUDE.md`, launch/record lock and metadata code, the status renderer/test, retained agent branches, the lifecycle gate and the workspace restore implementation. The proposed `runtime-errors.ts` is new and does not exist at HEAD. No fit-1 or fit-2 build was represented as existing code.

## Independent r8 fixture spot checks

All paths here are relative to `development/artifacts/herdr_095_live_check/`. They were read, not rerun.

| # | Claim | Fixture support and limit |
| --- | --- | --- |
| 1 | Q2 suppresses workspace submission for older server | `r8_cli_forms_log.txt`, `r8_ws_create_ping_protocol_19`: exit 1, empty stdout, exact command ID, protocol 22/19 text; exactly one request, `ping`, and no `workspace.create`. |
| 2 | Q2 suppresses pane submission | Same log, `r8_pane_run_ping_protocol_19`: exit 1 with `cli:request`; one `ping`, no `pane.send_input`. |
| 3 | Newer server can run but be incompatible | `r8_status_json_ping_protocol_19.json` and `_23.json`: both `running:true`, `compatible:false`, `endpoint_compatible:true`; 19 reports 0.8.0, 23 reports simulated 0.9.9. This is a fake pong, not a measurement of an installed 0.9.9 server. |
| 4 | Q1 stale-socket refusal sends no mutation request | Log's `r8_ws_create_stale_socket_file` and `r8_pane_run_stale_socket_file`: zero accepted connections; `r8_strace_connects.txt` shows one failed AF_UNIX connect with ECONNREFUSED for each. “Zero connections” means zero reaching the fake server, not zero connect attempts. The exact suffix/pinned socket text matches Q1. |
| 5 | Arbitrary F1 can follow a sent create request | Log's `r8_ws_create_error_after_request`: ping then `workspace.create`, followed by `zz_unknown_code`. Supports partial retention, not proof that a workspace actually was created by this fake handler. |
| 6 | Code/prefix alone do not prove no request | Log's `r8_ws_create_server_sends_cli_no_server_text`: ping then `workspace.create`; forwarded `server_not_running` names `elsewhere.sock` and lacks Q1's full suffix. Q1 correctly rejects this near miss. This is not an exact-pinned-text imitation test. |
| 7 | `pane_not_found` after run submission is unqualified | Log's `r8_pane_run_pane_not_found_after_request`: ping then `pane.send_input`, with text `bash /tmp/aohd5/tmp/x.sh` and Enter; forwarded error then exits 1. This supports eliminating `launch-refused` and retaining a possibly unread script. |
| 8 | The trace's network scope/count matches the report | `r8_strace_connects.txt` has 13 connect calls, all AF_UNIX, including the two failed stale-socket attempts. It records no AF_INET/AF_INET6 connect. The saved script restricts subprocess env to the scratch paths. |

`r8_forms_script.txt` confirms that mutation error cases are deliberately forwarded **after** a valid protocol-22 pong, whereas mismatch cases get only pings. Its fake handler does not model actual workspace creation/admission; that is the separate stateful stand-in test obligation T-4.3b. There is no `r8_pane_run_ping_protocol_23` case: the newer-protocol pane-run form is inferred from the shared CLI path, not directly measured by r8. The design can use this inference if labeled; do not describe it as another saved measurement. The exact server-imitation R-Q case is disclosed but unmeasured. No fixture proves project admission, record CAS composition, cleanup dispatch or F-9; those need the new implementation tests.

`git show 0488d24d -- development/0004_running_ao_on_the_herdr_runtime.md` was inspected. The diff correctly separates current code from two unlanded rounds, adds `compatible:false` and mutation-request-suppression facts with their measurement scope, and preserves the qualification that server-provided no-server codes alone prove nothing.

## Open questions OQ-F4 to OQ-F8

| Question | View |
| --- | --- |
| OQ-F4, mismatch | **(a), block.** Explicit configuration changes should not silently reuse another runtime. Probe/stop through the stored runtime regardless; complete cleanup dispatch too. The policy is correct before G's exemption. |
| OQ-F5, send to kept partial | **(a), with the stated narrow meaning.** Sending to an expected live pane need not destroy retained resources, and quarantining every failed create would be a new policy. Do not say the post-run check guarantees no later changed-terminal send: send's liveness check and mutation are still separate, errors can be treated as unknown/true, and RH has not bound submission. Preserve those existing limits and T-4.14's exact cases. |
| OQ-F6, platform without lock | **(a), refuse.** Running G without exclusion loses the central admission claim. State Linux-only Herdr start/restore behavior and keep non-set controls. This recommendation does not resolve the stable-name defect on Linux. |
| OQ-F7, Q residual | **Prefer (a) for the qualified 0.9.5 CLI, conditional on explicit acceptance of R-Q.** The fixtures justify these known CLI-generated refusal forms; general F1 no longer authorizes deletion. Q2 is prefix-based rather than an exhaustive exact full message, so document that trust boundary precisely. If the owner declines server-text-origin trust, choose (b), Q0 only. No automatic stronger server identity/atomicity claim is supported. |
| OQ-F8, launch token | **(a), required.** It guards AO-recorded launch changes between human inspection and command; it is not a secret or proof about unrecorded server state. Complete its status output and ensure F-9's conditional write and later callbacks all compare the checked launch. |

The already decided OQ-F1(b), F2(a), F3(b) are applied rather than reopened here. No undecided recommendation has been treated as owner approval.

## What is correct

- P/role/claim in the atomic reservation is a substantial improvement over r7's invisible in-flight launch, and the conservative crashed-P behavior is appropriate.
- Rule Q uses actual request-suppression evidence and removes arbitrary server-envelope rollback and `launch-refused`; pane-run Q still retains the already-created workspace.
- A partial create closes nothing, ownership uncertainty writes/removes nothing, and the runtime stop gate preserves core resources before rollback can reach agent discard or worktree removal.
- Core's proposed classifier separates R4 liveness/status from startup-retirement authority, while the mismatch and missing-Herdr-plugin rules are conservative.
- F-3 preserves earlier-prompt uncertainty without raw input or a forced restore after an observed blocked refusal, and retains the existing idle-consumption control.
- Selected-instance preflight is uncached and additive, doctor is explicitly ambient, F-9's token and removal scope improve reviewability, and RH/W-4 remain outside the round.

## Cleanup and verification

The final `ls -la --time-style=full-iso ~/.ao/bin` exactly matched the initial listing quoted above: identical files, sizes, modes and timestamps, including both directory timestamps. No command wrote those files.

The required scan was run exactly:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr8-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path follows:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2224
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2225
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2230
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-75
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
```

These are concurrent real-state changes, not this review's writes. No review command wrote any real AO state or called AO against it. The scan alone does not identify the writer of each path; I did not read those records, another review, another worktree or any pane to infer attribution. The claim of unchanged files is confined to files this review controlled, not an actively managed state root.

The one Node command ran synchronously and completed with exit code 0 under the exact empty environment recorded earlier. Its scratch PATH held only the installed Node link. It imported `node:fs`, `node:path` and `node:crypto`, made scratch directories/a symlink, and printed path/hash calculations. It imported no product modules, opened no socket and started no child, server, agent or background task. Therefore its list of remaining review-owned long-lived processes is empty. No process was signaled, and the named protected workers/sessions were not touched.

Removed the explicitly created symlinks and empty scratch directories; the existence check printed `SCRATCH_REMOVED` for `/tmp/aofr8`. The marker is removed after the required scan. No herdr/tmux/model process, network, pnpm, AO, gh, fetch/pull/rebase, branch mutation, commit, push, PR or inter-session message was run.

`git diff --exit-code -- packages docs .github agent-orchestrator.yaml` and `git diff --exit-code` both passed. Final status showed only the new review, the required `.agent_report.md`, and the externally supplied `.agent_task.md`; the task file was not changed. No product build/test was run for this review-only assignment. The acceptance discussion is an audit of source and design, not a claim that fit-2's unimplemented tests passed.
