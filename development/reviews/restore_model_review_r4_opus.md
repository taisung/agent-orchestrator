# Restore spawn-identity re-check, round 4: `5b488fdb..b27525dc`

Reviewer: Claude Opus 5.5 (ao-32), the round-1 to round-3 reviewer. Date: 2026-10-15.
Author: Muse (OpenCode, ao-30). Worktree HEAD: `b27525dc fix(core): fail safe to suggest for a
malformed stored mode`. Range: one commit, 5 files, `87 insertions(+), 13 deletions(-)`.

**Verdict: LAND-SAFE**

The commit fixes M-2 and m-7. It fixes m-8 in both comments, but the new test name is not exact
(m-12). I found 0 blockers, 0 majors, 2 new minor findings (m-11, m-12) and 2 notes (N-15, N-16).
The only executable change is one fallback value, `"default"` → `"suggest"` at
`agent-selection.ts:95`. Everything else is comments and tests.

| Item | Status | Evidence |
|---|---|---|
| M-2 (round 3) | **Fixed** | New test `restore-permissions.test.ts:412`. It fails when the copy-back line `session-manager.ts:2881` is removed (section 5). It checks the stored value after the archive restore, and the commands of both restores. |
| m-7 (round 3) | **Fixed** | A damaged stored value now gives `suggest` (23 spellings, section 3). `suggest` gives the same bytes as `default` for Claude Code, Gemini and OpenCode, and adds only `--ask-for-approval untrusted` for Codex. The "no mode" value is still `default`. |
| m-8 (round 3) | **Partly fixed** | The comments at `session-manager.ts:1423-1430` and `types.ts:1403-1404` are correct, and `config.ts` is unchanged. The new test name at `restore-permissions.test.ts:258` says the loader "always sets permissionless", which is not exact (m-12). |

Out of scope for this round, still open as owner decisions: m-9, m-10 and the YAML `permissionless`
default.

Scale (same as rounds 1 to 3): B = the landed code behaves wrongly or unsafely. M = a verified gap
that lets a regression pass. m = polish, an unstated change, or a low-probability risk.

## 1. How I ran everything (section 0)

- Every `pnpm` command and script ran under `env -i HOME=<scratch>/... PATH=<scratch>/bin:/usr/bin:/bin`:
  no `AO_*`, no `TMUX`. The scratch `bin` held a `tmux` shim (`unset TMUX; exec /usr/bin/tmux -L
  ao32r4test`), a `gh` stub, a `node` symlink, a `pnpm` wrapper, and fake `claude`, `codex`, `gemini` and
  `opencode` that log their arguments and `exec sleep 3600`. No model turn.
- Base copy: `git archive 5b488fdb | tar -x`. Mutation copy: `git archive b27525dc | tar -x`. Each has
  its own offline install and build. No `git stash`, no `git worktree add`.
- **No live `ao` run.** I judged that m-7 does not need one. The commit changes one fallback value and
  no code path. Round 3 showed live that the stored mode reaches the plugin on the `--resume` and Codex
  `resume` paths. Section 3 runs the real parser, the real `resolveAgentSelection` and the four real
  plugin builds on that value. So I started no tmux server and no lifecycle worker.
- `git diff 5b488fdb b27525dc` shows no change to `config.ts`, to any plugin `index.ts`, or to
  `agent-workspace-hooks.ts`. The packages of the landed `5b488fdb` are identical to the `cfb64f67` that
  I reviewed in round 3 (`git diff --stat cfb64f67 5b488fdb -- packages` is empty).

## 2. Command summaries (my own runs, in my worktree at `b27525dc`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0, `Done in 1.2s` |
| `pnpm build` | exit 0, `packages/cli build: Done` |
| `pnpm --filter <core + 4 agents> test` | exit 0. core `Test Files  35 passed (35)` / `Tests  829 passed (829)` (`restore-permissions.test.ts (15 tests)`, `restore-model.test.ts (9 tests)`, `restore.test.ts (24 tests)`); claude-code `Tests  175 passed (175)`; codex `Tests  214 passed (214)`; gemini `Tests  61 passed (61)`; opencode `Tests  163 passed (163)` |
| `pnpm --filter <core + 4 agents> typecheck` | exit 0, 5 × `typecheck: Done` |
| `pnpm lint` | exit 0, `✖ 5 problems (0 errors, 5 warnings)`, the same 4 files as in round 3 (old warnings) |
| `pnpm test` (full) | exit 0. core 829, gemini 61, claude-code 175, codex 214, notifier-desktop 26, runtime-herdr 36, scm-github `140 passed \| 5 skipped (145)`, tracker-github 42, runtime-tmux 30, workspace-worktree 46, opencode 163, integration `Tests  95 passed \| 24 skipped (119)` with `agent-opencode.integration.test.ts (31 tests \| 5 skipped)`, cli 243 |
| `prettier --check` on the 5 changed files | `All matched files use Prettier code style!` |

