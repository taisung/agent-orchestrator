# Restore model review, round 1: `4da4a340..781a3a6e`

Reviewer: Claude Opus 5.5 (ao-32), the cross-family lens. Date: 2026-10-15.
Author: Muse (OpenCode, ao-30). Worktree HEAD: `781a3a6e fix(core): keep the spawn --model through restore`.
Range: one code commit, 12 files, `530 insertions(+), 18 deletions(-)`. The four docs commits
`09d70a7c..4da4a340` are not part of the review.

**Verdict: LAND-SAFE**

I found 0 blockers, 0 majors, 3 minor findings (m-1 to m-3) and 5 notes (N-1 to N-5). The defect is
gone on every relaunch path. I reproduced it on the base and checked the fix live for Claude Code and
Codex. m-1 is a real but correct behaviour change that the commit does not state. Record it before or
at landing.

Scale: B = the landed code behaves wrongly or unsafely. M = a verified gap that lets a regression
pass. m = polish, an unstated change, or a low-probability risk.

## 1. How I ran everything (section 0 of the brief)

- Every `pnpm` command ran under `env -i HOME=<scratch>/home PATH=<scratch>/bin:/usr/bin:/bin`. No
  `AO_*` variable and no `TMUX` were in the environment. The scratch `bin` held a `tmux` shim
  (`unset TMUX; exec /usr/bin/tmux -L <label> "$@"`), a `gh` stub, and fake `claude`, `codex`,
  `gemini` and `opencode` that only log their arguments and then `exec sleep 3600`.
- The real `codex` is in the same directory as `node` and `pnpm`. So the scratch `bin` held a `node`
  symlink and a `pnpm` wrapper, not that directory.
- Live runs: one fake `HOME` and one private tmux server per build (`-L ao32-head`, `-L ao32-base`).
  The first `ao spawn` started each server through the shim from the scratch environment. Before the
  first live check I read `/proc/<pid>/environ` of the server, of the pane, and of the pane child:
  `HOME=<scratch>/live-head/home`, first `PATH` entry `<scratch>/bin`, for all three.
- The base check used a scratch copy (`git archive 4da4a340 | tar -x`), with its own install and
  build. No `git stash` and no `git worktree add`.
- No model turn: the fake agents never call a model. The global OpenCode service was not used.

## 2. Command summaries (my own runs, in my worktree at `781a3a6e`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0, `Done in 1.3s` |
| `pnpm build` | exit 0, last line `packages/cli build: Done` |
| `pnpm --filter <core + 4 agents> test` | core `Test Files 34 passed (34)` / `Tests 814 passed (814)`; claude-code `3 passed (3)` / `170 passed (170)`; codex `3 passed (3)` / `212 passed (212)`; gemini `1 passed (1)` / `60 passed (60)`; opencode `1 passed (1)` / `162 passed (162)` |
| `pnpm --filter <core + 4 agents> typecheck` | exit 0, 5 x `typecheck: Done` |
| `pnpm typecheck` (full) | exit 0, 13 x `typecheck: Done` |
| `pnpm lint` | `✖ 5 problems (0 errors, 5 warnings)`. None in a changed hunk (the two in `session-manager.ts` are at `:1510` and `:1517`, the old `console` lines moved by 13 lines). |
| `pnpm test` (full, fake HOME) | exit 0. Integration `Test Files 10 passed \| 3 skipped (13)` / `Tests 95 passed \| 24 skipped (119)`; `agent-opencode.integration.test.ts (31 tests \| 5 skipped)` (the live block skipped); cli `19 passed (19)` / `243 passed (243)`; all other packages pass. |
| `prettier --check` on the 12 changed files | 6 files fail. 5 of them fail on `4da4a340` too. See m-2. |

Non-vacuity (the new tests copied onto the `4da4a340` sources in the scratch copy):

| Test file | Result on `4da4a340` |
|---|---|
| core `restore-model.test.ts` | `Tests 8 failed \| 1 passed (9)`. Only "stores no model when spawn gives none" passes, as expected for a guard. |
| claude-code `index.test.ts` | `Tests 2 failed \| 100 passed (102)`. The fallback-to-config test passes, as expected. |
| codex `index.test.ts` | `Tests 2 failed \| 157 passed (159)` |
| gemini `index.test.ts` | `Tests 2 failed \| 58 passed (60)` |
| opencode `index.test.ts` | `Tests 2 failed \| 160 passed (162)` |

## 3. Live evidence

Claude Code, `ao spawn --agent claude-code --model claude-sonnet-5-5`, config
`agentConfig.model: config-model-opus`. The fake `claude` writes a session JSONL under
`$HOME/.claude/projects/<encoded cwd>/` on a fresh launch, as Claude Code does. So the restore runs the
plugin's `--resume` path and not only the `getLaunchCommand` fallback.

