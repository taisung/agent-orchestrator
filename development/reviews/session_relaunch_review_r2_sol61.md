NOT-LAND-SAFE

Reviewed `3e366a01..0aa13578`, focusing on `554facd9..0aa13578`, on 2026-10-22. **0 blocking, 4 new major, 0 new minor findings; r1 M-6 also remains open.** The corrected landing gates pass. The new failures concern false death of a live agent, execution of unsubmitted shell input, stale conversation selection, and launch into a replacement pane.

This is a code and behavior audit. Requirements, note 1, r1 review, r2 brief, production diff, callers, and DEVELOPMENT.md were read before the author's r2 report. HEAD was verified as `0aa13578`. No production/test source in this worktree was changed; no commit, fetch, push, PR, network call, real agent, model turn, or `ao send` was made. Mutations and extra tests used archives under `/tmp/aorlr2`. Native checks used this worktree's built JS, stand-ins, a clean environment, scratch config/state, and the private tmux server `aorlr2-review`.

## Round 1 findings

The identifiers in this table refer to **r1**. The numbered findings below are this review's identifiers.

| r1 finding | State | Independent evidence on r2 |
| --- | --- | --- |
| M-1: another pane overwrites the conversation | Partly closed | The original second-window overwrite is closed: the window inherited AO_SESSION/AO_DATA_DIR, lacked AO_LAUNCH_TOKEN, and did not change the side file. Both nested-Claude tests pass. Fixed pane IDs prevent active-window changes redirecting send-keys. Pane/liveness consistency remains broken (new M-1), and a missing stored pane silently falls back (new M-4). |
| M-2: signal kills wrapper while agent survives | Closed for the supported simple-command path | Actual own-pane built CLI: SIGTERM to AO PID 1011531 alone ended agent 1011601 and AO, shell rc 143; SIGHUP to AO 1012161 alone ended agent 1012178 and AO, shell rc 129. HOME was checked before signalling each exact PID. The real child/grandchild tests pass. Compound commands are refused in the own pane before claiming. |
| M-3: settlement failure holds a live claim | Closed when writes can recover | Three forced conflicts, and four forced EIO errors, report immediately with a pending own-pane child and clear keys on tries 4 and 5. The script-removal exception test also passes. Settlement reads and updates under a reentrant record lock and compares its own claim rather than the whole changing generation. Persistent inability to write still cannot promise eventual clearing; retries and the operator warning are appropriate. |
| M-4: old incarnation accepted within 5 seconds | Closed | Native same-ID/same-pane reuse with a deliberately failing replacement hook, only **496 ms** later: side file unchanged, built lookup returned id:null because the new token differed. The old-build test accepts that old ID, as described below. |
| M-5: C-u keeps the owner's suffix | Partly closed | All four real-Bash tests pass: start, middle, end, and PS2. Additional vi insertion and vi command-mode probes also discard the text. An ignored/trapped SIGINT breaks the claimed reset (new M-2). |
| M-6: restore/kill already in flight | Open by design | Exact-tip core fault injection holds an earlier restore in runtime.destroy, lets relaunch return running:true, then releases destruction: agentRunning becomes false. The later restore reports its record changed. A late CAS cannot undo the earlier destruction. The opposite order's claim-refusal test passes. |
| M-7: unbounded confirmation probe | Closed for confirmation | Unresolved and late process-probe tests pass, retaining new launch evidence as unknown and clearing the claim. On r1 both time out. runInPane timeout is also bounded and classified unknown. Preparation and post-launch setup have separate 10-second bounds; this is not a single 15-second wall-clock bound from the claim. |
| m-1: synchronous hook delays startup | Closed for startup latency | Settings install/update async:true and timeout:5. Slow tmux and unclosed stdin hook tests finish within their budgets on r2 and fail on r1. Async recording introduces the independent ordering failure in new M-3. |

## New findings

### M-1 — A stored pane in another window is launched, then declared absent and killed

