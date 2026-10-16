# Blind review r1: check the stored branch and pr values before use (m-13)

- Range: `c8bccfb2..bb81cf7a` (1 commit, 11 files, +754/-17).
- Author: Muse (OpenCode, ao-34). Brief: `brief-aofork-branch-check.md`.
- Reviewer: ao-32 (Claude Opus 5.5). Date: 2026-10-16.
- Method: source reading; live runs in a scratch environment (fake `HOME`, scratch `AO_STATE_ROOT`,
  scratch `PATH`, private tmux servers `-L ao32b1-head` and `-L ao32b1-base`, fake codex that only logs
  its arguments, `gh` stub); a 30,222-name table against the real `git check-ref-format --branch`;
  gates; non-vacuity on `c8bccfb2`; 15 mutants. I read the author report only after review items 1 to 5.
- `<S>` below is my scratch directory under `/tmp/claude-44402/...`. I removed it at the end.

## Verdict

**LAND-SAFE.**

**m-13: fixed.** On `bb81cf7a`, `ao session restore` refuses a stored `branch=-Bvictim` (and every other
option-like or operator value that I tried) before any `git` call. `victim` keeps its commit, and no
worktree is added. On `c8bccfb2` the same restore resets `victim` (round-1 result again). The helper,
the Claude hook and `claim-pr` also refuse the value.

Findings: 0 B, 0 M, 3 m, 9 notes.

- **m-15 (new in this commit):** a spawn that the new gate refuses leaves an empty reserved session
  record. `ao session ls` then shows a ghost session `[spawning]`.
- **m-16:** the two bash copies of the rule depend on the locale. In a UTF-8 locale they refuse 34
  non-ASCII code points that `git` and the TypeScript rule accept. The agreement test does not cover them.
- **m-17 (test gap):** mutant P3 (the hook `pr` pattern without its end anchor) passes every test.

**Rollout condition (M-3 again, no new ID):** the core gates run only in new code. The five resident
lifecycle workers run 0.2.4 code. Until they restart, their restore path (`send()` to a dead session)
has no gate and still runs `git worktree add <path> <branch>` without `--`, and their installs write the
0.2.4 helper (no value checks) over 0.2.5. After the global rebuild, restart all resident `ao`
processes, then check `cat ~/.ao/bin/.ao-version` (`0.2.5`).

## 1. m-13 status (review item 1)

### 1.1 Live restore (`<S>/scripts/live.sh`, head and base)

Setup: a scratch repository with a free branch `victim` that has its own commit, project `demo` (codex),
`ao spawn`, `ao session kill demo-1`. For each value, the script writes `branch=<value>` into the record
directly (as N-17: the active record, or the newest archived record after a kill), resets `victim` to its
own commit, and runs `ao session restore demo-1`. The probe pane `environ`: `HOME=<S>/live-<v>/home`,
`AO_STATE_ROOT=<S>/live-<v>/state`, first `PATH` entry `<S>/bin`, and no other `AO_*` variable.

| Stored `branch=` | head `bb81cf7a` | base `c8bccfb2` |
| --- | --- | --- |
| `-Bvictim` | refused, no worktree, `victim` unchanged | restored onto `victim`; `victim` reset to `init` (`branch: Reset to HEAD`) |
| `-fBvictim` | refused, no worktree, `victim` unchanged | restored onto `victim`; `victim` reset again |
| `--orphan=x` | refused | `error: unknown option 'orphan=x'` |
| `--detach` | refused | restored, worktree on a detached `HEAD` |
| `-b` | refused | `error: unknown switch 'b'` |
| `@{-1}` | refused | restored onto `victim` (git expands `@{-1}` to the previous branch) |
| `$'a\rb'` | refused | git: `'a?b' is not a valid branch name` |
| `$'a\e[31mRED\e[0m'` | refused (see N-27) | git: not a valid branch name |
| `naïve/é` | restored (valid name, same as base) | restored |
| 300 × `x` | passes the rule, git: `File name too long`, no change | same |

Head output for the reproducer:

```text
-Bvictim       -> Failed to restore session demo-1: Error: Session demo-1: branch metadata "-Bvictim" is not valid: not a valid branch name
   stored branch now: branch=-Bvictim | demo-1 worktree: none
victim: 21cb7f4 victim-only work | reflog: 21cb7f4 commit: victim-only work;7838c89 branch: Created from main; | worktrees: 2
```

Base output for the reproducer:

```text
-Bvictim       -> Session demo-1 restored.
   stored branch now: branch=-Bvictim | demo-1 worktree: victim
victim: a95c299 init | reflog: a95c299 branch: Reset to HEAD;9d37a94 commit: victim-only work;a95c299 branch: Created from main; | worktrees: 3
```

The restores in this loop came from the archive (after `ao session kill`), so the gate also covers the
archive restore. `restoreForDelivery` calls the same `restore()`.

### 1.2 Helper, hook and `claim-pr`

- Helper in the `demo-2` pane environment (head): `update_ao_metadata branch -Bvictim` →
  `ao-metadata-helper: refusing branch value '-Bvictim' (not a valid branch name)`, rc=1, record
  unchanged. `pr notaurl` → `refusing pr value 'notaurl' (not a valid PR URL)`, rc=1. `branch feat/ok`
  and `pr https://github.com/o/r/pull/1` → rc=0, written. Base: all four write.
- Claude hook (head dist, event on stdin):

```text
git checkout -b -Bvictim     rc=1 out=  err=[metadata-updater: refusing branch value '-Bvictim' (not a valid branch name)] rec=(unchanged)
git switch -c --orphan=x     rc=1 out=  err=[metadata-updater: refusing branch value '--orphan=x' (not a valid branch name)] rec=(unchanged)
git checkout -b feat/ok      rc=0 out={"systemMessage": "Updated metadata: branch = feat/ok"}  rec=branch=feat/ok
gh pr create (…/pull/12)     rc=0 rec=status=pr_open pr=https://github.com/o/r/pull/12
gh pr create (r.x_y-z repo)  rc=0 rec=status=pr_open pr=https://github.com/o/r.x_y-z/pull/7
gh pr merge 5 --squash       rc=0 rec=status=merged
```

  Base: the hook writes `branch=-Bvictim` and `branch=--orphan=x` with rc=0.
- `ao session claim-pr 5 demo-2` with a `gh` stub that answers `pr view` with `headRefName: "-Bvictim"`
  (head): `Failed to claim PR for session demo-2: Error: Session demo-2: branch metadata "-Bvictim" is not
  valid: not a valid branch name`. The record keeps `branch=session/demo-2`, and the stub logged no
  `pr checkout`. (On base, this run stopped in `checkoutPR` at its uncommitted-changes check, so the base
  comparison is not complete live. The non-vacuity run covers it: the claim-pr gate test fails on base.)

## 2. The rule (review item 2)

`<S>/scripts/table.py` makes 30,222 distinct names (bytes): fixed cases (option-like, revision operators,
`HEAD`, `@`, pseudo-refs, hex, `.lock` and dot cases, long names, non-ASCII, invalid UTF-8, C1 controls,
U+2028), every byte `0x01-0xff` alone and in context, all pairs over 42 interesting characters, all
triples over `a . / - @ { l k`, component forms, and 30,000 seeded random names. Verdicts:

```text
git(no repo)           accepts  13331 of 30222
git(in repo)           accepts  13331 of 30222
ts                     accepts  13330 of 30222
helper[C]              accepts  13330 of 30222
hook[C]                accepts  13330 of 30222
helper[C.UTF-8]        accepts  13024 of 30222
hook[C.UTF-8]          accepts  13024 of 30222
helper[en_US.UTF-8]    accepts  13024 of 30222
hook[en_US.UTF-8]      accepts  13024 of 30222

columns: git(no repo) | git(in repo) | ts | helper[C] | hook[C] | helper[C.UTF-8] | hook[C.UTF-8] | helper[en_US.UTF-8] | hook[en_US.UTF-8]
111110000  (306 names): 'a\xe2\x80\xa8b', 'a\xc2\x85b', 'a\xc2\x80', 'a\xc2\x9f', 'a\xc2\x85', '@\xc2\x85', …
110000000  (1 names): '@'
TS accepts an option-like or operator name: []
```