| Step | `781a3a6e` (head) | `4da4a340` (base) |
|---|---|---|
| spawn argv | `[--dangerously-skip-permissions] [--model] [claude-sonnet-5-5]` | same |
| metadata after spawn | `agent=claude-code`, `model=claude-sonnet-5-5` | `agent=claude-code`, no `model=` line |
| `ao session kill`, then `ao session restore` (archive path) | `[--resume] [11111111-...] [--dangerously-skip-permissions] [--model] [claude-sonnet-5-5]` | `[--resume] [11111111-...] [--dangerously-skip-permissions] [--model] [config-model-opus]` (the defect) |
| config changed to `config-model-changed`, pane stopped with `tmux -L ao32-head kill-session`, `ao session restore` (active-record path) | `... [--model] [claude-sonnet-5-5]` | not run |
| pane stopped again, `ao send demo-1 "hello from reviewer"` (restore before send) | `Message sent and processing`, argv `... [--model] [claude-sonnet-5-5]` | not run |
| metadata after the restores | `model=claude-sonnet-5-5`, `restoredAt=...` | n/a |

Codex (my second agent), `ao spawn --agent codex --model gpt-spawn-x`, same config. The fake `codex`
writes a rollout file with the model it got, as Codex records it: `"model":"gpt-spawn-x"`.

| Step | head | base |
|---|---|---|
| metadata | `agent=codex`, `model=gpt-spawn-x` | `agent=codex`, no `model=` |
| restore argv | `[resume] [-c] [check_for_update_on_startup=false] [--dangerously-bypass-approvals-and-sandbox] [--model] [gpt-spawn-x] [thread-fake-1]` | `... [--model] [config-model-opus] [thread-fake-1]` |

On the base, Codex's own record held the right model, and the config still won.

Shell escaping, head: `ao spawn --agent claude-code --model "x'; touch \$HOME/pwned; echo '"`. The
metadata holds the literal `model=x'; touch $HOME/pwned; echo '`. The restore argv holds the same
literal as one argument. `$HOME/pwned` does not exist.

The launch counts in the fake logs match my own actions (head: 8 `claude`, 2 `codex`; base: 4 and
2). The lifecycle worker that `ao spawn` started made no extra relaunch.

## 4. Review items

### 4.1 The defect is gone on every relaunch path

Only three places create a runtime: `spawn` (`session-manager.ts:1350`), `spawnOrchestrator`
(`:1812`) and `restore` (`:2911`). Every relaunch of an existing session goes through `restore()`
(`:2741`):

- `ao session restore` (`packages/cli/src/commands/session.ts:384`).
- `send()` -> `restoreForDelivery` (`:2427-2433`). Callers: the CLI `ao send` for a dead or non-tmux
  session (`send.ts:224-225`), the lifecycle reactions (`lifecycle-manager.ts:634`, `:1035`,
  `:1134`), and `ao review-check` (`review-check.ts:141`).
- The archive path (`:2758-2770`) reads the archived raw record, which holds `model=`.

In `restore()`, `selection` comes from `resolveSelectionForSession` (`:2777`). The restore command gets
`selection.model` (`:2833`). The fallback `getLaunchCommand` gets `agentLaunchConfig`, whose `model`
(`:2828`) and `agentConfig` (`:2819`) come from the same selection. The recovery module
(`packages/core/src/recovery/`) relaunches nothing; it only calls `updateMetadata`. The lifecycle
manager and the recovery validator use `resolveAgentSelection` only for `agentName`.

All spawn paths that take `--model` call `sm.spawn` (`spawn.ts:101-106`, the `--decompose` loop at
`:257-265`). `batch-spawn` has no `--model`. So the one metadata write at `:1418` covers them all.

### 4.2 The rule

- A spawn without `--model` stores no `model=` (`:1426-1429`; live: demo-3 has no `model=` line).
- A config model changed after the spawn does not override a persisted one (live, active-record path).
- An orchestrator never gets one: `OrchestratorSpawnConfig` has no model, and `spawnOrchestrator`
  writes no `model=` (`:1860`). A stray key is ignored (`:1022`, the `role === "worker"` guard).
- `resolveSessionRole` returns only `"orchestrator"` or `"worker"`. Only a worker can have a spawn
  override, so "workers only" is right. A worker ID cannot match the orchestrator patterns
  (`types.ts:197-218`): it ends in `-<n>`, and spawn writes no `role=`.
- No hook writes `model=`: the Claude Code hook writes `pr`, `status`, `branch`
  (`agent-claude-code/src/index.ts:145-180`), and the PATH wrappers write `pr`, `status`, `branch`
  (`agent-workspace-hooks.ts:348-452`). So an agent-side write cannot turn into an override.

### 4.3 The interface

