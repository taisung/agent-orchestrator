# Killed-status review, round 5

**NOT-LAND-SAFE — 0 blockers, 3 majors, 0 minors.**

Reviewed `f06a1107..7294d978`; whole-fix verdict covers `0e3eabc2..7294d978` under the stated owner policy. HEAD: `7294d978927cce855452ab01bc0cc042b7610ba0`. All source references below are at that HEAD. Findings start again at M-1 for this round. The three majors require fixes before landing; “0 blockers” is the severity count, not approval to land.

The core retry mechanism and ledger lock fix work in their tested cases. The orchestrator delete caller still supplies an incomplete ownership check. The two disclosed plugin steps also perform destructive work after an internal wait without checking the replacement record. I independently reproduced all three. Even if the owner later defers both plugin findings, M-1 still prevents a land-safe verdict.

## Round-4 findings

| Round-4 ID | State | Evidence at this HEAD |
| --- | --- | --- |
| M-1: removal retries reuse the first check | **Partly fixed** | `deleteOpenCodeSession` checks after every delay. Own kill, archived purge and worker issue-delete probes stop after one failed attempt when a different AO ID takes the OpenCode ID. The orchestrator delete path excludes its own AO ID indefinitely, including a replacement launch: new M-1 below. |
| M-2: ledger removal checks before its lock wait | **Fixed** | Own real-lock test preserves a fresh valid ledger, its new owner and pending archive key. A later cleanup removes the ledger and clears pending after the owner disappears. The no-change control removes normally. |
| m-1: generation guarantee exceeds implementation | **Fixed for the owner’s narrowed, documentation-only contract** | Active records form one nonrepeating series; each archived copy has its own series. Own overlap sequence and production comparison inventory agree with that contract. No counter code changed. |
| m-2: removal inventory omits low-level operations | **Fixed as an inventory** | Raw tmux export, temporary files/buffers/helpers/sockets, empty ledgers, expired-ledger sweep and atomic replacements are now accounted for. The table correctly discloses both plugin gaps. Its “none” for the delete-strategy gap needs the M-1 correction below. |

## New findings

### M-1 — Orchestrator delete retries ignore a replacement with the same AO ID

**File:** `packages/core/src/session-manager.ts:1009` (snapshot at993, exclusion in the holder check at995–999, orchestrator caller at2284–2292).

The retry callback compares `openCodeNamers(..., criteria.sessionId)` with a snapshot made using the same exclusion. A worker issue-delete supplies only `issueId`, so it sees every active owner. Orchestrator delete supplies its own `sessionId`, so a different reservation or launch of that ID remains invisible. The callback can answer true after ownership has changed and request removal of the new launch’s OpenCode session. The later conditional metadata write rejects the stale start, but that rejection comes after the removal.

Independent built-core evidence, UTC on 2026-10-21:

```text
02:47:09.027 first remove(ses_shared) starts
02:47:09.030 replacement kr-orchestrator: generation=4, working, ses_shared
02:47:09.230 second remove(ses_shared) starts with that replacement still present
02:47:09.233 stale start rejects its record write; replacement record unchanged
```

Reproducer: seed an archived OpenCode orchestrator with `ses_shared`, select project workspace mode and the delete strategy, then call the real `spawnOrchestrator`. At the first mocked API removal, archive/delete the current reservation, reserve the same ID and publish a new working launch naming `ses_shared`; throw a transient error. The next removal still runs. API calls are function stand-ins; this demonstrates the destructive request, without running OpenCode or deleting a real agent session.

A scratch regression appended to the existing ownership test uses its `launchedRecord`, `publishNewLaunch` and `hooks.duringRemove` helpers:

```ts
ctx.config.projects["my-app"]!.orchestratorWorkspaceMode = "project";
ctx.config.projects["my-app"]!.orchestratorSessionStrategy = "delete";
launchedRecord("app-orchestrator", { agent: "opencode", opencodeSessionId: "ses_shared" });
deleteMetadata(sessionsDir, "app-orchestrator", true);
let calls = 0;
hooks.duringRemove = () => {
  if (++calls === 1) {
    publishNewLaunch("app-orchestrator", makeHandle("rt-new"), {
      agent: "opencode", opencodeSessionId: "ses_shared",
    });
    throw new Error("transient review failure");
  }
};
// Real manager, mock runtime/workspace, mock agent named "opencode":
await expect(sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "review" }))
  .rejects.toThrow(/changed/);
expect(recordOf("app-orchestrator")).toMatchObject({ opencodeSessionId: "ses_shared" });
expect(removeOpenCodeSession).toHaveBeenCalledTimes(1);
```

