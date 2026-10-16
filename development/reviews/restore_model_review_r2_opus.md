# Restore follow-ups review, round 2: `972f13ef..6088fc6b`

Reviewer: Claude Opus 5.5 (ao-32), the round-1 reviewer. Date: 2026-10-15.
Author: Muse (OpenCode, ao-30). Worktree HEAD: `6088fc6b fix(core): use the spawn permission mode on restore`.
Range: one commit, 5 files, `226 insertions(+), 16 deletions(-)`.

**Verdict: LAND-SAFE**

All four round-1 items that this commit acts on are fixed: N-2, m-1, m-2 and m-3. I found 0 blockers,
1 major (M-1), 3 new minor findings (m-4 to m-6) and 4 notes (N-6 to N-9).

- M-1 is a test gap, not a code defect. No test guards the Claude Code restore permission flag. A
  Claude restore that always adds `--dangerously-skip-permissions` passes every test. The code is
  correct: I checked it live against the base for all three plugins that read a permission mode. Add
  the two tests of M-1 with this landing or right after it.
- N-6 is a process issue outside the commit: 4 lifecycle workers from the author's live runs are still
  running. The orchestrator must stop them by PID (section 7).

Scale (same as round 1): B = the landed code behaves wrongly or unsafely. M = a verified gap that
lets a regression pass. m = polish, an unstated change, or a low-probability risk.

## 1. How I ran everything (section 0)

- Every `pnpm` command ran under `env -i HOME=<scratch>/home PATH=<scratch>/bin:/usr/bin:/bin`: no
  `AO_*`, no `TMUX`. The scratch `bin` held a `tmux` shim (`unset TMUX; exec /usr/bin/tmux -L <label>`),
  a `gh` stub, a `node` symlink, a `pnpm` wrapper, and fake `claude`, `codex`, `gemini` and `opencode`
  that log their arguments and `exec sleep 3600`.
- The fake `claude` writes `$HOME/.claude/projects/<encoded cwd>/<uuid>.jsonl` on a fresh launch, so
  the plugin's `--resume` path runs. The fake `codex` writes a rollout file with its `--model`. For
  Gemini I made `$HOME/.gemini/tmp/fake-project`, so `hasGeminiSessions()` is true.
- One fake `HOME` and one private tmux server per build (`-L ao32r2-head`, `-L ao32r2-base`). The first
  `ao spawn` started each server through the shim from the scratch environment. Before the first live
  check I read `/proc/<pid>/environ` of the server (3796183), the pane shell (3796184) and the pane
  child (3796194): `HOME=<scratch>/live-head/home`, first `PATH` entry `<scratch>/bin`, for all three.
- Base copies: `git archive 972f13ef | tar -x` and `git archive 854690c3^ | tar -x`, each with its own
  offline install. No `git stash`, no `git worktree add`.
- I did not run `ao start`, because it has `npm install -g` paths and `/usr/bin/npm` exists. For an
  orchestrator I called the real `sm.spawnOrchestrator()` through the CLI's own factory
  (`packages/cli/dist/lib/create-session-manager.js`, `getSessionManager(loadConfig())`) from a scratch
  script. No model turn anywhere.
- For M-1 I used a third scratch copy (`git archive 6088fc6b`, offline install, core build) and changed
  plugin lines only there.

## 2. Command summaries (my own runs, in my worktree at `6088fc6b`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0, `Done in 1.2s` |
| `pnpm build` | exit 0, last line `packages/cli build: Done` |
| `pnpm --filter <core + 4 agents> test` | core `Test Files 35 passed (35)` / `Tests 824 passed (824)` (`restore-permissions.test.ts (10 tests)`, `restore-model.test.ts (9 tests)`); claude-code `3 passed (3)` / `170 passed (170)`; codex `3 passed (3)` / `212 passed (212)`; gemini `1 passed (1)` / `60 passed (60)`; opencode `1 passed (1)` / `162 passed (162)` |
| `pnpm --filter <core + 4 agents> typecheck` | exit 0, 5 x `typecheck: Done` |
| `pnpm typecheck` (full) | exit 0, 13 x `typecheck: Done` |
| `pnpm lint` | `✖ 5 problems (0 errors, 5 warnings)`, the same 5 old warnings as round 1 |
| `pnpm test` (full, fake HOME) | exit 0. Integration `Test Files 10 passed \| 3 skipped (13)` / `Tests 95 passed \| 24 skipped (119)`; `agent-opencode.integration.test.ts (31 tests \| 5 skipped)`; cli `19 passed (19)` / `243 passed (243)`; all other packages pass |
| `restore.test.ts` (I-2 restore order) | `Tests 24 passed (24)` |
| OpenCode `getRestoreCommand` block | `Tests 7 passed \| 155 skipped (162)`, both refusals included |

