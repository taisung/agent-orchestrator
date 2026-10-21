# Killed-status review, round 6

**NOT-LAND-SAFE — 0 blockers, 5 majors, 1 minor.**

Reviewed `7294d978..0d3c05fe`, HEAD `0d3c05fec485b3041ba8ef8b39f4da22f9f6a1b6`. Whole-fix verdict: `0e3eabc2..0d3c05fe` is not land-safe under the owner policy. Findings are numbered afresh below. The majors require fixes; the zero blocker count is a severity count, not permission to land.

The original three race reproducers now preserve the replacement resources. The remaining problems are in the completeness of the rollback ownership decision, public API compatibility, and the other workspace removal paths that the brief asks to assess. Passing tests do not cover those cases. The author disclosed the API incompatibility and create-cleanup limit; their being outside the chosen implementation approach does not make them owner-deferred.

## Round-5 findings

| Prior finding | State | Independent result |
| --- | --- | --- |
| M-1: orchestrator delete ignores replacement of its own ID | **Fixed for destructive retry safety** | Own replacement case makes one API removal call; the replacement survives and stale start rejects. Gone reservation also stops retries; unchanged reservation retries twice. Worker issue-delete unchanged. The claimed next-start retry has the separate minor m-1 below. |
| M-2: worktree destroy waits/fallback remove replacement | **Fixed in destroy and its core callers** | Actual plugin keeps files in both reported windows and kill rejects. Unchanged fallback works. Direct false/throw checks prevent both attempts. Additional create/postCreate paths are M-4/M-5 below. |
| M-3: prepared discard waits/retries without checks | **Partly fixed** | Both reported same-ID takeover schedules now retain the session. Direct callback throws are safe. Core can still answer yes after an unreadable ownership record or after another AO ID reuses the prepared session: M-1/M-2 below. |

## New findings

### M-1 — A failed ownership read permits prepared-session removal and runtime destruction

**Location:** `packages/core/src/session-manager.ts:1533–1544,1556–1567`.

Rollback's `check()` catches an error from `own.check()` and returns `{ state: "replaced", current: null }`. The worktree decision treats replaced as a reason to retain, which is safe. The prepared decision instead looks for a matching value in current/latest archive; with current=null and no matching archive, it concludes there is no owner and returns permission. The runtime condition also treats current=null as evidence that no record owns the runtime name. Thus “unknown because reading failed” becomes deletion authority. The plugin correctly catches an exception thrown by its callback, but core has already hidden this exception.

Independent built-core/actual-OpenCode-plugin reproduction uses real scratch file permissions, not a mocked metadata answer:

1. Spawn with a prepared `ses_prepared`; fail post-launch setup so rollback runs.
2. During its awaited interrupt, delete the original record without archiving, reserve the same ID and publish a replacement naming `ses_prepared`.
3. Set that replacement file's mode to000. Reads of the actual file now throw EACCES; no prior matching archive is present.
4. Observe the API removal request, restore file permissions and read the intact replacement record.

At `2026-10-21T04:10:40.524Z` the replacement is generation5, the file becomes unreadable, and `remove(ses_prepared)` is called anyway. At `.525Z` its metadata is unchanged. A second case makes the file unreadable before rollback: at `.539Z` core also requests destruction of `rt-created`, the same runtime name named by the replacement; at `.540Z` it requests session removal. Runtime/API boundaries were stand-ins; these are destructive requests, not real agent/process deletion. The permission change and record operations were real, and permissions were restored.

This violates the explicit rule that a failed check keeps the resource. Preserve an explicit unknown/error outcome, or propagate it to a handler that retains and reports the resource. Do not represent an unreadable record as proof of absence. Cover both prepared discard and the runtime branch, including a no-archive case. This is not the deferred final-check-to-command window: the failure is already known when permission is granted.

### M-2 — Prepared rollback ignores a different AO session that normally reuses its OpenCode ID

**Location:** `packages/core/src/session-manager.ts:1556–1567`; normal issue reuse at `:826–858,1038–1048`.

`namedElsewhere` only inspects the failed launch's own AO record and its latest archive. Another AO session can reuse the prepared OpenCode ID through the normal issue-reuse path. Rechecking the same incomplete predicate before every removal does not protect that other holder.

