# Same-ID design r5 — focused re-check by ao-51

RW: NOT-SOUND

R2b-2: NOT-SOUND

Two blockers, two majors, zero minors. Round-5 finding IDs start again at 1. Worktree f907c4c1065fac721a82d88d434f45a5ec0e972d. Scope is RW and R2b-2 only: prior B-1, M-1, B-2 and their deployment/test notes. R2b-1 and R4 retain SOUND; R3a/R3b/RH/RO retain their r4 results and are not re-reviewed. OD-22(a), OD-23(a), OD-24(a), and the narrowed OD-14 remain decided.

Reviewed the 2044-line design on local main at dbbaf472, SHA-256 `0f4767d9e5e3b8f6d1594976f1cbdffabf2b52e3bf2b3bb4ec69de9f2971c41a`. Design line references below refer to that snapshot. Source references without a main qualifier refer to f907c4c1. No production implementation changed. The independent findings were recorded before reading the author's report; its r5 response and qualifications were then compared with them. Its older appended reports were not used as independent evidence.

## Evidence log (retained working notes)

- Read the full round-5 brief, AGENTS.md and CLAUDE.md. Created only reviewer scratch /tmp/aosdr5 and marker /tmp/aosdr5-marker. Saved the prior report and real ~/.ao/bin listing. Earlier reviews stay untouched.
- Main was being updated at dispatch: the first git show returned path-not-found; the next read found the design commit dbbaf472. A local main snapshot is now saved. No fetch or network call was made.
- All Node, pnpm, helper, wrapper and test calls use env -i with scratch HOME/PATH/TMPDIR. Offline frozen install uses a copy of the local v3 cache. No real AO, OpenCode, Herdr, model, network gh, default tmux, push or PR is allowed or needed.
- At this stage the author report remained unread pending the independent closure and seedless-drain assessment. All /tmp/aosd5 inputs are read-only.

## Initial source notes (resolved below)

- W1/W2 remove the seed dependency: an orphan mv names the scratch record in argv even when its wrapper has disappeared. The three-clean-scan argument is conditional on every writer ancestor being classified busy throughout its lifetime and a complete /proc pass; the prototype implements W1/W2, not W3 or all W4 error cases. It does not inspect environments.
- The archive's “both directories cannot happen without damage” assertion conflicts with file-first creation: a concurrent restore/spawn can create an inbox candidate before its record CAS fails. RW has no operation lock. Test the interval after the archive directory rename.
- The stale-client wait matches only exe/argv[0] basename tmux. A held interpreter shim launched as tmux has exe/argv[0] sh or bash, and can survive its lock holder then exec the real client later. The planned held-shim test should exercise this exact matcher; the a1 prototype does not implement the stale-client wait at all.
- The restored legacy eligibility and snapshot catch-up are good corrections. Archive identity checks, snapshot consistency across applier calls, failed-state recovery and the post-barrier standing check still require boundary analysis.

## Independent measured findings (before reading the author's report)

- Prior B-1: closed for its three acceptance schedules under the stated fixed-writer/fence assumptions. The copied w2 experiment reproduces r4 losing the new record in first-scan orphan, between-scan birth/parent-death, and closed-source-FD cases; r5 preserves new generation 2 and the old PR in all three. No foreign process was waited on or signalled. The prototype lacks W3 and parts of W4; full implementation qualification remains required.
- Ordinary-host classification: an unrelated long-lived shell with `$0=gh` is W1; a read-only `tail -f` of the scratch record is W2. Both can make the barrier time out without being AO writers. An existing script in another checkout is excluded; unreadable environment alone is not an input to this classifier. These were owned fixtures and one-pass classifications, not waits on foreign processes.
- Prior M-1: partly closed. The copied i1 experiment reaches all 499 records in 17 calls, skips a >64 KiB damaged fragment, handles a boundary record and incomplete publication tail, applies marked legacy records, rejects legacy after a new launch, and recovers the isolated archive crash. New file-first races remain: an empty pending candidate can be pruned before reservation, and another launch can reserve/archive the entire inbox before the first candidate reserves. Both produce a successful record reservation naming a missing active inbox. A separate barrier ordering recreates a moved legacy inbox before archive recovery and misdiagnoses its own work as damage. These use real metadata reservation/CAS functions with explicit filesystem stand-ins for the proposed inbox protocol.
- Prior B-2: partly closed. All five copied association schedules are consistent under the proposed operation lock and retain foreign-token mismatch intent. A killed-holder experiment with a real private tmux server and a delayed interpreter shim defeats the new exe/argv[0] stale-client matcher: new recovery publishes T, then the old exact clear removes T. The prototype has no stale-client wait, so its green runs do not qualify this recovery boundary. The subsequent same-lock contention control is recorded below.
- Frozen offline install and build passed. New r5 tests: core 6 expected failures / 4 passes; tmux 3 expected failures / 9 passes. Changed r4 RW tests and controls: 2 expected failures / 3 passes / 2 OpenCode cases deliberately excluded. No setup failure explains the red results. No production inbox or writer-drain implementation exists in this worktree; test fallback models and scratch prototypes are identified as such.
- The same-lock control now passes (`EADDRINUSE` while the old holder lives); after that holder dies the new holder acquires the socket, finds no stale client, publishes T, and the held shell clear removes T. Its four recorded processes and private socket are gone.
- Additional RW inventory defect: an ordinary external Node script imports the real built `setupPathWrapperWorkspace`, changes cwd outside the build roots, and remains invisible to the proposed E5 argv/cwd predicate. In scratch it then overwrites the fenced wrapper with version 0.2.6. Thus E5 is enumerated but not actually detected by section 6.2. The standing hash poll notices a rewrite after it happens; it cannot make this pre-existing imported writer safe.
- Classification follow-up: a nondumpable fixture returns EACCES for `/proc/PID/environ` yet is still found by its record argv; an owned zombie is state Z and skipped. The rerun tracks shell children as well as their parents (9 PIDs), with none left. Typecheck and lint finish successfully; lint has five existing warnings.

## Closure of round-4 findings and notes

