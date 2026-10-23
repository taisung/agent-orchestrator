# Herdr fit-2 design r9 review — 2026-10-22

NOT-SOUND

Counts: **0 blocking, 1 major, 4 minor findings.** R9 closes the principal admission-name and CLI-reuse defects, but restore publication failures still bypass claim settlement. The implementation plan needs the changes below.

Baseline: `5f38ffd4`, verified with `git log --oneline -1`. Review only: no code changes,
commits, network, AO commands, runtime measurements, agent/model processes, or product tests.
Fit-1 is inspected as local Git objects at `9d51982b`; relaunch at `7a20242f`.

## Initial isolation evidence

Created `/tmp/aofr9-marker` at the start. Initial
`ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Independent reading notes

Read the r9 design and both r8 reviews before the source audit. The canonical nearest-existing-ancestor
subject fixes the earlier mkdir-induced name change in principle. The new shared core reuse method
states R1–R7, and the settlement table explicitly covers resident restore and retained post-create
failures. The audit must still check the specified interleavings, restore write failures, and actual
fit-1/relaunch API behavior. No author report/brief has yet been consulted.

Source audit checkpoint (still before the author report):

- Fit-1's `restore` success publication is a bare `updateMetadataIf` at `session-manager.ts:4580`;
  a thrown write is different from its handled `null` conflict. R9 §5.2.4 describes only `null`
  at step 10, then reaches settlement after step 11. A thrown publication can therefore strand
  the newly acquired live claim and P in a resident caller. This needs an explicit end path.
- R9's transition write-back (§5.2.4 step 8) spreads `ownClaim` into its compare but always clears
  both keys. If `ownClaim` is null, that compare has no claim fields. This does not satisfy the
  stated rule that a claimless operation makes no settlement write and never clears later values.
- The T-7.21c schedule needs scrutiny: process 2 reaches `subject-fixed` before process 1 is
  released, but the r8 lock name alone does not force process 2 to complete empty G before process
  1 publishes P. Also, retaining r9's post-mkdir subject equality check makes the lexical-subject
  mutant refuse process 1, rather than admit both. Separate the algorithm and interleaving claims.
- Today's unprepared reservation contains no worktree/branch/agent/createdAt fields. P/role/claim
  alone does not make a crashed unprepared launch the full retained-record shape of §5.2.5.

After recording the above, read the author's r9 report (its current-round section) and r9 brief.
They repeat the every-end-path settlement claim, but add no handler for a thrown restore success
publication and no null-claim exception to the transition rollback. They do not resolve the findings.
The appended reports of older author rounds were not used as independent evidence.

## Findings

### M-1 — Restore still strands its live claim on publication errors

**Design:** §4.5 (lines 372–394, especially the restore failure row), §5.2.4 steps 9–12
(lines 670–679), T-4.16/T-4.16b. **Code:** fit-1 `packages/core/src/session-manager.ts:4580`
(the success publication), `:4586` (only the null result is handled), `:4614` (ownership advances
only after publication), `:4647` (return). `packages/core/src/metadata.ts:656` and `:664`
call the record lock and writer; `:268` and `:277` show concrete throwing lock failures.

Take the resident, terminal-handleless OpenCode-shaped restore of T-4.16. The transition succeeds,
writing P and this process's claim. Runtime create succeeds. Make only the next metadata write
throw (record-lock contention, an I/O error); subsequent writes can succeed. Today's bare success
write propagates the exception. R9 specifies handling its **null** result, but does not put a
throw through settlement or retained-launch handling. Step 12 is never reached. The record keeps
P and a claim of a still-running caller although this operation has ended. Kill/F-9 and startup
remain blocked as `in-progress` for that caller's lifetime, and the persisted record never gets
the returned handle. The original problem of r8 sol M-3 therefore survives a different end path.

There is an explicit sibling gap: the partial-handle publication in step 9 treats both null and
throw as “no settlement” (lines 673–674). Null after a replacement and a transient failed write
while the record is still this operation's P are different ownership states. A kept runtime warning
alone neither attempts claim settlement nor reports that a resident claim remains live. The blanket
§4.5 warning rule applies to a failed **settlement** write; here no settlement is attempted.

**Required:** handle thrown success and partial publications separately from a proved replacement.
On a still-owned pending record, retain every resource, preserve/report the actual returned or
partial handle, and attempt owner-conditional settlement against the identity that is still on disk.
If the record cannot be read/written, keep it and explicitly warn that its live claim remains, naming
the PID and kept resources. Never clear a replacement's claim. Update the §4.5 end-path table and
add resident-process tests for a one-shot success-publication failure, a one-shot partial-publication
failure, persistent failure with the warning, and replacement controls. T-4.16b injects only the
later settlement write and cannot cover these earlier failures. This correction does not require R3.

### m-1 — A claimless restore rollback can clear claim values it never owned

**Design:** §4.5 lines 350–358 and 366–376; §5.2.4 lines 664–670; §6's `restoredAt` row.
**Code:** fit-1 `packages/core/src/session-manager.ts:339`–`:346` permits a null claim;
`packages/core/src/metadata.ts:347`–`:351` compares only supplied keys, and `:656`–`:674`
merges the supplied updates without inventing an ownership predicate.

The transition write-back compares `{ ...launchIdentity(owned), ...ownClaim }` but always writes
`...CLEARED_LAUNCH_CLAIM`. With `ownClaim === null`, spreading it contributes no keys, so the rollback
can clear a different PID/start pair that appeared without changing launch identity. This is exactly
the class of same-identity later-claim value that T-4.18 explicitly promises to preserve. It also
contradicts §4.5's “no write when ownClaim is null” settlement policy. This finding does not assume
that same-ID R3 is already implemented; it concerns the specified clear's conditional ownership.

**Required:** specify the null-claim branch of transition rollback. Restore the old handle/time only
under an exact comparison of the claim state actually published, and clear claim keys only when
this operation acquired and still owns them; a claimless rollback must preserve claim values.
Test workspace failure and plain-create refusal with `readLaunchClaim()` null, with and without a
later claim-only change. Keep the successful later-claim test too.

### m-2 — T-7.21c overstates the interleaving proved by its proposed mutant

**Design:** §4.9 lines 492–496, T-7.21c (line 1016), §8 D2 (lines 1272–1275).
**Code:** `packages/core/src/metadata.ts:907` creates the directory before `:955` publishes the
reservation; fit-1 `packages/core/src/session-manager.ts:1385` retries numbered reservations.
Fixture `r9_admission_subject_check.txt:1` proves two names for the r8 rule, not two admissions.

The normal two-process test is useful. Its D2 claim that substituting only the r8 subject rule
makes both processes launch is not established. Keeping r9's mandatory post-mkdir equality check
makes process 1's lexical subject differ from the new realpath, so it refuses. Also, a process-2
`subject-fixed` acknowledgement alone does not force its G read to occur before process 1 publishes
P; after releasing process 1 either process can run first. Distinct lock names permit the unsafe
schedule, but do not force it. A mutant can fail for the equality refusal or can run a safe schedule,
which must not be reported as measured duplicate admission.

**Required:** distinguish the algorithm unit mutant (subject equality before/after mkdir) from the
controlled duplicate-admission mutant. If the latter is required, name the coherent r8 reversion
(including the dependent equality checks) and add barriers proving process 2 passed empty G while
process 1 still had no reservation. Keep exactly-one successful launch and loser-reason assertions
on the real r9 implementation. Report what each D2 run actually demonstrates.

### m-3 — Commit 3 omits existing fit-1 pin-test oracle changes; a helper fact is wrong

**Design:** §2.1 test-helper row (line 96), §5.2.7, §7's test list (lines 1242–1248), §8 commit 3.
**Code:** `9d51982b:packages/plugins/runtime-herdr/src/__tests__/fit-pins.test.ts:90`–`:98`
queues exactly status/create/run for `pinnedHandle`; `:102`–`:122` queues and asserts those three
calls; `:125`–`:136` expressly expects `workspace close` with the pins. Its helper is
`src/__tests__/herdr-fixtures.ts:65`–`:66`.

Adding the post-run pane get means `pinnedHandle()` and the pin-create test have no fourth reply;
removing cleanup directly contradicts the failed-launch pin test. Neither file/oracle is named in
the migration table or test list. Thus “every changed oracle” and commit-3 green coverage are
incomplete on the actual fit-1 base. Further, `statusRunning()` does not synthesize status without
`compatible`: it reads `closedpane_status_server_json.json`, which already has `compatible:true`.
Core and CLI's copies of `herdr-fixtures.ts` contain only the fixture reader/rejection helper,
not `statusRunning`, `STATUS_SOCKET` or `standInHerdrOnPath`.

**Required:** add `fit-pins.test.ts` to commit 3 and the test list; queue the matching post-run pane
reply in both successful-create setups, assert the fourth call's pins, and replace the cleanup-close
oracle with typed partial retention/zero-close assertions. Correct the helper row and limit the
`compatible:true` mock migration to mocks that actually lack it (such as `index.test.ts`). The
17-product-file count is unaffected.

### m-4 — A crashed unprepared P record lacks the promised recovery fields

**Design:** §4.4 lines 311–318, §5.2.5 lines 688–693, §5.3.8 empty-pane recovery, §5.4.2 removal scope.
**Code:** fit-1 `packages/core/src/session-manager.ts:1317`, `:1385`, `:2581` publish only the
initial claim; the unprepared worker first writes worktree/branch/agent/createdAt at `:2326`–`:2343`
after create, and the orchestrator at `:2880`–`:2894`. Prepared orchestrators write these earlier
at `:2818`–`:2832`. `packages/core/src/metadata.ts:916`–`:923` adds only reservation/generation.

R9 adds P, role and claim to initial publication, but specifies no pre-create normal-field write
for unprepared agents. If the process dies inside `pane run`, its record is P/role/claim/reservation,
without worktree, branch, agent, createdAt, or the endpoint pins. It is not §5.2.5's “same state
without launchFailed” as a fully published kept failed launch. The empty-pane message cannot print
the promised cwd from that record, and F-9's existing kill cannot remove a managed worktree that
no record field names. P still blocks another admission; this is a recovery/schema issue, not a
second-launch escape.

**Required:** state the sparse crashed-record shape honestly. Persist the known workspace/branch/
agent/launch fields while preserving P before entering create, or explicitly give a recovery path
for sparse P (including unknown endpoint/path) and say which resources F-9 cannot locate. Add an
unprepared in-flight record assertion for these fields, beyond T-4.15's P/role/claim assertions.
Do not imply that a crash can persist a partial handle that create never returned.

## R8 finding disposition

“Closed” is a design-level assessment, conditional on implementation and the named owner choices.
It does not mean the tests exist or passed. Duplicate findings retain both reviewers' IDs.

| R8 finding | R9 state | Independent evidence and qualification |
| --- | --- | --- |
| sol M-1, unstable first-mkdir admission name | Closed in the algorithm; test wording needs m-2 | §4.9 canonicalizes the nearest existing ancestor and appends the missing suffix, fixes it per operation, refuses unexpected lookup states, and rechecks before publication. The r9 path fixture verifies name stability. Metadata's existing mkdir/link order can carry this protocol. |
| sol M-2, CLI reuse bypass | Closed for parseable Herdr candidates | §4.7 R1–R7 and §5.3.2 require strict deciding-round reads, own-launch exclusion, failure/incomplete exclusion, runtime/status checks and token-bound alive evidence. §5.3.5 routes those CLI candidates to core, including isolated ones. T-7.27 pauses after the handle write, which today's `:2894` places before awaited setup; T-7.28 replaces/fails the candidate during the probe. Final reuse must use the freshly validated record. |
| sol M-3, restore/retained-failure claim settlement | Partly closed | §4.5 now explicitly settles prepared and unprepared restores after step 11 and retained failures through `keepUnconfirmedLaunch`; T-4.16/17/18 cover the previously missing principal cases. M-1 above leaves publication-error end paths incomplete; m-1 covers null-claim rollback. |
| sol m-1, restore workspace work under A | Closed in ordering | §5.2.4 publishes transition P/claim after the old stop, then releases A before workspace restore. T-7.26b/c check the pause and throw. Today's workspace restore at `:4519` and postCreate at `:4531` are both outside A under this sequence. |
| sol m-2, status token plumbing/list | Closed | §4.8/§5.5 name metadata.ts + index export, raw-record derivation, separate SessionInfo fields, human rendering and additive JSON, commit 7. Today's status.ts carries only failure text at `:46` and prints it at `:229`–`:232`; the added file is necessary. |
| sol m-3, cleanup dispatch and kill compatibility | Closed | §4.6 names cleanup plus T-7.8e, and distinguishes kill's skip for a missing non-set plugin from list's fallback. These are the actual different branches at fit-1 session-manager.ts `:3094` onward, `:1532` onward and `:3436` onward. |
| sol m-4, F-9 replacement test checkpoint | Closed | T-9.8a mutates during the sole read, so retire CAS fails. T-9.8b mutates inside workspace destroy after the retire write; T-9.8c inside the awaited purge holder lookup. These reach the real callback checks at fit-1 `:3139` and `:3186`; they no longer confuse pre-write with post-write races. |
| sol m-5, empty-ID ownership fact | Closed | §3.3/§4.4 correctly state that two empty IDs match. §5.2.3 conservatively treats any incomplete stored handle as may-own and makes a non-owned Herdr rollback remove nothing. T-4.7b includes the prepared-agent discard assertion. |
| Muse m-1, status/token home/file count | Closed | Same closure as sol m-2. metadata.ts is the token's home, index.ts exports it; section 7 lists 17 distinct product paths, two comment-only. |
| Muse m-2, Q1 socket before a handle exists | Closed | §4.3 explicitly compares `endpoint.socket` from step 1; fit-1 create forms `pinned.env.HERDR_SOCKET_PATH` from that value at `:438`–`:440`, before workspace create. |
| Muse m-3, empty-ID rationale | Closed | Same source-based closure as sol m-5; no fictitious nonempty check is relied on. |
| Muse m-4, relaunch integration | Closed as a merge contract | Section 6 names shared keys/functions/hunks, token-name collision, a common owner-aware settlement helper, second-landing responsibility and both test sets. R3/M-6 remain explicitly open; m-1 must also be resolved before claiming all rollback writes obey that helper's ownership rule. |
| Muse m-5, log section citations | Closed | §3.1 and Q cite r8_cli_forms_log.txt and its section names. The log contains the cases; separate per-case r8 files are not invented. |
| Muse m-6, probe/lock bounds | Closed for the requested runtime-call bound | §4.7/§5.3.1/§5.3.2 give core 10 s bounds and move Herdr probes outside A; T-7.29 tests access to A while a probe hangs. This bounds calls, not filesystem latency or arbitrary third-party hook execution; “about 20 s” is a retained-plugin estimate, not a universal wall-clock guarantee. |

Muse D-F1 is resolved as a dependency-check issue: the actual fit-1 Git objects are available here.
G0 should remain because the landing base can change. Sol's protocol-23 pane-run fixture note is
closed by the new saved measurement; the revised OQ-F5 wording correctly keeps RH B-2 open.

## Admission subject, reuse and the fit-1 guard gaps

The canonical algorithm walks up only after both realpath and lstat say ENOENT. A dangling symlink,
a file in a parent component, permission error, loop and other lookup errors refuse; the root is
not an infinite walk. Prepending suffix components in the design is equivalent to reversing the
push list once in the saved script. All three admission entry paths use the same subject function.
A start checks after mkdir and immediately before reservation; restore checks before copy-back and
transition. No await is allowed between the final check and publication. R-A remains a real named
limit: those are distinct filesystem syscalls, not an atomic directory binding. OQ-F9(a) is reasonable
for directories AO itself only creates normally.

The rounds do not hold A over Herdr probes. An answer is keyed by session ID and identity token;
the next round rechecks R1–R6 even if status/failure/claim writes did not change the token. A replaced
record needs a new probe. Restore needs no reuse probes and excludes only its own ID. Reuse-only
admits no launch, so returning safe candidates while dropping unproven records is consistent with
the narrower purpose of that API. Any final strict re-read after awaited project hooks must apply
the same predicate/identity check, not merely copy whatever handle is present (the old core shortcut
at fit-1 `:2539`–`:2547` did the latter).

CLI candidates of another runtime retain today's probe/compatibility policy; those without a
parseable stored handle remain `unchecked` by OQ-F10(a). This keeps the no-new-launch behavior but
can print successful “reuse” of a stale or damaged record. That UX/ownership limitation must remain
visible, and is not closure of R3. Terminal Herdr records bypass the CLI shortcut and reach G when a
new launch would otherwise be attempted. Reusing some already-safe candidate creates no neighbor.

| Fit-1 guard gap | R9 disposition |
| --- | --- |
| Persisted killed, pane now alive | Closed by selection irrespective of status (§5.3.3) and R6 (`not-reused`). T-7.1/7.7b/7.4b and the changed killed/alive oracle cover it. |
| Persisted working, enriched activity exited, runtime still alive | G still selects the raw record; activity cannot authorize a new runtime. Direct isolated start blocks by R8; project-mode reuse can satisfy R1–R8 if the runtime is alive. This closes duplicate admission without promising that an exited agent resumes. T-7.3 should explicitly distinguish this positive-runtime case from an exited result caused by runtime false. |
| Done/merged/other terminal record | Closed by G1 ignoring terminal status and R6 refusing reuse (§4.7, §5.3.3). The done CLI oracle must become a core block. |
| Direct isolated core spawnOrchestrator, including after workspace-mode change | Closed: §5.3.1 takes A before every strategy/mode's allocation; G scans numbered and fixed-ID records. R8 blocks isolated direct-core reuse, T-7.20/21/22. |
| Handleless reservation/in-flight create | New fit-2 launches are born with P + role + claim, so live owner is in-progress and a dead owner leaves create-incomplete. Old handleless/dead-claim records remain L-2 and require the upgrade audit. Live legacy handleless records are selected only when the current project runtime is in the set (§5.3.3); OQ-F10 preserves the CLI fallback. Sparse crashed P recovery still needs m-4. |
| Core probes old handle via newly configured runtime | Closed by §4.6 dispatch plus R5 mismatch refusal. T-7.8/8b/c assert zero foreign-runtime calls, and cleanup is now included. |

L-1 permits mixed-runtime or multiple non-Herdr orchestrators; L-3 permits different worker IDs;
L-4 scopes A to the physical sessions directory. L-2 requires a pre-upgrade audit of old handleless
records, and L-5 requires stopping old AO processes before deployment. Those are meaningful conditions,
not optional explanations for a universal one-orchestrator promise. The new CLAUDE sentence should be
read with these explicit limits.

## Claim end paths and relaunch merge

| End path | Assessment |
| --- | --- |
| Spawn/start success, prepared agent | Keep agent metadata write, then settle identity + own PID/start after confirmation. The old `...CLEARED_LAUNCH_CLAIM` must actually be removed from the earlier write. T-4.18 verifies that data can commit without erasing another pair. |
| Spawn/start success, unprepared Herdr | New reservation claim is kept across setup and settled after the final write. This is what makes T-7.27 protect the post-handle interval. |
| Plain create/pre-create failure | Ordinary rollback may delete the own reservation. A retained or unwritable reservation is not proof that a live operation still runs; warnings/conditional settlement need the same discipline. No Herdr partial goes down this plain-error path. |
| Partial/post-create failure with own record | Publish the available handle, keep all resources through unknown stop, record launchFailed, settle. KeepUnconfirmedLaunch settles for non-Herdr runtimes too when their stop is unconfirmed. |
| Non-owned/unknown record rollback | No Herdr stop, discard, workspace removal, record release or overwrite. Correct conservative retention; warn with all resource identities. |
| Restore success/nonfatal setup failure | Explicit settlement after step 11 fixes the prepared-agent analogy error. Restore calls neither prepareAgentSession nor confirmLaunch. |
| Restore workspace/plain-create failure | Transition rollback before throwing; preserve ownership of claim keys, including null branch (m-1). |
| Restore partial/success publication error | Incomplete; M-1 requires explicit handling. A failed publication is not automatically a replacement. |
| Settlement itself fails | Warn with PID, keep resources and continue according to the table. This is an intentional residual, tested by T-4.16b; it must not hide earlier missing end paths. |

The relaunch diff was read from `3e366a01..7a20242f`. It adds `launchToken`/`launchTokenAt` to spawn
and orchestrator launchedRecord, plus `launchPane` for relaunch; its own claim CAS writes restoredAt
and compares the old claim values. `settleOnce` compares its own PID/start under the record lock,
rolls back launch binding on absent, and retries failures while the process lives. It does not edit
the restore or kill functions. R9's distinction between the random stored launch token and computed
identity token avoids a real naming/meaning collision.

The proposed merge contract covers all shared keys: PID/start, restoredAt, runtimeHandle,
reservationId, launchToken/launchTokenAt/launchPane and the four new retire keys. It also covers
current/read/live/assert claim helpers and CLEARED_LAUNCH_CLAIM; spawn/start's local launchedRecordFor
extraction; the adjacent Runtime/SessionManager/index exports; CLI session and send; and DEVELOPMENT.
MetadataToSession's tmux-only agent pane addition can coexist with raw metadata token computation.
Preserve relaunch's token fields in both successful and partial launch records, and invalidate the
old binding on a real restore as restoredAt changes. The second landing owns adaptation and must
run every relaunch test file listed by the local diff as well as the fit-2 race/settlement set.

A per-project A and launch markers do not complete the same-ID R3 lease. Restore's claim begins
after the old stop, and kill/F-9 take no claim. Relaunch M-6 still needs both operations to claim
before awaited destructive/allocation work and release only their own claim. Relaunch refusing
Herdr and prepared agents keeps the immediate runtime domains separate, but does not remove the
shared spawn/start/settlement hunks at merge time.

## Fit-1 base verification

The local range contains the F1/grammar commit `b72944da`, pin commit `cc0a7a19`, destroy refusal
`f54032da`, docs `e322e338`, and formatting restoration `9d51982b`. Inspected their relevant diffs
and the tip sources without checkout. `git diff --exit-code 389b8dfe HEAD -- packages` is empty:
main's product tree here is still the pre-fit-1 baseline. No claim below attributes fit-1 code to main.

| R9 §2.2 difference | Check against 9d51982b |
| --- | --- |
| 1. No expectedId argument in plugin herdr | Correct: `runtime-herdr/src/index.ts:286` takes invocation/rest args; `cliIdOf` at :178 derives it from the command. The wrapper's cause at :195 carries the exec rejection Q needs. |
| 2. HerdrPinError exists but no guard | Correct: core herdr.ts :158–:171 exports the code/class; index.ts re-exports them; there is no isHerdrPinError. |
| 3. Endpoint resolver reads no compatible | Correct: core herdr.ts :275–:283 checks running/socket and returns bin/socket/running only. |
| 4. Running refusal text | Correct: runtime-herdr/src/index.ts :435–:436 has the quoted plain error. |
| 5. Third CLI interim component | Correct: start.ts :914–:923 defines isHerdrProbeTerminal; removing only the other helpers would leave the terminal rule. |
| 6. Four interim test files | Correct: core orchestrator-herdr-start, runtime fit-startup-interim, CLI start and start-herdr-interim all exist with the old refusal oracles. The additional F4 oracle omission is m-3. |
| 7. Lifecycle comment untouched | Correct: the fit-1 diff omits lifecycle-manager.ts; main :214–:222 still contains the stale error/false explanation. |
| 8. Workspace-create fixture uses session-form text | Correct: fit-reads.test.ts :189–:205 uses noserver_never_workspace_create. Q1's full pinned-socket suffix is narrower; changing only its error class/cause assertions is appropriate. |
| 9. Pane-run failure expects close and plain wrapper | Correct: fit-reads.test.ts :208–:223 queues the close failure too; the oracle must migrate with F4. |
| 10. Invalid root grammar is a plain no-usable-pane error | Correct: runtime index.ts :465–:468. The existing message can remain while its error type becomes partial. |
| 11. Core interim probes selected runtime | Correct: session-manager.ts :2528–:2530 and :2589–:2591 pass plugins.runtime; the classifier reads the handle name only to choose its conservative rule. |
| 12. Killed/alive CLI pass-over | Correct for the specified tip: start.ts :1067 filters it out and start.test.ts :1342–:1353 expects another spawn. The brief's later narrow fit-1 note is not falsely treated as code in 9d51982b. |

The substantive exports relied on by fit-2 exist: strict F1 reader/IDs/no-server predicate, pane grammar,
HerdrEndpoint, HerdrInvocation, resolver, invocation/options helpers, pin class/code and handle-compatible
process readers. Existing core index exports must remain; new errors, guards, token and shared decisions
are additive. The missing compatible field/guard are explicitly allocated additions. The helper inventory
is the exception described in m-3; no other missing fit-1 behavior dependency was found.

## Implementability, file inventory and acceptance

All 17 product paths in section 7 are necessary and sufficient for the specified production scope:
core's new runtime-errors, types, index, herdr, metadata, delivery-lock, session-manager, runtime-stop,
and comment-only lifecycle-manager; runtime-herdr index; CLI send, start, spawn, session, status,
preflight, and comment-only doctor. The proposed error module is absent on both current baselines;
the other files were inspected on main and, where changed, through the fit-1 tip/diffs. CLAUDE and
DEVELOPMENT are additional documentation paths, not part of the 17. No agent-plugin product change
is needed merely to handle P because the existing fallbacks are explicitly retained.

The oracle inventory covers the blocked-as-settled test, index create cleanup/error/no-pane/call-count
cases, fit-reads error-channel cases, prepared-claim success results, core and CLI interim messages,
killed/alive and done controls, kill's new hint, and status text/JSON. It is incomplete for fit-pins
(m-3). Updating all generic SessionManager mocks for the required new method is routine test plumbing;
keep a conservative empty-array default in mocks outside admission-specific tests.

The eight-commit dependency order is otherwise coherent: public contracts/guards/token/lock API first;
F3 second; F4/P/claims third; dispatch fourth; G/reuse fifth; CLI/preflight sixth; F9/status seventh;
contracts/docs eighth. Runtime.preflight is declared before use. Core interim tests move with commit 5,
CLI interim oracles with commit 6, preserving their separate layers. Commit 3 needs the omitted pin-test
migration and the corrected restore end paths; this review cannot certify a green sequence for a patch
that does not exist. The design's per-commit build/typecheck/lint/package tests and final full/red-set/D2
gates are appropriate. Keep the actual fit-1 21-name red set from G0, rather than weakening deferred tests.

| Acceptance tests | Source-based distinguishing failure or deliberate control |
| --- | --- |
| T-3.1–4 | Before fit-2 blocked is settled and prompt errors are untyped; zero prompt/raw-input and admitted/stage assertions expose the change. |
| T-3.5 | Existing idle-to-blocked consumption behavior; a passing control, not an independent regression proof. |
| T-3.6–7 | Generic core retry currently restores after send errors; CLI lacks the refusal text/no-stack path. Test both admitted values and the ordinary-error retry control. |
| T-4.1/1b, 2–7b | Fit-1 throws plain/cleanup errors and lacks the partial record flow. Stateful mutation-before-error, retained worktree/prepared session/script and zero-close assertions make these decisive. Replaced-by-P must also check no prepared-session discard. |
| T-4.8 | Qualified workspace-create Q1/Q2 ordinary-rollback controls; status discovery must succeed first. |
| T-4.8b | New compatible check; fit-1 would proceed to workspace create. |
| T-4.9 | Successful create itself is a control. Fourth pane get, pending publication and settlement are the new oracles. |
| T-4.10/10c | Reachable terminal-handleless restore; baseline lacks transition/partial publication and claim settlement. T-4.10b is existing unknown-stop behavior applied to the newly persisted partial. |
| T-4.11–14 | Much of default kill/cleanup/restore refusal and ordinary send behavior pre-exists. Retained partial state, token/hint, actual send counts and preserved resources are the meaningful new assertions. |
| T-4.15–18 | In-flight P, resident prepared restore, kept post-create settlement and foreign-pair preservation are new. Specify an orchestrator fixture/workspace mode or negative probe for T-4.16's later spawnOrchestrator assertion; a restored worker alone would not block project admission. Publication-failure cases from M-1 are still missing. |
| T-7.1–3c | Isolated/core status-independent G is new. Project-mode negative refusal already exists on fit-1: assert typed M and no origin/hooks changes. Legacy negatives are controls on fit-1, even though red against pre-fit-1 code. For T-7.3 state whether exited came from runtime false or from an agent under an alive runtime. |
| T-7.4/4b | Exact same-error/no-prefix formatting is new; real-core killed-record composition separately exercises G. |
| T-7.5–9, 8b–8e | Failure/incomplete/mismatch/damaged selections and old-handle/missing-plugin dispatch are new. T-7.7 is a deliberate project/isolated-CLI reuse control. |
| T-7.10, 12, 15 | Non-Herdr, no-orchestrator and tmux controls; intentionally pass before fit-2. |
| T-7.11/11b, 13–14 | Selected-instance readiness, compatible false, per-project tmux selection and custom-bin divergence are new. Doctor's ambient preflight tests stay unchanged. |
| T-7.16 | Stop-less Herdr no-server fallback changes from destroyed to unknown; mock control stays destroyed. |
| T-7.20/20b/21/21c | A/P/claim protect the pre-runtime and in-runtime launch. The first-mkdir subject test is needed, with m-2's D2/scheduling correction. |
| T-7.22–26c | Mode-change selection, identity/failure revalidation, busy/unsupported/path refusal and orchestrator-restore exclusion are new. P before workspace restore plus A released distinguishes the restore ordering. |
| T-7.27/28 | Exercise the CLI shortcut after handle publication and during the probe, beyond the older paused-P tests; preserve healthy isolated reuse. |
| T-7.29 | Must verify the concurrent caller gets A while the probe remains pending, not just that both later refuse. Core's shorter test timeout makes the bound practical. |
| T-9.1–7, 9–13 | Option/acceptance/token/retire evidence are new. Existing managed-directory, purge and default-refusal behavior is preserved with stronger option-specific assertions. Cleanup must never receive the override. |
| T-9.8a/b/c | Distinct CAS-before-removal and callback-after-retirement checkpoints are reachable in today's code. They exercise different predicates and must retain no-archive/no-removal assertions for replacements. |

“Every acceptance test fails before fit-2” is not a literal criterion: compatibility controls should
pass. For each new race fix, the D2 reversion must reach its own oracle. No acceptance table here is a
claim that an unimplemented fit-2 test was executed.

The 1,750 product-line estimate adds correctly and L is justified; 3,400 test lines is plausible for
cross-process admission, three launch paths, two agent shapes and failure injections. It is a planning
estimate, not a measured diff. OQ-F12(b) is sensible, but fit-2a still needs operator recovery/release
notes at its own landing because F9/status/G ship only in fit-2b. Interim startup remains limited until
that second landing; do not roll out 2a as though the final G guarantee were already active.

## Independent code-fact spot checks

References marked F1 are the actual `9d51982b` file contents from `git show | nl -ba`; unmarked
references are the main worktree. A main file unchanged by fit-1 has the same lines at both baselines.

| # | Claim | Evidence/result |
| --- | --- | --- |
| 1 | Strict F1 reader, command-specific IDs | F1 core herdr.ts :52 and :91–:112 check numeric exit 1, empty stdout, one stderr line, exact object keys and expected ID. Wrapper failures retain their cause at runtime index.ts :191–:198. Supports Q's reuse of that reader. |
| 2 | Endpoint API lacks compatible | F1 core herdr.ts :151–:155 and :253–:283. Correct premise for the new field/check, distinct from a fixture JSON already containing it. |
| 3 | Pins route subsequent calls | F1 core herdr.ts :295–:316 returns stored binary plus overriding HERDR_SOCKET_PATH; partial pins throw. Core index.ts re-exports these names and types. |
| 4 | Existing create has an unsafe cleanup close | F1 runtime-herdr/src/index.ts :474–:483 writes/runs the script and closes workspace by ID on failure. No terminal-bound close exists. F4 must remove that call. |
| 5 | Herdr stop itself is unknown/no close | F1 runtime index.ts :532–:546 constructs only an outcome/detail/next. Destroy at :516 refuses too. This justifies retention and F9's distinct owner authority. |
| 6 | isAlive false has a narrow meaning, not startup end authority | F1 runtime index.ts :633–:641 gates grammar, reads pinned pane, false for absent or different nonempty terminal. Core classifier changes must keep those negatives unknown for startup. |
| 7 | Claim acquisition and success publication are separate | F1 core session-manager.ts :2074 and :2477 gate claims on prepareAgentSession. Handle writes at :2343/:2894 precede awaited setup/confirmation. R9's broader claim and late settlement are necessary for CLI R1. |
| 8 | Restore has no existing claim clear/outer publication catch | F1 session-manager.ts :4323 checks launcher once; :4580 writes success; :4626–:4644 catches only postLaunchSetup. Supports M-1 and the new settlement requirement. |
| 9 | Reservation is published complete | metadata.ts :907 mkdir, :916–:923 initial fields plus reservation/generation, :948–:955 write/close/link. Adding P/role/claim atomically needs no metadata API change. It does not invent other normal fields. |
| 10 | Identity is five ordered values, excludes claims/status | metadata.ts :331–:343: reservationId, runtimeHandle, tmuxName, createdAt, restoredAt. :347–:351 compares only provided keys. Token determinism and claim-only preservation follow from that limited identity. |
| 11 | Record writer can throw before doing a CAS | metadata.ts :664 enters withRecordLock; :268 and :277 throw on busy/failed lock. A thrown update is not a null comparison failure. |
| 12 | Empty IDs can match and incomplete reservation ownership needs care | F1 session-manager.ts :1678 compares stored.id directly; :1696–:1698 permits a handleless may-owner. R9's conservative incomplete-handle rule preserves that result. |
| 13 | Rollback may keep runtime yet still discard prepared session today | F1 session-manager.ts :1886–:1905 warns for replaced may-owner; :1907–:1922 then independently tests/discards prepared session. R9's set-runtime early return closes that composition. |
| 14 | launchFailed text capped, claim not cleared there today | F1 session-manager.ts :1999 caps at 600; :2003 writes only launchFailed. New settlement must remain separate from diagnostic text. |
| 15 | CLI snapshot shortcut exists | F1 start.ts :1045–:1071 filters/probes candidates and :1100–:1118 reuses or calls core. Existing guard has no fresh post-probe record decision. The new core reuse API addresses a real shortcut. |
| 16 | Cleanup and kill differ from list | Main session-manager.ts :3421 probes plugins.runtime; :3079–:3104 skips a missing kill plugin; :1513–:1517 list falls back. R9 now specifies each site's compatibility separately. |
| 17 | Kill has removal callbacks and managed-root protection | F1 session-manager.ts :674–:684 excludes the project checkout; workspace destroy callback at :3139 onward and purge stillUnheld at :3186 onward recheck before removals; deleteMetadata uses the identity at :3223. These support the revised F9 tests. |
| 18 | Core stop-less no-server special case exists | runtime-stop.ts :221 promotes a resolved destroy plus no-server to destroyed. A set guard is required even though Herdr currently supplies stop. |
| 19 | Lifecycle has the stated authority split | lifecycle-manager.ts :223 has only tmux as authoritative; :559–:562 dispatch by stored handle, :662 requires a runtime positive before an agent negative counts. Its :214–:222 comment is stale, hence the definite comment-only file. |
| 20 | Status raw record and renderer support the planned token | utils/session-from-metadata.ts keeps `metadata: meta`; CLI status.ts :87 reads failure text, :229–:232 renders it and :390 prints SessionInfo JSON. Separate token derivation avoids the diagnostic cap. |
| 21 | Selected preflight can share the registry | CLI create-session-manager.ts :32 caches the registry promise; :59–:61 passes the resolved registry to core. Spawn preflight :67–:85 currently calls ambient checkHerdr, while doctor :187–:192 wrongly promises identical verdicts. |
| 22 | F3 interception points exist | F1 runtime index.ts :565–:583 waits/prompts/retries/raw-falls-back; main core session-manager.ts :4005–:4027 retries through restore on a generic error; CLI send.ts :356 delegates. A typed refusal must pass unchanged through both boundaries. |

## Independent fixture checks

All paths in this table are under `development/artifacts/herdr_095_live_check/`. No fixture was
executed and no new Herdr measurement was performed.

| # | Claim | Saved evidence and limit |
| --- | --- | --- |
| 1 | Newer-protocol pane run is CLI-refused before mutation | r9_cli_forms_log.txt :1–:7: exit 1, empty stdout, cli:request protocol_mismatch, protocol 22 older than 23; exactly one logged connection with method ping. No pane.send_input. The reported 0.9.9 server is a simulated pong, not an installed-server measurement. |
| 2 | Protocol-19 pane run control behaves the same | Same log :8–:14: cli:request/newer-than-19 text, one ping. The embedded escaped newline in the JSON message does not create a second stderr envelope line. |
| 3 | R9 trace scope/count | r9_strace_connects.txt has exactly two connect lines, both AF_UNIX, at the two named scratch socket paths. Supports the stated connection scope for those two client calls. |
| 4 | Nearest-ancestor algorithm fixes the mkdir name change | r9_admission_subject_check.txt :1: r8Before is alias path and r8After real path; r9Before/r9After and lock hashes match; r8SameLock false/r9SameLock true. This is a standard-library path check, not a concurrent product admission test. |
| 5 | ENOTDIR refuses | Same file :2 records r9 refused ENOTDIR; the saved script performs realpath/lstat rather than falling back on any failure. |
| 6 | Dangling symlink refuses | Same file :3 records the existing-but-unresolvable entry refusal. The script walks missing components, finds the dangling ancestor by lstat, and refuses. |
| 7 | Exact pinned no-server suffix | r8_cli_forms_log.txt :60–:71 has the full Q1 socket/run-herdr suffix and zero accepted connections; r5_path_env_socket_and_env_session.cmd confirms socket precedence and that suffix when both environment variables are present. A connect attempt still occurred in each stale-socket case. |
| 8 | Arbitrary F1 can follow mutation submission | r8_cli_forms_log.txt :36–:58 logs ping then workspace.create/pane.send_input before zz_unknown_code, server-sent server_not_running near miss, or pane_not_found. The fake handler models request receipt, not real workspace side effects; T-4.3b must model the latter. |
| 9 | Status JSON compatibility already present in source fixture | closedpane_status_server_json.json :1 contains running:true/compatible:true; r8_status_json_ping_protocol_19.json and _23.json contain running:true/compatible:false. This supports Q0 and corrects the helper fact in m-3. |

The doc-0004 diff at `258d85bf` correctly says fit-1 is implemented on a branch, neither fit round is
on main, and r9 adds the protocol-23 pane-run fact. It does not claim the reviewed design is running.
No fixture establishes product CAS/admission/F9 correctness; those remain implementation-test obligations.
Exact server imitation of Q1/Q2 (R-Q) is explicitly unmeasured. No central Herdr fact was promoted from
an unmeasured live claim to proof in this review.

## Open questions OQ-F4 through OQ-F12

| Question | View |
| --- | --- |
| OQ-F4, changed selected runtime | Agree (a), block. Route observations through the old handle's plugin; require retirement or an explicit config switch back before reuse. This keeps T-7.8's zero-foreign-call oracle meaningful. |
| OQ-F5, send to retained partial | Accept (a) within the documented scope: retention need not quarantine a pane that runs its expected agent. Keep exact T-4.14 sends/refusals. The liveness check and later input remain separate and can reach a changed terminal; the corrected wording is essential. |
| OQ-F6, unsupported lock platform | Agree (a), refuse Herdr launch/restore. Reuse-only without A admits no launch, but is still a sampled reuse decision, not same-ID operation exclusion. |
| OQ-F7, rule-Q trust boundary | Prefer (a) only with explicit owner acceptance of R-Q for the qualified 0.9.5 CLI. Q1 is an exact full text, Q2 a prefix. The fixture-backed request suppression supports these forms, but never proves server error atomicity or text origin. If that trust is declined choose (b), Q0 only. |
| OQ-F8, F9 identity token | Agree (a), required. It guards AO-recorded launch changes between inspection and command; it cannot identify an unrecorded hidden server. Keep the retire CAS and post-retire callback checks as separate safeguards. |
| OQ-F9, canonical admission subject | Agree (a), with R-A and m-2's test correction. It unifies ordinary alias spellings before/after mkdir. Neither lexical-only nor config-only naming gives the same physical-directory boundary. |
| OQ-F10, missing/unparseable CLI handle | Prefer (a) for this narrow no-new-launch objective. The existing unchecked result prevents an extra create, but can claim reuse without useful evidence. Document that limitation and preserve L-2's owner audit; do not count it as safe attachability or R3 ownership. |
| OQ-F11, relaunch landing order | Agree (b), build on fit-1 now; second landing adapts. Keep both suites and the common settlement contract. No fit-2 safety property requires tmux relaunch to land first. |
| OQ-F12, split | Agree (b), separate 1–4 from 5–8, with their own reviews/gates. Publish accurate interim recovery notes and retain the old guard's limitations until 2b lands; F4/dispatch alone do not implement G. |

The decided OQ-F1(b), F2(a), F3(b) were applied, not reopened. Recommendations for the remaining
questions were not treated as owner decisions.

## What is correct and what still needs RH

- Born-with-P/role/claim publication and status-independent G close the specific invisible in-flight,
  isolated and terminal-record admission gaps when the stated upgrade conditions hold.
- A canonical missing-path subject plus publication checks is the right correction to the earlier
  symlink-parent defect; external rename/symlink swaps remain explicitly outside that proof.
- Shared core reuse with token-bound probes outside A closes the principal CLI shortcut races without
  losing healthy isolated CLI reuse.
- Q distinguishes pre-request refusal from unknown mutation outcomes. Every other Herdr failure keeps
  resources; pane-run Q still keeps the workspace that already exists. No generic error code is deletion
  evidence, and the script remains after uncertain admission.
- Old-handle dispatch now includes cleanup and preserves per-site non-Herdr behavior. F9 is an owner
  attestation with a token and removal callbacks, not stronger automatic runtime evidence.
- F3 preserves uncertainty about earlier attempts, prohibits raw input after observed refusal, and
  keeps idle-to-blocked consumption as a successful-delivery control.

Fit-2's conservative admission and owner-attested F9 can ship without RH once these findings are
resolved. A confirmed Herdr stop, automatic cleanup/second restore of an old Herdr launch, proof that
S ended (RH-A), and binding pane-run/send input to S's listener/terminal (RH B-2) still need RH. The
post-run pane get is only a sample. No fit-2 item supplies those deferred proofs; §5.2.3's confirmed-stop
continuation is explicitly for a later RH-B. Same-ID R3, relaunch M-6 and duplicate-from-done W4 also
remain open.

## Cleanup and verification

Final `ls -la --time-style=full-iso ~/.ao/bin` matches the initial listing exactly:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

No review command wrote that directory. This evidence compares the complete listing, sizes,
permissions and nanosecond mtimes, not an unperformed initial/final content-hash comparison.

Ran the required scan:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr9-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path is listed here:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2234
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-80
```

These paths changed during an active fleet. No review command wrote real AO state or called AO;
the scan does not identify the writer. No printed session's contents, another review/worktree or
any pane was inspected to infer attribution. The unchanged-state assertion is limited to this
review's writes, not a claim that an active real state root remained frozen.

No Node, pnpm, runtime, model, server or background process was started. Every source-reading shell
call completed; there is no review-owned long-lived process to terminate. No process was signaled,
and the protected lifecycle workers, sessions and tmux servers were not touched. `/tmp/aofr9` was
never created; its final existence check printed `NO_REVIEW_SCRATCH_DIRECTORY`. The required marker
is removed after this scan; temporary report assembly files are removed/moved into the report.

`git diff --exit-code` passes with no tracked modifications, and HEAD remains `5f38ffd4`.
`git status --short` lists only `.agent_task.md` (externally supplied, unchanged), `.agent_report.md`
(required status exception), and this review. No code/docs/config/other-review changes, branch/ref
mutation, commit, push, PR, network call, AO/gh/tmux command or inter-session message was made.
No build or product test was run for this review-only task; all acceptance reasoning is explicitly
source/design analysis. The deliverable is the uncommitted review and the completed line-1 report.
