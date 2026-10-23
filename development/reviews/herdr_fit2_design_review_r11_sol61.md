# Herdr fit-2 design r11 check — 2026-10-23 (sol61)

SOUND-WITH-CHANGES

Counts: **0 blocking, 0 major, 2 minor**. All seven r10 findings are closed
at design level. The publication algorithm now covers the replacement and
retry schedules that failed r10. The two new minors concern consistent
caller instructions and a missing settlement-null test. Neither requires
a new protocol or owner decision.

Scope: the narrow r10→r11 change, alone, against fit-1
`60da85ee` and the relaunch code actually merged into main at `7328d710`.
Worktree HEAD was `6b31b760`. No implementation, live measurements, network,
agent processes, commits or PRs are part of this check.

## Independent reading and isolation

Read the Muse r10 check in full, then all 746 changed lines of the r10→r11
diff before reading the author's report. The note's newer base facts take
precedence over the design's historical pre-merge main/candidate descriptions.

At the start, created `/tmp/aofr11-marker`. Initial
`ls -la --full-time ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Disposition of the seven r10 findings

References to fit-1 below mean `git show 60da85ee:<path>`; references to
landed main mean the checked-out source, whose `packages/` tree equals
`7328d710` (`git diff --exit-code 7328d710 HEAD -- packages`).

| r10 finding | Disposition | Own evidence and r11 answer |
| --- | --- | --- |
| sol M-1: adoption uses the judged record's identity | Closed | §4.5 fixes `before` and `after` from the last owned record and exact updates before the first attempt. `restoredAt` belongs to `LAUNCH_IDENTITY_KEYS` (`core/metadata.ts:331`), and missing keys compare as empty (`:351`). Thus H/T0/empty-restoredAt cannot adopt H/T0/T1, even with the same resident PID/start pair. Spawn/start now publish at their success write; rollback step 1 has no adoption. T-4.20g requires replacement bytes unchanged in both process-pair variants. |
| sol M-2: retry after effect strands the claim; uncertain null treated as replacement | Closed | §4.5 reads strictly after every undecided attempt, including the retry and a null. This is needed because `metadata.ts:663` returns null before acquiring the lock, while `:666` also returns it for an actual mismatch. `own.write` advances its owned snapshot only after the writer returns (`fit-1 session-manager.ts:1754–1758`). T-4.21a–c cover retry effects at the success, restore-partial and rollback-partial sites; T-4.21d covers the uncertain publication null. Final settlement has fixed before/after candidates and uncertain warnings. New m-2 below requests a separate test of the newly added ordinary-settlement null recovery. |
| sol m-1: T-7.9b ignores list enrichment | Closed | §5.3.10 now logs list start/return, counts one `isAlive` inside each real list, then zero after the final list. Fit-1 `session-manager.ts:1532–1550` falls back to the project's runtime when `runtimeName` is absent; `list` invokes that enrichment at `:2968`. The D2 split by parsed runtimeName causes an additional call in CLI routing. No product exception is introduced to satisfy the count. |
| sol m-2: killed rows assigned unproven | Closed | The real-core describe is split by persisted status: working/negative is unproven, killed is not-reused. The original parameter rows are at `fit-1 cli/.../start-herdr-interim.test.ts:320–324`; persisted status is checked at `:347`. R6 reads that stored status, independently of the list's in-memory enrichment. Record, no-prefix and no-create assertions remain. |
| sol m-3: OQ-F13 falsely says agents return false on errors | Closed | §11 now says checks reject and states the actual policy trade-off. Codex `:581–582`, Gemini `:194–195`, OpenCode `:1341–1342` return `isHerdrProcessRunning` directly; core `herdr.ts:399–410` rejects errors and `:524` awaits it. Empty-ID/absence paths are distinct. D-9 explicitly preserves decision (a) after correcting this premise. |
| Muse m-1: six stale start.test line citations | Closed | §5.3.10 uses the exact six `it` labels and parameter labels. Verified at fit-1 `cli/.../start.test.ts:1313`, `:1329`, `:1357`, `:1378`, `:1394`, `:1407`. The analogous fit-reads citations also now use labels; verified at `:207`, `:226`, `:282`. |
| Muse m-2: unwritable warning asserts pending handle | Closed | §4.5 distinguishes a successful conditional settlement on before, on after, and an unconfirmed settlement. Only the successful writes establish the snapshot described. The last variant says the claim may remain, the handle may be on disk, and names all four fields to inspect. T-4.20c/d and T-4.21e(1) check these different texts. |

## Publication rule and the changed callers

The fixed inputs make this a bounded ownership decision. For the r10 M-1
witness, let before hold P, `createdAt=T0`, no `restoredAt`, and no reservation;
let updates publish H without writing `restoredAt`. The intended after has H
and empty `restoredAt`. A replacement with H and `restoredAt=T1` matches
neither identity. The r10 expression merged updates into that replacement and
therefore accepted T1; r11 never derives a comparison value from it. Comparing
only the claim pair would not repair the same-process variant; r11 compares
the fixed launch identity too.

All four strict-read outcomes have an explicit result after each attempt:

| Strict read | Attempt 1 | Retry |
| --- | --- | --- |
| fixed after | Adopt written record and continue | Adopt written record and continue |
| fixed before | Retry identical updates once | Unwritable |
| another identity or no record | Not own; preserve everything | Not own; preserve everything |
| read error | Unwritable | Unwritable |

The retry reuses the exact timestamp-bearing updates. It cannot introduce a
fresh `restoredAt` that makes its own read-back look foreign. A null is
reconciled exactly like a throw. `readRecordStrict` has the required distinction
at fit-1 `session-manager.ts:190–193`: a failed `readMetadataRaw` is followed
by the strict file-presence check, so an unreadable record is not absence.

On unwritable, all runtime/workspace/agent/copy-back cleanup is bypassed.
Settlement first compares before plus the own pair; on null it compares
after plus that pair. A throw ends that best-effort settlement with the
uncertain variant. This is conservative: an I/O failure can leave the claim,
but the warning says so and no destructive fallback runs. Both-null also
uses the uncertain variant; neither null proves a replacement. When there
is no own claim, no claim values are cleared. When the record holds a later
claim pair or neither fixed identity, neither settlement can modify it.

The caller changes are coherent:

- Worker and orchestrator success writes use `own.publish` for a create runtime
  in the set. A one-shot failed publication that is recovered can now succeed;
  T-4.20f correctly removes r10's required rejection/`launchFailed` result.
  Source sites are fit-1 `session-manager.ts:2343`/`:2894`, landed main
  `:2651`/`:3211`.
- A post-create catch forwards the publication error and own claim, without
  `partialRecord`. `LaunchRecordUnwritableError` selects rollback step 0 and
  carries the original fixed identities. That prevents another publication
  attempt or destructive cleanup after the bounded rule has ended.
- `partialRecord` remains only on the typed create-partial catch. Rollback
  publishes that partial through the same rule, advances own, writes the
  failure marker and settles on the refreshed identity. The old rollback
  adoption and `handlePublished` are removed from the active instructions.
  Their appearances in R10 are explicitly historical.
- Restore step 9 partial and step 10 success use the same rule, then settle
  on the publication result. A proven not-own result preserves the runtime.
  Step-8/plain-create rollback still compares `publishedClaim` and clears
  only a non-null own claim.

The pre-runtime reservation, pre-create and transition writes are expressly
outside this rule. §4.5 now records the after-effect throw limit: no new runtime
exists yet, and a P/claim/workspace can remain for manual retirement. This is
not a promise that every non-runtime write has been reconciled. Same-ID R3
and the older in-flight restore/kill M-6 window remain outside this round.

## Test schedules and red reasons

These are source/design checks; no proposed fit-2 implementation exists here,
and no tests or live Herdr commands were run.

| Test | Why it distinguishes the change |
| --- | --- |
| T-4.20a/b | Today's publication error propagates without the read/retry/settle sequence; the resident claim remains. The new result requires the handle and cleared claim. |
| T-4.20c/d | Today's path lacks the unwritable protocol. Persistent pre-effect errors must preserve resources and warn uncertainly; when final writes recover, before is settled and P remains. |
| T-4.20e | Replacement control requires byte equality/no retry or settlement. The after-effect control requires adopting fixed after and finishing successfully. |
| T-4.20f | Today's handle-write throw rejects into rollback. R11 must recover inside publication and finish with no failure marker or warning. |
| T-4.20g | The T1 replacement must remain byte-equal, with both another process pair and the resident pair. The r10 path would write `launchFailed`, and clear the resident pair. D2 must restore that old path coherently, including its post-create partialRecord/adoption inputs, or mutate after's derivation directly; re-adding an unreachable rollback branch alone would not test it. |
| T-4.21a/b/c | R10 does not read after the retry throws. The success case would become unwritable and the partial cases would fail to settle on the newly published handle. Each site now requires that second read. |
| T-4.21d | R10 treats the metadata writer's false directory-existence result as a replacement. The injected null is specifically before publication; retry and success are required. Its real replacement control must still avoid all writes. |
| T-4.21e(1) | The retry commits, then both it and the read fail. Settling only before leaves the claim; the required after settlement catches that mutant. |
| T-4.21e(2) | A replacement before the second read must be classified not-own, with byte equality and no settlement. |
| T-7.9b | The real list is retained and its calls logged separately. A CLI split by parsed runtimeName alone adds a post-list probe, so the test can fail for the stated routing defect. |
| T-7.8a | Before G exists, misdispatch would call tmux with the Herdr handle. The Herdr-plugin and missing-plugin cases both require zero such calls under the interim guard. |

I found no remaining misjudged publication interleaving among these schedules.
The coverage omission below concerns the distinct ordinary settlement path,
not the publication retry rule.

## New findings

### m-1 — The relaunch adaptation still specifies one unwritable settlement attempt

**Design:** §6, "Who adapts", line 1709: "fit-2's unwritable path makes one
attempt". This is active adaptation guidance, distinct from the explicitly
preserved historical R10 section. **Code where it applies:** landed main
`packages/core/src/session-manager.ts:5337–5356` (the closures to extract),
with `packages/core/src/metadata.ts:663` (null is not conclusive).

§4.5, §6's later publication paragraph, and §8.1 correctly require before,
then after on null. Following the earlier one-attempt instruction would
retain the r10 M-2 failure when the publication committed but read-back
failed: before no longer matches, while after could settle the claim.
T-4.21e(1) is correctly designed to reject that implementation, so this is
an internal wording inconsistency, not an unresolved algorithmic major.

**Required change:** replace "one attempt" with the two fixed-identity
conditional attempts of §4.5, while retaining relaunch's later retries.
Keep the regular settlement's null/read/retry handling inside the helper;
caller summaries such as restore step 12's "null: nothing" then refer to
the helper's final result, not a raw `updateMetadataIf` null.

### m-2 — No proposed test exercises an uncertain null in ordinary claim settlement

**Design:** §4.5, "The settlement write", adds strict read + one retry when
settlement returns null but the record still holds the identity and own pair.
§5.2.8/§8 list the new tests. **Code where it applies:**
`packages/core/src/metadata.ts:663`; fit-1
`packages/core/src/session-manager.ts:2360–2366`, `:2913–2920` and restore's
end path; landed main's extracted settlement target at `:5337–5347`.

T-4.21d injects the false `existsSync(sessionsDir)` specifically at the
publication attempt in restore step 10. T-4.21e tests the final unwritable
settlement, which intentionally has no read/retry. T-4.16b tests a thrown
settlement, and T-4.18 tests an actual different claim. None requires the new
ordinary-settlement null reconciliation. A mutant that keeps publication
recovery correct but restores the old "settlement null: nothing" behavior
can pass all those schedules and silently leave a resident process's claim.
The protocol text already supplies the correct behavior; this is a missing
regression test of its additional branch.

**Required change:** add a resident restore success test that makes only
its first ordinary claim-clear return uncertain null, with the record still
holding the returned handle and own pair. Require one strict read, one
retry, no warning, and no claim; `kill` must refuse with Herdr unknown rather
than launch-in-progress. Add a control that installs a later claim pair
before the read and requires byte equality/no retry. D2 removes only the
ordinary-settlement null read/retry, leaving publication recovery intact.
Include this test in fit-2a commit 3; it needs neither G nor F-9.

## fit-2a scope and the remaining fit-2b work

§8.1 is sufficient to write the first implementation brief, subject to the
two minor corrections above. The scope is commits 1–4 plus docs commit 4d:

| Part | fit-2a outcome |
| --- | --- |
| Commit 1 | Additive error guards/contracts, runtime set/predicate, rule Q, identity token and admission-lock API with unit tests. The G/preflight callers wait for fit-2b. |
| Commit 2 | Blocked-send refusal through plugin, core and CLI; changes the existing blocked-as-settled oracle and adds T-3.x. |
| Commit 3 | Plugin create qualification/no close, P and pre-create fields, partial handling, publication/settlement and restore changes without A. Names the index/fit-reads/fit-pins/core-herdr oracles and T-4.x. Keeps relaunch token/time and the extracted settlement behavior. |
| Commit 4 | Dispatch each old handle through its runtime; missing Herdr plugin refuses/skips probing as specified; damaged restore refusal. T-7.8a covers startup before G, with T-7.8c/d/e and T-7.26d. |
| Commit 4d | Ship create contracts and interim recovery notes with this code. All retirement hints use the by-hand recipe until F-9 lands. |

The nine product paths are complete for that scope: core `runtime-errors.ts`
(new), `types.ts`, `index.ts`, `herdr.ts`, `metadata.ts`, `delivery-lock.ts`,
`session-manager.ts`; runtime-herdr `index.ts`; CLI `send.ts`.
`runtime-stop.ts`'s classifier-related work is in commit 5; dispatch can
handle a missing runtime at each caller without changing the existing
`stopRuntime(runtime: Runtime, handle)` signature (`runtime-stop.ts:162`).
No agent plugin change is required by fit-2a.

The split moves the right oracles and docs together. Commit 3 changes both
successful-create mock call queues and failed-create close expectations,
including `fit-pins.test.ts`; the endpoint's two exact-object tests gain
compatible/version/protocol. The create comments also move in commit 3.
The source fixtures confirm compatible true/version 0.9.5/protocol 22 for
the running status and compatible/version/protocol null for no-server;
the proposed resolver normalizes compatible to false in the latter case.

The assertions requiring later features are explicitly deferred: F-9 hints
and action (T-4.11/T-4.17), status display (T-4.12), G's start blocks
(T-4.16/T-4.20c/d). Warning texts use the manual recipe in fit-2a and migrate
with their oracles in commit 7. The interim CLI/core test expectations stay
unchanged through fit-2a. The docs retain fit-1's guard and state its limits:
P is unprobeable and refuses; a kept failed pane that answers alive can be
reused; direct isolated core start still has the known fit-1 gap. These are
explicitly retained behavior, not half-installed G paths.

A kept partial or P never enters the ordinary failed-create destructive
rollback. Herdr stop stays unknown, kill keeps resources, and restore of a
kept failed launch refuses at step 7. Sparse/crashed P records and an
unwritable record have manual recovery notes. Thus fit-2a's new resource
preservation does not depend on fit-2b's unimplemented F-9 action. The split
makes no claim to finish startup admission before fit-2b.

§8.2 correctly leaves commits 5–8: G/A/R and reuse, CLI start/preflight,
F-9/status, and final docs. Its 12 paths overlap fit-2a in four, giving the
original 17-path union. It removes/replaces the interim guard and docs then.
The per-commit build/typecheck/lint/changed-package tests, full scratch-home
run after 4d and 8, unchanged red-defect set and both rounds' relaunch tests
are coherent gates. They remain implementation requirements, not results
of this design check. The size split is reasonable; commit 3 is still the
main implementation risk.

## Relaunch on actual main and the owner decisions

The note's merge is present locally. `7328d710` has parents `b08e8141` and
`d3e2ed8c`; HEAD's product tree equals that merge. A second check,
`git diff --stat 804d1347 7328d710 -- packages`, is empty. Therefore the
candidate-based core facts of §6/§8.1 also hold for the actual main code.
The historical pre-merge text is superseded by this note; do not treat its
unselected landing candidate as a current dependency or use origin/main.

The relaunch-first adaptation is accurate:

- Spawn/start store the token and its time alongside `createdAt`, with one
  `launchCreatedAt` value (main `session-manager.ts:2631–2645`, `:3194–3206`).
  `launchedRecordFor` must preserve both keys and reuse preCreateAt.
- The own-pair settlement closures are at `:5337`/`:5349`. Extracting them
  with an optional identity comparison preserves relaunch's absence
  write-back and background retries while enabling fit-2's fixed identities.
- `lastLaunchBinding` requires `launchTokenAt === lastLaunchValue(raw)`
  (`:334–340`); that last value prefers a valid `restoredAt` (`:325–327`).
  A fit-2 restore invalidates the prior binding as described.
- Relaunch rejects a live owner (`:5017`), a reservation (`:5024`) and a
  Herdr handle (`:5052–5055`), including P once it reaches that test. Clearing
  reservationId before create does not make P relaunchable.
- The tmux foreground reader and send retry sit at `:4030` and `:4341–4363`;
  fit-2's refusal belongs before that restore retry. Runtime's optional pane
  APIs are at `types.ts:353`/`:362`, SessionManager.relaunch at `:1826`.
  These are the adjacent type/export/send changes the design names.
- Round 6 changes only the Claude Code conversation implementation and its
  test (`git diff --name-only 9f20ce29 b08e8141 -- packages`). Main's UUID
  guard at `agent-claude-code/src/index.ts:1462` runs before the failure mark
  read (`:1472` onward); it adds no fit-2 product path.
- The actual main diff against d3e2ed8c lists exactly the 15 test files in
  §8.1: four core, three CLI, three Claude Code, one Codex, one Gemini and
  three runtime-tmux tests. Both rounds can retain that gate.

M-6 is still stated in actual main `session-manager.ts:4978–4981`: restore
or kill already in flight before a claim is not excluded. fit-2's transition
comes after the old-runtime stop and F-9 takes no per-ID lease. The design
correctly does not claim completion of R3 or M-6.

All ten choices in §2.3/§11 match D-9 (`development/TODO_TRACKING.md:580`
onward): F4(a), F5(a), F6(a), F7(a) with R-Q accepted, F8(a), F9(a), F10(a),
F11(b), F12(b), F13(a). The newer relaunch-first landing fact is compatible
with F11's second-landing adaptation policy. I concur with the recorded
choices within the stated scope. F13 now grounds reuse in the no-new-launch
goal and explicitly allows attaching to an exited agent's shell; no agent
error is being reclassified as negative evidence. No new owner question is
needed. R-A, R-Q, hidden-server/RH limits, W-4 and the same-ID limits remain
accepted or deferred as the design says.

## Cleanup and verification

Final `ls -la --full-time ~/.ao/bin` exactly matches the initial listing
above: the same four files, sizes, modes and modification timestamps. This
is a listing comparison, not a content-hash check. No review command wrote
that directory.

The required scan was run after the review body was written:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr11-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path was:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
```

The scan records concurrent real-state activity without attributing its
writers; I did not inspect those records' contents or issue an AO command.
Protected sessions, workers and panes were not touched. No background or
runtime process was started by this review; every foreground command
returned. No kill, tmux, herdr, gh, ao, agent/model, node or pnpm command ran.
No scratch environment was needed; `/tmp/aofr11` was never created. The
marker and report-assembly temporary files are removed at completion.

`git diff --exit-code` passed: no tracked file changed. Status showed only
this new review and the externally supplied `.agent_task.md`,
`.agent_note_1.md`, `.agent_note_2.md` and required `.agent_report.md`.
Only this review and the required report were written in the worktree.
No commit, push, PR or network action was performed. Build/test results
are intentionally absent: this is a source/design review under the note's
isolation rules, not an implementation validation.
