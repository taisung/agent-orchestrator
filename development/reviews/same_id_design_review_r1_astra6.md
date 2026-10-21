# Cross-family review of the same-ID design — ao-51

R2: NOT-SOUND
R3: NOT-SOUND
R4: SOUND-WITH-CHANGES

Completed 2026-10-21 against source `c516cead`. **7 blockers (B-1–B-7), 4 major findings (M-1–M-4), 0 minor findings.** R2's identity and failure propagation and R3's serialization claims admit destructive counterexamples. R4's fail-closed approach is sound, but B-7's missing strict-read/propagation paths must be included before acceptance. No production code changes, commits, PR, or push.

## R1 notes

None. No R1 defect requiring a notice was found; R1 was outside the review scope.

## Evidence log

- Read the task and project instructions. Created `/tmp/aosdr-marker` before investigation. Saved the initial full-time listing of `~/.ao/bin`; newest entry is 2026-10-16 12:16:13.968933443 -0400.
- Scratch root is `/tmp/aosdr`, initially absent. All executed Node/package/test helpers use `env -i`, fake HOME, and scratch PATH. The tmux shim adds `-L aosdr-test`; direct tmux experiments use explicitly named `aosdr-*` servers. The gh stub only accepts `--version` and `auth status`.
- The design is an algorithm/design artifact and a set of experimental claims. Reviewing source and independent runs before consulting the author's report.

## Findings

### B-1 — R2's timestamp pair can identify a different live launch

Design §§3.3, 4.3, 12; `packages/plugins/runtime-tmux/src/index.ts:169` (`destroy`), `:223` (`isAlive`). The proposed comparisons omit the recorded `tmuxSessionId` and server PID. On private tmux 3.4 server `aosdr-P`, two successive sessions named `victim` had IDs `$1` and `$2` but both had `session_created=1792599067`, `start_time=1792599067`, server PID 2356651. The exact proposed guard, using the first launch's timestamps, exited 0 and killed the second session. `has-session -t =victim` then returned exit 1. This is a measured removal of a different live launch, not an interleaving between compare and kill.

Restarting private server `aosdr-R` within that same second repeated both timestamps **and** session ID `$0`: PID 2356679 became 2356701. Including the session ID alone, as the prototype does for `isAlive`, still fails this case. Compare the complete server/session identity; use a server incarnation identifier robust to PID reuse and clock changes, plus session ID. A kernel process start token/boot identity or a securely initialized per-server nonce needs a defined protocol. The five suggested fields are useful evidence, but second-resolution PID/start combinations are not a proof against every PID-reuse/clock schedule.

Reproducer: clean environment, explicit `-L aosdr-P`, keep an unrelated session so the server stays up, create `victim`, record the five fields, stop that pane by its recorded PID, remove its session, create `victim` again in the same second, and execute `if-shell -F -t =victim: '#{==:#{session_created}/#{start_time},1792599067/1792599067}' 'kill-session -t =victim'`. No default-server command ran. All probe pane/server PIDs were recorded and terminated; probe ended with `own running processes: []`.

### B-2 — A separate create read-back can adopt another launch

Design §3.2; `packages/plugins/runtime-tmux/src/index.ts:130` (new-session), `:140` (launch keys). The design only tests the case where the name stays absent after creation. On `aosdr-P`, original `readback` was `$3`; after ending it and making a replacement before `display-message`, the proposed read-back returned `$4`. It has no original identity to compare against. The launcher can record the replacement as its own and send its launch command into that pane. Obtain identity from `new-session -P -F` itself, which tmux 3.4 supports (used in this run), then guard subsequent launch keys and cleanup against that identity. A separate probe cannot establish ownership retroactively.

### Independent measurement results

- `-S <Q socket>` selected Q with both option orders (`-L P -S Q`, `-S Q -L P`). Reading back the actual socket avoids an invented default bypassing a shim. Computing a comparison value is different from selecting a server: the absolute “Node must never compute a socket path” wording should apply to routing, not prohibit validation.
- `display-message` on a missing exact target returned server PID/start/socket and empty **session** fields: `2356651|1792599067|||/tmp/tmux-44402/aosdr-P`. The full identity line is not empty. Validate session fields explicitly; do not rely on an empty line.
- Missing-target guard and a deliberately unknown format both selected the keep branch with exit 0. Success exit status alone does not prove a kill or even support for the requested comparison.
- Unlinking only `aosdr-Q`'s socket produced `ENOENT` while recorded PID 2356656 remained alive; SIGUSR1 to the recorded own server PID restored access.
- `pnpm install --frozen-lockfile` and `pnpm build` succeeded with `env -i`, fake HOME, scratch PATH, and `HUSKY=0`. Tests run from each package's local vitest binary with `SAME_ID_DEFECTS=red`, no inherited AO variables and no agent binary on PATH.

### B-3 — The operation lock can end before the destructive child process

Design §§4.1, 4.3, 7; `packages/core/src/metadata.ts:101-112`, `packages/plugins/workspace-worktree/src/index.ts:190`, `:388`. A kernel-released socket protects the lifetime of its AO holder, not a git/hook child that outlives it. Independent scratch run: holder PID 2390720 held an abstract socket and started remover child 2390727; terminate only the holder, acquire the same socket in another process, write the replacement file, then let the old child finish. Output: `newHolderAcquired=true, oldChildFinished=true, replacementFilePresent=false`. No real worktree was touched; the child deleted one scratch file. This models a dispatched git removal after AO dies and shows why the record lock's crash property does not automatically transfer to long operations. The proposed “closed among new builds” claim needs the lock held by a supervisor until all mutating children have exited, or an equivalent child-lifetime/fencing protocol. A timeout must not release the lock while a mutation continues. Add a crash-during-git test, beyond “a process dies holding the lease”.

### B-4 — Claim-before-read does not serialize against a removal already dispatched

Design §§4.2–4.4; `packages/plugins/agent-opencode/src/index.ts:527-529`, `packages/core/src/session-manager.ts:432-434`, `:1154`, `:2054`. A remover can pass `stillUnheld`, start the API request, and then wait while another AO ID publishes its claim and reads the still-existing session. The removal finishes after that read. Claim-before-read closes the author's selected delay inside `session.get` only when the remover's final check occurs after publication. It moves the remaining race to the API operation; it cannot close it against every old or new process. A lease keyed by the OpenCode service/session identity must cover claim/get/publication and **every** interrupt/removal, with an explicit rule for requests whose completion is unknown. Old removers still do not take it, so rollout must drain them. OD-8 should be (c), with that limitation.

### R4 source assessment (expanded in B-7)

