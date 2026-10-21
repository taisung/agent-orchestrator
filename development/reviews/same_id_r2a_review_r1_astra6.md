# Same-ID R2a independent review

NOT-LAND-SAFE

Finding counts: 0 B, 1 M, 1 m; 3 follow-ups. **M-1 blocks landing:** a refused restore can create an active reservation and recreate a worktree before the old stop is confirmed. m-1 is a nonblocking never-reject edge case. All required gates pass; six mutants are caught; only the nine intended R2a red tests change.

Completed independent review. Target `cbfbc182..ac1cbf4b5340bfaad1eb6d1966787b89c0bd21de`. Reviewer ao-57. Artifact: TypeScript code, tests and claimed stop/lifecycle safety. Only regressions, worsened defects, and defects retained in changed code block landing. Older untouched defects are follow-ups.

## Isolation and initial evidence

Created `/tmp/aor2ar-marker` before work. No commit, push, PR, network gh call, real AO command or model call is authorized. All build/test/helper/runtime processes use `env -i`, fake HOME `/tmp/aor2ar/home`, PATH `/tmp/aor2ar/bin:/usr/bin:/bin`, no inherited AO variables. The scratch PATH supplies node/pnpm, a gh stub allowing only --version/auth status, and a tmux shim forcing private server `aor2ar-57` with `/dev/null` config and unset TMUX. Agent executables are absent from this PATH for tests. Live fixtures will use separate stand-ins and scratch config/state.

Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Initial HEAD is ac1cbf4b; only `.agent_task.md` and `.agent_report.md` were untracked. The diff contains 27 files and eight commits. `git branch -r --contains ac1cbf4b` prints nothing. Read project CLAUDE.md, task and res-audit instructions. Author report intentionally unread until independent source review items 1–4 are complete.

## Independent source review, before author report

Items 1–4 read from source and the diff. Direct runtime destroy/stop search in `packages/core/src` and `packages/cli/src` finds only `runtime-stop.ts:135,154`; other `.destroy` matches destroy workspaces/sockets, and `.stop` matches lifecycle/spinners. All destructive runtime calls were routed through the helper. The new helper validates ordinary returned outcomes and gates callers on destroyed/absent. Herdr stop returns unknown without invoking the CLI. Tmux destroy preserves R1 exact targets and recognizes the existing target-not-found classifier.

Points requiring measured discrimination:

- `runtime-stop.ts:169` permits destroyed after a resolved destroy followed by no-server. This preserves last-session kills, but does not establish server provenance: wrong-server operations remain the R2b limitation. Compare with base before treating that as a new failure.
- `runtime-stop.ts:132–147` and error formatting are outside a total exception boundary: exotic thrown values/getters may violate the documented never-reject promise. Test these without confusing refusal with deletion.
- `session-manager.ts:4383–4395` refuses restore after the earlier archive copy-back and workspace restoration (`:4285–4367`). A new refusal may leave new disk state despite the promised unchanged record/worktree; test both archived and missing-workspace cases.
- `killRecord` retains pre-existing skip branches for malformed/missing runtimeHandle and missing plugin (`:2982–2990`). Recovery retains the runtimeAlive condition (`recovery/actions.ts:173`). Distinguish untouched R4 holes from changes that this round worsens, and check the actual validator: rejected runtime probes already set action=skip (`recovery/validator.ts:73–77,110–116`), so a claim of normal automatic cleanup after that rejection needs proof.
- The lifecycle gate requires alive in the same poll. No-handle records already return KEEP_STATUS at `lifecycle-manager.ts:605–607`. Missing runtime plugins now retain status, appropriately adding a refusal. No-server still reaches the pre-existing five-minute bound at `:1577–1586`; the new gate does not leave it working forever.
- Rollback retains `ownOrGone` and conditional release; unconfirmed stops now return before discard/workspace/release and conditionally record launchFailed. Prompt retention also honors that result.

Install with fake HOME and HUSKY=0 passed (2.1 s); the pre-build ao symlink warning is expected because dist did not exist. `pnpm build` passed.

## Measured counterexamples and report corrections

Independent scratch Vitest harness, archived tip source with source alias for core, 7/7 assertions passed (asserting the observed defects, not claiming correctness):

```text
restore archived=false: ERR_RUNTIME_STOP_UNCONFIRMED; beforeActive=true, afterActive=true; beforeWorkspace=false, afterWorkspace=true; runtimeCreates=0
restore archived=true: ERR_RUNTIME_STOP_UNCONFIRMED; beforeActive=false, afterActive=true; beforeWorkspace=false, afterWorkspace=true; runtimeCreates=0
stop rejects Object.create(null): TypeError: Cannot convert object to primitive value
fallback destroy rejects Object.create(null): same TypeError
stop returns object with throwing outcome getter: Error: broken outcome getter
runtime.stop getter throws: Error: broken stop getter
validator runtime probe rejects: action=skip, runtimeAlive=false, reason=Liveness unknown (runtime probe could not run: probe rejected); no action
```

Provisional M-1: the new restore refusal is placed after archive reservation/workspace restoration; it changes disk before reporting refusal. This is retained sequencing in a changed caller and a new failure path, not an unrelated old R4 read. It needs either a stop gate before those mutations (preserving restore ownership checks) or an explicit safe transaction/rollback. The new caller tests cover only an active record with an existing workspace, so they miss both cases.

Provisional m-1: `stopRuntime`'s never-reject contract is false for thrown non-coercible objects or accessors. It remains fail-closed at the destructive caller, but bypasses the structured refusal and launchFailed diagnostic. Protect optional-method access, outcome parsing and diagnostic conversion with a total fallback. No retained first-party plugin was found returning these shapes.

Author report was read only after independent items 1–4. Its section 9.6 overstates recovery risk: validator's runtime rejection sets runtimeAlive=false **and action=skip**. Direct cleanupSession with a stale/manually supplied false assessment can bypass stop, but the reported automatic rejection-to-cleanup chain does not occur. Source and the independent assertion agree.

Filtered gates passed: core 57 files/1522 tests (1511 passed + 11 expected failures); CLI 21/275; runtime-tmux 3/69; runtime-herdr 3/48; claude-code 4/214; codex 4/220; gemini 2/67; opencode 6/322; worktree 4/70. Integration details follow with the full-run evidence. Lint passed with 0 errors/5 warnings; typecheck passed. Red mode independently gives base 53 failed versus tip 44 failed; only nine core R2a failures changed. Base uses archived sources and a core-source Vitest alias, avoiding a build outside this worktree or accidental use of tip core exports.

## Live results on the worktree build (private server only)

Commands used `env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/livebin:/tmp/aor2ar/bin:/usr/bin:/bin`, scratch AO_CONFIG_PATH/AO_STATE_ROOT, and `node <worktree>/packages/cli/dist/index.js`. Direct tmux commands used `env -u TMUX /usr/bin/tmux -f /dev/null -L aor2ar-live57`; code used the private-server shim. Seed repository and every worktree were under `/tmp/aor2ar/live`. No model ran; panes used `exec /bin/sleep 600`, with a codex stand-in available only on the live PATH.

- A: injected non-gone kill-session failure while pane lived: exit 1, unknown, detailed cause and Next hint; session list, complete record and ls unchanged.
- B: healthy kill with keeper session: exit 0, target disappeared, record archived, worktree removed.
- C: healthy last-session kill: exit 0, server ended, record archived, worktree removed. This independently justifies the added no-server-after-resolved-destroy row as a compatibility rule, without proving server identity.
- D: no server at the socket: exit 1, unknown; record and worktree unchanged; message says start a server when no server runs, check/stop the named session, retry.
- E: real lifecycle worker PID 580640, runtime probe continuously injected to fail for rv-e, agent has no matching running process: record stayed working and worktree/pane remained. The health summary only exposed two distinct outage correlation IDs; the worker's durable trace proves **22 successful lifecycle.poll operations** over 10 seconds. Do not mistake the summary refresh for the number of polls. Worker was stopped by exact PID before its private server.
- F: restore of an existing-workspace record with a live old pane whose kill fails: exit 1, unknown; exact session list and record unchanged, no new runtime/worktree.
- G: archived record plus missing worktree, same failed stop: exit 1 and same refusal, **but a new active reservation (generation 2) and real git worktree now exist**. This independently confirms M-1 with the actual CLI and workspace plugin.
- tmux 3.4 measured exact `kill-session -t =not-present`: with another session, `can't find session: not-present`; with exit-empty off and no sessions, `no current target`. Both are valid absence answers on the addressed server.

Exact before/after evidence follows (list-sessions exit/stdout/stderr, complete record, and ls exit/stdout/stderr):

