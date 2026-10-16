# Blind review r2: m-15 to m-17 of the m-13 branch check

- Range: `ac0f662a..7f34bf4d` (1 commit, 7 files, +234/-35). `ac0f662a` differs from the landed m-13 fix
  `0ec55a64` only in `development/` files.
- Author: Muse (OpenCode, ao-35). Brief: `brief-aofork-branch-check-r2.md`.
- Reviewer: ao-32 (Claude Opus 5.5). Date: 2026-10-16.
- Method: source reading; live runs in a scratch environment (fake `HOME`, scratch `AO_STATE_ROOT`,
  scratch `PATH`, private tmux servers `-L ao32r2-head` and `-L ao32r2-base`, fake codex that only logs
  its arguments, `gh` stub, no network); a name table of 31,065 names against the real
  `git check-ref-format --branch` under six locale settings; a `pr` table of 34,558 URLs; gates;
  non-vacuity on `ac0f662a`; 11 mutants. I read the author report only after review items 1 to 4.
- `<S>` below is my scratch directory under `/tmp/claude-44402/...`. I removed it at the end.

## Verdict

**LAND-SAFE.**

| Finding | Status | Evidence |
| --- | --- | --- |
| m-15 (refused spawn leaves its record) | **fixed** | live: records 1 before, 1 after, no ghost, the next spawn reuses `demo-2` (base: two 0-byte ghosts, next spawn `demo-4`); unit tests fail on base; mutants W and O fail one test each |
| m-16 (bash branch rule depends on the locale) | **fixed** | table: both bash copies equal TypeScript on all 31,065 names under all six locale settings (§2.1); live wrapper and hook record the names that base refused; the caller's locale does not change |
| m-17 (hook `pr` end anchor has no test) | **fixed** | mutants PE (end anchor), PS (start anchor), PD1 and PD2 (digit class) fail 5, 1, 2 and 1 tests |

New findings: 0 B, 0 M, 1 m, 5 notes.

- **m-18 (not new in this commit, missed by my r1):** the bash `pr` checks (`ao_is_safe_pr`,
  `hook_is_safe_pr`) and the `pr` extract patterns still depend on the locale. With `LANG` or `LC_ALL` set
  to `en_US.UTF-8` (the `LANG` of this host and of the five real lifecycle workers), they accept 4,225
  URLs with non-ASCII letters or digits that `isSafePrUrl` refuses. Low effect.
- N-34 to N-38: see §9.

**Rollout condition (M-3 again, no new ID):** the five resident lifecycle workers run `0.2.5` code. A
`0.2.5` process writes the `0.2.5` helper and marker over a `0.2.6` install (shown in a fake `HOME`), and
it writes the `0.2.5` Claude hook into every workspace that it spawns or restores. After the landing and
the global rebuild, restart all five workers (PIDs 1218013, 1218338, 1218695, 1218968, 1219143 now), then
check `cat ~/.ao/bin/.ao-version` (`0.2.6`).

## 1. m-15 (review item 1)

### 1.1 Live reproducer (`<S>/scripts/live2.sh`, head and base)

Setup: a scratch repository, project `demo` (codex), one `ao spawn` (`demo-1`), then `ao spawn x.lock`
twice. The `gh` stub answers `issue view` with "Could not resolve to an Issue", so spawn uses the
free-text path and makes `feat/x.lock`. Probe pane `environ` (both builds): `HOME=<S>/live-<v>/home`,
`AO_STATE_ROOT=<S>/live-<v>/state`, first `PATH` entry `<S>/bin`, one `AO_*` variable (that
`AO_STATE_ROOT`).

Head `7f34bf4d`:

```text
run 1: rc=1  session records before/after: 1 / 1
✗ Session demo-2: branch metadata "feat/x.lock" is not valid: not a valid branch name
  demo-1: 602 bytes
run 2: rc=1  session records before/after: 1 / 1
✗ Session demo-2: branch metadata "feat/x.lock" is not valid: not a valid branch name
  demo-1: 602 bytes
-- ao session ls
Demo:
  demo-1  (2s ago)  session/demo-1  [spawning]
-- next normal spawn gets:
SESSION=demo-2
```

Base `ac0f662a`:

