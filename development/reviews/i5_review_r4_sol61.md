# I-5 blind review, round 4 — ao-44

> Orchestrator note (2026-10-20): in this copy on `main`, the values of 42 JSON fields `"key"` and `"token"` (scratch OpenCode session IDs and random attempt tokens of the deleted isolated store) are replaced by `<scratch-id>`, because the gitleaks hook reads them as API keys. The full original is `~/.cache/agent-skills-haiku55-arc/reports/ao-44-i5-r4.review.md`.

LAND-SAFE

Target `592441d6..9987edfa` (round 4 `72e5e59f..9987edfa`), reviewed 2026-10-20. **0 blockers, 0 major, 1 minor (m-3).** This verdict applies to the specified Linux, single-user, same-network-namespace deployment and the documented 10 min retry identity contract. The residual triple-write-failure limit is real and accepted below; this is not a claim of unconditional exactly-once delivery.

## Findings

### m-3 — The fallback cleanup warning promises expiry removal even for a corrupt ledger that cleanup retains

**Minor, operator guidance.** `packages/core/src/session-manager.ts:2364–2368`; `packages/core/src/delivery-ledger.ts:609–616`.

After service deletion, if ledger removal and creation of the archived pending-key update both fail, the warning says: “`ao session cleanup` removes it when its entries are older than 10 min.” There is then no `opencodeLedgerPending` key to drive unconditional removal, and the expiry sweep deliberately keeps corrupt files. The file can remain permanently after the filesystem recovers.

Independent isolated reproducer: purge r4-warncorrupt while its ledger is invalid; inject EACCES only for removing that ledger and for creating the subsequent archive-update temp file. The archive has `opencodeCleanedAt` but no pending key, and the CLI prints the expiry promise. Restore normal writes and run cleanup: exit 0, file retained. Repeat with version 2 JSON holding one entry whose timestamps are twelve minutes old but whose SHA-256 field is invalid: file still retained. Full CLI/archive/file evidence is in the work log below. No OpenCode session is revived, no input is duplicated, and retaining the file is the correct fail-closed action.

Cause: **(c)** failed filesystem remove/write operations, with an already corrupt ledger.
Documented limit alternative: **acceptable for this personal tool**, because this is harmless orphaned state after service deletion; the warning should explicitly say corrupt ledgers require manual inspection/removal. A one-line warning correction is sufficient; weakening corrupt-file protection is not.

## Earlier findings

| Finding | Status | Independent evidence |
| --- | --- | --- |
| B-1 — durable identity after uncertain admission | **fixed within the documented retry contract** | Two real lifecycle checks: first admission plus failed answer/read-back leaves hash absent; second uses the same ID, one input, then writes hash. Both late-admission orders also admit once. |
| B-2 — interrupted sender or lost unknown write | **fixed within the documented retry contract** | SIGKILL both before and after service admission reuses the persisted ID. Before-admission retry admits one new input without a replay line. Failed unknown rename is covered by the cross-process B-3 run and same-process tests. |
| B-3 — live idle owner after failed unknown settlement | **fixed** | The first real core attempt returns failure and its process stays idle/alive with sending on disk. A separate CLI reuses the ID; one service input, owner still alive. |
| M-4 — permanent lock after interrupted cleanup | **fixed** | No lock file/breaker remains. Actual holder deaths before write and after write/before release, plus an actual CLI waiter killed at an EADDRINUSE barrier, free the name and allow subsequent sends. A live holder still gives definite refusal. |
| M-5 — failed clear makes an intended new send replay | **partly fixed; remaining documented limit accepted** | A failed clear leaves admitted on disk; separate CLI and actual lifecycle check each mint a new ID and admit new input. Three failed marks still have the distinct limit assessed next. |
| m-2 — failed ledger removal never retried | **fixed for its original defect** | Failed purge removal writes the archived pending key. Dry-run retains the file. Next cleanup removes it; failing the pending-key clear does not abort cleanup, and another cleanup clears the key. Expired-ledger sweep respects the ledger lock. m-3 is the narrower double-failure warning case. |
| M-2 / M-3 — record writer or archive restore loses retry identity | **fixed** | A real paused updateMetadata writer commits its old snapshot and EXTERNAL-HASH without changing the separate ledger. Real kill/archive/restore retains the ledger and retries one admitted ID. |
| M-1 / m-1 — earlier equal input / restore prose | **fixed** | Exact-ID read-back never acknowledges the earlier equal input; source/docs describe terminal status OR exited agent and exclude merged. restore() itself is unchanged. |

## The accepted unrecorded-admission limit

The live r4-mark-ci CLI admits `msg_15966ef8f001oDuKlO7JxVgwlq`, fails all three marks, prints the admission and unrecorded-admission lines, and exits 0. The ledger stays sending. After that process exits and writes work again, a real lifecycle check of a new equal CI dispatch reuses that ID and writes `REVIEW-R4-CI:failed:FAILURE`, but service input count stays one. This independently confirms the exact limit in spec section 4 item 6. It is not eliminated by the new state or timer.

Cause of the remaining M-5 case: **(c)** three failed ledger mark writes, followed by the sending process ending before the entry expires; the process can end normally, so SIGKILL is not required.
Documented limit alternative: **acceptable here**, because ordinary failed removal is now safe, the original admission is real, all three caller surfaces expose failed bookkeeping, and this personal-tool contract explicitly specifies the residual recovery ambiguity. The operator can inspect the session before another equal send. This acceptance is bounded to the stated scenario; it must not be described as a general proof of exactly-once logical dispatch.

The live long-lived-owner probe returns `admissionUnrecorded: true`, holds its attempt socket, and gives a concurrent equal send a new ID. The corrected independent core-send probe prints its operator line and resolves undefined. The timer is unref'd; an ordinary CLI exits immediately and therefore does not retain protection for eleven minutes. After the owner ends, its old ID can be replayed until expiry. The first successful send should not simply throw: the held attempt lock makes its automatic retry mint a different ID, which duplicates the already admitted message.

There is no simple equivalent change confined to core that preserves all current retry/concurrency semantics and distinguishes a new equal dispatch from recovery of the old one once the successful outcome could not be persisted. The orphaned sending state is observationally identical to an interrupted uncertain admission. Refusing such recovered sending entries before reporting success would prevent a silent dispatch acknowledgement without changing lifecycle-manager.ts, but trades away automatic crash recovery and requires operator resolution. Distinguishing intents fully needs a durable caller-supplied logical dispatch identity or a different accepted recovery contract.

Other paths can also replay an actually admitted **uncertain** attempt: that is the specified same-text retry rule, including across callers, rather than evidence of a fresh input. With this API, core cannot establish that an equal caller intended a different logical dispatch. In the tested ordinary completed-success paths, successful marks exclude reuse; there is no additional path that silently turns a successfully recorded prior admission into a new dispatch. SIGKILL between service admission and settlement and the ten-minute expiry remain the explicit uncertainty/lifetime boundaries.

## Source conclusions and scope

The lock handle closes only its own net.Server; two holds exclude each other within one process and across processes. The kernel frees the abstract name on process death, and close-on-exec prevents an API child retaining it. The post-bind error listener keeps a bound socket valid. A probe never binds. Probes run under the ledger lock; a published token was already bound and is never rebound. Therefore a free result stays free. Failed bind/write releases the unpublished attempt. A failed non-success settle releases in finally even when no ledger lock was obtained. Success releases after the admitted write while the ledger lock remains held. An owner can also end/release outside that lock, but this is only a held-to-free transition, not a rebinding race.

Names include UID, kind and a 128-bit SHA-256 prefix of canonical directory plus ledger filename, and `#token` for attempts. Distinct state roots, loaded projects, session keys and tokens are separated (apart from negligible hash collision probability); intentional aliases of one directory share a lock. Configuration rejects duplicate project basenames. A direct name helper on a nonexistent directory throws; begin/change mkdir it before deriving names, removal returns early for a missing file, and the sweep returns on a missing directory. The UID is informational namespace separation, not an access-control boundary; the owner's local-account choice is out of scope.

Waits use timers and leave the event loop available. The alias test counted 194 heartbeats during a 2019 ms refusal. A lifecycle check still awaits the send, and poll reentrancy suppresses overlapping full polls. Nominal ledger waits for a successful send are up to 2 s begin + 3×2 s marking + 1.2 s mark backoff + 2 s clear = **11.2 s**, plus filesystem work, scheduling and up to 1 s for each equal-entry liveness probe at begin (up to 200 entries). An unknown/refused attempt instead has one settle wait, nominally 4 s including begin, plus probes. These are not hard wall-clock bounds and add to the documented API/restore waits.

Only Linux enables the lock. Core's raw-record preflight refuses the agent route before prepareSession, restoration or ledger creation on other platforms. Mocked-darwin tests exercise a dead session and verify no hook/runtime/ledger side effect. Runtime delivery for agents without hooks and OpenCode without a stored ID remains; the live Claude stub receives the old pane paste. Only OpenCode implements deliverMessage, and all its typed not-attached throws precede begin; an injected after-begin error is final and settles unknown. No second begin path or old PID/start-time/in-process liveness sets remain. owner.pid is validated/stored solely for operators.

Version 1 ledgers fail closed and the sweep retains corrupt files. This is appropriate for a never-deployed round-3 format: silently migrating/forgetting its unresolved identities would be riskier. The new pending key separates service deletion from ledger cleanup; dry-run never invokes pending removal or the sweep. Sweeps visit only projects selected from the loaded config (and project filter), not every state directory.

All **19 changed files, 5879 additions / 28 deletions**, are in the expanded allowlist. Seven round-4 commits and 24 total commits have conventional subjects and explanatory bodies; no non-ASCII/emoji or Co-Authored-By trailer. Protected lifecycle-manager.ts, metadata.ts, review-check.ts, config.ts and all package.json files have empty diffs over the full range. No hunk changes restore(). Core's returned object only adds deliver. `git branch -r --contains 9987edfa` prints nothing. No dependency/native module is added.

Size advice, not a finding: about 3798 added lines are tests. The duplicated child runner/parser in delivery-lock.test.ts:49–114 and delivery-ledger.test.ts:168–236 could share a small test helper. DeliveryOwner.pid and its validation (delivery-ledger.ts:101–106,199–211) are operator convenience rather than part of mutual exclusion/retry correctness; retaining them is reasonable but optional. Most production additions implement the requested protocol; no unrelated feature expansion was found.

