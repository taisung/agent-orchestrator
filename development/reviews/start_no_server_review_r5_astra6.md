# Re-check r5: ao stop progress note

LAND-SAFE

0 new blocking, 0 major, 0 minor findings. Both r4 defects and the incorrect comment are closed. Gates PASS: 3604 passed, 1 expected failure, 29 skipped; red R1/R2/R3/R4 = 0/16/6/0; gitleaks found no leaks in the two commits.

Reviewed `3e366a01..13d3a129ad01f8456a5329059e7c3ee96fa03f55` on `review/progress-note-r5`. `git diff --stat e6695161 main -- . ':!development'` was empty. I read the implementation/test diff before the author report. Only `start.ts`, its command tests and the development documentation changed. No production source was edited during this review.

## R4 findings

| R4 item | State | Independent evidence on the built tip |
| --- | --- | --- |
| m-1: the note's own EPIPE loses stdout fallback | Closed | Close stderr after its initial line; the 33-second stop delivers one note to stdout, retains/reports EPIPE and exits 0 |
| m-2: held stdout delays a note on writable stderr | Closed | Hold stdout until 35 seconds; the note reaches stderr at 30.247 seconds; complete stdout bytes match the detached log; exit 0 |
| Incorrect complete-line comment | Closed | `start.ts:1282-1284` now says writes are ordered by chunk and the note can split a line; the new chunk-order test demonstrates that behavior |

## Turn-chain review and open questions

`inTurn` (`start.ts:1285-1289`) returns each task's original promise to its caller but stores a recovered promise for the next turn. A rejected task therefore does not poison later turns. A scratch-only export of `logRelay` allowed a direct check: a throwing `due` predicate rejected its caller, and a subsequent write succeeded. A separate synchronous `out.write` throw was caught by `send`, retained as `outputError`, and settled the turn; subsequent writes returned false without calling the failed stream again. Neither test hung. These probes changed only the disposable scratch copy.

Each copied chunk and note takes a turn on its own stream. The chunk is read and its offset advanced inside the turn, and its write callback finishes before the next chunk is read. A held-turn probe confirmed `first`, then `second`, with only the first write attempted before release. The native stdout reproduction copied 1,048,650 log bytes exactly after removing the caller's 36-byte heading. The native held-stderr run copied its 1,048,687 stderr log bytes exactly. The existing real-pipe relay tests also passed in the full suite.

The timer initiates `stillRunning` once at 30 seconds (`start.ts:1370-1373`), independently of the copy loop. `write(text, due)` checks the child-ended predicate inside its turn, immediately before starting the write (`1321-1324`). The stdout fallback receives the same predicate (`1460`). A healthy stderr completion or a skipped write returns true, so stdout is not tried; stdout is tried only after a stderr error. This gives one successful note delivery in the tested cases, without repetition or a write initiated after observed child completion. A note whose write already started can finish draining after the child ends; its bytes cannot be recalled.

`relayDetachedStop` clears its timer, awaits the note promise, then closes both logs (`1382-1386`). Pending note work cannot outlive a normal return. A focused test held the progress note's own write callback, ended the child, and verified that the caller stayed pending until release, then returned exit 0 with no timers. That test passed on both `3e366a01` and the unmodified tip. It establishes the existing output-backpressure behavior rather than a new wait deadline.

**Author open question 1: correct; does not block landing.** Slow stderr remains the selected stream until it actually errors. A note queued behind a held stderr chunk waits; if the child ends before that turn, the predicate skips it. In a native run stderr remained unread until 35 seconds, the child exited 0 first, and the caller still waited for output; after draining stderr it exited 0, copied every byte, and emitted no late note or stdout substitute. The corresponding guard test also passes on the old code. A reader that never reads can therefore hold the caller indefinitely, as before; the detached stop is not cancelled. Sending the note to whichever stream happens to become available first would change the documented stderr-first/error-only-fallback policy. It is outside this fix and not needed to close m-2, which concerned backpressure on the *other* stream.

