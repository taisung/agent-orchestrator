# Review R1: I-1 drop OpenCode 1.x, require 2.0.29 (`439c16fb..ed77d5fc`) (reviewer: Sonnet 5.5)

**Verdict: NOT-LAND-SAFE**

1 blocker, 2 major, 9 minor. The plugin itself is correct on a 2.0.29 host: the gate, the generated
commands, `ao spawn` and `ao session restore` all behave as designed. The blocker is in the integration
tests, which now need a real `opencode >= 2.0.29` on PATH and turn two CI jobs red. The two majors are
a cleanup leak in `spawnOrchestrator` (which the commit message says does not exist) and a gate call with
no timeout. All three have a small fix.

Reviewed at `ed77d5fc` (`git log --oneline -1` matches). Host: Linux, Node v25.7.0, `opencode v2.0.29`
at `/home/taisung/.opencode/bin/opencode`. I read the author's report only after items 1 to 4.

## Findings

### B-1: 14 integration tests now depend on the host `opencode` and fail in both CI jobs

- File: `packages/integration-tests/src/agent-opencode.integration.test.ts:181-184` (the block
  `describe("getLaunchCommand (integration)")`, headed "Launch command tests (no external dependencies)",
  not gated by `skipIf`). Cause: `index.ts:401` calls `execFileSync("opencode", ["--version"])` on every
  `getLaunchCommand`, and this block uses the real `child_process`, not the mock of the unit tests.
- Evidence, same file, `PATH` without any `opencode`:

      PATH=$NODE_BIN:/usr/bin:/bin ./node_modules/.bin/vitest run src/agent-opencode.integration.test.ts
      Failed Tests 14   ("ao needs OpenCode 2.0.29 or later (opencode not found)" x 28 lines)
      baseline 439c16fb, same PATH: Test Files 1 passed, Tests 23 passed | 5 skipped (28)

  With a fake `opencode` that prints `1.19.0` first on PATH: 14 `getLaunchCommand (integration)` tests fail
  with `ao needs OpenCode 2.0.29 or later (found 1.19.0)`.
- CI effect:
  - `.github/workflows/ci.yml:41-53` job `Test` runs `pnpm test` (= `pnpm -r test`, which includes the
    `integration-tests` package). It installs no OpenCode. Result: 14 failures.
  - `.github/workflows/integration-tests.yml:43-44` runs `npm install -g opencode-ai`. `npm view opencode-ai
    version` prints `1.19.0` today, so the gate refuses it. Result: 14 failures.
  - Any dev host without OpenCode 2.x (Codex-only or Claude-only) fails `pnpm test` the same way.
- Why it blocks: design 0009 section 13 requires each increment to keep `pnpm test` green. It is green on
  this host only because this host has 2.0.29. The author's report notes that the block "runs ... with the
  real `opencode --version`" but does not check a host without it.
- Fix (test only, one file): make the block hermetic. Either put a fake `opencode` script that prints
  `opencode v2.0.29` first on `PATH` in `beforeAll` and restore it in `afterAll`, or mock
  `node:child_process` as `index.test.ts` does, or wrap the block in `describe.skipIf` on a supported
  binary (weaker: the block then skips in CI). The CI install line is a separate change (I-6 owns the
  install package).

### M-1: `spawnOrchestrator` leaks the worktree, branch, reserved metadata and prompt file when the gate throws

- File: `packages/core/src/session-manager.ts:1546`. `getLaunchCommand` is called before the `try` at
  `:1550-1552`, and the cleanup helper `cleanupOrchestratorMetadataAndWorkspace` (`:1467`) is used only
  inside that `try` and the later steps. In `spawn()` the same call sits inside the `try` (`:1131`), so
  that path is clean. The gate comment in `index.ts:215-221` and the commit message of `e1ab96c8`
  ("makes session-manager destroy the workspace, delete the reserved metadata") describe only `spawn()`.
