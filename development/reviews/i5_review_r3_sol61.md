# I-5 blind review, round 3 — ao-43

NOT-LAND-SAFE

Target `56f8461c..72e5e59f`, whole `592441d6..72e5e59f`, reviewed 2026-10-20. New findings: **1 blocker (B-3), 2 major (M-4, M-5), 1 minor (m-2)**. B-1 and B-2 are partly fixed; M-2 and M-3 are fixed for their original record-write/archive identity-loss cases. Review IDs M-4/M-5 below are separate from the out-of-scope OpenCode model-turn measurement labels of the same names.

The task overrides the generic session push/PR instructions: no implementation edits, commits, pushes, PRs, network gh, real-session sends, or model turns. Review evidence is appended here during execution. Initial worktree had only the dispatch task/report untracked. Marker: `/tmp/i5r3-ao43-20261020-marker`. The real `~/.ao/bin` listing and file hashes were saved; `/tmp/ao-opencode-launch-44402` initially contained only `.` and `..`.

Read the prior review rules, round 1/2 reviews, round 3 author brief, project CLAUDE.md and source before the author report. Initial source conclusions: retry identity has moved to a separate per-OpenCode-session file; begin claims under the lock; stale-lock breaking uses an exclusive claim plus token recheck; lock polling and clear backoff await timers rather than synchronously sleeping. Candidate failures to reproduce: a crashed stale-lock breaker can strand its claim indefinitely; a failed clear can make another process's later intended equal send a replay; failed ledger removal is marked cleaned before removal and therefore is not retried by cleanup. At this initial checkpoint no verdict had been assigned.

Initial real bin listing:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Confirmed checkpoint: interrupted stale-lock cleanup

`delivery-ledger.ts:294–305`: interrupted a real child immediately after publishing the exclusive `.break-<old-token>` claim, before removing the stale lock. Killed exact breaker PID 1949370. The lock owner PID 1949369 had already exited. Two fresh send attempts each fail, although both owners are gone:

```text
RETRY 0 FAILED DeliveryLedgerBusyError ... by the dead process 1949369, and another process is breaking it; remove ...ses_probe.json.lock and ...ses_probe.json.lock.break-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa if no ao process runs ... more than 2000 ms
ELAPSED 2017 HEARTBEATS 99
RETRY 1 FAILED DeliveryLedgerBusyError ... same two paths ... more than 2000 ms
ELAPSED 2023 HEARTBEATS 100
FILES STILL [ses_probe.json.lock, .ses_probe.json.lock.break-...tmp-1949370-..., ses_probe.json.lock.break-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa]
```

The claim stores a PID/start/token but no code reads it. Every future waiter gets EEXIST forever, with no expiry. This is a permanent per-session availability failure requiring operator removal, not a violation of mutual exclusion. Timer heartbeats show that the two-second wait does **not** block the event loop. File reads/writes inside each attempt remain synchronous. A lifecycle poll awaits this failed send and keeps its dispatch hash; other asynchronous work can proceed.

Independent gates so far: install/build/core/plugin/CLI/integration pass; core 38 files/1073 tests, plugin 2/298, CLI 19/256, integration 10 passed + 3 skipped files, 90 passed + 24 skipped tests. Five ledger runs pass 22/22 each. An additional ledger run pinned to one CPU alongside six busy-loop processes passes 22/22 (11.11 s wall time). The explicit <3500 ms assertion still has scheduler sensitivity; these passes establish observed behavior, not a CI scheduling guarantee.

Six new scratch-copy mutants (archive of 72e5e59f; worktree implementation untouched): release without token check **survives 57/57**; stale-lock rule ignores start time **survives 57/57**; never clear in-flight set fails 2; ignore admittedNotCleared fails 2; key by AO ID fails 13; expire by createdAt fails 1. Detailed test names and interpretation will follow.

## Confirmed checkpoint: success followed by a lost intended equal send

`delivery-ledger.ts:221–226,590–627`, `session-manager.ts:2934`: actual isolated service admits `INTENDED AGAIN`. Injected EACCES only for `rmSync(<ledger>.json)` after admission, covering all three clear attempts. The first CLI exits 0 without a cleanup warning. Its persisted entry stays `sending`; `admittedNotCleared` exists only in that exited process. Removed the fault and invoked a separate CLI with the same text as an intended new send:

```text
first: exit 0, 2.802 s
Message admitted to r3-clear (input msg_1579ebf24001n8RufeBz3Zef2n, delivery queue)
retained: sending, owner PID 1964290, token ca464db5-f49a-4ede-88db-6f8073ac5267
second: exit 0, 1.858 s
Message admitted to r3-clear (input msg_1579ebf24001n8RufeBz3Zef2n, delivery queue)
An earlier attempt of this send already admitted input msg_1579ebf24001n8RufeBz3Zef2n; nothing new was admitted.
user records: [msg_1579ebf24001n8RufeBz3Zef2n: INTENDED AGAIN]
inbox: []
ledger after second: absent; locks: []
```

