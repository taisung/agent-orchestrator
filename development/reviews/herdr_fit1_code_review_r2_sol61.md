# Herdr fit-1 note 2 landing check (sol)

LAND-WITH-CHANGES

**0 blocking, 0 major, 3 minor new findings.** The authorized M-1 fix works, both reader test gaps are closed, and the gates pass. The remaining changes requested here are documentation corrections. The owner-accepted direct isolated core, done-record and handleless limits are not reopened. Reviewed `9d51982b..ee3534d7`; dispatched 2026-10-22, checks completed after midnight on 2026-10-23 EDT.

## State of the r1 findings

| Prior finding | State after note 2 | Evidence |
| --- | --- | --- |
| Sol M-1, held-live record passed over | **Closed within the owner-approved scope.** A held record is never reused; without another reusable candidate it refuses, in both modes. | Four supplied real-core cases and independent actual-outage/recovery probes pass; no runtime/workspace create or second record. Another live non-terminal candidate may still be reused; new m-2 corrects the documentation of that exception. |
| Sol M-2, direct isolated core startup | **Deferred and explicitly accepted until fit-2 G.** | Allocation is unchanged. Both docs and the guard comment name the absence of an old-record check. The owner is told not to call isolated `spawnOrchestrator` from other tools/scripts. |
| Sol m-1, extra trailing LF coverage | **Closed.** | Reader and both R4 callers pass on tip and reject the strip-all-LF mutant with five failing tests. |
| Muse m-1, no-server prefix position | **Closed.** | Reader and both R4 callers reject the includes mutant with three failing tests. |

The intentional done-record behavior remains: a stored done record is not added to the CLI startup candidates. Its unchanged control passes in both modes. The docs warn that isolated start can create another orchestrator while its pane remains live and tell the owner to check that it has ended first. The handleless reservation/create-in-progress path is still unchecked; the docs instruct the owner to avoid overlapping starts/spawns. These are accepted limits, not findings here. The `merged` example in that text needs correction for the reason in m-3.

## New findings (IDs local to this review)

### m-1 — The only retirement recipe needs to create its archive directory

**File:** `docs/DEVELOPMENT.md:617` (step 3), alongside the new claim at `:607` that only the hand edit clears the record.

A fresh sessions directory need not contain `sessions/archive`. Kill refuses and cleanup skips the orchestrator without creating it. Moving the record to the documented `sessions/archive/<id>_<UTC time>` target therefore fails with ENOENT for the first retained Herdr record.

**Measured:** used the built CLI, real core/registry/runtime-herdr, scratch config/state/worktrees and no Herdr/agent binary. Across pre-fit main and the tip, both workspace modes and the three refusal contexts, all 12 cases retained the record/worktree after kill/cleanup. All 12 first moves failed ENOENT because the archive directory did not exist. Creating that directory and repeating the move succeeded and removed the active record. For example:

```text
{"tree":"tip","mode":"isolated","answer":"alive-terminal","kill":1,"cleanup":0,"recordAndWorktreeKept":true,"archiveExistedBeforeMove":false,"firstMove":"ENOENT","afterMkdirMove":"success"}
```

**Change requested:** explicitly create the archive directory if absent before step 3; use the actual project sessions directory and an unused archive destination. This is a pre-existing omission in the recovery recipe, now reasserted as the only recovery. It is not a new runtime trap caused by fit-1.

### m-2 — Docs and the guard comment describe a conditional refusal as unconditional

**Files:** `docs/DEVELOPMENT.md:599`, `:610`; `packages/cli/src/commands/start.ts:917`, `:1095`. Actual condition: `start.ts:1130`.

The text says that a held record answering alive refuses startup with exit 1. In code, refusal is conditional on `existingOrchestrators.length === 0`. If another live non-terminal (or eligible unchecked) record is reusable, startup succeeds using it and prints no held-record refusal. The new control at `packages/cli/__tests__/commands/start.test.ts:1378` explicitly requires that behavior in both modes and passes in the full gate.

This exception creates no new runtime and does not reuse the terminal record, so it does not undermine the M-1 safety fix. The author's N2.1 report accurately describes it, but the operator documentation and code comment omit the qualification.

**Change requested:** say that a held record is not reusable and blocks creating a new orchestrator; when no other record can be reused, startup exits 1 with the still-runs refusal. Apply the same qualification to unknown/no-server refusal wording where it currently promises an unconditional exit. Preserve the safe non-terminal reuse control.