**Author open question 2: correct; does not block landing.** A stderr error discovered by the note now belongs to the same relay error state as a chunk-write error. Subsequent detached stderr remains in its log, the failed stream is not retried, and the end diagnostic can appear even when no further stderr bytes arrive. This is the intended m-1 fix. A focused test with completely empty child logs got one stdout note plus the stderr-EPIPE diagnostic, preserved child exit 7 and left no timer. No detached log bytes are deleted.

Ctrl-C still uses the existing handler and two-second bound, independently of the turn queue. Native test: keep stderr unread with a 1 MiB relay in progress and a progress turn queued, send SIGINT at 31 seconds to owned caller 3320638 after verifying its HOME, and keep the pipe unread. The caller exited 130 after 2.019 seconds; detached child 3320778 continued and exited 0. Only 65,536 caller stderr bytes had been delivered when the caller ended; the detached log retained the full output. No manual signal was sent to a lifecycle worker or another session.

Exit results were unchanged:

| Path | Result and evidence |
| --- | --- |
| Child exit 0 | Native reproducers and focused command test: caller 0 |
| Child exit N | Focused test: child 7, caller 7 |
| Child signal/null | Focused test: caller 1 |
| Startup rejection | Focused test: caller 1, no timer left |
| Caller output error | Native EPIPE: caller 0; focused note-error case: caller 7, unchanged from child |
| Refused kill | Existing exact-text/status tests in the full suite still pass with exit 1 |
| Ctrl-C while a turn is held | Native caller 130 within the existing two-second bound; child continues |

The four focused completion-path tests each asserted zero remaining timers. The error-state probe did too. No new production findings arose from these checks.

## Tests and surviving partial fix

The five added tests use fake `setTimeout`/`clearTimeout`; write callbacks are immediate or explicitly held. They exercise scheduling and per-stream ordering, while the native runs check actual processes and pipe backpressure.

Scratch base was `git archive 3e366a01` plus the tip's test file; scratch probe was `git archive HEAD`. Local dependency symlinks were reused. Test selection:

```sh
pnpm --dir /tmp/aopn5/base/packages/cli exec vitest run __tests__/commands/start.test.ts -t 'review r4 m-1:|review r4 m-2:|review r4: a stop that ends|the note waits for a stderr chunk|a note that is due during a stderr chunk' --reporter=json
```

| New test | Base result | Tip result |
| --- | --- | --- |
| Note's own stderr error falls back to stdout | Fail: stdout lacks note | Pass |
| Held stdout does not delay writable stderr note | Fail: stderr lacks note at 30.1 s | Pass |
| Child ends before deadline while stdout is held | Pass | Pass |
| Child ends while note waits behind stderr chunk | Pass | Pass |
| Due note follows current chunk, before next chunk | Fail: base copies next chunk before note | Pass |

Base: **3 failed, 2 passed, 71 skipped**, exactly the author's reported outcomes for these five. The two passing baseline cases guard behavior that already existed. All five passed as part of the tip's full suite; existing assertions were not changed.

A surviving partial fix was run in the scratch probe only:

```diff
-if (!(await stderrRelay.write(note, running))) await stdoutRelay.write(note, running);
+if (!(await stderrRelay.write(note, running))) await stdoutRelay.write(note, () => true);
```

All **5 new tests still passed**. This mutant loses the child-ended check specifically when the stdout fallback waits behind a blocked stdout chunk. An additional test held stdout, made the note discover stderr EPIPE at 30 seconds, ended the child, then released stdout. It passed on the unmodified tip and failed on the mutant with `expected 'HELDao stop: the stop still runs ...' not to contain 'the stop still runs'`. The production fallback has the correct guard. Adding this combined-error/held-fallback case would strengthen coverage; it is not an open production defect.

Additional scratch checks on the unmodified implementation: 6 command probes passed (fallback guard, four completion results, retained note error), 3 direct relay probes passed (rejected-turn recovery, synchronous write throw, held-turn order), and 1 held-note completion probe passed. Deliberate baseline and mutant failures above are diagnostic evidence, not failures of the landing gates.

