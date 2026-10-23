# RH design r5 review — 2026-10-22

NOT-SOUND

The proposed RH stop can close a replacement server's pane before discovering that its listener changed (B-1). The CLI fit approach is reasonable, but its pin, startup, and cleanup contracts need changes. Prior review M-4 is partly closed, not closed. Counts: **1 blocker, 6 major findings, 2 minor findings**.

Baseline: `f66f885e` (verified with `git log --oneline -1`). This is a document review; no implementation changes, commits, network calls, or live Herdr measurements were made. The observations below distinguish fixture evidence from protocol counterexamples and unmeasured claims.

Start marker: `/tmp/aorhr5-marker`.

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

## Findings recorded before reading the author's report

### B-1 — The listener checks detect a wrong close after it has happened

**Design:** sections 3.5, 3.7 steps 5–6 and the last outcome row, 3.12 R-H2, 3.14 test 7. **Code:** `packages/plugins/runtime-herdr/src/index.ts:409`–433 (the existing refusal this protocol replaces), planned `socket-client.ts`; `packages/core/src/session-manager.ts:4483` (restore relies on stop).

The path checks are not a binding of the connected endpoint. Even giving the design a fresh LC immediately before C3, this execution is permitted: C2 returns S on server A; S and LC pass; AO is descheduled; A stops and B binds the same path and restores the same pane ID; AO connects and writes C3 to B; B closes its new pane; the post-C3 LC changes and AO returns `unknown`. A single replacement suffices. No double swap, forged response, or malicious same-uid actor is needed. `unknown` preserves AO's record but does not undo the close of B's pane. The design's last outcome row actually admits this effect, while R-H2 describes only the narrower undetected double swap.

**Evidence:** `r5_f_handoff_log.txt` proves that endpoint processes can change; `r5_g2_rename_and_cost.txt` proves LC changes with rebinding; step 1 restart/reuse fixtures establish reuse of pane IDs across runs. This is a protocol interleaving, not a newly measured live race. Tests which change LC before the precheck do not exercise it.

**Required:** establish the identity of the connected endpoint before writing a destructive request (for example a qualified peer-credential helper, with checks on that connection), or a server-side conditional close that checks the launch identity atomically. A smaller candidate correction is to connect without sending, recheck LC against LC0 before writing, and then use that already-connected socket; this needs qualification and still has the separately proposed double-swap limitation, so it is not exact peer authentication. Until qualified, keep RH refusal-only. Add a replacement after the final pre-connect path check but before connect/write, asserting zero closes on B. OD-23's accepted tmux option-shadowing limitation does not authorize this ordinary restart race; OQ-11 understates the decision.

### M-1 — A cwd match does not prove the PID namespace, and the record does not bind later `/proc` reads

**Design:** sections 3.3 step 7, 3.4, 3.12 R-H4. **Code:** `packages/plugins/runtime-herdr/src/index.ts:331` (create), `:418` (stop), `:497` (isAlive); planned `launch-identity.ts`; `packages/core/src/session-manager.ts:4483` (cleanup/restoration gate).

UID and pathname equality do not establish namespace equality. A container can see the same bind-mounted workspace and uid while the numeric shell PID names an unrelated local process; two shells can have the same cwd. More directly, a handle created on the host can later be read by AO in a container sharing the records and boot ID: `/proc/<S.pid>/stat` can return ENOENT even while the host shell lives. Section 3.4 then authorizes `absent` without any server request. A proc mount with hidden processes can similarly turn lack of visibility into ENOENT. The missing-boot-file rejection covers a wholly absent `/proc`, not these cases.

**Evidence:** `r5_d_socket_forms_log.txt` (`d_pane_process_info_root`) establishes only one local shell PID/cwd; `r5_f_handoff_log.txt` establishes continuity on that host. Neither measures namespaces, proc visibility, or later callers in another context. This is an identity-domain counterexample, not a live measurement.

**Required:** qualify and record the process-observation domain, verify it before every negative, and prove the server's numeric PID is interpreted in that domain at create. Unsupported/cross-namespace or restricted-proc contexts must retain `unknown`, including for existing records. Do not use cwd as the proof. Add host-created record/container reader and same-cwd PID collision cases.

### M-2 — F-5 does not remove the last unbound close

**Design:** sections 3.13, 5 F-4/F-5, OQ-6. **Code:** `packages/plugins/runtime-herdr/src/index.ts:359`–373, especially `:366`.

Create's exception handler still issues `workspace close <workspaceId>`. F-4 only improves the error message. If the server restarts after create and the launch call fails, that workspace ID can now designate a restored workspace or a different launch. The handler closes it without an S check. It also closes operator-added panes, whereas section 3.10 restricts RH to one pane. Making `destroy` refuse does not make the claim “no unbound close path is left” true.

**Evidence:** the existing call at `:366`, the proposed unchanged close in F-4, and the restart/reuse fixtures. This is a code/protocol counterexample, not a measured execution of the proposed implementation.

