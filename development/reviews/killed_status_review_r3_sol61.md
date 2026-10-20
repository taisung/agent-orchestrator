# Killed-status review, round 3

NOT-LAND-SAFE

**2 blockers, 2 majors, 1 minor.** Original claim/restore record overwrites and the launch timer are fixed, but stale operations can still kill a replacement runtime, remove its worktree, or contaminate its record through generation reuse. Automatic cleanup can also kill a newly claimed open PR. The helper's environment-driven module-mode failure remains. Details and independent reproductions follow; no implementation changes were made.

| Round-2 item | New state | Evidence |
|---|---|---|
| B-1 stale async claim/restore writes | **Partly fixed** | Original cases 1–3 now refuse and preserve records; new B-1/B-2/M-1/M-2 expose unsafe cleanup and remaining stale decisions. |
| M-1 timer/run scoped to ID | **Fixed** | Own T270/T300 fake-clock case and shipped 5-minute live replacement run; two-poll/bookkeeping/tracked-status tests fail under the ID-only mutant. |
| m-1 identity boundary coverage | **Fixed** | All six boundary cases pass; widening both sides to 60 seconds fails the two outside-limit cases. |
| m-2 ESM eval helper startup | **Partly fixed** | CLI ESM eval/plain .mjs and preload flags pass; NODE_OPTIONS=--input-type=module still times out (new m-1). |
| m-3 caller generation / archive generation | **Fixed as reported** | Reservation ignores supplied counter/token; archive bookkeeping increments. Non-archive deletion resets are a separate new B-2. |
| Alternating-answer fixture | **Fixed** | Both calls within each poll get the same answer; six polls alternate and the two-negative control kills. |


Reviewed: `e6e23c38..f35b665f`, worktree HEAD `f35b665fb070e4490fd6974aac134f1915a7799e`.

This review follows the round-3 reviewer brief and the author's round-4 brief. No source changes, commits, pushes, PRs, real AO commands, or model turns. All executable checks use `/tmp/ao47-kr3`, a fake HOME, an empty inherited environment, a rejecting gh stub, and private tmux shims. Marker: `/tmp/ao47-kr3-marker`. The author report was read only after independent inspection and API probes for items 1–5.