```text
TMUX_VERSION { status: 0, stdout: 'tmux 3.4\n', stderr: '' }
gone-with-server { status: 1, stdout: '', stderr: "can't find session: not-present\n" }
A before {"listSessions":{"status":0,"stdout":"review-keeper|579365\nreview-rv-a|579365\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-a\nbranch=feat/rv-a\nstatus=working\ntmuxName=review-rv-a\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-a\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
COMMAND session kill rv-a {"status":1,"stdout":"","stderr":"Failed to kill session rv-a: runtime stop unconfirmed (unknown): the destroy of tmux session review-rv-a failed (tmux kill-session -t =review-rv-a could not answer: review injected server failure), but the session still runs; record and worktree kept\nNext: Check tmux session review-rv-a by hand and stop it if it still runs, then run `ao session kill rv-a` again. AO goes on only when the runtime answers that the session stopped or does not exist.\n"}
A after {"listSessions":{"status":0,"stdout":"review-keeper|579365\nreview-rv-a|579365\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-a\nbranch=feat/rv-a\nstatus=working\ntmuxName=review-rv-a\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-a\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
B before {"listSessions":{"status":0,"stdout":"review-keeper|579365\nreview-rv-a|579365\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-a\nbranch=feat/rv-a\nstatus=working\ntmuxName=review-rv-a\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-a\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
COMMAND session kill rv-a {"status":0,"stdout":"\nSession rv-a killed.\n","stderr":""}
B after {"listSessions":{"status":0,"stdout":"review-keeper|579365\n","stderr":""},"record":null,"worktree":{"status":2,"stdout":"","stderr":"/bin/ls: cannot access '/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-a': No such file or directory\n"}}
C before {"listSessions":{"status":0,"stdout":"review-rv-c|580383\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-c\nbranch=feat/rv-c\nstatus=working\ntmuxName=review-rv-c\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-c\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
COMMAND session kill rv-c {"status":0,"stdout":"\nSession rv-c killed.\n","stderr":""}
C after {"listSessions":{"status":1,"stdout":"","stderr":"no server running on /tmp/tmux-44402/aor2ar-live57\n"},"record":null,"worktree":{"status":2,"stdout":"","stderr":"/bin/ls: cannot access '/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-c': No such file or directory\n"}}
D before {"listSessions":{"status":1,"stdout":"","stderr":"no server running on /tmp/tmux-44402/aor2ar-live57\n"},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-d\nbranch=feat/rv-d\nstatus=working\ntmuxName=review-rv-d\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-d\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
COMMAND session kill rv-d {"status":1,"stdout":"","stderr":"Failed to kill session rv-d: runtime stop unconfirmed (unknown): the destroy of tmux session review-rv-d failed (tmux kill-session -t =review-rv-d could not answer: no server running on /tmp/tmux-44402/aor2ar-live57), and no tmux server answers, so nothing can confirm that the session stopped (tmux has-session -t =review-rv-d could not answer: no server running on /tmp/tmux-44402/aor2ar-live57); when no server runs, start one so that it can answer; record and worktree kept\nNext: Check tmux session review-rv-d by hand and stop it if it still runs, then run `ao session kill rv-d` again. AO goes on only when the runtime answers that the session stopped or does not exist.\n"}
D after {"listSessions":{"status":1,"stdout":"","stderr":"no server running on /tmp/tmux-44402/aor2ar-live57\n"},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-d\nbranch=feat/rv-d\nstatus=working\ntmuxName=review-rv-d\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-d\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 3 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
E before {"listSessions":{"status":0,"stdout":"review-rv-e|580629\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-e\nbranch=feat/rv-e\nstatus=working\ntmuxName=review-rv-e\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-e\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 4 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
E poll {"correlationId":"lifecycle-poll-dfb701fe-7250-4f07-a033-69691faf8627","details":{"projectId":"review","sessionCount":2,"activeSessionCount":1,"probeOutageSessions":["rv-d","rv-e"],"probeOutcomes":{"rv-d":"gone","rv-e":"failed"}},"status":"working"}
E poll {"correlationId":"lifecycle-poll-893a364d-69ea-4a4f-a000-2adbd0313d01","details":{"projectId":"review","sessionCount":2,"activeSessionCount":1,"probeOutageSessions":["rv-d","rv-e"],"probeOutcomes":{"rv-d":"gone","rv-e":"failed"}},"status":"working"}
E poll {"correlationId":"lifecycle-poll-893a364d-69ea-4a4f-a000-2adbd0313d01","details":{"projectId":"review","sessionCount":2,"activeSessionCount":1,"probeOutageSessions":["rv-d","rv-e"],"probeOutcomes":{"rv-d":"gone","rv-e":"failed"}},"status":"working"}
E distinct poll outcomes 2
E after {"listSessions":{"status":0,"stdout":"review-rv-e|580629\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-e\nbranch=feat/rv-e\nstatus=working\ntmuxName=review-rv-e\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-e\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 4 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
E worker stopped 580640 
F before {"listSessions":{"status":0,"stdout":"review-rv-e|580629\nreview-rv-f|580629\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-f\nbranch=feat/rv-f\nstatus=killed\ntmuxName=review-rv-f\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-f\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 5 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
COMMAND session restore rv-f {"status":1,"stdout":"","stderr":"Failed to restore session rv-f: runtime stop unconfirmed (unknown): the destroy of tmux session review-rv-f failed (tmux kill-session -t =review-rv-f could not answer: review injected server failure), but the session still runs; record and worktree kept; no new runtime was created\nNext: Check tmux session review-rv-f by hand and stop it if it still runs, then run `ao session restore rv-f` again. AO goes on only when the runtime answers that the session stopped or does not exist.\n"}
F after {"listSessions":{"status":0,"stdout":"review-rv-e|580629\nreview-rv-f|580629\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-f\nbranch=feat/rv-f\nstatus=killed\ntmuxName=review-rv-f\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-f\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 5 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
G archived restore before {"listSessions":{"status":0,"stdout":"review-rv-e|580629\nreview-rv-f|580629\nreview-rv-g|580629\n","stderr":""},"record":null,"worktree":{"status":2,"stdout":"","stderr":"/bin/ls: cannot access '/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-g': No such file or directory\n"}}
COMMAND session restore rv-g {"status":1,"stdout":"","stderr":"Failed to restore session rv-g: runtime stop unconfirmed (unknown): the destroy of tmux session review-rv-g failed (tmux kill-session -t =review-rv-g could not answer: review injected server failure), but the session still runs; record and worktree kept; no new runtime was created\nNext: Check tmux session review-rv-g by hand and stop it if it still runs, then run `ao session restore rv-g` again. AO goes on only when the runtime answers that the session stopped or does not exist.\n"}
G archived restore after {"listSessions":{"status":0,"stdout":"review-rv-e|580629\nreview-rv-f|580629\nreview-rv-g|580629\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-g\nbranch=feat/rv-g\nstatus=killed\ntmuxName=review-rv-g\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-g\",\"runtimeName\":\"tmux\",\"data\":{}}\nreservationId=9edc3d24-8056-4fac-95d5-65e94100a2cd\ngeneration=2\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:11 .\ndrwxr-xr-x 6 taisung users 4096 Oct 21 15:11 ..\n-rw-r--r-- 1 taisung users   50 Oct 21 15:11 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:11 README\n","stderr":""}}
gone-empty-server { status: 1, stdout: '', stderr: 'no current target\n' }
LIVE_DONE
```

## Assessment of changed older tests

The core r2 file changes eight marking lines, representing nine test instances (the lifecycle case is parameterized over two agents); no assertion or fixture changed. The other three r2 defect files are unchanged.

| Older change | Assessment |
| --- | --- |
| createMockPlugins default runtime | Models a successful stop through isAlive=false after destroy, restoring the old tests' intended healthy prerequisite. Its invocation-history rule also treats a rejected destroy as stopped unless a test overrides isAlive, so it is not evidence that failed stops are safe; the independent outcome matrix supplies that evidence. The helper uses the latest create of any ID, so it is a simplified fixture, not a runtime model. |
| lifecycle.test.ts: tolerates runtime destroy failure | Preserves the legitimate already-gone case by explicitly answering false. It no longer asserts that a live session can be deleted after failure; new tests assert that opposite policy. |
| lifecycle.test.ts: merged holder with runtime error / hang (two cases) | Preserves the holder's unknown/hanging probe (rt-2); makes the killed session's own runtime rt-1 definitely absent. The holder safety assertion remains reached, rather than passing due to an earlier stop refusal. |
| restore.test.ts: continues after old-runtime destroy failure | Same already-gone correction; still proves rejected destroy plus authoritative absence permits restore. |
| recovery-actions.test.ts: cleanup after destroy throws | Same authoritative-absence prerequisite; workspace/metadata cleanup assertions remain. |
| killed-status-stale-writes.test.ts: archived-during-probe orphan | The orphan stops after destroy so new orchestration remains reachable; archival-race assertions unchanged. |
| runtime-tmux index.test.ts: missing target / unsafe name | Uses measured tmux wording instead of invented session-not-found text. Unsafe input now rejects while still making no tmux call. New tests distinguish unknown/no-server/timeout from absence. |
| agent-opencode discard-ownership / rollback-holders | Set-based runtime fixtures now stop/recreate correctly; all original holder/discard assertions remain reachable. No assertion weakened. |
| agent-opencode same-id-reuse-window | Only fixture liveness changed. Keeps its original R3 defect marking and assertion, and still fails in independent red mode at the removed prepared-session assertion. Necessary deviation from the strict no-edit wording; otherwise R2a refusal would mask F-3. |

