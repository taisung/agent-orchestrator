# I-3 blind review, round 1

NOT-LAND-SAFE

Range: `15757aae..ad5daa51` (`ad5daa51e7e430bc1a29854ea59401c2d0f853a3`). Reviewer: ao-40, cross-family review of the ao-36 implementation. I found **1 blocker, 2 majors, and 4 minors**. The blocker and both majors need correction before landing. The pre-existing lifecycle race is assessed separately below.

I reviewed the design and measurements, the owner decisions and author brief, all three commits and the affected source/test paths. I read the author report after the initial source review of items 1–6. I built and tested this worktree independently. No project source was edited, committed, pushed, or submitted as a PR. Mutants and additional probes existed only under `/tmp/ao40-i3-review`.

## Findings

### B-1 — A concurrent issue-delete spawn removes another spawn's newly created session

Location: `packages/core/src/session-manager.ts:1339` (new pre-pane publication), interacting with `:692`, `:713`, `:736`, and `:781` (the unchanged holder/deletion rules).

The early record now publishes an OpenCode ID and `tmuxName` before its pane exists. Another spawn of the same issue with `opencodeIssueSessionStrategy: delete` finds that record. `openCodeHolderReason` constructs a handle from `tmuxName`, observes an absent pane and absent agent process, and declares the holder dead. The second spawn then removes the first spawn's session. Pane absence is expected at this stage and does not establish that the launcher has relinquished the ID.

This is a regression introduced by moving publication before `runtime.create`. Removing title discovery solves title cross-binding; it does not make the existing shared-ID liveness rule valid for this new record state. Restoring the title lock is not the required fix. Protect an in-progress launch from reuse/delete decisions, using ownership evidence or serialization that survives the existing premature `killed` status race.

**Independent live reproducer:** isolated 2.0.31 service, private tmux, the worktree build and sleeping TUI shim. I loaded the real registry, disabled its tracker lookup for the synthetic issue, and wrapped only `runtime.create` to pause its first invocation before delegating to the real runtime. Both calls used the same manager/config with issue strategy `delete`, issue `REVIEW-DELETE`, and distinct branches. Sequence:

```text
A: sm.spawn({projectId:'review', issueId:'REVIEW-DELETE', branch:'feat/review-delete-a'})
   pause at runtime.create, after core has written A's record
B: await sm.spawn({projectId:'review', issueId:'REVIEW-DELETE', branch:'feat/review-delete-b'})
   inspect session.get(A's prepared ID), then release A

A pre-pane i3review-5 ses_eba11c793ffeRzLfrVLtrWTriP
B returns i3review-6 ses_eba11c551ffeK2HsottGXF9aqV
A session after B null
A returns i3review-5
```

`null` is the core helper's explicit 404 result. Both calls succeeded, but the final snapshot had **3 records / 2 OpenCode sessions** (the third record was the separate orchestrator). A's record still named its removed ID. No model turn ran. With a real TUI this also creates a launch failure or a race with attachment to the deleted session.

A separate scratch core test paused the first `mockRuntime.create`, invoked the second spawn inside it, and asserted that the mock API still contained `ses_created_1`. It failed:

```text
REVIEW concurrent delete does not remove the other spawn before its pane exists
AssertionError: expected [ 'ses_created_2' ] to include 'ses_created_1'
```

The existing tests protect an already live holder; they do not cover a published ID whose pane has yet to start. The same guard is used by cleanup/removal paths, so those paths need review against this new intermediate state too.

### M-1 — The launch check accepts a shell that merely mentions OpenCode in its arguments

Location: `packages/plugins/agent-opencode/src/index.ts:495` (`commandOpensSession`), consumed by tmux at `:560` and Herdr at `:520`.

The matcher searches every whitespace-separated argument for a token ending in `opencode`, then searches later tokens for the session option. It does not establish which executable or interpreter script is running. For example, this process can stay alive for the settle interval without running OpenCode:

```text
/bin/bash -c sleep 60 opencode --session ses_made
```

Here `sleep` is the shell command and `opencode --session ses_made` are shell positional arguments. A wrapper or a shell stalled before an exec can produce the same false proof. Matching a TTY and seeing the same PID twice does not fix executable identity.

**Reproducer:** in a scratch copy of the existing `confirmLaunch` describe, use its `paneProcesses` helper with the following row, then expect `confirmLaunch` to reject:

```ts
paneProcesses(["  4242 pts/7 /bin/bash -c sleep 60 opencode --session ses_made"]);
await expect(agent.confirmLaunch!(tmuxSession(), await preparedSession(), quick))
  .rejects.toThrow();
```

The added test `REVIEW rejects a shell whose arguments only mention opencode` failed because the promise **resolved to `{}`**. Validate the executable/script position using structured process information; distinguish supported interpreter wrappers from arbitrary argument text. Add a negative shell/wrapper test for both runtime paths.

### M-2 — An old user message confirms delivery of a new prompt on a reused session

Location: `packages/core/src/opencode-api.ts:635` and `:645`, called by `packages/plugins/agent-opencode/src/index.ts:617` and `:797`.

`session.message.list(type=user, limit=1)` asks whether any user message exists. A reused issue/orchestrator conversation normally already has one. There is no baseline message ID, timestamp, or comparison with the new launch prompt. Consequently a TUI that opens the reused conversation but never submits its new prompt gets `promptDelivered=true` immediately and suppresses the warning.

**Reproducer:** the scratch test `REVIEW does not confirm a new prompt from an unchanged old user message` configured `opencodeSessionId=ses_old`, made `hasOpenCodeUserMessage` true before preparation and throughout confirmation, and supplied a matching stable pane process. The expected false delivery result failed with `expected true to be false`. No new message was admitted in this test. The fresh-session no-message live case passes because its history is empty; it does not exercise reuse.

Capture a pre-launch message boundary for reused sessions and require a newly admitted user message after it. Preserve the soft-failure behavior when no new message arrives.

### m-1 — Reuse/deletion API calls still inherit the caller's environment

Location: `packages/core/src/session-manager.ts:792`, invoked before the worker builds its pane map at `:1309`; deletion at `:781` also calls the existing helpers without the new map. Orchestrator reuse goes through the same resolver.

The new prepare/confirm/discard calls pass the pane map correctly, and `sessionChildEnvironment` removes the parent's `AO_*` keys for those calls. However, the earlier reuse resolver still calls `getOpenCodeSession` without `env`. Therefore the claim that **every spawn API call** uses the pane map is false. These particular reads do not launch a model turn, so I rate this below the ownership and launch-verification failures.

**Reproducer:** the scratch core test `REVIEW reuse lookup uses the child environment` seeded a stored issue mapping and set only synthetic parent values. The real mock API child log contained:

```json
{"op":"session.get","env":{"AO_SESSION_ID":"scratch-parent","AO_ISSUE_ID":"scratch-parent-issue","PATH":"<caller PATH>"}}
{"op":"session.message.list","env":{"AO_SESSION_ID":"app-10","AO_SESSION":"app-10","PATH":"/fake-home/.ao/bin:<caller PATH>","AO_PROJECT_ID":"my-app","AO_CALLER_TYPE":"agent"}}
```

The assertion that no call contained `scratch-parent` failed. Thread the prospective session environment into the resolver, or narrow and document the contract if these reads are intentionally exempt. The version probe separately and intentionally uses the ao process PATH; it does not use the pane PATH.

### m-2 — Repeated truncated catalog output remains an availability failure

Location: `packages/core/src/opencode-api.ts:523`.

One incomplete exit-0 answer is retried; a second fails the spawn. The existing test explicitly asserts that failure. My scratch probe with both answers `{"data":[` reproduced `OpenCodeApiIncompleteAnswerError` after two calls. Two cuts are plausible under the reader stalls already measured in 0010 §11.1; a second pipe read does not remove that cause.