Before starting, `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Evidence recorded during review

- Read `.agent_task.md`, `CLAUDE.md`, and the author's round-4 brief. Existing untracked round-2 review is preserved.

Independent source pass (author report still unread):

- `metadata.ts:279–331,521–831` now assigns a UUID and generation to reservations, filters caller control keys, makes generic merges non-creating, and offers atomic expected-value deletion/archive/copy-back. Missing-versus-empty is appropriate for old absent keys; it does not supply a unique identity for an old empty reservation. New UUID reservations fix that ABA case among new writers.
- `session-manager.ts:3367–3419` checks launch before checkout, then generation plus launch afterwards; takeover records use their original read. `restore:3688–3705,3795–3841` reserves archive copy-back and compares final/delta writes. The original record-corruption reproducers should now fail closed.
- Potential remaining destructive paths found for independent reproduction: restore final-write failure unconditionally destroys its returned handle at `:3801–3813`, although another record can name the same tmux runtime; rollback caches ownership before asynchronous destruction (`:1442–1473`) and uses that cached value to remove the shared worktree afterwards. These differ from the explicit fresh checks added to kill and recovery cleanup.
- `lifecycle-manager.ts:250–260,368–385,1547–1573` scopes negative runs and tracked status to reservation/runtime/tmux/creation/restore identity. Bookkeeping/status/PR/generation are excluded. No ordinary poll writer reserializes runtimeHandle or changes restoredAt; on-read repair changes role/PR/status only. A semantically equivalent but differently serialized external handle would reset once; repeated external identity writes can keep resetting it, but no shipped periodic writer does that.
- Production caller search: all Node session-record writes are now conditional in session-manager, lifecycle-manager, recovery/actions; no CLI or plugin TypeScript caller invokes generic updateMetadata. Explicit writeMetadata and reserveSessionId production uses have been replaced by owned reserveSessionRecord. Tests and integration fixtures use the exported writers intentionally. Bash hooks remain outside the lock, unchanged and able to race.
- Frozen install and worktree build completed successfully. Filter gates are running. The shipped 300,000 ms live replacement-launch bound is running on a private server; its first old-launch no-server poll was 2026-10-20T23:10:01.994Z.

### Own API reproductions, 2026-10-20T23:11:23Z

All use the built exported session manager, fresh scratch configs/state, and stand-in async plugin callbacks; no author's script or state.

| Reproducer | Result |
|---|---|
| claimPR archives and reserves ID during checkout | Throws “changed … its record was not written; check the session and claim again”; exact fresh UUID/generation=2 reservation unchanged. |
| claimPR publishes full replacement during checkout | Same visible refusal; replacement spawning/feat-new/handle/generation=3 unchanged, no PR attached. |
| restore archives during runtime.create | Throws; active remains null, new runtime destroyed best effort. |
| restore archives and reserves during runtime.create | Throws; exact fresh reservation remains unchanged. |
| restore publishes newer launch naming returned runtime | Record survives, **but destroy is called on the runtime that the replacement owns**. Own two-process real-tmux confirmation pending. |
| spawn postLaunchSetup throws; another launch replaces record during rollback runtime.destroy | Replacement record generation=4 survives; **its shared worktree is removed**, workspaceExists=false. The cached `checked.state` from before the await authorizes the later destroy. |
| T0/T240 no-server; replace T270; polls T300/T540/T599999/T600 | working, working, working, killed. Replacement gets its own five-minute run. |
| Reservation caller generation=99/reservationId=chosen; active merge; archive merge | UUID/gen1, unchanged UUID/gen2, unchanged UUID/gen3; missing generic update returns false. |

Items 1–5 have now had an independent source/caller pass and own API probes. The author's report may now be read for comparison.

### Confirmed new findings (IDs restart for this review)

**B-1 — A stale restore kills the replacement launch's live tmux runtime.** `packages/core/src/session-manager.ts:3801–3813` unconditionally calls `runtime.destroy(handle)` after its final compare fails. A handle's tmux ID is reused; creation “a moment ago” does not imply ownership. This is a new destructive failure handler in round 4, not merely the pre-existing pre-destroy name race.

Own two-process run against the shipped build and real private tmux (`ao47-kr3-race`):

```text
23:12:57.117Z parent PID 2031201: restore created ao47kr3-race-1, handle.createdAt=1792537977117
23:12:57.857Z child PID 2031320: archived/reserved same ID, stopped parent's runtime, created replacement
                           record generation=3, branch=feat/replacement, handle.createdAt=1792537977343; isAlive=true
23:12:57.900Z parent: final compare refused, “its new runtime was stopped and its record was not written”
                    replacement record unchanged and working; isAlive=false
