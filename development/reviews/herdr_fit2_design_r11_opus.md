# Herdr fit-2 design r11 (ao-65), 2026-10-23

Author: ao-65 (Claude Opus 5.5), 2026-10-23. No product code changed. This design replaces [fit-2 design
r10](herdr_fit2_design_r10_opus.md) and answers its two checks: [sol](herdr_fit2_design_review_r10_sol61.md)
(ao-79, Codex gpt-6.1-sol: NOT-SOUND, 0 blocking, 2 major, 3 minor) and
[Muse](herdr_fit2_design_review_r10_muse13.md) (ao-80, OpenCode Muse Spark 1.3: SOUND-WITH-CHANGES, 0 major,
2 minor). Both checks find the 9 r9 findings closed or closed except for the two majors, which are in the
publication rule of r10 (4.5). It is a narrow round (owner decision 2026-10-23, decision 15 (1)): r11 is a
copy of r10 with only the changes that a finding, a changed base fact or a consequence of an r11 answer
needs. Section R lists them. The owner decided every open question (D-9 in `development/TODO_TRACKING.md`):
section 2.3 and section 11 record the choices. Section R10 (the r9 findings) and section 0 (the r8 findings)
stay as r10 wrote them.

fit-2 = F-3 (a blocked agent is a refusal), F-4 (a failed create closes nothing and keeps everything), F-7
(startup admits at most one Herdr orchestrator launch per project, with `Runtime.preflight()`), F-9 (the
owner's retire action) and the rest of F-8 (contracts and documents). It builds on **fit-1**, which now
exists as code on the branch `feat/fit1-impl-read-agent-task-md-in-your-worktree-once-it-exists`
(`389b8dfe..e322e338`; `9d51982b`, which restores the base formatting of five agent-plugin files and
changes no behavior; note 2, `9d51982b..ee3534d7`, section R10.3; and the docs-only note 3, `60da85ee`,
section R.3). fit-1 is not on `main`. Section 2 states fit-1 from that code.

**Baselines and line numbers.** `main` `d3e2ed8c` (its `packages/` tree equals `389b8dfe`; relaunch is not on
it yet, R.3) and the fit-1 tip `60da85ee` (note 3 on `ee3534d7`). A line number in a file that fit-1 changed
(core `session-manager.ts`, `herdr.ts`, `types.ts`, `index.ts`; runtime-herdr `index.ts`; CLI `start.ts`,
`session.ts`) is that of `ee3534d7`. Note 3 changed only comments in CLI `start.ts` (they move its later lines;
for example `checkOrchestratorLiveness` is at `:978` on `ee3534d7` and `:984` on `60da85ee`), so every other
line number is also that of `60da85ee`; among the product files, note 2 changed only CLI `start.ts`, so every
other fit-1 line number equals that of `9d51982b`. Every other file that this design names is equal on these
baselines. Tests are cited by their `it` labels where a label exists (r11, Muse m-1).

This file is self-contained: an implementer needs this file, the fit-1 tip, the fixtures that it names (all
under `development/artifacts/herdr_095_live_check/`) and the code. Section 8.1 alone is the scope of the
first implementation round, fit-2a. One small measurement was made for r9 (section 3.1, fixtures `r9_*`).
r10 and r11 measured nothing: each new fact comes from the code at `ee3534d7`, `60da85ee`, `9f20ce29`,
`b08e8141`, `804d1347` (relaunch) and `d3e2ed8c`.

## R. Round r11: the r10 checks, the changed sections, the changed base

### R.1 The findings of both r10 checks and their answers

IDs are those of each check. The warning part of sol M-2 and Muse m-2 overlap; one row answers both.

| Finding | What the check requires (short) | Answer in r11 | Sections |
| --- | --- | --- | --- |
| **sol M-1** The rollback takes the adoption identity from the record that it judges, so it can adopt a replacement | Compute the intended identity after the publication once, from the last owned record and the exact updates, before the write; use that fixed identity in the recovery and in the adoption; never take a missing identity key (such as `restoredAt`) from the judged record. Test: a T-4.20f variant whose replacement has this launch's handle, `createdAt` and `tmuxName` and another `restoredAt`, with another process pair and with the same resident pair | **Answered.** Every publication is one call of `publishOwnLaunch` (4.5). Before its first attempt it computes `before = launchIdentity(owned)` and `after = launchIdentity({ ...owned, ...updates })`, once. Each later decision compares the record read with these two fixed values only, and the only record that `own` adopts is one that holds `after`. The spawn and start handle write is now itself a publication, so r10's adoption in `rollbackLaunch` step 1 (with `launchIdentity({ ...current, ...publication })`), the flag `handlePublished` and the post-create `partialRecord` are removed. T-4.20g, with both process pairs | 4.5, 5.2.2, 5.2.3, 5.2.8, 8 |
| **sol M-2** with **Muse m-2** A retry that takes effect and then throws keeps the own claim and reports a replacement; a `null` of `updateMetadataIf` from a missing data directory (`metadata.ts:663`) is not a proved replacement; the unwritable warning states "pending handle" as a fact | Cover a failure after the effect on every attempt, the retry included; keep the fixed before and after identities; settle only the own claim against an identity that is proved own; if no reconciliation is possible, say that the own claim may remain and that the record may hold the new handle, and state neither a replacement nor a pending handle as a fact. Muse: name the in-memory handle as possibly on disk; tell the owner to check `runtimeHandle`, `restoredAt` and the claim keys before F-9. Tests: retry after effect, partial retry after effect, an uncertain `null` while still own, replacement controls | **Answered.** One strict read follows every undecided attempt, a throw or a `null`, the retry included: `after` = written (the attempt took effect); `before` = retry, or unwritable after the retry; neither identity, or no record = not own; the read throws = unwritable. So a `null` alone proves nothing, and the rule makes at most two writes and two reads. The unwritable path settles with two owner-conditional writes, on `before`, then on `after` (each compares that identity and the own claim pair). Its warning has three variants (settled on `before`, settled on `after`, not settled); the third one says that the claim may remain and that the record may hold the pending handle or the in-memory handle, and names the four keys to check. No warning states a replacement. T-4.20c and T-4.20d (new texts), T-4.21a to T-4.21e | 4.5, 5.2.3, 5.2.4, 5.2.8, 8 |
| **sol m-1** T-7.9b's zero-call oracle conflicts with the enrichment of the real `sm.list` | Scope the zero-call assertion to the CLI routing and admission phase, count the enrichment call, and let D2 show the additional CLI probe; no product change only for the count | **Answered.** T-7.9b counts two phases: inside each real `sm.list` call exactly one `isAlive` with that handle (fit-1 `session-manager.ts:1532-1550`: a handle without `runtimeName` falls back to the project's runtime); after the last `sm.list`, zero. D2: one more `isAlive` after the list. No product change | 5.3.10, 8 |
| **sol m-2** The migration of the first real-core interim describe gives killed records the wrong kind | Split the row by persisted status: `working` with a negative or no-server answer = `unproven`; `killed` = `not-reused`; keep the assertions of both | **Answered.** 5.3.10 splits the describe "ao start with an old Herdr orchestrator, through the real session manager (fit-1 interim)" by persisted status, with the same M, no-prefix and nothing-written assertions for both | 5.3.10 |
| **sol m-3** OQ-F13's premise is wrong | Codex, gemini and opencode reject a Herdr check error; justify (a) by the no-new-launch goal and by G reading no activity, with the trade-off; record the owner's approval | **Answered.** The decided OQ-F13 (section 11) states the correct agent behavior (they reject when the Herdr check cannot answer, core `herdr.ts:399-410`), rests (a) on the goal and on G reading no activity, states the trade-off (a successful start can reuse a pane whose agent exited), and records the owner's approval of the changed note-2 outcome (2026-10-23, D-9) | 2.3, 11 |
| **Muse m-1** Six `start.test.ts` line cites of 5.3.10 are 6 too low | Cite the cases by their `it` labels | **Answered.** 5.3.10 names the six cases by their labels; the two parameterized ones also list their parameter labels | 5.3.10 |
| Brief: the owner decided OQ-F4 to OQ-F13 (D-9) | Move them to the decided questions, each with its option | Done. 2.3 lists the choices; section 11 lists them as decided and has no open question | 2.3, 11 |
| Brief: the fit-2a scope (OQ-F12 (b)) | One section from which an implementation brief can be written | Section 8.1: design commits 1 to 4 and one docs commit; 9 product files; the changed oracles; the new tests; the interim notes; what fit-2a adapts to relaunch, once. Section 8.2: what stays for fit-2b | 8.1, 8.2 |

### R.2 The changed sections

The header; section R (new: the r10 section R is now section R10, and every reference to its R.3 now says
R10.3); 1 (items 3, 7); 2.2 (items 8, 9: the `fit-reads.test.ts` cites); 2.3; 4.5 (the publication rule, the
unwritable path, the settlement `null`, the identity table, the table of end paths, a paragraph on the other
own writes); 5.2.2; 5.2.3; 5.2.4 (steps 8, 9, 10); 5.2.7 (the `fit-reads.test.ts` cites); 5.2.8 (T-4.20c, d,
e, f, new T-4.20g and T-4.21a to e); 5.3.10 (the oracle list of commits 6, the no-server controls, new
T-7.8a, T-7.9b); 5.6 (the split of the texts); 6; 7; 8 (G0, the commit table with the new commit 4d, the
gates, D2, the size; new 8.1 and 8.2); 11; 12. All other sections are as in r10.

### R.3 Two base facts that changed since r10