The author brief expressly permits “retry once,” so I do **not** treat this as a blocker or an unambiguous violation of that permitted implementation. It does not satisfy the stronger reading of “a cut answer must not fail a spawn.” File-backed stdout would address that reliability requirement while retaining validation of the complete catalog. Do not solve it by accepting an unchecked model. This probe used synthetic cut output, not a claim that my one live catalog read was cut.

### m-3 — A missing launch prompt produces two operator warnings

Location: `packages/core/src/session-manager.ts:1513` and `packages/cli/src/commands/spawn.ts:132`.

**Reproducer:** the required live sleeping-shim spawn succeeded with `promptDelivered=false` and printed both the new `ao: ... launch prompt did not show ...` line and the CLI's existing `Prompt delivery failed — agent may be idle` warning. This is operator noise, not a spawn-correctness failure. The CLI file is outside the author's allowed edit list.

### m-4 — Restore retains a comment describing removed machinery

Location: `packages/plugins/agent-opencode/src/index.ts:996`.

**Reproducer:** read the comment saying the launch lock, marker and discovery wait “are untouched,” then compare the deleted lock module and removed discovery code. It is stale. The brief simultaneously requires `getRestoreCommand` to remain byte-identical, so this is a documented follow-up, not a demand to violate that constraint.

## Spawn order and rollback audit

Workers reserve identity, run the unchanged branch gate inside the workspace try, create/post-create the workspace, compose the prompt and resolve ID reuse, then call `getEnvironment` and `prepareAgentSession`. Preparation runs the unchanged version gate, validates model syntax/catalog when configured, creates or switches the ID, and reads requested settings back. Core publishes the ID, builds the launch command, calls `runtime.create`, writes the full record, runs `postLaunchSetup`, and calls `confirmLaunch`.

Orchestrator start applies the same preparation/publication/launch sequence after its existing project-vs-isolated reservation/workspace handling and system-prompt-file write. Its earlier reuse/delete strategy handling remains in place. A live reusable project-mode orchestrator still returns its existing session without a new prepare or confirm call.

| Failure point | Record / workspace / branch | Pane / OpenCode session / prompt file |
| --- | --- | --- |
| Plugin/issue validation before reservation | No newly reserved resources | None |
| Branch gate | Reservation deleted; no workspace created; gate order and error strings unchanged | None |
| Workspace create/post-create | Reservation deleted; post-create uses `shouldDestroyWorkspacePath`; workspace plugin owns cleanup of partial create failures; a created branch can remain | None |
| `getEnvironment` or version/model check | Reservation deleted; managed workspace destroyed; branch remains | No pane or created session; orchestrator prompt file removed |
| Create fails before an ID is received | Same rollback | No pane; if the service committed a create but the response was lost/unusable, its ID is unknown and cannot be discarded; prompt file removed |
| Requested-settings readback fails | Same rollback | Preparation discards its newly created ID; a reused ID is kept, including any settings already switched; no pane; prompt file removed |
| Pre-pane record write or launch-command builder fails | Record deleted; managed workspace destroyed; branch remains | `discard()` for created ID only; no pane; prompt file removed |
| `runtime.create` throws | Record deleted; managed workspace destroyed; branch remains | Discard created ID; partial pane cleanup relies on runtime's existing failure handling because core has no returned handle; prompt file removed |
| Full record write / post-launch setup / launch confirmation throws | Record deleted; managed workspace destroyed; branch remains | Runtime destroyed first, then created ID discarded; reused ID retained; prompt file removed |
| Prompt absent after the soft bound | Live record remains with `promptDelivered=false` | Pane and session remain; successful orchestrator keeps its prompt file |
| Final prompt-delivery metadata update throws | Live resources can remain while the caller receives an error | This update is outside the rollback try, as in the previous implementation |

