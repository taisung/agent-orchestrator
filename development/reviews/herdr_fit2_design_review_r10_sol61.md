# Herdr fit-2 design r10 check — 2026-10-23

NOT-SOUND

Counts: **0 blocking, 2 major, 3 minor findings.** Most r9 corrections are explicit and adequate, but publication recovery can adopt a replacement and still strands a resident claim when its retry commits then throws. The two major paths need revision before implementation.

Baseline: `0d5c6c67`, verified with `git log --oneline -1`. Narrow review under `.agent_note_1.md`;
no code change, commit, network, AO/gh/tmux command, model turn or Herdr measurement.

## Initial isolation evidence

Created `/tmp/aofr10-marker` at the start. Initial
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

Read the other lens's r9 review, the full r9-to-r10 diff and changed sections before the author's
r10 report. The new read/retry rule repairs the original one-shot restore publication failure in
principle. The null-claim write-back, pre-create fields, helper facts and pin-test migrations now
have explicit answers. The audit is checking the after-effect exception on the retry itself and the
fixed identity used when rollback adopts a write that threw. Those are distinct from the first
write's after-effect exception in T-4.20e.

Publication audit checkpoint (before the author report):

- §5.2.3 step 1 builds its supposed after-effect identity from `current`, not the last owned
  snapshot. Since `publication` does not write `restoredAt`, a replacement changing only that
  identity field is accepted as the operation's own after-effect write. The existing identity
  comparison explicitly includes restoredAt (metadata.ts:331–343).
- §4.5 handles a first write that committed and then threw, but a retry that commits and then throws
  goes directly to unwritable. Its settlement still compares only the pending identity, returns null
  against the operation's newly published handle, and the warning calls that another launch.
  T-4.20e covers only the first write's after-effect exception, not this retry variant.
- The premise that `updateMetadataIf` null proves replacement needs qualification: metadata.ts:663
  returns null when `existsSync(dataDir)` is false, including a failed path lookup. It does not always
  mean a successful locked read compared different identity values. The design can normalize this
  outcome without changing its fixed read/retry budget.

After that independent diff/source audit and checkpoint, read the current r10 section of the author's
report. It repeats the read-once/retry-once rule and the eight behavioral/test deviations, but adds
no rule for a retry that commits then throws and no correction to the adoption expression. Older
appended reports were not used as independent evidence. The report/design list **ten** deviations:
the eight substantive changes plus base-reference and doc-0004 updates. All ten are assessed below.

## Findings

### M-1 — Rollback derives the adoption identity from the replacement itself

**Design:** §5.2.3 step 1, lines 813–817; §4.5 lines 507–520; T-4.20f. **Code:**
`ee3534d7:packages/core/src/session-manager.ts:1736`–`:1758` keeps the last owned snapshot and
compares its identity; `packages/core/src/metadata.ts:331`–`:343` includes `restoredAt` among
five identity keys; `:347`–`:351` compares their supplied values. The unchanged main implementation
has the same ownership mechanism at session-manager.ts:1717 onward (fit-1 adds 19 preceding lines).

The new step permits adoption when current holds
`launchIdentity({ ...current, ...publication })`. That does not compare against the intended
identity derived from the operation's last owned snapshot. Any identity key not overwritten by
publication is copied from the record being judged. In particular, spawned/launchedRecordFor
writes no restoredAt. A later restoredAt is therefore silently accepted as the operation's own.

Concrete predicate witness (P and H stand for serialized pending/returned handles; all unchanged
keys omitted here have identical values):

| Value | Last owned | Intended publication | Current replacement |
| --- | --- | --- | --- |
| runtimeHandle | P | H | H |
| createdAt | T0 | T0 | T0 |
| restoredAt | empty | not updated | T1 |
| reservationId | empty after pre-create | cleared | empty |

Current does not hold `launchIdentity({ ...owned, ...publication })`, because T1 differs from
empty. It **does** hold the design's `launchIdentity({ ...current, ...publication })`.
A tiny Python dictionary calculation, with no product import/file/socket/child, printed:

```text
{'r10_adoption_accepts_replacement': True, 'fixed_owned_target_accepts_replacement': False}
```

Once adopted, `keepUnconfirmedLaunch` writes launchFailed into that later record. If the later
operation is in the same resident AO process, PID/start is the same pair (the claim identifies a
process); settlement can also clear its claim after adoption substituted its identity. With a
different pair the clear refuses, but the foreign failure write still occurs. No strong server
identity or completion of R3 is assumed here: this is an algebraic counterexample to the new
ownership predicate, which weakens the existing launch-identity protection on this failure path.