Own reproduction uses two actual `SessionManager.spawn` calls, distinct managed workspace paths, the actual OpenCode prepare/discard implementation, and API/version function stand-ins. No metadata replacement is needed:

1. Start `kr-1` for `INT-1`, creating `ses_prepared`; fail its post-launch setup.
2. Inside rollback's interrupt await, start `kr-2` for the same issue with the default reuse strategy. It finds the first record's stored mapping and returns successfully on `ses_prepared`.
3. Resume the first rollback and observe removal.

```text
2026-10-21T04:14:03.820Z kr-2 spawn returned; active generation6 names ses_prepared
2026-10-21T04:14:03.821Z kr-1 rollback calls remove(ses_prepared)
2026-10-21T04:14:03.824Z kr-1 record released; kr-2 record still names ses_prepared
```

The first launch still owns its own record, so `namedElsewhere` returns false even though another active record names the session. The new plugin test schedules only replace/archive the original AO ID and miss this case. Extend the per-attempt decision to other AO records naming the prepared agent session, as the kill/purge paths already do. Do not exclude other owners just because this call originally created the session. Test normal same-issue reuse during both the interrupt and a failed removal.

### M-3 — Workspace.destroy breaks the stable public TypeScript API

**Location:** `packages/core/src/types.ts:740`.

The optional callback is compatible with an older implementation; changing `Promise<void>` to `Promise<"kept" | undefined>` is not. Existing plugins explicitly returning Promise<void> no longer satisfy Workspace. Existing callers storing destroy as `(path: string) => Promise<void>` also fail. CLAUDE.md calls the core public API stable; this interface is exported through that API. A single retained workspace plugin does not remove the external compatibility contract.

Independent strict TypeScript compilation against the newly built declarations produced TS2322 for both:

```ts
const legacyDestroy = async (_path: string): Promise<void> => {};
const legacyPlugin: Pick<Workspace, "destroy"> = { destroy: legacyDestroy };
declare const currentPlugin: Workspace;
const oldCaller: (path: string) => Promise<void> = currentPlugin.destroy;
```

The diagnostics are respectively `Promise<void> is not assignable to Promise<"kept" | undefined>` and the reverse incompatibility for the old caller. No assertions or casts are involved.

A compatible form exists. Keeping the original Promise<void> return while recording refusal inside the callback preserves both old plugins and old callers; kill already records refusal this way, rollback ignores the result, and recovery can retain an explicit refusal flag. If a result is desired, an overload preserving `destroy(path): Promise<void>` and exposing `Promise<void | "kept">` for the callback form also passed a separate TypeScript compatibility fixture. That union needs a deliberate lint exception or a different representation under this repository's no-invalid-void-type rule; it is not a reason to silently break the public API. A simple union without preserving the old one-argument signature fixes plugin assignment but still breaks the old caller example.

The earlier test mock's new `return undefined` accurately reflects runtime behavior, but it also demonstrates the type break. Rate: **major, fix before landing**.

### M-4 — Create's checkout-failure cleanup still removes a replacement worktree

**Location:** `packages/plugins/workspace-worktree/src/index.ts:140–146`.

The branch-exists path awaits worktree add and checkout, then removes the shared path on checkout failure without checking the reservation again. Having added this path earlier in the call does not make it exclusive after the reservation is killed or replaced. The author acknowledges this window; it is outside destroy but within the stated rule for every removal attempt.

Own built-core spawn used the real plugin create method with a Git boundary stand-in. The first add reports branch already exists; the second creates the scratch directory. During checkout, the actual manager kill removes the reservation, then public metadata functions reserve/publish a replacement at the same path and write a replacement marker. Checkout fails. The plugin requests `git worktree remove --force` for that replacement path; the boundary stand-in performs the requested scratch deletion.

```text
2026-10-21T04:12:39.936Z reservation kill returned; active record absent
2026-10-21T04:12:39.938Z replacement generation3 and directory exist
2026-10-21T04:12:39.938Z worktree remove --force requested with replacement present
2026-10-21T04:12:39.939Z workspace absent; replacement record survives
```