The archive allocation fail-closed choice is appropriate, but `hasOtherOpenCodeRecord` at `session-manager.ts:971-985` also uses `listMetadata` and nullable per-record reads. `metadata.ts:809-820` omits unstatable entries, `:442` turns some unreadable paths into null, and `:730-733` turns an unreadable latest archive into null. Replacing only the archive-directory listing does not make this holder decision strict. The recovery validator also currently swallows `workspace.exists` rejection at `validator.ts:87-93`; changing only the plugin to reject cannot propagate “unknown”. These paths need explicit tests as part of R4.

B-4 measured follow-up: a scratch Vitest case used the real built session manager and real OpenCode plugin with mocked API calls. After the plugin's final holder check, the mocked removal let app-2 spawn. At the beginning of the API read, the test wrote the proposed `opencodeSessionId` claim through real locked `updateMetadata`, then returned the existing session. App-2 completed successfully; only then the pending removal completed. The final record still named `ses_prepared`. This emulates publication immediately before the API read; it is not a production implementation of the proposal. The assertion of the counterexample passed (1/1), with no OpenCode executable or service.

### B-5 — An answering replacement server does not prove the recorded server died

Design §3.3 (“empty output”/“another pair” => dead); `packages/plugins/runtime-tmux/src/index.ts:223`, `packages/core/src/session-manager.ts:3211-3228`. Own private-server measurement: `aosdr-hidden` PID 2416224, pane PID 2416234, start 1792599242; unlink its socket, then create a second private server at that same path. New PID 2416529/start 1792599243 answered the old socket path, while **both original server and original pane still ran**. Querying the original name returned `|1792599243` (empty session creation field, new server time). The design declares dead without reaching its PID check, which is only in the connection-error branch. Cleanup may then remove the live original's worktree. Check server identity before accepting negative session evidence; a different server must trigger verification of the recorded process even if the socket answers. If the old process remains or cannot be verified, keep the record/worktree as unknown. Do not suggest SIGUSR1 blindly while another server occupies that path: it can unlink the second server's socket. Surface both identities and require a controlled recovery.

### B-6 — Guard failure must stop the caller's workspace and record removal

Design §§3.3, 3.5, 7, 12; `runtime-tmux/src/index.ts:168-173`, `core/src/session-manager.ts:2889-2893`, `:2911`, `core/src/recovery/actions.ts:164-169`. Current runtime destroy swallows errors; the prototype retains that catch. Even making it throw is insufficient: kill and recovery swallow the rejection and continue removing state. A successful no-op guard is also indistinguishable from a completed kill in `Promise<void>`. Own probe with an unknown comparison format selected no branch, exited 0, and left the target live. A pre-probe is not enough if the socket disappears before destroy. R2 must define an acknowledged destroy result (destroyed, authoritatively absent, different identity, unknown) or a typed refusal propagated by every destructive caller. Unknown must preserve worktree and record; identity mismatch must also prevent removing a shared workspace until ownership is established. Verify supported formats/version before destructive use, and never downgrade an unsupported guard to an unguarded kill. Add `recovery/actions.ts` and its tests to R2, not only R3.

### Source check of the guard's atomicity

