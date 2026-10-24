# Herdr fit-2b r3 landing check — Sol61

LAND-SAFE

0 B, 0 M, 0 m. **R2 M-1 is closed.** The three previously surviving single-call omissions now fail the new tests; all eight subject-check sites have independent regression coverage. No new product change is needed. Review is of both commits through `747e7388`, against `66dff58c`, under owner decision 33 (1).

## Scope and old-test preservation

I read both commits before the author report. The branch-tip receipt is:

```text
747e7388 test(core): type the record of the r3 subject-site helper
```

```text
a10e6e7a 66dff58c test(core): guard the last three subject-check use sites
747e7388 a10e6e7a test(core): type the record of the r3 subject-site helper
```

```text
 .../session-manager/orchestrator-admission.test.ts | 152 ++++++++++++++++++++-
 1 file changed, 151 insertions(+), 1 deletion(-)
```

```text
M	packages/core/src/__tests__/session-manager/orchestrator-admission.test.ts
```

Only the admission test file changed. The first commit adds the four cases and a header explanation. The second fixes the helper's assignability to `SessionMetadata`: it moves the conditional handle spread to an `extra: Record<string, string>` variable and infers the required fields on `record`, instead of annotating `record` itself as `Record<string, string>`. That preserves the constructed keys and values; no test schedule or assertion changes in that commit. Root typecheck passes on the final tip. I did not separately rerun the known intermediate typecheck failure.

I removed the new describe and header addition in memory and compared the remainder with the base file. I also compared the executed old-case name lists, with a known post-mkdir subject case as a nonempty sentinel in each:

```text
Removing the new r3 describe and the introductory comment addition exactly reproduces the file at 66dff58c. Old test bodies and oracles are byte-for-byte equal.
```

```text
Base file: 21/21 passed. Tip file: 25/25 passed. The old 21 names are non-empty and equal; both contain the post-mkdir subject sentinel. Test bodies/oracles are byte-for-byte equal after deleting the new describe and header-comment addition.
```

The initial untracked r1/r2 reviews were left untouched; hashes are retained below.

## R2 M-1: three survivors now caught

Each run below used the same 16 changed fit-2b test files on the tip, including the four r3 additions. Before every mutant, I restored the original source, removed exactly one call and rebuilt core. The source and compiled core were restored after the matrix. The correct run passed all 514 tests (core 85, runtime-herdr 178, CLI 251).

| implementation | core pass/fail | Herdr pass/fail | CLI pass/fail | total pass/fail |
| --- | ---: | ---: | ---: | ---: |
| correct | 85/0 | 178/0 | 251/0 | 514/0 |
| 3397 | 83/2 | 178/0 | 251/0 | 512/2 |
| 4119 | 84/1 | 178/0 | 251/0 | 513/1 |
| 4123 | 84/1 | 178/0 | 251/0 | 513/1 |

The `:3397` mutant fails the reuse-only and restore cases. The `:4119` and `:4123` mutants each fail their respective retry case. Other changed-file tests remain green. The exact file list used is:

```text
packages/cli/__tests__/commands/session.test.ts
packages/cli/__tests__/commands/spawn.test.ts
packages/cli/__tests__/commands/start-herdr-guard.test.ts
packages/cli/__tests__/commands/start-herdr-interim.test.ts
packages/cli/__tests__/commands/start.test.ts
packages/cli/__tests__/commands/status.test.ts
packages/core/src/__tests__/runtime-stop.test.ts
packages/core/src/__tests__/session-manager/orchestrator-admission.test.ts
packages/core/src/__tests__/session-manager/orchestrator-herdr-start.test.ts
packages/core/src/__tests__/session-manager/retire-herdr.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit-pins.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit-startup-interim.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit2-admission-fork.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit2-admission.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit2-create-rollback.test.ts
packages/plugins/runtime-herdr/src/__tests__/fit2-startup.test.ts
```

Commands were `pnpm exec vitest run <the package's listed files> --reporter=json --outputFile=<scratch evidence JSON>`, from each package directory, through the cleared-environment runner. Each mutant core build exited 0. Each survivor run has a nonzero core test exit and zero exits in CLI and Herdr, for the intended assertion failures.

## Independent eight-site matrix

Actual call lines in `packages/core/src/session-manager.ts` on the reviewed tip:

| line | use |
| ---: | --- |
| 3393 | start, directly after sessions-directory mkdir |
| 3397 | existing directory, reuse-only or restore |
| 4097 | first project-mode reservation |
| 4119 | retry after the concurrent outside-set runtime answers dead |
| 4123 | retry after a concurrent record has no handle |
| 4190 | isolated reservation |
| 6284 | archive copy-back |
| 6375 | restore transition write |

