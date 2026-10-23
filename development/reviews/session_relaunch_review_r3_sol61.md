NOT-LAND-SAFE

Reviewed `3e366a01..9e501603`, focusing on `0aa13578..9e501603`, on 2026-10-22 EDT. HEAD was verified as `9e501603`. **0 blocking, 3 new major, 0 new minor findings; r1 M-6 remains open by design.** The corrected landing gates pass. The original four r2 reproducers improve substantially, but screen contents still do not establish empty shell input, the conversation pointer can still become stale within one launch, and two runtime readers disagree about a pane moved to another session. These findings independently prevent a land-safe verdict, even if the owner accepts M-6.

Requirements, note 1, both previous reviews, the r3 brief, the complete production diff, relevant callers, DEVELOPMENT.md, and CLAUDE.md were read before the author's r3 report. This is a review only. No tracked production or test file was edited in this worktree; no commit, fetch, rebase, push, PR, network request, real agent/model turn, or `ao send` was made. Additional tests and mutations used archives under `/tmp/aorlr3`. The requested review and watcher report are the only authored worktree artifacts.

## Prior findings

Identifiers in these two tables refer to the earlier reviews. The M-n identifiers in the next section belong to this review.

| r1 finding | State on r3 | Independent evidence |
| --- | --- | --- |
| M-1: another pane overwrites the conversation | Original ownership defect closed; reader alignment partly closed | The random token goes only to the agent command, not the tmux session environment. Second-window and both nested-Claude tests pass. Fixed `%N` typing and bound-pane liveness pass. Runtime output/messaging still follow a moved pane into another session (new M-3); direct CLI send still follows the selected pane. |
| M-2: signal ends wrapper while agent survives | Closed for supported simple commands | Actual built own-pane CLI: SIGTERM to AO PID 2345655 alone ended its child 2345671, shell rc 143; SIGHUP to AO 2348572 alone ended child 2348617, rc 129. Exact caller HOME was checked before each signal. Both records had cleared claims before signalling. Compound own-pane launch commands refuse before claiming. |
| M-3: failed settlement holds a live claim | Closed when writes can recover | Conflict/EIO/later-retry/script-removal tests pass. Warnings are immediate, settlement compares its own claim under the record lock, and retries do not keep an otherwise ending process alive. Persistent filesystem failure still cannot guarantee a successful write; the warning describes that limit. |
| M-4: 5-second timestamp tolerance accepts old incarnation | Closed | Exact random-token matching replaces time tolerance. Fast-reuse, no-token, wrong-token and wrong-pane tests pass. The same-launch freshness problem is distinct (new M-2). |
| M-5: C-u leaves owner's suffix | Partly closed | Real Bash start/middle/end/PS2 cases pass, and ordinary ignored/consuming SIGINT traps now refuse. A prefilled trap input still passes the screen test and is submitted (new M-1). |
| M-6: restore/kill already in flight | Open by design | New controlled probes on tip core source, separately holding an earlier restore and kill in runtime.destroy, both produce relaunch running=true followed by agentRunning=false after release. Their later record checks report replacement but cannot undo the destruction. |
| M-7: unbounded confirmation probe | Closed for start/confirmation | Held/late runtime and process checks settle within their confirmation bound. Unknown keeps new launch evidence and clears the claim. Preparation and postLaunchSetup have separate bounds. |
| m-1: synchronous startup hook delay | Closed for startup latency | Installed hook settings remain async:true, timeout:5 seconds. Open stdin and slow tmux tests pass. This is not proof of conversation freshness when an async hook fails. |

