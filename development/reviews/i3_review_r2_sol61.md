# I-3 re-check, round 2

NOT-LAND-SAFE

Whole increment: `15757aae..e9882651`. Re-check range: `ad5daa51..e9882651` (`e98826514767127d8839dcb082281aac32c0fd0c`). Reviewer: ao-40. There are **1 blocker, 2 majors and 1 minor** in this re-check. Finding IDs continue round 1. No production source was edited or committed. The round-1 review remains unchanged.

## Round-1 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B-1: concurrent deletion of a newly prepared session | Partly fixed | The original scratch test and isolated live reproducer now preserve both IDs, including after a `status=killed` write. Cleanup skips the launching record. Direct kill of that record and a crashed prepare-only record remain wrong: B-2 and M-4 below. |
| M-1: arbitrary argument text accepted as OpenCode | Partly fixed | The original shell row is rejected on both runtime paths. The live shell case fails and rolls back. Node option values can still be mistaken for the main script: M-3. |
| M-2: old message confirms a new prompt | Fixed | Preparation captures the newest reused-session user-message mark. Old-only, newer-message, failed-baseline and fresh-session tests pass. Ignoring the baseline breaks two plugin tests. |
| m-1: resolver inherits parent environment | Fixed | The four worker/orchestrator reuse/delete environment tests pass. Removing the resolver environment makes all four fail. Live spawn API logs contain the prospective session's AO values and wrapper PATH. The version probe deliberately keeps the ao process PATH. |
| m-2: truncated catalog pipe output | Fixed | Catalog stdout now goes to a private temporary file. Large output, one cut, two cuts, timeout, missing binary and cleanup-on-error tests pass. Reverting to a pipe breaks 11 tests. A second genuinely incomplete file still fails closed, as the round-2 brief requests. |
| m-3: duplicate prompt warning | Fixed | The live no-message spawn prints one useful core warning and no second CLI warning. The CLI test passes. Removing the CLI warning also removes the second warning for Claude Code; core's delivery-failure message remains. |
| m-4: stale restore comment | Fixed | Comment corrected. Restore code, with comment lines excluded, and its builders match `15757aae`. |

## Remaining findings

### B-2 — Killing the launching record does not stop its spawn and can recreate a purged mapping

**File and line:** `packages/core/src/session-manager.ts:2168`, particularly `:2214–2218` and `:2242`; subsequent spawn writes at `:1558` recreate the record.

**Defect:** `kill()` does not check the target record's launch owner. Its shared-ID check excludes that same record. It can archive the record and remove its OpenCode session while the launching process continues. The spawn does not check for cancellation or a missing reservation before writing its record again.

The new tests purge an older record that shares an ID. They do not kill the record currently being launched. This leaves a required ownership path uncovered.

**Independent isolated-service evidence:** I wrapped the real plugin/runtime at the two specified pauses, using the built worktree, real isolated API and a native sleeping stand-in. At each pause I called `sm.kill(currentSessionId, {purgeOpenCode:true})`, then let the real spawn continue.

```text
during fresh preparation:
  record before kill: {launchPid:'1770972', launchPidStart:'stat:125316347'}
  record immediately after kill: null
  spawn returned successfully: i3r2-6
  final: 1 active record / 1 OpenCode session

at runtime.create, after the ID was published:
  record immediately after kill: null
  spawn returned successfully: i3r2-7
  recreated record: opencodeSessionId=ses_eb7fc585fffeov4KMmTp57tYFV
  final: 1 active record / 0 OpenCode sessions / 1 sleeping pane
```

The second result is a successful spawn with a record pointing to a removed session. The first result recreates a session after a successful kill. Both were purged afterward.

**Reproducer:** pause the first `prepareAgentSession` call before delegating to the plugin, or pause the first `runtime.create` before delegating to tmux. Kill that exact AO session with purge, resume the paused call, then inspect the returned session, record and `session.get`. My additional scratch test `RECHECK kill during runtime.create does not resurrect a purged record` also fails: the record is present again and the mock OpenCode store is empty.

Either reject a kill while its launcher owns the record, or implement cancellation that the launcher observes before further creation/writes. It must not report both operations successful with a stale or recreated mapping.

### M-3 — The argv check mistakes a Node preload file for the main script

**File and line:** `packages/plugins/agent-opencode/src/index.ts:552–560`.

**Defect:** the interpreter parser skips option-looking arguments, then treats the first other argument as the script. It does not consume values of interpreter options. With `node --require <file> <script>`, that first argument is the preload file, not the script being run.

**Independent isolated-service evidence:** the stand-in executed a normal Node process with an empty preload file named `opencode`. Its main script only kept the process alive:

```text
1790081 node --require /tmp/ao40-i3-r2/preload/opencode
  /tmp/ao40-i3-r2/server.cjs --session ses_eb7fbef0fffeZTldqi1OUhKLZ3

spawn returned successfully: i3r2-93
promptDelivered=false
final: 1 record / 1 isolated session / 1 Node pane
```

No OpenCode TUI ran. The launch check nevertheless passed. The session and pane were removed afterward.

**Reproducer:** supply the exact argv below through the existing pane-process fixtures, once for tmux and once for Herdr, and require rejection:

```ts
["node", "--require", "/x/opencode", "/x/server.js", "--session", "ses_made"]
```

Both added tests, `RECHECK rejects a node preload named opencode on tmux/herdr`, fail because confirmation resolves to `{}`. Parse interpreter options and their values, or conservatively reject interpreter invocations whose main-script position cannot be established. A named preload is not proof of the main executable.

### M-4 — A launcher that dies during preparation leaves a record that blocks later deletion

**File and line:** `packages/core/src/session-manager.ts:236–239` and `:795–804`.

**Defect:** the initial claim for a reused ID stores only `launchPid`, `launchPidStart` and `opencodeSessionId`. It does not yet store a runtime identity. After the launcher dies, its PID correctly stops satisfying `liveLaunchOwner`, but the next guard returns “liveness could not be checked” because there is no handle or `tmuxName`. Thus the incomplete record still protects the ID through the fallback path.

**Independent isolated-service evidence:** a separate real launcher was paused on entry to reused-session preparation, after the claim write. Its record was:

```text
i3r2-91:
  launchPid=1787726
  launchPidStart=stat:125321449
  opencodeSessionId=ses_eb7fc2725ffeD34BNd2VuHPNpD
```

I stopped and reaped launcher PID 1787726. A subsequent spawn of the same issue using `delete` returned `i3r2-92`, but `session.get` still found the old ID. The guard later printed:

```text
ao: kept OpenCode session ses_eb7fc2725ffeD34BNd2VuHPNpD of i3r2-90:
session i3r2-91 may still use it (liveness could not be checked).
```

**Reproducer:** reuse an archived/dead issue mapping; pause immediately on entering preparation; stop the launcher; start another spawn of that issue with `delete`. The old session remains because the orphan claim lacks pane identity. The added scratch test `RECHECK a dead prepare-only claim does not keep an older session` fails with `expected ['ses_old', 'ses_created_1'] to not include 'ses_old'`.

Persist enough identity before preparation to distinguish this state from an uncheckable legacy holder, or explicitly recover a dead launch claim. The existing dead/reused-PID tests seed full records with `tmuxName`; they miss the actual prepare-only state. An explicit cleanup/purge can recover the orphan; ordinary delete-strategy spawns keep encountering it until then. I do not claim that every cleanup path retains it forever.

### m-5 — Moving environment construction outside rollback leaks resources if it throws

**File and line:** `packages/core/src/session-manager.ts:1416–1418` and `:1898–1900`.

**Defect:** `getEnvironment` for an agent with preparation hooks now runs before the launch cleanup try. A throw leaves the reserved record and created workspace; an orchestrator can also leave its prompt file. Round 1 called it inside rollback handling. Agents without hooks retain their previous order.

**Evidence and reproducer:** in the scratch worker test, make the preparation-capable agent's `getEnvironment` throw `environment failed` after creating a managed workspace. Spawn rejects, but `mockWorkspace.destroy` is never called. `RECHECK environment failure rolls back the workspace and reservation` fails. The source shows the same placement for orchestrators. This is a minor error-path regression; the normal built-in OpenCode environment builder did not fail in my live runs. Move environment construction into rollback handling while retaining its position before the resolver.

## Ownership and regression checks

The launch PID/start-token design is sound for a complete record. It writes the claim before preparation, keeps it through setup/confirmation, ignores lifecycle status, and clears it after confirmation. `/proc/<pid>/stat` parsing uses field 22 and excludes `Z`/`X`; the PID start comparison rejects reuse. `lifecycle-manager.ts:1195` calls its metadata updater; `:721` calls `updateMetadata`, which merges at `metadata.ts:179–188`. The ordered `killed` write therefore retains the claim. The original first-poll race remains a separate owner item, as instructed.

The original concurrent-delete test passed independently in my scratch tree. The live case also passed after I wrote `status=killed` while A waited at runtime creation: A `i3r2-4` retained `ses_eb7fcec13ffe1WQs6obwK4SB8U`; B `i3r2-5` held `ses_eb7fcea37ffeQgzlOuMoBGygts`. Both records lost their launch keys after confirmation. Cleanup skipped A during the pause. Final counts were 2 records / 2 sessions / 2 test panes; purge returned all three counts to zero.

Two independent config hashes with the same `sessionPrefix` produced the same AO name and title but distinct IDs:

```text
i3r2-1 -> ses_eb7fab776ffe8PQ5J6EN49YsQc, pane 34c82f3894a1-i3r2-1
i3r2-1 -> ses_eb7fab72effejTuDNGvBO5yD6S, pane 636365df62ed-i3r2-1
```

Purging A left B's session present. These used separate configured worktree roots and distinct branches in the scratch repository. A real `ao batch-spawn RECHECK-A RECHECK-B RECHECK-C`, with a local tracker fixture, created three distinct records/IDs and exited 0. All were purged. A real zombie fixture also passed: matching start token for zombie PID 1801421 did not protect its old ID, and parent PID 1801399 reaped it before exiting.

I compared the I-4-facing functions with `ad5daa51`: `findOpenCodeSession`, `detectActivity`, `getActivityState`, `recordActivity`, `isProcessRunning` and `getSessionInfo` remain unchanged by the round-2 diff. Restore executable code and all its builders match `15757aae`; only the permitted comment changed. The branch gate, lifecycle/config code, wrappers, runtimes and other agent plugins are unchanged. No-hook spawn order is preserved. Round-1 rollback behavior otherwise remains, subject to m-5 and the existing best-effort/unknown-create-ID limits described in that review.

The argv change correctly accepts native `opencode`/`.opencode`, the supported simple Node/Bun script forms, both session-option spellings, and rejects the shell text and inline-code rows covered by tests. Reading `/proc` makes the launch check unavailable on macOS: a major compatibility limitation, explicitly identified by the brief, rather than a new host-specific finding. A shell wrapper itself is rejected; a wrapper with an identifiable OpenCode child on the pane TTY can still pass through that child. An opaque wrapper with no identifiable child is rejected by design.

## Earlier defects identified by the author

I checked both claims against a `git archive 15757aae` copy. Before running any base spawn code, I replaced its lock module with a scratch stub; it could not access the live lock directory. Two independent base tests passed:

- A dead project-mode orchestrator started with `delete` already discarded its active record without an archive, losing the old ID as a deletion candidate. Severity: **minor retained-session leak**, potentially more disruptive if that untracked session later continues independently. This behavior predates I-3.
- The base API helper already treated `LocationNotFoundError` plus HTTP 404 as session absence. The switch/readback builders are unchanged. A new isolated live check created a session, removed its location directory, then switched its model: the helper reported “session does not exist” while `session.get` still found it. Severity: **major reuse failure** with a misleading error; the underlying location/switch failure predates I-3. I-3 improves reporting by failing the spawn instead of leaving the pane-side failure undiscovered.

The tool-environment measurement remains deferred. No model turn was used to investigate either defect.

## Gates and mutation tests

Every command ran with fake HOME, scratch TMPDIR and no inherited `AO_*`. OpenCode was hidden for the filtered integration run; no live-model block ran in the full suite. Independent results:

```text
pnpm install                       exit 0, Done in 2.4s
pnpm build                         exit 0
core test                          959 passed, 36 files
OpenCode plugin test               174 passed
OpenCode plugin typecheck          exit 0
CLI test                           244 passed, 19 files
integration, OpenCode hidden       87 passed / 24 skipped; 10 files passed / 3 skipped
pnpm lint                          exit 0; 0 errors / 5 existing warnings
pnpm typecheck                     exit 0
pnpm test                          exit 0; 2273 passed / 29 skipped
```

All 13 separately applied mutants in my scratch `e9882651` copy failed tests. Counts are failures within the targeted file, followed by representative test evidence:

| Mutant | Failures and tests |
| --- | --- |
| ID stored only after runtime creation | 3: worker/orchestrator `creates and stores ... before runtime.create`; concurrent delete |
| Discard also removes reuse | 1: `never removes the reused session: not on a readback mismatch, not on discard` |
| No settle interval | 1: `does not count a process that exits before the settle time` |
| Any OpenCode-looking process | 11: wrong session/pane, shell/inline/script rows, Herdr shell row |
| Version gate after create | 9: gate/model/create/readback order and refused-version cases |
| Catalog matches `modelID` | 1: `matches the create id against Model.Info id, not modelID` |
| Keys removed before confirmation | 2: launch keys retained through setup/check, worker and orchestrator |
| Start-time comparison removed | 1: crashed/reused-PID test |
| Guard depends on `status=spawning` | 3: concurrent delete and reuse prepare cleanup/purge |
| Prompt baseline ignored | 2: old-only user message and failed baseline |
| Round-1 token search on joined argv | 8: shell, wrapper, inline-code, prompt and separator rows |
| Resolver environment omitted | 4: worker/orchestrator reuse/delete environment tests |
| Catalog file read reverted to pipe | 11: large/file/cut/error/cleanup catalog tests |

