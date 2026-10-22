# Gates of main after Claude strict process F-6 and quoted-list m-1

**PASS** on `33a2c74ced484295d6d2fe0997ddb2bc0c199d51` (`validate/main-claude-strict`): **3541 passed, 1 expected failure, 29 skipped, 0 unexpected failures** in the accepted full run. Red counts match R1 0, R2 16, R3 6, R4 0; both required smokes pass. No code changes or commits. All execution uses `/tmp/aogcs/run` with env -i, fake HOME/TMPDIR/AO paths, no real agent binaries, a gh stub, and private tmux servers. Protected workers 3830765 and 3830929 were confirmed running before validation.

## Source identity

```sh
git rev-parse HEAD
git diff --stat d779318c HEAD^{tree} -- . ':!development'
git diff --stat 5b039aca HEAD^{tree} -- . ':!development'
```

```text
33a2c74ced484295d6d2fe0997ddb2bc0c199d51
Both diffs: no output, exit 0.
```

Thus the landed source equals both the landing merge and the review-r1 tested merge outside development. The branch is the supplied validation branch; no checkout or merge was performed. Install, build, typecheck, lint and the accepted full recursive suite exited 0.

## Harness correction before the accepted full gate

The first full-suite attempt exited 1 with eight path-layout assertions: I had set the scratch AO_STATE_ROOT to `/tmp/aogcs/state`, while these existing tests explicitly require the directory basename `.agent-orchestrator`. This differs from the review-r1 harness. No source changed. The actual received paths were correctly isolated under scratch, but mismatched those test regexes. The failures were:

```text
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getProjectBaseDir returns correct format
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getSessionsDir returns {baseDir}/sessions
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getWorktreesDir returns {baseDir}/worktrees
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getFeedbackReportsDir returns {baseDir}/feedback-reports
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getArchiveDir returns {baseDir}/sessions/archive
packages/core test:  FAIL  src/__tests__/paths.test.ts > Path Construction > getOriginFilePath returns {baseDir}/.origin
packages/integration-tests test:  FAIL  src/cli-spawn-core-read-new.integration.test.ts > CLI-Core integration (hash-based architecture) > sessions are stored in hash-based project-specific directory
packages/integration-tests test:  FAIL  src/config-metadata-service.integration.test.ts > config → metadata service integration (real filesystem) > getSessionsDir returns hash-based path including project name
```

Initial totals: 3533 passed, 8 failed, 1 expected failure, 29 skipped. Corrected only the wrapper's AO_STATE_ROOT to `/tmp/aogcs/home/.agent-orchestrator`, matching the previous review environment. The complete replacement gate passed; the invalid-harness attempt is retained here and is not presented as a passing or expected-failure run. The built CLI smokes already passed using `/tmp/aogcs/state`; that was a valid custom state root for those product operations.

## Install, build, typecheck, lint

All commands use env -i and the scratch wrapper.

| Command | Exit | Summary |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile is up to date, resolution step is skipped; HUSKY=0 skip install |
| `pnpm build` | 0 | Recursive build completed; packages/cli build: Done |
| `pnpm typecheck` | 0 | packages/cli typecheck: Done; packages/integration-tests typecheck: Done |
| `pnpm lint` | 0 | 5 problems (0 errors, 5 warnings) |

The known warnings only:

- `packages/cli/src/commands/spawn.ts:333:24`: forbidden non-null assertion.
- `packages/core/src/activity-log.ts:91:31`: forbidden non-null assertion.
- `packages/core/src/plugin-registry.ts:232:7`: forbidden non-null assertion.
- `packages/core/src/session-manager.ts:2372:11` and `:2379:9`: unexpected console statement.

The existing ESLint .eslintignore migration warning and install's Node url.parse deprecation notice also appear. Neither is a gate error.

## Built CLI and core smokes

Command: `/tmp/aogcs/run node /tmp/aogcs/smoke/run.mjs`, exit 0. Imports are this tree's newly built core and Claude plugin dist; workers and sends execute this tree's `packages/cli/dist/index.js`. No source mocks are used. State/config/logs are under scratch, with AO_STATE_ROOT `/tmp/aogcs/state`. Only private `aogcs-smoke` panes are read. The pane processes are a Python terminal replay fixture named `claude`, not an agent executable; no model runs. Real tmux supplies the TTYs and input transport.

Lifecycle command, once per ps mode:

```sh
node packages/cli/dist/index.js lifecycle-worker validation --interval-ms 1000
```

A stand-in ps, on PATH only for the smoke, logs calls. Malformed mode returns exit 0 with header `PID TT COMMAND` and no process rows. Valid mode returns a syntactically complete process list with bash on the target TTY and a Claude fixture process on the control TTY. Two distinct completed `lifecycle-poll-*` health records are awaited for each case. The sessions have createdAt older than launch grace; in valid mode, the control has a positive process result, so the exit control is not an all-negative fleet. In malformed mode both Claude process checks are unknown. Both panes remain alive until cleanup.