```text
run 1: rc=1  session records before/after: 1 / 2
✗ Session demo-2: branch metadata "feat/x.lock" is not valid: not a valid branch name
  demo-1: 602 bytes
  demo-2: 0 bytes
run 2: rc=1  session records before/after: 2 / 3
✗ Session demo-3: branch metadata "feat/x.lock" is not valid: not a valid branch name
  demo-1: 602 bytes
  demo-2: 0 bytes
  demo-3: 0 bytes
-- ao session ls
Demo:
  demo-1  (1s ago)  session/demo-1  [spawning]
  demo-2  (-)  [spawning]
  demo-3  (-)  [spawning]
-- next normal spawn gets:
SESSION=demo-4
```

The complete output of run 1 (stdout and stderr, 150 bytes) is the same byte for byte on both builds
(`cmp`: equal, sha256 `7932eb91…` for both). The stub log shows only `issue view`, `auth status` and
`--version` calls.

### 1.2 Worker spawn (`session-manager.ts:1276-1312`)

- **No ungated branch without a workspace plugin.** `spawn()` throws `workspace "<name>" is not
  available` at `:1211-1219`, before `reserveNextSessionIdentity` (`:1249`) and before the branch is
  computed (base has the same check at the same place; `spawn.test.ts:171` tests it). So the
  `if (plugins.workspace)` at `:1276` is always true when it runs, and no spawn stores a branch that the
  gate did not check. No later path (restore, `claim-pr`, the lifecycle manager, the hooks) can get an
  unchecked spawn branch from this change. Restore and `claim-pr` also keep their own gates (§6).
- **The `catch` on a refusal** (`:1305-1313`) calls only `deleteMetadata(sessionsDir, sessionId, false)`.
  That deletes the file that `reserveSessionId` made with `O_EXCL` (`metadata.ts:314-324`) in this call,
  so no other process can own it. `workspace.create` did not run, so the catch does not touch a worktree
  or a branch. The `postCreate` destroy is inside the inner `try` and runs only after a create.

### 1.3 Orchestrator spawn (`session-manager.ts:1684-1715`)

The new `try` exists only in the isolated mode, after `reserveNextOrchestratorIdentity` made a new
`O_EXCL` record. The project mode (the only mode that reuses an orchestrator session) does not reach
this `try` and is unchanged.

| Error path | Base `ac0f662a` | Head `7f34bf4d` |
| --- | --- | --- |
| gate refusal | throws, record left (m-15) | same error text, record deleted |
| no workspace plugin | `deleteMetadata` (best effort), then the same `spawnOrchestrator requires a workspace plugin …` error | the throw goes to the `catch`: same `deleteMetadata`, same error object and text |
| `workspace.create` fails | `catch`: `deleteMetadata`, rethrow | same `catch` |

The `catch` deletes only the new reservation of this call. It never destroys a workspace (none exists
yet), as before.

### 1.4 Order

On both paths the gate still runs before the first call that takes the branch (`workspace.create`).
Between the reservation and the gate there is only the branch computation (worker) or three assignments
(orchestrator). The side effects before the gate are the same as in round 1 and do not use the branch:
the tracker `gh issue view`, `validateAndStoreOrigin`, `git ls-remote --heads origin
session/<prefix>-*` (`:861-863`, inside `reserveNextSessionIdentity`), and the reservation itself.

## 2. m-16 (review item 2)

### 2.1 Name table (`<S>/scripts/table2.py`)

The r1 table (30,222 names) plus the 213 code points of the Unicode classes `Cc`, `Zl`, `Zp`, `Cf` and
`Zs` above `0x7f`, each in four forms (`a<c>b`, `feat/a<c>b`, `<c>`, `a<c>`): 31,065 distinct names.
Each bash copy runs in a fresh environment with only one locale variable set. The names go to bash as
arguments (see N-38).

```text
git(no repo)                     accepts  14174 of 31065
git(in repo)                     accepts  14174 of 31065
ts                               accepts  14173 of 31065
helper[LC_ALL=C]                 accepts  14173 of 31065
hook[LC_ALL=C]                   accepts  14173 of 31065
helper[LC_ALL=C.UTF-8]           accepts  14173 of 31065
hook[LC_ALL=C.UTF-8]             accepts  14173 of 31065
helper[LC_ALL=en_US.UTF-8]       accepts  14173 of 31065
hook[LC_ALL=en_US.UTF-8]         accepts  14173 of 31065
helper[LC_CTYPE=en_US.UTF-8]     accepts  14173 of 31065
hook[LC_CTYPE=en_US.UTF-8]       accepts  14173 of 31065
helper[LANG=en_US.UTF-8]         accepts  14173 of 31065
hook[LANG=en_US.UTF-8]           accepts  14173 of 31065
helper[LANG=C.UTF-8]             accepts  14173 of 31065
hook[LANG=C.UTF-8]               accepts  14173 of 31065

110000000000000  (1 names): '@'
TS accepts an option-like or operator name: []
```

