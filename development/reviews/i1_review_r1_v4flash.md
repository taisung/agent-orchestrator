# I-1 blind review, round 1 — drop OpenCode 1.x and require 2.0.29 (`439c16fb..ed77d5fc`)

Reviewer: DeepSeek V4.1 Flash. Worktree at `ed77d5fc`, `git log --oneline -1` confirms it. No tracked file
edited, nothing committed or pushed. Range is two commits over exactly three files
(`packages/plugins/agent-opencode/src/index.ts`, `index.test.ts`,
`packages/integration-tests/src/agent-opencode.integration.test.ts`). I formed my view of items 1–4 before
reading the author report at `ao-5/.agent_report.md`.

## Verdict

**NOT-LAND-SAFE**

One blocker: the new Node-side version gate turns the otherwise self-contained
`getLaunchCommand (integration)` block into a test that requires a host `opencode >= 2.0.29`, and the CI
`Test` job installs no `opencode`, so the job goes red. Two majors follow (orchestrator-path leftovers, no
probe timeout), plus minors.

---

## B-1 (blocker) — the version gate breaks the CI `Test` job

The gate runs in process (`packages/plugins/agent-opencode/src/index.ts:222`, called at `:401`), and it calls
`execFileSync("opencode", ["--version"])` (`index.ts:203`). The integration file's
`describe("getLaunchCommand (integration)")` block (`packages/integration-tests/src/agent-opencode.integration.test.ts:184`)
is explicitly **not** guarded by the file's prerequisite gate (`canRun`, `:100`, guards only the lifecycle
block at `:106`) and its own comment claims "Launch command tests (no external dependencies)" (`:180-182`).
After this change every one of those 14 tests calls the real `getLaunchCommand`, hence a real `opencode`.

CI `Test` (`pushed: .github/workflows/ci.yml`) runs `pnpm build && pnpm test` = `pnpm -r test` with **no
`opencode` installed** (the only install of `opencode-ai` is in the separate `integration-tests.yml` job).
`@aoagents/ao-integration-tests` is in the workspace (`pnpm -r list` shows it), so the job runs that package.

Evidence — same file, `opencode` hidden vs present on `PATH`, HEAD (`ed77d5fc`):

```
$ PATH="/usr/bin:/bin:$NODE_BIN" node_modules/.bin/vitest run --config vitest.config.ts src/agent-opencode.integration.test.ts
 Test Files  1 failed (1)
      Tests  14 failed | 9 passed | 5 skipped (28)

$ PATH="/home/taisung/.opencode/bin:/usr/bin:/bin:$NODE_BIN" node_modules/.bin/vitest run ... -t getLaunchCommand
 Test Files  1 passed (1)
      Tests  14 passed | 14 skipped (28)
```

Same file at the base commit `439c16fb` in a scratch build, `opencode` hidden:

```
$ PATH="/usr/bin:/bin:$NODE_BIN" node_modules/.bin/vitest run --config vitest.config.ts src/agent-opencode.integration.test.ts
 Test Files  1 passed (1)
      Tests  23 passed | 5 skipped (28)
```

So the base passes with no `opencode`; HEAD fails 14 tests. Reproducer for the failure message:

```
 FAIL  ... > getLaunchCommand (integration) > uses --session when existing OpenCode session id is provided
 Error: ao needs OpenCode 2.0.29 or later (opencode not found)
  ❯ assertSupportedOpenCodeVersion ../plugins/agent-opencode/src/index.ts:225:9
  ❯ Object.getLaunchCommand ../plugins/agent-opencode/src/index.ts:401:7
```

It passes on this host only because this host has `opencode v2.0.29` on `PATH` (see item 3). The author's
report itself notes the block "runs against the built plugin with the real `opencode --version`"; it does not
follow that this makes the unguarded block CI-dependent. Fix: guard the block with the same `skipIf` used for
the lifecycle block (or stub `--version`), or move the pure string assertions off the gated path.

## M-1 (major) — a refused host leaves the orchestrator's worktree, branch, metadata and prompt file behind

`assertSupportedOpenCodeVersion` is called at the top of both `getLaunchCommand` and `getRestoreCommand`. The
`spawn` caller is inside a `try` (`packages/core/src/session-manager.ts:1131`, catch `:1150-1168`) that
destroys the workspace, deletes the reserved metadata and rethrows, so an explicit `ao spawn` cleans up — the
commit body's claim holds for `spawn`. But `spawnOrchestrator` calls `getLaunchCommand` **outside any `try`**
(`session-manager.ts:1546`); the cleanup helper is only invoked at `:1500`, `:1524` and `:1569`, none of which
covers `:1546`. This is the path `ao start` uses (`packages/cli/src/commands/start.ts:877`, whose catch
`:883-889` only rethrows).