**Required:** refuse automatic create cleanup until it can use the same qualified bound stop, preserving and naming the created resources on uncertainty. Audit both close call sites. Test a failed launch after server replacement and require zero workspace/pane closes on the replacement. Changing an error message alone does not satisfy this requirement.

### M-3 — Saving `bin` does not pin the executable when `bin` is `herdr`

**Design:** section 4.7, F-6. **Code:** `packages/plugins/runtime-herdr/src/index.ts:194`, `:214`; `packages/core/src/herdr.ts:73`; `packages/cli/src/commands/session.ts:197`; `packages/cli/src/lib/preflight.ts:44`.

The default `bin` is the bare word `herdr`, and configured paths may be relative. Section 4.7 says to record `<bin>` and later execute it. Under a different PATH or cwd that resolves to another binary, so it does not implement the claimed per-handle binary pin. The socket pin is useful and independent of this omission.

**Evidence:** the current default at `index.ts:194`; `r5_e_exe_log.txt` shows why a pathname and a running executable are different facts, but no fixture exercises PATH changes for a stored handle.

**Required:** resolve the executable to an absolute path at create and use that resolved path for the discovery call and every operation, including attach. Define missing/malformed pin behavior without silently falling back to PATH. Specify that a path pin is not a content/version pin and retain actual peer qualification for RH. Test PATH and cwd changes between creation and later calls. Preflight must use the selected runtime binary and intended endpoint, rather than silently reintroducing the split.

## Further findings and completion of the review

### M-4 — Preflight on the caller's endpoint does not protect an old record on another endpoint

**Design:** sections 4.6–4.7, F-7. **Code:** `packages/cli/src/lib/preflight.ts:44`; `packages/cli/src/commands/start.ts:923`, `:1065`; `packages/core/src/session-manager.ts:572`, `:2553`.

The design acknowledges that the preflight endpoint and a stored handle's pinned endpoint can differ, but does not bound the resulting replacement. Let a still-running old server B have its socket moved; let the caller's environment select a healthy server A. Preflight on A passes. The old record's pin addresses B's now-missing path and gets the exact `server_not_running` form. Both startup classifiers read that as gone. In project workspace mode, core archives/deletes the old record and creates a second orchestrator on A while the original pane on B still runs. The guard is bypassed without any race. A same-endpoint preflight followed by socket removal has the analogous race.

**Evidence:** `r5_path_env_socket_and_env_session.cmd` and `r5_path_env_socket_and_flag_session.cmd` establish endpoint selection; `r5_c_missing_dir_cli.cmd` and `r5_c_stale_socket_file_cli.cmd` establish the exact negative form. The cited core branch deletes a record after a negative without calling stop. This is a composed counterexample, not an executed AO startup. It is more than the “wrong for the status only” limitation in section 4.6: the old active record is lost and another orchestrator is admitted.

**Required:** retain a conservative startup rule when a Herdr record's launch cannot be shown ended. Before RH, an unreachable recorded endpoint should keep that record/reject replacement, while the exact code may still support the documented lifecycle outage policy. After RH, qualified S evidence can decide. Parameterize preflight by the actual binary/endpoint and distinguish old-record reuse from new-create readiness; do not present preflight as a proof of death. Test a healthy caller endpoint with an unreachable pinned endpoint, including a hidden live old server and unchanged active record. This is a local startup guard correction, not a requirement to implement all of R3a.

### M-5 — RH-3 does not bind negative agent answers to S

**Design:** section 3.8 RH-2/RH-3; section 4.5 row 8. **Code:** `packages/core/src/herdr.ts:103`, `:127`, `:172`; `packages/plugins/agent-claude-code/src/index.ts:616`, `:996`; `packages/core/src/lifecycle-manager.ts:649`, `:662`, `:688`.

RH-3 checks the session ID of listed processes. That cannot qualify an empty list, and the row-8 `pane_not_found => []` path has no process to check. With S alive on a hidden server, RH-2 returns true, but the server now reached through the pinned pathname may report the recorded pane missing or an empty process list. The agent check returns false; because the runtime just returned true, the lifecycle now counts that negative and can mark the live session killed. Enabling RH-3 does not fix this: the per-entry check passes vacuously or is skipped. The same issue applies after a pane moves away from its recorded ID.

**Evidence:** `closedpane_pane_process_info.cmd` provides the negative envelope; `falsealive_process_info_w1P.json` demonstrates that pane-ID-only process reads can name another launch. The composed hidden-server/empty-list execution is not measured. The lifecycle's runtime-positive gate is explicit in the code above.

**Required:** for records with S, qualify the response's `shell_pid` against S and verify S's incarnation before accepting either an empty or nonempty list. A missing pane while S runs is unknown, not agent absence. Unreadable/mismatched process identity must reject the entire answer rather than filter to an empty list. Require this negative-evidence rule alongside RH-2, or explicitly retain and document the false-killed status limitation; do not call optional per-entry filtering a bound agent check. Add lifecycle tests with S alive and missing/empty/foreign pane answers. A legitimate exec of the pane shell must continue to work (see the identity assessment below).

### M-6 — NM-1 must qualify collateral effects before enabling the close

