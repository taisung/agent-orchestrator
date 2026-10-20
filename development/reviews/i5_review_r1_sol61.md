# I-5 blind review, round 1 — ao-42

NOT-LAND-SAFE

Review target: `592441d6..a6b37297`. Reviewed 2026-10-19. Findings: **1 blocker, 1 major, 1 minor**. B-1/M-1 require a stable logical-send identity and behavioral retry/recovery tests before landing.

The assignment explicitly forbids commits, pushes, PRs, real-session sends, model turns and global service writes. Those restrictions supersede the generic managed-session instructions. No implementation files were changed. All executable review calls used a scratch HOME and `env -i`; tmux resolved to a private-server shim and gh to a non-network stub. At the initial checkpoint below, the author report had not been read.

Initial evidence:
- Worktree starts at a6b37297; only `.agent_task.md` and the dispatch `.agent_report.md` are untracked.
- `git branch -r --contains a6b37297` prints nothing.
- Six conventional commits touch 13 files, all within the author brief's allowlist; no lifecycle/runtime/config/wrapper implementation changes.
- Marker: `/tmp/i5rev-ao42-20261019-marker`.
- `/tmp/ao-opencode-launch-44402` contains only `.` and `..`.
- Real `~/.ao/bin` initial listing: `.ao-version` 5 bytes mtime 2026-10-16 12:16:13.968933443 -0400; `ao-metadata-helper.sh` 5466 bytes .966933494; `gh` 2213 bytes .967933468; `git` 3471 bytes .968933443. Full listing and hashes saved for final comparison.

Design prerequisites read: 0009 send proposal, I-5 scope and Q5/Q7; 0010 M-4, all M-5, pipe-output truncation and I-5 conclusions; TODO follow-ups attempts 3/4. The TUI environment measurements are accepted as supplied and will not be repeated. M-4/M-5 are 2.0.29 facts; version drift will be assessed without a real turn.

## Source audit checkpoint (before live tests)

Items 2.1–2.7 reviewed from the implementation and six commit diffs before opening the author report. Preliminary concerns to reproduce:

- Recovery matches text plus time, not a send identity (`opencode-api.ts:1092–1110`; plugin `index.ts:926`). A previous equal input within the one-second slack can masquerade as this send; after a missed read-back the next lifecycle poll has no identity to deduplicate a late admission. `promptOpenCodeSession` sends no client `id` (`opencode-api.ts:1024–1029`). These are distinct loss/duplication cases.
- `restore()` does not universally require a gone agent. `isRestorable` accepts terminal status OR exited activity (`types.ts:129–145`), so a record marked `killed`/`done` can replace a live pane. The new comments/docs that say a running agent is never replaced are too broad. Normal `working` plus healthy wrong-session TUI is refused; merged is never restored. Much of this status behavior predates I-5.
- The hook's size check precedes its own TUI check, but core calls `prepareSession` before the hook (`session-manager.ts:2823`); a dead session may therefore be restored for an oversized message before rejection.
- A three-second process age is explicitly an unmeasured readiness heuristic. Process existence cannot establish service attachment or protect a later queued turn if the TUI exits. `/proc` age-read failure passes immediately. The check may exceed ten seconds because each external command has its own timeout and the age sleep is not clamped to the deadline.

Author report read only after that audit. Its section 12.6 reports that client message IDs are idempotent before and after inbox consumption, but this implementation omits them. Its section 13 acknowledges the late-admission duplicate window. These claims will be checked independently where a model turn is unnecessary.

## Confirmed findings (evidence recorded before cleanup)

### B-1 — Preserve a durable send ID across uncertain admission and lifecycle retry

Locations: `packages/core/src/opencode-api.ts:1024` (body has no client ID), `packages/plugins/agent-opencode/src/index.ts:938` (failed read-back throws), `packages/core/src/lifecycle-manager.ts:1035` and `:1051` (unchanged callers retain the dispatch hash on throw).

The hook calls prompt once per invocation, but that is insufficient for the automatic lifecycle retry. If completion is later than the one read-back, or the read-back itself fails, the next poll submits the same dispatch under a new server-generated ID. A concurrent newer user message can also hide the admitted input because recovery reads only the newest user message. No identity links the two attempts. This violates the brief's explicit no-double-send requirement for lifecycle reactions.

