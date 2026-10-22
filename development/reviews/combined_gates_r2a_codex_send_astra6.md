# Combined validation: same-ID R2a and Codex send

**PASS — 3225 passed, 11 expected fail, 29 skipped; no unexpected failure.** All items 1–7 pass on `validate/combined-main` at `dbbaf472b8a7160f9ad64ed57cab98277903a6ca`. The red defect run has the expected 44 failures, separate from the normal suite. This validates the combined tree; it does not reopen either design verdict. No source edits, worktree commit, push or PR.

## Restart and isolation

The first preflight observed the old f39d63db tip during the dispatch/switch race. Per orchestrator note 1, all pre-22:25:39 results were discarded. Only dependency installation had started; it exited before the restart. No build or test had started, and none of its recorded process IDs remains alive. Restarted at item 1, then reran frozen installation on the combined tree. The earlier review files are now the byte-identical tracked copies supplied by the orchestrator.

Marker `/tmp/aocomb-marker`; scratch `/tmp/aocomb/ao56`; fake HOME and TMPDIR under scratch. Every node/pnpm/test/helper call uses `env -i HOME=/tmp/aocomb/ao56/home PATH=/tmp/aocomb/ao56/bin:/usr/bin:/bin TMPDIR=/tmp/aocomb/ao56/tmp LANG=C.UTF-8`. `command -v` finds none of claude, codex, gemini, opencode or herdr. gh is a denying stub except version/auth status. The tmux shim unsets TMUX and selects a private server; gate, replay and R2a smoke servers are separate. No real pane read or model turn.

## Item 1: combined tree

```text
$ git rev-parse HEAD
dbbaf472b8a7160f9ad64ed57cab98277903a6ca
$ git branch --show-current
validate/combined-main
$ git diff --stat e3be12a9 HEAD -- . ':!development'
(empty)
```

These are the repeated, post-switch results used for validation.

## Item 5: built Codex parser and activity

Command: `node /tmp/aocomb/ao56/inspect.mjs` in the isolated environment, importing the freshly built combined plugin. Exit 0: `ITEM 5 PASS: all 11 parser/detector/lifecycle controls, alive process, no native JSONL.` All six committed captures and the real idle fixture are byte-equal to the read-only originals. Each case has a fresh scratch workspace/activity log; `isProcessRunning` returns true and the fake HOME contains no native Codex JSONL.

| Screen | Parser running | detectActivity | recordActivity → getActivityState |
|---|---|---|---|
| Real running 01–06 (six separate cases) | true; empty composer | active | active |
| R2 M-1 quoted prompt | false; matching nonempty composer | idle | idle |
| R2 M-2 numbered message | false; matching nonempty composer | idle | idle |
| R2 M-3 approval | false; no composer | waiting_input | waiting_input |
| B-2 nested prompt | true; nonempty composer | active | active |
| Real idle | false; empty composer | idle | idle |

Their built-CLI output checks are recorded under item 6 below.

## Item 7: built R2a smoke

Command: `node /tmp/aocomb/ao56/r2a-smoke.mjs` in the isolated environment. Used the JavaScript fence in `git show main:development/reviews/same_id_r2a_review_r4_astra6.md`, section “Live built-code harness”, with paths changed to `/tmp/aocomb/ao56/r2a-live`, server `aocomb-r2a-ao56`, and the modes limited to the required `helper-completed` archived case. The core session manager and tmux/Codex/worktree plugins are the built combined code. A scratch git seed/worktree and private sleep pane stand in for a session; no agent is launched.

During the controlled unknown runtime stop, the exported shipped `AO_METADATA_HELPER` writes PR 100, status `pr_open` and the actual new branch. The refusal retains exactly that active record (generation 2 and reservation ID included). Archive SHA-256, floor 1, workspace contents and private pane identity remain unchanged. Exit 0: `LIVE PASS`.

```text
runtime stop unconfirmed (unknown): review controlled refusal; original pane left running; the archive copy-back of this restore changed during the stop (another operation on the ID wrote to it), so it was kept as the active record of rv-helper-completed with that write and was not removed; this restore did not change the workspace, and no new runtime was created; check that record with `ao session ls` before you restore again, because a restore now reads the active record and not the archive
```