On pristine HEAD the first two assertions pass and the last fails: **expected 1 call, got 2**. This test was only in the scratch archive. Pass the initiating reservation/launch identity into this caller’s per-attempt guard, or otherwise include replacement ownership of the excluded ID. An AO ID alone is insufficient to authorize deletion across launches. Cover the orchestrator branch as well as issue-delete.

### M-2 — Worktree destruction removes a replacement directory after awaited Git work

**File:** `packages/plugins/workspace-worktree/src/index.ts:176,186`; core callers include `session-manager.ts:1552,2629` and `recovery/actions.ts:182`.

Core checks ownership before calling `destroy`. The plugin then awaits `git rev-parse`, invokes `git worktree remove --force`, and catches any error by recursively removing the path. Every launch of an AO ID uses the same managed path. A new launch during either Git await can therefore lose its workspace, including uncommitted files, while its record remains working. A check after the plugin returns cannot recover those files.

Own built-core `kill` used the actual worktree plugin; only the child-process Git boundary was substituted. In one run, the mocked `rev-parse` publishes a generation3 replacement and its marker, then the remove command fails. In a second run, publication happens inside the failing remove command. The plugin’s real `rmSync` runs in both:

```text
02:50:30.874 replacement during rev-parse: marker exists, generation=3
02:50:30.875 workspaceExists=false; replacement record remains; stale archive rejected
02:50:30.891 replacement during failed git remove: marker exists, generation=3
02:50:30.893 workspaceExists=false; replacement record remains; stale archive rejected
```

This is **major and must fix before landing**, under the round-6 rule that waits and retries inside a step count. It is not limited to the accepted interval between a final check and one tmux command: both the removal after `rev-parse` and the fallback after a rejected remove have places to check again. Keep the remaining final-check-to-Git-command race distinct from these fixable waits.

The proposed optional `Workspace.destroy` callback fits the plugin boundary. Core must supply it for kill, rollback and recovery. Run it after lookup and before the Git remove, then again before fallback removal. A false result or a thrown ownership error must keep the directory; a broad catch must not turn a rejected check into permission for `rmSync`. Tests need both takeover windows and a no-change fallback control.

### M-3 — Prepared OpenCode discard deletes after its interrupt or failed first attempt without rechecking

**File:** `packages/plugins/agent-opencode/src/index.ts:496,501–509`; core check at `session-manager.ts:1534`, discard at1543.

Rollback checks the record and latest archive once, then calls `discard`. The plugin sets `discarded`, awaits an interrupt and tries session removal twice. A replacement or restore of the same AO ID can start using the prepared OpenCode ID during either wait. The replacement’s metadata and worktree survive core’s later checks, while its agent session receives a deletion request. `created=true` proves which call originally allocated the session, not that no subsequent launch owns it.

Own built-core spawn used the actual OpenCode plugin’s prepare/discard implementation, a mocked supported version return, API function stand-ins and a post-launch failure to enter rollback. No `opencode` executable ran. Reproducer A publishes a new launch naming `ses_prepared` during the awaited interrupt. Reproducer B publishes it during the first remove and throws a transient failure:

```text
02:50:30.938 A: replacement generation=5, working, ses_prepared
02:50:30.939 A: remove(ses_prepared) called with that owner present
02:50:30.957 B: replacement generation=5 published by failed first remove
02:50:30.957 B: second remove(ses_prepared) called; calls=2
```

This is **major and must fix before landing**. It has the same unchecked retry structure as the core M-1 that this round was required to fix, plus an awaited interrupt before the first removal. It does not belong in the deferred tmux target-matching work.

The proposed optional `PreparedAgentSession.discard` callback is appropriate if core reruns the current-record/latest-archive ownership decision directly before the interrupt and each removal attempt. Preserve a false/throw outcome through best-effort handling and report which session was retained. Decide deliberately how `discarded` behaves when ownership prevented removal; do not silently treat retention as successful deletion. Callback checks still leave the accepted general check-to-command interval.

