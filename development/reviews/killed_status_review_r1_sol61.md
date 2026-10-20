# Blind review of stale killed fix, round 1

Review target: `e751a3ee..b8a43f5f`, HEAD `b8a43f5f26acacd882576d375801e31c453135c4`.
Reviewer: ao-47. Artifact: lifecycle/probe implementation and its regression tests.

NOT-LAND-SAFE

Findings: **2 blockers (B-1, B-2), 3 major (M-1 through M-3), 2 minor (m-1, m-2)**. All requested worktree gates pass; the reproduced convergence and metadata races prevent landing.

Isolation: marker `/tmp/ao47-killed-review-marker`; scratch root `/tmp/ao47-killed-review`; fake HOME; no real AO variables in helpers/tests; private tmux shim only. No commit, push, PR, or network gh invocation is authorized by this review brief.

Initial `ls -la --time-style=full-iso /home/taisung/.ao/bin`:
```
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Evidence log

- Read the task, project guide, investigation, Known Issues entry, and author brief before checking the author report. The log has four commits in the requested range, not five: `0571fa12`, `34ea8624`, `0b54c4ac`, `b8a43f5f`.

### Source observations recorded before live confirmation

- C2 (`lifecycle-manager.ts:1379-1384,1526-1527`) repeats without a time bound. Two real deaths comprising all probed sessions clear pending kills on every poll. This follows the author brief literally but appears to prevent convergence permanently.
- D (`runtime-tmux/src/index.ts:225-229`) treats a missing server as a rejection on every poll, whereas `session-manager.ts:457` explicitly treats that same typed condition as dead for orchestrator replacement. Lifecycle records after a host restart need separate scrutiny.
- The range contains four commits. Changes stay within the author brief's allowed source/test files; all four commit messages have conventional prefixes and explanatory bodies.

### Live result: two dead panes with a live orchestrator

On private server `ao47-killed-review-live`, two worker panes were ended in the same second; one recorded orchestrator remained alive. External snapshots:
```
18:12:54.507Z poll1 kr-1=working kr-2=working kr-orchestrator=working health=ok
18:12:55.560Z poll2 kr-1=killed/runtime kr-2=killed/runtime kr-orchestrator=working health=ok
18:12:56.614Z poll3 kr-1=killed/runtime kr-2=killed/runtime kr-orchestrator=working health=ok
18:12:57.673Z poll4 kr-1=killed/runtime kr-2=killed/runtime kr-orchestrator=working health=ok
18:12:58.735Z poll5 kr-1=killed/runtime kr-2=killed/runtime kr-orchestrator=working health=ok
18:12:59.841Z poll6 kr-1=killed/runtime kr-2=killed/runtime kr-orchestrator=working health=ok
```
This establishes that exactly one other live recorded session is enough for C1 to converge, without an all-negative outage.

Read the author report only after inspecting A/B/C/D and their source callers. It acknowledges the last-session/server-loss limitation, the fresh-worker filter gap, remaining recovery/validator rejection-to-false behavior, and delivery retry invoking restore. These are now being independently checked. The four requested package filters subsequently completed successfully: core (1145), runtime-tmux (37), claude-code (211), and CLI (261). Build, lint (0 errors/5 warnings), and typecheck also passed.

## Findings

### B-1 blocker — an all-negative poll permanently suppresses real deaths

`packages/core/src/lifecycle-manager.ts:1528`, `:1382`: each poll of two dead recorded sessions is classified as another outage and clears both pending kills. On an answering private tmux server (one unrelated, unrecorded keeper keeps the server alive), both worker panes were ended together. Six outside-source snapshots at 18:13:10.189, 11.218, 12.246, 13.275, 14.304, 15.334Z all read `kr-1=working, kr-2=working, health=warn`. No killedReason was written. Starting a replacement server after killing the old one also produced six unchanged working/working snapshots at 18:13:39.302..44.450Z. This has no eventual-death rule; repeated probes reproduce it forever. It follows C2 of the author brief, so the policy itself needs revision. A recorded live orchestrator avoids this failure (control above).

### B-2 blocker — updateMetadataIf is not a compare-and-set between processes

`packages/core/src/metadata.ts:215-234`; `packages/core/src/atomic-write.ts:8-10`. Atomic rename prevents torn bytes, but does not bind the rename to the compared record. In a deterministic, isolated interleaving, pause the lifecycle writer just before its temp-file write; a second Node process either (a) writes a restored `spawning` record with a new runtime handle, restoredAt, and PR, or (b) archives the record and reserves the same ID afresh. Resume the first writer. Both calls return `true`; both final records read `status=killed`, `runtimeHandle=old`, `killedReason=runtime`. The restoredAt/PR disappear in (a); the new empty reservation is overwritten in (b). The same interval can recreate a record after archive. This directly contradicts the promised protection against concurrent restore/spawn/kill. Shared exclusion or a versioned update protocol must cover every writer; another unlocked read immediately before rename cannot close the race.

### M-1 major — a missing tmux server leaves dead records active indefinitely

`packages/plugins/runtime-tmux/src/index.ts:225-229`; `packages/core/src/lifecycle-manager.ts:496-505`. Stop a private server holding two tracked sessions. At six polls 18:13:32.994..38.246Z both records remain working, health warn, no killedReason. No time bound exists. `ao session cleanup` skips such records on probe rejection. A new server alone does not solve it: B-1 then suppresses both explicit missing-target results. Compare `session-manager.ts:457`, which already treats `ERR_RUNTIME_NO_SERVER` as dead for orchestrator replacement. A host restart therefore preserves old worker records until another action restores/cleans them or an unrelated recorded live session lets the old tracked worker converge.

### M-2 major — a PR change that preserves status and handle passes the comparison

`packages/core/src/lifecycle-manager.ts:1338-1342`; `packages/core/src/session-manager.ts:3142-3147`. While a poll is resolving the old PR's closed state, change `pr` from #1 to open #2 and keep `status=pr_open` (exactly the metadata write performed by claimPR). The callback then returns closed for #1. The poll persists `{status:killed, pr:.../pull/2, killedReason:pr-closed}`. It compares neither PR identity nor a record generation, so C3 will never recover this newly assigned open PR. My scratch callback reproduces that exact result. This is a remaining race of B, present in the older unlocked updater too; the fix's compare must include every identity used for its decision.

### M-3 major — a restarted worker permanently skips already-dead runtimes

`packages/core/src/lifecycle-manager.ts:1560-1564`, `packages/core/src/session-manager.ts:1264-1272`. When a new worker reads a persisted working record whose runtime is already absent on an answering server, list() changes only the in-memory status to killed. The filter then excludes it because the persisted status is not a recoverable kill and no tracked state exists. It is excluded again on every subsequent poll. My fresh-worker run produced working/working records at all six polls, 18:13:16.352..21.450Z, with health **ok**. This is a pre-existing gap, explicitly acknowledged in the author report, but the new C1/recovery behavior still does not converge after a worker restart. Reproducer: start a keeper, write one working record with a stored but missing handle, start a fresh worker, and poll repeatedly; an additional live recorded orchestrator does not make the skipped record eligible. The new runtime-death test deliberately warms the worker before death (`killed-status-fix.test.ts:146-148`), excluding this case.

### m-1 minor — the local tmux target-negative texts are not exhaustive

`packages/plugins/runtime-tmux/src/index.ts:50`, `packages/plugins/agent-claude-code/src/index.ts:544`. Local `tmux -V` is `tmux 3.4`; the installed Debian/Ubuntu changelog identifies 3.4-1ubuntu0.1 and documents its upstream 3.4 baseline. With an answering private server, set `exit-empty off`, end its last session, then run `has-session -t ao47-missing`. Actual result at 18:15:24.519Z: `ERR_RUNTIME_PROBE ... no current target`. It is neither a timeout nor an unreachable server, and the server has no sessions. The three `can't find` patterns therefore do not cover every absent-target situation on the very version used here. Reproducer:
```
# Run ONLY in a clean scratch environment; tmux below must be the private -L shim.
tmux new-session -d -s keeper '/bin/sleep 1000000'
tmux set-option -g exit-empty off
tmux kill-session -t keeper
tmux has-session -t ao47-missing
```
The installed binary also contains `no sessions`; this alone is not proof that has-session emits it, so I do not claim that text as a reproduced result. No upstream C source tree was available offline; I checked the available installed changelog and exercised the installed binary. The ordinary missing session/window/pane diagnostics match the regex. An explicit empty-server check would be safer than assuming every other diagnostic is unknown forever.

