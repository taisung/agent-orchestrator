# Same-ID R4 review, round 2

## Final verdict

**NOT-LAND-SAFE for `75f1c98b..8e9efe95`: 0 blockers, 4 majors, 0 minors.** The four open majors are M-2, M-3, M-4 and M-5 below. M-1 is closed. All originally retained r1 reproducers now have the intended behavior. The new failures are in R4's changed decision reads and therefore block under this brief's explicit scope rule; this verdict does not require the older R2/R3 follow-ups to be fixed.

| Prior finding | Closure | Evidence |
| --- | --- | --- |
| M-1, Git diagnostic substring | **closed** | Whole diagnostic + C locale; r1 mock, real Git restore, new quoted-whole-diagnostic, extra-line, other-128 and translated-output probes. Missing-path and both discovery forms remain negative. |
| M-2, malformed tmux/ps success | **partly closed** | All original 9 direct assertions, lifecycle and send probes pass. Impossible PID rows still become negatives; new lifecycle/send reproducers fail. |
| M-3, ambiguous/malformed Herdr | **partly closed** | Original exec-text, malformed-argv and wrong-pane-get cases are fixed. The adjacent process-info read still accepts another pane's answer, and contradictory success/error envelopes become negatives. |

### M-2 — impossible process IDs still count as a well-formed process list

Locations: `packages/plugins/agent-codex/src/index.ts:608`, `agent-gemini/src/index.ts:239`, `agent-opencode/src/index.ts:1365`; OpenCode's send/launch read at `agent-opencode/src/index.ts:700` and `:710`. Category: retained malformed-success negative in the exact R4/M-2 code, including the new validation.

The validators accept any digit sequence. `PID TT COMMAND\n999999999999999999999 pts/73 /bin/bash\n` and the same row with PID `0` resolve false for every agent, although neither is a valid process ID. With headerless `999999999999999999999 pts/73\n`, OpenCode's send validator accepts the row and the subsequent `Number.isSafeInteger` silently discards it, returning no TUI. This is the same filter-then-negative error that M-3 fixed for malformed argv.

Reproducer: set tmux stdout to `/dev/pts/73\n`, ps to either row above, exit 0. All six direct rejection assertions fail. Two lifecycle polls with the actual Codex plugin and a runtime that answers alive persist `status=killed` (`agent-exited`). OpenCode delivery raises `AgentNotAttachedError`; no prompt API is called. Require positive, safely representable PIDs for every row before allowing absence; an invalid row must reject the whole reply. Keep valid shell-only rows negative. Review source and caller probes are retained below.

### M-3 — Herdr process-info is not bound to the requested pane; ambiguous envelopes still win

Locations: `packages/core/src/herdr.ts:105`–`:110` (process identity), `:91`–`:94` (error precedence), and `packages/plugins/runtime-herdr/src/index.ts:112` / `:217` (envelope consumed by the changed strict read). Category: retained mismatched/ambiguous negative in R4 items 8/9. The runtime pane-get identity check is fixed; core process-info lacks the equivalent check.

Query `w7:p1`, reply `{"result":{"process_info":{"pane_id":"w99:p8","foreground_processes":[]}}}`. `isHerdrProcessRunning('w7:p1',/codex/)` resolves false. A valid bash entry for the other pane does the same. This field is part of the repository's existing Herdr process-info fixture, not an invented envelope field. A built shell stand-in independently produces false. Two lifecycle polls then write `killed` while the runtime answers alive. Validate the process-info pane identity before using its list as evidence about the requested pane.

Also, an exit-0 object containing both `error:{code:'pane_not_found'}` and a successful result for the live requested pane returns `[]` in core and false in runtime. The response is contradictory; the literal error code alone is not well-formed absence. Reject conflicting envelopes. Unknown-code controls reject; a lone `pane_not_found`, same-pane empty list, and same-pane replaced terminal retain their negatives. A malformed numeric `terminal_id` currently produces true; that observation preserves resources and is not counted as an additional destructive finding.

### M-4 — tmux negative classifier ignores target identity and failure type

Locations: `packages/plugins/agent-codex/src/index.ts:574`–`:580`, `agent-gemini/src/index.ts:205`–`:211`, `agent-opencode/src/index.ts:1331`–`:1337`, and its send probe `:671`–`:677`. Category: retained failure in the classifier introduced/reworked by R4 item 10/11, not a request to implement R2b's server identity.

For requested `review-1`, each agent returns false on `code:1, stderr:"can't find session: unrelated\n"`. It also returns false for `server unavailable\nno current target\n`, and for a killed/SIGTERM command carrying a missing-target line. The multiline prefix match checks neither the whole diagnostic, its subject, nor whether the command completed normally. Nine direct rejection assertions fail. The lifecycle wrong-target case becomes killed after two polls, and the OpenCode send wrong-target case raises AgentNotAttachedError immediately. Require the command's ordinary explicit-missing result for the actual target; contradictory lines and timeout/signal failures must stay unknown. The matching-target `code:1` control remains false.

### M-5 — malformed holder records still count as naming no OpenCode session

Locations: `packages/core/src/session-manager.ts:1026` and `:1031`–`:1032`; parser behavior at `packages/core/src/key-value.ts:14`, reached through `readRecordStrict` / `readArchivedMetadataRaw`. Category: retained fail-open interpretation in the active/latest-archive reads that R4 items 3/4 changed. The shared lenient parser predates R4, but these newly strict decision reads still trust its partial result; the brief explicitly includes defects left in changed code.

A record containing `opencodeSessionId\n` (missing delimiter/value) parses to `{}`. The strict checks do not distinguish this malformed record from a valid record that names another session. Using the existing R4 cleanup fixture, put that content in active `app-2` or latest archive `app-2_2026-10-20T00-00-00-000Z`. Cleanup archives app-1 and calls `removeOpenCodeSession('ses_shared',10000,undefined)` in both cases. It reports no errors. The two rejection/kept assertions fail. This is not merely candidate enumeration: the deletion API is reached despite the unreadable meaning of the other record.

For these destructive checks, preserve parse failure as held, rather than accepting a partial/empty parse. Valid comments and blank lines can remain legal, and a well-formed record with no mapping can remain a non-holder. The two file-system reproducers and exact API calls are retained below. No actual OpenCode resource was removed.

## Other R4 reads and caller availability

| Item | Verified behavior and remaining limit |
| --- | --- |
| 1 archive allocation | `session-manager.ts:688`, `:1264`, `:1319`: strict listing before reservation. ELOOP/EACCES refuse with directory, cause and make-readable/retry instruction; ENOENT allocates. Side-effect tests pass. |
| 2 active holder listing | `:1024` via `listRecordIds`: unreadable entry keeps the resource; no unreadable-entry omission found. |
| 3 active holder content | `:1026`: ordinary I/O rejection is held; malformed content remains M-5. |
| 4 latest archive content | `:1028`–`:1032`: failed read/null is held; malformed non-null content remains M-5. |
| 5 recovery path | `recovery/validator.ts:86`: lstat failures other than ENOENT set probeError and skip. |
| 6 recovery workspace probe | `:94`–`:98`: rejection remains probeError/skip, with `Liveness unknown (...); no action`; explicit false remains missing. |
| 7 worktree exists | Git proof is now specific to its complete discovery diagnostic in C; lstat ENOENT false, successful true true, all checked other Git errors reject. M-1 closed. |
| 8 core Herdr | Command failures and malformed entries reject with contextual cause; explicit absence controls pass. M-3 remains. |
| 9 runtime Herdr | Wrong pane-get identity now rejects, same pane/replaced terminal stays false; ambiguous envelopes remain M-3. |
| 10 agent liveness | Ordinary exec errors and original malformed success cases reject; M-2/M-4 remain. |
| 11 OpenCode send/launch | Rejections reach `cannot check the OpenCode TUI of ...` and avoid restore; launch fails promptly. M-2/M-4 still produce AgentNotAttachedError. |
| R2a m-1 text | Active restore refusal correctly says this restore did not change the record/workspace. Existing refusal assertions pass. |