```

Reproduce with an actual `sm.restore` runtime wrapper: await the real `runtime.create`, then await a second Node process that archives/reserves the ID, destroys that runtime and creates/publishes a replacement using the same tmux name, then return the first handle. The stale restore's final refusal destroys the child launch. The new tests use different returned IDs (`rt-restored` versus `rt-new`) and assert only record survival; they miss this same-name case. Apply an ownership check before the failure cleanup, as rollback already attempts; runtime destruction ultimately needs an incarnation-safe protocol for the smaller name races.

**M-1 — Launch rollback uses ownership cached before awaited cleanup and removes the replacement's worktree.** `packages/core/src/session-manager.ts:1447–1473`, particularly the `checked.state` branch at `:1460`. `rollbackLaunch` checks once, awaits runtime destruction and prepared-session discard, then destroys the shared workspace using that earlier result. Own API reproduction: spawn's `postLaunchSetup` throws; while rollback awaits runtime.destroy, another process archives/reserves/publishes the replacement using the same managed worktree path. Spawn rejects with the original post-launch error, replacement record remains spawning/generation=4, and workspaceExists=false. Conditional record release protects the record, not the replacement's files. Re-check current ownership after awaits and before each destructive step, following the newly added kill/recovery checks. This broad window already existed in unconditional old rollback; the new rollback's claimed ownership guarantee still leaves it open, so the round-2 async-path audit is only partly fixed.

**M-2 — Cleanup accepts an obsolete PR decision because it compares only launch identity.** `packages/core/src/session-manager.ts:2719–2721,2768,2460–2467`. Automatic cleanup decides from a particular PR/issue. Its `decidedFrom` loses those fields when reduced to `launchIdentity`. Own built-API reproduction at 23:14:53.020Z: cleanup queries PR #1; inside that asynchronous SCM callback, actual `sm.claimPR("kr-1","2")` succeeds and publishes open PR #2 (`pr_open`, generation=3). The old query then answers closed. At 23:14:53.021Z cleanup returns `{killed:["kr-1"],skipped:[],errors:[]}`, destroys runtime/worktree and archives PR #2's record. Check generation, or at least the decision's PR/issue/status, before automatic cleanup. This pre-existing race remains in the changed cleanup path and requested stale-decision audit; the author's table overstates its protection. A direct user kill correctly tolerates a status or PR change, while automatic cleanup must respect the premise for its decision.

**m-1 — Module mode from NODE_OPTIONS still breaks the lock helper.** `packages/core/src/metadata.ts:177–182`. `execArgv: []` fixes command-line `--input-type=module -e`, but not inherited environment options. Own clean child with `NODE_OPTIONS=--input-type=module`, importing the built metadata API and calling writeMetadata, exits 1 after the helper's 10-second no-answer wait. Same code with command-line `--input-type=module` succeeds in 41 ms; plain .mjs 58 ms. Command-line --import, --require, --loader and NODE_OPTIONS --import/--require with harmless preloads pass (29–56 ms). The CJS preload runs again in the worker through NODE_OPTIONS, confirming the environment inheritance. Give the worker an explicit environment/execution context and test the NODE_OPTIONS variant. Prior m-2 is partly fixed.

Three reviewer-written assertions in the scratch archive fail against otherwise pristine source (original 52 tests skipped): “stale restore does not destroy a replacement that owns the same runtime name”; “rollback re-checks the replacement after awaiting runtime destroy before removing its worktree”; “cleanup does not kill an open PR claimed during its obsolete closed-PR query”. `Test Files 1 failed (1); Tests 3 failed | 52 skipped (55)`.

The first shipped-bound attempt had valid record/timer observations, but its replacement stand-in path was moved while the loaded script still referenced the old path. It does not establish a live replacement agent. A repeat uses a fixed path and explicit `agent.isProcessRunning` checks; both launches are confirmed running before their private servers are stopped. Only that repeat is used for the live-agent result.

**B-2 — Deletion without an archive repeats generations, bypassing generation-only lifecycle compares.** `packages/core/src/metadata.ts:774–778` starts a reservation at latest archive+1, losing the previous active counter on `deleteMetadata(..., false)`; `session-manager.ts:1420` uses this delete for launch rollback. `lifecycle-manager.ts:737–743,1003–1009` compare generation alone. New random reservation IDs do not help once the launched record removes them, and those callers do not compare launch identity anyway.

Own built-API reproduction at 23:18:51.640Z: lifecycle begins detecting a PR from old launch `rt-old`, branch feat/old, generation=2. Its async detectPR callback deletes without archiving, reserves again (generation=1), publishes `rt-new`, branch feat/new, spawning, generation=2, and returns the old branch's PR #1. At 23:18:51.642Z the new record has generation=4, still rt-new/feat-new/spawning, **but now holds old PR #1 and the old launch's pinned summary**. This uses only the current Node writers and locks. A failed-launch rollback followed by a new spawn uses precisely the delete-without-archive/re-reservation sequence. Add an incarnation compare to generation-only readers, or retain a monotonic counter/tombstone across every deletion. Audit PR discovery, bookkeeping and repair, not just persistStatus (which already compares the handle). A compare that means “any Node write cancels” must not accept a repeated generation.

Line-reference correction for M-1 above: cached ownership is read at `:1446`, runtime destroy awaits at `:1453`, prepared discard at `:1459`, and stale workspace authorization is `:1460–1462`. M-2's old PR query is `:2719–2721`.

## Async/caller audit and remaining windows

I searched all record-writer references across core, CLI, plugins, and tests, then traced the reads and awaits feeding every production call. The author's table covers the named entry points, but not all of their safety conditions. No additional production Node record writer was found outside that list. Its “fixed” labels need the qualifications below.

| Path | Compare / result of independent audit |
|---|---|
| claimPR own target | Initial launch check before checkout; generation plus launch after checkout. Correct for replacement and ordinary concurrent Node writes. The checkout itself has already changed files when the final compare rejects. |
| claimPR previous owners | Original generation, PR and status snapshot; correctly refuses changed owners. |
| spawn / both orchestrator modes | UUID reservation and ownLaunchRecord comparisons guard each record write/release. Preserving a newer same-name runtime when already replaced is correct. Cached ownership across rollback awaits is M-1. |
| project orchestrator reuse/replace | Re-reads after liveness, conditional deletion, keeps another reservation, stops orphan runtime only when record absent. The concurrent reuse branch may return its earlier snapshot, but makes no record write. Named-runtime side effects still have the pre-existing check/destroy window. |
| restore | Absent-only archive reservation, expected archive identity, pre-destroy check, final/delta launch comparisons. Original corruption fixed; unconditional failed-final destroy is B-1. No claim is acquired for an in-place restore, so concurrent restores still depend on tmux creation failing on name collision. |
| direct kill | Launch compare matches explicit user intent despite PR/status changes. Checks after runtime destroy and before purge protect later steps. Archive compare protects replacement records. An error after a slow workspace destroy can leave the replacement record retained after files were already removed; the check cannot undo a destructive operation already in flight. |
| automatic cleanup kill branch | Correctly avoids a replacement launch, but launch-only is insufficient for changed PR/issue decisions (M-2). |
| cleanup archive marks and ledger keys | Removed OpenCode ID / pending-ledger key comparisons guard the particular artifact removed; new pending keys are not overwritten. |
| remap active/archive | Launch identity plus original mapping; appropriate to tolerate bookkeeping and reject mapping/launch changes. |
| send and retry | No direct record write; retry enters guarded restore, including its B-1 failure path. Delivery still targets the session's named runtime; it is not an incarnation lock. |
| lifecycle status | Generation, status, PR and handle/name; previous stale-closed-PR protection remains. Launch-key timer/tracked-state reset is correct. |
| lifecycle PR discovery / bookkeeping | Generation only; deletion-without-archive ABA is B-2. A successful stale discovery refreshes session.metadata with the new record and enables a further stale summary write. |
| read repair | Generation/PR/status; ordinary writes protected, but counter reuse can also defeat a pure generation premise if old PR/status match. It changes role/PR/status, not runtimeHandle/restoredAt. |
| recovery recover/escalate/cleanup | Assessed generation, PR/status and launch; cleanup checks again after runtime destroy. Correctly refuses replacement records; stricter bookkeeping conflicts have the failure cost discussed below. |

**Two explicitly requested open windows:** kill's record read/async launcher check → named runtime destroy (`session-manager.ts:2459–2496`) and restore's stillOwned → old named destroy (`:3751–3763`) remain susceptible to another launch taking the same tmux name between check and command. Rate both as major residual concurrency risks, pre-existing before this round, narrower after these checks. They need runtime-incarnation serialization/validation; adding record checks alone is not atomic with tmux. They are not new blockers by themselves in this scoped round. New B-1 is different: the final compare has already established loss of ownership, yet the new failure handler deliberately destroys by reused name.

**Failure cost:** claimPR now tells the operator “check the session and claim again.” A checkout of d seconds overlaps a 30-second poll with probability about min(1,d/30) if every poll writes: 1 s ≈3%, 3 s ≈10%, 15 s ≈50%. Actual rates are lower because stable polls generally only read; transitions, first summary pinning, dispatch hashes/reactions write. A rejected claim leaves the checkout side effect; retry after checking the session is necessary. Recovery returns “the session record changed after the assessment; nothing was written,” without an explicit rescan instruction. A changed generation after runtime destruction can leave the record/worktree kept but runtime stopped. Better phase-specific errors/retry instructions are a follow-up, not another landing blocker. Generation guards are preferable to silently committing stale data.

## Record compatibility and ownership

- All production record creation now goes through reserveSessionRecord: worker identity reservation, isolated orchestrator reservation, project orchestrator reservation/retry, and restore archive copy-back. No production generic updateMetadata caller needs creation. It remains exported; tests and integration fixtures were intentionally adapted to create explicitly. writeMetadata/reserveSessionId remain public explicit creators, with only test callers in this repository.
- reserveSessionRecord creates reservationId using randomUUID, ignoring caller generation/token. callerUpdates ignores non-empty supplied tokens and permits removal. First prepared/launched record removes the token; full writes whitelist keys and cannot import it. Archive copy-back owns a fresh UUID. Normal bash sed changes retain unrelated keys, including a reservation token; their unlocked read/mv can nevertheless replay or drop a stale token and counter. That pre-existing helper race is not fixed by this change.
- holdsExpected intentionally equates missing and empty because empty updates remove keys. New reservations differ by UUID even with identical content. Old complete records without token/restoredAt compare and acquire new generations normally. Old empty reservations have no unique launch identity; new code cannot retrospectively distinguish two byte-identical legacy versions. Missing-key compatibility is not itself a permanent lockout.
- Mixed versions provide no fleet-wide serialization guarantee until old Node writers restart: old merges preserve unknown keys but do not advance generation; old full writes may drop generation/reservationId; old writers can still recreate missing records. New operations reading those records take fresh expected values and are not permanently compare-blocked. Old readers ignore extra keys and continue reading worktree/status/PR as before. A new in-flight owner may correctly lose its compare after an old full rewrite. Repeating old fields/counters can cause ABA; new B-2 additionally reproduces with new writers only. Restarting old CLI/worker processes is necessary for uniform new guarantees, but is not performed by this review.
- launchKeyOf uses fixed outer key order and the stored runtimeHandle string verbatim. No shipped polling/repair/helper path continually rewrites that string or restoredAt. Status/PR/hash/summary/generation writes keep the run. Recovery's restoredAt write deliberately creates one new recovery identity. External writers repeatedly reordering handle JSON or rewriting restoredAt can indefinitely reset a run; this is an explicit launch-identity mutation, not normal bookkeeping. I found no natural new-key-every-poll path. Own no-server run converges within bound plus one 2-second poll.

## Test quality and independent mutations

Changed existing tests preserve their earlier behavioral assertions, except the intentional public contract changes: missing generic merge must no longer create; reservations now contain UUID/counter; recovery fixtures must exist before acting. Spawn's mocks follow reserveSessionRecord instead of the replaced wrapper. The generation matcher in a concurrent-reservation fixture is looser than an exact count, but new dedicated counter tests assert exact progression. The alternating fixture now verifies paired per-poll outcomes plus a meaningful killing control. The new stale-write tests run real manager/action APIs with async mutation callbacks; they do not exercise same-name restore failure cleanup, ownership changing inside rollback cleanup, stale cleanup PR decisions, or counter reuse across deletion without archive. Four reviewer assertions for those cases all fail: `Test Files 1 failed (1); Tests 4 failed | 52 skipped (56)`.

Independent mutant copy: `git archive f35b665f` under scratch; no package build outside this worktree. Local Vitest transpiles source and record-lock child fixtures. Pristine baseline: `Test Files 3 passed (3); Tests 108 passed (108)` (52 stale writes, 38 convergence, 18 lock).

| Removed behavior | Independently failing tests / summary |
|---|---|
| Restore final compares nothing | review case 3: an archive plus a new reservation during runtime.create keeps the reservation; a newer launch published during runtime.create keeps its record; from the archive: a kill and a new reservation after the copy-back keep the reservation; from the archive: another restore's copy-back of the same archive is told apart by its reservation ID; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯** |
| Constant reservationId | from the archive: another restore's copy-back of the same archive is told apart by its reservation ID; an archive plus a new reservation during runtime.create: the new reservation stays, and so does the shared workspace; a delete without archive plus a new reservation is told apart by the reservation ID; isolated mode: an archive plus a new reservation during the workspace step keeps the reservation; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯** |
| Launch key ignores incarnation (same ID) | does not kill a replacement launch at its first 'no server' answer; it gets its own 5 minutes and two polls; does not kill a replacement launch whose first 'no server' answer comes after 5 minutes of the old launch's run; needs two 'gone' polls of the replacement launch itself (C1 across a reused ID); does not use the tracked status of the old launch for the replacement; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯** |
| Generic merge creates again | updateMetadata, updateMetadataIf and deleteMetadata leave a missing record missing; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯** |
| Helper inherits execArgv | from a child started with `node --input-type=module -e`; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯** |
| Archive keeps generation | the review's reproducer: an archive bookkeeping write increments, a reservation ignores a caller's generation; every writer ignores a caller's generation and a caller's reservation ID (only its removal counts); **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯** |
| Remove recovery cleanup re-check | cleanup: a new launch during the runtime destroy keeps its worktree and record; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯** |
| Remove claim pre-checkout check | a new launch before the checkout stops the claim before any checkout; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯** |
| Remove kill post-destroy re-check | a restore during the runtime destroy: the worktree, agent session and record stay, and the kill fails; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯** |
| Both identity tolerances =60 seconds | a lag of -1001 ms: recovers=false; a lag of 15001 ms: recovers=false; **⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯** |

## Live controls and gates

All timestamps below are external record reads, not logging inserted into source. All tmux servers are private, fake HOME and scratch PATH, no real agent/model process. The small sleeps and explicit checks in control scripts do not alter shipped bounds.

Confirmed shipped-bound replacement run (both launches processRunning=true):

```text
23:13:51.025Z old stand-in live
23:13:51.585Z old first no-server; another no-server at +30 s
23:14:22Z     replacement stand-in live after archive/reserve/new handle, same session ID
23:14:23.479Z replacement first no-server (old run age 31.894 s)
23:18:54.392Z replacement still working, own run age 270.913 s; old run age 302.807 s
23:19:24.939Z replacement killed/runtime, own run age 301.460 s; generation 4→5
```

The replacement was never polled alive by the lifecycle, so an alive answer did not reset the old streak. This specifically verifies the launch-key fix with the shipped 300,000 ms bound. A first attempt's path change invalidated the live-agent premise, as recorded above; it is excluded from this result.

Quick full-poll repeat on private server controls3:

```text
23:19:24.648Z all recorded sessions kr-1/kr-2 dead; unrecorded keeper keeps server alive
23:19:24.705Z poll1: working / working
23:19:24.765Z poll2: killed/runtime / killed/runtime
23:19:24.813Z new lifecycle over reset working records already dead: poll1 working / working
23:19:24.861Z fresh poll2: killed/runtime / killed/runtime
23:19:26.000Z server stopped: kr-3/kr-4 no-server, working / working
23:19:26.074Z second no-server poll: working / working
23:19:26.187Z replacement private server with same name, poll1: working / working
23:19:26.243Z replacement server poll2: killed/runtime / killed/runtime
23:19:29.195Z later actual runtime under kr-3's old name: record remains killed
23:19:35.403Z same actual kr-5 launch, running=true, killed/runtime record: recovers to working, gen2→3
23:19:36.603Z next check remains working
```

The first rapid same-launch control hit Claude's existing 5-second ps cache before the new stand-in appeared in its snapshot; it correctly kept killed on an unconfirmed process. Repeating after 6 s gave running=true and recovery in the first check. This is not an identity regression.

Actual built `ao start`, project orchestrator, clean scratch configs/state, stand-in visible as claude 1 s / 3 s later. External reader sampled each distinct record version at 2 ms:

```text
delay1: 23:17:53Z reservation UUID/gen1 → working/gen2 → working/gen3 (prAutoDetect=off)
        ao start exits 0 in 374 ms; observed for 36 s; no killed version