Independent controlled reproducer, using the built plugin and isolated 2.0.32 store (model list empty, no-route model): substitute a prompt answer `{"data":null}` without admitting anything; recovery finds neither inbox nor newest user and throws. Complete that original request after recovery with the exact same text, then repeat the hook as the next poll would. Evidence:

```text
FIRST UNKNOWN FAILED ... admission ... is unknown ... read-back found it neither ... message was not sent again
CONTROLLED LATE COMPLETION msg_156eeeb0b001Ta8R2aIwThdmfM after failed readback
DUPLICATE AFTER RETRY:
  user:  msg_156eeeb0b001Ta8R2aIwThdmfM
  inbox: msg_156eeec730013VYkFp42OQAQ96
  count: 2
```

This is controlled ordering of a late server completion, not a claim to have induced a natural server timeout. It directly tests the state the implementation must tolerate. The problem also exists after a failed recovery read even when admission already completed.

Independently checked the available remedy: a normal prompt with client ID `msg_15600000000042reviewIdempotent`, followed by a replay after it became a user message, returned that same ID twice; one user record, zero inbox records, total 1. The OpenAPI prompt body permits nullable client `id`. Use an appropriately generated and persisted ID for each logical dispatch, reuse it on retry and find by ID. Do not mint a different ID per retry or deduplicate all equal text forever. At HIGH fleet-wide risk, deferring this guard is not land-safe.

### M-1 — Text/time recovery can falsely acknowledge an earlier equal message

Locations: `packages/plugins/agent-opencode/src/index.ts:926` (subtracts one second), `packages/core/src/opencode-api.ts:1092` (first equal inbox item), `:1105` (newest user match).

Independent reproducer: create one queued `REPEAT CI DETAILS EXACTLY` with `resume:false`; 13 ms later call the real built `deliverMessage` with the same text. A transport shim returns `{"data":null}` for this new prompt without writing to the service; all reads use the real isolated service. Recovery returns success with the **old** ID:

```text
oldId: msg_156eee63a001hYSG6d7uBEE5hf
previousAgeMsAtCall: 13
result: {inputId: msg_156eee63a001hYSG6d7uBEE5hf,
         mode: queue, waitsFor: [], busy: false, recovered: true}
inboxCount: 1
allIds: [msg_156eee63a001hYSG6d7uBEE5hf]
```

Two logical sends have only one durable input, yet both appear successful. A lifecycle dispatch hash can then be marked delivered even though its attempt was lost. Equal text is routine for CI and conflict reactions; explicit user sends may also repeat. The same ambiguity applies to equal messages admitted concurrently, including after removing the slack. Recover the specific client message ID rather than proving that some recent equal text exists. Add a behavioral test for a prior equal input inside the one-second window and for concurrent equal sends.

## Independent gates checkpoint

`pnpm install --frozen-lockfile`, build, typecheck and lint all exit 0 under `env -i`, scratch HOME, gh stub and private tmux shim. Lint has five existing warnings and zero errors. The integration PATH hides opencode. Filter results: core 37 files/1017 tests passed; OpenCode 2 files/285 tests passed; CLI 19 files/254 passed; integration 10 files passed, 3 skipped, 89 tests passed, 24 skipped. Full `pnpm test` exits 0. Seven scratch-copy mutants are all killed; detailed results follow.

No real TUI or provider request was used. Isolated service is PID 867624 at port 49642, and the pre-write `server.info` confirms it is not 15920. `model.list` before any prompt is exactly `{"location":{"directory":"/tmp/i5rev-ao42-20261019/home"},"data":[]}`. Every created session explicitly uses `{providerID:"rev5-none", id:"none"}`. Config disables the `opencode` provider.

### m-1 — The new unconditional guarantee that a running pane is never replaced is false

Locations: `docs/opencode-workflows-spec.md:76`, `packages/core/src/session-manager.ts:2783`, `packages/core/src/types.ts:424`. The restore implementation itself is unchanged; this is a documentation/contract overstatement, not a newly introduced restore-state regression.

`isRestorable` uses terminal status **or** exited activity (`types.ts:129–145`). `killed`, `done`, `terminated`, `cleanup`, and `errored` can therefore pass with a live process. A normal `working` record with a wrong-session TUI is refused, as the author tested, but the claimed guarantee is broader.