This used a non-preparing mock agent, matching the reservation behavior of agents without an OpenCode prepare hook. It did not bypass the live-launcher guard to perform the reservation kill. The replacement publication used the same public metadata operations as the supplied ownership tests. Add an ownership check at this cleanup attempt, or an equivalent exclusive resource guarantee. **Major, must fix**; there is a clear check location after the checkout await. It is not a single-command window after a valid final check.

### M-5 — A stale workspace creation result reaches destructive postCreate setup

**Location:** `packages/core/src/session-manager.ts:1699–1710,3954–3966`; removal in `packages/plugins/workspace-worktree/src/index.ts:372`.

Worker spawn calls postCreate after awaiting create without checking that its reservation still owns the path. Restore similarly calls postCreate after awaiting workspace restoration; its ownership check comes afterward. The worktree plugin recursively removes configured symlink targets before installing links. A stale operation can therefore delete a replacement launch's files before the later record write rejects it.

Own built-core spawn used the real postCreate method with `symlinks: ["shared"]`. While the create boundary is paused, actual manager kill removes the original reservation, public metadata functions publish a replacement, and the replacement writes `shared/replacement.txt`. Returning the stale workspace result lets postCreate remove that directory and install a symlink to the project's shared file.

At `2026-10-21T04:12:39.948Z` kill succeeds; at `.950Z` the new generation3 record and file exist; at `.951Z` the file is absent and `shared` is a symlink. Core then rejects the stale launch's write and leaves the replacement record unchanged. This deletion is the real plugin's rmSync, not a simulated Git result.

The symlink loop has no internal await before these removals, but the caller's preceding create/restore await already invalidates the assumption of ownership. Check immediately before entering this destructive setup and carry the ownership decision to any internal removal steps that need it. Cover both worker spawn and restore. **Major, must fix**; not an exclusively owned temporary resource or the deferred final-command interval.

### m-1 — A retained orchestrator session is hidden by an archived empty reservation

**Location:** `packages/core/src/session-manager.ts:1018–1028,849–854`.

Keeping the OpenCode session when the start's own record disappears is conservative and correct. The comment/report claim that the next start retries it is not always true. If another operation archives that reservation, the newest archive has only reservationId/generation. The earlier archive still has the retained OpenCode ID, but discovery reads only the newest copy per AO ID.

Own gone-reservation probe at `2026-10-21T04:07:27.497Z` returns the expected removed-record error after one failed removal. Latest archive: reservation only. A second delete-strategy start at `.500Z` succeeds with **zero additional removal calls**. Enumerating scratch archive files at `.501Z` finds `ses_retained` only in the older file. No operator message identifies the retained session. The first stand-in failure leaves that session existing.

This is a retry/discoverability defect, not another unsafe deletion. Preserve a reachable pending mapping or at least identify the retained ID and manual recovery route, and correct the next-start claim. Older raw archive data remains available for manual recovery; this is not permanent loss of the ID from disk. The owner deferred unlisted runtimes, not silently retained agent sessions. **Minor**.

## Optional parameters, callers and remaining plugin operations

The local worktree checks are placed correctly: after rev-parse immediately before Git removal, and inside the error handler immediately before fallback rmSync. `owned()` converts a thrown callback to false; neither refusal reaches another removal. No await separates a check and the corresponding call. Without a callback, runtime behavior remains the same; type compatibility is M-3.

Prepared discard checks immediately before interrupt and each removal. `kept()` catches direct callback errors, names the session and resets discarded=false. A later invocation of the same prepared object can retry with a fresh check; a successful or exhausted removal retains the previous idempotence behavior. Core does not persist this object after rollback. In ordinary takeover cases the active/archive mapping supplies later discoverability; resetting an in-memory flag alone does not arrange a later cleanup when no mapping survives. The callback itself must be complete and fail closed (M-1/M-2).

| Core caller | Check passed and kept handling |
| --- | --- |
| Kill worktree,2659 | Callback calls stopWhenReplaced and captures errors; false ends destroy, then the captured error ends kill before agent removal/archive. |
| Worker rollback,1689 through1576 | Passes `check().state !== "replaced"`; keeps a replacement/error path and releases only its own record. |
| Isolated orchestrator failed hooks,2207 | Same rollback callback and conditional release. |
| Orchestrator launch rollback,2226 | Same callback, shared prompt has its own later ownership check. |
| Recovery, actions189 | Passes assessed-version unchanged(); kept returns RECORD_CHANGED before terminating/archiving. |
| Prepared rollback,1567 through157 | Passes the current-record/latest-archive decision before every plugin call; local forwarding is correct, decision incomplete as above. |