The lifecycle retries unknown probes on later polls; two confirmed negatives remain required. Built status is read-only and shows null activity on rejection, but it does not show the probe's cause or a repair command. That existing presentation limits diagnosis of a persistent unknown; it does not convert unknown to death. An overloaded host's timeout is retried, not cached permanently. M-2/M-3/M-4 can still bypass the gate by producing false rather than rejecting.

Kill/cleanup retain the R2a confirmed-stop gate and report `kept`, the runtime/session, and manual check/retry guidance. Herdr stop intentionally refuses with its manual-close instruction. A retry alone cannot resolve that refusal. With no tmux server, old kill/cleanup/restore refusals persist until a server can answer; the old lifecycle no-server bound remains F-1. A dead retained tmux pane still has its TTY (independently checked); a manually removed worktree gives ENOENT and stays a usable negative. Neither ordinary case is made permanently unknown by the new parser.

Restore now refuses before stop/recreation for dubious ownership and includes Git's first stderr line; fixing repository ownership/configuration and retrying is the right next action. The CLI does not include Git's subsequent safe.directory recipe, but the named cause and path are useful. Recovery names the failed read and performs no action; retry after fixing that read is appropriate. OpenCode removal retains unknown I/O holders, with the existing holder message; M-5 means malformed content still bypasses that retention.

Availability limit: Herdr negatives require an exit-0 structured envelope. A version that exits nonzero even for a missing pane will remain unknown. The brief expressly demands exec failures reject and forbids a real Herdr check, so this is a documented protocol assumption, not a claimed live compatibility test.

## Test oracles, scope and commits

Only two existing test bodies change their name and oracle: Codex `index.test.ts:478` (empty TTY false → rejects), and runtime-herdr `__tests__/index.test.ts:449` (exec Error('pane_not_found') false → rejects). Their inputs/setup are unchanged. Both are permitted by Amendment 1; separate explicit-gone controls remain. No old assertion was weakened.

`workspace-worktree/__tests__/exists-strict.test.ts` additionally extends its shared harness to capture exec options and optionally call real Git, with both added flags reset in beforeEach. These changes support added tests in an already allowed test file and preserve all preexisting test inputs/oracles; they are not oracle exceptions for an out-of-scope file. No defect markings or unrelated source regions changed in round 2.

The five commits form the single-parent line `fa2f7ac8 → 0cba3f4d → 862f0418 → 54103971 → 86cecef4 → 8e9efe95`. Conventional fix/docs subjects and substantive WHY bodies; no Co-Authored-By, emoji or issue number. `git branch -r --contains 8e9efe95` printed nothing. The round-2 diff is 15 files, +795/-62. No branch operation, index edit, commit, rebase, pull, push or PR was performed by this reviewer.

## Follow-ups (not landing conditions)

- **F-1:** R2b runtime launch/server identity and the legacy default-socket/no-server-bound limits, unchanged.
- **F-2:** R3 operation/workspace/OpenCode ownership serialization; the six R3 red defects remain.
- **F-3:** Cleanup still selects the project runtime instead of the stored handle's runtime (`session-manager.ts:3409` vicinity); mismatched selection can retain a session indefinitely. Unchanged by R4.
- **F-4:** Older missing/malformed runtime identity and unloaded-plugin guards in kill/recovery remain outside these reads.
- **F-5:** Unchanged remap path's lenient `findLiveOpenCodeSessionHolder` enumeration can omit an unreadable holder; removal routes have separate guards. No new remap-race experiment claimed.
- **F-6:** Claude Code's tmux `findClaudeProcess` still filters malformed successful TTY/ps replies to no process (`agent-claude-code/src/index.ts:599` vicinity). That source was not changed by R4. Source-confirmed and also disclosed by the author; not a new independent Claude caller run.

What is correct: the original r1 reproducers all close; M-1 preserves the actual repository and refuses before side effects; whole-list validation catches the original malformed cases; command errors retain their cause; all explicit-gone controls tested remain useful; strict archive allocation and recovery retention pass their no-side-effect/skip tests; mutations prove the new regression tests are non-vacuous; the clean merge retains the Codex send fix and passes its suites.

## Work log and retained execution evidence

Review in progress for `75f1c98b..8e9efe95`; round-2 delta `fa2f7ac8..8e9efe95`. No production edits, commits, push, PR, network gh, real agent or Herdr invocation. Every executable check uses `/tmp/aor4r2/run`: env -i, fake HOME/TMPDIR, scratch AO paths, gh stand-in, and private tmux shim (`-f /dev/null -L aor4r2-review`). Marker created before checks. Author report remains unread pending independent source and boundary checks.

## Initial isolation evidence

Before `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git

```

## Independent closure runs (author report unread)

Copied r1's 17-case boundary suite and three-case lifecycle probe from its retained fenced source into archived `fa2f7ac8` and `8e9efe95` scratch trees. Per-copy aliases resolve core source and subpaths locally. Local Vitest: base 5 pass/15 fail; tip 20 pass/0 fail. The 14 strict boundaries change from rejection-assertion failures to passes; lifecycle malformed-success changes from `killed` to `working`; the 3 direct live/dead and 2 lifecycle controls retain their outcomes.

Frozen install and build exit 0. First filtered gate failed six paths.test.ts assertions because the review harness used `/tmp/aor4r2/state`, whereas these tests require a `.agent-orchestrator` component. Corrected the scratch override to `/tmp/aor4r2/home/.agent-orchestrator` (still isolated); retain the initial failure and rerun. No production fix was involved.

Source hypotheses under independent testing: core Herdr process-info does not compare its pane_id with the requested pane; agent ps validation accepts zero/unsafe PIDs; tmux negative classifier matches a line without verifying target or command-failure type. These are not yet final findings.

## Confirmed new boundaries

Independent 45-case boundary suite: 25 pass, 20 rejection assertions fail on tip. The failures include impossible PID rows in all three agents (6), wrong-target/contradictory/signalled tmux diagnostics (9), core Herdr process-info for another pane (2), contradictory error+result envelopes (2), and runtime Herdr's malformed terminal field returning true (1; preserves resources, not a destructive negative). Ordinary controls still pass.

Caller probes independently confirm that two polls persist `status=killed` for wrong Herdr process-info identity, unsafe ps PID, and mismatched tmux missing target. OpenCode send still raises AgentNotAttachedError for unsafe ps PID and wrong-target diagnostic; the old r1 malformed-success send case now passes. Original send probe: base 0 pass/1 fail, tip 1 pass/0 fail; the two new send cases fail on tip. No API prompt/model call is made.

