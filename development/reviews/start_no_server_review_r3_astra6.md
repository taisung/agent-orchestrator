# Review r3: detached-stop output and log pruning

LAND-SAFE

**New findings: 0 blocking, 0 major, 0 minor. Both r2 findings are closed.** The change preserves complete output through slow pipes, handles failed readers without replacing the child's exit status, and restricts pruning to owned regular files. I found a remaining test-coverage gap, described below; the corresponding production path passed an independent live check.

Reviewed `04e720bb..e6695161` on `review/start-no-server-r3`, 2026-10-22, reviewer ao-64. Scope is the two r2 findings and the r3 changes. I read the diff before the author's r3 report/brief, built base and tip independently, and changed no production files. No commit, git mutation, push, PR, network call, real agent, Herdr server or `ao send` was used. All command/helper/test execution used scrubbed environments and scratch state. Manual ao probes used the existing built JS entries only; no argv was redirected to TypeScript or a missing file.

## R2 findings

| R2 finding | State | Evidence |
|---|---|---|
| M-1: failed relay truncates output on slow pipes | Closed | Actual base CLI again delivered only 69, 668/69, 632 bytes for a failed child. Actual tip delivered every byte from both logs for exit 7, exit 0 and child SIGTERM. Chunk callbacks are awaited; the parent sets exitCode and returns. Closed-reader and Ctrl-C probes also passed. |
| m-1: pruning is broader than generated regular files | Closed | Valid old regular file removed; recent file, notes, matching symlink, matching dangling symlink, legacy r1 log, lifecycle log and matching directory retained. External symlink target retained byte-for-byte. |

## Relay review and independent measurements

Relevant locations: `packages/cli/src/commands/start.ts:1250` (writeOut), `:1268` (logRelay), `:1321` (copy loop), `:1381` (interrupt), `:1395` and `:1450` (output-error listener lifetime), `:1436` (diagnostic destination), `:1488` (exit status).

Each 64 KiB chunk is copied into a fresh Buffer and awaited through its write callback before another chunk is read. Waiting for that callback supplies backpressure even though the boolean return from write is not separately inspected. The loop serializes copy calls, preventing overlap. It makes a complete pass that begins after child completion, covering bytes appended during the previous pass. Rejected child completion has a handler immediately, and is rethrown only after the copying loop finishes. Nonzero results set process.exitCode instead of forcing exit; output-error notes and signal/spawn-failure diagnostics are also awaited.

The error callback marks only the affected relay failed. Stream error listeners prevent an unhandled EPIPE from terminating the parent; listeners remain until one setImmediate after completion, allowing the error event that follows a callback to be consumed. The remaining stream continues, and the child status is retained. Both outputs unavailable means no diagnostic can be delivered; files retain the output and the child's result still wins. These are the intended semantics, including exit 0 after successful stop with both downstream readers closed.

**Reproducer design.** To comply with the JS-entry constraint, I invoked the actual built `packages/cli/dist/index.js` throughout. A scratch local runtime plugin, loaded through the real registry, returned true for liveness and wrote the payload only when its `stop()` was called in the detached child. It wrote `BEGIN` + 4 MiB of x + `END\n` on stdout, and `ERROR-BEGIN` + 4 MiB of y + `ERROR-END\n` on stderr, using writeSync. Mode7 called process.exit(7); signal mode sent itself SIGTERM; mode0 returned a confirmed destroyed outcome, allowing the normal archive/completion path. No actual runtime or lifecycle worker was created for these synthetic records. Python consumed each parent pipe independently in 4096-byte reads with 2 ms pauses. I compared the received bytes directly against the actual child log files.

| CLI / child outcome | Parent exit | stdout received | stderr received | Validation |
|---|---:|---:|---:|---|
| Base 04e720bb /7 |7|69, 668|69, 632|Neither end marker; truncation reproduced|
| Tip e6695161 /7 |7|4, 194, 349|4, 194, 357|Exact heading + stdout log; exact stderr log; both markers|
| Tip /0 |0|4, 194, 426|4, 194, 390|Exact complete logs, including ordinary stop-completion text|
| Tip /SIGTERM |1|4, 194, 349|4, 194, 669|Complete logs, then signal diagnostic with both log paths|

