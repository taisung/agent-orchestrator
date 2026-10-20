# I-5 short check, round 5 — ao-44

LAND-SAFE

Short check of `9987edfa..034eb8fb`; verdict covers `592441d6..034eb8fb`, with round 4's accepted Linux/single-user retry bounds and unrecorded-admission limit unchanged. **0 blockers, 0 major, 1 minor (m-4).** No implementation change or commit was made by this reviewer.

## m-3: fixed for the reported corrupt-ledger defect

The new warning no longer promises automatic removal of a corrupt ledger when both ledger removal and persistence of its pending key fail. It identifies the failed retry mark, requires a valid ledger for sweep removal, and tells the operator to check that no sender is running before manual removal of an invalid file. The new test makes both operations fail, verifies the archive is marked service-cleaned without a pending key, and proves that later cleanup with working writes keeps the corrupt file. Reverting only the text to the old promise fails that test.

The wording is accurate for a retained corrupt ledger and for valid unknown/sending entries expiring at ten minutes. It is not literally accurate for every valid ledger; m-4 below is the remaining narrow text issue.

## m-4 — The new warning overlooks removal of fresh admitted entries

**Minor, operator wording.** `packages/core/src/session-manager.ts:2368`; the actual rule is `delivery-ledger.ts:279–280,616–618`.

The warning says a later cleanup removes the file **only** when it is valid and all entries are older than ten minutes. The sweep removes a valid ledger whenever it has no live entry: each entry can instead be admitted, regardless of age. A fresh admitted mark is a supported state after failed clear, so it can also be present when the subsequent purge removal and pending-key write fail.

Independent reproduction first used the actual built sweep: a valid ledger with a fresh admitted entry was removed at age **0 ms**, a fresh unknown entry stayed, an old unknown entry was removed, and invalid JSON stayed. Then a scratch-only variant of the new m-3 manager test used a valid admitted entry with current timestamps and the same two injected failures. The warning still asserted “only ... all older than 10 min”; the following normal cleanup removed the ledger at **96 ms** old. The 42-test file passed with that observer fixture. Source/test files in the reviewer worktree were untouched; the scratch file was restored. Full evidence is below.

Suggested wording: say that cleanup can remove a **valid ledger with no live entries (each entry admitted or older than 10 min)**. The new checked-in test should include that valid admitted case, as its literal-string assertion currently preserves the inaccurate qualifier. This is not a removal/safety defect and does not retain or duplicate an input.

Cause: **(c)** failed ledger removal and failed pending-key write, with an existing admitted mark.
Documented-limit alternative: **acceptable for this personal tool**, since the behavior is safe early cleanup of obsolete state. Matching the warning to the existing sweep rule is a small text correction; no production protocol change is needed.

## Original round-4 mutants

| Original mutation | Result | Failing new test |
| --- | --- | --- |
| probe-errors-free | **caught**, 1 failed / 81 passed | lock: “a probe counts only a refusal as free: every other error and no answer in 1 s count as held” |
| attempt-bound-after-claim | **caught**, 1 failed / 81 passed | ledger: “the attempt lock is held before the claim is in the file: a child stopped just after its claim keeps its ID” |
| noncanonical-lock-name | **caught**, 1 failed / 81 passed | ledger: “two spellings of one ledger dir (a symbolic link) share the ledger lock and the attempt locks” |
| narrow settle-release-before-write (unknown/none only) | **caught**, 1 failed / 81 passed | ledger: “a settle of unknown or of a definite refusal keeps its attempt lock until its write: while it waits for the ledger lock, the attempt stays held” |

The old m-3 promise mutant is also caught by the new send-agent m-3 test (1 failed / 81 passed). Baseline for those same three files is **82/82**. These reproduce this reviewer's original mutations, including the narrow release variant that left successful-admission marking untouched.

## New-test and spec assessment

The new tests are sound for the guards they target. The child pauses after invoking the real close of the ledger socket, after claim publication and before begin returns. The ledger exclusion itself is the settle barrier. The symlink test exercises exclusion and attempt reuse through two spellings of the same directory. The error test covers the two free errnos, five held errnos, and the 999/1000 ms no-answer boundary with fake timers. The module mocks forward all other calls and reset fault state/timers in finally. The three normal repetitions and the CPU-load runs all pass; no timing upper margin was introduced. Existing lock-test afterEach still signals children without awaiting exit, as noted in round 4; final process and socket scans check actual completion.

