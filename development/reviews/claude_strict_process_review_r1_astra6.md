# Claude strict process and quoted-list review r1

**LAND-SAFE** for `b97a2500..6ea435a8` onto main with landed R4. **0 blocking, 0 major, 0 minor findings.** Independent evidence precedes reading the author report. No production code changes or commits. All executable checks use `/tmp/aocpr1/run` with env -i, fake HOME/TMPDIR/AO paths, no real agents, gh stub and private tmux. Protected lifecycle workers observed: 3830765 and 3830929.

## Independent source and behavior checks (before author report)

The tmux predicate (`index.ts:552`) now requires numeric exit 1, no signal, not killed, and the whole diagnostic for the exact session (or `no current target`), allowing one terminal LF. Wrong/prefix/suffix targets, CRLF, extra lines, string/absent exit codes, signals and timeouts reject. Exact absence controls return false. TTY parsing requires every row to be a `/dev/` path. The complete process list is validated before matching: recognized header, at least one row, positive canonical safe-integer PIDs, TTY and command fields. Even a valid Claude row followed by malformed data rejects. These forms match R4 table rows 10–11.

Stored PID (`index.ts:656`) accepts a positive safe integer or canonical decimal text. Signal 0 succeeds => true; EPERM => true; ESRCH => false. EINVAL/EACCES/ENOENT or missing error code reject with the original cause; invalid PID values never call kill. The no-PID rejection is the authorized owner choice. Herdr now delegates boolean matching to core (`index.ts:615`), removing `pid || null`. Strict malformed-reply rejection depends on R4 core, which is already on main; the pre-R4 core in this branch remains permissive. On the merged tree, my malformed/mismatched/contradictory Herdr cases reject, valid empty lists and unambiguous pane-not-found return false, and a live Claude record returns true. A failed command containing pane-not-found text still rejects with its cause.

The five-second ps cache itself is unchanged. My concurrent probes show malformed cached and in-flight answers reject every reader, command failures reject all waiters and permit retry, each handle matches its own TTY against shared data, and an older late response cannot overwrite a newer cache. A well-formed negative can still stay cached after a process appears, until TTL expiry; reproduced on both base and tip, tracked below as an older follow-up.

Independent tip suite: 77/77 pass, plus author's 77/77 new tests. The original quote (`● Here is an example:\n  ❯ 1. Red\n    2. Blue`) changes from waiting_input on base to active on tip. All 17 unchanged captured fixtures preserve their answers on both revisions: six dialogs waiting_input, six running active, five idle. The top rule and transcript-entry requirements each exclude a quoted-list shape without changing a captured real dialog. No fixtures or previous fixture expectations were edited.

Independent tests were also run against the clean merge with main, including 17 additional strict Herdr probes: 171/171 passed. These are scratch-only reviewer tests, removed before the required package gates. The author report has not yet been consulted at this checkpoint.

## Scope, test sensitivity, and commits

Only the four authorized existing tests change: empty TTY rejects; missing-session mock uses the exact session diagnostic; dead-PID mock carries ESRCH; missing PID rejects and still proves no command ran. Their local explanatory comments change too. All other existing test bodies and all fixtures are unchanged. The five changed files are precisely index.ts, those four index.test.ts blocks, the two new test files, and the Claude screen-rule paragraph of DEVELOPMENT.md (+590/-71). No CLI/core/other-plugin changes.

The author's 77 new tests on untouched base source produce **54 failures, 23 passes** (process: 47/62 fail; dialog: 7/15 fail). Every changed-behavior test fails as expected; the 23 passes are controls and failures already rejected by the old code. All 77 pass on tip and on merged main. My additional 77 probes yield **48 failures, 29 passes** on base and **77 passes** on tip. The three Herdr tests whose oracle consults core only assert the compatibility boundary; my 17 independent merge-only Herdr probes use fixed strict expectations and pass. This avoids relying on a core-derived oracle for the landed contract.

All five commits form a single-parent chain from b97a2500, have conventional titles and substantive WHY bodies, and contain no trailers, emoji, or issue numbers. `git branch -r --contains 6ea435a8` produced no output. Review created no commits.

## Mutants (scratch tip only)

Each mutant runs the same 154 author + independent probes, exits 1 with assertion failures, and is restored byte-for-byte afterwards. The unmodified control passes 154/154.

