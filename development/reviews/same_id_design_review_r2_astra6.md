# Same-ID design r2 — re-check by ao-51

Review completed, 2026-10-21, source 628e0fbf. Scope is the revision and closure of round-1 findings. The previous review remains unchanged. No implementation, commit, push, PR, or real-state AO command.

## Verdicts

R2a: NOT-SOUND

R2b: NOT-SOUND

R4: SOUND-WITH-CHANGES

R3a: NOT-SOUND

R3b: NOT-SOUND

There are **5 new blockers, 3 majors and 1 minor**. Numbering below restarts for this review. These are design verdicts, not claims that any proposed implementation has landed. R2a's core outcome/gate subset is a useful, independently landable refusal improvement; its specified Herdr stop does not satisfy the new acknowledged-stop contract. R4 closes prior B-7 at the design level; it needs the stated coverage and the small unknown-output correction below. The other rounds still contain concrete unsafe interleavings.

## Evidence log

- Read the round-2 brief in full. Marker `/tmp/aosdr2-marker` created before investigation. Initial `~/.ao/bin` listing is unchanged from round 1 and saved for final comparison.
- Scratch `/tmp/aosdr2` was absent. All Node/helper/test processes run with `env -i`, fake HOME and scratch PATH; tmux shim routes to `-L aosdr2-test`, direct probes name only `aosdr2-*`. The gh stub accepts only version/auth status. No model executable is on the test PATH.
- Read revised design sections 0–2 first. Review r1's unchanged findings and tmux queue source check retain their prior result; this review will not repeat those experiments unnecessarily.

## Interim measured results

- Installation and build passed under the scratch environment. The four new test files ran in red mode: core 16 failed/9 passed, tmux 7/6, Herdr 3/4, worktree 2/3; total 28 expected defect failures and 22 passing controls. The copied R2 tmux prototype passed all 13 tests. These are not 50 expected failures.
- The copied m6 direct-child experiment confirmed both branches: without inheritance, the contender acquired after parent death while the child ran and lost its replacement file; with fd 3 inheritance, acquisition waited for child exit and the replacement survived. This closes the demonstrated direct-child case, not yet the descendant case.
- The first live run achieved a same-second server restart: both sessions were `$0` at second 1792604624, but server PIDs 3598037 and 3598055 differed; the old handle returned absent/false and the new handle stayed alive. The harness then hit a duplicate name because an interactive shell ignored SIGTERM. Its finally block removed all recorded processes; the rerun uses exact-PID SIGKILL for its own shells. No duplicate-name failure is counted as a product defect.

## Round-1 closure assessment (before reading the author's report)

| Prior finding | State | Independent assessment |
| --- | --- | --- |
| B-1 timestamp collisions | Partly closed | Raw ticks/boot/PID and `$N` distinguish the measured relaunch/restart. Unique names keep the ordinary replacement safe. But 32-bit names can repeat after deletion, and stop does not compare the identity before killing. The live copied prototype killed both a full-name replacement and a same-name session on a rebound server. |
| B-2 create read-back adopts replacement | Partly closed | `new-session -P -F` returns the created session's identity. An interposed replacement with a different suffix receives no old keys. The separate confirm/keys command still acts before the client checks its output, and repeated names/legacy association need an actual guard. |
| B-3 surviving child | Partly closed | Direct-child fd inheritance works. A normal Node child launching a grandchild with default stdio drops the inherited lock fd: after holder death, a contender acquired while the grandchild ran; the grandchild deleted the contender's file. |
| B-4 dispatched OpenCode removal | Partly closed | Store/session lock plus quarantine closes the single-project direct-child sequence if all paths participate. The quarantine and holder records are project-local while the lock is store-wide; cross-project holders/unknown requests remain unprotected. |
| B-5 rebound socket | Partly closed | With only an unrelated session on the rebound server, isAlive rejects and stop returns unknown while the original server runs. A reused full name is still killed on the wrong server. |
| B-6 unacknowledged stop / lifecycle gate | Partly closed | Outcomes and all listed callers correct the fail-open path; N-2 is included. The new tmux and Herdr positive stop outcomes still need safe identity-bound mutation. |
| B-7 strict read chain | Closed at design level | All eleven boundaries address the identified omissions; new failures/controls confirm the added archive-content, validator, worktree, and both Herdr paths. Remaining test coverage is itemized below. |
| M-1 legacy provenance | Partly closed | Default-off assertion and explicit association/retirement are good. Association still requires a safe identity-bound target, atomic publication bound to the original record, all-reader resolution, and an inventory available in R2b. |
| M-2 lock semantics/scope/platform | Partly closed | Explicit live tokens, fixed order, waiter deadlines, no expiry and Linux refusal close the specification gaps. Descendant lifetime is unresolved; shared-root support is inconsistent between §4.3 and OD-13. |
| M-3 lost retained-runtime discovery | Closed at design level, dependency outstanding | Separate write-ahead full-identity inventory and guarded stop are the right fix; its implementation must precede R2b retirement, and durable failure handling needs tests. |
| M-4 mixed builds | Partly closed | Barrier plus epoch is the right direction. The runbook incorrectly says the continuing shell wrappers hold the record lock; source expressly says they do not. Epoch checks also need atomic monotonic publication and worker/call-boundary semantics. |

## N-1, N-2, N-3 assessment (before reading the author's report)

- **N-1 is real, incompletely fixed.** Source `runtime-herdr/src/index.ts:321-333` closes the recorded positional workspace/pane without checking terminal ID. The new test proves that defect. A separate `pane get` followed by positional close has its own replacement gap; the test does not model it.
- **N-2 is real and correctly assigned to R2a.** `session-manager.ts:4256-4262` drops destroy rejection and proceeds to create. The new core test fails because create is called; the healthy control succeeds. Refusing an unconfirmed stop must precede any suffix rollout.
- **N-3's unsupported nested-operator behavior is real; its blanket conclusion is wrong.** On private tmux 3.4, `#{nosuchop:#{@ao_launch},wrong}` took TRUE, while the supported equality mismatch took FALSE. But `if-shell -F 1 'display-message -p "ao-x:#{pid}"'` printed `ao-x:3604276`, and a quoted session format printed `$0`. A refusal branch containing the unsupported comparison kept the session. Quoting fixes the inner-command parse issue; capability checks must select whether mutation is reachable, not try to abort a later outer command. The mock's unconditional rejection of `#{`/`$` in inner text is inaccurate.

Independent live evidence: same-second restart at second 1792604673 (`$0` twice, PIDs 3604129/3604147); stale stop absent and replacement alive. Full-name reuse: isAlive `ERR_RUNTIME_PROBE`, then stop `destroyed`, replacement absent. Rebound: recorded server 3604225 remained sleeping, answering server 3604238; isAlive unknown and stop unknown for a different name, but stop destroyed a same-full-name session on 3604238. All recorded processes from this run ended. Descendant experiment: holder 3604201, direct child 3604208, grandchild 3604215; contender acquired while grandchild ran, replacement did not survive.

## New findings

### B-1 — The identity is recorded, but mutations still target a reusable name

Design §§2.2–2.6, 2.8, 4.7 (lines 89–131, 223–238, 292–303, 503–506); current `packages/plugins/runtime-tmux/src/index.ts:110-180`; copied R2 prototype `src/index.ts:193-296` (also design §13). **R2b blocker.**

The statement at line 108 that a 32-bit suffix collision always produces “duplicate session” holds only while the first name exists on that server. After that launch ends, another launch can draw the same suffix and create successfully. Another server can also accept the name. The proposed stop prints PID then immediately kills by name, without comparing PID, ticks, boot ID or `$N` before mutation. Exit 0 becomes destroyed. Printed evidence checked afterwards cannot undo the kill. Create's confirm-then-send list has the same issue: the client reads the PID only after send has run. Parse-error cleanup, normal send/paste and attach also rely on the name's supposed permanent uniqueness.

**Measured with the copied, otherwise unmodified prototype:** create a handle, end its session, create a new session under the identical full name, call old isAlive then old stop. isAlive rejected (`ERR_RUNTIME_PROBE`), but stop returned destroyed and the replacement disappeared. With the old server still alive behind its unlinked private socket, create another server at that same own socket and give it the recorded full name: old stop again destroyed the other server's session. This deliberately forces the reuse event; it does not claim a random collision occurred during the run. The probability of a collision in a small fleet is low, but the protocol's safety assertion is false, and the stored stronger identity already provides a way to distinguish it. Increasing entropy alone does not guard deliberately reused/associated legacy names.

