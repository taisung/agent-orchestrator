# Same-ID design r4 — re-check by ao-51

Review completed on 2026-10-21, source `13c58b2c66857bf976220b184b0026850cf5f210`. Design: `git show main:development/reviews/same_id_design_r4_opus.md` (2628 lines). Scope: closure of the nine round-3 findings and changed/new design. R2a, the independent Codex send fix, and already accepted R4 are outside this review. This is a design verdict, not approval of the unchanged implementation. Owner decisions remain fixed, including the explicit exclusion of daemonizing/escaping children from OD-14's guarantee and guarded legacy sends under OD-18(a).

RW: NOT-SOUND

R2b-1: SOUND

R2b-2: NOT-SOUND

R3a: NOT-SOUND

R3b: NOT-SOUND

RH: SOUND-WITH-CHANGES

RO: NOT-SOUND

**3 blockers, 4 majors, 0 minors.** The legacy guard closes the mixed legacy/token boundary, subject to the explicitly open OD-23 trust choice. The remaining blockers are the first-scan writer gap, concurrent association recovery, and reuse through an unbound OpenCode transport. The supervisor, inbox lifecycle, remote request reconciliation, and Herdr qualification need the changes below. No implementation, commit, push, PR, real AO command or fleet mutation was performed.

## Evidence log

- Created `/tmp/aosdr4-marker` and new scratch `/tmp/aosdr4`; saved real `~/.ao/bin` and `~/.config/herdr` listings and the previous report. Prior review files remain untouched.
- All helpers, Node and tests use `env -i`, fake HOME and scratch PATH. Offline gh stub; private tmux shim; no AO_* or agent executable inherited. No real AO or OpenCode executable, model turn, repository commit, push or PR; OpenCode transport probes use explicit scratch stand-ins. Author scratch `/tmp/aosd4` is read-only.
- Read design and scripts before experiments; author's report deferred until the independent prior-finding and legacy-guard assessment. Install uses `--offline` in addition to the required frozen lockfile to honor the new no-network rule.

### Independent checks, before reading the author's report

- Frozen offline install passed after copying the locally cached pnpm v3 store into reviewer scratch. The first attempts found incomplete caches; neither downloaded anything. `pnpm build` passed.
- Own t4 on tmux 3.4: the unguarded legacy kill destroyed a replacement token launch. Atomic empty-token guard: 200 races, 61 done / 69 kept / 70 absent / **0 done with a token**. Separate read then kill: 59 kills, **2 with a token**. Tokenless kill/send/attach worked; token-bearing kill/send/attach did not mutate. Same-uid pane option `@ao_launch ''` shadowed the session token and permitted a legacy kill, exactly the disclosed OD-23 residual.
- Own t4b: `$11` equality, number-only session ID, createdAt lower/upper numeric comparisons, and false `x >= x+1` capability sentinel behaved as specified. Unknown `e|zz` returned false; an unknown format returned true, confirming the need for the separate positive/negative capability checks.
- Source inventory agrees with section 2: plugin kill/create-failure cleanup/send steps, exported core kill/send, CLI direct C-u/paste/literal/Enter, both later Enter retries and attach all need the shared guard. In particular, landing ao-54 first does not itself supply these guards. The patch must inventory its final send implementation again.
- Own t5, using shipped wrapper/helper exports: command-line matching misses the sourced old helper; old wrapper fd 255 has the deleted inode. The inode drain catches the normal case and preserves the new record. Its orphan case C seeds the drain **before** killing the parent; this does not establish safety when the parent disappears before the first scan. The first-scan counterexample below demonstrates that gap.
- New red tests: core r4 **3 failed / 3 passed**, tmux r4 **3 failed / 6 passed**, all for their stated assertions. Herdr r3 after `unknown[]` change: **3 failed / 1 passed**, unchanged semantic failures. Six new failures total, nine new controls. No production fix is present or expected at this review head.

### Source checks

- RW section 4.5 step 3 returns unless `launchState=published`. The legacy records for which section 4.4 creates `legacy.ndjson` have neither `launchId` nor `launchState`; no barrier step backfills the state. They never reach step 4's legacy-file branch. The new legacy writers therefore accumulate updates forever. Make legacy eligibility explicit and test an actual pre-RW record through barrier and applier.
- R2b-2 section 3's exact clear has no record-state fence or operation lock until R3a. An abandoner can read the intent, a resumer can publish `runtimeAssociation=T` and remove the intent, then the abandoner can unset T in tmux before its record CAS fails. The published associated record now names a tokenless live pane. Durable intent fixes serial crashes, not this concurrency.
- R3a section 5.2's shell leader runs `read done` after printing `rc`. A TERM to that wait may interrupt it; its result is not checked and the next instruction is `exit $rc`. The stated drain sends TERM after receiving `rc`. This order differs from s2's TERM-during-command experiment.

### Measured counterexamples

- `rw-first-scan.mjs`: shipped GH_WRAPPER and AO_METADATA_HELPER, scratch `mv` held after the old record copy. Kill only the wrapper **before** installation/first drain scan. The cleanup observer knows the mv PID, but supplies no seed to the algorithm. Two inode scans 100 ms apart both return `hits=[]`, `members=[]`; the mv remains in the original group, parent 1. Admit the new Node record (`new`, generation 2), then release mv: the record becomes `old`, generation 1. No descendant escaped its group. Thus the supported case C is missed unless it happened to be observed before parent death.
- `leader-tail.py`: exact section 5.2 shell leader, command returns `rc=0` with a TERM-ignoring same-group child. TERM while leader waits for `done`: **leader exit 0, child still S, subsequent group KILL allowed=False**. Separate stdout probe: an ordinary command prints `rc=0` before a five-second sleep; the first purported completion is command output. Both need protocol fixes, not a broader containment decision. Subreaper cleanup leaves `own PIDs still present: []`.
- Completed independent closure assessment before consulting the author report: prior M-3 is partly closed. R3b's own release and changed-identity refusal fix the earlier self-block and unsafe stale classification; the quarantine part now lives in RO and its proposed idle/runtime-ended release does not establish that a pending server request has completed. Prior M-4's creation incarnation and error table close the named protocol omissions; the subsequent emitted-ID and error-branch audit is reported in M-4. No original decided OD is reopened by the process-group counterexamples.

## Round-3 findings: final closure state

| Prior finding | State | Reason |
| --- | --- | --- |
| B-1 sourced old helper | Partly closed | Inode matching finds the running wrapper and its currently observable children. It misses a same-group orphan whose parent died before the first scan; new B-1. |
| B-2 escaping children / overstated containment | Closed under the owner's narrowed OD-14 | No daemon containment is claimed now. Escapes are explicitly unsupported and the marker is only diagnostic. The new leader has a separate, entirely in-group defect, M-2; this does not reopen the owner's choice. |
| B-3 wrong-store remove/interrupt | Closed for those operations | Sending neither operation prevents that particular damage. R3b still allows other writes to reused sessions through the same unbound transport; new B-3. |
| B-4 legacy kill of a token launch | Closed at design level | The empty-token condition is in the same tmux command as every legacy mutation, starting in R2b-1. Own race and positive controls agree. |
| M-1 inbox publication and lifecycle | Partly closed | Early launch ID, held lines, framing, cursor, bounds, archive visibility and worker epoch checks are specified. The legacy eligibility contradiction and remaining lifecycle boundaries are M-1 below. |
| M-2 association crash recovery | Partly closed | Durable intent, adopt-on-retry and launch-identity CAS fix serial crash recovery, including harmless PR/status updates. Concurrent abandon/resume corrupts the published association; new B-2. |
| M-3 holds and quarantine reconciliation | Partly closed | Own release after a proven stop and conservative changed-identity classification are correct. RO's replacement for quarantine reconciliation is still insufficient; M-3. |
| M-4 Herdr stop outcomes | Partly closed | Creation-server identity, per-connection checks and the negative-evidence table answer the original protocol omissions. The ID grammar and executable qualification differ from the required protocol; M-4. |
| m-1 explicit any types | Closed | Commit 49b3b426 changes only two adapter argument types to unknown[]. No assertion changes; own typecheck/lint and the unchanged 3-red/1-control result confirm it. |