There are six affected older tests in four core files, not the five named in commit 6c9165f9. The tests still serve their intended purposes. No inappropriate defect-to-pass relabeling was found.

## Independent gates and mutation results

All test invocations started with fake HOME, no inherited AO variables, gh stub, no agent binary on PATH, and the private tmux shim. pnpm test scripts use their package-local Vitest binaries. Only the live fixtures used stand-ins. Commands:

```sh
env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/bin:/usr/bin:/bin HUSKY=0 CI=1 pnpm install --frozen-lockfile
env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/bin:/usr/bin:/bin CI=1 pnpm build
# Ten required package filters, including integration, with -r --no-bail test
env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/bin:/usr/bin:/bin CI=1 pnpm lint
env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/bin:/usr/bin:/bin CI=1 pnpm typecheck
env -i HOME=/tmp/aor2ar/home PATH=/tmp/aor2ar/bin:/usr/bin:/bin CI=1 pnpm -r --no-bail test
```

All exited 0. Full-run summary lines (ANSI removed):

```text
packages/core test:  Test Files  57 passed (57)
packages/core test:       Tests  1511 passed | 11 expected fail (1522)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  220 passed (220)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  4 passed (4)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:  Test Files  3 passed (3)
packages/plugins/runtime-herdr test:       Tests  48 passed (48)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:  Test Files  3 passed (3)
packages/plugins/runtime-tmux test:       Tests  69 passed (69)
packages/plugins/workspace-worktree test:  Test Files  4 passed (4)
packages/plugins/workspace-worktree test:       Tests  70 passed (70)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  275 passed (275)
```

Integration: 10 passed / 3 skipped files; 91 passed / 24 skipped tests. Agent-dependent cases were skipped because real agent binaries were absent. tmux integration ran through the private shim. Lint: 0 errors, 5 existing warnings (spawn.ts, activity-log.ts, plugin-registry.ts, session-manager.ts); typecheck and build completed for all applicable workspaces.

### Red mode against the base

Both copies were made with `git archive <sha> | tar -x -C /tmp/aor2ar/<copy>`. Only the worktree was built. Base red tests used its own source plus source aliases for core exports, so they did not accidentally exercise tip session-manager code. Every file containing SAME_ID_DEFECTS was selected (including same-id-reuse-window). Command within each package: `SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run <files> --reporter=json --outputFile=<scratch result>` under the clean environment; base adds `--config vitest.review.config.ts`.

| Round | File | cbfbc182 failed / passed | ac1cbf4b failed / passed |
| --- | --- | --- | --- |
| R1 | `packages/cli/__tests__/same-id-defects.test.ts` | 0 / 2 | 0 / 2 |
| R2 | `packages/core/src/__tests__/same-id-defects-r2.test.ts` | 9 / 4 | 0 / 13 |
| R4 | `packages/core/src/__tests__/same-id-defects-r2.test.ts` | 7 / 5 | 7 / 5 |
| R1 | `packages/core/src/__tests__/same-id-defects.test.ts` | 0 / 5 | 0 / 5 |
| R3 | `packages/core/src/__tests__/same-id-defects.test.ts` | 1 / 0 | 1 / 0 |
| R4 | `packages/core/src/__tests__/same-id-defects.test.ts` | 3 / 0 | 3 / 0 |
| R1 | `packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts` | 0 / 1 | 0 / 1 |
| R2 | `packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts` | 1 / 0 | 1 / 0 |
| R1 | `packages/plugins/agent-codex/src/same-id-defects.test.ts` | 0 / 1 | 0 / 1 |
| R2 | `packages/plugins/agent-codex/src/same-id-defects.test.ts` | 1 / 0 | 1 / 0 |
| R4 | `packages/plugins/agent-codex/src/same-id-defects.test.ts` | 2 / 0 | 2 / 0 |
| R1 | `packages/plugins/agent-gemini/src/same-id-defects.test.ts` | 0 / 1 | 0 / 1 |
| R2 | `packages/plugins/agent-gemini/src/same-id-defects.test.ts` | 1 / 0 | 1 / 0 |
| R4 | `packages/plugins/agent-gemini/src/same-id-defects.test.ts` | 2 / 0 | 2 / 0 |
| R1 | `packages/plugins/agent-opencode/src/same-id-defects.test.ts` | 0 / 1 | 0 / 1 |
| R2 | `packages/plugins/agent-opencode/src/same-id-defects.test.ts` | 1 / 0 | 1 / 0 |
| R4 | `packages/plugins/agent-opencode/src/same-id-defects.test.ts` | 2 / 0 | 2 / 0 |
| R3 | `packages/plugins/agent-opencode/src/same-id-reuse-window.test.ts` | 1 / 0 | 1 / 0 |
| R2 | `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts` | 1 / 1 | 1 / 1 |
| R4 | `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts` | 2 / 3 | 2 / 3 |
| R4 | `packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts` | 2 / 0 | 2 / 0 |
| R2 | `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts` | 7 / 6 | 7 / 6 |
| R1 | `packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts` | 0 / 6 | 0 / 6 |
| R2 | `packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts` | 4 / 0 | 4 / 0 |
| R4 | `packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts` | 2 / 3 | 2 / 3 |
| R3 | `packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts` | 4 / 0 | 4 / 0 |

base totals by round: {"R1":[0,17],"R2":[25,11],"R4":[22,11],"R3":[6,0]}.

tip totals by round: {"R1":[0,17],"R2":[16,20],"R4":[22,11],"R3":[6,0]}.

Only the nine R2a core instances leave the failing set: 53 → 44 failures overall. No setup/import errors or skipped tests in the red files.

### Mutants (independent scratch copy, original tests)

Each mutation was reverted before the next; no mutation touched this worktree. Whole core suite for the first five, runtime-tmux suite for the sixth. The initial scratch config omitted the core scm-webhook-utils subpath alias, leaving one integration-import failure and 1509 runnable tests. That harness error was fixed; **all results below are from the rerun with a completely green 1522-test control (including expected-failure tests counted as passed by the JSON reporter)**. It is not counted as a mutant kill.

| Mutation | Failing tests | Result |
| --- | ---: | --- |
| control | 0 | 1522 passed, exit 0 |
| callers-accept-unknown | 26 | Caught at behavioral assertions |
| helper-always-destroyed | 91 | Caught at behavioral assertions |
| gate-removed | 16 | Caught at behavioral assertions |
| restore-swallow | 4 | Caught at behavioral assertions |
| rollback-ownOrGone-removed | 7 | Caught at behavioral assertions |
| tmux-swallow | 4 | Caught at behavioral assertions |

Exact failed-test inventory follows. Mutations: callers add `stopped.outcome !== "unknown"` to refusal conditions; helper returns destroyed immediately; gate becomes true; restore step 7 uses old destroy/catch swallow; ownOrGone returns true; tmux destroy catches every error again.

<details>
<summary>callers-accept-unknown: 26 failed tests</summary>

```text
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: a kill that refuses does not stop the poll loop the session stays, and the next polls decide again
packages/core/src/__tests__/runtime-stop-callers.test.ts :: kill unknown: refuses; record, worktree and runtime unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: kill fallback: still runs: refuses; record, worktree and runtime unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route runtime route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route runtime route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route merged PR route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route merged PR route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route closed issue route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route closed issue route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: launch rollback unknown: keeps the workspace and the record, with launchFailed
packages/core/src/__tests__/runtime-stop-callers.test.ts :: launch rollback fallback: still runs: keeps the workspace and the record, with launchFailed
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, delete strategy: replacement of a live orchestrator unknown: refuses; its record stays and no second one starts
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, delete strategy: replacement of a live orchestrator fallback: still runs: refuses; its record stays and no second one starts
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, reuse strategy: the orphan runtime of an archived record unknown: refuses; no record and no runtime for the ID
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, reuse strategy: the orphan runtime of an archived record fallback: still runs: refuses; no record and no runtime for the ID
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) unknown: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) fallback: still runs: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: recovery cleanupSession unknown: fails; worktree and record kept
packages/core/src/__tests__/runtime-stop-callers.test.ts :: recovery cleanupSession fallback: still runs: fails; worktree and record kept
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller kill: a destroy that rejects keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller kill: a destroy that resolves while the session still runs keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller cleanup of a merged PR: a destroy that rejects keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller launch rollback: a destroy that rejects keeps the workspace and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller restore: a destroy of the old pane that rejects creates no second runtime
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller recovery cleanup: a destroy that rejects keeps the worktree and the record
```

</details>

<details>
<summary>helper-always-destroyed: 91 failed tests</summary>

