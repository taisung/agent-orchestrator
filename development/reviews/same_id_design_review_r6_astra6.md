# Same-ID design r6 — focused re-check by ao-51

RW: NOT-SOUND

R2b-2: SOUND-WITH-CHANGES

One blocker, two majors, zero minors. Finding IDs restart for r6. R2b-2 approval is limited to existing-session effects with synchronous server-side guards; OD-28 creation remains an explicit owner decision, not an assumed acceptance.

Worktree c8751762277dd6c6dc2eda32be9654c54d97b1c3. Design snapshot from local main 347d0078e8443a999b8685c9dd75ad68073dd436, SHA-256 6b4c64880f5adcd2851edb0d3dd5b158ac15d076d781f51c216f7a39a7b0138a, 1746 lines. Scope: RW and R2b-2 only. Stopped-fleet barrier and OD-25(a) are decided; no other round is re-reviewed.

## Evidence log (retained working notes)

- Read the complete brief, AGENTS.md, CLAUDE.md and design body/measurements/qualifications through section 11. At this stage the author report remained unread pending independent B-1/M-1 and B-2 assessments; the later read is recorded below.
- Scratch root /tmp/aosdr6 and marker /tmp/aosdr6-marker; before listing of real ~/.ao/bin and prior report saved. Every helper/test uses env -i and fake HOME. No AO/network/OpenCode/Herdr/model/real-fleet mutation. Author scratch /tmp/aosd6 is read-only.
- Initial source assessment: the one-hold ownership rule addresses both pending-candidate schedules; archive recovery before directory initialization removes the previous legacy recovery error. The @ao_op protocol needs real-server verification across stale fence/clear and all mutation paths.
- Initial precondition concerns to test: socket enumeration via argv cannot necessarily find a tmux server whose process title hides an arbitrary -S path; unreadable environments may also make exe unreadable; P1 depends on the covered-root set while the owner's shutdown is host-wide; a single process-table pass is not a complete snapshot of births during that pass. These are hypotheses, not findings yet.

## Independent closure results (before author report)

- Prior B-1 concurrency schedules: closed by the one-hold rule. My copied m1 runs reproduce both r5 failures and preserve A's named file under r6. The competing prune waits, then removes nothing; competing B cannot reserve. A stale restore recovers the archive before making a candidate and refuses without recreating the inbox.
- Prior M-1: closed for the reported ordering error. No legacy directory is created; recovery first finishes the archived legacy record. The prototype's generated archive filename differs from the explicit filename required by the design, so these runs do not qualify archive lookup integration.
- Prior B-2: closed for the held clear and held fence on an existing session, subject to the server's synchronous command-list premise and complete mutation coverage. Copied m2 on real private tmux reproduced r5 corruption and r6 refusal of both late calls. I added an EADDRINUSE control proving the old holder owned the same operation socket. Sixteen recorded PIDs ended; socket removed. N-1 creation is separately open under OD-28.
- New error-boundary evidence: after reserveSessionRecord has linked the complete record, its finally cleanup can throw. With an injected EIO in that cleanup and r6 step 5's unconditional unlink, the record names L while L.ndjson is absent. The transaction must re-read its committed state before deleting its candidate on an ambiguous error.
- New archive integration evidence: with a real archived record `app-1_<ts>` and its prescribed adjacent `app-1_<ts>.inbox` directory, current main/worktree `readArchivedMetadataRaw` selects the directory and returns null; `updateArchivedMetadata` returns false. The prototype's use of deleteMetadata's independently generated timestamp masks the same-name layout.
- Initial offline install used the wrong cache directory level and failed without a network attempt; the premature build then lacked tsc. Corrected the scratch cache to store/v3, repeated frozen offline install and build successfully before tests. Selected red tests: core r6 5 failures/3 passes, core r5 5 failures/5 passes; tmux r6 2 failures/2 passes, all intended assertions.
- Additional real-tmux checks: all ten stale gated mutations (keys/paste/options/respawn/rename/hook definition/kill) were refused; stale fence/clear refused after same-name recreation and after server restart. Forty competing CAS pairs each had exactly one winner. This is measurement of synchronous forms, not proof for asynchronous hooks. N-1 was illustrated by executing a late new-session after a modeled record was failed and no server existed; a live unrecorded pane starts.
- Precondition experiment corrected an initial hypothesis: on this host an arbitrary -S path remains in the server argv, so that case is discoverable. However a server launched with a different TMUX_TMPDIR and -L has no -S in argv and lies outside the checker's socket directory. Its AO-named pane, running an env-cleared sleep, is live while P1/P3/P4 do not identify it. P2's enumerator misses that server unless it inspects each server's environment/socket or fails closed for unmapped server PIDs.
- The nondumpable owned AO child made both environ and exe return EACCES. OD-27(a) would skip that identity, not merely hide diagnostics. Recommend OD-27(b) with exact PID/start-tick exceptions. The real uid environment scan printed only AO key names and PID/error counts; no foreign environment values and no signals/waits.
- Read the author's r6 report only after independent closure assessment and fence experiments. Its green prototypes omit P1 and automatic socket discovery, use generated archive names, and simplify publication/catch-up. They do not qualify those missing paths.
- A second P3 boundary is measured: an external core importer running the binary named node remains alive after that executable is unlinked, but `/proc/PID/exe` ends in `node (deleted)`. Literal basename matching returns false, with no AO environment keys. This is ordinary executable replacement, not a deliberately renamed runtime. A process born after a /proc pass enumerates its PID list is also absent from that pass; the no-new-old-process rule must cover the entire shutdown/check interval, not start only after check 2.

## Closure of round-5 findings

| Prior finding | State | Reason |
| --- | --- | --- |
| B-1: candidate pruned or archived before reservation | Closed for both reported interleavings | One synchronous hold encloses identity validation, candidate creation and record publication; prune/archive take the same lock. Both competing-process schedules now preserve A's file. New M-1 concerns an ambiguous error after publication, not the old interleaving. |
| B-2: dead holder's shim clears a newly published token | Closed for existing-session transitions | The command checks the server-side operation fence when executed. Held clear and held fence are refused after a newer fence. A client lifetime protocol is not uniquely required; this third protocol is valid. Creation N-1 has no session fence and remains open under OD-28. |
| M-1: barrier creates legacy directory before recovering its archive | Closed | No legacy initialization; recovery runs first. The five-state test and independent m1 schedule exercise the ordering. Archive-reader integration still needs new M-2. |
| M-2: external core importer invisible to argv/cwd inventory | Partly closed | Ordinary node importers are now P3 regardless of cwd. Deleted executable identity escapes the literal P3 rule; unreadable identity needs OD-27(b). The owner allow list and S3 residual are now explicit. |

## New findings

### B-1 — The stopped-fleet checker does not cover all ordinary server/runtime locations (RW)