A search of production core/CLI found no omitted Workspace.destroy or prepared discard caller. Runtime destroy calls and owned lock sockets are different interfaces. The independent plugin caller of discard during failed prepare is assessed below.

| Item4 operation | Assessment |
| --- | --- |
| create checkout-failure cleanup | Shared path after awaits; confirmed unsafe, M-4. |
| restore's git worktree prune, plugin287 | Git administration cleanup for absent worktrees; it does not recursively remove a live workspace directory. No new live-workspace deletion demonstrated. Nonblocking housekeeping; a race inside that single Git command belongs with the command-level identity/serialization work. |
| postCreate symlink target removal, plugin372 | Shared workspace contents after an unchecked caller await; confirmed unsafe, M-5. |
| failed-prepare discard, OpenCode1114 | Freshly created ID has not returned to core or been stored in metadata. Normal issue reuse cannot discover it from AO records yet; same-ID remap is guarded by the live launcher claim. Reused sessions have created=false and are never removed by discard. No competing owner through these supported paths was demonstrated; treat as call-owned cleanup, nonblocking. This reasoning applies before publication, unlike M-2 after core stored the prepared mapping. |

Item5: after a valid fresh worktree check, the remaining interval before/in one Git removal command or synchronous rmSync is the same kind of shared-name/path race as the deferred tmux-name operation. Repeating a synchronous check merely moves that final interval; closing it needs stronger ownership/serialization or resource identity. I do not rerate that interval as a new blocker. The create and postCreate findings instead have an unchecked earlier await and an available place to check again.

## Tests, mutations and gates

The 15 changed old assertions only add `expect.any(Function)` as the second destroy argument (one ownership, two stale-writes, two lifecycle, ten spawn assertions). None removes the original path or outcome assertion. The one mock now explicitly returns undefined, which does not change its runtime result. It adapts to, rather than disproves, the public type incompatibility.

New tests cover 3 orchestrator cases, 13 core callback cases, 11 worktree cases and 9 OpenCode cases. Core stand-ins exercise each caller; plugin-package tests use actual plugin code and built core. Direct throw tests, failed-rev-parse fallback and no-callback controls are useful. Missing cases include unreadable core ownership records, another AO ID's normal reuse, the other two workspace removal paths and the retained-ID next-start continuation.

Scratch source came from git archive of HEAD. No scratch build. Plugin tests imported the final worktree-built core; core tests used source. Baselines: core ownership48 + callback13 = **61 passed**, worktree **11 passed**, OpenCode **9 passed**; **81 total**. Each mutant restored source before the next run, and final production files were compared byte-for-byte with HEAD.

| Own mutation | Failing tests |
| --- | --- |
| No check before Git remove | **6/11**: lookup takeover, throw-before-Git, throw-before-fallback, both relevant check-count controls, real-core lookup case. |
| No check before rmSync fallback | **5/11**: failed-remove takeover, throw-before-fallback, failed-lookup takeover, fallback control, real-core failed-remove case. |
| Throwing worktree check counts as yes | **2/11**: both throw cases. |
| Kill passes no check | **1/61**: core kill takeover during plugin wait. |
| No check before interrupt | **4/9**: direct throw, later throw/check count, retry control, kept-not-discarded case. |
| No check before each agent removal | **6/9**: both plugin takeover windows, later throw, control, both actual-core takeover cases. |
| Orchestrator ignores own | **2/61**: same-ID replacement and disappeared reservation. |
| Core drops discard callback | **4/61**: all prepared callback cases, including the two controls that verify an actual callback answer. |

All mutants fail; controls based only on check counts are identified rather than presented as additional file-loss proofs. The independent built-API probes supply the missing behavioral evidence.

Every gate used env -i, fake HOME, scratch TMPDIR/PATH and no AO_*; initial test PATH contained no agent binary. All tmux access used the private shim. Independent OpenCode probes substituted API/version functions in process; no own OpenCode command or real model turn ran. Existing suite fixture stand-ins remained controlled by their tests. Frozen install/build preceded live probes, and builds ran only in this worktree.

