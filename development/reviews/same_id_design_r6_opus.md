# Same-ID design, revision r6: RW and R2b-2 with a stopped-fleet barrier (ao-52)

Base `f907c4c1`; tests in `f907c4c1..c8751762` (3 commits, test files only). Input: the re-check r5 by ao-51
(`main:development/reviews/same_id_design_review_r5_astra6.md`, "the review"). Owner decisions 1b (the
stopped-fleet barrier) and 2a (OD-25 (a)), 2026-10-21. Scope: RW and R2b-2. Every section of design r5 that this
file does not replace stays as it is, and so does every section of design r4 that r5 kept (R2b-1, R3a, R3b, RH,
RO, R4). "r5 3.6" means design r5 section 3.6. OD-2 to OD-24 stay decided.

Scratch root `/tmp/aosd6`; marker `/tmp/aosd6-marker`. No `ao` command, no `opencode`, no Herdr, no network, no
real record, no real `~/.ao/bin` write (9.1).

## 0. Response table

| Finding | Decision | Section | Test (file, kind) |
| --- | --- | --- | --- |
| **B-1** (RW) a file-first candidate has no ownership against prune or archive | Accepted. The candidate, the check of the ID and the record write run in ONE synchronous record-lock hold, after the recovery of an archive intent. The archive runs its intent, move and record archive in one hold. Prune and every recovery run under the same lock. Ownership rule: a launch file belongs to the record that names it from its creation; outside a hold no unnamed file is pending. | 3.2, 3.4, 3.6 | core r6 `(RW) B-1`: 3 defects (prune in another process, archive of another launch in another process, a restore that read the record before an archive intent), 2 controls |
| **B-2** (R2b-2) the interpreter client of a dead holder escapes the stale-client wait | Accepted, with another protocol than the review names: a fence value `@ao_op` in the tmux session. Each holder sets it to its operation ID by a compare-and-set before its first mutating command, and every mutating command compares it inside the server. A command of a superseded holder is refused when it runs, through any shim, fork or delayed exec. The stale-client wait is removed. | 5 | tmux r6 `(R2b-2) B-2`: 2 defects (the held clear; the first call held), 2 controls (the shim is no tmux process by exe or argv[0]; a held clear that ends before the kill) |
| **M-1** (RW) step 6a makes a legacy inbox before 7c recovers the archive | Cause removed: the stopped fleet removes the legacy inbox (no step 6a, no 7b). Rule kept: the barrier recovers every archive intent before any other step, and no step makes `.inbox/<id>`. | 2.3, 3.4 | core r6 `(RW) M-1`: 1 defect (the record step of the barrier after every archive crash point, five records) |
| **M-2** (RW) the E5 inventory misses an importer outside the build roots | Answered by the precondition (rule P3: every JS runtime of the uid blocks unless the owner allows its PID and start ticks) and by OD-25 (a). E5 is no longer a completeness claim. The residual is in 2.5. | 2.2, 2.5 | core r6 `(RW) M-2`: 1 defect (an owned external importer), 1 control (allowed) |
| review: crash and transition walk | Answered: the catch-up freezes the launch, the file identity and S0 (3.3); the recovery re-reads under the lock and uses the explicit archive name (3.4); the publish has no "at most 1 MiB" premise (3.3); `preparing` becomes `failed` only in the barrier, where no spawn runs (2.3 step 3). | 3.3, 3.4 | RW acceptance list (7) |
| review: R2b-1 re-inventory of the landed send and tmux paths | In the round plan, with the lines checked on `main` `07ddd952`. | 7 | R2b-1 row |
| review: OD-25 | Decided (a) by the owner (2a): detection and response. | 2.3, 8 | RW acceptance list |
| r5 oracles that the stopped fleet makes wrong | core r5: the three B-1 races now expect a refusal, and the legacy defect became a control (10.3). core r4 `:262` expects a waiting barrier and may not change in this round: OD-26. | 10.3, 8 | core r5 changed |

## 1. What r6 replaces in design r5

| Design r5 | In r6 |
| --- | --- |
| 2.4 (the drain wait), 2.5 (the proof), 2.7 (the depth limit) | removed; replaced by the precondition check of 2.2 and the steps of 2.3 |
| 2.2 (the fence), 2.3 (W1 to W4) | stay; W1 to W4 run once per check as rule P4 |
| 3.1 (eligibility) | replaced by 3.1 (no legacy rows) |
| 3.2 steps 1 and 2, 4 rows reservation and restore | replaced by 3.2 (one hold) |
| 3.2 steps 3 to 5, the crash table rows 2 to 4 | stay; step 4 changed by 3.3 |
| 3.3 (the parser) | stays |
| 3.4 (the writer) | changed by 3.5 (no legacy file) |
| 3.5 (the catch-up) | changed by 3.3 (frozen identity) |
| 3.6 (archive), 4 row archive | replaced by 3.4 |
| 3.7, 3.8 | stay; the prune rule in 3.6 |
| 3.9 (API) | replaced by 3.6 |
| 5.4 step 2 (the stale-client wait) | replaced by 5 (the fence) |
| 5.1 to 5.3, 5.5, 5.6 | stay |
| 6.1, 6.2 | replaced by 2.2 and 2.3 |
| 6.3 | stays (OD-25 (a) decided) |
| 8, 9, 10 | changed by 6, 7, 8 |

## 2. RW: the stopped-fleet barrier (owner decision 1b; M-1, M-2)

### 2.1 The owner's procedure and its costs

Before the upgrade, from a terminal that is not an AO pane and has no `AO_*` variable:

1. Wait until every agent is idle (`ao status` per project). Note every session that must come back.
2. Stop the lifecycle worker and the orchestrator session of each project: `ao stop <project>`.
3. Stop every other AO session with its runtime's own command, so that the record and the worktree stay:
   `tmux kill-session -t =<tmux name>` on the session's server (or the Herdr stop). Do not use `ao session kill`:
   it archives the record and removes the worktree (`session.ts:225` on `main`).
4. Stop every other resident `ao` process (watchers, scripts that import core) by its exact PID.
5. Build and install the new version.
6. Run the barrier of the new build (2.3). It refuses with a list when a process remains. A JS runtime that is
   not an AO process stays only when the owner names it: `--allow <pid>:<start ticks>`.

After the barrier: `ao start <project>`, then `ao session restore <id>` for each noted session. `restore` accepts a
record whose agent exited while its status still says `working` (`session-manager.ts`, the enrichment before
`isRestorable` on `main`). Each restore runs the transaction of 3.2 and gives the record its first launch ID.

Costs:

- Every session is down from step 1 to its restore. A turn in progress is lost unless the agent was idle.
- Each agent restarts. Its context continues only where its plugin has a restore command; the worktree, with
  its uncommitted changes, stays.
- The owner's own orchestrator pane stops too (step 2), so the owner works from another terminal.
- Every JS runtime of the uid must stop or be allowed. On this host at 23:2x EDT: 6, of which 2 are the lifecycle
  workers and 4 have a `bash` parent (9.6).
- Every AO-named pane on every tmux server of the uid must be gone.
- The record step scans every state root: 3844 directories under `~/.agent-orchestrator` on this host, most of
  them test leftovers; 8 active records in project `agent-orchestrator`, 0 in `observability` (9.6). Not timed:
  this round runs no barrier on the real root.

### 2.2 The precondition check (what it reads)

For every process of the uid in `/proc`, the barrier process excluded:

| Rule | Reads | Blocks when |
| --- | --- | --- |
| P1 | `/proc/<pid>/environ` (the initial environment) | it names a covered state root (`AO_DATA_DIR` or `AO_STATE_ROOT` under one, or `AO_CONFIG_PATH` of a config whose state root is covered), or it has an `AO_*` key and none of these three. An unreadable environment (EACCES: a non-dumpable process) is listed and does not block (OD-27). |
| P2 | `list-panes -a -F '#{session_name} #{pane_pid}'` on every tmux server of the uid: each socket in `$TMUX_TMPDIR/tmux-<uid>/` (default `/tmp/tmux-<uid>/`), and each `-S` path in the argv of a tmux process | a pane of a session whose name has the AO form of a configured project (`<12 hex>-<prefix>-...`). A server that does not answer in 5 s blocks; "no server running" is no server. A Herdr pane: P1 finds its agent processes (Herdr not measured in this round). |
| P3 | the basename of the exe link | `node`, `nodejs`, `bun` or `deno`, unless the owner allows that PID with its start ticks |
| P4 | argv, cwd, exe and descriptor links | W1 to W4 of r5 2.3, one pass. Before the fence, W1 counts every interpreter that names a managed file (every managed file is still old). |
| P5 | argv, cwd | never blocks: E1 to E4 of r5 6.2 label a P3 match (an `ao` shim, a build, a worker PID file) |

The check never signals, stops or waits on a process. It keeps only the `AO_*` keys of an environment in memory
and prints no value. Measured on owned fixtures (9.5): the review's external importer is P3 and not E5; a process
with `AO_SESSION` and `AO_DATA_DIR` is P1; an AO-named pane on a private server is P2.

### 2.3 The barrier steps (replace r5 6.1)

1. Close admission (r4 8.1).
2. Check 1 (P1 to P4). A block: keep admission closed, list every blocking process with its rule, exit 1.
   Nothing else changes.
3. The record step, first, for every record of every covered state root, under its record lock: finish an
   archive intent (3.4), then write `failed` for a `preparing` launch (its maker is dead: no AO process runs).
   List obsolete files, late lines, orphans and failed launches. "inbox damaged" keeps admission closed.
4. Make `.inbox/` and `.inbox/orphans.ndjson` in every sessions directory. No step makes `.inbox/<id>`.
5. The fence of r5 2.2: every managed file and every hook under every worktree root, by rename.
6. Check 2 (P1 to P4, W1 with the current-inode rule of r5). A block: keep admission closed.
7. The exact checks of r5 6.1 row 10, without the drain: every active record is `published`, `failed` or has no
   launch ID; no `archiveIntent`; no `preparing`; the hashes of the fenced files.
8. Write the barrier record (the allow list with PID and start ticks, both check results), open admission, start
   the standing check (r5 6.3, OD-25 (a)).

Why two checks: an old process that starts between check 1 and the fence either lives at check 2 or ended before
it; one that ended wrote before the fence, as any write before the barrier. After check 2 the no-old-build
operating rule and the standing check hold (2.5).

### 2.4 What the stopped fleet removes from r5, and what stays

| r5 part | r6 |
| --- | --- |
| 2.4 the drain wait: 3 clean scans, the poll, the timeout, `ao barrier writers --wait` | removed: checks 1 and 2 refuse instead of waiting |
| 2.5 the proof for writer trees of depth 2 or less; 2.7 the depth limit | removed as premises: every process of an old writer tree carries the pane's `AO_*` environment, at any depth (P1); P4 stays for a writer whose environment was cleared |
| 3.1 rows `inboxLegacy` and `not-eligible`; `legacy.ndjson`, the launch field `-`, `initLegacyInbox`; 6.1 steps 6a (per ID) and 7b | removed: no pre-RW pane runs after the barrier; the next launch of a pre-RW record is a restore under RW. A line without a launch ID is an orphan (3.5) |
| 6.1 r4 step 3 (the barrier stops the workers by PID); 6.2 "waits for the others to end" | removed: the owner stops them (2.1); the barrier checks |
| 6.2 E5 as a proof of completeness | removed: P3 and the owner's allow list. E1 to E4 stay as labels (P5) |
| 2.2 the fence; 2.3 W1 to W4 | stay (step 5; P4) |
| 3.2 I1, the publish, the failed state; 3.3 the parser; 3.5 the catch-up; 3.7; 3.8 the cap | stay, changed by 3 |
| 3.6 the archive | changed: one hold (3.4) |
| 6.1 step 7c, the recovery | stays, now step 3, first |
| 6.3 the standing check | stays; OD-25 (a) decided |

### 2.5 M-2: what remains

- A JS runtime that the owner allowed but that holds old core, or an old build that starts after admission, can
  reinstall the old wrappers at any time. The standing check closes admission at its next poll; a new fence and a
  new check 1 and 2 run before admission opens again. Between the rewrite and that poll, a pane can run the old
  wrapper text, which writes records directly (the lost-write class of r3 and r4). Detection and response, not
  prevention (OD-25 (a)).
- A runtime whose exe has another basename (a copied or renamed node binary, a compiled program that loads core)
  is not P3. Assumption S3: AO and every caller of core run under `node`, `nodejs`, `bun` or `deno`.
- A non-dumpable process is listed, not blocking (OD-27 (a)). Measured: 7 such processes on this host (`sshd` 4,
  `sftp-server`, `systemd`, `(sd-pam)`, by their comm, 9.6).
- A writer with no `AO_*` key that matches no W1 to W4 shape (r5 2.7: outside the supported set).

