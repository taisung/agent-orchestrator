# Same-ID design, revision r2: R2, R3 and R4 (ao-52)

Author: ao-52 (Claude Code, Opus 5.5), 2026-10-21. Base: `c516cead`. This revision answers review r1
(`development/reviews/same_id_design_review_r1_astra6.md`, ao-51, Codex gpt-6-astra). For R1 (exact
targets) see design r1 (`development/reviews/same_id_design_r1_opus.md`) section 2, and for the
measured defects D-A to D-D see its section 1. This file replaces design r1 sections 3 to 9 for the
rounds R2, R3 and R4.

- Commits of this round (tests only, local): `a5d57b41`, `628e0fbf`. Range `c516cead..628e0fbf`.
- No source file changed. The prototype, the scripts and their output are outside the repository,
  under `/tmp/aosd2/` (pasted in sections 12 to 14).
- Owner basis: answers "1a 2a" of 2026-10-21. The working basis is the reviewer's "Owner decisions"
  table. Section 6 says where I differ and why.

## 0. Response table

| Finding | Decision | Revised design | Test |
| --- | --- | --- | --- |
| B-1 timestamp pair names another launch | Accept | 2.1 to 2.3: a tmux name per launch, and the identity (boot ID, server PID, raw start ticks, `$N`) | runtime-tmux `same-id-defects-r2.test.ts`, B-1: 4 defects, 2 controls. Live: m4 sections 3 and 5, m7 section 1 |
| B-2 separate read-back adopts another launch | Accept | 2.3: the identity comes from the `new-session -P -F` answer of the create. Launch keys go only to `=<launch name>:` | runtime-tmux r2, B-2: 1 defect, 1 control. Live: m4 section 4 |
| B-3 lock ends before the child | Accept | 4.2: the lock socket's descriptor goes to every mutating child, so the kernel frees the name only after the child ends (measured, m6). OD-14 | m6 (both variants). R3a test list (section 7) |
| B-4 claim before read vs a dispatched removal | Accept | 4.4: an OpenCode session lock for the claim, the read and every removal, and a write-ahead quarantine for a request with unknown completion. OD-8 (c) | The review's reproducer. R3b test list |
| B-5 another server answers at the recorded path | Accept | 2.5: a negative answer counts only from the recorded server process, or after the recorded process is proven gone | runtime-tmux r2, B-5: 2 defects, 3 controls. Live: m5, m7 section 2 |
| B-6 guard failure must stop the caller | Accept. The "guard capability" part: accept in another form (2.6) | 2.6: `Runtime.stop` with four outcomes and the core helper `stopRuntime`, read by seven callers. 2.7: the lifecycle gate. The destroy has no format compare any more, so the capability check moves to create | core r2: 7 caller defects, 2 lifecycle defects, 4 controls. runtime-herdr r2: N-1 |
| B-7 strict reads throughout | Accept | 3: eleven items, each with an "explicit gone" control and a healthy control | core r2 items 1 to 3 (7 defects). workspace-worktree r2 (2). runtime-herdr r2 (2) |
| M-1 legacy provenance | Accept | 2.8: unknown by default. Explicit `associate` and `retire`. An opt-in host assertion. OD-3, OD-16 | R2b test list |
| M-2 lock protocol | Accept | 4.1 (token, nesting, order, deadline, no expiry, platform, kinds) and 4.3 (the path lock) | R3a test list |
| M-3 discovery loses kept runtimes | Accept | 4.6: a write-ahead inventory outside the records. OD-9 (c) | R3a test list |
| M-4 mixed builds | Accept | 5: the barrier, and a build epoch per state root. OD-13 | Runbook checks in section 5 |
| Review note "B-6 also affects the R2/R4 boundary" (`lifecycle-manager.ts:640-709`) | Accept | 2.7: the gate moves into R2a | core r2 lifecycle: codex and claude-code |
| N-1 (new) Herdr destroy closes a reused pane ID | New | 2.6: Herdr `stop` compares the terminal ID | runtime-herdr r2 N-1: 1 defect, 1 control |
| N-2 (new) restore drops a failed destroy, then creates | New | 2.6, 2.10: with a name per launch, tmux no longer refuses the second session | core r2 restore: 1 defect, 1 control |
| N-3 (new) the `if-shell -F` guard is not fail-closed on tmux 3.4 | New | 2.1: inner commands take no formats, an unknown operator over a nested format is TRUE, and a failure inside `if-shell` does not stop the list | m1, m2, m3 |

I reject no finding. All tests of this round are in new files. Each `defect` test fails on `c516cead`
for the measured reason (section 8). The full run stays green with the marking (section 9).

## 1. What changed from design r1

1. **Identity (B-1, B-2).** Design r1 kept one tmux name per session ID and guarded the destroy with a
   timestamp compare. Revision r2 gives each launch its own tmux name `<base>-r<8 hex>`. Every target
   is `=<launch name>` or `=<launch name>:` (R1 helpers), so a target can address only that launch. No
   `if-shell` guard is necessary. The identity in `handle.data` is the server incarnation (boot ID, PID,
   raw start ticks) plus the session ID `$N`, all read once at create.
2. **Server check (B-5, F-7).** A negative answer counts only when the answering server is the
   recorded server process, or when the recorded process is proven gone. A read failure of `/proc` is
   "unknown", never "gone". The bounded `ERR_RUNTIME_NO_SERVER` rule does not apply to new handles.
3. **Stop result (B-6).** `destroy(): Promise<void>` cannot tell "stopped" from "kept". A new optional
   `Runtime.stop()` answers `destroyed`, `absent`, `other-launch` or `unknown`. Only `destroyed` and
   `absent` let a caller remove a workspace, archive or delete a record, or create a runtime for the ID.
4. **Lifecycle gate.** While the runtime probe could not answer, an agent's negative does not reach
   `killed`.
5. **Legacy records (M-1).** Unknown by default. The owner can associate or retire a record. A host
   assertion is opt-in.
6. **R3 (B-3, B-4, M-2, M-3).** A per-operation token, a fixed lock order, the lock descriptor passed to
   mutating children, a path lock, an OpenCode session lock with a quarantine, and a durable inventory.
7. **Rollout (M-4).** A barrier that closes admission, stops the resident workers first, drains, builds,
   restarts and then opens admission. A build epoch per state root refuses an older new build.
8. **Rounds.** R2a (stop result and gate), R2b (identity), R4, R3a (operation lock), R3b (OpenCode).
   The owner's order R2, R4, R3 stays.

## 2. R2: server and launch identity

### 2.1 Options for the identity (B-1)

All rows are measured on tmux 3.4, private servers only (section 12).

| Option | Same-second replacement | Server restart, same path, same second | Reused PID | A pane command (keys, paste, capture) of an ended launch | Fail-closed on a tmux without the compare | Size |
| --- | --- | --- | --- | --- | --- | --- |
| (a) design r1: stable name, guard on `session_created/start_time` | **kills the replacement** (m1 section 3, review B-1) | kills the new server's session | not covered | reaches the replacement | no | S |
| (b) stable name, `$N` plus timestamps | protected | **`$0` repeats** (m4 section 5, review B-1) | not covered | reaches the replacement unless guarded | no | S |
| (c) stable name, session option `@ao_launch` token, `if-shell -F` guard on each pane command | protected for plain inner commands (m2 section 2) | protected (the token is per launch) | protected | each command needs its own guard. A paste can be guarded (m2 section 4) | **no**: an unknown operator over a nested format is TRUE (m2 section 3); a failure inside `if-shell` does not stop the next command (m3); inner commands with `#{` or `$` do not parse (m1 section 4, m2 section 2) | M |
| (d) **a tmux name per launch** `<base>-r<8 hex>`, identity = boot ID + PID + start ticks + `$N` | protected: the old name is gone, the kill finds nothing (m4 section 3) | protected: another PID and another tick count (m4 section 5) | protected (2.2) | fails with "can't find session" (m4 section 4) | not necessary: the destroy has no compare | M |

**Recommendation: (d)** (OD-17). The target itself is the identity, so no command needs a guard and no
command depends on format support. tmux refuses a second session with the same name on one server,
so two launches can never share a target. It works unchanged for every pane command: keys, paste,
capture, metrics and attach.

Risk of (d) that (c) does not have: an old client (before R1) uses plain targets, and a plain target
matches by prefix (D-A). An old `kill-session -t <hash>-kr-1` can match `<hash>-kr-1-r1a2b3c4d`. The
barrier of section 5 removes every old client before R2b admits new launches.

### 2.2 The launch identity

| `handle.data` field | Source | Read at | Used by |
| --- | --- | --- | --- |
| (`handle.id`) the launch name `<tmuxName>-r<8 hex>` | runtime-tmux `create`, `randomBytes(4)` | create | every target, `=<id>` or `=<id>:` |
| `tmuxSocket` | `#{socket_path}` of the `new-session -P -F` answer | create | `-S <tmuxSocket>` on every call with the handle |
| `tmuxServerPid` | `#{pid}` of the same answer | create | `isAlive`, `stop`: compared with the `#{pid}` of the server that answers |
| `tmuxServerStartTicks` | `/proc/<pid>/stat` field 22, raw clock ticks since boot, kept as a string. The parser splits after the last `)` and checks every field | create, directly after the answer | the recorded-process check |
| `tmuxBootId` | `/proc/sys/kernel/random/boot_id` | create | the recorded-process check |
| `tmuxSessionId` | `#{session_id}` (`$N`) | create | `isAlive`: compared with the answer |
| `tmuxSessionCreated` | `#{session_created}` | create | diagnostics only, never identity |
| `tmuxVersion` | `#{version}` | create | the capability check (OD-15), diagnostics |
| `createdAt` | today's field | create | legacy rules only |

Why no two launches share the identity:

1. **One server process** is (boot ID, PID, start ticks). A live process has exactly one PID. A process
   that gets a reused PID starts after the old one ended, so its tick count is larger. A reboot changes
   the boot ID. Measured: a restart in the same second gave PID 3013015, then 3013041, and ticks 9421764,
   then 9421773, while `$0` and both timestamps repeated (m4 section 5).
2. **One session** of that server is `$N`. tmux numbers sessions with a counter of the server process, so
   a number does not come back while that server runs. Measured: `$1` and `$2` in the same second
   (m4 section 3).
3. **The name.** tmux refuses a duplicate name on one server. A suffix collision (32 bits) makes the
   create fail with "duplicate session". It never adopts another launch.
4. The ticks are compared raw. `btime + ticks/CLK_TCK` (CLK_TCK is 100 on this host) is not used, so a
   clock change has no effect.

Remaining assumption: two processes with one PID in one tick (10 ms) need a full PID wrap-around inside
that tick. `pid_max` is 4194304 on this host.

### 2.3 Create (B-2)

runtime-tmux `create` (`runtime-tmux/src/index.ts:110-166`) does these steps:

1. One client command on the caller's environment (the same `PATH`, so the same shim):
   `tmux new-session -d -P -F '#{session_id}|#{session_created}|#{pid}|#{version}|#{socket_path}' -s <launch name> -c <workspace> -e ...`.
   The answer comes from the command that made the session, so no later read can adopt another launch.
2. Parse the answer: `$N`, decimal digits, a version not below the minimum (OD-15), and an absolute
   socket path. The socket path is the last field, so a `|` in the path cannot move the other fields. On a parse failure, `tmux -S <socket> kill-session -t =<launch name>` (only this launch has the
   name), then fail.
3. Read `/proc/<pid>/stat` field 22 and the boot ID. On a read failure: kill as in step 2, then fail.
4. The confirm and the first launch keys are one client command on `-S <socket>`:
   `display-message -p -t =<launch>: '#{pid}|#{session_id}' ; send-keys -t =<launch>: ...` (or `load-buffer` and
   `paste-buffer` for a long command). The printed PID must equal the recorded PID. The server answered
   before and after the `/proc` read, so the PID was not reused in between, and the ticks belong to it.
   If the session ended, `send-keys` fails ("can't find session", m4 section 4): no keys reach another
   session, and the create fails.
5. Return the handle with all fields. The handle is written once, so `launchIdentity` stays stable
   (design r1 section 6, kept).

The prototype (section 13) does steps 1, 2, 3 and 5. It does not yet print the confirm PID in step 4.

The name is chosen in runtime-tmux, not in core. Core passes `tmuxName` as `sessionId` to
`runtime.create` (`session-manager.ts:2095`, `:2631`, `:4267`) and stays unchanged. runtime-herdr is not
affected. `AO_TMUX_NAME` (`session-manager.ts:1986`, `:2512`, `:4275`) keeps the base name. Nothing in
the repository reads it (grep, 2026-10-21).

### 2.4 Server routing

Every call with a handle adds `-S <tmuxSocket>`. A core helper `tmuxServerArgs(handle)` returns
`["-S", socket]` for a new handle and `[]` for a legacy handle. `-S` wins over `-L` with both option
orders (review, measured). Calls without a handle use the caller's environment. Node never computes a
socket path for routing (design r1 section 3.2, kept). The socket path is one argv element, and it is
shell-escaped when ao prints it.

