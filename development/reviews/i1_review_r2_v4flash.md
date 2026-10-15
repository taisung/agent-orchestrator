# I-1 round 2 blind review — drop OpenCode 1.x, require 2.0.29 (`8241f54c..39549455`)

Reviewer: DeepSeek V4.1 Flash (same lens as round 1, ao-10). Worktree at `39549455`
(`git log --oneline -1` matches). No tracked file edited, nothing committed or pushed. I read the author's
report only after items 1 to 4.

## Verdict

**LAND-SAFE**

Round 2 closes all three round-1 blockers/majors of both lenses plus every minor in my lens, and I found no
new blocker or major: **0 blockers, 0 majors, 3 minors** (m-4, m-5, m-6) and 2 recorded observations.

## Round-1 findings, closed

| Round-1 finding (mine and the sibling lens) | Status | Evidence |
|---|---|---|
| **B-1** integration launch tests need a host `opencode >= 2.0.29`; CI `Test` red | **closed** | item 1 |
| **M-1** refused `spawnOrchestrator` leaks worktree, metadata, prompt file | **closed** | item 2 |
| **M-2** no timeout on the `opencode --version` probe | **closed** | item 4 |
| m-1 (mine) empty output reported as "not found" | **closed** | `checkOpenCodeVersion`, `index.ts:234-290` |
| m-2 (mine) refused restore destroyed the old pane first | **closed** | item 3 |
| m-3 (mine) two probes on a restore that falls back | **closed** | `index.ts:687-700` |
| Sonnet m-1 stderr of the probe reached the terminal | **closed** | item 5 |
| Sonnet m-2 nonzero exit reported as "not found" | **closed** | item 5 |
| Sonnet m-3 first `x.y.z` anywhere decided | **closed** | item 5 |
| Sonnet m-4 `2.0.29-beta.1` accepted | **closed** | item 5 (now refused) |
| Sonnet m-5 mis-named unit test | **closed** | `index.test.ts` "runs the version probe in Node ..." |
| Sonnet m-8 floor text written twice | **closed** | `index.ts:160,163` (derived) |
| Sonnet m-6 refused restore lost the pane | **closed** | item 3 |
| Sonnet m-7 leftover `session/<id>` branch | recorded | observation 1, unchanged by design |
| Sonnet m-9 latent PATH split | recorded | observation 2, latent (no second binary today) |

## New findings

### m-4 (minor) — a refused restore without a stored session id fails in core discovery with a message that does not name the version

`restore()` enriches and, when `agent: opencode` has no valid `opencodeSessionId`, calls
`discoverOpenCodeSessionIdByTitle` (`session-manager.ts:2431-2443`) before it ever asks the plugin, and that
discovery also runs the (refused) binary. The failure text then comes from core, not the gate.

Reproducer (this worktree's build, isolated config/state, fake `opencode` printing `1.18.35`, metadata without
`opencodeSessionId`):

```
$ ... node packages/cli/dist/index.js session restore v4fr2-1
Cannot restore: OpenCode session mapping is missing
EXIT=1
```

The pane is kept (the order fix holds) and the session was unrestorable either way, so this is message quality
only: the owner is not told that upgrading OpenCode would help. The author records the same in report point 3.

### m-5 (minor) — a hanging binary still makes one restore wait about 40 s

The gate is bounded at 10 s (M-2 closed), but `restore()` also hits the pre-existing
`findOpenCodeSession` → `opencode session list --format json` call whose own `timeout` is 30 s
(`index.ts`, `getRestoreCommand`/`getActivityState` path). Measured with a fake that sleeps on every call:

```
detect()                       10.01 s   -> refused, 10.0 s bound
getLaunchCommand (ao spawn)    10.01 s   -> refused, 10.0 s bound
getRestoreCommand (stored id)  10.01 s   -> refused, 10.0 s bound
getRestoreCommand (no id)      30.01 s   -> returns null after findOpenCodeSession 30 s
core fallback shape            40.02 s   -> findOpenCodeSession 30 s, then probe 10 s, then refuse
```

Bounded, not unbounded, so M-2 is closed; the extra 30 s is pre-existing and belongs to I-2, which removes
`findOpenCodeSession`. Acceptable for this increment; record it so I-2 lowers or skips that 30 s.

### m-6 (minor) — the probe discards stderr even on a failure

`stdio: ["ignore", "pipe", "ignore"]` (`index.ts:241`) is what keeps probe stderr off the terminal on success
(verified: 0 bytes captured with a fake that writes to stderr). On a nonzero exit the refusal summarizes
stdout only (`index.ts:234-290`), so a binary that explains the failure on stderr leaves no clue in the
message. Cosmetic.

## Item results

