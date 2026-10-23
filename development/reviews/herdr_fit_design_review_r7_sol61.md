# Herdr fit design r7 review — 2026-10-22

NOT-SOUND

The typed partial-create error and the status-independent core guard address the main omissions in r6. However, G still admits a second isolated orchestrator during an in-flight launch, F-4 treats unqualified server errors as permission to remove resources, and the project-mode reuse path does not specify correct dispatch after a configured-runtime change. Counts: **0 blocking, 3 major, 4 minor findings**. Finding IDs are local to this review.

Baseline: `68ec0c94` (verified with `git log --oneline -1`). This review concerns only the fit round. RH-A/RH-B and r6 B-1/B-2/M-3 remain outside scope except where a fit behavior depends on them. No implementation or live Herdr measurement was performed. The findings below distinguish source-composed executions, missing qualification, and one isolated language-semantics check.

## Initial isolation evidence

Created `/tmp/aofr7-marker` before reading the design. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Review process

Read r7, the fit findings and acceptance tables of reviews r6/r5, reference r6 sections 5–6, the step-1 W mapping, the R4 read table, and decisions D-8, then all 17 named product files and the related record/reservation, status, doctor and test sources. Read `git show 68ec0c94 -- development/0004_running_ao_on_the_herdr_runtime.md` and the named fixtures. Only afterward read the author's r7 report and brief at the two paths named in the assignment. M-1/M-2 were recorded before that consultation. The report repeats the no-second-orchestrator and all-F1-refusals claims; it adds no transaction or admission protocol resolving those findings. M-3 and the minor findings came from the final source/acceptance cross-check.

The proposed typed partial-create contract reaches the previously missing core catches. The ownership-checked write and refusal on a failed write are conservative. G adds the previously missing isolated-core/status-independent selection for records with parsed handles; M-1 and M-3 concern the remaining admission and dispatch boundaries.

## Findings

### M-1 — G leaves an in-flight isolated launch outside its selection and has no admission boundary

**Design:** §5.7 G1–G3 (lines 589–613); T-7.x. **Source:** `packages/core/src/session-manager.ts:2602` reserves a numbered identity; `:2620` awaits workspace creation; `:2828` awaits runtime creation; only `:2875` publishes the handle. The existing per-record launcher protection is reached for the fixed project-mode ID at `:2495`/`:2565`, not for previous numbered isolated IDs.

Pause isolated caller A after Herdr admits `pane run` but before `runtime.create` returns. A's active record has no runtime handle. Caller B now runs G: G1 explicitly excludes it, reserves the next ID, and launches a second orchestrator. This needs neither a corrupt record nor a server restart. Two callers that both pass an initially empty G have the same problem. `reserveNextOrchestratorIdentity` reserves unique IDs, not a single project orchestrator slot. A malformed old Herdr handle is also explicitly skipped, although failure to parse it is not evidence that its launch ended.

**Required:** define a project admission boundary for G and reservation, include in-progress orchestrator reservations (persist runtime/role early), and retain uncertainty about a damaged known-Herdr record. Protect the interval until a handle/partial failure is published; a second unlocked scan alone cannot guarantee uniqueness. Revalidate the ownership and reuse conditions after awaited probes. Name any deliberately deferred concurrency limit instead of claiming every route starts no second orchestrator. Add paused-create and simultaneous isolated-start tests, including CLI/direct-core and workspace-mode changes. This is a source-composed counterexample, not a live run.

### M-2 — F-4 treats an arbitrary create error envelope as proof of no workspace

**Design:** §5.4 step 2 (lines 384–386), ordinary rollback at 436/463; §4.1. **Source:** ordinary-error worker rollback at `packages/core/src/session-manager.ts:2274`, runtime gate `:1867`, agent discard `:1893`, worktree removal `:1915`, reservation release `:1935`; orchestrator catch `:2835`.

F1 proves the transport and command ID, not transactional failure. Step 2 allows **any** F1 error code, including an unknown server error, to become an ordinary exception and authorize destructive rollback. None of the fixtures inspected establishes that Herdr rolls back all workspace/shell side effects before every such error, or that every exit-0 error envelope has that guarantee. The measured no-server/ping refusal is narrower: no workspace request was submitted. Under an error after partial workspace creation, the proposed ordinary-error branch removes the worktree and agent session under the retained shell, recreating r6 M-1's failure.

**Required:** ordinary rollback only for a qualified pre-submission/no-side-effect condition, with an explicit supported-code contract and evidence. Unqualified server errors, including unknown F1 codes and unqualified legacy error envelopes, must carry `RuntimeCreatePartialError(workspace-unconfirmed)`. Similarly, do not delete a launch script merely because an arbitrary F1 `pane run` error is labeled `launch-refused`; qualify non-admission or retain it. Test a stand-in that records creation/admission and then sends an error envelope. The limitation is missing evidence for a central safety claim, not a claim that a particular recorded Herdr error already leaves a workspace.

### Rejected audit candidate — pane-ID end anchor

I checked a possible trailing-newline concern rather than retaining it as a finding. An isolated Node 25.7.0 expression check of the exact proposed regex returned true for `w1:p1` and false for LF, CR, CRLF, U+2028 and U+2029 suffixes. Without the multiline flag, the prescribed JavaScript expression has the required strict end behavior. No product code or plugin was loaded; the process used the mandated empty environment and link-only PATH. `/tmp/aofr7` was removed immediately afterward.