| Mutant | Failed / passed | Tests that fail (exact names or unique suffixes) |
| --- | --- | --- |
| Restore multiline prefix tmux diagnostic matcher | 19 / 135 | `rejects with the cause when tmux fails with the line names another session`; `...exit code 2`; `...a signal`; `...killed`; `independent tmux rejects prefix target`; `independent tmux rejects suffix target`; getActivityState unknown for wrong-session diagnostic |
| Return false for empty TTY output | 4 / 150 | `rejects an empty answer of a successful list-panes, with no ps call`; `rejects a blank line of a successful list-panes, with no ps call`; `TTY rejects ""`; `TTY rejects "\\n"` |
| Restore old showsChoiceDialog | 8 / 146 | `reads the reproducer of review r1 as the same rows without the list`; `reads a quote whose message starts above the top of the screen as the rows without the list`; five other no-box quote tests; `original quoted list closes` |
| Reviewer mutant: remove ps PID safe-integer validation | 2 / 152 | `rejects a PID too large to be exact, which is not a process list`; `ps PID rejects 9007199254740992` |

After completing independent items 1–2 I read the author report. Its source explanation and base/tip sensitivity agree with these runs. Its R4-red count of 22 describes the pre-R4 branch, not the current-main merge being validated here; that combined tree must have R4 = 0. Its live D2 evidence is supplementary, not counted as one of my own checks.

## Lifecycle consequence, independently reproduced

A scratch-only test uses the real Claude plugin, real session manager, real lifecycle manager and real scratch metadata. Subprocess answers are mocked; the runtime answers alive, a second healthy record avoids outage suppression, and records are older than launch grace. Each check waits for the lifecycle health correlation to change, twice. No real pane or model is involved.

- Malformed ps (`PID TT COMMAND` header only): base writes `killed` on the second poll (the keep-working assertion fails); tip keeps `working` on both polls.
- Valid ps with only bash on the target TTY: base and tip both write `killed` on the second poll; the first poll keeps working. This confirms the harness can reach the destructive branch.
- The companion record remains working. The process-list mock is called once across both polls, exercising the cache in the actual caller path.

Final harness: base 1 pass / 1 expected review failure; tip 2/2 pass. An initial harness assertion incorrectly required the wrapper isProcessRunning spy to run even when the real getActivityState had already returned exited. Replaced that assertion with checks on the actual ps call and getActivityState, without changing source or expected statuses.

## Gates and combination

Captured main: `511c697edd5b23740b349dd27a7300cd6bbf5cbc`.
Merge base: `b97a2500fd7da353000967c690da9d0ffaa3cf30`.
`git merge-tree --write-tree main 6ea435a8` exited 0 with no conflicts and tree `5b039aca4c0185c12ac0728bfc6c0d66e1488ea9`. This tree was archived into scratch, built, and uses workspace dependencies pointing to its own packages. No real checkout was merged or switched.

Worktree gates, all under the isolated wrapper:

- `pnpm install --frozen-lockfile`: exit 0.
- `pnpm build`: exit 0.
- `pnpm --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-cli test`: exit 0; Claude 318, CLI 323 passed.
- `pnpm lint`: exit 0, zero errors and five pre-existing warnings outside changed files.
- `pnpm typecheck`: exit 0.

Merged tree: `pnpm build` exit 0; `pnpm --filter @aoagents/ao-core --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-cli test` exit 0 (core 1616 passed + 1 expected fail, Claude 318, CLI 323). An initial command used nonexistent abbreviated package names and matched no projects; it is not counted as a gate. The command above used the actual package names.

The merged full command `pnpm -r --no-bail test` exited **0**: **3541 passed, 1 expected fail, 29 skipped, 0 unexpected failures**. Counts: core 1616 + 1 expected fail; Claude 318; codex 307; gemini 88; opencode 363; runtime-herdr 73; runtime-tmux 69; workspace-worktree 85; tracker 42; scm 140 + 5 skipped; notifier 26; integration 91 + 24 skipped; CLI 323. These are unmodified repository suites, without the review probes. The expected-failure and skipped cases remain visible; they are not claimed as passing tests.

`SAME_ID_DEFECTS=red`, run package-by-package through isolated `pnpm exec vitest run same-id --reporter=json`, gives exactly **R1 = 0, R2 = 16, R3 = 6, R4 = 0** failed tests (22 total; 93 passing, including 23 additional strict-read tests). These intentional red failures are pre-existing identity defects, not gate regressions. Per-package counts:

| Package | Passed | R1 | R2 | R3 | R4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| cli | 2 | 0 | 0 | 0 | 0 |
| core | 56 | 0 | 0 | 1 | 0 |
| agent-claude-code | 1 | 0 | 1 | 0 | 0 |
| agent-codex | 3 | 0 | 1 | 0 | 0 |
| agent-gemini | 3 | 0 | 1 | 0 | 0 |
| agent-opencode | 3 | 0 | 1 | 1 | 0 |
| runtime-herdr | 8 | 0 | 1 | 0 | 0 |
| runtime-tmux | 12 | 0 | 11 | 0 | 0 |
| workspace-worktree | 5 | 0 | 0 | 4 | 0 |

## Findings and follow-ups