The original concurrent scratch reproducer now passes. My additional tests fail for current-record kill, dead prepare-only ownership, Node preload parsing on both runtimes, and environment rollback. The suite checks real side effects and temporal record/message boundaries, but these uncovered states are absent from it.

## Live checks, scope and cleanup

All writes used copied OpenCode 2.0.31, PID **3961059**, port **49642**, and all four XDG roots under `/tmp/ao40-i3-r2/xdg`. Before the first write I checked global `server.info` (read only, PID **3252262**, port **49374**) and private `server.info`; they differed. No service credential file was read by the reviewer and no credential was copied. The stand-ins never started a real TUI or submitted a model prompt.

The initial private tmux server was **3847628**, with control pane **3847642**; its environment was checked and had no `AO_*`. That finite control pane expired during the long interruption. A preliminary resumed B-1 run recreated the private server from the scratch AO environment and ended when its panes were purged; I discarded that run. I then explicitly restarted the private server from `env -i`, checked its pane environment again, and used server **1770918** / control pane **1770950** for the quoted final checks. No default tmux server was accessed. The preliminary startup did not meet the brief's no-`AO_*` server-start rule; all paths and AO values were nevertheless scratch values, and the final reproductions use the corrected setup.

The required CLI cases were rerun before the interruption: bad model exit 1; forced create failure exit 1; dead stand-in exit 1; live shell-only stand-in exit 1. Each left 0 active records / 0 isolated sessions / 0 test panes. The no-message native stand-in succeeded in 12.588 s, with one warning and `promptDelivered=false`; its one record/session/pane were removed by `ao session kill --purge-session`. The dead and shell cases took approximately 16.6 s and removed the created IDs. The final three-gap checks and their counts are quoted above. Final isolated `session.list` was `{"data":[],"cursor":{"previous":null,"next":null}}`; only the control pane remained.

The seven commits are conventional and explain why, with no co-author trailer, emoji or issue number. The range changes only the 11 allowed files, including the CLI warning and its test. `git branch -r --contains e9882651` printed nothing. `git diff --quiet` passed. Round-1 review SHA-256 remains `ac2616d2b5068fb43a9a45a7fd59c894e5650a74cc977b14b7cd9ddb53a1ca98`.

What I found correct: direct create-ID ownership removes title discovery; the status-independent owner check fixes the original overlap; the reused-session baseline and file-backed catalog read address their reported defects; warning output and restore scope are corrected; tests catch all required mutants. B-2, M-3 and M-4 prevent a land-safe verdict.

Final process, filesystem and host-state cleanup evidence follows after teardown.

Scratch lifecycle workers **4043309, 4044512, 4046073, 4056381, 4066626, 1794218** were stopped by exact PID, with their scratch environments checked, before final tmux shutdown. The crashed-launcher fixture **1787726** was stopped and reaped. The zombie fixture's parent **1801399** reaped child **1801421** and exited. Required AO purge calls stopped the named private panes. Final service **3961059** and control pane **1770950** received SIGTERM by exact PID after command-line/environment checks; private server **1770918** exited. No protected real worker was signalled. This includes the replacement PIDs supplied by the orchestrator: **1815472, 1815599, 1815614, 1815674, 1816016**. I make no assertion that the older real worker PIDs are gone.

```text
ps -o pid,args -u "$(id -u)" [filtered for scratch paths/private server/worktree CLI]
<no output>

independent /proc environment scan for scratch processes
<no output>

test ! -e /tmp/ao40-i3-r2
success: scratch namespace removed

ls -A /tmp/ao-opencode-launch-44402
<no output at start or end>
```

The namespace removal included the copied service/store, fixture repository/worktrees, fake HOMEs, all test TMPDIRs, base/mutation/probe copies and logs. No answer-file temporary directory remained before removal. The review preserves the relevant evidence instead of retaining scratch artifacts.

`ls -la --time-style=full-iso ~/.ao/bin` and SHA-256 hashes were identical before/after:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

**Host timestamp-check exception:** the original-marker `find` is not empty. The orchestrator explicitly reported restarting the five real workers at 00:03 EDT for its I-4 rollout. The five returned directories have mtimes 00:03:12–00:03:25, matching that report:

```text
find ~/.agent-orchestrator -maxdepth 1 -newer /tmp/ao40-i3-r2-marker
/home/taisung/.agent-orchestrator/6bf63a3e9f61-VSF
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-agent-orchestrator
```

All reviewer AO/helper calls used scratch state; I did not alter these host directories or their timestamps to force an empty result. The requested global timestamp assertion therefore cannot demonstrate host quiescence during this concurrent rollout. The marker was removed after recording the actual result. Round-1 review checksum still matches; tracked source diff remains empty. No commit, push, PR, or done-message send was made.
