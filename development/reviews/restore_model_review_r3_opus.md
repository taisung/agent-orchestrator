# Restore spawn-identity review, round 3: `d013e400..cfb64f67`

Reviewer: Claude Opus 5.5 (ao-32), the round-1 and round-2 reviewer. Date: 2026-10-15.
Author: Muse (OpenCode, ao-30). Worktree HEAD: `cfb64f67 fix(core): store the spawn model and permission
mode of every worker`. Range: one commit, 9 files, `332 insertions(+), 20 deletions(-)`.

**Verdict: LAND-SAFE**

The commit closes m-6 for every worker that is spawned after it lands, and it closes N-1 for every
worker that is spawned with a model. I found 0 blockers, 1 major (M-2, a test gap), 4 minor findings
(m-7 to m-10) and 5 notes (N-10 to N-14). The code is correct for what the owner chose. M-2 needs one
test. m-7, m-9 and m-10 need an owner decision or a follow-up. m-8 is a documentation correction.

| Item | Status | Evidence |
|---|---|---|
| m-6 (round 2) | **Fixed** for records written after this commit | Section 3: Claude Code (`--resume` path) and Codex (`resume` path), both directions, archive path and active-record path. The `d013e400` copy shows the old behaviour. Old records keep it (stated limit, N-10). |
| N-1 (round 1) | **Partly fixed** | Fixed when the spawn had a model from `--model`, the role config or the shared config (live demo-1, demo-2). Not fixed for a worker that was spawned with no model at all (m-9). |

Scale (same as rounds 1 and 2): B = the landed code behaves wrongly or unsafely. M = a verified gap
that lets a regression pass. m = polish, an unstated change, or a low-probability risk.

## 1. How I ran everything (section 0)

- Every `pnpm` command and every live command ran under `env -i HOME=<scratch>/... PATH=<scratch>/bin:/usr/bin:/bin`:
  no `AO_*`, no `TMUX`. The scratch `bin` held a `tmux` shim (`unset TMUX; exec /usr/bin/tmux -L <label>`),
  a `gh` stub, a `node` symlink, a `pnpm` wrapper, and fake `claude`, `codex`, `gemini` and `opencode`
  that log their arguments and `exec sleep 3600`. No model turn anywhere.
- The fake `claude` writes `$HOME/.claude/projects/<encoded cwd>/<uuid>.jsonl` on a fresh launch, so the
  plugin's `--resume` path runs. The fake `codex` writes a rollout file with its `--model`, so the
  plugin's `codex resume` path runs.