Correct aspects include exact-ID recovery, persisted-before-prompt identity, separate retry ledger, kernel-released mutual exclusion, per-attempt liveness, admitted-before-clear, retryable purge cleanup, early size/platform refusals, preserved runtime routes and meaningful real-child tests. The three required surviving mutants expose test gaps, not a defect in the reviewed guards; independent barrier/error/alias probes verify their current behavior. No numbered finding depends on 2.0.29 model-turn measurements, TUI-age heuristics, a split pane, a TUI exiting while queued input waits, first-poll killed race, platform policy, account access policy or base formatting.

The author report was read after the independent implementation/test audit and repeated/load runs. The conclusions below come from this reviewer's build, source, mutations and isolated executions. No production source, commit, push, PR, network gh call, real-session send, model turn or default-server tmux operation was made.

## Work log and evidence (written during review)

Review target: `592441d6..9987edfa` (round 4 `72e5e59f..9987edfa`). Verdict completed below; the chronological evidence was written during the review.

The task prohibits commits, pushes, PRs, network gh calls, real-session sends, provider turns and real-state writes. These restrictions override the generic session prompt. HEAD is `9987edfa594c86780f24ff7d45aa5789459a1e6d`. Only task/report dispatch files were untracked at entry. Scratch root: `/tmp/i5r4-ao44-20261020`; real-state marker: `/tmp/i5r4-ao44-20261020-marker`. Executable review calls use env -i, a scratch HOME, private tmux shim and non-network gh stub. No implementation edits will be made in the reviewer worktree.

Initial safety observations: `/tmp/ao-opencode-launch-44402` contains only `.` and `..`. Real `~/.ao/bin` has `.ao-version` (5 bytes), `ao-metadata-helper.sh` (5466), `gh` (2213), `git` (3471), all unchanged since 2026-10-16 12:16:13. Full listing and hashes saved for final comparison.

Source checkpoint (before author report): read earlier review findings and round-4 implementation. The ledger now uses version 2, canonicalizes the existing deliveries directory with `realpathSync.native`, acquires the attempt lock before claiming, releases failed non-success attempts even when settlement cannot acquire the ledger lock, and marks admitted before clear. Unsupported-platform preflight precedes `prepareSession`. Only OpenCode implements `deliverMessage`; its typed not-attached throws precede begin. The new tests use real children and publication/release barriers; the old strict upper timing assertion is gone. Checking the residual unrecorded-admission limit and test sensitivity independently next.

Observed gates so far: frozen install/build exit 0; core **39 files / 1093 passed**; OpenCode **2 / 298**; CLI **19 / 257**; integration with OpenCode hidden **10 passed + 3 skipped files / 90 passed + 24 skipped tests**. Live isolated service is **2.0.32, PID 3985807, port 49654** (server.info verified before writes, not 15920). All four XDG roots are under scratch; isolated config disables `opencode`. Pre-prompt model list is exactly:

```json
{"location":{"directory":"/tmp/i5r4-ao44-20261020/home"},"data":[]}
```

### Live evidence: private pane environment

```text
[
  "TMUX=/tmp/tmux-44402/i5r4-ao44-20261020,4005000,0",
  "HOME=/tmp/i5r4-ao44-20261020/home",
  "PATH=/tmp/i5r4-ao44-20261020/bin:/home/taisung/.nvm/versions/node/v25.7.0/bin:/usr/bin:/bin"
]
```

### Live evidence: CLI r4-main

```text
{
  "exit": 0,
  "output": "Message admitted to r4-main (input msg_159659bfc001RHTk49lko0ZEfH, delivery queue)\n"
}
```

### Live evidence: normal pane and input

```text
{
  "before": "R4 STAND-IN pid=4005001 --session ses_ea69a76dcffezGu300XM566AtD",
  "after": "R4 STAND-IN pid=4005001 --session ses_ea69a76dcffezGu300XM566AtD",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_159659bfc001RHTk49lko0ZEfH",
        "type": "user",
        "text": "A admitted once"
      }
    ]
  },
  "ledger": null,
  "locks": []
}
```

### Live evidence: fixtures

```text
{
  "r4-main": {
    "sid": "ses_ea69a76dcffezGu300XM566AtD",
    "pane": "r4-main",
    "shellPid": 4005001,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a76dcffezGu300XM566AtD.json"
  },
  "r4-cross": {
    "sid": "ses_ea69a60b9ffe8l417yOJ0mmdj5",
    "pane": "r4-cross",
    "shellPid": 4005367,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a60b9ffe8l417yOJ0mmdj5.json"
  },
  "r4-clear": {
    "sid": "ses_ea69a5f60ffev4KxVxfN4iYPAF",
    "pane": "r4-clear",
    "shellPid": 4005392,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5f60ffev4KxVxfN4iYPAF.json"
  },
  "r4-ci": {
    "sid": "ses_ea69a5dfbffe3lNmxRKRR421aL",
    "pane": "r4-ci",
    "shellPid": 4005417,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5dfbffe3lNmxRKRR421aL.json"
  },
  "r4-mark": {
    "sid": "ses_ea69a5cc7ffezcO5ATr9WYg7WL",
    "pane": "r4-mark",
    "shellPid": 4005442,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5cc7ffezcO5ATr9WYg7WL.json"
  },
  "r4-mark-ci": {
    "sid": "ses_ea69a5bb2ffewoHBx3wtX8o3Ea",
    "pane": "r4-mark-ci",
    "shellPid": 4005467,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5bb2ffewoHBx3wtX8o3Ea.json"
  },
  "r4-crash": {
    "sid": "ses_ea69a5a53ffeB84763GQx2FG0g",
    "pane": "r4-crash",
    "shellPid": 4005492,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5a53ffeB84763GQx2FG0g.json"
  },
  "r4-before": {
    "sid": "ses_ea69a590dffeTY6C0Lja7z5939",
    "pane": "r4-before",
    "shellPid": 4005524,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a590dffeTY6C0Lja7z5939.json"
  },
  "r4-archive": {
    "sid": "ses_ea69a57b3ffeRvqwnXCfKoe412",
    "pane": "r4-archive",
    "shellPid": 4005549,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a57b3ffeRvqwnXCfKoe412.json"
  },
  "r4-race": {
    "sid": "ses_ea69a567effeXbPxNAuNS9qfpO",
    "pane": "r4-race",
    "shellPid": 4005574,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a567effeXbPxNAuNS9qfpO.json"
  },
  "r4-late-before": {
    "sid": "ses_ea69a5526ffeQL5o1kLzuuTkaj",
    "pane": "r4-late-before",
    "shellPid": 4005599,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5526ffeQL5o1kLzuuTkaj.json"
  },
  "r4-late-after": {
    "sid": "ses_ea69a53dcffefyc9M4iI2n546y",
    "pane": "r4-late-after",
    "shellPid": 4006238,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a53dcffefyc9M4iI2n546y.json"
  },
  "r4-earlier": {
    "sid": "ses_ea69a5269ffe3iB3cY8MR6Lta3",
    "pane": "r4-earlier",
    "shellPid": 4006463,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5269ffe3iB3cY8MR6Lta3.json"
  },
  "r4-concurrent": {
    "sid": "ses_ea69a513bffefjinfWiqDfdm8x",
    "pane": "r4-concurrent",
    "shellPid": 4006490,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a513bffefjinfWiqDfdm8x.json"
  },
  "r4-purge": {
    "sid": "ses_ea69a5005ffeT34j175A7KN5il",
    "pane": "r4-purge",
    "shellPid": 4006515,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5005ffeT34j175A7KN5il.json"
  },
  "r4-corrupt": {
    "sid": "ses_ea69a4e9cffe26oNgpw0g9Bsnd",
    "pane": "r4-corrupt",
    "shellPid": 4006547,
    "tmuxPid": 4005000,
    "ledger": "/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a4e9cffe26oNgpw0g9Bsnd.json"
  }
}
```

### Live evidence: B-3 owner idle before second process

```text
{
  "ownerPid": 4011170,
  "ownerAlive": true,
  "output": "ERROR AgentDeliveryError the admission of the input msg_15966b745001KkM3YZ4N7VHqxr to the OpenCode session ses_ea69a60b9ffe8l417yOJ0mmdj5 of r4-cross is unknown (opencode api session.prompt returned no inbox item msg_15966b745001KkM3YZ4N7VHqxr of session ses_ea69a60b9ffe8l417yOJ0mmdj5), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\nIDLE 4011170\n",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15966b745001KkM3YZ4N7VHqxr",
        "textSha256": "67d2211803046050449b8f509a17866be5d06ff8043cd21d9cf34cbe149a8b5e",
        "createdAt": "2026-10-20T13:01:06.244Z",
        "updatedAt": "2026-10-20T13:01:06.244Z",
        "state": "sending",
        "owner": {
          "pid": 4011170,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966b745001KkM3YZ4N7VHqxr",
        "type": "user",
        "text": "LIVE OWNER FAILED UNKNOWN"
      }
    ]
  }
}
```

### Live evidence: CLI r4-cross

```text
{
  "exit": 0,
  "output": "Message admitted to r4-cross (input msg_15966b745001KkM3YZ4N7VHqxr, delivery queue)\nAn earlier attempt of this send already admitted input msg_15966b745001KkM3YZ4N7VHqxr; nothing new was admitted.\n"
}
```

### Live evidence: B-3 cross-process retry

```text
{
  "ownerStillAlive": true,
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966b745001KkM3YZ4N7VHqxr",
        "type": "user",
        "text": "LIVE OWNER FAILED UNKNOWN"
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005367 --session ses_ea69a60b9ffe8l417yOJ0mmdj5"
}
```

### Live evidence: B-3 exact owner stopped

```text
4011170
```

### Live evidence: CLI r4-clear

```text
{
  "exit": 0,
  "output": "Message admitted to r4-clear (input msg_15966c869001BdkjwmglXDuMM4, delivery queue)\n"
}
```

### Live evidence: M-5 admitted mark after failed clear

```text
{
  "version": 2,
  "key": "<scratch-id>",
  "entries": [
    {
      "inputId": "msg_15966c869001BdkjwmglXDuMM4",
      "textSha256": "b8d0afe63d8c3a391ab8c2ce13daed0c6f9edd6076924762a10a8749fb47aad8",
      "createdAt": "2026-10-20T13:01:10.632Z",
      "updatedAt": "2026-10-20T13:01:10.832Z",
      "state": "admitted",
      "owner": {
        "pid": 4011949,
        "token": "<scratch-id>"
      }
    }
  ]
}
```

### Live evidence: CLI r4-clear

```text
{
  "exit": 0,
  "output": "Message admitted to r4-clear (input msg_15966cff90010ib5zrs3syQu78, delivery queue)\n"
}
```