The positive isAlive path likewise compares only PID and `$N`, ignoring the persisted raw ticks and boot ID. An independently injected stale-process identity (same current PID/$N, old ticks/boot) returned true. This is a deterministic model of the untested PID-reuse/reboot case, not a claim to have reused a host PID. Read-before/read-after PID equality does not logically prove no ABA; validation must bind the action to the verified process incarnation. Parsing raw ticks after the last `)` is correct and removes the old wall-clock bug.

Require a target that is never reassigned within the verified server incarnation and a mutation gate on that same connected server, or a verified per-launch token checked inside tmux before every pane mutation. A legacy association must obey the same rule: it does not rename the old base session. Do not remove rollback protections based on the suffix alone. Keep worktree ownership checks separately; owning a runtime does not prove ownership of its shared worktree path.

### B-2 — Herdr's new pre-check can still close a replacement

Design §2.6 lines 235–239 and R2a line 574; source `packages/plugins/runtime-herdr/src/index.ts:310-333,397-405`; new test `src/__tests__/same-id-defects-r2.test.ts:109-129`. **R2a blocker.**

`pane get w7:p1` can return recorded terminal A; between that response and `workspace close w7` (or `pane close w7:p1`), the workspace can close and its positional IDs be reused for B. The proposed close now kills B and reports destroyed. An AO operation lock keyed by the original session ID cannot serialize Herdr UI changes or another AO ID allocating the recycled workspace. The new test supplies a replacement *before* get and never changes it between calls.

A scratch protocol stand-in ran exactly those steps and printed `herdrObserved:term_A, closedTerminal:term_B, replacementOpen:false, stopOutcome:destroyed`. No Herdr binary ran. This is a protocol counterexample, not a live Herdr measurement; the existence of recycled positional IDs is documented in the current runtime source.

Require a documented immutable-terminal close target or a server-side compare-and-close operation, with workspace incarnation protection when closing the entire workspace. If that capability cannot be established, return unknown/refuse instead of claiming an identity-safe close. Never weaken the new test to treat any positional pre-check as sufficient. Add replacement-at-close, missing/malformed terminal ID, close-error-envelope, and successful own-terminal controls.

### B-3 — Descriptor inheritance covers a child, not its descendants or remote work

Design §4.2 lines 428–440, §4.1 lines 401–405; source `packages/core/src/delivery-lock.ts:45`, `packages/plugins/workspace-worktree/src/index.ts:146,190,388`; author's m6 reproduced in a private copy. **R3a blocker.**

The direct-child result is correct. It does not prove the stated protection of postCreate commands. A normal Node child can spawn a grandchild using default `stdio` and exit; the grandchild receives no fd 3. Ordinary programs may also close nonstandard descriptors. After the AO holder dies, no process holds the lock even though that descendant can still mutate the path. Awaiting the direct child's exit on timeout does not await this descendant.

**Measured:** holder binds an abstract socket, passes its fd as child fd 3; child starts a Node grandchild with `stdio:'ignore'` and exits; holder dies; contender binds the same lock, writes its replacement file; grandchild removes it. Output: `contenderAcquired:true, grandchildStillRuns:true`, then `replacementSurvives:false`. The author m6's direct-child inherit control still passed. No product code was modified.

Conversely a background process that *does* retain the descriptor can keep the lock for hours after a successful hook, so normal later send/kill/restore commands time out after 30 seconds indefinitely. The design acknowledges this case, but “stop a listed PID” is not a proof that all mutating descendants or requests ended. Disabling git fsmonitor removes one source, not arbitrary hooks and helpers.

Specify the permitted child/descendant contract and enforce protection until all relevant work ends. A supervisor plus durable unknown-completion/child tracking is preferable for general hooks; merely changing which process passes the fd is insufficient if descendants can escape it. Restrict unsupported asynchronous hooks explicitly if general supervision is deferred. Add descendant-fd-drop, daemon-fd-retention, direct-child-timeout-with-survivor, and cancellation/retry tests. Never steal a busy lock by elapsed time.

### B-4 — OpenCode's quarantine and durable holders have a smaller scope than its lock

Design §§4.1/4.4 lines 378–381, 459–474; source `packages/core/src/session-manager.ts:971-985` (`hasOtherOpenCodeRecord` only scans the supplied sessions directory), `packages/plugins/agent-opencode/src/index.ts:498-535`. **R3b blocker.**

The lock is keyed by OpenCode store plus S, but quarantine is under the current **project** state directory; holder/claim records also remain project-local. Two projects/configurations can use the same store and S while having disjoint worktree roots, so OD-13's restriction on shared worktree roots does not exclude this case. A removal from A times out after dispatch and leaves quarantine A. Once its API child exits, B takes the same lock, sees no quarantine B, gets S, publishes its claim, and releases. A's in-flight server request then removes S. The lock serialized the clients correctly and still lost continuity/data. Even without a timeout, A's later project-local holder scan can miss B's durable claim.

A scratch two-process protocol simulation (no OpenCode executable/API) used one shared abstract lock and two project directories. B printed `seesLocalQuarantine:false, seesOtherProjectQuarantine:true, reused:true`; after completion of A's already-dispatched request, `claimStillNamesS:true, SExists:false`. Same-project reuse would have refused. This demonstrates the revised protocol's scope mismatch, not an implementation regression.

Put quarantine and the authoritative holder/claim index in the canonical store/session namespace, and make every remover, interrupter and reuse consult it while holding the same lock. Alternatively explicitly enforce one project/configuration as the sole owner of that store/session; a documentation-only assumption is insufficient. Define canonical store identity including environment-dependent API selection, atomic/durable entry publication, malformed/unreadable-entry behavior (unknown), and safe recovery of interrupted requests. A timeout remains unknown even after the local API child exits.

### B-5 — The rollout deliberately leaves unlocked old writers active

Design §5 lines 517–529 and OD-13 line 560; source `packages/core/src/metadata.ts:23-32,331-339`; shell writer `packages/plugins/agent-claude-code/src/index.ts:183-199`. **R3a rollout blocker; relevant to every round's fleet guarantee.**

Step 1 says pane wrappers can continue “under the record lock.” The source explicitly says these helpers write with sed/mv **outside** the lock and without advancing generation. The Claude hook reads the entire record into a temporary file and then renames it over the active record. A hook can read the old runtimeHandle, a new AO operation can publish the restored handle, and the hook can then overwrite it with its stale copy. New operation/path locks and build epochs do not constrain that writer. It can also recreate a record after archival. This is a source-derived interleaving; I did not run any real wrapper.

Include these writes in the admission/drain protocol, or move them to a current-build conditional writer before reopening admission. Agent panes may remain running, but their old record-mutating hooks cannot silently remain outside the supported-writer contract. State which already-loaded hooks/wrappers are affected and how to refresh or suspend just their writes.

The epoch file is a useful second guard, not the barrier itself. Specify a locked/atomic monotonic raise, refuse unreadable/malformed epoch state, recheck at mutation admission after waits, and include resident lifecycle writes/reactions and the newly added retire/stop-retained actions. Otherwise an old worker that checked once at startup can still mutate after an upgrade, or competing read/raise steps can lower the file. Drain ownership of children before terminating their parents; orphaned API/git descendants are not reliably attributable afterwards from PPID alone. Builds before R2a have no epoch guard at all. No real workers were stopped for this review.

### M-1 — N-3 overstates the parser result and bakes it into the test oracle

Design §10.3 lines 725–729, §12.2 lines 795–838, OD-17 line 564; `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts:234-242` (`innerCommands`).

The mock throws on *any* `#{` or `$` inside an if-shell branch, including quoted arguments that real tmux 3.4 accepts. It cannot exercise a corrected stable-name guard and favors the selected suffix implementation. Correct quoting printed the server PID and `$0` in my live run. A correct equality token mismatch kept the session; a correct own-token match killed it and printed a result. N-3's unsupported nested operator and inner-error/outer-continuation observations remain valid. They require explicit capability validation and branch-contained mutation, not abandonment of all guards.