Reproducer (this worktree's build, isolated `AO_STATE_ROOT`, scratch config, fake `opencode` printing
`1.18.35` first on `PATH`, calling `spawnOrchestrator` via the built core):

```
THREW: ao needs OpenCode 2.0.29 or later (found 1.18.35)
leftovers under state3:
  ST/071c5aa981e7-repo/sessions/scr-orchestrator-1          (reserved metadata, still present)
  ST/071c5aa981e7-repo/orchestrator-prompt-scr-orchestrator-1.md
git worktree/branches:
  /home/taisung/.worktrees/scratch/scr-orchestrator-1  [orchestrator/scr-orchestrator-1]
  * main
  + orchestrator/scr-orchestrator-1
```

Contrast with `spawn`, where the same refused run removed the worktree and the metadata (only the git branch
`session/scr-1` survived, as the author already reported). Reachable when a project (or an existing
orchestrator selection) names `opencode` while `detect()` is now hiding it. The message says 1.x is refused by
owner decision; leaving an orphan worktree + branch + metadata + prompt file is not part of that decision.

## M-2 (major) — the probe has no timeout; a hanging `opencode --version` blocks `ao spawn`, `detect()` and restore indefinitely

`execFileSync("opencode", ["--version"], { encoding: "utf-8" })` (`index.ts:203`) passes no `timeout`, and the
`try/catch` only converts a thrown error to `null` — it cannot interrupt a process that never exits.

Evidence (fake `opencode` = `#!/bin/sh; sleep 3600`):

```
$ timeout 6 env PATH="$PWD/cases/hang:$PATH" node detect-only.mjs ; echo $?
124        # killed by timeout; detect() had not returned
$ timeout 5 env PATH="$PWD/cases/hang:$PATH" node harness.mjs ; echo $?
124        # same for getLaunchCommand/getRestoreCommand
```

`detect()` already had this exposure before I-1 (`execFileSync` in the old `detect`), but I-1 newly puts the
probe on the synchronous `getLaunchCommand`/`getRestoreCommand` path, so a hung binary now hangs an explicit
`ao spawn` and `ao session restore` too, with no bound. A timeout (e.g. 5 s) would convert this into the same
refusal path. Not covered by any test.

## m-1 (minor) — empty output is reported as a missing binary

`readOpenCodeVersionOutput` returns `null` both when the binary is absent and when it prints only whitespace
(`index.ts:201-209`), and `buildUnsupportedVersionMessage` maps `null` to `"opencode not found"`
(`index.ts:211-214`). A present-but-empty binary therefore prints
`ao needs OpenCode 2.0.29 or later (opencode not found)`, which misdirects. The unit test only asserts the
message contains `2.0.29` (`index.test.ts` version-gate "refuses empty --version output").

## m-2 (minor) — restore destroys the old runtime before the gate runs

In `restore`, the old runtime is destroyed at `session-manager.ts:2518-2524` before `getRestoreCommand` is
called at `:2546-2551`. On a refused host the throw therefore arrives after the live pane has already been
torn down, and `restore` fails without reopening it. Callers: `ao send` via `restoreForDelivery`
(`session-manager.ts:2130`) and `ao session restore` (`packages/cli/src/commands/session.ts:384`, prints
`Failed to restore session <x>: ...` and exits 1). Narrow in practice (`send` only restores a restorable
session; `restore` destroys the runtime regardless), but the gate would be cheaper earlier in `restore`.

## m-3 (minor) — two probes on a restore that falls back

`getRestoreCommand` probes once (`index.ts:623`); if it returns `null`, the caller falls back to
`getLaunchCommand` (`session-manager.ts:2548`), which probes again (`index.ts:401`). Each probe is ~110 ms on
this host (measured), so a fallback restore pays it twice. Cosmetic.

## Item-by-item results

### 1. The version gate

Built behavior (`execFileSync` on the resolved `opencode`), one line each — `detect()` / `getLaunchCommand()`:

| input | detect | launch |
|---|---|---|
| `1.18.35` | false | throws `(found 1.18.35)` |
| `opencode v2.0.28` | false | throws `(found opencode v2.0.28)` |
| `opencode v2.0.29` | true | OK |
| `2.0.30` | true | OK |
| `2.1.0` | true | OK |
| `10.0.0` | true | OK |
| `2.1.0-beta.1` | true | OK (numeric core) |
| `opencode dev` | false | throws `(found opencode dev)` |
| empty output | false | throws `(opencode not found)` |
| missing binary | false | throws `(opencode not found)` |
| hanging binary | blocks | blocks, no timeout (see M-2) |

Extra probes: `2` → false, `2.0` → false, `1.2.0` → false. The gate matches the owner's Q9 minimum and Q6
(`detect()` false on refusal; explicit spawn throws naming the version). A hanging `opencode --version`
blocks `ao spawn`, `detect()` and the restore path; there is no timeout (M-2).

### 2. Where the check runs, and what a throw leaves behind

- `spawn` — `session-manager.ts:1131`, inside the `try` whose catch (`:1150-1168`) destroys the workspace,
  deletes reserved metadata and rethrows; `ao spawn` exits nonzero with the message and no TUI. Leftover: the
  git branch (workspace destroy semantics), metadata and worktree removed — matches the author's A1 note.
- `spawnOrchestrator` — `session-manager.ts:1546`, no `try`; leftovers are M-1.
- `restore` — `session-manager.ts:2546-2551`; the old runtime is already destroyed at `:2518-2524` (m-2).
  No lifecycle-worker path calls `restore` (`grep restore lifecycle-manager.ts` → no matches), so a throw
  here cannot stop a lifecycle worker; it can only affect that one session's own restore.
- Cost of one `opencode --version` on this host: 111/110/112 ms over three runs. `getLaunchCommand` runs it
  once; `getRestoreCommand` once (twice on fallback, m-3); `detect()` once per `detectAvailableAgents` pass.

### 3. The PATH

From `/proc/2514414/environ` (a running `ao lifecycle-worker agent-orchestrator`), the `PATH` value resolves:

```
/home/taisung/.opencode/bin/opencode
opencode v2.0.29
```

That is the only `opencode` on that `PATH` (three duplicate directories, same binary), and my interactive
shell resolves the same path/version. `getEnvironment` prepends only the `~/.ao/bin` wrappers
(`buildAgentPath`), so on this host the Node probe and the pane agree — no false refusal or false accept from
PATH divergence here. (The `PATH` does contain `.` and many duplicates, a general hygiene issue, not specific
to I-1.)

### 4. 2.x behavior unchanged

Compared this worktree's build against a clean `439c16fb` build (scratch worktree under `/tmp`) by executing
each generated command against a fake 2.0.29 CLI and diffing the call logs (the base probe call filtered):

```
fresh:   IDENTICAL   (session.create -> session.get readback -> exec opencode --session <id> --prompt ...)
resume:  IDENTICAL   (switchModel -> switchAgent -> session.get -> exec opencode --session <id> --prompt ...)
restore: IDENTICAL   (switchModel -> session.get -> exec opencode --session <id>)
```

The base additionally runs one `opencode --version` in the pane; HEAD runs it in Node instead. Only the probe
and the 1.x branches are gone, as required.

### 5. 1.x text gone

```
$ grep -n -E "run --format json|--command true|OPENCODE_MAJOR|branchOnOpenCodeMajor|buildLegacySessionOptions|buildSessionIdCaptureScript" packages/plugins/agent-opencode/src/index.ts
(no output, exit 1)
```

The only remaining occurrence of that vocabulary anywhere in the plugin dir is a negation assertion in the
test (`expect(cmd).not.toContain("run --format json")`). Functions kept for I-2/I-4 are still present:
`parseUpdatedTimestamp` (`:38`), `parseSessionList` (`:62`), `findOpenCodeSession` (`:346`).

### 6. Tests

- Non-vacuity: running the new `index.test.ts` against the `439c16fb` `index.ts` in a scratch copy fails 24
  of 155 (8 version-gate, 4 detect, 12 rewritten getLaunchCommand/getRestoreCommand). So the tests exercise
  the new behavior, not a copy of it.
- Relation-style: the rewritten assertions check the `session.create` body (`"title"`, `"agent"`,
  `"providerID"`/`"id"`), the absence of `--model`/`--agent`, and the TUI call — relations, not just copies.
