# Same-ID design, revision r5: RW and R2b-2 after the re-check r4 (ao-52)

Base `13c58b2c`; tests in `13c58b2c..f907c4c1` (2 commits, test files only). Input: the re-check r4 by ao-51
(`main:development/reviews/same_id_design_review_r4_astra6.md`, "the review"). Owner decisions 5b and 6a
(2026-10-21): r5 covers only RW and R2b-2. Every section of design r4 that this file does not replace stays
as it is (R2b-1, R3a, R3b, RH, RO, R4, the measurements t4 to h5). "r4 4.5" means design r4 section 4.5.

Scratch root `/tmp/aosd5`; marker `/tmp/aosd5-marker` (`2026-10-21 21:01:22.882 -0400`). No `ao` command,
no `opencode`, no Herdr, no network, no real record, no real `~/.ao/bin` write (section 11.1).

## 0. Response table

| Finding | Decision | Section | Test (file, kind) |
| --- | --- | --- | --- |
| **B-1** (RW) an old orphaned writer | Accepted. The drain has no seed: the barrier fences every managed file by rename, then classifies EVERY process of the uid at EVERY scan by its own argv, exe and descriptors (W1 to W4); admission needs 3 consecutive clean scans; nothing is signalled. Proof for writer trees of depth 2 or less (measured: w1). | 2 | core r5 `(RW) B-1`: 3 defects (first-scan orphan, child born between two scans, old text with no source descriptor); core r4 `:177` now runs the frozen pre-RW writers and the real drain (7) |
| **M-1** (RW) eligibility and lifecycle edges | Accepted. Explicit eligibility (`inboxLegacy` from the barrier); file-first reservation (invariant I1) with a crash table; publication of a complete prefix; a visible failed state; a parser that never pins; catch-up bounded by the start size, else `backlog` refusal; `archiveIntent` crash protocol; obsolete launch files; the cost of the cap. | 3, 6 | core r5 `(RW) M-1`: 3 defects (pre-RW record after the barrier, 499-record catch-up, oversize fragment) and 2 controls (a new launch rejects later legacy lines; a record across the 64 KiB boundary); core r4 `:271` now asserts the launch ID (7) |
| review: RW calls "under its operation lock" before R3a | Answered: every RW flow uses only the record lock, a compare of the launch identity and `archiveIntent`. | 4 | the RW tests of 9 |
| **B-2** (R2b-2) concurrent abandon and resume | Accepted. The per-ID operation lock (the subset of R3a in 5.1) moves into R2b-2; every association transition and every stop, restore, retire and archive holds it across the tmux step and the record step; a new holder first waits for tmux clients of an earlier holder; an evidence mismatch keeps the intent with a `mismatch` note. | 5 | runtime-tmux r5 `(R2b-2) B-2`: 3 defects (abandon paused before its tmux call; resume paused before its tmux call; abandon that finds another token), 4 controls (the other pause points), the M-2 recovery control, 4 healthy legacy controls |
| review: barrier for RW | Answered: eligibility init, recovery of interrupted states, an inventory of every build and entry point, a standing hash check (OD-25). | 6 | the RW barrier tests of 9 |
| review: test notes | Answered: core r4 `:177` and `:271` changed; recovery half and healthy legacy calls added; the CLI call waits for ao-54 (13 item 2). | 7 | as left |
| review: R2b-1 after ao-54 | Re-inventory item added to R2b-1. | 9 | R2b-1 row |
| **B-3** (R3b) | not in r5 (owner 5b). The OD-22 (a) reuse refusal is an item of the later R3b revision. | 9, 10 | none |
| **M-2** (R3a) | not in r5 | none | none |
| **M-3** (R3b, RO) | not in r5 | none | none |
| **M-4** (RH) | not in r5 | none | none |

## 1. What r5 replaces in design r4

| Design r4 | In r5 |
| --- | --- |
| 4.3 (the drain) | replaced by 2 |
| 4.2 (launch states), 4.4 (writer, resync), 4.5 (applier), 4.6 (archive) | replaced by 3; the format, the hex encoding, the 4000-byte record ceiling, the 1024-byte value ceiling, the per-launch files, the cursor `(dev, ino)` check, the epoch rules and 4.7 (installation) stay |
| 3.2 to 3.5 (association) | changed by 5 (the steps run under the operation lock; the abandon keeps a mismatched intent; `--forget-intent`) |
| 5.1, 5.6 (R3a lock) | the subset of 5.1 here moves to R2b-2; the rest stays in R3a |
| 8.1 (barrier) | changed by 6 |
| 8.2 rows RW and R2b-2 | replaced by 8 |
| 10 rows RW, R2b-2; R2b-1, R3a and R3b rows | RW and R2b-2 replaced, the other three changed by one item each (9) |
| 11 | replaced by 10 |

## 2. RW: the writer drain without a seed (B-1)

### 2.1 What an old writer runs (w1, 11.2)

`strace -f` over the frozen writers of `13c58b2c` (`WRAPPER_VERSION` 0.2.6):

| Writer | Interpreter process (the root) | Record write | Depth of the tree below the root |
| --- | --- | --- | --- |
| `gh pr create` | `bash <bin>/gh pr create --fill`, fd 255 on the wrapper file (`FD_CLOEXEC`) | `cp <rec> <rec>.tmp.<pid>`, then `mv <rec>.tmp.<pid> <rec>` (`renameat`), each a child of the root | 2 (`$(...)` subshells, then `dirname`, `tr`, `sed`) |
| `git checkout -b` | `bash <bin>/git checkout -q -b feat/w1` | `sed ... <rec>` into `<rec>.tmp.<pid>`, then `mv` | 2 |
| Claude hook | `/bin/sh -c .claude/metadata-updater.sh`, then `bash .claude/metadata-updater.sh` | `sed ... <rec> > <rec>.tmp`, then `mv <rec>.tmp <rec>` | 2 below the hook bash |

Every process that writes the record or its temporary file names the record path in its argv (`cp`, `sed`,
`mv`); the forks without `execve` have the root's argv. `AO_SESSION` is in every `execve` environment.
History (11.6): every helper version since `e4100790` and every hook version since `8e5b23e6` writes by
temporary file and `mv`; no version writes the record in place (`sed -i`, `>>` or `>` on the record).

### 2.2 The fence

The barrier installs EVERY managed file by temporary file plus rename, also a file whose text did not
change: `~/.ao/bin/ao-metadata-helper.sh`, `~/.ao/bin/git`, `~/.ao/bin/gh`, and every
`.claude/metadata-updater.sh` under every worktree root of the state root (not only the active records),
then `fsync` of each directory. The fence time F is the end of the last `fsync`. After F, an `execve` of a
managed path runs the new text, and a `source` of the helper reads the new text. So an old text runs only
in a process that opened it before F, or in a process forked from such a process.

### 2.3 The rules

At each scan, the drain reads `/proc` and classifies every process of the uid except itself:

- **Skip:** an empty `cmdline` (a zombie or a kernel thread: it runs no code).
- **W1 (old text):** the exe (`/proc/<pid>/exe`, else `argv[0]`) is `bash`, `sh` or `dash`; an argv element
  names a managed file (the realpath of the element against `/proc/<pid>/cwd`; when it does not resolve,
  its basename is a managed basename); and the process holds NO descriptor on the CURRENT inode of that
  file. A process that runs the new text holds fd 255 on the new inode and is not busy (w2 case F).
- **W2 (record argv):** any exe; an argv element (index 1 and later; relative elements against the cwd)
  names a path whose directory is a sessions directory and whose basename is a record name or a temporary
  name (`<id>`, `<id>.tmp`, `<id>.tmp.<n>`; never a dot file such as `.inbox`).
- **W3 (record descriptor):** any exe; a descriptor link names such a path (also with ` (deleted)`). It is not
  needed for the measured writers (their redirect child names the record in argv after `execve`), and it
  only adds waits.
- **W4 (unknown):** a value that a rule needs (cwd, exe, the descriptor list) cannot be read while the argv
  can match: busy.

The drain keeps no state between scans: no seed, no group, no PID list. A busy process is shown with
its PID, start ticks, rule and argv.

### 2.4 The procedure (`ao barrier writers --wait`, `core/src/writer-drain.ts`)

1. The fence (2.2).
2. Scan every 25 ms. A scan that finds a busy process resets the count.
3. Admission needs 3 consecutive clean scans. After 10 minutes the command stops waiting, exits 1, and
   shows the busy processes; admission stays closed. The owner waits, or ends an agent by its exact PID
   after a start-ticks check (`ao barrier writers --wait` again).
4. The drain never sends a signal.
5. After the drain: list the temporary files `<id>.tmp*` in the sessions directories (an old writer that
   died left them). They are never applied; `ao barrier writers --clean-temps --confirm` removes them.

### 2.5 Why three clean scans are enough

Assumptions: (A1) a process that writes the record (or the temporary file of a write) is at depth 2 or
less below the root of an old run (w1, 2.1); (A2) every process of that chain is busy for its whole life
(the root and its forks by W1, `cp`, `sed` and `mv` by W2; a non-writer leaf such as `tr` can be not busy,
and it writes nothing); (A3) a Linux `/proc` readdir lists every process that lives through the whole pass
(the walk goes in increasing PID order); (A4) the root of an old run started before F (2.2).

Let `s1 < s2 < s3` be the start times of the three clean scans, `e3` the end of the last one. Let X write
after `e3`. X is busy and alive after `e3`, and scan 3 did not list it, so X started after `s3`. Its parent
was alive at that time (after `s3 > e2`) and is busy; scan 2 did not list it, so it started after `s2`.
In the same way the grandparent started after `s1`. With depth 2 or less, the root is X, the parent or the
grandparent, so the root started after `s1 > F`. This contradicts A4. For depth d, d + 1 clean scans are
enough; the drain uses 3 because A1 measured d = 2.

A1 and A3 are the base of the claim. A3 is a kernel property; the H case of w2 and the B-1 test "born
between two scans" exercise it on this host. The implementing round adds a repeat test (13 item 3).

### 2.6 The acceptance cases (w2, 11.3; core r5 B-1)

| Case | r4 drain (seed by old inodes) | r5 drain |
| --- | --- | --- |
| A: the wrapper runs at the drain start | waits, `runtimeHandle=new` | waits (W1 wrapper, W2 `mv`), `new` |
| G: the review's first-scan orphan | 3 scans, 94 ms, nothing found: `runtimeHandle=old` | waits for the W2 `mv`: `new` |
| H: a child born between two scans just before its parent dies | `old` | W1 then W2: `new` |
| K: old text with no descriptor on a managed file (`bash -c <text> <bin>/gh`) | `old` | W1 (argv names `gh`, no current inode): `new` |
| F: an unrelated process of an old group, and a new run after the fence | not run | no wait: 3 scans, 120 ms |

### 2.7 Limits

Outside the supported writers (as r4 4.8): a copy of a wrapper text that does not name a managed file and
does not name the record in argv (for example a user's own script that edits the record), and a writer in
another uid or mount namespace. A long-lived process that names a record path (a `tail -f` of a record)
keeps admission closed until it ends; the drain shows it and never signals it.

## 3. RW: the inbox (M-1)

### 3.1 Eligibility

The applier selects the file under the record lock:

| Record | Answer | File |
| --- | --- | --- |
| `archiveIntent` set | `archiving`: no apply; the caller runs the recovery of 3.6 | none |
| `launchId=L`, `launchState=published` | apply | `.inbox/<id>/L.ndjson`, records with launch field `L` |
| `launchId=L`, `launchState=preparing` | `held` | none |
| `launchId=L`, `launchState=failed` | `failed`: never applied; listed | none |
| `launchId=L`, another or no `launchState` | `invalid` (a strict-read error, R4) | none |
| no `launchId`, `inboxLegacy=<barrier ID>` | apply | `.inbox/<id>/legacy.ndjson`, records with launch field `-` |
| no `launchId`, no `inboxLegacy` | `not-eligible`; `ao status`: "inbox not initialized: run the barrier" | none |

The barrier writes `inboxLegacy` for every active record without `launchId` (6.1 step 7b). The write that
gives a record its first `launchId` (a reservation or a restore) removes `inboxLegacy` and the cursor in the
same write. So a record never takes a legacy line after its first new launch (i1 case 7; core r5 control).
`launchId` and `archiveIntent` join `LAUNCH_IDENTITY_KEYS` (`metadata.ts:331`); `launchState`,
`inboxLegacy` and `inboxCursor` do not.

### 3.2 Reservation, publication, failure

**Invariant I1:** no record names a launch whose inbox file does not exist. So the file comes first:

1. `mkdir -p .inbox/<id>` (mode 0700), create `L.ndjson` with `O_EXCL` (0600), `fsync` the file and the
   directory.
2. The record write: the reservation (`reserveSessionRecord`, `O_EXCL`) of a spawn, or the conditional
   write of a restore (3.5), with `launchId=L`, `launchState=preparing`, and no `inboxLegacy` or cursor.
3. The pane starts with `AO_LAUNCH_ID=L` (as r4 4.2).
4. **The publish** (one write under the record lock, condition `launchId=L`, `launchState=preparing` and
   no `archiveIntent`, else refuse "the launch changed"): read `L.ndjson` from offset 0 to `S0` = its size
   at the start of the publish (64 KiB reads, at most 1 MiB by the cap); write the launch fields, then the
   values of the complete prefix (3.3), then `launchState=published` and the cursor at the end of the
   prefix. A partial record at the end and every append after `S0` wait for the next applier call (i1
   case 8).
5. **The rollback** of a failed launch writes `launchState=failed` (condition `launchId=L`). Its file stays
   with the record or with its archive; `ao status` and `ao session show` list "held lines of failed launch
   L: n". No call applies them, also not a restore or a later launch of the ID.

| Crash after | State | Recovery |
| --- | --- | --- |
| step 1 | `L.ndjson` (empty) that no record names | an obsolete launch file (3.7); a spawn that fails step 2 with `EEXIST` removes its own empty file |
| step 2, before step 3 | `preparing`, no pane | nothing applies its lines; a kill or cleanup archives the record as today, and the file goes with it (listed); the barrier (6.1 step 7c) writes `failed`, because no spawn runs while admission is closed |
| step 3, before step 4 | `preparing`, a pane that may write `L` lines | the same; R2a keeps the runtime of a failed launch ("kept runtime ... of a failed launch") |
| step 4 | one record write: either `preparing` or `published` | none |

Only the process that made `L` publishes `L`. No other process publishes a launch that it did not start. The
reservation key is a random ID with no PID, so between barriers no command can tell a crashed spawn from a
live one; that is why only the barrier writes `failed` for a `preparing` record that it did not make.

### 3.3 The parser and the cursor

The cursor is `inboxCursor = {"launch","dev","ino","off"}` (r4 4.5 step 5 stays). One call reads
`min(64 KiB, size - off)` bytes at `off` and parses:

1. Bytes before an `RS` (0x1e): damage; skip to the next `RS` or the chunk end.
2. `RS ... LF` with no `RS` between: a record. Longer than 4096 bytes: skip. Else apply it when the fields are
   valid, the launch field is the selected launch and the key is `pr`, `status` or `branch` with today's
   value checks; else skip and log.
3. `RS ... RS` with no `LF` between: a fragment of a dead short write; skip to the second `RS`.
4. `RS` with no `LF` and no `RS` up to the chunk end: 4096 bytes or more remain: damage, skip to the chunk
   end. Less remain and the chunk ends at end of file: a pending tail (a write in progress), stop. Less
   remain before the end of file: the chunk end cut a record; stop, and the next call reads it whole from
   its `RS`.

So each call moves the cursor or stops at a pending tail at the end of the file: no state pins it. A tail
that never completes is ended by the next record of any writer (rule 3), or stays as a pending tail behind
which nothing waits. Measured (i1 cases 2 to 4): a record across 65536 is applied once by the second call;
an oversize fragment (`RS` and 70000 bytes) is skipped and the cursor moves 65536, 70057; the r4 rule
stopped at offset 28 five times.

### 3.4 The writer (`AO_METADATA_HELPER`, r5)

The r4 4.4 writer, with these outcomes (i1 case 5, `i1_writer.sh`):

- `[ -f <file> ]`, the size check (1 MiB), then one `printf '%s' "$rec" >> <file>`.
- The append fails (the directory is gone: an archive moved it after the check): one orphan record in
  `.inbox/orphans.ndjson` (`RS "o1" SP <session> SP <launch or -> SP <key> SP <hex> SP <ms> LF`). That
  append fails too: a notice on stderr. The exit status is always 0.
- The append succeeds in a NEW directory of the ID (an archive, then a new launch L2, between the check and
  the append): bash opens with `O_CREAT`, so it creates `L1.ndjson` (or `legacy.ndjson`) beside
  `L2.ndjson`. That is an obsolete launch file (3.7): the applier opens only the file that the record names.
- The writer never creates a directory (`mkdir` only in 3.2 step 1 and in the barrier).

### 3.5 The catch-up before a decision

`catchUpInbox(id)`: `S0` = the size of the selected file at the start; call the applier until it answers no
"more" or its cursor reaches `S0`, inside a time budget (CLI 5 s; the lifecycle worker applies one chunk per
poll and catches up only before its own stop, restore or archive). The budget expires: the answer is
`backlog`, and the caller refuses its decision ("inbox backlog of n bytes: run again"); it never decides
from older values. Lines appended after `S0` are newer than the decision; the decision does not wait for
them, so a writer cannot starve it. Measured (i1 case 1): 499 records of 2066 bytes (1030934 bytes, under the
cap): the r4 rule (16 calls) ends at record 496 with "more"; the r5 catch-up needs 17 calls and ends at
record 499.

A restore uses it: catch up the old launch (published, or legacy when eligible), then 3.2 steps 1 and 2 with
the condition "launch identity as read after the catch-up". A line of the old launch after that is a late
line (3.7).

### 3.6 The archive protocol

1. `catchUpInbox` (complete, else refuse with `backlog`).
2. Conditional write `archiveIntent=<ts>` (condition: the launch identity as read in step 1).
3. Rename `.inbox/<id>` to `<archive dir>/<id>_<ts>.inbox`; `fsync` both directories.
4. The record archive (`deleteMetadata` with archive, `metadata.ts:666`: copy and unlink under the record
   lock) with the archive name `<id>_<ts>` (RW passes `<ts>` in; today the function makes its own).

**Recovery:** a call that reads a record with `archiveIntent=<ts>` (an applier answers `archiving`; every
mutating command, the barrier) finishes the archive. Step 3 is done when the target exists and
`.inbox/<id>` does not; it is to do when only `.inbox/<id>` exists; both or neither: "inbox damaged", the
session stays `unknown` and nothing is removed. Step 4 is done when the record does not exist. Both checks
are idempotent; a second archiver whose step 2 fails reads again and runs the recovery. The archived record
keeps the cursor; the bytes after it in the archived file are late lines (i1 case 6: the applier answers
`archiving`; recovery finds the moved inbox; cursor off 78; 34 late bytes, listed).

Both or neither in step 3 cannot happen without damage: only 3.2 step 1 makes `.inbox/<id>`, and it needs a
free ID, which the record of step 4 still holds.

### 3.7 Obsolete launch files, late lines, orphans

| Item | Where | Applied | Shown by |
| --- | --- | --- | --- |
| obsolete launch file: a file `X.ndjson` that the record does not name, in `.inbox/<id>/` (a crash after 3.2 step 1, an `O_CREAT` writer of 3.4, a `legacy.ndjson` after the first new launch) | its directory | never | `ao status` count; `ao session show` |
| late lines: bytes after the archived cursor | the archived inbox | never | `ao session show` of the archive, `ao status --archived` |
| orphans | `.inbox/orphans.ndjson` | never | `ao status` count and the last records |
| held lines of a failed launch | the file of that launch | never | `ao status`, `ao session show` |

`ao session inbox --prune --confirm` removes an obsolete launch file that is empty, and prints and truncates
the orphan file (r4 4.6); nothing else removes inbox data.

### 3.8 The cost of the cap and of a backlog

- The cap is per launch file: 1 MiB, consumed history included, no rotation. That is about 7000 records of 150
  bytes, or about 500 records of 2066 bytes. `ao status` warns from 512 KiB.
- The cap is soft: n writers that pass the size check at the same time overshoot by at most n x 4000 bytes.
- At the cap, the writer refuses every later `pr`, `status` and `branch` line of that launch (a notice on the
  agent's stderr), and `ao status` shows "inbox full: later metadata updates of this launch are lost; a
  restore starts a new file". This is a real loss of tracking for a long launch, not a delay.
- A backlog without an applier (no worker, no command) waits in the file up to the cap; nothing expires. A
  decision on a backlog that the budget cannot finish refuses (3.5).

### 3.9 The API that the tests use (core r5)

`core/src/writer-drain.ts`: `fenceAndDrainWriters({ install: [{ path, content, mode }], sessionsDirs, pollMs?,
timeoutMs?, onScan?(scan) })`, with `onScan` called synchronously after each scan (a test seam).
`core/src/inbox.ts`: `initLegacyInbox(dataDir, id, barrierId)`, `beginLaunch(dataDir, id): launchId`,
`publishLaunch(dataDir, id, launchId, fields)`, `applyInbox(dataDir, id): { more }`,
`catchUpInbox(dataDir, id): { complete }`; the writer is the exported `AO_METADATA_HELPER`. The core r5 file
loads these modules when they exist and runs a model of the r4 text otherwise; a round that chooses other
names changes the loader and says so.

## 4. RW before R3a (item 3)

RW lands before any operation lock. Its flows need none:

| Flow | What it uses | Why that is enough at RW |
| --- | --- | --- |
| applier, publish of the held prefix | record lock (synchronous), cursor in the record | two appliers serialize on the lock; each reads the cursor and the record under it |
| publish | record lock, condition `launchId=L`, `preparing` and no `archiveIntent` | only the maker of `L` publishes; a restore or an archive changes the identity first, and the publish refuses |
| reservation | 3.2: `O_EXCL` file, then `O_EXCL` record | I1; a crash leaves an empty obsolete file |
| restore | catch-up, `O_EXCL` file of `L'`, conditional write on the launch identity | a concurrent restore or archive fails the condition; its `L'` file is obsolete |
| archive | catch-up, conditional `archiveIntent`, idempotent steps 3 and 4 (3.6) | a second archiver or a restore fails its condition and runs the recovery |
| a decision of a mutating command | catch-up to `S0`, then today's conditional write | later lines are newer than the decision |
| the barrier | admission closed | no other command runs |

What RW does not give before R2b-2 and R3a: two mutating commands of one ID can still interleave their
effects outside the record (a runtime stop, a worktree removal). That is the state of R2a, and RW does not
make it worse. From R2b-2 the same flows run under the operation lock with no change to their record
protocol.

## 5. R2b-2: serialized association (B-2)

### 5.1 The lock subset that moves from R3a into R2b-2

| Part | Source | In R2b-2 |
| --- | --- | --- |
| kind `operation` in `delivery-lock.ts` (subject: realpath of the sessions directory and the ID, or `retained:<entry>`), a Linux abstract Unix socket that the kernel frees when the holder dies; the platform refusal (OD-15) | design r2 4.1, r3 5.1 | yes |
| `operation-lock.ts`: the token, the live-token `WeakSet`, no process-local reentrancy, the token release protocol (r3 5.1 change 2), the 30 s monotonic CLI waiter, the lifecycle try-once, no holder expiry, the diagnostics (holder PID, start ticks, command, since) | r3 5.1 | yes |
| the lock rules: at most one operation lock per operation (`AsyncLocalStorage`), forward the token, `withRecordLock` throws on a thenable | r4 5.6 rules 1 to 3 | yes, without the store lock |
| the stale-client wait (5.4 step 2) | new | yes |
| the other callers (worktree entry points, `children`, the spawn reservation recheck), `mutating-child.ts`, the journal, the owner marker | r3 5.1 to 5.5, r4 5.2 to 5.7 | stays in R3a |
| kind `opencode-session` | r4 6.2 | stays in R3b |

### 5.2 Lock order

R2b-2: operation(ID) then record(ID). From R3b: operation(ID), then `opencode-session`(S), then record(ID)
(r4 5.6, unchanged). The tmux call runs under the operation lock and outside the record lock; the record
lock stays the innermost and synchronous lock.

### 5.3 The callers in R2b-2

Under the operation lock of the ID, from the first record read to the last record write: `ao session
associate` (begin), `--resume`, `--abandon`, `--forget-intent`, `clear-token`, `associate-retained` and
`stop-retained` (subject `retained:<entry>`), `retire`, `kill` and `stop` (core `kill`), `restore`,
`cleanup` and every archive, and the lifecycle actions that stop, restore, archive or retire (try-once: a
busy lock skips the action for this poll, with a log line). Not under it in R2b-2: `send`, attach and the
lifecycle's messages to the agent (they use the guard of r4 2.2, which answers `kept` while a token is
set), `status`, the audit (read-only), and the applier (record lock).

### 5.4 The transitions (changes to r4 3.2 and 3.3)

Each transition:

1. Take the operation lock (CLI: wait up to 30 s, then refuse with the holder diagnostics).
2. **Stale-client wait:** before its first tmux call, wait until no process of the uid runs whose exe or
   `argv[0]` basename is `tmux` and whose argv names the target `=<name>` (as an element, or inside a command
   string, followed by `:`, a space or the end). The wait is bounded by the waiter deadline; then refuse "a
   tmux command of an earlier operation still runs". A holder that died released
   the lock, but a tmux client that it started can still send its command; after that client exits, its
   command has run. (Designed, not measured: 13 item 4.)
3. Read the record strictly; run r4 3.2 steps 2 to 6 (or the abandon, or the clear) unchanged.
4. Release the lock.

The r4 3.3 crash table stays. Its row "step 5 or 6: the launch identity changed (a restore or a kill read
the record first)" now happens only after a crash, because a restore or a kill waits for the lock.