**Code:** `packages/plugins/agent-claude-code/src/index.ts:750`–`:756`; `packages/core/src/session-manager.ts:5423`, `:5285`; `packages/core/src/lifecycle-manager.ts:687`–`:692`.

`listPanes` finds every window and relaunch correctly uses the stored `%N`. The Claude liveness check still issues `list-panes -t =name:` **without -s**, which reads only the current window. Confirmation and activity therefore inspect a different set of terminals from the launch. A well-formed negative from the wrong window is treated as definite absence, rolls back restoredAt/token, removes the grace, and supplies an exited observation to lifecycle. This makes the author's open question 1 a measured landing defect.

**Native reproducer on the built tip:**

1. In private session `native-two`, relaunch dm-1 into `%2`; the first relaunch confirms running and persists launchPane=%2.
2. Create another window `%3`, inheriting AO_SESSION/AO_DATA_DIR but no launch token. Run/end an independent stand-in there. End dm-1 with `/exit`. For a short fixture, age restoredAt and launchTokenAt to the same value older than the grace, preserving the binding.
3. Select `%3`, leaving `%2`'s shell idle, then call the built SessionManager.relaunch(dm-1, {continueConversation:true}).
4. The launch resumes the correct UUID `5d5aee31-1b46-4443-afbe-0981b0441622` in `%2`, and agent PID **1006389** lives. Result: **running:false, agentState:absent**. The old timestamp/token return. Built isProcessRunning answers false and getActivityState answers exited.
5. Two actual in-process lifecycle polls: first retains working; second writes **status=killed, killedReason=agent-exited**, while the stand-in still lives. CLI session ls shows it killed.

No production code was mutated for this result. Align preflight, confirmation, activity and lifecycle with the authoritative agent pane; widening the launch-side list alone is insufficient. Add an integration test that keeps another window selected throughout relaunch and both polls.

### M-2 — C-c does not establish empty input when SIGINT is ignored or trapped

**Code:** `packages/plugins/runtime-tmux/src/index.ts:405`–`:414`; associated guarantee in `packages/cli/src/commands/session.ts:455` and `docs/DEVELOPMENT.md:433`.

The foreground-process-group check proves that Bash owns the terminal. It does not prove Bash will discard readline's input on C-c. Waiting 300 ms does not establish that state either.

**Native real-Bash reproducer using built runtime.runInPane:**

```sh
trap '' INT
# Type, but do NOT submit:
; touch /tmp/aorlr2/live/owner-ignore
# Move the cursor to the start with C-a.
# From outside: runtime.runInPane(handle, paneId,
#   'touch /tmp/aorlr2/live/launched-ignore')
```

listPanes reports foregroundCommand=bash, shellIdle=true. runInPane succeeds. Capture:

```text
bash-5.2$ touch /tmp/aorlr2/live/launched-ignore; touch /tmp/aorlr2/live/owner-ignore
```

**Both markers exist.** The owner's unsubmitted suffix ran. With a real AO launch, such a suffix can run when the agent ends. This is the original terminal-input safety failure under a different Bash configuration.

A second native probe installed `trap 'read -r intercepted; printf "%s" "$intercepted" > /tmp/aorlr2/live/trap-input' INT`. The trap consumed the entire launch command as data; runInPane returned successfully and the launch marker was absent. Vi insertion and command mode passed; a foreground `sleep 30` was correctly refused with shellIdle=false.

Require positive evidence of a fresh shell input state, or refuse with recovery instructions when it cannot be established. The help/docs must not promise unconditionally that half-typed text never runs. Add real-shell tests with ignored SIGINT and a consuming SIGINT trap.

### M-3 — Async SessionStart completions can restore an obsolete conversation ID

**Code:** `packages/plugins/agent-claude-code/src/index.ts:386`–`:395`, `:943`–`:947`, `:1377`–`:1387`.

Every hook atomically replaces the same per-session file, and the lookup checks launch token and pane. There is no ordering information within a launch. Once hooks run asynchronously, an older startup/resume hook may finish after a newer clear hook. Both have the same token, pane and agent, so the older event's ID is accepted as current. Atomic rename prevents torn data, not out-of-order events. A write lock only around rename would also be insufficient.

