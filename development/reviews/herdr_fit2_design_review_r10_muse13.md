# Herdr fit-2 design r10 check — 2026-10-23 (Muse Spark 1.3)

SOUND-WITH-CHANGES

The narrow round answers all 9 r9 findings (sol M-1, m-1–m-4; Muse m-1–m-4) at design level
against the moved bases (fit-1 `ee3534d7` + note 3, relaunch `9f20ce29`). No blocking or
major findings. Two new minors below (m-1, m-2), both precision fixes, neither a soundness
gap. Counts: **0 blocking, 0 major, 2 minor**. Finding IDs are local to this check.

Baseline: worktree HEAD `0d5c6c67` (verified `git log --oneline -1`; the brief's required
commit). Fit-1 read as code with `git show` on `ee3534d7` (branch
`feat/fit1-impl-read-agent-task-md-in-your-worktree-once-it-exists`, never checked out);
relaunch read with `git diff 3e366a01 9f20ce29` and `git show`; read-only `git merge-tree`
used for the conflict-path claim. This is an independent source/design audit, not an
implementation and not a live Herdr measurement. Per the brief, the author's r10 report was
read only after my own r9→r10 diff reading and code verification.

## Initial isolation evidence

`touch /tmp/aofr10m-marker` done at start. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Review process

Read in this order: the other lens's r9 review (sol, NOT-SOUND) in full; the r9→r10 diff
in full (735 changed lines); every code fact the diff's new claims rest on, at `ee3534d7`
(`git show`: `ownLaunchRecord`, prepared writes, handle writes, post-create catches,
`updateMetadataIf`/`holdsExpected`/lock throws, `listRecordIds`, note-2 `start.ts` parts,
interim test files, fixtures, JSON fixtures); the fit-1 note-2 commits and landing check
r2; note 3 (`60da85ee`) in full; relaunch round 5 (`7a20242f..9f20ce29`) and its landing
check r5; the doc-0004 diff in `0d5c6c67`. Only then the author's r10 report
(current-round section; the appended r9 section was already read for the r9 review). No
`ao`, `gh` network, tmux, herdr, agent, model-turn, build or test command ran; all checks
are `git`/`grep`/`sed`/`ls` reads (no node/pnpm executed, so no scratch env was needed).

## The 9 r9 findings: state in r10