### Live evidence: M-5 separate CLI new admission

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966cff90010ib5zrs3syQu78",
        "type": "user",
        "text": "INTENDED AGAIN"
      },
      {
        "id": "msg_15966c869001BdkjwmglXDuMM4",
        "type": "user",
        "text": "INTENDED AGAIN"
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005392 --session ses_ea69a5f60ffev4KxVxfN4iYPAF"
}
```

### Live evidence: CLI r4-ci

```text
{
  "exit": 0,
  "output": "Message admitted to r4-ci (input msg_15966d7f9001Sa3dJsWT1Zg4bd, delivery queue)\n"
}
```

### Live evidence: pre-lifecycle clear

```text
{
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15966d7f9001Sa3dJsWT1Zg4bd",
        "textSha256": "45924e2a3ee9bb26fe393ffb41ce277bf06d292fd878dbac46056715ba3486d3",
        "createdAt": "2026-10-20T13:01:14.616Z",
        "updatedAt": "2026-10-20T13:01:14.841Z",
        "state": "admitted",
        "owner": {
          "pid": 4012964,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966d7f9001Sa3dJsWT1Zg4bd",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  }
}
```

### Live evidence: real lifecycle after clear

```text
{
  "exit": 0,
  "output": "CHECK 0 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:55.462Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-ci\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a5dfbffe3lNmxRKRR421aL\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchHash\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchAt\":\"2026-10-20T13:01:17.467Z\"}\nCHECK 1 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:55.462Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-ci\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a5dfbffe3lNmxRKRR421aL\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchHash\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchAt\":\"2026-10-20T13:01:17.467Z\"}\n",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966e243001SmUwfiYVRqKpv8",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      },
      {
        "id": "msg_15966d7f9001Sa3dJsWT1Zg4bd",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005417 --session ses_ea69a5dfbffe3lNmxRKRR421aL"
}
```

### Live evidence: CLI r4-mark-ci

```text
{
  "exit": 0,
  "output": "Message admitted to r4-mark-ci (input msg_15966ef8f001oDuKlO7JxVgwlq, delivery queue)\nThe delivery ledger could not record that input msg_15966ef8f001oDuKlO7JxVgwlq was admitted: a send of the same text to r4-mark-ci in the next 10 min can reuse that ID and admit nothing new.\n"
}
```

### Live evidence: pre-lifecycle mark

```text
{
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15966ef8f001oDuKlO7JxVgwlq",
        "textSha256": "45924e2a3ee9bb26fe393ffb41ce277bf06d292fd878dbac46056715ba3486d3",
        "createdAt": "2026-10-20T13:01:20.654Z",
        "updatedAt": "2026-10-20T13:01:20.654Z",
        "state": "sending",
        "owner": {
          "pid": 4013857,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966ef8f001oDuKlO7JxVgwlq",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  }
}
```

### Live evidence: real lifecycle after mark

```text
{
  "exit": 0,
  "output": "CHECK 0 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:56.069Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-mark-ci\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a5bb2ffewoHBx3wtX8o3Ea\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchHash\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchAt\":\"2026-10-20T13:01:24.654Z\"}\nCHECK 1 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:56.069Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-mark-ci\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a5bb2ffewoHBx3wtX8o3Ea\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchHash\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchAt\":\"2026-10-20T13:01:24.654Z\"}\n",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15966ef8f001oDuKlO7JxVgwlq",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005467 --session ses_ea69a5bb2ffewoHBx3wtX8o3Ea"
}
```

### Live evidence: three failed marks in live owner

```text
{
  "output": "RESULT {\"route\":\"agent\",\"delivery\":{\"inputId\":\"msg_1596706d4001yvLBLRIw8Ju1FR\",\"mode\":\"queue\",\"waitsFor\":[],\"busy\":false},\"admissionUnrecorded\":true}\nIDLE 4015532\n",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596706d4001yvLBLRIw8Ju1FR",
        "textSha256": "c438edb42d063d8a1ebf701f7f3fcfbf3769e2d063b4b28707fe9089df7c2950",
        "createdAt": "2026-10-20T13:01:26.611Z",
        "updatedAt": "2026-10-20T13:01:26.611Z",
        "state": "sending",
        "owner": {
          "pid": 4015532,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "locks": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102099287 @ao-delivery-44402-attempt-60137be88b117749d911305b41524184",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102080918 @ao-delivery-44402-attempt-d696a43d87adfbf9a14a74a082d02625",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102099290 @ao-delivery-44402-attempt-39b9b0012f4373fe0e8bbf16fc838f14",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107489 @ao-delivery-44402-attempt-8c23b38663a94cd51ff46f63254d796a",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107482 @ao-delivery-44402-attempt-1c56c451b5f5af99f22484107e6f1f16",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107491 @ao-delivery-44402-attempt-1d0ec09ddec0d498a04e4d3818aadac2",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107509 @ao-delivery-44402-attempt-0c8ce86fdb2b7fd0ba65d09537a43fcc",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107551 @ao-delivery-44402-attempt-b1f946ce2810ec770a4575711d3cb46c",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107543 @ao-delivery-44402-attempt-7e9bd8da13dfc6e20502e909069d52d0",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107473 @ao-delivery-44402-attempt-e752bea929ffff6b1d48b760a0adccac",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107484 @ao-delivery-44402-attempt-4d650ebb3963f18b836389058bab4564",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107497 @ao-delivery-44402-attempt-f04383f2020150611ae53ed92e69572f",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107493 @ao-delivery-44402-attempt-876357c893c808ca5f865621d0a93776",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102107475 @ao-delivery-44402-attempt-0c9b21ced80dcf35a630c1e2268d71f5",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102080924 @ao-delivery-44402-attempt-541ab506c845443949984db181bc334c",
    "0000000000000000: 00000002 00000000 00010000 0001 01 102071271 @ao-delivery-44402-attempt-32d0e26ed66e1dad20630132bfbd66ac"
  ]
}
```

### Live evidence: CLI r4-mark

```text
{
  "exit": 0,
  "output": "Message admitted to r4-mark (input msg_1596713a3001EgTFDYKcc7ebLW, delivery queue)\n"
}
```

### Live evidence: equal new send while unrecorded owner runs

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596713a3001EgTFDYKcc7ebLW",
        "type": "user",
        "text": "MARK FAILS"
      },
      {
        "id": "msg_1596706d4001yvLBLRIw8Ju1FR",
        "type": "user",
        "text": "MARK FAILS"
      }
    ]
  },
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596706d4001yvLBLRIw8Ju1FR",
        "textSha256": "c438edb42d063d8a1ebf701f7f3fcfbf3769e2d063b4b28707fe9089df7c2950",
        "createdAt": "2026-10-20T13:01:26.611Z",
        "updatedAt": "2026-10-20T13:01:26.611Z",
        "state": "sending",
        "owner": {
          "pid": 4015532,
          "token": "<scratch-id>"
        }
      }
    ]
  }
}
```

### Live evidence: CLI r4-mark

```text
{
  "exit": 0,
  "output": "Message admitted to r4-mark (input msg_1596706d4001yvLBLRIw8Ju1FR, delivery queue)\nAn earlier attempt of this send already admitted input msg_1596706d4001yvLBLRIw8Ju1FR; nothing new was admitted.\n"
}
```

### Live evidence: unrecorded owner ended within ten minutes

```text
{
  "ownerStopped": 4015532,
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596713a3001EgTFDYKcc7ebLW",
        "type": "user",
        "text": "MARK FAILS"
      },
      {
        "id": "msg_1596706d4001yvLBLRIw8Ju1FR",
        "type": "user",
        "text": "MARK FAILS"
      }
    ]
  },
  "ledger": null
}
```

### Live evidence: before abrupt sender end hold-after

```text
{
  "cliPid": 4018635,
  "transportPid": 4018821,
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15967c7b8001P5eZ2cPVkDmNJy",
        "textSha256": "6c24c4f8ae267d42303eb07272388c49f0e711945ec7c5d9e36ca5254757b168",
        "createdAt": "2026-10-20T13:02:15.991Z",
        "updatedAt": "2026-10-20T13:02:15.991Z",
        "state": "sending",
        "owner": {
          "pid": 4018635,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15967c7b8001P5eZ2cPVkDmNJy",
        "type": "user",
        "text": "PROCESS ENDED hold-after"
      }
    ]
  },
  "locks": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102111206 @ao-delivery-44402-attempt-9b16d26542814f0ee1427d865191f623"
  ]
}
```

### Live evidence: CLI r4-crash

```text
{
  "exit": 0,
  "output": "Message admitted to r4-crash (input msg_15967c7b8001P5eZ2cPVkDmNJy, delivery queue)\nAn earlier attempt of this send already admitted input msg_15967c7b8001P5eZ2cPVkDmNJy; nothing new was admitted.\n"
}
```

### Live evidence: after abrupt sender retry hold-after

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15967c7b8001P5eZ2cPVkDmNJy",
        "type": "user",
        "text": "PROCESS ENDED hold-after"
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005492 --session ses_ea69a5a53ffeB84763GQx2FG0g"
}
```

### Live evidence: before abrupt sender end hold-before

```text
{
  "cliPid": 4019094,
  "transportPid": 4019270,
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15967d8a6001uc9lPdPDPYDsnm",
        "textSha256": "bf4a02016a8a10f691c7e122d035d6cb7d7e0a367304b270555e69c9c54ee2e2",
        "createdAt": "2026-10-20T13:02:20.325Z",
        "updatedAt": "2026-10-20T13:02:20.325Z",
        "state": "sending",
        "owner": {
          "pid": 4019094,
          "token": "a28057f8-9958-42f6-8938-3c7c8f4f32cf"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": []
  },
  "locks": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102104381 @ao-delivery-44402-attempt-35da90ebf81ac2fe51563193c9e9febd"
  ]
}
```

### Live evidence: CLI r4-before

```text
{
  "exit": 0,
  "output": "Message admitted to r4-before (input msg_15967d8a6001uc9lPdPDPYDsnm, delivery queue)\n"
}
```

### Live evidence: after abrupt sender retry hold-before

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15967d8a6001uc9lPdPDPYDsnm",
        "type": "user",
        "text": "PROCESS ENDED hold-before"
      }
    ]
  },
  "ledger": null,
  "pane": "R4 STAND-IN pid=4005524 --session ses_ea69a590dffeTY6C0Lja7z5939"
}
```

### Live evidence: CLI r4-archive

```text
{
  "exit": 1,
  "output": "Message not sent to r4-archive: the admission of the input msg_15967e68d001KebWCUbl7O0MPE to the OpenCode session ses_ea69a57b3ffeRvqwnXCfKoe412 of r4-archive is unknown (opencode api session.prompt returned no inbox item msg_15967e68d001KebWCUbl7O0MPE of session ses_ea69a57b3ffeRvqwnXCfKoe412), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: archive restore

```text
{
  "kill": "KILLED\n",
  "restore": "RESTORED {\"id\":\"r4-archive\",\"projectId\":\"review\",\"status\":\"spawning\",\"activity\":\"active\",\"branch\":\"feat/review\",\"issueId\":null,\"pr\":null,\"workspacePath\":\"/tmp/i5r4-ao44-20261020/project\",\"runtimeHandle\":{\"id\":\"r4-archive\",\"runtimeName\":\"tmux\",\"data\":{\"createdAt\":1792501344802,\"workspacePath\":\"/tmp/i5r4-ao44-20261020/project\"}},\"agentInfo\":null,\"createdAt\":\"2026-10-20T12:59:57.059Z\",\"lastActivityAt\":\"2026-10-20T13:02:24.484Z\",\"restoredAt\":\"2026-10-20T13:02:24.802Z\",\"metadata\":{\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"working\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:57.059Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-archive\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a57b3ffeRvqwnXCfKoe412\"}}\n",
  "beforeLedger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15967e68d001KebWCUbl7O0MPE",
        "textSha256": "45f67ecbb9bda7a0cd256cd49e8f10649155dfb7b4fa910740dd0644db6918bc",
        "createdAt": "2026-10-20T13:02:23.884Z",
        "updatedAt": "2026-10-20T13:02:24.131Z",
        "state": "unknown",
        "owner": {
          "pid": 4019602,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "afterLedger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15967e68d001KebWCUbl7O0MPE",
        "textSha256": "45f67ecbb9bda7a0cd256cd49e8f10649155dfb7b4fa910740dd0644db6918bc",
        "createdAt": "2026-10-20T13:02:23.884Z",
        "updatedAt": "2026-10-20T13:02:24.131Z",
        "state": "unknown",
        "owner": {
          "pid": 4019602,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "pane": "To run a command as administrator (user \"root\"), use \"sudo <command>\".\nSee \"man sudo_root\" for details.\n\nopencode --session 'ses_ea69a57b3ffeRvqwnXCfKoe412'\ntaisung@rioja-rutgers-edu:/tmp/i5r4-ao44-20261020/project$ opencode --session 's\nes_ea69a57b3ffeRvqwnXCfKoe412'\nR4 STAND-IN pid=4020227 --session ses_ea69a57b3ffeRvqwnXCfKoe412"
}
```

### Live evidence: CLI r4-archive

```text
{
  "exit": 0,
  "output": "Message admitted to r4-archive (input msg_15967e68d001KebWCUbl7O0MPE, delivery queue)\nAn earlier attempt of this send already admitted input msg_15967e68d001KebWCUbl7O0MPE; nothing new was admitted.\n"
}
```

### Live evidence: archive retry admission

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15967e68d001KebWCUbl7O0MPE",
        "type": "user",
        "text": "ARCHIVE RETRY"
      }
    ]
  },
  "ledger": null,
  "pane": "To run a command as administrator (user \"root\"), use \"sudo <command>\".\nSee \"man sudo_root\" for details.\n\nopencode --session 'ses_ea69a57b3ffeRvqwnXCfKoe412'\ntaisung@rioja-rutgers-edu:/tmp/i5r4-ao44-20261020/project$ opencode --session 's\nes_ea69a57b3ffeRvqwnXCfKoe412'\nR4 STAND-IN pid=4020227 --session ses_ea69a57b3ffeRvqwnXCfKoe412"
}
```

### Live evidence: CLI r4-race

```text
{
  "exit": 1,
  "output": "Message not sent to r4-race: the admission of the input msg_15967fef800100Km2Knkwu3vkg to the OpenCode session ses_ea69a567effeXbPxNAuNS9qfpO of r4-race is unknown (opencode api session.prompt returned no inbox item msg_15967fef800100Km2Knkwu3vkg of session ses_ea69a567effeXbPxNAuNS9qfpO), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: CLI r4-race

```text
{
  "exit": 0,
  "output": "Message admitted to r4-race (input msg_15967fef800100Km2Knkwu3vkg, delivery queue)\nAn earlier attempt of this send already admitted input msg_15967fef800100Km2Knkwu3vkg; nothing new was admitted.\n"
}
```

### Live evidence: real old-snapshot metadata writer

```text
{
  "writerPid": 4020920,
  "exit": 0,
  "ledgerBeforeResume": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_15967fef800100Km2Knkwu3vkg",
        "textSha256": "4516e6b86820f09a83880c344b58fd1eb70ee9dee45d4fec32a3387910c585d3",
        "createdAt": "2026-10-20T13:02:30.134Z",
        "updatedAt": "2026-10-20T13:02:30.407Z",
        "state": "unknown",
        "owner": {
          "pid": 4020927,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "recordAfter": "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=working\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T12:59:57.376Z\nruntimeHandle={\"id\":\"r4-race\",\"runtimeName\":\"tmux\",\"data\":{}}\nopencodeSessionId=ses_ea69a567effeXbPxNAuNS9qfpO\nlastCIFailureDispatchHash=EXTERNAL-HASH\n",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_15967fef800100Km2Knkwu3vkg",
        "type": "user",
        "text": "OLD SNAPSHOT"
      }
    ]
  }
}
```

### Live evidence: CLI r4-late-before

```text
{
  "exit": 1,
  "output": "Message not sent to r4-late-before: the admission of the input msg_159680f39001y1mIQj3nxoMpbO to the OpenCode session ses_ea69a5526ffeQL5o1kLzuuTkaj of r4-late-before is unknown (opencode api session.prompt returned no inbox item msg_159680f39001y1mIQj3nxoMpbO of session ses_ea69a5526ffeQL5o1kLzuuTkaj), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: CLI r4-late-before

```text
{
  "exit": 0,
  "output": "Message admitted to r4-late-before (input msg_159680f39001y1mIQj3nxoMpbO, delivery queue)\nAn earlier attempt of this send already admitted input msg_159680f39001y1mIQj3nxoMpbO; nothing new was admitted.\n"
}
```

### Live evidence: late admission ordering True

```text
{
  "originalID": "msg_159680f39001y1mIQj3nxoMpbO",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_159680f39001y1mIQj3nxoMpbO",
        "type": "user",
        "text": "LATE ADMISSION True"
      }
    ]
  },
  "ledger": null
}
```

### Live evidence: CLI r4-late-after

```text
{
  "exit": 1,
  "output": "Message not sent to r4-late-after: the admission of the input msg_159681e80001K7fugkTyFFiRNG to the OpenCode session ses_ea69a53dcffefyc9M4iI2n546y of r4-late-after is unknown (opencode api session.prompt returned no inbox item msg_159681e80001K7fugkTyFFiRNG of session ses_ea69a53dcffefyc9M4iI2n546y), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: CLI r4-late-after

```text
{
  "exit": 0,
  "output": "Message admitted to r4-late-after (input msg_159681e80001K7fugkTyFFiRNG, delivery queue)\n"
}
```

### Live evidence: late admission ordering False

```text
{
  "originalID": "msg_159681e80001K7fugkTyFFiRNG",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_159681e80001K7fugkTyFFiRNG",
        "type": "user",
        "text": "LATE ADMISSION False"
      }
    ]
  },
  "ledger": null
}
```

### Live evidence: CLI r4-earlier

```text
{
  "exit": 1,
  "output": "Message not sent to r4-earlier: the admission of the input msg_159682c58001Ueg5W8mm1uZIjb to the OpenCode session ses_ea69a5269ffe3iB3cY8MR6Lta3 of r4-earlier is unknown (opencode api session.prompt returned no inbox item msg_159682c58001Ueg5W8mm1uZIjb of session ses_ea69a5269ffe3iB3cY8MR6Lta3), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: earlier equal input does not acknowledge new ID

```text
{
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_159682c58001Ueg5W8mm1uZIjb",
        "textSha256": "d93d417bb0456768b4d8d2de75c98521c5d6d73e96f6e3f6e55f44dc300b77c4",
        "createdAt": "2026-10-20T13:02:41.751Z",
        "updatedAt": "2026-10-20T13:02:41.885Z",
        "state": "unknown",
        "owner": {
          "pid": 4022350,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [
      {
        "id": "msg_1596826f4001CEyKiXkqfFtqis",
        "type": "user",
        "text": ""
      }
    ],
    "users": []
  }
}
```

### Live evidence: CLI r4-earlier

```text
{
  "exit": 0,
  "output": "Message admitted to r4-earlier (input msg_159682c58001Ueg5W8mm1uZIjb, delivery queue)\n"
}
```

### Live evidence: earlier equal retry

```text
{
  "inbox": [
    {
      "id": "msg_159682c58001Ueg5W8mm1uZIjb",
      "type": "user",
      "text": ""
    }
  ],
  "users": [
    {
      "id": "msg_1596826f4001CEyKiXkqfFtqis",
      "type": "user",
      "text": "EARLIER EQUAL"
    }
  ]
}
```

### Live evidence: actual lifecycle unknown first check

```text
{
  "output": "CHECK 0 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T13:02:44.374Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-retry\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea697ca26ffeavVWBVLiEmWQ6A\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\"}\n",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596842b7001wZQkfJE7m6ZFGQ",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  },
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596842b7001wZQkfJE7m6ZFGQ",
        "textSha256": "45924e2a3ee9bb26fe393ffb41ce277bf06d292fd878dbac46056715ba3486d3",
        "createdAt": "2026-10-20T13:02:47.478Z",
        "updatedAt": "2026-10-20T13:02:47.730Z",
        "state": "unknown",
        "owner": {
          "pid": 4022792,
          "token": "<scratch-id>"
        }
      }
    ]
  }
}
```

### Live evidence: actual lifecycle second check

```text
{
  "output": "CHECK 0 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T13:02:44.374Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-retry\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea697ca26ffeavVWBVLiEmWQ6A\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchHash\":\"REVIEW-R4-CI:failed:FAILURE\",\"lastCIFailureDispatchAt\":\"2026-10-20T13:02:50.430Z\"}\n",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596842b7001wZQkfJE7m6ZFGQ",
        "type": "user",
        "text": "CI checks are failing on your PR. Here are the failed checks:\n\n- **REVIEW-R4-CI**: FAILURE \u2014 https://ci/1\n\nInvestigate the failures, fix the issues, and push again."
      }
    ]
  },
  "ledger": null
}
```

### Live evidence: CLI r4-corrupt

```text
{
  "exit": 1,
  "output": "Message not sent to r4-corrupt: Cannot send to session r4-corrupt: the input ID cannot be persisted (the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a4e9cffe26oNgpw0g9Bsnd.json is not valid (it is not JSON); ao does not change it. Check that no ao process sends to this session, then remove the file to clear it); nothing was sent\n"
}
```

### Live evidence: corrupt ledger lifecycle fails closed

```text
{
  "output": "CHECK 0 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:59.453Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-corrupt\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a4e9cffe26oNgpw0g9Bsnd\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\"}\nCHECK 1 {\"worktree\":\"/tmp/i5r4-ao44-20261020/project\",\"branch\":\"feat/review\",\"status\":\"ci_failed\",\"project\":\"review\",\"agent\":\"opencode\",\"createdAt\":\"2026-10-20T12:59:59.453Z\",\"runtimeHandle\":\"{\\\"id\\\":\\\"r4-corrupt\\\",\\\"runtimeName\\\":\\\"tmux\\\",\\\"data\\\":{}}\",\"opencodeSessionId\":\"ses_ea69a4e9cffe26oNgpw0g9Bsnd\",\"pr\":\"https://github.com/scratch/review/pull/42\",\"prAutoDetect\":\"off\",\"lastCIFailureFingerprint\":\"REVIEW-R4-CI:failed:FAILURE\"}\n",
  "file": "[broken-json",
  "inputs": {
    "inbox": [],
    "users": []
  },
  "pane": "R4 STAND-IN pid=4006547 --session ses_ea69a4e9cffe26oNgpw0g9Bsnd"
}
```

### Live evidence: CLI r4-purge

```text
{
  "exit": 1,
  "output": "Message not sent to r4-purge: the admission of the input msg_1596a734e0011H2cMmENSdwLod to the OpenCode session ses_ea69a5005ffeT34j175A7KN5il of r4-purge is unknown (opencode api session.prompt returned no inbox item msg_1596a734e0011H2cMmENSdwLod of session ses_ea69a5005ffeT34j175A7KN5il), and the read-back failed (opencode api session.inbox.list failed: HTTP 503 Service Unavailable); the message was not sent again\n"
}
```

### Live evidence: zero usage immediately before purge

```text
{
  "id": "ses_ea69a5005ffeT34j175A7KN5il",
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  }
}
```

### Live evidence: failed purge ledger removal

```text
{
  "exit": 0,
  "output": "ao: could not remove the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5005ffeT34j175A7KN5il.json of OpenCode session ses_ea69a5005ffeT34j175A7KN5il of r4-purge (EACCES: R4 injected rm /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5005ffeT34j175A7KN5il.json); the next `ao session cleanup` tries again.\n\nSession r4-purge killed.\n",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596a734e0011H2cMmENSdwLod",
        "textSha256": "c9cece0502b60c06e67abc73179c4ccb104943f748deae4f85caaf5716243238",
        "createdAt": "2026-10-20T13:05:10.989Z",
        "updatedAt": "2026-10-20T13:05:11.257Z",
        "state": "unknown",
        "owner": {
          "pid": 4030978,
          "token": "<scratch-id>"
        }
      }
    ]
  }
}
```

### Live evidence: archived pending key

```text
[
  "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=working\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T12:59:59.073Z\nruntimeHandle={\"id\":\"r4-purge\",\"runtimeName\":\"tmux\",\"data\":{}}\nopencodeCleanedAt=2026-10-20T13:05:12.077Z\nopencodeLedgerPending=ses_ea69a5005ffeT34j175A7KN5il\n"
]
```

### Live evidence: CLI r4-main

```text
{
  "exit": 0,
  "output": "Message admitted to r4-main (input msg_1596a7a860015Jlfulvcv7LGPK, delivery queue)\n"
}
```

### Live evidence: size 131k

```text
{
  "textBytes": 131000,
  "jsonBytes": 131068,
  "exit": 0
}
```

### Live evidence: dry-run pending ledger retry

```text
{
  "exit": 0,
  "output": "Checking for completed sessions...\n\n  No sessions to clean up.\n",
  "stillExists": true
}
```

### Live evidence: cleanup removes file but pending clear fails

```text
{
  "exit": 0,
  "output": "Checking for completed sessions...\n\nao: removed the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a5005ffeT34j175A7KN5il.json of r4-purge, but could not clear its key opencodeLedgerPending (EACCES: permission denied, open '/tmp/i5r4-ao44-20261020/state/dbb514960c83-project/sessions/archive/r4-purge_2026-10-20T13-05-12-076Z.tmp.4033082.1792501515122'); the next `ao session cleanup` clears it.\n  No sessions to clean up.\n",
  "fileExists": false,
  "archive": [
    "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=working\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T12:59:59.073Z\nruntimeHandle={\"id\":\"r4-purge\",\"runtimeName\":\"tmux\",\"data\":{}}\nopencodeCleanedAt=2026-10-20T13:05:12.077Z\nopencodeLedgerPending=ses_ea69a5005ffeT34j175A7KN5il\n"
  ]
}
```

### Live evidence: CLI r4-main

```text
{
  "exit": 0,
  "output": "Message admitted to r4-main (input msg_1596a8473001tMqx7Wi02msRrC, delivery queue)\n"
}
```

### Live evidence: size exact

```text
{
  "textBytes": 131003,
  "jsonBytes": 131071,
  "exit": 0
}
```

### Live evidence: CLI r4-main

```text
{
  "exit": 1,
  "output": "Message not sent to r4-main: the session.prompt body of this message has 131072 bytes, more than the 131071 bytes that one command-line argument can hold (opencode api takes the body only as -d <json>); nothing was sent\n"
}
```

### Live evidence: size over

```text
{
  "textBytes": 131004,
  "jsonBytes": 131072,
  "exit": 1
}
```

### Live evidence: second cleanup clears pending key

```text
{
  "exit": 0,
  "output": "Checking for completed sessions...\n\n  No sessions to clean up.\n",
  "archive": [
    "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=working\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T12:59:59.073Z\nruntimeHandle={\"id\":\"r4-purge\",\"runtimeName\":\"tmux\",\"data\":{}}\nopencodeCleanedAt=2026-10-20T13:05:12.077Z\n"
  ]
}
```

### Live evidence: CLI r4-main

```text
{
  "exit": 1,
  "output": "Message not sent to r4-main: the session.prompt body of this message has 204868 bytes, more than the 131071 bytes that one command-line argument can hold (opencode api takes the body only as -d <json>); nothing was sent\n"
}
```

### Live evidence: size 200k

```text
{
  "textBytes": 204800,
  "jsonBytes": 204868,
  "exit": 1
}
```

### Live evidence: CLI r4-main

```text
{
  "exit": 0,
  "output": "Message admitted to r4-main (input msg_1596a93de00105ESwUDL6b6Ic6, delivery queue)\n"
}
```

### Live evidence: exact escaped size input

```text
{
  "textBytes": 99003,
  "sha256": "91c21d4cf755ada23219129f0598e9a394838c80f2e10485c2021b667d08b170",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596a93de00105ESwUDL6b6Ic6",
        "type": "user",
        "text": {
          "bytes": 99003,
          "sha256": "91c21d4cf755ada23219129f0598e9a394838c80f2e10485c2021b667d08b170"
        }
      },
      {
        "id": "msg_1596a8473001tMqx7Wi02msRrC",
        "type": "user",
        "text": {
          "bytes": 131003,
          "sha256": "236abb9ba9b485cebca3263ddec6bcbc6b1271060b2afdc0bb6816deed68e827"
        }
      },
      {
        "id": "msg_1596a7a860015Jlfulvcv7LGPK",
        "type": "user",
        "text": {
          "bytes": 131000,
          "sha256": "675606126866ae17bad4bb6c378fff2184d35877a9e3dcc15c5f96270824187f"
        }
      },
      {
        "id": "msg_159659bfc001RHTk49lko0ZEfH",
        "type": "user",
        "text": "A admitted once"
      }
    ]
  }
}
```

### Live evidence: core send unrecorded admission operator line

```text
{
  "exit": 0,
  "output": "RESULT undefined\n",
  "ledger": null,
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596a9741001sPAr9U560VdsDa",
        "type": "user",
        "text": "CORE SEND MARK FAILS"
      }
    ]
  }
}
```

### Live evidence: CLI r4-concurrent

```text
{
  "exit": 0,
  "output": "Message admitted to r4-concurrent (input msg_1596aa3130010ovEiUrT1sTtru, delivery queue)\n"
}
```

### Live evidence: intended concurrent equal sends

```text
{
  "firstLedger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596a9b4d001tAC94NsPy9N0Zd",
        "textSha256": "c851daf266b283e08b09fb30891d4ffb083898939cf0e4b49ca34f85a6405b56",
        "createdAt": "2026-10-20T13:05:21.227Z",
        "updatedAt": "2026-10-20T13:05:21.227Z",
        "state": "sending",
        "owner": {
          "pid": 4035705,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596aa3130010ovEiUrT1sTtru",
        "type": "user",
        "text": "G concurrent equal"
      },
      {
        "id": "msg_1596a9b4d001tAC94NsPy9N0Zd",
        "type": "user",
        "text": "G concurrent equal"
      }
    ]
  },
  "pane": "R4 STAND-IN pid=4006490 --session ses_ea69a513bffefjinfWiqDfdm8x"
}
```

### Live evidence: first concurrent CLI completion

```text
{
  "exit": 0,
  "output": "Message admitted to r4-concurrent (input msg_1596a9b4d001tAC94NsPy9N0Zd, delivery queue)\n",
  "ledger": null
}
```

### Live evidence: zero immediately before explicit remove

```text
{
  "id": "ses_ea6955a7dfferO5MzAaNFlbX6B",
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  }
}
```

### Live evidence: CLI r4-removed

```text
{
  "exit": 1,
  "output": "Message not sent to r4-removed: the OpenCode session ses_ea6955a7dfferO5MzAaNFlbX6B of r4-removed does not exist (session.prompt answered 404 SessionNotFoundError): the stored session ID of r4-removed is stale; nothing was sent\n"
}
```

### Live evidence: removed session pane

```text
{
  "same": true,
  "ledger": null
}
```

### Live evidence: CLI r4-wrong

```text
{
  "exit": 1,
  "output": "Message not sent to r4-wrong: Cannot deliver to session r4-wrong: no OpenCode TUI runs on session ses_ea69a76dcffezGu300XM566AtD in the tmux pane r4-wrong (not seen within 10 s); a session.prompt without an attached TUI runs the tools of its turn without the worker's AO_* variables and ~/.ao/bin wrappers, so nothing was sent; the restore for a second try failed (Cannot send to session r4-wrong: session needed to be restarted before delivery (Session r4-wrong cannot be restored: session is not in a terminal state))\n"
}
```

### Live evidence: other-session TUI

```text
{
  "same": true,
  "originalPane": "R4 STAND-IN pid=4036563 --session ses_ea6954c57ffeW6WagI7p4mj8a3"
}
```

### Live evidence: CLI r4-restore

```text
{
  "exit": 0,
  "output": "Message admitted to r4-restore (input msg_1596afa94001NdG9TjIq619isx, delivery queue)\n"
}
```

### Live evidence: restore after stopped stand-in

```text
{
  "before": "R4 STAND-IN pid=4005001 --session ses_ea69a76dcffezGu300XM566AtD",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596afa94001NdG9TjIq619isx",
        "type": "user",
        "text": "B restored send"
      },
      {
        "id": "msg_1596a93de00105ESwUDL6b6Ic6",
        "type": "user",
        "text": {
          "bytes": 99003,
          "sha256": "91c21d4cf755ada23219129f0598e9a394838c80f2e10485c2021b667d08b170"
        }
      },
      {
        "id": "msg_1596a8473001tMqx7Wi02msRrC",
        "type": "user",
        "text": {
          "bytes": 131003,
          "sha256": "236abb9ba9b485cebca3263ddec6bcbc6b1271060b2afdc0bb6816deed68e827"
        }
      },
      {
        "id": "msg_1596a7a860015Jlfulvcv7LGPK",
        "type": "user",
        "text": {
          "bytes": 131000,
          "sha256": "675606126866ae17bad4bb6c378fff2184d35877a9e3dcc15c5f96270824187f"
        }
      },
      {
        "id": "msg_159659bfc001RHTk49lko0ZEfH",
        "type": "user",
        "text": "A admitted once"
      }
    ]
  }
}
```

Harness note: the first core-send operator-line probe overlapped the ordinary-case fixture's shared fault-control reset. Its successful `RESULT undefined` without a warning is not evidence about the three-failed-mark path. A separate isolated rerun (`r4-coremark2`) follows. The independent `deliver` and CLI three-failure probes above did retain `sending` and report unrecorded admission correctly. No production finding is based on that harness overlap. A lock helper initially passed a NUL name in argv (Node correctly rejects that); it was corrected to JSON-encode the name and rerun.

### Live evidence: core send operator line corrected isolated run

```text
{
  "exit": 0,
  "output": "ao: input msg_1596b5397001HVt7Q5ZobcGmxw was admitted to r4-coremark2, but the delivery ledger could not record it. While this process runs (at most 11 min), a send of the same text gets a new ID; after this process ends, a send of the same text in the 10 min after this one can reuse the ID and admit nothing new.\nRESULT undefined\n",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_1596b5397001HVt7Q5ZobcGmxw",
        "textSha256": "e91d6a57fbd22b029b9d5818efdcc71ba2d144554b0e89169ed10acedce846f8",
        "createdAt": "2026-10-20T13:06:08.406Z",
        "updatedAt": "2026-10-20T13:06:08.406Z",
        "state": "sending",
        "owner": {
          "pid": 4039099,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596b5397001HVt7Q5ZobcGmxw",
        "type": "user",
        "text": "CORE SEND MARK FAILS VERIFIED"
      }
    ]
  }
}
```

### Live evidence: zero immediately before corrupt-ledger purge

```text
{
  "id": "ses_ea69a4e9cffe26oNgpw0g9Bsnd",
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  }
}
```

### Live evidence: purge corrupt ledger plus failed pending-key write

```text
{
  "exit": 0,
  "output": "ao: could not remove the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea69a4e9cffe26oNgpw0g9Bsnd.json of OpenCode session ses_ea69a4e9cffe26oNgpw0g9Bsnd of r4-corrupt (EACCES: R4 ledger removal failed); `ao session cleanup` removes it when its entries are older than 10 min.\n\nSession r4-corrupt killed.\n",
  "archive": [
    "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=ci_failed\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T12:59:59.453Z\nruntimeHandle={\"id\":\"r4-corrupt\",\"runtimeName\":\"tmux\",\"data\":{}}\npr=https://github.com/scratch/review/pull/42\nprAutoDetect=off\nlastCIFailureFingerprint=REVIEW-R4-CI:failed:FAILURE\nopencodeCleanedAt=2026-10-20T13:07:32.987Z\n"
  ],
  "ledgerBytes": "[broken-json"
}
```

### Live evidence: zero immediately before warning-case purge

```text
{
  "id": "ses_ea6925a7dffe8yeY0eGigAGU0V",
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  }
}
```

### Live evidence: warning verified with pending temp creation refused

```text
{
  "exit": 0,
  "output": "ao: could not remove the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea6925a7dffe8yeY0eGigAGU0V.json of OpenCode session ses_ea6925a7dffe8yeY0eGigAGU0V of r4-warncorrupt (EACCES: R4 ledger removal failed); `ao session cleanup` removes it when its entries are older than 10 min.\n\nSession r4-warncorrupt killed.\n",
  "archive": [
    "worktree=/tmp/i5r4-ao44-20261020/project\nbranch=feat/review\nstatus=working\nproject=review\nagent=opencode\ncreatedAt=2026-10-20T13:08:40.648Z\nruntimeHandle={\"id\":\"r4-warncorrupt\",\"runtimeName\":\"tmux\",\"data\":{}}\nopencodeCleanedAt=2026-10-20T13:08:41.340Z\n"
  ],
  "ledger": "[broken-json"
}
```

Further harness detail for the warning candidate: failing only the pending-key **rename** leaves atomic-write's completed temp file in the archive. Existing archive readers select that lexically newer file, so the next cleanup did in fact find the pending key and remove the corrupt ledger. That first probe does not establish a warning defect. The corrected probe fails creation of the pending temp file (as a read-only archive directory would), so no uncommitted temp file supplies the lost key. The original metadata temp-file selection predates I-5 and is not itself raised as a new finding here.

### Live evidence: corrupt ledger retained with no pending key

```text
{
  "exit": 0,
  "output": "Checking for completed sessions...\n\nao: kept OpenCode session ses_ea69a76dcffezGu300XM566AtD of r4-main: live session r4-restore uses it.\n  No sessions to clean up.\n",
  "fileExists": true,
  "ledgerBytes": "[broken-json"
}
```

### Live evidence: M-4 exact holder ended in-change

```text
{
  "holderPid": 4050599,
  "ledgerWhileHeld": null,
  "boundWhileHeld": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102151525 @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97"
  ],
  "boundAfter": []
}
```

### Live evidence: CLI r4-lock

```text
{
  "exit": 0,
  "output": "Message admitted to r4-lock (input msg_1596e35720017w2ZZWxMXUxDhL, delivery queue)\n"
}
```

### Live evidence: M-4 exact holder ended before-unlock

```text
{
  "holderPid": 4050806,
  "ledgerWhileHeld": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_writtenBeforeRelease",
        "textSha256": "d9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa",
        "createdAt": "2026-10-20T13:09:17.583Z",
        "updatedAt": "2026-10-20T13:09:17.583Z",
        "state": "unknown",
        "owner": {
          "pid": 4050806,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "boundWhileHeld": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102170836 @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97"
  ],
  "boundAfter": []
}
```

### Live evidence: CLI r4-lock

```text
{
  "exit": 0,
  "output": "Message admitted to r4-lock (input msg_1596e3d5e001Q2zCRHytPrShAg, delivery queue)\n"
}
```

### Live evidence: M-4 actual CLI waiter ended at barrier

```text
{
  "waiterPid": 4051034,
  "observedEADDRINUSE": "4051034",
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596e3d5e001Q2zCRHytPrShAg",
        "type": "user",
        "text": "AFTER HOLDER before-unlock"
      },
      {
        "id": "msg_1596e35720017w2ZZWxMXUxDhL",
        "type": "user",
        "text": "AFTER HOLDER in-change"
      }
    ]
  },
  "locks": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102170942 @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97"
  ]
}
```

### Live evidence: M-4 exact holder ended killed-waiter

```text
{
  "holderPid": 4051027,
  "ledgerWhileHeld": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_writtenBeforeRelease",
        "textSha256": "d9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa",
        "createdAt": "2026-10-20T13:09:17.583Z",
        "updatedAt": "2026-10-20T13:09:17.583Z",
        "state": "unknown",
        "owner": {
          "pid": 4050806,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "boundWhileHeld": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102170942 @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97"
  ],
  "boundAfter": []
}
```

### Live evidence: CLI r4-lock

```text
{
  "exit": 0,
  "output": "Message admitted to r4-lock (input msg_1596e4d4e001wfCBlWfALHZV2r, delivery queue)\n"
}
```

### Live evidence: CLI r4-lock

```text
{
  "exit": 1,
  "output": "Message not sent to r4-lock: Cannot send to session r4-lock: the input ID cannot be persisted (the delivery ledger /tmp/i5r4-ao44-20261020/state/dbb514960c83-project/deliveries/ses_ea691d779ffeZBXQeL4BUj8fWc.json is locked by another process for more than 2000 ms (the lock is the abstract socket @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97; `ss -xlp` shows the process that holds it)); nothing was sent\n"
}
```

### Live evidence: M-4 exact holder ended live-holder

```text
{
  "holderPid": 4051565,
  "ledgerWhileHeld": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_writtenBeforeRelease",
        "textSha256": "d9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa",
        "createdAt": "2026-10-20T13:09:17.583Z",
        "updatedAt": "2026-10-20T13:09:17.583Z",
        "state": "unknown",
        "owner": {
          "pid": 4050806,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "boundWhileHeld": [
    "0000000000000000: 00000002 00000000 00010000 0001 01 102173163 @ao-delivery-44402-ledger-d9b3b26320ea0e63a833bb58991bfa97"
  ],
  "boundAfter": []
}
```

### Live evidence: CLI r4-lock

```text
{
  "exit": 0,
  "output": "Message admitted to r4-lock (input msg_1596e6453001Z0D4KqpWpMhThN, delivery queue)\n"
}
```

### Live evidence: M-4 final live inputs

```text
{
  "inputs": {
    "inbox": [],
    "users": [
      {
        "id": "msg_1596e6453001Z0D4KqpWpMhThN",
        "type": "user",
        "text": "AFTER HOLDER live-holder"
      },
      {
        "id": "msg_1596e4d4e001wfCBlWfALHZV2r",
        "type": "user",
        "text": "AFTER HOLDER killed-waiter"
      },
      {
        "id": "msg_1596e3d5e001Q2zCRHytPrShAg",
        "type": "user",
        "text": "AFTER HOLDER before-unlock"
      },
      {
        "id": "msg_1596e35720017w2ZZWxMXUxDhL",
        "type": "user",
        "text": "AFTER HOLDER in-change"
      }
    ]
  },
  "pane": "R4 STAND-IN pid=4050589 --session ses_ea691d779ffeZBXQeL4BUj8fWc",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_writtenBeforeRelease",
        "textSha256": "d9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa",
        "createdAt": "2026-10-20T13:09:17.583Z",
        "updatedAt": "2026-10-20T13:09:17.583Z",
        "state": "unknown",
        "owner": {
          "pid": 4050806,
          "token": "<scratch-id>"
        }
      }
    ]
  }
}
```

### Live evidence: Claude runtime path

```text
{
  "exit": 0,
  "output": "Message sent \u2014 could not confirm it was received\n",
  "before": "R4 STAND-IN pid=4052984\n>",
  "after": "R4 STAND-IN pid=4052984\n>\nE stub paste\ngot: E stub paste\n>\n\ngot:\n>\n\ngot:\n>"
}
```

## Gates and repeated tests (reviewer runs)

All gates used env -i and fake HOME; tests inherited no AO variables. Gate PATH hid OpenCode. Final gating commands used newly allocated empty HOMEs; TMPDIR stayed below scratch. No source mutation was made in the reviewer worktree.

| Check | Actual result |
| --- | --- |
| install | exit 0 |
| build | exit 0 |
| core | Test Files  39 passed (39); Tests  1093 passed (1093); Duration  19.36s (transform 20.35s, setup 0ms, import 32.12s, tests 61.02s, environment 5ms) |
| plugin | Test Files  2 passed (2); Tests  298 passed (298); Duration  18.65s (transform 762ms, setup 0ms, collect 1.53s, tests 17.33s, environment 0ms, prepare 315ms) |
| cli | Test Files  19 passed (19); Tests  257 passed (257); Duration  39.30s (transform 2.37s, setup 0ms, collect 6.14s, tests 38.38s, environment 4ms, prepare 1.33s) |
| integration | Test Files  10 passed | 3 skipped (13); Tests  90 passed | 24 skipped (114); Duration  2.96s (transform 2.03s, setup 0ms, collect 7.83s, tests 5.41s, environment 10ms, prepare 2.49s) |
| lint | exit 0; 0 errors, 5 existing warnings |
| typecheck | exit 0 |
| full pnpm test | exit 0; 2547 passed / 29 skipped |

Full-suite summary lines:
```text
packages/core test:       Tests  1093 passed (1093)
packages/plugins/agent-gemini test:       Tests  62 passed (62)
packages/plugins/agent-codex test:       Tests  215 passed (215)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  208 passed (208)
packages/plugins/runtime-herdr test:       Tests  36 passed (36)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/runtime-tmux test:       Tests  30 passed (30)
packages/plugins/workspace-worktree test:       Tests  50 passed (50)
packages/plugins/agent-opencode test:       Tests  298 passed (298)
packages/integration-tests test:       Tests  90 passed | 24 skipped (114)
packages/cli test:       Tests  257 passed (257)
```

| Repetition | Lock file (8 tests) | Ledger file (28 tests) |
| --- | --- | --- |
| 1 | 8 passed (8); 1.36s | 28 passed (28); 5.36s |
| 2 | 8 passed (8); 1.36s | 28 passed (28); 5.34s |
| 3 | 8 passed (8); 1.41s | 28 passed (28); 5.38s |
| 4 | 8 passed (8); 1.36s | 28 passed (28); 5.77s |
| 5 | 8 passed (8); 1.42s | 28 passed (28); 5.30s |
| loaded | 8 passed (8); 5.64s | 28 passed (28); 13.91s |

Loaded run: six busy-loop processes pinned with the tests to CPU 0. Exact PIDs 4008143–4008148 were killed and reaped. `LOAD remaining []`. No observed flake. The holder/release barriers replace the old scheduling upper margin. The 2 s lower bound is checked against a holder alive for the whole attempt. Default per-test timeouts still depend on host scheduling.

The ledger afterEach now awaits child exit. Lock afterEach still signals children without awaiting their exit, and its sleep grandchild is killed without an exit wait; this is a test-cleanup improvement to make. Final process/socket scans check that no live child or bound name remains. The tests transpile the current sources (not stale dist); typecheck supplies semantic typing that transpileModule alone does not check.

The first standalone core run used the fake install HOME. Its final verification is repeated with a new empty gate HOME (`core-fresh.log`); the full-suite run already used a fresh gate HOME. Two `sleep 300` processes in an unfiltered host process listing had external parents (1613731, 1610522); they were already gone at follow-up inspection. They were not touched.

### Live evidence: warning condition verified with every timestamp twelve minutes old

```text
{
  "exit": 0,
  "output": "Checking for completed sessions...\n\nao: kept OpenCode session ses_ea69a76dcffezGu300XM566AtD of r4-main: live session r4-restore uses it.\n  No sessions to clean up.\n",
  "ledger": {
    "version": 2,
    "key": "<scratch-id>",
    "entries": [
      {
        "inputId": "msg_oldInvalid",
        "textSha256": "abc",
        "createdAt": "2026-10-20T13:00:10.218853+00:00",
        "updatedAt": "2026-10-20T13:00:10.218853+00:00",
        "state": "unknown",
        "owner": {
          "pid": 4068304,
          "token": "<scratch-id>"
        }
      }
    ]
  },
  "stillExists": true
}
```

Fresh-core environment correction: the first final rerun had 1091 pass / 2 failures in unchanged config discovery tests. By then the live config existed at the parent of the gate TMPDIR; `findConfigFile()` correctly walked up and found that review fixture, contradicting the tests' “no config in ancestors” premise. This is not a product regression. Gate TMPDIR was moved to sibling `/tmp/i5r4-ao44-20261020-gates` (no config in its ancestors) for the corrected final rerun. Earlier standalone/full-suite gates ran before the live config was created and passed. No OpenCode was on the gate PATH and no inherited AO variables were present in the failed rerun.

### Live evidence: final isolated model list and service identity

```text
{
  "model.list": {
    "location": {
      "directory": "/tmp/i5r4-ao44-20261020/home"
    },
    "data": []
  },
  "server.info": {
    "version": "2.0.32",
    "pid": 3985807,
    "urls": [
      "http://127.0.0.1:49654"
    ],
    "paths": {
      "tmp": "/tmp/i5r4-ao44-20261020/tmp/opencode"
    },
    "capabilities": {
      "persistentPty": true
    }
  }
}
```

### Live evidence: final zero usage for every surviving isolated session

```text
[
  {
    "id": "ses_ea691d779ffeZBXQeL4BUj8fWc",
    "title": "R4 r4-lock",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea694b95bffeNdbm4psuJ6Wnha",
    "title": "R4 r4-coremark2",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a76dcffezGu300XM566AtD",
    "title": "R4 r4-main",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea6954c57ffeW6WagI7p4mj8a3",
    "title": "R4 r4-wrong",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a513bffefjinfWiqDfdm8x",
    "title": "R4 r4-concurrent",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69575a5ffehMl5yJiudJX5Dr",
    "title": "R4 r4-coremark",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea697ca26ffeavVWBVLiEmWQ6A",
    "title": "R4 r4-retry",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5269ffe3iB3cY8MR6Lta3",
    "title": "R4 r4-earlier",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a53dcffefyc9M4iI2n546y",
    "title": "R4 r4-late-after",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5526ffeQL5o1kLzuuTkaj",
    "title": "R4 r4-late-before",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a567effeXbPxNAuNS9qfpO",
    "title": "R4 r4-race",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a57b3ffeRvqwnXCfKoe412",
    "title": "R4 r4-archive",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a590dffeTY6C0Lja7z5939",
    "title": "R4 r4-before",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5a53ffeB84763GQx2FG0g",
    "title": "R4 r4-crash",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5cc7ffezcO5ATr9WYg7WL",
    "title": "R4 r4-mark",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5bb2ffewoHBx3wtX8o3Ea",
    "title": "R4 r4-mark-ci",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5dfbffe3lNmxRKRR421aL",
    "title": "R4 r4-ci",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a5f60ffev4KxVxfN4iYPAF",
    "title": "R4 r4-clear",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69a60b9ffe8l417yOJ0mmdj5",
    "title": "R4 r4-cross",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  },
  {
    "id": "ses_ea69b8f7effeYF2MCNkkCClNws",
    "title": "R4 main",
    "model": {
      "id": "none",
      "providerID": "rev4-none",
      "variant": "default"
    },
    "cost": 0,
    "tokens": {
      "input": 0,
      "output": 0,
      "reasoning": 0,
      "cache": {
        "read": 0,
        "write": 0
      }
    }
  }
]
```

## Reviewer mutants and independent protocol probes

All main mutants used a separate `git archive 9987edfa` copy. Each source was restored before the next run; dependencies were linked to the installed worktree. Baseline: **77/77** in lock, ledger and send-agent files. No author mutant list was reused.

| Reviewer mutation | Checked-in tests |
| --- | --- |
| baseline exit 0 | Tests  77 passed (77) — survives |
| probe-errors-free exit 0 | Tests  77 passed (77) — survives |
| attempt-bound-after-claim exit 0 | Tests  77 passed (77) — survives |
| settle-release-before-write exit 0 | Tests  77 passed (77) — survives |
| clear-only-drops-admitted exit 1 | Tests  1 failed | 76 passed (77) — FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > an admitted send is never reused (M-5) > M-5: a success whose clear fails, then the child exits: an equal send from this process gets a new ID |
| sweep-ignores-lock exit 1 | Tests  2 failed | 75 passed (77) — FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > m-2: the sweep removes a ledger with no live entry and an old temp file; it keeps a live, a locked and a corrupt ledger; FAIL  src/__tests__/session-manager/send-agent.test.ts > one input ID per logical send (I-5 rounds 2 to 4, B-1, M-1, B-2, B-3, M-2, M-3, M-5, m-2) > m-2: `ao session cleanup` removes an expired ledger whose lock is free, and keeps one whose lock is held |
| no-eleven-minute-hold exit 1 | Tests  2 failed | 75 passed (77) — FAIL  src/__tests__/delivery-ledger.test.ts > delivery ledger: one input ID per logical send (I-5 rounds 3 and 4) > an admitted send is never reused (M-5) > M-5: when the admitted mark fails three times, the child keeps its attempt lock: equal sends get new IDs while it runs; FAIL  src/__tests__/session-manager/send-agent.test.ts > one input ID per logical send (I-5 rounds 2 to 4, B-1, M-1, B-2, B-3, M-2, M-3, M-5, m-2) > M-5: when the `admitted` mark fails, deliver reports it, and an equal send of this process gets a new ID |
| cleanup-ignores-pending exit 1 | Tests  1 failed | 76 passed (77) — FAIL  src/__tests__/session-manager/send-agent.test.ts > one input ID per logical send (I-5 rounds 2 to 4, B-1, M-1, B-2, B-3, M-2, M-3, M-5, m-2) > m-2: a failed ledger removal at `kill --purge-session` is tried again by `ao session cleanup` |
| noncanonical-lock-name exit 0 | Tests  77 passed (77) — survives |
| all settles release the attempt before their write (additional, broader release mutant) | **2 fail / 75 pass**: the ledger three-failed-marks held-lock test and send-agent unrecorded-admission/new-ID test. |

The non-success-only release mutant is narrower than the required full-settle mutant: it leaves successful marking in its original order. Its survival does not demonstrate a production failure; input-ID/token checks still prevent its old settlement from changing a newer claim. The broader mutant above exercises admission safety.

Three required mutants survive the checked-in suite: every probe error free, attempt bound after claim, and noncanonical names. These are real coverage gaps. Independent probes of the exact current sources and those three modified sources show that each guard matters:
```text
{"variant":"baseline","ownerPid":4041600,"published":"msg_4041600","observed":{"id":"msg_4041607","reused":false},"distinct":true,"sameCanonicalName":true,"nonRefusalCountsHeld":true}
{"variant":"attempt-after-claim","ownerPid":4041614,"published":"msg_4041614","observed":{"id":"msg_4041614","reused":true},"distinct":false}
{"variant":"noncanonical","sameCanonicalName":false}
{"variant":"probe-errors-free","nonRefusalCountsHeld":false}
```
The claim-publication probe blocks the owner **after its ledger socket closes**, before begin returns; another process then begins equal text. Baseline keeps the first attempt held and gives a different ID. The late-bind mutant publishes a claim without a bound attempt lock, so the observer reuses that ID. This is a controlled scheduling barrier, not a timing margin. The alias probe compares two paths to the same existing directory; the error probe injects EMFILE into the actual exported probe. These checks should become checked-in regression tests, but the reviewed implementation passes all three.

Other independent host probes (real locks except explicitly injected error/no-answer events):
```text
{
  "afterBoundError": true,
  "staleReleasePreservesLater": true,
  "probe_ECONNREFUSED": false,
  "probe_ENOENT": false,
  "probe_EACCES": true,
  "probe_EMFILE": true,
  "probe_ECONNRESET": true,
  "probeNoAnswer": true,
  "probeNoAnswerMs": 1000,
  "canonicalSame": true,
  "aliasRefusal": "DeliveryLedgerBusyError",
  "aliasWaitMs": 2019,
  "heartbeatTicks": 194,
  "expiredAttemptHeld": true,
  "sweepExpiredWhileHeld": {
    "removed": [
      "/tmp/i5r4-ao44-20261020/probe/deliveries/ses_probe.json"
    ],
    "failed": []
  },
  "settleBusy_unknown": {
    "written": false,
    "ms": 2021,
    "attemptHeldAfter": false,
    "reused": true,
    "id": "msg_unknown"
  },
  "settleBusy_none": {
    "written": false,
    "ms": 2009,
    "attemptHeldAfter": false,
    "reused": true,
    "id": "msg_none"
  },
  "settleBusy_admitted": {
    "written": false,
    "ms": 7229,
    "attemptHeldAfter": true,
    "reused": false,
    "id": "msg_new_admitted"
  },
  "finalNames": []
}
```
A bound-server EMFILE event did not free its name or end the process; an earlier release preserved the later hold. Refusal/ENOENT were free; EACCES/EMFILE/ECONNRESET and a 1000 ms unanswered probe were held. The symlink alias saw the same lock, refused after 2019 ms, and allowed 194 event-loop heartbeats.

When non-success settlement could not acquire a busy ledger lock, finally released the attempt; after the holder ended the next attempt reused the ID for unknown and definite refusal. For admitted, three failed acquisitions consumed 7229 ms, reported unrecorded, and kept the attempt held; the next equal begin received a new ID.

Sweep/sender ordering, forced by observing an actual EADDRINUSE event in the waiting child while the sweep was inside rmSync:
```text
{
  "sweep": {
    "removed": [
      "/tmp/i5r4-ao44-20261020/sweep-wait/deliveries/ses_sweepWait.json"
    ],
    "failed": []
  },
  "senderSawHeldLock": true,
  "sender": {
    "id": "msg_afterSweep",
    "reused": false
  },
  "entries": [
    {
      "inputId": "msg_afterSweep",
      "textSha256": "11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437",
      "createdAt": "2026-10-20T13:07:55.208Z",
      "updatedAt": "2026-10-20T13:07:55.211Z",
      "state": "unknown",
      "owner": {
        "pid": 4045778,
        "token": "<scratch-id>"
      }
    }
  ]
}
```
The sender waited on the same name, then read a missing ledger as empty after sweep removal and persisted its new claim. An expired sending entry with a still-held attempt lock was also swept; this matches the explicit 10 min entry lifetime, even though the unrecorded hold lasts 11 min. Its later send has no old entry to reuse.

## Final verification and cleanup

Corrected fresh-HOME / config-free-TMPDIR core gate: **39 files, 1093 passed**, exit 0 (19.42 s). The earlier failed config-fixture rerun is explained above; no implementation change was needed. All required build/typecheck/lint/filter/full gates pass.

All 24 isolated sessions had cost 0 and all token fields 0. Twenty surviving sessions were individually read with session.get at the end (full records quoted above); four removed sessions were read immediately before their removal: `ses_ea69a5005ffeT34j175A7KN5il`, `ses_ea6955a7dfferO5MzAaNFlbX6B`, `ses_ea69a4e9cffe26oNgpw0g9Bsnd`, `ses_ea6925a7dffe8yeY0eGigAGU0V`. Final model.list was empty, and final server.info remained PID 3985807 / port 49654. No API call was made after stopping that service. No real TUI, enabled model or provider turn was used.

Exact process shutdown log (earlier crash/worker/holder/mutant/load processes were stopped and reaped in their individual cases; test children ended):

```text
STOP EXACT 4005367 opencode --session ses_ea69a60b9ffe8l417yOJ0mmdj5
STOP EXACT 4005392 opencode --session ses_ea69a5f60ffev4KxVxfN4iYPAF
STOP EXACT 4005417 opencode --session ses_ea69a5dfbffe3lNmxRKRR421aL
STOP EXACT 4005442 opencode --session ses_ea69a5cc7ffezcO5ATr9WYg7WL
STOP EXACT 4005467 opencode --session ses_ea69a5bb2ffewoHBx3wtX8o3Ea
STOP EXACT 4005492 opencode --session ses_ea69a5a53ffeB84763GQx2FG0g
STOP EXACT 4005524 opencode --session ses_ea69a590dffeTY6C0Lja7z5939
STOP EXACT 4005574 opencode --session ses_ea69a567effeXbPxNAuNS9qfpO
STOP EXACT 4005599 opencode --session ses_ea69a5526ffeQL5o1kLzuuTkaj
STOP EXACT 4006238 opencode --session ses_ea69a53dcffefyc9M4iI2n546y
STOP EXACT 4006463 opencode --session ses_ea69a5269ffe3iB3cY8MR6Lta3
STOP EXACT 4006490 opencode --session ses_ea69a513bffefjinfWiqDfdm8x
STOP EXACT 4020227 opencode --session ses_ea69a57b3ffeRvqwnXCfKoe412
STOP EXACT 4022782 opencode --session ses_ea697ca26ffeavVWBVLiEmWQ6A
STOP EXACT 4035313 opencode --session ses_ea69575a5ffehMl5yJiudJX5Dr
STOP EXACT 4036317 opencode --session ses_ea6955a7dfferO5MzAaNFlbX6B
STOP EXACT 4036563 opencode --session ses_ea6954c57ffeW6WagI7p4mj8a3
STOP EXACT 4038043 opencode --session ses_ea69a76dcffezGu300XM566AtD
STOP EXACT 4039089 opencode --session ses_ea694b95bffeNdbm4psuJ6Wnha
STOP EXACT 4050589 opencode --session ses_ea691d779ffeZBXQeL4BUj8fWc
STOP EXACT 4052984 claude
STOP EXACT 4020092 -bash
SIGKILL EXACT 4020092
STOP EXACT 4038023 -bash
SIGKILL EXACT 4038023
STOP EXACT 3985807 /home/taisung/.opencode/bin/opencode serve --service
OWN PROCESSES []
PROTECTED ALIVE {"15920": true, "19579": true, "19624": true, "19636": true, "19653": true, "19689": true}
LIFECYCLE PID FILES []
```

The private tmux server exited after its last pane ended. Its PID and isolated service PID are absent from /proc, and its exact private socket file was removed after verifying server exit. Protected service and five protected workers remain alive. No detached scratch lifecycle worker was started.

Final process scan: `ps -o pid,args -u "$(id -u)"`, with scratch command/environment matches and the inspection process/ancestors excluded: **[]**. Independent /proc scratch-environment scan: **[]**.

Final lock scans:

```sh
grep -E 'ao-delivery-' /proc/net/unix
ss -xlp | grep -E 'ao-delivery-'
```

Both outputs are empty. All test/live names were derived from scratch paths. No name remains.

`ls -la --time-style=full-iso ~/.ao/bin` BEFORE:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command AFTER:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Listing comparison and SHA-256 comparison of every file both pass. `/tmp/ao-opencode-launch-44402` contains only `.` and `..` at start and end (directory mtime Oct 16 14:01); no review entry was created.

Required final real-state scans:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/i5r4-ao44-20261020-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-41
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.log
```

These are external changes, not reviewer writes. Real lifecycle log mtime 08:57:50 records ao-41 working→stuck (correlation `lifecycle-transition-1cb4c998-2604-41d8-9077-a00944dd633e`). The sessions/archive directory changes at 09:11:52–53 correspond to new external `ao-42_2026-10-20T13-11-52-893Z` and `ao-43_2026-10-20T13-11-53-378Z` archive records. ao-41 metadata changed externally at 09:11:51. The review's executable calls used env -i and fake HOME/state; no real-session command or real-state write was performed.

```sh
find ~/.agent-orchestrator -path '*deliveries*'
```

Output: **empty**. No ledger was created in real state.

Scratch removal: both exact directories `/tmp/i5r4-ao44-20261020` and `/tmp/i5r4-ao44-20261020-gates`, the marker and the private tmux socket are removed after process shutdown. Final absence is verified below. The reviewer worktree has no tracked source diff and no commit. Requested deliverables are the uncommitted review and overwritten `.agent_report.md`; dispatch `.agent_task.md` is retained.

Verified after removal: scratch root absent; sibling gate TMPDIR absent; marker absent; private tmux socket absent. Own processes **[]**; delivery names **[]**.