**Required:** compute the intended post-publication identity once from the **last owned record**
and exact updates, before attempting the write. Use that fixed identity in recovery and
`own.adopt(record)`. Never derive missing identity keys from current. Add a T-4.20f replacement
variant matching H/createdAt/tmuxName but changing only restoredAt, with both a different PID/start
and the same resident process pair. Assert byte-equal replacement, no launchFailed write, no claim
clear, and no removal. Today's proposed T-4.20f only tests this operation's own successful write
and leaves this mutant alive; T-4.20e(1) tests restore with a plainly different P reservation.

### M-2 — A retry that commits then throws strands the claim and reports a replacement

**Design:** §4.5 lines 517–539; §5.2.4 steps 9–10; T-4.20a–f. **Code:**
`ee3534d7:packages/core/src/session-manager.ts:4580`–`:4585` changes runtimeHandle/restoredAt and
clears reservationId on restore publication; metadata.ts:656–674 runs the CAS and returns the
written record; atomic-write.ts:7–11 writes/renames. The design explicitly admits exceptions after
effect and T-4.20e injects them after rename, so the same allowed outcome must apply to its retry.

In a resident restore:

1. The first success-publication write throws before effect.
2. The one strict read finds the transition/P identity.
3. The retry writes H and the new restoredAt, then throws after effect.
4. The rule calls this unwritable and tries settlement only against the old pending identity.
5. That CAS returns null against the operation's own new identity. The live own claim remains.
   The selected warning says “The record now names another launch; AO wrote nothing to it.”

The operation ended, its caller still runs, and kill/F-9 see a live launcher. This is the original
resident-claim defect on a newly introduced branch, with a misleading warning. The endpoint handle
is now recorded, but claim ownership still was not settled. T-4.20e(2) covers only a first write
that commits then throws; T-4.20d requires both writes to fail before effect. All named tests can
pass while the sequence above remains defective.

A related outcome assumption also needs fixing: §4.5 calls a null publication a “proved
replacement”. `updateMetadataIf` at metadata.ts:663 returns null when existsSync(dataDir) is false,
which can represent an inaccessible path, not a successful identity comparison. A transient false
there followed by a readable still-owned P takes the not-own path without settlement. The existing
strict-reader comment at fit-1 session-manager.ts:1741–1743 expressly recognizes that absence
lookups can fail. Publication recovery must not attribute that uncertainty to another launch.

**Required:** cover after-effect failure on **every** attempt, including the retry. Preserve the
fixed before/after identities and settle only the operation's own pair against a proven owned
identity; alternatively use a bounded final strict reconciliation, or an owner-conditional writer
that can check those fixed identities under the record lock. If reconciliation is impossible,
warn that this operation's live claim may remain and that the record may already hold H; do not
claim a replacement or a pending handle as a fact. Normalize the metadata helper's uncertain-null
case before treating null as replacement. Add retry-after-effect, partial-retry-after-effect,
uncertain-null/still-own, and replacement controls. This needs no new runtime authority or R3 lease.

### m-1 — T-7.9b's global zero-probe oracle is incompatible with real list enrichment

**Design:** §5.3.5 step 2 and §5.3.10 T-7.9b, line 1301. **Code:** fit-1
session-manager.ts:2959–2972 calls ensureHandleAndEnrich from real list; :1500–1514 treats a parsed
handle as stored; :1532–1550 falls back to the project's runtime when runtimeName is missing and
calls isAlive. runtime-herdr/src/index.ts:633–641 accepts a grammar ID and data without requiring
runtimeName. These paths are unchanged on main except for fit-1's line offset.

For the stated parseable handle lacking runtimeName, real `sm.list` can call the selected Herdr
runtime **before the CLI split runs**. The shared predicate prevents an additional
checkOrchestratorLiveness probe; it cannot undo that enrichment call. §4.6's list change only
prevents fallback when the stored name is a missing set runtime; it does not skip a nameless handle.
Thus “zero runtime calls with that handle” fails with the requested real core and correct routing.
Conversely, stubbing list so there is no enrichment silently drops the claimed composition.

**Required:** scope the zero-call assertion to the CLI routing/admission phase, count the existing
list call explicitly, and make D2 expose the *additional* CLI probe; or specify/test a deliberate
list shape-validation change. Do not add an unrelated product policy merely to satisfy a misplaced
zero-count assertion. The predicate correction itself is sound for the cited missing-runtimeName case.

