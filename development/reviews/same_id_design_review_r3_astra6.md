# Same-ID design r3 — re-check by ao-51

Completed review, 2026-10-21, source c8a35d4744b5d643df64e2abb1c2aed6237cacc6. The round-3 brief was read in full. Scope: closure of round-2 findings and changed/new design only; prior unchanged results remain in force. R2a implementation is outside this review. OD-17(b), stable tmux names with guarded launch tokens, is decided.

## Verdicts and dependencies

R4: SOUND

RW: NOT-SOUND

R2b-1: NOT-SOUND

R2b-2: SOUND-WITH-CHANGES

R3a: NOT-SOUND

R3b: NOT-SOUND

RH: SOUND-WITH-CHANGES

Counts: **4 blockers, 4 majors, 1 minor**. These are design verdicts, not implementation approvals. R2b-2 assumes the corrected prerequisites and needs M-2 resolved and a settled OD-18 policy. RH is optional and needs M-4; retaining H-a is already sound. R2a is not re-reviewed or assigned a new verdict here.


## Evidence log

- Created /tmp/aosdr3-marker before investigation. Scratch /tmp/aosdr3 was absent. Saved initial listings of ~/.ao/bin and ~/.config/herdr; no real service/config/state mutations are authorized or attempted.
- Node, package-manager, helper and test processes use env -i, fake HOME and scratch PATH. gh is offline; tmux shim selects only aosdr3-test. No agent executable is on PATH. Author scratch /tmp/aosd3 is read-only. No AO command, push, PR or commit.
- Read the required R2a brief as context, without adopting its implementation instructions. Read the r3 design and scripts before execution; deferred the author's report until the independent closure and token-guard assessment.

### Findings recorded during the re-check

**B-1 (RW, rollout): the prescribed old-writer drain misses a sourced helper.** Design §5.6, lines 553–567, says the helper lasts milliseconds and drains command lines containing `ao-metadata-helper.sh`. In `packages/core/src/agent-workspace-hooks.ts:418`, `GH_WRAPPER` sources that file, then waits for the real gh pipeline at line 430, then invokes the already loaded function at lines 436–437. Its command line names `gh`, not the helper. A slow PR creation can survive the file replacement and the specified empty-process check, then run the old sed/mv writer concurrently with new record writers. Replacing files and raising an epoch do not change that function in memory. Drain the wrapper/hook invocations and their descendants, including sourced functions, while admission is fenced; verify exact process trees, not the helper filename. The deterministic scratch reproduction and its output are preserved below.

**B-2 (R3a): process-group membership is a limitation, not an enforced descendant contract.** Design §5.2, lines 449–488; current hook executor `packages/plugins/workspace-worktree/src/index.ts:343,386–391`. The proposed supervisor protects members of the initial process group and expressly excludes `setsid`/daemons. A normal detached subprocess can leave that group, mutate the worktree later, and survive both group termination and journal recovery. A dead original group makes its journal stale even while the escaped descendant runs. The descriptor problem is removed, and the non-escaping grandchild is covered, but round-2 B-3 is only partly closed. Either contain all mutating descendants (for example a suitably controlled cgroup/scope), or obtain an explicit owner decision narrowing the guarantee to trusted non-daemonizing commands and stop calling that contract enforced. This is separate from remote API requests, whose completion still needs quarantine.

**B-3 (R3b): the store chosen for the lock is not bound to the API request.** Design §6, lines 590–627, resolves a service peer and its store, then launches a separate environment-selected `opencode api` child. The existing transport (`packages/core/src/opencode-api.ts`, `sessionChildEnvironment` at :201 and `callOpenCodeApi` at :285–301) selects the service independently for each child. No request connection is pinned to the inspected peer/store, unlike the explicit second-connection check proposed for Herdr. A service selection change between resolution and dispatch can lock/quarantine store A and mutate store B without checking B's holders. The shared namespace fixes the cross-project location problem only when the operation demonstrably reaches that same store. The protocol stand-in below demonstrates this invariant failure; it does not claim that a real OpenCode service was run.

### Independent closure assessment (before reading the author's report)

| Round-2 finding | State in r3 | Reason |
| --- | --- | --- |
| B-1, reusable launch names and unchecked mutations | Partly closed overall; token-aware protocol closed | Stable name plus an independent 128-bit token checked in each mutation branch; full server incarnation for positive reads. My t1–t3 reruns kept full-name replacements and rebound-server replacements. B-4 below shows the staged legacy exception can still attack a new token launch. This is protocol closure, not implemented code or full deployment closure. |
| B-2, Herdr check then positional close | Closed under H-a; partly closed in optional H-b | H-a performs no close. Real isolated h3 verified the peer-bound close and refusal across restart. H-b still needs a complete result/error/absence contract and stronger tests; see below. |
| B-3, child lifetime beyond lock | Partly closed | No lock descriptor inheritance; ordinary same-group grandchild terminated; write-ahead journal protects surviving groups after supervisor death. An escaped process survives and its journal is treated as stale (new B-2). |
| B-4, project-scoped holders/quarantine | Partly closed | A store-wide namespace fixes discovery across configurations using a stable identified store. It does not bind the subsequent environment-selected API child to that store (new B-3), and reconciliation has unresolved states. |
| B-5, old shell writers during rollout | Not closed | New writers stop replacing records, but the proposed drain misses the already sourced wrapper. Actual old helper reproduction reverted `runtimeHandle=new, generation=2` to `old,1` after file replacement. |
| M-1, inaccurate tmux parser oracle | Closed for measured forms | Quoted nested formats, missing-target fallback, branch current-target behavior, and outer-list continuation after branch failure now match private tmux 3.4. An unsupported nested operator really is truthy; the positive and negative capability gates are necessary. |
| M-2, suffix breaks host lookup | Closed | OD-17(b) retains stable host-visible names. Other sockets remain an existing visibility limit addressed by `where`. |
| M-3, association routing and retire ordering | Partly closed | One effective identity resolver includes every consumer; malformed data refuses; minimal inventory lands with retire. Failed association publication leaves an unassociated token without a defined recovery action. |
| m-1, malformed successful git output | Closed in specification | §4 permits true only for successful literal `true`, and distinguishes explicit absence from errors. The three newly promised cases are not tests added in this revision; they remain implementation acceptance work. |

Own t1 run: production create race 118 consistent, 82 duplicate-name refusals, 0 lost, 0 mismatched; wait-point control 0 consistent, 93 duplicates, 82 lost, 25 mismatched (200 attempts each). Own kill produced `ao-server`, `ao-done`, `ao-end`; replacement produced `ao-kept`; unsupported form produced `ao-refused`; failed mutation produced no done marker, an end marker and exit 1. Missing top-level target stopped before the guard. A branch without `-t =N:` ran on current M, while the explicitly targeted branch ran on N. Ungated unknown nested operator killed a wrong-token control; the gated production form refused. Literal paste content reached only the own pane. The t1 attach prototype alone returned 0 on a wrong token (it lacks the production false-branch error); t3 verified the §2.7 suffix gives exit 1. Tests must use that completed attach form.