- TypeScript and `git`: they differ on `@` only. The TypeScript rule decodes the bytes as UTF-8, as the
  record reader does. Invalid UTF-8 becomes U+FFFD, which both accept.
- TypeScript and bash in the `C` locale: they agree on every name, also on bytes `0x80-0xff`.
- TypeScript and bash in a UTF-8 locale: 306 names differ (m-16).
- **`@`:** git accepts it (`git switch -c @` creates a real branch `@`). As a commit-ish, `@` means
  `HEAD`, so `git worktree add -- <path> @` would make a detached worktree on the main checkout HEAD. No
  name generator gives `@`. I agree with the author: refusing it is the safer choice. The only effect: the
  `git` wrapper prints a refusal line and does not record a real branch `@`.
- **Option or revision expression:** the rule accepts no name that starts with `-` and no name with
  `..`, `@{`, `^`, `~`, `:` or `@` alone. A valid plain name can still match a tag, a pseudo-ref or an
  object name when no branch of that name exists. Then restore gives a detached worktree on that commit
  (shown: `git worktree add -- <path> 4c65eb3` → `(detached HEAD)`). That is old behaviour, changes no
  branch, and is not an option (N-25).

## 3. Findings

### m-15: a refused spawn leaves an empty reserved session record (new in this commit)

- Where: `packages/core/src/session-manager.ts:1275`. `reserveNextSessionIdentity` (`:1249`) creates
  the record file with `O_EXCL` (`metadata.ts:314-324`). The new gate throws before the `try` block whose
  `catch` deletes the reservation (`:1304-1311`). Before this commit, an invalid name failed inside
  `workspace.create`, and that `catch` deleted the record.
- Reproducer (live, both builds): `ao spawn x.lock` with the `gh` stub answering `issue view` with "Could
  not resolve to an Issue", so spawn uses the free-text path and makes `feat/x.lock`.

```text
head: ✗ Session demo-3: branch metadata "feat/x.lock" is not valid: not a valid branch name
head: session records before/after: 2 / 3      demo-3: 0 bytes
head: ao session ls →   demo-3  (-)  [spawning]
base: fatal: 'feat/x.lock' is not a valid branch name
base: session records before/after: 2 / 2
```

- Effect: a ghost session in `ao session ls` and `ao status`, and a used session number. No git runs and
  nothing else changes. The spawn fails on both builds (git refuses the name too). Only the cleanup
  differs.
- Fix: call `deleteMetadata(sessionsDir, sessionId, false)` before the throw (or run the check inside the
  existing `try`), and add a test that the record is gone after the refusal. The orchestrator gate
  (`:1689`) has the same order, but its name `orchestrator/<prefix>-orchestrator-<n>` always passes
  (the config schema limits the prefix to `[a-zA-Z0-9_-]+`).

### m-16: the bash copies depend on the locale

- Where: `agent-workspace-hooks.ts` `ao_is_safe_branch` (`[[ "$name" =~ [[:cntrl:]] ]]`) and the same
  line in `hook_is_safe_branch` (`agent-claude-code/src/index.ts`, about `:113`).
- In `C.UTF-8` and `en_US.UTF-8`, bash `[[:cntrl:]]` also matches U+0080 to U+009F, U+2028 and U+2029
  (I tested all 212 code points of the Unicode classes `Cc`, `Zl`, `Zp`, `Cf` and `Zs` above `0x7f`).
  `git` and the TypeScript rule accept these 34 code points (the comment says "other bytes >= 0x80 pass").
  The agreement test passes only because its table has no such name.
- Live, `git` wrapper from a 0.2.5 fake-`HOME` install, `git switch -c <name>` in the session worktree:

```text
C.UTF-8      $'feat/a\342\200\250b'   rc=0 record=branch=main            stderr=[ao-metadata-helper: refusing branch value 'feat/a b' (not a valid branch name)]
C            $'feat/c\342\200\250d'   rc=0 record=branch=feat/c d   stderr=[]
en_US.UTF-8  $'feat/n\302\205x'       rc=0 record=branch=main            stderr=[ao-metadata-helper: refusing branch value 'feat/nx' (not a valid branch name)]
C            $'feat/m\302\205x'       rc=0 record=branch=feat/m\u0085x   stderr=[]
```