- Evidence (scratch config, `AO_STATE_ROOT` under `/tmp`, fake `opencode` printing `1.18.35` first on PATH,
  script calling `sm.spawnOrchestrator({ projectId, systemPrompt })`, run twice):

      THROWN after 88 ms: ao needs OpenCode 2.0.29 or later (found 1.18.35)
      sessions/: zzrevsonnet-orchestrator-1 (0 bytes), zzrevsonnet-orchestrator-2 (0 bytes)
      git branch: + orchestrator/zzrevsonnet-orchestrator-1, + orchestrator/zzrevsonnet-orchestrator-2
      worktrees: both directories still exist
      state: orchestrator-prompt-zzrevsonnet-orchestrator-1.md still exists
      ao session ls: zzrevsonnet-orchestrator-1 (-) [spawning]  zzrevsonnet-orchestrator-2 (-) [spawning]

  Each failed `ao start` (the only caller, `packages/cli/src/commands/start.ts:877`) on a refused host
  leaves one more phantom `[spawning]` session, one worktree, one branch and one prompt file. The
  lifecycle worker then polls the phantom entries.
- Fix: move the `getLaunchCommand` and `getEnvironment` calls into the existing `try` (or call
  `cleanupOrchestratorMetadataAndWorkspace(systemPromptFile)` in a `catch` around them). Add a
  `spawnOrchestrator` test with an agent whose `getLaunchCommand` throws. The core change is small, but it
  is a change outside the three files; the alternative is to accept the leak and record it as a known
  issue for I-3, which reworks this path.

### M-2: the gate call has no timeout; a hanging `opencode --version` blocks the process without bound

- File: `packages/plugins/agent-opencode/src/index.ts:203`
  (`execFileSync("opencode", ["--version"], { encoding: "utf-8" })`, no `timeout`, no `killSignal`).
- Evidence (fake `opencode` that sleeps, run through the built plugin):

      sleep 8 then print "opencode v2.0.29": detect() 8006 ms, getLaunchCommand 8008 ms,
        getRestoreCommand 8008 ms (each call waits the full time, once per call)
      sleep 40, outer `timeout 25`: killed by the outer timeout at 25 s, exit 124, no inner timeout

  The call is synchronous, so the Node event loop stops as well. Other `opencode` calls in the same file
  use `execFileAsync(..., { timeout: 30_000 })` (`findOpenCodeSession`, `index.ts:352`).
- Which paths block: `ao spawn` and `ao batch-spawn` (one call per OpenCode worker, in `getLaunchCommand`),
  `ao start` orchestrator spawn, `ao session restore`, and `detect()` (up to 3 times per `ao start`). The
  lifecycle worker never calls any of them (see Item 2), so polling does not stall.
- Left behind if the caller is killed during the hang (by code reading, not run): `spawn()` reserves the
  ID and creates the worktree before `getLaunchCommand`, so a killed `ao spawn` leaves reserved metadata
  and a worktree, because no exception reaches the `catch` that cleans them.
- Fix: add `timeout: 10_000` (and `killSignal: "SIGKILL"`) to the options. A timeout makes `execFileSync`
  throw, which the existing `catch` maps to "opencode not found"; see m-2 for the message.

### m-1: stderr of `opencode --version` goes to the terminal

- `index.ts:203` uses the default `stdio`, so the child's stderr is inherited. A fake that prints
  `noisy warning on stderr` after the version printed that line once per call (3 times in my run, once in
  each of `detect`, `getLaunchCommand`, `getRestoreCommand`). On a successful probe it is noise on the
  `ao spawn` output. Fix: `stdio: ["ignore", "pipe", "ignore"]`.

### m-2: a nonzero exit with a valid version on stdout is reported as "opencode not found"

- `index.ts:201-210` returns null on any exception, and `buildUnsupportedVersionMessage(null)` says
  `opencode not found`. A fake that prints `opencode v2.0.29` and exits 3 gives
  `ao needs OpenCode 2.0.29 or later (opencode not found)` and `detect()` false. The binary is found, so
  the message sends the owner to the wrong fix. Same for a timeout once M-2 is fixed. Fix: separate
  ENOENT from other failures in the message (`could not run opencode --version: <code>`).

### m-3: first `x.y.z` in the output decides, wherever it is

- `index.ts:171` takes the first match of `(\d+)\.(\d+)\.(\d+)`. A fake that prints
  `update available 1.2.3` then `opencode v2.0.29` is refused (`found update available 1.2.3\nopencode
  v2.0.29` in the message). Real 2.0.29 prints only `opencode v2.0.29`, so this is latent. Fix if wanted:
  anchor on `^\s*(?:opencode\s+)?v?(\d+)\.` per line. Also the message prints all lines of the output.

### m-4: `2.0.29-beta.1` is accepted, which the stated rationale does not cover