```text
pnpm install --frozen-lockfile  exit0
pnpm build                     exit0
six test filters               exit0
  core:              Test Files 49 passed; Tests 1333 passed
  CLI:               Test Files 20 passed; Tests 261 passed
  runtime-tmux:      Test Files 1 passed;  Tests 40 passed
  agent-claude-code: Test Files 3 passed;  Tests 212 passed
  workspace-worktree:Test Files 2 passed;  Tests 61 passed
  agent-opencode:    Test Files 3 passed;  Tests 307 passed
integration filter             exit0
  Test Files 10 passed | 3 skipped; Tests 91 passed | 24 skipped
pnpm lint                      exit0; 5 problems (0 errors, 5 warnings)
pnpm typecheck                 exit0
pnpm -r --no-bail test          exit0
  aggregate Test Files 98 passed | 3 skipped
  aggregate Tests 2826 passed | 29 skipped; zero failures
```

Filters were the six `@aoagents/ao-*` packages above; integration was `@aoagents/ao-integration-tests`. Lint warnings are unchanged: CLI spawn333, activity-log91, plugin-registry232 and session-manager1976/1983. Our full run has 22 more passes and 22 fewer skips than the author's reported full run because the required private tmux shim enables those integration cases; both have the same 36 new unit tests.

Live same-name B-1 used real built core/runtime/Claude plugin, two Node processes, private tmux and a script named claude that only logs its PID and runs sleep. Child797934 published a generation3 replacement at `04:09:19.241Z`; stale parent restore rejected at `.269Z`, kept the live runtime and left identical metadata. Both recorded runtimes were gone before polling at `.332Z`, with a private keeper holding the server. Poll1 `.377Z` retained working; poll2 `.443Z` marked both killed/runtime, generations5 and2. The manager stopped before exact server PID797860 was terminated.

## Correctness retained, scope and whole-fix decision

The successful original reproducers, no-change controls and mutation failures substantiate the new local checks. Existing I-5 ledger-lock retention, generation-floor/active-series behavior, no-create writes, decision-versus-launch comparisons, stale PR cleanup refusal, conditional reservation release, helper environment sanitization, launch grace, identity/tolerance handling and two-negative convergence remain unchanged in source and pass the current suites. Live B-1 and all-dead controls pass again. Broader blanket claims about all rollback error paths are qualified by M-1/M-2 here. No new long hidden-socket timing run was necessary for this unchanged deferred behavior.

Scope is 13 allowed files. Types changes are confined to the two method contracts/comments; the return-type consequence is M-3. Plugin executable changes are confined to destroy and prepared discard, plus its doc comment. Metadata, lifecycle-manager, I-5, lock code, public index, CLI, other plugins, helper source/version, Claude hook, counter design, convergence/run launch key and claimPR failure behavior are unchanged. No new source module. Actual history is the straight four-parent chain `7294d978 → 46bcf8bf → 77e7c147 → ade9ae10 → 0d3c05fe`. All four conventional commit messages explain why and contain no issue number, emoji or Co-Authored-By. `git branch -r --contains 0d3c05fe` is empty. No source edits, commit, push or PR were made by this review.

The whole fix remains **NOT-LAND-SAFE** under the owner policy. M-1/M-2 need complete, conservative rollback ownership decisions; M-3 needs a compatible public contract; M-4/M-5 need the remaining destructive workspace setup paths guarded or an equivalent exclusive ownership guarantee. The latter paths require expanding implementation scope beyond destroy. Limited edit scope explains why the author did not change them; the brief explicitly asks this review to judge them, and they were not deferred by the owner. The tmux prefix match, final tmux-name windows, kept-runtime visibility and hidden socket beyond five minutes remain deferred. No additional blocker severity is assigned to those accepted items.

After fixes and approval, the existing rollout requirement remains: rebuild the primary checkout and restart old Node writers so old loaded code does not bypass these rules. This review rebuilt only its own worktree and did not restart either protected lifecycle worker.

## Notes recorded while working

Review in progress: `7294d978..0d3c05fe`, HEAD `0d3c05fec485b3041ba8ef8b39f4da22f9f6a1b6`.