## 3. RW: the inbox with ownership (B-1, M-1)

### 3.1 Eligibility (replaces r5 3.1)

| Record | Answer | File |
| --- | --- | --- |
| `archiveIntent` set | `archiving`: the caller finishes the archive (3.4) | none |
| `launchId=L`, `launchState=published` | apply | `.inbox/<id>/L.ndjson`, records with launch field `L` |
| `launchId=L`, `launchState=preparing` | `held` | none |
| `launchId=L`, `launchState=failed` | `failed`: never applied; listed | none |
| `launchId=L`, another or no `launchState` | `invalid` (a strict-read error, R4) | none |
| no `launchId` | no inbox (a pre-RW record before its first RW launch): nothing to apply | none |

`launchId` and `archiveIntent` join `LAUNCH_IDENTITY_KEYS` (`metadata.ts:331`), as in r5.

### 3.2 The launch transaction (B-1)

`beginLaunch` runs in ONE synchronous `withRecordLock` hold (no `await`; `metadata.ts:259` in the build):

1. Read the record. `archiveIntent` is set: finish the archive (3.4) in this hold. "inbox damaged": refuse.
2. Check the ID. A spawn: no record (the `O_EXCL` reservation checks it again). A restore: the record holds the
   expected values (the launch identity and the file identity that the catch-up froze, 3.3), else refuse "the
   launch changed".
3. `mkdir -p .inbox/<id>` (0700); create `L.ndjson` with `O_EXCL` (0600); `fsync` the file and the directory.
4. The record write: `reserveSessionRecord` or `updateMetadataIf` with `launchId=L`, `launchState=preparing`, no
   cursor.
5. Step 4 refuses or anything throws after step 3: unlink `L.ndjson`, refuse.

**Ownership rule.** A launch file belongs to the record that names it, from its creation. Outside a hold, no
unnamed file is pending: its maker named it or removed it in the same hold, or died in that hold. So every
process that holds the record lock can treat an unnamed file as obsolete (r5 3.7), and prune, archive and
recovery need no candidate state.

A crash after step 3: an empty file that no record names (obsolete; prune removes it). After step 4: as the r5 3.2
crash table, rows 2 to 4. The hold covers a few file operations; a waiter waits up to `RECORD_LOCK_WAIT_MS`
(5 s, `metadata.ts:116`). `onCandidate` (after step 3, before step 4) is a test seam, not reachable from the CLI.
Measured (9.2): the r5 rules lose the file in S1 (prune) and S2 (archive of another launch); the transaction
keeps it, and the competing process waits for the lock.

### 3.3 The catch-up and the publish (change r5 3.5 and 3.2 step 4)

- `catchUpInbox` freezes the selected launch, the file identity `(dev, ino)` and `S0` at its start and returns
  them with `complete`. A decision (a restore, 3.2; an archive, 3.4) checks them in its hold. A change: refuse
  "the launch changed: run again".
- The publish reads from offset 0 in 64 KiB chunks up to `S0` or the end of its budget, applies the complete
  records that it read, and writes `published` with the cursor after the last one. The rest stays for the
  applier and for the next catch-up. No premise "at most 1 MiB": the cap is soft (r5 3.8).

### 3.4 The archive and its recovery (B-1, M-1; replaces r5 3.6)

1. `catchUpInbox` (complete, else refuse with `backlog`).
2. ONE record-lock hold: check the frozen values; write `archiveIntent=<ts>` (conditional); rename `.inbox/<id>`
   to `archive/<id>_<ts>.inbox`, `fsync` both directories; `deleteMetadata` with the archive name `<id>_<ts>` and
   the condition `archiveIntent=<ts>`. RW changes `deleteMetadata` to take the name (today it makes its own
   time stamp), so that a copy after a crash writes the same file again.

**Recovery.** Every holder of the record lock that reads `archiveIntent` (`beginLaunch`, prune, an applier, every
mutating command, barrier step 3) finishes the archive in its hold:

| `.inbox/<id>` | `archive/<id>_<ts>.inbox` | Record | Action |
| --- | --- | --- | --- |
| yes | no | any | move, then archive the record |
| no | yes | any | archive the record |
| no | no | no `launchId` | archive the record (a pre-RW record has no inbox) |
| no | no | `launchId` | "inbox damaged" (I1) |
| yes | yes | any | "inbox damaged": only external damage, because nothing makes `.inbox/<id>` while the intent exists (3.2 step 1) |

When the record is gone, nothing is to do; a new record of the ID has no intent and is never touched. Measured
(9.2): S3 (a restore that read the record before the intent) and S4 (the barrier after a crash after the move)
end "inbox damaged" with the r5 rules and "finished" with r6.

### 3.5 The writer (changes r5 3.4)

No legacy file. A pane without `AO_LAUNCH_ID`, or whose launch file is missing, appends one orphan record (`o1`).
The other outcomes of r5 3.4 stay.

### 3.6 Prune and the API

`pruneInbox(dataDir, id)`: under the record lock, finish an archive intent first, then remove the EMPTY files
that the record does not name. A file with bytes stays listed (r5 3.7). `ao session inbox --prune --confirm`
calls it.

`core/src/inbox.ts`: `beginLaunch(dataDir, id, { spawn?, expected?, onCandidate? })` returns the launch ID and
throws when it refuses; `publishLaunch(dataDir, id, launchId, fields)`; `applyInbox(dataDir, id)`;
`catchUpInbox(dataDir, id)` returns `{ complete, launchId, dev, ino, s0 }`; `archiveLaunch(dataDir, id,
launchId)`; `recoverArchive(dataDir, id)` returns `"nothing"`, `"finished"` or `"inbox damaged"`;
`pruneInbox(dataDir, id)` returns the removed names; `recoverInterruptedRecords(dataDir)` returns `{ sessionId,
result }[]` (barrier step 3 for one sessions directory). `core/src/fleet-barrier.ts`: `checkFleetAndFence({
install, sessionsDirs, allow?, tmuxSockets?, onCheck? })` returns `{ admitted, blocking: [{ pid, rule }] }`
(`allow` gets `{ pid, rule }`; the CLI makes it from `--allow`). The tests load these names (10).

## 4. RW before R3a

r5 4 stays, with the rows reservation, restore and archive replaced by 3.2 and 3.4: each is one record-lock
hold, and every other flow that touches `.inbox/<id>` takes the same lock. The assertion "RW does not make it
worse" now rests on 3.2 and 3.4 (the review's B-1 schedules, measured in 9.2).

## 5. R2b-2: the tmux fence (B-2)

### 5.1 The rule (replaces r5 5.4 step 2)

A holder of the operation lock of an ID, before its first mutating tmux command on an existing session of that
ID:

1. Read `@ao_op` of the session (`display-message`).
2. The fence: one gated command that sets `@ao_op` to the holder's operation ID when the evidence (server PID,
   session name, `$N`, pane PID) and `@ao_op` still have the values that it read. Answer: `ao-fenced`, or
   `ao-fence-refused:<evidence>/<value>`.
3. Refused: read again and retry, at most 3 times (each held fence of a dead holder runs once), then refuse "the
   session changed"; the operation changes nothing.
4. Every later mutating command of the holder on that session (associate, adopt, exact clear, `clear-token`, the
   asserted legacy stop, the kill of `retire`) has `#{@ao_op}` equal to its operation ID in its compare.

The operation ID is the random part of the operation token (r3 5.1), at least 48 bits. The value stays on the
session after the operation; the next holder compares from it. `ao session audit` shows it. Forms (prototype,
14): the r4 3.2 and 3.3 forms with `/#{@ao_op}` after `#{@ao_launch}` in the compare, and

~~~text
fence: gated(if-shell -F -t =N: "#{==:#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_op},<evidence>/<read value>}"
             { set-option -t =N: @ao_op <op> ; display-message -p -t =N: "ao-fenced:#{pid}" }
             { display-message -p -t =N: "ao-fence-refused:<the same format>" })
~~~

### 5.2 Why it holds, and what it needs

tmux runs the command list of one client without a wait when the list holds only `if-shell -F` (no `run-shell`,
no `if-shell` without `-F`), so a compare and its set are one step in the server (the premise of r4 3.2). The
compare runs when the server executes the command, not when the client started. So a command of holder H changes
the session only while `@ao_op` is op(H); after a new holder fenced, every command of an earlier holder is
refused: held in a shim, in a fork before exec, in a delayed exec, or in a client that connects late. This needs
no knowledge of the client process and no proof that a client ended. It fails closed: a fence that cannot run
(no answer, an error, a timeout) gives no later mutating command. Measured (9.3): schedule a (r5) ends
INCONSISTENT; b (the held clear) and c (the held fence) end CONSISTENT with the fence.

### 5.3 Removed and kept

Removed: the stale-client wait (r5 5.4 step 2). It cannot be complete: a `/bin/sh` shim has exe `dash` and
argv[0] `/bin/sh` (9.3; tmux r6 control). Kept: the rest of r5 5 (the lock subset, the order, the callers, the
mismatch state, `--forget-intent`, the API of r5 5.6).

### 5.4 Not covered

- **N-1 (new): a session that a dead holder creates.** A restore holder dies while its `new-session` client is
  held. No session exists yet to hold a fence. The pane starts later, with the `AO_LAUNCH_ID` of a launch that
  the next holder or the barrier can already have marked `failed` (RW never applies its lines), but its agent
  runs and no record names its runtime. The r5 wait did not cover it either (`new-session -s N` has no `=N`).
  Measured (9.4): tmux keeps a user option at server level, and a gate can read it, so a later round can fence a
  name on a running server; no fence exists while no server runs. OD-28.
- `send`, attach and the lifecycle messages are not lock holders in R2b-2 (r5 5.3). A held send of a dead
  process keeps the R2b-1 token gate: it can arrive late, but only at the launch that it names.

## 6. What RW and R2b-2 protect alone (replaces the r5 8 rows)

| Round | Protects alone | Does not protect |
| --- | --- | --- |
| RW | no shell writer of the new text writes a record; at admission no AO process and no old writer runs (P1 to P4, two checks); each launch file is named by its record from its creation, and no prune, archive or recovery removes or moves a named file; an interrupted archive is finished by the next record-lock holder or by the barrier, in the order of 3.4; a decision catches up to its frozen `S0` or refuses; a failed launch never applies; obsolete files, late lines and orphans are listed, never applied; the epoch fences every worker write; a wrapper rewrite closes admission at the next poll | the tmux identity (R2b-1); an allowed JS runtime with old core, or an old build after admission, until the next poll (2.5); a writer outside P1 and P4; loss after the cap (r5 3.8); effects outside the record between two commands of one ID (the R2a level until R2b-2 and R3a) |
| R2b-2 | as r5 8, with "a new holder makes its first tmux call only after every tmux client of an earlier holder ended" replaced by: every mutating tmux command of an earlier holder that runs after a new holder fenced the session is refused in the server | N-1 (5.4); the operation lock of the other entry points (R3a); send and attach are guarded, not locked |

## 7. Round plan (changes to r5 9)

| Round | Content | Files | Tests that must turn green | Risk | Size | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| **RW** | 2 (P1 to P5, check, record step, fence, check, `--allow`, the barrier record); 3 (eligibility, the transaction, frozen catch-up, publish budget, one-hold archive and the recovery table, prune, the writer without legacy); kept: the r5 parser, cap, obsolete and orphan lists, the epoch module and the worker write fence, the hook by rename, the monotonic wrapper version, `refresh-hooks --all`, the standing check | `core/src/metadata.ts` (`launchId` and `archiveIntent` in `LAUNCH_IDENTITY_KEYS`; `deleteMetadata` takes the archive name), new `core/src/inbox.ts`, new `core/src/fleet-barrier.ts` (in place of r5 `writer-drain.ts` and `build-inventory.ts`), new `core/src/build-epoch.ts`, `core/src/agent-workspace-hooks.ts`, `core/src/session-manager.ts` (spawn, restore and archive through 3.2 and 3.4), `core/src/lifecycle-manager.ts` (applier, standing check), `agent-claude-code/src/index.ts`, CLI `session.ts`, new CLI `barrier.ts` | core r6 `(RW)`: 5 defects; core r5 `(RW)`: 5 defects; core r4 `(RW)` "a branch that the pane records while its launch is still preparing is in the record after the spawn" (`:379`), and "a Node write after the barrier installed a new helper is kept against a wrapper that started before" (`:262`) after OD-26; controls stay. Add: each row of 3.1 and of the 3.4 table; each crash point of 3.2 and 3.4, then the recovery by `beginLaunch`, prune, an applier, a command and the barrier; failed active and failed archived records; the frozen-identity refusal; the publish budget with a prefix over the cap; an exactly-once count for the record across the read boundary; P1 to P4 each with an owned fixture, P1 unreadable listed; no call of `process.kill` (a spy); `--allow` with wrong start ticks refuses; a wrapper rewrite and a write between two standing polls (detected, admission closed, the record listed) | **high** | L | R2a (restore) |
| **R2b-1** | as r5 9, with the re-inventory list below | as r5 9 | as r5 9, and per listed path: a real private-server CLI call with a healthy tokenless session, a token launch, a replaced token and an absent session, the non-Codex retry included | high | L | R2a, RW |
| **R2b-2** | r5 5 with r6 5: the fence and the compare of `@ao_op` in every mutating command; no stale-client wait | as r5 9 | tmux r6 `(R2b-2)`: 2 defects; tmux r5 `(R2b-2)`: 3 defects; `c516cead` R2 runtime-tmux F-5; as r5 9. Add: each mutating command of 5.1 step 4 with a held shim; a held fence; a fence retry; a fence that cannot run; outcomes of `Promise.allSettled` asserted one by one; N-1 listed by the audit | high | M | R2b-1 |