Replace the blanket parser rule with measured supported forms and add real-tmux tests for the chosen production forms, including malformed/unsupported capability, mismatch, absent, close failure and result markers. All 13 green prototype tests are useful regression coverage but do not establish identity-safe stop/send/attach.

### M-2 — The suffix breaks this host's pane lookup contract

Design §2.10 lines 327–344 and R2b line 575; host `fleet_watch.sh:104-106,498-507,564-585`, `ao_relaunch.py:181-190`; core `paths.ts:190-195`; CLI `send.ts:36`, `session.ts:185-191`.

`fleet_watch.sh` with `-p` compares the exact `<prefix>-<session>` name. Without `-p` it requires the name to end in `-<session>`. Neither matches `<prefix>-<session>-r12345678`. Its worker lookup reports absence, skips pane inspection and enters the gone-confirmation path; the separate orchestrator-target check also uses the old ending and reports that events are going nowhere. `ao_relaunch.py` finds zero matches and refuses to save/relaunch. These are direct source conclusions; I did not run these host tools or send an event.

A human's `capture-pane -t <base>` may happen to select the new session through tmux prefix matching, but becomes ambiguous with `<base>0` and with multiple retained launches. A trailing dash avoids the numeric-prefix case only; it does not disambiguate multiple launches or choose the right server. It is not a stable lookup API.

Before choosing OD-17a, provide a documented read-only lookup/capture interface resolving session ID to effective identity, socket and exact target; fail on unknown instead of guessing. Ship and validate the consumers at the same rollout barrier. Keep legacy names working. A suffix-only regex update is insufficient when retained launches coexist. If host-tool changes cannot accompany R2b, use a corrected stable-name design.

### M-3 — Legacy association and retirement are not yet a complete R2b feature

Design §2.8 lines 281–308, §4.6 lines 483–499, round table lines 575–577; source `packages/core/src/metadata.ts:331-339`, `packages/core/src/session-manager.ts:1001-1010,1400-1420,4290-4300`; CLI `session.ts:157-173`.

Keeping persisted runtimeHandle unchanged satisfies C-04, but `Runtime.stop/isAlive` receive only a handle. Define a single effective-identity resolver used by CLI, core, lifecycle, agent probes, holder checks, attach and retained inventory. Association needs compare-and-write against the original record/version, complete validated evidence, an explicit owner acknowledgment of which current pane is being adopted, and invalidation when the launch changes. `runtimeAssociation` is not among today's launch-identity keys. Merely appending a JSON key can leave readers on different servers or let a stale association survive restore. CLI send's broad resolution catch (`send.ts:49-55`) must not turn an association/probe failure into an unmanaged default-server send. Its mutable evidence must not silently change the comparison identity of an in-flight operation.

Retire is scheduled in R2b but depends on the inventory scheduled in R3a. Move the minimal inventory writer/reader and stop-retained guard into R2b (or defer retire and explicitly describe the temporary blocked recovery). Fail retirement if durable inventory publication fails; do not archive first. Include unknown legacy entries that lack complete identity, rather than claiming they contain a full new-handle identity. Test crash boundaries, association races, and record loss.

For many live sessions, one command per record with no inventory of candidates is inadequate operational preparation. Add a read-only batch audit/plan showing session, current record, candidate server/terminal, evidence and proposed association; owner-approved explicit application may follow. Never infer historical server provenance from the presence of a default socket. The optional default-server assertion remains a broad owner assertion with residual risk, not a discovery mechanism.

### m-1 — R4 should preserve malformed git answers as unknown

Design §3 item 7 line 359; `packages/plugins/workspace-worktree/src/index.ts:264-275`.

“Any other output gives true” retains the path but reports positive evidence that was not obtained. Return true only for the expected successful result, false for the stated explicit-absence cases, and reject unexpected output/errors with a diagnostic. Add malformed-success, EACCES and I/O controls alongside spawn ENOENT/timeout. This is a diagnostic/contract correction, not a reason to return false or remove a workspace.

## Command behavior and migration

For **new handles**, preserving the worktree path and branch avoids the workspace-continuity objection to a path suffix. Core already passes a base tmuxName to runtime.create and consumers such as CLI send prefer runtimeHandle.id. The proposed `-S` coverage includes the previously missed foreground-command and OpenCode pane-discovery helpers. Attach must actually pass server arguments to the spawned command: today's CLI discards the runtime command string and builds `['attach','-t',target]` itself. Returning a corrected getAttachInfo.command alone will not fix it. Guarding only isAlive before attach/send leaves a replacement gap (B-1).

Status and lifecycle must use the effective persisted identity, not regenerate a suffix. `tmuxName` and `AO_TMUX_NAME` remain the historical base; the latter has no source reader in this repository, but external hooks must not treat it as an exact new launch target. The built-in metadata hooks address a record, so suffixes do not fix or inherently break their lookup; their unlocked writes are B-5. Restore must first confirm the old stop, then create and publish a fresh complete identity, never update fields on an old handle. `parseTmuxName` currently has no internal source caller, but it is an exported helper; document its base-name-only contract or update it with tests, rather than assuming export consumers do not exist. Full-identity ownership and inventory are required when more than one launch with the same base remains visible.

With **today's legacy fleet and `legacyTmuxServer` OFF**, the rules imply:

| Operation | Expected behavior after R2b |
| --- | --- |
| status / session ls | A positive exact-name probe on the caller's server can report alive, with legacy/unproven provenance. A missing/unreachable/foreign server is unknown and must not rewrite the stored status. §2.8's unconditional “status shows unknown” conflicts with its positive-alive row; specify the distinction. |
| session kill | Refuses with exit 1 even when the base session is visible, because stop provenance is unproven. Worktree and record remain. Hint should name `associate <id> --socket <path>` when appropriate, or retire for irrecoverable evidence. |
| session cleanup | Skips unresolved legacy records on runtime, PR and issue routes, reports the reason; must not interpret merged PR as permission to remove a possibly live workspace. |
| ao send | Can send to an exact visible legacy base on the caller's selected server under the reduced legacy policy; an unknown/missing runtime must refuse restore. If association exists, all send/probe paths must resolve it consistently. Positive legacy evidence is resource-retaining, but not proof a foreign same-name pane is the intended recipient; describe that residual explicitly. |
| lifecycle | Visible runtime + positive agent activity continues normal classification. Unknown runtime must survive agent negatives indefinitely with assertion off. A visible runtime + agent-negative can still reach killed (including existing agent false-on-error behavior until R4); stopping/cleanup must independently refuse unproven legacy destruction. |
| restore/start replacement | Requires destroyed/absent from the old stop and therefore refuses unresolved legacy records. Association or the explicit host assertion is needed first. |

These are intentional availability changes: a kill/cleanup/restore that previously appeared to work can now refuse. R2a alone also refuses ordinary plugin destroys that resolve but leave a live runtime, or rejects/unknown probes previously swallowed. Explain “runtime stop unconfirmed; record and worktree kept” with cause and next action. A successful stop should retain today's healthy behavior. The generic `stopRuntime` fallback is useful only under an authoritative-false `isAlive` contract; legacy plugins that still conflate probe failure with false cannot gain stronger evidence by being wrapped. Label that compatibility limit and test resolved/rejected destroy crossed with true/false/rejected isAlive, plus malformed or unexpectedly rejecting optional stop.

Association/retirement must be available before deployment creates an unmanageable legacy backlog (M-3). The assertion's five-minute no-server fallback deliberately accepts residual provenance risk; no new PID evidence can reconstruct old history. Owner choice is required for that policy, but no confirmation was needed to conduct this review.

## Locks, rollback and independently landable rounds

The lock order `operation -> path -> opencode-session -> synchronous record` has no cycle **if** every path follows it, holds at most one operation/session lock, and nested calls pass validated live tokens. The revised token scope, no process-local reentrancy, reservation recheck, monotonic waiter limit, lifecycle try-once and unsupported-platform refusal address the prior specification gaps. A CLI waiting on a same-ID child hook fails busy rather than deadlocking forever; that hook pattern is now explicitly unsupported. Token release should mark it unusable while closing and reject unawaited nested work; do not leave a usable token past the operation's actual scope.