`getRestoreCommand(session, project, effectiveModel?)` (`types.ts:366-370`) is additive. A two-arg
caller still compiles (the integration tests call it with two args; the full typecheck passes). A
two-arg implementer still satisfies the type (see N-5). `packages/core/src/index.ts` is not changed;
the exported `Agent` and `SessionMetadata` types only gain optional members. Every plugin
shell-escapes the model: Claude Code `shellEscape(model)` (`:890`), Gemini `shellEscape(model)`
(`:261`), Codex `appendModelFlags` -> `shellEscape` (`:308`), OpenCode through
`shellEscape(JSON.stringify(body))` (`:300`) or `invalidModelCommand` -> `shellEscape`. Live check in
section 3.

### 4.4 Codex order

`effectiveModel ?? project.agentConfig?.model ?? data.model` (`agent-codex/src/index.ts:661-663`).
I accept it. See N-1 for the judgement against C-04.

### 4.5 Metadata

- `metadata.ts:94` reads `model`, `:145` writes it. The serializer collapses `\r\n` to a space
  (`:52`), so a `--model` value cannot add keys. The parser trims the value (`key-value.ts:14`).
- Only three `writeMetadata` calls exist (`:1418` spawn, `:1860` orchestrator, `:2843` archive copy).
  The archive copy now keeps `model` (`:2856`). Every other write (remap `:2733`, claim-pr `:2617`,
  `:2628`, restore's own update, recovery actions) is `updateMetadata` or `updateArchivedMetadata`,
  which merge and keep unknown keys.
- `kill` and `cleanup` archive the whole file. `ao session ls` lists the sessions with no error.

### 4.6 No collateral change

The OpenCode diff changes only the last statement of `getRestoreCommand`. The version gate, the
missing-ID refusal and the 404 refusal still run first (`agent-opencode/src/index.ts:647-666`). In
core, the restore command is still built at step 5, before the archive copy, the workspace restore
and the old runtime destroy. Tests: `restore.test.ts` `Tests 24 passed (24)`, including "keeps the
old runtime when getRestoreCommand throws" and "destroys the old runtime only after the restore
command is ready". The OpenCode `getRestoreCommand` block: 7 passed, including both refusals. No file
of the launch lock, the marker, the discovery or the `~/.ao/bin` PATH code is in the diff.

### 4.7 Tests

See section 2. The new tests assert behaviour (the third argument that core passes, the command that
the runtime gets, the metadata on disk, and the plugin command strings). One assertion copies a mock
literal (m-3).

### 4.8 Scope and commit

- The 12 files are all in the brief's section 3 list. `types.ts` changes because the restore
  interface changes; `SessionMetadata.model` sits in the same file and is needed so that
  `writeMetadata` keeps the key.
- Message: `fix(core): keep the spawn --model through restore`, with the WHY in the body. No trailer
  (`%(trailers)` is empty), no emoji, no issue number.
- `git branch -r --contains 781a3a6e` prints nothing.

## 5. Findings

### m-1: A role-scoped config model now reaches the restore command when no `--model` was given (not stated)

File: `packages/core/src/session-manager.ts:2833`, with the plugin lines that prefer
`effectiveModel` (`agent-claude-code/src/index.ts:887-891`, `agent-codex/src/index.ts:661-663`,
`agent-gemini/src/index.ts:259`, `agent-opencode/src/index.ts:673-675`).

Before the change, every plugin read only the shared `project.agentConfig.model`. Now core passes
`selection.model`. For a worker that is `worker.agentConfig.model ?? agentConfig.model`. For an
orchestrator it is `orchestratorModel ?? ... ?? agentConfig.model` (`agent-selection.ts:66-72`). So a
session spawned WITHOUT `--model` restores on a different model than before, whenever the project
sets a role-scoped model.

The new model is the one the spawn used, so the change is correct and is in the direction of C-04.
But brief section 2.5 says "No change of behaviour when no spawn model was given". The commit message
and the author report do not state the change. No test covers the worker case. The orchestrator test
(`restore-model.test.ts:241-283`) asserts `orchestrator-model` but describes only the stray key.

Reproducer (live, done): config `agentConfig.model: config-model-opus` and
`worker.agentConfig.model: worker-role-model`. Run `ao spawn --agent claude-code` (no `--model`),
then `ao session kill demo-3` and `ao session restore demo-3`.

- Spawn, both builds: `[--model] [worker-role-model]`.
- Restore, base: `[--resume] [...] [--model] [config-model-opus]`.
- Restore, head: `[--resume] [...] [--model] [worker-role-model]`.

Action: state the change in the landing record (and in the commit body if you amend). Add one core
test for the worker-role case. No code change.

### m-2: The new lines are not in Prettier style

Files: `agent-claude-code/src/index.ts:887-888`, `agent-codex/src/index.ts:661-663`,
`restore-model.test.ts:6-11` and `:225-227`.

Reproducer: `node_modules/.bin/prettier --check <file>`, or
`prettier --stdin-filepath <file> < <file> | diff <file> -`. Prettier puts each of these on one line
(the Codex one becomes `(... ?? data.model) as\n | string\n | undefined`). CI runs no format check, and
5 of the 6 files already failed on `4da4a340`. So this is polish only. Format only the new hunks, or
leave it.

### m-3: One restore-before-send assertion checks a literal of the mock

File: `packages/core/src/__tests__/session-manager/restore-model.test.ts:237-238`.

`expect(createCall.launchCommand).toContain("spawn-model-X")` passes for any model, because the mock
at `:222` always returns `"mock-agent --resume --model spawn-model-X"`. The real check is the
third-argument assertion at `:232-236`, which fails on the base. Build the mock command from
`effectiveModel`, as the test at `:83-86` does. Also missing (I checked these live, see section 3):
the worker-role case of m-1, and a second restore of an active record.

## 6. Notes (no action needed to land)

- **N-1 (Codex order against C-04).** For a session with a persisted spawn model, the order is right:
  the persisted model wins, and it equals what Codex records (live: rollout `"model":"gpt-spawn-x"`,
  restore `--model gpt-spawn-x`). In core, `effectiveModel` already holds the config model when one
  is set. So the middle term `project.agentConfig?.model` is reached only by a two-arg caller, and
  `data.model` only when no spawn, role or shared model exists. The residual gap is old and is the
  same for all four plugins: for a session spawned without `--model`, a config change after the spawn
  changes the model on restore, although Codex recorded the old one. Brief section 2.5 asks for this.
  To close it, persist the effective model of every worker at spawn. That is an owner decision,
  because config edits would then no longer reach existing sessions.
- **N-2 (permissions, old and out of scope).** The restore commands still read `permissions` from the
  raw `project.agentConfig` (`agent-claude-code/src/index.ts:879`, `agent-codex/src/index.ts:653`,
  `agent-gemini/src/index.ts:251`), not from the role-merged selection that the spawn uses. This is
  the same class as m-1. Passing the selection's `agentConfig` would close both. Follow-up candidate.
- **N-3 (rollout).** Sessions spawned before this commit have no `model=` line. After this lands and
  the global `ao` is rebuilt, a restore of such a session still uses the config model. To keep a
  running Sonnet worker on Sonnet, add a `model=<value>` line to its session file before a restore.
  `resolveSelectionForSession` reads the raw key.
- **N-4 (author evidence).** The author's live restore line is `--dangerously-skip-permissions --model
  claude-sonnet-5-5`, with no `--resume`. Their fake `claude` wrote no session JSONL, so the plugin's
  `getRestoreCommand` returned `null`, and only the core fallback ran live. The plugin change had only
  unit evidence. My run in section 3 covers the `--resume` path. The author's D3 also says "src
  stashed to main" and "scratch stash + rebuild". The brief named a scratch copy, and the stash stack
  is shared by all worktrees. This is a process risk, not a code defect. The stash list now holds no
  ao-30 entry.
- **N-5 (external plugins).** An external agent plugin that implements the two-arg form still
  type-checks and silently keeps the config model on restore. The JSDoc (`types.ts:361-364`) says
  plugins "must prefer" the new argument. No retained plugin is affected.

## 7. What I found correct

- The cause is fixed at its root: the override is persisted at spawn (`:1426-1429`) and re-applied
  through the existing worker rule, not through a second rule.
- One choke point: every relaunch of an existing session goes through `restore()`, and both the
  restore command and the fallback launch use the same `selection`.
- The archive copy keeps `model=`. `updateMetadata` keeps it through later writes. Three restores in a
  row kept `claude-sonnet-5-5` live.
- The orchestrator guard and the empty-string guard at spawn and at read.
- The model stays shell-safe end to end, through metadata, for all four plugins.
- The OpenCode refusal order and the core "refuse before change" order are unchanged.
- The interface change is additive. The public API in `index.ts` does not change.
- The new tests fail on the base and assert behaviour, with the one exception in m-3.
- Scope and commit rules are met. The branch is not on a remote.

## 8. Cleanup

I stopped, by exact PID: the two lifecycle workers (3148549, 3165982), then the two private tmux
servers (`ao32-head` 3162716, `ao32-base` 3166445). After that, none of the 18 PIDs I recorded (the
workers, the servers, the pane shells and the `sleep` children) was alive. I removed the sockets
`/tmp/tmux-44402/ao32test`, `ao32-head` and `ao32-base`. I removed all my scratch state (the fake
HOMEs, the scratch repos, the base copy, the shims and the logs). No tmux command went to the default
server. `git worktree list` holds no scratch path. I made no commit, no push and no PR.