- `index.ts:160-166` and the commit message accept a pre-release "past the floor" on its numeric core. The
  code also accepts a pre-release of the floor itself: `2.0.29-beta.1` gives `det: true` and a launch
  command, while `2.0.28-rc.1` is refused. By semver `2.0.29-beta.1` is lower than the measured 2.0.29.
  The tests cover only `2.1.0-beta.1`. Either refuse a pre-release whose core equals the floor, or say in
  the comment that the floor is by core.

### m-5: one unit test has the wrong name and checks nothing new

- `index.test.ts:443` `uses existing session id without a version probe` builds a config with no
  `opencodeSessionId` and asserts the same two substrings as the first test of the group. It does not use
  an existing session ID and does not assert the absence of a probe. The existing-session case is
  covered by `:425` (`toBe("opencode --session 'ses_abc123' --prompt 'continue'")`). Remove it or give it
  the existing ID and `not.toContain("--version")`.

### m-6: `ao session restore` destroys the old pane before the gate can refuse

- `session-manager.ts:2517-2520` (step 6) destroys the old runtime, and `:2547` (step 7) calls
  `getRestoreCommand`, where the gate throws (`index.ts:623`).
- Evidence (killed agent, tmux session still alive, fake `1.18.35` first on PATH):

      Failed to restore session zzrevsonnet-1: Error: ao needs OpenCode 2.0.29 or later (found 1.18.35)
      exit=1; before: 1 tmux session; after: no server running (the session is gone)
      metadata: status=killed unchanged, worktree intact

  So the surviving pane of a crashed session (and its scrollback) is lost, and the restore still fails.
  The session stays restorable. The order is in core and is not new, but the gate is a new reason to throw
  here. Fix: run the version check before step 6 (this needs an agent-level pre-check hook in core), or
  accept the loss and document it.

### m-7: a refused spawn leaves the `session/<id>` branch, and the next spawn reuses it

- `ao spawn` on a refused host: exit 1, no pane, metadata deleted, worktree removed, but branch
  `session/zzrevsonnet-1` stays (`git branch` after the run; the workspace plugin never deletes branches,
  `workspace-worktree/src/index.ts:173-177`). The author saw the same. The ID is free again, so the next
  spawn gets the same ID, and `create()` checks out the existing branch (`:119-128`). By code reading, that
  branch still points at the old base commit, so the worker starts from a stale base if `main` moved. Not
  new, but a refused host makes it likely. Record it; no change needed in I-1.

### m-8: the floor is written twice

- `index.ts:149` `OPENCODE_MIN_VERSION = { major: 2, minor: 0, patch: 29 }` and `:154`
  `OPENCODE_MIN_VERSION_TEXT = "2.0.29"`. A bump of one without the other gives a message that names the
  wrong version, and the tests assert the literal `"2.0.29"`. Derive the text from the triple.

### m-9: latent PATH split between the gate and the pane (not measured, host state after I-6)

- Today one `opencode` exists on this host (`/home/taisung/.opencode/bin/opencode`, `v2.0.29`): Node and the
  pane agree (see Item 3). After I-6 installs `@opencode/cli` with npm, a second binary lands in
  `~/.nvm/versions/node/v25.7.0/bin`. In the worker `PATH` that directory is entry 4, before
  `~/.opencode/bin` (entry 5), so the Node probe would read the npm binary. In the pane, `~/.bashrc`
  lines 239 and 246 put `~/.opencode/bin` and `~/.local/bin` first, so the pane would run the curl binary.
  A false accept or false refusal is then possible. Prediction from the files, not a run. Put it in the
  I-6 brief (remove the curl binary or make the gate and the pane use one path).

## Item results

### 1. The version gate (built plugin, fake `opencode` first on PATH)

| `opencode --version` prints | `detect()` | `getLaunchCommand` | `getRestoreCommand` |
|---|---|---|---|
| `1.18.35` | false | throws `... (found 1.18.35)` | throws, same text |
| `opencode v2.0.28` | false | throws `(found opencode v2.0.28)` | throws |
| `opencode v2.0.29` | true | ok | ok |
| `2.0.30` | true | ok | ok |
| `2.1.0` | true | ok | ok |
| `10.0.0` | true | ok | ok |
| `2.1.0-beta.1` | true | ok | ok |
| `opencode dev` | false | throws `(found opencode dev)` | throws |
| empty output | false | throws `(opencode not found)` | throws |
| missing binary | false | throws `(opencode not found)` | throws |
| hang (`sleep 8`, then `opencode v2.0.29`) | true after 8006 ms | ok after 8008 ms | ok after 8008 ms |
| extra: `2.0.29-beta.1` | true | ok | ok (m-4) |
| extra: `2.0.28-rc.1` | false | throws | throws |
| extra: version, then exit 3 | false | throws "opencode not found" | throws (m-2) |

