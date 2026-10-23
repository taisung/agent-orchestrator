# Herdr fit-1 / main merge check (sol), 2026-10-23

LAND-SAFE

**0 blocking, 0 major, 0 minor new findings.** Reviewed merge `6a5bd6a7`, with parents `60da85ee` (fit-1 after the documentation corrections) and `80ce3a89` (main after relaunch). HEAD was verified at the requested merge. This is the decision-13 landing check; the accepted fit-2 limits remain accepted. No code or tracked file was changed.

## Independent resolution

Cloned the local repository into `/tmp/aof1m/clone`, checked out `60da85ee`, and merged `80ce3a89` with `--no-commit`. The common ancestor is `389b8dfe`. Git produced exactly two conflicts, one hunk in each:

- `packages/core/src/session-manager.ts`: retained main's tmux imports (`AGENT_PANE_KEY`, `agentPaneOf`, `exactPaneTarget`, `exactSessionTarget`) and its existing `HERDR_RUNTIME_NAME` import at line 97. Fit-1's extra copy of the Herdr import was unnecessary.
- `docs/DEVELOPMENT.md`: parsed the R4 table from the base and each parent into six cells per row, then independently applied each parent's changed cells. Fit-1 changes rows 8/9; main changes row 10. No cell had incompatible semantic changes. Prettier formatted the scratch document after resolution.

After adding just those two scratch resolutions, `git write-tree` gave **`478d2294132ba3ee647c5ea6ad7f78b510019a45`**, exactly `6a5bd6a7^{tree}`. `git diff --exit-code 6a5bd6a7` in that clone was empty. No merge commit or ref update was created in the review worktree.

The diff-stat discrepancy is exactly the duplicate import: `389b8dfe..60da85ee` adds 24 and removes 5 lines in session-manager; `80ce3a89..6a5bd6a7` adds 23 and removes 5. Main already imports the constant for its Herdr relaunch refusal. The complete package/docs stats are respectively 30 files +3564/-176 and 30 files +3563/-176. No behavior line was discarded to obtain that difference.

The actual net changed-path intersection from the common base is eight files: DEVELOPMENT.md, CLI session.ts, core index.ts/session-manager.ts/types.ts, and the Claude/Codex/Gemini agent entrypoints. The brief's statement that both parents also have a net change to start.ts/start.test.ts is inaccurate for these exact parents: main has **no net diff** for either relative to `389b8dfe`. The merge's two files are byte-identical to the fit parent. The defect A/B and slow-stop behavior already in their common history remains present. CLI send.ts, core tmux.ts and runtime-tmux's entrypoint are byte-identical to main. This observation agrees with the implementer's merge report, which I read after independently reading and resolving the merge.

## Meeting points