**Design:** sections 0 item 2, 3.10, 6 (NM-1 only before the live run). **Code:** `packages/plugins/runtime-herdr/src/index.ts:418` (proposed pane-close stop); current unbound workspace close `:366`.

The design says RH is right whether closing the last pane of a primary workspace returns a group-required error or closes. An `ok` plus S ending does not establish that linked workspaces or their shells survived. The unmeasured branch is precisely one where a pane close implicitly becomes a workspace close. Not passing `close_group: true` is necessary, but is not evidence about the implicit close's effects.

**Evidence:** `group_workspace_close_primary_nogroup.cmd` tests explicit workspace close; `r5_d_socket_forms_log.txt` (`d_pane_close_only_pane`) and `onlypane_confirm_on_pane_close_w1p1.json` test last-pane close without a linked group. None combines those conditions. The design explicitly labels NM-1 unmeasured. I am not asserting that 0.9.5 closes the group; the assertion that both possible outcomes are already safe is unqualified.

**Required:** make NM-1 a prerequisite to enabling RH on this case. Record before/after identities and liveness for the linked workspaces and their shells, not just the target's reply/S exit. If safe collateral behavior cannot be established, refuse the primary-with-linked-workspaces case. Keep NM-3 as a separate descendant-survival qualification; it answers a different question.

### m-1 — The socket framing contract contradicts its read loop and omits a required result type

**Design:** section 3.6 (lines 253–261), section 3.3 C1/C3. **Code:** planned `runtime-herdr/src/socket-client.ts`, called from `packages/plugins/runtime-herdr/src/index.ts:331` and `:418`.

“Read until the first newline ... then close” cannot establish “nothing follows it before EOF.” A second line in a later chunk escapes that loop. The allowed result-type list also omits `pane_info`, which create requires twice. This can produce either an under-strict reader or a create path that never records S.

**Evidence:** `r5_b_pane_get_two_lines.cmd` shows that the CLI hides a second server line; `r5_setup/r5lib.py` normally stops at a newline and closes the client, so the normal-success fixtures do not establish response EOF behavior. `r5_d_socket_forms_log.txt` contains `pane_info` for `d_pane_get_root`.

**Required:** choose one framing rule and bound it: if EOF is required, read through EOF under a total deadline/cap and qualify real-server EOF; otherwise explicitly accept one frame and remove the no-trailing-bytes claim. Include `pane_info` with its exact fields. Test a second line arriving in a later chunk, newline then no EOF, invalid UTF-8, and create's two pane-info responses.

### m-2 — Doc 0004 overstates two current behaviors

**Design:** section 8; doc 0004 sections 1 and 5a. **Code:** `packages/plugins/runtime-herdr/src/index.ts:366`, `:395`, `:485`.

The new “AO closes no Herdr workspace” sentence is too broad while create cleanup and `destroy` still call close (M-2). The new statement that the visible-output fallback runs “only on an error” is also false: `getOutput` falls through when the first successful read is empty or whitespace.

**Evidence:** `git show f66f885e -- development/0004_running_ao_on_the_herdr_runtime.md`; `otherterm_pane_read_recent_unwrapped.txt` supports shell text in this measured case, not the exclusion of an empty successful read. The code supplies both counterexamples.

**Required:** scope the first sentence to the R2a stop callers and disclose create cleanup/legacy destroy until changed; say “on an error or empty output” for the fallback. RH and the fit round are correctly labeled as designs, not implemented features.

Two accompanying evidence claims also need narrower wording. “Every CLI call is two connections” applies to the successful pane-operation samples, not `status server --json` or a call stopped by its initial ping (`r5_b0_requests_log.txt`). Section 4.6 says the fake-server `server_not_running` fixture “passes too,” but its message is `fake server says so`, which fails F1's additional no-server message-prefix condition. A fake server *could* copy the prefix; this fixture does not demonstrate acceptance by the proposed mapper. Correct those claims without weakening the parser.

## Prior M-4 closure table

“Closed” below means the design has a suitable rule backed by the named evidence; it does not mean a production implementation or its tests already exist.