### M-3 — G's reuse exemption does not specify safe dispatch after the project's runtime changes

**Design:** §5.7 G1/G2 and the post-G branches (lines 595–613), T-7.8. **Source:** `packages/core/src/session-manager.ts:2509` and `:2570` probe an old handle through `plugins.runtime`, the newly configured runtime; `:2465`/`:2467` use that same runtime for stopping it. CLI startup already resolves the handle's runtime at `packages/cli/src/commands/start.ts:906`.

T-7.8 requires a Herdr record to block when the project now selects tmux. But a live fixed-ID Herdr record with no `launchFailed` satisfies G2(i) in project mode, regardless of the new runtime. The design says the existing branch then reuses or refuses it, without specifying replacement of the old `plugins.runtime` arguments with the recorded runtime. A tmux probe of that Herdr pane ID can return false; if the classifier chooses its non-Herdr column from that passed runtime, the old record is archived and a new orchestrator starts. If it chooses the Herdr column from the handle, it still asks the wrong plugin and contradicts the shared-classifier claim. With an alive answer, G2 also permits reuse despite the unconditional blocked oracle of T-7.8.

**Required:** specify dispatch through `registry.get("runtime", handle.runtimeName)` for every old-record probe/stop, with no fallback to the newly selected runtime. Either block runtime mismatch before G2's exemption, as T-7.8 requires, or explicitly choose safe reuse and revise that test and the stated policy. Test project mode with a live Herdr record, a tmux stand-in that would answer false, and zero calls of tmux against the Herdr handle. Include the concurrent fixed-ID branch. This is an unresolved contract/dispatch path in the proposed change, not a measured cross-runtime execution.

### m-1 — The eight-commit order is not green as written

**Design:** §5.6, §6 and §7. **Source:** `packages/plugins/runtime-herdr/src/index.ts:191` explicitly returns `Runtime`; the return object starts at `:328`. `packages/core/src/types.ts:297` has no `preflight` member. Existing create call-index oracles are `packages/plugins/runtime-herdr/src/__tests__/index.test.ts:100`/`:104` and `:116`/`:120`.

Commit 2 installs F-6, which explicitly includes the new `preflight` method, but the optional interface member is assigned to F-7/commit 6. Adding that method to the contextually typed return object before adding the interface member fails strict typechecking. The discovery call also changes create's call indices in commit 2, although the design lists their migration under F-4/commit 4 (and lists the post-run read, which does belong to commit 4). The existing fs mock exports only `writeFileSync` (`index.test.ts:19`), so executable-resolution test setup must change in commit 2 as well.

**Required:** put the optional API member and its exports/contracts before or in commit 2; split the create-test migration into discovery/pinning in commit 2 and post-run validation/partial failures in commit 4. Give each intermediate test oracle explicitly. Keep the existing legacy destroy/send controls green until their scheduled commits. These are static dependency checks; no project build was run.

### m-2 — Public contract documentation and the product-file list omit the doctor distinction

**Design:** §4.5–4.6, §5.7, §6, §8–9. **Source:** `packages/cli/src/commands/doctor.ts:187`–189 promises that doctor reuses spawn preflight so its verdict cannot drift; `:195` calls ambient `checkHerdr`. `packages/core/src/types.ts:300` documents only successful `Runtime.create`, and `CLAUDE.md:201`–234 gives the plugin export/config/error contract.

Keeping doctor as an ambient diagnostic is a defensible explicit choice, but its present no-drift comment becomes false when spawn uses `Runtime.preflight`. The 17-file list needs `packages/cli/src/commands/doctor.ts:187` (comment-only), or doctor must instead use the selected plugin. The public `Runtime.create` and plugin guidance also need to explain the partial-error obligation, `closed: "nothing"`, and that ordinary Herdr failures authorize the existing rollback only under the qualified no-side-effect rule (M-2). Updating only CLAUDE's `isAlive` sentence leaves the new plugin failure contract undocumented at its interface.

**Required:** add those contract/comment updates and reconcile the count (18 product files if doctor remains ambient with a corrected comment: 16 behavior/API, two comment-only). Preserve all old `core/src/index.ts` exports and add the helpers/errors/guards and classifier without changing existing string-call compatibility.

### m-3 — Two current-code statements are inaccurate

**Design:** §5.1 line 245 and §5.2 lines 306–307. **Source:** runtime `execFileAsync` rejection at `packages/plugins/runtime-herdr/src/index.ts:220`; agent fallback branches at `packages/plugins/agent-codex/src/index.ts:681`, `agent-gemini/src/index.ts:294`, `agent-opencode/src/index.ts:1440`; Claude's rejection is at `agent-claude-code/src/index.ts:661`–664.

A nonzero `execFile` rejection does have a numeric `code` (1); what it lacks today is `herdrCode` and `RUNTIME_NO_SERVER_ERROR_CODE`. Also, an empty Herdr ID with no PID rejects in Claude but falls through to false in Codex/Gemini/OpenCode. F-6 changes arguments inside the nonempty-ID branches, so it does not change those fallbacks. This affects description of the new `workspace-unconfirmed` handle with empty ID, even though the runtime's rejected probe still prevents an agent negative alone from becoming lifecycle authority.

**Required:** state those actual outcomes and audit them as part of the retained-record command matrix. Do not claim that all four already reject or silently change their established behavior in this fit round.