A holder can still live forever (including an fd-retaining daemon); the waiter limit only bounds the waiter. Diagnostics must distinguish a holder from a safe-to-kill target and include process start identity. Path canonicalization must be consistent across configurations, including existing parent symlinks and absent paths; do not hold one path while acquiring a second in an unspecified order. §4.3 supports shared paths for participating new builds, while OD-13 says all shared worktree roots are unsupported. Choose and enforce one policy. B-3 and B-4 are safety gaps, not deadlock cures.

Rollback may stop its own uniquely identified runtime after a record is replaced, but must retain today's separate `ownOrGone` path check (`session-manager.ts:1793-1803`) and conditional record release. §4.7's shorthand “then removes the workspace” must not authorize deleting a replacement's worktree merely because the rollback stopped its own distinct runtime. Unknown stops retain both record and workspace; if retirement removes the record later, durable inventory must already exist. F-1's single existing-branch worktree-add and F-2's per-action ownership checks remain good local improvements.

| Round | Can the proposed round land alone in the stated order? |
| --- | --- |
| R2a | Core outcomes, propagation, CLI exit and lifecycle gate can land as a refusal-only subset. Fix or conservatively disable unverified Herdr close (B-2) before claiming the complete round safe. Keep false-on-error third-party limitations explicit. |
| R2b | No: B-1 identity-bound mutations, M-2 host consumer compatibility and M-3 association/inventory are prerequisites. Move minimal inventory into this round. Complete R2a/N-2 first. Preserve two-negative confirmation unless the owner separately approves §2.9's change to first-negative killed; verified absence removes the special five-minute bound without inherently requiring that unrelated policy change. |
| R4 | Yes with the listed tests and m-1 corrected. It only changes uncertain reads toward retention and leaves authoritative absence/healthy answers available. It can be developed independently, but the fleet still needs a completed rollout and the preceding gate. |
| R3a | No: fix B-3 and B-5, then validate separate-process lock behavior and rollback path ownership. Do not promise OpenCode cross-ID exclusion until R3b. Inventory cannot first appear here if R2b exposes retire. |
| R3b | No: fix B-4 namespace/unknown completion, then test every remover/interrupter/reuser with shared holders and crashes. R4 strict holder reads and completed R3a child protection are prerequisites. |

The broad order R2, R4, R3 remains appropriate. Each intermediate deployment should claim only the protections it actually supplies, not that all five rounds' fleet guarantees already hold. A versioned completed build avoids lazy-import mixtures during installation. Rollout actions in the document are future operator steps, not actions executed by this review.

## Owner decisions

| Decision | Review recommendation | Reason |
| --- | --- | --- |
| OD-2 | Agree (a), complete immutable handle identity at creation | Raw ticks, boot ID, PID and `$N` are useful; use them to guard mutations, not just diagnostics. |
| OD-3 | Agree modified (a), default-off assertion plus explicit association | Do not guess historical server provenance or automatically rewrite a legacy handle. Define positive legacy and unknown status consistently. |
| OD-4 | Agree (a) | Unknown plus a verified-process hint; SIGUSR1 only for an unoccupied owned socket path and an operator action. Never take a bound socket away from another server automatically. |
| OD-5 | Agree (a) | Refuse unconfirmed stop and retain record/worktree; outcome must reach every destructive caller. |
| OD-6 | Keep (d), revise the identity component | Need identity, operation/path protection and plugin fixes. A suffix is optional, not a substitute for a mutation guard. Stable worktree/branch is correct. |
| OD-7 | Agree (a) | Thirty-second monotonic waiter deadline, lifecycle try-once, no holder expiry, useful diagnostics. |
| OD-8 | Agree (c) with store-scoped quarantine/holder state | Claims plus serialization are complementary; B-4 must close cross-project and unknown-request windows. |
| OD-9 | Agree (c), inventory before loss of record | Durable full identity plus candidate discovery; unknown legacy inventory needs an explicit representation. Deliver it with the first retire feature. |
| OD-10 | Keep (a) only for verified own runtime, (b) for unknown/legacy | Do not confuse runtime ownership with path or record ownership; retain conditional path/remove checks. |
| OD-11 | Keep owner's decided R2 -> R4 -> R3 | Splits are useful once their prerequisites are correctly assigned. |
| OD-12 | Agree (a) | Unreadable archives must fail before reserving an ID or creating anything; missing archive remains healthy. |
| OD-13 | Agree (b), corrected barrier plus epoch | Include old shell writers, in-flight children, worker writes and atomic epoch admission; define shared-root support consistently. |
| OD-14 | Change from unqualified (a) to (c) with durable child/request tracking, or a strictly enforced restricted-child contract | Inheritance alone fails for ordinary descendants and can indefinitely retain locks. A supervisor design must itself specify crash protection; its name alone is not a proof. |
| OD-15 | Agree fail closed, option (a) | Linux lock support and proc checks need explicit admission behavior; test capability on every supported tmux version. A version string >=3.2 is not evidence all quoted guard/parser forms have been verified. |
| OD-16 | Agree (b), after completing M-3 | Explicit associate/retire with recorded evidence and a batch audit; opt-in assertion, never automatic age-based retire. |
| OD-17 | Prefer corrected (b); (c) is also viable with an actual same-connection server gate | Stable name + high-entropy launch token, assigned atomically and guarded in supported tmux commands, avoids host breakage. Correct quoting/result markers and capability branches are necessary. `$N` avoids same-server reuse but repeats across servers, so a preflight PID check followed by a separate client is insufficient. A persistent verified connection or server-side capability/token gate can make (c) viable. Option (a) may be chosen with much stronger collision discipline, effective identity guards and host consumer work; reject the current eight-hex/no-guard version. |

For (b), use an explicitly tested capability path that permits mutation only after supported true/false behavior is established on the connection/target; never put a potentially destructive command unconditionally after a failing inner if-shell branch. My quoted-format/token probes establish that the author's blanket impossibility claim is false, not that a complete production protocol for either alternative has been implemented here.

## Audit of all 50 new tests

Independent run at `628e0fbfa11c6793d5d1e2a3002202a1551551b7` after successful frozen install and build. In each of the four package directories:

```sh
env -i HOME=/tmp/aosdr2/home PATH=/tmp/aosdr2/bin:/usr/bin:/bin \
  LANG=C.UTF-8 TMPDIR=/tmp/aosdr2/tmp SAME_ID_DEFECTS=red \
  ./node_modules/.bin/vitest run src/__tests__/same-id-defects-r2.test.ts --reporter=json
```

All 28 defect tests failed at the stated behavioral assertion, not setup/import errors; all 22 controls passed, none skipped. Core failures were removed workspace/record (5), extra orchestrator/restore creation (2), killed instead of working (2), unintended OpenCode remove (1), cleanup instead of skip (1), and false instead of rejection (5). Tmux failures were replacement removed (2), stale handle alive (2), old keys delivered (1), rebound false (1), and dead-server ERR_RUNTIME_NO_SERVER instead of false (1). Herdr failures were false instead of rejection (2) and workspace close on reused ID (1). Worktree failures were false instead of rejection (2). The copied prototype ran the same tmux file: 13 passed.

The following names cover every test instance, including controls. “Partial change” is an assertion-level counterexample unless a live measurement is cited above; it is not a claim that the isolated change passes the whole suite. Controls rule out some blanket fixes, but the live prototype counterexample passes the whole 13-test tmux suite.