### m-3 — A stored merged orchestrator is repaired before startup, so it is not an example of the unprobed terminal limit

**Files:** `docs/DEVELOPMENT.md:603`, `packages/cli/src/commands/start.ts:924`. Existing behavior: `packages/core/src/session-manager.ts:507`, `:839`.

Both texts list `merged` among persisted terminal statuses that are not probed. Real `sm.list()` first repairs orchestrator metadata: `STALE_PR_OWNERSHIP_STATUSES` includes merged, and `repairSingleSessionMetadataOnRead` writes its status to working. Startup then sees that repaired record. With an exited agent activity it is held and checked; with a healthy non-terminal result it can be reused.

**Measured:** seeded a merged Herdr orchestrator in each mode in the real-core CLI harness, returned a live pane with activity exited, and called start. Both runs changed the stored status from merged to working, refused with the still-runs text and made zero runtime creates:

```text
{"mode":"isolated","persistedBefore":"merged","persistedAfter":"working","result":"process.exit(1)","creates":0}
```

**Change requested:** describe the terminal exclusion in terms of the status remaining after core's existing repair, and remove merged as an unconditional example. Done and errored remain examples of the accepted limit. Do not change the repair or add a refusal for done.

## Independent behavior checks

Read all six changed-file diffs and the owner/implementer note before reading the author's N2 report. Only `start.ts` changes product behavior; core/runtime-herdr product readers and stop logic do not change in this note. No unrelated source or oracle changes were found.

The supplied real-core CLI harness uses recorded live pane/process fixtures rewritten to its test IDs. The four new cases cover project/isolated × persisted killed/working with activity exited. They exit 1 with the exact record/pane-specific still-runs text, call neither runtime.create nor workspace.create, keep the active record and directory keys, and add no second record. The known list repair may add prAutoDetect=off and advance generation; those two fields are explicitly excluded from that harness's unchanged-record comparison.

I independently extended a scratch copy of that harness to run the actual lifecycle transition rather than merely seed a killed record:

1. Seed a working Herdr orchestrator and return the recorded F1 no-server answer.
2. Call the real lifecycle check at the initial time and at `NO_SERVER_BOUND_MS`; verify persisted killed/runtime.
3. Return the recorded live pane answer and call the real CLI startup.
4. Verify exit 1, the still-runs refusal, no create, no second record and exact record equality to the post-outage record.

Both modes passed. Independent live non-terminal controls, with a stand-in agent present in process-info, were reused with no create in both modes. Together with the original 12 harness cases these were 16 passing tests. Two further stored-handle spawning/activity-exited probes also pass on the tip.

The refusal names the record, current terminal state and pane, offers `ao session attach <id>`, and points to manual retirement after closing the pane. It does not tell the operator that ordinary kill now works. The old false/no-server refusal path and presentation remain unchanged; original integration/unit cases still pass.

## Test sensitivity and partial-fix probe

All mutations were made only in scratch copies, with dependent core rebuilt when its parser changed.

| Variant | Tests run | Result and decisive reason |
| --- | ---: | --- |
| Tip product with tip tests | Full suite | Pass; totals below |
| Note-2-base product (restore start.ts from 9d51982b), tip's four changed test files | 269 | Eight M-1 failures, 261 passes; the two unit and two real-core cases per mode resolve startup instead of rejecting |
| `startsWith(HERDR_NO_SERVER_PREFIX)` → `includes(...)` | 160 reader/row tests | Three failures: reader returns true rather than false; rows 8/9 expose a no-server code for the relayed message |
| Remove all trailing LF characters instead of at most one | 160 | Five failures: reader accepts the double-LF envelope; row 8 returns [] for pane_not_found; row 9 returns false; malformed no-server forms are also wrongly classified |

All 160 reader/row tests pass on the note-2 base, as expected: these are regression tests for already-correct reader behavior. The M-1 base run confirms that the new refusal oracles are red for the intended reason, rather than relying only on the mocked spawn refusing.

A narrower **partial fix still accepted by the new startup tests** was also run. Restrict `runningHeldOrchestrators` to status working or killed, leaving its terminal/alive condition intact:

```ts
(c.session.status === "working" || c.session.status === "killed") &&
isTerminalSession(c.session) && c.liveness.state === "alive"
```