Exact before/after summaries and worker PIDs:

```text
LIFECYCLE BEFORE malformed {"id":"gcs-live","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-live\",\"runtimeName\":\"tmux\",\"data\":{}}"}
WORKER malformed PID 4163054
LIFECYCLE AFTER malformed {"id":"gcs-live","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-live\",\"runtimeName\":\"tmux\",\"data\":{}}"}
LIFECYCLE BEFORE valid {"id":"gcs-live","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-live\",\"runtimeName\":\"tmux\",\"data\":{}}"}
WORKER valid PID 4163093
LIFECYCLE AFTER valid {"id":"gcs-live","status":"killed","generation":"2","killedReason":"agent-exited","agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-live\",\"runtimeName\":\"tmux\",\"data\":{}}"}
```

Malformed mode keeps status working and generation 1 after each of two polls. Valid absence keeps working after poll 1, then writes killed, generation 2, killedReason agent-exited after poll 2. The control session never becomes killed. This uses the actual built CLI lifecycle worker and built core's metadata writes.

Regular sends (no --no-wait), on panes whose initial captures equal their source fixtures after terminal-padding trim:

```sh
node packages/cli/dist/index.js send gcs-quote --timeout 1 'Validation fixture message.'
node packages/cli/dist/index.js send gcs-idle --timeout 1 'Validation fixture message.'
```

The quote is exactly `● Here is an example:\n  ❯ 1. Red\n    2. Blue` without an input box. The idle pane replays committed `claude-2.1.307-idle-bypass.txt`. Initial Enter redraws committed `claude-2.1.306-running-01.txt`, so verification observes processing. The built detector confirms active for the quote and idle for the idle fixture.

Exact output, timings, keys, bytes and records:

```text
SEND gcs-quote {"exit":0,"durationSeconds":8.160000085830688,"output":"Waiting for gcs-quote to become idle...\nTimeout waiting for idle. Sending anyway.\nMessage sent and processing","keys":[{"seconds":5.5155909061431885,"args":["send-keys","-t","=gcs-quote:","C-u"]},{"seconds":5.7562336921691895,"args":["send-keys","-t","=gcs-quote:","-l","Validation fixture message."]},{"seconds":6.0956339836120605,"args":["send-keys","-t","=gcs-quote:","Enter"]}],"bytes":"\u0015Validation fixture message.\r","before":{"id":"gcs-quote","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-quote\",\"runtimeName\":\"tmux\",\"data\":{}}"},"after":{"id":"gcs-quote","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-quote\",\"runtimeName\":\"tmux\",\"data\":{}}"}}
SEND gcs-idle {"exit":0,"durationSeconds":3.0470001697540283,"output":"Message sent and processing","keys":[{"seconds":0.3956155776977539,"args":["send-keys","-t","=gcs-idle:","C-u"]},{"seconds":0.6380550861358643,"args":["send-keys","-t","=gcs-idle:","-l","Validation fixture message."]},{"seconds":0.9802944660186768,"args":["send-keys","-t","=gcs-idle:","Enter"]}],"bytes":"\u0015Validation fixture message.\r","before":{"id":"gcs-idle","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-idle\",\"runtimeName\":\"tmux\",\"data\":{}}"},"after":{"id":"gcs-idle","status":"working","generation":"1","killedReason":null,"agent":"claude-code","runtimeHandle":"{\"id\":\"gcs-idle\",\"runtimeName\":\"tmux\",\"data\":{}}"}}
SMOKES PASS
OWNED PIDS AFTER STOP [{"pid":4163043,"exists":false},{"pid":4163049,"exists":false},{"pid":4163123,"exists":false},{"pid":4163128,"exists":false},{"pid":4163054,"exists":false},{"pid":4163093,"exists":false},{"pid":4163042,"exists":false}]
```

The quote waits once for idle, then sends after the 5-second polling interval (despite a one-second configured timeout); it never prints the waits-for-an-answer or interactive-input-refusal line. The idle case sends its first key at 0.396 s with no waiting line; total 3.047 s includes normal delivery verification. Each case receives exactly C-u, the literal message and one initial Enter; no retry Enter. Both send records remain working with unchanged generation 1. The seven exact owned PIDs were all absent after cleanup.

## Accepted full gate and comparison with review r1

Command: `pnpm -r --no-bail test` under the corrected isolated wrapper. Exit **0**. Exact package summary lines:

```text
packages/core test:       Tests  1616 passed | 1 expected fail (1617)
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
packages/cli test:       Tests  323 passed (323)
```