| Prior item | State | Reason |
| --- | --- | --- |
| B-1: seed-dependent drain misses old writers | Closed within the stated supported-writer assumptions | W1/W2 find all three required schedules in my reruns. The proof is now about bounded writer ancestry, not observing a seed. This does not qualify the separate old-build inventory, W3/W4 implementation, or arbitrary custom writers. |
| M-1: legacy eligibility and inbox lifecycle | Partly closed | Eligibility, held publication, failed state, parser progress, snapshot catch-up and late-line treatment are specified; measured positive cases work. Reservation/archive ownership and barrier recovery remain wrong: new B-1 and M-1. |
| B-2: concurrent association transitions | Partly closed | The moved operation lock fixes the live-holder schedules and mismatch retention. Recovery after holder death can still let an older exact clear land after publication: new B-2. |
| RW rollout/standalone claim | Partly closed | All-root fencing, legacy initialization, exact checks and E1–E5 enumeration improve the barrier. Section 4's file-first/CAS argument is insufficient, and the actual E5 predicate misses an admitted caller: B-1, M-1, M-2. |
| R2b-2 dependency/lock note | Partly closed | The lock is in the right earlier round and has a coherent order. Its side-effect lifetime boundary is incomplete; B-2 belongs in R2b-2. |
| Frozen-writer r4 oracle | Closed for the named test defect | Frozen source/hash controls and the PR assertion stop a no-op/new-helper-only “fix” from passing. Fixed sleeps and partial writer classifiers can still pass. |
| Preparing-branch r4 oracle | Partly closed, remaining scope explicitly deferred | It now checks launch ID, pane environment and published state; it still does not establish inbox/crash/restore behavior. Section 9 correctly lists further acceptance tests. |
| Association recovery and healthy legacy test notes | Partly closed | New exported-API loaders and plugin/core controls are useful. Current association tests are same-process schedules; CLI healthy calls and dead-holder recovery are still acceptance work. The landed send re-inventory is required. |

## New findings

### B-1 — File-first candidates have no ownership against prune or archive (RW)

Design §§3.2, 3.6, 3.7, 4: lines 157–176, 234–263, 294–296. Current code anchors: `packages/core/src/metadata.ts:845` (`reserveSessionRecord`), `:292` (record lock), `:644` (conditional update), `:666` (archive/delete). The proposed `inbox.ts` does not exist yet.

An unreferenced empty file is not necessarily obsolete: its maker may still be between steps 1 and 2. File-first creation and the later record lock do not protect that interval. Two deterministic schedules using the real built metadata functions and the proposed filesystem steps:

1. A creates `A.ndjson` for a free ID and pauses before reserving the record. Confirmed prune sees an empty file no record names and removes it. A's `reserveSessionRecord` succeeds. Its named inbox does not exist.
2. A creates `A.ndjson` for a free ID and pauses. B creates B's file and reserves/publishes the ID. C archives B, moving the entire inbox directory (including A's pending file), then conditionally removes B's record. A resumes and successfully reserves the now-free ID. Its file is under B's archive, not the active inbox.

Observed output:

```text
prune: A file exists before reservation true
prune: reservation succeeded; named inbox exists true false
archive: delayed A reservation succeeds; current inbox exists; A file archived true false true
```

The record CAS does not fail in either case. Both violate I1 before pane creation; the publication cannot read its required file and its helper cannot deliver normally. This is introduced by RW's filesystem protocol, not an accepted pre-R3a runtime/worktree interleaving. Fsync does not serialize ownership. A variant starts a restore candidate after step 3 while the old record still has `archiveIntent`, creating both directories before its CAS refuses; “both implies external damage” is also false.

Required change: under the existing synchronous record lock, validate free-ID/current identity and archive state, create the candidate, and reserve/replace the record as one transaction. Prune and archive/recovery must use compatible ownership checks under that same lock. Recover an archive before making a directory for the ID. Do not call a pending candidate obsolete merely because the record does not name it. If another protocol is chosen, give its durable ownership rule and the same schedules. These fixes belong to RW before R3a.

### B-2 — A dead holder's interpreter client escapes the stale-client wait (R2b-2)

Design §5.4 lines 338–344, §8 line 435, §9 line 446. Relevant implementation seam: proposed `core/src/operation-lock.ts`; current `packages/core/src/delivery-lock.ts` provides the socket-lock mechanism. Test anchors: `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r5.test.ts:205` (API), `:409` (association schedules). Author prototype `a1_assoc_serial.mjs` omits the wait, as §11.7 and §13 acknowledge.

A normal executable shim called `tmux` has `/proc/PID/exe=/usr/bin/dash` and argv `["/bin/sh", "/tmp/aosdr5/tmp/tmux", "display-message", ...]`. Neither exe nor argv[0] has basename tmux. It can already hold an exact, fully guarded command while waiting before exec. Killing the parent releases the operation socket but does not remove the child. The new holder's literal matcher finds no client.

Measured on real tmux, private server `aosdr5-stale`, with modeled JSON-record CAS and the proposed abstract operation lock:

```text
control: old holder owns the same operation socket true
held client argv ["/bin/sh","/tmp/aosdr5/tmp/tmux","display-message"]
held client exe /usr/bin/dash
new holder acquired lock; stale-client matches []
new resume ao-assoc-adopt:1211148
old delayed clear ao-server:1211148
ao-assoc-cleared:1211148
ao-end
published record token equals T; tmux token empty true true
foreign PIDs waited or signalled: []
started PIDs: 4; still running: []; own socket left: false
```

The first control attempts to bind the SAME abstract address and receives EADDRINUSE while the old holder lives. After its exact PID is killed, recovery acquires that address, adopts T and publishes the association. Releasing the old shell then clears precisely T. Exact token/evidence guards cannot distinguish that superseded operation from a valid clear of the same T.

Required change: cover the lifetime of every association-mutating client, including interpreter/pre-exec children, before allowing a new holder to act. A durable, checked child identity/completion protocol or a client lifetime lock must fail closed if completion cannot be proved. Adding argv[1] handles this one shim but is not a proof for wrappers/fork-before-exec. Move the necessary narrow lifetime protection into R2b-2; defer the other R3a work as planned. Test separate processes, killed holders, delayed exec and delayed server execution. This is the held-shim acceptance test already named in §9, executed against the specified matcher.

### M-1 — The barrier recreates a legacy inbox before recovering its archive (RW)

Design §3.6 lines 242–251 and §6.1 lines 384–387; code boundary `metadata.ts:666` and proposed CLI `barrier.ts` / `inbox.ts`.

Start with an eligible legacy record carrying `archiveIntent=T`. Archive step 3 has moved `.inbox/id` to the archive; crash before step 4. This is the explicitly recoverable crash state. On the next barrier, step 6a runs for **every active record without launchId**, recreating `.inbox/id/legacy.ndjson`. Step 7c now sees both directories, returns “inbox damaged,” and keeps admission closed. No external corruption or concurrent command is needed.

```text
legacy recovery: barrier recreated source; both directories; classification true inbox damaged
```

Recover archive intents before legacy initialization, or exclude archiving records from 6a/7b and ensure later initialization cannot recreate a retired directory. Run the full barrier sequence after every archive crash point; the author's isolated i1 archive recovery skips the initialization that causes this failure.

### M-2 — The E5 old-build inventory misses imported core outside build roots (RW)

Design §6.2 lines 404–411 and §6.3 lines 415–419. Executed code: `packages/core/src/agent-workspace-hooks.ts:587`, especially the version/content check at :604 and overwrite at :626. Proposed `build-inventory.ts` is not implemented.