| r2 finding / requested correction | State on r3 | Independent evidence |
| --- | --- | --- |
| M-1: launch bound pane, then declare it dead | Original reproducer closed; broader readers partly closed | Native built relaunch into `%12`, while `%13` stayed selected, returned running=true. Built process check=true, activity=idle rather than exited. After aging restoredAt and launchTokenAt together beyond grace, two actual in-process lifecycle polls retained working. The stored handle remained unbound; sm.get supplied data.agentPane=%12. New M-3 and the direct CLI send gap remain. |
| M-2: ignored/trapped SIGINT | Original reproducers closed; safety claim partly closed | `trap '' INT` with text before the cursor and with C-a, and a consuming `read` trap, all refused without a launch marker or owner marker. New M-1 passes this check with a different reading trap. |
| M-3: delayed old hook replaces newer clear | Specified delay-after-hook-entry reproducer closed; event-order guarantee partly closed | The actual exported hook with startup delayed 1.4 s in tmux and clear dispatched 100 ms later kept clear=B. Delaying startup before its hook body begins, or simulating a backward clock step, returned startup=A instead. A failed clear also leaves A acceptable (new M-2). |
| M-4: missing stored pane becomes sole unrelated pane | Closed | Closed stored `%12`, leaving only idle `%13`. Both continue=false and true refused with the missing-pane reason and recovery action; record bytes and remaining-pane capture stayed identical. |
| Surviving `|` partial fix | Closed | Reapplying the exact removal now fails the `false || mock-agent` and `mock-agent | tee log` tests: 2 fail, 10 pass in the operator selection. Those tests correctly pass on r2 because its production parser already rejects pipes. |
| Deadline / hook budgets / token / Linux docs | Substantially corrected | Docs now distinguish 15 s start/confirmation from 10 s preparation and postLaunchSetup, name the bounded external commands and the unbounded fallback without timeout, state token visibility and Linux /proc dependence, and describe foreground-only own-pane use. Claims that all reading traps lack a prompt and that missing hook prerequisites imply continuation refusal need qualification (M-1/M-2). |
| Background own-pane use | Closed in the shipped CLI | Actual built CLI `session relaunch dm-own & wait $!` in its own pane exited 1 with the foreground recovery instruction, leaving record bytes unchanged. Core's undefined callerForeground remains the documented unchecked optional API case. |

## New findings

### M-1 — The screen test treats prefilled trap input as the prompt and submits it

**Code:** `packages/plugins/runtime-tmux/src/index.ts:164`, `:198`, `:185` (emptyPromptProblem / freshPromptProblem); `:571` onward (snapshot evidence and typing). CLI help and DEVELOPMENT.md repeat the resulting empty-input guarantee.

The first snapshot labels *all text before the cursor* as the prompt. A second matching line does not establish that this text is a prompt or that Bash is reading a primary command. Bash `read -e -i` in a SIGINT handler can reproduce the same text, including an unsubmitted input buffer. The foreground-process-group check also passes: the handler runs in the pane's shell.

**Native reproducer on the built runtime, Bash 5.2 / tmux 3.4**, in a clean private pane:

```bash
PS1='P> '
trap 'printf "\n%s" "$PS1"; read -e -i "touch /tmp/aorlr3/trap-owner; " -r x; eval "$x"' INT
```

From outside, call the built `runtime.runInPane(handle, paneId, 'touch /tmp/aorlr3/launch-prefill')`. It **resolves successfully**, and **both markers exist**. No human submitted the prefilled text. Capture of `%19`:

```text
P> ^C
P> touch /tmp/aorlr3/trap-owner; ^C
P> touch /tmp/aorlr3/trap-owner; touch /tmp/aorlr3/launch-prefill
```

A simpler handler, `trap 'printf "\n%s" "$PS1"; read -r x; printf "%s" "$x" > /tmp/aorlr3/trap-stole' INT`, also passes: runInPane resolves, the launch marker is absent, and trap-stole contains the launch line. The core's later process confirmation can detect that second failed start, but it cannot undo the first case's execution of the prefilled input. This is more than an unmeasured possibility that a trap prints PS1.

**Required:** establish shell input ownership/state by a mechanism that does not infer the prompt from arbitrary text before the cursor, or refuse this external typing path when that state cannot be established. Restricting the shell name to Bash does not fix this Bash counterexample. Add both native trap cases; qualify the help/docs claim until the actual guarantee holds.

### M-2 — Hook start time and a surviving side file do not identify the current conversation

