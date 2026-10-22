# Review r4: ao stop progress note

LAND-WITH-CHANGES

0 blocking, 0 major, 2 minor findings. Landing gates PASS: 3599 passed, 1 expected failure, 29 skipped. The stop and its exit status remain correct in the measured cases; two output conditions suppress the new progress note.

Reviewed `e6695161..3e366a01e5ee760ec55347365eb7244b88c06b13`, branch `review/progress-note-r4`. `git diff --stat e6695161 main -- . ':!development'` was empty. The only changed production file is `packages/cli/src/commands/start.ts`; the other changes are its command tests and `docs/DEVELOPMENT.md`. I read that diff before the author's addendum. No production source was edited.

## Findings

### m-1: the first EPIPE from the note itself loses the stdout fallback

Location: `packages/cli/src/commands/start.ts:1424-1436`, with the one-shot flag consumed at 1350-1352.

`stillRunning` selects stderr from the relay's cached `outputError`. If the pipe closed since the last relayed write, the progress-note write is the first operation to discover EPIPE. Its catch discards the error and does not retry on stdout. The only progress attempt is already consumed. The later relay may report the output error, but it cannot recover the note. This contradicts the documented stdout fallback when stderr has an output error.

Measured on the built tip: a detached stop delayed 33 seconds; its first stderr line reached the reader, which then closed stderr. Stdout remained open and was drained normally. Caller 2815945 and detached child 2816027 both exited 0, at 33.810 seconds. Healthy stdout received the final success text and the later `ao stop: could not write the stderr of the detached stop (write EPIPE); all of it is in ...stderr.log` diagnostic, but **zero progress notes**.

Reproducer: run the built CLI under the scratch environment below with a detached-only 33-second preload delay; pipe both caller streams; read the initial delay line from stderr, close only that read pipe, and continue collecting stdout. A focused fake-timer probe also reproduces this by leaving the child logs empty and making the first stderr write callback return EPIPE, then advancing 30,100 ms: stdout is `""`, not the note. It fails on the unmodified tip.

Requested change: when the note's stderr write fails, try the same note on available stdout and retain the error state. Add a regression where the note itself discovers the broken pipe, in addition to the existing test where a previous relay write discovered it. This is a notification defect; no stop cancellation or wrong exit code was observed.

### m-2: stdout backpressure can suppress the note on healthy stderr

Location: `packages/cli/src/commands/start.ts:1340-1352`.

The timer only sets `progressDue`. The code awaits complete stderr and stdout copies before checking it. A blocked stdout copy therefore prevents the progress note from reaching available stderr. If the detached process finishes before stdout drains, `!ended` correctly prevents a late note, leaving no note at all for a stop that ran longer than 30 seconds.

Measured on the built tip: detached child 2841572 wrote 1 MiB to its stdout log, waited 33 seconds, then performed the real stop and exited 0. The caller's stdout reader waited until 35 seconds; stderr stayed open, with only small output. Before stdout was drained, the child exit record already said `exit 2841572 0`. The caller then exited 0 at 35.021 seconds, delivered 1,048,684 stdout characters, and delivered only the initial delay line and final stop lines on stderr: **zero progress notes**. The stdout log was copied intact.

Reproducer: use the same detached-only delay, write `"x".repeat(1024 * 1024) + "\n"` to the detached stdout log before waiting, spawn the caller with separate stdout/stderr pipes, hold stdout unread until 35 seconds, then collect both streams. The small stderr pipe remains writable throughout.

Requested change: allow the due note to reach a writable stderr without waiting for unrelated stdout backpressure, while retaining the child-ended guard, one-shot behavior, and existing relay ordering within each stream. Cover a held stdout write callback across the 30-second boundary. This is another notification defect, not loss of child output or stop failure.

## Review and test evidence

