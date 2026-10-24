LAND-WITH-CHANGES

Counts: **0 blocking, 5 major, 1 minor**. Final required gates pass; the expected same-ID red set is unchanged; merge-tree has no conflicts. M-1 is a reproduced F-9 refusal-contract defect. M-2 through M-5 are required safety checks implemented correctly today but accepted as broken by the current tests; each has an independently built, passing mutant and a distinguishing added probe. Correct the refusal read path and add these regression schedules before landing.

# Herdr fit-2b code review r1 (sol61), 2026-10-23

Target c6d80383..13f982c2. Completed independent code review. Review only; no commit, push, PR, network, real-config AO command, real agent or Herdr server is authorized. All builds and mutations use scratch archives under /tmp/aof2bs with a cleared environment, offline pnpm and a private tmux shim. Artifact type: code and test protocol.

Initial receipts:

```text
13f982c2 docs: the herdr fit-2 contracts
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

Read in the requested order: the spec, r11 scope check, three fit-2a reviews, implementation brief, base/tip contracts and changed code/callers, then the implementation report. No second fit-2b review or worktree was consulted.


## Confirmed finding M-1 — F-9 repairs the record before a refusal that promises no change

`packages/core/src/session-manager.ts:4767` calls `requireSessionRecord`, which uses `findSessionRecord`'s read repair at :2240, before `retirableHandle` at :4781. The repair at :1604–1623 can set role, remove a PR, disable PR discovery and change a stale terminal status to working. Design 5.4.2 requires a strict initial read and says each refusal changes nothing. This is a new F-9 path using an existing ordinary-kill helper; keep ordinary kill behavior while giving the attested path a strict, non-repairing lookup.

Scratch probe: write `app-orchestrator` with status merged and a PR, snapshot its bytes, then kill with `confirmRuntimeClosed: "wrong"`. The call rejects with the token-mismatch message and makes no runtime stop, but the byte-equality assertion fails because the read repair changed the record. The unmodified tip fails this added probe (exit 1). Existing F-9 refusal tests use worker IDs, so they do not exercise this orchestrator repair. Add stale-token and live-pane refusal cases for an unrepaired orchestrator and require byte equality, no archive and no resource removal.

## Confirmed finding M-2 — No regression test guards the final reuse check after awaited hooks

`packages/core/src/session-manager.ts:4139` correctly re-reads the candidate after `setupWorkspaceHooks` and requires the deciding token and R1–R6 again. The current tests only change the record during probes (runtime-herdr `fit2-admission.test.ts:859`, CLI T-7.28), before the next deciding round. Removing the entire post-hook re-read/rejudge and returning the deciding snapshot still passes all existing scenarios in all 16 changed test files. This is a required ownership check of design 5.3.2, and a wrong implementation can reuse a kept failed launch or the old identity.

Two added scratch probes change only `launchFailed`, or only `restoredAt`, during `setupWorkspaceHooks`. Correct code passes both; the mutant fails both. Keep these independent post-hook schedules, including a live-claim sibling, rather than relying on T-7.23/T-7.28's earlier probe races. No current-code failure of the post-hook check was found.

Measured receipt (reviewer-added tests excluded from the original-suite mutant run):

```text
mutant-hooks-cli.json: passed=249 failed=0 pending=0
mutant-hooks-core.json: passed=72 failed=0 pending=1
mutant-hooks-runtime-herdr.json: passed=164 failed=0 pending=2
probe-hooks-mutant.json: passed=0 failed=2 pending=32
REVIEW final reuse read after hooks REVIEW hooks write launchFailed after G decided; never reuse
AssertionError: expected false to be true // Object.is equality
REVIEW final reuse read after hooks REVIEW hooks change identity after the alive answer; never reuse stale answer
AssertionError: expected { id: 'app-orchestrator', …(13) } to match object { reason: 'records-changed' }
probe-hooks-correct.json: passed=2 failed=0 pending=32
probe-refusal.json: passed=0 failed=1 pending=4
REVIEW F-9 refusal leaves orchestrator bytes unchanged REVIEW stale token refuses without read repair
AssertionError: expected 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' to be 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' // Object.is equality

