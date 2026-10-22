# Same-ID design r8 — RW and R2b-2 re-check by ao-62

RW: SOUND-WITH-CHANGES

R2b-2: SOUND-WITH-CHANGES

**0 blockers, 3 majors, 0 minors.** Finding numbers restart in this review. R8 fixes the observed partial archive exposure and late-bootstrap counterexamples, and its tests now reject both r7 discriminators. Required changes remain in archive durability on retry, the replacement creation order, and the tests' launch-token contract. These are design verdicts, not approval of a production implementation.

Scope is RW and R2b-2 only. The stopped-fleet policy and all decided ODs, including OD-25(a), OD-26(a), OD-27(b), OD-28(b) and OD-29(a), stay decided. No new owner decision is needed. R3a's child-lifetime/worktree work remains deferred.

Read the complete new brief, the inherited r7 rules, CLAUDE.md, the res-audit skill and the full r7 review before assessing r8. Design: local `main:development/reviews/same_id_design_r8_opus.md`, 2135 lines. Test tip: `48c2612992900381b4e6e98e1edd52654f976d63`, branch `review/same-id-design-r8`; change range `fe5d6575..48c26129`. Main source/build snapshot: `84b6776c481d18aaf61aaba52ac22221c4f42640`, including landed R4. Source line numbers below refer to that main snapshot unless identified as a test or pasted prototype. The author's report was opened only after independently assessing brief items 1 and 2, including the archive faults and private-server bootstrap schedule.

## State of the r7 findings

| r7 finding | New state | Evidence and remaining work |
| --- | --- | --- |
| M-1, atomic record-archive publication | Partly closed | The hidden temporary file, complete write, file fsync and no-overwrite link fix the measured short copy. All five recovery callers retain the full archive, and equal final files keep inode/mtime. The new archive-update rule fixes the second selectable-temporary writer. However, retry through an equal final name skips the directory fsync that may have failed; new M-1. |
| M-2, creation coverage and residual | Partly closed | Worker spawn, both orchestrator modes and restore are now explicitly assigned the operation lock, recheck, name fence and operation-bearing create. Missing operation throws with zero tmux calls in the prototype. Guarded bootstrap refuses the r7 late-bootstrap schedule; the revised residual is accurate. The replacement order drops the existing-session fence before the record write; new M-2. |
| M-3, test discrimination | Partly closed | Token-only comparison now fails three tests. The r7 barrier accepting P1 allows fails four r8 tests. The changed competing-spawn assertion requires the actual ID-taken refusal. New M-3: the core tests reject the required `launchToken` property, while the suite accepts omission of durability and token propagation. |
| m-1, audit's durable value and interrupted fence | Closed in the design | `tmuxLaunchToken` is written before create, retained on failure, and precedes handle and association tokens. The audit reads `@ao_launch`, not `@ao_op`. Its five classes distinguish a known failed launch, an association in progress and a session no record names. Own fallback/intent cases agree; production validation still needs the integration tests described below. |

## New findings

### M-1 — Recovery must establish directory durability before removing the active record (RW)

Design §1, steps 2, 5–7 and the equal-final recovery row (lines 35–46, 80); §6 RW recovery claim; §7.1 fault acceptance. Code boundary: `packages/core/src/metadata.ts:713` and :716, where RW will replace the archive write and active unlink. The pasted r8 prototype has the defect at design lines 1467 and 1476 (both early `kept` returns), 1478 (the skipped archive-directory sync), and 1489–1497 (move/recovery/unlink). The equivalent scratch source is `val/dist/inbox.js:50`, :59, :61 and :72–80.

A successful link proves that a complete file is visible. It does not establish that the directory entry has passed the protocol's durability check. The equal-file branch is precisely how recovery resumes after interruption between link and directory fsync, yet §1 sends it straight to active unlink.

Own fault injection into the unmodified copied r8 prototype:

```text
first attempt: fsync(archive/) throws injected EIO
state: complete final archive visible; active record and intent still present
retry, with the same archive-directory fsync fault still armed:
  result = finished
  fault fired on retry = false
  events = rename generation-floor temporary; unlink active record; fsync sessions directory
  active record exists = false
  archive branch = feat/full
```

The retry never attempts `fsync(archive/)`. A second schedule fails `fsync(.inbox-archive/)` just after the inbox rename. Recovery sees the destination, skips both move-directory syncs, publishes the record archive and removes the active record. The equal `EEXIST` branch also reaches active unlink without syncing `archive/`; the unequal branch correctly retains the active record and final file.

This is a measured omission of required durability checks, **not a claim that a power-loss data-loss event was reproduced**. A readable complete file, and even successful syncing of the parent sessions directory, are not the stated check for persistence of entries inside `archive/` and the two inbox directories. The design must not treat a failed sync as completed merely because its preceding namespace operation is visible.

Required change: every successful publication path, including equal-final and equal-`EEXIST`, must establish the final archive's required durability and sync `archive/` before active unlink. A recovery that finds the inbox already moved must likewise complete the relevant source/destination directory syncs before retiring the active record. Syncing an equal file/directory does not rewrite the file or change its inode/mtime. Persistent sync failure must retain the active intent and refuse completion. Add assertions for this ordering, failures before and after each sync, and recovery through the listed callers. Handle creation of the archive/inbox directories with the same explicit parent-directory durability discipline.