I ran all 25 cases of the admission file against each of the eight individual omissions, then against a no-op `checkSubject` function. This includes all nine subject cases (five r2, four r3) and all sixteen other cases. Each core build, including final restoration, exited 0. The nine-column matrix below comes from the independent JSON results, not the author's matrix:

| subject case | 3393 | 3397 | 4097 | 4119 | 4123 | 4190 | 6284 | 6375 | noop |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| mkdir | FAIL | pass | pass | pass | pass | pass | pass | pass | FAIL |
| isolated reservation | pass | pass | pass | pass | pass | FAIL | pass | pass | FAIL |
| project reservation | pass | pass | FAIL | pass | pass | pass | pass | pass | FAIL |
| archive copy-back | pass | pass | pass | pass | pass | pass | FAIL | pass | FAIL |
| restore transition | pass | pass | pass | pass | pass | pass | pass | FAIL | FAIL |
| existing dir/reuse | pass | FAIL | pass | pass | pass | pass | pass | pass | FAIL |
| existing dir/restore | pass | FAIL | pass | pass | pass | pass | pass | pass | FAIL |
| dead concurrent retry | pass | pass | pass | FAIL | pass | pass | pass | pass | FAIL |
| handleless retry | pass | pass | pass | pass | FAIL | pass | pass | pass | FAIL |

Each single-site failed-name set was asserted nonempty and exactly equal to the intended site cases. The no-op failed-name set equals the complete nine-case subject set. Every other case passed under every mutant.

| removed site | file passed | file failed | failing subject cases |
| --- | ---: | ---: | --- |
| 3393 | 24 | 1 | start: the real path changes right after the mkdir |
| 3397 | 23 | 2 | reuse-only checks the subject; restore checks the subject of an existing |
| 4097 | 24 | 1 | start, project mode: |
| 4119 | 24 | 1 | retry after a concurrent record outside the set |
| 4123 | 24 | 1 | retry after a concurrent record with no handle |
| 4190 | 24 | 1 | start, isolated mode: |
| 6284 | 24 | 1 | restore from the archive: |
| 6375 | 24 | 1 | restore: the real path changes during |
| no-op | 16 | 9 | all nine |

All nine builds and the restoration build exit 0. Each single-site failure set is non-empty and exactly equals its expected site tests; no other test of the 25-test file fails.

Exact subject test full names:
- r2 sol M-4 and argon M-1: the subject check at each use site (design r11 4.9, 5.3.1) start: the real path changes right after the mkdir; the check after the mkdir refuses
- r2 sol M-4 and argon M-1: the subject check at each use site (design r11 4.9, 5.3.1) start, isolated mode: the real path changes directly before the reservation; the check there refuses
- r2 sol M-4 and argon M-1: the subject check at each use site (design r11 4.9, 5.3.1) start, project mode: the real path changes directly before the reservation; the check there refuses
- r2 sol M-4 and argon M-1: the subject check at each use site (design r11 4.9, 5.3.1) restore from the archive: the real path changes before the copy-back; the check there refuses
- r2 sol M-4 and argon M-1: the subject check at each use site (design r11 4.9, 5.3.1) restore: the real path changes during the old runtime's stop; the check before the transition write refuses
- r3: the subject check at the last three use sites (review r2 sol61 M-1; design r11 4.9, 5.3.1) reuse-only checks the subject of an existing sessions directory: admission-path; no probe, no reuse answer
- r3: the subject check at the last three use sites (review r2 sol61 M-1; design r11 4.9, 5.3.1) restore checks the subject of an existing sessions directory: admission-path; no runtime created
- r3: the subject check at the last three use sites (review r2 sol61 M-1; design r11 4.9, 5.3.1) project mode: the retry after a concurrent record outside the set answers dead checks the subject before it reserves
- r3: the subject check at the last three use sites (review r2 sol61 M-1; design r11 4.9, 5.3.1) project mode: the retry after a concurrent record with no handle checks the subject before it reserves

## Schedule review and the :4123 question

New cases are in `packages/core/src/__tests__/session-manager/orchestrator-admission.test.ts` at lines 437, 460, 484 and 522 (describe starts at 418):

