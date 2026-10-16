# Blind review r1: limit the metadata helper to the wrapper keys (m-10)

- Range: `7126a275..63567df0` (1 commit, 7 files, +284/-14).
- Author: Muse (OpenCode, ao-33). Brief: `brief-aofork-helper-keys.md`.
- Reviewer: ao-32 (Claude Opus 5.5). Date: 2026-10-16.
- Method: source reading, live runs in a scratch environment (fake `HOME`, scratch `PATH`, no `AO_*`,
  private tmux servers `-L ao32h1-head` and `-L ao32h1-base`), gates, non-vacuity on `7126a275`, and 13
  mutants. I read the author report only after review items 1 to 4.
- `<S>` below is my scratch directory under `/tmp/claude-44402/...`. I removed it at the end.

## Verdict

**LAND-SAFE.**

**m-10: fixed for the documented path.** On `63567df0`, `update_ao_metadata` refuses every key except
`pr`, `branch` and `status`, and it refuses every `status` value except `pr_open`. A refused call writes
nothing, prints one line to stderr and returns 1. A live restore after the refused calls keeps the stored
mode. On `7126a275` the same calls raise the mode (the round-3 result again).

Findings: 0 B, 1 M, 2 m, 8 notes.

- **M-3 (rollout, not a code defect):** a resident `ao` process that runs 0.2.3 code installs the 0.2.3
  helper again over 0.2.4, and m-10 is open again. Restart the resident `ao` processes after the global
  rebuild.
- **m-13 (old, not from this commit):** the allowed keys accept any value. A `branch` value that starts
  with `-` gets to `git worktree add` as an option at restore. Shown live: it resets another branch.
- **m-14 (outside this repository):** `~/agent-skills/skills/ao-lifecycle/SKILL.md:854-860` still tells
  the reader to call `update_ao_metadata <key> <value>` as a "Manual fallback".

## 1. m-10 status (review item 1)

### 1.1 Direct helper calls, head and base

`<S>/scripts/probe.sh` installs the helper and the wrappers with `setupPathWrapperWorkspace` into a fake
`HOME`, from a `63567df0` copy (head) and from a `7126a275` copy (base). Each call starts from the same
record (`worktree=…`, `branch=main`, `status=working`, `permissions=default`, `agent=codex`).

| Call (`update_ao_metadata <key> <value>`) | head `63567df0` | base `7126a275` |
| --- | --- | --- |
| `permissions permissionless` | rc=1, unchanged | rc=0, writes `permissions=permissionless` |
| `role orchestrator` | rc=1, unchanged | rc=0, writes `role=orchestrator` |
| `model model-X` | rc=1, unchanged | rc=0, writes `model=model-X` |
| `agent claude-code` | rc=1, unchanged | rc=0, writes `agent=claude-code` |
| `status merged` / `done` / `working` | rc=1, unchanged | rc=0, writes (working: no change) |
| `status 'pr_open '` / `status PR_OPEN` | rc=1, unchanged | rc=0, writes |
| `status $'pr_open\npermissions=permissionless'` | rc=1, unchanged | rc=0, writes `status=pr_openpermissions=permissionless` |
| `''` (empty key) | rc=1, unchanged | rc=0, unchanged (old regex, silent) |
| `' pr'`, `'pr '`, `'pr=x'`, `$'pr\npermissions'`, `'pr*'` | rc=1, unchanged | rc=0, unchanged (silent) |
| `PR x`, `Status pr_open` | rc=1, unchanged | rc=0, writes `PR=x`, `Status=pr_open` |
| `pr https://github.com/o/r/pull/1` | rc=0, writes | rc=0, writes |
| `status pr_open` | rc=0, writes | rc=0, writes |
| `branch feat/x` | rc=0, writes | rc=0, writes |

Every head refusal prints exactly one stderr line, for example
`ao-metadata-helper: refusing key 'permissions' (allowed: pr, status, branch)` and
`ao-metadata-helper: refusing status value 'merged' (only pr_open allowed)`.

Values cannot add a key. The helper removes `\n` from the value. A value with `\r` stays in one line, and
the core parser (`parseKeyValueContent`) keeps it in one key:
`{"permissions":"default","pr":"upermissions=permissionless\rrole=orchestrator","branch":"bpermissions=permissionless"}`.

### 1.2 Live spawn and restore (round-3 reproducer)