### m-2 minor — the dormant recovery module still converts rejected probes to cleanup

`packages/core/src/recovery/validator.ts:66-68,92-94`, `recovery/actions.ts:145-169`. Both exceptions become false. With a real scratch workspace and both probes rejecting, the actual validator returned `{classification:"dead",action:"cleanup",runtimeAlive:false,agentProcessRunning:false}`. The default is `autoCleanup:true` (`recovery/types.ts:199`); cleanup destroys the workspace and archives the record. Source search confirms the author's caveat: the module has no current production caller or core public export. This is a contract mismatch and a latent destructive path, not a currently routed CLI regression. Align it before enabling that module. The caller audit must not describe all callers as safe without this qualification.

## Ratings of the required opposite-failure cases

| Case | Rating | Persistence and practical cost |
| --- | --- | --- |
| (a) At least two project panes end in one poll on an answering server, no live recorded project session | **Blocker, B-1** | Working forever; pending state is cleared forever. No session.killed/agent-exited transition. CLI list/status can still show killed/exited through enrichment. Explicit session cleanup **does** identify and remove them when the server answers: my dry run returned killed=[kr-1,kr-2]. Do not claim cleanup skips this variant. |
| (b) The tmux server is gone / host restarted | **Major, M-1**, compounded by B-1/M-3 | Unknown indefinitely, so stored statuses stay working and cleanup skips absent-server probes. Status activity is unknown for claude-code. ao start can replace the orchestrator via its typed no-server exception; old workers need the new server and successful lifecycle eligibility, which M-3 can prevent forever. |
| (c) Agent exits within the 60 s launch grace, shell remains | **Acceptable bounded delay in isolation** | It stays spawning/working until the grace expires, then needs two negative polls. With 30 s polls the death can take nearly 120 s from launch, plus probe/cache time, to persist. If all recorded sessions die, B-1 makes it unbounded. |
| (d) Worker restarts more often than two polls | **Major availability limit**, plus M-3 for absent panes | pendingKills is only in memory, so a shell with a dead agent never gets two consecutive observations from the same worker. A fully missing pane can instead be permanently filtered at startup even after restarts cease. The new restart test explicitly expects the first behavior. |
| (e) Exactly one other live recorded session, the orchestrator, while all workers end | **Pass, bounded** | Two live-measured dead worker panes became killed/runtime on poll 2; orchestrator stayed working through all six polls. One positive recorded runtime suffices, provided its evaluation succeeds and it is eligible; a merely unrecorded tmux keeper does not. |