- The 13 columns of TypeScript and the two bash copies are equal on every name, also on the 852
  code-point names. In r1, the UTF-8 columns refused 306 names more.
- The only difference with `git` is `@`, which the rule refuses on purpose (r1 §2).

### 2.2 The locale change stays inside the function

The real head helper, sourced into a fresh bash, then `update_ao_metadata branch $'feat/a b'`. The
probe compares the variables, the effective locale (`${#s}` of `éé`, a `[[:cntrl:]]` match on U+2028)
and the environment that a child process gets, before and after the call:

```text
none            rc=0 stored=feat/a\342\200\250b
   before: LC_ALL=<unset> LC_CTYPE=<unset> LANG=<unset> len(éé)=4 cntrl(U+2028)=no child_LC_ALL=- child_LANG=-
   after:  (same)  same=yes
lcall_set       rc=0 stored=feat/a\342\200\250b
   before: LC_ALL=en_US.UTF-8 LC_CTYPE=<unset> LANG=<unset> len(éé)=2 cntrl(U+2028)=yes child_LC_ALL=- child_LANG=-
   after:  (same)  same=yes
lcall_exported  rc=0 stored=feat/a\342\200\250b
   before: LC_ALL=en_US.UTF-8 LC_CTYPE=<unset> LANG=<unset> len(éé)=2 cntrl(U+2028)=yes child_LC_ALL=en_US.UTF-8 child_LANG=-
   after:  (same)  same=yes
lctype_only     rc=0 stored=feat/a\342\200\250b
   before: LC_ALL=<unset> LC_CTYPE=en_US.UTF-8 LANG=<unset> len(éé)=2 cntrl(U+2028)=yes child_LC_ALL=- child_LANG=-
   after:  (same)  same=yes
lang_only       rc=0 stored=feat/a\342\200\250b
   before: LC_ALL=<unset> LC_CTYPE=<unset> LANG=en_US.UTF-8 len(éé)=2 cntrl(U+2028)=yes child_LC_ALL=- child_LANG=en_US.UTF-8
   after:  (same)  same=yes
```

Inside the function the locale is `C` (a minimal copy shows `len(éé)=4` inside and `2` after). When the
caller exported `LC_ALL`, the local copy is also exported, so a child process started inside the function
would get `LC_ALL=C`. The two bash functions start no child process, so this has no effect.

### 2.3 The real `git` and `gh` see the caller's locale

The `git` wrapper runs the real `git` (and its `rev-parse` and `symbolic-ref` reads) before it sources
the helper. The `gh` wrapper sources the helper first, but sourcing only defines functions. It runs the
real `gh` before it calls `update_ao_metadata`. Live, a logging shim placed as the "real" `git`:

```text
LC_ALL=C.UTF-8        real git saw: LC_ALL=C.UTF-8 LC_CTYPE=<unset> LANG=<unset>
LC_ALL=C              real git saw: LC_ALL=C LC_CTYPE=<unset> LANG=<unset>
LC_ALL=en_US.UTF-8    real git saw: LC_ALL=en_US.UTF-8 LC_CTYPE=<unset> LANG=<unset>
LANG=en_US.UTF-8      real git saw: LC_ALL=<unset> LC_CTYPE=<unset> LANG=en_US.UTF-8
LC_CTYPE=en_US.UTF-8  real git saw: LC_ALL=<unset> LC_CTYPE=en_US.UTF-8 LANG=<unset>
```

### 2.4 Live wrapper runs (r1 m-16 runs again)

`git switch -q -c <name>` through the `git` wrapper of the live fake-`HOME` install, in the `demo-1`
session worktree, with the pane's `AO_DATA_DIR`, `AO_SESSION` and `AO_STATE_ROOT`:

| Locale setting | Name | Head `0.2.6`: rc, stored `branch=`, stderr | Base `0.2.5` |
| --- | --- | --- | --- |
| `LC_ALL=C.UTF-8` | `feat/a<U+2028>b` | 0, `feat/a\342\200\250b`, empty | 0, `main`, `refusing branch value 'feat/a b'` |
| `LC_ALL=C` | `feat/c<U+2028>d` | 0, `feat/c\342\200\250d`, empty | 0, `feat/c\342\200\250d`, empty |
| `LC_ALL=en_US.UTF-8` | `feat/n<U+0085>x` | 0, `feat/n\302\205x`, empty | 0, `main`, `refusing branch value 'feat/nx'` |
| `LANG=en_US.UTF-8` | `feat/l<U+2029>x` | 0, `feat/l\342\200\251x`, empty | 0, `main`, `refusing branch value 'feat/l x'` |
| `LC_CTYPE=en_US.UTF-8` | `feat/t<U+0080>x` | 0, `feat/t\302\200x`, empty | 0, `main`, `refusing branch value 'feat/tx'` |
| `LC_ALL=C` | `feat/m<U+0085>x` | 0, `feat/m\302\205x`, empty | 0, `feat/m\302\205x`, empty |
| `LC_ALL=en_US.UTF-8` | `feat/plain` | 0, `feat/plain`, empty | 0, `feat/plain`, empty |

The Claude hook (head and base dist, JSON event on stdin, `git switch -c <name>`):

```text
head  LC_ALL=C.UTF-8      feat/n<U+0085>x  rc=0 record=branch=feat/n\302\205x
head  LC_ALL=en_US.UTF-8  feat/n<U+0085>x  rc=0 record=branch=feat/n\302\205x
base  LC_ALL=C.UTF-8      feat/n<U+0085>x  rc=1 record=branch=main  metadata-updater: refusing branch value 'feat/nx' …
base  LC_ALL=en_US.UTF-8  feat/n<U+0085>x  rc=1 record=branch=main  metadata-updater: refusing branch value 'feat/nx' …
head  LC_ALL=C.UTF-8      feat/a<U+2028>b  rc=0 record=branch=feat/a     (N-34: the extract stops at U+2028)
base  LC_ALL=C.UTF-8      feat/a<U+2028>b  rc=0 record=branch=feat/a     (same on base)
```

### 2.5 Bash versions

- Host: GNU bash 5.2.21(1)-release (Ubuntu 24.04.5). Every result above is from this bash.
- CI: all jobs use `runs-on: ubuntu-latest`. That label is Ubuntu 24.04, which ships the same bash
  5.2.21. I did not run the CI image (no network).
- Older bash: no other bash exists on the host (the only other match is a dotslash script that downloads
  a bash, so I did not run it). The bash `NEWS` file says nothing about `local LC_ALL`. I cannot say from
  a test how an older bash (for example macOS `/bin/bash` 3.2) acts. The risk is small in both
  directions. If an older bash does not apply the local value, the check stays stricter, as m-16 was. If
  it does not restore the locale on return, nothing changes, because the wrappers and the hook do no
  locale-dependent work after the call that the result depends on (N-35).

## 3. m-17 (review item 3)

- The new hook test (`hook-script.integration.test.ts:421-535`) extracts `hook_is_safe_branch`,
  `hook_is_safe_pr` and `update_metadata_key` with `sed` from `hookScriptPath`, the Claude hook script
  itself, not from the helper. It sets `LC_ALL`, `LC_CTYPE` and `LANG` to each locale. Mutant LK (hook
  `local LC_ALL=C` removed) fails the `C.UTF-8` and `en_US.UTF-8` cases on this host, so those cases run
  in the locale that they name.
- Mutants of `hook_is_safe_pr`:

| Mutant | Tests that fail |
| --- | --- |
| PE end anchor removed | claude-code 5 (`1 x`, `1/extra`, `1?x=1`, `1x`, shared table) |
| PS start anchor removed | claude-code 1 (shared table: `" https://…"`) |
| PD1 `[0-9]+` → `[0-9a-z]+` | claude-code 2 (`1x`, shared table) |
| PD2 `[0-9]+` → `[0-9]*` | claude-code 1 (shared table: `…/pull/`) |

## 4. The tests prove the fix (review item 4)