- One fake `HOME` and one private tmux server per build: `-L ao32r3-head`, `-L ao32r3-base`. The unit
  tests used `-L ao32r3test` (no server stayed). Before the first `ao` command of each build, I started
  the server from the scratch environment with a probe session and read `/proc/<pid>/environ`:

  | Build | Server PID | Pane PID | `HOME` | First `PATH` entry | `AO_*` |
  |---|---|---|---|---|---|
  | head | 659315 | 659316 | `<scratch>/live-head/home` | `<scratch>/bin` | none |
  | base | 682643 | 682645 | `<scratch>/live-base/home` | `<scratch>/bin` | none |

  `TMUX` was unset in the server and set only inside the pane (the pane's own private socket).
- Base copy: `git archive d013e400 | tar -x`, own offline install and build. Mutation copy:
  `git archive cfb64f67 | tar -x`, own install and build. No `git stash`, no `git worktree add`.
- I did not run `ao start`. For the orchestrator I called the real `sm.spawnOrchestrator()` through the
  CLI's own factory (`packages/cli/dist/lib/create-session-manager.js`) from a scratch script.
- `ao spawn` starts one lifecycle worker per project. I stopped each by the PID in
  `<state root>/<hash>-<project>/lifecycle-worker.pid` before I stopped the tmux servers (section 12).
  I did not touch the five real lifecycle workers (288652, 289254, 289313, 289330, 289549).

## 2. Command summaries (my own runs, in my worktree at `cfb64f67`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0, `Done in 1.2s` |
| `pnpm build` | exit 0, last line `packages/cli build: Done` |
| `pnpm --filter <core + 4 agents> test` | exit 0. core `Test Files  35 passed (35)` / `Tests  828 passed (828)` (`restore-permissions.test.ts (14 tests)`, `restore-model.test.ts (9 tests)`, `restore.test.ts (24 tests)`); claude-code `Tests  175 passed (175)`; codex `Tests  213 passed (213)`; gemini `Tests  61 passed (61)`; opencode `Tests  163 passed (163)` |
| `pnpm --filter <core + 4 agents> typecheck` | exit 0, 5 × `typecheck: Done` |
| `pnpm lint` | exit 0, `✖ 5 problems (0 errors, 5 warnings)`. All 5 are old (for example `session-manager.ts:1519`, `:1526`, from `3d1913e69`). |
| `pnpm test` (full) | exit 0. core 828, gemini 61, claude-code 175, codex 213, notifier-desktop 26, runtime-herdr 36, scm-github `140 passed \| 5 skipped (145)`, tracker-github 42, workspace-worktree 46, runtime-tmux 30, opencode 163, integration `Tests  95 passed \| 24 skipped (119)` with `agent-opencode.integration.test.ts (31 tests \| 5 skipped)`, cli 243 |
| `d013e400` copy: install + build | exit 0, `packages/cli build: Done` |

My counts match the author's D4.

## 3. Live checks (review items 1, 2, 5 and 7)

One config file with two projects. `demo` uses repository `p`, `demq` uses repository `q`.

| Stage | `demo` | `demq` | Spawns |
|---|---|---|---|
| 1 | `agentConfig.model: model-A`, `worker.agentConfig.permissions: default` | `agentConfig.model: model-A`, `agentConfig.permissions: permissionless` | demo-1 (claude-code), demo-2 (`--agent codex`), demq-1 (claude-code), demq-2 (`--agent codex`) |
| 2 | `agentConfig: {}` | unchanged | demo-3 (claude-code), demo-4 (`--agent codex`) |
| 3 (final) | `agentConfig.model: model-B`, `worker.agentConfig.permissions: permissionless` | `agentConfig.model: model-B`, `agentConfig.permissions: default` | none |

At stage 3, I ran `ao session kill` and then `ao session restore` for all six sessions. `ao session kill`
archives the record, so this is the archive path. Then I stopped the panes of demo-1, demo-2 and demq-1
with `tmux -L ao32r3-<build> kill-session` and ran `ao session restore` again (active-record path).

Metadata after the spawn:

```
head: demo-1 agent=claude-code model=model-A permissions=default
      demo-2 agent=codex       model=model-A permissions=default
      demo-3 agent=claude-code               permissions=permissionless
      demo-4 agent=codex                     permissions=permissionless
      demq-1 agent=claude-code model=model-A permissions=permissionless
      demq-2 agent=codex       model=model-A permissions=permissionless
base: agent= only, no model= and no permissions= key on any record
```

After the archive restore and after the active-record restore, the head records keep the same `model=`
and `permissions=` lines. So the archive copy-back at `session-manager.ts:2878-2879` works (but see M-2).

Arguments that the fake agents logged (the spawn line is the same on head and base):

| Session | Spawn | Head restore (archive path and active-record path) | Base restore |
|---|---|---|---|
| demo-1 claude | `[--model] [model-A]` | `[--resume] [1111…] [--model] [model-A]` | `[--resume] [1111…] [--dangerously-skip-permissions] [--model] [model-B]` |
| demo-2 codex | `[-c] [check_for_update_on_startup=false] [--model] [model-A] [--] [<prompt>]` | `[resume] [-c] [check_for_update_on_startup=false] [--model] [model-A] [thread-fake-1]` | `[resume] [-c] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-B] [thread-fake-1]` |
| demq-1 claude | `[--dangerously-skip-permissions] [--model] [model-A]` | `[--resume] [1111…] [--dangerously-skip-permissions] [--model] [model-A]` | `[--resume] [1111…] [--model] [model-B]` |
| demq-2 codex | `[...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-A] [--] [<prompt>]` | `[resume] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-A] [thread-fake-1]` | `[resume] [...] [--model] [model-B] [thread-fake-1]` |
| demo-3 claude | `[--dangerously-skip-permissions]` | `[--resume] [1111…] [--dangerously-skip-permissions] [--model] [model-B]` | same as head |
| demo-4 codex | `[...] [--dangerously-bypass-approvals-and-sandbox] [--] [<prompt>]` | `[resume] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-B] [thread-fake-1]` | same as head |

Results:

- **m-6, forward** (spawn under `default`, config changed to `permissionless`): demo-1 and demo-2. The
  head restore adds no flag on the Claude Code `--resume` path and on the Codex `resume` path. The base
  restore adds `--dangerously-skip-permissions` and `--dangerously-bypass-approvals-and-sandbox`.
- **m-6, reverse** (spawn under `permissionless`, config changed to `default`): demq-1 and demq-2. The
  head keeps the flag. The base drops it.
- **"No mode, then `permissionless` added"**: a YAML config cannot produce this case. At stage 2,
  `agentConfig: {}` spawned demo-3 and demo-4 WITH the permissive flag, on head and base. The config
  loader gives every project a shared mode, and the default is `permissionless` (m-8). The head stores
  `permissionless` and restores with it, which matches the spawn.
- **N-1**: demo-1 and demo-2 restore on `model-A` after the config changed to `model-B` (Claude Code and
  Codex). The base restores on `model-B`. demo-3 and demo-4 had no model at the spawn, and the head
  restores them on `model-B` (m-9).
- **Round-2 case (a)** still holds: at stage 1 the shared mode of `demo` is the loader default
  `permissionless` and the worker mode is `default`. demo-1 spawns and restores with no flag.

Further live checks on the head build:

- **Case (b) and stray keys (item 5):** `demq-orchestrator-1` (shared `default`, config model `model-B`)
  spawned with `[--dangerously-skip-permissions] [--model] [model-B] [--append-system-prompt] [...]`. Its
  record has `role=orchestrator agent=claude-code` and no `model=` or `permissions=`. I appended
  `model=stray-model` and `permissions=default` to the record, stopped the pane and restored it:
  `[--resume] [1111…] [--dangerously-skip-permissions] [--model] [model-B]`. The orchestrator ignores both
  stray keys.
- **Explicit `--model` (item 7):** `ao spawn --model model-X` gave demo-5 with `model=model-X
  permissions=default`. I changed the config model to `model-C`, ran `ao session kill` and
  `ao session restore`: `[--resume] [1111…] [--model] [model-X]`.
- **Metadata written by the agent helper (item 5, m-10):** I ran the documented helper
  (`source ~/.ao/bin/ao-metadata-helper.sh; update_ao_metadata <key> <value>`) with the exact
  `AO_DATA_DIR`, `AO_SESSION`, `AO_STATE_ROOT`, `HOME` and `PATH` of the pane, as the agent would. Both
  configs had `demo` set back to worker `default` first.

  | Build | Session | Helper call | Restore |
  |---|---|---|---|
  | head | demo-2 (codex, stored `default`) | `update_ao_metadata permissions permissionless` | `[resume] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-A] [thread-fake-1]` |
  | base | demo-2 (codex) | `update_ao_metadata permissions permissionless` | `[resume] [...] [--model] [model-B] [thread-fake-1]` (key not read) |
  | base | demq-2 (codex, config `default`) | `update_ao_metadata role orchestrator` | `[resume] [...] [--dangerously-bypass-approvals-and-sandbox] [--model] [model-B] [thread-fake-1]` |

## 4. Item 3: the "no mode" value and the fail-safe

I ran a scratch script under a fake `HOME` (with a Claude session JSONL, a Codex rollout file and a
Gemini `tmp` directory). The script calls the built `resolveAgentSelection`, `parseKeyValueContent` and
the four plugins.

**4.1 Byte compare.** Spawn with no mode in a config object: `selection.permissions=undefined`, stored
value `default`. Then the config changes to each of `none`, `default`, `suggest`, `auto-edit`,
`permissionless` and `skip`, and the restore uses the stored `default`:

- The fallback launch equals the spawn launch, byte for byte: 24 of 24 (4 plugins × 6 configs).
- The `--resume` command equals the `--resume` command of a no-mode record under a no-mode config:
  18 of 18 (Claude Code, Codex, Gemini × 6). For example `claude --resume '1111…' --model 'm-A'`,
  `'codex' resume -c check_for_update_on_startup=false --model 'm-A' 'thread-bc'`,
  `gemini -m 'm-A' -r latest`.
- I did not run the OpenCode restore (its fake binary would block). `agent-opencode/src/index.ts` reads
  no permission mode at all (the only match for "permission" is the prompt detection at `:504`).

**4.2 Launch flags per canonical mode:**

| Mode | claude-code | codex | gemini | opencode |
|---|---|---|---|---|
| (none) | – | – | – | – |
| `suggest` | – | `--ask-for-approval untrusted` | – | – |
| `default` | – | – | – | – |
| `auto-edit` | `--dangerously-skip-permissions` | `--ask-for-approval never` | – | – |
| `permissionless` | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | – |

`default` is the most restrictive mode for Claude Code, Gemini and OpenCode (it equals `suggest`). For
Codex it is not: `suggest` adds `--ask-for-approval untrusted`, and `default` adds nothing, so Codex
uses its own config (m-7, N-13).

**4.3 Stored values through the real parser and the real selection** (config `permissionless`):

| Stored line value | Parsed | Selection | claude-code | codex | gemini |
|---|---|---|---|---|---|
| `default` | `default` | `default` | – | – | – |
| `suggest` | `suggest` | `suggest` | – | `--ask-for-approval untrusted` | – |
| `auto-edit` | `auto-edit` | `auto-edit` | skip flag | `--ask-for-approval never` | – |
| `permissionless` | `permissionless` | `permissionless` | skip flag | bypass flag | `--yolo` |
| `skip` | `skip` | `permissionless` | skip flag | bypass flag | `--yolo` |
| `""` | `""` | `default` | – | – | – |
| `bogus`, `PERMISSIONLESS`, `Skip`, `skip!`, `yolo`, `auto_edit`, `permissionless # note` | unchanged | `default` | – | – | – |
| `" permissionless "` | `permissionless` | `permissionless` | skip flag | bypass flag | `--yolo` |
| `"\tskip"` | `skip` | `permissionless` | skip flag | bypass flag | `--yolo` |

The parser trims every value (`key-value.ts:13-14`), so whitespace gives the canonical value. Case
variants and junk give `default`. Legacy `skip` gives `permissionless`, the same as the config alias.
The spawn never writes `skip`, because it stores the normalized mode. So no stored value gives more
than its trimmed canonical value, and a stored value gives more than the spawn only when something
other than the spawn wrote it: a hand edit, or the agent through the helper (m-10).

## 5. Item 4: one rule in one place

- Only `restore()` (`session-manager.ts:2750`) relaunches an existing worker. The other
  `getLaunchCommand` calls are the worker spawn (`:1351`) and `spawnOrchestrator` (`:1803`). `send` uses
  `restoreForDelivery`, which calls `restore()` (`:2436-2442`). The archive restore is the same function
  with `fromArchive`. The fallback launch uses the same `agentLaunchConfig` (`:2823-2838`).
- `restore()` takes its selection from `resolveSelectionForSession` (`:2786`), which is the one place that
  reads `model=` and `permissions=` (`:1019-1031`). The other callers use only `.agentName` (`:750`,
  `:1949`, `:2002`, `:2016`, `:2177`, `:2228`, `:2291`, `:2584`, `:2691`). `lifecycle-manager.ts:368` calls
  `resolveAgentSelection` for `.agentName` only.
- So the stored values win on every relaunch path. A config change can still reach an existing worker
  in four ways: an old record without the keys (N-10), the model of a worker spawned with no model
  (m-9), the agent's own config (N-13), and the metadata file itself (m-10).

## 6. Item 6: metadata

- `permissions` is in `SessionMetadata` (`types.ts:1403`), `readMetadata` (`metadata.ts:95`) and
  `writeMetadata` (`metadata.ts:147`), next to `model`.
- Only three calls write a full record: the worker spawn (`session-manager.ts:1429`, both keys),
  `spawnOrchestrator` (`:1869`, neither key, correct) and the archive copy-back (`:2865`, both keys at
  `:2878-2879`). Every other writer merges: `updateMetadata` (claim-pr `:2626`, `:2637`; remap `:2738`;
  restore `:2953`, `:2982`; repair `:503`; spawn post-launch `:1466`, `:1538`; lifecycle `:473`, `:721`;
  `recovery/actions.ts:45`, `:61`, `:143`, `:188`) and `updateArchivedMetadata` (`metadata.ts:249-288`).
  `deleteMetadata` copies the file byte for byte into `archive/` (`metadata.ts:203-208`).
- The archive copy-back keeps both keys live, but no test covers the `permissions` line (M-2).

## 7. Item 8: tests

**Non-vacuity.** I copied the new test files onto the `d013e400` sources:

- `restore-permissions.test.ts`: `Tests  8 failed | 6 passed (14)`. The 8 that fail are the 8 new
  behaviour tests: spawn stores the effective model and mode, no-mode spawn, stored `permissionless`
  wins, the 4 malformed values, and restore-before-send. The 6 that pass are the 3 N-2 tests, the m-1
  test, the old-record test (it asserts the old behaviour, as intended), and the orchestrator stray-key
  test (N-11). This matches the author's D3.
- The 4 plugin tests (`agent-claude-code/src/index.test.ts:1223`, `agent-codex/src/index.test.ts:1416`,
  `agent-gemini/src/index.test.ts:472`, `agent-opencode/src/index.test.ts:822`) pass on the base. They
  are characterization tests of an unchanged mapping (N-12).

The tests assert behaviour: they drive `spawn()`, `restore()` and `send()` and check the
`launchCommand` that reaches `runtime.create`, the third `getRestoreCommand` argument, and the stored
metadata.

**Mutation.** I applied each mutant to a scratch copy of `cfb64f67` and ran all 828 core tests: the 807
tests in `src/__tests__` without a build, `plugin-integration.test.ts` (13 tests) again after a build,
and the root `__tests__/config.test.ts` (8 tests) imports only `config.ts` and `types.ts`.
`plugin-integration.test.ts` passed under every mutant.

| Mutant | Change | Tests that catch it |
|---|---|---|
| `failsafe-config` | malformed stored value → current config (`agent-selection.ts:93`) | the 4 malformed-value tests |
| `failsafe-permissionless` | malformed → `permissionless` | the 4 malformed-value tests |
| `failsafe-suggest` | malformed → `suggest` | none (expected: it is the m-7 option and changes only Codex) |
| `stored-loses-to-config` | stored mode wins only when the config has no mode | 8: the 4 malformed, spawn-stores, no-mode, stored-wins, restore-before-send |
| `stored-not-read` | core never passes the stored mode (`session-manager.ts:1029`) | the same 8 |
| `missing-key-as-default` | an old record gets `default` | 3: N-2 "agree", old-record test, `spawn.test.ts` "keeps shared worker permissions when role-specific config only overrides model" |
| `spawn-no-default` | spawn stores no mode when none is set (`:1438`) | 1: "spawn with no mode stores default…" |
| `spawn-model-explicit-only` | spawn stores only an explicit `--model` (`:1437`) | 1: "spawn stores the effective model and mode…" |
| `model-config-first` | config model before the stored model (`agent-selection.ts:80`) | 4: `restore-model` "a config model changed after spawn…", restore-before-send, spawn-stores, `spawn.test.ts` "prefers spawn model override over configured model…" |
| `archive-drops-permissions` | archive copy-back drops `permissions` (`:2879`) | **none (M-2)** |
| `archive-drops-model` | archive copy-back drops `model` (`:2878`) | 1: `restore-model` "keeps the persisted model when restoring from archive" |
| `orchestrator-reads-stored-mode` | remove both `role === "worker"` guards for the mode | none (equivalent for restore, N-11) |
| `metadata-write-drops-permissions` | `writeMetadata` drops `permissions` (`metadata.ts:147`) | 4: restore-before-send, spawn-stores, no-mode, stored-wins |

## 8. Findings

### M-2: No test guards the archive copy-back of `permissions=`

File: `packages/core/src/session-manager.ts:2879` (`permissions: raw["permissions"],` in the
`fromArchive` copy-back).

`ao session kill` archives every record (`deleteMetadata(sessionsDir, sessionId, true)`), so every
`ao session kill` + `ao session restore` runs this copy-back. If the line is lost, the first restore is
still right, because `restore()` takes the selection from the archived record before the copy-back.
But the rewritten record has no `permissions=` line, so it becomes an "old record", and every later
restore follows the current config. That is m-6 again, with no test that fails. The model line has a
test (`restore-model.test.ts:280-306`). The permissions line does not.

Evidence: the `archive-drops-permissions` mutant passes all 828 core tests (section 7). A scratch test
(kill to archive, restore, restore again, config `permissionless`, stored `default`; text in the
appendix) passes on `cfb64f67` and fails under the mutant:

```
  {
    "first": "mock --resume --perms default",
-   "second": "mock --resume --perms default",
-   "storedAfterArchiveRestore": "default",
+   "second": "mock --resume --perms permissionless",
+   "storedAfterArchiveRestore": undefined,
  }
```

Reproducer: delete `session-manager.ts:2879` in a scratch copy, run the core tests (all pass), then run
the appendix test (it fails).

A related edge: `writeMetadata` skips empty values (`metadata.ts:147`), so a hand-edited empty
`permissions=` in an archive is lost on the copy-back in the same way. The first restore maps it to
`default`, and the second restore follows the config.

Action: add the appendix test (or assert `readMetadataRaw(...)["permissions"]` after the archive restore
in the existing archive test, as `restore-model.test.ts:305` does for the model).

### m-7: The fail-safe value `default` is not the most restrictive mode for Codex

File: `packages/core/src/agent-selection.ts:88-93`. Test name:
`restore-permissions.test.ts:287-306` ("restores with the most restrictive mode").

The author brief (2.3) says a malformed value "must never give more permissions than the most
restrictive mode of the plugin". For Codex, `suggest` adds `--ask-for-approval untrusted`, and
`default` adds no approval flag (table 4.2). With no flag, Codex uses `~/.codex/config.toml`. On this
host, two `[projects."..."]` sections of that file set `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"`. So a Codex worker spawned under `suggest` whose stored value is
damaged restores with fewer restrictions than its spawn. The test asserts only "no skip flag" with a
Claude-style mock, so it cannot see this.

The risk is low: AO writes only canonical values, so a malformed value needs a hand edit or file damage.

Reproducer: store `permissions=bogus` for a Codex worker and restore. The command has no
`--ask-for-approval` flag. A spawn under `suggest` had `--ask-for-approval untrusted`.

Action (owner choice): map malformed and empty values to `suggest`. This is byte-identical to `default`
for Claude Code, Gemini and OpenCode (table 4.2), and the `failsafe-suggest` mutant passes all current
tests. The "no mode" value must stay `default`, because it must match the spawn. Or keep `default`, and
change the comment at `:88-92`, the commit text and the test name to "no permissive flag" instead of
"most restrictive".

### m-8: The "no mode" case does not occur with a YAML config, and the comments say it does

Files: `packages/core/src/config.ts:132-135` and `:200` (cause), `session-manager.ts:1420-1427`,
`types.ts:1403`, `restore-permissions.test.ts:258` (text).

`AgentSpecificConfigSchema` gives `permissions` the default `"permissionless"`, and every project gets
`agentConfig: AgentSpecificConfigSchema.default({})`. So a project loaded from YAML always has a shared
mode, and `selection.permissions` is never `undefined` after the loader. The `?? "default"` at
`session-manager.ts:1438` runs only for config objects that bypass the loader (the unit tests).

Live: at stage 2, `agentConfig: {}` spawned demo-3 with `--dangerously-skip-permissions` and demo-4
with `--dangerously-bypass-approvals-and-sandbox`, on head and base. The head stored
`permissions=permissionless`. The behaviour is correct (the stored mode equals the spawn mode). But the
comment "`default` when no mode is configured, so that a later config edit cannot add one", the
`types.ts` comment and the test name describe a case that a YAML user never gets. The brief case
"spawn with no mode, then `permissionless` added, restores with no flag" also does not occur: the
restore keeps the flag, because the spawn had it.

Action: change the comments and the test name to "a config object with no mode (the YAML loader always
sets one; its default is `permissionless`)". Tell the owner that a YAML project with no `permissions`
runs its workers `permissionless`. Changing that default is a separate owner decision.