```text
packages/core/src/__tests__/killed-status-ownership.test.ts :: B-1: a failed restore stops its runtime only when no record may own it control: the record is gone and nothing names the runtime, so it is stopped
packages/core/src/__tests__/killed-status-ownership.test.ts :: B-1: a failed restore stops its runtime only when no record may own it control: a launched replacement that names another runtime does not own this one
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-1: the launch rollback reads the record again before each step review case: a replacement published during the rollback runtime destroy keeps the shared worktree
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-1: the launch rollback reads the record again before each step a replacement during the rollback runtime destroy that names the prepared agent session keeps it
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-1: the launch rollback reads the record again before each step an archive during the rollback runtime destroy keeps the prepared agent session that the archive names
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-1: the launch rollback reads the record again before each step control: an unchanged failed launch stops its runtime, removes its agent session, worktree and record
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-2: cleanup kills only while the facts of its decision hold a claim of another PR during the cleanup runtime destroy keeps the worktree and the record
packages/core/src/__tests__/killed-status-ownership.test.ts :: M-2: cleanup kills only while the facts of its decision hold control: a direct kill keeps the launch-only compare (a PR change during the kill does not stop it)
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: M-1 (round 8): a check that cannot read the record keeps every resource of the rollback control: the record stays readable and unchanged: every resource goes and nothing is kept
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: 1.1 item 2 (round 8): the other checks of this fix read strictly kill: the sessions directory cannot be searched after the runtime destroy: the kill stops and the worktree stays
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 2: restore writes only into the version that it owns review case 3: an archive during runtime.create is not recreated, and the new runtime is stopped
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 3: spawn writes only into its own reservation and launch a kill of the reservation during the workspace step: no record is recreated, the workspace goes
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 3: an orchestrator start that reuses a live orchestrator a record archived during the liveness check: its orphan runtime is stopped, and a new start follows
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 3: kill and cleanup archive only the launch they read a restore during the runtime destroy: the worktree, agent session and record stay, and the kill fails
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 3: kill and cleanup archive only the launch they read control: a status write of the lifecycle during the kill does not stop the archive
packages/core/src/__tests__/killed-status-stale-writes.test.ts :: 1.1 item 3: the recovery actions write only the assessed version cleanup: a new launch during the runtime destroy keeps its worktree and record
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: a kill that refuses does not stop the poll loop the session stays, and the next polls decide again
packages/core/src/__tests__/recovery-actions.test.ts :: cleanupSession continues cleanup and calls workspace.destroy and deleteMetadata even when runtime.destroy throws
packages/core/src/__tests__/runtime-stop-callers.test.ts :: kill other-launch: refuses; record, worktree and runtime unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: kill unknown: refuses; record, worktree and runtime unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: kill fallback: still runs: refuses; record, worktree and runtime unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route runtime route, other-launch: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route runtime route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route runtime route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route merged PR route, other-launch: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route merged PR route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route merged PR route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route closed issue route, other-launch: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route closed issue route, unknown: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: cleanup, every route closed issue route, fallback: still runs: kept and reported
packages/core/src/__tests__/runtime-stop-callers.test.ts :: launch rollback other-launch: keeps the workspace and the record, with launchFailed
packages/core/src/__tests__/runtime-stop-callers.test.ts :: launch rollback unknown: keeps the workspace and the record, with launchFailed
packages/core/src/__tests__/runtime-stop-callers.test.ts :: launch rollback fallback: still runs: keeps the workspace and the record, with launchFailed
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, delete strategy: replacement of a live orchestrator other-launch: refuses; its record stays and no second one starts
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, delete strategy: replacement of a live orchestrator unknown: refuses; its record stays and no second one starts
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, delete strategy: replacement of a live orchestrator fallback: still runs: refuses; its record stays and no second one starts
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, reuse strategy: the orphan runtime of an archived record other-launch: refuses; no record and no runtime for the ID
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, reuse strategy: the orphan runtime of an archived record unknown: refuses; no record and no runtime for the ID
packages/core/src/__tests__/runtime-stop-callers.test.ts :: orchestrator start, reuse strategy: the orphan runtime of an archived record fallback: still runs: refuses; no record and no runtime for the ID
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) other-launch: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) unknown: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) fallback: still runs: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: recovery cleanupSession other-launch: fails; worktree and record kept
packages/core/src/__tests__/runtime-stop-callers.test.ts :: recovery cleanupSession unknown: fails; worktree and record kept
packages/core/src/__tests__/runtime-stop-callers.test.ts :: recovery cleanupSession fallback: still runs: fails; worktree and record kept
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy resolves, isAlive false: destroyed
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy resolves, isAlive true: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy resolves, isAlive probe error: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy resolves, isAlive no server: destroyed
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy resolves, isAlive malformed: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy rejects, isAlive false: absent
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy rejects, isAlive true: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy rejects, isAlive probe error: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy rejects, isAlive no server: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive destroy rejects, isAlive malformed: unknown
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive absent names what the runtime answered and the destroy failure
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive unknown after a live answer says that the session still runs
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive unknown after a probe error keeps the error as cause
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive unknown after a failed destroy and a failed probe keeps both errors
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive unknown after no server and a failed destroy says that nothing can confirm the stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime without Runtime.stop: destroy, then isAlive never rejects, also when destroy and isAlive throw synchronously
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop answers destroyed as the plugin answered it, and calls neither destroy nor isAlive
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop answers absent as the plugin answered it, and calls neither destroy nor isAlive
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop answers other-launch as the plugin answered it, and calls neither destroy nor isAlive
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop answers unknown as the plugin answered it, and calls neither destroy nor isAlive
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that rejects gives unknown with the rejection as cause
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers undefined gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers null gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers a string gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers an unknown outcome gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers absent without evidence gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers absent with empty evidence gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers other-launch without detail gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers unknown without detail gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop a stop that answers a detail that is not a string gives unknown, never a confirmed stop
packages/core/src/__tests__/runtime-stop.test.ts :: stopRuntime with Runtime.stop keeps only the known fields of a valid answer
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller kill: a destroy that rejects keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller kill: a destroy that resolves while the session still runs keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller cleanup of a merged PR: a destroy that rejects keeps the worktree and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller launch rollback: a destroy that rejects keeps the workspace and the record
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller restore: a destroy of the old pane that rejects creates no second runtime
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller recovery cleanup: a destroy that rejects keeps the worktree and the record
packages/core/src/__tests__/same-id-defects.test.ts :: [same-id R3] F-5: a kill's destroy by name ends the runtime of a restore that ran during it kill and restore of one ID: the active record at the end names a live runtime
packages/core/src/__tests__/session-manager/lifecycle.test.ts :: kill destroys runtime, workspace, and archives metadata
packages/core/src/__tests__/session-manager/restore.test.ts :: restore restores a killed session with existing workspace
packages/core/src/__tests__/session-manager/restore.test.ts :: restore continues restore even if old runtime destroy fails
packages/core/src/__tests__/session-manager/restore.test.ts :: restore when the agent refuses the restore destroys the old runtime only after the restore command is ready
packages/core/src/__tests__/session-manager/spawn.test.ts :: spawn OpenCode session prepared before the pane (I-3) fails the spawn on a dead pane and removes only the session that it created
packages/core/src/__tests__/session-manager/spawn.test.ts :: spawn spawnOrchestrator destroys the worktree when post-launch setup fails
packages/core/src/__tests__/session-manager/spawn.test.ts :: spawn spawnOrchestrator OpenCode session prepared before the pane (I-3) fails the start on a dead pane and removes only the session that it created
```

</details>

<details>
<summary>gate-removed: 16 failed tests</summary>

```text
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative claude-code, exited: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative claude-code, process gone: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative claude-code: the runtime answers again, and the normal classification comes back
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative codex, exited: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative codex, process gone: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative codex: the runtime answers again, and the normal classification comes back
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative gemini, exited: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative gemini, process gone: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative gemini: the runtime answers again, and the normal classification comes back
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative opencode, exited: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative opencode, process gone: 10 polls stay working and the outcome stays failed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative opencode: the runtime answers again, and the normal classification comes back
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative a negative between failing probes starts no run: alternating answers never reach killed
packages/core/src/__tests__/lifecycle-runtime-gate.test.ts :: the lifecycle gate: a failing runtime probe plus an agent negative a stored handle that no runtime plugin can probe: an agent negative keeps the status
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: the lifecycle keeps a session whose runtime probe could not answer codex: a runtime probe that rejects plus the agent's 'exited' does not reach killed
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: the lifecycle keeps a session whose runtime probe could not answer claude-code: a runtime probe that rejects plus the agent's 'exited' does not reach killed
```

</details>

<details>
<summary>restore-swallow: 4 failed tests</summary>

```text
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) other-launch: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) unknown: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/runtime-stop-callers.test.ts :: restore (N-2) fallback: still runs: refuses; no second runtime, record and worktree unchanged
packages/core/src/__tests__/same-id-defects-r2.test.ts :: [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller restore: a destroy of the old pane that rejects creates no second runtime
```

</details>

<details>
<summary>rollback-ownOrGone-removed: 7 failed tests</summary>

