# Same-ID design, revision r7: RW and R2b-2 after the round-6 re-check (ao-52)

Base `c8751762`; tests in `c8751762..fe5d6575` (2 commits, test files only). Input: the round-6 re-check by
ao-51 (`main:development/reviews/same_id_design_review_r6_astra6.md`, "the review": RW NOT-SOUND, R2b-2
SOUND-WITH-CHANGES; B-1, M-1, M-2). Owner decisions of 2026-10-22: OD-26 (a), OD-27 (b), OD-28 (b). Decided
earlier: OD-2 to OD-25, the stopped-fleet barrier (1b), OD-25 (a). Scope: RW and R2b-2. R2b-1, R4, R3a, R3b, RH
and RO keep their text and results.

This file is written for a reviewer who has not read r1 to r6. Sections 1 to 8 state RW and R2b-2 in full. A
citation such as "r5 3.3" (design r5, section 3.3) points to text that r7 keeps without a change; the design
files are `development/reviews/same_id_design_r{4,5,6}_opus.md` on `main`.

Scratch root `/tmp/aosd7`, marker `/tmp/aosd7-marker`. No `ao` command, no `opencode`, no Herdr, no network, no
real record, no write to the real `~/.ao/bin` (9.1).

## 0. Response table

| Item | Decision | Section | Test (file, kind) |
| --- | --- | --- | --- |
| **B-1** (1) a tmux server with another `TMUX_TMPDIR` and `-L` | Accepted. P2 finds every tmux server process of the uid (comm `tmux: server`), maps it to its listening Unix socket by its descriptor links and `/proc/<pid>/net/unix`, and queries it there; the answer must name that PID. A server that no path reaches is P2u and blocks. The socket directory and `-S` argv are not the source any more. | 2.2 | core r7 `(RW) B-1`: 2 defects (another `TMUX_TMPDIR`, automatic discovery; a removed socket), 1 control (no AO session: no block) |
| **B-1** (2) a deleted executable | Accepted. P3 removes the kernel's ` (deleted)` suffix before the basename test, and also matches comm `node-MainThread` (a renamed node binary keeps it, m1). An unreadable exe is P3u and blocks (OD-27 (b)). | 2.2 | core r7: 1 defect |
| **B-1** unknown project or state root | Accepted. P1 blocks on ANY `AO_*` key, whatever root it names; P2 blocks on ANY session name of the AO form. The covered roots only say where the record step and the fence act. A covered root that cannot be read blocks. | 2.2, 2.3 | core r7: 1 defect |
| **B-1** the temporal statement; allows checked at use | Accepted. A check reads the process list until a read finds no new live process (fixed point). It validates a quiescent fleet and cannot make one: the operating rule holds from the stop through both checks to the standing check. Each allow is exact (PID, start ticks, rule) and is checked again at each check and at admission. | 2.2, 2.4 | core r7: 1 defect (a runtime born after the last read of a check), 2 controls (other start ticks; an exact allow) |
| **B-1** allows scoped to one rule | Accepted. `--allow <pid>:<start ticks>:<rule>`; only P1u, P2u, P3 and P3u can be allowed; P1, P2 and P4 never. | 2.2 | core r7: 1 defect (a P3 allow does not cover P1) |
| **OD-27 (b)** | Decided. An unreadable environment (P1u) or exe (P3u) blocks unless allowed; the list shows PID, start ticks, comm, the parent's comm and the error code, never a value. | 2.2 | core r7: 1 defect (a non-dumpable process with `AO_*` keys) |
| **M-1** cleanup after an exception | Accepted. Step 5 of the launch transaction tells a definite refusal (the write returned "no") from an exception (outcome unknown). After an exception it re-reads the record in the same hold: it names L: keep the file, the launch began; absent or another launch: remove the file; the read fails: keep the file, refuse "unknown". | 3.2 | core r7 `(RW) M-1`: 3 defects (after the link, in the temporary cleanup, during the re-read), 1 control (before the link) |
| **M-2** the inbox archive beside the record archive | Accepted, with the location the review offers as the alternative: the inbox archive goes to `.inbox-archive/<id>_<ts>/`, outside the record namespace, so no reader of `archive/` changes. `<ts>` is `max(now, last + 1 ms)` per ID, so two archives never share a name. `deleteMetadata` takes the name. | 3.4 | core r7 `(RW) M-2`: 4 defects (lookup, update, restore, two archives in one millisecond with exact names), 1 control (a pre-RW intent); core r6 changed (10.3) |
| **M-2** RW and R4 | RW owns the layout, the name rule and the recovery; R4 owns the strictness of the readers. With the r7 layout they touch different lines and can land in either order. | 3.7, 7 | as M-2 |
| `ao stop` in the runbook | Accepted. `ao stop` is not a step: it archives the orchestrator (`sm.kill`) before it stops the worker. The worker of each root stops first by its exact PID, then every session (the orchestrator too) by its runtime's own stop; after admission every session is restored before `ao start`. | 2.1 | none (a runbook; source lines in 2.1) |
| the budgeted publish of the crash walk | Accepted. One record write: the launch fields, the values of the complete records read within the budget, `published` and their cursor. The unread rest is backlog. The budget keeps the hold under the lock wait of other processes. | 3.3 | core r7: 1 defect (one write, generation +1) |
| the stronger test oracles (review, last table) | Competitor outcomes: 2 controls (core r7). Identity of the held command: tmux r7 control. Exact archive names and readback: core r7 M-2 and the changed core r6 barrier test. Faults before and after commit: core r7 M-1. Automatic socket discovery: core r7 B-1 (no socket is passed). Wrong start ticks: core r7 control. Every production mutation path: RW and R2b-2 acceptance lists (7). | 10 | as listed |
| **OD-28 (b)** | Decided. R2b-2 fences a creation NAME on a running server: a server option per name, compared with the server PID and start time inside the create command; every holder fences the name before its record write. | 5.3 | tmux r7 `(R2b-2)`: 2 defects (a held create after the next holder's fence; a held create after a server restart), 2 controls |
| **OD-28 (b)** no server runs | A named residual until R3a: a create that has to start the server is not fenced; its late pane runs with no record. Effect and the owner's audit in 5.4. No claim of launch exclusivity in R2b-2. | 5.4 | none (no test may claim it) |
| **OD-26 (a)** | Decided. The RW round changes the core r4 `:262` oracle to a refusal while the old writer lives and an admission after it ends, and keeps the frozen writer, the preservation and PR assertions and the healthy second admission. | 7, 8 | core r4 `:262` (changed in RW) |
| R2b-1 re-inventory | Checked again on `main` `a4cb1470`: the retry Enters of the other-agent loop moved to `send.ts:434` and `:439`; a pane that waits for an answer gets no key (`:417`). | 7 | R2b-1 row |

## 1. The problem, the rounds and the terms

**The problem.** AO keeps one record per session ID: `~/.agent-orchestrator/<hash>-<project>/sessions/<id>`,
`key=value` lines. An ID is reused: a kill archives the record (`sessions/archive/<id>_<ts>`) and a restore or a
spawn makes the next launch of the same ID. Before RW, shell code in the agent's pane writes the record directly:
the PATH wrappers `~/.ao/bin/gh` and `~/.ao/bin/git`, their helper `~/.ao/bin/ao-metadata-helper.sh`, and the
Claude hook `<worktree>/.claude/metadata-updater.sh`. Each copies the record to a temporary file, edits it and
renames it over the record (`mv`). A write of an old launch can then land in the record of a new launch, and two
writers lose each other's change (r3 and r4).

**RW** ("record writers") ends direct pane writes. A launch gets a random launch ID L (32 hex digits) in the
record (`launchId`, `launchState` = `preparing`, `published` or `failed`) and in the pane (`AO_LAUNCH_ID`). The
pane appends framed lines to its launch file `.inbox/<id>/<L>.ndjson`. The applier (the lifecycle worker and
every command that decides on a record) applies, under the record lock, only lines of the launch that the record
names, and keeps a cursor in the record. Because old code still writes records directly, RW needs a barrier that
switches the whole fleet to the new code: the owner stops every AO process (decision 1b), and the barrier checks
that nothing remains before it opens admission.

**R2b-2** serializes the association of a record with its tmux session. A record names its tmux session by a
token that AO sets as the session option `@ao_launch` (r4 3.2). Every transition (associate, resume, abandon,
clear, stop, restore, retire, archive) of an ID runs under the operation lock of that ID (a Linux abstract Unix
socket; the kernel frees it when the holder dies; r5 5.1). Every tmux command that changes a session is a gated
command list: `if-shell -F` compares server PID, session name, session ID, pane PID and the token inside the tmux
server and runs the change only when they match (r4 3.2, 3.3). R2b-2 adds a fence, so that a command of a holder
that died cannot change anything after the next holder started.

**Terms.**

- Record lock: `withRecordLock(dataDir, id, fn)` (`metadata.ts:292`): synchronous, across processes, reentrant
  in one thread; a waiter waits up to 5 s (`RECORD_LOCK_WAIT_MS`, `metadata.ts:116`), then throws. Process death
  releases it.
- I1: no record names a launch whose launch file does not exist.
- A launch file belongs to the record that names it (3.2).
- Archive intent: `archiveIntent=<ts>` in the record: an archive started and must be finished (3.4).
- Managed files: the wrappers, the helper and every hook. The fence (r5 2.2) installs each of them by temporary
  file and rename, so after it an `execve` or `source` of a managed path runs the new text.
- W1 to W4: the shapes of an old writer process (r5 2.3): W1 an interpreter that runs an old managed text, W2 a
  process whose argv names a record or its temporary file, W3 a descriptor on a record, W4 an unknown value.
- Admission: the flag that every mutating command of the new build checks (r4 8.1). Old builds do not check
  it; that is why the fleet must be stopped.

## 2. RW: the stopped-fleet barrier

### 2.1 The owner's procedure (corrected stop order) and its costs

From a terminal that is not an AO pane and has no `AO_*` variable (`env | grep '^AO_'` prints nothing):

1. Write a manifest for every state root under `~/.agent-orchestrator/` (all projects of all configs, not only
   one): each active record (`ls <root>/sessions`), its runtime (tmux socket and session name), its worktree,
   and whether it must come back. Wait until every agent is idle.
2. Stop the lifecycle worker of each state root by its exact PID: read `<root>/lifecycle-worker.pid`, check
   that `/proc/<pid>/cmdline` is `ao lifecycle-worker <project>` and note its start time, `kill -TERM <pid>`,
   and wait until it ends. Do not use `ao stop`: it calls `sm.kill` on the orchestrator (`cli/start.ts:1143` on
   `main`) before it stops the worker (`:1153`). The kill archives the orchestrator record and removes an
   isolated orchestrator workspace (`shouldDestroyWorkspacePath` `session-manager.ts:644`, the removal `:3072`;
   the primary checkout is protected by the project-path check). The worker stops first, so that no lifecycle action (a kill, a cleanup, a restore) runs
   on a session while the panes stop.
3. Stop every session, the orchestrator included, with its runtime's own stop:
   `env -u TMUX tmux -S <socket> kill-session -t =<name>` (Herdr: its own stop). The record and the worktree stay.
   Do not use `ao session kill`: it archives the record and removes the worktree.
4. Stop every other resident AO process (watchers, scripts that import core, an `ao` command that runs) by its
   exact PID.
5. Build and install the new version.
6. Run the barrier of the new build (2.3) from the same terminal, with an `--allow <pid>:<start ticks>:<rule>`
   for each process that the owner allows (2.2). It refuses with a list when a process remains.
7. After admission: restore every session of the manifest, the orchestrator first, with
   `ao session restore <id>`. `restore` reads the live runtime state (`session-manager.ts:4266`) before it
   checks `isRestorable` (`:4269`), so a record whose agent ended while its status says `working` is
   restorable. Each restore runs the transaction of 3.2 and gives the record its first launch ID.
8. Then `ao start <project>`: it finds the restored orchestrator ("Using existing orchestrator session") and
   starts the worker. Do not run `ao start` before the orchestrator is restored: with a dead orchestrator
   runtime it replaces the orchestrator record, archives it only for the strategies `reuse` and `ignore`, and
   deletes it otherwise (`session-manager.ts:2504` to `:2510`), then spawns a new orchestrator.

The orchestrator exception, when the owner uses `ao stop` anyway: the orchestrator record goes to the archive
(through 3.4 under RW) and an isolated orchestrator workspace is removed; `ao session restore <prefix>-orchestrator`
copies the archived record back (3.2, archived restore); the context of the agent continues only where its
plugin has a restore command.

Costs (measured on this host, m6, at 07:58 EDT):

- Every session is down from step 2 to its restore; a turn in progress is lost unless the agent was idle; each
  agent restarts and keeps its worktree with its uncommitted changes.
- The owner's orchestrator pane stops too, so the owner works from another terminal.
- Two projects have a live worker (`60756641ca25-agent-orchestrator` and `f6790d5546be-agent-skills`); seven
  `lifecycle-worker.pid` files exist under the state root base. A barrier that covers one project only would
  miss the second.
- 6 JS runtimes of the uid (2 workers, 4 with a `bash` parent); each must stop or be allowed (P3).
- 8 processes with an unreadable identity: `systemd`, `(sd-pam)`, four `sshd`, two `sftp-server`. Under OD-27 (b)
  each needs an allow at every barrier; the `sshd` and `sftp-server` PIDs change with each login, the
  `systemd --user` pair stays while a login lasts. The alternative is to end the SSH sessions first.
- 1 tmux server of the uid (`/tmp/tmux-44402/default`); every AO-named pane on it must be gone.
- The record step scans every state root; r6 counted 3844 directories under `~/.agent-orchestrator` (most are
  test leftovers). Not timed: this round runs no barrier on the real root.

### 2.2 The precondition check (what it reads)

A check classifies every process of the uid except the barrier process. It reads the process list from
`/proc` until a read after the first finds no new live process of the uid (at most 5 reads, else it blocks with
"the process list did not settle"). Zombies (state `Z`) and processes that ended (`ENOENT`, `ESRCH`) are skipped.

| Rule | Reads | Blocks when | Allowable |
| --- | --- | --- | --- |
| P1 | `/proc/<pid>/environ` (keys only are kept) | it has any `AO_*` key (host-wide: whatever root, project or config it names) | no |
| P1u | the same | the read fails with `EACCES` or another error than `ENOENT`/`ESRCH` (OD-27 (b)) | yes |
| P2 | the tmux servers that the check finds (below) | a pane of a session whose name has the AO form `<12 hex>-...` (any hash), or whose name is the runtime of an active record of a covered root | no |
| P2u | the same | a tmux server process that no path reaches: no listening socket path answers with its PID within 5 s, or its descriptors or socket table cannot be read | yes |
| P3 | the exe link, after the kernel's ` (deleted)` suffix is removed, and `comm` | the basename is `node`, `nodejs`, `bun` or `deno`, or `comm` is `node-MainThread` | yes |
| P3u | the exe link | `EACCES` (OD-27 (b)) | yes |
| P4 | argv, cwd, exe, descriptor links | W1 to W4 of r5 2.3, one pass per read; before the fence W1 counts every interpreter that names a managed file | no |
| P5 | argv, cwd | never blocks: E1 to E4 of r5 6.2 label a P3 match (an `ao` shim, a build, a worker PID file) | - |

**Server discovery (P2).** A tmux server is every process of the uid whose `comm` is `tmux: server` (tmux sets
it when the server starts; m1), or whose exe basename is `tmux` and that holds a listening Unix socket. Its
socket paths: the inodes of its descriptor links `socket:[<ino>]`, matched with the rows of
`/proc/<pid>/net/unix` that have the listening flag (`0x10000`). For each path the check runs
`tmux -S <path> display-message -p '#{pid}'`; the server is resolved when the answer is its PID. Then
`list-panes -a -F '#{session_name} #{pane_pid}'` on that path. The sockets in `$TMUX_TMPDIR/tmux-<uid>/` and the
`-S` paths in argv are no longer needed; a socket that the owner names (`--tmux-socket`) is queried too. Measured
(m1): a server with another `TMUX_TMPDIR` and `-L` has no `-S` in its argv and its socket is outside the
checker's directory, so the r6 sources miss it; its descriptor links give the path, and the query lists its
AO-named pane. A server whose socket file was removed runs on, its socket row still shows the old path, and no
query reaches it: P2u.

**The diagnostics.** For each blocking process: PID, start ticks, rule, `comm`, the parent's PID and `comm`, for
P1 the `AO_*` key names and whether `AO_DATA_DIR`, `AO_STATE_ROOT` and `AO_CONFIG_PATH` lie under a covered
root ("covered", "not covered"), for P2 the socket path and session name, for P1u and P3u the error code. The
check never prints a value of an environment, and it never signals, stops or waits on a process.

**Allows.** `--allow <pid>:<start ticks>:<rule>`, one rule per entry. An allow means: the owner asserts that this
process never runs old AO code. P1, P2 and P4 cannot be allowed: they identify an AO process or an old writer. An
entry matches only while the process with that PID has those start ticks; the barrier checks that at check 1,
at check 2 and at admission (step 8). A process that ended lets its entry expire; a new process with the same
PID has other start ticks. The barrier record keeps every entry with its state. Measured (core r7): an allow
with other start ticks does not admit; an exact P3 allow admits a runtime that matches no other rule; a P3 allow
of a runtime with `AO_SESSION` still blocks by P1.

**Covered roots.** Every directory under the state root base `~/.agent-orchestrator/` that has `sessions/`, plus
the state root of every config that the owner names (`--config`, default the CLI's config), plus every
`--state-root`. They say where the record step (2.3 step 3) and the fence (step 5) act. A covered root that cannot
be read blocks. A state root outside them is not recovered by the barrier, but every record-lock holder recovers
an archive intent (3.4), and no process of that root can run (P1, P2).

**Test seam.** `processScope(pid)` limits the check to the processes that a test started; it is not reachable
from the CLI. The B-1 tests use it, so that a test never reads or queries a process or tmux server that it did
not start.

### 2.3 The barrier steps

1. Close admission (r4 8.1).
2. Check 1 (P1 to P4). A block: keep admission closed, show the list, exit 1. Nothing else changes.
3. The record step, for every record of every covered root, under its record lock: finish an archive intent
   (3.4), then write `failed` for a `preparing` launch (its maker is dead: no AO process runs). Show obsolete
   files, late lines, orphans and failed launches. "inbox damaged" or a record that cannot be read keeps
   admission closed.
4. Make `.inbox/` and `.inbox/orphans.ndjson` in every covered sessions directory. No step makes `.inbox/<id>`.
5. The fence of r5 2.2: every managed file and every hook under every worktree root of every covered root, by
   rename, then `fsync` of each directory.
6. Check 2 (P1 to P4, W1 with the current-inode rule of r5 2.3).
7. The exact checks: every active record is `published`, `failed` or has no launch ID; no `archiveIntent`; no
   `preparing`; the hashes of the fenced files.
8. Check every allow again (start ticks); write the barrier record (the allows with their state, both check
   results, the covered roots); open admission; start the standing check (r5 6.3, OD-25 (a)).

### 2.4 What the checks see, and what they cannot see

A read of the process list sees every process that lives through the whole read (Linux lists `/proc` in
increasing PID order; r5 2.5 assumption A3). A check reads until a read finds no new live process, so it sees
every process that lives from the start of its first read to the end of its last read. It does not see a
process that starts after its last read, or that starts and ends between two reads. Measured (m1 e): a node
process that starts after one read is not in it, and the second read finds it.

So the two checks validate a fleet that the owner stopped; they cannot make one. **The operating rule:** from
step 2 of 2.1 until admission opens and the standing check runs, the owner starts no AO process, no old build
and no JS runtime that is not allowed. A violation that is alive at a check blocks. A process that starts and
ends between check 1 and check 2 (and so can write a record directly with old text) is a violation of the rule
that no check can find; after admission the standing check finds a wrapper rewrite at its next poll (OD-25 (a):
detection and response).

What stays outside P1 to P4 (assumption S3, now narrower than r6): a JS runtime whose exe basename is not one of
the four and whose `comm` is not `node-MainThread` (a renamed `bun` or `deno`, a compiled program that loads core
without node), a writer with no `AO_*` key that matches no W1 to W4 shape (r5 2.7), and a process in another uid,
PID namespace or mount namespace. An allowed process that runs old core anyway breaks the owner's assertion;
the standing check detects its wrapper rewrite.

### 2.5 What the stopped fleet removed from r5, and what stays

As r6 2.4: the drain wait, the three-scan proof and the depth limit (r5 2.4, 2.5, 2.7), the legacy inbox (r5 3.1
rows `inboxLegacy` and `not-eligible`, `legacy.ndjson`, steps 6a and 7b), the barrier's stop of the workers and
E5 as a proof (r5 6.1, 6.2) are removed. The fence (r5 2.2), W1 to W4 (as P4), I1, the publish, the failed
state, the parser (r5 3.3), the catch-up, the cap (r5 3.8), the recovery (now step 3) and the standing check stay.

## 3. RW: the inbox

### 3.1 Eligibility

The applier selects the file under the record lock:

| Record | Answer | File |
| --- | --- | --- |
| `archiveIntent` set | `archiving`: the caller finishes the archive (3.4) | none |
| `launchId=L`, `launchState=published` | apply | `.inbox/<id>/L.ndjson`, records with launch field `L` |
| `launchId=L`, `launchState=preparing` | `held` | none |
| `launchId=L`, `launchState=failed` | `failed`: never applied; listed | none |
| `launchId=L`, another or no `launchState` | `invalid` (a strict-read error, R4) | none |
| no `launchId` | no selected inbox (a pre-RW record before its first RW launch); nothing to apply | none |

`launchId` and `archiveIntent` join `LAUNCH_IDENTITY_KEYS` (`metadata.ts:331`); `launchState` and `inboxCursor`
do not.

### 3.2 The launch transaction (r6 B-1, re-check r6 M-1)

`beginLaunch` (a spawn, a restore of an active record, a restore of an archived record) runs in ONE synchronous
`withRecordLock` hold, with no `await`:

1. Read the record strictly. `archiveIntent` set: finish the archive (3.4) in this hold. "inbox damaged" or a
   read error: refuse.
2. Check the ID. A spawn: no record. A restore: the record holds the expected values (its launch identity, and
   the launch ID, file identity and `S0` that the catch-up froze, 3.3), else refuse "the launch changed". An
   archived restore: no record, and the latest archive holds the expected values.
3. `mkdir -p .inbox/<id>` (0700); create `L.ndjson` with `O_EXCL` (0600); `fsync` the file and the directory.
4. The record write with `launchId=L`, `launchState=preparing` and no cursor: `reserveSessionRecord` (a spawn;
   an archived restore, with `expectedArchive`, and the archived content without `archiveIntent`, `inboxCursor`
   and the old launch fields) or `updateMetadataIf` (a restore).
5. The outcome of step 4:
   - It returned the record: the launch began; return L and the record.
   - It returned "no" (null or false): a definite refusal, it wrote nothing. Remove `L.ndjson`, refuse.
   - It threw: the outcome is unknown. `reserveSessionRecord` publishes the record in `createRecordFile`
     (`metadata.ts:884`): `linkSync` at `:900`, the error wrap at `:904`, and the removal of the temporary file in
     a `finally` at `:906`. So it can throw after the record exists (an error of the link call after the link,
     or of the removal). Read the record again in the same hold:
     - it names L: the write committed. Keep the file; return L and the re-read record; report the error as a
       warning (a temporary `.<id>.reserve-*` file can remain; `listMetadata` skips dot names).
     - it does not exist, or it names another launch: the file belongs to no record. Remove `L.ndjson`, refuse
       with the error.
     - the read fails: keep `L.ndjson`; refuse "the launch state is unknown: <error>; <L>.ndjson is kept". The
       caller starts no pane. `ao status` shows the record as it is; a `preparing` record without a pane is
       archived by `ao session kill` (r5 3.2, crash row "step 2"), and its file goes with it.

**Ownership rule.** A launch file belongs to the record that names it, from its creation. Outside a hold no
unnamed file is pending: its maker named it, removed it, kept it after an unknown outcome (a file that the record
then names, or an unnamed one), or died in the hold. So every holder of the record lock can treat an empty
unnamed file as obsolete (3.6), and prune, archive and recovery need no candidate state.

| Crash or exception | State | Recovery |
| --- | --- | --- |
| death after step 3 | an empty file that no record names | prune (3.6) |
| an exception before the record exists | the file removed | none |
| an exception after the record exists | the record names L, the file exists | none: the launch began |
| an exception, and the re-read fails | the file exists; the record names L or does not exist | the next strict read decides (prune keeps a file while the read fails) |
| death after step 4 | `preparing`, the record names L | r5 3.2 crash rows: no apply; a kill archives; the barrier writes `failed` |

Measured (m2, the real `reserveSessionRecord` with faults injected into `node:fs`): the r6 rule removes the file
that the record names at three of the four fault points; the r7 rule keeps it at all three and removes it only
when the link did not happen. `onCandidate` (after step 3, before step 4) is a test seam.

### 3.3 The catch-up and the publish

- `catchUpInbox(id)` freezes the selected launch, the file identity `(dev, ino)` and `S0` (the size at its
  start), applies until the cursor reaches `S0` within its budget (CLI 5 s), and returns
  `{ complete, launchId, dev, ino, s0 }`. For a record without `launchId` it answers `complete` with no selected
  inbox. A decision (a restore, 3.2 step 2; an archive, 3.4 step 2) checks the frozen values in its hold; a
  change: refuse "the launch changed: run again", and nothing makes a file. A backlog that the budget cannot
  finish: refuse "inbox backlog of n bytes: run again".
- **The publish** (only the maker of L, after the pane started): ONE hold with the condition `launchId=L`,
  `launchState=preparing` and no `archiveIntent`. It reads `L.ndjson` from offset 0 in 64 KiB chunks up to `S0`
  or the end of its budget, parses (r5 3.3), and makes ONE record write: the launch fields, the values of the
  complete records that it read, `launchState=published` and the cursor after the last of them. The unread rest
  is backlog for the applier and the next catch-up. Two writes in one hold are not allowed: a process can die
  between them. The budget (1 MiB and 1 s) keeps the hold far below the 5 s that another process waits for the
  lock. Measured (core r7): the r6 validation prototype wrote twice and read past the budget.
- The cap (1 MiB per launch file, soft) and its cost stay as r5 3.8.

### 3.4 The archive: grammar, location, readers and recovery (re-check r6 M-2)

**Names.** The record archive stays `archive/<id>_<ts>` (the grammar that every reader knows: the prefix
`<id>_`, a digit, the lexicographic maximum is the latest). The inbox archive moves out of the record namespace:
`.inbox-archive/<id>_<ts>/` in the sessions directory. `<ts>` is the archive time `YYYY-MM-DDTHH-MM-SS-mmmZ`,
chosen in the hold that writes the intent as `max(now, last + 1 ms)`, where `last` is the latest `<ts>` of the
ID among the names in `archive/` and `.inbox-archive/`. So two archives of one ID never share a name, and the
order of the names is the order of the archives. `deleteMetadata` takes the name
(`deleteMetadata(dataDir, id, { archiveName, expected })`; today it makes its own time stamp, `metadata.ts:691`):
a name that exists with the same content is kept (a retry after a crash), with other content it refuses
("archive name taken", damage).

Why this location: no reader changes. `readArchivedMetadataRaw` (`metadata.ts:706`, selection `:717` to `:731`),
`updateLatestArchive` (`:765` to `:788`), the copy-back and the generation of `reserveSessionRecord` (`:854`),
`listArchivedSessionIds` and its strict form (`session-manager.ts:656`, `:673`), `findArchivedSessionRecord`
(`:4122`), the archive fallback of `restore` (`:4239`) and the holder checks (`:1001`, `:1752` to `:1772`, `:3231`
to `:3256`, `:3437`) read only `archive/`; `listMetadata` (`metadata.ts:814`) and the session listing
(`session-manager.ts:201`) skip dot names. A rollback to a pre-RW build reads every archive as today. Measured
(m3, the real readers): with the r6 layout the lookup answers null, the update false, the restore copy-back
refuses, a strict holder check answers "could not be read", and a second archive in the same millisecond
overwrites the first record archive and cannot move its inbox; with the r7 layout each answers correctly and both
generations stay.

**Steps.**

1. `catchUpInbox` (complete, else refuse `backlog`).
2. ONE record-lock hold: check the frozen values; choose `<ts>`; write `archiveIntent=<ts>` (conditional on the
   launch identity); rename `.inbox/<id>` (when it exists) to `.inbox-archive/<id>_<ts>`, `fsync` both
   directories; `deleteMetadata` with the name `<id>_<ts>` and the condition `archiveIntent=<ts>`.

**Recovery.** Every holder of the record lock that reads `archiveIntent=<ts>` (`beginLaunch`, prune, an applier,
every mutating command, barrier step 3) finishes the archive in its hold:

| `.inbox/<id>` | `.inbox-archive/<id>_<ts>` | Record | Action |
| --- | --- | --- | --- |
| yes | no | any | move, then archive the record |
| no | yes | any | archive the record |
| no | no | no `launchId` | archive the record (a pre-RW record has no inbox) |
| no | no | `launchId` | "inbox damaged" (I1) |
| yes | yes | any | "inbox damaged": only external damage, because nothing makes `.inbox/<id>` while the intent exists (3.2 step 1) |

When the record is gone, there is nothing to do; a new record of the ID has no intent. The bytes after the
archived cursor in the archived launch file are late lines (3.5).

### 3.5 The writer, obsolete files, late lines, orphans

The writer is r5 3.4 without the legacy file: a pane with `AO_LAUNCH_ID` appends one framed record
(`RS "1" SP <launch> SP <key> SP <hex> SP <ms> LF`) to its launch file after a size check; a pane without
`AO_LAUNCH_ID`, a missing file or a failed append writes one orphan record to `.inbox/orphans.ndjson`; it never
creates a directory and always exits 0. Obsolete launch files, late lines (now in `.inbox-archive/`), orphans
and held lines of a failed launch are listed and never applied (r5 3.7).

### 3.6 Prune and the API

`pruneInbox(dataDir, id)`: under the record lock, finish an archive intent first, then read the record strictly;
a read error removes nothing; else remove the EMPTY files that the record does not name. A file with bytes
stays listed. `ao session inbox --prune --confirm` calls it.

`core/src/inbox.ts`: `beginLaunch(dataDir, id, { spawn?, archived?, expected?, onCandidate? })` returns L and
throws when it refuses (production also returns the record to its caller); `publishLaunch(dataDir, id, L, fields,
{ budgetBytes? })` (`budgetBytes` is a test seam); `applyInbox(dataDir, id)`; `catchUpInbox(dataDir, id)`;
`archiveLaunch(dataDir, id, L)`; `recoverArchive(dataDir, id)` returns `"nothing"`, `"finished"` or `"inbox
damaged"`; `pruneInbox(dataDir, id)` returns the removed names; `recoverInterruptedRecords(dataDir)`;
`archivedInboxPath(dataDir, id, ts)`. `core/src/fleet-barrier.ts`: `checkFleetAndFence({ install, sessionsDirs,
allowEntries?, tmuxSockets?, tmuxSocketDir?, processScope?, onCheck?, onEnumerated?, allow? })` returns
`{ admitted, blocking: [{ pid, rule, ... }] }`; `allow` is the callback seam of the r5 and r6 tests (it gets
`{ pid, rule }`); `onEnumerated({ check, listing })` runs after each read of the process list.

### 3.7 RW and R4 (who owns which change)

R4 round 3 (ao-55, branch `feat/same-id-r4` at `8e9efe95`, not on `main`) treats a null answer of
`readArchivedMetadataRaw` for an ID with an archive file as "could not be read", that is as a holder
(`session-manager.ts:1028` to `:1032` of that branch); `main` already does so at `:1752` to `:1772`. With the r6
layout every ID that RW archived would read null there, so allocation would refuse for it (m3). With the r7
layout no reader sees an inbox archive.

| Change | Round |
| --- | --- |
| the location `.inbox-archive/<id>_<ts>/`, the name rule, `deleteMetadata` with the name, the recovery table, the tests archive, lookup, update and restore with equal times | RW |
| how a reader answers an error of the archive directory or of the latest archive file (strict: unknown, never "no archive") | R4 |

The two rounds touch different lines and can land in either order. One shared rule: if R4 makes
`readArchivedMetadataRaw` throw for an unreadable latest archive, the archived restore of 3.2 and the recovery of
3.4 refuse on that throw.

## 4. RW before R3a

RW lands before any cross-process operation lock (R3a). Its flows need none: the applier, the publish, the launch
transaction, the restore, the archive and prune each run in one record-lock hold, and every other flow that
touches `.inbox/<id>` takes the same lock (as r5 4 with the rows reservation, restore and archive replaced by 3.2
and 3.4). Two mutating commands of one ID can still interleave their effects outside the record (a runtime stop,
a worktree removal) until R2b-2 and R3a; that is the state of R2a, and RW does not make it worse.

## 5. R2b-2: serialized association with fences

### 5.1 The lock, the order, the callers (unchanged, r5 5.1 to 5.3)

The operation lock of an ID (kind `operation` in `delivery-lock.ts`, subject the realpath of the sessions
directory and the ID; the 30 s CLI waiter; the lifecycle tries once). Lock order: operation(ID), then record(ID);
the record lock stays innermost and synchronous; a tmux call runs under the operation lock and outside the record
lock. Under the lock, from the first record read to the last record write: `ao session associate` and its
`--resume`, `--abandon`, `--forget-intent`, `clear-token`, `associate-retained`, `stop-retained`, `retire`,
`kill`, `stop`, `restore`, `cleanup`, every archive, and the lifecycle actions that stop, restore, archive or
retire. Not under it: `send`, attach and the lifecycle's messages (they keep the guard of R2b-1), `status`, the
audit and the applier. The evidence mismatch state (r5 5.5) and the API of r5 5.6 stay.

### 5.2 The session fence `@ao_op` (r6 5.1, unchanged)

Before its first mutating tmux command on an existing session N, a holder H reads `@ao_op` of N, then runs one
gated command that sets `@ao_op` to op(H) when the evidence (server PID, session name, `$N`, pane PID) and `@ao_op`
still have the values that it read (`ao-fenced`, else `ao-fence-refused:<values>`), up to 3 tries, then refuses
"the session changed". Every later mutating command of H on N (associate, adopt, exact clear, `clear-token`, the
asserted legacy stop, the kill of `retire`, the launch keys of a create) has `#{@ao_op}` equal to op(H) in its
compare. op(H) is the random part of the operation token (r3 5.1), at least 48 bits. A command of an earlier
holder is refused when the server runs it, through any shim, fork or delayed exec. The forms are those of r4 3.2
and 3.3 with `/#{@ao_op}` in the compare (r6 5.1). Premises: a command list holds only `if-shell -F` (no
`run-shell`, no `if-shell` without `-F`), so the compare and its effect are one step in the server; a hook body
that schedules later work needs its own check when that work runs; a fence that cannot run gives no later
mutating command. The review measured all ten stale gated mutations refused, a recreated name and a restarted
server refusing an old fence and clear, and 40 competing fence pairs with one winner each.

### 5.3 The name fence (OD-28 (b))

A session that does not exist yet has no `@ao_op`. So every holder also fences the NAME on the server where the
session is or will be:

- **The value.** A server option `@ao_name_<k>`, k = the first 16 hex digits of the SHA-256 of the session name
  (a session name can hold characters that an option name cannot).
- **The server identity.** `#{pid}/#{start_time}` of the server at the socket that the runtime config names. Every
  name compare includes both, so a command aimed at a server that stopped is refused on any later server at the
  same path.
- **The order** for a holder H of ID X with tmux name N (every operation-lock holder of 5.1, also one that will
  not create, for example a kill or a restore that marks the launch failed):
  1. Take the operation lock.
  2. The name fence: read `#{pid}/#{start_time}/#{@ao_name_<k>}`; one gated command
     `if-shell -F "#{==:#{pid}/#{start_time}/#{@ao_name_<k>},<read values>}" { set-option -s @ao_name_<k> op(H) ;
     display-message -p "ao-name-fenced:#{pid}" } { display-message -p "ao-name-fence-refused:..." }`; up to 3
     tries, then refuse "the session name changed". No server answers: the case of 5.4.
  3. The session fence of 5.2 when N exists.
  4. The record steps (for a launch: the transaction of 3.2).
  5. A create (a spawn or a restore): ONE gated command
     `if-shell -F "#{==:#{pid}/#{start_time}/#{@ao_name_<k>},<pid>/<start time>/op(H)}" { new-session -d -s N -c <ws>
     ... ; set-option -t =N: @ao_op op(H) ; display-message -p "ao-created:#{pid}" } { display-message -p
     "ao-create-refused:..." }`. A name that exists makes `new-session` fail: refuse. The launch command (the
     `send-keys` of `runtime-tmux/src/index.ts:145` to `:149`) and the cleanup kill (`:153`) become gated
     commands that compare `@ao_op`.
- **Why it holds.** The fence comes before the record write that names the launch, and the create compares the
  fence in the same command list as `new-session`. After a holder H' fenced N on server S, the create of an earlier
  holder H compares `op(H)` with `op(H')` and is refused; aimed at S after S stopped, it compares S's PID and start
  time with those of the new server and is refused. `#{start_time}` has a resolution of one second: the tmux r7
  test measured two servers at one socket in the same second (`2526552/1792671804` then `2526656/1792671804`), so
  the PID and the start time are compared together, never the start time alone. A guarded create does not start a server: `if-shell` is not a
  command that starts one, so with no server the client fails with "error connecting" (m4 a).
- **Measured** (m4, private tmux 3.4): H1's fence after H0's makes H0's late create answer `ao-create-refused` and
  no session exists; H1's create sets `@ao_op` of the new session to op1; a create of H0 that names the first
  server, run on a second server at the same socket, is refused; 40 of 40 competing name-fence pairs have exactly
  one winner. The tmux r7 tests repeat the first two with a held `/bin/sh` shim client of a killed holder.
- The option stays on the server after the operation (one per name); the next holder fences from it.

### 5.4 The named residual until R3a: a create when no server runs

When no tmux server runs at the socket, a holder has nothing to fence on, and its create has to start the server:
it is a plain `new-session` (as today, `runtime-tmux/src/index.ts:132`). If that holder dies while this create is
held (in a shim, a fork before exec, a delayed exec), the create can run later. It starts a server and a live pane
with the launch's environment (an `AO_LAUNCH_ID` of a launch that the next holder or the barrier may already have
marked `failed`), and no record names its runtime. RW never applies its lines (its launch is failed or not
published), but the agent runs: it can edit and commit in the worktree, push with its credentials, and use or
change its agent session. The review reproduced this (N-1: a saved late `new-session` after a modeled record
became `failed`, with no server running, made a live pane). R2b-2 makes no claim of launch exclusivity.

How the owner finds it: `ao session audit` (R2b-2) lists every session of the AO form on every tmux server that
the discovery of 2.2 finds, whose name no active record names as its runtime or whose `@ao_op` is not the
operation of the record's last holder: "unrecorded session <name> on <socket>, pane <pid>, started <time>".
`ao status` shows their count. The owner checks the pane and stops it with
`env -u TMUX tmux -S <socket> kill-session -t =<name>`. R3a closes the case (the child lifetime under the operation
lock, or a guarded first create on a server that the holder starts first).

### 5.5 The API that the tests use

As r5 5.6 (`beginAssociation`, `resumeAssociation`, `abandonAssociation`, `clearForeignToken` in core), and in
runtime-tmux: `fenceName(sessionName, operationId)` returns `{ fenced, server: { pid, startTime } | null }`
(`server: null` when no server runs); `RuntimeCreateConfig.operation?: { id, server }`, with which `create` makes
the guarded create of 5.3.

## 6. What RW and R2b-2 protect alone

| Round | Protects alone | Does not protect |
| --- | --- | --- |
| RW | no shell writer of the new text writes a record; at admission no process of the uid that P1 to P4 identify lives (an `AO_*` key anywhere, an AO-named pane on any tmux server that the check finds, an unreadable identity that is not allowed, a JS runtime that is not allowed, an old writer shape), checked to a fixed point twice, with every allow exact, scoped to one rule and checked at use; each launch file is named by its record from its creation, and an exception keeps the file unless non-ownership is proved; no prune, archive or recovery removes or moves a named file; an interrupted archive is finished in the order of 3.4 under an archive name that no other archive of the ID has, and every archive reader finds the record archive; a decision catches up to its frozen `S0` or refuses; the publish is one record write; a failed launch never applies; obsolete files, late lines and orphans are listed, never applied; the epoch fences every worker write; a wrapper rewrite closes admission at the next poll | the tmux identity (R2b-1); a process that starts and ends between two reads or after the last check (the operating rule, 2.4); an allowed process that runs old core, or an old build after admission, until the next poll; S3 (2.4); loss after the cap (r5 3.8); effects outside the record between two commands of one ID (R2a level until R2b-2 and R3a) |
| R2b-2 | as r4 (legacy records `unknown` unless associated or asserted; the asserted legacy stop; association with intent, adopt and exact clear; retire, inventory, `stop-retained`, `where`, audit); every transition, stop, restore, retire and archive of an ID holds the operation lock across its tmux and record steps; every mutating tmux command of an earlier holder on an existing session is refused in the server after a later holder fenced it; on a running server, a create of an earlier holder, or one aimed at a server that stopped, starts no session after a later holder fenced the name; an evidence mismatch is an explicit state | a create that has to start the server (5.4, until R3a); the operation lock of the other entry points (R3a); send and attach are guarded, not locked |

## 7. Round plan (changes to r5 9 and r6 7)

| Round | Content | Files | Tests that must turn green | Risk | Size | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| **RW** | 2 (the procedure's checks P1 to P5 with discovery, the fixed point, exact scoped allows, the steps, the barrier record); 3 (eligibility, the transaction with the re-read, frozen catch-up, the one-write budgeted publish, the archive location and names, `deleteMetadata` with the name, the recovery table, strict prune, the writer without legacy); kept: the parser, the cap, the lists, the epoch module and the worker write fence, the hook by rename, the monotonic wrapper version, `refresh-hooks --all`, the standing check | `core/src/metadata.ts` (`launchId`, `archiveIntent` in `LAUNCH_IDENTITY_KEYS`; `deleteMetadata` with the name), new `core/src/inbox.ts`, new `core/src/fleet-barrier.ts`, new `core/src/build-epoch.ts`, `core/src/agent-workspace-hooks.ts`, `core/src/session-manager.ts` (spawn, restore, archived restore and archive through 3.2 and 3.4), `core/src/lifecycle-manager.ts` (applier, standing check), `agent-claude-code/src/index.ts`, CLI `session.ts`, new CLI `barrier.ts`; the test files of OD-26 and OD-29 | core r7 `(RW)`: 15 defects; core r6 `(RW)`: 5; core r5 `(RW)`: 5; core r4 `(RW)` `:379` and `:262` (OD-26 (a): RW changes the `:262` oracle to a refusal while the old writer lives and an admission after it ends, and keeps the frozen writer, the preservation and PR assertions and the healthy second admission); every control stays green. Add: each row of 3.1 and of the 3.4 table; each crash point of 3.2 and 3.4, then the recovery by `beginLaunch`, prune, an applier, a command and the barrier; an unknown re-read through the CLI (no pane starts); failed active and failed archived records; the frozen-identity refusal; the publish budget over 1 MiB; an exactly-once count across the read boundary; archive, lookup, update, list and restore of an archived RW launch through `createSessionManager`, with equal times and three generations; each P rule with an owned fixture and automatic discovery (two socket roots, a removed socket, `-S` and `-L`); every rule's diagnostics without values; no call of `process.kill` (a spy); a wrapper rewrite between two standing polls (detected, admission closed) | **high** | L | R2a (restore) |
| **R2b-1** | as r5 9, with the re-inventory below | as r5 9 | as r5 9, and per listed path a real private-server CLI call with a healthy tokenless session, a token launch, a replaced token and an absent session, the non-Codex retry Enters included, and a pane that waits for an answer (no key) | high | L | R2a, RW |
| **R2b-2** | 5.1 to 5.3: the session fence and the name fence, the guarded create and its gated launch keys; the audit of 5.4 | as r5 9, and `runtime-tmux/src/index.ts` (`fenceName`, the guarded create) | tmux r7 `(R2b-2)`: 2 defects; tmux r6 `(R2b-2)`: 2; tmux r5 `(R2b-2)`: 3; `c516cead` R2 runtime-tmux F-5; as r5 9. Add: each mutating command of 5.2 with a held shim; a held session fence; a held name fence; a fence retry; a fence that cannot run; a create of a name that exists; the audit lists an unrecorded session; outcomes of `Promise.allSettled` asserted one by one | high | M | R2b-1 |

R3a, R3b, RH and RO as r5 9. Order: R2a, R4, RW, R2b-1, R2b-2, R3a, R3b. RW and R4 split M-2 as 3.7 says.

**R2b-1 re-inventory** (checked on `main` `a4cb1470`, m5; the claude-code round `63932b9a..9938d5d1` is in it;
the implementation goes by the call, not the line):

- `cli/src/commands/send.ts`: `sendViaTmux` `:133` (C-u `:134`, `load-buffer` `:141`, `paste-buffer -p` `:147`,
  literal `:156`, Enter `:160`), called at `:363`; the Codex branch `:374` to `:406` reads only (`captureOutput`,
  `detectActivity`, the screen parser); the other-agent loop `:413` to `:444`: a pane in `waiting_input` gets a
  line and NO key (`:417`, commit `7e9fb4fe`), `active` and a queued message get no key, the retry Enters are
  `:434` (an unsubmitted Codex input) and `:439` (`attempt < 3`). The r6 list named `:425` and `:430`.
- `core/src/tmux.ts`: Escape `:171`, `load-buffer` `:187`, `paste-buffer` `:188`, literal `:199`, Enter `:209`,
  `kill-session` `:225`.
- `runtime-tmux/src/index.ts`: `create` `:112` (`new-session` `:132`, literal `:145`, Enter `:147`, launch command
  and Enter `:149`, the cleanup `kill-session` `:153`); `destroy` `:179` (`kill-session` `:182`); `sendMessage`
  `:189` (C-u `:192`, `load-buffer` `:201`, `paste-buffer` `:202`, `delete-buffer` `:212`, literal `:220`, Enter
  `:226`); `getAttachInfo` `:278`.
- CLI `session.ts` attach: `:187` (`getAttachInfo`), `:195` (the attach arguments), `:209` (the spawn).
- The core and lifecycle callers of all of these, through the identity resolver and the shared guard. The paste
  needs the guard: `load-buffer` alone targets no pane. The send fallbacks without tmux (`:190`, `:356`) go to
  core `send`.

## 8. Owner decisions

| OD | Status | Value |
| --- | --- | --- |
| OD-2 to OD-25 | decided | as r5 10; OD-25 (a): detection and response |
| 1b the stopped-fleet barrier | decided | 2 |
| OD-26 the core r4 `:262` oracle | **decided (a)** | the RW round changes it (7, RW row) |
| OD-27 an unreadable identity | **decided (b)** | P1u and P3u block unless allowed by exact PID, start ticks and rule; keys, `comm` and error codes are shown, never values; an allow expires with that process identity (2.2) |
| OD-28 a create of a dead holder | **decided (b)** | the name fence on a running server (5.3); no server: the named residual until R3a (5.4) |
| **OD-29** (new) the allows of the three core r5 race tests | open | Those tests allow every P3 match of the host (`allow: (p) => p.rule === "P3"`). Under r7, P1 (any `AO_*` key), P1u and P3u (OD-27 (b)) and P2 (every server) also match processes that the test did not start, on a host with a live AO fleet, an SSH login or an AO pane above the test (measured: the caller's own shell with `AO_*` blocked, 9.7). The r5 file may not change in this round. (a) The RW round changes those three allows to "every process that the test did not start" (as the r6 M-2 test does) or gives them a process scope, and keeps every other assertion. (b) Keep them; they pass only where no such process exists (CI). **Recommendation (a).** |

## 9. Measurements

### 9.1 Environment and isolation

Host Linux 6.8.0-147, tmux 3.4, node 25.7.0, pnpm 9.15.4, 91 processes of the uid at m6; core vitest 4.1.4, runtime-tmux vitest 3.2.4 (in normal
mode it counts a failing `it.fails` as passed). Every `node`, `pnpm`, helper and test call ran under `env -i`
with `HOME=/tmp/aosd7/home` (scripts) or `/tmp/aosd7/testhome` (tests), no `AO_*` variable, `PATH` from
`/tmp/aosd7/{bintest,pnpmbin,nodebin}` and `/usr/bin:/bin` (no `opencode`, `herdr`, `claude`, `codex`, `gemini` or
`ao` on it: checked). Private tmux servers: `aosd7-alt` under `TMUX_TMPDIR=/tmp/aosd7/m1/other-tmux` (m1),
`aosd7-n1` (m4), `aosd7-T` (the test shim), and the servers that the tests start in their temporary directories
under `/tmp/aosd7/tmp` (`-S <dir>/s`, or `-L ao-r7-alt-<hex>` with a `TMUX_TMPDIR` there); every call with
`env -u TMUX` or `env -i`. Each script ends every process that it started by its exact PID after a start-ticks
check and removes only the sockets of its own servers. m6 reads the stat, comm, exe and descriptor links of the
uid's processes, opens `environ` without a read, prints no argv or environment of a process that is not mine and
queries no tmux server that is not mine. m1 reads the environment only of its own fixtures and prints key names
only.

### 9.2 m1: what the precondition can read about tmux servers and JS runtimes

`env -i HOME=/tmp/aosd7/home PATH=/tmp/aosd7/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd7/tmp node
/tmp/aosd7/scripts/m1_discovery.mjs`:

~~~text
a. alt server argv ["/usr/bin/tmux","-f","/dev/null","-L","aosd7-alt","new-session","-d","-s","bbbbbbbbbbbb-app-1","/usr/bin/env -i /bin/sleep 600"]
   comm of server and pane ["tmux: server","sleep"]
   socket_path /tmp/aosd7/m1/other-tmux/tmux-44402/aosd7-alt
   r6 P2 sources include it false
   r7 listening sockets of the server ["/tmp/aosd7/m1/other-tmux/tmux-44402/aosd7-alt"] resolved true
   r7 query of the resolved socket "bbbbbbbbbbbb-app-1 2096044"
   pane AO keys []
b. socket removed: server alive true listed path ["/tmp/aosd7/m1/other-tmux/tmux-44402/aosd7-alt"] resolved false
   alt has-session after removal 1
c. deleted exe /tmp/aosd7/m1/old-bin/node (deleted) | literal basename node (deleted) | normalized node | comm node-MainThread
   renamed exe /tmp/aosd7/m1/old-bin/runtime-x | comm node-MainThread
   this node's comm node-MainThread
d. non-dumpable environ "EACCES" exe EACCES comm python3 stat true argv ["/usr/bin/python3","-I","/tmp/aosd7/m1/nondump.py"]
e. one pass: the late runtime is in the list false
   fixed point: listings 2 | new JS runtimes found include it true
own processes remaining []
~~~

### 9.3 m2: the four fault points of the launch transaction (the real `reserveSessionRecord`)

~~~text
fault point                          rule  answer | record names L | file of L exists
1 before publication                 r6    refused (EIO) | false | false
1 before publication                 r7    refused (EIO; the record does not name 198c6b7ed4493ad639687ab89917235f) | false | false
2 after publication                  r6    refused (EIO) | true | false
2 after publication                  r7    began (the write committed; EIO reported) | true | true
3 during the temp cleanup            r6    refused (injected EIO in the temporary cleanup) | true | false
3 during the temp cleanup            r7    began (the write committed; injected EIO in the temporary cleanup reported) | true | true
4 during the re-read                 r6    refused (injected EIO in the temporary cleanup) | true | false
4 during the re-read                 r7    refused: the launch state is unknown (EACCES); 32c31370c55c5f3fe82d290abec7ef8c.ndjson kept | true | true
~~~

### 9.4 m3: the archive layouts against the real archive readers

~~~text
== r6: archive 1 at 2026-10-22T12-00-00-000Z (moved); archive dir ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-000Z.inbox"]
  lookup (readArchivedMetadataRaw)         null
  update (updateArchivedMetadata)          false
  archive ID listing (session-manager)     ["app-1"]
  a strict holder check (main :1772)       the latest archive of app-1 could not be read
  restore copy-back (expectedArchive)      refused
  archive 2 in the same ms at 2026-10-22T12-00-00-000Z (rename failed ENOTEMPTY)
  record archives ["app-1_2026-10-22T12-00-00-000Z"]; inbox archives ["app-1_2026-10-22T12-00-00-000Z.inbox"]
  branches in the record archives ["feat/gen-2"]; latest null
  launch files in the inbox archives ["L1"]; active .inbox/app-1 left true; L2 2222
== r7: archive 1 at 2026-10-22T12-00-00-000Z (moved); archive dir ["app-1_2026-10-22T12-00-00-000Z"]
  lookup (readArchivedMetadataRaw)         launchId L1, feat/gen-1
  update (updateArchivedMetadata)          true
  archive ID listing (session-manager)     ["app-1"]
  a strict holder check (main :1772)       reads the archive
  restore copy-back (expectedArchive)      restored, generation 4
  archive 2 in the same ms at 2026-10-22T12-00-00-001Z (moved)
  record archives ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-001Z"]; inbox archives ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-001Z"]
  branches in the record archives ["feat/gen-1","feat/gen-2"]; latest "feat/gen-2"
  launch files in the inbox archives ["L1","L2"]; active .inbox/app-1 left false; L2 2222
~~~

### 9.5 m4: the name fence on a private tmux server (`-L aosd7-n1`)

~~~text
== a. no server
guarded create: exit 1 | error connecting to /tmp/tmux-44402/aosd7-n1 (No such file or directory) | socket exists no
== b. a running server
server 2128177 start_time 1792670199
H0 fence: ao-name-fenced:2128177
H1 fence: ao-name-fenced:2128177
H0 late create: ao-create-refused:2128177/1792670199/op1 | session exists no
H1 create: ao-created:2128177 | @ao_op of the new session op1
H0 late create once more: ao-create-refused:2128177/1792670199/op1
== c. another server on the same socket
server 2: 2128202 start_time 1792670200
H0 late create on server 2 (its compare names server 2128177/1792670199): ao-create-refused:2128202/1792670200/op0 | session exists no
== e. competing name fences
pairs with exactly one fenced answer: 40 of 40
== d. the residual: no server, a plain new-session runs late
record: launchState=failed runtimeHandle=(none)
late plain create: session exists yes, pane pid 2128544
socket left no; server processes left: 
~~~

### 9.6 m5 and m6: the re-inventory on `main`, and the host classes

m5 (`git show main:...` only):

~~~text
main = a4cb1470
== packages/cli/src/commands/send.ts
:133  async function sendViaTmux(pane: string, message: string): Promise<void> {
:134  await exec("tmux", ["send-keys", "-t", pane, "C-u"]);
:141  await exec("tmux", ["load-buffer", tmpFile]);
:147  await exec("tmux", ["paste-buffer", "-p", "-t", pane]);
:156  await exec("tmux", ["send-keys", "-t", pane, "-l", message]);
:160  await exec("tmux", ["send-keys", "-t", pane, "Enter"]);
:190  await sessionManager.send(sessionName, message);
:316  const waitingInput = state === "waiting_input";
:350  // to sessionManager.send().  The lifecycle route can restore dead
:356  await sessionManager.send(session, message);
:363  await sendViaTmux(pane, message);
:374  if (agent.name === "codex") {
:417  if (state === "waiting_input") {
:433  if (hasUnsubmittedCodexInput(output)) {
:434  await tmux("send-keys", "-t", pane, "Enter");
:438  if (attempt < 3) {
:439  await tmux("send-keys", "-t", pane, "Enter");
== packages/core/src/tmux.ts
:129  export async function newSession(opts: NewSessionOptions): Promise<void> {
:165  export async function sendKeys(
:171  await tmux("send-keys", "-t", exactPaneTarget(sessionName), "Escape");
:187  await tmux("load-buffer", "-b", bufferName, tmpFile);
:188  await tmux("paste-buffer", "-b", bufferName, "-d", "-t", exactPaneTarget(sessionName));
:199  await tmux("send-keys", "-t", exactPaneTarget(sessionName), "-l", text);
:209  await tmux("send-keys", "-t", exactPaneTarget(sessionName), "Enter");
:224  export async function killSession(sessionName: string): Promise<void> {
:225  await tmux("kill-session", "-t", exactSessionTarget(sessionName));
== packages/plugins/runtime-tmux/src/index.ts
:112  async create(config: RuntimeCreateConfig): Promise<RuntimeHandle> {
:132  ["new-session", "-d", "-s", sessionName, "-c", config.workspacePath, ...envArgs],
:145  await tmux("send-keys", "-t", pane, "-l", invocation);
:147  await tmux("send-keys", "-t", pane, "Enter");
:149  await tmux("send-keys", "-t", pane, config.launchCommand, "Enter");
:153  await tmux("kill-session", "-t", exactSessionTarget(sessionName));
:179  async destroy(handle: RuntimeHandle): Promise<void> {
:182  await tmux("kill-session", "-t", target);
:189  async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
:192  await tmux("send-keys", "-t", pane, "C-u");
:201  await tmux("load-buffer", "-b", bufferName, tmpPath);
:202  await tmux("paste-buffer", "-b", bufferName, "-t", pane, "-d");
:212  await tmux("delete-buffer", "-b", bufferName);
:220  await tmux("send-keys", "-t", pane, "-l", message);
:226  await tmux("send-keys", "-t", pane, "Enter");
:278  async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
== packages/cli/src/commands/session.ts
:187  const attachInfo = await runtime.getAttachInfo?.(handle);
:195  args = ["attach", "-t", exactSessionTarget(handle.id)];
:209  const child = spawn(command, args, { stdio: "inherit" });
== the claude-code round on main (63932b9a..9938d5d1)
9938d5d1 docs: state the Claude Code screen rule and the waits-for-an-answer line
7e9fb4fe fix(cli): send no retry Enter to a pane that waits for an answer
1758d095 test(cli): check ao send against real Claude Code idle, running and dialog screens
63932b9a fix(agents): read the Claude Code input box, not words, in detectActivity
~~~

m6 (read-only; the worker PIDs come from `cat ~/.agent-orchestrator/*/lifecycle-worker.pid`; of the seven pid
files, two name a live process):

~~~text
processes of uid 44402: 91 (zombies skipped: 0)
tmux servers: 1
  pid=271595 listening ["/tmp/tmux-44402/default (socket now: true)"]
JS runtimes (P3): 6
  pid=101162 comm=node-MainThread exe-base=node parent-comm=bash
  pid=2002324 comm=node-MainThread exe-base=node parent-comm=systemd (a real lifecycle worker)
  pid=2002831 comm=node-MainThread exe-base=node parent-comm=systemd (a real lifecycle worker)
  pid=2240870 comm=node-MainThread exe-base=node parent-comm=bash
  pid=2327115 comm=node-MainThread exe-base=node parent-comm=bash
  pid=425597 comm=node-MainThread exe-base=node parent-comm=bash
unreadable identity (OD-27 (b) blocks unless allowed): 8
  pid=13870 comm=systemd parent-comm=systemd exe=EACCES environ=EACCES
  pid=13874 comm=(sd-pam) parent-comm=systemd exe=EACCES environ=EACCES
  pid=1847142 comm=sshd parent-comm=sshd exe=EACCES environ=EACCES
  pid=1847143 comm=sftp-server parent-comm=sshd exe=EACCES environ=EACCES
  pid=1847378 comm=sshd parent-comm=sshd exe=EACCES environ=EACCES
  pid=1849148 comm=sshd parent-comm=sshd exe=EACCES environ=EACCES
  pid=1849949 comm=sshd parent-comm=sshd exe=EACCES environ=EACCES
  pid=1850213 comm=sftp-server parent-comm=sshd exe=EACCES environ=EACCES
~~~

### 9.7 The tests against the r7 prototypes

`/tmp/aosd7/scripts/val7.sh` copies the test files to `/tmp/aosd7/val`, changes only import specifiers, and runs
them in red mode against the prototypes of 3, 2.3 and 5.3 (12). A barrier call without a process scope (the r5
and r6 files) sees only the processes whose `HOME` is under `/tmp/aosd7/` (a validation switch of the prototype,
not part of the design). Before that switch the session of the caller was the scope, and the r7 barrier
prototype refused the r5 races on `bash`, `sed`, `grep`, `cut` and `head`: the pipeline of this agent's shell,
which has the real `AO_*` variables (OD-29).

~~~text
== core r7 against inbox.ts and fleet-barrier.ts (prototypes)
✓ __tests__/same-id-defects-r7.test.ts (22 tests)
✓ control: a prune that waited for the launch transaction ends and removes nothing 
✓ control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing 
Tests  22 passed (22)
== core r6 (changed) against inbox.ts and fleet-barrier.ts (prototypes)
✓ __tests__/same-id-defects-r6.test.ts (8 tests)
✓ a prune while a launch begins keeps the launch file that the new record names 
✓ an archive of another launch while a launch begins does not move the file of that launch 
Tests  8 passed (8)
== core r5 against inbox.ts and fleet-barrier.ts (prototypes)
✓ __tests__/same-id-defects-r5.test.ts (10 tests)
✓ the barrier refuses while an old mv runs whose wrapper died before the first check 
✓ the barrier refuses when an old writer starts after its first check 
✓ the barrier refuses while an old wrapper text runs that has no managed file open 
Tests  10 passed (10)
== runtime-tmux r6 against assoc-proto.ts (the session fence, unchanged)
✓ __tests__/same-id-defects-r6.test.ts (4 tests)
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the held clear of a killed holder does not remove the token that the next holder published 
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > control: a held clear that runs before its holder is killed leaves tmux and the record in agreement 
Tests  4 passed (4)
== runtime-tmux r7 against runtime-proto.ts (the name fence prototype)
✓ __tests__/same-id-defects-r7.test.ts (4 tests)
Tests  4 passed (4)
~~~

The tmux r7 file with the compare of the guarded create switched off in the prototype (`val7.sh nofence`;
`fenceName` stays):

~~~text
== runtime-tmux r7 against runtime-proto.ts (fenceName kept, the create does not compare)
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > control: the held create is a shell-shim client whose argv names new-session and the session
× [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > the held create of a killed holder starts no session after the next holder fenced the name
→ production (runtime-tmux fenceName): held client argv[0] /bin/sh, exe /usr/bin/dash; next holder {"fenced":true,"server":{"pid":"2328705","startTime":"1792671199"}}; the held call answered "ao-created:2328705"; session exists true: expe
× [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > the held create of a killed holder starts no session on a server that started after its fence
→ production (runtime-tmux fenceName): server 2328705/1792671199 then 2328780/1792671200; the held call answered "ao-created:2328780"; session exists true: expected true to be false // Object.is equality
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > control: a holder that is not superseded creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
Tests  2 failed | 2 passed (4)
~~~

### 9.8 Section 0 evidence (at the end of the round)

Marker `/tmp/aosd7-marker`: 2026-10-22 07:41:41.03 EDT. Checked at 08:25 EDT, after the last test run.

`find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosd7-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'`
(exit 0):

~~~text
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills
/home/taisung/.agent-orchestrator/f6790d5546be-agent-skills/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/lifecycle-worker.pid
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
~~~

Each entry, with its time (`stat`) and its writer. None is mine: every process of this round ran under `env -i`
with `HOME` under `/tmp/aosd7` and no `AO_*` variable, and no script names the real state root.

| Entry | Time (EDT) | Writer |
| --- | --- | --- |
| `f6790d5546be-agent-skills/lifecycle-worker.pid` and its directory | 07:46:24.9 and 07:46:25.2 | the restart of the real worker 2002831 (the owner's rebuild; 11.1) |
| `60756641ca25-agent-orchestrator/lifecycle-worker.pid` and its directory | 07:46:21.7 and 07:46:22.0 | the restart of the real worker 2002324 |
| `sessions/archive` and `sessions/.generations` (and so `sessions`) | 08:00:04 and 08:19:45 to 08:19:46.9 | the real fleet archived `ao-61` (a new session, 08:00:04) and `ao-51`, `ao-56`, `ao-57` (08:19:45 to 08:19:46); the new names are `archive/ao-61_2026-10-22T12-00-04-370Z`, `archive/ao-51_2026-10-22T12-19-45-747Z`, `archive/ao-56_2026-10-22T12-19-46-320Z`, `archive/ao-57_2026-10-22T12-19-46-936Z` and their `.generations` counters |
| `sessions/ao-54` | 08:13:23 | the real session `ao-54` and its lifecycle (not mine) |
| `sessions/ao-orchestrator` | 08:16:53 | the real orchestrator `60756641ca25-ao-orchestrator` and its lifecycle (not mine) |

My processes (`python3 -I /tmp/aosd7/scripts/sec0_procs.py`: argv that names `/tmp/aosd7` or `aosd7-`, a cwd or
exe under `/tmp/aosd7`, or `HOME=/tmp/aosd7...`; the scan and its ancestors excluded; it prints only matches):

~~~text
processes of uid 44402 that are mine (excluding this scan and its 5 ancestors): 0
~~~

No PID in `/tmp/aosd7/logs/pids.txt` lives. No socket exists under `/tmp/aosd7`. In `/tmp/tmux-44402/` no `aosd7`
socket remains: the test shim left `aosd7-T` (08:17:21, no server: `no server running on /tmp/tmux-44402/aosd7-T`),
and I removed it after that query; the other sockets there are not mine and stay.

`ls -la --time-style=full-iso ~/.ao/bin`, before (07:42) and after (08:25), the same (`diff` prints nothing):

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

The real lifecycle workers, from their pid files (`cat`) and `ps -o pid=,lstart=,comm=`; the brief's 1294181 and
1294364 ended before the restart:

~~~text
2002324 Thu Oct 22 07:46:21 2026 node-MainThread
2002831 Thu Oct 22 07:46:24 2026 node-MainThread
1294181 ended
1294364 ended
~~~

The branch: `git branch -r --contains HEAD` prints nothing; HEAD is `fe5d6575` on `c8751762`; no push, no PR.

## 10. Tests of this round

### 10.1 `packages/core/src/__tests__/same-id-defects-r7.test.ts` (new; `be0a52c9`)

Tag `[same-id R3] (RW)`. Until RW lands, the tests run models of the design r6 text on the built record
functions; the barrier tests give the barrier a process scope with only the processes that the test starts. The
title "a JS runtime that starts after its last check read the process list" means: the runtime starts after the
first read of check 2 (`onEnumerated` with check 2, listing 1), so only the fixed point of 2.2 finds it.
Failures on `c8751762` (red mode):

~~~text
a fault after the link that published the record keeps the launch file that the record names
  AssertionError: inbox: design r6 model (no inbox.ts); fault 2 fired; returned undefined; threw "Could not reserve session app-1 in /tmp/aosd7/tmp/ao-same-id-r7-commit-i4NwhB/sessions"; record names "4bc1e13b090db22abba6fa253de7e4f1"; files []: expected [] to deeply equal [ Array(1) ]

a fault in the cleanup of the temporary record file keeps the launch file that the record names
  AssertionError: inbox: design r6 model (no inbox.ts); fault 3 fired; returned undefined; threw "injected EIO in the temporary cleanup"; record names "e15d6f519689d9b7cde1b3a8daa55ebb"; files []: expected [] to deeply equal [ Array(1) ]

a re-read that cannot read the record keeps the launch file and refuses as unknown
  AssertionError: inbox: design r6 model (no inbox.ts); fault 4 fired; returned undefined; threw "injected EIO in the temporary cleanup"; record names "01115dcdda87375cf58ca002fe3a0dbc"; files []: expected [] to deeply equal [ Array(1) ]

the latest archive of an ID is its record after the archive of a launch
  AssertionError: inbox: design r6 model (no inbox.ts); archived; archive/ ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-000Z.inbox"]: expected undefined to be 'a75c9ecdc01b97f037dd9a48c8811b80' // Object.is equality

the archived record of a launch takes an update
  AssertionError: inbox: design r6 model (no inbox.ts); archived; archive/ ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-000Z.inbox"]: expected false to be true // Object.is equality

a restore of an archived launch copies the record back with a new launch
  AssertionError: inbox: design r6 model (no inbox.ts); archived; archive/ ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-000Z.inbox"]: expected 'the launch changed' to be '' // Object.is equality

two archives of one ID in the same millisecond keep both records and both inboxes under exact names
  AssertionError: inbox: design r6 model (no inbox.ts); second archive: archive refused: inbox damaged; archive/ ["app-1_2026-10-22T12-00-00-000Z","app-1_2026-10-22T12-00-00-000Z.inbox"]: expected 'archive refused: inbox damaged' to be 'archived' // Object.is equality

a publish writes the records that its budget read and their cursor in one record write
  AssertionError: inbox: design r6 model (no inbox.ts); generation 1 -> 3; {"branch":"feat/three","state":"published","cursor":{"launch":"70e015486be9316d0e33f5e453e1bc28","dev":66309,"ino":123882424,"off":226}}: expected 3 to be 2 // Object.is equality

the barrier finds an AO-named pane on a server with another TMUX_TMPDIR and no -S
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); server 2525541, pane 2525542, socket /tmp/aosd7/tmp/ao-same-id-r7-barrier-KWox34/other-tmux/tmux-44402/ao-r7-alt-5c277161: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

the barrier keeps admission closed for a tmux server whose socket it cannot resolve
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); server 2525547, removed socket /tmp/aosd7/tmp/ao-same-id-r7-barrier-cM0MN3/other-tmux/tmux-44402/ao-r7-alt-59d75449: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

the barrier finds a node process whose executable was unlinked
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); pid 2525551, exe /tmp/aosd7/tmp/ao-same-id-r7-barrier-zEx8NL/old-bin/node (deleted): {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

the barrier blocks a process whose AO_* keys name a state root that it does not cover
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); pid 2525560: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

the barrier blocks a process whose environment and exe cannot be read (OD-27 (b))
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); pid 2525561, environ EACCES true: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

the barrier finds a JS runtime that starts after its last check read the process list
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); late pid 2525562: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

an allow of a JS runtime for rule P3 does not cover its AO environment
  AssertionError: barrier: design r6 model (no fleet-barrier.ts); pid 2525563: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality
~~~

| Test | Kind |
| --- | --- |
| control: a fault before the record is published leaves no record and no launch file | control |
| a fault after the link that published the record keeps the launch file that the record names | defect |
| a fault in the cleanup of the temporary record file keeps the launch file that the record names | defect |
| a re-read that cannot read the record keeps the launch file and refuses as unknown | defect |
| the latest archive of an ID is its record after the archive of a launch | defect |
| the archived record of a launch takes an update | defect |
| a restore of an archived launch copies the record back with a new launch | defect |
| two archives of one ID in the same millisecond keep both records and both inboxes under exact names | defect |
| control: the recovery of a pre-RW archive intent leaves a readable record archive | control |
| a publish writes the records that its budget read and their cursor in one record write | defect |
| control: a prune that waited for the launch transaction ends and removes nothing | control |
| control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing | control |
| the barrier finds an AO-named pane on a server with another TMUX_TMPDIR and no -S | defect |
| the barrier keeps admission closed for a tmux server whose socket it cannot resolve | defect |
| the barrier finds a node process whose executable was unlinked | defect |
| the barrier blocks a process whose AO_* keys name a state root that it does not cover | defect |
| the barrier blocks a process whose environment and exe cannot be read (OD-27 (b)) | defect |
| the barrier finds a JS runtime that starts after its last check read the process list | defect |
| an allow of a JS runtime for rule P3 does not cover its AO environment | defect |
| control: an allow with other start ticks does not admit a JS runtime | control |
| control: an exact P3 allow admits a JS runtime that matches no other rule | control |
| control: a server with another TMUX_TMPDIR and no AO-named session does not block | control |

### 10.2 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts` (new; `be0a52c9`, real tmux)

Tag `[same-id R2] (R2b-2)`. The old holder is a node process that runs the built runtime-tmux; its tmux is a
`/bin/sh` shim that holds the first call with `new-session`; the test kills the holder by its PID; the next
holder runs in the test process. Failures on `c8751762` (red mode):

~~~text
the held create of a killed holder starts no session after the next holder fenced the name
  AssertionError: design r6 model (runtime-tmux has no fenceName): held client argv[0] /bin/sh, exe /usr/bin/dash; next holder no name fence (design r6); the held call answered ""; session exists true: expected true to be false // Object.is equality

the held create of a killed holder starts no session on a server that started after its fence
  AssertionError: design r6 model (runtime-tmux has no fenceName): server 2526552/1792671804 then 2526656/1792671804; the held call answered ""; session exists true: expected true to be false // Object.is equality
~~~

| Test | Kind |
| --- | --- |
| control: the held create is a shell-shim client whose argv names new-session and the session | control |
| the held create of a killed holder starts no session after the next holder fenced the name | defect |
| the held create of a killed holder starts no session on a server that started after its fence | defect |
| control: a holder that is not superseded creates its session | control |

### 10.3 `packages/core/src/__tests__/same-id-defects-r6.test.ts` (changed; `fe5d6575`)

- Why: the two r6 tests that set up or read an archived inbox used the r6 path `archive/<id>_<ts>.inbox`, so a
  correct RW (with `.inbox-archive/<id>_<ts>`) would fail them. They now take the path from
  `archivedInboxPath` of the module under test; the r5 model of the file exports its own r5 path, so the
  defects stay red on `c8751762` for the same reasons as before.
- Strengthened (the review named the oracle weak): the barrier-recovery test also reads every record archive back
  under the exact name `archive/<id>_<ts>` that its intent fixed. A fix with another archive name passed it before.
- Unchanged: the five defects and their failures on `c8751762`:

~~~text
a prune while a launch begins keeps the launch file that the new record names
  AssertionError: inbox: design r5 model (no inbox.ts), prune: {"pruned":["57e90f67f0c133756b6123012847785e.ndjson"]}: expected false to be true // Object.is equality

an archive of another launch while a launch begins does not move the file of that launch
  AssertionError: inbox: design r5 model (no inbox.ts), B: {"B":"e17cb04c3b33e9cd16f68f73800dc4b0"}: expected false to be true // Object.is equality

a restore that read the record before an archive intent makes no inbox, and the archive finishes
  AssertionError: inbox: design r5 model (no inbox.ts), recovery: inbox damaged: expected true to be false // Object.is equality

the barrier finishes every archive that stopped after its intent or after its inbox move
  AssertionError: inbox: design r5 model (no inbox.ts): [{"sessionId":"app-1","result":"finished"},{"sessionId":"app-2","result":"finished"},{"sessionId":"app-3","result":"inbox damaged"},{"sessionId":"app-4","result":"finished"},{"sessionId":"app-5","result":"finished"}]: expected [ 'app-3' ] to deeply equal []

the barrier refuses while a JS runtime runs that the owner did not allow
  AssertionError: barrier: design r5 E5 model (no fleet-barrier.ts); fixture pid 2525661, cwd /tmp/aosd7/tmp/ao-same-id-r6-e5-9eYImb/external: expected true to be false // Object.is equality
~~~

### 10.4 Red counts (`SAME_ID_DEFECTS=red`, `/tmp/aosd7/scripts/redcount.sh`)

At `fe5d6575`:

~~~text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects-r4.test.ts: R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/3 passed
packages/core/src/__tests__/same-id-defects-r5.test.ts: R3 (RW) 5 failed/5 passed
packages/core/src/__tests__/same-id-defects-r6.test.ts: R3 (RW) 5 failed/3 passed
packages/core/src/__tests__/same-id-defects-r7.test.ts: R3 (RW) 15 failed/7 passed
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
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r4.test.ts: R2 (R2b-1) 3 failed/0 passed, R2 (R2b-1, R2b-2) 0 failed/6 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r5.test.ts: R2 (R2b-1, R2b-2) 0 failed/4 passed, R2 (R2b-2) 3 failed/5 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r6.test.ts: R2 (R2b-2) 2 failed/2 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts: R2 (R2b-2) 2 failed/2 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
~~~

Against `c8751762` (the list of design r6 10.4, `diff`):

~~~text
6a7
> packages/core/src/__tests__/same-id-defects-r7.test.ts: R3 (RW) 15 failed/7 passed
20a22
> packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts: R2 (R2b-2) 2 failed/2 passed
~~~

### 10.5 Normal mode and the full run

`pnpm typecheck` and `pnpm lint` exit 0 before each commit (lint: the 5 earlier warnings in source files). The
full `pnpm -r --no-bail test` at `fe5d6575`, under 9.1, exit 0:

~~~text
packages/core test:  Test Files  59 passed (59)
packages/core test:       Tests  1422 passed | 50 expected fail (1472)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  220 passed (220)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  4 passed (4)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:  Test Files  4 passed (4)
packages/plugins/runtime-herdr test:       Tests  49 passed (49)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/workspace-worktree test:  Test Files  5 passed (5)
packages/plugins/workspace-worktree test:       Tests  72 passed (72)
packages/plugins/runtime-tmux test:  Test Files  8 passed (8)
packages/plugins/runtime-tmux test:       Tests  120 passed (120)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  269 passed (269)
~~~

At `c8751762` (design r6 10.5): core 1415 passed and 35 expected fail, runtime-tmux 116. The difference is the new
tests: core +7 controls and +15 defects of r7; runtime-tmux +4 (vitest 3.2.4 counts the 2 defects as passed).

## 11. Unclear or wrong in the brief

1. The brief names the real lifecycle workers 1294181 and 1294364. They ended during the round: the workers
   restarted at 07:46:21 and 07:46:24 as 2002324 (`60756641ca25-agent-orchestrator`) and 2002831
   (`f6790d5546be-agent-skills`, a second project with a live worker), as the brief allowed. I named them from
   their pid files (`cat`) and never signalled or waited on them.
2. The r5 race tests allow only P3 matches of the host; under r7 they depend on the host (OD-29, new).
3. OD-27 (b) costs 8 allows per barrier on this host (2.1), or the end of the SSH logins.
4. "Map every live tmux server process to its actual socket": done with the descriptor links and the socket
   table of the process's network namespace. A server in another network or mount namespace, or one whose
   socket table cannot be read, is P2u and blocks unless allowed.
5. Herdr is not measured (no Herdr in this round). The discovery of 2.2 covers tmux; a Herdr agent process is
   P1 (its `AO_*` keys) and P3 when it is a JS runtime; a Herdr server process itself is not identified by name.
6. `main` moved from `ce93ba67` to `a4cb1470` (two docs commits) and then to `407ee00d` (three docs commits:
   `HANDOVER.md` and `TODO_TRACKING.md` only) during the round. The re-inventory uses `a4cb1470`; every source
   line that this design cites is the same on `407ee00d`. `metadata.ts` is the same on `c8751762` and `main`.
7. The brief asks for failing tests of the four M-1 fault points; the first (before publication) is correct
   under r6 too, so it is a control.
8. The brief and the review cite `metadata.ts:884` (`createRecordFile`), `:904` (`linkSync`) and `:910` (the
   `finally` cleanup) for M-1. On `main` and `c8751762` the file has 908 lines: `linkSync` is `:900`, `:904` is the
   error wrap, and the `finally` cleanup is `:906` (3.2). The defect is the same.

## 12. The scripts and prototypes in full

### /tmp/aosd7/scripts/m1_discovery.mjs

~~~js
// m1 (re-check r6 B-1, design r7 section 2.2): what the precondition check can read about tmux servers and JS
// runtimes, on owned fixtures only.
//   a. a server started with another TMUX_TMPDIR and -L (no -S in its argv): the r6 rule P2 (sockets in the
//      checker's directory, -S in argv) against the r7 rule (the listening Unix socket of each tmux server
//      process, from its descriptor links and /proc/<pid>/net/unix, then a query that must answer that PID)
//   b. the same with its socket file removed: the r7 rule finds the server and no usable path (unresolved)
//   c. a node process whose executable was unlinked, and one started from a renamed hard link: exe, comm
//   d. a non-dumpable process (python3, prctl PR_SET_DUMPABLE 0) with AO_* keys: what /proc gives
//   e. a JS runtime that starts after a pass read the PID list: one pass, and the r7 fixed point
// Every tmux call goes to an aosd7-* server under /tmp/aosd7; every process is ended by its exact PID with a
// start-ticks check; only the sockets of these servers are removed. Environments are read only for the owned
// fixtures, and only their AO_* key names are printed.
// Run: env -i HOME=/tmp/aosd7/home PATH=/tmp/aosd7/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd7/tmp \
//        node /tmp/aosd7/scripts/m1_discovery.mjs
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd7", T0 = `${S}/m1`, UID = process.getuid();
rmSync(T0, { recursive: true, force: true });
mkdirSync(`${T0}/other-tmux`, { recursive: true });
mkdirSync(`${T0}/old-bin`, { recursive: true });
const OTHER = `${T0}/other-tmux`, CHECKER_DIR = `/tmp/tmux-${UID}`;
const ticks = (p) => { try { const s = readFileSync(`/proc/${p}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
const started = new Map();
const track = (pid, what) => { if (pid && !started.has(pid)) { started.set(pid, { what, t: ticks(pid) }); appendFileSync(`${S}/logs/pids.txt`, `m1 ${what} pid=${pid}\n`); } };
const alt = (...a) => spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", "aosd7-alt", ...a], { encoding: "utf8", env: { ...process.env, TMUX_TMPDIR: OTHER } });
const bySock = (sock, ...a) => spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-S", sock, ...a], { encoding: "utf8", timeout: 5000 });
const argvOf = (p) => readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0").filter(Boolean);
const comm = (p) => { try { return readFileSync(`/proc/${p}/comm`, "utf8").trim(); } catch (e) { return e.code; } };
const exeOf = (p) => { try { return readlinkSync(`/proc/${p}/exe`); } catch (e) { return e.code; } };
const norm = (exe) => exe.replace(/ \(deleted\)$/, "").split("/").at(-1);
const aoKeys = (p) => { try { return readFileSync(`/proc/${p}/environ`, "utf8").split("\0").filter((x) => x.startsWith("AO_")).map((x) => x.split("=")[0]); } catch (e) { return e.code; } };

/** r6 2.2 P2: the sockets in the checker's directory and each -S path in the argv of a tmux process. */
function r6Sockets(pids) {
  const out = new Set();
  try { for (const f of readdirSync(CHECKER_DIR)) out.add(`${CHECKER_DIR}/${f}`); } catch {}
  for (const p of pids) { const a = argvOf(p); a.forEach((x, i) => { if (x === "-S" && a[i + 1]) out.add(a[i + 1]); }); }
  return out;
}
/** r7 2.2 P2: the listening Unix sockets of a process, from its descriptor links and its network namespace table. */
function listeningSockets(pid) {
  const inodes = new Set();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try { const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m) inodes.add(m[1]); } catch {}
  }
  const paths = [];
  for (const line of readFileSync(`/proc/${pid}/net/unix`, "utf8").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 8 && inodes.has(f[6]) && (parseInt(f[3], 16) & 0x10000) !== 0) paths.push(f.slice(7).join(" "));
  }
  return paths;
}
function r7Resolve(pid) {
  const paths = listeningSockets(pid);
  for (const p of paths) {
    const r = bySock(p, "display-message", "-p", "#{pid}");
    if (r.status === 0 && Number(r.stdout.trim()) === pid) return { pid, socket: p, resolved: true };
  }
  return { pid, sockets: paths, resolved: false };
}

try {
  // a. another TMUX_TMPDIR, -L, no -S
  alt("new-session", "-d", "-s", "bbbbbbbbbbbb-app-1", "/usr/bin/env -i /bin/sleep 600");
  const [as, ap, sp] = alt("display-message", "-p", "#{pid}|#{pane_pid}|#{socket_path}").stdout.trim().split("|");
  const server = Number(as);
  track(server, "alt server"); track(Number(ap), "alt pane");
  console.log("a. alt server argv", JSON.stringify(argvOf(server)));
  console.log("   comm of server and pane", JSON.stringify([comm(server), comm(Number(ap))]));
  console.log("   socket_path", sp);
  console.log("   r6 P2 sources include it", r6Sockets([server]).has(sp));
  const res = r7Resolve(server);
  console.log("   r7 listening sockets of the server", JSON.stringify(listeningSockets(server)), "resolved", res.resolved);
  console.log("   r7 query of the resolved socket", JSON.stringify(bySock(res.socket, "list-panes", "-a", "-F", "#{session_name} #{pane_pid}").stdout.trim()));
  console.log("   pane AO keys", JSON.stringify(aoKeys(Number(ap))));
  // b. the socket file removed: the server runs, its socket inode is listed with the old path, no query answers
  unlinkSync(sp);
  const rb = r7Resolve(server);
  console.log("b. socket removed: server alive", ticks(server) === started.get(server).t, "listed path", JSON.stringify(rb.sockets), "resolved", rb.resolved);
  console.log("   alt has-session after removal", alt("has-session", "-t", "=bbbbbbbbbbbb-app-1").status);
  // c. a deleted executable and a renamed hard link of node
  const imp = `${T0}/importer.mjs`;
  writeFileSync(imp, "setInterval(() => {}, 1000);\n");
  linkSync(process.execPath, `${T0}/old-bin/node`);
  linkSync(process.execPath, `${T0}/old-bin/runtime-x`);
  const dn = spawn(`${T0}/old-bin/node`, [imp], { cwd: T0, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } });
  const rn = spawn(`${T0}/old-bin/runtime-x`, [imp], { cwd: T0, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } });
  track(dn.pid, "deleted node"); track(rn.pid, "renamed node");
  await sleep(300);
  unlinkSync(`${T0}/old-bin/node`);
  const de = exeOf(dn.pid);
  console.log("c. deleted exe", de, "| literal basename", de.split("/").at(-1), "| normalized", norm(de), "| comm", comm(dn.pid));
  console.log("   renamed exe", exeOf(rn.pid), "| comm", comm(rn.pid));
  console.log("   this node's comm", comm(process.pid));
  // d. non-dumpable
  const py = `${T0}/nondump.py`;
  writeFileSync(py, "import ctypes,time\nctypes.CDLL(None).prctl(4,0,0,0,0)\ntime.sleep(60)\n");
  const nd = spawn("/usr/bin/python3", ["-I", py], { env: { HOME: `${S}/home`, PATH: "/usr/bin:/bin", AO_SESSION: "app-1", AO_DATA_DIR: `${T0}/sessions` }, stdio: "ignore" });
  track(nd.pid, "non-dumpable");
  await sleep(300);
  console.log("d. non-dumpable environ", JSON.stringify(aoKeys(nd.pid)), "exe", exeOf(nd.pid), "comm", comm(nd.pid), "stat", ticks(nd.pid) !== null, "argv", JSON.stringify(argvOf(nd.pid)));
  // e. a runtime born after a pass read the PID list
  const list1 = new Set(readdirSync("/proc").filter((d) => /^\d+$/.test(d)));
  const late = spawn(process.execPath, [imp], { cwd: T0, stdio: "ignore", env: { PATH: "/usr/bin:/bin" } });
  track(late.pid, "late runtime");
  console.log("e. one pass: the late runtime is in the list", list1.has(String(late.pid)));
  const seen = new Set(list1);
  let rounds = 1, found = [];
  for (; rounds <= 5; rounds++) {
    const now = readdirSync("/proc").filter((d) => /^\d+$/.test(d) && !seen.has(d));
    if (now.length === 0) break;
    for (const d of now) { seen.add(d); try { if (statSync(`/proc/${d}`).uid === UID && norm(exeOf(Number(d))) === "node") found.push(Number(d)); } catch {} }
  }
  console.log("   fixed point: listings", rounds, "| new JS runtimes found include it", found.includes(late.pid));
} finally {
  for (const [p, { what, t }] of started) if (!what.includes("server") && ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
  for (const [p, { what, t }] of started) if (what.includes("server") && ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
  await sleep(300);
  for (const f of existsSync(`${OTHER}/tmux-${UID}`) ? readdirSync(`${OTHER}/tmux-${UID}`) : []) if (f.startsWith("aosd7-")) unlinkSync(`${OTHER}/tmux-${UID}/${f}`);
  console.log("own processes remaining", JSON.stringify([...started].filter(([p, v]) => ticks(p) === v.t).map(([p]) => p)));
}
~~~
### /tmp/aosd7/scripts/m2_commit_faults.mjs

~~~js
// m2 (re-check r6 M-1, design r7 section 3.2): an exception in the one-hold launch transaction, at four fault
// points, with the real built metadata functions (dist/metadata.js of c8751762). The record write is the real
// reserveSessionRecord; the faults are injected into node:fs (syncBuiltinESMExports) for one call only:
//   1 before publication: linkSync throws EIO and links nothing
//   2 after publication: linkSync links, then throws EIO
//   3 during the temporary cleanup: rmSync of the .<id>.reserve-* file throws EIO (the review's case)
//   4 during the re-read: as 3, and the record file is mode 000 when the fault fires (the re-read gets EACCES)
// r6 rule (design r6 3.2 step 5): any exception after the launch file exists: unlink it, refuse.
// r7 rule (design r7 3.2 step 5): re-read the record in the same hold; it names L: keep the file, the launch
// began; it is absent or names another launch: unlink, refuse; the read fails: keep the file, refuse "unknown".
// Run: env -i HOME=/tmp/aosd7/home PATH=/tmp/aosd7/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd7/tmp \
//        node /tmp/aosd7/scripts/m2_commit_faults.mjs
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
const M = await import("/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js");

const ROOT = "/tmp/aosd7/m2";
fs.rmSync(ROOT, { recursive: true, force: true });
const real = { linkSync: fs.linkSync, rmSync: fs.rmSync };
function inject(point, dir) {
  const rec = join(dir, "app-1");
  let fired = false;
  if (point === 1) fs.linkSync = (a, b) => { if (!fired && String(b) === rec) { fired = true; throw Object.assign(new Error("injected EIO before the link"), { code: "EIO" }); } return real.linkSync(a, b); };
  if (point === 2) fs.linkSync = (a, b) => { real.linkSync(a, b); if (!fired && String(b) === rec) { fired = true; throw Object.assign(new Error("injected EIO after the link"), { code: "EIO" }); } };
  if (point >= 3) fs.rmSync = (p, o) => {
    if (!fired && String(p).includes(".app-1.reserve-")) {
      fired = true;
      if (point === 4) fs.chmodSync(rec, 0);
      throw Object.assign(new Error("injected EIO in the temporary cleanup"), { code: "EIO" });
    }
    return real.rmSync(p, o);
  };
  syncBuiltinESMExports();
  return () => { fs.linkSync = real.linkSync; fs.rmSync = real.rmSync; syncBuiltinESMExports(); if (fs.existsSync(rec)) fs.chmodSync(rec, 0o600); return fired; };
}
function strictRead(dir) {
  try { return { ok: true, r: M.readMetadataRaw(dir, "app-1"), raw: fs.readFileSync(join(dir, "app-1"), "utf8") }; }
  catch (e) { return e.code === "ENOENT" ? { ok: true, r: null } : { ok: false, err: e.code ?? String(e) }; }
}
function begin(rule, dir) {
  const L = randomBytes(16).toString("hex");
  const file = join(dir, ".inbox", "app-1", `${L}.ndjson`);
  const answer = M.withRecordLock(dir, "app-1", () => {
    fs.mkdirSync(join(dir, ".inbox", "app-1"), { recursive: true });
    fs.writeFileSync(file, "", { flag: "wx" });
    try {
      M.reserveSessionRecord(dir, "app-1", { launchId: L, launchState: "preparing" });
      return "began";
    } catch (e) {
      if (rule === "r6") { fs.unlinkSync(file); return `refused (${e.cause?.code ?? e.message})`; }
      const now = strictRead(dir);
      if (!now.ok) return `refused: the launch state is unknown (${now.err}); ${L}.ndjson kept`;
      if (now.r?.launchId === L) return `began (the write committed; ${e.cause?.code ?? e.message} reported)`;
      fs.unlinkSync(file);
      return `refused (${e.cause?.code ?? e.message}; the record does not name ${L})`;
    }
  });
  return { L, file, answer };
}
console.log("fault point                          rule  answer | record names L | file of L exists");
for (const point of [1, 2, 3, 4]) {
  for (const rule of ["r6", "r7"]) {
    const dir = join(ROOT, `${point}-${rule}`);
    fs.mkdirSync(dir, { recursive: true });
    const undo = inject(point, dir);
    let out;
    try { out = begin(rule, dir); } finally { out = { ...out, fired: undo() }; }
    const rec = M.readMetadataRaw(dir, "app-1");
    const name = ["1 before publication", "2 after publication", "3 during the temp cleanup", "4 during the re-read"][point - 1];
    console.log(`${name.padEnd(36)} ${rule}    ${out.answer} | ${rec?.launchId === out.L} | ${fs.existsSync(out.file)}${out.fired ? "" : " (FAULT NOT INJECTED)"}`);
  }
}
~~~
### /tmp/aosd7/scripts/m3_archive_layout.mjs

~~~js
// m3 (re-check r6 M-2, design r7 section 3.4): the archive of an RW launch, with the real built archive readers
// (dist/metadata.js of c8751762: readArchivedMetadataRaw, updateArchivedMetadata, reserveSessionRecord with
// expectedArchive, the generation of the next reservation) and the archive ID listing of session-manager.ts
// (its regex, copied). Two layouts, each with the archive name that the intent fixes (an explicit name, as
// design r6 and r7 require; c8751762 deleteMetadata makes its own name, so the record copy is written here):
//   r6: archive/<id>_<ts> and archive/<id>_<ts>.inbox/ (design r6 3.4)
//   r7: archive/<id>_<ts> and .inbox-archive/<id>_<ts>/, <ts> = max(now, the last <ts> of the ID + 1 ms)
// Then a second generation of the ID is archived in the same millisecond (the clock is fixed for the run).
// Run: env -i HOME=/tmp/aosd7/home PATH=/tmp/aosd7/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd7/tmp \
//        node /tmp/aosd7/scripts/m3_archive_layout.mjs
import fs from "node:fs";
import { join } from "node:path";
const M = await import("/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js");

const ROOT = "/tmp/aosd7/m3";
fs.rmSync(ROOT, { recursive: true, force: true });
const NOW = "2026-10-22T12-00-00-000Z"; // one fixed millisecond for both generations
const listIds = (d) => { const ids = new Set(); for (const f of fs.existsSync(join(d, "archive")) ? fs.readdirSync(join(d, "archive")) : []) { const m = f.match(/^([a-zA-Z0-9_-]+)_\d/); if (m?.[1]) ids.add(m[1]); } return [...ids]; };
const TS = /^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/;
const toMs = (ts) => { const m = TS.exec(ts); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null; };
const fromMs = (ms) => new Date(ms).toISOString().replace(/[:.]/g, "-");
function nextTs(d, id) {
  let last = -1;
  for (const dir of ["archive", ".inbox-archive"]) for (const f of fs.existsSync(join(d, dir)) ? fs.readdirSync(join(d, dir)) : []) {
    if (!f.startsWith(`${id}_`)) continue;
    const ms = toMs(f.slice(id.length + 1)); if (ms !== null && ms > last) last = ms;
  }
  return fromMs(Math.max(toMs(NOW), last + 1));
}
function launch(d, gen) {
  const L = `${gen}`.repeat(32).slice(0, 32);
  const fields = { launchId: L, launchState: "published", branch: `feat/gen-${gen}`, worktree: "/w" };
  const ok = M.readMetadataRaw(d, "app-1") ? M.updateMetadata(d, "app-1", fields) : M.reserveSessionRecord(d, "app-1", fields);
  if (!ok) throw new Error("launch failed");
  fs.mkdirSync(join(d, ".inbox", "app-1"), { recursive: true });
  fs.writeFileSync(join(d, ".inbox", "app-1", `${L}.ndjson`), `gen ${gen}\n`);
  return L;
}
function archive(layout, d) {
  return M.withRecordLock(d, "app-1", () => {
    const ts = layout === "r6" ? NOW : nextTs(d, "app-1");
    M.updateMetadata(d, "app-1", { archiveIntent: ts });
    const dst = layout === "r6" ? join(d, "archive", `app-1_${ts}.inbox`) : join(d, ".inbox-archive", `app-1_${ts}`);
    fs.mkdirSync(join(d, layout === "r6" ? "archive" : ".inbox-archive"), { recursive: true });
    let move = "moved";
    try { fs.renameSync(join(d, ".inbox", "app-1"), dst); } catch (e) { move = `rename failed ${e.code}`; }
    fs.mkdirSync(join(d, "archive"), { recursive: true });
    fs.writeFileSync(join(d, "archive", `app-1_${ts}`), fs.readFileSync(join(d, "app-1"), "utf8")); // the explicit name
    M.deleteMetadata(d, "app-1", false, { archiveIntent: ts });
    return { ts, move };
  });
}
for (const layout of ["r6", "r7"]) {
  const d = join(ROOT, layout);
  fs.mkdirSync(d, { recursive: true });
  const L1 = launch(d, 1);
  const a1 = archive(layout, d);
  console.log(`== ${layout}: archive 1 at ${a1.ts} (${a1.move}); archive dir ${JSON.stringify(fs.readdirSync(join(d, "archive")).sort())}`);
  const latest = M.readArchivedMetadataRaw(d, "app-1");
  console.log(`  lookup (readArchivedMetadataRaw)         ${latest ? `launchId ${latest.launchId === L1 ? "L1" : latest.launchId}, ${latest.branch}` : "null"}`);
  console.log(`  update (updateArchivedMetadata)          ${M.updateArchivedMetadata(d, "app-1", { summary: "kept" })}`);
  console.log(`  archive ID listing (session-manager)     ${JSON.stringify(listIds(d))}`);
  console.log(`  a strict holder check (main :1772)       ${latest ? "reads the archive" : "the latest archive of app-1 could not be read"}`);
  const copy = M.reserveSessionRecord(d, "app-1", { ...(latest ?? {}), launchId: "", launchState: "" }, { launchId: L1 });
  console.log(`  restore copy-back (expectedArchive)      ${copy ? `restored, generation ${copy.generation}` : "refused"}`);
  if (!copy) M.reserveSessionRecord(d, "app-1", { branch: "feat/gen-1", worktree: "/w" }); // continue with a plain reservation
  const L2 = launch(d, 2);
  const a2 = archive(layout, d);
  const files = fs.readdirSync(join(d, "archive")).sort();
  const inboxes = layout === "r6" ? files.filter((f) => f.endsWith(".inbox")) : fs.readdirSync(join(d, ".inbox-archive")).sort();
  console.log(`  archive 2 in the same ms at ${a2.ts} (${a2.move})`);
  console.log(`  record archives ${JSON.stringify(files.filter((f) => !f.endsWith(".inbox")))}; inbox archives ${JSON.stringify(inboxes)}`);
  const gens = files.filter((f) => !f.endsWith(".inbox")).map((f) => fs.readFileSync(join(d, "archive", f), "utf8").match(/^branch=(.*)$/m)?.[1]);
  console.log(`  branches in the record archives ${JSON.stringify(gens)}; latest ${JSON.stringify(M.readArchivedMetadataRaw(d, "app-1")?.branch ?? null)}`);
  const kept = inboxes.map((i) => fs.readdirSync(layout === "r6" ? join(d, "archive", i) : join(d, ".inbox-archive", i)));
  console.log(`  launch files in the inbox archives ${JSON.stringify(kept.flat().map((f) => (f.startsWith("1") ? "L1" : f.startsWith("2") ? "L2" : f)))}; active .inbox/app-1 left ${fs.existsSync(join(d, ".inbox", "app-1"))}; L2 ${L2.slice(0, 4)}`);
}
~~~
### /tmp/aosd7/scripts/m4_name_fence.sh

~~~sh
#!/usr/bin/env bash
# m4 (OD-28 (b), design r7 section 5.3): the name fence for a session that a holder creates, on a private tmux
# 3.4 server (-L aosd7-n1 only; every call with env -u TMUX and -f /dev/null).
#   a. no server runs: a guarded create (the new-session inside if-shell -F) and an unguarded new-session
#   b. a running server: holder H0 fences the name, holder H1 fences it again, then the create of H0 runs late
#   c. the server of H0's create stopped and another server runs on the same socket: H0's create runs late
#   d. the residual: no server runs, the plain new-session of a dead holder runs after its launch failed
#   e. 40 pairs of competing name fences from one read value: exactly one wins in each pair
# Run: env -i HOME=/tmp/aosd7/home PATH=/usr/bin:/bin LANG=C.UTF-8 bash /tmp/aosd7/scripts/m4_name_fence.sh
set -u
SRV=aosd7-n1
SOCK=/tmp/tmux-$(id -u)/$SRV
[ -e "$SOCK" ] && { echo "$SOCK exists: not started by this script"; exit 1; }
t() { env -u TMUX /usr/bin/tmux -f /dev/null -L "$SRV" "$@"; }
N=cccccccccccc-app-1
K=$(printf %s "$N" | sha256sum | cut -c1-16)
OPT="@ao_name_$K"
ID='#{pid}/#{start_time}/#{'$OPT'}'
fence() { # fence <server pid> <start> <seen> <op>
  t if-shell -F "#{==:$ID,$1/$2/$3}" "set-option -s $OPT $4 ; display-message -p \"ao-name-fenced:#{pid}\"" \
    "display-message -p \"ao-name-fence-refused:$ID\"" 2>&1
}
create() { # create <server pid> <start> <op>: the guarded create of design r7 5.3
  t if-shell -F "#{==:$ID,$1/$2/$3}" \
    "new-session -d -s $N '/bin/sleep 600' ; set-option -t =$N: @ao_op $3 ; display-message -p \"ao-created:#{pid}\"" \
    "display-message -p \"ao-create-refused:$ID\"" 2>&1
}
srv() { t display-message -p '#{pid} #{start_time}' 2>/dev/null; }
stop_own() { # stop the own server by its PID after a start-time check, then remove its socket
  local p=$1 s=$2
  if [ -n "$p" ] && [ "$(t display-message -p '#{pid} #{start_time}' 2>/dev/null)" = "$p $s" ]; then kill -KILL "$p"; fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$p" 2>/dev/null || break; sleep 0.1; done
  [ -S "$SOCK" ] && rm -f "$SOCK"
}
echo "== a. no server"
out=$(create 0 0 op0); echo "guarded create: exit $? | $out | socket exists $( [ -S "$SOCK" ] && echo yes || echo no)"
echo "== b. a running server"
t new-session -d -s anchor '/bin/sleep 600'
read -r P S < <(srv); echo "server $P start_time $S"; echo "m4 server pid=$P" >> /tmp/aosd7/logs/pids.txt
echo "H0 fence: $(fence "$P" "$S" "" op0)"
echo "H1 fence: $(fence "$P" "$S" op0 op1)"
echo "H0 late create: $(create "$P" "$S" op0) | session exists $(t has-session -t "=$N" 2>/dev/null && echo yes || echo no)"
echo "H1 create: $(create "$P" "$S" op1) | @ao_op of the new session $(t display-message -p -t "=$N:" '#{@ao_op}')"
echo "H0 late create once more: $(create "$P" "$S" op0)"
echo "== c. another server on the same socket"
P0=$P S0=$S
stop_own "$P" "$S"
t new-session -d -s anchor '/bin/sleep 600'
read -r P S < <(srv); echo "server 2: $P start_time $S"; echo "m4 server2 pid=$P" >> /tmp/aosd7/logs/pids.txt
t set-option -s "$OPT" op0
echo "H0 late create on server 2 (its compare names server $P0/$S0): $(create "$P0" "$S0" op0) | session exists $(t has-session -t "=$N" 2>/dev/null && echo yes || echo no)"
echo "== e. competing name fences"
won=0
for i in $(seq 1 40); do
  seen=$(t display-message -p "#{$OPT}")
  ( fence "$P" "$S" "$seen" "a$i" > /tmp/aosd7/tmp/m4-a ) & ( fence "$P" "$S" "$seen" "b$i" > /tmp/aosd7/tmp/m4-b ) & wait
  n=$(cat /tmp/aosd7/tmp/m4-a /tmp/aosd7/tmp/m4-b | grep -c '^ao-name-fenced:')
  [ "$n" = 1 ] && won=$((won+1))
done
echo "pairs with exactly one fenced answer: $won of 40"
stop_own "$P" "$S"
echo "== d. the residual: no server, a plain new-session runs late"
echo "record: launchState=failed runtimeHandle=(none)"
t new-session -d -s "$N" '/bin/sleep 600'
read -r P S < <(srv); echo "m4 server3 pid=$P" >> /tmp/aosd7/logs/pids.txt
echo "late plain create: session exists $(t has-session -t "=$N" 2>/dev/null && echo yes || echo no), pane pid $(t display-message -p -t "=$N:" '#{pane_pid}')"
stop_own "$P" "$S"
echo "socket left $( [ -e "$SOCK" ] && echo yes || echo no); server processes left: $(for p in $(grep -o 'm4 server[0-9]* pid=[0-9]*' /tmp/aosd7/logs/pids.txt | cut -d= -f2); do kill -0 "$p" 2>/dev/null && echo -n "$p "; done)"
~~~
### /tmp/aosd7/scripts/m5_inventory.sh

~~~sh
#!/usr/bin/env bash
# m5 (design r7 section 7, the R2b-1 re-inventory): the line numbers of every tmux key, paste, buffer, kill and
# attach call of the landed send and tmux paths, read from main with git show (no checkout, no build).
# Run: bash /tmp/aosd7/scripts/m5_inventory.sh
R=/home/taisung/.worktrees/agent-orchestrator/ao-52
cd "$R" || exit 1
echo "main = $(git rev-parse --short main)"
show() { # show <path> <pattern>
  echo "== $1"
  git show "main:$1" | grep -n -E "$2" | sed -E 's/^([0-9]+):[[:space:]]*/:\1  /'
}
show packages/cli/src/commands/send.ts 'async function sendViaTmux|exec\("tmux", \[|await sendViaTmux|await tmux\("send-keys"|agent.name === "codex"|state === "waiting_input"|hasUnsubmittedCodexInput\(output\)|attempt < 3|sessionManager.send\('
show packages/core/src/tmux.ts 'await tmux\("(send-keys|load-buffer|paste-buffer|delete-buffer|kill-session|new-session)"|export async function (newSession|sendKeys|killSession)'
show packages/plugins/runtime-tmux/src/index.ts 'async (create|destroy|sendMessage|getAttachInfo)\(|await tmux\("(send-keys|load-buffer|paste-buffer|delete-buffer|kill-session)"|"new-session"'
show packages/cli/src/commands/session.ts 'getAttachInfo|args = \["attach"|spawn\(command, args'
echo "== the claude-code round on main (63932b9a..9938d5d1)"
git log --format='%h %s' 63932b9a^..9938d5d1
~~~
### /tmp/aosd7/scripts/m6_host_classes.mjs

~~~js
// m6 (design r7 sections 2.1 and 2.2): what the r7 precondition rules find on this host, read-only. For every
// process of the uid it reads stat, comm, the exe link and the descriptor links; it opens /proc/<pid>/environ
// and closes it without a read (only to see EACCES); it prints no argv and no environment of a process that is
// not mine, it connects to no tmux server that is not mine, and it never signals or waits on a process.
//   tmux servers: comm "tmux: server"; the listening Unix socket from the descriptor links and
//     /proc/<pid>/net/unix; whether that path is a socket now (stat only)
//   JS runtimes (P3): the exe basename after the " (deleted)" suffix is node, nodejs, bun or deno, or the comm
//     is node-MainThread
//   unreadable identity (P1u, P3u; OD-27 (b)): environ or exe gives EACCES
// Run: env -i HOME=/tmp/aosd7/home PATH=/tmp/aosd7/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd7/tmp \
//        node /tmp/aosd7/scripts/m6_host_classes.mjs $(cat ~/.agent-orchestrator/*/lifecycle-worker.pid 2>/dev/null)
import { closeSync, openSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
const UID = process.getuid();
const WORKERS = new Set(process.argv.slice(2).map(Number)); // the live PIDs of the lifecycle-worker.pid files, read by cat
const stat = (p) => { const s = readFileSync(`/proc/${p}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" "); return { state: f[0], ppid: Number(f[1]), ticks: f[19] }; };
const comm = (p) => { try { return readFileSync(`/proc/${p}/comm`, "utf8").trim(); } catch (e) { return e.code; } };
const exe = (p) => { try { return { ok: true, v: readlinkSync(`/proc/${p}/exe`) }; } catch (e) { return { ok: false, v: e.code }; } };
const environOpen = (p) => { try { closeSync(openSync(`/proc/${p}/environ`, "r")); return "ok"; } catch (e) { return e.code; } };
const JS = new Set(["node", "nodejs", "bun", "deno"]);
const servers = [], js = [], unreadable = [];
let total = 0, zombies = 0;
for (const d of readdirSync("/proc")) {
  if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
  const pid = Number(d);
  try {
    if (statSync(`/proc/${d}`).uid !== UID) continue;
    const st = stat(pid);
    if (st.state === "Z") { zombies++; continue; }
    total++;
    const c = comm(pid), e = exe(pid), env = environOpen(pid);
    const base = e.ok ? e.v.replace(/ \(deleted\)$/, "").split("/").at(-1) : null;
    const label = WORKERS.has(pid) ? " (a real lifecycle worker)" : "";
    if (!e.ok || env !== "ok") unreadable.push(`pid=${pid} comm=${c} parent-comm=${comm(st.ppid)} exe=${e.ok ? "ok" : e.v} environ=${env}`);
    if (c === "tmux: server") {
      const inodes = new Set();
      for (const fd of readdirSync(`/proc/${pid}/fd`)) { try { const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m) inodes.add(m[1]); } catch {} }
      const paths = readFileSync(`/proc/${pid}/net/unix`, "utf8").split("\n").slice(1).map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 8 && inodes.has(f[6]) && (parseInt(f[3], 16) & 0x10000) !== 0).map((f) => f.slice(7).join(" "));
      const sock = paths.map((p) => { try { return `${p} (socket now: ${statSync(p).isSocket()})`; } catch (er) { return `${p} (${er.code})`; } });
      servers.push(`pid=${pid} listening ${JSON.stringify(sock)}`);
    }
    if ((base && JS.has(base)) || c === "node-MainThread") js.push(`pid=${pid} comm=${c} exe-base=${base ?? e.v} parent-comm=${comm(st.ppid)}${label}`);
  } catch {}
}
console.log(`processes of uid ${UID}: ${total} (zombies skipped: ${zombies})`);
console.log(`tmux servers: ${servers.length}`); for (const s of servers) console.log(`  ${s}`);
console.log(`JS runtimes (P3): ${js.length}`); for (const s of js) console.log(`  ${s}`);
console.log(`unreadable identity (OD-27 (b) blocks unless allowed): ${unreadable.length}`); for (const s of unreadable) console.log(`  ${s}`);
~~~
### /tmp/aosd7/scripts/val7.sh

~~~sh
#!/usr/bin/env bash
# val7.sh: run the r7 test files, the changed r6 core file, the r5 core file and the r6 tmux file against the
# scratch prototypes of design r7 (/tmp/aosd7/val/core/{inbox.ts,fleet-barrier.ts}, /tmp/aosd7/val/dist/inbox.js,
# /tmp/aosd7/val/tmux/runtime-proto.ts with dist/runtime.js, and the unchanged session-fence prototype
# assoc-proto.ts with dist/core.js), to check that a correct implementation of the r7 rules turns the defects green.
# The test files are copied to /tmp/aosd7/val with sed; only import specifiers change. Nothing in the worktree
# changes. Red mode: every defect runs as a plain test. AOSD7_SCOPE_HOME=/tmp/aosd7/ limits a barrier call without
# a process scope to the processes whose HOME is under /tmp/aosd7 (the test runs and their fixtures; validation
# only, see fleet-barrier.ts), so that it does not see the real fleet or the shell of this agent (which has AO_*).
# With "nofence" as $1, only the tmux r7 file runs, with the flag file /tmp/aosd7/val/tmux/nofence: the prototype
# keeps fenceName, and its create does not compare (a discrimination check of the two defects).
set -e
S=/tmp/aosd7; V=$S/val; W=/home/taisung/.worktrees/agent-orchestrator/ao-52; C=$W/packages/core/src; T=$W/packages/plugins/runtime-tmux/src
mkdir -p $V/core/__tests__ $V/tmux/__tests__
[ -e $V/core/node_modules ] || ln -s $W/packages/core/node_modules $V/core/node_modules
[ -e $V/tmux/node_modules ] || ln -s $W/packages/plugins/runtime-tmux/node_modules $V/tmux/node_modules
touch $V/dist/inbox.js # not older than the in-process face
core() { sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" \
  -e "s#new URL(\"\.\./\.\./dist/agent-workspace-hooks\.js\", import\.meta\.url)#new URL(\"file://$W/packages/core/dist/agent-workspace-hooks.js\")#" \
  -e 's#^      writer: AO_METADATA_HELPER,$#      writer: mod["WRITER"] as string,#' "$1" > "$2"; }
core $C/__tests__/same-id-defects-r7.test.ts $V/core/__tests__/same-id-defects-r7.test.ts
core $C/__tests__/same-id-defects-r6.test.ts $V/core/__tests__/same-id-defects-r6.test.ts
core $C/__tests__/same-id-defects-r5.test.ts $V/core/__tests__/same-id-defects-r5.test.ts
FENCE_SPEC="file://$V/tmux/dist/runtime.js"
FACE="$V/tmux/runtime-proto.ts"
rm -f $V/tmux/nofence; [ "${1:-}" = nofence ] && touch $V/tmux/nofence
sed -e "s#from \"\.\./index\.js\"#from \"$FACE\"#" \
  -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"$FENCE_SPEC\")#" \
  $T/__tests__/same-id-defects-r7.test.ts > $V/tmux/__tests__/same-id-defects-r7.test.ts
sed -e 's#import \* as core from "@aoagents/ao-core";#import * as core from "../assoc-proto.ts";#' \
  -e "s#from \"\.\./index\.js\"#from \"$T/index.ts\"#" \
  -e "s#new URL(\"\.\./\.\./\.\./\.\./core/dist/index\.js\", import\.meta\.url)#new URL(\"file://$V/tmux/dist/core.js\")#" \
  -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"file://$W/packages/plugins/runtime-tmux/dist/index.js\")#" \
  $T/__tests__/same-id-defects-r6.test.ts > $V/tmux/__tests__/same-id-defects-r6.test.ts
run() {
  (cd "$1" && env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp AOSD7_SCOPE_HOME=$S/ \
    PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run --root "$1" "${@:2}" 2>&1) |
    sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ *(✓|×|↓)|→|Tests ' | sed -e 's/^ *//' -e 's/ [0-9]*ms$//' | cut -c1-240
}
if [ "${1:-}" != nofence ]; then
  echo "== core r7 against inbox.ts and fleet-barrier.ts (prototypes)"; run $V/core __tests__/same-id-defects-r7.test.ts
  echo "== core r6 (changed) against inbox.ts and fleet-barrier.ts (prototypes)"; run $V/core __tests__/same-id-defects-r6.test.ts
  echo "== core r5 against inbox.ts and fleet-barrier.ts (prototypes)"; run $V/core __tests__/same-id-defects-r5.test.ts
  echo "== runtime-tmux r6 against assoc-proto.ts (the session fence, unchanged)"; run $V/tmux __tests__/same-id-defects-r6.test.ts
fi
echo "== runtime-tmux r7 against ${FACE##*/} ($([ "${1:-}" = nofence ] && echo "fenceName kept, the create does not compare" || echo "the name fence prototype"))"; run $V/tmux __tests__/same-id-defects-r7.test.ts
rm -f $V/tmux/nofence
~~~
### /tmp/aosd7/scripts/vt.sh

~~~sh
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd7
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
~~~
### /tmp/aosd7/scripts/redcount.sh

~~~sh
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged"), and per design
# round when the tag is followed by one in parentheses ("[same-id R3] (RW)").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd7/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd7/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd7/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
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
        m = re.search(r"\[same-id (R\d)\](?: \(([^)]+)\))?", full)
        tag = (m.group(1) + (f" ({m.group(2)})" if m.group(2) else "")) if m else "untagged"
        c[(tag, a["status"])] += 1
rows = sorted(set(t for t, _ in c))
print(f + ": " + ", ".join(f"{t} {c[(t,'failed')]} failed/{c[(t,'passed')]} passed" + (f"/{c[(t,'skipped')]+c[(t,'pending')]} skipped" if c[(t,'skipped')]+c[(t,'pending')] else "") for t in rows))
PY
done
cat "$OUT"
~~~
### /tmp/aosd7/scripts/quotes7.py

~~~python
# quotes7.py: make the failure quotes and the test tables of design r7 section 10 from the vitest JSON reports of
# the red runs (/tmp/aosd7/logs/red-<name>.json): fail-<name>.txt (each failed test and the first line of its
# failure, ANSI codes removed) and table-<name>.md (each test and its kind: a test that fails in red mode is a
# defect, one that passes is a control). Run: python3 -I /tmp/aosd7/scripts/quotes7.py
import json, re
for name in ("core-r7", "core-r6", "tmux-r7"):
    rep = json.load(open(f"/tmp/aosd7/logs/red-{name}.json"))
    fails, rows = [], []
    for f in rep["testResults"]:
        for t in f["assertionResults"]:
            title = " > ".join(t["ancestorTitles"][1:] + [t["title"]]) if len(t["ancestorTitles"]) > 1 else t["title"]
            kind = "defect" if t["status"] == "failed" else "control" if t["status"] == "passed" else t["status"]
            rows.append(f"| {title.replace('|', '/')} | {kind} |")
            if t["status"] == "failed":
                msg = re.sub(r"\x1b\[[0-9;]*m", "", t["failureMessages"][0]).splitlines()[0]
                fails.append(f"{title}\n  {msg}\n")
    open(f"/tmp/aosd7/logs/fail-{name}.txt", "w").write("\n".join(fails))
    open(f"/tmp/aosd7/logs/table-{name}.md", "w").write("\n".join(rows) + "\n")
    print(name, len(rows), "tests,", len(fails), "failed")
~~~
### /tmp/aosd7/scripts/sec0_procs.py

~~~python
# sec0_procs.py: list the processes of this uid that name /tmp/aosd7 or an aosd7- server in their argv, or whose
# cwd or exe lies under /tmp/aosd7, or that hold the marker HOME (HOME=/tmp/aosd7/...), excluding this scan and
# its ancestors. It prints PID and comm of a match only (a match is mine); it prints nothing of other processes.
# Run: python3 -I /tmp/aosd7/scripts/sec0_procs.py
import os
uid, me = os.getuid(), os.getpid()
anc, p = set(), me
while p > 1:
    anc.add(p)
    try: p = int(open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()[1])
    except OSError: break
hits = []
for d in os.listdir("/proc"):
    if not d.isdigit() or int(d) in anc: continue
    try:
        if os.stat(f"/proc/{d}").st_uid != uid: continue
        argv = open(f"/proc/{d}/cmdline", "rb").read()
        mine = b"/tmp/aosd7" in argv or b"aosd7-" in argv
        for link in ("cwd", "exe"):
            try: mine = mine or os.readlink(f"/proc/{d}/{link}").startswith("/tmp/aosd7")
            except OSError: pass
        try: mine = mine or b"\0HOME=/tmp/aosd7" in b"\0" + open(f"/proc/{d}/environ", "rb").read()
        except OSError: pass
        if mine: hits.append((int(d), open(f"/proc/{d}/comm").read().strip()))
    except OSError: continue
print(f"processes of uid {uid} that are mine (excluding this scan and its {len(anc)} ancestors): {len(hits)}")
for pid, comm in sorted(hits): print(pid, comm)
~~~
### /tmp/aosd7/val/dist/inbox.js

~~~js
// Validation prototype (scratch only) of design r7 section 3: the inbox of RW, plain JS on the built record
// functions of the worktree (c8751762). Each operation runs in ONE record-lock hold; the recovery of an archive
// intent runs first. Changes against the r6 prototype:
//   3.2 step 5: after an exception of the record write, re-read the record in the same hold; it names L: keep the
//       file, the launch began; absent or another launch: remove the file, refuse; the read fails: keep, refuse.
//   3.3: the publish applies the complete records within its budget and writes them, the cursor and
//       launchState=published in ONE record write.
//   3.4: the archived inbox is .inbox-archive/<id>_<ts>/ (outside the record namespace); <ts> is max(now, the last
//       <ts> of the ID + 1 ms); the record archive is archive/<id>_<ts> (written here, then deleteMetadata without
//       an archive, because c8751762 deleteMetadata makes its own name).
//   3.6: prune keeps every file when the record read fails.
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as M from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js";

const RS = 0x1e, LF = 0x0a, CHUNK = 65536, MAX_REC = 4096, CAP = 1 << 20;
export const WRITER = readFileSync("/tmp/aosd7/val/i6_writer.sh", "utf8").replace(/\nao_inbox_append "\$@"\n$/, "\n").replace(/ao_inbox_append/g, "update_ao_metadata");
const box = (d, id) => join(d, ".inbox", id);
export const archivedInboxPath = (d, id, ts) => join(d, ".inbox-archive", `${id}_${ts}`);
const identity = (r) => ({ ...M.launchIdentity(r), launchId: r.launchId ?? "", archiveIntent: r.archiveIntent ?? "" });
const syncDir = (p) => { const fd = openSync(p, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } };
const TS = /^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/;
const msOf = (ts) => { const m = TS.exec(ts); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null; };
const tsOf = (ms) => new Date(ms).toISOString().replace(/[:.]/g, "-");
/** Design r7 3.4: the archive time of the next archive of the ID (the caller holds the record lock). */
function nextTs(d, id) {
  let last = -1;
  for (const sub of ["archive", ".inbox-archive"]) {
    for (const f of existsSync(join(d, sub)) ? readdirSync(join(d, sub)) : []) {
      if (!f.startsWith(`${id}_`)) continue;
      const ms = msOf(f.slice(id.length + 1));
      if (ms !== null && ms > last) last = ms;
    }
  }
  return tsOf(Math.max(Date.now(), last + 1));
}
/** A strict read: the record, null when it does not exist, or an error code. */
function readStrict(d, id) {
  try { readFileSync(join(d, id)); } catch (e) { return e.code === "ENOENT" ? { ok: true, r: null } : { ok: false, code: e.code ?? String(e) }; }
  return { ok: true, r: M.readMetadataRaw(d, id) };
}

/** Design r7 3.4, the recovery of an archive intent; the caller holds the record lock. */
function finish(d, id) {
  const r = M.readMetadataRaw(d, id);
  if (!r?.archiveIntent) return "nothing";
  const ts = r.archiveIntent, dst = archivedInboxPath(d, id, ts);
  const src = existsSync(box(d, id)), moved = existsSync(dst);
  if (src && moved) return "inbox damaged";
  if (!src && !moved && r.launchId) return "inbox damaged";
  if (src) {
    mkdirSync(join(d, ".inbox-archive"), { recursive: true });
    renameSync(box(d, id), dst);
    syncDir(join(d, ".inbox-archive")); syncDir(join(d, ".inbox"));
  }
  mkdirSync(join(d, "archive"), { recursive: true });
  const copy = join(d, "archive", `${id}_${ts}`), content = readFileSync(join(d, id), "utf8");
  if (existsSync(copy) && readFileSync(copy, "utf8") !== content) return "inbox damaged"; // the name is taken
  writeFileSync(copy, content);
  syncDir(join(d, "archive"));
  M.deleteMetadata(d, id, false, { archiveIntent: ts });
  return "finished";
}
export const recoverArchive = (d, id) => M.withRecordLock(d, id, () => finish(d, id));

export function beginLaunch(d, id, o = {}) {
  return M.withRecordLock(d, id, () => {
    if (finish(d, id) === "inbox damaged") throw new Error("inbox damaged");
    const r = M.readMetadataRaw(d, id);
    const fresh = o.spawn || o.archived;
    if (fresh ? r !== null : r === null) throw new Error(fresh ? "the ID is taken" : "no record to restore");
    const L = randomBytes(16).toString("hex");
    mkdirSync(box(d, id), { recursive: true, mode: 0o700 });
    const f = join(box(d, id), `${L}.ndjson`);
    const fd = openSync(f, "wx", 0o600); try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDir(box(d, id));
    let refused = null;
    try {
      o.onCandidate?.();
      const fields = { launchId: L, launchState: "preparing", inboxCursor: "" };
      let ok;
      if (o.spawn) ok = M.reserveSessionRecord(d, id, fields);
      else if (o.archived) {
        const a = M.readArchivedMetadataRaw(d, id);
        if (a) {
          const { archiveIntent: _i, inboxCursor: _c, launchState: _s, ...kept } = a;
          ok = M.reserveSessionRecord(d, id, { ...kept, ...fields }, o.expected ?? {});
        }
      } else ok = M.updateMetadataIf(d, id, o.expected ?? identity(r), fields);
      if (ok) return L;
      refused = new Error("the launch changed"); // a definite refusal: nothing was written
    } catch (e) {
      // 3.2 step 5: an exception is not a refusal. Read the record again in this hold.
      const now = readStrict(d, id);
      if (!now.ok) throw new Error(`the launch state is unknown (${now.code}); ${L}.ndjson is kept`, { cause: e });
      if (now.r?.launchId === L) return L; // the write committed
      refused = e;
    }
    unlinkSync(f);
    throw refused;
  });
}
function select(r) {
  if (r.archiveIntent || !r.launchId || r.launchState !== "published") return null;
  return { file: `${r.launchId}.ndjson`, launch: r.launchId };
}
function parse(buf, launch, atEof) {
  let pos = 0, pending = false; const upd = {};
  while (pos < buf.length) {
    if (buf[pos] !== RS) { const j = buf.indexOf(RS, pos); pos = j < 0 ? buf.length : j; continue; }
    const next = buf.indexOf(RS, pos + 1), lf = buf.indexOf(LF, pos);
    if (lf >= 0 && (next < 0 || lf < next)) {
      if (lf - pos + 1 <= MAX_REC) {
        const f = buf.subarray(pos + 1, lf).toString("latin1").split(" ");
        if (f.length === 5 && f[0] === "1" && f[1] === launch && ["pr", "status", "branch"].includes(f[2])) upd[f[2]] = Buffer.from(f[3], "hex").toString("utf8");
      }
      pos = lf + 1; continue;
    }
    if (next >= 0) { pos = next; continue; }
    if (buf.length - pos >= MAX_REC) { pos = buf.length; continue; }
    if (atEof) pending = true;
    break;
  }
  return { pos, upd, pending };
}
export function applyInbox(d, id) {
  return M.withRecordLock(d, id, () => {
    const r = M.readMetadataRaw(d, id) ?? {}; const sel = select(r);
    if (!sel) return { more: false };
    const fd = openSync(join(box(d, id), sel.file), "r");
    try {
      const st = fstatSync(fd);
      const cur = r.inboxCursor ? JSON.parse(r.inboxCursor) : { launch: sel.launch, dev: st.dev, ino: st.ino, off: 0 };
      if (cur.launch !== sel.launch || cur.dev !== st.dev || cur.ino !== st.ino || cur.off > st.size) return { more: false };
      const n = Math.min(CHUNK, st.size - cur.off); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, cur.off);
      const p = parse(buf, sel.launch, cur.off + n === st.size);
      const off = cur.off + p.pos;
      if (p.pos > 0) M.updateMetadata(d, id, { ...p.upd, inboxCursor: JSON.stringify({ ...cur, off }) });
      return { more: off < st.size && !p.pending, off, size: st.size };
    } finally { closeSync(fd); }
  });
}
/** Design r7 3.3: the complete records within the budget, their cursor and the state in ONE record write. */
export function publishLaunch(d, id, L, fields, o = {}) {
  M.withRecordLock(d, id, () => {
    const r = M.readMetadataRaw(d, id) ?? {};
    if (r.launchId !== L || r.launchState !== "preparing" || r.archiveIntent) throw new Error("the launch changed");
    const fd = openSync(join(box(d, id), `${L}.ndjson`), "r");
    try {
      const st = fstatSync(fd);
      const n = Math.min(st.size, o.budgetBytes ?? CAP);
      const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, 0);
      const p = parse(buf, L, false);
      M.updateMetadata(d, id, { ...fields, ...p.upd, launchState: "published", inboxCursor: JSON.stringify({ launch: L, dev: st.dev, ino: st.ino, off: p.pos }) });
    } finally { closeSync(fd); }
  });
}
export function catchUpInbox(d, id) {
  const r = M.readMetadataRaw(d, id) ?? {}; const sel = select(r);
  if (!sel) return { complete: true, launchId: r.launchId ?? "", dev: null, ino: null, s0: 0 };
  const fd = openSync(join(box(d, id), sel.file), "r"); const st = fstatSync(fd); closeSync(fd);
  const t0 = performance.now();
  for (;;) {
    const res = applyInbox(d, id);
    if (!res.more || (res.off ?? 0) >= st.size) return { complete: true, launchId: sel.launch, dev: st.dev, ino: st.ino, s0: st.size };
    if (performance.now() - t0 > 5_000) return { complete: false, launchId: sel.launch, dev: st.dev, ino: st.ino, s0: st.size };
  }
}
export function archiveLaunch(d, id, L) {
  const frozen = catchUpInbox(d, id);
  if (!frozen.complete) throw new Error("backlog");
  M.withRecordLock(d, id, () => {
    const r = M.readMetadataRaw(d, id);
    if (!r || r.launchId !== L || r.archiveIntent || frozen.launchId !== L) throw new Error("the launch changed: run again");
    if (frozen.ino !== null) {
      const st = statSync(join(box(d, id), `${L}.ndjson`));
      if (st.dev !== frozen.dev || st.ino !== frozen.ino) throw new Error("the launch changed: run again");
    }
    const ts = nextTs(d, id);
    if (!M.updateMetadataIf(d, id, identity(r), { archiveIntent: ts })) throw new Error("the launch changed");
    const a = finish(d, id);
    if (a !== "finished") throw new Error(a);
  });
}
export function pruneInbox(d, id) {
  return M.withRecordLock(d, id, () => {
    if (finish(d, id) === "inbox damaged" || !existsSync(box(d, id))) return [];
    const now = readStrict(d, id);
    if (!now.ok) return []; // unknown: nothing is obsolete
    const named = now.r?.launchId;
    const removed = [];
    for (const f of readdirSync(box(d, id))) {
      if (f !== `${named}.ndjson` && statSync(join(box(d, id), f)).size === 0) { unlinkSync(join(box(d, id), f)); removed.push(f); }
    }
    return removed;
  });
}
export function recoverInterruptedRecords(d) {
  return M.listMetadata(d).map((id) => ({
    sessionId: id,
    result: M.withRecordLock(d, id, () => {
      const a = finish(d, id);
      if (a !== "nothing") return a;
      const r = M.readMetadataRaw(d, id);
      if (r?.launchState === "preparing" && M.updateMetadataIf(d, id, { launchId: r.launchId, launchState: "preparing" }, { launchState: "failed" })) return "failed";
      return "nothing";
    }),
  }));
}
~~~
### /tmp/aosd7/val/core/inbox.ts

~~~ts
// Validation prototype (scratch only) of design r7 section 3: the in-process face of /tmp/aosd7/val/dist/inbox.js
// (the child process of the core tests imports that file directly).
export * from "/tmp/aosd7/val/dist/inbox.js";
~~~
### /tmp/aosd7/val/core/fleet-barrier.ts

~~~ts
// Validation prototype (scratch only) of design r7 section 2.3: checkFleetAndFence. Check 1, the record step, the
// inbox directories, the fence by rename, check 2; it never waits and never signals. Each check reads the process
// list until a read finds no new PID (at most 5 reads, else it blocks), and classifies each process of the uid:
//   P1  an AO_* key in /proc/<pid>/environ (host-wide: every key blocks, whatever root it names); P1u: EACCES
//   P2  a pane of an AO-named session (<12 hex>-...) on a tmux server that the check found: every process with
//       comm "tmux: server", mapped to its listening Unix socket by its descriptor links and /proc/<pid>/net/unix,
//       and queried there; the answer must name that PID. P2u: a server that no path reaches (blocks)
//   P3  a JS runtime: the exe basename after the " (deleted)" suffix is node, nodejs, bun or deno, or the comm is
//       node-MainThread; P3u: the exe link gives EACCES
//   P4  W1 and W2 of design r5 2.3 (as the r6 prototype)
// An allow is exact and scoped to one rule: { pid, startTicks, rule }; the r5 and r6 test seam `allow` stays.
// Validation only: with AOSD7_SCOPE_HOME=<prefix> and no processScope, the check considers only the processes whose
// HOME starts with <prefix> (the fake HOME of the test runs and their fixtures), so that a validation run on this
// host does not see the real fleet. It compares the HOME value and prints no value. Not in the design.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { recoverInterruptedRecords } from "./inbox.ts";

interface Options {
  install: Array<{ path: string; content: string; mode: number }>;
  sessionsDirs: string[];
  allow?: (p: { pid: number; rule: string }) => boolean;
  allowEntries?: Array<{ pid: number; startTicks: string; rule: string }>;
  tmuxSockets?: string[];
  tmuxSocketDir?: string;
  processScope?: (pid: number) => boolean;
  onCheck?: (check: number) => void;
  onEnumerated?: (p: { check: number; listing: number }) => void;
}
type Blocking = { pid: number; rule: string; comm?: string };
const INTERPRETERS = new Set(["bash", "sh", "dash"]);
const JS = new Set(["node", "nodejs", "bun", "deno"]);
const UID = process.getuid?.() ?? -1;
const inode = (p: string) => { const s = statSync(p); return `${s.dev}:${s.ino}`; };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const stat = (pid: number) => { const s = readFileSync(`/proc/${pid}/stat`, "utf8"); const f = s.slice(s.lastIndexOf(")") + 2).split(" "); return { state: f[0], session: f[3], ticks: f[19] ?? "" }; };
const comm = (pid: number) => { try { return readFileSync(`/proc/${pid}/comm`, "utf8").trim(); } catch { return ""; } };
const code = (e: unknown) => (e as NodeJS.ErrnoException).code ?? "";

function listeningSockets(pid: number): string[] {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try { const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m?.[1]) inodes.add(m[1]); } catch { /* closed */ }
  }
  return readFileSync(`/proc/${pid}/net/unix`, "utf8").split("\n").slice(1).map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length >= 8 && inodes.has(f[6] ?? "") && (parseInt(f[3] ?? "0", 16) & 0x10000) !== 0)
    .map((f) => f.slice(7).join(" "));
}
function panesOf(sock: string): string[] | null {
  const r = spawnSync("tmux", ["-S", sock, "list-panes", "-a", "-F", "#{session_name} #{pane_pid}"], { encoding: "utf8", timeout: 5_000 });
  return r.status === 0 ? r.stdout.trim().split("\n").filter(Boolean) : null;
}

function check(o: Options, fenced: boolean, n: number): Blocking[] {
  const current = new Map(o.install.map((f) => [real(f.path), existsSync(f.path) ? inode(f.path) : ""]));
  const names = new Set(o.install.map((f) => basename(f.path)));
  const sess = new Set(o.sessionsDirs.map(real));
  const prefix = process.env["AOSD7_SCOPE_HOME"];
  const homeIn = (pid: number) => { try { return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").some((x) => x.startsWith(`HOME=${prefix}`)); } catch { return false; } };
  const scoped = (pid: number) => o.processScope ? o.processScope(pid) : prefix ? homeIn(pid) : true;
  const out: Blocking[] = [];
  const add = (pid: number, rule: string) => {
    let t = ""; try { t = stat(pid).ticks; } catch { return; }
    if (o.allow?.({ pid, rule })) return;
    if ((o.allowEntries ?? []).some((e) => e.pid === pid && e.rule === rule && e.startTicks === t)) return;
    out.push({ pid, rule, comm: comm(pid) });
  };
  // The process list, read until a read finds no new PID.
  const seen = new Set<string>();
  const pids: number[] = [];
  let settled = false;
  for (let listing = 1; listing <= 5; listing++) {
    const fresh = readdirSync("/proc").filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid && !seen.has(d));
    o.onEnumerated?.({ check: n, listing });
    let found = 0;
    for (const d of fresh) {
      seen.add(d);
      try { if (statSync(`/proc/${d}`).uid !== UID || !scoped(Number(d)) || stat(Number(d)).state === "Z") continue; } catch { continue; }
      pids.push(Number(d));
      found++;
    }
    // Settled: a read after the first one finds no new live process of the uid in scope.
    if (found === 0 && listing > 1) { settled = true; break; }
  }
  if (!settled) out.push({ pid: 0, rule: "the process list did not settle" });
  // P2: the servers of the scope, and the sockets that the caller names.
  const aoPanes = new Set<number>();
  const scan = (lines: string[]) => { for (const l of lines) if (/^[0-9a-f]{12}-/.test(l)) aoPanes.add(Number(l.split(" ")[1])); };
  for (const pid of pids) {
    if (comm(pid) !== "tmux: server") continue;
    let reached = false;
    try {
      for (const p of listeningSockets(pid)) {
        const r = spawnSync("tmux", ["-S", p, "display-message", "-p", "#{pid}"], { encoding: "utf8", timeout: 5_000 });
        if (r.status !== 0 || Number(r.stdout.trim()) !== pid) continue;
        const panes = panesOf(p);
        if (panes) { scan(panes); reached = true; break; }
      }
    } catch { /* unreadable: unresolved */ }
    if (!reached) add(pid, "P2u");
  }
  for (const s of o.tmuxSockets ?? []) { const panes = panesOf(s); if (panes) scan(panes); }
  for (const pid of pids) {
    const d = String(pid);
    try { const env = readFileSync(`/proc/${d}/environ`, "utf8"); if (env.split("\0").some((x) => x.startsWith("AO_"))) add(pid, "P1"); }
    catch (e) { if (code(e) === "EACCES") add(pid, "P1u"); else if (code(e) !== "ENOENT" && code(e) !== "ESRCH") add(pid, "P1u"); }
    if (aoPanes.has(pid)) add(pid, "P2");
    let exe = "";
    try { exe = basename(readlinkSync(`/proc/${d}/exe`).replace(/ \(deleted\)$/, "")); }
    catch (e) { if (code(e) === "EACCES") add(pid, "P3u"); }
    if (JS.has(exe) || comm(pid) === "node-MainThread") add(pid, "P3");
    let argv: string[];
    try { argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { continue; }
    if (argv.length === 0) continue;
    if (exe === "") exe = basename(argv[0] ?? "");
    let cwd: string | null | undefined;
    const abs = (a: string) => { if (isAbsolute(a)) return a; if (cwd === undefined) { try { cwd = readlinkSync(`/proc/${d}/cwd`); } catch { cwd = null; } } return cwd ? resolve(cwd, a) : null; };
    const w2 = argv.slice(1).some((a) => { if (!a.includes("/")) return false; const x = abs(a); if (x === null) return true;
      return sess.has(real(dirname(x))) && /^[^./][^/]*?(\.tmp(\.\d+)?)?$/.test(basename(x)); });
    if (w2) { add(pid, "P4 W2"); continue; }
    if (!INTERPRETERS.has(exe)) continue;
    const named = argv.slice(1).map((a) => { const x = abs(a); return x === null ? null : real(x); })
      .find((x, i) => (x !== null && current.has(x)) || ((x === null || !existsSync(x)) && names.has(basename(argv[i + 1] ?? ""))));
    if (named === undefined) continue;
    if (!fenced) { add(pid, "P4 W1"); continue; }
    let fds: string[] | null;
    try { fds = readdirSync(`/proc/${d}/fd`).flatMap((fd) => { try { const s = statSync(`/proc/${d}/fd/${fd}`); return [`${s.dev}:${s.ino}`]; } catch { return []; } }); } catch (e) { fds = code(e) === "ENOENT" ? [] : null; }
    const cur = named === null ? undefined : current.get(named);
    if (!(fds !== null && cur !== undefined && fds.includes(cur))) add(pid, "P4 W1");
  }
  return out;
}

export async function checkFleetAndFence(o: Options): Promise<{ admitted: boolean; blocking: Blocking[] }> {
  const first = check(o, false, 1);
  o.onCheck?.(1);
  if (first.length) return { admitted: false, blocking: first };
  for (const d of o.sessionsDirs) {
    const step = recoverInterruptedRecords(d) as Array<{ sessionId: string; result: string }>;
    if (step.some((s) => s.result === "inbox damaged")) return { admitted: false, blocking: [{ pid: 0, rule: "inbox damaged" }] };
    mkdirSync(join(d, ".inbox"), { recursive: true });
    closeSync(openSync(join(d, ".inbox", "orphans.ndjson"), "a"));
  }
  for (const f of o.install) { writeFileSync(`${f.path}.ao-new`, f.content, { mode: f.mode }); renameSync(`${f.path}.ao-new`, f.path); }
  const second = check(o, true, 2);
  o.onCheck?.(2);
  return { admitted: second.length === 0, blocking: second };
}
~~~
### /tmp/aosd7/val/tmux/dist/runtime.js

~~~js
// Validation prototype (scratch only) of design r7 section 5.3: the name fence of runtime-tmux (R2b-2, OD-28 (b)),
// plain JS on the built runtime-tmux of the worktree (c8751762).
//   fenceName(name, op): read "#{pid}/#{start_time}/#{@ao_name_<k>}" (k: the first 16 hex digits of the SHA-256 of
//     the name), then one gated command that sets @ao_name_<k> to op when the three values are still the ones read;
//     up to 3 tries. No server runs: { fenced: false, server: null } (the residual of 5.4).
//   create(config) with config.operation = { id, server }: ONE gated command that compares the server PID, its start
//     time and @ao_name_<k> with { server, id }, then runs new-session and sets @ao_op of the new session to id; the
//     launch command goes in a command that compares @ao_op. Without an operation (or without a server), the
//     create of today.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as base from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/plugins/runtime-tmux/dist/index.js";

const run = promisify(execFile);
// Discrimination check only: with this flag file the create keeps fenceName but does not compare (val7.sh nofence).
const NOFENCE = existsSync("/tmp/aosd7/val/tmux/nofence");
const tmux = async (args) => (await run("tmux", args, { timeout: 5_000 })).stdout.trim();
const optOf = (name) => `@ao_name_${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
const q = (s) => `"${String(s).replace(/(["\\$])/g, "\\$1")}"`;

export function create() {
  const rt = base.create();
  return {
    ...rt,
    async fenceName(name, op) {
      const opt = optOf(name);
      const id = `#{pid}/#{start_time}/#{${opt}}`;
      for (let i = 0; i < 3; i++) {
        let seen;
        try {
          seen = await tmux(["display-message", "-p", id]);
        } catch (e) {
          if (/no server running|error connecting/.test(String(e?.stderr ?? ""))) return { fenced: false, server: null };
          throw e;
        }
        const [pid, startTime] = seen.split("/");
        const out = await tmux(["if-shell", "-F", `#{==:${id},${seen}}`,
          `set-option -s ${opt} ${op} ; display-message -p ${q("ao-name-fenced:#{pid}")}`,
          `display-message -p ${q(`ao-name-fence-refused:${id}`)}`]);
        if (out.startsWith("ao-name-fenced:")) return { fenced: true, server: { pid, startTime } };
      }
      throw new Error(`the session name ${name} changed: run again`);
    },
    async create(config) {
      const op = config.operation;
      if (!op?.server) return rt.create(config);
      const name = config.sessionId, opt = optOf(name);
      const id = `#{pid}/#{start_time}/#{${opt}}`;
      const out = await tmux(["if-shell", "-F", NOFENCE ? "1" : `#{==:${id},${op.server.pid}/${op.server.startTime}/${op.id}}`,
        `new-session -d -s ${name} -c ${q(config.workspacePath)} ; set-option -t =${name}: @ao_op ${op.id} ; display-message -p ${q("ao-created:#{pid}")}`,
        `display-message -p ${q(`ao-create-refused:${id}`)}`]);
      if (!out.startsWith("ao-created:")) throw new Error(`the create of ${name} was refused: ${out}`);
      await tmux(["if-shell", "-F", "-t", `=${name}:`, `#{==:#{@ao_op},${op.id}}`,
        `send-keys -t =${name}: ${q(config.launchCommand)} Enter`, `display-message -p ${q("ao-refused")}`]);
      return { id: name, runtimeName: "tmux", data: { createdAt: Date.now(), workspacePath: config.workspacePath } };
    },
  };
}
export default { create };
~~~
### /tmp/aosd7/val/tmux/runtime-proto.ts

~~~ts
// Validation prototype (scratch only) of design r7 section 5.3: the in-process face of
// /tmp/aosd7/val/tmux/dist/runtime.js (the old holder of the tmux r7 test imports that file directly).
export * from "/tmp/aosd7/val/tmux/dist/runtime.js";
~~~
### /tmp/aosd7/val/tmux/assoc-proto.ts

~~~ts
// Validation prototype (scratch only) of design r6 section 6 (the session fence, unchanged in r7): the in-process
// face of /tmp/aosd7/val/tmux/dist/core.js.
export * from "/tmp/aosd7/val/tmux/dist/core.js";
~~~
### /tmp/aosd7/val/tmux/dist/core.js

~~~js
// Validation prototype (scratch only) of design r6 section 6: the association of R2b-2 with the tmux fence
// @ao_op, plain JS (the old holder process of the runtime-tmux r6 test imports it as "core"). Every holder takes
// the operation lock (an abstract socket), reads @ao_op, fences it from that value to its own operation ID with
// one gated command, and puts @ao_op = its ID into the compare of every association command. No stale-client
// wait. Record steps: the real built record functions with a compare of the launch identity.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
// A negative check of the test: with this flag file, no fence runs and the operation ID is empty.
const NOFENCE = existsSync("/tmp/aosd7/val/tmux/nofence");
import * as M from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/index.js";
export * from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/index.js";

const q = (f) => `"${f}"`;
const tmux = (args) => new Promise((resolve) => {
  const c = spawn("tmux", args, { stdio: ["ignore", "pipe", "ignore"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.once("exit", () => resolve(out));
});
const answer = (out) => out.split("\n").find((l) => /^ao-(assoc|refused|fence)/.test(l)) ?? out.trim();
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const BASE = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}";
const IDENT = `${BASE}/#{@ao_launch}/#{@ao_op}`;
const want = (name, ev) => `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
function fenceArgs(name, ev, seen, op) {
  const set = `set-option -t =${name}: @ao_op ${op} ; display-message -p -t =${name}: ${q("ao-fenced:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-fence-refused:${BASE}/#{@ao_op}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${BASE}/#{@ao_op},${want(name, ev)}/${seen}}`)} { ${set} } { ${no} }`);
}
function associateArgs(name, ev, tok, op) {
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}/${op}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}//${op}}`)} { ${set} } { ${second} }`);
}
function clearArgs(name, ev, tok, op) {
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}/${op}}`)} { ${clear} } { ${no} }`);
}
const lockName = (d, id) => `\0ao-proto-r6-operation-${createHash("sha256").update(`${realpathSync(d)}/${id}`).digest("hex").slice(0, 24)}`;
async function withOperation(d, id, fn) {
  let server;
  for (const t0 = Date.now(); ; ) {
    server = createServer();
    const bound = await new Promise((resolve, reject) => { server.once("error", (e) => (e.code === "EADDRINUSE" ? resolve(false) : reject(e))); server.listen(lockName(d, id), () => resolve(true)); });
    if (bound) break;
    if (Date.now() - t0 > 30_000) throw new Error("operation lock busy for 30 s");
    await new Promise((r) => setTimeout(r, 20));
  }
  try { return await fn(NOFENCE ? "" : randomBytes(6).toString("hex")); } finally { await new Promise((r) => server.close(r)); }
}
const IDENTITY = ["associationIntent", "runtimeAssociation", "runtimeHandle"];
const cas = (d, id, seen, patch) => {
  const now = M.readMetadataRaw(d, id) ?? {};
  if (IDENTITY.some((k) => (now[k] ?? "") !== (seen[k] ?? ""))) return false;
  return M.updateMetadata(d, id, patch);
};
const nameOf = (r) => JSON.parse(r.runtimeHandle ?? "{}").id ?? "";
async function fence(name, ev, op) {
  if (NOFENCE) return;
  const seen = (await tmux(["display-message", "-p", "-t", `=${name}:`, "#{@ao_op}"])).trim();
  const out = answer(await tmux(fenceArgs(name, ev, seen, op)));
  if (!out.startsWith("ao-fenced:")) throw new Error(`the session changed: ${out}`);
}