Cleanup is best effort: a failed workspace/runtime destroy can leave its resource; failed session removal prints recovery information after two attempts (one on timeout). A successful create followed by process death before publication also has a small orphan window. The new flow improves recoverability but the spec's literal “every session ... has a record” is stronger than crash/error behavior permits. No unknown ID should be guessed by title to repair this.

For agents without hooks the observable order remains `getLaunchCommand → getEnvironment → runtime.create → full record → postLaunchSetup → existing prompt handling`. Claude Code, Codex, Gemini, their tests, and runtime implementations are unchanged. The added no-hook order test passes. The m-13/m-15 gate text and placement are unchanged.

## Ownership, restore, and scope

Fresh creates return independent IDs, so identical titles across overlapping spawns or fleets no longer select or discard each other's newly created ID by title. The three concurrent live spawns confirmed this for one project. Intentional issue reuse can still share an ID, and `prepared.discard()` correctly remains a no-op for reuse. B-1 is the remaining conflict between publication and the shared-ID removal guard, rather than a title-discovery race.

The removed lock/pending protocol was used by discovery only; no current source accesses its fixed directory. Old markers are inert for I-3 builds. Manual remap still uses bounded exact-title/directory search, and ambiguous candidates remain refused. Reuse remains stored-ID based with no title fallback. Kill, purge, cleanup and the liveness guard were not edited, but their interaction with the new intermediate record state must be corrected for B-1.

I compared these blocks against `15757aae`: `getRestoreCommand`, `buildResumeCommand`, `buildApiResumeCommand`, `buildApiSettingsCommand`, `buildApiSessionCall`, `buildApiSettingsReadback`, `settingsFailureCommand`, `buildApiSettingsCheckScript`, `toOpenCodeModelRef`, `checkOpenCodeVersion`, and `assertSupportedOpenCodeVersion` are byte-identical. The extracted invalid-model message preserves its output. Core's lifecycle/config files, wrapper/PATH implementation, runtime plugins and other agent plugins are unchanged.

The range changes exactly the 13 permitted files, including the two lock-file deletions. All three commit messages are conventional and explain why; no emoji, issue number or co-author trailer. `git branch -r --contains ad5daa51` printed nothing. No base spawn code was executed, so no base lock mocking was needed.

## Model, environment, and confirmation details

I independently read only `server.info` and `model.list` on the global service. Its current PID was **3252262**, version **2.0.31**, URL `http://127.0.0.1:49374` (the old PID in the historical notes is no longer current). The catalog read was **473849 bytes / 586 entries**, elapsed **0.17 s**, user **0.17 s**, system **0.05 s**, peak client RSS **93796 KiB** in one `/usr/bin/time` sample. This is the catalog client cost, not an isolated measurement of Node JSON parsing or the entire spawn.

The two global fleet entries, reduced to the fields used by the check, were:

```json
{"providerID":"opencode-go","id":"muse-spark-1.3-contributor","modelID":"muse-spark-1.3-contributor","enabled":true,"variants":["minimal","low","medium","high","xhigh"]}
{"providerID":"opencode-go","id":"deepseek-v4.1-flash","modelID":"deepseek-v4.1-flash","enabled":true,"variants":["low","high","max"]}
```

The actual variants are objects with `id` and `settings`; the arrays above show their IDs. Matching `providerID + id` is correct; `modelID` can name multiple catalog aliases. `enabled` must be exactly true, and a non-default suffix must occur in `variants[].id`. An absent suffix and `#default` pass the availability check; the readback normalizes absent/default. No configured model skips both the catalog check and model readback. An enabled custom/configured model returned by this catalog is accepted on the same terms. A runnable model omitted from the catalog or advertised disabled would be refused by design; I did not establish such a model with a turn, and do not claim that the tests prove all custom-provider configurations work.

Each catalog call is bounded by 10 s; one retry permits 20 s total. Output has a 64 MiB cap. Each spawn reparses the catalog; there is no persistent catalog cache. Prepare, confirmation and discard calls use the explicit map plus inherited non-`AO_*` variables, stripping parent `AO_*` values before overlay. m-1 identifies the earlier resolver exception. The synchronous version gate uses the ao PATH, so a different `opencode` in the pane's prepended `~/.ao/bin` could disagree; that directory contains no OpenCode binary on this host.