**1. fit-1 has a docs-only note 3** (`60da85ee`, one commit on `ee3534d7`; `docs/DEVELOPMENT.md` and comments
in CLI `start.ts`). It answers the three minors of the note-2 landing check: the hand-edit recipe finds the
sessions directory by core's path rule, creates `sessions/archive` and moves the record to an unused `<id>_<UTC
time>` name; the refusal texts say that `ao start` exits 1 only when no other record can be reused; `merged`
is not named as an unprobed terminal status any more, because core's read repair writes `working` over a
stored `merged` orchestrator. No code, string or test changes (`git diff ee3534d7 60da85ee --
packages/cli/__tests__` is empty; the orchestrator checked that the code tokens of `start.ts` are equal).
Consequences:

1. The fit-1 base is `60da85ee`. The `start.ts` line numbers of this design stay those of `ee3534d7` (the
   header); G0 checks the names.
2. Commit 6 removes the note-3 comments of `start.ts` together with the code that they describe.
3. The by-hand retirement in the docs (the docs commit of fit-2a, 8.1, and commit 8) starts from note 3's
   recipe: the path rule, `mkdir -p` of `sessions/archive`, the unused name. R10.3's rows "The note-2 limits"
   and "A stored `merged` orchestrator" already state note 3's facts.
4. No oracle changes.

**2. The landing order is decided: relaunch first.** Then fit-1 merges that `main`, and fit-2a builds on that
fit-1 (OQ-F11 (b), OQ-F12 (b)). So the order "relaunch first" of section 6 applies, and fit-2a adapts once.
The state at this writing (`main` `d3e2ed8c`): relaunch is not on `main`. The relaunch tip is `b08e8141`
(round 6, `9f20ce29..b08e8141`: the conversation lookup refuses a context token that is not a UUID before it
reads a mark or the record; 2 files of `agent-claude-code`). A merge of `main` into `feat/session-relaunch`
conflicts in three paths, because that branch sits on the old defect A and B branch, whose commits `main` holds
as other commits. So the orchestrator cherry-picked the 31 relaunch commits onto `main` `43783d3d` as the
local branch `land/session-relaunch` (`804d1347`), and ao-63's landing gates pass on it. The landing method
(cherry-pick or merge) waits for the owner (`main` `d3e2ed8c`). A read-only `git merge-tree --write-tree` of
the fit-1 tip `60da85ee` with each candidate gives the conflict paths of fit-1's later merge of `main`: with
`804d1347`, 2 paths (`docs/DEVELOPMENT.md`, core `session-manager.ts`); with `b08e8141`, 4 paths (also CLI
`start.ts` and `start.test.ts`, the count of r10). Consequences:

1. Round 6 changes only `agent-claude-code`; fit-2 changes no agent plugin. Nothing to adapt.
2. fit-2a meets relaunch once, at its G0, on the fit-1 that merged `main`. Section 8.1 names what it adapts
   (section 6 gives the shared keys and functions): the `launchedRecord` of spawn and start, one settlement
   helper, the send hunks, the `types.ts` and `index.ts` additions, and the moved line numbers. fit-2b adapts
   only its CLI `session.ts` hunk (8.2).
3. The two "fit-1 first" rows of section 6 are not taken any more; section 6 marks them.
4. The second-landing rule of section 6 (both test sets green) becomes a rule of fit-2a's gates, with the 15
   relaunch test files of `git diff --name-only 43783d3d 804d1347` (8.1).

## R10. Round r10: the r9 findings, the changed sections, the changed base (as r10 wrote them)

### R10.1 The findings of both r9 reviews and their answers

IDs are those of each review. The partial-publication part of sol M-1 and Muse m-4 (i) overlap; both rows
name the shared answer.

| Finding | What the review requires (short) | Answer in r10 | Sections |
| --- | --- | --- | --- |
| **sol M-1** (with **Muse m-4 (i)**) A thrown restore publication strands the live claim; the partial publication treats a throw as a replacement | Handle a thrown success or partial publication apart from a proved replacement: keep every resource, keep and report the actual handle, try an owner-conditional settlement against the identity on disk; when the record cannot be read or written, keep it and warn that its live claim remains, with the PID and the kept resources; never clear a replacement's claim; update the 4.5 table; resident-process tests: a one-shot success-publication failure, a one-shot partial-publication failure, a persistent failure with the warning, replacement controls | **Answered.** A publication rule (4.5): `null` is a proved replacement (today's not-own path, no settlement). A throw is "not decided": AO reads the record strictly once. When the write took effect, the operation goes on. When the record still holds the pending identity, AO retries the same write once. Any other record is not own. When the write stays impossible (two throws, or the read throws), AO removes nothing, tries one owner-conditional settlement on the pending identity, and warns with the claim (PID and start) when it stays, and with the kept pane, workspace, socket, worktree and agent session. Restore steps 9 and 10, the rollback's partial write (which now also publishes the handle of a spawn or start whose handle write threw) and the rollback's unreadable branch use it. T-4.20a to T-4.20f | 4.5, 5.2.2, 5.2.3, 5.2.4, 5.2.8 |
| **sol m-1** A claimless transition rollback clears claim values that it never owned | Restore the old handle and time only under an exact compare of the claim state that was published; clear claim keys only when this operation took and still owns them; a claimless rollback keeps claim values; tests with `readLaunchClaim()` null, with and without a later claim-only change; keep the later-claim test | **Answered.** The write-back compares the launch identity and the exact claim state that 7a published: the own claim, or, when `readLaunchClaim()` answered null, the claim values as read before 7a. It clears the claim keys only when the restore took its own claim. T-4.19a to T-4.19d; T-4.18 stays | 4.5, 5.2.4, 5.2.8 |
| **sol m-2** T-7.21c's D2 claims more than its mutant proves | Separate the algorithm unit mutant from a controlled duplicate-admission mutant; if kept, name the coherent r8 reversion and add barriers that prove process 2 passed an empty G while process 1 had no reservation; state what each D2 run proves | **Answered.** D2-a: the r8 subject rule in `admissionLock` fails the unit test of subject equality before and after the `mkdir`; it proves the name only. D2-b (kept): the coherent r8 reversion (the r8 subject and none of the equality checks that depend on it) and the stage hook `before-reservation`, which reports G's selection count, as a barrier: process 2 reports an empty G while process 1 waits at the same stage with no reservation; then both launch. On the r10 code the same schedule gives exactly one launch, and process 2 is blocked `in-progress` | 4.2, 5.3.10, 8 |
| **sol m-3** Commit 3 omits the `fit-pins.test.ts` oracles; the helper row is wrong | Add `fit-pins.test.ts` to commit 3 and the test list (the fourth, post-run `pane get` reply in both successful-create setups, its pins, a typed partial with zero close); correct the helper row; limit the `compatible:true` migration to the mocks that lack it | **Answered.** 5.2.7 names the three `fit-pins.test.ts` changes. 2.1 states the helpers as they are: `statusRunning()` reads `closedpane_status_server_json.json` (it has `"compatible":true`), and the core and CLI copies of `herdr-fixtures.ts` hold only `herdrFixture` and `herdrRejection`. The migration adds `compatible` only to `STATUS_RUNNING` of `index.test.ts`. The new `HerdrEndpoint` fields also change two `resolveHerdrEndpoint` oracles of core `herdr.test.ts` (5.2.7) | 2.1, 5.2.1, 5.2.7, 7, 8 |
| **sol m-4** A crashed unprepared P record lacks the recovery fields | Persist the known fields before create (P kept), or give a recovery path for a sparse P record and name what F-9 cannot find; an in-flight assertion for an unprepared agent; no claim that a crash keeps a partial handle | **Answered with persistence.** For a launch whose create runtime is in the set and whose agent has no `prepareAgentSession`, one pre-create write, directly before `runtime.create`, stores the launch fields that a prepared launch stores at that point today (worktree, branch, status, agent, project, `createdAt`, ...); P stays. A crashed launch then names its worktree, and F-9 can remove a managed one. It does not name the endpoint (bin, socket), the herdr workspace and pane, or the launch script; F-9 cannot find these, and 5.4.3 gives the search by hand. Only `create` returns a partial handle, so a crash never leaves one. T-4.15 asserts the fields for both agent shapes | 4.4, 5.2.5, 5.2.8, 5.3.8, 5.4.3 |
| **Muse m-1** T-7.3 omits the pin answer that its oracle needs | State the pin answer | **Answered.** T-7.3: the pin answers `pane_not_found`, `list()` shows `killed`/`exited`, and G blocks with kind `unproven`. A new T-7.3d covers the other cause of `exited` (the pane answers alive, the agent's process check finds no agent): project mode reuses (G reads no activity), isolated mode blocks (`not-reused`). This differs from fit-1 note 2: OQ-F13 | R10.3, 5.3.10, 11 |
| **Muse m-2** The CLI split leaves a parseable handle without `runtimeName` unrouted | Route by G1's selection; a T-7.9 sibling: a parseable handle without `runtimeName` on a Herdr project goes to core, `damaged`, zero calls | **Answered.** One core predicate, `isUnprovenLaunchRecord(raw, selectedRuntime)` (exported), decides G1's handle rows and the CLI split. The CLI sends a candidate to core when the predicate accepts its stored handle text. Only a well-formed handle whose `runtimeName` names a runtime outside the set takes today's probe. A candidate with no stored handle, or with a damaged handle that the predicate does not accept, keeps today's `unchecked` rule (OQ-F10). T-7.9b | 5.3.3, 5.3.5, 5.3.10 |
| **Muse m-3** 5.2.4 does not scope steps 6a to 7b | Scope 6a (orchestrators), 6b and 7a (no A for workers) and the step-7 skip for a damaged handle | **Answered.** 6a is for orchestrator records only. A worker restore runs 6b and 7a without A: the record lock and the compare are its only atomicity (L-3). A damaged stored handle: today's step 7 skips the stop. fit-2 refuses at step 7, like an unconfirmed stop, when the predicate accepts the record (its text names herdr, or the create runtime is in the set): G of a restore excludes the restored ID because step 7 stops or refuses the old launch, and a skipped stop would break that premise. Else (a create runtime outside the set and a text that does not name herdr) today's skip and today's steps stay. A record with no handle keeps the skip (L-2). T-7.26d | 5.2.4, 5.3.10 |
| **Muse m-4** (ii) The settle identity and the `ownClaim` field are implied | Name the refreshed identity at each settle call; add `ownClaim?` to the rollback argument; T-4.17 asserts no claim and the handle | **Answered.** `settleOwnClaim(identity, ownClaim)` takes the identity as an argument, and each call names it (4.5): `own.identity()` (a new accessor of `ownLaunchRecord`: the identity of the last own write) in spawn, start and `keepUnconfirmedLaunch`; `launchIdentity(owned)` after the step-9 or step-10 write in restore. The rollback argument of `rollbackLaunch` and `keepUnconfirmedLaunch` gets `ownClaim?` and `partialRecord?`. T-4.17 asserts no claim keys and the handle that `create` returned; T-4.2 to T-4.6 assert no claim keys and the partial handle | 4.5, 5.2.2, 5.2.3, 5.2.8 |
| sol, notes outside the findings | T-4.16 needs an orchestrator record for its start assertion; a strict re-read for reuse after the hooks must apply R with the deciding identity; fit-2a needs its own interim notes | Applied | 5.2.8, 5.3.2, 11 |
| Muse, OQ-F10 note | Name in the L-2 upgrade step what a pre-fit-2 handleless record does | Applied | 5.3.9 |

### R10.2 The sections that r10 changed

The header; section R (new); 1 (items 3, 7); 2.1 (the `HerdrEndpoint`, CLI interim, docs, test helper and
interim test rows); 2.2 (items 5, 12); 2.4; 3.2 (the start and presentation lines); 4.2 (the admission
stages); 4.4 (where P is written, the consumers); 4.5 (the settlement signature, the publication rule, the
claim state of the write-back, the table); 5.2.1 (step 1); 5.2.2; 5.2.3; 5.2.4; 5.2.5; 5.2.7; 5.2.8;
5.3.2 (the reuse re-read); 5.3.3; 5.3.5; 5.3.8 (the P variant); 5.3.9 (L-2); 5.3.10; 5.4.3 (step 4);
5.6; 6; 7; 8; 11; 12. All other sections are as in r9.

### R10.3 Two base facts that changed since r9

**1. fit-1 has a note 2** (`9d51982b..ee3534d7`: `ea53b586` fix, `23f48dfe` tests, `ee3534d7` docs; 6
files). `ao start` refuses a held Herdr record whose pane still runs (a persisted `killed` record, or one
that `sm.list` shows terminal, for example with activity `exited`), in both workspace modes, when no other
record can be reused. `docs/DEVELOPMENT.md` names the guard's limits (a `done` or `errored` record is not
probed; direct isolated core `spawnOrchestrator`; handleless records) and the recovery by hand edit. Two new
F1 reader tests pin the line-feed limit and the position of the no-server prefix. Its landing check
(`development/reviews/herdr_fit1_code_review_r2_sol61.md`) is LAND-WITH-CHANGES with 3 documentation minors
(the archive directory of the hand edit, the conditional wording of the refusal, `merged` as an example),
which a docs-only note 3 fixes in `docs/DEVELOPMENT.md` and in comments of `start.ts`.

What G does in each case of note 2 (G replaces the interim guard, the note-2 refusal included):

| Case (no other record can be reused) | fit-1 `ee3534d7` | fit-2 |
| --- | --- | --- |
| Persisted `killed` (the lifecycle wrote it after two false polls or after the no-server bound), the pane answers alive; project or isolated mode | exit 1, the still-runs refusal ("... still runs, so it is not reused and no new orchestrator was started ..."); nothing created | not a CLI candidate (terminal); core G: R6 fails: blocked `not-reused` ("its status is killed"); exit 1 with message M, whose lines say "If it runs, use it: ao session attach" and give F-9; nothing written |
| Persisted `working`, `sm.list` shows activity `exited` (the pane answers alive, the agent's process check finds no agent), project mode, strategy `reuse` (the default) or `ignore` | exit 1, the still-runs refusal | G reads no activity, R1 to R8 pass, and the probe answers alive: **reused** (core sets `orchestratorSessionReused`; the CLI prints "Orchestrator session reused"); nothing created. This changes an owner-approved outcome: OQ-F13 |
| The same, project mode, strategy `delete` (also `kill-previous`, `delete-new`) | exit 1, the still-runs refusal | blocked `not-reused` (R8: "the strategy delete would stop it ..."); exit 1 with M |
| The same, isolated mode | exit 1, the still-runs refusal | not a CLI candidate; core G: R8 fails: blocked `not-reused` ("an isolated record"); exit 1 with M |
| `sm.list` shows `killed`/`exited` because the pin answers `pane_not_found` or another terminal | exit 1, "Cannot tell whether ..." | blocked `unproven`; exit 1 with M |
| Another record can be reused (a live Herdr record that is not terminal) next to a held record | that record is reused, no refusal | the same: core's `findReusableOrchestrators` accepts it, and the CLI reuses it without G |
| The note-2 limits | a `done` or `errored` record is not probed; direct isolated core reads no old record; a handleless record is `unchecked` | `done`, `errored`: G selects a record whatever its status and blocks it (`not-reused`). Direct isolated core: G runs in core. Handleless: L-2 and OQ-F10 stay |
| A stored `merged` orchestrator (landing check m-3) | `sm.list` repairs it to `working` first (`session-manager.ts:507`, `:839`), then as `working` | the same repair before the CLI's G; a direct core G reads `merged` and blocks it (`not-reused`). No second launch either way |
| The note-2 recovery | `ao session kill` and `cleanup` retire no Herdr record; only the hand edit does | F-9 retires a Herdr record on the owner's word; the hand edit stays for a damaged record (5.4.4), with note 3's archive-directory step |

Consequences, each with the commit that carries it:

1. The base for `start.ts` is `ee3534d7` (line numbers in 2.1, 3.2, 5.3). Note 3 changes only comments and
   docs; G0 reads it when it is on the branch (section 8).
2. The CLI interim guard has a fourth part: `heldStateOf`, `runningHeldRefusal`, `runningHeldOrchestrators`
   and the `!isTerminalSession` filter of `existingOrchestrators` (`start.ts:944-963`, `:1109-1150`).
   Commit 6 removes it with the other parts and their comments (2.4).
3. The note-2 oracles change in commit 6 (5.3.10 lists them): CLI `start.test.ts`, the two held-alive cases
   and the reuse control next to a held record; CLI `start-herdr-interim.test.ts`, the four cases of the
   describe block "ao start with a held Herdr orchestrator whose pane runs (note 2, review r1 M-1)". Commit 5
   leaves them green: the CLI's interim refusal still comes before core there.
4. The two new F1 reader tests (core `herdr.test.ts`, runtime-herdr `fit-reads.test.ts`) stay as they are:
   rule Q reads failures through the same reader.
5. r9's 2.2 item 12 (the pass-over) no longer describes the base; 2.2 states note 2.
6. Commit 8 replaces the note-2 text of `docs/DEVELOPMENT.md` (5.6).

**2. The relaunch branch has a round 5.** `feat/session-relaunch` is at `9f20ce29` (`7a20242f..9f20ce29`:
`be5f5572`, `9f20ce29`). Claude Code's hook writes a failure mark per launch,
`<sessions dir>/.agent-conversations/.<id>.<launch token>.unusable`; the lookup reads only the mark of the
last launch; the docs state a fourth limit. The round changes `agent-claude-code`, CLI `session.ts` (help
text) and `docs/DEVELOPMENT.md`; core `session-manager.ts` is unchanged since `7a20242f`. Its landing check
is LAND-WITH-CHANGES. The landing order of relaunch and fit-1 is not decided; the recommended order is
relaunch first, then fit-1 merges `main` (4 paths conflict between the two branches: `docs/DEVELOPMENT.md`,
`start.ts`, `start.test.ts`, `session-manager.ts`). Section 6 states the consequences and what fit-2 adapts
in each order.

## 0. The findings of both r8 reviews and their answers

The rows merge the duplicates that the brief names (Muse m-1 = sol m-2, Muse m-3 = sol m-5, Muse m-6 with
sol m-1, Muse m-4 with sol's section "Admission limits, R3 ownership and relaunch integration"). IDs are
those of each review.

| Finding | What the review requires (short) | Answer in r9 | Section |
| --- | --- | --- | --- |
| **sol M-1** The name of lock A changes across the first `mkdir` under a symlinked parent, so two processes can both pass G | An invariant canonical subject, fixed for the operation and used by every admission path; refuse an unexpected lookup failure; a two-process first-start test with a symlinked parent and a pause after the directory creation: exactly one workspace and runtime launch | **Answered.** The subject is the real path of the nearest existing ancestor plus the missing suffix. Only a component that does not exist (`realpath` and `lstat` both `ENOENT`) makes the walk go up; every other lookup state refuses (`admission-path`). Each admission path (start, restore, the CLI's reuse decision) computes the subject once, before A. Under A a start creates the directory and checks that its real path equals the subject, and it checks again directly before the reservation. The r9 Node check: the r8 rule gives two lock names before and after the `mkdir`, the r9 rule one. T-7.21c is the two-process test | 3.1, 4.9, 5.3.1, 5.3.10 |
| **sol M-2** The CLI reuse shortcut bypasses the live-launch rule and the post-probe revalidation | One shared admission and reuse decision for the CLI shortcut (project and isolated candidates): a fresh strict read, the same launch identity, no live launcher, no `launchFailed` or incomplete marker, a fresh runtime-match decision after every awaited probe and before reuse; keep the isolated CLI reuse control; real-core CLI tests: paused after the handle is published, and the record replaced or failed during the CLI probe | **Answered.** Core exports `SessionManager.findReusableOrchestrators(projectId)`. It runs the same admission rounds and the same reuse predicate R as core G (4.7, 5.3.2), in a "reuse only" mode that accepts any workspace mode. The CLI no longer probes a candidate whose handle names a runtime in the set; it asks core. A launch keeps its claim until its success settlement (after `postLaunchSetup` and `confirmLaunch`), so a paused launch is `in-progress` and never reused. T-7.27, T-7.28; control T-7.7 | 4.5, 4.7, 5.3.2, 5.3.5, 5.3.10 |
| **sol M-3** A successful restore of a prepared agent has no claim release | Claim ownership and settlement for spawn, start and restore, with and without `prepareAgentSession`; restore releases its own claim (conditional) on success and every settled failure, also a nonfatal setup exception and a write conflict; warn and keep the resources when the settlement cannot be recorded; settle a kept post-create failure; never clear a later operation's claim; a resident-process test with an OpenCode-shaped stand-in | **Answered.** One owner-aware settlement write (4.5) compares the launch identity **and** this operation's own claim values, so it never clears another operation's claim. The table of 4.5 gives, per operation and agent kind, where the claim is taken and how each end path settles it. Restore settles after step 11 (also after a caught `postLaunchSetup` exception) and on each failure after its transition write. `keepUnconfirmedLaunch` settles a kept failed launch, for every runtime. A settlement that cannot be written warns and removes nothing. T-4.16 to T-4.18 | 4.5, 5.2.3, 5.2.4 |
| **sol m-1** + **Muse m-6** Restore holds A across the workspace creation; no timeout bounds the hold of A | One restore protocol with its rollback and tests; the probe timeouts that bound A | **Answered.** No Herdr call runs under A: a reuse probe runs with A released, and the next round uses its answer only while the record keeps the probed identity (5.3.2). The calls that still run under A (the probe and the stop of an old tmux record) have a core bound of 10 s each. Restore holds A for G, the copy-back, the old runtime's stop decision and the **transition write** (the pending handle and the claim); it releases A before the workspace restore. A failed workspace restore and a plain create error write the transition back. T-7.26b, T-7.26c, T-7.29 | 5.2.4, 5.3.1, 5.3.2 |
| **sol m-2** + **Muse m-1** The token's `ao status` display, its data path and home file, the file count | Status plumbing, rendering, JSON policy and tests in a commit; name the token's home file; correct the count | **Answered.** `launchIdentityToken()` lives in core `metadata.ts`, next to `launchIdentity`, and `index.ts` exports it. `status.ts` computes it from the record and prints it; `--json` gets `identityToken` and `createIncomplete` (additive). `launchFailed` never holds the token. Commit 7. **17 product files** | 4.8, 5.5, 7 |
| **sol m-3** "Every old-record probe" omits cleanup; kill's fallback is not today's | Dispatch cleanup's old-handle probe; state the behavior for a missing plugin per site | **Answered.** The table of 4.6 gives each site its behavior for a registered handle runtime, a missing runtime of the set and a missing runtime outside the set. Cleanup is in it; kill keeps today's skip for a missing runtime outside the set. T-7.8e | 4.6 |
| **sol m-4** T-9.8 cannot inject a replacement after the retire write | Split the test by checkpoint; include a failed retire write | **Answered.** T-9.8a (replacement during step 7: the retire write fails), T-9.8b (after the retire write, in the workspace removal callback), T-9.8c (after the retire write, in the purge holder lookup) | 5.4.5 |
| **sol m-5** + **Muse m-3** `recordMayOwnRuntime` does match an empty ID | Correct the fact and the rationale; keep the conservative result | **Answered.** 3.3 states the code. fit-2 keeps the conservative result: a record whose stored handle has `createIncomplete` "may own" any runtime, as a handleless reservation did before. For a runtime in the set, a rollback whose record is not its own removes nothing at all (5.2.3). T-4.7b | 3.3, 4.4, 5.2.3 |
| **Muse m-2** Q1's "pinned `herdrSocket`" does not exist yet at step 2 | Name the value that step 2 compares | **Answered.** Q1 compares with `endpoint.socket` of step 1. Steps 2 and 5 both run with `HERDR_SOCKET_PATH=endpoint.socket`, and the handle stores that value as `herdrSocket` | 4.3 |
| **Muse m-4** + sol section "Admission limits, R3 ownership and relaunch integration" | Name the overlap with `feat/session-relaunch` and the rule for the second landing; keep L-1 to L-5 with their conditions; do not count the claims as R3 or relaunch M-6 | **Answered.** Section 6 names each shared key, function and path, which side adapts, and the rule for the second landing. fit-2 does not complete same-ID R3 or relaunch M-6. The limits carry sol's conditions, with an upgrade step for L-2 and L-5 | 5.3.9, 6 |
| **Muse m-5** Evidence cited as files that are sections of one log | Cite the sections | **Answered.** Each citation names the log file and the section | 3.1, 4.3 |
| **Muse D-F1** fit-1 was not verifiable | | fit-1 is code now. Section 2 states it from `9d51982b` and names 12 differences from what r8 assumed. Gate G0 stays | 2, 8 |
| sol, fixture note: the newer-protocol `pane run` form was inferred | Label it or measure it | **Measured** in r9: exit 1, `cli:request` `protocol_mismatch` "client protocol 22 is older than server protocol 23; ...", ping only (`r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23`) | 3.1 |
| sol, OQ-F5 wording | Do not say that the post-run check prevents a later send to a changed terminal | Applied: OQ-F5 names the separate liveness check and send, errors read as unknown, and RH B-2 | 11 |
| sol, smaller notes: the guard shape; the Q2 trust boundary; `readLaunchClaim` can answer null; each race test fails when its own fix is undone | | Applied | 4.1, 4.3, 4.5, 8 |

## 1. Results

1. **Admission (sol M-1, sol m-1, Muse m-6).** Every orchestrator start and orchestrator restore takes a lock
   A whose name derives from a canonical subject that does not change across the first `mkdir`. Under A run
   only local work and bounded calls for records outside the set; no Herdr call runs under A. A Herdr launch
   is visible to G from its first byte on disk, also during a restore's workspace step.
2. **CLI reuse (sol M-2).** The CLI reuses a Herdr orchestrator only through core's
   `findReusableOrchestrators`, which applies the same predicate R as G: no live launcher, no failure
   marker, the same runtime, a non-terminal status, an `alive` answer for the same launch identity in the
   deciding round.
3. **Claims (sol M-3; r10 sol M-1, sol m-1; r11 sol M-1, M-2).** Every claim that fit-2 writes has an owner
   and a settlement on each end path. The settlement compares the launch identity and the own claim values.
   A publication fixes its before and after identities once; a thrown or `null` attempt is decided only by a
   strict read against them, also after the retry, so AO never adopts a replacement and never calls an
   uncertain answer a replacement. A restore in a resident process leaves no claim, unless the record cannot
   be written, which AO then states with the PID, as a possibility and not as a fact.
4. **Failed create (r8 M-2, kept).** A failed Herdr create runs the ordinary rollback only for the three
   measured pre-request conditions Q0, Q1, Q2. Every other failure keeps the worktree, the agent session,
   the record and the launch script.
5. **Dispatch (r8 M-3, sol m-3).** Every probe and stop of an old record goes through the runtime that its
   handle names; each site states its behavior for a missing plugin.
6. **Owner retire (F-9).** `ao session kill <id> --confirm-runtime-closed <identity-token>`, with the token
   in message M, the kill refusal and `ao status`.
7. **Size.** 17 product files (15 with a behavior, type or API change; 2 comment-only), about 1,950 product
   lines and 4,150 test lines, 8 commits on top of fit-1. That is **L**. The owner split it into two rounds
   (OQ-F12 (b)): fit-2a (8.1: 9 product files, about 1,030 product and 2,300 test lines, M at its upper end)
   and fit-2b (8.2: 12 product files, about 920 product and 1,850 test lines, M).

## 2. The base: fit-1 as built

### 2.1 What fit-2 uses (read from `ee3534d7`)

| Name | Where | Behavior that fit-2 relies on |
| --- | --- | --- |
| `readHerdrCliFailure(err, expectedId)`, type `HerdrCliFailure` | core `herdr.ts:91` | `{ code, message }` only for the exact 0.9.5 form: exit 1, no signal, not killed, stdout exactly empty, one stderr line (at most one trailing `\n`, no `\r`), a JSON object with exactly `id` and `error`, `id` = `expectedId`, `error` with exactly a non-empty text `code` and a text `message`. Else `null` |
| `isHerdrNoServer(failure)` | `herdr.ts:122` | `server_not_running` and the prefix `no herdr server is running at ` |
| `HERDR_CLI_IDS` | `herdr.ts:52` | keyed by the call's first two words: `pane get` `cli:pane:get`, `pane process-info` `cli:pane:process_info`, `pane read` `cli:pane:read`, `pane run`, `pane send-text`, `pane send-keys` `cli:request`, `agent prompt` `cli:agent:prompt`, `workspace create` `cli:workspace:create` |
| `HERDR_PANE_ID_RE`, `isHerdrPaneId` | `herdr.ts:129`, `:137` | the pane ID grammar |
| `resolveHerdrEndpoint({ binPath, env })`, type `HerdrEndpoint` | `herdr.ts:253-284` | `{ bin, socket, running }`: an absolute executable (a bare name is searched in the absolute `PATH` entries), then `<bin> status server --json` with `env` and a 10 s limit. Rejects a missing binary, a failed call, text that is not JSON, no boolean `running`, a socket that is not an absolute path without control characters. **It reads no `compatible`** |
| `herdrInvocationFor(handle, legacyBin)`, `herdrExecOptions`, type `HerdrInvocation` | `herdr.ts:295-326` | both pins: `{ bin: herdrBin, env: { ...process.env, HERDR_SOCKET_PATH: herdrSocket } }`; neither: `{ bin: legacyBin, env: undefined }`; anything else throws `HerdrPinError` with zero calls |
| `HerdrPinError`, `HERDR_PIN_ERROR_CODE` | `herdr.ts:158-171` | `readonly code = "ERR_HERDR_PIN"`, message "the herdr pins of this record are malformed: ...". **No guard function** |
| `getHerdrPaneProcesses`, `isHerdrProcessRunning` | `herdr.ts:377`, `:520` | take `string \| RuntimeHandle`; an empty ID answers `[]` with no call; another ID outside the grammar rejects with no call; malformed pins reject with no call |
| runtime-herdr `cliIdOf(args)`, `herdrCallError(args, err)` (internal) | `index.ts:178-200` | an F1 failure becomes `Error("herdr error <code>: <message>", { cause: <the execFile rejection> })` with `herdrCode`, plus `code` `ERR_RUNTIME_NO_SERVER` for the CLI's no-server answer; every other failure is thrown as it is |
| runtime-herdr `create` | `index.ts:428-512` | call 0 `resolveHerdrEndpoint` (`running` false: plain error "no herdr server runs at <socket>; start one: herdr server"); call 1 `workspace create` with `pinned` (`HERDR_SOCKET_PATH=endpoint.socket`); no `workspace_id`, or a root pane outside the grammar: plain error "herdr workspace create returned no usable pane ..."; `writeLaunchScript`; call 2 `pane run`; on any failure there, call 3 `workspace close` (`:478`) and a plain error "Failed to launch agent in herdr pane ..."; the handle stores `herdrBin` and `herdrSocket` |
| runtime-herdr `destroy`, `stop` | `index.ts:516`, `:532` | `destroy` refuses with zero calls; `stop` answers `unknown` with zero calls |
| runtime-herdr `isAlive` | `index.ts:626-646` | an ID outside the grammar (also `""`) rejects with no call; one `pane get` with the pins and `commandTimeoutMs` (10 s); `false` only for `pane_not_found` or another terminal; no server rejects with `ERR_RUNTIME_NO_SERVER`; malformed pins reject |
| runtime-herdr `sendMessage` | `index.ts:561-603` | an ID outside the grammar rejects with no call; `SETTLED_STATES` (`:71`) still holds `blocked` |
| core `isOrchestratorRuntimeAlive` (interim) | `session-manager.ts:571-603` | `herdrRecord = (handle.runtimeName \|\| runtime.name) === "herdr"`; for such a record `false` and no-server throw "Cannot tell whether session <id> is alive, so it is neither reused nor replaced. ..."; its callers pass the **project's** runtime (`:2527`, `:2588`) |
| CLI interim | `start.ts:888-1020`, `:1085-1150` | `hasStoredHandle`, `recordRuntimeName`, `isHerdrProbeTerminal` (a Herdr record that `sm.list` shows terminal is still probed when its persisted status is missing, not terminal or `killed`), `checkOrchestratorLiveness` (Herdr `false` and no-server: unknown); note 2 (R10.3): `heldStateOf`, `runningHeldRefusal` and `runningHeldOrchestrators` (a held record that answers alive refuses the start when no other record can be reused) and the `!isTerminalSession` filter of `existingOrchestrators` (a terminal record is never reused) |
| CLI `session attach` | `session.ts` | the grammar check and the pins |
| docs | `docs/DEVELOPMENT.md`, `types.ts`, `CLAUDE.md` | R4 rows 8 and 9; the interim startup paragraph with the still-runs refusal (note 2), the paragraph of the guard's cover and its three limits, the recovery list and the by-hand recovery (note 3 corrects their wording); the `RUNTIME_NO_SERVER_ERROR_CODE` and `isAlive` texts |
| test helpers | `herdr-fixtures.ts` in core `src/__tests__/`, runtime-herdr `src/__tests__/` and CLI `__tests__/` | all three copies: `herdrFixture`, `herdrRejection`. Only the runtime-herdr copy also has `statusRunning()` (it reads `closedpane_status_server_json.json`, which has `"compatible":true`), `STATUS_SOCKET` and `standInHerdrOnPath` (r10, sol m-3: r9 stated these for every copy and said `statusRunning()` has no `compatible`) |
| interim tests | core `src/__tests__/session-manager/orchestrator-herdr-start.test.ts`; runtime-herdr `fit-startup-interim.test.ts`; CLI `start.test.ts` ("start command — old Herdr orchestrators (fit-1 interim)") and `start-herdr-interim.test.ts` | the refusal "Cannot tell whether ..."; note 2: the still-runs refusal (`start.test.ts`, two held-alive cases and the reuse control next to a held record; `start-herdr-interim.test.ts`, the describe block "ao start with a held Herdr orchestrator whose pane runs (note 2, review r1 M-1)", four cases with a stand-in `runtime.create`) |

### 2.2 Differences from what r8 assumed (fit-2 follows the code)

1. runtime-herdr `herdr()` takes no `expectedId`: the command ID comes from `cliIdOf(args)`. Rule Q (4.3)
   reads the F1 failure from the wrapper's `cause` with that ID.
2. fit-1 has no `isHerdrPinError`. Commit 1 adds it (it checks `code === "ERR_HERDR_PIN"` and a string
   `message`).
3. `resolveHerdrEndpoint` reads no `compatible`. Commit 3 adds it (Q0).
4. The `running` refusal of `create` reads "no herdr server runs at <socket>; start one: herdr server". Q0
   keeps it and adds a text for `compatible` (5.2.1).
5. The CLI interim guard has a third part, `isHerdrProbeTerminal`, and since note 2 a fourth, the still-runs
   refusal (R10.3). Commit 6 removes all four.
6. The interim tests are the four files of 2.1. Commits 5 and 6 change their oracles (5.3.10).
7. fit-1 did not change `lifecycle-manager.ts` (`:214-222`, the authoritative-runtime comment). It is a
   fit-2 file now, no longer conditional.
8. The fit-1 test "reads the failure form of every call with its own command ID (workspace create)"
   (`fit-reads.test.ts`; r11: `:207` on `ee3534d7`, r10 cited the `9d51982b` line) uses the session-form no-server text (`noserver_never_workspace_create`). That
   text is not Q1 (4.3), so fit-2 changes the oracle (5.2.7). AO's pinned calls never get that form: with
   `HERDR_SOCKET_PATH` and `HERDR_SESSION` both set, the CLI ends the text with "run \`herdr\` to start or
   attach it" (`r5_path_env_socket_and_env_session.cmd`).
9. The fit-1 test "reads the pane run failure with the command ID cli:request" (`fit-reads.test.ts`, `:226` on `ee3534d7`)
   expects the `workspace close` and a plain error. fit-2 changes it (5.2.7).
10. A root pane outside the grammar gives fit-1's plain "no usable pane" error. fit-2 makes it a partial
    `workspace-unconfirmed` with the same text.
11. fit-1's core interim function probes through the project's runtime (it reads `handle.runtimeName` only
    to decide "Herdr"), so a Herdr record in a project that now selects tmux is probed through tmux. Commit 4
    fixes it (4.6).
12. fit-1 note 2 (R10.3) closed fit-1 open question 2: a held Herdr record (persisted `killed`, or terminal in
    `sm.list`) whose pane answers alive now refuses the start when no other record can be reused (r9 stated
    the earlier pass-over). fit-2's G blocks a `killed` one (`not-reused`, a terminal status) and decides a
    `working` one with activity `exited` by R (R10.3, OQ-F13).

### 2.3 The owner's decisions that stay

- **OQ-F3 (b):** two rounds; this is the second.
- **OQ-F1 (b):** before RH-A, no Herdr answer retires an old orchestrator at startup. The classifier never
  answers "ended" for a Herdr record.
- **OQ-F2 (a):** F-9, with the safeguards of review r7.
- RH-A and RH-B stay design-only; a Herdr `stop` answers `unknown` (OD-19 (a)).
- **OQ-F4 to OQ-F13** (r11; the owner, 2026-10-23, "11: accept the recommendations for OQ-F4 to OQ-F13",
  D-9 in `development/TODO_TRACKING.md`): OQ-F4 (a), OQ-F5 (a), OQ-F6 (a), OQ-F7 (a) with the residual R-Q
  accepted, OQ-F8 (a), OQ-F9 (a), OQ-F10 (a), OQ-F11 (b), OQ-F12 (b), OQ-F13 (a). Section 11 states each
  choice; this design follows them.

### 2.4 What fit-2 replaces in fit-1

- The core interim `isOrchestratorRuntimeAlive`: by G, the classifier and R (commit 5).
- The CLI's Herdr branches of `checkOrchestratorLiveness`, `isHerdrProbeTerminal` and the note-2 still-runs
  refusal (`heldStateOf`, `runningHeldRefusal`, `runningHeldOrchestrators`): by the core reuse decision and G
  (commit 6).
- The create cleanup close of runtime-herdr (`index.ts:474-483`) (commit 3).
- The interim paragraphs of `docs/DEVELOPMENT.md` (the startup rule with the still-runs refusal, the guard's
  cover and limits, the recovery list): by the fit-2 texts (commit 8).

## 3. Facts

### 3.1 Measurements (r8 and r9)

r8: a fake server at `HERDR_SOCKET_PATH` logged each connection; the real herdr 0.9.5 CLI made the calls;
`strace` recorded 13 `connect()` calls, all `AF_UNIX` (`r8_strace_connects.txt`). r9 (new): the same setup
for one more case, `pane run` against a server whose ping answers protocol 23, with the protocol-19 case as
the control of the run (2 `connect()` calls, both `AF_UNIX`, `r9_strace_connects.txt`); and a Node check of
the admission subject rule (pure `node:fs`, `node:path`, `node:crypto`; no product module, no socket, no
child). No real herdr server, no tmux, no `ao` ran in either round.

| Case | CLI answer | Connections at the fake server | Evidence |
| --- | --- | --- | --- |
| `workspace create`, ping answers protocol 19 | exit 1, F1 `cli:workspace:create` `protocol_mismatch` "client protocol 22 is newer than server protocol 19; restart the Herdr server ..." | 1 (ping only): no `workspace.create` | `r8_cli_forms_log.txt`, section `r8_ws_create_ping_protocol_19` |
| `workspace create`, ping answers protocol 23 | exit 1, `protocol_mismatch` "client protocol 22 is older than server protocol 23; upgrade the Herdr client before using this command" | 1 (ping only) | section `r8_ws_create_ping_protocol_23` |
| `pane run`, ping answers protocol 19 | exit 1, `cli:request` `protocol_mismatch`, the "newer" text | 1 (ping only): no `pane.send_input` | section `r8_pane_run_ping_protocol_19`; repeated in `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_19_control` |
| **`pane run`, ping answers protocol 23 (r9)** | exit 1, `cli:request` `protocol_mismatch` "client protocol 22 is older than server protocol 23; upgrade the Herdr client before using this command" | 1 (ping only): no `pane.send_input` | `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23` |
| `status server --json`, ping answers protocol 19 and 23 | exit 0, `"running":true`, `"compatible":false`, `"endpoint_compatible":true` | 1 (ping only) | `r8_status_json_ping_protocol_19.json`, `r8_status_json_ping_protocol_23.json` |
| `workspace create`, a stale socket file | exit 1, F1 `server_not_running` "no herdr server is running at <socket>; run \`herdr\` to start or attach it" | 0 (one `AF_UNIX` connect, refused) | `r8_cli_forms_log.txt`, section `r8_ws_create_stale_socket_file`; `r8_strace_connects.txt` |
| `pane run`, a stale socket file | the same with `cli:request` | 0 | section `r8_pane_run_stale_socket_file` |
| `workspace create`, the server answers the request with `zz_unknown_code` | exit 1, F1 with that code | 2: the request was sent | section `r8_ws_create_error_after_request` |
| `workspace create`, the server answers the request with `server_not_running` and the CLI's prefix | exit 1, "no herdr server is running at /tmp/aohd5/fake/elsewhere.sock" (no suffix) | 2: the request was sent | section `r8_ws_create_server_sends_cli_no_server_text` |
| `pane run`, the server answers the request with `pane_not_found` | exit 1, F1 `cli:request` `pane_not_found` | 2: `pane.send_input` was sent | section `r8_pane_run_pane_not_found_after_request` |
| **Admission subject (r9)**: a symlinked parent (`alias` → `real`) and three missing components | r8 rule (`realpath`, else `resolve`): `.../alias/...` before the `mkdir`, `.../real/...` after: two lock names. r9 rule (4.9): `.../real/...` before and after: one name. A file as a component (`ENOTDIR`) and a dangling symlink: the r9 rule refuses; the r8 rule falls back to the lexical path | — | `r9_admission_subject_check.txt`; the script `r9_admission_subject_script.txt` |

Other facts of the same kind: a real 0.9.5 server answers `"compatible":true` (`closedpane_status_server_json.json`);
with no server the field is `null` (`noserver_never_status_server_json.json`). The protocol-19 text has more
sentences after "; " (a `\n` inside the JSON string); the stderr line is still one line. With
`HERDR_SOCKET_PATH` and `HERDR_SESSION` both set, the CLI uses the socket path, and its no-server text ends
"run \`herdr\` to start or attach it" (`r5_path_env_socket_and_env_session.cmd`); the session form "run \`herdr
session attach <name>\` to start or attach it" appears without `HERDR_SOCKET_PATH`
(`noserver_never_workspace_create`). Limits: the fake server answers the ping and logs requests; it models no
workspace. A server that imitates the CLI's exact texts (R-Q, 4.3) is not measured.

### 3.2 Code facts that fit-2 uses (fit-1 tip)

- **Launch claim.** `launchPid` and `launchPidStart` (`session-manager.ts:286-293`); `processStartToken` (field
  22 of `/proc/<pid>/stat`, else `ps -o lstart=`); `currentLaunchClaim` (`:327`); `readLaunchClaim` (`:339`;
  it warns and answers `null` when the start time cannot be read); `liveLaunchOwner` (`:355`);
  `assertNoLiveLauncher` (`:370`); `CLEARED_LAUNCH_CLAIM` (`:290`). A launch takes a claim only when its agent
  has `prepareAgentSession` (`:2074`, `:2477`); only agent-opencode has it. The clears (`:2360-2364`,
  `:2913-2918`) come after `confirmLaunch` and compare the launch identity only. Restore takes no claim.
- **Records.** `reserveSessionRecord` (`metadata.ts:900-924`) creates the directory first (`:907`), then
  under the record lock publishes the complete record with `link`. `recordLockName` (`:234-241`) uses the
  real path, else the lexical path. `updateMetadataIf(dir, id, expected, updates)` compares any keys
  (`:656-676`). `LAUNCH_IDENTITY_KEYS` (`:331-337`): `reservationId`, `runtimeHandle`, `tmuxName`,
  `createdAt`, `restoredAt`.
- **Lock.** `holdDeliveryLock(name, waitMs)`; `isDeliveryLockSupported()` is true only on Linux;
  `deliveryLockName(kind: "ledger" | "attempt" | "record", subject)` (`delivery-lock.ts:33-48`, `:100-110`).
  A second bind of a held name fails, also in the same process.
- **Start today.** `validateAndStoreOrigin` (`:2469`), the claim (`:2477`). Project mode:
  `setupWorkspaceHooks` (`:2507`), the existing record (`:2510`), its probe (`:2527`) and stop (`:2484-2496`)
  through the project's runtime, the reservation (`:2581`), the concurrent branch (`:2582-2615`). Isolated:
  `reserveNextOrchestratorIdentity` (`:2621`, reservation `:1385`), workspace create, hooks (`:2653`). Then the
  prompt file, the agent preparation, `runtime.create` (`:2847`), the handle write (`:2894`),
  `postLaunchSetup`, `confirmLaunch`, the clear (`:2913`).
- **Restore today** (`:4286-4646`). `assertNoLiveLauncher` (`:4323`); steps 2 to 6 write nothing; the archive
  copy-back (`:4459`); step 7 stops the old handle through the **project's** runtime (`:4491-4514`); step 8
  `workspace.restore` and `postCreate` (`:4516-4549`; the worktree plugin prunes, may fetch and runs `git
  worktree add`); step 9 `create` (`:4552-4569`) with no catch; step 10 the conditional write (`:4571-4613`);
  step 11 a nonfatal `postLaunchSetup` (`:4616-4642`).
- **Rollback.** `rollbackLaunch` (`:1874-1960`): with a runtime and a handle, a replaced record that may own
  the runtime keeps the runtime with a warning (`:1886-1906`), and the rollback then still discards a prepared
  agent session that no other record names (`:1907-1922`). `keepUnconfirmedLaunch` (`:1971-2011`) writes
  `launchFailed` (capped at 600 characters) and keeps the claim; a throw of that write becomes a sentence of
  its warning (`:2001-2007`). `ownLaunchRecord` (`:1731-1787`): `write` compares the launch identity of the
  last own write; a `null` throws `recordChangedError`, an error of `updateMetadataIf` (the record lock busy
  or failed, `metadata.ts:268`, `:277`; an I/O error) is thrown as it is, and `owned` advances only after a
  write. Before `runtime.create`, a prepared launch writes the launch fields (worker `:2259-2275`,
  orchestrator `:2818-2832`); an unprepared one writes them first in its handle write (`:2321-2343`,
  `:2879-2894`).
- **OpenCode holder.** `openCodeHolderReason` (`:1072-1140`): a record with launch keys and no handle is a
  dead holder (`:1087`); a handle with an empty ID is "unknown" (`:1097`), so the OpenCode session stays held.
- **Presentation.** `ao start` wraps a core error as "Failed to setup orchestrator: ..." (`start.ts:1188`);
  the top-level handler prints `Error:` and the message and exits 1 (`:1328-1334`).
- **Send.** The core restore retry (`session-manager.ts:4025-4046`); the CLI's non-tmux delegation
  (`send.ts:356`).
- **Status.** `SessionInfo.launchFailed` (`status.ts:46`), `printLaunchFailed` (`:229-232`); `--json` prints
  `SessionInfo[]` (`:321-390`).
- **Timeouts.** runtime-tmux 5 s per command (`runtime-tmux/src/index.ts:22`; it has no `stop`, so
  `stopRuntime` makes `destroy` and `isAlive`); runtime-herdr `commandTimeoutMs` 10 s (`:60`); core
  `herdr.ts` 10 s (`:21`). The registry gives built-in runtimes no config, so these defaults apply.

### 3.3 Corrected code statements (sol m-5, Muse m-3)

- `recordNamesRuntime` (`session-manager.ts:1671-1680`) compares `id` and `runtimeName` for equality with no
  non-empty check: two Herdr handles with `id: ""` match. `recordMayOwnRuntime` (`:1692-1699`) answers `true`
  for a record without `runtimeHandle`. r8's sentence "`recordMayOwnRuntime` never matches an empty ID" was
  wrong.
- With P (4.4), a reservation record has a stored handle. Without a change, `recordMayOwnRuntime(P-record,
  h)` for a real handle `h` would answer `false`, where a handleless reservation answered `true`. fit-2 keeps
  the earlier conservative answer (4.4).
- The r7 m-3 statements stay as r8 corrected them: a nonzero `execFile` rejection has a numeric `code`; for a
  Herdr handle with an empty ID, claude-code's process check rejects and codex, gemini and opencode answer
  `false`. fit-1 changed only the argument of these calls (the handle, its report section 1.2). A false agent
  answer alone has no lifecycle authority (`lifecycle-manager.ts:662`, the runtime-positive gate).

## 4. Shared definitions (new in fit-2)

### 4.1 Error types (`core/src/runtime-errors.ts`, new; exported from `index.ts`)

Each guard checks the `code` and the whole shape, never `instanceof` alone, so it accepts an error from
another copy of core.

| Class | `code` | Fields | Guard checks |
| --- | --- | --- | --- |
| `RuntimeCreatePartialError` | `ERR_RUNTIME_CREATE_PARTIAL` | `handle` (what may exist), `stage` ∈ {`workspace-unconfirmed`, `launch-not-submitted`, `launch-unconfirmed`}, `closed: "nothing"`, `cause` | `code`; `handle` a non-null, non-array object with a string `id`, a non-empty string `runtimeName` and a non-null, non-array object `data`; `stage` in the set; `closed === "nothing"` |
| `RuntimeSendRefusedError` | `ERR_RUNTIME_SEND_REFUSED` | `reason: "agent_blocked"`, `admitted` ∈ {`none`, `earlier-attempt-unconfirmed`}, `target` (pane ID), `stage` | `code`; `reason`; `admitted` in the set; `target` and `stage` strings |
| `OrchestratorStartBlockedError` | `ERR_ORCHESTRATOR_START_BLOCKED` | `projectId`, `reason` ∈ {`records`, `records-unreadable`, `records-changed`, `admission-busy`, `admission-unsupported`, `admission-path`}, `blocking: BlockingLaunch[]` | `code`; `projectId` a string; `reason` in the set; `blocking` an array |
| `HerdrPinError` (fit-1, `herdr.ts`) | `ERR_HERDR_PIN` | the message | `isHerdrPinError` (commit 1): `code` and a string `message` |

`BlockingLaunch`: `sessionId`, `kind` (4.7), `reason` (text), `status`, `launchFailed` (boolean), `handle`
(the stored text, first 80 characters, when it does not parse), `pane`, `terminal`, `workspace`, `worktree`,
`socket`, `bin`, `answer` (text, filled after A), `launcherPid` (for `in-progress`), `identityToken` (4.8).

### 4.2 The unproven set and the contracts (`core/src/types.ts`)

- `LAUNCH_END_UNPROVEN_RUNTIMES: ReadonlySet<string> = new Set(["herdr"])` and `isLaunchEndUnproven(name)`.
  Doc: "Runtimes whose answers do not prove that a launch ended: a server can run where the recorded endpoint
  does not reach it, and pane IDs come back after a restart. Startup never retires a record of such a runtime
  on a runtime answer."
- `Runtime.create` doc (replaces "Create a new session environment and return a handle"):

  > Create a session environment and return its handle. On failure, a runtime throws a plain error only when
  > nothing of the session can exist in it: no request reached the runtime, or the runtime removed what it
  > made. Core then runs the ordinary rollback: it discards a prepared agent session, removes the workspace
  > and releases the reservation. When something may exist (a request was sent, an answer is unknown, a
  > cleanup is not confirmed), the runtime throws `RuntimeCreatePartialError` with the handle of what may
  > exist and `closed: "nothing"`; it closes nothing, and core keeps the record, the workspace and the agent
  > session (a "kept failed launch"). runtime-herdr follows this with the measured conditions of its rule Q.
  > runtime-tmux keeps its earlier behavior (it kills the tmux session that it made, best effort, before it
  > throws); these Herdr measurements do not qualify it.

- `Runtime.preflight?(): Promise<void>` (optional): "Check that `create()` can start a session now, with the
  binary and endpoint that `create()` will use. Throws a message for the operator. A readiness sample, not a
  reservation of the endpoint, and never evidence about an existing session."
- `SessionManager.findReusableOrchestrators(projectId): Promise<Session[]>` (commit 5; 5.3.2).
- `SessionManager.kill` options: `{ purgeOpenCode?: boolean; confirmRuntimeClosed?: string }` (commit 7).
- `SessionManagerDeps.admission?: { waitMs?: number; probeTimeoutMs?: number; onStage?: (stage:
  AdmissionStage, info: { selected: number }) => Promise<void> }`, for tests: `waitMs` (default 30 000),
  `probeTimeoutMs` (default 10 000), and a hook at the stages `subject-fixed`, `lock-held`,
  `sessions-dir-ready`, `before-reservation`, `transition-written`. `info.selected` is the number of records
  that G1 selected in the round (0 before G1 runs). r10 (sol m-2): the hook at `before-reservation` is the
  barrier of T-7.21c's D2-b. Production code passes nothing.
- `isUnprovenLaunchRecord(raw, selectedRuntime): boolean` (r10, Muse m-2; exported): the handle rows of G1
  (5.3.3) as one pure function of a record's `runtimeHandle` text and the project's selected runtime. G1 and
  the CLI split (5.3.5) both use it.

### 4.3 Rule Q: the qualified no-request conditions of a Herdr create

Core `herdr.ts` exports `herdrPreRequestRefusal(failure: HerdrCliFailure | null, socket: string): "no-server" |
"protocol" | null`. The plugin computes `failure` from the rejection of its call: for fit-1's wrapper (an
error with `herdrCode`) `readHerdrCliFailure(err.cause, cliIdOf(args))`, else `readHerdrCliFailure(err,
cliIdOf(args))`. So fit-1's reader has already checked the exit code, the empty stdout, the one stderr line
and the expected command ID.

| Condition | Exact form | Why no request was sent | Evidence |
| --- | --- | --- | --- |
| **Q0** endpoint check | `resolveHerdrEndpoint` fails, or answers `running !== true`, or `compatible !== true` | it is a ping; `create` sends nothing after it | `r8_status_json_ping_protocol_19.json`, `r8_status_json_ping_protocol_23.json` (`compatible` false); `noserver_never_status_server_json` (`null`); `r5_b0_requests_log` |
| **Q1** CLI no-server | `code === "server_not_running"` and `message === "no herdr server is running at " + socket + "; run \`herdr\` to start or attach it"`. `socket` is `endpoint.socket` of step 1: steps 2 and 5 both run with `HERDR_SOCKET_PATH=endpoint.socket`, and the handle stores that value as `herdrSocket` | the CLI found no listener | `r8_cli_forms_log.txt`, sections `r8_ws_create_stale_socket_file` and `r8_pane_run_stale_socket_file` (0 connections); `r5_path_env_socket_and_env_session.cmd` (this text under AO's pins) |
| **Q2** CLI protocol refusal | `code === "protocol_mismatch"` and `message` matches `/^client protocol \d+ is (newer\|older) than server protocol \d+; /` | the CLI refused after the ping | `r8_cli_forms_log.txt`, sections `r8_ws_create_ping_protocol_19`, `r8_ws_create_ping_protocol_23`, `r8_pane_run_ping_protocol_19`; `r9_cli_forms_log.txt`, section `r9_pane_run_ping_protocol_23` |

Anything else is not qualified: another F1 code; `server_not_running` with another socket, with no suffix,
or with the session-form suffix (`r8_cli_forms_log.txt` section `r8_ws_create_server_sends_cli_no_server_text`;
`r5_b_pane_get_server_not_running_from_server`; `noserver_never_workspace_create`); the 0.8.0 exit-0 error
envelope; Rust text; a timeout; a signal; an exit code other than 1.

**Trust boundary, residual R-Q.** Q1 is an exact full message. Q2 is a prefix (the rest of the message
varies with the socket and the version). A server that answers a request in the exact F1 form with the Q1
text (its socket in it) or with a message that begins with the Q2 prefix would look like a pre-request
refusal: AO would run the ordinary rollback while the server may have made a workspace or admitted the
input. herdr 0.9.5 makes these texts in the CLI; no measured server sends them. The rule does not defend
against a server that imitates the CLI. OQ-F7.

### 4.4 The pending handle P

For a launch whose create runtime is in `LAUNCH_END_UNPROVEN_RUNTIMES`:

- `P = { id: "", runtimeName: <runtime>, data: { createIncomplete: "create-pending" } }`.
- **Written** by spawn and start in the reservation's `initial` (atomic `link`): worker
  `reserveNextSessionIdentity` (`:1283`, reservation `:1317`); orchestrator project mode `reserveSessionRecord`
  (`:2581`, `:2608`, `:2611`) and isolated `reserveNextOrchestratorIdentity` (`:2621`, reservation `:1385`),
  with `role: "orchestrator"` and the claim (4.5). Written by restore in its transition write (5.2.4), after
  the old runtime's stop decision.
- **Kept by the pre-create write** (r10, sol m-4): a spawn or start whose agent has no
  `prepareAgentSession` writes the launch fields directly before `runtime.create` (5.2.2), as a prepared
  launch does there today. The write merges, so P stays. A crashed launch therefore leaves P with these
  fields (5.2.5).
- **Replaced** by the success handle write; by the partial handle (5.2.3); on a plain error, spawn and start
  delete the reservation (the ordinary rollback), and restore writes the transition back (5.2.4).

**The consumers of P** (corrected, sol m-5):

| Consumer | Answer for a record with P | Source |
| --- | --- | --- |
| runtime-herdr `isAlive` | rejects with no call (`""` is outside the grammar) | `index.ts:626-633` |
| runtime-herdr `stop` | `unknown`, no call | `index.ts:532` |
| core row 8 `getHerdrPaneProcesses` | `[]`, no call | `herdr.ts:377` |
| agent `isProcessRunning` | claude-code rejects; codex, gemini, opencode answer `false`; not authoritative | 3.3 |
| `recordNamesRuntime(P-record, P)` | `true` (two empty IDs) | `:1671` |
| `recordMayOwnRuntime(record, h)` | **fit-2:** `true` for a record whose stored handle has `data.createIncomplete` (any stage), as for a handleless record. So a reservation keeps the conservative answer that it had before fit-2 | `:1692` |
| `openCodeHolderReason` | "unknown": the OpenCode session stays held. Before fit-2, a crashed handleless launch was a dead holder (`:1087`); now the owner releases it with F-9 | `:1097` |
| G, the reuse decision | live claim: `in-progress`; dead claim: `create-incomplete` | 5.3 |
| kill | live claim: launch in progress; dead claim: the Herdr stop answers `unknown`, so the kill refuses | `:3076`, `:3094-3125` |
| F-9 | accepts a dead claim; no call for the empty ID; removes the managed worktree that the launch fields name (r10: also for an unprepared crashed launch) | 5.4 |
| `ao status` | `launch incomplete (create-pending; identity token <t>)` | 5.5 |
| list enrichment, the lifecycle | the probe rejects; the stored status stays | |
| send | `sendMessage` rejects with no call | `index.ts:563` |
| relaunch (if it has landed) | refuses a Herdr handle | section 6 |

No consumer depends on an ownership exclusion for P. The conservative answers and the Herdr stop's `unknown`
keep every resource. tmux and the test runtimes write no P: their records keep their shape.

### 4.5 Launch claims: ownership and settlement (sol M-3)

**Owner.** A claim is the pair `{ launchPid, launchPidStart }` of the `ao` process that wrote it
(`currentLaunchClaim`). The operation that writes a claim keeps the pair (`ownClaim`) and is its only owner.

**Who takes a claim.** Spawn and start: `claimNeeded = !!agent.prepareAgentSession ||
isLaunchEndUnproven(createRuntime.name)`, in the reservation (`initial`). Restore:
`isLaunchEndUnproven(createRuntime.name)`, in the transition write (5.2.4). A tmux restore takes none, as
today. When `readLaunchClaim()` answers `null` (no readable start time; it warns), the launch has no claim: P
still makes G block (`create-incomplete`), but no process is its `in-progress` owner. The claim is a launch
marker, not an infallible process-ownership protocol.

**Claim writes compare.** The reservation creates a new record (`link`). The restore transition compares the
launch identity and the claim values as read. `assertNoLiveLauncher` runs before both. No fit-2 write puts a
claim over a live one.

**The published claim state** (r10, sol m-1). `ownClaim` is the pair that this operation wrote, or `null`
(no claim taken: a tmux launch, or `readLaunchClaim()` answered `null`). `publishedClaim` is the claim state
that the record holds after this operation's claim write: `ownClaim`; or, for a restore with `ownClaim`
`null`, the values as read before 7a (`launchPid` and `launchPidStart`, `""` when absent; `holdsExpected`
reads an absent key as `""`, `metadata.ts:347-351`). A write that rolls back this operation's own change
compares `publishedClaim` exactly; only a write with a non-null `ownClaim` clears claim keys.

**The settlement write** (r10, Muse m-4: the identity is an argument). `settleOwnClaim(identity, ownClaim)`;
no write when `ownClaim` is `null`:

```ts
updateMetadataIf(sessionsDir, sessionId,
  { ...identity, launchPid: ownClaim.launchPid, launchPidStart: ownClaim.launchPidStart },
  CLEARED_LAUNCH_CLAIM);