Mutants (`<S>/scripts/mutants2.py`, a `7f34bf4d` copy; suites: core `branch-name` + `session-manager/` +
`agent-workspace-hooks`, all claude-code tests; files restored and checked with `cmp` after the run):

| Mutant | Tests that fail |
| --- | --- |
| W m-15 undone on the worker path only | core 1: `m-15 refused spawn leaves no session record` |
| O m-15 undone on the orchestrator path only | core 1: `m-15 refused orchestrator spawn leaves no session record` |
| LH `local LC_ALL=C` removed from the helper only | core 2: `branch table … in locale C.UTF-8` and `en_US.UTF-8` |
| LK `local LC_ALL=C` removed from the hook only | claude-code 2: `hook branch agrees … C.UTF-8` and `en_US.UTF-8` |
| PE, PS, PD1, PD2 | see §3 |
| PH helper `pr` end anchor removed (r1 P2 again) | core 1: `pr table: bash agrees with TypeScript` |
| LG helper `LC_ALL=C` without `local` | **none** (N-35) |
| LGK hook `LC_ALL=C` without `local` | **none** (N-35) |

**The mocked orchestrator test.** The test replaces `isSafeBranchName` with `vi.spyOn` only for names
that start with `orchestrator/`. Everything else is the real path: the real reservation, the real
`assertSafeBranchForSession` error, the real `catch`. The test matches the gate's message, so a refusal
from another source cannot pass it. If the spy did not take effect, the real rule would accept the name
and the test would fail ("resolved instead of rejecting"), so the test cannot pass for the wrong reason.
Mutant O proves that it checks the order. A real refusal on this path cannot happen with a schema-valid
prefix (r1 m-15). I agree that a mock is the only way to test it.

Non-vacuity (the 4 changed test files from `7f34bf4d` on the `ac0f662a` sources):

```text
core:        Tests 5 failed | 176 passed (181)
  × m-15 refused spawn leaves no session record
  × m-15 refused orchestrator spawn leaves no session record
  × branch table: bash agrees with TypeScript in locale C.UTF-8
  × branch table: bash agrees with TypeScript in locale en_US.UTF-8
  × bumps WRAPPER_VERSION so installs rewrite the helper and wrappers
claude-code: Tests 2 failed | 54 passed (56)
  × hook branch agrees with TypeScript in locale C.UTF-8
  × hook branch agrees with TypeScript in locale en_US.UTF-8
```

The m-17 tests pass on base, as they must: base has the end anchor. The mutants show that they catch its
removal.

## 5. Install and rollout (review item 5)

Fake `HOME`, installs in this order (`setupPathWrapperWorkspace`, `agent-workspace-hooks.ts:587-640`):

```text
1 base (0.2.5 code) install        ver=0.2.5 ao-metadata-helper.sh=cbebf125 gh=adb33f1e git=fbee814d  (all written)
2 head (0.2.6 code) install        ver=0.2.6 ao-metadata-helper.sh=d5b9f238 gh=adb33f1e git=fbee814d  (all written)
3 head again                       ver=0.2.6 (no write: same mtimes as step 2)
4 resident 0.2.5 process installs  ver=0.2.5 ao-metadata-helper.sh=cbebf125 (all written again)
5 head again                       ver=0.2.6 ao-metadata-helper.sh=d5b9f238; equal to the head constants: helper, gh, git
```

- The installer rewrites all three files and the marker when the marker is not equal to its own
  version. Only the helper text changes (`diff`: the 5 new lines). The `gh` and `git` wrappers are the
  same bytes as in `0.2.5`.
- The real `~/.ao/bin` holds the `0.2.5` helper (`cbebf125`, written 10:46:44, after the five workers
  started at 10:45).
- **Claude hook:** `setupHookInWorkspace` (`agent-claude-code/src/index.ts:662-676`) writes
  `.claude/metadata-updater.sh` with no version check. It runs at every worker spawn
  (`session-manager.ts:1463`), orchestrator start (`:1609`, `:1718`, `:1901`) and restore (`:2998`). So a
  workspace with the `0.2.5` hook gets the new hook at its next spawn or restore by `0.2.6` code. A
  running Claude session keeps its file until then, and a restore by a `0.2.5` worker writes the `0.2.5`
  hook again.
