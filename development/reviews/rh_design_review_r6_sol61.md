# RH design r6 review — 2026-10-22

NOT-SOUND

The connected-socket guard fixes the ordinary restart race demonstrated by review r5. NM-1, the observation-domain checks, executable pinning and the bound agent answer are substantial corrections. However, an unbound launch can invalidate the captured identity, the new session scan can miss a same-session descendant, failed-create rollback can remove resources beneath the retained pane, and startup still has routes around the proposed death checks. Counts: **2 blocking, 3 major, 2 minor findings**. IDs below are local to this review; references to r5 IDs are explicitly marked.

Baseline: `3ad87bd4`, verified with `git log --oneline -1`. This is a design/source/fixture review, with no implementation changes or live measurements. A logical interleaving is labeled as such; saved measurements are not presented as tests of the unimplemented production classifier.

## New findings

### B-1 — An empty, changing `/proc` scan does not prove that S's session ended

**Design:** §4.5, lines 344–351; §4.7 steps 3, 7 and 9; §4.8 step 1; §4.12 R-H1; §4.14 test 5a; OQ-10. **Code:** planned `packages/core/src/herdr-identity.ts`, consumed by `packages/plugins/runtime-herdr/src/index.ts:418` and `:497`, and `packages/core/src/herdr.ts:72`. Consequential cleanup gate: `packages/core/src/session-manager.ts:4483` and the workspace removal at `packages/plugins/workspace-worktree/src/index.ts:191`.

Start in a state the design explicitly handles: S ended, but P still belongs to session S.pid. The proposed algorithm permits this execution:

1. AO lists `/proc`; the list contains P and does not contain Q.
2. P forks Q, which inherits the same session ID. P exits and is reaped before AO reads P's stat.
3. Reading P returns ENOENT, which §4.5 explicitly skips. Q is outside the enumerated list. All other inspected processes have another session ID.
4. AO returns “the launch ended,” hence `absent`, although Q still runs in S's session and may use the worktree.

Q never called `setsid`. It falls within the claimed same-session guarantee and outside the stated residual R-H1. Polling does not cure it: step 9 returns on the first scan classified as ended. It also affects RH-A's no-request `absent`, so gating only the close does not contain it. PID reuse during enumeration introduces another uncertainty; the text's treatment of a *visible* reused leader does not address a missed descendant.

**Evidence:** this is an algorithmic counterexample, not a measured Herdr execution. `r6_i_session_log.txt`, `r6_i_signals_log.txt` and `r6_i_signals_setsid_log.txt` check already-known, stationary children. Their scripts list PIDs and read stats; none forks a replacement during the absence scan. `r6_logs/strace_summary_part_i.txt` shows individual PID signals against the measured children, rather than a containment mechanism that forbids later forks. §2.4 expressly leaves server-stop/shell-exit survivor behavior unmeasured. The test plan covers a disappearing member but requires it to be skipped, which permits this counterexample.

**Required:** replace the universal session-empty claim with an observation protocol that establishes the necessary quiescence/containment, and test the fork/exit interleaving through the production seam. A bounded number of matching scans alone is not such a proof. If that mechanism is outside scope, keep destructive absence/completion disabled or explicitly broaden R-H1 to include same-session descendants missed by the scan, with a fresh owner decision and corresponding weaker guarantee. NM-3 measures a workload; it cannot establish an atomic session-empty invariant. Apply the correction to stop and the agent check's `[]`, and do not approve OQ-10 on the current “only processes that left the session” description.

### B-2 — S is captured before an unbound launch that can reach a replacement shell

