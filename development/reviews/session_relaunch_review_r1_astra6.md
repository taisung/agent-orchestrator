# Session relaunch review r1 — ao-64

NOT-LAND-SAFE

Reviewed `3e366a01..554facd9274c668fd476ef9a58faad034d7b82a0` on `review/session-relaunch-r1`, 2026-10-22. **0 blocking, 7 major, 1 minor finding.** Landing gates pass with the expected baseline failures. The new command can resume another pane's conversation, return the terminal while its agent survives, and retain a live claim that prevents stopping the session. Changes are required before landing.

The author brief, note 1, stopgap docstring, all production changes and all five new test files were read before the author's report. No production source was changed. Additional probes/mutations ran in scratch archives; native checks used this worktree's built JS, private tmux servers and stand-ins. No real agent, model turn, network request, `ao send`, commit, push or PR.

## Findings

### M-1 — Another pane overwrites the session's own conversation

**Code:** `packages/plugins/agent-claude-code/src/index.ts:367` (TTY check), `:378` (replacement); `packages/plugins/runtime-tmux/src/index.ts:296` (pane lookup).

The hook compares the agent's stdin with the terminal of **its own inherited TMUX_PANE**. A new window/pane gets a new TMUX_PANE and inherits the AO session environment. An independently started Claude there has no Claude ancestor and passes both checks. Nothing binds that pane to the AO agent's original pane or launch. Atomic replacement prevents torn writes, not wrong ownership.

**Native reproducer:** spawn the scratch orchestrator, then `tmux -L aorlr1-live new-window -d -P -F '#{pane_id}' -t '=1aa936b8b74f-dm-orchestrator' -c /tmp/aorlr1/repo 'claude --model other-pane'`. Original conversation: `ca2c389b-e155-4612-8ae3-4130bf625791`, PID 3656890. New window `%3`, same `AO_SESSION=dm-orchestrator`, replaced it with `5acf5368-d162-4fb4-9350-045be2f1bb34`, PID 3686949. The built lookup returned the second UUID. Reproduced twice.

The new test labelled “another pane” changes stdin while retaining the original fake `TMUX_PANE=%1`; it does not model a real second pane. **Required:** bind the conversation to an authoritative launch and pane identity; test a real second pane/window and both nested-Claude cases. Carry a concrete pane identity through probe and launch, too: the current `=name:` target follows the active window/pane independently on each tmux call, so selection changes can redirect text/Enter after the probe. That selection race is a code finding, not separately live-reproduced.

### M-2 — SIGTERM/SIGHUP ends the wrapper while the agent survives

**Code:** `packages/cli/src/lib/relaunch-terminal.ts:55` (`child.kill(signal)`); `packages/core/src/session-manager.ts:211` (script runs the command without exec).

The direct child is `bash ao-launch-*.sh`, not the agent. Forwarding only to that PID does not forward through the waiting shell. Its exit resolves `exited` and returns the terminal to the pane shell while the agent remains alive.

**Native reproducer:** confirmed own-pane orchestrator continue: ao 3694597 -> launch bash 3694741 -> stand-in 3694745. After checking its scratch HOME, send SIGTERM to **3694597 only**. One second later ao and launch bash were absent, agent alive; pane printed `TERM_RC=143` and `bash-5.2$`. SIGHUP uses the same code. This contradicts the helper's terminal-ownership guarantee. Normal agent exit 7 propagated correctly in a separate run.

**Required:** supervise/signal the actual agent tree, or replace the intermediate shell where the launch-command contract permits. Do not return terminal ownership based solely on wrapper exit. Add a real child/grandchild signal test; mocked `child.kill` cannot detect this.

### M-3 — Three failed settle writes retain a live claim for the agent's lifetime

**Code:** `packages/core/src/session-manager.ts:5050`–`:5096`; `packages/cli/src/commands/session.ts:501`–`:504`.

After three CAS conflicts, or a read/write exception, settle merely records a warning. In the own-pane case ao stays alive for the agent's lifetime, so retained launch keys keep blocking kill, stop/replace and restore. The CLI prints the warning only after the child exits. The report's assumption that the caller “ends a moment later” applies only to external callers.

**Measured fault injection on exact tip source:** permit the claim; return null from all three settlement CAS calls; return a still-pending own-pane child. Result: `running=true`, warning “changed three times”, live `launchPid` remains; `sm.kill('app-1')` throws `SessionLaunchInProgressError`. These assertions pass. This measures the documented retry-exhaustion path, not naturally occurring filesystem contention.