### m-2 — The real-core interim migration gives killed records the wrong blocking kind

**Design:** §5.3.10 lines 1260–1262 (the original real-core interim describe), versus T-7.1 and
§4.7 R6. **Code:** `ee3534d7:packages/cli/__tests__/commands/start-herdr-interim.test.ts:319`–`:323`
parameterizes both persisted working and persisted killed records; :336–:347 contains their old
refusal/status assertions. Core's persisted status is independent of list's enriched result.

R10 says this whole describe now expects kind unproven. Its four persisted-killed variants fail
R6 first and must be not-reused (“its status is killed”), just as T-7.1 and the immediately following
note-2 migration require. The four persisted-working variants can be unproven. A literal migration
of the named oracle is not green, or it encourages changing the correct classifier priority.

**Required:** split the row by persisted status: working + negative/no-server => unproven; killed
=> not-reused. Keep M/no-prefix/no-write assertions for both. This is a test-plan correction, not a
request to change G or reopen note 2.

### m-3 — OQ-F13 reintroduces the obsolete “agent false on error” premise

**Design:** §11 OQ-F13, line 1689. **Code:** on `ee3534d7`, agent-codex/src/index.ts:581–582,
agent-gemini/src/index.ts:194–195, agent-opencode/src/index.ts:1341–1342 return the core Herdr
process check directly; core herdr.ts:399–410 rejects failures, and :520–525 awaits that reader.
Main has the same rejection contract predating fit-1; fit-1 adds pins/F1 handling.

The new recommendation says codex, gemini and opencode answer false for an error. For a valid
Herdr pane these paths reject when the check cannot answer. Their preserved empty-ID/fallback
results are separate cases; they do not make a valid-pane query error false. The lifecycle's
:662 gate requires a runtime positive before an agent negative counts; it is not proof that
these three plugins still collapse Herdr errors into false.

**Required:** correct that sentence. OQ-F13(a) can be justified by the narrow no-new-launch goal
and G deliberately reading no activity, with an explicit tradeoff that successful startup can
mean reusing a pane whose agent exited. It does not need an incorrect current-code claim. Keep
owner approval of this changed note-2 outcome explicit.

## Disposition of all nine r9 findings

Closed means adequate at design level, subject to implementation and the named owner decisions.

| R9 finding | State in r10 | Independent assessment |
| --- | --- | --- |
| sol M-1, publication errors strand a resident claim | Partly closed | §4.5 distinguishes throws, retries pending publication once, adopts a first after-effect write, conditionally settles on unwritable and names resources/PID. T-4.20a–f covers the main cases. New M-1/M-2 leave replacement adoption and retry-after-effect reconciliation unsound. |
| sol m-1, null-ownClaim rollback clears foreign values | Closed | §4.5 publishedClaim and §5.2.4 step 8 compare the exact published pair and conditionally spread CLEARED only when ownClaim is non-null. T-4.19a/b preserve old dead values; c/d preserve a later pair and prevent write-back. Metadata's actual partial-key compare supports this without an API change. |
| sol m-2, admission D2 overclaim | Closed | §8 separates subject-invariance D2-a from coherent r8 reversion D2-b, removes dependent equality checks in the mutant, and forces both empty-G observations before any reservation. Normal T-7.21c asserts process 2 cannot acquire A before process 1 publishes. The 500 ms absence check is a bounded scheduling observation; the mutated duplicate proof now requires the stronger positive barrier. |
| sol m-3, missing pin-test migrations/helper facts | Closed | §5.2.7 names pinnedHandle/T-6.1/failure-close changes and the two strict core resolver toEqual oracles. Checked these directly at ee3534d7. statusRunning already reads compatible:true; only the synthetic index mock needs that addition. Commit 3 owns them. |
| sol m-4, sparse crashed P recovery | Closed for the stated pre-create crash | §5.2.2 persists normal fields before create and keeps P/claim. §5.2.5 now separately describes a crash before this write, no recorded endpoint/script and manual search. T-4.15 asserts the fields for both shapes. No partial handle is claimed before create returns. |
| Muse m-1, T-7.3 pin answer omitted | Closed | T-7.3 now fixes pane_not_found and unproven; T-7.3d separately states alive pane/no agent with project reuse versus isolated block. OQ-F13 explicitly exposes the changed fit-1 outcome. The recommendation's obsolete code rationale is new m-3. |
| Muse m-2, missing-runtimeName CLI route | Partly closed | The shared predicate and ordered split close the routing ambiguity on paper, with wrong-shape recognition independent of list's parsed handle. T-7.9b's global zero-probe oracle still conflicts with real list enrichment (new m-1). |
| Muse m-3, restore scope/old damaged handle | Closed for the requested cases | §5.2.4 explicitly restricts 6a/7b to orchestrators; workers do copy-back/transition without A, under per-write record CAS. Step 7 now refuses a selected unparseable old handle instead of blindly overwriting it; T-7.26d tests worker/orchestrator and runtime-change cases, with non-Herdr control. This small behavior change supports the own-ID exclusion premise. |
| Muse m-4, identity refresh and rollback threading | Partly closed overall; threading closed | own.identity() and explicit restore identities remove stale-settlement ambiguity; both rollback arguments have ownClaim/partialRecord. T-4.2–6 and T-4.17 assert actual handle plus absent keys. The new adoption mechanism has M-1's incorrect expected identity; explicit signatures alone do not close that failure path. |