## Native r4 reproducers

Every native CLI invocation used `node /home/taisung/.worktrees/agent-orchestrator/ao-64/packages/cli/dist/index.js`. A scratch preload delayed only the real `--detached-stop-process` invocation by 33 seconds; argv[1] stayed the existing built JS entry. The preload wrote a PID/exit record and, for the backpressure cases, 1 MiB to the appropriate detached log. A scratch Claude stand-in printed `STAND-IN-ENDED` and exited. All tmux access used private `aopn5-*` servers under the fake HOME.

| Case | Caller / child | Observation |
| --- | --- | --- |
| Close stderr after first line | 3320609 / 3320758, both 0 | One note on stdout; caller ended at 33.769 s; EPIPE diagnostic retained |
| Hold stdout until 35 s | 3320654 / 3320779, both 0 | Note on stderr at 30.247 s; caller ended at 35.018 s; stdout log byte comparison matched |
| Hold stderr until 35 s | 3320612 / 3320759, both 0 | No late note; caller waited for its reader; stderr log byte comparison matched |
| Ctrl-C while stderr turn is held | 3320638 / 3320778, 130 / 0 | Caller ended 2.019 s after SIGINT; child completed independently |

Compared with my r4 measurements on `3e366a01`, the two requested reproducers now emit one note on the open stream instead of zero. Stop results and complete-output behavior remain intact.

Exact notes:

```text
stdout ao stop: the stop still runs in the detached process (PID 3320758) after 30 s; Ctrl-C leaves it running; its output: /tmp/aopn5/home/.agent-orchestrator/cbc0e5af4066-broken/orchestrator-stop-2026-10-22T20-45-27-044Z-3320609-b4c50a0d.stdout.log and /tmp/aopn5/home/.agent-orchestrator/cbc0e5af4066-broken/orchestrator-stop-2026-10-22T20-45-27-044Z-3320609-b4c50a0d.stderr.log
stderr ao stop: the stop still runs in the detached process (PID 3320779) after 30 s; Ctrl-C leaves it running; its output: /tmp/aopn5/home/.agent-orchestrator/32fc2d51e7db-backpressure/orchestrator-stop-2026-10-22T20-45-27-075Z-3320654-aad7d952.stdout.log and /tmp/aopn5/home/.agent-orchestrator/32fc2d51e7db-backpressure/orchestrator-stop-2026-10-22T20-45-27-075Z-3320654-aad7d952.stderr.log
```

All four scratch lifecycle workers stopped through the actual stop path: 3320530, 3320567, 3320538 and 3320539. Each detached child recorded exit 0. Every native case ended with its active orchestrator record absent and no private server.

## Documentation

`docs/DEVELOPMENT.md:597` matches the change: the note's own stderr error permits stdout fallback; the note does not wait for the other stream; it waits behind a chunk on its selected stream and is skipped if the child has ended before the turn. No line buffering or wait deadline was introduced. The corrected source comment accurately allows a note between fragments of a logical line.

## Gates

All package commands used:

```sh
env -i HOME=/tmp/aopn5/home TMPDIR=/tmp/aopn5/tmp PATH=/tmp/aopn5/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true
```

The curated gate PATH contained cached pnpm 9.15.4, Node 25.7.0, local utilities, a restricted gh stub, and a tmux shim selecting `aopn5-tests`; no agent executable or npx. No network operation was run. HUSKY=0 avoided shared hook configuration changes.

```text
pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3
Lockfile is up to date, resolution step is skipped
Already up to date
HUSKY=0 skip install
Done in 1.1s
exit 0

pnpm build
packages/cli build: Done
exit 0; all intermediate package builds completed

pnpm typecheck
packages/cli typecheck: Done
packages/integration-tests typecheck: Done
exit 0; all intermediate package checks completed

pnpm lint
✖ 5 problems (0 errors, 5 warnings)
exit 0
```

