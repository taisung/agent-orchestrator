# Review r1: orchestrator start without a server and stop from its own pane

LAND-WITH-CHANGES

**Counts: 0 blocking, 3 major, 2 minor findings.** Fix M-1 and M-2 before landing. M-3 is a gap in the explicitly promised malformed-answer behavior and needs an end-to-end regression test and correction. The two main incident paths work in the normal environment; the stop detection still permits a half-stop, and the tests do not establish the whole claimed boundary.

Reviewed `dc7815d2..f095f5ce4a538088a5c723503dc3027cef24685a` on `review/start-no-server`, 2026-10-22, reviewer ao-64. I read startup, shutdown, lifecycle launch, registry, core and runtime source before the author's report. I built and tested this worktree. Production source was not changed. No commit, rebase, pull, push, PR, network call, real-state ao command, real agent, or real Herdr server was used. Scratch helper/test mutations were confined to `/tmp/aosnr`.

**M-1 — An empty pane lookup is treated as proof that the caller is outside.**

Location: `packages/cli/src/commands/start.ts:1260-1263` (`mayRunInsideSession`).

When AO_SESSION and AO_SESSION_NAME are absent, a stale TMUX_PANE causes native tmux to return an empty session name **with exit code 0**. `execSilent` returns an empty string, not null; line 1263 answers false. The caller then executes the kill in its own process and dies with the pane. A missing TMUX_PANE also returns false at line 1261 despite TMUX identifying an enclosing server.

Measured on the built tip, private server `aosnr-live`, after `ao start scratch` and the stand-in ended:

```text
tmux -L aosnr-live display-message -p -t %999999 '#{session_name}'
stdout = '\n', rc = 0
```

Sent into that orchestrator's own pane:

```sh
env -u AO_SESSION -u AO_SESSION_NAME TMUX_PANE=%999999 ao stop scratch; echo EMPTY_RC=$?
```

The pipe-pane log ends with:

```text
Stopping orchestrator for scratch
- Stopping orchestrator session
```

There is no detached message or EMPTY_RC result. The server ended, but the active record remained `status=working`, generation 13, createdAt `2026-10-22T16:17:14.456Z`, and worker **851194** remained alive. No archive for this stop was made. I stopped that worker by its verified scratch PID. This reproduces defect B's half-state on the proposed tip.

Treat an empty or unusable caller lookup as unknown/possibly inside, rather than as a negative. Detaching all existing-session stops would also avoid this inference. Two additional scratch regression cases (empty reply and missing TMUX_PANE) both fail against the tip: expected one startDetachedStop call, got zero. They were not added to the worktree.

**M-2 — The new caller lookup can hang indefinitely.**

Location: `packages/cli/src/commands/start.ts:1262`; `packages/cli/src/lib/shell.ts:14-41`.

`execSilent` calls execFile without a timeout. With the AO names absent, a hung `display-message ... '#{session_name}'` prevents detachment, kill, and any useful error. This introduces an unbounded operation into a path whose runtime-tmux probes otherwise have a five-second timeout.

Measured with a private shim delaying only that session-name query; all runtime liveness and process queries answered normally. After more than six seconds, caller **841258** was still waiting and had printed only the stop heading; query process **841272** was still asleep. No detached child or stop had started. I terminated those two exact PIDs after checking HOME in their environments. The session and worker remained.

Bound this query and classify a timeout as unknown/possibly inside. The restriction on editing shell.ts does not prevent a bounded local probe in start.ts or avoiding this probe entirely.

**M-3 — Falsy malformed liveness answers bypass A3 through sm.list.**

Location: `packages/cli/src/commands/start.ts:997-1001`; `packages/core/src/session-manager.ts:1530-1535` and `:560-568`.

The new helper rejects non-booleans, but only sees nonterminal candidates. Real `sm.list` first uses `if (!alive)` and converts undefined/null/0 into killed/exited. The CLI then filters that record out. `spawnOrchestrator`'s unchanged helper also returns the invalid value without checking its type, so the old record is treated as dead and replaced.

Measured through the actual built CLI and its actual session manager, using a scratch local runtime plugin whose `isAlive` returns undefined and whose `create` records a marker and returns a synthetic handle. No real runtime or model was launched in this fault-injection case. Before: a working record with handle `mal-old`. Output:

```text
✔ Lifecycle worker started (PID 903934)
- Creating orchestrator session
✔ Orchestrator session created
✓ Startup complete
rc=0
CREATE REACHED True
```

After: old record archived at `.../sessions/archive/sc-orchestrator_2026-10-22T16-24-32-775Z`; new record generation 24, createdAt `2026-10-22T16:24:32.780Z`, handle `mal-new`. The worker was stopped by verified PID; its stale scratch pid file was subsequently removed with the scratch directory.

The shipped runtime implementations normally return booleans or throw. This is a malformed-plugin acceptance gap in the requested A3 boundary, not a claim that native tmux returns undefined. The existing test uses the truthy value `"yes"` and mocks `sm.list`, hiding the conversion. Exercise null/undefined/0 through actual listing and preserve the distinction between a persisted terminal record and a malformed probe before deciding to replace it. Core's unsafe coercion predates this patch; the new A3 check does not cover it.

**m-1 — Concurrent detached stops overwrite one another's output.**

Location: `packages/cli/src/lib/lifecycle-service.ts:250-253`; `packages/cli/src/commands/start.ts:1310-1318`.

Every stop opens the same log with `"w"`. Independent file descriptions retain their own offsets after another open truncates the inode. Each waiting caller then reads whichever mixed content remains, not its own child's output.

Two real concurrent scratch callers **858715** and **858716** returned 1 and 0; detached children **858758** and **858748** raced to kill the last session. One confirmed the stop and completed cleanup; the other could no longer confirm absence on the ended server. The successful caller and final shared log included:

```text
✖ Orchestrator session not stopLifecycle worker stopped
✓ Orchestrator stopped
...
confirmed (unknown): the destroy of tmux session ... failed ...
The lifecycle worker was not stopped.
```

The final runtime/record/worker state was correct, but its only durable diagnostic was contradictory and corrupted. A deterministic two-child fixture calling the actual startDetachedStop produced 212 bytes with **191 NUL bytes**, beginning `B refused` and ending `A finished`; child codes were 0 and 1. Use a unique log per invocation, optionally with a separate latest pointer. The current test explicitly accepts shared truncation but never overlaps writers.

**m-2 — The tests do not protect inherited runtime routing.**

Location: `packages/cli/__tests__/lib/lifecycle-service-detached-stop.test.ts:68-88`.

In a scratch copy, I added `TMUX: undefined` after the environment spread in startDetachedStop. **All 64 CLI start/detached-stop tests still passed.** Without the review's forced private-server shim, that mutation would redirect the child away from a named tmux server. The tests assert AO_CONFIG_PATH and AO_STATE_ROOT but not preservation of TMUX or PATH. Set explicit fixture values and assert they survive; add a behavioral private-server test if practical. This is an independently run partial implementation that the new suite accepts.

**Startup assessment.**

The direct helper's rejection rule is appropriately narrow: true means alive, false means gone, and only RUNTIME_NO_SERVER_ERROR_CODE converts a rejection into gone. Other rejections, absent plugins and non-booleans are unknown when they reach this helper. It is stricter than core's boolean-typed helper about malformed return values; M-3 explains why that strictness is incomplete end to end. No broad exception swallowing was introduced.

A1 was measured with a real private tmux server ending while its working record remained. Worker **826209** remained the same. The old record's createdAt `16:13:34.663Z` was archived, and the replacement had createdAt `16:13:35.579Z`. Output:

```text
✔ Lifecycle worker already running (PID 826209)
ℹ Orchestrator session sc-orchestrator does not run: no tmux server runs (... no server running on /tmp/tmux-44402/aosnr-live). Starting a new one.
✔ Orchestrator session created
rc=0
```

The project path goes through core's not-alive branch, archive/delete, reservation and create. It does not call stopRuntime on the absent runtime; doing so would refuse when destroy and probe both reject with no server. Reuse/ignore archive the old record; delete/kill-previous discard it. Isolated mode reserves the next numbered identity and leaves the old record for lifecycle reconciliation.

A2 was separately measured with a fresh working record and a held stand-in process: `Using existing orchestrator session: sc-orchestrator`, rc 0, same runtime and record. With the stand-in already ended, activity exited instead routes through core, which reused the still-live tmux session. These are distinct paths, and both were exercised.