## Generation and comparison audit

The requested comments in `metadata.ts:43–67,737–749`, `lifecycle-manager.ts:262–270` and DEVELOPMENT now describe active and archive series separately. For current Node writers, active writes increment the current generation; deletion raises the floor before unlink; reservation or full creation starts above the floor/latest archive. Archive updates increment only their own copy. Own sequence at `02:51:56.143Z`: active1,2,3,4; archive3→8 while active remains4; active5; deletion archives5; next reservation active6. This is the intentional overlap allowed by the narrowed rule, not a remaining active-record ABA reproduction.

I searched `GENERATION_KEY`, conditional update/delete/reservation calls and their expected values. The production compares are:

| Path | Source of expected values and comparison target |
| --- | --- |
| Lifecycle PR discovery751, bookkeeping1018, status1496 | Active metadata → active generation + launch; status also checks decision fields. |
| Read repair, session-manager639 | Active metadata → active generation + launch + PR/status. |
| Claim target3573 and previous owner3591 | Active metadata → active generation + launch; previous owner also checks PR/status. |
| Recovery actions71,90,188,239 | Scanner’s active metadata → active assessed generation/launch/PR/status. |
| Recovery archive197 | Generation and launch of its just-written active terminated record → conditional active delete. |
| Launch owner write1463/release1480; project delete2093/2096/2126 | Active launch/reservation identity, no generation. These are additional compares omitted from the author’s table. |
| Kill/archive2704 | Active launch identity; automatic cleanup also checks its decision facts. No generation. |
| Active remap3707; restore active write3986 and follow-up4041 | Active launch/mapping identity, no generation. Also omitted from the author’s table. |
| Archive mark794, pending key2769/2791, archived remap3711 | Latest archive’s mapping/pending/launch fields, no generation. |
| Restore copy-back3877 / metadata855 | Latest archive’s launch identity via expectedArchive; creates a fresh active reservation, no archive generation comparison. |

No production caller passes an archived generation into an active compare, or a generation into an archive compare. The author’s table covers every generation-bearing compare; the extra non-generation compares above do not defeat the revised contract. “Reads one file” alone is not the proof: the latest archive can change to a different copy. The decisive facts are the caller inventory and the absence of archive-generation expectations. Generic exported expected-value APIs do not themselves prevent a future caller from making that mistake.

The guarantee remains scoped to current Node writers and their documented lock support; old writers/bash helpers retain the previously documented limitations. The private `commitRecord` comment at575–580 still uses broad “no record ... repeats” shorthand; interpreted in its active-writer context it is consistent, but the report’s claim that every old broad phrase was eliminated is too absolute. This does not reintroduce the owner-rejected global counter requirement.

## Independent removal inventory

Searched core for filesystem removals/renames, child/process termination, tmux kill/buffer operations, destroy/discard and OpenCode removal. All entries below use `packages/core/src` unless a plugin is named. This covers the author table’s rows; no additional production session-state removal outside these groups was found.

| Class A: session state | Check/remaining wait assessment |
| --- | --- |
| Runtime destroys: rollback1523, project2085/2091, kill2613, restore3952/4009; recovery166 | Fresh own/decision/runtime-name checks precede the call. One runtime command; deferred tmux name/prefix windows remain. |
| Worktree destroys: rollback1552 through1665/2183/2202, kill2629; recovery182 | Core checks are fresh; plugin’s internal waits fail the per-attempt rule: M-2. |
| Prepared discard1543 via153 | Core current/latest-archive check is fresh; plugin interrupt/retry gap: M-3. |
| Orchestrator prompt unlink2209 | Fresh own.check at2207, no intervening await. |
| Record deletion/archive, metadata666–698, including rollback/project/kill/recovery | Expected fields checked under record lock, floor raised686, unlink696. No await after comparison. |
| OpenCode delete1007, kill2684, archived purge3017 → retry355/357 | Each attempt checks after its delay. Kill compares own launch and namers; purge also requires no active archived ID. Delete strategy has M-1’s excluded-ID gap. |
| Ledger removal2753 → delivery-ledger572/573 | Check after acquiring ledger lock, directly before removal; false returns kept and preserves pending bookkeeping. |
| Raw killTmuxSession export, tmux184/index48 | Takes only a name, no record check. No production core/CLI/plugin caller found. Inventory now discloses it; not a new manager regression. |