Other non-converging paths: a legacy record that permanently lacks both stored handle fields is never probed; malformed/future timestamps can remove or extend grace; alternating negative/positive/unknown observations clear confirmation repeatedly; repeated compare failures delete both pending and tracked state, and a subsequent missing-runtime record may then fall into M-3. A compare failure need not repeat forever if the external writer stops; the source offers no retry bound when it does repeat. An evaluation rejected by Promise.allSettled is omitted from the outage population and does not clear that session's pending observation; expected probe exceptions are generally caught earlier, but an unexpected rejected evaluation can bridge non-adjacent polls.

## C1 and reactions

The normal confirming write is one additional polling interval after the first negative, not necessarily one interval after the death. Death just after a poll is observed at the next poll and committed at the following one. Claude-code additionally caches the process list for five seconds. The 70 s stand-in run below confirms a real agent exit, after grace, becomes killed/agent-exited without a relaunch.

`session.killed` maps to `agent-exited` at lifecycle-manager.ts:159-160; its reaction/notification is deferred until persistence. PR-driven killedReason=pr-closed bypasses C1 because it has no dead liveness signal. While confirmation or outage suppression preserves an old CI/review status, the per-status dispatch routines at :1510-1513 can still attempt sends. Core send then performs its own liveness/restore decisions; a deferred killed status is not a guarantee that nobody will send or restore. `summary.all_complete` uses **list()'s in-memory statuses** (:1606), so in B-1 it can fire even though the same poll has not persisted any killed status or fired any individual agent-exited event.

## C3 recovery: selection, cost, and identity

Every poll includes killed records whose killedReason is runtime or agent-exited, even when they have a PR, plus older killed records with neither a reason nor a PR. There is no age, worktree-existence, or launch-owner requirement. A legacy orchestrator without worktree can qualify if its stored handle reaches a matching process; null activity is sufficient once processRunning is true. Records with pr-closed, a legacy PR-bearing killed record, merged, done, terminated, cleanup, or errored are excluded from this recovery path. Restore itself leaves killedReason behind until a later lifecycle status transition removes it; the author accurately calls this out.

On a live recoverable record, normal list enrichment already performs has-session and an activity/process check. Recovery adds has-session, one explicit list-panes/process check, and another through getActivityState. That is up to two has-session and three list-panes calls per live record per poll, shared cached ps reads, plus JSONL/introspection file reads. A dead runtime generally costs two has-session probes per recoverable record per poll forever; records are not retired by age. The extra cost grows with accumulated historical killed records. A failed recovery probe is not counted in outage health and can leave health ok when all eligible records are already killed.

The source checks only tmux name/TTY and a process name, not the agent session identity or handle creation time. Live proof: destroy a recorded killed/runtime pane, create a **different** stand-in under its old tmux name without changing the stored handle, then poll. At 18:18:35.689Z the old record became working despite still storing its earlier handle creation value `1792520310330`. A different claude in an existing pane has the same weakness. An intentionally stopped record is not exempt unless it has an excluded status/reason or has already been archived. If an operator's kill is between reading the record and its archive step, recovery or B-2 can also race that archive. A session already archived before updateMetadataIf's read is protected; archive after that read is not.

Successful recovery sends `session.working`, priority info, through the configured notifier routing; there is no session.working reaction key. It resets allCompleteEmitted and clears the old agent-exited reaction tracker, so another death can trigger agent-exited again. On later polls, normal PR/CI/review status processing resumes and can run reactions again. Persisted dispatch hashes suppress already-sent identical backlog/CI payloads where implemented; recovery is not a general promise that completed reactions never recur.

## A and B details

Spawn writes ISO `createdAt` at session-manager.ts:1652 and orchestrator spawn at :2140. Restore writes ISO restoredAt at :3481; recovery/actions.ts:66 also refreshes restoredAt without launching an agent. `isWithinLaunchGrace` takes restoredAt first, otherwise createdAt, and parses it with Date.parse. Missing both or an invalid selected value means no grace. A bad restoredAt does not fall back to a valid createdAt. The comparison has no lower bound on age: a future launch timestamp or a backward wall-clock jump prolongs grace until that timestamp plus 60 s. A forward jump expires it early. Reused IDs normally receive a fresh createdAt/full record from spawn, but pendingKills and tracked states are keyed only by session ID, not launch generation.

B correctly refuses lifecycle liveness probing of an unfinished reservation with neither runtimeHandle nor tmuxName. Session-manager enrichment may still read activity on such a record. A concurrent metadata hook can lose its PR/branch fields in B-2's read-to-rename interval; claimPR can additionally pass the limited comparison without any narrow interprocess interval, as M-2 demonstrates. The PR race was repeated using actual sm.claimPR with a stand-in SCM's resolvePR/getPRState/checkoutPR, not just a hand-written metadata merge: claimPR returned the open #2, branchChanged=true, takenOverFrom=[], followed by persisted killed/pr-closed on #2. Existing tests cover a change *before* updateMetadataIf reads and an archive *before* that read. They do not establish atomicity after the read.

## D caller audit checked against source

The following covers every non-test Runtime.isAlive/Agent.isProcessRunning call found by rg under packages/. Calls in generated dist are copies, not extra callers. Before the change, tmux/claude probe errors usually arrived as false; their catches therefore did not protect those callers.