| Prior M-4 point | State | Independent assessment and evidence |
| --- | --- | --- |
| Decimal-only validator rejects emitted IDs | Closed for the observed defect | `ids/workspace_create_g32.json` emits `w0:p1`, `g33.json` emits `w11:p1`, and `reuse_pane_split_w4_after_pE_closed.json` emits `w4:pF`. The proposed alphabet accepts these and `wA:p1`; the old regex does not. |
| Complete workspace and pane counter grammar | Partly closed | Workspace observations span the digit alphabet and first rollover. Pane observations stop at F; they do not independently qualify the missing symbols/rollover of that counter. Every arbitrary-length symbol string being a mathematical counter value does not prove the implementation emits it. Qualify pane rollover through `p0`/`p11`, or cite the actual encoder/limit; distinguish measured grammar from inferred extrapolation. No new live run was made for this review. |
| Version and executable qualification | Partly closed | `r5_d_socket_forms_log.txt` proves 0.9.5/22; `r5_b_ping_protocol_19.cmd` and `r5_b_ping_version_0_9_4.json` prove CLI protocol-versus-version behavior. `r5_e_exe_log.txt` disproves binary-path identity. Exact RH ping is right, but the path checks do not bind subsequent requests (B-1), and the stored CLI executable needs resolution (M-3). Self-reported version remains within a trusted-server assumption. |
| h5's catch-all `/proc` absence versus its table | Partly closed | Section 3.4 removes the catch-all and specifies errors. That is a real correction, but ENOENT is absence only in the recorded process-observation domain (M-1). h5 was not rerun or treated as the production oracle. |
| A different peer with an unknown error | Closed as an outcome rule | Section 3.7 C2 errors, including unknown codes, are unknown while S runs. `r5_b_pane_get_unknown_code` in `r5_b_cli_forms_log.txt` confirms error transport. There is no longer a different-peer-plus-error shortcut to absence. Binding of mutation is separately still open. |
| No-connection branch broader than ENOENT/ECONNREFUSED | Closed as an outcome rule | RH does not infer absence from any socket failure. `r5_c_stale_socket_file_cli.cmd`, `r5_c_regular_file_cli.cmd`, `r5_c_missing_dir_cli.cmd` distinguish the CLI fit rule from RH's conservative rule. |
| EACCES | Closed at design level | `r5_c_socket_mode_000_cli.cmd`, `r5_c_dir_no_search_cli.cmd`, and `r5_d_socket_forms_log.txt` (`d_eacces_socket_mode_000`) agree: reject/unknown, never absence. The actual production tests remain to be written. |
| Malformed/partial responses | Partly closed | `r5_b_pane_get_partial.cmd`, `r5_b_pane_get_hang.cmd`, `r5_b_pane_get_error_and_result.cmd` support rejecting those forms. Section 3.6's EOF/first-newline contradiction and omitted `pane_info` need correction (m-1); split-chunk trailing data must be tested. |
| Missing fields and unrecognized codes | Closed at design level | Required fields/types and unknown-code refusal are explicit; `r5_d_socket_forms_log.txt` supplies real invalid-request envelopes, and `r5_b_cli_forms_log.txt` supplies malformed error bodies. Never broaden the refusal into an empty list. |
| Nonexistence versus unreadability | Partly closed | EACCES/EIO/parse failure/missing boot ID are correctly unknown. Restricted proc visibility or a changed namespace can produce ENOENT without death; M-1. |
| Peers changing on each connection | Open for the mutation guarantee | The rename fixture establishes detection, not prevention. LC changing only after C3 cannot prevent the wrong close; B-1. The claimed full M-4 closure is therefore false. |
| Test the production parser/classifier | Closed as a test-plan decision; execution pending | Section 3.14 explicitly runs production modules with injected proc reads and a socket server. Good replacement for the copied h5 prototype. Add the interleavings/context cases in this review; do not count fixtures alone as execution of that classifier. |

## Launch identity and stop-table assessment

S is a useful **launch process identity**, especially across handoff. It should not be called proof that a pane object, all descendants, and all worktree users are gone. In a stable, visible PID namespace, PID plus decimal start ticks plus boot ID distinguishes the measured restart/reuse case from a continuing process. A successful `exec` replaces the executable without replacing the process, so S should stay valid; do not require the name `sh` or a fixed executable after create. A shell that is no longer a child of the server after handoff also remains valid: parent PID is deliberately absent from S. The handoff fixture shows the new server and original shell, but does not establish the shell's new PPID; no direct-child requirement should be added.

For a different user at create, the uid/cwd checks must decline to record S. For later readers with another uid, hidden proc entries or another mount/namespace, a negative requires the observation-domain gate in M-1. Completely missing `/proc` or an unreadable boot ID must reject; do not let an ENOENT on the stat path override an unknown boot/domain read. A syntactically malformed S must also reject in RH-2, not just stop: require a real UUID syntax and well-formed nonnegative decimal ticks, not simply “36 characters.” An unreadable S is not permission to fall back to pane-ID absence.

No fixture demonstrates exec continuity, a deliberate PID reuse with start-tick mismatch, cross-user reads, a container, restricted proc mounts, or a shell exiting independently of an API close. These are required unit/integration qualifications, not facts established by the successful handoff. The terminal timestamp/counter format is observational evidence, not a globally collision-proof creation token across independent servers. Keep that trust/uniqueness assumption explicit in create's use of T.

The stop table is conservative about **outcomes**: malformed records and unknown S prevent requests; S ended avoids all requests; absent/ambiguous listeners and C1/C2 errors prevent a close; different shell or missing pane while S runs stays unknown; C3 errors, response loss, changed LC, or a still-live shell do not authorize cleanup. Preserve those rules. Specify that a failed proc read during the five-second confirmation poll yields unknown (or may be retried within the bound, with no successful outcome absent a later valid ended read). However, outcome conservatism is not mutation safety: B-1 occurs before the final outcome is known.