The timer is a single `setTimeout(..., 30_000)`; clearing `progressDue` before the callback makes it one-shot. The `ended` check prevents a note once child completion has been observed. The timer is cleared in `relayDetachedStop`'s `finally` on resolved exits and rejected startup. Four additional fake-timer checks on the unmodified tip confirmed zero timers after child exit 0, exit 7, signal/null, and startup rejection. Output errors are caught by a relay, so the caller intentionally keeps waiting; when that wait ends, the same `finally` clears the timer. Ctrl-C exits the caller rather than unwinding this finally; process exit disposes of its timers. A real Ctrl-C run confirmed exit 130 without waiting for 30 seconds more, while the detached child continued and exited 0.

The PID and log paths come directly from `startDetachedStop`. In the real runs they matched the detached child's recorded PID and the two existing generated log files. Normal output goes to stderr; the existing fallback works when a prior relayed write has already set stderr's error state. The new three tests all passed in the full tip suite.

The comment at line 1349, “so the note does not split a relayed line,” is too strong. The relay copies bytes up to the current EOF, not complete lines. A scratch test wrote `PARTIAL` to stderr, advanced past 30 seconds, then appended the rest: the output was `PARTIAL` immediately followed by the progress note, then the remaining fragment. No chunk writes overlap, but the note can split a logical line. Across stdout and stderr there is no total ordering. This does not affect exit codes or log contents.

Outside-stop stdout, stderr and exit codes 0/1 have unchanged exact-output assertions. Both assertions pass against `e6695161` and in the tip's full suite. The live refused-kill case retained its refusal detail, next action, `The lifecycle worker was not stopped.`, exit 1, active record and worker. The intentional extra note is the only expected text difference for a stop exceeding 30 seconds.

`docs/DEVELOPMENT.md:597` matches the normal no-deadline, one-note behavior and the known-error fallback. Its unconditional wording does not describe the two notification gaps above. The new prose makes no complete-line guarantee.

### Base tests and a surviving partial fix

Scratch trees were made with `git archive e6695161` and `git archive HEAD`, with local dependency symlinks. Only the scratch base received the tip's `start.test.ts`; only the scratch probe tree was mutated. Commands used the scrubbed environment described under Gates:

```sh
pnpm --dir /tmp/aopn4/base/packages/cli exec vitest run __tests__/commands/start.test.ts -t 'a stop that still runs after 30 s|a stop that ends before 30 s|the progress note goes to stdout' --reporter=json
pnpm --dir /tmp/aopn4/probe/packages/cli exec vitest run __tests__/commands/start.test.ts -t 'a stop that still runs after 30 s|a stop that ends before 30 s|the progress note goes to stdout' --reporter=json
pnpm --dir /tmp/aopn4/base/packages/cli exec vitest run __tests__/commands/start.test.ts -t 'from outside:' --reporter=json
```

| Experiment | Passed | Failed | Meaning |
| --- | ---: | ---: | --- |
| Base + three new tests | 1 | 2 | Both note assertions fail because base has no note; fast-stop test passes because base has no progress timer |
| Tip's three tests, in full suite | 3 | 0 | All three new cases pass |
| Tip with only `&& !ended` removed | 3 | 0 | New tests accept a note after the child has ended during a slow copy |
| Additional held-copy test on tip | 1 | 0 | Finish the child while stdout callback is held past 30 s, release output, expect no note |
| Same held-copy test on mutant | 0 | 1 | Actual late note, `expected 'ao stop: the stop still runs ...' to be ''` |
| Base's outside-output assertions | 2 | 0 | Success and refusal output/status agree with tip |

Thus it is not true that all three added tests fail on base. The second is a regression guard for the new timer, not a failing baseline reproduction. This agrees with the author's disclosed result.

The three tests fake only `setTimeout` and `clearTimeout`; mocked writes invoke callbacks immediately. They verify exact text/PID/paths, absence before 29.9 seconds, presence by 30.1 seconds, no repeat through 90.1 seconds, and no timer after fast completion. They do not exercise real pipes, event-loop timing, child exit while a write callback is held, or a first error caused by the note. The extra probes and native cases above address those gaps. The deliberately failing m-1 probe and mutant/base checks are diagnostic results, separate from the passing landing gates.