**Design:** §3.3 (CG for the stop and the create's reads), §4.4 (S captured before `pane run`), §4.7 step 3, §5.7 (pinned CLI calls), §4.14 test 6. **Code:** `packages/plugins/runtime-herdr/src/index.ts:359`–362 (CLI launch), `:376`–390 (returned handle), planned capture immediately before that launch, and `:418` (new absence authorization).

There is no connection binding specified for the launch mutation itself. An ordinary restart permits this sequence, even if the session-empty predicate is otherwise perfect:

1. A creates P; the guarded create reads capture S_A, its domain and LC0 correctly.
2. A stops. B starts at the same pinned path and restores P with a new shell S_B. S_A and its session have ended.
3. The existing pinned CLI `pane run P bash <script>` connects to B and succeeds, starting this launch's agent beneath S_B.
4. Create returns the already-captured S_A. `isAlive` now says false; stop says `absent` without addressing B, because S_A and its session ended. Core can remove the worktree beneath the agent it just launched on B.

This is neither a child escaping S's session nor deliberate socket interference. The recorded S never contained the admitted launch. Pinning the pathname/binary and binding the preceding reads do not bind a later CLI connection. The design explicitly qualifies the **create reads**, but leaves `pane run` on the CLI path and requires no final association of the admitted command with S.

**Evidence:** `r6_c_race_log.txt` c1/c2 shows exactly the required normal restart behavior: same P, ended old S, live replacement S, and a later operation can reach B. `r5_b_cli_forms_log.txt` (`b_req_pane_run`) documents that pane run submits input by pane ID, without S; `r5_b_req_pane_run.cmd` records its successful CLI invocation, and `index.ts:362` performs that submission. This launch/stop composition was not measured. The proposed create test asserts that submission follows S capture, but does not replace the server in that interval.

**Required:** establish that the admitted launch belongs to the identity published in the handle. Prefer binding launch submission before its write to the same qualified listener/run used to capture S (the raw `pane.send_input` form is measured), with refusal/resource retention on a changed endpoint. If choosing a narrower fallback, specify how create withholds usable S and retains the partial resources whenever that association cannot be established; never publish S_A as destructive-cleanup authority for a command admitted under S_B. Add a production create/stop interleaving after the final S read and before CLI connect/write: either B receives no launch mutation, or the operation remains explicitly unqualified and no subsequent absence/removal is authorized. Also cover restart during the CLI's initial ping/request split.

### M-1 — F-4's retained pane is invisible to core's failed-create rollback

**Design:** §6 F-4, §4.7/§4.14 test 22 and the RH-B create-cleanup promise. **Code:** `packages/plugins/runtime-herdr/src/index.ts:359`–373; worker create/catch `packages/core/src/session-manager.ts:2265`–2275; orchestrator create/catch `:2828`–2837; rollback runtime gate `:1867`, prepared-session removal `:1888`, workspace destruction `:1915`, record release `:1935`.

Removing the unbound close is correct. But F-4 then throws an ordinary error after creating a Herdr workspace, without returning its handle. Core's worker catch calls `rollbackLaunch({ own, prepared, workspace })`, with neither runtime nor handle. Its confirmed-stop gate is skipped; it can discard the prepared agent session, destroy the git worktree and release the reservation. The isolated orchestrator catch has the same problem. A timed-out `pane run` may already have started the agent; even a definitely rejected run leaves the shell alive in that directory. Naming its pane and socket in the thrown message does not preserve those resources.

RH-B does not automatically solve this: if its attempted cleanup returns `unknown` and create still throws without carrying that outcome/handle to core, core takes the same unguarded rollback route. This is a composed source counterexample, not a claim that a failed launch always runs an agent. It is also an existing failure mode when today's best-effort cleanup fails, which this safety round must account for.

**Evidence:** the cited catches and `rollbackLaunch` branches are direct source evidence. `r6_e_nm1_log.txt` demonstrates a legitimate refusal that leaves panes alive; `r6_c_race_log.txt` establishes server replacement and ID reuse. No fixture tests the proposed F-4 through core rollback; F-4's acceptance checks only CLI closes and error text.

**Required:** give partial-create failure a structured contract carrying the available runtime handle and unconfirmed cleanup evidence, and consume it in worker and orchestrator rollback. Retain the worktree, prepared agent resources and an ownership-checked failed-launch record with the partial handle whenever stop is unconfirmed; do not leave only an unaddressable reservation. A failure proven to have created no runtime may retain ordinary rollback. Add end-to-end core tests for failure before command submission, command timeout after admission, and replacement/refused cleanup: zero unbound closes **and zero workspace/agent-session/record removals** on uncertainty. This belongs in F-4 and its size estimate.

### M-2 — “Only a status rule” still admits startup through terminal-record and isolated-core paths

**Design:** §5.8, especially lines 632–638; §6 F-7; §7 fit acceptance. **Code:** terminal/activity filtering `packages/cli/src/commands/start.ts:996`–1001; `packages/core/src/types.ts:173`; lifecycle no-server transition `packages/core/src/lifecycle-manager.ts:1577`–1584; direct isolated allocation `packages/core/src/session-manager.ts:2599`–2605. The liveness helper at `:562` is reached only in the project-mode old-record branches.

F-7 correctly changes the no-server **exception handler**. A hidden old server can nevertheless stay alive while its pinned path is unreachable. The deliberately retained outage policy eventually persists `killed`. CLI startup filters terminal records *before* invoking the new handler. With the caller pointed at a healthy server, preflight passes, the old record is omitted, and an isolated new orchestrator is admitted. The old record might remain on disk, but the promised “starts nothing” property is lost. Calling the outage policy “a status rule” does not isolate it from allocation: startup consumes that status.

Also, direct core isolated `spawnOrchestrator` reserves a new identity without examining earlier orchestrators. Changing `isOrchestratorRuntimeAlive` alone does not reach it. F-7's broad isolated/direct-core test requirement is welcome, but its implementation description needs the actual guard before this branch as well as the project-mode handler change.

**Evidence:** this is a source-composed execution, not a live startup test. `r5_c_stale_socket_file_cli.cmd` and `r5_path_env_socket_and_env_session.cmd` supply the exact unreachable-pin and independently selected endpoint forms; the status transition and subsequent filter are explicit in the cited source. No r6 fixture measures this composition after the outage bound.

**Required:** select old Herdr records for startup safety independently of their terminal status/activity, distinguishing a recorded probe-derived kill from confirmed retirement. Apply the conservative old-launch check before isolated allocation in core too. Retain the desired five-minute status policy only if it cannot become replacement authority. Test persisted `killed`/`killedReason=runtime`, a hidden live old server, an unreachable pin and a healthy caller endpoint, through CLI and direct core in both workspace modes; assert no new runtime or reservation. Include the case where list enrichment changes activity to `exited` before candidate selection.

### M-3 — RH-A's terminal-liveness boolean bypasses its own cleanup gates at startup

**Design:** §4.1 RH-A/gates; §4.5 lines 348–350; §4.8 first bullet; §5.8 “a record with S answers from S.” **Code:** `packages/plugins/runtime-herdr/src/index.ts:497` (planned S-based `isAlive`); `packages/core/src/session-manager.ts:1532`–1539 (list enrichment), `:572`–584 (startup boolean), `:2553`–2559 (delete/archive without stop); `packages/cli/src/commands/start.ts:918` and `:1000`.

The design deliberately distinguishes “S ended” from “the launch ended.” S may end while a member of its session lives: stop is `unknown` and the agent check rejects. Yet RH-A immediately enables `isAlive=false` on S alone, even before NM-3/OQ-10. Startup treats this boolean as permission to replace the old launch. In project mode it can archive/delete its record without calling stop; list enrichment can first remove it from CLI candidates. Thus even a perfect session scan in stop would not protect this path. This differs from M-2: the check can actually run and still use the wrong strength of evidence.

**Evidence:** §4.14 test 5a explicitly allows the surviving-member state, while §4.8 instructs terminal liveness to use S alone. The startup false branches are direct source evidence. The new part-I fixtures do not measure server-stop/shell-exit survivors, and no startup test covers this composition. No live counterexample was executed.

**Required:** separate terminal liveness from the authority to retire/replace a launch. Before startup removes a Herdr record or admits a replacement, require the stronger qualified launch-ended/confirmed-stop evidence and its owner gates; unknown must retain it. Keeping terminal `isAlive=false` for status is reasonable if callers do not promote it to that stronger authority. Test RH-A before and after OQ-10 with S ended and a same-session child alive; preserve the record and admit no replacement, in CLI/direct-core paths. State any intended weaker startup policy as an additional explicit owner decision, rather than presenting it as protected by the `absent` gate.

### m-1 — Two small measurement claims exceed their named artifacts

**Design:** §2.2 / section 0 m-1 (EOF interval), §2.3 (`node:ffi`). **Code context:** the planned socket client used by `packages/plugins/runtime-herdr/src/index.ts:331` and `:418`; no product defect is asserted here.

`r6_a_framing_log.txt` records `a_pane_close_second` newline 85.77 ms and EOF 85.78 ms: approximately **0.01 ms**, outside the asserted 0.04–0.22 ms interval “for all 10” samples. The supported conclusion is prompt EOF in these samples; their rounded times are not a minimum-latency guarantee. Also, the cited `r6_h_exec_and_tools_log.txt` contains only `h_exec_bash`, and no saved `r6_` file inspected contains `ERR_UNKNOWN_BUILTIN_MODULE` or the claimed `node:ffi` probe. The earlier Node peer API inspection is saved in `r5_g_node_peer_api.txt`, a different and narrower observation.

**Required:** correct the approximate EOF range/wording and supply the missing probe artifact or label that claim unretained. Neither changes the sound read-to-EOF rule or demonstrates that a public peer-credential method exists.

### m-2 — The stated fit file list omits the parameterized spawn-preflight caller

**Design:** §5.8 last sentence of the new-create rule, §6's 13-file list and F-7, §7 sizing. **Code:** `packages/cli/src/commands/spawn.ts:68`–77, especially the zero-argument `preflight.checkHerdr()`; `packages/cli/src/lib/preflight.ts:41`.

The design requires `ao spawn` to use the same selected-binary/endpoint preflight. The current spawn caller supplies neither, and it is absent from the enumerated 13 product files and F-7 acceptance. Merely parameterizing `checkHerdr` while leaving that call at its ambient defaults retains the binary/endpoint split for spawn readiness.

**Evidence:** direct source evidence; no saved fixture exercises the proposed custom-binary spawn preflight. This is a scope/acceptance omission, separate from the startup replacement findings.

**Required:** include `packages/cli/src/commands/spawn.ts` and its selected-runtime inputs in F-7, or specify a concrete shared mechanism that changes its behavior without ambient fallback. With the ordinary caller update the fit is at least **14 product files**, still reasonably M. Add a spawn-preflight test with the selected binary/endpoint differing from ambient defaults and assert rejection before reservation/worktree creation when the selected endpoint is unavailable.

## Closure of review r5 and prior review r4 M-4

“Closed” is a design-level assessment, with implementation and production tests pending. It does not mean an owner decision has already been made.

| r5 finding | State | Independent assessment |
| --- | --- | --- |
| B-1, connected endpoint before mutation | **Closed for the qualified ordinary transitions; residual owner-gated** | §3.4 connects, rechecks LC and writes on that connection. `r6_c_race_log.txt` c1/c2 supplies the required guarded/control comparison; c3 and `r6_c_held_followup_log.txt` show the held connection cannot migrate to B. R-H2 remains a separate decision. This review's B-1 concerns different evidence. |
| M-1, observation domain | **Closed at design level** | §4.2–4.5 records namespaces/uid/boot and checks domain before negatives, including old handles read in another context. `r6_g_proc_domain_log.txt` supports the normal-host premise; container, hidepid, same-cwd collision and malformed-record refusals are explicitly planned tests, not measured successes. Cwd is no longer the proof. |
| M-2, unbound create cleanup | **Partly closed** | F-4 removes `index.ts:366`, and F-5 refuses the two destroy alternatives at `:400`/`:402`; resources are named and replacement tests are specified. The direct close-site audit is correct. Retaining runtime resources through core rollback still needs this review's M-1. |
| M-3, bare binary pin | **Closed at design level** | §5.7 resolves a bare binary to an absolute executable before discovery/create; relative-with-slash fails, no partial-pin downgrade, attach and four agents use the handle. PATH/cwd tests and the distinction between path and content are explicit. No live PATH-change test is claimed. |
| M-4, startup old record | **Partly closed** | The tmux-only no-server exception and parameterized preflight fix the original direct rejection path. The status/isolated bypass and S-only false need M-2/M-3 here. OQ-14 must also be decided, not assumed covered by OD-24. |
| M-5, bound negative agent answer | **Closed for the S-running case** | §4.8 requires pane ID, shell PID and unchanged S ticks for empty and nonempty lists; missing/foreign/no-server answers reject without a code. It ships with RH-2; per-entry filtering is gone. `falsealive_process_info_w1P.json` explains why. The new ended-launch `[]` path shares B-1 here. |
| M-6, primary-plus-linked last pane | **Closed by the specified measurement** | `r6_e_nm1_log.txt` has target and linked shell PID/ticks, workspace inventory, branches and worktree list before/after. `confirmation_required` leaves them unchanged. NM-3 remains separate and gated. This is stronger than merely observing the refusal code. |
| m-1, framing and pane_info | **Closed at design level** | §4.6 has total read deadline/cap, fatal UTF-8, EOF, one terminal newline and both pane-info reads. `r6_a_framing_log.txt` establishes EOF for the sampled answer kinds. Delayed second line/no EOF tests are named. Minor evidence wording correction is m-1 here. |
| m-2, doc 0004 behavior | **Closed** | `git show 3ad87bd4 -- development/0004_running_ao_on_the_herdr_runtime.md` scopes no-close to stop, discloses both old closes, and says fallback on error or empty/whitespace output, matching `index.ts:485`. |
| m-2 evidence claim: two connections | **Closed** | §2.1 and doc 0004 scope to measured pane operations. `r5_b_cli_forms_log.txt` has two for pane get; `r5_b0_requests_log.txt` has only the failed ping, also for status. |
| m-2 evidence claim: fake no-server mapper | **Closed** | §5.5 correctly says the fixture's `fake server says so` lacks the prefix. `r5_b_pane_get_server_not_running_from_server.cmd` proves forwarding, not mapping; spoofing the prefix is a separate trust assumption. |
| Identity/poll supplements in r5 | **Partly closed** | Exec continuity, UUID/decimal syntax and retrying failed confirmation reads are explicit and supported where claimed. Static same-session HUP/TERM survivors are newly measured and killed. The claim that only escaped descendants remain is not justified by a changing scan (B-1 here). |

| Prior r4 M-4 point, including points already closed by r5 | State in r6 | Evidence / remaining qualification |
| --- | --- | --- |
| Decimal validator rejects actual IDs | **Closed** | `ids/workspace_create_g32.json` / `g33.json`: `w0`, `w11`; r6 grammar accepts them. |
| Complete workspace/pane alphabet and rollover | **Closed for measured range; extrapolation disclosed** | `r6_f_pane_counter_log.txt` spans `p1` through `pZ`, skipping I/L/O/U, then `p0`, `p11`–`p13`. Arbitrary longer IDs are expressly inferred. |
| Version/executable qualification | **Closed conditionally at design level** | Exact 0.9.5/22 ping under CG, F-6 absolute path, and A-1–A-3. `r5_b_ping_version_0_9_4.json` confirms the CLI alone is insufficient. Binary replacement is expressly outside a path pin. |
| h5 catch-all proc errors | **Closed for the S predicate** | §4.5 specifies ENOENT/ESRCH, Z/X, ticks/boot mismatch versus EACCES/EIO/parse failures. Domain gate comes first. The added session-empty inference has B-1 here; it is not h5's old catch-all. |
| Different peer plus unknown error | **Closed as an outcome rule** | While S runs, C2's unknown/error/no-answer is `unknown`; no shortcut to absence. `r5_b_cli_forms_log.txt` contains the unknown-code transport. |
| No-connection branch too broad | **Closed** | Every RH connection failure is unknown. Only independent process evidence can authorize absence. Fit no-server is explicitly a different, endpoint-level signal. |
| EACCES | **Closed** | §4.3/4.5/4.6 reject; `r5_c_socket_mode_000_cli.cmd` is Rust text, not a no-server envelope. |
| Malformed and partial replies | **Closed at design level** | EOF framing and §4.14 test 18 cover late trailing data, invalid UTF-8, split lines and no EOF. This runs the intended production modules, not h5. |
| Missing fields/unrecognized codes | **Closed at design level** | Exact field/type checks and unknown-code refusal; no empty-list fallback from an unrecognized response. |
| Nonexistence versus unreadability/domain | **Closed at design level for S** | Recorded namespace/uid plus proc visibility and boot checks; cross-context reads reject even if stat would be ENOENT. The host fixture does not replace those negative tests. |
| Peer changes on each connection | **Closed for qualified ordinary transitions, conditional on R-H2 decision** | CG is before each write, not only after the reply. Restart/handoff fixtures directly improve on r5's rename-detection-only evidence. |
| Exact production classifier under test | **Closed as a test-plan decision; not executed** | §4.14 uses the production modules with a real socket stand-in and injected proc seam. Add B-1/M-1/M-2/M-3 cases here; fixtures alone do not qualify the future classifier. |

## Connected guard, residual R-H2, and the split

For normal 0.9.5 transitions under A-1–A-3, the binding argument is reasonable. A connection to listener A remains A's connection; a later pathname bind does not retarget it. If AO connects to replacement B after its last precheck, the post-connect LC differs before any write. If A and B both retain listeners with the recorded bind-path text, the uniqueness check rejects. If the old server closes, an already-connected request cannot jump to the new server. The file inode alone is explicitly inadequate: the restart fixture actually reuses it.

The measured samples support these transitions; they are not an exhaustive crash/handoff schedule proof. In particular, the text must continue to condition the reasoning on truthful server behavior, no ID reuse within a run and no accepted-connection/listener transfer to a run with replacement shells. Do not turn “no such behavior was seen” into an unconditional kernel guarantee about Herdr's implementation.

R-H2 is now materially different from the r5 ordinary restart bug: the wrong destination would have to coexist with LC0's exact evidence and disappear from that evidence before the write, via the named alias/file manipulation and accepted-connection behavior. No saved normal restart/handoff does that. OQ-11 and OQ-12 are therefore fairly separated. Acceptance can be a reasonable explicit threat-boundary choice, but A-1 (truthful owner program) and OD-23 do not themselves authorize deliberate routing interference. The brief's allowed fallback/refusal choices should remain real choices.

The `ss` result is a useful feasibility measurement, not a complete qualified fallback yet. `r6_h_ss_peer_log.txt` matches **client inode 28991496** to the peer field in a unique established server-side row and holder 681160, agreeing with SO_PEERCRED. A future Node helper must identify *that exact connection*, check holder PID and start ticks in the qualified domain, reject missing/ambiguous/stale rows and missing permissions, and impose a deadline before writing. Matching only a path or the first `ss` row would not suffice when requests overlap. Specify and test the Node connection-to-inode mechanism and replacement races before choosing OQ-12(b); the one static query does not establish these. Refusal-only remains available if either binding implementation cannot be qualified.

Splitting RH is useful. RH-B's enumerated gates include RH-A/live checks, NM-1, NM-3, OQ-10, OQ-12 and destructive live tests; OQ-11 is also explicitly listed in the round table. Gate acceptance must mean acceptance of the selected, qualified transport, not merely answering a question. RH-A's `absent` is a destructive authorization even without a request. It needs a corrected absence predicate (B-1), an identity bound to the admitted launch (B-2), and coverage of all consumers that can remove/replace state (M-1–M-3); the existing OQ-10 gate alone is insufficient. Test/live qualification may exercise gated outcomes in isolation, but normal use must retain refusal until the applicable gates pass. Do not execute a real-Claude NM-3 turn as part of the design review.

## Fit F-1–F-8, W-1–W-9, acceptance and sizes

The W mapping is complete: W-1/W-2/W-6 → F-1, W-8 → F-2, W-3 → F-3, W-5a → F-4, W-5b → F-5, W-7/W-9 → F-8; W-4 is explicitly deferred. F-6 and F-7 are additional safety prerequisites. “Complete mapping” does not mean that each safety acceptance is sufficient.

| Item | Assessment of acceptance |
| --- | --- |
| F-1 | Good: shared failure classifier, numeric exit 1, no signal/timeout, empty stdout, exact stderr keys and expected command ID; preserve top-level no-server code through wrappers and lifecycle. Add no-server tests through terminal-record startup (M-2), not just direct classifier calls. Legacy stdout/exit-0 forms remain intact. Successful pane-read text stays text. |
| F-2 | Good: invalid/non-grammar IDs reject before a process call; empty row 8 stays `[]` without a call, empty row 9 rejects. Actual rollover positives are now named. Assert the synthesized session-name handle makes no call. For handles with S, all readers must perform the explicit record checks rather than bypassing core via an agent's empty-ID fallback. |
| F-3 | Good: typed refusal across runtime/core/CLI, no raw fallback or forced restore, blocked initial and later polls, and earlier-attempt uncertainty. The later-poll test must identify the actual polling stage and assert every prompt/raw-input call, so “admitted none” is not inferred after an earlier submission. |
| F-4 | Plugin-level zero-close/resource-name checks are necessary, but insufficient. Add partial-runtime failure propagation and full core rollback assertions (M-1), including timeout after admission and failed cleanup after RH-B. |
| F-5 | Good: unconditional refusal with zero calls, including empty handle, plus deliberate oracle changes. Keep the legacy stop's unknown control. |
| F-6 | Good: resolved absolute executable, partial/malformed pin rejection, changed PATH/cwd, every handle-based call and attach environment. Exercise all four agent wrappers and OpenCode's second process-list call site. A path pin remains neither file-content identity nor server-run identity. |
| F-7 | Parameterized readiness and the tmux-only no-server exception are right. Add terminal/activity-independent old-record selection, direct-core isolated guard, the stronger RH-A replacement predicate, and the spawn caller (M-2/M-3/m-2). A preflight result is never launch-death evidence. Old-record reuse must not depend on caller-endpoint readiness. |
| F-8 | Documentation changes are supported, including both output-fallback triggers and scoped handoff samples. Synchronize the actual R4 table, CLAUDE.md and comments after implementation; fix the small evidence wording in m-1. |
| W-4 later round | The proposed one attempt from `done`, no raw fallback and end-to-end “sent, not confirmed” addresses the measured triple-send. It must survive core's restore retry. Keep the named duplicate risk for `idle`; real-Claude timings do not provide an admission receipt. |

**Oracle changes are named.** F-5 lists the three positive `destroy` tests at `runtime-herdr/src/__tests__/index.test.ts:165`–186 and the same-ID r2 N-1 control; these should deliberately become refusal tests. F-1 adds exact stderr controls rather than changing all nonzero-exit failures to absence. I checked `core/src/__tests__/herdr.test.ts:163`/`:173` and runtime tests `:449`/`:476`: their wrong-code/missing-ID/nonempty-stdout/plain-error forms still reject under F1. RH-A adds new S-handle oracles while keeping the R2a unknown control for legacy handles. Broadly changing those old near misses would weaken the contract.

The fit is still plausibly **M**, but its enumerated list needs the spawn caller (normally at least 14 product files), and F-4/F-7 are safety behavior changes deserving their own integration acceptance. RH-A is **M**, with substantive Linux process/domain and lifecycle integration, not just a few reads. Its create acceptance must bind S to launch admission and exercise the capture-to-submit restart (B-2), not just prove that capture precedes submission. RH-B is **S in incremental file footprint**, **high risk**; that size is defensible only if RH-A has already supplied a qualified client and corrected launch-death predicate. The extra qualification required by B-1/B-2 may change that estimate. Production-classifier tests, then an isolated matrix, then live checks remain the right order. The live matrix should add the capture-to-submit restart, failed-create rollback and startup after a persisted outage kill. Keep ordinary removal disabled while the relevant owner gates are unresolved.

## Fixture spot-check audit

All names below are relative to `development/artifacts/herdr_095_live_check/`. These are direct artifact reads; none was rerun.

| # | r6 claim and named fixture | Independent check |
| --- | --- | --- |
| 1 | Exact server pair — `r6_a_framing_log.txt`, `a_ping` | `pong`, version `0.9.5`, protocol 22; capability additions are present. |
| 2 | EOF framing / split chunks — `r6_a_framing_log.txt` | Ten sampled request outcomes have one newline, zero trailing bytes and EOF; several answers take two chunks. The pane-close sample's approximate newline-to-EOF difference is 0.01 ms, so the quoted lower bound needs m-1. |
| 3 | Idle/read timing — `r6_a_framing_log.txt`, `b_delayed_write_*`, `b_idle_no_request_20s` | Writes delayed 0/0.2/1/3 s receive pong; 10 s gets EPIPE; idle recv returns EOF at 5016.2 ms. These are sampled observations, not universal timing guarantees. |
| 4 | Guarded restart — `r6_c_race_log.txt`, c1 | Precheck has listener 28911311, post-connect has 28959870; no request written; replacement shell 659426 remains with the same ticks. |
| 5 | Unguarded control — `r6_c_race_log.txt`, c2 | B answers `ok`; its restored pane becomes not-found, shell 659885 disappears and workspace list is empty. This is live evidence for the exact r5 defect. |
| 6 | Held Node connection — `r6_c_race_log.txt`, c3 | Post-connect check passes on old listener; replacement then occurs; client records a 3 s deadline and empty answer, while B's shell 660039 stays. It does **not** record a Node EOF/EPIPE event. |
| 7 | Held raw connection — `r6_c_held_followup_log.txt` | SO_PEERCRED matches each old server; after that PID disappears, read is EOF, or write EPIPE then read EOF. Supports the narrow transport claim, distinct from Node c3. |
| 8 | Filesystem inode reuse — `r6_c_race_log.txt` and `r6_c_held_followup_log.txt` | Socket-file pair 66309:121256363 repeats while listener inodes change. Correct reason to retain listener identity rather than rely on path stat alone. |
| 9 | Handoff — `r6_d_handoff_log.txt` | Old server 669304 → 677031; file/listener change; shell 677015 keeps ticks 20286965; guarded client refuses and held raw connection gets EPIPE. The measured pane's terminal changes. No AO/real-Claude handoff was run. |
| 10 | NM-1 refusal and collateral safety — `r6_e_nm1_log.txt` | `confirmation_required`; primary shell 681221 and linked shell 681231 retain ticks, both workspaces remain, git branches/worktree listings and directory presence agree before/after. |
| 11 | Linked-checkout source refusal — `r6_e_nm1_log.txt`, e2 | `linked_worktree_source` after creating a workspace with cwd in the AO-like linked checkout. Supports the measured worker-workspace case, not every conceivable operator reconfiguration. |
| 12 | Pane alphabet/rollover — `r6_f_pane_counter_log.txt` | Full saved sequence ends `pZ`, `p0`, `p11`, `p12`, `p13`, omits I/L/O/U. Longer components remain extrapolation as r6 now states. |
| 13 | Observation domain/environment — `r6_g_proc_domain_log.txt` | Single NSpid values, equal PID/user namespace IDs, uid 44402, plain proc mount, Node statfs 40864/0x9fa0, and matching pane/socket environment. No container/hidepid refusal was measured. |
| 14 | Exec sh — `r6_g_proc_domain_log.txt`, `g_exec_continuity` | PID 693528/ticks 20294795 remain, process-info shell remains the same, argv becomes `sh`. |
| 15 | Exec bash — `r6_h_exec_and_tools_log.txt` | PID 696859/ticks 20297104 remain while comm changes sh→bash; process-info retains the shell PID. The named log contains no ffi probe (m-1). |
| 16 | Shell's independent exit — `r6_g_proc_domain_log.txt`, `g_exit_after` | Shell stat is ENOENT; pane and workspace are not-found. It does not test children of that exiting shell. |
| 17 | Same-session static jobs — `r6_i_session_log.txt` | Shell and the two listed background jobs are gone after close; saved session scan is empty. No concurrent fork test. |
| 18 | HUP/TERM-ignoring child and escalation — `r6_i_signals_log.txt`, `r6_logs/strace_summary_part_i.txt` | Child 817065 logs HUP/TERM and disappears; trace includes SIGKILL. Timestamped calls on 820765 are about 264.5 and 264.9 ms apart. This qualifies those measured children, not an evolving session population. |
| 19 | Escaped child — `r6_i_signals_setsid_log.txt` | Child 820767 has its own session ID, gets no logged signal and survives; same-session 820765 ends. Supports the existence of R-H1, not completeness of the claimed narrowing. |
| 20 | ss feasibility — `r6_h_ss_peer_log.txt` | Unique server-side ESTAB row peers to client inode 28991496; holder PID 681160 equals SO_PEERCRED, cost 22.9 ms. No Node concurrent/replacement fallback qualification. |
| 21 | New CLI error channel — `closedpane_pane_get.cmd`, `closedpane_pane_process_info.cmd` | Exit 1, zero stdout bytes, stderr pane-not-found envelopes, respectively command IDs `cli:pane:get` and `cli:pane:process_info`. |
| 22 | EACCES versus no-server — `r5_c_socket_mode_000_cli.cmd`, `r5_c_stale_socket_file_cli.cmd` | EACCES is Rust debug stderr; stale socket has exact `server_not_running` message prefix and command ID. Neither proves a hidden launch ended. |
| 23 | CLI protocol is not exact-version qualification — `r5_b_ping_version_0_9_4.cmd` / `.json` | Exit 0 with a pane result despite the fake ping version 0.9.4/protocol 22. |
| 24 | Connection and mapper evidence corrections — `r5_b_cli_forms_log.txt`, `r5_b0_requests_log.txt`, `r5_b_pane_get_server_not_running_from_server.cmd` | Successful pane get uses two connections; failed ping stops at one; fake-server no-server text lacks the mapper prefix. All three corrections agree with r6. |
| 25 | Endpoint precedence — `r5_path_env_socket_and_env_session.cmd`, `r5_path_env_socket_and_flag_session.cmd` | Socket override beats session environment; explicit `--session` beats override. This supports per-handle pinning, not server-run identity. |
| 26 | Workspace rollover / foreign agent — `ids/workspace_create_g32.json`, `g33.json`, `falsealive_process_info_w1P.json` | `w0`, `w11`; reused `w1P:p1` lists shell 3044179 and another session's claude 3044197. Supports grammar and response-to-S binding. |
| 27 | Launch submission — `r5_b_cli_forms_log.txt`, `b_req_pane_run`, and `r5_b_req_pane_run.cmd` | Initial ping and then `pane.send_input` with pane ID, command text and Enter; no expected shell/terminal. CLI invocation exits 0. No capture-to-submit restart is measured. |

The schema `api_schema.json`, `PaneTarget`, lists only `pane_id`, supporting the lack of a server-side expected-shell condition. No fixture establishes an atomic session-empty read, full partial-create/core rollback, the new startup compositions, cross-namespace rejection, changed-PATH pin enforcement, a complete Node ss fallback, or real-Claude/MCP descendant containment. These are remaining design/test obligations, not inferred completed measurements. The r6 network summaries cover traced processes; the handoff successor's untraced interval is disclosed in the design and must not be represented as fully traced.

## OQ-1 through OQ-14

| Question | Reviewer recommendation |
| --- | --- |
| OQ-1, CLI for reads outside RH | **(a).** The strict F1 classifier with command-specific IDs is a reasonable fit change. Preserve the legacy channel and successful text/list contracts. It intentionally trusts the CLI boundary, which can hide later wire lines. |
| OQ-2, pins in fit | **(a).** Resolve before discovery/create; use the absolute binary and endpoint everywhere; malformed/partial pins reject. Keep legacy environment dependence explicit. Include the parameterized spawn preflight (m-2). |
| OQ-3, launch identity | **(a), conditionally.** S plus the recorded domain/environment proof is better suited to handoff than a server-incarnation-only launch identity. Bind that S to actual launch admission (B-2). The stop's connection binding and the stronger “launch ended” predicate are separate obligations; B-1 still needs correction. |
| OQ-4, RH-2 with the bound agent check | **(a), with M-3's consumer separation.** Shipping them together fixes the S-running hidden/foreign/missing-pane false negative. Terminal liveness must not silently authorize startup cleanup/replacement. |
| OQ-5, duplicate sends | **(a).** Keep the later round, one attempt from `done`, no raw fallback and end-to-end admitted-but-unconfirmed handling. An `idle` retry remains a named delivery risk. A timing measurement does not prove exactly-once delivery. |
| OQ-6, both cleanup paths refuse | **(a), with M-1.** Removing unbound closes is right, as are the named destroy-oracle changes. Preserve all resources through partial-create rollback; a plain thrown message is not enough. |
| OQ-7, conservative startup and preflight | **(a), after M-2/M-3.** Check old launches regardless of terminal/activity filtering and in isolated core calls; distinguish readiness from death. Parameterize the selected endpoint/binary without making healthy old-record reuse depend on the ambient endpoint. |
| OQ-8, authoritative Herdr negatives | **(a), not now.** Later qualification must be per supported S handle and cover all negative paths, not an unconditional runtime-name set containing legacy handles. |
| OQ-9, no live handoff for handles without S | **(a).** Keep the restriction for every legacy/fallback record without usable S evidence after rollout. Merely deploying RH-A does not retrofit live records. Unreadable/malformed S must fail closed. |
| OQ-10, R-H1 | **Do not decide on the current narrowed description.** First resolve B-1, then perform owner-approved NM-3 and explicitly decide the actual residual. A cwd scan may be an extra refusal heuristic, but skipped unreadable cwds and unrelated owner shells make it neither containment nor a substitute for the session proof. Name matching is weaker still. OD-14 does not preauthorize this policy. |
| OQ-11, mutation binding | **(b), subject to the stated assumptions and gates; pursue (c).** CG addresses the measured ordinary race without an additional binary dependency. Conditional server-side close is the stronger long-term interface. A fully qualified helper or continued refusal remains appropriate if CG's residual is declined. |
| OQ-12, accept R-H2 | **An explicit owner choice; (a) is defensible within a deliberately limited same-user interference model.** It is fairly separated from the r5 ordinary race now. Do not treat A-1/OD-23 as prior acceptance. If declined, qualify the exact-connection ss/helper path before selecting (b); until then use (c). |
| OQ-13, RH-A/RH-B split | **(a), with corrected gates/consumers.** The split limits destructive requests and enables separate validation, but absence authorizations and startup effects still need the safety checks above. |
| OQ-14, reachable missing/replaced pane before RH-A | **Prefer (b) for startup authority**, while retaining the R4 row-9 liveness result. A reachable new server can report not-found/another terminal while a hidden old server still runs. If the owner selects (a) for recovery convenience, explicitly accept that startup duplication/record-retirement residual and its relationship to OD-24; do not describe it as proof the launch ended. Add that exact scenario to startup tests. |

## What is correct

- The guard is placed before the destructive write on the already-connected socket, and the real guarded/unguarded comparison directly addresses review r5's blocker.
- Domain checks precede negative process evidence; syntactic validation, boot identity, exec continuity and fail-closed errors are explicit. The environment proof is stronger than cwd equality.
- The agent response now binds its pane and shell before accepting an empty list. Hidden or moved live panes reject; dropping the optional per-entry filter is correct.
- NM-1 now measures collateral identities and filesystem/git state; refusing the worktree-group close is a supported outcome. Exact socket framing and the expected pane-info type are also corrected.
- F1, blocked-send refusal through core/CLI, legacy-control preservation, explicit oracle changes and the focused round order address recorded product behavior. Doc 0004's two requested behavior corrections match the source.

## Review process and verification

I read r6, review r5 and its Required texts, r5/reference r4 RH and M-4, the step-1 report and raw fixtures, the R4 rows/owner decisions, affected runtime/core/agent/lifecycle/start/preflight sources, and `git show 3ad87bd4 -- development/0004_running_ao_on_the_herdr_runtime.md` before consulting the author's report and brief. The session-scan, rollback and two startup counterexamples were recorded in this review file before that consultation. The capture-to-submit launch race (B-2) was identified in the final source cross-check. The report repeats full closure and the narrowed session guarantee; it supplies no additional protocol resolving these counterexamples. The completed review reorganizes those interim notes above.

Marker: `/tmp/aorhr6-marker`. The mandated initial `ls -la --time-style=full-iso ~/.ao/bin` was:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

No live measurements were performed. I ran no Herdr, AO, tmux, Node, pnpm, helper script or real agent, and no network call. No scratch server/process was created, no PID was signaled, no other pane was read, and no `/tmp/aorhr6` tree was created. The owner's Herdr directories were not inspected. Consequently the conditional live-measurement cleanup `find` scans are unnecessary and were not run. The final `~/.ao/bin` listing was identical to the initial listing. The temporary file used to assemble the report was moved into `.agent_report.md`, leaving no scratch tree to remove.

Only this review and the explicitly required `.agent_report.md` were written in the worktree. `.agent_task.md` was supplied externally and left unchanged. Final `git status --short` showed exactly those three untracked paths, with no tracked modifications. `git diff --exit-code` and the explicit `packages docs .github agent-orchestrator.yaml` check passed. Builds/tests were not run for this document-only assignment; no implemented behavior was claimed verified. No branch operation, commit, fetch, push, PR or message to another session was made.