The tests' implementations still must prove their own fixes: none exists yet. Closing most design
rows does not establish a green implementation or a live-runtime guarantee.

## Publication rule and T-4.20 audit

The basic control flow is useful: a thrown write is uncertain, one strict read can recognize its
fixed intended post-state or still-owned pre-state, and the retry is bounded. A proved replacement
must receive no write/clear/removal; a genuine inability to persist must keep the runtime/worktree/
agent/prompt and warn about the resident claim. The operation should preserve both fixed identities
through every branch; recovery must not make ownership a function of the current record's values.

| Case | What it distinguishes before the publication fix | Remaining qualification |
| --- | --- | --- |
| T-4.20a, success write fails once | Bare restore publication throws; the retry rule instead resolves with H and clears the claim. | Reach the publication injection after the transition succeeded; do not accidentally fail pre-create/transition. |
| T-4.20b, partial write fails once | Previously the partial write error left P and skipped settlement. New result must contain the partial handle, failure text and no claim while rejecting the original partial error. | Good principal case; add partial retry-after-effect for M-2. |
| T-4.20c, every later write fails | Exact warning, P/live pair, retained resources and in-progress behavior distinguish the unwritable path from a bare exception. | The runtime remains kept. Do not infer that any null result proves replacement. |
| T-4.20d, two failures then settlement can write | Without unwritable settlement the resident pair remains; expect P without pair and create-incomplete. | Both publications here fail before effect; this does not cover M-2. |
| T-4.20e(1), replacement before recovery read | Byte-equal foreign reservation, no retry/clear/removal is a compatibility control; some old replacement handling already keeps it. | It is intentionally not independently red for every old code path. It does not test the weaker adoption predicate against a changed restoredAt. |
| T-4.20e(2), first write commits then throws | Without reconciliation a successful rename still makes restore throw; the rule reads/adopts its own written identity and resolves. | Must assert zero retry, successful settlement; also exercise the retry after-effect separately. |
| T-4.20f, spawn/start handle publication | Returned handle persistence, launchFailed and no claim expose the earlier rollback's incomplete record and stale owned snapshot. | The one-shot before-effect and genuine own after-effect cases are covered; M-1's foreign matching-handle record and M-2's rollback retry case remain absent. |

No listed test requires a real agent or Herdr process. The table above describes source-composed
failure reasons; it is not a claim that pre-fit-2 tests were compiled or run. Test spies must preserve
metadata helper return/throw semantics, including writes that changed disk before throwing.

## Pre-create write, generation, reservation and recovery

The new write is directly before runtime.create, inside its pre-runtime failure catch, only for
an unprepared agent and create runtime in the unproven set. Prepared launch metadata already gets
that write at fit-1 session-manager.ts:2259–2275 and :2818–2832. Matching its known fields is sensible:
worker worktree/branch/spawning/tmuxName/issue/project/agent/model/permissions/createdAt, or the
orchestrator's working/role/project/agent equivalents. The renamed preCreateAt stabilizes createdAt
between pre-create, success and rollback publication; rebuilding a different timestamp on each
attempt would invalidate the recovery target.