**Required:** a recoverable end state that does not leave the long-lived supervisor holding a launch claim, and promptly visible cleanup failures. Test exhaustion and I/O failure with a live child. Also prevent cleanup errors from bypassing settlement: `rmSync` at `:5126` precedes `settle(false)` without its own guard.

### M-4 — Five-second tolerance accepts a prior incarnation's conversation

**Code:** `packages/plugins/agent-claude-code/src/index.ts:1346`.

The check rejects only `writtenAt < launchedAt - 5000`; it does not identify the record incarnation. A project-mode orchestrator ID reused within five seconds of the old hook write can inherit the old UUID if the replacement hook fails or never runs. Waiting out the launch grace does not change those timestamps.

**Built-plugin reproducer:** new launch `2026-10-22T21:14:14.867Z`; surviving side-file mtime `21:14:11.867Z`, agent `claude-code`, UUID `11111111-1111-4111-8111-111111111111`, matching existing transcript. More than 120 seconds after the new launch, lookup returned that UUID. No plugin code was mocked or changed. The new test explicitly accepts a three-second-old file: this is an insufficient ownership oracle, not missing coverage of the implemented tolerance.

**Required:** compare an exact persisted launch/incarnation token. Do not use a blanket timestamp allowance to compensate for restore publishing restoredAt late. Test rapid ID reuse with a failed replacement hook.

### M-5 — C-u does not clear the owner's partial shell command

**Code:** `packages/plugins/runtime-tmux/src/index.ts:330`–`:336`.

Bash/readline C-u removes only text **before** the cursor. Text after it survives as part of the launch line. A shell foreground name also does not establish a fresh primary prompt; multiline continuation can consume the launch as data.

**Native reproducer:** type without Enter `; echo OWNER_TAIL > /tmp/aorlr1/owner-tail`, then C-a, in a clean idle scratch Bash pane. Call the built runtime's `runInPane(handle, 'echo LAUNCH_ONLY')`. Capture:

```text
bash-5.2$ echo LAUNCH_ONLY; echo OWNER_TAIL > /tmp/aorlr1/owner-tail
LAUNCH_ONLY
bash-5.2$
```

The marker exists. With the normal launch command, that suffix likewise survives and can execute when the agent ends. This submits text the owner had not submitted. **Required:** establish a safe shell input state, covering middle/start cursor positions and continuation prompts, or refuse with recovery instructions. Literal tmux typing does not protect the surrounding shell command. Add real-shell tests.

### M-6 — A restore/kill already in flight is not excluded by the new claim

**Code:** claim `packages/core/src/session-manager.ts:5013`; restore check `:4444` and destroy `:4623`; kill check `:3197` and destroy `:3233`.

The claim protects operations that begin afterward. A restore/kill already past `assertNoLiveLauncher` owns no mutually exclusive operation claim. The metadata lock serializes writes, not awaited runtime destruction. Relaunch can report success before that older operation destroys its pane. This is an existing same-ID limitation exposed to the new command, not a claim that these commits introduced the general restore/kill race. It nevertheless violates R-3's required refusal of an in-progress restore.

**Deterministic core reproducer:** write an old recoverable killed record and existing workspace. Start restore; hold runtime.destroy after entry. Relaunch that ID: `running=true`. Release destruction, making runtime and agent absent. Restore creates a runtime, fails its later record CAS and cleans up. Probe result: one create, agent absent, error “its new runtime was stopped and its record was not written”. Late record checks cannot undo the interruption.

**Required:** shared operation exclusion with restore/kill/start, including the reverse ordering, or a safe refusal when such work is in flight. Add both orders. The pre-relaunch `/exit` gap has no new grace; a configured restoring reaction can already be underway. Expected baseline red tests are not evidence that this new requirement is met.

### M-7 — An awaited post-launch probe defeats the bounded wait

**Code:** `packages/core/src/session-manager.ts:5147`.

Preflight bounds liveness checks; confirmation directly awaits `agent.isProcessRunning` and checks the deadline afterward. A nonsettling probe leaves the command pending with its live claim indefinitely. Even bounded probes can overrun the remaining budget. Claude's ordinary tmux/ps subprocess timeouts reduce exposure for that plugin; they do not supply a bound for the SessionManager API and every supported agent plugin.

**Measured core probe:** preflight false; hold the second process probe unresolved. After actual entry, advance Date.now by 60 seconds. Relaunch remains pending with a live claim. Release false; only then does it settle and return `running=false`. This is a controlled-clock test, not a sixty-second wall-clock wait. The author's timeout test immediately resolves probes and misses it.