A3 was measured with a malformed-protocol **rejection**, distinct from M-3's invalid return value. The actual CLI printed the runtime reason, `Orchestrator liveness unknown`, the instruction to check the runtime and retry, and exited 1 with no creation. Starting with no worker, the same refused invocation started **858699** before probing and kept it afterward. This ordering is explicit and does not violate R2a: the unknown orchestrator may need its worker. A1/A2/A3 calls using an existing worker retained it.

A4 still excludes killed and activity-exited candidates; both new guards pass on base and tip. An excluded record may still be rechecked/reused by core in project mode if its runtime is live. A record without a stored handle remains unchecked/reusable, including a fabricated in-memory handle; this is preserved behavior, not proof of liveness.

Multiple candidates: live plus unknown selects the proven-live candidate even if the unknown record is newer. Gone plus unknown refuses; gone plus live reuses the live one. The new tests cover the first two, and the code makes the third explicit. Unknown candidates are not reported when a live one is selected. `getPluginRegistry(config)` is the same cached promise used by `getSessionManager(config)`, keyed by configPath.

I also ran 16 additional scratch core cases: reuse, ignore, delete and kill-previous, crossed with project/isolated and absent/alive-again at the core check. All passed after making the test destroy actually change the mocked liveness. In project mode, a runtime that appears between the CLI check and core's check is reused under reuse/ignore; delete attempts a confirmed stop before replacement. Unknown at the second check refuses. In isolated mode there is no second check of the old identity, so an old session revived in that window can coexist with the new numbered session. A session that dies after a successful CLI reuse probe can likewise leave a stale reuse result. These checks are observations, not an atomic cross-process guarantee.

Herdr was checked with a stand-in command, never a real Herdr binary/server. A no-server failure is wrapped by getPaneStrict; the top-level error has **no code**, with cause code 1. It is not RUNTIME_NO_SERVER_ERROR_CODE and remains unknown. The current Herdr stop always returns unknown without closing anything. Thus a Herdr caller with missing AO names is classified outside but presently refuses safely; it cannot exercise a successful in-pane kill.

**Shutdown assessment and incident run.**

The normal own-pane path works. Original scratch worker **805419**, caller **821135**, detached child **821149**:

```text
PID     PPID    SID     PGID    TPGID TTY
821149  821135  821149  821149  -1    ?
```

Its kill-command child also had SID/PGID 821149. The detached process had its own session and process group, no controlling terminal, and stdin ignored. Its environment included:

```text
HOME=/tmp/aosnr/home
TMUX=/tmp/tmux-44402/aosnr-live,805435,0
AO_CONFIG_PATH=/tmp/aosnr/repo/agent-orchestrator.yaml
AO_STATE_ROOT=/tmp/aosnr/home/.agent-orchestrator
```

The pane pipe log contained the stand-in's completion and the handoff to PID 821149, then ended with the pane. Afterward the detached log completed:

```text
✔ Orchestrator session stopped
Lifecycle worker stopped
✓ Orchestrator stopped
```

The active record disappeared into `sessions/archive/sc-orchestrator_2026-10-22T16-12-55-897Z`; its old createdAt was `2026-10-22T16:11:34.851Z`. No tmux server, worker pid file, worker process, or detached process remained. This proves survival of an actual terminal hangup, rather than inferring it only from spawn options.

A refused kill typed in that pane started child **826376**, printed the runtime refusal and next action, printed `The lifecycle worker was not stopped`, and returned **STOP_RC=1**. Runtime, record generation 9 / createdAt `16:13:35.579Z`, and worker 826209 remained. The caller waits for child completion and prints the child's output on failure; success can return 0 when the caller survives, while a true own-pane success naturally has no caller exit result. Null close codes/signals become failure, and a spawn error gets a next-action message. The hidden flag prevents recursion; it is an internal bypass, not an authenticated boundary.

A second window with both AO name variables removed correctly resolved its session using TMUX_PANE, detached child **843707**, and completed cleanup. A normal outside stop did not detach: worker **873979** stopped, runtime ended, archive appeared, rc 0. `resolveAoLaunch` preserves the lifecycle launch mapping exactly: JavaScript entry via process.execPath, TypeScript via npx tsx, otherwise ao. The lifecycle worker still uses its original cwd; detached stop uses the config directory. Child environment forwarding is implemented correctly on the tip, although insufficiently tested (m-2).