### 1. B-1 closed — integration package with and without `opencode`

```
# opencode HIDDEN (CI Test shape): PATH=/usr/bin:/bin:$NODE_BIN
src/agent-opencode.integration.test.ts   (31 tests | 5 skipped)
 Test Files  1 passed (1)
      Tests  26 passed | 5 skipped (31)

# opencode PRESENT (real 2.0.29)
src/agent-opencode.integration.test.ts   (31 tests)
 Test Files  1 passed (1)
      Tests  31 passed (31)

# whole package, opencode HIDDEN
 Test Files  11 passed | 2 skipped (13)
      Tests  99 passed | 20 skipped (119)

# whole package, opencode PRESENT
 Test Files  11 passed | 2 skipped (13)
      Tests  104 passed | 15 skipped (119)
```

The `getLaunchCommand (integration)` block now writes a fake `opencode` that prints `opencode v2.0.29` and
puts it first on PATH in `beforeAll`, restoring PATH in `afterAll`
(`agent-opencode.integration.test.ts`, helper `writeFakeOpencode`). No coverage is hidden: the gated live
lifecycle block still runs off the real binary, because `findOpencodeBinary`/`canOpencodeRun` and `canRun` are
computed at import time with the untouched PATH (`canRun` false → 5 skipped when `opencode` is absent, true →
0 skipped when present). The new `version gate (integration)` block adds real-child-process coverage. The CI
`Test` job runs `pnpm test` (`pnpm -r test`) with no `opencode`, and the full run of that job's shape passes:

```
# pnpm -r test, PATH without opencode
core Tests 643 passed (643) ... plugins/agent-opencode Tests 159 passed (159)
integration-tests Tests 99 passed | 20 skipped (119) ... cli Tests 243 passed (243)
EXIT=0
```

### 2. M-1 closed — refused orchestrator start leaves nothing behind

`spawnOrchestrator` now runs `getLaunchCommand` and `getEnvironment` inside a `try` whose `catch` calls
`cleanupOrchestratorMetadataAndWorkspace(systemPromptFile)` and rethrows
(`session-manager.ts:1546-1557`). Reproducer (isolated `AO_STATE_ROOT`, scratch config/repo, fake `opencode`
printing `1.18.35`, round-2 core via `getSessionManager` + `sm.spawnOrchestrator`):

```
THREW: ao needs OpenCode 2.0.29 or later (found 1.18.35)
state:   sessions/ empty (no reserved metadata), no orchestrator-prompt-* file
worktrees: only the scratch repo (no orchestrator worktree)
branch:  orchestrator/v4fr2-orchestrator-1 remains
```

Metadata and prompt file are gone, no worktree; only the branch survives (observation 1). Forward reference:
round-2 `spawnOrchestrator` no longer leaks, so `ao start` on a refused host is clean.

### 3. The restore reorder is safe for every agent

`session-manager.ts`: step 6 now builds the command (`getRestoreCommand`, fallback `getLaunchCommand`) and
`getEnvironment` (`:2527-2557`), and step 7 destroys the old runtime only after both are ready (`:2559-2566`).

I read `getLaunchCommand`, `getEnvironment` and `getRestoreCommand` of all four agents:

- claude-code: pure string builders for launch/env; `getRestoreCommand` reads `~/.claude/projects/<path>`
  files (`index.ts:835-863`). No runtime handle, no write in Node, no lock.
- codex: pure launch/env; `getRestoreCommand` reads/streams the rollout file (`index.ts:629-656`). No runtime
  handle, no write, no lock.
- gemini: `getLaunchCommand` returns a shell string whose `cp …/ > GEMINI.md` runs in the pane, not in Node;
  `getRestoreCommand` only `readdir`s `~/.gemini/tmp` (`index.ts:233-238, 67-74`). No runtime handle, no write,
  no lock.
- opencode: `getRestoreCommand` reads metadata / `opencode session list`; no runtime handle, no lock.

`grep` for `runtimeHandle`/`isProcessRunning`/`process.kill` in the agent plugins shows those only in
`getActivityState`, never in the three methods. No agent depends on the old runtime being gone.

Core tests: `restore.test.ts` + `spawn.test.ts` → `Test Files 2 passed (2)`, `Tests 104 passed (104)`. The
restore group asserts `runtime.destroy`/`create` are not called on a refusal and that the order is
`["getRestoreCommand", "destroy", "create"]`.

Live before/after (one real 2.0.29 spawn, `remain-on-exit on`, agent process stopped by PID, stored
`opencodeSessionId`, then `ao session restore` with fake `1.18.35` first on PATH):