```text
packages/core/src/__tests__/killed-status-plugin-checks.test.ts :: M-2 (round 7): core passes its ownership check to the workspace destroy spawn rollback: a new launch during the plugin's own wait keeps the worktree
packages/core/src/__tests__/killed-status-plugin-checks.test.ts :: M-2 (round 7): core passes its ownership check to the workspace destroy orchestrator, a failed workspace hook: a new launch during the plugin's own wait keeps the worktree
packages/core/src/__tests__/killed-status-plugin-checks.test.ts :: M-2 (round 7): core passes its ownership check to the workspace destroy orchestrator, a failed launch: a new launch during the plugin's own wait keeps the worktree
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: M-1 (round 8): a check that cannot read the record keeps every resource of the rollback review case 1: a replacement that names the prepared session becomes unreadable during the hook's own wait (no archive names it)
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: M-1 (round 8): a check that cannot read the record keeps every resource of the rollback review case 2: the record is unreadable before the rollback: the runtime, the agent session, the workspace and the record stay
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: M-1 (round 8): a check that cannot read the record keeps every resource of the rollback the workspace step: the record becomes unreadable during the plugin's own wait: the worktree and the record stay
packages/core/src/__tests__/killed-status-rollback-holders.test.ts :: M-1 (round 8): a check that cannot read the record keeps every resource of the rollback a sessions directory that cannot be searched is not gone: the runtime, the session, the workspace and the record stay
```

</details>

<details>
<summary>tmux-swallow: 4 failed tests</summary>

```text
packages/plugins/runtime-tmux/src/__tests__/index.test.ts :: runtime.destroy() rejects with the cause when tmux fails with another error
packages/plugins/runtime-tmux/src/__tests__/index.test.ts :: runtime.destroy() rejects with the no-server code when no tmux server runs
packages/plugins/runtime-tmux/src/__tests__/index.test.ts :: runtime.destroy() rejects when the tmux command times out
packages/plugins/runtime-tmux/src/__tests__/index.test.ts :: runtime.destroy() rejects, and ends no session, for a handle ID that is not a safe tmux name
```

</details>

### Live worker durable poll evidence

```json
{
  "pid": 580640,
  "metrics": {
    "review::lifecycle_poll": {
      "total": 22,
      "success": 22,
      "failure": 0,
      "lastAt": "2026-10-21T19:11:27.080Z",
      "lastSuccessAt": "2026-10-21T19:11:27.080Z"
    }
  },
  "firstThreePolls": [
    {
      "id": "afa12107-93a4-4cb8-a1bb-9522324157bd",
      "timestamp": "2026-10-21T19:11:18.101Z",
      "component": "lifecycle-manager",
      "operation": "lifecycle.poll",
      "outcome": "success",
      "correlationId": "lifecycle-poll-e48b3ba0-1ba5-45c5-8329-743d1a0cad4a",
      "projectId": "review",
      "durationMs": 396,
      "data": {
        "sessionCount": 2,
        "activeSessionCount": 1
      }
    },
    {
      "id": "d0de44ec-59f5-4dc2-91ad-2eb37f6b574a",
      "timestamp": "2026-10-21T19:11:17.642Z",
      "component": "lifecycle-manager",
      "operation": "lifecycle.poll",
      "outcome": "success",
      "correlationId": "lifecycle-poll-893a364d-69ea-4a4f-a000-2adbd0313d01",
      "projectId": "review",
      "durationMs": 437,
      "data": {
        "sessionCount": 2,
        "activeSessionCount": 1
      }
    },
    {
      "id": "3722345a-e57d-49c8-81c3-338d3242bd99",
      "timestamp": "2026-10-21T19:11:17.122Z",
      "component": "lifecycle-manager",
      "operation": "lifecycle.poll",
      "outcome": "success",
      "correlationId": "lifecycle-poll-dfb701fe-7250-4f07-a033-69691faf8627",
      "projectId": "review",
      "durationMs": 417,
      "data": {
        "sessionCount": 2,
        "activeSessionCount": 1
      }
    }
  ],
  "lastPoll": {
    "id": "1f3e2347-8d81-4900-b43b-23f475a0add8",
    "timestamp": "2026-10-21T19:11:27.080Z",
    "component": "lifecycle-manager",
    "operation": "lifecycle.poll",
    "outcome": "success",
    "correlationId": "lifecycle-poll-2e1d2f78-ee68-47bc-b261-1ec36f89c26f",
    "projectId": "review",
    "durationMs": 370,
    "data": {
      "sessionCount": 2,
      "activeSessionCount": 1
    }
  }
}
```

## Final findings and scope classification

### M-1 — Restore refuses after it has already created an active record and worktree

**Blocks landing. Category: incomplete new refusal in the changed restore caller.** `packages/core/src/session-manager.ts:4383` (new stop gate), `:4307` (archive reservation), `:4345` (workspace restore). The new `RuntimeStopUnconfirmedError` is thrown after both earlier mutations. This violates the task's unchanged-disk requirement on refusal; the message says the record/worktree were kept, although either can have been created by the failed command. It can resurrect an archived ID and leave a new checkout while the old runtime is still running. No second runtime is created; N-2 itself is correctly closed.

Reproducer: create a scratch git worktree and a live private tmux pane; persist a killed record pointing at it; archive the record and remove that worktree; make the shim reject only `kill-session` with `review injected server failure` while `has-session` still succeeds; run `ao session restore <id>`. Case G above exits 1 but changes active record `null → generation=2,reservationId=...` and workspace `ENOENT → .git + README`, while the same three tmux names remain. The source-level reproducer also covers an active record with a missing workspace. The old sequence is retained **inside the caller whose new refusal promises no such mutations**; this is not the unrelated old malformed-handle/R4 read branch.

Required change: determine the old-stop outcome before archive copy-back/workspace creation, with the existing conditional ownership/reservation checks preserved; or implement an equivalently safe conditional transaction. Add archived and missing-workspace refusal tests for both unknown and other-launch. Do not remove a replacement's record/workspace while unwinding.

### m-1 — stopRuntime can reject while formatting or validating a bad plugin answer

**Minor robustness defect; new code, nonblocking by itself.** `packages/core/src/runtime-stop.ts:29`, `:39`, `:132`, `:144`, `:168`. `errorText` calls String on arbitrary thrown values; optional-method property access and outcome validation are outside a total catch. A null-prototype thrown object is sufficient (no malicious proxy required) to throw a TypeError instead of returning unknown; throwing getters are additional cases. Four independent cases are quoted above. This is fail-closed at current callers, but loses the structured refusal/next action and can prevent rollback from recording launchFailed. No first-party runtime was found returning these values.

Reproducer: `runtime.stop = async () => { throw Object.create(null); }`; await stopRuntime with an ordinary handle. It rejects `TypeError: Cannot convert object to primitive value`. Repeat with fallback destroy, an outcome getter, or a stop getter. Make diagnostic formatting nonthrowing and protect method lookup/outcome parsing; return a constant unknown detail if inspection itself fails.

No B-series blocker was found. **M-1 is the landing blocker; m-1 is not the basis of the verdict.**

## Availability and deviations

| Case | Rating | Message, next action, and healthy behavior |
| --- | --- | --- |
| Kill with no server after restart | Correct refusal | Live exit 1 retains record/worktree, says unknown and no-server, instructs checking/stopping the named session and starting a server when none runs before retry. Healthy and last-session kills both exit 0. The operator must choose the intended server; R2a does not establish provenance. |
| Cleanup with no server | Correct retention; diagnostic follow-up F-3 | Runtime-only selection catches the failed probe and skips (live command exits 0 with “No sessions to clean up.”). A merged-PR/closed-issue route reaches killRecord and reports the stop refusal and hint. All three outcome matrices pass. Thus “every cleanup refuses with exit 1” would be inaccurate. |
| Restore with no server | Correct refusal; M-1 for archive/missing-workspace variants | Existing-workspace active record: exit 1 with cause and Next. Archived/missing-workspace variants mutate before refusal. Healthy restore controls pass. |
| Herdr kill/cleanup/restore | Correct intentional refusal | stop always returns unknown and performs zero Herdr calls; explains the unsafe positional close and asks for manual close after checking identity. Retrying after manual close still returns unknown in R2a, so the generic retry hint must not imply it will unblock. This is the owner's deliberate availability tradeoff; healthy Herdr stop is intentionally unavailable. |
| ao stop refusal before worker shutdown | Correct refusal; diagnostic follow-up F-3 | Live exit 1, orchestrator pane/record/worktree kept; worker PID 652165 still alive. Keeping its worker is reasonable while the orchestrator still runs. Outcome/detail print, but Next is missing. Successful stop's existing route remains unchanged and covered by CLI tests. |
| ao send to a dead session | Correct refusal; diagnostic follow-up F-3 | Live no-server send exits 1 without delivery. It currently emits an uncaught Error/cause stack, with the hint buried in the cause object, rather than a concise Next line. Restore healthy controls remain green. |
| killRecord missing/malformed handle or unloaded runtime | Follow-up F-1 | Not a refusal: old skip guards still permit deletion. Live unloaded-runtime case exits 0 and removes record/worktree while pane remains. Unchanged branch, not a new R2a regression. |
| recovery cleanup's runtimeAlive condition | Follow-up F-2, with report correction | Direct cleanup with false assessment skips stop; validator rejection normally returns action=skip, so automatic cleanup after rejection is not demonstrated. New stop handling on the true branch is correct. |
| Resolved destroy + no-server probe | Accept deviation, with bounded claim | Last-session live case proves necessity for current healthy behavior. It is **not** proof the recorded launch was stopped when the caller selected another tmux server. Base already proceeded after any destroy, so this row does not enlarge its destructive behavior; R2b provenance remains unresolved, not worsened. |
| Missing runtime plugin in lifecycle | Correct stronger refusal | Agent negatives cannot prove death without a positive runtime observation in that poll. Preserves status; tested. |
| No runtime handle in lifecycle | Correct existing behavior | Early KEEP_STATUS remains; reservation race tests in killed-status-race.test.ts:132 pass. The design's no-handle exception is not newly implemented, nor was existing reservation protection removed. |
| No-server lifecycle after restart | Existing bounded rule, not forever working | Consecutive no-server lasts five minutes, then killedReason=runtime. killed-status-convergence.test.ts:354 and reset/replacement controls pass. Gate does not change this rule; do not claim R2a proves no-server is permanent absence. |
| Runtime probe fails repeatedly / recovers | Correct | Ten-poll matrix across four agents and both negative forms; real worker 22 polls retains working. Once runtime answers alive, two agent negatives reach killed; positives still classify. |
| OpenCode R3 fixture change (author §9.1) | Accept justified deviation | Only mock liveness changes; original defect and assertion remain red for their own reason. |
| No lifecycle kill/cleanup reactions (author §9.4) | Correct | Reaction actions are send-to-agent, notify, auto-merge; no additional direct runtime destroy was omitted. Refused manual kill between polls leaves loop usable. |
| Review file absent from author tree (§9.2) | Accept | Reading it via local git show is sufficient; reviewer independently did so. |
| Formatting / commit trailer notes (§9.8–9) | Accept | Marking-only diff preserved as instructed; format:check was not a gate. Commit bodies contain no Co-Authored-By trailer, emoji or issue number. |