Own real Herdr h3 run (0.8.0, protocol 19): one request per connection; two pings in one write produced one pong then reset. Same-peer own-terminal close succeeded; wrong terminal closed nothing. Server A PID 1145733, ticks 10505178; restart B PID 1146162, ticks 10505597; the second connection was refused and the restored pane remained with a new terminal. Last-pane close also removed its workspace. SO_PEERCRED and the Node fd/inode/ss lookup identified the same process. Inspected the author's scripts and recorded isolation first. My copy used a byte copy of the binary, fake HOME/all XDG directories, private sockets, update checks disabled, and strace. Before either server's first client request: no prohibited successful path access, no AF_INET connection, both sockets under my scratch root. Final full-trace audit and real-directory comparison follow in the safety appendix.

Own supervisor protocol (not production implementation): same-group leader 1158660 / grandchild 1158673, group empty after termination, no late mutation; detached grandchild 1159093 left leader 1159092's group, group reported empty and journal was removed, then late mutation occurred. Both were reaped by this test's subreaper. A separate killed supervisor left a journal and live child group, correctly classified busy. Retaining a descriptor cannot hold the proposed AO lock because that descriptor is never passed; retaining an unrelated inherited descriptor changes none of the escaped-child result.

### Additional new findings

**M-1 (RW): inbox lifetime is not specified around publication, archive, or backlog.** Design §5.6, lines 544–555, publishes `launchId` only with `runtimeHandle`. Today the pane starts in `session-manager.ts:2111` before the launched record is published at `:2165`. A fast hook can append its new launch ID while a lifecycle applier still sees the reservation without that ID: the specified applier logs/skips the entry and advances `inboxOffset`; the later publish cannot recover it. Conversely, during that reservation window an empty-launch entry from an older legacy pane matches a new record that does not yet have launchId. My literal protocol reproduction consumed all 79 bytes and published the handle with no PR. Reserve and publish the launch ID before any writer can start, or retain entries whose launch is still preparing under an explicit state machine. Also specify bounded processing/backpressure, rotation with an inode/generation cursor, the disposition of an incomplete abandoned line, and archive/retire/restore cursor ownership. A writer dying midway through a line can make the next complete writer's line part of one malformed record; “skip malformed” then discards a valid update too. With no applier, the current design grows without bound. With archive after the last drain, late entries have no active applier and no defined archived destination; a restore can consume them as stale and permanently lose the metadata. These are not resolved by `O_APPEND`. Require bounded byte length, proper JSON escaping (including quotes allowed in branch names), and verification that the shell emits one complete record per append write. An empty-launch legacy line must never be allowed to attach to a new launch. Finally, §5.7's worker admission rule must explicitly cover `applyInbox` and all record/status maintenance, not only lifecycle reactions: the poll is no longer read-only while applying entries. Tests must fence these writes on a newer epoch as well.

**M-2 (R2b-2): failed association has no supported recovery transition.** Design §2.9, lines 276–316, safely places the tmux token before its record, but on a generation conflict or crash leaves `token present, not associated`. Every subsequent association CAS requires an empty token. An audit can diagnose this state but cannot complete or safely undo it. A legacy-unproven inventory entry's only action is “associate first”, yet the described associate command requires an active record: a retired legacy entry also lacks a specified path to a guarded stop. My t3 confirmed present-token CAS refusal. A PR/status write is enough to make the record CAS fail before R3a, so this is a normal retry case, not only corruption. Add a durable association intent, or a fresh owner-approved evidence operation that can adopt/clear exactly the already installed token after checking the full current identity and record state. Define association of retained legacy entries too. Include the audited `$N`/server identity in the CAS evidence or explicitly refuse when any component changed; current CAS compares only name, pane PID, and empty token, with process ticks checked outside it. Normal pane replacement changes PID and is refused; the evidence hash alone is not an atomic check of every field. No unguarded cleanup of a stranded token is acceptable.

**M-3 (R3b): holder and quarantine reconciliation stops valid cleanup indefinitely.** Design §6, lines 610–632, has three missing transitions. (1) Step 2 treats the own record with the same S and launch identity as a live holder and refuses removal; its own-record exception applies only to reuse. Current purge runs before archive (`session-manager.ts:2941–3007`), so its own durable hold always matches. It needs an explicit own-holder release/retirement protocol after the runtime is proven stopped, while retaining the hold across uncertain stop and interrupted removal. (2) Step 1 refuses every present quarantine, while step 4 says a later remover retries and clears it: that retry is unreachable under the literal rules. Define a serialized reconciliation action and the authoritative terminal conditions, including interrupt requests; never merely expire it. (3) A hold whose record still names S but has a different launch identity is neither the defined live case nor the stale case. It must conservatively block until reconciled, especially across a crash between record publication and index updates. Backfill must establish coverage of every participating state root before admitting removals; the fallback configuration scan does not cover an omitted configuration. My two-process stand-in confirmed shared-namespace holders/quarantine work for a fixed store, and the literal own-holder and existing-quarantine predicates refuse the corresponding valid retries. No real OpenCode API was run.

**M-4 (RH): the successful-close experiment is not a complete stop-outcome protocol.** Design §3.3, lines 388–397, gives a sound same-process check/close mechanism for the measured Herdr release. It does not define the result of initial `pane.get` errors or bind negative evidence to the recorded launch's originating server. In h3's `bound_close` (design §15, copied script line 167), **any** error is labelled “absent on this server run”; the third peer is printed but not checked. An unavailable/malformed error must be unknown; only explicit pane-not-found is negative evidence, and a negative on a different endpoint is not proof that an older hidden server stopped. H-b explicitly excludes same-uid socket renames, so that exclusion must be an owner-accepted limit, not silently treated as universal absence. Prefer recording creation-server incarnation and applying the same negative-proof rule as tmux. Check connection 3's peer, parse every envelope, handle peer lookup failure/PID reuse, and pin or qualify Herdr versions with the non-reuse invariant. The real h3 success/restart experiment supports the mechanism, not all of these outcomes. RH tests need a socket transport stand-in and healthy-close assertions; old execFile mocks will not observe a new socket implementation. H-a remains safe and is the recommendation meanwhile.

**m-1 (tests): two new explicit `any[]` types violate the project rule.** `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r3.test.ts:30` and `:37` use `any[]` in the mock adapters. Use `unknown[]` or the function's actual parameter tuple. This is new test code, unrelated to the runtime design's safety verdict.

The author's report was read after the independent closure table and t1–t3 assessment above. It does not change these findings. Its full-suite green totals are expected-failure-mode results; they do not mean the safety defects are fixed. No source implementation was changed by this revision or by this review.