- **Resident processes (M-3 again):** the only resident `ao` processes are the five lifecycle workers.
  They run `0.2.5` code (in memory since 10:45). Their restore path (`send()` to a dead session) runs the
  installer and `postLaunchSetup`, so until they restart they write `0.2.5` over `0.2.6` (step 4) and the
  `0.2.5` hook into restored Claude workspaces, and their spawn path keeps m-15. Restart all five after
  the global rebuild, then check the marker. Short `ao` CLI calls use the new build at once.

## 6. No collateral change (review item 6)

- `git diff ac0f662a 7f34bf4d --stat` lists only the 7 files. `config.ts`, `utils/branch-name.ts`
  (`isSafeBranchName`, `isSafePrUrl`), `utils/pr.ts`, `utils/session-from-metadata.ts`,
  `agent-selection.ts`, the OpenCode plugin and the worktree plugin have no change.
- `session-manager.ts` changes only in the two spawn hunks. The restore gate and the `claim-pr` gate are
  unchanged. Live on both builds: a restore of a stored `branch=-Bvictim` (archived record, after
  `ao session kill`) fails with `Session demo-1: branch metadata "-Bvictim" is not valid: not a valid
  branch name`, and `victim` keeps its commit.
- The error texts are unchanged (the spawn refusal is the same byte for byte, §1.1).
- The helper changes only by the comment and `local LC_ALL=C`. The m-10 `case` block and the value checks
  after it are unchanged. The `gh` and `git` wrapper texts have the same hashes (`adb33f1e`, `fbee814d`),
  so the PATH-fix behaviour is unchanged. The hook changes only in `hook_is_safe_branch`.

## 7. Gates (review item 7)

Worktree at `7f34bf4d`, under section 0 (`env -i`, fake `HOME`, scratch `PATH`, no `AO_*`):

```text
pnpm build: rc=0
filtered test (core + claude-code): rc=0
  packages/core test:  Test Files  37 passed (37)   Tests  948 passed (948)
  packages/plugins/agent-claude-code test:  Test Files  3 passed (3)   Tests  208 passed (208)
filtered typecheck (core + claude-code): rc=0, 2x "typecheck: Done"
pnpm lint: rc=0, "✖ 5 problems (0 errors, 5 warnings)" (old: spawn.ts, activity-log.ts, plugin-registry.ts, session-manager.ts)
pnpm typecheck: rc=0, 13x "typecheck: Done"
pnpm test: rc=0
  core 948, gemini 62, codex 215, notifier-desktop 26, claude-code 208, runtime-herdr 36,
  scm-github 140 passed | 5 skipped (145), tracker-github 42, runtime-tmux 30, workspace-worktree 50,
  opencode 163, integration-tests 95 passed | 24 skipped (119), cli 243
```

## 8. Scope and commit (review item 8)

- The 7 files are all in the author brief section 2 list. The `agent-claude-code/src/index.ts` change is
  inside the hook script only (5 added lines).
- The message is conventional (`fix(core): …`), gives the WHY for m-15, m-16, m-17 and the version bump,
  and has no `Co-Authored-By`, no emoji and no issue number. The subject has 91 characters; the body lines
  have at most 65.
- `git branch -r --contains 7f34bf4d` prints nothing (no fetch; the only remote-tracking ref is
  `origin/main`).

## 9. Findings

### m-18: the bash `pr` checks and extracts still depend on the locale (not new; missed by my r1)

- Where: `ao_is_safe_pr` (`agent-workspace-hooks.ts:250-252`), `hook_is_safe_pr`
  (`agent-claude-code/src/index.ts:139-141`), and the extracts `grep -Eo
  'https://github\.com/[^/]+/[^/]+/pull/[0-9]+'` (`agent-workspace-hooks.ts:433`, hook `:224`).
- Cause: in a bracket expression, a range such as `A-Z` or `0-9` follows the collation order
  (`LC_COLLATE`). In `en_US.UTF-8` it also matches non-ASCII letters and digits. The m-16 fix sets
  `LC_ALL=C` only in the branch functions.
- `<S>/scripts/prtable.py`: 34,558 URLs (7 forms, one changed character from 4,937 code points),
  `isSafePrUrl` against both bash copies:

```text
ts                             accepts    214 of 34558
helper[LC_ALL=C]               accepts    214  differs from ts: 0
helper[LC_ALL=C.UTF-8]         accepts    214  differs from ts: 0
helper[LC_ALL=en_US.UTF-8]     accepts   4439  differs from ts: 4225 (accepts more: 4225)
helper[LC_CTYPE=en_US.UTF-8]   accepts    214  differs from ts: 0
helper[LANG=en_US.UTF-8]       accepts   4439  differs from ts: 4225 (accepts more: 4225)
helper[LANG=C.UTF-8]           accepts    214  differs from ts: 0
hook[…]                        the same numbers as helper[…] in every setting
e.g. '…/oª/r/pull/1', '…/o/rª/pull/1', '…/o²/r/pull/1', '…/o/r/pull/1²', '…/o/r/pull/²'
```

- Live, `gh` wrapper of the fake-`HOME` install, `gh pr create` with a stub that prints the URL (head and
  base give the same result):

```text
LC_ALL=en_US.UTF-8  https://github.com/scratch/demo/pull/7١  rc=0 record=pr=https://github.com/scratch/demo/pull/7١  isSafePrUrl(stored)=false
LC_ALL=C.UTF-8      https://github.com/scratch/demo/pull/8١  rc=0 record=pr=https://github.com/scratch/demo/pull/8   isSafePrUrl(stored)=true
LC_ALL=en_US.UTF-8  https://github.com/scré/demo/pull/9      rc=0 record=pr=https://github.com/scré/demo/pull/9      isSafePrUrl(stored)=false
```

  Core reads the first value as PR #7 of `scratch/demo` (`parsePrFromUrl`).
- Effect: low. The bash checks accept more than `isSafePrUrl`, but every accepted value still starts with
  `https://github.com/`, so it cannot become an option, and it reaches only `gh` read calls (r1 N-28). The
  real `gh pr create` prints ASCII URLs. The `pr` table test runs only in the locale of the test process
  (no `LC_ALL`), so CI (`LANG=C.UTF-8`) and the author's runs cannot see it.
- Fix: add `local LC_ALL=C` to `ao_is_safe_pr` and `hook_is_safe_pr` (or spell the classes as
  `[[:alnum:]._-]` in a `C` scope), run the two extracts as `LC_ALL=C grep -Eo …`, add non-ASCII URLs
  (for example `…/pull/1²`, `…/oé/r/pull/1`) to the shared `pr` table, and run the `pr` agreement tests
  under `C`, `C.UTF-8` and `en_US.UTF-8`.

### Notes

- **N-34 (hook extract, not new):** the hook's branch extract `([^[:space:]]+)`
  (`agent-claude-code/src/index.ts:235-236`) stops at U+2028 and U+2029 in a UTF-8 locale, because glibc
  classes them as space. For `git switch -c feat/a<U+2028>b` the hook stores `branch=feat/a` on head and on
  base (§2.4). So for these two code points the m-16 fix has no effect in the hook. U+0080 to U+009F
  work now. The stored value is a valid name and not an option, and such names are rare. The `git` wrapper
  reads the branch from `git symbolic-ref`, so it stores the exact name.
- **N-35 (test gap):** no test checks that the locale change stays inside the function. Mutants LG and LGK
  (`LC_ALL=C` without `local`) pass every test. Today a leak has no effect: after the check, the helper and
  the hook only run `printf`, `tr`, `sed`, `grep`, `cp` and `mv` on the record, which give the same bytes
  in `C`; the `git` wrapper then exits; and the `gh` wrapper runs the real `gh` before the call. A small test that compares `${#s}` of a multibyte
  string before and after the call (§2.2) would protect the comment's claim.
- **N-36 (test shape):** the hook test named "hook branch agrees with TypeScript" compares 13 fixed names
  with fixed answers. It does not call `isSafeBranchName` and does not use the shared table, and its `pr`
  table is a copy of the core table, not an import. My table run (§2.1) shows no difference today, so
  the only risk is drift.
- **N-37 (test locales):** the tests set `LC_ALL`, so no test runs the `LANG`-only setting that this
  host uses. My table covers it. If a CI runner has no `en_US.UTF-8` locale, bash falls back to `C` and
  that case passes for the wrong reason. The `C.UTF-8` case still catches mutants LH and LK, and glibc
  has `C.UTF-8` built in since 2.35.