Design §2.2 lines 85–88, §2.3 lines 98–113, §6 RW row. Proposed code: `core/src/fleet-barrier.ts`; source of the measured prototype is design §12, `/tmp/aosd6/val/core/fleet-barrier.ts` (P3 uses a literal basename; P2 only queries caller-supplied sockets). Production code does not exist yet. Test seams: `core/src/__tests__/same-id-defects-r6.test.ts:393` and :482, changed r5 `:264` and :448.

Two independent holes in the stated enumeration:

1. **Another TMUX_TMPDIR.** I started a real private server using `TMUX_TMPDIR=/tmp/aosdr6/other-tmux` and `-L aosdr6-alt`, without `-S`. Its AO-named pane ran `env -i /bin/sleep 600`. The server retained its original argv, but that argv has no `-S`. Its socket is outside the checker's `$TMUX_TMPDIR/tmux-uid` directory. P1 finds no AO keys in the server/pane, P3 does not match tmux/sleep, and P4 finds no writer shape. P2's stated sources omit the only socket that would reveal the pane. This is an AO-named live pane, which owner decision 1b requires the checker to reject even if the owner missed its stop.
2. **Deleted executable.** An owned external Node process loaded the real built core installer; then I unlinked its copied executable, whose filename was `node`. The process remains executable and capable of reinstalling old wrappers. `/proc/PID/exe` is `/tmp/aosdr6/old-bin/node (deleted)`, which fails the exact P3 basename set. It has no AO keys and no W1–W4 writer argv. This is not the declared “renamed runtime” S3 exclusion; normal binary replacement can leave this proc suffix.

Measured output:

```text
P2 alternate-TMP server argv ["/usr/bin/tmux","-f","/dev/null","-L","aosdr6-alt","new-session","-d","-s","bbbbbbbbbbbb-app-1","/usr/bin/env -i /bin/sleep 600"]
P2 alternate-TMP in current directory or -S argv false false
P2 alternate-TMP pane alive, AO keys true []
deleted runtime exe /tmp/aosdr6/old-bin/node (deleted)
P3 literal basename match false
AO environment keys []
```

These are measured inputs to the literal design rules, not a claim that a complete production barrier was run or admitted the real fleet. A first hypothesis about arbitrary `-S` paths was disproved: this tmux build keeps `-S` in argv, and that fixture is discoverable. The distinct TMUX_TMPDIR case is the counterexample.

Required change: map every live tmux server process to its actual socket (including its own TMUX_TMPDIR and recorded socket paths), or keep admission closed for an unresolved server. Normalize the kernel's ` (deleted)` executable suffix and fail closed for unresolved runtime identity unless an exact PID/start-tick exception is authorized. Treat unknown project/root provenance as blocking in a host-wide barrier. Test automatic discovery with multiple socket roots; do not pass the fixture socket explicitly to the only test.

Also correct the temporal statement: one `/proc` enumeration is not a snapshot at its end. My owned Node importer born after enumeration was absent from that pass while alive at its end. Require the no-old-launch operating rule from shutdown through both checks and reopening, and recheck identity of allowed PIDs. Two passes alone cannot prevent arbitrary external launches during the final pass. This strengthens the execution of the already decided stopped-fleet procedure; it does not replace it with a live-writer drain.

### M-1 — Cleanup on any exception can delete an inbox whose record was committed (RW)

Design §3.2 step 5, line 169; implementation boundary `packages/core/src/metadata.ts:884` (`createRecordFile`), :904 (`linkSync`) and :910 (`finally` cleanup). The author's validation `inbox.js` implements the same unconditional `catch { unlinkSync(f); throw }`.

`reserveSessionRecord` publishes the complete record with `linkSync`, then removes its temporary link in `finally`. That cleanup can throw after the record was successfully published. R6 treats any exception after candidate creation as permission to delete the candidate, violating I1 even inside the lock.

I injected EIO only into the real metadata function's post-link temporary-file cleanup, then executed r6 step 5's catch/unlink. The record remained committed, but its named file was gone:

```text
r6 step5 caught injected post-link cleanup EIO
after uncertain commit: record launch, named inbox exists L false
```

This is controlled fault injection, not a claim of spontaneous disk failure during the review. No source file was changed. The `node:fs` binding was restored before the fixture exited.

Required change: distinguish a definitive refused write from an ambiguous exception. Under the same hold, re-read the active record before removing L. If it names L, retain the file and the visible preparing/failed state; if the read itself is unknown, retain and report unknown. Delete only when non-ownership is proved. Add failures before publication, after publication, during temporary cleanup and during this re-read. A lock provides exclusion, not knowledge that a thrown operation did not commit.

### M-2 — The inbox archive directory is selected as the latest archived record (RW)

Design §3.4 lines 194–197, §7 RW file/acceptance list. Existing code, unchanged on the inspected main: `packages/core/src/metadata.ts:706` (`readArchivedMetadataRaw`), :717–731 (lexicographic selection and read), :765–788 (`updateLatestArchive`); archive restore/copy-back callers use these functions. RW only lists changing deleteMetadata's archive name, not the corresponding readers.

The design puts these siblings in the same directory:

```text
archive/app-1_<ts>
archive/app-1_<ts>.inbox/
```

The current latest-archive selector accepts both names and chooses the longer `.inbox` name lexicographically. It then reads a directory, catches EISDIR and returns null. The archive update similarly returns false. After a successful r6 archive, the active record is gone and normal archive lookup cannot find the preserved record.

Real built API experiment, using the exact proposed layout:

```text
archive before inbox directory { branch: 'feat/kept', generation: '7', launchId: 'L' }
archive after matching inbox directory null
update archived record false
```

The m1 prototype calls today's `deleteMetadata`, which generates a new timestamp rather than the intent's explicit timestamp; its reader is never tested. The fuller validation prototype has the same limitation. Its passing archive test does not cover the production layout promised by the design.

Required change: define an unambiguous archive-record grammar/location and update every latest-archive reader/list/update/restore path to exclude inbox directories, while treating genuine record-read errors strictly. Alternatively put archived inboxes outside the record namespace. Add successful archive -> lookup -> update -> restore tests with identical record/inbox timestamps and multiple generations. Coordinate with the pending R4 implementation without assuming it already handles this RW-specific new filename.

## Stopped-fleet procedure and precondition review

P1 is useful for ordinary inherited AO environments, P2 catches a named pane even after its process clears that environment, P3 closes the common external-importer hole, and P4 catches known old writers with cleared environment. My copied m4 produced P1=true for an owned AO-env sleep, P3=true/E5=false for an external importer, and P2=true for a private AO-named pane. Each read was a read only; the real fleet was neither checked to admission nor stopped.