**B-4 (R2b-1, intermediate rollout): a legacy caller can still destroy a new token launch.** Design §2.5 lines 191–198 and §7 lines 663–669 deliberately retain legacy kill-by-name until R2b-2, while claiming new launches are guarded from R2b-1 onward. The target does not enforce that distinction: an admitted legacy operation can hold the old handle, another operation can replace it with a token launch of the same stable name, and the first operation's retained `kill-session -t =<base>` kills the new launch. R3a's operation lock has not landed. R2a's record check runs before the asynchronous runtime stop, not atomically with tmux; an epoch is identical for both operations. Relevant source: `packages/core/src/session-manager.ts:2897–2905`, `packages/plugins/runtime-tmux/src/index.ts` `destroy` at :173–175 (name-only kill). My private `aosdr3-mix` run measured legacy admission exit 0, replacement token `0123456789abcdef0123456789abcdef`, legacy kill exit 0, new token launch absent. This is a protocol reproduction of the explicitly retained legacy path, not a claim that an r3 implementation exists. The new tests all create their handles using one implementation and miss the mixed legacy/new boundary.

Move the legacy destructive refusal into R2b-1, combine R2b-1/2, or atomically forbid *every* legacy mutation when the target has a token. A separate preflight read is insufficient. Apply the same protection to the deliberate OD-18 legacy-send exception; it must not let a stale legacy caller clear/type into a newly tokenized target. Preserve the owner-visible legacy residual only for a demonstrably tokenless target. This changes the round-2 B-1 closure assessment: the token-aware protocol is fixed, but mixed-fleet deployment is only partly closed. R2b-1 cannot claim safety as a standalone intermediate release in its present form.

## Fleet and dependency assessment

### Fleet behavior and round order

With the assertion OFF after R2b-2, a positive legacy probe displays `alive (legacy: server not proven)` and does not rewrite its status; negative or failed probes display `unknown (legacy)` and cannot advance the lifecycle's death confirmation. A legacy kill/cleanup/restore refuses; a visible candidate outside the creation-time tolerance yields `other-launch`, which R2a callers must also retain. Cleanup can report the refusal but cannot archive or remove its workspace. Associated records use the same token/socket/incarnation resolver as new records, everywhere including agents and CLI fallbacks. Malformed association/handle data is unknown, never unmanaged default-server send. The proposed OD-18(a) alone keeps legacy sends going to the visible exact basename with a notice, accepting that the visible legacy session may be the wrong one. This is an explicit exception, not evidence of provenance. My preferred default is (b) until association; if the owner chooses (a), the atomic no-token condition in B-4 is required. `where` exit 0 means the *recorded server* runs, not that the recorded token/pane still exists; tools must not equate that exit status with launch liveness.

`associate` safely rejects the ordinary pane-replacement case (changed pane PID or pre-existing token); full evidence must be revalidated, and M-2 needs a recoverable two-resource transition. Publishing the retained inventory before archive, fsyncing it, and refusing archive on failure is correct. The inventory/record duplicate after a crash is intentionally visible and retryable. A legacy-unproven retired entry must have an actual supported association path; “associate first” alone is not one. `stop-retained` deletes an entry only on destroyed/absent; other-launch/unknown keeps the evidence.

| Deployment | Independent assessment of what can land and be claimed |
| --- | --- |
| R2a live | Retain its accepted scope and pending implementation review. No claim here that legacy name-only kills are identity-safe. |
| R4 | Can land after R2a. Add the specified malformed-success/EACCES/I/O tests; the strict read contract is now sound. |
| RW | Must precede publication of association and other new identities on the live fleet. Fix B-1 and M-1 first. The barrier must drain sourced old wrappers as well as AO trees and scripts. Epoch checks must cover all writes, including inbox application. |
| R2b-1 | Token-aware creation/stop/send/attach are supported by measurement, but the intermediate mixed-fleet claim fails B-4. Move the no-token guard/refusal for legacy mutations into this round or combine it with R2b-2. Do not wait for R3a to protect new token launches from legacy callers. |
| R2b-2 | Resolver, owner audit, minimal retained inventory, `where`, association and safe legacy disposition belong together. Add association retry/recovery before deploying it; don't defer inventory to R3a. No operation-lock guarantee yet. |
| R3a | Fixed lock order and journal-before-go are useful. Resolve B-2 or explicitly narrow the guarantee through an owner decision; one process group does not contain all descendants. Backfill `.ao-owner` markers while admission is closed. |
| R3b | Must follow corrected R3a and R4. Pin request/store selection (B-3), define M-3 recovery, and finish all participating-root backfills before enabling removals. Unknown store or unproven index coverage must keep resources. |
| RH | Keep optional after H-a. Same-peer close is promising for qualified Herdr versions; add M-4 outcomes and socket-level tests before enabling it. |

The order R4 → RW → corrected R2b-1 → R2b-2 → corrected R3a → corrected R3b → optional RH is reasonable. The current claim that every round is safe alone is false. Rollout must also keep an old installer from rewriting wrappers after installation; stop old resident workers, enumerate/drain their actual process trees, and reopen admission only after exact checks. No real workers were stopped in this review.

### Lock and child conclusions

The revised token release invalidates synchronously and counts nested work, which prevents post-release reuse. Fixed acquisition order `operation → opencode-session → record` avoids cycles only if code never acquires another session's operation lock while holding the store lock, never reacquires its own operation lock instead of forwarding the token, and never awaits asynchronous work while holding the synchronous record lock. Check those rules across cleanup, recovery and plugin entry points. The 30-second waiter bound and try-once lifecycle behavior prevent an unbounded waiter; they do not justify stealing a live holder.

The new journal is written before the child can execute, and a supervisor crash while its recorded group remains makes the next same-ID operation refuse. That is sound for group members. The next operation must strictly validate each journal entry; unreadable/malformed cannot mean stale. PGID reuse after a group has emptied can cause a conservative false-busy state unless recovery uses the recorded incarnation evidence; it must never signal a newly reused group from stale metadata. A zombie-only group can also keep `kill(-pgid,0)` positive; specify reaping and diagnostics rather than equating every positive probe with a mutating process. A stuck child can leave the ID busy for a long time, but under the new design it cannot retain the AO lock descriptor. My separate detached-daemon control retained FD 3, wrote `still open`, and remained live while the AO-owned socket closed and a second lock listener acquired successfully; that daemon was then killed by its exact PID. This supports removal of descriptor inheritance, not containment of daemon mutations.

The `.ao-owner` policy is a defensible replacement for a cross-owner path lock if every create/remove/restore resolves the *actual* project worktree directory canonically and checks its marker. In the default layout, each session ID has a distinct basename and one owner gives one operation-lock namespace. Require the layout/ownership checks also on restored paths and direct plugin entry points; a marker in a configured directory is not proof about an arbitrary path. `O_EXCL` must be paired with strict handling of partial/unreadable markers. Foreign markers refuse; rollback retains its independent path-ownership test. No new counterexample was established for this policy under those constraints.