Real built Git reproduction: a valid repository at `/tmp/aor4r2/live/not a git repository`, with `GIT_TEST_ASSUME_DIFFERENT_OWNER=1`, now rejects with the dubious-ownership first line. Restore counts `stopped=0, restored=0, created=0`; metadata before/after identical; repository remains valid. Base counts `stopped=1, restored=1, created=0` (review stand-in stops before actual recreation). Built Herdr stand-in reproduces the r1 fixes and the new wrong-process-info-pane false. Built CLI status gives null activity for ordinary error and malformed ps, leaves records unchanged; tip lifecycle keeps both working and kills only valid-dead control. All checks use scratch state.

The additional holder probe is now confirmed through cleanup, not only a helper return: a record with the malformed line `opencodeSessionId` (no `=`), in either active `app-2` or its latest archive, parses to `{}`. The changed strict holder reads accept that as naming nothing; cleanup removes `ses_shared` through the mocked API and archives `app-1`. Active result: `killed=[app-1,app-2], skipped=[], errors=[]`; archive result: `killed=[app-1], skipped=[app-2], errors=[]`. Both call `removeOpenCodeSession('ses_shared',10000,undefined)`. No real OpenCode process/API ran.

Independent source/items 1–3 complete before author report read. Author's section 8 adds an older Claude malformed-success gap, consistent with source and outside R4 changes; retained as a follow-up. Its Herdr exit-0 protocol assumption is an explicit availability limitation, not verified against a real Herdr because the brief forbids one.

All corrected gates now exit 0, including full `pnpm -r --no-bail test`. The initial full gate had the same scratch-path issue in six core and two integration assertions. Lint exits 0 with the same five warnings. Merged build and seven requested package suites exit 0. Captured main `3261212a84984d517fcc176f38cc85230de5cabb`, base `75f1c98be3b45b37c51cc8eb665f0d01149a55e7`, clean merged tree `9a02d0753a1e305a29a84a2b67e1e90cab6a8cc5`.

Own private tmux availability control: `aor4r2-availability`, server PID 2407773 and pane PID 2407786. Live: `/dev/pts/8`, pane_dead=0; after sleep exits: `/dev/pts/8`, pane_dead=1. Dead pane retains the TTY, so that normal case is not newly unknown. Server stopped by exact PID 2407773; no kill-server or patterned kill.

## Gate commands and summary lines

All commands below ran from the review worktree through `/tmp/aor4r2/run` (env -i). Install used `HUSKY=0` to avoid hooks configuration writes. Package scripts resolve their local Vitest, not an online runner.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree --filter @aoagents/ao-plugin-agent-claude-code --filter @aoagents/ao-plugin-agent-codex --filter @aoagents/ao-plugin-agent-gemini --filter @aoagents/ao-plugin-agent-opencode --filter @aoagents/ao-integration-tests test
pnpm lint
pnpm typecheck
pnpm -r --no-bail test
```

```text
install exit 0
build exit 0
lint exit 0: 5 problems (0 errors, 5 warnings)
typecheck exit 0
filtered corrected exit 0
full corrected exit 0
```

filtered-corrected (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1581 passed | 1 expected fail (1582)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  56 passed (56)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  78 passed (78)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  233 passed (233)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  342 passed (342)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

full-corrected (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1581 passed | 1 expected fail (1582)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  78 passed (78)
packages/plugins/agent-codex test:  Test Files  5 passed (5)
packages/plugins/agent-codex test:       Tests  233 passed (233)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  5 passed (5)
packages/plugins/agent-claude-code test:       Tests  215 passed (215)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  56 passed (56)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  342 passed (342)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  277 passed (277)
```

merged-test (exit 0):

```text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1581 passed | 1 expected fail (1582)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  78 passed (78)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  56 passed (56)
packages/plugins/agent-codex test:  Test Files  6 passed (6)
packages/plugins/agent-codex test:       Tests  293 passed (293)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  85 passed (85)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  342 passed (342)
packages/cli test:  Test Files  22 passed (22)
packages/cli test:       Tests  305 passed (305)
```

Merged scratch tree command: `git merge-tree --write-tree 3261212a84984d517fcc176f38cc85230de5cabb 8e9efe95`, then `git archive 9a02d0753a1e305a29a84a2b67e1e90cab6a8cc5 | tar -x -C /tmp/aor4r2/merged`; build there, then the core, CLI, agent-codex, agent-gemini, agent-opencode, runtime-herdr and workspace-worktree filters. Each package node_modules preserves workspace-relative links into the merged packages; only external dependency store is shared with this worktree. Build output:

```text
packages/core build: Done
packages/plugins/agent-gemini build: Done
packages/plugins/agent-claude-code build: Done
packages/plugins/agent-opencode build: Done
packages/plugins/agent-codex build: Done
packages/plugins/notifier-desktop build: Done
packages/plugins/scm-github build: Done
packages/plugins/runtime-herdr build: Done
packages/plugins/runtime-tmux build: Done
packages/plugins/tracker-github build: Done
packages/plugins/workspace-worktree build: Done
packages/cli build: Done
```

`SAME_ID_DEFECTS=red`, all source same-id-defects / same-id-reuse-window files with local core source aliases:

| Round | fa2f7ac8 fail/pass | 8e9efe95 fail/pass |
| --- | --- | --- |
| R1 | 0/17 | 0/17 |
| R2 | 16/20 | 16/20 |
| R3 | 6/0 | 6/0 |
| R4 | 0/33 | 0/33 |

The first base glob also picked up compiled dist test duplicates because the base had been built. Reran with `--exclude **/dist/**`; the table uses that source-only run. Red-mode exit 1 is the expected 22 older failures.

## Mutants

Scratch tip source only; restored in finally after each run. One initial harness attempt could not locate the next method after isProcessRunning; it made no source change and was corrected before M-2 ran. The selected normal tests pass in the gates, and the new own-case control passes separately.

| Mutant | Passing | Failing |
| --- | ---: | ---: |
| M-1: whole diagnostic back to substring | 12 | 3 |
| M-2: Codex isProcessRunning back to fa2f7ac8 | 168 | 5 |
| M-3: core/runtime Herdr back to fa2f7ac8 | 61 | 13 |
| Own mixed-TTY case, no mutation | 1 | 0 |
| Own: Codex TTY every → some | 0 | 1 |

mutant-M1 failing tests:

```text
same-id R4 round 2 (review r1, M-1): only git's whole discovery diagnostic is absence rejects git's exit 128 for dubious ownership of a path that holds 'not a git repository'
  Error: promise resolved "false" instead of rejecting
same-id R4 round 2 (review r1, M-1): only git's whole discovery diagnostic is absence rejects git's exit 128 when the diagnostic comes with another line
  Error: promise resolved "false" instead of rejecting
same-id R4 round 2 (review r1, M-1): the real git binary rejects a repository at a path named 'not a git repository' that git refuses (dubious ownership)
  AssertionError: expected false to be an instance of Error
```

mutant-M2 failing tests:

```text
isProcessRunning rejects when tmux list-panes returns empty
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when tmux answers text that is not a pane TTY
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when ps succeeds with a reply that is not a process list
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when ps answers only its header
  Error: promise resolved "false" instead of rejecting
isProcessRunning rejects when one ps row is malformed
  Error: promise resolved "false" instead of rejecting
```

mutant-M3 failing tests:

```text
getHerdrPaneProcesses: only well-formed evidence is a negative rejects a command that fails with a server_unavailable envelope that mentions pane not found
  Error: promise resolved "[]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects a herdr that cannot start at a path that holds pane_not_found
  Error: promise resolved "[]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects the whole reply for an entry with an argv that is not a list of text
  Error: promise resolved "[ { pid: 7, name: 'bash', …(1) }, …(1) ]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects the whole reply for an entry with no pid
  Error: promise resolved "[ { pid: 7, name: 'bash', …(1) }, …(1) ]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects the whole reply for an entry with a pid that is not a positive integer
  Error: promise resolved "[ { pid: 7, name: 'bash', …(1) }, …(1) ]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects the whole reply for an entry with a name that is not text
  Error: promise resolved "[ { pid: 7, name: 'bash', …(1) }, …(1) ]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative rejects the whole reply for an entry with a cmdline that is not text
  Error: promise resolved "[ { pid: 7, name: 'bash', …(1) }, …(1) ]" instead of rejecting
getHerdrPaneProcesses: only well-formed evidence is a negative isHerdrProcessRunning rejects a malformed argv instead of answering 'no agent'
  Error: promise resolved "false" instead of rejecting
isAlive() rejects when the herdr command fails with text that names pane_not_found
  Error: promise resolved "false" instead of rejecting
isAlive(): only well-formed evidence is a negative rejects when herdr fails with a server_unavailable envelope that mentions pane not found
  Error: promise resolved "false" instead of rejecting
isAlive(): only well-formed evidence is a negative rejects when the herdr binary cannot start at a path that holds pane_not_found
  Error: promise resolved "false" instead of rejecting
isAlive(): only well-formed evidence is a negative rejects an error envelope without a code whose message says pane not found
  Error: promise resolved "false" instead of rejecting
isAlive(): only well-formed evidence is a negative rejects a reply for another pane, also with another terminal
  Error: promise resolved "false" instead of rejecting
```

mutant-own failing tests:

```text
codex rejects mixed tty
  Error: promise resolved "false" instead of rejecting
```

## Executed result excerpts


git-live-base:

```text
VALID REPOSITORY /tmp/aor4r2/live/not a git repository true
fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository'
To add an exception for this directory, call:

	git config --global --add safe.directory '/tmp/aor4r2/live/not a git repository'
GIT FAILURE {"status":128,"stderr":"fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory '/tmp/aor4r2/live/not a git repository'\n"}
PLUGIN EXISTS UNDER DUBIOUS OWNERSHIP { value: false }
RESTORE {"message":"Workspace missing at /tmp/aor4r2/live/not a git repository: restore failed: review blocked actual recreation","stopped":1,"restored":1,"created":0,"before":{"worktree":"/tmp/aor4r2/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"2"},"after":{"worktree":"/tmp/aor4r2/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"2"}}
REPOSITORY STILL VALID true
```

git-live-tip:

```text
VALID REPOSITORY /tmp/aor4r2/live/not a git repository true
fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository'
To add an exception for this directory, call:

	git config --global --add safe.directory '/tmp/aor4r2/live/not a git repository'
GIT FAILURE {"status":128,"stderr":"fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory '/tmp/aor4r2/live/not a git repository'\n"}
PLUGIN EXISTS UNDER DUBIOUS OWNERSHIP {
  error: "workspace check of /tmp/aor4r2/live/not a git repository could not run: git rev-parse --is-inside-work-tree failed (fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository')"
}
RESTORE {"message":"workspace check of /tmp/aor4r2/live/not a git repository could not run: git rev-parse --is-inside-work-tree failed (fatal: detected dubious ownership in repository at '/tmp/aor4r2/live/not a git repository')","stopped":0,"restored":0,"created":0,"before":{"worktree":"/tmp/aor4r2/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"1"},"after":{"worktree":"/tmp/aor4r2/live/not a git repository","branch":"main","status":"killed","project":"review","runtimeHandle":"{\"id\":\"old\",\"runtimeName\":\"review\",\"data\":{}}","generation":"1"}}
REPOSITORY STILL VALID true
```

herdr-live-base:

```text
SPAWN ENOENT WITH PHRASE IN BIN PATH { value: false }
EXEC ERROR OTHER CODE {"core":{"value":[]},"runtime":{"value":false}}
SAME ENVELOPE EXIT ZERO core {"error":"herdr pane process-info --pane w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
SAME ENVELOPE EXIT ZERO runtime {"error":"herdr pane get w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
MALFORMED ARGV IS AGENT ABSENT { value: false }
WRONG RESPONSE PANE IS GONE { value: false }
EXPLICIT GONE CONTROLS {"core":{"value":[]},"runtime":{"value":false}}
VALID EMPTY LIST CONTROL []
SAME PANE REPLACED TERMINAL CONTROL false
WRONG PROCESS INFO PANE { value: false }
```

herdr-live-tip:

```text
SPAWN ENOENT WITH PHRASE IN BIN PATH {
  error: 'herdr pane get w7:p1 could not answer: spawn /tmp/aor4r2/live/herdr-probe/pane_not_found/missing-binary ENOENT'
}
EXEC ERROR OTHER CODE {"core":{"error":"herdr pane process-info --pane w7:p1 could not answer: the command failed"},"runtime":{"error":"herdr pane get w7:p1 could not answer: Command failed: herdr pane get w7:p1 {\"error\":{\"code\":\"server_unavailable\",\"message\":\"cannot determine whether pane not found\"}}"}}
SAME ENVELOPE EXIT ZERO core {"error":"herdr pane process-info --pane w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
SAME ENVELOPE EXIT ZERO runtime {"error":"herdr pane get w7:p1 could not answer: herdr error server_unavailable: cannot determine whether pane not found"}
MALFORMED ARGV IS AGENT ABSENT {
  error: 'herdr pane process-info --pane w7:p1 could not answer: a foreground process has an argv that is not a list of text'
}
WRONG RESPONSE PANE IS GONE { error: 'herdr pane get w7:p1 answered for another pane (w99:p8)' }
EXPLICIT GONE CONTROLS {"core":{"value":[]},"runtime":{"value":false}}
VALID EMPTY LIST CONTROL []
SAME PANE REPLACED TERMINAL CONTROL false
WRONG PROCESS INFO PANE { value: false }
```

status-live-base lifecycle before/after (all CLI status calls also assert raw metadata unchanged):

```text
LIFECYCLE error {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"5"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"5"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:29.171Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-4621bcee-68a9-4225-8e04-9a615094fd6f","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
LIFECYCLE malformed {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"6"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"killed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"7","killedReason":"agent-exited"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:29.501Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-0e89e6c0-02c3-4a74-bbbe-e91b8328db13","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
LIFECYCLE dead {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"8"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"killed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"9","killedReason":"agent-exited"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:29.832Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-d5598c75-9cf0-4957-9398-e31395cfa809","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
```

status-live-tip lifecycle before/after (all CLI status calls also assert raw metadata unchanged):