Non-vacuity:

| Tests | Sources | Result |
|---|---|---|
| `restore-permissions.test.ts` + `restore-model.test.ts` | `972f13ef` | `Tests 6 failed \| 13 passed (19)`. The 6 failures are case (a) and case (b) for each of the 3 styles. The 3 "agree" guards, the m-1 test and all 9 model tests pass. |
| m-1 test (`-t "role model"`) | `23955f9a` (`854690c3^`) | `Tests 1 failed \| 9 skipped (10)`: `expected "vi.fn()" to be called with arguments: [ Anything, Anything, …(1) ]` |
| m-3 test, only the `toContain` assertion, new mock | `972f13ef` with core mutated to pass `"wrong-model"` | fails: `expected 'mock-agent --resume --model wrong-mod…' to contain 'spawn-model-X'` |
| the same, with the old `854690c3` fixed-literal mock | the same mutant | passes (`Tests 1 passed \| 8 skipped (9)`), which was the round-1 defect |

The m-1 and m-3 tests pass on `972f13ef` by design. `854690c3` already made that behaviour. They are
regression guards, and the two mutation runs show that they can fail.

## 3. Live evidence

### Case (a): shared `permissions: permissionless`, `worker.agentConfig.permissions: default`, shared `model: shared-model`

| Agent | Spawn argv (both builds) | Restore, `6088fc6b` | Restore, `972f13ef` |
|---|---|---|---|
| claude-code (`ao spawn --agent claude-code`) | `[--model] [shared-model]` | `[--resume] [11111111-...] [--model] [shared-model]` | `[--resume] [11111111-...] [--dangerously-skip-permissions] [--model] [shared-model]` |
| codex (`--model gpt-spawn-x`) | `[-c] [check_for_update_on_startup=false] [--model] [gpt-spawn-x] [--] [...]` | `[resume] [-c] [check_for_update_on_startup=false] [--model] [gpt-spawn-x] [thread-fake-1]` | `[resume] [-c] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [gpt-spawn-x] [thread-fake-1]` |
| gemini (`ao spawn --agent gemini`) | `[-m] [shared-model] [-p] [...]` | `[-m] [shared-model] [-r] [latest]` | `[--yolo] [-m] [shared-model] [-r] [latest]` |

In each case the base restore adds a permission flag that the spawn did not have, and the head
restore has the same mode as the spawn. Each restore went through `ao session kill` and then
`ao session restore` (the archive path).

### Case (b): shared `permissions: default`, orchestrator through `sm.spawnOrchestrator()`

| Step | `6088fc6b` | `972f13ef` |
|---|---|---|
| metadata | `agent=claude-code role=orchestrator`, ID `demo-orchestrator-1` | same |
| spawn argv | `[--dangerously-skip-permissions] [--model] [shared-model] [--append-system-prompt] [...]` | same |
| kill + restore argv | `[--resume] [11111111-...] [--dangerously-skip-permissions] [--model] [shared-model]` | `[--resume] [11111111-...] [--model] [shared-model]` (skip flag lost) |

## 4. Status of the round-1 items

| Item | Status | Evidence |
|---|---|---|
| N-2 (permissions from the raw config) | **Fixed** | `session-manager.ts:2838-2847` passes `{ ...project, agentConfig: agentLaunchConfig.projectConfig.agentConfig }`. Live: case (a) for 3 plugins and case (b), section 3. Core tests fail on the base. OpenCode reads no permission mode (the only match of "permission" in `agent-opencode/src/index.ts` is a comment at `:504`). |
| m-1 (role model not stated, no test) | **Fixed** | The commit body names the behaviour change of `854690c3`. The test `restore-permissions.test.ts:160-202` fails on `23955f9a` and passes on `972f13ef`. |
| m-2 (new lines not in Prettier style) | **Fixed** | I computed the Prettier diff of each file of `854690c3` and intersected it with that commit's hunks. On `972f13ef` the intersection is exactly the round-1 lines (`restore-model.test.ts` 6-11 and 225-227, claude-code 887-888, codex 661-663). On `6088fc6b` it is empty for all 12 files. The plugin diffs are formatting only (`git diff -w` shows the same tokens). `restore-permissions.test.ts` and `session-manager.ts` pass `--check`. The two plugin files still fail only on old lines (claude-code 313, 332, 481; codex 129, 338, 433). |
| m-3 (assertion on a mock literal) | **Fixed** | `restore-model.test.ts:217-219` builds the command from `effectiveModel`. Mutation evidence in section 2. |