Class B consists of reservation temp link (`metadata:906`, unique PID/UUID name created with wx), tmux per-call paste buffer/temp (`tmux:147,151`), the exact OpenCode answer helper child and mkdtemp directory (`opencode-api:428–429,490`), and owned lock/probe sockets (`delivery-lock:76,90,123`; metadata helper162,175,184). Their cleanup does not remove a shared session record/resource, so a record ownership check is not needed.

Class C includes empty-ledger compaction (`delivery-ledger:285`) and expired-ledger removal (`:617–628`) after rereading entries under the ledger lock. Fresh unresolved entries and corrupt ledgers stay. A detail in the combined sweep row: stale temporary write files at610 are removed by an age check outside that ledger lock; they are not published ledger files and no reader consumes them. The author table’s explanation states the age rule, although its class heading compresses that distinction. Atomic renames in atomic-write10 and observability184 publish replacement versions; they are writes, not session deletion. In-memory Map/Set deletes are not persisted removals.

## Retention, I-5 and existing correctness

Own built API calls show that retention leaves a route for later cleanup:

| Case | First operation | After removing the competing owner and calling cleanup |
| --- | --- | --- |
| Kill with purge | 02:47:08.578: one removal call, new owner intact; archive retains ses_shared, no opencodeCleanedAt | .582: second total call, archive marked cleaned, mapping cleared; errors=[] |
| Archived cleanup purge | 02:47:08.788: one call, skipped=[kr-1], mapping retained; errors=[] | .791: second total call, cleaned mark and cleared mapping; errors=[] |
| Worker issue-delete | 02:47:09.019: one call, spawn continues as kr-2; new holder and original archived mapping stay | The original archive remains reachable by the same archive purge branch; no cleaned mark was written. |
| Real-lock ledger retention | 02:47:09.394: new owner and valid ledger exist while lock is held; .405: both survive and pending=ses_shared | .408: ledger absent and pending cleared; errors=[] |
| Real-lock no-change control | 02:47:09.574: ledger absent, pending cleared | No retry needed. |

The ledger had a valid v2 fresh `unknown` entry, not an empty or corrupt placeholder. A real delivery lock was held across starting cleanup and publishing the owner. Explicit removal does not lose the retry key on a kept outcome. The existing no-archive/conflicting-pending-key failure path still warns about sweep/manual cleanup; this round does not establish a universal recovery guarantee when metadata itself cannot retain a key. The owner-deferred runtime with no record is likewise unchanged.

Only `removeDeliveryLedger` and its doc comment changed in I-5. Without the optional callback, runtime behavior is unchanged: absent file returns undefined, an existing/corrupt file is removed under the same lock, errors propagate, and the lock is released in finally. Existing `delivery-ledger.test.ts` is byte-unchanged and all31 tests pass in the focused baseline and gates. Admission, serialization, compaction, lock implementation and sweep are unchanged.

The 12 new tests do exercise their stated cases: eight ownership retry cases include takeover and no-change controls for each of the three core callers; four ledger cases cover cleanup retry and kill, each with takeover and control. The ledger tests use the actual lock and ledger modules: their hold wrapper calls the real function, and the test retains a real competing lock for100ms. They are not tests of a mocked lock answer. Missing coverage is the orchestrator variant and the plugin internals, as the independent failures demonstrate.

Correct behavior from r4 remains supported by the unchanged code and passing current suites: no-create conditional writes, reservation UUID/release checks, the active generation floor, launch/decision comparisons, stale closed-PR protection, old-owner claim checks, sanitized record-lock helper environment, launcher grace, two-negative convergence, identity/tolerance recovery and unknown-probe preservation. No counter, convergence policy, run launch key, claimPR failure behavior, wrapper version/source, bash helper or Claude hook change occurred. The separate live two-process restore and all-dead checks below confirm the B-1 keep-and-name choice and quick convergence again. Prior long-bound hidden-socket observations were not rerun; that unchanged bound remains deferred.

## Validation and live evidence

All tests/helpers ran under env -i with fake HOME and scratch PATH; tests had no AO_* and no agent executable. Local package Vitest binaries were used. Each tmux shim unsets TMUX and AO_* before `/usr/bin/tmux -L <private-name>`. The live pane program was only a scratch script named claude which logged its PID and exec’d sleep. No OpenCode process or real model turn ran. No real AO command ran. Frozen install and build completed in this worktree before live probes; the mutant copy was made with git archive and was never built.

