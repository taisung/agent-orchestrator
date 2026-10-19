# I-3 re-check, round 3

NOT-LAND-SAFE

Reviewed `b853f74f..0b21660c` at `0b21660c8099b4603df8d3561ff85a0c9a7368b8`. New findings: **0 blockers, 1 major, 0 minors**. B-2 is substantially fixed, but reservation and ownership publication remain separate operations (M-5). M-3, M-4 and m-5 are fixed in the reviewed source and tests. No production source was edited. Earlier reviews remain unchanged.

The user stopped further live testing after interruptions and requested this report from the saved logs. Unfinished checks are listed explicitly. M-5 is a source finding, not a claimed live reproduction.

## Round-2 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B-2: kill during launch | **Partly fixed** | Real CLI kills during preparation and at runtime.create, with and without purge, all exited 1, retained the record, and allowed spawn to complete. Restore/remap refused. Project orchestrator starts with delete/reuse/ignore refused during confirmation. The empty-reservation interval remains: M-5. |
| M-3: preload mistaken for script | **Fixed** | `agent-opencode/src/index.ts:549` accepts an interpreter only with the script at argv[1]. Live preload was rejected and its created session removed. Tmux/Herdr preload tests pass; reverting the parser fails seven tests. |
| M-4: dead preparation claim retains ID | **Fixed by source/unit evidence; independent live re-check not run** | `session-manager.ts:833` treats a dead claim without runtime handle or tmux name as dead. Tests cover that shape, a dead launcher with a running pane, and a legacy record without claim/runtime identity. Removing the rule fails the preparation-only test. |
| m-5: environment throw leaks resources | **Fixed by source/unit evidence; independent live fault injection not run** | Environment/resolver construction is inside worker rollback at `session-manager.ts:1465`; orchestrator environment construction is inside rollback at `:1977`. Worker/orchestrator environment-throw and worker resolver-throw tests pass. Moving environment outside rollback fails two tests. |

## M-5 — An empty reservation can still be killed before its owner is written

**Defect:** reservation and launch-owner publication are separate operations. Another process can see the empty file, successfully kill it, and return before the launcher writes its claim. The launcher then recreates the record and continues. Moving the claim before workspace creation narrows the interval but does not close it across processes.

**File and line:** `packages/core/src/session-manager.ts:1340–1341`, calling `claimReservedLaunch` at `:251`. Supporting code: `packages/core/src/metadata.ts:318–320`, `:175–191`, and `session-manager.ts:2248–2251`. Orchestrator reservations also use a separate claim write at `:1851` and `:1859`.

**Evidence:** the reservation helper creates the file with O_EXCL, closes it, and returns without writing owner fields. `liveLaunchOwner` at `session-manager.ts:271` returns null when those fields are absent. Kill therefore passes its refusal check for this record, has no runtime/workspace/mapping to remove, and archives/deletes it at `:2324`. The subsequent `updateMetadata` explicitly starts with an empty record if the path is missing and writes it back. No ownership/cancellation check prevents recreation. This cross-process schedule is possible even without asynchronous work between reservation and claim. The author also records the interval in report “Unclear” item 3.

**Reproducer, prepared but not run:** pause an isolated launcher immediately after `reserveSessionId` closes its empty metadata file, before `claimReservedLaunch`. A Node --import fixture can wrap node:fs open/close, call syncBuiltinESMExports, signal readiness for the exclusive session-file descriptor, and block until resumed. In a second isolated process run `ao session kill <reserved-id> --purge-session`. Resume the launcher and inspect its returned session and metadata. The source predicts a successful kill followed by successful spawn recreating the record. This timed check was not executed because the user stopped live work; no observed output is claimed.

**Correction:** publish ownership as part of the reservation protocol before kill/replace can act on it. A separate merge that recreates a missing reservation cannot establish ownership. Severity is **major**, below the earlier blocker because the exposed interval is now much shorter.

## Rebase, scope and removal paths

The range-diff `15757aae..e9882651` versus `b853f74f..b511e950` changes only the expected commits: `7aa587e5 → 762c5eff` for I-4 import/mock/helper conflict hunks, and `dab0ba43 → 71f87770` for adjacent context. The other eight commits are equal. All six new commits were read individually. The author report was read after source examination of section 2 items 1–3.

Against `b853f74f`, the extracted method region preserves detectActivity, getActivityState, recordActivity, isProcessRunning and getSessionInfo. The only difference in the larger region is the allowed restore comment. api-activity.ts, its tests and pane fixtures have no diff. All 74 API/classifier tests pass within the plugin's 253 tests. Four independent I-4 mutants fail below. No lost I-4 behavior was found.

The removal-path audit agrees with the author's list, subject to M-5:

| Path | Protection / assessment |
| --- | --- |
| Kill, purge/archive (`session-manager.ts:2251`, `:2296`, `:2324`) | Target owner refusal; another record's shared-ID holder check. |
| Active cleanup (`:2384`) then kill | Skips live owner and reaches the same kill refusal. |
| Archived cleanup (`:2480`, `:2497`) | Shared-ID holder check. |
| Issue/orchestrator delete resolver (`:916`, `:925`) | Holder check including launch owner; dead preparation-only exception. |
| Project orchestrator replacement (`:1782`, `:1821`, `:1805–1837`) | Refuses an observed live claim. Live delete/reuse/ignore cases passed. |
| Restore (`:3036`, `:3117`), send through restore | Target owner refusal. |
| Remap (`:2938`, `:2976`, `:2991`) | Target owner refusal and candidate holder check. |
| CLI kill (`commands/session.ts:222`), stop (`commands/start.ts:1139`) | Delegate to manager kill. Stop inspected, not independently exercised live. |
| Spawn rollbacks, claim-write failure (`:254`), plugin discard (`agent-opencode/src/index.ts:482`) | Own reservation/resources; discard removes only a session this prepare created. |
| Lifecycle metadata write | Merge retains claim keys. First-poll status race remains the separate owner item. |
| `recovery/actions.ts:149` | Unguarded delete, but only internal recovery manager/tests call it; not exported by shipped core entry point/package exports. **Minor dormant maintenance risk**, outside new finding counts. Needs a guard before wiring into a command. |

The argv[1] rule deliberately rejects `node --no-warnings <dir>/opencode`: **minor compatibility restriction**, per the explicit owner rule. Simple npm/native forms remain accepted. The existing /proc portability limitation and older reuse/archive defects are outside this round and are not new findings.

The whole increment changes only the 16 allowed paths, including the two round-1 lock-file deletions. Runtime plugins, other agent plugins and lifecycle-manager.ts are unchanged. Messages are conventional and explain why, with no co-author trailer, emoji or issue number. `git branch -r --contains 0b21660c` printed nothing; tracked source diff is empty.

## Completed live checks

All writes used copied OpenCode 2.0.31 at /tmp/ao40-i3-r3/opencode-real, service PID **3197673**, port **49644**, fake HOME and all four scratch XDG roots. server.info returned that PID; /proc confirmed the copied executable and scratch XDG values before writes. It differs from global service PID 3252262. No service credential file was read, real TUI started or model turn submitted.

Private tmux server **3195052** started through the -L ao40-i3-r3 shim in the isolated environment. Control pane **3195053** had scratch HOME and no AO variables. Its persistent tail kept the server alive. Every tmux invocation, including tests, used the shim.

Saved live evidence:

```text
initial: 0 active records / 0 isolated sessions
prepare: kill without purge = 1; kill with purge = 1
  Cannot kill session i3r3-1: ao process 3217759 is still launching it.
  restore/remap refused; cleanup skipped it; record unchanged
  spawn completed i3r3-1 -> ses_eae88e8e5ffelM4IhoIea6IYwu
runtime.create: kill without purge = 1; kill with purge = 1
  same refusal for i3r3-2; restore/remap refused; record unchanged
  spawn completed i3r3-2 -> ses_eae88b756ffevYJLywggMEV5ER
each purge after completion: 0 active records / 0 isolated sessions
B-1, after status=killed while A waited at runtime.create:
  i3r3-3 / i3r3-4 retained two distinct live IDs; both completed
  ses_eae88845dffethq5hCuqR7p1y7
  ses_eae8882d4ffe2CpeNUbRtIWe7n
project orchestrator: delete refused; reuse refused; ignore refused
preload-only pane: rejected within 15 s; rollback to 0 records / 0 sessions
shell-only pane: rejected within 15 s; rollback to 0 / 0
dead stand-in: rejected within 15 s; rollback to 0 / 0
npm node <bin>/opencode stand-in: accepted; purge returned to 0 / 0
final harness: {"records":[],"sessions":[]}
```

Successful worker stand-ins reported promptDelivered=false and one core warning each. Native stand-ins supplied argv[0] opencode; npm executed the simple script form. Herdr preload and real-form checks used unit fixtures.

## Gates and mutants

All gates used fake HOME, scratch TMPDIR and no inherited AO variables. OpenCode was hidden from PATH until the full suite finished. Live-model integration tests did not run. Installation was rerun with CI=true after an unanswered module-reinstall prompt.

```text
pnpm install                      exit 0, Done in 2.1s
pnpm build                        exit 0
core test                         973 passed, 36 files
OpenCode plugin test               253 passed, 2 files
OpenCode plugin typecheck          exit 0
CLI test spawn session            83 passed, 3 files
  command files: spawn 21, session 32; session-utils also matched: 30
integration, OpenCode hidden       87 passed / 24 skipped
pnpm lint                         exit 0; 0 errors / 5 existing warnings
pnpm typecheck                    exit 0
pnpm test                         exit 0; 2368 passed / 29 skipped
```