- **437, reuse-only / :3397:** a live-looking Herdr record exists; `onStage("lock-held")` moves the sessions directory and replaces its original path with a symlink. The existing-directory subject check must refuse before any runtime probe or reuse answer.
- **460, restore / :3397:** the same stage moves an existing active killed record. The mock create runtime is outside the set, and no archive is copied back, so neither the copy-back nor transition check can mask the omitted existing-directory check. The record must stay killed with no handle or restored timestamp, and no runtime is created.
- **484, retry / :4119:** `onStage("before-reservation")` creates a concurrent outside-set record after the old-record branch. The first subject check passes and reservation loses. The concurrent runtime's mock `isAlive` moves the directory and answers false. The retry subject check must refuse after the dead record is removed and before a new reservation or runtime is created.
- **522, retry / :4123:** the before-reservation stage arms the existing one-shot `fsHooks.afterMkdir`. The first reservation's mkdir invokes the hook after the `:4097` check; it writes a handleless concurrent record and moves the directory. The first reservation loses and the handleless branch must refuse with `admission-path` before retrying.

No product seam or metadata-module mock is added. The existing fs hook clears itself before its callback (line 41) and is reset before every case (line 89), preventing recursive or cross-test activation. The old tests and their oracles remain unchanged. The matrix proves that an earlier or later check does not substitute for the targeted call in any new case.

**The committed :4123 test is sufficient to close the rule-coverage finding.** Design 4.9 explicitly requires `admission-path` on a changed subject directly before reservation. Its typed refusal reason is part of the contract, so testing that reason guards the rule even when the conflicting record independently prevents a runtime launch. In this committed schedule, source analysis agrees with the reported alternate generic refusal: the handleless record stays in place, so a second reservation also encounters it. This is not a requirement that a mutant must create a runtime to count as detected.

**A stronger real-effect schedule does exist without a new product seam.** The author's report says none exists; my scratch probe disproves that statement. In the same first-reservation mkdir hook, write the handleless record to make the first reservation lose, then queue its deletion and the directory move:

```ts
fsHooks.afterMkdir = { path: sessionsDir, run: () => {
  workingOrchestrator(null);
  queueMicrotask(() => {
    deleteMetadata(sessionsDir, "app-orchestrator", false);
    moved = moveSessionsDir();
  });
}};
```

The synchronous first reservation finishes and `concurrentRaw` is read before the queued callback runs at the awaited `selectedByG1(concurrentRaw)` boundary. The local handleless snapshot remains available, while the actual directory is now moved and the conflicting record gone. The later launcher-check await supplies another yield; there is no fresh subject check before `:4123`. With the correct code, that check refuses and creates nothing. With only `:4123` omitted, the retry reserves in the moved directory and a mock runtime is launched successfully. No new product hook or module mock is required.

The scratch probe itself passed on correct core and failed on the single-call omission; both runs saved a state snapshot before the refusal assertion. Measured snapshots:

```json
[
  {
    "version": "correct",
    "moved": true,
    "reason": "admission-path",
    "error": "AO cannot fix the admission path of project my-app (the real path of /tmp/aof2bs3/tmp/ao-test-state-287975/.agent-orchestrator/58f215468045-my-app/sessions is now /tmp/aof2bs3/tmp/ao-test-state-287975/.agent-orchestrator/58f215468045-my-app/sessions-moved, not /tmp/aof2bs3/tmp/ao-test-state-287975/.agent-orchestrator/58f215468045-my-app/sessions); no orchestrator was started.",
    "runtimeCreates": 0,
    "recordStatus": null,
    "recordHandle": null
  },
  {
    "version": "mutant",
    "moved": true,
    "reason": null,
    "error": null,
    "runtimeCreates": 1,
    "recordStatus": "working",
    "recordHandle": "{\"id\":\"rt-1\",\"runtimeName\":\"mock\",\"data\":{}}"
  }
]
```

This supports the necessity of the check and offers an optional stronger regression case. It does not reopen M-1: the committed case already fails on that exact omission for the specified design rule. The report's overstatement is corrected here and is not a product or committed-test defect.

## Gates

All pnpm, node and test calls used `/tmp/aof2bs3/run`:

```sh
env -i HOME=/tmp/aof2bs3/home TMPDIR=/tmp/aof2bs3/tmp   PATH=/tmp/aof2bs3/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true "$@"
```

PATH was a directory of utility links, cached pnpm 9.15.4 and Node 25.7.0, with an offline `gh` stub. There was no ao, real agent, herdr, npm or npx executable on it. The tmux shim ran `env -u TMUX /usr/bin/tmux -L aof2bs3-tests "$@"`; test-specific `-S` sockets override the supplied `-L`. Nothing used the default tmux server, a real agent or Herdr server, network, or real AO configuration. All installs used `--frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3` and HUSKY=0.

Tip frozen offline install, build, typecheck, lint and one full `pnpm -r --no-bail test` all exited 0. Full-suite receipts:

```text
packages/core test:  Test Files  67 passed (67)
packages/core test:       Tests  1882 passed | 1 expected fail (1883)
packages/plugins/agent-gemini test:  Test Files  3 passed (3)
packages/plugins/agent-gemini test:       Tests  99 passed (99)
packages/plugins/agent-codex test:  Test Files  7 passed (7)
packages/plugins/agent-codex test:       Tests  318 passed (318)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  10 passed (10)
packages/plugins/agent-claude-code test:       Tests  368 passed (368)
packages/plugins/runtime-herdr test:  Test Files  11 passed (11)
packages/plugins/runtime-herdr test:       Tests  341 passed (341)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  365 passed (365)
packages/plugins/runtime-tmux test:  Test Files  6 passed (6)
packages/plugins/runtime-tmux test:       Tests  116 passed (116)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  30 passed (30)
packages/cli test:       Tests  491 passed (491)
```

Core's only delta from r2 is the four added cases (1878 to 1882 passed); the one expected failure remains. Herdr and CLI match r2 at 341 and 491, respectively. All remaining package counts match the r2 baseline recorded in the task. I did not rerun the entire r2 suite; the tip's full counts above are this review's run. The r2 admission file and all red-mode packages were freshly run in a base archive.

Lint has exactly the five specified source warnings, plus ESLint's existing `.eslintignore` migration notice:

```text

> agent-orchestrator@0.1.0 lint /tmp/aof2bs3/tip
> eslint .

(node:241937) ESLintIgnoreWarning: The ".eslintignore" file is no longer supported. Switch to using the "ignores" property in "eslint.config.js": https://eslint.org/docs/latest/use/configure/migration-guide#ignore-files
(Use `node --trace-warnings ...` to show where the warning was created)

/tmp/aof2bs3/tip/packages/cli/src/commands/spawn.ts
  332:24  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aof2bs3/tip/packages/core/src/activity-log.ts
  91:31  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aof2bs3/tip/packages/core/src/plugin-registry.ts
  232:7  warning  Forbidden non-null assertion  @typescript-eslint/no-non-null-assertion

/tmp/aof2bs3/tip/packages/core/src/session-manager.ts
  3880:11  warning  Unexpected console statement  no-console
  3887:9   warning  Unexpected console statement  no-console

✖ 5 problems (0 errors, 5 warnings)
```

`SAME_ID_DEFECTS=red` ran in all nine packages containing same-id test files, freshly on both base and tip. CLI and Herdr exit 0; core, claude-code, codex, gemini, opencode, runtime-tmux and worktree exit 1 as expected. The driver first rejected an incorrectly spelled sentinel label after its base runs; I corrected the driver to use the actual full-name substrings and repeated both comparisons. That was a reviewer harness error, not a product test failure. Final comparison:

```text
Both lists non-empty; each contains [same-id R2] B-1 and [same-id R3] F-5. Base/tip: 21/21 failures; sorted full names equal.
R2=15 R3=6
```

The full equal nonempty failing set (each list contains the B-1 and F-5 sentinels) is:

```text
packages/core | [same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime
packages/plugins/agent-claude-code | [same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
packages/plugins/agent-codex | [same-id R2] D-B: the codex pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
packages/plugins/agent-gemini | [same-id R2] D-B: the gemini pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
packages/plugins/agent-opencode | [same-id R2] D-B: the opencode pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
packages/plugins/agent-opencode | [same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get a rollback during another spawn's session.get does not remove the session that the spawn then stores
packages/plugins/runtime-tmux | [same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
packages/plugins/runtime-tmux | [same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, isAlive of the old launch answers false
packages/plugins/runtime-tmux | [same-id R2] B-1: two launches of an ID in the same second destroy of the first launch keeps a replacement of the ID that started in the same second
packages/plugins/runtime-tmux | [same-id R2] B-1: two launches of an ID in the same second isAlive of the first launch answers false while a same-second replacement of the ID runs
packages/plugins/runtime-tmux | [same-id R2] B-2: a replacement between the create and its launch keys create: a replacement of the ID made directly after the create command never receives the first launch's keys
packages/plugins/runtime-tmux | [same-id R2] B-5: another server answers at the recorded socket path isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
packages/plugins/runtime-tmux | [same-id R2] B-5: another server answers at the recorded socket path isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
packages/plugins/runtime-tmux | [same-id R2] D-B: a call finds the tmux server only through its environment destroy from another server's environment does not end that server's session of the same name
packages/plugins/runtime-tmux | [same-id R2] D-B: a call finds the tmux server only through its environment isAlive answers true for a live session when the caller's environment names another server
packages/plugins/runtime-tmux | [same-id R2] F-5: destroy by name ends another launch of the same name destroy keeps a newer session of the same name that another launch created
packages/plugins/runtime-tmux | [same-id R2] F-7: a hidden socket of a running server reads as no server isAlive does not report 'no server' while the recorded server process still runs
packages/plugins/workspace-worktree | [same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree create does not remove a worktree that another launch made at the path during the checkout
packages/plugins/workspace-worktree | [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files restore: postCreate keeps the files of another launch that took the record and the path during the git add
packages/plugins/workspace-worktree | [same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files spawn: postCreate keeps the files of another launch that took the record and the path during the git add
packages/plugins/workspace-worktree | [same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it kill and restore of one ID: the active record at the end still has its worktree
```