## New findings

### B-1 — RW can admit an old orphaned record writer

**Design:** sections 4.3 steps 3–5, 8.1 steps 5–10, and the RW claim in 8.2. **Code:** packages/core/src/agent-workspace-hooks.ts:330 (copy/edit), :345 (mv), :418 (wrapper sources the helper), :435 (calls the in-memory function); planned core/src/writer-drain.ts. No drain implementation exists at this head.

The group rule needs an observed old-inode process to seed the group. Recording file inodes before installation does not record any process group. If the wrapper dies before the first scan while its mv remains, the wrapper's fd is gone and the child has no fd on any recorded wrapper/helper inode. Its parent is now 1. The first scan knows neither its parent nor its group provenance. Repeating that empty scan cannot recover the missing observation.

Own measurement uses the shipped GH_WRAPPER and AO_METADATA_HELPER, a scratch real-gh response and an mv shim held immediately before rename. This is the author's supported case C, moved before the first scan. The observer tracks PIDs for cleanup only, not as algorithm input:

~~~text
first and second hits: [[],[]]
first and second drain members: [[],[]]
old mv: pid 2941057, ppid 1, pgid 2940998, state S
Node writes runtimeHandle=new, generation=2
release old mv
record: runtimeHandle=old, generation=1, pr=https://github.com/org/app/pull/7
~~~

The orphan stays in its original group. No setsid/double-fork escape by a hook is involved. The author's t5 C first computes the drain set, then kills the wrapper; its successful group lookup relies on knowledge the real first scan may never obtain. Own normal t5 B does pass, so the inode improvement is useful but insufficient.

**Required:** define a drain with a complete starting set before claiming admission is safe. For example, fence new entries into old writer code and conservatively retain the relevant live agent/tool groups until every potentially old writer has completed, including pre-existing orphans. A scan-before-install alone still needs to account for starts/deaths between scans. If provenance cannot be established, keep admission closed rather than treating empty inode scans as proof. Preserve PID/start-tick checks and do not solve this by signalling unrelated processes.

Acceptance needs the exact first-scan case above, a child born between polls just before parent death, and a running old-code process with its source fd closed. The latter is precisely why an inode observation is only a seed, not proof that no old code remains.

### B-2 — An abandoner can clear a completed association

**Design:** sections 3.2–3.5; R2b-2 is intentionally before the R3a operation lock. **Code:** packages/core/src/metadata.ts:331 (launch identity), :636 (conditional update); planned runtime-identity/retained-inventory and CLI association paths. Real tmux forms are in design section 15, associateR4/clearR4.

Each tmux CAS is atomic, but the tmux change plus record publication is not serialized with another recovery. This schedule requires no external actor:

1. A reads intent T for abandon and pauses before the exact clear.
2. B resumes that intent, sets/adopts T, and successfully publishes runtimeAssociation=T while removing associationIntent.
3. A's exact tmux clear still matches server/PID/session/pane/T and unsets T.
4. A's record CAS fails, too late to undo step 3.

Own private-tmux run: B printed ao-assoc, A printed ao-assoc-cleared, A's record comparison was false, the published record still named T, and tmux's token was empty. A following legacy empty-token guard printed legacy-mutation-allowed. The record part is an explicit state-machine stand-in because these commands do not exist yet; the set/adopt/clear/guard operations are real tmux.

There is also the inverse ordering: A clears T; a paused resumer sets it again from the old intent; A removes the intent; the resumer's final CAS fails. This can create the allegedly same-uid-only “foreign token” without any user edit.

**Required:** serialize all transitions affecting this association before R2b-2 ships: resume, abandon, clear-token, ordinary stop/restore/retire, and retained-entry variants. Move the necessary per-ID operation-lock subset earlier, or specify a durable fenced transition protocol that prevents stale tmux side effects. A record CAS after the clear, or another unfenced preflight read, cannot fix it. Tests must pause independent operations on both sides of the tmux call and record CAS. Serial crash-point tests alone are insufficient.

The serial crash table otherwise improves substantially: intent-before-token, adopt after a lost answer, strict evidence recheck, exact clear and PR-insensitive launch identity all make sense. An evidence mismatch must leave an explicit recoverable state; do not discard its intent while another operation can still apply it.

### B-3 — Intended-store holds do not protect actual OpenCode reuse

**Design:** sections 6.2, 6.3 and 8.2 (“continuity, not data”). **Code:** packages/plugins/agent-opencode/src/index.ts:1084–1088; packages/core/src/opencode-api.ts:285, :826, :843, :852. The existing-session path changes model/agent before launch, and the launch command at agent-opencode/src/index.ts:1043 can submit a prompt.

Removing remove/interrupt does close the previous deletion counterexample. It does not make reuse read-only. The intended store A can have no holder while the selected service uses store B, where another live AO session holds the same S. Model/agent switches and prompts then modify B's live session without reading B's hold or taking B's lock. This can interleave another agent's conversation and change its behavior, not merely lose continuity.

Own deterministic stand-in experiment calls the shipped switchOpenCodeSessionAgent and real execFile transport with XDG_DATA_HOME pinned to scratch A. Only the executable named opencode on scratch PATH is a stub; it routes to scratch B:

~~~text
intended store A held: false
actual store B live hold remains: true
actual store B mutation:
["api","session.switchAgent","--param","sessionID=ses_shared","-d","{\"agent\":\"build\"}"]
~~~

No real OpenCode or model ran. The repo's measured API note also records that switchAgent enqueues a synthetic steer input (development/0009_opencode_2x_api_fit_design.md:203), so “no data is lost because no removal” does not imply isolation from another holder.

**Required:** keep the no-remove/no-interrupt refusal, and refuse existing-S reuse when actual transport/store ownership is unproved. Allow it after a qualified binding and actual-store hold check. Cover model/agent switches, prompt admission and TUI attach, not only deletion. A fresh session is an alternative only if its later operations are guaranteed to reach the service that created it. Holding a lock for the environment's intended directory cannot establish that guarantee.

R3b retains the earlier decision's store-resident namespace. The changed assumption is that an intended store can substitute for the actual serving store. It cannot provide the earlier reuse exclusivity claim; see the OD table.

### M-1 — RW's legacy eligibility and lifecycle boundaries remain incomplete

**Design:** sections 4.2, 4.4–4.6 and 8.1. **Code:** packages/core/src/metadata.ts:845 (reservation), packages/core/src/session-manager.ts:2378 (spawn reservation), :4306 (restore publication), and the planned core/src/inbox.ts. These are design defects, not assertions about an implemented applier.

The decisive contradiction is step 3 of applyInbox: return unless launchState is published. Pre-RW records have no launchState or launchId. The barrier creates legacy.ndjson, but never migrates their launchState. Thus step 4's legacy-file branch is unreachable for the live legacy fleet. Its new shell writers append successfully while no poll or command applies the lines.