All 109 existing startup unit/integration tests pass on that mutant. Independent tests with a stored handle, status spawning and activity exited pass on the real tip but fail on this mutant: project mode succeeds by reuse; isolated mode calls runtime.create once and leaves app-orchestrator-1 plus app-orchestrator-2. This is useful additional hardening coverage; the current production predicate is general and behaves correctly. An initial reviewer-only fixture used idle, which core normalizes to spawning; the final probe uses spawning explicitly.

The changed old oracle is exactly the one authorized: the two killed/alive unit cases formerly expected a spawn and now expect exit 1, no spawn/reuse and the still-runs text. The extra exited/alive cases and reuse-next-to-held controls add coverage. The stand-in's success-answer support preserves its old Error behavior. No tmux/other-runtime oracle was weakened. Their startup paths still receive only non-terminal candidates, so the new non-terminal filter does not change them.

## Recovery and pre-fit comparison

Pre-fit main was frozen at `fdc3eca924277610c63111ea9be6dfa98fe3cbe1`; `git diff --stat 389b8dfe <that-main> -- packages` is empty. Archived and built it independently. Used the built CLI entrypoints from both snapshots, with fresh scratch configurations and state roots, for both modes and each refusal context. No real config/state root was passed to any AO entrypoint.

| Action | Pre-fit main | ee3534d7 |
| --- | --- | --- |
| session kill on retained Herdr orchestrator | Exit 1, runtime stop unconfirmed (unknown), record/worktree retained | Same |
| session cleanup for its project | Exit 0, No sessions to clean up, record/worktree retained | Same |
| Move active record to documented archive target in fresh state | ENOENT until archive directory created | Same |
| Create archive directory, then move to unused timestamped target | Active record removed, archive present | Same |

The false/no-server/alive-terminal labels identify the refusal contexts; kill/cleanup do not consume a liveness answer to reach these outcomes. Their behavior is independent of that answer: Herdr stop always returns unknown, and cleanup excludes orchestrators. This is why the same measurement is valid on pre-fit main even though it cannot classify the newer stderr answers. F-5 destroy refusal is not the cause of the retention: kill selects stop before destroy on both snapshots.

The new recovery descriptions are otherwise consistent with code:

- False/mismatched terminal: attach refuses; verify that the launch is not running on another server before manual retirement.
- No server at the selected endpoint: attach cannot check; reach the original server first, then retry startup, or retire by hand only after the launch has ended.
- Held-live: attach works despite the terminal record status; to retire it, close the verified launch first, then move the record.

The manual ordering—stop the project lifecycle writer, close/verify the launch, archive the record, remove only an isolated worktree—is appropriate for an operator-quiesced recovery and warns that it bypasses locks/generation bookkeeping. m-1 supplies the missing directory prerequisite. No real lifecycle worker or pane was stopped for these checks, and no real worktree was removed. The author's post-archive start measurement is consistent with core's active-record selection; this review independently measured the retained/archived state transitions, without starting a real agent.

## Gates on ee3534d7

All successful builds, installs, tests, recovery fixtures and mutations ran under scratch copies. The sanitized invocation was:

```sh
env -i HOME=/tmp/aof1r2s/home TMPDIR=/tmp/aof1r2s/tmp \
  PATH=/tmp/aof1r2s/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true <command>
```

The PATH is a directory of explicit Node 25.7.0, cached pnpm 9.15.4, raw git/shell/basic-utility links, a gh stub that only answers --version/auth status, and a tmux shim that unsets TMUX and selects private aof1r2s-tests. It contains no npm/npx, agent binary or Herdr; /usr/bin itself is not a PATH entry. Parser tests use mocks and scratch stand-ins only.

| Gate | Result |
| --- | --- |
| Frozen offline install from `/home/taisung/.local/share/pnpm/store/v3` | Exit 0; Husky skipped; expected pre-build ao entrypoint-link warning |
| pnpm build | Exit 0 |
| pnpm typecheck | Exit 0 |
| pnpm lint | Exit 0; five known warnings, no errors |
| pnpm -r --no-bail test | Exit 0; 3,797 passed, one expected failure, 29 skipped |
| SAME_ID_DEFECTS=red across the nine packages with same-ID tests | Exit 1 as expected; R2 15, R3 6 |
| gitleaks git --log-opts=389b8dfe..ee3534d7 --redact | Exit 0; eight commits scanned, no leaks |

Full-suite package totals:

| Package | Pass / expected failure / skip |
| --- | --- |
| core | 1700 / 1 / 0 |
| runtime-herdr | 146 / 0 / 0 |
| CLI | 417 / 0 / 0 |
| Claude / Codex / Gemini / OpenCode | 319 / 308 / 89 / 365 passes |
| runtime-tmux / workspace-worktree | 69 / 85 passes |
| notifier-desktop / tracker-github | 26 / 42 passes |
| scm-github | 140 passes, five skips |
| integration-tests | 91 passes, 24 skips |

Core/runtime/CLI match the author's 1700+1/146/417. Relative to r1, core gains five reader/row tests, runtime-herdr gains three, CLI gains eight (start unit tests 93→97 and real-core startup 8→12). Every other unit package is unchanged. Integration has 22 more passes and 22 fewer skips than the author's 69/46 because this review's private tmux shim enables runtime-tmux (9), CLI spawn/send/kill (5), session ls (3) and hash-based CLI/core (5). Agent-dependent live blocks remain disabled; all 115 integration cases are accounted for.

The first full attempt had two core GH-wrapper stderr failures because the scratch PATH lacked rm; core then had 1698 passes + one expected failure. Adding only the raw rm utility link fixed both, and the repeated full gate passed. No product source was changed to make that gate pass. An initial recovery fixture also observed the known prAutoDetect=off metadata repair; the final fixtures include that normal field, so their retained-record comparison is exact.

Lint warnings remain spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232 and session-manager.ts:2402/2409. ESLint also emits its existing .eslintignore deprecation notice. The red failures remain core one R3; each of four agents one R2; OpenCode one additional R3; runtime-tmux eleven R2; workspace-worktree four R3. Runtime-herdr and CLI have none. No new red failure or unexpected failure was found.

## Merge readiness

Read-only merge-tree results, with no branch/ref changed:

- `git merge-tree --write-tree main ee3534d7`: exit 0, tree `e2085f2f93f7d6336f1129e7da745941f0dc9449`, no conflicts. Main was `fdc3eca924277610c63111ea9be6dfa98fe3cbe1`.
- `git merge-tree --write-tree feat/session-relaunch ee3534d7`: exit 1, tree `929cc9b93cd9d0660f296437b18dd6b5fe01cc93`. Relaunch ref was `9f20ce29423baa9e79cf559a748c8a75f55a4ab0`.

Conflicts: `docs/DEVELOPMENT.md`, `packages/cli/__tests__/commands/start.test.ts`, `packages/cli/src/commands/start.ts`, `packages/core/src/session-manager.ts`. The three agent product files auto-merge. This is the same four-path conflict surface as r1; no conflict was resolved or written into the worktree.

## Isolation and cleanup

HEAD was verified as `ee3534d7` before reading implementation code. The fresh `/tmp/aof1r2s-marker` preceded review/probes. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Final full-ISO listing and SHA-256 hashes of all four files matched the initial snapshot exactly. The required state-root scan was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof1r2s-marker \
  -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' \
  -not -name 'lifecycle-worker.log'
```

It printed exactly:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2225
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2230
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
```

The first four paths are the owner's active Nexus sessions directory and nex-2237/nex-2225/nex-2230 records. The other four are the active agent-orchestrator sessions directory and ao-65/ao-orchestrator/ao-73 records. They are external managed-session/lifecycle updates, not review-command writes. The scan does not establish an individual external writer PID; no other session's contents or pane was read to infer one.

After all test/recovery cells finished, a /proc scan for scratch HOME or scratch cwd returned `REVIEW_PROCESSES []`. No process was signaled. The sanitized private tmux check returned exit 1 with `no server running on /tmp/tmux-44402/aof1r2s-tests`; no private server remains. No default-server tmux command was issued.

Only this new review and the expressly required `.agent_report.md` were intentionally written in the worktree. The supplied note/task and r1 review were preserved; ignored managed activity logging may advance independently. `git diff --exit-code` passed and HEAD remained `ee3534d7`. No product edits, network, real agents/Herdr, inter-session send, commit, push, PR, fetch, pull, rebase or branch mutation occurred. Built AO entrypoints were used only on scratch configs/state, for kill/cleanup measurements.

`/tmp/aof1r2s` and `/tmp/aof1r2s-marker` were removed using path-checked cleanup; final existence checks passed. No scratch artifact or process remains.