A script may import core by absolute file URL/path, change cwd, and wait with the module resident. Neither its argv nor cwd need resolve under the core checkout. Section 6.2 explicitly includes such script importers in E5, but its concrete predicate does not find this ordinary call shape. Reading the build's current version on disk would not identify already loaded old text either.

My scratch script imports the actual built installer, uses an external cwd, writes a stand-in fenced wrapper under fake HOME, applies the stated build-root predicate to its actual argv/cwd, then calls the imported installer:

```text
entry argv ["node","/tmp/aosdr5/scripts/external-installer.mjs"]
cwd /tmp/aosdr5/external
E5 build-root predicate matches false
old imported installer overwrote fenced helper true version 0.2.6
```

The caller can predate the fence and remain alive through it. This does not depend on allowing a new old build after admission, and it is the old installer the inventory promises to drain. It reinstalls old shell code, invalidating §2.2's inference that a later managed-path exec necessarily reads new code. The standing poll detects a changed hash only afterwards; a writer can run before that poll.

Required change: make admitted old-core callers a provable closed inventory, or keep admission closed for unresolved script processes that can contain them. Cwd/argv hints alone cannot certify E5. If completeness instead requires an operator assertion about such callers, state that prerequisite and residual guarantee explicitly; do not present E5 as detected by this predicate. Add the external-import/changed-cwd case and a rewrite-plus-write between standing polls.

## Seedless drain assessment

The fence uses rename for every managed file and all worktree hooks, including inactive roots; it correctly avoids mutating a running interpreter's source inode. The backward ancestry proof works under A1–A4: a writer surviving scan 3 must have been born after its start, its busy parent after scan 2's start, and the depth-two root after scan 1's start, contradicting pre-fence creation. It is not a proof from three quiet time delays. Parent/child attribution is not needed at runtime.

My copied w2 runs reproduce r4 failure and r5 success for G (first-scan orphan), H (between-poll birth before parent death), K (old text without a managed FD), plus normal A and healthy F. R5 preserves `runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7` in every relevant case. The prototype waits only for my owned processes; any foreign busy match throws before waiting. All 66 recorded fixture PIDs ended.

One-pass ordinary-host probes, owned fixtures only:

| Fixture | Classification | Implication |
| --- | --- | --- |
| Read-only `tail -f <scratch record>` | W2 | Not an AO writer; can keep admission closed until the 10-minute timeout. This is already disclosed in §2.7. An editor whose argv names the record has the same issue. |
| Long-lived `/bin/sh -c 'sleep 30 & wait' gh` | W1 | Unresolvable basename fallback mistakes unrelated `$0=gh` for old writer text. No eventual clean scan while it lives. Document this extra false-positive cost; do not tell the owner it is necessarily an AO writer. |
| Same shell after `exec sleep` | none | No shell interpreter/managed argv remains. |
| Existing `other/gh` script in another checkout | none | Its resolved path is not a managed path of this state root. |
| Nondumpable Python, record path in argv | W2; environ read EACCES | Environment readability is unnecessary; it is not consulted for admission. |
| Owned zombie | Z, none | Empty cmdline is skipped; it cannot execute a delayed write. |
| New current-inode wrapper / unrelated old group | none (w2 F) | No whole-group false wait in r5. |

The design's unknown=>busy and timeout=>closed rules are appropriate; no foreign writer should be killed automatically. The prototype does not qualify them: it lacks W3, ignores some read failures, and its W2 path shortcut differs from the full relative-path rule. Production must distinguish ENOENT/disappeared from unreadable data and test those paths. I did not claim the 200 randomized repetitions, all historical writer versions, full /proc kernel semantics, or every W4 failure mode were measured. The author's strace/source-history evidence supports the fixed writer-depth assumption, not arbitrary imported/user scripts. M-2 concerns the separate old-installer inventory, not a counterexample to the conditional three-scan proof.

## Inbox crash and transition walk

| Boundary | Assessment |
| --- | --- |
| Before record reservation | Crash alone leaves a removable empty candidate. A live candidate is indistinguishable under the stated prune rule; B-1. |
| Reserved, pane not started | Preparing lines held. Barrier may mark failed only after all spawn callers are drained. Runtime deletion still requires R2a stop evidence. |
| Pane started, not published | Hold lines; only creator publishes. Crash recovery must retain unknown live runtime/resources. R2a's caught-error rollback is useful but is not itself a crash journal. |
| Publication | Record lock, launch/preparing/no-archive condition, complete prefix and cursor in one write are correct. i1 consumed offset 178/190 and later reached 212 when the tail completed. |
| Failed launch / restore | Failed lines must never apply; restore selects a new file and atomically removes legacy eligibility/cursor. Test both failed active and failed archived records, not just the success branch. |
| Parser | A 4096-byte frame limit permits skipping a longer unfinished fragment. Measured cursor progresses 65536 then 70057 instead of pinning. Boundary PR at offset 65506 is read on the next call. Preserve inode/launch checks throughout. |
| Catch-up | 499 x 2066 = 1,030,934 bytes need 17 calls; r5 reaches all 499, r4 only 496. Freeze both the selected launch/file identity and S0 across calls; if identity changes before the decision, retry/refuse. A caller cannot treat a cursor for another file as completion of the original snapshot. |
| Archive intent written, directory not moved | Record blocks normal application; recovery moves the directory. Re-read conditions under the record lock when concurrent recovery runs. |
| Directory moved, record still active | Isolated i1 recovery works, including cursor/late bytes; full barrier recovery fails for legacy M-1. File-first competitors violate the asserted exclusivity, B-1. |
| Record copy/unlink interrupted | Use the explicit archive name and idempotent recovery. An active intent must not permit another record identity to be copied/deleted. If no active record remains, do not touch a newly reserved ID as though it were the old archive. |
| Writer races archive | Missing directory sends an orphan; a recreated directory can receive an obsolete L1 file next to L2. Measured both. The applier must select only current L2; never merge obsolete/late data. |
| Cap/backlog | Loss after 1 MiB is explicit, not eventual delivery. The cap is soft, so §3.2's “at most 1 MiB” publication read cannot be a hard assumption. Bound actual snapshot/time and refuse if necessary; concurrent writers can overshoot. |

The i1 scratch parser/writer establishes these examples only. It does not implement every production value validator, cap check, filesystem-error path, or atomic record protocol. The pending-prefix, failed-state and missing/corrupt-inode cases remain required acceptance tests, not inferred from its green examples.

## Locks, rollout, and round claims

Operation -> record, no await under the record lock, one operation token per call chain and lifecycle try-once form a coherent R2b-2 order. Later store locking remains between operation and record; no store lock is needed in this round. Forward the same token through cleanup/kill/archive rather than reacquiring. A thenable rejection must happen before the callback can make an asynchronous mutation escape the critical section; throwing after an async callback already ran is only a diagnostic unless that continuation cannot mutate. Waiters have monotonic deadlines, not holder expiration. No required pair has an intentional circular wait if these rules hold. This is a source/design assessment, not a production deadlock stress test.