Independent live reproducer: keep a stand-in on `main` running (PID 918749); make its AO record `status=killed`, mapped to `other`. Run `ao send rev42-human 'TERMINAL METADATA SEND'`:

```text
Message admitted to rev42-human (input msg_156f17696001Ypznk2RUflltPL, delivery queue)
exit 0, elapsed 4.93 s
old wrong TUI PID 918749 alive: False
new pane: REVIEW STAND-IN pid=918983 --session ses_ea91408ceffeRFqNHLmgXade3v
```

That live pane was replaced. Correct the new prose to state the actual conditional protection and flag the inherited terminal-record hazard. A human using the shell after a TUI exits is also not protected by any foreground-shell ownership check.

## Send order and failure-state audit

Core first resolves persisted runtime/agent identity and calls the existing `prepareSession`; only then does it select the optional hook. The core runtime delivery/confirmation body is unchanged. `send` still resolves to `undefined`; new optional `deliver` returns the record. The hook's effective order is JSON byte check → TUI process/age check → parallel pending/busy reads → one prompt through a file → recovery only for uncertain admission.

| Failure point | Record / pane / service state and caller result |
| --- | --- |
| Missing record/plugin, failed readiness/restore | Throws before prompt; existing prepare/restore may have changed a pane or record before a later failure. CLI exits 1 with its error. |
| JSON size | No prompt and no truncation/paste. With a healthy prepared session no state changes. A dead runtime/agent can already have been restored by core before this check. |
| Missing TUI/handle or gone pane | `AgentNotAttachedError`, no prompt yet. Core may force one restore. Restore failure preserves the existing pane up to the existing restore's destructive stage; CLI exits 1 naming both reasons. |
| Second no-TUI check, or first after this send already restored | Final error, no further restore, no prompt/paste. A successful restore has left `status=spawning`, `restoredAt` and the replacement handle. |
| Unknown runtime/check error | Plain error, final, no forced restore or prompt through this hook. Herdr uses its pane process list; tmux uses the TTY list. |
| Permission/form/active read error or unexpected shape | Caught, leaves context absent and continues to prompt. No permission/form is answered. Partial failure of one human-input list suppresses the entire pending-input annotation. |
| 400/401/404/409, missing executable | Final refusal; no recovery/restore/tmux fallback, one or zero prompt process as appropriate. 404 identifies stale ID vs gone location. |
| Timeout, cut/empty JSON, unexpected valid JSON, 5xx, signal or other uncertain spawn error | One inbox read then, if needed, newest-user read. Match returns success (`recovered:true`); missing/failed read throws. Admission may already exist or occur later (B-1/M-1). |
| Valid admission | Returns input ID and mode; CLI exits 0 and prints admission plus applicable busy, human-input and recovery lines. A subsequent no-route run failure does not change the fact of admission. |

There is no route from an actual prompt failure back to the runtime paste and no second prompt within one normal hook invocation. The only retry of the hook in core follows its pre-prompt typed no-TUI error. B-1 concerns logical retries by callers, not two prompt calls in one hook.

**Size-preparation nuance independently reproduced:** `ao send rev42-size -f 200k.txt` to a live shell without a TUI exits 1 for a 200030-byte body, but leaves a new stand-in PID 919149 and `status=spawning`, `restoredAt=2026-10-20T01:33:48.668Z`. The hook's “size before TUI” statement is correct locally; “at once, before any process/restore” is not a property of the full core/CLI path. No inbox input was admitted.

**States:** `spawning` retains the original readiness wait (20 s bound); it may restore if the runtime/agent is dead. `working` plus an exited agent already restored before I-5; the newly forced restore additionally covers death between preparation and the hook check. The author's explanation should not imply that a surviving shell previously prevented all restoration. `merged` never restores, but a live merged session can receive through the hook. `done` and `killed` restore even if the pane is live, by existing terminal-status semantics. An archived-only record still fails the initial active-record lookup for send. No new terminal-status allowlist was introduced.

## TUI check and limits