**Findings: B = 0, M = 0, m = 0.** I found no introduced/worsened defect or unresolved defect in the changed parsing/dialog logic that blocks this range. No tested malformed or ambiguous answer becomes a new false negative, and the tested exact absence forms remain negative. This verdict is for landing onto current main, which already contains the strict R4 Herdr parser; it is not a claim that the older base core became strict in this branch.

- **F-8 (existing, explicitly out of scope):** align the other three agents' no-PID behavior later. Claude rejection is authorized here; codex/gemini/opencode retaining false is not a finding of this range.
- **F-9 (older cache behavior; `packages/plugins/agent-claude-code/src/index.ts:508`):** a well-formed negative process snapshot stays authoritative for up to five seconds after a process starts or its TTY is reused. Reproducer on base and tip: at mocked time 0, return `PID TT COMMAND\n123 pts/4 /bin/bash\n` for `/dev/pts/4`; check => false. Change the provider to `/bin/claude` without advancing past TTL; check still false. At 5001 ms, check => true. The cache and TTL are unchanged; this is distinct from malformed cached data, which now rejects. Consider whether destructive callers need a fresh negative. No new regression is claimed.

Screen-parser limits: the fixture evidence covers the captured 2.1.304–2.1.307 shapes. An entire dialog quoted with an unindented rule and no visible transcript-entry marker can be indistinguishable from a dialog; top-clipped or otherwise novel dialog layouts lack a fixture-backed guarantee. This bounded heuristic is not general terminal emulation, and no captured regression was found. These limits do not reopen the original three-line quoted-list defect, which is directly fixed and tested.

Correct aspects: exact target-specific absence matching; complete list validation before deciding absence; preserved original command/signal errors; strict R4 Herdr behavior in the combined tree; malformed shared-cache answers remain unknown; two-poll lifecycle behavior is repaired without losing the valid-negative control; all 17 captured screen classifications stay unchanged; focused scope and sensitive tests.

## Isolation and cleanup audit

Every executable test, helper, node, pnpm and git invocation ran with env -i via `/tmp/aocpr1/run`: fake HOME `/tmp/aocpr1/home`, TMPDIR `/tmp/aocpr1/tmp`, AO_CONFIG_PATH `/tmp/aocpr1/config.yaml`, AO_STATE_ROOT `/tmp/aocpr1/home/.agent-orchestrator`, scratch XDG paths, CI/HUSKY flags, and PATH `/tmp/aocpr1/bin:/usr/bin:/bin`. No real agent or Herdr binary was available on that PATH. The gh stub makes no network calls. tmux commands used the explicit private `aocpr1-tests` server and a cleared environment with no inherited AO variables. Fixtures supplied screen data; no real pane was read. The author's `/tmp/aocp` was not changed. No ao send, real AO state command, push, PR, commit, pull, rebase, or branch switch was performed.

Required real-state audit (read only):

```text
$ find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aocpr1-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
```

Every returned entry is accounted for:

- `sessions/ao-52`: modified 10:12:19 EDT, generation 45, status stuck, agent claude-code, worktree ao-52. Real lifecycle-worker log records its working-to-stuck transitions.
- `sessions/ao-54`: modified 10:13:49 EDT, generation 51, status stuck, agent claude-code, worktree ao-54. The same real log records its working-to-stuck transitions.
- `sessions`: directory mtime 10:13:49 EDT agrees with the ao-54 record replacement.
- `sessions/archive`: modified 10:07:20 EDT when external session ao-55 was archived as `ao-55_2026-10-22T14-07-20-702Z` (generation 51, its own ao-55 worktree). No review action archived a real record; the responsible external actor was not identified.
- `sessions/.generations`: modified at that same 10:07:20 EDT operation; its new `ao-55` entry has the same time. It belongs to that external archival activity, not this review's scratch records.

The real workers remained running: PID 3830765 (agent-orchestrator, started 10:00:18 EDT) and PID 3830929 (agent-skills, started 10:00:21 EDT). The real worker PID file confirms 3830765. They were inspected with ps/read-only file tools and never signaled. Every review runtime and metadata write was redirected to scratch.

Before:

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

After (byte-identical listing; cmp exit 0):

```text
$ ls -la --time-style=full-iso ~/.ao/bin
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Owned-process audit after all tests: `/proc` scan of exact scratch environment/path markers, excluding the auditor and its ancestors:

```json
[]
```

The private socket `/tmp/tmux-44402/aocpr1-tests` was inactive (`tmux -L aocpr1-tests list-sessions`: no server running) and was removed by its exact name. No process needed a signal. Tracked worktree diff remains empty; only the requested review/report are authored here, and the prior untracked R4 validation report is preserved.

Final cleanup: `/tmp/aocpr1` and `/tmp/aocpr1-marker` removed and verified absent. The required real-state listing and wrapper listing were rechecked immediately before removal and were unchanged. Final report published atomically after cleanup, preserving earlier reports.