## 5. Review items

### 5.1 / 5.2 Both cases, every restore path

Every relaunch of an existing session still goes through `restore()` (round-1 section 4.1): `ao session
restore`, `send()` -> `restoreForDelivery` (CLI `ao send` to a dead or non-tmux session, lifecycle
reactions, `ao review-check`), and the archive path. All of them get the same `restoreProject`.

For an orchestrator the restore now forces `permissionless`, as the spawn does. `spawnOrchestrator`
sets it with no condition (`:1778` in `agentConfig`, `:1782` top level). So, for every record that
`spawnOrchestrator` made, the restore grants nothing that the spawn did not grant. See N-8 for the role
input.

### 5.3 The design: every key in `project.agentConfig` that changes

`restoreProject` differs from the raw `project` only in `agentConfig`. The new `agentConfig` is the one
the restore fallback launch already used (`:2814-2830`): `selection.agentConfig` (shared keys, then the
defined role keys, the effective `model`, the normalized `permissions`), the orchestrator override, and
`opencodeSessionId` from the metadata. No shared key is lost; a role key wins only where it is defined
(`agent-selection.ts:60-64`).

What each `getRestoreCommand` reads from `project`:

| Plugin | Reads | Change |
|---|---|---|
| claude-code `:879`, `:887` | `agentConfig.permissions`, `agentConfig.model` | permissions now role-merged and orchestrator-forced; model now effective |
| codex `:653`, `:661` | `agentConfig.permissions`, `agentConfig.model` | same |
| gemini `:251`, `:259` | `agentConfig.permissions`, `agentConfig.model` | same |
| opencode `:669-675` | `agentConfig.model` | model now effective; `opencodeSessionId` is read from `session.metadata` (`:650`), not from `agentConfig` |

No plugin reads `subagent`, `orchestratorModel`, `opencodeSessionId` or another key from
`project.agentConfig` in `getRestoreCommand`. The spawn reads the permission mode from the top-level
`config.permissions` (claude-code `:675`, codex `:357`, gemini `:100`), which is `selection.permissions`
or the forced value. The restore reads `agentConfig.permissions`. Both hold the same normalized value
(`agent-selection.ts:78-83`). So no key is now different from the spawn, and none is lost, unless the
config changed after the spawn (m-6).

The third argument is still consistent: I ran `resolveAgentSelection` over 64 combinations (2 roles x 4
shared configs x 4 role configs x with or without a spawn model). `selection.model ===
selection.agentConfig.model` in all 64. So `effectiveModel` is now redundant for the retained plugins
(N-7).

### 5.4 m-1 to m-3

See section 4.

### 5.5 No collateral change

- The diff touches only the `getRestoreCommand` call in `session-manager.ts`, the formatting of two
  plugin lines, and the core tests. No I-2 file, no `~/.ao/bin` PATH code, no `agent-selection.ts`, no
  `types.ts`.
- The model rule of `854690c3` is unchanged: the persisted model still wins (live, Codex
  `gpt-spawn-x` on both builds), and the model tests pass.
- `restoreProject` is built inside step 5, before the archive copy, the workspace restore and the old
  runtime destroy. `restore.test.ts` passes 24/24, including "keeps the old runtime when
  getRestoreCommand throws" and "destroys the old runtime only after the restore command is ready".
  The OpenCode refusals (no stored ID, 404) pass.

### 5.6 Tests

See section 2. The core tests assert behaviour at the core boundary (what core passes and what the
runtime gets). The N-2 tests do it through a mock that copies the plugin flag mapping (m-5). For
Claude Code, no test checks the real restore mapping (M-1, shown by mutation).

### 5.7 Scope and commit

- The 5 files are all in the brief's section 3 list.
- Message `fix(core): use the spawn permission mode on restore`, with the WHY. `%(trailers)` is empty:
  no `Co-Authored-By`. No emoji, no issue number.
- `git branch -r --contains 6088fc6b` prints nothing.