The replay line is correct and visible to a CLI user, but core `send(): Promise<void>` gives lifecycle/review-check no replay signal and reads success. Clear retries narrow this case but do not remove it. The docs disclose it and advise a human to send yet again; that does not repair the automatic caller's successful acknowledgement of a new dispatch with no new input. This is independent of the old TUI/model-turn limits.

Positive live results: SIGKILL after admission reuses `msg_1579e0b5d001J55TSTrTqYTkZw` (one user); SIGKILL before transport reaches the service reuses `msg_1579e1b4e001lmuJJEnXIIqE8I` (one new user, **no replay line**); failed unknown rename in long-lived PID 1956463 reuses `msg_1579e27b2001QbHMwu23G0P6dt` (one user); archive kill/restore reuses `msg_1579e34c5001gm1nKDIuYjEWhG`; paused real metadata writer preserves the ledger and EXTERNAL-HASH while retry reuses `msg_1579e4d1f001EN22lCyAWgZRVr`; corrupt JSON and bad SHA refuse unchanged before prompting. Late completion in both orders gives one input; an earlier equal input does not falsely acknowledge the new ID. Two real lifecycle checks use `msg_1579eaf2c001izCOPPimRlOg81` once: first leaves dispatch hash absent and unknown ledger; second records `REVIEW-R3-CI:failed:FAILURE` and clears the ledger. Two AO records sharing one stored session ID reuse `msg_1579ed412001fetoL1TAyqI72p`, one user.

## B-3 — A retry from another process still duplicates after a failed unknown-state write while the first owner remains alive

**Blocker.** Locations: `packages/core/src/delivery-ledger.ts:221–226` and `:624–627`; `packages/core/src/session-manager.ts:2843–2847`.

The in-flight set records **attempt** liveness only inside its process. A failed write of unknown leaves `sending` on disk even after that attempt has settled. Another process sees the owner PID alive and cannot see that the token is out of flight. It treats a retry as a concurrent intended send and mints a new ID. A long-lived lifecycle worker normally remains alive after its send throws, so waiting for owner death does not cover a human/second caller retry while the worker runs.

Independent run on the real isolated service, with the real core manager and OpenCode plugin:

1. Worker PID 1977628 sends `LIVE OWNER FAILED UNKNOWN`; service admits `msg_157a12d18001BrMU7tZj15kCMo`.
2. Shim replaces answer with `data:null`, recovery inbox read returns 503, and the actual rename to persist unknown throws EACCES. Worker returns from `sm.deliver` with AgentDeliveryError, prints its settled ledger, restores writes and stays alive, doing no send. The attempt is no longer in flight.
3. A separate worktree CLI immediately retries the same text (about 2 s later):

```text
LIVE IDLE OWNER 1977628
ledger: sending msg_157a12d18001BrMU7tZj15kCMo, owner startTime 151518258, token 5da918c8-5a1a-47a9-8bca-15686c08eafd
INPUT COUNT before retry: 1
CLI r3-cross-owner exit 0, 1.873 s
Message admitted to r3-cross-owner (input msg_157a135a8001SWAvM4mmvG50z7, delivery queue)
AFTER CROSS-PROCESS RETRY COUNT 2
users:
  msg_157a135a8001SWAvM4mmvG50z7: LIVE OWNER FAILED UNKNOWN
  msg_157a12d18001BrMU7tZj15kCMo: LIVE OWNER FAILED UNKNOWN
inbox: []
ledger: original sending entry still present; locks: []
STOP EXACT WORKER 1977628
```

This is not the required intentional concurrent-send case: the first send already failed and its prompt/recovery/settle finished before the retry started. No API request remained held. Fault injection targets the same rename failure as B-2's round 2 reproducer. It requires neither PID reuse nor unreadable proc nor any known TUI limitation. B-2 and B-1 are therefore **partly fixed**, not fully fixed: crash recovery and same-process failed-settle recovery are corrected, but this caller crossing still duplicates.

Required direction: represent attempt liveness across processes, or otherwise refuse/coordinate an unresolved retry rather than equating a live process with an in-flight attempt. A process-released per-attempt kernel lock or an owner query can supply evidence a local Set cannot. Preserve distinct IDs for truly concurrent intended sends and add this failure-and-retry ordering as a behavioral test.

## M-4 — A killed stale-lock breaker permanently disables sends to that session