delay3: 23:18:30Z reservation UUID/gen1 → working/gen2 → 23:18:31Z working/gen3
        ao start exits 0 in 268 ms; observed for 36 s; no killed version
```

Scratch repository fixtures reuse existing f35b665f objects through a local alternates file and scratch refs/index; no commit was created. Workers 2089312/2100917 were verified by cmdline and scratch AO_STATE_ROOT, then stopped by exact PID before servers 2089329/2100935. All other servers were likewise recorded/stopped by exact PID.

Every gate used env -i, fake HOME/TMPDIR, local pnpm/Vitest, no AO variables, and the private tmux shim. Final gate PATH has only node/pnpm/gh/tmux links plus /usr/bin:/bin, no agent binary. A preliminary filter run preceded the separate gatebin; the quoted filter run repeats under the final clean gate PATH. Test-only preload supplies fake HOME to record-lock children whose explicit env would otherwise omit it; no source changes.

```text
pnpm install --frozen-lockfile: exit 0
pnpm build: exit 0
pnpm typecheck: exit 0
pnpm lint: exit 0; 5 problems (0 errors, 5 warnings), existing sites
filters:
  core:         Test Files 45 passed (45); Tests 1258 passed (1258)
  CLI:          Test Files 20 passed (20); Tests 261 passed (261)
  runtime-tmux: Test Files 1 passed (1); Tests 40 passed (40)
  claude-code:  Test Files 3 passed (3); Tests 212 passed (212)