`<S>/scripts/live.sh` (codex, `worker.agentConfig.permissions: default`, fake codex that only logs its
arguments). The script first starts a probe pane and checks its `environ`: `HOME=<S>/live-<v>/home`,
first `PATH` entry `<S>/bin`, `AO_vars=0`. Then `ao spawn` twice, the helper calls in the `demo-1` pane
environment, a stop of the tmux session, and `ao session restore demo-1`.

```text
head: installed ~/.ao/bin version: 0.2.4
head: permissions permissionless: ao-metadata-helper: refusing key 'permissions' (allowed: pr, status, branch) rc=1
head: role orchestrator: ao-metadata-helper: refusing key 'role' (allowed: pr, status, branch) rc=1
head: demo-1 record: branch=session/demo-1 agent=codex permissions=default
head: demo-1 restore argv:   argv: [resume] [-c] [check_for_update_on_startup=false] [--model] [recorded-default] [thread-fake-1]

base: installed ~/.ao/bin version: 0.2.3
base: permissions permissionless: rc=0
base: role orchestrator: rc=0
base: demo-1 record: branch=session/demo-1 agent=codex permissions=permissionless role=orchestrator
base: demo-1 restore argv:   argv: [resume] [-c] [check_for_update_on_startup=false] [--dangerously-bypass-approvals-and-sandbox] [--model] [recorded-default] [thread-fake-1]
```

After the restore on head, the mode stays `default` (no bypass flag). On base the restore starts codex
with `--dangerously-bypass-approvals-and-sandbox`.

The fix closes the documented path only. An agent with shell access can still write the record file
directly (see N-17).

## 2. Findings

### M-3: a resident 0.2.3 process undoes the fix (rollout)

- Where: `packages/core/src/agent-workspace-hooks.ts:536`. The installer compares the marker for
  equality (`existing.trim() === WRAPPER_VERSION`). Any process with other constants writes its own
  helper, older or newer.
- Path: `lifecycle-manager.ts:634`, `:1035` and `:1134` call `sessionManager.send()`. For a dead
  session, `send()` (`session-manager.ts:2288`) calls `restoreForDelivery` (`:2436`), then `restore()`,
  then the agent `postLaunchSetup`. For codex, gemini and opencode that calls `setupPathWrapperWorkspace`
  (`agent-codex/src/index.ts:690`, `agent-gemini/src/index.ts:275`, `agent-opencode/src/index.ts:679`).
- The five real lifecycle workers on this host started with the 0.2.3 code. The real `~/.ao/bin` holds
  exactly the base helper: sha256 `64c9f158…`, the same as my base install. Node keeps the module
  constants in memory, so a global rebuild does not change them.
- Evidence (fake `HOME`, `<S>/inst2`): install from base, then head, then base again, then head again.

```text
1 base install (ws-old)      ver=0.2.3 ao-metadata-helper.sh=64c9f158 gh=adb33f1e git=fbee814d
    helper permissions permissionless: rc=0 record permissions=permissionless
2 head install (ws-new)      ver=0.2.4 ao-metadata-helper.sh=2deab7f6 gh=adb33f1e git=fbee814d
    helper permissions permissionless: rc=1 record permissions=default
4 base again (old process)   ver=0.2.3 ao-metadata-helper.sh=64c9f158 gh=adb33f1e git=fbee814d
    helper permissions permissionless: rc=0 record permissions=permissionless
5 head again                 ver=0.2.4 ao-metadata-helper.sh=2deab7f6 gh=adb33f1e git=fbee814d
    helper permissions permissionless: rc=1 record permissions=default
```

  Step 4 also writes the old `.ao/AGENTS.md` (with the generic call) into that workspace again.
- Effect: after the global rebuild, one automatic restore by an old lifecycle worker (a reaction message
  to a dead session) puts back the helper that accepts any key, for every fleet on this host. Nothing
  shows it. The next 0.2.4 install changes it back.
- Action (owner, at rollout): after the global rebuild, restart the five lifecycle workers and any other
  resident `ao` process. Then check `cat ~/.ao/bin/.ao-version` (`0.2.4`) and
  `grep -c refusing ~/.ao/bin/ao-metadata-helper.sh` (`2`). The PATH-fix reviews gave the same rollout
  rule ("quiesce or replace them before rollout").
- Optional follow-up: let the installer refuse to write an older version over a newer marker. This helps
  only future rollouts, because the 0.2.3 code in memory does not have the check.
- Not a code defect of `63567df0`. No change in this commit can correct code that already runs. For
  this reason the verdict is LAND-SAFE, with this rollout condition.

### m-13: allowed keys accept any value, and restore gives `branch` to git as an option (old)