R3a, R3b, RH and RO as r5 9. Order: R2a, R4, RW, R2b-1, R2b-2, R3a, R3b.

**R2b-1 re-inventory** (the review's list; lines checked on `main` `07ddd952`, which moved after the review, so
the implementation goes by the call, not the line):

- `cli/src/commands/send.ts`: `sendViaTmux` C-u `:138`, `load-buffer` `:145`, `paste-buffer` `:151`, literal
  `:160`, Enter `:164`, called at `:367`; the Codex branch after the send `:369` to `:410` (reads only); the
  non-Codex fallback Enter `:425` and `:430`.
- `core/src/tmux.ts`: Escape `:171`, `load-buffer` `:187`, `paste-buffer` `:188`, literal `:199`, Enter `:209`,
  `kill-session` `:225`.
- `runtime-tmux/src/index.ts`: `create` literal `:145`, Enter `:147`, launch command and Enter `:149`, the cleanup
  `kill-session` `:153`; `destroy` `:179` (`kill-session` `:182`); `sendMessage` C-u `:192`, `load-buffer` `:201`,
  `paste-buffer` `:202`, `delete-buffer` `:212`, literal `:220`, Enter `:226`; `getAttachInfo` `:278`. The review
  gives `:175`, `:184`, `:194`, `:212`, `:218` and `:276` for some of them.
- CLI `session.ts` attach: `:187` (`getAttachInfo`), `:195` (the attach arguments), `:209` (the spawn).
- The core and lifecycle callers of all of these, through the identity resolver and the shared guard. The paste
  needs the guard: `load-buffer` alone targets no pane.

## 8. Owner decisions

| OD | Status | Value |
| --- | --- | --- |
| OD-2 to OD-24 | decided | as r5 10 |
| 1b the stopped-fleet barrier | **decided** (1b) | 2 |
| OD-25 the standing check | **decided (a)** (2a) | a hash change closes admission; a new fence and a new check run before admission opens; the diagnostics and the no-old-build operating rule stay; detection and response, not prevention |
| **OD-26** core r4 `:262` ("a Node write after the barrier installed a new helper is kept against a wrapper that started before"; r5 called it `:177`) | open | The test expects the barrier to wait for an old writer and then writes the new record without a look at the answer. Under 1b the barrier refuses, so the test stays red for a correct RW. (a) The RW round may change that one oracle as r6 changed core r5 (refuse, then admit after the writer ended). (b) Keep it as a permanent expected failure, superseded by core r5 B-1. **Recommendation (a).** |
| **OD-27** an unreadable environment in P1 | open | (a) List the process, do not block (assumption: no AO component and no frozen writer is non-dumpable). (b) Block unless allowed: about 7 allows at each barrier on this host, and the `sshd` ones change with each login. **Recommendation (a).** |
| **OD-28** N-1 | open | (a) Accept for R2b-2; the audit lists a pane of a failed or unpublished launch, and the owner stops it; fence names at server level in R3a with the spawn children. (b) Fence names at server level in R2b-2 (a running server only). **Recommendation (a).** |

## 9. Measurements

### 9.1 Environment and isolation

Host Linux 6.8.0-147, tmux 3.4, node 25.7.0, pnpm 9.15.4; core vitest 4.1.4, runtime-tmux vitest 3.2.4. Every
`node`, `pnpm`, helper and test call ran under `env -i` with `HOME=/tmp/aosd6/home` (scripts) or
`/tmp/aosd6/testhome` (tests), no `AO_*` variable, `PATH` from `/tmp/aosd6/{bintest,pnpmbin,nodebin}` and
`/usr/bin:/bin` (no `opencode`, `herdr`, `claude`, `codex`, `gemini` or `ao` on it). Private tmux servers:
`aosd6-stale` (m2), `aosd6-opt` (m3), `aosd6-pre` (m4), `aosd6-T` (the test shim), and the `-S` sockets in the
test temporary directories; every call with `env -u TMUX` or `env -i`. Each script ends every process that it
started by its exact PID with a start-ticks check, and removes only the socket of its own server. The process
scans read `/proc` stat, cmdline, exe, cwd and descriptor links; the environment only of owned fixtures (m4).

### 9.2 m1: the inbox schedules, r5 rules against r6 (real record functions, scratch directories)

`env -i HOME=/tmp/aosd6/home PATH=/tmp/aosd6/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd6/tmp node
/tmp/aosd6/scripts/m1_inbox_ownership.mjs`. In S1 and S2 the competing operation runs in another process
(`m1_child.mjs`), started from inside A's step:

~~~text
== r5
  S1 prune: child during A's step; at end      {"pruned":["1911fb05dc94e924.ndjson"]}; {"pruned":["1911fb05dc94e924.ndjson"]}
  S1 A reserved; A's named inbox exists        true; false
  S2 child B and C                             {"B":"01ffff9e1c064d4a","published":true,"archived":true}
  S2 A reserved; A's inbox active; A's file archived true; false; true
  S3 restore result; state before recovery; recovery refused; inbox damaged; inbox damaged
  S3 after: record exists; active inbox exists true; true
  S4 barrier after the archive crash           ["app-1: inbox damaged"]
  S4 after: record exists; active inbox exists true; true
== r6
  S1 prune: child during A's step; at end      "(not done)"; {"pruned":[]}
  S1 A reserved; A's named inbox exists        true; true
  S2 child B and C                             {"B":null,"published":false,"archived":false}
  S2 A reserved; A's inbox active; A's file archived true; true; false
  S3 restore result; state before recovery; recovery refused; no record; nothing
  S3 after: record exists; active inbox exists false; false
  S4 barrier after the archive crash           ["app-1: finished"]
  S4 after: record exists; active inbox exists false; false
All files are in /tmp/aosd6/m1. The record functions are the real ones; the inbox steps are the r5 and r6 rules.
~~~

### 9.3 m2: a shell-shim client of a killed holder (tmux 3.4, `-L aosd6-stale`)

`env -i HOME=/tmp/aosd6/home PATH=/tmp/aosd6/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd6/tmp
SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd6/scripts/m2_stale_client.mjs`:

~~~text
== a: r5, held clear
  held client argv ["/bin/sh","/tmp/aosd6/tmp/m2/tmux"] exe /usr/bin/dash
  new holder: stale-client matches []; resume ao-assoc-adopt; record published true
  the held command ran: ao-assoc-cleared:1658197
  record names T; tmux token ""; @ao_op ""; INCONSISTENT
== b: r6, held clear
  held client argv ["/bin/sh","/tmp/aosd6/tmp/m2/tmux"] exe /usr/bin/dash
  new holder: stale-client matches []; fence ao-fenced; resume ao-assoc-adopt; record published true
  the held command ran: ao-assoc-refused:1658257/m2-b/0/1658258/<hex>/<hex>
  record names T; tmux token T; @ao_op set; CONSISTENT
== c: r6, held fence
  held client argv ["/bin/sh","/tmp/aosd6/tmp/m2/tmux"] exe /usr/bin/dash
  new holder: stale-client matches []; fence ao-fenced; resume ao-assoc-adopt; record published true
  the held command ran: ao-fence-refused:1658286/m2-c/0/1658288/<hex>
  record names T; tmux token T; @ao_op set; CONSISTENT
== d: r5, held clear, released before the kill
  held client argv ["/bin/sh","/tmp/aosd6/tmp/m2/tmux"] exe /usr/bin/dash
  new holder: stale-client matches []; resume ao-assoc; record published true
  the held command ran: ao-assoc-cleared:1658343
  record names T; tmux token T; @ao_op ""; CONSISTENT
started PIDs: 12; still running: []; own socket left: false
~~~

### 9.4 m3: a user option at server level (`-L aosd6-opt`)

~~~text
set -s exit 0
server option in a session format: [opA]
gate-true
removed the socket of my own server
server 1669134 ended
~~~

### 9.5 m4: what the precondition reads, on owned fixtures (`-L aosd6-pre`)

~~~text
F1 external importer   exe node; cwd /tmp/aosd6/external
  r5 E5 (argv or cwd under a build root)   false
  r6 P1 (AO_* in environ)                  false
  r6 P3 (JS runtime, not allowed)          true
F2 AO env              exe sleep; cwd /home/taisung/.worktrees/agent-orchestrator/ao-52
  r5 E5 (argv or cwd under a build root)   false
  r6 P1 (AO_* in environ)                  true
  r6 P3 (JS runtime, not allowed)          false
F3 pane                exe sleep; cwd /home/taisung/.worktrees/agent-orchestrator/ao-52
  r5 E5 (argv or cwd under a build root)   false
  r6 P1 (AO_* in environ)                  false
  r6 P3 (JS runtime, not allowed)          false
  r6 P2 (pane of an AO-named session)      true
host, uid 44402: 81 other processes; JS runtimes 6; tmux 3; exe unreadable 7
host exe basenames: [["bash",27],["node",6],["codex",6],["flock",6],["sleep",6],["codex-code-mode-host",4],["2.1.306",4],["tmux",3],["pipewire",3],["gnome-keyring-daemon",2],["opencode (deleted)",1],["user-session-helper",1]]
started PIDs: 4; still running: []; own socket left: false
~~~

### 9.6 m5: the host processes that P1 and P3 look at (stat and exe links only), and the state root

~~~text
js pid=101162 comm=node-MainThread parent=101160 parent-exe=bash
js pid=1294181 comm=node-MainThread parent=1 parent-exe=unreadable (a real lifecycle worker)
js pid=1294364 comm=node-MainThread parent=1 parent-exe=unreadable (a real lifecycle worker)
js pid=2327115 comm=node-MainThread parent=2327113 parent-exe=bash
js pid=4098878 comm=node-MainThread parent=4094364 parent-exe=bash
js pid=425597 comm=node-MainThread parent=425595 parent-exe=bash
unreadable pid=1184949 comm=sshd parent=1184644 parent-exe=unreadable
unreadable pid=1185562 comm=sshd parent=1184677 parent-exe=unreadable
unreadable pid=1185683 comm=sftp-server parent=1185562 parent-exe=unreadable
unreadable pid=13870 comm=systemd parent=1 parent-exe=unreadable
unreadable pid=13874 comm=(sd-pam) parent=13870 parent-exe=unreadable
unreadable pid=4094324 comm=sshd parent=4093900 parent-exe=unreadable
unreadable pid=884550 comm=sshd parent=883640 parent-exe=unreadable
~~~

`ls` of the real state root (no other access): 3844 directories under `~/.agent-orchestrator`;
`60756641ca25-agent-orchestrator` has 8 active records, `60756641ca25-observability` 0.

### 9.7 The tests against the r6 prototypes

`/tmp/aosd6/scripts/val6.sh` copies the three test files to `/tmp/aosd6/val`, changes only import specifiers,
and runs them in red mode against the prototypes of 3, 2.3 and 5 (14):

~~~text
== core r6 against inbox.ts (prototype)
✓ __tests__/same-id-defects-r6.test.ts (8 tests)
✓ a prune while a launch begins keeps the launch file that the new record names 
✓ an archive of another launch while a launch begins does not move the file of that launch 
Tests  8 passed (8)
== core r5 (changed) against fleet-barrier.ts and inbox.ts (prototypes)
✓ __tests__/same-id-defects-r5.test.ts (10 tests)
✓ the barrier refuses while an old mv runs whose wrapper died before the first check 
✓ the barrier refuses when an old writer starts after its first check 
✓ the barrier refuses while an old wrapper text runs that has no managed file open 
Tests  10 passed (10)
== runtime-tmux r6 against assoc-proto.ts (prototype)
✓ __tests__/same-id-defects-r6.test.ts (4 tests)
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the held clear of a killed holder does not remove the token that the next holder published 
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the first tmux call of a killed holder, held in a shell shim, changes nothing after the next holder 
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > control: a held clear that runs before its holder is killed leaves tmux and the record in agreement 
Tests  4 passed (4)
~~~