## Native scratch runs

Every actual CLI invocation used `node /home/taisung/.worktrees/agent-orchestrator/ao-64/packages/cli/dist/index.js`. The only agent executable was a scratch Claude stand-in printing `STAND-IN-ENDED` and exiting. A `NODE_OPTIONS=--import=/tmp/aopn4/delay.mjs` helper delayed only invocations whose actual argv included `--detached-stop-process`; it did not replace argv[1] or the built entry. After 33 seconds the actual built stop ran. Its `exit` hook recorded the detached exit status. tmux shims selected only `aopn4-<case>` private servers; the refused case deliberately rejected `kill-session`. No tmux timeout was increased.

| Case | Observation | Caller / child result |
| --- | --- | --- |
| Stop typed in its own pane; confirmed kill | One note observed at 30.420 s while server still existed; then archive, worker stop, no server | Caller hung up with its pane, so no normal shell exit status; detached child 2834356 exited 0 |
| Stop typed in its own pane; refused kill | One note; record and worker 2815893 retained | Caller and child 1, 33.626 s; subsequent fast cleanup stop 0 |
| Outside, separate stdout/stderr pipes | One note; archive and worker stop | Caller and child 0, 33.787 s |
| Fast outside stop | No note; no 30-second hold | Caller and child 0, 0.859 s |
| Ctrl-C after progress note | One progress note, then one interrupt note naming the same child and logs | Caller 130 at 31.011 s; child 2822943 continued to exit 0 and stop its worker |
| Stderr closed after initial line | No progress note on healthy stdout; later EPIPE diagnostic | Caller and child 0; m-1 |
| Stdout held until 35 seconds | No progress note on healthy stderr; complete stdout delivery | Caller and child 0; m-2 |

Exact note from the confirmed in-pane stop:

```text
ao stop: the stop still runs in the detached process (PID 2834356) after 30 s; Ctrl-C leaves it running; its output: /tmp/aopn4/home/.agent-orchestrator/5f3a51a523b2-pane-success/orchestrator-stop-2026-10-22T20-05-52-166Z-2834096-d585feef.stdout.log and /tmp/aopn4/home/.agent-orchestrator/5f3a51a523b2-pane-success/orchestrator-stop-2026-10-22T20-05-52-166Z-2834096-d585feef.stderr.log
```

Exact note from the outside piped stop:

```text
ao stop: the stop still runs in the detached process (PID 2816015) after 30 s; Ctrl-C leaves it running; its output: /tmp/aopn4/home/.agent-orchestrator/6ecb57ac2c34-outside/orchestrator-stop-2026-10-22T20-04-00-491Z-2815946-78b3e791.stdout.log and /tmp/aopn4/home/.agent-orchestrator/6ecb57ac2c34-outside/orchestrator-stop-2026-10-22T20-04-00-491Z-2815946-78b3e791.stderr.log
```

The Ctrl-C run wrote both `ao stop: the stop still runs in the detached process (PID 2822943) after 30 s; Ctrl-C leaves it running; its output: ...` and `ao stop: the stop goes on in the detached process (PID 2822943); its output: ...`; both named the same stdout/stderr files under `f82c68e070f6-interrupt`. They did not conflict. SIGINT was sent only to the exact caller PID 2822879 created by the helper, after checking its HOME in `/proc/2822879/environ`.

All scratch lifecycle workers ended: 2815893, 2815892, 2822122, 2815879, 2822856, 2833953 and 2841501. Every detached child recorded its exit. Confirmed stops left no active orchestrator record and no private server; the deliberate refusal was followed by a confirmed cleanup stop.

## Gates

All package commands ran under:

```sh
env -i HOME=/tmp/aopn4/home TMPDIR=/tmp/aopn4/tmp PATH=/tmp/aopn4/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true
```