| Caller | New rejection path and assessment |
| --- | --- |
| lifecycle-manager.ts:496 | Sets failed, continues through activity/PR logic. A claude-code socket failure eventually keeps existing status; it is not a global early return, so another plugin that still returns exited can override the unknown. Grace and C1/C2 then govern that result. |
| lifecycle-manager.ts:556 | Caught at :565; keeps stuck/needs_input explicitly; other statuses may still advance through PR/default logic. No direct kill from the thrown check. |
| lifecycle-manager.ts:442,444 | Keeps killed; unknown cannot recover. Failed recovery is not propagated to worker-health outage accounting. |
| session-manager.ts:454 (call sites :1820,:1861) | Unknown throws and retains record; ERR_RUNTIME_NO_SERVER returns false and permits archive/replacement. The report's stated exception is real and enables ao start after a restart. |
| session-manager.ts:880,903 | openCodeHolderReason catches rejection at :911 and retains the ID as unknown. No OpenCode binary was invoked in this review. |
| session-manager.ts:1264 | list/get catch at :1274, continue activity enrichment. No persisted write, and no in-memory killed from this rejected probe alone. |
| session-manager.ts:2516 | cleanup catches at :2535 and skips when runtime death is its only reason. PR/issue completion can independently authorize cleanup; the report's phrase 'session skipped' is conditional on no other cleanup trigger. |
| session-manager.ts:2743-2744,2790-2791 | Readiness waits catch to true. They still also require foreground/output conditions, so 'stops waiting' is not unconditional. These waits do not themselves restore. |
| session-manager.ts:2855-2856,2862-2863 | prepareSession catches each probe to true, tries delivery on the stored handle. If the other probe says false it can still restore. A failed sendMessage later goes through :3069 and calls prepareSession(true)/restore; catching the probes does not remove that route. |
| recovery/validator.ts:66,92 | Converts both rejections to false; dormant destructive path, m-2. Author report correctly disclosed it rather than fixing the excluded module. |
| CLI commands/session.ts:173 | Reports 'Cannot tell whether session ... is running', exits 1, never attaches. The new unit test passes; a live scratch call with the server stopped also exited 1 with that message. |
| claude-code/src/index.ts:861 | getActivityState returns null on process-check rejection. Lifecycle fallback may retry process checking; null is not proof of exited. New unit test passes. |
| agent-codex/src/index.ts:439, agent-gemini/src/index.ts:158, agent-opencode/src/index.ts:1218 | Their own implementations still catch errors into false, so those getActivityState calls still can report exited on failures. They do not inherit the claude-code fix. No real agent invocation was used. |

runtime-herdr isAlive still returns false on its catch; core getHerdrPaneProcesses still maps failure to an empty list, so even claude-code on Herdr does not yet satisfy the new error contract. This is correctly identified as follow-up, not fixed by changing the CLAUDE.md prose. The rule at CLAUDE.md:431 and types.ts comments describe the intended contract; getActivityState returning null on a failed process check is compatible because the 'must reject, never false/null' wording applies to isProcessRunning itself.

Local private-server diagnostic run (server PID 3255592, then stopped):
```
has-session -t missing       -> can't find session: missing
list-panes -t missing        -> can't find window: missing
has-session -t present:9     -> can't find window: 9
has-session -t present:0.5   -> can't find pane: 5
# after stopping that private server:
has-session -t missing       -> no server running on /tmp/tmux-44402/ao47-killed-review-diagnostics
```
No tmux minimum/version matrix is declared in the checked runtime README/core tmux helper. I verified the installed 3.4 behavior; I cannot establish every historical tmux version's diagnostics from an unavailable offline source tree.

### Send, attach, and start judgment

The author is right about send's remaining retry, and the real run makes the consequence concrete. During a hidden socket:
```
18:18:28.708Z original private server PID=3190962, socket hidden
18:18:28.741Z cleanup -> killed=[], skipped=[kr-1,kr-2], errors=[]
18:18:28.801Z working send -> Cannot send to session kr-1: session needed to be restarted before delivery (Session kr-1 cannot be restored: session is not in a terminal state)
18:18:28.802Z records remain kr-1=working, kr-2=working
# set kr-1 to a stale killed record, leave its actual agent alive behind the hidden socket:
18:18:30.256Z killed send succeeded
18:18:30.257Z kr-1=spawning, kr-2=working
18:18:30.265Z a new server PID=3191360 exists at the original socket path
18:18:30.280Z after stopping the new server and restoring the hidden socket,
              original server PID=3190962 still has ao47-kr-1 and ao47-kr-2
```
A runtime create really does start another server at a missing socket path. D improves working-record handling, but cannot be advertised as universally preventing restore on an unreachable server. In the working-record case restore is attempted and refuses; in a terminal/restorable case it succeeds. CLI send delegates to core when its raw tmux probe cannot reach the session (send.ts:323); while a tmux session is alive it sends directly. A wrong-but-live server remains capable of duplicate restore and cleanup of a live record/worktree; D cannot distinguish that from an actual missing target.

Session attach now handles unknown accurately. ao start's project-mode spawnOrchestrator gives no-server a special false, so it archives/replaces the old orchestrator after a reboot. The worker starts before that orchestrator as before; the grace protects the new launch. Old worker records have the M-1/M-3 problems even if the orchestrator replacement succeeds. The no-server code also cannot distinguish a temporarily hidden socket from a reboot, so the spawnOrchestrator exception can replace an alive but unreachable orchestrator; this is an explicit reported policy exception, not a universal guarantee of non-destruction on rejection.