Retained PR: `https://github.com/review/scratch/pull/100` (fixture text; no network request). Retained branch: `feat/helper-helper-completed`. The private pane/server PIDs 1138477/1138476 were stopped in `finally` by exact PID.

## Items 2–3: combined gates and branch comparison

All commands ran from this worktree after the corrected switch, with the isolation prefix above. Build completed before dependent tests and built-code checks.

```text
pnpm install --frozen-lockfile (CI=true HUSKY=0): exit 0, Already up to date
pnpm build: exit 0, 12 build: Done
pnpm typecheck: exit 0, 13 typecheck: Done
pnpm lint: exit 0, 5 problems (0 errors, 5 warnings)
pnpm -r --no-bail test: exit 0
packages/core test:       Tests  1548 passed | 11 expected fail (1559)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  280 passed (280)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/runtime-herdr test:       Tests  50 passed (50)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  305 passed (305)
TOTAL: 3225 passed, 11 expected fail, 29 skipped; 0 unexpected failures
```

The five lint warnings are unchanged: spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232 (non-null assertions), and session-manager.ts:2335/2342 (console). The OpenCode integration live block was skipped: `src/agent-opencode.integration.test.ts (26 tests | 5 skipped)`; all integration skips total 24, plus 5 SCM skips. No real agent binary was available. Fixture logs saying a mocked prompt delivery failed are test diagnostics, not failed assertions.

Comparison sources: ao-55’s `ao-55_same_id_r2a_round4.report.md` D4 and ao-57’s tracked `same_id_r2a_review_r4_astra6.md` gate section independently report the same R2a counts at 26368d76. The Codex column is this reviewer’s f39d63db round-4 run. Both prior runs are cited evidence, not rerun as part of this validation. Cells are passed / expected fail / skipped.

| Package | R2a 26368d76 (ao-55 = ao-57) | Codex f39d63db | Combined dbbaf472 |
|---|---:|---:|---:|
| core | 1548 / 11 / 0 | 1392 / 4 / 0 | 1548 / 11 / 0 |
| plugins/agent-gemini | 67 / 0 / 0 | 67 / 0 / 0 | 67 / 0 / 0 |
| plugins/agent-codex | 220 / 0 / 0 | 280 / 0 / 0 | 280 / 0 / 0 |
| plugins/notifier-desktop | 26 / 0 / 0 | 26 / 0 / 0 | 26 / 0 / 0 |
| plugins/agent-claude-code | 215 / 0 / 0 | 214 / 0 / 0 | 215 / 0 / 0 |
| plugins/runtime-herdr | 50 / 0 / 0 | 38 / 0 / 0 | 50 / 0 / 0 |
| plugins/scm-github | 140 / 0 / 5 | 140 / 0 / 5 | 140 / 0 / 5 |
| plugins/tracker-github | 42 / 0 / 0 | 42 / 0 / 0 | 42 / 0 / 0 |
| plugins/runtime-tmux | 69 / 0 / 0 | 52 / 0 / 0 | 69 / 0 / 0 |
| plugins/workspace-worktree | 70 / 0 / 0 | 65 / 0 / 0 | 70 / 0 / 0 |
| plugins/agent-opencode | 322 / 0 / 0 | 322 / 0 / 0 | 322 / 0 / 0 |
| integration-tests | 91 / 0 / 24 | 91 / 0 / 24 | 91 / 0 / 24 |
| cli | 277 / 0 / 0 | 297 / 0 / 0 | 305 / 0 / 0 |
| **Total** | **3137 / 11 / 29** | **3026 / 4 / 29** | **3225 / 11 / 29** |

Every difference is additive test coverage from the other branch:

- Versus R2a: Codex adds **60** plugin tests (27 in the new codex-screen suite and 33 in index.test.ts) and **28** CLI tests in send-codex.test.ts: **+88 passed**. send.test.ts changes its paste assertion without changing the test count. All other package counts and all expected-fail/skip counts match R2a.
- Versus Codex: R2a adds **156 passed + 7 expected fail** in core: runtime-stop 46, runtime-stop-callers 69, lifecycle-runtime-gate 23 and same-id-defects-r2 25 (163 cases, including those 7 expected failures). It also adds **1** Claude helper/hook test, **12** Herdr tests (5 runtime checks + 7 same-ID R2 tests), **17** tmux tests (4 runtime checks + 13 same-ID R2 tests), **5** worktree same-ID R2 tests and **8** CLI checks for stop/restore refusal and retained failed-launch reporting. That is **+199 passed, +7 expected fail**. Existing OpenCode tests adapt to the stop result without adding cases. All other package counts are identical.
- The 11 expected failures in the full summary are the existing core defect tests after R2a. Other packages’ Vitest reporting counts successful `it.fails` cases among passed tests; the explicit red run below exposes all 44 known defects. No unexpected test failure occurred.