export async function beginAssociation(d, id, _runtime, ev) {
  return withOperation(d, id, async () => { M.updateMetadata(d, id, { associationIntent: JSON.stringify({ token: randomBytes(16).toString("hex"), ...ev }) }); });
}
export async function resumeAssociation(d, id) {
  return withOperation(d, id, async (op) => {
    const seen = M.readMetadataRaw(d, id) ?? {};
    if (!seen.associationIntent) return "no intent";
    const intent = JSON.parse(seen.associationIntent);
    await fence(nameOf(seen), intent, op);
    const out = answer(await tmux(associateArgs(nameOf(seen), intent, intent.token, op)));
    if (!/^ao-assoc(-adopt)?:/.test(out)) return out;
    if (!cas(d, id, seen, { associationIntent: "", runtimeAssociation: JSON.stringify(intent) })) return "record compare failed";
    return `${out.split(":")[0]}; published`;
  });
}
export async function abandonAssociation(d, id) {
  return withOperation(d, id, async (op) => {
    const seen = M.readMetadataRaw(d, id) ?? {};
    if (!seen.associationIntent) return "no intent";
    const intent = JSON.parse(seen.associationIntent);
    await fence(nameOf(seen), intent, op);
    const out = answer(await tmux(clearArgs(nameOf(seen), intent, intent.token, op)));
    const emptyToken = out.startsWith("ao-assoc-refused:") && out.endsWith(`${want(nameOf(seen), intent)}//${op}`);
    if (out.startsWith("ao-assoc-cleared:") || emptyToken) return cas(d, id, seen, { associationIntent: "" }) ? "intent removed" : "record compare failed";
    cas(d, id, seen, { associationIntent: JSON.stringify({ ...intent, mismatch: out }) });
    return `mismatch: ${out}`;
  });
}
~~~
### /tmp/aosd7/val/i6_writer.sh

