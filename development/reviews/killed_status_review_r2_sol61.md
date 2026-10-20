# Killed-status fix, blind review round 2

Target: `0e3eabc2..e6e23c38`, focused round-3 changes `bdd5efa0..e6e23c38`.
Reviewer: ao-47.

NOT-LAND-SAFE

Findings: **1 blocker (B-1), 1 major (M-1), 3 minor (m-1 through m-3)**. All gates pass; stale async writes and timer reuse across launches remain.

Isolation: marker `/tmp/ao47-kr2-marker`, scratch root `/tmp/ao47-kr2`, fake HOME, env -i for helpers/tests/ao, no real state mutations, private tmux only, rejecting gh stub. No code edits, commits, pushes, or PRs.

## Evidence log

- HEAD is e6e23c389b1f35fa1ef6a6befe13ddadefda88f9. The author range contains seven round-3 commits and eleven commits over current main.
- `git diff b8a43f5f bdd5efa0 -- packages docs CLAUDE.md` produced no output: the rebased prior fix has the same reviewed content.
- Read the new reviewer brief and author brief; policy is authoritative negatives after two polls; ambiguous all-negative/no-server observations bounded at five minutes; every Node record writer locked and versioned; bash writers deliberately outside that protocol.

### Source observations before author-report reading

- Record locking serializes Node read/compare/rename critical sections, but target claimPR calls updateMetadataIf with an empty expectation (`session-manager.ts:3170-3175`). Its original generation is not checked after asynchronous checkout. Restore's final update at :3522 is still unconditional and can create a missing record. These need own API-level races, beyond metadata-function serialization tests.
- The new authority distinction is based on plugin names, with claude-code authoritative only on tmux. Herdr/other agents are ambiguous. An all-negative authoritative poll is no longer held; no-server skips agent probing and has its own five-minute streak.
- Generation-aware lifecycle status/repair writes compare snapshot versions; old/bare helper writes do not advance generation. Generic updateMetadata still explicitly creates missing records; callers must supply stale-operation protection themselves.
- isSameLaunch compares actual tmux creation time with stored milliseconds, allowing a session up to 15 s older or 1 s newer. This is a timestamp heuristic, not an incarnation ID; close-in-time replacement remains possible by design.

### API-level races independently reproduced

At 20:06:40.879Z, actual sm.claimPR read the old record, then its stand-in SCM checkout callback archived it and reserved the same ID afresh. claimPR returned success and changed the new empty reservation to `{pr:.../pull/2,status:pr_open,branch:feat/two,generation:2}`. A second run published a full newer launch during checkout; claimPR replaced its branch/status with the old operation's PR while retaining the new runtime handle. The empty expectation at session-manager.ts:3173 lets both through.

At 20:06:40.884Z, actual sm.restore read a killed record, then its runtime.create callback archived the record before returning. Restore recreated a partial spawning record through unconditional updateMetadata at :3522. Archive-plus-new-reservation was overwritten the same way. These reproduce a remaining stale-operation problem despite the new lock: the individual writes serialize, but callers that cross async boundaries do not consistently compare the generation they decided from.

The initial literal round-1 child pattern (`node --input-type=module -e ...`) additionally hit a helper-thread startup error (10 s timeout), so those three initial child runs are **not** evidence for successful lock serialization. I changed only the scratch harness to use a child .mjs file and am re-running the real two-process critical-section race. This separates helper compatibility from lock correctness; repository source is untouched.

## New findings (round-2 numbering)

### B-1 blocker — async session operations still write into a later generation or reservation