The same tmux run with the fence switched off in the prototype (a flag file: no fence, an empty operation ID):

~~~text
== runtime-tmux r6 against assoc-proto.ts (prototype)
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > control: the held shim client is no tmux process by exe or argv[0], and its argv names the session
× [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the held clear of a killed holder does not remove the token that the next holder published
→ production (core R2b-2): held client argv[0] /bin/sh, exe /usr/bin/dash; resume ao-assoc; published; the held call answered ao-assoc-cleared:1953459; {"intent":"","association":"29ff533a805387c3b4644fa3c2619b91","tmu
× [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the first tmux call of a killed holder, held in a shell shim, changes nothing after the next holder
→ production (core R2b-2): held client argv[0] /bin/sh, exe /usr/bin/dash; resume ao-assoc; published; the held call answered ao-assoc-cleared:1953459; {"intent":"","association":"221d886a32464c3c0494853badac162e","tmu
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > control: a held clear that runs before its holder is killed leaves tmux and the record in agreement
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
Tests  2 failed | 2 passed (4)
~~~

### 9.8 Section 0 evidence (at the end of the round)

The state root (`find` of the brief; each entry with its writer): `sessions/` and `sessions/ao-orchestrator`
(23:29:03, a record write of the orchestrator session; a rename changes the directory time), `sessions/ao-54` and
`sessions/ao-55` (23:03:33, record writes of those sessions), `sessions/archive` and `sessions/.generations`
(23:00:16, the archive of `ao-59`: `archive/ao-59_2026-10-22T03-00-16-595Z` and its generation floor, the same
millisecond). None is mine: every call of this round ran under `env -i` with scratch roots, and no `ao` ran.

~~~text
$ ls -la --time-style=full-iso /tmp/aosd6-marker
-rw-r--r-- 1 taisung users 0 2026-10-21 22:53:25.491151772 -0400 /tmp/aosd6-marker
$ find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosd6-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions  2026-10-21 23:29:03.947840254 -0400 4096 bytes directory
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/archive  2026-10-21 23:00:16.595219136 -0400 4096 bytes directory
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55  2026-10-21 23:03:33.218502719 -0400 678 bytes regular file
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-54  2026-10-21 23:03:33.214502835 -0400 683 bytes regular file
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/.generations  2026-10-21 23:00:16.594219165 -0400 4096 bytes directory
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator  2026-10-21 23:29:03.947840254 -0400 407 bytes regular file
(end of find)
~~~

Own processes, the real lifecycle workers (never signalled; started before the marker) and the sockets:

~~~text
$ own processes (rerun at 23:47:53): every PID in /tmp/aosd6/logs/pids.txt that still runs, and every process of the uid whose argv or cwd names /tmp/aosd6 or an aosd6- server, outside the tree of this check
(end of list; 21 PIDs recorded by the scripts)
An earlier run of this scan excluded every command line with "grep" and missed one process of mine: the shell 2218741
of a command whose last grep waited on stdin after an assembler failure, with its children grep 2219178 and head 2219179.
I stopped the three by exact PID (SIGTERM) before this rerun.
$ ps -o pid,lstart,stat,comm -p 1294181,1294364
    PID                  STARTED STAT COMMAND
1294181 Wed Oct 21 22:37:31 2026 Ssl  node-MainThread
1294364 Wed Oct 21 22:37:35 2026 Ssl  node-MainThread
$ ls /tmp/tmux-44402 | grep aosd6
(none)
~~~

`ls -la --time-style=full-iso ~/.ao/bin`, before (the start of the round) and after; `diff` prints nothing:

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

## 10. Tests of this round

### 10.1 `packages/core/src/__tests__/same-id-defects-r6.test.ts` (new; `36f5534f`, `c8751762`)

Tag `[same-id R3] (RW)`. The competing operations of B-1 run in a child process: the r5 model, or the built
`dist/inbox.js` when `inbox.ts` exists (the loader refuses a build that is older than the source).

| Test | Kind | Failure on `f907c4c1` (red mode) |
| --- | --- | --- |
| B-1 a prune while a launch begins keeps the launch file that the new record names | defect | `AssertionError: inbox: design r5 model (no inbox.ts), prune: {"pruned":["9b57da58a7e2ac8e17a22ad26f870d20.ndjson"]}: expected false to be true // Object.is equality` |
| B-1 an archive of another launch while a launch begins does not move the file of that launch | defect | `AssertionError: inbox: design r5 model (no inbox.ts), B: {"B":"ca81b8f1bd0dae608c6aa6dd5fee95ae"}: expected false to be true // Object.is equality` |
| B-1 a restore that read the record before an archive intent makes no inbox, and the archive finishes | defect | `AssertionError: inbox: design r5 model (no inbox.ts), recovery: inbox damaged: expected true to be false // Object.is equality` |
| M-1 the barrier finishes every archive that stopped after its intent or after its inbox move | defect | `AssertionError: inbox: design r5 model (no inbox.ts): [{"sessionId":"app-1","result":"finished"},{"sessionId":"app-2","result":"finished"},{"sessionId":"app-3","result":"inbox damaged"},{"sessionId":"app-4","result":"finished"},{"sessionId":"app-5","result":"finished"}]: expected [ 'app-3' ] to deeply equal []` |
| M-2 the barrier refuses while a JS runtime runs that the owner did not allow | defect | `AssertionError: barrier: design r5 E5 model (no fleet-barrier.ts); fixture pid 2163713, cwd /tmp/aosd6/tmp/ao-same-id-r6-e5-SqE943/external: expected true to be false // Object.is equality` |
| a prune removes an empty launch file of a dead maker and keeps the named one | control | passes |
| a spawn of a free ID writes a record that names the file that it made | control | passes |
| M-2 the barrier admits when the owner allows that process too | control | passes |

### 10.2 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r6.test.ts` (new; `36f5534f`, real tmux)

Tag `[same-id R2] (R2b-2)`. The old holder is a node process; its tmux is a `/bin/sh` shim that holds one call;
the test kills the holder by its PID; the new holder runs in the test process.

| Test | Kind | Failure on `f907c4c1` (red mode) |
| --- | --- | --- |
| the held shim client is no tmux process by exe or argv[0], and its argv names the session | control | passes |
| the held clear of a killed holder does not remove the token that the next holder published | defect | `AssertionError: design r5 model (core has no R2b-2 exports): held client argv[0] /bin/sh, exe /usr/bin/dash; resume ao-assoc; published; the held call answered ao-assoc-cleared:2181174; {"intent":"","association":"3edfdb96cd89f4be5a03cb7f8902d1c5","tmux":""}: expected '' to be '3edfdb96cd89f4be5a03cb7f8902d1c5' // Object.is equality` |
| the first tmux call of a killed holder, held in a shell shim, changes nothing after the next holder | defect | `AssertionError: design r5 model (core has no R2b-2 exports): held client argv[0] /bin/sh, exe /usr/bin/dash; resume ao-assoc; published; the held call answered ao-assoc-cleared:2181174; {"intent":"","association":"f9273705cd6109f201458e9a1ffa49fd","tmux":""}: expected '' to be 'f9273705cd6109f201458e9a1ffa49fd' // Object.is equality` |
| a held clear that runs before its holder is killed leaves tmux and the record in agreement | control | passes |

### 10.3 `packages/core/src/__tests__/same-id-defects-r5.test.ts` (changed; `4bdff4d6`)

- The three B-1 races: the oracle "the drain waits for the old writer, then the new record is kept" assumed
  the r5 drain. Under 1b the barrier must refuse while the old mv runs and admit on a second run after the
  writer ended; the record then keeps the new launch and the PR. The between-scans case starts its writer
  inside the callback of check 1, so that only check 2 can see it. The loader takes `../fleet-barrier.ts` with
  `checkFleetAndFence`; the r4 drain model answers "admitted" when it returns. Names: "the barrier refuses
  while an old mv runs whose wrapper died before the first check", "the barrier refuses when an old writer starts
  after its first check", "the barrier refuses while an old wrapper text runs that has no managed file open".
  Failure on `f907c4c1`, each: `AssertionError: barrier: design r4 model (no fleet-barrier.ts), old mv waits at the answer: true: expected true to be false // Object.is equality`.
- The M-1 defect "a pre-RW record takes the line of its legacy pane after the barrier" was wrong under 1b (no
  legacy inbox) and is now the control "after the barrier, a line without a launch ID goes to the orphans, not
  to the record". The control "a new launch ... never takes a later line without a launch ID" lost its
  `initLegacyInbox` call; `InboxApi` lost `initLegacyInbox`.
- Unchanged: the 499-record catch-up and the damaged fragment (defects), the read-boundary control, the fixture
  controls.

### 10.4 Red counts (`SAME_ID_DEFECTS=red`, `/tmp/aosd6/scripts/redcount.sh`)

At `c8751762`:

~~~text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects-r4.test.ts: R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/3 passed
packages/core/src/__tests__/same-id-defects-r5.test.ts: R3 (RW) 5 failed/5 passed
packages/core/src/__tests__/same-id-defects-r6.test.ts: R3 (RW) 5 failed/3 passed
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
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
~~~

Against `f907c4c1` (r5 12.4, and the `f907c4c1` text of the core r5 file rerun from a copy by `redcount_f907.sh`, 12:
`f907c4c1 packages/core/src/__tests__/same-id-defects-r5.test.ts: R3 (RW) 6 failed/4 passed`): new core r6 `R3 (RW) 5 failed/3 passed`; new runtime-tmux r6
`R2 (R2b-2) 2 failed/2 passed`; core r5 `R3 (RW) 6 failed/4 passed` to `5 failed/5 passed` (10.3). Every other
line is equal.

### 10.5 Normal mode and the full run

core r6 `3 passed | 5 expected fail (8)`; core r5 `5 passed | 5 expected fail (10)`; runtime-tmux r6 `4 passed
(4)` (vitest 3.2.4 counts a failing `it.fails` as passed). `pnpm typecheck` and `pnpm lint` exit 0 (lint: the 5
earlier warnings in source files). The full `pnpm -r --no-bail test` at `c8751762`, under 9.1, exit 0:

~~~text
packages/core test:  Test Files  58 passed (58)
packages/core test:       Tests  1415 passed | 35 expected fail (1450)
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
packages/plugins/runtime-tmux test:  Test Files  7 passed (7)
packages/plugins/runtime-tmux test:       Tests  116 passed (116)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  269 passed (269)
~~~

At `f907c4c1` (r5 12.6): core 1411 passed and 31 expected fail, runtime-tmux 112. The difference is the new tests
(core +3 controls of r6 +1 control of r5, +5 defects of r6 -1 defect of r5; runtime-tmux +4).

## 11. Unclear or wrong in the brief

1. The brief asks to "move the narrow client lifetime protection into R2b-2"; the review names "a durable,
   checked child identity/completion protocol or a client lifetime lock". r6 uses a third protocol (5): a fence
   in the tmux server makes the lifetime of the client irrelevant, so it needs no process facts. If the owner
   wants a lifetime protocol anyway, that is a new decision.
2. "No agent process and no pane": `ao` has no command that stops a runtime and keeps the record and the
   worktree (`ao session kill` removes the worktree). The procedure uses the runtime's own stop (2.1 step 3).
3. The r4 core `:262` oracle is wrong under 1b, and the brief forbids a change to the r4 file (OD-26).
4. The review's runtime-tmux line numbers differ from `main` `07ddd952` (7).
5. P1 reads the initial environment of every process of the uid. It holds secrets of other programs; the check
   keeps only `AO_*` keys and prints no value. The RW tests read the processes of the host where they run. My
   measurements read the environment of owned fixtures only.
6. Herdr is not measured (no Herdr in this round): P2 for a Herdr pane rests on P1.
7. "M-1 if the legacy branch stays": it does not stay. One M-1 test is in core r6 anyway, because it fixes the
   order rule of the barrier at low cost.

## 12. Scripts and prototypes (in full)

### /tmp/aosd6/scripts/m1_protocols.mjs

~~~js
// m1_protocols.mjs (review r5 B-1 and M-1, design r6 section 3): the inbox reservation, prune, archive and
// recovery of design r5 (file first, then the record; each step takes the record lock on its own) and of
// design r6 (one transaction under the synchronous record lock). Both use the real record functions of the
// worktree build (core dist at f907c4c1; metadata.ts equals main). Scratch directories only.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
const M = await import("/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js");
export const { readMetadataRaw, withRecordLock } = M;

const box = (dir, id) => join(dir, ".inbox", id);
const moved = (dir, id, ts) => join(dir, "archive", `${id}_${ts}.inbox`);
/** The launch identity of r6: today's keys plus launchId and archiveIntent. */
const identity = (r) => ({ ...M.launchIdentity(r), launchId: r.launchId ?? "", archiveIntent: r.archiveIntent ?? "" });
const newLaunch = () => randomBytes(8).toString("hex");
function candidate(dir, id, L) {
  mkdirSync(box(dir, id), { recursive: true });
  writeFileSync(join(box(dir, id), `${L}.ndjson`), "", { flag: "wx" });
}
/** Classify the archive state of a record with archiveIntent (r5 3.6 and r6 3.4 agree on this table). */
export function archiveState(dir, id) {
  const r = readMetadataRaw(dir, id);
  if (!r?.archiveIntent) return r ? "active" : "no record";
  const src = existsSync(box(dir, id)), dst = existsSync(moved(dir, id, r.archiveIntent));
  return src && dst ? "inbox damaged" : !src && !dst ? (r.launchId ? "inbox damaged" : "no inbox (pre-RW)") : src ? "to move" : "moved";
}
function finishArchive(dir, id) { // the recovery of an archive intent
  const r = readMetadataRaw(dir, id);
  const st = archiveState(dir, id);
  if (st === "inbox damaged") return st;
  if (st === "to move") { mkdirSync(join(dir, "archive"), { recursive: true }); renameSync(box(dir, id), moved(dir, id, r.archiveIntent)); }
  M.deleteMetadata(dir, id, true, { archiveIntent: r.archiveIntent });
  return "finished";
}
export function prune(dir, id) { // both rounds: under the record lock, an empty file that the record does not name
  return M.withRecordLock(dir, id, () => {
    if (!existsSync(box(dir, id))) return [];
    const named = readMetadataRaw(dir, id)?.launchId;
    const removed = [];
    for (const f of readdirSync(box(dir, id))) {
      const p = join(box(dir, id), f);
      if (f !== `${named}.ndjson` && statSync(p).size === 0) { unlinkSync(p); removed.push(f); }
    }
    return removed;
  });
}

export const r5 = {
  name: "r5",
  /** r5 3.2: file first (step 1), then the record write (step 2); `seen` is the record that a restore read before. */
  begin(dir, id, { spawn = false, seen, onCandidate } = {}) {
    const L = newLaunch();
    candidate(dir, id, L);
    onCandidate?.();
    if (spawn) return M.reserveSessionRecord(dir, id, { launchId: L, launchState: "preparing" }) ? L : null;
    const r = seen ?? readMetadataRaw(dir, id);
    return r && M.updateMetadataIf(dir, id, identity(r), { launchId: L, launchState: "preparing", inboxCursor: "" }) ? L : null;
  },
  publish(dir, id, L) { return !!M.updateMetadataIf(dir, id, { launchId: L, launchState: "preparing", archiveIntent: "" }, { launchState: "published" }); },
  /** r5 3.6: intent (step 2), the inbox move (step 3), the record archive (step 4); each its own lock hold. */
  archive(dir, id, L, { crashAfter } = {}) {
    const r = readMetadataRaw(dir, id);
    if (!r || r.launchId !== L) return false;
    const ts = String(Date.now());
    if (!M.updateMetadataIf(dir, id, identity(r), { archiveIntent: ts })) return false;
    if (crashAfter === 2) return "crash";
    mkdirSync(join(dir, "archive"), { recursive: true });
    if (existsSync(box(dir, id))) renameSync(box(dir, id), moved(dir, id, ts));
    if (crashAfter === 3) return "crash";
    return M.deleteMetadata(dir, id, true, { archiveIntent: ts });
  },
  recover: (dir, id) => (readMetadataRaw(dir, id)?.archiveIntent ? finishArchive(dir, id) : "nothing"),
  /** r5 6.1: step 6a (legacy files for every active record without launchId) before step 7c (recovery). */
  barrier(dir, ids) {
    for (const id of ids) {
      const r = readMetadataRaw(dir, id);
      if (r && !r.launchId) { mkdirSync(box(dir, id), { recursive: true }); try { writeFileSync(join(box(dir, id), "legacy.ndjson"), "", { flag: "wx" }); } catch {} }
    }
    return ids.map((id) => `${id}: ${readMetadataRaw(dir, id)?.archiveIntent ? finishArchive(dir, id) : "nothing"}`);
  },
};

export const r6 = {
  name: "r6",
  /** r6 3.2: one transaction under the record lock: recover an archive, check the ID, the file, the record. */
  begin(dir, id, { spawn = false, onCandidate } = {}) {
    return M.withRecordLock(dir, id, () => {
      if (readMetadataRaw(dir, id)?.archiveIntent && finishArchive(dir, id) !== "finished") return null;
      const r = readMetadataRaw(dir, id);
      if (spawn ? r : !r) return null;
      const L = newLaunch();
      candidate(dir, id, L);
      onCandidate?.();
      const ok = spawn
        ? M.reserveSessionRecord(dir, id, { launchId: L, launchState: "preparing" })
        : M.updateMetadataIf(dir, id, identity(r), { launchId: L, launchState: "preparing", inboxCursor: "" });
      if (!ok) unlinkSync(join(box(dir, id), `${L}.ndjson`));
      return ok ? L : null;
    });
  },
  publish: r5.publish,
  /** r6 3.4: after the catch-up, ONE lock hold: the intent, the inbox move, the record archive. */
  archive(dir, id, L, { crashAfter } = {}) {
    return M.withRecordLock(dir, id, () => {
      const r = readMetadataRaw(dir, id);
      if (!r || r.launchId !== L || r.archiveIntent) return false;
      const ts = String(Date.now());
      if (!M.updateMetadataIf(dir, id, identity(r), { archiveIntent: ts })) return false;
      if (crashAfter === 2) return "crash";
      mkdirSync(join(dir, "archive"), { recursive: true });
      if (existsSync(box(dir, id))) renameSync(box(dir, id), moved(dir, id, ts));
      if (crashAfter === 3) return "crash";
      return M.deleteMetadata(dir, id, true, { archiveIntent: ts });
    });
  },
  recover: (dir, id) => M.withRecordLock(dir, id, () => (readMetadataRaw(dir, id)?.archiveIntent ? finishArchive(dir, id) : "nothing")),
  /** r6 5.2: recovery of every archive intent first; no legacy initialization at all. */
  barrier(dir, ids) { return ids.map((id) => `${id}: ${r6.recover(dir, id)}`); },
};
export const protocols = { r5, r6 };
~~~
### /tmp/aosd6/scripts/m1_child.mjs

~~~js
// m1_child.mjs <r5|r6> <prune|spawn-publish-archive> <sessions dir> <marker dir>: the competing process of the m1
// schedules. It writes <marker>/trying just before its operation and <marker>/done with the result after it.
import { writeFileSync } from "node:fs";
import { protocols, prune } from "/tmp/aosd6/scripts/m1_protocols.mjs";
if (Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const [round, op, dir, marker] = process.argv.slice(2);
const P = protocols[round];
writeFileSync(`${marker}/trying`, String(process.pid));
let result;
try {
  if (op === "prune") result = { pruned: prune(dir, "app-1") };
  else {
    const B = P.begin(dir, "app-1", { spawn: true });
    const published = B ? P.publish(dir, "app-1", B) : false;
    const archived = B ? P.archive(dir, "app-1", B) : false;
    result = { B, published, archived };
  }
} catch (e) { result = { error: String(e?.message ?? e) }; }
writeFileSync(`${marker}/done`, JSON.stringify(result));
~~~
### /tmp/aosd6/scripts/m1_inbox_ownership.mjs

~~~js
// m1 (review r5 B-1 and M-1, design r6 sections 3 and 5): the schedules of the review against the inbox rules of
// design r5 and of design r6 (m1_protocols.mjs), on scratch directories, with the real record functions of the
// worktree build. The competing operation runs in ANOTHER process (m1_child.mjs), started from inside A's
// candidate step; A waits there until the child is about to run its operation, then up to 1000 ms more.
//   S1 prune: A makes its candidate for a free ID; a prune runs; A reserves.
//   S2 archive: A makes its candidate; B makes its candidate, reserves and publishes the ID; C archives B; A reserves.
//   S3 restore after archive step 3: a restore read the record before an archive wrote its intent and moved the
//      inbox (then crashed); the restore makes its candidate and writes the record; then the recovery runs.
//   S4 the barrier after an archive crash of a pre-RW record (review M-1): r5 order (legacy init, then recovery)
//      against r6 order (recovery only; no legacy init).
// Run: env -i HOME=/tmp/aosd6/home PATH=/tmp/aosd6/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd6/tmp \
//        node /tmp/aosd6/scripts/m1_inbox_ownership.mjs
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { protocols, archiveState, readMetadataRaw } from "/tmp/aosd6/scripts/m1_protocols.mjs";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const root = "/tmp/aosd6/m1";
rmSync(root, { recursive: true, force: true });
const sab = new Int32Array(new SharedArrayBuffer(4));
const waitSync = (ms) => Atomics.wait(sab, 0, 0, ms);
const children = [];
/** Start the competing process and wait (synchronously, inside A's step) until it runs, then up to 1000 ms. */
function compete(round, op, dir, tag) {
  const marker = join(root, `${tag}-marker`);
  mkdirSync(marker, { recursive: true });
  const c = spawn(process.execPath, ["/tmp/aosd6/scripts/m1_child.mjs", round, op, dir, marker], { stdio: "ignore" });
  appendFileSync("/tmp/aosd6/logs/pids.txt", `m1 child ${tag} pid=${c.pid}\n`);
  children.push(new Promise((r) => c.once("exit", r)));
  for (let i = 0; i < 400 && !existsSync(`${marker}/trying`); i++) waitSync(10);
  for (let i = 0; i < 100 && !existsSync(`${marker}/done`); i++) waitSync(10);
  return () => (existsSync(`${marker}/done`) ? JSON.parse(readFileSync(`${marker}/done`, "utf8")) : "(not done)");
}
const show = (l, v) => console.log(`  ${l.padEnd(44)} ${v}`);
const fileOf = (dir, L) => join(dir, ".inbox", "app-1", `${L}.ndjson`);

for (const round of ["r5", "r6"]) {
  const P = protocols[round];
  console.log(`== ${round}`);
  { // S1
    const dir = join(root, `${round}-s1`); mkdirSync(dir, { recursive: true });
    let during, child;
    const A = P.begin(dir, "app-1", { spawn: true, onCandidate: () => { child = compete(round, "prune", dir, `${round}-s1`); during = child(); } });
    await Promise.all(children.splice(0));
    show("S1 prune: child during A's step; at end", `${JSON.stringify(during)}; ${JSON.stringify(child())}`);
    show("S1 A reserved; A's named inbox exists", `${A !== null}; ${A !== null && existsSync(fileOf(dir, A))}`);
  }
  { // S2
    const dir = join(root, `${round}-s2`); mkdirSync(dir, { recursive: true });
    let child;
    const A = P.begin(dir, "app-1", { spawn: true, onCandidate: () => { child = compete(round, "spawn-publish-archive", dir, `${round}-s2`); } });
    await Promise.all(children.splice(0));
    const archived = existsSync(join(dir, "archive")) ? readdirSync(join(dir, "archive")) : [];
    show("S2 child B and C", JSON.stringify(child()));
    show("S2 A reserved; A's inbox active; A's file archived", `${A !== null}; ${A !== null && existsSync(fileOf(dir, A))}; ${A !== null && archived.some((d) => existsSync(join(dir, "archive", d, `${A}.ndjson`)))}`);
  }
  { // S3
    const dir = join(root, `${round}-s3`); mkdirSync(dir, { recursive: true });
    const L0 = P.begin(dir, "app-1", { spawn: true }); P.publish(dir, "app-1", L0);
    const seen = readMetadataRaw(dir, "app-1"); // the restore's read (r5: before the archive's intent)
    P.archive(dir, "app-1", L0, { crashAfter: 3 }); // an archive wrote its intent, moved the inbox, crashed
    const A = round === "r5" ? P.begin(dir, "app-1", { seen }) : P.begin(dir, "app-1");
    const state = archiveState(dir, "app-1");
    const rec = P.recover(dir, "app-1");
    show("S3 restore result; state before recovery; recovery", `${A === null ? "refused" : "launch " + A}; ${state}; ${rec}`);
    show("S3 after: record exists; active inbox exists", `${readMetadataRaw(dir, "app-1") !== null}; ${existsSync(join(dir, ".inbox", "app-1"))}`);
  }
  { // S4
    const dir = join(root, `${round}-s4`); mkdirSync(join(dir, ".inbox", "app-1"), { recursive: true });
    const M = await import("/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js");
    M.writeMetadata(dir, "app-1", { worktree: "/w", branch: "feat/app-1", status: "working", runtimeHandle: '{"id":"x"}', ...(round === "r5" ? { inboxLegacy: "barrier-1" } : {}) });
    if (round === "r5") M.updateMetadata(dir, "app-1", { archiveIntent: "T1" }); // a pre-RW record of r5 with a legacy inbox
    else M.updateMetadata(dir, "app-1", { archiveIntent: "T1" }); // r6: a pre-RW record has no inbox
    mkdirSync(join(dir, "archive"), { recursive: true });
    if (round === "r5") renameSync(join(dir, ".inbox", "app-1"), join(dir, "archive", "app-1_T1.inbox")); // crash after step 3
    else rmSync(join(dir, ".inbox", "app-1"), { recursive: true }); // r6: no legacy inbox was ever made
    show("S4 barrier after the archive crash", JSON.stringify(P.barrier(dir, ["app-1"])));
    show("S4 after: record exists; active inbox exists", `${readMetadataRaw(dir, "app-1") !== null}; ${existsSync(join(dir, ".inbox", "app-1"))}`);
  }
}
await Promise.all(children);
console.log("All files are in /tmp/aosd6/m1. The record functions are the real ones; the inbox steps are the r5 and r6 rules.");
~~~
### /tmp/aosd6/scripts/m2_stale_client.mjs

~~~js
// m2 (review r5 B-2, design r6 section 6): a killed lock holder whose tmux client is a held /bin/sh shim (exe
// dash), on a private tmux 3.4 server (-L aosd6-stale only). The old holder is ANOTHER process (node -e) that
// binds the per-ID operation lock (an abstract Unix socket) and starts the shim; the script kills that holder by
// its exact PID; a new holder (this process) takes the lock and resumes the association; then the shim runs.
//   a. r5 rules: the lock plus the stale-client wait of r5 5.4 (exe or argv[0] basename tmux, argv names =<name>).
//   b. r6 fence: each holder first fences the session (a compare-and-set of the session option @ao_op from the
//      value that it read to its own operation ID), and each of its association commands checks @ao_op inside
//      tmux. The old holder fenced, then its clear is held.
//   c. r6 fence, the old holder's FENCE itself is held (the holder died before its first command ran).
//   d. control, r5 rules: the shim is released before the kill (no stale client).
// After each schedule: does the tmux token equal the token that the record names?
// The record is a JSON stand-in with a compare of the launch identity, as in a1 (r5) and the review.
// Run: env -i HOME=/tmp/aosd6/home PATH=/tmp/aosd6/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd6/tmp \
//        SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd6/scripts/m2_stale_client.mjs
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd6", SRV = "aosd6-stale", T0 = `${S}/tmp/m2`;
const sock = `/tmp/tmux-${process.getuid()}/${SRV}`;
if (existsSync(sock)) throw new Error(`${sock} exists: not started by this script`);
rmSync(T0, { recursive: true, force: true }); mkdirSync(T0, { recursive: true });
const ticks = (p) => { try { const s = readFileSync(`/proc/${p}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
const started = new Map();
const track = (pid, what) => { if (pid && !started.has(pid)) { started.set(pid, { what, t: ticks(pid) }); appendFileSync(`${S}/logs/pids.txt`, `m2 ${what} pid=${pid}\n`); } };
const tm = (args) => { const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...args], { encoding: "utf8" }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
const q = (f) => `"${f}"`;
const token = () => randomBytes(16).toString("hex");
const opt = (name, o) => tm(["display-message", "-p", "-t", `=${name}:`, `#{${o}}`]).out;
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const BASE = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}";
const want = (name, ev) => `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
// The forms of r4 3.2/3.3 (r5), and the same forms with the fence value inside the compare (r6).
const ident = (op) => (op === undefined ? `${BASE}/#{@ao_launch}` : `${BASE}/#{@ao_launch}/#{@ao_op}`);
const tail = (op) => (op === undefined ? "" : `/${op}`);
function associateArgs(name, ev, tok, op) {
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${ident(op)}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tok}${tail(op)}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tail(op)}}`)} { ${set} } { ${second} }`);
}
function clearArgs(name, ev, tok, op) {
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${ident(op)}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${ident(op)},${want(name, ev)}/${tok}${tail(op)}}`)} { ${clear} } { ${no} }`);
}
/** r6: the fence, a compare-and-set of @ao_op from `seen` to `op` on the evidence session. */
function fenceArgs(name, ev, seen, op) {
  const set = `set-option -t =${name}: @ao_op ${op} ; display-message -p -t =${name}: ${q("ao-fenced:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-fence-refused:${BASE}/#{@ao_op}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${BASE}/#{@ao_op},${want(name, ev)}/${seen}}`)} { ${set} } { ${no} }`);
}
const mark = (r) => r.out.split("\n").find((l) => /^ao-(assoc|refused|fence)/.test(l)) ?? r.out;

const recPath = `${T0}/record.json`;
const readRec = () => JSON.parse(readFileSync(recPath, "utf8"));
const writeRec = (o) => { writeFileSync(`${recPath}.w`, JSON.stringify(o)); renameSync(`${recPath}.w`, recPath); };
const identity = (r) => JSON.stringify([r.associationIntent ?? null, r.runtimeAssociation ?? null, r.runtimeHandle]);
const casRec = (expected, patch) => { const r = readRec(); if (identity(r) !== expected) return false; writeRec({ ...r, ...patch }); return true; };
async function opLock(name) {
  const addr = `\0aosd6-m2-operation-${name}`;
  for (const t0 = performance.now(); ;) {
    const srv = createServer();
    const ok = await new Promise((res, rej) => { srv.once("error", (e) => (e.code === "EADDRINUSE" ? res(false) : rej(e))); srv.listen(addr, () => res(true)); });
    if (ok) return () => new Promise((r) => srv.close(r));
    if (performance.now() - t0 > 30_000) throw new Error("operation lock busy for 30 s");
    await sleep(20);
  }
}
/** r5 5.4 step 2: the uid's processes whose exe or argv[0] basename is tmux and whose argv names =<name>. */
function staleClients(name) {
  const found = [];
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    try {
      if (statSync(`/proc/${e}`).uid !== process.getuid()) continue;
      const a = readFileSync(`/proc/${e}/cmdline`, "utf8").split("\0").filter(Boolean);
      let exe; try { exe = readlinkSync(`/proc/${e}/exe`).split("/").at(-1); } catch { exe = a[0]?.split("/").at(-1); }
      if (exe !== "tmux" && a[0]?.split("/").at(-1) !== "tmux") continue;
      if (a.some((x) => new RegExp(`=${name}(:|\\s|$)`).test(x))) found.push(Number(e));
    } catch {}
  }
  return found;
}

async function schedule(label, mode, holdWhat, releaseBeforeKill) {
  const name = `m2-${label}`;
  for (const f of ["ready", "go", "pid", "held.out"]) rmSync(`${T0}/${f}`, { force: true });
  tm(["new-session", "-d", "-s", name, "/bin/sleep 600"]);
  track(Number(tm(["display-message", "-p", "#{pid}"]).out), "tmux server aosd6-stale");
  const [serverPid, sid, panePid] = tm(["display-message", "-p", "-t", `=${name}:`, "#{pid}|#{session_id}|#{pane_pid}"]).out.split("|");
  const ev = { serverPid, sid, panePid }, T = token();
  writeRec({ runtimeHandle: name, T, associationIntent: { token: T, ev }, runtimeAssociation: null });
  tm(associateArgs(name, ev, T)); // an earlier tmux step set T; its answer was lost (r4 3.3 row 2)
  // The old holder: lock, (r6) its fence, then its clear, through the held shim at holdWhat.
  const shim = `${T0}/tmux`;
  writeFileSync(shim, `#!/bin/sh\necho $$ > '${T0}/pid'\n: > '${T0}/ready'\nwhile [ ! -e '${T0}/go' ]; do /bin/sleep 0.02; done\nexec /usr/bin/tmux -f /dev/null -L ${SRV} "$@"\n`, { mode: 0o755 });
  const opA = mode === "r6" ? token().slice(0, 12) : undefined;
  const fenceA = mode === "r6" ? fenceArgs(name, ev, opt(name, "@ao_op"), opA) : null;
  const clearA = clearArgs(name, ev, T, opA);
  const direct = holdWhat === "fence" ? [] : fenceA ? [fenceA] : [];
  const held = holdWhat === "fence" ? fenceA : clearA;
  writeFileSync(`${T0}/plan.json`, JSON.stringify({ direct, held }));
  const src = `import {createServer} from 'node:net';import {spawn,spawnSync} from 'node:child_process';import {readFileSync,openSync} from 'node:fs';
const p=JSON.parse(readFileSync('${T0}/plan.json','utf8'));const s=createServer();s.listen('\\0aosd6-m2-operation-${name}',()=>{
for(const a of p.direct)spawnSync('/usr/bin/tmux',['-f','/dev/null','-L','${SRV}',...a]);
spawn('${shim}',p.held,{stdio:['ignore',openSync('${T0}/held.out','w'),'ignore']});});`;
  const holder = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: "ignore" });
  track(holder.pid, `old holder ${label}`);
  const exited = new Promise((r) => holder.once("exit", r));
  for (let i = 0; i < 500 && !existsSync(`${T0}/ready`); i++) await sleep(10);
  const client = Number(readFileSync(`${T0}/pid`, "utf8")); track(client, `held shim ${label}`);
  const argv = readFileSync(`/proc/${client}/cmdline`, "utf8").split("\0").slice(0, 2);
  const exe = readlinkSync(`/proc/${client}/exe`);
  if (releaseBeforeKill) { writeFileSync(`${T0}/go`, ""); for (let i = 0; i < 300 && existsSync(`/proc/${client}`); i++) await sleep(10); }
  process.kill(holder.pid, "SIGKILL"); await exited;
  // The new holder.
  const release = await opLock(name);
  const stale = staleClients(name);
  let fenceB = "", out;
  if (mode === "r6") {
    const opB = token().slice(0, 12);
    fenceB = mark(tm(fenceArgs(name, ev, opt(name, "@ao_op"), opB)));
    out = mark(tm(associateArgs(name, ev, T, opB)));
  } else out = mark(tm(associateArgs(name, ev, T)));
  const r = readRec();
  const published = /^ao-assoc(-adopt)?:/.test(out) && casRec(identity(r), { associationIntent: null, runtimeAssociation: { token: T, ev } });
  await release();
  writeFileSync(`${T0}/go`, "");
  for (let i = 0; i < 300 && existsSync(`/proc/${client}`) && ticks(client) === started.get(client).t; i++) await sleep(10);
  const heldAnswer = mark({ out: readFileSync(`${T0}/held.out`, "utf8") });
  const tok = opt(name, "@ao_launch"), named = readRec().runtimeAssociation?.token ?? "";
  console.log(`== ${label}: ${mode}, held ${holdWhat}${releaseBeforeKill ? ", released before the kill" : ""}`);
  console.log(`  held client argv ${JSON.stringify(argv)} exe ${exe}`);
  console.log(`  new holder: stale-client matches ${JSON.stringify(stale)}; ${fenceB ? `fence ${fenceB.split(":")[0]}; ` : ""}resume ${out.split(":")[0]}; record published ${published}`);
  console.log(`  the held command ran: ${heldAnswer.replace(/[0-9a-f]{12,}/g, "<hex>")}`);
  console.log(`  record names ${named === T ? "T" : named || '""'}; tmux token ${tok === T ? "T" : tok || '""'}; @ao_op ${opt(name, "@ao_op") ? "set" : '""'}; ${named === tok ? "CONSISTENT" : "INCONSISTENT"}`);
  tm(["kill-session", "-t", `=${name}`]);
}