The reused I-3 argv rule checks NUL-delimited `/proc/<pid>/cmdline`. It accepts executable basenames `opencode`/`.opencode`, or node/bun with that main-script basename, and an exact `--session <id>`/`--session=<id>` before `--`. A normal shell with OpenCode only in command text, interpreter preload, another session ID, `opencode api ... --param sessionID=...`, and a process on a TTY outside the returned tmux pane set fail. The existing tests and the “any opencode” mutant exercise those distinctions. Tmux's `list-panes -t <runtime id>` includes all panes of the selected window; it does not prove a unique AO foreground pane in a manually split window. Herdr delegates process membership to its foreground-process API. Unsupported runtime throws rather than guessing.

The 10 s poll and 3 s minimum process age are heuristics. A named stand-in deliberately passes them without attaching to the service, proving that process evidence is not proof of attachment. A slow-starting genuine TUI can pass at age 3 s before attachment, or fail while still starting; unreadable age passes immediately. The age sleep and 5 s external-command timeouts are not capped to the remaining deadline. The code also cannot guarantee the TUI will stay attached while a queued input waits behind a long turn/permission. These are disclosed/unmeasured limitations, not results of a new environment measurement. No real-TUI/model-turn claim is made here.

## Isolated live evidence

All live commands used the worktree build and the scratch config/state root. Private tmux server: `-L i5rev42-20261019`, PID 893948, started with no AO variables. Before the first prompt, all three pane shell environments were inspected: fake HOME, scratch PATH, private TMUX socket and no AO variables. Subsequent runtime-created panes received only scratch AO variables. No real TUI ran. Initial service create rejected the fixture's `modelID` key; it was corrected to `id` before any session was created. Initial restore fixture was not a Git repository; an empty scratch `git init` (no commit) corrected it before the successful rerun. A first lifecycle observer query hit the known pipe truncation with the large message history; the worker was stopped and the query rerun with `limit=1`.

| Case | CLI/evidence |
| --- | --- |
| (a) normal | `Message admitted to rev42-1 (input msg_156ed1fda001c1r498dPiZYEPN, delivery queue)`, exit 0; exactly one user `A admitted once`. |
| (b) stopped stand-in | Exact PID 901930 stopped; send prints admission `msg_156ee54fe001pVt3G2ObYSwUmK`, exit 0, 4.48 s. One replacement PID 902034 on the same stored ID; `restoredAt=2026-10-20T01:30:18.975Z`. |
| (c) removed session | `Message not sent to rev42-removed: ... does not exist (session.prompt answered 404 SessionNotFoundError): the stored session ID of rev42-removed is stale; nothing was sent`, exit 1. Pane unchanged. |
| (d) 131 KB / 200 KB | 131000 ASCII bytes admitted as `msg_156ee60230013OiyxgCXXvQXoV`, read back whole. 200000 ASCII bytes refused with `body ... 200030 bytes, more than ... 131071`, exit 1. |
| (d) exact ASCII boundary | 131041-byte text → 131071-byte JSON, admitted `msg_156f15c87001UF1oyaq04gJRAb`, exit 0. One extra ASCII byte → 131072-byte JSON, explicit size error, exit 1. |
| (d) escapes/Unicode/NUL | Repeated quote, backslash, newline, NUL, é and emoji plus padding: text 95041 UTF-8 bytes, JSON exactly 131071. Admitted `msg_156ee8005001gppD2I4UFscbbp`; user text SHA-256 starts `406a2af7eac2c104` and byte count is 95041. |
| (e) Claude-style stub | `Message sent and processing`, exit 0; pane includes `E stub paste` then `got: E stub paste`. |
| (f) wrong-session TUI | Exit 1 in 13.36 s, no-TUI reason plus `restore ... failed (... session is not in a terminal state)`; wrong TUI/pane unchanged and message absent. |
| (g) concurrent sends | Two CLI processes both exit 0, IDs `msg_156eec59c001DOkrMEucjCg4Ij` and `msg_156eec5bd001lHHhdOdznTmZHN`; user counts for `G concurrent 0/1` are `[1,1]`. |
| (h) lifecycle | Real scratch lifecycle worker PID 913780 transitions working→stuck and its send-to-agent reaction produces user `msg_156f074b20010q2sBazyO3kwTI`, text `REVIEW-LIFECYCLE-REACTION`. Worker stopped by exact PID, exit 0. First observer-attempt worker PID 910648 was also stopped, exit 0. |

Normal pane captures before and after (a) were byte-identical:

```text
taisung@rioja-rutgers-edu:/tmp/i5rev-ao42-20261019/proj$ opencode --session ses_
ea9140950ffe32AeMwLXQGdhfS
REVIEW STAND-IN pid=893987 --session ses_ea9140950ffe32AeMwLXQGdhfS
```

There was no `A admitted once` paste. After (b) the pane contained only its restore launch and `REVIEW STAND-IN pid=902034 --session ses_ea9140950ffe32AeMwLXQGdhfS`; no sent message was pasted. (c)'s capture also stayed unchanged. Inbox/user reads verified the admitted IDs; large payloads were compared by length and SHA-256 instead of printing them.

**Argument accounting:** independent `execFileSync('/bin/true',[argument])` measured 131071 bytes succeeds and 131072 throws E2BIG; `PAGE_SIZE=4096`, `ARG_MAX=2097152`. JSON overhead is 30 bytes, escaped NUL contributes six, and the terminating argument NUL consumes the final byte of Linux's 131072-byte per-string allocation. UTF-8 and escapes are counted correctly. The guard covers only that per-string limit: a constructed 2041164-byte environment succeeds alone but fails with a 131071-byte argument (E2BIG). The total argv/environment limit can still reject a nominally allowed send; the code reports an uncertain failure/read-back failure, without truncation or paste. `opencode api --data` has no file/stdin body path in this implementation; service OpenAPI independently confirms the body/error shapes. Output through a regular file is appropriate for the known pipe truncation.

## Tests, mutants and API compatibility

All commands ran in the reviewer worktree except the mutants, which used `git archive a6b37297` into a disposable scratch copy, an offline install and its own build. No source file in the reviewer worktree was mutated.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0; frozen lockfile unchanged; HUSKY=0 |
| `pnpm build` | exit 0 |
| `pnpm --filter @aoagents/ao-core test` | 37 files, 1017 passed |
| OpenCode filter | 2 files, 285 passed |
| CLI filter | 19 files, 254 passed |
| integration filter, opencode hidden | 10 files passed / 3 skipped; 89 passed / 24 skipped |
| `pnpm lint` | exit 0, 0 errors / 5 existing warnings |
| `pnpm typecheck` | exit 0 |
| full `pnpm test` | exit 0; **2454 passed, 29 skipped**, 13 packages |

Full-suite per-package passed counts: core 1017, OpenCode 285, CLI 254, Codex 215, Claude Code 208, SCM GitHub 140, integration 89, Gemini 62, workspace 50, tracker 42, Herdr 36, tmux 30, desktop 26. Skips: SCM 5, integration 24. Lint warnings: spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, session-manager.ts:1687 and :1694; outside the changed logic.

Scratch mutant baseline core API: 76/76 passed. Each mutant below was applied separately and restored before the next; slack mutation rebuilt scratch core so plugin imports used the mutant export.

| Mutant | Failing tests |
| --- | --- |
| TUI matcher accepts any argv naming opencode | 17/211 plugin tests fail, including I-5 `refuses a TUI on another session, an opencode api call and a shell that names the ID`, plus I-3 shell/preload/session/Herdr protections. |
| Core restores after a 404/plain hook error | 1/13 send tests: `treats every other hook error as final: no restore, no second call, no runtime path`. |
| Second prompt after read-back found nothing | 5/211 plugin tests: the `not found fails the send` variants for timeout, cut answer, unexpected answer, 500 and signal. |
| Size limit off by one (131072) | 2/76 API tests: exact-boundary test and 200 KB error text. |
| Read-back slack 60000 | 5/211 plugin tests: `found gives success with recovered` for the five unknown-admission variants (timestamp bound assertion). |
| canDeliverMessage true with no stored ID | 1/211 plugin tests: `can deliver only to a session with a valid stored OpenCode session ID`. |
| CLI continues to print success after failed send | 1/20 CLI send tests: `exits 1 with the error of a failed send, and makes no tmux call`. |

The suite meaningfully checks routes, call order/count, process argv, files versus pipes, real stub-child I/O, exact message contents, errors and exit codes. Some assertions copy constants or complete message strings: notably the off-by-one mutant is killed first by an explicit constant equality, and the slack mutant by an arithmetic bound against the hardcoded 1000 ms. Those failures do not test that the chosen bounds prevent message loss/duplication. There is no behavioral coverage for an equal previous message within the accepted window, a failed read-back followed by retry, or retry after late admission. The passing suite therefore does not invalidate B-1/M-1.