```
BEFORE (round-1 build) : Failed to restore session v4fr2-1: Error: ao needs OpenCode 2.0.29 or later (found 1.18.35)   exit 1
                         -> tmux: no server running /tmp/tmux-44402/v4fr2r2   (the old pane was destroyed)
AFTER  (round-2 build) : Failed to restore session v4fr2-1: Error: ao needs OpenCode 2.0.29 or later (found 1.18.35)   exit 1
                         -> tmux: 54229c0245ef-v4fr2-1 pane_dead=0           (the old pane survives)
```

So a refused restore now keeps the old pane; before, it did not.

### 4. M-2 closed — the probe is bounded, and a hanging binary no longer blocks without end

`checkOpenCodeVersion` runs `execFileSync("opencode", ["--version"], { encoding, timeout: 10_000,
killSignal: "SIGKILL", stdio: ["ignore","pipe","ignore"] })` (`index.ts:234-242`). With fakes that sleep on
every call (including a shell script whose background `sleep` keeps the stdout pipe open):

```
detect()                      10 012 ms -> false
getLaunchCommand              10 011 ms -> refused: "(opencode --version gave no answer within 10 s)"
getRestoreCommand (stored id) 10 015 ms -> refused, same reason
```

`ao spawn` is refused at ~10 s with no worktree and no metadata (item 2 pattern); `detect()` returns false at
~10 s. The grandchild-holds-the-pipe fake also returns at 10.01 s (the author's claim holds). For a restore the
gate adds its 10 s on top of the pre-existing 30 s `findOpenCodeSession` call → ~40 s total; see m-5. Judgment:
the unbounded block (M-2) is closed; a bounded ~40 s worst-case restore is acceptable for I-1, with I-2 owning
the residual 30 s.

### 5. The version parse

Built plugin, fake first on PATH (`detect()` / `getLaunchCommand`):

| `opencode --version` | result | fits Q9? |
|---|---|---|
| `1.18.35` | refused `(found 1.18.35)` | yes |
| `opencode v2.0.28` | refused `(found opencode v2.0.28)` | yes |
| `opencode v2.0.29` | accepted, detect true | yes |
| `2.0.29-beta.1` | refused `(found 2.0.29-beta.1)` | yes (semver pre-release of the floor) |
| `2.0.30` | accepted | yes |
| `2.1.0` | accepted | yes |
| `2.1.0-beta.1` | accepted | yes (pre-release past the floor) |
| `10.0.0` | accepted | yes (minimum, not a major pin) |
| `opencode v2.1.0 (abc123)` | accepted | yes |
| `update available 1.2.3` then `opencode v2.0.29` | accepted | yes (notice line cannot decide) |
| `opencode dev` | refused `(found opencode dev)` | yes |
| empty output | refused `(opencode --version printed nothing)` | yes |
| `opencode v2.0.29` + exit 3 | refused `(opencode --version exited with status 3, output: opencode v2.0.29)` | defensible |
| missing binary | refused `(opencode not found on PATH)` | yes |
| hang | refused `(... gave no answer within 10 s)`, ~10 s | yes (bounded) |

Every refusal message starts with `ao needs OpenCode 2.0.29 or later (<reason>)` and names its own reason
(`index.ts:234-290`). Refusing a nonzero exit even when stdout holds a supported version is the right call: a
`--version` that fails is not positive evidence of a working binary, and the message shows both the status and
the output. stderr of the probe does not reach the terminal (0 bytes captured with a noisy fake); see m-6 for
the flip side.

### 6. No regression

2.x new-session, resume and restore commands are byte-identical to round 1: generated the same 6 cases
(fresh, plain, systemPromptFile, resume with model+agent, plain resume, restore) from the `8241f54c` build and
the `39549455` build and `diff` reported no difference. `grep -n -E "run --format json|--command true|
OPENCODE_MAJOR|branchOnOpenCodeMajor|buildLegacySessionOptions|buildSessionIdCaptureScript"
packages/plugins/agent-opencode/src/index.ts` prints nothing (exit 1). The kept I-2/I-4 helpers
(`parseUpdatedTimestamp`, `parseSessionList`, `findOpenCodeSession`) remain.

### 7. Tests — non-vacuity and relations

```
# new CORE tests against the round-1 session-manager.ts (scratch copy)
 Tests  4 failed | 100 passed (104)
   the 4 are exactly: keeps the old runtime when getRestoreCommand throws; keeps the old runtime when the
   fallback getLaunchCommand throws; destroys the old runtime only after the restore command is ready;
   cleans up the worktree, metadata and prompt file when the agent refuses the launch

# new PLUGIN tests against the round-1 index.ts (scratch copy)
 Tests  12 failed | 147 passed (159)
   the 12 are the round-2 behaviours: notice line, 2.0.29-beta.1, built-from-2.0.30, printed nothing,
   not found on PATH, no answer within the bound, exit status, signal, EACCES, probe options, one-line
   message, probe-left-to-the-fallback
```

The rewritten assertions are relations, not copies of source literals: the gate tests assert the message
contains the floor and `found <the input>`; the shell-run tests compare the stored `session.create` body with
the config; the restore tests assert the call order and that one probe runs. The m-5 rename now actually builds
an existing-session command and asserts one probe per command and no `--version` in the pane.

### 8. The author's open points (severity only)

- Refused binary with no stored session id → core discovery message that does not name the version:
  **m-4, minor**, reproduced above.
- Leftover `session/<id>` / `orchestrator/<id>` branch after a refused spawn: **observation, minor**
  (`workspace-worktree` deletes no branches on any cleanup path; ID reuse then checks out the stale branch).
  Seen again: `orchestrator/v4fr2-orchestrator-1` after the item-2 run.
- PATH split between the gate (Node PATH) and the pane (shell-init PATH): **observation, latent**. On this
  host there is still exactly one `opencode` (`/home/taisung/.opencode/bin/opencode`, `opencode v2.0.29`) on
  the lifecycle-worker PATH and no npm-installed one, so no false accept/refusal today. Belongs in the I-6
  brief.
- ~40 s restore on a hanging binary: **m-5, minor**, acceptable for I-1.

### 9. Scope

```
$ git diff --name-status 8241f54c 39549455
M  packages/core/src/__tests__/session-manager/restore.test.ts
M  packages/core/src/__tests__/session-manager/spawn.test.ts
M  packages/core/src/session-manager.ts
M  packages/integration-tests/src/agent-opencode.integration.test.ts
M  packages/plugins/agent-opencode/src/index.test.ts
M  packages/plugins/agent-opencode/src/index.ts
```

Five commits on top of the untouched round-1 commits, conventional types (`fix(core)`, `fix(agent-opencode)`,
`test(integration)`, `test(agent-opencode)`), WHY in the bodies, no `Co-Authored-By`, no issue number, no emoji
(the only non-ASCII is an em dash moved with the restore comments and a `…` truncation character).
`git branch -r --contains 39549455` prints nothing. `git diff --check` clean.

## Commands and summary lines (this worktree)

```
pnpm install --frozen-lockfile                              ok
pnpm build                                                  ok (14 packages)
pnpm --filter @aoagents/ao-plugin-agent-opencode test       Tests 159 passed (159)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck  exit 0
pnpm --filter @aoagents/ao-core test                        Tests 643 passed (643)
pnpm --filter @aoagents/ao-integration-tests test           hidden: 99 passed | 20 skipped;
                                                            present: 104 passed | 15 skipped
pnpm lint                                                   ✖ 6 problems (0 errors, 6 warnings) — same 6 as round 1
pnpm -r test (PATH without opencode)                        EXIT=0 (core 643, agent-opencode 159,
                                                            integration 99+20 skipped, cli 243, ...)
```

## What I found correct

- B-1, M-1, M-2 closed; the restore order is safe for claude-code, codex, gemini and opencode (none of the
  three methods depends on the old runtime, writes in Node, or locks); a refused restore keeps the old pane.
- The probe is bounded at 10 s with SIGKILL and discards stderr; every refusal reason is named; a nonzero exit
  with a valid version is refused with the status and output.
- The parser anchors on a version-starting line, refuses `2.0.29-beta.1`, accepts `2.1.0-beta.1`, ignores a
  notice line and trailing text, and the floor text is derived from one triple.
- `getRestoreCommand` probes once (only when it returns a command), so a restore that falls back runs one probe.
- 2.x commands unchanged; 1.x vocabulary gone; kept helpers present.
- New core and plugin tests are non-vacuous (4/104 and 12/159 fail against the round-1 sources).
- Only the six allowed files changed; commit hygiene and scope clean; nothing on a remote.

## Cleanup

All `/tmp/opencode/ao10_r2` and `ao10_r1` scratch state, the round-1 scratch worktree, the isolated
`tmux -L v4fr2r2` server and its socket, the worktree `~/.worktrees/v4fr2/v4fr2-1` and its branch, and the
lifecycle worker I started (PID 3928589) were removed. The three OpenCode sessions my runs created
(`ses_ec247af9cffeCD8oCLiz0ScH98` live spawn, `ses_ec2447df0ffeFTkgQkFc8K9EOg` and
`ses_ec2448629ffeOzBTEypUQimhsR` from the present integration run) were removed with `session.remove` and
verified absent. Other reviewers' lifecycle workers (`ao-5`, `ao-13`) were left alone. No tracked file was
edited; nothing was committed, pushed, or opened as a PR, per §3.