## Item 4: SAME_ID_DEFECTS=red

Command per package: `SAME_ID_DEFECTS=red pnpm exec vitest run <all same-id-defects*.test.ts and same-id-reuse-window.test.ts paths in that package> --reporter=json --outputFile=<scratch report>`. All 14 files ran, including OpenCode’s reuse-window test. JSON assertion names assign failures to their `[same-id Rn]` rounds. The red processes intentionally exit nonzero where defect tests fail; their failures are all expected.

| File | R1 | R2 | R3 | R4 | Total failures | Passing controls |
|---|---:|---:|---:|---:|---:|---:|
| packages/cli/__tests__/same-id-defects.test.ts | 0 | 0 | 0 | 0 | 0 | 2 |
| packages/core/src/__tests__/same-id-defects-r2.test.ts | 0 | 0 | 0 | 7 | 7 | 18 |
| packages/core/src/__tests__/same-id-defects.test.ts | 0 | 0 | 1 | 3 | 4 | 5 |
| packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts | 0 | 1 | 0 | 0 | 1 | 1 |
| packages/plugins/agent-codex/src/same-id-defects.test.ts | 0 | 1 | 0 | 2 | 3 | 1 |
| packages/plugins/agent-gemini/src/same-id-defects.test.ts | 0 | 1 | 0 | 2 | 3 | 1 |
| packages/plugins/agent-opencode/src/same-id-defects.test.ts | 0 | 1 | 0 | 2 | 3 | 1 |
| packages/plugins/agent-opencode/src/same-id-reuse-window.test.ts | 0 | 0 | 1 | 0 | 1 | 0 |
| packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts | 0 | 1 | 0 | 2 | 3 | 4 |
| packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts | 0 | 0 | 0 | 2 | 2 | 0 |
| packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts | 0 | 7 | 0 | 0 | 7 | 6 |
| packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts | 0 | 4 | 0 | 0 | 4 | 6 |
| packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts | 0 | 0 | 0 | 2 | 2 | 3 |
| packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts | 0 | 0 | 4 | 0 | 4 | 0 |
| **Total** | **0** | **16** | **6** | **22** | **44** | **48** |

This matches both R2a branch runs exactly. The Codex-only branch had 25 red failures (0/8/6/11); the **19** additional known defects are solely the four added same-id-defects-r2 files: core +7 R4, Herdr +1 R2/+2 R4, tmux +7 R2 and worktree +2 R4. The Codex send integration changes none of these counts.

## Item 6: built combined CLI on private stub panes

Harness command: `python3 /tmp/aocomb/ao56/replay.py` in the isolated environment. The harness invokes `node <worktree>/packages/cli/dist/index.js send --no-wait combined-case-N -f <message-file>` for eleven cases, then `send --timeout 5 combined-case-11 -f <message-file>` for capture 01. Every invocation has scratch AO_CONFIG_PATH/AO_STATE_ROOT and resolves a scratch record with agent=codex. Private server: `env -u TMUX /usr/bin/tmux -f /dev/null -L aocomb-live-ao56`. Its raw Python panes use the alternate screen and bracketed-paste mode; they never run an agent or change their fixture.

All twelve rendered panes equal the source fixture before sending and remain identical afterward (180×80, no fixture cropping). All twelve exit 0. Each complete input byte log equals exactly C-u + message + one Enter, with bracketed-paste markers around multiline text; there is no verification key or other extra byte. A thirteenth run below checks a regular send with a message over 200 characters, explicitly exercising `paste-buffer -p` after the timeout.