Reproducer is retained below as `archive-faults.mjs`; it arms each fault twice. The archive-directory and moved-inbox cases finish on the second call without triggering the still-armed fault, unlike the temporary-write, temporary-file-fsync, link, temporary-removal and active-unlink cases.

### M-2 — Keep the existing-session fence in the replacement creation order (R2b-2)

Design §3 explicitly replaces the order of r7 §5.3. Its new steps 4–5 (lines 142–146) go directly from **name fence** to **launch record write**. R7 §5.3 step 3 required the **session fence when N exists** between those steps. R8 retains r7 §5.2 in general, but that paragraph only requires the session fence before the first mutating tmux command on an existing session; it does not restore the dropped before-record ordering.

Integration boundaries: `packages/core/src/session-manager.ts:2408` and :4256 (orchestrator replacement and restore), :4429 (archive copy-back), :4472 (old-runtime stop), :4524 (new create); `packages/plugins/runtime-tmux/src/index.ts:145`, :147, :149 and :153 (delayed launch keys and cleanup kill). No production R2b-2 implementation is present yet. The r8 runtime prototype's key gate is design lines 1963–1965.

The name option and session option protect different effects. Fencing `@ao_name_<k>` does not change `@ao_op` of a surviving session. R8's saved key/cleanup commands compare only the latter. A later holder can therefore follow the new written order, publish or fail its new launch record, and leave the old holder's saved session command authorized until the session fence eventually runs. An error before that later existing-session mutation leaves this gap open. The operation lock alone cannot revoke a shim client that survived its old holder; that is the reason the retained server-side fences exist.

Own private tmux 3.4 schedule, using the exact name-fence and key-gate forms:

```text
later name fence: ao-name-fenced
session @ao_op after newer name fence: old
modeled newer launch record written with launchState=failed and tmuxLaunchToken=Tnew
late old gated launch keys: accepted
old keys' scratch-file effect after newer record: true
control, with the r7 existing-session fence retained:
  late old keys: ao-refused
  scratch-file effect: false
owned processes remaining: []
```

The record write is explicitly modeled; this is a reproduction of the proposed ordering on a real private server, not a claim to have exercised an implemented R2b-2 restore. The ordinary name-fenced create counterexamples remain closed. This finding concerns the surviving existing session and does not reopen the accepted no-server residual.

Required change: explicitly retain the session-fence step, using its full retained incarnation evidence, after the name fence and before the first launch/copy-back record mutation whenever N exists. A failed or unknown session fence must stop the operation before that write. Keep the existing confirmed-old-runtime-stop rule before creating a replacement. Add caller-level schedules holding an old launch key and cleanup kill across the later holder's name fence and record step, including an error before its next tmux mutation. The present r8 key test manually applies `sessionFence` in the test body; it does not prove the creation callers perform this step in the revised order.

Reproducer: `name-vs-session-fence.mjs`, retained below. It uses `/usr/bin/touch` in an owned shell as the launch effect, never a real agent.

### M-3 — Align the acceptance tests with the required launch token and check durability (both rounds)

Design §3 steps 5, 7–8; §5; §7.1–7.3. Tests: `packages/core/src/__tests__/same-id-defects-r8.test.ts:550` (`OperationCreateConfig`), :592–597 (`expectFencedCreate`), :607, :624, :656 (the three callers), :272–351 (fault injection), and :1168–1225 (audit cases). Runtime tests: `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r8.test.ts:414–426` (operation with no launch token) and :469 (correct-evidence control); the changed r7 runtime helper also constructs the older operation shape.

The core assertion is exact:

```ts
expect(r.creates[0]?.operation).toEqual({ id: fences[0]?.op, server: SERVER });
```

R8 requires `{ id, server, launchToken: T }`. Adding just a 32-hex `launchToken` property to all three copied session-manager create configs makes **all three caller tests fail at :597**. The prototype with no planned-token write and no token in those configs passes all three. This is an incompatible oracle, not only missing coverage. The runtime's correct-evidence control likewise creates without the required token, and its bootstrap control never reads back `@ao_launch`.

There is also a newly measured accepted partial fix: remove every `fsyncSync(fd)` call from the r8 inbox prototype, including its file and directory syncs. **All 29 core r8 tests still pass in red mode.** The short-write tests demonstrate visibility and recovery, but cannot establish §1's durability ordering. This is the requested additional discriminator beyond the two r7 cases. The supplied archive-update prototype similarly implements hidden-name write/rename without the proposed fsyncs; its green is only a namespace check.

Required changes:

- Make the caller oracle expect and validate `launchToken`. In the mock create, read the active record and require the same 32-hex top-level `tmuxLaunchToken` already persisted. Check the returned/published handle and actual private session's `@ao_launch` against it. Cover isolated orchestrator spawn as well as the tested project mode, and restore with different old/new tokens.
- Supply that token in all production-facing r7/r8 runtime fixtures. Keep no-operation refusal distinct; prove it runs no tmux command, not merely that no session appeared.
- Add a durability-order oracle and persistent-fsync-failure schedules from M-1. Verify the fault fired; do not infer it from an arbitrary thrown error. Require success only after the relevant file/directory syncs.
- Preserve the strengthened restart, wrong-PID, wrong-start, forbidden-entry, expiry, admission and ID-taken tests. The remaining §7 acceptance tests for real operation locking, cleanup kill, long launch keys, admission record and CLI damage propagation are still required; a mock/prototype green does not replace them.

Measured results distinguish the two directions: the no-fsync mutant passes 29/29; the required extra token field causes three failures. Neither experiment changes a worktree source or test file.

## Crash/fault walk and archive compatibility

| Boundary | Independent assessment |
| --- | --- |
| Before any temporary byte | Final name absent, active intent remains; retry publishes the full record. |
| Short temporary write | R7 exposes 10 bytes under the final name and gets stuck; r8 exposes no final archive. All five callers recover full content after fault removal. |
| Temporary file fsync fails | No final file; retry repeats the write/sync and retains the active record while the fault remains. |
| Link fails before publication | No final file; the temporary/intent remain retryable. No direct-write fallback. Own EIO run refuses on both attempts while fault remains. |
| Link succeeds, temporary removal fails | Final file is complete; active intent remains. Removal is retried. After removal, recovery must also complete directory sync, M-1. |
| Archive-directory fsync fails | Complete final file visible, but recovery currently skips the failed sync and removes active state, M-1. |
| Active unlink fails | Final archive stays complete and unchanged; retry attempts unlink again. |
| Sessions-directory fsync fails after unlink | Final archive is complete; active file is already absent and retry returns `nothing`. Report the failed completion check accurately; after a crash, a reappearing active intent can be recovered against the equal final file. |
| Stale temporary | Hidden from readers; removal under the same ID's record lock is safe because no live publication holder can own it. |
| Equal existing final, including EEXIST | Bytes/inode/mtime are preserved. Completion still needs M-1's directory-sync step. |
| Unequal final, including EEXIST | Returns `archive damaged`; active record/intent and conflicting final are retained. The inbox may already have moved, as the specified order requires. |
| Inbox already moved | Valid recovery layout; the earlier move's directory syncs must be completed, not inferred from visibility, M-1. |
| Archive update before rename | Hidden `.upd-*` file is not a candidate; final old record remains readable after a failed write. Cleanup must not mask the primary error. |
| Archive update after rename | Complete replacement is visible; fsync the archive directory and report any failure. Do not claim a failed call left the old record untouched once rename committed. |

The hidden names are compatible with all inspected main consumers, including landed R4. `metadata.ts:726` and :763 choose a `<id>_` prefix followed by a digit; :819 uses the same selector for update; generation/reservation at :553/:909 call that reader. `session-manager.ts:658`, :675 and :689 use the anchored archived-ID grammar; active listing at :201 and `listMetadata` :869 reject dots. Holder scans at :1012 and :1764, cleanup :3474, archive lookup :4159, remap :4235 and restore's fallback :4282 consume those selectors. None descends into `.inbox-archive/` as an archive record.

Own run against a separately built captured-main core, with malformed hidden `.tmp-*` and `.upd-*` files beside a full final record:

```text
raw branch feat/full; strict branch feat/full
update with hidden temps true; strict status killed
active list before copyback []
reservation copyback new; active list [app-1]
visible old-style malformed .tmp control: strict reader throws "line 1 is not a key=value line"
```

Thus the `updateArchivedMetadata` namespace change is necessary and correctly located in RW. Keep its same-ID record lock, expected-value comparison and generation increment; only the publication mechanism changes. R4's strict-read policy need not change. Old-style visible temporaries already left by an earlier build are not magically repaired by the new naming scheme; they remain subject to the existing damage/error policy.

## Creation, audit and round-plan checks

| Caller | Lock/recheck/fence assessment |
| --- | --- |
| Worker spawn | ID becomes the subject per reservation candidate; try once and skip a busy candidate. Recheck active state and R4's local archive allocation set while holding that ID's lock; remote branches remain a one-time pre-loop observation. Name fence precedes launch record, and the operation/token reaches create. This fixes the r7 scope omission. |
| Project orchestrator | Fixed ID is locked before first record read. Reuse returns without create; replacement must preserve the existing-session fence and confirmed stop (M-2). Keep the lock through handle publication or failed mark. |
| Isolated orchestrator | Each numbered candidate is separately locked and rechecked. It is explicitly in the design, but the supplied green session-manager prototype and core caller test cover project mode only. The real integration acceptance must cover this mode. |
| Restore | Lock before initial record decision, compare the frozen launch identity under the record lock, fence the name, retain the existing-session fence before record mutation, and require confirmed old-runtime stop before replacement creation. Archived copy-back must still compare the selected archive. |