Confirmation checks matching pane TTYs from `tmux list-panes` and process rows from `ps -ww -eo pid,tty,args`; Herdr uses its structured pane process list. Other runtimes fail closed. The same PID must persist for 1 s (scaled for short test bounds), with 250 ms pane polls. Wrong session IDs and other TTYs are rejected by the existing tests; M-1 covers arbitrary argument text that they miss. `list-panes -t <session>` checks the session's current window's panes rather than proving a designated pane process ancestry. Missing-session/window/pane/server diagnostics fail immediately; a failed child launch that returns to its shell instead exhausts the pane bound.

The nominal pane deadline is 15 s. Sequential tmux/ps calls each have 5 s bounds and are not clipped to remaining time; the loop checks settlement before checking its deadline. Consequently this is not a strict 15 s wall-clock ceiling. A healthy TUI delayed beyond the configured startup bound can be refused on a loaded host. The added settle test detects two sightings that are too close together, but cannot prove future TUI health.

Prompt polling is every 500 ms for nominally 10 s, with each API timeout clipped to remaining time. A missing prompt preserves the spawn. A good real TUI adds the one-second settlement and any remaining wait for the first newly submitted user message; the two waits can overlap with TUI submission. I did not measure a real good TUI because turns were prohibited. My modeled live spawn with no submission took **12.665 s**, including the full 10 s prompt wait. The dead shim took **16.655 s**, including the pane timeout.

## Live isolated checks

All writes used four XDG roots beneath `/tmp/ao40-i3-review/xdg`, fake HOME, scratch `AO_STATE_ROOT`, and a copied binary on port **49640**. Before the first session write, `server.info` reported private PID **1415662**, version 2.0.31, URL `http://127.0.0.1:49640`, and scratch tmp path. This differs from the verified global service. No service credential file was read by the reviewer, no credential was copied, and no model prompt or real TUI ran. The opencode shim delegated only API/version calls and exited or slept for TUI launches.

The private tmux server was started from `env -i`, with fake HOME, scratch PATH, no `AO_*`, and `-f /dev/null`. Every tmux invocation used the shim adding `-L ao40-i3-review` and unsetting `TMUX`. Its initial pane environment contained HOME/PATH/PWD/SHELL/TERM and tmux bookkeeping only; no `AO_*`. Initial control pane: PID **1401633**, server **1401622**, TTY `/dev/pts/6`.

| Case | Exit and observations | AO records / isolated sessions / test panes after case |
| --- | --- | --- |
| Initial | Empty store | 0 / 0 / 0 |
| Bad model `ao40-none/none` | Exit 1, `model.list has no model ao40-none/none` | 0 / 0 / 0 |
| Forced `session.create` failure | Exit 1, `forced isolated create failure` | 0 / 0 / 0 |
| Dead shim | Exit 1 after 15 s check; removed ID `ses_eba15073affeDlkGX429DVanJ5` | 0 / 0 / 0 |
| Live shim, model `opencode/big-pickle` | Exit 0; `status=spawning`, `promptDelivered=false` | 1 / 1 / 1 |
| Purge previous | `ao session kill i3review-1 --purge-session`, exit 0 | 0 / 0 / 0 |
| Three parallel CLI spawns | All exit 0; all records `status=spawning`, `promptDelivered=false` | 3 / 3 / 3 |
| Purge three | All exit 0 | 0 / 0 / 0 |
| One real `spawnOrchestrator` call via built CLI factory | Success; `status=working`, `promptDelivered=false` | 1 / 1 / 1 |
| B-1 controlled overlap, preserving orchestrator | Both spawns return success; A ID gone | 3 / 2 / 3 |
| Final purge of all three records | All exit 0 | 0 / 0 / 0 |