Commands, each with that scrubbed environment:

```text
pnpm install --frozen-lockfile                     exit 0
pnpm build                                         exit 0
pnpm --filter @aoagents/ao-core --filter @aoagents/ao-cli
     --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-agent-claude-code test
pnpm --filter @aoagents/ao-integration-tests test
pnpm lint                                          exit 0
pnpm typecheck                                     exit 0
pnpm -r --no-bail test                              exit 0
```

The test summary lines were:

```text
filters: core          Test Files 48 passed; Tests 1317 passed
         CLI           Test Files 20 passed; Tests 261 passed
         runtime-tmux  Test Files 1 passed;  Tests 40 passed
         Claude        Test Files 3 passed;  Tests 212 passed
integration:           Test Files 10 passed | 3 skipped
                       Tests 91 passed | 24 skipped
full recursive totals: Test Files 95 passed | 3 skipped
                       Tests 2790 passed | 29 skipped; zero failures
lint:                  5 problems (0 errors, 5 warnings)
```

Lint warnings are the existing non-null assertions in CLI spawn333, activity-log91, plugin-registry232, and console calls in session-manager1952/1959. No new lint failure.

Mutants were made one at a time in a scratch archive of HEAD, restoring source between runs. Focused pristine baseline: **3 files, 80 tests passed** (ownership45, ledger-lock4, existing ledger31).

| Mutation | Tests that fail |
| --- | --- |
| Check only when delayMs===0 | 5: kill different-ID takeover; kill same-ID replacement; purge different-ID takeover; purge same-ID restore; worker delete-strategy takeover. 75 pass. |
| removeDeliveryLedger ignores check | 2: cleanup retry lock-wait takeover and kill lock-wait takeover. 78 pass. |
| Treat kept ledger as removed | The same2 tests fail on pending key/warning retention. 78 pass. |
| Kill removal callback always returns true | 4: same-ID replacement during interrupt; different-ID takeover during interrupt; different-ID takeover during failed remove; same-ID replacement during failed remove. 76 pass. |

The reviewer’s additional orchestrator test against pristine source: **1 failed,45 skipped**, expected one API removal but got two. That expected red result is separate from the passing repository gates.

Live B-1 used two real Node processes and private server `ao47-kr5-live`. Parent restore created a same-name runtime; child PID29258 archived/reserved the ID, stopped that runtime and published a replacement on the same name. At `02:50:32.306Z` it was working/gen3 and alive; at `.324Z` the stale parent rejected its write, named the kept runtime and left the replacement alive with identical metadata. Both recorded runtimes were then stopped before polling at `.381Z` while a private keeper kept the server available. Poll1 at `.426Z` retained working; poll2 at `.485Z` wrote killed/runtime for both, generations5 and2. Thus all recorded sessions dead before the first observation still converge without an earlier successful poll of any recorded session. The manager was stopped before terminating the private server by its exact PID.

## Scope and whole-fix decision

Exactly seven permitted files changed: session-manager, delivery-ledger, metadata, lifecycle-manager, DEVELOPMENT, ownership tests and the new ledger-lock test. Metadata/lifecycle diffs contain only comments; delivery-ledger differs only in the permitted function/comment. No new source module. Three linear commits, `f06a1107 → f7ac94e8 → b8d3ddae → 7294d978`, each conventional and explaining why, with no emoji, issue number or Co-Authored-By. `git branch -r --contains 7294d978` prints nothing. The review makes no source change, commit, push or PR.

The whole fix `0e3eabc2..7294d978` is **NOT-LAND-SAFE** under the owner policy. M-1 remains in the current allowed core scope. M-2/M-3 require expanding the next implementation scope to types/plugin code/tests, as the author correctly disclosed. Their absence from this round’s allowed-file list explains why they were not changed; it does not satisfy the required per-attempt ownership rule. I would not defer either. The explicitly deferred tmux prefix matching, final-check-to-tmux-name command windows, kept-runtime visibility and hidden socket beyond five minutes remain deferred and are not new blockers in this review.