R-H1 needs explicit owner acceptance after NM-3. It includes a foreground or same-session descendant that ignores HUP, not only a process that escaped with `setsid`; OD-14's exclusion of children leaving a process group does not automatically accept all of those survivors. A real-Claude close check is useful evidence for a supported workload, not proof about every future descendant. R-H2 is a genuine weaker trust contract than peer credentials; fix B-1 before evaluating acceptance of the narrower double-swap risk. R-H3 (handoff during stop => unknown) is reasonable only once the pre-write destination guard is fixed. R-H4 is not enforced by cwd (M-1). R-H5 (moved pane => stop unknown while S lives) is conservative; its agent/lifecycle consequences need M-5.

## CLI read contract and startup

I favor option (a) for the fit round: a shared stderr-envelope classifier is smaller and matches the measured 0.9.5 CLI. Keep the legacy stdout/exit-0 forms because they are the explicit existing R4 contract. Do not silently change the positive-list or replaced-terminal rules while adding the new forms. Raw terminal text on successful `pane read` must stay text; only the failure branch needs F1 classification.

F1's exit code, signal/timeout, empty stdout, one-line stderr, exact-key, object and string checks are good. Extra keys and later-version variations rejecting is an intentional conservative compatibility cost. Ensure “exact keys” rejects arrays and null. The new F1 `id` test is wider than the measured negatives: it accepts any text, even an empty or unrelated request ID. Prefer comparing to the command's measured ID (`cli:pane:get`, `cli:pane:process_info`, etc.) for the newly accepted negative forms; test a mismatched ID explicitly. This does not require changing the legacy stdout contract. The CLI may itself discard trailing server lines, so accepting F1 does **not** qualify the raw wire frame; option (a) deliberately trusts the CLI boundary.

Map only numeric exit 1, F1, `server_not_running`, and the stipulated message prefix to `RUNTIME_NO_SERVER_ERROR_CODE`; retain the code at the top level after wrapping errors in `getPaneStrict` or `herdrCannotAnswer`, since callers inspect `err.code`, not only its cause. Rust EACCES text, protocol mismatch, signals, timeouts, extra output, and unknown codes remain ordinary failures. Rows 8/9 must explicitly name both channels and preserve the malformed-ID/empty-ID distinctions. No-server evidence means no reachable listener **at the selected path**, not proof that a hidden server or its launch ended. The lifecycle's five-minute policy is a status policy; M-4 prevents using it unconditionally as startup replacement authority.

Preflight is useful for a fresh Herdr launch and prevents the common no-server failure from modifying the record first. It is not sufficient as stated (M-3/M-4), and it need not prevent reuse of a live pinned record simply because the caller's default socket is down. Specify placement before relevant record mutations, preserve `--no-orchestrator` behavior, and test project versus isolated orchestrator workspace modes. A direct core `spawnOrchestrator` call also needs the conservative old-record rule; a CLI-only preflight cannot protect it.

The socket pin belongs in the fit round. Resolve and pin before workspace creation, and pass it to creation, launch, cleanup, polling, send, output, core agent reads, and attach. Legacy records lacking both pin fields are explicitly weaker and remain environment-dependent; document that exception rather than claiming the fit makes every existing record endpoint-bound. A malformed or partially present pin must reject rather than silently downgrade to ambient lookup. The pin names a path, not a server incarnation.

## Fit round, coverage and dependencies

| Item | Assessment / required acceptance |
| --- | --- |
| F-1: W-1, W-2, W-6 | Correct shared-reader direction. Exercise the real wrapped errors through runtime/core/lifecycle/start, preserving the no-server code and rejecting all F1 near misses. Startup consequence needs M-4. |
| F-2: W-8 | Correct: validate before the process/command call; a synthesized AO session name is not a pane ID. Empty row-8 ID remains `[]` without a call; empty runtime handle is not evidence to close anything. Qualify pane rollover as above. |
| F-3: W-3 | Correct: blocked-at-gate and agent-prompt refusal must bypass raw fallback and forced restore, with one-line CLI output. Include blocked during a retry/settle poll, not only at the initial gate. Do not label a later refusal “nothing admitted” if an earlier attempt already reached the agent; distinguish that earlier delivery uncertainty (W-4). |
| F-4: W-5a | Error reporting is useful but insufficient; eliminate/refuse the unbound cleanup close, M-2. An unclassified transport failure also needs a resource identifier and conservative cleanup text, not an invented Herdr code. |
| F-5: W-5b | Move destroy refusal earlier. Explicitly change the old positive-destroy control and `index.test.ts:165`–186 oracles as proposed, and retain stop's unknown control for legacy handles. This is a deliberate behavior change, not merely parser maintenance. |
| F-6: pin | Necessary before making negatives effective. Resolve the executable (M-3), pass handle data through all four agent call sites, and cover mixed/legacy metadata and attach. |
| F-7: start | Useful readiness guard; qualify the endpoint/binary and old-record behavior (M-4). It is not an atomic death check. |
| F-8: W-7/W-9/comments | Appropriate documentation work. Correct the empty-output fallback wording and scope the no-close claim (m-2). Keep R4 docs and CLAUDE.md synchronized with the implemented reader. |
| W-4: later send round | Explicitly deferred, so no W item is lost. From `done`, do not resend an unconfirmed admitted prompt or run raw-input fallback; make “sent, not confirmed” survive core retry logic. `idle` is not proof of non-admission either, so retain that duplicate risk explicitly until a stronger receipt is available. Real-Claude timing measures frequency, not an exactly-once guarantee. |