Total: **3541 passed, 1 expected failure, 29 skipped, 0 unexpected failures** (3571 total). Every package matches review r1's merge-tree `5b039aca` run exactly; the difference is zero in each package and in every outcome category. The initial invalid-harness attempt was eight passing tests short (core -6, integration -2), entirely accounted for by the state-root basename assertions documented above. They all pass in the accepted run without any source or test edits.

The one separately reported core expected failure is the retained R3 case: `[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it — kill and restore of one ID: the active record at the end names a live runtime`. It is also one of the expected red-mode failures. scm-github skips five tests; integration skips 24 real-agent-dependent cases. No skipped case is counted as passed.

## Red mode

Command, in each package containing same-ID tests, with the isolated wrapper:

```sh
SAME_ID_DEFECTS=red pnpm exec vitest run same-id --reporter=json --outputFile=<scratch-package-log.json>
```

All intentional red failures are retained R2/R3 identity defects; no unclassified failure. Packages with such cases exit 1 as expected. Aggregate: **93 passed, 22 failed** (includes 23 strict-read tests in addition to the 92 defect/reuse-window cases).

| Round | Failed | Expected failed |
| --- | ---: | ---: |
| R1 | 0 | 0 |
| R2 | 16 | 16 |
| R3 | 6 | 6 |
| R4 | 0 | 0 |
| Total | 22 | 22 |

| Package | Passed | R1 failed | R2 failed | R3 failed | R4 failed |
| --- | ---: | ---: | ---: | ---: | ---: |
| cli | 2 | 0 | 0 | 0 | 0 |
| core | 56 | 0 | 0 | 1 | 0 |
| agent-claude-code | 1 | 0 | 1 | 0 | 0 |
| agent-codex | 3 | 0 | 1 | 0 | 0 |
| agent-gemini | 3 | 0 | 1 | 0 | 0 |
| agent-opencode | 3 | 0 | 1 | 1 | 0 |
| runtime-herdr | 8 | 0 | 1 | 0 | 0 |
| runtime-tmux | 12 | 0 | 11 | 0 | 0 |
| workspace-worktree | 5 | 0 | 0 | 4 | 0 |

## Cleanup and isolation evidence

Every node/pnpm/helper/test command ran with env -i, fake HOME `/tmp/aogcs/home`, TMPDIR `/tmp/aogcs/tmp`, scratch AO_CONFIG_PATH `/tmp/aogcs/config.yaml`, scratch XDG locations, CI=1 and HUSKY=0. PATH contained the node/pnpm links and private tmux/gh shims, plus /usr/bin and /bin; checks found no real claude/codex/gemini/opencode/herdr binary there. The smoke adds only its own tmux and ps stand-ins to PATH. Its Python fixture is outside PATH. The gh stub was never invoked (no stub log); no network gh ran. tmux shims clear AO variables and select only aogcs-tests or aogcs-smoke; no default-server or real-pane read occurred.

Required real-state check:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aogcs-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
```

Both entries are external session state:

- `sessions/ao-52`: mtime 2026-10-22 10:38:20.279444920 EDT; generation 46, status working, agent claude-code, its own `/home/taisung/.worktrees/agent-orchestrator/ao-52` worktree. No validation command targets that record. The exact external writer was not identified; older lifecycle log entries show working-to-stuck transitions, which do not by themselves explain this newer working record.
- `sessions`: identical mtime to the ao-52 record, consistent with its atomic replacement. All validation metadata writes were to `/tmp/aogcs/state` or `/tmp/aogcs/home/.agent-orchestrator`, not this real directory.

Before:

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After (cmp exit 0, byte-identical):

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Process audit after all tests and smokes (exact scratch environment/path markers in /proc, excluding the auditor and its ancestors):

```text
Own processes: []
Owned smoke PIDs 4163042, 4163043, 4163049, 4163054, 4163093, 4163123, 4163128: all absent.
aogcs-tests list-sessions: exit 1, no server running on /tmp/tmux-44402/aogcs-tests
aogcs-smoke list-sessions: exit 1, no server running on /tmp/tmux-44402/aogcs-smoke
```

Signals were sent only to the exact recorded smoke-worker, pane and private-server PIDs. The two inactive socket files were removed by exact name. Protected real workers 3830765 (agent-orchestrator) and 3830929 (agent-skills) remained running and were not signaled. No pattern kill, real AO action, model turn, commit, push, PR, pull, rebase or primary-checkout rebuild occurred. Tracked diff remains empty; only the supplied task, report and this validation file are untracked.

Final cleanup: `/tmp/aogcs` and `/tmp/aogcs-marker` removed and verified absent. The state listing and ~/.ao/bin listing were rechecked immediately before removal and were unchanged. Final PASS report published atomically after cleanup, preserving all earlier reports.
