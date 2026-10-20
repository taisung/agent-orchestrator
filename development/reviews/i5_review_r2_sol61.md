# I-5 review round 2 — ao-42

NOT-LAND-SAFE

Target `a6b37297..56f8461c`; whole change `592441d6..56f8461c`. New findings: **1 blocker (B-2), 2 major (M-2, M-3), 0 minor**. Round 1: B-1 partly fixed, M-1 fixed, m-1 fixed.

Round 1 review and round 2 author brief read. At this initial checkpoint the author round 2 report had not been read; it was read after the independent items 2.1–2.6 audit. No implementation changes, commits, pushes, PRs or real-session sends are authorized. Every execution used `env -i`, fake HOME and scratch state. gh was a stub; tmux used only private servers `i5r2-ao42-20261019` (gates) and `i5r2-ao42-live-20261019` (live cases). No real TUI or provider request was made.

Initial marker `/tmp/i5r2-ao42-20261019-marker`. `~/.ao/bin` listing and hashes saved before work; launch-lock directory is empty (`.` and `..` only, mtime Oct 16 14:01). Existing untracked files are the task, report-back and round 1 review.

## Independent source checkpoint, before author report

Reviewed items 2.1–2.6 from source. The ordinary unknown-outcome path now persists a client ID before prompt, then retries by that ID; read-back uses the exact inbox ID then `session.message.get`, removing text/time ambiguity. The size preflight is before `prepareSession`, and the new spawn-error classification distinguishes a child that never started. Restore prose correctly describes terminal-status OR exited-activity semantics.

Unresolved candidates to reproduce: a process killed during prompt leaves `sending` and retries mint another ID; a failed/lost write of `unknown` has the same result because settlement is best effort; both pending-array update and whole-record update are unlocked across processes; archive restore drops the pending key; corrupt pending JSON silently becomes an empty array. These matter because metadata is now the only retry-identity store. A live concurrent equal send must still get its own ID, so simply reusing every `sending` entry cannot fix crash recovery.

The binary generator was independently read from the installed binary (not executed as a TUI). The code copies its low-48-bit ms×4096+counter prefix, 14 base62 characters and `msg_` prefix. Fork readers request timeline order and use created timestamps/ID equality rather than sorting OpenCode message IDs themselves; independent admission/order checks will follow.

## Confirmed recovery results and new findings

Round 1 **M-1 fixed**: an earlier equal queued input was not acknowledged when a new prompt admitted nothing; the new ID became `unknown` and its retry admitted that ID. Two logical messages had two IDs. Both controlled late-completion orderings now use one ID and one admission; the already-admitted retry prints the replay line. Round 1 **m-1 fixed** by the corrected prose. Round 1 **B-1 partly fixed**: completed unknown-outcome bookkeeping reuses IDs, but process death and lost ledger writes still cause duplicates.

### B-2 — An admitted in-flight send loses retry identity when its process dies or the unknown-state write fails

Locations: `packages/core/src/session-manager.ts:2893` (only `unknown` entries are reusable), `:2924–2936` (best-effort settlement), and `:429–442` (sending/unknown model, no owner/liveness evidence).

Independent live SIGKILL reproducer: invoke the real worktree CLI with a transport shim that calls the actual isolated service, then holds the answer. The durable input exists and its record entry is `sending`. SIGKILL only that CLI PID, stop only the held transport PID, then immediately retry the identical CLI message (well within 10 min). The retry mints a different ID and the isolated service holds the text twice. This is the round 1 duplicate-delivery failure after a normal managed-process interruption, not an out-of-scope TUI/environment race. Active concurrent sends must retain distinct identities; dead-owner attempts need a recoverable identity or an explicit uncertain-delivery refusal instead of silent reminting.

Independent second reproducer without process death: after actual admission and a deliberately lost answer/read-back, inject EACCES only for the atomic rename persisting `state:"unknown"`. Settlement swallows it. The CLI exits 1 with admission unknown but the ledger still says `sending`. Immediate retry admits a second input:

```text
first: msg_1573d042f001pYdbYx8sgpacHl, ledger sending
retry: msg_1573d0af2001R6mxbkbVFefgVk, exit 0
user records with identical UNKNOWN WRITE SAME TEXT: 2
```

The sending-state crash limitation is disclosed and is consistent with the author's instruction never to reuse a live sending entry; it still leaves B-1's HIGH-risk durable retry guarantee incomplete. The distinction needed is a live owner versus an interrupted attempt, rather than treating every sending entry as a new logical message.

### M-2 — Unlocked whole-record writes can erase the only durable retry identity

Locations: `packages/core/src/session-manager.ts:476` (`changePendingDeliveries` read/change/update), `packages/core/src/metadata.ts:176` (`updateMetadata` unlocked read/merge/write). The metadata primitive predates I-5; relying on it for the new admission identity makes the existing race a delivery correctness risk.

Deterministic two-process reproducer with the real metadata writer: pause writer A immediately after its read of the AO record, before it writes `lastCIFailureDispatchHash=EXTERNAL-HASH`. Run the actual CLI with an admitted request and failed answer/recovery; it leaves an `unknown` pending entry. Resume writer A, which writes its earlier snapshot. The pending entry disappears while the unrelated hash is set. Retry the same CLI text:

```text
before external commit: msg_1573d1a1e00185afU7jFV3KzFo, state unknown
external writer exit 0; after commit: pending [], hash EXTERNAL-HASH
retry: msg_1573d2170001m6bd44nKdpC3cl, exit 0
user records with identical RACE SAME TEXT: 2
```

The pause forces a legal cross-process interleaving; it does not change either update algorithm. Synchronous JavaScript prevents same-process interleaving only. Updating “this key only” does not protect other keys across processes, nor does it make the earlier pending-array calculation atomic. The reverse ordering can lose a newer dispatch hash; two sends can lose an entry or claim the same unknown entry. Use cross-process serialization/CAS for the ledger and coordinate whole-record writers, or store the ledger independently with a robust ownership protocol.

Isolated service is 2.0.32, PID 1370073, port 49644, verified not 15920 before writes. `model.list` before any prompt was `{"location":{"directory":"/tmp/i5r2-ao42-20261019/home"},"data":[]}`. Every session uses `rev5-none/none`, with provider opencode disabled. No real TUI or provider request was used.

### M-3 — Archive restore drops the pending-delivery identity and duplicates a retry

Location: `packages/core/src/session-manager.ts:3333–3354`, especially the `writeMetadata` reconstruction at :3335; new ledger integration at :2888–2917. The archive reconstruction predates I-5, but I-5 adds a persistence key it does not carry forward.

Independent live reproducer using the real session manager: admit `ARCHIVE RETRY`, lose its answer and recovery read, and verify an `unknown` pending ID. Call `sm.kill('r2-archive')` (without purge), then `sm.restore('r2-archive')`. The archived record retains the key; the restored active record has no `pendingDeliveries`. Retry immediately to the same stored OpenCode session:

```text
before kill: unknown msg_1573ede8f0012IhkJ5cb0oQNfp
active record after kill: null
active record after archive restore: stored OpenCode ID retained, pendingDeliveries absent
retry exit 0: msg_1573eee68001CsOBwUXRps1pOl
user records with identical ARCHIVE RETRY: 2
```

The added test for restoring an **active** record is useful but does not cover archive reconstruction. Preserve the ledger across the supported recovery route, or require explicit resolution of uncertain sends before a new ID is minted. This does not depend on the out-of-scope first-poll killed race, a split window, TUI attachment timing, or a queued TUI exit.

## Ledger format and other failure-path conclusions

The serialized entry contains only an ID, SHA-256 hex, ISO timestamp and enum; raw message text is not stored. JSON.stringify escapes newline/control characters and `=` is preserved by the first-equals key-value parser. Normal text, hashes and generated IDs cannot inject a metadata line. The 20-entry cap bounds normal value size to a few KB. Validation only checks field types/date/state, not canonical ID/hash syntax or string lengths; hand-edited valid JSON can therefore be larger or semantically invalid.