## Owner decisions

| Decision | Recommendation | Reason |
| --- | --- | --- |
| OD-2 identity storage | Agree (a) | Complete immutable token, socket and server incarnation at create; no later repair from an untrusted replacement. |
| OD-3 old records | Agree modified (a), with M-2 | Default-off host assertion, explicit association; positive legacy status is labelled unproven and negative is unknown. Recover failed association publication. |
| OD-4 hidden socket | Agree (a) | Unknown while the recorded server may still live; recovery hint only when the path is not occupied by another server. |
| OD-5 kill when hidden | Agree (a) | Keep workspace/record until verified stop or absence; R2a implementation remains separately reviewed. |
| OD-6 mechanism | Agree (d) with OD-17(b) | Token comparison inside each tmux mutation works on measured 3.4. Close the mixed legacy path in B-4. |
| OD-7 waiting | Agree (a) | Bounded monotonic waiter, lifecycle try-once, no age-based stealing; report owner/child diagnostics. |
| OD-8 OpenCode reuse | Agree (c), conditional on B-3/M-3 | Shared holders/quarantine and strict reads; bind the actual request to that namespace and define reconciliation. |
| OD-9 kept runtimes | Agree (c) | Durable inventory before the active record is lost, starting with retire's first release. |
| OD-10 rollback | Agree (a) for verified own, (b) for unknown/legacy | A stopped runtime does not establish path ownership; retain ownOrGone and conditional record release. |
| OD-11 order | Accept revised order with B-4 move | R4 after R2a matches the owner; RW before new identity writers; legacy protection must accompany token launch creation. |
| OD-12 unreadable archive at spawn | Agree (a) | Refuse ambiguous reuse/allocation rather than treating failed reads as absence. |
| OD-13 admission/writers | Agree (b), with B-1/M-1 | Barrier plus monotonic epoch; drain sourced wrapper invocations and children; fence every mutation. `.ao-owner` is acceptable with actual-path enforcement. |
| OD-14 child/request lifetime | Choose (c) with real containment, e.g. qualified scope/cgroup; do not accept current process-group closure claim | `setsid` escapes the journal's group. If the owner deliberately permits only audited non-daemonizing hooks instead, record the narrower guarantee and unsupported commands explicitly. Remote requests still need quarantine. |
| OD-15 platform/tmux versions | Agree (a) | Refuse unqualified platform/version; qualify actual production forms with healthy, refusal and race controls. The initial measured tmux version is 3.4. |
| OD-16 legacy disposition | Agree (b), with M-2 | Owner audit/associate/retire, never automatic retirement; provide a recovery path for stranded token and retained legacy entries. |
| OD-17 tmux identity | Decided (b) | Stable name plus token guard. Do not reopen the owner's decision. |
| OD-18 legacy send | Prefer (b) until associated; (a) only as explicit residual plus atomic token-absence guard | Association tools now ship with the policy, allowing batch migration before reopening admission. Unguarded compatibility sends can reach a replacement, including a new token launch. |
| OD-19 Herdr close | Agree (a) now, pursue H-c; H-b optional after M-4 | Unknown closes nothing. Real peer-bound close works across restart, but needs outcome/negative-evidence rules and transport tests. |
| OD-20 shell writers | Agree (a), after B-1/M-1 | Inbox avoids record overwrite and Node startup per wrapper call. Its launch publication, cursor, archive and backlog lifecycle must be defined. |
| OD-21 OpenCode namespace | Agree (a), after B-3/M-3 | The index belongs to the canonical store shared by both configurations; identification alone is insufficient without request binding and complete backfill. |

## Tests and falsification coverage

`pnpm install --frozen-lockfile` and `pnpm build` completed successfully in this worktree under the scratch environment before tests. Ran each package's local `./node_modules/.bin/vitest run` with `SAME_ID_DEFECTS=red`, JSON reporting, fake HOME, scratch TMPDIR, offline gh, private tmux shim, and no AO_* or agent executable on PATH. Core/worktree ran their r3 file; tmux/Herdr each ran both r2 and r3 files. All four invocations exited 1 because the selected defects remain present.

| File alias | Exact path | Failed / passed |
| --- | --- | --- |
| T3 | `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r3.test.ts` | 5 / 13 |
| H3 | `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r3.test.ts` | 3 / 1 |
| W3 | `packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts` | 1 / 1 |
| C3 | `packages/core/src/__tests__/same-id-defects-r3.test.ts` | 2 / 2 |
| T2 | `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts` | 7 / 14 |
| H2 | `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts` | 3 / 4 |

Total: **56 tests, 21 failed, 35 passed**. The new r3 files account for exactly **11 failed reproducers and 17 passing controls**. Every failure was the claimed assertion, not a build/import/setup error. T3 observed replacement deletion, stale-positive liveness, text/Enter delivery to replacements and deletion after socket rebound. H3 observed the restored terminal closed, a sibling terminal closed and an unknown terminal closed. W3 observed the surviving grandchild. C3 observed cross-project remove and runtimeHandle reverting to old. The changed r2 files retained all ten prior defect failures, including unknown Herdr envelopes being treated as absent.

### Each failed test that a wrong or partial fix can also turn green

A defect test is a necessary regression check, not a proof. The following names are exact. Healthy controls rule out some blanket no-op fixes but do not close the races listed.