Metadata.ts:602–613 gives each write a new generation; :358–360 permits only reservationId removal;
:568–585 merges P/claim unchanged while removing reservationId on empty input. own.write advances
its owned snapshot only on a returned write. Thus normal publication changes launch identity before
create, but keeps the already-published P and own PID/start. T-4.15 now checks no reservation key,
normal fields, P and the live pair; both generation behavior and updated identity must follow the
existing writer, not be manually synthesized. A pre-create failure still has no runtime to stop.

A crash after this write leaves a dead-process claim and P with the actual worktree. G selects it
as create-incomplete; F9 can accept its grammar-empty handle after live-launch exclusion and remove
a managed worktree by the recorded path. The runtime's stop stays unknown and its empty-ID isAlive
rejects without I/O. The owner must first inspect possible unrecorded endpoint/workspace/pane/script
state; F9 itself cannot discover them. A crash earlier in workspace/agent preparation remains the
sparse-reservation/manual-recovery case explicitly named by §5.2.5, not a successfully published
partial. The fallback managed path is an example of the retained worktree plugin's layout; custom
workspace roots/plugins require finding the actual path by hand.

Relaunch's reservation refusal no longer applies after this early key removal. That does not
admit a Herdr relaunch: a live pair still refuses, launch grace now has createdAt, and relaunch
explicitly refuses a Herdr handle including P. This write does not implement a per-ID lease or solve
relaunch M-6. Failed pre-create/transition writes that may have taken effect also deserve explicit
failure-injection coverage when implementing the general end-path discipline; do not assume a
thrown identity-changing write automatically advanced own.

## Changed bases and note-2 oracle migration

Checked the note-2 source/test range `9d51982b..ee3534d7` and note 3 at `60da85ee` as local Git
objects, without checkout. Note 2 changes only CLI start among product files; its reader tests add
coverage without altering the parser. Note 3 changes docs and comments only. The conditional
refusal and merged-status repair are real behaviors, not a proposed extra fit-2 policy.

| Base case, with no other reusable record | R10 G/CLI result | Allocation |
| --- | --- | --- |
| Persisted killed + alive pane, project or isolated | Terminal CLI snapshot is excluded; G fails R6, not-reused. | Commit 6 replaces the note-2 still-runs message/spinner with M; no create. |
| Working raw record + exited agent + alive pane, project reuse/ignore | CLI excludes the enriched terminal candidate; core G uses raw working and alive evidence, then reuses. | T-7.3d and real-core note-2 project/working case change to exit 0 only under OQ-F13(a). |
| Same, isolated | G fails R8, not-reused, no create. | Commit 6 changes message/spinner; original refusal result remains. |
| Same, project delete/aliases | R8 strategy fails; unknown Herdr stop is never permission to replace it. | M/not-reused, no create. |
| Working raw record + pane_not_found/another terminal/no-server | G cannot prove reuse, unproven. | T-7.3 and old negative controls; commit 5 core/commit 6 CLI message migration. |
| A different reusable record next to the held one | Reuse-only accepts that record and CLI reuses it; no new launch. | Existing note-2 coexistence control stays successful with core-decision mock; held record is not reused. |
| Done/errored terminal raw record | G selects regardless of status and blocks not-reused. | The old skip is replaced by core protection. |
| Stored merged orchestrator | list repairs status to working before CLI selection; direct core G reads raw merged and blocks. | No false claim that merged is always an unprobed terminal; preserve note 3's correction. |
| Direct isolated core | A/G precede allocation. | Commit 5 closes the old CLI-only limitation. |
| Legacy handleless record | L-2/OQ-F10 remain; new fit-2 launches use P. | Required upgrade audit/manual retirement, not retroactive proof of death. |

Commit 6 correctly removes heldStateOf/runningHeldRefusal/runningHeldOrchestrators and the
interim Herdr classifier branches with their comments. The mocked start tests need separate
mocked reuse and spawn results, as the design states; they test presentation, not G semantics.
The real-core :378 describe's four held-alive cases have the right r10 outcomes (conditional on
F13). The original :314 describe needs m-2's killed/working distinction. Commit 5 can leave the
note-2 CLI refusals intact because they occur before core; commit 6 then changes those oracles.
The two F1 boundary reader tests stay unchanged. New tests should not weaken their exact forms.

Commit 8's docs plan fits note 3: replace interim guard/refusal/three-limit/recovery paragraphs,
retain a damaged-record manual path, create sessions/archive before moving into it, and preserve
the conditional “when no other record can be reused” explanation wherever reuse-only still
chooses another safe record. Remove corresponding CLI comments in commit 6. The by-hand procedure
still bypasses the lock/floor and is correctly exceptional.