```

`identity` is the launch identity of this operation's last own write, named at each call:

| Call | `identity` |
| --- | --- |
| spawn and start, success | `own.identity()`: a new accessor of `ownLaunchRecord` that answers `launchIdentity(owned)`; after the handle publication (written, or adopted because it holds the fixed `after`) and the metadata write of the success `try`, it holds the real handle |
| `keepUnconfirmedLaunch` | `own.identity()` after its `launchFailed` write; when the rollback's step 2 published a partial handle (5.2.3), `own` advanced there, so the identity holds that handle |
| `rollbackLaunch`, record unreadable at step 1, no publication open (5.2.3) | `own.identity()`, the last identity that this launch wrote |
| an unwritable publication, any site (r11) | first `before`, then `after`: the two fixed identities of that publication |
| restore, step 9 partial | `launchIdentity(owned)` with `owned` = the record that the partial publication wrote or adopted |
| restore, step 12 (after step 11) | `launchIdentity(owned)` with `owned` = the record that step 10 wrote or adopted (the step-11 metadata write changes no identity key) |

- Written: done.
- `null`: AO makes one strict read (r11, sol M-2: a `null` can be the uncertain one of `metadata.ts:663`).
  When the record still holds `identity` and the own claim pair, AO settles once more, and a second `null` or
  a throw is a settlement that could not be written (below). Else the record is gone, names another launch,
  or holds other claim values (a later operation's claim, or none): nothing to settle. It never clears
  another operation's claim; today's clears compare the launch identity only. (The final settlement of the
  unwritable path makes no such read: its warning covers the uncertain case.)
- Throws (an I/O error, the record lock not obtained): the row's failure handling below.

The other values of an end path (the agent's `session.metadata`, `launchFailed`, a partial handle) go in the
write directly before the settlement, with today's compare on the launch identity (`own.write`, or
`updateMetadataIf` on `launchIdentity(owned)` in restore; not own: today's `recordChangedError`). So other
claim values with the same launch identity stop neither the launch's own data nor its result, and the
settlement leaves them as they are (T-4.18). When that earlier write changes the launch identity (a partial
handle), the settlement compares the new identity (the table above).

**Own publications and their failures** (r10, sol M-1; r11, sol M-1 and M-2). A publication is a write that
puts this launch's runtime handle into its own record: the spawn and start handle write (`:2343`, `:2894`) for a
create runtime in the set, the rollback's write of a partial handle (5.2.3 step 2), the restore partial write
(step 9) and the restore success write (step 10, `:4580`). Each is one call of `publishOwnLaunch(sessionsDir,
id, owned, updates)` (new, internal to `session-manager.ts`); `own.publish(updates, during)` calls it with the
owned record of `ownLaunchRecord` and sets `owned` from its result.

1. **Two fixed identities, once, before the first attempt** (r11, sol M-1): `before = launchIdentity(owned)`
   and `after = launchIdentity({ ...owned, ...updates })`. Both come from the last owned record and the exact
   updates. No later step takes an identity value from a record that it judges: a key that `updates` does not
   write (for spawn and start `restoredAt`) keeps its owned value in `after`. Every publication changes
   `runtimeHandle`, so `after` differs from `before`.
2. **An attempt** (at most two): `updateMetadataIf(sessionsDir, id, before, updates)`. A returned record:
   **written**. The retry sends the same `updates` object, so a time in it (the `restoredAt` of restore step
   10) has the same value in both attempts and in `after`.
3. **An undecided attempt** (a throw, or `null`). A `null` is not a proof (r11, sol M-2): `updateMetadataIf`
   answers `null` also when `existsSync(sessionsDir)` is false (`metadata.ts:663`), and `existsSync` answers
   false also when the lookup fails. So after every undecided attempt, the retry included, AO makes one strict
   read (`readRecordStrict`: a missing file is "no record"; any other read error throws):

   | The strict read | After attempt 1 | After attempt 2 (the retry) |
   | --- | --- | --- |
   | holds `after` | **written**: the attempt took effect, also when it threw | **written**: the retry took effect |
   | holds `before` | retry once (attempt 2) | **unwritable**, last read: pending |
   | holds neither identity, or no record | **not own** (proved by this read) | **not own** |
   | throws | **unwritable**, last read: unknown | **unwritable**, last read: unknown |

   So the rule makes at most two writes and two strict reads. "Written" sets `owned` to the record that the
   write returned or that the read showed; this is the only adoption, and it accepts only a record that holds
   the fixed `after`.
4. **The results at the sites.** Written: the site goes on. Not own: the not-own path of the site (today's), no
   settlement, no claim write, no removal. Unwritable: the unwritable path below. In spawn and start,
   `own.publish` throws `recordChangedError` (today's text) for not own, and an internal
   `LaunchRecordUnwritableError` for unwritable; that error carries `before`, `after`, the last read and the
   handle, and the post-create catch passes it to `rollbackLaunch` (5.2.3 step 0).

**Unwritable** (the record cannot be read or written now; r11, sol M-2 and Muse m-2): AO removes nothing (no
stop, no agent-session discard, no workspace removal, no release, no copy-back removal) and keeps the handle
that it has in memory (the returned or partial handle), which may already be on disk. With a non-null
`ownClaim` it makes the final owner-conditional settlement: `settleOwnClaim(before, ownClaim)`, and when that
answers `null`, `settleOwnClaim(after, ownClaim)`. Each compares one fixed identity of this publication and
this operation's own claim pair, so it never clears the claim of another operation or of another launch: a
record that holds neither identity (also r10's replacement that differs only in `restoredAt`) is not
written. A `null` of a settlement proves nothing either; the warning then says what may hold. Then it warns
once, and the operation throws (restore) or ends its rollback (spawn, start). The warning names the session,
the error, the record file, the worktree, the agent session and the handle in memory (pane, terminal,
workspace, socket), and one of these variants:

- **settled on `before`**: "AO cleared its launch claim while the record held this launch's state before the
  write (<the pending handle | the handle of pane <p>>). The handle above is not recorded."
- **settled on `after`**: "The record holds the handle above: the write took effect although it threw. AO
  cleared its launch claim."
- **not settled** (both settlements answered `null`, one threw, or `ownClaim` is `null`): "The launch claim of
  ao process <pid> (start <launchPidStart>) may remain in the record, and the record may hold the pending
  handle or the handle above. While that process runs, AO treats the launch as in progress, and ao start,
  kill and F-9 refuse it. Check runtimeHandle, restoredAt, launchPid and launchPidStart in <record file>
  before you retire the record." With `ownClaim` `null`, the claim sentences are left out.

Each variant ends with: "Check the runtime by hand (design 5.4.3), then retire the record: ao session kill <id>
--confirm-runtime-closed <identity token>." In fit-2a, before F-9 exists, it ends with "... then retire the
record by hand (docs/DEVELOPMENT.md, "Retire a Herdr record by hand")" (8.1).

For `rollbackLaunch` step 1 with an unreadable record and no publication open, the same path applies with
`before = own.identity()` and no `after`: one settlement on `before`, and the variants "settled on `before`"
or "not settled".

**Other identity-changing own writes** (r11, from sol's notes). The reservation (`link`), the pre-create write
(5.2.2) and the restore transition 7a come before any runtime of this launch exists, and the rule does not
cover them. A throw there keeps today's plain path. When such a write took effect before it threw, the
plain path's conditional writes compare the old identity and change nothing: the record keeps P and this
process's claim, a workspace of the launch stays (the rollback's check reads "replaced"), and nothing runs in
the runtime. For an orchestrator record, G then sees `in-progress` while the process runs, and
`create-incomplete` after it ends; kill refuses (a live launcher, then the Herdr stop's `unknown`); F-9 retires
the record (in fit-2a: by hand). This is a stated limit, not a stranded runtime: no runtime exists.

**Settlement per operation.**

| Operation and agent | Claim taken | Success settles | Failure paths |
| --- | --- | --- | --- |
| spawn, prepared agent (OpenCode), any runtime | in the reservation | after `confirmLaunch`: today's write (`:2360-2364`) keeps `session.metadata` and loses `...CLEARED_LAUNCH_CLAIM`; then `settleOwnClaim(own.identity(), ownClaim)` | before or in `create` with a plain error: the ordinary rollback deletes the record, with the claim. A partial (set runtime): 5.2.3, `keepUnconfirmedLaunch` settles. A post-create failure (`postLaunchSetup`, `confirmLaunch`, a write): the rollback; when it keeps the launch (a set runtime, or an unconfirmed stop of any runtime), `keepUnconfirmedLaunch` settles; a confirmed stop deletes the record. The handle write (set runtime, r11) is a publication: written, also after an attempt that threw or answered `null`, goes on; not own: the rollback removes nothing and settles nothing; unwritable: the rollback's step 0, the unwritable path above. The record unreadable at the rollback's step 1: the unwritable path above. Not own: nothing to settle |
| spawn, unprepared agent, set runtime | in the reservation | after today's last write of the success `try` (`:2365-2366`, after `postLaunchSetup`): `settleOwnClaim(own.identity(), ownClaim)` | as above |
| spawn, unprepared agent, other runtime | none | — | — |
| start (orchestrator), both workspace modes | as spawn | as spawn (`:2913-2920`) | as spawn; the prompt file stays when the launch is kept (today) |
| restore, set create runtime, any agent (also a prepared one: restore calls neither `prepareAgentSession` nor `confirmLaunch`) | in the transition write | after step 11, also after a caught `postLaunchSetup` exception: `settleOwnClaim(launchIdentity(owned), ownClaim)` | step 8 failure and step 9 plain error: the transition write-back (it compares `publishedClaim`, and clears the claim only with a non-null `ownClaim`). Step 9 partial: the partial publication, then the settlement on the new identity. Step 9 partial or step 10 unwritable: the unwritable path. Step 10 not own (proved by the rule's strict read; r11: a `null` alone is not): nothing to settle |
| restore, other create runtime | none (today) | — | — |

**When the settlement write throws.** Spawn and start: the success write is part of the `try`, as today's
clear is, so the error goes to the existing catch (for a set runtime: a kept failed launch, whose
`keepUnconfirmedLaunch` tries the settlement again). In `keepUnconfirmedLaunch` and in restore: warn once,
"ao: the launch claim of <id> may remain (<error>); while ao process <pid> (start <launchPidStart>) runs, AO
treats the launch as in progress" (r11: "may remain", because a write that throws can take effect), remove
nothing more, and go on (restore returns its result). No resource is removed because of a settlement.

A crashed launch leaves a claim of a dead process: `liveLaunchOwner` answers `null`, and G, kill and F-9 judge
the record by its handle (P: `create-incomplete`).

### 4.6 Dispatch by the handle's runtime, per site (sol m-3)

`runtimeForHandle(handle, fallback)`: a registered `handle.runtimeName` gives that plugin; a `runtimeName` in
the set that is not registered gives `null`; any other case gives the site's `fallback` (today's runtime of
the site).

| Site | Today (fit-1 tip) | fit-2, handle runtime registered | Not registered, runtime in the set | Not registered, other runtime | Test |
| --- | --- | --- | --- | --- | --- |
| Start: probe of the project-mode record (`:2527`) and of the concurrent branch (`:2588`) | project's runtime | the handle's | unknown: blocked | project's runtime (today) | T-7.8, T-7.8b |
| Start: `stopOrchestratorOrRefuse` (`:2484-2496`) | project's runtime | the handle's | unconfirmed: refuse | project's runtime (today) | T-7.8 |
| Restore step 7 (`:4491-4514`) | project's runtime | the handle's | unknown: refuse | project's runtime (today) | T-7.8c |
| Kill (`:3094-3125`) | `handle.runtimeName ?? project's runtime`; a missing plugin skips the stop and the kill goes on | the same | **refuse**: `RuntimeStopUnconfirmedError` (`unknown`, "no runtime plugin <name> is loaded"); nothing removed | **today's skip, kept**: the stop is skipped, the kill goes on | T-7.8d |
| List enrichment (`:1532-1536`) | the handle's, else the project's runtime | the handle's | no probe; the stored status stays | project's runtime (today) | T-7.8d |
| Cleanup, the rule "runtime is dead" (`:3436-3440`) | project's runtime | the handle's | no probe; this rule kills nothing | project's runtime (today) | T-7.8e |
| G, the reuse decision, the probes for message M | — | the handle's | unknown | — | 5.3 |
| Unchanged (already by the handle): send (`:3639-3648`; a missing plugin throws), `openCodeHolderReason` (`:1098`; unknown), the lifecycle (`lifecycle-manager.ts:559-562`) | | | | | |
| Unchanged (the runtime that made the handle): the rollback stops of spawn (`:2373`) and start (`:2676`), restore step 10 (`:4604`) | | | | | |

A new launch still creates through the project's selected runtime.

### 4.7 The classifier, the reuse predicate R and the blocking kinds (core, exported)