## Independent validation and existing-test audit

All commands ran in this worktree, after installing and building it. Common test/build environment:
```
env -i HOME=/tmp/ao47-killed-review/home \
  PATH=/tmp/ao47-killed-review/bin:/usr/bin:/bin CI=true <command>
```
The bin directory has only node/pnpm symlinks and rejecting gh/private-tmux shims, **no agent binary**. Tests received no AO_* variable. Live runs additionally used a separate livebin/claude stand-in, scratch-only AO_STATE_ROOT and AO_CONFIG_PATH, and a unique REVIEW_TMUX_SERVER. Every tmux shim unsets TMUX and execs `/usr/bin/tmux -L "$REVIEW_TMUX_SERVER"`. No model turn, real agent, opencode call, npx, real-config ao invocation, push, PR, or network gh call occurred.

| Command | Independently observed result |
| --- | --- |
| pnpm install --frozen-lockfile | Exit 0, Done in 2.1s; initial unbuilt ao bin-link warning was resolved by the subsequent build. |
| pnpm build | Exit 0, all build scripts Done, ending with cli. |
| pnpm --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-agent-claude-code test | Exit 0: core 42 files/1145 tests; CLI 20/261; tmux 1/37; claude-code 3/211. All passed, 1654 tests total. |
| pnpm --filter @aoagents/ao-integration-tests test | Exit 0: Test Files 10 passed, 3 skipped (13); Tests 90 passed, 24 skipped (114). Real tmux, no agent binary on PATH. |
| pnpm lint | Exit 0: 5 problems (0 errors, 5 warnings). |
| pnpm typecheck | Exit 0, all scripts Done including cli and integration-tests. |
| pnpm -r --no-bail test | Exit 0: 2613 passed, 29 skipped, 2642 total; 89 passed test files, 3 skipped. |

Full-run per-package summary lines, stripped of ANSI formatting:
```
core:                 Test Files 42 passed; Tests 1145 passed
agent-gemini:         Test Files  1 passed; Tests   62 passed
agent-codex:          Test Files  3 passed; Tests  215 passed
notifier-desktop:     Test Files  1 passed; Tests   26 passed
agent-claude-code:    Test Files  3 passed; Tests  211 passed
runtime-herdr:        Test Files  1 passed; Tests   36 passed
scm-github:           Test Files  3 passed; Tests  140 passed | 5 skipped (145)
tracker-github:       Test Files  1 passed; Tests   42 passed
runtime-tmux:         Test Files  1 passed; Tests   37 passed
workspace-worktree:   Test Files  1 passed; Tests   50 passed
agent-opencode:       Test Files  2 passed; Tests  298 passed
integration-tests:    Test Files 10 passed | 3 skipped (13); Tests 90 passed | 24 skipped (114)
cli:                  Test Files 20 passed; Tests 261 passed
```
These passing gates do not cover B-1/M-1 as eventual-convergence requirements; some new tests explicitly require the problematic repeated no-write behavior.

Changed existing tests:

- lifecycle-manager.test.ts now supplies stored handle/metadata consistently. Its three dead-runtime/exited/fallback cases assert working after one check and killed after two. This is the required C1 contract adaptation, not a weaker eventual-death assertion; the fixtures have no launch timestamps, so no grace applies. The CI-enrichment fixture now writes the real record and uses that metadata.
- plugin-integration.test.ts uses the seeded metadata/handle in list/get for its CI/merged/review assertions. The original assertions remain. This repairs unrealistic fixtures without weakening the behavior checked.
- runtime-tmux index.test.ts replaces generic 'session not found' failure with an execFile-shaped error containing actual `can't find session` stderr, and tests unknown/timeouts separately. This correctly changes the contract. The integration test adds a keeper before its destroy/isAlive assertion, which **narrows coverage**: it no longer exercises the common last-session/server-exits path. A separate test should state what that path means to lifecycle/cleanup, rather than making the only destroy test avoid it.
- claude-code index.test.ts changes 'false on generic tmux failure' to rejection, keeps explicit pane-not-found=false, and verifies ps cause. The activity-detection addition checks null on process error. Both correctly enforce D.
- Round-1 M3 test 1 reverses its fabricated-handle assertion, appropriately: the old assertion encoded the unwanted probe. M3 test 2 moves its concurrent full-record write into get() enrichment's activity callback. It is now a stale-read/stored-handle test; it does not exercise a write arriving during the lifecycle's liveness probe. It runs only one check, so C1 can mask an attempted kill. Removing the stored-handle guard fails M3 test 1 but **not** this adapted second race test. The new compare test covers a changed record before updateMetadataIf reads; B-2 remains uncovered.
- Round-1 M2 same-worker case makes createdAt old enough to allow its deliberate first kill. That preserves its recovery purpose. The original M1 single-check cases alone cannot distinguish A from C1; the new multi-poll grace tests do. The old 'ps outage' M4 fixture is within the launch grace, so it alone does not isolate C2; the new LONG_AGO outage tests do.

### Mutants, in a git-archive scratch copy of b8a43f5f

No tracked source in the review worktree was edited. Each variant starts from pristine source, uses local vitest and the same clean test environment, and exits 1 because these assertions fail:

| Mutant | Failing tests and summary |
| --- | --- |
| No launch grace | Three A tests: keeps just-launched over several polls; measures grace from restoredAt; applies grace to terminal fallback. **3 failed, 37 passed (40)** across fix/race. |
| Grace from createdAt only | A: measures the grace from restoredAt when present. **1 failed, 31 passed (32)**. |
| Persist first negative | C1: exited-after-grace second poll; runtime-gone second poll; one-poll negative then positive; worker restart; plus B concurrent-restore test. **5 failed, 35 passed (40)** across fix/race. |
| Outage rule applies to one session (both answered/probed thresholds become 1) | C1 agent exit and runtime death; C2 killed-record exclusion; B concurrent restore; A no-timestamp death; A runtime-gone during grace; D one-rejected health. **7 failed, 25 passed (32)**. |
| Recovery includes pr-closed | C3: never moves killed with killedReason=pr-closed. **1 failed, 31 passed (32)**. The separate end-to-end 'never recovers' test still passes because it samples after two polls and misses a recover-then-kill intermediate oscillation. |
| isAlive false on every error | Four typed-error/cause cases (no server, no socket, denied socket, other text) and timeout rejection. **5 failed, 32 passed (37)**. |
| updateMetadataIf without comparison | B: writes nothing when restore changes record during confirming probe. **1 failed, 31 passed (32)**. This demonstrates useful stale-snapshot protection, not atomicity across its own read/rename. |
| Remove stored-handle guard | Round-1 M3: does not write killed into a reserved record; fabricated-handle call assertion fails. **1 failed, 7 passed (8)**. |

The suite is not vacuous: all eight requested/extra mutants are caught somewhere. It is insufficient to justify land safety, because genuine all-dead convergence and interprocess commit atomicity are missing properties.

## Live evidence, timestamps from the external record-file reader

The fixture uses the worktree build, real tmux/claude-code plugins, real session/lifecycle managers, and a stand-in `claude`. The fixture seeds worker metadata after runtime.create. The separate launch-delay runs invoke the actual built `ao start kr`, including its detached lifecycle worker. The observer reads record files after each completed poll and timestamps outside the source; it does not patch the implementation. Polls are approximately one second apart, preserving the same worker instance unless explicitly labeled fresh.

### All recorded project sessions dead; answering server held by unrecorded keeper

| UTC snapshot | kr-1 | kr-2 | Health |
| --- | --- | --- | --- |
| 2026-10-20T18:13:10.189Z | working | working | warn |
| 2026-10-20T18:13:11.218Z | working | working | warn |
| 2026-10-20T18:13:12.246Z | working | working | warn |
| 2026-10-20T18:13:13.275Z | working | working | warn |
| 2026-10-20T18:13:14.304Z | working | working | warn |
| 2026-10-20T18:13:15.334Z | working | working | warn |

### Fresh worker over those dead-at-start records

| UTC snapshot | kr-1 | kr-2 | Health |
| --- | --- | --- | --- |
| 2026-10-20T18:13:16.352Z | working | working | ok |
| 2026-10-20T18:13:17.372Z | working | working | ok |
| 2026-10-20T18:13:18.393Z | working | working | ok |
| 2026-10-20T18:13:19.412Z | working | working | ok |
| 2026-10-20T18:13:20.430Z | working | working | ok |
| 2026-10-20T18:13:21.450Z | working | working | ok |

### Two live sessions ended by private kill-server

| UTC snapshot | kr-1 | kr-2 | Health |
| --- | --- | --- | --- |
| 2026-10-20T18:13:32.994Z | working | working | warn |
| 2026-10-20T18:13:34.044Z | working | working | warn |
| 2026-10-20T18:13:35.092Z | working | working | warn |
| 2026-10-20T18:13:36.144Z | working | working | warn |
| 2026-10-20T18:13:37.196Z | working | working | warn |
| 2026-10-20T18:13:38.246Z | working | working | warn |

### Replacement private server, same name; six further polls

| UTC snapshot | kr-1 | kr-2 | Health |
| --- | --- | --- | --- |
| 2026-10-20T18:13:39.302Z | working | working | warn |
| 2026-10-20T18:13:40.331Z | working | working | warn |
| 2026-10-20T18:13:41.361Z | working | working | warn |
| 2026-10-20T18:13:42.390Z | working | working | warn |
| 2026-10-20T18:13:43.421Z | working | working | warn |
| 2026-10-20T18:13:44.450Z | working | working | warn |

### Two worker panes ended with literally no third tmux session

| UTC snapshot | kr-1 | kr-2 | Health |
| --- | --- | --- | --- |
| 2026-10-20T18:18:12.068Z | working | working | warn |
| 2026-10-20T18:18:13.116Z | working | working | warn |
| 2026-10-20T18:18:14.166Z | working | working | warn |
| 2026-10-20T18:18:15.217Z | working | working | warn |
| 2026-10-20T18:18:16.267Z | working | working | warn |
| 2026-10-20T18:18:17.318Z | working | working | warn |

### Delayed actual ao start

A 2 ms read-only file watcher covered startup through 35 s after each command returned (including the second default-interval poll). All observed record versions were working; the only later change was prAutoDetect=off. The two workers were stopped by their recorded exact PIDs before their private servers.

| Delay | Initial working record | Enrichment-only update | Worker PID | Server PID |
| --- | --- | --- | --- | --- |
| 1 s | 18:14:09.370Z | 18:14:09.499Z | 3156626 | 3156638 |
| 3 s | 18:14:44.750Z | 18:14:44.900Z | 3160411 | 3160423 |

Final records in both runs: status=working, role=orchestrator, no killedReason, no killed version in either watcher log.