The curated PATH contained cached pnpm 9.15.4, Node 25.7.0, basic local utilities, a gh stub accepting only `--version` and `auth status`, and a tmux shim selecting `aopn4-tests`. No agent binary and no npx were on the gate PATH. Install was offline; HUSKY=0 prevented shared git-hook configuration changes.

```text
pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3
Lockfile is up to date, resolution step is skipped
Already up to date
HUSKY=0 skip install
Done in 1.2s
exit 0

pnpm build
packages/cli build: Done
exit 0 (all intermediate package builds completed)

pnpm typecheck
packages/cli typecheck: Done
packages/integration-tests typecheck: Done
exit 0 (all intermediate package checks completed)

pnpm lint
✖ 5 problems (0 errors, 5 warnings)
exit 0
```

The five unchanged lint findings: `packages/cli/src/commands/spawn.ts:333:24`, `packages/core/src/activity-log.ts:91:31` and `packages/core/src/plugin-registry.ts:232:7` have `@typescript-eslint/no-non-null-assertion`; `packages/core/src/session-manager.ts:2383:11` and `:2390:9` have `no-console`. ESLint also prints its existing `.eslintignore` migration notice; install prints Node's url.parse deprecation notice.

Exactly one full `pnpm -r --no-bail test`, exit 0:

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
packages/cli test:       Tests  373 passed (373)
TOTAL: 3599 passed, 1 expected fail, 29 skipped (3629)
```

Compared with `de7c1bfc`: CLI rises from 370 to 373 passed, exactly the three added progress tests. Every other package count is unchanged. The one expected failure remains the core same-ID R3 F-5 test `kill and restore of one ID: the active record at the end names a live runtime`, marked `it.fails`. The skips remain 5 scm-github and 24 integration tests. No unexplained landing-gate failure.

```sh
SAME_ID_DEFECTS=red pnpm -r --no-bail --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode exec vitest run same-id --reporter=json
```

| Round | Passed | Failed | Expected failures |
| --- | ---: | ---: | ---: |
| R1 | 17 | 0 | 0 |
| R2 | 20 | 16 | 16 |
| R3 | 0 | 6 | 6 |
| R4 | 56 | 0 | 0 |

Red command exit 1 is expected from these 22 known defect assertions; counts match the prior gates exactly.

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
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aopn4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output was empty; there are no printed paths needing write attribution. The real workers 2087525 and 2087614, owner's servers/sessions and ao-63/ao-65 were not touched. No real agent, Herdr server, network request, `ao send`, commit, push or PR was made.

Each final private-server query used `env -u TMUX /usr/bin/tmux -L aopn4-<case> list-sessions` under the scrubbed environment:

```text
aopn4-tests: rc=1: no server running on /tmp/tmux-44402/aopn4-tests
aopn4-inside: rc=1: no server running on /tmp/tmux-44402/aopn4-inside
aopn4-outside: rc=1: no server running on /tmp/tmux-44402/aopn4-outside
aopn4-broken: rc=1: no server running on /tmp/tmux-44402/aopn4-broken
aopn4-interrupt: rc=1: no server running on /tmp/tmux-44402/aopn4-interrupt
aopn4-pane-success: rc=1: no server running on /tmp/tmux-44402/aopn4-pane-success
aopn4-backpressure: rc=1: no server running on /tmp/tmux-44402/aopn4-backpressure
```

Final live-process scan over `/proc/*/environ`, matching exact `HOME=/tmp/aopn4/home` and excluding the scanner and zombies: `[]`. `git diff --exit-code` produced no output and exited 0; HEAD remained `3e366a01e5ee760ec55347365eb7244b88c06b13`.

Removed `/tmp/aopn4` with non-forced `rm -r`, then removed the marker and seven own stale socket files with `rm`. All nine paths were checked absent. A post-deletion process scan was again `[]`.