**Required:** bound each awaited confirmation by the remaining deadline and reliably settle after timeout. Preserve unknown versus absent semantics when an agent may have started. Test unresolved and late probes after the claim.

### m-1 — Synchronous SessionStart bookkeeping can delay every start by ten seconds

**Code:** `packages/plugins/agent-claude-code/src/index.ts:941` (`timeout:10`, no async), `:318`, `:347`–`:369` (input/proc/tmux without an internal budget).

Installed Claude Code **2.1.308** was inspected as data, never executed. Its embedded command-hook schema says “Timeout in seconds for this specific command”; runner code converts configured values with `timeout * 1000`. The async field explicitly describes background execution without blocking. Thus the new synchronous hook permits ten seconds of startup delay. `exit 0` helps only after control returns. Missing tmux takes the `|| exit 0` path; a slow one is different.

**Native timing:** the installed hook invoked by the stand-in took **2059.8 ms** with a scratch tmux shim delaying display by two seconds. Slow proc utilities or unclosed input have the same in-script lack of a deadline. No real Claude startup ran; blocking behavior follows from the inspected runner/schema and settings.

**Required:** a suitably small failure budget or off-startup bookkeeping, preserving a clear refusal when no trustworthy ID exists. The unchanged PostToolUse `timeout:5000` means **5000 seconds, 83 minutes 20 seconds**, not milliseconds. That is pre-existing, not fixed here.

## Requirements and correct behavior

| Requirement | Assessment | Evidence |
| --- | --- | --- |
| R-1 command/environment | Met for supported paths | Record worker agent/model/permissions retained; handle selects runtime; native worker argv/AO environment match spawn. Orchestrator permissionless mode and regenerated prompt retained. Orchestrators do not persist a spawn model today; ignoring stray worker model keys matches existing role selection. |
| R-2 own conversation | Partly met | Explicit UUID/agent/transcript checks, no newest-jsonl selection, unsupported continue refuses. M-1/M-4 break ownership. |
| R-3 refusals | Partly met | 23-case matrix and unknown probe tests pass; native running refusal byte-identical. Already-started restore escapes exclusion, M-6. |
| R-4 lock/grace | Partly met | Atomic CAS excludes another relaunch; restoredAt supplies 60-second grace; recoverable killed status recovers. M-3/M-6/M-7 remain; `/exit` alone adds no grace. |
| R-5 both callers | Partly met | Both ordinary native paths work; M-2/M-5 break terminal safety. |
| R-6 CLI | Partly met | Help, registration, errors/next actions, failure exits and normal child exit code work. M-7 defeats the bound. |

The launch script uses a UUID under TMPDIR, **0700**, validated environment names, single-quote escaping, workspace cd and self-removal. A separate exact-tip probe executed it with a quote/space in the workspace and an exported value containing quote, newline, literal `$(touch ...)` and backticks: exact roundtrip, no injection, correct mode, file removed. An initial newline-*workspace* fixture failed because the existing line-oriented metadata serializer replaces newlines; the corrected probe isolates the new script. Unexecuted scripts can remain after timeout/SIGKILL: self-removal depends on execution.

The hook uses same-directory temp/rename; quoted values and UUID/source validation do not execute JSON/path text. Tests cover nested Claude with/off pane stdin, malformed identity/no ancestor, no-jq fallback and preservation of user settings. PostToolUse merging remains intact. The jq-less parser is a simple extractor rather than a general JSON decoder; no shell injection was found. `/proc` dependence limits recording and own-pane detection to Linux. Descriptor equality also does not prove foreground ownership when a caller redirects an fd to the pane TTY; that case was not live-tested.

The public types/methods are additive/optional; unchanged index.ts exports them through `export *`. Ordinary spawn/restore/kill and existing runtime operations were not rewritten; command generation adds resume only when requested. Full regression tests pass, with native ordinary spawn/start/status/kill/stop coverage. This is not native coverage of every plugin. Herdr was neither run nor changed.

## Native evidence on this build

All commands used env -i, HOME `/tmp/aorlr1/home`, scratch config/state and curated PATH without npm/npx. Gate PATH excluded even the stand-in. Servers: `aorlr1-live`, `aorlr1-hook`, and gate shim `aorlr1-tests`. The fixture repository was a local shared clone, with no network or commits. Dates were deliberately aged via updateMetadata between quick repetitions to clear preflight's 60-second grace; actual relaunch grace was exercised by unit tests and live polling.