Q9 holds (2.0.30, 2.1.0, 10.0.0 accepted; the floor is a minimum). Q6 holds (see Items 2 and 7). No
timeout exists (M-2). `ao start` agent list (`detectAvailableAgents`): real PATH
`claude-code,codex,opencode`; fake `1.18.35` `claude-code,codex`; no `opencode` on PATH `codex`.

### 2. Where the check runs

Callers (grep in `packages/core/src` and `packages/cli/src`, non-test):

- `getLaunchCommand`: `session-manager.ts:1131` (`spawn`, inside the `try`), `:1546` (`spawnOrchestrator`,
  outside the `try`, M-1), `:2548` and `:2550` (`restore`, fallback).
- `getRestoreCommand`: `session-manager.ts:2547`, only in `restore()`. `restore()` has one caller,
  `cli/src/commands/session.ts:384` (`ao session restore <session>`).
- `detect()`: `cli/src/lib/detect-agent.ts:36`, used by `ao start` (`start.ts:184, 394, 554`).
- The lifecycle manager calls none of them. A throw cannot stop a lifecycle worker or another session's
  restore: it ends one CLI command for one session.

| Path | What a throw does | Left behind |
|---|---|---|
| `ao spawn` (`spawn()`) | the `catch` below `:1131`: destroys the worktree, deletes the metadata, rethrows. CLI prints `Failed to create or initialize session` and `ao needs OpenCode 2.0.29 or later (found 1.18.35)`, exit 1 | branch `session/<id>` (m-7). The lifecycle worker that `ensureLifecycleWorker` starts before the spawn (`spawn.ts:222`) keeps running (not new). No pane, no tmux session (checked: `no server running`) |
| `spawnOrchestrator` (`ao start`) | rethrows, no cleanup | reserved empty metadata, worktree, branch, prompt file, phantom `[spawning]` row (M-1) |
| `ao session restore` | `Failed to restore session X: Error: ao needs ...`, exit 1 | old pane destroyed first (m-6); metadata and worktree unchanged |
| `detect()` | returns false, no throw | nothing |

Cost: `opencode --version` takes 0.09 to 0.12 s wall (`/usr/bin/time`, 8 runs) and 89 MB peak RSS; 10 runs
through `execFileSync`: 91 to 118 ms, mean 105 ms. Frequency: 1 per OpenCode worker spawn (1 per issue in
`batch-spawn`), 1 per orchestrator spawn, 1 per `ao session restore` (2 if `getRestoreCommand` returns
null and the code falls back to `getLaunchCommand`), 1 per `detect()` call (`ao start` runs it up to 3
times). Zero for lifecycle polling.

### 3. The PATH

`PATH` read from `/proc/2491708/environ` (`ao lifecycle-worker agent-skills`), no other variable: entries
`~/.local/bin`, `~/bin`, `~/.local/bin`, `~/.nvm/versions/node/v25.7.0/bin`, `~/.opencode/bin`, anaconda,
`.`, scripts dirs, `/usr/...` and others. Scanning every entry: the only `opencode` is
`/home/taisung/.opencode/bin/opencode`; `env -i PATH=<that PATH> sh -c 'command -v opencode;
opencode --version'` prints that path and `opencode v2.0.29`. The pane check: a tmux session on my
isolated server with `-e PATH=<buildAgentPath(PATH)>`, the same call `runtime-tmux` makes, ran
`command -v opencode` in its interactive bash and printed the same path and `opencode v2.0.29`. No false
refusal and no false accept on this host today. The risk after a second install is m-9.

### 4. 2.x behavior unchanged

Baseline `439c16fb` built from `git archive` in a scratch directory; both builds imported and the same 19
cases generated: 16 launch cases (plain, prompt, model, model with variant, provider-less model, subagent,
all three, systemPromptFile with and without a prompt, systemPrompt, and 6 existing-session resume cases
with and without prompt, model, agent, invalid model, all) and 3 restore cases. The baseline value is the
text between `... if [ "${OC_MAJOR:-0}" -ge 2 ]; then ` and `; else <1.x branch>; fi` (or the plain command
where the baseline had no probe).

    SAME x 19, DIFF x 0   ({ same: 19, diff: 0 })