The caller heading is 36 bytes. For the failed/signal synthetic child, stdout log size was 4, 194, 313; stderr log size was 4, 194, 357, including the real child's 32-byte spinner-start line. Mode0 includes additional normal success text. Signal mode's extra312 bytes on parent stderr were precisely the signal/log-path diagnostic. These slight size differences from the r2 standalone writer are explained by exercising the full CLI child.

**Closed readers.** Readers closed a pipe after 4096 bytes, while the other reader continued consuming. Every log file remained complete:

| Closed reader(s) | Child outcome | Parent result | Surviving output |
|---|---|---|---|
| stdout |7|7|All stderr plus stdout/EPIPE/log-path note; 4, 194, 572 bytes|
| stderr |7|7|All stdout plus stderr/EPIPE/log-path note; 4, 194, 564 bytes|
| both |7|7|Neither can receive a diagnostic; logs retained|
| both |0|0|Successful stop status retained; logs retained|
| stderr |SIGTERM|1|All stdout, stderr/EPIPE note, then child-signal/log-path note; 4, 194, 876 bytes|

Representative note:

```text
ao stop: could not write the stderr of the detached stop (write EPIPE); all of it is in /tmp/aosnr3/home/.agent-orchestrator/948426196e1e-relay/orchestrator-stop-2026-10-22T18-16-15-991Z-1891627-9c414c5b.stderr.log
```

No output-error case claimed that the detached stop failed to start. Spawn rejection remains covered by the unit test, now asserting exitCode 1 and awaited stderr text; I did not provoke it with a missing executable or a TypeScript entry.

**Ctrl-C during a large relay.** The synthetic stop held its child alive for 3 s after writing, then recorded a completion marker. I signalled only exact parent PIDs obtained from my subprocess objects, after checking their HOME:

| Reader / signal | Parent / child | Result measured from first signal | Child outcome |
|---|---|---|---|
| Slow reader, one SIGINT |1894479 /1894493|Exit 130 in 0.065 s; complete interrupt note delivered|Still alive after parent exit; finished independently|
| Reader stopped consuming, one SIGINT |1896954 /1896966|Exit 130 in 2.021 s; queued note not delivered|Still alive after parent exit; finished independently|
| Reader stopped consuming, second SIGINT after 0.1 s |1896993 /1897012|Terminated by signal2 in 0.117 s; shell convention130|Still alive after parent exit; finished independently|

All three detached logs were complete at 4, 194, 313/4, 194, 357 bytes, and all three child completion markers were verified. This tests continuation directly rather than inferring it from spawn options. On interruption, unread relay output may be dropped, as documented. A stalled reader cannot hold the first interrupt exit beyond the2 s timer; a second interrupt uses default signal handling.

**Ordering and limits.** Each pass drains stderr to its current end before starting stdout. The copied log bytes retain their own stream order; stdout/stderr are not globally timestamp-ordered. A slow or stalled stderr consumer holds back stdout, and normal completion has no deadline. That tradeoff is explicit in the author's report and consistent with the requested stderr-first behavior. The new bound concerns the Ctrl-C note, not the whole stop. Existing file-read retry behavior, terminal colors/spinner appearance and inherited routing/numbered-session limits were not changed or reopened in this focused review.

## Pruning

Relevant locations: `packages/cli/src/lib/lifecycle-service.ts:23`, `:251-264`.

The regex now matches the timestamp/PID/eight-hex/stream basename shape. lstat plus isFile prevents following/removing symlinks and excludes directories. Enumeration stays within the selected project's base. I seeded8-day-old and 1-day-old files and invoked a real built CLI stop so the production prune ran:

| Scratch fixture | Result |
|---|---|
| `orchestrator-stop-2026-01-01T00-00-00-000Z-1-aabbccdd.stdout.log`, old regular file | Removed |
| Valid generated name, recent regular file | Kept |
| Old `orchestrator-stop-notes.log` | Kept |
| Valid generated name, symlink to old file in another scratch project | Link and target kept |
| Valid generated name, dangling symlink | Kept |
| Old `orchestrator-stop.log` | Kept |
| Old `lifecycle-worker.log` | Kept |
| Valid generated name, old directory | Kept |

The external target still contained exactly `KEEP OTHER`. The cutoff remains mtime older than seven days, and pruning stays best effort. No broadened deletion path was found.