Invalid JSON or malformed entries are silently treated as no pending entry. Independent injection of `[broken-json` after an actual unknown admission produced a new ID and two `CORRUPT RETRY` inputs; unrelated `summary=retained summary` survived and other record readers did not fail. This is an additional fail-open identity-loss path, recorded with M-2's persistence concerns rather than a new numbered finding. The 20-entry cap and 10-min pruning can also discard an unresolved identity; success is only protected while that identity remains available.

`begin` rejects a record already absent at its read, before prompting, as covered by the test. There is still a cross-process deletion window between its existence read and update; the no-lock writer can recreate a deleted record. No same-process asynchronous callback runs between the synchronous operations, but that is not cross-process exclusion.

## Round 1 status and independent live evidence

- **B-1 partly fixed.** Two real lifecycle checks now admit the same input only once when the first attempt reaches the `unknown` state successfully. Crash/lost-write/archive recovery still remint IDs (B-2/M-2/M-3).
- **M-1 fixed.** Recovery requires this send's exact ID in the inbox or as a user message. It no longer depends on equal text or time slack, or on being the newest user message.
- **m-1 fixed.** All three prose locations now state terminal status OR exited agent, excluding merged, and correctly warn about a live pane under killed/done. `restore()` itself is unchanged.

The real lifecycle test used the real core session manager, lifecycle checker, OpenCode plugin and tmux runtime, with a fake read-only SCM returning one failing check and no GitHub calls. Its first admitted answer was replaced with `{"data":null}` and only the recovery inbox read failed with a synthetic 503. Evidence:

```text
first check: pending input msg_1573ea397001JwB0lCl5Of0Co6, state unknown
             lastCIFailureDispatchHash absent
second check: lastCIFailureDispatchHash R2-RETRY-CI:failed:FAILURE
              lastCIFailureDispatchAt 2026-10-20T02:58:07.430Z
user inputs naming R2-RETRY-CI: 1, ID msg_1573ea397001JwB0lCl5Of0Co6
pendingDeliveries absent after the second check
```

Controlled late admissions were replayed using the captured original **ID and body**, once before the retry and once after it. Each ordering produced one durable input; the first retry reused its unknown entry and successful settlement removed it. This repeats round 1's failure ordering without a model turn.

The independent SIGKILL case in B-2 was:

```text
CLI PID 1410302, holding transport PID 1411736
before kill: msg_1573ced4a001dJuNZ0fYTpGJ22, state sending, already a user input
SIGKILL exact CLI PID, then SIGTERM exact transport PID
retry about two seconds later: msg_1573cf4d8001wSqKGDvUd6LG8I, exit 0
CRASH SAME TEXT: two user inputs, old sending entry remains
```

**Normal path and round 1 cases (a)–(g):**

| Case | Independent worktree CLI result |
| --- | --- |
| (a) admission | Exit 0, `Message admitted to r2-main (input msg_1573a7c3e001Q3rlzdMQ8sbxDw, delivery queue)`; exactly one user `A admitted once`; no pending key after success. |
| (b) stopped stand-in | Exact PID 1394917 stopped; exit 0, admission `msg_1573a8fef001DR2Co3Le4ZTo0N`; replacement PID 1395261; record spawning with `restoredAt=2026-10-20T02:53:34.900Z`; stored OpenCode ID retained. |
| (c) removed session | Corrected run exits 1 with `session.prompt answered 404 SessionNotFoundError ... stored session ID ... stale; nothing was sent`; pane unchanged, pending empty. |
| (d) size | 131000-byte ASCII text (JSON 131068) admitted. 131003 text / JSON 131071 admitted; one extra byte / JSON 131072 refused. 204800 text / JSON 204868 refused. Quotes, backslash, newline, NUL, é and emoji plus padding at exactly 131071 JSON bytes admitted whole. |
| (d) size on dead TUI | Exit 1 in 0.77 s for 204868-byte body. Record and pane byte-identical before/after; no new restoredAt or runtime. The existing restoredAt from (b) was unchanged. |
| (e) Claude-style stub | Exit 0, `Message sent and processing`; pane `E stub paste` then `got: E stub paste`. |
| (f) other-session TUI | Corrected run exits 1 in 12.46 s: 10 s no-TUI error plus failed restore `session is not in a terminal state`; pane unchanged and no message sent. |
| (g) concurrent equal text | Two separate CLI processes both exit 0 with different IDs; total `G equal text` inputs = 2. |