| Package / exact test title | Red run | Partial or wrong behavior that passes this test | Missing discrimination |
| --- | --- | --- | --- |
| core — kill: a destroy that rejects keeps the worktree and the record | failed | Propagate destroy rejection only; ignore a resolved no-op or wrong-launch stop. | All acknowledged outcomes; resolved-but-live caller matrix. |
| core — kill: a destroy that resolves while the session still runs keeps the worktree and the record | failed | Add only kill's post-destroy probe; leave rollback/recovery/restore unsafe. | Same outcome policy across every caller and raced replacement. |
| core — control: kill of a session whose runtime stops removes the worktree and archives the record | passed | Baseline unsafe kill already passes this healthy control. | Unknown/replaced runtime and retained path/record controls together. |
| core — cleanup of a merged PR: a destroy that rejects keeps the worktree and the record | failed | Skip every merged-PR cleanup when destroy rejects, without handling closed-issue or resolved no-op routes. | Healthy merged/closed-issue cleanup; explicit stop outcomes. |
| core — launch rollback: a destroy that rejects keeps the workspace and the record | failed | Keep every failed-spawn workspace/record forever; do not clean even safely stopped own launches. | Successful rollback cleanup and retained-runtime inventory assertions. |
| core — orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one | failed | Refuse only when destroy throws; accept a resolving no-op while old orchestrator lives. | Resolved-but-live and wrong-launch results; metadata unchanged on refusal. |
| core — control: orchestrator start replaces a live orchestrator whose destroy completes | passed | Baseline unguarded orchestrator replacement passes. | Rejected/unknown stop, replacement-at-stop, no second create. |
| core — restore: a destroy of the old pane that rejects creates no second runtime | failed | Throw before create on rejection, while still deleting the workspace or changing other metadata. | Worktree and entire record retained; resolved no-op also refuses. |
| core — control: restore relaunches a session whose old pane stops | passed | Baseline restore that ignores stop failure passes the healthy case. | Unknown/no-op stop and record/path preservation. |
| core — recovery cleanup: a destroy that rejects keeps the worktree and the record | failed | Catch destroy exceptions and return failure, without respecting other-launch or unknown returned by optional stop. | Runtime.stop outcomes and healthy recovery cleanup. |
| core — codex: a runtime probe that rejects plus the agent's 'exited' does not reach killed | failed | Delay runtime-error killing until poll 4, or suppress only codex's negative. | Long repeated unknown; all agents; positive recovery and error reason. |
| core — claude-code: a runtime probe that rejects plus the agent's 'exited' does not reach killed | failed | Delay runtime-error killing until poll 4, or suppress only claude-code's negative. | Long repeated unknown; all agents; positive recovery and error reason. |
| core — control: codex: the runtime answers alive and the agent says exited: killed at the second poll | passed | Baseline false-on-agent-error behavior passes when runtime is positive. | Rejecting agent probe while runtime is alive; explicit agent absence still converges. |
| core — cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name | failed | Treat any archive entry as held without reading it; no-archive control still passes. | Readable unrelated archive permits purge; active listing/content failures. |
| core — control: no archive and no other record name the session: the cleanup removes it | passed | Baseline purge that ignores archive read failures passes no-archive case. | Unreadable contents/active holders and successful unrelated-record purge. |
| core — a workspace.exists that rejects (git could not start) gives a live session no action | failed | Return skip for rejected workspace.exists only on this missing-path branch; lstat still fails open. | EACCES/ELOOP/I/O path, malformed plugin answers, no destructive side effects. |
| core — control: a workspace.exists that answers false is an authoritative 'missing' (not unknown) | passed | Baseline catch-all false passes this authoritative-false control. | Rejected exists distinguished; healthy existing workspace. |
| core — isHerdrProcessRunning rejects when the herdr binary cannot start | failed | Throw only for spawn ENOENT; EACCES/I/O still become false. | Other execution failure classes and structured cause. |
| core — isHerdrProcessRunning rejects when the herdr command times out | failed | Throw only for this killed/SIGTERM shape; other signals/errors still become false. | Other timeout/signal forms and retry to healthy. |
| core — isHerdrProcessRunning rejects when herdr answers text that is not JSON | failed | Throw on JSON parse failure; syntactically valid malformed process entries still become no agent. | Typed result/list/entry validation. |
| core — isHerdrProcessRunning rejects when herdr answers an error envelope that is not 'pane not found' | failed | Throw for server_unavailable only, swallow other unknown envelopes. | Unknown error codes, malformed envelopes and pane_not_found control. |
| core — isHerdrProcessRunning rejects when herdr answers a result without process_info | failed | Throw only when process_info is wholly absent; accept malformed foreground_processes. | Invalid list/entries and terminal identity validation. |
| core — control: an explicit 'pane not found' answers false | passed | Baseline that maps every Herdr error to false passes. | Only pane_not_found is authoritative, other errors reject. |
| core — control: a valid empty process list answers false | passed | Baseline that returns [] on every failure passes. | Malformed/failed query distinguished from valid empty list. |
| core — control: a listed agent process answers true | passed | A parser that detects only the fixture's claude process passes. | Other supported agents, argv/name shapes, no-agent and malformed rows. |
| runtime-tmux — destroy of the first launch keeps a replacement of the ID that started in the same second | failed | Suffix-only destroy by name passes; no full identity check is needed in this fixture. | Force complete-name reuse; compare before mutation. |
| runtime-tmux — isAlive of the first launch answers false while a same-second replacement of the ID runs | failed | Check presence of the unique name only; ignore server incarnation and session ID. | Same full name with different $N/process identity. |
| runtime-tmux — after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID | failed | Suffix-only name routing protects different names even on restarted server. | Repeat full name and $0 on restart; wrong-server stop must refuse. |
| runtime-tmux — after a same-second restart of the server, isAlive of the old launch answers false | failed | Name absence plus simple PID test passes; ignore ticks/boot reuse. | Same PID/$0 with other ticks or boot, and unreadable proc. |
| runtime-tmux — control: destroy ends its own launch | passed | Baseline name-only kill passes its own-launch control. | Identity mismatch, process replacement and guarded result acknowledgment. |
| runtime-tmux — control: isAlive of a live launch answers true | passed | Baseline name-only has-session passes. | Same-name different identity must not report this launch alive. |
| runtime-tmux — create: a replacement of the ID made directly after the create command never receives the first launch's keys | failed | Suffix plus missing-target failure passes without validating atomic create identity or the confirm PID. | Same-full-name replacement; parse-error cleanup; long command/paste path. |
| runtime-tmux — control: create on a healthy server sends the launch command into its own session | passed | Baseline sends correctly on a healthy server. | Delayed replacement before initial keys; response binding and cleanup. |
| runtime-tmux — isAlive rejects while another server answers at the recorded socket and the recorded server process still runs | failed | Reject PID mismatch whenever old PID exists; never read raw ticks/boot. | PID reuse, proc failure and same-name wrong-server mutation. |
| runtime-tmux — isAlive answers false when no server answers at the recorded socket and the recorded server process has ended | failed | Map every no-server error to false. | Same no-server condition with recorded process alive/unreadable. |
| runtime-tmux — control: isAlive answers false when another server answers and the recorded server process has ended | passed | Baseline false on target missing already passes. | Recorded process alive behind endpoint replacement. |
| runtime-tmux — control: isAlive answers false when the recorded server answers that the session is gone | passed | Baseline false on every failed probe passes this explicit missing case. | Timeout/I/O/foreign-server errors must remain unknown. |
| runtime-tmux — control: isAlive answers true for a live launch on the recorded server | passed | Baseline has-session by name passes. | Full identity mismatch and all-handle-call routing. |
| runtime-herdr — isAlive rejects when herdr answers an error envelope that is not 'pane not found' | failed | Throw only for server_unavailable; other error envelopes still read as absent. | Other codes, malformed envelopes and callers preserving resources. |
| runtime-herdr — isAlive rejects when herdr answers a reply without a pane | failed | Throw only for result without pane; malformed pane/terminal fields still accepted. | Field-level validation and legacy missing identity policy. |
| runtime-herdr — control: an explicit 'pane not found' envelope answers false | passed | Baseline catches every failure as missing and passes. | Unknown errors must reject; gone envelope shape verified independently. |
| runtime-herdr — control: a pane ID that now names another terminal answers false | passed | Baseline isAlive mismatch check passes while destroy still kills the replacement. | Atomic close target and replacement between get and close. |
| runtime-herdr — control: the recorded pane with its terminal answers true | passed | Baseline compares a live pane and passes. | Missing/malformed terminal ID cannot be accepted as a proved match. |
| runtime-herdr — destroy does not close the workspace or pane when the pane ID now names another terminal | failed | A separate pane-get/terminal check then positional close passes. | The B-2 replacement-at-close interleaving. |
| runtime-herdr — control: destroy closes the recorded workspace while its pane has the recorded terminal | passed | Baseline workspace close passes healthy control. | Same workspace ID reused; close-error response; non-owned sibling panes. |
| workspace-worktree — exists rejects when the git binary cannot start (spawn ENOENT) for an existing directory | failed | Reject ENOENT only when error text says spawn git; other tool failures remain false. | EACCES/I/O/signals with existing directory and missing-path control. |
| workspace-worktree — exists rejects when git times out for an existing directory | failed | Reject this timeout shape only; malformed successful output still reads as positive/negative evidence. | Other signals, malformed output and healthy retry. |
| workspace-worktree — control: a path that does not exist answers false | passed | Baseline existsSync/catch-all false passes. | Unreadable path must reject, and git must not run for real ENOENT. |
| workspace-worktree — control: an existing directory that is not a git work tree answers false | passed | Baseline maps all git failures to false and passes. | Only expected not-a-repository diagnostic is absence. |
| workspace-worktree — control: a git work tree answers true | passed | Return true for every existing directory and pass this healthy case. | Explicit not-a-repository and malformed/error answers distinguished. |