## Follow-ups (do not change the verdict)

- **F-1 — Old kill skip guards.** `packages/core/src/session-manager.ts:2982`, `:2984`, `:2990`. Missing/unparseable runtimeHandle or missing loaded plugin skips the stop and still removes the workspace and archives. The guards are identical at cbfbc182; R2a did not add or weaken them. Live `rv-unloaded`: before/after pane `review-rv-unloaded` remains, kill exits 0, record becomes null, worktree ls becomes ENOENT. Refuse unknown stored identities in the strict-read/retirement work. The 69 mock records explain migration inconvenience, not evidence of a safe runtime stop.
- **F-2 — Old recovery assessment trust.** `packages/core/src/recovery/actions.ts:173`; `packages/core/src/recovery/validator.ts:73`, `:110`. A direct/stale false assessment or a plugin false-on-error can bypass stop. This condition is unchanged. A rejected isAlive in the actual validator chooses skip, as independently tested; correct author §9.6 instead of claiming that automatic failure chain. Future changes should carry authoritative evidence and revalidate at the destructive action.
- **F-3 — Existing outer CLI diagnostics.** `packages/cli/src/commands/start.ts:1154`, `packages/cli/src/commands/send.ts:340`, `packages/core/src/session-manager.ts:3666`, `:3347`. Generic stop catch omits hint, send prints an uncaught cause stack, and runtime-only cleanup silently skips probe errors. These old unchanged handlers now receive the intended R2a refusal. Surface the next action consistently; mention that Herdr retries remain disabled. Their retention/exit behavior is safe and is not an additional landing blocker.

## Whole-round assessment and correct parts

R2a restricts the pre-existing destructive flows; I found no new route that permits destruction the base refused. The helper's fallback is explicitly conditional on authoritative false, not a substitute for future server/launch identity. Healthy tmux and caller controls remain usable. Herdr's close is conservatively disabled. All direct core runtime-stop callers use the outcome helper; rollback keeps its separate workspace ownership and record-release checks, and the ownOrGone mutant is caught. Restore's N-2 no-second-runtime gate and the lifecycle same-poll-positive gate work. Ordinary malformed optional stop results and rejected promises become unknown; the exception-handling edge case is m-1.

The round is nevertheless not complete under the stated refusal contract: M-1 leaves mutations before a newly introduced refusal. That is the only finding required to block landing. The known untouched identity/strict-read/operation-serialization defects are not being used to reject this round.

Eight local commits are conventional and each body explains why. `git rev-list --min-parents=2 cbfbc182..ac1cbf4b` and `git branch -r --contains ac1cbf4b` both print nothing; the range is a straight line. No commit was made by this reviewer.

## Caller audit details

| Caller and current location | Stop/result handling |
| --- | --- |
| killRecord, session-manager.ts:2999 | Helper, then only confirmed proceeds to workspace/purge/archive. Unknown/other-launch throws with kept resources and retry. Old no-handle/plugin skip is F-1. |
| cleanup runtime / merged PR / closed issue, session-manager.ts:3355 | Each selected kill uses killRecord; caught unconfirmed result is reported as kept plus hint. No new runtime route bypasses it. |
| rollbackLaunch, session-manager.ts:1783 | Confirmed continues through prepared-session holder checks, ownOrGone workspace check and conditional own.release. Unconfirmed returns immediately, retains all, conditionally writes launchFailed. |
| Orchestrator replacement, session-manager.ts:2372,2452 | Helper gates record deletion and fresh creation. Live stop refusal throws before both. The old liveness/no-server path remains outside this new helper and is not an R2a regression. |
| Orchestrator orphan after archival, session-manager.ts:2443 | Helper gates replacement; refusal creates no record/runtime. Outcome matrix covers orphan and normal replacement independently. |
| Orchestrator failed launch, session-manager.ts:2561 | Uses rollbackLaunch; stopUnconfirmed also preserves the shared prompt file. Existing record-ownership checks remain. |
| Restore old runtime, session-manager.ts:4384 | Refuses before runtime.create (N-2); earlier archive/worktree writes are M-1. |
| Restore's own new runtime after record replacement, session-manager.ts:4448 | Existing recordMayOwnRuntime check can retain a name another record may own. Otherwise helper stops the created handle. Error now accurately says stopped or unconfirmed with outcome/detail and manual-stop instruction; no subsequent record write or workspace deletion follows either error. |
| Recovery cleanupSession, recovery/actions.ts:174 | True/live assessment path gates workspace cleanup and archival; unknown/other-launch returns success=false with hint. Old false-assessment condition is F-2. |
| CLI session kill / restore, session.ts:239,417 | Recognizes unconfirmed error, prints cause/outcome and Next, exits 1. Success behavior retained. |
| ao stop, start.ts:1139 | sm.kill rejection exits 1 before stopLifecycleWorker; resources/worker remain. Generic diagnostic is F-3. |

No other runtime destroy/stop call is hidden in core/CLI. The search was `rg -n '\.(destroy|stop)\(' packages/core/src packages/cli/src -g '!**/__tests__/**'`; only runtime-stop.ts contains runtime.destroy/runtime.stop. Remaining matches are workspace/socket destruction and lifecycle/spinner stopping.

## Reproducer source retained after scratch cleanup

The following independent scratch test file ran with tip-source core aliases and the local Vitest binary; assertions deliberately describe the observed behavior. It is not added to the repository's test suite.