## Native regression checks

Native probes used a stand-in claude, a clean bash shell, and private tmux server `aosnr3-live` through a PATH shim. Config/project directory: `/tmp/aosnr3/repo`; native state base: `3e035275e510-repo`.

**Incident.** After startup and stand-in exit, I typed `ao stop scratch` in the orchestrator pane. The pipe-pane log ends at the heading because the pane is killed. Detached files contained:

```text
stderr: - Stopping orchestrator session
stderr: ✔ Orchestrator session stopped
stdout: Lifecycle worker stopped
stdout: ✓ Orchestrator stopped
stdout:   Projects: scratch
```

Before: generation 3, status working, createdAt `2026-10-22T18:16:13.051Z`, runtime `3e035275e510-sc-orchestrator`, worker 1888330. After: no private server, no active native record, no worker/pid file; archive `sc-orchestrator_2026-10-22T18-16-14-836Z`. The whole stop completed.

**Outside through pipes.** Own builds of 04e720bb and e6695161 each stopped a fresh native instance. Exit 0, stdout and stderr were byte-for-byte identical. Both archived the record and removed runtime/worker. Output was the same heading, spinner start/success, lifecycle stopped, orchestrator stopped and project line.

**Refused kill.** A shim refused kill-session while native liveness still returned true. Base and tip both returned1 with identical stdout/stderr, including:

```text
✖ Orchestrator session not stopped
Failed to stop orchestrator session sc-orchestrator: runtime stop unconfirmed (unknown): the destroy of tmux session 3e035275e510-sc-orchestrator failed (... tmux: scratch refused), but the session still runs; record and worktree kept
Next: Check tmux session 3e035275e510-sc-orchestrator by hand and stop it if it still runs, then run `ao stop scratch` again. AO goes on only when the runtime answers that the session stopped or does not exist.
The lifecycle worker was not stopped.
```

Generation 12, status working, createdAt `18:16:18.822Z`, the same runtime handle, and worker 1894272 remained. After removing the refusal, the tip stopped everything, returning0 and archiving at `18-16-21-156Z`. Kill/archive-before-worker ordering is unchanged.

## Tests, mutations and gates

| Check | Independent result |
|---|---|
| Offline frozen install from local store, HUSKY=0 | Pass |
| pnpm build | Pass |
| pnpm typecheck | Pass |
| pnpm lint |0 errors, 5 known source warnings|
| pnpm -r --no-bail test |**3596 passed, 1 expected fail, 29 skipped**|
| SAME_ID_DEFECTS=red |R1:0 failed/17 passed; R2:16 failed/20 passed; R3:6 failed; R4:0 failed/56 passed|
| Three r3 test files over base 04e720bb production |13 failed/69 passed|
| Three r3 files on tip |82 passed within the full run|
| Old one-chunk-per-copy mutation on scratch tip |All 4 real-pipe relay tests fail|
| Drop stderr-error fallback to stdout on scratch tip |**All 82 targeted tests pass**|

The ten additional passing tests versus r2 are confined to CLI: three start-command cases (output error and two Ctrl-C cases), four new relay cases, and three net additional prune cases. CLI grows 360→370; all other package totals remain unchanged. The five warnings are non-null assertions in `packages/cli/src/commands/spawn.ts:333`, `packages/core/src/activity-log.ts:91`, `packages/core/src/plugin-registry.ts:232`, and console statements in `packages/core/src/session-manager.ts:2383, 2390`. ESLint also prints its existing .eslintignore migration notice.

The base was extracted with `git archive 04e720bb`, installed offline and built. I then copied only the three tip test files for the base test run. Its13 failures have the intended causes: four real-pipe tests detect truncation or excessive queue size; seven command tests detect old process.exit semantics, missing output-error reporting or premature Ctrl-C exit; two prune tests detect removal of the notes file and symlink. The valid-old/recent and legacy-file guards correctly pass on base. In the old EPIPE case, forced exit destroys the pipes before the unhandled-error event is reached; that failure establishes missing completion/reporting, not isolated proof of the new listener's necessity.

Every changed oracle is justified:

- Stream mocks now invoke callbacks because writes are awaited. Resetting exitCode isolates tests.
- Nonzero child, signal and spawn-failure tests now expect normal command return plus the same exit status in exitCode and no forced exit. Exact refusal text remains checked. Signal/spawn diagnostics move from a console.error spy to exact stderr writes, protecting their completion.
- Existing Ctrl-C behavior still holds for an immediately completed write. New held-callback and 2 s cases protect delayed and stalled consumers.
- The old prune test is split into narrower cases, preserving old/recent and lifecycle-log guards while adding notes/symlink/legacy coverage.
- The new real-reader tests check total bytes, tails, status and maximum queued stream bytes, addressing the r2 mock-only limitation. Their parent remains a Vitest worker with overridden stream getters and mocked exit; my separate actual-CLI runs supply the process-lifecycle check.

**Required partial fix accepted by tests.** In the scratch copy only, I replaced the diagnostic target expression at `start.ts:1436-1441` with `stderrRelay.outputError === null ? process.stderr : null`, eliminating the fallback to a working stdout after stderr fails. All 82 tests pass, so this branch is not protected against that regression. The shipped implementation passed my actual closed-stderr test, delivering its note on stdout and retaining exit 7; it also passed child-signal plus closed-stderr. Adding the mirror case to the retained suite would improve coverage. This is a coverage recommendation, not a demonstrated production defect or an additional landing condition.

I also repeated r2's one-chunk mutation, adding return immediately after the awaited chunk write. All four new real-pipe tests now fail on incomplete counts/tails, so the original accepted partial implementation is no longer accepted.

## Docs and correct behavior to retain

`docs/DEVELOPMENT.md:597` matches the code: exclusive separate logs, owned regular-file pruning, 64 KiB callback-based backpressure, complete final copying, retained child status, output-error diagnostics, interrupt-note completion or2 s bound, second interrupt, and an unbounded overall wait whose cancellation does not stop the child. The apparent promise to report an output error on the other stream naturally requires that stream to work; both-closed behavior is accurately constrained by the implementation and the measurements above.

Correct behavior to retain: full failed/success/signal output, bounded queued relay data, output failures separated from spawn failures, accurate child exit results, interruption without cancelling the detached child, conservative file ownership for pruning, and the existing native shutdown/refusal order. No further production change is requested for this round.

## Execution and hygiene

All pnpm/node/ao/helper/test commands ran under `env -i` with fake HOME `/tmp/aosnr3/home`, TMPDIR `/tmp/aosnr3/tmp`, CI=1 and curated scratch PATHs. The gate PATH had no real agent and no npx; native-only PATHs added the stand-in and private-server shim. The initial global pnpm launcher refused an offline attempt to resolve its pinned version because the scratch cache was empty. I then pointed the wrapper directly to the already installed pnpm 9.15.4. Successful installs used `--frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3`, HUSKY=0 and NPM_CONFIG_OFFLINE=true. No package download occurred.

Manual child launches always used the actual built JS entry. The repository's new tests use their existing local child.mjs fixture through Node; none uses the TypeScript/npx fallback. No default-server tmux command, other person's pane read, real-state ao command, real agent, Herdr server, service.json/auth.json read or network request was made. Real workers 65891/68422 and sessions 0/ao-63 were not controlled. Exact scratch PID signals were HOME-checked. Production source remained unchanged (`git diff --exit-code` passed).

Before cleanup, a /proc environment scan for the exact scratch HOME, excluding its scanner and zombies, returned:

```text
[]
```

Private-server checks were `env -u TMUX /usr/bin/tmux -L aosnr3-live list-sessions` and the same with `-L aosnr3-tests`, under the scrubbed environment. Both returned1:

```text
no server running on /tmp/tmux-44402/aosnr3-live
no server running on /tmp/tmux-44402/aosnr3-tests
```

`ls -la --time-style=full-iso /home/taisung/.ao/bin` before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command after testing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The listings are identical. The final required real-state marker check:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aosnr3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output was empty: no paths require external-writer attribution in this round. The excluded real lifecycle files may change normally.

Cleanup completed: removed `/tmp/aosnr3` (base copy/dependencies, fault-injection programs, logs, homes and configs), `/tmp/aosnr3-marker`, and both stale private socket files with non-forced removal. All four paths were verified absent. A second own-process scan after removal again returned `[]`. No scratch state remains; the worktree retains the requested report/review, dispatched task files, earlier reviews and ignored local build/install outputs.