Read the reviewer brief, author brief, AGENTS.md and CLAUDE.md. The author report remains unread pending independent items 1–3. Scratch root `/tmp/ao47-kr6`, marker `/tmp/ao47-kr6-marker`. All helpers/tests use env -i, fake HOME and scratch PATH; no AO_* in tests. Every tmux call uses a private-server shim; live panes use only a claude stand-in. No real AO command, OpenCode executable, model turn, commit, push or PR. Prior reviews remain untouched.

Initial source pass: 13 changed files and four linear commits. The orchestrator delete callback now checks its own reservation on each attempt. Worktree destroy checks immediately before Git removal and fallback, treating a thrown check as false. Prepared discard checks before interrupt and each removal and resets its discarded flag when kept. Checking all callers, the handling of failed ownership reads, the public Promise<void> compatibility, and unchanged plugin cleanup paths before reading the author report.

Independent items 1–3 completed before reading the author report:

- Own built-core orchestrator delete reproduction now makes one removal call after the same-ID replacement (04:04:04.073Z); the replacement survives and the stale start fails. The gone-reservation case also makes one call and fails without recreating a record. Unchanged control makes two calls and starts. Worker issue-delete still stops after one call on takeover.
- Actual built worktree plugin, Git boundary substituted: replacement during lookup at 04:04:05.139Z keeps the directory and makes zero Git removals; replacement during failed Git removal at .156Z keeps the directory and makes one attempted removal. Kill rejects and preserves the new record in both cases. Unchanged fallback control removes the directory and archives normally.
- Actual built OpenCode prepare/discard, API/version function stand-ins: takeover during interrupt at 04:04:05.202Z yields zero removals; takeover during first failed removal at .221Z yields one removal, no retry. Both report retention and preserve record/workspace. Unchanged control retries twice and cleans up.
- New failed-read gap confirmed: publish a replacement without an archive during interrupt, then make only its active-file read throw EACCES. At 04:04:05.267Z the replacement generation5 names ses_prepared; at .268Z removal still runs while the record read is blocked. Core rollback's check() catches the exception and produces replaced/current=null; namedElsewhere treats that unknown result as no owner and the plugin receives true. The plugin's own handling of a directly thrown callback is correct, but this composition violates the throw-keeps-resource rule.
- Every core workspace destroy passes a callback (worker rollback, both orchestrator rollback paths, kill, recovery); the sole core prepared discard passes one too. Kill captures a callback refusal and throws, recovery handles kept explicitly, rollback's conditional release preserves a replacement. The failed-read case above is the outstanding callback interpretation problem.
- Public API compatibility independently compiled: a legacy destroy declared Promise<void> fails assignment to the new Workspace type (TS2322). Assigning current destroy to a legacy one-argument Promise<void> function also fails. A scratch overload form preserving the one-argument Promise<void> signature and exposing Promise<void | "kept"> only with the callback compiles for both examples. No repository type edits.

Frozen install/build and all six filtered packages, integration, lint and typecheck have exit0. Full recursive run, mutations, other plugin-removal review and live controls remain. The author report remains unread through this entry.

Author report read after that independent pass. Its disclosed create cleanup is not an exclusively owned resource once the reservation is replaced. Own real-plugin/built-core probe publishes generation3 during a failing checkout at 04:07:27.724Z; the plugin then requests worktree remove for that shared path, and the stand-in removes it. At .725Z the replacement record survives with workspaceExists=false. Separately, a replacement published before workspace.create returns at .737Z has a file under the configured symlink target. The real postCreate rmSync replaces that directory with a symlink before core notices the stale record: .741Z file absent, symlink present, replacement record unchanged. These are additional unchecked shared-workspace removals, outside the two edited methods; assessing them as majors under the stated rule, not as the deferred final-check-to-command interval.

The gone-reservation case also exposes an operational gap in the author's stated retry explanation. At 04:07:27.497Z the retained agent ID exists only in an older archive; the newest archive holds just the killed reservation. A subsequent delete-strategy start at .500Z makes zero additional removal calls and starts without that mapping. The older file remains on disk, but findOpenCodeSessionIds reads only the latest archive per AO ID. The normal next-start retry therefore does not find the retained session, and the refusal did not name it to the operator. This is separate from the explicitly deferred visibility of a kept runtime.

All eight scratch mutants completed and failed relevant tests; pristine baselines passed. Full recursive tests also exited0. Detailed counts and live same-name/dead-poll checks are being recorded next.