| File | Test name | Wrong/partial fix that passes this case |
| --- | --- | --- |
| T2 | destroy of the first launch keeps a replacement of the ID that started in the same second | A client-side PID/session-ID preflight can pass these replacements without an atomic guard; it still races between the preflight and name-only kill. |
| T2 | isAlive of the first launch answers false while a same-second replacement of the ID runs | Compare PID/session ID before returning, without raw ticks/boot ID, can pass these particular replacements; it does not prove full incarnation checking. |
| T2 | after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID | A client-side PID/session-ID preflight can pass these replacements without an atomic guard; it still races between the preflight and name-only kill. |
| T2 | after a same-second restart of the server, isAlive of the old launch answers false | Compare PID/session ID before returning, without raw ticks/boot ID, can pass these particular replacements; it does not prove full incarnation checking. |
| T2 | create: a replacement of the ID made directly after the create command never receives the first launch's keys | Read identity just before typing can pass this forced post-create replacement, yet a replacement between that read and keys still wins. |
| T2 | isAlive rejects while another server answers at the recorded socket and the recorded server process still runs | Reject every rebound can pass; full boot/ticks/incarnation and safe mutations are not exercised by this assertion. |
| T2 | isAlive answers false when no server answers at the recorded socket and the recorded server process has ended | Convert all no-server failures to false passes this case but is wrong when the recorded process still lives behind a hidden socket. |
| T3 | destroy of an ended launch keeps a later launch of the same name | A separate stale-session preflight passes this static replacement; an unguarded later mutation or legacy handle can still kill a new launch. Always-no-op is caught by the own-destroy control. |
| T3 | isAlive of an ended launch answers false while a later launch of the same name runs | A session-counter or creation-time-only comparison can pass this particular replacement while failing server reincarnation/stale ticks; false-for-all is caught by the healthy control. |
| T3 | sendMessage to an ended launch gives a later launch of the same name no keys | Refuse every send to an already stale handle, or preflight once, passes; a later swap, unguarded C-u or the mixed legacy path remains untested. |
| T3 | a later launch that replaces the session between the commands of one sendMessage gets no keys | A fresh client-side preflight before each send step can pass this chosen schedule yet race between its own check and mutation. No test here forces that inner gap. |
| T3 | destroy of a launch whose server no longer answers at its socket keeps the session of the server that answers there now | A separate server/PID preflight passes this fixed rebound; mutation after the preflight or stale legacy calls can still hit the replacement. |
| H2 | isAlive rejects when herdr answers an error envelope that is not 'pane not found' | Reject all probe results passes this one; healthy/explicit-absence controls reject that blanket fix, but incomplete error classification can still pass the two selected errors. |
| H2 | isAlive rejects when herdr answers a reply without a pane | Reject all probe results passes this one; healthy/explicit-absence controls reject that blanket fix, but incomplete error classification can still pass the two selected errors. |
| H2 | destroy does not close the workspace or pane when the pane ID now names another terminal | A separate terminal preflight and positional close passes this pre-existing-mismatch case; restart between them remains unsafe. H-a refusal also passes intentionally. |
| H3 | destroy keeps the restored pane when the server restarts between the terminal check and the close | Always refuse/no-op passes (intentionally acceptable for H-a). A socket implementation bypassing the execFile mock can also leave its counter untouched; RH needs transport assertions. |
| H3 | destroy closes no pane of the workspace other than the recorded pane | Pane-only unconditional close passes this test despite unchecked terminal/restart; always refuse also passes. |
| H3 | destroy closes nothing for a record that has no terminal ID | Reject only a missing terminal ID passes this test despite unsafe close for every nonempty terminal; always refuse also passes. |
| W3 | when postCreate returns, a grandchild that dropped the inherited descriptors no longer runs | Kill the original group, or just wait for this 8-second child to finish: both pass without crash recovery, setsid containment, cancellation or operation-lock serialization. |
| C3 | cleanup of one project keeps an OpenCode session that a live session of another project names | Scanning only the loaded configuration passes; another configuration on the same store, request-store changes, quarantine and concurrent claims remain untested. |
| C3 | a helper write that copied the record before a Node write keeps the Node write's runtimeHandle | An atomic append-only writer passes even if its applier drops early/archived entries or the rollout misses an already sourced old wrapper; this test has no rollout. |

### Changed oracles and controls

The tmux correction in `0be91637` is justified: it removes the false blanket rejection of quoted nested formats, models the missing-target fallback/current-session branch target, and returns nonzero after branch failure while preserving outer-list output. None of the seven r2 defect assertions was weakened. The eight added oracle controls are:

- `control: the create command sets the token on the session that it made`
- `control: the own token gives the mutation, its marker and the end marker`
- `control: another launch with the same name and another token gives no mutation`
- `control: an absent session stops the list at has-session`
- `control: an operator that tmux does not know gives the refusal, also for the own token`
- `control: a failing mutation gives no done marker, the end marker and exit 1`
- `control: an unquoted format in a branch is a syntax error; a quoted one expands`
- `control: a branch command without -t uses the current session, not the if-shell target`

All eight pass on the stand-in, and the corresponding forms pass on real tmux in T3/t1–t3. These tests call a locally copied `guardArgs` form, not production stop/send/attach: any production bug can coexist with green oracle controls. Their purpose is to validate the stand-in and parser assumptions. The other real-tmux oracle controls—`if-shell -t with a missing target runs on another session (why has-session comes first)`, `a format in a branch string must be double-quoted`, and `an unknown operator is FALSE over literal text and TRUE over a nested format`—likewise establish platform behavior, not production coverage. Version qualification should eventually execute the actual exported production command builder and all guarded mutation types.

The Herdr correction changes the old healthy control to `control: destroy closes the recorded pane while it has the recorded terminal`, accepting a pane close **or** a workspace close. That deliberately relaxes an obsolete implementation-specific requirement; it does not weaken the stale-terminal defect assertion. It still lets a workspace-close implementation pass the healthy control, so H3's sibling test is necessary. Under H-a, replace it with an assertion of unknown/refusal **and zero close requests**, as §13.7 specifies. Under RH, restore a positive own-terminal close assertion and move all close tests to the socket transport; otherwise always-refuse or a bypassed mock can look green. `control: destroy of a pane that is gone closes no other pane` also permits blanket refusal by itself.

C3's `control: the helper alone writes its key and keeps the other keys` must become writer → `applyInbox` → record, as the design recognizes. Also test no-applier visibility, early publication, archive, and cursor replay. Retaining the old immediate-write expectation would reject the intended inbox implementation. `control: another project that names another OpenCode session does not stop the cleanup` catches blanket removal refusal, but cannot validate cross-configuration store selection; keep it with a known-store mock and add the bound-transport case. W3's `control: a hook whose processes end before it exits runs and its write stays` prevents disabling hooks entirely but does not exercise supervision or lock lifetime.

Remaining required acceptance cases include mixed legacy/new mutations (B-4); real create read-back failure and unavailable /proc; stale boot/ticks positive liveness; actual attach exit semantics; every agent and raw CLI path on the recorded socket; association record-CAS failure followed by recovery; inbox/epoch races; actual two-process locks and token release; detached/double-fork/descriptor-retaining descendants; supervisor death at each journal/go boundary; cross-configuration holders with an environment-selected service change; own-holder removal and quarantine reconciliation; malformed index entries; and Herdr errors/restarts on all three connections. These belong to the named implementing rounds, not another claim that expected-failure-mode totals are a safety proof.

## What is correct

- Stable names preserve the host lookup contract; the measured nested token/capability guard safely handles own launch, mismatch, missing target and command failure on tmux 3.4. Explicit targets inside branches are essential and correctly specified.
- Create/read-back occurs in one non-waiting command list. The adversarial wait-point control demonstrates why that restriction matters; measurements support the chosen production form without claiming a proof from 200 samples.
- H-a closes nothing and is the right present default. The measured Herdr same-peer close is a useful optional mechanism, with narrower claims than a full stop-outcome protocol.
- R4's literal-success and explicit-absence split closes the remaining malformed-git-answer issue in the specification.
- Inventory-before-archive, strict malformed-state handling, monotonic epoch raises, token invalidation before release, journal-before-go, and store-wide holder/quarantine placement are the right foundations. The findings identify missing transitions and boundaries, not a reason to discard those pieces.

## Reproduction record