Make eligibility explicit: a strictly valid pre-RW record follows the legacy branch; a new launch applies only when published. Test a real pre-RW record after the barrier, including a subsequent new launch that must reject its old legacy lines.

The same round must finish these stated lifecycle promises:

| Boundary | Remaining requirement |
| --- | --- |
| preparing to published/failed | Reservation plus O_EXCL inbox creation are two filesystem operations. Specify recovery if either is durable alone. Publication must consume a defined complete prefix while leaving later appends pending; a failed launch must remain visible and must never apply its held updates to a replacement. |
| bounded catch-up | Sixteen 64-KiB reads need not consume a sub-1-MiB file because a chunk can stop before an incomplete record. With 2100-byte lines, each read consumes 31 lines; 499 lines fit below 1 MiB, but 16 calls consume only 496. If “more” remains, refuse/defer the decision or continue under an explicit bound; do not proceed using stale metadata. |
| archive | Moving the inbox directory and moving the record are two renames. “Same archive step” is not a crash protocol. Define which state identifies an interrupted move and how a later invocation finds the moved inbox without discarding its cursor/lines. |
| check then append | The measured shell open uses O_CREAT. A writer can pass -f, pause through archive and a new same-ID directory creation, then create its old L.ndjson inside the new active directory. It is neither an archived late append nor an append to orphans.ndjson. Account for/list this obsolete launch file, and handle open failure after the existence check. |
| cap and backlog | The 1-MiB check is a soft concurrent bound: writers can all pass it before appending. It also counts consumed history, so even with a healthy applier a long launch eventually refuses all future metadata updates. Keep that operational cost visible; no silent promise of indefinite tracking. |

Own t6 confirms one bash write through 4096 bytes, two at 4097, all 255 non-NUL byte encodings, and 2000/2000 well-formed concurrent records. The proposed 4000-byte ceiling is conservative on this qualified bash/Linux combination. RS plus hex is a sound way to isolate a partial append from the next complete line; add tests at a chunk boundary and for an oversize damaged fragment so it cannot pin the cursor forever. The source-byte encoding tests are not an implemented inbox parser test.

The per-launch files, launch ID before pane start, strict inode cursor, no application of archived late lines, and epoch recheck before a worker write are good choices once these edges are specified. Existing withRecordLock is reentrant for the same thread/record (metadata.ts:292); the archive's nested applier does not by itself imply a self-deadlock.

### M-2 — The leader exits at the exact point it is supposed to pin the group

**Design:** section 5.2, not the escape exclusions of 5.4. **Code:** planned core/src/mutating-child.ts; current mutating hooks are packages/plugins/workspace-worktree/src/index.ts:343. Exact proposed shell command is quoted in design 5.2.

The leader traps TERM with “:”, runs the command, prints rc, then performs an unchecked read for done. A trapped signal interrupts that read. The next instruction exits with the command's rc. Production step 3 sends TERM after receiving rc, exactly when the leader can be in this read.

Own run uses a command that returns 0 while its child remains in the original process group and ignores TERM. There is no detached child or daemon escape:

~~~text
command completion: rc=0
after TERM while leader read(done): leader exit = 0; child state = S
per section 5.2 group KILL allowed: False
~~~

The journal should keep subsequent operations busy, so this is not proof of a wrong-group signal. It is a failure to complete/drain a supported command. For a plain completed command with no residual child it can also close the done pipe before the supervisor writes. The author's s2 sends TERM while the leader is waiting for the command, which exercises a different shell wait.

There is a second protocol issue: command stdout shares the completion channel. In the own probe the command prints rc=0 then sleeps; that line is indistinguishable from the leader's completion record and arrives while the command is running.

**Required:** a leader whose control wait survives signals until an explicit release or real EOF, plus a private framed status channel unavailable to command stdout. Keep command stdin separate from supervisor control. Test TERM before go, during the command, after rc, during done wait, repeated TERM, signal-resistant same-group descendants, forged status-looking output and supervisor death.

The strict journal schema, random entry names, unknown/malformed => busy, two-scan zombie-only rule, and never signalling a group after the leader is reaped are otherwise good corrections. I did not force kernel PID reuse; no successful namespace probe is claimed. The kernel-identity argument still requires the leader to remain alive as specified. Marker scans remain diagnostics under OD-14, not complete escape detection.

The prescribed operation → store → record ordering prevents the stated cycle if every acquisition uses the ALS checks. Forwarding the operation token and forbidding a second operation lock remove self/cross-session waits. Preserve the earlier counted-release behavior. Thenable rejection detects a programming error; it cannot cancel work an erroneous callback already started, so call-site/type enforcement remains necessary. The link-based complete .ao-owner publication, strict reads, canonical actual path and refusal at direct destructive plugin entry points are correct.

### M-3 — Runtime exit or an idle read is not completion of a service request

**Design:** sections 6.1 and 6.5. **Code:** packages/core/src/opencode-api.ts:285 (client process), :672 (interrupt), :1111 (prompt); packages/plugins/agent-opencode/src/index.ts:1043 (TUI launch). Relevant repository evidence: development/0009_opencode_2x_api_fit_design.md:99 and :213.

The documented architecture is a background service plus a TUI client. A prompt durably schedules a server-side agent loop. Stopping the pane proves that the client ended; the design provides no evidence that it ends a running service loop. Therefore 6.1's “no interrupt is needed” and 6.5's “an interrupt has no effect after the agent ended” cannot use runtime stop as that proof.

RO also proposes clearing an interrupt quarantine after a bound read says idle. A valid counterexample is:

1. An interrupt was sent but its response was lost; its local client ends.
2. The bound service answers a separate read as idle while the interrupt remains pending.
3. AO clears quarantine, releases the store lock and admits reuse/prompt for S.
4. The old interrupt completes against the new activity.

Binding answers the destination question; it does not order request completion. This is a protocol counterexample, **not a claim that a particular delay was measured in real OpenCode**. No real service was invoked.

**Required:** qualify an authoritative request-completion/cancellation fence, or keep quarantine and refuse reuse until an operator resolves it with sufficient evidence. An idle snapshot or a local PID's absence is insufficient. R3b may leave data stored, but it must also retain a conservative “service work unconfirmed” state if it cannot prove quiescence before destructive worktree cleanup or hold release. Explain that cost instead of claiming the pane stop supplies it.

RO-1 and RO-2 are sensible qualification candidates, not yet qualified guarantees. Each must test per-request identity, service substitution during the call, local child death, remote completion after timeout, all relevant mutators, and retries/reconciliation. RO-3 explicitly has a TOCTOU gap; before/after server.info cannot be described as bound. It is a separate owner-accepted weaker mode, not a passing route to the same guarantee. Optional RO is NOT-SOUND as currently specified, while the no-remove/no-interrupt choice itself remains correct.

R3b's held/releasing own-release order is reasonable once remote activity is accounted for. Preserve the inherited store lock across hold claim and record publication; otherwise the new “missing record => stale” rule can discard an in-progress claim. Participant registration/backfilled changes need a common atomic lock across S values, not independent per-S read/modify/writes of one participants.json. These are explicit acceptance conditions; no separate unmeasured race is counted here.

### M-4 — RH's ID qualifier rejects emitted IDs; h5 is weaker than its outcome table

**Design:** sections 7.1–7.3. **Code:** packages/plugins/runtime-herdr/src/index.ts:265 (create), :277 (root-pane identity), :326 (destroy); planned socket client. Prototype: /tmp/aosd4/scripts/h5_herdr_stop_outcomes.py, incarnation and stop/recorded_gone.

The new ID check allows only decimal workspace/pane components. The isolated 0.8.0/protocol-19 server emitted:

~~~text
w9:p1   matches
wA:p1   does not match
wB:p1   does not match
wC:p1   does not match
~~~

This fails normal operation beyond nine workspaces, not just malformed-input cases. Qualify the server's actual complete grammar (including the pane counter) rather than widening it speculatively. Preserve fail-closed validation before treating pane_not_found as absence.

The h5 helper does not execute that validator at all, so its healthy close cannot catch this defect. It also treats any OSError reading /proc as “recorded server gone”, and when a different peer answers an unrecognized error after that, returns absent. Its no-connection branch is broader than the table's ENOENT/ECONNREFUSED. Section 7.2 correctly requires unknown for these uncertainties; the copied prototype's normal outcomes do not qualify the missing cases.

**Required:** test the exact production parser/outcome classifier for EACCES, malformed/partial responses, missing fields, unrecognized errors, nonexistence versus unreadability, peers changing on each of the three connections, and actual emitted nondecimal IDs. Do not port h5's catch-all absence logic. These are bounded corrections to a sound incarnation protocol, hence SOUND-WITH-CHANGES for RH.

Own h5 reproduced: own close => destroyed; repeat => absent; wrong terminal => other-launch; restart => other-launch; moved socket while recorded server lives => unknown and zero close; restoration of the original path => destroyed. Config disabling both update checks existed before every server start. Full strace, with ongoing monitoring, showed zero AF_INET/AF_INET6 connects and zero /home paths. The author's earlier network run is disclosed in its report; it was not repeated.

## Round claims, dependency and rollout review

| Round | Assessment of section 8.2 |
| --- | --- |
| R2a / R4 | R4 remains accepted. “R2a (live)” must be read as “once landed”; neither R2a nor ao-54 had landed at this review. I did not re-review their pending changes. |
| RW | Own-launch inbox isolation is a good target, but B-1 disproves the claimed barrier and M-1 prevents legacy delivery. Do not deploy the current drain as sufficient. |
| R2b-1 | Guard claim is supported, with the explicit R-1/OD-23 exception. Legacy-to-tokenless provenance remains unproved until R2b-2 and is correctly disclosed. |
| R2b-2 | Serial recovery is improved; concurrent recovery is not safe without B-2's earlier serialization. |
| R3a | The journal/lock/owner-marker claims are defensible under the narrowed scope. The concrete leader does not implement the promised normal drain. |
| R3b | No unbound deletion/interrupt is true. Reuse protection is not actual-store protection, and the cost exceeds inert garbage/continuity; B-3 and M-3. |
| RH | Incarnation and negative evidence are correct in the design table, after M-4's qualification fixes. Hidden-server unknown is the right conservative result. |
| RO | Qualification is a prerequisite, not evidence already obtained. Destination binding and remote request completion both need proof. |

The barrier correctly closes admission before stopping exact resident worker PIDs, records old AO trees first, installs wrappers/hooks by rename, raises the epoch after the round, restarts workers and checks hashes again. No barrier step was executed on the real fleet. R2a and R4 have no epoch; they require a real drain, and raising a number cannot replace it. Epoch checks on every worker record write fix the earlier status-write omission. A primary-checkout command-line check is only a diagnostic: the admission/drain inventory must cover every admitted old CLI build/entry point, not assume another checkout cannot run it.

Once B-1 is repaired, the barrier must also initialize legacy inbox eligibility and recover interrupted publication/archive states before opening admission. Two healthy worker polls cannot prove those safety properties. Owner-marker backfill must finish before R3a admission, and every declared participant must complete store backfill before R3b reuse.

**Plan changes:** move association serialization into/before R2b-2; add the first-scan orphan case to RW; replace the leader and expand its tests in R3a; gate existing-session reuse on qualified binding; distinguish service quiescence from runtime stop; complete RH grammar/error qualification. RW calls “under its operation lock” before R3a exists: state which RW flows rely only on record CAS/lock at that intermediate deployment and supply the archive/reservation protocol they need.

R2b-1's ao-54 dependency is necessary and its source inventory covers the current direct paths, including raw core helpers and late Enter retries. It is complete as a prerequisite only if the final landed send implementation is re-inventoried: all resulting C-u/Escape, paste, Enter, retry and attach paths must go through the effective identity resolver and shared guard. Tests must exercise those production callers and real healthy legacy behavior. Do not merge an old line-number patch across ao-54 and assume the coverage stayed complete.

## New tests and limits of a green result

Own commands: sanitized frozen offline install, build, then SAME_ID_DEFECTS=red pnpm --filter <package> exec vitest run <file>. Core r4: 3 failed/3 passed; runtime-tmux r4: 3 failed/6 passed. Each failure was its intended behavioral assertion, with no setup failure. Herdr r3: 3 failed/1 passed. Total selected: 19 tests, 9 expected behavioral failures, 10 controls. Typecheck passed. Lint passed with the same five warnings in unchanged files. I did not repeat the entire monorepo test suite for a documentation-only review; the author's full-run claims remain author evidence.

| New defect test | Actual red assertion | Wrong/partial change that can make it green |
| --- | --- | --- |
| core r4: “a Node write after the barrier installed a new helper is kept against a wrapper that started before” (:177) | old rather than new runtimeHandle | A helper that never writes at all, or newly exported inbox code with no rollout drain. The test imports the current helper, so after RW it needs a frozen pre-RW writer fixture plus the real drain; merely adding a drain around a new helper does not test migration. |
| core r4: “a branch that the pane records while its launch is still preparing is in the record after the spawn” (:271) | session/app-1 rather than feat/agent-switched | Preserve the existing branch during publish while omitting launchId isolation, failed-state handling, restore, framing, cursor and archive semantics. |
| core r4: “a kill with purge sends no removal to a store whose namespace holds a live holder of the session” (:397) | store B removed-ses_shared exists | Remove only the interrupt: its stub is what flips routing from A to B. An unbound removal then still hits A and this test passes. Also, abort cleanup entirely. Assert zero remove AND zero interrupt across all R3b callers, plus successful AO cleanup/kept-session notice when appropriate. |
| tmux r4: “destroy with a legacy handle keeps a later launch that carries a launch token” (:264) | token session deleted | A client-side token preflight passes this static schedule; a blanket refusal also passes. Neither proves atomic guarded legacy functionality. |
| tmux r4: “sendMessage with a legacy handle gives a later token launch no keys” (:281) | text and Enter reached the pane | Same preflight or blanket refusal; this one schedule does not cover mid-send replacement, long paste, CLI retries or attach. |
| tmux r4: “destroy with the legacy handle keeps its session while a token that no record names is on it” (:302) | session deleted | Refuse any token without providing association recovery. It is the safety half of M-2, not a resume/abandon test. |

The six tmux controls use local copied builders. Moving them into exported production builders, as section 13.6 proposes, is necessary, but still add healthy legacy calls through the plugin/core/CLI APIs: a plugin that always refuses legacy calls can coexist with perfectly correct builder controls. Add the author's 200-iteration real race and deterministic pauses at every production mutation boundary. The current tests are valuable red reproducers; they are not acceptance coverage for all of the new design.

## Owner decisions

| Decision | Recommendation | Reason / limit |
| --- | --- | --- |
| OD-22 | (a), with reuse and request-lifetime qualifications above | Keep no unbound remove/interrupt. Qualify RO-1 or RO-2 before enabling actual-store reuse/destruction. RO-3 is explicitly weaker and must not count as bound. Preserving inert records is an acceptable cost; claiming every kept service session is inert is not. |
| OD-23 | (a) | The measured empty pane option can defeat the legacy guard, but creating it deliberately requires the same uid's tmux control. Accept this within the already stated record/tmux integrity trust boundary and document it. It is not a reason to undo OD-18(a). |
| OD-24 | (a) | A hidden live creation server must remain unknown. Retaining resources until the owner repairs the socket is correct; optional RH can stay off meanwhile. |