The managed-create boundary is now unambiguous: missing operation throws. Own execFile instrumentation on the copied runtime observed **zero calls** for that case. The raw core `newSession` export at `core/src/tmux.ts:129` remains an explicitly unmanaged API; source re-inventory finds no production caller. Documenting that boundary is sufficient for this round; it must not become an alternate managed creation path.

Own private-server run reproduced: no-server bootstrap creates and sets all three options; H0's late guarded bootstrap is refused after H1's name fence; wrong PID and wrong start time each refuse; restart with the old name option restored still refuses; 40/40 competing bootstrap pairs give exactly one created answer. The saved r7 plain create still succeeds in the late schedule. No default-server command was used.

The revised residual is accurate: a command prepared with `server:null` can later start a server, or reach a successor where no holder fenced its name. If a holder fenced the name on the executing server, the empty-option check refuses. A failed-record token produces `stale`; no naming record produces `unrecorded`. This detects the residual without claiming child/launch exclusivity or reopening OD-28(b).

Audit contract checks:

- Every spawn/orchestrator/restore launch record write assigns a new top-level T before create; publication keeps it and puts T in the handle. Failure keeps T and marks the state; refusal before that write changes nothing. `tmuxLaunchToken` must join launch identity comparisons.
- Top-level T must precede the old handle token during restore, and handle token precedes an older association token. Own cases: new planned T with old handle is `pending`; the old pane is `stale`; a published handle with old association is `ok`.
- With no D, association intent plus empty/matching session token is `pending`; a foreign token is `stale`. No D and no session token is `legacy`. No matching record is `unrecorded`.
- A session fence only changes `@ao_op`; own tmux run preserved `@ao_launch`. Thus a fence interrupted before record mutation leaves the audit class unchanged. After the planned-token write, preparing is `pending`; failed is `stale`.
- Read/parse/invalid launch-state errors must retain the inherited strict/unknown handling, not be converted to healthy by the prototype's final `else ok`. The classification prototype assumes valid records; it is not the production strict-reader boundary. No separate finding is assigned for that already-required integration work.

| Changed round row | Assessment |
| --- | --- |
| §6 RW archive claims | Complete-file visibility and hidden names are supported. Recovery/durability needs M-1; the update is intentionally a replacement, unlike first archive publication. |
| §6 RW allows | Forbidden rules are rejected before work; exact one-rule entries, separate P1u/P3u permits, expiry state and admission reclassification are sound. OD-29(a) keeps test scoping separate from production allows. |
| §6 R2b-2 guarantees | Evidence-bearing create and guarded bootstrap guarantees are supported. Caller coverage is now explicit. Existing-session ordering needs M-2; audit token propagation needs the corrected M-3 acceptance tests. |
| §6 R2b-2 residual | Properly describes the observation/preparation time and the successor-unfenced-name case. No broader launch-exclusivity claim is made. |
| §7.1 RW plan | File ownership and additional caller/CLI/barrier tests are appropriate. Extend faults to sync/retry durability and require the exact persistent refusal from M-1. Keep OD-26 and OD-29's assigned test changes. |
| §7.2 R2b-2 plan | Includes all necessary creation and audit boundaries. Add the omitted pre-record session fence and correct token-bearing fixtures. Real locks, isolated orchestrator, long keys and cleanup remain explicit acceptance work. |
| §7.3 discrimination claims | Both requested r7 discriminators independently fail in the stated way. The author's limitation of prototype greens is correct; new M-3 prevents treating those greens as the final contract. |

## Validation and limits

Frozen offline install passed (`pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store`, HUSKY=0; already installed, no download), then `pnpm build` passed in this worktree. Captured main core also built successfully in scratch. An initial scratch-main compiler invocation from the root failed because `tsc` is a package-local command; rerunning from the core package succeeded. One independent audit script had a syntax typo before execution; it was corrected and rerun. Neither was counted as behavioral evidence.

All runs used a clean environment with scratch HOME/TMPDIR/PATH and CI=1. Baseline tests ran from `git archive 48c26129`, linked to this worktree's dependencies/build. Only isolation substitutions were made in copied core tests: the absolute tmux binary resolves through the reviewer shim, and `-L` labels are `aosdr8-*`. Prototype test copies change imports to the copied prototypes and their copied session-manager/metadata source. No worktree source/test was edited.

Baseline commands, under that environment with `SAME_ID_DEFECTS=red`:

```sh
pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/same-id-defects-r8.test.ts src/__tests__/same-id-defects-r7.test.ts
pnpm --filter @aoagents/ao-plugin-runtime-tmux exec vitest run src/__tests__/same-id-defects-r8.test.ts src/__tests__/same-id-defects-r7.test.ts
```

| Independent run | Result |
| --- | --- |
| Tip core r8 | 21 intended behavioral failures, 8 controls pass |
| Tip core r7, including changed competitor oracle | 15 intended behavioral failures, 7 controls pass |
| Tip runtime-tmux r8 | 5 intended behavioral failures, 2 controls pass |
| Tip runtime-tmux r7, including changed restart/refusal oracles | 2 intended behavioral failures, 2 controls pass |
| Copied r8 prototypes, same four files | core 29/29 and 22/22 pass; tmux 7/7 and 4/4 pass |
| Token-only create mutant | tmux r7 restart fails; tmux r8 wrong-PID and wrong-start fail; 8 other tests pass |
| R7 barrier accepting forbidden allows | core r8 4 fail/25 pass; core r7 22/22 pass |
| All inbox fsync calls removed | core r8 29/29 pass |
| Add required launchToken to the three create configs | 3 caller tests fail at exact object equality; raw-helper control passes |

