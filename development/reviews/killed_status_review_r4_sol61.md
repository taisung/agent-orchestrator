# Killed-status review, round 4

NOT-LAND-SAFE

Reviewed `f35b665f..f06a1107` at `f06a1107d4fe1ff3382072b4140ac4d6045b3b3e`, and assessed the whole fix `0e3eabc2..f06a1107`. **New findings: 0 blockers, 2 majors, 2 minors.** The original five reproducers are repaired. Two removal paths still act after their ownership checks have become stale: OpenCode deletion retries and delivery-ledger lock waits. These violate the owner’s whole-round ownership requirement and can remove a current launch’s state. The counter also falls short of the stated per-ID rule, although I did not reproduce stale active-record contamination from that remaining counter gap.

Review and report only; no source edits, commit, push, PR or network gh call. Independent source inspection and checks 1–4 preceded reading the author report. The review was written incrementally; the evidence log below preserves the observations and corrections. All line numbers refer to `f06a1107` unless explicitly identified as installed-build lines.

## Round-3 findings

| Previous finding | State in round 4 | Independent evidence |
| --- | --- | --- |
| B-1: failed restore kills same-name replacement | **Fixed for the reported case** | Two actual Node processes and private tmux: child publishes same-name replacement, parent refuses its stale restore write and keeps replacement alive with record unchanged. Reservation collision cost assessed below. |
| B-2: generation ABA / legacy launch compare | **Original repro fixed; global rule partly fixed** | Old lifecycle read at generation2 cannot write into replacement generation4. All “any Node write cancels” sites now include launch identity. The new archive-counter gap is m-1 below. |
| M-1: rollback removes newer worktree | **Fixed** | Built-API replay and separate real-tmux two-process replay both retain newer record, runtime and shared worktree; workspace.destroy calls=0. |
| M-2: cleanup uses obsolete PR decision | **Fixed** | Real claimPR(#2) inside the old PR#1 query preserves PR#2 and prevents destruction. Bookkeeping-only change permits cleanup; status change skips one pass and the next pass succeeds. |
| m-1: NODE_OPTIONS module-mode helper | **Fixed** | Own ESM-eval caller succeeds; harmless require/import preloads run exactly once in the parent. Reintroducing inherited NODE_OPTIONS fails two meaningful tests. |

## New findings

### M-1 — OpenCode removal retries use an obsolete ownership decision

`packages/core/src/session-manager.ts:342–348`, called at `:998`, `:2668`, `:2991`.

The fresh guards protect entry into `deleteOpenCodeSession`, but that function performs up to three actual removals. After the first rejection it waits 200ms, then another 600ms on further failure, without rereading the owning record or other records naming the OpenCode ID. A session that acquires the ID during those waits loses its agent session on a subsequent attempt. This is separate from the deferred tmux-command window.

Own failing regression, in an otherwise pristine scratch archive of this HEAD: use the real session manager, mock only the OpenCode API, seed app-1 with ses_old, and call `kill(app-1, {purgeOpenCode:true})`. In the first remove callback publish a new app-2 launch with runtime rt-new and `opencodeSessionId=ses_old`, then throw a transient error. The second remove callback is reached despite app-2’s current record. Assertion “called once” fails: **expected 1, got 2**. No real OpenCode command/API request occurred. The record remains; its agent session is what the retry removes.

Recheck current launch/decision and the full set of names immediately before **each attempt**, including after retry delays. The author’s “Rule 1.0.1” table calls these rows gap-free and omits the retry loop; that claim is false. The existing tests mutate during holder checks and interrupt but do not mutate between removal attempts.

### M-2 — Cleanup removes a newly owned delivery ledger after waiting for its lock

`packages/core/src/session-manager.ts:2720–2725`; actual wait/removal in `packages/core/src/delivery-ledger.ts:560–563`.

`removeLedgerOfRemovedSession` checks that no active record names the key, then enters `removeDeliveryLedger`, which awaits the ledger lock before an unconditional `rmSync`. Ownership can change during that wait. The author acknowledges the wait in the table and “Items of the brief” item 5, treating it as part of the step because the ledger module was outside the allowed edit list. That does not make the stale removal safe or meet the owner’s stated sole exception for tmux commands.

Own built-API reproduction uses the **real ledger lock and cleanup**, no OpenCode calls: archive kr-1 marked `opencodeCleanedAt` and `opencodeLedgerPending=ses_shared`; create a valid v2 ledger with one fresh `unknown` delivery entry; hold its lock; start cleanup; while it waits, publish working kr-2 naming ses_shared; release the lock. At **01:09:48.246Z** the active owner and valid ledger coexist. At **.264Z** the owner still exists, the ledger is gone, and cleanup reports no errors. `readDeliveryLedger` validated the entry before the run. This discards unresolved delivery reuse information; a resulting repeated delivery is a risk inferred from that loss, not a separately executed model turn.

Read record ownership **after acquiring the ledger lock and before unlinking**, keeping the pending key when ownership changed. The allowed-file restriction must be resolved in the next fix rather than relabeling this interval as safe. The new ownership test mocks `removeDeliveryLedger` to an immediate no-op, so it cannot cover this race.

### m-1 — Archive writes do not participate in the advertised never-repeating per-ID counter

`packages/core/src/metadata.ts:579`, `:676`, `:787`, `:851`; corresponding guarantee in `docs/DEVELOPMENT.md` and the author’s rule-1.0.2 proof.

`updateArchivedMetadata` increments the archive alone. It neither raises the durable floor nor takes the active record’s generation into account. An active record with a nonzero generation also increments itself without consulting a newer archive/floor. Own new-writer-only sequence:

```text
write active1; delete(false): floor1; reserve2; update3; archive: floor3/archive3
reserve active4
update latest archive five times: archive4,5,6,7,8 while active stays4
update active: active5 again
archive active5: latest archive5/floor5
reserve: active6 again (archive history already contained6)
```

A smaller additional check at **01:12:00.384Z**: archive generation1/floor1; archive bookkeeping writes2 then3; remove the archive files; reserve at **.386Z** publishes generation2 again. The author explicitly claims archive-file removal cannot bring a seen generation back, but the floor remembers only the deleted active generation.

The original active-to-active rollback ABA is fixed and launch checks now protect cross-launch writes; I did **not** demonstrate an accepted stale active update from this remaining history overlap. Severity is therefore minor, with the literal owner requirement still unsatisfied. Allocate from the maximum per-ID history under the shared lock, and retain the high-water mark for archive writes as well. Test concurrent active/archive bookkeeping and archive removal after archive bookkeeping, not just before it.

### m-2 — The claimed complete core removal inventory omits low-level operations

The author’s table omits `packages/core/src/tmux.ts:184–185` (exported as `killTmuxSession` at `index.ts:48`), `tmux.ts:151` (message temp unlink), `metadata.ts:892` (reservation temp removal), `opencode-api.ts:428–429,490` (owned helper-process termination and answer-directory removal), and `delivery-ledger.ts:285` (empty-ledger removal). The raw tmux kill accepts only a name and performs no record read. I found **no production core caller** of that export; current manager paths use runtime plugins. The other omitted operations have different ownership contracts, summarized below.

This is an inventory/documentation finding required by item 2, not an additional runtime-race blocker or a rerating of deferred tmux target matching. Correct the table and explicitly distinguish session-owned removals from exclusively owned temporary resources and ledger compaction. “Every removal in core reads a record” is broader than the actual implementation.

## Independent removal inventory

I searched core itself before comparing the author’s table. “Fresh” below means no core await between the stated last read and entry to the actual step; named tmux-command windows remain owner-deferred.

| Core step | Last check / outcome |
| --- | --- |
| Rollback runtime `session-manager:1510` | `own.check` at1507 and may-own-runtime predicate; replacement reservation/same name kept and named. |
| Rollback prepared session `:1530` → `prepared.discard` at154 | Fresh own record at1521 and latest archive; matching prepared metadata retained. No internal await in the core forwarding wrapper before discard. |
| Rollback worktree `:1539`; callbacks at1652/2170/2189 | Fresh own check at1537 after earlier awaits; replacement skips destroy. |
| Rollback record release `:1467,1546` | Conditional delete reads/compares within record lock. |
| Project-mode orphan / replacement runtime `:2072,2078` | Fresh persisted record at2055 or stillNames at2076; reservation protected. |
| Project-mode record deletion `:2080,2083,2113` | Conditional launch comparison under record lock after any runtime await. |
| Failed-start prompt unlink `:2196` | Fresh own check at2194; newer launch retains shared prompt. |
| Kill runtime `:2600` | stopWhenReplaced at2598, after awaited launcher check; accepted tmux-command gap only. |
| Kill worktree `:2616` | Fresh stopWhenReplaced at2608 after runtime await. |
| Kill interrupt `:2665` | stillUnheld at2664 rereads own decision and other naming launches. |
| Kill agent removal `:2668` | stillUnheld at2666 protects first attempt; **retries at348 lack fresh checks (M-1)**. |
| Delete strategy agent removal `:998` | Naming-launch comparison at995 after holder await; **same retry gap**. |
| Archived cleanup purge `:2991` | Active record absence plus naming-launch comparison at2979–2983 after holder await; **same retry gap**. |
| Kill/archive `:2682` | deleteMetadata under record lock; direct kill compares launch, cleanup adds decision facts. Changed live record prevents archive. |
| Explicit/pending ledger removal `:2725` | Caller checks active names; **lock await before actual unlink is M-2**. |
| Restore old runtime `:3920` | stillOwned at3908; tmux-command gap deferred. |
| Restore failed-created runtime `:3977` | Fresh current read at3961, may-own check at3962; reservation/same name kept. |
| Recovery runtime/worktree `recovery/actions:166,182` | Fresh assessed-version reads at152 and174 respectively; changed record returns RECORD_CHANGED. |
| Recovery archive `actions:197` | Conditional generation+launch of its own terminated write; locked check. |
| Metadata archive copy / active unlink `metadata:683,686` | Current record+expected read inside lock, floor raised before removal; no await. All caller deletes funnel here. |
| Reservation temporary link cleanup `metadata:892` | Unique PID+UUID temp created by this operation; removes only that temp link, never the active linked record. No record dependency. |
| Raw tmux kill utility `tmux:184–185` | No record check or production core caller; table omission m-2. |
| Tmux message temp / paste buffer `tmux:147–151` | Per-call random buffer and temp file; `paste-buffer -d` consumes that buffer, finally unlinks its temp. Not a shared session artifact. |
| OpenCode answer helper `opencode-api:428–429,490` | Timeout targets the exact owned child; finally removes this call’s mkdtemp directory. No session-record ownership needed. |
| Empty ledger write `delivery-ledger:285` | Synchronous entry-based compaction under ledger lock via changeDeliveryLedger; deleting empty storage remains valid for an active key. |
| Expired ledger sweep `delivery-ledger:599,606–617` | Temp age check; real ledger lock then reread entries, retain fresh/unknown entries and corrupt ledgers. Record-independent retention contract; this is not explicit agent-session deletion. |
| Lock sockets `delivery-lock:76,123`, metadata helper | Destroy only the probe/client connection owned by the lock implementation, release owned server; no session artifact is removed. |

The expiry sweep’s `tryHoldDeliveryLock` is async even with no retry wait; its decision reads ledger entries **after** acquisition, unlike M-2. Applying a literal record-read rule to empty/expired ledger compaction or exclusive temporary files would require an explicit scope clarification; I found no new stale session-state destruction in those operations. In-memory Map/Set deletes are not persisted removals. Lifecycle, remap and claimPR do not directly remove runtime/worktree/agent artifacts; send reaches restore when applicable.

## Counter, reader and failure-cost judgments

The delete floor is written before unlink under the record lock. Own process-crash injection stops a child exactly after floor2 is written with active generation2 still present; SIGKILL, deletion retry and reservation produce generation3. This covers the requested process-stop window, not machine-power-loss durability. The original delete-without-archive, rollback and copy-back sequences are protected. The wider history claim needs m-1.

`.generations` is invisible to the new listMetadata/list/get, cleanup and scanner checks, and to actual built CLI `status` / `session ls` with a floor directory present. `get('.generations')` throws invalid ID. Scanner uses listMetadata. CLI session enumeration delegates to these APIs; no CLI directory walker admitting dot directories was found. Installed old `dist/metadata.js:265–279`, read only with grep, likewise excludes dot names, invalid IDs and non-files. Neither the bash helper nor the Claude hook enumerates the session directory: each addresses `$AO_DATA_DIR/$AO_SESSION`, with file checks. I inspected the generated hook source and the installed `.claude/metadata-updater.sh`; no installed code was executed.

Growth is one small decimal/newline file per deleted ID, plus ordinary transient atomic-write files; there is no per-generation history directory. Filesystem inode/block overhead dominates the few-byte payload. Do not age-purge a floor while that ID may be reused. A safe future retention rule would require retiring the ID permanently or preserving its high-water mark elsewhere. No urgent size problem is demonstrated, but it is intentionally monotone per-ID state.

Generation-plus-launch now guards lifecycle PR discovery, bookkeeping and status (`lifecycle-manager:269,752,1019,1498`), read repair (`session-manager:633`), the claim target and takeover (`:3541,3564`), and recovery assessed updates/archive (`actions:21,197`). Routine status/PR/summary/hash writes do not change launch identity. I found no shipped writer that gratuitously changes that identity every poll, so no new permanent failure to mark a dead session terminal. A conflicting write can reject one pass; fresh subsequent reads work. An old full rewrite or explicit restoredAt/runtimeHandle change correctly invalidates an in-flight view. Repeated real competing writes can continually postpone a write; that is conditional-update contention, not evidence of a stable-session false stop.

Cleanup compares PR, issue, status and launch, deliberately omitting generation. Own controls confirm that bookkeeping does not cancel cleanup and a status change cancels only the current decision. A change after runtime destruction can leave partial cleanup with newer record/worktree retained; the operation reports a stale decision and requires retry. Existing claimPR can complete checkout and then refuse its final record write when ownership changes; this failure behavior was not changed by this round. These costs are preferable to applying an obsolete decision to a replacement.

## Kept-runtime decision and operational cost

The reservation collision is real, not just a hypothetical leak. In the two-process test a competing actual spawn holds a reservation and waits in workspace.create. Stale restore then creates the shared tmux name, fails its record compare and keeps the runtime. The competing launch attempts `tmux new-session`, gets **duplicate session**, and does not attach or send to the existing runtime. Because create failed before returning a handle, its rollback cannot destroy that runtime. Its own reservation and managed workspace are removed. The kept runtime remains alive with no record; list=[], send says “Session not found,” and cleanup returns no entries. Both processes and the private server were subsequently stopped by the review harness.

In a real fleet an agent in such a pane can continue running and may make turns or external changes; the sleep stand-in proves process survival, not model or commit behavior. Its cwd may have been removed; a project-mode/shared directory could instead survive and remain writable. `ao status`, `ao send` and metadata-driven cleanup do not discover this orphan. The error’s runtime name is useful for manual inspection but does **not** make the runtime visible in ordinary AO status. Later core restore cannot resolve a missing record; a new spawn has no recorded ownership with which to clean the orphan automatically. An operator must resolve it explicitly.

Despite that cost, keep-and-name is the defensible default for this round. A reservation can already have created its replacement pane without publishing the handle. The actual same-name replacement test proves that stopping merely because the record is a reservation is unsafe. Current safe narrower controls are already present: no record, or a fully launched record naming a different runtime by both handle and tmux name. An incarnation-bound stop/creation protocol could improve this later; no additional safe stop rule is established by these records alone. This operational cost is assessed under author remaining-limit 5, not counted again as a new blocker. Remaining-limit 6’s one-pass cleanup refusal is confirmed by the controls above.

## Tests, scope and rollout

The new ownership tests exercise real manager operations with mutations inside awaited callbacks and include positive controls. The four other-writer tests deliberately inject old-build-style writes inside synchronous stat/rename windows; those test the relevant launch comparisons. The three added convergence cases cover current-writer ABA, old records without generation and an unchanged control. The new helper tests cover env flags and benign preloads; all child spawns in record-lock now pass fake HOME. Other process-starting tests inherit the gate’s clean HOME. The three changed stale-write tests keep exact reservation-record assertions and the workspace assertion; only the intended runtime retention/error contract changed. Their mutation failures below confirm that this is behavior coverage, not a vacuous assertion change.

Own scratch mutations against a pristine 155-test baseline (five focused files, all pass):

| Removed protection | Meaningful failures |
| --- | --- |
| Reservation may own runtime | 3 stale-write cases: active restore, archived restore, spawn rollback keep reservation/runtime. |
| Floor raise on delete(false) | 5 ownership cases: delete/reserve, missing full write, rollback, repeated rounds, floor visibility fixture. |
| Reservation reads floor | 4: delete/reserve, removed archives, rollback, repeated rounds. |
| Lifecycle launch compare plus delete floor | 8: both lifecycle ABA cases and 6 ownership/floor cases. |
| Worktree rollback uses cached first read | 2: replacement during runtime destroy and during prepared discard. |
| Cleanup compares launch only | 3: claimPR inside old query, helper status change, PR claim during runtime destroy. |
| Worker keeps NODE_OPTIONS | 2 record-lock cases: ESM eval and require preload. |
| Kill’s post-launcher runtime check removed | 1: replacement inside launcher check must prevent destruction. |

Two initial mutation substitutions matched zero lines; they were not counted as tests and were corrected/rerun. All eight mutations finally failed behavioral assertions. Scratch sources were restored. Own additional retry regression fails against unmodified HEAD as described in M-1. The ledger reproduction uses the built API rather than the mocked ledger in the ownership suite.

Worktree-only frozen install, build, typecheck all exit0. Lint exit0: **5 problems (0 errors, 5 warnings)**, the same unchanged warnings at CLI spawn333, activity-log91, plugin-registry232, session-manager1939/1946. Required package filters: core1305, CLI261, tmux40, Claude212, all pass. Integration with private tmux and no agent binary: **10 files passed / 3 skipped; 91 tests passed / 24 skipped**. Full `pnpm -r --no-bail test`: **2778 passed, 29 skipped, 0 failed; 94 files passed, 3 skipped**. Per-package test counts: core1305, Gemini62, Codex215, notifier26, Claude212, Herdr36, SCM140+5skip, tracker42, tmux40, workspace50, OpenCode298, integration91+24skip, CLI261. Every gate used env -i, fake HOME and no AO_*; no test preload was needed to repair HOME this round.

The diff is exactly 10 allowed files: metadata, session manager, lifecycle manager, recovery actions, DEVELOPMENT.md and five test files; no new source module. The four commits are a straight parent chain `f35b665f → b52e18df → ef6c73d9 → ac8ca80b → f06a1107`, with conventional WHY-bearing messages, no issue number/emoji/Co-Authored-By. `git branch -r --contains f06a1107` is empty. The earlier helper-module choice was superseded by the final commit; the final helper remains CommonJS eval. The reported amend does not alter the observed four-commit linear ancestry. No CLI/runtime/plugin/helper-source/WRAPPER_VERSION/hook, convergence-policy or run-key change occurred in this range. ClaimPR failure behavior is unchanged.

The whole fix substantially improves locking, conditional no-create writes, launch-scoped convergence, identity checks and stale-operation refusals. Previous correct behavior remains: launcher grace; two authoritative negative polls; fresh-worker all-dead convergence; bounded no-server handling; preservation on unknown probe errors; C3 identity/tolerance and matching recovery; stale closed-PR protection; reservation UUIDs and conditional releases. Prior full-bound timing evidence remains applicable because the run key and bound policy did not change; this round repeated quick live controls plus the current convergence suite. Prefix matching and hidden sockets over five minutes remain explicitly deferred and are not rerated here. M-1/M-2 prevent a land-safe verdict under the current owner policy despite passing gates.

After correction and approval, rollout must rebuild the **primary checkout** and restart **every old Node writer**: both real lifecycle workers and any long-running AO CLI/service process. Rebuilding files alone does not replace modules already loaded in a process. Old merges can preserve but fail to increment generation, old full writes can drop generation/reservation IDs, old deletion does not raise the floor, and old code can recreate removed records or perform unguarded side effects. New launch comparisons mitigate some mixed-version ABA but do not serialize old writers. Conversely old readers ignore new keys and the dot directory; new writers can add those keys and invalidate old assumptions without making an old writer honor the new lock. New compares can safely reject a pass after an old write; a fresh pass is not inherently permanently blocked. Uniform guarantees require the restart. This review did not rebuild the primary checkout or restart real workers.

## Evidence recorded while working

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Independent source/API pass, author report still unread:

- B-1 now re-reads immediately before failed-restore cleanup and keeps a reservation/same-name runtime. Rollback rechecks before runtime/prepared-session/worktree/release steps. Direct kill checks again after its launcher await; cleanup carries PR/issue/status as well as launch.
- At 2026-10-21T00:47:58Z, own built-API rollback reproduction retains the replacement record and worktree (workspaceExists=true; no workspace destroy). Cleanup with actual claimPR in old PR query refuses with an errors entry, preserves open PR #2, and calls no destroy. A bookkeeping-only change does not prevent cleanup; a status change prevents that pass, and the next pass cleans the unchanged closed PR normally.
- Own lifecycle ABA replay: old generation=2; delete-without-archive/reserve/new launch now gets generation=4; neither old PR nor old pinned summary is written. The launch compare also protects legacy/no-generation cases by source inspection and dedicated tests.
- Potential rule-1.0.2 gap: archive bookkeeping increments only the archived file's counter, independently of the active record/floor. Own sequence writes active1, deletes(false), reserves2, updates3, archives3, reserves4; archive updates then publish4,5,6,7,8 while active remains4. Active update publishes5 again; next archive holds5/floor5 and reservation publishes6 again. Thus the literal per-ID “never repeat” rule is not true across active and archive writes, even though original active-to-active rollback ABA is fixed. Assessing practical impact separately.
- Potential rule-1.0.1 gaps: removeDeliveryLedger checks the record in its caller, then awaits the ledger lock before actual rmSync; deleteOpenCodeSession retries after 200/600 ms without rechecking record ownership. Neither is the owner-deferred tmux-name window. Own adversarial probes pending.
- Floor name .generations is skipped by new listMetadata and the installed build's dist/metadata.js:269–279; recovery scanner delegates to listMetadata; explicit get('.generations') rejects the ID. Normal floor growth is one small decimal file per deleted session ID.
- Frozen install and worktree build exit0. Gates run without the former HOME-injection preload; childEnv now supplies HOME directly.

At 2026-10-21T01:03:52Z the corrected two-process reservation test reserved the *same* ID (delete without archive, so next-ID allocation chooses kr-1). Restore created `12ad2cefbb67-kr-1` after that reservation, refused its stale final write and kept the runtime. The actual competing `spawn` then got tmux `duplicate session`; its rollback removed its own record and shared worktree. Runtime `alive=true`, worktreeExists=false, list=[], cleanup={killed:[],skipped:[],errors:[]}, send="Session not found: kr-1". The first trial archived kr-1 and therefore correctly allocated kr-2; it is excluded from the same-ID evidence. The earlier same-name full replacement trial at 00:49:11Z kept the replacement alive with its record unchanged.

Independent checks 1–4 completed; author report first read after these checks, at about 01:05Z. New confirmed gaps:

- **M-1 (new): OpenCode removal retries carry stale authorization.** `session-manager.ts:342–348` awaits 200/600ms then calls removeOpenCodeSession again without rechecking. Own scratch-only test starts a purge; first mocked remove publishes app-2 as a new live owner of ses_old and throws a transient error. Second call still removes ses_old. Expected one call, observed two. Replacement record is preserved but its agent session is removed. This affects all three callers (`:998`, `:2668`, `:2991`). The author's table marks these rows "none" for gap and does not enumerate retries.
- **M-2 (new): ledger removal can erase a current owner's ledger after its lock wait.** `session-manager.ts:2720–2725` reads names before `delivery-ledger.ts:560` awaits its lock, then `:563` unconditionally removes. Own built-API test holds the real ledger lock, starts cleanup of an archived pending key, publishes kr-2 naming ses_shared, then releases the lock. At 01:04:54.174Z the new active owner and ledger both exist; at .179Z the owner still exists and ledger is gone, cleanup has no errors. No OpenCode executable or API was called. The author explicitly acknowledges this wait but treats it as part of the step; rule 1.0.1 permits only the tmux-command gap, so the rationale does not satisfy it. The existing ownership test mocks removeDeliveryLedger and cannot exercise this boundary.
- The floor crash check passes: a child stopped after floor=2 was written and before active generation2 was unlinked; after SIGKILL and retry the next reservation is generation3 (01:04:54.498–.507Z). The process death releases the record lock. This proves the selected stop window, not storage durability after machine power loss.

Further independent evidence at 01:09–01:11Z:

- Repeated the ledger repro with a **valid version-2 ledger containing one fresh unknown-admission entry** (`readDeliveryLedger` accepted it). 01:09:48.246Z: new kr-2 owner, ledger exists. .264Z: owner unchanged, ledger deleted, cleanup errors=[]. The loss is live delivery-reuse information, not merely removal of an unusable corrupt file.
- Two-process real-tmux rollback: at 01:09:48.599Z rollback destroys its failed launch; child 3336778 publishes same-name replacement generation4, working, agent process confirmed at 01:09:49.461Z. Parent result .491Z: original launch error, workspaceDestroys=0, worktreeExists=true, alive=true, replacement record intact.
- Quick private-server poll controls: all recorded sessions dead at 01:07:08.488Z; first poll working at .536Z; second killed/runtime generation2 at .596Z. No-server polls retain working. Replacement server: poll1 working at 01:07:09.284Z, poll2 killed/runtime generation5 at .320Z. Different-incarnation stand-in keeps killed at 01:07:17.455Z; matching handle control recovers working at .559Z.
- Actual fresh CLI lifecycle worker PID3328056 over two dead-at-start records: working/gen1 at 01:08:34.9Z, killed/runtime/gen2 by 01:08:36.151Z. It stopped before its private server.
- Actual `ao start`, corrected fixtures: 1s delay reservation 01:08:35.07Z, working/gen2 .113Z, working/gen3 plus prAutoDetect off .276Z, stand-in exec at 01:08:36.144Z; final 01:09:08.144Z still working/gen3. 3s delay working/gen2 01:08:35.180Z, working/gen3 .358Z, stand-in exec at 01:08:38.206Z; final 01:09:08.212Z still working/gen3. Both commands exit0; no killed version in external 2ms sampling. `ao status` and `ao session ls` omit `.generations` in all three fixtures.
- Harness correction: the first CLI trial parsed the plain numeric PID file as an object, failed before the observation period and stopped each private server too early. I recovered/stopped the exact two remaining scratch worker PIDs3322679/3324652 after verifying their scratch environment; fresh-worker PID3325255 had already exited. Those aborted trials are excluded. Corrected final runs stop each worker before its server; no real worker was involved.
- Own `NODE_OPTIONS='--input-type=module --require <harmless preload>'` and `--import` callers both write successfully; each preload log contains exactly one `true` (main thread). Helper only uses built-in modules and its message channel; it needs no preload. Its own env retains ordinary parent values while removing NODE_OPTIONS, with execArgv=[] unchanged.


## Final isolation and cleanup

All 39 recorded own process IDs (workers, CLI children, private tmux servers, crash child and stand-ins) were checked after completion: `live=[]`, `zombies=[]`. The independent whole-user process listing, filtered outside the shell for `ao47-kr4` and this worktree's built CLI, returned:

```text
[]
```

The successful CLI runs stopped exact scratch lifecycle PIDs3328056,3328071,3328099 before their private server PIDs3328025,3328102,3328148. Other private servers and race children exited or were stopped by their exact recorded PID. The earlier harness-order mistake is disclosed in the evidence log; its two remaining workers were identified by PID plus scratch environment and stopped. No name-pattern kill was used.

Scratch `/tmp/ao47-kr4` and `/tmp/ao47-kr4-marker` were removed after retaining the evidence in this review. Removed private socket files: ao47-kr4-cli-0, ao47-kr4-cli-1, ao47-kr4-cli-3, ao47-kr4-cli2-0, ao47-kr4-cli2-1, ao47-kr4-cli2-3, ao47-kr4-full, ao47-kr4-integration, ao47-kr4-quick, ao47-kr4-reservation, ao47-kr4-reservation2, ao47-kr4-rollback, ao47-kr4-same. No unrelated socket was removed. No scratch source/build artifact was retained outside the worktree; scratch source copies were restored before removal. Worktree `git diff --exit-code` succeeds; only requested untracked review/task/report files remain.

Required real-state inventory was run just before removing its marker:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46

```

Every printed entry is attributable: the `sessions` directory and its `ao-46` record both have mtime **2026-10-20 20:52:19.671124101 -0400**. The existing real worker's `60756641ca25-observability/processes/lifecycle-manager-271579.json` records `ao-46` transition **working → stuck at 2026-10-21T00:52:19.672Z**, matching that replacement write. The record currently says stuck. These are worker271579's writes, not review writes. Marker creation was 20:45:14.266528178 -0400. No new review test/state directory appears in the real-state inventory.

Protected real workers are still present and were never signaled:

```text
271579  PPID=1  node .../bin/ao lifecycle-worker agent-orchestrator
321413  PPID=1  node .../bin/ao lifecycle-worker agent-skills
```

No command targeted the real orchestrator pane or default tmux server. Every invoked node/helper/AO/test used env -i and fake HOME; live AO_* values referred only to scratch, and test gates had none. The gh stub refused all operations except version/auth status; no network gh call occurred. No OpenCode executable or real agent was invoked.

`ls -la --time-style=full-iso ~/.ao/bin` after the review, byte-identical to the before listing (`cmp` exit0):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

Prior reviews unchanged: r2 SHA256 `0ebf714655a74f4f5e8ac201d0518ac698cf2a4d0478e03839b80c928cc32f54`; r3 SHA256 `44d0b706090ae70e4021194441fd6f21bec2df559e5a5088d60567a12df22e42`, matching the r3 file in commit2328c1a0. No commit, push or PR was made.