Relaunch round 5 changes no core session-manager/types/index content relative to `7a20242f` (the
local diff for those paths is empty). Its hook writes per-launch unusable marks and its lookup
reads the mark matching the current random launch token. The dot-directory is excluded by
listRecordIds, so G does not mistake its entries for session records; kill/F9 leave it on disk.
The restoredAt transition invalidates relaunch's old token binding as today's restore does.
The Herdr hook/transport and relaunch remain outside that tmux-only path; no agent product edit
is required for fit-2.

Section 6 covers each landing order coherently: relaunch then fit-1 then fit-2 adapts at G0;
fit-1 then relaunch then fit-2 has the same adaptation after those four conflicts are resolved;
fit-1/fit-2 before relaunch makes relaunch adapt its launchedRecord hunks and settlement helper.
Keep launchToken/launchTokenAt in launchedRecordFor, merge optional Runtime/SessionManager API
additions and CLI session/send hunks, and retain relaunch's delayed settlement retries while
fit-2's unwritable branch has its bounded attempt. Both complete test sets, including round-5
conversation tests and new fit-2 publication tests, must stay green. M-1's target identity must
remain fixed when that common helper is extracted. Neither fit-2 claims nor this merge closes
same-ID R3 or relaunch M-6 (restore claims after stop; kill/F9 take no operation claim).

## R10 deviations, implementation plan and tests

The author's eight substantive deviations are within the narrow round. Their answers are needed,
but the publication mechanism remains incomplete; the final two report entries update the bases/docs.

| Deviation | Need, named location and test |
| --- | --- |
| 1. Publication recovery; spawn/start failed handle write retained | Needed by sol M-1, §4.5/§5.2.2–4, T-4.20a–f. Read/retry/keep is named; M-1/M-2 prevent full closure. No destruction is authorized by a throw. |
| 2. Claimless write-back preserves claim state | Needed by sol m-1, §4.5/§5.2.4, T-4.19a–d plus T-4.18. Exact compare and conditional clear are adequate. |
| 3. New pre-create field write/preCreateAt | Chosen answer to sol m-4, §4.4/§5.2.2/§5.2.5, stronger T-4.15. Known recovery data is persisted while P/claim survive; earlier sparse crashes remain named. |
| 4. Damaged old-handle restore refusal | Small necessary policy consequence of Muse m-3 and excluding the restored ID from G, §5.2.4 step 7; T-7.26d covers both project-runtime choices and worker/orchestrator, plus non-Herdr control. |
| 5. Exported shared CLI/G1 predicate | Needed by Muse m-2, §4.2/§5.3.3/5; unit rows and T-7.9b. Fix the latter's phase/count oracle (m-1). |
| 6. Note-2 exited-agent project reuse | Named accurately as a behavior change and new OQ-F13; T-7.3d and real-core :378 project/working case specify it. This still needs the owner's policy decision; m-3 corrects its rationale. |
| 7. Endpoint compatible/version/protocol fields | Compatible was already needed by Q0; version/protocol make the named error text implementable. §5.2.1 states validation/defaults and §5.2.7 names core toEqual migrations. Pin tests and synthetic status mock are allocated to commit 3. |
| 8. D2-a/D2-b and before-reservation barrier | Needed by sol m-2; §4.2 hook info, T-7.21c and §8 separate the two proofs. Tests are bounded and the mutated unsafe schedule now requires positive empty-G observations. |
| 9. fit-1/relaunch base refresh | Necessary changed facts, R.3/§6/G0. Reader tests preserved, note-2 oracles allocated to commit 6, note-3 docs to commit 8. Correct original-describe kinds as m-2 requires. |
| 10. Doc-0004 pointers | Local commit 0d5c6c67 changes the stated tip/reference only; no new fixture/measurement was introduced. |

The product count remains **17**: core runtime-errors/types/index/herdr/metadata/delivery-lock/
session-manager/runtime-stop/lifecycle-manager; runtime-herdr index; CLI send/start/spawn/session/
status/preflight/doctor. Types carries the shared predicate; index re-exports it. The new mechanisms
fit those already-named paths. Lifecycle-manager and doctor stay comment-only. CLAUDE/DEVELOPMENT
are additional docs, and test files are counted separately. No new agent-plugin product path is
required by this narrow round.