M is a reasonable size for the fit round, but the named product-file list is **13 files**, not “about 10”: core herdr/index/types/session-manager (4), runtime-herdr index (1), four agents (4), CLI send/start/session/preflight (4), before docs/tests. The safety and endpoint changes deserve separate acceptance checks within that round. F-4's correction is an additional scope item made necessary by the no-unbound-close claim.

Fit before RH is sensible. R2a's confirmed-stop gate is already available; RH need not inherit RW's inbox, tmux tokens, legacy association, or OpenCode holds. Fixing the destination guard belongs inside RH and does not require R3a's full operation lock: a lock on AO IDs cannot serialize external Herdr restart/handoff anyway. Conversely, section 3.13 should claim only runtime-stop isolation, not comprehensive same-ID workflow serialization. Two stops may overlap before either sees S end; that is not proved safe merely by saying “the second finds S ended.” Once the pre-write endpoint and launch checks are qualified, the second may conservatively see not-found/unknown or confirmed absence. Core's existing launch CAS and restore's stop-before-recreate are necessary caller protections, not substitutes for that qualification.

Run production classifier tests first; then the isolated matrix and RH live checks. NM-1 and the supported-process termination/observation checks are gates before enabling destructive behavior, not optional observations after implementation is declared accepted. Keep no-live-handoff operating guidance for old handles until a qualified RH-2 path actually covers them.

## Fixture spot-check audit

All fixture paths in this table are relative to `development/artifacts/herdr_095_live_check/`. These are direct reads of saved artifacts, not reruns. The table supplies more than the requested ten checks and names both supporting and limiting evidence.