Full-range secret scan, exit 0:

```text

    ○
    │╲
    │ ○
    ○ ░
    ░    gitleaks

8:48AM INF 10 commits scanned.
8:48AM INF scan completed in 96.6ms
8:48AM INF no leaks found
```

The relaunch files ran within the full suite; an additional standalone relaunch run was not run in this narrow check. No live smoke test was run, as required by the brief.

## Landing readiness

`git merge-tree --write-tree --merge-base c6d80383 main 747e7388` exited 0, with no conflict paths:

```text
fbd02489b7bc33c0936b8e45db5c1460af930630
```

No refs were changed. Main's changes after the merge base are confined to these development paths:

```text
development/HANDOVER.md
development/TODO_TRACKING.md
development/artifacts/model_router_log/log.csv
development/reviews/herdr_fit2b_code_review_r1_argon4.md
development/reviews/herdr_fit2b_code_review_r1_sol61.md
development/reviews/herdr_fit2b_code_review_r2_sol61.md
```

## Cleanup and preserved evidence

At review start, I touched `/tmp/aof2bs3-marker` and saved the required real-bin listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The final full-iso listing compares byte-for-byte equal (`cmp` exit 0). The real-state scan after the last test was exactly:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2bs3-marker   -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'   -not -name 'lifecycle-worker.log'
```

Its entire output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-86
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
```

All three paths are under the concurrent owner agent-orchestrator state root, outside this review sandbox. sessions/ao-73 is the protected implementer session; sessions/ao-86 is the protected parked session. The sessions directory mtime changes with its atomic record replacements. These are owner/orchestrator/lifecycle session metadata activity, not review activity: every test/build ran with HOME=/tmp/aof2bs3/home, the PATH had no ao or real agent executable, and no real-state ao command ran. No writer syscall tracing was installed; the exact writing PID is not measured. No protected worktree, pane or session contents were inspected.

Readable same-UID `/proc` environment/cwd scan, excluding the scanner and its parent, after all tests:

```json
{
  "matchingOwnProcesses": [],
  "unreadableSameUidProcEntries": 13
}
```

The 13 unreadable same-UID proc entries are outside that scan's visibility; I make no environment claim about them. No process was manually killed. Private tmux check, through the isolated shim, exit 1 as expected:

```text
no server running on /tmp/tmux-44402/aof2bs3-tests
```

Restoration and preservation receipts:

```text
Tip and probe core product/test sources equal 747e7388; base core product/test sources equal 66dff58c. Probe and base core restoration builds exit 0.
```

```text
Both r1/r2 review SHA-256 hashes match their start-of-check values.
{
  "/home/taisung/.worktrees/agent-orchestrator/ao-84/development/reviews/herdr_fit2b_code_review_r1_sol61.md": "8cc663ca955d258aa4173f8eef8c22251ebe0c867157a8a7963e1d92aec41290",
  "/home/taisung/.worktrees/agent-orchestrator/ao-84/development/reviews/herdr_fit2b_code_review_r2_sol61.md": "ea27b42397d8fb205d70f3a742230d37f6a1472177655ee01fb811f06f57b1a2"
}
```

Tracked diff is empty (exit 0). The only worktree writes by this check are this new untracked review and the required `.agent_report.md`. No source change, commit, push, PR, ao send, branch change, fetch or rebase occurred.

All evidence cited here has been copied into this review before scratch deletion. Final checked removal receipt follows below.

Recorded command exits (the red-comparison driver returns 0 only after checking the expected package failures and equal 21-case sets):

```text
tip-install: 0
probe-install: 0
base-install: 0
tip-build: 0
probe-build: 0
base-build: 0
tip-typecheck: 0
tip-lint: 0
tip-full: 0
gitleaks: 0
mutations: 0
probe4123: 0
red: 0
tracked-diff: 0
ao-bin-cmp: 0
private-tmux: 1
```

```json
{
  "scratchRemoved": true,
  "markerRemoved": true,
  "privateTmuxSocketRemoved": true
}
```