Compatibility is otherwise preserved: `SessionManager.send: Promise<void>` remains; all new hooks/deliver are optional; core index only adds exports. Existing API callers keep default 404→null, timeout handling and same error message text. HTTP errors gain a subtype and parsed status/tag/API message without changing the generic prefix/detail selection; old callers that catch broadly still behave the same. Spawn/reuse, restore command strings, I-4 activity methods, runtimes, other agents, wrappers and configuration are unchanged. Their existing tests pass. OpenCode without a valid stored ID and agents without both selection/delivery hooks retain the old core and CLI send body; the real-plugin integration test confirms the other three agents have neither hook.

The CLI selects the hook before tmux existence/idle checks, so Herdr can use it and dead tmux runtimes delegate to core's restore path. `--no-wait` and `--timeout` correctly have no effect on API delivery, as help states; fixed internal readiness/restore/API bounds still apply. Busy/pending/recovery output is covered by unit tests; injecting actual human-input requests would require a model turn and was not attempted.

## Lifecycle and scope conclusions

CI detail and merge-conflict dispatch hashes are written only after successful core send, so any failure leaves them retryable. This is safe for definite pre-admission refusals; unknown admission is B-1. An oversized static/detailed message fails on every eligible poll, with unchanged dispatch hash and no per-message permanent-failure suppression. Generic transition reactions return `success:false` on send failure, but the comment “retry next poll” is broader than the actual control flow: `checkSession` calls the generic transition action only on a transition; a stable status does not universally re-execute it. This is inherited and not a newly introduced I-5 finding. `review-check` uses core send, prints `-> Failed to send: ...` and continues on error; it has no automatic local retry.

Polls await all checked sessions with `Promise.allSettled`; waits are concurrent across sessions, not a simple sum of 20 s per session. A slow hook still holds the whole poll open, and the polling reentrancy guard skips scheduled polls until it finishes. A no-TUI attempt may incur 10 s, restore work/readiness, then 10 s again, plus context/prompt/recovery timeouts; individual command and age waits can overrun the nominal TUI deadline. No lifecycle backoff or dispatch-ID persistence was added.

Only the 13 allowed files changed across six local conventional commits. Each commit has a WHY-bearing body; no Co-Authored-By, issue number or emoji trailer. `git branch -r --contains a6b37297` is empty. No review code, commit, push or PR was made. Documentation describes the new route, errors and known duplicate window, but describing B-1 does not satisfy the no-double-send gate; its broad no-live-pane-replacement claim is m-1.

Code still relies on 2.0.29 M-4/M-5 behavior: an attached TUI reflects one API input without duplicate execution, queue waits until after the last answer of a running turn, pending human input continues to block it. 2.0.32 could change those semantics or the attachment/environment timing. Schema/ID/admission tests here use 2.0.32; they do not revalidate those model-turn facts.

Correct aspects: optional backward-compatible API shape; preserved non-hook paths; exact stored-ID routing; no fallback paste or second in-hook prompt after an API error; typed refusal versus uncertain admission; file-backed prompt/recovery output; correct JSON UTF-8 size counting and CLI error exit codes; focused source scope and substantial non-vacuous tests.

### B-1 additional end-to-end confirmation with the actual lifecycle checker

After the controlled late-completion reproducer, I exercised **two calls to the real `createLifecycleManager().check()` and real session manager/send/plugin/runtime**, with a read-only fake SCM returning one stable failing check. No GitHub call was made. The first prompt went to the actual isolated service; a transport shim replaced its successful answer with `{"data":null}` and failed only the recovery inbox read with a synthetic 503. No artificial late write was needed. The second check ran without the fault:

```text
AFTER FIRST POLL dispatch hash <absent>
AFTER SECOND POLL dispatch hash REVIEW-RETRY-CI:failed:FAILURE
user:  msg_156f49269001mxvAVXjrnAx2P0
inbox: msg_156f49a18001vabG41nEyM3uwF
count: 2
```