| Meeting point | State and evidence |
| --- | --- |
| CLI startup, `packages/cli/src/commands/start.ts:906`, `:1097`, `:1514` | **Correct.** The fit guard retains false/no-server as unknown for a Herdr handle. A held terminal record answering alive cannot be reused and blocks creating another orchestrator when no other candidate is reusable. The existing defect A rule still probes before reuse; defect B still relays the detached stop before completing archive/lifecycle work. The full gate passes all 97 startup unit cases, 12 real-core Herdr startup cases, six malformed-liveness cases, and four stop-relay cases. Byte equality to the fit parent rules out an accidental startup conflict resolution. |
| Core startup, `packages/core/src/session-manager.ts:869`, `:2854`, `:2915` | **Correct.** Both existing-record checks in project-mode spawnOrchestrator still pass the complete handle to the runtime and apply the Herdr-specific unknown rule. Relaunch's added launch preparation and token persistence occur later; they do not turn Herdr false/no-server into replacement authority. `orchestrator-herdr-start.test.ts` and the real-core CLI guard tests pass. |
| Record keys, reservations and pane binding, `session-manager.ts:188`, `:334`, `:573`, `:918`, `:932` | **Correct.** The pins are `herdrBin`/`herdrSocket` inside serialized runtimeHandle.data. The launch protocol uses top-level `launchToken`, `launchTokenAt`, `launchPane`, `launchPid`, `launchPidStart` plus existing launch times. There is no key collision. A pane binding counts only for its matching last-launch timestamp; withAgentPane returns a non-tmux handle unchanged. Independent probes with a valid binding and deliberately tmux-looking fields preserve every Herdr handle/pin and raw record field. Reservation/claim, parallel launch, grace, rollback and late-answer tests all pass in core's 1787-case gate. |
| F1 reads and agent checks, `packages/core/src/herdr.ts:520`; Claude `index.ts:822`, Codex `:580`, Gemini `:193` | **Correct.** Herdr branches still pass the full pinned handle into core. The new main pane selection is restricted to tmux, including agentPaneOf itself. The strict stderr classifier and both R4 callers retain exact-form rejection, double-LF and misplaced no-server-prefix tests. The fourth agent, OpenCode, also retains its fit-1 pinned-handle path. All agent and runtime-herdr gates pass. |
| Relaunch and attach, `packages/core/src/session-manager.ts:5070`, `packages/cli/src/commands/session.ts:195`, `:460` | **Correct.** Attach keeps fit-1 ID validation and pinned binary/socket invocation. Relaunch's explicit Herdr refusal precedes runtime lookup, liveness, conversation lookup and any new claim, script or pane command. Neither --continue nor malformed pins sends it down a tmux path. Independent core and actual built-CLI evidence is below. |
| Send and tmux helpers, `packages/cli/src/commands/send.ts:329`, `:427`, `packages/core/src/tmux.ts:62` | **Correct.** Main's pane binding/ownership checks remain behind runtimeName === tmux. An existing Herdr record delegates to core send. Two additional scratch tests pass for a pinned Herdr record carrying a stale launchPane/agentPane, with default wait and --no-wait: one core send and zero tmux, shell or activity-detection calls. Main's complete send and runtime-tmux test coverage also passes. |
| Public API and types, `packages/core/src/index.ts:60`, `packages/core/src/types.ts:328` | **Correct.** Both the main pane/relaunch exports and fit-1 Herdr exports remain. New relaunch-related plugin methods remain optional; no tmux pane method becomes a Herdr requirement. The no-server documentation distinguishes endpoint reachability from proof of a Herdr launch ending. Build and strict typecheck pass for all packages. |
| Documentation, `docs/DEVELOPMENT.md:622`, `:623`, `:624`, `:629`, `:660` | **Correct.** R4 rows 8/9 retain fit-1's pinned invocation and exact F1 forms; row 10 retains main's agent-pane checks and strict failure handling. Relaunch remains documented as tmux-only with the Herdr refusal. The note-3 recovery/startup corrections are present and agree with code, as detailed below. |

## Independent Herdr relaunch probes

Extended only a scratch copy of the existing real-core relaunch harness. Twelve cases cover legacy, valid pinned and malformed partial pinned handles; F1 `pane_not_found` and `server_not_running` failures; and --continue off/on. The mock runtime is prepared to reject with each F1 form if reached. Each record also contains a matching launch token/time and launchPane, and the handle contains a different tmux-looking agentPane. All twelve pass:

1. Reading the session preserves the complete Herdr handle and its pins.
2. Relaunch throws SessionRelaunchRefusedError with exactly:

   ```text
   Cannot relaunch session app-1: it runs in a Herdr pane, and a Herdr relaunch waits for the Herdr live check
   ```

   Its next action is exactly `restart its agent by hand in its Herdr pane`.
3. The raw record is unchanged. There are no runtime isAlive/create/destroy/stop/runInPane calls, no agent process/launch-command calls and no script creation. The prepared F1 failures are deliberately never consumed: refusal does not depend on classifying them.