For tmux 3.4, the *queue property itself* is sound for the specified non-waiting command. `if-shell -F` inserts the chosen command after its current item and returns normally; `cmdq_next` drains that queue until it is empty or a command waits. The server processes other clients after that call. Thus a direct `kill-session` has no other-client gap between the comparison and kill. This follows from primary source, not a contention benchmark: [cmd-if-shell.c, lines 78–93](https://github.com/tmux/tmux/blob/3.4/cmd-if-shell.c#L78), [cmd-queue.c, lines 680–755](https://github.com/tmux/tmux/blob/3.4/cmd-queue.c#L680), [server.c, lines 245–259](https://github.com/tmux/tmux/blob/3.4/server.c#L245). It does not repair the wrong comparison in B-1 or protect against an old client issuing its own unguarded kill later. Introducing a waiting shell command into that branch would invalidate this reasoning.

The author's report was read only after the independent R2/R3/R4 assessment and initial counterexamples were recorded. It repeats the design claims; it does not address these additional schedules.

### B-7 — R4 needs strict reads throughout the decision, not only at the named boundary

Design §5; `core/src/session-manager.ts:971-985`, `:3224`; `core/src/metadata.ts:442`, `:730-733`, `:809-820`; `core/src/recovery/validator.ts:81-93`; `workspace-worktree/src/index.ts:264-274`; `core/src/herdr.ts:43-70`.

1. A strict archive-directory listing still permits `hasOtherOpenCodeRecord` to miss an unreadable latest archive or an active record omitted by `listMetadata`. Independent scratch test: readable archive directory, latest `app-2` archive containing `opencodeSessionId=ses_shared` with mode 000, dead app-1 runtime. Cleanup dispatched `session.remove('ses_shared', 10000, undefined)`. Strict directory enumeration would return exactly the same ID in this case. Use strict active listing and reads; a listed latest archive that cannot be read is unknown/held. Do not silently skip it.
2. The validator swallows `workspace.exists` rejection. Independent test: runtime and agent both live, missing direct path, `workspace.exists` rejects with a git probe failure; assessment still returned `action='cleanup'`. Set `probeError` in that catch too. Distinguish `lstat` ENOENT (path missing) from spawning `git` ENOENT (binary missing). The latter cannot prove absence. A malformed or unexpected git response also must not count as an authoritative negative.
3. The shared Herdr helper returns `[]` for CLI errors, JSON parse errors, error envelopes, and malformed replies. All four agents call `isHerdrProcessRunning`; making their outer catches rethrow never sees these errors. Even with a successful runtime `pane get`, a failed `pane process-info` can still become agent-exited and eventually killed (`lifecycle-manager.ts:680-709`). Add `core/src/herdr.ts` and its callers/tests to R4, preserve explicit pane-gone/valid empty-process answers, and reject unavailable or malformed replies. The two new runtime-Herdr tests cover neither this helper nor error envelopes.

The two additional scratch R4 counterexamples passed after correcting the test's matcher to allow the API's undefined environment argument. The first run already showed the removal call but used `expect.anything()` for that optional argument, which rejects undefined; that was a harness assertion error, not different product behavior.

### M-1 — Legacy records need an explicit provenance and recovery policy

Design §§3.4, 6 and OD-3; `runtime-tmux/src/index.ts:223`, `core/src/lifecycle-manager.ts:1569-1576`, `core/src/session-manager.ts:539-555`. Default-socket absence is authoritative only if the old record is known to have been created there. A legacy record created on a custom `-S`/`-L` server can still have a live pane while the uid's default server answers absent. Conversely, a genuinely dead legacy record viewed only through a non-default server stays unknown forever under OD-3a. If that private server is the normal deployment, simply retrying does not help. Positive same-name matches on an arbitrary caller server and the broad createdAt tolerance do not prove old-launch identity either.

Keep C-04: do not rewrite `runtimeHandle` on reads. Prefer conservative unknown for unproven old records, plus an explicit owner-approved association stored separately after verifying the live session, or a documented administrative retire operation after verifying runtime/child death. For this host, “all old records came from the default server” can be an explicit deployment assertion, not a general algorithm. Normal users can switch back to the known original server; after an old custom server has died, the design needs a verified way to retire that record without pretending the caller's default answers for it. Automatic status and cleanup must never perform that adoption. This expands OD-3 beyond the unqualified (a).

### M-2 — The operation-lock protocol is underspecified for waits, nesting and platforms

Design §§4.1, 7, OD-7; `core/src/metadata.ts:292`, `core/src/delivery-lock.ts:10-19,45,74`, `session-manager.ts:3533-3540`, `workspace-worktree/src/index.ts:388`. Define holder as one operation with an unforgeable token scoped to canonical state/project/session identity, not all calls in a process. A second concurrent async operation in the same Node process must wait; copying the record lock's process-local reentrancy map would let it through. Validate nested tokens, forbid use after release, and await actual release before reentry. Acquire before reading the mutable record used for decisions; refetch/reassess after waiting. Reservation/allocation before a session ID exists needs an explicit handoff into the operation lock.

There is no safe wall-clock expiry that permits stealing a still-running mutation. OD-7's 30 seconds is a **waiter** deadline, not holder expiry. Use monotonic elapsed time. Lifecycle should try once and defer with its decision revalidated on the next poll. Hold only one session operation lock at a time; process batch cleanup one ID at a time. Fix lock ordering for operation/OpenCode/ledger/record locks, and never hold the synchronous record lock across an await. `send -> restore`, `cleanup -> kill`, and rollback must pass the same token explicitly. A postCreate hook that calls `ao send` for its own ID from a child process has no in-process token: with bounded waits this fails after 30 seconds instead of waiting forever, but the flow breaks unless the boundary is documented or redesigned. A lifecycle callback awaited by a CLI operation has the same concern. Independent external `ao send` behind a long spawn can time out normally; report busy without interrupting the spawn.

The record-lock fallback is **no lock** (`metadata.ts:293`), whereas the delivery API refuses on unsupported platforms. Silently inheriting the no-lock fallback falsifies R3's guarantee. Require a safe supported-platform primitive or refuse these protected operations there. The `launch` kind also requires changing the type union in `delivery-lock.ts:45`, missing from the round file list.

### M-3 — F-6 discovery loses the only information needed to find some kept runtimes

Design §§4.1, 4.5, OD-9; `core/src/session-manager.ts:1539-1566,1765,1816,4311`; `cli/src/commands/status.ts:455-476`. A failed spawn can leave a runtime on a private server and then release its only record. “List on the recorded servers” has no seed when that was the only record for the server. Comparing names alone also hides an orphan on server A when a replacement record names the same runtime name on B. Herdr runtimes do not follow the tmux hash/name/socket convention and need their own enumeration/stop details. Persist a separate retained-runtime inventory with full server/launch identity before losing the record, and list it along with discoverable current-server candidates. Do not report every active-name match as owned; compare full identity and treat a pending reservation as uncertain. Render a guarded, quoted stop command or an AO retire action; a bare name-only kill printed by status can target a replacement by the time the operator runs it. Add tests for no surviving record, two servers with the same name, unreadable records, and Herdr.

### M-4 — Mixed-build operation is compatible storage, not safe mutual exclusion

Design §§4.2–4.3, 6; `runtime-tmux/src/index.ts:170`, `core/src/session-manager.ts:2889`, `workspace-worktree/src/index.ts:146,190`. A new guarded destroy protects only that new client's operation. An old client's later unguarded kill still destroys the new launch; an old git removal still removes its path; an old OpenCode remover can already be in flight before a claim. Thus section 4.3's “against every actor” and table's “closed, also old” are false as fleet-wide claims even after B-1 is fixed. The old lifecycle workers also continue treating new handles through their environment's server. Restarting them *after* enabling new operations leaves an unsafe overlap. Use an admission/drain barrier for mutating commands, wait for dispatched mutations or resolve their unknown completion, stop/restart resident AO processes with the new build, then reopen admission. Do not stop the agent panes as part of this deployment. Record compatibility needs no automatic migration; operational quiescence and explicit legacy handling are still required.

No minor findings added merely for count. R1 notes remain none; no mid-task AO notice was sent.

B-6 also affects the R2/R4 boundary: `lifecycle-manager.ts:640-642` stores a runtime `ERR_RUNTIME_PROBE` as failed, but `:658` still runs the agent probe (only `no-server` suppresses it). Codex/Gemini/OpenCode still return false on the hidden socket until R4; their exited activity at `:680-684` overwrites the unknown runtime evidence with a negative. Therefore landing R2 alone does not implement the table's “hidden socket: never killed” for those agents. Move the necessary liveness error propagation into R2 or explicitly gate the agent result when the runtime probe is unknown, with lifecycle-level tests. A runtime-only F-7 unit test cannot catch this. Also remove the non-Linux `/proc`-unavailable fallback to bounded `ERR_RUNTIME_NO_SERVER` if OD-4 promises never to infer death from inability to inspect the process; it reaches killed after five minutes at `:1574`. The prototype's catch-all `/proc` failure => false is unsafe even on Linux (EACCES, malformed data, transient I/O). ENOENT for the *recorded process* can prove it gone; inability to inspect cannot.

## R2 answers and per-command behavior

The five fields name a socket endpoint, a PID and wall-clock second, and a server-local session ID and wall-clock second. They are valuable evidence but are neither all compared by the proposal nor a mathematically unique incarnation token. Measured same-second replacement/restart and endpoint replacement are B-1/B-5. PID reuse with a different reliable start token means the old process ended; PID reuse within the two-second tolerance should conservatively retain, not authorize a signal to the reused PID. A wall-clock-adjusted `btime + ticks/CLK_TCK` is not a substitute for a persisted raw monotonic process start token. Parse `/proc/<pid>/stat` after its last `)` and validate every field; obtain CLK_TCK rather than assuming 100 outside this host. Record a boot/process identity at creation if it is used later. No host clock or PID allocator was changed to manufacture reuse.

Use the tmux-returned socket to route every known-handle call, including launch sends, metrics, paste buffers, agent probes, readiness, CLI activity, and attach. `-S` overriding `-L` was measured both ways. A caller without a handle may discover through its selected environment; it must not invent `-S /tmp/tmux-UID/default` and silently override that selection. Socket paths must be passed as arguments and shell-escaped when printed, not split on whitespace without validating the leading fields. The original create can end before read-back, be replaced before read-back, or be replaced after it before send: obtain creation identity atomically and guard every action that can affect a pane, not only destroy. A name plus socket alone is not launch identity.

The guard's missing-target branch is safe as a no-op on tmux 3.4. An unsupported comparison can also look like a safe no-op while leaving a live target; acknowledge outcomes and test required format support. Do not infer successful destruction from exit 0. The compare/kill queue is atomic for the specified non-waiting commands; this is source-supported, with its limitations stated above.

| Command | Assessment of §3.5 and required behavior |
| --- | --- |
| status / session ls | Display unknown with cause and preserve persisted status. “Server gone => exited” is reasonable after verified recorded-process death. Discoverability of legacy/orphan records needs M-1/M-3. |
| lifecycle | Require the runtime unknown to survive subsequent agent checks (B-6). Two authoritative negatives may converge as before; missing socket or unavailable process inspection is not such evidence. |
| session cleanup | Keep on unknown regardless of whether cleanup was selected by runtime, PR, or issue. Current PR/issue routes bypass liveness selection, then hit the swallow in kill; apply the guard outcome at the actual removal step. |
| session kill | OD-5a is correct: fail with actionable detail, preserving worktree and record when the runtime cannot be stopped/verified. A dead recorded process can permit archiving, but verify no different live launch owns the shared workspace. “As today” for other probe errors is not safe: today catches and continues. |
| send / restore | Known server gone permits a fresh launch on the caller's selected server with a fresh immutable handle. Unknown must be distinguishable from dead throughout CLI/core; current `catch(() => true)` avoids a restore in some paths but does not itself implement a clear refusal. Refresh identity after a wait/restore and guard sends against replacement. |
| start | Refuse replacement on unknown; preserve the original record and avoid creating a second orchestrator. Carry this through both direct start and fixed-name orchestrator spawn. |
| attach | Use the runtime-provided socket and target, plus identity verification. A dead launch should not attach to a new same-name session; a pre-check alone has a replacement gap. Unknown should include the recovery diagnostic. |

For a lone hidden server with verified process identity and an unoccupied socket path, the user can recreate its socket with the suggested SIGUSR1, then retry. An occupied path (B-5), unreadable process evidence, unsupported guard, or unproven legacy origin needs a more specific recovery path. No automatic archival is justified merely because the user cannot presently reach it.

## R3 answers, F-1 through F-7

Option (d) is the right broad structure **after** the identified protocol changes. Identity-only protects neither paths nor multi-step reads; a per-ID lock alone does not serialize shared OpenCode objects. An incarnation suffix gives stronger resource separation but breaks the stated stable-workspace continuity requirement and does not remove branch exclusivity. The comparison should separate protection of a new operation against replacement from protection against an old actor's own unsafe command.

| Follow-up | Does the proposal close it? |
| --- | --- |
| F-1 | One existing-branch `git worktree add -- <path> <branch>` removes AO's checkout/cleanup sequence and closes that particular deletion. Keep branch/path conflict diagnostics and verify successful checkout of the requested branch. It does not make arbitrary concurrent git mutation or a surviving child safe. |
| F-2 | Checking ownership before each removal closes the measured awaited-add case. Hold the operation lock across postCreate, and check before other path mutations and each awaited hook too. An old actor can still replace the path during a removal; the design already calls that narrowed. |
| F-3 | Claim-before-read closes the published-intent window in the author's test but not the dispatched-removal window (B-4). Use service/session-scoped serialization with a defined ordering and unknown-completion policy. A dead claimant's record needs cleanup/reuse tests for missing sessions; temporary claim removal must be conditional on the owning launch and the exact claim so it cannot erase a later holder's mapping. |
| F-5 | Full identity guard plus operation lock closes the intended new-actor same-name/path race only while the operation lock covers all side effects. B-1, B-3, B-6 and old actors defeat the stated unconditional closure. Acquire/reassess before each operation; never keep a decision read before waiting. |
| F-6 | Guarded rollback can remove a positively identified own tmux launch; on unknown it must retain. A status scan alone does not find an orphan's lost server or Herdr handle (M-3). |
| F-7 | PID checking is the right extra evidence, but must run on answering server mismatch too, handle read failure as unknown, and propagate through lifecycle/agent checks. Current R2 test checks only one runtime error code. |

No automatic expiry should evict a running holder. An ended holder with no children releases cleanly; an ended holder with children is B-3. A hung living holder can block an ID indefinitely while individual CLI waiters time out. Provide diagnostics identifying the operation/PID/start identity; an administrative cancellation must terminate and reap the mutating work before releasing protection. Never resolve a timeout by simply starting a second operation. For nested calls, the token and lock order in M-2 eliminate self-waits; asynchronous callbacks or subprocesses cannot inherit that permission merely because they share a PID or AO_SESSION_ID.

## R4 answers and retained unknowns

- **Allocation:** OD-12a, use strict archive enumeration for both worker and worktree-orchestrator counters before reserving any ID. ENOENT means no archive; EACCES/ELOOP/I/O errors fail without runtime/workspace side effects. A repaired archive permits a retry. Do not only assert the final record disappeared after a failed launch.
- **OpenCode holder:** use strict active/archived enumeration and content reads, with unknown counted as a holder. B-7 shows why directory strictness alone is insufficient. Recovery is to repair/read the affected archive or explicitly retire it after verifying ownership, not silently discard it. A missing OpenCode session can be confirmed by a successful authoritative API answer, not by a failed query.
- **Recovery workspace:** `lstat` distinguishes a missing directory from an inaccessible one; the `workspace.exists` fallback must preserve that distinction too. Path ENOENT and executable ENOENT are different facts. Permission or git/tool availability fixes allow retry. More unknown should yield skip with a reason, never cleanup.
- **Agents / Herdr:** preserve false for a successful query that proves the requested process/pane is absent. Reject unavailable, timeout and malformed-response cases throughout the helpers (including `core/herdr.ts` and OpenCode's `findPaneOpenCodeProcess`). OpenCode's connection failure must not become `PaneGoneError`, which can request a restore. Test true, authoritative false, and unknown separately.

Conservative unknown can intentionally leave a record indefinitely when its evidence stays inaccessible. The design currently lacks a complete retire/repair flow for that case. Ordinary retries work after fixing permissions, binaries, socket access, or service responses. If evidence cannot be recovered, an explicit administrative disposition must preserve unidentified live resources and name retained work; it must not quietly promote unknown to dead. This is an owner decision, not a reason to keep today's fail-open read.

M-2 scope addition: default worktree paths are `~/.worktrees/<projectId>/<sessionId>` (`workspace-worktree/src/index.ts:88-107`), while record locks include the state directory. Two configurations/state roots can therefore address one physical path under distinct lock names. This is a source-derived boundary, not a new live reproduction. Either refuse such overlap as a supported configuration or serialize the canonical resource path as well, in a fixed order. Do not claim a record-scoped lease protects every same-path actor.

## Rollout, migration, and round assignment (brief items 4 and 5)

Keep the owner's order **R1, R2, R4, R3**, with R2's minimum required agent-error propagation brought forward as described in B-6. R3 depends on a corrected R2 guard before it may remove the conservative rollback ownership rule (OD-10), and on R4's whole strict-holder path before treating claims as visible protection. R4 can be developed independently; it does not need the operation lease to distinguish absence from errors.

Old readers ignoring added handle fields is storage compatibility. It does not make old actions safe against new launches. Before enabling mutating new-build operations, establish a deployment barrier, drain old CLI/reaction operations and their children, restart the resident lifecycle workers with the completed build, and reopen admission. An in-place build can be non-atomic to processes with lazy imports too; a versioned completed build/entry point is preferable. Read-only monitoring can continue if it cannot silently write/recover through old code. This is a deployment recommendation only: no real worker was restarted or stopped during this review. The protected real PIDs 1470866 and 1471311 and other managed sessions were not touched.

“No migration” is correct only for the narrow claim that existing handle JSON need not be rewritten. C-04 forbids automatic handle backfill. Old records keep reduced provenance and need M-1's explicit association/retirement policy; no newly added fields can reconstruct which historic server actually created them. New launches must publish a complete identity once, not a partial handle followed by enrichment that changes launchIdentity.

| Round | Changes/additions required to the proposed file/test list | Size/risk assessment |
| --- | --- | --- |
| R2 | Atomic identity acquisition, full comparison and guarded pane actions; verify recorded process on endpoint replacement and all error paths; define destroy outcome and propagate through `session-manager.ts`, `recovery/actions.ts`, lifecycle and CLI; explicit legacy policy and guard capability checks. Add lifecycle integration tests, same-second/restart/hidden-rebound tests, create/read-back replacement, guarded send/attach, and destroy refusal with workspace retention. | High remains correct. The 350 source/400 test-line estimate excludes essential protocol/caller changes; it is not a useful acceptance budget. |
| R4 | Strict active and archive-content readers as well as directory listing; propagate `workspace.exists` errors into validator `probeError`; distinguish missing git from missing path; change `core/herdr.ts`; cover OpenCode's internal pane-discovery errors. | Local fail-closed design is sound, but more than the 11 tests or listed boundaries. Keep both explicit-missing and healthy controls to prevent permanent unknown on ordinary dead sessions. |
| R3 | Add `delivery-lock.ts` kind typing, explicit lock API/context and resource scope, surviving-child protection, OpenCode service/session serialization across all removal paths including the plugin, and durable orphan inventory/enumeration for tmux and Herdr. Include recovery actions and CLI send/reaction boundaries, not just manager functions. | High/L is correct; 400/500-line estimates do not cover a fully specified crash/unknown-request protocol. Tests must use independent processes, not only nested mocked operations. |

F-1 and F-2 can be small local improvements, but neither replaces R3. F-6's inventory could be delivered earlier as diagnostic coverage; it must exist before rollback intentionally leaves resources that lose their records. Do not use passing defect tests as the rollout gate without the new counterexample tests.

## The 25 targeted defect tests (brief item 6)

Source: `c516cead1207276ae2ed9d6275db56aafc056127`. Independent run after install/build:

```text
env -i HOME=/tmp/aosdr/home PATH=/tmp/aosdr/bin:/usr/bin:/bin \
  LANG=C.UTF-8 TMPDIR=/tmp/aosdr/tmp SAME_ID_DEFECTS=red \
  ./node_modules/.bin/vitest run same-id -t 'same-id R[234]' --reporter=verbose
```

Run from each package directory below. The scratch PATH contained node/pnpm links, the restricted gh stub and the `tmux -L aosdr-test` shim; it contained no model executable. Test code's OpenCode/version stubs did not invoke a binary. Test fixtures set their own scratch AO state roots after starting with no inherited AO variables.

| Package | R2 failures | R3 failures | R4 failures | Outcome |
| --- | ---: | ---: | ---: | --- |
| core | 0 | 1 | 3 | 4 intended assertion failures |
| runtime-tmux | 4 | 0 | 0 | 4 intended assertion failures |
| agent-claude-code | 1 | 0 | 0 | 1 intended assertion failure |
| agent-codex | 1 | 0 | 2 | 3 intended assertion failures |
| agent-gemini | 1 | 0 | 2 | 3 intended assertion failures |
| agent-opencode | 1 | 1 | 2 | 4 intended assertion failures, two files |
| runtime-herdr | 0 | 0 | 2 | 2 intended assertion failures |
| workspace-worktree | 0 | 4 | 0 | 4 intended assertion failures |
| **Total** | **8** | **6** | **11** | **25 failures in 9 files** |

All selected tests executed; the permission-based recovery test ran as the non-root user. Fifteen R1 tests in these files were skipped by the name filter; the two CLI R1 tests were outside this run. Each observed failure matched the design's stated assertion (wrong server false, wrong runtime removal, missing worktree/files, removed OpenCode mapping, or a resolved false instead of rejection). There were no load/build/setup failures in this 25-test run. This review did not rerun the full monorepo suite, typecheck, or lint: no production source was changed. The separate three reviewer counterexample tests passed, meaning they demonstrated the unsafe behavior they asserted; they are not regression tests of a fix.

None of the 25 tests proves that only the proposed fix can pass. The table names every test instance (shared names are qualified by each package) and a concrete partial/wrong change it admits. These are assertion-level analyses unless marked as independently measured above; I did not install deliberately broken product fixes in the worktree.

| Round/package and exact test name | Partial or wrong change that also passes | Missing discriminating test |
| --- | --- | --- |
| R2 runtime-tmux — **isAlive answers true for a live session when the caller's environment names another server** | Persist/route only the socket, with no launch comparison. | Same-second replacement, restarted server, PID/start mismatch, original server alive behind a rebound socket. |
| R2 runtime-tmux — **destroy from another server's environment does not end that server's session of the same name** | Route destroy to A, then kill A by name without any guard. Both expected final name lists match. | Replace the launch on A after the caller's check; require the replacement alive and the intended old launch gone. |
| R2 runtime-tmux — **destroy keeps a newer session of the same name that another launch created** | Timestamp tolerance alone, or make destroy a no-op. This fixture uses an old-style handle and a replacement 60 seconds later. | Full-identity new handle, replacement in the same second, same-server ID difference, and successful own-launch destruction. B-1 is measured. |
| R2 runtime-tmux — **isAlive does not report 'no server' while the recorded server process still runs** | Always return true for connection failure, or throw any generic error. The assertion only excludes false and one error code. | Verified dead/reused process, process-read errors, malformed `/proc`, hidden socket rebound, repeated lifecycle polls and operator hint. |
| R2 agent-claude-code, agent-codex, agent-gemini, agent-opencode — **isProcessRunning finds the agent on the server that the handle names, from another server's environment** (four tests) | Add `-S` to list-panes while ignoring the launch/session identity. | Same name/process on the right socket but a different launch; successful explicit absence and unknown server; other helper paths such as OpenCode's attached-TUI discovery. |
| R3 workspace-worktree — **create does not remove a worktree that another launch made at the path during the checkout** | Fail immediately when the branch exists, or omit checkout entirely. Then `replaced` stays false and `!replaced || existsSync(newFile)` passes. | Successful existing-branch create with the exact requested branch, checked-out/path conflict refusal with preserved data, and no extra cleanup call. |
| R3 workspace-worktree — **spawn: postCreate keeps the files of another launch that took the record and the path during the git add** | Disable postCreate on every spawn. | Normal owned symlinks/hooks still execute; ownership changes between hook awaits; each destructive action guarded, unknown ownership retains. |
| R3 workspace-worktree — **restore: postCreate keeps the files of another launch that took the record and the path during the git add** | Disable postCreate on every restore. | Same healthy/ownership controls for restore; confirm restored workspace contents and required setup. |
| R3 workspace-worktree — **kill and restore of one ID: the active record at the end still has its worktree** | Reject every restore, suppress removal, or delete the active record so the conditional assertion is not entered. | Two real processes with both operation results checked; queued restore eventually succeeds or deliberately returns busy; final runtime/worktree/record consistency; holder death while git survives (B-3). |
| R3 core — **kill and restore of one ID: the active record at the end names a live runtime** | Reject every restore or make destroy a no-op; final record-null branches are not a positive progress assertion. | Verify the old launch is actually killed and the later accepted restore is live; independent process locking and timeout/reentry cases. |
| R3 agent-opencode — **a rollback during another spawn's session.get does not remove the session that the spawn then stores** | Disable all discard/removal, fail app-2, or never reuse. The final not-equal assertion accepts all of these. | Require successful intended reuse plus cleanup of unheld sessions; remove already dispatched before claim (B-4); cross-process session lock and unknown API completion; claim-holder crash/missing session. |
| R4 core — **spawn does not take a session number while the archive directory cannot be checked** | Reject all spawns, or reserve/start/remove before finally deleting app-1. Only the final record is checked. | No reservation/runtime/workspace side effects; precise error; healthy/ENOENT archive; worker and worktree-orchestrator allocation. |
| R4 core — **cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked** | Globally disable purge, or fix only directory listing. | Successful unheld purge, unreadable latest archive contents and omitted active record (B-7), archive/record change between checks. |
| R4 core — **recovery: a workspace that cannot be checked does not give a live session the cleanup action** | Return `recover` or `escalate` instead of cleanup; `not.toBe('cleanup')` passes. A lstat-only patch also passes while swallowing plugin errors. | Require `action='skip'`, diagnostic probeError, zero destructive actions; workspace.exists rejects; missing git executable versus path missing. |
| R4 agent-codex, agent-gemini, agent-opencode — **isProcessRunning rejects when ps fails** (three tests) | Always reject on tmux runtime, or reject one ps failure while Herdr helpers still return false. | Healthy true, successful no-agent false, multiple ps failure classes; Herdr process-info and JSON error propagation. |
| R4 agent-codex, agent-gemini, agent-opencode — **isProcessRunning rejects when the tmux server cannot answer** (three tests) | Reject every tmux error including authoritative missing-session; dead sessions then remain unknown. | Explicit target-gone from the correct identified server returns false; hidden/foreign server unknown; OpenCode internal pane-discovery route. |
| R4 runtime-herdr — **isAlive rejects when the herdr command times out** | Always throw from isAlive/getPane. | Healthy own pane true, explicit pane-gone false, malformed/error envelope unknown, callers retain resources. |
| R4 runtime-herdr — **isAlive rejects when the herdr binary cannot start** | Throw only on ENOENT or always throw, without fixing malformed successful replies. | EACCES/timeout/I/O plus malformed reply; explicit gone/identity mismatch semantics; healthy controls. |

The mocked tmux assigns monotonically increasing session IDs across *all* fake servers (`nextId` is global), unlike real tmux's per-server numbering; it cannot by itself model a new server reusing `$0`. Its format/if-shell interpreter implements the expected forms, so passing it validates the mock contract rather than actual queue behavior. Keep private-server integration coverage for the identity and guard protocol. The R3 F-5 fixtures introduce a competing operation inside mocked calls in one process; they cannot prove cross-process exclusion, canonical lock names, owner death, or safe waiter deadlines.

## Owner decisions

These recommendations are conditional on resolving the findings; they do not authorize implementation with the design unchanged.

| Decision | My option | Reason |
| --- | --- | --- |
| OD-2 identity storage | **(a), with complete immutable identity from creation** | Handle data is already carried with runtime selection. Acquire it in the creation command and include a robust server/session incarnation, not only the timestamp pair. |
| OD-3 old records | **Modified (a), plus explicit association/retirement from (b) as needed** | Never rewrite handle identity on read. Non-default negative is unknown; default negative also needs proven legacy origin. A separately stored, explicitly verified association can preserve C-04. The unqualified default assumption is unsafe outside this host assertion. |
| OD-4 hidden socket | **(a), with verified PID identity and occupied-path handling** | Keep unknown. Suggest SIGUSR1 only for the verified server with no conflicting endpoint; never infer death from unreadable process evidence or automatically signal a possibly reused PID. |
| OD-5 kill when hidden | **(a)** | Refuse and retain record/worktree until runtime termination or absence is known. Propagate refusal through callers (B-6). |
| OD-6 mechanism | **(d), revised** | Need identity + operation exclusion + F-1/F-2 fixes, OpenCode serialization/claim, and durable orphan discovery. Include surviving-child and cross-root scope; none of the simpler options closes all cases. |
| OD-7 waiting | **(a), clarified** | CLI waiter deadline 30 s; lifecycle no-wait/retry. Never expire a live holder or release while a child/API mutation remains in flight. Define token and global lock ordering; don't hold locks while awaiting an operation that needs them. |
| OD-8 OpenCode reuse | **(c), both** | Claim publication is useful to compatible readers; a service/session-scoped lock is needed for dispatched-removal races among new processes. Drain old removers; unknown API completion needs a durable quarantine/fencing rule before reuse. |
| OD-9 kept runtimes | **(c), with durable inventory that survives record deletion** | A scan cannot discover a lost private server or a Herdr handle. Store full retained identity separately and show guarded disposition, then reconcile known servers. |
| OD-10 rollback | **(a) only for a verified complete new identity; (b) fallback for old/unknown** | Corrected R2 can safely remove its own launch. Timestamp tolerance or guard execution failure cannot justify relaxing the current protective check. |
| OD-12 unreadable archive at spawn | **(a)** | Fail before reservation or side effects; suggest repairing the specific path and retrying. Allocation cannot safely assume numbers are unused. |

Additional decisions absent from §9:

- **Deployment admission and supported writers:** approve a drain/restart barrier, and define whether old writers or overlapping state roots remain supported. Do not label an overlapping mixed fleet safe.
- **Process and request lifetime:** define who holds protection until mutating child exit and how an API request of unknown completion blocks reuse. A timeout is not completion.
- **Unsupported platforms and tmux versions:** either provide and test equivalent exclusion/guard capability or fail closed with an actionable unsupported message. No silent no-lock fallback or unguarded kill.
- **Legacy/irrecoverably unknown disposition:** choose a deliberate associate/retire workflow that retains unidentified live work and records what the owner verified. Include occupied hidden sockets and corrupt/unreadable holder records.

## What I found correct

- Recording the actual selected socket and using `-S` addresses the measured environment-routing defect; `-S` wins over `-L` on tmux 3.4.
- The specified non-waiting `if-shell -F` branch is contiguous with its comparison in tmux 3.4's command queue; the comparison data and caller outcomes need correction.
- A per-ID operation lock adds protection that the synchronous per-write record lock cannot provide; a per-ID lock alone cannot protect shared OpenCode session IDs.
- The single existing-branch git add removes the specific failed-checkout cleanup hazard, and ownership checks after awaited workspace creation are needed.
- Preserving C-04, failing spawn on unreadable archives, retaining unknown resources, and placing R4 before R3 are sound intentions.
- All 25 requested defect tests independently reproduced their stated baseline assertion failures in the isolated environment.

## Preserved experiment output and reproduction details

`probe.log` (scratch experiment; source/steps described above):

```text
version tmux 3.4
precedence -L P -S Q: beta
precedence -S Q -L P: beta
same-second first: ['2356651', '2356664', '$1', '1792599067', '1792599067', '/tmp/tmux-44402/aosdr-P'] second: ['2356651', '2356669', '$2', '1792599067', '1792599067', '/tmp/tmux-44402/aosdr-P']
guard: #{==:#{session_created}/#{start_time},1792599067/1792599067}
guard result: (0, '', '')
replacement present: (1, '', "can't find session: victim")
missing identity: 2356651|1792599067|||/tmp/tmux-44402/aosdr-P
missing guard: (0, 'kept', '')
unknown format: (0, 'kept', '')
restart first: ['2356679', '2356680', '$0', '1792599067', '1792599067', '/tmp/tmux-44402/aosdr-R'] second: ['2356701', '2356702', '$0', '1792599067', '1792599067', '/tmp/tmux-44402/aosdr-R']
same timestamp pair after restart: True same session id: True
separate readback original: $3 returned: $4
hidden socket: (1, '', 'error connecting to /tmp/tmux-44402/aosdr-Q (No such file or directory)') pid alive: True
USR1 recovery: (0, '', '')
own running processes: []
```

`probe2.log` (scratch experiment; source/steps described above):

```text
original server: ['2416224', '2416234', '$0', '1792599242', '1792599242', '/tmp/tmux-44402/aosdr-hidden']
replacement server: ['2416529', '2416537', '$0', '1792599243', '1792599243', '/tmp/tmux-44402/aosdr-hidden']
original PID still running: True
original pane PID still running: True
query original by old socket path: |1792599243
guard format unsupported branch: (0, '', '')
live pane after unsupported compare: (0, '', '')
own servers and panes stopped by exact recorded PIDs
```

`lease.log` (scratch experiment; source/steps described above):

```text
{"holder":2390720,"child":2390727,"newHolderAcquired":true,"oldChildFinished":true,"replacementFilePresent":false}
```

The operation-lock child-lifetime reproducer below is standalone. Run it in a fresh `/tmp/aosdr` with the sanitized Node environment described above; it mutates only its scratch files. `holder` and `remover` are helper modes of this same file. It kills only the child PIDs it started. The measured output is preserved above.

```javascript
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const root='/tmp/aosdr';
const name='\0aosdr-operation-review';
const mode=process.argv[2];
if(mode==='remover') {
  while(!existsSync(root+'/release-child')) await delay(5);
  unlinkSync(root+'/replacement-worktree-file');
  writeFileSync(root+'/child-done','done');
} else if(mode==='holder') {
  const server=createServer(s=>s.destroy());
  server.listen({path:name},()=>{
    const child=spawn(process.execPath,[import.meta.filename,'remover'],{stdio:'ignore'});
    process.stdout.write(JSON.stringify({holder:process.pid,child:child.pid})+'\n');
  });
} else {
  const holder=spawn(process.execPath,[import.meta.filename,'holder'],{stdio:['ignore','pipe','inherit']});
  const pair=await new Promise(resolve=>holder.stdout.once('data',data=>resolve(JSON.parse(data.toString()))));
  writeFileSync(root+'/lease-pids.json',JSON.stringify(pair));
  holder.kill('SIGKILL');
  await new Promise(resolve=>holder.once('exit',resolve));
  const contender=createServer(s=>s.destroy());
  await new Promise((resolve,reject)=>{contender.once('error',reject);contender.listen({path:name},resolve);});
  writeFileSync(root+'/replacement-worktree-file','new operation owns this');
  writeFileSync(root+'/release-child','go');
  for(let i=0;i<200&&!existsSync(root+'/child-done');i++) await delay(5);
  console.log(JSON.stringify({...pair,newHolderAcquired:true,oldChildFinished:existsSync(root+'/child-done'),replacementFilePresent:existsSync(root+'/replacement-worktree-file')}));
  try {process.kill(pair.child,'SIGTERM');} catch(e) {if(e.code!=='ESRCH')throw e;}
  await new Promise(resolve=>contender.close(resolve));
}
```

For B-4, copy the fixture/imports from the committed `agent-opencode/src/same-id-reuse-window.test.ts`, add the exported `updateMetadata` import, and replace its describe block with this block. Resolve imports/mocks to the same worktree built core and real plugin. All API functions remain mocked.

```typescript
describe("reviewer claim before read", () => {
  it("an already dispatched removal can delete after the claim and read", async () => {
    const {sessionsDir,sm}=setup(async()=>undefined);
    let second: Session|undefined;
    let actualRemoval=false;
    api.get.mockImplementation(async id=>{
      const secondRecord=readMetadataRaw(sessionsDir,"app-2");
      if(secondRecord) {
        // Emulate the proposed claim transaction before reading the API object.
        updateMetadata(sessionsDir,"app-2",{opencodeSessionId:id});
      }
      return actualRemoval ? null : {id,title:"AO:app-1"};
    });
    api.remove.mockImplementation(async ()=>{
      // The real plugin has already completed its final holder check.
      second=await sm.spawn({projectId:"my-app",issueId:"INT-1"});
      actualRemoval=true;
    });
    await expect(sm.spawn({projectId:"my-app",issueId:"INT-1"})).rejects.toThrow("post-launch setup failed");
    expect(second?.id).toBe("app-2");
    expect(readMetadataRaw(sessionsDir,"app-2")?.opencodeSessionId).toBe("ses_prepared");
    expect(actualRemoval).toBe(true);
    console.log("claim before API read: app-2 successfully spawned and names ses_prepared; dispatched removal then removed it");
  });
});
```

For B-7, use the committed core same-id fixture/imports (add `writeFileSync` from node:fs), and this describe block. Both tests assert the counterexamples, so passing means the unsafe baseline behavior was reproduced.

```typescript
describe("reviewer R4 strict reads",()=>{
  let ctx:TestContext;
  beforeEach(()=>{ctx=setupTestContext();api.remove.mockClear();api.interrupt.mockClear();});
  afterEach(()=>{vi.restoreAllMocks();teardownTestContext(ctx);});
  it("a readable archive directory with an unreadable holder still permits API removal",async()=>{
    writeMetadata(ctx.sessionsDir,"app-1",{
      worktree:join(ctx.tmpDir,"ws-app-1"),branch:"feat/INT-1",status:"working",project:"my-app",agent:"opencode",opencodeSessionId:"ses_shared",tmuxName:"hash-app-1",createdAt:"2026-10-21T10:00:00.000Z",runtimeHandle:JSON.stringify({id:"hash-app-1",runtimeName:"mock",data:{}})
    });
    const archive=join(ctx.sessionsDir,"archive");mkdirSync(archive,{recursive:true});
    const holder=join(archive,"app-2_2026-10-21T10-00-00-000Z");
    writeFileSync(holder,"opencodeSessionId=ses_shared\n",{mode:0o000});
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(false);
    const sm=createSessionManager({config:ctx.config,registry:ctx.mockRegistry});
    try {
      await sm.cleanup("my-app").catch(()=>undefined);
      expect(api.remove.mock.calls[0]?.[0]).toBe("ses_shared");
      console.log("readable archive directory, unreadable latest holder: session.remove dispatched");
    } finally {chmodSync(holder,0o600);}
  });
  it("workspace.exists rejection is currently swallowed by recovery",async()=>{
    vi.mocked(ctx.mockRuntime.isAlive).mockResolvedValue(true);
    vi.mocked(ctx.mockAgent.isProcessRunning).mockResolvedValue(true);
    ctx.mockWorkspace.exists=vi.fn().mockRejectedValue(new Error("git query could not start"));
    const assessment=await validateSession({sessionId:"app-1",projectId:"my-app",project:ctx.config.projects["my-app"]!,sessionsDir:ctx.sessionsDir,rawMetadata:{worktree:join(ctx.tmpDir,"missing-path"),branch:"feat/live",status:"working",project:"my-app",runtimeHandle:JSON.stringify({id:"hash-app-1",runtimeName:"mock",data:{}})}},ctx.config,ctx.mockRegistry,{escalatePartial:false});
    expect(assessment.action).toBe("cleanup");
    console.log("workspace.exists rejected; live runtime recovery action:",assessment.action);
  });
});
```

## Final isolation and cleanup evidence

Marker: `/tmp/aosdr-marker`, 2026-10-21 12:09:16.628452553 -0400. All test/helper Node calls used a fake HOME and sanitized environment. Direct tmux calls all specified private `-L aosdr-*`; no command reached the default server. No AO command, network gh command, real model binary, OpenCode executable/service call, or model turn ran. No real worker, watcher, or managed pane was signaled. No scratch lifecycle worker was started. The only production source operations were reads and the authorized build in this worktree. `git diff --stat` was empty; the review and task/report files are untracked. No commit/push/PR.

Private tmux server and pane PIDs were recorded on creation; each remaining pane was stopped by its exact PID before its server. The lock experiment killed its holder and stopped its recorded child by exact PID. Short-lived test/build helpers exited normally. The final audit checked every recorded PID and scanned this uid's processes for the fake HOME (excluding only the auditing process, which then exited):

```text
Recorded PIDs still present: []
Own live processes: []
```

`ls -la --time-style=full-iso ~/.ao/bin` before:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

`ls -la --time-style=full-iso ~/.ao/bin` after:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

The listings are byte-for-byte identical (`diff -u` had no output).

The required state-root check was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosdr-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

Output:

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
```

Attribution of every printed path:

- `.../sessions/`: the real fleet's record replacement/rename activity; its mtime is 12:22:02.564684623 -0400.
- `.../sessions/ao-orchestrator`: the real fleet's orchestrator-status maintenance, same mtime, `status=working`, `generation=9`. The real lifecycle PID file still says 1470866 and its existing log records ao-orchestrator status transitions. The files do not record the PID of the individual write, so attribution specifically to that worker rather than an orchestrator/status-reader repair is an inference. These are **not reviewer writes**: this review ran no AO command, no helper with a real state root, and no real-fleet tmux command. No other paths were printed. In particular, the reviewer's ao-51 record was not printed in this final check.

Cleanup removed `/tmp/aosdr`, the marker, and the exact private socket files `aosdr-P`, `aosdr-Q`, `aosdr-R`, and `aosdr-hidden` after verifying all recorded processes had exited. No author scratch path under `/tmp/ao48sd` was modified. Evidence and reproduction details needed for the review were preserved in this file before scratch removal.