### 5.5 The evidence mismatch state

The abandon (`--abandon --confirm`), under the lock, runs the exact clear (r4 3.3), then:

| tmux answer | Record |
| --- | --- |
| `ao-assoc-cleared` | remove the intent |
| `ao-assoc-refused` with the evidence values and an EMPTY token | remove the intent (nothing in tmux names `T`, and no other transition runs) |
| `ao-assoc-refused` with another token, another server PID, `$N` or `pane_pid`, or no session | keep the intent and add `mismatch` (the values that tmux answered; a token only as its fingerprint) |

An intent with `mismatch`: `--resume` refuses ("evidence mismatch"); the resolver kind stays `associating`
(r4 3.4: a stop with another token answers `unknown`, so the resources stay); `ao status` shows "association
mismatch: run `ao session audit`, then `ao session associate <id> --forget-intent --confirm`".
`--forget-intent --confirm` (the owner step, under the lock) removes the intent and changes nothing in tmux;
a token that stays on the session is then a foreign token for `clear-token` (r4 3.3). Measured (a1 case v):
the r4 abandon removed the intent; the r5 abandon keeps it with `mismatch`.

### 5.6 The API that the tests use (runtime-tmux r5)

Exported from `@aoagents/ao-core`: `beginAssociation(dataDir, id, runtime, evidence)`,
`resumeAssociation(dataDir, id, runtime, { pause? })`, `abandonAssociation(dataDir, id, runtime, { pause? })`,
`clearForeignToken(dataDir, id, runtime, { fingerprint, evidence, pause? })`, with record keys
`associationIntent` and `runtimeAssociation` (JSON with `token`). `pause(point)` is awaited at
`before-tmux`, `after-tmux`, `before-record` and `after-record`; it is a test seam, not reachable from the CLI.

## 6. The barrier for RW (item 5)

### 6.1 Changed steps of r4 8.1

| r4 step | r5 |
| --- | --- |
| 4 (drain the old `ao` trees, check the primary checkout) | the inventory of 6.2 |
| 5 (record the old writer inodes) | removed: the drain needs no seed |
| new 6a, before the fence | create `.inbox/orphans.ndjson`, and `.inbox/<id>/legacy.ndjson` (`O_EXCL`; `EEXIST` is fine) for every active record without `launchId`. So a legacy pane line after the fence waits in its file and does not become an orphan. |
| 7 (install, refresh hooks, drain) | the fence of 2.2 (all managed files, all hooks under all worktree roots), then the drain of 2.4, then the temporary-file list |
| new 7b | write `inboxLegacy=<barrier ID>` (conditional on the launch identity) for every active record without `launchId` |
| new 7c | recover every interrupted state: `archiveIntent`: finish the archive (3.6); `preparing`: write `failed` and list it; list obsolete launch files, late lines and orphans |
| 10 (exact checks) | add: every active record is `published`, legacy-eligible or `failed` (listed); no `archiveIntent`; no `preparing`; the drain is clean again; the inventory finds no old-build process; then the hashes again after the workers started |
| new 10b | start the standing check (6.3) |

The checks of step 10 are facts that the barrier reads; two healthy worker polls are not one of them.

### 6.2 The old-build inventory

`config.ts` parses with `.passthrough()`, so a new config key does not stop an old build: the inventory must
find the old processes. Entry points:

| | Entry point |
| --- | --- |
| E1 | the global `ao` command (the `packages/ao` shim and the build that it resolves) |
| E2 | `node <build>/packages/cli/dist/...` in any checkout or worktree (each worker worktree has its own build) |
| E3 | `pnpm ao`, `pnpm exec ao`, `npx ao` in any checkout |
| E4 | the resident lifecycle workers (their PID files) |
| E5 | a test or script process that imports core and can run the wrapper installer with the real `HOME` (vitest, node scripts) |

The scan: every process of the uid whose exe basename is `node` or `nodejs` and whose argv elements or cwd
resolve under a build root (a directory with `packages/core/package.json` of `@aoagents/ao-core`, or with
`node_modules/@aoagents/ao-core`), and every process whose argv names the `ao` shim. For each: the PID, start
ticks, build root and that build's `WRAPPER_VERSION`. The builds on disk under the known roots are listed too.
The barrier stops only E4, by exact PID with a start-ticks check (r4 8.1 step 3), waits for the others to end
(it never signals them), and shows them after the timeout.

### 6.3 The standing check after admission (OD-25)

An old build that starts after the barrier reinstalls its own wrappers (its version check is an equality).
So the new lifecycle worker hashes `~/.ao/bin/*` and the fenced hooks at every poll. A hash that differs:
the worker closes admission, shows "wrappers rewritten" with the inventory scan, and does not reinstall
while an old-build process runs. The owner stops that process and runs `ao barrier writers --wait` (fence
and drain again), then opens admission.

## 7. The test notes of the review (item 6)

| Note | Change |
| --- | --- |
| core r4 `:177` imports the current helper | Changed (commit `18804267`): the frozen pre-RW `GH_WRAPPER` and `AO_METADATA_HELPER` of `13c58b2c` (a control checks their SHA-256); the barrier is the production `fenceAndDrainWriters` when `writer-drain.ts` exists, else the `13c58b2c` install by rename; the old writer copies the record before the barrier returns; the test also asserts the PR. A helper that never writes, or a drain that ends or fences the old writer, fails it. Still red: `barrier: 13c58b2c barrier (install by rename, no drain): expected 'old' to be 'new'`. |
| core r4 `:271` passes for a fix that keeps the branch | Changed: also `launchId` (32 hex digits), `AO_LAUNCH_ID` in the pane environment equal to it, and `launchState=published`. Still red: `expected 'session/app-1' to be 'feat/agent-switched'`. The failed state, restore, framing, cursor and archive are not one test; they are the core r5 tests and the RW acceptance tests of 9. |
| tmux r4 `:302` is the safety half | Unchanged. The recovery half is a tmux r5 control: `clearForeignToken` with another fingerprint changes nothing; with the stranded token's fingerprint it clears exactly that token, and then plugin `destroy` with the legacy handle ends the session. A blanket refusal of legacy calls fails it. |
| healthy legacy calls through the plugin, core and CLI | tmux r5 controls: plugin `destroy` and `sendMessage` with a legacy handle; core `send` and `kill` of a legacy record through `createSessionManager` with the real tmux plugin and the host assertion. The CLI call is a test of R2b-1 after ao-54 lands (13 item 2). |

## 8. What RW and R2b-2 protect alone (item 7, replaces two rows of r4 8.2)

| Round | Protects alone | Does not protect |
| --- | --- | --- |
| RW | no shell writer of the new text writes a record; after the barrier no old-text writer that started before the fence writes (2.5, for writer trees of depth 2 or less whose record writers name the record); pane lines reach only their own launch; a pre-RW record gets its legacy lines and a new launch never does; the publish applies the complete held prefix; a failed launch's lines are never applied and stay listed; a decision catches up to its start size or refuses (`backlog`); an interrupted archive is finished from `archiveIntent` with its cursor and late lines; obsolete files, late lines and orphans are listed, never applied; the epoch fences every worker write; a rewrite of the wrappers by an old build closes admission (6.3) | the tmux identity (R2b-1); a writer outside the supported set (2.7); a long launch past the cap loses later metadata (3.8); no cross-process operation lock: effects outside the record can interleave as in R2a (4) |
| R2b-2 | as r4 (legacy records `unknown` unless associated or asserted; the asserted legacy stop with the createdAt window in tmux; association with intent, adopt and exact clear; retire, inventory, `stop-retained`, `where`, audit); and: every association transition, stop, restore, retire and archive of an ID holds the operation lock across its tmux and record steps; a new holder makes its first tmux call only after every tmux client of an earlier holder on that session ended; an evidence mismatch keeps the intent as an explicit state | the operation lock for the other entry points and the children of hooks (R3a); send and attach are guarded, not locked; R-1 and OD-23 |

The R3a row of r4 8.2 stays; its "one operation per ID across processes" then extends the R2b-2 lock to the
other entry points. The other rows stay.

## 9. Round plan (item 8)

| Round | Content | Files | Tests that must turn green | Risk | Size | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| **RW** | 2 (fence, drain, `ao barrier writers --wait`, temp list); 3 (eligibility, I1, publish, failed, parser, writer outcomes, catch-up, archive protocol, obsolete files, cap); 6 (barrier steps 6a, 7, 7b, 7c, 10, the inventory, the standing check); kept from r4: the epoch module and the worker write fence, the hook by rename, the monotonic wrapper version, `refresh-hooks --all` | `core/src/agent-workspace-hooks.ts`, `core/src/metadata.ts` (`launchId`, `archiveIntent` in `LAUNCH_IDENTITY_KEYS`; `deleteMetadata` takes the archive name), new `core/src/inbox.ts`, new `core/src/writer-drain.ts`, new `core/src/build-epoch.ts`, new `core/src/build-inventory.ts`, `core/src/session-manager.ts` (reservation, publish, rollback, restore, archive), `core/src/lifecycle-manager.ts` (applier, standing check), `agent-claude-code/src/index.ts`, CLI `session.ts`, new CLI `barrier.ts` | core r5 `(RW)`: 6 defects (controls stay); core r4 `(RW)`: 2 defects (controls stay); core r3 B-5 (its control changes, r4 13.6). Add: each row of the eligibility table; the crash table of 3.2 row by row; a held line of a failed launch is never applied, also after a restore; a pending tail; the cap refusal and the 512 KiB warning; the cursor `(dev, ino)` check; the archive crash after step 2 and after step 3, then recovery by an applier, a command and the barrier; both or neither directory refuses; the `O_CREAT` obsolete file and the orphan after an open failure; a restore catches up the old launch first; W1 to W4 each as a test, a zombie skip, no signal (a spy on `process.kill`); 200 repeats of the H case with random kill times; the inventory finds an E2 and an E5 process; the standing check closes admission after a hash change; the epoch fence for the applier and a status write | **high** | L | R2a (restore) |
| **R2b-1** | as r4 10, and: at implementation time, re-inventory every C-u, Escape, paste, Enter, retry and attach path of the landed `send` implementation (after ao-54 lands), so that all of them go through the identity resolver and the shared guard; add the CLI healthy legacy call | as r4 10 | as r4 10; tmux r5 healthy legacy controls stay green; add: a CLI `ao send` and `ao session kill` of a legacy record on a private tmux (healthy), and each re-inventoried path with a token launch, a tokenless session and an absent session | high | L | R2a, RW, ao-54 |
| **R2b-2** | r4 3 and 2.6, changed by 5: the lock subset of 5.1, the order of 5.2, the callers of 5.3, the stale-client wait, the mismatch state, `--forget-intent` | r4 10 R2b-2 files, and `core/src/delivery-lock.ts` (kind `operation`), new `core/src/operation-lock.ts`, `core/src/metadata.ts` (the thenable check), `core/src/session-manager.ts` (kill, restore, cleanup, archive under the lock), `core/src/lifecycle-manager.ts` (try-once) | tmux r5 `(R2b-2)`: 3 defects (controls stay); `c516cead` R2 runtime-tmux F-5; r4 10 R2b-2 list. Add: the pause tests of tmux r5 on the production API for every pair of the callers of 5.3 (not only resume and abandon); a tmux client of a dead holder that runs late (a held shim client), then a new holder waits; the lock rules throw (one lock per operation, forward the token, a thenable under the record lock); the CLI waiter refuses after 30 s with the diagnostics; the lifecycle skips a busy ID; a crash of the holder frees the lock | high | M | R2b-1 |
| **R3a** | as r4 10, without the parts that moved into R2b-2 (5.1) | as r4 10 | as r4 10 | high | L | R2a, R2b-2, R4 |
| **R3b** | as r4 10, and the OD-22 (a) item: from R3b on, `ao` refuses to reuse an existing OpenCode session until RO qualifies a bound transport and an actual-store hold check, and starts a fresh session instead (the design is part of the later R3b revision; B-3 and M-3 stay open) | as r4 10 | as r4 10 | medium | M | R3a, R4 |
| RH, RO | as r4 10 (M-4 and M-3 stay open) | | | | | |