**Major, availability.** This is the interrupted-cleanup checkpoint above (`delivery-ledger.ts:294–305,344–350`). Both PID/start-time identities can be conclusively dead, yet the exclusive claim is never read or reclaimed. It is not merely a two-second contention delay: every send keeps failing indefinitely, including after the ten-minute entry lifetime. A lifecycle worker keeps attempting and cannot deliver the reaction. The operator text is helpful, and the docs admit the limitation, but a recovery mechanism for interrupted writers should not itself require manual repair after an ordinary SIGKILL. Stop-after-link is a legal process interleaving; the extra orphan temp link is harmless but also never collected.

A correct automatic design exists: on this Linux CLI a stable lock file protected by an OS advisory lock releases ownership on process death. All writers must participate and the stable file must not be unlinked/replaced while using that lock. A sufficiently proved reclaim protocol is another option. Merely deleting a claim after a dead-PID check repeats the check/unlink race one level down; a second stale observer can delete a replacement claim. A recursive unproved break is not the requested fix. Preserve token checks and add a crash-at-claim test alongside the existing six-waiter test.

## M-5 — A failed clear can acknowledge a new lifecycle dispatch without admitting its input

**Major, missed delivery.** Locations: `delivery-ledger.ts:221–226,590–627`, `session-manager.ts:2840–2847,2934`; unchanged consumer `lifecycle-manager.ts:1035–1052`. The `INTENDED AGAIN` reproducer above shows the CLI behavior. A second independent run used the exact text from the real CI formatter. First CLI admitted `msg_157a2133b001eK1AgX1ZzZr7ru` and exited 0 after all clear removals failed. That process exited; then the real lifecycle checker encountered a new CI dispatch with no prior dispatch hash:

```text
first CLI exit 0, 2.837 s
Message admitted to r3-clear-ci (input msg_157a2133b001eK1AgX1ZzZr7ru, delivery queue)
new lifecycle CHECK 0:
lastCIFailureDispatchHash = REVIEW-R3-CI:failed:FAILURE
lastCIFailureDispatchAt = 2026-10-20T04:46:45.717Z
CHECK 1: same dispatch hash; no further send
user inputs: [msg_157a2133b001eK1AgX1ZzZr7ru: CI checks are failing on your PR ... REVIEW-R3-CI ...]
inbox: []
ledger: absent; locks: []
```

The new reaction admitted no input. The checker cannot see the CLI's replay line: it calls `send`, whose successful resolution is `void`. The first success also gave no clear-failure warning, although `settleDelivery` returned false. The docs state this chosen limitation, and retries are an improvement over round 2; neither makes a new logical send equivalent to the previous successful one.

Keep a successful entry distinguishable from an unresolved attempt across process death, or surface the unresolved settlement so callers cannot commit a new dispatch as delivered. Where deletion alone fails, persisting an admitted tombstone can work; where every persistence operation fails, the API must expose that unresolved bookkeeping rather than silently returning ordinary success. Add the separate-process and lifecycle tests; the current tests cover only same-process suppression with admittedNotCleared.

## m-2 — Failed purge-ledger removal is never retried, and the expiry warning promises cleanup that does not run

**Minor, orphaned state and misleading operator guidance.** `session-manager.ts:2328–2350,2499–2501,2523–2524`; `delivery-ledger.ts:478–480`. Purge marks the archive `opencodeCleanedAt` before trying to delete the ledger. The helper catches removal errors and says “its entries expire after 10 min.” Every later cleanup skips that archive. Expiry executes only on a ledger change, and the removed OpenCode session will not receive a normal future send. The file therefore persists indefinitely, even after permissions recover. This does not revive a removed OpenCode session or affect a new ID; it is not another delivery blocker.

Independent run: `r3-purge-fail`, stored ID `ses_ea85d6136ffed6J1ISwpV1xn0u`, ledger held unknown `msg_157a2b0cf001d6y9t5Zlab28ij`, owner PID 1986976, updatedAt `2026-10-20T04:47:22.545Z`. Injected EACCES only on the ledger removal after service deletion. Kill exits 0, archive is marked cleaned, and the warning is printed. Restore file operations and run real CLI cleanup:

```text
PURGE r3-purge-fail exit 0
Session r3-purge-fail killed.
ao: could not remove the delivery ledger ... (review failed clear); its entries expire after 10 min.
CLEANUP RETRY exit 0
Checking for completed sessions...
  No sessions to clean up.
LEDGER STILL True
```

Keep ledger cleanup retryable independently of service cleanup, and distinguish logical expiry on a later change from actual removal. The same retention fact applies to an ordinary abandoned ledger that never receives another change; no autonomous sweep exists.

## Prior findings and source conclusions