### Five-second socket outage and legacy recovery

```
2026-10-20T18:13:55.813Z socket hidden /tmp/tmux-44402/ao47-killed-review-live
2026-10-20T18:13:55.860Z hidden 1 {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (answers dead or probes that could not run; check the tmux server and ps)"}
2026-10-20T18:13:56.910Z hidden 2 {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (answers dead or probes that could not run; check the tmux server and ps)"}
2026-10-20T18:13:57.960Z hidden 3 {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (answers dead or probes that could not run; check the tmux server and ps)"}
2026-10-20T18:13:59.009Z hidden 4 {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (answers dead or probes that could not run; check the tmux server and ps)"}
2026-10-20T18:14:00.061Z hidden 5 {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"warn","reason":"probe outage: no probed session could be confirmed alive in one poll (answers dead or probes that could not run; check the tmux server and ps)"}
2026-10-20T18:14:01.062Z socket restored
2026-10-20T18:14:01.170Z socket restored {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"ok"}
2026-10-20T18:14:01.232Z legacy killed recovery {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"ok"}
2026-10-20T18:14:01.281Z after recovery {"kr-1":{"status":"working"},"kr-2":{"status":"working"}} {"health":"ok"}
```

The renamed socket was restored in a finally block. The legacy test first wrote status=killed with no reason/PR while its pane remained alive, then used a fresh lifecycle manager; its first completed poll restored working.

### Stand-in exits after a full 70 seconds

```
2026-10-20T14:14:01,374387088-04:00 pid=3154038 delay=0 lifetime=70
2026-10-20T18:14:01.452Z 70s baseline {"kr-1":{"status":"working"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
2026-10-20T18:15:14.842Z 70s elapsed69 {"kr-1":{"status":"working"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
2026-10-20T18:15:15.938Z 70s elapsed70 {"kr-1":{"status":"working"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
2026-10-20T18:15:16.994Z 70s elapsed71 {"kr-1":{"status":"killed","killedReason":"agent-exited"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
2026-10-20T18:15:18.050Z 70s elapsed72 {"kr-1":{"status":"killed","killedReason":"agent-exited"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
2026-10-20T18:15:24.440Z 70s elapsed78 {"kr-1":{"status":"killed","killedReason":"agent-exited"},"kr-orchestrator":{"status":"working"}} {"health":"ok"}
```

The stand-in started at 18:14:01.374Z, exited about 18:15:11.374Z, and was persisted killed/agent-exited at 18:15:16.994Z. The ~5.6 s includes the shared ps cache plus confirming polls. The elapsed labels count fixture iterations after setup, not exact seconds from launch. One lifetime=70 launch was logged, and no restore/runtime relaunch occurred. A live recorded orchestrator served as the positive control.


## Minimal race reproducer pattern

B-2 was run as two independent Node processes, with a deterministic scheduler barrier inserted only into the scratch harness. This excerpt shows the restore case; WT is the reviewed worktree and D is a directory strictly under the scratch root. Run under the clean scratch environment above, after building WT. The atomic-write function uses the synchronized builtin binding, so the callback fires after updateMetadataIf compared its snapshot and before it writes/renames its temp file.

```js
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const WT = '/home/taisung/.worktrees/agent-orchestrator/ao-47';
const D = '/tmp/ao47-race-reproducer'; // create a fresh scratch directory
const m = await import(`${WT}/packages/core/dist/metadata.js`);
fs.mkdirSync(D, { recursive: true });
m.writeMetadata(D, 'kr-1', { status: 'working', runtimeHandle: 'old' });
const originalWrite = fs.writeFileSync;
let once = true;
fs.writeFileSync = function (path, ...args) {
  if (once && String(path).startsWith(`${D}/kr-1.tmp.`)) {
    once = false;
    const code = `const m=await import('${WT}/packages/core/dist/metadata.js');
      m.updateMetadata('${D}','kr-1',
        {status:'spawning',runtimeHandle:'new',restoredAt:new Date().toISOString()});`;
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: process.env });
  }
  return originalWrite.call(fs, path, ...args);
};
syncBuiltinESMExports();
const changed = m.updateMetadataIf(D, 'kr-1',
  {status:'working',runtimeHandle:'old'}, {status:'killed',killedReason:'runtime'});
fs.writeFileSync = originalWrite;
syncBuiltinESMExports();
console.log(changed, m.readMetadataRaw(D,'kr-1'));
// Observed: true; killed/runtime, old handle, no restoredAt.
```

To reproduce archive/reservation overwrite, replace the child code's updateMetadata with deleteMetadata(D,'kr-1',true) followed by reserveSessionId(D,'kr-1'). To reproduce record resurrection after an archive, omit the reserve. The earlier read comparison cannot detect any of these later writes.

M-2 needs no narrow filesystem scheduling: configure a stand-in SCM so that getPRState(oldPR) awaits real sm.claimPR(sessionId,newOpenPR), then returns closed for oldPR. resolvePR returns newOpenPR, its getPRState returns open, and checkoutPR returns true without external git. Start from pr_open on oldPR with a stored live handle; lm.check(sessionId) leaves newOpenPR marked killed/pr-closed. The actual observed result was:
```
claimPR returned: pr=#2, branchChanged=true, takenOverFrom=[]
persisted: branch=feat/two, pr=https://github.com/scratch/kr/pull/2,
           status=killed, killedReason=pr-closed, runtimeHandle=old
```

## Scope, commits, and what is correct