Order: R2a, R4, RW, R2b-1, R2b-2, R3a, R3b; RH and RO when the owner wants them. R2b-1 also waits for ao-54.

## 10. Owner decisions (item 9)

| OD | Status | Value |
| --- | --- | --- |
| OD-2 to OD-21 | decided | as r4 11 |
| OD-22 OpenCode removal | **decided (a)** (6a) | no unbound OpenCode removal or interrupt; from R3b on, no reuse of an existing OpenCode session until RO qualifies a bound transport and an actual-store hold check; a fresh session instead |
| OD-23 R-1 for the legacy guard | **decided (a)** (6a) | accept that a same-uid process that sets the pane option `@ao_launch ""` defeats the legacy guard; inside the record and tmux integrity boundary; the docs say so (R2b-1) |
| OD-24 the Herdr socket rename | **decided (a)** (6a) | a moved Herdr socket leaves the session `unknown`; resources stay until the owner repairs the socket |
| **OD-25** (new) a wrapper rewrite after the barrier | open | (a) **recommended**: the standing check of 6.3 (the worker closes admission and shows the old-build process; the owner stops it and runs the drain again). (b) no standing check; the rule "no old build runs after the barrier" stays an operating rule, and a breach is found at the next barrier only. |

## 11. Measurements

### 11.1 Environment and isolation

Linux 6.8.0-147, bash 5.2.21, tmux 3.4, Node from `/tmp/aosd5/nodebin`. Every `node`, `pnpm`, test, helper
and wrapper call ran under `env -i` with `HOME=/tmp/aosd5/home` or `/tmp/aosd5/testhome` and no `AO_*`
variable (each node script refuses to start with one). tmux: private servers `-L aosd5-assoc` (a1), `-L aosd5-dbg`
(11.8), `-L aosd5-T` (the shim of the test runs), and `-S` sockets in test temporary directories; always
with `TMUX` removed. The scripts log every PID that they start to `/tmp/aosd5/logs/pids.txt` and stop them by
exact PID with a start-ticks check. The build: `pnpm build` under `env -i`, exit 0. Outputs follow in 11.2 to
11.8; the scripts are in 14.

### 11.2 w1: the trees of the frozen writers

`env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp node /tmp/aosd5/scripts/w1_writer_tree.mjs`
(output `/tmp/aosd5/logs/w1.out`):

~~~text
WRAPPER_VERSION 0.2.6
  sha256 GH_WRAPPER               adb33f1eb29d7ccbe02df980d8acc85549790cf528f1d3243f0649f671c2fcfd (2213 bytes)
  sha256 GIT_WRAPPER              fbee814d6515680c35a2840dd9c5129d04dd0e4320c6f16e131a243d23a44c3e (3471 bytes)
  sha256 AO_METADATA_HELPER       d5b9f23834a474d56b8a78c916f9f590248d490319bd0b6681cf84289fc4f2f9 (5466 bytes)
  sha256 METADATA_UPDATER_SCRIPT  4a06b4f05546cd53d762356ad54d473efdaa4803767d0fcb7588ff9c29eb9c8b (7825 bytes)