`classifyOrchestratorLiveness(runtime | null, handle)` returns `alive`, `ended` (with a reason) or `unknown`
(with a reason). Each probe has a core bound, `probeTimeoutMs` (10 000): no answer in time is `unknown` ("the
<runtime> check did not answer within 10 s").

| Answer | Runtime outside the set | Runtime in the set (herdr) |
| --- | --- | --- |
| no plugin (`runtimeForHandle` gave `null`) | unknown | unknown |
| `isAlive` `true` | alive | alive |
| `isAlive` `false` | ended | **unknown** (OQ-F1 (b)) |
| rejects with `RUNTIME_NO_SERVER_ERROR_CODE` | ended | **unknown** |
| rejects otherwise, not a boolean, no answer in time | unknown | unknown |

**R, the reuse predicate** (one function, used by G and by `findReusableOrchestrators`). A known-Herdr
orchestrator record is reusable when, read strictly under A in the deciding round:

- **R1** it has no live launch owner (`liveLaunchOwner` is `null`);
- **R2** its `runtimeHandle` parses to an object with a string `id`, a `runtimeName` in the set and an object
  `data`;
- **R3** the handle has no `data.createIncomplete`;
- **R4** the record has no `launchFailed`;
- **R5** `handle.runtimeName` equals the project's selected runtime (OQ-F4 (a));
- **R6** its persisted `status` is not in `TERMINAL_STATUSES`;
- **R7** a probe of this launch (the same identity token, 4.8) answered `alive`.

G of a start adds **R8**: the record is the project-mode ID `<prefix>-orchestrator`, the workspace mode is
`project`, and the strategy is `reuse` or `ignore`. The reuse-only decision has no R8: it accepts any
workspace mode and any strategy, as the CLI does today.

**Blocking kinds** (`BlockingLaunch.kind`): `in-progress` (R1 fails), `damaged` (R2 fails), `create-incomplete`
(R3), `not-reused` (R4, R5, R6 or R8 fails; `reason` names which: "its launch failed", "the project now
selects <runtime>", "its status is <s>", "an isolated record", "the workspace mode is now <m>", "the strategy
<s> would stop it, and a Herdr stop cannot confirm before RH"), `unproven` (R7: the probe answered anything but
`alive`).

### 4.8 The identity token

`launchIdentityToken(record)` (core `metadata.ts`, next to `launchIdentity`; exported from `index.ts`): the
first 16 hex characters of SHA-256 over `JSON.stringify(LAUNCH_IDENTITY_KEYS.map((key) => record[key] ??
""))`. It changes with a reservation, a spawn, a restore (transition and success writes), a partial-handle
write and a relaunch claim (its `restoredAt`). A status, `launchFailed`, claim or retire-key write does not
change it. Message M, the Herdr kill refusal and `ao status` print it; F-9 needs it; the reuse decision uses it
as the key of its probe answers. It is not a secret.

**Name.** The relaunch branch writes a record key `launchToken`: a random token that it gives to the agent
(section 6). So fit-2 says "identity token" everywhere and writes no key named `launchToken`. r8's
`launchToken(raw)` is renamed.

### 4.9 The admission subject and lock A (sol M-1)

`admissionLock(sessionsDir): { subject, name }` (core `delivery-lock.ts`), with `name =
deliveryLockName("admission", subject)`; `"admission"` joins the kind union.

**The subject.**

1. `current = resolve(sessionsDir)`; `missing = []`.
2. `realpathSync(current)` succeeds: `subject = join(<real path>, ...missing)` (in path order). Done.
3. It fails with `ENOENT`, and `lstatSync(current)` also fails with `ENOENT`: put `basename(current)` at the
   front of `missing`, set `current = dirname(current)`, go to 2. At the root: refuse.
4. Any other result refuses: `realpathSync` fails with `ENOTDIR`, `EACCES`, `ELOOP`, `ENAMETOOLONG`, `EIO` or
   another code; or `realpathSync` fails with `ENOENT` while `lstatSync` finds the entry (a dangling symlink).
   The refusal is `OrchestratorStartBlockedError` with `reason: "admission-path"`: "AO cannot fix the
   admission path of project <p> (<code> at <path>); no orchestrator was started."

**Why it is invariant.** AO creates a missing sessions directory with `mkdirSync(..., { recursive: true })`,
which makes real directories. After that, the real path of the directory is the real path of the earlier
nearest existing ancestor plus the same suffix. So a caller before and a caller after the `mkdir` get the same
subject and the same name (`r9_admission_subject_check.txt`).

**Fixed for the operation.** Each admission path (5.3.1) computes the subject once, before it takes A, and
every check of the operation uses it:

- Under A, a start creates the directory when it is missing, then requires `realpathSync(sessionsDir) ===
  subject`. A difference releases A and refuses (`admission-path`); the empty directories that it made stay,
  and the message names them.
- Directly before the reservation (a start), and before the copy-back and the transition write (a restore),
  with no await in between, the same check runs again.
- A reuse-only decision and a restore make no directory. When the directory exists, they make the check; when
  it does not exist, there is no record to decide on.

**Residual R-A.** A rename or a symlink swap of a component of the state directory by another party, during
two simultaneous starts, can still put two admissions into one physical directory under two names: the last
check and the `link` are two system calls. AO itself makes no such change. OQ-F9.

## 5. The items

### 5.1 F-3: a blocked agent is a refusal (W-3)

**Files.** runtime-herdr `index.ts` (`SETTLED_STATES` `:71`, `waitForSettledAgent`, `sendMessage` `:561-603`);
core `session-manager.ts` (the send retry `:4025-4046`); CLI `send.ts` (`:356`).

**Before.** `blocked` counts as settled, so AO prompts a blocked agent; herdr answers `agent_blocked` (exit
1); core forces a restore, which refuses, and `ao send` prints a stack trace that names the restore
(`ao_send_blocked`).

**After.**

- `SETTLED_STATES` = `idle`, `done`. `waitForSettledAgent` stops at the first poll that shows `blocked`.
- `sendMessage` throws `RuntimeSendRefusedError` (`reason` `agent_blocked`) when: (1) the first settle wait sees
  `blocked` (`admitted` `none`, stage "first settle wait"); (2) an `agent prompt` answers the F1 `agent_blocked`
  (`herdrCode` from fit-1's wrapper; `admitted` `none` for attempt 1, `earlier-attempt-unconfirmed` after an
  earlier prompt of this call; stage "agent prompt, attempt n"); (3) the settle wait after a prompt sees
  `blocked` (`earlier-attempt-unconfirmed`, stage "settle wait after attempt n").
- After a refusal: no `send-text` and no `send-keys` (raw text and Enter could answer the permission prompt).
- In `promptWasConsumed` (from `idle`), `blocked` stays "consumed": a delivery, not a refusal.
- Core `send` (`:4025`): `isRuntimeSendRefusedError(err)` throws it unchanged, before the restore retry.
- CLI `send.ts:356`: catch the refusal, print one line to stderr, exit 1: `ao send: <session>: not sent: the
  agent in herdr pane <pane> is blocked and waits for input (agent_blocked). Answer it in the pane (ao session
  attach <session>), then send again.` With `earlier-attempt-unconfirmed`, add `An earlier prompt of this send
  may have been delivered; check the pane before you send again.` No stack.

W-4 (duplicate delivery from `done`) stays open for the later send round.

**Oracle change.** runtime-herdr `index.test.ts:363` "treats blocked as settled — a prompt is how you answer a
blocked agent": old: an `agent prompt` is sent; new: a refusal, `admitted` `none`, zero `agent prompt`, zero
`send-text`, zero `send-keys`.

| ID | Test | Expected |
| --- | --- | --- |
| T-3.1 | The first settle poll answers `blocked` | refusal, `none`, stage "first settle wait"; zero prompts, zero raw input |
| T-3.2 | Gate `idle`; attempt 1 answers the `blocked_herdr_agent_prompt` line | refusal, `none`; one prompt; zero raw input |
| T-3.3 | Attempt 1 succeeds, no consumption is seen, the settle wait after it answers `blocked` | refusal, `earlier-attempt-unconfirmed`, stage "settle wait after attempt 1"; one prompt; zero raw input |
| T-3.4 | Attempt 2 answers `agent_blocked` | refusal, `earlier-attempt-unconfirmed`, stage "agent prompt, attempt 2"; two prompts; zero raw input |
| T-3.5 | Control: from `idle`, the consumption poll shows `blocked` | delivered; one prompt |
| T-3.6 | Core `send` with the refusal, once with each `admitted` value | zero `restore`; the error keeps `code` and `admitted`; control: another send error keeps the one restore retry |
| T-3.7 | CLI with each `admitted` value | exit 1; exactly the one or two sentences above on stderr; nothing on stdout; no stack |

### 5.2 F-4: a failed create closes nothing and keeps everything (W-5a, r6 M-1, r7 M-2, sol M-3)

**Files.** runtime-herdr `index.ts` (`create` `:428-512`, `writeLaunchScript` `:233`); core `herdr.ts`
(`herdrPreRequestRefusal`, `compatible` in `resolveHerdrEndpoint`); core `session-manager.ts` (the worker catch
`:2290-2295`, the orchestrator catch `:2853-2856`, `rollbackLaunch` `:1874-1960`, `keepUnconfirmedLaunch`
`:1971-2011`, `recordMayOwnRuntime` `:1692`, the success paths, restore `:4286-4646`, P and the claims of 4.4
and 4.5).

**Before (fit-1 tip).** A failed `pane run` closes the new workspace by its ID with no check and throws a plain
error. Core's catch runs `rollbackLaunch` without the runtime and the handle, so it discards the prepared agent
session, removes the worktree and releases the reservation, while the agent may run.

#### 5.2.1 The plugin's create steps

| Step | Failure | Result | Script |
| --- | --- | --- | --- |
| 1. `resolveHerdrEndpoint` (fit-1; r10 states its new fields below) | any failure; `running !== true` (fit-1 text "no herdr server runs at <socket>; start one: herdr server"); **`compatible !== true`** (new: "the herdr server at <socket> is not compatible with this herdr client (version <v>, protocol <n>); restart it with this herdr") | plain error (Q0) | none written |
| 2. `workspace create` | Q1 or Q2 (4.3), command ID `cli:workspace:create` | plain error with `herdrCode` (and the no-server `code` for Q1) | none written |
| | any other failure: another F1 code or text, the 0.8.0 exit-0 error envelope, Rust text, a timeout, a signal, another exit | partial, `workspace-unconfirmed`, handle `id` `""` | none written |
| 3. the answer | no text `workspace_id`; no root pane in the pane grammar; no non-empty text `terminal_id` | partial, `workspace-unconfirmed`, with what parsed; the message keeps "returned no usable pane" | none written |
| 4. `writeLaunchScript` | throws | partial, `launch-not-submitted` | none, or a partial file that the plugin removes |
| 5. `pane run <P> bash <script>` | Q1 or Q2, command ID `cli:request` | partial, `launch-not-submitted` | removed |
| | any other failure (also F1 `pane_not_found` after the request, section `r8_pane_run_pane_not_found_after_request`) | partial, `launch-unconfirmed` | **kept** |
| 6. `pane get <P>` (new) | not P with terminal T of step 3: `pane_not_found`, another terminal (kept as `terminalAfterRun`), any failure | partial, `launch-unconfirmed` | kept |
| | P with T | success: the handle | the script removes itself |

The partial handle: the fields of a success handle (`id` P, `workspaceId`, `paneId`, `terminalId`,
`sessionId`, `workspacePath`, `createdAt`, `herdrBin`, `herdrSocket`), plus `createIncomplete: <stage>` and,
when known, `terminalAfterRun`. For `workspace-unconfirmed`: `id` `""` and what parsed. The messages:
`workspace-unconfirmed` "herdr workspace create did not confirm a workspace for session <s> (<cause>); AO
closed nothing" (or step 3's "... returned no usable pane ..."); the launch stages "Failed to launch agent in
herdr pane <P> (<stage>): <cause>. Workspace <w>, terminal <T>, socket <socket>. AO closed nothing." `<cause>`
is the F1 code and text, or "transport failure: <first stderr line>". `create` has no `workspace close` and no
`pane close`.

Step 6 is a check, not a binding (RH B-2 stays open): it makes a restart between `workspace create` and `pane
run` visible; a restart after it is not seen.

**The new `HerdrEndpoint` fields** (r10, sol m-3: the oracles in 5.2.7 depend on them). `compatible: boolean`
is `true` only when the JSON field is exactly `true` (`null` and a missing field give `false`); `version:
string | null` and `protocol: number | null` are the JSON values when they have that type, else `null`. The
resolver checks the binary, `running` and the socket first, as fit-1 does, and never rejects on the new
fields: step 1 of `create` (Q0) and `preflight()` check `compatible`.

#### 5.2.2 Core: the worker and orchestrator catches

Worker (`:2290-2295`):

```ts
} catch (err) {
  if (isRuntimeCreatePartialError(err)) {
    await rollbackLaunch({ own, prepared, workspace: spawnWorkspace(), runtime: plugins.runtime,
      handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle), ownClaim });
  } else {
    await rollbackLaunch({ own, prepared, workspace: spawnWorkspace() });   // today's plain-error path
  }
  throw err;
}
```

Orchestrator (`:2853-2856`): the catch calls `rollbackOrchestratorLaunch` (`:2670`), which already passes
`runtime: plugins.runtime` and the workspace of isolated mode to `rollbackLaunch`. Its `failed` argument gets
two more optional fields, `partialRecord` and `ownClaim`, which it passes on:

```ts
} catch (err) {
  await rollbackOrchestratorLaunch(systemPromptFile, isRuntimeCreatePartialError(err)
    ? { prepared, handle: err.handle, failure: err, partialRecord: launchedRecordFor(err.handle), ownClaim }
    : { prepared });                                                     // today's plain-error path
  throw err;
}
```

The post-create catches of the orchestrator (`:2925`, `{ handle, prepared, failure: err }`) and of the worker
(`:2368-2379`) pass `ownClaim` too, so that `keepUnconfirmedLaunch` can settle (4.5). **The handle write** (r11,
sol M-1): for a create runtime in the set, the success path's handle write (`:2343`, `:2894`) is the
publication `own.publish({ ...launchedRecordFor(handle), [RESERVATION_KEY]: "" }, "the spawn started its
runtime")` (start: "the start started its runtime") of 4.5. Its fixed identities come from `owned` before the
write. Not own throws today's `recordChangedError`; unwritable throws `LaunchRecordUnwritableError`; both go to
the post-create catch, which passes the error as `failure` (5.2.3 steps 0 and 1). The post-create catches pass
no `partialRecord` (r10's flag `handlePublished` is removed): a handle write that threw and took effect is
written, and one that did not is retried, by the rule itself. For a runtime outside the set the handle write
stays today's `own.write`. `launchedRecordFor(handle)` is the record that the success path writes today
(worker `:2321-2343`, orchestrator `:2879-2894`), moved into one local function per path.

**The rollback argument** (r10, Muse m-4 (ii)). The `rollback` argument of `rollbackLaunch` (`:1874-1882`)
and of `keepUnconfirmedLaunch` (`:1971-1977`) gets two optional fields: `partialRecord?: Record<string,
string>` (r11: given only with a `RuntimeCreatePartialError`) and `ownClaim?: LaunchClaim | null`.
`rollbackLaunch` passes both on to `keepUnconfirmedLaunch`.

**The pre-create write** (r10, sol m-4). For a launch whose create runtime is in the set and whose agent has no
`prepareAgentSession`, spawn and start write the launch fields directly before `plugins.runtime.create`,
inside the `try` whose catch is today's plain-error rollback: `own.write(fields, "the spawn stored its
launch")` (start: "the start stored its launch"). `fields` are those of today's prepared write without the
prepared metadata: worker (`:2259-2275`) `worktree`, `branch`, `status: "spawning"`, `tmuxName`, `issue`,
`project`, `agent`, `model`, `permissions`, `createdAt`, `[RESERVATION_KEY]: ""`; orchestrator
(`:2818-2832`) `worktree`, `branch`, `status: "working"`, `role: "orchestrator"`, `tmuxName`, `project`,
`agent`, `createdAt`, `[RESERVATION_KEY]: ""`. `createdAt` goes into the variable that the prepared path
uses today (`preparedCreatedAt`, renamed `preCreateAt`), so `launchedRecordFor` writes the same value. The
write merges, so P and the claim stay. A `null` or a throw here fails the launch before `create`: today's
plain-error rollback (nothing exists in the runtime yet). A prepared launch keeps today's write; a launch
whose create runtime is outside the set writes nothing new.

#### 5.2.3 Core: `rollbackLaunch` for a runtime in the set

When `rollback.runtime` and `rollback.handle` are given and `isLaunchEndUnproven(handle.runtimeName)` (a
partial error, or a post-create failure of a Herdr launch):

0. (r11, sol M-1 and M-2) `rollback.failure` is a `LaunchRecordUnwritableError` of this launch's handle
   publication: the unwritable path of 4.5 with that error's fixed `before` and `after` (no further write
   attempt); return `{ stopUnconfirmed: true }`.
1. `own.checkOrUnknown()` (r11: r10's adoption in this step is removed; the rule of 4.5 adopts, with the fixed
   `after`). Own: go on. Gone or replaced (proved by this strict read): remove nothing (no stop, no
   agent-session discard, no workspace removal, no release), write nothing, settle nothing; warn once with
   the handle (pane, workspace, socket), the worktree, the agent session and the record state; return `{
   stopUnconfirmed: true }`. This also covers the post-create path where today a replaced record keeps the
   runtime but the rollback still discards the agent session (`:1907-1922`), and a handle publication that
   ended not own. Unknown (the record cannot be read; r10, sol M-1): the unwritable path of 4.5 with `before =
   own.identity()` and no `after`; return `{ stopUnconfirmed: true }`.
2. With `partialRecord` (a partial error): `own.publish({ ...partialRecord, runtimeHandle:
   JSON.stringify(handle), [RESERVATION_KEY]: "" })` by the rule of 4.5; it replaces P, and `own` advances
   (written or adopted). Not own: as step 1, gone or replaced. Unwritable: the unwritable path of 4.5 with this
   publication's fixed identities; return `{ stopUnconfirmed: true }`.
3. `stopRuntime(runtimeForHandle(handle, rollback.runtime), handle)`. Herdr answers `unknown`, so
   `keepUnconfirmedLaunch` runs: today's `launchFailed` write (identity compare; a throw stays a sentence of
   its warning, as today), then `settleOwnClaim(own.identity(), rollback.ownClaim)` (4.5), and the rollback
   ends with nothing removed.
4. A confirmed stop (a later RH-B) goes on as today.

For a runtime outside the set, `rollbackLaunch` keeps today's steps. One change applies to every runtime:
after its `launchFailed` write, `keepUnconfirmedLaunch` settles the own claim with `settleOwnClaim` (today it
keeps the claim).

`recordMayOwnRuntime` (`:1692`): a record whose stored handle has `data.createIncomplete` answers `true` (4.4).

The orchestrator's prompt file stays when the launch is kept (`stopUnconfirmed`, today).

#### 5.2.4 Restore (sol m-1, sol M-3)

For a record whose create runtime (`plugins.runtime`) is in the set; the steps of today keep their numbers.

**Scope** (r10, Muse m-3). Steps 6a and 7b concern orchestrator records only (`isOrchestratorSessionRecord`).
A worker restore takes no A (L-3): it runs 6b and 7a without A, and the record lock and the compare of each
write (the launch identity and the claim) are its only atomicity. The step-7 rule for a damaged handle
below applies to every record.

1. Steps 1 to 6 as today (no write). `assertNoLiveLauncher` (`:4323`). Before step 6 ends: `ownClaim = await
   readLaunchClaim()` (it may be `null`, 4.5).
2. **6a.** An orchestrator record: the admission in restore mode (5.3.2). The subject, then A; G without this
   ID; any selected record blocks; no probe. Busy, unsupported, path: refuse, nothing written.