The amended spec correctly covers releases relevant to a published claim: settlement under the ledger lock, process end, finally when unknown/none settlement could not obtain the ledger lock, and the eleven-minute timer after failed admitted marks. Each is held-to-free and no token is rebound, so a free probe result remains final. Failed begin also releases its unpublished token; no ledger entry can refer to that token, so it does not add an observable probe race. The new sentence fixes the two prior omissions without altering code.

## Scope and gates

All four commit diffs were read. Exactly the five permitted files change: session-manager warning/comment only; three test files; one spec sentence. Four conventional commits have explanatory bodies, no Co-Authored-By, emoji/non-ASCII, or issue-number reference. Over the whole range, lifecycle-manager.ts, metadata.ts, review-check.ts, config.ts and every package.json have empty diffs. An independent extraction confirms **restore() is byte-identical to 592441d6**. `git branch -r --contains 034eb8fb` prints nothing. No source change outside the warning was introduced.

Build, typecheck and lint pass (five existing warnings). Core: **39 files / 1098 passed**. Full pnpm test: **2552 passed / 29 skipped**. Both lock (9 tests) and ledger (31 tests) pass three repetitions and one run pinned to CPU 0 with six busy-loop processes; those processes were killed and reaped by exact PID. Detailed summaries and cleanup evidence follow. No live OpenCode run or service was started, and no provider/model call occurred.

## Evidence recorded during the check

Target: `9987edfa..034eb8fb`; verdict will cover `592441d6..034eb8fb`. Evidence recorded 2026-10-20. No code changes or commits are authorized.

HEAD verified as `034eb8fbd92bc3485bb3c3d26e8add3680dabcfe`. Initial untracked files were dispatch task/report and the round-4 review. The round-4 safety rules were reread. Scratch root `/tmp/i5r5-ao44-20261020`; real-state marker `/tmp/i5r5-ao44-20261020-marker`. All executable helpers/node/gates use env -i and fake HOME; each gate/test invocation allocates a fresh empty HOME and has no inherited AO variables. OpenCode is hidden from PATH. gh is a non-network stub and tmux a private-server shim. No live service or real session is needed.

Initial scope: four commits, five changed files (216 additions / 3 deletions). Production diff is only the fallback warning text and two explanatory comment lines. The spec changes the release explanation; the other changes are tests. The new corrupted-ledger test checks double failure, absent pending key, and retention after normal cleanup resumes. Source check will also compare the valid-ledger wording with the sweep's admitted-entry rule.

## Independent source/test checkpoint

All four original round-4 mutants are now **caught**, each by its intended new test (82-test baseline; each mutant: 1 failed / 81 passed). Reverting the warning to the old promise also fails the new m-3 test. Full names and gate summaries will follow.

The net mock forwards every unfaulted connect to the real module and retains the real server/socket constructors. Injected errors use nextTick so the probe installs listeners first; fake timers affect only setTimeout/clearTimeout and are restored in finally along with the fault flag. The metadata mock forwards every call except a truthy pending-key update while its flag is enabled; the flag is reset in the inner finally even if kill throws, and the outer finally restores stderr/PATH. Its failure happens before the actual archive write, avoiding round 4's misleading orphan-temp-file recovery.

The child barrier calls the original Server.close first, then blocks only for the canonical ledger name. At that point the claim rename has finished and the kernel name has closed, but begin has not returned. The delayed-bind mutant therefore has no attempt lock at exactly the point another process begins. The settle test starts settlement while a separately held ledger lock prevents its write, observes attempt liveness, and then releases the blocker. No scheduling upper margin is used.

Potential remaining minor warning mismatch, confirmed with the actual built sweep: a valid fresh admitted entry was removed at age 0 ms, although the new warning says removal happens *only* when all entries are older than 10 min. Fresh unknown was kept, 12-minute-old unknown was removed, and corrupt JSON was retained. A small separate scratch test now exercises that admitted case through the real manager's double-failure path; this does not require a live OpenCode service.

## Reviewer mutants

The scratch copy was `git archive 034eb8fb`, with node_modules linked to the installed worktree. Each original round-4 mutation was recreated directly; sources were restored between runs. All three requested test files ran each time.