```text
LIFECYCLE error {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"1"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:13.105Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-4b6f9682-efb5-4d06-b798-873842159cf0","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
LIFECYCLE malformed {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"2"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"2"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:13.413Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-922e4c7c-7b6f-4e48-9730-be113dd81cda","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
LIFECYCLE dead {"before":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"working","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"3"},"after":{"worktree":"/tmp/aor4r2/live/status/repo","branch":"main","status":"killed","prAutoDetect":"off","project":"review","agent":"codex","createdAt":"2026-01-01T00:00:00.000Z","runtimeHandle":"{\"id\":\"rv-1\",\"runtimeName\":\"tmux\",\"data\":{}}","generation":"4","killedReason":"agent-exited"},"health":{"surface":"lifecycle.worker","status":"ok","updatedAt":"2026-10-22T03:50:13.795Z","component":"lifecycle-manager","projectId":"review","correlationId":"lifecycle-poll-0cb43021-45c1-4020-aea5-00792204516c","details":{"projectId":"review","sessionCount":2,"activeSessionCount":2}}}
```

metadata-caller-base:

```text
MALFORMED HOLDER active {"killed":["app-1","app-2"],"skipped":[],"errors":[]} remove [ [ 'ses_shared', 10000, undefined ] ]
MALFORMED HOLDER archive {"killed":["app-1"],"skipped":["app-2"],"errors":[]} remove [ [ 'ses_shared', 10000, undefined ] ]
```

metadata-caller:

```text
MALFORMED HOLDER active {"killed":["app-1","app-2"],"skipped":[],"errors":[]} remove [ [ 'ses_shared', 10000, undefined ] ]
MALFORMED HOLDER archive {"killed":["app-1"],"skipped":["app-2"],"errors":[]} remove [ [ 'ses_shared', 10000, undefined ] ]
```

## Reproducers retained after scratch cleanup

The original r1 boundary and send insertion source remains in `main:development/reviews/same_id_r4_review_r1_astra6.md`. Below are this review's exact additional cases and adaptations. They belong only in archived scratch copies. Run under the isolated environment at the top; do not point them at real AO state or put real agent binaries on PATH.


### Per-copy test config

```js
const ROOT='/tmp/aor4r2/tip';
export default { resolve: { alias: [ { find: /^@aoagents\/ao-core\/(.*)$/, replacement: ROOT+'/packages/core/src/$1.ts' }, { find: '@aoagents/ao-core', replacement: ROOT+'/packages/core/src/index.ts' } ] }, test: { maxWorkers: 2, testTimeout: 15000 } };
```

### New boundary suite: core/src/__tests__/review-new-boundaries.test.ts

```ts
import {it,expect,vi,afterEach} from 'vitest';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const exec=vi.hoisted(()=>vi.fn());
vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();const fn=Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec});return {...actual,execFile:fn};});
import {getHerdrPaneProcesses,isHerdrProcessRunning} from '../herdr.js';
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {create as gemini} from '../../../plugins/agent-gemini/src/index.js';
import {create as opencode} from '../../../plugins/agent-opencode/src/index.js';
import {create as herdr} from '../../../plugins/runtime-herdr/src/index.js';
import {create as worktree} from '../../../plugins/workspace-worktree/src/index.js';
afterEach(()=>vi.resetAllMocks());
const h={id:'review-1',runtimeName:'tmux',data:{}};
for(const [name,create] of [['codex',codex],['gemini',gemini],['opencode',opencode]] as const){
 for(const [label,tty,ps] of [
 ['mixed tty','/dev/pts/73\nunavailable\n',' PID TT COMMAND\n123 pts/73 /bin/bash\n'],
 ['missing args','/dev/pts/73\n',' PID TT COMMAND\n123 pts/73\n'],
 ['mixed ps rows','/dev/pts/73\n',' PID TT COMMAND\n123 pts/73 /bin/bash\n???\n'],
 ['zero pid','/dev/pts/73\n',' PID TT COMMAND\n0 pts/73 /bin/bash\n'],
 ['unsafe pid','/dev/pts/73\n',' PID TT COMMAND\n999999999999999999999 pts/73 /bin/bash\n'],
 ] as const)it(`${name} rejects ${label}`,async()=>{exec.mockImplementation(async(cmd:string)=>({stdout:cmd==='tmux'?tty:ps,stderr:''}));await expect(create().isProcessRunning(h)).rejects.toThrow();});
 for(const [label,error] of [
 ['wrong target',Object.assign(Error('failed'),{code:1,stderr:"can't find session: unrelated\n"})],
 ['contradictory stderr',Object.assign(Error('failed'),{code:1,stderr:"server unavailable\nno current target\n"})],
 ['signal with stale diagnostic',Object.assign(Error('timed out'),{code:null,killed:true,signal:'SIGTERM',stderr:"can't find session: review-1\n"})],
 ] as const)it(`${name} rejects tmux ${label}`,async()=>{exec.mockRejectedValue(error);await expect(create().isProcessRunning(h)).rejects.toThrow();});
 it(`${name} explicit missing target control`,async()=>{exec.mockRejectedValue(Object.assign(Error('failed'),{code:1,stderr:"can't find session: review-1\n"}));expect(await create().isProcessRunning(h)).toBe(false);});
}
for(const processes of [[],[{pid:123,name:'bash',cmdline:'bash'}]])it(`core Herdr rejects wrong process-info pane ${processes.length}`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{process_info:{pane_id:'w99:p8',foreground_processes:processes}}}),stderr:''});await expect(isHerdrProcessRunning('w7:p1',/codex/)).rejects.toThrow();});
for(const target of ['core','runtime'] as const){
 const query=()=>target==='core'?getHerdrPaneProcesses('w7:p1'):herdr().isAlive({id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}});
 it(`${target} unknown envelope code`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({error:{code:'unknown_fault',message:'pane_not_found'}}),stderr:''});await expect(query()).rejects.toThrow();});
 it(`${target} rejects contradictory success and missing envelope`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({error:{code:'pane_not_found',message:'gone'},result:{pane:{pane_id:'w7:p1',terminal_id:'term_a'},process_info:{pane_id:'w7:p1',foreground_processes:[{pid:123,name:'codex',cmdline:'codex'}]}}}),stderr:''});await expect(query()).rejects.toThrow();});
 it(`${target} pane_not_found control`,async()=>{exec.mockResolvedValue({stdout:JSON.stringify({error:{code:'pane_not_found',message:'gone'}}),stderr:''});expect(await query()).toEqual(target==='core'?[]:false);});
}
it('core same pane empty list control',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{process_info:{pane_id:'w7:p1',foreground_processes:[]}}}),stderr:''});expect(await getHerdrPaneProcesses('w7:p1')).toEqual([]);});
it('runtime same pane replaced terminal control',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{pane:{pane_id:'w7:p1',terminal_id:'term_b'}}}),stderr:''});expect(await herdr().isAlive({id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}})).toBe(false);});
it('runtime right pane malformed terminal is unknown',async()=>{exec.mockResolvedValue({stdout:JSON.stringify({result:{pane:{pane_id:'w7:p1',terminal_id:12}}}),stderr:''});await expect(herdr().isAlive({id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}})).rejects.toThrow();});
for(const [label,stderr] of [
 ['different locale',"fatal: Kein Git-Repository (oder irgendeines der Elternverzeichnisse): .git\n"],
 ['whole diagnostic in quoted path',"fatal: detected dubious ownership in repository at '/tmp/fatal: not a git repository (or any of the parent directories): .git'\n"],
 ['mixed diagnosis',"warning: I/O trouble\nfatal: not a git repository (or any of the parent directories): .git\n"],
 ['other 128',"fatal: unable to read config file: Input/output error\n"],
] as const)it(`git rejects ${label}`,async()=>{const dir=mkdtempSync(join(tmpdir(),'review-new-git-'));try{exec.mockRejectedValue(Object.assign(Error('failed'),{code:128,stderr}));await expect(worktree().exists!(dir)).rejects.toThrow();}finally{rmSync(dir,{recursive:true});}});
for(const stderr of ['fatal: not a git repository (or any of the parent directories): .git\n','fatal: not a git repository (or any parent up to mount point /mnt)\nStopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).\n'])it('git discovery negative control '+stderr.split('\n')[0],async()=>{const dir=mkdtempSync(join(tmpdir(),'review-control-'));try{exec.mockRejectedValue(Object.assign(Error('failed'),{code:128,stderr}));expect(await worktree().exists!(dir)).toBe(false);}finally{rmSync(dir,{recursive:true});}});
it('missing path control',async()=>{expect(await worktree().exists!('/tmp/aor4r2/nonexistent')).toBe(false);expect(exec).not.toHaveBeenCalled();});
```