All **43 baseline failures** reached their stated behavior; all **19 controls** passed; no skips or infrastructure failures. R8's failures divide into seven archive faults, three unfenced caller paths, five barrier defects, six audit-model defects and five real-tmux defects. Audit/inbox/barrier baseline tests explicitly use previous-design models where production modules do not yet exist; they are not claims that a production audit command was run.

The changed r7 tests are justified and limited: the core control changes a truthy-error assertion to `/\bis taken\b/`; tmux carries the held operation into the restart fixture, restores its name option on the successor, and requires refusal markers. No unrelated test oracle was weakened.

No full-suite/typecheck/lint result is claimed as my own; this is a review-only task and those were not needed to establish the reviewed behaviors. The author's full run remains separate evidence. No real AO, model, OpenCode or Herdr invocation, and no network access occurred.

## Correct changes to retain

- Hidden archive publication/update temporaries exclude partial records from both old and R4 strict readers.
- A no-overwrite link plus exact equality preserves committed final archives and distinguishes conflicting content.
- All creation callers now have explicit lock subjects and a before-record name fence; missing operation cannot silently choose plain create.
- Guarded bootstrap closes the r7 late-server schedule and leaves a clearly bounded residual.
- Barrier allows now have explicit forbidden rules, one-rule scope, expiry states and an admission recheck.
- Audit uses durable launch identity and distinguishes pending, failed, legacy and unrecorded sessions.

## Reproducer retention

The full r8 prototypes and the copied `m1_archive_publish.mjs` / `m2_bootstrap_fence.sh` are in design §13. For these runs every `/tmp/aosd8` became `/tmp/aosdr8`, every `aosd8-*` server became `aosdr8-*`, and ao-52 worktree imports became ao-62. The reused r7 writer/inbox/barrier files were copied read-only from the author's tree and rewritten the same way. Nothing was executed from or written to the author's scratch root.

The independent scripts below are retained because reviewer scratch is removed at completion. Mutations were scratch-only: replace every `fsyncSync(fd);` in the copied inbox with an empty statement; or add `launchToken: "a".repeat(32)` to each of the three operation objects in the copied session manager. Restore the original between runs. The two r7 discriminators use the copied runtime's `tokenonly` flag and the copied r7 barrier, respectively.

### archive-faults.mjs

```js
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import * as M from '/home/taisung/.worktrees/agent-orchestrator/ao-62/packages/core/dist/metadata.js';
import * as A from '/tmp/aosdr8/val/dist/inbox.js';
const S='/tmp/aosdr8/faults';fs.mkdirSync(S,{recursive:true});const real={...fs};
const failure=()=>Object.assign(Error('injected EIO'),{code:'EIO'});
function instrument(d,point,fail=true){
 const fds=new Map(),events=[];let fired=false;
 const path=x=>typeof x==='number'?fds.get(x):String(x);
 fs.openSync=(p,...a)=>{const fd=real.openSync(p,...a);fds.set(fd,String(p));return fd};
 const matches=(fn,p)=>point==='temp-write'?fn==='writeSync'&&p.includes('/archive/.'):point==='temp-fsync'?fn==='fsyncSync'&&p.includes('/archive/.'):point==='link'?fn==='linkSync':point==='temp-unlink'?fn==='unlinkSync'&&p.includes('/archive/.'):point==='archive-fsync'?fn==='fsyncSync'&&p===d+'/archive':point==='inbox-dir-fsync'?fn==='fsyncSync'&&p===d+'/.inbox-archive':point==='active-unlink'?fn==='unlinkSync'&&p===d+'/app-1':point==='sessions-fsync'?fn==='fsyncSync'&&p===d:false;
 for(const fn of ['writeSync','fsyncSync','linkSync','unlinkSync','renameSync'])fs[fn]=(...a)=>{const p=path(a[0])??'';events.push([fn,p.replace(d,'D')]);if(fail&&!fired&&matches(fn,p)){fired=true;if(point==='temp-write')real.writeSync(a[0],a[1],a[2],10);throw failure()}return real[fn](...a)};
 syncBuiltinESMExports();return {events,get fired(){return fired},undo(){for(const fn of ['openSync','writeSync','fsyncSync','linkSync','unlinkSync','renameSync'])fs[fn]=real[fn];syncBuiltinESMExports()}};
}
for(const point of ['temp-write','temp-fsync','link','temp-unlink','archive-fsync','inbox-dir-fsync','active-unlink','sessions-fsync']){
 const d=S+'/'+point;fs.mkdirSync(d);const L=A.beginLaunch(d,'app-1',{spawn:true});A.publishLaunch(d,'app-1',L,{branch:'feat/full'});
 const i=instrument(d,point);let first='finished';try{A.archiveLaunch(d,'app-1',L)}catch(e){first=e.message}finally{i.undo()}
 const activeBefore=!!M.readMetadataRaw(d,'app-1'),before=M.readArchivedMetadataRaw(d,'app-1');
 const r=instrument(d,point);let outcome;try{outcome=A.recoverArchive(d,'app-1')}catch(e){outcome=e.message}finally{r.undo()}
 console.log(JSON.stringify({point,first,fired:i.fired,activeBefore,archiveBefore:before?.branch??null,retry:outcome,retryFaultFired:r.fired,retryEvents:r.events,activeAfter:!!M.readMetadataRaw(d,'app-1'),archiveAfter:M.readArchivedMetadataRaw(d,'app-1')?.branch??null}));
 // If the retry intentionally still fails, finish after removing the fault.
 if(M.readMetadataRaw(d,'app-1')) A.recoverArchive(d,'app-1');
}
```