All **22** mutants, separately applied in a scratch archive, were caught. Counts are failed tests within the targeted file, not whole-suite counts. Each file was restored before the next mutation.

| Mutant | Failures | Representative tests |
| --- | ---: | --- |
| ID publication delayed | 4 | Worker/orchestrator store before runtime.create; overlap |
| Discard removes reuse | 1 | Never removes reused session |
| Settle interval zero | 1 | Process exits before settle |
| Any OpenCode-looking argv token | 16 | Wrong session/pane, preload, shell, separator |
| Version gate after create | 9 | Order and refused versions |
| Match catalog modelID | 1 | Match Model.Info id |
| Clear keys before confirmation | 1 | Worker keys through setup/check |
| Ignore PID start token | 2 | Reused PID guard and kill |
| Owner depends on status | 7 | Overlap, cleanup/purge, preparation, restore/remap |
| Ignore prompt baseline | 1 | Old-only message gives false |
| Round-1 joined-argv search | 16 | Shell, inline/preload, prompt/separator |
| Omit resolver environment | 4 | Worker/orchestrator reuse/delete |
| Catalog read through pipe | 11 | File/large/cut/error/cleanup |
| Remove kill refusal | 3 | Preparation, runtime.create, workspace |
| Claim moved back before prepare | 1 | Kill during workspace |
| Remove dead-claim exception | 1 | Dead preparation-only record |
| First-non-option parser | 7 | Interpreter options; tmux/Herdr preload |
| Environment outside rollback | 2 | Worker/orchestrator environment throws |
| I-4 unknown becomes idle | 8 | Unknown, transcript toast, split blocks |
| I-4 ctrl+p over whole capture | 1 | Transcript marker with toast last |
| I-4 active before permission/form | 2 | Permission/form plus active ID |
| I-4 failed read starts successful | 2 | Null/wrong-shape message.list |

## Checks not run

The user explicitly stopped further live work after interruptions. These independent checks are **not run**; passing committed tests are not presented as live evidence:

- Timed empty-reservation reproducer for M-5. Fixture written, never executed.
- Round-2 M-4 crashed-launcher reproduction using its own branch; real dead-owner kill; independent dead-owner/running-pane and legacy-record cases. Committed tests for these shapes passed.
- Independent environment/resolver fault injection for worker and orchestrator, including prompt-file cleanup. Worker/orchestrator environment and worker resolver committed tests passed; no extra orchestrator resolver test was added.
- Live Herdr runtime. Its argv fixtures passed; live testing used tmux.
- Additional live bad-model/forced-create-failure, batch-spawn, same-prefix fleets, and zombie/PID-reuse reruns. Earlier reviews/current committed tests provide only the evidence identified above.
- Fresh independent restore comparison with 15757aae, the complete earlier rollback matrix and exhaustive rerun of every inherited round-1 subcase. Inspected diffs/passing tests do not establish these unperformed checks.

What I found correct: status-independent overlap protection; normal launch-phase refusal; preload/shell rejection; simple npm/native acceptance; rollback after failed confirmation; mutation-sensitive dead-claim/environment tests; preservation of I-4.

Cleanup evidence follows after teardown.

## Final cleanup

The specified service shell **3197672**, copied service **3197673**, private tmux server **3195052**, and control pane **3195053** received SIGTERM by exact PID after command-line and UID checks. All four exited. No scratch lifecycle-worker PID file existed. A /proc environment scan found no remaining scratch descendants. No protected real worker (1815472, 1815599, 1815614, 1815674, 1816016) or global OpenCode service was signalled.

Final independent process listing was taken after the cleanup helper exited; filtering for the scratch path and private server name printed nothing. The first parallel listing caught the concurrent inspection shell itself; the quoted empty result is the subsequent serial listing.

```text
ps -o pid,args -u "$(id -u)" [filtered for scratch path/private server]
[empty]
ls -A /tmp/ao-opencode-launch-44402
[empty]
find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao40-i3-r3-marker
[empty]
```

The find was taken before removing the marker. No host paths/times needed attribution because its output was empty. The scratch directory, copied binary, isolated store, fixtures, mutation copy, logs and marker were removed after their evidence was incorporated here.

The before/after `ls -la --time-style=full-iso ~/.ao/bin` listings agree exactly:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Earlier review SHA-256 values remain:

```text
r1 ac2616d2b5068fb43a9a45a7fd59c894e5650a74cc977b14b7cd9ddb53a1ca98
r2 a9d2b9477defd10e7c6aa47694153bfa42b06457fc5567529edd884f28aacfc2
```

No commit, push, PR or ao done-message send was made. Production source remains unchanged.