### Extended lifecycle caller: core/src/__tests__/review-lifecycle.test.ts

```ts
import {it,expect,vi} from 'vitest';import {mkdirSync} from 'node:fs';import {join} from 'node:path';
const exec=vi.hoisted(()=>vi.fn());vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<typeof import('node:child_process')>();return {...actual,execFile:Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:exec})};});
import {create as codex} from '../../../plugins/agent-codex/src/index.js';
import {createSessionManager} from '../session-manager.js';import {createLifecycleManager} from '../lifecycle-manager.js';import {readObservabilitySummary} from '../observability.js';import {readMetadataRaw,writeMetadata} from '../metadata.js';
import {createMockPlugins,createMockRegistry,createTestEnvironment} from './test-utils.js';
for(const mode of ['exec-error','malformed-success','valid-dead','wrong-herdr-pane','unsafe-ps-pid','wrong-tmux-target'] as const)it(`lifecycle ${mode}`,async()=>{
 const env=createTestEnvironment();const plugins=createMockPlugins(),agent=codex();const readActivity=agent.getActivityState.bind(agent);agent.getActivityState=async(s,t)=>s.id==='app-2'?{state:'active'}:readActivity(s,t);agent.recordActivity=undefined;
 const runtime={...plugins.runtime,name:'tmux',isAlive:vi.fn(async()=>true),getOutput:vi.fn(async()=>''),getMetrics:undefined};const registry=createMockRegistry({runtime,agent}),sm=createSessionManager({config:env.config,registry}),lm=createLifecycleManager({config:env.config,registry,sessionManager:sm,projectId:'my-app'});
 try{for(const id of ['app-1','app-2']){const wt=join(env.tmpDir,id);mkdirSync(wt);writeMetadata(env.sessionsDir,id,{project:'my-app',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:wt,createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id:mode==='wrong-herdr-pane'?'w7:p1':id,runtimeName:mode==='wrong-herdr-pane'?'herdr':'tmux',data:{}})});}
 exec.mockImplementation(async(cmd:string)=>{if(cmd==='herdr')return {stdout:JSON.stringify({result:{process_info:{pane_id:'w99:p8',foreground_processes:[]}}}),stderr:''};if(cmd==='tmux'&&mode==='wrong-tmux-target')throw Object.assign(Error('failure'),{code:1,stderr:"can't find session: unrelated\n"});if(cmd==='tmux')return {stdout:'/dev/pts/73\n',stderr:''};if(cmd==='ps'){if(mode==='exec-error')throw Object.assign(Error('ps unavailable'),{code:1});return {stdout:mode==='unsafe-ps-pid'?' PID TT COMMAND\n999999999999999999999 pts/73 /bin/bash\n':mode==='malformed-success'?'procfs temporarily unavailable\n':' PID TT COMMAND\n123 pts/73 /bin/bash\n',stderr:''};}throw Error('unexpected '+cmd);});
 const listed=await sm.list('my-app');console.log('LIST',mode,listed.map(s=>({id:s.id,status:s.status,activity:s.activity})));
 const health=()=>readObservabilitySummary(env.config).projects['my-app']?.health['lifecycle.worker'];for(let i=0;i<2;i++){const before=health()?.correlationId;lm.start(3600000);lm.stop();await vi.waitFor(()=>expect(health()?.correlationId).not.toBe(before),{timeout:3000,interval:5});}
 const after=readMetadataRaw(env.sessionsDir,'app-1');console.log('AFTER',mode,after);expect(after?.status).toBe(mode==='valid-dead'?'killed':'working');
 }finally{lm.stop();vi.restoreAllMocks();env.cleanup();}
});
```

### Insertion script for holder and OpenCode send probes (also extends r1 lifecycle probe)

```python
from pathlib import Path
p=Path('/tmp/aor4r2/tip/packages/core/src/__tests__/review-lifecycle.test.ts')
s=p.read_text().replace("['exec-error','malformed-success','valid-dead']", "['exec-error','malformed-success','valid-dead','wrong-herdr-pane','unsafe-ps-pid','wrong-tmux-target']")
s=s.replace("id,runtimeName:'tmux',data:{}", "id:mode==='wrong-herdr-pane'?'w7:p1':id,runtimeName:mode==='wrong-herdr-pane'?'herdr':'tmux',data:{}")
s=s.replace("if(cmd==='tmux')return", "if(cmd==='herdr')return {stdout:JSON.stringify({result:{process_info:{pane_id:'w99:p8',foreground_processes:[]}}}),stderr:''};if(cmd==='tmux'&&mode==='wrong-tmux-target')throw Object.assign(Error('failure'),{code:1,stderr:\"can't find session: unrelated\\n\"});if(cmd==='tmux')return")
s=s.replace("stdout:mode==='malformed-success'?", "stdout:mode==='unsafe-ps-pid'?' PID TT COMMAND\\n999999999999999999999 pts/73 /bin/bash\\n':mode==='malformed-success'?")
s=s.replace("name:'tmux',isAlive", "name:'tmux',isAlive")
# registry returns runtime mock for any runtime name, like the original test utilities.
p.write_text(s)
p=Path('/tmp/aor4r2/tip/packages/core/src/__tests__/same-id-r4-strict-reads.test.ts'); s=p.read_text().replace('symlinkSync }','symlinkSync, writeFileSync }')
needle='  it("control: no other record and no archive name the session, so the cleanup removes it",'
insert='''  for (const place of ['active','archive'] as const) it(`review malformed ${place} record keeps possible holder`, async()=>{
    deadOpenCodeSession();
    const dir=place==='archive'?join(ctx.sessionsDir,'archive'):ctx.sessionsDir;
    mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,place==='archive'?'app-2_2026-10-20T00-00-00-000Z':'app-2'),'opencodeSessionId\\n');
    const sm=createSessionManager({config:ctx.config,registry:ctx.mockRegistry});
    const result=await sm.cleanup('my-app');
    console.log('MALFORMED HOLDER',place,JSON.stringify(result), 'remove',api.remove.mock.calls);
    expectKept(result);
  });

'''
assert needle in s;p.write_text(s.replace(needle,insert+needle))
# Add a private OpenCode send case with impossible PID output and one with mismatched missing-target failure.
p=Path('/tmp/aor4r2/tip/packages/plugins/agent-opencode/src/index.test.ts');s=p.read_text(); marker='  // Same-ID R4 (B-7 item 11): only the server\'s answer that the pane does not'
insert='''  for (const mode of ['unsafe-pid','wrong-target'] as const) it(`review send rejects ${mode} without restore`, async()=>{
    mockExecFileAsync.mockImplementation((cmd: string) => {
      if(mode==='wrong-target'&&cmd==='tmux')return Promise.reject(Object.assign(new Error('failed'),{code:1,stderr:"can't find session: unrelated\\n"}));
      return Promise.resolve({stdout:cmd==='tmux'?'/dev/pts/73\\n':'999999999999999999999 pts/73\\n',stderr:''});
    });
    const outcome=await withFakeTimers(()=>agent.deliverMessage!(session(), TEXT));
    const err=(outcome as {error: Error}).error;
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AgentNotAttachedError);
    expect(mockPromptOpenCodeSession).not.toHaveBeenCalled();
  });

'''
p.write_text(s.replace(marker,insert+marker))
```