| Case | Printed result | First key after CLI start | Total time |
|---|---|---:|---:|
| Running 01–06, no-wait (six separate runs) | Message sent and processing | 0.25–0.35 s | 2.81–2.86 s |
| R2 M-1 | Message not submitted, with session/pane and manual-check guidance | 0.30 s | 6.87 s |
| R2 M-2 | Message not submitted, with session/pane and manual-check guidance | 0.30 s | 6.87 s |
| R2 M-3 | Message sent — the pane waits for an approval | 0.35 s | 2.91 s |
| B-2 | Message sent and processing | 0.30 s | 2.81 s |
| Real idle | Message sent — could not confirm it was received | 0.35 s | 6.92 s |
| Running 01, regular send, timeout 5 | Waiting → timeout → processing | **5.32 s** | 7.88 s |

The regular-send output is exactly:

```text
Waiting for combined-case-11 to become idle...
Timeout waiting for idle. Sending anyway.
Message sent and processing
```

No byte reaches that pane before the timeout; its first byte is C-u at 5.32 s, with the text and initial Enter following. This confirms the default wait still recognizes the real status block on the combined build. The other controls confirm their item-5 parser results reach the intended CLI lines.

Supplement: `python3 /tmp/aocomb/ao56/replay-paste.py` uses the same harness with capture 01, a >200-character message and `send --timeout 5 combined-paste-0 -f <message>`. It prints the same Waiting → timeout → processing sequence and exits 0. Its exact byte assertion includes `C-u`, `ESC[200~`, the entire long message, `ESC[201~`, and one Enter, with no verification key. Thus the requested regular-send check also covers the actual paste transport, not only short literal input. All **13** replays pass.

## Validation decision

Items 1–7 pass after the corrected switch. The combined counts equal the two branches’ additive coverage, the red defects remain exactly expected, and both built-code smoke paths preserve their reviewed behavior. The owner’s prerequisite for rebuilding the primary checkout is satisfied. This session has not rebuilt or deployed the primary checkout and has not performed a real-agent live check.

## Cleanup and final isolation evidence

All finite install/build/typecheck/lint/test/helper/CLI processes exited. The replay stubs, keepers and R2a smoke pane/server were stopped by their exact owned PIDs. Both replay runs and the smoke use separate private servers from the gates. Final audit checks 352 recorded node/live PIDs plus scratch-named processes, excluding only this finalizer and its ancestors:

```text
Own live processes: []
```

No protected PID, session, watcher or real pane was touched. No pattern kill or default-server tmux command was used. Before deleting the fake-HOME store, `pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3` relinked worktree dependencies to the existing permanent store: exit 0, 379 reused, 0 downloaded. The lockfile and source remain unchanged.

`ls -la --time-style=full-iso ~/.ao/bin` before (repeated after the corrected switch):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command after, byte-identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required final command:

```text
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aocomb-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
```

Every returned entry is attributed:

- `sessions/ao-54`: generation=26; status=working; agent=claude-code. External fleet metadata updated while validation ran. The real lifecycle log contains prior working→stuck transitions, but does not identify the writer of this later working update. No validation command targeted this record; every CLI/smoke used isolated config and AO_STATE_ROOT.
- `sessions`: mtime matches the atomic replacement of ao-54. This is the containing directory of that external metadata update, not a scratch state directory.

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions | 2026-10-21 22:29:08.765897510 -0400 | 4096 bytes
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54 | 2026-10-21 22:29:08.765897510 -0400 | 683 bytes
```

These observations support external attribution; they are not a syscall trace identifying a particular writer. The marker predates the initial dispatch race and was retained for the entire cleanup audit. No result from the pre-switch validation attempt is used in the PASS.

Removed `/tmp/aocomb/ao56`, its empty parent, `/tmp/aocomb-marker`, and only the stale sockets `aocomb-live-ao56`, `aocomb-gates-ao56`, `aocomb-r2a-ao56` under `/tmp/tmux-44402`. This removes logs, helpers, captured-fixture copies, scratch AO/activity state, fake HOME/store and the disposable smoke repository/worktree (including its seed commit). Real fixtures, earlier tracked reviews, the primary checkout and the orchestrator backup remain untouched.

Final `git rev-parse HEAD` remains dbbaf472b8a7160f9ad64ed57cab98277903a6ca on validate/combined-main. Source diff from e3be12a9 outside development is empty; unstaged and staged tracked diffs are empty. No worktree commit, pull, rebase, push, PR, real-config AO command, network gh or model turn. The only output files are this untracked validation report and `.agent_report.md`; earlier reports are retained below its new body. Status publication is atomic after scratch cleanup.