try {
  await schedule("a", "r5", "clear", false);
  await schedule("b", "r6", "clear", false);
  await schedule("c", "r6", "fence", false);
  await schedule("d", "r5", "clear", true);
} finally {
  for (const [p, { what, t }] of started) if (!what.startsWith("tmux server") && ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
  tm(["kill-server"]);
  await sleep(200);
  for (const [p, { what, t }] of started) if (what.startsWith("tmux server") && ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
  await sleep(100);
  if (existsSync(sock)) unlinkSync(sock); // the socket of the server that this script started
  const left = [...started].filter(([p, { t }]) => ticks(p) === t).map(([p]) => p);
  console.log(`started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(sock)}`);
}
~~~
### /tmp/aosd6/scripts/m3_server_option.sh

~~~sh
#!/bin/sh
# m3 (design r6 section 6.4): does tmux 3.4 keep a user option at server level, and can a gate read it?
# Private server -L aosd6-opt only; the script removes the socket of its own server at the end.
# Run: env -i HOME=/tmp/aosd6/home PATH=/usr/bin:/bin LANG=C.UTF-8 sh /tmp/aosd6/scripts/m3_server_option.sh
set -u
SOCK=/tmp/tmux-$(id -u)/aosd6-opt
[ -e "$SOCK" ] && { echo "$SOCK exists: not mine"; exit 1; }
T() { /usr/bin/tmux -f /dev/null -L aosd6-opt "$@"; }
T new-session -d -s keep '/bin/sleep 120'
SP=$(T display-message -p '#{pid}'); echo "m3 server pid=$SP" >> /tmp/aosd6/logs/pids.txt
T set-option -s @ao_op_m2x opA; echo "set -s exit $?"
T display-message -p -t =keep: 'server option in a session format: [#{@ao_op_m2x}]'
T if-shell -F '#{==:#{@ao_op_m2x},opA}' 'display-message -p gate-true' 'display-message -p gate-false'
T kill-server; sleep 0.3
[ -e "$SOCK" ] && rm "$SOCK" && echo "removed the socket of my own server"
ps -o pid= -p "$SP" >/dev/null && echo "server $SP still runs" || echo "server $SP ended"
~~~
### /tmp/aosd6/scripts/m4_external.mjs

~~~js
// m4_external.mjs: an owned fixture of m4. It imports the built installer of core by an absolute path from an
// external cwd (review r5 M-2) and stays resident. It writes nothing; it only holds the module.
const m = await import("/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/agent-workspace-hooks.js");
if (typeof m.setupPathWrapperWorkspace !== "function") throw new Error("no installer");
setInterval(() => {}, 1000);
~~~
### /tmp/aosd6/scripts/m4_precondition.mjs

~~~js
// m4 (review r5 M-2, design r6 section 2.2): what the precondition check of the stopped-fleet barrier reads, on
// owned fixtures, against the E5 predicate of design r5 6.2.
//   F1 node, cwd /tmp/aosd6/external, imports the built core installer by an absolute path (the review's case)
//   F2 /bin/sleep with AO_SESSION and AO_DATA_DIR in its environment (an orphaned writer stand-in)
//   F3 a pane of an AO-named session (<12 hex>-app-1) on the private tmux server -L aosd6-pre
// Rules of r6: P1 an AO_* key in the initial environment (read for owned fixtures only here), P2 an AO-named
// session on a tmux server of the uid (only the own private server is queried here), P3 a JS runtime (exe
// basename node, nodejs, bun or deno) that the owner did not allow by PID and start ticks.
// The host part counts the processes of the uid by exe basename only; it reads no environment and no argv of a
// process that this script did not start, and it never signals one.
// Run: env -i HOME=/tmp/aosd6/home PATH=/tmp/aosd6/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd6/tmp \
//        node /tmp/aosd6/scripts/m4_precondition.mjs
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, unlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const SRV = "aosd6-pre", sock = `/tmp/tmux-${process.getuid()}/${SRV}`;
if (existsSync(sock)) throw new Error(`${sock} exists: not started by this script`);
const ticks = (p) => { try { const s = readFileSync(`/proc/${p}/stat`, "utf8"); return s.slice(s.lastIndexOf(")") + 2).split(" ")[19]; } catch { return null; } };
const started = new Map();
const track = (pid, what) => { started.set(pid, { what, t: ticks(pid) }); appendFileSync("/tmp/aosd6/logs/pids.txt", `m4 ${what} pid=${pid}\n`); };
const tm = (...a) => spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...a], { encoding: "utf8" });
mkdirSync("/tmp/aosd6/external", { recursive: true });