The uniform-writer deployment limitation from r4 still applies: after fixes/approval, rebuilding the primary checkout alone will not replace modules held by old Node processes. This review rebuilt only its own worktree and did not restart either protected real worker.

## Notes recorded during the review

Review in progress: `f06a1107..7294d978`, HEAD `7294d978927cce855452ab01bc0cc042b7610ba0`.

Read the reviewer and author briefs. The author report remains unread pending independent checks 1–3. Scratch root `/tmp/ao47-kr5`, marker `/tmp/ao47-kr5-marker`. Gates use env -i, fake HOME, no AO_* and no agent executable; live runs add only a scratch claude stand-in. Every tmux invocation passes a shim that removes TMUX and AO_* and uses a private server. gh is a rejecting version/auth-only stub. No source edits, commit, push, PR or real-state AO command. Prior review files remain untouched.

Initial diff: seven permitted files, three commits expected. Retry callback now runs immediately before each core OpenCode removal attempt. Ledger callback runs under the ledger lock immediately before rmSync, and the caller distinguishes a kept result. Metadata/lifecycle changes appear limited to comments; checking the revised active/archive-series claim and all comparison callers independently.

Independent checks 1–3, before reading the author report:

- Own built-core probes use a Node module hook that substitutes OpenCode API functions; no OpenCode executable or service call. Kill-with-purge, archived cleanup purge and worker issue-delete each make only one removal attempt after a new kr-30 owner appears during the first transient failure (02:47:08.371–02:47:09.019Z). Kill retains the ID in its archive without opencodeCleanedAt; purge skips. After the holder record is removed, later cleanup removes the agent session and marks the archive cleaned.
- Own real-ledger-lock reproduction passes: cleanup waits while a working kr-2 record appears. At 02:47:09.394Z the record and valid ledger exist; at .405Z both still exist and opencodeLedgerPending remains. Removing the owner and running cleanup again removes the ledger and clears pending at .408Z. Unchanged-owner control removes the ledger normally.
- New gap confirmed in the **orchestrator delete-strategy** branch: criteria.sessionId is omitted from both naming/holder checks. At 02:47:09.027Z first remove fails; at .030Z another launch of kr-orchestrator publishes generation4 with ses_shared; at .230Z the second remove still runs. The eventual start refuses its own stale metadata write, preserving the replacement record, after its OpenCode session has already been removed. The worker issue-delete test has no excluded ID and cannot cover this branch.
- Independent generation compare inventory: lifecycle PR/bookkeeping/status, read repair, claim target/previous owner, recovery assessed writes/archive all compare active records. Archive cleanup/remap/pending marks and restore expectedArchive compare archive mapping/launch fields, not generation. No production archive-generation-to-active-generation comparison found. The narrowed active-series guarantee matches ordinary same-build writes/deletes/reservations; archive copies can still overlap numerically by design.
- Independent removal inventory matches the prior review's core call sites including raw tmux kill, exclusive temps/helpers and ledger compaction. New core retry/ledger waits now have local checks, with the orchestrator-excluded-ID gap above. Plugin-internal worktree and prepared-session waits still need separate reproduction and rating. Author report remains unread up to this entry.

Author report first read after the independent pass above. Its two plugin findings are independently confirmed with the built core and actual plugin implementations; only child-process/Git/API boundaries are stand-ins, and OpenCode's version probe is a mocked function return (no executable named opencode is launched):

- Worktree destroy: during git rev-parse, publish a generation3 replacement at the same managed directory, then fail the remove command. At 02:50:30.874Z its marker exists; at .875Z the real plugin's rmSync fallback has removed the directory. Core subsequently refuses to archive the replacement record. A separate run publishes the replacement during the failing git worktree remove itself: marker exists at .891Z, directory gone at .893Z. Both leave a working record pointing to a removed workspace.
- Prepared OpenCode discard: real agent prepare returns ses_prepared; postLaunchSetup fails; core enters rollback while it owns the record. During discard's awaited interrupt, publish a replacement naming ses_prepared at 02:50:30.938Z. The plugin calls remove at .939Z with that owner still present. Separate first-remove failure case publishes the replacement at .957Z and immediately reaches a second removal, calls=2. Record and worktree survive; the agent session is removed by the API stand-in. First test trial used a below-floor mocked version and was refused before prepare; excluded, then rerun with supported 2.0.29.