```text
baseline exit 0
 Test Files  3 passed (3)
      Tests  82 passed (82)
   Duration  6.38s (transform 1.19s, setup 0ms, import 1.91s, tests 10.91s, environment 0ms)
probe-errors-free exit 1
 FAIL  src/__tests__/delivery-lock.test.ts > a lock that the OS releases (I-5 round 4, M-4) > a probe counts only a refusal as free: every other error and no answer in 1 s count as held
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 81 passed (82)
   Duration  6.53s (transform 1.03s, setup 0ms, import 2.03s, tests 11.23s, environment 1ms)
attempt-bound-after-claim exit 1
 FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > attempt liveness across processes (B-2, B-3) > the attempt lock is held before the claim is in the file: a child stopped just after its claim keeps its ID
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 81 passed (82)
   Duration  6.50s (transform 1.22s, setup 0ms, import 1.94s, tests 11.21s, environment 0ms)
noncanonical-lock-name exit 1
 FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > attempt liveness across processes (B-2, B-3) > two spellings of one ledger dir (a symbolic link) share the ledger lock and the attempt locks
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 81 passed (82)
   Duration  6.58s (transform 1.19s, setup 0ms, import 2.13s, tests 11.07s, environment 0ms)
settle-release-before-write exit 1
 FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > attempt liveness across processes (B-2, B-3) > a settle of unknown or of a definite refusal keeps its attempt lock until its write: while it waits for the ledger lock, the attempt stays held
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 81 passed (82)
   Duration  6.56s (transform 1.18s, setup 0ms, import 1.97s, tests 11.24s, environment 0ms)
old-m3-promise exit 1
 FAIL  src/__tests__/session-manager/send-agent.test.ts > one input ID per logical send (I-5 rounds 2 to 4, B-1, M-1, B-2, B-3, M-2, M-3, M-5, m-2) > m-3: when the ledger removal and the write of its pending key both fail, the line says that only a valid ledger expires, and cleanup keeps a corrupt one
 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 81 passed (82)
   Duration  6.50s (transform 1.08s, setup 0ms, import 1.79s, tests 11.24s, environment 0ms)
```

All four are **caught**. The narrow release mutant was exactly the round-4 change: insert `attempt.hold.release()` immediately inside `if (outcome !== "admitted")`, affecting unknown and definite refusal only; successful marking remains untouched. Its new ledger test fails on the held-attempt assertion before releasing the blocker. The old warning mutant changes only the new warning string back to its round-4 promise and is caught by the new m-3 diagnostic assertion.

## Gates and repeated runs

| Check | Actual result |
| --- | --- |
| build | exit 0 |
| typecheck | exit 0 |
| lint | exit 0; 0 errors, 5 existing warnings |
| core | Test Files  39 passed (39); Tests  1098 passed (1098); Duration  19.22s (transform 27.94s, setup 0ms, import 38.47s, tests 57.51s, environment 6ms) |
| full pnpm test | exit 0; 2552 passed / 29 skipped |

Full-suite summary lines:
```text
packages/core test:       Tests  1098 passed (1098)
packages/plugins/agent-gemini test:       Tests  62 passed (62)
packages/plugins/agent-codex test:       Tests  215 passed (215)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  208 passed (208)
packages/plugins/runtime-herdr test:       Tests  36 passed (36)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:       Tests  30 passed (30)
packages/plugins/workspace-worktree test:       Tests  50 passed (50)
packages/plugins/agent-opencode test:       Tests  298 passed (298)
packages/integration-tests test:       Tests  90 passed | 24 skipped (114)
packages/cli test:       Tests  257 passed (257)
```

| Run | Lock (9 tests) | Ledger (31 tests) |
| --- | --- | --- |
| 1 | 9 passed (9); 1.43s | 31 passed (31); 5.43s |
| 2 | 9 passed (9); 1.33s | 31 passed (31); 5.54s |
| 3 | 9 passed (9); 1.61s | 31 passed (31); 5.35s |
| loaded | 9 passed (9); 5.48s | 31 passed (31); 13.33s |

CPU-load evidence:
```text
LOAD exact PIDs [58326, 58327, 58328, 58329, 58330, 58331] CPU 0
lock 0
ledger 0
LOAD remaining []
```
No observed failure in these repetitions or the loaded run. Six busy-loop processes were pinned to the same CPU as the test run and killed/reaped by exact PID in finally. The new tests depend on ownership barriers, not wall-clock margins. Existing default test timeouts still assume a schedulable host; no finite run proves stability under arbitrary descheduling.

