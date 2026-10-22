# Gates of main after same-ID R4

PASS on `193d2c9ef162ec961501d3e2466996e57364a632` (`validate/main-r4`). Full normal run: **3464 passed, 1 expected failure, 29 skipped; 3494 total, zero unexpected failures**. Red mode: **22 expected failures** (R1 0, R2 16, R3 6, R4 0). All three smoke cases pass. No source change, design review, commit, push, PR or primary-checkout rebuild.

## 1. Landed source identity

```sh
git rev-parse HEAD
git diff --stat 0fdab16c HEAD^{tree} -- . ':!development'
```

```text
193d2c9ef162ec961501d3e2466996e57364a632
(diff prints nothing; exit 0)
```

The landed source outside `development/` equals the reviewed three-way merge. All git/helper/node/pnpm/test calls use `/tmp/aogr4/run`: `env -i`, fake HOME `/tmp/aogr4/home`, TMPDIR `/tmp/aogr4/tmp`, scratch AO_CONFIG_PATH/AO_STATE_ROOT, HUSKY=0, C.UTF-8 locale, no real agent binary on PATH and a gh stub. Private tmux shims clear the environment before starting tmux, with no AO variables and explicit `-L aogr4-*`. Build precedes dependent tests and the smokes. Results were recorded incrementally, then consolidated here.

## 2. Install, build, typecheck and lint