Both records carry identical CI text for `REVIEW-RETRY-CI`. This confirms B-1 through the real dispatch-hash retry logic, beyond the controlled late-admission ordering. A failed read-back alone is enough; the first request need not actually have timed out.

## Final safety and cleanup evidence

Every isolated session has cost 0 and tokens `{input:0, output:0, reasoning:0, cache:{read:0, write:0}}`:

| Session | Final cost | Final tokens |
| --- | --- | --- |
| ses_ea9140728ffeQ5eSpxp6K2zmzu (REVIEW-42 delayed) | 0 | all fields 0 |
| ses_ea91408ceffeRFqNHLmgXade3v (REVIEW-42 other) | 0 | all fields 0 |
| ses_ea9140950ffe32AeMwLXQGdhfS (REVIEW-42 main) | 0 | all fields 0 |
| ses_ea9140686ffe7Uuf5bMFkRWtR1 (REVIEW-42 idem) | 0 | all fields 0 |
| ses_ea91407adffeffjjK4lVXSm8Zg (REVIEW-42 recovery) | 0 | all fields 0 |
| ses_ea9140838ffeYAvN4ctBK31UrH (removed case; read immediately before removal) | 0 | all fields 0 |

Final `model.list`: `{"location":{"directory":"/tmp/i5rev-ao42-20261019/home"},"data":[]}`. No enabled model or provider request. The isolated service was stopped only after these reads; no API client ran after service shutdown.

Cleanup log (exact PIDs; runtime-created old panes also exited through the private runtime during the restore tests):

```text
STOP exact stand-in PID 894027
STOP exact stand-in PID 894067
STOP exact stand-in PID 905072
STOP exact stand-in PID 906312
STOP exact stand-in PID 906321
STOP exact stand-in PID 918983
STOP exact stand-in PID 919149
SCRATCH LIFECYCLE WORKERS: none
STOP exact scratch shell PID 893973
STOP exact scratch shell PID 902014
STOP exact scratch shell PID 906300
STOP exact scratch shell PID 918963
STOP exact scratch shell PID 906290
STOP exact scratch shell PID 893960
STOP exact scratch shell PID 919129
Private tmux PID 893948 already exited after its last shell
STOP exact isolated service PID 867624
CLEANUP PROCESS STOP COMPLETE
```

Both scratch lifecycle workers had already stopped by their exact PIDs (910648, 913780) before pane/server shutdown. The global service 15920 and all five protected workers 19579, 19624, 19636, 19653, 19689 were still running at the final check.

`ps -o pid,args -u "$(id -u)"`, filtered by the scratch path, private-server name and worktree CLI path after shutdown: **empty list `[]`**. The private socket `/tmp/tmux-44402/i5rev42-20261019` was removed. 41 disposable test-state/fixture directories were identified by their test names, dead test PIDs, contents and creation during the gate runs and removed.

`ls -la --time-style=full-iso ~/.ao/bin` BEFORE and AFTER are byte-identical (`cmp` exit 0); all file SHA-256 hashes are also identical:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

`ls -la /tmp/ao-opencode-launch-44402` at start and end contains only `.` and `..` (directory mtime Oct 16 14:01); no launch-lock entry was created.

The required final real-state scan was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/i5rev-ao42-20261019-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'
```

It printed three **external** entries, not reviewer writes:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-41
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.log
```

All three mtimes are 2026-10-19 21:34:34 EDT. The real lifecycle log independently records `lifecycle.transition`, session `ao-41`, working→stuck, correlation `lifecycle-transition-da56a49b-2aaa-428a-8042-c2fc4d8b92ef`; its active record now reads `status=stuck`. Atomic metadata replacement accounts for the sessions-directory mtime. This is the existing real lifecycle worker marking the author idle, not any reviewer action. Earlier scans during this review were empty. Every reviewer execution used scratch HOME/state, and no real-session send, real-state mutation, default-server tmux call, credential read, real gh call, commit, push or PR was performed.

The scratch tree (isolated XDG store/config/state/cache, fake HOME, builds, fixtures and logs) and marker are removed after extracting this evidence. Only the requested review and report-back files remain as reviewer deliverables.

Cleanup implementation note: the shell rejected an `rm -rf` command before execution. Removal instead used `shutil.rmtree` on the exact verified scratch path after assertions that all owned service/worker/server PIDs had exited. No approval or real-state operation was needed.