## 6. New findings

### M-1: No test guards the Claude Code restore permission flag

Files: `packages/plugins/agent-claude-code/src/index.ts:879-882` (the mapping) and
`packages/plugins/agent-claude-code/src/index.test.ts:1136-1184` (the only `getRestoreCommand` block; it
tests the model only).

The N-2 fix rests on two links: core passes the role-merged `project.agentConfig`, and each plugin maps
`project.agentConfig.permissions` to its flag. The core tests check the first link through a mock that
copies the mapping (m-5). The plugin tests must check the second link. Codex and Gemini have restore
tests with permission modes. Claude Code, the default agent and the agent of case (a), has none.

Reproducer (mutation in a scratch copy of `6088fc6b`, `git archive` + offline install):

| Mutant | claude-code tests | core `session-manager/` tests |
|---|---|---|
| `index.ts:881` removed (restore never adds the skip flag) | `Tests 170 passed (170)` | `Tests 255 passed (255)` |
| `:880-881` changed so the restore always adds `--dangerously-skip-permissions` (the case (a) escalation) | `Tests 170 passed (170)` | not affected (mocks) |
| for comparison, codex `:653` changed to `appendApprovalFlags(parts, "permissionless")` | codex: `Tests 2 failed \| 210 passed (212)` | |
| for comparison, gemini `:251` changed to always add `--yolo` | gemini: `Tests 4 failed \| 56 passed (60)` | |

The gap is older than this commit, but this commit is the fix that depends on it, and brief D1 asked for
tests "for each plugin that reads a permission mode".

Action: add two tests to the Claude Code `getRestoreCommand` block: `agentConfig.permissions:
"default"` gives no `--dangerously-skip-permissions`; `"permissionless"` (and `"auto-edit"`) gives it.
The setup of the existing tests at `:1150-1158` (a mocked `readdir` and `stat`) is enough.

### m-4: The JSDoc of `getRestoreCommand` does not say that `project` is now the role-merged project

File: `packages/core/src/types.ts:358-370`.

Core now passes the restore launch project, not the raw `ProjectConfig`, as the second argument. The
JSDoc still describes only `effectiveModel` and tells plugins to prefer it over
`project.agentConfig.model`. These are now the same value (section 5.3). An external implementer
(round-1 N-5) cannot learn from the interface that `project.agentConfig.permissions` is role-merged and
orchestrator-forced. The brief asked for a JSDoc update only if the interface changes; the signature
did not change, but the meaning of the argument did.

Reproducer: read `types.ts:358-365`, then `session-manager.ts:2833-2847`.