The moved callers cover association/recovery, retained association/stop, retire, kill, restore, cleanup, archive and lifecycle destructive actions. Send/attach remain guarded as planned. Keep the same lock subject/token API when R3a adds its other callers; the minimal association-client lifetime needed for B-2 cannot wait for R3a. Mismatch retention is correct: remove an intent on empty token only when **all** other evidence also matches. A foreign PID/session/pane with an empty token is still mismatch/unknown.

Section 4's applier and single-write publish rows are justified. Its reservation/restore/archive rows and “RW does not make it worse” assertion fail B-1/M-1. RW's §8 archive/inbox guarantees and E5 drain claim cannot be approved as written. R2b-2's live-holder serialization is justified; “every earlier tmux client ended” is false for B-2. Section 9 should place the fixes and their deterministic tests in these two rounds. The later rounds and decided owner choices remain outside this re-check.

Main already contains R2a and ao-54; neither is live merely because it landed. I read the landed main session-manager stop/rollback paths and send implementation without rebuilding/deploying that main tree. R2a's stop-result checks must remain effective in every RW cleanup and archive path; `preparing`/`failed` is not proof that a runtime is gone. The real old resident workers have no new epoch check. Exact-PID shutdown/drain before upgrade, saved restart environment, per-write epoch fences, and exact post-restart checks remain necessary. No barrier step was run on the real fleet.

The ao-54 re-inventory is now concrete. In landed `packages/cli/src/commands/send.ts`, `sendViaTmux` still sends C-u (:138), bracketed paste (:151) or literal text (:160), and initial Enter (:164), called at :367. The Codex post-send branch (:369–410) only reads; the non-Codex fallback still has two Enter sites (:425, :430). The shared core helper still has Escape/paste/literal/Enter (`core/src/tmux.ts:171`, :188, :199, :209); runtime-tmux still has launch-key/cleanup and ordinary C-u/paste/literal/Enter paths (`index.ts:145`, :147, :149, :153, :184, :194, :212, :218), destroy (:175), and attach command construction (:276). The implementation must also route the CLI session attach dispatch (`session.ts:187`, :195, :209 on main) and core/lifecycle callers through the effective identity resolver. This accepts the dependency plan, not the current unimplemented guard coverage. Add real private-server CLI healthy tokenless behavior and token/replacement/absence cases at each mutation, including non-Codex retry. Buffer loading alone does not target a pane; guarding it alone cannot protect the paste.

**OD-25: recommend (a), with its guarantee stated as detection and response.** Keep the no-old-build operating rule too. A poll can close admission only after seeing a rewrite; it cannot prevent writes between the rewrite and that poll, and closing new admission does not stop old code already running. Re-fence and drain before reopening, retain diagnostics and inspect potentially affected records. Do not equate a hash monitor with prevention or use it to excuse M-2's incomplete initial inventory. No new owner approval was assumed.

## Tests and limits of a green result

All commands ran under `env -i` with HOME=/tmp/aosdr5/home, PATH=/tmp/aosdr5/bin:/usr/bin:/bin, LANG=C.UTF-8, TMPDIR=/tmp/aosdr5/tmp. The local pnpm cache was copied into reviewer scratch; no network was used.

```text
pnpm install --frozen-lockfile --offline --store-dir /tmp/aosdr5/pnpm-store  PASS
pnpm build                                                               PASS
pnpm typecheck                                                           PASS
pnpm lint                                                                PASS, five existing warnings
SAME_ID_DEFECTS=red pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/same-id-defects-r5.test.ts
  6 failed, 4 passed
SAME_ID_DEFECTS=red pnpm --filter @aoagents/ao-plugin-runtime-tmux exec vitest run src/__tests__/same-id-defects-r5.test.ts
  3 failed, 9 passed
SAME_ID_DEFECTS=red pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/same-id-defects-r4.test.ts -t 'wrapper|pane|frozen'
  2 failed, 3 passed, 2 excluded
```

Total selected executed: 27, comprising 11 intended behavioral failures and 16 passes. New r5 alone: 22, nine failures and thirteen passes. The two excluded r4 cases involve OpenCode, which this brief forbids. I did not run the full monorepo suite or any Herdr/OpenCode process. The author's full-suite success and prototype validation remain author evidence. Missing production modules deliberately load r4 fallback models; these red runs are design reproducers, not evidence that an implemented r5 failed.

| Test (line at f907c4c1) | Actual failure | A wrong/partial fix that also passes |
| --- | --- | --- |
| core r5: old mv, wrapper died before first scan (:463) | old handle, expected new | Fixed sleep beyond the fixture's 400 ms release; record-path-only classifier lacking the rest of the barrier. |
| core r5: mv born between scans, parent dies (:467) | old handle, expected new | Same fixed sleep; an implementation that handles this one mv but misses other writer paths or failed /proc reads. |
| core r5: old text without managed FD (:471) | old handle, expected new | The same wait, or basename-only matching without the current-inode exclusion, can pass while blocking healthy hosts. |
| core r5: pre-RW legacy line (:652) | feat/app-1, expected feat/legacy-pane | Apply all records lacking launchId, ignoring inboxLegacy eligibility. The new-launch exclusion control does not distinguish that error. |
| core r5: 499-record catch-up (:673) | feat/v496-, expected feat/v499- | Change fixed 16 iterations to 17, or read an unbounded whole file without budget/S0 semantics. |
| core r5: damaged fragment (:714) | feat/before, expected feat/after | Jump to a later RS while dropping valid earlier records, or omit other schema/size/identity checks; only the final branch is asserted. |
| tmux r5: abandon paused before clear (:415 vicinity) | record names T, tmux empty | Process-local mutex, no cross-process exclusion or killed-holder client handling. |
| tmux r5: resume paused before set (:437 vicinity) | record empty, tmux T | Same process-local mutex. Promise.allSettled also means unexpected rejections need explicit assertions in future tests. |
| tmux r5: another token retains intent (:454 vicinity) | intent removed | Refuse all mismatched clears while omitting mismatch state, resume refusal, forget-intent, or operation locking. The test checks retained token/intent, not the whole recovery protocol. |
| changed core r4: old wrapper/barrier (:177) | old handle, expected new | Fixed delay beyond release, or incomplete drain; frozen fixture/PR now correctly defeat a no-op writer. |
| changed core r4: pane's preparing branch (:271) | session/app-1, expected feat/agent-switched | Preserve branch and add matching launchId/env/published fields without implementing held inboxes, failed/archive handling, restore isolation or cursor validation. |