**Native hook reproducer:** one claude-named stand-in, PID **1048766**, on private pane `%11`, invokes the actual installed hook twice, modeling the configured async dispatch. Start hook A with source=startup and ID `11111111-1111-4111-8111-111111111111`; delay its tmux display-message step **1.4 seconds**, inside the new 2-second budget. After 100 ms invoke hook B with source=clear and ID `22222222-2222-4222-8222-222222222222`, without the delay. Both use token `33333333-3333-4333-8333-333333333333` and existing transcripts.

The side file first holds B/source=clear, then A/source=startup. The built getOwnConversationId returns **A**, with the same agent PID/token/pane. Thus --continue can select the conversation that preceded /clear. This measures concurrent execution of the shipped hook, not a real Claude /clear or model turn; permitting overlapping executions follows from the new async contract.

Preserve event order or establish the agent's current conversation before accepting the pointer. Add a same-launch delayed-old-hook/new-clear regression test; the current serial hook tests cannot detect this.

### M-4 — A missing stored agent pane silently becomes the remaining unrelated pane

**Code:** `packages/core/src/session-manager.ts:5090`–`:5096`.

`recordedPane ?? (panes.length === 1 ? panes[0] : undefined)` applies the one-pane fallback even when a valid binding explicitly names a pane that disappeared. This confuses “no pane recorded” with “the recorded pane is gone.” Without --continue it interrupts and launches into a different window's shell, instead of the required missing-pane refusal.

**Native reproducer:** after the M-1 fixture, dm-1 still has a valid binding naming `%2`. End its stand-in with `/exit`, then close `%2`. The pre-existing unrelated `%3` remains, with foregroundCommand=bash and shellIdle=true. Call built relaunch without --continue. It returns **running:true**, changes launchPane from **%2 to %3**, and launches the agent there. The recoverable killed status becomes working. No source mutation was used.

Use the sole-pane fallback only when there is no authoritative pane binding. If a stored pane is missing, refuse before claiming or sending keys, with an explicit recovery action. Add the missing-stored-pane/one-other-pane test; the existing tests cover a present stored pane and an absent binding, not this case.

## M-6 and the author's design

The documented limit is materially correct: a restore/kill that already passed its launcher check can destroy the pane after relaunch succeeds. The `/exit` gap has no new grace, so an already-started configured restoring reaction is included. `ao session ls` cannot prove no operation is in flight: neither older operation publishes such a claim today.

The minimum fix is shared operation exclusion: restore and kill acquire a CAS claim before any awaited destructive/allocation work, compare both the launch identity and the prior claim, carry their claimed identity through all subsequent ownership checks, and release only their own claim on every end path. Relaunch first then restore/kill is already excluded. Restore/kill first then relaunch becomes excluded through its initial owner check or failed claim CAS. Hold no metadata lock across those awaits. Include internal delivery-to-restore paths and failure/retry handling.

This needs **kill's claim as well as restore's claim**. Same-ID R3 work limited to unprepared-agent launch claims does not alone guarantee it; the R2b/R3 work must cover kill and make all participating operations obey the same protocol. With that complete protocol, relaunch itself should need no new exclusion mechanism. The six existing R3 red tests are not proof of this particular requirement. The author's proposed combined design can close both orders, but “once R3 lands” is conditional on that scope.

My fault-injection repro of restore-first ends with relaunch=true, agentRunning=false and a restore error saying the record changed and the runtime name was kept because the current record may own it. This reproduces the race even though that later cleanup conservatively keeps the name. It remains a landing limitation independently of the four new findings.

## Design, documentation, and open questions