~~~sh
#!/usr/bin/env bash
# i6_writer.sh <key> <value>: the record writer of design r6 section 3.5 (prototype): r5 3.4 without the legacy
# file. A pane with AO_LAUNCH_ID appends one framed record to the file of its launch; a pane without one, a
# missing file or a failed append goes to orphans.ndjson. It never fails the caller (exit 0).
ao_inbox_append() {
  local key="$1" value="$2" LC_ALL=C
  local base="$AO_DATA_DIR/.inbox" launch="${AO_LAUNCH_ID:--}" hexv="" c i
  for ((i = 0; i < ${#value}; i++)); do printf -v c '%02x' "'${value:i:1}"; hexv+=$c; done
  local ms="${EPOCHREALTIME/./}"; ms="${ms:0:13}"
  local rec=$'\x1e'"1 $launch $key $hexv $ms"$'\n'
  if (( ${#rec} > 4000 )); then echo "ao-metadata-helper: $key not recorded (record over 4000 bytes)" >&2; return 0; fi
  if [[ -n "${AO_LAUNCH_ID:-}" && -f "$base/$AO_SESSION/$AO_LAUNCH_ID.ndjson" ]]; then
    { printf '%s' "$rec" >> "$base/$AO_SESSION/$AO_LAUNCH_ID.ndjson"; } 2>/dev/null && return 0
  fi
  local orec=$'\x1e'"o1 $AO_SESSION $launch $key $hexv $ms"$'\n'
  { printf '%s' "$orec" >> "$base/orphans.ndjson"; } 2>/dev/null && return 0
  echo "ao-metadata-helper: $key not recorded (no inbox)" >&2
  return 0
}
ao_inbox_append "$@"
~~~
### /tmp/aosd7/scripts/assemble7.py

~~~~python
# assemble7.py: write the design file from /tmp/aosd7/doc/design.md, with each @@FILE path@@ marker replaced by
# the file's text (terminal colour codes removed) and each @@SCRIPT path@@ marker by a heading and a fenced copy
# of the file (the fence grows until the text does not contain it). The marker check runs on the source, so a
# pasted file may contain "@@". A @@FILE marker of a .md file under /tmp/aosd7/doc/ is a part of the source, and
# its markers are replaced too. A second run rebuilds the same file. Run: python3 -I /tmp/aosd7/scripts/assemble7.py
import os, re, sys

DESIGN = "/home/taisung/.worktrees/agent-orchestrator/ao-52/development/reviews/same_id_design_r7_opus.md"
SOURCE = "/tmp/aosd7/doc/design.md"
ESC = re.compile(r"\x1b\[[0-9;]*m")
MARKER = re.compile(r"@@(FILE|SCRIPT) ([^@\n]+)@@(\n?)")

def text(path):
    return ESC.sub("", open(path, encoding="utf-8", errors="replace").read()).rstrip("\n")

def paste(m):
    kind, path, nl = m.group(1), m.group(2), m.group(3)
    if kind == "FILE":
        if path.startswith("/tmp/aosd7/doc/") and path.endswith(".md"):
            return MARKER.sub(paste, text(path)) + nl  # a part of the design source: its markers too
        return text(path) + nl
    lang = {".mjs": "js", ".js": "js", ".ts": "ts", ".sh": "sh", ".py": "python"}.get(os.path.splitext(path)[1], "text")
    t = text(path)
    fence = "~~~"
    while fence in t:
        fence += "~"
    return f"### {path}\n\n{fence}{lang}\n{t}\n{fence}\n"

src = open(SOURCE, encoding="utf-8").read()
if src.count("@@") != 2 * len(MARKER.findall(src)):
    sys.exit("a marker is malformed")
out = MARKER.sub(paste, src)
open(DESIGN, "w", encoding="utf-8").write(out.rstrip("\n") + "\n")
print(f"{DESIGN}: {sum(1 for _ in open(DESIGN, encoding='utf-8'))} lines")
~~~~