| Boundary | Assessment |
| --- | --- |
| Other project/state root | The covered set must be host-wide as 1b says, independent of the selected CLI project. A path naming an unknown/unreadable config/root must not be silently classified outside coverage. Include configured projects and orphaned persisted runtime locations. |
| Other tmux socket/server | Arbitrary -S argv worked on this host; other TMUX_TMPDIR failed the written enumerator (B-1). “Server did not answer” must include an unmapped server, not only known paths that timed out. |
| Unreadable environment | Owned nondumpable Python with AO_SESSION/AO_DATA_DIR produced EACCES for both environ and exe. No W1/W2 argv matched. OD-27(a) would accept an unknown AO child. Recommend (b). |
| Start during check | A child born after PID enumeration can be missed. The no-new-old-process rule must hold throughout; clarify that checks validate a quiescent fleet and cannot manufacture quiescence against new external launches. |
| Ordinary unrelated JS process | Blocks by P3 until exact owner allow; that is now explicit, not a false claim that every match is AO. Browser tooling, language servers and another project's Node process can all need exceptions. |
| Unrelated record reader / shell named gh | W2 still blocks a tail/editor whose argv names a record; W1's unresolved basename fallback can block an unrelated long-lived shell with `$0=gh`. These conservative costs remain after removing the drain. |
| Zombie/disappeared process | Skip only proved exit/zombie/empty cmdline as appropriate; distinguish EACCES from ENOENT. Do not turn unreadability into proof that an agent ended. |
| Allowed JS process / S3 | The allow list means the owner asserts it will not invoke old core. PID/start ticks must be checked again at use. Renamed/embedded runtimes remain an explicit deployment assumption, not detected inventory. |

P1 may temporarily inspect values to classify roots but must discard them and log keys only. My uid scan printed AO keys only, with PID/error counts; no foreign environment value was printed. The prototype fleet-barrier intentionally omits P1, W3/full W4 and automatic socket discovery. It also accepts an allow callback for any rule, whereas the CLI should scope exceptions precisely: allowing P3 is not permission to ignore a known live AO pane/writer. Do not use its all-green validation as coverage of these boundaries.

The owner must use a terminal outside AO and preserve a manifest of runtime target/server, record, worktree and restart choice for every project/root, including the orchestrator. R2a and the send fix are now built and live; that does not retrofit the RW epoch into old processes. Closing admission and stopping workers prevent lifecycle cleanup while panes are stopped. Native runtime stop keeps ordinary worker records/worktrees; the main restore path enriches live state before isRestorable (`session-manager.ts:4265`), so a stale working status alone does not block restoration.

One runbook correction is needed for preservation: `ao stop` calls `sm.kill` on the orchestrator before stopping its worker (`main cli/start.ts:1143`, :1153). It archives that orchestrator record and can remove a managed isolated orchestrator workspace (`main session-manager.ts:644`, :3060), while the primary project checkout is protected. Thus it is not a universal “stop runtime but keep record/worktree” operation. For strict preservation of every session, stop the worker by verified PID first and stop the orchestrator through its native runtime too; otherwise document the orchestrator exception and save/recover its archive/context. This is source review; I ran no ao stop or native stop on a real target. The current shared-checkout orchestrator is protected from workspace removal by the project-path check.

Removing legacy eligibility/files and the three-scan wait is consistent with 1b, once the checker is corrected. Legacy lines should be visible orphans, never applied to a restored launch. Recovery remains necessary for old interrupted states; launch ownership, parser bounds, failed-state visibility, epoch checks, cap warnings, obsolete/orphan listings, and wrapper rename fencing remain necessary for later running sessions. Final checks must be facts, not successful worker polls. OD-25 detection/response remains exactly the decided policy; it cannot excuse B-1 before initial admission.

## Crash walk and intermediate RW deployment

| Boundary | Result required by the revised protocol |
| --- | --- |
| Before candidate creation | Refuse a taken/changed ID without creating files. Recover an existing archive intent first. |
| Candidate exists, record not published | Other processes cannot prune/move it while the lock is held. Process death releases the lock and leaves an empty unnamed candidate that can be pruned. |
| Record published, creator dies | File remains named; state preparing is held. Only a genuinely stopped-fleet barrier may mark it failed; the state is not proof a pane is absent. |
| Record publication throws | Reconcile before candidate unlink; M-1. |
| Catch-up -> restore/archive | Freeze launch, dev/ino and S0; revalidate inside the hold. Change/refusal must not create a new candidate. For pre-RW records, explicitly represent “no selected inbox” rather than opening an absent legacy file. |
| Budgeted publish | Publish complete records read so far and their cursor in one record write. The unread prefix is backlog; do not retain r5's stronger promise that publication always consumes all held bytes. Do not publish fields and cursor in two writes merely because both are in one lock hold: process death can occur between them. |
| Intent written, before inbox move | Recovery moves the source and finishes the same named archive under one hold. |
| Inbox moved, before record copy/unlink | Recovery finds the destination and finishes the same record archive; no caller recreates the active inbox first. |
| Record archive copied, unlink not completed | Idempotent explicit-name retry must preserve the same archive identity. If the record is gone or a new reservation exists, leave it alone. Fix latest-archive selection (M-2). |
| Missing directory | No-launchId pre-RW archive is allowed to have no inbox. A launch with no source or destination remains damaged/unknown. Both directories remain unknown. |
| Prune death/failure | Only proved-empty unnamed files may be removed; named and nonempty files remain. Recovery precedes prune. An unreadable record/file is not an empty obsolete file. |

One-hold filesystem operations do not require moving the whole R3a operation lock into RW. The record lock serializes candidate/archive/prune ownership and the old runtime/worktree interleaving limitation remains disclosed. The existing nested metadata helpers are synchronous/reentrant for the same held record; do not reacquire a separate cross-process operation lock inside them. A thenable rejection must prevent an escaped continuation from mutating after release, not merely report it after async work began.

## Tmux fence review and N-1

The proposed third protocol fixes the existing-session side effect at the place it takes effect. It need not identify or wait for a client process. Keep the operation lock to serialize live AO callers and keep the synchronous record CAS/mismatch rules; @ao_op does not replace them.

My copied m2 used separate old-holder processes, private tmux, modeled JSON-record CAS and the real abstract socket. The extra EADDRINUSE probe verified same-lock contention before holder death. R5 reproduced record=T/token empty. R6's held clear returned ao-assoc-refused and held fence returned ao-fence-refused; record/token stayed T. Releasing the clear before death remained a healthy control.

Additional private-server measurements:

- Superseded gated C-u, Escape, Enter, literal send, paste-buffer, set-option, respawn-pane, rename-session, set-hook and kill-session all returned refused without reaching their synchronous effect branch.
- Recreated same name on the same server had another session/pane identity; the old fence and clear refused. A restarted server also refused them and preserved T.
- Forty pairs of competing fence clients from one observed value had exactly one successful compare/set each.

