# Same-ID design r7 — RW and R2b-2 review by ao-62

RW: SOUND-WITH-CHANGES

R2b-2: SOUND-WITH-CHANGES

Zero blockers, three majors, one minor. Finding numbers restart for r7. These are design verdicts, conditional on the changes below, not implementation approval. The stopped-fleet barrier and OD-25(a), OD-26(a), OD-27(b), OD-28(b) remain decided. No other round is re-reviewed.

Reviewed design r7 from local `main:development/reviews/same_id_design_r7_opus.md`; test worktree `fe5d657528b7f014006eb4059f113cbfe665d69d`, branch `review/same-id-design-r7`. Main source snapshots were read at `75508f06c191979b7ba2cc9a9db3d01b96075105`. The metadata file is identical to the worktree's; main's send and runtime files are newer. Source line numbers below refer to these main snapshots unless expressly identified as test/prototype lines. Full r6 review was read first. The author's r7 report was read only after independently assessing brief items 1–3.

The rules close the reported r6 counterexamples. The remaining changes concern archive publication during a short write, complete creation-call coverage, tests that accept incomplete fixes, and the audit's missing operation-token persistence contract.

## Closure of r6 findings and required changes

| r6 item | State | Reason and remaining work |
| --- | --- | --- |
| B-1: another TMUX_TMPDIR and deleted executable | Closed in the design | Independently reran both cases. Descriptor-inode/socket-table joining finds the alternate-root server; a removed socket becomes unresolved. Deleted node normalizes correctly; comm also identifies renamed node on this host. Production implementation remains to be written. |
| B-1: unknown roots and unreadable identity | Closed in the design | P1 is host-wide, independent of covered roots; P1u/P3u block unless separately allowed. P2 includes AO-form names from any discovered server and known runtime names. Covered-root read errors block. |
| B-1: temporal condition | Closed with the stated operating assumption | The no-old-launch rule now covers shutdown through admission. Repeated enumeration improves coverage but is not a snapshot or prevention of process births. R7 explicitly admits that limit. |
| M-1: exception cleanup removes a committed launch file | Closed for the reported fault | R7 re-reads under the same hold, retains a committed/unknown file, and refuses to start a pane on unknown. Own four-point experiment agrees. Production must preserve strict error handling through the CLI. |
| M-2: latest archive picks the adjacent inbox directory | Closed for the layout defect | `.inbox-archive/` is outside all inspected archive-reader namespaces. Own lookup/update/copy-back and equal-time generation runs succeeded. New M-1 below concerns interruption during the record copy, not the old directory-selection defect. |
| `ao stop` order and preservation | Closed | Worker PID stops precede native runtime stops; the orchestrator is included. Restore precedes `ao start`. Current `ao stop` still calls `sm.kill` before `stopLifecycleWorker`; the corrected runbook avoids it. |
| One-write budgeted publish | Closed in the design | One record write commits fields, parsed values, state and cursor; unread bytes are backlog. The new test checks generation +1, a bounded prefix and its cursor. It does not establish the time budget or physical write count by itself. |
| Scoped allows checked at use | Partly closed | The written CLI contract is correct. The prototype accepts explicitly forbidden P1 entries and has no final admission validation/record; its green tests do not establish the promised contract (M-3). |
| Stronger competitor/archive/fault/discovery oracles | Partly closed | Prune completion and exact archive readback improve coverage. Spawn's arbitrary error still counts as success; the tmux restart oracle accepts a guard with no server identity; forbidden allows and admission-time checks remain uncovered (M-3). |
| Existing-session fence and synchronous effects | Closed at the design level | Keep the r6 full identity guard and non-waiting command-list restrictions. No new counterexample to those forms was found. Complete production path coverage remains an acceptance requirement. |
| N-1 / OD-28(b): creation on a running server | Partly closed | The name compare/create mechanism works. Both spawn callers must explicitly join it; the no-server residual also reaches a server created later (M-2). |
| OD-26(a): core r4 oracle | Closed as an assigned RW change | Section 7 explicitly requires refusal while the old writer lives and admission after it ends, preserving the frozen writer and preservation/PR checks. This review does not edit that test. |

## New findings

### M-1 — Publish the fixed-name record archive atomically before applying the retry rule (RW)

Design §3.4, lines 312–350; §6 RW recovery claim. Code boundary: `packages/core/src/metadata.ts:688–696`, particularly the direct `writeFileSync(archivePath, content)` at :693. R7 prototype: design §12, `val/dist/inbox.js`, `finish`, lines 1717–1726. No production RW source exists yet.

R7 says an existing archive with identical contents is a completed/retryable copy, while different contents mean damage. It does not replace the existing direct archive write with atomic publication. The prototype creates the final archive name directly with `writeFileSync`. A short write or death after truncation leaves the final name with partial contents. Recovery then classifies its own interrupted copy as an unrelated conflicting archive and cannot finish the intent. Current readers can parse that partial file as a record.

Own fault injection on the copied r7 prototype and the real built metadata APIs wrote the first ten bytes of the archive, then raised EIO:

```text
archive interrupted injected short archive copy
activeLaunch: cfa979ea35f80ce2c2cace5315f591aa
intent: 2026-10-22T12-40-08-652Z
archiveBytes: 10
latest: { launchId: 'c' }
recovery: 'inbox damaged'
namedFileInArchive: true
```

The active record and inbox retain the full data; this measured case is a recovery failure and an exposed partial archive, not demonstrated permanent data loss. R4's reader-error strictness does not solve it: reading ten valid key/value bytes need not raise an I/O error.