integration: Test Files 10 passed / 3 skipped (13); Tests 91 passed / 24 skipped (115)
pnpm -r --no-bail test: exit 0
  Test Files: 92 passed / 3 skipped (95)
  Tests: 2731 passed / 29 skipped (2760), 0 failed
```

Full-package test counts: core1258, CLI261, Claude212, tmux40, Gemini62, Codex215, desktop26, Herdr36, SCM140+5skip, tracker42, worktree50, OpenCode298, integration91+24skip. Skipped agent integrations have no agent binary available. No OpenCode/model executable was invoked.

## Scope and what remains correct

The four conventional commits fb4127d3, 053d7d5d, 2d86ebab, f35b665f explain why in their bodies; no issue number, emoji or Co-Authored-By trailer. Range e6e23c38..f35b665f contains only allowed core source, development docs and tests (14 files). No CLI, runtime plugin, agent hook, wrapper/helper source or WRAPPER_VERSION change. `git branch -r --contains f35b665f` prints nothing. No commit/push/PR from this review.

- Record-lock serialization, conditional no-create behavior and launch UUID ownership materially improve ordinary new-writer races. Kernel helper/lock coverage remains meaningful.
- Launch grace, authoritative all-dead two-poll convergence, fresh-worker convergence, no-server five-minute preservation, original stale closed-PR lifecycle protection, and C3 identity controls still pass.
- AMBIGUOUS_NEGATIVE_BOUND_MS now states the exact single-session/two-poll policy; C2 requires two probed sessions, none alive. Unknown/generic failed probes do not force terminal status. No convergence policy change beyond launch scoping was found.
- Tmux prefix matching and hidden-socket-over-five-minutes risks remain unchanged, explicitly owner-deferred. Neither is used to manufacture these new findings.
- Required next changes: protect restore failure cleanup and rollback side effects; prevent generation-only ABA; preserve the premise of automatic cleanup; handle module mode in the worker environment.

## Final verification and cleanup

A separate actual built CLI lifecycle-worker process (not just a fresh manager instance) was also started over two working records whose tmux targets were already absent while an unrecorded keeper held the private server:

```text
23:23:46.839Z worker PID 2139495 starts over kr-1/kr-2 working, generation=1
23:23:48.113Z kr-1 becomes killed/runtime, generation=2
23:23:48.116Z kr-2 becomes killed/runtime, generation=2
```

Its interval was 1 second; both converge at the second poll. The worker was stopped by its exact PID and awaited before stopping its private keeper server. The extra NODE_OPTIONS diagnostic worker with execArgv=[] reports `ReferenceError: require is not defined in ES module scope, you can use import instead`, confirming the helper failure's cause.

Final `ps -o pid,ppid,args -u "$(id -u)"`, filtered outside the shell for scratch paths/private server names/worktree-built CLI, and the inventory of every recorded owned PID:

```text
owned processes: []
recorded owned PIDs still executing: []
protected lifecycle worker 271579 present: true
protected lifecycle worker 321413 present: true
```

All owned workers were stopped before their private servers. Every stop selected a known exact PID; no name-pattern kill, default tmux server, real AO state command, or model executable was used. Private socket files removed by their exact owned names: ao47-kr3-bound, bound2, race, controls, controls2, controls3, integration, full, start-1, start-3, fresh (each with the ao47-kr3- prefix). `/tmp/ao47-kr3` and `/tmp/ao47-kr3-marker` were removed after collecting this evidence.

After `ls -la --time-style=full-iso ~/.ao/bin`, byte-for-byte identical to before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required final inventory (collected before removing the marker):

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
```

Every entry is accounted for: the ao-46 record is the real lifecycle worker **271579** changing that session from working to stuck at `2026-10-20T23:12:45.459Z` (process observability transition correlation `lifecycle-transition-36173178-fe11-452a-b91a-65e725ffa0e0`). Its record mtime is `2026-10-20 19:12:45.457848436 -0400`; the parent sessions directory has the identical mtime from that rename. These are the real worker's writes, not review writes. Real files were inspected only with cat/stat/grep/ls and the explicitly required final find/ps. No unexplained entry remains.

`git diff --exit-code` is empty; only the task/report and review artifacts are untracked. The untracked round-2 review is untouched and byte-identical to commit 1e0733e6, SHA-256 `0ebf714655a74f4f5e8ac201d0518ac698cf2a4d0478e03839b80c928cc32f54`. This review and report remain uncommitted as required.