`git log --oneline e751a3ee..b8a43f5f` contains **four**, not five, commits:
```
b8a43f5f docs: state that isProcessRunning rejects when it cannot check
0b54c4ac test(core): cover launch grace, confirmation, outage, recovery and probe rejections
34ea8624 fix(core,plugins): stop persisting killed for live sessions
0571fa12 test(core,cli): add failing reproducers for live sessions persisted as killed
```
I inspected each commit and the resulting source. The commit subjects/bodies follow conventional messages and explain why, without issue references, emoji, or Co-Authored-By trailers. `git branch -r --contains b8a43f5f` produced **no output**. All 19 changed files fit the author brief's source, documentation, and test allowances: core lifecycle/metadata/session-manager/types; tmux and claude-code; CLI session attach; their tests; CLAUDE.md. The integration-test keeper is allowed test scope, but its narrowed scenario is discussed above. index.ts did not need a change because types are already re-exported. config, workflows, spawn/restore/send ordering, I-5, other agents/runtime-herdr, PATH/wrappers, and development files were not changed by the author range. The special no-server handling in spawnOrchestrator is the disclosed exception in the rejection audit, rather than a reorder of startup.

What I found correct:

- Launch grace covers both native activity and fallback process detection, uses restoredAt correctly, is exported, and fixes the measured 1 s/3 s delayed actual-start race.
- A reserved record without a stored handle no longer gets a fabricated-handle lifecycle probe.
- Two-poll confirmation works for an isolated real death when the worker has tracked it, and a live orchestrator lets two simultaneously ended workers converge.
- The available-before-read metadata comparison rejects changed status/handle and missing-record snapshots. That is useful even though it is not an interprocess transaction.
- A five-second socket outage preserves records and reports warn for the two-session fleet; legacy probe-derived killed records recover on the first fresh poll when their actual agent is alive.
- Explicit pr-closed and other excluded terminal records are not recovered by C3; actual probe errors from tmux/claude-code are no longer automatically false. Typed error causes and CLI attach diagnostics are tested.
- The requested gates and all eight independent mutants produced the expected results. The author report discloses important limitations rather than hiding them, but those disclosures do not resolve B-1/B-2.

## Required changes before landing

1. Bound the outage suppression and define eventual convergence for repeated authoritative negatives; cover all-worker death with and without a recorded live orchestrator, server disappearance/replacement, and worker startup over dead records. Preserve the transient-outage protection while making those terminal cases converge.
2. Replace the unlocked read/compare/rename with an update protocol shared by lifecycle, spawn, restore, hooks, claimPR, and archive. Compare a generation/version and the decision's PR identity; do not recreate archived/reserved records or overwrite a newer launch. Add deterministic interprocess tests after the comparison, not only callbacks during probes.
3. Define the no-server policy consistently across startup, lifecycle, cleanup, and delivery, including missing-socket duplication. Keep explicit tests for last-session death instead of covering only a surviving keeper.

The two minor items can follow separately if tracked: complete local empty-server diagnostic handling, and make the dormant recovery module honor unknown before it gains a production entry point.

## Final isolation and cleanup evidence

Both actual detached workers started by the two ao start runs were terminated using their exact PID files and verified command lines: **3156626**, **3160411**. Their private tmux servers were stopped afterward. All live harnesses, CLI invocations, test processes, and mutant runners exited; the in-process lifecycle timers were stopped in finally blocks. The private servers used names ao47-killed-review-live, -additional, -start-1, -start-3, -diagnostics, -integration, and -full. No default-server tmux call was made. No pattern-based kill was used. The protected real workers 271579 and 321413 were only read through their observability files for attribution; they were never signaled.

`ps -o pid,args -u "$(id -u)"`, filtered outside the shell for the scratch root/private server names/worktree CLI path, returned:
```
[]
```
The filtering command's own arguments did not contain those paths; this is an empty list of review processes, not a list obtained by hiding a running harness. Normal process exit is the cleanup for completed helpers/tests. The explicit scratch root (including fake homes, state, logs, mutants, git fixture, and stand-ins), its marker, and only the named private socket files were removed after this evidence was copied into the review. The worktree dependencies/build remain as requested validation output.

`ls -la --time-style=full-iso ~/.ao/bin` after the review:
```
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```
A byte-for-byte diff of the before/after listings produced **no output**. The real wrappers/settings/configs were not written.

Final requested command:
```
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/ao47-killed-review-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```
Output:
```
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-78
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-46
```
Attribution of **every entry**:

- f6790d5546be-agent-skills/sessions and its as-78 file: the real agent-skills fleet's lifecycle worker **321413** wrote working -> stuck at **2026-10-20T18:25:06.470Z**, as its read-only observability trace confirms; the file mtime is 18:25:06.468Z. The directory changed because of that atomic replace.
- 60756641ca25-agent-orchestrator/sessions and its ao-46 file: the real fork fleet's lifecycle worker **271579** wrote working -> stuck at **2026-10-20T18:16:33.945Z**, confirmed in its read-only trace; the file mtime is 18:16:33.943Z. Its directory changed because of that replace.

These are the other fleets' writes, not review writes. All review nodes/tests/helpers used env -i and fake HOME; live state roots were exclusively the explicit /tmp roots documented above. Only cat/stat/grep read the real records/observability files for this attribution.

No commit, push, PR, ao done-message, real-state mutation, real agent launch, or global installation was performed. Only this uncommitted review and the requested .agent_report.md are review deliverables; the pre-existing .agent_task.md remains untracked and unchanged.