| # | Design claim | Fixture checked | Result |
| --- | --- | --- | --- |
| 1 | Server is 0.9.5/protocol 22 | `r5_d_socket_forms_log.txt`, `d_ping` | Matches exact version/protocol and pong type. |
| 2 | CLI first pings, then performs pane get on another connection | `r5_b_cli_forms_log.txt`, `b_pane_get_result` | Two recorded requests match. “Every CLI call” is too broad; `r5_b0_requests_log.txt` has one connection when ping fails, and status is itself a ping-based read. |
| 3 | Closed pane get is exit 1, empty stdout, stderr envelope | `closedpane_pane_get.cmd` | Matches `pane_not_found`, `id=cli:pane:get`. |
| 4 | Closed-pane process-info is the same error transport | `closedpane_pane_process_info.cmd` | Matches; request ID is `cli:pane:process_info`, message is only `pane not found`. Do not require the pane ID in message text. |
| 5 | Closed workspace's pane is also pane-not-found | `closedws_pane_get.cmd` | Matches for `w2:p1`. |
| 6 | EACCES is ordinary Rust debug stderr, not no-server | `r5_c_socket_mode_000_cli.cmd`, `r5_c_dir_no_search_cli.cmd` | Both exit 1, empty stdout, `PermissionDenied`/code 13. Raw errno is independently in `r5_d_socket_forms_log.txt`, `d_eacces_socket_mode_000`. |
| 7 | Missing path, stale socket, regular file use no-server | `r5_c_missing_dir_cli.cmd`, `r5_c_stale_socket_file_cli.cmd`, `r5_c_regular_file_cli.cmd` | All have exact prefix and code, with the selected path in the message. They prove endpoint unreachability, not a hidden process's death. |
| 8 | Protocol 19 is refused; version 0.9.4/protocol 22 is accepted | `r5_b_ping_protocol_19.cmd`, `r5_b_ping_version_0_9_4.cmd`, `r5_b_ping_version_0_9_4.json` | Matches. The CLI is not an exact-version gate. |
| 9 | CLI forwards contradictory envelopes | `r5_b_pane_get_error_and_result.cmd` | Both keys appear on stderr; F1 correctly rejects this. |
| 10 | Partial data rejects; no response can hang | `r5_b_pane_get_partial.cmd`, `r5_b_pane_get_hang.cmd` | EOF-while-parsing error versus capture timeout at 45 seconds; retain AO's timeout. |
| 11 | CLI accepts only the first server line | `r5_b_pane_get_two_lines.cmd` plus `r5_b_cli_forms_log.txt` | Observed first error envelope on stderr; the second line is not visible to AO. F1 strictness is at the CLI-output boundary. |
| 12 | CLI does not validate response ID | `r5_b_pane_get_wrong_id.json` | `id=someone-else` is forwarded with a pane result. Newly accepted negative F1 responses should compare expected IDs. |
| 13 | A fake server's no-server envelope passes the mapper | `r5_b_pane_get_server_not_running_from_server.cmd` | **Does not match the proposed mapper:** message is `fake server says so`, lacking its required prefix. Shows forwarding only; m-2. |
| 14 | Socket override wins over environment session; flag session wins over override | `r5_path_env_socket_and_env_session.cmd`, `r5_path_env_socket_and_flag_session.cmd` | Matches respectively `/tmp/aohd2/s/custom.sock` and `.../sessions/aohd2-flag/herdr.sock`. |
| 15 | Status JSON exposes socket with/without running server | `r5_d_status_server_json_running.json`, `r5_path_base.json` | Matches; status/running and version/protocol differ, socket remains present. Exit status is established by their capture descriptions. |
| 16 | A pane inherits the Herdr endpoint variables | `r5_d_pane_env.txt` and `r5_d_socket_forms_log.txt` | Includes socket, session, binary, pane/tab/workspace IDs. Supports environment-dependent calls and the pin rationale. |
| 17 | Removing the executable does not end the server or change its ping | `r5_e_exe_log.txt`, `r5_e_status_json_copy_removed.json` | Same peer PID/ticks and 0.9.5/22; exe link gains `(deleted)`; stale flag remains false. |
| 18 | Live handoff preserves S but changes server and terminal | `r5_f_handoff_log.txt` | Server 56174 -> 59284; shell 59278 retains ticks 19984167; terminal changes; pane `w1:p1` stays. One shell-only pane was measured, not an AO/real-Claude handoff. |
| 19 | Node 25 exposes no socket peer-credential method in the examined API | `r5_g_node_peer_api.txt` | v25.7.0 shows `_getpeername`, no credential method on the examined handle. Supports needing another mechanism; not a qualification of every supported Node version/native facility. |
| 20 | Listener rename retains the old bind-path text | `r5_g2_rename_and_cost.txt`, with `r5_setup/r5_g_rename.py` | Transcript shows one old entry after rename, two after new bind, then one after old close. It is explicitly a transcription, not retained raw output. No destructive race was measured. |
| 21 | Handoff listener is held only by the new server | `r5_g_listener_after_handoff.txt` | One listed holder, PID 59284/fd14, equals ping peer. This one observation does not bind a future connection. |
| 22 | Workspace counter uses nondecimal symbols and rolls to `0`, `11` | `ids/workspace_create_g32.json`, `ids/workspace_create_g33.json` | Exactly `w0`, `w11`. Pane evidence `ids/pane_split_w4_14.json` is `pE`; `reuse_pane_split_w4_after_pE_closed.json` is `pF`. Complete pane rollover remains inferred. |
| 23 | Reused pane ID can list another session's claude | `falsealive_pane_get_w1P.json`, `falsealive_process_info_w1P.json` | Same pane `w1P:p1`, cwd of `aohd-4`, shell 3044179, foreground claude 3044197. Confirms need for launch identity. |
| 24 | Last-pane close removes a plain workspace; group close may refuse | `r5_d_socket_forms_log.txt`, `d_pane_close_only_pane` / `d_workspace_get_after_only_pane_close`; `group_workspace_close_primary_nogroup.cmd` | `ok` then `workspace_not_found`; separate group test refuses. No primary-plus-linked last-pane test: M-6. |
| 25 | `agent_blocked` refuses a prompt | `blocked_herdr_agent_prompt.cmd` | Exit 1, exact error and CLI request ID; supports F-3, rather than sending raw input into the dialog. |
| 26 | One short-turn send can be delivered three times | `shortturn_ao_send_from_done.cmd`, `_logs/standin/claude-standin.3056196.log` | Send lasts 28,145 ms; log has the same short-turn message at 1792700697.438..., 1792700709.995..., 1792700722.546.... This is a stand-in result, not measured real-Claude frequency. |
| 27 | Agentless recent-unwrapped returns shell text | `otherterm_pane_read_recent_unwrapped.txt` | Contains a shell diagnostic/prompt. Does not imply every successful read is nonempty; m-2. |
| 28 | Invalid requests, partial requests, and repeated closes have conservative distinguishable forms | `r5_d_socket_forms_log.txt` | Missing params/type errors return `invalid_request`; no-newline write shutdown returns EOF/no answer; double request resets; repeated second-pane close returns `pane_not_found`. Supports the planned refusal branches, not the unimplemented parser itself. |

Unbacked central claims are not silently promoted to facts: safe implicit group-close effects (NM-1), actual Claude/descendant termination (NM-3/R-H1), namespace equivalence from cwd, peer binding by LC, full pane-counter grammar, EOF-after-valid-response behavior, exec continuity, and a pinned bare executable across PATH changes all need the qualification or design corrections specified above. No fixture closes those gaps by itself.

## Doc 0004 assessment

The diff at `f66f885e` covers the ten planned topics and explicitly preserves the 0.8.0 context. Its 0.9.5 error-channel, socket-selection, blocked-prompt, stand-in timing, restart/reuse, and last-pane facts agree with the checked fixtures. It clearly calls RH and the fit round unbuilt. The attach implementation agrees with `session.ts:196`–209; the actual interactive attach was refused by the measuring shim, and the source-based claim should remain distinct from a live attach test. Handoff effects on AO are correctly labeled as inferred from code, not an AO handoff run. Fix m-2 and qualify “every pane”/full grammar as extrapolation from the measured sample. No direct changes to that document were made in this review.