- **N-38 (r1 count):** my r1 named "212" code points. The correct count is 213: r1 counted with `wc -l`
  on a file that had no final newline. The r1 table had all 213. Also, a bash `read -d ''` loop in a
  UTF-8 locale drops the record after a record that ends in a lone UTF-8 lead byte (bash 5.2.21:
  `printf 'x\0\302\0ab\0cd\0'` gives `x`, `\302`, `cd`). My r1 and r2 table scripts pass the names as
  arguments for this reason. Any later table test must not read names with `read -d ''` in a UTF-8 locale.

## 10. What is correct

- m-15: both spawn paths delete their own reservation on a refusal, with the same error text and the same
  cleanup as before on every other error path. The gate still runs before any use of the branch.
- m-16: both bash branch copies equal the TypeScript rule on 31,065 names under six locale settings. The
  locale change stays inside the function, and the real `git` and `gh` see the caller's locale.
- m-17: all four mutants of the hook `pr` pattern fail a test.
- The new tests fail on `ac0f662a`, and every mutant that the brief names fails at least one test.
- `0.2.6` rewrites the install, and only the helper text changes.
- No collateral change. Scope and commit rules hold. Gates pass.

## 11. Safety and cleanup

- Start marker: `/tmp/ao32r2-marker` (11:40:06). Real `~/.ao/bin` before my work (11:40:06):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 10:46:44.122499488 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5181 2026-10-16 10:46:44.120499539 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 10:46:44.122499488 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 10:46:44.121499513 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 10:46:44.122499488 -0400 git
0.2.5   sha256: helper cbebf125…, gh adb33f1e…, git fbee814d…
```

- Real `~/.ao/bin` after my work (12:03:35):

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 10:46:44.122499488 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5181 2026-10-16 10:46:44.120499539 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 10:46:44.122499488 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 10:46:44.121499513 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 10:46:44.122499488 -0400 git
$ cat ~/.ao/bin/.ao-version
0.2.5
cbebf125c7ebdd6c528c64d23c1e88af8a5415fcbd619a8ebec87619a888d0f7  ~/.ao/bin/ao-metadata-helper.sh
adb33f1eb29d7ccbe02df980d8acc85549790cf528f1d3243f0649f671c2fcfd  ~/.ao/bin/gh
fbee814d6515680c35a2840dd9c5129d04dd0e4320c6f16e131a243d23a44c3e  ~/.ao/bin/git
```

- Real state root (run before I removed the marker):

```text
$ find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao32r2-marker
(end of find)
```

  At deeper levels, 23 files changed in that time, all under the real projects
  (`60756641ca25-agent-orchestrator`, `f6790d5546be-agent-skills`, four `*-observability` directories),
  written by the real fleets. No path holds `demo`, `scratch` or `ao32`. Every live run of mine set
  `AO_STATE_ROOT` to `<S>/live-<v>/state` and a fake `HOME`. My own shell holds the `AO_*` variables of my
  real session, so every `ao`, `node`, helper, wrapper and hook call ran under `env -i`.
- Processes that I started and stopped by exact PID: lifecycle workers 1806347 (head) and 1809900 (base),
  each checked by its `environ` (`HOME` and `AO_STATE_ROOT` under `<S>`) before `kill`; then the tmux
  servers 1806295 (`-L ao32r2-head`) and 1809848 (`-L ao32r2-base`) with `kill-server`. The fake codex
  panes ended with their servers (no process with a working directory or `HOME` under `<S>` is left). The
  table, `pr` table and mutant runs ended by themselves.

```text
$ ps -o pid,args -u "$(id -u)" | grep -F -e "<S>" -e ao32r2 | grep -v grep
(end of list)
```

- The five real lifecycle workers are alive and untouched (1218013, 1218338, 1218695, 1218968,
  1219143). No tmux command went to the default server. I ran no real `gh` and no `git fetch`.
- `/tmp` state removed: all of `<S>`, the socket files `/tmp/tmux-44402/ao32r2-head`, `ao32r2-base` and
  `ao32r2test` (the last one from the gate run, no server), the 135 `/tmp/ao-test-state-*` and
  `/tmp/ao-plugin-registry-*` entries newer than my marker (11:44 to 11:55, my gate, non-vacuity and
  mutant runs; no other test run was active), and the marker.
- The worktree is at `7f34bf4d`. `git status --porcelain` shows only `.agent_report.md`,
  `.agent_task.md` and this review file. I made no commit, no push and no PR, and I did not run
  `ao send`.