| Earlier finding | Status | Evidence |
| --- | --- | --- |
| B-1, durable identity across uncertain retry | **partly fixed** | Real lifecycle retry and both late orders admit once; B-3 still admits twice across callers after a failed settle. |
| B-2, interrupted sending/failed unknown write | **partly fixed** | SIGKILL after admission and same-process failed rename now reuse the ID. B-3 covers a live but settled owner retried from elsewhere. |
| M-2, record writers erase identities | **fixed** | Separate ledger and locked changes; paused real updateMetadata writer preserves the bytes, and external hash survives delivery. Two-process 30-entry test and six-waiter exclusion test pass. The new lock availability defect is M-4. |
| M-3, archive restore loses identity | **fixed** | Real kill without purge removes active record, archive restore retains stored ID, retry replays exactly that input. Independent ledger stays across both. Purge success and archived cleanup success remove it; failed removal is m-2. |
| M-1, earlier equal input is acknowledged | **fixed** | Exact-ID read-back refuses the new unadmitted ID, while the older equal input remains. Retry admits the new ID; two logical sends have two inputs. |
| m-1, restore prose overclaims pane protection | **fixed** | Spec/types/core comment now state terminal status OR exited agent, excluding merged; restore implementation unchanged. |

The ledger path in this run was `/tmp/i5r3-ao43-20261020/state/500ebab3d65d-project/deliveries/<stored-ses-id>.json`. `getDeliveryLedgerDir` follows AO_STATE_ROOT, is exported additively, and is outside `sessions/`. begin(mint, key) is awaited after size/TUI/context checks and before prompt; a rejected begin cannot call prompt. Lock scope is one synchronous read/change/write, never the API request. Claims of an unknown entry update owner/state/updatedAt atomically under that lock, with inFlight set before publication. The attempt token also gates settlement, so an old settlement does not remove a newer claim.

For ordinary interleavings, mutual exclusion is maintained: link publishes complete contents; the stale cleanup claim serializes breakers of one old token; a delayed waiter rereads the token before unlink and cannot remove a new holder; release checks its own token. PID reuse with a different start time makes a lock stale. There is no general time-based theft of a live lock. The stranded-claim issue is an availability failure, not evidence that two legitimate holders overlap. Additional scratch probes confirm the implemented guards: baseline preserves a replacement lock and detects an old start time; removing each guard separately fails the corresponding probe. The checked-in tests miss both guards (mutant results below).

On this host, kill(1,0) returns EPERM, and isDeliveryOwnerAlive({pid:1,startTime:null}) is false; same-user test processes have readable numeric start times. EPERM means permission denied, not universally process death, but under the code's assumption that all ledger owners were this UID and do not change credentials, a PID now owned by another UID is not the original writer. No existing AO path changes its UID. An unreadable self stat in an isolated fault probe counted alive. Conservatively treating unreadable proc as live avoids stealing an active attempt, at the documented cost of possible reminting under PID reuse. No unreadable-proc assumption is needed for B-3.

Key validation excludes separators, dots, leading punctuation and >128-character keys, so normal keys cannot escape the directory. Input IDs, SHA-256, timestamps, state and PID/start/token are checked; duplicate IDs, wrong key/version and non-object/no-array files fail closed. Extra fields and Date.parse-compatible non-ISO dates are accepted; there is no authenticity check on a syntactically valid edited identity. Read errors other than ENOENT refuse rather than overwrite. All entries are validated before expiry, including expired malformed entries. Corrupt-file operator text names the file and requires quiescence before manual removal. This is the correct direction for the retry-identity store: fail-open could turn damaged bookkeeping into a duplicate. The spec also warns that deleting unresolved entries loses identity. Inbox alone is not exhaustive for manual inspection because admitted inputs can already be user messages; operators should inspect those too.

Actual corrupt-file lifecycle check repeated twice: bytes and mtime unchanged, no new input, dispatch hash absent after both. The unchanged CI/conflict callers retry on later eligible polls; there is no corruption backoff or permanent-error suppression. Generic transition reactions are not universally reissued without a new transition, as already noted in round 1. review-check prints its failure and continues. No fallback paste follows a ledger refusal.

Files/directories are not private by default: observed ledger 0644, deliveries directory 0755, lock/claim temp and hard links 0600, under the inherited umask. The ledger stores a text hash, no message body. These modes match the existing atomic-write primitive; no mode tightening was introduced. Empty ledger deletion is under the lock. Entries prune by updatedAt on a later change, not on a timer; the 200-entry limit refuses a new send while still allowing reuse, rather than dropping an unresolved entry. Failed atomic rename can leave an orphan temp file, which normal pruning does not remove.

The lock wait and 200/1000 ms clear backoffs await timers; they do not synchronously block other sessions for 2 or 7.2 seconds. The synchronous filesystem/proc work in each poll still occupies the event loop briefly. The send's promise and lifecycle poll remain pending; pollAll awaits all checks and its reentrancy guard skips overlapping polls. The spec correctly calls 80 s a nominal sum and now lists record/runtime/restore costs, final poll rounds, API child SIGKILL grace and claim/settle/clear lock waits. It is not a hard SLA.