The control pane is excluded from test-pane counts; its pane list was always `review-control 1401633 sleep` between cases. The dead-session readback was:

```text
session.get sessionID=ses_eba15073affeDlkGX429DVanJ5
exit 1
{"_tag":"SessionNotFoundError","sessionID":"ses_eba15073affeDlkGX429DVanJ5","message":"Session not found: ses_eba15073affeDlkGX429DVanJ5"}
HTTP 404 Not Found
```

Parallel record mappings were distinct and matched their service titles/directories:

```text
i3review-2 -> ses_eba148c84ffehQwWc2uU43iJGE
i3review-3 -> ses_eba148c62ffehWkrBxma8kZuoP
i3review-4 -> ses_eba148c69ffekJvDVrzvesdudk
```

Their pane list contained exactly `3f68332a056a-i3review-2`, `-3`, `-4` and `review-control`. The orchestrator mapping was `i3review-orchestrator-1 -> ses_eba1437dfffe7V3zvMtVJKg2Wy`, with pane `3f68332a056a-i3review-orchestrator-1`. After final purge, the pane list contained only the control pane and both record/session counts were zero.

## Existing first-poll killed race: severity assessment only

I independently observed the first-poll transitions in scratch lifecycle traces:

```text
worker 1462293: 18:11:46.656Z i3review-1 spawning -> killed (bad-model case)
worker 1493714: 18:13:08.458Z i3review-1 spawning -> killed (create failure)
worker 1493957: 18:13:09.233Z i3review-1 spawning -> killed (dead shim)
worker 1499418: 18:13:26.103Z i3review-1 spawning -> killed (live shim)
worker 1502592: 18:13:40.777Z / .781Z / .785Z i3review-3 / -2 / -4 spawning -> killed
```

The live case's later pre-pane write was at `18:13:26.657Z`; the returned record was `status=spawning`. `ensureLifecycleWorker` runs before spawn. The worker polls immediately, while the empty reservation has no runtime. Session listing fabricates a handle, and `lifecycle-manager.ts:390` treats its absent pane as killed; `:417` can likewise treat an agent not yet started as exited. There is no startup grace in that logic.

I rate this existing issue **major**, outside this increment's permitted edits; it is not an additional new finding count. I-3 lengthens the interval before a pane exists by doing version/catalog/create/readback first, adds a pre-pane status overwrite that can repair an early disk write, and shortens the interval where a pane exists without its agent by removing pane-side API work. Thus it does not eliminate the race and can expose the old pre-pane race more often, while improving the later window. I stopped workers after the required cases and do not claim an independently measured second-poll recovery. B-1 also means a `status=spawning` check alone is not enough unless premature killed writes are accounted for.

## Tests and non-vacuity

All pnpm runs used `env -i`, fake HOME, no `AO_*`, and the private tmux/gh stubs. Test HOMEs were initially empty. The filtered integration run hid OpenCode from PATH; the full run used a HOME with no provider credentials. No live-model integration block ran.

```text
pnpm install                                      exit 0 (Done in 2s)
pnpm build                                        exit 0
core test                                         36 files, 936 passed
OpenCode plugin test                              1 file, 153 passed
core + OpenCode plugin typecheck filters           exit 0
integration test, OpenCode hidden                  10 files passed / 3 skipped; 87 passed / 24 skipped
pnpm lint                                         exit 0; 0 errors, 5 existing warnings
pnpm typecheck                                    exit 0
pnpm test                                         exit 0; 2228 passed, 29 skipped
```

Full-suite package counts: core 936; Gemini 62; desktop 26; Codex 215; Claude Code 208; Herdr 36; SCM 140 (+5 skipped); tracker 42; tmux 30; worktree 50; OpenCode 153; integration 87 (+24 skipped); CLI 243. Lint warnings are the existing console statements in CLI spawn, core activity-log/plugin-registry, and the two session-manager prompt-retry statements.