**Inherited limitations that prevent an unconditional R2a guarantee.**

I measured the explicitly requested different-server case on two private servers. The orchestrator lived on `aosnr-live`; `aosnr-other` contained only `unrelated`. From the real orchestrator pane, I removed the AO names and redirected TMUX, TMUX_PANE and the scratch shim to aosnr-other. The query found `unrelated`, so the stop ran in process; runtime-tmux also operated on that other server, where the target was absent. It returned **OTHER_RC=0**, archived the record and stopped worker **874036**, while the original aosnr-live orchestrator remained running. I then stopped the two verified scratch server PIDs **874050 / 874058**.

This is inherited: runtime handles persist no tmux socket identity, and the base stop also uses the caller-selected server. Detachment preserves, rather than resolves, that ambiguity. It should be tracked separately; no claim that every environment satisfies R2a is supportable. Also inherited: stop targets only `<prefix>-orchestrator`, so an isolated numbered orchestrator can survive while its worker is stopped. Missing/corrupt handles or missing runtime plugins can bypass core's destroy branch. The patch preserves the intended kill-before-worker order for valid records on the correctly selected runtime; it does not establish these broader invariants.

**The lost real ao stop error (time-boxed source audit).**

I read the required real record only with cat. It now says status=killed, killedReason=runtime, generation=66, agent=claude-code, role=orchestrator, prAutoDetect=off, worktree `/home/taisung/local/agent-orchestrator`, and handle `60756641ca25-ao-orchestrator` with runtimeName=tmux. It has no launchPid. Its createdAt is `2026-10-20T15:19:56.073Z`. These are current facts, not a snapshot of the failed command. The start.ts diff between a20883a0 and dc7815d2 is empty.

The normal private reproduction completed its kill rather than returning to the prompt, so it does **not** identify the real error. Config discovery/validation, project resolution, metadata reads or repair, a record disappearing/replacing between reads, a live-launch guard, or an unconfirmed runtime stop remain conditional candidates. Runtime and agent enrichment catch their own failures. Current valid handle spelling rules out invalid-target validation only if that spelling was unchanged at the incident; current absence of launchPid similarly is not historical proof.

One claimed candidate can be narrowed: the author's number 3 says a missing plugin dist can make getPluginRegistry throw. Ordinary built-in import failures are caught and skipped at `plugin-registry.ts:435-441`; registration failures are caught/logged, as are external import failures. A missing runtime plugin then skips destruction in killRecord and proceeds toward archive/worker stop, which does not by itself fit the observed untouched record and worker. Static CLI module-loading failures before registerStop remain possible in principle, but there is no evidence of one. I cannot responsibly name the lost error from the surviving record or these reproductions.

**Tests and gates.**

Every executable helper, ao, node, pnpm and test ran with env -i, fake HOME/TMPDIR, scratch PATH and only needed scratch variables. Gates used no agent binary on PATH, a gh stub accepting only --version and auth status, and a tmux shim selecting a private `aosnr-` server. HUSKY=0 prevented prepare from writing shared git hooks configuration.

| Check | Independent result |
|---|---|
| Offline frozen install, explicit local pnpm store | Passed; expected pre-build missing CLI-bin warning |
| pnpm build | Passed |
| pnpm typecheck | Passed |
| pnpm lint | Passed: 0 errors, 5 existing source warnings |
| pnpm -r --no-bail test, one full run | 3566 passed, 1 expected fail, 29 skipped; rc 0 |
| SAME_ID_DEFECTS=red | R1: 0 failed / 17 passed; R2: 16 / 20; R3: 6 failed; R4: 0 / 56 |
| New CLI files on base + tip tests | 17 failed, 47 passed |
| New core file on base | 2 passed |
| New CLI/core files on tip | 64 + 2 passed in full suite |
| Broken TMUX-forwarding mutation | 64 passed, exposing m-2 |
| Additional strategy matrix | 16 passed |
| Additional caller-evidence regression cases | 2 failed on tip, exposing M-1 |