```

## Confirmed finding M-3 — T-9.8a does not enforce the complete retire-write identity

`packages/core/src/session-manager.ts:4868` correctly compares `launchIdentity(raw)` before writing retirement keys. T-9.8a (`runtime-herdr/fit2-create-rollback.test.ts:2291`) only changes restoredAt during the evidence call. Removing only runtimeHandle from the expected identity still passes every existing test in the 16 changed files. A handle publication can change runtimeHandle while other launch fields remain the same; that required key must be tested independently.

Added probe: replace only runtimeHandle during the pane-get stand-in, retain all other fields, and return the original pane-not-found answer. Correct code refuses at the retire write with no keys written. The mutant writes retiredBy/retiredIdentityToken onto the replacement, then the later kill guard refuses. Thus the old T-9.8a catches an unconditional write but accepts a materially incomplete compare. Add an independent case per launch-identity key, preserving full replacement bytes and requiring the retirement-stage refusal. Current product code passes the added handle-only case.

Measured retirement receipts:

```text
mutant-retire-cli.json: passed=249 failed=0 pending=0
mutant-retire-core.json: passed=72 failed=0 pending=1
mutant-retire-runtime-herdr.json: passed=164 failed=0 pending=3
probe-retire-mutant.json: passed=0 failed=1 pending=85
REVIEW retire write identity REVIEW handle-only replacement during evidence; no retirement keys on replacement
AssertionError: expected 'Session app-1 changed while it was ki…' to match /^Session app-1 changed while it was r…/
probe-retire-correct.json: passed=1 failed=0 pending=85
probe-refusal-expanded.json: passed=0 failed=2 pending=4
REVIEW F-9 refusal leaves orchestrator bytes unchanged REVIEW stale token refuses without read repair
AssertionError: expected 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' to be 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' // Object.is equality
REVIEW live-pane refusal preserves an unrepaired orchestrator
AssertionError: expected 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' to be 'worktree=/tmp/aof2bs/tmp/ao-test-stat…' // Object.is equality
REVIEW stale-token repair {"before":{"status":"merged","generation":"3","pr":"https://github.com/example/repo/pull/1"},"after":{"status":"working","generation":"4","role":"orchestrator","prAutoDetect":"off"}}

```

## Confirmed finding M-4 — Lock-subject tests do not guard the operation's equality checks

`packages/core/src/session-manager.ts:3300` defines the required canonical-subject equality check; start invokes it after mkdir and immediately before the reservation, restore before copy-back/transition. The unit subject test and D2-b protect the subject algorithm, but replacing the operation's `checkSubject` with a no-op still passes all 485 existing scenarios in the 16 changed files (core rebuilt successfully). The project lock alone cannot establish that the directory still resolves to that subject at a later write.

Added scratch probe: isolated start; at `before-reservation`, rename the sessions directory to `<sessions>-moved` and make the old pathname a symlink to it. Correct code refuses admission-path and makes no reservation/workspace/runtime. With only the equality checks removed it launches. This is a change before the specified final check, distinct from residual R-A's third-party swap between that check and the write. Add late-subject-change cases at the start/restore use sites and a mkdir-to-check case; retain D2-b for the different lock-name defect.

Measured receipts:

```text
mutant-subject-verified-core: passed=72 failed=0
mutant-subject-verified-runtime-herdr: passed=164 failed=0
mutant-subject-verified-cli: passed=249 failed=0
probe-subject-correct: passed=1 failed=0
probe-subject-mutant-verified: passed=0 failed=1