### archive-eexist.mjs

```js
import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
import * as M from '/home/taisung/.worktrees/agent-orchestrator/ao-62/packages/core/dist/metadata.js';import * as A from '/tmp/aosdr8/val/dist/inbox.js';
const root='/tmp/aosdr8/eexist';fs.mkdirSync(root);const real={...fs};
for(const equal of [true,false]){
 const d=root+'/'+equal;fs.mkdirSync(d);const L=A.beginLaunch(d,'app-1',{spawn:true});A.publishLaunch(d,'app-1',L,{branch:'feat/full'});
 const fds=new Map(),events=[];let fired=false,final,stamp;
 fs.openSync=(p,...args)=>{const fd=real.openSync(p,...args);fds.set(fd,String(p));return fd};
 fs.fsyncSync=fd=>{events.push(['fsync',fds.get(fd)?.replace(d,'D')]);return real.fsyncSync(fd)};
 fs.linkSync=(src,dst)=>{if(String(dst).startsWith(d+'/archive/')){fired=true;final=dst;real.writeFileSync(dst,equal?real.readFileSync(src):'branch=feat/other\n');const s=real.statSync(dst,{bigint:true});stamp=`${s.ino}/${s.mtimeNs}/${s.size}`;throw Object.assign(Error('injected EEXIST'),{code:'EEXIST'})}return real.linkSync(src,dst)};
 syncBuiltinESMExports();let result;try{A.archiveLaunch(d,'app-1',L);result='finished'}catch(e){result=e.message}finally{for(const fn of ['openSync','fsyncSync','linkSync'])fs[fn]=real[fn];syncBuiltinESMExports()}
 const s=real.statSync(final,{bigint:true});console.log(JSON.stringify({equal,fired,result,active:!!M.readMetadataRaw(d,'app-1'),finalUnchanged:stamp===`${s.ino}/${s.mtimeNs}/${s.size}`,events}));
}
```

### name-vs-session-fence.mjs

