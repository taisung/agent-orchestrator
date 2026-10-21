# Same-ID design, revision r3: R2b, R3a, R3b and the Herdr close (ao-52)

Author: ao-52 (Claude Code, Opus 5.5), 2026-10-21. Base `cbfbc182` (main with R1, plus the r2 tests).
Input: the re-check of design r2 by ao-51 (`development/reviews/same_id_design_review_r2_astra6.md` on
`main`, commit `3843a025`; called "the review" below), design r2
(`development/reviews/same_id_design_r2_opus.md`), the R2a brief of ao-55 (section 1), and the owner
decisions "1a 2a 3a 4a" of 2026-10-21.

This is a design. No source file changed. The commits `0be91637`, `3f6d1551`, `acf944f8` and `c8a35d47`
add or correct tests only. R2a (design r2 sections 2.6 and 2.7, as briefed to ao-55) and R4 (design r2 section 3,
with the correction of section 4 below) are not designed again here. Sections 2, 3, 5 and 6 are
self-contained for R2b, the Herdr close, R3a and R3b.

Measurement names: `h1` to `h4` (Herdr 0.8.0 on an isolated scratch server), `t1` to `t3` (tmux 3.4 on
private servers), `rv` (the review's `descendant.mjs` and `protocols.mjs`, run again). Section 8 has
the commands and the output, section 15 the scripts in full.

## 0. Response table

| Finding | Decision | Design r3 | Test (file: test) |
| --- | --- | --- | --- |
| **B-1** mutations by a reusable name | Accepted. OD-17 (b): the stable tmux name stays; a 128-bit launch token is set on the session in the create command and checked BY TMUX in the same client command as every pane mutation (kill, keys, paste, attach, association). `isAlive` is positive only for the token on the recorded server incarnation. A legacy association sets a token by a compare-and-set inside tmux. Measured on tmux 3.4 (t1 to t3). | 2.1 to 2.9 | runtime-tmux r3: 5 defects on real tmux (destroy, isAlive, sendMessage to a later launch of the same name; a replacement between the commands of one sendMessage; destroy after a socket rebound); 13 controls, 10 of them pin the guard forms |
| **B-2** Herdr close can close a replacement | Accepted. Herdr 0.8.0 has no compare-and-close (`pane.close` takes only `pane_id`) and answers one request per connection (h3), so no single request can check and close. Herdr `stop` stays `unknown` (as in R2a) in every round of this plan. The owner accepts manual closes for Herdr sessions, and R2b-1 makes `destroy` refuse too (3.4). An optional round RH can add a close that is bound to the server process of its check (measured, h3, h4); the cleanest fix is an upstream compare-and-close (OD-19). | 3 | runtime-herdr r3: 3 defects (a restart between the check and the close; a user pane in the workspace; a record without a terminal ID), 1 control. runtime-herdr r2: header and one control corrected |
| **B-3** descendants that drop or keep the lock descriptor | Accepted. OD-14 (c) as an in-process supervisor: every mutating child runs in its own process group, after a write-ahead journal entry; AO kills the whole group when the direct child ends or times out and waits until the group is empty. The next operation on the ID reads the journal under the lock and refuses while a journaled group has a member. No lock descriptor goes to children, so a daemon cannot hold the lock. Never steal by time. | 5.2 | workspace-worktree r3: 1 defect (a grandchild with `stdio: "ignore"` still runs when postCreate returns), 1 control; `rv` descendant.mjs |
| **B-4** OpenCode quarantine and holders smaller than the lock | Accepted. A store namespace inside the canonical OpenCode store holds the quarantine and the holder index; every remover, interrupter and reuser reads it under the `opencode-session(store, S)` lock. An unknown store identity refuses. | 6 | core r3: 1 defect (cleanup of one project removes the OpenCode session under a live session of another project), 1 control; `rv` protocols.mjs |
| **B-5** old shell writers outside the lock; epoch | Accepted. A new round RW (before R2b) replaces the `sed`/`mv` writers of the PATH-wrapper helper and of the Claude hook with an append-only inbox per session that a Node applier reads under the record lock, with a launch-ID check (`AO_LAUNCH_ID`). The epoch file gets a locked monotonic raise, refuses unreadable state, and is checked again at each mutation admission, also by resident workers. | 5.6, 5.7, 7 | core r3: 1 defect (the helper's `mv` puts its stale copy over a Node write of a new `runtimeHandle`), 1 control |
| **M-1** the N-3 test oracle | Accepted. N-3's blanket claim is withdrawn: a double-quoted format in a branch works, an unquoted one is a syntax error, an unknown operator is FALSE over literal text and TRUE over a nested format, `if-shell -t` with a missing target runs on another session, and a branch command does not use the `if-shell` target. The r2 stand-in follows these rules now and has 8 oracle controls; the r3 file pins the production forms on real tmux. | 2.3, 8.2 to 8.4 | runtime-tmux r2: stand-in corrected, 8 new controls; runtime-tmux r3: 10 real-tmux controls |
| **M-2** the suffix breaks the host lookup | Resolved by OD-17 (b): no suffix, so `fleet_watch.sh` and `ao_relaunch.py` keep their name rules (2.10). A documented read-only lookup `ao session where <id> [--json]` gives the effective identity, the socket and the exact target, and exits non-zero on unknown. | 2.10 | none new (no consumer change is needed); the `where` tests are in the R2b-2 plan |
| **M-3** legacy association and retirement incomplete | Accepted. One effective-identity resolver for every reader; association by a tmux compare-and-set of a token plus a record compare-and-write, with an evidence hash that the owner acknowledges (the tmux part measured, t3); `runtimeAssociation` becomes a launch-identity key; a read-only batch audit; the minimal inventory and `stop-retained` move into R2b-2; retire fails when the inventory publish fails. | 2.9 | tests listed in the R2b-2 plan (8) |
| **m-1** R4 malformed git answer | Accepted, as the only change to design r2 section 3. | 4 | as in the R4 plan (8) |

## 1. What changed from design r2

- **R2b** (section 2): the name per launch (`<base>-r<8 hex>`) is withdrawn (OD-17 decided (b)). The tmux
  name stays as today. A launch token, set in the create command, makes every mutation identity-bound.
  Every guard form was measured on tmux 3.4 (t1 to t3). R2b is split into R2b-1 (new launches) and R2b-2
  (legacy records, association, audit, retire, minimal inventory, `where`).
- **N-3** of design r2 was wrong in its conclusion (M-1). The guard forms in section 2.3 are the correction.
- **Herdr** (section 3): the pane check of design r2 section 2.6 cannot protect the close (B-2). The stop
  stays `unknown`. Herdr 0.8.0 was measured on an isolated scratch server: IDs, restarts, close answers,
  one request per connection, and the peer process of a connection.
- **R3a** (section 5): descriptor inheritance (OD-14 (a)) is replaced by the process-group supervisor with a
  journal (OD-14 (c)). The path lock is replaced by one enforced owner per project worktree directory
  (OD-13). The old shell writers move to the new round RW. The epoch rules are complete.
- **R3b** (section 6): the quarantine and the holder index move from the project state directory to the
  canonical OpenCode store.
- **Lifecycle**: the two-negative confirmation stays. Design r2 section 2.9 ("killed at the first
  authoritative negative") is withdrawn. I propose no change, so there is no owner decision for it.
- **Round plan** (section 11): R4, RW, R2b-1, R2b-2, R3a, R3b, and an optional RH, all after R2a.

## 2. R2b: a stable name and a launch token (OD-17 (b))

### 2.1 The launch identity

| `handle.data` field | Source | Used by |
| --- | --- | --- |
| (`handle.id`) the stable tmux name, as today | core's `tmuxName` | every target, `=<id>` or `=<id>:` (R1) |
| `tmuxLaunchToken` | `randomBytes(16).toString("hex")` in runtime-tmux `create` | the guard of every mutation; `isAlive` |
| `tmuxSocket` | `#{socket_path}` of the create answer | `-S <socket>` on every call with the handle |
| `tmuxServerPid`, `tmuxServerStartTicks`, `tmuxBootId` | `#{pid}` of the create answer; `/proc/<pid>/stat` field 22 (split after the last `)`); `/proc/sys/kernel/random/boot_id` | the recorded-server check that classifies an answer as `absent` or `unknown` (2.4); never a permit to mutate |
| `tmuxSessionId` (`$N`), `tmuxVersion`, `createdAt` | the create answer | the create read-back check; diagnostics |

Why the token is the launch identity:

1. The create command list makes the session and sets `@ao_launch` on it, with no wait point between the
   items (2.2). t1 E: 200 creates against a racer that killed and made the same name between client
   commands gave 0 lost and 0 mismatched tokens. The control with a `run-shell` wait point between the
   items gave 56 lost and 86 mismatched in 200.
2. A session user option belongs to one session. It ends with the session (t1 B3: each session has its
   own value). So a token never names a later launch, and a restore makes a new token.
3. 128 random bits: a collision between two launches is not a practical event. Copying needs a process of
   the same uid that runs `set-option` on purpose; such a process can also edit the records, so it is
   outside the model (residual R-1 in 2.11).
4. The check runs inside tmux, in the same client command as the mutation (one connection, one command
   list), so no other client's command runs between the check and the mutation (t1 E, and the review's
   B-1 requirement "on the same connection").

`$N` and the server incarnation do not decide a mutation. They decide only how an answer without our token
is read (t1 D): the same name and the same `$0` exist on two servers (D1), after a server restart (D3), and
at a rebound socket path while the recorded server still runs (D4). In each case the guard keeps the other
session, and the incarnation check gives `other-launch` (the recorded server answered, or it ended) or
`unknown` (another server answers while the recorded server still runs).

### 2.2 Create (B-1, B-2 of round 1)

runtime-tmux `create`, on the caller's environment (the same `PATH` and tmux shim as today):

1. One client command:
   `tmux new-session -d -P -F 'ao-created:#{pid}|#{session_id}|#{version}|#{socket_path}' -s <name> -c <ws> -e <K=V> ... ; set-option -t =<name>: @ao_launch <token> ; display-message -p -t =<name>: 'ao-token:#{session_id}|#{@ao_launch}'`
   (`;` is a separate argv element; the socket path is the last field; no shell command, as today: the
   launch keys follow in step 5).
2. Check the answer: the two `$N` are equal, the token is our own, the version is allowed (2.12), the
   socket path is absolute. "duplicate session" fails the create as today (nothing to undo).
3. Read `/proc/<pid>/stat` field 22 and the boot ID.
4. On a check or read failure: the guarded kill (2.3) with our token, then fail. The guard only acts on a
   session that has our token, so a failed create never ends another launch. If the read-back shows the
   token on another `$N` (not seen in t1 E), create stops nothing and fails with `unknown`; the error
   names both `$N`, and the R2a rollback rule keeps the workspace and the record (`launchFailed`).
5. The launch keys: `load-buffer -b ao-<16 hex> <file>` (the launch command or the invocation of the launch
   script, in a 0600 temporary file as today, or `-` with the text on stdin, t1 C7; either way the text
   never passes the tmux parser), then one guarded command whose TRUE branch
   is `paste-buffer -d -b <buf> -t =<name>: ; send-keys -t =<name>: Enter` and whose FALSE branch deletes
   the buffer. Any answer other than `done` gives the guarded kill and a failed create.
6. Return the handle with all fields (written once; `launchIdentity` stays stable).

### 2.3 The guard

Every mutation with a new handle is one client command on `-S <tmuxSocket>`:

```text
display-message -p 'ao-server:#{pid}'
; has-session -t =<name>
; if-shell -F -t =<name>: '#{==:#{session_name},<name>}'
    'if-shell -F -t =<name>: "#{==:#{session_name},ao.cap.x}"
       { display-message -p "ao-refused:#{pid}" }
       { if-shell -F -t =<name>: "#{==:#{session_name}/#{@ao_launch},<name>/<token>}"
           { <mutation> ; display-message -p "ao-done:#{pid}" }
           { display-message -p -t =<name>: "ao-kept:#{pid}:#{session_id}" } }'
    'display-message -p "ao-refused:#{pid}"'
; display-message -p ao-end
```

(Shown on several lines; the real call is one argv list. `guardArgs` in
`runtime-tmux/src/__tests__/same-id-defects-r3.test.ts` and in t1 is the exact form.)

Rules, each from a measurement:

| Rule | Why |
| --- | --- |
| `has-session -t =<name>` first, at the top level | `if-shell -t` with a missing target does not fail: it runs on the current session (t1 A12, C3 of the first t1 run). A failing top-level command stops the list (t1 A11), so an absent session gives no mutation and no `ao-end` |
| The capability gate: `#{==:#{session_name},<name>}` must be TRUE and `#{==:#{session_name},ao.cap.x}` FALSE, both over a nested format | An unknown operator is TRUE over a nested format and FALSE over literal text (t1 A3, A3b, A3c). Without the gate, an unknown operator over the token check is TRUE and the mutation runs with a wrong token (t1 C4b: the session `U` was killed). With the gate, both behaviors give `ao-refused` (t1 C4: own token, the session stays). A `.` is never in a tmux session name (tmux makes `a.b` into `a_b`, t3), so `ao.cap.x` never equals `<name>` |
| The token check also compares `#{session_name}` | It binds the check to the named session, also if a later tmux resolves targets in another way |
| The mutation exists only in the innermost TRUE branch | A failure in a branch does not stop the outer list (t1 A10), so nothing destructive may follow a branch |
| Every command in a branch names its exact target | A branch command without `-t` runs on the current session, not on the `if-shell` target (t2: `-t =N:` printed `M`) |
| Formats in a branch are double-quoted | An unquoted `#{` in a branch is a syntax error; a quoted one expands when its command runs (t1 A4, A5, A8) |
| Nested lists use `{ ... }` inside the branch string | Braces work inside a branch string (t1 A6), not as separate argv elements (t1 A7) |
| No `$` in a branch | `$NAME` expands from the environment outside single quotes (t2). Names are `[A-Za-z0-9_-]`, tokens and buffer names are hex, so no `$` is needed |
| Message text goes through `load-buffer` (a file, or stdin) | The text never passes the tmux parser (t1 C7 pasted `$HOME ; #{pid} "q" 'a'` unchanged) |
| `ao-end` last, at the top level | After an existing session, a missing `ao-end` cannot happen; a failed mutation gives `ao-end` with exit 1 and no `ao-done` (t1 C5) |

The client reads the answer:

| Output, exit | Answer |
| --- | --- |
| `ao-server`, `ao-done`, `ao-end`, exit 0 | `done` (for `stop`: `destroyed`) |
| `ao-server`, `ao-kept:<pid>:<$N>`, `ao-end` | `other-launch` if the answering server is the recorded incarnation or the recorded server ended; else `unknown` |
| `ao-server` only, exit 1, stderr exactly `can't find session: <name>` | `absent` by the same rule; else `unknown` |
| `ao-server`, `ao-refused`, `ao-end` | `unknown` (unsupported form) |
| `ao-server`, `ao-end`, exit 1, other stderr | `unknown` (the mutation failed) |
| no `ao-server` line: no server, connection refused, timeout | `absent` if the recorded server ended (2.4); else `unknown` |

The recorded-server check is design r2 section 2.5 ("gone" for another boot ID, `ENOENT`/`ESRCH`, state
`Z`/`X`, or other ticks; "runs" for equal ticks; every other failure is "unknown"). It runs after the
command and only classifies; the token alone permits the mutation. t1 C1 to C9 and D1 to D4 show each row.
The last session of a server (t1 C9): the kill ends the server after the list, and `ao-done` and `ao-end`
still print.

### 2.4 `isAlive` and status

`isAlive`: `display-message -p -t =<name>: 'ao-alive:#{pid}|#{session_id}|#{@ao_launch}'` on `-S`
(read-only; `display-message` prints the server fields with empty session fields for a missing target).

| Answer | Result |
| --- | --- |
| our token, and the answering server is the recorded incarnation | `true` |
| our token, another incarnation | reject `ERR_RUNTIME_PROBE` (not possible without a copied token) |
| another token or empty session fields; the recorded server answers, or it ended | `false` |
| the same, while another server answers and the recorded server runs, or the check fails | reject |
| no server; the recorded server ended | `false` |
| any other error | reject |

The positive answer uses the full stored identity: the token and the incarnation (review B-1, "the positive
isAlive path"). The review's stale-identity case (same PID and `$N`, old ticks or boot ID) is a rejection.

`ao status` and `ao session ls` (the review's distinction of design r2 section 2.8):

| Record | Probe | Shows | Stored status |
| --- | --- | --- | --- |
| new launch | `true` | the agent activity | kept |
| new launch | `false` | `exited` | the lifecycle decides (two negatives) |
| new launch | reject | `unknown: <detail>` and the hint | kept |
| legacy | `has-session -t =<base>` exit 0 on the caller's server | `alive (legacy: server not proven)` | kept |
| legacy | negative or error, no host assertion | `unknown (legacy)` | kept |
| legacy | negative from the default socket, with `legacyTmuxServer: default` | `exited` | the lifecycle decides |
| associated legacy | as a new launch, with the association's token | as a new launch | as a new launch |

### 2.5 `stop` for tmux

runtime-tmux gets `stop(handle)` (R2a's optional method): the guard of 2.3 with the mutation
`kill-session -t =<name>`, read by the table of 2.3.

For a legacy handle (R2b-2; R2b-1 keeps the behavior after R2a), on the caller's server: read
`#{session_created}` of `=<base>`. Outside the lifecycle tolerance of `createdAt` (15 s before, 1 s after):
`other-launch`, no kill (the visible session is another launch, on whatever server). Inside the tolerance:
with the host assertion, design r2 section 2.8 (the kill; two client commands, so the residual R-3 of
2.11); without it, `unknown` ("legacy record: run `ao session audit`, then `associate` or `retire`"). No
session or no server: `absent` only with the assertion and the default socket, else `unknown`.

`destroy` stays in the interface (direct callers, and the `stopRuntime` fallback of other runtimes). It
runs `stop`, so it never ends another launch. It resolves when its own launch does not run at the address
(`destroyed`, `absent`, `other-launch`) and rejects for `unknown`. Core callers use `stop` through
`stopRuntime` and never take a resolved `destroy` as proof that the address is free. (The r2 and
`c516cead` defects call `destroy` of an ended launch without a catch and expect it to resolve while the
later launch stays; this rule gives exactly that.)

### 2.6 `sendMessage`, the agents and the other mutations

`sendMessage(handle, text)`, each step one guarded command:

1. `send-keys -t =<name>: C-u`;
2. `load-buffer -b ao-<16 hex> <file>` (a temporary file, or `-` with stdin), then the guard with `paste-buffer -d -b <buf> -t =<name>:` (the
   FALSE branch also runs `delete-buffer -b <buf>`);
3. `sleep 300 ms` (as today);
4. the guard with `send-keys -t =<name>: Enter`.

Each step must answer `done`. Any other answer rejects with the answer, for example "delivery unconfirmed:
the session now holds another launch". If step 4 answers `other-launch`, the text went only to our own
launch, which has ended. All text goes through the buffer, also short text (today `send-keys -l`).

`getOutput` (`capture-pane`) is a read. It stays unguarded but gets `-S`. A read of another launch's
screen gives wrong data, not a mutation.

The four agents (`isProcessRunning`, `list-panes`, and OpenCode's pane discovery,
`agent-opencode/src/index.ts:646-680`): `-S <socket>`, and the format also prints `#{pid}` and `#{@ao_launch}` (t3:
`list-panes -t =<name>:` and `list-panes -a` print the session option). The agent compares it with the
handle's token. When the handle has a token, the agent reads the answer as `isAlive` does (2.4): the own
token on the recorded incarnation lets it check the pane's process; another token or no session on the
recorded server, or a recorded server that ended, answers `false`; every other case rejects (unknown),
never `false`, so the R2a lifecycle gate sees a runtime error and keeps the session.

Other mutations with a handle: none exist in runtime-tmux today besides these. A new one must use the
guard (a review checklist item and a test that greps runtime-tmux for `send-keys`, `paste-buffer`,
`kill-session`, `attach` outside `guardArgs`).

### 2.7 Attach

The CLI (`cli/src/commands/session.ts:185-200`) builds `["attach", "-t", target]` itself and ignores the
runtime's command (review). R2b-1 adds an optional `args?: string[]` to `AttachInfo`
(`core/src/types.ts`). runtime-tmux returns `["-S", <socket>, ...guard("attach-session -t =<name>")]`.
The FALSE and refused branches end with `has-session -t %2147483647` (a pane ID that a server reaches only
after 2^31 panes), so the client exits 1 after it prints the marker (t3: `ao-kept`, `ao-end`, exit 1; the
own token gives exit 0). A name target is not safe here: `=ao.refused` reads as session `ao` plus pane
`refused` (t3). The CLI spawns `command` with `args` when `args` is present (stdio inherited), and prints
"not attached: the session holds another launch" or the `unknown` hint on exit 1. Measured (t1 C8,
through `script` for a terminal): the own token attached the client to `K` (`list-clients` showed
`K:<pid>`) and `detach-client` ended it; another token attached nothing and printed
`ao-kept:<pid>:$5`. The `isAlive` before the attach stays (a clear message for the common case); the guard
closes the gap between the two.

### 2.8 Server routing

Every call with a new handle adds `-S <tmuxSocket>` (design r2 section 2.4, kept): runtime-tmux, the four
agents, core `session-manager.ts` (the raw `has-session` of the holder check, `getTmuxForegroundCommand`),
core `tmux.ts`, CLI `send.ts`, `session.ts` and `status.ts`, through one helper `tmuxServerArgs(identity)`
of the resolver (2.9). It gives `-S <tmuxSocket>` whenever the handle has `tmuxSocket`, also a handle without
a token (the `c516cead` agent tests use one), and `[]` otherwise. The token check applies only when the
handle has `tmuxLaunchToken`; a handle with a socket and no token is `legacy` for every mutation. The shim and `TMUX` rules of today apply only to calls without a handle (create).

### 2.9 Legacy records (M-3, OD-3, OD-16)

**One effective-identity resolver.** `resolveRuntimeIdentity(record)` in core returns
`{ kind: "launch" | "associated" | "legacy", handle, token?, socketArgs, incarnation? }`:
`launch` for a handle with a token; `associated` for a legacy handle plus a valid `runtimeAssociation`;
`legacy` otherwise. An unreadable or malformed handle or association rejects (unknown; R4 rules). Every
reader uses it: the CLI (`send`, `attach`, `kill`, `status`, `where`), core (stop, isAlive, the holder
checks, restore), the lifecycle, the agent probes (the resolver gives the handle with the token), the
inventory and `stop-retained`. CLI `send.ts:49-55` today catches a resolution failure and goes on to an
unmanaged send on the default server; with the resolver, a failure refuses with the cause.

**Association** (`ao session associate <id> --evidence <hash>`, owner-run):

1. The evidence comes from the audit (below): socket, server PID, ticks, boot ID, `$N`, `pane_pid`, the
   pane process start ticks, `#{session_created}`, and the record's generation and launch identity at the
   audit. Its hash is the evidence ID that the owner passes, so the owner acknowledges exactly this pane.
2. Under the operation lock of the ID (R3a; before R3a, with a re-read of the record and a refusal if the
   generation changed): read the record again; it must still have the audited generation and launch
   identity.
3. One tmux command, a compare-and-set inside tmux, with the server gate and `has-session` of 2.3: the
   TRUE branch of `#{==:#{session_name}/#{pane_pid}/#{@ao_launch},<base>/<pid>/}` (no token yet) runs
   `set-option -t =<base>: @ao_launch <new token> ; display-message -p "ao-assoc:#{pid}"`; the FALSE
   branch prints `ao-assoc-refused` with the target named. The `pane_pid` also must have the audited
   start ticks (checked before the command, and the server PID and ticks after it, as in 2.3). Measured
   (t3 part 3): a wrong `pane_pid` and a present token give `ao-assoc-refused`; the audited pane gets the
   token, and the guard then acts on it.
4. Then `updateMetadataIf` with the audited generation and launch identity writes `runtimeAssociation`
   (JSON: token, socket, server PID, ticks, boot ID, `$N`, `pane_pid`, evidence hash, `associatedAt`).
   `runtimeAssociation` joins `LAUNCH_IDENTITY_KEYS` (`metadata.ts`), so an in-flight operation that read
   the old identity fails its conditional write.
5. The order is tmux first, record second. If step 4 fails, the token stays on the legacy session without
   a record that names it: no reader trusts it, and a new audit shows "token present, not associated". The
   other order could give a record whose token no session holds, and the guard would answer `absent`,
   which lets a kill remove a live worktree.
6. A restore publishes a new `runtimeHandle` and deletes `runtimeAssociation` in the same write.

**Audit** (`ao session audit [--project <id>] [--json]`, read-only, never mutates): for each active
record: the resolver kind; the known servers (the caller's server, and each socket that a record, an
archive or an inventory entry names); for a legacy record, each `=<base>` found with `$N`, `pane_pid`,
pane process start ticks, `#{session_created}` against `createdAt` (lifecycle tolerance), the pane's
current command and cwd; and a proposed action (associate with the evidence ID, retire, or none). It
never infers provenance from the presence of a default socket. The owner applies the proposals one by one,
or with `--from-audit <file> --confirm`, which checks each evidence again.

**Retire** (`ao session retire <id> --reason <text> --confirm`): shows the audit row, writes the inventory
entry (write, fsync, rename, directory fsync), and only then archives the record with `retiredAt`,
`retireReason` and `retireEvidence`. If the inventory publish fails, retire fails and the record stays.

**Minimal inventory** (R2b-2; design r2 section 4.6 otherwise): `<project state dir>/retained-runtimes/`,
one JSON file per kept runtime. A legacy entry without a proven identity has `kind: "legacy-unproven"`
with the base name, the candidate servers and the evidence; its only action is "associate first". A new
or associated entry has the full identity and the action `ao session stop-retained <entry>`, which runs
`stopRuntime` (the guard) and removes the entry only on `destroyed` or `absent`. `ao status` lists every
entry. Crash points: after the entry and before the archive (the record and the entry both exist; status
shows both; a retry of retire is idempotent); after the archive (the entry keeps the runtime listed).

**Legacy send** (OD-18): `ao send` to a legacy record without an association sends to the visible exact
`=<base>` on the caller's server, as today, and prints a one-line notice once per session. A refusal would
stop every live fleet at the R2b-2 rollout. The residual (R-2 in 2.11) ends with the association.

### 2.10 Host tools and the lookup (M-2)

With the stable name, the host tools need no change:

| Tool | What it does (read only, sources named in the brief) | With R2b |
| --- | --- | --- |
| `fleet_watch.sh` | `tmux list-sessions` (`:475`), `capture-pane -t "=$pane_name:"` (`:1587`), `resolve_pane` exact or `-<session>` ending (`:564-585`), `target_alive_check` (`:498-507`); mutates only through `ao send` | unchanged: the names keep their form; `ao send` is guarded |
| `ao_relaunch.py` | `find_tmux_session` needs exactly one name that ends in `-<session>` (`:181-190`), then `display-message '#{pane_pid}'`; its run path calls no tmux | unchanged |
| a human's `capture-pane -t =<name>:` | read | unchanged |

Both tools use the server that a plain `tmux` reaches. A launch that `ao` made on another socket (a `TMUX`
or `-L` environment) was never visible to them; `where` gives its socket.

`ao session where <id> [--json]` (read-only): prints the resolver kind, the absolute socket, the exact
target (`=<name>:`), the recorded server PID, and the incarnation check (`runs`, `gone`, `unknown`). It
does not print the token. Exit 0 for `launch` or `associated` with a running recorded server, 3 for
`legacy` (server not proven), 4 for gone, 2 for unknown or an unreadable record. It never guesses a
server.

### 2.11 Residuals of R2b

- **R-1** A process of the same uid can read a token (`show-options`) and set it on another session,
  remove it, or shadow it with a pane option of the same name (t3: a format reads the pane option
  first). This is the same trust level as editing the records. A wrong value gives only `other-launch`
  or `unknown` (fail-closed); only a copied token gives a wrong mutation.
- **R-2** A legacy record without an association: `ao send` reaches whatever session has the base name on
  the caller's server (OD-18). Kill, cleanup and restore refuse.
- **R-3** With the host assertion, a legacy stop is two client commands (read, then kill), as in design r2
  section 2.8.
- **R-4** The tmux versions: only versions on which the real-tmux controls ran green (OD-15).
- **R-5** `getOutput` and the human captures are unguarded reads.

### 2.12 Version and capability (OD-15)

Create refuses a tmux whose `#{version}` is not on the allow list, with the message "tmux <v> is not
qualified for ao launch guards; run the runtime-tmux r3 controls on it". The allow list starts with `3.4`
(measured). Adding a version needs a green run of the real-tmux controls of
`same-id-defects-r3.test.ts` on it. The gate in every guard (2.3) still refuses an unsupported operator at
run time.

## 3. The Herdr close (B-2)

### 3.1 What herdr 0.8.0 offers (h1 to h4, `--help`, `herdr api schema --json`, `herdr --skill`)

| Question | Answer | Source |
| --- | --- | --- |
| A close that names a terminal, or a compare-and-close | No. `pane.close` and `workspace.close` take only `pane_id` or `workspace_id` (`PaneTarget`, `WorkspaceTarget`) | schema; `pane close --help` |
| Several requests on one connection | No. The server answers one request and closes the connection (two pings in one write gave one answer, then a reset) | h3 |
| IDs within one server run | Never used again: workspaces `w1` to `wA`, panes `p1` to `p5` (h1); the skill file says so for panes and tabs | h1; skill line 68 |
| IDs after a restart with a saved session | The same workspace and pane IDs come back, each with a NEW terminal ID; a new workspace continues after them (`w3`) | h2, h3 |
| IDs after a restart without a saved session | The count starts at `w1` again | h2 (first server, saved session removed) |
| A pane whose shell exits | The pane closes; the last pane also closes its workspace | h1 |
| `pane close` of the last pane | The workspace closes too | h3 |
| `pane move` | A new pane ID; the old ID still resolves from outside, and a close by the old ID closes the moved pane (the skill file says only the moved process's context keeps it) | h2 |
| The terminal ID | `term_` plus the creation time in microseconds (hex) plus a counter digit | h3 |
| The server process of a connection | `SO_PEERCRED` gives the server PID before the client sends (Python); Node has no such API, but `/proc/self/fd/<fd>` plus `ss -xpn` gives it (h4, needs the internal `_handle.fd`) | h3, h4 |
| A server incarnation in the API | No PID or start time in `status server --json` or `ping` | h3 |

### 3.2 Why no current form is safe

A close must reach the pane that the check saw. The check (`pane get`) and the close are two requests,
so two connections. Between them the server can restart and restore the same pane ID with another
terminal (h2, h3), or start without a saved session and give the ID to another workspace. A positional
close then closes that pane. The review's protocol counterexample stands, now with measured restart
behavior. Today's `destroy` closes the whole workspace, so it also closes a user's pane in that workspace
(runtime-herdr r3 test 2), and it closes a pane of a record without a terminal ID (test 3).

### 3.3 Options

| Option | Safety | Cost |
| --- | --- | --- |
| **H-a** `stop` stays `unknown` (R2a), and `destroy` refuses | No close by ao; nothing can close a replacement | Herdr sessions are never killed, cleaned or restored by ao; the owner closes them by hand (3.4) |
| **H-b** a close bound to the server process of its check: `pane.get` on connection 1; connection 2 is used for `pane.close` only if its peer (PID, start ticks, boot ID) equals connection 1's peer, read after connect and BEFORE the close is sent; then `pane.get` on connection 3 must answer `pane_not_found`; close the pane only, never the workspace | Measured (h3): the own terminal closes; a wrong terminal gives no close; a restart between the get and the close gives a different peer and no close (the restored pane stays). Within one run a pane ID never names another pane, so the close reaches the checked terminal | AO speaks the socket API (one JSON request per connection); the peer lookup in Node needs `_handle.fd` and `ss` (h4) or a native helper; residual: a same-uid process that renames socket files |
| **H-c** upstream: `pane.close` with an `expected_terminal_id`, checked by the server | The cleanest: one request | Not in our control |

**Recommendation: H-a now (OD-19 (a)), a request for H-c upstream, and H-b only as the optional round RH
if the owner wants ao to close Herdr panes before H-c exists.** No live record uses Herdr (R2a brief).

### 3.4 What the owner accepts with H-a

- `ao session kill`, `cleanup` (every route), restore, the orchestrator replacement and the recovery
  cleanup of a Herdr session refuse with exit 1 and "Herdr close cannot check the terminal at close time".
- The manual path: `herdr pane get <pane>` (check the terminal ID against `ao session where <id>`), then
  `herdr pane close <pane>`, then `ao session retire <id>` (2.9), which writes an inventory entry.
- `sendMessage` and attach still go by pane ID (`agent prompt <pane>`, `pane send-text`,
  `herdr agent attach <pane>`). After a restart with a saved session the restored pane gets the message
  (a new shell or a resumed agent of the same session). After a restart without a saved session, the ID
  can name another session's pane. This residual stays until RH: RH would name the agent per launch
  (agent names "follow the current pane occupant and are cleared when that agent exits, is released, or
  is replaced", skill file) and prompt by name, and bind the raw fallback like the close.
- Tests under H-a: R2b-1 makes runtime-herdr `destroy` call `stop` and throw on `unknown`, with no close
  request. This turns the three runtime-herdr r3 defects and the r2 N-1 defect green. The r2 control
  "destroy closes the recorded pane while it has the recorded terminal" is a control of a checked close
  (design r2, and H-b). Under H-a it becomes "destroy refuses with `unknown` and sends no close". If the
  owner chooses RH, RH keeps that control and the defects stay green with the bound close.

## 4. R4: the only change (m-1)

Design r2 section 3 item 7 (`workspace-worktree/src/index.ts:264-275`, `exists`): `true` only for the
expected successful answer (`git rev-parse --is-inside-work-tree` prints `true` and exits 0); `false` only
for the explicit absence cases (the path does not exist; git answers "not a git repository"); every other
output or error rejects with a diagnostic and the cause (malformed success output, `EACCES`, I/O, a
signal, spawn `ENOENT`, a timeout). Added tests: malformed success, `EACCES`, I/O, with the existing
`ENOENT` and timeout tests. No other change to R4.

## 5. R3a: one operation per ID

### 5.1 The operation lock (design r2 section 4.1, with three changes)

Kept: the kinds `operation` and `opencode-session` in `delivery-lock.ts`, the subjects, the live-token
`WeakSet`, no process-local reentrancy, the lock order, the reservation recheck, the 30 s monotonic waiter
deadline, the lifecycle try-once, no holder expiry, the diagnostics, the platform refusal (OD-15).

Changes:

1. **No `path` kind.** One enforced owner per project worktree directory replaces it (5.3).
2. **Token release** (review): `release()` sets the state `releasing` synchronously, before any await.
   From then, every validation of the token throws. Nested calls count their use of the token (a counter
   up at validation, down when the nested call settles). `release()` awaits the settle of every counted
   call (bounded by the waiter deadline; past it, it throws a programming error and keeps the lock until
   they settle), then closes the server, awaits its `close` callback, and sets `released`. So no nested
   work runs unprotected, and no token is usable past its operation.
3. **Holders and children**: no lock descriptor goes to any child (5.2). The lock lives exactly as long as
   the AO process that took it; the journal of 5.2 protects the work of its children after that.

### 5.2 Mutating children: the supervisor (B-3, OD-14 (c))

`runMutatingChild(token, file, args, options)` in core, used for `git worktree add/remove`, every
`postCreate` command, and `opencode api session.remove`/`session.interrupt`:

1. Spawn `sh -c 'IFS= read -r go || exit 99; exec "$0" "$@"' <file> <args...>` with `detached: true`
   (a new process group and session; the group ID is the child PID) and stdin a pipe. The child waits for
   one line before it runs the real command.
2. Write the journal entry `<project state dir>/children/<sessionId>/<pgid>.json` (pgid, the leader's
   start ticks, boot ID, operation kind, command, `startedAt`): write, fsync, rename, directory fsync.
3. Write `go\n` to stdin. If AO dies before this, the child reads EOF and exits 99 without running the
   command, so every started command has a journal entry.
4. Await the direct child's exit (or the timeout: SIGTERM to the group, a grace time, SIGKILL to the group).
5. After the exit: SIGTERM to the whole group (`process.kill(-pgid)`), then poll `kill(-pgid, 0)` until
   `ESRCH`, with SIGKILL after the grace time. This enforces the restricted-child contract: no process of
   the hook's group outlives the hook.
6. Remove the journal entry, then return the result. A timeout returns "completion unknown".

The next operation on the ID, after it takes the lock and before it reads the record for a decision, reads
`children/<sessionId>/`. For each entry: the boot ID differs, or `kill(-pgid, 0)` gives `ESRCH`, then the
group is empty and the entry is stale (removed under the lock); a group with a member makes the operation
refuse "busy: processes of an earlier `<kind>` still run (process group `<pgid>`)", with their PIDs and
command lines; an unreadable entry refuses too. Linux keeps a process group ID in use while a member
lives, so a live group ID cannot belong to a later group. Nothing expires by time.

The plugins import `runMutatingChild` from core. A call without an operation token (a direct call, as in
the workspace-worktree r3 test, or a caller of an older core) still runs steps 1, 3, 4 and 5: its own
process group, and the group drained before the call returns. Only the journal entry (steps 2 and 6)
needs the token, because the journal path comes from the operation.

Contract (documented in `docs/`, enforced by step 5): a hook may start processes, but they end with the
hook. A process that leaves the group (`setsid`, a daemon) is outside the contract and unprotected
(residual R-6). OD-14 sub-option: a systemd user scope (`systemd-run --user --scope`) per child contains
also those processes (a cgroup) where the host has systemd; not recommended as the default because it adds
a host dependency.

Why this closes B-3: the review's grandchild (stdio `"ignore"`, no inherited descriptor) is in the hook's
process group, so step 5 ends it before postCreate returns (the r3 worktree test). If AO dies while it
runs, the journal entry stays, and the next operation refuses until the group is empty. A daemon that
keeps a descriptor cannot hold the lock, because no child gets a lock descriptor.

Tests (R3a plan): the r3 worktree defect; a daemon in the group (ended by step 5); a direct child that
times out while a grandchild runs; AO killed between steps 2 and 3 (the child exits 99, the entry is
stale); AO killed during step 4 (the next operation refuses while the group lives, then goes on); a
cancelled operation; an unreadable journal entry.

### 5.3 Worktree directories: one policy (OD-13; review: section 4.3 against OD-13)

**Policy: a project worktree directory (`<worktree root>/<projectId>/`) has exactly one owner, a pair of
state root and configuration. A second owner is unsupported and refused.** The first spawn of a project
creates `<worktree root>/<projectId>/.ao-owner` with `O_EXCL` (the canonical state root, the config path
hash, the project ID). Every operation that creates or removes a worktree reads it and refuses on another
owner ("worktree directory owned by <state root>/<config>"). With one owner per directory, the operation
lock of one state root already serializes every path in it, so the `path` lock of design r2 section 4.3 is
not needed.

On this host the two configurations use `~/.worktrees/agent-orchestrator/` and
`~/.worktrees/agent-skills/`, so each directory has one owner. The marker is written on the first new
spawn; the R3a barrier writes it for each existing project directory (read the active records of the one
state root that uses it; refuse when two state roots name the same directory).

**Canonical paths** (one function for every configuration): `realpath` of the nearest existing ancestor,
then the remaining segments, normalized; a path with `..` is refused (as today for symlinks). The owner
marker and the lock subjects use this form.

### 5.4 F-1 and F-2

As design r2 section 4.5: after `git worktree add -- <path> <branch>`, check that the requested branch is
checked out; `postCreate` checks the ownership before each path change and each awaited hook. Both under
`operation`, and the hooks through `runMutatingChild`.

### 5.5 Rollback (review)

A rollback stops its own launch through `stopRuntime` (the guard). It removes the workspace only when
today's separate `ownOrGone` check (`session-manager.ts:1793-1803`) passes, and it releases the record
only by the conditional release, as R2a keeps them (R2a brief item 4). A stopped own runtime is not proof
that the worktree path is its own. `unknown` keeps the record and the workspace and adds `launchFailed`.

### 5.6 The old shell writers (B-5, round RW)

Writers today: the PATH-wrapper helper (`AO_METADATA_HELPER`, `~/.ao/bin/ao-metadata-helper.sh`,
sourced by `~/.ao/bin/gh` and `~/.ao/bin/git`) and the Claude Code PostToolUse hook
(`<worktree>/.claude/metadata-updater.sh`, named in `.claude/settings.json`). Both copy the record with
`sed` or `cp` and rename the copy over it with `mv`, outside the record lock, without a new generation
(`metadata.ts` header). The core r3 test shows the loss: the helper copies the record, a Node writer
publishes a new `runtimeHandle`, and the helper's `mv` puts back the old handle (and the old generation,
so a later conditional writer can see an ABA).

Design (OD-20 (a)): **the shell writers stop writing the record.** They append one line to
`<sessions dir>/.inbox/<sessionId>.jsonl` with `printf ... >> file`:
`{"key":"pr","value":"...","launch":"<AO_LAUNCH_ID>","at":"..."}`. One short `write` with `O_APPEND`
lands at the end of the file as one piece on a local file system, so two writers do not overwrite each
other (the state root is local; a network file system is unsupported). The keys and the validation are as
today (pr, status=pr_open or merged, branch).

The launch value: no pane variable names a launch today (the panes get `AO_SESSION`, `AO_DATA_DIR`,
`AO_STATE_ROOT`, `AO_CONFIG_PATH`, `AO_PROJECT_ID`, `AO_SESSION_NAME`, `AO_TMUX_NAME`, `AO_CALLER_TYPE`).
RW adds `AO_LAUNCH_ID`, 128 random bits per spawn or restore, and the record key `launchId`, written in the
same record write that publishes `runtimeHandle` and added to `LAUNCH_IDENTITY_KEYS`. A pane that started
before RW has no `AO_LAUNCH_ID`; its lines carry an empty launch value, which the applier accepts only for a
record without `launchId` (a launch from before RW). The tmux token of R2b-1 is a separate value.

The applier (Node, in core): the lifecycle poll and every mutating operation call `applyInbox(sessionId)`
under the record lock. It reads the inbox from the saved offset (`inboxOffset` in the record), applies
each valid line whose launch value matches the record (`launchId`, or empty for a record without one)
with `updateMetadataIf`, ignores and logs a line of another launch, skips and logs a malformed line, and
saves the new offset. A last line without a newline is not complete: the applier stops before it and reads
it at the next call. `ao status` stays read-only: it shows pending lines as pending. Writes become visible
at the next poll (seconds), not at once.

Already-loaded writers while panes keep running:

- The wrappers and the helper are files that each `gh` or `git` call reads again, so a replaced file takes
  effect at the next call. Resident `ao` processes reinstall old wrappers by an equality version check
  (host note), so the RW barrier stops the lifecycle workers before it installs the new build, and the new
  workers install the new `WRAPPER_VERSION`.
- The Claude hook script is a file that each hook run executes. The RW barrier rewrites
  `metadata-updater.sh` in every active worktree (the new build's `setupWorkspaceHooks`, run for each
  active record by `ao session refresh-hooks --all`, a new owner command). `settings.json` keeps the same
  command path, so Claude Code needs no restart.
- In-flight runs: one old helper run lasts milliseconds. Admission is closed during the swap, so no Node
  launch-identity write runs then. After the swap, a read-only `ps` check lists processes whose command
  line names `metadata-updater.sh` or `ao-metadata-helper.sh`; the barrier waits until the list is empty.
- A copy of an old script somewhere else is unsupported.

### 5.7 The build epoch (B-5)

- `<state root>/build-epoch`, one decimal integer. RW is the first build that has it (epoch 1); R2b-1 = 2,
  R2b-2 = 3, R3a = 4, R3b = 5, RH = 6. R2a and R4 have none (they are drained by the barrier).
- **Raise**: under a dedicated lock (`deliveryLockName("epoch", <state root>)`): read; a larger value than
  ours refuses; an unreadable or malformed file refuses (never read as 0); a smaller value or no file is
  replaced by ours (write, fsync, rename, directory fsync). Two competing raises serialize, so the file
  never goes down.
- **Check at admission**: every mutating command reads the file at start and AGAIN at mutation admission,
  after every lock wait, directly before the first mutation. A lifecycle worker reads it before each
  reaction that mutates, not only at its start; the new actions `retire`, `stop-retained`, `associate` and
  `refresh-hooks` check it too. A larger value, an unreadable file or a malformed file: refuse and log
  ("an older build than this state root"); a worker keeps polling read-only.
- **Children**: drain the children of a process before it ends. The journal (5.2) lists them for R3a and
  later builds. For older builds, the barrier records `ps -o pid,ppid,pgid,lstart,args` of each process
  tree before it stops anything, waits for the trees to end, and stops a remaining process only by its
  recorded exact PID after its parent has ended.

## 6. R3b: the OpenCode store namespace (B-4)

**Canonical store identity.** `opencode api` reaches the OpenCode service of the caller's environment,
and the service can be one that another environment started (host notes: "opencode api starts a service
with the caller env"). The store is the service's data directory. R3b resolves it as: the service process
that answers (its socket peer, as in h4), then its `XDG_DATA_HOME` or `HOME` from `/proc/<pid>/environ`
(same uid), then `realpath` of `<data home>/opencode`. If any step fails, the store identity is
`unknown`, and every removal and interrupt refuses (the OpenCode session stays: data safe, continuity may
split). Reuse of an existing session needs a known identity too.

**Namespace.** `<canonical store>/ao-holds/` (OD-21 (a)), shared by every state root, configuration and
project that uses the store:

- `holds/<S>/<owner-key>.json`: one holder of S (state root, config path hash, project, session ID, the
  record's launch identity, `claimedAt`, writer PID). `owner-key` is a hash of state root, config, project
  and session.
- `quarantine/<S>.json`: a request whose completion is unknown (operation, PID, start ticks, boot ID,
  request kind, `since`).
- Every file: write, fsync, rename, directory fsync, under the `opencode-session(<canonical store>, S)`
  lock (design r2 section 4.1).

**Every remover, interrupter and reuser of S** (the plugin's discard, `agent-opencode/src/index.ts:498-535`;
the core cleanup purge, kill purge and rollback; the reuse in `resolveOpenCodeSessionReuse`), under the
lock:

1. Read `quarantine/<S>.json`. Present, unreadable or malformed: refuse the removal; a reuse starts a new
   OpenCode session.
2. Read every `holds/<S>/*`. An unreadable entry: unknown, refuse. For each entry, read the named record
   strictly (R4): it names S with the same launch identity: a live holder, refuse (a reuse refuses too,
   except the own record). The record is gone or names another S: a stale hold, removed under the lock.
   The record cannot be read: unknown, refuse.
3. A scan of the records of every project of the loaded configuration (today `hasOtherOpenCodeRecord` and
   `findLiveOpenCodeSessionHolder` read only the project that the operation names) stays as a second
   source. It covers records without a hold entry (written before the backfill, or by an old build) in
   the same configuration, as in the core r3 B-4 test.
4. A removal writes the quarantine entry before the API call (through `runMutatingChild`), and removes it
   only after an authoritative answer (success, or the API's session-not-found error). A timeout, a kill
   or a crash keeps it. A later remover retries and clears it on an authoritative answer. A timeout stays
   unknown also after the local API child has ended (the review).
5. A reuse writes its hold entry before it publishes its record (claim, then record), and a record that
   stops naming S removes its hold under the lock.

**Backfill** (R3b barrier): `ao opencode backfill-holds --confirm` scans the active records of every
project of every state root that the owner names, and writes the holds; it refuses when it cannot resolve
a store. Until the backfill, step 3 covers the old records of the same project.

The review's protocol (`rv`, protocols.mjs) and the core r3 test: B's reuse (or A's cleanup) would read
`holds/ses_shared/` and find the live holder of the other project, and the quarantine of A in the same
namespace.

Alternative (OD-21 (b)): one enforced owner per store (`<store>/ao-owner`, as 5.3). Simpler, but this
host has two configurations that can both run OpenCode sessions, so (b) would refuse one of them.

## 7. Rollout with R2a live

R2a has no epoch. RW brings it. Every round after R2a needs the barrier of design r2 section 5, with the
corrections below.

Steps of every barrier:

1. **Close admission**: no mutating `ao` command (spawn, send, kill, cleanup, restore, start, associate,
   retire, stop-retained, refresh-hooks). Agent panes keep running.
2. **Stop the resident lifecycle workers** by exact PID (today 3624110 and 3626937; read the PID files
   again on the day).
3. **Drain** (5.7, children): wait for each old `ao` process tree to end; record each tree first.
4. **Build** in the primary checkout while nothing runs from it (or a versioned directory and a symlink).
5. **Round steps** (table below).
6. **Raise the epoch** (RW and later): one `ao` command of the new build raises it (5.7).
7. **Restart the workers** with the new build, the old environment and cwd; record the new PIDs.
8. **Check**: each worker reports health `ok` after two polls; `ao status` shows no unexpected unknown.
9. **Open admission.**

| Round | Barrier | Round steps (5.) | What the deployment can claim | What it does not claim |
| --- | --- | --- | --- | --- |
| R2a (live) | recommended | none | no destructive caller goes on after an unconfirmed stop; the lifecycle keeps a session while the runtime probe fails; Herdr stop answers unknown | a tmux kill by name can still reach another launch of the name (B-1); unlocked shell writers; no cross-process lock |
| R4 | recommended | none | uncertain reads keep resources (strict read chain) | as R2a |
| RW | **required** | install the new wrappers (`WRAPPER_VERSION` up); `ao session refresh-hooks --all`; the `ps` check for old writer runs | pane writes go through the inbox applier: no lost launch-identity write and no generation going back by a shell writer; the epoch exists | as R2a for tmux identity |
| R2b-1 | **required** (old builds kill by name) | none (no record is rewritten) | every pane mutation of a NEW launch is token-checked inside tmux (B-1 closed for new launches); attach guarded; agent probes token-bound; Herdr `destroy` refuses | legacy records behave as after R2a (kill by name; the stopRuntime fallback) |
| R2b-2 | **required** | run `ao session audit`, apply the owner's associations | legacy records are unknown unless associated or asserted; association, retire, stop-retained, `where`, the minimal inventory | cross-process operation lock |
| R3a | **required** (old git removals take no lock) | write the `.ao-owner` markers; no hook may run during the switch (drained) | one operation per ID across processes; hook descendants ended or journaled; one owner per worktree directory | OpenCode across projects |
| R3b | **required** | `ao opencode backfill-holds --confirm` | store-scoped OpenCode holds and quarantine | Herdr closes |
| RH (optional) | recommended | none | Herdr stop through the bound close | - |

Old pane writers while panes keep running: section 5.6. Before RW, the old writers stay unlocked (the
claims of R2a and R4 above do not cover them). From RW on, an old writer can only run inside the barrier
window, which the `ps` check drains.

## 8. Measurements

### 8.1 Environment and isolation

- tmux 3.4 (`/usr/bin/tmux -V`), Node v25.7.0 (`/tmp/aosd3/nodebin/node`), herdr 0.8.0 (protocol 19),
  Linux 6.8.0.
- tmux: every call of t1 to t3 goes to a private server `-L aosd3-g1` to `-L aosd3-g6`, started by the
  script from the scratch environment (`env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin ...`,
  no `TMUX`, no `AO_*`; each script throws if it sees either). The scripts are argv lists (no shell), and
  stop every server and pane PID that they started by its exact PID (logged in `/tmp/aosd3/logs/pids.txt`).
  The test suite uses the shim `/tmp/aosd3/bintest/tmux` (`exec /usr/bin/tmux -L aosd3-T "$@"`); the
  runtime-tmux r3 file uses its own `-S` shim in a temporary directory.
- Herdr: before the first server run, `ps -u <uid>` showed no herdr process, and the real
  `~/.config/herdr` had no socket. Every run used `env -i` with `HOME`, `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `/tmp/aosd3/herdrhome`, a scratch config
  with the version and manifest checks off, and a byte-identical copy of the binary at
  `/tmp/aosd3/herdrbin/herdr` (`cmp` equal; sha256 `b872ea7e40fa2cb1...`). The copy was needed because the
  server reads the links of its own binary path: with `~/.local/bin/herdr`, the trace showed reads under
  `/home`. Each server ran under `strace -ff -e trace=%file,connect,bind`, and each script stopped with an
  error if the trace showed a path outside `/tmp/aosd3` and the system directories (except paths whose
  every call got `ENOENT`: the restored server looks for `/.git`, `/HEAD`, `/tmp/.git` and `/tmp/HEAD`),
  any `AF_INET` connect, or a listening socket outside `/tmp/aosd3`. At the end of each script: no process
  with the scratch Herdr HOME, and `ls -la --time-style=full-iso ~/.config/herdr` equal to the listing
  before.
- The documentation: `herdr --help`, the `--help` of each subcommand that design r3 uses, `herdr --skill`
  and `herdr api schema --json`, all under the same `env -i` scratch HOME (`/tmp/aosd3/logs/herdr-help-*.out`,
  `herdr-skill.md`, `herdr-api-schema-full.json`). These print text and start no server; the scratch HOME
  listing did not change.
- Host name: the C8 line of t1 shows the tmux status line, which has the host name. It is replaced by
  `<host>` below.

### 8.2 t1: the token guard (OD-17 (b), B-1, M-1)

Command:

```text
cd /tmp/aosd3 && timeout 300 env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 \
  TMPDIR=/tmp/aosd3/tmp SHELL=/bin/sh /tmp/aosd3/nodebin/node /tmp/aosd3/scripts/t1_token_guard.mjs > /tmp/aosd3/logs/t1.out 2>&1
```

What each part shows:

| Part | Shows |
| --- | --- |
| A1 to A12 | the parser and capability rules of section 2.3 (unknown operator FALSE over literal text, TRUE over a nested format; quoting; braces; branch failure; `if-shell -t` with a missing target) |
| B | the create list: one `$N` for the session and the token read-back; a duplicate name refuses |
| C1 to C9 | the guard for kill, send-keys, paste-buffer (through `load-buffer` from stdin) and attach (through `script`): own token, other token, absent, unsupported form, failed mutation, the last session of a server |
| D1 to D4 | `$N` and the server: the same name and `$0` on two servers, a restart, a rebound socket path |
| E | the create race, 200 tries each: the production form against a control with a wait point |

Output:

```text
== A. parser and capability probes (server g1)
  create N                                                       exit 0 | out "ao-created:605697:$0:1792609960\nao-token:$0:6e790e1aac86a756d4a9bd3d7cc7b91d" | err ""
  create M                                                       exit 0 | out "ao-created:605697:$1:1792609960\nao-token:$1:4ac46f41ceb010f3b7c57e3adc51b283" | err ""
  A1 #{==:} equal (TRUE expected)                                exit 0 | out "T:605697" | err ""
  A2 #{==:} different (FALSE expected)                           exit 0 | out "F:605697" | err ""
  A3 #{nosuchop:} (an unknown operator)                          exit 0 | out "F" | err ""
  A3b #{nosuchop:} with a nested format                          exit 0 | out "T" | err ""
  A3c #{nosuchop:} with a nested format, equal strings           exit 0 | out "T" | err ""
  A4 an unquoted format in a branch                              exit 1 | out "" | err "syntax error"
  A5 a double-quoted format in a branch                          exit 0 | out "ao-x:605697" | err ""
  A6 braces in a branch string                                   exit 0 | out "inner-F:605697" | err ""
  A7 braces as argv                                              exit 1 | out "" | err "command if-shell: too many arguments (need at most 3)"
  A8 inner format expands at the inner command (TRUE expected)   exit 0 | out "late:M" | err ""
  A9 a failing command inside a branch, then a second command    exit 1 | out "" | err "can't find session: N-gone"
  A10 the same, then a top-level command after the if-shell      exit 1 | out "top-level-after" | err "can't find session: N-gone"
  A11 a failing top-level command, then a second command         exit 1 | out "one" | err "can't find session: nope"
  A12 if-shell -t with a missing target (CMD_FIND_CANFAIL)       exit 0 | out "ran-on:M" | err ""
== B. the atomic create and its read-back (server g1)
  B1 create P with its token                                     exit 0 | out "ao-created:605697:$2:1792609960\nao-token:$2:4106775c7084127ca1353b538aaf1dcc" | err ""
  B1 created session = token session, token = own                $2 = $2: true; true
  B2 create P again (the name exists)                            exit 1 | out "" | err "duplicate session: P"
  B3 the session option is per session (M has its own)           exit 0 | out "$1:4ac46f41ceb010f3b7c57e3adc51b283" | err ""
== C. guarded mutations (server g1, recorded server = g1)
  C1 guarded kill, own token                                     exit 0 | out "ao-server:605697\nao-done:605697\nao-end" | err ""
  C1 answer; P still exists                                      destroyed; false
  C2 another launch of P                                         $3 token own
  C2 guarded kill with the first token                           exit 0 | out "ao-server:605697\nao-kept:605697:$3\nao-end" | err ""
  C2 answer; P still exists                                      other-launch; true
  C3 guarded kill of an absent session                           exit 1 | out "ao-server:605697" | err "can't find session: Q"
  C3 answer                                                      absent
  C4 gated guard, unknown operator, OWN token                    exit 0 | out "ao-server:605697\nao-refused:605697\nao-end" | err ""
  C4 answer; P still exists                                      unknown (unsupported form); true
  C4b NO gate, unknown operator, WRONG token (why the gate)      exit 0 | out "ao-done:605697" | err ""
  C4b U still exists                                             false
  C5 own token, the mutation fails                               exit 1 | out "ao-server:605697\nao-end" | err "can't find session: P-gone"
  C5 answer; P still exists                                      unknown; true
  C6 guarded send-keys, own token                                exit 0 | out "ao-server:605697\nao-done:605697\nao-end" | err ""
  C6 guarded send-keys, other token                              exit 0 | out "ao-server:605697\nao-kept:605697:$6\nao-end" | err ""
  C6 pane K / pane K2                                            "ao-own-keys" / ""
  C7 load-buffer ao-ade505a836a8 (own token)                     exit 0 | out "" | err ""
  C7 guarded paste-buffer -d (own token)                         exit 0 | out "ao-server:605697\nao-done:605697\nao-end" | err ""
  C7 the buffer is gone                                          true
  C7 load-buffer ao-a2ac455fc48c (other token)                   exit 0 | out "" | err ""
  C7 guarded paste-buffer -d (other token)                       exit 0 | out "ao-server:605697\nao-kept:605697:$6\nao-end" | err ""
  C7 the buffer is gone                                          true
  C7 pane K / pane K2                                            "ao-own-keysao-paste own token $HOME ; #{pid} \"q\" 'a'" / ""
  C8 guarded attach (own token): clients                         "K:605789"
  C8 detach-client -s =K                                         exit 0 | out "" | err ""
  C8 script exit; client output                                  0; "\u001b=\u001b[>c\u001b[>q\u001b]10;?\u001b\\\u001b]11;?\u001b\\ao-done:605697                                                       [1/1]ao-end\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n\r\n[K] 0:sh*                                    \"<host>\" 15:12 21-Oct-26ao-done:605697                                                       ["
  C8 guarded attach (other token): clients                       ""
  C8 script exit; client output                                  0; "ao-server:605697\r\nao-kept:605697:$5\r\nao-end\r\n"
  C9 guarded kill of the last session of its server              exit 0 | out "ao-server:605870\nao-done:605870\nao-end" | err ""
  C9 answer; server still runs                                   destroyed; true
== D. two servers, the same name, the same $N
  D1 X on g1 and on g2                                           g1 $7 pid 605697; g2 $0 pid 605886
  D1 g1's handle, guard sent to g2                               exit 0 | out "ao-server:605886\nao-kept:605886:$0\nao-end" | err ""
  D1 answer; X on g2 exists                                      unknown (another server answers, recorded server runs); true
  D2 isAlive read on g1 (the client compares the token)          exit 0 | out "ao-alive:605697:$7:4a5622fa5992b0be9d2a8c08325da8d4" | err ""
  D2 isAlive of g1's handle on g2                                exit 0 | out "ao-alive:605886:$0:19f50ff6d864f81b371445aeb46db45e" | err ""
  D3 g2 server process ended                                     true
  D3 X on the restarted g2                                       $0 pid 605934
  D3 the old g2 handle after the restart                         exit 0 | out "ao-server:605934\nao-kept:605934:$0\nao-end" | err ""
  D3 answer; X exists                                            other-launch; true
  D4 new server at g1's path                                     $0 pid 605949; old g1 605697 runs: true
  D4 g1's handle, guard at the rebound path                      exit 0 | out "ao-server:605949\nao-kept:605949:$0\nao-end" | err ""
  D4 answer; X exists at the path                                unknown (another server answers, recorded server runs); true
  D4 absent name at the rebound path                             exit 1 | out "ao-server:605949" | err "can't find session: Y"
  D4 answer                                                      unknown (another server answers, recorded server runs)
== E. the create race: a racer kills and recreates R between client commands
  E no wait point (production form)                              {"consistent":116,"duplicate":84,"lost":0,"mismatch":0,"other":0}
  E control: run-shell sleep between the items                   {"consistent":0,"duplicate":58,"lost":56,"mismatch":86,"other":0}
  started PIDs: 24; still running: []
```

### 8.3 t2: the target of a branch command, and `$` in a branch string (M-1)

Command:

```text
cd /tmp/aosd3 && env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd3/tmp \
  SHELL=/bin/sh /tmp/aosd3/nodebin/node /tmp/aosd3/scripts/t2_branch_target.mjs 2>&1 | tee /tmp/aosd3/logs/t2.out
```

Output (`N` made first, `M` second; part 2's `$0` row prints `x`, the value of `$0` in the server):

```text
== 1. the target of a branch command (N made first, M second)
  if-shell -t =N: ; branch: display-message -p (no -t)             exit 0 | out "M" | err ""
  if-shell -t =N: ; branch: display-message -p -t =N:              exit 0 | out "N" | err ""
  if-shell -t =M: ; branch: display-message -p (no -t)             exit 0 | out "M" | err ""
  the condition uses the -t target (N)                             exit 0 | out "T" | err ""
== 2. $ in a branch string (HOME is /tmp/aosd3/home)
  unquoted $HOME                                                   exit 0 | out "/tmp/aosd3/home" | err ""
  double-quoted "$HOME"                                            exit 0 | out "/tmp/aosd3/home" | err ""
  single-quoted '$HOME'                                            exit 0 | out "\\$HOME" | err ""
  unquoted $0 (a session ID)                                       exit 0 | out "x" | err ""
  single-quoted '$0' as a target                                   exit 0 | out "t0:N" | err ""
  double-quoted "$0" as a target                                   exit 0 | out "t0:N" | err ""
  server still runs                                                false
```

### 8.4 t3: the agent probe, the attach branch, and the association (B-1, M-3)

Command:

```text
cd /tmp/aosd3 && timeout 120 env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 \
  TMPDIR=/tmp/aosd3/tmp SHELL=/bin/sh /tmp/aosd3/nodebin/node /tmp/aosd3/scripts/t3_probe_assoc_attach.mjs > /tmp/aosd3/logs/t3.out 2>&1
```

Output:

```text
== 1. the agent probes read the session option
  create K with a token                                              exit 0 | out "ao-created:788194:$0\nao-token:$0:7bf285f2268058bc1b4a00fc388aeca1" | err ""
  list-panes -t =K: #{pane_pid}|#{@ao_launch}                        exit 0 | out "788195|7bf285f2268058bc1b4a00fc388aeca1" | err ""
  list-panes -t =K: equals the token                                 true
  list-panes -a #{session_name}|#{@ao_launch}                        exit 0 | out "K|7bf285f2268058bc1b4a00fc388aeca1" | err ""
  set-option -p (a pane option of the same name)                     exit 0 | out "" | err ""
  display -t =K: #{@ao_launch} with the pane option                  exit 0 | out "pane-value" | err ""
  show-options -v -t =K: @ao_launch (session scope)                  exit 0 | out "7bf285f2268058bc1b4a00fc388aeca1" | err ""
  set-option -p -u (remove the pane option)                          exit 0 | out "" | err ""
  display -t =K: #{@ao_launch} again equals the token                true
== 2. a command that fails for certain (the attach guard's FALSE branch)
  new-session -s 'a.b' (a '.' in a name): the name                   exit 0 | out "a_b" | err ""
  new-session -s 'ao' (a session named ao)                           exit 0 | out "ao" | err ""
  has-session -t =ao.refused (top level)                             exit 1 | out "" | err "can't find pane: refused"
  has-session -t =ao:refused (top level)                             exit 1 | out "" | err "can't find window: refused"
  has-session -t %2147483647 (top level)                             exit 1 | out "" | err "can't find pane: %2147483647"
  has-session -t '$2147483647' (top level)                           exit 1 | out "" | err "can't find session: $2147483647"
  guard, other token; FALSE branch ends with has-session -t =ao.refused exit 1 | out "ao-server:788194\nao-kept:788194:$0\nao-end" | err "can't find pane: refused"
  guard, other token; FALSE branch ends with has-session -t %2147483647 exit 1 | out "ao-server:788194\nao-kept:788194:$0\nao-end" | err "can't find pane: %2147483647"
  guard, other token; FALSE branch ends with has-session -t '$2147483647' exit 1 | out "ao-server:788194\nao-kept:788194:$0\nao-end" | err "can't find session: $2147483647"
  K still exists                                                     true
  guard, own token, has-session -t %2147483647 after the markers     exit 0 | out "ao-server:788194\nown-branch-ran\nao-done:788194\nao-end" | err ""
  guard, unknown operator (refused), the same command after it       exit 1 | out "ao-server:788194\nao-refused:788194\nao-end" | err "can't find pane: %2147483647"
  K still exists                                                     true
== 3. the legacy association: compare-and-set of the token inside tmux
  new-session L (a legacy session: no token)                         exit 0 | out "$3" | err ""
  audited pane_pid of L                                              788230
  associate with a wrong pane_pid                                    exit 0 | out "ao-server:788194\nao-assoc-refused:788194:788230:\nao-end" | err ""
  L has no token                                                     ""
  associate with the audited pane_pid                                exit 0 | out "ao-server:788194\nao-assoc:788194\nao-end" | err ""
  L's token equals the new token                                     true
  associate again (a token is present)                               exit 0 | out "ao-server:788194\nao-assoc-refused:788194:788230:2aaec4f6f8234117e76c747227ca6116\nao-end" | err ""
  L's token is still the first one                                   true
  associate a session that does not exist                            exit 1 | out "ao-server:788194" | err "can't find session: Z"
  guard with the associated token (a kill)                           exit 0 | out "ao-server:788194\nao-done:788194\nao-end" | err ""
  L still exists                                                     false
  started PIDs: 5; still running: []; own socket left: false
```

Results used in section 2: `list-panes` prints the session option (2.6); a pane option of the same
name shadows it in a format (R-1 in 2.11); a session name never holds a `.` (2.3); a name target such as
`=ao.refused` reads as session `ao` plus pane `refused`, so the attach branch uses
`has-session -t %2147483647` (2.7); the association sets a token only on the audited pane of a session
without one (2.9).

### 8.5 h1: Herdr IDs within one server run (B-2)

Command: `timeout 150 bash /tmp/aosd3/scripts/h1_herdr_ids.sh 2>&1 | tee /tmp/aosd3/logs/h1.out`

Output (the `Permission denied` lines come from the final check, which reads `/proc/<pid>/environ` of
the uid's processes; it cannot read some of them, and it prints only the PIDs whose `HOME` is the scratch
Herdr HOME; the "pane move" row used a wrong form, exit 2; h2 part 4 has the right form):

```text
== 0. start the scratch server and check its isolation
  paths outside /tmp/aosd3 and the system dirs               []
  inet connect calls                                         0
  paths under /home (any)                                    []
  server pid                                                 4152502 (/tmp/aosd3/herdrbin/herdr server )
  listening Unix sockets of the server                       /tmp/aosd3/herdrhome/.config/herdr/herdr.sock
  environment of the server                                  HOME=/tmp/aosd3/herdrhome XDG_CONFIG_HOME=/tmp/aosd3/herdrhome/.config XDG_DATA_HOME=/tmp/aosd3/herdrhome/.local/share XDG_STATE_HOME=/tmp/aosd3/herdrhome/.local/state XDG_RUNTIME_DIR=/tmp/aosd3/herdrhome/run PATH=/usr/bin:/bin LANG=C.UTF-8 TERM=xterm-256color SHELL=/bin/sh 
  isolation                                                  ok: sockets under /tmp/aosd3, no other path outside the system dirs, no inet connect
  status server                                              status: running version: 0.8.0 protocol: 19 compatible: yes socket: /tmp/aosd3/herdrhome/.config/herdr/herdr.sock 
== 1. pane close and the answer for a closed pane
  workspace create                                           w1 root w1:p1 terminal term_65e5dfdef58c51
  pane split                                                 w1:p2 terminal term_65e5dfdf17a642
  pane close w1:p2 (exit 0)                                  {"id":"cli:pane:close","result":{"type":"ok"}} 
  pane get w1:p2 (closed) exit 1                             {"error":{"code":"pane_not_found","message":"pane w1:p2 not found"},"id":"cli:pane:get"} 
  pane close w1:p2 again exit 1                              {"error":{"code":"pane_not_found","message":"pane w1:p2 not found"},"id":"cli:pane:close"} 
== 2. does a closed pane ID come back?
  pane split 1                                               w1:p3 terminal term_65e5dfdf5f19a3
  pane split 2                                               w1:p4 terminal term_65e5dfdfad5c94
  pane split 3                                               w1:p5 terminal term_65e5dfdfdabd45
== 3. does a closed workspace ID come back? (five rounds of create and close)
  workspace close w1 exit 0                                  {"id":"cli:workspace:close","result":{"type":"ok"}} 
  workspace get w1 (closed) exit 1                           {"error":{"code":"workspace_not_found","message":"workspace w1 not found"},"id":"cli:workspace:get"} 
  pane get w1:p1 (its workspace closed) exit 1               {"error":{"code":"pane_not_found","message":"pane w1:p1 not found"},"id":"cli:pane:get"} 
  create 1                                                   workspace w2 (number 1) root w2:p1 terminal term_65e5dfe044bc16
  create 2                                                   workspace w3 (number 1) root w3:p1 terminal term_65e5dfe09968c7
  create 3                                                   workspace w4 (number 1) root w4:p1 terminal term_65e5dfe0f8fea8
  create 4                                                   workspace w5 (number 1) root w5:p1 terminal term_65e5dfe14ffd69
  create 5                                                   workspace w6 (number 1) root w6:p1 terminal term_65e5dfe1ad102a
  two open workspaces                                        w7 (w7:p1), w8 (w8:p1)
  close the first, create again                              w9 (w9:p1); the closed one was w7 (w7:p1)
  workspace list                                             [('w8', 1, 'h1b'), ('w9', 2, 'h1c')]
== 4. the shell of a pane exits
  pane for the exit                                          w8:p2 terminal term_65e5dfe287058e
  pane get w8:p2 after its shell exit (exit 1)               {"error":{"code":"pane_not_found","message":"pane w8:p2 not found"},"id":"cli:pane:get"} 
  the last pane w8:p1 of w8 after its shell exit (exit 1)    {"error":{"code":"pane_not_found","message":"pane w8:p1 not found"},"id":"cli:pane:get"} 
  workspace get w8 after its last shell exit (exit 1)        {"error":{"code":"workspace_not_found","message":"workspace w8 not found"},"id":"cli:workspace:get"} 
== 5. pane move into another workspace
  pane to move                                               wA:p2 terminal term_65e5dfe4c2c5310 (from wA)
  pane move wA:p2 --workspace w9 (exit 2)                    new NOT-JSON previous NOT-JSON terminal NOT-JSON
  pane get wA:p2 (the old ID) from outside (exit 0)          {"id":"cli:pane:get","result":{"pane":{"agent_status":"unknown","cwd":"/tmp/aosd3/herdrhome/ws","focused":false,"foreground_cwd":"/tmp/aosd3/herdrhome/ws","pane_id":"wA:p2","revision":0,"scroll":{"max_offset_from_bottom"
  pane list: panes with terminal term_65e5dfe4c2c5310        ['wA:p2']
== 6. stop the scratch server
  server stop                                                
  server pid 4152502 running                                 no
  strace pid 4152494 running                                 no
  paths under /home in the full trace                        []
  inet connect calls in the full trace                       0
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/13870/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/13874/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2576860/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2576956/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2576957/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2577535/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2577631/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2577633/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2587955/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2588048/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/2588050/environ: Permission denied
/tmp/aosd3/scripts/h1_herdr_ids.sh: line 127: /proc/4154920/environ: No such file or directory
  processes with the scratch Herdr HOME                      []
  real ~/.config/herdr                                       unchanged
```

### 8.6 h2: Herdr across a server restart (B-2)

Command: `bash -n /tmp/aosd3/scripts/h2_herdr_restart.sh && timeout 170 bash /tmp/aosd3/scripts/h2_herdr_restart.sh 2>&1 | tee /tmp/aosd3/logs/h2.out`

Server A starts with no saved session (the script removes the scratch `session.json` of h1), and makes
`w1` again. Output:

```text
== 1. incarnation fields
  server A: outside paths with only ENOENT answers           []
  server A: pid, sockets, outside paths, inet                4180078, [/tmp/aosd3/herdrhome/.config/herdr/herdr.sock], [], 0
  status server --json                                       {"status":"running","running":true,"version":"0.8.0","protocol":19,"capabilities":{"live_handoff":true,"detached_server_daemon":false},"compatible":true,"socket":"/tmp/aosd3/herdrhome/.config/herdr/herdr.sock","session":null,"restart_needed":false} 
  server A start ticks (raw stat field 22)                   10041640
== 2. two workspaces, then stop
  workspaces                                                 w1 (panes w1:p1 w1:p2), w2
  panes before the stop                                      [('w1:p1', 'term_65e5e04dcffe21'), ('w1:p2', 'term_65e5e04deb7e92'), ('w2:p1', 'term_65e5e04dfa6353')]
  server stop                                                
  server 4180078 and strace 4180065 still run                no no
  saved session file                                         -rw-r--r-- 1 taisung users 1730 Oct 21 14:36 /tmp/aosd3/herdrhome/.config/herdr/session.json
== 3. restart with the same scratch HOME
  server B: outside paths with only ENOENT answers           [/.git /HEAD /tmp/.git /tmp/HEAD ]
  server B: pid, sockets, outside paths, inet                4180426, [/tmp/aosd3/herdrhome/.config/herdr/herdr.sock], [], 0
  status server --json                                       {"status":"running","running":true,"version":"0.8.0","protocol":19,"capabilities":{"live_handoff":true,"detached_server_daemon":false},"compatible":true,"socket":"/tmp/aosd3/herdrhome/.config/herdr/herdr.sock","session":null,"restart_needed":false} 
  workspaces after the restart                               [('w1', 'h2a'), ('w2', 'h2b')]
  panes after the restart                                    [('w1:p1', 'term_65e5e04e92cc91'), ('w1:p2', 'term_65e5e04e946662'), ('w2:p1', 'term_65e5e04e9614b3')]
  a new workspace after the restart                          w3 root w3:p1 terminal term_65e5e04ed4b904
  pane get w1:p2 (a pane of the old run), exit 0             {"id":"cli:pane:get","result":{"pane":{"agent_status":"unknown","cwd":"/tmp/aosd3/herdrhome/ws","focused":false,"foreground_cwd":"/tmp/aosd3/herdrhome/ws","pane
== 4. pane move forms
  pane move --workspace --no-focus: exit 2                   usage: herdr pane move <pane_id> --tab <tab_id> --split right|down [--target-pane ID] [--ratio FLOAT] [--focus|--no-focus]        herdr pane move <pane_id> --new-tab [--workspace ID] [--label TEXT] [-
  pane move w4:p2 --new-workspace: exit 0                    new w5:p1 previous w4:p2 terminal term_65e5e04f1a7806
  pane get w4:p2 (the old ID) from outside, exit 0           {"id":"cli:pane:get","result":{"pane":{"agent_status":"unknown","cwd":"/tmp/aosd3/herdrhome/ws","focused":false,"foreground_cwd":"/tmp/aosd3/herdrhome/ws","pane
  pane close w4:p2 (the old ID) from outside, exit 0         {"id":"cli:pane:close","result":{"type":"ok"}} 
  panes with terminal term_65e5e04f1a7806                    []
  server stop                                                
  server 4180426 and strace 4180419 still run                no no
  paths under /home in both traces                           []
  processes with the scratch Herdr HOME                      []
  real ~/.config/herdr                                       unchanged
```

### 8.7 h3 and h4: one request per connection, the peer process, the bound close (B-2)

Command:

```text
cd /tmp/aosd3 && timeout 120 env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME=/tmp/aosd3/home \
  python3 -I /tmp/aosd3/scripts/h3_herdr_one_connection.py 2>&1 | tee /tmp/aosd3/logs/h3.out
```

h3 runs h4 (`node h4_node_peer.mjs <socket>`) while server A runs. Output:

```text
== 1. framing and peer identity
  server A: pid, sockets                                     54355, ['/tmp/aosd3/herdrhome/.config/herdr/herdr-client.sock', '/tmp/aosd3/herdrhome/.config/herdr/herdr.sock']
  server A: outside paths (ENOENT only), bad, inet           [], [], 0
  SO_PEERCRED pid of the connection                          54355 (server 54355)
  ping                                                       {"type": "pong", "version": "0.8.0", "protocol": 19, "capabilities": {"live_handoff": true, "detached_server_daemon": false}}
  a second ping at once on the same connection               transport BrokenPipeError: [Errno 32] Broken pipe
  two pings in one write: answers before EOF                 1 b'rue,"detached_server_daemon":false}}}\n[ConnectionResetError]'
  panes                                                      w1:p1 term_65e5e16d06fc71, w1:p2 term_65e5e16d0e0642, w2:p1 term_65e5e16d13b693
  terminal ID without its last digit, as microseconds        2026-10-21 18:41:02 UTC (now 18:41:03 UTC)
== 2. a close bound to the server process of the get
  bound close of w1:p2 (own terminal)                        close on peer 54355: {"type": "ok"}; get on peer 54355: error pane_not_found
  bound close of w1:p2 again                                 get: error pane_not_found (peer 54355) -> absent on this server run
  bound close of w2:p1 with a wrong terminal                 get: pane w2:p1 terminal term_65e5e16d13b693 workspace w2 -> other-launch, no close
  h4: a Node client finds its peer process                   {"hasGetsockopt":"undefined","fd":21,"ownInode":"13830326","ownRow":"u_str ESTAB 0 0 * 13830326 * 13821575 users:((\"node-MainThread\",pid=54451,fd=21)) ","peerRow":"u_str ESTAB 0 0 /tmp/aosd3/herdrhome/.config/herdr/herdr.sock 13821575 * 13830326 users:((\"herdr\",pid=54355,fd=7)) ","peerPid":"54355","answer":"{\"id\":\"aosd3:node\",\"result\":{\"type\":\"pon"} (server 54355)
== 3. a server restart between the get and the close
  get w2:p1 on server A                                      pane w2:p1 terminal term_65e5e16d13b693 workspace w2 (peer (54355, '10071751'))
  server stop (CLI)                                          {"exit": 0, "output": ""}
  server A 54355 still runs                                  False
  server B: pid, sockets                                     54795, ['/tmp/aosd3/herdrhome/.config/herdr/herdr-client.sock', '/tmp/aosd3/herdrhome/.config/herdr/herdr.sock']
  server B: outside paths (ENOENT only), bad, inet           ['/.git', '/HEAD', '/tmp/.git', '/tmp/HEAD'], [], 0
  close connection: peer                                     (54795, '10072157'); equal to the get's peer: False -> unknown, no close sent
  get w2:p1 on server B                                      pane w2:p1 terminal term_65e5e170a223e2 workspace w2
  get w1:p1 on server B (restored root of h3a)               pane w1:p1 terminal term_65e5e1709fedd1 workspace w1
  get w1:p2 on server B (closed before the stop)             error pane_not_found
== 4. close of the last pane of a workspace
  pane.close w2:p1 (the only pane of w2)                     {"type": "ok"}
  workspace.get w2                                           error workspace_not_found
  workspace.list                                             [["w1", "h3a", 1]]
  server stop (CLI)                                          {"exit": 0, "output": ""}
  started PIDs still present                                 []
  real ~/.config/herdr                                       unchanged
  paths under /home in the traces                            []
```

### 8.8 Herdr documentation (`herdr api schema --json`, `herdr --skill`)

The two close requests and their targets (from `herdr-api-schema-full.json`, `schemas.request.oneOf[18]`,
`[72]` and `$defs`):

```text
{"properties": {"method": {"const": "workspace.close", "type": "string"}, "params": {"$ref": "#/schemas/request/$defs/WorkspaceTarget"}}, "required": ["method", "params"], "type": "object"}
{"properties": {"method": {"const": "pane.close", "type": "string"}, "params": {"$ref": "#/schemas/request/$defs/PaneTarget"}}, "required": ["method", "params"], "type": "object"}
PaneTarget {"properties": {"pane_id": {"type": "string"}}, "required": ["pane_id"], "type": "object"}
WorkspaceTarget {"properties": {"workspace_id": {"type": "string"}}, "required": ["workspace_id"], "type": "object"}
```

`herdr --skill`, lines 56 and 62 to 68:

```text
56: Agent commands accept either a unique live agent name or the pane ID currently hosting that agent. They do not accept terminal IDs or bare agent-kind labels. Names must match `[a-z][a-z0-9_-]{0,31}` and be unique among live agents. A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.
62: Public IDs are opaque stable handles:
63: 
64: - workspace: `w1`
65: - tab: `w1:t1`
66: - pane: `w1:p1`
67: 
68: Closed tab and pane IDs are not reused. A pane moved into another workspace receives a new workspace-qualified pane ID. After `pane move`, continue with `.result.move_result.pane.pane_id` or the live agent name. The old value is reported as `.result.move_result.previous_pane_id`; only the moved process's inherited caller context keeps resolving that old ID, so do not use it as a general agent target.
```

### 8.9 rv: the review's reproducers, run again

The review's six scripts are copied to `/tmp/aosd3/ref/` with every path and server name changed to
`aosd3` (`/tmp/aosd3/review/` for the two that ran). Command:

```text
cd /tmp/aosd3/review && for f in descendant.mjs protocols.mjs; do echo "== $f"; timeout 60 env -i HOME=/tmp/aosd3/home \
  PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd3/tmp /tmp/aosd3/nodebin/node /tmp/aosd3/review/$f 2>&1; \
  echo "[exit $?]"; done | tee /tmp/aosd3/logs/review-repro.out
```

Output (each recorded PID was gone afterwards):

```text
== descendant.mjs
{"holder":188122,"child":188142,"grandchild":188149,"contenderAcquired":true,"grandchildStillRuns":true}
{"replacementSurvives":false}
[exit 0]
== protocols.mjs
{"seesLocalQuarantine":false,"seesOtherProjectQuarantine":true,"reused":true}
{"lateRequestCompleted":true,"claimStillNamesS":true,"SExists":false,"sameProjectReuseWouldRefuse":true}
{"herdrObserved":"term_A","closedTerminal":"term_B","replacementOpen":false,"stopOutcome":"destroyed"}
[exit 0]
```

Not run again: `probe.mts`, `same-server.mts`, `interposer.mjs` and `readback.mts`. They drive the design
r2 prototype (`./proto`, the name per launch), which OD-17 (b) replaces. t1 parts C, D and E measure the
same cases for the token guard (a relaunch of the name, the same name and `$N` on another server, a
replacement between the create and its read-back).

### 8.10 Baseline and red counts

At `cbfbc182`, before any change (`/tmp/aosd3/scripts/redcount.sh`, `SAME_ID_DEFECTS=red`, failed/passed
per round tag):

```text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects.test.ts: R1 0 failed/5 passed, R3 1 failed/0 passed, R4 3 failed/0 passed
packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed
packages/plugins/agent-codex/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-gemini/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-opencode/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-opencode/src/same-id-reuse-window.test.ts: R3 1 failed/0 passed
packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts: R2 1 failed/1 passed, R4 2 failed/3 passed
packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts: R4 2 failed/0 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts: R2 7 failed/6 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
```

At `c8a35d47`:

```text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects.test.ts: R1 0 failed/5 passed, R3 1 failed/0 passed, R4 3 failed/0 passed
packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed
packages/plugins/agent-codex/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-gemini/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-opencode/src/same-id-defects.test.ts: R1 0 failed/1 passed, R2 1 failed/0 passed, R4 2 failed/0 passed
packages/plugins/agent-opencode/src/same-id-reuse-window.test.ts: R3 1 failed/0 passed
packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r2.test.ts: R2 1 failed/1 passed, R4 2 failed/3 passed
packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r3.test.ts: R2 3 failed/1 passed
packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts: R4 2 failed/0 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r2.test.ts: R2 7 failed/14 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r3.test.ts: R2 5 failed/13 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
```

## 9. Options with comparisons

Each table ends with the recommendation. The owner decision of each choice is in section 10.

### 9.1 The tmux launch identity (OD-17, decided (b))

| Option | Host tools (M-2) | Mutation reaches another launch | Measured |
| --- | --- | --- | --- |
| (a) a tmux name per launch `<base>-r<hex>` (design r2) | `fleet_watch.sh` and `ao_relaunch.py` need a new name rule or `where` | no, by name | m4 of design r2 |
| **(b) the stable name plus a token checked by tmux in the same command (decided)** | unchanged | no: the check and the mutation are one command list (t1 C, E) | t1, t2, t3 |
| (c) the stable name plus `$N` targets and a server check | unchanged | yes, when another server answers at the path: `$0` repeats across servers and restarts (t1 D1, D3, D4) | t1 D |

### 9.2 The Herdr close (OD-19)

The table of section 3.3 compares H-a (unknown), H-b (a close bound to the server process of its check)
and H-c (an upstream compare-and-close). Recommended: H-a now, H-c requested, H-b only as the optional RH.

### 9.3 Mutating children after the AO process ends (OD-14, B-3)

| Option | A grandchild that drops the descriptor | A daemon (`setsid`) | Cost |
| --- | --- | --- | --- |
| (a) the lock descriptor goes to each child (design r2) | not covered: the lock is free while it runs (`rv` descendant: `contenderAcquired`, `grandchildStillRuns`) | holds the lock for its lifetime | one internal Node field |
| (b) a journal of the direct child only (PID and ticks) | not covered: the grandchild is not in the journal | not covered | small |
| **(c1) a process group per child, a write-ahead journal, the group killed and drained after the child (5.2)** | covered: the group outlives the direct child only until step 5; after an AO crash the journal refuses the next operation while the group lives | not covered (residual R-6) | no host dependency |
| (c2) (c1) inside a systemd user scope | covered | covered (a cgroup) | needs `systemd --user`; not on every host |
| (c3) a resident supervisor process | covered while it runs | as (c1) or (c2) | a new long-running process with its own lifecycle |
| (d) `PR_SET_CHILD_SUBREAPER` on the AO process | covered while AO runs | covered while AO runs | Node has no API (a native module); lost when AO crashes |

Recommended: (c1). (c2) as an owner option where the host has systemd.

### 9.4 The old shell writers (OD-20, B-5)

| Option | Lost Node write | A stale launch writes the new record | Cost per `git` or `gh` call |
| --- | --- | --- | --- |
| **(a) the append-only inbox, applied by Node under the record lock (5.6)** | no: the shell never writes the record | no: the applier compares the launch value | one `printf >>` |
| (b) the shell calls `ao` for each write | no | no, if `ao` checks the launch | one Node start (about 0.2 s) on every wrapped call |
| (c) a shell writer under `flock` with a generation check | yes, unless Node also takes the same `flock`: the record lock is an abstract socket, which `sh` cannot take | possible | `flock` and a second lock kind in Node |
| (d) keep the writers, inside the barrier only | yes: panes keep running, so the writers run after the barrier too (review B-5) | yes | none |

Recommended: (a).

### 9.5 The OpenCode namespace (OD-21, B-4)

| Option | Two projects or configurations on one store | Unknown store | Cost |
| --- | --- | --- | --- |
| **(a) holds and quarantine inside the canonical store (6)** | seen by every remover and reuser | refuse | the store resolution, a backfill |
| (b) one enforced owner per store | the second owner is refused | refuse | simple; refuses one of this host's two configurations |
| (c) scan every state root and configuration that AO knows | misses a root that this process does not know | - | no new files; incomplete by design |

Recommended: (a).

### 9.6 Shared worktree roots (OD-13, the review's "one policy")

| Option | A second state root or configuration on one project worktree directory | Cost |
| --- | --- | --- |
| (a) a `path` lock after the `operation` lock (design r2 4.3) | serialized only between new builds that take it; the two policies of design r2 conflict | a second lock kind |
| **(b) one owner per project worktree directory, enforced by an `O_EXCL` marker (5.3)** | refused | a marker file; a barrier step |
| (c) unsupported by documentation only | not detected | none |

Recommended: (b).

### 9.7 `ao send` to a legacy record (OD-18)

| Option | Effect at the R2b-2 rollout | Residual |
| --- | --- | --- |
| **(a) send to the visible exact base on the caller's server, with a notice** | live fleets keep working | R-2 until the association |
| (b) refuse until associated | every live session stops receiving messages until the owner associates it | none |

Recommended: (a).

### 9.8 Attach

| Option | The gap between the check and the attach | Where the guard lives |
| --- | --- | --- |
| **(a) `AttachInfo.args`: the runtime gives the guarded argv, the CLI spawns it (2.7)** | none (t1 C8, t3) | runtime-tmux only |
| (b) the CLI builds the guard | none | two places to keep equal |
| (c) as today: `isAlive`, then `attach -t` | open (review) | - |

Recommended: (a).

### 9.9 The epoch raise (B-5)

| Option | Two raises at once | Cost |
| --- | --- | --- |
| **(a) read, compare and write under an abstract-socket lock (5.7)** | serialized; never goes down | the `delivery-lock` mechanism |
| (b) one file per epoch (`build-epoch.<n>`, created with `O_EXCL`); the largest present wins | never goes down; no lock | a directory listing per check |
| (c) a plain write (design r2) | the smaller value can win (review) | none |

Recommended: (a); (b) is an equal choice if the owner prefers no lock.

### 9.10 The round order (OD-11)

| Order | Why |
| --- | --- |
| **R2a, R4, RW, R2b-1, R2b-2, R3a, R3b, RH** | R4 is ready and independent; RW stops lost writes before R2b-2's association writes |
| R2a, R2b-1, R2b-2, R4, RW, R3a, R3b, RH (design r2's R2-then-R4) | also safe: R2b-1 fails closed on a lost `runtimeHandle` write (the guard answers `other-launch`), but `ao status` can show `exited` for a live replacement until RW |

## 10. Owner decisions

The review's table is the working basis (owner decision 4a).

| OD | Review | Mine | Where I differ, and why |
| --- | --- | --- | --- |
| OD-2 identity storage | (a), complete and immutable at creation | (a), the fields of 2.1 with the token | same |
| OD-3 old records | modified (a): default-off assertion plus explicit association; consistent positive legacy and unknown | modified (a), with the status table of 2.4 and the association of 2.9 | same; detail: the association is a tmux compare-and-set plus a record compare-and-write |
| OD-4 hidden socket | (a) | (a) | same |
| OD-5 kill when hidden | (a) | (a) (R2a) | same |
| OD-6 mechanism | keep (d), revise the identity; a suffix is optional | (d) with the stable name and the token guard (OD-17 (b)) | same |
| OD-7 waiting | (a) | (a) (5.1) | same |
| OD-8 OpenCode reuse | (c) with store-scoped quarantine and holders | (c) with the namespace inside the canonical store (6) | same; detail: the location (OD-21) |
| OD-9 kept runtimes | (c), inventory before the record is lost; with the first retire feature | (c); the minimal inventory in R2b-2 with retire | same |
| OD-10 rollback | (a) only for a verified own runtime, (b) for unknown or legacy; keep the path checks | same (5.5) | same |
| OD-11 order | keep R2, then R4, then R3 | R2a, R4, RW, R2b-1, R2b-2, R3a, R3b, RH | I put R4 directly after R2a (the owner's decision 1a says R4 after R2a, and R4 is independent and ready) and RW before R2b (R2b-2's association is a record write that the old writers can undo). If the owner keeps the strict order, R2b-1 and R2b-2 can come before R4: R4 is independent, so both orders are safe |
| OD-12 unreadable archive at spawn | (a) | (a) | same |
| OD-13 admission and writers | (b), barrier plus epoch; include old shell writers, children, worker writes, atomic epoch; one shared-root policy | (b) with 5.6, 5.7; shared project worktree directories unsupported AND refused by the `.ao-owner` marker (5.3) | the one policy: refuse, enforced, instead of design r2's path lock for "participating new builds". It is simpler and needs no second lock |
| OD-14 child and request lifetime | (c) with durable child and request tracking, or a strictly enforced restricted-child contract | (c): the process-group supervisor with a write-ahead journal and the enforced contract (5.2); sub-option: a systemd user scope | same direction; the sub-option is for the owner |
| OD-15 platforms and tmux versions | fail closed (a); test capability on every supported tmux version | (a), with an allow list of versions on which the real-tmux controls ran green (2.12) | same; design r2's "3.2 and later by version" is withdrawn |
| OD-16 legacy disposition | (b) after M-3 | (b): associate and retire with evidence, the batch audit, the opt-in assertion; never an automatic retire | same |
| OD-17 tmux identity | prefer corrected (b) | **decided (b)** (owner 3a) | - |
| **OD-18** (new) legacy send | - | (a) send to the visible exact base on the caller's server, with a notice, until associated; (b) refuse until associated | (a): (b) stops every live fleet at the R2b-2 rollout. The residual ends with the association |
| **OD-19** (new) Herdr close | (the review asks for a compare-and-close or unknown) | (a) unknown in every round (H-a), plus a request upstream (H-c); (b) the optional round RH (H-b) | (a) now; no live record uses Herdr |
| **OD-20** (new) shell writers | (include them in the drain, or a current-build conditional writer) | (a) the append-only inbox with the Node applier; (b) the shell writers call `ao` for each write; (c) keep them unlocked (rejected by the review) | (a): no node start per `git` call, and a stale launch cannot write the new launch's record |
| **OD-21** (new) OpenCode namespace | (store-scoped, or one enforced owner) | (a) inside the canonical store; (b) one enforced owner per store | (a): this host has two configurations |

The two-negative confirmation stays as today. I propose no change.

## 11. Round plan

All rounds come after R2a (ao-55). "Needs R2a" marks the items that use R2a's `RuntimeStopOutcome`,
`stopRuntime`, the refusing callers or the lifecycle gate. Sizes are rough classes.

| Round | Content | Files | Tests that must turn green | Risk | Size |
| --- | --- | --- | --- | --- | --- |
| **R4** | design r2 section 3, with section 4 here | as design r2 section 7 | as design r2 section 7, plus malformed success, `EACCES`, I/O for `exists` | medium | M |
| **RW** supported writers | 5.6, 5.7: the inbox writer in `AO_METADATA_HELPER` and the Claude hook; `AO_LAUNCH_ID` and the record key `launchId`; `applyInbox`; `inboxOffset`; `refresh-hooks`; the epoch module and its checks (independent of R2a's code) | `core/src/agent-workspace-hooks.ts`, `core/src/metadata.ts`, new `core/src/inbox.ts`, new `core/src/build-epoch.ts`, `core/src/lifecycle-manager.ts`, `core/src/session-manager.ts`, `agent-claude-code/src/index.ts`, CLI `session.ts` | core r3 B-5 (1 defect; its control changes, 13.7). Add: a hook line of another launch is ignored; a line without a launch value is applied only to a record without `launchId`; a last line without a newline waits; a malformed line is skipped; two writers append in parallel; the offset survives a crash; the epoch raise race (two processes); unreadable epoch refuses; a worker that sees a larger epoch stops mutating | medium | M |
| **R2b-1** launch token | 2.1 to 2.8, 2.12 for new launches; `AttachInfo.args`; tmux `stop`; runtime-herdr `destroy` refuses (H-a, 3.4) (**needs R2a**: the outcome type and the callers) | `runtime-tmux/src/index.ts`, `runtime-herdr/src/index.ts`, `core/src/types.ts`, new `core/src/runtime-identity.ts` (resolver, `tmuxServerArgs`), `core/src/session-manager.ts`, `core/src/tmux.ts`, the four agents, CLI `send.ts`, `session.ts`, `status.ts` | runtime-tmux r3: 5 defects, 13 controls; runtime-tmux r2: 7 defects, 14 controls; runtime-herdr r3: 3 defects; runtime-herdr r2 N-1: 1 defect (its close control changes as 3.4 says); `c516cead` R2: runtime-tmux 3 (D-B two, F-7; the stand-in of that file needs the new forms, 13.7), agents 4. Add: the create read-back failure; the `/proc` read failure (unknown); a token on another incarnation (reject); every agent with another token on the right socket (reject); attach exit 1 on `other-launch`; a grep test for unguarded mutations; a real-tmux lifecycle test (a relaunch between two polls) | **high**: every tmux path | L |
| **R2b-2** legacy and inventory | 2.9, 2.10: the resolver kinds `legacy` and `associated`, association, audit, retire, minimal inventory, `stop-retained`, `where`, the assertion key (**needs R2a**: `stopRuntime` for `stop-retained`) | `core/src/runtime-identity.ts`, `core/src/metadata.ts` (`LAUNCH_IDENTITY_KEYS`), new `core/src/retained-inventory.ts`, `core/src/config.ts`, CLI `session.ts`, `status.ts`, `send.ts` | `c516cead` R2 runtime-tmux F-5 (a legacy handle, 2.5). Add: association compare-and-set refused for another `pane_pid` or a present token; the record compare-and-write refused after a generation change (the token stays, no record names it); a restore clears the association; retire fails when the inventory publish fails; crash after the entry and before the archive; `where` exit codes; the audit never mutates (a command recorder); legacy status rows of 2.4 | high | M |
| **R3a** one operation per ID | 5.1 to 5.5 (**needs R2a** for rollback outcomes; needs R2b-1 for a verified own runtime; needs R4 for strict holder reads) | `core/src/delivery-lock.ts`, new `core/src/operation-lock.ts`, new `core/src/mutating-child.ts`, `core/src/session-manager.ts`, `core/src/recovery/actions.ts`, `core/src/lifecycle-manager.ts`, `core/src/types.ts`, `workspace-worktree/src/index.ts`, CLI | workspace-worktree r3 B-3 (1 defect, 1 control); `c516cead` R3: worktree 4, core 1. Add: the tests of 5.2; two processes on one ID; a released token throws; release waits for nested work; the owner marker race (two `O_EXCL` creates); a foreign marker refuses | **high** | L |
| **R3b** OpenCode | 6 (needs R3a's lock and `runMutatingChild`, and R4) | `core/src/session-manager.ts`, `core/src/opencode-api.ts`, new `core/src/opencode-holds.ts`, `agent-opencode/src/index.ts`, CLI (backfill) | core r3 B-4 (1 defect, 1 control; both get a mock of the store resolution, 13.7); `c516cead` R3 opencode 1. Add: the review's protocol as a two-process test; quarantine on a timeout and on a kill; a stale hold removed; an unreadable hold refuses; an unknown store refuses; a reuse with a quarantined S starts a new session | high | M |
| **RH** (optional) Herdr bound close | 3.3 H-b, and prompts by agent name | `runtime-herdr/src/index.ts`, a socket client module | runtime-herdr r3 (3 defects, green since R2b-1) stay green with the bound close; the r2 close control of 3.4 comes back. Move the Herdr tests to a socket stand-in (the r2 and r3 files mock `execFile`; a socket client would bypass them), with a restart between the connections | medium | M |

Order: R2a (ao-55, now), R4, RW, R2b-1, R2b-2, R3a, R3b, RH. Each round is safe alone in this order:
R4 and RW only keep more or write more carefully; R2b-1 changes only new launches (legacy as after R2a);
R2b-2 adds the legacy rules together with the tools to resolve them (no unmanageable backlog); R3a and R3b
add locks after the identity and the strict reads exist. R2a's scope is unchanged.

## 12. Brief items found unclear or wrong, and deviations

Unclear or wrong in the brief:

1. "Read first ... `development/reviews/same_id_design_review_r2_astra6.md` ... all on `cbfbc182`": the file
   is not in the tree at `cbfbc182`. I read it from `main` with
   `git show 3843a025:development/reviews/same_id_design_review_r2_astra6.md` (579 lines, copy in
   `/tmp/aosd3/ref/review_r2.md`).
2. The Herdr premise. The brief (B-2: "an immutable-terminal close target or a server-side
   compare-and-close, with workspace incarnation protection"), design r2 (N-1) and the source comment
   `runtime-herdr/src/index.ts:310-315` say that Herdr reuses positional IDs. Measured (h1 to h3): within one
   server run, no workspace or pane ID comes back; after a restart with a saved session, the same IDs come
   back with new terminals; after a start without a saved session, the count starts at `w1` again. Herdr
   0.8.0 offers neither close form, so B-2's fallback applies (section 3).
3. "Failing tests ... the M-1 guard forms": a test that pins how tmux answers a guard form cannot fail on
   `cbfbc182`, because the base does not use the forms. I wrote them as controls (10 on real tmux, 8 in
   the corrected r2 stand-in). The failing part of B-1 is the five real-tmux defects.
4. The round tags: the brief fixes `[same-id R2]` and `[same-id R3]`. Design r3 gives B-5 to the new round
   RW (5.6). Its test keeps the tag `[same-id R3]`, and its header names RW.
5. R2a does not change Herdr `destroy` (R2a brief). The runtime-herdr r3 defects test `destroy`, so they stay
   red after R2a. Design r3 puts the `destroy` refusal of H-a into R2b-1 (3.4). Then the r2 control
   "destroy closes the recorded pane while it has the recorded terminal" (a control of a checked close,
   which H-b keeps) must change, because under H-a no close is sent.
6. The commit trailer: a system reminder asks for a `Co-Authored-By` trailer. The brief forbids it. The
   commits have none.

Deviations and slips (each without an effect on real state):

1. gitleaks: `core.hooksPath` is `.husky/_`, which does not exist in this worktree (the install ran with
   `HUSKY=0`), so `git commit` ran no hook. For `0be91637` I ran `gitleaks` by hand after the commit (no
   leaks). Before `3f6d1551`, `acf944f8` and `c8a35d47` I ran `sh .husky/pre-commit` ("No secrets detected";
   for the last two under `env -i`). gitleaks is not on the scratch `PATH`, so I linked `~/.local/bin/gitleaks` into
   `/tmp/aosd3/gitleaksbin/`.
2. `acf944f8` is a local `--amend` of my own unpushed commit (`594c3029`, the same header corrections plus a
   new `[same-id RW]` tag that I then reverted because of item 4). `pnpm typecheck` and `pnpm lint` ran
   after this commit, not before it: both exit 0.
3. I ran one `prettier --check` of three test files in my own shell instead of under `env -i`. It only
   read the files. I ran it again under `env -i`.
4. Earlier in this round I ran `git stash list | head -0` (read-only). It printed nothing and changed
   nothing.
5. The Herdr leftover check reads `/proc/<pid>/environ` of the uid's processes with `tr` and `grep`,
   read-only, and prints only the PIDs whose `HOME` is the scratch Herdr HOME (none).
6. `herdr --skill` and `herdr api schema --json` ran the real binary under the scratch HOME. They print
   documentation and start no server (8.1).

## 13. Tests of this round

Commits: `0be91637` (r2 oracle corrections), `3f6d1551` (new r3 files), `acf944f8` (header
corrections: section numbers, the round of B-5), `c8a35d47` (the B-5 test no longer needs the helper's
`mv`, so a correct fix can pass it; 13.7). Marking as in design r1 section 8.1. Each new defect fails on
`cbfbc182` (my base) for the measured reason; the failure lines are quoted from `SAME_ID_DEFECTS=red` runs.

### 13.1 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r3.test.ts` (new, real tmux)

Every call goes to a private server at a socket in a temporary directory, through a shim first on PATH
(`env -i ... tmux -f /dev/null -S <socket>`). `beforeAll` checks that `tmux` on PATH is the shim and that
the server answers at the private socket before any plugin call; names are random. Skipped without tmux.

| Test `[same-id R2] B-1 ...` | Red failure |
| --- | --- |
| destroy of an ended launch keeps a later launch of the same name | `expected false to be true` |
| isAlive of an ended launch answers false while a later launch of the same name runs | `expected true to be false` |
| sendMessage to an ended launch gives a later launch of the same name no keys | `expected '$ exec cat -e\nr3-message-for-the-fir…' to be '$ exec cat -e'` |
| a later launch that replaces the session between the commands of one sendMessage gets no keys | `expected 1 to be +0` (the Enter reached the replacement) |
| destroy of a launch whose server no longer answers at its socket keeps the session of the server that answers there now | `expected false to be true` |

Controls (13): destroy ends its own launch; isAlive of its own live launch; sendMessage delivers the text
and the Enter to its own launch; and the M-1 forms on real tmux: the create sets the token on its session;
the own token gives the mutation and the markers; another launch gives no mutation (the `kept` marker names
the target, with a newer session present); an absent session stops at `has-session`; an unknown operator
gives the refusal for the own token; a failing mutation gives `ao-end` and exit 1; `if-shell -t` with a
missing target runs on another session; a branch command without `-t` uses the current session; a format
in a branch must be double-quoted; an unknown operator is FALSE over literal text and TRUE over a nested
format.

### 13.2 `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r3.test.ts` (new)

| Test `[same-id R2] B-2 ...` | Red failure |
| --- | --- |
| destroy keeps the restored pane when the server restarts between the terminal check and the close | `expected [ 'term_run2_w7:p1' ] to deeply equal []` |
| destroy closes no pane of the workspace other than the recorded pane | `expected [ 'term_abc', 'term_user_split' ] to not include 'term_user_split'` |
| destroy closes nothing for a record that has no terminal ID | `expected [ 'term_of_unknown_launch' ] to deeply equal []` |

Control: destroy of a pane that is gone closes no other pane. R2a does not change `destroy`, so these
markings do not change with R2a.

### 13.3 `packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts` (new)

| Test `[same-id R3] B-3 ...` | Red failure |
| --- | --- |
| when postCreate returns, a grandchild that dropped the inherited descriptors no longer runs | `expected true to be false` |

Control: a hook whose processes end before it exits runs and its write stays. Real `sh` and `node`; the
grandchild is stopped by its exact PID after each test.

### 13.4 `packages/core/src/__tests__/same-id-defects-r3.test.ts` (new)

| Test | Red failure |
| --- | --- |
| `[same-id R3] B-4` cleanup of one project keeps an OpenCode session that a live session of another project names | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| `[same-id R3] B-5` a helper write that copied the record before a Node write keeps the Node write's runtimeHandle | `expected 'old' to be 'new'` |

Controls: another project that names another OpenCode session does not stop the cleanup; the helper alone
writes its key and keeps the other keys. The B-5 test runs the real `AO_METADATA_HELPER` under bash with
only scratch values (never the caller's `AO_*`), and a `mv` shim on its PATH that waits for a release file.

### 13.5 Changed r2 files (allowed by the brief for the oracle)

- `runtime-tmux/.../same-id-defects-r2.test.ts`: the stand-in's branch parser, the unknown-operator rule,
  the `if-shell -t` fallback and the exit status after a branch failure now follow t1 and t2 (the header
  lists them). 8 new controls run the design r3 guard forms through the stand-in and expect the real-tmux
  answers. Why: the old rule rejected every `#{` and `$` in a branch, so a correct guard could not pass
  (M-1). The 7 defects keep their results.
- `runtime-herdr/.../same-id-defects-r2.test.ts`: the header claimed that pane IDs are reused after a
  workspace closes (h1 to h3 show they are not, within one server run). The control "destroy closes the
  recorded workspace" now accepts a close of the recorded pane or of its workspace: a pane close also stops
  the session and keeps the user's panes (B-2). Results unchanged.
- Not changed: `packages/core/src/__tests__/same-id-defects-r2.test.ts`, the workspace-worktree r2 file,
  the `c516cead` files.

### 13.6 Red counts (`SAME_ID_DEFECTS=red`, failed/passed per round tag)

| File | `cbfbc182` | `c8a35d47` |
| --- | --- | --- |
| cli same-id-defects | R1 0/2 | R1 0/2 |
| core same-id-defects-r2 | R2 9/4, R4 7/5 | same |
| core same-id-defects | R1 0/5, R3 1/0, R4 3/0 | same |
| **core same-id-defects-r3** | - | **R3 2/2** |
| agent-claude-code same-id-defects | R1 0/1, R2 1/0 | same |
| agent-codex same-id-defects | R1 0/1, R2 1/0, R4 2/0 | same |
| agent-gemini same-id-defects | R1 0/1, R2 1/0, R4 2/0 | same |
| agent-opencode same-id-defects | R1 0/1, R2 1/0, R4 2/0 | same |
| agent-opencode same-id-reuse-window | R3 1/0 | same |
| runtime-herdr same-id-defects-r2 | R2 1/1, R4 2/3 | same |
| **runtime-herdr same-id-defects-r3** | - | **R2 3/1** |
| runtime-herdr same-id-defects | R4 2/0 | same |
| runtime-tmux same-id-defects-r2 | R2 7/6 | **R2 7/14** |
| **runtime-tmux same-id-defects-r3** | - | **R2 5/13** |
| runtime-tmux same-id-defects | R1 0/6, R2 4/0 | same |
| workspace-worktree same-id-defects-r2 | R4 2/3 | same |
| **workspace-worktree same-id-defects-r3** | - | **R3 1/1** |
| workspace-worktree same-id-defects | R3 4/0 | same |

New in this round: 11 defects (R2 8, R3 3) and 25 controls (17 in the new files, 8 in the r2 tmux file).

### 13.7 What each implementing round changes in these tests

Each round turns its `defect(...)` markings into plain tests. In addition:

| Round | Test | Change, and why |
| --- | --- | --- |
| R2b-1 | runtime-tmux `c516cead` (`same-id-defects.test.ts`), the stand-in | it runs only the first command of a `;` list and has no `-P -F`, `set-option` or nested `if-shell`, so the new create cannot run on it. R2b-1 extends it (the r2 stand-in already parses these forms, M-1), or moves D-B and F-7 onto the r2 stand-in. The brief of R2b-1 must allow this change to a `c516cead` file |
| R2b-1 | runtime-herdr r2, "control: destroy closes the recorded pane while it has the recorded terminal" | becomes "destroy refuses with `unknown` and sends no close": under H-a no close is sent (3.4). RH changes it back |
| RW | core r3, "control: the helper alone writes its key and keeps the other keys" | becomes "the helper's key reaches the record at the next `applyInbox`": under RW the helper writes the inbox, not the record (5.6) |
| R3b | core r3 B-4, defect and control | the module mock also gives one known store identity: without it the store is `unknown`, every removal refuses, and the control (a removal that must happen) fails for that reason (6) |

The defect assertions need no change: `c8a35d47` removed the only one that a correct fix would break (the
B-5 test asserted that the helper reaches its `mv`). The `c516cead` stand-in row above is test
infrastructure, not an assertion. The runtime-tmux r3 and runtime-herdr r3 defects already catch the rejections that the new `stop`, `destroy` and `sendMessage` give. The workspace-worktree
r3 test calls `postCreate` without a token, which 5.2 covers.

## 14. Full runs

`env -i HOME=/tmp/aosd3/testhome ... PATH=/tmp/aosd3/bintest:/tmp/aosd3/pnpmbin:/tmp/aosd3/nodebin:/usr/bin:/bin pnpm -r --no-bail test`
(the tmux shim `bintest/tmux` adds `-L aosd3-T`; no agent binary on PATH; no `AO_*`).

| Package | `cbfbc182` (baseline) | `c8a35d47` (final; the same counts at `3f6d1551` and `acf944f8`) |
| --- | --- | --- |
| core | 54 files; 1401 passed, 20 expected fail | 55 files; 1403 passed, 22 expected fail |
| cli | 21; 269 | 21; 269 |
| runtime-tmux | 3; 65 | 4; 91 |
| runtime-herdr | 3; 45 | 4; 49 |
| workspace-worktree | 4; 70 | 5; 72 |
| agent-claude-code / codex / gemini / opencode | 4; 214 / 4; 220 / 2; 67 / 6; 322 | same |
| scm-github | 3; 140 passed, 5 skipped | same |
| tracker-github / notifier-desktop | 1; 42 / 1; 26 | same |
| integration-tests | 10 passed, 3 skipped; 91 passed, 24 skipped | same |
| **Total** | 119 files (116 passed, 3 skipped); 2972 passed, 20 expected fail, 29 skipped; exit 0 | 123 files (120 passed, 3 skipped); 3006 passed, 22 expected fail, 29 skipped; exit 0 |

The plugin packages run vitest 3.2.4, which counts a passing `it.fails` as "passed"; core runs vitest
4.1.4, which shows it as "expected fail". `pnpm typecheck`: exit 0. `pnpm lint`: exit 0, 0 errors, 5
warnings, all in existing source files (`cli/src/commands/spawn.ts`, `core/src/activity-log.ts`,
`core/src/plugin-registry.ts`). Prettier: the changed and new test files pass `--check`.

## 15. Reproducer scripts (outside the repository, `/tmp/aosd3/`)

Every script of this round, in full. Not pasted again: `m1_identity.sh` to `m6_lock_fd.mjs` and
`env.sh` in `/tmp/aosd3/scripts/` are the design r2 scripts with `aosd2` changed to `aosd3` (checked
with `diff`); they did not run in this round, and design r2 section 14 has them. The review's
`probe.mts`, `same-server.mts`, `interposer.mjs` and `readback.mts` are copied to `/tmp/aosd3/ref/`
and did not run (8.9); the review has them.

### t1_token_guard.mjs

t1 (8.2). Path: `/tmp/aosd3/scripts/t1_token_guard.mjs`.

```js
// t1 (OD-17 (b), B-1, M-1): the launch-token guard on private tmux 3.4 servers only
// (-L aosd3-g1, -L aosd3-g2, -L aosd3-g3). Run under the scratch environment:
//   env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd3/tmp \
//     node /tmp/aosd3/scripts/t1_token_guard.mjs
// Every tmux call is an argv list (no shell), as in runtime-tmux. A format inside an if-shell branch
// string is double-quoted (M-1). Every server and pane PID that this script starts goes to
// /tmp/aosd3/logs/pids.txt, and the script stops each of them by its exact PID at the end.
import { spawnSync, spawn } from "node:child_process";
import { appendFileSync, writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd3";
const WS = `${S}/home`;
const started = new Map(); // pid -> what
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, what);
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t1 ${what} pid=${pid}\n`);
}
function tm(server, args, input) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", server, ...args], { encoding: "utf8", input });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
function remember(server) {
  const pid = Number(tm(server, ["display-message", "-p", "#{pid}"]).out);
  if (pid) track(pid, `tmux server ${server}`);
  for (const p of tm(server, ["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter(Boolean)) track(Number(p), `pane on ${server}`);
}
function show(label, r) {
  const o = typeof r === "string" ? r : `exit ${r.code} | out ${JSON.stringify(r.out)} | err ${JSON.stringify(r.err)}`;
  console.log(`  ${label.padEnd(62)} ${o}`);
}
const token = () => randomBytes(16).toString("hex"); // 128 bits, [0-9a-f] only
const q = (fmt) => `"${fmt}"`; // a format in a branch string is double-quoted
const alive = (server, name) => tm(server, ["has-session", "-t", `=${name}`]).code === 0;

// The atomic create: one client command list, no wait point between its items.
function createArgs(name, tok, cmd = "/bin/sleep 300") {
  return ["new-session", "-d", "-P", "-F", "ao-created:#{pid}:#{session_id}:#{session_created}", "-s", name, "-c", WS, cmd,
    ";", "set-option", "-t", `=${name}:`, "@ao_launch", tok,
    ";", "display-message", "-p", "-t", `=${name}:`, "ao-token:#{session_id}:#{@ao_launch}"];
}
// The guard, one client command list with no wait point:
//   1. ao-server:<pid> (prints even if the target is missing);
//   2. has-session -t =NAME (a failing top-level command stops the list: the absent answer);
//   3. a capability gate with nested formats, as in the token check: #{==:#{session_name},NAME} must
//      be TRUE and #{==:#{session_name},ao.cap.x} must be FALSE (a '.' is never in a session name);
//   4. the token check #{==:#{session_name}/#{@ao_launch},NAME/TOKEN}; the mutation exists only in
//      its TRUE branch;
//   5. ao-end (a failure inside an if-shell branch does not stop the list, so a missing ao-end after
//      a present session means that the mutation failed).
// (The first run of this script had a kept marker without -t; t2 showed why it needs one.)
function guardArgs(name, tok, mutation, { op = "==", elseExtra = "" } = {}) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  // Every command in a branch names its target: without -t it runs on the current session, not on
  // the if-shell target (t2). After a kill the target is gone, so the done marker prints the PID only.
  const kept = `${elseExtra}display-message -p -t =${name}: ${q("ao-kept:#{pid}:#{session_id}")}`;
  const done = `${mutation} ; display-message -p ${q("ao-done:#{pid}")}`;
  const inner = `if-shell -F -t =${name}: ${q(`#{${op}:#{session_name}/#{@ao_launch},${name}/${tok}}`)} { ${done} } { ${kept} }`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{${op}:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{${op}:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}
// How the client reads a guard answer.
function classify(r, recorded, name) {
  const server = Number(/ao-server:(\d+)/.exec(r.out)?.[1] ?? 0);
  const sameServer = server === recorded.pid; // in production: pid, raw start ticks and boot ID
  const recordedRuns = existsSync(`/proc/${recorded.pid}`);
  const end = /(^|\n)ao-end$/.test(r.out);
  const elsewhere = "unknown (another server answers, recorded server runs)";
  if (/ao-done:/.test(r.out) && end && r.code === 0) return "destroyed";
  if (/ao-refused:/.test(r.out) && end) return "unknown (unsupported form)";
  if (/ao-kept:/.test(r.out) && end) return sameServer || !recordedRuns ? "other-launch" : elsewhere;
  if (server && !end && r.code !== 0 && r.err === `can't find session: ${name}`) return sameServer || !recordedRuns ? "absent" : elsewhere;
  return "unknown";
}
function created(r) {
  const c = /ao-created:(\d+):(\$\d+):(\d+)/.exec(r.out), t = /ao-token:(\$\d+):([0-9a-f]*)/.exec(r.out);
  return { pid: Number(c?.[1]), id: c?.[2], tokenSession: t?.[1], token: t?.[2] };
}

try {
  console.log("== A. parser and capability probes (server g1)");
  const A = "aosd3-g1";
  const tN = token(), tM = token();
  show("create N", tm(A, createArgs("N", tN)));
  show("create M", tm(A, createArgs("M", tM)));
  remember(A);
  show("A1 #{==:} equal (TRUE expected)", tm(A, ["if-shell", "-F", "#{==:ao-cap,ao-cap}", `display-message -p ${q("T:#{pid}")}`, `display-message -p ${q("F:#{pid}")}`]));
  show("A2 #{==:} different (FALSE expected)", tm(A, ["if-shell", "-F", "#{==:ao-cap,ao-cax}", `display-message -p ${q("T:#{pid}")}`, `display-message -p ${q("F:#{pid}")}`]));
  show("A3 #{nosuchop:} (an unknown operator)", tm(A, ["if-shell", "-F", "#{nosuchop:ao-cap,ao-cax}", "display-message -p T", "display-message -p F"]));
  show("A3b #{nosuchop:} with a nested format", tm(A, ["if-shell", "-F", "#{nosuchop:#{pid},ao-cax}", "display-message -p T", "display-message -p F"]));
  show("A3c #{nosuchop:} with a nested format, equal strings", tm(A, ["if-shell", "-F", "#{nosuchop:#{pid},#{pid}}", "display-message -p T", "display-message -p F"]));
  show("A4 an unquoted format in a branch", tm(A, ["if-shell", "-F", "1", "display-message -p ao-x:#{pid}", "display-message -p F"]));
  show("A5 a double-quoted format in a branch", tm(A, ["if-shell", "-F", "1", `display-message -p ${q("ao-x:#{pid}")}`, "display-message -p F"]));
  show("A6 braces in a branch string", tm(A, ["if-shell", "-F", "1", `if-shell -F ${q("#{==:a,b}")} { display-message -p ${q("inner-T")} } { display-message -p ${q("inner-F:#{pid}")} }`, "display-message -p F"]));
  show("A7 braces as argv", tm(A, ["if-shell", "-F", "1", "{", "display-message", "-p", "argv-T", "}", "{", "display-message", "-p", "argv-F", "}"]));
  // Late expansion: the outer if-shell targets M, the inner targets N. If the branch string were
  // expanded at the outer level, #{@ao_launch} would be M's token and the inner answer FALSE.
  show("A8 inner format expands at the inner command (TRUE expected)", tm(A, ["if-shell", "-F", "-t", "=M:", "1",
    `if-shell -F -t =N: ${q(`#{==:#{@ao_launch},${tN}}`)} { display-message -p ${q("late:#{session_name}")} } { display-message -p ${q("early:#{session_name}")} }`, "display-message -p F"]));
  show("A9 a failing command inside a branch, then a second command", tm(A, ["if-shell", "-F", "1", `kill-session -t =N-gone ; display-message -p ${q("after-fail")}`, "display-message -p F"]));
  show("A10 the same, then a top-level command after the if-shell", tm(A, ["if-shell", "-F", "1", "kill-session -t =N-gone", "display-message -p F", ";", "display-message", "-p", "top-level-after"]));

  show("A11 a failing top-level command, then a second command", tm(A, ["display-message", "-p", "one", ";", "has-session", "-t", "=nope", ";", "display-message", "-p", "two"]));
  show("A12 if-shell -t with a missing target (CMD_FIND_CANFAIL)", tm(A, ["if-shell", "-F", "-t", "=nope:", "1", `display-message -p ${q("ran-on:#{session_name}")}`, "display-message -p F"]));
  console.log("== B. the atomic create and its read-back (server g1)");
  const tP = token();
  const rP = tm(A, createArgs("P", tP));
  show("B1 create P with its token", rP);
  const cP = created(rP);
  show("B1 created session = token session, token = own", `${cP.id} = ${cP.tokenSession}: ${cP.id === cP.tokenSession}; ${cP.token === tP}`);
  show("B2 create P again (the name exists)", tm(A, createArgs("P", token())));
  show("B3 the session option is per session (M has its own)", tm(A, ["display-message", "-p", "-t", "=M:", "#{session_id}:#{@ao_launch}"]));
  remember(A);

  console.log("== C. guarded mutations (server g1, recorded server = g1)");
  const recA = { pid: cP.pid };
  // C1 own token: kill
  let r = tm(A, guardArgs("P", tP, "kill-session -t =P"));
  show("C1 guarded kill, own token", r); show("C1 answer; P still exists", `${classify(r, recA, "P")}; ${alive(A, "P")}`);
  // C2 another launch with the same name and another token
  const tP2 = token(); const rP2 = tm(A, createArgs("P", tP2)); remember(A);
  show("C2 another launch of P", `${created(rP2).id} token ${created(rP2).token === tP2 ? "own" : "?"}`);
  r = tm(A, guardArgs("P", tP, "kill-session -t =P"));
  show("C2 guarded kill with the first token", r); show("C2 answer; P still exists", `${classify(r, recA, "P")}; ${alive(A, "P")}`);
  // C3 absent session
  r = tm(A, guardArgs("Q", tP, "kill-session -t =Q"));
  show("C3 guarded kill of an absent session", r); show("C3 answer", classify(r, recA, "Q"));
  // C4 an unsupported comparison (an operator that this tmux does not know), with and without the gate
  r = tm(A, guardArgs("P", tP2, "kill-session -t =P", { op: "nosuchop" }));
  show("C4 gated guard, unknown operator, OWN token", r); show("C4 answer; P still exists", `${classify(r, recA, "P")}; ${alive(A, "P")}`);
  const tU = token(); tm(A, createArgs("U", tU)); remember(A);
  r = tm(A, ["if-shell", "-F", "-t", "=U:", `#{nosuchop:#{@ao_launch},wrong-token}`, `kill-session -t =U ; display-message -p ${q("ao-done:#{pid}")}`, `display-message -p ${q("ao-kept:#{pid}")}`]);
  show("C4b NO gate, unknown operator, WRONG token (why the gate)", r); show("C4b U still exists", String(alive(A, "U")));
  // C5 a close failure inside the TRUE branch
  r = tm(A, guardArgs("P", tP2, "kill-session -t =P-gone"));
  show("C5 own token, the mutation fails", r); show("C5 answer; P still exists", `${classify(r, recA, "P")}; ${alive(A, "P")}`);
  // C6 send-keys: pane runs cat, so typed text echoes
  const tK = token(); tm(A, createArgs("K", tK, "/bin/cat")); remember(A);
  const tK2 = token(); tm(A, createArgs("K2", tK2, "/bin/cat")); remember(A);
  r = tm(A, guardArgs("K", tK, "send-keys -t =K: ao-own-keys"));
  show("C6 guarded send-keys, own token", r);
  r = tm(A, guardArgs("K2", tK, "send-keys -t =K2: ao-foreign-keys"));
  show("C6 guarded send-keys, other token", r);
  await sleep(150);
  show("C6 pane K / pane K2", `${JSON.stringify(tm(A, ["capture-pane", "-p", "-t", "=K:"]).out)} / ${JSON.stringify(tm(A, ["capture-pane", "-p", "-t", "=K2:"]).out)}`);
  // C7 paste: the text never passes through the tmux parser (load-buffer from stdin)
  for (const [label, target, tok] of [["own token", "K", tK], ["other token", "K2", tK]]) {
    const buf = `ao-${token().slice(0, 12)}`;
    show(`C7 load-buffer ${buf} (${label})`, tm(A, ["load-buffer", "-b", buf, "-"], `ao-paste ${label} $HOME ; #{pid} "q" 'a'`));
    r = tm(A, guardArgs(target, tok, `paste-buffer -d -b ${buf} -t =${target}:`, { elseExtra: `delete-buffer -b ${buf} ; ` }));
    show(`C7 guarded paste-buffer -d (${label})`, r);
    show(`C7 the buffer is gone`, String(!tm(A, ["list-buffers", "-F", "#{buffer_name}"]).out.split("\n").includes(buf)));
  }
  await sleep(150);
  show("C7 pane K / pane K2", `${JSON.stringify(tm(A, ["capture-pane", "-p", "-t", "=K:"]).out)} / ${JSON.stringify(tm(A, ["capture-pane", "-p", "-t", "=K2:"]).out)}`);
  // C8 attach through the guard, with the server arguments in the spawned command; `script` gives the tty
  for (const [label, tok] of [["own token", tK], ["other token", token()]]) {
    const argv = ["-f", "/dev/null", "-L", A, ...guardArgs("K", tok, "attach-session -t =K")];
    writeFileSync(`${S}/tmp/t1-attach.json`, JSON.stringify(argv));
    const outFile = `${S}/tmp/t1-attach-${label.replace(" ", "-")}.out`;
    const child = spawn("/usr/bin/script", ["-qfec", `${S}/nodebin/node ${S}/scripts/t1_exec.mjs ${S}/tmp/t1-attach.json`, "/dev/null"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color" } });
    track(child.pid, "script (attach)");
    const exited = new Promise((res) => child.once("exit", (c) => res(c)));
    let got = ""; child.stdout.on("data", (d) => (got += d)); child.stderr.on("data", (d) => (got += d));
    let clients = "";
    for (let i = 0; i < 20 && !clients; i++) { await sleep(100); clients = tm(A, ["list-clients", "-F", "#{client_session}:#{client_pid}"]).out; }
    show(`C8 guarded attach (${label}): clients`, JSON.stringify(clients));
    for (const l of clients.split("\n").filter(Boolean)) track(Number(l.split(":")[1]), "tmux client (attach)");
    if (clients) show("C8 detach-client -s =K", tm(A, ["detach-client", "-s", "=K"]));
    const code = await Promise.race([exited, sleep(3000).then(() => "timeout")]);
    if (code === "timeout") { try { process.kill(child.pid, "SIGKILL"); } catch {} }
    writeFileSync(outFile, got);
    show(`C8 script exit; client output`, `${code}; ${JSON.stringify(got.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][A-Z0-9]/g, "").slice(0, 300))}`);
  }
  // C9 the last session of a server: a guarded kill also ends the server
  const L = "aosd3-g4"; const tL = token(); const cL = created(tm(L, createArgs("L", tL))); remember(L);
  r = tm(L, guardArgs("L", tL, "kill-session -t =L"));
  show("C9 guarded kill of the last session of its server", r); show("C9 answer; server still runs", `${classify(r, { pid: cL.pid }, "L")}; ${existsSync(`/proc/${cL.pid}`)}`);

  console.log("== D. two servers, the same name, the same $N");
  const B = "aosd3-g2";
  const tX1 = token(), tX2 = token();
  const x1 = created(tm(A, createArgs("X", tX1))); remember(A);
  const x2 = created(tm(B, createArgs("X", tX2))); remember(B);
  show("D1 X on g1 and on g2", `g1 ${x1.id} pid ${x1.pid}; g2 ${x2.id} pid ${x2.pid}`);
  r = tm(B, guardArgs("X", tX1, "kill-session -t =X"));
  show("D1 g1's handle, guard sent to g2", r); show("D1 answer; X on g2 exists", `${classify(r, { pid: x1.pid }, "X")}; ${alive(B, "X")}`);
  r = tm(A, ["display-message", "-p", "-t", "=X:", "ao-alive:#{pid}:#{session_id}:#{@ao_launch}"]);
  show("D2 isAlive read on g1 (the client compares the token)", r);
  show("D2 isAlive of g1's handle on g2", tm(B, ["display-message", "-p", "-t", "=X:", "ao-alive:#{pid}:#{session_id}:#{@ao_launch}"]));
  // D3 restart of g2: a new server process, X again as $0 with a new token
  const g2pid = x2.pid;
  tm(B, ["kill-server"]); await sleep(150);
  show("D3 g2 server process ended", String(!existsSync(`/proc/${g2pid}`)));
  const tX3 = token(); const x3 = created(tm(B, createArgs("X", tX3))); remember(B);
  show("D3 X on the restarted g2", `${x3.id} pid ${x3.pid}`);
  r = tm(B, guardArgs("X", tX2, "kill-session -t =X"));
  show("D3 the old g2 handle after the restart", r); show("D3 answer; X exists", `${classify(r, { pid: g2pid }, "X")}; ${alive(B, "X")}`);
  // D4 rebound socket: unlink our own g1 socket while g1 runs; a new server takes the path
  const sock = `/tmp/tmux-${process.getuid()}/${A}`;
  const g1pid = x1.pid;
  unlinkSync(sock);
  const tX4 = token(); const x4 = created(tm(A, createArgs("X", tX4))); remember(A);
  show("D4 new server at g1's path", `${x4.id} pid ${x4.pid}; old g1 ${g1pid} runs: ${existsSync(`/proc/${g1pid}`)}`);
  r = tm(A, guardArgs("X", tX1, "kill-session -t =X"));
  show("D4 g1's handle, guard at the rebound path", r); show("D4 answer; X exists at the path", `${classify(r, { pid: g1pid }, "X")}; ${alive(A, "X")}`);
  r = tm(A, guardArgs("Y", tX1, "kill-session -t =Y"));
  show("D4 absent name at the rebound path", r); show("D4 answer", classify(r, { pid: g1pid }, "Y"));

  console.log("== E. the create race: a racer kills and recreates R between client commands");
  const G = "aosd3-g3";
  tm(G, ["new-session", "-d", "-s", "keeper", "/bin/sleep 600"]); remember(G);
  if (existsSync(`${S}/tmp/t1-race-stop`)) unlinkSync(`${S}/tmp/t1-race-stop`);
  const racer = spawn("/bin/bash", ["-c", `while [ ! -e ${S}/tmp/t1-race-stop ]; do /usr/bin/tmux -f /dev/null -L ${G} kill-session -t =R 2>/dev/null; /usr/bin/tmux -f /dev/null -L ${G} new-session -d -s R '/bin/sleep 600' \\; set-option -t =R: @ao_launch racer 2>/dev/null; done`], { stdio: "ignore" });
  track(racer.pid, "racer loop");
  for (const [label, wait] of [["no wait point (production form)", false], ["control: run-shell sleep between the items", true]]) {
    const n = { consistent: 0, duplicate: 0, lost: 0, mismatch: 0, other: 0 };
    for (let i = 0; i < 200; i++) {
      const tok = token();
      const args = createArgs("R", tok);
      if (wait) args.splice(args.indexOf(";"), 0, ";", "run-shell", "sleep 0.02");
      const res = tm(G, args);
      const c = created(res);
      if (res.code !== 0 && /duplicate session/.test(res.err)) n.duplicate++;
      else if (c.id && !c.tokenSession) n.lost++;
      else if (c.id && (c.id !== c.tokenSession || c.token !== tok)) n.mismatch++;
      else if (c.id && res.code === 0) n.consistent++;
      else n.other++;
    }
    show(`E ${label}`, JSON.stringify(n));
  }
  writeFileSync(`${S}/tmp/t1-race-stop`, "go");
  await new Promise((res) => racer.once("exit", res));
} finally {
  for (const srv of ["aosd3-g1", "aosd3-g2", "aosd3-g3", "aosd3-g4"]) { remember(srv); tm(srv, ["kill-server"]); }
  await sleep(300);
  for (const [pid] of started) if (existsSync(`/proc/${pid}`)) { try { process.kill(pid, "SIGTERM"); } catch {} }
  // (each PID in `started` is one that this script started and recorded; no other PID is signalled)
  await sleep(300);
  for (const [pid] of started) if (existsSync(`/proc/${pid}`)) { try { process.kill(pid, "SIGKILL"); } catch {} }
  await sleep(200);
  const left = [...started].filter(([pid]) => existsSync(`/proc/${pid}`) && !/^Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]));
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}`);
}
```

### t1_exec.mjs

t1 part C8: the attach through `script`. Path: `/tmp/aosd3/scripts/t1_exec.mjs`.

```js
// t1_exec: run /usr/bin/tmux with the argv list in a JSON file, on the terminal of `script` (C8).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const r = spawnSync("/usr/bin/tmux", JSON.parse(readFileSync(process.argv[2], "utf8")), { stdio: "inherit" });
process.exit(r.status ?? 1);
```

### t2_branch_target.mjs

t2 (8.3). Path: `/tmp/aosd3/scripts/t2_branch_target.mjs`.

```js
// t2 (M-1): two points for the stand-in and the markers, on a private tmux 3.4 server (-L aosd3-g5).
//  1. Does a command in an if-shell branch use the if-shell's -t target, or the current session?
//  2. `$` in a branch string: unquoted, double-quoted, single-quoted, and as a $N target.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const srv = "aosd3-g5";
const tm = (...a) => { const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", srv, ...a], { encoding: "utf8" }); return `exit ${r.status} | out ${JSON.stringify(r.stdout.trim())} | err ${JSON.stringify(r.stderr.trim())}`; };
const show = (l, r) => console.log(`  ${l.padEnd(64)} ${r}`);
tm("new-session", "-d", "-s", "N", "/bin/sleep 600");
tm("new-session", "-d", "-s", "M", "/bin/sleep 600");
const pid = Number(spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", srv, "display-message", "-p", "#{pid}"], { encoding: "utf8" }).stdout);
appendFileSync("/tmp/aosd3/logs/pids.txt", `${new Date().toISOString().slice(11, 23)} t2 tmux server ${srv} pid=${pid}\n`);
try {
  console.log("== 1. the target of a branch command (N made first, M second)");
  show("if-shell -t =N: ; branch: display-message -p (no -t)", tm("if-shell", "-F", "-t", "=N:", "1", 'display-message -p "#{session_name}"'));
  show("if-shell -t =N: ; branch: display-message -p -t =N:", tm("if-shell", "-F", "-t", "=N:", "1", 'display-message -p -t =N: "#{session_name}"'));
  show("if-shell -t =M: ; branch: display-message -p (no -t)", tm("if-shell", "-F", "-t", "=M:", "1", 'display-message -p "#{session_name}"'));
  show("the condition uses the -t target (N)", tm("if-shell", "-F", "-t", "=N:", "#{==:#{session_name},N}", "display-message -p T", "display-message -p F"));
  console.log("== 2. $ in a branch string (HOME is /tmp/aosd3/home)");
  show("unquoted $HOME", tm("if-shell", "-F", "1", "display-message -p $HOME"));
  show('double-quoted "$HOME"', tm("if-shell", "-F", "1", 'display-message -p "$HOME"'));
  show("single-quoted '$HOME'", tm("if-shell", "-F", "1", "display-message -p '$HOME'"));
  show("unquoted $0 (a session ID)", tm("if-shell", "-F", "1", "display-message -p -t $0 x"));
  show("single-quoted '$0' as a target", tm("if-shell", "-F", "1", "display-message -p -t '$0' \"t0:#{session_name}\""));
  show('double-quoted "$0" as a target', tm("if-shell", "-F", "1", 'display-message -p -t "$0" "t0:#{session_name}"'));
} finally {
  spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", srv, "kill-server"]);
  const wait = Date.now() + 2000; while (existsSync(`/proc/${pid}`) && Date.now() < wait) {}
  if (existsSync(`/proc/${pid}`)) process.kill(pid, "SIGKILL");
  show("server still runs", String(existsSync(`/proc/${pid}`)));
}
```

### t3_probe_assoc_attach.mjs

t3 (8.4). Path: `/tmp/aosd3/scripts/t3_probe_assoc_attach.mjs`.

```js
// t3 (B-1, M-3, the attach of review r2): three forms of design r3 on a private tmux 3.4 server
// (-L aosd3-g6 only). Run under the scratch environment:
//   env -i HOME=/tmp/aosd3/home PATH=/tmp/aosd3/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd3/tmp \
//     SHELL=/bin/sh node /tmp/aosd3/scripts/t3_probe_assoc_attach.mjs
//  1. the agent probes: does list-panes (one session, and -a) print the session option @ao_launch, and
//     does a pane option of the same name shadow it?
//  2. the attach guard: which command fails for certain in the FALSE branch, so that the client exits 1?
//     Candidates: has-session -t =ao.refused, =ao:refused (a session "ao" exists), %<large>, '$<large>'.
//     Also: can a session name hold a '.'?
//  3. the legacy association: a compare-and-set of the token inside tmux, keyed on pane_pid and on an
//     empty @ao_launch.
// Every server and pane PID goes to /tmp/aosd3/logs/pids.txt; the script stops each by its exact PID.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd3";
const SRV = "aosd3-g6";
const SOCK = `/tmp/tmux-${process.getuid()}/${SRV}`;
const started = new Map();
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, what);
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t3 ${what} pid=${pid}\n`);
}
function tm(args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
function remember() {
  const pid = Number(tm(["display-message", "-p", "#{pid}"]).out);
  if (pid) track(pid, `tmux server ${SRV}`);
  for (const p of tm(["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter(Boolean)) track(Number(p), `pane on ${SRV}`);
}
function show(label, r) {
  const o = typeof r === "string" ? r : `exit ${r.code} | out ${JSON.stringify(r.out)} | err ${JSON.stringify(r.err)}`;
  console.log(`  ${label.padEnd(66)} ${o}`);
}
const token = () => randomBytes(16).toString("hex");
const q = (fmt) => `"${fmt}"`;
function createArgs(name, tok) {
  return ["new-session", "-d", "-P", "-F", "ao-created:#{pid}:#{session_id}", "-s", name, "-c", `${S}/home`, "/bin/sleep 300",
    ";", "set-option", "-t", `=${name}:`, "@ao_launch", tok,
    ";", "display-message", "-p", "-t", `=${name}:`, "ao-token:#{session_id}:#{@ao_launch}"];
}
// The guard of design r3 section 2.3, with a command after the markers of the FALSE and refused branches.
function guardArgs(name, tok, mutation, after = "") {
  const tail = after ? ` ; ${after}` : "";
  const refused = `display-message -p ${q("ao-refused:#{pid}")}${tail}`;
  const kept = `display-message -p -t =${name}: ${q("ao-kept:#{pid}:#{session_id}")}${tail}`;
  const done = `${mutation} ; display-message -p ${q("ao-done:#{pid}")}`;
  const inner = `if-shell -F -t =${name}: ${q(`#{==:#{session_name}/#{@ao_launch},${name}/${tok}}`)} { ${done} } { ${kept} }`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}
// The association of design r3 section 2.9: set a token only on the audited pane of a session without one.
function associateArgs(name, panePid, tok) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p ${q("ao-assoc:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q("ao-assoc-refused:#{pid}:#{pane_pid}:#{@ao_launch}")}`;
  const inner = `if-shell -F -t =${name}: ${q(`#{==:#{session_name}/#{pane_pid}/#{@ao_launch},${name}/${panePid}/}`)} { ${set} } { ${no} }`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}

if (existsSync(SOCK)) throw new Error(`${SOCK} exists: not started by this script`);
let ownSocket = false;
try {
  console.log("== 1. the agent probes read the session option");
  const tok = token();
  const c = tm(createArgs("K", tok));
  ownSocket = existsSync(SOCK);
  remember();
  show("create K with a token", c);
  show("list-panes -t =K: #{pane_pid}|#{@ao_launch}", tm(["list-panes", "-t", "=K:", "-F", "#{pane_pid}|#{@ao_launch}"]));
  show("list-panes -t =K: equals the token", String(tm(["list-panes", "-t", "=K:", "-F", "#{@ao_launch}"]).out === tok));
  show("list-panes -a #{session_name}|#{@ao_launch}", tm(["list-panes", "-a", "-F", "#{session_name}|#{@ao_launch}"]));
  show("set-option -p (a pane option of the same name)", tm(["set-option", "-p", "-t", "=K:", "@ao_launch", "pane-value"]));
  show("display -t =K: #{@ao_launch} with the pane option", tm(["display-message", "-p", "-t", "=K:", "#{@ao_launch}"]));
  show("show-options -v -t =K: @ao_launch (session scope)", tm(["show-options", "-v", "-t", "=K:", "@ao_launch"]));
  show("set-option -p -u (remove the pane option)", tm(["set-option", "-p", "-u", "-t", "=K:", "@ao_launch"]));
  show("display -t =K: #{@ao_launch} again equals the token", String(tm(["display-message", "-p", "-t", "=K:", "#{@ao_launch}"]).out === tok));

  console.log("== 2. a command that fails for certain (the attach guard's FALSE branch)");
  show("new-session -s 'a.b' (a '.' in a name): the name", tm(["new-session", "-d", "-P", "-F", "#{session_name}", "-s", "a.b", "/bin/sleep 300"]));
  show("new-session -s 'ao' (a session named ao)", tm(["new-session", "-d", "-P", "-F", "#{session_name}", "-s", "ao", "/bin/sleep 300"]));
  remember();
  for (const t of ["=ao.refused", "=ao:refused", "%2147483647"]) show(`has-session -t ${t} (top level)`, tm(["has-session", "-t", t]));
  show("has-session -t '$2147483647' (top level)", tm(["has-session", "-t", "$2147483647"]));
  for (const t of ["=ao.refused", "%2147483647", "'$2147483647'"]) {
    show(`guard, other token; FALSE branch ends with has-session -t ${t}`, tm(guardArgs("K", token(), "kill-session -t =K", `has-session -t ${t}`)));
  }
  show("K still exists", String(tm(["has-session", "-t", "=K"]).code === 0));
  show("guard, own token, has-session -t %2147483647 after the markers", tm(guardArgs("K", tok, "display-message -p -t =K: own-branch-ran", "has-session -t %2147483647")));
  show("guard, unknown operator (refused), the same command after it", tm(guardArgs("K", tok, "kill-session -t =K", "has-session -t %2147483647").map((a) => a.replace(/#\{==:/g, "#{nosuchop:"))));
  show("K still exists", String(tm(["has-session", "-t", "=K"]).code === 0));

  console.log("== 3. the legacy association: compare-and-set of the token inside tmux");
  show("new-session L (a legacy session: no token)", tm(["new-session", "-d", "-P", "-F", "#{session_id}", "-s", "L", "/bin/sleep 300"]));
  remember();
  const pid = tm(["display-message", "-p", "-t", "=L:", "#{pane_pid}"]).out;
  show("audited pane_pid of L", pid);
  const t1 = token();
  show("associate with a wrong pane_pid", tm(associateArgs("L", String(Number(pid) + 100000), t1)));
  show("L has no token", JSON.stringify(tm(["display-message", "-p", "-t", "=L:", "#{@ao_launch}"]).out));
  show("associate with the audited pane_pid", tm(associateArgs("L", pid, t1)));
  show("L's token equals the new token", String(tm(["display-message", "-p", "-t", "=L:", "#{@ao_launch}"]).out === t1));
  show("associate again (a token is present)", tm(associateArgs("L", pid, token())));
  show("L's token is still the first one", String(tm(["display-message", "-p", "-t", "=L:", "#{@ao_launch}"]).out === t1));
  show("associate a session that does not exist", tm(associateArgs("Z", pid, token())));
  show("guard with the associated token (a kill)", tm(guardArgs("L", t1, "kill-session -t =L")));
  show("L still exists", String(tm(["has-session", "-t", "=L"]).code === 0));
} finally {
  remember();
  const server = [...started].find(([, w]) => w.startsWith("tmux server"))?.[0];
  for (const [p, w] of started) if (w.startsWith("pane")) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  if (server) try { process.kill(server, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  if (ownSocket && existsSync(SOCK)) unlinkSync(SOCK); // the socket of the server that this script started
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(SOCK)}`);
}
```

### h1_herdr_ids.sh

h1 (8.5). Path: `/tmp/aosd3/scripts/h1_herdr_ids.sh`.

```bash
#!/usr/bin/env bash
# h1 (B-2): Herdr 0.8.0 ID reuse and close answers, on an ISOLATED scratch Herdr server only.
# Isolation: env -i with HOME and every XDG directory under /tmp/aosd3/herdrhome; the version and
# manifest checks are off in the scratch config; the script stops at once (and stops the server by
# its exact PID) unless the server's only listening Unix socket is under /tmp/aosd3. The real
# ~/.config/herdr listing is compared before and after. Panes run /bin/sh with the fake HOME.
#  1. workspace create; pane split; pane close; pane get of the closed pane (the error answer)
#  2. pane split again: does the closed pane ID come back?
#  3. workspace close; workspace get and pane get of the closed IDs; workspace create again:
#     does the closed workspace ID come back? (five rounds)
#  4. the shell of a pane exits: does the pane close, or does it get another terminal?
#  5. pane move into another workspace: the new pane ID, and the old ID from outside
set -uo pipefail
H=/tmp/aosd3/herdrhome
BIN=/tmp/aosd3/herdrbin/herdr   # a byte-identical copy of ~/.local/bin/herdr (0.8.0)
LOG=/tmp/aosd3/logs
PIDLOG=$LOG/pids.txt
HE=(env -i HOME=$H XDG_CONFIG_HOME=$H/.config XDG_DATA_HOME=$H/.local/share XDG_STATE_HOME=$H/.local/state
    XDG_RUNTIME_DIR=$H/run PATH=/usr/bin:/bin LANG=C.UTF-8 TERM=xterm-256color SHELL=/bin/sh)
hd() { timeout 10 "${HE[@]}" "$BIN" "$@" </dev/null 2>&1; }
j() { python3 -c "import json,sys
try: d=json.loads(sys.stdin.read())
except Exception as e: print('NOT-JSON'); sys.exit()
cur=d
for k in sys.argv[1].split('.'):
    cur = cur.get(k) if isinstance(cur, dict) else None
print(cur if not isinstance(cur,(dict,list)) else json.dumps(cur))" "$1"; }
show() { printf '  %-58s %s\n' "$1" "$2"; }

ls -la --time-style=full-iso ~/.config/herdr > $LOG/h1-real-before.txt
mkdir -p $H/.config/herdr $H/.local/share $H/.local/state $H/run $H/ws && chmod 700 $H/run
cat > $H/.config/herdr/config.toml <<'TOML'
[update]
version_check = false
manifest_check = false
TOML

echo "== 0. start the scratch server and check its isolation"
# The server runs under strace -f, so that every path it (and each pane shell) opens or connects to
# is on record. The check below reads that record before any client call.
setsid "${HE[@]}" /usr/bin/strace -f -qq -e trace=%file,connect,bind -o $LOG/h1-strace.log "$BIN" server > $LOG/h1-server.log 2>&1 < /dev/null &
TPID=$!
echo "$(date +%T.%N | cut -c1-12) strace of herdr server pid=$TPID" >> $PIDLOG
for _ in $(seq 1 100); do [ -S $H/.config/herdr/herdr.sock ] && break; sleep 0.05; done
SPID=$(ps -o pid= --ppid $TPID | tr -d ' ' | head -1)
echo "$(date +%T.%N | cut -c1-12) herdr server pid=$SPID" >> $PIDLOG
outside=$(grep -oE '"/[^"]*"' $LOG/h1-strace.log | tr -d '"' | sort -u | grep -vE '^/(tmp|tmp/aosd3|tmp/aosd3/.*|proc/.*|sys/.*|dev/.*|etc/.*|usr/.*|lib.*|bin/.*)$' | grep -vx "$BIN")
inet=$(grep -cE 'connect\([0-9]+, \{sa_family=AF_INET' $LOG/h1-strace.log)
show "paths outside /tmp/aosd3 and the system dirs" "[$(echo $outside)]"
show "inet connect calls" "$inet"
show "paths under /home (any)" "[$(grep -oE '"/home/[^"]*"' $LOG/h1-strace.log | tr -d '"' | sort -u | tr '\n' ' ')]"
socks=$(ss -xlpn 2>/dev/null | awk -v p="pid=$SPID," 'index($0,p){print $5}' | sort -u)
show "server pid" "$SPID ($(tr '\0' ' ' < /proc/$SPID/cmdline 2>/dev/null))"
show "listening Unix sockets of the server" "$(echo $socks)"
show "environment of the server" "$(tr '\0' ' ' < /proc/$SPID/environ 2>/dev/null)"
bad=0; [ -n "$socks" ] || bad=1; [ -z "$outside" ] || bad=1; [ "$inet" = 0 ] || bad=1
for s in $socks; do case "$s" in /tmp/aosd3/*) ;; *) bad=1;; esac; done
if [ $bad -ne 0 ]; then echo "ISOLATION NOT SHOWN: stop the server and abort"; kill -TERM $SPID; sleep 0.5; kill -KILL $SPID $TPID 2>/dev/null; exit 1; fi
show "isolation" "ok: sockets under /tmp/aosd3, no other path outside the system dirs, no inet connect"
show "status server" "$(hd status server | tr '\n' ' ')"

echo "== 1. pane close and the answer for a closed pane"
OUT=$(hd workspace create --cwd $H/ws --label h1a --no-focus)
W1=$(echo "$OUT" | j result.workspace.workspace_id); P1=$(echo "$OUT" | j result.root_pane.pane_id); T1=$(echo "$OUT" | j result.root_pane.terminal_id)
show "workspace create" "$W1 root $P1 terminal $T1"
OUT=$(hd pane split "$P1" --direction right --no-focus); P2=$(echo "$OUT" | j result.pane.pane_id); T2=$(echo "$OUT" | j result.pane.terminal_id)
show "pane split" "$P2 terminal $T2"
OUT=$(hd pane close "$P2"); show "pane close $P2 (exit $?)" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"
OUT=$(hd pane get "$P2"); E=$?; show "pane get $P2 (closed) exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"
OUT=$(hd pane close "$P2"); E=$?; show "pane close $P2 again exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"

echo "== 2. does a closed pane ID come back?"
for i in 1 2 3; do
  OUT=$(hd pane split "$P1" --direction right --no-focus); PX=$(echo "$OUT" | j result.pane.pane_id); TX=$(echo "$OUT" | j result.pane.terminal_id)
  show "pane split $i" "$PX terminal $TX"
  hd pane close "$PX" >/dev/null
done

echo "== 3. does a closed workspace ID come back? (five rounds of create and close)"
OUT=$(hd workspace close "$W1"); E=$?; show "workspace close $W1 exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-160)"
OUT=$(hd workspace get "$W1"); E=$?; show "workspace get $W1 (closed) exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"
OUT=$(hd pane get "$P1"); E=$?; show "pane get $P1 (its workspace closed) exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"
for i in 1 2 3 4 5; do
  OUT=$(hd workspace create --cwd $H/ws --label "h1r$i" --no-focus)
  WX=$(echo "$OUT" | j result.workspace.workspace_id); PX=$(echo "$OUT" | j result.root_pane.pane_id); TX=$(echo "$OUT" | j result.root_pane.terminal_id); NX=$(echo "$OUT" | j result.workspace.number)
  show "create $i" "workspace $WX (number $NX) root $PX terminal $TX"
  hd workspace close "$WX" >/dev/null
done
OUT=$(hd workspace create --cwd $H/ws --label h1keep --no-focus); WK=$(echo "$OUT" | j result.workspace.workspace_id); PK=$(echo "$OUT" | j result.root_pane.pane_id)
OUT=$(hd workspace create --cwd $H/ws --label h1b --no-focus); WB=$(echo "$OUT" | j result.workspace.workspace_id); PB=$(echo "$OUT" | j result.root_pane.pane_id)
show "two open workspaces" "$WK ($PK), $WB ($PB)"
hd workspace close "$WK" >/dev/null
OUT=$(hd workspace create --cwd $H/ws --label h1c --no-focus); WC=$(echo "$OUT" | j result.workspace.workspace_id); PC=$(echo "$OUT" | j result.root_pane.pane_id)
show "close the first, create again" "$WC ($PC); the closed one was $WK ($PK)"
OUT=$(hd workspace list); show "workspace list" "$(echo "$OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print([(w['workspace_id'],w['number'],w['label']) for w in d['result']['workspaces']])" 2>&1)"

echo "== 4. the shell of a pane exits"
OUT=$(hd pane split "$PB" --direction right --no-focus); PE=$(echo "$OUT" | j result.pane.pane_id); TE=$(echo "$OUT" | j result.pane.terminal_id)
show "pane for the exit" "$PE terminal $TE"
hd pane send-text "$PE" "exit" >/dev/null; hd pane send-keys "$PE" Enter >/dev/null; sleep 1
OUT=$(hd pane get "$PE"); E=$?; show "pane get $PE after its shell exit (exit $E)" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-220)"
OUT=$(hd pane send-text "$PB" "exit"); hd pane send-keys "$PB" Enter >/dev/null; sleep 1
OUT=$(hd pane get "$PB"); E=$?; show "the last pane $PB of $WB after its shell exit (exit $E)" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-220)"
OUT=$(hd workspace get "$WB"); E=$?; show "workspace get $WB after its last shell exit (exit $E)" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"

echo "== 5. pane move into another workspace"
OUT=$(hd workspace create --cwd $H/ws --label h1m --no-focus); WM=$(echo "$OUT" | j result.workspace.workspace_id); PMR=$(echo "$OUT" | j result.root_pane.pane_id)
OUT=$(hd pane split "$PMR" --direction right --no-focus); PM=$(echo "$OUT" | j result.pane.pane_id); TM=$(echo "$OUT" | j result.pane.terminal_id)
show "pane to move" "$PM terminal $TM (from $WM)"
OUT=$(hd pane move "$PM" --workspace "$WC" --no-focus); E=$?
show "pane move $PM --workspace $WC (exit $E)" "new $(echo "$OUT" | j result.move_result.pane.pane_id) previous $(echo "$OUT" | j result.move_result.previous_pane_id) terminal $(echo "$OUT" | j result.move_result.pane.terminal_id)"
OUT=$(hd pane get "$PM"); E=$?; show "pane get $PM (the old ID) from outside (exit $E)" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-220)"
OUT=$(hd pane list); show "pane list: panes with terminal $TM" "$(echo "$OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print([p['pane_id'] for p in d['result']['panes'] if p['terminal_id']=='$TM'])" 2>&1)"

echo "== 6. stop the scratch server"
show "server stop" "$(hd server stop | tr '\n' ' ' | cut -c1-120)"
for _ in $(seq 1 60); do [ -d /proc/$SPID ] || break; sleep 0.05; done
[ -d /proc/$SPID ] && { kill -TERM $SPID; sleep 0.5; }
[ -d /proc/$SPID ] && kill -KILL $SPID
for _ in $(seq 1 60); do [ -d /proc/$TPID ] || break; sleep 0.05; done
[ -d /proc/$TPID ] && kill -KILL $TPID
show "server pid $SPID running" "$([ -d /proc/$SPID ] && echo yes || echo no)"
show "strace pid $TPID running" "$([ -d /proc/$TPID ] && echo yes || echo no)"
show "paths under /home in the full trace" "[$(grep -oE '"/home/[^"]*"' $LOG/h1-strace.log | tr -d '"' | sort -u | tr '\n' ' ')]"
show "inet connect calls in the full trace" "$(grep -cE 'connect\([0-9]+, \{sa_family=AF_INET' $LOG/h1-strace.log)"
left=""
for p in $(ps -u "$(id -u)" -o pid=); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx "HOME=$H" && left="$left $p"; done
show "processes with the scratch Herdr HOME" "[${left# }]"
ls -la --time-style=full-iso ~/.config/herdr | diff $LOG/h1-real-before.txt - > /dev/null && show "real ~/.config/herdr" "unchanged" || show "real ~/.config/herdr" "CHANGED"
```

### h2_herdr_restart.sh

h2 (8.6). Path: `/tmp/aosd3/scripts/h2_herdr_restart.sh`.

```bash
#!/usr/bin/env bash
# h2 (B-2): Herdr 0.8.0 across a server restart, on an ISOLATED scratch server (same isolation check
# as h1: strace record of the whole server run, sockets under /tmp/aosd3 only, no inet connect).
#  1. status server --json: which incarnation fields does the server report?
#  2. two workspaces, one with a second pane; record IDs and terminal IDs; stop the server.
#  3. start a new server with the same scratch HOME: which workspaces and panes come back, with which
#     IDs and terminal IDs? Does a new workspace continue the ID count or start again at w1?
#  4. the pane move form (h1 used an invalid form, exit 2).
set -uo pipefail
H=/tmp/aosd3/herdrhome
BIN=/tmp/aosd3/herdrbin/herdr   # a byte-identical copy of ~/.local/bin/herdr (0.8.0)
LOG=/tmp/aosd3/logs
PIDLOG=$LOG/pids.txt
HE=(env -i HOME=$H XDG_CONFIG_HOME=$H/.config XDG_DATA_HOME=$H/.local/share XDG_STATE_HOME=$H/.local/state
    XDG_RUNTIME_DIR=$H/run PATH=/usr/bin:/bin LANG=C.UTF-8 TERM=xterm-256color SHELL=/bin/sh)
hd() { timeout 10 "${HE[@]}" "$BIN" "$@" </dev/null 2>&1; }
j() { python3 -c "import json,sys
try: d=json.loads(sys.stdin.read())
except Exception as e: print('NOT-JSON'); sys.exit()
cur=d
for k in sys.argv[1].split('.'):
    cur = cur.get(k) if isinstance(cur, dict) else None
print(cur if not isinstance(cur,(dict,list)) else json.dumps(cur))" "$1"; }
show() { printf '  %-58s %s\n' "$1" "$2"; }
panes() { hd pane list | python3 -c "import json,sys
d=json.load(sys.stdin); print(sorted((p['pane_id'],p['terminal_id']) for p in d['result']['panes']))" 2>&1; }
start_server() { # $1 = label; sets TPID SPID; aborts unless isolated
  rm -f $H/.config/herdr/herdr.sock $LOG/h2-strace-$1.*
  setsid "${HE[@]}" /usr/bin/strace -ff -qq -e trace=%file,connect,bind -o $LOG/h2-strace-$1 "$BIN" server > $LOG/h2-server-$1.log 2>&1 < /dev/null &
  TPID=$!; echo "$(date +%T.%N | cut -c1-12) strace of herdr server ($1) pid=$TPID" >> $PIDLOG
  for _ in $(seq 1 100); do [ -S $H/.config/herdr/herdr.sock ] && break; sleep 0.05; done
  SPID=$(ps -o pid= --ppid $TPID | tr -d ' ' | head -1); echo "$(date +%T.%N | cut -c1-12) herdr server ($1) pid=$SPID" >> $PIDLOG
  local outside inet socks
  cat $LOG/h2-strace-$1.[0-9]* > $LOG/h2-strace-$1.all
  # A path outside the scratch root and the system dirs is allowed only if every call on it got ENOENT
  # (the restored server looks for a git repository above the workspace directory: /tmp/.git, /.git).
  outside=$(grep -oE '"/[^"]*"' $LOG/h2-strace-$1.all | tr -d '"' | sort -u | grep -vE '^/(tmp|tmp/aosd3|tmp/aosd3/.*|proc/.*|sys/.*|dev/.*|etc/.*|usr/.*|lib.*|bin/.*)$' |
    while read -r path; do grep -F "\"$path\"" $LOG/h2-strace-$1.all | grep -qv 'ENOENT' && echo "$path"; done)
  enoent=$(grep -oE '"/[^"]*"' $LOG/h2-strace-$1.all | tr -d '"' | sort -u | grep -vE '^/(tmp|tmp/aosd3|tmp/aosd3/.*|proc/.*|sys/.*|dev/.*|etc/.*|usr/.*|lib.*|bin/.*)$' | tr '\n' ' ')
  show "server $1: outside paths with only ENOENT answers" "[$enoent]"
  inet=$(grep -cE 'connect\([0-9]+, \{sa_family=AF_INET' $LOG/h2-strace-$1.all)
  socks=$(ss -xlpn 2>/dev/null | awk -v p="pid=$SPID," 'index($0,p){print $5}' | sort -u)
  show "server $1: pid, sockets, outside paths, inet" "$SPID, [$(echo $socks)], [$(echo $outside)], $inet"
  if [ -n "$outside" ] || [ "$inet" != 0 ] || [ -z "$socks" ] || [ "$socks" != "$H/.config/herdr/herdr.sock" ]; then
    echo "ISOLATION NOT SHOWN: abort"; kill -TERM $SPID; sleep 0.5; kill -KILL $SPID $TPID 2>/dev/null; exit 1; fi
}
stop_server() {
  show "server stop" "$(hd server stop | tr '\n' ' ' | cut -c1-100)"
  for _ in $(seq 1 60); do [ -d /proc/$SPID ] || break; sleep 0.05; done
  [ -d /proc/$SPID ] && { kill -TERM $SPID; sleep 0.5; }; [ -d /proc/$SPID ] && kill -KILL $SPID
  for _ in $(seq 1 60); do [ -d /proc/$TPID ] || break; sleep 0.05; done; [ -d /proc/$TPID ] && kill -KILL $TPID
  show "server $SPID and strace $TPID still run" "$([ -d /proc/$SPID ] && echo yes || echo no) $([ -d /proc/$TPID ] && echo yes || echo no)"
}
ls -la --time-style=full-iso ~/.config/herdr > $LOG/h2-real-before.txt
rm -f $H/.config/herdr/session.json   # start from no saved session

echo "== 1. incarnation fields"
start_server A
show "status server --json" "$(hd status server --json | tr '\n' ' ' | cut -c1-400)"
show "server A start ticks (raw stat field 22)" "$(sed -E 's/^.*\) //' /proc/$SPID/stat | cut -d' ' -f20)"

echo "== 2. two workspaces, then stop"
OUT=$(hd workspace create --cwd $H/ws --label h2a --no-focus); WA=$(echo "$OUT" | j result.workspace.workspace_id); PA=$(echo "$OUT" | j result.root_pane.pane_id)
OUT=$(hd pane split "$PA" --direction right --no-focus); PA2=$(echo "$OUT" | j result.pane.pane_id)
OUT=$(hd workspace create --cwd $H/ws --label h2b --no-focus); WB=$(echo "$OUT" | j result.workspace.workspace_id)
show "workspaces" "$WA (panes $PA $PA2), $WB"
show "panes before the stop" "$(panes)"
stop_server
show "saved session file" "$(ls -la $H/.config/herdr/session.json 2>&1 | cut -c1-100)"

echo "== 3. restart with the same scratch HOME"
start_server B
show "status server --json" "$(hd status server --json | tr '\n' ' ' | cut -c1-400)"
show "workspaces after the restart" "$(hd workspace list | python3 -c "import json,sys; d=json.load(sys.stdin); print([(w['workspace_id'],w['label']) for w in d['result']['workspaces']])" 2>&1)"
show "panes after the restart" "$(panes)"
OUT=$(hd workspace create --cwd $H/ws --label h2c --no-focus); show "a new workspace after the restart" "$(echo "$OUT" | j result.workspace.workspace_id) root $(echo "$OUT" | j result.root_pane.pane_id) terminal $(echo "$OUT" | j result.root_pane.terminal_id)"
OUT=$(hd pane get "$PA2"); E=$?; show "pane get $PA2 (a pane of the old run), exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-160)"

echo "== 4. pane move forms"
OUT=$(hd workspace create --cwd $H/ws --label h2m --no-focus); WM=$(echo "$OUT" | j result.workspace.workspace_id); PMR=$(echo "$OUT" | j result.root_pane.pane_id)
OUT=$(hd pane split "$PMR" --direction right --no-focus); PM=$(echo "$OUT" | j result.pane.pane_id); TM=$(echo "$OUT" | j result.pane.terminal_id)
OUT=$(hd pane move "$PM" --workspace "$WM" --no-focus); show "pane move --workspace --no-focus: exit $?" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-200)"
OUT=$(hd pane move "$PM" --new-workspace --no-focus); E=$?; show "pane move $PM --new-workspace: exit $E" "new $(echo "$OUT" | j result.move_result.pane.pane_id) previous $(echo "$OUT" | j result.move_result.previous_pane_id) terminal $(echo "$OUT" | j result.move_result.pane.terminal_id)"
OUT=$(hd pane get "$PM"); E=$?; show "pane get $PM (the old ID) from outside, exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-160)"
OUT=$(hd pane close "$PM"); E=$?; show "pane close $PM (the old ID) from outside, exit $E" "$(echo "$OUT" | tr '\n' ' ' | cut -c1-160)"
show "panes with terminal $TM" "$(hd pane list | python3 -c "import json,sys; d=json.load(sys.stdin); print([p['pane_id'] for p in d['result']['panes'] if p['terminal_id']=='$TM'])" 2>&1)"
stop_server
show "paths under /home in both traces" "[$(cat $LOG/h2-strace-A.[0-9]* $LOG/h2-strace-B.[0-9]* | grep -oE '"/home/[^"]*"' | tr -d '"' | sort -u | tr '\n' ' ')]"
left=""; for p in $(ps -u "$(id -u)" -o pid=); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -qx "HOME=$H" && left="$left $p"; done 2>/dev/null
show "processes with the scratch Herdr HOME" "[${left# }]"
ls -la --time-style=full-iso ~/.config/herdr | diff $LOG/h2-real-before.txt - > /dev/null && show "real ~/.config/herdr" "unchanged" || show "real ~/.config/herdr" "CHANGED"
```

### h3_herdr_one_connection.py

h3 (8.7). Path: `/tmp/aosd3/scripts/h3_herdr_one_connection.py`.

```python
#!/usr/bin/env python3
# h3 (B-2): Herdr 0.8.0 socket API on ONE connection, on an ISOLATED scratch server only.
# Run: python3 -I /tmp/aosd3/scripts/h3_herdr_one_connection.py
# Isolation: the same check as h2 (strace -ff record of the whole server run; listening socket under
# /tmp/aosd3 only (herdr.sock and herdr-client.sock); any path outside the scratch root and the system dirs must have only ENOENT answers;
# no AF_INET connect), done before the first client request of each server run.
#  1. framing: one JSON request per line, one JSON answer per line? SO_PEERCRED of the connection.
#     (measured: one answer per connection, then the server closes it)
#  2. a close bound to the server process of the get: get on connection 1; connection 2 is used for
#     the close only if its SO_PEERCRED process (pid, raw start ticks, boot ID) equals that of
#     connection 1, read after connect and BEFORE the close is sent; then get on connection 3.
#  3. a server restart (the saved session restores the same pane IDs) between the get and the close.
#  4. pane.close of the last pane of a workspace: does the workspace close too?
import glob, json, os, re, signal, socket, struct, subprocess, sys, time

H = "/tmp/aosd3/herdrhome"
BIN = "/tmp/aosd3/herdrbin/herdr"  # a byte-identical copy of ~/.local/bin/herdr (0.8.0)
LOG = "/tmp/aosd3/logs"
SOCK = f"{H}/.config/herdr/herdr.sock"
ENV = {"HOME": H, "XDG_CONFIG_HOME": f"{H}/.config", "XDG_DATA_HOME": f"{H}/.local/share",
       "XDG_STATE_HOME": f"{H}/.local/state", "XDG_RUNTIME_DIR": f"{H}/run", "PATH": "/usr/bin:/bin",
       "LANG": "C.UTF-8", "TERM": "xterm-256color", "SHELL": "/bin/sh"}
SYSTEM = re.compile(r"^/(tmp|tmp/aosd3|tmp/aosd3/.*|proc/.*|sys/.*|dev/.*|etc/.*|usr/.*|lib.*|bin/.*)$")
started = []


def show(label, value):
    print(f"  {label:<58} {value}", flush=True)


def logpid(what, pid):
    with open(f"{LOG}/pids.txt", "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {what} pid={pid}\n")


def start_server(label):
    for f in glob.glob(f"{LOG}/h3-strace-{label}.*"):
        os.unlink(f)
    if os.path.exists(SOCK):
        os.unlink(SOCK)  # our own stale socket of an earlier scratch run
    tracer = subprocess.Popen(["/usr/bin/strace", "-ff", "-qq", "-e", "trace=%file,connect,bind", "-o",
                               f"{LOG}/h3-strace-{label}", BIN, "server"], env=ENV, stdin=subprocess.DEVNULL,
                              stdout=open(f"{LOG}/h3-server-{label}.log", "w"), stderr=subprocess.STDOUT,
                              start_new_session=True)
    logpid(f"strace of herdr server ({label})", tracer.pid)
    for _ in range(100):
        if os.path.exists(SOCK):
            break
        time.sleep(0.05)
    time.sleep(0.2)
    kids = subprocess.run(["ps", "-o", "pid=", "--ppid", str(tracer.pid)], capture_output=True, text=True).stdout.split()
    spid = int(kids[0])
    logpid(f"herdr server ({label})", spid)
    started.append((tracer, spid))
    trace = "".join(open(f).read() for f in glob.glob(f"{LOG}/h3-strace-{label}.[0-9]*"))
    paths = sorted(set(re.findall(r'"(/[^"]*)"', trace)))
    outside = [p for p in paths if not SYSTEM.match(p)]
    bad = [p for p in outside if any("ENOENT" not in line for line in trace.splitlines() if f'"{p}"' in line)]
    inet = len(re.findall(r"connect\(\d+, \{sa_family=AF_INET", trace))
    ss = subprocess.run(["ss", "-xlpn"], capture_output=True, text=True).stdout
    socks = sorted({l.split()[4] for l in ss.splitlines() if f"pid={spid}," in l})
    show(f"server {label}: pid, sockets", f"{spid}, {socks}")
    show(f"server {label}: outside paths (ENOENT only), bad, inet", f"{outside}, {bad}, {inet}")
    if bad or inet or SOCK not in socks or any(not x.startswith("/tmp/aosd3/") for x in socks):
        print("ISOLATION NOT SHOWN: abort")
        stop_all()
        sys.exit(1)
    return spid


def stop_server(tracer, spid):
    for p in (spid, tracer.pid):
        for _ in range(60):
            if not os.path.exists(f"/proc/{p}"):
                break
            time.sleep(0.05)
        if os.path.exists(f"/proc/{p}"):
            os.kill(p, signal.SIGKILL)
    tracer.wait(timeout=5)


def stop_all():
    for tracer, spid in started:
        for p in (spid, tracer.pid):
            if os.path.exists(f"/proc/{p}"):
                try:
                    os.kill(p, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        try:
            tracer.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    time.sleep(0.2)


class Conn:
    def __init__(self):
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.settimeout(5)
        self.s.connect(SOCK)
        pid, uid, gid = struct.unpack("3i", self.s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        self.peer = pid
        self.buf = b""
        self.n = 0

    def call(self, method, params=None):
        self.n += 1
        req = {"id": f"aosd3:{self.n}", "method": method, "params": params or {}}
        try:
            self.s.sendall(json.dumps(req).encode() + b"\n")
            while b"\n" not in self.buf:
                chunk = self.s.recv(65536)
                if not chunk:
                    return {"transport": "EOF"}
                self.buf += chunk
        except OSError as e:
            return {"transport": type(e).__name__ + ": " + str(e)}
        line, self.buf = self.buf.split(b"\n", 1)
        return json.loads(line)


def short(answer):
    if "error" in answer:
        return f"error {answer['error'].get('code')}"
    if "transport" in answer:
        return f"transport {answer['transport']}"
    r = answer.get("result", {})
    if r.get("type") == "pane_info":
        p = r["pane"]
        return f"pane {p['pane_id']} terminal {p['terminal_id']} workspace {p['workspace_id']}"
    return json.dumps(r)[:160]


def cli(*args):
    out = subprocess.run([BIN, *args], env=ENV, capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL)
    text = (out.stdout or out.stderr).strip()
    return json.loads(text) if text else {"exit": out.returncode, "output": ""}


real_before = subprocess.run(["ls", "-la", "--time-style=full-iso", os.path.expanduser("~/.config/herdr")],
                             capture_output=True, text=True).stdout
if os.path.exists(f"{H}/.config/herdr/session.json"):
    os.unlink(f"{H}/.config/herdr/session.json")  # our own saved session of an earlier scratch run
try:
    print("== 1. framing and peer identity")
    spid = start_server("A")
    a = Conn()
    show("SO_PEERCRED pid of the connection", f"{a.peer} (server {spid})")
    show("ping", short(a.call("ping")))
    show("a second ping at once on the same connection", short(a.call("ping")))
    c = Conn()
    raw = json.dumps({"id": "aosd3:p1", "method": "ping", "params": {}}).encode() + b"\n" + \
        json.dumps({"id": "aosd3:p2", "method": "ping", "params": {}}).encode() + b"\n"
    c.s.sendall(raw)
    got = b""
    try:
        while True:
            chunk = c.s.recv(65536)
            if not chunk:
                break
            got += chunk
    except OSError as e:
        got += f"[{type(e).__name__}]".encode()
    show("two pings in one write: answers before EOF", str(got.count(b'"pong"')) + " " + repr(got[-60:]))
    ws = cli("workspace", "create", "--cwd", f"{H}/ws", "--label", "h3a", "--no-focus")["result"]
    root = ws["root_pane"]
    sib = cli("pane", "split", root["pane_id"], "--direction", "right", "--no-focus")["result"]["pane"]
    ws2 = cli("workspace", "create", "--cwd", f"{H}/ws", "--label", "h3b", "--no-focus")["result"]
    keep = ws2["root_pane"]
    show("panes", f"{root['pane_id']} {root['terminal_id']}, {sib['pane_id']} {sib['terminal_id']}, {keep['pane_id']} {keep['terminal_id']}")
    t = int(sib["terminal_id"][5:-1], 16)
    show("terminal ID without its last digit, as microseconds", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(t / 1e6)) + f" (now {time.strftime('%H:%M:%S UTC', time.gmtime())})")

    def incarnation(pid):
        try:
            ticks = open(f"/proc/{pid}/stat").read().rsplit(") ", 1)[1].split()[19]
        except OSError:
            return None
        return (pid, ticks, open("/proc/sys/kernel/random/boot_id").read().strip())

    def bound_close(pane_id, terminal_id):
        """get on one connection; close on a second connection only if its peer is the same server
        process (pid, start ticks, boot ID) and the terminal matched; then get on a third."""
        c1 = Conn(); p1 = incarnation(c1.peer); g = c1.call("pane.get", {"pane_id": pane_id})
        if "error" in g:
            return f"get: {short(g)} (peer {p1[0]}) -> absent on this server run"
        if g["result"]["pane"]["terminal_id"] != terminal_id:
            return f"get: {short(g)} -> other-launch, no close"
        c2 = Conn(); p2 = incarnation(c2.peer)
        if p2 != p1:
            return f"get on peer {p1[:2]}; close connection peer {p2[:2] if p2 else None} differs -> unknown, no close sent"
        r = c2.call("pane.close", {"pane_id": pane_id})
        c3 = Conn(); p3 = incarnation(c3.peer); after = c3.call("pane.get", {"pane_id": pane_id})
        return f"close on peer {p2[0]}: {short(r)}; get on peer {p3[0] if p3 else None}: {short(after)}"

    print("== 2. a close bound to the server process of the get")
    show(f"bound close of {sib['pane_id']} (own terminal)", bound_close(sib["pane_id"], sib["terminal_id"]))
    show(f"bound close of {sib['pane_id']} again", bound_close(sib["pane_id"], sib["terminal_id"]))
    show(f"bound close of {keep['pane_id']} with a wrong terminal", bound_close(keep["pane_id"], "term_0000000000000"))

    node = subprocess.run(["/tmp/aosd3/nodebin/node", "/tmp/aosd3/scripts/h4_node_peer.mjs", SOCK], env=ENV,
                          capture_output=True, text=True, timeout=10)
    show("h4: a Node client finds its peer process", (node.stdout or node.stderr).strip()[:600] + f" (server {spid})")

    print("== 3. a server restart between the get and the close")
    c1 = Conn(); p1 = incarnation(c1.peer); g = c1.call("pane.get", {"pane_id": keep["pane_id"]})
    show(f"get {keep['pane_id']} on server A", f"{short(g)} (peer {p1[:2]})")
    tracer, _ = started[-1]
    show("server stop (CLI)", json.dumps(cli("server", "stop"))[:100])
    stop_server(tracer, spid)
    show(f"server A {spid} still runs", str(os.path.exists(f"/proc/{spid}")))
    spid_b = start_server("B")
    c2 = Conn(); p2 = incarnation(c2.peer)
    show("close connection: peer", f"{p2[:2]}; equal to the get's peer: {p2 == p1} -> " + ("close" if p2 == p1 else "unknown, no close sent"))
    c3 = Conn(); show(f"get {keep['pane_id']} on server B", short(c3.call("pane.get", {"pane_id": keep["pane_id"]})))
    c4 = Conn(); show(f"get {root['pane_id']} on server B (restored root of h3a)", short(c4.call("pane.get", {"pane_id": root["pane_id"]})))
    c5 = Conn(); show(f"get {sib['pane_id']} on server B (closed before the stop)", short(c5.call("pane.get", {"pane_id": sib["pane_id"]})))

    print("== 4. close of the last pane of a workspace")
    wsid = ws2["workspace"]["workspace_id"]
    c6 = Conn(); show(f"pane.close {keep['pane_id']} (the only pane of {wsid})", short(c6.call("pane.close", {"pane_id": keep["pane_id"]})))
    time.sleep(0.3)
    c7 = Conn(); show(f"workspace.get {wsid}", short(c7.call("workspace.get", {"workspace_id": wsid})))
    c8 = Conn(); show("workspace.list", json.dumps([(w["workspace_id"], w["label"], w["pane_count"]) for w in c8.call("workspace.list")["result"]["workspaces"]]))
    show("server stop (CLI)", json.dumps(cli("server", "stop"))[:100])
    stop_server(started[-1][0], spid_b)
finally:
    stop_all()
    left = [p for p in os.listdir("/proc") if p.isdigit() and any(p == str(x) for t, s in started for x in (s, t.pid))]
    show("started PIDs still present", str(left))
    real_after = subprocess.run(["ls", "-la", "--time-style=full-iso", os.path.expanduser("~/.config/herdr")],
                                capture_output=True, text=True).stdout
    show("real ~/.config/herdr", "unchanged" if real_after == real_before else "CHANGED")
    home = sorted(set(m for f in glob.glob(f"{LOG}/h3-strace-*.[0-9]*") for m in re.findall(r'"(/home/[^"]*)"', open(f).read())))
    show("paths under /home in the traces", str(home))
```

### h4_node_peer.mjs

h4 (8.7), run by h3. Path: `/tmp/aosd3/scripts/h4_node_peer.mjs`.

```js
// h4 (B-2): can a Node client find the server process of its OWN Herdr API connection before it
// sends a request? Node has no SO_PEERCRED API. This reads the inode of the client socket from
// /proc/self/fd/<fd>, then the peer inode and its process from `ss -xpn`. Run by h3 while the
// scratch server runs: node h4_node_peer.mjs <socket path>
import { connect } from "node:net";
import { readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
const path = process.argv[2];
const s = connect(path);
s.on("connect", () => {
  const out = { hasGetsockopt: typeof s._handle?.getsockopt, fd: s._handle?.fd };
  const own = readlinkSync(`/proc/self/fd/${s._handle.fd}`).match(/socket:\[(\d+)\]/)?.[1];
  out.ownInode = own;
  const ss = execFileSync("ss", ["-xpn"], { encoding: "utf8" }).split("\n");
  // ss -x columns: Netid State Recv-Q Send-Q Local-Address Port Peer-Address Port Process
  const mine = ss.find((l) => l.split(/\s+/)[5] === own);
  out.ownRow = mine?.replace(/\s+/g, " ");
  const peer = mine?.split(/\s+/)[7];
  const peerRow = ss.find((l) => l.split(/\s+/)[5] === peer);
  out.peerRow = peerRow?.replace(/\s+/g, " ");
  out.peerPid = peerRow?.match(/pid=(\d+)/)?.[1];
  s.write(JSON.stringify({ id: "aosd3:node", method: "ping", params: {} }) + "\n");
  s.once("data", (d) => { out.answer = String(d).slice(0, 40); console.log(JSON.stringify(out)); s.destroy(); });
});
```

### descendant.mjs

rv (8.9): the review's script, paths and names changed to aosd3. Path: `/tmp/aosd3/review/descendant.mjs`.

```js
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {existsSync,writeFileSync,appendFileSync,readFileSync,unlinkSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosd3/review/';
const name='\0aosd3-r-descendant';
async function bind(){return new Promise((resolve,reject)=>{const s=createServer();s.once('error',e=>e.code==='EADDRINUSE'?resolve(null):reject(e));s.listen({path:name,exclusive:true},()=>resolve(s));});}
function logpid(p){appendFileSync(root+'pids',`${p}\n`);}
if(process.argv[2]==='grandchild'){
  writeFileSync(root+'grandchild-ready',String(process.pid));
  while(!existsSync(root+'release-grandchild'))await sleep(5);
  unlinkSync(root+'replacement');writeFileSync(root+'grandchild-done','yes');
}else if(process.argv[2]==='child'){
  const child=spawn(process.execPath,[import.meta.filename,'grandchild'],{stdio:'ignore'});logpid(child.pid);child.unref();
  while(!existsSync(root+'grandchild-ready'))await sleep(5);
  writeFileSync(root+'child-ready',String(process.pid));
  // Normal Node spawn did not pass fd 3 onwards. Its parent exits normally.
}else if(process.argv[2]==='holder'){
  const lock=await bind();const child=spawn(process.execPath,[import.meta.filename,'child'],{stdio:['ignore','ignore','ignore',lock._handle.fd]});logpid(child.pid);
  await new Promise(r=>child.once('exit',r));writeFileSync(root+'holder-ready',String(process.pid));
  setInterval(()=>{},1000);
}else{
  const holder=spawn(process.execPath,[import.meta.filename,'holder'],{stdio:'inherit'});logpid(holder.pid);
  try{
    while(!existsSync(root+'holder-ready'))await sleep(5);
    holder.kill('SIGKILL');await new Promise(r=>holder.once('exit',r));
    const lock=await bind();const grandchild=Number(readFileSync(root+'grandchild-ready','utf8'));
    console.log(JSON.stringify({holder:holder.pid,child:Number(readFileSync(root+'child-ready','utf8')),grandchild,contenderAcquired:!!lock,grandchildStillRuns:existsSync(`/proc/${grandchild}`)}));
    writeFileSync(root+'replacement','new operation owns this');writeFileSync(root+'release-grandchild','go');
    while(!existsSync(root+'grandchild-done'))await sleep(5);
    console.log(JSON.stringify({replacementSurvives:existsSync(root+'replacement')}));lock?.close();
    try{process.kill(grandchild,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
  }finally{holder.kill('SIGKILL');}
}
```

### protocols.mjs

rv (8.9): the review's script, paths and names changed to aosd3. Path: `/tmp/aosd3/review/protocols.mjs`.

```js
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,readFileSync,appendFileSync,unlinkSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const root='/tmp/aosd3/review/protocols';mkdirSync(root,{recursive:true});
const lockName='\0aosd3-r-shared-store-S';
async function lock(){return new Promise((r,j)=>{const s=createServer();s.once('error',j);s.listen({path:lockName,exclusive:true},()=>r(s));});}
async function close(s){await new Promise(r=>s.close(r));}
if(process.argv[2]==='reuse'){
 const s=await lock();const seesLocalQuarantine=existsSync(root+'/project-B/quarantine-S');
 const seesOtherProjectQuarantine=existsSync(root+'/project-A/quarantine-S');
 if(!seesLocalQuarantine&&existsSync(root+'/session-S'))writeFileSync(root+'/project-B/claim-S','S');
 await close(s);console.log(JSON.stringify({seesLocalQuarantine,seesOtherProjectQuarantine,reused:existsSync(root+'/project-B/claim-S')}));
}else{
 mkdirSync(root+'/project-A',{recursive:true});mkdirSync(root+'/project-B',{recursive:true});
 writeFileSync(root+'/session-S','continuity data');
 const s=await lock();writeFileSync(root+'/project-A/quarantine-S','request completion unknown');await close(s);
 // The API client's unknown completion released the lock, but remote work can still complete.
 const reuse=spawn(process.execPath,[import.meta.filename,'reuse'],{stdio:['ignore','pipe','inherit']});appendFileSync('/tmp/aosd3/review/pids',`${reuse.pid}\n`);
 let out='';reuse.stdout.on('data',d=>out+=d);await new Promise(r=>reuse.once('exit',r));process.stdout.write(out);
 unlinkSync(root+'/session-S');console.log(JSON.stringify({lateRequestCompleted:true,claimStillNamesS:existsSync(root+'/project-B/claim-S'),SExists:existsSync(root+'/session-S'),sameProjectReuseWouldRefuse:existsSync(root+'/project-A/quarantine-S')}));
 // Herdr stand-in: replacement occurs after pane get answered, before positional close.
 let pane={terminal:'term_A',open:true};const recorded='term_A';
 const observed={...pane};await sleep(0);pane={terminal:'term_B',open:true};
 let result='other-launch';if(observed.terminal===recorded){pane.open=false;result='destroyed';}
 console.log(JSON.stringify({herdrObserved:observed.terminal,closedTerminal:pane.terminal,replacementOpen:pane.open,stopOutcome:result}));
}
```

### vt.sh

the test wrapper: one package's local vitest under the test rules. Path: `/tmp/aosd3/scripts/vt.sh`.

```bash
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd3
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
```

### redcount.sh

the red counts (8.10, 13.6). Path: `/tmp/aosd3/scripts/redcount.sh`.

```bash
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd3/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd3/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd3/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
  python3 - "$f" "$json" >> "$OUT" <<'PY'
import json, re, sys, collections
f, path = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(path))
except Exception as e:
    print(f"{f}: no JSON ({e})"); sys.exit()
c = collections.Counter()
for tr in d["testResults"]:
    for a in tr["assertionResults"]:
        full = " ".join(a.get("ancestorTitles", []) + [a["title"]])
        m = re.search(r"\[same-id (R\d)\]", full)
        tag = m.group(1) if m else "untagged"
        c[(tag, a["status"])] += 1
rows = sorted(set(t for t, _ in c))
print(f + ": " + ", ".join(f"{t} {c[(t,'failed')]} failed/{c[(t,'passed')]} passed" + (f"/{c[(t,'skipped')]+c[(t,'pending')]} skipped" if c[(t,'skipped')]+c[(t,'pending')] else "") for t in rows))
PY
done
cat "$OUT"
```

### tmux

the tmux shim of the full runs. Path: `/tmp/aosd3/bintest/tmux`.

```sh
#!/bin/sh
exec /usr/bin/tmux -L aosd3-T "$@"
```