**Code:** `packages/plugins/agent-claude-code/src/index.ts:337` (clock sample), `:412` (early no-flock exit), `:423` (timestamp comparison), `:1428`–`:1460` (lookup accepts a same-token/same-pane pointer without current-event evidence).

The lock correctly serializes compare-and-replace after hook entry. The timestamp orders hook body starts, rather than the agent's events. It also uses a wall clock. A hook which skips recording does not invalidate an earlier record of this same launch. Consequently a well-formed, same-launch, same-pane transcript can still be obsolete after `/clear`, while --continue accepts it as current.

**Native probes of the actual exported hook and built lookup:** one claude-named stand-in PID **2283058**, terminal `/dev/pts/30`, private pane `%14`, one unchanged UUID launch token, both A and B transcripts present. A=`11111111-1111-4111-8111-111111111111`, B=`22222222-2222-4222-8222-222222222222`.

| Scenario | Result |
| --- | --- |
| Original r2 reproducer: A/startup waits 1.4 s in its tmux call; B/clear starts 100 ms later | Correct: record and lookup retain B. |
| A/startup's dispatched wrapper waits 1.4 s **before execing the hook's bash**; B/clear begins after 100 ms | Record ends at A/startup, eventAt=1792717933011989; lookup returns A. The later-starting hook body is mistaken for the later event. This is a controlled async-dispatch scheduling probe, not a measured Claude scheduler trace. |
| A/startup succeeds; B/clear invokes the same hook with a curated PATH containing all its tools except flock | Hook exits 0 and leaves A untouched; lookup returns A. This falsifies “without flock ... --continue refuses” once a same-launch record already exists. No clock manipulation is needed. |
| A/startup samples 1792729999.500000, then B/clear samples 1792729998.500000 | Record and lookup retain A. Clock regression was simulated locally by unsetting Bash's special EPOCHREALTIME and supplying these values when sourcing the **unchanged** hook. The host clock was never changed. |

The missing-flock case also illustrates other skipped/failed bookkeeping paths, although those additional failures were not separately injected here. A fresh empty fixture in the no-flock test proves only that no first record is created; it does not prove that an existing pointer becomes untrustworthy.

**Required:** establish or validate the agent's current event/conversation, or mark an ambiguous/failed update unusable and refuse continuation. An ordering source must be tied to event dispatch rather than an independently scheduled hook's wall clock. Cover existing-pointer failure, delayed entry, and clock reversal. The documented residual is still a violation of the requested current-conversation behavior, not a closure of it.

### M-3 — Runtime output and messaging follow a moved bound pane into another session

**Code:** `packages/plugins/runtime-tmux/src/index.ts:378`, `:419`; `packages/core/src/tmux.ts:76` (agentPaneTarget). Compare the ownership check in `agentPaneTty` and the explicit belongs-to-session check in runInPane.

Agent liveness verifies that `%N` still belongs to `handle.id` and returns false when it does not. getOutput and sendMessage use that global pane ID without checking its session. A tmux pane ID survives a move to another session. Thus the same stale handle reads as “agent absent” in one reader and still captures/types into the other session in another reader.

**Native built-plugin reproducer:** create private sessions move-source (two panes) and move-target; bind handle `{id:'move-source', runtimeName:'tmux', data:{agentPane:'%15'}}`; move `%15` with `join-pane -s %15 -t <move-target-pane>`.

```text
moved membership: move-target %15
claude-code isProcessRunning(handle): false
runtime.sendMessage(handle, 'touch /tmp/aorlr3/moved-message'): resolves
moved-message exists: true
runtime.getOutput(handle): bash-5.2$ touch /tmp/aorlr3/moved-message ...
move-source current screen: bash-5.2$
```

No ao send was run. The send was the runtime API, using an otherwise ordinary handle which explicitly names the source session. The message executed in the moved pane's shell. Lifecycle terminal recording calls runtime.getOutput before its agent activity check, so the changed output behavior is also reachable through an ordinary reader; this was a direct plugin probe, not a claim that every sm.send flow bypasses its preceding liveness checks.