This review changed no production or test source. The scripts below are protocol/source experiments, not implementations submitted for merge. The tmux t1/t2/t3 and Herdr h3/h4 source is already preserved in design r3 §15. I copied those files into `/tmp/aosdr3/scripts`, replaced every `aosd3` path/server label with `aosdr3`, and changed `nodebin` to `bin`. The Herdr copy additionally sets XDG_CACHE_HOME, uses a copied binary, runs from `/tmp/aosdr3`, and compares the explicitly named real Herdr directory; this avoids expanding `~` against a fake HOME and mistakenly comparing two empty listings. Startup and full-run trace audits covered the whole private server lifetime.

Commands for the copied scripts used this environment (Herdr additionally used fake values for **all** XDG directories):

```bash
env -i HOME=/tmp/aosdr3/home \
  PATH=/tmp/aosdr3/bin:/usr/bin:/bin LANG=C.UTF-8 \
  TMPDIR=/tmp/aosdr3/tmp SHELL=/bin/sh TERM=xterm \
  node /tmp/aosdr3/scripts/t1_token_guard.mjs
# Repeat for t2_branch_target.mjs and t3_probe_assoc_attach.mjs.
# Every tmux call names only private aosdr3-* or scratch -S servers.
```

The snippets below preserve the independent new reproducers before scratch removal. Their checkout import path may be changed to the reviewer's own built checkout. Helper `gh` is a local deterministic shell stub, not the real service. The store servers speak only the small stand-in protocol shown; no OpenCode executable or API is involved.

### RW: a sourced helper survives replacement; early inbox application

```js
import {GH_WRAPPER, AO_METADATA_HELPER} from '/home/taisung/.worktrees/agent-orchestrator/ao-51/packages/core/dist/agent-workspace-hooks.js';
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosdr3/rw';
for (const d of ['bin','real','sessions','home'])mkdirSync(`${root}/${d}`,{recursive:true});
const record=`${root}/sessions/app-1`;
writeFileSync(record,'runtimeHandle=old\ngeneration=1\n');
writeFileSync(`${root}/bin/gh`,GH_WRAPPER,{mode:0o755});
writeFileSync(`${root}/bin/ao-metadata-helper.sh`,AO_METADATA_HELPER);
writeFileSync(`${root}/real/gh`, `#!/bin/bash\ntouch '${root}/loaded'\nwhile [ ! -e '${root}/release-gh' ]; do sleep 0.02; done\nprintf 'https://github.com/org/app/pull/7\\n'\n`,{mode:0o755});
writeFileSync(`${root}/bin/mv`, `#!/bin/bash\ntouch '${root}/copied'\nwhile [ ! -e '${root}/release-mv' ]; do sleep 0.02; done\nexec /usr/bin/mv "$@"\n`,{mode:0o755});
const env={HOME:`${root}/home`,PATH:`${root}/bin:/usr/bin:/bin`,GH_PATH:`${root}/real/gh`,AO_STATE_ROOT:root,AO_DATA_DIR:`${root}/sessions`,AO_SESSION:'app-1',TMPDIR:'/tmp/aosdr3/tmp',LANG:'C'};
const c=spawn(`${root}/bin/gh`,['pr','create'],{env,stdio:'ignore'});
appendFileSync('/tmp/aosdr3/logs/pids.txt',`rw wrapper pid=${c.pid}\n`);
const done=new Promise(resolve=>c.on('exit',resolve));
async function waitFile(f){for(let i=0;i<400;i++){if(existsSync(f))return;await sleep(10);}throw Error(`timeout ${f}`)}
try{
 await waitFile(`${root}/loaded`);
 writeFileSync(`${root}/bin/ao-metadata-helper.sh`,'update_ao_metadata() { :; }\n');
 const ps=spawnSync('/usr/bin/ps',['-o','args=','-p',String(c.pid)],{encoding:'utf8'}).stdout.trim();
 console.log('old wrapper argv:',ps,'; matched by prescribed drain:',/metadata-updater\.sh|ao-metadata-helper\.sh/.test(ps));
 writeFileSync(`${root}/release-gh`,'');await waitFile(`${root}/copied`);
 writeFileSync(record,'runtimeHandle=new\ngeneration=2\n');
 writeFileSync(`${root}/release-mv`,'');
 console.log('wrapper exit:',await done,'; record:',JSON.stringify(readFileSync(record,'utf8')));
 // Literal ordering of the new protocol; no actual inbox implementation exists.
 const reservation={inboxOffset:0}; const line=JSON.stringify({key:'pr',value:'https://github.com/org/app/pull/8',launch:'new-launch'})+'\n';
 const entry=JSON.parse(line);if((reservation.launchId??'')===entry.launch)reservation.pr=entry.value;reservation.inboxOffset=line.length;
 Object.assign(reservation,{launchId:'new-launch',runtimeHandle:'published'});
 console.log('new inbox, poll before runtimeHandle publish:',JSON.stringify(reservation),'accepted PR:',Boolean(reservation.pr));
}finally{writeFileSync(`${root}/release-gh`,'');writeFileSync(`${root}/release-mv`,'');try{c.kill('SIGTERM')}catch{} await done;}
```

### R3a: same-group, escaped descendant, and supervisor death

```python
import os,sys,time,signal,subprocess,json,ctypes
root='/tmp/aosdr3/supervisor';os.makedirs(root,exist_ok=True)
ctypes.CDLL(None).prctl(36,1,0,0,0) # adopt only this test's orphaned descendants
kidcode='''import os,time,sys
open(sys.argv[1],"w").write(str(os.getpid()))
time.sleep(1)
open(sys.argv[2],"w").write("late mutation")
time.sleep(8)
'''
open(root+'/kid.py','w').write(kidcode)
leader='''import sys,subprocess,os
if not sys.stdin.readline():sys.exit(99)
subprocess.Popen([sys.executable,"-I",sys.argv[1],sys.argv[2],sys.argv[3]],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True,start_new_session=sys.argv[4]=="escape")
'''
open(root+'/leader.py','w').write(leader)
for kind in ['same-group','escape']:
 p=subprocess.Popen([sys.executable,'-I',root+'/leader.py',root+'/kid.py',root+'/'+kind+'.pid',root+'/'+kind+'.write',kind],stdin=subprocess.PIPE,start_new_session=True)
 journal=root+'/'+kind+'.json';open(journal,'w').write(json.dumps({'pgid':p.pid,'leaderStartTicks':open('/proc/'+str(p.pid)+'/stat').read().rsplit(') ',1)[1].split()[19]}))
 p.stdin.write(b'go\n');p.stdin.close();p.wait()
 for _ in range(100):
  if os.path.exists(root+'/'+kind+'.pid'):break
  time.sleep(.01)
 kid=int(open(root+'/'+kind+'.pid').read());open('/tmp/aosdr3/logs/pids.txt','a').write(f'supervisor {kind} leader pid={p.pid}\nsupervisor {kind} grandchild pid={kid}\n')
 print(kind,'leader',p.pid,'grandchild',kid,'grandchild pgid',os.getpgid(kid),flush=True)
 try:os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError:pass
 if kind=='same-group':os.waitpid(kid,0)
 try:os.killpg(p.pid,0);empty=False
 except ProcessLookupError:empty=True
 if empty:os.unlink(journal)
 print('original group empty',empty,'journal retained',os.path.exists(journal),flush=True)
 time.sleep(1.2)
 print('late mutation',os.path.exists(root+'/'+kind+'.write'),flush=True)
 if kind=='escape':os.kill(kid,signal.SIGKILL);os.waitpid(kid,0)