- Where: the helper checks only the key (`agent-workspace-hooks.ts:248-260`). The Claude hook takes the
  branch from the command text with `([^[:space:]]+)` (`agent-claude-code/src/index.ts:172-178`).
  Restore passes the stored branch (`session-manager.ts:2906`) to
  `git worktree add <path> <branch>` (`packages/plugins/workspace-worktree/src/index.ts:276`), with no
  `--` and no check.
- Evidence, live, the same on head and base (`<S>/scripts/live.sh`, `demo-2`):

```text
head: victim before: 6218c16 victim-only work
head: branch -Bvictim: rc=0
head: demo-2 record branch: branch=-Bvictim
head: Session demo-2 killed. / Session demo-2 restored.
head: victim after: 27d4d44 init
head: victim reflog: 27d4d44 branch: Reset to HEAD 6218c16 commit: victim-only work
head: worktrees: … <S>/live-head/home/.worktrees/demo/demo-2  27d4d44 [victim]
```

  Git reads `-Bvictim` as "create or reset branch `victim`". The branch loses its own commit, which
  stays only in the reflog. Git refuses `-f -B` on a branch that another worktree uses. A free branch
  is open.
- The Claude hook path gets the same value from a command text. A head hook (from the head dist) with
  the event `{"tool_name":"Bash","tool_input":{"command":"git checkout -b -Bvictim"},"tool_response":"fatal: …"}`
  writes `branch=-Bvictim`. The hook checks only a top-level `exit_code` field, with the default 0.
- The `git` wrapper does not have this problem: it stores the real HEAD branch, and git refuses a branch
  name that starts with `-`.
- Severity: minor. The behaviour is old (base is the same), it is outside m-10 (restore mode), and the
  agent can reset a free branch with its own git. The difference: here the orchestrator process runs the
  git command, outside the agent sandbox and approvals.
- Suggested follow-up (new task, not this commit): in the helper and the hook, refuse a `branch` value
  that `git check-ref-format --branch` refuses or that starts with `-`. In `restore`, check `cfg.branch`
  the same way. The `pr` value also has no check (any string), and the lifecycle tracks whatever it
  holds.

### m-14: `~/agent-skills` still documents the generic call (outside this repository)

- Where: `~/agent-skills/skills/ao-lifecycle/SKILL.md:854-860`, "### Manual fallback": "update metadata
  directly: … `update_ao_metadata <key> <value>`". The same section, line 852, lists `status`, `agent`
  and `role` as key fields.
- Effect after the fix: the fallback works only for `pr`, `status pr_open` and `branch`. Any other call
  returns 1 with one stderr line, so nothing fails silently. The text contradicts the new AGENTS.md
  ("Do not edit the session record").
- Other callers in `~/agent-skills` (read only): only `update_metadata_key` in two old copies of the
  Claude hook, with literal keys `pr`, `status pr_open`, `branch` and `status merged`:
  `~/agent-skills/.claude/metadata-updater.sh` (untracked, 2026-10-15 11:42, written by an ao Claude
  session in that checkout) and `skillsets/nexus/.claude/metadata-updater.sh` (tracked, 2026-03-30).
  Nothing in them breaks. ao rewrites a workspace copy on the next Claude spawn or restore.
- Suggested follow-up: change the SKILL.md fallback in `~/agent-skills` to name the three keys, or remove
  it. The author brief did not allow that file.

## 3. Notes