Required change: write and fsync a temporary record archive outside the selectable `<id>_<digit>...` namespace, publish the complete contents atomically without overwriting a conflicting final name, fsync its directory, then unlink the active record. An equal existing final file is kept, not truncated and rewritten (the prototype rewrites it despite the text's “kept”). Distinguish incomplete temporary files from conflicting committed archives. Inject interruption before publication, during the copy, after final publication and before active unlink; recover through all listed callers. This belongs to RW's writer/recovery protocol; R4 still owns how readers report genuine errors.

Reproducer: extract `val/dist/inbox.js` and `val/i6_writer.sh` from r7 §12, redirect all paths to reviewer scratch and the reviewer build, import the copied inbox module, begin/publish a launch, then replace `fs.writeFileSync` using `syncBuiltinESMExports()` with the following branch for the final archive path:

```js
if (!fired && typeof p === 'string' && p.startsWith(d + '/archive/app-1_')) {
  fired = true;
  realWrite(p, String(data).slice(0, 10), ...args);
  throw Object.assign(new Error('injected short archive copy'), { code: 'EIO' });
}
```

Call `archiveLaunch`; restore the fs export; inspect the active record, `readArchivedMetadataRaw`, and `recoverArchive`. This is controlled fault injection, not a claim that an actual disk error occurred.

### M-2 — Make the creation fence mandatory for both spawn callers and qualify the bootstrap residual (R2b-2)

Design §5.1, §5.3–5.5, §6 R2b-2 row and §7. Code integration points: `packages/core/src/session-manager.ts:2217` (worker spawn), :2780 (orchestrator spawn), :4487 (restore); `packages/plugins/runtime-tmux/src/index.ts:132`, :145–153. Prototype: r7 §12 `val/tmux/dist/runtime.js:2087–2089` in the design file.

Section 5.3 correctly describes a guarded create for “a spawn or a restore,” but the unchanged §5.1 caller list omits both spawn entry points, and the cited r5 §5.1 leaves the spawn reservation recheck in R3a. The new API's operation is optional; the prototype explicitly falls through to today's unguarded create when it is missing. The plan therefore leaves an actionable integration hole: implementing the listed R2b-2 callers and the runtime API can leave ordinary spawning outside the name fence even on an already-running server.

Own copied-prototype run on a private running server:

```text
newer holder fences { fenced: true, server: { pid: '2740235', startTime: '1792672976' } }
create without operation on running fenced server true
created session op (empty)
own fixture remaining []
```

Require worker spawn and orchestrator spawn to acquire/forward the relevant operation token and fence the chosen name before the corresponding launch record write, through creation, launch keys and cleanup. State where an allocated ID becomes the lock subject and recheck the reservation there. This can be the narrow creation portion of the operation protocol; the remaining R3a worktree/child protocol need not move wholesale. Missing operation evidence for a managed create must not silently select the plain running-server path. `core/src/tmux.ts:129` is another exported raw creation helper; no in-repository production caller was found, so document its boundary or route managed callers through the guarded runtime.

There is also a narrower correction to the already accepted bootstrap residual. An old holder can observe no server and prepare a plain create; another operation can start a server for another name and fence this name before the old create executes. The plain create then succeeds **on that running, fenced server**. Own saved-command schedule:

```text
H0 bootstrap observation: no server true
H1 name fence on newly running server: fenced, server 2704766/1792672716
H0 late BOOTSTRAP create against running fenced server: exit 0, exists true
late session operation (empty)
```

This does not reopen OD-28(b). Describe §5.4 as “creation prepared without a server identity,” whether it later starts a server or reaches a successor. Restrict §6's running-server guarantee to creates carrying valid fence evidence. Its worktree/credential effects remain exactly as disclosed. A read-only audit detects rather than prevents the late session.

### M-3 — The stronger oracles still accept the partial fixes they need to reject (RW and R2b-2)

Design §10 and §7 acceptance gates. Tests: `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts:288–308`; `packages/core/src/__tests__/same-id-defects-r7.test.ts:1024–1067`, and competitor control :628–643. Prototype barrier: r7 §12 lines 1955–1957 and 2022–2035.

Two measured discriminators:

1. Replaced the copied runtime prototype's create comparison
   `#{==:${id},${op.server.pid}/${op.server.startTime}/${op.id}}`
   with only `#{==:#{${opt}},${op.id}}`. All **4/4 runtime r7 tests passed in red mode**. The restart test leaves the new server's name option empty, so token mismatch alone rejects. It proves neither server PID nor start-time checking. My separate correct-guard test restored the old option on the new server and still refused.
2. The copied barrier prototype accepts explicit allow entries for any rule. With an owned Node carrying AO_SESSION, P3-only allow returned blocking P1; P1+P3 entries returned `{ admitted: true, blocking: [] }`. All **22/22 core r7 tests passed** against that same prototype. The design explicitly forbids P1/P2/P4 allows, but the existing test only checks that a P3 allow does not accidentally cover P1.

Strengthen the restart test by restoring the old name option before releasing the held create; require a refusal marker, and add cases distinguishing wrong PID from wrong start time. Reject forbidden allow rules independently of their PID/ticks; exercise each allowed rule, an allow expiring between checks, and admission-time validation. Keep a test-only process scope separate from the production allow mechanism. Assert the competing spawn's specific ID-taken/refusal result, not any truthy error. Add the M-1 partial-archive-copy fault and M-2 actual spawn/restore caller tests.

These are gaps in validation, not evidence that the written design authorizes those shortcuts. Full mutation coverage is listed as future acceptance work, so green prototypes must not be represented as completing it.

### m-1 — Define the durable value and crash interpretation used by the new audit comparison (R2b-2)

Design §5.4 lines 480–482 compares `@ao_op` against “the operation of the record's last holder.” Section 5.2 defines a random per-operation token, while the retained association schema (r4 §3.2, r3 §2.9) persists a **launch association token and evidence**, not the last operation token. Proposed code boundary: new `core/src/retained-inventory.ts`/runtime-identity and CLI audit/status; current record schema `packages/core/src/types.ts:336` (RuntimeCreateConfig), :344 (RuntimeHandle), :1650 (SessionMetadata), and metadata arbitrary fields. There is no implementation line for this new audit field because the schema/write step is unspecified.

Name the persisted field (or choose an audit comparison using existing durable launch identity), specify which successful/failed/refused operation updates it, and classify a crash between the tmux fence and that record write as unknown/pending rather than proof of an unrecorded session. Test a healthy associated/legacy session, an interrupted fence and a bootstrap orphan. The absent-runtime-name branch of the audit remains useful; the last-holder branch cannot be implemented reliably from the present schema description alone.

## Precondition: what is read, false negatives, and host costs

| Rule | What it reads | Coverage and remaining negative boundary | Ordinary-host false positive/cost |
| --- | --- | --- | --- |
| P1 | Same-uid `/proc/PID/environ`; retains AO key names and root classification only | Any AO key blocks even for another root. An env-cleared writer requires P2/P3/P4; a keyless embedded/unrecognized runtime is S3. A process born after the last read remains the stated operating-rule limit. | An unrelated command inheriting an AO key also blocks; an unset variable may still exist in the proc initial environment. That is conservative, not proof of active writing. |
| P1u | Error reading environ | EACCES and other non-exit errors block. Exact PID/start/rule exemption is the owner's assertion, not identity evidence. | Login/session services with unreadable environments need separate permits or termination. |
| P2 | Server comm/exe; its descriptor socket inodes joined to listening rows in `/proc/PID/net/unix`; queries verified private/production-discovered socket for server PID and panes; known record names | Alternate -L/TMUX_TMPDIR and -S locations are discoverable. Env-cleared AO panes are caught by names. A server whose socket is removed must become P2u. A custom unrecorded non-AO-form name with no AO/runtime/writer identity remains outside the claim. | An ordinary session deliberately named `<12 hex>-...`, or a stale recorded name, blocks. Name pattern is evidence for the barrier, not authentication. |
| P2u | Discovery/query failures on a recognized server | No answering path, unreadable descriptors/table or unsuccessful verified query blocks. Exact owner allow accepts uncertainty. Do not silently drop failed individual descriptor reads or a failed pane query. | An unrelated server with an unlinked/inaccessible socket needs an exact exception. |
| P3 | Exe symlink with final kernel ` (deleted)` removed; comm | Deleted node is caught; renamed node is caught on this node version by `node-MainThread`. Renamed bun/deno, embedded runtimes and other namespaces remain S3. | Every unrelated ordinary Node/Bun/Deno process blocks until explicitly allowed. |
| P3u | Unreadable exe identity | EACCES blocks unless separately allowed. P1u also covers the measured nondumpable child. Specify conservative handling for any other live-process identity error; do not confuse it with proved exit. | Common unreadable login processes need both P1u and P3u permits when both reads fail. Eight such processes may mean **16 one-rule entries**, not eight entries as §11.3 suggests. |
| P4 | argv, cwd, exe and descriptor links; W1–W4 from r5 §2.3 | Covers managed interpreter text and record/temp paths or open descriptors. Nonmatching copied/in-memory writers are explicitly residual. W3/full W4 are absent from the green prototype. Root coverage still matters for recognizing W2/W3 paths, even though P1/P2 are host-wide. | A reader/editor holding a record, unresolved managed basenames, or unreadable cwd/fds can block harmless work. |

P5 only labels a match; it cannot justify admission. The actual CLI must enforce the allowed-rule set {P1u, P2u, P3, P3u}; neither unknown root nor a P3 allow can excuse P1/P2/P4. Evaluate PID/start identity at each check and at admission. Expired entries do not permit replacement PIDs. Entries and check results belong in the barrier record.

Own proc-based reproduction on Linux/tmux 3.4 found the listening socket by descriptor inode and the `0x10000` flag, with the answering PID matching. Removing the socket left the server alive and its old path in the socket table, but unreachable. Deleted exe/renamed node/nondumpable results match r7. My additional enumeration run found the late runtime but exhausted the five-read limit amid host churn; the design's conservative “process list did not settle” refusal is appropriate. A five-pass loop must not claim it prevented a birth after its last read, PID reuse, exec of a previously seen process, or a process that completed between reads. The operating assumption is essential.

The prototype is narrower than the design: it identifies servers by comm only, associates P2 hits through live process PIDs, omits recorded custom runtime names, full W3/W4, install fsync, exact final checks and the admission record/revalidation. Test those production paths, including dead/remain-on-exit panes and query failure after a successful PID lookup. The green prototype is not a deployable fleet barrier.

## Crash walk, archive compatibility, and deployment ordering

| Boundary | Required result / assessment |
| --- | --- |
| Before or during candidate creation | Strictly reject unreadable/taken/changed state. A failed create/fsync can leave an unnamed candidate; it must remain safe to prune later. |
| Candidate exists before record publication | One synchronous hold excludes prune/archive; death leaves an unnamed empty candidate. |
| Definite record refusal | Remove only this candidate; do not start a pane. |
| Record published; link wrapper or temporary cleanup throws | Re-read within the same hold. A record naming L retains the file and counts as committed, with warning. Own faults confirm it. |
| Re-read fails | Keep L, report unknown, start no pane. Production must not turn an existence/stat/read error into proved absence. The second-read EIO experiment kept the file; the prototype's diagnostic was generic rather than the specified unknown message. |
| Creator dies after publication | Preparing record/file remain. Only the stopped-fleet barrier may infer the maker is gone and mark failed. Kill/archive follows the specified recovery protocol. |
| Publish stops | Fields, complete parsed prefix, published state and cursor are one atomic record update. Hold budgeting is cooperative: 1 MiB/1 s is not a hard guarantee against a stalled filesystem call. |
| Catch-up to a restore/archive | Freeze launch, dev/ino and S0; incomplete backlog or changed identity refuses. No launch means no selected legacy inbox. A partial trailing frame requires the documented pending-tail policy, not silent claims that all bytes were consumed. |
| Intent before inbox move | Retry moves the source and continues the same timestamp under the lock. |
| Inbox moved, record not copied | Retry uses destination; never recreate the active inbox before recovery. |
| Record archive partially written | M-1: current protocol/prototype can expose a partial final name and refuse its own retry. Require atomic publication. |
| Complete record archive exists, active unlink not finished | Verify equal committed content and finish idempotently. Do not rewrite an equal final file. Record-gone/new-record states must be left alone. |
| Missing/both inbox directories | The stated recovery table is correct: no-launch pre-RW may have neither; a launch with neither or any record with both is damaged/unknown. |
| Prune | Recover first, strict read, remove only empty unnamed files. Named/nonempty/unreadable files stay. |

The separate inbox archive namespace is compatible with every inspected current reader: metadata read/update/generation/reservation at :533, :706, :750, :854; session-manager active listing :201, archive lists :656/:673, allocation/reuse :956, holder scans :1001/:1752, archived updates :3231–3256, cleanup :3437, lookup :4122 and restore fallback :4239. None enumerates `.inbox-archive/`; active listings skip dots. This is a layout-compatibility statement, not a guarantee that existing error semantics are strict.

With valid timestamp names, intact archive namespaces and the per-ID hold, `max(now,last+1 ms)` over both directories is sufficient for equal clocks, backwards clocks and multiple generations. Own three-generation run produced `...000Z`, `...001Z`, `...002Z` and selected `feat/gen-3`. Existing intents retain their assigned name; do not choose a fresh timestamp during recovery. Failure to inspect a namespace is unknown, not an empty history. External deletion of both histories is outside this uniqueness argument.

RW owns layout, naming, publication and recovery; R4 owns reader error classification. Either landing order can preserve the new namespace, but atomic publication in M-1 must be in RW. The section 7 list of full createSessionManager archive/update/list/restore tests is still necessary; current helper/prototype checks are not that end-to-end validation.

The owner runbook correctly stops every worker before panes, preserves ordinary and orchestrator records/worktrees through native stops, then restores the manifest before starting workers. It must retain verified PID/start identity at the signal, apply all projects/configs, and wait for actual exit. Source confirmation: `cli/start.ts:1143` kills the orchestrator before :1153 stops the worker; `session-manager.ts:644` protects the primary checkout, while managed isolated workspaces may be removed by kill. No real stop/restore was run in this review.

## Tmux fence, round claims and inventory

Private tmux results from my own script:

```text
guarded create without server: exit 1, no server started
H0 fence -> H1 fence -> H0 create: refused, session absent
H1 create: created
existing-name create: exit 1, duplicate session; no later success marker
old-server create on successor with old name token restored: refused
competing name-fence pairs with exactly one winner: 40 / 40
bootstrap create prepared with no server, executed after H1 fences a new server: session exists, @ao_op empty
owned processes remaining []
```

These measurements support the synchronous `if-shell -F` compare/set and compare/new-session/set-option forms on this host. They do not prove arbitrary tmux command lists atomic: retain the no-WAIT/no-run-shell restrictions and recheck delayed hook effects where they execute. Keep the full server/session/pane/token evidence in session effects; @ao_op alone is insufficient for a recreated name. The r6 review's existing-session kill/recreation and mutation coverage remain relevant. A name fence and a session fence solve different boundaries.

RW's §6 claims are sound with the stated process-quiescence/S3/cap limits and M-1/M-3 changes. “No archive moves a named file” should mean no unrelated holder steals a pending candidate: a deliberate archive moves its own inbox under its intent. R2b-2's row needs M-2's creation-caller and bootstrap qualification; it cannot imply that every create arriving on a running server is guarded. Send and attach remain launch-guarded rather than operation-lock holders.

Re-inventory against the inspected main is complete for the listed send/key paths: CLI send C-u :134, buffer load/paste :141/:147, literal :156, initial Enter :160; Codex branch :374–406 reads only; other-agent waiting_input :417 sends no retry key; retries :434/:439 need guards. Core tmux Escape/load/paste/literal/Enter/kill are :171/:187/:188/:199/:209/:225. Runtime create and failure cleanup :132/:145/:147/:149/:153, destroy :182, send :192/:201/:202/:212/:220/:226 and attach :278 match §7. CLI attach resolution/arguments/spawn :187/:195/:209 remain required. Buffer load/delete does not protect a later paste. The creation coverage correction in M-2 is separate from this complete key-path inventory.

**OD-29: (a), using the test-only `processScope` for fixture PIDs.** This preserves the host-wide production barrier and isolates tests from the real fleet/SSH/login processes. Do not implement it as a production allow that can suppress P1/P2/P4. Preserve all three race schedules and their refusal-then-admission assertions; also scope the earlier r6 test's broad callback in production-facing qualification.

## Tests, changes to r6, and limits of green

All Node/pnpm/helper/test calls used `env -i HOME=/tmp/aosdr7/home TMPDIR=/tmp/aosdr7/tmp PATH=/tmp/aosdr7/bin:/usr/bin:/bin CI=1` with only required scratch additions. gh was a local stub; no model/Herdr/OpenCode executable was invoked. Install: `pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store` (379 reused, zero downloaded, HUSKY=0); build: `pnpm build` (pass).

The tests ran from a `git archive fe5d6575` scratch copy linked to this worktree's dependencies/build. Two isolation-only substitutions in the copied core r7 test route its hardcoded tmux binary through the scratch shim and rename alternate labels to `aosdr7-*`. No source/oracle was changed in the worktree. The shim adds `-L aosdr7-tests`; test-specific -S paths stay under scratch. The mutation/prototype runs below are explicitly separate from baseline tests.

| Own run | Result |
| --- | --- |
| core r7, red | 15 intended failures, 7 controls pass |
| core r6, red (including both changed archive oracles) | 5 intended failures, 3 controls pass |
| runtime-tmux r7, red | 2 intended failures, 2 controls pass |
| core r7 against copied r7 inbox/barrier prototypes, red | 22 pass, despite the forbidden-allow and archive-copy faults demonstrated separately |
| runtime-tmux r7 against create guard with server identity removed, red | 4 pass (M-3) |

Baseline commands: `pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/same-id-defects-r7.test.ts src/__tests__/same-id-defects-r6.test.ts` and `pnpm --filter @aoagents/ao-plugin-runtime-tmux exec vitest run src/__tests__/same-id-defects-r7.test.ts`, with `SAME_ID_DEFECTS=red`. All 22 baseline failures reached the named behavioral assertion; none was setup/infrastructure. Full suite/typecheck/lint were not needed for this documentation-only review. Author full-run results are not claimed as my own.

The r6 diff is justified and limited: exports/adds `archivedInboxPath`, derives moved-directory setup/assertions from it in stale restore and barrier recovery, and strengthens barrier recovery with exact final-name existence plus readable branch. Its loader/import changes support those assertions. It does not weaken the five old failures. Taking the path from the module alone would be circular, but r7's equal-time test separately asserts the required literal `.inbox-archive` location. A stronger exact-file assertion should read and compare each named archive itself, not just assert it exists and then read whichever file is latest.

| Named r7 test(s) | Why baseline is red / partial fix still accepted |
| --- | --- |
| `a fault after the link...`; `a fault in the cleanup...` | R6 deletes the named file. A patch retaining on just these two error shapes passes without validating every transaction error boundary or warning propagation. |
| `a re-read that cannot read...` | R6 removes L. Retain-and-throw-unknown on chmod failure passes without testing absent/other ownership, CLI no-pane behavior, or later recovery. |
| before-publication control | Passes; an unconditional failure before publication also passes this single control. |
| `the latest archive...`; `the archived record...takes an update` | R6 selects the inbox directory. Moving directories alone passes despite non-atomic record copying. |
| `a restore of an archived launch...with a new launch` | R6 refuses lookup. Test does not assert L2 != L1, so reusing the old launch identity can pass; it also does not reject stale cursor/intent fields explicitly. |
| `two archives...same millisecond...exact names` | R6 collides. Two specially handled generations pass without proving third/backward-clock behavior, interruption, or durable publication. |
| pre-RW recovery control | Passes; a writer that handles only no-launch intents also passes this control. |
| `a publish...budget...one record write` | R6 generation +2 and consumes third line. A single unbounded read followed by truncating the parsed prefix passes; forged/reset generation can hide multiple writes. It does not check the time budget or real >1 MiB boundary. |
| competing prune control | Correctly requires `{pruned:[]}` and the named file; globally disabling prune can pass it, though the r6 empty-file control defeats that across files. |
| competing spawn control | Any truthy child error, including timeout/unrelated failure, passes; it does not require the intended ID-taken result. |
| alternate-TMUX_TMPDIR pane defect | R6 misses it. Parsing the server's own environment instead of descriptor discovery could pass only this fixture; recorded custom names and other server identity paths are untested. |
| unresolved socket defect | R6 admits. Blocking any disappeared fixture socket passes without correctly handling unreadable descriptors/query failures. |
| deleted node defect | R6 literal basename misses. Matching only node-MainThread passes without suffix normalization for other runtimes. |
| unknown-root AO keys defect | R6 treats root as out of scope. Special-casing AO_SESSION/AO_DATA_DIR passes without handling every AO_* key. |
| unreadable environ/exe defect | R6 admits. The assertion accepts **either** P1u or P3u; implementing only one passes, contrary to two independent rule matches/permits. |
| process born after enumeration defect | R6 one-pass misses. Always taking two fixed passes passes this schedule without the promised bounded fixed-point algorithm. |
| P3 allow does not cover AO environment | R6 allows by PID alone. A rule-aware matcher that still allows explicitly forbidden P1/P2/P4 entries passes (measured). |
| wrong-start control; exact-P3 control | Check only static identity. Skipping check-2/admission revalidation can pass both. |
| unrelated alternate-server control | Passes; entirely ignoring ordinary servers also passes this control. |
| held-create identity control (tmux) | Confirms an actual shell-shim new-session call, improving r6's first-call ambiguity. It does not assert the next fence succeeded or qualify all later mutations. |
| superseded held create (tmux) | Baseline starts a session. Guarding only create while leaving launch keys/cleanup unguarded passes; absence on any unrelated client error can also pass without a refusal-marker assertion. |
| restarted-server held create (tmux) | Baseline starts a session. Token-only guard passes all four tmux tests because the new option is empty (measured). |
| healthy holder creates (tmux) | Confirms a session and operation option. It does not verify launch environment, launch command execution, full incarnation identity, or cleanup targeting. |

The changed r6 stale-restore oracle still accepts refusing every restore; the barrier-recovery oracle can accept a corrupt exact-name file plus a separate readable later file. Their existing failures remain useful, but they must be combined with the named successful restore and exact-content/crash tests. The unchanged r6 prune/archive schedules gain independent competitor controls in r7; they still need their own outcomes checked. No other round's old defects were reassessed.

## Correct changes to retain

- One hold encloses candidate ownership and record publication; strict re-read distinguishes refusal from unknown commit.
- Recover archive intents before making an active inbox; separate inbox archives from record selection.
- Monotonic per-ID timestamp allocation across both archive namespaces handles equal times.
- Host-wide P1, descriptor-based server discovery, deleted-exe normalization and exact one-rule allows make the stopped-fleet assumption checkable without pretending it is a live drain.
- Budgeted prefix publication commits fields and cursor together.
- Server-side name and session comparisons reject stale synchronous effects when all callers use them.
- Correct worker-first stop/restore order and explicit bootstrap/worktree limitations preserve the decided rollout scope.

## Reproducer retention

The following scratch scripts used copied prototypes from design r7 §12 and this worktree's built metadata/runtime. Every `/tmp/aosd7` and `ao-52` reference was changed to reviewer scratch/build; no author scratch was modified. Run only under the sanitized environment quoted above. The copied prototype modules are recoverable from r7 §12.

### archive-extra.mjs

```js
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import * as M from '/home/taisung/.worktrees/agent-orchestrator/ao-62/packages/core/dist/metadata.js';
import * as A from '/tmp/aosdr7/proto/inbox.mjs';
const root='/tmp/aosdr7/archive-extra';fs.mkdirSync(root,{recursive:true});
const d=root+'/partial';fs.mkdirSync(d,{recursive:true});
const L=A.beginLaunch(d,'app-1',{spawn:true});A.publishLaunch(d,'app-1',L,{branch:'feat/kept',worktree:root+'/ws'});
const realWrite=fs.writeFileSync;let fired=false;
fs.writeFileSync=(p,data,...args)=>{if(!fired&&typeof p==='string'&&p.startsWith(d+'/archive/app-1_')){fired=true;realWrite(p,String(data).slice(0,10),...args);throw Object.assign(Error('injected short archive copy'),{code:'EIO'})}return realWrite(p,data,...args)};
syncBuiltinESMExports();try{A.archiveLaunch(d,'app-1',L)}catch(e){console.log('archive interrupted',e.message)}finally{fs.writeFileSync=realWrite;syncBuiltinESMExports()}
const r=M.readMetadataRaw(d,'app-1');console.log('partial copy', {fired,activeLaunch:r.launchId,intent:r.archiveIntent,archiveBytes:fs.statSync(d+'/archive/app-1_'+r.archiveIntent).size,latest:M.readArchivedMetadataRaw(d,'app-1'),recovery:A.recoverArchive(d,'app-1'),namedFileInArchive:fs.existsSync(A.archivedInboxPath(d,'app-1',r.archiveIntent)+'/'+L+'.ndjson')});
const e=root+'/ambiguous-reread';fs.mkdirSync(e,{recursive:true});const realRm=fs.rmSync,realRead=fs.readFileSync;let cleanup=false,reads=0;
fs.rmSync=(p,o)=>{if(!cleanup&&String(p).includes('.app-1.reserve-')){cleanup=true;throw Object.assign(Error('injected cleanup EIO'),{code:'EIO'})}return realRm(p,o)};
fs.readFileSync=(p,...args)=>{if(cleanup&&String(p)===e+'/app-1'&&++reads===2)throw Object.assign(Error('injected second read EIO'),{code:'EIO'});return realRead(p,...args)};
syncBuiltinESMExports();try{A.beginLaunch(e,'app-1',{spawn:true})}catch(err){console.log('ambiguous reread error',err.message)}finally{fs.rmSync=realRm;fs.readFileSync=realRead;syncBuiltinESMExports()}
console.log('prototype strict reread second-read fault',{reads,recordLaunch:M.readMetadataRaw(e,'app-1')?.launchId,files:fs.readdirSync(e+'/.inbox/app-1')});
const g=root+'/three-generations';fs.mkdirSync(g,{recursive:true});const oldNow=Date.now;Date.now=()=>Date.UTC(2026,9,22,12);
try{for(let i=1;i<=3;i++){const l=A.beginLaunch(g,'app-1',{spawn:true});A.publishLaunch(g,'app-1',l,{branch:'feat/gen-'+i});A.archiveLaunch(g,'app-1',l)}console.log('three equal-time archives',fs.readdirSync(g+'/archive').sort(),M.readArchivedMetadataRaw(g,'app-1').branch)}finally{Date.now=oldNow}
```

### extra.mjs

```js
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
const S='/tmp/aosdr7', srv='aosdr7-extra';
const ticks=p=>{try{const s=fs.readFileSync(`/proc/${p}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return ''}};
const own=new Map();
const track=(p,what)=>{p=Number(p);if(p&&!own.has(p)){const t=ticks(p);own.set(p,{t,what});fs.appendFileSync(S+'/logs/owned.jsonl',JSON.stringify({p,t,what})+'\n')}return p};
const args=a=>['-f','/dev/null','-L',srv,...a];
const tm=(...a)=>{const r=spawnSync(S+'/bin/tmux',args(a),{encoding:'utf8'});return {code:r.status,out:r.stdout.trim(),err:r.stderr.trim()}};
const q=s=>'"'+s.replace(/["\\$]/g,'\\$&')+'"';
const opt=n=>'@ao_name_'+createHash('sha256').update(n).digest('hex').slice(0,16);
const ident=n=>'#{pid}/#{start_time}/#{'+opt(n)+'}';
const exists=n=>tm('has-session','-t','='+n).code===0;
function recordPanes(){const r=tm('list-panes','-a','-F','#{pid} #{pane_pid}');if(!r.code)for(const l of r.out.split('\n')){const[p,c]=l.split(' ');track(p,'server');track(c,'pane')}}
function anchor(){const r=tm('new-session','-d','-s','anchor','/bin/sleep 600');if(r.code)throw Error(r.err);recordPanes()}
function fenceArgs(n,seen,op){return ['if-shell','-F',`#{==:${ident(n)},${seen}}`,`set-option -s ${opt(n)} ${op} ; display-message -p fenced`,`display-message -p refused`]}
function fence(n,op){const seen=tm('display-message','-p',ident(n)).out;const r=tm(...fenceArgs(n,seen,op));return {r,ev:seen.split('/').slice(0,2).join('/')}}
function createArgs(n,ev,op){return ['if-shell','-F',`#{==:${ident(n)},${ev}/${op}}`,`new-session -d -s ${n} '/bin/sleep 600' ; set-option -t =${n}: @ao_op ${op} ; display-message -p created`,`display-message -p refused`]}
async function endServer(){recordPanes();for(const[p,v]of own)if(v.what==='pane'&&ticks(p)===v.t)try{process.kill(p,'SIGKILL')}catch{}for(const[p,v]of own)if(v.what==='server'&&ticks(p)===v.t)try{process.kill(p,'SIGKILL')}catch{}await sleep(150);const socket=`/tmp/tmux-${process.getuid()}/${srv}`;if(fs.existsSync(socket))fs.unlinkSync(socket)}
try{
 const n='cccccccccccc-app-1';
 console.log('guarded with no server',tm(...createArgs(n,'0/0','a')));
 anchor();const a=fence(n,'a'), b=fence(n,'b');
 console.log('fences a b',a,b);
 console.log('stale running-server create',tm(...createArgs(n,a.ev,'a')),'exists',exists(n));
 console.log('current create',tm(...createArgs(n,b.ev,'b')));recordPanes();
 console.log('existing-name create result',tm(...createArgs(n,b.ev,'b')));
 const saved=createArgs(n,b.ev,'b');await endServer();anchor();tm('set-option','-s',opt(n),'b');
 console.log('restart same token guard',tm(...saved),'exists',exists(n));
 let won=0;for(let i=0;i<40;i++){
  const seen=tm('display-message','-p',ident(n)).out;
  const results=await Promise.all(['a','b'].map(x=>new Promise((res,rej)=>{const p=spawn(S+'/bin/tmux',args(fenceArgs(n,seen,x+i)),{stdio:['ignore','pipe','pipe']});track(p.pid,'CAS client');let out='';p.stdout.on('data',d=>out+=d);p.on('error',rej);p.on('close',code=>res({code,out:out.trim()}))})));
  if(results.filter(r=>r.code===0&&r.out==='fenced').length===1)won++;
 }
 console.log('atomic fence pairs',won,'/40');
 // Synchronous compare/create across same-name recreation with a newer holder.
 fence(n,'new');console.log('old create after superseding fence',tm(...saved),'exists',exists(n));
 await endServer();
 // H0 plans plain creation when absent, loses its operation lock; H1 starts server for another name and fences N.
 const plain=['new-session','-d','-s',n,'/bin/sleep 600'];
 console.log('H0 bootstrap observation: no server',tm('display-message','-p','#{pid}').code!==0);
 anchor();const later=fence(n,'later');
 console.log('H1 name fence on newly running server',later);
 console.log('H0 late BOOTSTRAP create against running fenced server',tm(...plain),'exists',exists(n));recordPanes();
 console.log('late session operation',tm('display-message','-p','-t','='+n+':','#{@ao_op}').out||'(empty)');
}finally{await endServer();console.log('owned processes remaining',JSON.stringify([...own].filter(([p,v])=>ticks(p)===v.t).map(([p])=>p)))}
```

### creation-path.mjs

```js
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {setTimeout as sleep} from 'node:timers/promises';import {create} from '/tmp/aosdr7/proto/runtime.mjs';
const S='/tmp/aosdr7',name='dddddddddddd-app-1';
// This call and the prototype both resolve the first scratch PATH tmux to aosdr7-tests.
const tm=(...a)=>spawnSync('tmux',['-f','/dev/null',...a],{encoding:'utf8'});
const ticks=p=>{try{const s=fs.readFileSync(`/proc/${p}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return ''}};
const own=new Map();function scan(){const r=tm('list-panes','-a','-F','#{pid} #{pane_pid}');if(r.status===0)for(const l of r.stdout.trim().split('\n'))for(const p of l.split(' ').map(Number)){if(p&&!own.has(p)){const t=ticks(p);own.set(p,t);fs.appendFileSync(S+'/logs/owned.jsonl',JSON.stringify({p,t,what:'creation-path'})+'\n')}}}
try{
 if(tm('has-session').status===0)throw Error('private server already running');
 const r=tm('new-session','-d','-s','anchor','/bin/sleep 600');if(r.status)throw Error(r.stderr);scan();
 const rt=create();console.log('newer holder fences',await rt.fenceName(name,'newer'));
 await rt.create({sessionId:name,workspacePath:S,launchCommand:'/bin/sleep 600',environment:{PATH:S+'/bin:/usr/bin:/bin'}});scan();
 console.log('create without operation on running fenced server',tm('has-session','-t','='+name).status===0);
 console.log('created session op',tm('display-message','-p','-t','='+name+':','#{@ao_op}').stdout.trim()||'(empty)');
}finally{scan();for(const[p,t]of [...own].reverse())if(ticks(p)===t)try{process.kill(p,'SIGKILL')}catch{}await sleep(200);console.log('own fixture remaining',[...own].filter(([p,t])=>ticks(p)===t).map(([p])=>p));const sock=`/tmp/tmux-${process.getuid()}/aosdr7-tests`;if(fs.existsSync(sock))fs.unlinkSync(sock)}
```

### allow-extra.mjs

```js
import fs from 'node:fs';import {spawn} from 'node:child_process';import {setTimeout as sleep} from 'node:timers/promises';
import {checkFleetAndFence} from '/tmp/aosdr7/proto/fleet-barrier.ts';
const root='/tmp/aosdr7/allow-extra';fs.mkdirSync(root+'/sessions',{recursive:true});fs.writeFileSync(root+'/child.mjs','setInterval(()=>{},1000)');
const p=spawn(process.execPath,[root+'/child.mjs'],{env:{HOME:'/tmp/aosdr7/home',PATH:'/tmp/aosdr7/bin:/usr/bin:/bin',AO_SESSION:'app-1'},stdio:'ignore'});const done=new Promise(r=>p.once('exit',r));
const ticks=()=>{try{const s=fs.readFileSync(`/proc/${p.pid}/stat`,'utf8');return s.slice(s.lastIndexOf(')')+2).split(' ')[19]}catch{return ''}};const t=ticks();fs.appendFileSync('/tmp/aosdr7/logs/owned.jsonl',JSON.stringify({p:p.pid,t,what:'allow fixture'})+'\n');
try{await sleep(100);const base={install:[],sessionsDirs:[root+'/sessions'],processScope:pid=>pid===p.pid};
console.log('P3 only allow',await checkFleetAndFence({...base,allowEntries:[{pid:p.pid,startTicks:t,rule:'P3'}]}));
console.log('forbidden P1 plus P3 allows',await checkFleetAndFence({...base,allowEntries:['P1','P3'].map(rule=>({pid:p.pid,startTicks:t,rule}))}));
}finally{if(ticks()===t)process.kill(p.pid,'SIGKILL');await done;console.log('own fixture remaining',ticks()? [p.pid]:[])}
```

## Retained working notes

- Read the full task brief, CLAUDE.md, res-audit skill, and all 529 lines of the r6 review before assessing r7. The author's report remains unread until the independent assessment of brief section 2 items 1–3.
- Marker `/tmp/aosdr7-marker` created; scratch root `/tmp/aosdr7`; captured the required before listing of `~/.ao/bin`. No real AO command or default-server tmux command has run.
- Read r7 sections 0–2.5 and 3.1. The stated changes normalize deleted executable names, discover server sockets through proc descriptors, scope allows by PID/start ticks/rule, and move inbox archives outside the record namespace. These are design statements, not yet independent verification.
- Review hypotheses to check: socket inode joins and unresolved-server behavior; error boundaries around publication and strict re-read; archive timestamp uniqueness across generations and recovery; server start-time comparison and creation commands after restart; completeness of changed test oracles.

- Frozen offline install passed (379 packages reused, zero downloaded; HUSKY=0), then `pnpm build` passed in this worktree. No source changes. Tests run in `git archive fe5d6575` scratch copy with dependency/build links; the only test-copy changes route the core r7 absolute tmux executable through the private shim and rename `ao-r7-alt-*` to `aosdr7-alt-*`.
- Red results: core r7 15 intended failures / 7 controls pass; core r6 5 intended failures / 3 controls pass; runtime-tmux r7 2 intended failures / 2 controls pass. All 22 failures reach the stated behavioral assertions, with no infrastructure failures. These use fallback models (and today's runtime), not implemented r7 production modules.
- Independently reran the copied m1 measurement, rewritten to reviewer paths/servers: fd-inode joining against `/proc/PID/net/unix` resolved the alternate-TMUX_TMPDIR server and its AO-named pane; after socket unlink the PID remained alive and the path no longer answered. Deleted node normalized to `node`, and renamed node retained comm `node-MainThread`. The nondumpable owned child produced EACCES on both environ and exe. A child born after enumeration was absent from that enumeration and found by later reads. This host run exhausted the five-read settling limit; conservative refusal is needed on ordinary process churn.
- Independently reran m2's four faults on my built metadata API: before-link refusal leaves no file; after-link and cleanup exceptions retain the named file under r7; unreadable re-read retains it and reports unknown. R6 deletes the named file at the latter three boundaries. This supports closing r6 M-1 for its stated schedule.
- Independently reran m3: r6 adjacent `.inbox` causes null/false/refused lookup/update/copy-back; r7 separate namespace permits each and retains two generations at t and t+1 ms. Source inspection confirms the listed readers use `archive/` and active listings skip dot names. Remaining concern: partial record-archive publication is not covered by the exact-content retry rule or existing tests.
- Initial assessment of brief items 1–3 is complete before reading the author's report. Needed deeper tests: interrupted record-archive write/retry; partial fixes that pass the new oracles; a bootstrap create that arrives on an already-running, newly-fenced server; all same-ID creation callers.

- Real tmux extra run: 40/40 competing name-fence pairs had exactly one winner. A superseded guarded create refused; the current create succeeded; a duplicate name failed before the later set-option/display commands; an old-server create refused after restart even with the old token deliberately restored on the new server. A guarded create without a server failed to connect and started none. All owned PIDs from that run ended.
- Measured residual extension: H0 observes no server and prepares plain new-session; H1 starts an anchor, fences the same name on that running server; H0's saved bootstrap create then succeeds on H1's server and its session has empty `@ao_op`. Section 5.4 must describe absence at planning time, not only absence when the delayed create runs. This preserves OD-28(b), but narrows the unconditional running-server claim in section 6.
- Measured new archive fault: injected a partial record-archive write (10 bytes, then EIO) in the r7 inbox prototype. The active intent and complete record remain, and the inbox is in `.inbox-archive`; the reader exposes `{ launchId: 'c' }`, and retry returns `inbox damaged` because the named archive differs from the full record. The exact-content retry rule needs atomic archive publication; the current design/prototype does not supply it.
- Three archives at the same fixed clock time produced exact names at t, t+1 ms and t+2 ms and selected generation 3. This supports the monotonic-name rule for valid archive names under the one-ID lock.
- A second-read EIO hypothesis in the prototype's strict re-read did NOT delete the named inbox: the current `readMetadataRaw` throws for read errors. The file stayed; the prototype lacked the specified unknown diagnostic for that injected branch. Do not report this as a reproduced data-loss bug.
- Read the relevant r7 portion of the author's retained report after the independent assessment above. Its full-suite and prototype-green results remain author evidence, distinct from my selected red runs and extra experiments.

- Discrimination experiment: removed PID/start-time comparison from the copied runtime prototype's create guard, leaving only the name-option comparison. All four runtime-tmux r7 tests still passed in red mode. The restart test never reinstalls the old name-option value, so the absent option alone rejects; it does not require either server identity component.
- Prototype allow experiment with an owned Node child carrying AO_SESSION: a P3-only allow blocks on P1, but explicit P1 and P3 allow entries admit it. That contradicts the design's non-allowable P1 rule, while the new scoped-allow test does not exercise forbidden rule entries. This is a prototype/test limitation, not a claim that the written design permits P1.
- Creation integration evidence: the r7 caller list retains r5's omission of spawn; `main` has worker spawn, orchestrator spawn and restore runtime.create calls at session-manager.ts:2217, :2780 and :4487. R7 gives create an optional operation and its prototype falls through to today's plain create when it is absent. My copied prototype accepted a no-operation create on a running server after a newer name fence, and the session's @ao_op was empty. The plan must require the narrow creation fence/lock integration for BOTH spawn callers in R2b-2, while leaving the broader R3a worktree protocol deferred.
- Main inspected at 75508f06c191979b7ba2cc9a9db3d01b96075105; worktree fe5d657528b7f014006eb4059f113cbfe665d69d. Metadata source has no difference. Main's send/runtime source is newer than the author's test base; the re-inventory uses the main snapshots, not worktree offsets.

Provisional findings for final synthesis: M-1 (RW), atomic publication of the fixed-name record archive is missing from the crash protocol; M-2 (R2b-2), make both spawn callers participate in the creation fence and qualify bootstrap residuals by the planning-time observation; M-3 (both), the new tests still accept relevant partial fixes, including omission of all server identity checks and forbidden rule allows. Also clarify the audit's durable source for the record's last operation token; the operation token is otherwise ephemeral.

## Isolation and cleanup evidence

Marker `/tmp/aosdr7-marker` was created before other work. The baseline tests, copied prototypes and extra scripts used only the scratch home/state roots and private `aosdr7-*` servers; no default-server command or real AO command ran. No network, real gh operation, model turn, OpenCode invocation or Herdr server. No commit, pull, rebase, push or PR. Build artifacts/dependencies were created only in this worktree; scratch copies were under `/tmp/aosdr7`.

Process scans were read-only. The r6 fallback reads same-uid proc stat, exe, cmdline and cwd; scoped r7/prototype scans read only their fixture identities/environments and query only fixture servers. The copied m1 enumeration reads the proc PID listing and stat/exe of newly seen PIDs, retaining no foreign values. The final ownership audit reads same-uid stat/cmdline/environ/cwd/exe and keeps AO key names, errors and own-process matches. It neither signals nor waits on foreign processes. Its exact read-PID set and sanitized output follow (ancestor processes are the audit itself and its launcher tree, not test survivors).

```text
scan fields: same-uid stat/uid/state/start/parent, cmdline, environ, cwd/exe links; AO key names only retained
same-uid proc read PIDs 13870,13874,13893,13895,13899,13901,13904,13943,14053,14112,271595,271596,1101402,1101403,1102127,1847142,1847143,1847378,1847380,1849148,1849365,1849949,1850213,1850633,2002324,2002831,2240622,2240868,2240870,2240877,2243164,2246295,2246298,2246299,2256355,2601519,2601764,2601766,2601773,2604750,2610853,2610856,2610857,2778092,2797159,2799749,2799817,2799900,2802485,2802491,2802512,2825345,2825582,2833055,2833080,2833081,3753189,3753412,3760581,3760584,3760585,3827681,3829571,3845631,3845634,3845635,4099210,4099358,4106554
unreadable environments [{"pid": 13870, "errno": 13}, {"pid": 13874, "errno": 13}, {"pid": 1847142, "errno": 13}, {"pid": 1847143, "errno": 13}, {"pid": 1847378, "errno": 13}, {"pid": 1849148, "errno": 13}, {"pid": 1849949, "errno": 13}, {"pid": 1850213, "errno": 13}]
AO keys only [{"pid": 271596, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 1102127, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2002324, "keys": ["AO_CONFIG_PATH", "AO_LIFECYCLE_PROJECT", "AO_STATE_ROOT"]}, {"pid": 2002831, "keys": ["AO_CONFIG_PATH", "AO_LIFECYCLE_PROJECT", "AO_STATE_ROOT"]}, {"pid": 2240622, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2240868, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2240870, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2240877, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2243164, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2246295, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2246298, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2246299, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2256355, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2601519, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2601764, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2601766, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2601773, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2604750, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2610853, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2610856, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2610857, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2797159, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2799749, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2799817, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2799900, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2802485, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2802491, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2825345, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2825582, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2833055, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2833080, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 2833081, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3753189, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3753412, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3760581, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3760584, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3760585, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3827681, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3829571, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_ISSUE_ID", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3845631, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3845634, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}, {"pid": 3845635, "keys": ["AO_CALLER_TYPE", "AO_CONFIG_PATH", "AO_DATA_DIR", "AO_PROJECT_ID", "AO_SESSION", "AO_SESSION_ID", "AO_SESSION_NAME", "AO_STATE_ROOT", "AO_TMUX_NAME"]}]
own processes excluding audit and ancestors []
logged own PIDs still present []
protected worker 2002324 {'state': 'S', 'ppid': 1, 'ticks': '16223661'}
protected worker 2002831 {'state': 'S', 'ppid': 1, 'ticks': '16223980'}
own private sockets outside scratch []
```

All logged own PIDs are absent, all own remaining-process matches are empty, and no own private socket remains outside scratch. Each test/script child completed or was stopped by its tracked PID; private server shutdowns were confined to their private selectors. Protected workers 2002324 and 2002831 were observed only and remain running. Every yielded test/build/install command was collected.

Required command before and after:

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

The diff is empty, including timestamps.

Required real-state scan:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr7-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

| Printed path under `~/.agent-orchestrator/60756641ca25-agent-orchestrator/` | Attribution |
| --- | --- |
| `sessions` | Real-fleet record directory changes, including the records below; no reviewer output is written here. |
| `sessions/ao-55` | External ao-55/session-lifecycle write; not from a reviewer fixture. |
| `sessions/ao-52` | External author session/lifecycle write; not from a reviewer fixture. |
| `sessions/ao-orchestrator` | External orchestrator/session-lifecycle write; no orchestrator pane was read or controlled. |

These attributions distinguish concurrent real-fleet writes from reviewer output. Filesystem timestamps do not identify the exact writing PID, so no exact actor is claimed. Every reviewed helper/test ran with scratch HOME and scratch records; the real state root was only inspected with the permitted commands and the mandated find.

Cleanup: `/tmp/aosdr7` and `/tmp/aosdr7-marker` are removed after this evidence is captured. The author's `/tmp/aosd7` is untouched. Own process list `[]`; own private socket list `[]`. Final deliverables are this uncommitted review and the atomic `.agent_report.md`; no source/test change in the worktree.