Core grew by 1 test (the M-2 test) and codex by 1 test (m-11). My counts match the author's D3.

## 3. Item 2 (m-7): byte compare

A scratch script ran on the `b27525dc` build under a fake `HOME` (with a Claude session JSONL, a Codex
rollout file and a Gemini `tmp` directory). For each stored value, it ran the line
`permissions=<value>` through `parseKeyValueContent`, then `resolveAgentSelection` (role `worker`,
config `permissionless`), then the four plugins.

**3.1 Stored `suggest` against stored `default`:**

| Command | Bytes equal? |
|---|---|
| claude-code launch, claude-code `--resume` | equal |
| gemini launch, gemini `-r latest` | equal |
| opencode launch | equal |
| opencode restore | not run (see below) |
| codex launch, codex `resume` | not equal, and equal after I remove ` --ask-for-approval untrusted` |

```
default codex resume: 'codex' resume -c check_for_update_on_startup=false --model 'prov/m-A' 'thread-bc'
suggest codex resume: 'codex' resume -c check_for_update_on_startup=false --ask-for-approval untrusted --model 'prov/m-A' 'thread-bc'
```

I did not run the OpenCode restore, because it calls `session.get` on the OpenCode service (read-only
for me). Its command depends only on the stored session ID and the model
(`agent-opencode/src/index.ts:669-675`), and the plugin reads no permission mode anywhere.

**3.2 Strictness.** Launch flags per canonical mode:

| Mode | claude-code | codex | gemini | opencode |
|---|---|---|---|---|
| `suggest` | – | `--ask-for-approval untrusted` | – | – |
| `default` | – | – | – | – |
| `auto-edit` | `--dangerously-skip-permissions` | `--ask-for-approval never` | – | – |
| `permissionless` | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` | – |

So `suggest` is now the strictest AO mode for every plugin. For Claude Code, Gemini and OpenCode it
equals `default`. For Codex it is stricter than `default`, which sends no flag and so uses
`~/.codex/config.toml` (round-3 N-13).

**3.3 Every stored spelling.** "Same" means all 7 commands are byte-equal to those of the canonical mode
that the selection gives.

| Stored value | Parsed | Selection | Same | Restore flags (claude / codex / gemini) |
|---|---|---|---|---|
| `default` | `default` | `default` | yes | – / – / – |
| `suggest`, `"suggest\r"` | `suggest` | `suggest` | yes | – / `--ask-for-approval untrusted` / – |
| `auto-edit` | `auto-edit` | `auto-edit` | yes | skip / `--ask-for-approval never` / – |
| `permissionless`, `" permissionless "` | `permissionless` | `permissionless` | yes | skip / bypass / `--yolo` |
| `skip`, `"\tskip"` | `skip` | `permissionless` | yes | skip / bypass / `--yolo` |
| `""`, `bogus`, `PERMISSIONLESS`, `Skip`, `SUGGEST`, `Default`, `permissionless # note`, `skip!`, `yolo`, `auto_edit`, `never`, `untrusted`, `none`, `0`, `false` | unchanged | `suggest` | yes | – / `--ask-for-approval untrusted` / – |

No stored spelling gives more than its canonical value. The parser trims whitespace (including `\r`).
Every value that is not a canonical mode or `skip` now gives the strictest mode, also for case variants
of valid modes (`Default` → `suggest`). That is stricter than needed, and it is correct for a fail-safe.

**3.4 The "no mode" value is still `default`.** `session-manager.ts:1440` is unchanged
(`permissions: selection.permissions ?? "default"`). The test "a config object with no mode stores
default" (`:258`) passes. The `spawn-stores-suggest` mutant (section 5) shows that it guards this.
Round 3 showed that a stored `default` gives the same bytes as a spawn with no mode, for all four
plugins. With the real loader, this case does not occur: the same script loaded a YAML with no
`agentConfig` key and a YAML with `agentConfig: {}`. Both gave `agentConfig.permissions=permissionless`
and `selection.permissions=permissionless`.

## 4. Items 1 and 3: the M-2 test and the m-8 text