Also ran the merged built CLI with its real core, plugin registry and runtime-herdr against a scratch config/state. All six legacy/pinned/malformed × continue cases exit 1, print that same reason plus `Next: restart its agent by hand in its Herdr pane`, and leave the raw record byte-identical. There is no Herdr or agent binary on PATH; the pinned binary is an absent scratch path. An attempted probe/launch would therefore fail these assertions.

F-5 remains intact at `packages/plugins/runtime-herdr/src/index.ts:516`: destroy throws before any Herdr call. Stop at `:532` still returns unknown. Relaunch cannot bypass either restriction and cannot start a second Herdr orchestrator through the interim guard: it refuses before creating a launch at all. This does not expand the owner-accepted coverage of direct isolated spawnOrchestrator.

The first reviewer-only fixture dereferenced its token timestamp before writing its test record; fixing that fixture made all twelve probes pass. Product source was unchanged.

## Prior findings and note 3

| Prior item | State on the merge |
| --- | --- |
| r1 M-1, held-live record passed over | **Closed in the authorized scope.** Both workspace modes retain the explicit still-runs refusal and zero-create checks. A separate reusable non-terminal candidate remains allowed; its control passes. |
| r1 M-2, direct isolated core startup | **Accepted deferral until fit-2 G.** The docs and comment still name it; no broader guarantee is claimed here. |
| r1 double-LF reader gap and the misplaced-prefix gap | **Closed.** The reader and both R4 callers retain their note-2 tests and pass. These readers/tests are unchanged by main's merge, so the previously measured mutant sensitivity remains applicable. |
| r2 m-1, missing archive prerequisite | **Closed.** The recipe now calculates the actual state directory, creates sessions/archive and checks an unused destination before moving. Independently ran its shell calculation/move on the scratch config: a fresh archive was created and the active record moved; reusing an occupied destination was refused and retained both files. |
| r2 m-2, unconditional refusal prose | **Closed.** Both the guard comment and DEVELOPMENT.md explicitly condition the refusal on no other reusable candidate. Unknown/no-server and held-live paragraphs agree. |
| r2 m-3, stored merged example | **Closed.** Both texts describe the status after read repair and explain that a stored merged orchestrator becomes working and is checked. Done/errored remain examples of the accepted terminal exclusion. |

The done-record, direct isolated core and handleless limits are still explicitly documented and accepted until fit-2. The manual retirement sequence still tells the owner to stop the lifecycle writer, close/verify the launch, archive the record, and remove only an isolated worktree, and warns that it bypasses locking/generation bookkeeping. No real worker, pane or worktree was changed for this check.

## Gates on the archived merge

Created a separate tree with `git archive 6a5bd6a7`, installed from the cached pnpm store, and built before running dependent checks. Every pnpm, Node, CLI and test invocation used a sanitized environment:

```sh
env -i HOME=/tmp/aof1m/home TMPDIR=/tmp/aof1m/tmp   PATH=/tmp/aof1m/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true <command>
```

PATH consists of explicit Node 25.7.0, pnpm 9.15.4, raw git/shell/basic utilities, a gh stub accepting only --version/auth status, and a tmux shim selecting private `aof1m-tests` and unsetting TMUX. It contains no agent, Herdr, npm or npx, and no /usr/bin directory entry. The actual CLI probes additionally set only their scratch AO_CONFIG_PATH/AO_STATE_ROOT. No network was used.

| Gate | Result |
| --- | --- |
| pnpm install --frozen-lockfile --offline, cached store v3 | Exit 0 |
| pnpm build | Exit 0 |
| pnpm typecheck | Exit 0 |
| pnpm lint | Exit 0, five known warnings, no errors |
| pnpm -r --no-bail test | Exit 0; **4027 passed, one expected failure, 29 skipped** |
| SAME_ID_DEFECTS=red across the nine packages containing same-ID tests | Exit 1 as expected; **R1 0, R2 15, R3 6, R4 0**, no other failing test |
| gitleaks git --log-opts=60da85ee..6a5bd6a7 | Exit 0; 79 commits scanned, no leaks |
| Independent interaction probes | 12 core refusals, six actual CLI refusals, two send-routing cases, and the recovery recipe checks pass |