The order of eight commits remains sensible: public types/exports before use; F3; F4/P/claims/
publication/pre-create; dispatch/damaged old-handle refusal; A/G/reuse; CLI/preflight/interim removal;
F9/status; final contracts/docs. Fit-pins and core resolver exact-object oracles now move with
commit 3. The interim core and CLI migrations are separated between commits 5 and 6, and the two
note-2 F1 reader tests are explicitly preserved. No dependency-order defect was found. The plan is
not demonstrably green until m-1/m-2's test expectations and the major recovery rules are corrected
and implemented. No build/test was run in this design review.

The approximately **1,900 product / 3,900 test lines, L** estimate is credible; the component figures
are approximate and sum to about 1,910 product lines. The new rule and its failure matrix make
commit 3 larger and riskier than before. Splitting 1–4 and 5–8 remains reasonable, with each round's
own green gates/review. Fit-2a must ship accurate interim recovery docs even though final F9/status/G
are in 2b. Those interim docs must not advertise the final admission guarantee early. G0 must check
the actual landed names/behaviors, compare the complete red-set names, and include both relaunch test
sets after any integration; stated line numbers are evidence pointers, not merge instructions.

## Independent new code-fact checks

F1 references below are local `git show ee3534d7:<file> | nl -ba`; main references are the current
worktree. Main product remains pre-fit-1, not an implementation of r10.

| # | New/refined claim checked | Evidence/result |
| --- | --- | --- |
| 1 | own.write advances only on a returned write, and null becomes an error | F1 session-manager.ts:1753–1758 calls updateMetadataIf, throws on null, then assigns owned. Supports the new need for explicit adoption, with a fixed expected target. |
| 2 | Unknown lookup is distinct from gone | F1 session-manager.ts:190–193 invokes assertNoRecordFile after a null raw read, and :1741–1743 names existsSync's uncertainty. R10's blanket null-publication claim does not inherit this strict proof (M-2). |
| 3 | The pre-create prepared field template exists | F1 session-manager.ts:2259–2275 writes worker normal fields/prepared metadata and removes reservationId; :2818–2832 is the orchestrator equivalent. R10's unprepared template matches those known fields. |
| 4 | New write uses existing generation/reservation semantics | Main metadata.ts:358–360 strips caller generation and allows reservation removal only; :602–613 increments generation and commits; :573–585 merges/removes empty fields. Correct basis for preserving P/claim while clearing reservation. |
| 5 | New endpoint fields require two exact-object test changes | F1 core herdr.test.ts:662–666 and :691–695 use toEqual on bin/socket/running only. R10 now names both rather than merely changing mock input. |
| 6 | Pin tests need both fourth reply and no-close migration | F1 runtime-herdr fit-pins.test.ts:91–98 and :102–122 queue/assert three calls; :125–136 expects workspace close. R10's migration now matches all three actual sites. |
| 7 | Note-2 refusal is conditional on no reusable candidate | F1 start.ts:1109–1115 filters terminal candidates from existing; :1123–1149 builds the held refusal only when existing is empty. R.3 and note 3's qualification are correct. |
| 8 | Note-2 live held fixtures are four real-core cases | F1 CLI start-herdr-interim.test.ts:378–390 crosses project/isolated with killed/working+exited, :400–418 asserts refusal/no creates/equal record. R10 names the four changed outcomes, conditional on F13. |
| 9 | Original real-core negative fixture also contains killed records | Same test :319–323 has working and killed rows. This contradicts the migration's single unproven kind (m-2). |
| 10 | Merged orchestrator repair is real | F1 session-manager.ts:507–510 includes merged in stale PR ownership statuses and :839–840 sets working on repair. Note 3 correctly removes merged from the always-unprobed terminal examples. |
| 11 | Note 3 changes no behavior | `git show --format= --name-only 60da85ee` lists only docs/DEVELOPMENT.md and CLI start.ts; the latter's diff is comments only. Its archive-directory/conditional-refusal/merged corrections fit commit 8/6 as stated. |
| 12 | Relaunch round 5 leaves core protocol unchanged | `git diff --exit-code 7a20242f 9f20ce29 -- packages/core/src/session-manager.ts packages/core/src/types.ts packages/core/src/index.ts` is empty. Section 6 correctly retains its existing claim/key integration. |
| 13 | Per-launch hook marks and lookup match | 9f20ce29 agent-claude-code/src/index.ts:389 uses .<session>.<launch token>.unusable; :1463–1481 reads the matching current-token mark. F1 session-manager.ts:203–206 excludes dot names, so the directory is not a G session. |
| 14 | The new global no-probe oracle crosses a real earlier probe | F1 session-manager.ts:2968 calls enrichment; :1500 treats a parseable nameless handle as stored; :1532–1550 selects fallback runtime and probes. Supports m-1's phase distinction. |
| 15 | The new F13 error-collapse explanation is false for valid Herdr handles | F1 Codex :581–582, Gemini :194–195, OpenCode :1341–1342 delegate directly to core; core herdr.ts:399–410 rejects failures and :524 awaits the reader. Empty-ID/PID fallbacks are different branches (m-3). |