== gh-pr-create: exit 0; 36 processes; root pid 236896 (strace's child)
  depth 0 pid 236896 parent -: ["/tmp/aosd5/w1/bin/gh","pr","create","--fill"] then ["bash","/tmp/aosd5/w1/bin/gh","pr","create","--fill"]
      fcntl(255, F_GETFD) = -1
      fcntl(255, F_SETFD, FD_CLOEXEC) = 0
      fcntl(255, F_GETFL) = 0
  depth 1 pid 236897 parent 236896: (fork, no execve)
  depth 1 pid 236899 parent 236896: ["mktemp"]
  depth 1 pid 236900 parent 236896: ["/tmp/aosd5/w1/real/gh","pr","create","--fill"]
  depth 1 pid 236901 parent 236896: ["tee","/tmp/aosd5/tmp/tmp.QgpzrzJFqq"]
  depth 1 pid 236902 parent 236896: (fork, no execve)
  depth 1 pid 236905 parent 236896: (fork, no execve)
  depth 1 pid 236906 parent 236896: (fork, no execve)
  depth 1 pid 236908 parent 236896: (fork, no execve)
  depth 1 pid 236909 parent 236896: (fork, no execve)
  depth 1 pid 236912 parent 236896: (fork, no execve)
  depth 1 pid 236915 parent 236896: ["grep","-q","^pr=","/tmp/aosd5/w1/sessions/app-1"]
  depth 1 pid 236916 parent 236896: ["cp","/tmp/aosd5/w1/sessions/app-1","/tmp/aosd5/w1/sessions/app-1.tmp.236896"]
  depth 1 pid 236917 parent 236896: ["mv","/tmp/aosd5/w1/sessions/app-1.tmp.236896","/tmp/aosd5/w1/sessions/app-1"]
      RENAME renameat2("/tmp/aosd5/w1/sessions/app-1.tmp.236896", "/tmp/aosd5/w1/sessions/app-1", RENAME_NOREPLACE) = -1; AO_SESSION=app-1 in its execve env: true
      RENAME renameat("/tmp/aosd5/w1/sessions/app-1.tmp.236896", "/tmp/aosd5/w1/sessions/app-1") = 0; AO_SESSION=app-1 in its execve env: true
  depth 1 pid 236918 parent 236896: (fork, no execve)
  depth 1 pid 236919 parent 236896: (fork, no execve)
  depth 1 pid 236921 parent 236896: (fork, no execve)
  depth 1 pid 236922 parent 236896: (fork, no execve)
  depth 1 pid 236925 parent 236896: (fork, no execve)
  depth 1 pid 236928 parent 236896: ["grep","-q","^status=","/tmp/aosd5/w1/sessions/app-1"]
  depth 1 pid 236929 parent 236896: ["cp","/tmp/aosd5/w1/sessions/app-1","/tmp/aosd5/w1/sessions/app-1.tmp.236896"]
  depth 1 pid 236930 parent 236896: ["mv","/tmp/aosd5/w1/sessions/app-1.tmp.236896","/tmp/aosd5/w1/sessions/app-1"]
      RENAME renameat2("/tmp/aosd5/w1/sessions/app-1.tmp.236896", "/tmp/aosd5/w1/sessions/app-1", RENAME_NOREPLACE) = -1; AO_SESSION=app-1 in its execve env: true
      RENAME renameat("/tmp/aosd5/w1/sessions/app-1.tmp.236896", "/tmp/aosd5/w1/sessions/app-1") = 0; AO_SESSION=app-1 in its execve env: true
  depth 1 pid 236931 parent 236896: ["rm","-f","/tmp/aosd5/tmp/tmp.QgpzrzJFqq"]
  depth 2 pid 236898 parent 236897: ["dirname","/tmp/aosd5/w1/bin/gh"]
  depth 2 pid 236903 parent 236902: [""]
  depth 2 pid 236904 parent 236902: [""]
  depth 2 pid 236907 parent 236906: ["dirname","/tmp/aosd5/w1/sessions/app-1"]
  depth 2 pid 236910 parent 236909: (fork, no execve)
  depth 2 pid 236911 parent 236909: ["tr","-d","\\\\n"]
  depth 2 pid 236913 parent 236912: (fork, no execve)
  depth 2 pid 236914 parent 236912: ["sed","s/[&|\\\\\\\\]/\\\\\\\\&/g"]
  depth 2 pid 236920 parent 236919: ["dirname","/tmp/aosd5/w1/sessions/app-1"]
  depth 2 pid 236923 parent 236922: (fork, no execve)
  depth 2 pid 236924 parent 236922: ["tr","-d","\\\\n"]
  depth 2 pid 236926 parent 236925: (fork, no execve)
  depth 2 pid 236927 parent 236925: ["sed","s/[&|\\\\\\\\]/\\\\\\\\&/g"]
  record after: "worktree=/tmp/aosd5/w1/ws\nbranch=main\nruntimeHandle=old\npr=https://github.com/org/app/pull/7\nstatus=pr_open\n"

== git-checkout-b: exit 0; 21 processes; root pid 236935 (strace's child)
  depth 0 pid 236935 parent -: ["/tmp/aosd5/w1/bin/git","checkout","-q","-b","feat/w1"] then ["bash","/tmp/aosd5/w1/bin/git","checkout","-q","-b","feat/w1"]
      fcntl(255, F_GETFD) = -1
      fcntl(255, F_SETFD, FD_CLOEXEC) = 0
      fcntl(255, F_GETFL) = 0
  depth 1 pid 236936 parent 236935: ["/usr/bin/git","checkout","-q","-b","feat/w1"]
      RENAME rename("/tmp/aosd5/w1/ws/.git/index.lock", "/tmp/aosd5/w1/ws/.git/index") = 0; AO_SESSION=app-1 in its execve env: true
      RENAME rename("/tmp/aosd5/w1/ws/.git/refs/heads/feat/w1.lock", "/tmp/aosd5/w1/ws/.git/refs/heads/feat/w1") = 0; AO_SESSION=app-1 in its execve env: true
      RENAME rename("/tmp/aosd5/w1/ws/.git/HEAD.lock", "/tmp/aosd5/w1/ws/.git/HEAD") = 0; AO_SESSION=app-1 in its execve env: true
  depth 1 pid 236937 parent 236935: (fork, no execve)
  depth 1 pid 236939 parent 236935: (fork, no execve)
  depth 1 pid 236941 parent 236935: (fork, no execve)
  depth 1 pid 236943 parent 236935: (fork, no execve)
  depth 1 pid 236944 parent 236935: (fork, no execve)
  depth 1 pid 236946 parent 236935: (fork, no execve)
  depth 1 pid 236947 parent 236935: (fork, no execve)
  depth 1 pid 236950 parent 236935: (fork, no execve)
  depth 1 pid 236953 parent 236935: ["grep","-q","^branch=","/tmp/aosd5/w1/sessions/app-1"]
  depth 1 pid 236954 parent 236935: ["sed","s|^branch=.*|branch=feat/w1|","/tmp/aosd5/w1/sessions/app-1"]
  depth 1 pid 236955 parent 236935: ["mv","/tmp/aosd5/w1/sessions/app-1.tmp.236935","/tmp/aosd5/w1/sessions/app-1"]
      RENAME renameat2("/tmp/aosd5/w1/sessions/app-1.tmp.236935", "/tmp/aosd5/w1/sessions/app-1", RENAME_NOREPLACE) = -1; AO_SESSION=app-1 in its execve env: true
      RENAME renameat("/tmp/aosd5/w1/sessions/app-1.tmp.236935", "/tmp/aosd5/w1/sessions/app-1") = 0; AO_SESSION=app-1 in its execve env: true
  depth 2 pid 236938 parent 236937: ["/usr/bin/git","rev-parse","--show-toplevel"]
  depth 2 pid 236940 parent 236939: ["/usr/bin/git","symbolic-ref","-q","HEAD"]
  depth 2 pid 236942 parent 236941: ["dirname","/tmp/aosd5/w1/bin/git"]
  depth 2 pid 236945 parent 236944: ["dirname","/tmp/aosd5/w1/sessions/app-1"]
  depth 2 pid 236948 parent 236947: (fork, no execve)
  depth 2 pid 236949 parent 236947: ["tr","-d","\\\\n"]
  depth 2 pid 236951 parent 236950: (fork, no execve)
  depth 2 pid 236952 parent 236950: ["sed","s/[&|\\\\\\\\]/\\\\\\\\&/g"]
  record after: "worktree=/tmp/aosd5/w1/ws\nbranch=feat/w1\nruntimeHandle=old\n"

== claude-hook: exit 0; 21 processes; root pid 236960 (strace's child)
  depth 0 pid 236960 parent -: ["/bin/sh","-c",".claude/metadata-updater.sh"]
  depth 1 pid 236961 parent 236960: [""] then ["bash",".claude/metadata-updater.sh"]
      fcntl(255, F_GETFD) = -1
      fcntl(255, F_SETFD, FD_CLOEXEC) = 0
      fcntl(255, F_GETFL) = 0
  depth 2 pid 236962 parent 236961: ["cat"]
  depth 2 pid 236963 parent 236961: (fork, no execve)
  depth 2 pid 236966 parent 236961: (fork, no execve)
  depth 2 pid 236969 parent 236961: (fork, no execve)
  depth 2 pid 236972 parent 236961: (fork, no execve)
  depth 2 pid 236975 parent 236961: (fork, no execve)
  depth 2 pid 236978 parent 236961: ["grep","-q","^branch=","/tmp/aosd5/w1/sessions/app-1"]
  depth 2 pid 236979 parent 236961: ["sed","s|^branch=.*|branch=feat\\\\/w1-hook|","/tmp/aosd5/w1/sessions/app-1"]
  depth 2 pid 236980 parent 236961: ["mv","/tmp/aosd5/w1/sessions/app-1.tmp","/tmp/aosd5/w1/sessions/app-1"]
      RENAME renameat2("/tmp/aosd5/w1/sessions/app-1.tmp", "/tmp/aosd5/w1/sessions/app-1", RENAME_NOREPLACE) = -1; AO_SESSION=app-1 in its execve env: true
      RENAME renameat("/tmp/aosd5/w1/sessions/app-1.tmp", "/tmp/aosd5/w1/sessions/app-1") = 0; AO_SESSION=app-1 in its execve env: true
  depth 3 pid 236964 parent 236963: (fork, no execve)
  depth 3 pid 236965 parent 236963: ["jq","-r",".tool_name // empty"]
  depth 3 pid 236967 parent 236966: (fork, no execve)
  depth 3 pid 236968 parent 236966: ["jq","-r",".tool_input.command // empty"]
  depth 3 pid 236970 parent 236969: (fork, no execve)
  depth 3 pid 236971 parent 236969: ["jq","-r",".tool_response // empty"]
  depth 3 pid 236973 parent 236972: (fork, no execve)
  depth 3 pid 236974 parent 236972: ["jq","-r",".exit_code // 0"]
  depth 3 pid 236976 parent 236975: (fork, no execve)
  depth 3 pid 236977 parent 236975: ["sed","s/[&|\\\\/]/\\\\\\\\&/g"]
  record after: "worktree=/tmp/aosd5/w1/ws\nbranch=feat/w1-hook\nruntimeHandle=old\n"
~~~

### 11.3 w2: the r4 drain against the r5 drain

`env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp node /tmp/aosd5/scripts/w2_drain_rules.mjs`
(output `/tmp/aosd5/logs/w2.out`; the frozen writers, a real-gh stub, an `mv` shim that holds the rename;
after the drain a Node write sets `runtimeHandle=new generation=2`; the last line of each case is the record
after the old writer ended):

~~~text
== A. normal: the wrapper runs when the drain starts
  r4: drain 549 ms, 14 scans; waited for r4 ["/bin/bash","/tmp/aosd5/w2/bin/gh","pr","create"] | r4 ["/bin/sh","/tmp/aosd5/w2/bin/mv","/tmp/aosd5/w2/sessions/app-1.tmp.266053","/tmp/aosd5/w2/sessions/app-1"] | r4 null | r4 null | r4 null | r4 null | r4 null | r4 ["sleep","0.02"] | r4 ["sleep","0.02"] | r4 null
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
  r5: drain 586 ms, 13 scans; waited for W1 ["/bin/bash","/tmp/aosd5/w2/bin/gh","pr","create"] | W2 ["/bin/sh","/tmp/aosd5/w2/bin/mv","/tmp/aosd5/w2/sessions/app-1.tmp.266153","/tmp/aosd5/w2/sessions/app-1"]
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
== G. first-scan orphan (review r4)
  r4: drain 94 ms, 3 scans; waited for nothing
      record after the old writer: runtimeHandle=old generation=1 pr=https://github.com/org/app/pull/7
  r5: drain 558 ms, 13 scans; waited for W2 ["/bin/sh","/tmp/aosd5/w2/bin/mv","/tmp/aosd5/w2/sessions/app-1.tmp.266960","/tmp/aosd5/w2/sessions/app-1"]
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
== H. child born between two scans, then its parent dies
  r4: drain 214 ms, 4 scans; waited for r4 ["/bin/bash","/tmp/aosd5/w2/bin/gh","pr","create"] | r4 ["/bin/sh","/tmp/aosd5/w2/real/gh","pr","create"] | r4 ["tee","/tmp/aosd5/tmp/tmp.H247EF8jqr"]
      record after the old writer: runtimeHandle=old generation=1 pr=https://github.com/org/app/pull/7
  r5: drain 528 ms, 11 scans; waited for W1 ["/bin/bash","/tmp/aosd5/w2/bin/gh","pr","create"] | W2 ["/bin/sh","/tmp/aosd5/w2/bin/mv","/tmp/aosd5/w2/sessions/app-1.tmp.267643","/tmp/aosd5/w2/sessions/app-1"]
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
== K. old text with no descriptor on a managed file
  r4: drain 88 ms, 3 scans; waited for nothing
      record after the old writer: runtimeHandle=old generation=1 pr=https://github.com/org/app/pull/7
  r5: drain 570 ms, 13 scans; waited for W1 ["/bin/bash","-c","#!/usr/bin/env bash\n# ao gh wrapper — auto-updates session metadata on PR operations\n\ | W2 ["/bin/sh","/tmp/aosd5/w2/bin/mv","/tmp/aosd5/w2/sessions/app-1.tmp.268094","/tmp/aosd5/w2/sessions/app-1"]
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
== F. no false wait: unrelated pre-fence process, and a new run after the fence
  r5: drain 120 ms, 3 scans; waited for nothing
      record after the old writer: runtimeHandle=new generation=2 pr=https://github.com/org/app/pull/7
started PIDs: 66; still running: []
~~~

### 11.4 i1: the r4 applier against the r5 applier and writer

`env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp node /tmp/aosd5/scripts/i1_inbox_edges.mjs`
(output `/tmp/aosd5/logs/i1.out`):

~~~text
== 1. bounded catch-up: 499 records of about 2100 bytes
  r4: file 1030934 bytes (cap 1048576), record 2066 bytes                branch feat/v496-; consumed 1024736 of 1030934; 16 calls, more true
  r5: file 1030934 bytes (cap 1048576), record 2066 bytes                branch feat/v499-; consumed 1030934 of 1030934; calls 17, complete true
== 2. a record across the 64 KiB chunk boundary
  r5 call 1: the pr record starts at 65506, ends after 65536             off 65506, more true, pr (none)
  r5 call 2                                                              off 65638, more false, pr https://github.com/org/app/pull/9, branch feat/after-boundary
== 3. an oversize damaged fragment, then a valid record
  r4: offsets after 5 calls                                              28, 28, 28, 28, 28; branch feat/a
  r5: offsets after 5 calls                                              65536, 70057, 70057, 70057, 70057; branch feat/b
== 4. a fragment that the next record start ends
  r5                                                                     branch feat/c; skipped ["fragment 9 bytes"]
== 5. the r5 writer: check then append (O_CREAT)
  a: writer exit 0; files of .inbox/app-1                                L1.ndjson,L2.ndjson; orphans ""; archived L1 0 bytes
  b: writer exit 0; files of .inbox/app-1                                (no directory); orphans "\u001eo1 app-1 L1 branch 666561742f6c617465 1792632392387\n"; archived L1 0 bytes
== 6. the archive: crash after the inbox move, before the record move
  the applier during the crash state                                     {"state":"archiving"}
  recovery finds the moved inbox by archiveIntent; record moved          true; archived pr https://github.com/org/app/pull/3; cursor off 78; late bytes after the cursor 34 (listed, never applied); catch-up calls 1
== 7. a pre-RW record after the barrier, then a new launch
  r4: legacy line (writer exit 0) after the barrier                      branch feat/app-1; {"state":"(none)"}
  r4: after a new launch L2, a later legacy line                         branch feat/restored; files L2.ndjson,legacy.ndjson
  r5: legacy line (writer exit 0) after the barrier                      branch feat/legacy-pane; {"off":59}
  r5: after a new launch L2, a later legacy line                         branch feat/restored; files L2.ndjson,legacy.ndjson
== 8. publication consumes a complete prefix
  preparing: the applier                                                 {"state":"preparing","more":false}
  published: branch, pr, cursor                                          feat/two, https://github.com/org/app/pull/5, off 178 of 190, pending tail true
  the tail completes; the next call                                      branch feat/tail, off 212
~~~

### 11.5 a1: concurrent association transitions (tmux 3.4, `-L aosd5-assoc`)

`env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd5/scripts/a1_assoc_serial.mjs`
(output `/tmp/aosd5/logs/a1.out`):

~~~text
== protocol r4
  r4 (i) abandon paused before tmux; resume runs: resume done: tmux ao-assoc; record published | abandon: tmux ao-assoc-cleared; record compare failed | resume: tmux ao-assoc; record published
      -> record {"intent":"","mismatch":"","association":"T"}; tmux token ""; INCONSISTENT
  r4 (ii) resume paused before tmux; abandon runs: abandon done: tmux ao-assoc-refused; record intent removed | resume: tmux ao-assoc; record compare failed | abandon: tmux ao-assoc-refused; record intent removed
      -> record {"intent":"","mismatch":"","association":""}; tmux token T; INCONSISTENT
  r4 (iii) token set; abandon paused before record; resume runs: resume done: tmux ao-assoc; record published | abandon: tmux ao-assoc-cleared; record compare failed | resume: tmux ao-assoc; record published
      -> record {"intent":"","mismatch":"","association":"T"}; tmux token T; CONSISTENT
  r4 (iv) resume paused before record; abandon runs: abandon done: tmux ao-assoc-cleared; record intent removed | resume: tmux ao-assoc; record compare failed | abandon: tmux ao-assoc-cleared; record intent removed
      -> record {"intent":"","mismatch":"","association":""}; tmux token ""; CONSISTENT
  r4 (v) abandon while tmux has a token that no record names: abandon: tmux ao-assoc-refused; record intent removed
      -> record {"intent":"","mismatch":"","association":""}; tmux token other; token of the setup; intent kept: NO
== protocol r5
  r5 (i) abandon paused before tmux; resume runs: resume waits | abandon: tmux ao-assoc-refused; record intent removed; lock waited 3 ms | resume: no intent
      -> record {"intent":"","mismatch":"","association":""}; tmux token ""; CONSISTENT
  r5 (ii) resume paused before tmux; abandon runs: abandon waits | resume: tmux ao-assoc; record published; lock waited 0 ms | abandon: no intent; lock waited 310 ms
      -> record {"intent":"","mismatch":"","association":"T"}; tmux token T; CONSISTENT
  r5 (iii) token set; abandon paused before record; resume runs: resume waits | abandon: tmux ao-assoc-cleared; record intent removed; lock waited 0 ms | resume: no intent
      -> record {"intent":"","mismatch":"","association":""}; tmux token ""; CONSISTENT
  r5 (iv) resume paused before record; abandon runs: abandon waits | resume: tmux ao-assoc; record published; lock waited 0 ms | abandon: no intent; lock waited 305 ms
      -> record {"intent":"","mismatch":"","association":"T"}; tmux token T; CONSISTENT
  r5 (v) abandon while tmux has a token that no record names: abandon: tmux ao-assoc-refused; record kept with mismatch; lock waited 0 ms
      -> record {"intent":"T","mismatch":"yes","association":""}; tmux token other; token of the setup; intent kept: yes
started PIDs: 20; still running: []; own socket left: false
~~~

### 11.6 The history of the shell writers

~~~text
$ git log --format='%h %ad %s' --date=short -S'mv "\$temp_file" "\$metadata_file"' 13c58b2c -- packages
e4dedce2 2026-09-16 fix(agent-gemini): install the shared metadata helper instead of a private outdated copy
df8395c3 2026-04-01 feat: standardize agent plugins — shared hooks, activity JSONL, backfill aider/opencode (#755)
6a57358c 2026-02-28 feat: add workspace hooks to opencode plugin and create gemini agent plugin
e4100790 2026-02-23 feat(agent-codex): mature Codex plugin to match Claude Code support
$ git log --format='%h %ad %s' --date=short -S'mv "$temp_file" "$metadata_file"' 13c58b2c -- packages
8e5b23e6 2026-02-15 feat: auto-update session metadata via Claude Code hooks (#34)
$ git log --format='%h %s' -G'sed -i' 13c58b2c -- packages/core/src/agent-workspace-hooks.ts packages/plugins/agent-claude-code/src/index.ts
(no output)
$ git log --format='%h %ad %s' --date=short -G'>> *"?\\?\$metadata_file' 13c58b2c -- packages
(no output)
$ git log --format='%h %ad %s' --date=short -G'> *"?\\?\$metadata_file"' 13c58b2c -- packages
(no output)
~~~

The first form is the escaped text of the TypeScript template (the helper), the second the Claude hook.

### 11.7 The r5 tests against scratch prototypes of the r5 rules

`bash /tmp/aosd5/scripts/val.sh` (output `/tmp/aosd5/logs/val.out`). The prototypes (14) implement 2.3 W1
and W2, 3.1 to 3.5, and 5.1 to 5.5 without the stale-client wait. They are scratch code, not the
implementation; the run shows that the r5 rules turn the r5 defects and the changed r4 B-1 test green, with
every control still green. The copies change only import specifiers. The first run had a substitution that
missed a line that prettier had split (the copy then used the current helper, which writes the record); the
script now matches the formatted line, and the run below is the run after that change.

~~~text
== core r5 against writer-drain.ts and inbox.ts (prototypes)
✓ __tests__/same-id-defects-r5.test.ts (10 tests)
✓ the drain waits for an old mv whose wrapper died before the first scan 
✓ the drain waits for an old mv born between two scans just before its wrapper died 
✓ the drain waits for an old wrapper text that has no managed file open 
Tests  10 passed (10)
== core r4 (RW) B-1 against writer-drain.ts (prototype)
✓ __tests__/same-id-defects-r4.test.ts (7 tests | 4 skipped)
✓ a Node write after the barrier installed a new helper is kept against a wrapper that started before 
Tests  3 passed | 4 skipped (7)
== runtime-tmux r5 against assoc-proto.ts (prototype)
✓ __tests__/same-id-defects-r5.test.ts (12 tests)
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > an abandon paused before its tmux clear leaves the token that a resume published 
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > a resume paused before its tmux set leaves no token that no record names 
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > control: an abandon paused before its record write, the token set before, while the other operation runs, k
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > control: a resume paused before its record write, while the other operation runs, keeps tmux and the record
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > control: an abandon paused after its tmux call, while the other operation runs, keeps tmux and the record i
✓ [same-id R2] (R2b-2) B-2: concurrent resume and abandon of one association (real tmux) > control: a resume paused after its record write, while the other operation runs, keeps tmux and the record 
✓ [same-id R2] (R2b-1, R2b-2) healthy legacy calls reach a tokenless legacy session (real tmux) > control: plugin sendMessage with a legacy handle gives a session that has no token the text and Ente
✓ [same-id R2] (R2b-1, R2b-2) healthy legacy calls reach a tokenless legacy session (real tmux) > control: core send to a legacy record gives its tokenless session the text 
Tests  12 passed (12)
~~~

### 11.8 A debug run for the association prototype

The first `assoc-proto.ts` had one closing brace too many in its clear form; tmux answered `syntax error`,
and the M-2 recovery control failed against the prototype (not against the tests' own r4 model). The debug
script checked the forms on a private server; the fixed prototype is the one in 14.

`env -i HOME=/tmp/aosd5/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp sh /tmp/aosd5/scripts/dbg_clear.sh`:

~~~text
form: if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p ao-assoc-cleared } { display-message -p no }
ao-assoc-cleared
  exit 0 token []
form: if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p "ao-assoc-cleared" } { display-message -p no }
ao-assoc-cleared
  exit 0 token []
form: if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p -t =s1: "ao-assoc-cleared:#{pid}" } { display-message -p no }
ao-assoc-cleared:819934
  exit 0 token []
form: if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -t =s1: @ao_launch abc ; display-message -p ao-assoc } { display-message -p no }
ao-assoc
  exit 0 token [abc]
server gone
socket left: no
~~~

## 12. Tests of this round

### 12.1 `packages/core/src/__tests__/same-id-defects-r5.test.ts` (new, commit `f907c4c1`)

The frozen pre-RW writers (gzip and base64, checked by SHA-256); B-1 tests run them under bash with a real-gh
stub and a held `mv` shim, each wrapper in its own process group, and stop only their own processes by exact
PID with a start-ticks check. Loaders: `../writer-drain.ts` and `../inbox.ts` when they exist (3.9), else
models of r4 4.3 and r4 4.4 to 4.5. Red results on `13c58b2c` source (only test files differ at `f907c4c1`):

| Test | Kind | Red result |
| --- | --- | --- |
| control: the fixture is the GH_WRAPPER and AO_METADATA_HELPER text of 13c58b2c | control | passes |
| control: while the build ships wrapper version 0.2.6, the fixture equals the exports | control (skipped after a version change) | passes |
| the drain waits for an old mv whose wrapper died before the first scan | defect | `drain: design r4 model (no writer-drain.ts): expected 'old' to be 'new'` |
| the drain waits for an old mv born between two scans just before its wrapper died | defect | the same |
| the drain waits for an old wrapper text that has no managed file open | defect | the same |
| a pre-RW record takes the line of its legacy pane after the barrier | defect | `inbox: design r4 model (no inbox.ts): expected 'feat/app-1' to be 'feat/legacy-pane'` |
| control: a new launch of the record never takes a later line of the legacy pane | control | passes |
| the catch-up before a decision applies the last of 499 records of 2066 bytes, below the cap | defect | `inbox: design r4 model (no inbox.ts): expected 'feat/v496-' to be 'feat/v499-'` |
| control: a record across the 64 KiB read boundary is applied once, by the next read | control | passes |
| a damaged fragment longer than one read does not pin the cursor | defect | `inbox: design r4 model (no inbox.ts): expected 'feat/before' to be 'feat/after'` |

### 12.2 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r5.test.ts` (new, real tmux)

A private server at `-S <tmpdir>/s` through a shim first on `PATH` (checked in `beforeAll`), ended through
its own socket and by PID. Loader: the core exports of 5.6 when they exist, else a model of r4 3.2 and 3.3
(the real tmux forms; the record steps compare the launch identity, synchronously).

| Test | Kind | Red result |
| --- | --- | --- |
| an abandon paused before its tmux clear leaves the token that a resume published | defect | `design r4 model (core has no R2b-2 exports): intent 21afa9, {"intent":"","association":"21afa93065bfd8096fd44814ec601fc3","tmux":""}: expected '' to be '21afa93065bfd8096fd44814ec601fc3'` |
| a resume paused before its tmux set leaves no token that no record names | defect | `design r4 model (core has no R2b-2 exports): {"intent":"","association":"","tmux":"b386bbc37eab649958b0438f9f7da52c"}: expected 'b386bbc37eab649958b0438f9f7da52c' to be ''` |
| an abandon whose exact clear finds another token keeps the intent | defect | `design r4 model (core has no R2b-2 exports): {"intent":"","association":"","tmux":"bafdd84e5b6d1caffc60de5a913a8f4a"}: expected '' to be 'a13de9f264eb904d21480703ec9b7975'` |
| control: an abandon paused before its record write, the token set before, while the other operation runs, keeps tmux and the record in agreement | control | passes |
| control: a resume paused before its record write, ... | control | passes |
| control: an abandon paused after its tmux call, ... | control | passes |
| control: a resume paused after its record write, ... | control | passes |
| control: clear-token with another fingerprint changes nothing; with its fingerprint it clears exactly that token, and the session can then be stopped | control | passes |
| control: plugin destroy with a legacy handle ends a session that has no token | control | passes |
| control: plugin sendMessage with a legacy handle gives a session that has no token the text and Enter | control | passes |
| control: core send to a legacy record gives its tokenless session the text | control | passes |
| control: core kill of a legacy record (with the host assertion) ends its tokenless session | control | passes |

The tokens differ per run (random); the reasons are stable.

### 12.3 `packages/core/src/__tests__/same-id-defects-r4.test.ts` (changed, commit `18804267`)

As in 7: one new control (the fixture SHA-256), the B-1 test with the frozen writers, the barrier loader and
the PR oracle, the M-1 test with the launch-ID oracles. Red: `barrier: 13c58b2c barrier (install by rename,
no drain): expected 'old' to be 'new'`; `expected 'session/app-1' to be 'feat/agent-switched'`; the R3b test
unchanged (`requests: store A "session.interrupt ses_shared\n", store B "session.remove ses_shared\n": expected true to be false`).

### 12.4 Red counts (`SAME_ID_DEFECTS=red`, `/tmp/aosd5/scripts/redcount.sh`)

At `13c58b2c` (round r4, the same commit): the lines below except the two r5 files, and the core r4 line
`R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/2 passed`. At `f907c4c1`:

~~~text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects-r4.test.ts: R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/3 passed
packages/core/src/__tests__/same-id-defects-r5.test.ts: R3 (RW) 6 failed/4 passed
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
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
~~~

Changed against `13c58b2c`: core r4 `R3 (RW)` 2 failed/2 passed to 2 failed/3 passed (the new control); new:
core r5 `R3 (RW) 6 failed/4 passed`; runtime-tmux r5 `R2 (R2b-2) 3 failed/5 passed, R2 (R2b-1, R2b-2) 0
failed/4 passed`. Every other line is equal.

### 12.5 Normal mode

core r5 `4 passed | 6 expected fail (10)` (three runs); core r4 `4 passed | 3 expected fail (7)`;
runtime-tmux r5 `12 passed (12)` (vitest 3.2.4 counts a failing `it.fails` as passed, as in r4).

### 12.6 Full run

`env -i HOME=/tmp/aosd5/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp PATH=/tmp/aosd5/bintest:/tmp/aosd5/pnpmbin:/tmp/aosd5/nodebin:/usr/bin:/bin pnpm -r --no-bail test`
at `f907c4c1`, 21:43:31 to 21:44:58, exit 0. The `13c58b2c` column is the r4 final run of the same commit.

| Package | `13c58b2c` | `f907c4c1` |
| --- | --- | --- |
| core | 56 files; 1406 passed, 25 expected fail (1431) | 57 files; 1411 passed, 31 expected fail (1442) |
| runtime-tmux | 5 files; 100 passed | 6 files; 112 passed |
| runtime-herdr | 4 files; 49 passed | equal |
| agent-claude-code / codex / gemini / opencode | 214 / 220 / 67 / 322 passed | equal |
| workspace-worktree / scm-github / tracker-github / notifier-desktop | 72 / 140 (+5 skipped) / 42 / 26 passed | equal |
| integration-tests | 10 files passed, 3 skipped; 91 passed, 24 skipped (115) | equal |
| cli | 21 files; 269 passed | equal |

Before each commit: `pnpm typecheck` exit 0; `pnpm lint` exit 0 (5 warnings, all in files that this round
does not change); `prettier --check` clean; `sh .husky/pre-commit` with `/tmp/aosd5/gitleaksbin` under
`env -i`: "no leaks found".

## 13. Unclear items and deviations

1. "Each new test fails on `13c58b2c`": the new files do not exist at `13c58b2c`. `git diff --name-only
   13c58b2c f907c4c1` names only the three test files, so the red runs at `f907c4c1` run the `13c58b2c`
   source.
2. The CLI healthy legacy call (item 6): `ao send` of a legacy record runs `cli/src/commands/send.ts`, which
   ao-54 changes now, and the CLI tests use a stand-in `child_process`. A control written now pins the
   pre-ao-54 path. It is in the R2b-1 row (9), with the re-inventory. The plugin and core controls already
   fail a plugin that always refuses legacy calls.
3. 2.5 rests on A1 (measured: w1) and A3 (a kernel property, exercised by w2 H and one test, not by a
   stress run). RW adds the repeat test of 9.
4. The stale-client wait (5.4 step 2) answers a case that the review did not name: a holder that dies while
   its tmux client still runs. It is designed, not measured; the R2b-2 row (9) has its test.
5. The tests of B-2 pause the r4 model at its four points. The production API of 5.6 must give the same
   points; a round that names them otherwise changes the loader and says so.
6. The failed state, restore, framing, cursor and archive of M-1 are not all failing tests now: they need
   code that does not exist on `13c58b2c`, and the minimum list of the brief is covered. They are RW
   acceptance tests (9).
7. The design file is not committed (brief 2.1). The scratch prototypes of 11.7 and the debug run of 11.8 are
   outside the repository.
8. A system reminder asks for a `Co-Authored-By` trailer. The brief forbids it; the commits have none.
9. My own slips: the first `val.sh` substitution (11.7) and the first prototype clear form (11.8). Neither
   changed a committed file. The full run left the socket `/tmp/tmux-44402/aosd5-T` of my test shim with no
   server; I removed it (my own name, made at 21:44:16 by my run).

## 14. Scripts (in full)

All under `/tmp/aosd5/scripts/` unless named otherwise.

### /tmp/aosd5/scripts/w1_writer_tree.mjs

~~~js
// w1 (review r4 B-1, design r5 section 2.2): which processes does each frozen pre-RW record writer run,
// and which of them replaces the record? The shipped GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER and the
// Claude METADATA_UPDATER_SCRIPT of the build at 13c58b2c run under bash with scratch values only, each
// under `strace -f` (process calls, renames, the fcntl calls of the script descriptor). Run:
//   env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp \
//     node /tmp/aosd5/scripts/w1_writer_tree.mjs
// For each writer it prints every process of the run (depth below the interpreter process, the argv of each
// execve, a fork without execve), the rename onto the record and the process that made it, whether that
// process has AO_SESSION in its execve environment, and the script descriptor of each bash.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const WT = "/home/taisung/.worktrees/agent-orchestrator/ao-52";
const hooks = await import(`${WT}/packages/core/dist/agent-workspace-hooks.js`);
const { METADATA_UPDATER_SCRIPT } = await import(`${WT}/packages/plugins/agent-claude-code/dist/index.js`);
const { GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER, WRAPPER_VERSION } = hooks;
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
console.log(`WRAPPER_VERSION ${WRAPPER_VERSION}`);
for (const [n, t] of Object.entries({ GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER, METADATA_UPDATER_SCRIPT }))
  console.log(`  sha256 ${n.padEnd(24)} ${sha(t)} (${Buffer.byteLength(t)} bytes)`);

const root = "/tmp/aosd5/w1";
rmSync(root, { recursive: true, force: true });
for (const d of ["bin", "real", "sessions", "home", "ws/.claude", "logs"]) mkdirSync(`${root}/${d}`, { recursive: true });
const put = (p, t, m) => { writeFileSync(`${p}.new`, t, { mode: m }); renameSync(`${p}.new`, p); };
put(`${root}/bin/gh`, GH_WRAPPER, 0o755);
put(`${root}/bin/git`, GIT_WRAPPER, 0o755);
put(`${root}/bin/ao-metadata-helper.sh`, AO_METADATA_HELPER, 0o644);
put(`${root}/ws/.claude/metadata-updater.sh`, METADATA_UPDATER_SCRIPT, 0o755);
writeFileSync(`${root}/real/gh`, "#!/bin/sh\necho 'https://github.com/org/app/pull/7'\n", { mode: 0o755 });
const record = `${root}/sessions/app-1`;
const resetRecord = () => writeFileSync(record, `worktree=${root}/ws\nbranch=main\nruntimeHandle=old\n`);
const env = { HOME: `${root}/home`, PATH: `${root}/bin:/usr/bin:/bin`, LANG: "C", GH_PATH: `${root}/real/gh`,
  AO_STATE_ROOT: root, AO_DATA_DIR: `${root}/sessions`, AO_SESSION: "app-1", TMPDIR: "/tmp/aosd5/tmp",
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (...a) => spawnSync("/usr/bin/git", ["-C", `${root}/ws`, ...a], { env, encoding: "utf8" });
git("init", "-q", "-b", "main");
git("-c", "user.name=w1", "-c", "user.email=w1@example.invalid", "commit", "-q", "--allow-empty", "-m", "base");

function trace(name, argv, opts = {}) {
  resetRecord();
  const log = `${root}/logs/${name}.strace`;
  const r = spawnSync("/usr/bin/strace", ["-f", "-qq", "-v", "-s", "4096", "-o", log,
    "-e", "trace=process,rename,renameat,renameat2,fcntl", "-e", "signal=none", ...argv],
    { env, cwd: opts.cwd ?? root, input: opts.input, encoding: "utf8" });
  const lines = readFileSync(log, "utf8").split("\n").filter(Boolean);
  // pid -> { parent, argvs: [], renames: [], env: bool, fd255: [] }
  const procs = new Map();
  const get = (pid) => { if (!procs.has(pid)) procs.set(pid, { parent: null, execs: [], renames: [], aoEnv: null, fd255: [] }); return procs.get(pid); };
  let rootPid = null;
  for (const l of lines) {
    // A call that strace split ("<unfinished ...>" and "<... clone3 resumed>") counts at its resumed line.
    const m = l.match(/^(\d+)\s+(\w+)\((.*)\)\s+=\s+(-?\d+|\?)/) ?? l.match(/^(\d+)\s+<\.\.\. (\w+) resumed>(.*?)\)?\s+=\s+(-?\d+|\?)/);
    if (!m) continue;
    const [, pidS, call, args, ret] = m;
    const pid = Number(pidS);
    if (rootPid === null) rootPid = pid;
    const p = get(pid);
    if (/^(clone|clone3|fork|vfork)$/.test(call) && Number(ret) > 0) get(Number(ret)).parent = pid;
    if (call === "execve" && ret === "0") {
      const am = args.match(/^"[^"]*", \[(.*?)\], \[(.*)\]$/);
      const argvList = am ? [...am[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]) : [args];
      p.execs.push(argvList);
      if (am) p.aoEnv = /"AO_SESSION=app-1"/.test(am[2]);
    }
    if (/^rename/.test(call)) p.renames.push(`${call}(${args.replace(/AT_FDCWD, /g, "")}) = ${ret}`);
    if (call === "fcntl" && /255/.test(args + ret)) p.fd255.push(`fcntl(${args}) = ${ret}`);
  }
  const depth = (pid) => { let d = 0; for (let q = procs.get(pid)?.parent; q !== null && q !== undefined; q = procs.get(q)?.parent) d++; return d; };
  console.log(`\n== ${name}: exit ${r.status}; ${procs.size} processes; root pid ${rootPid} (strace's child)`);
  for (const [pid, p] of [...procs].sort((a, b) => depth(a[0]) - depth(b[0]) || a[0] - b[0])) {
    const ex = p.execs.length ? p.execs.map((a) => JSON.stringify(a)).join(" then ") : "(fork, no execve)";
    console.log(`  depth ${depth(pid)} pid ${pid} parent ${p.parent ?? "-"}: ${ex}`);
    for (const f of p.fd255) console.log(`      ${f}`);
    for (const rn of p.renames) console.log(`      RENAME ${rn}; AO_SESSION=app-1 in its execve env: ${p.aoEnv}`);
  }
  console.log(`  record after: ${JSON.stringify(readFileSync(record, "utf8"))}`);
}

trace("gh-pr-create", [`${root}/bin/gh`, "pr", "create", "--fill"]);
trace("git-checkout-b", [`${root}/bin/git`, "checkout", "-q", "-b", "feat/w1"], { cwd: `${root}/ws` });
git("checkout", "-q", "main");
const hookInput = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git checkout -b feat/w1-hook" }, tool_response: "", exit_code: 0 });
trace("claude-hook", ["/bin/sh", "-c", ".claude/metadata-updater.sh"], { cwd: `${root}/ws`, input: hookInput });
~~~
### /tmp/aosd5/scripts/w2_drain_rules.mjs

~~~js
// w2 (review r4 B-1, design r5 section 2.3): the drain of design r4 (old inodes seed a group) against the
// drain of design r5 (every process is classified at every scan by its own argv, exe and descriptors; no
// seed), on the frozen pre-RW writers of 13c58b2c (GH_WRAPPER, AO_METADATA_HELPER) under bash, with a
// real-gh stub and an `mv` shim that holds the rename. Run:
//   env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp \
//     node /tmp/aosd5/scripts/w2_drain_rules.mjs
//  A. normal: the wrapper runs (fd 255 on the old wrapper inode) when the drain starts.
//  G. the review's first-scan orphan: the wrapper is killed before the first scan; its mv waits.
//  H. a child born between two scans just before its parent dies (inside the scan callback, so no scan
//     runs between the birth of mv and the death of the wrapper).
//  K. an old wrapper text that runs with no descriptor on any managed file (bash -c, $0 = the wrapper).
//  F. no false wait (design r5 only): a process of an old wrapper's group that started before the fence
//     and still runs, and a NEW wrapper run after the fence that waits in real gh.
// In A, G and K the old writer copies the record (old content) before the fence and its mv waits; in H it
// copies inside the scan callback. Each wrapper starts in its own process group (detached), as a tool command.
// Each case runs once with each drain; after the drain returns, a Node write sets runtimeHandle=new, and
// the case prints the final record. The script stops each process that it started by its exact PID (with
// a start-ticks check) and logs every PID to /tmp/aosd5/logs/pids.txt.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync,
  rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const WT = "/home/taisung/.worktrees/agent-orchestrator/ao-52";
const { GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER } = await import(`${WT}/packages/core/dist/agent-workspace-hooks.js`);
const S = "/tmp/aosd5";
const root = `${S}/w2`;
const started = new Map();
const pidLog = (pid, what) => appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} w2 ${what} pid=${pid}\n`);
function track(pid, what) { if (pid && !started.has(pid)) { started.set(pid, stat(pid)?.start); pidLog(pid, what); } }
const sab = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => Atomics.wait(sab, 0, 0, ms);

function stat(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return { pid: Number(pid), state: f[0], ppid: Number(f[1]), pgid: Number(f[2]), start: Number(f[19]) };
  } catch { return null; }
}
const uid = process.getuid();
function ownPids() {
  return readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number).filter((p) => {
    try { return statSync(`/proc/${p}`).uid === uid; } catch { return false; }
  });
}
const cmdline = (p) => { try { return readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { return null; } };
const nowTicks = () => Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 100);
const fdInodes = (p) => {
  try {
    return readdirSync(`/proc/${p}/fd`).map((fd) => { try { const s = statSync(`/proc/${p}/fd/${fd}`); return `${s.dev}:${s.ino}`; } catch { return null; } }).filter(Boolean);
  } catch (e) { return e.code === "ENOENT" ? [] : null; }
};
const inode = (path) => { const s = statSync(path); return `${s.dev}:${s.ino}`; };

// ---- design r4 4.3: old inodes seed hits; descendants; group members inside the group's seen window ----
function makeR4(oldInodes) {
  const groups = new Map(); // pgid -> { first, lastSeen }
  return function scanR4() {
    const stats = ownPids().map(stat).filter(Boolean);
    const t = nowTicks();
    const hits = stats.filter((s) => s.pid !== process.pid && (fdInodes(s.pid) ?? []).some((i) => oldInodes.has(i)));
    const members = new Set(hits.map((h) => h.pid));
    for (let grew = true; grew; ) { grew = false; for (const s of stats) if (!members.has(s.pid) && members.has(s.ppid)) { members.add(s.pid); grew = true; } }
    for (const h of hits) { const g = groups.get(h.pgid) ?? { first: h.start, lastSeen: t }; g.first = Math.min(g.first, h.start); g.lastSeen = t; groups.set(h.pgid, g); }
    for (const s of stats) { const g = groups.get(s.pgid); if (g && s.start >= g.first && s.start <= g.lastSeen && s.state !== "Z") members.add(s.pid); }
    members.delete(process.pid);
    return [...members].map((p) => ({ pid: p, rule: "r4", argv: cmdline(p) }));
  };
}

// ---- design r5 2.3: W1 interpreter running a managed file without the current inode; W2 argv names a record ----
const INTERPRETERS = new Set(["bash", "sh", "dash"]);
function makeR5(managed, sessionsDirs) {
  const current = new Map(managed.map((m) => [realpathSync(m), inode(m)]));
  const managedNames = new Set(managed.map((m) => basename(m)));
  const sessReal = new Set(sessionsDirs.map((d) => realpathSync(d)));
  return function scanR5() {
    const busy = [];
    for (const p of ownPids()) {
      if (p === process.pid) continue;
      const argv = cmdline(p);
      if (argv === null || argv.length === 0) continue; // gone, or a zombie (it runs no code)
      let cwd = null;
      const abs = (a) => { if (isAbsolute(a)) return a; if (cwd === null) { try { cwd = readlinkSync(`/proc/${p}/cwd`); } catch { cwd = ""; } } return cwd ? resolve(cwd, a) : null; };
      const real = (a) => { const x = abs(a); if (x === null) return null; try { return realpathSync(x); } catch { return x; } };
      // W2: an argv element names a record or a record temp file in a sessions directory.
      const w2 = argv.slice(1).find((a) => { if (!a.includes("/")) return false; const x = real(a); if (x === null) return /\/sessions\//.test(a);
        return sessReal.has((() => { try { return realpathSync(dirname(x)); } catch { return dirname(x); } })()) && /^[^./][^/]*?(\.tmp(\.\d+)?)?$/.test(basename(x)); });
      if (w2) { busy.push({ pid: p, rule: "W2", argv }); continue; }
      // W1: an interpreter whose argv names a managed file, and no descriptor on that file's current inode.
      let exe = ""; try { exe = basename(readlinkSync(`/proc/${p}/exe`)); } catch { exe = basename(argv[0]); }
      if (!INTERPRETERS.has(exe)) continue;
      const named = argv.slice(1).map((a) => [a, real(a)]).find(([a, x]) => (x !== null && current.has(x)) || (x === null && managedNames.has(basename(a))) || (x !== null && !existsSync(x) && managedNames.has(basename(a))));
      if (!named) continue;
      const fds = fdInodes(p);
      const cur = named[1] !== null ? current.get(named[1]) : undefined;
      if (fds !== null && cur !== undefined && fds.includes(cur)) continue; // runs the new text
      busy.push({ pid: p, rule: fds === null ? "W1 (fds unreadable)" : "W1", argv });
    }
    return busy;
  };
}

async function drain(scan, { pollMs = 25, clean = 3, onScan } = {}) {
  let n = 0, inRow = 0;
  const seen = new Map();
  for (;;) {
    const busy = scan(); n++;
    for (const b of busy) if (!seen.has(b.pid)) seen.set(b.pid, `${b.rule} ${JSON.stringify(b.argv)}`);
    onScan?.(n, busy);
    inRow = busy.length === 0 ? inRow + 1 : 0;
    if (inRow >= clean) return { scans: n, waited: [...seen.values()] };
    if (n > 2000) return { scans: n, waited: [...seen.values()], timeout: true };
    await sleep(pollMs);
  }
}

// ---- the frozen writers in a scratch tree ----
const put = (p, t, m) => { writeFileSync(`${p}.new`, t, { mode: m }); renameSync(`${p}.new`, p); };
const record = `${root}/sessions/app-1`;
const env = { HOME: `${root}/home`, PATH: `${root}/bin:/usr/bin:/bin`, LANG: "C", GH_PATH: `${root}/real/gh`, AO_STATE_ROOT: root,
  AO_DATA_DIR: `${root}/sessions`, AO_SESSION: "app-1", TMPDIR: `${S}/tmp` };
function setup() {
  rmSync(root, { recursive: true, force: true });
  for (const d of ["bin", "real", "sessions", "home"]) mkdirSync(`${root}/${d}`, { recursive: true });
  put(`${root}/bin/gh`, GH_WRAPPER, 0o755); put(`${root}/bin/git`, GIT_WRAPPER, 0o755); put(`${root}/bin/ao-metadata-helper.sh`, AO_METADATA_HELPER, 0o644);
  writeFileSync(`${root}/real/gh`, `#!/bin/sh\n: > '${root}/gh-running'\nwhile [ ! -e '${root}/gh-release' ]; do sleep 0.02; done\necho 'https://github.com/org/app/pull/7'\n`, { mode: 0o755 });
  writeFileSync(`${root}/bin/mv`, `#!/bin/sh\n: > '${root}/mv-reached'\nwhile [ ! -e '${root}/mv-release' ]; do sleep 0.02; done\nexec /usr/bin/mv "$@"\n`, { mode: 0o755 });
  writeFileSync(record, `worktree=${root}/ws\nbranch=main\nruntimeHandle=old\ngeneration=1\n`);
}
const managedPaths = () => [`${root}/bin/gh`, `${root}/bin/git`, `${root}/bin/ao-metadata-helper.sh`];
function fence() { // the barrier installs every managed file by rename, also an unchanged one
  put(`${root}/bin/ao-metadata-helper.sh`, "update_ao_metadata() { :; }\n", 0o644);
  put(`${root}/bin/git`, GIT_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
  put(`${root}/bin/gh`, GH_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
}
function startWrapper(argv) {
  const c = spawn(argv[0], argv.slice(1), { env, stdio: "ignore", detached: true });
  track(c.pid, `wrapper ${argv.join(" ").slice(0, 60)}`);
  return { pid: c.pid, done: new Promise((r) => c.once("exit", (code, sig) => r(sig ?? code))) };
}
async function waitFile(f, ms = 5000) { for (let i = 0; i < ms / 10; i++) { if (existsSync(f)) return true; await sleep(10); } return false; }
function trackGroup(pgid, what) { for (const p of ownPids()) { const s = stat(p); if (s && s.pgid === pgid) track(p, what); } }
const finalRecord = () => readFileSync(record, "utf8").split("\n").filter((l) => /^(runtimeHandle|generation|pr)=/.test(l)).join(" ");

async function runCase(name, kind, which) {
  setup();
  const oldInodes = new Set(managedPaths().map(inode));
  let w;
  if (kind === "K") w = startWrapper(["/bin/bash", "-c", GH_WRAPPER, `${root}/bin/gh`, "pr", "create"]);
  else if (kind === "F") w = startWrapper(["/bin/sh", "-c", `/bin/sleep 5 & exec /bin/bash '${root}/bin/gh' pr create`]);
  else w = startWrapper(["/bin/bash", `${root}/bin/gh`, "pr", "create"]);
  if (!(await waitFile(`${root}/gh-running`))) throw new Error("real gh not reached");
  trackGroup(w.pid, `${name} group`);
  if (kind === "A" || kind === "G" || kind === "K") { // the old writer copies the old record; its mv waits
    writeFileSync(`${root}/gh-release`, ""); if (!(await waitFile(`${root}/mv-reached`))) throw new Error("mv not reached");
    trackGroup(w.pid, `${name} group`);
  }
  if (kind === "G") { process.kill(w.pid, "SIGKILL"); await w.done; } // the wrapper dies before any scan
  if (kind === "F") { // the old wrapper ends before the fence; its group keeps the sleep
    writeFileSync(`${root}/mv-release`, ""); writeFileSync(`${root}/gh-release`, ""); await w.done;
    for (const f of ["gh-running", "gh-release", "mv-release", "mv-reached"]) rmSync(`${root}/${f}`, { force: true });
  }
  fence();
  let newRun;
  if (kind === "F") { newRun = startWrapper(["/bin/bash", `${root}/bin/gh`, "pr", "create"]); await waitFile(`${root}/gh-running`); trackGroup(newRun.pid, "F new run"); }
  if (kind === "F" && which === "r4") { writeFileSync(`${root}/gh-release`, ""); await newRun.done; return; }
  const scan = which === "r4" ? makeR4(oldInodes) : makeR5(managedPaths(), [`${root}/sessions`]);
  let released = false;
  const onScan = (n) => {
    if (kind === "H" && n === 1 && !released) { // between scan 1 and scan 2: mv is born, then its parent dies
      released = true; writeFileSync(`${root}/gh-release`, "");
      for (let i = 0; i < 500 && !existsSync(`${root}/mv-reached`); i++) sleepSync(10);
      trackGroup(w.pid, `${name} group`); process.kill(w.pid, "SIGKILL");
      for (let i = 0; i < 500 && !["Z", undefined].includes(stat(w.pid)?.state); i++) sleepSync(5);
    }
  };
  // The old writer goes on 400 ms after the drain starts (G: its mv; A, K: real gh, then its mv; H: its mv).
  const t0 = Date.now();
  const go = (async () => {
    await sleep(400);
    if (kind === "F") { writeFileSync(`${root}/gh-release`, ""); }
    if (kind === "H" && !released) { released = true; writeFileSync(`${root}/gh-release`, ""); await waitFile(`${root}/mv-reached`); trackGroup(w.pid, `${name} group`); process.kill(w.pid, "SIGKILL"); }
    writeFileSync(`${root}/mv-release`, "");
  })();
  const res = await drain(scan, { onScan });
  const tDrain = Date.now() - t0;
  writeFileSync(`${record}.node`, readFileSync(record, "utf8").replace(/runtimeHandle=old/, "runtimeHandle=new").replace(/generation=\d+/, "generation=2"));
  renameSync(`${record}.node`, record); // the Node write after admission
  await go; await sleep(400);
  console.log(`  ${which}: drain ${tDrain} ms, ${res.scans} scans; waited for ${res.waited.length ? res.waited.map((x) => x.slice(0, 110)).join(" | ") : "nothing"}`);
  console.log(`      record after the old writer: ${finalRecord()}`);
  if (newRun) { await newRun.done; }
  await w.done.catch(() => {});
}

try {
  for (const [name, kind, text] of [["A", "A", "normal: the wrapper runs when the drain starts"], ["G", "G", "first-scan orphan (review r4)"],
    ["H", "H", "child born between two scans, then its parent dies"], ["K", "K", "old text with no descriptor on a managed file"],
    ["F", "F", "no false wait: unrelated pre-fence process, and a new run after the fence"]]) {
    console.log(`== ${name}. ${text}`);
    for (const which of ["r4", "r5"]) await runCase(name, kind, which);
  }
} finally {
  writeFileSync(`${root}/gh-release`, ""); writeFileSync(`${root}/mv-release`, "");
  await sleep(300);
  for (const [p, start] of started) if (start !== undefined && stat(p)?.start === start && stat(p)?.state !== "Z") try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(200);
  const left = [...started].filter(([p, start]) => start !== undefined && stat(p)?.start === start && stat(p)?.state !== "Z").map(([p]) => p);
  console.log(`started PIDs: ${started.size}; still running: ${JSON.stringify(left)}`);
}
~~~
### /tmp/aosd5/scripts/i1_inbox_edges.mjs

~~~js
// i1 (review r4 M-1, design r5 section 3): the inbox applier of design r4 (a model of its text) against the
// applier of design r5, plus the r5 bash writer, on scratch files only. Run:
//   env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp \
//     node /tmp/aosd5/scripts/i1_inbox_edges.mjs
//  1. bounded catch-up: 499 records of about 2100 bytes (below the 1 MiB cap): r4 (16 calls of 64 KiB)
//     against r5 (bounded by the file size at the start of the catch-up).
//  2. a record across a 64 KiB chunk boundary: applied once, in the next call.
//  3. an oversize damaged fragment (RS and 70000 bytes, no LF, no RS), then a valid record.
//  4. a fragment that the next record start ends (a short write of a dead writer): skipped.
//  5. the r5 bash writer: check then append. a. a writer passes [ -f ], the archive moves the directory, a
//     new same-ID launch creates a new directory, and the writer's O_CREAT creates its old file there (an
//     obsolete launch file); b. the same without a new directory: the append fails and the orphan file gets
//     the record. The pause between the check and the append is a test hook of this prototype only.
//  6. the archive: a crash after the inbox move and before the record move; recovery from archiveIntent.
//  7. a pre-RW record: eligibility by the barrier key inboxLegacy; r4 step 3 against r5; then a new launch
//     rejects a later legacy line.
//  8. publication: three held lines and a tail without LF; the publish consumes the complete prefix only.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync,
  writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const root = "/tmp/aosd5/i1";
rmSync(root, { recursive: true, force: true });
const RS = 0x1e, LF = 0x0a, CHUNK = 65536, MAX_REC = 4096;
const hex = (s) => Buffer.from(s, "utf8").toString("hex");
const rec = (launch, key, value, ms = 1) => `\x1e1 ${launch} ${key} ${hex(value)} ${ms}\n`;

// A record store: key=value lines, as metadata.ts (no lock here: one process).
const readRec = (p) => Object.fromEntries(readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const writeRec = (p, o) => { writeFileSync(`${p}.w`, Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${v}\n`).join("")); renameSync(`${p}.w`, p); };

function parseFields(line) { // "1 <launch> <key> <hex> <ms>"
  const f = line.split(" ");
  if (f.length !== 5 || f[0] !== "1" || !/^[0-9a-f]*$/.test(f[3]) || f[3].length % 2) return null;
  return { launch: f[1], key: f[2], value: Buffer.from(f[3], "hex").toString("utf8") };
}

// ---- design r4 4.4 and 4.5: split at RS; a last part without LF is "in progress"; at most 16 calls ----
function applyR4(dir, id, recPath) {
  const r = readRec(recPath);
  if (r.launchState !== "published") return { state: r.launchState ?? "(none)", more: false }; // r4 step 3
  const file = join(dir, r.launchId ? `${r.launchId}.ndjson` : "legacy.ndjson");
  const launch = r.launchId ?? "-";
  const fd = openSync(file, "r"); const size = fstatSync(fd).size;
  const off = r.inboxOff ? Number(r.inboxOff) : 0;
  const buf = Buffer.alloc(Math.min(CHUNK, size - off)); readSync(fd, buf, 0, buf.length, off); closeSync(fd);
  let pos = 0; const upd = {};
  while (pos < buf.length) {
    if (buf[pos] !== RS) { const j = buf.indexOf(RS, pos); pos = j < 0 ? buf.length : j; continue; }
    const next = buf.indexOf(RS, pos + 1); const lf = buf.indexOf(LF, pos);
    if (lf >= 0 && (next < 0 || lf < next)) { const f = parseFields(buf.subarray(pos + 1, lf).toString("latin1")); if (f && f.launch === launch) upd[f.key] = f.value; pos = lf + 1; continue; }
    if (next >= 0) { pos = next; continue; } // abandoned fragment
    break; // "a part without LF at the end ... can be a write in progress: stop before it"
  }
  writeRec(recPath, { ...r, ...upd, inboxOff: String(off + pos) });
  return { more: off + pos < size, off: off + pos, size };
}
const catchUpR4 = (dir, id, recPath) => { let res; for (let i = 0; i < 16; i++) { res = applyR4(dir, id, recPath); if (!res.more) break; } return res; };

// ---- design r5 3.5: eligibility, cursor, chunk parse that never pins, catch-up bounded by the start size ----
function selectR5(r) {
  if (r.archiveIntent) return { state: "archiving" };
  if (r.launchId) return r.launchState === "published" ? { file: `${r.launchId}.ndjson`, launch: r.launchId } : { state: r.launchState ?? "invalid" };
  if (r.inboxLegacy) return { file: "legacy.ndjson", launch: "-" };
  return { state: "not-eligible" };
}
function parseChunk(buf, launch, atEof) {
  let pos = 0; const upd = {}; const skipped = []; let pendingTail = false;
  while (pos < buf.length) {
    if (buf[pos] !== RS) { const j = buf.indexOf(RS, pos); const end = j < 0 ? buf.length : j; skipped.push(`damage ${end - pos} bytes`); pos = end; continue; }
    const next = buf.indexOf(RS, pos + 1); const lf = buf.indexOf(LF, pos);
    if (lf >= 0 && (next < 0 || lf < next)) {
      if (lf - pos + 1 > MAX_REC) skipped.push(`oversize record ${lf - pos + 1} bytes`);
      else { const f = parseFields(buf.subarray(pos + 1, lf).toString("latin1")); if (f && f.launch === launch && ["pr", "status", "branch"].includes(f.key)) upd[f.key] = f.value; else skipped.push("invalid record"); }
      pos = lf + 1; continue;
    }
    if (next >= 0) { skipped.push(`fragment ${next - pos} bytes`); pos = next; continue; }
    const rest = buf.length - pos;
    if (rest >= MAX_REC) { skipped.push(`damage ${rest} bytes (no LF within ${MAX_REC})`); pos = buf.length; continue; }
    if (atEof) pendingTail = true; // a write in progress, or a dead short write that the next record ends
    break; // a record that the chunk end cut: the next call reads it whole
  }
  return { pos, upd, skipped, pendingTail };
}
function applyR5(dir, id, recPath) {
  const r = readRec(recPath);
  const sel = selectR5(r);
  if (!sel.file) return { state: sel.state, more: false };
  const fd = openSync(join(dir, sel.file), "r"); const st = fstatSync(fd);
  const cur = r.inboxCursor ? JSON.parse(r.inboxCursor) : { launch: sel.launch, dev: st.dev, ino: st.ino, off: 0 };
  if (cur.launch !== sel.launch || cur.dev !== st.dev || cur.ino !== st.ino || cur.off > st.size) { closeSync(fd); return { state: "replaced", more: false }; }
  const n = Math.min(CHUNK, st.size - cur.off); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, cur.off); closeSync(fd);
  const p = parseChunk(buf, sel.launch, cur.off + n === st.size);
  const off = cur.off + p.pos;
  if (p.pos > 0) writeRec(recPath, { ...r, ...p.upd, inboxCursor: JSON.stringify({ ...cur, off }) });
  return { more: off < st.size && !p.pendingTail, off, size: st.size, skipped: p.skipped };
}
function catchUpR5(dir, id, recPath, budgetMs = 10_000) {
  const r = readRec(recPath); const sel = selectR5(r);
  if (!sel.file) return { state: sel.state, complete: true, calls: 0 };
  const target = fstatSync(openSync(join(dir, sel.file), "r")).size; // later appends do not extend the loop
  const t0 = performance.now(); let calls = 0; let res; const skipped = [];
  do { res = applyR5(dir, id, recPath); calls++; skipped.push(...(res.skipped ?? []));
    if (performance.now() - t0 > budgetMs) return { ...res, complete: false, state: "backlog", calls, skipped };
  } while (res.more && res.off < target);
  return { ...res, complete: true, calls, skipped };
}

const show = (l, v) => console.log(`  ${l.padEnd(70)} ${v}`);
function published(name, launch = "L1") {
  const dir = join(root, name, ".inbox", "app-1"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${launch}.ndjson`), "");
  const recPath = join(root, name, "app-1");
  writeRec(recPath, { branch: "main", launchId: launch, launchState: "published" });
  return { dir, recPath, file: join(dir, `${launch}.ndjson`) };
}

console.log("== 1. bounded catch-up: 499 records of about 2100 bytes");
for (const [which, catchUp] of [["r4", catchUpR4], ["r5", catchUpR5]]) {
  const { dir, recPath, file } = published(`c1-${which}`);
  const v = (i) => `feat/v${String(i).padStart(3, "0")}-${"a".repeat(1015)}`;
  for (let i = 1; i <= 499; i++) appendFileSync(file, rec("L1", "branch", v(i)));
  const size = fstatSync(openSync(file, "r")).size;
  const res = catchUp(dir, "app-1", recPath);
  const b = readRec(recPath).branch;
  show(`${which}: file ${size} bytes (cap 1048576), record ${Buffer.byteLength(rec("L1", "branch", v(1)))} bytes`, `branch ${b.slice(0, 10)}; consumed ${res.off} of ${size}; ${which === "r5" ? `calls ${res.calls}, complete ${res.complete}` : `16 calls, more ${res.more}`}`);
}

console.log("== 2. a record across the 64 KiB chunk boundary");
{
  const { dir, recPath, file } = published("c2");
  const pad = "b".repeat(1000);
  const size = () => fstatSync(openSync(file, "r")).size;
  let n = 0; while (size() < CHUNK - 3000) appendFileSync(file, rec("L1", "branch", `feat/p${n++}-${pad}`));
  // One padding record whose length puts the start of the pr record 30 bytes before the chunk end.
  const fixed = Buffer.byteLength(rec("L1", "branch", "feat/q-"));
  appendFileSync(file, rec("L1", "branch", `feat/q-${"c".repeat((CHUNK - 30 - size() - fixed) / 2)}`));
  const before = size();
  appendFileSync(file, rec("L1", "pr", "https://github.com/org/app/pull/9"));
  appendFileSync(file, rec("L1", "branch", "feat/after-boundary"));
  const r1 = applyR5(dir, "app-1", recPath);
  show(`r5 call 1: the pr record starts at ${before}, ends after ${CHUNK}`, `off ${r1.off}, more ${r1.more}, pr ${readRec(recPath).pr ?? "(none)"}`);
  const r2 = applyR5(dir, "app-1", recPath);
  show("r5 call 2", `off ${r2.off}, more ${r2.more}, pr ${readRec(recPath).pr}, branch ${readRec(recPath).branch}`);
}

console.log("== 3. an oversize damaged fragment, then a valid record");
for (const [which, apply] of [["r4", applyR4], ["r5", applyR5]]) {
  const { dir, recPath, file } = published(`c3-${which}`);
  appendFileSync(file, rec("L1", "branch", "feat/a"));
  appendFileSync(file, "\x1e" + "x".repeat(70000));
  appendFileSync(file, rec("L1", "branch", "feat/b"));
  const offs = []; for (let i = 0; i < 5; i++) offs.push(apply(dir, "app-1", recPath).off);
  show(`${which}: offsets after 5 calls`, `${offs.join(", ")}; branch ${readRec(recPath).branch}`);
}

console.log("== 4. a fragment that the next record start ends");
{
  const { dir, recPath, file } = published("c4");
  appendFileSync(file, rec("L1", "branch", "feat/a").slice(0, 9)); // a short write of a dead writer
  appendFileSync(file, rec("L1", "branch", "feat/c"));
  const r = applyR5(dir, "app-1", recPath);
  show("r5", `branch ${readRec(recPath).branch}; skipped ${JSON.stringify(r.skipped)}`);
}

// ---- the r5 writer (bash), as the new helper would have it; AO_TEST_PAUSE is a hook of this prototype ----
// The r5 writer is /tmp/aosd5/scripts/i1_writer.sh (pasted in the design).

function writer(sessions, launch, key, value, pause) {
  const env = { PATH: "/usr/bin:/bin", HOME: "/tmp/aosd5/home", AO_DATA_DIR: sessions, AO_SESSION: "app-1", ...(launch ? { AO_LAUNCH_ID: launch } : {}), ...(pause ? { AO_TEST_PAUSE: pause } : {}) };
  return spawnSync("/bin/bash", ["/tmp/aosd5/scripts/i1_writer.sh", key, value], { env, encoding: "utf8" });
}
const { spawn } = await import("node:child_process");
function writerAsync(sessions, launch, key, value, pause) {
  const env = { PATH: "/usr/bin:/bin", HOME: "/tmp/aosd5/home", AO_DATA_DIR: sessions, AO_SESSION: "app-1", AO_LAUNCH_ID: launch, AO_TEST_PAUSE: pause };
  const c = spawn("/bin/bash", ["/tmp/aosd5/scripts/i1_writer.sh", key, value], { env, stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; c.stderr.on("data", (d) => (err += d));
  return new Promise((r) => c.on("exit", (code) => r({ code, err })));
}
const waitFor = async (f) => { for (let i = 0; i < 500 && !existsSync(f); i++) await new Promise((r) => setTimeout(r, 10)); };

console.log("== 5. the r5 writer: check then append (O_CREAT)");
for (const variant of ["a", "b"]) {
  const sessions = join(root, `c5${variant}`); const archive = join(root, `c5${variant}-archive`);
  mkdirSync(join(sessions, ".inbox", "app-1"), { recursive: true }); mkdirSync(archive, { recursive: true });
  writeFileSync(join(sessions, ".inbox", "app-1", "L1.ndjson", ), ""); writeFileSync(join(sessions, ".inbox", "orphans.ndjson"), "");
  const pause = join(root, `c5${variant}-pause`);
  const w = writerAsync(sessions, "L1", "branch", "feat/late", pause);
  await waitFor(`${pause}.reached`);
  renameSync(join(sessions, ".inbox", "app-1"), join(archive, "app-1_1.inbox")); // the archive moves the directory
  if (variant === "a") { mkdirSync(join(sessions, ".inbox", "app-1")); writeFileSync(join(sessions, ".inbox", "app-1", "L2.ndjson"), ""); } // a new launch L2
  writeFileSync(pause, "");
  const res = await w;
  const list = existsSync(join(sessions, ".inbox", "app-1")) ? readdirSync(join(sessions, ".inbox", "app-1")).join(",") : "(no directory)";
  show(`${variant}: writer exit ${res.code}; files of .inbox/app-1`, `${list}; orphans ${JSON.stringify(readFileSync(join(sessions, ".inbox", "orphans.ndjson"), "latin1").slice(0, 60))}; archived L1 ${readFileSync(join(archive, "app-1_1.inbox", "L1.ndjson")).length} bytes`);
}

console.log("== 6. the archive: crash after the inbox move, before the record move");
{
  const sessions = join(root, "c6"); const archive = join(root, "c6-archive"); const recPath = join(sessions, "app-1");
  const { dir, file } = published("c6"); mkdirSync(archive, { recursive: true });
  appendFileSync(file, rec("L1", "pr", "https://github.com/org/app/pull/3"));
  const cu = catchUpR5(dir, "app-1", recPath);
  const r = readRec(recPath); writeRec(recPath, { ...r, archiveIntent: "1729550000000" }); // step 1
  renameSync(join(sessions, ".inbox", "app-1"), join(archive, "app-1_1729550000000.inbox")); // step 2, then the crash
  appendFileSync(join(archive, "app-1_1729550000000.inbox", "L1.ndjson"), rec("L1", "branch", "feat/late")); // a late line
  // A later call: any applier or operation that reads archiveIntent resumes the archive.
  const seen = readRec(recPath); const sel = selectR5(seen);
  const ts = seen.archiveIntent; const movedInbox = join(archive, `app-1_${ts}.inbox`);
  const ok = existsSync(movedInbox) && !existsSync(join(sessions, ".inbox", "app-1"));
  renameSync(recPath, join(archive, `app-1_${ts}`)); // step 3
  const arc = readRec(join(archive, `app-1_${ts}`)); const cur = JSON.parse(arc.inboxCursor);
  const late = readFileSync(join(movedInbox, "L1.ndjson")).length - cur.off;
  show("the applier during the crash state", JSON.stringify(sel));
  show("recovery finds the moved inbox by archiveIntent; record moved", `${ok}; archived pr ${arc.pr}; cursor off ${cur.off}; late bytes after the cursor ${late} (listed, never applied); catch-up calls ${cu.calls}`);
}

console.log("== 7. a pre-RW record after the barrier, then a new launch");
for (const [which, apply] of [["r4", applyR4], ["r5", applyR5]]) {
  const sessions = join(root, `c7-${which}`); const recPath = join(sessions, "app-1"); const dir = join(sessions, ".inbox", "app-1");
  mkdirSync(dir, { recursive: true });
  writeRec(recPath, { worktree: "/w", branch: "feat/app-1", status: "working", runtimeHandle: '{"id":"x"}', generation: "4" }); // as 13c58b2c writes it
  writeFileSync(join(dir, "legacy.ndjson"), ""); // barrier: the file first, then the eligibility key
  if (which === "r5") writeRec(recPath, { ...readRec(recPath), inboxLegacy: "barrier-1" });
  const w1 = writer(sessions, "", "branch", "feat/legacy-pane");
  const res = apply(dir, "app-1", recPath);
  show(`${which}: legacy line (writer exit ${w1.status}) after the barrier`, `branch ${readRec(recPath).branch}; ${JSON.stringify({ state: res.state, off: res.off })}`);
  // A restore makes launch L2: file first, then launchId with preparing; publish; then a straggler legacy line.
  writeFileSync(join(dir, "L2.ndjson"), "");
  const r = readRec(recPath); writeRec(recPath, { ...r, inboxLegacy: "", inboxCursor: "", inboxOff: "", launchId: "L2", launchState: "published", branch: "feat/restored" });
  writer(sessions, "", "branch", "feat/old-straggler");
  apply(dir, "app-1", recPath);
  show(`${which}: after a new launch L2, a later legacy line`, `branch ${readRec(recPath).branch}; files ${readdirSync(dir).join(",")}`);
}

console.log("== 8. publication consumes a complete prefix");
{
  const sessions = join(root, "c8"); const recPath = join(sessions, "app-1"); const dir = join(sessions, ".inbox", "app-1");
  mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "L1.ndjson"), "");
  writeRec(recPath, { branch: "session/app-1", launchId: "L1", launchState: "preparing" });
  for (const v of ["feat/one", "feat/two"]) writer(sessions, "L1", "branch", v);
  writer(sessions, "L1", "pr", "https://github.com/org/app/pull/5");
  appendFileSync(join(dir, "L1.ndjson"), rec("L1", "branch", "feat/tail").slice(0, 12)); // a write in progress
  show("preparing: the applier", JSON.stringify(applyR5(dir, "app-1", recPath)));
  // The publish: launch fields, then the held prefix, then published, in one record write.
  const r = readRec(recPath); const st = fstatSync(openSync(join(dir, "L1.ndjson"), "r"));
  const buf = readFileSync(join(dir, "L1.ndjson")); const p = parseChunk(buf.subarray(0, Math.min(CHUNK, buf.length)), "L1", buf.length <= CHUNK);
  writeRec(recPath, { ...r, runtimeHandle: '{"id":"new"}', ...p.upd, launchState: "published", inboxCursor: JSON.stringify({ launch: "L1", dev: st.dev, ino: st.ino, off: p.pos }) });
  show("published: branch, pr, cursor", `${readRec(recPath).branch}, ${readRec(recPath).pr}, off ${p.pos} of ${buf.length}, pending tail ${p.pendingTail}`);
  appendFileSync(join(dir, "L1.ndjson"), rec("L1", "branch", "feat/tail").slice(12));
  const later = applyR5(dir, "app-1", recPath);
  show("the tail completes; the next call", `branch ${readRec(recPath).branch}, off ${later.off}`);
}
~~~
### /tmp/aosd5/scripts/i1_writer.sh

~~~sh
#!/usr/bin/env bash
# i1_writer.sh <key> <value>: the record writer of design r5 section 3.4 (prototype). It appends one framed
# record to the inbox file of its launch (AO_LAUNCH_ID), or to legacy.ndjson for a pane without one. A
# missing file or a failed append goes to orphans.ndjson. It never fails the caller (exit 0).
# AO_TEST_PAUSE is a hook of this prototype only: the writer waits between the check and the append.
ao_inbox_append() {
  local key="$1" value="$2" LC_ALL=C
  local base="$AO_DATA_DIR/.inbox" launch="${AO_LAUNCH_ID:--}" hexv="" c i
  local file="$base/$AO_SESSION/${AO_LAUNCH_ID:-legacy}.ndjson"
  for ((i = 0; i < ${#value}; i++)); do printf -v c '%02x' "'${value:i:1}"; hexv+=$c; done
  local ms="${EPOCHREALTIME/./}"; ms="${ms:0:13}"
  local rec=$'\x1e'"1 $launch $key $hexv $ms"$'\n'
  if (( ${#rec} > 4000 )); then echo "ao-metadata-helper: $key not recorded (record over 4000 bytes)" >&2; return 0; fi
  if [[ -f "$file" ]]; then
    if [[ -n "${AO_TEST_PAUSE:-}" ]]; then : > "$AO_TEST_PAUSE.reached"; while [[ ! -e "$AO_TEST_PAUSE" ]]; do sleep 0.01; done; fi
    { printf '%s' "$rec" >> "$file"; } 2>/dev/null && return 0
  fi
  local orec=$'\x1e'"o1 $AO_SESSION $launch $key $hexv $ms"$'\n'
  { printf '%s' "$orec" >> "$base/orphans.ndjson"; } 2>/dev/null && return 0
  echo "ao-metadata-helper: $key not recorded (no inbox)" >&2
  return 0
}
ao_inbox_append "$@"
~~~
### /tmp/aosd5/scripts/a1_assoc_serial.mjs

~~~js
// a1 (review r4 B-2, design r5 section 4): concurrent association transitions on a private tmux 3.4 server
// (-L aosd5-assoc only). The tmux forms are the compare-and-set forms of design r4 section 3.2 (associate
// with adopt, the exact clear), as in t4. The record is a JSON stand-in with the compare of the launch
// identity (associationIntent and runtimeAssociation are launch-identity keys). Two protocols:
//   r4: no lock; each operation reads the intent, runs its tmux call, then its record compare-and-set.
//   r5: each operation holds the per-ID operation lock (a Linux abstract Unix socket, as delivery-lock.ts:
//       EADDRINUSE means busy, no process-local reentrancy) from its first record read to its last record
//       write; an abandon whose exact clear finds another token keeps the intent with a mismatch note.
// Each operation can pause before and after its tmux call and before and after its record write.
// Schedules: (i) abandon paused before its tmux call while a resume runs; (ii) resume paused before its tmux
// call while an abandon runs; (iii) the token is set (a lost answer); abandon paused before its record write
// while a resume runs; (iv) resume paused before its record write while an abandon runs; (v) abandon when
// tmux has a token that no record names. After each schedule: is the tmux token the one the record names?
// Run:
//   env -i HOME=/tmp/aosd5/home PATH=/tmp/aosd5/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp \
//     SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd5/scripts/a1_assoc_serial.mjs
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd5";
const SRV = "aosd5-assoc";
const sock = `/tmp/tmux-${process.getuid()}/${SRV}`;
if (existsSync(sock)) throw new Error(`${sock} exists: not started by this script`);
const started = new Map();
function track(pid, what) { if (pid && !started.has(pid)) { started.set(pid, what); appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} a1 ${what} pid=${pid}\n`); } }
function tm(args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", SRV, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
const q = (f) => `"${f}"`;
const token = () => randomBytes(16).toString("hex");
const tokOf = (name) => tm(["display-message", "-p", "-t", `=${name}:`, "#{@ao_launch}"]).out;
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const IDENT = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}";
const want = (name, ev) => `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
function associateArgs(name, ev, tok) { // design r4 3.2 step 4
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/}`)} { ${set} } { ${second} }`);
}
function clearArgs(name, ev, tok) { // design r4 3.3: the exact clear
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want(name, ev)}/${tok}}`)} { ${clear} } { ${no} }`);
}
const mark = (r) => r.out.split("\n").find((l) => l.startsWith("ao-assoc") || l.startsWith("ao-refused")) ?? r.out;

// ---- the record stand-in: one JSON file, replaced by rename; the compare is of the launch identity ----
const recPath = `${S}/tmp/a1-record.json`;
const readRec = () => JSON.parse(readFileSync(recPath, "utf8"));
const writeRec = (o) => { writeFileSync(`${recPath}.w`, JSON.stringify(o)); renameSync(`${recPath}.w`, recPath); };
const identity = (r) => JSON.stringify([r.associationIntent ?? null, r.runtimeAssociation ?? null, r.runtimeHandle]);
function casRec(expected, patch) { const r = readRec(); if (identity(r) !== expected) return false; writeRec({ ...r, ...patch }); return true; }

// ---- the per-ID operation lock (r5): an abstract socket, busy on EADDRINUSE, 20 ms retry, 30 s deadline ----
async function opLock(id) {
  const name = `\0aosd5-a1-operation-${id}`;
  const t0 = performance.now();
  for (;;) {
    const srv = createServer();
    const ok = await new Promise((res) => { srv.once("error", (e) => res(e.code === "EADDRINUSE" ? false : Promise.reject(e))); srv.listen(name, () => res(true)); });
    if (ok) return { release: () => new Promise((r) => srv.close(r)), waitedMs: Math.round(performance.now() - t0) };
    if (performance.now() - t0 > 30_000) throw new Error("operation lock busy for 30 s");
    await sleep(20);
  }
}

async function resume(name, mode, pause) {
  const lock = mode === "r5" ? await opLock(name) : null;
  try {
    const r = readRec();
    if (!r.associationIntent) return "no intent";
    const { token: T, ev } = r.associationIntent; const id0 = identity(r);
    await pause("before-tmux");
    const out = mark(tm(associateArgs(name, ev, T)));
    await pause("after-tmux");
    if (!/^ao-assoc(-adopt)?:/.test(out)) return `tmux ${out}`;
    await pause("before-record");
    const ok = casRec(id0, { associationIntent: null, runtimeAssociation: { token: T, ev } });
    await pause("after-record");
    return `tmux ${out.split(":")[0]}; record ${ok ? "published" : "compare failed"}${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
  } finally { await lock?.release(); }
}
async function abandon(name, mode, pause) {
  const lock = mode === "r5" ? await opLock(name) : null;
  try {
    const r = readRec();
    if (!r.associationIntent) return `no intent${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
    const { token: T, ev } = r.associationIntent; const id0 = identity(r);
    await pause("before-tmux");
    const out = mark(tm(clearArgs(name, ev, T)));
    await pause("after-tmux");
    const cleared = out.startsWith("ao-assoc-cleared");
    const tokenless = out === `ao-assoc-refused:${want(name, ev)}/`; // the evidence session, no token: T was never set
    await pause("before-record");
    let ok;
    if (mode === "r4" || cleared || tokenless) ok = casRec(id0, { associationIntent: null }); // r4 removes the intent in every case
    else ok = casRec(id0, { associationIntent: { ...r.associationIntent, mismatch: out } }) && "kept with mismatch";
    await pause("after-record");
    return `tmux ${out.split(":")[0]}; record ${ok === true ? "intent removed" : ok || "compare failed"}${lock ? `; lock waited ${lock.waitedMs} ms` : ""}`;
  } finally { await lock?.release(); }
}

// A pause point: the named operation stops at `at` until `release` is called.
function pauser(at) {
  let reached, release; const r = new Promise((x) => (reached = x)); const g = new Promise((x) => (release = x));
  return { pause: async (p) => { if (p === at) { reached(); await g; } }, reached: r, release };
}
const none = { pause: async () => {} };

function verdict(name) {
  const r = readRec(); const tok = tokOf(name);
  const named = r.runtimeAssociation?.token ?? "";
  const intent = r.associationIntent?.token ?? "";
  const consistent = r.associationIntent ? tok === "" || tok === intent : tok === named;
  const foreign = tok !== "" && tok !== r.T; // only the setup of (v) makes such a token
  const result = foreign ? `token of the setup; intent kept: ${r.associationIntent ? "yes" : "NO"}` : consistent ? "CONSISTENT" : "INCONSISTENT";
  return `record ${JSON.stringify({ intent: intent ? "T" : "", mismatch: r.associationIntent?.mismatch ? "yes" : "", association: named ? (named === intent || named === r.T ? "T" : "other") : "" })}; tmux token ${tok === r.T ? "T" : tok === "" ? '""' : "other"}; ${result}`;
}

let n = 0;
async function schedule(label, mode, setup, run) {
  const name = `a1-${mode}-${++n}`;
  tm(["new-session", "-d", "-s", name, "-c", `${S}/home`, "/bin/sleep 600"]);
  track(Number(tm(["display-message", "-p", "#{pid}"]).out), "tmux server aosd5-assoc");
  track(Number(tm(["display-message", "-p", "-t", `=${name}:`, "#{pane_pid}"]).out), `pane ${name}`);
  const [serverPid, sid, panePid] = tm(["display-message", "-p", "-t", `=${name}:`, "#{pid}|#{session_id}|#{pane_pid}"]).out.split("|");
  const ev = { serverPid, sid, panePid }; const T = token();
  writeRec({ runtimeHandle: name, T, associationIntent: { token: T, ev }, runtimeAssociation: null });
  await setup?.(name, ev, T);
  const res = await run(name);
  console.log(`  ${mode} ${label}: ${res}\n      -> ${verdict(name)}`);
  tm(["kill-session", "-t", `=${name}`]);
}

try {
  mkdirSync(`${S}/tmp`, { recursive: true });
  for (const mode of ["r4", "r5"]) {
    console.log(`== protocol ${mode}`);
    await schedule("(i) abandon paused before tmux; resume runs", mode, null, async (name) => {
      const a = pauser("before-tmux"); const pa = abandon(name, mode, a.pause); await a.reached;
      const pb = resume(name, mode, none.pause);
      const early = await Promise.race([pb.then((x) => `resume done: ${x}`), sleep(300).then(() => "resume waits")]);
      a.release(); return `${early} | abandon: ${await pa} | resume: ${await pb}`;
    });
    await schedule("(ii) resume paused before tmux; abandon runs", mode, null, async (name) => {
      const b = pauser("before-tmux"); const pb = resume(name, mode, b.pause); await b.reached;
      const pa = abandon(name, mode, none.pause);
      const early = await Promise.race([pa.then((x) => `abandon done: ${x}`), sleep(300).then(() => "abandon waits")]);
      b.release(); return `${early} | resume: ${await pb} | abandon: ${await pa}`;
    });
    await schedule("(iii) token set; abandon paused before record; resume runs", mode,
      async (name, ev, T) => { tm(associateArgs(name, ev, T)); }, async (name) => {
      const a = pauser("before-record"); const pa = abandon(name, mode, a.pause); await a.reached;
      const pb = resume(name, mode, none.pause);
      const early = await Promise.race([pb.then((x) => `resume done: ${x}`), sleep(300).then(() => "resume waits")]);
      a.release(); return `${early} | abandon: ${await pa} | resume: ${await pb}`;
    });
    await schedule("(iv) resume paused before record; abandon runs", mode, null, async (name) => {
      const b = pauser("before-record"); const pb = resume(name, mode, b.pause); await b.reached;
      const pa = abandon(name, mode, none.pause);
      const early = await Promise.race([pa.then((x) => `abandon done: ${x}`), sleep(300).then(() => "abandon waits")]);
      b.release(); return `${early} | resume: ${await pb} | abandon: ${await pa}`;
    });
    await schedule("(v) abandon while tmux has a token that no record names", mode,
      async (name) => { tm(["set-option", "-t", `=${name}:`, "@ao_launch", token()]); }, async (name) => `abandon: ${await abandon(name, mode, none.pause)}`);
  }
} finally {
  const srvPid = [...started].find(([, w]) => w.startsWith("tmux server"))?.[0];
  for (const [p, w] of started) if (!w.startsWith("tmux server")) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  if (srvPid) { try { process.kill(srvPid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; } }
  await sleep(200);
  if (srvPid && existsSync(sock)) unlinkSync(sock); // the socket of the server that this script started
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(sock)}`);
}
~~~
### /tmp/aosd5/scripts/fixture.mjs

~~~js
// fixture.mjs: print the frozen pre-RW writer texts of the build at 13c58b2c (GH_WRAPPER and
// AO_METADATA_HELPER, WRAPPER_VERSION 0.2.6) as gzip+base64 lines for the r5 tests, with their SHA-256.
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const WT = "/home/taisung/.worktrees/agent-orchestrator/ao-52";
const h = await import(`${WT}/packages/core/dist/agent-workspace-hooks.js`);
for (const name of ["GH_WRAPPER", "AO_METADATA_HELPER"]) {
  const text = h[name];
  const b64 = gzipSync(Buffer.from(text, "utf8"), { level: 9 }).toString("base64");
  console.log(`// ${name}: ${Buffer.byteLength(text)} bytes, sha256 ${createHash("sha256").update(text).digest("hex")}, gzip+base64 ${b64.length} chars`);
  console.log(`const FROZEN_${name} = [`);
  for (let i = 0; i < b64.length; i += 92) console.log(`  "${b64.slice(i, i + 92)}",`);
  console.log(`].join("");`);
}
~~~
### /tmp/aosd5/scripts/vt.sh

~~~sh
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd5
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
~~~
### /tmp/aosd5/scripts/redcount.sh

~~~sh
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged"), and per design
# round when the tag is followed by one in parentheses ("[same-id R3] (RW)").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd5/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd5/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd5/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
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
### /tmp/aosd5/scripts/val.sh

~~~sh
#!/usr/bin/env bash
# val.sh: run the r5 test files against the scratch prototypes of design r5 (/tmp/aosd5/val/core/writer-drain.ts,
# /tmp/aosd5/val/core/inbox.ts, /tmp/aosd5/val/tmux/assoc-proto.ts), to check that a correct implementation of
# the r5 rules turns the r5 defects green. The test files are copied to /tmp/aosd5/val with sed; only the
# import specifiers change (relative imports become absolute paths into the worktree, the inbox writer comes
# from the prototype, and the tmux file imports the association prototype as "core"). Nothing in the worktree
# changes. Red mode: every defect runs as a plain test.
set -e
S=/tmp/aosd5; V=$S/val; W=/home/taisung/.worktrees/agent-orchestrator/ao-52; C=$W/packages/core/src
mkdir -p $V/core/__tests__ $V/tmux/__tests__
[ -e $V/core/node_modules ] || ln -s $W/packages/core/node_modules $V/core/node_modules
[ -e $V/tmux/node_modules ] || ln -s $W/packages/plugins/runtime-tmux/node_modules $V/tmux/node_modules
sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" -e 's#^      writer: AO_METADATA_HELPER,$#      writer: mod["WRITER"] as string,#' \
  $C/__tests__/same-id-defects-r5.test.ts > $V/core/__tests__/same-id-defects-r5.test.ts
sed -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" -e "s#from \"\./test-utils\.js\"#from \"$C/__tests__/test-utils.ts\"#" \
  $C/__tests__/same-id-defects-r4.test.ts > $V/core/__tests__/same-id-defects-r4.test.ts
sed -e 's#import \* as core from "@aoagents/ao-core";#import * as core from "../assoc-proto.ts";#' \
  -e "s#from \"\.\./index\.js\"#from \"$W/packages/plugins/runtime-tmux/src/index.ts\"#" \
  $W/packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r5.test.ts > $V/tmux/__tests__/same-id-defects-r5.test.ts
run() {
  (cd "$1" && env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
    PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run --root "$1" "${@:2}" 2>&1) |
    sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ *(✓|×)|→|Tests ' | sed -e 's/^ *//' -e 's/ [0-9]*ms$//' | cut -c1-200
}
echo "== core r5 against writer-drain.ts and inbox.ts (prototypes)"; run $V/core __tests__/same-id-defects-r5.test.ts
echo "== core r4 (RW) B-1 against writer-drain.ts (prototype)"; run $V/core __tests__/same-id-defects-r4.test.ts -t 'B-1'
echo "== runtime-tmux r5 against assoc-proto.ts (prototype)"; run $V/tmux __tests__/same-id-defects-r5.test.ts
~~~
### /tmp/aosd5/scripts/dbg_clear.sh

~~~sh
#!/bin/sh
# dbg_clear.sh: which form of the exact clear does tmux 3.4 parse? Private server -L aosd5-dbg only. A debug
# run for the first association prototype, whose clear form had one closing brace too many (tmux: "syntax
# error"). Run: env -i HOME=/tmp/aosd5/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd5/tmp sh /tmp/aosd5/scripts/dbg_clear.sh
T="env -u TMUX /usr/bin/tmux -f /dev/null -L aosd5-dbg"
[ -e /tmp/tmux-$(id -u)/aosd5-dbg ] && { echo "socket exists"; exit 1; }
$T new-session -d -s s1 /bin/sleep 60; pid=$($T display-message -p '#{pid}'); echo "dbg server pid=$pid" >> /tmp/aosd5/logs/pids.txt
for form in \
 'if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p ao-assoc-cleared } { display-message -p no }' \
 'if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p "ao-assoc-cleared" } { display-message -p no }' \
 'if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -u -t =s1: @ao_launch ; display-message -p -t =s1: "ao-assoc-cleared:#{pid}" } { display-message -p no }' \
 'if-shell -F -t =s1: "#{==:#{@ao_launch},abc}" { set-option -t =s1: @ao_launch abc ; display-message -p ao-assoc } { display-message -p no }' ; do
  $T set-option -t =s1: @ao_launch abc
  echo "form: $form"; $T if-shell -F -t =s1: '#{==:1,1}' "$form" 'display-message -p outer-false'; echo "  exit $? token [$($T display-message -p -t =s1: '#{@ao_launch}')]"
done
$T kill-server; sleep 0.2; kill -0 $pid 2>/dev/null && echo "server still runs" || echo "server gone"
# The socket is this script's own (the script refuses to start when it exists): remove it.
[ -S /tmp/tmux-$(id -u)/aosd5-dbg ] && rm /tmp/tmux-$(id -u)/aosd5-dbg
echo "socket left: $([ -e /tmp/tmux-$(id -u)/aosd5-dbg ] && echo yes || echo no)"
~~~
### /tmp/aosd5/val/core/writer-drain.ts

~~~ts
// Validation prototype (scratch only) of design r5 section 2: fenceAndDrainWriters. It installs every
// managed file by rename (the fence), then classifies every process of the uid at each scan by rules W1
// and W2, with no seed, and returns after three consecutive scans that find no busy process.
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

interface DrainOptions {
  install: Array<{ path: string; content: string; mode: number }>;
  sessionsDirs: string[];
  pollMs?: number;
  timeoutMs?: number;
  cleanScans?: number;
  onScan?: (scan: number) => void;
}
const INTERPRETERS = new Set(["bash", "sh", "dash"]);
const inode = (p: string) => { const s = statSync(p); return `${s.dev}:${s.ino}`; };
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };

export async function fenceAndDrainWriters(o: DrainOptions): Promise<{ scans: number; waited: string[] }> {
  for (const f of o.install) { writeFileSync(`${f.path}.ao-new`, f.content, { mode: f.mode }); renameSync(`${f.path}.ao-new`, f.path); }
  const current = new Map(o.install.map((f) => [real(f.path), inode(f.path)]));
  const names = new Set(o.install.map((f) => basename(f.path)));
  const sess = new Set(o.sessionsDirs.map(real));
  const uid = process.getuid?.() ?? -1;
  const waited = new Set<string>();
  const t0 = performance.now();
  for (let scan = 1, clean = 0; ; scan++) {
    let busy = 0;
    for (const d of readdirSync("/proc")) {
      if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
      try { if (statSync(`/proc/${d}`).uid !== uid) continue; } catch { continue; }
      let argv: string[];
      try { argv = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { continue; }
      if (argv.length === 0) continue; // a zombie or a kernel thread runs no writer code
      let cwd: string | null | undefined;
      const abs = (a: string) => { if (isAbsolute(a)) return a; if (cwd === undefined) { try { cwd = readlinkSync(`/proc/${d}/cwd`); } catch { cwd = null; } } return cwd ? resolve(cwd, a) : null; };
      const w2 = argv.slice(1).some((a) => { if (!a.includes("/")) return false; const x = abs(a); if (x === null) return true;
        return sess.has(real(dirname(x))) && /^[^./][^/]*?(\.tmp(\.\d+)?)?$/.test(basename(x)); });
      let w1 = false;
      if (!w2) {
        let exe = ""; try { exe = basename(readlinkSync(`/proc/${d}/exe`)); } catch { exe = basename(argv[0] ?? ""); }
        if (INTERPRETERS.has(exe)) {
          const named = argv.slice(1).map((a) => { const x = abs(a); return x === null ? null : real(x); })
            .find((x, i) => (x !== null && current.has(x)) || ((x === null || !existsSync(x)) && names.has(basename(argv[i + 1] ?? ""))));
          if (named !== undefined) {
            let fds: string[] | null;
            try { fds = readdirSync(`/proc/${d}/fd`).flatMap((fd) => { try { const s = statSync(`/proc/${d}/fd/${fd}`); return [`${s.dev}:${s.ino}`]; } catch { return []; } }); } catch (e) { fds = (e as NodeJS.ErrnoException).code === "ENOENT" ? [] : null; }
            const cur = named === null ? undefined : current.get(named);
            w1 = !(fds !== null && cur !== undefined && fds.includes(cur));
          }
        }
      }
      if (w1 || w2) { busy++; waited.add(`${w2 ? "W2" : "W1"} ${argv.join(" ").slice(0, 80)}`); }
    }
    o.onScan?.(scan);
    clean = busy === 0 ? clean + 1 : 0;
    if (clean >= (o.cleanScans ?? 3)) return { scans: scan, waited: [...waited] };
    if (performance.now() - t0 > (o.timeoutMs ?? 600_000)) throw new Error(`writers still run: ${[...waited].join("; ")}`);
    await sleep(o.pollMs ?? 25);
  }
}
~~~
### /tmp/aosd5/val/core/inbox.ts

~~~ts
// Validation prototype (scratch only) of design r5 section 3: the inbox of RW on the real record functions.
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { readMetadataRaw, updateMetadata, withRecordLock } from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/src/metadata.ts";

const RS = 0x1e, LF = 0x0a, CHUNK = 65536, MAX_REC = 4096;
export const WRITER = readFileSync("/tmp/aosd5/scripts/i1_writer.sh", "utf8").replace(/ao_inbox_append/g, "update_ao_metadata").replace(/\nupdate_ao_metadata "\$@"\n$/, "\n");

const dirOf = (d: string, id: string) => join(d, ".inbox", id);
function select(r: Record<string, string>) {
  if (r["archiveIntent"]) return null;
  if (r["launchId"]) return r["launchState"] === "published" ? { file: `${r["launchId"]}.ndjson`, launch: r["launchId"] } : null;
  return r["inboxLegacy"] ? { file: "legacy.ndjson", launch: "-" } : null;
}
export function initLegacyInbox(d: string, id: string, barrierId: string): void {
  mkdirSync(dirOf(d, id), { recursive: true });
  try { writeFileSync(join(dirOf(d, id), "legacy.ndjson"), "", { flag: "wx" }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  updateMetadata(d, id, { inboxLegacy: barrierId });
}
export function beginLaunch(d: string, id: string): string {
  const launch = randomBytes(16).toString("hex");
  mkdirSync(dirOf(d, id), { recursive: true });
  writeFileSync(join(dirOf(d, id), `${launch}.ndjson`), "", { flag: "wx" }); // the file first (I1)
  updateMetadata(d, id, { launchId: launch, launchState: "preparing", inboxLegacy: "", inboxCursor: "" });
  return launch;
}
function parse(buf: Buffer, launch: string, atEof: boolean) {
  let pos = 0; const upd: Record<string, string> = {}; let pending = false;
  while (pos < buf.length) {
    if (buf[pos] !== RS) { const j = buf.indexOf(RS, pos); pos = j < 0 ? buf.length : j; continue; }
    const next = buf.indexOf(RS, pos + 1); const lf = buf.indexOf(LF, pos);
    if (lf >= 0 && (next < 0 || lf < next)) {
      if (lf - pos + 1 <= MAX_REC) { const f = buf.subarray(pos + 1, lf).toString("latin1").split(" ");
        if (f.length === 5 && f[0] === "1" && f[1] === launch && ["pr", "status", "branch"].includes(f[2] ?? "")) upd[f[2] ?? ""] = Buffer.from(f[3] ?? "", "hex").toString("utf8"); }
      pos = lf + 1; continue;
    }
    if (next >= 0) { pos = next; continue; }
    if (buf.length - pos >= MAX_REC) { pos = buf.length; continue; }
    if (atEof) pending = true;
    break;
  }
  return { pos, upd, pending };
}
export function applyInbox(d: string, id: string): { more: boolean; off?: number; size?: number } {
  return withRecordLock(d, id, () => {
    const r = readMetadataRaw(d, id) ?? {}; const sel = select(r);
    if (!sel) return { more: false };
    const fd = openSync(join(dirOf(d, id), sel.file), "r");
    try {
      const st = fstatSync(fd);
      const cur = r["inboxCursor"] ? (JSON.parse(r["inboxCursor"]) as { launch: string; dev: number; ino: number; off: number }) : { launch: sel.launch, dev: st.dev, ino: st.ino, off: 0 };
      if (cur.launch !== sel.launch || cur.dev !== st.dev || cur.ino !== st.ino || cur.off > st.size) return { more: false };
      const n = Math.min(CHUNK, st.size - cur.off); const buf = Buffer.alloc(n); readSync(fd, buf, 0, n, cur.off);
      const p = parse(buf, sel.launch, cur.off + n === st.size);
      const off = cur.off + p.pos;
      if (p.pos > 0) updateMetadata(d, id, { ...p.upd, inboxCursor: JSON.stringify({ ...cur, off }) });
      return { more: off < st.size && !p.pending, off, size: st.size };
    } finally { closeSync(fd); }
  });
}
export function publishLaunch(d: string, id: string, launch: string, fields: Record<string, string>): void {
  withRecordLock(d, id, () => {
    const r = readMetadataRaw(d, id) ?? {};
    if (r["launchId"] !== launch || r["launchState"] !== "preparing") throw new Error("not this preparing launch");
    updateMetadata(d, id, { ...fields, launchState: "published" });
    applyInbox(d, id); // the held complete prefix, after the launch fields (one lock hold)
  });
}
export function catchUpInbox(d: string, id: string): { complete: boolean } {
  const r = readMetadataRaw(d, id) ?? {}; const sel = select(r);
  if (!sel) return { complete: true };
  const fd = openSync(join(dirOf(d, id), sel.file), "r"); const target = fstatSync(fd).size; closeSync(fd);
  const t0 = performance.now();
  for (;;) {
    const res = applyInbox(d, id);
    if (!res.more || (res.off ?? 0) >= target) return { complete: true };
    if (performance.now() - t0 > 10_000) return { complete: false };
  }
}
~~~
### /tmp/aosd5/val/tmux/assoc-proto.ts

~~~ts
// Validation prototype (scratch only) of design r5 section 4: association transitions under the per-ID
// operation lock (a Linux abstract Unix socket; busy on EADDRINUSE; no process-local reentrancy).
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { readMetadataRaw, updateMetadata } from "@aoagents/ao-core";

type Point = "before-tmux" | "after-tmux" | "before-record" | "after-record";
type Pause = (p: Point) => Promise<void>;
interface Ev { serverPid: string; sid: string; panePid: string }
const q = (f: string) => `"${f}"`;
const tm = (args: string[]) => spawnSync("tmux", args, { encoding: "utf8" }).stdout.trim();
const IDENT = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}";
const want = (n: string, e: Ev) => `${e.serverPid}/${n}/${e.sid.slice(1)}/${e.panePid}`;
function gated(name: string, inner: string): string[] {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";", "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused, ";", "display-message", "-p", "ao-end"];
}
const assoc = (n: string, e: Ev, t: string) => gated(n, `if-shell -F -t =${n}: ${q(`#{==:${IDENT},${want(n, e)}/}`)} { set-option -t =${n}: @ao_launch ${t} ; display-message -p ao-assoc } { if-shell -F -t =${n}: ${q(`#{==:${IDENT},${want(n, e)}/${t}}`)} { display-message -p ao-assoc-adopt } { display-message -p -t =${n}: ${q(`ao-assoc-refused:${IDENT}`)} } }`);
const clear = (n: string, e: Ev, t: string) => gated(n, `if-shell -F -t =${n}: ${q(`#{==:${IDENT},${want(n, e)}/${t}}`)} { set-option -u -t =${n}: @ao_launch ; display-message -p ao-assoc-cleared } { display-message -p -t =${n}: ${q(`ao-assoc-refused:${IDENT}`)} }`);
const answer = (out: string) => out.split("\n").find((l) => /^ao-(assoc|refused)/.test(l)) ?? out;
const nameOf = (d: string, id: string) => (JSON.parse(readMetadataRaw(d, id)?.["runtimeHandle"] ?? "{}") as { id?: string }).id ?? "";
const noPause: Pause = async () => {};

async function opLock(d: string, id: string): Promise<() => Promise<void>> {
  const name = `\0aosd5-val-operation-${createHash("sha256").update(`${d}/${id}`).digest("hex").slice(0, 32)}`;
  const t0 = performance.now();
  for (;;) {
    const srv = createServer();
    const ok = await new Promise<boolean>((res, rej) => { srv.once("error", (e: NodeJS.ErrnoException) => (e.code === "EADDRINUSE" ? res(false) : rej(e))); srv.listen(name, () => res(true)); });
    if (ok) return () => new Promise<void>((r) => srv.close(() => r()));
    if (performance.now() - t0 > 30_000) throw new Error("operation lock busy");
    await sleep(20);
  }
}
async function locked<T>(d: string, id: string, fn: () => Promise<T>): Promise<T> { const release = await opLock(d, id); try { return await fn(); } finally { await release(); } }

export async function beginAssociation(d: string, id: string, _rt: unknown, ev: Ev): Promise<unknown> {
  return locked(d, id, async () => { const intent = { token: randomBytes(16).toString("hex"), ...ev }; updateMetadata(d, id, { associationIntent: JSON.stringify(intent) }); return intent; });
}
export async function resumeAssociation(d: string, id: string, _rt: unknown, o?: { pause?: Pause }): Promise<unknown> {
  const pause = o?.pause ?? noPause;
  return locked(d, id, async () => {
    const r = readMetadataRaw(d, id) ?? {}; if (!r["associationIntent"]) return "no intent";
    const i = JSON.parse(r["associationIntent"]) as Ev & { token: string };
    await pause("before-tmux"); const out = answer(tm(assoc(nameOf(d, id), i, i.token))); await pause("after-tmux");
    if (!/^ao-assoc(-adopt)?$/.test(out)) return out;
    await pause("before-record"); updateMetadata(d, id, { associationIntent: "", runtimeAssociation: JSON.stringify(i) }); await pause("after-record");
    return "published";
  });
}
export async function abandonAssociation(d: string, id: string, _rt: unknown, o?: { pause?: Pause }): Promise<unknown> {
  const pause = o?.pause ?? noPause;
  return locked(d, id, async () => {
    const r = readMetadataRaw(d, id) ?? {}; if (!r["associationIntent"]) return "no intent";
    const i = JSON.parse(r["associationIntent"]) as Ev & { token: string };
    await pause("before-tmux"); const out = answer(tm(clear(nameOf(d, id), i, i.token))); await pause("after-tmux");
    const gone = out === "ao-assoc-cleared" || out === `ao-assoc-refused:${want(nameOf(d, id), i)}/`;
    await pause("before-record");
    updateMetadata(d, id, gone ? { associationIntent: "" } : { associationIntent: JSON.stringify({ ...i, mismatch: out }) });
    await pause("after-record");
    return gone ? "intent removed" : "kept with mismatch";
  });
}
export async function clearForeignToken(d: string, id: string, _rt: unknown, o: { fingerprint: string; evidence: Ev }): Promise<unknown> {
  return locked(d, id, async () => {
    const r = readMetadataRaw(d, id) ?? {}; const n = nameOf(d, id);
    const tok = tm(["display-message", "-p", "-t", `=${n}:`, "#{@ao_launch}"]);
    if (r["associationIntent"] || r["runtimeAssociation"] || !tok) return "refused";
    if (createHash("sha256").update(tok).digest("hex").slice(0, 16) !== o.fingerprint) return "fingerprint refused";
    return answer(tm(clear(n, o.evidence, tok)));
  });
}
~~~