### Real Git restore probe (REVIEW_OLD=1 for fa2f7ac8)

```js
import {execFileSync} from 'node:child_process';import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r2/live',path=dir+'/not a git repository';
const core=await import(root+'/packages/core/dist/index.js'),paths=await import(root+'/packages/core/dist/paths.js'),ws=(await import(root+'/packages/plugins/workspace-worktree/dist/index.js')).create();
assert.equal(process.env.HOME,'/tmp/aor4r2/home');const git=(...args)=>execFileSync('/usr/bin/git',['-C',path,...args],{encoding:'utf8'}).trim();
mkdirSync(path,{recursive:true});execFileSync('/usr/bin/git',['init',path],{stdio:'ignore'});delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;assert.equal(git('rev-parse','--is-inside-work-tree'),'true');console.log('VALID REPOSITORY',path,await ws.exists(path));
process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER='1';try{git('rev-parse','--is-inside-work-tree');}catch(e){console.log('GIT FAILURE',JSON.stringify({status:e.status,stderr:String(e.stderr)}));}
console.log('PLUGIN EXISTS UNDER DUBIOUS OWNERSHIP',await ws.exists(path).then(value=>({value}),error=>({error:error.message})));
process.env.AO_STATE_ROOT=dir+'/git-state';const configPath=dir+'/git-config.yaml';writeFileSync(configPath,JSON.stringify({defaults:{runtime:'review',agent:'review',workspace:'worktree',notifiers:[]},projects:{review:{path:dir,repo:'review/scratch',sessionPrefix:'rv'}}}));process.env.AO_CONFIG_PATH=configPath;
const config=core.loadConfig(),sessions=paths.getSessionsDir(configPath,dir);mkdirSync(sessions,{recursive:true});let stopped=0,restored=0,created=0;const runtime={name:'review',isAlive:async()=>true,stop:async()=>{stopped++;return {outcome:'absent',evidence:'controlled review outcome'};},create:async()=>{created++;return {id:'new',runtimeName:'review',data:{}};},destroy:async()=>{},getOutput:async()=>'',sendMessage:async()=>{}};const agent={name:'review',processName:'no-model',getLaunchCommand:()=>'/bin/true',getEnvironment:()=>({}),getActivityState:async()=>({state:'active'}),getSessionInfo:async()=>null,isProcessRunning:async()=>true,detectActivity:()=> 'active'};
const workspace={...ws,restore:async()=>{restored++;throw Error('review blocked actual recreation');}};
const registry={get:(slot)=>slot==='runtime'?runtime:slot==='agent'?agent:slot==='workspace'?workspace:null,list:()=>[],register:()=>{},loadBuiltins:async()=>{}};
core.writeMetadata(sessions,'rv-1',{project:'review',status:'killed',branch:'main',worktree:path,runtimeHandle:JSON.stringify({id:'old',runtimeName:'review',data:{}})});
const before=core.readMetadataRaw(sessions,'rv-1'),sm=core.createSessionManager({config,registry});const err=await sm.restore('rv-1').catch(e=>e);console.log('RESTORE',JSON.stringify({message:err.message,stopped,restored,created,before,after:core.readMetadataRaw(sessions,'rv-1')}));assert.equal(stopped,process.env.REVIEW_OLD==='1'?1:0);assert.equal(restored,process.env.REVIEW_OLD==='1'?1:0);assert.equal(created,0);assert.deepEqual(core.readMetadataRaw(sessions,'rv-1'),before);
delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;console.log('REPOSITORY STILL VALID',git('rev-parse','--is-inside-work-tree'));
```

### Built Herdr stand-in probe

```js
import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r2/live/herdr-probe';mkdirSync(dir+'/bin',{recursive:true});
const {isHerdrProcessRunning,getHerdrPaneProcesses}=await import(root+'/packages/core/dist/herdr.js'),{create}=await import(root+'/packages/plugins/runtime-herdr/dist/index.js');
const outcome=async p=>p.then(value=>({value}),error=>({error:error.message}));
const handle={id:'w7:p1',runtimeName:'herdr',data:{terminalId:'term_a'}};
console.log('SPAWN ENOENT WITH PHRASE IN BIN PATH',await outcome(create({binPath:dir+'/pane_not_found/missing-binary'}).isAlive(handle)));
const binary=dir+'/bin/herdr';process.env.PATH=dir+'/bin:'+process.env.PATH;
function shim(stdout,stderr='',exit=0){writeFileSync(dir+'/stdout',stdout);writeFileSync(dir+'/stderr',stderr);writeFileSync(binary,'#!/bin/sh\n/bin/cat '+dir+'/stdout\n/bin/cat '+dir+'/stderr >&2\nexit '+exit+'\n',{mode:0o755});}
const unavailable=JSON.stringify({error:{code:'server_unavailable',message:'cannot determine whether pane not found'}});
shim('',unavailable,1);console.log('EXEC ERROR OTHER CODE',JSON.stringify({core:await outcome(getHerdrPaneProcesses('w7:p1')),runtime:await outcome(create().isAlive(handle))}));
shim(unavailable);for(const [name,fn] of [['core',()=>getHerdrPaneProcesses('w7:p1')],['runtime',()=>create().isAlive(handle)]]){const result=await fn().then(value=>({value}),error=>({error:error.message}));console.log('SAME ENVELOPE EXIT ZERO',name,JSON.stringify(result));assert(result.error);}
shim(JSON.stringify({result:{process_info:{foreground_processes:[{pid:123,name:'node',argv:[12]}]}}}));console.log('MALFORMED ARGV IS AGENT ABSENT',await outcome(isHerdrProcessRunning('w7:p1',/(?:^|\/)codex(?:\s|$)/)));
shim(JSON.stringify({result:{pane:{pane_id:'w99:p8',terminal_id:'other'}}}));console.log('WRONG RESPONSE PANE IS GONE',await outcome(create().isAlive(handle)));
shim(JSON.stringify({error:{code:'pane_not_found',message:'Pane not found'}}));console.log('EXPLICIT GONE CONTROLS',JSON.stringify({core:await outcome(getHerdrPaneProcesses('w7:p1')),runtime:await outcome(create().isAlive(handle))}));
shim(JSON.stringify({result:{process_info:{foreground_processes:[]}}}));console.log('VALID EMPTY LIST CONTROL',await getHerdrPaneProcesses('w7:p1'));
shim(JSON.stringify({result:{pane:{pane_id:'w7:p1',terminal_id:'term_b'}}}));console.log('SAME PANE REPLACED TERMINAL CONTROL',await create().isAlive(handle));
shim(JSON.stringify({result:{process_info:{pane_id:'w99:p8',foreground_processes:[]}}}));console.log('WRONG PROCESS INFO PANE',await outcome(isHerdrProcessRunning('w7:p1',/codex/)));
```