Only the probe and the 1.x branches are gone. The diff of `index.ts` shows no other changed function.

### 5. 1.x text gone

The grep from the brief prints nothing (exit 1). Kept for I-2 and I-4: `parseUpdatedTimestamp`
(`index.ts:38`), `parseSessionList` (`:62`), `findOpenCodeSession` (`:346`). No other `OC_MAJOR`,
`legacy`, `findByTitle`, `buildSessionLookupScript` in the file.

### 6. Tests

- Plugin: `Test Files 1 passed (1)`, `Tests 155 passed (155)`. Typecheck: exit 0.
- Non-vacuity: the new `index.test.ts` copied over the plugin of `439c16fb`: `Tests 24 failed | 131 passed
  (155)`. The 24 are 11 rewritten tests (for example `stores the model in the API body and
  passes no --model to the TUI`) in the launch group (one of them is `holds no version probe`), 1 restore
  test, the 8 `version gate` refusals and the 4 `detect` refusals. The accept cases pass on both, as they
  should.
- Relations: the gate tests assert the relation between the mocked output and the message (the message
  contains the required version and the found text). The shell-run tests execute the generated command
  against a fake CLI and compare the stored body with the config (`body.title` equals `AO:${sessionId}`,
  `modelRefToCli(body.model)` equals the model), which is a relation. The plain `getLaunchCommand` tests
  still assert literal substrings that the source emits; that is the style of the file before the change.
  One test is mis-named (m-5). No test covers a hang, stderr or `2.0.29-beta.1`.
- Removed tests match section 12: the capture and title-sort groups, the 1.x variants and the
  `GENERATIONS` loops (listing the `it(`/`describe(` names of both files shows no other removal).
- Integration file: each rewritten test keeps its intent (subagent, systemPrompt, systemPromptFile, model,
  combined, precedence, orchestrator style, quote and path escaping, special characters, empty prompt,
  newlines, fresh versus existing session). The assertions move from `run --format json ... --command true`
  to `opencode api session.create` and the JSON body, and add `not.toContain("--agent")` and
  `not.toContain("--model")`. The model fixtures change from `claude-sonnet-4-5-20250929` and `gpt-5.2` to
  `opencode-go/...`, which the 2.x path needs. They pass here and fail elsewhere (B-1).
- Skips: `Test Files 11 passed | 2 skipped (13)`, `Tests 101 passed | 15 skipped (116)`, the same as
  the baseline run of `439c16fb` on this host. The 15 are Claude and Codex tests that need the `claude` or
  `codex` binary and an API key: `agent-codex` 5, `prompt-delivery` 4, `agent-claude-code` 6 (of 10). None
  is an OpenCode test: `agent-opencode.integration.test.ts` shows 28 passed, 0 skipped on both. Full
  `pnpm test`: core 639, cli 231, agent-opencode 155, integration 101 passed, all packages exit 0.
- `pnpm lint`: `✖ 6 problems (0 errors, 6 warnings)`; the `index.ts:368` warning is in the unchanged
  `findOpenCodeSession`. `pnpm typecheck`: exit 0. `prettier --check` flags `index.ts` and `index.test.ts`,
  and flags the same two files at `439c16fb`, so it is not new.

### 7. Live, isolated

Setup: worktree build, `AO_STATE_ROOT` under the session scratch directory in `/tmp`, scratch git
repository with a bare `origin`, scratch config (project `scratch`, prefix `zzrevsonnet`), isolated tmux
server through a `tmux` wrapper that runs `tmux -L aorevsonnet<n>`, `TMUX` unset.

- Real 2.0.29: `ao spawn --agent opencode` printed `Session zzrevsonnet-1 spawned`, exit 0. The pane
  showed the TUI header `AO:zzrevsonnet-1` and `Build · Muse Spark 1.3 Contributor OpenCode Go`. Metadata
  `status=spawning`, `agent=opencode`, `promptDelivered=true`. The base prompt started a model turn on the
  flat plan (13.2K tokens, $0.00); I stopped the TUI at once.
- Restore on real 2.0.29 (killed agent, session mapped by ID): `Session zzrevsonnet-1 restored.`, exit 0;
  the new pane ran `opencode --session ses_ec276b50effeHw80AtEq76BEk5` and showed the same session.