These results support the specified `if-shell -F` synchronous forms on tmux 3.4. They are not a general scheduler proof or a qualification of asynchronous hook effects. Every effect must remain within the guarded non-waiting command list: no `run-shell`, no non-F shell condition, and no split client preflight/effect. Hook definition is a synchronous guarded mutation; a hook body that schedules later work needs its own check when that work runs. Attach and send are explicitly not operation holders; they retain their R2b-1 launch/no-token guard, rather than pretending they have an operation token. I found no existing-session counterexample to the stated complete-guard protocol. Production builders/callers still need the listed per-path tests, including destroy/retire/asserted stop/restore cleanup and retained operations.

N-1 is real and separate: I executed the saved late new-session call after a modeled record had become failed with no runtimeHandle and no server was running. It created a live pane. This illustrates the server bootstrap boundary; it is not claimed as a full new process-lifetime experiment. RW ignoring its metadata does not prevent that agent from editing the worktree or using its service session. A read-only audit is detection, not exclusivity. Never infer that this residual vanished because the session-level fence tests pass.

**OD-26: (a).** Let RW update the remaining r4 oracle to refusal while the writer lives, then successful admission after it ends. Keep frozen writer, preservation/PR assertions and the healthy second admission. A permanent expected failure would hide whether the new barrier is working.

**OD-27: (b).** Block unreadable identity unless the owner permits the exact PID/start ticks. The measured EACCES fixture demonstrates why known login-process counts cannot prove all unreadable processes are unrelated to AO. Show keys/comm and diagnostics without values; exceptions remain explicit and expire with that process identity.

**OD-28: prefer (b) for the running-server case.** Fence pending creation names in R2b-2, not just existing sessions. Qualify server identity and compare/create ordering. This option alone does not cover “no server exists”; that remaining bootstrap case must be explicitly accepted or protected by child lifetime/recovery before claiming full launch exclusivity. If the owner instead chooses (a), retain the narrower existing-session guarantee and make the orphan-agent/worktree effects explicit. No acceptance of (a) is inferred in this review. This is why R2b-2 is SOUND-WITH-CHANGES rather than an unqualified SOUND.

## Round claims and plan

RW's ownership and archive-order changes address the prior races, but its §6 absolute admission claim is false for B-1 and its archive/error paths fail M-1/M-2. Put these fixes and tests in RW. The publish row must use the new budgeted-prefix semantics. R2b-2's existing-session refusal claim is supported under the synchronous-command qualification; N-1 must stay explicitly outside it until the owner chooses its treatment. The other rounds/decided choices are unchanged and were not re-reviewed.

The main re-inventory matches the round-5 list by call, including the changed runtime-tmux offsets after R2a: CLI send C-u/paste/literal/initial Enter, read-only Codex checks and both non-Codex Enter retries; core Escape/load/paste/literal/Enter/kill; runtime create keys and failed-create cleanup, stop/destroy, ordinary send keys/paste/delete-buffer, and attach; CLI attach resolution/arguments/spawn and core/lifecycle callers. The snapshot main calls at send.ts:138, :151, :160, :164, :425, :430 and the runtime mutations match the r6 plan. Loading/deleting a buffer does not itself protect the later pane paste. Production R2b-1 guard qualification is still required, but this dependency inventory is complete against the inspected landed code. No pending ao-54 prerequisite remains now that its fix is live.

## Tests, oracle changes and limits of green

All commands used `env -i HOME=/tmp/aosdr6/home PATH=/tmp/aosdr6/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr6/tmp`; tests also set SAME_ID_DEFECTS=red. The corrected install used the copied local cache and --offline. No network was attempted.

| Check | Own result |
| --- | --- |
| pnpm install --frozen-lockfile --offline --store-dir /tmp/aosdr6/pnpm-store | Pass after correcting the copied cache layout. Initial attempt failed for missing offline tarball; no fetch. |
| pnpm build | Pass after the successful install; the earlier premature attempt lacked tsc. |
| pnpm typecheck | Pass. |
| pnpm lint | Pass, five existing warnings in unchanged source. |
| core r6, new file | 5 intended failures, 3 controls pass. |
| core r5, changed file | 5 intended failures, 5 controls pass. |
| runtime-tmux r6, new file | 2 intended failures, 2 controls pass. |

Commands for the selected tests were `pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/same-id-defects-r6.test.ts src/__tests__/same-id-defects-r5.test.ts` and `pnpm --filter @aoagents/ao-plugin-runtime-tmux exec vitest run src/__tests__/same-id-defects-r6.test.ts`. Total 22 executed: 12 intended behavioral failures, 10 passes. No failure was setup/infrastructure. Missing modules intentionally select r5/r4 fallback models; no implemented r6 production module was tested. Full suite was not run because the brief excludes Herdr/OpenCode execution. Author full-run/prototype claims are labeled as author evidence.

The “two changed oracles” are two families, not literally two test cases or edits only to assertion/name. `4bdff4d6` changes the barrier API/loader, the three race names and assertions, moves writer birth to the first-check callback for the between-check case, adds a second successful barrier call, and changes the legacy defect into an orphan control with its setup. It also removes initLegacyInbox from the API and the related healthy control. Those fixture/API changes follow 1b and are justified; saying only names/oracles changed would be inaccurate. The unrelated 499-record, damaged-fragment, boundary and frozen-fixture semantics remain unchanged. The r4 file was not edited.

| Test | Observed red assertion | Wrong/partial fix that can pass |
| --- | --- | --- |
| core r6 prune during begin (:268) | named inbox absent | Disable pruning only while another process is active by an unrelated broad check; no correct record transaction. A child error/time-out also leaves the file, and the test does not require the competitor's successful completion result. |
| core r6 competing archive (:287) | named inbox absent | Refuse all competing spawns or make that child error; no ownership protocol needed for this narrow schedule. |
| core r6 stale restore (:306) | active inbox unexpectedly exists | Refuse all restores and special-case archive recovery; healthy restore coverage is missing. |
| core r6 barrier recovery (:329) | app-3 remains damaged | Delete/archive active records indiscriminately or use a different archive filename; the test does not verify full archived record/cursor readability under the exact same timestamp. |
| core r6 unallowed JS importer (:482) | admitted=true | Block only this node shape/cwd, ignore deleted executable and unreadable identity, or omit P1/P2/P4 entirely. |
| tmux r6 held clear (:510) | tmux empty, record=T | Serialize some known client shape, or guard clear only while leaving retire/stop/other mutations unguarded. |
| tmux r6 first call held (:522) | tmux empty, record=T | Insert a read-only first call: after holder death its answer is discarded, so no mutation is ever issued even without a fence. This is not a deterministic held-CAS-fence oracle when the production first call is display-message. The standalone m2 case c does exercise an actual held fence. |
| changed r5 first-scan/no-FD/between-check races (:511 vicinity) | admitted=true, expected false | Reject on a matching held mv but omit other shapes, P1/P2/P3, fsync or recovery. The second admission usefully defeats a blanket refusal. |
| changed r5 no-launch line control (:684) | Pass | Append some orphan text while omitting full schema/status validation. It does defeat silently dropping the line and applying it to the legacy record. |
| unchanged r5 499 records | v496-, expected v499- | Seventeen fixed calls or an unbounded whole-file read. |
| unchanged r5 damaged fragment | before, expected after | Skip too much valid data and retain only the final branch. |