1. **Multi-window confirmation:** new M-1 proves both false absence and lifecycle kill. Fix before landing.
2. **Spawn stores no pane:** conservative refusal with multiple panes is preferable to guessing. Persist the actual creation pane when feasible; changing oracles is justified if they pin the old defect. Do not use “close the other panes” as evidence of ownership when a stored pane is missing (M-4).
3. **Restore invalidates the token:** implemented correctly for ordinary distinct launch timestamps; active restore moves restoredAt without updating launchTokenAt, archive copy-back drops the token keys. Explicit --continue refusal is truthful. Restore's newest-transcript behavior and missing orchestrator prompt remain outside this change.
4. **Pre-build sessions:** no token means no trustworthy automatic migration. Refusal is sound; starting a fresh conversation is a real cost, not a transparent continuation.
5. **Linux /proc:** the shell ownership check and caller-terminal lookup depend on it. Without it, external relaunch refuses. State the Linux-only support explicitly; no other OS was validated.
6. **C-c/vi:** vi insertion and command mode pass; ignored/consuming SIGINT traps fail (M-2). Foreground jobs with separate process groups are refused.
7. **Unexecuted scripts:** the documented orphan mode-0700 file remains possible. Self-removal only happens when executed. This round pins the mode correctly.
8. **Background own-pane AO:** the report's “not detected as case (b)” is inaccurate when stdin still points to the pane TTY: callerTerminal sees it and selects case (b). There is no check that AO owns the foreground process group. Background use therefore has no demonstrated terminal-ownership guarantee (reads may stop with SIGTTIN); foreground invocation is the validated flow. I did not run a background-agent native probe.

The token is a random UUID in the session record and hook side file, and appears in the launch argv/agent environment (and the relaunch script until execution). In the native fixture the record and side file were mode **0644** under the user's normal umask; the relaunch script is **0700**. It is an identity binding against accidental inheritance, not a secret against another local process of the same user. Ordinary second-window creation gets AO_SESSION/AO_DATA_DIR from the session environment but no token; nested descendants inherit the token and are filtered by ancestry/TTY. Those stated cases pass. Hook ordering within that same binding does not (M-3).

Every newly added runtime typing call targets `%N`, including ownership verification, copy-mode exit, C-c, literal text, and Enter. The list itself targets the exact session. This fixes active-selection redirection of those calls, but not the agent reader's current-window scope or the missing-pane fallback.

`exec` is used only for a syntactically accepted simple command. Claude's env prefix and quoted prompt-file substitution are covered; `cp ... && gemini` remains a compound launch from an external shell and is refused in the own pane before claiming. The helper's signal forwarding now reaches the direct agent for the accepted form. This is a deliberate capability restriction, rather than support for supervising arbitrary shell command trees.

Confirmation has a single 15-second deadline covering runtime typing and process polling. Preparation after the claim has a separate 10-second bound, and postLaunchSetup another 10 seconds after settlement. DEVELOPMENT.md's “every awaited call after the claim gets only the time left of that bound” should instead describe the actual start/confirmation scope. Similarly, not every external hook utility is individually budgeted: readlink, mkdir/mv and the jq-less pipelines are plain calls; absent timeout, bounded() falls back to an unbounded call. Async dispatch and the overall 5-second hook setting close the startup-latency finding, with refusal when no sound record exists.

The send-to-shell warning is correct: send.ts:349–363 bypasses SessionManager for live tmux sessions and pastes directly. No ao send was run. PostToolUse merging and its pre-existing timeout:5000 seconds remain unchanged. Shared setup installs the new hook on ordinary Claude spawns too, so M-3 is not confined to relaunched sessions.

## Tests, changed oracles, and a surviving partial fix

All **129 relaunch tests** pass on tip: core 58+3, Claude 25, runtime 18+5, CLI 12+8. This includes the four requested Bash cursor/PS2 cases, real second-window token exclusion, both nested cases, real signal-child tests, EIO/conflict/removal settlement probes, and held/late confirmation probes. The new tests still miss the four findings above.

I built an offline `554facd9` archive and ran r2 tests there. Adapters changed only old API shapes: core getPaneState/runInPane, runtime runInPane's argument position, Claude context.launchedAt as a Date, and initial second-window expectations for the older record fields. These are the measured failures, not an unadapted missing-method claim:

| Target on r1 | Result and reason |
| --- | --- |
| Core M-2/M-3/M-7 selection | 7 fail: real child PID differs (1012227 vs direct child 1012224); both settlement warnings absent; rmSync EISDIR masks failed-start settlement; three held/late-runtime/probe tests time out at 5000 ms. |
| Claude ownership/budgets/settings selection | Second-window side ID changes from 11111111-2222-4333-8444-555555555555 to bbbbbbbb-cccc-4ddd-8eee-ffffffffffff; no-token hook wrongly records; slow tmux exceeds budget; open stdin times out; async settings assertion fails. |
| Claude fast-reuse test, separately with the correct Date adapter | Fails by returning the earlier ID rather than id:null. An initial numeric-Date adapter failed with getTime is not a function; corrected and rerun before claiming this evidence. |
| Real Bash shell cases | 3 fail, 1 passes: start executes owner text before cursor, middle executes owner suffix, PS2 does not run launch. End-of-line passes on r1, as expected. |

The 0700 assertion is a coverage addition, not a production change from r1, so it should already pass on r1.

**Measured surviving partial fix:** in a separate tip archive, remove only `|` from isExecableCommand's unquoted forbidden-operator set (`";&|<>(){}"` -> `";&<>(){}"`). All **129** relaunch tests still pass (core 61, Claude 25, runtime 23, CLI 20; exit 0). This incomplete parser accepts `false || agent` as execable; a script running `exec false || agent` replaces itself with false, losing the fallback. The existing compound oracle covers && only. Production has the correct pipe rejection; this is a demonstrated test gap, not a production finding. I restored that scratch source to the exact tip before the separate M-6 probe.

The author's changed-oracle list agrees with the diff: only the five r1 relaunch test files were changed; two additional test files are new. Core adds exec/mode/token/pane context; Claude removes time-tolerance acceptance in favor of exact-token rejection and expects async settings; runtime changes getPaneState to all-window listPanes and pins pane-ID/C-c sequencing; CLI pins immediate warnings and unknown messaging. Those changes follow the intended fixes. Existing unrelated oracles were not weakened. The public core index is unchanged from base and exports additions through types; no existing export was removed.

## Gates and regression scope

Every package-manager command used HUSKY=0, NPM_CONFIG_OFFLINE=true, the cached pnpm 9.15.4, and a curated link directory on PATH. Installation used `--frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3`. The full gate PATH contained no agent binary, npm or npx. gh was a stub answering only --version/auth status. The initial tmux shim always added `-L aorlr2-review`; real-shell tests further selected their private -S sockets.

| Gate on 0aa13578 | Result |
| --- | --- |
| Frozen offline install | Exit 0 |
| pnpm build | Exit 0 |
| pnpm typecheck | Exit 0 |
| pnpm lint | Exit 0; exactly 5 known warnings |
| Full pnpm -r --no-bail test, corrected harness | Exit 0; **3728 passed, 1 expected fail, 29 skipped** |
| SAME_ID_DEFECTS=red, all 9 packages with matching files | Expected nonzero; **R1 0, R2 16, R3 6, R4 0 failures** |
| gitleaks git --log-opts=3e366a01..0aa13578 --redact | Exit 0; **13 commits scanned, no leaks** |

Lint warnings: spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:2680 and :2687; plus ESLint's existing .eslintignore migration notice.

| Package | Passed | Expected fail | Skipped |
| --- | ---: | ---: | ---: |
| core | 1685 | 1 | 0 |
| cli | 393 | 0 | 0 |
| agent-claude-code | 343 | 0 | 0 |
| agent-codex | 307 | 0 | 0 |
| agent-gemini | 88 | 0 | 0 |
| agent-opencode | 363 | 0 | 0 |
| runtime-tmux | 92 | 0 | 0 |
| runtime-herdr | 73 | 0 | 0 |
| workspace-worktree | 85 | 0 | 0 |
| scm-github | 140 | 0 | 5 |
| tracker-github | 42 | 0 | 0 |
| notifier-desktop | 26 | 0 | 0 |
| integration-tests | 91 | 0 | 24 |