- Fake `1.18.35` first on PATH: `ao spawn --agent opencode` printed `Failed to create or initialize
  session` and `ao needs OpenCode 2.0.29 or later (found 1.18.35)`, exit 1, no tmux server and no pane,
  metadata deleted, worktree removed, branch left (m-7). `ao session restore` and `spawnOrchestrator`
  results are in m-6 and M-1.
- OpenCode session created: `ses_ec276b50effeHw80AtEq76BEk5` (title `AO:zzrevsonnet-1`). Removed at the
  end with `opencode api session.remove --param sessionID=ses_ec276b50effeHw80AtEq76BEk5`; the project's
  `opencode session list` then showed 0 sessions. No other session was read, prompted or changed.
- Cleanup: my isolated tmux server killed and its socket removed; my `lifecycle-worker scratch` (PID
  3439679, started by my `ao spawn`) and the agent's orphan `bash -c 'for i in ...'` loop (PID 3447425)
  stopped by PID; three scratch worktrees under `~/.worktrees/scratch/` removed with `git worktree remove`;
  the scratch repo, state and fakes deleted. Processes of other agents (a `lifecycle-worker scratch` from
  `ao-5` and `ao-10`) were left alone. `~/.ao/bin` was not rewritten (`.ao-version` equals
  `WRAPPER_VERSION` 0.2.1).

### 8. Scope

- `git diff --stat 439c16fb ed77d5fc`: 3 files, `index.ts` (237), `index.test.ts` (562),
  `agent-opencode.integration.test.ts` (53).
- Commits: `refactor(agent-opencode): drop OpenCode 1.x and require 2.0.29 or later` and
  `test(integration): assert the 2.x-only OpenCode launch command`. Both bodies state the WHY. No
  `Co-Authored-By`, no emoji (checked on the diff), no issue number. `git diff --check`: clean.
- `git branch -r --contains ed77d5fc` prints nothing. Nothing pushed.
- The plan row I-1 lists a plugin CHANGELOG; the brief and recent fork commits use none (no
  `.changeset/*.md` in the history of the fork commits). Not a finding.

## Checked and found correct

- The numeric compare: `v2.0.28`/`1.18.35` refused, `v2.0.29`, `2.0.30`, `2.1.0`, `10.0.0` accepted; a huge
  minor (`2.99999999999999999999.0`) is refused by the safe-integer guard.
- A refused `ao spawn` exits 1 with a message that names `2.0.29` and the found text, before any pane.
- `detect()` hides OpenCode on 1.x, on a below-floor 2.x and on a missing binary (Q6).
- The generated 2.x launch, resume and restore commands are byte-identical to the 2.x branch of `439c16fb`.
- The lifecycle worker never calls `getLaunchCommand`, `getRestoreCommand` or `detect()`, so the gate adds
  no cost to polling.
- The grep for 1.x text is empty and the I-2/I-4 functions remain.
- 24 of the 155 plugin tests fail against the old source; the 15 skips equal the baseline and are not
  OpenCode tests.
- Real 2.0.29 spawn and restore work on the isolated server, with the TUI opened on `AO:<id>`.
- Only the three files changed; commit messages meet the rules; nothing is on a remote.
- The primary checkout was not built in or written to by me (its `git status` shows ` D
  test-ao-config2.yaml`, which I did not touch).

## Reproducers (all in the worktree; fakes are small `#!/bin/sh` scripts that print one line)

- B-1: `cd packages/integration-tests && PATH=<node bin>:/usr/bin:/bin ./node_modules/.bin/vitest run
  src/agent-opencode.integration.test.ts` (14 fail); repeat with a fake `opencode` printing `1.19.0`.
- M-1: scratch config; fake `opencode` printing `1.18.35` first on PATH; script that loads
  `packages/cli/dist/lib/create-session-manager.js` and calls `sm.spawnOrchestrator`; then `ls
  $AO_STATE_ROOT/*/sessions`, `git branch --list 'orchestrator/*'`, `ao session ls`.
- M-2: fake `opencode` with `sleep 8` then the version; time `detect()`, `getLaunchCommand`,
  `getRestoreCommand` from `packages/plugins/agent-opencode/dist/index.js`.
- m-6: spawn on 2.0.29, `tmux set-option remain-on-exit on`, stop the TUI child, set a fake `1.18.35`
  first on PATH, `ao session restore <id>`, then `tmux ls`.