- Effect: low. The bash copies are stricter, never weaker. In a UTF-8 shell the wrapper does not record
  such a real branch and prints one refusal line after a successful `git switch`. The exit code stays 0.
- Fix: run the control check in the `C` locale (for example `local LC_ALL=C` before the test, or an
  explicit byte class), add C1 and U+2028 names to the shared table, and run the bash copies under a UTF-8
  locale in the agreement test.

### m-17: the hook `pr` end anchor has no test (mutant P3 survives)

- Where: `agent-claude-code/src/index.ts:135`, `hook_is_safe_pr`. With the `$` removed, all 200
  claude-code tests and all other suites pass. The hook test refuses only `""`, `notaurl` and an issue URL.
  The helper copy is different: mutant P2 fails the shared PR table test.
- Effect: low. The hook's own extract (`grep -Eo '…/pull/[0-9]+'`) always ends at a digit, so the anchor
  matters only for a direct call of the function.
- Fix: check `hook_is_safe_pr` against the shared PR table, as the helper copy is, or add
  `https://github.com/o/r/pull/1x` and `https://github.com/o/r/pull/1 x` to the hook test.

## 4. Notes

- **N-25 (item 2):** a valid plain name that matches a tag, a pseudo-ref (`FETCH_HEAD` when present) or an
  object name restores as a detached worktree on that commit. Old behaviour, no branch change.
- **N-26 (item 3):** no generated name that worked before is now refused. The generators: tracker
  `feat/issue-<n>` (`tracker-github/src/index.ts:177-180`); free text that is already "branch-safe"
  (`^[A-Za-z0-9][A-Za-z0-9._-]*$`, no `..`), used as `feat/<id>`; otherwise a slug of `[a-z0-9-]`;
  `session/<id>` and `orchestrator/<id>` from the schema-limited prefix. Only the branch-safe free-text
  path can make an invalid name (`feat/x.lock`, `feat/v1.`), and git refuses those too (base live:
  `fatal: 'feat/x.lock' is not a valid branch name`). The CLI never sets an explicit spawn `branch`.
- **N-27:** the new error messages print the stored value raw: `branch metadata "a\e[31mRED\e[0m"`, so a
  stored escape sequence reaches the terminal (`cat -v` shows `a^[[31mRED^[[0m`). `ao session ls` already
  printed the raw stored branch on base. Suggest `JSON.stringify(branch)` in
  `assertSafeBranchForSession` (`session-manager.ts:148`) and the plugin errors.
- **N-28 (item 4, `pr`):** stored `pr` values reach only read calls of `gh` (`pr view`, `api` GET,
  GraphQL variables) as `String(pr.number)`, a `--repo` value, or inside `repos/<owner>/<repo>/…`. None can
  become an option. Only `claim-pr` calls a write method (`checkoutPR`, `assignPRToCurrentUser`), with a
  PR from GitHub. `mergePR` and `closePR` have no caller. Core still reads `pr` with the unanchored
  `parsePrFromUrl` and does not compare owner and repo with `project.repo` (unchanged on purpose, brief
  item 9), and `isSafePrUrl` is exported but unused in core. So a record written directly can still point
  the lifecycle at another repository's PR (read only). Out of scope here.
- **N-29 (hook exit):** the hook runs with `set -euo pipefail`, so a refused value ends the hook with
  exit 1 and no JSON (base: write, JSON, exit 0). Claude Code treats a PostToolUse exit 1 as a
  non-blocking hook error. The Bash tool result does not change.
- **N-30 (item 5, CI git):** I did not run the CI image (`ubuntu-latest`). The `--` is the generic
  parse-options end marker, and `git worktree` has used parse-options since it was added (git 2.5).
- **N-31 (item 7):** a Claude workspace gets the new hook at its next spawn or restore by 0.2.5 code
  (`setupHookInWorkspace`, `agent-claude-code/src/index.ts:975` and `:981`).