### m-9: A worker spawned with no model still follows a later config model (N-1 residual)

Files: `packages/core/src/session-manager.ts:1437` (no `model=` when `selection.model` is undefined),
`agent-selection.ts:80`.

Review item 4 asks that "a config change can no longer reach an existing worker's model … by any
path". This fails for a worker spawned with no model in any config and no `--model`. Its record has no
`model=` line, so the restore uses the current config model. Live (head): demo-3 spawned with no
`--model` and restored with `[--model] [model-B]`. demo-4 (Codex) spawned with no `--model`, Codex
recorded its own default, and the restore passed `--model model-B`.

Reproducer: spawn a worker with no model configured, add `agentConfig.model: X`, kill and restore. The
restore has `--model X`.

Action (owner decision): accept and document it, or treat a record that has `permissions=` (so it was
written after this commit) but no `model=` as "spawned with no model". In that case, drop the config
model from the restore selection. Then Codex falls back to its recorded model, and the other three
plugins resume with no `--model`.

### m-10: The documented metadata helper lets an agent raise its own restore mode

Files: `packages/core/src/agent-workspace-hooks.ts:240-241` (the helper accepts any key that matches
`^[a-zA-Z0-9_-]+$`) and `:465-477` (the AGENTS.md section tells the agent to call
`update_ao_metadata <key> <value>`). Read by `session-manager.ts:1020`, `:1029`.