`packages/core/src/session-manager.ts:3170-3175` (target claimPR, empty expected map), `:3522-3526` (restore's unconditional update), and `packages/core/src/metadata.ts:461-470` (generic update creates absent files). All writers in these reproductions use the new Node metadata functions and their kernel lock; no bash or old-version writer is involved.

1. Start actual sm.claimPR on an existing record. In its stand-in SCM checkout callback, archive the record and reserve its ID again. claimPR returns success and fills the new empty reservation with the old PR/status/branch. At 20:07:39.096Z, final record was `{pr:.../pull/2,status:pr_open,branch:feat/two,generation:14}` — no worktree or handle, because it was a different empty reservation.
2. Publish a full new launch during checkout instead. At 20:07:39.099Z claimPR changed that newer launch's status from spawning to pr_open and branch from feat/new-launch to feat/two, attaching PR #2 while retaining the newer launch's handle.
3. Start actual sm.restore on a killed record. In its stand-in runtime.create callback, archive it (optionally reserve the ID anew). Restore returns spawning and recreates/overwrites the record via updateMetadata. At 20:07:39.102Z the archived-only case ended with a partial spawning record (runtimeHandle/new, restoredAt, generation=19); at 20:07:39.105Z the fresh reservation was similarly overwritten (generation=21).

The lock fixes the interval **inside** a metadata operation, but the operations above decided from an earlier generation before an async boundary. They do not compare it when committing. The docs promise PR claims write only into the generation read; the target claim does not. The owner brief 1.2 item 5 also requires a changed/gone record not be recreated or a new reservation/new launch overwritten. B-2 from round 1 is therefore only partly fixed at the API level, even though its original narrow critical-section race is fixed. Reproducer callbacks and full results will be quoted below; repository code was not altered.

### Critical-section control: the original two-process race is fixed

Re-running with child .mjs files (so the lock helper can start): at 20:07:37.899Z restore child PID 159062 could not finish inside the parent's held interval; after release it exited 0 and left spawning/new/generation=9 intact. Archive+reservation child PID 159112 likewise exited 0 and left `{}`; claim child PID 159153 left pr_open/#2/generation=14. The parent's write and child's later write serialize in that order. These controls distinguish the real B-1 call-site problem from a failure of the record lock itself.

### M-1 major — confirmation and five-minute state can belong to a different launch

`packages/core/src/lifecycle-manager.ts:242-245,1507-1525`: negativeStreaks is keyed only by session ID and records no handle/launch identity. A replacement published between polls inherits the predecessor's no-server firstAt and poll count. The final compare uses the replacement's current generation, so it does not reject this stale in-memory decision.

Own fake-clock run, actual session/lifecycle/metadata managers, only runtime/agent probes substituted:
```
T+0:      old-handle, working, generation=1; first no-server answer
T+240s:   old-handle still working; another no-server answer
T+270s:   archive, reserve kr-1 again, publish replacement-handle,
           createdAt=T+270s, spawning, generation=2
T+300s:   FIRST no-server answer for the replacement -> killed/runtime, generation=3
```
The replacement is only 30 s old and has had one negative observation. It receives neither its five-minute unknown allowance nor two observations of its own launch. This is not the accepted 'worker restart resets the bound' limit; the worker never restarted and it carried state across a changed handle. Reset streak/tracked launch-specific state when the persisted launch changes, without resetting merely for reaction bookkeeping generations. This also matters for first-negative confirmation across reused IDs.

### m-1 minor — the promised identity tolerance is not protected by the tests

`packages/core/src/lifecycle-manager.ts:302-303`, `packages/core/src/__tests__/killed-status-convergence.test.ts:514-570`. Independently widen both identity tolerances to 60 seconds in a git-archive copy. All **27/27 convergence tests pass**. The identity-negative fixture differs by roughly an hour, so it cannot distinguish 1/15 seconds from 60 seconds. This is the requested mutant, not a hypothetical test critique. The shipped implementation passes my own exact boundary probes: lag -1001 ms stays killed, -1000/-999 ms recovers, +14999/+15000 ms recovers, +15001 ms stays killed. Add those near-boundary controls to make the stated policy reviewable in CI.

### m-2 minor — ESM eval callers cannot start the CommonJS lock helper

`packages/core/src/metadata.ts:168`: new Worker receives an eval string containing require but inherits the parent's execArgv. From `node --input-type=module -e ...`, the helper evaluates as ESM and errors: `require is not defined in ES module scope, you can use import instead`. A metadata write waits **10007 ms** then rejects with `no answer from the lock helper thread`; an instrumented error listener confirms the worker exception. This is the reason the literal round-1 child pattern failed before my scratch harness switched to .mjs files. Ordinary file-based CLI processes work, so this is a bounded API compatibility failure, not evidence that a writer ran unlocked. Give the helper an explicit compatible execution context, or filter inherited input-type flags, and test the exported metadata API under the supported invocation forms.

### m-3 minor — reservation/archive writers are exceptions to the generation contract

`packages/core/src/metadata.ts:619` (archive serialization) and `:689` (initial reservation serialization), plus docs/DEVELOPMENT.md:446. The public invariant says every locked write increments generation, callers cannot set it, and reservations have none. updateLatestArchive instead preserves the old generation; reserveSessionId serializes a caller-supplied generation unchanged. Own actual API reproduction:
```
writeMetadata(dir, 'kr-1', {worktree:'', branch:'', status:'working'}); // generation 1
deleteMetadata(dir, 'kr-1', true);
updateArchivedMetadata(dir, 'kr-1', {summary:'archive bookkeeping'});
readArchivedMetadataRaw(dir, 'kr-1').generation; // still 1
reserveSessionId(dir, 'kr-1', {generation:'99', launchPid:'fixture'});
readMetadataRaw(dir, 'kr-1').generation; // 99, not absent
```
Normal internal launch claims do not supply this key, and normal active updates ignore a caller's generation, so this is lower risk than B-1. Sanitize the reserved key and make the archived-write exception explicit or implement a consistent archived version policy. The current counter tests cover only active updates plus ordinary archive/reservation continuation.

## Round-1 findings and related cases, re-checked

| Earlier item | New state | Independent evidence / qualification |
| --- | --- | --- |
| B-1: all-negative poll prevents deaths forever | **Fixed for authoritative tmux / claude-code-on-tmux negatives** | Both ended workers become killed/runtime on poll 2, with and without a recorded live orchestrator. C2 does not suppress gone, including mixed gone/ambiguous outcomes. |
| B-2: interprocess compare/rename gap | **Fixed within metadata operations; partly fixed overall** | Own after-compare child races serialize correctly. New B-1 shows stale async callers still overwrite or recreate later records; generic writeMetadata/updateMetadata deliberately remain unconditional. |
| M-1: no server never becomes killed | **Fixed for one unchanged launch under the owner policy** | Actual shipped 300000 ms bound: both records working at +299509 ms, killed/runtime at +301561 ms. No shortened bound/build was used. New M-1 covers a changed launch inheriting that timer. |
| M-2: old closed PR kills a newly claimed open PR | **Fixed for the original lifecycle race** | Actual sm.claimPR during old getPRState leaves #2 pr_open and no killedReason; lifecycle's generation/pr comparison rejects the stale kill. Target claimPR itself lacks a generation compare across checkout (new B-1). |
| M-3: fresh worker skips dead-at-start records | **Fixed for non-terminal persisted statuses** | Fresh lifecycle manager over missing panes processes them and kills on poll 2. |
| m-1: no current target | **Fixed** | Local private empty server now makes runtime.isAlive return false; both plugin regexes cover the text and their tests pass. |
| m-2: dormant recovery treats unknown as cleanup | **Fixed** | Actual validator returned partial/skip with Liveness unknown for rejected probes. The dead control still gives cleanup in its tests. |
| C3 identity, new session under old name | **Improved / fixed outside the stated tolerance** | Real old name reused after >2 s: old record stays killed across six polls. Same actual launch, no killedReason/PR, recovers on its first fresh poll. Close replacements within the -1 s/+15 s window remain indistinguishable by this timestamp heuristic. |
| Keeper-only integration test | **Fixed coverage** | Keeper test remains; new isolated last-session describe asserts ERR_RUNTIME_NO_SERVER and drives the shipped bound with a fake Date clock. Independent live kill-server test used real five minutes. |
| Invalid restoredAt, future createdAt | **Fixed as specified** | Invalid restore time falls back to createdAt; future selected launch time gives no grace. New tests cover both. |
| Rejected evaluation bridges non-adjacent negatives | **Fixed in pollAll** | Promise.allSettled rejection clears that session's streak; the new test and M-3 mutant exercise it. Single check() rejects to its caller; its special direct-call path does not have the pollAll rejection cleanup. |
| Alternating positive/negative/unknown answers | **Still non-converging by design** | Positive/unknown ends a run. It never establishes continuous death. This is consistent with the owner's consecutive-answer policy. |
| Worker restarting frequently | **Not fixed, explicitly accepted in-memory policy** | Two-poll confirmation and both five-minute timers restart with the worker. A fully missing pane is now eligible on every fresh worker, but still needs two polls. |
| No stored handle; absent agent plugin; indefinite non-no-server probe errors | **Still no guaranteed terminal transition** | Stored-handle guard and unknown semantics remain. Correct metadata/plugin availability or a conclusive probe is needed. An arbitrary permission/timeout failure is not upgraded to death after five minutes; that bound is specifically no-server/ambiguous, not failed. |
| Repeated CAS/lock failure | **Still no convergence guarantee while it repeats** | Status writer records failure, drops tracked/streak state, retries on a future poll. Once contention/writes stop, a stable record can progress. |

## Record lock audit

The mechanism has one helper Worker per importing thread/process, not one helper per record. The abstract socket name includes UID, kind=record, and the canonical directory plus session ID. Missing-directory writers create it before taking the lock. Reads remain lock-free and see whole rename versions. A thread's heldRecordLocks depth map makes same-record re-entry safe; nested different records use separate socket names. Opposite-order multi-record acquisition in different processes can time out; ordinary writers do not hold cross-record locks across probes or network calls.

Request numbers are encoded in the Int32 slot as seq*8+status. The sequence range fits the signed slot, wraps only after 268435455 requests, and an old helper response can publish only through compareExchange against its own pending sequence. When the caller abandons a request, a late successful bind closes itself instead of entering held. A later request does not mistake its answer for the old one. The release message follows the hold answer on the same channel; the helper sets its held map synchronously before it can handle that release.

Own forced-late-helper experiment delayed only the scratch harness's Worker startup for 11 seconds (source unchanged):
```
20:10:08.275Z first request failed closed after 10003 ms; no writer callback ran
20:10:09.340Z next request succeeded after 1063 ms, generation=1
20:10:09.396Z abandoned name held=false; abandoned record=null
20:10:09.422Z same-record re-entry and nested second-record writes succeeded;
              outer generation=2, inner generation=1, both sockets released
```
The ordinary busy-lock bound is five seconds; the ten-second first-answer ceiling includes LOCK_HELPER_START_MS. Holding child PID **197174** exercised the actual kernel lock:
```
20:10:09.541Z holder bound; isDeliveryLockHeld=true
20:10:14.542Z waiting write refused after 5001 ms, original record unchanged
20:10:14.551Z exact child PID killed with SIGKILL, exited by that signal
20:10:14.552Z name free immediately; next write succeeds, no lock file
```
A short file-based Node process performed its first write in 65.1 ms and exited in 142 ms wall time. Actual ao start processes exited in 322 ms and 363 ms, with their intentionally detached lifecycle workers handled separately. The helper is unref'ed and does not keep a CLI process alive. The new ESM-eval exception is m-2 above.

On non-Linux, isDeliveryLockSupported is false and withRecordLock invokes fn directly. That is clearly documented in metadata.ts and docs/DEVELOPMENT.md; the mocked-platform test verifies a write proceeds despite another held socket. I did not run another operating system. delivery-lock.ts's only functional change is allowing a new name kind in the hash input type. Ledger/attempt name strings and the I-5 acquire/release behavior are unchanged; the full suite, including delivery-lock tests, passed.

### Lock-timeout call sites and what a user sees

| Caller | Result if lock acquisition fails |
| --- | --- |
| reserveNextSessionIdentity / reserveNextOrchestratorIdentity; project orchestrator reservation | Throws before a successful reservation. Spawn/start reports an error; no metadata write from the failed call. |
| Spawn's launched-record write (:1686/:1688), postLaunch metadata, final prompt-delivery metadata | The launched-record/postLaunch try cleans up runtime and managed workspace on failure; cleanup's delete can itself time out and is best-effort. The later promptDelivered write can reject after a pane/prompt already exists. A CLI error does not universally mean no pane was created. |
| spawnOrchestrator (:2173/:2175/:2197) | Same metadata error propagation/cleanup pattern. ao start already started its detached lifecycle worker; an orchestrator write failure need not undo that worker. |
| Restore archive copy-back (:3430), final spawning write (:3522), postLaunch delta (:3551) | Copy-back error aborts before later steps. Final update can throw **after** old runtime destruction/new runtime creation, leaving old metadata while the pane exists. PostLaunch delta is caught as non-fatal. No transaction spans the async restore; new B-1 is its separate stale-write defect. |
| kill archive (:2386) / cleanup calling kill | Runtime/worktree destruction happens before the final locked archive. A timeout can leave an unarchived record after those actions. kill rejects; cleanup captures per-session errors. |
| claimPR target (:3170) / takeover records (:3188) | Worktree checkout already happened. A thrown timeout rejects the claim; earlier side effects/takeover writes are not rolled back. A missing target explicitly errors. A **newly reserved target** currently succeeds incorrectly (B-1). |
| repair-on-read (:625) reached from list/get/status/attach/send | Lock acquisition can now throw during a nominal read that needs repair. list/get can reject and CLI status/list/attach/send can report an error; a whole lifecycle poll can record failure before evaluations. A failed comparison, in contrast, uses only the in-memory repaired view. |
| lifecycle persistStatus (:1446) | Catches the error, records 'record not written', clears tracked/streak state and sends no transition/reaction. Future poll retries. |
| lifecycle PR discovery (:702), title pinning, dispatch bookkeeping (:968) | Existing discovery/pinning catches or Promise.allSettled absorb most errors. A generation mismatch skips the write. A sent reaction whose hash/attempt bookkeeping was skipped can be sent again. |
| remap and archived cleanup marks; dormant recovery/actions | Still use generic locked metadata helpers. Errors propagate to CLI/remap or are reported/caught by their existing cleanup/recovery wrappers. No OpenCode call was made to test these; this row is a source audit. |

The new lock deliberately holds only the sync read/compare/temp-write/rename. It cannot make an earlier async workflow atomic; those workflows need explicit snapshot/generation checks, which is the B-1 gap.

## Generation and mixed-version rollout

The active-record commit path increments from the existing positive safe integer, or from the latest archive if the active record has none. updateMetadata and updateMetadataIf overwrite a supplied generation with that computed value; full writeMetadata does not accept it through SessionMetadata. Reservations normally contain no generation. Deletion archives the current counter; a later reservation/full write continues it. The new tests exercise that normal cycle and reject stale generations. However, 'every locked write increments' is not literally true for archive bookkeeping: updateLatestArchive serializes the archived copy without incrementing generation. Nor does reserveSessionId sanitize an explicitly supplied generation in its arbitrary initial map. My API probes observed archive generation remaining 1 after a bookkeeping update, and reserveSessionId(...,{generation:'99',launchPid:'fixture'}) publishing generation=99. Current internal launch-claim builders do not supply that key; these are invariant/documentation exceptions to account for when extending the API.

Readers: raw metadata and Session.metadata preserve the extra key. readMetadata's typed projection omits it, but writeMetadata obtains the current/archive counter under the lock rather than trusting the projection. CLI status/list use known session fields and do not display the key. Restore preserves its ordinary identity fields but its returned in-memory metadata need not be refreshed to the final counter; subsequent fresh reads see the correct counter. Bash helper/hook sed edits preserve unknown generation text, do not increment it, and do not acquire the socket lock. WRAPPER_VERSION and helper source are unchanged in the diff.

Mixed versions cannot provide the new protocol's full guarantee:

- An old worker's merge updater reads and serializes arbitrary existing keys, so it generally preserves a generation written by a new CLI but does **not increment it** or acquire the new lock. Its old conditional status writer still lacks the PR/generation protection. Such a worker can race a new locked writer as an outside participant, just like the explicitly accepted bash writers. Rebuilding the CLI alone does not upgrade an already loaded lifecycle process.
- An old full writer can omit generation. A new worker holding an older numbered snapshot then loses its comparison once; a later poll reads the missing generation and can write. My probe returned stale-generation rejected=true, then a fresh bare read successfully wrote a new counter (3 in that fixture). An old merge preserved counter 3 unchanged, also observed. There is no permanent 'missing generation blocks every future compare' state by itself.
- Counter monotonicity across a mixed old full-write rollout is weaker than with only new writers: a removed counter can fall back to an older archived value. Metadata changes without a counter increment cannot all be detected. Neither incompatibility is repaired merely by the new reader recognizing the extra key.

Restart all relevant old writers when relying on the new guarantees. Do not claim a rolling mixture has cross-process CAS safety; this qualification is distinct from B-1, which reproduces with exclusively new code.

## Convergence and plugin authority

| Probe / context | Implemented decision |
| --- | --- |
| tmux isAlive=false, any agent | gone; second observation, regardless of outage. |
| claude-code agent exited on tmux | gone after grace; second observation. |
| codex/gemini/opencode exited on tmux | ambiguous; two polls when C2 is not holding, otherwise bounded from the negative run's firstAt. |
| claude-code on Herdr, or Herdr isAlive=false | ambiguous; the Herdr process-list helper can still turn query failures into an empty list. |
| no-server typed rejection | Agent check skipped; consecutive no-server observations for 300000 ms and at least two polls, then runtime kill. |
| other rejection | failed/unknown; clears the run, no forced death after five minutes. |
| renamed plugin instance | Not in the authority sets, so negatives are ambiguous. An alias whose instance.name remains tmux/claude-code keeps that authority. A non-tmux name also bypasses the tmux timestamp identity check; the current rationale is Herdr's terminal-ID guard, which arbitrary third-party renamed runtimes must not be assumed to implement. |

A five-minute hold is **not universal for every ambiguous result**. C2 still requires two or more counted probe outcomes and none alive. A single ambiguous session, or one accompanied by a positive session, uses C1. My mixed outcome probe demonstrated the cohort edge: poll 1 has gone(A)/ambiguous(B), poll 2 kills A while B is held, and poll 3 excludes A's recoverable killed probe from the outcome population, so B is now alone and becomes killed after only three rapid polls. This is a consequence of retaining C2's population threshold, not an implementation of an unconditional five-minute quarantine for every error-swallowing plugin. The report's broad 'renamed plugin is the safe side (5-minute bound)' needs that qualification. Under the explicit retained C2 rule I treat this as a policy limit, not a new blocker, but it is another route for a live session with a false-on-error process probe to become killed before five minutes.

The shipped bounds use Date.now, remain in memory, and are keyed by session ID. Worker restart, alternating unknown/positive probes, or repeated lock/CAS failure can prevent convergence beyond five minutes plus two polls. Permanent failed probes, missing handles/plugins, and false-positive tmux prefix matches can do so too. These are not upgraded to authoritative absence by a generic elapsed timer. New M-1 additionally shows an earlier launch's run can kill a replacement too early; that should be fixed rather than treated as a permitted long-outage policy.

## getMetrics and the identity check

Search of non-test packages found exactly one production getMetrics caller: lifecycle-manager.ts:320. The CLI has none. runtime-herdr's implementation at :408 remains unchanged; C3 bypasses the tmux timestamp check for that runtime and relies on its terminal-ID liveness behavior. The runtime-tmux README example now obtains actual server uptime instead of a stored-handle estimate, consistent with RuntimeMetrics.uptimeMs. A missing target/server now rejects instead of fabricating uptime, and the production caller catches that as no recovery.

The new exact-name list-sessions lookup avoids the prefix bug for this check. Its whole-second creation timestamp plus stored-after-launch millisecond time explains the positive 15 s allowance and small negative tolerance. It remains a heuristic: a replacement within the accepted interval, wall-clock changes between creation/reporting, or a launch-key send exceeding 15 s can produce false acceptance/refusal. The latter is fail-closed for recovery. Current code passes the exact tolerance boundaries in my controlled-clock checks; m-1 records the CI gap in protecting those constants.

## Ratings of the author's remaining limits

| Limit from section 2 item 6 | Rating and landing judgment |
| --- | --- |
| (a) Socket hidden >5 min, then duplicate restore | **Major operational risk; accepted policy follow-up for this landing.** Worse for a working record than round 2: round 2 kept it non-terminal, so core restore refused; now five minutes legitimately marks it killed and a later send can start a second agent at the missing socket path while the hidden server continues. Round 2 already duplicated a stale killed record during a short hidden socket. The owner explicitly chose the five-minute tradeoff, so this alone does not block this round. I independently exercised shipped no-server for five minutes, short hidden-socket preservation, and audited the unchanged send/restore route; I did not repeat the author's full >5-minute hidden-socket duplication trace in this round. |
| (b) Plain tmux -t prefix match | **Major destructive pre-existing bug; separate focused fix.** Independently reproduced below. Not introduced by round 3: prior reviewed runtime/agent calls already use plain targets. getMetrics now matches exactly, improving C3, while normal liveness, send, capture, attach and destroy remain unsafe. The new authoritative rule does not make a successful wrong-prefix probe authoritative evidence of death; it is a false positive for life. It still needs prompt correction, but is not the reason for this verdict under the explicit review scope. |
| (c) In-memory streaks restart | **Major availability limitation, explicitly accepted policy.** A worker restarting before confirmation/bounds can preserve dead records indefinitely. Unlike M-3, it is not fixed by including the record in the poll. Persisted evidence or a monotonic external clock would need a separate policy change. |
| (d) Skipped reaction bookkeeping can repeat a send | **Minor to major depending on reaction, accepted safety tradeoff.** Source confirms the send may have succeeded before conditional bookkeeping loses its generation compare. This favors preserving a newer record over writing a stale hash, but delivery/reaction idempotency remains necessary. Existing dispatch hashes help only when their write succeeds. |
| (e) Bash writers outside the lock | **Major remaining race, explicitly owner-approved.** Either side can overwrite the other's rename. pr/status comparisons catch a helper write only when it precedes the locked read, and do not make the helper a lock participant. This approved exception does not excuse new B-1's races between cooperating Node writers. |

### Every plain target family in the requested modules

Local private tmux 3.4, with only ao47r2-kr-10 running: runtime.isAlive for ao47r2-kr-1 returned **true**, and claude-code isProcessRunning for that nonexistent kr-1 returned **true** using kr-10's TTY. getMetrics for kr-1 rejected with 'session ... not found' (exact-name protection). runtime.destroy on the short kr-1 target then ended kr-10; its private server exited. Only review-owned stand-ins were involved.

- runtime-tmux/src/index.ts:140/142/144 send launch keys; :148 cleanup on failed launch; :170 destroy/kill-session; :178 clear input; :188 paste-buffer; :206/:212 type/submit; :217 capture-pane; :225 has-session; :260 generated attach command. Every target is plain. Misrouting can send launch/message text or control keys to another agent, capture another pane, report a dead ID as alive, attach to the wrong session, or kill the wrong agent.
- agent-claude-code/src/index.ts:589 list-panes uses the plain handle ID. It can assign another session's TTY/process to the queried record and make both isProcessRunning and activity appear live.
- CLI lib/shell.ts:57 display-message session_activity; commands/session.ts:191 attach; commands/send.ts:108 clear, :116 paste, :125 type, :129 submit, :261 has-session, :272 capture, :344/:349 retry Enter. These inherit misdelivery, false readiness/activity, wrong attachment, and accidental submission in a different pane. Core session-manager's foreground-command display-message is a related plain-target caller outside the specifically requested plugin/CLI list.

Use exact targets consistently, accounting for session versus window/pane target syntax, in a dedicated correction. Changing only isAlive would leave destructive send/destroy paths exposed. I confirmed the plain targets already exist at bdd5efa0; they are not new in the reviewed round-3 diff.

## Tests, mutant results, and gate evidence

Changed existing tests do not weaken their core assertions:

- lifecycle-manager.test.ts setupCheck now reads the real seeded raw record, including generation, instead of reconstructing a generation-less metadata map. Its behavior assertions remain.
- metadata.test.ts expects generation=1 on create and counts the extra line in the newline-injection test. Existing key/value injection checks remain intact.
- spawn.test.ts adds the expected generation to an orphan launch-claim fixture after the write storing a reused agent ID. No old field assertion was dropped.
- runtime-tmux getMetrics tests replace handle-age expectations with actual server-age, exact-name, missing-target, and typed-error expectations. This is the intended API meaning change; the only production consumer is C3 and handles rejection.
- The integration keeper test now explicitly states its scenario; the new isolated last-session test restores environment and drives the no-server rule. Its own child state/tmux directory prevents a surviving keeper from hiding server exit.

record-lock.test.ts genuinely starts child processes, waits on marker files, and pauses after the parent's comparison before rename. Its takes cases detect a child that completes inside the critical section, then verify the second writer survives. Its holds cases test stale snapshots after the child has already changed a record; restore also asserts an actual wait. Those are meaningful metadata-operation tests. They do **not** exercise full sm.claimPR/restore workflows crossing async operations, which is why B-1 survives the suite. The new claim-pr removal test covers an archived target with no replacement, not an archive followed by a fresh reservation.

killed-status-convergence.test.ts tests the main stated outcomes, including real sm.claimPR during an old PR query and a no-generation bash-style PR change. The fake clock changes Date only; polling and locks use real scheduling. Two gaps matter:

- m-1: no near-boundary identity test detects the 60 s tolerance mutant.
- The 'answers alternate dead and alive' test toggles runtime.isAlive **per call**. A normal check calls it in get() enrichment and again in evaluation, so this fixture can repeatedly give false to enrichment and true to evaluation rather than alternate evaluated poll outcomes. Other positive-reset tests are meaningful, but this named test alone does not prove non-adjacent negative evaluations reset.

### Own mutants in a git-archive of e6e23c38

Each mutation was applied independently to source in `/tmp/ao47-kr2/mutant`, tested with the local vitest binary, and reset before the next. No tracked source was edited and no package build ran in another repository. Eight mutants were caught; the requested tolerance mutant survived.

| Mutation | Tests that failed; summary |
| --- | --- |
| Hold gone like ambiguous | Mixed gone/ambiguous test: gone must reach killed on second poll while ambiguous is held. **1 failed, 26 passed (27)**. |
| No-server bound infinite | Four-minute/five-minute fleet case; single-session bound; bound restarts after a positive. **3 failed, 24 passed (27)**. |
| Remove M-3 filter | All-dead and live-orchestrator cases; Herdr false bound; mixed gone/ambiguous; both fresh-worker cases; failed-evaluation streak reset. **7 failed, 20 passed (27)**. |
| Lock always unlocked | Restore takes/holds; archive+reservation takes; claim takes; kernel-release test; busy-holder refusal test. **6 failed, 7 passed (13)**. |
| Generation not incremented | Remap during probe; counter increments/caller cannot set; archive continuation; stale/gone conditional write. **4 failed, 36 passed (40)** across lock/convergence. |
| pr removed from status compare | Bash-style changed PR without a new generation. **1 failed, 26 passed (27)**. The real Node claim race remains protected by generation, so the helper control is essential. |
| Recreate gone record | Direct conditional update against a missing record. **1 failed, 39 passed (40)** across lock/convergence. Lifecycle tests already compare a generation, so many still reject the stale write independently. |
| isSameLaunch always true | New session under old name; no handle createdAt; failed metrics report. **3 failed, 24 passed (27)**. |
| Both identity allowances widened to 60 s | **0 failed, 27 passed (27)** — survived, m-1. |

### Gates, independently rerun on this worktree/build

Commands ran under env -i, fake HOME, scratch PATH with gh stub and private tmux shim, and no AO_* for tests. TMPDIR was under the scratch root. A test-only Node preload supplies the same fake HOME when a child spawn's explicit env omits HOME (record-lock.test.ts otherwise passes only PATH); it changes no source, locking, or record decisions. No agent binary was on the test PATH. Live commands used the separate stand-in claude and only scratch AO config/state.

| Command | Result |
| --- | --- |
| pnpm install --frozen-lockfile | Exit 0; frozen lockfile install complete. |
| pnpm build | Exit 0, all package build scripts complete; built before live runs. |
| pnpm --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-agent-claude-code test | Exit 0. Core **1190** (44 files), CLI **261** (20), runtime-tmux **40** (1), claude-code **212** (3): **1703 passed**. |
| pnpm --filter @aoagents/ao-integration-tests test | Exit 0: **Test Files 10 passed, 3 skipped (13); Tests 91 passed, 24 skipped (115)**. tmux was real on the private shim. |
| pnpm lint | Exit 0, **0 errors / 5 warnings**. |
| pnpm typecheck | Exit 0, every script complete. |
| pnpm -r --no-bail test | Exit 0, **2663 passed, 29 skipped (2692 total)**; **91 passed test files, 3 skipped**. |

Full recursive summary lines (ANSI removed):
```
core                  Test Files 44 passed; Tests 1190 passed
agent-gemini          Test Files  1 passed; Tests   62 passed
agent-codex           Test Files  3 passed; Tests  215 passed
notifier-desktop      Test Files  1 passed; Tests   26 passed
agent-claude-code     Test Files  3 passed; Tests  212 passed
runtime-herdr         Test Files  1 passed; Tests   36 passed
scm-github            Test Files  3 passed; Tests  140 passed | 5 skipped (145)
tracker-github        Test Files  1 passed; Tests   42 passed
runtime-tmux          Test Files  1 passed; Tests   40 passed
workspace-worktree    Test Files  1 passed; Tests   50 passed
agent-opencode        Test Files  2 passed; Tests  298 passed
integration-tests     Test Files 10 passed | 3 skipped (13); Tests 91 passed | 24 skipped (115)
cli                   Test Files 20 passed; Tests 261 passed
```

All original gates pass. These gates do not negate the API-level stale writes or cross-launch timer reproduction.

## Live evidence (outside-source record-file timestamps)

All runs used the rebuilt e6e23c38 worktree, real tmux/claude-code plugins, and real metadata/session/lifecycle managers. Worker fixtures write metadata after runtime.create; actual ao start tests additionally exercise its detached worker. No live source constants were changed. Each snapshot reads record files after the poll completes and timestamps from the external harness. The tmux shim also removes inherited AO_* before starting the private server; explicit session environment flags contain only scratch values.

### All workers die with one live recorded orchestrator

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:04:44.302Z | working g2 | working g2 | working g2 | ok |
| 2026-10-20T20:04:45.370Z | killed/runtime g3 | killed/runtime g3 | working g2 | ok |
| 2026-10-20T20:04:46.450Z | killed/runtime g3 | killed/runtime g3 | working g2 | ok |
| 2026-10-20T20:04:47.530Z | killed/runtime g3 | killed/runtime g3 | working g2 | ok |
| 2026-10-20T20:04:48.608Z | killed/runtime g3 | killed/runtime g3 | working g2 | ok |
| 2026-10-20T20:04:49.731Z | killed/runtime g3 | killed/runtime g3 | working g2 | ok |

### All recorded workers die; an unrecorded keeper leaves tmux answering

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:05:00.001Z | working g5 | working g5 | — | ok |
| 2026-10-20T20:05:01.042Z | killed/runtime g6 | killed/runtime g6 | — | ok |
| 2026-10-20T20:05:02.074Z | killed/runtime g6 | killed/runtime g6 | — | ok |
| 2026-10-20T20:05:03.115Z | killed/runtime g6 | killed/runtime g6 | — | ok |
| 2026-10-20T20:05:04.152Z | killed/runtime g6 | killed/runtime g6 | — | ok |
| 2026-10-20T20:05:05.192Z | killed/runtime g6 | killed/runtime g6 | — | ok |

### Fresh worker over already-dead records

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:05:06.230Z | working g7 | working g7 | — | ok |
| 2026-10-20T20:05:07.270Z | killed/runtime g8 | killed/runtime g8 | — | ok |
| 2026-10-20T20:05:08.311Z | killed/runtime g8 | killed/runtime g8 | — | ok |
| 2026-10-20T20:05:09.357Z | killed/runtime g8 | killed/runtime g8 | — | ok |
| 2026-10-20T20:05:10.390Z | killed/runtime g8 | killed/runtime g8 | — | ok |
| 2026-10-20T20:05:11.422Z | killed/runtime g8 | killed/runtime g8 | — | ok |

### Replacement server with same name, after the five-minute terminal decision

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:10:30.571Z | killed/runtime g11 | killed/runtime g11 | — | ok |
| 2026-10-20T20:10:31.612Z | killed/runtime g11 | killed/runtime g11 | — | ok |
| 2026-10-20T20:10:32.652Z | killed/runtime g11 | killed/runtime g11 | — | ok |
| 2026-10-20T20:10:33.695Z | killed/runtime g11 | killed/runtime g11 | — | ok |
| 2026-10-20T20:10:34.737Z | killed/runtime g11 | killed/runtime g11 | — | ok |
| 2026-10-20T20:10:35.781Z | killed/runtime g11 | killed/runtime g11 | — | ok |

### Replacement server before the bound; authoritative missing targets now converge

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:10:53.564Z | working g13 | working g13 | — | ok |
| 2026-10-20T20:10:54.607Z | killed/runtime g14 | killed/runtime g14 | — | ok |
| 2026-10-20T20:10:55.650Z | killed/runtime g14 | killed/runtime g14 | — | ok |
| 2026-10-20T20:10:56.688Z | killed/runtime g14 | killed/runtime g14 | — | ok |
| 2026-10-20T20:10:57.731Z | killed/runtime g14 | killed/runtime g14 | — | ok |
| 2026-10-20T20:10:58.764Z | killed/runtime g14 | killed/runtime g14 | — | ok |

### Different actual launch under old tmux name; original record remains killed

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:11:23.102Z | killed/runtime g19 | working g16 | — | ok |
| 2026-10-20T20:11:24.177Z | killed/runtime g19 | working g16 | — | ok |
| 2026-10-20T20:11:25.253Z | killed/runtime g19 | working g16 | — | ok |
| 2026-10-20T20:11:26.331Z | killed/runtime g19 | working g16 | — | ok |
| 2026-10-20T20:11:27.406Z | killed/runtime g19 | working g16 | — | ok |
| 2026-10-20T20:11:28.512Z | killed/runtime g19 | working g16 | — | ok |

### Literally no third tmux session; server auto-exits, first six polls are below bound

| UTC | kr-1 | kr-2 | Orchestrator | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:10:40.415Z | working g5 | working g2 | — | warn |
| 2026-10-20T20:10:41.459Z | working g5 | working g2 | — | warn |
| 2026-10-20T20:10:42.509Z | working g5 | working g2 | — | warn |
| 2026-10-20T20:10:43.559Z | working g5 | working g2 | — | warn |
| 2026-10-20T20:10:44.611Z | working g5 | working g2 | — | warn |
| 2026-10-20T20:10:45.661Z | working g5 | working g2 | — | warn |

### Shipped five-minute no-server bound, real elapsed time

`2026-10-20T20:05:22.771Z kill private server PID 129622`

| UTC | elapsed ms | kr-1 | kr-2 | Health |
| --- | --- | --- | --- | --- |
| 2026-10-20T20:05:22.821Z | 0 | working | working | warn |
| 2026-10-20T20:09:22.837Z | 240001 | working | working | warn |
| 2026-10-20T20:10:22.341Z | 299509 | working | working | warn |
| 2026-10-20T20:10:24.391Z | 301561 | killed/runtime | killed/runtime | warn |
| 2026-10-20T20:10:28.494Z | 305664 | killed/runtime | killed/runtime | ok |

Records remained working through 299509 ms and became killed/runtime at 301561 ms. This is a real five-minute run with the shipped constant, not a simulated clock or shortened scratch build. Once the records are terminal, later recovery failures are excluded from outage accounting and health becomes ok; that does not mean a server reappeared.

### Short hidden socket and same-launch legacy recovery

```
2026-10-20T20:11:10.200Z socket hidden /tmp/tmux-44402/ao47-kr2-live
2026-10-20T20:11:10.248Z hidden poll1 {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (probes that could not run, no runtime server, or answers that cannot tell an error from an exit; check the tmux server and ps); such answers persist killed only after 5 minutes"}
2026-10-20T20:11:11.297Z hidden poll2 {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (probes that could not run, no runtime server, or answers that cannot tell an error from an exit; check the tmux server and ps); such answers persist killed only after 5 minutes"}
2026-10-20T20:11:12.348Z hidden poll3 {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (probes that could not run, no runtime server, or answers that cannot tell an error from an exit; check the tmux server and ps); such answers persist killed only after 5 minutes"}
2026-10-20T20:11:13.398Z hidden poll4 {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (probes that could not run, no runtime server, or answers that cannot tell an error from an exit; check the tmux server and ps); such answers persist killed only after 5 minutes"}
2026-10-20T20:11:14.447Z hidden poll5 {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (probes that could not run, no runtime server, or answers that cannot tell an error from an exit; check the tmux server and ps); such answers persist killed only after 5 minutes"}
2026-10-20T20:11:15.448Z socket restored
2026-10-20T20:11:15.558Z after-short-hidden {"kr-1":{"status":"working","generation":"16"},"kr-2":{"status":"working","generation":"16"}} {"health":"ok"}
2026-10-20T20:11:15.650Z legacy-same-launch recovery {"kr-1":{"status":"working","generation":"18"},"kr-2":{"status":"working","generation":"16"}} {"health":"ok"}
```

### Actual ao start with delayed stand-in

A 2 ms file watcher ran until 35 s after each command returned, covering the next default-interval lifecycle poll. No killed version was observed.

| Delay | Command wall time | Worker PID | Private server PID | Record changes |
| --- | --- | --- | --- | --- |
| 1 s | 322 ms | 186596 | 186613 | 2026-10-20T20:09:02.601Z working g1; 2026-10-20T20:09:02.716Z working g2 |
| 3 s | 363 ms | 193239 | 193273 | 2026-10-20T20:09:38.095Z working g1; 2026-10-20T20:09:38.259Z working g2 |

Both final records are working, generation=2, no killedReason. Workers were stopped by the exact PIDs above, before their servers.

### Stand-in exits after 70 s

```
2026-10-20T16:09:03,949111321-04:00 pid=186753 delay=0 lifetime=70
2026-10-20T20:09:09.029Z 70s baseline {"kr-1":{"status":"working","generation":"2"},"kr-orchestrator":{"status":"working","generation":"2"}} {"health":"ok"}
2026-10-20T20:10:19.214Z 70s iteration65 {"kr-1":{"status":"working","generation":"2"},"kr-orchestrator":{"status":"working","generation":"2"}} {"health":"ok"}
2026-10-20T20:10:20.287Z 70s iteration66 {"kr-1":{"status":"killed","killedReason":"agent-exited","generation":"3"},"kr-orchestrator":{"status":"working","generation":"2"}} {"health":"ok"}
2026-10-20T20:10:21.367Z 70s iteration67 {"kr-1":{"status":"killed","killedReason":"agent-exited","generation":"3"},"kr-orchestrator":{"status":"working","generation":"2"}} {"health":"ok"}
2026-10-20T20:10:32.234Z 70s iteration77 {"kr-1":{"status":"killed","killedReason":"agent-exited","generation":"3"},"kr-orchestrator":{"status":"working","generation":"2"}} {"health":"ok"}
```

The stand-in starts at 20:09:03.949Z and exits at about 20:10:13.949Z. Persistence occurs at 20:10:20.287Z after the process cache and confirming polls; exactly one lifetime=70 launch was logged, and no restore was requested. Iteration counts start after fixture setup, not at the stand-in exec.

### Local diagnostic and prefix controls

```
tmux 3.4
259999
no current target
no current target
2026-10-20T20:09:03.821Z prefix has-session  isAlive true agentRunning true
2026-10-20T20:09:03.833Z prefix exact getMetrics rejects tmux session ao47r2-kr-1 not found
2026-10-20T20:09:03.859Z destroy short target / exact kr10 still alive? ERR_RUNTIME_NO_SERVER
```

Diagnostic server PID 259999 was review-owned and stopped. The two no-current-target lines are has-session and list-panes on its empty server; runtime.isAlive returned false in the main harness.

## Scope, commit audit, and review disposition

The rebased prior content matches the previous reviewed code exactly: `git diff b8a43f5f bdd5efa0 -- packages docs CLAUDE.md` is empty. Seven focused round-3 commits were inspected: fcea1114, 8aafa06c, 19bf2cd0, 468c70bb, 2517ad85, d490efbf, e6e23c38. Their messages are conventional and explain why; no Co-Authored-By trailer, emoji, or issue number appears. `git branch -r --contains e6e23c38` prints nothing.

The final 19-file net diff is within the author brief's allowed code/test/docs paths. docs/DEVELOPMENT.md is the sole added documentation target. delivery-lock.ts adds only record as a name kind plus its comment; recovery changes only validator and tests. Other agents/runtime-herdr, helper source/WRAPPER_VERSION, config, workflows, I-5 ledger, CLI files, and CLAUDE.md are unchanged by round 3. An intermediate commit introduced a separate record-lock.ts module outside the stated source allowlist; e6e23c38 moves it into metadata.ts and removes it from the final tree. Thus the final net scope complies; the intermediate history did not strictly stay inside that source list. No review commit or tracked source change was made.

What I found correct:

- Authoritative mass deaths and fresh-worker dead-at-start records now converge after two polls; the original all-negative permanent suppression is gone for tmux.
- The shipped no-server bound converges at five minutes in a real run, and a short socket disappearance preserves live records.
- The new record lock serializes the original after-compare race, is kernel-released on process death, survives abandoned requests safely, supports re-entry, and leaves ordinary file-based CLIs able to exit.
- Lifecycle status writes now compare generation and PR identity; the original old-PR/new-claim race is fixed. Unknown recovery probes now skip cleanup.
- Actual tmux metrics match names exactly, and the stated identity tolerance accepts the same launch and refuses a sufficiently later replacement. Last-session integration coverage is restored.
- All requested validation gates pass. Eight mutants fail as intended; one survives and is explicitly identified above.

Required before landing: guard async session-manager commits against the generation/launch they started from (B-1), and keep negative confirmation/bound state attached to a launch incarnation rather than merely its reused ID (M-1). Add actual API races with archive-plus-reservation/new launch, and a timer-reuse regression. The three minor items should be corrected or explicitly scoped; the requested 60 s mutant needs a failing boundary test.

## Final cleanup and real-state evidence

Every live/test/helper process completed. The two actual ao start lifecycle workers, **186596** and **193239**, were verified by their command lines and stopped by their exact PID files before their private servers. All **19** logged stand-in agent PIDs were independently checked: none remained present. Holding child **197174** was stopped by its exact PID in the crash-release test; all other child processes exited or were stopped by their owning test's ChildProcess reference. The delayed/failed worker-thread experiments ran inside these exited helper processes and leave no kernel socket behind.

Final `ps -o pid,args -u "$(id -u)"`, filtered outside the shell for the scratch root, private server names, and this worktree's built CLI path:
```
[]
```
The shell running ps did not contain the filter paths, so its own command was not hidden from the result. No default tmux server was queried, attached, or stopped. Protected workers **271579** and **321413** were never signaled. No pattern-based process kill was used.

The entire explicit scratch root (homes, state, fixture git repository, stand-ins, logs, mutants, temporary test directories and scripts), its marker, and the exact named private socket files were removed after evidence was copied here. Worktree build/dependencies remain as requested. No tracked source was edited and no commit/push/PR/network-gh/ao-report-message occurred.

`ls -la --time-style=full-iso ~/.ao/bin` before **and** after was identical (byte-for-byte diff empty):
```
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```
This is also the start-of-round listing saved before installation; no real wrapper/settings/global link was changed.

Requested final inventory command:
```
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```
Output:
```
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
```
Every entry is attributed: the real agent-orchestrator fleet's existing lifecycle worker **271579** changed **ao-46** from working to stuck at **2026-10-20T20:07:38.179Z**, confirmed by its read-only observability trace. The record mtime is 20:07:38.178Z, and the sessions-directory mtime is the same because the file was atomically replaced. These two entries are that worker's writes, not review writes. Only cat/stat/grep read the real record/trace for attribution; all review Node/ao/helper/test state was isolated under /tmp.

The final report keeps the round-1 report below its new round-2 body, as requested. The previous tracked round-1 review is untouched.