EPIPE now has a real started-child regression test and plugin found/not-found recovery cases. Other post-PID I/O errors share that unknown-admission path; pre-exec failures remain definite. `<=` produces the requested same-millisecond replay mark; every observed new admission, including a reused but never admitted ID, printed no replay line. The claim that every new timestamp must be later assumes a nondecreasing wall clock and sufficient clock resolution; a backward wall-clock adjustment could label a new input replayed. That informational edge does not itself alter admission/ID bookkeeping and is not a numbered finding here.

## Independent isolated CLI and pane evidence

Service version 2.0.32, PID **1920957**, port **49648**, verified with server.info before writes (not 15920). All XDG roots and both HOME directories under `/tmp/i5r3-ao43-20261020`; isolated config disabled opencode. Before the first prompt:

```json
{"location":{"directory":"/tmp/i5r3-ao43-20261020/gate-home"},"data":[]}
```

Every created session explicitly used `rev3-none/none`. All TUI-looking processes were stand-ins. Private tmux server `i5r3-ao43-live-20261020`, PID 1945479, started in the sanitized environment. Pane /proc environments were inspected before prompts: fake HOME, scratch PATH, scratch AO_STATE_ROOT and AO_CONFIG_PATH only, private TMUX socket. Test/gate tmux went through a different private shim. gh resolved to the non-network stub. No credential file was read.

| Case | Actual CLI/output and service evidence |
| --- | --- |
| (a) normal | Exit 0: `Message admitted to r3-main (input msg_1579c426d001bFHyVYy5aktsGU, delivery queue)`. One user `A admitted once`, inbox empty, ledger absent, no lock, pane byte-identical. |
| (b) stopped stand-in | Stop exact main stand-in PID 1945492. CLI exit 0 admits `B restored send`; runtime replaced, stored ID retained, new stand-in shown below. No pasted message. |
| (c) removed session | Exit 1: `Message not sent to r3-late-before: the OpenCode session ses_ea8620d56ffecRql5xJ1rR8Fiq ... does not exist (session.prompt answered 404 SessionNotFoundError) ... nothing was sent`. Pane unchanged, ledger absent. Zero usage was read before deletion. |
| (d) sizes | 131000-byte ASCII / JSON 131068 and exact JSON 131071 admitted whole; JSON 131072 refuses with `more than the 131071 bytes ... nothing was sent`. 204800-byte text / JSON 204868 also refuses. Escapes, newline, NUL, é and emoji: text 123003 UTF-8 bytes / JSON 131071 admitted whole, SHA-256 b41afe357450b4c9fecd38fe9057e1d6975de890fb0c144a7003909f316c1c91. Rejected inputs absent; captures unchanged. |
| (e) Claude stub | Exit 0: `Message sent and processing`; captured pane contains `E stub paste` and `got: E stub paste`, followed by `>`. No API prompt for that text. |
| (f) wrong-session TUI | Exit 1 in 12.057 s: no TUI on stored ses_ea85dd0ebffeRKtz4nbaU2bLoi, then restore refusal `session is not in a terminal state`. Existing wrong-session TUI and pane unchanged; no input. |
| (g) concurrent equal text | First CLI held after admission while its PID/attempt stayed live. Second CLI exit 0: `Message admitted to r3-concurrent (input msg_157a2869f001RbMUSgBqdb1vGM, delivery queue)`. Two distinct durable inputs of `G concurrent equal`, no lost entry. Held CLI and transport stopped by exact PID. This deliberate concurrency differs from B-3's completed failed attempt. |
| archive cleanup | An unknown `ARCHIVED CLEANUP` survives real no-purge kill; real `ao session cleanup --project review` removes service session and ledger. |

Normal pane before and after (a), omitting only the invariant shell startup banner:

```text
opencode --session ses_ea863cfeeffejNQCdl0oXo5uYE
R3 STAND-IN pid=1945492 --session ses_ea863cfeeffejNQCdl0oXo5uYE
```

After main restore:

```text
opencode --session 'ses_ea863cfeeffejNQCdl0oXo5uYE'
R3 STAND-IN pid=1970855 --session ses_ea863cfeeffejNQCdl0oXo5uYE
```

Archive pane before/after likewise changed only from the original stand-in to its restore launch and `R3 STAND-IN pid=1957228 --session ses_ea86210d3ffemPejjsdIc0QOWl`; `ARCHIVE RETRY` was never pasted. B-3's pane before/after retained `R3 STAND-IN pid=1977474 --session ses_ea85ee29bffelMCyhtbJ7BdnYu`, with no `LIVE OWNER FAILED UNKNOWN` paste. Both duplicates are service inputs, not runtime paste artifacts.