Pane capture before/after (a) was byte-identical, containing only the shell launch and `R2 STAND-IN pid=1394917 --session ses_ea8c661f4ffe1kW7KLMCWYVNmj`. No message text was pasted. After restore the pane likewise contained only its restore launch and the replacement stand-in line. The removed and wrong-session cases preserved their captures. The Claude stub visibly received the paste.

Fixture corrections are explicit: the first normal harness remembered the pre-restore stand-in PID, so subsequent wrong-TUI/removed tests initially targeted buffered commands instead of the requested process. I corrected it to flush only the scratch TTY, enumerate/stop its exact stand-in PID and verify argv contains the requested session. Both affected cases were rerun successfully; those initial results are not used as code findings. The first ENOENT run also selected the gate tmux shim instead of the live shim; its corrected run kept the live private server while hiding only opencode.

**Spawn errors:** the corrected ENOENT CLI result is `... session.prompt failed: spawn opencode ENOENT; nothing was sent`, exit 1, no pending entry, record unchanged. A 2007138-byte constructed environment and 120000-byte message file gave `... session.prompt failed: spawn E2BIG; nothing was sent`, exit 1, pending empty. Both failures occur before the prompt child can execute; source and real-child tests confirm no recovery read is taken. Synchronous spawn exceptions represent pre-exec failure; asynchronous errors with no child PID also cannot have reached the service. Errors after a child with a PID, timeouts, signals, EPIPE and other unknown I/O failures remain uncertain. EACCES/EAGAIN/EMFILE/ENFILE are covered by that no-PID rule rather than by a blanket errno allowlist.

## ID order, read-back and compatibility

The installed binary at byte offset 133194968 independently contains:

```text
var F=26,I="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",m=0,d=0;
function Hf(){return gZ(!1)}
function gZ(e,n=Date.now()){if(n!==m)m=n,d=0;d++;
let r=BigInt(n)*0x1000n+BigInt(d),a=e?~r:r,
c=Array.from({length:6},(l,D)=>Number(a>>BigInt(40-8*D)&0xffn)
.toString(16).padStart(2,"0")).join(""),
s=crypto.getRandomValues(new Uint8Array(F-12));
return c+Array.from(s,(l)=>I[l%62]).join("")}
```

The core copy uses the same ascending prefix/counter and alphabet with 14 random bytes mapped modulo 62. It resets the counter on a changed millisecond, including a backwards clock, as the binary does. Cross-process IDs minted in the same ms are not globally ordered by actual admission; random suffixes make collision negligible. No fork reader depends on that stronger order.

Independent isolated order test:

```text
server first: msg_1573ef1d10012WVTjtw3D8r4oc
minted next:  msg_1573ef310001Qy8UW3lIbFyEYl
server third: msg_1573ef3c8001DpUm944aroR5J3
first < minted < third: true
```

I admitted the minted ID **after** the third input. `session.message.list(type=user,order=desc)` returned minted-late (created 1792465106339), third (1792465105881), first (1792465105382). `getNewestOpenCodeUserMessage` correctly returned the minted-late ID and its creation time. The fork's I-2 baseline checks compare identity/time, I-4 failed-run checks use creation time, and lifecycle consumes those detections; none sorts these message IDs to infer newest. Reusing an older ID does not break those readers on the tested 2.0.32 service.