Live (section 3): on the head, `update_ao_metadata permissions permissionless`, run with the pane
environment of a Codex worker stored as `default`, made its next restore add
`--dangerously-bypass-approvals-and-sandbox` while the config said `default`. On `d013e400`, the same
key has no effect, but `update_ao_metadata role orchestrator` gives the same flag. So the commit adds no
new class of input (this is my round-2 N-8). It adds a second and quieter key on the same path: a
`role=` change makes the session an orchestrator in `ao status` and in the metadata repair, and a
`permissions=` change shows nowhere. The agent must run a shell command that writes outside its
workspace. In `default` mode, Claude Code and Gemini ask for approval first. For Codex, this depends on
the user's Codex config (N-13).

Reproducer: in a worker pane, run `source ~/.ao/bin/ao-metadata-helper.sh; update_ao_metadata
permissions permissionless`. Stop the pane and run `ao session restore <id>`.

Action (follow-up, outside the files of this commit): limit `update_ao_metadata` to the keys that the
wrappers write (`pr`, `status`, `branch`), and remove the generic call from the AGENTS.md section. This
closes the documented path for `permissions`, `role`, `model` and `agent`. An agent that can already
write outside its workspace can still edit the file directly.

## 9. Notes

- **N-10 (rollout).** Records without the keys follow the current config (stated limit, tested). All
  workers spawned before the global `ao` is rebuilt have no `permissions=` line. To pin a running
  worker, add `permissions=<mode>` (and `model=<model>`) to its session file before the next config edit,
  with the values that its spawn used. Because of m-8, a worker in a project with no explicit mode was
  spawned `permissionless`.