Harness corrections: the first large-history observer used a pipe and hit the already-known CLI stdout truncation; observers were changed to regular files. Rerunning already-successful size/restore commands created explicitly intended additional inputs; the valid boundary check compares per-input length/hash, not the accumulated count. session.remove returns empty output, so its observer was corrected to accept that rather than JSON-parse it. The Claude stub's first banner lacked a standalone idle prompt; a private-pane Enter made it print `>`, after which the waiting old-path CLI delivered. Its 69 s elapsed time is fixture waiting, not a new product delay. None of these harness failures is used as a finding.

## Gates, repeated runs and new mutants

All gates ran in this reviewer worktree, with env -i, fake HOME, scratch TMPDIR/XDG and no inherited AO variables. HOME began as a new empty scratch directory; later commands/full suite used freshly allocated empty gate HOMEs. opencode was absent from the gate PATH, including integration and full suite; live helpers had their separate PATH. HUSKY=0, gh stub and private tmux shim were used. No implementation source was changed for any gate.

| Gate | Actual summary |
| --- | --- |
| pnpm install --frozen-lockfile | exit 0; frozen lock unchanged. Initial missing CLI dist bin warning preceded the build; all build output then succeeded. |
| pnpm build | exit 0, all packages built in dependency order. |
| core filter | 38 files, 1073 passed. |
| OpenCode plugin filter | 2 files, 298 passed. |
| CLI filter | 19 files, 256 passed. |
| integration filter, opencode hidden | 10 files passed / 3 skipped; 90 passed / 24 skipped. |
| pnpm lint | exit 0: 0 errors, 5 existing warnings (spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:1702/1709). |
| pnpm typecheck | exit 0, all packages. |
| full pnpm test | exit 0: **2526 passed / 29 skipped**, 13 tested packages. |

Other full-suite passed counts: Claude 208, Codex 215, Gemini 62, desktop 26, Herdr 36, tmux 30, SCM GitHub 140 plus 5 skipped, tracker GitHub 42, worktree 50. Together with the filtered-package totals above these sum to 2526; integration supplies the other 24 skips.

Ledger file repeated results: runs 1–5 each **22 passed**, wall durations **5.88, 5.90, 5.81, 5.97, 5.89 s**. Extra loaded run: 22 passed, **11.11 s**, pinned to CPU 0 with six busy-loop children on the same CPU; exact load PIDs 1949413–1949418 terminated and reaped after the test. No flake was observed in these six runs.

The child tests transpile current ledger.ts and atomic-write.ts into their own ESM directory, rather than accidentally exercising stale dist; strict typing is separately covered by typecheck. The tests perform real cross-process file contention, check entries at prompt time, admission identity, archive restore and old-snapshot record writes. The fake-service Set in the crash test models reconcile; the live runs above supply the actual service evidence. chmod-based failures assume an unprivileged runner; root bypasses that premise. afterEach kills children without awaiting close/reaping before fixture removal, which is a cleanup-race risk. The 4 s real holder / >=2 s and <3.5 s parent assertion also assumes scheduling: a heavily descheduled parent can time out late or resume after the holder releases. A CPU-load pass cannot prove that bound under all CI scheduling. Prefer a controlled live holder/release barrier and eventual outcome over a strict 1.5 s timing margin.

New mutations used `git archive 72e5e59f` in a separate scratch copy, with dependency directories linked read-only in use to the installed worktree. Each source file was restored before the next mutation. Each run selected the ledger and send-agent files, 57 baseline tests; no author-listed mutant implementation was reused.

| Reviewer mutation | Observed result |
| --- | --- |
| release ignores token | **Survives 57/57.** No checked-in test replaces the on-disk token before the old release. |
| stale-lock rule ignores startTime, keeping kill(0) only | **Survives 57/57.** Entry PID reuse is tested; stale-lock PID reuse is not. |
| inFlight never cleared at settle | 2 fail / 55 pass: ledger “a failed write of unknown in this process...” and send-agent “B-2: a failed write of unknown in a long-lived process...”. |
| admittedNotCleared ignored | 2 fail / 55 pass: both “item 4: a failed clear after a success...” tests. |
| key by AO session ID instead of stored OpenCode ID | 13 fail / 44 pass in send-agent: persist-before-prompt, failed-read retry, lifecycle retry, archive restore, old snapshot, concurrent sends/claim, age, owner/write recovery, failed clear, unexpected error, corrupt-file checks. Several fail on expected path/state assertions rather than duplicate admissions: archive/old-snapshot still admit once with an independently stored ledger keyed by the same AO ID. This is narrower than the author's in-record mutant. The live alias case above supplies the missing two-AO-record behavior. |
| expiry uses createdAt | 1 fail / 56 pass: ledger “reuses an entry changed 9 min ago, and removes one changed 11 min ago” (created 30 min ago, updated 9 min ago). |

To distinguish an ineffective mutation from missing coverage, independent scratch probes exported only the two private guard functions from a transpiled copy, then supplied a replacement-token lock and an old-start-time lock:

```text
baseline          release preserves replacement: true  stale old start time: true
release-no-token  release preserves replacement: false stale old start time: true
stale-no-start    release preserves replacement: true  stale old start time: false
```

These probes show the two surviving mutants alter the intended guards. They do not replace checked-in interleaving tests. No existing test covers B-3's different-process retry after a **completed** failed settle, M-4's killed breaker, M-5 after owner exit, or m-2's cleanup retry.

## Scope, size and correct aspects

All five round 3 commit diffs and their source/test effects were read; the author report was opened after the independent section 2.1–2.6 audit. All 17 changed files over `592441d6..72e5e59f` are allowed, with **4911 inserted / 28 deleted** lines. Round 3 adds delivery-ledger.ts/tests and only the new path helper/tests in paths.ts. lifecycle-manager.ts, metadata.ts and review-check.ts have no diff; restore() has no implementation diff. Core exports are additive to the landed base. The 17 commit messages use conventional prefixes and WHY-bearing bodies, no Co-Authored-By, issue-number reference or emoji. `git branch -r --contains 72e5e59f` printed nothing.

About 3062 of the inserted lines are tests. Most of the production expansion addresses the new contract: API error classification/file output, exact-ID recovery, TUI check and ledger are needed. A concrete simplification opportunity is `session-manager.ts:2850–2853` and `send-agent.test.ts:947–975`: handling/testing a second begin after no-TUI restore is unnecessary for the actual OpenCode hook, which guarantees AgentNotAttachedError **before** begin. It tests a hook violating that order. The custom stale-claim protocol (`delivery-ledger.ts:233–368`) is also a candidate for replacement by a smaller proven OS-lock abstraction; keep owner/attempt identity and failure behavior explicit. This is size advice, not an extra finding.

Correct aspects: ordinary uncertain retries and both late orders keep one input; exact-ID read-back avoids earlier-equal/newest-message confusion; size refusal precedes restore; pre-exec failure is definite while EPIPE is unknown; concurrent intended equal sends remain distinct; record writes and archives no longer erase IDs; 200-entry refusal preserves unresolved identities; corrupt files fail closed; legacy non-hook routes and Promise<void> send compatibility remain; CLI failure/replay lines are accurate in the exercised cases; docs now disclose timing and restoration limits.

No numbered finding depends on OpenCode 2.0.29 model-turn measurements, the three-second age heuristic, a split pane, a TUI exiting while queued input waits, or the first-poll killed race. The actual attached-TUI environment and turn/queue semantics remain supplied measurements, not remeasured here. The standalone kernel-lock proof reacquired an OS lock after SIGKILL of exact holder PID 2000268 without removing its stable file, confirming an automatic-cleanup alternative is feasible on this host.


## Final usage and safety evidence

All 21 created isolated sessions used rev3-none/none. Each of the 17 survivors had the following exact final zero counters (read before stopping the service):

```text
ZERO ses_ea85d93cdffeQzec6FY4QOo87p REVIEW R3 r3-concurrent {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea85dd0ebffeRKtz4nbaU2bLoi REVIEW R3 r3-wrong {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea85dfeb5ffey8rE6tWi1MjmYx REVIEW R3 r3-clear-ci {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea85ee29bffelMCyhtbJ7BdnYu REVIEW R3 r3-cross-owner {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea85ee0c6ffexLsbBvWJWSMSsF REVIEW R3 r3-claude {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea863cfeeffejNQCdl0oXo5uYE REVIEW R3 r3-main {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea862079dffeUL9w0w1qlEyxLD REVIEW R3 r3-alias {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea86208baffengh13d0wkxqE2O REVIEW R3 r3-clear {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea86209e7ffePjNB428ttlfdgP REVIEW R3 r3-ci {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8620b17ffe17cPckTnlf0Q2y REVIEW R3 r3-earlier {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8620c3fffeY4ucW3tSLz1dOo REVIEW R3 r3-late-after {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8620e74ffe5B42iHnXAKSl5g REVIEW R3 r3-corrupt {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8620fabffeNpTEsj4OXBUeWA REVIEW R3 r3-race {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea86210d3ffemPejjsdIc0QOWl REVIEW R3 r3-archive {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea86211eeffeOXh1jJzJfmgmIz REVIEW R3 r3-write {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8621322ffeV2b2bL23TAxEOg REVIEW R3 r3-before {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
ZERO ses_ea8621466ffelV0ucTXX81oOUO REVIEW R3 r3-crash {"id": "none", "providerID": "rev3-none", "variant": "default"} 0 {"input": 0, "output": 0, "reasoning": 0, "cache": {"read": 0, "write": 0}}
```

The four deleted sessions were read immediately before deletion, also cost 0 and tokens `{input:0,output:0,reasoning:0,cache:{read:0,write:0}}`:

- `ses_ea8620d56ffecRql5xJ1rR8Fiq` (REVIEW R3 r3-late-before): cost **0**, all token fields **0**.
- `ses_ea862066effe7iz0EG1lluTHim` (REVIEW R3 r3-purge): cost **0**, all token fields **0**.
- `ses_ea85d6136ffed6J1ISwpV1xn0u` (REVIEW R3 r3-purge-fail): cost **0**, all token fields **0**.
- `ses_ea85b0c09ffe8S3MN0zQMmA3ph` (REVIEW R3 r3-cleanup): cost **0**, all token fields **0**.

Final model.list remained `{"location":{"directory":"/tmp/i5r3-ao43-20261020/gate-home"},"data":[]}`; server.info still reported PID 1920957. No API call is made after service shutdown. No real TUI or provider request was made.

Final process cleanup (interactive pane shells required SIGKILL after ignoring SIGTERM; each target was an exact owned PID):

```text
STOP EXACT standin 1953640
STOP EXACT standin 1953675
STOP EXACT standin 1953710
STOP EXACT standin 1953851
STOP EXACT standin 1953889
STOP EXACT standin 1953924
STOP EXACT standin 1953959
STOP EXACT standin 1953994
STOP EXACT standin 1954029
STOP EXACT standin 1954064
STOP EXACT standin 1954099
STOP EXACT standin 1957228
STOP EXACT standin 1964931
STOP EXACT standin 1970855
STOP EXACT standin 1977474
STOP EXACT standin 1977535
STOP EXACT standin 1981879
STOP EXACT standin 1983895
STOP EXACT standin 1984800
STOP EXACT pane shell 1954087
SIGKILL EXACT pane shell 1954087
STOP EXACT pane shell 1964919
SIGKILL EXACT pane shell 1964919
STOP EXACT pane shell 1957210
SIGKILL EXACT pane shell 1957210
STOP EXACT pane shell 1953663
SIGKILL EXACT pane shell 1953663
STOP EXACT pane shell 1954017
SIGKILL EXACT pane shell 1954017
STOP EXACT pane shell 1977523
SIGKILL EXACT pane shell 1977523
STOP EXACT pane shell 1954052
SIGKILL EXACT pane shell 1954052
STOP EXACT pane shell 1981867
SIGKILL EXACT pane shell 1981867
STOP EXACT pane shell 1984788
SIGKILL EXACT pane shell 1984788
STOP EXACT pane shell 1953877
SIGKILL EXACT pane shell 1953877
STOP EXACT pane shell 1953628
SIGKILL EXACT pane shell 1953628
STOP EXACT pane shell 1977452
SIGKILL EXACT pane shell 1977452
STOP EXACT pane shell 1953982
SIGKILL EXACT pane shell 1953982
STOP EXACT pane shell 1953947
SIGKILL EXACT pane shell 1953947
STOP EXACT pane shell 1953912
SIGKILL EXACT pane shell 1953912
STOP EXACT pane shell 1970835
SIGKILL EXACT pane shell 1970835
STOP EXACT pane shell 1953839
SIGKILL EXACT pane shell 1953839
STOP EXACT pane shell 1953698
SIGKILL EXACT pane shell 1953698
STOP EXACT pane shell 1983883
SIGKILL EXACT pane shell 1983883
STOP EXACT isolated OpenCode service 1920957
SCRATCH LIFECYCLE PID FILES []
PROCESS STOP COMPLETE
OWN PROCESSES []
SERVICE PID EXISTS False
TMUX PID EXISTS False
```

The crash/hold transport processes, paused record writer, kernel-lock holder and CPU-load children were also stopped/reaped in their test cases; normal runtime restore/purge destroyed the old private panes through the tested runtime. No detached scratch lifecycle worker was created (`SCRATCH LIFECYCLE PID FILES []`). Protected service 15920 and workers 19579, 19624, 19636, 19653, 19689 were still running at the final check.

Final `ls -la --time-style=full-iso ~/.ao/bin` (byte-identical to the initial listing; every file SHA-256 also identical):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Both required real-state scans returned empty output:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/i5r3-ao43-20261020-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'
find ~/.agent-orchestrator -path '*deliveries*'
```

`/tmp/ao-opencode-launch-44402` contained only `.` and `..` at both checks (mode 0700, directory mtime Oct 16 14:01). No reviewer entry was present.

Scratch root and marker removed: `/tmp/i5r3-ao43-20261020` absent; scratch ledger/lock/claim/temp files **[]**. This includes the intentionally stranded cleanup claim and failed-write temp files. Both private socket names are absent. No source edits, commit, push, PR, network gh, credential-file read, real-state write or default-server tmux call occurred. Only the requested review and overwritten report-back remain as reviewer deliverables.