| Command | Exit | Summary line |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped`; `Done in 2.5s`; `HUSKY=0 skip install` |
| `pnpm build` | 0 | `packages/cli build: Done` (recursive build completed) |
| `pnpm typecheck` | 0 | `packages/cli typecheck: Done`; `packages/integration-tests typecheck: Done` |
| `pnpm lint` | 0 | `5 problems (0 errors, 5 warnings)` |

The five existing lint warnings are:

- `packages/cli/src/commands/spawn.ts:333:24`: forbidden non-null assertion.
- `packages/core/src/activity-log.ts:91:31`: forbidden non-null assertion.
- `packages/core/src/plugin-registry.ts:232:7`: forbidden non-null assertion.
- `packages/core/src/session-manager.ts:2372:11` and `:2379:9`: unexpected console statements.

The existing ESLint launcher warning about `.eslintignore` also appears; it is separate from those five diagnostics. The install's Node `url.parse()` deprecation notice is not a gate failure.

## 3. Full recursive tests and comparison

Command: `pnpm -r --no-bail test`, exit **0**. Exact per-package test summary lines:

```text
packages/core test:       Tests  1616 passed | 1 expected fail (1617)
packages/plugins/agent-gemini test:       Tests  88 passed (88)
packages/plugins/agent-codex test:       Tests  307 passed (307)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  241 passed (241)
packages/plugins/runtime-herdr test:       Tests  73 passed (73)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:       Tests  363 passed (363)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  323 passed (323)
```

Total: **3464 passed + 1 expected failure + 29 skipped = 3494 tests** across 13 packages with test scripts; **127 test files passed, 3 skipped**. No skipped case is represented as a passing test. Integration skips 24 cases in three suites that require real agent binaries; scm-github skips five. These counts match the intentional skips in r4.

The one separately reported core expected failure is the existing R3 case: `[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it — kill and restore of one ID: the active record at the end names a live runtime`. It also fails in red mode; it is not an unexplained regression.

Comparison with review r4's full run on `e3860672`:

| Package | e3860672 passed | main passed | Explanation |
| --- | ---: | ---: | --- |
| agent-claude-code | 215 | 241 | +26 tests from the landed Claude detectActivity round. |
| agent-codex | 247 | 307 | +60 from the earlier Codex send/screen fix already on main: 27 in new `codex-screen.test.ts`, 33 added cases in `index.test.ts`. |
| CLI | 277 | 323 | +18 in `send-claude-code.test.ts`, +28 in `send-codex.test.ts`. |
| All other packages | unchanged | unchanged | Same passed/expected-failure/skipped counts. |

The net difference is **+132 passing tests**, from 3332 to 3464. It is not all attributable to the Claude round: the feature tip also lacked main's earlier Codex fix. The source/test diff confirms both sets; new CLI files execute 18 and 28 cases, and the new Codex screen suite executes 27. These are the same package counts as the previously reviewed combination of main and R4.

## 4. Red mode

Command (all 14 defect/reuse-window files, core aliased to this worktree's source):

```sh
SAME_ID_DEFECTS=red node packages/core/node_modules/vitest/vitest.mjs run --root /home/taisung/.worktrees/agent-orchestrator/ao-60 --config /tmp/aogr4/red.config.mjs same-id-defects same-id-reuse-window --reporter=json --outputFile=/tmp/aogr4/logs/red.json
```

Exit **1, expected**: 70 passed, 22 failed, 0 skipped. Per-round counts:

| Round | Passed | Failed | Expected failed |
| --- | ---: | ---: | ---: |
| R1 | 17 | 0 | 0 |
| R2 | 20 | 16 | 16 |
| R3 | 0 | 6 | 6 |
| R4 | 33 | 0 | 0 |
| Total | 70 | 22 | 22 |

The failures are the retained R2 runtime-identity and R3 ownership/serialization defects. The counts match the brief and review r4 exactly; there is no R4 red failure.

## 5. Built CLI/core smoke

Command: `/tmp/aogr4/run node /tmp/aogr4/smoke/run.mjs` (exit **0**). Imports use this worktree's newly built `packages/core/dist` and plugin dist; status/send run this tree's `packages/cli/dist/index.js`. Every config, record, fixture process and log is under `/tmp/aogr4`. No real agent/Herdr/OpenCode executable runs.

R4 setup: two scratch Codex records (`gr-1`, `gr-2`); the control session supplies a positive activity observation so the old fleet-outage bound cannot explain the result. For malformed ps, the runtime is a real live private tmux pane containing only `sleep`, while the ps stand-in returns exit 0 and `procfs temporarily unavailable`. For Herdr, handle `w7:p1` expects `term_a`, but the CLI stand-in returns `{"pane":{"pane_id":"w7:p1","terminal_id":"term_b"}}` without `result`; the control pane has a valid wrapped answer. Its process-info reply is well formed. Each case runs:

```sh
node packages/cli/dist/index.js status --json -p validation
```

Both status results show `gr-1: status=working, activity=null`, and each status read leaves the parsed record unchanged. The built lifecycle manager then runs two completed polls. The status and generation remain unchanged:

```text
R4 AFTER TWO POLLS malformed-ps {"status":"working","generationBefore":"1","generationAfter":"1","killedReason":null}
R4 AFTER TWO POLLS herdr-without-result {"status":"working","generationBefore":"2","generationAfter":"2","killedReason":null}
CLAUDE REGULAR SEND {"exit":0,"durationSeconds":3.087,"output":"Message sent and processing","keys":[{"seconds":0.436,"args":["send-keys","-t","=gr-claude:","C-u"]},{"seconds":0.68,"args":["send-keys","-t","=gr-claude:","-l","Validation replay message."]},{"seconds":1.025,"args":["send-keys","-t","=gr-claude:","Enter"]}],"bytes":"\u0015Validation replay message.\r"}
SMOKES PASS: malformed ps and malformed Herdr preserve working; regular Claude send starts at once
OWNED PIDS AFTER STOP [{"pid":3714083,"exists":false},{"pid":3714088,"exists":false},{"pid":3716623,"exists":false},{"pid":3714076,"exists":false}]
```

Claude setup: private `aogr4-smoke`, pane `gr-claude`, a raw Python fixture terminal (180×100, alternate screen, bracketed paste). The initial captured screen equals committed `claude-2.1.307-idle-bypass.txt` after trimming terminal padding; the built Claude plugin reads idle. Built core independently resolves the stored Claude agent and exact runtime ID. Initial Enter redraws committed `claude-2.1.306-running-01.txt` so delivery verification observes processing. No actual Claude process or model turn is involved.

The actual regular send, with no `--no-wait`:

```sh
node packages/cli/dist/index.js send gr-claude --timeout 1 'Validation replay message.'
```

Exit 0, `Message sent and processing`, 3.087 seconds overall. First key (`C-u`) at **0.436 s**, literal text at **0.680 s**, initial Enter at **1.025 s**; no busy-wait line and no verification Enter. Raw pane bytes exactly `\u0015Validation replay message.\r`. The tmux argv log independently confirms all three sends. The remaining time is the normal two-second delivery verification, not an idle wait.

## 6. Cleanup evidence

Required check, read-only:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aogr4-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
```

Every entry is external lifecycle state:

- `sessions/ao-55`: external author session, worktree `/home/taisung/.worktrees/agent-orchestrator/ao-55`, agent claude-code, status stuck, generation 51. File mtime 2026-10-22 09:49:25.460072441 EDT. Its real lifecycle log records a working-to-stuck transition. No validation command wrote that record.
- `sessions`: exactly the same mtime as ao-55's record, consistent with that external atomic record replacement. The validation uses only scratch state. This attribution does not claim mtime alone identifies a writer PID.

Before `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After the same command (byte-identical):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final process audit:

```text
Own processes excluding audit and ancestors: [] readable environments: 144
Owned smoke PID 3714076 exists False
Owned smoke PID 3714083 exists False
Owned smoke PID 3714088 exists False
Owned smoke PID 3716623 exists False
aogr4-tests list-sessions: exit 1, no server running on /tmp/tmux-44402/aogr4-tests
aogr4-smoke list-sessions: exit 1, no server running on /tmp/tmux-44402/aogr4-smoke
```

The smoke panes and server were stopped by their exact recorded PIDs; all are absent. Test processes ended and their private server is gone. No separate lifecycle-worker process was started. Real workers 2002324 (`ao lifecycle-worker agent-orchestrator`) and 2002831 (`ao lifecycle-worker agent-skills`) remain running and were not signaled. No default tmux call, orchestrator-pane read, real AO operation, real agent/model turn, network gh, pattern kill or ao send report occurred.

After retaining the evidence, removed the two exact inactive socket files, `/tmp/aogr4` and `/tmp/aogr4-marker`. Final tracked diff is empty; only the supplied task, status report and this validation file are untracked. The final status report is published atomically with earlier reports preserved. The primary checkout has not been rebuilt by this validation.