**Required:** make bound-pane runtime output and sends obey the same session-ownership rule as liveness and runInPane, retaining reject-on-unknown behavior for an attempted send. Test a moved pane for both readers, including the lifecycle recording path. Binding a global pane ID alone is insufficient.

## Native checks and scope

All native AO/Node calls used env -i, HOME=/tmp/aorlr3/home, TMPDIR=/tmp/aorlr3/tmp, CI=1, HUSKY=0, NPM_CONFIG_OFFLINE=true, and a scratch link PATH. The tmux shim always added `-L aorlr3-review`; tests added their private `-S` sockets. No default-server command or unowned pane read was made. Agent stand-ins existed only on native fixture paths, outside the full gate PATH. The CLI entry was the built `packages/cli/dist/index.js`, never a TypeScript entry. No native start/spawn lifecycle daemon was created; lifecycle checks used the real manager in process.

The M-1 native fixture initially omitted its token keys because writeMetadata serializes a fixed schema. That attempt refused before claiming because it had two panes and no binding. I corrected the fixture with updateMetadata, as the production code and tests do; the reported successful run and missing-pane check use that corrected fixture. This was a fixture correction, not a source change. The first M-6 mock held isAlive=true after destruction; I corrected it to track destruction/creation before claiming the final evidence below.

Real Bash cursor start/middle/end/PS2, two-line prompt, full-history, ignored SIGINT, consuming SIGINT and foreground-job checks pass in the shipped native test suite. My independent ordinary-prompt runs succeeded for Bash 5.2, sh, dash, and BSD csh (`/proc/<pid>/exe` confirmed /usr/bin/bsd-csh). The independent ignored/consuming-trap reproducers typed nothing. zsh, fish, ksh, mksh and tcsh were unavailable and were not installed; their behavior remains unvalidated. Default prompt success for a shell is not proof for its trap or editing configurations.

The multi-window native run launched the stand-in in `%12`, with `%13` selected throughout. Confirmation took about 5 s, consistent with Claude's preflight-negative ps cache. After the binding was aged beyond grace, both polls retained working; runtimeHandle in the record stayed unchanged. The missing-pane tests then closed `%12`, with exactly one idle `%13` left, and verified byte-identical record and capture for both continue modes.

Actual built own-pane CLI background refusal passed without a record write. Foreground signal tests passed after confirmation/settlement, with AO RSS **92552 kB** and **93128 kB** (about 90–91 MiB). The child PIDs equalled the agents after exec. HOME was checked before signalling only the AO PIDs I started. No real worker was signalled.

Regression evidence: the complete retained suite passes, including ordinary spawn, restore, kill, status/start/stop, lifecycle, direct-send routing, all four retained agents, Herdr, and PostToolUse hook tests. Diff inspection confirms that a handle without agentPane takes the old liveness/output/send target; Herdr branches and runtime-herdr are unchanged. OpenCode has prepareAgentSession and is refused by relaunch, so its process readers were not changed. I did not run real agent binaries or a native Herdr process, nor a separate live spawn/restore/send matrix for every plugin. These are unit/integration and code-path conclusions, with the native scope stated above.

The public core API is additive: six new tmux exports, optional relaunch/runtime/agent interfaces and error/result types; no existing core export was removed or replaced. Restore invalidates lastLaunchBinding by moving restoredAt without moving launchTokenAt; archive copy-back omits the binding keys. The PostToolUse update behavior remains intact. No new network behavior was found in the feature paths.

## Tests and mutation evidence

An offline-built `0aa13578` archive received the tip's changed test files. The only API adapter defined AGENT_PANE_FORMAT locally in the three new agent-pane unit files, because the base core does not export it. Production source was not adapted. Test timeout was raised to 40 s so the base could complete its real 15 s confirmation loop. Results:

| Base selection | Result | Failure meaning |
| --- | --- | --- |
| Core relaunch + tmux-foreground | 9 fail, 74 pass | 4 bound/first-pane tests (false absence, absent handle binding, or erroneous launch), both missing-bound-pane refusals, both background cases, and send readiness `%5` vs `=rt-1:`. |
| Claude agent-pane + native agent-pane + conversation | 10 fail, 30 pass | 5 bound-pane unit cases; native other-window process lookup; missing eventAt oracle; both ordering/lock tests; no-flock test. |
| Codex agent-pane | 5 fail, 5 pass | Bound-pane target, another-pane exclusion, missing/moved pane, malformed answer. |
| Gemini agent-pane | 5 fail, 5 pass | Same causes as Codex. |
| Runtime relaunch-pane + real shell | 18 fail, 23 pass | 3 real traps resolve instead of refusing; changed call sequence; 2 bound output/send targets; 9 new snapshot units lack the new functions; other runtime refusal/failed-type oracles. |
| CLI relaunch command + terminal helper | 5 fail, 18 pass | Help/foreground argument expectations and missing callerInForeground. |

The agent wildcard also selected OpenCode, which has no matching test files and reported “No test files found”; that package contributes no test failure count above. The tests covering unquoted pipe rejection pass on this base, correctly: they add missing coverage for behavior already present in r2. Failure of the missing-function snapshot/helper cases alone is not behavioral proof; the real shell/core/native process cases supply it.

**The prior `|` gap is closed:** removing `|` from `";&|<>(){}"` in a separate scratch source makes the two pipe cases red (2 fail, 10 pass, 66 filtered out). This reproduces the exact partial fix from r2.

**A surviving partial fix:** in a different scratch tip build, weaken only isTmuxPaneGone's exact diagnostic equality to `diagnostic?.includes(\`can't find pane: ${paneId}\`)`. All **210 relaunch/pane/readiness tests still pass**: core 86, Claude 40, Codex 10, Gemini 10, runtime 41, CLI 23. The malformed-bound-pane diagnostic below is rejected by tip but accepted as definitive absence by the mutant:

```js
{ code: 1, signal: null, killed: false,
  stderr: "warning: server connection failed\ncan't find pane: %2\n" }
// isTmuxPaneGone(error, "%2"): tip=false, mutant=true
```

This is a demonstrated coverage gap in the new bound-pane absence path, not a claim that the production helper has this mutation. Existing R4 near-miss tests exercise the unbound path and do not pin the new helper's whole diagnostic. The native failures M-1 through M-3 require no mutation.

## Changed oracles and documentation

The author's section 5 list matches the diff:

1. Runtime typing sequence grows from 5 to 8 calls, adding the two snapshots and second C-c; failed literal typing grows from 4 to 7 calls and still sends no Enter.
2. Hook-record equality adds numeric eventAt; jq/timeout-less tool fixture now includes flock.
3. CLI help expectations change for missing pane, Linux, foreground use and conditional prompt evidence; whitespace normalization accommodates wrapping.
4. Successful CLI invocation now expects callerForeground to be passed.
5. New behavior oracles target `%N` for bound liveness/output/messages/readiness and treat a moved bound pane as absent in process checks. Their unchanged-handle controls retain the former current-window target.
6. The existing tmux-foreground file adds a fifth test; the new core/agent/shell/helper/operator tests expand coverage without deleting unrelated behavior checks.

The changed expectations follow the intended fixes; I found no unrelated weakened oracle. They are incomplete at the boundaries measured above. DEVELOPMENT.md's separate “Absence forms of the R4 reads” table still describes row 10 as the unbound `=<name>:` read and lists “can't find pane” under rejections. Its new bound-pane variants for Codex/Gemini should be stated explicitly so the table remains a complete contract; the relaunch section describes them separately. This documentation mismatch is an editorial follow-up, not an additional counted finding.

## M-6 and the author's open questions

M-6 remains an unmet R-3 exclusion requirement. I tested both earlier-operation orders in scratch against tip core source: pause restore or kill after it has entered runtime.destroy, relaunch successfully, release destruction. Both assertions observe running=true then agentRunning=false. The corrected restore probe ends with “runtime ... was kept because the record now there may own that runtime name”; the kill probe reports the replaced record and keeps its worktree/agent record. Later conservative cleanup does not reverse the earlier interruption. This is fault injection over real session-manager code with mocked runtimes, not a native tmux race.