```js
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {setTimeout as sleep} from 'node:timers/promises';
const S='/tmp/aosdr8',server='aosdr8-session-order',N='eeeeeeeeeeee-app-1',opt='@ao_name_'+createHash('sha256').update(N).digest('hex').slice(0,16);
const tm=(...a)=>{const r=spawnSync('tmux',['-L',server,...a],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()};
const own=new Map();const ticks=p=>{try{const s=fs.readFileSync(`/proc/${p}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return ''}};
function track(){for(const l of tm('list-panes','-a','-F','#{pid} #{pane_pid}').split('\n'))for(const p of l.split(' ').map(Number))if(p)own.set(p,ticks(p))}
const gate=file=>['if-shell','-F','-t','='+N+':','#{==:#{@ao_op},old}',`send-keys -t =${N}: "/usr/bin/touch ${file}" Enter`,'display-message -p ao-refused'];
try{
 tm('new-session','-d','-s','anchor','/bin/sleep 600');tm('new-session','-d','-s',N,'/bin/sh');track();
 tm('set-option','-t','='+N+':','@ao_op','old');tm('set-option','-t','='+N+':','@ao_launch','Told');tm('set-option','-s',opt,'old');
 const delayed=gate(S+'/keys-after-name-fence');
 const seen=tm('display-message','-p',`#{pid}/#{start_time}/#{${opt}}`);
 console.log('later name fence',tm('if-shell','-F',`#{==:#{pid}/#{start_time}/#{${opt}},${seen}}`,`set-option -s ${opt} new ; display-message -p ao-name-fenced`,'display-message -p refused'));
 // Model the r8 section 3 step 5, then a failure before an existing-session mutation.
 fs.writeFileSync(S+'/modeled-launch-record','launchId=Lnew\nlaunchState=failed\ntmuxLaunchToken=Tnew\n');
 console.log('session op after newer name fence',tm('display-message','-p','-t','='+N+':','#{@ao_op}'));
 console.log('late keys answer',tm(...delayed));await sleep(150);console.log('old keys effect after newer record',fs.existsSync(S+'/keys-after-name-fence'));
 // Retaining the removed r7 session-fence step stops the same delayed keys.
 tm('set-option','-t','='+N+':','@ao_op','new');console.log('late keys after session fence',tm(...gate(S+'/keys-after-session-fence')));await sleep(150);console.log('effect with session fence',fs.existsSync(S+'/keys-after-session-fence'));
}finally{
 for(const[p,t]of [...own].reverse())if(ticks(p)===t)try{process.kill(p,'SIGKILL')}catch{}
 await sleep(150);console.log('owned remaining', [...own].filter(([p,t])=>ticks(p)===t).map(([p])=>p));
 const p=`/tmp/tmux-${process.getuid()}/${server}`;if(fs.existsSync(p))fs.unlinkSync(p);
}
```

### main-archive-readers.mjs

```js
import fs from 'node:fs';
import * as M from '/tmp/aosdr8/main-build/packages/core/dist/metadata.js';
const d='/tmp/aosdr8/main-reader-fixture',id='app-1',ts='2026-10-22T14-00-00-000Z';fs.mkdirSync(d+'/archive',{recursive:true});
fs.mkdirSync(d+'/.inbox-archive/'+id+'_'+ts,{recursive:true});
const final=d+'/archive/'+id+'_'+ts;
fs.writeFileSync(final,'branch=feat/full\nlaunchId=old\nlaunchState=published\ngeneration=5\n');
for(const suffix of ['tmp-999999-dead','upd-999999-dead']) fs.writeFileSync(d+'/archive/.'+id+'_'+ts+'.'+suffix,'this is malformed\n');
console.log('raw branch',M.readArchivedMetadataRaw(d,id)?.branch,'strict branch',M.readArchivedMetadataStrict(d,id)?.branch);
console.log('update with hidden temps',M.updateArchivedMetadata(d,id,{status:'killed'}),'strict status',M.readArchivedMetadataStrict(d,id)?.status);
console.log('active list before copyback',M.listMetadata(d));
console.log('reservation copyback',M.reserveSessionRecord(d,id,{...M.readArchivedMetadataStrict(d,id),launchId:'new'},M.launchIdentity(M.readArchivedMetadataStrict(d,id)))?.launchId,'active list',M.listMetadata(d));
console.log('archive entries',fs.readdirSync(d+'/archive'));
// Independent proof of the R4 selector: visible malformed .tmp is selected and strictly rejected.
fs.writeFileSync(final+'.tmp.999999.1','this is malformed\n');
try{M.readArchivedMetadataStrict(d,id);console.log('visible malformed unexpectedly accepted')}catch(e){console.log('strict visible temp error',e.message)}
```

### audit-cases.mjs

```js
import {classifyRuntimeSessions as classify} from '/tmp/aosdr8/val/core/retained-inventory.ts';
const N='cccccccccccc-app-1',socket='/tmp/aosdr8/audit-socket',old='a'.repeat(32),next='b'.repeat(32);
const handle=t=>JSON.stringify({id:N,runtimeName:'tmux',data:{tmuxSocket:socket,tmuxLaunchToken:t}});
function state(raw,launchToken,op='irrelevant'){return classify({records:[{sessionId:'app-1',raw:{tmuxName:N,...raw}}],sessions:[{name:N,socket,launchToken,op}]})[0].state}
for(const [name,raw,token] of [
 ['new planned beats old handle',{tmuxLaunchToken:next,runtimeHandle:handle(old),launchId:'L2',launchState:'preparing'},next],
 ['old pane after planned token changes',{tmuxLaunchToken:next,runtimeHandle:handle(old),launchId:'L2',launchState:'preparing'},old],
 ['handle beats old association',{runtimeHandle:handle(next),runtimeAssociation:JSON.stringify({token:old}),launchId:'L2',launchState:'published'},next],
 ['association intent without session token',{associationIntent:JSON.stringify({token:next})},''],
 ['association intent matching token',{associationIntent:JSON.stringify({token:next})},next],
 ['association intent foreign token',{associationIntent:JSON.stringify({token:next})},old],
 ['tokenless legacy',{},''],
 ['foreign token',{},old],
 ['published planned token',{tmuxLaunchToken:next,launchId:'L2',launchState:'published'},next],
 ['failed planned token',{tmuxLaunchToken:next,launchId:'L2',launchState:'failed'},next],
 ['missing state on launch',{tmuxLaunchToken:next,launchId:'L2'},next],
])console.log(name,state(raw,token));
```

### no-operation.mjs

```js
import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
let calls=0;const original=cp.execFile;cp.execFile=(...args)=>{calls++;return original(...args)};syncBuiltinESMExports();
const {create}=await import('/tmp/aosdr8/val/tmux/dist/runtime.js');
try{await create().create({sessionId:'cccccccccccc-app-1',workspacePath:'/tmp/aosdr8',launchCommand:'/bin/true',environment:{}})}catch(e){console.log(e.message)}
console.log('execFile calls',calls);cp.execFile=original;syncBuiltinESMExports();
```

## Isolation and cleanup evidence

Marker `/tmp/aosdr8-marker`: **2026-10-22 10:01:43.854014375 -0400**. Scratch `/tmp/aosdr8`; private `aosdr8-*` servers and test sockets under scratch. The shim prepends `-L aosdr8-tests`; explicit private test `-S` sockets and alternate-root labels remain under reviewer control. Every server started with a clean scratch environment. gh is a stub allowing only version/auth-status responses. No model/Herdr/OpenCode process was started, no real AO command or network call ran, and no default tmux server command ran.

Every test/script child completed or was stopped through its owned PID/private server; all yielded build/install/test commands were collected. The author's `/tmp/aosd8` stayed read-only. Build/dependency outputs are confined to this worktree and scratch. No source/test worktree file changed; `git diff --exit-code` passed. No commit, rebase, pull, push or PR.

Process scans only read. Baseline/prototype barrier fixtures scope classification to their own PIDs; server socket queries are private. The final audit reads same-uid proc stat/uid/state/start/parent, cmdline, environ, cwd/exe links to identify reviewer fixtures, excluding its own launcher ancestors. It records AO key names only, never foreign environment values. No foreign process was signalled or waited on. Exact final scan evidence:

```text
scan_fields: "same-uid proc stat/uid/state/start/parent, cmdline, environ keys, cwd/exe links"
read_pids: [13870,13874,13893,13895,13899,13901,13904,13943,14053,14112,271595,271596,1101402,1101403,1102127,1847142,1847143,1847378,1847380,1849148,1849365,1849949,1850213,1850633,2240622,2240868,2240870,2240877,2243164,2246295,2246298,2246299,2256355,2601519,2601764,2601766,2601773,2604750,2610853,2610856,2610857,2778092,2825345,2825582,2833055,2833080,2833081,3753189,3753412,3760581,3760584,3760585,3830765,3830929,4067926,4072955,4073418,4076191,4076507,4076519,4076520,4076521,4076522,4099210,4099358,4106554]
unreadable_environments: [{"pid":13870,"errno":13},{"pid":13874,"errno":13},{"pid":1847142,"errno":13},{"pid":1847143,"errno":13},{"pid":1847378,"errno":13},{"pid":1849148,"errno":13},{"pid":1849949,"errno":13},{"pid":1850213,"errno":13}]
AO_keys_only: [{"pid":271596,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":1102127,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2240622,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2240868,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2240870,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2240877,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2243164,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2246295,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2246298,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2246299,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2256355,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2601519,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2601764,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2601766,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2601773,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2604750,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2610853,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2610856,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2610857,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2825345,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2825582,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2833055,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2833080,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":2833081,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3753189,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3753412,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3760581,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3760584,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3760585,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":3830765,"keys":["AO_CONFIG_PATH","AO_LIFECYCLE_PROJECT","AO_STATE_ROOT"]},{"pid":3830929,"keys":["AO_CONFIG_PATH","AO_LIFECYCLE_PROJECT","AO_STATE_ROOT"]},{"pid":4067926,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4072955,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4073418,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4076191,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4076507,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4076519,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4076520,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]},{"pid":4076521,"keys":["AO_CALLER_TYPE","AO_CONFIG_PATH","AO_DATA_DIR","AO_ISSUE_ID","AO_PROJECT_ID","AO_SESSION","AO_SESSION_ID","AO_SESSION_NAME","AO_STATE_ROOT","AO_TMUX_NAME"]}]
own_processes_excluding_scan_ancestors: []
logged_own_server_pids_remaining: []
own_sockets_outside_scratch: []
protected_workers: {"3830765":{"state":"S","ppid":1,"ticks":"17027347"},"3830929":{"state":"S","ppid":1,"ticks":"17027666"}}
```

The protected real lifecycle workers 3830765 and 3830929 were observed only; both remain in state S with their start ticks above. Own process list `[]`, logged own server PIDs remaining `[]`, own sockets outside scratch `[]`.

Required before/after command:

```sh
ls -la --time-style=full-iso ~/.ao/bin
```

Before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The diff is empty, including all timestamps.

Required real-state check:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr8-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
```

Every printed entry, under `~/.agent-orchestrator/60756641ca25-agent-orchestrator/`:

| Entry | Attribution |
| --- | --- |
| `sessions` | Concurrent real-fleet record directory writes; no reviewer file is written here. |
| `sessions/archive` | Concurrent real-fleet archive-directory changes, outside all reviewer fixture roots. |
| `sessions/ao-52` | External author-session/lifecycle record write; no reviewer AO command or real-state write. |
| `sessions/ao-54` | External ao-54/session-lifecycle record write; not an owned reviewer fixture. |
| `sessions/.generations` | Concurrent real-fleet generation-directory changes; reviewer metadata fixtures use scratch directories only. |

These attribute the writes to external fleet activity, not an exact PID: timestamps alone cannot identify the exact writing process. No orchestrator pane was read or controlled. Real state was only inspected through the mandated read-only commands.

Completion cleanup removed `/tmp/aosdr8` and `/tmp/aosdr8-marker` after retaining this evidence; `.agent_report.md` was then published atomically. The author's scratch and all real fleet state remain untouched. Final artifacts are this uncommitted review and the report; no PR is authorized for this task.