These plugin waits are broader than the accepted last-check-to-single-tmux-command interval and can be checked locally before each attempt. Tentative ratings: major, must fix before landing under the expanded round-6 rule. Proposed optional callbacks fit the layering, provided false/throw keeps the resource (including the fallback path) and the caller can report retention. Remaining atomic name/path reuse windows require separate ownership/serialization work; callbacks do not solve those by themselves.

Validation completed: frozen install/build/typecheck exit 0; lint exit 0 with five existing warnings. Filters: core 1,317, CLI 261, runtime-tmux 40, agent-claude-code 212 passed. Integration: 91 passed, 24 skipped. Full recursive run: 2,790 passed, 29 skipped, 95 files passed and 3 skipped, zero failures. All test environments had fake HOME and no AO_*; no agent binary was on test PATH, and tmux used private servers.

Scratch mutation baseline: 80 tests across three files passed. First-attempt-only mutant failed five ownership tests; ledger-ignores-check and kept-counts-removed each failed both ledger takeover tests; kill-callback-always-yes failed four interrupt/retry ownership tests. Sources were restored between mutants. A separate reviewer test against the pristine implementation exercises spawnOrchestrator with the delete strategy and a same-ID replacement during the first failed remove. It fails at the final call-count assertion: expected 1, got 2; the preceding assertions that start rejects a changed record and that the replacement remains both pass. This test is scratch-only.

Independent live check (two Node processes, private tmux, claude stand-in): replacement generation3 was alive at 02:50:32.306Z and remained alive with identical metadata after the stale restore failed at .324Z. Both recorded runtimes were then gone before polling at .381Z. The first poll retained working records; the second poll at .485Z wrote killed/runtime for both, generations5 and2. This confirms the convergence policy rather than assuming one missing observation must kill immediately.

Generation sequence at 02:51:56.143Z: active 1,2,3,4; latest archive advanced from3 through8 while active stayed4; active advanced to5; deletion archived5, then reservation produced active6. Active numbers did not repeat; the archive/active overlap is allowed by the revised rule. Final verdict and detailed audit are being prepared; cleanup evidence remains to be recorded.

## Final cleanup evidence

The live manager was stopped before its private tmux server; server PID29184 was terminated explicitly. The child and all stand-ins exited. Final PID checks find none of own live parent29172, server29184, child29258, stand-ins29223/29267/29294. A full user-process listing filtered for the review’s scratch paths/server labels and worktree CLI processes gives:

```text
own_processes: []
```

Protected workers271579 and321413 remain running. No command targeted the protected orchestrator pane or the default tmux server. Private socket files `ao47-kr5-live`, `ao47-kr5-integration`, `ao47-kr5-full` were removed after confirming no own processes; the tests/mutants labels had no remaining socket. Scratch source, scripts, logs, HOME and state under `/tmp/ao47-kr5`, plus `/tmp/ao47-kr5-marker`, were removed. Final removal output: `scratch_exists False marker_exists False`.

Required command, run before removing the marker:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-kr5-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Exact output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
```

Both entries have final mtime `2026-10-20 22:57:25.128364371 -0400`. The already-running real worker271579’s observability file records `ao-46`, `working → stuck`, successful lifecycle transition at `2026-10-21T02:57:25.129Z`, correlation `lifecycle-transition-6baec0ec-4b01-43d1-9931-4c0fb02767e1`; the current record says stuck. An earlier during-review write at `02:47:24.810Z` was the same worker’s stuck→working transition. These explain the record replacement and its parent-directory mtime. No review process wrote these entries. Attribution used only stat/cat/grep of real files.

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

**After**, byte-identical listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

No tracked source diff remains (none was made). Prior review files are unchanged: r2 SHA256 `0ebf714655a74f4f5e8ac201d0518ac698cf2a4d0478e03839b80c928cc32f54`; r3 `44d0b706090ae70e4021194441fd6f21bec2df559e5a5088d60567a12df22e42`, matching2328c1a0; r4 `81f32a2d25e10f78654ad4fab794c95bd805affec77226756e66927097ab886f`, matching609eef7e. The scratch production files were restored to pristine HEAD after mutation tests and checked byte-for-byte before scratch removal. No commit, push, PR or report message was sent; `.agent_report.md` is the watcher handoff.