3. **6b.** From an archive: the copy-back (`:4459`); for an orchestrator, under A and after the subject check.
4. **7.** `stillOwned` (today). Then the stop of the old handle through `runtimeForHandle(oldHandle,
   plugins.runtime)` (4.6); under A it has the 10 s core bound. Not confirmed: refuse as today
   (`releaseCopyBack`), release A. **A damaged handle** (r10, Muse m-3): when the record has a `runtimeHandle`
   text that gives no handle (`safeJsonParse` answers `null`), today's step 7 skips the stop (`if
   (session.runtimeHandle)`, `:4501`). fit-2: when `isUnprovenLaunchRecord(raw, plugins.runtime.name)`
   accepts the record (its text names herdr, or the project's runtime is in the set: 5.3.3), restore refuses
   here like an unconfirmed stop (`unknown`: "the runtime handle of <id> cannot be read (<first 80
   characters>); retire it by hand", 5.4.4), with `releaseCopyBack`. Reason: G of a restore leaves out the
   restored ID because step 7 stops or refuses the old launch; a skipped stop would let a second launch start
   next to a Herdr launch that no handle names. Else today's skip stays (a tmux project whose damaged text
   does not name herdr; no P is written there). A record with no `runtimeHandle` keeps today's skip (L-2).
5. **7a. The transition write.** For an orchestrator, the subject check first. `readClaim = { launchPid:
   owned.launchPid ?? "", launchPidStart: owned.launchPidStart ?? "" }`, then `updateMetadataIf(sessionsDir,
   id, { ...launchIdentity(owned), ...readClaim }, { runtimeHandle: JSON.stringify(P), restoredAt: <now>,
   ...(ownClaim ?? {}) })`. `null`: throw `recordChangedError(..., "its old runtime was stopped; no runtime
   was created")`, release A. Keep `before = { runtimeHandle: <its value before>, restoredAt: <its value
   before> }` and `publishedClaim = ownClaim ?? readClaim` (4.5); `owned` = the written record.
6. **7b.** Release A. From here on, P and the claim carry the protection: a start's G sees the restore
   (`in-progress`, or `create-incomplete` when no claim could be read).
7. **8.** The workspace restore (today), outside A. A throw: the **transition write-back** (r10, sol m-1),
   `updateMetadataIf(..., { ...launchIdentity(owned), ...publishedClaim }, { runtimeHandle:
   before.runtimeHandle, restoredAt: before.restoredAt, ...(ownClaim ? CLEARED_LAUNCH_CLAIM : {}) })` (an empty
   value removes the key). It compares the exact claim state that 7a published, and it clears claim keys only
   when the restore took its own claim; with `ownClaim` `null` it leaves every claim value as it is. `null`
   (the launch or the claim state changed, or the uncertain `null` of `metadata.ts:663`) or a throw: warn
   ("AO could not write back the record of <id>; it may keep the pending handle of this restore and this
   process's launch claim; check runtimeHandle, restoredAt, launchPid and launchPidStart, then retire it with
   F-9"; r11: no unproved state as a fact; in fit-2a "retire it by hand"). Then throw today's
   `WorkspaceMissingError`. The copy-back stays
   (today's behavior after a step-8 failure). After step 8, `stillOwned` (today): a change throws
   `recordChangedError` with no write-back (not own).
8. **9.** `create`. A plain error (Q0, Q1, Q2): the transition write-back of step 8, then throw the error. A
   `RuntimeCreatePartialError`: the publication (4.5) of `{ status: "spawning", runtimeHandle: <partial>,
   launchFailed: <cause, at most 600 characters> }`, with `before = launchIdentity(owned)` (the transition
   record) and its fixed `after`. Written (the attempt or the retry took effect, or it returned the record):
   `owned` := that record, then `settleOwnClaim(launchIdentity(owned), ownClaim)`. Not own (proved by the
   rule's strict read): add "its runtime <pane> at <socket> was kept; check it by hand" to the error; no
   settlement. Unwritable: the unwritable path of 4.5 (r11: the final settlement tries `before`, then
   `after`). Throw the partial error.
9. **10.** The success write (today: a compare on the launch identity, here `owned` after 7a), by the
   publication rule with its fixed `before` and `after` (r11, sol M-1 and M-2). Written (the attempt or the
   retry took effect, or it returned the record): `owned` := that record; go on. Not own (proved by the
   rule's strict read; r11: a `null` alone is not): today's path (`recordMayOwnRuntime`: keep; the Herdr stop
   answers `unknown`: keep), and nothing to settle. Unwritable: the unwritable path of 4.5; throw "the restore
   of <id> created herdr pane <pane> (workspace <w>, socket <s>); AO could not confirm that its record holds
   it: <error>"; the runtime, the workspace and the agent session stay.
10. **11.** `postLaunchSetup` (nonfatal, today).
11. **12.** `settleOwnClaim(launchIdentity(owned), ownClaim)`. A throw: warn (4.5); `null`: nothing. Return the
    session.

For a create runtime outside the set: today's steps, with the dispatch of 4.6 and the damaged-handle rule at
step 7; an orchestrator record holds A for 6a and 6b only.

A second restore of a record with P or a partial handle stops at step 7 (Herdr `unknown`) and creates nothing.

#### 5.2.5 The record state "kept failed launch"

An active record with the partial handle (`createIncomplete`), `launchFailed`, the launch's normal keys
(`worktree`, `branch`, `agent`, `createdAt`; `status` `spawning` for a worker and a restore, `working` for an
orchestrator), the prepared agent session's keys, and **no launch claim** (4.5). The worktree, the agent
session, the prompt file (orchestrator) and, for `launch-unconfirmed`, the launch script stay.

A **crashed launch** (the `ao` process ended inside the launch; r10, sol m-4) leaves P (`create-pending`), a
dead claim and the launch fields of the pre-create write (5.2.2) or of a prepared launch: `worktree`, `branch`,
`agent`, `createdAt`, `status`, `role` (orchestrator) and the prepared agent session's keys. It has no
`launchFailed` and no partial handle (only `create` returns one), so it holds no pins, no herdr workspace or
pane ID, no terminal ID and no launch script path. F-9 removes the managed worktree that `worktree` names and
keeps the agent session (5.4.2); it cannot find the herdr workspace and pane, the endpoint or a launch script
that never ran (`$TMPDIR`). 5.4.3 steps 3 and 4 give the search by hand. A launch that crashed before its
pre-create write (inside the workspace plugin or the agent preparation) has only the reservation fields: P,
`role` and the claim; the worktree path is then the managed path of the session ID
(`~/.agent-orchestrator/<hash>-<project>/worktrees/<id>`), which the owner checks by hand. No herdr call has
run then.

#### 5.2.6 The consumers of a kept failed launch

| Consumer | Behavior after fit-2 | Test |
| --- | --- | --- |
| `ao status`, `get`, `list` | The stored partial handle stays. The line `launch failed: <text> (identity token <t>)` (5.5). A grammar pane ID that answers `false` may enrich the shown status to `killed`/`exited` (memory only); a rejected probe (empty ID, no server) keeps it. The 600-character cap applies to `launchFailed` only; pane, workspace, socket and stage stay readable in the stored handle | T-4.12 |
| `ao session kill` (no F-9) | After the launcher check, the Herdr stop answers `unknown` (no call, also for an empty ID or malformed pins), and the kill refuses before the worktree removal and the archive; the hint names F-9 with the identity token | T-4.11 |
| `ao session cleanup` | Orchestrators are skipped; a live launcher is skipped; a worker that reaches `killRecord` meets the same refusal. Cleanup never passes `confirmRuntimeClosed` | T-4.13 |
| `ao session restore` | Step 7 stops through the handle's runtime (4.6): Herdr `unknown`, so restore refuses before any workspace or runtime step | T-4.10, T-4.10b |
| `ao start` | G blocks it (`create-incomplete`); the reuse decision never reuses it (R3) | T-7.5 |
| Lifecycle | Probes may change the shown or persisted status; they call no kill, cleanup or restore. G does not read status | T-7.1 |
| `ao send` | No special policy (OQ-F5 (a)). `prepareSession` may try a restore when enrichment says exited or no agent; that refuses for Herdr. A `launch-unconfirmed` partial whose pane runs the agent with terminal T passes readiness and **receives the send**. An empty-ID partial waits for readiness, then `sendMessage` rejects with no call. A partial whose terminal changed answers `isAlive` `false`, so the send path tries a restore, which refuses | T-4.14 |

**Owner recovery of a kept failed launch.** Check it as 5.4.3 says, close the pane by hand when it belongs to
this launch, then F-9 with the identity token.

#### 5.2.7 Oracle changes

| Test (fit-1 tip) | Old oracle | New oracle |
| --- | --- | --- |
| runtime-herdr `index.test.ts:178` "closes the workspace when the launch fails, leaving nothing in the shared server" | `argsOf(3)` is `workspace close w7` | zero `workspace close` and `pane close`; `RuntimeCreatePartialError`, `launch-unconfirmed` (a plain `Error` of `pane run` is not Q), handle `w7`, `w7:p1`, `term_abc`, the pins; the script file kept; the message still matches `/Failed to launch agent/` |
| `index.test.ts:189` "surfaces a herdr error body even though the CLI exits 0" | rejects `/workspace_create_failed.*no such dir/` | the same text, now in a partial `workspace-unconfirmed`; two calls |
| `index.test.ts:199` "throws when the response carries no usable pane" | rejects `/no usable pane/` | the same text; a partial `workspace-unconfirmed` with `workspaceId` `w7` |
| the create tests of `index.test.ts` (`:127`, `:146`, `:164`; fit-1 indices: call 0 status, 1 create, 2 run) | three calls | a fourth call `pane get` (index 3) that answers P with T; calls 0 to 2 unchanged; `STATUS_RUNNING` of `index.test.ts` (`:50-58`) gets `"compatible":true` (r10, sol m-3: the only status mock that lacks it; `statusRunning()` reads `closedpane_status_server_json.json`, which has it) |
| runtime-herdr `fit-pins.test.ts:91-100` `pinnedHandle()` (r10, sol m-3) | queues status, create, run | a fourth reply, `PANE` (`:60-67`: `w7:p1` with `term_abc`), for the post-run `pane get`; the later tests that use the handle are unchanged |
| `fit-pins.test.ts:102-123` "T-6.1: runs status server --json with the absolute path on PATH and stores both pins" (r10, sol m-3) | three calls: status, workspace create, pane run, each later one with the pins | the fourth reply `PANE`; four calls, the last `["pane", "get"]`; the loop over the calls after the first asserts the pins of the fourth call too (`standIn.bin`, `HERDR_SOCKET_PATH` = `STATUS_SOCKET`) |
| `fit-pins.test.ts:125-137` "closes a workspace of a failed launch with the pins (the cleanup of today, until fit-2 F-4)" (r10, sol m-3) | `workspace close w7` as call 3, with the pins | renamed "keeps a workspace of a failed launch: a typed partial with the pins and no close"; `pane run` rejects with a plain `Error`; exactly three calls; no `workspace close` and no `pane close`; the rejection passes `isRuntimeCreatePartialError`, `stage` `launch-unconfirmed`, `closed` `"nothing"`, `handle.data` with `herdrBin` = `standIn.bin` and `herdrSocket` = `STATUS_SOCKET`; the message still matches `/Failed to launch agent/` |
| `fit-pins.test.ts` T-6.5 (`:212-249`) | rejects before `workspace create` | unchanged: the resolver checks the socket before the new fields, and step 1 checks `running` before `compatible` |
| core `herdr.test.ts:662` and `:691` (`resolveHerdrEndpoint`, `toEqual`) (r10, sol m-3) | `{ bin, socket, running: true }`; `{ bin, socket, running: false }` | `{ bin, socket, running: true, compatible: true, version: "0.9.5", protocol: 22 }` (`closedpane_status_server_json.json`); `{ bin, socket, running: false, compatible: false, version: null, protocol: null }` (`noserver_never_status_server_json.json`) |
| `fit-reads.test.ts` "reads the failure form of every call with its own command ID (workspace create)" | rejects with `herdrCode` `server_not_running` and `code` `ERR_RUNTIME_NO_SERVER`; two calls | the session-form text is not Q1: a partial `workspace-unconfirmed`, `id` `""`, whose `cause` has that `herdrCode` and `code`; two calls. A new sibling test with the exact pinned Q1 text gives the plain error with both codes |
| `fit-reads.test.ts` "reads the pane run failure with the command ID cli:request" | the `workspace close` and a plain error with `cause.herdrCode` `pane_not_found` | a partial `launch-unconfirmed` whose `cause` has `herdrCode` `pane_not_found`; three calls; no `workspace close` |
| fit-1 `T-2.1` create tests (`fit-reads.test.ts`, "T-2.1: create with the root pane <id> throws and makes no further call") | rejects `/no usable pane/`, two calls | unchanged; the error is a partial `workspace-unconfirmed` |
| core tests where `runtime.create` throws a plain error | today's rollback | unchanged |
| core tests of a prepared launch's clear (`:2360`, `:2913`) | the claim cleared after `confirmLaunch` | unchanged result, through today's write and then `settleOwnClaim(own.identity(), ownClaim)` |

#### 5.2.8 Acceptance tests

Plugin tests in runtime-herdr `index.test.ts`. End-to-end tests in a new runtime-herdr file
`src/__tests__/fit2-create-rollback.test.ts`: built core (`createSessionManager`), the real plugin, a stand-in
`herdr` through mocked `node:child_process` (the pattern of `lifecycle-pane-envelope.test.ts`) that keeps its
own state (workspaces made, inputs admitted), a real worktree workspace plugin on a temp git repo, and agent
stand-ins: a Claude Code shape (no `prepareAgentSession`) and an OpenCode shape (`prepareAgentSession`,
`confirmLaunch`, `getRestoreCommand`, `postLaunchSetup`; it records its discards and starts no agent).

| ID | Case | Expected |
| --- | --- | --- |
| T-4.1 | Plugin: each row of 5.2.1 | the stated result and script state; zero `workspace close`, zero `pane close` in every row |
| T-4.1b | Q near misses: `server_not_running` with another socket; with the session-form suffix; with no suffix; `protocol_mismatch` with another text; the 0.8.0 exit-0 envelope; the Q1 text on `pane run` with a socket other than `endpoint.socket` | each is a partial (`workspace-unconfirmed` for create, `launch-unconfirmed` for run) |
| T-4.2 | Worker, before the submission: `writeLaunchScript` throws; and `pane run` answers Q1 | spawn rejects with the partial; zero closes; the worktree exists; zero agent-session discards; the record has the partial handle (not P: r10, Muse m-4), `launchFailed`, `status` `spawning`, and no `launchPid` or `launchPidStart` key; `own` advanced. **D2:** a settlement on the reservation's identity leaves the claim |
| T-4.3 | Worker, a timeout after the admission: the stand-in records the `pane run` admission, then rejects with `killed: true`, `signal: "SIGTERM"` | as T-4.2, `launch-unconfirmed`; the script kept |
| T-4.3b | **Records, then errors (r7 M-2):** `workspace create` makes `w7` in the stand-in's state, then answers F1 `zz_unknown_code`; `pane run` records the admission, then answers F1 `pane_not_found` | create: partial `workspace-unconfirmed`, the worktree, the agent session and the record kept; run: partial `launch-unconfirmed`, the script kept; zero closes |
| T-4.4 | Worker: step 6 answers another terminal | `launch-unconfirmed`, `terminalAfterRun` recorded |
| T-4.5 | Orchestrator, project mode, T-4.2 to T-4.4 | the record `<prefix>-orchestrator` kept with the partial handle; the prompt file kept; the project directory unchanged |
| T-4.6 | Orchestrator, isolated mode, T-4.3 | the worktree and the numbered record kept |
| T-4.7 | The record is replaced during the create (the stand-in rewrites the launch identity before `pane run` answers) | zero closes, zero removals, zero agent-session discards, no write to the new record; one warning that names the pane, the socket, the worktree and the agent session |
| T-4.7b | **Replaced by P (sol m-5, Muse m-3):** a successful create, then `postLaunchSetup` throws after the test replaced the record by a new reservation with P (OpenCode shape) | `recordMayOwnRuntime` is `true`; zero stops, zero agent-session discards, zero workspace removals; the new reservation byte-equal; one warning |
| T-4.8 | Control: discovery succeeds, then `workspace create` answers the exact Q1 text with `endpoint.socket`; and Q2 (both texts) | today's rollback: the worktree removed, the reservation released, the agent session discarded; no herdr call after `workspace create` |
| T-4.8b | Control: `status server --json` answers `compatible: false` (`r8_status_json_ping_protocol_19.json`) | plain error; zero `workspace create`; today's rollback |
| T-4.9 | Control: a successful create (Claude Code shape) | the handle with the pins; one `pane get` after the run; P replaced; no claim left |
| T-4.10 | Restore of a **terminal handleless** record (so step 9 is reached) on a Herdr project; `pane run` times out | the record has the partial handle, `launchFailed`, the new `restoredAt`, no claim; nothing removed |
| T-4.10b | A second restore after T-4.10 | refuses at step 7 (`unknown`); zero `workspace create` |
| T-4.10c | Restore, step 9 answers Q1 | `runtimeHandle` and `restoredAt` as before the restore; no claim; nothing created |
| T-4.11 to T-4.14 | The consumer rows of 5.2.6 | as stated there; T-4.11 with a valid, an empty-ID and a malformed-pin partial; T-4.13 a worker partial with a merged PR and with a pane that answers `pane_not_found`; T-4.14 the three send cases with exact call counts |
| T-4.15 | **In-flight create:** the stand-in never answers `pane run`; the test reads the record while the call waits; worker and orchestrator (isolated); each agent shape (r10, sol m-4) | the record has P (`create-pending`), `role` (orchestrator), a live claim with this process's PID, the launch fields of the pre-create write (Claude Code shape) or of the prepared write (OpenCode shape): `worktree` (the workspace path), `branch`, `agent`, `createdAt`, `status`, and no `reservationId`; no `launchFailed` and no partial handle. **D2:** without the pre-create write the Claude Code shape lacks `worktree`, `branch`, `agent` and `createdAt` |
| T-4.16 | **Resident restore (sol M-3):** in the test process, a restore of a terminal handleless Herdr record with the OpenCode shape (a stored `opencodeSessionId`); the record is the isolated orchestrator record `<prefix>-orchestrator-1` (r10, sol: so that G selects it); create succeeds; `postLaunchSetup` throws once | the restore resolves; the record has the real handle and **no** `launchPid`/`launchPidStart`; then, in the same process: `kill` refuses with the Herdr stop's `unknown`, not `SessionLaunchInProgressError`; a direct core `spawnOrchestrator` in isolated mode is blocked with kind `not-reused` ("an isolated record"), not `in-progress` |
| T-4.16b | As T-4.16, but the settlement write throws (the test makes the record's write fail once) | the restore still resolves; one warning that names the claim; the claim stays; `kill` in the same process refuses as in progress; nothing removed |
| T-4.17 | **Kept post-create failures (sol M-3):** spawn and start (both modes), with each agent shape; `postLaunchSetup` (Claude Code shape) or `confirmLaunch` (OpenCode shape) throws after a successful create | a kept failed launch: `runtimeHandle` equal to the handle that `create` returned (r10, Muse m-4), `launchFailed`, and no `launchPid` or `launchPidStart` key; in the same process `kill` refuses with `unknown` and F-9 is not refused as "in progress". **D2:** a settlement on the reservation's identity (P) leaves the claim |
| T-4.18 | **A later claim survives:** during `postLaunchSetup` the test writes other claim values into the record (another PID and start, no identity change) | after the success settlement those values are byte-equal; the success write of the launch is in the record |
| T-4.19a | **Claimless rollback, workspace failure (r10, sol m-1):** `readLaunchClaim()` answers `null` (mocked); the record holds the claim values of an earlier, dead launch; the workspace plugin throws in `restore` | `WorkspaceMissingError`; `runtimeHandle` and `restoredAt` as before the restore; `launchPid` and `launchPidStart` byte-equal to their values before the restore |
| T-4.19b | As T-4.19a, but step 9 answers Q1 (a plain error) | the error; the same record state as T-4.19a; nothing created |
| T-4.19c | As T-4.19a, and during the pause in `workspace.restore` the test writes other claim values (no identity change) | no write-back: the record keeps P and the later claim values byte-equal; one warning |
| T-4.19d | As T-4.19b, with the later claim-only change during `create` | as T-4.19c |
| T-4.20a | **One-shot success-publication failure (r10, sol M-1):** resident process, OpenCode shape, a terminal handleless isolated orchestrator record; create succeeds; the test makes the next record write throw once (a spy on the metadata writer, or the record lock held for that one write) | the read shows the pending identity; the retry writes; the restore resolves; the record has the returned handle and no claim; one `kill` refuses with `unknown`, not "in progress" |
| T-4.20b | **One-shot partial-publication failure:** as T-4.20a, but create answers a partial (`launch-unconfirmed`) and the partial write throws once | the retry writes the partial handle and `launchFailed`; then the claim is settled; the restore rejects with the partial error; nothing removed |
| T-4.20c | **Persistent failure:** as T-4.20a, every record write throws from step 10 on (each attempt before its effect); the strict reads work | the restore rejects with "... created herdr pane <pane> ...; AO could not confirm that its record holds it"; one warning, the variant "not settled" (r11, Muse m-2): it names this process's PID and start, says that the claim "may remain" and that the record "may hold the pending handle or the handle above", names the pane, terminal, workspace, socket, worktree, agent session and record file, and names `runtimeHandle`, `restoredAt`, `launchPid` and `launchPidStart`; it has no sentence that names another launch; the record keeps P and the claim; in the same process a start is blocked `in-progress` and `kill` refuses as in progress; nothing removed |
| T-4.20d | **Unwritable, then the settlement writes:** the step-10 write and its retry throw before their effect, later writes work | the restore rejects; the record keeps P without a claim; the warning is the variant "settled on `before`" ("... while the record held this launch's state before the write (the pending handle). The handle above is not recorded.") and gives the F-9 line; a start in the same process is blocked `create-incomplete` |
| T-4.20e | **Replacement controls:** (1) the step-10 write throws, and before the read the test replaces the record (a new reservation with P and another claim); (2) the step-10 write takes effect, then throws (the spy throws after the rename) | (1) not own: no retry, no settlement, the replacement byte-equal, the runtime kept, one warning; (2) the read shows the fixed `after`: the restore resolves, the claim is settled, no retry |
| T-4.20f | **Spawn and start handle publication (r11):** spawn (Claude Code shape); (1) the handle write (`:2343`) throws once before its effect; (2) it takes effect, then throws; (3) start (isolated) with (1) | (1) and (3): the strict read shows `before`, the retry writes, and the launch succeeds (r11: no kept failed launch); (2): the read shows the fixed `after`, no retry, and the launch succeeds. Each: the record has the returned handle, no `launchFailed`, and no claim after the success settlement; nothing removed; no warning |
| T-4.20g | **A replacement that matches all but `restoredAt` (r11, sol M-1):** spawn (Claude Code shape); the handle write throws once before its effect; before the strict read, the test writes a replacement record that holds this launch's returned handle H, `createdAt` and `tmuxName`, no `reservationId`, and `restoredAt` T1 (this launch has none); run (i) with another `launchPid` and `launchPidStart`, and (ii) with this process's pair | not own: no retry; the spawn rejects with `recordChangedError`; the rollback's step 1 reads "replaced" and removes nothing (the worktree, the agent session and the runtime stay); the replacement byte-equal (no `launchFailed` write, no claim clear, in both runs); one warning that names the kept handle. **D2:** with r10's adoption (`launchIdentity({ ...current, ...publication })`) the rollback adopts the replacement and writes `launchFailed` into it; in run (ii) it also clears the pair |
| T-4.21a | **The retry takes effect, then throws (r11, sol M-2):** as T-4.20a; attempt 1 of step 10 throws before its effect; the retry writes and then throws (the spy throws after the rename) | the second strict read shows the fixed `after`: the restore resolves with the returned handle; step 12 settles the claim; no warning. **D2:** with r10's rule the retry's throw is unwritable, the settlement on the pending identity answers `null`, the claim stays, and the warning says that the record names another launch |
| T-4.21b | **The partial retry takes effect, then throws:** as T-4.20b, with the partial publication of step 9 | the partial handle and `launchFailed` on disk; the claim settled on the new identity; the restore rejects with the partial error; no warning; nothing removed |
| T-4.21c | **The rollback's partial retry takes effect, then throws:** spawn (Claude Code shape); `pane run` answers a partial (`launch-unconfirmed`); the rollback's step-2 publication throws before its effect, its retry takes effect and then throws | written: `keepUnconfirmedLaunch` writes `launchFailed` and settles; a kept failed launch with the partial handle and no claim; nothing removed |
| T-4.21d | **An uncertain `null` while the record is still own:** as T-4.20a; attempt 1 of step 10 answers `null` without a write because `existsSync(sessionsDir)` answers `false` once (a spy on `node:fs` `existsSync` for that path); the record still holds `before`. Control: attempt 1 answers `null` because the test replaced the record first | the strict read shows `before`; the retry writes; the restore resolves and settles; no not-own path and no warning. Control: not own, as T-4.20e (1). **D2:** with r10's rule the `null` is a proved replacement: no retry, no settlement, and the claim of the resident process stays |
| T-4.21e | **Unwritable after an effect, and a late replacement:** (1) as T-4.20a; attempt 1 throws before its effect, the retry takes effect and throws, and the second strict read throws once; later writes work. (2) attempt 1 throws before its effect, and before the second strict read (after the retry also throws before its effect) the test writes a replacement | (1) unwritable, last read unknown; the settlement on `before` answers `null`, the settlement on `after` clears the claim; the warning variant "settled on `after`" ("The record holds the handle above ..."); the restore rejects; nothing removed. (2) not own: the replacement byte-equal, no settlement, no removal |

### 5.3 F-7: startup admits at most one Herdr orchestrator launch per project

**Files.** core `types.ts`, `index.ts`, `delivery-lock.ts` (the kind, `admissionLock`), `session-manager.ts`
(`spawnOrchestrator` `:2438-2930`, restore of an orchestrator record, `findReusableOrchestrators`, the dispatch
sites of 4.6, `isOrchestratorRuntimeAlive` `:571-603` replaced), `runtime-stop.ts` (`:221`); runtime-herdr
`index.ts` (`preflight`); CLI `start.ts` (`:880-1157`), `spawn.ts` (`runSpawnPreflight` `:67-85`),
`lib/preflight.ts`, `doctor.ts` (comment `:187-192`).

#### 5.3.1 Lock A: who takes it and what runs under it (sol M-1, sol m-1, Muse m-6)

- **Name:** `admissionLock(getProjectSessionsDir(project))` (4.9). Each admission path calls the same function
  for the same project, so all of them use one name for one sessions directory.
- **Who takes it:** `spawnOrchestrator` (both workspace modes, every strategy); `restore` of an orchestrator
  record (`isOrchestratorSessionRecord`); `findReusableOrchestrators`. Worker spawns and worker restores do not
  (L-3).
- **Wait:** `holdDeliveryLock(name, waitMs)` with `waitMs` 30 000 by default. Not obtained in time:
  `OrchestratorStartBlockedError` `reason: "admission-busy"`: "Another ao process is admitting an orchestrator
  for project <p> now. Run ao start again after it ends." Nothing written.
- **Platform without the lock** (`isDeliveryLockSupported()` false): a start or a restore whose create runtime
  is in the set, or whose G1 (read without A) selects a record, refuses (`admission-unsupported`; OQ-F6 (a)).
  A start of a runtime outside the set with no selected record runs as today. `findReusableOrchestrators`
  runs its rounds without A there: it admits nothing.
- **What runs under A:** the subject check and the `mkdir`; G1 (strict reads); G2 (record fields and
  `liveLaunchOwner`, which reads `/proc`); for a start: `validateAndStoreOrigin`, the project-mode
  `setupWorkspaceHooks` (local files), the project-mode branch for a record **outside** the set (today's probe
  and stop through tmux), the reservation with P and the claim; for a restore: the copy-back, the old
  runtime's stop and the transition write.
- **What never runs under A:** any Herdr call (the reuse probe and the probes for message M run between rounds
  or after the last round, 5.3.2); the workspace create or restore; the agent preparation; `runtime.create`.
- **The hold bound.** Each runtime call under A has the core bound `probeTimeoutMs` (10 000; no answer in
  time: unknown for a probe, `unknown` for a stop). A Herdr-only admission holds A for local work only. With a
  tmux record in project mode: at most one probe and one stop, so about 20 s at most (each tmux command also
  has tmux's own 5 s limit). A restore: at most one stop (tmux) or none (Herdr: no call; no handle). The
  default wait (30 s) is longer than the longest hold, so a waiter normally gets A; when it does not, it
  refuses `admission-busy` and creates nothing.

#### 5.3.2 The admission rounds

One procedure for the three modes: `start`, `restore` (with the own ID excluded) and `reuse-only`.

```text
subject, name = admissionLock(sessionsDir)              # refuses admission-path
answers = {}                                            # key: sessionId + identity token
for round in 1, 2, 3:
  hold A (busy: admission-busy)
  start: mkdir -p sessionsDir; every mode: check realpath(sessionsDir) == subject (when it exists)
  G1: select the known-Herdr orchestrator records (strict reads; an error: records-unreadable)
  G2: decide each record from its fields, R1 to R6 (and R8 for a start), and the answers
      a record that passes and has no answer for its identity token: "needs a probe"
  if no record needs a probe:
     start:      any blocking record: release A, then throw records (M, 5.3.8)
                 a reuse candidate with the answer alive: the admitted step "reuse"
                 no Herdr record: the admitted step "launch"
     restore:    any selected record: release A, then throw records; else the admitted step
     reuse-only: release A, return the reusable sessions
     the admitted step runs under A, then A is released
  else:
     release A; probe the records that need a probe, in parallel, each with probeTimeoutMs,
     through runtimeForHandle and the record's pins; answers[id + token] = the classifier's answer
after round 3 with a record that still needs a probe:
  start, restore: throw records-changed; reuse-only: return the records that are reusable, drop the rest