The separate-process tests improve on r5's local-mutex false green. Keep them, but assert competitor outcomes, actual held-command identity, exact archive names/readback, pre/post-commit faults, automatic socket discovery, wrong start-tick allows, and all production mutation paths. The author's inbox prototype publishes in two writes, lacks full frozen identity return/validation, and does not implement the explicit archive filename; those are not acceptable substitutes for the design's acceptance cases.

## Correct changes to retain

- One record-lock hold closes the pending-candidate ownership race without requiring all of R3a.
- Archive recovery before any candidate creation prevents the false both-directories state from normal restore/barrier ordering.
- A server-side operation fence handles delayed interpreter clients without trusting process-name scans.
- Host-wide stop cost, JS allow list, renamed-runtime assumption and standing-check residual are now stated explicitly.
- Frozen identity/S0 catch-up and removal of the hard 1 MiB publish premise address the prior review notes.
- New separate-process race tests and the refusal-then-admit oracle strengthen regression coverage.

## Reproducers preserved before scratch cleanup

These scripts ran only with the sanitized environment above. They use real built metadata APIs and real private tmux where stated, with explicit stand-ins for proposed protocols. The EIO experiment is fault injection. Author scripts m1/m2/m4 remain in design r6 §12; my copies substitute reviewer paths/server names, use the reviewer build, add the same-socket contention control and record owned PIDs. No production source is changed.

### inbox-extra.mjs

```js
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as M from '/home/taisung/.worktrees/agent-orchestrator/ao-51/packages/core/dist/metadata.js';
const root='/tmp/aosdr6/inbox-extra'; fs.mkdirSync(root,{recursive:true});
const d=root+'/archive-reader';fs.mkdirSync(d+'/archive',{recursive:true});
const name='app-1_2026-10-22T03-30-00-000Z';
fs.writeFileSync(d+'/archive/'+name,'branch=feat/kept\ngeneration=7\nlaunchId=L\n');
console.log('archive before inbox directory',M.readArchivedMetadataRaw(d,'app-1'));
fs.mkdirSync(d+'/archive/'+name+'.inbox');
console.log('archive after matching inbox directory',M.readArchivedMetadataRaw(d,'app-1'));
console.log('update archived record',M.updateArchivedMetadata(d,'app-1',{summary:'review'}));
const e=root+'/commit-then-error', L='L';fs.mkdirSync(e+'/.inbox/app-1',{recursive:true});
const f=e+'/.inbox/app-1/L.ndjson';fs.writeFileSync(f,'');
const realRm=fs.rmSync;
fs.rmSync=(p,o)=>{if(String(p).includes('.app-1.reserve-'))throw Object.assign(new Error('injected post-link cleanup EIO'),{code:'EIO'});return realRm(p,o);};
syncBuiltinESMExports();
try {M.withRecordLock(e,'app-1',()=>{try{M.reserveSessionRecord(e,'app-1',{launchId:L,launchState:'preparing'});}catch(err){fs.unlinkSync(f);console.log('r6 step5 caught',err.message);}});} finally {fs.rmSync=realRm;syncBuiltinESMExports();}
console.log('after uncertain commit: record launch, named inbox exists',M.readMetadataRaw(e,'app-1')?.launchId,fs.existsSync(f));
```

### precondition-extra.mjs

```js
import {spawn,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readFileSync,readlinkSync,readdirSync,statSync,unlinkSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const S='/tmp/aosdr6';const sock=S+'/tmp/aosdr6-hidden.sock';
const started=new Map();const extraSockets=[];
const ticks=p=>{try{return readFileSync(`/proc/${p}/stat`,'utf8').split(') ').at(-1).split(' ')[19];}catch{return null;}};
const track=(p,label)=>{started.set(p,{label,t:ticks(p)});appendFileSync(S+'/logs/pids.txt',`pre ${label} pid=${p}\n`);};
const tm=(...args)=>spawnSync('/usr/bin/tmux',['-f','/dev/null','-L','aosdr6-hidden','-S',sock,...args],{encoding:'utf8',env:process.env});
try {
 if(existsSync(sock))throw Error('not own socket');
 tm('new-session','-d','-s','aaaaaaaaaaaa-app-1','/usr/bin/env -i /bin/sleep 600');
 const [server,pane]=tm('display-message','-p','#{pid} #{pane_pid}').stdout.trim().split(' ').map(Number);track(server,'hidden server');track(pane,'hidden pane');
 const argv=readFileSync(`/proc/${server}/cmdline`,'utf8').split('\0').filter(Boolean);
 const discovered=(process.env.TMUX_TMPDIR??'/tmp')+`/tmux-${process.getuid()}/`;
 console.log('P2 server argv',JSON.stringify(argv));
 console.log('P2 configured socket directory includes it',sock.startsWith(discovered));
 console.log('P2 argv -S discovery includes it',argv.some((a,i)=>a==='-S'&&argv[i+1]===sock));
 console.log('owned hidden pane AO keys',readFileSync(`/proc/${pane}/environ`,'utf8').split('\0').filter(x=>x.startsWith('AO_')).map(x=>x.split('=')[0]));
 console.log('owned hidden pane exe',readlinkSync(`/proc/${pane}/exe`));
 console.log('direct owned socket query',tm('list-panes','-a','-F','#{session_name} #{pane_pid}').stdout.trim());
 const otherTmp=S+'/other-tmux';mkdirSync(otherTmp,{recursive:true});
 const alt=(...a)=>spawnSync('/usr/bin/tmux',['-f','/dev/null','-L','aosdr6-alt',...a],{encoding:'utf8',env:{...process.env,TMUX_TMPDIR:otherTmp}});
 alt('new-session','-d','-s','bbbbbbbbbbbb-app-1','/usr/bin/env -i /bin/sleep 600');
 const [as,ap,sp]=alt('display-message','-p','#{pid}|#{pane_pid}|#{socket_path}').stdout.trim().split('|');track(Number(as),'alternate TMP server');track(Number(ap),'alternate TMP pane');extraSockets.push(sp);
 const aa=readFileSync(`/proc/${as}/cmdline`,'utf8').split('\0').filter(Boolean);
 console.log('P2 alternate-TMP server argv',JSON.stringify(aa));
 console.log('P2 alternate-TMP in current directory or -S argv',sp.startsWith(discovered),aa.includes('-S'));
 console.log('P2 alternate-TMP pane alive, AO keys',alt('has-session','-t','=bbbbbbbbbbbb-app-1').status===0,readFileSync(`/proc/${ap}/environ`,'utf8').split('\0').filter(x=>x.startsWith('AO_')).map(x=>x.split('=')[0]));
 const py=S+'/tmp/nondump.py';writeFileSync(py,'import ctypes,time\nctypes.CDLL(None).prctl(4,0,0,0,0)\ntime.sleep(30)\n');
 const nd=spawn('/usr/bin/python3',['-I',py],{env:{HOME:S+'/home',PATH:'/usr/bin:/bin',AO_SESSION:'app-1',AO_DATA_DIR:S+'/fake-root/sessions'},stdio:'ignore'});track(nd.pid,'nondumpable AO child');await sleep(150);
 for(const part of ['environ','exe'])try{part==='exe'?readlinkSync(`/proc/${nd.pid}/exe`):readFileSync(`/proc/${nd.pid}/environ`);console.log('nondumpable '+part,'readable');}catch(e){console.log('nondumpable '+part,e.code);}
 console.log('nondumpable argv',JSON.stringify(readFileSync(`/proc/${nd.pid}/cmdline`,'utf8').split('\0').filter(Boolean)));
 // Review P1 precisely without printing any foreign environment value. No rule acts on a process.
 let read=0,unread=[];const keys=[];
 for(const e of readdirSync('/proc')) {
  if(!/^\d+$/.test(e)||Number(e)===process.pid)continue;
  try {if(statSync(`/proc/${e}`).uid!==process.getuid())continue;appendFileSync(S+'/logs/proc-read-pids.txt',e+'\n');
   const names=readFileSync(`/proc/${e}/environ`,'utf8').split('\0').filter(x=>x.startsWith('AO_')).map(x=>x.split('=')[0]);read++;if(names.length)keys.push({pid:Number(e),keys:names});
  }catch(e2){if(e2.code!=='ENOENT'&&e2.code!=='ESRCH')unread.push({pid:Number(e),code:e2.code});}
 }
 console.log('host environment scans: read',read,'unreadable',JSON.stringify(unread));console.log('host AO keys only',JSON.stringify(keys));
 console.log('foreign processes signalled, stopped or waited on: []');
}finally {
 for(const[p,{t,label}]of started)if(!label.includes('server')&&ticks(p)===t)try{process.kill(p,'SIGKILL');}catch{}
 for(const [p,v]of started)if(v.label.includes('server')&&ticks(p)===v.t)try{process.kill(p,'SIGKILL');}catch{}
 await sleep(200);if(existsSync(sock))unlinkSync(sock);for(const x of extraSockets)if(existsSync(x))unlinkSync(x);
 console.log('own processes remaining',JSON.stringify([...started].filter(([p,v])=>ticks(p)===v.t).map(([p])=>p)));
}
```