## Remaining cases from the round-1 test table

The added controls close real gaps: successful own tmux destroy/live create; per-server `$0` restart; ordinary missing/dead versus rebound runtime; actual restore/orchestrator refusal; repeated lifecycle unknown for two agents; archive content; rejected workspace.exists; and both Herdr helper layers. The following round-1 discriminators still are **not covered by these 50 new tests** (some are promised in the round plan; a promised test is not a run result):

- Runtime identity: forced same full name with different `$N`; reused PID with changed raw ticks/boot; inaccessible/malformed proc; repeated lifecycle hidden/rebound integration and operator hint. Atomic create-readback is exercised through a stand-in replacement, but long launch, initial send/parse-failure cleanup and guarded attach/send need real-server interleavings. Agents still need same-name/different-launch on the correct socket and other helper routes, not just `-S` plumbing.
- Workspace F-1: successful existing-branch creation on the requested branch, checked-out/path conflict refusal without cleanup, and exact no-extra-removal assertions. The five new worktree tests cover exists, not create/postCreate.
- F-2: healthy symlinks/hooks continue on spawn and restore; ownership changes between hook awaits; each destructive action and unknown ownership retains the new contents.
- F-5: independent-process kill/restore with both outcomes checked, the old runtime stopped and accepted restore live, final worktree/record consistency, same-process non-reentrancy, token scope/release, deadline/platform/canonical path, and holder death during a real child. The copied m6 is standalone evidence, not a committed automated test; it misses the newly measured descendant case.
- OpenCode: successful intended reuse and successful unheld removal in the reuse/discard path; a removal already dispatched before claim under both processes' locks; remote unknown completion, claim-owner crash and missing session. The new core cleanup no-holder control does not exercise the agent plugin's reuse/discard path. Add the new store-versus-project scope case as well.
- Allocation: strict reads for worker and worktree-orchestrator; unreadable archive fails **before** reservation/runtime/workspace work; healthy and ENOENT retry. These 50 add no allocation tests.
- Holder reads: omitted/unreadable active record, readable unrelated archive/record that permits cleanup, and archive/record changing across awaits. The latest-archive-content defect and no-archive purge control are now covered.
- Recovery: inaccessible `lstat`, permission/loop/I/O error propagation and zero destructive side effects. Plugin exists rejection and missing git versus missing path are now covered. A positive existing-workspace validator control is still needed.
- Agents: healthy true and successful no-agent false through each tmux/ps helper; several ps failure classes; explicitly gone on the identified server versus hidden/foreign server; OpenCode internal pane discovery and PaneGoneError boundary. The new core Herdr controls do not replace per-agent tmux-path controls.
- Herdr: runtime process-launch EACCES/I/O and malformed field-level replies; error-envelope close behavior; callers preserving resources. The new healthy/explicit-missing/mismatched terminal controls now reject blanket always-throw implementations, but cannot prove atomic stop.

Additional revision-specific tests are required for all optional stop outcomes/caller branches/CLI exit codes; legacy assertion OFF/ON and explicit association/retire; retained inventory write/crash/unknown lookup; epoch and continuing wrappers; host-tool compatibility if suffixes are chosen. Tests should be converted from expected-failure markers in the implementation rounds once the behavior is fixed.

## What is correct in the revision

- `new-session -P -F` obtains the created session's response; ordinary different-suffix replacements never receive the old launch's keys. My interposer killed the created pane before returning its create output and created a replacement; create rejected, replacement stayed and contained no FIRST-KEYS.
- Raw boot/process/session identity is a significant improvement over timestamps. My explicit same-server run had server 3633408, `$1` then `$2`, both created at second 1792604867; old stop was absent and the replacement stayed alive. The separate same-second server-restart run repeated `$0` while changing PID/start ticks, correctly returning old absence.
- With an unrelated session at a rebound socket, both isAlive and stop preserve uncertainty while the recorded process still runs. Proc errors must remain unknown, and no automatic SIGUSR1 is proposed.
- Acknowledged stop outcomes, refusal through all destructive callers, and the lifecycle runtime-unknown gate directly address dangerous current behavior. N-2 is identified and assigned before the suffix change.
- The eleven strict-read boundaries now cover prior B-7's whole decision chain. The controls preserve healthy and explicit absence rather than permanently blocking every operation.
- The operation token/order/deadline/platform specification and direct-child inheritance are useful concrete progress. Durable inventory and OpenCode quarantine are the right categories of protection once scope and lifetime are corrected.

I read the author's report only after recording the independent closure and N-1/N-2/N-3 assessments above. Its counts agree with my red-mode run. Its “all findings accepted” is an accurate description of the author's response, not evidence they are all closed; the counterexamples in this review explain the distinction. Its full-suite/typecheck/lint results are author-reported and were not rerun here. My validation was the required install/build, all 50 new tests, the 13-test prototype run, and the private experiments documented here.

## Reproduction record

All code below ran only under `env -i HOME=/tmp/aosdr2/home PATH=/tmp/aosdr2/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr2/tmp`. `bin/node` and `bin/pnpm` pointed to the existing Node 25.7.0 installation; gh was an offline stub, and tmux was a shim to `env -u TMUX /usr/bin/tmux -L aosdr2-test`. No model executable was on PATH. The brief's protected processes were never signalled.

The R2 prototype source/test/config were copied (not symlinked) from `/tmp/aosd2/proto/r2` to `/tmp/aosdr2/proto`. Only its Vitest core alias changed from ao-52 to ao-51 and node_modules linked to this worktree's runtime-tmux dependencies; a local package.json selected ESM. The source itself was unchanged. The direct-child m6 script was copied with every `aosd2` path/socket name changed to `aosdr2`; its plain/inherit results are above. The source remains reproduced in design §14, so deleting my scratch does not remove that recipe.

The following are the independent scripts retained here because the scratch directory is removed at completion. Commands were `node /tmp/aosdr2/<script>` under the clean environment above. The readback experiment temporarily replaced only the scratch tmux shim with `exec /tmp/aosdr2/bin/node /tmp/aosdr2/interposer.mjs "$@"`, then restored it. Every directly started private server and pane PID was recorded; cleanup used exact PIDs. No host configuration, wrapper, session metadata or default-server tmux call was used.

### probe.mts