```ts
import {it,expect,vi,afterEach} from 'vitest';
import {mkdirSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {setupTestContext,teardownTestContext,makeHandle} from './test-utils.js';
import {createSessionManager} from '../session-manager.js';
import {writeMetadata,readMetadataRaw,deleteMetadata} from '../metadata.js';
import {stopRuntime} from '../runtime-stop.js';
import {getWorktreesDir} from '../paths.js';
import {validateSession} from '../recovery/validator.js';
const contexts:ReturnType<typeof setupTestContext>[]=[];
afterEach(()=>{vi.restoreAllMocks();for(const ctx of contexts.splice(0))teardownTestContext(ctx);});
for(const archived of [false,true]) it(`refused restore changes disk: archived=${archived}`,async()=>{
 const ctx=setupTestContext();contexts.push(ctx);
 const path=join(getWorktreesDir(ctx.config.configPath,ctx.config.projects['my-app'].path),'app-1');
 const raw={worktree:path,branch:'feat/review',status:'killed',project:'my-app',agent:'mock-agent',runtimeHandle:JSON.stringify(makeHandle('rt-old')),createdAt:'2026-01-01T00:00:00.000Z'};
 writeMetadata(ctx.sessionsDir,'app-1',raw);
 if(archived)deleteMetadata(ctx.sessionsDir,'app-1',true);
 const before=readMetadataRaw(ctx.sessionsDir,'app-1');
 ctx.mockWorkspace.exists=vi.fn(async()=>false);
 ctx.mockWorkspace.restore=vi.fn(async()=>{mkdirSync(path,{recursive:true});return {path,branch:raw.branch,sessionId:'app-1',projectId:'my-app'};});
 ctx.mockRuntime.stop=vi.fn(async()=>({outcome:'unknown',detail:'old pane still running'}));
 vi.mocked(ctx.mockAgent.getActivityState).mockResolvedValue({state:'exited'});
 const sm=createSessionManager({config:ctx.config,registry:ctx.mockRegistry});
 const err=await sm.restore('app-1').catch(e=>e);
 console.log('REVIEW restore',JSON.stringify({archived,error:err.message,beforeActive:!!before,afterActive:!!readMetadataRaw(ctx.sessionsDir,'app-1'),beforeWorkspace:false,afterWorkspace:existsSync(path),runtimeCreates:vi.mocked(ctx.mockRuntime.create).mock.calls.length}));
 expect(err.code).toBe('ERR_RUNTIME_STOP_UNCONFIRMED');expect(existsSync(path)).toBe(true);
 expect(ctx.mockRuntime.create).not.toHaveBeenCalled();
 if(archived)expect(readMetadataRaw(ctx.sessionsDir,'app-1')).not.toBeNull();
});
for(const kind of ['stop throws null-prototype','destroy throws null-prototype','outcome getter throws','stop getter throws'])it(`never-reject counterexample: ${kind}`,async()=>{
 const ctx=setupTestContext();contexts.push(ctx);
 if(kind==='stop throws null-prototype')ctx.mockRuntime.stop=async()=>{throw Object.create(null);};
 if(kind==='destroy throws null-prototype')ctx.mockRuntime.destroy=async()=>{throw Object.create(null);};
 if(kind==='outcome getter throws')ctx.mockRuntime.stop=async()=>Object.defineProperty({},'outcome',{get(){throw new Error('broken outcome getter');}}) as never;
 if(kind==='stop getter throws')Object.defineProperty(ctx.mockRuntime,'stop',{get(){throw new Error('broken stop getter');}});
 const got=await stopRuntime(ctx.mockRuntime,makeHandle('rt-old')).then(value=>({value}),err=>({rejected:String(err)}));
 console.log('REVIEW never-reject',kind,JSON.stringify(got));expect(got).toHaveProperty('rejected');
});
it('validator rejects runtime probe: automatic action is skip',async()=>{
 const ctx=setupTestContext();contexts.push(ctx);mkdirSync(ctx.config.projects['my-app'].path,{recursive:true});
 ctx.mockRuntime.isAlive=vi.fn(async()=>{throw new Error('probe rejected');});
 const result=await validateSession({sessionId:'app-1',projectId:'my-app',project:ctx.config.projects['my-app'],rawMetadata:{runtimeHandle:JSON.stringify(makeHandle('rt-old')),worktree:ctx.config.projects['my-app'].path,status:'working'}} as never,ctx.config,ctx.mockRegistry);
 console.log('REVIEW validator',JSON.stringify({action:result.action,runtimeAlive:result.runtimeAlive,reason:result.reason}));expect(result.action).toBe('skip');
});
```

The live-case harness is retained below so its fixtures and isolation can be reconstructed. It starts only private-server sleep panes and a scratch lifecycle worker; every CLI process receives the scratch AO_CONFIG_PATH/AO_STATE_ROOT. Its “distinct poll outcomes” counter reads the throttled health summary; the durable 22-operation metric quoted above is the completed-poll evidence.

```js
import {spawnSync,spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync,rmSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
const root='/home/taisung/.worktrees/agent-orchestrator/ao-57';
const core=await import(pathToFileURL(root+'/packages/core/dist/index.js'));
const scratch='/tmp/aor2ar/live', repo=scratch+'/repo', configPath=scratch+'/agent-orchestrator.yaml', state=scratch+'/state';
const env={...process.env,AO_CONFIG_PATH:configPath,AO_STATE_ROOT:state};
const clean={...process.env};delete clean.AO_CONFIG_PATH;delete clean.AO_STATE_ROOT;
const cli=root+'/packages/cli/dist/index.js';
const owned=new Set();const workers=new Set();
function run(command,args,options={}){const r=spawnSync(command,args,{encoding:'utf8',env:clean,...options});return {status:r.status,stdout:r.stdout??'',stderr:r.stderr??''};}
const tm=(...args)=>run('/usr/bin/env',['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aor2ar-live57',...args]);
function track(){const r=tm('list-panes','-a','-F','#{pid}|#{pane_pid}');for(const line of r.stdout.trim().split('\n'))for(const v of line.split('|')){const pid=Number(v);if(pid>0){owned.add(pid);appendFileSync('/tmp/aor2ar/live-pids',pid+'\n');}}}
function kill(pid){if(!owned.has(pid)&&!workers.has(pid))throw new Error('not owned '+pid);try{process.kill(pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}}
async function cleanServer(){track();const servers=new Set(tm('list-panes','-a','-F','#{pid}').stdout.trim().split('\n').map(Number).filter(x=>x>0));for(const p of owned)if(!servers.has(p))kill(p);await sleep(100);for(const p of servers)kill(p);await sleep(150);}
const git=(...args)=>{const r=run('/usr/bin/git',args,{cwd:repo});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim();};
mkdirSync(repo,{recursive:true});git('init','-b','main');git('config','user.name','Review fixture');git('config','user.email','review@example.invalid');writeFileSync(repo+'/README','scratch only\n');git('add','README');git('commit','-m','test: scratch seed');
const input={defaults:{runtime:'tmux',agent:'codex',workspace:'worktree',notifiers:[]},projects:{review:{name:'Review',repo:'review/scratch',path:repo,defaultBranch:'main',sessionPrefix:'rv',runtime:'tmux',agent:'codex',workspace:'worktree'}},reactions:{}};
writeFileSync(configPath,JSON.stringify(input));
process.env.AO_CONFIG_PATH=configPath;process.env.AO_STATE_ROOT=state;
const config=core.loadConfig();const sessionsDir=core.getSessionsDir(configPath,repo),wtroot=core.getWorktreesDir(configPath,repo);
function fixture(id,{pane=true,status='working'}={}){const wt=wtroot+'/'+id;mkdirSync(wtroot,{recursive:true});git('worktree','add','-b','feat/'+id,wt,'main');const name='review-'+id;if(pane){const r=tm('new-session','-d','-s',name,'-c',wt,'exec /bin/sleep 600');if(r.status!==0)throw new Error(r.stderr);track();}
 core.writeMetadata(sessionsDir,id,{project:'review',worktree:wt,branch:'feat/'+id,status,agent:'codex',tmuxName:name,runtimeHandle:JSON.stringify({id:name,runtimeName:'tmux',data:{}}),createdAt:'2026-01-01T00:00:00.000Z'});return {id,wt,name};}
function snapshot(label,f){const sessions=tm('list-sessions','-F','#{session_name}|#{pid}');console.log(label,JSON.stringify({listSessions:sessions,record:existsSync(sessionsDir+'/'+f.id)?readFileSync(sessionsDir+'/'+f.id,'utf8'):null,worktree:run('/bin/ls',['-la',f.wt])}));}
function ao(...args){const r=run(process.execPath,[cli,...args],{env,timeout:20000});console.log('COMMAND',args.join(' '),JSON.stringify(r));return r;}
function fail(file,name){writeFileSync('/tmp/aor2ar/live-'+file,'='+name);}
function unFail(file){rmSync('/tmp/aor2ar/live-'+file,{force:true});}
try{
 console.log('TMUX_VERSION',tm('-V'));
 tm('new-session','-d','-s','review-keeper','exec /bin/sleep 600');track();
 // Exact-target gone answers on tmux 3.4.
 console.log('gone-with-server',tm('kill-session','-t','=not-present'));
 const a=fixture('rv-a');fail('fail-kill',a.name);snapshot('A before',a);ao('session','kill',a.id);snapshot('A after',a);unFail('fail-kill');
 snapshot('B before',a);ao('session','kill',a.id);snapshot('B after',a);
 await cleanServer();
 const c=fixture('rv-c');snapshot('C before',c);ao('session','kill',c.id);await sleep(200);snapshot('C after',c);
 const d=fixture('rv-d',{pane:false});snapshot('D before',d);ao('session','kill',d.id);snapshot('D after',d);
 const e=fixture('rv-e');fail('fail-probe',e.name);snapshot('E before',e);
 const worker=spawn(process.execPath,[cli,'lifecycle-worker','review','--interval-ms','500'],{env,stdio:['ignore','pipe','pipe']});workers.add(worker.pid);appendFileSync('/tmp/aor2ar/live-pids',worker.pid+'\n');let workerLog='';worker.stdout.on('data',d=>workerLog+=d);worker.stderr.on('data',d=>workerLog+=d);
 const polls=new Set();for(let i=0;i<35&&polls.size<5;i++){await sleep(300);const h=core.readObservabilitySummary(config).projects.review?.health?.['lifecycle.worker'];if(h?.details?.probeOutcomes){polls.add(h.correlationId);console.log('E poll',JSON.stringify({correlationId:h.correlationId,details:h.details,status:core.readMetadataRaw(sessionsDir,e.id)?.status}));}}
 console.log('E distinct poll outcomes',polls.size);snapshot('E after',e);kill(worker.pid);await new Promise(r=>worker.once('exit',r));workers.delete(worker.pid);console.log('E worker stopped',worker.pid,workerLog);unFail('fail-probe');
 const f=fixture('rv-f',{status:'killed'});fail('fail-kill',f.name);snapshot('F before',f);ao('session','restore',f.id);snapshot('F after',f);unFail('fail-kill');
 // New restore refusal after archive reservation and real worktree restoration.
 const g=fixture('rv-g',{status:'killed'});core.deleteMetadata(sessionsDir,g.id,true);git('worktree','remove','--force',g.wt);fail('fail-kill',g.name);snapshot('G archived restore before',g);ao('session','restore',g.id);snapshot('G archived restore after',g);unFail('fail-kill');
 await cleanServer();
 tm('new-session','-d','-s','empty-control','exec /bin/sleep 600');track();tm('set-option','-g','exit-empty','off');const pane=Number(tm('display-message','-p','-t','=empty-control:','#{pane_pid}').stdout.trim());kill(pane);await sleep(200);console.log('gone-empty-server',tm('kill-session','-t','=not-present'));const server=Number(tm('display-message','-p','#{pid}').stdout.trim());if(server>0){owned.add(server);kill(server);}
}finally{
 for(const p of workers)kill(p);
 for(const f of ['fail-kill','fail-probe'])unFail(f);
 await cleanServer();
 for(const p of owned)kill(p);
 console.log('LIVE_DONE');
}
```