I archived `ad5daa51` into a scratch tree, copied dependencies/build outputs, and applied each mutant separately, restoring the source before the next. All six required mutants were killed:

| Mutant | Failure count / representative failing tests |
| --- | --- |
| Store ID only after `runtime.create` (remove the early worker and orchestrator writes; keep the later full writes) | 2 failures / 97 pass: `creates and stores the session before runtime.create, then confirms the launch`; orchestrator `creates and stores the session before runtime.create, with the orchestrator pane environment` |
| `discard()` also removes reused ID | 1 failure / 152 pass: `never removes the reused session: not on a readback mismatch, not on discard` |
| Settle time removed (`settleMs=0`) | 1 failure / 152 pass: `does not count a process that exits before the settle time` |
| Match any `opencode` process regardless of session | 2 failures / 151 pass: `does not count opencode on another session or in another pane`; `fails when the herdr pane never runs opencode on the session` |
| Version gate moved after create | 9 failures / 144 pass: ordered gate/model/create/readback test plus all eight refused-version cases |
| Match catalog `modelID` instead of `id` | 1 failure / 46 pass: `matches the create id against Model.Info id, not modelID` |

These assertions inspect records at runtime creation, side effects in the mock store, request order, child environments and negative process timelines. They are behavioral, not just copies of command literals. The suite nevertheless misses the new intermediate-state conflict and the two false-positive confirmations: my additional scratch reviewer probes failed for B-1, M-1, M-2 and m-1. The repeated-cut probe also failed, consistent with the suite's intentional second-cut policy.

## What I found correct

- Fresh-session ownership now comes directly from `session.create`, with no title lookup in either start path.
- The prepared metadata is present before runtime creation, and reuse is protected by the plugin's discard implementation.
- Model IDs, variants, readback mismatches, real workspace paths, environment overlay and timeout/error distinctions are tested meaningfully.
- Dead launches roll back, while an unobserved prompt preserves the session and records false in the fresh-session live check.
- Restore, other agents, runtimes and the intended source scope are preserved.

## Cleanup evidence

Final cleanup observations follow below. The scratch state and processes were removed after preserving the evidence quoted above.

Scratch lifecycle workers **1462293, 1493714, 1493957, 1499418, 1502592** were stopped by their exact PIDs before tmux shutdown. Required purge checks stopped the named private panes. The remaining private service **1415662** and control pane **1401633** received SIGTERM by exact PID after checking their command lines; private server **1401622** then exited. The final tracked non-zombie PID list and the independent environment scan were empty. None of the five protected real worker PIDs was signalled.

```text
ps -o pid,args -u "$(id -u)" [filtered for scratch paths/private server/worktree CLI]
<no output>

test ! -e /tmp/ao40-i3-review
success: scratch namespace removed

find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao40-i3-review-marker
<no output>

ls -la /tmp/ao-opencode-launch-44402
# before
total 8488
drwx------    2 taisung users    4096 Oct 16 14:01 .
drwxrwxrwt 2816 root    root  8679424 Oct 16 14:08 ..
# after
total 8488
drwx------    2 taisung users    4096 Oct 16 14:01 .
drwxrwxrwt 2866 root    root  8679424 Oct 16 14:23 ..
```

The namespace removal included the isolated store/binary, cloned fixture repository and worktrees, fake HOMEs/wrappers, mutant copy and test logs. The initial filtered test runs used the system tmpdir; repository tests can leave empty PID-named test scaffolding there. I did not clear shared test directories that cannot be attributed to this review. Later full-suite/mutant runs used the namespaced `TMPDIR` and were removed with it.

`ls -la --time-style=full-iso ~/.ao/bin` was identical before and after, and the SHA-256 comparison of every wrapper and `.ao-version` also printed no difference:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The marker was removed after the final `find`. `git diff --quiet` exited 0: tracked source remains untouched. The review and session report are uncommitted deliverables. The deferred tool-environment measurement was not run and remains an owner landing prerequisite or accepted risk, as specified in the brief.