## Valid-ledger warning counterexample

Built-code sweep probe:
```text
{
  "sweep": {
    "removed": [
      "/tmp/i5r5-ao44-20261020/warning-probe/deliveries/ses_admittedFresh.json",
      "/tmp/i5r5-ao44-20261020/warning-probe/deliveries/ses_unknownOld.json"
    ],
    "failed": []
  },
  "cases": [
    {
      "key": "ses_admittedFresh",
      "state": "admitted",
      "entryAgeMs": 0,
      "allEntriesOlderThanTenMinutes": false,
      "existsAfter": false
    },
    {
      "key": "ses_unknownFresh",
      "state": "unknown",
      "entryAgeMs": 0,
      "allEntriesOlderThanTenMinutes": false,
      "existsAfter": true
    },
    {
      "key": "ses_unknownOld",
      "state": "unknown",
      "entryAgeMs": 720000,
      "allEntriesOlderThanTenMinutes": true,
      "existsAfter": false
    }
  ],
  "corruptKept": "[broken-json"
}
```
Actual manager double-failure probe in the scratch copy: changed only the new m-3 test fixture to a valid fresh admitted entry, leaving the same removal/key-write fault injection and warning assertion. The whole 42-test send-agent file passes with the following observed diagnostic/removal. The scratch test file was then restored.
```text
REVIEWER VALID LEDGER DOUBLE FAILURE {"ageMs":96,"existsAfter":false,"diagnostic":["ao: could not remove the delivery ledger /tmp/i5r5-ao44-20261020/tmp/ao-test-state-60926/.agent-orchestrator/1bf29e1b9a05-my-app/deliveries/ses_stored.json of OpenCode session ses_stored of app-1 (EACCES, Permission denied: /tmp/i5r5-ao44-20261020/tmp/ao-test-state-60926/.agent-orchestrator/1bf29e1b9a05-my-app/deliveries/ses_stored.json '/tmp/i5r5-ao44-20261020/tmp/ao-test-state-60926/.agent-o…); it could not be marked for a retry either. A later `ao session cleanup` removes it only when it is a valid ledger whose entries are all older than 10 min; if it is not valid, check that no ao process sends to this session, then remove the file by hand.\n"]}
 Test Files  1 passed (1)
      Tests  42 passed (42)
   Duration  6.44s (transform 507ms, setup 0ms, import 601ms, tests 5.70s, environment 0ms)
```

## Final safety evidence

All six busy-loop processes (exact PIDs 58326, 58327, 58328, 58329, 58330, 58331) were killed and reaped in the load helper's finally block. All gate, repetition, mutation and observer processes exited and were reaped. No live run, OpenCode service, real TUI or model session was started. No model/provider API call occurred; session cost/token checks are therefore not applicable to this round.

Final process scan, matching scratch command lines/environments and excluding the inspecting process and its ancestors: **[]**. No live review/test child remains. Private tmux server name is absent from /proc/net/unix; its exact leftover socket file was removed if present. The protected global service 15920 and workers 19579, 19624, 19636, 19653, 19689 remain alive and were not signalled.

```sh
grep ao-delivery- /proc/net/unix
ss -xlp | grep -E 'ao-delivery-'
```

Both outputs: **empty**. All lock names made by tests/observers derived from state below `/tmp/i5r5-ao44-20261020`. None remains.

`ls -la --time-style=full-iso ~/.ao/bin` BEFORE:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command AFTER:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The listings compare byte-for-byte; SHA-256 hashes of all files also compare equal. `/tmp/ao-opencode-launch-44402` contained only `.` and `..` before and after (directory mtime Oct 16 14:01).

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/i5r5-ao44-20261020-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'
find ~/.agent-orchestrator -path '*deliveries*'
```

Both outputs: **empty**. No real-state change or delivery ledger was made.

No source edit, branch mutation, commit, push, PR, network gh call, real-session send, default-server tmux call or credential-file read was made. Round 4 review and the dispatch task remain untracked as supplied. The requested round-5 review and overwritten report are the only new deliverables.

Verified after cleanup: scratch root absent; marker absent; private socket absent; own processes **[]**; delivery names **[]**.