- **N-11 (orchestrator test).** "an orchestrator ignores stray stored model and mode keys"
  (`restore-permissions.test.ts:330`) passes on `d013e400` and cannot fail for the mode, because
  `restore()` forces `permissionless` for an orchestrator (`session-manager.ts:2829`, `:2836`). The
  `orchestrator-reads-stored-mode` mutant is equivalent for restore. The two `role === "worker"` guards
  (`session-manager.ts:1029`, `agent-selection.ts:87`) are defence in depth. The test still guards the
  model part. Live: the stray keys had no effect (section 3).
- **N-12 (plugin tests).** The 4 plugin tests check only that the permissive flags are absent, and they
  pass on the base. My byte compare (4.1) gives the stronger result: identical commands.
- **N-13 (Codex `default`).** A stored `default` sends no approval flag, so Codex uses
  `~/.codex/config.toml`. An edit of that file still reaches existing Codex sessions. This is outside AO.
- **N-14 (author evidence).** The author's live D2 covers Claude Code in the forward direction only. My
  runs add Codex, the reverse direction, the stage-2 spawn, the archive and active-record paths, case
  (b) and an explicit `--model`. The author's "no mode" proof uses config objects that bypass the loader
  (m-8). D3 (`8 failed | 6 passed (14)`) and the D4 counts match my runs. The author stopped their
  lifecycle workers this time: I found no process with a `HOME` under `/tmp/opencode` and no `ao30*`
  tmux socket.