The only executed calculation was the small Python dictionary witness above. It did not import
product code, touch files, open sockets or start children. It is evidence about the specified
predicate, not a measurement of a product interleaving or Herdr behavior. The author's r10
measurement-none statement is consistent with the local diff; no new live claim needs a fixture.

## Open questions and retained limits

| Question | View |
| --- | --- |
| OQ-F10, remaining unchecked candidates | Accept (a) as the narrow no-new-launch policy, with mandatory L-2 upgrade audit/manual retirement. The shared predicate correctly routes selected damaged records to core instead; the unchecked remainder may still print reuse without a usable agent. Correct the probe test without changing unrelated non-set compatibility. |
| OQ-F11, landing order | Agree with (b), build on fit-1 now and make the second landing adapt. Section 6's three orders preserve the required key/settlement integration; no extra dependency on relaunch round 5 was found. |
| OQ-F12, split and size | Agree with (b), separate the two risky commits' reviews and ship fit-2a interim recovery notes. Approximately 1,900/3,900 lines still makes the overall scope L; calling both subrounds M is an estimate, not evidence they can skip gates. |
| OQ-F13, alive pane/exited agent in project mode | (a) is coherent with the narrow no-new-launch guarantee, but successful ao start then means reusing a live pane rather than proving a running agent. I accept that tradeoff if the owner chooses it; retain explicit attach/recovery guidance and the changed note-2 oracle. Correct the obsolete false-on-error rationale (m-3). The already stated note-2 refusal remains the baseline until the owner decides. |

OQ-F4–F9 recommendations are unchanged from my r9 review: block runtime mismatch; allow the documented
partial-send policy with the separate-call race; refuse unsupported admission locks; qualify Q1/Q2 only
if the owner accepts R-Q (otherwise Q0 only); require F9's identity token; use the canonical subject
with R-A. None was silently converted from recommendation to approval in this check. The narrow r10
owner instruction authorizes this design check, not an inferred decision for F13.

R10 correctly keeps Herdr stop unknown, RH-A/B design-only, hidden-server attestation risk, R-A/R-Q,
L-1–L-5, same-ID R3 and relaunch M-6 explicit. No proposed recovery write may use the review's new
adoption shortcut to erase those identity boundaries. Resource retention and owner diagnostics can be
fixed without adding RH or expanding the task into a general per-ID lease.

## Cleanup and verification

Final `ls -la --time-style=full-iso ~/.ao/bin` is identical to the initial complete listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

No check command wrote that directory. This verifies listing/size/permissions/nanosecond mtimes;
no unperformed content-hash comparison is claimed.

Ran the required scan exactly:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr10-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2234
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2241
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-80
```

The fleet was active during the check. No check command wrote real AO state or called AO. The
scan cannot identify the writer of these paths; their contents, other worktrees/reviews and panes
were not inspected to infer attribution. No protected process/session was signaled or changed.

The foreground Python algebra calculation completed with exit 0 and started no children. Every
reading shell completed; no background/server/runtime/model process was launched. Thus no
review-owned persistent process remains to clean up. No node/pnpm/build/product test was run.
`/tmp/aofr10` was not created, and the existence check printed `NO_REVIEW_SCRATCH_DIRECTORY`.
The marker is removed after the required scan; report assembly temp files are removed/moved.

`git diff --exit-code` passes with no tracked changes, including the now-tracked r9 review.
HEAD stays `0d5c6c67`. Status lists only the new r10 review plus the externally supplied
`.agent_task.md`/`.agent_note_1.md` and the required `.agent_report.md` exception. No other worktree
file was modified, and no branch/ref mutation, commit, push, PR, network, AO/gh/tmux command,
inter-session message, real agent or Herdr measurement was performed. The final report's first
line carries this verdict and counts; the review remains uncommitted as required.