# A journal survives death of its supervisor and blocks a new operation while its group lives.
inner='''import os,sys,subprocess,time,json
p=subprocess.Popen(["/bin/sleep","20"],start_new_session=True)
open(sys.argv[1],"w").write(str(p.pid))
time.sleep(20)
'''
p=subprocess.Popen([sys.executable,'-I','-c',inner,root+'/crash.journal'])
for _ in range(100):
 if os.path.exists(root+'/crash.journal'):break
 time.sleep(.01)
kid=int(open(root+'/crash.journal').read());p.kill();p.wait()
open('/tmp/aosdr3/logs/pids.txt','a').write(f'crash supervisor pid={p.pid}\ncrash child pid={kid}\n')
os.killpg(kid,0);print('after supervisor crash: journal present, recorded group live -> busy')
os.kill(kid,signal.SIGKILL);os.waitpid(kid,0)
print('all owned children reaped')
```

### R3a: retained unrelated descriptor cannot keep the AO lock

```js
import net from 'node:net';
import {spawn} from 'node:child_process';
import {openSync,closeSync,appendFileSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosdr3'; const sock=`${root}/lock-fd.sock`;
const lock=net.createServer();await new Promise(r=>lock.listen(sock,r));
const fd=openSync(`${root}/kept-fd`,'w');
const code=`const f=require('node:fs'); f.writeSync(3,'still open'); f.writeFileSync('${root}/kept-fd-pid',String(process.pid)); setTimeout(()=>{},10000)`;
const parentCode=`const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e',${JSON.stringify(code)}],{detached:true,stdio:['ignore','ignore','ignore',3]});p.unref();`;
const p=spawn(process.execPath,['-e',parentCode],{stdio:['ignore','ignore','ignore',fd]});
await new Promise(r=>p.on('exit',r));closeSync(fd);
for(let i=0;i<100&&!existsSync(`${root}/kept-fd-pid`);i++)await sleep(10);
const daemon=Number(readFileSync(`${root}/kept-fd-pid`,'utf8'));appendFileSync(`${root}/logs/pids.txt`,`retained-fd launcher pid=${p.pid}\nretained-fd daemon pid=${daemon}\n`);
await new Promise(r=>lock.close(r));
const next=net.createServer();await new Promise(r=>next.listen(sock,r));
console.log('daemon inherited FD 3 and is alive; original lock closed and next operation acquired:',true);
console.log('kept descriptor content:',readFileSync(`${root}/kept-fd`,'utf8'));
process.kill(daemon,'SIGKILL');await sleep(100);await new Promise(r=>next.close(r));
console.log('daemon remains:',existsSync(`/proc/${daemon}`));
```

### R3b: independently selected request peer versus resolved store

```python
import os,socket,struct,json,subprocess,sys,time
r='/tmp/aosdr3/store';os.makedirs(r,exist_ok=True)
server='''import sys,socket,json,os
s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1]);s.listen()
while True:
 c,_=s.accept();q=json.loads(c.recv(4096));
 if q["op"]=="remove":open(sys.argv[2]+"/removed","w").write(q["id"])
 c.sendall(json.dumps({"store":sys.argv[2],"pid":os.getpid()}).encode());c.close()
'''
ps=[]
def call(path,op,expected=None):
 s=socket.socket(socket.AF_UNIX);s.connect(path);pid=struct.unpack('3i',s.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))[0]
 if expected is not None and pid!=expected:s.close();return {'refused':True,'actualPeer':pid}
 s.sendall(json.dumps({'op':op,'id':'ses_shared'}).encode());a=json.loads(s.recv(4096));s.close();return a
try:
 for k in ['A','B']:
  os.makedirs(r+'/'+k,exist_ok=True)
  p=subprocess.Popen([sys.executable,'-I','-c',server,r+'/'+k+'.sock',r+'/'+k]);ps.append(p)
  open('/tmp/aosdr3/logs/pids.txt','a').write(f'store {k} stand-in pid={p.pid}\n')
 for _ in range(100):
  if all(os.path.exists(r+'/'+k+'.sock') for k in ['A','B']):break
  time.sleep(.01)
 locator=r+'/selected';open(locator,'w').write(r+'/A.sock')
 resolved=call(open(locator).read(),'resolve');lockStore=resolved['store'];open(lockStore+'/quarantine','w').write('ses_shared')
 open(r+'/B/hold-other-config','w').write('live holder ses_shared')
 open(locator,'w').write(r+'/B.sock') # another environment's service wins between calls
 result=call(open(locator).read(),'remove')
 print('resolved/locked',lockStore,'request reached',result['store'],'B live holder ignored',os.path.exists(r+'/B/hold-other-config'),'B removed',os.path.exists(r+'/B/removed'))
 print('transport-bound control',call(open(locator).read(),'remove',resolved['pid']))
 # Fixed-store namespace positive control, across independent configuration/state-root owners.
 shared={'holds':{'config-B/session-1':{'S':'ses_shared'}},'quarantine':{'ses_other':True}}
 print('same-store cross-config holder refuses',any(x['S']=='ses_shared' for x in shared['holds'].values()))
 print('same-store cross-config quarantine refuses','ses_other' in shared['quarantine'])
 # Literal states of section 6, not production code.
 own={'S':'ses_shared','identity':'own'}
 print('own hold before purge also satisfies step 2 live-holder predicate',own=={'S':'ses_shared','identity':'own'})
 print('retry of present quarantine stopped by step 1 before step 4',bool(shared['quarantine'].get('ses_other')))
finally:
 for p in ps:p.terminate();p.wait()