The updated docs and report design note correctly require a shared CAS claim in **both restore and kill**, before awaited destructive/allocation work, held through later checks and released only by its owner on every end path, including delivery-to-restore and write-retry paths. No metadata lock should span those awaits. The existing six R3 red tests do not prove this protocol. The owner can explicitly accept that limit; this review's new findings remain even then.

| Author question | Assessment |
| --- | --- |
| 1. M-6 | Open, correctly documented, independently reproduced in both orders. |
| 2. Spawn stores no pane | Conservative multiple-pane refusal is sound. Persist the actual creation pane in a future scoped change; closing panes is a manual migration, not a proof about a lost stored pane. |
| 3. Direct `ao send` | Still a material integration gap: send.ts:349–363 uses `exactPaneTarget(tmuxTarget)` for a live tmux session, bypassing sm.send and its binding. Selecting another idle shell can therefore receive/execute a message even after successful relaunch. This is established by the unchanged route, not a prohibited ao send run. Use the bound pane in this shipped path or clearly constrain use until it is aligned. The documented /exit gap warning remains valid. |
| 4. Other shells | Limit advertised support to measured configurations or add native checks for each admitted shell. Bash-only admission alone does not repair M-1. Four available command names passed ordinary prompts; the five unavailable ones remain unmeasured. |
| 5. Prompt-printing traps | Concrete counterexample now measured, including execution of prefilled text and silent consumption at the runtime API: M-1. |
| 6. Wall clock / hook entry / prerequisites | Concrete stale-pointer results now measured: M-2. flock fixes write serialization, not event provenance or failed-update freshness. |
| 7. Old hook records after kill | Exact launch token prevents accidental cross-incarnation reuse. Stale files/lock files remain a housekeeping cost. Same-launch stale pointers are the separate M-2 problem. |
| 8. Five-second ps cache | External confirmation in the native fixture took about five seconds after the preflight negative. A short own-pane agent can exit before observation; the current code then reports absent and restores old binding keys, making the new hook token unusable for continuation. The latter follows from childEnded plus settle(absent); I did not run an additional short-lived-agent probe. A fresh post-launch check or explicit cache invalidation would avoid this new-operation false negative without abandoning shared lifecycle caching. |
| 9. Existing limits | 60 s grace and no task-prompt redelivery are explicit behavior choices. Restore's newest-jsonl selection and lost orchestrator prompt are unchanged paths. PostToolUse timeout:5000 remains 5000 seconds, not milliseconds; it is pre-existing. |

## Gates on 9e501603

Every pnpm invocation used cached pnpm 9.15.4, HUSKY=0 and NPM_CONFIG_OFFLINE=true under env -i. Installation used `--frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3`. PATH was a link directory, with real /usr/bin/git, a gh stub permitting only --version/auth status, and the private-server tmux shim; it contained no npm, npx, agent, herdr or ao executable.

| Gate | Result |
| --- | --- |
| Frozen offline install | Exit 0 |
| pnpm build | Exit 0 |
| pnpm typecheck | Exit 0 |
| pnpm lint | Exit 0; exactly 5 known warnings |
| Corrected full pnpm -r --no-bail test | Exit 0; **3805 passed, 1 expected failure, 29 skipped** |
| SAME_ID_DEFECTS=red on all nine applicable packages | Expected nonzero; **R1 0, R2 16, R3 6, R4 0** failures |
| gitleaks git --log-opts=3e366a01..9e501603 --redact | Exit 0; **23 commits scanned, no leaks** |

Lint warnings are spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:2700 and :2707; ESLint also emits its existing .eslintignore migration notice.