- **N-32 (process):** the author report says the author ran the real `gh` ("real `gh` returns GraphQL repo
  error"), which needs a network call with the owner's token, and the orchestrator found the author's D2
  record under the real `~/.agent-orchestrator`. My `gh` check used an empty fake `HOME`, so `gh` stopped at
  its auth check after flag parsing and made no network call.
- **N-33 (commit text):** body lines are at most 76 characters (the m-10 commit had one 446-character
  line).

## 5. Review items 3 to 10

**Item 3:** see N-26 and m-15.

**Item 4, every use (branch or `pr` value to a `git` or `gh` argument list):**

| Path | Value | Status | Evidence |
| --- | --- | --- | --- |
| spawn → `workspace.create` | issue or explicit branch | gated `session-manager.ts:1275`, plugin `:103` | unit test, live `feat/x.lock` |
| orchestrator spawn → `workspace.create` | `orchestrator/<id>` | gated `:1689` | name always valid |
| restore (incl. archive, `restoreForDelivery`) → `workspace.restore` | stored `branch` | gated `:2927`, plugin `:263` | live table §1.1 |
| `claim-pr` → `scm.checkoutPR` | `pr.branch` from GitHub | gated `:2646` | live §1.2; `checkoutPR` runs `gh pr checkout <number>` only |
| `resolveBaseRef` `refExists(origin/<branch>)` | stored `branch` | after the gate; the `origin/` prefix stops option parsing | `workspace-worktree/src/index.ts:59-61` |
| create fallback `git checkout <branch>` | branch | gated (no `--`: git would read a path) | `:142` |
| lifecycle `detectPR` → `gh pr list --head <branch>` | stored `branch` | not gated, safe | real `gh` 2.45.0, empty fake `HOME`: `--head -Zvictim` and `--head --zzz` reach the auth check; `-Zvictim` alone gives `unknown shorthand flag: 'Z'`; `--head` alone gives `flag needs an argument` |
| destroy, kill, cleanup → `git worktree remove --force <path>` | `worktree=` path, no branch | path must be inside a managed root (`shouldDestroyWorkspacePath`, `:435-445`) | absolute path |
| `listRemoteSessionNumbers` → `git ls-remote … session/<prefix>-*` | config prefix | safe | schema regex |
| scm-github PR reads | stored `pr` | not gated, safe from options | N-28 |
| CLI (`status`, `session ls`, `git-utils`) | none | only `git branch --show-current` and fixed `origin/<common>` names | grep |
| agent plugins (claude-code, codex, gemini, opencode) | none | no branch or `pr` value to `git` or `gh` | grep |

The `gh` check confirms the author's claim: pflag takes the next argument as the `--head` value even when
it starts with `-`. (`-B` is a real `gh pr list` shorthand for `--base`, so `-Bvictim` is not a useful
probe there.)

**Item 5, `--`:** on host git 2.43.0, `git worktree add -b new1 -- <path> main`, `git worktree add --
<path> existing` and the forms without `--` give the same branches (`new1`, `new2`, `existing`,
`feat/x`). A relative path `-dashpath` works with `--` and stops with exit 129 without it. See N-30 for CI.

**Item 6:** the value checks refuse with one stderr line and return 1, before the temp file. The
helper defines no call of `git` (only the words "check-ref-format" and "git" in comments). Live (0.2.5
install): the `gh` wrapper still writes `pr=` and `status=pr_open`, the `git` wrapper `branch=feat/plain`,
the hook `status=merged`. A refusal adds one stderr line and keeps the exit code (rc=0 above). The `pr`
pattern refuses no URL of a real GitHub PR: owners use `[A-Za-z0-9-]`, repositories `[A-Za-z0-9._-]`,
and both extracts end at the PR number. The hook extract `[^/]+` can capture a space or `?`; the
pattern then refuses it (`https://github.com/o/r?x=1/pull/3` → refused, rc=1), and that string is not a
real PR URL.

**Item 7, install:** fake `HOME` with a 0.2.4 install (base build), then the head build:

```text
1 base 0.2.4 install   ver=0.2.4 ao-metadata-helper.sh=2deab7f6 gh=adb33f1e git=fbee814d
2 head 0.2.5 install   ver=0.2.5 ao-metadata-helper.sh=cbebf125 gh=adb33f1e git=fbee814d
equal to head constants: helper=true gh=true git=true
```

All three files and the marker are written again (new mtimes). Only the helper text changes. For Claude,
see N-31. For resident processes, see the rollout condition.

**Item 8, no collateral change:** the diff does not touch `config.ts`, `session-from-metadata.ts`,
`utils/pr.ts`, `agent-selection.ts` or the OpenCode plugin. The m-10 `case` block is unchanged; the value
checks come after it. The PATH code and the wrapper texts are unchanged (same `gh` and `git` hashes).

**Item 9, gates (worktree `bb81cf7a`, fake `HOME`, no `AO_*`):**

```text
filtered test (core + worktree + claude-code + codex + gemini + opencode + scm-github): rc=0
  packages/core:                      Test Files 37 passed (37)  Tests 939 passed (939)
  packages/plugins/workspace-worktree: Test Files 1 passed (1)   Tests 50 passed (50)
  packages/plugins/agent-claude-code: Test Files 3 passed (3)    Tests 200 passed (200)
  packages/plugins/agent-codex:       Test Files 3 passed (3)    Tests 215 passed (215)
  packages/plugins/agent-gemini:      Test Files 1 passed (1)    Tests 62 passed (62)
  packages/plugins/agent-opencode:    Test Files 1 passed (1)    Tests 163 passed (163)
  packages/plugins/scm-github:        Test Files 3 passed (3)    Tests 140 passed | 5 skipped (145)
filtered typecheck: rc=0, 7x "typecheck: Done"
full typecheck: rc=0, 13x "typecheck: Done"
pnpm lint: rc=0, "✖ 5 problems (0 errors, 5 warnings)" (old: spawn.ts, activity-log.ts, plugin-registry.ts, session-manager.ts)
full pnpm test: rc=0
  core 939, gemini 62, codex 215, claude-code 200, notifier-desktop 26, runtime-herdr 36,
  scm-github 140 passed | 5 skipped (145), tracker-github 42, runtime-tmux 30, workspace-worktree 50,
  opencode 163, integration-tests 95 passed | 24 skipped (119), cli 243
```

Non-vacuity (the 5 changed or new test files from `bb81cf7a` on the `c8bccfb2` sources):

```text
core (agent-workspace-hooks, branch-name, restore-branch-gate): Tests 4 failed | 77 passed (81)
  + branch-name.test.ts cannot load: Cannot find module '../utils/branch-name.js'
  failed: spawn, restore and claimPR gate tests ("promise resolved … instead of rejecting"), WRAPPER_VERSION 0.2.5
claude-code hook-script.integration.test.ts:  Tests 12 failed | 36 passed (48)
workspace-worktree index.test.ts:             Tests 11 failed | 39 passed (50)
```

Mutants (`<S>/scripts/mutants.py`, `bb81cf7a` copy, core rebuilt for each core-rule mutant; suites: core
`branch-name` + `session-manager/` + `agent-workspace-hooks`, worktree, claude-code, codex, gemini):

| Mutant | Tests that catch it |
| --- | --- |
| R1 restore gate removed | core 1 (restore gate test) |
| R2 `claim-pr` gate removed | core 1 (claimPR gate test) |
| R3 spawn gate removed | core 1 (spawn gate test) |
| R4 restore gate removed in core and in the worktree plugin | core 1, worktree 1 |
| D1 every `--` removed in the worktree plugin | worktree 9 |
| D2 `--` removed in the restore `worktree add` only | worktree 1 (restore ends options with --) |
| T1 TypeScript rule accepts a leading `-` | core 9 (table, agreement, 3 gate tests), worktree 2 |
| T2 TypeScript rule accepts `..` | core 3 |
| T3 TypeScript rule accepts `@` | core 2 |
| B1 helper bash rule accepts `..` | core 2 (agreement, helper refusal) |
| B2 hook bash rule accepts `..` | claude-code 1 (refuses `a..b`) |
| B3 helper bash rule accepts a leading `-` | core 2 (agreement, helper refusal) |
| P1 TypeScript `pr` pattern without `$` | core 4 |
| P2 helper `pr` pattern without `$` | core 1 (PR table agreement) |
| P3 hook `pr` pattern without `$` | **none** (m-17) |

**Item 10, scope and commit:** the 11 files are all in the brief section 3 list. `index.ts` has one export
statement with two names. `scm-github` is unchanged, which item 2.7 allows. The message is conventional
(`fix(core): …`), gives the WHY, has no `Co-Authored-By`, no emoji and no issue number.
`git branch -r --contains bb81cf7a` prints nothing.

## 6. What is correct

- The restore, spawn and `claim-pr` gates run before any `git` or `gh` call and name the session.
- The worktree plugin checks again and ends the options with `--` in all five `worktree add` calls. Valid
  names behave as before.
- The TypeScript rule equals `git check-ref-format --branch` on 30,222 names, except the deliberate `@`.
- The helper and hook checks refuse with one stderr line and rc=1, write nothing, and never change the
  exit code or stdout of the wrapped command.
- The helper calls no `git`. The m-10 key limit is unchanged.
- The `gh --head` analysis is correct, and no other stored-value path reaches an option position.
- `WRAPPER_VERSION` 0.2.5 rewrites the install.
- The tests fail on the base, and 14 of 15 mutants fail at least one test.
- Scope and commit rules hold.

## 7. Safety and cleanup

- Real `~/.ao/bin` before my work (08:30:20, start marker):

```text
total 24
drwxr-xr-x 2 taisung users 4096 2026-10-16 08:00:42.721132240 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 3218 2026-10-16 08:00:42.719132291 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 08:00:42.721132240 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 08:00:42.720132265 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 08:00:42.720132265 -0400 git
0.2.4   sha256: helper 2deab7f6…, gh adb33f1e…, git fbee814d…
```

- Real `~/.ao/bin` after my work:

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 24
drwxr-xr-x 2 taisung users 4096 2026-10-16 08:00:42.721132240 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 3218 2026-10-16 08:00:42.719132291 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 08:00:42.721132240 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 08:00:42.720132265 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 08:00:42.720132265 -0400 git
$ cat ~/.ao/bin/.ao-version
0.2.4
$ sha256sum ~/.ao/bin/ao-metadata-helper.sh ~/.ao/bin/gh ~/.ao/bin/git
2deab7f664feb0d7e0f34aff3daa5b2719249b6b1e68d0584d97fe162409eb71  ~/.ao/bin/ao-metadata-helper.sh
adb33f1eb29d7ccbe02df980d8acc85549790cf528f1d3243f0649f671c2fcfd  ~/.ao/bin/gh
fbee814d6515680c35a2840dd9c5129d04dd0e4320c6f16e131a243d23a44c3e  ~/.ao/bin/git
```

- Real state root (run before I removed the marker):

```text
$ find ~/.agent-orchestrator -maxdepth 1 -newer <S>/start-marker
(end of find)
```

  At deeper levels, 22 files changed in that time. All are under the real projects
  (`60756641ca25-agent-orchestrator`, `f6790d5546be-agent-skills`, and three `*-observability` process
  directories), written by the real fleets. No path holds `demo`, `scratch` or `ao32`. Every live run of
  mine set `AO_STATE_ROOT` to `<S>/live-<v>/state` (project directory `cc63696699d8-p`) and a fake `HOME`.
- Processes that I started and stopped by exact PID: first live pass, lifecycle workers 4149992 (head)
  and 4155241 (base), tmux servers 4149742 and 4155069 (`-L ao32b1-head`, `-L ao32b1-base`,
  `kill-server`); second live pass, lifecycle workers 18354 and 24043, tmux servers 18105 and 23670. I
  stopped one slow bash loop of mine with its task ID. Fake agents (`sleep`) left: none, by working
  directory and `HOME`.

```text
$ ps -o pid,args -u "$(id -u)" | grep -F "<S>" | grep -v grep
(end of list)
```

- The five real lifecycle workers are alive and untouched (3432870, 3433219, 3433850, 3434817,
  3434840). No tmux command went to the default server.
- `/tmp` state removed: all of `<S>`, the socket files `/tmp/tmux-44402/ao32b1-head`, `ao32b1-base` and
  `ao32b1test` (the last one from a test run, no server), and the 171 `/tmp/ao-test-state-*` and
  `/tmp/ao-plugin-registry-*` entries newer than my start marker (my gate, non-vacuity and mutant runs;
  no other test run was active).
- The worktree is at `bb81cf7a`. `git status --porcelain` shows only `.agent_report.md`, `.agent_task.md`
  and this review file. I made no commit.