The boundary control checks final values after two reads, not an exactly-once effect count; repeated application of the same branch/PR can pass. Same-process association pause controls cannot prove a kernel lock is used. Add the three inbox ownership/recovery schedules above, external-import inventory, held-shim death, and the already listed production acceptance cases. Keep successful legacy send/kill controls, not only refusal assertions.

## Correct changes worth retaining

- Seedless classification fixes the three concrete old-writer escapes; fixed supported-writer ancestry makes the clean-scan argument inspectable.
- Explicit legacy eligibility and atomic removal on first launch eliminate the earlier contradictory selection rule.
- Complete-prefix publication, visible failed records, non-pinning framing and snapshot catch-up are useful concrete contracts.
- Obsolete/late/orphan data are visible and never silently replayed into another launch; cap loss is honestly disclosed.
- Association serialization moved to the required round, and evidence mismatch is now a durable recoverable state.
- Frozen pre-RW fixtures, semantic PR assertions and healthy plugin/core legacy controls improve the tests.

## Reproducer preservation

The following are reviewer scratch scripts, not production changes. Run only with an empty environment and a fresh `/tmp/aosdr5`; the tmux script uses only `aosdr5-stale`. The metadata experiment calls real built functions, but models the proposed inbox filesystem operations explicitly. The association script uses real tmux and kernel sockets with a modeled record. Copied author experiments w2/i1/a1 are preserved in full in design r5 §14; my copies substitute the reviewer root/server names, add PID ownership/start checks, and reject foreign busy matches before waiting. Their measured outputs are summarized above. No script here should be run against the real state root.

### B-1 and M-1: inbox-races.mjs

```js
import {mkdirSync,writeFileSync,existsSync,renameSync,rmSync,readdirSync} from 'node:fs';
import {reserveSessionRecord,readMetadataRaw,updateMetadataIf,deleteMetadata} from '/home/taisung/.worktrees/agent-orchestrator/ao-51/packages/core/dist/metadata.js';
if(Object.keys(process.env).some(k=>k.startsWith('AO_')))throw new Error('not scratch env');
const root='/tmp/aosdr5/inbox-races';
function setup(name) {
 const dir=root+'/'+name;mkdirSync(dir+'/.inbox/app-1',{recursive:true});mkdirSync(dir+'/archive',{recursive:true});
 return {dir,box:dir+'/.inbox/app-1'};
}
function candidate(box,L){mkdirSync(box,{recursive:true});writeFileSync(box+'/'+L+'.ndjson','',{flag:'wx'});}
{
 const {dir,box}=setup('prune');
 candidate(box,'A');
 // A pauses before record O_EXCL. Owner prune sees an empty file no record names.
 console.log('prune: A file exists before reservation',existsSync(box+'/A.ndjson'));
 rmSync(box+'/A.ndjson');
 const a=reserveSessionRecord(dir,'app-1',{launchId:'A',launchState:'preparing'});
 console.log('prune: reservation succeeded; named inbox exists',!!a,existsSync(box+'/A.ndjson'));
}
{
 const {dir,box}=setup('three-operations');
 candidate(box,'A'); // A starts on an actually free ID, then pauses before O_EXCL record.
 candidate(box,'B');
 const b=reserveSessionRecord(dir,'app-1',{launchId:'B',launchState:'published'});
 if(!b)throw new Error('B must win');
 updateMetadataIf(dir,'app-1',{launchId:'B'},{archiveIntent:'T'});
 renameSync(box,dir+'/archive/app-1_T.inbox');
 // The proposed explicit-name archive copy then conditional removal, using existing metadata lock/CAS.
 writeFileSync(dir+'/archive/app-1_T',JSON.stringify(readMetadataRaw(dir,'app-1')));
 deleteMetadata(dir,'app-1',false,{launchId:'B',archiveIntent:'T'});
 const a=reserveSessionRecord(dir,'app-1',{launchId:'A',launchState:'preparing'});
 console.log('archive: delayed A reservation succeeds; current inbox exists; A file archived',!!a,existsSync(box+'/A.ndjson'),existsSync(dir+'/archive/app-1_T.inbox/A.ndjson'));
}
{
 const {dir,box}=setup('legacy-recovery');
 candidate(box,'legacy');
 reserveSessionRecord(dir,'app-1',{inboxLegacy:'barrier-old',archiveIntent:'T'});
 renameSync(box,dir+'/archive/app-1_T.inbox'); // crash after archive step 3
 // New barrier 6.1 step 6a, before recovery 7c: every active record without launchId.
 candidate(box,'legacy');
 const both=existsSync(box)&&existsSync(dir+'/archive/app-1_T.inbox');
 console.log('legacy recovery: barrier recreated source; both directories; classification',both,both?'inbox damaged':'recoverable');
}
console.log('All operations used scratch files. File/record protocols are explicit design stand-ins, not a production inbox implementation.');
```

### B-2: stale-client.mjs