## 10. What I found correct

- One rule in one place: `resolveSelectionForSession` → `resolveAgentSelection` serves restore, the
  restore before `send`, the archive restore and the fallback launch.
- The stored values are the values that the spawn used: `selection.model` and `selection.permissions`
  go to `getLaunchCommand` (`session-manager.ts:1342-1343`) and to the record (`:1437-1438`).
- The fail-safe never falls back to the config. No stored spelling gives more than its trimmed
  canonical value (4.3).
- A stored `default` gives the same bytes as a spawn with no mode, for all four plugins and all six
  later configs (4.1).
- Live, m-6 is closed in both directions for Claude Code and Codex, on the archive path and on the
  active-record path. N-1 is closed for every worker spawned with a model. The `d013e400` copy shows the
  old behaviour for each case.
- Orchestrators store nothing, ignore stray keys, and keep the round-2 case (b) behaviour.
- The explicit `--model` and the round-2 case (a) still hold.
- No change to any plugin `index.ts`, the `~/.ao/bin` PATH code, the OpenCode code or the
  `getRestoreCommand` interface. `types.ts` adds only the `SessionMetadata.permissions` field.
  `restore.test.ts` (I-2 refusals) passes 24 of 24.
- The new core tests are not vacuous: 8 of 10 fail on the base, and 10 of 13 mutants fail at least one
  test. Of the 3 that survive, 2 are expected (`failsafe-suggest`, `orchestrator-reads-stored-mode`).