```js
import { create } from './proto/src/index.ts';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const rt = create() as ReturnType<typeof create> & {stop(h: unknown): Promise<unknown>};
const ledger = '/tmp/aosdr2/pids';
const owned = new Set<number>();
function track(p: number) { if (!owned.has(p)) { owned.add(p); appendFileSync(ledger, `${p}\n`); } }
function tm(...args: string[]) { return execFileSync('/usr/bin/env', ['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aosdr2-test',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); }
function discover() { try { for(const l of tm('list-panes','-a','-F','#{pid}|#{pane_pid}').split('\n')) for(const p of l.split('|')) track(Number(p)); }catch{} }
function signal(p: number) { try {process.kill(p,'SIGKILL');} catch(e) {if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;} }
async function clean() { discover(); const servers = new Set<number>(); try { servers.add(Number(tm('display-message','-p','#{pid}'))); }catch{} for(const p of owned) if(!servers.has(p)) signal(p); await sleep(80); for(const p of servers)signal(p); await sleep(100); }
async function launch(id='same') {const h=await rt.create({sessionId:id,workspacePath:'/tmp/aosdr2/home',launchCommand:'echo FIRST-LAUNCH',environment:{PATH:process.env.PATH!}});discover();return h;}
async function outcome(h: unknown){return rt.isAlive(h as never).then(alive=>({alive}),e=>({error:e.code,message:e.message}));}
function proc(p: number){try{return readFileSync(`/proc/${p}/stat`,'utf8').split(') ').at(-1)!.split(' ')[0];}catch{return 'gone';}}
try {
  let a=await launch(); const pa=Number(tm('display-message','-p','-t',`=${a.id}:`,'#{pane_pid}')); signal(pa); await sleep(20);
  const b=await launch(); console.log('same-second',JSON.stringify({a,b,stop:await rt.stop(a),old:await outcome(a),replacement:await outcome(b)}));
  await clean();
  a=await launch('restart'); await clean(); const c=await launch('restart'); console.log('restart',JSON.stringify({a,c,stop:await rt.stop(a),old:await outcome(a),replacement:await outcome(c)}));
  await clean();
  a=await launch('collision'); signal(Number(tm('display-message','-p','-t',`=${a.id}:`,'#{pane_pid}'))); await sleep(30);
  // A second launch selects the same 32-bit suffix after the old name becomes free.
  tm('new-session','-d','-s',a.id,'/bin/sleep 300'); discover();
  console.log('full-name-reuse-before',JSON.stringify(await outcome(a)));
  console.log('full-name-reuse-stop',JSON.stringify(await rt.stop(a)));
  try {tm('has-session','-t',`=${a.id}`);console.log('replacement-survives',true);}catch{console.log('replacement-survives',false);}
  await clean();
  a=await launch('hidden'); const oldServer=Number(a.data.tmuxServerPid); const sock=String(a.data.tmuxSocket);
  if(!sock.endsWith('/aosdr2-test'))throw new Error('not own socket'); unlinkSync(sock);
  tm('new-session','-d','-s','other','/bin/sleep 300');discover();
  console.log('rebound',JSON.stringify({old:await outcome(a),stop:await rt.stop(a),oldServerState:proc(oldServer)}));
  // A rebound server can own the same exact name; print-before-kill is not a guard.
  tm('new-session','-d','-s',a.id,'/bin/sleep 300');discover();
  console.log('rebound-same-name-stop',JSON.stringify(await rt.stop(a)));
  try {tm('has-session','-t',`=${a.id}`);console.log('other-server-replacement-survives',true);}catch{console.log('other-server-replacement-survives',false);}
  await clean(); signal(oldServer); await sleep(50);
  tm('new-session','-d','-s','guard','/bin/sleep 300');discover();
  tm('set-option','-t','=guard:','@ao_launch','token');
  for (const [label,args] of [
    ['quoted-format',['if-shell','-F','1','display-message -p "ao-x:#{pid}"']],
    ['quoted-dollar',['if-shell','-F','1','display-message -p "#{session_id}"']],
    ['unsupported-nested',['if-shell','-F','-t','=guard:','#{nosuchop:#{@ao_launch},wrong}','display-message -p TRUE','display-message -p FALSE']],
    ['supported-mismatch',['if-shell','-F','-t','=guard:','#{==:#{@ao_launch},wrong}','display-message -p TRUE','display-message -p FALSE']],
    ['capability-branches',['if-shell','-F','-t','=guard:','#{nosuchop:#{@ao_launch},wrong}','display-message -p REFUSED','kill-session -t =guard']],
  ] as [string,string[]][]) {try{console.log(label,tm(...args));}catch(e){console.log(label,'ERROR',String((e as {stderr:unknown}).stderr));}}
  console.log('guard-still-live',tm('has-session','-t','=guard')==='');
} finally {await clean(); for(const p of owned)signal(p);await sleep(100);console.log('owned-processes',JSON.stringify([...owned].map(pid=>({pid,state:proc(pid)}))));}

```

### same-server.mts

```js
import {create} from './proto/src/index.ts';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const t=(...args:string[])=>execFileSync('/usr/bin/env',['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aosdr2-test',...args],{encoding:'utf8'}).trim();
const rt=create() as ReturnType<typeof create>&{stop(h:unknown):Promise<unknown>};
const owned=new Set<number>();
function remember(){for(const l of t('list-panes','-a','-F','#{pid}|#{pane_pid}').split('\n'))for(const p of l.split('|')){owned.add(Number(p));appendFileSync('/tmp/aosdr2/pids',p+'\n');}}
async function launch(){const h=await rt.create({sessionId:'same',workspacePath:'/tmp/aosdr2/home',launchCommand:'echo scratch',environment:{PATH:process.env.PATH!}});remember();return h;}
t('new-session','-d','-s','keeper','/bin/sleep 300');remember();
try{
 const a=await launch(); const pa=Number(t('display-message','-p','-t',`=${a.id}:`,'#{pane_pid}'));process.kill(pa,'SIGKILL');try{t('kill-session','-t',`=${a.id}`);}catch{}
 const b=await launch();console.log('same-server',JSON.stringify({old:a.data,new:b.data,names:[a.id,b.id],stop:await rt.stop(a),replacementAlive:await rt.isAlive(b)}));
 const stale={...b,data:{...b.data,tmuxServerStartTicks:'0',tmuxBootId:'00000000-0000-0000-0000-000000000000'}};
 console.log('simulated-stale-process-identity',JSON.stringify({alive:await rt.isAlive(stale)}));
 t('new-session','-d','-s','stable','/bin/sleep 300',';','set-option','-t','=stable:','@ao_launch','launch-B');remember();
 console.log('stable-token-mismatch',t('if-shell','-F','-t','=stable:','#{==:#{@ao_launch},launch-A}','kill-session -t =stable ; display-message -p "destroyed:#{pid}"','display-message -p "kept:#{pid}"'));
 console.log('stable-token-own',t('if-shell','-F','-t','=stable:','#{==:#{@ao_launch},launch-B}','kill-session -t =stable ; display-message -p "destroyed:#{pid}"','display-message -p "kept:#{pid}"'));
}finally{
 remember();const server=Number(t('display-message','-p','#{pid}'));for(const p of owned)if(p!==server)try{process.kill(p,'SIGKILL');}catch{}try{process.kill(server,'SIGTERM');}catch{}
}

```

### interposer.mjs

```js
import {spawnSync} from 'node:child_process';
import {existsSync,unlinkSync,appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
const prefix=['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aosdr2-test'];
function run(a){return spawnSync('/usr/bin/env',[...prefix,...a],{encoding:'utf8'});}
function remember(){const out=run(['list-panes','-a','-F','#{pid}\n#{pane_pid}']);appendFileSync('/tmp/aosdr2/pids',out.stdout);}
const result=run(args);
if(args.includes('new-session')&&existsSync('/tmp/aosdr2/intercept')&&result.status===0){
  unlinkSync('/tmp/aosdr2/intercept');remember();
  const name=args[args.indexOf('-s')+1];
  const pane=Number(run(['display-message','-p','-t',`=${name}:`,'#{pane_pid}']).stdout.trim());
  process.kill(pane,'SIGKILL');
  run(['kill-session','-t',`=${name}`]);
  run(['new-session','-d','-s','readback-rfeedface']);remember();
}
process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exit(result.status??1);

```

### readback.mts

```js
import {create} from './proto/src/index.ts';
import {execFileSync} from 'node:child_process';
import {appendFileSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const t=(...args:string[])=>execFileSync('/usr/bin/env',['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aosdr2-test',...args],{encoding:'utf8'}).trim();
t('new-session','-d','-s','keeper','/bin/sleep 300');
writeFileSync('/tmp/aosdr2/intercept','go');
try{
 const result=await create().create({sessionId:'readback',workspacePath:'/tmp/aosdr2/home',launchCommand:'echo FIRST-KEYS',environment:{PATH:process.env.PATH!}}).then(h=>({handle:h}),e=>({error:e.message}));
 await sleep(30);
 console.log(JSON.stringify({result,replacement:t('capture-pane','-p','-t','=readback-rfeedface:')}));
}finally{
 const pairs=t('list-panes','-a','-F','#{pid}|#{pane_pid}').split('\n').map(l=>l.split('|').map(Number));
 appendFileSync('/tmp/aosdr2/pids',pairs.flat().join('\n')+'\n');
 for(const [,p]of pairs)try{process.kill(p,'SIGKILL');}catch{}
 for(const p of new Set(pairs.map(p=>p[0])))try{process.kill(p,'SIGTERM');}catch{}
}

```