- **N-17:** the fix closes the documented path. An agent with shell access can still write the record
  file directly (`echo permissions=permissionless >> "$AO_DATA_DIR/$AO_SESSION"`). This is the same class
  as round-2 N-8 (`role=orchestrator`). The author report says the same ("defense-in-depth, not a
  sandbox").
- **N-18 (item 5, AGENTS.md timing):** `setupPathWrapperWorkspace` writes `<workspace>/.ao/AGENTS.md`
  completely on every call (`agent-workspace-hooks.ts:566-571`). A workspace with the old text gets the
  new text at its next spawn, restore or `setupWorkspaceHooks` by a 0.2.4 process (live: `ws-old` went
  from 1 generic-call line to 0 at step 3). A running session keeps the old text until then. Its generic
  call then fails loudly (rc=1, one stderr line), because `~/.ao/bin` is shared and the first 0.2.4
  install changes the helper for all sessions. A running Claude session keeps its old
  `.claude/metadata-updater.sh` (no key check) until its next spawn or restore. Its keys are literal, so
  the normal hook path gives no new exposure.
- **N-19 (item 5, install):** between 0.2.3 and 0.2.4 only the helper text changes. The `gh` and `git`
  files have the same hashes (`adb33f1e…`, `fbee814d…`). The installer writes all three files and the
  marker. The installed files are equal to the module constants (`AO_METADATA_HELPER`, `GH_WRAPPER`,
  `GIT_WRAPPER` from `dist/agent-workspace-hooks.js`: `true`).
- **N-20 (item 3):** the hook writes `status=merged` on any command text that starts with `gh pr merge`.
  This is old behaviour, from `8e5b23e6` (2026-02-15, "auto-update session metadata via Claude Code
  hooks"). It is the known "direct-merge limit" (`development/TODO_TRACKING.md:143`). My head hook test
  wrote `status=merged` for `gh pr merge 999 --squash` with an error text and no `exit_code` field. I did
  not check whether Claude Code sends PostToolUse for a failed Bash call. The new key check does not
  change this behaviour. An agent cannot choose the hook key through the normal PostToolUse path: the
  callers at `:165-166`, `:178`, `:192` and `:200` use literal keys. The agent controls only the
  `branch` value (m-13) and, through the output text, a URL that matches the PR pattern.
- **N-21 (item 2.1, lifecycle):** the author explanation is correct. `TERMINAL_STATUSES` holds `merged`
  and `done` (`types.ts:113-120`). `pollAll` skips a session in a terminal status after one transition
  (`lifecycle-manager.ts:1305-1309`). So an agent-written `done` or `merged` hides the session from
  CI, review and stuck reactions. The helper now refuses both.
- **N-22 (tests):** two plugin content tests are weak, but the live tests catch the same mutants.
  `agent-claude-code/src/index.test.ts` "refuses privileged status values" uses
  `/pr_open.*merged|merged.*pr_open/`, which the refusal `echo` line also matches (mutant C3 passes it).
  The git-wrapper refusal test in core checks strings only. My live run covers it (section 4).
- **N-23 (landing order):** `63567df0` is not on top of fork `main` (`994198e1`). The m-7 fix
  `25a56f30` is on `main`, not in this range. The patch applies to `994198e1` with one hunk offset
  (codex test, +23 lines). On that copy the filtered tests pass: core 844, codex 215, claude-code 188,
  gemini 62, opencode 163.
- **N-24 (commit text):** the body is one line of 446 characters. The rules hold (see item 9). Wrap the
  body at 72 characters in a later commit if the repository wants that.

## 4. Review items 2 to 9

**Item 2, wrappers (head, `<S>/scripts/probe.sh`):**

```text
gh pr create rc=0 stdout=[https://github.com/scratch/demo/pull/77] stderr=[fake-gh progress: pr create --title t] record: status=pr_open pr=https://github.com/scratch/demo/pull/77
gh pr create (gh exits 3) rc=3 record: status=working
git switch -c feat/probe rc=0 record branch: branch=feat/probe
git checkout --detach rc=0 record branch: branch=feat/probe
git switch no-such-branch rc=128 record branch: branch=feat/probe
== wrappers with a helper that refuses every call
gh pr create rc=0 stdout=[https://github.com/scratch/demo/pull/77] stderr=[fake-gh progress: pr create --title t|ao-metadata-helper: refusing key  pr|ao-metadata-helper: refusing key  status|]
gh pr create (gh exits 4) rc=4
git switch -c feat/refused rc=0 stderr=[ao-metadata-helper: refusing key  branch|] record branch: branch=main
git switch no-such-branch rc=128
```

- The wrappers write `pr=`, `status=pr_open` and `branch=`. A failed `gh` writes nothing. A detached
  HEAD and a failed switch keep the stored branch. The `gh` wrapper has no `merged` path. The base gives
  the same lines.
- A refusal cannot change the exit code or stdout. The gh wrapper saves `exit_code=${PIPESTATUS[0]}`
  (`:362`) before the calls at `:367-368`. The git wrapper calls the helper at `:471` and exits with the
  saved code. Neither wrapper sets errexit. A refusal adds one stderr line. With the real helper the
  wrappers call only allowed keys and values, so no refusal line comes in normal use.

**Item 3:** see N-20 and m-13. The hook key check (`agent-claude-code/src/index.ts:106-118`) is
defence in depth. It matches the literal callers exactly. `merged` stays allowed because the hook writes
it at `:200`. Mutant C5 (no `merged`) breaks 3 existing `gh pr merge` tests.

**Item 4:** in this repository, no other text tells an agent to write its session record.
`orchestrator-prompt.ts:152` describes the effect of `--claim-pr`, and `:235` says "Trust the metadata"
(read only). `changelog/hash-based-architecture-migration.md:173-182` names `AO_DATA_DIR` for hook
scripts and gives no write instruction. The helper header comment (`:200`) now names the three keys.

**Item 5:** see N-18, N-19 and M-3.

**Item 6:** see m-14. In this repository the only callers are the two wrappers and the Claude hook, with
literal keys.

**Item 7, no collateral change:** the helper diff has four hunks: `WRAPPER_VERSION`, the header comment,
the `case` block that replaces the old key regex (`^[a-zA-Z0-9_-]+$`), and the AGENTS.md text. The
Claude diff has one hunk in `update_metadata_key`. The restore code, option 1, the I-2 OpenCode code and
the PATH resolution code are not in the diff. The removed key regex protected the `sed` call. The new
`case` admits only three literal keys, so the `sed` call stays safe.

**Item 8, gates (worktree `63567df0`, fake `HOME`, no `AO_*`):**

```text
filtered test (core + 4 agent plugins): rc=0
  packages/core:                     Test Files 35 passed (35)   Tests 843 passed (843)
  packages/plugins/agent-claude-code: Test Files 3 passed (3)    Tests 188 passed (188)
  packages/plugins/agent-codex:      Test Files 3 passed (3)     Tests 214 passed (214)
  packages/plugins/agent-gemini:     Test Files 1 passed (1)     Tests 62 passed (62)
  packages/plugins/agent-opencode:   Test Files 1 passed (1)     Tests 163 passed (163)
filtered typecheck: rc=0, 5x "typecheck: Done"
full typecheck: rc=0, 13x "typecheck: Done"
pnpm lint: rc=0, "✖ 5 problems (0 errors, 5 warnings)" (old: spawn.ts, activity-log.ts, plugin-registry.ts, session-manager.ts)
full pnpm test: rc=0
  core 843, gemini 62, claude-code 188, codex 214, notifier-desktop 26, runtime-herdr 36,
  scm-github 140 passed | 5 skipped (145), tracker-github 42, workspace-worktree 46, runtime-tmux 30,
  opencode 163, integration-tests 95 passed | 24 skipped (119), cli 243
```

Non-vacuity: the 5 changed test files from `63567df0` on the `7126a275` sources.

```text
core agent-workspace-hooks.test.ts:  Tests 10 failed | 67 passed (77)
claude-code index + hook-script:     Tests 9 failed | 136 passed (145)
codex index.test.ts:                 Tests 1 failed | 160 passed (161)
gemini index.test.ts:                Tests 1 failed | 61 passed (62)
```

The failed tests are exactly the new refusal, AGENTS.md, version and content tests. The tests for the
allowed writes pass on base, as expected.

Mutants (`<S>/scripts/mutants.py`, on a `63567df0` copy, core rebuilt for each helper mutant). Every
mutant fails at least one test:

| Mutant | Tests that catch it |
| --- | --- |
| H1 helper allows `permissions` | core 2 (refuses permissions, review reproducer) |
| H2 helper prints the key refusal but still writes | core 6 (refuses agent, model, permissions, role, unknownkey, reproducer) |
| H3 helper drops the `status` value check | core 2 (status done, merged), codex 1, gemini 1 |
| H3b helper also accepts `status merged` | core 1 (status merged), codex 1, gemini 1 |
| H4 `status` refusal returns 0 | core 2 (status done, merged) |
| H4b key refusal returns 0 | core 6 |
| H5 AGENTS.md keeps the generic call | core 1 (AGENTS.md test) |
| H6 `WRAPPER_VERSION` stays 0.2.3 | core 1 (version test) |
| C1 hook allows `permissions` | claude-code 1 (hook-script refuses permissions) |
| C2 hook prints the key refusal but still writes | claude-code 5 |
| C3 hook drops the `status` value check | claude-code 2 (status done, working) |
| C4 hook refusals return 0 | claude-code 7 |
| C5 hook drops `merged` | claude-code 6 (3 existing `gh pr merge` tests, 2 existing metadata-update tests, the direct-call `status merged` test) |

The opencode tests catch no helper mutant. They do not check the helper text.

**Item 9, scope and commit:** the 7 files are in the brief section 3 list.
`hook-script.integration.test.ts` is a claude-code test that checks the hook, which item 2.2 changes.
The message is conventional (`fix(core): …`), gives the WHY, has no `Co-Authored-By`, no emoji and no
issue number. `git branch -r --contains 63567df0` prints nothing.

## 5. What is correct

- The helper key check is exact: 3 keys, 1 `status` value, no glob, case or whitespace gap. It sits after
  the path checks and before any write. A refusal writes no temp file.
- One stderr line per refusal, with the key or the value, and return code 1.
- The wrappers keep their exit codes and stdout, with the real helper and with a helper that refuses
  every call.
- The PATH-fix rules hold: true values only, the real HEAD branch, never `merged`.
- The Claude hook check matches the hook's literal writes, and `merged` keeps the old hook behaviour.
- `WRAPPER_VERSION` 0.2.4 makes the installer rewrite the helper. The AGENTS.md text changes at the next
  setup of each workspace.
- The new core and hook tests run the real shell code and catch all 13 mutants. They fail on the base.
- The author's lifecycle explanation of agent-written `status` values is correct (N-21).
- No collateral change, scope and commit rules hold, and the commit is on no remote branch.

## 6. Safety and cleanup

- Real `~/.ao/bin`, before my work (the values that I recorded at the start of the task):

```text
drwxr-xr-x 2 taisung users 4096 2026-10-15 19:58:33.273310353 -0400 .
-rwxr-xr-x 1 taisung users 2350 2026-10-15 19:58:33.271310404 -0400 ao-metadata-helper.sh   sha256 64c9f158f03862d2923ad9c45b53f747107ac338b8548b45e810ceeb73d0bea1
-rw-r--r-- 1 taisung users    5 2026-10-15 19:58:33.273310353 -0400 .ao-version             0.2.3
-rwxr-xr-x 1 taisung users 2213 2026-10-15 19:58:33.272310379 -0400 gh                      sha256 adb33f1eb29d7ccbe02df980d8acc85549790cf528f1d3243f0649f671c2fcfd
-rwxr-xr-x 1 taisung users 3471 2026-10-15 19:58:33.272310379 -0400 git                     sha256 fbee814d6515680c35a2840dd9c5129d04dd0e4320c6f16e131a243d23a44c3e
```

- Real `~/.ao/bin`, after my work:

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 24
drwxr-xr-x 2 taisung users 4096 2026-10-15 19:58:33.273310353 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 2350 2026-10-15 19:58:33.271310404 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-15 19:58:33.273310353 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-15 19:58:33.272310379 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-15 19:58:33.272310379 -0400 git
$ cat ~/.ao/bin/.ao-version
0.2.3
$ sha256sum ~/.ao/bin/ao-metadata-helper.sh ~/.ao/bin/gh ~/.ao/bin/git
64c9f158f03862d2923ad9c45b53f747107ac338b8548b45e810ceeb73d0bea1  ~/.ao/bin/ao-metadata-helper.sh
adb33f1eb29d7ccbe02df980d8acc85549790cf528f1d3243f0649f671c2fcfd  ~/.ao/bin/gh
fbee814d6515680c35a2840dd9c5129d04dd0e4320c6f16e131a243d23a44c3e  ~/.ao/bin/git
```

  Same times, sizes, modes and hashes as before.

- I did not touch the five real lifecycle workers (288652, 289254, 289313, 289330, 289549). I used no
  tmux command on the default server. Every helper and wrapper install went into a fake `HOME`.
- Processes that I started and stopped by exact PID: lifecycle workers 1144291 (head) and 1144673 (base),
  then `tmux -L ao32h1-head kill-server` (server 1144251) and `tmux -L ao32h1-base kill-server` (server
  1144633). Fake agents (`sleep`) left: none, by working directory and `HOME`.

```text
$ ps -o pid,args -u "$(id -u)" | grep -F "<S>" | grep -v grep
(end of list)
```

- The five real lifecycle workers are alive (288652, 289254, 289313, 289330, 289549).
- `/tmp` state removed: all of `<S>` (the base, head and rebased copies, the fake homes, the live repos
  and worktrees, logs and scripts), the socket files `/tmp/tmux-44402/ao32h1-head`, `ao32h1-base` and
  `ao32h1test`, and the 48 `/tmp/ao-test-state-*` and `/tmp/ao-plugin-registry-*` entries that my three
  test runs made (23:55, 23:56, 23:58). I left the 2337 older entries of that kind, because they come
  from earlier runs of many workers.
- The worktree is at `63567df0`. `git status --porcelain` shows only `.agent_report.md`, `.agent_task.md`
  and this review file. I made no commit.