```

- The probe answer counts only for the identity token that was probed. A record that changed between the
  probe and the next round has a new token and needs a new probe (the revalidation of r7 M-1 and sol M-2).
- In the deciding round, R1 to R6 are read again under A. So a record that got a live launcher, a
  `launchFailed`, a `createIncomplete`, another runtime or a terminal status after the probe is not reused,
  also when its identity did not change.
- Only these records can need a probe: a start: the R8 candidate; a reuse-only decision: every record that
  passes R1 to R6. A restore needs none.
- **The admitted step of a start** (under A): `validateAndStoreOrigin`; project mode: `setupWorkspaceHooks`;
  then "reuse": the strict re-read of the candidate, `orchestratorSessionReused=true`, return (r10, sol note:
  the re-read comes after the awaited hooks, so it must still hold the identity token of the deciding round
  and pass R1 to R6; else the round counts as a change, and the next round decides); or "launch":
  project mode: today's branch for a fixed-ID record outside the set (dispatch 4.6, each call bounded), then
  the subject check and the reservation with P; isolated mode: the subject check and the reservation with P.
  The concurrent branch (`:2582-2615`) for a record outside the set keeps today's logic with 4.6; a fixed-ID
  record of the set that appears there is decided by the next round (the start throws `records-changed`
  after round 3).
- **The admitted step of a restore:** 5.2.4 steps 6b to 7b.
- **After a blocked decision,** with A released: each blocking record with a grammar pane ID gets one probe
  (cached answers are reused), in parallel, each with `probeTimeoutMs`, to fill `answer` in message M. These
  probes decide nothing.

#### 5.3.3 G1: the selection

G1 reads every active record (`listRecordIds`, `readRecordStrict` each; an error: `records-unreadable`), keeps
the records that `isOrchestratorSessionRecord(id, raw, prefix)` accepts, and of those the **known-Herdr**
records, whatever their `status`, `activity`, `killedReason` or `launchFailed`, and whatever the project's
runtime is now:

| Record | Known-Herdr when | Kind if it blocks |
| --- | --- | --- |
| `runtimeHandle` parses to an object with a string `id`, a string `runtimeName` and an object `data` | `runtimeName` in the set | by R (4.7) |
| `runtimeHandle` parses but has no string `runtimeName` | the project's selected runtime is in the set | `damaged` |
| `runtimeHandle` does not parse, or has the wrong shape otherwise | its text matches `/"runtimeName"\s*:\s*"herdr"/`, or the project's selected runtime is in the set | `damaged` |
| no `runtimeHandle`, a live launch owner | the project's selected runtime is in the set | `in-progress` |
| no `runtimeHandle`, no live owner | not selected (today's rule; limit L-2) | |

**One predicate** (r10, Muse m-2). Rows 1 to 3 are `isUnprovenLaunchRecord(raw, selectedRuntime)` (4.2), and
the CLI split (5.3.5) uses the same function:

```ts
function isUnprovenLaunchRecord(raw, selectedRuntime): boolean {
  const text = raw["runtimeHandle"];
  if (!text) return false;                                   // rows 4 and 5 are decided apart
  const h = safeJsonParse<unknown>(text);
  if (isWellFormedHandle(h)) return isLaunchEndUnproven(h.runtimeName);           // row 1
  return /"runtimeName"\s*:\s*"herdr"/.test(text) || isLaunchEndUnproven(selectedRuntime); // rows 2, 3
}
```

`isWellFormedHandle`: a non-null, non-array object with a string `id`, a non-empty string `runtimeName` and a
non-null, non-array object `data` (the shape of R2 and of the partial guard, 4.1). G1 selects a record when
`isOrchestratorSessionRecord` accepts it and the predicate accepts it, or when row 4 holds.

#### 5.3.4 Runtime mismatch (r7 M-3, OQ-F4)

Recommended (a): **block.** A Herdr record is never reused when the project now selects another runtime (R5),
and no other runtime probes or stops it (4.6). T-7.8 keeps its oracle "blocked". A tmux record while the
project now selects herdr keeps today's rules (outside G, L-1).

#### 5.3.5 The CLI (`start.ts`, sol M-2)

1. `ensureTmux` runs when `project.runtime ?? config.defaults.runtime` is `tmux` (was `defaults.runtime`).
2. Candidates from `sm.list(projectId)` as today (orchestrator records that are not terminal). fit-1's
   `isHerdrProbeTerminal` hold is removed: a terminal Herdr record is not a CLI candidate, and core G blocks it.
3. The candidates are split, in this order (r10, Muse m-2: by G1's predicate, not by a parsed `runtimeName`
   alone): (a) `isUnprovenLaunchRecord(session.metadata, selectedRuntime)` accepts the record (a well-formed
   handle of a runtime in the set, or a damaged handle that G1 selects): left to core; (b) any other candidate
   with a stored handle (`hasStoredHandle`): a well-formed handle of a runtime outside the set, today's
   `checkOrchestratorLiveness` (without fit-1's Herdr branches); (c) no stored handle (`hasStoredHandle`
   false, also a text that does not parse in a project outside the set that does not name herdr): today's
   `unchecked` rule (OQ-F10).
4. When (a) is not empty: `reusable = await sm.findReusableOrchestrators(projectId)`.
5. `existing` = (b) alive ∪ (c) ∪ `reusable`. Not empty: "Using existing orchestrator session: <id>" for the
   most recent by the snapshot's `lastActivityAt` (a core session that is not in the snapshot sorts last), and
   no core start. This keeps the isolated CLI reuse control.
6. Else (b) unknown: today's refusal; (b) gone: today's information line.
7. An orchestrator will be created (not `--no-orchestrator`): the selected runtime's readiness,
   `preflight.checkSelectedRuntime(runtime, name)` (new, `lib/preflight.ts`: `tmux` → `checkTmux()`; another
   runtime → `runtime.preflight?.()`), then `sm.spawnOrchestrator`.
8. An `OrchestratorStartBlockedError` (guard by code) from step 4 or step 7: `spinner.fail("No new orchestrator
   was started")`, then rethrow **the same error object**, so the top-level handler prints `Error:` and exactly
   its message, with no "Failed to setup orchestrator:" prefix. Other errors keep the prefix.

Why this closes sol M-2. The CLI's own probe and snapshot no longer decide a reuse of a Herdr record. Core
decides with a strict read under A, after its probe, with R1 to R7 for the same identity token. A launch that
published its handle still has its claim until its success settlement (4.5), so R1 fails during
`postLaunchSetup` and `confirmLaunch`.

#### 5.3.6 Preflight and `ao spawn` (r6 m-2)

- runtime-herdr `preflight()`: `resolveHerdrEndpoint({ binPath, env: process.env })` with its own `binPath`;
  rejects when the binary is missing, `running !== true` or `compatible !== true`. It caches nothing.
- `spawn.ts` `runSpawnPreflight`: the registry's runtime instance for `project.runtime ?? defaults.runtime`
  (`getPluginRegistry`, cached at `create-session-manager.ts:32`, the same instance that the session manager
  uses) and `checkSelectedRuntime`. It runs before `sm.spawn`.
- `doctor.ts` keeps the ambient `checkHerdr()`. Its comment (`:187-192`) changes to: "External-service probes
  per runtime. tmux uses the same check as `ao spawn`. herdr is an ambient check (bare `herdr` on PATH, the
  caller's socket); `ao spawn` and `ao start` ask the selected runtime's `preflight()`, which uses the plugin's
  own binary, so the two verdicts can differ."

#### 5.3.7 `runtime-stop.ts`

The fallback row "destroy resolves, `isAlive` rejects with no-server → `destroyed`" (`:221`) applies only to a
runtime outside the set (a guard for 4.2; Herdr has `stop`).

#### 5.3.8 When a start refuses, the message, the recovery

A start (CLI or direct core) refuses before any write when G finds a blocking record, when the records cannot
be read, when A is busy or unsupported, when the admission path cannot be fixed, or when the records change in
three rounds. It reuses, and does not refuse, only a live record that R accepts: core's project-mode record, or
any workspace mode through the CLI. With `--no-orchestrator`, nothing of this runs.

**Message M** (`OrchestratorStartBlockedError.message` for `reason: "records"`; each `<...>` in a command is
shell-quoted with `shellEscape`):

```text
No new orchestrator was started for project <project>: AO cannot tell that every earlier herdr orchestrator launch of the project ended.
<id>: <state>. Herdr pane <pane> (terminal <T>), workspace <ws>, worktree <path>, socket <socket>: <answer>.
  Check:  HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>
  If it runs, use it:  ao session attach <id>
  If it does not run, or after you close it:  ao session kill <id> --confirm-runtime-closed <identity-token>
Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.
```

One block per record. `<state>`: `status <s>[, launch failed][, create <stage>][, <reason of not-reused>]`, or
`launch in progress by ao process <pid>`. Variants: an empty pane ID: `Check:  HERDR_SOCKET_PATH=<socket> <bin>
workspace list` (look for the label `<session>` and the cwd `<path>`); P (r10, sol m-4: no pins, so no
`<socket>` and no `<bin>`): `Check:  <bin> workspace list`, with `<bin>` the selected runtime's binary, at the
endpoint of the `ao` process that started the launch (its `HERDR_SOCKET_PATH`, else its `HERDR_SESSION`, else
the default socket; doc 0004, "which server AO reaches"), and the line "AO did not record the endpoint of this
launch"; `<path>` is the record's `worktree`, else the managed path of the ID; `in-progress`: `Wait for ao process
<pid>; if it hangs, stop that process, then run ao start again.` (no kill line); `damaged`: `Its runtime handle
cannot be read (<first 80 characters>). Retire it by hand: docs/DEVELOPMENT.md, "Retire a Herdr record by
hand".` (no F-9 line; F-9 refuses it). `<answer>` (after A): "herdr answered that the pane does not exist",
"herdr shows the pane with another terminal (<T'>)", "no herdr server answers at the socket", "the herdr check
failed: <first line>", "the herdr check did not answer within 10 s", "the pane runs, but the record is not
reusable (<why>)", "its herdr pins are malformed", "no herdr runtime plugin is loaded", "AO has no pane ID for
this launch".

The other reasons print one sentence each: `records-unreadable` ("The session records of project <p> could not
be read (<error>); no orchestrator was started."), `admission-busy` (5.3.1), `admission-unsupported` ("This
platform has no admission lock; AO starts no herdr orchestrator here."), `admission-path` (4.9),
`records-changed` ("The orchestrator records of project <p> changed during the check; run ao start again.").

#### 5.3.9 Deferred limits (sol's conditions)

- **L-1** tmux and test-runtime orchestrator records are outside G. The guarantee is narrow: a fit-2 start or
  restore never admits a second Herdr orchestrator launch next to a known-Herdr orchestrator record of the
  project (any status) or an in-flight Herdr launch of a fit-2 build. A tmux and a Herdr orchestrator, and two
  tmux orchestrators, can still exist (today's behavior). No document says "one orchestrator per project".
- **L-2** Core G does not select a handleless orchestrator record without a live launcher: a launch of a build
  before fit-2 that crashed inside a Herdr create. P cannot be added to such a record. The CLI keeps today's
  rule for it (it counts as the existing orchestrator; OQ-F10). **Upgrade step** (owner, before the first
  fit-2 start): for each Herdr project, list the orchestrator records without `runtimeHandle`, for example
  `grep -L '^runtimeHandle=' <sessions dir>/*-orchestrator*`; check each as 5.4.3 (`workspace list` by label
  and cwd); retire each by hand (5.4.4). Without this step (r10, Muse note), such a record can count as the
  existing orchestrator at every `ao start` while nothing marks it terminal: `ao start` then prints "Using
  existing orchestrator session" and starts none, also when no agent runs for it.
- **L-3** Worker spawns have no project-wide admission rule (distinct worker IDs are intended). Same-ID
  serialization of restore and kill is same-ID R3, not fit-2.
- **L-4** A is per sessions directory: two AO configs in different directories for one repository are two
  projects and are not serialized. This does not cover two names for one directory, which 4.9 removes (R-A
  stays).
- **L-5** An `ao` build before fit-2 takes no A and writes no P. **Deployment constraint:** stop every `ao`
  process of the old build (lifecycle workers, resident `ao` processes, watchers that run `ao`) before the first
  fit-2 start. fit-2 has no fence against an old binary (that is the RW round).

#### 5.3.10 Oracle changes and acceptance tests

**Oracle changes.**

- Commit 5: the core interim tests (`orchestrator-herdr-start.test.ts`: `false` and no-server give the exact
  refusal; runtime-herdr `fit-startup-interim.test.ts`: project mode refuses) expect `OrchestratorStartBlockedError`
  (`records`, kind `unproven`) and message M instead of "Cannot tell whether session ...". Their controls stay:
  a live Herdr record is reused (strategy `reuse`); a record of another runtime with `false` is archived and
  replaced. The record-equality and no-archive assertions stay.
- Commit 6, the CLI interim tests on the fit-1 tip (`ee3534d7`, note 2, R10.3; note 3 changes no test). r11
  (Muse m-1): each case is named by its `it` label, not by a line number.
  - `start.test.ts`, describe "start command — old Herdr orchestrators (fit-1 interim)" (mocked core), both
    modes:
    1. "<label>: exit 1 with the unknown refusal, and no new orchestrator", with the labels "a working record,
       isAlive false", "a working record, the no-server code", "a working record that sm.list showed killed
       and exited (isAlive false)", "a record that the lifecycle wrote killed (runtime), isAlive false" and
       "a record that the lifecycle wrote killed (runtime), the no-server code". The CLI makes no probe of a
       Herdr record: a candidate that the predicate accepts goes to `sm.findReusableOrchestrators` (mock:
       `[]`), and a terminal one is no candidate. `sm.spawnOrchestrator` (mock) rejects with an
       `OrchestratorStartBlockedError`; exit 1 with exactly its message (no prefix).
    2. "a live working record is reused as before": the mock reuse decision answers the record; the result
       stays.
    3. "<label>: exit 1 with the still-runs refusal, not reused, and no new orchestrator", with the labels "a
       record that the lifecycle wrote killed (runtime), isAlive true" and "a working record that sm.list
       shows with activity exited, isAlive true" (note 2). Old: `isAlive` called by the CLI,
       `spawnOrchestrator` not called, the still-runs text, the spinner "An old Herdr orchestrator still
       runs". New: the CLI makes no probe of a terminal Herdr record (`isAlive` not called), calls
       `sm.spawnOrchestrator` once, and prints exactly the message of the mock's
       `OrchestratorStartBlockedError` with exit 1 and the spinner "No new orchestrator was started" (the
       decision itself is tested on the real core below).
    4. "control: a live record that is not terminal is still reused next to a held live record" (note 2): the
       mock reuse decision answers `app-orchestrator-3`; the oracle (reused, no spawn) stays; the CLI makes
       no probe of the held record.
    5. "a record with another terminal status (done) is not probed, as before": the CLI still makes no probe
       and now calls `sm.spawnOrchestrator`; the core decision (blocked, `not-reused`, status `done`) is
       T-7.1's sibling on the real core.
    6. "control: a tmux record that sm.list showed killed is not probed, and a new orchestrator starts":
       unchanged.
  - `start-herdr-interim.test.ts` (real core). The describe "ao start with an old Herdr orchestrator, through
    the real session manager (fit-1 interim)": its cases "<mode> mode, answer <n>, a record <persisted>:
    exit 1, record kept, no new orchestrator" now expect message M instead of "Cannot tell whether ...",
    split by the persisted status (r11, sol m-2): a record persisted `working`, with answer 1 (the 0.9.5
    `pane_not_found` answer) or answer 2 (the 0.9.5 no-server answer): kind `unproven` (R6 passes, the probe
    does not prove the pane alive); a record persisted `killed` by the lifecycle (`killedReason` `runtime`),
    with either answer: kind `not-reused`, "its status is killed" (R6 fails before any probe; core's persisted
    status does not depend on the enrichment of `sm.list`). Both keep the assertions: exit 1, M with no
    "Failed to setup orchestrator:" prefix, the sessions listing and the record's `runtimeHandle` and
    `status` as before (`sm.list` still writes `prAutoDetect` and a new `generation`), zero
    `workspace.create`, and stand-in calls that name only `w3:p2`. The describe "ao start with a held Herdr
    orchestrator whose pane runs (note 2, review r1 M-1)" (four cases with a stand-in `runtime.create`):
    project mode and isolated mode with a record `killed` by the lifecycle: exit 1 with M (`not-reused`,
    "its status is killed"); isolated mode with a `working` record with activity `exited`: exit 1 with M
    (`not-reused`, "an isolated record"); project mode with that record: **exit 0, "Orchestrator session
    reused"** (OQ-F13 (a), decided). In every case `runtime.create` and `workspace.create` are not called, the
    record keeps every value except the `sm.list` keys `prAutoDetect` and `generation`, and the stand-in
    calls name only `w3:p2`.
- The no-server controls with runtime `tmux` (`start.test.ts`, "A1: a runtime with no server at all starts a
  new orchestrator and says so") and `mock` (`orchestrator-no-server-start.test.ts`, "project mode: archives
  the old record with its handle, stops no runtime, and launches a new one" and "isolated mode: starts the next
  ID, stops no runtime, and leaves the old record to the lifecycle") keep their oracles. `preflight.test.ts` (`checkHerdr`)
  keeps its oracles.

**Acceptance tests.** Core tests in a new runtime-herdr file `src/__tests__/fit2-startup.test.ts` (built core,
the real plugin, a stand-in `herdr` that answers by the `HERDR_SOCKET_PATH` of each call; the caller's own
endpoint answers a healthy, compatible `status server --json`). CLI tests in `start.test.ts`, `spawn.test.ts`
(mocked core) and a new `start-herdr-guard.test.ts` on the real core. "Nothing written" means: the sessions
directory listing and each record byte-equal before and after; no reservation, no `.origin` write, no hooks
write, no prompt file, no worktree; zero `workspace create`.

| ID | Case | Expected |
| --- | --- | --- |
| T-7.1 | Persisted `status=killed`, `killedReason=runtime`, a pinned Herdr handle; the pin answers F1 no-server; a healthy caller endpoint; direct core; project and isolated mode | blocked, kind `not-reused` (status `killed`); nothing written |
| T-7.2 | `status=working`, the pin answers F1 `pane_not_found`; and another terminal | blocked, `unproven`; nothing written |
| T-7.3 | `status=working`; the pin answers F1 `pane_not_found` (r10, Muse m-1), so the real `list()` before the start shows `killed` and `exited` (memory only); both modes; direct core and CLI | blocked, `unproven` ("herdr answered that the pane does not exist"); nothing written |
| T-7.3d | **Exited agent, live pane (r10, Muse m-1, sol; note 2):** `status=working`; the pin answers `pane get` with terminal T; `pane process-info` shows no agent process, so `list()` shows activity `exited`; strategy `reuse`; real core, direct and CLI | project mode: reused (G reads no activity; R1 to R8 pass), no create; isolated mode: blocked, `not-reused` ("an isolated record"), nothing written. OQ-F13 (b) would make project mode a block |
| T-7.3b | **Legacy exit-0 answers (r7 m-4):** the pin answers the 0.8.0 exit-0 `pane_not_found` envelope; and a 0.8.0 `pane_info` with another terminal; project mode, strategy `delete`; direct core | blocked; nothing written (on `389b8dfe` the record is archived and a second orchestrator starts; on the fit-1 tip the interim message) |
| T-7.3c | T-7.3b in isolated mode | blocked (on `389b8dfe` a second ID is reserved) |
| T-7.4 | CLI, mocked core: `sm.spawnOrchestrator` rejects with an `OrchestratorStartBlockedError` | exit 1; `console.error` receives exactly (`"\nError:"` in red, `err.message`); no "Failed to setup orchestrator"; spinner fail text "No new orchestrator was started"; no "Starting a new one", no "Orchestrator session created" |
| T-7.4b | **CLI to real core:** a persisted `killed` Herdr orchestrator record (not a CLI candidate) | exit 1 with M; nothing written; zero `workspace create` |
| T-7.5 | A Herdr record with `launchFailed` and a live pane; a record with P and a dead claim | not reused (CLI and core); blocked (`not-reused`, `create-incomplete`); both modes |
| T-7.6 | A non-terminal Herdr candidate that the pin answers no-server (CLI, real core) | the reuse decision returns none; core blocks; exit 1 with M |
| T-7.7 | **Control:** a live, reusable Herdr orchestrator, project mode, strategy `reuse` (CLI and core); a live isolated one through the CLI | reused; no new runtime; the CLI prints "Using existing orchestrator session" |
| T-7.7b | A live isolated Herdr orchestrator in a direct core call; a live one with `status=killed` through the CLI in isolated mode | blocked, `not-reused` |
| T-7.8 | **Runtime mismatch:** project mode, the project now selects `tmux`; a live fixed-ID Herdr record without `launchFailed`; a registered tmux stand-in that would answer `false` and records its calls; strategies `reuse` and `delete`; direct core and CLI | blocked (`not-reused`, "the project now selects tmux"); **zero tmux calls with the Herdr handle**; the record unchanged |
| T-7.8a | **Start sites before G (r11, fit-2a; commit 4 on fit-1's interim guard):** project mode, the project now selects `tmux`; a fixed-ID Herdr record without `launchFailed`; a tmux stand-in that records its calls; (1) a registered herdr stand-in whose pane answers `pane_not_found`; (2) no herdr plugin registered; direct core, strategies `reuse` and `delete` | zero tmux calls with the Herdr handle; (1) the probe goes through the herdr stand-in, and fit-1's interim refusal "Cannot tell whether ..." follows; (2) the interim refusal with zero runtime calls (a `null` runtime of the set is unknown); the record unchanged; nothing written. Commit 5 replaces this oracle by T-7.8's block |
| T-7.8b | **Concurrent fixed-ID branch:** a tmux record while the project now selects herdr; the tmux stand-in's `isAlive` writes a new fixed-ID tmux record so the reservation fails and the concurrent branch runs | zero herdr calls with a tmux handle; the branch probes through the tmux stand-in |
| T-7.8c | Restore of a Herdr record while the project selects tmux | refuses at step 7 (herdr `unknown`); zero tmux calls |
| T-7.8d | Kill and list with a Herdr handle while no herdr plugin is registered | kill refuses, nothing removed; list keeps the stored status with zero calls of the project's runtime. Controls: an unregistered `mock`-family handle: kill skips the stop and goes on (today); list uses the project's runtime (today) |
| T-7.8e | **Cleanup (sol m-3):** a Herdr worker (no PR) while the project now selects tmux; the Herdr stand-in answers `pane_not_found`; and no herdr plugin registered | first case: zero tmux calls with the Herdr handle; the rule asks herdr, the kill that follows refuses (`unknown`), the record kept; second case: no probe for the record, no kill |
| T-7.9 | Damaged records: a handle that does not parse but names herdr; a handle without `runtimeName` in a Herdr project; malformed pins | blocked, `damaged` (malformed pins: `unproven`, answer "its herdr pins are malformed"); zero calls for them |
| T-7.9b | **CLI routing (r10, Muse m-2; r11, sol m-1):** a non-terminal orchestrator record whose handle parses but has no `runtimeName`, on a Herdr project; CLI on the real core; the project's runtime is a registered stand-in that records each call with its handle and answers `isAlive` with `true`; the test wraps the real `sm.list` so that its start and its return add marks to the call log | **inside each `sm.list` call** (the enrichment, fit-1 `session-manager.ts:1523-1561`: a handle without `runtimeName` falls back to the project's runtime, `:1532-1536`): exactly one `isAlive` with that handle; the status stays `working`. **After the last `sm.list` returns** (the CLI routing and the admission): zero runtime calls with that handle; the CLI sends the record to core; core's reuse decision drops it; G blocks it, `damaged`; exit 1 with M. **D2:** a split by the parsed `runtimeName` alone makes one more `isAlive` with that handle after the last `sm.list` (`checkOrchestratorLiveness`). No product change: `sm.list` keeps its enrichment |
| T-7.10 | Control: tmux and `mock` no-server records | "gone" and a new orchestrator, as today |
| T-7.11 | Herdr project, the selected endpoint has no server, no old record | `preflight()` rejects; exit 1 before `spawnOrchestrator`; nothing written |
| T-7.11b | The selected endpoint answers `compatible: false` | the same |
| T-7.12 | `--no-orchestrator` | no preflight, no admission (unchanged) |
| T-7.13 | `ensureTmux` follows `project.runtime` in both directions | no tmux check for a Herdr project; a check for a tmux project |
| T-7.14 | `ao spawn` on a Herdr project with a registered runtime made by `create({ binPath })`; the ambient `herdr` healthy, the selected one unavailable | exit 1 with the plugin's message; the ambient `herdr` never runs; `sm.spawn` not called |
| T-7.15 | `ao spawn` on a tmux project | `checkTmux` as today |
| T-7.16 | `runtime-stop.ts`: a stop-less runtime named `herdr` whose `isAlive` rejects with no-server after a resolved destroy | `unknown`; control: a stop-less `mock` keeps `destroyed` |
| T-7.20 | **Paused create:** start A (isolated, Claude Code shape) pauses inside `pane run`; then start B; direct core, and CLI B on the real core | B blocked (`in-progress`, this process's PID); B makes zero `workspace create`; A completes; a third start is blocked (direct core: `not-reused`, isolated) or reuses through the CLI |
| T-7.20b | As T-7.20 with A paused inside the workspace plugin's `create` (before `runtime.create`) | B blocked (`in-progress`) |
| T-7.21 | **Two simultaneous isolated starts:** `Promise.all` of two direct core starts on an empty project; and a forked Node process that runs the built core on the same state root | exactly one reaches `workspace create`; the other is blocked (`in-progress`) or busy |
| T-7.21c | **First start under a symlinked parent (sol M-1; r10, sol m-2):** isolated mode; `AO_STATE_ROOT` below `alias` → `real`; the sessions directory does not exist. Process 1 (a forked Node process on the built core) pauses at the stage `before-reservation` (after the `mkdir` and G, under A, no reservation yet). Process 2 (another fork, `waitMs` 10 000) starts and reports `subject-fixed`; the test waits 500 ms and checks that process 2 has reported no `lock-held`; then it releases process 1, whose stand-in `pane run` waits until process 2 has answered | exactly one `workspace create` and one runtime create over both processes; process 2 blocked `in-progress` with process 1's PID (or `admission-busy` if its wait ends first); process 2 never reported `before-reservation`. D2 in 8: D2-a and D2-b |
| T-7.22 | **Workspace-mode change:** a live isolated Herdr record `-orchestrator-1` while the project is now in project mode; and a live fixed-ID record while it is now isolated; direct core and CLI | direct core: blocked (`not-reused`); CLI: reuses the live record (no create) |
| T-7.23 | **Revalidation:** during G's probe the stand-in rewrites the record's launch identity (a restore); and writes `launchFailed` | the next round sees the new token or `launchFailed`; the record is not reused; after three changes `records-changed`; nothing written |
| T-7.24 | **A busy:** the test holds the admission name; `waitMs` 50 | `admission-busy`; nothing written |
| T-7.25 | **No lock on the platform:** `isDeliveryLockSupported` mocked false; a Herdr start; and a `mock` start | Herdr: `admission-unsupported`, nothing written; `mock`: as today |
| T-7.25b | **Admission path:** a file where a component of the sessions directory must be; a dangling symlink as a component | `admission-path`; nothing written; zero `workspace create` |
| T-7.26 | Restore of an orchestrator record while another Herdr orchestrator record exists | blocked by G (the restored record excluded); zero runtime calls for the create |
| T-7.26b | **Paused workspace restore (sol m-1):** restore of a terminal handleless orchestrator record on a Herdr project, workspace missing; the stand-in workspace plugin pauses in `restore` | during the pause, a start in the same process gets A within 50 ms (`waitMs` 50: no `admission-busy`) and is blocked `in-progress` on the restored record (P and the claim are on disk); then the restore goes on and creates |
| T-7.26c | **Failed workspace restore (sol m-1):** the stand-in workspace plugin throws in `restore` | `WorkspaceMissingError`; A is free right after (a start gets it within 50 ms); the record's `runtimeHandle` and `restoredAt` as before the transition; no claim; the copy-back stays |
| T-7.26d | **Damaged handle at restore (r10, Muse m-3):** restore of a terminal record whose `runtimeHandle` text does not parse but names herdr; on a Herdr project, and on a tmux project; a worker and an orchestrator record | refused at step 7 (`unknown`, "the runtime handle of <id> cannot be read ..."); no transition write; zero `workspace.restore`, zero runtime create; the copy-back released as today. Control: a tmux project and a damaged text that does not name herdr: today's skip, a tmux create. **D2:** today's skip creates a second launch |
| T-7.27 | **CLI after the handle is published (sol M-2):** start A (direct core, isolated, Claude Code shape) pauses in `postLaunchSetup` after its handle write; then `ao start` B on the real core | B's reuse decision returns none (R1: A's live claim); B: exit 1 with M (`launch in progress by ao process <pid>`); zero `workspace create` by B; no "Using existing orchestrator session". After A completes, `ao start` C reuses A's record (no create) |
| T-7.28 | **CLI probe race (sol M-2):** a live reusable isolated Herdr record; during B's reuse probe (the stand-in's `pane get`), the stand-in rewrites the record's identity; and in a second run writes `launchFailed`; and in a third run replaces the record by a new reservation with P | B does not reuse the stale candidate: the first run probes again in the next round and reuses only the new identity when it answers alive; the second and third runs: none reusable, core blocks (`not-reused` / `in-progress`), exit 1 with M |
| T-7.29 | **No Herdr call under A (Muse m-6):** a reuse candidate whose `pane get` never answers; `probeTimeoutMs` 200 | while the probe waits, another start in the same process gets A within 50 ms; the first start ends blocked, `unproven`, answer "the herdr check did not answer within ..." |

### 5.4 F-9: the owner retires a Herdr record (OQ-F2 (a))

#### 5.4.1 The command

`ao session kill <session> --confirm-runtime-closed <identity-token>`; core `kill(id, { confirmRuntimeClosed:
token })`. No other command or option gets it: `cleanup`, `restore`, the lifecycle, `ao start` and the send
path never pass it, and their option types do not have it.

#### 5.4.2 What it accepts, refuses, removes and keeps

Steps, in order; each refusal changes nothing:

1. Read the record strictly. Missing or unreadable: refuse.
2. **Accept** only a record whose `runtimeHandle` parses to an object with a string `id`, an object `data` and a
   `runtimeName` in the set: any status (also terminal), `launchFailed`, P or a partial handle, an empty ID,
   malformed pins. **Refuse** a tmux or other runtime's record ("the tmux stop confirms itself"), a record
   without `runtimeHandle`, and a handle that does not parse or has no `runtimeName` ("retire it by hand",
   5.4.4).
3. The token must equal `launchIdentityToken(raw)`. Else refuse: "the record now names another launch
   (identity token <new>); check it again before you retire it".
4. `assertNoLiveLauncher` (a live launch claim refuses).
5. The handle's runtime plugin must be registered (4.6). Else refuse.
6. `stopRuntime`. Confirmed (a later RH): go on as a normal kill.
7. Unconfirmed: one `isAlive(handle)` with the pins, with the core bound of 10 s. `true`: refuse ("herdr shows
   pane <pane> with its terminal at <socket>: the session runs; close it first"). `false`, any rejection, a pin
   error, a non-boolean, no answer in time: the owner's statement decides.
8. One conditional write on the launch identity: `retiredBy=owner`, `retiredAt`, `retireEvidence=<the answer of
   step 7, at most 200 characters>`, `retiredIdentityToken=<token>`. A failed write stops the operation, with
   nothing written and nothing removed.
9. The rest of the kill as today, with `stopWhenReplaced` (the launch identity read in step 1) directly before
   each removal and inside the plugin callbacks: the worktree removal only for a managed worktree (the project
   checkout is never removed, `:674-684`, `shouldDestroyWorkspacePath`); the OpenCode session only with `--purge-session`; the archive
   through `deleteMetadata` (generation floor and record lock kept), with the retire keys in the archived
   record.

**It keeps:** the project checkout, the agent session (without `--purge-session`), the herdr server, its
workspaces and panes (F-9 sends no herdr request other than the one read of step 7), the prompt file.

The retire keys of step 8 are not launch-identity keys, so `stopWhenReplaced` still holds after step 8. When a
later step stops on a replacement, the retire keys stay in the record version that step 8 wrote; their
`retiredIdentityToken` differs from the record's current token, and no reader acts on them.

Without the option nothing changes, except the hint of a Herdr kill refusal: "After you check and close it,
retire the record: ao session kill <id> --confirm-runtime-closed <identity-token>".

#### 5.4.3 The owner's check before the attestation

Message M, the kill refusal and `ao status` print what the check needs; the owner can also read the record
file. Pin values in commands are shell-quoted.

1. Read the stored handle: pane ID, expected `terminalId`, `workspaceId`, `workspacePath`, the label (the
   session or tmux name), `herdrBin`, `herdrSocket`, `createIncomplete`.
2. At the pinned endpoint: `HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>` and `... pane process-info --pane
   <pane>`. Compare `terminal_id` with the stored one, and the processes and their cwd with the worktree.
3. Empty pane ID: `... workspace list`; look for the label and the cwd.
4. Malformed pins, or P (no pins; r10, sol m-4): find the endpoint by hand (`<bin> status server --json` with a
   candidate `HERDR_SOCKET_PATH`); a failed AO read is not a check. For P the first candidates are the
   endpoint of the `ao` process that started the launch: its `HERDR_SOCKET_PATH`, else its `HERDR_SESSION`
   (`$XDG_CONFIG_HOME/herdr/sessions/<name>/herdr.sock`), else the default socket (doc 0004, "which server AO
   reaches"). The cwd to look for is the record's `worktree`, else the managed path of the ID. A launch
   script that never ran stays in `$TMPDIR`; AO did not record its name.
5. A missing pane at the pinned endpoint does not find a hidden old server. Also check that no process has its
   working directory in the worktree, for example `find /proc/[0-9]*/cwd -maxdepth 0 -lname '<worktree>*'
   2>/dev/null`.
6. Close the pane by hand when it belongs to this launch. Then run F-9 with the identity token that the check
   used.

#### 5.4.4 Records that F-9 refuses

A damaged record (no readable handle) is retired by hand, as the procedure in `docs/DEVELOPMENT.md` says: stop
the project's lifecycle worker, check as 5.4.3, move the record to `sessions/archive/<id>_<UTC time>`, remove a
managed worktree with `git worktree remove`. This skips AO's record lock and generation floor: an emergency
procedure.

**Residual (as review r7 states it).** A wrong attestation can remove a worktree that a hidden launch still
uses. The token removes the race between the owner's check and the command only for changes that AO records.

#### 5.4.5 Tests

| ID | Case | Expected |
| --- | --- | --- |
| T-9.1 | Herdr record, `isAlive` true | refused; the record and the worktree byte-equal |
| T-9.2 | `isAlive` false, the right token | archived with the retire keys; the managed worktree removed; the agent session kept; zero herdr close calls |
| T-9.3 | The pin answers no-server | archived; `retireEvidence` names it |
| T-9.4 | An empty-ID partial; P with a dead claim; malformed pins | archived (zero herdr calls for the empty ID and the malformed pins) |
| T-9.5 | A tmux record with the option; a record without a handle; an unparseable handle | refused; nothing changed |
| T-9.6 | A wrong token; the record restored between the token and the command | refused, the new token printed; nothing changed |
| T-9.7 | A live launcher | refused |
| T-9.8a | **Replacement during step 7 (sol m-4):** the stand-in's `pane get` rewrites the record's launch identity, then answers `pane_not_found` | the retire write (step 8) fails: no retire keys in the record, nothing removed, no archive; the error says that the record changed |
| T-9.8b | **Replacement after the retire write, in the workspace removal (sol m-4):** step 8 succeeds; the stand-in workspace plugin's `destroy` rewrites the record's launch identity in its awaited preamble, then calls `stillOwned` | the callback answers false: no worktree removal; the kill throws `recordChangedError`; no archive; the agent session kept |
| T-9.8c | **Replacement after the retire write, in the purge holder lookup (sol m-4):** `--purge-session` with an OpenCode-shaped record; step 8 succeeds; the stand-in holder lookup rewrites the record's identity | `stillUnheld` throws: no OpenCode interrupt, no session removal, no archive |
| T-9.9 | Project mode (`<prefix>-orchestrator`) | archived; the project directory unchanged |
| T-9.10 | A prepared OpenCode session without `--purge-session`; with it | kept; purged |
| T-9.11 | Without the option | today's refusal plus the hint line with the identity token |
| T-9.12 | `cleanup` over a Herdr worker partial | refuses as before; `kill` is never called with `confirmRuntimeClosed` (a spy) |
| T-9.13 | CLI: the option reaches core; exit 0 and 1; a missing token value | commander error, no core call |

### 5.5 `ao status` shows the identity token (sol m-2, Muse m-1)

- Core `metadata.ts`: `launchIdentityToken(record)` (4.8), exported from `index.ts` (commit 1).
- CLI `status.ts`: `SessionInfo` gets `identityToken: string | null` and `createIncomplete: string | null`.
  Both are set only when `session.metadata.runtimeHandle` parses to a handle whose `runtimeName` is in the set
  (`isLaunchEndUnproven`); else `null`. The token is computed from `session.metadata` (the raw record, which
  `sessionFromMetadata` keeps), never read from `launchFailed`.
- Human output (`printLaunchFailed`, `:229-232`): a record with `launchFailed` prints `launch failed: <text>`,
  plus ` (identity token <t>)` for a runtime in the set. A set-runtime record with `createIncomplete` and no
  `launchFailed` (a crashed launch) prints `launch incomplete (<stage>; identity token <t>)`. Other records:
  as today.
- JSON (`--json`): the two keys are added to each `SessionInfo` object; no key changes or goes away;
  `launchFailed` keeps its capped text.
- Tests (`status.test.ts`, next to the existing oracle at `:586-609`): a Herdr kept failed launch (the line has
  `identity token <t>` with `t = launchIdentityToken(record)`); P with a dead claim (`launch incomplete
  (create-pending; identity token <t>)`); a tmux kept failed launch (today's line, no token); JSON (both keys
  for the Herdr record, `null` for tmux); the token changes after a restore write and not after a status write.
- Commit 7.

### 5.6 F-8: the contracts and documents of fit-2

- `types.ts`: the texts of 4.2 (commit 1; the `SessionManager` and `kill` additions in commits 5 and 7).
- `CLAUDE.md`, "Plugin Standards", "Error Handling": add "A runtime's `create` throws a plain error only when
  nothing of the session can exist in the runtime; otherwise it throws `RuntimeCreatePartialError` with the
  handle of what may exist and `closed: "nothing"`, and closes nothing. Core keeps the record, the workspace and
  the agent session then. runtime-tmux keeps its best-effort kill of its own session; the Herdr measurements do
  not qualify it." "Interface Implementation": add the optional `preflight()`. The `isAlive` sentence of fit-1:
  add "at startup, core admits no second Herdr orchestrator launch next to an earlier Herdr orchestrator record
  and takes no Herdr answer as proof that a launch ended".
- `docs/DEVELOPMENT.md`: replace fit-1's interim paragraphs with G and the reuse decision (5.3.2, 5.3.5, 5.3.8),
  the limits and the upgrade steps (5.3.9), the kept failed launch and the crashed launch (5.2.5), the claim
  settlement and the publication rule (4.5), F-9 (5.4) and "Retire a Herdr record by hand" (5.4.4). r10 (R10.3):
  on `ee3534d7` these are the paragraph "For a Herdr record ... the Herdr fit-1 startup rule applies" with the
  still-runs refusal, the paragraph "The interim guard covers ..." with its three limits, and the recovery
  paragraph with its three cases (`isAlive` false, no server, a held record whose pane still runs); note 3
  corrects their wording first. The by-hand steps stay as the procedure for a damaged record, with note 3's
  step that creates `sessions/archive` when it is missing (landing check m-1). The CLI comments of note 2
  and note 3 in `start.ts` go with the code in commit 6.
- `lifecycle-manager.ts` (`:214-222`): the comment of `AUTHORITATIVE_RUNTIMES` says that runtime-herdr `isAlive`
  answers `false` only for `pane_not_found` or another terminal and rejects when it cannot answer (fit-1), and
  that Herdr stays non-authoritative because a server can run where the endpoint does not reach it.
- `doctor.ts`: the comment of 5.3.6.
- The F-8 comment rows of r7 that fit-1 did not change (check on the base): runtime-herdr `index.ts` comments
  (the create cleanup comment `:470-472`, the file header), core `herdr.ts` comments that name the create close.
- Doc 0004 after the round (development, not in the round's commits).
- **The split of these texts** (r11, OQ-F12 (b)). fit-2a (8.1) takes the parts that describe its own code: the
  `Runtime.create` text of `types.ts` (commit 1); the comments of runtime-herdr `create` (the create cleanup
  comment `:470-472`, the file header) and of core `herdr.ts` that name the create close, changed with the code
  in commit 3, so that fit-2a lands no comment that describes a close; the `CLAUDE.md` "Error Handling"
  sentence on `create`; and the interim notes of 8.1 in `docs/DEVELOPMENT.md`. fit-2b's commit 8 takes the
  rest: the `CLAUDE.md` sentences on `preflight()` and on startup, the `lifecycle-manager.ts` comment, the
  final `docs/DEVELOPMENT.md` texts above, which replace fit-1's interim paragraphs and fit-2a's interim
  notes. The `doctor.ts` comment stays in commit 6.

## 6. The merge with `feat/session-relaunch` (Muse m-4, sol)

Read: `git diff 3e366a01 9f20ce29 -- packages/core/src/session-manager.ts` (relaunch's own commits; its base
`3e366a01` is not on `main`, which holds the same defect fixes as other commits) and the section "Session
relaunch (2026-10-22)" of `docs/DEVELOPMENT.md` on that branch (r10: tip `9f20ce29`, round 5; its landing
check `development/reviews/session_relaunch_review_r5_sol61.md` is LAND-WITH-CHANGES with one minor in a
Claude Code comment, and M-6 stays an accepted limit). Relaunch works only on tmux records: it refuses a
Herdr handle ("a Herdr relaunch waits for the Herdr live check") and an agent with `prepareAgentSession`.

**r11: relaunch lands first** (R.3). Round 6 (`b08e8141`) changes only `agent-claude-code`. The landing
candidate `land/session-relaunch` `804d1347` (the 31 relaunch commits on `main` `43783d3d`) has the same core
hunks as the relaunch branch: on it, spawn and start build `launchedRecord` with `launchCreatedAt =
preparedCreatedAt ?? new Date().toISOString()`, `[LAUNCH_TOKEN_KEY]: launchToken` and
`[LAUNCH_TOKEN_AT_KEY]: launchCreatedAt` (`804d1347` `session-manager.ts:2631-2645`, `:3194-3206`), relaunch's
`settleOnce` and `settle` are closures inside `relaunch` (`:5337-5356`), and the send path reads the agent's
pane for tmux (`getTmuxForegroundCommand(handle)`). The table of orders below keeps r10's three rows; only the
first one is taken.

**Round 5 and fit-2** (r10, R10.3). Round 5 (`7a20242f..9f20ce29`) changes `agent-claude-code`, the help text of
`relaunch` in CLI `session.ts` and `docs/DEVELOPMENT.md`. Its consequences for fit-2:

1. Core `session-manager.ts`, `types.ts` and `index.ts` are unchanged since `7a20242f`, so the key and function
   tables below stand.
2. The hook now writes one failure mark per launch, `<sessions dir>/.agent-conversations/.<id>.<launch
   token>.unusable`, next to the conversation record `<sessions dir>/.agent-conversations/<id>`. They are in a
   dot-directory of the sessions directory: `listRecordIds` (`session-manager.ts:201-211`) skips names that
   start with "." and entries that are not files, so G1, the reuse decision and the holder checks ignore
   them. The admission subject is the sessions directory itself, which relaunch does not move. F-9, like
   `kill`, leaves `.agent-conversations/<id>` and its marks on disk (relaunch's docs: they stay after a kill);
   a later launch has a new token, so they do not count for it.
3. A fit-2 restore writes no launch token, as today's restore does not. Its transition writes `restoredAt`, so
   relaunch refuses `--continue` after it until a relaunch without `--continue` (relaunch's docs: "A
   `restore` writes no token"). Nothing to adapt.
4. Round 5's `session.ts` change is the help text of `relaunch`; fit-2's kill option is another hunk.
5. fit-2 changes no agent plugin, so the round-5 hook code does not meet a fit-2 change. Relaunch's docs say
   that the hook records only when the agent's stdin is the terminal of its tmux pane; a Herdr launch is
   outside that path, and relaunch refuses Herdr records.

**Shared record keys.**

| Key | fit-2 | relaunch | At the merge |
| --- | --- | --- | --- |
| `launchPid`, `launchPidStart` | written in the reservation for a set-runtime launch also without `prepareAgentSession`, and in the restore transition; settled by `settleOwnClaim` (identity and own values) | its claim CAS (identity and the claim values as read); `settleOnce` compares only its own values under the record lock, with later tries while the process lives | one settlement helper: extract relaunch's `settle` (own values, record lock, retries) and give it an optional identity compare; fit-2 uses it with the identity, relaunch without (it writes `restoredAt` back on "absent") |
| `restoredAt` | the restore transition writes it before `create` and writes it back on a step-8 failure or a plain create error | the claim writes it; "absent" writes it back | both write it only with their own claim compare; relaunch's `lastLaunchBinding` (token valid only while `launchTokenAt` equals the last launch time) treats a fit-2 restore like today's restore: the earlier binding stops counting |
| `runtimeHandle` | P and partial handles (Herdr only) | reads; refuses Herdr | no conflict |
| `reservationId` | P is born in a reservation, which keeps the key until the launch write | refuses a record with the key | no conflict: relaunch refuses fit-2's in-flight records |
| `launchToken`, `launchTokenAt`, `launchPane` | none; the identity token (4.8) has another name and is not stored | written by spawn, start (`launchedRecord`) and relaunch | fit-2's `launchedRecordFor()` keeps relaunch's two keys of spawn and start, so a partial record carries them too |
| retire keys (`retiredBy`, `retiredAt`, `retireEvidence`, `retiredIdentityToken`) | new | none | no conflict |

**Shared functions and paths.**

- `liveLaunchOwner`, `assertNoLiveLauncher`, `currentLaunchClaim`, `readLaunchClaim`, `CLEARED_LAUNCH_CLAIM`:
  both use them unchanged.
- `spawn` and `spawnOrchestrator`: relaunch adds the launch token to `agentLaunchConfig` and to
  `launchedRecord` (`:2321-2343`, `:2879-2894` of the fit-1 tip); fit-2 moves `launchedRecord` into
  `launchedRecordFor()`, adds P and the claim to the reservations, and replaces the claim clears by
  `settleOwnClaim`. Textual conflicts in the same hunks.
- `restore`: fit-2 rewrites steps 6 to 12 (5.2.4); relaunch does not change `restore`.
- `kill`: fit-2 changes the dispatch and adds F-9; relaunch does not change `kill`.
- `metadataToSession`: relaunch adds `withAgentPane` (tmux only); fit-2 does not change it.
- `types.ts`: both add to `Runtime` (fit-2 `preflight?`; relaunch `listPanes?`, `runInPane?`) and to
  `SessionManager` (fit-2 `findReusableOrchestrators`, the kill option; relaunch `relaunch`), and both export
  new names in `index.ts`. Adjacent additions.
- CLI `session.ts` (fit-2 the kill option; relaunch the `relaunch` command) and `send.ts` (fit-2 the refusal in
  the non-tmux delegation `:356`; relaunch the tmux path): different hunks of the same files.
- `docs/DEVELOPMENT.md`: two new sections.

**Who adapts.** The round that lands second adapts to the first; neither waits for the other (OQ-F11 (b)).
The adaptation of fit-2 is: `launchedRecordFor()` takes the `launchedRecord` of `main` (with `launchToken` and
`launchTokenAt`); one settlement helper (above; fit-2's unwritable path makes one attempt, relaunch's settle
keeps its later tries); the `types.ts`, `index.ts`, `session.ts` and `send.ts` additions merged.

The landing order of relaunch and fit-1 was not decided in r10. r11: it is decided, relaunch first (R.3).
With a merge of the relaunch branch, fit-1's merge of `main` conflicts in 4 paths: `docs/DEVELOPMENT.md`,
`start.ts`, `start.test.ts` and `session-manager.ts` (the `start.ts` and `start.test.ts` conflicts come from
relaunch's base, whose copies of the defect A and B fixes differ from `main`'s); with the cherry-picked
candidate `804d1347`, in 2 paths (`docs/DEVELOPMENT.md`, `session-manager.ts`). What fit-2 adapts in each
order:

| Order | When fit-2 meets it | What fit-2 adapts |
| --- | --- | --- |
| **Relaunch first, then fit-1 merges `main` and lands** (r11: **taken**, R.3) | fit-2a builds on that fit-1 | at fit-2a's G0, once (8.1): the adaptation above; commit 6 (fit-2b) edits `start.ts` and `start.test.ts` as fit-1's merge resolved them (the interim guard with note 2, R10.3); commit 8 edits the merged `docs/DEVELOPMENT.md`; the line numbers of 2.1 and 3.2 move, so G0 checks the names, not the numbers |
| **fit-1 first, then relaunch merges `main` and lands, before fit-2** (r11: not taken) | as above | as above; relaunch resolved the 4 paths |
| **fit-1 first, fit-2 lands before relaunch** (r11: not taken) | relaunch lands second | relaunch adapts: its `launchedRecord` hunks go into `launchedRecordFor()`, its `settle` and `settleOwnClaim` become one helper, and its refusals of a Herdr handle and of a reservation record already cover P and a kept failed launch; fit-2 adapts nothing |

The rule for the second landing: both test sets stay green, that is every test file that `git diff
--name-only 3e366a01 9f20ce29` lists (among them core `relaunch.test.ts` and `relaunch-settle.test.ts`, CLI
`session-relaunch.test.ts`, claude-code `relaunch-conversation.test.ts`), and fit-2's T-4.16 to T-4.21,
T-7.20, T-7.21c, T-7.26b, T-7.27. r11: with relaunch first, this is a gate of fit-2a and of fit-2b, with the
15 test files of `git diff --name-only 43783d3d 804d1347` (or of the landed commit, when the owner chooses the
merge) (8.1).

**The publication rule and relaunch** (r11, sol's note). The extracted settlement helper keeps fit-2's
identity argument: an unwritable publication settles only on its own fixed `before` and `after` (4.5), never
on an identity read from the record. The launch token and its time are not identity keys
(`LAUNCH_IDENTITY_KEYS`, `metadata.ts:331-337`), so `after` does not depend on them. The pre-create write
removes `reservationId` early; relaunch still refuses such a record, because it refuses a Herdr handle,
also P, and a live launch claim.

**What fit-2 does not complete.** fit-2's claims are launch markers for G and for the kill and restore checks
of a running launch. They are not the per-ID lease of same-ID R3 (operation, workspace and OpenCode ownership),
and they do not close relaunch M-6: fit-2's restore takes its claim only after the old runtime's stop (step 7),
and `kill` (also F-9) takes no claim. M-6 needs restore and kill to take a claim by compare-and-set before any
awaited destructive or allocating step and to release only their own claim on every end path. fit-2's
transition write already has that compare form (the launch identity and the claim as read), so R3 can move it
before step 7 later.

## 7. Product files

| # | File | Items | Kind |
| --- | --- | --- | --- |
| 1 | `packages/core/src/runtime-errors.ts` (new) | F-3, F-4, F-7 | API |
| 2 | `packages/core/src/types.ts` | F-4, F-7 (also `isUnprovenLaunchRecord`, r10), F-9 | API and contract text |
| 3 | `packages/core/src/index.ts` | exports | API addition |
| 4 | `packages/core/src/herdr.ts` | F-4 (rule Q; `compatible`, `version`, `protocol` in `HerdrEndpoint`), `isHerdrPinError` | behavior |
| 5 | `packages/core/src/metadata.ts` | `launchIdentityToken` | API addition |
| 6 | `packages/core/src/delivery-lock.ts` | the `admission` kind, `admissionLock` | API addition, behavior |
| 7 | `packages/core/src/session-manager.ts` | F-3, F-4, F-7, F-9 | behavior |
| 8 | `packages/core/src/runtime-stop.ts` | F-7 | behavior (guard) |
| 9 | `packages/core/src/lifecycle-manager.ts` | F-8 | comment only |
| 10 | `packages/plugins/runtime-herdr/src/index.ts` | F-3, F-4, F-7 (`preflight`), F-8 comments | behavior |
| 11 | `packages/cli/src/commands/send.ts` | F-3 | behavior |
| 12 | `packages/cli/src/commands/start.ts` | F-7 | behavior |
| 13 | `packages/cli/src/commands/spawn.ts` | F-7 | behavior |
| 14 | `packages/cli/src/commands/session.ts` | F-9 | behavior |
| 15 | `packages/cli/src/commands/status.ts` | the token display | behavior |
| 16 | `packages/cli/src/lib/preflight.ts` | F-7 | behavior |
| 17 | `packages/cli/src/commands/doctor.ts` | F-8 | comment only |

**17 product files**: 15 with a behavior, type or API change, 2 comment-only. Against r8's 14: `status.ts` (sol
m-2), `metadata.ts` (the token's home, Muse m-1) and `lifecycle-manager.ts` (no longer conditional, 2.2 item 7).
r10 adds no file: `isUnprovenLaunchRecord` is in `types.ts`; the `HerdrEndpoint` fields are in `herdr.ts`; the
publication rule, the pre-create write, `own.identity()`, the rollback fields, the write-back of
`publishedClaim` and the step-7 refusal for a damaged handle are in `session-manager.ts`; the CLI split by the
predicate and the removal of the note-2 parts are in `start.ts`. r11 adds no file: `publishOwnLaunch`,
`own.publish` and the internal `LaunchRecordUnwritableError` are in `session-manager.ts`. No agent plugin
changes. Docs: `CLAUDE.md`, `docs/DEVELOPMENT.md`. The split (r11, OQ-F12 (b)): fit-2a changes 9 of these files
(8.1), fit-2b 12 (8.2); 4 files are in both (`types.ts`, `index.ts`, `session-manager.ts`, runtime-herdr
`index.ts`).

Tests (new or changed): runtime-herdr `index.test.ts`, `fit-reads.test.ts`, `fit-pins.test.ts` (r10, sol m-3),
`fit-startup-interim.test.ts`, new `fit2-create-rollback.test.ts` (also T-4.19 to T-4.21), new
`fit2-startup.test.ts`, `herdr-fixtures.ts`; core `runtime-errors.test.ts`
(new), `herdr.test.ts`, `metadata` and `delivery-lock` tests (the token, the subject), `runtime-stop.test.ts`,
`orchestrator-herdr-start.test.ts`, session-manager tests for send, kill, cleanup, restore and the dispatch
sites, `herdr-fixtures.ts`; CLI `send.test.ts`, `start.test.ts` (with the note-2 cases), `start-herdr-interim.test.ts`
(with the note-2 describe block), new `start-herdr-guard.test.ts`, `spawn.test.ts`, `session.test.ts`,
`status.test.ts`, `lib/preflight.test.ts`, `herdr-fixtures.ts`. The two note-2 F1 reader tests (core
`herdr.test.ts`, runtime-herdr `fit-reads.test.ts`) stay as they are.

## 8. Implementation order, commits, gates and size

**G0, before commit 1** (r11: the G0 of fit-2a; fit-2b has its own, 8.2). On the base (r11: relaunch lands on
`main` first, then fit-1 `60da85ee` merges that `main` and lands, R.3; fit-2a starts from that `main`, or from
the fit-1 branch after its merge of `main`; section 6): check the names of 2.1 with `git grep`
(r10: also the note-2 names `heldStateOf`, `runningHeldRefusal`, `runningHeldOrchestrators`); run the full gate
set once; record the `SAME_ID_DEFECTS=red` failing set (21 tests on `9d51982b`, the fit-1 report section 7;
note 2 adds no red-set test, so G0 records the set again on its base and uses that set). List the existing core
and CLI tests that launch through a runtime named `herdr` (the pre-create write and P apply only there) and
check their oracles against 5.2.7 and 5.3.10. If a name differs, use the base's name; if a behavior differs,
stop and report.

| # | Commit | Content | Intermediate oracles |
| --- | --- | --- | --- |
| 1 | `feat(core): add the fit-2 error types, names and contracts` | `runtime-errors.ts` with the guards; `LAUNCH_END_UNPROVEN_RUNTIMES`, `isLaunchEndUnproven`, `isUnprovenLaunchRecord` (r10); `Runtime.preflight?`; the `Runtime.create` doc; `herdrPreRequestRefusal`; `isHerdrPinError`; `launchIdentityToken`; the `admission` kind and `admissionLock`; exports | additive; new unit tests only: the guards across copies; rule Q with the r8 and r9 texts and the near misses of T-4.1b; the token; the subject (a symlinked parent before and after a `mkdir`, `ENOTDIR`, a dangling symlink: the D2-a test); the predicate (the rows of 5.3.3) |
| 2 | `fix: refuse a send to a blocked herdr agent` | F-3 (plugin, core send, CLI send) | `index.test.ts:363` changes |
| 3 | `fix: keep the resources of a failed herdr create` | F-4: plugin steps 1 to 6 (Q, the `HerdrEndpoint` fields, the post-run `pane get`, no close) and the create comments of runtime-herdr `index.ts` and core `herdr.ts` (5.6); core catches; `rollbackLaunch` for a set runtime with step 0 and the rollback fields `partialRecord?` and `ownClaim?`; `keepUnconfirmedLaunch` settles; P, the pre-create write and the claims of spawn and start; `own.identity()` and `settleOwnClaim(identity, ownClaim)` on every success path, with the strict read after a `null`; `publishOwnLaunch`, `own.publish` and the unwritable path with its two fixed identities (4.5, r11); the spawn and start handle write as a publication; the restore transition, its write-back with `publishedClaim`, steps 9 and 10 by the publication rule and the settlement (5.2.4 without A); `recordMayOwnRuntime` | 5.2.7, also (r10, sol m-3) `fit-pins.test.ts` `pinnedHandle()`, T-6.1 and the close test, and core `herdr.test.ts:662`, `:691`. fit-1's interim startup tests stay green: they use persisted records with handles, and note 2's real-core cases refuse in the CLI before core. A concurrent project-mode reservation of a set runtime now has P, so the interim guard refuses it as unknown instead of "already exists but is not in a reusable state"; no existing test meets that case with herdr. New: T-4.1 to T-4.21 |
| 4 | `fix: probe and stop an old record through its own runtime` | 4.6 at every listed site (the startup sites still call fit-1's interim function, now with the handle's runtime; a `null` runtime of the set is unknown there); the step-7 refusal for a damaged handle (r10, Muse m-3) | none changed; T-7.8a (r11), T-7.8c, T-7.8d, T-7.8e, T-7.26d added |
| 4d | `docs: the herdr fit-2a contracts and interim notes` (r11, fit-2a only) | the fit-2a part of 5.6: the `CLAUDE.md` "Error Handling" sentence on `create`; the interim notes of 8.1 in `docs/DEVELOPMENT.md` | review |
| 5 | `fix: admit at most one herdr orchestrator launch per project` | A with the subject, the rounds and the bounds; G for start and restore (G1 by the predicate); R; the reuse re-read check (r10); the classifier; `findReusableOrchestrators`; `runtime-stop.ts`; message M (with the P variant, r10); the core interim guard removed | the core interim tests expect `OrchestratorStartBlockedError` and M (5.3.10); T-7.8a's interim oracle goes (T-7.8 covers the case). The CLI still has its interim guard, note 2 included, and refuses with its own text before it calls core; a blocked error that reaches the CLI keeps the old prefix (the CLI tests mock core, so they stay green; `start-herdr-interim.test.ts`, both describe blocks, still sees the CLI's own refusals) |
| 6 | `fix: ao start and ao spawn follow the core admission` | CLI start (5.3.5: the split by the predicate; `isHerdrProbeTerminal` and the note-2 parts removed with their comments), `checkSelectedRuntime`, runtime-herdr `preflight()`, `spawn.ts`, the `doctor.ts` comment | the CLI interim tests change, the note-2 cases included (5.3.10); new T-7.9b |
| 7 | `feat: retire a herdr record on the owner's word` | F-9 (the kill option, core steps, the CLI option, the hint) and the status display (5.5); r11: the fit-2a texts that end with the by-hand retirement now end with the F-9 line (4.5, the unwritable warning; 5.2.4 step 8) | the Herdr kill refusal text gains the hint line; `status.test.ts` gains the token cases; r11: the text oracles of T-4.19c, T-4.19d, T-4.20c, T-4.20d and T-4.21e (1) change from the by-hand line to the F-9 line |
| 8 | `docs: the herdr fit-2 contracts` | 5.6 (r10: the note-2 paragraphs of `docs/DEVELOPMENT.md`; r11: also fit-2a's interim notes, which the final texts replace) | review |

**Gates.** Each commit: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and the tests of the changed packages,
under `env -i` with a scratch `HOME`. After commit 8: the full `pnpm -r --no-bail test` with a fake `HOME` and
no agent binary or `herdr` on `PATH` (the root run has the live OpenCode block); r11: the same after commit 4d,
the last commit of fit-2a; `SAME_ID_DEFECTS=red`: **the failing set must equal the G0 set** (no fit-2 test is a red-set defect test, and no red-set test concerns a
Herdr create or startup). **D2 non-vacuity:** undo each fix in a scratch copy and name the tests that fail.
Each race test must fail when its **own** fix is undone, not only because another layer blocks: the core reuse
decision in the CLI (T-7.27, T-7.28), `settleOwnClaim` (T-4.16, T-4.17, T-4.18), the settlement on the
refreshed identity (r10: T-4.2, T-4.17), the publication rule (r10: T-4.20a to T-4.20f; r11: the fixed `after`
of the adoption, T-4.20g; the strict read after the retry, T-4.21a to T-4.21c; the strict read after a `null`,
T-4.21d; the two settlement identities, T-4.21e), the write-back of
`publishedClaim` (r10: T-4.19a to T-4.19d), the pre-create write (r10: T-4.15), the restore transition and the
release of A before step 8 (T-7.26b, T-7.26c), P (T-4.15, T-7.20), the probe outside A (T-7.29), G (T-7.1 to
T-7.5), rule Q (T-4.1b, T-4.3b), the dispatch (T-7.8 to T-7.8e; r11: T-7.8a in fit-2a), the predicate in the
CLI (r10: T-7.9b; r11: the D2 counts the calls after the last `sm.list`), the
step-7 refusal (r10: T-7.26d), the F-9 token (T-9.6) and the retire write (T-9.8a). No live herdr run is part
of the gate. With relaunch landed: its test files too (r11: the 15 test files of 8.1, in both rounds).

**The two D2 runs of the admission subject** (r10, sol m-2). Each states what it proves:

- **D2-a, the unit mutant.** `admissionLock` with the r8 rule (`realpath`, else `resolve`). The commit-1 unit
  test "a symlinked parent gives one subject before and after the `mkdir`" fails. It proves that the subject
  function is invariant across the first `mkdir`; it proves nothing about two admissions.
- **D2-b, the controlled duplicate-admission mutant** (kept). The coherent r8 reversion: the r8 subject rule,
  computed once before the `mkdir`, and none of the checks that depend on the r10 subject (the equality after
  the `mkdir`, before the reservation, before the copy-back and before the transition write); with only the
  subject rule changed, the check after the `mkdir` refuses process 1 (`admission-path`), and the run proves
  nothing. The schedule of T-7.21c with one more barrier: process 1 pauses at `before-reservation` with
  `info.selected` 0 and no reservation on disk; process 2 must report `before-reservation` with
  `info.selected` 0 while process 1 still waits there (the test checks the sessions directory: no record).
  Then the test releases both. Result on the mutant: two `workspace create`, two runtime creates, records
  `-orchestrator-1` and `-orchestrator-2`. It proves that distinct lock names admit two launches under this
  forced schedule. On the r10 code the same schedule cannot reach the barrier: process 2 waits for A and,
  after process 1's reservation, is blocked `in-progress` (T-7.21c's oracle, exactly one launch).

**Size.** About 1,950 product lines (F-3 120; F-4 with P, the claims, the settlement, the publication rule and
the pre-create write 610, r11 +40 for the fixed identities, the strict read after each undecided attempt and
after a settlement `null`, and the two final settlements; dispatch with the step-7 refusal 130; A, the
subject, the rounds, G and R 510; CLI and preflight 190; F-9 170, with the text change of the fit-2a warnings;
status 50; commit 1 with the predicate 175) and about 4,150 test lines (r10 added about 500; r11 adds about
250: T-4.20g, T-4.21a to T-4.21e, T-7.8a and the changed oracles of T-4.20c, d, f, T-7.9b and the interim
describe). **L**, at its upper end. The risk is in commits 3 and 5. The owner split it (OQ-F12 (b)): fit-2a
(8.1) about 1,030 product and 2,300 test lines; fit-2b (8.2) about 920 product and 1,850 test lines.

### 8.1 fit-2a: the first implementation round (r11, OQ-F12 (b))

This section is the whole scope of fit-2a. The sections that it names give the details.

**Goal.** A blocked Herdr agent gets no prompt (F-3); a failed Herdr create closes nothing and keeps the
record, the worktree, the agent session and the script (F-4, with P, the claims, their settlement and the
publication rule); every probe and stop of an old record goes through its handle's runtime; restore refuses a
damaged handle. fit-2a does not change startup admission: fit-1's interim guard (with note 2) stays the
startup rule until fit-2b.

**Base and G0.** Relaunch lands on `main` first (the cherry-pick `land/session-relaunch` `804d1347`, or the
merge; the owner chooses), then fit-1 (`60da85ee`) merges that `main` and lands; fit-2a starts from that
`main` (R.3). G0 as in section 8, and also:

1. `git grep` the relaunch names that fit-2a meets: `LAUNCH_TOKEN_KEY`, `LAUNCH_TOKEN_AT_KEY`,
   `launchCreatedAt` in spawn and start, `settleOnce` and `settle` in `relaunch`, `getTmuxForegroundCommand`.
2. Run the 15 relaunch test files (core `relaunch.test.ts`, `relaunch-settle.test.ts`,
   `tmux-foreground.test.ts`, `tmux.test.ts`; CLI `send.test.ts`, `session-relaunch.test.ts`,
   `lib/relaunch-terminal.test.ts`; claude-code `agent-pane.test.ts`, `agent-pane-tmux.test.ts`,
   `relaunch-conversation.test.ts`; codex and gemini `agent-pane.test.ts`; runtime-tmux `moved-pane.test.ts`,
   `relaunch-pane.test.ts`, `relaunch-pane-shell.test.ts`) and record them green.
3. Record the `SAME_ID_DEFECTS=red` failing set on this base.

**What fit-2a adapts to relaunch, once** (section 6):

1. `launchedRecordFor()` (commit 3) starts from `main`'s `launchedRecord`: it keeps `[LAUNCH_TOKEN_KEY]:
   launchToken` and `[LAUNCH_TOKEN_AT_KEY]: launchCreatedAt`. `launchCreatedAt` becomes `preCreateAt ?? new
   Date().toISOString()` (`preparedCreatedAt` renamed, 5.2.2), so the pre-create write, `createdAt` and
   `launchTokenAt` hold one value. The token is not an identity key, so the publication's `after` does not
   depend on it.
2. One settlement helper (commit 3): relaunch's `settleOnce`/`settle` closures move into one helper with an
   optional identity compare; `settleOwnClaim(identity, ownClaim)` uses it with the identity, relaunch
   without. fit-2's unwritable path makes its two final attempts (4.5); relaunch keeps its later tries.
3. The send path (commit 2): fit-2's refusal hunks (core `send`, before the restore retry; CLI `send.ts`, the
   non-tmux delegation) sit next to relaunch's tmux hunks (the agent's pane in `getTmuxForegroundCommand`,
   CLI `send.ts`'s bound pane). Different hunks; G0 finds them by name.
4. `types.ts` and `index.ts` (commit 1): adjacent additions.
5. Line numbers: relaunch adds about 940 lines to `session-manager.ts`, so every `session-manager.ts` line of
   this design moves; the names stay.

**Commits.** 1, 2, 3 and 4 of the table above, then 4d. Commit 1 also lands names whose first product caller
is in fit-2b: `OrchestratorStartBlockedError`, `Runtime.preflight?` (the type only), `launchIdentityToken`,
the `admission` kind and `admissionLock`. fit-2a tests them with their unit tests only (the D2-a test
included).

**Product files: 9.** Core `runtime-errors.ts` (new), `types.ts`, `index.ts`, `herdr.ts`, `metadata.ts`,
`delivery-lock.ts`, `session-manager.ts`; runtime-herdr `index.ts`; CLI `send.ts`. Each has a behavior, type or
API change; none is comment-only. Docs: `CLAUDE.md` (the `create` sentence) and `docs/DEVELOPMENT.md` (the
interim notes).

**Changed oracles.**

- Commit 2: runtime-herdr `index.test.ts`, "treats blocked as settled — a prompt is how you answer a blocked
  agent" (5.1).
- Commit 3 (5.2.7): runtime-herdr `index.test.ts`, "closes the workspace when the launch fails, leaving
  nothing in the shared server", "surfaces a herdr error body even though the CLI exits 0", "throws when the
  response carries no usable pane", the create tests "creates the workspace with cwd, label and one --env per
  variable", "launches via `pane run` on a script so the launch command is preserved verbatim" and "returns a
  handle keyed by pane id, carrying workspace and terminal ids" (a fourth call), and its `STATUS_RUNNING`;
  `fit-reads.test.ts`, "reads the failure form of every call with its own command ID (workspace create)"
  (and a new sibling), "reads the pane run failure with the command ID cli:request", and the T-2.1 create
  tests (the result type only); `fit-pins.test.ts`, `pinnedHandle()`, "T-6.1: runs status server --json
  with the absolute path on PATH and stores both pins", and "closes a workspace of a failed launch with the
  pins (the cleanup of today, until fit-2 F-4)" (renamed); core `herdr.test.ts`, the `toEqual` oracles of
  "T-6.1: finds a bare name in the absolute PATH entries and asks status server --json with env" and
  "answers running false with the socket (no server at the endpoint)".
- Commit 4: none.
- fit-1's interim startup tests (core `orchestrator-herdr-start.test.ts`, runtime-herdr
  `fit-startup-interim.test.ts`, CLI `start.test.ts` and `start-herdr-interim.test.ts`) and the two note-2
  F1 reader tests stay unchanged and green.

**New tests.** T-3.1 to T-3.7; T-4.1 to T-4.21 (with T-4.1b, T-4.3b, T-4.7b, T-4.10b, T-4.10c, T-4.16b,
T-4.19a to d, T-4.20a to g, T-4.21a to e); T-7.8a, T-7.8c, T-7.8d, T-7.8e, T-7.26d; the commit-1 unit tests
(the guards, rule Q with T-4.1b's near misses, the token, the subject with D2-a, the rows of the predicate).
These assertions need fit-2b and come with it: T-4.11's F-9 hint (commit 7), T-4.12's status line (commit 7),
T-4.16's start block (commit 5), T-4.17's F-9 line (commit 7), and the start blocks of T-4.20c and T-4.20d
(commit 5). In fit-2a these tests assert the rest of their rows. D2 as in section 8, for these tests.

**Interim notes** (commit 4d, `docs/DEVELOPMENT.md`; they describe fit-2a only and claim no startup
admission):

1. A refused send to a blocked Herdr agent (the stderr line; answer it in the pane).
2. A kept failed launch: what stays (record with the partial handle and `launchFailed`, worktree, agent
   session, prompt file, script) and how to check it (5.4.3). `ao session kill` refuses it (the Herdr stop
   answers `unknown`). Retire it by hand, after the check: note 3's recipe ("Retire a Herdr record by hand",
   with the path rule, `sessions/archive` and the unused name).
3. P (`create-pending`) and a crashed launch: the fields it keeps, what it cannot name (5.2.5), the same
   check and retirement by hand.
4. The unwritable warning (4.5): its three variants, the four keys to check, and the claim of a running `ao`
   process.
5. Restore refuses a damaged handle that names herdr or a Herdr project (5.2.4 step 7), and a second restore
   of a kept failed launch refuses at step 7.
6. Startup until fit-2b: fit-1's interim guard applies. A kept failed launch or a P record that is an
   orchestrator: the CLI and core project mode refuse it when the probe cannot tell (P always: its empty ID
   makes the probe reject, `start.ts` `checkOrchestratorLiveness`, core `isOrchestratorRuntimeAlive`), and
   can reuse a kept failed launch whose pane answers alive (no new launch). A direct isolated core start does
   not read old records (fit-1's limit).
7. The texts of fit-2a that point to a retirement name the by-hand recipe; fit-2b changes them to F-9.

**Gates.** As in section 8, for each of commits 1 to 4 and 4d; the full run and the red set after 4d; the 15
relaunch test files green.

**Size.** About 1,030 product lines (commit 1 175, F-3 120, F-4 610, dispatch 130) and about 2,300 test
lines: M, at its upper end. The risk is in commit 3.

### 8.2 fit-2b: what stays for the second round

Commits 5, 6, 7 and 8: A with the subject and the rounds, G, R, the classifier, `findReusableOrchestrators`,
message M, `runtime-stop.ts`, the removal of the core interim guard (5); the CLI start with the predicate
split, `checkSelectedRuntime`, runtime-herdr `preflight()`, `spawn.ts`, the removal of fit-1's CLI interim
guard with note 2 and note 3's comments, the `doctor.ts` comment (6); F-9, the kill hint, the `ao status`
display, and the change of fit-2a's retirement texts to F-9 (7); the final contracts and docs, which replace
fit-1's interim paragraphs and fit-2a's interim notes (8). **Product files: 12**: core `types.ts`, `index.ts`,
`session-manager.ts`, `runtime-stop.ts`, `lifecycle-manager.ts` (comment only); runtime-herdr `index.ts`; CLI
`start.ts`, `spawn.ts`, `session.ts`, `status.ts`, `lib/preflight.ts`, `doctor.ts` (comment only). Its G0 is
on `main` with fit-2a; it adapts to relaunch only in CLI `session.ts` (its kill option next to the `relaunch`
command). Its oracles: 5.3.10 (commits 5 and 6), commit 7 of the table, T-7.8a's interim oracle (commit 5).
Its tests: T-7.1 to T-7.29 (except T-7.8a, T-7.8c, T-7.8d, T-7.8e and T-7.26d), T-9.x, the fit-2b assertions
of 8.1, and D2-b. **Size**: about 920 product lines and 1,850 test lines, M. The risk is in commit 5.

## 9. Texts for the documents (after the implementation)

- `types.ts`: 4.2. `CLAUDE.md`, `docs/DEVELOPMENT.md`, `lifecycle-manager.ts`, `doctor.ts`: 5.6 and 5.3.6.
- Doc 0004 after fit-2: section 1 (a failed create keeps its resources; the startup admission; F-9), the R4
  notes (rule Q), section 8 (recovery).

## 10. What fit-2 keeps as it is

- The lifecycle's status rules (the outage rule, `isRecoverableKill`); Herdr stays non-authoritative.
- W-4 (duplicate delivery from `done`), the raw-text fallback when no agent is detected, the delivery
  timeouts.
- `ao doctor`'s ambient check; runtime-herdr `detect()`.
- The agent empty-ID fallbacks (3.3).
- The Herdr `stop` (`unknown`, no close); no AO path sends `pane close` or `workspace close`.
- Outside the round: RH (r6 B-1: proof that S's session ended; B-2: binding the launch submission to S's
  listener; M-3: S-based liveness separate from retire authority). G keeps retire authority off until RH.
- Same-ID R3 and relaunch M-6 (section 6).

## 11. The owner's decisions on the fit-2 questions (r11: none open)

r11: the owner decided every question of this table on 2026-10-23 ("11: accept the recommendations for OQ-F4
to OQ-F13"; D-9 in `development/TODO_TRACKING.md`). The column "Decided" gives the choice; the design follows
it. The columns "Changed since r8 (r9)" and "r10" stay as the history of each question. r11 changes the text of
OQ-F13 only (sol m-3) and adds no question: no r11 answer needs a new owner decision.

| OQ | Question | Options and residuals | Decided (2026-10-23) | Changed since r8 (r9) | r10 |
| --- | --- | --- | --- | --- | --- |
| **OQ-F4** | A live Herdr orchestrator while the project now selects another runtime | **(a) Block** (T-7.8 "blocked"): the owner retires it (F-9) or switches the runtime back. **(b) Reuse** through the herdr plugin (safe with 4.6); the old runtime stays without a word; T-7.8 becomes "reused" | **(a)** | no | no |
| **OQ-F5** | `ao send` to a kept failed launch | **(a) No special policy**, documented and tested (5.2.6): a `launch-unconfirmed` pane whose agent runs with terminal T gets the send. The send's liveness check and its input are separate calls, a failed check reads as unknown, and RH B-2 does not bind the submission, so a send can still reach a terminal that changed after the check. **(b) Refuse** a send to a record with `createIncomplete` (a new core guard; a new policy) | **(a)** | wording only (sol): r8 said that the post-run check sends nothing to a changed terminal; that was too strong | no |
| **OQ-F6** | A platform without the abstract-socket lock (macOS) | **(a) Refuse** a Herdr orchestrator start or restore there (the delivery-ledger precedent); the reuse-only decision runs without A (it admits nothing). **(b) Run G without A**; two simultaneous starts can both pass G | **(a)** | no (one clarification: the reuse-only decision) | no |
| **OQ-F7** | The rule Q residual R-Q (4.3) | **(a) Qualify Q0, Q1, Q2** with the r8 and r9 evidence. The trust boundary: Q1 is an exact full message, Q2 a prefix; a server that imitates the CLI's text in the F1 form could get an ordinary rollback. **(b) Qualify only Q0**: every create failure after the endpoint check keeps the resources (more kept failed launches, for example on every protocol skew between the check and the create) | **(a)**, with R-Q accepted | yes: new evidence (`pane run` against protocol 23, r9) and the exact boundary text | no |
| **OQ-F8** | The F-9 token | **(a) Required** (5.4.1): a launch that changes between the owner's check and the command refuses. **(b) No token**: the inspection-to-command race of review r7 stays | **(a)** | name only: "identity token" (4.8) | no |
| **OQ-F9** (new) | The admission subject (sol M-1) | **(a) The canonical subject of 4.9** (the real path of the nearest existing ancestor plus the suffix), with a refusal on an unexpected lookup state; residual R-A (a third party swaps a state-directory component during two starts). **(b) The lexical path** (`resolve(sessionsDir)`): stable for one string, but two spellings of one directory (an `AO_STATE_ROOT` through a symlink in one shell, without it in another) get two names. **(c) A subject from the configuration** (config hash and project ID, no path): one name for one config, but two state roots for one config would share a lock and still be two directories | **(a)** | new | no (the D2 split of 8 does not change the subject rule) |
| **OQ-F10** (new) | The CLI's candidates that G1's predicate does not accept: no stored handle, or a stored text that does not parse, does not name herdr, in a project outside the set | **(a) Today's rule** (5.3.5 step 3 (c)): they count as the existing orchestrator; the CLI prints "Using existing orchestrator session" and starts nothing. A pre-fit-2 crashed handleless Herdr record pins the project there until the owner retires it (L-2, the upgrade step). **(b) Leave them to core:** core does not select them (L-2), so a start can launch next to them | **(a)**: no new launch next to a record that AO cannot judge | new | **scope** (Muse m-2): a damaged handle that the predicate accepts now goes to core and blocks `damaged` (T-7.9b); (a) covers only the rest. The L-2 consequence is stated (Muse note) |
| **OQ-F11** (new) | The order of fit-2 and `feat/session-relaunch` | **(a) Build fit-2 after relaunch lands**, adapting once (section 6). **(b) Build fit-2 now on fit-1 (`ee3534d7`, with note 3 when it is there);** the round that lands second adapts by the rules of section 6 | **(b)**; r11: relaunch lands first, then fit-1, then fit-2a (R.3) | new | **context**: relaunch round 5 (`9f20ce29`) changes no core file that fit-2 changes; section 6 gives what fit-2 adapts in each landing order of relaunch and fit-1 (the order is not decided; the recommended one is relaunch first) |
| **OQ-F12** (new) | The size of the round | **(a) One round** of 8 commits (L, about 1,900 product and 3,900 test lines). **(b) Two rounds:** fit-2a = commits 1 to 4 (F-3, F-4 with P, the claims and the publication rule, the dispatch, the step-7 refusal), fit-2b = commits 5 to 8 (admission, CLI, F-9, status, docs). After fit-2a, fit-1's interim guard (note 2 included) still refuses at startup, and a kept failed launch is retired by hand until fit-2b | **(b)**: fit-2a (8.1) and fit-2b (8.2), each with its own review | new | **size and notes**: the new sizes; with (b), fit-2a needs its own interim recovery notes in `docs/DEVELOPMENT.md` (a kept failed launch, P, the unwritable warning and the damaged-handle refusal of restore, each with the by-hand retirement), because F-9 and its docs come in fit-2b (sol note) |
| **OQ-F13** (new in r10) | A project-mode Herdr orchestrator record whose pane runs while its agent shows exited (note 2's second case, R10.3) | **(a) Reuse** (G, T-7.3d). The goal of fit-2's startup rule is narrow: no new launch next to an earlier Herdr launch. A reuse starts nothing, so it cannot make a second launch. G and R read no activity by design: they judge a record by its stored fields and the runtime's answer for its pane. r11 (sol m-3), the correct agent facts: codex, gemini and opencode take the core Herdr process check (`herdr.ts:520`), which rejects when herdr cannot answer (`herdr.ts:399-410`); they do not answer `false` for an error (r10 said so; that was wrong), and claude-code rejects too. An empty pane ID is a separate case (no call, `[]`). The lifecycle counts an agent's negative only after a runtime positive (`lifecycle-manager.ts:662`). **The trade-off:** a successful `ao start` can reuse a pane whose agent exited; the owner attaches (`ao session attach <id>`) and sees the shell, and can then retire the record (F-9). **(b) Block, as note 2 does:** R gets an agent check (`isProcessRunning` under the probe bound) in the rounds, and the owner must attach or retire; more calls per start, and an agent check that answers "not running" for a live agent blocks a live orchestrator | **(a)**: the owner approved this changed note-2 outcome on 2026-10-23 (D-9) | | new: (a) changes note 2's refusal into a reuse for this one case |

The owner decided OQ-F1 (b), OQ-F2 (a) and OQ-F3 (b) earlier, and OQ-F4 to OQ-F13 in r11's base (section 2.3). The r6 questions OQ-1, OQ-2, OQ-6 (fit-1
implements their (a)), OQ-5 (W-4 later), OQ-7 (admission in core, strict records, the selected runtime's
readiness) and OQ-9 (no handoff for a record without S) keep the recommendation (a); fit-2 follows it.

## 12. Measurements, deviations and checks

- **Measurement r11: none.** r11 measured nothing and added no fixture. Every new fact of r11 is read from the
  code with `git show`, `git diff` and `git grep` (`ee3534d7`, `60da85ee`, `9f20ce29`, `b08e8141`, `804d1347`,
  `43783d3d`, `d3e2ed8c`) or from the checks, the decisions and the router log. One read-only `git merge-tree
  --write-tree` per relaunch candidate with `60da85ee` gave the conflict paths of R.3 (it writes tree objects,
  no ref). The isolation names of the brief (`/tmp/aohd8-marker`, `/tmp/aohd8`, `aohd8-<n>`) were not used.
- **Measurement r10: none.** r10 measured nothing and added no fixture. Every new fact of r10 is read from the
  code with `git show` (`ee3534d7`, `9f20ce29`, `a6d7c4b0`) or from the reviews and the landing checks. The
  isolation names of the brief (`/tmp/aohd7-marker`, `/tmp/aohd7`, `aohd7-<n>`) were not used.
- **Measurement r9** (section 3.1): the isolation of the step 2 brief with the names of this round: marker
  `/tmp/aohd6-marker`, root `/tmp/aohd6`, a scratch `HOME` and XDG directories, a git identity in the scratch
  `~/.gitconfig`, `env -i` and a link-only `PATH` (`herdr` linked, never moved; `python3`; `strace`; `node`).
  No herdr server, no tmux, no `ao`, no network: 2 `connect()` calls, both `AF_UNIX`. Fixtures:
  `r9_cli_forms_log.txt`, `r9_forms_script.txt` (the Python script as text), `r9_strace_connects.txt`,
  `r9_admission_subject_check.txt`, `r9_admission_subject_script.txt` (the Node script as text). Cleanup: no own
  process, the herdr directories unchanged, `~/.ao/bin` unchanged, `/tmp/aohd6` and the marker removed.
- **Deviations from r8.**
  1. The CLI's reuse of a Herdr record moved into core (`findReusableOrchestrators`, a new `SessionManager`
     method).
  2. No Herdr call runs under A; the reuse probe runs between admission rounds (r8: one probe under A).
  3. Restore writes P and its claim after step 7 and before the workspace restore (r8: before step 9), also
     for a worker restore.
  4. For a set runtime, every rollback with a handle whose record is not its own removes nothing (r8: the
     partial path only).
  5. `recordMayOwnRuntime` treats a `createIncomplete` handle as "may own".
  6. The token is renamed "identity token" (relaunch's `launchToken` key), and the retire key
     `retireToken` is renamed `retiredIdentityToken`.
  7. Every claim clear compares the own claim values, also the clear of a prepared tmux launch; and
     `keepUnconfirmedLaunch` clears the own claim for every runtime (today it keeps it).
  8. A core 10 s bound on each probe, and on each stop under A (also tmux).
  9. 17 product files (r8: 14, or 15).
  10. Doc 0004: the fit-1 state (implemented on a branch, not landed), the fit-2 pointer (r9), and the r9
      `pane run` fact.
- **Deviations in r10** (each from r9, and each needed by a finding or by a changed base fact).
  1. A thrown own publication is not a replacement: the publication rule reads the record once and retries
     once; an unwritable record keeps every resource and its live claim (sol M-1). A spawn or start whose
     handle write throws becomes a kept failed launch with the returned handle (it was today's rollback).
  2. A claimless restore rollback keeps every claim value (sol m-1).
  3. Spawn and start write the launch fields before `create` for a set-runtime launch without
     `prepareAgentSession` (sol m-4): a new pre-create write; `preparedCreatedAt` is renamed `preCreateAt`.
  4. Restore refuses at step 7 a damaged handle that the predicate accepts (Muse m-3; today it skips the stop).
  5. The CLI routes its candidates by the core predicate `isUnprovenLaunchRecord` (Muse m-2), a new export.
  6. Note 2's refusal of a project-mode Herdr record whose pane runs and whose agent shows exited becomes a
     reuse (OQ-F13 (a)). Every other note-2 refusal stays a refusal (R10.3).
  7. `HerdrEndpoint` gets `compatible`, `version` and `protocol` (sol m-3; r9 named only `compatible`).
  8. T-7.21c's D2 is split into D2-a and D2-b; the barrier stage is `before-reservation` (sol m-2).
  9. The fit-1 base is `ee3534d7` (note 2). Section 6 is read against `9f20ce29`.
  10. Doc 0004: only the fit-1 tip (`ee3534d7`, note 2) and the fit-2 pointer (r10).
- **Deviations in r11** (each from r10, and each needed by a finding, a changed base fact or the owner's
  decisions).
  1. The publication rule fixes `before` and `after` once, and a strict read follows every undecided attempt,
     the retry included; a `null` alone proves nothing (sol M-1, M-2). The rule makes at most two writes and two
     reads.
  2. The spawn and start handle write is a publication for a create runtime in the set. A handle write that
     throws once is retried, so the launch can succeed (r10: a kept failed launch). r10's adoption in the
     rollback, the flag `handlePublished` and the post-create `partialRecord` are removed.
  3. The unwritable path settles on `before`, then on `after`, and its warning has new variants; no warning
     states an unproved record state (sol M-2, Muse m-2). A settlement `null` gets one strict read and one more
     attempt while the record still holds the identity and the own pair.
  4. The step-8 write-back warning of restore says what may hold, not what holds.
  5. T-7.9b counts the enrichment call of `sm.list` (sol m-1); the first real-core interim describe is split by
     persisted status (sol m-2); 5.3.10 and 5.2.7 cite tests by label (Muse m-1; the `fit-reads.test.ts` lines
     of r10 were those of `9d51982b`).
  6. OQ-F13's text is corrected (sol m-3); OQ-F4 to OQ-F13 are decided (D-9).
  7. The split into fit-2a and fit-2b (OQ-F12 (b)) adds a docs commit 4d to fit-2a, moves the create comments
     to commit 3, gives fit-2a its own interim notes and texts that name the by-hand retirement (commit 7
     changes them to F-9), adds T-7.8a for the start sites under fit-1's interim guard, and defers the
     fit-2b assertions of T-4.11, T-4.12, T-4.16, T-4.17, T-4.20c and T-4.20d.
  8. The base is fit-1 `60da85ee` and `main` `d3e2ed8c`; relaunch first (section 6, 8.1).
  9. The size: about 1,950 product and 4,150 test lines (r10: 1,900 and 3,900).
  10. Doc 0004: the fit-1 tip `60da85ee` and the fit-2 pointer r11.
- **Checks.** `git status -s` shows only this file, doc 0004 and the `.agent_*` files (r11 adds no fixture);
  `git diff --exit-code -- packages` passes.