| Check | Result |
| --- | --- |
| Worker spawn | dm-1, `--dangerously-skip-permissions --model record-model`; config was config-model. |
| Running refusal | rc 1, “its agent process (claude) still runs”, next /exit; record byte-identical. |
| External new | rc 0, PID 3683432, UUID b0544319-f8bb-4da8-8df9-e0a690947d8b; same model/permission argv and relevant AO environment. |
| External continue | rc 0, PID 3684035, same UUID/source resume; spawn argv plus resume UUID. A touched newer different transcript was ignored. |
| Concurrent relaunch | One rc 0, one rc 1 record-changed reason/next; exactly one stand-in start. |
| Own-pane orchestrator | PID 3691536, original ca2c389b-e155-4612-8ae3-4130bf625791; permissionless, config-model, original prompt plus resume. |
| Long prompt | File and argv **9264 bytes**, SHA-256 prefix **fc34bdbab25f**, identical spawn/relaunch; approximately the brief's 9300-byte case, no truncation. |
| Supervisor | ao 3691491 -> bash 3691531 -> agent 3691536; ao VmRSS/VmHWM **93128 kB**, about 91 MiB. |
| Readers | Built isProcessRunning true, activity ready, session working; status and session ls found scratch sessions. |
| Normal exit | Child exit 7 -> OWN_RC=7 and normal shell prompt. M-2 is the signal counterexample. |
| Lifecycle | Worker **3656639**, interval 1000 ms, **215 successful polls, 0 failures**, across external/own-pane runs; settled records working without launch keys. Core two-poll exited-control test passes. |
| Native kill/stop | kill dm-1 rc 0; stop demo with own-pane agent running rc 0; records archived, worker stopped, server gone. |
| SIGKILL confirmation | Caller **3705943** killed by exact PID after new start/hook but before confirmation settled, rc -9; dead claim/restoredAt retained, agent 3705965 running. Subsequent kill dm-2 rc 0. |

The SIGKILL fixture's status was already spawning from a fresh spawn before lifecycle transition; relaunch preserved it. “Never writes spawning” does not mean it cannot leave a spawning record. SIGKILL cannot roll back an already-dispatched command. Spawn dm-2 automatically started scratch worker **3705331**; final stop also stopped it.

Harness corrections: the first stand-in failed to consume the initial spawn prompt, so after it ended Bash read the buffered multiline prompt; three external attempts timed out at continuation input. I cleared only that scratch pane, corrected the stand-in loop and repeated new/continue/concurrency successfully. Editing that running stand-in also caused the old orchestrator script to encounter a read-time syntax error; later own-pane agents used the complete corrected script. No claimed success depends on the broken fixture. M-5 used a separate clean shell.

## Tests and gates

Offline frozen install, build, typecheck and lint: **exit 0**. The five known lint warnings: spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:2523 and :2530. ESLint additionally prints its existing .eslintignore migration notice.

Exactly one full `pnpm -r --no-bail test`: **3690 passed, 1 expected failure, 29 skipped, exit 0**, before native transcripts existed.

| Package | Pass | Expected fail | Skip |
| --- | ---: | ---: | ---: |
| core | 1667 | 1 | 0 |
| cli | 391 | 0 | 0 |
| agent-claude-code | 336 | 0 | 0 |
| agent-codex | 307 | 0 | 0 |
| agent-gemini | 88 | 0 | 0 |
| agent-opencode | 363 | 0 | 0 |
| runtime-tmux | 81 | 0 | 0 |
| runtime-herdr | 73 | 0 | 0 |
| workspace-worktree | 85 | 0 | 0 |
| scm-github | 140 | 0 | 5 |
| tracker-github | 42 | 0 | 0 |
| notifier-desktop | 26 | 0 | 0 |
| integration-tests | 91 | 0 | 24 |

Prior r5 **3604/1/29** -> **+86 = +91 relaunch tests -5 progress-note-fix tests** absent here: this branch starts at 3e366a01, not 13d3a129. Author **3694/1/25** differs by four transcript-dependent integration tests (“path encoding & JSONL reading (real Claude data)”): their fake HOME already held a D3 transcript. Mine did not during the full run. No unexplained difference or additional failure.

SAME_ID_DEFECTS=red ran all matching files in core, CLI and seven applicable plugins: **R1 0, R2 16, R3 6, R4 0 failures**. All 22 are tagged baseline defects; expected nonzero exit. Gitleaks `git --log-opts=3e366a01..554facd9 --redact`: **6 commits, no leaks, exit 0**.