Additional confirmation uses real filesystem permissions rather than a mocked read. At 04:10:40.524Z a replacement record naming ses_prepared is chmod000 during interrupt; the next callback still permits remove. Permissions are restored after the call and the record is unchanged. With the permission error introduced before rollback at .539Z, rollback also requests destruction of the shared runtime name before removing ses_prepared. Both stem from check() turning an unknown read into replaced/current=null.

A separate prepared-session ownership omission is confirmed without replacing any record manually: start worker kr-1 for INT-1; fail its post-launch setup; during its rollback interrupt, call the actual manager's spawn for INT-1 again. At 04:14:03.820Z kr-2 has successfully returned and its own generation6 record names ses_prepared via normal issue reuse. At .821Z kr-1's discard still calls remove(ses_prepared), because namedElsewhere inspects only kr-1/current archive. At .824Z kr-1 is released while kr-2's active record remains. Distinct workspace paths were used; API calls were function stand-ins. This needs a check of other AO records naming the prepared session, independently of the failed-read fix.

The two workspace initialization probes were repeated using the actual manager kill to remove the first reservation (mock agent with no prepare hook, as with non-OpenCode launchers), then publishing the replacement through the public metadata functions. Checkout case: kill succeeds .936Z, replacement .938Z, remove requested .938Z, directory absent .939Z. postCreate case: kill succeeds .948Z, replacement .950Z, replacement file removed and symlink installed .951Z (04:12:39 UTC). The reservation is therefore not an exclusive path lease across the wait.

Live B-1: child797934 published same-name replacement generation3 at 04:09:19.241Z; stale restore failed at .269Z and kept that live runtime and identical record. Both recorded runtimes were then gone before polling at .332Z. Poll1 .377Z retained working; poll2 .443Z marked both killed/runtime, generations5 and2. Parent stopped its manager before terminating private server797860. Full gate totals: 2,826 passed, 29 skipped, 98 files passed, 3 skipped. The extra22 passes relative to the author's full-run count are integration cases enabled by the required private tmux shim.

## Final cleanup evidence

All review jobs exited. The live manager stopped before exact private server PID797860 was terminated. Final PID checks find none of parent797847, child797934, server797860 or stand-ins797899/797943/797970/798016. A full user-process listing checked for the review's scratch paths/server labels and worktree CLI processes returns:

```text
own_processes: []
```

Protected real workers271579 and321413 still run. The protected orchestrator pane and default tmux server were not targeted. After that empty process check, the exact private socket files `ao47-kr6-integration`, `ao47-kr6-full`, `ao47-kr6-live` were removed; the tests/filters/mutants labels had no remaining socket. `/tmp/ao47-kr6` (source copy, scripts, logs, fake HOME and state) and `/tmp/ao47-kr6-marker` were removed. Output: `scratch_exists False marker_exists False`. A final process check again returned the empty list above.

Required command, just before removing the marker:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr6-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Exact output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
```

Both entries have mtime `2026-10-21 00:07:58.515878661 -0400`. The existing real worker271579's observability file records ao-46's successful working→stuck transition at `2026-10-21T04:07:58.517Z`, correlation `lifecycle-transition-f8f67b71-c10e-454c-bfaf-ffedfc3201ea`; the session record says stuck. This explains the record replacement and parent-directory mtime. No review code wrote either path. Attribution used stat/grep of the real files only.

`ls -la --time-style=full-iso ~/.ao/bin`, **before**:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

**After**, byte-identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Prior reviews are unchanged: r2 SHA256 `0ebf714655a74f4f5e8ac201d0518ac698cf2a4d0478e03839b80c928cc32f54`; r3 `44d0b706090ae70e4021194441fd6f21bec2df559e5a5088d60567a12df22e42` matches2328c1a0; r4 `81f32a2d25e10f78654ad4fab794c95bd805affec77226756e66927097ab886f` matches609eef7e; r5 `96bfededfafb6d6876010f151f35d020906bfae427e22deac918206b26e92013` matches594ae8a2. The scratch mutant production files were restored and compared before removal. There is no tracked source diff. No commit, push, PR or ao send was made; `.agent_report.md` is the watcher handoff, with the round-5 report preserved below it.