**M-2.** `restore-permissions.test.ts:412-447` is the round-3 appendix test, adapted to the file's
helpers. It archives a record with `permissions=default` (`deleteMetadata`, as `ao session kill` does),
restores it under a `permissionless` config, reads the stored value, sets `status=killed`, makes
`isAlive` false, and restores again. One `toEqual` checks the first command, the stored value after the
archive restore, and the second command. It passes on `5b488fdb` (the copy-back line exists there), and
it fails when the line is removed (section 5).

**m-8.** The comments now say that the YAML loader always sets a mode, with the default
`permissionless`:

- `session-manager.ts:1423-1430`: "`default` when the config object sets no mode — the YAML loader
  always sets one, its default is `permissionless`". Correct.
- `types.ts:1403-1404`: the same statement. Correct. The declaration `permissions?: string;` did not
  change.
- `restore-permissions.test.ts:258`: "a config object with no mode stores default (the YAML loader
  always sets permissionless)". Not exact: the loader always sets *a* mode, and it sets
  `permissionless` only when the YAML has none (m-12).
- The `agent-selection.ts:88-95` comment is new for m-7 and matches table 3.1.

## 5. Items 4 and 5: tests and mutants

**Non-vacuity on `5b488fdb`.** With the new test files copied onto the base sources:
`restore-permissions.test.ts` gives `Tests  4 failed | 11 passed (15)`. The 4 malformed-value tests fail:

```
  [
-   "suggest",
+   "default",
  ]
```

The other 11 pass, the M-2 test included (it guards a line that exists on the base). In codex,
`-t "untrusted"` gives `Tests  3 passed | 158 skipped (161)` on the base, because the plugin did not
change (m-11).

**Mutation.** I applied each mutant to the `b27525dc` copy (built, so `plugin-integration.test.ts`
loads) and ran the whole core package (`vitest run`, 829 tests) or, for the Codex mutant, the whole
codex package (214 tests). Both pristine runs pass.

| Mutant | Change | Tests that fail |
|---|---|---|
| `failsafe-default` | `?? "suggest"` → `?? "default"` (`agent-selection.ts:95`) | 4 of 829: the 4 malformed-value tests |
| `failsafe-config` | a malformed value → the current config | 4: the same |
| `failsafe-permissionless` | a malformed value → `permissionless` | 4: the same |
| `failsafe-auto-edit` | a malformed value → `auto-edit` | 4: the same |
| `stored-loses-to-config` | the stored mode wins only when the config has no mode | 9: the 4 malformed, spawn-stores, config-object-no-mode, stored-permissionless-wins, restore-before-send, the M-2 test |
| `stored-not-read` | core never passes the stored mode (`session-manager.ts:1029`) | 9: the same |
| `missing-key-as-default` | an old record gets the fail-safe value | 4: N-2 "agree", config-object-no-mode, old-record, spawn-stores |
| `spawn-no-default` | the spawn stores no mode when none is set (`:1440`) | 1: config-object-no-mode |
| `spawn-stores-suggest` | the spawn stores `suggest` when none is set (`:1440`) | 1: config-object-no-mode |
| `spawn-model-explicit-only` | the spawn stores only an explicit `--model` (`:1439`) | 1: spawn-stores |
| `model-config-first` | the config model before the stored model (`agent-selection.ts:80`) | 4: `restore-model` "a config model changed after spawn…", restore-before-send, spawn-stores, `spawn.test.ts` "prefers spawn model override over configured model…" |
| `archive-drops-permissions` | the archive copy-back drops `permissions` (`:2881`) | **1: the M-2 test** (round 3: none) |
| `archive-drops-model` | the archive copy-back drops `model` (`:2880`) | 1: `restore-model` "keeps the persisted model when restoring from archive" |
| `orchestrator-reads-stored-mode` | remove both `role === "worker"` guards for the mode | none (equivalent for restore, round-3 N-11) |
| `metadata-write-drops-permissions` | `writeMetadata` drops `permissions` (`metadata.ts:147`) | 5: config-object-no-mode, the M-2 test, restore-before-send, spawn-stores, stored-permissionless-wins |
| `codex-suggest-no-flag` | the Codex plugin sends no flag for `suggest` (`agent-codex/src/index.ts:300-301`) | 3 of 214: launch "includes --ask-for-approval untrusted when permissions=suggest", restore `:1285`, restore `:1307` (m-11) |

Every round-3 mutant that applies still fails tests, and each fails at least the tests that caught it
in round 3. The one exception is `missing-key-as-default`: with the new fail-safe value, the
`spawn.test.ts` orchestrator test no longer sees it, but 4 other tests do. The M-2 gap is closed.