### late-and-deleted.mjs

```js
import {spawn} from 'node:child_process';
import {appendFileSync,mkdirSync,readFileSync,readlinkSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const S='/tmp/aosdr6';mkdirSync(S+'/old-bin',{recursive:true});renameSync(S+'/bin/node-copy',S+'/old-bin/node');
const p=spawn(S+'/old-bin/node',[S+'/scripts/m4_external.mjs'],{env:process.env,cwd:S+'/external',stdio:'ignore'});const exited=new Promise(r=>p.once('exit',r));
const ticks=pid=>{try{return readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1).split(' ')[19];}catch{return null;}};const start=ticks(p.pid);appendFileSync(S+'/logs/pids.txt',`deleted external node pid=${p.pid}\n`);
try{await sleep(150);unlinkSync(S+'/old-bin/node');const exe=readlinkSync(`/proc/${p.pid}/exe`);const base=exe.split('/').at(-1);console.log('deleted runtime exe',exe);console.log('P3 literal basename match',['node','nodejs','bun','deno'].includes(base));console.log('AO environment keys',readFileSync(`/proc/${p.pid}/environ`,'utf8').split('\0').filter(x=>x.startsWith('AO_')).map(x=>x.split('=')[0]));}
finally{if(ticks(p.pid)===start)process.kill(p.pid,'SIGKILL');await exited;}
// Snapshot-style /proc pass. An owned import starts after the pass enumerates its PID set.
const list=readdirSync('/proc');
const late=spawn(process.execPath,[S+'/scripts/m4_external.mjs'],{env:process.env,cwd:S+'/external',stdio:'ignore'});const done=new Promise(r=>late.once('exit',r));const st=ticks(late.pid);appendFileSync(S+'/logs/pids.txt',`late importer pid=${late.pid}\n`);
try{await sleep(150);console.log('during-check new JS process absent from current enumerated pass',!list.includes(String(late.pid)),readlinkSync(`/proc/${late.pid}/exe`).split('/').at(-1));}
finally{if(ticks(late.pid)===st)process.kill(late.pid,'SIGKILL');await done;}
console.log('own children remaining',[]);
```

### fence-extra.mjs