## OQ-1 through OQ-11

| Question | Reviewer recommendation |
| --- | --- |
| OQ-1: CLI or raw socket for the non-RH reads | **(a), with the stated corrections.** Use one strict shared CLI failure reader, preserve the 0.8.0 contract, compare expected IDs on new negative forms, and separate exact endpoint failure from launch death. Revisit raw reads after there is a qualified client. |
| OQ-2: pin timing | **(a), in fit.** Resolve the executable to an absolute path, pin the endpoint before create, pass both throughout, and reject malformed partial pins. Legacy records remain an explicit exception. |
| OQ-3: launch identity | **S is the better launch identity, but reject the proposed LC mutation binding as written.** These are separate choices: S can survive handoff while a per-operation connected-endpoint check protects the close. Add the observation-domain gate (M-1). The alternatives in the question should not force a choice between handoff continuity and connection safety. |
| OQ-4: RH-2 liveness from S | **Yes after qualification.** It fixes the measured terminal-change false negative. Require validation/domain checks and the negative-agent integration in M-5; otherwise do not advertise full hidden-server/moved-pane lifecycle correctness. |
| OQ-5: duplicate sends | **(a), as a named later round.** One attempt from done and “sent, not confirmed” is better supported than retrying on lack of working. Remove the raw fallback/core restore retry for an admitted but unconfirmed send too. An idle retry still has a duplicate risk; `--wait` is not a turn receipt. |
| OQ-6: destroy refusal | **(a), now.** Explicit oracle changes are appropriate. Also address create cleanup (M-2); destroy is not the last unbound close. |
| OQ-7: startup preflight | **(a) for launch readiness, with M-3/M-4.** Probe the intended binary/endpoint and retain old records when their launch death is unproved. Do not mistake successful caller-socket preflight for permission to replace a record pinned elsewhere. |
| OQ-8: authoritative runtime | **(a), not now.** If later enabled for qualified S handles, gate per handle rather than putting every legacy Herdr record into an unconditional runtime-name set. A passing stop run alone does not validate all negative liveness paths. |
| OQ-9: temporary no-handoff rule | **(a).** Keep it for existing handles without S even after RH-2 ships, and while S capture can fail open to a legacy handle. Completion of a deployment is not evidence that all live records acquired S. |
| OQ-10: accept R-H1 | **Defer until NM-3 and explicit acceptance of the narrower guarantee.** I support keeping broad daemon containment out of this round, but the guarantee must name same-session/HUP-ignoring survivors too. OD-14 is not blanket prior authorization. A real-Claude measurement qualifies that workload only. |
| OQ-11: accept R-H2 or add peer helper | **Do not accept (a) as currently described.** B-1 needs only one replacement, not a malicious double swap. First fix/qualify the pre-write guard; then present the remaining double-swap risk as a separate owner decision. A qualified peer helper is a reasonable option and is compatible with S as launch identity. OD-23 is an analogy, not an already-decided Herdr exception. |

## What is correct

- The measured handoff invalidates a server-incarnation-only launch identity and terminal-ID-only liveness; recognizing S continuity is valuable.
- The 0.9.5 stderr change explains the current false unknowns; the fit reader and invalid-pane-ID gate address actual recorded failures.
- Explicit EACCES/parse/protocol rejection, S-based no-request absence in a qualified observation domain, and refusing legacy stops are the right conservative defaults.
- The blocked-send refusal must reach the user without fallback or forced restore. The proposed end-to-end refusal tests cover the relevant layers.
- Refusing `destroy`, retaining exact R4 near misses, naming oracle changes, and testing production modules instead of h5 are sound planning choices.
- Scope separation from RW/tmux/OpenCode work is reasonable; those rounds are not a remedy for the new Herdr endpoint race.

## Review process, author consultation and verification

I read the design and prior RH section, review-r4 M-4, step-1 report and raw fixtures, R4 table, D-8 decisions, affected code and doc diff before consulting the author's report/brief. B-1 and M-1 through M-3 were written into this file before that consultation. The later report repeats the full-M-4-closure and LC-binding claims; it supplies no additional evidence that resolves B-1 or the observation/pin issues. Its declared stand-in limitations and transcript provenance are retained in this review.

No live measurements were performed: no Herdr, AO, tmux, Node, pnpm, real agent, network, helper script, or private server was run. Consequently there are no review-owned server/agent PIDs to stop and no `/tmp/aorhr5` scratch tree was created. The mandated `/tmp/aorhr5-marker` exists. I did not inspect the owner's Herdr config or other panes; the conditional live-run cleanup `find` scans were unnecessary and were not run. The quoted `~/.ao/bin` listing was repeated at completion and was identical.

Only this review file and the explicitly required `.agent_report.md` were written in the worktree. `.agent_task.md` was supplied by the orchestrator and left unchanged. `git status --short` showed those three untracked paths and no tracked changes; `git diff --exit-code -- packages docs .github agent-orchestrator.yaml` passed. Builds/tests were not run because this is a review-only task with no product change. No branch operation, commit, fetch, push, PR, or message to another session was made.