Full-suite accounting:

| Package | Passed | Expected failure | Skipped |
| --- | ---: | ---: | ---: |
| core | 1787 | 1 | 0 |
| CLI | 444 | 0 | 0 |
| runtime-herdr | 146 | 0 | 0 |
| Claude Code | 368 | 0 | 0 |
| Codex | 318 | 0 | 0 |
| Gemini | 99 | 0 | 0 |
| OpenCode | 365 | 0 | 0 |
| runtime-tmux | 116 | 0 | 0 |
| workspace-worktree | 85 | 0 | 0 |
| notifier-desktop | 26 | 0 | 0 |
| tracker-github | 42 | 0 | 0 |
| scm-github | 140 | 0 | 5 |
| integration-tests | 91 | 0 | 24 |
| **Total** | **4027** | **1** | **29** |

Core/CLI/runtime-herdr exactly match the implementer's counts. The difference from 3990 is 37 private-tmux-enabled cases: Claude +3, runtime-tmux +12, integration +22. The other package counts match. Thus the author's additive count `3797 + 3775 - 3582 = 3990` accounts for the same test inventory; this review enables 37 of its skips. Agent-dependent live integration blocks remain disabled.

The red failures are core one R3; four agents one R2 each, with OpenCode one further R3; runtime-tmux eleven R2; workspace-worktree four R3. Herdr and CLI have none. Main's R2 count of 16 becomes 15 because fit-1 F-5 fixes runtime-herdr N-1: a stale handle's destroy no longer closes a reused pane/workspace ID. The N-1 oracle at `runtime-herdr/src/__tests__/same-id-defects-r2.test.ts:107` is now a passing plain test, with a second control requiring the refusal even when the recorded terminal matches. This is a behavior fix, not a removed test.

The initial full run failed five Claude hook cases because this reviewer's restricted PATH omitted timeout (three tests explicitly failed command -v timeout; the two deadline tests also lacked it). Adding the raw timeout link and repeating the complete gate produced the passing result above, without any product change. An initial red invocation selected all workspaces, including ao which has no vitest binary; the final gate selected exactly the nine requested packages and produced only the 21 expected red failures. Reviewer probe additions were outside the gate tree and do not inflate its totals.

The five lint warnings are spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232 and session-manager.ts:2728/:2735. The existing .eslintignore deprecation notice is unchanged.

## Isolation and cleanup

Initial `ls -la --time-style=full-iso /home/taisung/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The final listing compares byte-identically, and SHA-256 comparisons of the four files are identical. No wrapper installation or real AO configuration command ran.

The final required real-state check was:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aof1m-marker \
  -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' \
  -not -name 'lifecycle-worker.log'
```

It printed these eight paths, each attributed to ongoing external session activity rather than this review:

- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions` — external Nexus session-directory activity.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237` — external Nexus nex-2237 record activity.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator` — external Nexus orchestrator record activity.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2245` — external Nexus nex-2245 record activity.
- `/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2244` — external Nexus nex-2244 record activity.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions` — external AO session-directory activity.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63` — external ao-63 record activity.
- `/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73` — external ao-73 record activity.

No other session's record contents or pane were read. I did not identify their writer PIDs; attribution is by the external session paths and this review's exclusively scratch HOME/state roots. No review command writes to those paths.

The /proc audit found zero processes with HOME or cwd under `/tmp/aof1m/`. The private tmux check returned `no server running on /tmp/tmux-44402/aof1m-tests`; no default-server command was used. All test-specific tmux servers were also gone (no remaining scratch-owned process). No kill was needed.

Removed `/tmp/aof1m` and `/tmp/aof1m-marker`; absence was verified. Final `git diff --exit-code HEAD` is empty and HEAD remains `6a5bd6a7`. Only this new review and the explicitly requested report were written in the worktree; the supplied task/note files remain untracked. No commit, push, PR, ao send or network operation was performed.