## 6. Findings

### m-11: The new Codex test repeats an existing test

File: `packages/plugins/agent-codex/src/index.test.ts:1307-1328`.

The new test "maps a stored suggest mode to --ask-for-approval untrusted on restore" has the same
fixture, the same input (`agentConfig: { permissions: "suggest" }`) and the same assertion as the
existing test "includes --ask-for-approval untrusted from project config" (`:1285-1305`). It adds only
`not.toContain("--dangerously-bypass-approvals-and-sandbox")`. The plugin cannot see whether a mode came
from the metadata or from the config, so "stored" adds no case. The `codex-suggest-no-flag` mutant fails
both tests (section 5). The author's report says the same.

Reproducer: compare `:1285-1305` with `:1307-1328`.

Action (optional): delete the new test, or move its `not.toContain` line into the existing test.

### m-12: The m-8 test name says the loader "always sets permissionless"

File: `packages/core/src/__tests__/session-manager/restore-permissions.test.ts:258`.

The loader sets the mode that the YAML gives, and it sets `permissionless` only when the YAML gives
none (`config.ts:132-135`, `:200`). The two comments say this correctly. The test name says "the YAML
loader always sets permissionless", which a reader can take to mean that a YAML `default` is
overridden. Because the owner still has the YAML default as an open decision, the text should be exact.

Reproducer: read `:258` next to `session-manager.ts:1425-1427`.

Action (optional): rename to "a config object with no mode stores default (the YAML loader always sets
a mode; its default is permissionless)".

## 7. Notes

- **N-15 (fail-safe effect on Codex).** A Codex worker with a damaged `permissions=` line now restores
  with `--ask-for-approval untrusted`. An unattended worker then waits for approval on commands that are
  not trusted, and `ao status` shows it as `waiting_input`. This is the safe direction, and it is what
  the owner chose. The cause is visible only in the metadata file.
- **N-16 (author evidence).** The author's D1 to D4 match my runs: core `15 passed (15)` for
  `restore-permissions`, the three D2 mutants fail the tests named, and the D3 counts are equal. This
  round the author started no tmux server and no `ao` run. I found no process with a `HOME` under
  `/tmp/opencode` and no `ao30*` tmux socket.

## 8. What I found correct

- The fail-safe change is one value at the one place (`agent-selection.ts:95`). It never falls back to
  the config.
- `suggest` is the strictest AO mode for all four plugins. It changes the command only for Codex, and
  only by `--ask-for-approval untrusted` (byte compare).
- The "no mode" value stays `default` (`session-manager.ts:1440`), so a restore still matches its spawn.
- The M-2 test is the guard that round 3 asked for, and it fails without the copy-back line.
- The malformed-value tests now check the mode that core passes (`suggest`), not only the absence of a
  Claude flag.
- The round-1 to round-3 behaviour is unchanged: no executable change outside the fallback value, and
  every round-3 mutant that applies still fails tests (section 5).
- `config.ts`, the plugin sources, the metadata helper, the `~/.ao/bin` code, the I-2 OpenCode code and
  the `getRestoreCommand` interface are unchanged.

## 9. Item 6: scope and commit

- The 5 files are all in the author brief section 2: `agent-selection.ts`, `session-manager.ts`
  (comments only), `types.ts` (comments only), `core/src/__tests__/session-manager/restore-permissions.test.ts`
  and `agent-codex/src/index.test.ts`.
- The message is conventional (`fix(core): ...`) and states the WHY (the Codex gap of a damaged record,
  why the "no mode" value stays `default`, the M-2 guard, the m-8 text). No `Co-Authored-By` or other
  trailer, no emoji, no issue number.
- `git branch -r --contains b27525dc` prints nothing.

## 10. Cleanup

- This round started no `ao` command, no tmux server and no lifecycle worker. The `pnpm test` runs used
  the shim label `ao32r4test`. No server stayed on it, and I removed its socket file.
- A `/proc` scan finds no process with a scratch `HOME`. `ps -o pid,args -u "$(id -u)"`, filtered by my
  scratch path, prints an empty list.
- I removed all scratch state (the base copy, the mutation copy, the fake homes, the logs and the
  scripts). The scratch directory is empty.
- The five real lifecycle workers (288652, 289254, 289313, 289330, 289549) still run. I did not touch
  them.
- No `git stash`, no `git worktree add`, no commit, no push, no PR, no `ao send`.