No difference from the author's 3728/1/29. Against r1 review's 3690/1/29: core +18, CLI +2, Claude +7, tmux +11 = **+38**.

There was an earlier invalid full attempt: my scratch git link accidentally targeted the host AO wrapper from command -v. With no underlying real git on that PATH, fixture setup failed: 53 core tests and 2 worktree tests failed, and two integration suites lost their fixtures (78 passed/37 skipped there). This was a harness failure. I replaced the link with /usr/bin/git and reran the complete gate successfully before creating native HOME transcripts. No product source was changed to pass it. An initial native second-window fixture lacked AO_SESSION and closed its only second pane prematurely; it was corrected to native-two with explicit session inheritance. The ordering probe was likewise repeated using an explicit idle shell/environment. Findings cite only the completed probes.

Regression evidence consists of the complete existing suite plus native external new/continue, own-pane signal/exit, built session ls and session kill. The native dm-2 kill succeeded and archived it. Spawn/start token generation has dedicated tests; restore, kill, start/stop, direct-send routing and the retained plugin suites pass. I did not run a new scratch ao start/spawn lifecycle daemon, a native stop from a live own pane, every retained agent binary, or Herdr. Lifecycle kill/grace checks used the real in-process lifecycle manager, not a daemon. This is not a claim of native coverage of every unchanged path.

## Correct changes

- Explicit resume UUID lookup, exact launch-token comparison, and rejection of old/missing bindings remove the original newest-transcript and 5-second-incarnation errors.
- Script quoting, environment-name validation, mode 0700, workspace cd and self-removal are retained; mode is now pinned.
- Fixed `%N` targets remove the active-selection race for runtime typing calls.
- Exec plus direct-child signal forwarding works for the supported own-pane form.
- Settlement uses own-claim comparisons, immediate warnings and later retries; held/late confirmation is bounded and unknown preserves launch evidence.
- PostToolUse settings survive, unsupported resume/runtime paths refuse, and stable core exports remain additive.

## Cleanup

Cleanup evidence is appended below after stopping owned processes and removing scratch data.

All owned native panes belonged to server **1000395**, whose `/proc/1000395/environ` was checked for `HOME=/tmp/aorlr2/home` before shutdown. No scratch ao start/spawn daemon was created, and the final process inventory contained no lifecycle worker. The in-process lifecycle probe ended normally. After private-server shutdown, the `/proc/*/environ` inventory for HOME under `/tmp/aorlr2/`, excluding the scanner and zombies, returned:

```text
OWN PROCESSES []
private server check 1 no server running on /tmp/tmux-44402/aorlr2-review
protected worker exists 4027448 true
protected worker exists 4027591 true
```

Real-shell tests removed their private socket directories and servers in their teardown; `find /tmp/aorlr2 -type s` returned nothing before removal. The remaining dead `aorlr2-review` socket was removed after its server check. `/tmp/aorlr2` was removed, and a final existence check returned `SCRATCH_REMOVED`. Protected workers were never signalled. No unowned pane was read.

The required real-state check was:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aorlr2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed exactly:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2224
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2225
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-69
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

The Nexus directory and nex-orchestrator/nex-2224/nex-2225 records are external Nexus fleet writes. The agent-orchestrator directory and ao-63/ao-65/ao-69/ao-orchestrator records are external AO fleet writes. None is in a state root used by this review; all executed AO/Node/test commands used a clean scratch HOME. Exact external writer PIDs cannot be inferred from mtimes. I did not read those record contents or write them.

`ls -la --time-style=full-iso ~/.ao/bin` was byte-identical at the start and after the native cleanup. Both listings were:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final tracked-source diff is empty. Only the requested review/report artifacts and the supplied brief are untracked. No commit or PR was made, as the review brief requires.