Read-back checks exact input/session in the inbox, then exact ID and user type from the session-scoped message endpoint. `404 MessageNotFoundError` returns null; session/location 404, other HTTP failures, timeout and cut JSON throw. A complete message of another type or mismatching/malformed data returns null. An ID of an actual idle record independently produced `409 ConflictError`; the prompt helper failed once with no admission, and the plugin classifies that as definite and clears the pending entry. There is no text-based fallback or tmux paste after API failure.

Compared with the landed base `592441d6`, core index only adds exports. The two changed prompt/read-back signatures and removed slack export were introduced in unlanded round 1; no landed export was removed or changed. `SessionManager.send` remains `Promise<void>`; `deliver`, checkMessage, attempt and delivery fields are optional additions. The old runtime send/CLI body is preserved for agents without the hooks and OpenCode records without a valid stored ID; real-plugin integration tests verify the other agents have no new hook/checkMessage. Core does compute a text hash even for the runtime path, but its delivery behavior is unchanged.

`checkMessage` runs from the raw record before prepareSession for eligible agents; every core caller (CLI, lifecycle, review-check) therefore gets the early byte check. The plugin repeats size validation with the actual ID. The placeholder and generated ID have the same fixed length (body overhead 68 bytes). The new CLI replay line correctly accompanies a service answer whose creation predates the current call; ordinary admission prints no replay line. Failures exit 1, with definite `nothing was sent` versus uncertain admission text. Same-millisecond replay timestamps can omit the informational replay marker; delivery identity itself is unaffected.

## Bounds and lifecycle behavior

The TUI lookup now races its remaining deadline; an age wait that cannot finish by the deadline fails rather than waiting past it. The dropped lookup can continue to its own bounded command timeout, so this bounds the awaited check rather than cancelling all underlying work. Proc-age file reads themselves are not raced. The three-second age remains the expressly out-of-scope heuristic.

The documented 80 s is a sum of selected waits, not a hard end-to-end wall-clock bound. Preparation/get enrichment and runtime/agent checks add their own I/O; file-backed API children have a further 2 s SIGKILL grace if SIGTERM does not end them. Restore time and the final poll round are already excluded by the spec. Treat 80 s plus restore as nominal selected waits, with these additional costs, rather than a strict SLA.

For N sessions, lifecycle `pollAll` awaits `Promise.allSettled(sessionsToCheck.map(checkSession))`: waits across sessions overlap. A poll is held by the slowest check/dispatch chain, not necessarily N×80 s. Shared event-loop/host contention can lengthen it; the polling reentrancy guard skips subsequent scheduled polls until completion. An oversized message now fails before restore on every eligible poll. CI/conflict dispatch hashes still commit only on successful send, which makes the ledger recovery gaps material. `review-check` still prints a failed-send line and continues; neither caller file was changed.

## Gates, mutants and scope

All required checks ran in this reviewer worktree under `env -i`, fake initially empty gate HOME, no AO variables, private tmux and gh stub. Test TMPDIR was also under the scratch root. opencode was hidden from the integration PATH.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0; lockfile unchanged |
| `pnpm build` | exit 0 |
| core test filter | 37 files, 1042 passed |
| OpenCode test filter | 2 files, 294 passed |
| CLI test filter | 19 files, 256 passed |
| integration filter | 10 files passed / 3 skipped; 90 tests passed / 24 skipped |
| `pnpm lint` | exit 0; zero errors, five existing warnings |
| `pnpm typecheck` | exit 0 |
| full `pnpm test` | exit 0, **2491 passed / 29 skipped** in 13 packages |

Other full-suite passed counts: Claude 208, Codex 215, Gemini 62, desktop 26, Herdr 36, tmux 30, SCM GitHub 140 (+5 skipped), tracker 42, worktree 50. Integration accounts for the other 24 skipped. Lint warnings remain in spawn.ts, activity-log.ts, plugin-registry.ts and unchanged session-manager lines.