```js
// m2 (review r5 B-2, design r6 section 6): a killed lock holder whose tmux client is a held /bin/sh shim (exe
// dash), on a private tmux 3.4 server (-L aosdr6-edge only). The old holder is ANOTHER process (node -e) that
// binds the per-ID operation lock (an abstract Unix socket) and starts the shim; the script kills that holder by
// its exact PID; a new holder (this process) takes the lock and resumes the association; then the shim runs.
//   a. r5 rules: the lock plus the stale-client wait of r5 5.4 (exe or argv[0] basename tmux, argv names =<name>).
//   b. r6 fence: each holder first fences the session (a compare-and-set of the session option @ao_op from the
//      value that it read to its own operation ID), and each of its association commands checks @ao_op inside
//      tmux. The old holder fenced, then its clear is held.
//   c. r6 fence, the old holder's FENCE itself is held (the holder died before its first command ran).
//   d. control, r5 rules: the shim is released before the kill (no stale client).
// After each schedule: does the tmux token equal the token that the record names?
// The record is a JSON stand-in with a compare of the launch identity, as in a1 (r5) and the review.
// Run: env -i HOME=/tmp/aosdr6/home PATH=/tmp/aosdr6/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr6/tmp \
//        SHELL=/bin/sh TERM=xterm-256color node /tmp/aosdr6/scripts/m2_stale_client.mjs
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosdr6", SRV = "aosdr6-edge", T0 = `${S}/tmp/edge`;
const sock = `/tmp/tmux-${process.getuid()}/${SRV}`;
if (existsSync(sock)) throw new Error(`${sock} exists: not started by this script`);
rmSync(T0, { recursive: true, force: true }); mkdirSync(T0, { recursive: true });
const ticks = (p) => { try { const s = readFileSync(`/proc/${p}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
const started = new Map();
const track = (pid, what) => { if (pid && !started.has(pid)) { started.set(pid, { what, t: ticks(pid) }); appendFileSync(`${S}/logs/pids.txt`, `m2 ${what} pid=${pid}\n`); } };
const tm = (args) => { const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...args], { encoding: "utf8" }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const q = (f) => `"${f}"`;
const token = () => randomBytes(16).toString("hex");
const opt = (name, o) => tm(["display-message", "-p", "-t", `=${name}:`, `#{${o}}`]).out;
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const BASE = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}";
const want = (name, ev) => `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
// The forms of r4 3.2/3.3 (r5), and the same forms with the fence value inside the compare (r6).
const ident = (op) => (op === undefined ? `${BASE}/#{@ao_launch}` : `${BASE}/#{@ao_launch}/#{@ao_op}`);
const tail = (op) => (op === undefined ? "" : `/${op}`);
function associateArgs(name, ev, tok, op) {
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${ident(op)}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tok}${tail(op)}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tail(op)}}`)} { ${set} } { ${second} }`);
}
function clearArgs(name, ev, tok, op) {
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${ident(op)}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tok}${tail(op)}}`)} { ${clear} } { ${no} }`);
}
/** r6: the fence, a compare-and-set of @ao_op from `seen` to `op` on the evidence session. */
function fenceArgs(name, ev, seen, op) {
  const set = `set-option -t =${name}: @ao_op ${op} ; display-message -p -t =${name}: ${q("ao-fenced:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-fence-refused:${BASE}/#{@ao_op}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${BASE}/#{@ao_op},${want(name, ev)}/${seen}}`)} { ${set} } { ${no} }`);
}
const mark = (r) => r.out.split("\n").find((l) => /^ao-(assoc|refused|fence)/.test(l)) ?? r.out;

const recPath = `${T0}/record.json`;
const readRec = () => JSON.parse(readFileSync(recPath, "utf8"));
const writeRec = (o) => { writeFileSync(`${recPath}.w`, JSON.stringify(o)); renameSync(`${recPath}.w`, recPath); };
const identity = (r) => JSON.stringify([r.associationIntent ?? null, r.runtimeAssociation ?? null, r.runtimeHandle]);
const casRec = (expected, patch) => { const r = readRec(); if (identity(r) !== expected) return false; writeRec({ ...r, ...patch }); return true; };
async function opLock(name) {
  const addr = `\0aosdr6-m2-operation-${name}`;
  for (const t0 = performance.now(); ;) {
    const srv = createServer();
    const ok = await new Promise((res, rej) => { srv.once("error", (e) => (e.code === "EADDRINUSE" ? res(false) : rej(e))); srv.listen(addr, () => res(true)); });
    if (ok) return () => new Promise((r) => srv.close(r));
    if (performance.now() - t0 > 30_000) throw new Error("operation lock busy for 30 s");
    await sleep(20);
  }
}
/** r5 5.4 step 2: the uid's processes whose exe or argv[0] basename is tmux and whose argv names =<name>. */
function staleClients(name) {
  const found = [];
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    try {
      if (statSync(`/proc/${e}`).uid !== process.getuid()) continue;
      appendFileSync(`${S}/logs/proc-read-pids.txt`,e+"\n");
      const a = readFileSync(`/proc/${e}/cmdline`, "utf8").split("\0").filter(Boolean);
      let exe; try { exe = readlinkSync(`/proc/${e}/exe`).split("/").at(-1); } catch { exe = a[0]?.split("/").at(-1); }
      if (exe !== "tmux" && a[0]?.split("/").at(-1) !== "tmux") continue;
      if (a.some((x) => new RegExp(`=${name}(:|\\s|$)`).test(x))) found.push(Number(e));
    } catch {}
  }
  return found;
}


const name='edge';
function make(n,command='/bin/sleep 600') {const r=tm(['new-session','-d','-s',n,command]);if(r.code)throw Error(r.err);const [serverPid,sid,panePid]=tm(['display-message','-p','-t',`=${n}:`,'#{pid}|#{session_id}|#{pane_pid}']).out.split('|');track(Number(serverPid),'tmux server');track(Number(panePid),'pane '+n);return {serverPid,sid,panePid};}
function mutation(n,ev,T,op,cmd){return gated(n,`if-shell -F -t =${n}: ${q(`#{==:${ident(op)},${want(n,ev)}/${T}/${op}}`)} { ${cmd} ; display-message -p effect } { display-message -p refused }`);}
try {
 make('anchor');let ev=make(name);const T=token();tm(associateArgs(name,ev,T));
 console.log('fence A',mark(tm(fenceArgs(name,ev,'','aaa'))));
 console.log('fence B',mark(tm(fenceArgs(name,ev,'aaa','bbb'))));
 const commands=[`send-keys -t =${name}: C-u`,`send-keys -t =${name}: Escape`,`send-keys -t =${name}: Enter`,`send-keys -t =${name}: -l stale`,`paste-buffer -b edge -t =${name}:`,`set-option -t =${name}: @extra stale`,`respawn-pane -k -t =${name}: 'sleep 600'`,`rename-session -t =${name} changed`,`set-hook -t =${name}: after-select-pane 'display-message stale'`,`kill-session -t =${name}`];
 tm(['set-buffer','-b','edge','stale']);
 for(const cmd of commands){const r=tm(mutation(name,ev,T,'aaa',cmd));console.log('stale mutation',cmd.split(' ')[0],r.out.includes('refused'),!r.out.split('\n').includes('effect'));}
 const oldFence=fenceArgs(name,ev,'bbb','ccc'),oldClear=clearArgs(name,ev,T,'aaa');
 tm(['kill-session','-t',`=${name}`]);const newer=make(name);tm(associateArgs(name,newer,T));
 console.log('same-name recreation refuses old fence/clear',mark(tm(oldFence)),mark(tm(oldClear)),opt(name,'@ao_launch')===T);
 tm(['kill-server']);await sleep(100);ev=make(name);tm(associateArgs(name,ev,T));
 console.log('server restart refuses old fence/clear',mark(tm(oldFence)),mark(tm(oldClear)),opt(name,'@ao_launch')===T);
 // Real competing clients: compare and synchronous effect in a single command list.
 let pairs=0;
 for(let i=0;i<40;i++){
  const seen=opt(name,'@ao_op');const promises=['a','b'].map(s=>new Promise((resolve,reject)=>{const p=spawn('/usr/bin/tmux',['-f','/dev/null','-L',SRV,...fenceArgs(name,ev,seen,`${s}${i}`)],{env:process.env});track(p.pid,'CAS client');let out='';p.stdout.on('data',d=>out+=d);p.once('error',reject);p.once('close',()=>resolve(out));}));
  const outs=await Promise.all(promises);if(outs.filter(s=>/^ao-fenced:/m.test(s)).length!==1)throw Error('non-exclusive CAS');pairs++;
 }
 console.log('competing client CAS pairs, exactly one succeeds',pairs);
 tm(['kill-server']);await sleep(100);
 // A queued creation has no session or live server in which to compare @ao_op.
 const plan=['new-session','-d','-s','late-created','/bin/sleep 600'];
 const record={launchId:'L-old',launchState:'failed',runtimeHandle:null};
 tm(plan);const late=tm(['display-message','-p','-t','=late-created:','#{pid}|#{session_id}|#{pane_pid}']).out.split('|');track(Number(late[0]),'tmux server late');track(Number(late[2]),'pane late');
 console.log('N-1 new server: record failed, no runtime; late pane exists',record.launchState,record.runtimeHandle,tm(['has-session','-t','=late-created']).code===0);
}finally {
 for(const[p,{what,t}]of started)if(!what.startsWith('tmux server')&&ticks(p)===t)try{process.kill(p,'SIGKILL');}catch{}
 for(const[p,{what,t}]of started)if(what.startsWith('tmux server')&&ticks(p)===t)try{process.kill(p,'SIGKILL');}catch{}
 await sleep(200);if(existsSync(sock))unlinkSync(sock);
 console.log('own processes remaining',JSON.stringify([...started].filter(([p,v])=>ticks(p)===v.t).map(([p])=>p)));
}
```