| # | Finding | State | Own evidence |
| --- | --- | --- | --- |
| sol M-1 | thrown restore publication strands the live claim; partial-throw treated as replacement | **Closed** | Publication rule (4.5) partitions null (proved replacement, today's not-own path) vs throw (read once: took-effect → go on; pending → retry once; other/none → not own; read-throw/two-throws → unwritable with keep-everything + one owner-conditional settlement + three-variant warning). Premises verified at `ee3534d7`: `own.write` throws `recordChangedError` on null and throws `updateMetadataIf` errors as-is, `owned` advances only after a write (`session-manager.ts:1746-1756`); `holdsExpected` reads absent keys as `""` (`metadata.ts:347-351`); lock busy/failed throw (`metadata.ts:264-279`, cited :268/:277). Adoption covers took-effect-then-threw; T-4.20a–f pin each path incl. replacement controls and spawn/start handle-write throws. Step-1/step-2/step-9/step-10 adoptions are consistent (see §2). Residual: warning-text precision, new m-2 |
| sol m-1 | claimless rollback clears foreign claim values | **Closed** | `publishedClaim = ownClaim ?? readClaim` (values as read before 7a); compare on identity + `publishedClaim`; claim keys cleared only with non-null `ownClaim`, else untouched. `holdsExpected` "" semantics make the readClaim compare exact. T-4.19a–d (null-claim workspace/plain failures, later-claim-change no-write-back + warning); T-4.18 kept. No R3 assumed |
| sol m-2 | D2 overclaims; equality check makes the r8 mutant refuse | **Closed** | D2-a (unit: r8 rule fails the subject-invariance test; proves the name only) separated from D2-b (coherent r8 reversion + `before-reservation` barrier with `info.selected`: both processes report selected 0 with no reservation, then two launches; r10 code admits exactly one). `info.selected` ("0 before G1 runs", 4.2) supports the barrier. T-7.21c schedule (pause at `before-reservation` under A, 10 s waiter, no-`lock-held` check, in-progress-or-busy oracle) is coherent |
| sol m-3 | `fit-pins.test.ts` oracles omitted; helper row wrong | **Closed** | Verified at `ee3534d7`: `pinnedHandle()` (`:91-100`) and T-6.1 (`:102-123`) queue 3 replies (no post-run `pane get`); close test (`:125-137`) expects `workspace close w7`; `statusRunning()` reads `closedpane_status_server_json.json` (has `"compatible":true`, `"version":"0.9.5"`, `"protocol":22`); core/CLI `herdr-fixtures` copies have no `statusRunning`/`STATUS_SOCKET`/`standIn` (0 hits vs 4 in runtime-herdr's); `PANE` (`:60-67`, w7:p1/term_abc); T-6.5 (`:212-249`) checks resolver-before-new-fields and running-before-compatible; `STATUS_RUNNING` in `index.test.ts` (`:50-58`) lacks `compatible`; `herdr.test.ts` toEquals at `:662` (running true) and `:691` (running false vs `noserver_never_status_server_json.json` with `compatible:null, version:null, protocol:null`). r10 names all of them in 5.2.7/§7/commit 3 |
| sol m-4 | crashed unprepared P lacks recovery fields | **Closed (persistence chosen)** | Pre-create write directly before `runtime.create`, inside the plain-error `try`, with the exact field sets of today's prepared writes (verified: worker `worktree/branch/status:spawning/tmuxName/issue/project/agent/model/permissions/createdAt` at `:2259-2275`; orchestrator `worktree/branch/status:working/role/tmuxName/project/agent/createdAt` at `:2818-2832`), minus prepared metadata; merge preserves P; `createdAt` reuses `preparedCreatedAt` (renamed `preCreateAt`; variable verified at `:2232`/`:2800`). Crash taxonomy honest (pre-write crash → reservation-only + managed-path fallback; never a partial handle). F-9 removes the named managed worktree; endpoint/workspace/pane/script unfindable, with 5.4.3 hand-search. T-4.15 both shapes + D2 |
| Muse m-1 | T-7.3 omits its probe answer | **Closed** | T-7.3 pins `pane_not_found` → `unproven`; T-7.3d covers live-pane/exited-agent (project-mode reuse since G reads no activity, isolated `not-reused`), gated by OQ-F13. Consistent with the authority model (agent `false`-on-error not authoritative on Herdr; `lifecycle-manager.ts:662` runtime-positive gate) |
| Muse m-2 | parseable handle without `runtimeName` unrouted | **Closed** | One exported predicate `isUnprovenLaunchRecord(raw, selectedRuntime)` (4.2) implements G1 handle rows (well-formed → set-membership; else herdr-text-match or selected-in-set) and drives the CLI split (a)→(c) in order. No runtime import cycle: `safeJsonParse` lives in `utils/validation.ts` (runtime import into `types.ts` is safe; its back-import is type-only), `isLaunchEndUnproven` is same-module. T-7.9b + D2 (parsed-name-only split probes through the project runtime) |
| Muse m-3 | 5.2.4 steps 6a–7b unscoping; damaged-handle skip | **Closed** | 6a orchestrator-only; worker 6b/7a without A (record lock + identity/claim compare as only atomicity, L-3); damaged-text step-7 rule keyed by the same predicate (refuse like unconfirmed stop, since G's restore-exclusion premise needs stop-or-refuse; else today's skip; no-handle skip kept under L-2). T-7.26d + D2 (today's skip → second launch) |
| Muse m-4(ii) | settle identity + `ownClaim` field implied | **Closed** | `settleOwnClaim(identity, ownClaim)` with per-call identity table (`own.identity()` after last own write incl. step-2 adoption; `launchIdentity(owned)` after step-9/10 rule-reads; transition identity for unwritable); `partialRecord?` + `ownClaim?` on both rollback arguments; post-create catches (`:2925` orch, `:2368-2379` worker — both verified present) pass `ownClaim` (+`partialRecord` while `handlePublished` false). T-4.17 asserts no claim keys + returned handle; T-4.2–4.6 assert no claim keys + partial handle |

Sol's "T-4.16 needs an orchestrator record" applied (isolated `-orchestrator-1`, so G selects it;
the old worker-record form would never reach the asserted `spawnOrchestrator` block). The
post-hooks strict re-read ("must still hold the deciding-round identity token and pass
R1–R6, else the round counts as a change") applied in 5.3.2. fit-2a interim notes and the
L-2 pin consequence ("pins the project ... until the owner retires it") applied in
OQ-F12/OQ-F10 and 5.3.9. Muse m-4(i) shares the sol M-1 row, as R.1 states.

## §2. The publication rule (sol M-1): read-once, retry-once, keep-with-warning

Checked the rule against the four questions in the brief:

- **Read-once:** after a throw, exactly one strict read decides took-effect (identity of
  `{...owned, ...updates}`) / pending (retry once) / other-or-none (not own) / read-throw
  (unwritable). No second read, no unbounded retry.
- **Retry-once:** one retry on the pending identity; its throw (or a throwing read) ends in
  the unwritable path — no loop.
- **A write that took effect and then threw:** step-1 adoption (`own.adopt`, accepted only
  for the publication identity) skips step 2; step-9/10 rule-reads advance `owned` and go
  on; spawn/start handle-write-took-effect uses the same adoption via `partialRecord` +
  `handlePublished` flag. Each call site names which `owned` the settlement uses.
- **No path clears a replacement's claim or removes a non-owned resource:** `null`/not-own
  → today's path, no settlement, no claim write; unwritable → remove nothing (no stop,
  discard, workspace removal, release, copy-back removal), one conditional settlement on the
  pending identity (clears only this operation's own claim on this identity); warnings carry
  PID/start + pane/workspace/socket/worktree/agent session.
- **T-4.20a–f can fail before fit-2 for the stated reason:** T-4.20a/b (thrown publication
  never retried/settled today — step 12 never reached, resident claim stranded); T-4.20c/d
  (no unwritable path or warning today; T-4.16b injects only the later settlement write);
  T-4.20e (no read-back distinction: today's bare write propagates, replacement controls
  absent); T-4.20f (handle-write throw → today's plain-error rollback deletes instead of
  publishing). Each is red on `ee3534d7` for the named absence; T-4.20e(2)'s take-effect
  mechanics need the spy-after-rename the design states.

## §3. The pre-create write (sol m-4)

Writes, directly before `plugins.runtime.create` and inside the plain-error `try`:
unprepared-agent, set-runtime launches only; the prepared write's fields minus prepared
metadata (lists verified above); merge preserves P and the claim; `[RESERVATION_KEY]:""`
matches today's prepared shape; `createdAt` shares the renamed `preCreateAt` variable so
`launchedRecordFor` writes the same value. A null/throw fails before `create` (ordinary
rollback; nothing exists in the runtime yet — correct, since no request was sent).
Effect on generation/reservation: none beyond today's prepared write (same merge, same
reservation-key clearing); relaunch claim: untouched (relaunch refuses Herdr; its keys ride
`launchedRecordFor`). Crash between pre-create and create leaves P + claim + launch fields
+ dead claim: G blocks `create-incomplete`, F-9 removes the named managed worktree and
keeps the agent session, and 5.4.3/5.3.8 give the hand-search for endpoint/workspace/pane
(script never ran in `$TMPDIR`) — exactly as the design states. A crash before it leaves
reservation-only fields with the managed-path fallback. "Only `create` returns a partial
handle" holds: no path synthesizes one.

## §4. The two changed base facts (R.3)

**fit-1 note 2 (`9d51982b..ee3534d7`: `ea53b586` fix, `23f48dfe` tests, `ee3534d7` docs).**
Verified: `heldStateOf`/`runningHeldRefusal`/`runningHeldOrchestrators` +
`!isTerminalSession` filter (`start.ts:944-963`, `:1109-1150`); the two F1 reader tests;
the landing check (`herdr_fit1_code_review_r2_sol61.md`: LAND-WITH-CHANGES, 3 doc minors)
and note 3 (`60da85ee`, read in full: archive `mkdir -p` + unused-destination recipe
(m-1), conditional-refusal wording (m-2), merged-removed-from-limit with the
`repairSingleSessionMetadataOnRead`/`STALE_PR_OWNERSHIP_STATUSES` explanation (m-3) —
all three requested changes present). R.3's case table checked row by row:

| Case | R.3 states | Verified |
| --- | --- | --- |
| persisted `killed`, pane alive, both modes | note 2 refuses (still-runs); fit-2 blocks `not-reused` | code + tests (`start.test.ts` still-runs cases at 1357) support it |
| working + `exited`, project reuse/ignore | note 2 refuses; fit-2 **reuses** (OQ-F13) | the one behavior change, correctly flagged as needing an owner decision |
| same, strategy delete | blocked (R8) | R8 text ("would stop it") matches |
| same, isolated | note 2 refuses; fit-2 blocks `not-reused` | R8 ("an isolated record") matches |
| dead pin (`pane_not_found`/other terminal) | note 2 "Cannot tell"; fit-2 `unproven` | classifier + T-7.3 match |
| another record reusable | reused, no refusal | matches note 3's conditional wording |
| note-2 limits | done/errored unprobed; direct isolated core blind; handleless unchecked | docs text verified in the `60da85ee` diff |
| stored `merged` | repaired to `working` first (`:507` set incl. merged; repair fn `:800`, write `:839`); CLI sees working, direct-core G blocks merged as terminal (`TERMINAL_STATUSES` incl. merged, `types.ts:157-163`) | all three citations verified |
| recovery | kill/cleanup refuse; hand edit only (note-3 recipe); fit-2 F-9 | diff verified |

Consequences 1–6 hold: base `ee3534d7` (+note 3 when present); 4-part interim guard
(`isHerdrProbeTerminal` + note-2 trio) removed in commit 6; note-2 oracles move in commit 6
with commit 5 green before it (the real-core interim describes drive through
`program.parseAsync`, so the CLI refusal still fires first — verified at
`start-herdr-interim.test.ts:314-335`); F1 reader tests stay; 2.2 item 12 rewritten;
commit 8 replaces the note-2 paragraphs (per 5.6, with note 3's wording and archive step).

**Commit-8 docs fit:** yes — 5.6 names exactly the note-2 paragraphs R.3 quotes (startup rule
with still-runs refusal, three-limit cover paragraph, three-case recovery paragraph), keeps
the hand-edit for damaged records with note 3's archive step, and moves the note-2/3
`start.ts` comments with the code in commit 6. Nothing in note 3 falls through the cracks.

**Relaunch round 5 (`7a20242f..9f20ce29`: `be5f5572`, `9f20ce29`).** Verified: 5 files
changed, none of them core `session-manager.ts`/`types.ts`/`index.ts`; per-launch mark
`.<id>.<launch token>.unusable`; landing check r5 LAND-WITH-CHANGES with the 1 comment
minor (non-UUID token claim — outside fit-2's surface: fit-2 changes no agent plugin).
§6 consequences verified: `listRecordIds` skips dot-names and non-files
(`session-manager.ts:201-211`), so the dot-directory marks are invisible to G1/reuse/holder
checks; F-9/`kill` leave `.agent-conversations/` (relaunch docs); the three-order table's
4-conflict claim confirmed by read-only `git merge-tree --write-tree 9f20ce29 ee3534d7`
(conflicts exactly in `docs/DEVELOPMENT.md`, `start.ts`, `start.test.ts`,
`session-manager.ts`; `main` vs `ee3534d7` merges clean). The second-landing rule (both
test sets incl. `relaunch.test.ts`/`relaunch-settle.test.ts`/`session-relaunch.test.ts`/
`relaunch-conversation.test.ts` + fit-2 T-4.16–T-4.20/T-7.20/T-7.21c/T-7.26b/T-7.27) is
enforceable as stated.

## New findings

### m-1 — §5.3.10 cites six `start.test.ts` lines that are off by 6 on `ee3534d7`

**Design:** §5.3.10 (commit-6 oracle list), repeated in the author's report §"base-fact
consequences". **Code:** `packages/cli/__tests__/commands/start.test.ts` at `ee3534d7`
(describe opens at file line 1222; note-2 cases verified first-hand).

Cited → actual `it(` line: `:98`→1313, `:114`→1329, `:142`→1357, `:163`→1378, `:179`→1394,
`:192`→1407 — every one exactly 6 high. The cited numbers land on non-meaningful lines
(checked: 1319 is `);`, 1384/1400 blank, 1413 inside the tmux control's handle literal),
while the `start-herdr-interim.test.ts` cites in the same paragraph (`:314`, `:378`) are
exact. The oracles themselves exist and match their descriptions (verified each `it`
label); this is citation precision only, and G0's "checks the names, not the numbers"
already covers the line-number drift for 2.1/3.2.

**Required:** correct the six numbers to 1313/1329/1357/1378/1394/1407 (or cite the `it`
labels, which are stable), or extend G0's names-not-numbers cover to 5.3.10. No behavior
or test change.

### m-2 — The unwritable warning over-asserts "pending handle" when a twice-thrown write may have taken effect

**Design:** §4.5 ("Unwritable ... Then it warns once ... 'The record keeps its pending
handle ...'"). **Code where it applies:** `packages/core/src/session-manager.ts`
(publication sites: restore steps 9/10, rollback step 2; `updateMetadataIf` at
`metadata.ts:656-676`, which can throw after the rename took effect).

The rule is explicit that a throw "may or may not have taken effect", and the unwritable
branch is reachable as throw → pending-on-read → retry-throws, where *both* attempts may
have taken effect (the second rename succeeding before its own throw). In that sub-case
the disk holds the published (partial/returned) handle while the settled-variant warning
flatly says "The record keeps its pending handle". T-4.20c/d assert P only because their
spies throw without writing, so the tests stay green while the text over-promises for a
real mid-rename I/O failure. (The in-memory handle *is* correctly kept and named for the
F-9 search; only the on-disk assertion is too strong.)

**Required:** qualify the settled variant, e.g. "The record keeps its pending handle, or
the published handle if the write took effect although it threw — the record could not be
read back, so check it (`runtimeHandle`, `restoredAt`, claim keys) before F-9", and name
the in-memory handle as possibly-on-disk. No protocol change; the keep-everything +
conditional-settlement behavior is correct.

## §5. Deviations and open questions

The 10 deviations (R.2 list + §12) each trace to a finding or a changed base fact —
verified one by one above (1: sol M-1 adoption; 2: sol m-1 `publishedClaim`; 3: sol m-4
pre-create + `preCreateAt`; 4: Muse m-3 step-7 refusal; 5: Muse m-2 predicate export;
6: OQ-F13(a); 7: endpoint fields; 8: D2 split; 9–10: base + doc pointers). No unlisted
product change: `diff` R.2's section list against the r9→r10 diff — every hunk falls in a
listed section.

| OQ | View |
| --- | --- |
| OQ-F13 (new): project-mode live pane + exited agent, reuse (a) vs block (b) | **Agree (a).** Reuse creates nothing, so no second launch is possible; the state is transient (the lifecycle marks it `killed` once its polls observe the exit, and the next start blocks); (b) would put a non-authoritative agent-process check into G with false-negative blocking risk, contradicting the R4/lifecycle authority model the design inherits. The change from note 2 is real but safe, and correctly presented as needing the owner decision |
| OQ-F10 (scope): predicate-accepted damaged → core | **Agree.** The (a) remainder (predicate-rejected/unhandleless) keeps no-new-launch-next-to-unjudged; the L-2 pin consequence is now explicit |
| OQ-F11 (context): three landing orders | **Agree (b).** Order-independent safety case; the per-order adaptation table + both-sets-green rule + confirmed 4-path conflicts make the second landing mechanical |
| OQ-F12 (size + fit-2a notes) | **Agree (b).** With the added condition satisfied in the design (fit-2a ships interim recovery notes for kept-failed/P/unwritable/damaged-refusal without F-9) |
| OQ-F4–F9 | **No change; prior concurrence stands** (r9 review). The r10 column ("no", "scope", "context", "size and notes") accurately describes each delta and no recommendation changed |

## §6. Implementability

- **File list (17, no new file):** complete — predicate in `types.ts`, endpoint fields in
  `herdr.ts`, rule/write-back/`own.identity()`/`own.adopt`/rollback fields/step-7 refusal
  in `session-manager.ts`, predicate split + note-2 removal in `start.ts`; docs in
  `CLAUDE.md`/`DEVELOPMENT.md`. Every r10 behavior maps to one of these; no agent-plugin
  change (round-5 hook/comment/help-text changes verified disjoint).
- **Commit plan green at each commit:** order preserved (API→F-3→F-4→dispatch→G→CLI→
  F-9→docs); commit 1 adds the predicate + D2-a unit test; commit 3 absorbs
  `fit-pins.test.ts` + `herdr.test.ts:662/:691` + `STATUS_RUNNING` migration and the
  T-4.19/T-4.20/publication/pre-create/adoption changes (the heavy commit, as before);
  commit 5 keeps the note-2 CLI oracles green (verified harness order); commit 6 moves
  them (describes + controls enumerated); commit 8 takes the note-2/3 doc paragraphs.
  Per-commit green remains unproven until implementation (same caveat as both r9 reviews).
- **Oracles:** every changed oracle named (5.2.7 pin/endpoint tables, 5.3.10 note-2 cases
  with old/new texts, T-7.1 sibling for `done`, T-7.26d, T-7.9b, T-4.15–T-4.20 incl. D2
  non-vacuity for T-4.2/T-4.15/T-4.17/T-7.9b/T-7.26d/T-7.21c). Subject to new m-1's number
  fix. The F1 reader tests (`23f48dfe`) stay untouched, as stated.
- **Size L** (~1,900 product / ~3,900 test): the +150/+500 delta is accounted for
  (F-4 570, dispatch 125, G 510, commit-1 175, + T-4.19/T-4.20/T-7.3d/T-7.9b/T-7.26d/D2-b).

## §7. New-claim fact spot-checks (first-hand reads at `ee3534d7` unless noted)

1. `own.write` null-vs-throw + `owned` advance (`session-manager.ts:1746-1756`) — the exact
   premise of the publication rule. ✓
2. `holdsExpected` absent-key-`""` semantics (`metadata.ts:347-351`) — premise of
   `publishedClaim`/`readClaim` compares. ✓
3. Record-lock busy/failed throws (`metadata.ts:264-279`, cited :268/:277) — a thrown
   update is not a null compare. ✓
4. Closed-pane JSON has `compatible:true, version:"0.9.5", protocol:22`; no-server JSON has
   `running:false, compatible:null, version:null, protocol:null` — the r10 oracle rows and
   the null→false rule. ✓
5. `PANE` (`fit-pins.test.ts:60-67`, w7:p1/term_abc) + `statusRunning()` source JSON +
   `STATUS_RUNNING` lacking `compatible` (`index.test.ts:50-58`) — the migration rows. ✓
6. Note-2 `start.ts` parts (`heldStateOf` 944, refusal through 963; filter + refusal list
   1109-1150) — R.3/2.1/2.4 citations. ✓
7. `listRecordIds` skips dot-names/non-files (`session-manager.ts:201-211`) — the round-5
   dot-directory claim. ✓
8. `TERMINAL_STATUSES` incl. `merged` (`types.ts:157-163`) + repair fn (`:800`, write
   `:839`) — the R.3 merged row. ✓
9. Interim describes drive through `program.parseAsync` (`start-herdr-interim.test.ts:314,
   :378` + harness at :324-335) — the commit-5-green claim. ✓
10. `main` `a6d7c4b0` packages tree == `389b8dfe` (`git diff --exit-code` clean) — the
    baseline claim. ✓
11. Presentation wrap at `start.ts:1188` on `ee3534d7` — the moved 3.2 line number. ✓
12. Doc-0004 diff in `0d5c6c67` touches exactly the two pointers (fit-1 tip + fit-2 r10). ✓

## What is correct

- The publication rule is the right completion of sol M-1: it partitions the three
  ownership states (proved replacement / took-effect / still-own / not-own / unwritable)
  with evidence from the code's actual throw-vs-null contract, and its tests fail before
  fit-2 for the stated absences.
- The claimless write-back, predicate-routed CLI split, scoped restore steps and
  named-identity settlement close sol m-1 and all four Muse minors without new machinery
  beyond one predicate and one accessor.
- The pre-create write (sol m-4) is minimal and honest: it narrows the sparse window for
  the common crash without claiming to close it, and names what F-9 cannot find.
- R.3 is an accurate base migration: note 2 + landing-check r2 + note 3 are all reflected
  (including the one behavior change, OQ-F13, flagged as needing a decision), and the
  relaunch-5 merge contract is verified against the actual diff and landing check.
- Residuals stay explicit (R-A, R-Q, hidden-server attestation, L-1–L-5, W-4, RH, R3/M-6).

## Cleanup and verification

Final `ls -la --time-style=full-iso ~/.ao/bin` byte-equal to the initial listing (same
four entries, sizes, permissions, 2026-10-16 mtimes). No review command wrote it.

Required scan, run after the review file was written:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr10m-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed (live-fleet paths only; no review command wrote AO state — no `ao` ran and no
product code executed):

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-80
```

No review-owned process remains (none was started; no node/pnpm/herdr/tmux/agent); the
protected workers/sessions/panes and the other reviewer's session/worktree were not
touched; no kill/pkill ran. `/tmp/aofr10m` was never created (no scratch env needed); the
marker is removed after this scan. Worktree writes: only this review file and the required
`.agent_report.md`; `.agent_task.md`/`.agent_note_1.md` supplied externally, unchanged.
`git diff --exit-code -- packages docs .github agent-orchestrator.yaml` passes. No build
or test ran (review-only).