Action: add one sentence, for example: "Core passes `project` with `agentConfig` set to the
role-merged launch config of this session (the spawn's model and permission mode); read the model and
the permission mode only from there."

### m-5: The N-2 core tests copy the plugin flag mapping into a mock

File: `packages/core/src/__tests__/session-manager/restore-permissions.test.ts:49-78` and `:131-158`.

`makePermissionMock` copies the three mappings (its comment cites claude-code `:879-882`, codex
`:294-303` and gemini `:250-255`). The three `describe.each` styles run the same core lines. They differ
only in the test's own copy of the mapping, so two of them add no core coverage. The copy also hides
the real gap: it looks like per-plugin coverage, but a real plugin can change its mapping and these
tests stay green (M-1).

Reproducer: remove `"codex"` and `"gemini"` from `styles` at `:129`. The core lines that the remaining
tests run do not change.

Action (optional): keep one style. Put the per-plugin mapping checks in the plugin packages (M-1).

### m-6: The permission mode is not persisted, so a config change after the spawn changes it on restore

File: `packages/core/src/session-manager.ts:2814-2830` (the mode comes from the current config).

The brief states: "A restore must never give an agent more permissions than its spawn did." The fix
holds this while the config is unchanged. It does not hold after a config edit. Live (head): demo-1
spawned under case (a) (`worker permissions: default`, no skip flag). I then added
`worker.agentConfig.permissions: permissionless`, stopped the pane with `tmux -L ao32r2-head
kill-session`, and ran `ao session restore demo-1`. Restore argv: `[--resume] [11111111-...]
[--dangerously-skip-permissions] [--model] [shared-model]`.

This matches the fallback launch on both `972f13ef` and `6088fc6b`, and the model rule for sessions
without `--model` (round-1 N-1). A config edit is an owner action. So this is not an escalation by an
agent. It is a limit of the stated invariant.

Action: owner decision. Either accept "restore follows the current role config" and say so, or
persist the spawn's permission mode (`permissions=`) at spawn, as `model=` is, and prefer it on
restore.

## 7. Notes

- **N-6 (process issue, outside the commit; act now).** Four lifecycle workers from the author's live
  runs are still running. `ao spawn` starts a detached lifecycle worker. The author's cleanup in both
  rounds stopped only the tmux servers.

  | PID | Age at 21:5x | HOME / AO_STATE_ROOT | From |
  |---|---|---|---|
  | 2919552 | ~74 min | `/tmp/opencode/ao30-live-home` / `ao30-live-state` | round 1 (`781a3a6e`) |
  | 2953478 | ~73 min | same | round 1 |
  | 3670285 | ~15 min | `/tmp/opencode/ao30n2-home` / `ao30n2-state` | round 2 (this commit) |
  | 3674356 | ~15 min | `/tmp/opencode/ao30n2-base-home` / `ao30n2-base-state` | round 2 base copy |

  Their HOME, state root and scratch `bin` are removed. Their `PATH` is now `<removed bin>:/usr/bin:/bin`,
  with no `TMUX` and no shim. So any `tmux` call from them goes to `/usr/bin/tmux` on the DEFAULT server,
  and any `gh` call to the real `/usr/bin/gh`. Their state roots do not exist, so they have no session
  to poll, and I saw no child process. The risk is low now, but they break section 0 and the author's
  D5 claim. I did not stop them: I stop only processes that I started. The orchestrator should stop
  them by exact PID (`kill 2919552 2953478 3670285 3674356`, after a check with `ps -p`). For future
  briefs: "`ao spawn` starts a detached lifecycle worker; its PID is in
  `<state root>/<hash>-<project>/lifecycle-worker.pid`; stop it by that PID before you stop the tmux
  server."
- **N-7 (third argument).** `effectiveModel` always equals `project.agentConfig.model` now (64 of 64
  cases). Keep it for compatibility, or remove it in a later interface change together with m-4.
- **N-8 (orchestrator role input).** The role comes from `role=orchestrator` in the metadata or from the
  ID pattern (`types.ts:197-218`). A record whose `role` key was changed after the spawn now gets the
  forced `permissionless` mode on the `--resume` path too. The fallback launch on `972f13ef` already did
  this (`:2820`, `:2827`), so the commit adds no new trust input. A worker in `default` mode needs an
  approved tool call to edit its metadata file, which is outside its workspace.
- **N-9 (author evidence).** The author's live check covered case (a) for Claude Code only. My runs add
  Codex, Gemini and case (b). The author's D3 reports `6 failed | 4 passed (10)` for
  `restore-permissions.test.ts` on the base, which matches my result.

## 8. What I found correct

- The fix is at the single choke point. `getRestoreCommand` now gets the same `agentConfig` as the
  restore fallback launch. Model and permission mode can no longer come from different sources.
- No interface change. A two-argument implementer that reads `project.agentConfig` gets the fix with no
  code change.
- No plugin logic change is needed. The plugin diffs are formatting only.
- Case (a) is fixed for all three plugins that read a permission mode, and case (b) for the
  orchestrator. Both are shown live against the base.
- The orchestrator restore grants nothing that `spawnOrchestrator` does not grant.
- The m-1, m-2 and m-3 fixes are exact: the new test fails on `23955f9a`, the Prettier change is limited
  to the new hunks, and the m-3 assertion now catches a mutant that the old mock missed.
- The model rule of `854690c3`, the I-2 restore order and the OpenCode refusals are unchanged.
- Scope and commit rules are met. The branch is not on a remote.

## 9. Cleanup

I stopped, by exact PID: my two lifecycle workers (3796160 head, 3798401 base), then my two private
tmux servers (`ao32r2-head` 3798340, `ao32r2-base` 3798761). None of the 20 PIDs I recorded (workers,
servers, pane shells, `sleep` children) was alive after that. A scan of `/proc` found no process with
my scratch HOME. I removed the sockets `/tmp/tmux-44402/ao32r2test`, `ao32r2-head` and `ao32r2-base`,
and all my scratch state (fake HOMEs, scratch repos, both base copies, the mutation copy, shims,
scripts, logs). No tmux command went to the default server. No `git stash`, no `git worktree add` (the worktree list holds no
scratch path). I made no commit, no push and no PR.