## Isolation and cleanup audit

Marker `/tmp/aosdr6-marker`: 2026-10-21 23:50:05.089131296 -0400. Reviewer scratch only, private aosdr6-* tmux servers; env -i with fake HOME for every Node/pnpm/helper/wrapper/test/Python invocation. No network, real gh, real AO command, model turn, OpenCode process or Herdr server. No commits, push or PR. No source edits or earlier-review edits.

The scans read same-uid proc stat/uid, cmdline, exe/cwd and descriptor links where needed. The P1 measurement and final ownership audit also read environments, retaining/printing only AO keys or own scratch-identity matches. No foreign environment value was printed or preserved. P2 queries were restricted to my own servers; I did not query the default or real-fleet tmux servers or read the orchestrator pane. Below are the read PID union and AO key groups from the measurement, plus the final ownership audit. Read access is not a claim of waiting for or signalling those PIDs.

```text
logged owned PIDs 122
logged owned PIDs still present []
own processes excluding the audit and ancestors []
final same-uid cmdline/environ audit PIDs 13870,13874,13893,13895,13899,13901,13904,13943,14053,14112,100858,101160,101162,101169,104346,122814,122817,122818,271596,425350,425595,425597,425604,426483,426714,426717,426718,1101402,1101403,1102127,1185562,1185683,1294181,1294364,2240622,2240868,2240870,2240877,2243164,2246295,2246298,2246299,2256355,2330394,2580969,2581024,2581102,2581186,2583842,2586327,2586397,2825345,2825582,2833055,2833080,2833081,3636899,3636901,3636903,3636904,3753189,3753412,3760581,3760584,3760585,3827681,3829571,3845631,3845634,3845635,4099210,4099358,4106554
unreadable environments (PIDs only) [13870, 13874, 1185562, 1185683]
m2/precondition process-table read PID union 13870,13874,13893,13895,13899,13901,13904,13943,14053,14112,100858,101160,101162,101169,104346,122814,122817,122818,271595,271596,425350,425595,425597,425604,426483,426714,426717,426718,1101402,1101403,1102127,1185562,1185683,1294181,1294364,2240622,2240868,2240870,2240877,2243164,2246295,2246298,2246299,2256355,2326871,2327113,2327115,2327122,2330394,2377023,2403198,2403210,2408022,2411447,2423520,2424081,2424139,2424140,2424184,2425204,2425943,2426980,2428675,2428676,2428701,2428709,2428719,2428720,2428722,2428733,2428744,2428745,2428746,2428748,2428768,2428769,2428781,2428782,2428784,2428796,2428797,2428808,2428809,2428811,2444816,2444885,2444989,2445251,2448009,2448622,2451625,2451632,2451643,2451644,2451648,2460076,2460153,2462690,2462783,2463002,2463240,2463243,2463308,2469633,2470464,2470485,2470486,2470521,2473499,2473511,2473512,2473518,2473519,2473523,2825345,2825582,2833055,2833080,2833081,3636899,3636901,3636903,3636904,3753189,3753412,3760581,3760584,3760585,3827681,3829571,3845631,3845634,3845635,4099210,4099358,4106554
protected worker state/startticks {'1294181': ('S', '12930697'), '1294364': ('S', '12931014')}
private socket list []
P1 read AO keys AO_CALLER_TYPE,AO_CONFIG_PATH,AO_DATA_DIR,AO_ISSUE_ID,AO_PROJECT_ID,AO_SESSION,AO_SESSION_ID,AO_SESSION_NAME,AO_STATE_ROOT,AO_TMUX_NAME in PIDs 100858,101160,101162,101169,104346,425350,425595,425597,425604,426483,1102127,2240622,2240868,2240870,2240877,2243164,2326871,2327113,2327115,2327122,2330394,2463240,2473499,2825345,2825582,3753189,3753412,3827681,3829571
P1 read AO keys AO_CALLER_TYPE,AO_CONFIG_PATH,AO_DATA_DIR,AO_PROJECT_ID,AO_SESSION,AO_SESSION_ID,AO_SESSION_NAME,AO_STATE_ROOT,AO_TMUX_NAME in PIDs 122814,122817,122818,271596,426714,426717,426718,2246295,2246298,2246299,2256355,2460076,2460153,2462690,2462783,2463002,2469633,2470464,2833055,2833080,2833081,3636899,3636901,3636903,3636904,3760581,3760584,3760585,3845631,3845634,3845635
P1 read AO keys AO_CONFIG_PATH,AO_LIFECYCLE_PROJECT,AO_STATE_ROOT in PIDs 1294181,1294364
```

All 122 recorded fixture/server/client PIDs are absent. No own process remains outside the audit and its launcher ancestors. Final private socket list is empty; custom socket paths were removed after their own servers ended. Every deliberate signal targeted a recorded owned PID, with start ticks checked where retained; no pkill, killall or name-based signalling. Protected workers 1294181 and 1294364 remain running with the start ticks quoted above; no foreign process was stopped, signalled or waited on. All yielded build/test sessions were collected.

`ls -la --time-style=full-iso ~/.ao/bin` before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command after:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The diff is empty, including timestamps.

Required real-state scan:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr6-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
```

Every entry is named below. These are concurrent real-fleet changes, not reviewer outputs. File timestamps/status do not establish the exact writer PID.

| Entry under ~/.agent-orchestrator/60756641ca25-agent-orchestrator | Attribution supported by this review |
| --- | --- |
| sessions | Directory-entry changes from real session record updates, including those below. |
| sessions/ao-55 | Real ao-55 session activity; external session/lifecycle write, exact actor unknown. |
| sessions/ao-52 | Real ao-52 session activity; external session/lifecycle write, exact actor unknown. |
| sessions/ao-54 | Real ao-54 session activity; external session/lifecycle write, exact actor unknown. |

No reviewed helper or test used that state root or real HOME. Protected sessions/watchers were observed only through allowed process/metadata reads and never controlled.

Cleanup completed: `/tmp/aosdr6` and `/tmp/aosdr6-marker` removed. Own fixture process list `[]`; own private socket list `[]`. Only this review and the atomic report deliverable were written in the worktree. No commit or PR.