No decided containment, tmux naming, legacy-send, inbox or namespace choice needs to be reopened. The new r4 substitution of the **intended** store for the **actual** store weakens the precondition of already decided reuse/OD-21. Bring that changed precondition back to the owner as part of OD-22: preserve the existing exclusivity choice by deferring reuse until qualified, or explicitly accept cross-holder mutations. My recommendation is deferral, not a different namespace location. No approval was assumed or requested during this review.

## What is correct

- Atomic guarded legacy kill/send/attach and capability sentinels work on tmux 3.4, including the tokenless positive path. No ordinary replacement interleaving defeated the single-command guard in the own run.
- Early launch IDs, per-launch files, RS/hex framing, strict cursor identity, and applying through the record lock are a useful replacement for shell sed/mv writers.
- Intent-before-token and adopt-on-retry solve serial association crashes; comparing launch identity instead of generation avoids rejecting harmless PR/status writes.
- Strict journal recovery, zombie handling, monotonic epoch checks, explicit lock order and complete owner-marker publication improve the narrowed R3a design.
- Refusing unbound remove/interrupt is the right answer to the original wrong-store deletion. Held/releasing reconciliation is substantially clearer.
- Herdr's creation incarnation, three peer checks and conservative hidden-server result are the right basis for optional RH.

## Retained evidence and cleanup

The review preserves the own counterexample scripts below; the author's scripts remain in read-only /tmp/aosd4 and are also embedded in design section 15. Reviewer copies changed all scratch/server names to aosdr4 and the import worktree to ao-51. The author report was read only after the independent closure and legacy-guard assessment above. No source file or earlier review was changed.

### Own counterexample sources

Run at review head 13c58b2c after building. These are scratch experiments, not production changes. All commands use the empty environment shown above; tmux only uses the private aosdr4 names. The first-scan and association scripts reuse the author's helper functions but change the schedule described in B-1 and B-2. The record CAS in the association script is explicitly modeled.

#### rw-first-scan.mjs

~~~js
// t5 (review r3 B-1, design r4 section 4.3): which processes still run old record-writer code after the
// RW barrier installs new wrapper files? The shipped GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER and the
// Claude METADATA_UPDATER_SCRIPT of the build at c8a35d47 run under bash with scratch values only. Run:
//   env -i HOME=/tmp/aosdr4/home PATH=/tmp/aosdr4/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr4/tmp \
//     SHELL=/bin/sh node /tmp/aosdr4/scripts/t5_wrapper_drain.mjs
//  A. the review's case: `gh pr create` through the wrapper; the helper file is replaced while real gh
//     runs. The command line, the open descriptors, the inode rule, the process tree, the lost write.
//  B. the same case with the drain of design r4: the Node write waits until the old writer set is empty.
//  C. a wrapper killed while its `mv` child waits: the child loses its parent but keeps its process group.
//  D. the Claude hook: its command line, its open descriptor; an in-place rewrite of the running hook
//     file against a rewrite by rename.
//  E. the git wrapper: `git checkout -b` in a scratch repository.
// The fd scan reads /proc/<pid>/fd only for the processes that this script started (descendants and
// members of their process groups); /proc/<pid>/stat is read for every process, as `ps` does.
// Every started PID goes to /tmp/aosdr4/logs/pids.txt; the script stops each by its exact PID.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync,
  statSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const WT = "/home/taisung/.worktrees/agent-orchestrator/ao-51";
const { GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER } = await import(`${WT}/packages/core/dist/agent-workspace-hooks.js`);
const { METADATA_UPDATER_SCRIPT } = await import(`${WT}/packages/plugins/agent-claude-code/dist/index.js`);
const S = "/tmp/aosdr4";
const root = `${S}/rw-first-scan`;
rmSync(root, { recursive: true, force: true });
for (const d of ["bin", "real", "sessions", "home", "ws/.claude", "repo"]) mkdirSync(`${root}/${d}`, { recursive: true });
const record = `${root}/sessions/app-1`;
const started = new Map();
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, { what, start: stat(pid)?.start });
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t5 ${what} pid=${pid}\n`);
}
const show = (l, v) => console.log(`  ${l.padEnd(66)} ${v}`);
const env = { HOME: `${root}/home`, PATH: `${root}/bin:/usr/bin:/bin`, GH_PATH: `${root}/real/gh`, AO_STATE_ROOT: root,
  AO_DATA_DIR: `${root}/sessions`, AO_SESSION: "app-1", TMPDIR: `${S}/tmp`, LANG: "C" };
const writeAtomic = (path, text, mode) => { writeFileSync(`${path}.new`, text, { mode }); renameSync(`${path}.new`, path); };
const inode = (path) => { const s = statSync(path); return `${s.dev}:${s.ino}`; };
function install() {
  writeAtomic(`${root}/bin/gh`, GH_WRAPPER, 0o755);
  writeAtomic(`${root}/bin/git`, GIT_WRAPPER, 0o755);
  writeAtomic(`${root}/bin/ao-metadata-helper.sh`, AO_METADATA_HELPER, 0o644);
  writeAtomic(`${root}/ws/.claude/metadata-updater.sh`, METADATA_UPDATER_SCRIPT, 0o755);
}
// The new build of the barrier: here the same wrappers with a no-op helper (the review's replacement).
function installNew() {
  writeAtomic(`${root}/bin/ao-metadata-helper.sh`, "update_ao_metadata() { :; }\n", 0o644);
  writeAtomic(`${root}/bin/gh`, GH_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
  writeAtomic(`${root}/bin/git`, GIT_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
}
function hold(name) {
  // A shim first on PATH: it marks that it runs, then waits for a release file.
  writeFileSync(`${root}/bin/${name}`, `#!/bin/bash\ntouch '${root}/${name}-reached'\nwhile [ ! -e '${root}/${name}-release' ]; do sleep 0.02; done\nexec /usr/bin/${name} "$@"\n`, { mode: 0o755 });
}
function reset() {
  for (const f of ["loaded", "release-gh", "mv-reached", "mv-release"]) rmSync(`${root}/${f}`, { force: true });
  rmSync(`${root}/bin/mv`, { force: true });
  writeFileSync(record, `worktree=${root}/repo\nbranch=main\nruntimeHandle=old\ngeneration=1\n`);
}
writeFileSync(`${root}/real/gh`, `#!/bin/bash\ntouch '${root}/loaded'\nwhile [ ! -e '${root}/release-gh' ]; do sleep 0.02; done\nprintf 'https://github.com/org/app/pull/7\\n'\n`, { mode: 0o755 });
async function waitFile(f, ms = 4000) { for (let i = 0; i < ms / 10; i++) { if (existsSync(f)) return true; await sleep(10); } return false; }