## 11. Item 9: scope and commit

- The 9 files are all in the allowed list: `session-manager.ts`, `agent-selection.ts`, `types.ts`,
  `metadata.ts`, `core/src/__tests__/session-manager/restore-permissions.test.ts`, and the
  `src/index.test.ts` of the four agent plugins. No plugin `index.ts`, no `development/` file.
- The message is conventional (`fix(core): ...`) and states the WHY (r2 m-6, r1 N-1, the fail-safe, the
  old records, the orchestrators). No `Co-Authored-By` or other trailer, no emoji, no issue number.
- `git branch -r --contains cfb64f67` prints nothing.

## 12. Cleanup

- Stopped by exact PID, in this order: the lifecycle workers from the pid files, 659428 and 660029
  (head) and 682691 and 683269 (base). Then the tmux servers 660668 (`-L ao32r3-head`) and 685460
  (`-L ao32r3-base`). The probe servers 659315 and 682643 had already exited, when `ao session kill`
  stopped their last session. The first restore then started the servers above on the same labels.
  `ps -o pid= -p` for all six PIDs prints nothing.
- A `/proc` scan finds no process with a scratch `HOME`. `ps -o pid,args -u "$(id -u)"`, filtered by my
  scratch path, prints an empty list.
- Removed the sockets `ao32r3test`, `ao32r3-head` and `ao32r3-base`, and all scratch state (the base
  copy, the mutation copy, the fake homes, the logs and the scripts). The scratch directory is empty.