Mutants used a separate `git archive 56f8461c` copy, installed and built independently, with each source change restored before the next. The initial offline scratch install lacked tarballs because the worktree reused existing node_modules; I completed a normal frozen install before any valid mutant run. Baseline send-agent tests: 29/29 passed.

| New reviewer mutant | Result and failing behavior tests |
| --- | --- |
| Reuse ignores text hash | 1/29 fails: different text gets a new ID and leaves the unknown entry. |
| Reuse ignores age bound | 1/29 fails: nine-minute entry reused, eleven-minute entry replaced/removed. |
| Replay mark never set | 1/220 fails: service-created-before-call replay is marked. |
| Core skips checkMessage | 1/29 fails: oversized message on dead session must fail before runtime/restore/hook checks. |
| Timeout classified definite | 4/220 fail: timeout found/not-found recovery, found user queue mode, failed read-back unknown outcome. |
| Pending write deferred until after prompt invocation | 9/29 fail: persist-before-prompt, unknown retry, late retry, real lifecycle retry, active-record restore, concurrent sends/claim, age reuse and unknown settlement. |
| Extra: EPIPE classified definite | **Survives: 220/220 pass.** The current implementation correctly leaves it unknown, but this failure class is not protected by the suite. |

The six required mutants all cause meaningful behavioral failures. The added tests exercise durable IDs, entry state at prompt time, actual caller logic, preserved fields, concurrency in one process, size-before-restore effects and real stub-child errors. They are stronger than literal-only tests, but same-process mocks cannot establish cross-process safety. One test explicitly enshrines never reusing a stopped-process sending entry; it checks the chosen rule while missing its duplicate consequence. No tests cover failed unknown persistence, competing file writers or archive reconstruction. Thus the passing suite does not resolve the confirmed new findings.

The six round 2 commits modify only twelve files from the permitted list; all have conventional messages with WHY-bearing bodies, no Co-Authored-By, issue number or emoji. Over the whole `592441d6..56f8461c`, lifecycle-manager.ts and review-check.ts are unchanged. `git branch -r --contains 56f8461c` is empty. No reviewer implementation source changed.

Correct aspects: ID-based recovery fixes false acknowledgement and newest-message hiding; ordinary unknown retries and both late-completion orders are idempotent; early size preflight avoids pointless restores; spawn classification distinguishes definitely unstarted children; restore prose matches implementation; normal concurrent equal sends remain separate; API compatibility and source scope are preserved.

The numbered findings do not rely on OpenCode 2.0.29 model-turn facts, the three-second TUI heuristic, split panes, a TUI exiting while an input queues, or the first-poll killed race. No model-turn/environment remeasurement was made.

The earlier-equal-input check was also repeated with a mature stand-in and the direct real plugin, matching the round 1 timing: old queued ID `msg_15740ed75001f9aOXOGQQLZQ9c` was only **18 ms old** at the new hook call. The injected no-admission answer failed with `AgentDeliveryError`, `admission:unknown`, for new ID `msg_15740ee6e001RgzHSoGBz3C0ri`; it did not acknowledge the old input. This confirms M-1 within the old one-second slack window.

The late-before retry's actual CLI lines were:

```text
Message admitted to r2-late-before (input msg_1573c4674001MurUx3SJeOEr3z, delivery queue)
An earlier attempt of this send already admitted input msg_1573c4674001MurUx3SJeOEr3z; nothing new was admitted.
```

## Final safety and cleanup evidence

All fourteen isolated sessions had cost 0 and tokens `{input:0,output:0,reasoning:0,cache:{read:0,write:0}}`. Final surviving records:

| OpenCode ID | Title | Cost | Token fields |
| --- | --- | --- | --- |
| ses_ea8c65ec6ffeyxP69TGGOFsItp | REVIEW R2 earlier | 0 | all 0 |
| ses_ea8c65bb1ffeeqKIgbvzuKk9Y0 | REVIEW R2 order | 0 | all 0 |
| ses_ea8c65aa3ffeiOglUbEvDI3kmh | REVIEW R2 archive | 0 | all 0 |
| ses_ea8c65b38ffe8POsHaU4R8ryv3 | REVIEW R2 corrupt | 0 | all 0 |
| ses_ea8c65e39ffesxRh1C81iFyjhU | REVIEW R2 ci | 0 | all 0 |
| ses_ea8c65c47ffeQkwRh1RUqmt5h9 | REVIEW R2 race | 0 | all 0 |
| ses_ea8c65ce9ffeBtZypBr13QrkmC | REVIEW R2 writefail | 0 | all 0 |
| ses_ea8c65da0ffeUqhfivHZVoUR6j | REVIEW R2 crash | 0 | all 0 |
| ses_ea8c65f57ffelAR78e2nTDVLNq | REVIEW R2 late-after | 0 | all 0 |
| ses_ea8c65ff4ffeVpb3DgN6uty6Py | REVIEW R2 late-before | 0 | all 0 |
| ses_ea8c661f4ffe1kW7KLMCWYVNmj | REVIEW R2 main | 0 | all 0 |
| ses_ea8c660b4ffenNBLnjdewa3M7b | REVIEW R2 other | 0 | all 0 |
| ses_ea8c66146ffexhw6mM9odh4bwx | removed, zero read before deletion | 0 | all 0 |
| ses_ea8c4082effeNwpT3ioEMHd1z1 | removed2, zero read before deletion | 0 | all 0 |

Final `model.list` was again `{"location":{"directory":"/tmp/i5r2-ao42-20261019/home"},"data":[]}`. The service was stopped after that read; no API call was made after shutdown. No real TUI, provider turn or real-session send occurred.

Live stand-ins stopped during cases by exact PID: 1394917, 1395261, 1398151, 1399770, 1405773, 1406162, 1406376, 1407980, 1408437, 1410246, 1411991, 1412406, 1419352, 1419914, 1420243, 1422032, 1427650, 1430387. Normal restore and archive restore additionally destroyed their old private runtimes through the tested runtime code. The SIGKILL reproducer stopped exact CLI PID 1410302 and exact held transport PID 1411736. The competing writer PID 1412415 exited 0 and was reaped. No scratch detached lifecycle worker was spawned in round 2.

Final cleanup log:

```text
STOP exact stand-in PID 1399489
STOP exact shell PID 1394903
STOP exact shell PID 1422017
Private server PID 1394893 already exited with last pane
STOP exact isolated service PID 1370073
CLEANUP PROCESS STOP COMPLETE
```

`ps -o pid,args -u "$(id -u)"`, filtered by the scratch paths/private-server names/worktree CLI: **empty list `[]`**. Both own socket names were removed. Protected service 15920 and workers 19579, 19624, 19636, 19653, 19689 still ran at the final check.

`ls -la --time-style=full-iso ~/.ao/bin` before and after is byte-identical (`cmp` exit 0), and SHA-256 hashes of every file also match:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The lock directory `/tmp/ao-opencode-launch-44402` is empty at start and finish (`.` and `..` only, mtime Oct 16 14:01).

The required scan:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/i5r2-ao42-20261019-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'
```

printed:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-41
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.log
```

These three external entries are the real lifecycle worker updating **ao-41 working→stuck at 2026-10-19 22:55:37 EDT**, not reviewer writes. The log records correlation `lifecycle-transition-2efbdce3-bee9-4807-be2a-8d8b660ced31`; the sessions-directory and record mtimes coincide (22:55:37.489410410), log .492410337. Atomic metadata replacement explains the directory mtime. Every reviewer executable ran with fake HOME/state.

The scratch tree, fake homes, isolated XDG store/config/cache, test-state directories (all tests set scratch TMPDIR), builds, fault fixtures and logs are removed after this evidence is copied; the marker is then removed. Only the requested review and report-back are reviewer deliverables. No implementation change, commit, push, PR, real gh call, credential-file read, real-state write, or default-server tmux call was made.