```

## Confirmed finding M-5 — CLI malformed-text routing has no independent regression case

`packages/cli/src/commands/start.ts:1036` correctly uses the complete G1 predicate. T-7.9b only tests a handle that parses but omits runtimeName. A partial implementation that also requires successful JSON parsing before sending candidates to core still passes all 485 original tests. It keeps that tested row but bypasses the unparseable-text row that the shared predicate expressly selects.

Added real-core CLI probe: nonterminal orchestrator, raw handle text `{"runtimeName":"herdr", BROKEN`, selected Herdr runtime and the existing recording runtime stand-in. Correct code routes it to core and refuses damaged. The partial predicate lets the CLI probe its synthesized handle and print successful reuse (exit 0), violating the damaged-handle rule. Add this sibling to T-7.9b, with the no-runtime-call-after-list assertion and a malformed-text case selected by project runtime alone. Keep the shared predicate unmodified in the product.

Measured receipts:

```text
mutant-cli-core: passed=72 failed=0
mutant-cli-runtime-herdr: passed=164 failed=0
mutant-cli-cli: passed=249 failed=0
probe-cli-correct: passed=1 failed=0
probe-cli-mutant: passed=0 failed=1
REVIEW unparseable Herdr handle goes to core, never reused by CLI
AssertionError: expected 'exit 0' to be 'exit 1' // Object.is equality

```

## Minor m-1 — The edited lifecycle contract still describes rejected agent checks as false

`packages/core/src/lifecycle-manager.ts:217`–:223 still says core Herdr process reads answer “no process” on an error and that Codex, Gemini and OpenCode answer false on errors. The changed Herdr runtime sentence is correct, but these neighboring statements contradict CLAUDE.md's process contract and the actual helper/agent delegation. `core/herdr.ts` rejects malformed/failed process-info answers; all four agents delegate their Herdr process checks to it. Correct these sentences in this touched comment now. This is documentation only; do not alter the authoritative runtime/agent sets.

## D1 and D2 assessment

The new-test/base comparison was run independently with the tip's 16 changed test files against built c6d80383. The original baseline test names were collected first. Both lists were nonempty, with T-9.6 in the tip list, T-4.20 in the base list and T-7.27 in the new failing list. Results:

```text
tip copied tests=485; original base unique names=366; new names=163; new failed=141; new passed=22
Sentinels: T-9.6 in tip list; T-4.20 in base list; T-7.27 in new failing list.
```

The author's 22 new base passes are reproduced exactly. Accept them: the live project reuse controls, core project-mode exited-agent reuse, CLI live isolated/mode-change reuse, tmux/mock no-server controls, no-orchestrator, tmux preflight, unsupported-platform mock/reuse controls, existing live-launch kill refusal, cleanup retention, no-option CLI kill, ordinary-error prefix, existing other-runtime behavior, and T-7.8b's dispatch already landed in fit-2a. They are preservation checks, not evidence that a new admission rule exists. The 141 failures cover the new exports, blocking messages, bounded admission, new option, status/preflight and race outcomes. Changed-name controls must not be counted as independent new behavior. The copied baseline run also fails 15 retained names whose assertions changed. The T-4.12 record-input assertion appropriately passes on base; the actual display assertion fails there in CLI status tests.

The three publication/settlement/write-back identity tests added by fit-2a's r2 remain intact except their required F-9 warning ends. Those warning changes and the deferred start blocks fail on the base for the expected old-message/no-admission reasons. No unexplained baseline pass was found.

Independent D2-a: the old realpath-else-resolve subject fails the subject-invariance unit test. Independent D2-b: that rule plus removal of the operation's equality checks admits two launches under the forced barrier. The identical schedule with correct code gives one launch and blocks process 2. D2-b proves the duplicate-admission defect, beyond D2-a's name-invariance property. The unchanged no-symlink fork control passes under the mutant.

```text
d2a-mutant: passed=0, failed=1
admissionLock a symlinked parent gives one subject before and after the mkdir
AssertionError: expected '/tmp/aof2bs/tmp/ao-admission-iIPfjT/l…' to be '/tmp/aof2bs/tmp/ao-admission-iIPfjT/r…' // Object.is equality
d2b-mutant: passed=1, failed=2
T-7.21c: the first start under a symlinked parent one launch over both processes; process 2 waits for A and is blocked in-progress
AssertionError: expected [ 'subject-fixed', 'lock-held', …(3) ] to not include 'lock-held'
D2-b: the schedule of T-7.21c with one more barrier (design r11 8) process 2 never reaches before-reservation while process 1 waits there; one launch
AssertionError: expected { …(5) } to deeply equal { …(5) }
REVIEW D2-b schedule {"processTwoReachedTheBarrier":true,"reachedSelected":0,"recordsWhileBothWait":[],"results":[["one","started","app-orchestrator-2"],["two","started","app-orchestrator-1"]],"creates":["one runtime create app-orchestrator-2","one workspace create app-orchestrator-2","two runtime create app-orchestrator-1","two workspace create app-orchestrator-1"],"records":["app-orchestrator-1","app-orchestrator-2"]}

```

## Gates, unchanged behavior and landing

Scratch environment for every pnpm/node/test parent: `env -i HOME=/tmp/aof2bs/home TMPDIR=/tmp/aof2bs/tmp PATH=/tmp/aof2bs/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true`. The PATH directory contains links to needed tools, cached pnpm 9.15.4, a gh stub accepting only --version/auth status and a tmux shim invoking `env -u TMUX /usr/bin/tmux -L aof2bs-tests "$@"`. Explicit test -S paths take precedence. No agent binary, herdr, npm or npx is on PATH. Frozen offline install uses `/home/taisung/.local/share/pnpm/store/v3`.

Both archived base and tip installed and built successfully. Tip and base typecheck/lint passed. Tip lint has exactly five warnings: cli spawn.ts:332, core activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:3866 and :3873; the base has the same warnings at its earlier lines. The first full tip run failed only three `relaunch-conversation.test.ts` cases because my restricted PATH lacked jq (`Command failed: bash -c command -v jq`). After adding the jq link, the complete full tip run passed. The base full run then passed, run separately to avoid private-tmux collisions. No product failure was hidden by the environment correction.

Full gate counts (passed; expected failures and skips explicit):

| Package | Base | Tip |
| --- | --- | --- |
| core | 1847 + 1 expected fail | 1869 + 1 expected fail |
| runtime-herdr | 272 | 327 |
| cli | 447 | 489 |
| claude-code | 368 | 368 |
| codex | 318 | 318 |
| gemini | 99 | 99 |
| opencode | 365 | 365 |
| runtime-tmux | 116 | 116 |
| workspace-worktree | 85 | 85 |
| scm-github | 140 + 5 skipped | 140 + 5 skipped |
| tracker-github | 42 | 42 |
| notifier-desktop | 26 | 26 |
| integration-tests | 91 + 24 skipped | 91 + 24 skipped |

All private-tmux cases ran; runtime-tmux and the agent packages have no skipped tests. The full counts exactly match the author's final table. Independent JSON-name accounting explains every difference: core 26 new minus 4 removed/renamed = +22; runtime-herdr 62 minus 7 = +55; CLI 75 minus 33 = +42. Source changes explain these as the new admission/retirement/preflight/status cases and renamed interim oracles, not dropped coverage. Other package counts are unchanged.

All fifteen relaunch files passed separately (actual base file locations, including core's session-manager subdirectory and codex/gemini's src/agent-pane.test.ts):

```text
relaunch-agent-claude-code.json: files=3 passed=49 failed=0 pending=0
relaunch-agent-codex.json: files=1 passed=10 failed=0 pending=0
relaunch-agent-gemini.json: files=1 passed=10 failed=0 pending=0
relaunch-cli.json: files=3 passed=56 failed=0 pending=0
relaunch-core.json: files=4 passed=133 failed=0 pending=0
relaunch-runtime-tmux.json: files=3 passed=47 failed=0 pending=0
```

`SAME_ID_DEFECTS=red` was run separately on base and tip across all nine packages containing same-id files. Each failing list is nonempty and explicitly contains both R2 B-1 and R3 F-5. The sets are equal: 21 failures, R2 15/R3 6. Core 1; claude/codex/gemini 1 each; OpenCode 2; runtime-tmux 11; worktree 4; CLI and runtime-herdr 0. Nonzero exits were expected. Full failure-name receipt:

```text
red-base-agent-claude-code.json: failures=1
red-base-agent-codex.json: failures=1
red-base-agent-gemini.json: failures=1
red-base-agent-opencode.json: failures=2
red-base-cli.json: failures=0
red-base-core.json: failures=1
red-base-runtime-herdr.json: failures=0
red-base-runtime-tmux.json: failures=11
red-base-workspace-worktree.json: failures=4
base: total=21 R2=15 R3=6
red-tip-agent-claude-code.json: failures=1
red-tip-agent-codex.json: failures=1
red-tip-agent-gemini.json: failures=1
red-tip-agent-opencode.json: failures=2
red-tip-cli.json: failures=0
red-tip-core.json: failures=1
red-tip-runtime-herdr.json: failures=0
red-tip-runtime-tmux.json: failures=11
red-tip-workspace-worktree.json: failures=4
tip: total=21 R2=15 R3=6
nonempty sentinel checks passed for both: R2 B-1 and R3 F-5
equal=True
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
[same-id R2] B-1: two launches of an ID in the same second after a same-second restart of the server, isAlive of the old launch answers false
[same-id R2] B-1: two launches of an ID in the same second destroy of the first launch keeps a replacement of the ID that started in the same second
[same-id R2] B-1: two launches of an ID in the same second isAlive of the first launch answers false while a same-second replacement of the ID runs
[same-id R2] B-2: a replacement between the create and its launch keys create: a replacement of the ID made directly after the create command never receives the first launch's keys
[same-id R2] B-5: another server answers at the recorded socket path isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
[same-id R2] B-5: another server answers at the recorded socket path isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
[same-id R2] D-B: a call finds the tmux server only through its environment destroy from another server's environment does not end that server's session of the same name
[same-id R2] D-B: a call finds the tmux server only through its environment isAlive answers true for a live session when the caller's environment names another server
[same-id R2] D-B: the claude-code pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the codex pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the gemini pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] D-B: the opencode pane read finds the tmux server only through the environment isProcessRunning finds the agent on the server that the handle names, from another server's environment
[same-id R2] F-5: destroy by name ends another launch of the same name destroy keeps a newer session of the same name that another launch created
[same-id R2] F-7: a hidden socket of a running server reads as no server isAlive does not report 'no server' while the recorded server process still runs
[same-id R3] F-1: the create cleanup after a failed checkout removes a newer launch's worktree create does not remove a worktree that another launch made at the path during the checkout
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files restore: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-2: postCreate runs after an unchecked await and removes a newer launch's files spawn: postCreate keeps the files of another launch that took the record and the path during the git add
[same-id R3] F-3: issue reuse writes its mapping only after it awaited session.get a rollback during another spawn's session.get does not remove the session that the spawn then stores
[same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime
[same-id R3] F-5: a kill's single git command removes the worktree of a restore that ran during it kill and restore of one ID: the active record at the end still has its worktree
```

`gitleaks git --log-opts=c6d80383..13f982c2 --redact`: exit 0, four commits scanned, no leaks found. `git merge-tree --write-tree --merge-base c6d80383 main 13f982c2`: exit 0, tree 7a0a189e0f851e335a555264a3ff353177db9e89. Local main was d8c116c098e9af120d0ac29a538660b2579c853f. Conflicting paths: none. No ref was written or branch changed. Per-commit intermediate gates were not rerun; those remain author-report evidence. All requested final gates were run independently.

## What was found correct

- The canonical admission subject is computed before lock acquisition; A covers local G/validation/hooks/reservations and orchestrator restore copy-back/transition. Start probes and message probes run outside A; restore releases A before workspace recreation. Busy/unsupported/path/unreadable/changing records refuse. The bounded rounds and process-stage schedules behaved as specified.
- G1 selects known-Herdr orchestrators at every stored status, including damaged handles and pending claims; R refuses a live launcher, P, kept failure, terminal status, runtime mismatch and an ineligible direct-core workspace/strategy. Reuse answers are keyed by identity token and rejudged under A. No current-code interleaving admitting two known-Herdr orchestrator launches or reusing a protected pending/failed launch was found within the stated limits. M-2/M-4 concern unguarded tests of correctly implemented checks.
- CLI routes the selected malformed-handle row through the shared predicate, asks core for reuse, retains unchecked/outside-set behavior and rethrows the same blocked error without the setup prefix. Selected-runtime preflight uses the registry instance; create step-1 errors retain their text. Runtime-stop's no-server fallback is now restricted outside the unproven set.
- F-9 checks the token and live launcher before runtime work, makes the bounded evidence call, refuses an alive answer and compares the complete launch identity before writing retire keys. Later identity checks and plugin callbacks protect workspace/agent/archive steps. Current tests and added handle-only probe preserve replacements. Project checkouts, panes/workspaces/server, prompt files and unpurged agent sessions stay. M-1 is the initial read-repair exception to the refusal contract; M-3 is missing comparator coverage.
- Status derives its token from raw metadata and displays the specified failed/incomplete text and JSON fields. The unwritable before/after variants use their fixed identities; the uncertain variant names both possibilities; restore write-back names its transition identity. F-9 rejects a token of another state.
- Fit-2a publication, settlement, pending-handle and consumer behavior is retained except the requested retirement text/start-block assertions. The old startup guards are removed, and dispatch still follows the stored handle. No agent implementation or process-liveness contract changed. Full baseline, red-set and relaunch results support no observed tmux/other-runtime regression. The final docs accurately retain L-1 through L-5 and emergency by-hand retirement, subject to m-1's stale neighboring comment.

## Scope and size

The diff has exactly the twelve product paths authorized by 8.2, two documentation paths and sixteen test paths; no product expansion into agent plugins, old-runtime cleanup or development docs. The twelve product-code paths add +1415/-402; with the two docs (+58/-22), the combined product/documentation change is +1473/-424 against the ~920-line estimate. It is mainly session-manager +1134/-224. Its new classifier/error/message formatting is roughly two hundred lines; the shared admission types, G1/G2, message enrichment, rounds, bounds and callbacks occupy several hundred more; start's reservation branch was substantially refactored under A; restore uses extracted copy-back/stop/transition closures; F-9 adds validation/evidence/conditional-retire handling and warning-token composition. These branches are requested by the protocol. Generic admission plumbing and verbose diagnostics/comments account for the overrun; I found no unrelated behavior. It would be reasonable to shorten comments later, but not to remove safety branches to meet the estimate.

Tests add +4202/-252, driven by the new real-core CLI harness (+933), core-admission harness (+1019), fork/IPC schedules (+396), retirement and deferred fit-2a assertions (+454), plus core unit/F-9/OpenCode and CLI option/status/preflight coverage. The long harnesses and changed interim assertions explain the excess over ~1850 test lines. D1 and D2 demonstrate substantial useful coverage, with the specific independent gaps above.

## Judgment of all reported deviations

| # | Judgment |
| --- | --- |
| 1 | Accept merged false reason: isAlive returns a boolean and exposes neither absent-vs-other-terminal distinction. |
| 2 | Accept as a disclosed diagnostic limit: P has no pins and Runtime exposes no plugin binary. Bare herdr is a candidate command; the owner must choose the launch endpoint/binary by hand. Do not describe that fallback as necessarily the configured binary. |
| 3 | Accept “socket not recorded”; inventing a pin would mislead recovery. |
| 4 | Accept R8 before R7: this follows the field-first rounds even where acceptance-table wording says unproven. Preserve the actual not-reused isolated oracle and message evidence. |
| 5 | Accept no probe after the last round: no subsequent deciding read could use it. |
| 6 | Accept restore's explicit not-reused reason: every other selected record must block and there is no reuse candidate. |
| 7 | Accept repeated status/reason text; minor verbosity, no ambiguous decision. |
| 8 | Accept workspace label fallback through stored sessionId, tmuxName and ID. |
| 9 | Accept optional reuse API for existing SessionManager implementations/mocks; absence means no Herdr reuse, so core admission remains necessary before a launch. |
| 10 | Accept classifier placement/export and the outside-set wrapper retaining today's errors; no unrelated module is needed. |
| 11 | Accept readiness-error setup prefix; the no-prefix rule applies only to the typed admission refusal. |
| 12 | Accept selecting herdr in the reuse fixture: R5 needs an actual matching selected runtime. |
| 13 | Accept “create <stage>” as the incomplete reason. |
| 14 | Accept reuse-only to show A is free after failed restore; it tests lock availability without allocating a new launch. |
| 15 | Accept activity ordering by the list snapshot, exactly the design rule for core-only candidates. |
| 16 | Accept omitting attach when no pane exists. |
| 17 | Accept splitting the preserved-record input assertion from the actual CLI display assertion. The latter independently fails on base. |
| 18 | Accept capped classifier reason plus first failure line for evidence; it preserves the useful no-server/pin-error cause within the bound. |
| 19 | Accept both fixed candidate tokens in the uncertain warning. AO cannot assert which publication state persisted. The owner inspects status/the record; token mismatch refuses. |
| 20 | Accept transition token in write-back warning as the state this restore knows; a replacement token is rejected and the operator is told to inspect the record. |
| 21 | Accept appending the F-9 hint only for direct unknown Herdr kills. Current Herdr stop always yields unknown; cleanup gets no attestation. ao stop may display that same direct-kill hint but never passes the option. |
| 22 | Accept unquoted generated IDs and hex tokens here; both are shell-safe under the ID validation. Prefer shellEscape for consistency if this helper later takes free text. No behavior change is required for this round. |
| 23 | Accept refusal wording except the “Nothing was changed” promise exposed by M-1; repair that behavior, not the promise. |
| 24 | Accept “retired” for successful owner-attested kill: useful operator feedback. |
| 25 | Accept separate core OpenCode mocks and real-plugin/worktree tests. The cleanup sm.kill spy alone is vacuous because cleanup calls killRecord, but retained-byte/no-retire-key/error assertions provide the relevant check. |
| 26 | Accept the extra preflight unit tests in fit-pins.test.ts: relevant coverage within an already authorized test file. |
| 27 | Accept old filenames with final describe labels; renaming adds churn without coverage. |
| 28 | Require m-1's comment correction. Leaving known false agent-contract sentences in this edited contract is unnecessary. |
| 29 | Accept runtime-built fake token text. It avoids a secret-scanner false positive without suppressing scanning or weakening the test. |

Open question 1: correct the stale agent sentences in the touched comment now; keep the authoritative sets unchanged. No later behavior round or owner decision is needed.

Open question 2: keep R8 before probes. An isolated direct-core record cannot be reused even if its pane is alive, so the field-first kind is not-reused. A post-lock probe may still supply the pane answer for M. Clarify contradictory acceptance-table prose when the design document is updated.

Open question 3: no quoting fix is required for the validated generated ID/hex token pair. Using shellEscape consistently is a reasonable small cleanup; do not broaden this review into a CLI grammar change.

Open question 4: doc 0004 remains the orchestrator's explicitly excluded development-document follow-up; not edited here.

## Reproducing the measured findings

Use an archive of 13f982c2 with the restricted/offline scratch environment above, install then build root. Keep source mutations and tests in that archive only. Each comparator mutant was applied alone, core rebuilt for core changes and CLI rebuilt for its change; the original source was restored between mutants. Run the sixteen paths listed by `git diff --name-only c6d80383 13f982c2 -- '*test.ts'` in their three packages, with `-t '^(?!.*REVIEW)'` to exclude reviewer probes. Every accepted mutant below passes 72 core + 164 runtime-herdr + 249 CLI = 485 existing scenarios. The M-1 product failure needs no mutant.

| Finding | Scratch-only wrong implementation |
| --- | --- |
| M-2 | In the candidate branch after awaited hooks, replace the strict read/token compare/rejudge block with `metadataToSession(candidate.record.id, candidate.record.raw, orchestratorConfig.projectId)`, then mark/return it as reused as before. |
| M-3 | Only the retire write's expected argument becomes `Object.fromEntries(Object.entries(launchIdentity(raw)).filter(([key]) => key !== "runtimeHandle"))`. All later kill identity checks stay intact. |
| M-4 | Replace the operation's `checkSubject` function body with an empty body; keep admissionLock's canonical subject unchanged. |
| M-5 | CLI coreDecides requires the shared predicate AND successful JSON parsing of the stored handle (`try { return JSON.parse(s.metadata["runtimeHandle"] ?? "") !== null; } catch { return false; }`). Keep the shared core predicate unchanged. |

All builds for these final measured runs exit 0. One preliminary subject-mutant command used an incorrect relative build directory and exited ENOENT; that run is discarded. The complete 485-scenario subject-mutant run was repeated after a successful core rebuild and has its own verified JSON receipts. Initial relaunch path assertions were also corrected to the actual baseline locations before the successful fifteen-file gate. These were scratch runner mistakes, not product failures.

M-1: append to core `src/__tests__/session-manager/retire-herdr.test.ts`, using its existing helpers:

```ts
it("REVIEW stale token refuses without read repair", async () => {
  const { readFileSync } = await import("node:fs");
  keptOpenCodeRecord("app-orchestrator");
  updateMetadata(sessionsDir, "app-orchestrator", {
    status: "merged", pr: "https://github.com/example/repo/pull/1",
  });
  const file = join(sessionsDir, "app-orchestrator");
  const before = readFileSync(file, "utf8");
  const sm = createSessionManager({ config: ctx.config, registry });
  await expect(sm.kill("app-orchestrator", {
    confirmRuntimeClosed: "wrong",
  })).rejects.toThrow("the record now names another launch");
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(herdrRuntime.stop).not.toHaveBeenCalled();
});
```

A second measured case sets herdrRuntime.isAlive to true and passes tokenOf("app-orchestrator"); it rejects “the session runs; close it first” and fails the same byte-equality assertion. Both fail on the unmodified product. The measured transition is status merged/generation 3/PR present → status working/generation 4/role orchestrator/prAutoDetect off/PR absent.

M-2: in runtime-herdr `fit2-admission.test.ts` add `let reviewSetupHook: undefined | (() => Promise<void>)`, reset it in beforeEach, and await `reviewSetupHook?.()` inside the harness's setupWorkspaceHooks after recording hookCalls. Then append:

```ts
it("REVIEW hook failure blocks reuse", async () => {
  const h = setup();
  paneRuns("w3:p2", "term_a");
  const before = orchestrator(h, FIXED, pinned("w3:p2", "term_a"));
  reviewSetupHook = async () => {
    reviewSetupHook = undefined;
    writeRecord(h, FIXED, { ...before, launchFailed: "failure during hooks" });
  };
  const err = await startError(h.sm());
  expect(rows(err)).toEqual([[FIXED, "not-reused", "its launch failed"]]);
  expect(createCommands()).toEqual([]);
});
```

The second measured case writes only restoredAt = "2099-01-01T00:00:00.000Z" in that hook and expects reason records-changed. Both pass correct code and fail M-2's mutant.

M-3: append to runtime-herdr `fit2-create-rollback.test.ts`, using its helpers:

```ts
it("REVIEW handle-only replacement during evidence", async () => {
  const h = await setup();
  const worktree = keptRecord(h, "app-1", {
    data: pinnedData("launch-unconfirmed"),
  });
  const token = launchIdentityToken(h.record("app-1") ?? {});
  let replacement = "";
  herdr.on["pane get"] = async (_args, answer) => {
    replacement = writeRecord(h, "app-1", {
      ...(h.record("app-1") ?? {}),
      runtimeHandle: JSON.stringify({
        id: "w8:p1", runtimeName: "herdr",
        data: { ...pinnedData(), terminalId: "term_new" },
      }),
    });
    return answer();
  };
  const err = await h.sm.kill("app-1", {
    confirmRuntimeClosed: token,
  }).catch((e: unknown) => e);
  expect((err as Error).message).toMatch(/^Session app-1 changed while it was retired/);
  expect(h.file("app-1")).toBe(replacement);
  expect(h.record("app-1")).not.toHaveProperty("retiredBy");
  expect(existsSync(worktree)).toBe(true);
  expect(archivedRecord(h, "app-1")).toBeNull();
});
```

M-4: append to runtime-herdr `fit2-admission.test.ts`:

```ts
it("REVIEW subject recheck before reservation", async () => {
  const { symlinkSync } = await import("node:fs");
  const h = setup({ mode: "isolated" });
  const moved = h.sessionsDir + "-moved";
  let swapped = false;
  const err = await startError(h.sm({ onStage: async (stage) => {
    if (stage === "before-reservation" && !swapped) {
      swapped = true;
      renameSync(h.sessionsDir, moved);
      symlinkSync(moved, h.sessionsDir);
    }
  } }));
  expect(swapped).toBe(true);
  expect(err).toMatchObject({ reason: "admission-path" });
  expect(readdirSync(moved)).toEqual([]);
  expect(createCommands()).toEqual([]);
  expect(h.workspaceCalls).toEqual([]);
});
```

M-5: append to CLI `__tests__/commands/start-herdr-guard.test.ts`:

```ts
it("REVIEW unparseable handle goes to core", async () => {
  const calls: Array<{ method: string; handle?: RuntimeHandle }> = [];
  await setup({ recordingHerdr: calls });
  orchestrator(FIXED, '{"runtimeName":"herdr", BROKEN');
  expect(await start()).toBe("exit 1");
  expect(errors()).toContain("Its runtime handle cannot be read (");
  expect(workspaceCalls).toEqual([]);
});
```

M-3/M-4/M-5 each pass the unmodified product and fail their corresponding sole mutant. No change to an existing test assertion was needed to expose these gaps. The copied source above is the measured probe logic with shorter labels/formatting; the proposed additional live-claim, per-key and restore-site siblings are recommendations, not run.


Final isolated D1 check of the deferred start assertions: T-4.20c/d normally fail the old warning-text assertion before reaching their new start block. In a baseline scratch test copy I moved only those start-block assertions immediately after the restore/fault reset, retaining their expected values, and selected them with T-4.16. All three fail specifically at the blocked-error guard, confirming that the new admission assertions distinguish the base independently of warning changes:

```text
baseline deferred start assertions: passed=0, failed=3
Herdr fit-2 F-4: the resident restore settles its own claim (T-4.16, T-4.16b) T-4.16: postLaunchSetup throws once; the restore resolves with no claim; kill refuses unknown
AssertionError: expected false to be true // Object.is equality
Herdr fit-2 F-4: the publication rule at restore step 10 (T-4.20a to T-4.20e) T-4.20c: every write fails from step 10 on; the warning 'not settled', P and the claim stay
AssertionError: expected false to be true // Object.is equality
Herdr fit-2 F-4: the publication rule at restore step 10 (T-4.20a to T-4.20e) T-4.20d: the write and its retry fail; the settlement on 'before' clears the claim
AssertionError: expected false to be true // Object.is equality
```

## Cleanup receipts

No remaining process with a scratch HOME or cwd was found (the scanner excludes itself and its parent):

```json
[]
```

The explicit private-server check (through the shim; never the default server) returned:

```text
no server running on /tmp/tmux-44402/aof2bs-tests
private tmux list exit=1
```

No process was manually signalled by this reviewer. Test harnesses cleaned their own children and private test sockets. The remaining unused private socket is removed at completion.

The required real-state scan was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof2bs-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Every printed path:

```text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/sessions/as-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

The first two are the concurrent agent-skills session/lifecycle activity; the next two are Nexus session/lifecycle activity; the final two are agent-orchestrator session/lifecycle activity. None was written by this review: no real-config AO call ran, and every node/pnpm/test parent used the cleared scratch environment. Exact syscall-writer PIDs were not instrumented, so this is project/path attribution rather than a measured PID claim. The protected workers/sessions and the other reviewer were not acted on.

The final ~/.ao/bin listing is byte-equal to the initial listing: entries, sizes, permissions and mtimes match (listing equality, not a content-hash claim). The tracked diff remains empty. Only this review and the required .agent_report.md were written in the worktree; .agent_task.md was supplied externally. No commit, push, PR, network operation, branch change, stash, worktree creation or real agent/Herdr server launch occurred.

```text
ao-bin listing compare exit=0
tracked diff exit=0
Each mutant list nonempty: 485 passed original tests, with T-9.8a, T-7.27 and classifier sentinels. All four original-name sets equal.

```

Final removal check: /tmp/aof2bs and /tmp/aof2bs-marker are absent. Post-final-test process scan: [].
The initial forced-delete cleanup command was rejected before execution; cleanup succeeded using explicit path/type/ownership checks and scratch-only removal.