- The rewritten integration tests keep intent: position-by-position the old `--agent 'x'`/`--model`/`run
  --format json` assertions became body/flag-absence assertions (e.g. `"generates correct command with
  subagent"`, `"combines subagent + systemPrompt + model + prompt"`, `"uses --session when existing ..."`),
  and the providerless case moved to the unit tests as the author says. But see B-1: the block lost its
  "no external dependencies" property.
- 15 skipped, unchanged: package run is `101 passed | 15 skipped`. The 15 are `prompt-delivery` (4),
  `agent-codex` (5), `agent-claude-code` (6) — all in files this diff does not touch, so identical to base.
  `agent-opencode.integration.test.ts` itself runs all 28 here (the lifecycle block is not skipped on this
  host because `canRun` is true).

### 7. Live, isolated

Isolated tmux server (`tmux -L ao10review` via a wrapper, since the tmux runtime takes no `-L`),
`AO_STATE_ROOT` and scratch config/repo under `/tmp`.

- Real 2.0.29: `ao spawn --agent opencode` printed `Session scr-1 spawned`, exit 0. The pane showed the title
  `AO:scr-1` and `Build · Muse Spark 1.3 Contributor OpenCode Go`. The created OpenCode session was
  `ses_ec278c480ffeG1Ru84TeIz9DsC` (title `AO:scr-1`, directory = the worktree). Removed it with
  `opencode api session.remove --param sessionID=ses_ec278c480ffeG1Ru84TeIz9DsC`; a follow-up `session.list`
  reports REMOVED.
- Refusal: fake `opencode` printing `1.18.35` first on `PATH`:

```
- Creating session
✖ Failed to create or initialize session
✗ ao needs OpenCode 2.0.29 or later (found 1.18.35)
SPAWN_EXIT=1
# isolated `tmux -L ao10review list-sessions` -> no server running
```

  No pane, exit nonzero, message names the version. All of my `/tmp` state, the isolated tmux server, the
  lifecycle worker I started (PID 3411409) and my two scratch worktrees/branches were removed; a pre-existing
  `ao-5`/`ao-9` `lifecycle-worker scratch` and an unrelated `~/.worktrees/scratch/zzrevsonnet-1` were left
  untouched.

### 8. Scope

```
$ git diff --name-status 439c16fb ed77d5fc
M  packages/integration-tests/src/agent-opencode.integration.test.ts
M  packages/plugins/agent-opencode/src/index.test.ts
M  packages/plugins/agent-opencode/src/index.ts
```

Two conventional commits (`refactor(agent-opencode): ...`, `test(integration): ...`), WHY in the bodies, no
`Co-Authored-By`, no emoji, no issue number. `git branch -r --contains ed77d5fc` prints nothing.

## Commands and summary lines from this worktree

```
pnpm install --frozen-lockfile            ok (dev deps installed)
pnpm build                                ok (all 14 packages)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck   ok (no errors)
pnpm --filter @aoagents/ao-plugin-agent-opencode test        Tests 155 passed (155), Test Files 1 passed
pnpm --filter @aoagents/ao-integration-tests test            Tests 101 passed | 15 skipped (116), Test Files 11 passed | 2 skipped
pnpm lint                                 ✖ 6 problems (0 errors, 6 warnings) — all pre-existing
                                          (index.ts:368 is unchanged findOpenCodeSession; others in
                                          core/cli files not in the diff)
```

## What I checked and found correct

- The version floor is a numeric minimum (`2.0.29`), not a major pin: later 2.x, later majors
  (`10.0.0`) and a pre-release past the floor (`2.1.0-beta.1`) are accepted; `1.18.35`, `2.0.28`,
  `2.0`/`2`/`1.2.0`, `opencode dev` and empty output are refused.
- `detect()` returns false on refusal, matching Q6; the refusal message names `2.0.29`.
- The `spawn` path cleans up on refusal (workspace + metadata); only the git branch survives.
- 2.x new-session, resume and restore command behavior is unchanged versus a clean `439c16fb` build.
- The 1.x vocabulary is gone from the plugin source; the kept helper functions remain.
- The rewritten plugin tests are non-vacuous (24 fail against the old source).
- Two commits, three files, conventional messages, no co-author/issue/emoji, branch not pushed.
- The live isolated spawn opens the TUI on `AO:scr-1` on the real 2.0.29; the fake 1.18.35 spawn fails with
  the message, exits 1 and creates no pane.