```

### R2b-1: admitted legacy mutation reaches a token launch

```js
import {spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,unlinkSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const name='aosdr3-mix';const socket=`/tmp/tmux-${process.getuid()}/${name}`;
if(existsSync(socket))throw Error('not my socket');
const tm=(...a)=>spawnSync('/usr/bin/env',['-u','TMUX','/usr/bin/tmux','-f','/dev/null','-L',name,...a],{encoding:'utf8'});
const started=new Set();
function remember(){for(const p of (tm('display-message','-p','#{pid}').stdout+tm('list-panes','-a','-F','#{pane_pid}').stdout).trim().split(/\s+/)){if(+p){started.add(+p);appendFileSync('/tmp/aosdr3/logs/pids.txt',`mixed private server/pane pid=${p}\n`)}}}
try{
 tm('new-session','-d','-s','keeper','/bin/sleep 100');tm('new-session','-d','-s','app','/bin/sleep 100');remember();
 console.log('legacy stop admitted on old record; has-session:',tm('has-session','-t','=app').status);
 // Another admitted operation replaces the old runtime and publishes a new token handle.
 tm('kill-session','-t','=app');tm('new-session','-d','-s','app','/bin/sleep 100',';','set-option','-t','=app:','@ao_launch','0123456789abcdef0123456789abcdef');remember();
 console.log('replacement token before pending legacy stop:',tm('display-message','-p','-t','=app:','#{@ao_launch}').stdout.trim());
 const result=tm('kill-session','-t','=app');
 console.log('R2b-1 legacy stop exit:',result.status,'; new token launch still exists:',tm('has-session','-t','=app').status===0);
}finally{
 for(const pid of [...started].reverse())try{process.kill(pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}
 await sleep(100);for(const pid of started)if(existsSync(`/proc/${pid}`))try{process.kill(pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}
 await sleep(100);if(existsSync(socket))unlinkSync(socket);
 console.log('owned PIDs left:',[...started].filter(p=>existsSync(`/proc/${p}`)));
}
```

### Independent protocol outputs

`rw.out`:

```text
old wrapper argv: bash /tmp/aosdr3/rw/bin/gh pr create ; matched by prescribed drain: false
wrapper exit: 0 ; record: "runtimeHandle=old\ngeneration=1\npr=https://github.com/org/app/pull/7\nstatus=pr_open\n"
new inbox, poll before runtimeHandle publish: {"inboxOffset":79,"launchId":"new-launch","runtimeHandle":"published"} accepted PR: false
```

`supervisor.out`:

```text
same-group leader 1158660 grandchild 1158673 grandchild pgid 1158660
original group empty True journal retained False
late mutation False
escape leader 1159092 grandchild 1159093 grandchild pgid 1159093
original group empty True journal retained False
late mutation True
after supervisor crash: journal present, recorded group live -> busy
all owned children reaped
```

`retained-fd.out`:

```text
daemon inherited FD 3 and is alive; original lock closed and next operation acquired: true
kept descriptor content: still open
daemon remains: false
```

`store.out`:

```text
resolved/locked /tmp/aosdr3/store/A request reached /tmp/aosdr3/store/B B live holder ignored True B removed True
transport-bound control {'refused': True, 'actualPeer': 1197051}
same-store cross-config holder refuses True
same-store cross-config quarantine refuses True
own hold before purge also satisfies step 2 live-holder predicate True
retry of present quarantine stopped by step 1 before step 4 True
```

`mixed-launch.out`:

```text
legacy stop admitted on old record; has-session: 0
replacement token before pending legacy stop: 0123456789abcdef0123456789abcdef
R2b-1 legacy stop exit: 0 ; new token launch still exists: false
owned PIDs left: []
```


## Isolation and final cleanup evidence

Marker created before the review: `/tmp/aosdr3-marker`, `2026-10-21 15:43:11.125534221 -0400`. All package-manager, Node, helper and test calls had an empty inherited environment with scratch-only additions. No real `ao`, OpenCode, Claude, Codex or Gemini command was run. No real tmux server was queried. No real lifecycle worker, orchestrator pane, session or watcher was signalled. The author scratch directory was only read/copied. No commit, push, PR, stash, rebase or extra worktree was made. Existing round-2 review was left untouched.

Herdr full trace (after allowing system directory roots as well as their descendants):

```text
{'outsideOnlyENOENT': ['/.git', '/HEAD', '/tmp/.git', '/tmp/HEAD'], 'badPaths': [], 'inetConnections': 0, 'homePaths': []}
```

The four outside paths were failed ancestor repository probes (ENOENT), not successful accesses. There were no /home paths and no IPv4/IPv6 connect calls. Both servers' listening sockets were under `/tmp/aosdr3/herdrhome`. They and their tracers were stopped by their recorded exact PIDs.

`ls -la --time-style=full-iso ~/.ao/bin` **before**:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The same command **after** (exact text comparison equal):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

`ls -la --time-style=full-iso ~/.config/herdr` before and after were byte-for-byte equal; both listings were:

```text
total 164
drwxr-xr-x  2 taisung users   4096 2026-08-11 23:37:59.976961755 -0400 .
drwx------ 79 taisung users   4096 2026-10-12 13:35:33.860538200 -0400 ..
-rw-r--r--  1 taisung users      0 2026-08-07 13:25:50.514011392 -0400 .plugins.lock
-rw-r--r--  1 taisung users     53 2026-08-09 17:20:00.987120503 -0400 config.toml
-rw-r--r--  1 taisung users   1812 2026-08-09 16:09:02.511426651 -0400 herdr-client.log
-rw-r--r--  1 taisung users 140980 2026-08-11 23:37:59.979961665 -0400 herdr-server.log
-rw-r--r--  1 taisung users   1393 2026-08-11 23:37:59.976961755 -0400 session.json
```

Required real-state check:

```bash
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr3-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

Attribution (inferred from metadata/mtime, not an unrecorded writer PID):

| Entry | Observed mtime | Whose write |
| --- | --- | --- |
| `.../sessions` | 16:00:59.498354922 -0400 | Real fleet record publication/rename; matches the orchestrator record mtime. |
| `.../sessions/ao-52` | 15:49:59.526983279 -0400 | Real lifecycle/orchestrator maintenance of ao-52: generation 9, status stuck. Not this reviewer: no real AO/helper invocation. |
| `.../sessions/ao-orchestrator` | 16:00:59.498354922 -0400 | Real orchestrator/lifecycle maintenance: generation 17, status working. Not this reviewer. |

The files do not identify the exact writer PID, so the attribution stops at the real fleet rather than inventing one. Reads of these records used only stat/grep.

Owned process audit after the experiments (all logged exact PIDs plus same-UID scratch HOME/environment/command checks, excluding the audit's own ancestor chain):

```text
{"loggedPIDs": 49, "loggedStillPresent": [], "ownScratchProcesses": []}
```

Thus the list of remaining owned processes is **`[]`**. Test-suite children were also absent under the scratch-environment scan. Final scratch/socket removal is recorded below.

Final removal verified after the audit:

```text
{
  "ownedProcesses": [],
  "removedStaleOwnedSockets": [
    "/tmp/tmux-44402/aosdr3-g1",
    "/tmp/tmux-44402/aosdr3-g2",
    "/tmp/tmux-44402/aosdr3-g3",
    "/tmp/tmux-44402/aosdr3-g4",
    "/tmp/tmux-44402/aosdr3-g5"
  ],
  "scratchExists": false,
  "markerExists": false
}
```

All scratch reproducers and outputs needed to assess the findings are retained above; author scripts remain preserved in design r3 §15. No tracked file changed.