```js
// a1 (review r4 B-2, design r5 section 4): concurrent association transitions on a private tmux 3.4 server
// (-L aosdr5-stale only). The tmux forms are the compare-and-set forms of design r4 section 3.2 (associate
// with adopt, the exact clear), as in t4. The record is a JSON stand-in with the compare of the launch
// identity (associationIntent and runtimeAssociation are launch-identity keys). Two protocols:
//   r4: no lock; each operation reads the intent, runs its tmux call, then its record compare-and-set.
//   r5: each operation holds the per-ID operation lock (a Linux abstract Unix socket, as delivery-lock.ts:
//       EADDRINUSE means busy, no process-local reentrancy) from its first record read to its last record
//       write; an abandon whose exact clear finds another token keeps the intent with a mismatch note.
// Each operation can pause before and after its tmux call and before and after its record write.
// Schedules: (i) abandon paused before its tmux call while a resume runs; (ii) resume paused before its tmux
// call while an abandon runs; (iii) the token is set (a lost answer); abandon paused before its record write
// while a resume runs; (iv) resume paused before its record write while an abandon runs; (v) abandon when
// tmux has a token that no record names. After each schedule: is the tmux token the one the record names?
// Run:
//   env -i HOME=/tmp/aosdr5/home PATH=/tmp/aosdr5/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosdr5/tmp \
//     SHELL=/bin/sh TERM=xterm-256color node /tmp/aosdr5/scripts/a1_assoc_serial.mjs
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosdr5";
const SRV = "aosdr5-stale";
const sock = `/tmp/tmux-${process.getuid()}/${SRV}`;
if (existsSync(sock)) throw new Error(`${sock} exists: not started by this script`);
const started = new Map();
const ticks = (p) => { try { return readFileSync(`/proc/${p}/stat`,"utf8").split(") ").at(-1).split(" ")[19]; } catch { return null; } };
const starts = new Map();
function track(pid, what) { if (pid && !started.has(pid)) { started.set(pid, what); starts.set(pid,ticks(pid)); appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} a1 ${what} pid=${pid}\n`); } }
function tm(args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
const q = (f) => `"${f}"`;
const token = () => randomBytes(16).toString("hex");
const tokOf = (name) => tm(["display-message", "-p", "-t", `=${name}:`, "#{@ao_launch}"]).out;
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const IDENT = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}";
const want = (name, ev) => `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
function associateArgs(name, ev, tok) { // design r4 3.2 step 4
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/}`)} { ${set} } { ${second} }`);
}
function clearArgs(name, ev, tok) { // design r4 3.3: the exact clear
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}}`)} { ${clear} } { ${no} }`);
}
const mark = (r) => r.out.split("\n").find((l) => l.startsWith("ao-assoc") || l.startsWith("ao-refused")) ?? r.out;

// ---- the record stand-in: one JSON file, replaced by rename; the compare is of the launch identity ----
const recPath = `${S}/tmp/a1-record.json`;
const readRec = () => JSON.parse(readFileSync(recPath, "utf8"));
const writeRec = (o) => { writeFileSync(`${recPath}.w`, JSON.stringify(o)); renameSync(`${recPath}.w`, recPath); };
const identity = (r) => JSON.stringify([r.associationIntent ?? null, r.runtimeAssociation ?? null, r.runtimeHandle]);
function casRec(expected, patch) { const r = readRec(); if (identity(r) !== expected) return false; writeRec({ ...r, ...patch }); return true; }

// ---- the per-ID operation lock (r5): an abstract socket, busy on EADDRINUSE, 20 ms retry, 30 s deadline ----
async function opLock(id) {
  const name = `\0aosdr5-a1-operation-${id}`;
  const t0 = performance.now();
  for (;;) {
    const srv = createServer();
    const ok = await new Promise((res) => { srv.once("error", (e) => res(e.code === "EADDRINUSE" ? false : Promise.reject(e))); srv.listen(name, () => res(true)); });
    if (ok) return { release: () => new Promise((r) => srv.close(r)), waitedMs: Math.round(performance.now() - t0) };
    if (performance.now() - t0 > 30_000) throw new Error("operation lock busy for 30 s");
    await sleep(20);
  }
}

async function resume(name, mode, pause) {
  const lock = mode === "r5" ? await opLock(name) : null;
  try {
    const r = readRec();
    if (!r.associationIntent) return "no intent";
    const { token: T, ev } = r.associationIntent; const id0 = identity(r);
    await pause("before-tmux");
    const out = mark(tm(associateArgs(name, ev, T)));
    await pause("after-tmux");
    if (!/^ao-assoc(-adopt)?:/.test(out)) return `tmux ${out}`;
    await pause("before-record");
    const ok = casRec(id0, { associationIntent: null, runtimeAssociation: { token: T, ev } });
    await pause("after-record");
    return `tmux ${out.split(":")[0]}; record ${ok ? "published" : "compare failed"}${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
  } finally { await lock?.release(); }
}
async function abandon(name, mode, pause) {
  const lock = mode === "r5" ? await opLock(name) : null;
  try {
    const r = readRec();
    if (!r.associationIntent) return `no intent${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
    const { token: T, ev } = r.associationIntent; const id0 = identity(r);
    await pause("before-tmux");
    const out = mark(tm(clearArgs(name, ev, T)));
    await pause("after-tmux");
    const cleared = out.startsWith("ao-assoc-cleared");
    const tokenless = out === `ao-assoc-refused:${want(name, ev)}/`; // the evidence session, no token: T was never set
    await pause("before-record");
    let ok;
    if (mode === "r4" || cleared || tokenless) ok = casRec(id0, { associationIntent: null }); // r4 removes the intent in every case
    else ok = casRec(id0, { associationIntent: { ...r.associationIntent, mismatch: out } }) && "kept with mismatch";
    await pause("after-record");
    return `tmux ${out.split(":")[0]}; record ${ok === true ? "intent removed" : ok || "compare failed"}${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
  } finally { await lock?.release(); }
}

// A pause point: the named operation stops at `at` until `release` is called.
function pauser(at) {
  let reached, release; const r = new Promise((x) => (reached = x)); const g = new Promise((x) => (release = x));
  return { pause: async (p) => { if (p === at) { reached(); await g; } }, reached: r, release };
}
const none = { pause: async () => {} };

function verdict(name) {
  const r = readRec(); const tok = tokOf(name);
  const named = r.runtimeAssociation?.token ?? "";
  const intent = r.associationIntent?.token ?? "";
  const consistent = r.associationIntent ? tok === "" || tok === intent : tok === named;
  const foreign = tok !== "" && tok !== r.T; // only the setup of (v) makes such a token
  const result = foreign ? `token of the setup; intent kept: ${r.associationIntent ? "yes" : "NO"}` : consistent ? "CONSISTENT" : "INCONSISTENT";
  return `record ${JSON.stringify({ intent: intent ? "T" : "", mismatch: r.associationIntent?.mismatch ? "yes" : "", association: named ? (named === intent || named === r.T ? "T" : "other") : "" })}; tmux token ${tok === r.T ? "T" : tok === "" ? '""' : "other"}; ${result}`;
}

try {
 const name="stale-aosdr5";
 for(const file of ["stale-ready","stale-go","stale-client.pid"]) if(existsSync(`${S}/tmp/${file}`))unlinkSync(`${S}/tmp/${file}`);
 tm(["new-session","-d","-s",name,"/bin/sleep 600"]);
 track(Number(tm(["display-message","-p","#{pid}"]).out),"tmux server aosdr5-stale");
 track(Number(tm(["display-message","-p","-t",`=${name}:`,"#{pane_pid}"]).out),"pane");
 const [serverPid,sid,panePid]=tm(["display-message","-p","-t",`=${name}:`,"#{pid}|#{session_id}|#{pane_pid}"]).out.split("|");
 const ev={serverPid,sid,panePid},T=token();
 writeRec({runtimeHandle:name,T,associationIntent:{token:T,ev},runtimeAssociation:null});
 tm(associateArgs(name,ev,T)); // an earlier successful tmux step, awaiting record recovery
 const script=`${S}/tmp/tmux`;
 writeFileSync(script,`#!/bin/sh\necho $$ > '${S}/tmp/stale-client.pid'\n: > '${S}/tmp/stale-ready'\nwhile [ ! -e '${S}/tmp/stale-go' ]; do /bin/sleep 0.02; done\nexec /usr/bin/tmux -f /dev/null -L ${SRV} "$@"\n`,{mode:0o755});
 writeFileSync(`${S}/tmp/stale-args.json`,JSON.stringify(clearArgs(name,ev,T)));
 const holderSource=`import {createServer} from 'node:net';import{spawn}from'node:child_process';import{readFileSync,openSync}from'node:fs';const s=createServer();s.listen('\\0aosdr5-a1-operation-${name}',()=>{spawn('${script}',JSON.parse(readFileSync('${S}/tmp/stale-args.json','utf8')),{stdio:['ignore',openSync('${S}/logs/stale-old-clear.out','w'),'ignore']});});`;
 const holder=spawn(process.execPath,["--input-type=module","-e",holderSource],{env:process.env,stdio:"ignore"});
 track(holder.pid,"old operation holder");
 const exited=new Promise(r=>holder.once("exit",r));
 for(let i=0;i<500&&!existsSync(`${S}/tmp/stale-ready`);i++)await sleep(10);
 if(!existsSync(`${S}/tmp/stale-ready`))throw new Error("holder/shim did not start");
 const probe=createServer();
 const busy=await new Promise((resolve,reject)=>{probe.once("error",e=>e.code==="EADDRINUSE"?resolve(true):reject(e));probe.listen(`\0aosdr5-a1-operation-${name}`,()=>probe.close(()=>resolve(false)));});
 console.log("control: old holder owns the same operation socket",busy);
 if(!busy)throw new Error("old holder did not own the operation lock");
 const client=Number(readFileSync(`${S}/tmp/stale-client.pid`,"utf8"));track(client,"held shim client");
 console.log("held client argv",JSON.stringify(readFileSync(`/proc/${client}/cmdline`,"utf8").split("\0").slice(0,3)));
 console.log("held client exe",readlinkSync(`/proc/${client}/exe`));
 process.kill(holder.pid,"SIGKILL");await exited;
 const lock=await opLock(name);
 const matches=[];
 for(const entry of readdirSync("/proc")) {
   if(!/^\d+$/.test(entry))continue;
   try {
     if(statSync(`/proc/${entry}`).uid!==process.getuid())continue;
     const args=readFileSync(`/proc/${entry}/cmdline`,"utf8").split("\0").filter(Boolean);
     let exe;try{exe=readlinkSync(`/proc/${entry}/exe`).split("/").at(-1);}catch{exe=args[0]?.split("/").at(-1);}
     if(exe!=="tmux"&&args[0]?.split("/").at(-1)!=="tmux")continue;
     if(args.some(a=>a.includes(`=${name}`)))matches.push(Number(entry));
   }catch{}
 }
 console.log("new holder acquired lock; stale-client matches",JSON.stringify(matches));
 if(matches.length)throw new Error("will not wait for unowned clients");
 const r=readRec(); console.log("new resume",mark(tm(associateArgs(name,ev,T))));
 casRec(identity(r),{associationIntent:null,runtimeAssociation:{token:T,ev}});
 await lock.release();
 writeFileSync(`${S}/tmp/stale-go`,"");
 for(let i=0;i<200&&tokOf(name)!=="";i++)await sleep(10);
 console.log("old delayed clear",readFileSync(`${S}/logs/stale-old-clear.out`,"utf8").trim());
 console.log("published record token equals T; tmux token empty",readRec().runtimeAssociation.token===T,tokOf(name)==="");
 console.log("foreign PIDs waited or signalled: []");
} finally {
  const srvPid = [...started].find(([, w]) => w.startsWith("tmux server"))?.[0];
  for (const [p, w] of started) if (!w.startsWith("tmux server") && ticks(p)===starts.get(p)) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  if (srvPid && ticks(srvPid)===starts.get(srvPid)) { try { process.kill(srvPid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  await sleep(200);
  if (srvPid && existsSync(sock)) unlinkSync(sock); // the socket of the server that this script started
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(sock)}`);
}
```

### M-2: external-installer.mjs

```js
import { setupPathWrapperWorkspace, WRAPPER_VERSION, GH_WRAPPER } from '/home/taisung/.worktrees/agent-orchestrator/ao-51/packages/core/dist/agent-workspace-hooks.js';
import { mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync,readlinkSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
const root='/tmp/aosdr5/external';
if(!process.env.HOME.startsWith('/tmp/aosdr5/')||Object.keys(process.env).some(k=>k.startsWith('AO_')))throw new Error('not scratch');
mkdirSync(root,{recursive:true});process.chdir(root);
const bin=process.env.HOME+'/.ao/bin';mkdirSync(bin,{recursive:true});
writeFileSync(bin+'/gh','new fenced wrapper');writeFileSync(bin+'/.ao-version','RW');
const args=readFileSync(`/proc/${process.pid}/cmdline`,'utf8').split('\0').filter(Boolean), cwd=readlinkSync(`/proc/${process.pid}/cwd`);
function underBuild(p){let d=resolve(cwd,p);while(d!=='/'){if(existsSync(d+'/packages/core/package.json')||existsSync(d+'/node_modules/@aoagents/ao-core'))return true;d=dirname(d);}return false;}
console.log('entry argv',JSON.stringify(args));console.log('cwd',cwd);
console.log('E5 build-root predicate matches',args.some(underBuild)||underBuild(cwd));
await setupPathWrapperWorkspace(root);
console.log('old imported installer overwrote fenced helper',readFileSync(bin+'/gh','utf8')===GH_WRAPPER,'version',WRAPPER_VERSION);
```

## Isolation and final cleanup audit

Marker: `/tmp/aosdr5-marker`, created 2026-10-21 22:09:49.414499588 -0400. Every helper/test/Node/pnpm/Python invocation had an empty environment and a fake HOME; no inherited AO variables. Real gh was never run; scratch gh was a stub. Private tmux only: aosdr5-assoc, aosdr5-stale and the test shim/private sockets. No real AO command, model turn, Herdr, OpenCode, network, push, PR, memory/config change or source edit. Earlier reviews remain unmodified.

The seedless classifier READ same-uid `/proc` entries (stat/uid, cmdline, cwd/exe links and descriptor links as needed); it did not read environment contents. The stale-client experiment read same-uid cmdline/exe to apply its matcher. The final ownership audit also read environments, filtering only HOME/TMPDIR for reviewer scratch and printing no environment contents. Below is the deduplicated PID read audit from w2/classification, not a claim that every PID was a writer or was waited on. Every foreign busy match was rejected before waiting. No foreign PID was signalled or stopped.

```text
recorded own PIDs 108
recorded own PIDs still present []
same-uid cmdlines read in final audit 76
unreadable environments [{"pid": 13870, "exe": "/usr/lib/systemd/systemd"}, {"pid": 13874, "exe": "(sd-pam)"}, {"pid": 884550, "exe": "sshd: taisung@pts/14"}, {"pid": 1184949, "exe": "sshd: taisung@pts/10"}, {"pid": 1185562, "exe": "sshd: taisung@notty"}, {"pid": 1185683, "exe": "/usr/lib/openssh/sftp-server"}, {"pid": 4094130, "exe": "sshd: taisung@notty"}, {"pid": 4094131, "exe": "/usr/lib/openssh/sftp-server"}, {"pid": 4094324, "exe": "sshd: taisung@pts/6"}]
own processes (excluding this audit and ancestors) []
w2/classification recorded reads: 365 distinct entries
w2/classification proc PID audit: 13870,13874,13893,13895,13899,13901,13904,13943,14053,14112,100858,101160,101162,101169,104346,122814,122817,122818,271595,271596,425350,425595,425597,425604,426483,426714,426717,426718,884550,884583,886150,1008839,1008936,1011640,1014276,1017267,1017289,1017291,1017751,1017753,1017754,1017755,1017756,1017759,1017765,1017771,1017777,1017896,1017902,1017903,1017904,1017905,1017919,1017948,1018011,1018012,1018013,1018014,1018015,1018017,1018022,1018033,1018034,1018070,1018073,1018075,1018076,1018083,1018085,1018086,1018092,1018104,1018112,1018124,1018130,1018136,1018142,1018143,1018149,1018202,1018203,1018206,1018207,1018217,1018227,1018246,1018285,1018310,1018329,1018349,1018401,1018730,1018775,1018791,1018796,1018812,1018819,1018827,1018869,1018872,1018874,1018876,1018877,1018883,1018884,1018885,1018886,1018887,1018893,1018894,1018905,1018913,1018916,1018949,1018959,1018960,1018963,1018972,1018973,1018975,1018983,1018995,1019001,1019010,1019018,1019019,1019020,1019038,1019044,1019046,1019110,1019127,1019134,1019135,1019136,1019137,1019138,1019139,1019140,1019141,1019142,1019143,1019144,1019145,1019146,1019147,1019148,1019149,1019150,1019151,1019152,1019179,1019182,1019191,1019203,1019221,1019228,1019241,1019243,1019302,1019303,1019316,1019322,1019323,1019324,1019325,1019326,1019327,1019328,1019329,1019330,1019331,1019332,1019333,1019336,1019337,1019338,1019339,1019340,1019341,1019342,1019343,1019344,1019345,1019346,1019347,1019348,1019349,1019351,1019513,1019519,1019617,1019618,1019632,1019636,1019638,1019639,1019651,1019669,1019696,1019697,1019711,1019721,1019723,1019724,1019725,1019726,1019727,1019728,1019751,1019752,1019877,1019882,1019885,1019909,1019912,1019948,1019952,1019983,1019985,1020052,1020054,1020087,1020089,1020111,1020114,1020140,1020143,1020174,1020240,1020241,1020243,1020245,1020246,1020252,1020254,1020256,1020259,1020261,1020263,1020267,1020268,1020273,1020274,1020275,1020277,1020282,1020382,1020442,1020446,1020447,1020448,1020465,1020468,1020470,1020472,1020474,1020476,1020478,1020480,1020540,1020562,1020563,1020565,1020567,1020569,1020571,1020573,1020576,1020578,1020580,1020586,1020597,1020646,1020683,1020687,1020688,1020689,1020691,1020693,1029971,1029972,1029975,1063027,1065673,1065716,1068449,1068522,1068872,1068950,1069075,1069150,1069154,1069155,1069156,1069157,1069187,1101402,1101403,1102127,1104643,1184949,1185283,1185562,1185683,1186824,1193644,1225032,1225044,1233026,1233197,1233504,1233665,1236665,1245441,1245442,1245502,1249562,1249568,1249577,1249578,1249586,1249587,1249588,1249589,1249590,1249591,1249592,1249593,2256355,2326871,2327113,2327115,2327122,2330394,2825345,2825582,2833055,2833080,2833081,3624110,3626937,3636899,3636901,3636903,3636904,3753189,3753412,3760581,3760584,3760585,3827681,3829571,3845631,3845634,3845635,4094130,4094131,4094324,4094364,4098878,4098885,4099210,4099358,4106554
protected worker states {"3624110": "gone", "3626937": "gone"}
own socket paths []
```

All 108 recorded child/server/fixture PIDs are absent. The final uid scan found no process with reviewer scratch argv/environment, apart from the audit itself and its launcher ancestors. Nine unreadable environments belonged to the listed system/login processes; none was an owned fixture. Tests and build/typecheck/lint commands returned and their sessions were collected. No name-based kill was used; intentional signals targeted recorded fixture PIDs. The first classification run tracked shell parents only; its short-lived sleep children had already exited by the final audit. The repeat explicitly tracked them too.

The originally protected workers 3624110 and 3626937 were read-only during drain scans and are absent at final audit. The real PID files now name 1294181 (agent-orchestrator) and 1294364 (agent-skills), with timestamps 22:37:32 and 22:37:35. I neither stopped nor restarted these workers. This is concurrent external lifecycle activity; the metadata does not prove which controller or PID caused it. No orchestrator pane was read.

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

The diff is empty, including timestamps. No test or installer used the real HOME.

Required real-state scan (latest snapshot):

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr5-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-59
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-58
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

Every entry is accounted for below. These are observations, not exact-writer attribution from a filesystem timestamp. None is an output path of my sanitized calls.

| Entry (under ~/.agent-orchestrator) | Attribution supported by this review |
| --- | --- |
| f6790d5546be-agent-skills | Directory changed during external worker activity around 22:37:35. |
| f6790d5546be-agent-skills/lifecycle-worker.pid | Contains 1294364, updated 22:37:35; external worker replacement, initiating actor unknown. |
| 60756641ca25-agent-orchestrator | Directory changed around external worker activity at 22:37:32. |
| 60756641ca25-agent-orchestrator/lifecycle-worker.pid | Contains 1294181, updated 22:37:32; external worker replacement, initiating actor unknown. |
| 60756641ca25-agent-orchestrator/sessions | Real record/directory-entry changes, including the sessions below; no reviewer writes. |
| .../sessions/ao-59 | Newly observed real session while final audit was running; external launch activity, exact writer unknown. |
| .../sessions/ao-52 | Real session record, working, mtime 22:38:03; external session/lifecycle activity, exact writer unknown. |
| .../sessions/ao-54 | Real session record, stuck, mtime 22:39:33; external session/lifecycle activity, exact writer unknown. |
| .../sessions/.generations | Real reservation-generation directory changed with new session entries; external allocation activity, exact writer unknown. |
| .../sessions/ao-58 | Newly observed real session while final audit was running; external launch activity, exact writer unknown. |
| .../sessions/ao-orchestrator | Real orchestrator record, working, mtime 22:24:08; external orchestrator/session activity, exact writer unknown. |

The checked ao-52/ao-54/orchestrator records contain no aosdr5 path. I did not inspect unrelated session content beyond status/branch/issue fields or change these records. The find output includes concurrent changes rather than being reported as empty.

Cleanup completed: `/tmp/aosdr5` and `/tmp/aosdr5-marker` removed; own private socket list `[]`; own remaining fixture process list `[]`. Only the review and the atomic report deliverable were written in the worktree. No commit or PR.