The full result differs from the supplied dc7815d2 baseline (3541 pass, 1 expected fail, 29 skipped) by the 25 added tests. I did not independently rerun the entire base suite; I built the archived base and ran the new tests against it.

The five lint warnings are `cli/src/commands/spawn.ts:333`, `core/src/activity-log.ts:91`, `core/src/plugin-registry.ts:232` (non-null assertions), and `core/src/session-manager.ts:2372` and `:2379` (console). ESLint additionally prints the existing .eslintignore deprecation notice.

Base failures match their intended causes: A1 expected a spawn but got zero; A3 timeout/non-boolean/gone-plus-unknown resolved instead of exiting 1; live-plus-unknown picked/counts the unknown candidate; own-pane B tests observed in-process kill or no detached call; purge/fallback/refusal/spawn-error cases lacked the new route; hidden-child cases rejected the unknown option; four helper tests reported startDetachedStop is not a function. A2 simple live reuse, A4 guards, no stored handle, outside stop, missing record and all 41 old tests pass on base. The two new core tests also pass there because core was unchanged.

No old expectation was deleted or weakened. The ora methods still return their spinner and now log calls. getPluginRegistry and startDetachedStop mocks add new seams. Saving/clearing/restoring AO_SESSION, AO_SESSION_NAME, TMUX and TMUX_PANE removes dependence on the host test runner's environment; it does not remove an old explicit caller scenario. The gaps are absence of new edge-case oracles and reliance on mocked listing, not weakened old assertions.

**Documentation and correct portions.**

The DEVELOPMENT.md paragraph accurately describes the ordinary A1/A2 path, unchecked handles, worker ordering and detached launch. Its statement that a failed tmux caller lookup counts as inside needs qualification/correction for empty answers and hangs (M-1/M-2). Its malformed-answer assurance needs the end-to-end fix in M-3. It correctly limits the helper to nonterminal candidates and mentions isolated record retention.

Correct and worth retaining: the narrowly scoped no-server exception; reuse of the shared plugin registry and existing core replacement path; no attempted stop of a runtime known absent during startup; refusal and exit 1 on ordinary unknown liveness; kill/archive before worker stop; preserved config/state/runtime environment; actual detachment from terminal/session/process group; safe refusal with the worker retained; outside-stop behavior; and the test failures on the unfixed base.

**Cleanup evidence.**

Before: `ls -la --time-style=full-iso ~/.ao/bin`

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After: `ls -la --time-style=full-iso ~/.ao/bin`

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The listings are byte-identical. No real wrapper, agent configuration, startup file, global ao link or tmux configuration was changed.

Marker: `/tmp/aosnr-marker`, `2026-10-22 12:07:41.337252397 -0400`. Final command:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosnr-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
```

Both printed paths belong to external ao-63/fleet activity, not writes made by this review: the sessions directory and ao-63 record have the same mtime `2026-10-22 12:13:06.530579599 -0400`; ao-63 reads generation=6, status=working. Directory replacement/update of that record explains both timestamps. The filesystem does not identify the exact external writer PID, so I cannot distinguish the orchestrator from its lifecycle worker. No command in this review wrote either path, and no ao command was run against real state.

Final live-process audit enumerated /proc and selected the exact scratch HOME, excluding only the audit process itself:

```text
OWN PROCESSES []
```

All recorded worker/detached/query/server PIDs were also checked gone. Private servers aosnr-review, aosnr-live and aosnr-other answer no server. Workers stopped by scratch ao or verified exact PID: 805419, 826209, 851194, 858664, 858699, 873979, 874036 and 903934. Detached stops finished/reaped; hung caller/query 841258/841272 and final test servers 874050/874058 were terminated only after their environments showed HOME=/tmp/aosnr/home. The real workers 65891/68422 and all real panes were untouched.

Removed after those checks: `/tmp/aosnr` (base copy, dependencies, helper programs, test mutations, configs, homes, logs and pid files), `/tmp/aosnr-marker`, and the three named scratch socket files. No scratch state remains. Cleanup used non-forced removal after automatic review rejected the force-delete spelling; that rejected command executed nothing. The worktree retains only its ignored install/build products, the dispatched task/report files and this uncommitted review; tracked source is unchanged.