// /proc/<pid>/stat: comm in parentheses, then state ppid pgrp session ... starttime (field 22).
function stat(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return { pid: Number(pid), state: f[0], ppid: Number(f[1]), pgid: Number(f[2]), sid: Number(f[3]), start: Number(f[19]) };
  } catch { return null; }
}
const allStats = () => readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(stat).filter(Boolean);
const args = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); } catch { return "?"; } };
function descendants(pids, stats) {
  const out = new Set(pids);
  for (let grew = true; grew; ) { grew = false; for (const s of stats) if (!out.has(s.pid) && out.has(s.ppid)) { out.add(s.pid); grew = true; } }
  return out;
}
// The candidates for the fd scan: the processes that this script started, their descendants, and the
// members of their process groups (the product scans every process of the uid).
function candidates(stats) {
  const mine = descendants([process.pid], stats);
  const groups = new Set([...mine].map((p) => stats.find((s) => s.pid === p)?.pgid).filter((g) => g && g !== process.pid));
  for (const s of stats) if (groups.has(s.pgid)) mine.add(s.pid);
  mine.delete(process.pid);
  return mine;
}
// The inode rule of design r4 4.3: a process with an open descriptor on an OLD inode of a writer file.
function findOld(oldInodes) {
  const stats = allStats();
  const hits = [];
  for (const pid of candidates(stats)) {
    let fds; try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let st; try { st = statSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (oldInodes.has(`${st.dev}:${st.ino}`)) { hits.push({ pid, fd, link: readlinkSync(`/proc/${pid}/fd/${fd}`) }); break; }
    }
  }
  return { hits, stats };
}
// The drain set: each hit, its descendants, and its process group; with the start ticks of each.
function drainSet(oldInodes) {
  const { hits, stats } = findOld(oldInodes);
  const tree = descendants(hits.map((h) => h.pid), stats);
  const groups = new Set(hits.map((h) => stats.find((s) => s.pid === h.pid)?.pgid));
  const procs = stats.filter((s) => tree.has(s.pid) || groups.has(s.pgid)).map((s) => ({ ...s, args: args(s.pid) }));
  return { hits, procs, groups };
}
const nameRule = (a) => /metadata-updater\.sh|ao-metadata-helper\.sh/.test(a); // the rule of design r3 5.6
const uptimeTicks = () => Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 100);

try {
  console.log("== G. wrapper dies BEFORE the first inode scan, no known group seed");
  install(); reset(); hold("mv");
  const old = new Set([`${root}/bin/gh`, `${root}/bin/git`, `${root}/bin/ao-metadata-helper.sh`].map(inode));
  const w = spawn(`${root}/bin/gh`, ["pr", "create"], {env, stdio:"ignore", detached:true});
  track(w.pid, "G wrapper");
  const done = new Promise(r=>w.once("exit",(c,s)=>r(s??c)));
  await waitFile(`${root}/loaded`); writeFileSync(`${root}/release-gh`, "");
  await waitFile(`${root}/mv-reached`);
  // Observer records PIDs ONLY for cleanup; these are NOT supplied to the drain algorithm.
  const observation = allStats().filter(s=>s.pgid===w.pid);
  for(const p of observation) track(p.pid,"G cleanup only");
  const mv = observation.find(p=>args(p.pid).includes(`${root}/bin/mv`));
  if(!mv) throw new Error("shim not reached");
  process.kill(w.pid,"SIGKILL"); await done; await sleep(100);
  installNew();
  const first = drainSet(old); await sleep(100); const second = drainSet(old);
  show("first and second hits",JSON.stringify([first.hits,second.hits]));
  show("first and second drain members",JSON.stringify([first.procs,second.procs]));
  show("live old mv (pid/ppid/pgid)",JSON.stringify(stat(mv.pid)));
  writeFileSync(record, `worktree=${root}/repo\nbranch=main\nruntimeHandle=new\ngeneration=2\n`);
  writeFileSync(`${root}/mv-release`, ""); await sleep(300);
  show("record after empty-scan admission and old mv",JSON.stringify(readFileSync(record,"utf8")));
} finally {
  for (const f of ["release-gh", "mv-release"]) writeFileSync(`${root}/${f}`, "");
  await sleep(300);
  // Only a PID whose start ticks are still the recorded ones (never a reused PID).
  for (const [p, { start }] of started) if (start !== undefined && stat(p)?.start === start) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(100);
  const left = [...started].filter(([p, { start }]) => start !== undefined && stat(p)?.start === start && stat(p)?.state !== "Z").map(([p]) => p);
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}`);
}
~~~

#### association-race.mjs

~~~js
// t4 (review r3 B-4, OD-18 (a) with the atomic no-token check, M-2): forms of design r4 on private
// tmux 3.4 servers (-L aosdr4-assoc-a, aosdr4-assoc-b, aosdr4-assoc-r only). Run under the scratch environment:
//   env -i HOME=/tmp/aosdr4/home PATH=/tmp/aosdr4/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr4/tmp \
//     SHELL=/bin/sh TERM=xterm-256color node /tmp/aosdr4/scripts/t4_legacy_guard_assoc.mjs
//  1. the review's B-4: a legacy kill by name ends a later launch that has a token.
//  2. the legacy guard: the token guard of design r3 2.3 with an EMPTY expected token. It mutates
//     only a session without a token (kill, a paste of the message, Enter), in one client command.
//  3. a race: a racer replaces R with a token launch or a tokenless launch between client commands.
//     The legacy guard (one command) against a client-side preflight read plus a kill (two commands).
//  4. M-2: the association of design r3 (empty token only) against the association of design r4
//     (the server PID, $N and pane_pid inside the check; a retry with the intent's token adopts it;
//     a guarded clear removes exactly that token). Also: `$` in a branch, and `#{s/^.//:session_id}`.
//  5. the legacy attach through the legacy guard, on the terminal of `script`.
//  6. R-1: a pane option @ao_launch "" shadows the session's token for the legacy guard.
// Every server, pane, racer and client PID goes to /tmp/aosdr4/logs/pids.txt; the script stops each
// by its exact PID and removes only the sockets that it created.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosdr4";
const A = "aosdr4-assoc-a", B = "aosdr4-assoc-b", R = "aosdr4-assoc-r";
const sockOf = (srv) => `/tmp/tmux-${process.getuid()}/${srv}`;
for (const srv of [A, B, R]) if (existsSync(sockOf(srv))) throw new Error(`${sockOf(srv)} exists: not started by this script`);
const started = new Map();
const ownSockets = new Set();
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, what);
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t4 ${what} pid=${pid}\n`);
}
function tm(srv, args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", srv, ...args], { encoding: "utf8" });
  if (existsSync(sockOf(srv))) ownSockets.add(srv);
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
function remember(srv) {
  const pid = Number(tm(srv, ["display-message", "-p", "#{pid}"]).out);
  if (pid) track(pid, `tmux server ${srv}`);
  for (const p of tm(srv, ["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter(Boolean)) track(Number(p), `pane on ${srv}`);
}
function show(label, r) {
  const o = typeof r === "string" ? r : `exit ${r.code} | out ${JSON.stringify(r.out)} | err ${JSON.stringify(r.err)}`;
  console.log(`  ${label.padEnd(72)} ${o}`);
}
const token = () => randomBytes(16).toString("hex");
const q = (fmt) => `"${fmt}"`;
const has = (srv, name) => tm(srv, ["has-session", "-t", `=${name}`]).code === 0;
const tokOf = (srv, name) => tm(srv, ["display-message", "-p", "-t", `=${name}:`, "#{@ao_launch}"]).out;
function createArgs(name, tok, cmd = "/bin/sleep 600") {
  const base = ["new-session", "-d", "-P", "-F", "ao-created:#{pid}|#{session_id}", "-s", name, "-c", `${S}/home`, cmd];
  if (!tok) return base;
  return [...base, ";", "set-option", "-t", `=${name}:`, "@ao_launch", tok,
    ";", "display-message", "-p", "-t", `=${name}:`, "ao-token:#{session_id}|#{@ao_launch}"];
}
// The guard of design r3 section 2.3. With tok = "" it is the legacy guard of design r4 section 2.2:
// the TRUE branch runs only for a session whose @ao_launch is empty or unset.
function guardArgs(name, tok, mutation, after = "") {
  const tail = after ? ` ; ${after}` : "";
  const refused = `display-message -p ${q("ao-refused:#{pid}")}${tail}`;
  const kept = `display-message -p -t =${name}: ${q("ao-kept:#{pid}:#{session_id}")}${tail}`;
  const done = `${mutation} ; display-message -p ${q("ao-done:#{pid}")}`;
  const inner = `if-shell -F -t =${name}: ${q(`#{==:#{session_name}/#{@ao_launch},${name}/${tok}}`)} { ${done} } { ${kept} }`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}
// Design r3 section 2.9: a token only for the audited pane_pid of a session without a token.
function associateR3(name, panePid, tok) {
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p ${q("ao-assoc:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q("ao-assoc-refused:#{pid}:#{pane_pid}:#{@ao_launch}")}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:#{session_name}/#{pane_pid}/#{@ao_launch},${name}/${panePid}/}`)} { ${set} } { ${no} }`);
}
// Design r4 section 3.2: the server PID, the session name, the number of $N, the pane_pid and the token
// are compared inside tmux. An empty token: set the intent's token. The intent's token: adopt it (a
// retry after a lost answer or a failed record step). Else: refused, with the values that tmux sees.
const IDENT = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}";
function associateR4(name, ev, tok) {
  const want = `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}:#{session_id}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}:#{session_id}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}/${tok}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}/}`)} { ${set} } { ${second} }`);
}
// Design r4 section 3.2: the owner-approved clear of exactly the intent's token.
function clearR4(name, ev, tok) {
  const want = `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}/${tok}`;
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}:#{session_id}:[#{@ao_launch}]")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}}`)} { ${clear} } { ${no} }`);
}
function evidence(srv, name) {
  const [serverPid, sid, panePid] = tm(srv, ["display-message", "-p", "-t", `=${name}:`, "#{pid}|#{session_id}|#{pane_pid}"]).out.split("|");
  return { serverPid, sid, panePid };
}
function marks(r) {
  return r.out.split("\n").map((l) => l.split(":")[0]).join(",") + ` exit=${r.code}`;
}