### Built CLI/status probe (REVIEW_OLD=1 for fa2f7ac8)

```js
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const root=process.cwd(),dir='/tmp/aor4r2/live/status';mkdirSync(dir+'/bin',{recursive:true});mkdirSync(dir+'/repo',{recursive:true});
const clean={...process.env};assert.equal(clean.HOME,'/tmp/aor4r2/home');
writeFileSync(dir+'/bin/tmux',`#!/bin/sh
case "$1" in
 has-session) exit 0;;
 list-panes) printf '/dev/pts/73\\n'; exit 0;;
 capture-pane) exit 0;;
 display-message) printf '1\\n'; exit 0;;
 list-sessions) exit 0;;
 *) echo 'review tmux stand-in refuses command' >&2; exit 97;;
esac
`,{mode:0o755});
writeFileSync(dir+'/bin/ps',`#!/bin/sh
mode=$(/bin/cat '${dir}/mode')
case "$mode" in
 error) echo 'review ps unavailable' >&2; exit 1;;
 malformed) echo 'procfs temporarily unavailable'; exit 0;;
 dead) printf ' PID TT COMMAND\\n123 pts/73 /bin/bash\\n'; exit 0;;
esac
exit 97
`,{mode:0o755});
process.env.PATH=dir+'/bin:'+clean.PATH;process.env.AO_STATE_ROOT=dir+'/state';process.env.AO_CONFIG_PATH=dir+'/config.yaml';
writeFileSync(process.env.AO_CONFIG_PATH,JSON.stringify({defaults:{runtime:'tmux',agent:'codex',workspace:'worktree',notifiers:[]},projects:{review:{path:dir+'/repo',repo:'review/scratch',sessionPrefix:'rv',defaultBranch:'main'}}}));
const core=await import(root+'/packages/core/dist/index.js'),paths=await import(root+'/packages/core/dist/paths.js');const config=core.loadConfig(),registry=core.createPluginRegistry();for(const p of ['runtime-tmux','agent-codex','workspace-worktree'])registry.register((await import(root+'/packages/plugins/'+p+'/dist/index.js')).default);
const sessions=paths.getSessionsDir(config.configPath,dir+'/repo');mkdirSync(sessions,{recursive:true});
const agent=registry.get('agent','codex'),original=agent.getActivityState.bind(agent);agent.getActivityState=(s,t)=>s.id==='rv-2'?Promise.resolve({state:'active'}):original(s,t);
const sm=core.createSessionManager({config,registry});
for(const mode of ['error','malformed','dead']){
 writeFileSync(dir+'/mode',mode);for(const id of ['rv-1','rv-2'])core.writeMetadata(sessions,id,{project:'review',agent:'codex',status:'working',branch:'main',prAutoDetect:'off',worktree:dir+'/repo',createdAt:'2026-01-01T00:00:00.000Z',runtimeHandle:JSON.stringify({id,runtimeName:'tmux',data:{}})});
 const before=core.readMetadataRaw(sessions,'rv-1');const cli=execFileSync(process.execPath,[root+'/packages/cli/dist/index.js','status','--json','-p','review'],{env:process.env,encoding:'utf8'});console.log('CLI STATUS',mode,cli.trim());assert.deepEqual(core.readMetadataRaw(sessions,'rv-1'),before);
 const lm=core.createLifecycleManager({config,registry,sessionManager:sm,projectId:'review'}),health=()=>core.readObservabilitySummary(config).projects.review?.health['lifecycle.worker'];try{for(let i=0;i<2;i++){const previous=health()?.correlationId;lm.start(3600000);lm.stop();const end=Date.now()+3000;while(health()?.correlationId===previous&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.notEqual(health()?.correlationId,previous);}}finally{lm.stop();}
 const after=core.readMetadataRaw(sessions,'rv-1');console.log('LIFECYCLE',mode,JSON.stringify({before,after,health:health()}));assert.equal(after.status,mode==='dead'||(process.env.REVIEW_OLD==='1'&&mode==='malformed')?'killed':'working');
}
console.log('LIVE STATUS COMPLETE');
```

Local Vitest command pattern (select matching test filename/title for each probe):

```sh
/tmp/aor4r2/run node packages/core/node_modules/vitest/vitest.mjs run --root /tmp/aor4r2/tip --config /tmp/aor4r2/tip/review.config.mjs review-new-boundaries --reporter=json --outputFile=/tmp/aor4r2/logs/new-tip.json
```


## Final isolation and cleanup audit

No own live processes remain. The in-process lifecycle managers were stopped; no lifecycle worker was spawned. Foreground build/test/CLI/stand-in commands completed. Integration private servers ended with their sessions. The one separately started availability server was stopped by exact PID 2407773 after its sleep pane exited. No protected session, real worker or watcher was signalled. No pkill, killall, patterned kill, default tmux call, real Herdr/OpenCode/agent invocation, network gh, push or PR.

/proc environment audit for scratch HOME/TMPDIR/AO_STATE_ROOT, excluding only the audit and its ancestors:

```json
{
  "ownLiveProcesses": [],
  "availabilityPids": [
    {
      "pid": 2407773,
      "state": "absent"
    },
    {
      "pid": 2407786,
      "state": "absent"
    }
  ]
}
```

Private-server checks:

```text
no server running on /tmp/tmux-44402/aor4r2-review
no server running on /tmp/tmux-44402/aor4r2-availability
```

After `ls -la --time-style=full-iso ~/.ao/bin` (byte-identical to the before listing):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state check:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor4r2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
```

Every printed path is accounted for: `sessions/ao-55` is the real fleet's external status update (status=stuck, generation=27, mtime 2026-10-21 23:50:35.762239421 -0400); the `sessions` directory has that same mtime from the record's atomic rename. This is consistent with the real lifecycle worker's update of the author's idle session. Metadata alone does not identify its writer PID. The review never used that state root, config or session ID for an operation; all executable probes and writes were under the scratch HOME/state roots. Neither printed path is a reviewer write. The review's own ao-60 record is not in this list.

Harness details disclosed: the first gate override used `/tmp/aor4r2/state` and caused 8 path-format assertions across core/integration; the corrected `.agent-orchestrator` scratch path passes. The initial tmux shim inherited only the two scratch AO overrides from env -i; it was tightened to start tmux with no AO_* at all. No real AO variable or host path was inherited in either version. All tests/probes remained private.

Final `git diff --quiet` exits 0; HEAD remains `8e9efe95afe3bc6dd9912f8c3c726ed0366d0449`; `git branch -r --contains 8e9efe95` prints nothing. Reviewer notes/report are uncommitted. Mutated scratch production files compare byte-for-byte with the worktree before removal.

Final cleanup verified: `/tmp/aor4r2`, `/tmp/aor4r2-marker`, and both exact owned private tmux socket paths removed. `/tmp/aor4` was not modified. Own live process list was empty before removal. Only the requested review and report artifacts remain uncommitted.