Call sites: every method of runtime-tmux; the `list-panes` of the four agents (claude-code, codex,
gemini, opencode, also OpenCode's pane discovery `agent-opencode/src/index.ts:646-680`); core
`session-manager.ts:1033` (the raw `has-session` of the holder check) and `:518-530`
(`getTmuxForegroundCommand`); core `tmux.ts`; CLI `send.ts` (`:107-129`, `:261`), `session.ts` attach
(`:173-200`), and `status.ts`.

### 2.5 `isAlive` (B-5, F-7)

Query: `tmux -S <tmuxSocket> display-message -p -t =<launch>: '#{pid}|#{session_id}'`.
`display-message` prints the answering server's `#{pid}` also when the target is missing. Then the
session fields are empty (review, measured).

| Answer | Recorded process (below) | Result |
| --- | --- | --- |
| `<recorded pid>\|<recorded $N>` | - | `true` |
| a session answers, but its PID or `$N` differs | - | reject `ERR_RUNTIME_PROBE` (only a suffix collision on another server can give this) |
| empty session fields, PID = recorded | runs | `false`: the recorded server says "no such session" |
| empty session fields, another PID | gone | `false` |
| empty session fields, another PID | runs | reject: "another tmux server (`<pid>`) answers at `<socket>`, the recorded server `<pid>` still runs" |
| empty session fields, another PID | unknown | reject |
| "no server running", "error connecting ... (No such file or directory)", "Connection refused" | gone | `false` |
| same | runs | reject: "server `<pid>` runs, nothing answers at its socket" plus the hint |
| same | unknown | reject |
| any other error | - | reject |

The recorded-process check (`recordedServer` in the prototype):

- The boot ID differs: **gone**.
- `/proc/<pid>/stat` gives `ENOENT` or `ESRCH`, or the state is `Z` or `X`: **gone**.
- The start ticks differ: **gone** (the PID belongs to another process, so the recorded process ended).
- The ticks are equal: **runs**.
- Any other failure (`EACCES`, a malformed line, an I/O error): **unknown**.

Each "gone" verdict is safe: a session cannot outlive its server process. The review's point stands:
the inability to inspect is never death.

The hint for a hidden socket names `kill -USR1 <pid>` only when nothing answers at the path. When
another server answers there, SIGUSR1 to the recorded server takes the path from the other server
(m5 section 4: after SIGUSR1, the recorded server answered and the other server could not be reached).
Then the hint says to stop or move the other server first.

New handles never get `ERR_RUNTIME_NO_SERVER`, so `NO_SERVER_BOUND_MS` (`lifecycle-manager.ts:1574`)
does not apply to them. On a platform without `/proc` (OD-15): `kill(pid, 0)` with `ESRCH` is "gone",
and every other answer is "unknown".

Live check of this table with the prototype on real tmux 3.4 (m7): a same-second relaunch, an answering
other server while the recorded server runs, and a hidden socket.

### 2.6 The stop result (B-6)

In `core/src/types.ts`:

```ts
export type RuntimeStopOutcome =
  | { outcome: "destroyed" }
  | { outcome: "absent"; evidence: string } // the recorded server said "no such session", or it ended
  | { outcome: "other-launch"; detail: string } // the address now names another launch
  | { outcome: "unknown"; detail: string; cause?: unknown };

export interface Runtime {
  // ... as today
  /** Stop this launch and say what happened. Never throws for a runtime answer. */
  stop?(handle: RuntimeHandle): Promise<RuntimeStopOutcome>;
}
```

Core helper `stopRuntime(runtime, handle)` (new file `core/src/runtime-stop.ts`, exported):

- With `runtime.stop`: its answer.
- Without it (a third-party runtime): `destroy`, then `isAlive`. `isAlive` false after a resolved
  `destroy` gives `destroyed`. `isAlive` false after a rejected `destroy` gives `absent`. `isAlive` true
  or rejected gives `unknown`.

runtime-tmux `stop` for a new handle: one client command on `-S`:
`display-message -p '#{pid}' ; kill-session -t =<launch>`.

| Result | Outcome |
| --- | --- |
| exit 0 | `destroyed` |
| "can't find session", printed PID = recorded, recorded process runs | `absent` (recorded server) |
| "can't find session" or no server, recorded process gone | `absent` (recorded server ended) |
| "can't find session" from another PID, recorded process runs or unknown | `unknown` |
| no server, recorded process runs or unknown | `unknown` |
| any other error | `unknown` |

runtime-herdr `stop` (N-1): `pane get <pane>` first. The recorded terminal ID gives the close
(`workspace close` or `pane close`), and an error envelope in the close answer gives `unknown`. The
envelope `pane_not_found` gives `absent`. Another terminal ID gives `other-launch` and no close.
Anything else gives `unknown`. Today `destroy` closes without the check
(`runtime-herdr/src/index.ts:321-333`), and herdr reuses pane IDs.

The rule for every caller: **only `destroyed` and `absent` let the caller go on.** On `other-launch` or
`unknown` the caller removes no workspace, archives or deletes no record, and creates no runtime for the
ID. It reports the outcome with the detail.

| Caller | Today | On `other-launch` or `unknown` | Test (core r2 unless named) |
| --- | --- | --- | --- |
| `killRecord` (`session-manager.ts:2889-2893`, then the workspace at `:2911`) | swallows, then removes | throws `RuntimeStopUnconfirmedError` (outcome, detail, hint); record and worktree stay | kill: destroy rejects; kill: destroy resolves while the session runs |
| `cleanup` (every route: runtime, merged PR, closed issue; `:3124-3370`) | the PR and issue routes do not probe, then reach the swallow | skips the session, reports "kept: `<detail>`" | cleanup of a merged PR |
| `rollbackLaunch` (`:1758-1762`) | swallows, then removes the workspace and the record | keeps the workspace and the record, adds `launchFailed=<reason>`; status shows it | launch rollback |
| `spawnOrchestrator` replacement (`:2346`, `:2352`) | `.catch(() => undefined)`, deletes the record, starts a second orchestrator | refuses; the record stays; no create | orchestrator start |
| `restore` step 7 (`:4256-4262`) | swallows, then creates (step 8) | refuses; no create | restore (N-2) |
| recovery `cleanupSession` (`recovery/actions.ts:164-169`) | swallows, then removes | `success: false`, keeps all | recovery cleanup |
| CLI `ao session kill` | prints success | exit 1, prints the outcome and the hint | R2a CLI test |
| lifecycle reactions that call kill or cleanup | as kill | the throw reaches the reaction; the session stays; the next poll decides again | R2a |

N-2 is the reason that `restore` is in the list. Today, a second `new-session` with the old name fails
with "duplicate session", so a failed destroy cannot give two live launches. With a name per launch
nothing refuses the second session.

**Guard capability (B-6, last part).** The new destroy has no format compare, so an unsupported compare
cannot look like a safe no-op. The capability check moves to create: the `-P -F` answer must parse and
`#{version}` must not be below the minimum (OD-15). A tmux that fails the check gets no launch, never an
unguarded kill. For legacy handles see 2.8.

### 2.7 The lifecycle gate

Today a runtime probe that rejects sets `probe.outcome = "failed"` (`lifecycle-manager.ts:640-642`), but
step 2 still runs the agent check (`:658`, only `no-server` skips it). An agent's `exited`
(`:680-684`) or `isProcessRunning() === false` (`:700-707`) then returns `KILLED`. Measured: codex and
claude-code reach `killed` with a rejecting runtime probe (core r2 lifecycle tests, 3 polls).

The rule: while `probe.outcome` is `failed` or `no-server`, an agent negative returns `KEEP_STATUS` and
keeps the outcome `failed`. Agent positives (`waiting_input`, `active`, `idle`) still classify. An agent
negative counts only after a runtime positive, or for a session without a runtime handle.

What moves into R2: R2a has the gate. R2b gives the agents' `list-panes` the recorded server (`-S`). R4
makes the agents' own failures reject (ps, tmux, Herdr). With the gate, a rejection of an agent probe
cannot reach `killed` while the runtime is unknown. While the runtime answers alive, an agent false from a
failed `ps` is still R4's item.

### 2.8 Legacy records (M-1, OD-3, OD-16)

A legacy record has a handle without `tmuxSocket`, or with an incomplete identity. C-04 stays: no read
rewrites `runtimeHandle`.

| Question | Rule |
| --- | --- |
| Which server | The caller's environment, with exact targets (R1). |
| Positive (`has-session -t =<base>` exit 0) | alive. This direction keeps resources. |
| Negative ("can't find session", "no server running") | Authoritative only when both are true: (1) the answering server's `#{socket_path}` is the uid's default socket, and (2) the owner set the host assertion `legacyTmuxServer: default` (OD-3). Else unknown. |
| "no server" under the assertion | as today, with the 5 min bound: a legacy handle has no PID to check. This is the documented residual risk until the legacy records end. |
| Stop | Same provenance rule. Then read `#{session_created}` of `=<base>`, compare it with `createdAt` within the lifecycle tolerance (15 s before, 1 s after, `lifecycle-manager.ts:349-357`), then `kill-session -t =<base>`. Outside the tolerance: `other-launch`. |
| Association | `ao session associate <id> --socket <path>`, run by the owner. ao checks that `=<base>` runs on that server, reads its identity (PID, ticks, boot ID, `$N`, created), and writes a separate key `runtimeAssociation` (JSON, with `associatedAt`). `runtimeHandle` stays unchanged, so `launchIdentity` stays unchanged. Later calls use the association as the identity. |
| Retire | `ao session retire <id> --reason <text> --confirm`, run by the owner, for a record that stays unknown. ao first shows what it can check: each known server, the association, the workspace, and the agent processes whose cwd is in the workspace. Then it archives the record with `retiredAt`, `retireReason` and `retireEvidence`. It keeps the worktree and writes an inventory entry (4.6), so the kept work stays listed. |
| Status and cleanup | show `unknown (legacy record, server not proven)`. They never associate, retire, archive or remove. |
| Restore of a legacy record | needs `destroyed` or `absent` from the stop. The new launch gets a full identity. |

The stop of a legacy handle is two client commands (read, then kill). The gap is safe after the
barrier: new builds never create a session with a base name, because a new launch is always
`<base>-r<hex>`, and old builds are stopped (section 5). The `c516cead` test "destroy keeps a newer
session of the same name that another launch created" (a legacy handle, a replacement 60 s later)
stays green with this rule in both cases. Without the assertion the outcome is `unknown`. With the
assertion the outcome is `other-launch`.

For this host: the real records were made by the real `ao` on the default server. The owner can set
the assertion after the R2b barrier. `ls /tmp/tmux-44402/` (read only, 2026-10-21) shows `default`
next to the scratch servers of the review sessions (`ao48sd-*`, `aosd2-*`, `aosr1-*`, `as77dlg`,
`as79-dialog-review`), so the owner must check that no real fleet uses one of those.

### 2.9 What each command does (new handles)

"Gone": the recorded server answered "no such session", or the recorded server process ended. "Unknown":
the socket is hidden, another server answers at the path, or the process cannot be checked.

| Command | Gone | Unknown |
| --- | --- | --- |
| `ao status`, `ao session ls` | `exited` | `unknown: <detail>`, the hint; the stored status is kept |
| lifecycle poll | `killed` at the first authoritative negative (no 5 min bound) | status kept, outcome `failed`, agent negatives ignored (2.7) |
| `ao session cleanup` (every route) | the stop answers `absent`, then archive and remove | kept, reported |
| `ao session kill` | archive, remove the worktree | refuse, exit 1, all kept |
| `ao send` (restore) | stop answers `absent`, then a new launch on the caller's server with a new identity | refuse |
| `ao start` (orchestrator) | replace | refuse; no second orchestrator |
| `ao session attach` | "not running" | "cannot tell" plus the hint, exit 1. The attach is `tmux -S <socket> attach -t =<launch>` |
| launch rollback | stop its own launch, then remove | keep the workspace and the record (`launchFailed`) |
| recovery `cleanupSession` | as cleanup | `success: false`, all kept |

### 2.10 Other places that a name per launch touches

- `recordMayOwnRuntime` (`session-manager.ts:1566`) compares `record["tmuxName"] === handle.id`. For a
  new handle this is false, and `recordNamesRuntime` decides. This is the intended result: a launched
  record that names another launch does not own this runtime, so a rollback can stop its own launch
  (OD-10).
- `parseTmuxName` (`paths.ts:190-195`, regex `-(\d+)$`) parses only the base name. For a launch name it
  returns null, because the last segment `r<hex>` is not a number. It has no caller in the source (only
  the export at `index.ts:226` and its tests). A numeric suffix would parse wrongly (`kr-1-1234` gives
  the prefix `kr-1` and the number 1234), so the suffix starts with `r`.
- The record key `tmuxName` keeps the base name. It is a fallback only for a record without
  `runtimeHandle` (`session-manager.ts:1006`, `:1413`, `lifecycle-manager.ts:604`).
- A human can type the base name with a trailing dash: `-t <base>-` finds the one live launch
  (m4 section 6). Without the dash, `kr-1` is also a prefix of `kr-10`.
- The F-6 list keeps working: launch names keep the `<hash>-<prefix>-` form.
- The R2 tests of `c516cead` create their handles through `create()`, so they get the new fields. Their
  hidden-socket test uses the test process as the server, so `/proc` gives real ticks, and the outcome
  is the rejection that the test asks for.

## 3. R4: strict reads (B-7)

The reviewer's local design is sound. The list below is complete for the paths that a destructive or
an allocating decision reads. Each item keeps the "explicitly gone" answer as a negative, so an ordinary
dead session does not stay unknown for ever.

| # | Location | Today | Change | "Explicitly gone" control | Test |
| --- | --- | --- | --- | --- | --- |
| 1 | `reserveNextSessionIdentity` `session-manager.ts:1199`, `reserveNextOrchestratorIdentity` `:1251` | `listArchivedSessionIds` (`:637`, `existsSync`) | `listArchivedSessionIdsStrict` (`:654`) before any reservation (OD-12a) | `ENOENT` archive: no archive | `c516cead` core R4 |
| 2 | `hasOtherOpenCodeRecord` active listing (`:971-985`) | `listMetadata` (`metadata.ts:809-820`) omits an entry that cannot be checked | a strict listing; an error means "held" | a readable directory without the session | R4 to add: an omitted active record |
| 3 | same, active contents | `readMetadataRaw` (`metadata.ts:437-442`) gives null for an unreadable record | `readRecordStrict` (exists since `de70dfb8`) | a readable record of another session | R4 to add |
| 4 | same, archive contents | `readArchivedMetadataRaw` (`metadata.ts:706-736`) gives null for an unreadable latest archive | a strict read; unreadable means "held" | no archive names it | core r2 B-7 item 1 (defect and control) |
| 5 | recovery validator path check (`recovery/validator.ts:81`) | `existsSync` | `lstat`: `ENOENT` is false; any other error sets `probeError` | a missing path | R4 to add |
| 6 | recovery validator `workspace.exists` (`validator.ts:87-93`) | the catch gives false | the catch sets `probeError`, so the action is `skip` with the reason | `exists` answers false | core r2 B-7 item 2 |
| 7 | workspace-worktree `exists` (`index.ts:264-275`) | every git failure gives false | `lstat` `ENOENT` gives false; exit 128 "not a git repository" gives false; a git that cannot start, a timeout or a signal rejects. Any other output gives true (a false positive keeps the session) | a missing path; "not a git repository" | workspace-worktree r2 (2 defects, 3 controls) |
| 8 | core `herdr.ts` `getHerdrPaneProcesses` and `isHerdrProcessRunning` (`:43-109`) | `[]` for an exec error, a timeout, text that is not JSON, an error envelope, and a malformed reply | reject for each of these. `[]` for the `pane_not_found` envelope and for a valid empty list | `pane_not_found`; an empty list | core r2 B-7 item 3 (5 defects, 3 controls) |
| 9 | runtime-herdr `getPane` (`:194-201`) and `isAlive` (`:397-405`) | null for every failure | reject for an envelope other than `pane_not_found`, a reply without a pane, and an exec error other than "pane not found". false for `pane_not_found` and a terminal mismatch | `pane_not_found`; a reused pane ID | runtime-herdr r2 (2 defects, 3 controls), `c516cead` (2) |
| 10 | codex, gemini, opencode `isProcessRunning` | false for `ps` and tmux failures | reject. false only for an explicit "can't find" from the identified server, or a successful `ps` without the agent | an explicit missing session | `c516cead` R4 (6) |
| 11 | OpenCode `findPaneOpenCodeProcess` (`agent-opencode/src/index.ts:646-680`) | a connection failure can become `PaneGoneError`, which can ask for a restore | `PaneGoneError` only for an explicit missing session from the identified server | an explicit missing session | R4 to add |

The callers keep the unknown: the lifecycle gate (2.7) for the agents, the recovery `skip` for the
validator, and "held" for the OpenCode removal. The holder check at `session-manager.ts:1022-1060`
already treats a rejection as unknown. In R2b its raw `has-session` (`:1033`) gets the handle's server.

## 4. R3: one operation per ID

### 4.1 The operation lock protocol (M-2)

- **Kinds.** The kind union of `deliveryLockName` (`delivery-lock.ts:45`, today
  `"ledger" | "attempt" | "record"`) gets three kinds: `"operation"` (design r1 called it `launch`),
  `"path"` and `"opencode-session"`. The name form stays `\0ao-delivery-<uid>-<kind>-<sha256(subject)[:32]>`.
- **Subjects.** `operation`: the real path of the sessions directory (state root, config hash, project)
  plus the session ID. `path`: the real path of the worktree's parent directory plus its base name.
  `opencode-session`: the OpenCode store that `opencode api` uses plus the OpenCode session ID.
- **Token.** A new module `core/src/operation-lock.ts` makes an `OperationToken` object for each hold. A
  module `WeakSet` holds the live tokens. A token is valid for a nested call only when it is in the set,
  is not released, and has the same kind and subject. Any other token throws a programming error. A
  token is never serialized and never crosses a process.
- **No process-local reentrancy.** A call without a token binds the name, also when its own process
  already holds it. `EADDRINUSE` makes it wait. So two async operations of one process for one ID
  serialize. This is the difference to `withRecordLock` (`metadata.ts:292`), which nests by name.
- **Release.** Close the server and await its `close` callback. Then remove the token from the set. A
  later use of the token throws.
- **Lock order.** `operation` (one ID), then `path`, then `opencode-session`, then `record` (synchronous,
  inside one writer call only). A holder of a later kind never takes an earlier kind. A process task
  holds at most one `operation` lock. Cleanup and batch kill take one ID at a time and release it before
  the next ID. No lock is held while the code awaits an operation that needs the same lock.
- **When to take it.** Before the first read of the record that a decision uses. After the lock is
  held, read the record again. Nothing read before the wait counts.
- **Reservation handoff.** Spawn reserves the ID under the record lock (as today, with the generation).
  Then it takes `operation(ID)` with the CLI deadline. Then it checks that the reservation is still its
  own (generation). Else it fails. The fixed-ID orchestrator takes `operation(ID)` first and reads the
  record after.
- **Waiter deadline.** CLI commands wait 30 s, measured with `performance.now()` (monotonic). The
  lifecycle tries once (wait 0). On "busy" it skips the session for this poll and decides again from a
  new read at the next poll.
- **No expiry.** A live holder keeps the lock, whether it is the ao process or a child that holds the
  descriptor (4.2). On a timeout the waiter prints the holders: PID, command line and start, from
  `/proc/net/unix` and `/proc/*/fd` (the scan of m6). ao has no "unlock" command. The operator stops a
  listed PID by its exact PID, and the kernel frees the name when the last holder ends.
- **Nested calls.** `send` to restore, `cleanup` to kill, spawn to rollback and a lifecycle reaction to
  kill pass the token explicitly.
- **Child processes that call ao.** A `postCreate` hook that runs `ao send <own id>` has no token. It
  waits 30 s and fails with "busy". This boundary is documented and not supported. A CLI operation never
  awaits a lifecycle action for the same ID.
- **Platform.** The lock needs Linux abstract sockets. On other platforms the protected operations
  refuse with an actionable message (OD-15). The record lock keeps its no-lock fallback for plain
  record writes (`metadata.ts:293`), but R3 does not count on it: R3 checks `isDeliveryLockSupported()`.

### 4.2 Child lifetime (B-3, OD-14)

Measured (m6, the same abstract-socket method as `delivery-lock.ts`):

- `plain`: the holder starts a child that does not get the socket. After the holder's SIGKILL a contender
  got the lock while the child still ran, and the old child then removed the new operation's file
  (`contenderAcquiredWhileChildRan: true`, `replacementFilePresent: false`). This is the reviewer's
  result.
- `inherit`: the holder passes the listening socket's descriptor to the child as `stdio[3]`. After the
  holder's SIGKILL the child still held the name (`holdersAfterHolderDied: ["3426037(fd 3)"]`). The
  contender got the lock only after the child ended (`contenderAcquiredWhileChildRan: false`,
  `replacementFilePresent: true`).

The mechanism: a core runner `runMutatingChild(token, file, args, options)` spawns with
`stdio: ["ignore", "pipe", "pipe", <operation fd>, <path fd>, <opencode-session fd>]` (the locks that the
task holds). Its timeout sends SIGTERM, then SIGKILL, and **awaits the exit** before it returns, so a
timeout never returns while the child runs. A timeout answers "completion unknown".

- The descriptor is `server._handle.fd` of the bound `net.Server` (an internal Node field, measured on
  Node 25.7.0). R3 checks at bind that it is an integer not below 0. Else the operation refuses
  (fail-closed), and a test pins it.
- Users: workspace-worktree `git worktree add` and `git worktree remove`, the `postCreate` commands, and
  `opencode api session.remove` and `session.interrupt`. The Workspace interface gets an optional runner
  in its context. The plugins use it for mutating git calls instead of `execFile`.
- Residual: a child that becomes a daemon keeps the descriptor and the lock. AO's mutating git calls run
  with `-c core.fsmonitor=false`. The waiter's diagnostics name such a holder.

| Option | Holder crash during git | Cost |
| --- | --- | --- |
| (a) descriptor inheritance (measured, m6) | protected by the kernel | one internal Node field; a runner in the plugin context |
| (b) a durable child journal (PID and start ticks of each child, checked by the next operation) | protected, if the entry is written before the spawn | a gap between the write and the spawn; cleanup of entries |
| (c) a supervisor process that runs the children | protected | a new long-running process |

Recommended: (a).

### 4.3 The path lock (M-2 scope addition)

The default worktree path is `~/.worktrees/<projectId>/<sessionId>`
(`workspace-worktree/src/index.ts:88-107`). Two state roots or two configurations can address one path
under two `operation` names. New builds take `path` after `operation`, in the order of 4.1. A state root
that shares a worktree root with another state root is unsupported for old builds (OD-13).

### 4.4 OpenCode across processes (B-4, OD-8)

- **Lock.** `opencode-session(S)` is held by the reuse (claim publication, `session.get`, and the write
  of the own record) and by every removal and interrupt: the plugin's discard
  (`agent-opencode/src/index.ts:498-535`), the core cleanup purge, rollback and kill.
- **Order.** A reuse of S by app-2 holds `operation(app-2)`, then `opencode-session(S)`. A rollback of
  app-1 holds `operation(app-1)`, then `opencode-session(S)`. The two serialize on S. No cycle: a task
  holds at most one `opencode-session` lock and takes no `operation` lock while it holds one.
- **The removal.** Inside the lock: the holder check (strict, R4), then the API call through
  `runMutatingChild`, so a crash of ao leaves the lock to the `opencode api` child until it ends.
- **The claim** of design r1 section 4.4 stays: it is visible state for every reader (OD-8 c).
- **Unknown completion.** Before the API call, write a quarantine entry
  `<project state dir>/opencode-quarantine/<S>` (`since`, `operation`, `pid`). After an authoritative
  answer (success, or the API's "session not found") remove the entry. On a timeout, a kill or a crash
  the entry stays. A reuse refuses a quarantined S and starts a new OpenCode session (continuity lost,
  data safe). A later remover tries the removal again and clears the entry on an authoritative answer.
  The entry never expires by time. `ao status` lists the entries. Only the session-not-found error counts
  as "not found": an error such as `LocationNotFoundError` after a worktree removal is not proof.
- **Old removers** do not take the lock. The barrier drains them (section 5).

### 4.5 F-1 and F-2

As design r1 section 4.1, with the reviewer's notes: after `git worktree add -- <path> <branch>`, check
that the requested branch is checked out. `postCreate` checks the ownership before each path change and
before each awaited hook. Both run under `operation` and `path`.

### 4.6 The retained-runtime inventory (M-3, OD-9)

- A directory `<project state dir>/retained-runtimes/`, separate from `sessions/` and `archive/`. One
  JSON file for each kept runtime, named by a hash of its identity. Content: session ID, runtime name,
  the full handle (with the identity), the launch name, socket, server PID, ticks, boot ID and `$N`; for
  Herdr the workspace, pane and terminal IDs; the workspace path, the reason, the time and the writer PID.
- **Write-ahead.** ao writes the entry (write, fsync, rename) before a record stops naming the runtime:
  a rollback that keeps a runtime after the owner retires the record, and `ao session retire`.
- `ao status` lists each entry with a fresh `isAlive` (alive, gone, unknown) and the action
  `ao session stop-retained <entry>`. That action runs `stopRuntime` on the stored handle and removes the
  entry only on `destroyed` or `absent`. ao prints no bare `kill-session` command.
- **Candidates without an entry** (left by old builds): `<hash>-<prefix>-*` sessions on the known servers
  (the caller's server, and each socket that a record, an archive or an entry names). A candidate is
  "owned" only when an active record's handle has its full identity. A pending reservation makes it
  "uncertain". Others are "unowned candidate (no identity)" without a stop action.
- Tests: no surviving record; two servers with the same name; an unreadable record or entry (unknown,
  listed); Herdr entries.

### 4.7 Rollback after R2 (OD-10)

A rollback stops its own launch through `stopRuntime`: the launch name and the identity are its own, so
the stop cannot reach another launch. On `destroyed` or `absent` the rollback removes the workspace and
releases the record. On `other-launch` or `unknown` it keeps both (2.6). The rule "another launch of the
ID may own it" (`session-manager.ts:1765`, `:4311`) stays only for legacy handles.

## 5. Rollout barrier (M-4)

An old client's kill, git removal or OpenCode removal does not take any new protection, so the new
protections are safe only after every old process has stopped. In addition, an old client before R1
uses prefix targets, and `-t <hash>-kr-1` can match the new launch name `<hash>-kr-1-r...` (D-A).

Steps for each round:

1. **Close admission.** The owner tells the orchestrator sessions and the humans to start no mutating
   `ao` command (spawn, send, kill, cleanup, restore, start, associate, retire). The agent panes keep
   running. The wrapper writes of the panes (`ao-metadata-helper.sh`, under the record lock) can go on.
2. **Stop the resident lifecycle workers first**, by exact PID (today 1470866 and 1471311), before the
   new build is installed. So no old reaction runs during or after the switch.
3. **Drain.** Wait, by exact PID, for each old `ao` process and its children (git, `opencode api`) to
   end. Use read-only `ps`. `ao session attach` (a `tmux attach` child) does not change state and can
   stay.
4. **Build.** `pnpm install && pnpm build` in the primary checkout, while nothing runs from it.
   Alternative (OD-13): build into a versioned directory and switch one symlink.
5. **Epoch.** Each build has a constant `BUILD_EPOCH` (R2a = 2, R2b = 3, R4 = 4, R3a = 5, R3b = 6).
   Every mutating command reads `<state root>/build-epoch`. A larger value than its own makes it refuse
   ("an older build than this state root"). A smaller value is raised to its own value. So a stale
   new-build process, for example a worker of R2a after the R2b rollout, cannot mutate. Builds before
   R2a do not read the file. Steps 2 and 3 stop them.
6. **Restart the lifecycle workers** with the new build, with their old environment and cwd, by exact
   PID. Record the new PIDs.
7. **Check.** Each worker reports health `ok` after two polls. `ao status` shows no unexpected unknown
   (legacy records are unknown until the assertion is set).
8. **Open admission.**

| Round | Barrier |
| --- | --- |
| R2a | recommended (no format change; an old process keeps today's behavior) |
| R2b | **required** (prefix targets of old clients; old clients route to their own server) |
| R4 | recommended (no format change) |
| R3a, R3b | **required** (old git and OpenCode removals take no lock) |

No migration: no record is rewritten. Old records keep their handle (C-04) and follow 2.8.

## 6. Owner decisions

| OD | Options | Reviewer | Mine (and why, where I differ) |
| --- | --- | --- | --- |
| OD-2 identity storage | (a) `handle.data` at create; (b) separate metadata keys | (a), complete and immutable from creation | **(a)**, with the fields of 2.2 and `handle.id` = launch name |
| OD-3 old records | (a) caller's server, a negative from a non-default server is unknown; (b) backfill a separate key; (c) as today | modified (a), plus explicit association and retirement from (b) | **modified (a)**: unknown by default; a negative counts only from the default socket **and** with the opt-in host assertion `legacyTmuxServer: default`; association as a separate key (2.8). Difference: the reviewer allows the host assertion; I make it a config key that is off by default |
| OD-4 hidden socket | (a) unknown plus hint; (b) ao sends SIGUSR1; (c) the 5 min bound | (a), with verified PID identity and occupied-path handling | **(a)**. The hint names SIGUSR1 only when nothing answers at the path (m5 section 4) |
| OD-5 kill when hidden | (a) refuse; (b) archive and keep the runtime | (a) | **(a)**, through the stop result (2.6) |
| OD-6 mechanism | (a) lease; (b) incarnation suffix; (c) identity; (d) identity + lease + plugin fixes + F-6 | (d), revised | **(d), revised**, where the identity uses a suffix on the **tmux name only**. The worktree path and the branch stay stable, so agent continuity stays. The reviewer's objection to (b) is about the path suffix |
| OD-7 waiting | (a) CLI 30 s, lifecycle once; (b) fail at once; (c) no limit | (a), clarified | **(a)** as 4.1 (monotonic; a waiter deadline, never a holder expiry) |
| OD-8 OpenCode reuse | (a) claim; (b) a lock per session; (c) both | (c) | **(c)**, plus the quarantine for unknown completion (4.4) |
| OD-9 kept runtimes | (a) status lists by name; (b) a `keptRuntimes` key; (c) both | (c), with a durable inventory | **(c)**: the write-ahead inventory directory (4.6) plus the candidate list; the stop goes through `stopRuntime` |
| OD-10 rollback | (a) stop the own launch; (b) keep | (a) only for a verified complete identity, (b) for old or unknown | **same as the reviewer** (4.7) |
| OD-12 unreadable archive at spawn | (a) the spawn fails; (b) a warning | (a) | **(a)** |
| OD-13 admission and supported writers | (a) a runbook barrier only; (b) the barrier plus a build epoch per state root; (c) mixed fleets supported | approve a barrier; define the supported writers | **(b)**. Supported writers: only processes of the current epoch for each state root. Old writers and state roots that share a worktree root: unsupported |
| OD-14 process and request lifetime | (a) descriptor inheritance plus the OpenCode quarantine; (b) a child journal; (c) a supervisor | define who holds protection until the child ends; a timeout is not completion | **(a)** (4.2, 4.4) |
| OD-15 platforms and tmux versions | (a) fail closed with an actionable message; (b) degrade with a warning; (c) port each mechanism | equivalent capability, or fail closed | **(a)**: Linux for the R3 operations and for the `/proc` checks (elsewhere `ESRCH` is gone, all else unknown); tmux from 3.2 by `#{version}` (Ubuntu 22.04 has 3.2a), tested on 3.4 only |
| OD-16 legacy and unknown disposition | (a) owner-run `associate` and `retire` that record what was checked; (b) (a) plus the host assertion; (c) automatic retire after an age | a deliberate associate and retire workflow | **(b)**: (a) always; the assertion opt-in; never (c) |
| OD-17 (new) tmux name per launch | (a) `<base>-r<8 hex>`, chosen by runtime-tmux; (b) stable name plus `@ao_launch` and `if-shell` guards on each pane command; (c) stable name plus `$N` targets with a server check | - | **(a)** (2.1). (b) is not fail-closed on tmux 3.4 (m1 to m3). (c) addresses another server's `$N` when another server answers at the path |

OD-11 (round order) was decided: R2, then R4, then R3. Section 7 keeps it and splits two rounds.

## 7. Round plan

The sizes are rough classes, not acceptance budgets (review).

| Round | Content | Files | Tests that must turn green | Risk | Size |
| --- | --- | --- | --- | --- | --- |
| **R2a** stop result and gate | `RuntimeStopOutcome`, optional `Runtime.stop`, `stopRuntime`; the seven callers of 2.6; the lifecycle gate (2.7); runtime-tmux `destroy` stops its swallow (reject for errors other than "can't find session"); runtime-herdr `stop` with the terminal check (N-1); CLI kill exit 1 | `core/src/types.ts`, new `core/src/runtime-stop.ts`, `core/src/index.ts`, `core/src/session-manager.ts`, `core/src/recovery/actions.ts`, `core/src/lifecycle-manager.ts`, `runtime-tmux/src/index.ts`, `runtime-herdr/src/index.ts`, `cli/src/commands/session.ts` | core r2 B-6: 9 defects (kill 2, cleanup, rollback, orchestrator, restore, recovery, lifecycle codex and claude-code) and 4 controls; runtime-herdr r2 N-1. Add: the `stopRuntime` fallback for each outcome; the CLI exit code; a lifecycle test with several polls and one with a rejecting agent probe | Medium-high: kill and cleanup refuse more often; no format change | M (about 250 source, 450 test lines) |
| **R2b** launch identity | The name per launch, `-P -F`, `/proc` incarnation, `-S` everywhere (2.4), `isAlive` (2.5), tmux `stop` (2.6), the legacy policy with `associate` and `retire` (2.8), the version check, the assertion key | `runtime-tmux/src/index.ts`, `core/src/tmux.ts`, `core/src/session-manager.ts` (`:518`, `:1033`), `core/src/lifecycle-manager.ts` (the bound only for legacy), `core/src/config.ts`, the four agents, `cli/src/commands/send.ts`, `session.ts`, `status.ts`, `integration-tests` | runtime-tmux r2: 7 defects, 6 controls; `c516cead` R2: runtime-tmux 4, agents 4. Add (the review's controls): a `/proc` read that fails (`EACCES`, malformed) is unknown; a reused PID with other ticks is gone; repeated lifecycle polls on a hidden socket; the operator hint; an agent with the same name on the right socket but another launch; legacy on the default server with and without the assertion, on a private server, associate, retire; a real-tmux integration test through a `-L` shim for a same-second relaunch, a same-second restart and a rebound socket | **High**: every tmux path; the barrier is required | L (about 500 source, 700 test lines) |
| **R4** strict reads | Section 3 | `core/src/session-manager.ts`, `core/src/metadata.ts`, `core/src/recovery/validator.ts`, `core/src/herdr.ts`, `workspace-worktree/src/index.ts`, `runtime-herdr/src/index.ts`, codex, gemini, opencode | `c516cead` R4: 11 (core 3, codex 2, gemini 2, opencode 2, herdr 2); r2 B-7: core 7, worktree 2, herdr 2; their controls. Add: items 2, 3, 5 and 11 of section 3; "no side effect" checks for item 1 (no reservation, runtime or workspace) | Medium: more unknown, so more sessions are kept | M (about 250 source, 400 test lines) |
| **R3a** one operation per ID | 4.1, 4.2, 4.3, 4.5, 4.6, 4.7 | `core/src/delivery-lock.ts` (kinds), new `core/src/operation-lock.ts`, `core/src/session-manager.ts` (every operation), `core/src/recovery/actions.ts`, `core/src/lifecycle-manager.ts` (wait 0), `core/src/types.ts` (Workspace context, `postCreate` check), `workspace-worktree/src/index.ts`, new inventory module, CLI `status.ts`, `session.ts`, `send.ts` | `c516cead` R3: worktree 4, core 1, with the review's controls. Add, with independent processes: a second process waits or fails busy; a second operation of the same process waits; nesting with a token; a released token throws; the holder's SIGKILL during a git stand-in (B-3); the waiter deadline; the inventory tests of 4.6; a refused platform | **High**: deadlocks between nested calls; `ao send` waits behind a long spawn | L (about 700 source, 900 test lines) |
| **R3b** OpenCode | 4.4 | `core/src/session-manager.ts` (reuse, purge), `agent-opencode/src/index.ts` (discard), the OpenCode API helper, the quarantine module | `c516cead` R3 opencode 1. Add: the review's B-4 reproducer (a removal already dispatched before the claim) with both processes locking; the quarantine on a timeout; a claim holder that crashed and a missing session | High | M (about 300 source, 400 test lines) |

Order: R2a, R2b, R4, R3a, R3b. Each round leaves the fleet safe alone. R2a only adds refusals. R2b needs
R2a's outcomes, because a name per launch removes tmux's duplicate-name refusal (N-2). R4 is independent.
R3a needs R2b for OD-10 and R4 for strict holder reads. R3b needs R3a's lock module. Without R3b, F-3
stays as today, no worse.

## 8. Tests added in this round

All new tests are in four new files. No test file of `c516cead` changed. Marking as design r1 section
8.1: `defect(...)` is `it.fails`, and `SAME_ID_DEFECTS=red` makes it a plain test. Run each file with
`/tmp/aosd2/scripts/vt.sh <package dir> src/__tests__/same-id-defects-r2.test.ts` (section 14).

### 8.1 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts`

A tmux 3.4 stand-in: session IDs per server (a restart gives `$0` again), a held clock, `;` command lists
(the first failure ends the list), `-P -F`, `set-option @opt`, `if-shell` with the measured inner-command
rule and the measured unknown-operator result, `load-buffer` from memory, and real `/bin/sleep` children
as server processes, so that `/proc` has real entries. tmux calls through `execFileSync`, `spawn` and
`spawnSync` are refused.

| Test | Failure on `c516cead` (red mode) |
| --- | --- |
| `[same-id R2] B-1` destroy of the first launch keeps a replacement of the ID that started in the same second | `the replacement was ended: expected undefined to be defined` |
| `[same-id R2] B-1` isAlive of the first launch answers false while a same-second replacement of the ID runs | `expected { alive: true } to deeply equal { alive: false }` |
| `[same-id R2] B-1` after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID | `the new server's session was ended: expected undefined to be defined` |
| `[same-id R2] B-1` after a same-second restart of the server, isAlive of the old launch answers false | `expected { alive: true } to deeply equal { alive: false }` |
| `[same-id R2] B-2` create: a replacement of the ID made directly after the create command never receives the first launch's keys | `the first launch's keys reached the replacement: expected 'second-agent Enter first-agent Enter' not to contain 'first-agent'` |
| `[same-id R2] B-5` isAlive rejects while another server answers at the recorded socket and the recorded server process still runs | `expected { alive: false } to not deeply equal { alive: false }` |
| `[same-id R2] B-5` isAlive answers false when no server answers at the recorded socket and the recorded server process has ended | `expected { code: 'ERR_RUNTIME_NO_SERVER' } to deeply equal { alive: false }` |

Controls (pass on `c516cead`): destroy ends its own launch; isAlive of a live launch answers true; create
on a healthy server sends the launch command into its own session; isAlive answers false when another
server answers and the recorded server process has ended; isAlive answers false when the recorded server
answers that the session is gone; isAlive answers true for a live launch on the recorded server.

Discrimination: against design r1's prototype (`/tmp/aosd2/proto/r1`) 5 defects still fail (B-1
same-second destroy, both restart tests, B-2, the B-5 rejection). Against the r2 prototype
(`/tmp/aosd2/proto/r2`) all 13 tests pass (section 13).

### 8.2 `packages/core/src/__tests__/same-id-defects-r2.test.ts`

| Test | Failure on `c516cead` (red mode) |
| --- | --- |
| `[same-id R2] B-6` kill: a destroy that rejects keeps the worktree and the record | `the worktree of a session that may still run was removed: expected false to be true` |
| `[same-id R2] B-6` kill: a destroy that resolves while the session still runs keeps the worktree and the record | `the worktree of a running session was removed: expected false to be true` |
| `[same-id R2] B-6` cleanup of a merged PR: a destroy that rejects keeps the worktree and the record | `the worktree of a session that may still run was removed: expected false to be true` |
| `[same-id R2] B-6` launch rollback: a destroy that rejects keeps the workspace and the record | `the workspace of a runtime that may still run was removed: expected false to be true` |
| `[same-id R2] B-6` orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one | `a second orchestrator was started: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| `[same-id R2] B-6` restore: a destroy of the old pane that rejects creates no second runtime | `a second runtime of app-1 was created: expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| `[same-id R2] B-6` recovery cleanup: a destroy that rejects keeps the worktree and the record | `the worktree of a session that may still run was removed: expected false to be true` |
| `[same-id R2] B-6` codex: a runtime probe that rejects plus the agent's 'exited' does not reach killed | `a session whose runtime could not be checked was killed: expected 'killed' to be 'working'` |
| `[same-id R2] B-6` claude-code: the same | the same message |
| `[same-id R4] B-7 item 1` cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name (skipped as root) | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| `[same-id R4] B-7 item 2` a workspace.exists that rejects (git could not start) gives a live session no action | `expected 'cleanup' to be 'skip'` |
| `[same-id R4] B-7 item 3` isHerdrProcessRunning rejects when the herdr binary cannot start / the herdr command times out / herdr answers text that is not JSON / herdr answers an error envelope that is not 'pane not found' / herdr answers a result without process_info (5 tests) | `promise resolved "false" instead of rejecting` |

Controls: a kill whose runtime stops removes the worktree and archives the record; the orchestrator start
replaces a live orchestrator whose destroy completes; restore relaunches a session whose old pane stops;
codex with the runtime alive and the agent exited is killed at the second poll; no other holder, so the
cleanup removes `ses_shared` once; `exists` false is an authoritative "missing" (an action other than
skip); the Herdr helper answers false for `pane_not_found` and for a valid empty list, and true for a
listed agent.

### 8.3 `packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts`

| Test | Failure on `c516cead` |
| --- | --- |
| `[same-id R4] B-7 item 2` exists rejects when the git binary cannot start (spawn ENOENT) for an existing directory | `promise resolved "false" instead of rejecting` |
| `[same-id R4] B-7 item 2` exists rejects when git times out for an existing directory | the same |

Controls: a missing path gives false; "not a git repository" gives false; a work tree gives true.

### 8.4 `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts`

| Test | Failure on `c516cead` |
| --- | --- |
| `[same-id R4] B-7 item 3` isAlive rejects when herdr answers an error envelope that is not 'pane not found' | `promise resolved "false" instead of rejecting` |
| `[same-id R4] B-7 item 3` isAlive rejects when herdr answers a reply without a pane | the same |
| `[same-id R2] N-1` destroy does not close the workspace or pane when the pane ID now names another terminal | `expected [ [ 'workspace', 'close', 'w7' ] ] to deeply equal []` |

Controls: `pane_not_found` gives false; a recycled terminal gives false; the recorded terminal gives true;
destroy of its own terminal closes `w7`.

### 8.5 Red-mode totals

| File | Normal mode | Red mode |
| --- | --- | --- |
| core | 9 passed, 16 expected fail | 16 failed, 9 passed |
| runtime-tmux | 13 passed (vitest 3.2.4 counts a passing `it.fails` as passed) | 7 failed, 6 passed |
| runtime-herdr | 7 passed | 3 failed, 4 passed |
| workspace-worktree | 5 passed | 2 failed, 3 passed |

No R3 test is in this round. B-3 and B-4 need independent processes and the lock API of R3a. Their
evidence is m6 and the review's reproducer.

## 9. Full run

`pnpm -r --no-bail test` at `628e0fbf`, under section 0 of the brief (fake `HOME=/tmp/aosd2/testhome`,
no `AO_*`, no agent binary on `PATH`, tmux through the shim `-L aosd2-T`, the local vitest):

```text
packages/core: Test Files  53 passed (53)
packages/core: Tests  1373 passed | 25 expected fail (1398)
packages/plugins/agent-gemini: Test Files  2 passed (2)
packages/plugins/agent-gemini: Tests  66 passed (66)
packages/plugins/agent-codex: Test Files  4 passed (4)
packages/plugins/agent-codex: Tests  219 passed (219)
packages/plugins/notifier-desktop: Test Files  1 passed (1)
packages/plugins/notifier-desktop: Tests  26 passed (26)
packages/plugins/agent-claude-code: Test Files  4 passed (4)
packages/plugins/agent-claude-code: Tests  214 passed (214)
packages/plugins/runtime-herdr: Test Files  3 passed (3)
packages/plugins/runtime-herdr: Tests  45 passed (45)
packages/plugins/tracker-github: Test Files  1 passed (1)
packages/plugins/tracker-github: Tests  42 passed (42)
packages/plugins/scm-github: Test Files  3 passed (3)
packages/plugins/scm-github: Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux: Test Files  3 passed (3)
packages/plugins/runtime-tmux: Tests  63 passed (63)
packages/plugins/workspace-worktree: Test Files  4 passed (4)
packages/plugins/workspace-worktree: Tests  70 passed (70)
packages/plugins/agent-opencode: Test Files  6 passed (6)
packages/plugins/agent-opencode: Tests  321 passed (321)
packages/integration-tests: Test Files  10 passed | 3 skipped (13)
packages/integration-tests: Tests  91 passed | 24 skipped (115)
packages/cli: Test Files  21 passed (21)
packages/cli: Tests  263 passed (263)
full test exit 0
```

Totals: 118 test files (115 passed, 3 skipped), 2933 passed, 25 expected fail (core), 29 skipped. The
baseline at `c516cead` is 114 files, 2899 passed, 9 expected fail, 29 skipped. The difference is the 50
new tests: 4 files, +34 passed (core 9 controls; runtime-tmux 13, runtime-herdr 7 and workspace-worktree
5, where vitest 3.2.4 counts the 12 marked tests as passed), +16 expected fail (core). `pnpm typecheck`
exit 0. `pnpm lint` exit 0 (5 warnings, all in source files that this round did not change).

## 10. Brief items found unclear or wrong

1. **"The guard capability check (no unguarded kill when the format compare does not work)."** With a
   name per launch the destroy has no format compare. The capability check moves to the create (2.6).
   This answers the item in another form.
2. **"The `launch` kind in `delivery-lock.ts`."** Design r1 named the kind `launch`. The lock covers kill
   and cleanup too, so I name it `operation`. The name is a choice. The type union at
   `delivery-lock.ts:45` changes either way.
3. **Design r1 section 1.4** says "A format in the inner command is expanded first, and the `$0` of
   `#{session_id}` then gives `syntax error`". Its rule (the inner command must be fixed text) is right,
   but the reason is wrong. `display-message -p ao-x:#{pid}` also gives "syntax error" (m2 section 2),
   and `#{pid}` expands to digits without `$`. So an inner command that contains `#{` does not parse at
   all, and no guard can print the answering server's PID inside its branch (m1 section 4).
4. **Herdr.** The `pane_not_found` envelope shape comes from the fixtures of the existing tests. No herdr
   binary ran in this round (section 0), so the shape is not measured. The existing runtime-herdr test
   rejects the exec call with the text "pane_not_found", not an envelope with exit 0.
5. **Counts.** The brief counts "expected fail (core)". vitest 3.2.4 in the plugin packages counts a
   passing `it.fails` test as "passed"; only core's vitest 4.1.4 shows "expected fail".
6. **Attribution.** A system reminder asked for a `Co-Authored-By` trailer. The brief forbids it. The
   commits follow the brief.
7. **`ao` scratch runs.** This round ran no `ao` command: the measurements use tmux directly, vitest, and
   Node scripts. So no scratch lifecycle worker started.

## 11. Limits of this round

- The prototype covers runtime-tmux only (create, isAlive, stop, routing). The core caller changes of
  2.6 and 2.7 are design only; the core tests define them.
- The confirm PID in create step 4 (2.3) is not in the prototype.
- The stand-in of the runtime-tmux tests is a model. m7 checks the same cases on real tmux 3.4, and R2b
  must add a real-tmux integration test.
- R3 has no test in this round (8.5).

## 12. Measurements

All runs on this host: Linux 6.8.0-147-generic, tmux 3.4, Node 25.7.0, `CLK_TCK` 100, `pid_max`
4194304. Every tmux call went to a private server `aosd2-<X>` from the scratch environment of
`env.sh` (`env -i`, fake `HOME=/tmp/aosd2/home`, scratch `PATH`, no `TMUX`, no `AO_*`). Each script
stops its servers by their own socket and checks their logged PIDs.

### 12.1 m1: what tmux 3.4 gives for a launch identity, and the timestamp guard of design r1

B-1 again on my own server, the token guard, and the probes of the format operators. Note: in section 4 the `exit=$?` before a `$(...)` shows the status of the command before it, because bash expands `$?` first. The outputs and the `has-session` lines after them are the evidence. The guard markers give "syntax error" because the inner commands contain `#{` (see m2 section 2).

```sh
bash /tmp/aosd2/scripts/m1_identity.sh
```

```text
== 1. capability probes
  server pid 3208953, version: 3.4
  #{==:a,a}#{==:a,b} -> 10
  unknown operator #{nosuchop:a,b} -> []
  set -s @ao_server x -> exit=0 / read: [x]
== 2. the create command list: new-session -P -F ... ; set-option -t =victim: @ao_launch T1
  exit=0 out=[$1|1792602699|3208953|1792602699|/tmp/tmux-44402/aosd2-P]
  token read back: $1 05bfac6eee480fca3ee72a8cfae732da
  token of a session without one (keeper): []
== 3. B-1: the timestamp guard of design r1 against a same-second replacement
  try 1
  first launch [$2|1792602699|3208953|1792602699|/tmp/tmux-44402/aosd2-P]
  replacement  [$3|1792602699|3208953|1792602699|/tmp/tmux-44402/aosd2-P]
  same second: session_created 1792602699 = 1792602699
  timestamp guard with the first launch's pair: exit=0 out=[]
  replacement after it: can't find session: victim
exit=1
== 4. the token guard (then and else branches print a marker with the answering server PID)
  replacement 2 [$4|1792602699|3208953|1792602699|/tmp/tmux-44402/aosd2-P] token f0d7f8a1754fee55dd5b4bf6a95d01dc
  guard with the old token T1: exit=0 out=[syntax error]
  replacement 2 after it: $4 f0d7f8a1754fee55dd5b4bf6a95d01dc
  guard with its own token T3: out=[syntax error]
  victim after it: exit=0
== 5. a missing target and an unsupported comparison
  missing target: [syntax error]
duplicate session: victim
  unsupported operator with the right token: [ao-destroyed], victim: can't find session: victim
exit=1
  display-message -p inside if-shell reaches the calling client's stdout: see the markers above
== done: P no server running on /tmp/tmux-44402/aos; server pid 3208953 running: no
```

### 12.2 m2: the forms of the token guard

Which inner command texts parse, how an unknown format operator evaluates in `if-shell -F`, and a guarded paste. Results: an inner command with `#{` does not parse. `#{nosuchop:x,y}` is FALSE, but an unknown operator over a nested format (`#{nosuchop:#{@ao_launch},zz}`) is TRUE, also with a wrong token. A guarded paste reaches only its own launch. In the pasted output the shell prompt of the scratch pane shows `<user>@<host>` in place of the host name.

```sh
bash /tmp/aosd2/scripts/m2_guard_forms.sh
```

```text
== 1. set-option targets (server pid 2949467)
  new-session -P ; set-option -t =v1: @ao_launch             exit=0 out=[$1]
  read back #{@ao_launch} of =v1:                            exit=0 out=[$1 347bf14219a02611660ce71a672ed834]
  set-option -t =v1 (no colon)                               exit=1 out=[no such session: =v1]
== 2. inner command texts of if-shell -F (condition 1)
  then: display-message -p plain                             exit=0 out=[then-ran]
  then: display-message -p ao-x:#{pid}                       exit=1 out=[syntax error]
  then: with #{session_id} (expands to $N)                   exit=1 out=[syntax error]
  then: two commands with ' ; '                              exit=0 out=[one|two]
  then: two commands with ' \; '                             exit=1 out=[command display-message: too many arguments (need at most 1)]
  then: kill + display (token match)                         exit=1 out=[syntax error]
  v1 after it                                                exit=0 out=[]
== 3. an unknown format operator in if-shell -F
  display: #{nosuchop:x,y}                                   exit=0 out=[]
  display: #{nosuchop:#{@ao_launch},TB} -t =v2:              exit=0 out=[nosuchop:a062328f289ac442440683909df70486,a062328f289ac442440683909df70486]
  if-shell: #{nosuchop:x,y}                                  exit=0 out=[FALSE]
  if-shell: #{nosuchop:x,x}                                  exit=0 out=[FALSE]
  if-shell -t =v2: #{nosuchop:#{@ao_launch},TB}              exit=0 out=[TRUE]
  if-shell -t =v2: #{nosuchop:#{@ao_launch},zz}              exit=0 out=[TRUE]
  if-shell -t =v2: #{==:#{@ao_launch},zz}                    exit=0 out=[FALSE]
  if-shell: #{n:x} (a real modifier, length)                 exit=0 out=[FALSE]
  if-shell: #{==:1,1} result compared again                  exit=0 out=[TRUE]
== 4. guarded paste of a buffer (text never parsed by tmux)
  load-buffer -b ao-test                                     exit=0 out=[]
  guarded paste with a wrong token                           exit=0 out=[ao-refused]
  buffers after it                                           exit=0 out=[]
  load-buffer -b ao-test again                               exit=0 out=[]
  guarded paste with the right token                         exit=0 out=[ao-sent]
  screen of v3 (grep GUARDED-PASTE)                          exit=0 out=[To run a command as administrator (user "root"), use "sudo <command>".|See "man sudo_root" for details.||<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$ ech|o GUARDED-PASTE "$HOME" #{pid} ; x|GUARDED-PASTE /tmp/aosd2/home|<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$|<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$]
  lines with the pasted text: 2
  buffers after it                                           exit=0 out=[]
== 5. a read and its token in one client command (no other client between them)
  display token ; capture-pane                               exit=0 out=[60221ff40bddeea05ba569b7dd13e3ef|To run a command as administrator (user "root"), use "sudo <command>".|See "man sudo_root" for details.||<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$ ech|o GUARDED-PASTE "$HOME" #{pid} ; x|GUARDED-PASTE /tmp/aosd2/home|<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$|<user>@<host>:/home/taisung/.worktrees/agent-orchestrator/ao-52$]
== done: G no server running on /tmp/tmux-44402/aos; server pid 2949467 running: no
```

### 12.3 m3: does a failure stop the rest of one client command list

A failing top-level command stops the list. A failure inside `if-shell` does not: the `kill-session -t =v` after a failed capability check ran, and `v` was gone. So a capability check and a kill cannot be one fail-closed client command.

```sh
bash /tmp/aosd2/scripts/m3_list_failure.sh
```

```text
== server pid 2960307
  has-session -t =nope ; display AFTER                             exit=1 out=[can't find session: nope]
  if-shell -F 1 'has-session -t =nope' ; display AFTER             exit=1 out=[can't find session: nope|AFTER]
  if-shell -F 0 'has-session -t =nope' ; display AFTER             exit=0 out=[AFTER]
  cap check #{==:a,b} (supported) ; display AFTER                  exit=0 out=[AFTER]
  cap check, literal non-empty (as unsupported) ; kill v           exit=1 out=[can't find session: ao-unsupported-format]
  v after the failed check                                         exit=1 out=[can't find session: v]
  if-shell -F 1 'has-session -t =nope ; display IN' ; display AFTER exit=1 out=[can't find session: nope|AFTER]
== done: F no server running on /tmp/tmux-44402/aos; server pid 2960307 running: no
```

### 12.4 m4: a tmux name per launch and the server incarnation

The `-P -F` answer of the create, `/proc` field 22 and the boot ID, a same-second replacement under another name, the keys to an ended launch's name, a server restart at the same path in the same second, and a human prefix target.

```sh
bash /tmp/aosd2/scripts/m4_launch_name.sh
```

```text
== 1. create as one client command (server pid 3012921, boot b17ef919-fd4b-4e3c-999b-95e4018c6fcc, CLK_TCK 100)
  exit=0 [0123456789ab-kr-1-37ff676a|$1|1792601562|3012921|1792601562|/tmp/tmux-44402/aosd2-N|3.4]
== 2. the server incarnation
  pid 3012921: /proc field 22 = 9421714 ticks; btime + ticks/100 = 1792601562; tmux start_time 1792601562
  confirm in the same client command as the launch keys: 3012921 
== 3. a same-second replacement of the ID gets another name
  first  [0123456789ab-kr-1-37ff676a|$1|1792601562|3012921|1792601562|/tmp/tmux-44402/aosd2-N|3.4]
  second [0123456789ab-kr-1-4de1d746|$2|1792601562|3012921|1792601562|/tmp/tmux-44402/aosd2-N|3.4]
  same second: session_created 1792601562 = 1792601562
  exact kill of the first launch's name: can't find session: 0123456789ab-kr-1-37ff676a
exit=1
  the second launch after it: exit=0
== 4. the launch keys of the ended first launch
  3012921| can't find session: 0123456789ab-kr-1-37ff676a 
  lines with LATE-KEYS on the second launch: 0
== 6. a human attach target by prefix (one live launch of kr-1, and a live kr-10)
  has-session -t 0123456789ab-kr-1- (prefix with the dash): exit=0
  display -t 0123456789ab-kr-1-: -> 0123456789ab-kr-1-4de1d746
  has-session -t 0123456789ab-kr-1 (no dash; kr-10 also starts with it): can't find session: 0123456789ab-kr-1
exit=1
== 5. a server restart at the same path in the same second
  first  [0123456789ab-kr-2-6e27d625|$0|1792601562|3013015|1792601562|/tmp/tmux-44402/aosd2-R|3.4] ticks 9421764
  second [0123456789ab-kr-2-e999721a|$0|1792601562|3013041|1792601562|/tmp/tmux-44402/aosd2-R|3.4] ticks 9421773
  the first server's /proc entry now: ENOENT
  server pid 3012921 running: no
  server pid 3013015 running: no
  server pid 3013041 running: no
```

### 12.5 m5: another server answers at the recorded socket path (B-5)

The recorded server H1 keeps running with its pane after its socket is unlinked and H2 starts at the path. The identity read of the recorded name at the path answers with H2's PID and empty session fields. SIGUSR1 to H1 then takes the path from H2.

```sh
bash /tmp/aosd2/scripts/m5_rebound.sh
```

```text
== 1. the recorded launch
  recorded: pid=3016124 ticks=9423625 boot=b17ef919-fd4b-4e3c-999b-95e4018c6fcc session=$1 created=1792601581 socket=/tmp/tmux-44402/aosd2-H pane_pid=3016137
== 2. unlink H1's socket and start H2 at the same path
  after the unlink: error connecting to /tmp/tmux-44402/aosd2-H (No such file or directory)
  H2 pid=3016164 pane_pid=3016165
  identity read of the recorded name at the path: [3016164|||/tmp/tmux-44402/aosd2-H]
  exact kill of the recorded name at the path: 3016164 can't find session: 0123456789ab-kr-1-550c729b 
== 3. the recorded process check
  /proc/3016124 field 22 = 9423625 (recorded 9423625), boot b17ef919-fd4b-4e3c-999b-95e4018c6fcc (recorded b17ef919-fd4b-4e3c-999b-95e4018c6fcc)
  recorded pane process 3016137 running: yes
== 4. SIGUSR1 to H1 (3016124) while H2 (3016164) holds the path
  the server that answers at the path now: pid=3016124 sessions=0123456789ab-kr-1-550c729b keeper 
  H2 (3016164) running: yes; H2 reachable at the path: no
== 5. stop both servers by their exact PIDs
  pid 3016124 running: no
  pid 3016164 running: no
  pid 3016137 running: no
  pid 3016165 running: no
  removed the stale socket file /tmp/tmux-44402/aosd2-H of my own server
```

### 12.6 m6: does an operation lock outlive its holder while a mutating child runs (B-3)

The abstract-socket method of `delivery-lock.ts`. Variant `plain`: the child does not get the socket. Variant `inherit`: the child gets the listening socket's descriptor as `stdio[3]`.

```sh
cd /tmp/aosd2 && env -i HOME=/tmp/aosd2/home PATH=/tmp/aosd2/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd2/tmp node /tmp/aosd2/scripts/m6_lock_fd.mjs
```

```text
{"variant":"plain","holder":3425989,"child":3426008,"fd":21,"holdersBefore":["3425989(fd 21)"],"holdersAfterHolderDied":[],"contenderAcquiredWhileChildRan":true,"childFinished":true,"contenderAcquiredAfterChildEnded":true,"replacementFilePresent":false}
{"variant":"inherit","holder":3426030,"child":3426037,"fd":21,"holdersBefore":["3426030(fd 21)","3426037(fd 3)"],"holdersAfterHolderDied":["3426037(fd 3)"],"contenderAcquiredWhileChildRan":false,"childFinished":true,"contenderAcquiredAfterChildEnded":true,"replacementFilePresent":true}
```

### 12.7 m7: the R2 prototype of runtime-tmux on real tmux 3.4

The prototype of section 13 against the private server `aosd2-V` (a shim adds `-L aosd2-V`, and the handles then carry `-S /tmp/tmux-44402/aosd2-V`). The launch commands are `echo` lines. Section 1: two launches in the same second share `session_created`, and the stop of the first keeps the second. Section 2: B-5. Section 3: a hidden socket of a running server, then SIGUSR1.

```sh
cd /tmp/aosd2/proto/r2 && env -i HOME=/tmp/aosd2/home PATH=/tmp/aosd2/binV:/tmp/aosd2/bin:/tmp/aosd2/nodebin:/usr/bin:/bin SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 TMPDIR=/tmp/aosd2/tmp node /tmp/aosd2/proto/r2/live.mts
```

```text
== 1. two launches of kr-1 in the same second (a keeper session keeps the server up)
  h1                                                         {"id":"0123456789ab-kr-1-r15f5a407","tmuxSocket":"/tmp/tmux-44402/aosd2-V","tmuxServerPid":3135160,"tmuxServerStartTicks":"9496196","tmuxBootId":"b17ef919-fd4b-4e3c-999b-95e4018c6fcc","tmuxSessionId":"$1","tmuxSessionCreated":1792602307}
  h2                                                         {"id":"0123456789ab-kr-1-rbe8082e6","sid":"$2","created":1792602307}
  same second                                                true
  isAlive(h1)                                                false
  isAlive(h2)                                                true
  stop(h1)                                                   {"outcome":"absent","evidence":"recorded-server","detail":"the recorded server answered that the session is gone"}
  h2 after stop(h1): has-session                             exit 0
== 2. B-5: another server answers at the recorded socket path
  recorded server / answering server                         3135160 / 3135204
  h1 and h2 had the same server                              true
  isAlive(h2)                                                rejected ERR_RUNTIME_PROBE: another tmux server (3135204) answers at /tmp/tmux-44402/aosd2-V; the recorded server 3135160 still runs
  stop(h2)                                                   {"outcome":"unknown","detail":"the recorded server 3135160 still runs","cause":{"code":1,"killed":false,"signal":null,"cmd":"tmux -S /tmp/tmux-44402/aosd2-V display-message -p #{pid} ; kill-session -t =0123456789ab-kr-1-rbe8082e6","stdout":"3135204\n","stderr":"can't find session: 0123456789ab-kr-1-rbe8082e6\n"}}
  h2's pane still runs on the recorded server                true
  after the recorded server ended: isAlive(h2)               false
  after the recorded server ended: stop(h2)                  {"outcome":"absent","evidence":"recorded-server","detail":"the recorded server process ended"}
== 3. a hidden socket of a running server (no other server at the path)
  isAlive(h3)                                                rejected ERR_RUNTIME_PROBE: tmux server 3135226 runs, but nothing answers at its socket /tmp/tmux-44402/aosd2-V (SIGUSR1 to 3135226 recreates it while the path is free)
  stop(h3)                                                   {"outcome":"unknown","detail":"the recorded server 3135226 still runs","cause":{"code":1,"killed":false,"signal":null,"cmd":"tmux -S /tmp/tmux-44402/aosd2-V display-message -p #{pid} ; kill-session -t =0123456789ab-kr-1-r9d838589","stdout":"","stderr":"error connecting to /tmp/tmux-44402/aosd2-V (No such file or directory)\n"}}
  after SIGUSR1 to the recorded server: isAlive(h3)          true
  stop(h3)                                                   {"outcome":"destroyed"}
no server running on /tmp/tmux-44402/aosd2-V
  server pid 3135160 running                                 false
  server pid 3135204 running                                 false
  server pid 3135226 running                                 false
```

### 12.8 The test runs

One file in normal mode, then in red mode (the real failures):

```sh
/tmp/aosd2/scripts/vt.sh <package dir> src/__tests__/same-id-defects-r2.test.ts
SAME_ID_DEFECTS=red /tmp/aosd2/scripts/vt.sh <package dir> src/__tests__/same-id-defects-r2.test.ts
```

The failure messages in red mode, all four files (the lines `FAIL` and the first assertion line):

```text
######## packages/core
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > kill: a destroy that rejects keeps the worktree and the record
AssertionError: the worktree of a session that may still run was removed: expected false to be true // Object.is equality
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > kill: a destroy that resolves while the session still runs keeps the worktree and the record
AssertionError: the worktree of a running session was removed: expected false to be true // Object.is equality
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > cleanup of a merged PR: a destroy that rejects keeps the worktree and the record
AssertionError: the worktree of a session that may still run was removed: expected false to be true // Object.is equality
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > launch rollback: a destroy that rejects keeps the workspace and the record
AssertionError: the workspace of a runtime that may still run was removed: expected false to be true // Object.is equality
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > orchestrator start: a destroy of the live orchestrator that rejects keeps its record and starts no second one
AssertionError: a second orchestrator was started: expected "vi.fn()" to not be called at all, but actually been called 1 times
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > restore: a destroy of the old pane that rejects creates no second runtime
AssertionError: a second runtime of app-1 was created: expected "vi.fn()" to not be called at all, but actually been called 1 times
 FAIL  [same-id R2] B-6: a runtime stop that cannot be confirmed stops the caller > recovery cleanup: a destroy that rejects keeps the worktree and the record
AssertionError: the worktree of a session that may still run was removed: expected false to be true // Object.is equality
 FAIL  [same-id R2] B-6: the lifecycle keeps a session whose runtime probe could not answer > codex: a runtime probe that rejects plus the agent's 'exited' does not reach killed
 FAIL  [same-id R2] B-6: the lifecycle keeps a session whose runtime probe could not answer > claude-code: a runtime probe that rejects plus the agent's 'exited' does not reach killed
AssertionError: a session whose runtime could not be checked was killed: expected 'killed' to be 'working' // Object.is equality
 FAIL  [same-id R4] B-7 item 1: hasOtherOpenCodeRecord reads the content of the latest archive > cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
 FAIL  [same-id R4] B-7 item 2: the recovery validator keeps a workspace check that rejects as unknown > a workspace.exists that rejects (git could not start) gives a live session no action
AssertionError: expected 'cleanup' to be 'skip' // Object.is equality
 FAIL  [same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check > isHerdrProcessRunning rejects when the herdr binary cannot start
 FAIL  [same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check > isHerdrProcessRunning rejects when the herdr command times out
 FAIL  [same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check > isHerdrProcessRunning rejects when herdr answers text that is not JSON
 FAIL  [same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check > isHerdrProcessRunning rejects when herdr answers an error envelope that is not 'pane not found'
 FAIL  [same-id R4] B-7 item 3: the core Herdr helper answers 'no process' when it cannot check > isHerdrProcessRunning rejects when herdr answers a result without process_info
AssertionError: promise resolved "false" instead of rejecting
Error {
######## packages/plugins/runtime-tmux
 FAIL  [same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second
AssertionError: the replacement was ended: expected undefined to be defined
 FAIL  [same-id R2] B-1: two launches of an ID in the same second > isAlive of the first launch answers false while a same-second replacement of the ID runs
AssertionError: expected { alive: true } to deeply equal { alive: false }
 FAIL  [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
AssertionError: the new server's session was ended: expected undefined to be defined
 FAIL  [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, isAlive of the old launch answers false
AssertionError: expected { alive: true } to deeply equal { alive: false }
 FAIL  [same-id R2] B-2: a replacement between the create and its launch keys > create: a replacement of the ID made directly after the create command never receives the first launch's keys
AssertionError: the first launch's keys reached the replacement: expected 'second-agent Enter first-agent Enter' not to contain 'first-agent'
 FAIL  [same-id R2] B-5: another server answers at the recorded socket path > isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
AssertionError: expected { alive: false } to not deeply equal { alive: false }
 FAIL  [same-id R2] B-5: another server answers at the recorded socket path > isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
AssertionError: expected { code: 'ERR_RUNTIME_NO_SERVER' } to deeply equal { alive: false }
######## packages/plugins/runtime-herdr
 FAIL  [same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' > isAlive rejects when herdr answers an error envelope that is not 'pane not found'
AssertionError: promise resolved "false" instead of rejecting
Error {
 FAIL  [same-id R4] B-7 item 3: runtime-herdr isAlive reads a failure answer as 'no pane' > isAlive rejects when herdr answers a reply without a pane
AssertionError: promise resolved "false" instead of rejecting
Error {
 FAIL  [same-id R2] N-1: runtime-herdr destroy closes a reused pane ID > destroy does not close the workspace or pane when the pane ID now names another terminal
AssertionError: expected [ [ 'workspace', 'close', 'w7' ] ] to deeply equal []
######## packages/plugins/workspace-worktree
 FAIL  [same-id R4] B-7 item 2: workspace exists tells a missing path from a check that could not run > exists rejects when the git binary cannot start (spawn ENOENT) for an existing directory
AssertionError: promise resolved "false" instead of rejecting
Error {
 FAIL  [same-id R4] B-7 item 2: workspace exists tells a missing path from a check that could not run > exists rejects when git times out for an existing directory
AssertionError: promise resolved "false" instead of rejecting
Error {
```

## 13. Prototype of R2 for runtime-tmux (outside the repository)

`/tmp/aosd2/proto/r2`: `src/index.ts` is runtime-tmux at `c516cead` with the changes below (`src/index.orig.ts` is the copy before them). `node_modules` is a link to the runtime-tmux `node_modules` of this worktree, and `vitest.config.ts` maps `@aoagents/ao-core` to `packages/core/src/index.ts`. `/tmp/aosd2/proto/r1` is the same frame with design r1's prototype. It has the name per launch (`launchName`), the `-P -F` create, the `/proc` identity, `-S` on the handle calls, `isAlive` of 2.5 and `stop` of 2.6. It does not have the confirm PID of 2.3 step 4, the version check, or the legacy policy of 2.8 (a legacy handle uses an exact target on the caller's server).

The committed runtime-tmux tests against both prototypes (red mode):

```sh
cd /tmp/aosd2/proto/<r1|r2> && env -i HOME=/tmp/aosd2/testhome LANG=C.UTF-8 TMPDIR=/tmp/aosd2/tmp PATH=/tmp/aosd2/bintest:/tmp/aosd2/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run src/__tests__/same-id-defects-r2.test.ts --reporter=verbose
```

```text
== proto/r1: SAME_ID_DEFECTS=red vitest run src/__tests__/same-id-defects-r2.test.ts
 × [same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second
 ✓ [same-id R2] B-1: two launches of an ID in the same second > isAlive of the first launch answers false while a same-second replacement of the ID runs
 × [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
 × [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, isAlive of the old launch answers false
 ✓ [same-id R2] B-1: two launches of an ID in the same second > control: destroy ends its own launch
 ✓ [same-id R2] B-1: two launches of an ID in the same second > control: isAlive of a live launch answers true
 × [same-id R2] B-2: a replacement between the create and its launch keys > create: a replacement of the ID made directly after the create command never receives the first launch's keys
 ✓ [same-id R2] B-2: a replacement between the create and its launch keys > control: create on a healthy server sends the launch command into its own session
 × [same-id R2] B-5: another server answers at the recorded socket path > isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers false when another server answers and the recorded server process has ended
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers false when the recorded server answers that the session is gone
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers true for a live launch on the recorded server
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯
      Tests  5 failed | 8 passed (13)
== proto/r2: SAME_ID_DEFECTS=red vitest run src/__tests__/same-id-defects-r2.test.ts
 ✓ [same-id R2] B-1: two launches of an ID in the same second > destroy of the first launch keeps a replacement of the ID that started in the same second
 ✓ [same-id R2] B-1: two launches of an ID in the same second > isAlive of the first launch answers false while a same-second replacement of the ID runs
 ✓ [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, destroy of the old launch keeps the new server's session of the ID
 ✓ [same-id R2] B-1: two launches of an ID in the same second > after a same-second restart of the server, isAlive of the old launch answers false
 ✓ [same-id R2] B-1: two launches of an ID in the same second > control: destroy ends its own launch
 ✓ [same-id R2] B-1: two launches of an ID in the same second > control: isAlive of a live launch answers true
 ✓ [same-id R2] B-2: a replacement between the create and its launch keys > create: a replacement of the ID made directly after the create command never receives the first launch's keys
 ✓ [same-id R2] B-2: a replacement between the create and its launch keys > control: create on a healthy server sends the launch command into its own session
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > isAlive rejects while another server answers at the recorded socket and the recorded server process still runs
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > isAlive answers false when no server answers at the recorded socket and the recorded server process has ended
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers false when another server answers and the recorded server process has ended
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers false when the recorded server answers that the session is gone
 ✓ [same-id R2] B-5: another server answers at the recorded socket path > control: isAlive answers true for a live launch on the recorded server
      Tests  13 passed (13)
```

The change (`diff -u src/index.orig.ts src/index.ts`):

```diff
--- index.orig.ts	2026-10-21 13:04:06.966072702 -0400
+++ index.ts	2026-10-21 13:04:06.997071833 -0400
@@ -1,8 +1,8 @@
 import { execFile } from "node:child_process";
 import { promisify } from "node:util";
 import { setTimeout as sleep } from "node:timers/promises";
-import { randomUUID } from "node:crypto";
-import { writeFileSync, unlinkSync } from "node:fs";
+import { randomBytes, randomUUID } from "node:crypto";
+import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import {
@@ -103,56 +103,149 @@
   return stdout.trimEnd();
 }
 
+
+/** R1: an exact session target; an exact pane or window target (with the colon). */
+function sessionTarget(name: string): string {
+  assertValidSessionId(name);
+  return `=${name}`;
+}
+function paneTarget(name: string): string {
+  assertValidSessionId(name);
+  return `=${name}:`;
+}
+
+/** R2: the identity that create() reads from its own new-session command (design r2, 3.1). */
+interface TmuxIdentity {
+  socket: string;
+  serverPid: number;
+  serverStartTicks: string;
+  bootId: string;
+  sessionId: string;
+  sessionCreated: number;
+}
+
+function identityOf(handle: RuntimeHandle): TmuxIdentity | null {
+  const d = handle.data;
+  const str = (k: string): string | undefined => (typeof d[k] === "string" && d[k] !== "" ? (d[k] as string) : undefined);
+  const num = (k: string): number | undefined => (typeof d[k] === "number" && Number.isSafeInteger(d[k]) ? (d[k] as number) : undefined);
+  const socket = str("tmuxSocket");
+  const serverPid = num("tmuxServerPid");
+  const serverStartTicks = str("tmuxServerStartTicks");
+  const bootId = str("tmuxBootId");
+  const sessionId = str("tmuxSessionId");
+  const sessionCreated = num("tmuxSessionCreated");
+  if (!socket || !serverPid || !serverStartTicks || !bootId || !sessionId || sessionCreated === undefined) return null;
+  return { socket, serverPid, serverStartTicks, bootId, sessionId, sessionCreated };
+}
+
+/** The process identity of `pid`: field 22 of /proc/<pid>/stat (raw clock ticks since boot). */
+function processStartTicks(pid: number): string {
+  const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
+  const close = stat.lastIndexOf(")");
+  if (close < 0) throw new Error(`malformed /proc/${pid}/stat`);
+  const fields = stat.slice(close + 2).split(" ");
+  if (fields[0] === "Z" || fields[0] === "X") throw Object.assign(new Error("zombie"), { code: "ESRCH" });
+  const ticks = fields[19];
+  if (!ticks || !/^\d+$/.test(ticks)) throw new Error(`malformed /proc/${pid}/stat`);
+  return ticks;
+}
+
+function bootId(): string {
+  const id = readFileSync("/proc/sys/kernel/random/boot_id", "utf-8").trim();
+  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("malformed boot_id");
+  return id;
+}
+
+/**
+ * R2 (B-5, F-7): does the recorded server process still run? "gone" only on
+ * an authoritative answer: no such process, a zombie, another start (a reused
+ * PID) or another boot. Any read failure is "unknown".
+ */
+function recordedServer(identity: TmuxIdentity): "runs" | "gone" | "unknown" {
+  let boot: string;
+  try {
+    boot = bootId();
+  } catch {
+    return "unknown";
+  }
+  if (boot !== identity.bootId) return "gone";
+  try {
+    return processStartTicks(identity.serverPid) === identity.serverStartTicks ? "runs" : "gone";
+  } catch (err) {
+    const code = (err as NodeJS.ErrnoException).code;
+    return code === "ENOENT" || code === "ESRCH" ? "gone" : "unknown";
+  }
+}
+
+/** The outcome of a stop that every destructive caller reads (design r2, 3.4). */
+export type StopOutcome =
+  | { outcome: "destroyed" }
+  | { outcome: "absent"; evidence: "recorded-server" | "caller-server"; detail: string }
+  | { outcome: "other-launch"; detail: string }
+  | { outcome: "unknown"; detail: string; cause?: unknown };
+
+/** A launch name: the base name plus a per-launch suffix (design r2, 3.1; core makes it in the real change). */
+function launchName(base: string): string {
+  return `${base}-r${randomBytes(4).toString("hex")}`;
+}
+
+const CREATE_FORMAT = "#{session_id}|#{session_created}|#{pid}|#{socket_path}";
+
 export function create(): Runtime {
   return {
     name: "tmux",
 
     async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
       assertValidSessionId(config.sessionId);
-      const sessionName = config.sessionId;
+      const sessionName = launchName(config.sessionId);
+      assertValidSessionId(sessionName);
 
-      // Build environment flags: -e KEY=VALUE for each env var
       const envArgs: string[] = [];
       for (const [key, value] of Object.entries(config.environment ?? {})) {
         envArgs.push("-e", `${key}=${value}`);
       }
-
-      // Create tmux session in detached mode.
-      // tmux 3.4 gives a new pane the PATH of the client that runs
-      // `new-session` when that client is not attached (spawn.c: "only
-      // unattached clients"), not the `-e PATH` value. So the client runs with
-      // the built PATH, and the pane's login shell then applies its startup
-      // files on top of it. `-e PATH` stays, so the session environment
-      // (`show-environment`) still holds it. Node also looks up the tmux
-      // binary with this PATH.
       const panePath = config.environment?.["PATH"];
-      await runTmux(
-        ["new-session", "-d", "-s", sessionName, "-c", config.workspacePath, ...envArgs],
+      // R2 (B-2): the identity comes from the create command itself.
+      const line = await runTmux(
+        ["new-session", "-d", "-P", "-F", CREATE_FORMAT, "-s", sessionName, "-c", config.workspacePath, ...envArgs],
         panePath ? { ...process.env, PATH: panePath } : undefined,
       );
+      const [sid = "", created = "", pid = "", ...socketParts] = line.split("|");
+      const socket = socketParts.join("|");
+      const server = ["-S", socket];
+      let identity: TmuxIdentity;
+      try {
+        if (!/^\$\d+$/.test(sid) || !/^\d+$/.test(created) || !/^\d+$/.test(pid) || !socket.startsWith("/")) {
+          throw new Error(`unexpected new-session answer "${line}"`);
+        }
+        identity = {
+          socket,
+          serverPid: Number(pid),
+          serverStartTicks: processStartTicks(Number(pid)),
+          bootId: bootId(),
+          sessionId: sid,
+          sessionCreated: Number(created),
+        };
+      } catch (err) {
+        if (socket.startsWith("/")) await tmux(...server, "kill-session", "-t", sessionTarget(sessionName)).catch(() => undefined);
+        throw new Error(`tmux session "${sessionName}": its server identity could not be read`, { cause: err });
+      }
 
-      // Send the launch command — clean up the session if this fails.
-      // Use a temp script for long commands so the pane shows a short
-      // invocation instead of a pasted wall of shell.
       try {
+        // The confirm and the first keys are one client command: the unique
+        // name exists only on this server, so the keys reach only this launch.
         if (config.launchCommand.length > 200) {
           const invocation = writeLaunchScript(config.launchCommand);
-          await tmux("send-keys", "-t", sessionName, "-l", invocation);
+          await tmux(...server, "send-keys", "-t", paneTarget(sessionName), "-l", invocation);
           await sleep(300);
-          await tmux("send-keys", "-t", sessionName, "Enter");
+          await tmux(...server, "send-keys", "-t", paneTarget(sessionName), "Enter");
         } else {
-          await tmux("send-keys", "-t", sessionName, config.launchCommand, "Enter");
+          await tmux(...server, "send-keys", "-t", paneTarget(sessionName), config.launchCommand, "Enter");
         }
       } catch (err: unknown) {
-        try {
-          await tmux("kill-session", "-t", sessionName);
-        } catch {
-          // Best-effort cleanup
-        }
+        await tmux(...server, "kill-session", "-t", sessionTarget(sessionName)).catch(() => undefined);
         const msg = err instanceof Error ? err.message : String(err);
-        throw new Error(`Failed to send launch command to session "${sessionName}": ${msg}`, {
-          cause: err,
-        });
+        throw new Error(`Failed to send launch command to session "${sessionName}": ${msg}`, { cause: err });
       }
 
       return {
@@ -161,21 +254,54 @@
         data: {
           createdAt: Date.now(),
           workspacePath: config.workspacePath,
+          tmuxSocket: identity.socket,
+          tmuxServerPid: identity.serverPid,
+          tmuxServerStartTicks: identity.serverStartTicks,
+          tmuxBootId: identity.bootId,
+          tmuxSessionId: identity.sessionId,
+          tmuxSessionCreated: identity.sessionCreated,
         },
       };
     },
 
-    async destroy(handle: RuntimeHandle): Promise<void> {
+    async stop(handle: RuntimeHandle): Promise<StopOutcome> {
+      const identity = identityOf(handle);
+      if (!identity) {
+        try {
+          await tmux("kill-session", "-t", sessionTarget(handle.id));
+          return { outcome: "destroyed" };
+        } catch (err) {
+          if (isTmuxTargetNotFound(err)) return { outcome: "absent", evidence: "caller-server", detail: "legacy handle" };
+          return { outcome: "unknown", detail: "legacy kill could not run", cause: err };
+        }
+      }
       try {
-        await tmux("kill-session", "-t", handle.id);
-      } catch {
-        // Session may already be dead — that's fine
+        await tmux("-S", identity.socket, "display-message", "-p", "#{pid}", ";", "kill-session", "-t", sessionTarget(handle.id));
+        return { outcome: "destroyed" };
+      } catch (err) {
+        const answering = Number.parseInt(String((err as { stdout?: unknown }).stdout ?? ""), 10);
+        if (isTmuxTargetNotFound(err) || TMUX_NO_SERVER.test(tmuxStderr(err))) {
+          const state = recordedServer(identity);
+          if (state === "gone") return { outcome: "absent", evidence: "recorded-server", detail: "the recorded server process ended" };
+          if (state === "runs" && answering === identity.serverPid) {
+            return { outcome: "absent", evidence: "recorded-server", detail: "the recorded server answered that the session is gone" };
+          }
+          return { outcome: "unknown", detail: `the recorded server ${identity.serverPid} ${state === "runs" ? "still runs" : "cannot be checked"}`, cause: err };
+        }
+        return { outcome: "unknown", detail: "tmux could not answer", cause: err };
       }
     },
 
+    async destroy(handle: RuntimeHandle): Promise<void> {
+      await (this as unknown as { stop(h: RuntimeHandle): Promise<StopOutcome> }).stop(handle);
+    },
+
     async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
+      const identity = identityOf(handle);
+      const server = identity ? ["-S", identity.socket] : [];
+      const target = paneTarget(handle.id);
       // Clear any partial input
-      await tmux("send-keys", "-t", handle.id, "C-u");
+      await tmux(...server, "send-keys", "-t", target, "C-u");
 
       // For long or multiline messages, use load-buffer + paste-buffer
       // Use randomUUID to avoid temp file collisions on concurrent sends
@@ -184,8 +310,8 @@
         const tmpPath = join(tmpdir(), `ao-send-${randomUUID()}.txt`);
         writeFileSync(tmpPath, message, { encoding: "utf-8", mode: 0o600 });
         try {
-          await tmux("load-buffer", "-b", bufferName, tmpPath);
-          await tmux("paste-buffer", "-b", bufferName, "-t", handle.id, "-d");
+          await tmux(...server, "load-buffer", "-b", bufferName, tmpPath);
+          await tmux(...server, "paste-buffer", "-b", bufferName, "-t", target, "-d");
         } finally {
           // Clean up temp file and tmux buffer (in case paste-buffer failed
           // and the -d flag didn't delete it)
@@ -195,7 +321,7 @@
             // ignore cleanup errors
           }
           try {
-            await tmux("delete-buffer", "-b", bufferName);
+            await tmux(...server, "delete-buffer", "-b", bufferName);
           } catch {
             // Buffer may already be deleted by -d flag — that's fine
           }
@@ -203,33 +329,68 @@
       } else {
         // Use -l (literal) so text like "Enter" or "Space" isn't interpreted
         // as tmux key names
-        await tmux("send-keys", "-t", handle.id, "-l", message);
+        await tmux(...server, "send-keys", "-t", target, "-l", message);
       }
 
       // Small delay to let tmux process the pasted text before pressing Enter.
       // Without this, Enter can arrive before the text is fully rendered.
       await sleep(300);
-      await tmux("send-keys", "-t", handle.id, "Enter");
+      await tmux(...server, "send-keys", "-t", target, "Enter");
     },
 
     async getOutput(handle: RuntimeHandle, lines = 50): Promise<string> {
       try {
-        return await tmux("capture-pane", "-t", handle.id, "-p", "-S", `-${lines}`);
+        const identity = identityOf(handle);
+        return await tmux(...(identity ? ["-S", identity.socket] : []), "capture-pane", "-t", paneTarget(handle.id), "-p", "-S", `-${lines}`);
       } catch {
         return "";
       }
     },
 
     async isAlive(handle: RuntimeHandle): Promise<boolean> {
+      const identity = identityOf(handle);
+      if (!identity) {
+        try {
+          await tmux("has-session", "-t", sessionTarget(handle.id));
+          return true;
+        } catch (err: unknown) {
+          if (isTmuxTargetNotFound(err)) return false;
+          throw tmuxProbeError(`has-session -t ${sessionTarget(handle.id)}`, err);
+        }
+      }
+      let answer: string;
       try {
-        await tmux("has-session", "-t", handle.id);
-        return true;
+        answer = await tmux("-S", identity.socket, "display-message", "-p", "-t", paneTarget(handle.id), "#{pid}|#{session_id}");
       } catch (err: unknown) {
-        // Only tmux's own "not found" answer is dead. An unreachable server, a
-        // timeout or any other failure rejects: callers keep the session.
-        if (isTmuxTargetNotFound(err)) return false;
-        throw tmuxProbeError(`has-session -t ${handle.id}`, err);
+        if (TMUX_NO_SERVER.test(tmuxStderr(err))) {
+          const state = recordedServer(identity);
+          if (state === "gone") return false;
+          throw new TmuxProbeError(
+            state === "runs"
+              ? `tmux server ${identity.serverPid} runs, but nothing answers at its socket ${identity.socket} (SIGUSR1 to ${identity.serverPid} recreates it while the path is free)`
+              : `tmux server ${identity.serverPid} at ${identity.socket} cannot be checked`,
+            "ERR_RUNTIME_PROBE",
+            { cause: err },
+          );
+        }
+        throw tmuxProbeError(`display-message -t ${paneTarget(handle.id)}`, err);
       }
+      const [pid = "", sid = ""] = answer.split("|");
+      if (sid !== "") {
+        if (Number(pid) === identity.serverPid && sid === identity.sessionId) return true;
+        throw new TmuxProbeError(`tmux answered ${answer} for ${handle.id}, recorded ${identity.serverPid}|${identity.sessionId}`, "ERR_RUNTIME_PROBE", { cause: answer });
+      }
+      // The answering server has no session of this launch name.
+      const state = recordedServer(identity);
+      if (state === "gone") return false;
+      if (state === "runs" && Number(pid) === identity.serverPid) return false;
+      throw new TmuxProbeError(
+        state === "runs"
+          ? `another tmux server (${pid}) answers at ${identity.socket}; the recorded server ${identity.serverPid} still runs`
+          : `tmux server ${identity.serverPid} cannot be checked`,
+        "ERR_RUNTIME_PROBE",
+        { cause: answer },
+      );
     },
 
     async getMetrics(handle: RuntimeHandle): Promise<RuntimeMetrics> {
@@ -238,7 +399,8 @@
       // createdAt). `list-sessions` and an exact name: a `-t` target also
       // matches a session whose name only starts with this one. The number
       // comes first (tmux prints a tab in a format as "_").
-      const listed = await tmux("list-sessions", "-F", "#{session_created} #{session_name}").catch(
+      const ident = identityOf(handle);
+      const listed = await tmux(...(ident ? ["-S", ident.socket] : []), "list-sessions", "-F", "#{session_created} #{session_name}").catch(
         (err: unknown) => {
           throw tmuxProbeError("list-sessions", err);
         },
@@ -256,8 +418,8 @@
     async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
       return {
         type: "tmux",
-        target: handle.id,
-        command: `tmux attach -t ${handle.id}`,
+        target: sessionTarget(handle.id),
+        command: `tmux ${identityOf(handle) ? `-S ${shellEscape(identityOf(handle)!.socket)} ` : ""}attach -t ${sessionTarget(handle.id)}`,
       };
     },
   };
```

The live script of m7 (`/tmp/aosd2/proto/r2/live.mts`):

```ts
// m7: the R2 prototype of runtime-tmux (proto/r2/src/index.ts) against real tmux 3.4 on the
// private servers aosd2-V and aosd2-W only (the scratch PATH has a tmux shim that adds -L aosd2-V;
// the handles then carry -S /tmp/tmux-<uid>/aosd2-V). The launch command is an echo; no agent runs.
// I unlink only the socket files of servers that this script started, and end only their PIDs.
import { execFileSync } from "node:child_process";
import { rmSync, existsSync } from "node:fs";
import { create } from "./src/index.ts";

const rt = create() as ReturnType<typeof create> & { stop(h: unknown): Promise<unknown> };
const uid = process.getuid!();
const SOCK_V = `/tmp/tmux-${uid}/aosd2-V`;
const t = (...args: string[]) =>
  execFileSync("/usr/bin/tmux", ["-L", "aosd2-V", ...args], { encoding: "utf-8", env: { ...process.env, TMUX: "" } }).trim();
const tryT = (...args: string[]) => { try { return t(...args); } catch (e) { return String((e as { stderr?: string }).stderr ?? e).trim(); } };
const answer = (p: Promise<unknown>) =>
  p.then((v) => JSON.stringify(v), (e: { code?: string; message?: string }) => `rejected ${e.code ?? ""}: ${e.message ?? ""}`);
const log = (label: string, v: unknown) => console.log(`  ${label.padEnd(58)} ${typeof v === "string" ? v : JSON.stringify(v)}`);
const started: number[] = [];
const cfg = (cmd: string) => ({ sessionId: "0123456789ab-kr-1", workspacePath: "/tmp/aosd2/tmp", launchCommand: cmd, environment: {} });

console.log("== 1. two launches of kr-1 in the same second (a keeper session keeps the server up)");
t("new-session", "-d", "-s", "keeper", "-x", "80", "-y", "20");
const h1 = await rt.create(cfg("echo launch-one"));
started.push(h1.data["tmuxServerPid"] as number);
log("h1", { id: h1.id, ...h1.data, createdAt: undefined, workspacePath: undefined });
t("kill-session", "-t", `=${h1.id}`);
const h2 = await rt.create(cfg("echo launch-two"));
log("h2", { id: h2.id, sid: h2.data["tmuxSessionId"], created: h2.data["tmuxSessionCreated"] });
log("same second", h1.data["tmuxSessionCreated"] === h2.data["tmuxSessionCreated"]);
log("isAlive(h1)", await answer(rt.isAlive(h1)));
log("isAlive(h2)", await answer(rt.isAlive(h2)));
log("stop(h1)", await answer(rt.stop(h1)));
log("h2 after stop(h1): has-session", (() => { try { t("has-session", "-t", `=${h2.id}`); return "exit 0"; } catch { return "gone"; } })());

console.log("== 2. B-5: another server answers at the recorded socket path");
const recordedPid = h2.data["tmuxServerPid"] as number;
rmSync(SOCK_V);
t("new-session", "-d", "-s", "other", "-x", "80", "-y", "20");
const otherPid = Number(t("display-message", "-p", "#{pid}"));
started.push(otherPid);
log("recorded server / answering server", `${recordedPid} / ${otherPid}`);
log("h1 and h2 had the same server", h1.data["tmuxServerPid"] === recordedPid);
log("isAlive(h2)", await answer(rt.isAlive(h2)));
log("stop(h2)", await answer(rt.stop(h2)));
log("h2's pane still runs on the recorded server", existsSync(`/proc/${recordedPid}`));
process.kill(recordedPid, "SIGTERM");
for (let i = 0; i < 100 && existsSync(`/proc/${recordedPid}`); i++) await new Promise((r) => setTimeout(r, 20));
log("after the recorded server ended: isAlive(h2)", await answer(rt.isAlive(h2)));
log("after the recorded server ended: stop(h2)", await answer(rt.stop(h2)));
tryT("kill-server");

console.log("== 3. a hidden socket of a running server (no other server at the path)");
const h3 = await rt.create(cfg("echo launch-three"));
const pid3 = h3.data["tmuxServerPid"] as number;
started.push(pid3);
rmSync(SOCK_V);
log("isAlive(h3)", await answer(rt.isAlive(h3)));
log("stop(h3)", await answer(rt.stop(h3)));
process.kill(pid3, "SIGUSR1");
await new Promise((r) => setTimeout(r, 300));
log("after SIGUSR1 to the recorded server: isAlive(h3)", await answer(rt.isAlive(h3)));
log("stop(h3)", await answer(rt.stop(h3)));
tryT("kill-server");
await new Promise((r) => setTimeout(r, 200));
for (const pid of started) log(`server pid ${pid} running`, existsSync(`/proc/${pid}`));
```

## 14. Reproducer scripts (outside the repository, `/tmp/aosd2/`)

Scratch shims: `/tmp/aosd2/bin` (`claude` stub, `gh` stub), `/tmp/aosd2/bintest/tmux` (`-L aosd2-T`, for the tests), `/tmp/aosd2/binV/tmux` (`-L aosd2-V`, for m7), `/tmp/aosd2/nodebin/node` and `/tmp/aosd2/pnpmbin/pnpm` (links to the nvm Node 25.7.0 binaries).

### env.sh

```sh
# Scratch environment for the ao-52 same-ID r2 reproducers. Source it in every script.
# Every tmux call goes to a private server aosd2-<name>; env -i removes TMUX and every AO_* variable.
S=/tmp/aosd2
WT=/home/taisung/.worktrees/agent-orchestrator/ao-52
PIDLOG=$S/logs/pids.txt
# clean <cmd...>: the scratch environment (fake HOME, scratch PATH, no TMUX, no AO_*)
clean() {
  env -i HOME=$S/home PATH=$S/bin:/usr/bin:/bin SHELL=/bin/bash TERM=xterm-256color \
    LANG=C.UTF-8 TMPDIR=$S/tmp "$@"
}
# t <server> <tmux args...>: one tmux call on the private server aosd2-<server>
t() { local srv=$1; shift; clean /usr/bin/tmux -L "aosd2-$srv" "$@"; }
# tS <socket path> <tmux args...>: one tmux call on an explicit socket under /tmp/tmux-<uid>/aosd2-*
tS() {
  local sock=$1; shift
  case "$sock" in /tmp/tmux-"$(id -u)"/aosd2-*) ;; *) echo "tS: refused socket $sock" >&2; return 99;; esac
  clean /usr/bin/tmux -S "$sock" "$@"
}
# start_private <server> <session>: start a private server from the scratch env; log its PID
start_private() {
  t "$1" new-session -d -s "$2" -x 120 -y 30 || return 1
  local pid; pid=$(t "$1" display-message -p '#{pid}')
  echo "$(date +%T.%N | cut -c1-12) server aosd2-$1 pid=$pid" >> "$PIDLOG"
  echo "$pid"
}
# proc_start <pid>: field 22 of /proc/<pid>/stat (clock ticks since boot), split after the last ")"
proc_start() { local s; s=$(cat "/proc/$1/stat" 2>/dev/null) || { echo "ENOENT"; return; }; s=${s##*) }; set -- $s; echo "${20}"; }
boot_id() { cat /proc/sys/kernel/random/boot_id; }
ts() { date +%T.%N | cut -c1-12; }
# stop_server <server>: stop a private server by its own socket; then check its logged PID is gone
stop_server() { t "$1" kill-server 2>/dev/null; return 0; }
```

### m1_identity.sh

```sh
#!/usr/bin/env bash
# m1: what tmux 3.4 gives for a launch identity, on the private server aosd2-P only.
#  1. capability probes: #{==:}, #{version}, a session user option in a format
#  2. the create command list: new-session -P -F plus set-option of a launch token, one client command
#  3. B-1 again: the timestamp guard of design r1 ends a same-second replacement
#  4. the token guard: keeps the replacement, ends its own launch, prints which branch ran
#  5. a missing target and an unsupported comparison: the else branch, with the answering server PID
set -uo pipefail
source /tmp/aosd2/scripts/env.sh
if t P ls >/dev/null 2>&1; then echo "aosd2-P already runs: stop it first"; exit 1; fi
FMT='#{session_id}|#{session_created}|#{pid}|#{start_time}|#{socket_path}'
echo "== 1. capability probes"
PPID_=$(start_private P keeper)
echo "  server pid $PPID_, version: $(t P display-message -p '#{version}')"
echo "  #{==:a,a}#{==:a,b} -> $(t P display-message -p '#{==:a,a}#{==:a,b}')"
echo "  unknown operator #{nosuchop:a,b} -> [$(t P display-message -p '#{nosuchop:a,b}')]"
echo "  set -s @ao_server x -> $(t P set-option -s @ao_server x 2>&1; echo "exit=$?") / read: [$(t P display-message -p '#{@ao_server}')]"

echo "== 2. the create command list: new-session -P -F ... ; set-option -t =victim: @ao_launch T1"
T1=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
OUT1=$(t P new-session -d -P -F "$FMT" -s victim -x 80 -y 20 \; set-option -t =victim: @ao_launch "$T1" 2>&1); echo "  exit=$? out=[$OUT1]"
echo "  token read back: $(t P display-message -p -t =victim: '#{session_id} #{@ao_launch}')"
echo "  token of a session without one (keeper): [$(t P display-message -p -t =keeper: '#{@ao_launch}')]"
IFS='|' read -r SID1 CR1 PID1 ST1 SOCK <<<"$OUT1"

echo "== 3. B-1: the timestamp guard of design r1 against a same-second replacement"
# Retry until the first launch and its replacement fall in the same second.
for try in 1 2 3 4 5; do
  t P kill-session -t =victim 2>/dev/null
  T1=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  OUT1=$(t P new-session -d -P -F "$FMT" -s victim -x 80 -y 20 \; set-option -t =victim: @ao_launch "$T1")
  IFS='|' read -r SID1 CR1 PID1 ST1 SOCK <<<"$OUT1"
  t P kill-session -t =victim
  T2=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  OUT2=$(t P new-session -d -P -F "$FMT" -s victim -x 80 -y 20 \; set-option -t =victim: @ao_launch "$T2")
  IFS='|' read -r _ CR2 _ _ _ <<<"$OUT2"
  [ "$CR1" = "$CR2" ] && break
done
echo "  try $try"
echo "  first launch [$OUT1]"
echo "  replacement  [$OUT2]"
if [ "$CR1" = "$CR2" ]; then echo "  same second: session_created $CR1 = $CR2"; else echo "  NOT the same second ($CR1 vs $CR2): rerun"; fi
G=$(t P if-shell -F -t =victim: "#{==:#{session_created}/#{start_time},$CR1/$ST1}" 'kill-session -t =victim' 2>&1); echo "  timestamp guard with the first launch's pair: exit=$? out=[$G]"
echo "  replacement after it: $(t P has-session -t =victim 2>&1; echo "exit=$?")"

echo "== 4. the token guard (then and else branches print a marker with the answering server PID)"
T3=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
OUT3=$(t P new-session -d -P -F "$FMT" -s victim -x 80 -y 20 \; set-option -t =victim: @ao_launch "$T3")
echo "  replacement 2 [$OUT3] token $T3"
guard() { # guard <token>: the proposed destroy as one client command
  t P if-shell -F -t =victim: "#{==:#{@ao_launch},$1}" \
    "kill-session -t =victim ; display-message -p ao-destroyed:#{pid}" \
    "display-message -p ao-kept:#{pid}:#{session_id}:#{@ao_launch}" 2>&1
}
echo "  guard with the old token T1: exit=$? out=[$(guard "$T1")]"
echo "  replacement 2 after it: $(t P display-message -p -t =victim: '#{session_id} #{@ao_launch}')"
echo "  guard with its own token T3: out=[$(guard "$T3")]"
echo "  victim after it: $(t P has-session -t =victim 2>&1; echo "exit=$?")"

echo "== 5. a missing target and an unsupported comparison"
echo "  missing target: [$(guard "$T3")]"
T4=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
t P new-session -d -s victim -x 80 -y 20 \; set-option -t =victim: @ao_launch "$T4"
U=$(t P if-shell -F -t =victim: "#{nosuchop:#{@ao_launch},$T4}" \
  "kill-session -t =victim ; display-message -p ao-destroyed" "display-message -p ao-kept" 2>&1)
echo "  unsupported operator with the right token: [$U], victim: $(t P has-session -t =victim 2>&1; echo "exit=$?")"
echo "  display-message -p inside if-shell reaches the calling client's stdout: see the markers above"
stop_server P
sleep 0.2
echo "== done: P $(t P ls 2>&1 | head -1 | cut -c1-40); server pid $PPID_ running: $([ -d /proc/$PPID_ ] && echo yes || echo no)"
```

### m2_guard_forms.sh

```sh
#!/usr/bin/env bash
# m2: the forms of the token guard on tmux 3.4 (private server aosd2-G only): which inner command
# texts parse, where display-message -p prints, how an unknown format operator evaluates in
# if-shell -F, and whether a guarded paste reaches only its own launch.
set -uo pipefail
source /tmp/aosd2/scripts/env.sh
if t G ls >/dev/null 2>&1; then echo "aosd2-G already runs: stop it first"; exit 1; fi
GPID=$(start_private G keeper)
tok() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
mk() { # mk <name> <token>: create a session and set its launch token in one client command
  t G new-session -d -P -F '#{session_id}' -s "$1" -x 80 -y 20 \; set-option -t "=$1:" @ao_launch "$2"
}
show() { printf '  %-58s exit=%s out=[%s]\n' "$1" "$2" "$(printf '%s' "$3" | tr '\n' '|')"; }
run() { local label=$1; shift; local out; out=$(t G "$@" 2>&1); show "$label" "$?" "$out"; }

echo "== 1. set-option targets (server pid $GPID)"
TA=$(tok)
run "new-session -P ; set-option -t =v1: @ao_launch"  new-session -d -P -F '#{session_id}' -s v1 -x 80 -y 20 \; set-option -t =v1: @ao_launch "$TA"
run "read back #{@ao_launch} of =v1:"                 display-message -p -t =v1: '#{session_id} #{@ao_launch}'
run "set-option -t =v1 (no colon)"                     set-option -t =v1 @ao_probe x

echo "== 2. inner command texts of if-shell -F (condition 1)"
run "then: display-message -p plain"                   if-shell -F 1 'display-message -p then-ran' 'display-message -p else-ran'
run "then: display-message -p ao-x:#{pid}"             if-shell -F 1 'display-message -p ao-x:#{pid}'
run "then: with #{session_id} (expands to \$N)"        if-shell -F -t =v1: 1 'display-message -p id=#{session_id}'
run "then: two commands with ' ; '"                    if-shell -F 1 'display-message -p one ; display-message -p two'
run "then: two commands with ' \\; '"                  if-shell -F 1 'display-message -p one \; display-message -p two'
run "then: kill + display (token match)"               if-shell -F -t =v1: "#{==:#{@ao_launch},$TA}" "kill-session -t =v1 ; display-message -p ao-destroyed:#{pid}" "display-message -p ao-kept"
run "v1 after it"                                       has-session -t =v1

echo "== 3. an unknown format operator in if-shell -F"
TB=$(tok); mk v2 "$TB" >/dev/null
run "display: #{nosuchop:x,y}"                         display-message -p '#{nosuchop:x,y}'
run "display: #{nosuchop:#{@ao_launch},TB} -t =v2:"     display-message -p -t =v2: "#{nosuchop:#{@ao_launch},$TB}"
run "if-shell: #{nosuchop:x,y}"                        if-shell -F '#{nosuchop:x,y}' 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell: #{nosuchop:x,x}"                        if-shell -F '#{nosuchop:x,x}' 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell -t =v2: #{nosuchop:#{@ao_launch},TB}"     if-shell -F -t =v2: "#{nosuchop:#{@ao_launch},$TB}" 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell -t =v2: #{nosuchop:#{@ao_launch},zz}"     if-shell -F -t =v2: "#{nosuchop:#{@ao_launch},zz}" 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell -t =v2: #{==:#{@ao_launch},zz}"           if-shell -F -t =v2: "#{==:#{@ao_launch},zz}" 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell: #{n:x} (a real modifier, length)"       if-shell -F '#{n:x}' 'display-message -p TRUE' 'display-message -p FALSE'
run "if-shell: #{==:1,1} result compared again"        if-shell -F '#{==:#{==:a,a},1}' 'display-message -p TRUE' 'display-message -p FALSE'

echo "== 4. guarded paste of a buffer (text never parsed by tmux)"
TC=$(tok); mk v3 "$TC" >/dev/null
printf 'echo GUARDED-PASTE "$HOME" #{pid} ; x\n' > $S/tmp/paste.txt
run "load-buffer -b ao-test"                            load-buffer -b ao-test $S/tmp/paste.txt
run "guarded paste with a wrong token"                  if-shell -F -t =v3: "#{==:#{@ao_launch},wrong}" "paste-buffer -d -b ao-test -t =v3: ; display-message -p ao-sent" "delete-buffer -b ao-test ; display-message -p ao-refused"
run "buffers after it"                                  list-buffers -F '#{buffer_name}'
run "load-buffer -b ao-test again"                      load-buffer -b ao-test $S/tmp/paste.txt
run "guarded paste with the right token"                if-shell -F -t =v3: "#{==:#{@ao_launch},$TC}" "paste-buffer -d -b ao-test -t =v3: ; send-keys -t =v3: Enter ; display-message -p ao-sent" "delete-buffer -b ao-test ; display-message -p ao-refused"
sleep 0.4
run "screen of v3 (grep GUARDED-PASTE)"                 capture-pane -p -t =v3:
echo "  lines with the pasted text: $(t G capture-pane -p -t =v3: | grep -c GUARDED-PASTE)"
run "buffers after it"                                  list-buffers -F '#{buffer_name}'

echo "== 5. a read and its token in one client command (no other client between them)"
run "display token ; capture-pane"                      display-message -p -t =v3: '#{@ao_launch}' \; capture-pane -p -t =v3: -S -1
stop_server G; sleep 0.2
echo "== done: G $(t G ls 2>&1 | head -1 | cut -c1-40); server pid $GPID running: $([ -d /proc/$GPID ] && echo yes || echo no)"
```

### m3_list_failure.sh

```sh
#!/usr/bin/env bash
# m3: does a failing command stop the rest of one client command list (tmux 3.4, aosd2-F only)?
# Needed for a fail-closed guard: a capability check in the same client command as the kill.
set -uo pipefail
source /tmp/aosd2/scripts/env.sh
if t F ls >/dev/null 2>&1; then echo "aosd2-F already runs: stop it first"; exit 1; fi
FPID=$(start_private F keeper)
run() { local label=$1; shift; local out; out=$(t F "$@" 2>&1); printf '  %-64s exit=%s out=[%s]\n' "$label" "$?" "$(printf '%s' "$out" | tr '\n' '|')"; }
t F new-session -d -s v -x 80 -y 20
echo "== server pid $FPID"
run "has-session -t =nope ; display AFTER"                          has-session -t =nope \; display-message -p AFTER
run "if-shell -F 1 'has-session -t =nope' ; display AFTER"          if-shell -F 1 'has-session -t =nope' \; display-message -p AFTER
run "if-shell -F 0 'has-session -t =nope' ; display AFTER"          if-shell -F 0 'has-session -t =nope' \; display-message -p AFTER
run "cap check #{==:a,b} (supported) ; display AFTER"               if-shell -F '#{==:a,b}' 'has-session -t =ao-unsupported-format' \; display-message -p AFTER
run "cap check, literal non-empty (as unsupported) ; kill v"        if-shell -F '#{nosuchop:#{pid},x}' 'has-session -t =ao-unsupported-format' \; kill-session -t =v
run "v after the failed check"                                       has-session -t =v
run "if-shell -F 1 'has-session -t =nope ; display IN' ; display AFTER" if-shell -F 1 'has-session -t =nope ; display-message -p IN' \; display-message -p AFTER
stop_server F; sleep 0.2
echo "== done: F $(t F ls 2>&1 | head -1 | cut -c1-40); server pid $FPID running: $([ -d /proc/$FPID ] && echo yes || echo no)"
```

### m4_launch_name.sh

```sh
#!/usr/bin/env bash
# m4: a tmux name per launch, and the server incarnation (private servers aosd2-N and aosd2-R only).
#  1. create as one client command: new-session -P -F gives the identity of this launch
#  2. the server incarnation: tmux #{pid}, /proc/<pid>/stat field 22 (raw ticks), the boot ID
#  3. a same-second replacement of the ID gets another name: an exact kill of the old name keeps it
#  4. the launch keys to an ended launch's name fail; they never reach the replacement
#  5. a server restart at the same path in the same second: $0 and both timestamps repeat; pid and ticks do not
#  6. a human attach target by prefix still finds the one live launch of an ID
set -uo pipefail
source /tmp/aosd2/scripts/env.sh
for X in N R; do if t $X ls >/dev/null 2>&1; then echo "aosd2-$X already runs: stop it first"; exit 1; fi; done
FMT='#{session_name}|#{session_id}|#{session_created}|#{pid}|#{start_time}|#{socket_path}|#{version}'
suffix() { od -An -N4 -tx1 /dev/urandom | tr -d ' \n'; }
NPID=$(start_private N keeper)
BOOT=$(boot_id)
echo "== 1. create as one client command (server pid $NPID, boot $BOOT, CLK_TCK $(getconf CLK_TCK))"
A="0123456789ab-kr-1-$(suffix)"
OUTA=$(t N new-session -d -P -F "$FMT" -s "$A" -x 80 -y 20); echo "  exit=$? [$OUTA]"
IFS='|' read -r _ SIDA CRA PIDA STA SOCK VER <<<"$OUTA"
echo "== 2. the server incarnation"
TICKS=$(proc_start "$PIDA")
BT=$(awk '/^btime/{print $2}' /proc/stat)
echo "  pid $PIDA: /proc field 22 = $TICKS ticks; btime + ticks/100 = $(( BT + TICKS / 100 )); tmux start_time $STA"
echo "  confirm in the same client command as the launch keys: $(t N display-message -p -t "=$A:" '#{pid}' \; send-keys -t "=$A:" -l 'echo launch-A' \; send-keys -t "=$A:" Enter 2>&1 | tr '\n' ' ')"
echo "== 3. a same-second replacement of the ID gets another name"
t N kill-session -t "=$A"
B="0123456789ab-kr-1-$(suffix)"
OUTB=$(t N new-session -d -P -F "$FMT" -s "$B" -x 80 -y 20)
IFS='|' read -r _ SIDB CRB _ _ _ _ <<<"$OUTB"
echo "  first  [$OUTA]"
echo "  second [$OUTB]"
[ "$CRA" = "$CRB" ] && echo "  same second: session_created $CRA = $CRB" || echo "  other second ($CRA vs $CRB)"
echo "  exact kill of the first launch's name: $(t N kill-session -t "=$A" 2>&1; echo "exit=$?")"
echo "  the second launch after it: $(t N has-session -t "=$B" 2>&1; echo "exit=$?")"
echo "== 4. the launch keys of the ended first launch"
echo "  $(t N display-message -p -t "=$A:" '#{pid}|#{session_id}' \; send-keys -t "=$A:" -l 'echo LATE-KEYS' 2>&1 | tr '\n' ' ')"
sleep 0.3
echo "  lines with LATE-KEYS on the second launch: $(t N capture-pane -p -t "=$B:" | grep -c LATE-KEYS)"
echo "== 6. a human attach target by prefix (one live launch of kr-1, and a live kr-10)"
C="0123456789ab-kr-10-$(suffix)"; t N new-session -d -s "$C" -x 80 -y 20
echo "  has-session -t 0123456789ab-kr-1- (prefix with the dash): $(t N has-session -t 0123456789ab-kr-1- 2>&1; echo "exit=$?")"
echo "  display -t 0123456789ab-kr-1-: -> $(t N display-message -p -t 0123456789ab-kr-1-: '#{session_name}' 2>&1)"
echo "  has-session -t 0123456789ab-kr-1 (no dash; kr-10 also starts with it): $(t N has-session -t 0123456789ab-kr-1 2>&1; echo "exit=$?")"
stop_server N
echo "== 5. a server restart at the same path in the same second"
R1PID=$(start_private R "0123456789ab-kr-2-$(suffix)")
L1=$(t R display-message -p "$FMT"); T1=$(proc_start "$R1PID")
stop_server R
for _ in $(seq 1 50); do [ -d /proc/$R1PID ] || break; sleep 0.02; done
R2PID=$(start_private R "0123456789ab-kr-2-$(suffix)")
L2=$(t R display-message -p "$FMT"); T2=$(proc_start "$R2PID")
echo "  first  [$L1] ticks $T1"
echo "  second [$L2] ticks $T2"
echo "  the first server's /proc entry now: $(proc_start "$R1PID")"
stop_server R; sleep 0.2
for p in $NPID $R1PID $R2PID; do echo "  server pid $p running: $([ -d /proc/$p ] && echo yes || echo no)"; done
```

### m5_rebound.sh

```sh
#!/usr/bin/env bash
# m5 (B-5): another server answers at the recorded socket path while the recorded server still runs.
# Private server aosd2-H only. I unlink only the socket file of the server that this script started.
#  1. the recorded launch on server H1; its identity
#  2. unlink H1's socket; start H2 at the same path; the identity read of the recorded name on H2
#  3. the recorded process check: /proc/<H1 pid>/stat field 22 and the boot ID
#  4. SIGUSR1 to H1 while H2 holds the path: which server answers after it, and can H2 still be reached
#  5. stop both servers by their exact PIDs; check their pane processes are gone
set -uo pipefail
source /tmp/aosd2/scripts/env.sh
if t H ls >/dev/null 2>&1; then echo "aosd2-H already runs: stop it first"; exit 1; fi
NAME="0123456789ab-kr-1-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
FMT='#{pid}|#{session_id}|#{session_created}|#{socket_path}'
echo "== 1. the recorded launch"
H1=$(start_private H keeper)
OUT=$(t H new-session -d -P -F "$FMT" -s "$NAME" -x 80 -y 20)
IFS='|' read -r RPID RSID RCR SOCK <<<"$OUT"
RTICKS=$(proc_start "$RPID"); RBOOT=$(boot_id)
P1=$(t H display-message -p -t "=$NAME:" '#{pane_pid}')
echo "  recorded: pid=$RPID ticks=$RTICKS boot=$RBOOT session=$RSID created=$RCR socket=$SOCK pane_pid=$P1"
echo "== 2. unlink H1's socket and start H2 at the same path"
case "$SOCK" in /tmp/tmux-"$(id -u)"/aosd2-H) rm -f -- "$SOCK";; *) echo "refused: $SOCK"; exit 1;; esac
echo "  after the unlink: $(t H ls 2>&1 | head -1)"
H2=$(start_private H other)
P2=$(t H display-message -p -t =other: '#{pane_pid}')
echo "  H2 pid=$H2 pane_pid=$P2"
echo "  identity read of the recorded name at the path: [$(tS "$SOCK" display-message -p -t "=$NAME:" "$FMT" 2>&1)]"
echo "  exact kill of the recorded name at the path: $(tS "$SOCK" display-message -p '#{pid}' \; kill-session -t "=$NAME" 2>&1 | tr '\n' ' ')"
echo "== 3. the recorded process check"
echo "  /proc/$RPID field 22 = $(proc_start "$RPID") (recorded $RTICKS), boot $(boot_id) (recorded $RBOOT)"
echo "  recorded pane process $P1 running: $([ -d /proc/$P1 ] && echo yes || echo no)"
echo "== 4. SIGUSR1 to H1 ($RPID) while H2 ($H2) holds the path"
kill -USR1 "$RPID"; sleep 0.3
echo "  the server that answers at the path now: pid=$(t H display-message -p '#{pid}' 2>&1) sessions=$(t H ls -F '#{session_name}' 2>&1 | tr '\n' ' ')"
echo "  H2 ($H2) running: $([ -d /proc/$H2 ] && echo yes || echo no); H2 reachable at the path: $( [ "$(t H display-message -p '#{pid}' 2>/dev/null)" = "$H2" ] && echo yes || echo no)"
echo "== 5. stop both servers by their exact PIDs"
for p in "$RPID" "$H2"; do kill -TERM "$p" 2>/dev/null; done
for _ in $(seq 1 50); do [ -d /proc/$RPID ] || [ -d /proc/$H2 ] || break; sleep 0.05; done
sleep 0.3
for p in "$RPID" "$H2" "$P1" "$P2"; do echo "  pid $p running: $([ -d /proc/$p ] && echo yes || echo no)"; done
[ -S "$SOCK" ] && { rm -f -- "$SOCK"; echo "  removed the stale socket file $SOCK of my own server"; }
```

### m6_lock_fd.mjs

```js
// m6 (B-3): does an operation lock outlive its AO holder while a mutating child runs, when the
// child inherits the lock socket's file descriptor? Linux abstract Unix socket, as delivery-lock.ts.
// Modes of this one file: (none) = the test driver; "holder" = binds the name and starts a child
// that inherits the fd; "child" = a stand-in for git (waits for a release file, then deletes one
// scratch file). Only scratch files under /tmp/aosd2/tmp/m6 change. Only PIDs started here are signalled.
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, existsSync, unlinkSync, mkdirSync, rmSync, readdirSync, readlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const root = "/tmp/aosd2/tmp/m6";
const name = "\0aosd2-operation-m6";
const mode = process.argv[2];
const variant = process.argv[3]; // "inherit" | "plain"

function tryBind() {
  return new Promise((resolve, reject) => {
    const server = createServer((s) => s.destroy());
    server.once("error", (err) => (err.code === "EADDRINUSE" ? resolve(null) : reject(err)));
    server.listen({ path: name, exclusive: true }, () => resolve(server));
  });
}

/** The PIDs that hold a socket inode bound to `name` (scan of /proc/net/unix and /proc/<pid>/fd). */
function holders() {
  const printable = "@" + name.slice(1);
  const inodes = new Set();
  for (const line of execFileSync("cat", ["/proc/net/unix"], { encoding: "utf-8" }).split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols[7] === printable) inodes.add(cols[6]);
  }
  const pids = [];
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    let fds;
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      try {
        const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
        if (m && inodes.has(m[1])) { pids.push(`${pid}(fd ${fd})`); break; }
      } catch { /* gone */ }
    }
  }
  return pids;
}

if (mode === "child") {
  while (!existsSync(`${root}/release-child`)) await delay(5);
  if (existsSync(`${root}/replacement-file`)) unlinkSync(`${root}/replacement-file`);
  writeFileSync(`${root}/child-done`, "done");
} else if (mode === "holder") {
  const server = await tryBind();
  const fd = server._handle.fd; // the listening socket's descriptor (Node keeps it close-on-exec)
  const stdio = variant === "inherit" ? ["ignore", "ignore", "ignore", fd] : ["ignore", "ignore", "ignore"];
  const child = spawn(process.execPath, [import.meta.filename, "child"], { stdio });
  process.stdout.write(JSON.stringify({ holder: process.pid, child: child.pid, fd }) + "\n");
  setInterval(() => {}, 1000);
} else {
  for (const v of ["plain", "inherit"]) {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const holder = spawn(process.execPath, [import.meta.filename, "holder", v], { stdio: ["ignore", "pipe", "inherit"] });
    const pair = await new Promise((r) => holder.stdout.once("data", (d) => r(JSON.parse(d.toString()))));
    const before = holders();
    holder.kill("SIGKILL");
    await new Promise((r) => holder.once("exit", r));
    const afterHolderDied = holders();
    const early = await tryBind();
    const earlyAcquired = early !== null;
    if (early) early.close();
    // The new operation starts only if it holds the lock; then it writes its file.
    let contender = null;
    if (earlyAcquired) {
      contender = await tryBind();
      writeFileSync(`${root}/replacement-file`, "new operation owns this");
    }
    writeFileSync(`${root}/release-child`, "go");
    for (let i = 0; i < 400 && !existsSync(`${root}/child-done`); i++) await delay(5);
    await delay(50);
    let lateAcquired = earlyAcquired;
    if (!earlyAcquired) {
      contender = await tryBind();
      lateAcquired = contender !== null;
      if (lateAcquired) writeFileSync(`${root}/replacement-file`, "new operation owns this");
    }
    console.log(JSON.stringify({
      variant: v, ...pair, holdersBefore: before, holdersAfterHolderDied: afterHolderDied,
      contenderAcquiredWhileChildRan: earlyAcquired, childFinished: existsSync(`${root}/child-done`),
      contenderAcquiredAfterChildEnded: lateAcquired, replacementFilePresent: existsSync(`${root}/replacement-file`),
    }));
    if (contender) contender.close();
    try { process.kill(pair.child, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  }
}
```

### vt.sh

```sh
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd2
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
```

### bin/claude

```sh
#!/bin/bash
echo "$(date +%T.%N | cut -c1-12) stub claude pid=$$" >> /tmp/aosd2/logs/stub.log
exec -a claude /bin/sleep 1000000
```

### bin/gh

```sh
#!/bin/sh
case "$1 $2" in
  "--version "*) echo "gh version 0.0.0 (aosd2 stub)"; exit 0;;
  "auth status") echo "stub: logged in" >&2; exit 0;;
esac
echo "gh stub: offline" >&2
exit 1
```

### bintest/tmux

```sh
#!/bin/sh
exec /usr/bin/tmux -L aosd2-T "$@"
```

### binV/tmux

```sh
#!/bin/sh
exec /usr/bin/tmux -L aosd2-V "$@"
```