All **91 new tests** pass at tip: core 43, tmux 12, Claude 18, CLI command 11/helper 7. No existing test file/oracle changed. The insufficient new ownership oracles are described in M-1/M-4.

A scratch archive of **3e366a01 plus the five tip test files** gives **84 failing tests**: core 43 missing relaunch/new error class; tmux 12 missing methods; Claude 18 missing hook/lookup/resume; CLI 11 unknown command/missing registration. The seven helper tests cannot collect because relaunch-terminal.ts is absent on base. These are missing-feature failures. The author's relaunch report actually supplies mutation results rather than a numeric base-run claim; those claimed mutation counts are not presented as my measurements.

**Measured surviving partial fix:** change only the new launch-script mode from 0700 to **0755** in a separate tip archive. All **43 core relaunch tests pass**. They do not pin this permission requirement. This is a coverage gap; production still uses 0700. The scratch source was restored byte-identical to tip before additional probes.

Four additional final reviewer probes passed while asserting tip behavior: held confirmation; three settle conflicts/live child; restore-first destruction; script quote/newline environment roundtrip with mode/removal. Initial harness errors were corrected: wait for actual held-probe entry before advancing clock, create restore workspace, model runtime absence after destruction. No product fix was used to make them pass.

## Docs and author's open questions

DEVELOPMENT.md:426 correctly describes ordinary paths, process cache, resident supervisor, prompt and migration. Claims of “only” own conversation, “keys always go again”, exclusion of restore/kill, and agent signal handling need correction with the findings.

The ao send gap warning is correct: send.ts:349 sends directly to a live tmux pane instead of restoring through SessionManager, so the shell can execute the message. **No ao send was run.** Direct runtime input testing illustrates the risk without violating that rule. Default agent-exited reaction is notification; an already-started configured restore reaction is M-6.

1. Missing claims in earlier spawn/restore/start are real: reservation/grace help fresh spawns, but R-3 remains incomplete for reverse ordering (M-6).
2. Restore's newest-transcript behavior and missing orchestrator prompt are pre-existing/unchanged. New guarantees must not be advertised for restore.
3. Old sessions without side files correctly refuse; no retroactive UUID inference. A new hook execution is required.
4. Linux proc dependence is correct; document unsupported platforms. Native evidence here is Linux-only.
5. Timeout unit verified from installed schema/runner, no execution: seconds. New 10 s, existing PostToolUse 5000 s (m-1).
6. Task prompt not resent is the existing restore convention; a new conversation does not retain the old task through the AO record.
7. Grace refusal after a quick exit is real and explains the wait; it does not prove a restore is absent after the grace.
8. Side files survive archive; the age-based assurance is false within the allowance (M-4). Cleanup is not an incarnation check.
9. External launch appears in shell history, an expected consequence of the mechanism.
10. Send-to-shell during the exit gap is accurately documented and not fixed by these changes.

## Cleanup

The final `/proc/*/environ` scan for HOME under `/tmp/aorlr1/`, excluding the scanner and zombies, returned **`OWN PROCESSES []`**. Scratch workers 3656639 and 3705331 stopped through scratch ao stop. Owned signal tests checked the exact PID's HOME first. Protected real workers **2087525 and 2087614** still existed and were never signalled.

Each private-server check returned exit 1 and “no server running on” its named socket: `/tmp/tmux-44402/aorlr1-live`, `/tmp/tmux-44402/aorlr1-hook`, `/tmp/tmux-44402/aorlr1-tests`. Their remaining socket files were then removed. `/tmp/aorlr1` was removed with non-forced `rm -r`; the marker was removed afterward. No owned scratch process or root remains. Only ignored builds/dependencies and the requested review/report artifacts remain in the worktree; no tracked production diff.

`ls -la --time-style=full-iso /home/taisung/.ao/bin` before and after was **byte-identical**. Both listings:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final real-state check, after scratch removal and before marker removal:

```sh
find /home/taisung/.agent-orchestrator -maxdepth 3 -newer /tmp/aorlr1-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-66
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

All are external fleet activity: the protected ao-63/65/66/orchestrator records and their containing directory, outside every state root used by this review. The real orchestrator/lifecycle workers remain active. These writes are not mine; precise attribution to a particular external process cannot be established from mtimes alone. No service.json/auth.json or unowned pane was read; no real state file, shell configuration, global ao link or host wrapper was written.