const f1 = spawn(process.execPath, ["/tmp/aosd6/scripts/m4_external.mjs"], { cwd: "/tmp/aosd6/external", stdio: "ignore" });
track(f1.pid, "F1 external importer");
const f2 = spawn("/bin/sleep", ["60"], { env: { PATH: "/usr/bin:/bin", AO_SESSION: "app-1", AO_DATA_DIR: "/tmp/aosd6/m4/sessions" }, stdio: "ignore" });
track(f2.pid, "F2 AO env");
tm("new-session", "-d", "-s", "aaaaaaaaaaaa-app-1", "/bin/sleep 60");
const [srvPid, panePid] = tm("display-message", "-p", "-t", "=aaaaaaaaaaaa-app-1:", "#{pid} #{pane_pid}").stdout.trim().split(" ").map(Number);
track(srvPid, "F3 tmux server"); track(panePid, "F3 pane");
await sleep(500);

const BUILD_ROOTS = ["/home/taisung/.worktrees/agent-orchestrator/ao-52", "/home/taisung/local/agent-orchestrator"];
const under = (p) => BUILD_ROOTS.some((r) => p === r || p.startsWith(`${r}/`));
const exeBase = (p) => { try { return readlinkSync(`/proc/${p}/exe`).split("/").at(-1); } catch { return null; } };
const JS = new Set(["node", "nodejs", "bun", "deno"]);
function rulesFor(p) {
  const argv = readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0").filter(Boolean);
  const cwd = readlinkSync(`/proc/${p}/cwd`);
  const env = readFileSync(`/proc/${p}/environ`, "utf8").split("\0").filter(Boolean); // owned fixtures only
  const exe = exeBase(p);
  return {
    "r5 E5 (argv or cwd under a build root)": JS.has(exe) && (argv.some(under) || under(cwd)),
    "r6 P1 (AO_* in environ)": env.some((e) => e.startsWith("AO_")),
    "r6 P3 (JS runtime, not allowed)": JS.has(exe),
  };
}
const panes = tm("list-panes", "-a", "-F", "#{session_name} #{pane_pid}").stdout.trim().split("\n");
const aoPanes = panes.filter((l) => /^[0-9a-f]{12}-/.test(l)).map((l) => Number(l.split(" ")[1]));
for (const [p, { what }] of started) {
  if (what === "F3 tmux server") continue;
  const r = rulesFor(p);
  if (what === "F3 pane") r["r6 P2 (pane of an AO-named session)"] = aoPanes.includes(p);
  console.log(`${what.padEnd(22)} exe ${exeBase(p)}; cwd ${readlinkSync(`/proc/${p}/cwd`)}`);
  for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(40)} ${v}`);
}

// Host counts: exe basename only, no environment, no argv, no signal.
const counts = new Map(); let total = 0, unreadable = 0;
for (const e of readdirSync("/proc")) {
  if (!/^\d+$/.test(e)) continue;
  const p = Number(e);
  if (p === process.pid || started.has(p)) continue;
  try { if (statSync(`/proc/${e}`).uid !== process.getuid()) continue; } catch { continue; }
  total++;
  const b = exeBase(p);
  if (b === null) { unreadable++; continue; }
  counts.set(b, (counts.get(b) ?? 0) + 1);
}
const js = [...counts].filter(([b]) => JS.has(b)).reduce((a, [, n]) => a + n, 0);
console.log(`host, uid ${process.getuid()}: ${total} other processes; JS runtimes ${js}; tmux ${counts.get("tmux") ?? 0}; exe unreadable ${unreadable}`);
console.log(`host exe basenames: ${JSON.stringify([...counts].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);

for (const [p, { what, t }] of started) if (!what.includes("server") && ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
tm("kill-server");
await sleep(300);
for (const [p, { t }] of started) if (ticks(p) === t) try { process.kill(p, "SIGKILL"); } catch {}
await sleep(100);
if (existsSync(sock)) unlinkSync(sock);
const left = [...started].filter(([p, { t }]) => ticks(p) === t).map(([p]) => p);
console.log(`started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(sock)}`);
~~~
### /tmp/aosd6/scripts/m5_host_classes.sh

~~~sh
#!/bin/sh
# m5 (design r6 section 2.3, costs): for each process of the uid that the r6 precondition must look at (a JS
# runtime by exe basename, or an exe link that the kernel does not let the uid read), print the PID, the comm
# and the exe basename of its parent. It reads only /proc/<pid>/stat and the exe links: no argv, no environment,
# no signal. The two known lifecycle workers are named by their PID.
# Run: env -i PATH=/usr/bin:/bin LANG=C sh /tmp/aosd6/scripts/m5_host_classes.sh
U=$(id -u)
for d in /proc/[0-9]*; do
  p=${d#/proc/}; [ "$(stat -c %u "$d" 2>/dev/null)" = "$U" ] || continue; [ "$p" = "$$" ] && continue
  exe=$(readlink "$d/exe" 2>/dev/null); b=${exe##*/}
  st=$(cat "$d/stat" 2>/dev/null) || continue
  comm=${st#*(}; comm=${comm%)*}; rest=${st##*) }; pp=$(echo "$rest" | cut -d' ' -f2)
  pexe=$(readlink "/proc/$pp/exe" 2>/dev/null); pb=${pexe##*/}
  case "$b" in node|nodejs|bun|deno) kind=js ;; "") kind=unreadable ;; *) continue ;; esac
  tag=""; [ "$p" = 1294181 ] || [ "$p" = 1294364 ] && tag=" (a real lifecycle worker)"
  echo "$kind pid=$p comm=$comm parent=$pp parent-exe=${pb:-unreadable}$tag"
done | sort
~~~
### /tmp/aosd6/scripts/val6.sh

~~~sh
#!/usr/bin/env bash
# val6.sh: run the r6 test files and the changed r5 test files against the scratch prototypes of design r6
# (/tmp/aosd6/val/core/{inbox.ts,fleet-barrier.ts}, /tmp/aosd6/val/dist/inbox.js, /tmp/aosd6/val/tmux/assoc-proto.ts
# with /tmp/aosd6/val/tmux/dist/core.js), to check that a correct implementation of the r6 rules turns the defects
# green. The test files are copied to /tmp/aosd6/val with sed; only import specifiers change. Nothing in the
# worktree changes. Red mode: every defect runs as a plain test.
set -e
S=/tmp/aosd6; V=$S/val; W=/home/taisung/.worktrees/agent-orchestrator/ao-52; C=$W/packages/core/src; T=$W/packages/plugins/runtime-tmux/src
mkdir -p $V/core/__tests__ $V/tmux/__tests__
[ -e $V/core/node_modules ] || ln -s $W/packages/core/node_modules $V/core/node_modules
[ -e $V/tmux/node_modules ] || ln -s $W/packages/plugins/runtime-tmux/node_modules $V/tmux/node_modules
touch $V/dist/inbox.js # not older than the in-process face
sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" \
  -e "s#new URL(\"\.\./\.\./dist/agent-workspace-hooks\.js\", import\.meta\.url)#new URL(\"file://$W/packages/core/dist/agent-workspace-hooks.js\")#" \
  $C/__tests__/same-id-defects-r6.test.ts > $V/core/__tests__/same-id-defects-r6.test.ts
sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" -e 's#^      writer: AO_METADATA_HELPER,$#      writer: mod["WRITER"] as string,#' \
  $C/__tests__/same-id-defects-r5.test.ts > $V/core/__tests__/same-id-defects-r5.test.ts
if [ -e $T/__tests__/same-id-defects-r6.test.ts ]; then
  sed -e 's#import \* as core from "@aoagents/ao-core";#import * as core from "../assoc-proto.ts";#' \
    -e "s#from \"\.\./index\.js\"#from \"$T/index.ts\"#" \
    -e "s#new URL(\"\.\./\.\./\.\./\.\./core/dist/index\.js\", import\.meta\.url)#new URL(\"file://$V/tmux/dist/core.js\")#" \
    -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"file://$W/packages/plugins/runtime-tmux/dist/index.js\")#" \
    $T/__tests__/same-id-defects-r6.test.ts > $V/tmux/__tests__/same-id-defects-r6.test.ts
fi
run() {
  (cd "$1" && env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
    PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run --root "$1" "${@:2}" 2>&1) |
    sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ *(✓|×)|→|Tests ' | sed -e 's/^ *//' -e 's/ [0-9]*ms$//' | cut -c1-220
}
echo "== core r6 against inbox.ts (prototype)"; run $V/core __tests__/same-id-defects-r6.test.ts
echo "== core r5 (changed) against fleet-barrier.ts and inbox.ts (prototypes)"; run $V/core __tests__/same-id-defects-r5.test.ts
if [ -e $V/tmux/__tests__/same-id-defects-r6.test.ts ]; then
  echo "== runtime-tmux r6 against assoc-proto.ts (prototype)"; run $V/tmux __tests__/same-id-defects-r6.test.ts
fi
~~~
### /tmp/aosd6/val/dist/inbox.js

~~~js
// Validation prototype (scratch only) of design r6 section 3: the inbox of RW, plain JS on the built record
// functions of the worktree. The reservation, the restore, the archive and the prune each run in ONE
// record-lock hold (B-1); the recovery of an archive intent runs before anything makes .inbox/<id>.
// Simplification: the publish writes the launch fields and then applies the held prefix in two writes of one hold.
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as M from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js";

const RS = 0x1e, LF = 0x0a, CHUNK = 65536, MAX_REC = 4096;
export const WRITER = readFileSync("/tmp/aosd6/val/i6_writer.sh", "utf8").replace(/\nao_inbox_append "\$@"\n$/, "\n").replace(/ao_inbox_append/g, "update_ao_metadata");
const box = (d, id) => join(d, ".inbox", id);
const moved = (d, id, ts) => join(d, "archive", `${id}_${ts}.inbox`);
const identity = (r) => ({ ...M.launchIdentity(r), launchId: r.launchId ?? "", archiveIntent: r.archiveIntent ?? "" });
const syncDir = (p) => { const fd = openSync(p, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } };

/** Design r6 3.4, the recovery of an archive intent; the caller holds the record lock. */
function finish(d, id) {
  const r = M.readMetadataRaw(d, id);
  if (!r?.archiveIntent) return "nothing";
  const src = existsSync(box(d, id)), dst = existsSync(moved(d, id, r.archiveIntent));
  if (src && dst) return "inbox damaged";
  if (!src && !dst && r.launchId) return "inbox damaged"; // I1: a record that names a launch has its file
  if (src) {
    mkdirSync(join(d, "archive"), { recursive: true });
    renameSync(box(d, id), moved(d, id, r.archiveIntent));
    syncDir(join(d, "archive")); syncDir(join(d, ".inbox"));
  }
  M.deleteMetadata(d, id, true, { archiveIntent: r.archiveIntent });
  return "finished";
}
export const recoverArchive = (d, id) => M.withRecordLock(d, id, () => finish(d, id));

export function beginLaunch(d, id, o = {}) {
  return M.withRecordLock(d, id, () => {
    if (finish(d, id) === "inbox damaged") throw new Error("inbox damaged");
    const r = M.readMetadataRaw(d, id);
    if (o.spawn ? r !== null : r === null) throw new Error(o.spawn ? "the ID is taken" : "no record to restore");
    const L = randomBytes(16).toString("hex");
    mkdirSync(box(d, id), { recursive: true, mode: 0o700 });
    const f = join(box(d, id), `${L}.ndjson`);
    const fd = openSync(f, "wx", 0o600); try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDir(box(d, id));
    try {
      o.onCandidate?.();
      const fields = { launchId: L, launchState: "preparing", inboxCursor: "" };
      const ok = o.spawn ? M.reserveSessionRecord(d, id, fields) : M.updateMetadataIf(d, id, o.expected ?? identity(r), fields);
      if (!ok) throw new Error("the launch changed");
      return L;
    } catch (e) { unlinkSync(f); throw e; }
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
export function publishLaunch(d, id, L, fields) {
  M.withRecordLock(d, id, () => {
    const r = M.readMetadataRaw(d, id) ?? {};
    if (r.launchId !== L || r.launchState !== "preparing" || r.archiveIntent) throw new Error("the launch changed");
    M.updateMetadata(d, id, { ...fields, launchState: "published" });
    applyInbox(d, id);
  });
}
export function catchUpInbox(d, id) {
  const r = M.readMetadataRaw(d, id) ?? {}; const sel = select(r);
  if (!sel) return { complete: true };
  const fd = openSync(join(box(d, id), sel.file), "r"); const target = fstatSync(fd).size; closeSync(fd);
  const t0 = performance.now();
  for (;;) {
    const res = applyInbox(d, id);
    if (!res.more || (res.off ?? 0) >= target) return { complete: true };
    if (performance.now() - t0 > 10_000) return { complete: false };
  }
}
export function archiveLaunch(d, id, L) {
  if (!catchUpInbox(d, id).complete) throw new Error("backlog");
  M.withRecordLock(d, id, () => {
    const r = M.readMetadataRaw(d, id);
    if (!r || r.launchId !== L || r.archiveIntent) throw new Error("the launch changed");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    if (!M.updateMetadataIf(d, id, identity(r), { archiveIntent: ts })) throw new Error("the launch changed");
    if (finish(d, id) !== "finished") throw new Error("inbox damaged");
  });
}
export function pruneInbox(d, id) {
  return M.withRecordLock(d, id, () => {
    if (finish(d, id) === "inbox damaged" || !existsSync(box(d, id))) return [];
    const named = M.readMetadataRaw(d, id)?.launchId;
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
### /tmp/aosd6/val/core/inbox.ts

~~~ts
// Validation prototype (scratch only) of design r6 section 3: the in-process face of /tmp/aosd6/val/dist/inbox.js
// (the child process of the core r6 test imports that file directly).
export * from "/tmp/aosd6/val/dist/inbox.js";
~~~
### /tmp/aosd6/val/core/fleet-barrier.ts

~~~ts
// Validation prototype (scratch only) of design r6 section 2.3: checkFleetAndFence. Check 1, the fence by rename,
// check 2; it never waits and never signals. Rules in this prototype: P2 (the tmux servers that the caller names),
// P3 (a JS runtime that the caller does not allow), P4 (W1 and W2 of design r5 2.3; before the fence W1 counts
// every interpreter that names a managed file, because every managed file is still old). Rule P1 (the AO_*
// environment) is NOT in the prototype: it would read the environment of processes that are not mine; m4
// measured it on owned fixtures only.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

interface Options {
  install: Array<{ path: string; content: string; mode: number }>;
  sessionsDirs: string[];
  allow?: (p: { pid: number; rule: string }) => boolean;
  tmuxSockets?: string[];
  onCheck?: (check: number) => void;
}
type Blocking = { pid: number; rule: string };
const INTERPRETERS = new Set(["bash", "sh", "dash"]);
const JS = new Set(["node", "nodejs", "bun", "deno"]);
const inode = (p: string) => { const s = statSync(p); return `${s.dev}:${s.ino}`; };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

function check(o: Options, fenced: boolean): Blocking[] {
  const current = new Map(o.install.map((f) => [real(f.path), existsSync(f.path) ? inode(f.path) : ""]));
  const names = new Set(o.install.map((f) => basename(f.path)));
  const sess = new Set(o.sessionsDirs.map(real));
  const uid = process.getuid?.() ?? -1;
  const out: Blocking[] = [];
  const add = (pid: number, rule: string) => { if (!o.allow?.({ pid, rule })) out.push({ pid, rule }); };
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    try { if (statSync(`/proc/${d}`).uid !== uid) continue; } catch { continue; }
    let argv: string[];
    try { argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { continue; }
    if (argv.length === 0) continue;
    let exe = ""; try { exe = basename(readlinkSync(`/proc/${d}/exe`)); } catch { exe = basename(argv[0] ?? ""); }
    if (JS.has(exe)) add(Number(d), "P3");
    let cwd: string | null | undefined;
    const abs = (a: string) => { if (isAbsolute(a)) return a; if (cwd === undefined) { try { cwd = readlinkSync(`/proc/${d}/cwd`); } catch { cwd = null; } } return cwd ? resolve(cwd, a) : null; };
    const w2 = argv.slice(1).some((a) => { if (!a.includes("/")) return false; const x = abs(a); if (x === null) return true;
      return sess.has(real(dirname(x))) && /^[^./][^/]*?(\.tmp(\.\d+)?)?$/.test(basename(x)); });
    if (w2) { add(Number(d), "P4 W2"); continue; }
    if (!INTERPRETERS.has(exe)) continue;
    const named = argv.slice(1).map((a) => { const x = abs(a); return x === null ? null : real(x); })
      .find((x, i) => (x !== null && current.has(x)) || ((x === null || !existsSync(x)) && names.has(basename(argv[i + 1] ?? ""))));
    if (named === undefined) continue;
    if (!fenced) { add(Number(d), "P4 W1"); continue; }
    let fds: string[] | null;
    try { fds = readdirSync(`/proc/${d}/fd`).flatMap((fd) => { try { const s = statSync(`/proc/${d}/fd/${fd}`); return [`${s.dev}:${s.ino}`]; } catch { return []; } }); } catch (e) { fds = (e as NodeJS.ErrnoException).code === "ENOENT" ? [] : null; }
    const cur = named === null ? undefined : current.get(named);
    if (!(fds !== null && cur !== undefined && fds.includes(cur))) add(Number(d), "P4 W1");
  }
  for (const s of o.tmuxSockets ?? []) {
    const r = spawnSync("tmux", ["-S", s, "list-panes", "-a", "-F", "#{session_name} #{pane_pid}"], { encoding: "utf8", timeout: 5_000 });
    if (r.status !== 0 && !/no server running|error connecting/.test(r.stderr)) { out.push({ pid: 0, rule: `P2 ${s} no answer` }); continue; }
    for (const l of r.stdout.trim().split("\n").filter(Boolean)) if (/^[0-9a-f]{12}-/.test(l)) add(Number(l.split(" ")[1]), "P2");
  }
  return out;
}

export async function checkFleetAndFence(o: Options): Promise<{ admitted: boolean; blocking: Blocking[] }> {
  const first = check(o, false);
  o.onCheck?.(1);
  if (first.length) return { admitted: false, blocking: first };
  for (const f of o.install) { writeFileSync(`${f.path}.ao-new`, f.content, { mode: f.mode }); renameSync(`${f.path}.ao-new`, f.path); }
  const second = check(o, true);
  o.onCheck?.(2);
  return { admitted: second.length === 0, blocking: second };
}
~~~
### /tmp/aosd6/val/i6_writer.sh

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
### /tmp/aosd6/val/tmux/dist/core.js

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
const NOFENCE = existsSync("/tmp/aosd6/val/tmux/nofence");
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
### /tmp/aosd6/val/tmux/assoc-proto.ts

~~~ts
// Validation prototype (scratch only) of design r6 section 6: the in-process face of /tmp/aosd6/val/tmux/dist/core.js.
export * from "/tmp/aosd6/val/tmux/dist/core.js";
~~~
### /tmp/aosd6/scripts/vt.sh

~~~sh
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd6
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
~~~
### /tmp/aosd6/scripts/redcount.sh

~~~sh
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged"), and per design
# round when the tag is followed by one in parentheses ("[same-id R3] (RW)").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd6/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd6/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd6/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
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
### /tmp/aosd6/scripts/redcount_f907.sh

~~~sh
#!/usr/bin/env bash
# redcount_f907.sh: the f907c4c1 text of the core r5 defect file (the one file of this round that changed),
# copied to /tmp/aosd6/val/f907 with its relative imports made absolute (no production module exists there, so
# its loaders run the r4 models, as on f907c4c1), run in red mode, counted per round tag.
set -e
S=/tmp/aosd6; V=$S/val/f907; W=/home/taisung/.worktrees/agent-orchestrator/ao-52; C=$W/packages/core/src
mkdir -p $V/core/__tests__
[ -e $V/core/node_modules ] || ln -s $W/packages/core/node_modules $V/core/node_modules
git -C $W show f907c4c1:packages/core/src/__tests__/same-id-defects-r5.test.ts |
  sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" > $V/core/__tests__/same-id-defects-r5.test.ts
(cd $V/core && env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run --root $V/core \
  __tests__/same-id-defects-r5.test.ts --reporter=json --outputFile=$S/tmp/red-f907-r5core.json >/dev/null 2>&1) || true
python3 -I - $S/tmp/red-f907-r5core.json <<'PY'
import json, re, sys, collections
d = json.load(open(sys.argv[1])); c = collections.Counter()
for tr in d["testResults"]:
    for a in tr["assertionResults"]:
        m = re.search(r"\[same-id (R\d)\](?: \(([^)]+)\))?", " ".join(a.get("ancestorTitles", []) + [a["title"]]))
        c[(m.group(1) + (f" ({m.group(2)})" if m.group(2) else "")) if m else "untagged", a["status"]] += 1
print("f907c4c1 packages/core/src/__tests__/same-id-defects-r5.test.ts: " + ", ".join(f"{t} {c[(t,'failed')]} failed/{c[(t,'passed')]} passed" for t in sorted(set(t for t, _ in c))))
PY
~~~
### /tmp/aosd6/scripts/assemble6.py

~~~~python
# assemble6.py: write the design file from /tmp/aosd6/doc/design.md, with each @@FILE path@@ marker replaced by
# the file's text (terminal colour codes removed) and each @@SCRIPT path@@ marker by a heading and a fenced copy
# of the file (the fence grows until the text does not contain it). The marker check runs on the source, so a
# pasted file may contain "@@". A second run rebuilds the same file. Run: python3 -I /tmp/aosd6/scripts/assemble6.py
import os, re, sys

DESIGN = "/home/taisung/.worktrees/agent-orchestrator/ao-52/development/reviews/same_id_design_r6_opus.md"
SOURCE = "/tmp/aosd6/doc/design.md"
ESC = re.compile(r"\x1b\[[0-9;]*m")
MARKER = re.compile(r"@@(FILE|SCRIPT) ([^@\n]+)@@(\n?)")

def text(path):
    return ESC.sub("", open(path, encoding="utf-8", errors="replace").read()).rstrip("\n")

def paste(m):
    kind, path, nl = m.group(1), m.group(2), m.group(3)
    if kind == "FILE":
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