try {
  tm(A, createArgs("legacy", "")); remember(A);
  const ev=evidence(A,"legacy"), T=token();
  let record={associationIntent:T,runtimeAssociation:""};
  const staleAbandonIdentity=JSON.stringify(record);
  console.log("A abandon read intent; paused before exact clear");
  show("B resume sets token",tm(A,associateR4("legacy",ev,T)));
  record={associationIntent:"",runtimeAssociation:T};
  show("B record published",JSON.stringify(record));
  show("A exact clear after B publish",tm(A,clearR4("legacy",ev,T)));
  show("A final record CAS matched",String(JSON.stringify(record)===staleAbandonIdentity));
  show("published association still names T; tmux has token",`${record.runtimeAssociation===T}; ${JSON.stringify(tokOf(A,"legacy"))}`);
  show("legacy empty-token guard now permits mutation",tm(A,guardArgs("legacy","","display-message -p legacy-mutation-allowed")));
} finally {
  for (const srv of [A, B, R]) remember(srv);
  const servers = [...started].filter(([, w]) => w.startsWith("tmux server")).map(([p]) => p);
  for (const [p, w] of started) if (!w.startsWith("tmux server")) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  for (const p of servers) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(200);
  for (const srv of ownSockets) if (existsSync(sockOf(srv))) unlinkSync(sockOf(srv)); // sockets of servers that this script started
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own sockets left: ${[A, B, R].filter((s) => existsSync(sockOf(s)))}`);
}
~~~

#### leader-tail.py

~~~python
import ctypes, os, signal, subprocess, time
from pathlib import Path
assert not any(k.startswith('AO_') for k in os.environ)
ctypes.CDLL(None).prctl(36, 1, 0, 0, 0)
S=Path('/tmp/aosdr4')
L=['/bin/sh','-c','trap : TERM; IFS= read -r go || exit 99; "$@"; rc=$?; echo "rc=$rc"; IFS= read -r done; exit $rc','ao-leader']
owned={}
def stat(p):
    try:
        f=Path(f'/proc/{p}/stat').read_text().rsplit(') ',1)[1].split()
        return (f[0],int(f[1]),int(f[2]),f[19])
    except FileNotFoundError: return None
def track(p):
    owned[p]=stat(p)[3]
    with (S/'logs/pids.txt').open('a') as f: f.write(f'leader-tail pid={p}\n')
def reap():
    while True:
        try:
            if os.waitpid(-1,os.WNOHANG)[0]==0: break
        except ChildProcessError: break
try:
    script=S/'tmp/resist.py'
    ready=S/'tmp/resist-ready'
    script.write_text('import os, signal, time\nfrom pathlib import Path\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nPath("'+str(ready)+'").write_text(str(os.getpid()))\ntime.sleep(30)\n')
    command=['/bin/sh','-c',f'/usr/bin/python3 -I {script} >/dev/null 2>&1 & while [ ! -f {ready} ]; do sleep 0.01; done']
    p=subprocess.Popen(L+command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,start_new_session=True)
    track(p.pid);p.stdin.write('go\n');p.stdin.flush()
    print('command completion:',p.stdout.readline().strip(),flush=True)
    child=int(ready.read_text());track(child)
    print('before TERM: leader, child',stat(p.pid),stat(child),flush=True)
    os.killpg(p.pid,signal.SIGTERM)
    time.sleep(.25)
    print('after TERM while leader read(done): leader exit =',p.poll(),'child =',stat(child),flush=True)
    print('per section 5.4 group KILL allowed:',p.poll() is None,flush=True)
    # Independent channel framing check, no real command or service.
    q=subprocess.Popen(L+['/bin/sh','-c','echo rc=0; /bin/sleep 5'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,start_new_session=True)
    track(q.pid);q.stdin.write('go\n');q.stdin.flush()
    print('first purported status while command still runs:',q.stdout.readline().strip(),flush=True)
    for d in Path('/proc').iterdir():
        if d.name.isdigit():
            st=stat(int(d.name))
            if st and st[2]==q.pid: track(int(d.name))
finally:
    for pid,start in owned.items():
        st=stat(pid)
        if st and st[3]==start and st[0]!='Z':
            try: os.kill(pid,signal.SIGKILL)
            except ProcessLookupError: pass
    time.sleep(.2);reap()
    print('own PIDs still present:',[p for p,s in owned.items() if stat(p) and stat(p)[3]==s],flush=True)
~~~

#### reuse-route.mjs

~~~js
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {switchOpenCodeSessionAgent} from '/home/taisung/.worktrees/agent-orchestrator/ao-51/packages/core/dist/opencode-api.js';
if(Object.keys(process.env).some(k=>k.startsWith('AO_'))) throw new Error('inherited AO');
const root='/tmp/aosdr4/reuse';
for(const p of ['bin','home','A/opencode/ao-holds/holds/ses_shared','B/opencode/ao-holds/holds/ses_shared']) mkdirSync(`${root}/${p}`,{recursive:true});
writeFileSync(`${root}/B/opencode/ao-holds/holds/ses_shared/live.json`,JSON.stringify({state:'held',sessionId:'other-live',launchIdentity:'B-live'}));
writeFileSync(`${root}/bin/opencode`, `#!/usr/bin/python3 -I
import json,sys
from pathlib import Path
assert sys.argv[1:3]==['api','session.switchAgent'],sys.argv
Path('${root}/B/opencode/changed').write_text(json.dumps(sys.argv[1:]))
print('{}')
`,{mode:0o755});
const env={HOME:`${root}/home`,PATH:`${root}/bin:/usr/bin:/bin`,XDG_DATA_HOME:`${root}/A`,LANG:'C.UTF-8',TMPDIR:'/tmp/aosdr4/tmp'};
console.log('intended store A held:',existsSync(`${root}/A/opencode/ao-holds/holds/ses_shared/live.json`));
await switchOpenCodeSessionAgent('ses_shared','build',{env});
console.log('actual store B live hold remains:',existsSync(`${root}/B/opencode/ao-holds/holds/ses_shared/live.json`));
console.log('actual store B mutation:',readFileSync(`${root}/B/opencode/changed`,'utf8'));
console.log('No real OpenCode or model; shipped transport, deterministic route stand-in.');
~~~

### Additional own measured outputs


rw-first-scan.out

~~~text
== G. wrapper dies BEFORE the first inode scan, no known group seed
  first and second hits                                              [[],[]]
  first and second drain members                                     [[],[]]
  live old mv (pid/ppid/pgid)                                        {"pid":2941057,"state":"S","ppid":1,"pgid":2940998,"sid":2940998,"start":11414548}
  record after empty-scan admission and old mv                       "worktree=/tmp/aosdr4/rw-first-scan/repo\nbranch=main\nruntimeHandle=old\ngeneration=1\npr=https://github.com/org/app/pull/7\n"
  started PIDs: 3; still running: []
~~~

association-race.out

~~~text
A abandon read intent; paused before exact clear
  B resume sets token                                                      exit 0 | out "ao-server:2949078\nao-assoc:2949078:$0\nao-end" | err ""
  B record published                                                       {"associationIntent":"","runtimeAssociation":"0bcb2dc49818b52fb01ed84a74bc391f"}
  A exact clear after B publish                                            exit 0 | out "ao-server:2949078\nao-assoc-cleared:2949078:$0:[]\nao-end" | err ""
  A final record CAS matched                                               false
  published association still names T; tmux has token                      true; ""
  legacy empty-token guard now permits mutation                            exit 0 | out "ao-server:2949078\nlegacy-mutation-allowed\nao-done:2949078\nao-end" | err ""
  started PIDs: 2; still running: []; own sockets left:
~~~

leader-tail.out

~~~text
command completion: rc=0
before TERM: leader, child ('S', 2940920, 2940939, '11414533') ('S', 2940920, 2940939, '11414533')
after TERM while leader read(done): leader exit = 0 child = ('S', 2940920, 2940939, '11414533')
per section 5.4 group KILL allowed: False
first purported status while command still runs: rc=0
own PIDs still present: []
~~~

reuse-route.out

~~~text
intended store A held: false
actual store B live hold remains: true
actual store B mutation: ["api", "session.switchAgent", "--param", "sessionID=ses_shared", "-d", "{\"agent\":\"build\"}"]
No real OpenCode or model; shipped transport, deterministic route stand-in.
~~~

t6.out

~~~text
bash 5.2.21(1)-release; Linux 6.8.0-147-generic
== 1. write() calls per appended record
    200 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 200); file size 200
   2048 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 2048); file size 2048
   4095 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 4095); file size 4095
   4096 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 4096); file size 4096
   4097 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 2 (bytes 4096+1); file size 4097
   8192 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 2 (bytes 4096+4096); file size 8192
   9000 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 3 (bytes 4096+4096+808); file size 9000
== 2. hex encoding of every byte 0x01..0xff in bash (LC_ALL=C)
  bytes in the string: 255; hex digits: 510; equal to od: yes
  first difference: none
  a branch name with a quote, a backslash and UTF-8: 666561742f6122625c632dc3a9
== 3. four parallel writers, 500 records each
  lines 2000; well formed 2000; malformed 0; per writer 500/500/500/500; pad digit not the writer: 0
  writers left: none
~~~

The copied t5 also constructs an empty base commit in its disposable scratch Git repository, as its git-wrapper fixture requires; no commit was made in the project worktree. No changed source or tests were staged.

### Final isolation audit

Marker: /tmp/aosdr4-marker, 2026-10-21 18:14:57.299358558 -0400. All 89 distinct logged PIDs are absent. A same-uid /proc scan of scratch HOME/TMPDIR/XDG_CONFIG_HOME, excluding the scan itself and its direct launcher, found no remaining process. Every server/helper was stopped by its recorded exact PID; no name-pattern kill or default tmux connection was used. Protected workers 3624110 and 3626937 still have /proc entries.

~~~text
logged PIDs still present: []
scratch-environment processes: []
private aosdr4 socket files: []
~~~

Logged PIDs (all absent): 2874391, 2874392, 2874396, 2874405, 2874414, 2874418, 2874430, 2874439, 2874443, 2874459, 2874460, 2874465, 2879135, 2879136, 2879167, 2879177, 2879178, 2879189, 2879190, 2879200, 2879204, 2879209, 2879246, 2879247, 2879251, 2879255, 2879259, 2879263, 2879267, 2879271, 2879275, 2879280, 2879284, 2879288, 2879292, 2879334, 2879343, 2879347, 2928003, 2928007, 2928008, 2928030, 2928032, 2928053, 2928076, 2928093, 2928095, 2928096, 2928104, 2928132, 2928138, 2928174, 2928207, 2928244, 2928250, 2928342, 2928427, 2929832, 2929833, 2929856, 2929858, 2929871, 2929872, 2929896, 2929898, 2929912, 2929933, 2929943, 2930041, 2940939, 2940941, 2940998, 2941057, 2941060, 2941136, 2941138, 2941140, 2941403, 2941410, 2941417, 2941424, 2948984, 2949002, 2949078, 2949148, 2949515, 2949518, 2949570, 2949573.

Before: ls -la --time-style=full-iso ~/.ao/bin

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

After: ls -la --time-style=full-iso ~/.ao/bin

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

Both listing diffs are empty: ~/.ao/bin and the real ~/.config/herdr. Herdr server traces across all three starts: /home paths [], AF_INET/AF_INET6 connect calls 0. The four restarted-server ENOENT probes (/.git, /HEAD, /tmp/.git, /tmp/HEAD) did not open files. No service.json, authentication file, live pane, model process, real OpenCode executable or real gh was accessed.

Required final real-state check:

~~~sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
~~~

~~~text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
~~~

Every entry accounted for:

- sessions/: directory mtime 18:33:33.260042808, matching ao-55's last rename.
- sessions/ao-55: mtime 18:33:33.260042808, generation 17, status stuck; live fleet session.
- sessions/ao-52: mtime 18:22:03.051531438, generation 13, status stuck; author session.
- sessions/ao-orchestrator: mtime 18:26:32.977491759, generation 26, status stuck; orchestrator session.

The fields and mtimes are consistent with ongoing resident fleet status maintenance. They do not identify an exact writer PID; attribution to the live fleet is an inference, not an audited claim that a particular worker performed each write. The reviewer ran no real AO command and supplied only scratch AO paths to wrappers. The reviewer's own real ao-51 record still has its pre-marker mtime (12:09:02). No listed path is a scratch record or delivery.

Final git diff and staged diff are empty; only the supplied task/report and untracked review files appear in status. The round-2 and round-3 reviews were left untouched. Reviewer scratch and marker are removed after retaining these sources/results; the final report is published only after that removal is verified.