| Package | Pass | Expected failure | Skip |
| --- | ---: | ---: | ---: |
| core | 1706 | 1 | 0 |
| cli | 396 | 0 | 0 |
| agent-claude-code | 358 | 0 | 0 |
| agent-codex | 317 | 0 | 0 |
| agent-gemini | 98 | 0 | 0 |
| agent-opencode | 363 | 0 | 0 |
| runtime-tmux | 110 | 0 | 0 |
| runtime-herdr | 73 | 0 | 0 |
| workspace-worktree | 85 | 0 | 0 |
| scm-github | 140 | 0 | 5 |
| tracker-github | 42 | 0 | 0 |
| notifier-desktop | 26 | 0 | 0 |
| integration-tests | 91 | 0 | 24 |

No difference from the author's 3805/1/29. Relative to r2's 3728/1/29: core +21, CLI +3, Claude +15, Codex +10, Gemini +10, runtime-tmux +18 = **+77**. The expected failure and skips match baseline.

Harness corrections: the initial pnpm symlink pointed to nonexistent bin/pnpm.cjs and did not execute; it was corrected to cached bin/pnpm before install. The first full run had **3801 pass and 4 failures** in unchanged GH_WRAPPER tests, each returning 141 because the curated PATH omitted tee. Adding the /usr/bin/tee link and rerunning the full suite produced the clean result above, before native transcript fixtures. No product source was changed to obtain it. An initial same-id selection omitted the red environment flag; the separately quoted run set it explicitly and counted the expected 22 tagged failures.

## Correct changes

- Agent-pane propagation fixes the original cross-window launch/confirmation/lifecycle defect while retaining old behavior for unbound handles and the Herdr branch.
- A missing stored pane refuses before the claim, without falling back to a remaining unrelated pane.
- Exact random launch tokens and explicit transcript IDs preserve cross-incarnation ownership; no newest-file guess is used by relaunch.
- The parser rejects pipes and other operators for exec; the former pipe-coverage gap is now pinned.
- Child exec/signal supervision, claim-aware settlement retries, bounded confirmation and immediate warnings retain the earlier fixes.
- Script permissions/quoting, additive public exports, PostToolUse settings preservation, foreground-only CLI refusal, and the updated M-6 design are sound within the stated scope.

## Cleanup

Cleanup evidence follows after ending the private server and checking owned processes.

The private server PID was **2243719**. Before shutdown, its `/proc/2243719/environ` was checked for `HOME=/tmp/aorlr3/home`. The owned-process inventory showed no scratch lifecycle worker; no native start/spawn daemon had been created. The server was then stopped through the isolated shim. The inventory excludes the scanner itself and zombies:

```text
server HOME verified 2243719 HOME=/tmp/aorlr3/home; lifecycle workers []
OWN PROCESSES []
PRIVATE SERVER CHECK 1 no server running on /tmp/tmux-44402/aorlr3-review
PROTECTED PIDS UNTOUCHED 4027448 true 4027591 true
```

Tests removed their private -S servers/sockets in teardown; `find /tmp/aorlr3 -type s` printed nothing. The dead socket for aorlr3-review was removed after the no-server check. No protected PID or unowned session was signalled.

The required real-state check, run after process cleanup, was:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aorlr3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed exactly:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2234
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/archive
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/.generations
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2230
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-72
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
```

Ownership of every printed path: under `6513108c38cb-Nexus`, the sessions directory, archive directory, .generations directory and nex-2234/nex-orchestrator/nex-2230 records are external Nexus fleet writes. Under `60756641ca25-agent-orchestrator`, the sessions directory, archive directory, .generations directory and ao-72/ao-63/ao-65/ao-73 records are external AO fleet writes, including lifecycle bookkeeping for this managed reviewer session ao-72. None is a state root used by any review probe. Exact external writer PIDs cannot be inferred from mtimes; I did not read or alter those record contents. All executed AO/Node/test processes used clean scratch environments.

`ls -la --time-style=full-iso ~/.ao/bin` was identical at the start and after cleanup:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0400 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

`/tmp/aorlr3` was removed after preserving this review's evidence. The final directory check returned `SCRATCH_REMOVED`. HEAD remains `9e501603`, tracked-source diff is empty, and only the supplied task, requested watcher report and review file are untracked. No commit or PR was made, as required by this review brief.