- The five real lifecycle workers (288652, 289254, 289313, 289330, 289549) still run. I did not touch
  them.
- No `git stash`, no `git worktree add`, no commit, no push, no PR, no `ao send`.

## Appendix: test for M-2

I ran this test only in the mutation copy. It passes on `cfb64f67` and fails when line `:2879` is
removed.

```ts
it("kill (archive) + restore + restore keeps the stored default mode", async () => {
  const { tmpDir, sessionsDir, mockRuntime, mockAgent, mockRegistry, config } = ctx;
  const wsPath = join(tmpDir, "ws-arch");
  mkdirSync(wsPath, { recursive: true });
  writeMetadata(sessionsDir, "app-1", {
    worktree: wsPath,
    branch: "feat/TEST-1",
    status: "killed",
    project: "my-app",
    permissions: "default",
    runtimeHandle: JSON.stringify(makeHandle("rt-old")),
  });
  deleteMetadata(sessionsDir, "app-1"); // archive, as `ao session kill` does
  const cfg: OrchestratorConfig = {
    ...config,
    projects: {
      ...config.projects,
      "my-app": { ...config.projects["my-app"]!, agentConfig: { permissions: "permissionless" } },
    },
  };
  const agent: Agent = {
    ...mockAgent,
    getRestoreCommand: vi
      .fn()
      .mockImplementation(async (_s, p) => `mock --resume --perms ${p.agentConfig?.permissions}`),
  };
  const registry = {
    ...mockRegistry,
    get: vi.fn().mockImplementation((slot: string) =>
      slot === "runtime" ? mockRuntime : slot === "agent" ? agent : slot === "workspace" ? ctx.mockWorkspace : null,
    ),
  } as PluginRegistry;
  const sm = createSessionManager({ config: cfg, registry });
  await sm.restore("app-1");
  const afterArchiveRestore = readMetadataRaw(sessionsDir, "app-1")?.["permissions"];
  updateMetadata(sessionsDir, "app-1", { status: "killed" });
  vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
  await sm.restore("app-1");
  const calls = (mockRuntime.create as ReturnType<typeof vi.fn>).mock.calls;
  expect({
    first: calls[0]![0].launchCommand,
    storedAfterArchiveRestore: afterArchiveRestore,
    second: calls.at(-1)![0].launchCommand,
  }).toEqual({
    first: "mock --resume --perms default",
    storedAfterArchiveRestore: "default",
    second: "mock --resume --perms default",
  });
});
```