Live tmux shim used by CLI/worker (a shell executable named tmux runs this with the scratch node binary):

```js
import {spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
if (!process.env.HOME?.startsWith('/tmp/')) throw new Error('unsafe HOME');
const args=process.argv.slice(2);
const base=['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L','aor2ar-live57'];
const run=(a)=>spawnSync('/usr/bin/env',[...base,...a],{encoding:'utf8'});
const target=args[args.indexOf('-t')+1];
for (const [file,command] of [['fail-kill','kill-session'],['fail-probe','has-session']]) {
 if (args[0]===command && existsSync('/tmp/aor2ar/live-'+file)) {
  const wanted=readFileSync('/tmp/aor2ar/live-'+file,'utf8').trim();
  if (!wanted || wanted===target) {console.error('review injected server failure');process.exit(1);}
 }
}
const result=run(args);
if(args.includes('new-session') && result.status===0) {
 const r=run(['list-panes','-a','-F','#{pid}|#{pane_pid}']);
 appendFileSync('/tmp/aor2ar/live-pids',r.stdout||'');
}
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
```

Additional live commands used the same clean environment and build. `ao stop review` exited 1 with `runtime stop unconfirmed (unknown)` and no Next; worker 652165 remained alive until this reviewer stopped that exact PID. `ao send --no-wait rv-f scratch-review-message` exited 1 with a nested Cannot send / RuntimeStopUnconfirmedError stack and no delivery. An initial cleanup invocation used an invalid positional project argument and exited at argument parsing; corrected `ao session cleanup --project review` with no server exited 0 and printed “No sessions to clean up.” It made no stop attempt on runtime-only selections.

Unloaded-plugin before/after proof and stop-worker proof:

```text
STOP before {"sessions":{"status":0,"stdout":"review-rv-orchestrator|652151\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-orchestrator\nbranch=feat/rv-orchestrator\nstatus=working\ntmuxName=review-rv-orchestrator\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-orchestrator\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=2\nrole=orchestrator\nprAutoDetect=off\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:14 .\ndrwxr-xr-x 7 taisung users 4096 Oct 21 15:14 ..\n-rw-r--r-- 1 taisung users   61 Oct 21 15:14 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:14 README\n","stderr":""}}
COMMAND stop review {"status":1,"stdout":"\nStopping orchestrator for Review\n\n","stderr":"- Stopping orchestrator session\n\nError: runtime stop unconfirmed (unknown): the destroy of tmux session review-rv-orchestrator failed (tmux kill-session -t =review-rv-orchestrator could not answer: review injected server failure), but the session still runs; record and worktree kept\n"}
STOP worker still running 652165 true
STOP after {"sessions":{"status":0,"stdout":"review-rv-orchestrator|652151\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-orchestrator\nbranch=feat/rv-orchestrator\nstatus=working\ntmuxName=review-rv-orchestrator\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-orchestrator\",\"runtimeName\":\"tmux\",\"data\":{}}\ngeneration=2\nrole=orchestrator\nprAutoDetect=off\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:14 .\ndrwxr-xr-x 7 taisung users 4096 Oct 21 15:14 ..\n-rw-r--r-- 1 taisung users   61 Oct 21 15:14 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:14 README\n","stderr":""}}
UNLOADED before {"sessions":{"status":0,"stdout":"review-rv-orchestrator|652151\nreview-rv-unloaded|652151\n","stderr":""},"record":"worktree=/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-unloaded\nbranch=feat/rv-unloaded\nstatus=working\ntmuxName=review-rv-unloaded\nproject=review\nagent=codex\ncreatedAt=2026-01-01T00:00:00.000Z\nruntimeHandle={\"id\":\"review-rv-unloaded\",\"runtimeName\":\"unloaded\",\"data\":{}}\ngeneration=1\n","worktree":{"status":0,"stdout":"total 16\ndrwxr-xr-x 2 taisung users 4096 Oct 21 15:14 .\ndrwxr-xr-x 8 taisung users 4096 Oct 21 15:14 ..\n-rw-r--r-- 1 taisung users   57 Oct 21 15:14 .git\n-rw-r--r-- 1 taisung users   13 Oct 21 15:14 README\n","stderr":""}}
COMMAND session kill rv-unloaded {"status":0,"stdout":"\nSession rv-unloaded killed.\n","stderr":""}
UNLOADED after {"sessions":{"status":0,"stdout":"review-rv-orchestrator|652151\nreview-rv-unloaded|652151\n","stderr":""},"record":null,"worktree":{"status":2,"stdout":"","stderr":"/bin/ls: cannot access '/tmp/aor2ar/live/state/8b69c25c05f5-repo/worktrees/rv-unloaded': No such file or directory\n"}}
EXTRA_DONE
```

## Final cleanup and host-state audit

The two explicitly started scratch workers (580640 and 652165) were stopped by exact PID before their private servers. Private pane/server cleanup likewise used only recorded exact PIDs. Integration fixtures stopped their own private sessions. No protected worker, real session, watcher, default tmux server, or model process was touched.

Final audit checks every remembered private-server/pane/worker PID and scans /proc environments for this review's fake HOME or scratch state root, excluding the audit process itself:

```json
{
  "recordedProcessCount": 32,
  "recordedStillPresent": [],
  "ownLiveProcesses": []
}
```

Before/after command: `ls -la --time-style=full-iso ~/.ao/bin`. The before listing is at the start of this report; the after listing is below. `diff -u` returned no output (byte-identical listings).

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required final command:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aor2ar-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
```

Every printed path is accounted for. These are external fleet writes, not reviewer writes; exact syscall writers are not recorded, so lifecycle/orchestrator attribution is an inference from the timestamps and record contents.

| Printed path | Attribution/evidence |
| --- | --- |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions | External fleet record rename/update; directory mtime 15:13:28.788128218 EDT matches ao-54. This reviewer never wrote this directory or ran real-state AO. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55 | External lifecycle/orchestrator update at 15:11:58.609683357 EDT; current generation 6, working, claude-code. Read only with cat/stat; no message or mutation sent. |
| /home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54 | External lifecycle/orchestrator update at 15:13:28.788128218 EDT; current generation 7, stuck, claude-code. Read only with cat/stat; no message or mutation sent. |

The marker was created at 2026-10-21 15:05:36.538719416 EDT. No real auth/service JSON, agent settings, shell startup, tmux config, wrapper or global link was accessed or changed. No network gh, real AO invocation, commit, push or PR was made. HEAD remains ac1cbf4b and the tracked diff is empty. Only the requested untracked review/report files were written; .agent_task.md was read.

Removed the 21 residual test-state roots explicitly named in this review's own logs, after checking their processes were gone:

```text
/tmp/ao-test-state-485844
/tmp/ao-test-state-485857
/tmp/ao-test-state-535437
/tmp/ao-test-state-535379
/tmp/ao-test-state-620346
/tmp/ao-test-state-620192
/tmp/ao-test-state-620183
/tmp/ao-test-state-612287
/tmp/ao-test-state-612258
/tmp/ao-test-state-636457
/tmp/ao-test-state-636455
/tmp/ao-test-state-628379
/tmp/ao-test-state-628415
/tmp/ao-test-state-628392
/tmp/ao-test-state-644499
/tmp/ao-test-state-644521
/tmp/ao-test-state-644508
/tmp/ao-test-state-654682
/tmp/ao-test-state-654435
/tmp/ao-test-state-654400
/tmp/ao-test-state-507058
```

Removed `/tmp/aor2ar`, its marker, and the two stale private socket files after the empty process audit. Required evidence and reproducible fixtures are retained in this review. No scratch lifecycle worker or private pane/server remains.