### descendant.mjs

```js
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {existsSync,writeFileSync,appendFileSync,readFileSync,unlinkSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosdr2/';
const name='\0aosdr2-descendant';
async function bind(){return new Promise((resolve,reject)=>{const s=createServer();s.once('error',e=>e.code==='EADDRINUSE'?resolve(null):reject(e));s.listen({path:name,exclusive:true},()=>resolve(s));});}
function logpid(p){appendFileSync(root+'pids',`${p}\n`);}
if(process.argv[2]==='grandchild'){
  writeFileSync(root+'grandchild-ready',String(process.pid));
  while(!existsSync(root+'release-grandchild'))await sleep(5);
  unlinkSync(root+'replacement');writeFileSync(root+'grandchild-done','yes');
}else if(process.argv[2]==='child'){
  const child=spawn(process.execPath,[import.meta.filename,'grandchild'],{stdio:'ignore'});logpid(child.pid);child.unref();
  while(!existsSync(root+'grandchild-ready'))await sleep(5);
  writeFileSync(root+'child-ready',String(process.pid));
  // Normal Node spawn did not pass fd 3 onwards. Its parent exits normally.
}else if(process.argv[2]==='holder'){
  const lock=await bind();const child=spawn(process.execPath,[import.meta.filename,'child'],{stdio:['ignore','ignore','ignore',lock._handle.fd]});logpid(child.pid);
  await new Promise(r=>child.once('exit',r));writeFileSync(root+'holder-ready',String(process.pid));
  setInterval(()=>{},1000);
}else{
  const holder=spawn(process.execPath,[import.meta.filename,'holder'],{stdio:'inherit'});logpid(holder.pid);
  try{
    while(!existsSync(root+'holder-ready'))await sleep(5);
    holder.kill('SIGKILL');await new Promise(r=>holder.once('exit',r));
    const lock=await bind();const grandchild=Number(readFileSync(root+'grandchild-ready','utf8'));
    console.log(JSON.stringify({holder:holder.pid,child:Number(readFileSync(root+'child-ready','utf8')),grandchild,contenderAcquired:!!lock,grandchildStillRuns:existsSync(`/proc/${grandchild}`)}));
    writeFileSync(root+'replacement','new operation owns this');writeFileSync(root+'release-grandchild','go');
    while(!existsSync(root+'grandchild-done'))await sleep(5);
    console.log(JSON.stringify({replacementSurvives:existsSync(root+'replacement')}));lock?.close();
    try{process.kill(grandchild,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
  }finally{holder.kill('SIGKILL');}
}

```

### protocols.mjs

```js
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,readFileSync,appendFileSync,unlinkSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosdr2/protocols';mkdirSync(root,{recursive:true});
const lockName='\0aosdr2-shared-store-S';
async function lock(){return new Promise((r,j)=>{const s=createServer();s.once('error',j);s.listen({path:lockName,exclusive:true},()=>r(s));});}
async function close(s){await new Promise(r=>s.close(r));}
if(process.argv[2]==='reuse'){
 const s=await lock();const seesLocalQuarantine=existsSync(root+'/project-B/quarantine-S');
 const seesOtherProjectQuarantine=existsSync(root+'/project-A/quarantine-S');
 if(!seesLocalQuarantine&&existsSync(root+'/session-S'))writeFileSync(root+'/project-B/claim-S','S');
 await close(s);console.log(JSON.stringify({seesLocalQuarantine,seesOtherProjectQuarantine,reused:existsSync(root+'/project-B/claim-S')}));
}else{
 mkdirSync(root+'/project-A',{recursive:true});mkdirSync(root+'/project-B',{recursive:true});
 writeFileSync(root+'/session-S','continuity data');
 const s=await lock();writeFileSync(root+'/project-A/quarantine-S','request completion unknown');await close(s);
 // The API client's unknown completion released the lock, but remote work can still complete.
 const reuse=spawn(process.execPath,[import.meta.filename,'reuse'],{stdio:['ignore','pipe','inherit']});appendFileSync('/tmp/aosdr2/pids',`${reuse.pid}\n`);
 let out='';reuse.stdout.on('data',d=>out+=d);await new Promise(r=>reuse.once('exit',r));process.stdout.write(out);
 unlinkSync(root+'/session-S');console.log(JSON.stringify({lateRequestCompleted:true,claimStillNamesS:existsSync(root+'/project-B/claim-S'),SExists:existsSync(root+'/session-S'),sameProjectReuseWouldRefuse:existsSync(root+'/project-A/quarantine-S')}));
 // Herdr stand-in: replacement occurs after pane get answered, before positional close.
 let pane={terminal:'term_A',open:true};const recorded='term_A';
 const observed={...pane};await sleep(0);pane={terminal:'term_B',open:true};
 let result='other-launch';if(observed.terminal===recorded){pane.open=false;result='destroyed';}
 console.log(JSON.stringify({herdrObserved:observed.terminal,closedTerminal:pane.terminal,replacementOpen:pane.open,stopOutcome:result}));
}

```

## Final cleanup and host-state evidence

Marker: /tmp/aosdr2-marker, 2026-10-21 13:38:27.371980273 -0400. No scratch lifecycle worker was started. Private tmux panes/servers and lock/protocol processes have ended; cleanup targeted only exact PIDs started by these experiments. The audit checks recorded experiment PIDs and scans process environments for the scratch HOME/TMPDIR (excluding the audit process itself):

```text
Recorded PIDs still present: []
Own live processes: []
Recorded process count: 45
```

The 45 recorded PIDs cover the manual experiments; test stand-in children were stopped by their fixture teardown and the scratch-environment process scan is empty. Removed /tmp/aosdr2, /tmp/aosdr2-marker and the stale socket /tmp/tmux-44402/aosdr2-test only after that audit. The author's /tmp/aosd2 and /tmp/ao48sd were read-only throughout and remain untouched. Reproducer code/evidence needed for this review is retained above.

Before command: `ls -la --time-style=full-iso ~/.ao/bin`

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After command: `ls -la --time-style=full-iso ~/.ao/bin`

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The listings are byte-identical (diff produced no output).

Required state check, before removing the marker:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
```

Every printed entry is accounted for below. These are **external fleet writes, not reviewer writes**. Exact writing PIDs are not recorded in these files; attribution to lifecycle/orchestrator maintenance is an inference from the contents and timestamps, not a claim of syscall tracing.

| Printed path | Attribution/evidence |
| --- | --- |
| /home/taisung/.agent-orchestrator/f6790d5546be-agent-skills | External agent-skills worker maintenance; directory changed at 13:47:07 EDT alongside the worker PID file. |
| /home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid | External worker restart/update at 13:47:07 EDT; current file contains 3626937. I did not start or signal it. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator | External orchestrator-project worker maintenance; directory changed at 13:46:56 EDT with the PID file. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid | External worker restart/update at 13:46:56 EDT; current file contains 3624110. I did not start or signal it. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions | External record renames/archivals; last observed mtime 13:51:26 EDT matches ao-52. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive | External archival at 13:48:21 EDT; read-only listing shows newly archived ao-50 and ao-53. I did not run cleanup/kill or archive them. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52 | External ao-52 status maintenance at 13:51:26 EDT; generation 6, working, claude-code. No message or mutation was sent to ao-52. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations | External generation-floor maintenance at 13:48:21 EDT, matching the archive updates. |

The original protected worker PIDs 1470866/1471311 were not touched; their replacement by other actors during this review is visible in the PID files. The orchestrator pane, real agents, ao-50/52/53 and watchers were never signalled by this session. No AO command ran, including status; no real OpenCode or model process ran; no default-server tmux call ran. No write was made to real AO state, wrappers, agent configuration or global links.


Git HEAD remains 628e0fbfa11c6793d5d1e2a3002202a1551551b7, with no tracked-file diff. Only the requested untracked round-2 review/report were written; the supplied brief and unchanged round-1 review remain. No commit, push, PR or network gh call was made.