### m-4 — T-7.4's stated assertions can pass without the new CLI error handling

**Design:** §5.7 T-7.4 (line 685), §7 gates. **Source:** `packages/cli/src/commands/start.ts:997` filters out a killed record; `:1071`–1075 wraps a thrown spawn error while preserving its message; `:1214`–1220 prints only the message and exits 1.

T-7.4 supplies a killed record and makes mocked `sm.spawnOrchestrator` reject with the new error. Today's CLI already exits 1, includes that error's message M in stderr, prints neither the gone-candidate “Starting a new one” line nor “Orchestrator session created,” and prints no stack. Therefore every stated oracle can pass without the proposed special handling. It cannot demonstrate that CLI prevents a second launch, since the mock supplies the refusal.

**Required:** make the formatting assertion exact if the intended change is printing M as-is (exclude today's `Failed to setup orchestrator` prefix), and pair it with a CLI-to-real-core persisted-killed integration test. Keep mocked tests labeled as error-presentation tests. Also test legacy exit-0 missing/replaced-pane answers at startup: baseline project-mode F1 reads already reject, so a zero-create assertion on F1 alone is not proof that the new retirement guard works. Treat pre-existing successful controls separately from red defect tests.

## Prior-review closure and the fit scope

“Closed” here means the design specifies an adequate correction, pending implementation/tests and owner decisions. It does not mean the behavior already exists.

| Prior item | State in r7 | Independent assessment |
| --- | --- | --- |
| r6 M-1, partial create through core rollback | **Partly closed** | `RuntimeCreatePartialError`, ownership-checked partial-record writes, the stop gate, worker/orchestrator cases and restore now exist in the plan. `rollbackLaunch` at `session-manager.ts:1867` needs both runtime and handle, which the new catches supply. M-2 above leaves an unqualified ordinary-error escape from that gate. |
| r6 M-2, terminal/status and isolated startup bypass | **Partly closed** | G precedes `validateAndStoreOrigin` and both workspace branches, and uses strict disk records instead of enriched `list`. Persisted killed/exited records with valid handles are selected. M-1 and M-3 above leave admission/dispatch gaps. |
| r6 m-1, EOF range and unretained ffi probe | **Closed** | §13 says 0.01–0.22 ms in ten rounded samples and withdraws the `node:ffi` claim. `r6_a_framing_log.txt` and `r6_h_exec_and_tools_log.txt` agree. |
| r6 m-2, spawn caller and selected preflight | **Closed at design level** | `spawn.ts:67`–85 is included; T-7.14 selects a registered custom runtime rather than ambient `herdr`. The cached registry accessor already exists, so no factory change is needed. Commit placement still needs m-1 above. |
| r6 OQ-14 / OQ-F1 | **Correctly reopened; owner decision pending** | Recommendation (b) separates R4 liveness from retirement authority and explicitly discloses the hidden-server duplication residual of (a). OD-24 does not silently authorize (a). |
| r5 M-2, unbound create cleanup | **Partly closed overall** | F-4/F-5 remove every existing close site (`runtime-herdr/index.ts:366`, `:400`, `:402`); retaining core resources still has M-2 above. |
| r5 M-3, executable/socket pin | **Closed at design level** | Absolute executable resolution before discovery; malformed/partial pins reject; legacy handles remain environment-dependent; all four agents, OpenCode's second reader and CLI attach are covered. A pin remains a path, not file content or a server incarnation. |
| r5 M-4, conservative startup | **Partly closed** | Readiness is distinct from old-record death, no-server becomes unknown for Herdr, and G covers persisted terminal records. M-1/M-3 remain; (b) must be selected explicitly. |
| r5 m-2, doc 0004 scope/fallback/evidence wording | **Closed and preserved** | The inspected `68ec0c94` diff describes both existing closes and labels r7 unbuilt. It does not revert the corrected error-or-empty fallback or the measured scope of CLI connection claims. |
| r6/r5 fit F-1 | **Closed at design level** | Exact F1 numeric exit, output channel, keys, expected ID and timeout exclusions; no-server code survives wrappers. New lifecycle/start coverage is specified. It must not be promoted to the stronger mutation-rollback proof in M-2. |
| r6/r5 fit F-2 | **Closed at design level** | Grammar gate precedes calls; empty core row 8 stays `[]`, runtime row 9 rejects, invalid output returns empty. T-2.3 covers the synthesized session-name handle. The exact regex passes the isolated terminator check. Correct the agent-fallback factual statement (m-3). |
| r6/r5 fit F-3 | **Closed at design level** | Typed blocked refusal crosses runtime/core/CLI; later settle and prompt attempts have explicit stage/admission uncertainty and exact prompt/raw-input counts. The idle consumption poll retains its existing delivered outcome. |
| r6/r5 fit F-4 | **Partly closed** | Zero plugin closes and full core retention tests are a substantial improvement; M-2 still needs a qualified no-side-effect predicate. |
| r6/r5 fit F-5 | **Closed at design level** | Unconditional destroy refusal, zero calls, three explicit positive-destroy oracle migrations and the same-ID N-1 migration; stop remains unknown. |
| r6/r5 fit F-6 | **Closed at design level** | Handle-based binary/socket routing and both OpenCode readers are explicit. Tests include altered PATH/environment, malformed pins, legacy handles and native attach. |
| r6/r5 fit F-7 | **Partly closed** | Correct direction and broad persisted-record coverage, but M-1/M-3 and the weak CLI oracle m-4 prevent full closure. |
| r6/r5 fit F-8 | **Partly closed** | R4 rows 8/9, existing comments and CLAUDE's liveness sentence are included. Add the new public failure/preflight contract and doctor distinction (m-2). |
| W-4 | **Explicitly deferred** | F-3 does not fix duplicate sends from `done` or the named `idle` admission uncertainty. Keep that limitation in the round report. |

W mapping is complete: W-1/W-2/W-6 → F-1 (with startup consequences in F-7); W-8 → F-2; W-3 → F-3; W-5a → F-4; W-5b → F-5; W-7/W-9 → F-8; W-4 remains deferred. F-6/F-7 and the optional F-9 are additional work.

RH dependencies stay narrow. F-4's post-run terminal read is only a check, not launch binding, and no fit path may use it to authorize deletion. G(b) deliberately supplies no launch-ended authority, so it does not need RH's process/session proof to refuse. Enabling confirmed cleanup after a future RH stop requires that later round's own gates. This review does not reassess r6 B-1/B-2/M-3 or RH transport/descendant protocols.

## Partial-create contract and retained-record consumers

The four stages are useful and observable through the public error and persisted `handle.data.createIncomplete`. Before submission, discovery errors can safely remain ordinary errors. Once a workspace request might have had effects, a handle with empty ID and known pins is a valid representation of uncertainty; it is not a pane name to send to Herdr. Successful workspace parsing and script-writing failure retain a shell; a pane-run timeout retains a potentially live agent; a post-run mismatch retains both the original terminal identity and the observed replacement. The design correctly leaves uncertain runtime resources in place even if the conditional record write fails, and names them in the warning instead of overwriting another launch's record.

Worker and orchestrator catches should intercept only the structured partial error. Existing plain-error paths in tmux and other runtimes must stay unchanged. A repository search finds exactly three production `runtime.create` calls: worker `session-manager.ts:2265`, orchestrator `:2828`, restore `:4535`; all three are included. Existing own-record writes advance their owned identity (`:1734`–1739), so publishing the partial handle before `keepUnconfirmedLaunch` can use the existing compare discipline. No confirmed cleanup is possible with the current Herdr `stop` (`runtime-herdr/index.ts:418`–433).

| Consumer of a kept failed launch | Actual composed behavior / required test |
| --- | --- |
| `ao status` / `get` / `list` | The persisted partial handle remains visible; a valid pane returning false may enrich status/activity to killed/exited; a rejected probe leaves status intact. The failure line is already printed by `status.ts:230`. Assert both stored and displayed failure data, including an empty-ID partial. The final failure text is capped at 600 characters by `keepUnconfirmedLaunch` (`session-manager.ts:1980`); keep recovery IDs accessible from the stored handle. |
| `ao session kill` without F-9 | After the launcher check, a correctly resolved Herdr stop refuses before worktree removal or archive (`:3093`–3101). T-4.11 is appropriate; include empty-ID and malformed-pin partial handles, since stop itself needs no CLI call. |
| cleanup | Orchestrators are skipped (`:3380`); live launchers are skipped (`:3387`); workers reaching `killRecord` meet the same unconfirmed-stop gate. A probe exception can also retain the worker before kill. Add checks for both the merged-PR/closed-issue route and the runtime-negative route. No owner-confirmation option may be forwarded. |
| restore | If enrichment makes the record restorable, step 7 stops before recreation (`:4483`). Herdr refuses. A nonterminal record may instead fail restorability earlier. Step 9's partial catch is needed specifically for the handleless restore path that can reach `create`; retrying after a recorded partial must not create another runtime. Include a second restore after T-4.10. |
| start | With a parsed handle, `launchFailed` excludes CLI reuse and blocks G regardless of status; unknown/empty IDs cannot establish death. An unpublished partial/handleless reservation remains the M-1 gap. Replaced records after an awaited probe must be rechecked before reuse. |
| lifecycle | Current probes can change displayed/persisted status, but do not call kill/cleanup/restore themselves. The runtime-positive gate at `lifecycle-manager.ts:662` prevents an empty-ID agent fallback negative from being sufficient by itself. The outage and recovery rules continue; G must remain independent of their status writes. |
| `ao send` | The design changes the blocked-refusal retry but gives no special `launchFailed` policy. Today's `prepareSession` (`session-manager.ts:3779`–3823) may attempt a restore when enrichment says exited or the agent is absent; that refuses for Herdr. If a timeout left a live agent on the expected pane, it can pass readiness and receive a send. Unknown runtime/agent probes are treated as true before send, and an empty-ID worker can first incur the readiness wait before a refusal/restore. State this explicitly and test it: a failed-launch record is not uniformly unsendable. If the product wants all incomplete creates quarantined, that needs an explicit new core guard and oracle, not an inference from the retained-record label. |

F-3's refusal is distinct from the retained-launch policy: an observed blocked agent gives no raw input, and core must throw it before the ordinary restore retry at `:4007`. W-4's retry behavior otherwise stays as documented. The agent-native OpenCode send route is separate (`:3985`); its existing admission ledger is not redesigned by this fit round.

## F-9 and owner recovery

F-9 is a deliberate exception to confirmed-stop cleanup, not evidence that AO learned how to stop Herdr. Its explicit owner decision gate is appropriate. The current default kill can never retire even an operator-closed Herdr pane, because `stop` always returns unknown, so message M cannot honestly advise an ordinary retry of `ao session kill`. An operational recovery choice is needed; an additional destructive command is not logically required to ship a retention-only fit.

The proposed action accepts active records whose stored handle identifies Herdr, including terminal, failed, empty-ID and malformed-pin cases. It must reject tmux records, missing/unparseable handles and a live launcher before any retire write/removal. `isAlive === true` refuses; false or failure defers to the owner's attestation. That attestation intentionally overrides missing-endpoint and malformed-pin uncertainty. Default kill, cleanup, restore and lifecycle must never acquire the override implicitly.

The removal scope follows current kill: remove only a managed worktree, keep the project checkout (`session-manager.ts:655`–664), archive the record through `deleteMetadata` so the generation floor/lock discipline is preserved, keep the agent session unless purge was explicitly requested, and keep the shared Herdr server and all panes. T-9.1–T-9.8 cover the principal outcomes. Add assertions for project-mode directory preservation, retained prepared OpenCode session by default, malformed/empty-ID partials, and retire metadata in the archive. Keep `stopWhenReplaced` immediately before every removal and its plugin callbacks; a failed conditional retirement write must stop the operation. The flag must not convert a replacement into permission to delete it.

The recovery instructions need to make the owner's attestation meaningful: inspect the stored handle, expected `terminalId`, workspace path/label and binary/socket, then compare the pane and process information at that pinned endpoint before closing it. A missing pane at that endpoint alone does not find a hidden old server. Empty-ID partials need `workspace list` plus label/cwd inspection instead of message M's unusable empty `pane get`. For a malformed pin, repair/identify the endpoint manually; a failed AO read is not a successful ownership check. Pin values in copyable shell commands need shell quoting. An owner can also race a new launch between inspection and the command: current launch-identity CAS starts from the record read by kill, not from the earlier human inspection. At minimum name that residual and require rechecking the same launch; a supplied expected-launch identity would enforce it more strongly.

F-9's published residual is real: a mistaken attestation can remove a worktree still in use by a hidden launch. The by-hand alternative also bypasses locks/floors; it is an emergency procedure, not equivalent safety. Keeping records/worktrees until RH, OQ-F2(c), is a valid smaller-scope choice. Neither OD-19 nor OD-24 already approves bypassing the stop gate.

## Acceptance, API and implementation readiness

The public changes are additive in shape: optional `Runtime.preflight`, optional kill options, new error classes/guards/constants/classifier, and a widened `string | RuntimeHandle` helper parameter. Existing strings must keep legacy invocation, and the existing exports in `core/src/index.ts:55`–57 and stop/session-manager exports must remain. `HerdrPinError` is mentioned but absent from the §4.5 error table; define its guard/code/export if the classifier or CLI relies on recognizing it. Validate the whole partial-error shape across duplicate core copies rather than relying only on `instanceof` or a matching code.

The registry cache in `cli/src/lib/create-session-manager.ts:32` supplies the same selected runtime instance for spawn/start and the session manager. Parameterless `preflight()` checks that instance's binary settings and the current environment, which satisfies the selected-instance requirement; it is a readiness sample, not an endpoint reservation or startup death proof. Avoid caching discovery as the result of that readiness check. A later create can still fail and must use F-4. Preserve the early project-specific tmux check and `--no-orchestrator` behavior. Doctor may intentionally retain ambient discovery after its documentation is corrected (m-2).

| Acceptance IDs | Baseline failure reason / control distinction |
| --- | --- |
| T-1.1–T-1.3 | Today's rejection never decodes exact stderr F1, so rows 8/9 cannot return the new negative or mapped no-server code. |
| T-1.4/T-1.4b/T-1.5 | Mostly regression controls: keep malformed forms rejecting and legacy envelopes working. New helper/classification assertions distinguish the added path; mere rejection is already satisfied today. |
| T-1.6/T-1.7 | Real-plugin F1 currently gives a failed probe, rather than the intended negative/no-server streak. Use a known positive second session for T-1.6, as in the named harness; otherwise the ambiguous-negative outage bound changes the two-poll oracle. |
| T-2.1/T-2.3 | Today's plugin/helper issue calls for non-grammar/session-name IDs. Zero-call assertions are the defect oracle; stored-status preservation alone already holds for synthesized handles. |
| T-2.2 | Positive grammar regression controls, including measured rollover; already callable today. |
| T-3.1–T-3.4 | Today's blocked gate returns settled, later waits permit further attempts, and prompt failures are untyped. Assert the exact attempt count and no raw input. |
| T-3.5 | Existing delivered-from-idle consumption control, not a new defect test. |
| T-3.6/T-3.7 | Current core may restore on the runtime refusal and current CLI has no specific refusal presentation. Preserve the typed error across both runtime-send attempts and test both admission values. |
| T-4.1–T-4.7 | Current plugin closes on launch failure or throws a plain error before the core stop gate. Real-worktree and agent-discard assertions expose the composed damage; errors before/after admission must hit the intended stage. |
| T-4.8 | Ordinary rollback control; after F-6, answer discovery successfully, then return the exact no-server workspace refusal. The property is preserved behavior, not an independently new failure in baseline. |
| T-4.9 | New pins and post-run read fail baseline; successful handle return itself is an existing control. |
| T-4.10 | Current restore does not persist a partial handle/failure when create rejects. Start from a terminal handleless record so step 9 is actually reached. |
| T-4.11 | Stop refusal is already correct with a valid Herdr handle; its new value is proving that F-4 persisted that handle and that kill retains the same resources. |
| T-5.1/T-5.2 | Destroy currently closes/resolves and must become unconditional refusal; stop's unknown/zero-call behavior is an unchanged control. |
| T-6.1–T-6.5 | Current create has no executable/socket discovery/pin validation. Distinguish attempted calls from successful executions when testing missing binaries. |
| T-6.6/T-6.7 | Legacy behavior is a control; malformed pins are currently ignored and make calls. Empty core IDs remain the specifically documented no-call `[]` exception. |
| T-6.8–T-6.10 | Attach and all five agent read sites currently use ambient invocation; pinned invocation/environment is the new oracle. Keep unpinned calls as controls. |
| T-7.1–T-7.3 | Isolated startup currently reserves another ID; terminal/activity filtering and missing guard are the intended defect. For project mode, assert typed refusal and no preliminary hook/origin writes; baseline F1 can already reject, so also exercise legacy negatives and the composed code after F-1. |
| T-7.4 | Presentation test is insufficiently red as written (m-4). Pair with real-core integration. |
| T-7.5–T-7.9 | New failed-launch/terminal-record guard, configured-runtime mismatch and pin validation need decisive no-reuse/no-create oracles; M-3 must reconcile T-7.8. T-7.7's healthy reuse cases are controls. |
| T-7.10–T-7.15 | Preserve tmux/mock and no-orchestrator controls; fresh Herdr readiness and selected-custom-runtime rejection expose new gates. Make ambient endpoint healthy and selected one unavailable in T-7.14. |
| T-7.16 | Stop-less Herdr fallback currently promotes no-server after destroy to destroyed; the new contract guard must return unknown. Mock stays destroyed. |
| T-9.1–T-9.8 | New owner option/API, archive evidence and conditional writes fail baseline. Without-option refusal remains a control plus the new hint. No normal cleanup path should use this option. |

The explicitly named destroy, blocked-send, create-failure and create-call-index migrations match the old tests. The red-set gate is appropriately narrow: only runtime-herdr N-1 should leave the defect set, while its positive destroy control must also become a refusal test. Run the red gate once at baseline and once at the end in the isolated implementation environment; this review ran neither. After fixing the dependency placement in m-1, the eight-step sequence is implementable, but the present claim that every intermediate commit is green is unsupported. The size estimate M+ is plausible; an admission mechanism and its race tests must be included in a revised estimate. A later RH implementation remains outside this count.

## Independent code-fact spot checks

These are direct source reads at the checked baseline, not executions of product behavior.

| # | Claim checked | Evidence and result |
| --- | --- | --- |
| 1 | Registry-loaded Herdr receives no runtime-specific config | `core/src/plugin-registry.ts:449`/`:510` call `register(mod)`; `:411` passes the omitted config to `create`. Runtime default is bare `herdr` at `runtime-herdr/src/index.ts:194`. Notifier configuration is a separate branch. |
| 2 | Three production create sites | `core/src/session-manager.ts:2265`, `:2828`, `:4535`; no other production call was found. Integration-test calls are separate. |
| 3 | Current worker/orchestrator create failure misses the stop gate | Catches at `session-manager.ts:2274`/`:2835` supply no handle; `rollbackLaunch` enters the runtime stop block only at `:1867` when runtime and handle exist. |
| 4 | Unconfirmed rollback keeps resources and marks failure | `session-manager.ts:1877`–1880 returns immediately after `keepUnconfirmedLaunch`; `:1984` performs the conditional failure write. |
| 5 | Handleless records synthesize the session name | `session-manager.ts:1482`–1487; this is not a Herdr pane ID. |
| 6 | False liveness affects enriched status/activity | `session-manager.ts:1532`–1539 sets killed for nonterminal status and activity exited. Rejection continues activity detection at `:1541`, preserving status. |
| 7 | CLI filters terminal records before startup liveness | `cli/src/commands/start.ts:997`–1001; a persisted killed record never reaches that candidate classifier. |
| 8 | Direct isolated startup allocates another identity | `session-manager.ts:2602`; allocator `:1329`–1368 prevents number reuse, not multiple active orchestrators. |
| 9 | Current fixed-ID probes use newly configured runtime | `session-manager.ts:2509`/`:2570` pass `plugins.runtime`; contrast CLI's persisted-runtime lookup at `start.ts:906`–907. |
| 10 | Herdr stop closes nothing; direct destroy still does | `runtime-herdr/src/index.ts:418`–433 returns unknown without a command; direct closes remain at `:366`, `:400`, `:402`. Core `runtime-stop.ts:190`–209 selects stop before destroy. |
| 11 | Old blocked state and retry path | `runtime-herdr/src/index.ts:62` includes blocked; `:457` waits then continues attempts. Core generic restore retry is at `session-manager.ts:4007`–4018; CLI delegate has no local refusal catch at `send.ts:356`. |
| 12 | Empty output triggers visible fallback | `runtime-herdr/src/index.ts:485` returns only if `recent.trim()` is nonempty; caught errors and blank successful reads reach `:491`. |
| 13 | Terminal identity mismatch yields false | `runtime-herdr/src/index.ts:504`–505; missing terminal identity is not treated as a mismatch. The create answer currently permits missing terminal identity at `:387`; F-4 deliberately strengthens new-create validation. |
| 14 | Lifecycle retains outage/status policy | `lifecycle-manager.ts:1577`–1587 requires consecutive no-server polls, at least two and the time bound. `:1590`–1604 includes the separate ambiguous-negative hold. These are not cleanup operations. |
| 15 | Pins need all five agent read sites | `agent-claude-code/src/index.ts:617`, `agent-codex/src/index.ts:581`, `agent-gemini/src/index.ts:194`, `agent-opencode/src/index.ts:661` and `:1340` currently pass only `handle.id`. |
| 16 | Attach bypasses the display command and uses ambient Herdr | `cli/src/commands/session.ts:187`–198 reads target then hardcodes `herdr`; `:209` spawns with no env option. F-6 changes this path. |
| 17 | Default kill retains project directory; purge is optional | `session-manager.ts:661` excludes project.path; `:3137` requires `purgeOpenCode === true`; archive is at `:3204`. |
| 18 | Doctor is ambient today | `cli/src/commands/doctor.ts:195` calls `preflight.checkHerdr`; `cli/src/lib/preflight.ts:44` invokes bare `herdr status server`. |

## Independent Herdr fixture spot checks

Paths below are relative to `development/artifacts/herdr_095_live_check/`. No fixture was rerun.

| # | Claim checked | Fixture and observed support/limit |
| --- | --- | --- |
| 1 | Closed pane get uses F1 stderr | `closedpane_pane_get.cmd`: exit 1, stdout zero bytes, error code `pane_not_found`, ID `cli:pane:get`. |
| 2 | Process-info has its own command ID and message | `closedpane_pane_process_info.cmd`: exit 1, stdout zero bytes, ID `cli:pane:process_info`, message `pane not found` (no pane ID in the message). |
| 3 | No-server create/get transport | `noserver_never_workspace_create.cmd` and `noserver_never_pane_get.cmd`: exact `server_not_running` prefix and command-specific IDs. They establish this pre-request/no-server form; not all possible workspace-create error atomicity. |
| 4 | Blocked prompt is a refusal | `blocked_herdr_agent_prompt.cmd`: exit 1, empty stdout, `agent_blocked` with ID `cli:agent:prompt`. Supports typed refusal rather than raw permission-prompt input. |
| 5 | The no-server mapper excludes the fake server's text | `r5_b_pane_get_server_not_running_from_server.cmd`: `fake server says so` lacks the required prefix. It is forwarded F1, but not the no-server code. |
| 6 | EACCES is not the JSON no-server form | `r5_c_socket_mode_000_cli.cmd`: Rust `Error: Os { code: 13, kind: PermissionDenied, ... }`, exit 1. |
| 7 | Protocol refusal is F1 but not absence | `r5_b_ping_protocol_19.cmd`: exit 1, ID `cli:pane:get`, `protocol_mismatch`; escaped newlines are inside the JSON message, not extra stderr lines. |
| 8 | Status gives endpoint with and without server | `closedpane_status_server_json.json`: `running:true`, version 0.9.5, protocol 22, absolute socket; `noserver_never_status_server_json.json`: `running:false`, null version/protocol, socket still present. |
| 9 | Endpoint environment precedence | `r5_path_env_socket_and_env_session.cmd` selects `/tmp/aohd2/s/custom.sock`; `r5_path_env_socket_and_flag_session.cmd` selects the explicit session's socket. Supports `--session` > socket env > session env. |
| 10 | Workspace rollover | `ids/workspace_create_g32.json`/`workspace_create_g33.json` contain `w0:p1`/`w11:p1` with workspaces `w0`/`w11`. |
| 11 | Pane rollover | `r6_f_pane_counter_log.txt` lists p1…pZ, omitting I/L/O/U, then p0, p11, p12, p13. Arbitrary greater lengths remain extrapolation, as r7 says. |
| 12 | Launch input is addressed only by pane ID | `r5_b_cli_forms_log.txt`, `b_req_pane_run`: ping, then `pane.send_input` with pane ID, text and Enter; no expected terminal. `b_req_workspace_create` records a separate ping and request too. |
| 13 | Failed ping suppresses later request | `r5_b0_requests_log.txt`: one ping connection for each failed pane operation and status; no second workspace/pane request. This supports the qualified pre-submission distinction. |
| 14 | Recent-unwrapped can return shell text | `otherterm_pane_read_recent_unwrapped.txt`: shell diagnostic `groups: command not found` and `aohd$` prompt. It does not prove all successful reads are nonempty. |
| 15 | Replaced terminal is observable | `otherterm_pane_get.json` has the requested restored pane and new terminal data; the step-1 restart snapshots/report describe the cross-run comparison. A post-run check still cannot bind an earlier mutation to that terminal. |
| 16 | EOF wording correction | `r6_a_framing_log.txt`: `a_pane_close_second` 85.77→85.78 ms; repeated close 2.97→3.19 ms. The ten samples support the corrected rounded 0.01–0.22 ms range, not a universal bound. |
| 17 | No saved ffi probe in the cited log | `r6_h_exec_and_tools_log.txt` contains only `h_exec_bash` with unchanged PID/ticks. Withdrawing the unretained broader claim is correct. |

No fixture inspected proves all-or-nothing failure for every workspace-create error, the new end-to-end partial rollback, project-wide concurrent admission, cross-runtime startup dispatch, or the owner-confirm override. Those are design/qualification obligations. Existing static fixtures cannot substitute for production integration tests of those new compositions.

## Open questions

| Question | Reviewer recommendation |
| --- | --- |
| OQ-F1 / r6 OQ-14 | **(b).** Preserve R4 liveness answers for status/lifecycle, but no Herdr negative becomes startup-retirement authority. The disclosed residual of (a) contradicts the conservative startup objective and is not already covered by OD-24. Fix G's admission/dispatch gaps independently of this constant. |
| OQ-F2 | **(a), conditional on explicit owner acceptance and the scoped safeguards above; otherwise (c).** A locked, identity-checked AO action is more reviewable than hand-editing state, and supplies usable operational recovery. It is an additional destructive feature, not a mandatory part of reading 0.9.5 replies. Prefer leaving records/worktrees until RH if the owner has not accepted the override residual. Do not treat recommending (a) as acceptance, and do not ship F-9 merely because recovery is inconvenient. |
| OQ-F3 | **Prefer (b), two rounds.** Reads/pins/destroy have a smaller review surface; partial-create retention/startup admission deserve a separate safety gate after these findings are resolved. Fit-2 can depend on fit-1, so F-7 needing F-1/F-6 is not a reason that both must ship together. If one round is chosen, repair the green-commit dependency order and keep per-commit acceptance. |
| r6 OQ-6, changed | **(a), after M-2.** Remove both unbound close paths and retain all resources whenever creation may have had effects. An exact failure envelope alone does not qualify ordinary rollback. |
| r6 OQ-7, changed | **(a), after M-1/M-3.** Put conservative admission in core, use strict persisted records independently of terminal status/activity, and ask the selected runtime for readiness only when creating. |
| r6 OQ-1 | **(a).** Strict CLI F1 plus legacy channel for these reads is a focused fit. Keep command-specific IDs and all near misses. This trusts the CLI output boundary, not a qualified wire frame. |
| r6 OQ-2 | **(a).** Pin before create, pass the handle everywhere, reject partial/malformed pins, and keep legacy ambient behavior explicit. |
| r6 OQ-5 | **(a).** Leave duplicate-send work to its named later round; F-3 only stops observed blocked refusals and preserves earlier-admission uncertainty. |
| r6 OQ-9 | **(a).** Keep the no-handoff operating rule for every handle lacking qualified S; deploying the fit does not retrofit that evidence. |

The remaining RH-specific questions are unchanged and outside this review. No owner decision was inferred from either reviewer's recommendation or from the author's report.

## What is correct

- The design is self-contained about W scope, partial-error stages, typed blocked refusal, pin validation and legacy controls, and explicitly leaves W-4/RH out.
- Publishing the partial handle under the existing own-record compare, stopping through `stopRuntime`, and retaining the worktree/agent session/prompt on uncertainty is the right composition for the cases that reach it.
- Persisted killed/activity-exited records with valid Herdr handles now have a planned safety check before core allocation, in both workspace modes. Readiness and launch-death evidence are separated.
- F1 is strict about the new stderr shape without weakening the old R4 near misses; malformed pins never silently downgrade. All four agents and OpenCode's second reader are named.
- Unconditional destroy refusal and explicit test-oracle migrations preserve OD-19. Doc 0004 continues to distinguish existing behavior from the unbuilt fit/RH designs, and the two r6 evidence corrections are now supported.

## Cleanup and verification

The final `ls -la --time-style=full-iso ~/.ao/bin` was byte-for-byte equal to the initial listing quoted above: the same four files, sizes, permissions and 2026-10-16 modification times; directory timestamps also matched.

The required cleanup scan was run exactly as requested:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr7-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed every path below:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2232
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2224
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2230
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2233
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-71
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

These paths changed during the review; no review command wrote them. Their contents and other sessions' panes were not read, and this scan does not attribute the writes to particular actors. In particular, the unchanged-state claim is confined to files this review controlled, not to the actively managed real state root.

One foreground Node expression check ran to resolve the rejected regex candidate, under:

```text
env -i HOME=/tmp/aofr7/home TMPDIR=/tmp/aofr7/tmp PATH=/tmp/aofr7/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true /tmp/aofr7/bin/node --input-type=module -e <regex-only expression>
```

The scratch PATH contained only a link to the installed Node executable; no npm/npx/gh/tmux/agent link and no `/usr/bin` PATH entry. The expression loaded no repository modules and started no child/server. It completed synchronously with exit code 0, so no review-owned Node process remains. Its link and empty directories were removed, and the final existence check printed `SCRATCH_REMOVED`. No background process, lifecycle worker, Herdr server, tmux server, real agent or model turn was started or signaled. No AO, pnpm, network, fetch, pull, rebase, branch mutation, commit, push, PR or inter-session message command was run.

Only this review and the explicitly required `.agent_report.md` were written in the worktree; `.agent_task.md` was supplied externally and left unchanged. Final `git status --short` showed those three untracked paths and no tracked modifications. `git diff --exit-code -- packages docs .github agent-orchestrator.yaml` and `git diff --exit-code` both passed. Builds and product tests were not run for this review-only assignment; the acceptance discussion is a source/design audit, not a claim that the unimplemented tests passed.