The five unchanged source warnings are `packages/cli/src/commands/spawn.ts:333:24`, `packages/core/src/activity-log.ts:91:31`, `packages/core/src/plugin-registry.ts:232:7` (`@typescript-eslint/no-non-null-assertion`), and `packages/core/src/session-manager.ts:2383:11` / `2390:9` (`no-console`). ESLint's existing `.eslintignore` migration notice and pnpm's Node url.parse deprecation notice also appeared.

One full `pnpm -r --no-bail test`, exit 0:

```text
packages/core test:       Tests  1624 passed | 1 expected fail (1625)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-codex test:       Tests  307 passed (307)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  318 passed (318)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  378 passed (378)
TOTAL: 3604 passed, 1 expected fail, 29 skipped (3634)
```

Relative to r4: CLI increases from 373 to 378 passes, exactly the five added tests. Every other package count is unchanged. The expected failure is still core same-ID R3 F-5, `kill and restore of one ID: the active record at the end names a live runtime`, marked `it.fails`. Skips remain 5 scm-github and 24 integration tests. No unexplained failure.

```sh
SAME_ID_DEFECTS=red pnpm -r --no-bail --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode exec vitest run same-id --reporter=json
```

| Round | Passed | Failed | Expected failures |
| --- | ---: | ---: | ---: |
| R1 | 17 | 0 | 0 |
| R2 | 20 | 16 | 16 |
| R3 | 0 | 6 | 6 |
| R4 | 56 | 0 | 0 |

Red command exit 1 is expected from the 22 known defect assertions; counts are unchanged.

Installed gitleaks was run through the curated PATH:

```text
gitleaks git --log-opts=3e366a01..13d3a129 --redact
2 commits scanned.
scan completed in 20.5ms
no leaks found
exit 0
```

## Cleanup evidence

Before and after `ls -la --time-style=full-iso /home/taisung/.ao/bin` were byte-identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state check:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aopn5-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Exact output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
```

Attribution: both paths belong to the unrelated real session ao-65 and its containing sessions directory. Both have mtime `2026-10-22 16:47:16.890875227 -0400`; ao-65 now reads `generation=5`, `status=stuck`. This is external real-session bookkeeping, consistent with a metadata replacement by the real lifecycle/orchestration process. File metadata does not identify the exact writing PID, so I cannot distinguish a real lifecycle worker from another controller. None of this run's CLI/helper/test processes used the real HOME, real AO state root or ao-65 config; native state stayed under `/tmp/aopn5/home`. I only read these two paths with stat and selected record fields with grep after the required find. No ao command targeted real state.

Final private-server queries were each `env -u TMUX /usr/bin/tmux -L aopn5-<name> list-sessions` under the scrubbed environment:

```text
aopn5-tests: rc=1: no server running on /tmp/tmux-44402/aopn5-tests
aopn5-broken: rc=1: no server running on /tmp/tmux-44402/aopn5-broken
aopn5-backpressure: rc=1: no server running on /tmp/tmux-44402/aopn5-backpressure
aopn5-held-stderr: rc=1: no server running on /tmp/tmux-44402/aopn5-held-stderr
aopn5-interrupt: rc=1: no server running on /tmp/tmux-44402/aopn5-interrupt
```

The final `/proc/*/environ` scan for live processes with HOME under `/tmp/aopn5/`, excluding the scanner and zombies, returned `[]`. Real workers 2087525/2087614 and the owner's and other agents' sessions were not signalled or accessed through tmux. No production code changes, commit, push, PR or ao send. `git diff --exit-code` was empty with exit 0; HEAD remained `13d3a129ad01f8456a5329059e7c3ee96fa03f55`.

Removed `/tmp/aopn5` with non-forced `rm -r`, then removed `/tmp/aopn5-marker` and the five own stale socket files with `rm`. All seven paths were verified absent. The post-deletion own-process scan was again `[]`.
