# Same-ID design, revision r8: M-1 to M-3 and m-1 of review r7 (ao-52)

Scope: RW and R2b-2. Input: review r7 by ao-62 (`main:development/reviews/same_id_design_review_r7_astra6.md`;
RW and R2b-2 SOUND-WITH-CHANGES, 0 blockers, 3 majors, 1 minor). Tests: `fe5d6575..48c26129` on the branch of
ao-52; the branch stays on `fe5d6575`. Design r7 (`same_id_design_r7_opus.md`) stays in force for everything
that this file does not replace. Each section names the r7 text that it replaces. Source lines are on `main`
`46f0940c`: R4 landed on `main` during this round (`193d2c9e`), so the lines of `metadata.ts` and
`session-manager.ts` differ from those of the review (`75508f06`); `runtime-tmux/src/index.ts`, `core/src/tmux.ts`
and `core/src/index.ts` keep the review's lines. Decided and not reopened: the stopped-fleet barrier, OD-2 to
OD-28 as r7 8, and OD-29 (a) (7.1).

## 0. Response table

| Finding | Decision | Section | Tests (each defect fails on `fe5d6575`) |
| --- | --- | --- | --- |
| **M-1** (RW) publish the record archive atomically | Accepted. The copy goes to a temporary dot name (`O_EXCL`, every byte, `fsync`), then `link` to the final name (a link never replaces a name), then the temporary name is removed and `archive/` is synced, then the active record is removed. A final name with the same bytes is kept, unchanged. With other bytes it is "archive damaged" and nothing changes. A temporary file of the intent comes from a holder that died or failed in its hold: the recovery removes it. Every record-lock holder finishes the intent, `applyInbox` too. New in r8: an update of the latest archive also writes a dot temporary name; today its temporary name is in the reader namespace. | 1 | core r8 `(RW)` M-1: 7 defects (a short copy, recovered through each of 5 callers; a stale temporary file; a short write of an archive update), 4 controls (no byte written; a fault after the link; a fault before the active unlink; a conflicting archive) |
| **M-2** (R2b-2) the creation fence for every caller | Accepted. Worker spawn, orchestrator spawn and restore take the operation lock of the ID where it becomes the subject, recheck it under the lock, fence the tmux name before the launch record write, and create with that operation: guarded create, gated launch keys, gated cleanup kill. A create without an operation throws and runs no tmux command. A holder that found no server uses a guarded bootstrap that needs an EMPTY name option. The residual is "creation prepared without a server identity" (4). The section 6 guarantee covers only a create that carries its fence evidence. OD-28 (b) stays. | 3, 4, 6 | core r8 `(R2b-2)` M-2: 3 defects (spawn, orchestrator spawn, restore), 1 control (no raw helper call); tmux r8: 3 defects (no operation; a late bootstrap on a fenced server; held launch keys), 1 control (a bootstrap with no server) |
| **M-3** (both) the oracles accept partial fixes | Accepted. Design: an allow for P1, P2 or P4 is refused before any step; one rule per entry; the state of each entry at check 1, check 2 and admission; at admission each allowed process is classified again with every rule. Tests: the restart test sets the old name option on the new server and needs the refusal marker; separate wrong-PID and wrong-start-time cases; the competing spawn must answer "is taken". Each discriminator is quoted (7.3). | 2, 7.3 | tmux r7 (2 tests changed); tmux r8 M-3: 2 defects, 1 control; core r8 `(RW)` M-3: 5 defects, 2 controls; core r7 (1 control changed) |
| **m-1** (R2b-2) the durable value of the audit | Accepted. The audit compares `@ao_launch` of a session with the durable launch token of the record that names it: the planned `tmuxLaunchToken` (new, written by the launch record write before the create), the handle token, the association token, or the association intent. `@ao_op` is never compared. A crash between a fence and the next record write leaves the class unchanged. | 5 | core r8 `(R2b-2)` m-1: 6 defects (healthy launch, associated legacy, legacy, interrupted fence, preparing, failed-launch bootstrap pane), 1 control (an orphan that no record names) |
| OD-29 | decided (a) | 7.1 | the RW round changes the r5 and r6 callbacks |

## 1. RW: the atomic record archive (replaces r7 3.4 "Steps" and "Recovery", and the `deleteMetadata` sentence of "Names")

**Why.** `deleteMetadata` writes the copy under its final name (`metadata.ts:713`,
`writeFileSync(archivePath, content)`) and then removes the active record (`:716`). Design r7 kept that write.
A short write leaves a partial record under the final name. `readArchivedMetadataRaw` returns it as the latest
archive, and the r7 recovery reads it as a conflicting archive. Measured (m1, a copy of the r7 prototype, 10
bytes then `EIO`): the latest archive reads `{"launchId":"0"}`; `recoverArchive`, `beginLaunch` and
`recoverInterruptedRecords` answer "inbox damaged"; `pruneInbox` and `applyInbox` do nothing; the active record
stays. With the r8 rule each of the five callers finishes the archive with the full record (9.2).

**The publication** `publishArchive(dir, id, ts, content)`, inside the archive branch of `deleteMetadata`. The
caller holds the record lock of the ID, and the name `<id>_<ts>` comes from the intent (r7 3.4 "Names").

1. If temporary files `archive/.<id>_<ts>.tmp-*` exist, remove each.
2. If `archive/<id>_<ts>` exists, go to step 6.
3. Open `T = archive/.<id>_<ts>.tmp-<pid>-<8 hex>` with `wx` (`O_CREAT|O_EXCL`) and mode 0600. Write every
   byte (a loop on `writeSync`), `fsync` it, close it.
4. `link(T, archive/<id>_<ts>)`. On `EEXIST`, remove `T` and go to step 6. On another error, the publication
   throws: the intent stays, and the next holder tries again. Nothing falls back to a direct write.
5. Remove `T`, then `fsync` `archive/`. Go to step 7.
6. Compare the bytes of `archive/<id>_<ts>` with `content`. Equal: "kept", with no write (inode, mtime and size
   stay). Not equal: "archive damaged". Stop here: the active record, the intent, the inbox archive and both
   archive files stay.
7. Remove the active record (conditional on `archiveIntent=<ts>`, as r7), then `fsync` the sessions
   directory.

The content is the active record as read in the hold. It keeps `archiveIntent=<ts>`, as in r7; the archived
restore of r7 3.2 removes that field.

**No reader sees a temporary name**, also on a build before RW. The name starts with a dot.
`readArchivedMetadataRaw` takes `<id>_` and then a digit (`metadata.ts:726`, the digit check `:742`). R4's
`readArchivedMetadataStrict` (`:763`, `:784`) and `updateLatestArchive` (`:819`, `:831`) take the same names.
`listArchivedSessionIds`, its strict form and R4's allocation reader match `/^([a-zA-Z0-9_-]+)_\d/`
(`session-manager.ts:663`, `:678`, `:690`). `listMetadata` skips dot names (`metadata.ts:869`).

**Every write into `archive/` uses a dot temporary name** (new in r8). The archive is not the only writer
there. `updateArchivedMetadata` (`metadata.ts:805`; callers `session-manager.ts:925`, `:3271`, `:3293`,
`:4235`) holds the record lock and calls `updateLatestArchive`, which writes through `atomicWriteFileSync`
(`:857`). That temporary name is `<archive>.tmp.<pid>.<ms>` (`atomic-write.ts:8`): it starts with `<id>_` and a
digit, and it sorts after the archive, so every reader above takes it as the latest archive while it exists.
Measured (core r8, `fe5d6575`; quote in 10.1): a short write of an update leaves
`app-1_<ts>.tmp.<pid>.<ms>` next to the archive, and the reader returns its 10 bytes as the record. The
rule: an update first removes the files `archive/.<id>_<ts>.upd-*` of its target (it holds the record lock, so
they come from a holder that died or failed), writes `archive/.<id>_<ts>.upd-<pid>-<8 hex>` (every byte,
`fsync`), renames it over `archive/<id>_<ts>` (an update replaces the archive that it read under the same
lock), and `fsync`s `archive/`. On an error it removes its temporary file. `atomicWriteFileSync` stays for the
active record: its temporary name `<id>.tmp.<pid>.<ms>` has dots, so `listMetadata` rejects it
(`VALID_SESSION_ID`, `metadata.ts:382`).

**The retry and damage rule.** Every holder of the record lock that reads `archiveIntent=<ts>` finishes the
intent in its hold first: `beginLaunch`, `pruneInbox`, `applyInbox`, every mutating command,
`recoverInterruptedRecords` and barrier step 3. The r7 text names them; the r7 prototype's `applyInbox` did not
finish, and the r8 prototype does. The inbox move of r7 3.4 comes first, with its table unchanged. Then:

| `archive/` holds | Meaning | Action |
| --- | --- | --- |
| no `<id>_<ts>` and no temporary file | the copy did not start, or it failed before the link | publish (steps 3 to 7) |
| `.<id>_<ts>.tmp-*` | a holder died or failed in its own hold; every publication of the ID runs under its record lock, so no live holder owns the file | remove it (step 1), then as the other rows |
| `<id>_<ts>`, equal to the record | the link ran; a fault came before step 7 ended | "kept", then step 7 |
| `<id>_<ts>`, other bytes | external damage | "archive damaged" |

The recovery uses the intent's own `<ts>`. It never chooses another time stamp. `recoverArchive` answers
`nothing`, `finished`, `inbox damaged` or `archive damaged`. Every caller refuses on an answer that ends in
`damaged`; r7 named only "inbox damaged". Barrier step 3 keeps admission closed on either answer.

**Filesystem.** `link` needs hard links in the sessions directory. `archive/` is a subdirectory of it, so
`EXDEV` cannot happen. The state root of this host is on ext4 (`stat -f -c %T ~/.agent-orchestrator`:
`ext2/ext3`). R4 keeps the rule for how a reader reports an error of a real archive file (r7 3.7). This change
is in the writer.

## 2. RW: the allows of the barrier (replaces r7 2.2 "Allows" and "Test seam", step 8 of r7 2.3, and the barrier sentence of r7 3.6)

- **Parse.** An entry `--allow <pid>:<start ticks>:<rule>` with a rule outside P1u, P2u, P3 and P3u is refused
  before step 1 ("the rule P1 cannot be allowed"), whatever its PID and start ticks. The barrier changes
  nothing.
- **One rule per entry.** An entry removes only the block of its own rule for its own process. An unreadable
  process (OD-27 (b)) blocks by P1u and by P3u, so it needs two entries. Correction of r7 2.1 (costs) and r7 11
  item 3: the 8 processes with an unreadable identity on this host need 16 entries at each barrier, not 8.
- **States.** At each check the barrier gives each entry one state. `matched`: the process lives with those
  start ticks, and the entry removed a block. `unused`: the process lives with those ticks, and its rule did not
  match. `expired`: the process ended, is a zombie, or has other start ticks. `not run`: an earlier check
  blocked. The result and the barrier record have
  `allows: [{ pid, startTicks, rule, check1, check2, admission }]`.
- **Step 8 (new text).** After the exact checks of step 7, every allowed process that still lives with its
  start ticks is classified again with every rule, P1 to P4. P4 includes W3: a descriptor on a record of a
  covered root or on its temporary file. A match that no entry allows blocks, and admission stays closed. Then
  the barrier writes its record (the entries with their three states, both check results, the covered roots),
  opens admission and starts the standing check.
- **The callback seam** `allow({ pid, rule })` of the r5 and r6 tests counts only for P1u, P2u, P3 and P3u. For
  P1, P2 and P4 it has no effect.
- **The test seam** `processScope(pid)` limits the processes that a check reads. It is not an allow, the CLI
  cannot reach it, and no barrier record names it. OD-29 (a) puts it into the r5 and r6 tests (7.1).
- **API.** `checkFleetAndFence({ install, sessionsDirs, allowEntries?, tmuxSockets?, tmuxSocketDir?,
  processScope?, onCheck?, onEnumerated?, allow? })` throws for a forbidden entry and returns
  `{ admitted, blocking, allows }`. `onCheck(n)` runs after check n (1 and 2), so `onCheck(2)` runs before the
  admission step.

## 3. R2b-2: the creation fence for every caller (M-2; replaces the order of r7 5.3, and r7 5.5)

**The callers.** Each of these holds the operation lock of the ID from the point in the last column until the
record write that publishes the runtime handle or marks the launch failed (or until it returns a reused
orchestrator session, which makes no create):

| Caller | On `main` | The ID becomes the lock subject |
| --- | --- | --- |
| worker spawn | `spawn` `:1984`; `reserveNextSessionIdentity` `:1255`, reservation `:1289`; create `:2254` (the review's `:2217`) | at each candidate number of the reservation loop |
| orchestrator spawn | `spawnOrchestrator` `:2408`; project mode: the fixed ID `<prefix>-orchestrator`, reservations `:2551`, `:2578`, `:2581`; isolated mode: `reserveNextOrchestratorIdentity` `:1307`, reservation `:1357`; create `:2817` (the review's `:2780`) | project mode: before the first record read; isolated mode: at each candidate number |
| restore | `restore` `:4256` (r7 5.1 lists it); copy-back reservation `:4429`; create `:4524` (the review's `:4487`) | before the first record read |

**The order** for a holder H with the operation op(H) (at least 48 random bits, r6 5.1) of ID X with tmux name N:

1. Choose X. Spawn: the next candidate number, as today. Restore and project mode: the given ID.
2. Take the operation lock of X. Spawn: one try; a held lock means X is in use, so take the next candidate.
   Restore and project mode: the 30 s CLI waiter (r5 5.1).
3. The recheck under the lock (moved here from R3a, r5 5.1). Spawn: X has no active record (strict read), and
   no archive name marks it used (the local sources of `usedNumbers`, `:1266` to `:1269`: `listMetadata` and
   R4's `listArchivedSessionIdsForAllocation`, read again for X; an archive directory that cannot be listed
   stops the spawn, as R4 does); else release the lock and take the next candidate. The remote branch list
   (`:1273`) is read once, before the loop, as today. Restore: the launch identity is the one that the
   restore read (r7 3.2 step 2).
4. `fenceName(N, op(H))`. It returns `{ fenced, server }`, with `server: null` when no server answers. A refusal
   after 3 tries refuses the operation ("the session name changed"). Spawn does not take the next number then,
   because only the holder of X's lock fences N, so a refusal means a process that holds no lock.
5. The launch record write (r7 3.2 step 4), now with the planned launch token `tmuxLaunchToken=T`
   (`randomBytes(16)`, hex; section 5).
6. The workspace and agent steps of today, unchanged, under the lock.
7. `runtime.create({ ..., operation: { id: op(H), server, launchToken: T } })`:
   - `server` set: the guarded create of r7 5.3 step 5, whose TRUE branch also runs
     `set-option -t =N: @ao_launch T`;
   - `server: null`: the guarded bootstrap (below);
   - every launch key (`runtime-tmux/src/index.ts:145` to `:149`, the short `send-keys` and the `-l` path with
     its Enter) runs inside `if-shell -F -t =N: "#{==:#{@ao_op},op(H)}"`;
   - the cleanup `kill-session` (`:153`) runs inside the same gate.
8. The record write that publishes the handle with `data.tmuxLaunchToken = T`, or the failed mark. Then
   release the lock.

**A managed create needs an operation.** runtime-tmux `create` without `config.operation` throws ("a managed
create of N needs an operation") and runs no tmux command. Every create through the `Runtime` interface is
managed. `RuntimeCreateConfig.operation` stays optional in the shared type (`types.ts:373`), because
runtime-herdr ignores it.

**The guarded bootstrap** (the holder found no server):

~~~text
start-server ; if-shell -F "#{==:#{@ao_name_<k>},}"
  "new-session -d -s N -c <ws> ... ; set-option -s @ao_name_<k> op(H) ; set-option -t =N: @ao_op op(H) ;
   set-option -t =N: @ao_launch T ; display-message -p ao-created:#{pid}/#{start_time}"
  "display-message -p ao-create-refused:#{pid}/#{start_time}/#{@ao_name_<k>}"
~~~

`start-server` starts a server when none runs; else it does nothing. The `if-shell -F` then runs in that server,
in the same command list. It needs an EMPTY name option, so it is refused on any server where a holder fenced
N. On a server that it starts, the option is empty: it creates the session and sets the name option to op(H),
so the next holder fences from that value as usual. Measured (m2): with no server it creates and sets the three
options (a); in the review's schedule (H0 found no server, H1 starts a server and fences, then H0's create runs)
it answers `ao-create-refused:3022926/1792674867/op1` and no session exists, while the plain create of r7 5.4
in the same schedule makes the session (b); 40 of 40 competing bootstrap pairs give one `ao-created` (d).

**The raw core helper.** `core/src/tmux.ts:129` `newSession` (exported as `newTmuxSession`,
`core/src/index.ts:45`) creates with no fence. No production module calls it (m3; a core r8 control checks
this). R2b-2 documents it as unmanaged: never for a name of the AO form. The export stays, because the core
index is a stable API. `integration-tests/src/helpers/tmux.ts:55` is test code.

**Cost.** A spawn holds the operation lock through the workspace and agent steps (seconds: `git worktree add`,
the hooks, the agent's prepare). A kill or restore of that ID in that time waits up to 30 s and then refuses,
and the lifecycle tries again at its next poll. Today they act on a half-made session.

**What stays in R3a.** The life of the tmux client and the agent child under the lock, the worktree and child
protocol, and the operation lock of the other entry points (r7 6).

**The runtime API** (replaces r7 5.5 for runtime-tmux): `fenceName(sessionName, operationId)` returns
`{ fenced, server: { pid, startTime } | null }`; `RuntimeCreateConfig.operation: { id, server, launchToken }`;
`create` makes the guarded create (server set) or the guarded bootstrap (server null), with the gated launch keys
and cleanup kill.

## 4. R2b-2: the residual until R3a (replaces the first paragraph of r7 5.4)

The residual is a **creation prepared without a server identity**. A holder H found no server (step 4 of 3
answered `server: null`) and so prepared a guarded bootstrap. H dies while that command is held (in a shim, a
fork before exec, a delayed exec), and the command runs later:

- when no server runs then, it starts a server and makes the session;
- when a successor server runs and no holder fenced N on it, it makes the session there.

Both are measured (m2 f). On a server where any holder fenced N, it is refused (m2 b). In both cases the pane
runs with the environment of that launch, possibly a launch that the next holder or the barrier marked `failed`,
with the worktree and credential effects that r7 5.4 lists. R2b-2 makes no claim of launch exclusivity. The
audit finds the session (section 5): `stale` when a record holds the token of that failed launch, `unrecorded`
when no record names it. This is detection, not prevention. OD-28 (b) is unchanged.

## 5. R2b-2: what the audit compares (m-1; replaces the second paragraph of r7 5.4)

**The values.** For each session of the AO form on each server that the discovery of r7 2.2 finds, the audit
reads `#{session_name}`, `#{@ao_launch}`, the socket, the pane PID and `#{session_created}`. For the active
record that names the session (handle `id` or `tmuxName`, and the socket when the handle names one), it takes the
durable token D, the first of:

1. the top-level `tmuxLaunchToken` (new): the planned token that every launch record write stores before the
   create (3 step 5). It comes first, because a restore writes a new planned token while the handle still
   names the old one;
2. `runtimeHandle.data.tmuxLaunchToken` (r3 2.1): a launch from R2b-1, before this field existed;
3. the token of `runtimeAssociation` (r3 2.9, r4 3.2 step 6): an associated legacy record.

A record with `associationIntent` (r4 3.1) and no D is an association in progress. `tmuxLaunchToken` joins
`LAUNCH_IDENTITY_KEYS` (`metadata.ts:331`), as `associationIntent` and `runtimeAssociation` did. The audit never
compares `@ao_op`: every session fence changes it, also the fence of an operation that then fails or dies before
its record write. Measured (m2 e): after the fence of opX, `op` is opX and `launch` stays TH.

**Who changes D.**

| Operation | Step | Record change |
| --- | --- | --- |
| launch (spawn, orchestrator spawn, restore) | the launch record write (3 step 5) | `tmuxLaunchToken=T`, a new T for each launch |
|  | the publish (3 step 8) | `runtimeHandle` with `data.tmuxLaunchToken=T`; the top-level T stays |
|  | the failed mark (the holder, the next holder, barrier step 3) | `launchState=failed`; T stays |
|  | refused before step 5 (lock, recheck, fence) | nothing |
| association (r4 3.2) | step 3 | `associationIntent` with its token |
|  | step 6 | `runtimeAssociation` with the token; the intent is removed |
|  | `--abandon` (r4 3.3) | the intent is removed |
| a fence (r7 5.2, 5.3), send, attach, status, the audit | any | nothing |
| kill, archive | the archive (r7 3.4, section 1) | no active record names the session after that |

**The classes.**

| Class | When |
| --- | --- |
| `ok` | D equals `@ao_launch`, and the launch is published or the record has no `launchId` |
| `pending` | D equals `@ao_launch` and the launch is `preparing`; or no D, an `associationIntent`, and `@ao_launch` is empty or its token |
| `stale` | D equals `@ao_launch` and the launch is `failed`; or D and `@ao_launch` differ; or no D and `@ao_launch` set (r4's "foreign token", shown with its fingerprint) |
| `legacy` | no D and `@ao_launch` empty (r4: unknown unless associated or asserted) |
| `unrecorded` | no active record names the session |

**Crashes.** A crash between a fence and the next record write changes `@ao_op` only, so the session keeps its
class. A crash after the launch record write and before the publish leaves D = T and `preparing`: a session
with T (a late bootstrap included) is `pending`, and `stale` after the failed mark. A session that a record
names is never `unrecorded`.

Output: one line for each session that is not `ok`, with the class, name, socket, pane PID and start time;
`ao status` shows the counts. The stop command is that of r7 5.4. API: `classifyRuntimeSessions({ records,
sessions })` in the new `core/src/retained-inventory.ts` (r4) returns `[{ socket, name, sessionId, state }]`.

## 6. Round claims (replaces the changed cells of r7 6)

| Round | Protects alone: the r7 text, with these changes | Does not protect: the r7 text, with these changes |
| --- | --- | --- |
| RW | add: a record archive appears under its final name only complete (temporary name, `fsync`, `link`); every write into `archive/` (the archive and an update of the latest archive) goes through a dot temporary name that no reader takes; no publication replaces or truncates a final name; an equal final name is kept and a different one stops the archive as damage; a stale temporary file is removed and never read. Replace "with every allow exact, scoped to one rule and checked at use" with: an allow of P1, P2 or P4 is refused before any step; each entry removes one rule's block for one process identity; its state is recorded at both checks and at admission; at admission every allowed process that lives is classified again with every rule | unchanged |
| R2b-2 | replace "on a running server, a create of an earlier holder, or one aimed at a server that stopped, starts no session after a later holder fenced the name" with: a create that carries the evidence of its own name fence (op, server PID and start time) starts no session after a later holder fenced the name, and none on another server; a guarded bootstrap starts no session on a server where a holder fenced the name; spawn, orchestrator spawn and restore fence before their launch record write, and their launch keys and cleanup kill are gated; a create without an operation runs no tmux command; the audit classifies each AO-form session by the durable launch token of its record | replace "a create that has to start the server (5.4, until R3a)" with: a creation prepared without a server identity that runs when no server runs, or on a successor server where no holder fenced the name (4, until R3a) |

## 7. Round plan and acceptance (changes to r7 7 and 8)

### 7.1 RW

- **Files**, in addition to r7 7: `core/src/metadata.ts` gets `publishArchive` in the archive branch of
  `deleteMetadata`, and the dot temporary name in `updateLatestArchive`.
- **Tests that must turn green**, in addition to r7 7: core r8 `(RW)`: 12 defects. Every control stays green:
  the 6 `(RW)` controls of core r8 and the changed control of core r7.
- **Add** (acceptance): each fault point (before any byte, the short copy, after the link, before the active
  unlink) recovered through each caller (`beginLaunch`, prune, `applyInbox`, a mutating command, barrier step
  3); the r8 file covers the short copy through 5 callers and the other 3 points through `recoverArchive`. Also:
  a link error; "archive damaged" through the CLI and through barrier step 3 (admission stays closed); each
  allowable rule with an owned fixture (P3: core r7; P1u with P3u, and P2u: core r8); the `allows` states in the
  barrier record; the admission step.
- **OD-29 (a), decided.** The RW round gives the race helper of core r5 (`same-id-defects-r5.test.ts:483`,
  `allow: (p) => p.rule === "P3"`, used by the three race tests at `:504`, `:508` and `:512`) and the two broad
  callbacks of core r6 (`:515` `allow: (p) => p.pid !== pid` and `:532` `allow: () => true`) a `processScope` of
  their fixture PIDs. It keeps all three race schedules and their refusal-then-admission assertions. Production
  P1, P2 and P4 stay non-allowable.

### 7.2 R2b-2

- **Files**, in addition to r7 7: `core/src/session-manager.ts` (spawn, `spawnOrchestrator` and restore, the
  order of 3), `core/src/types.ts` (`RuntimeCreateConfig.operation`), `core/src/metadata.ts` (`tmuxLaunchToken`
  in `LAUNCH_IDENTITY_KEYS`), `core/src/retained-inventory.ts` (`classifyRuntimeSessions`), and in
  `runtime-tmux/src/index.ts` the guarded bootstrap, the gated launch keys and cleanup, and the refusal without
  an operation.
- **Tests that must turn green**, in addition to r7 7: core r8 `(R2b-2)`: 9 defects; tmux r8: 5 defects; tmux r7:
  the 2 defects with the changed restart oracle. Every control stays green.
- **Add** (acceptance): the order of 3 for each caller through `createSessionManager` with a real
  private-server runtime (the r8 core tests use a mock runtime); spawn takes the next number when the lock of a
  candidate is held; a fence refusal; a kill that waits for a spawn and then refuses; the gated cleanup kill;
  the `-l` path of a long launch command; an association intent in the audit; the audit lines and the status
  counts.

### 7.3 The discriminators of M-3

Each line runs the named test files against the r8 prototypes with one flag that makes the partial fix of the
review (`/tmp/aosd8/scripts/val8.sh <mode>`; logs in 9.5):

| Partial fix | Mode | Fails | Passes |
| --- | --- | --- | --- |
| the create compares only the name option (no server PID or start time) | `tokenonly` | tmux r7 restart test (changed); tmux r8 wrong PID, wrong start time | the `fe5d6575` copy of tmux r7: 4 of 4 (the review's measurement) |
| the barrier that accepts allows of any rule (the r7 prototype) | `p1allow` | core r8: the forbidden allows, the expired states, the admission step, the callback control | core r7: 22 of 22 (the review's measurement) |
| the competing spawn ends with another error (a lock timeout) | `anyerror` | core r7 control (changed) | the `fe5d6575` copy of that control |
| a create without an operation runs today's create | `fallthrough` | tmux r8 no-operation test | - |
| a plain `new-session` when no server answered (r7 5.4) | `plainbootstrap` | tmux r8 late bootstrap; its bootstrap control (no name option) | - |
| launch keys without the `@ao_op` gate | `nokeysguard` | tmux r8 launch keys | - |

With no flag, every core file r5 to r8 and every tmux file r6 to r8 passes against the r8 prototypes (9.5).
The prototypes are scratch code: the runtime prototype passes no environment and has no cleanup kill, and the
patched session manager fences without an operation lock (no lock module exists yet). Green prototypes show
that the tests accept a correct form; they do not complete the acceptance lists of 7.1 and 7.2.

## 8. Owner decisions

OD-29 is decided (a) (7.1). No new decision.

## 9. Measurements

### 9.1 Environment and isolation

Linux 6.8.0, tmux 3.4, node and pnpm through the links in `/tmp/aosd8/nodebin` and `/tmp/aosd8/pnpmbin`.
Marker `/tmp/aosd8-marker`: 2026-10-22 09:03:53.58 EDT. Every `node`, `pnpm`, test and hook call ran under
`env -i` with `HOME` under `/tmp/aosd8` and no `AO_*` variable. The tmux measurements used the private server
`-L aosd8-n1` with `env -u TMUX` and `-f /dev/null`; the tmux tests use their own `-S` socket in a temporary
directory, and the test shim `bintest/tmux` runs `-L aosd8-T`. No `ao` call, no Herdr, no OpenCode, no network.

### 9.2 m1: the archive under faults (`/tmp/aosd8/scripts/m1_archive_publish.mjs`)

Points A to F as the script header says, for the r7 rule (a copy of the r7 prototype) and the r8 rule (the r8
prototype), on the real `metadata.js` of `fe5d6575`. `<ts>` stands for the intent's time stamp.

~~~text
== rule r7
A fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ []; recoverArchive: finished; end: latest {"launchId":"7767f9b7603cc842786ee00f345317ff","branch":"feat/kept-full-record"}, active false, temps 0
B fired true; archive threw injected EIO; then: latest {"launchId":"0"}, final 10 bytes, archive/ ["app-1_<ts>"]; recoverArchive: inbox damaged; end: latest {"launchId":"0"}, active true, temps 0, final kept unchanged true
B fired true; archive threw injected EIO; then: latest {"launchId":"4"}, final 10 bytes, archive/ ["app-1_<ts>"]; pruneInbox: []; end: latest {"launchId":"4"}, active true, temps 0, final kept unchanged true
B fired true; archive threw injected EIO; then: latest {"launchId":"c"}, final 10 bytes, archive/ ["app-1_<ts>"]; beginLaunch: refused: inbox damaged; end: latest {"launchId":"c"}, active true, temps 0, final kept unchanged true
B fired true; archive threw injected EIO; then: latest {"launchId":"5"}, final 10 bytes, archive/ ["app-1_<ts>"]; applyInbox: {"more":false}; end: latest {"launchId":"5"}, active true, temps 0, final kept unchanged true
B fired true; archive threw injected EIO; then: latest {"launchId":"a"}, final 10 bytes, archive/ ["app-1_<ts>"]; recoverInterruptedRecords: [{"sessionId":"app-1","result":"inbox damaged"}]; end: latest {"launchId":"a"}, active true, temps 0, final kept unchanged true
C fired true; archive threw injected EIO; then: latest {"launchId":"9a3b327c8af2fd1d1b56a797a96842e5","branch":"feat/kept-full-record"}, final 347 bytes, archive/ ["app-1_<ts>"]; recoverArchive: finished; end: latest {"launchId":"9a3b327c8af2fd1d1b56a797a96842e5","branch":"feat/kept-full-record"}, active false, temps 0, final kept unchanged false
D fired true; archive threw injected EIO; then: latest {"launchId":"73b56449d54d378220e8d0af84963623","branch":"feat/kept-full-record"}, final 347 bytes, archive/ ["app-1_<ts>"]; recoverArchive: finished; end: latest {"launchId":"73b56449d54d378220e8d0af84963623","branch":"feat/kept-full-record"}, active false, temps 0, final kept unchanged false
E recoverArchive: inbox damaged; end: latest {"launchId":"other","branch":"feat/other-committed-archive"}, active true, temps 0, conflicting archive unchanged true
F recoverArchive: finished; end: latest {"launchId":"6cdc4459363329a745da0f1439cdfb46","branch":"feat/kept-full-record"}, active false, temps 1
== rule r8
A fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; recoverArchive: finished; end: latest {"launchId":"c2d6276ac81023e5526de9116189497d","branch":"feat/kept-full-record"}, active false, temps 0
B fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; recoverArchive: finished; end: latest {"launchId":"9a9641e8ec9dd5255e152287e5fe0854","branch":"feat/kept-full-record"}, active false, temps 0
B fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; pruneInbox: []; end: latest {"launchId":"fda9b205d24d03b176356f48b749c2cc","branch":"feat/kept-full-record"}, active false, temps 0
B fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; beginLaunch: began cf8521e4; end: latest {"launchId":"815d8c4cdf71c5838887c634410985d5","branch":"feat/kept-full-record"}, active true, temps 0
B fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; applyInbox: {"more":false,"archive":"finished"}; end: latest {"launchId":"8af05a7b6283bf05b95d4179ee0be5d7","branch":"feat/kept-full-record"}, active false, temps 0
B fired true; archive threw injected EIO; then: latest null, final 0 bytes, archive/ [".app-1_<ts>.tmp-*"]; recoverInterruptedRecords: [{"sessionId":"app-1","result":"finished"}]; end: latest {"launchId":"4ae94850f98e6223510be17d8fa1a60b","branch":"feat/kept-full-record"}, active false, temps 0
C fired true; archive threw injected EIO; then: latest {"launchId":"9dc835656107c5c0106fee1e38f1b029","branch":"feat/kept-full-record"}, final 347 bytes, archive/ [".app-1_<ts>.tmp-*","app-1_<ts>"]; recoverArchive: finished; end: latest {"launchId":"9dc835656107c5c0106fee1e38f1b029","branch":"feat/kept-full-record"}, active false, temps 0, final kept unchanged true
D fired true; archive threw injected EIO; then: latest {"launchId":"d9644543ed8c0e5f04395c58536e538d","branch":"feat/kept-full-record"}, final 347 bytes, archive/ ["app-1_<ts>"]; recoverArchive: finished; end: latest {"launchId":"d9644543ed8c0e5f04395c58536e538d","branch":"feat/kept-full-record"}, active false, temps 0, final kept unchanged true
E recoverArchive: archive damaged; end: latest {"launchId":"other","branch":"feat/other-committed-archive"}, active true, temps 0, conflicting archive unchanged true
F recoverArchive: finished; end: latest {"launchId":"c8ce27d9173ca20c662d292e0b7edc30","branch":"feat/kept-full-record"}, active false, temps 0
~~~

The r7 rule fails at B for every caller, and at C and D it writes an equal final file again ("kept unchanged
false"), against its own text. F leaves the temporary file. The r8 rule finishes B through every caller (for
`beginLaunch` it then begins the new launch), keeps C and D unchanged, refuses E as "archive damaged" and
removes the temporary file of F.

### 9.3 m2: the creation fence on a private server (`/tmp/aosd8/scripts/m2_bootstrap_fence.sh`)

~~~text
== a. the guarded bootstrap with no server
server running before: no
bootstrap: ao-created:3022900/1792674867
server running yes, session exists yes, name option [op0], session: cccccccccccc-app-1 launch=[T0] op=[op0]
== b. the schedule of the review: H0 prepared with no server; H1 starts a server and fences; H0 runs late
H0 observation: server running no
H1 fence: ao-name-fenced:3022926
H0 late guarded bootstrap (design r8): ao-create-refused:3022926/1792674867/op1 | session exists no
H0 late plain create (design r7 5.4):  exit 0 | session exists yes | cccccccccccc-app-1 launch=[] op=[]
== c. the guarded create with wrong evidence (server 3022926/1792674867; the name option is op1)
wrong PID 3022927/1792674867: ao-create-refused:3022926/1792674867/op1 | exists no
wrong start time 3022926/1792674866: ao-create-refused:3022926/1792674867/op1 | exists no
correct 3022926/1792674867: ao-created:3022926 | exists yes
successor server 3022985/1792674868 with the old name option op1 restored:
  the guarded create of the old server 3022926/1792674867: ao-create-refused:3022985/1792674868/op1 | exists no
  the token-only partial fix: ao-created:3022985 | exists yes
== e. the options that the audit reads
healthy create of holder opH: ao-created:3022985 | cccccccccccc-app-1 launch=[TH] op=[opH]
after the session fence of opX and no record write: cccccccccccc-app-1 launch=[TH] op=[opX]
== d. 40 pairs of competing guarded bootstraps
pairs with exactly one created answer: 40 of 40
== f. the residual: H0's guarded bootstrap runs when no server runs, or on a successor where nobody fenced
no server: ao-created:3024177/1792674873 | exists yes | cccccccccccc-app-1 launch=[T0] op=[op0]
successor server, name not fenced: ao-created:3024197/1792674873 | exists yes
socket left no; server processes left: none
~~~

### 9.4 m3: the creation callers on `main` `46f0940c` (`/tmp/aosd8/scripts/m3_creation_callers.sh`)

~~~text
main = 46f0940c
packages/core/src/index.ts:45:  newSession as newTmuxSession,
packages/core/src/session-manager.ts:2254:      handle = await plugins.runtime.create({
packages/core/src/session-manager.ts:2817:      handle = await plugins.runtime.create({
packages/core/src/session-manager.ts:4524:    const handle = await plugins.runtime.create({
packages/core/src/tmux.ts:129:export async function newSession(opts: NewSessionOptions): Promise<void> {
packages/core/src/tmux.ts:134:  const args = ["new-session", "-d", "-s", opts.name, "-c", opts.cwd];
packages/core/src/types.ts:380:/** Opaque handle returned by runtime.create() */
packages/integration-tests/src/helpers/tmux.ts:55:  const args = ["new-session", "-d", "-s", name, "-x", "200", "-y", "50"];
packages/plugins/runtime-tmux/src/index.ts:132:        ["new-session", "-d", "-s", sessionName, "-c", config.workspacePath, ...envArgs],
== the create calls of core session-manager.ts and the function that holds each
2254: spawn
2817: spawnOrchestrator
4524: restore
~~~

### 9.5 The tests against the r8 prototypes, and the discriminators (`/tmp/aosd8/scripts/val8.sh`)

No flag (exit 0):

~~~text
== core r8 against the r8 prototypes
Tests  29 passed (29)
== core r7 against the r8 prototypes
✓ control: a prune that waited for the launch transaction ends and removes nothing 
✓ control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing 
Tests  22 passed (22)
== core r6 against the r8 prototypes
Tests  8 passed (8)
== core r5 against the r8 prototypes
Tests  10 passed (10)
== runtime-tmux r6 against assoc-proto.ts (the session fence, unchanged)
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the held clear of a killed holder does not remove the token that the next holder published 
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > the first tmux call of a killed holder, held in a shell shim, changes nothing after the next holder 
✓ [same-id R2] (R2b-2) B-2: a shell-shim tmux client of a killed holder (real tmux) > control: a held clear that runs before its holder is killed leaves tmux and the record in agreement 
Tests  4 passed (4)
== runtime-tmux r8 against runtime-proto.ts (the r8 creation fence)
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name 
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the held launch keys of a killed holder do not reach a session that the next holder fenced 
Tests  7 passed (7)
== runtime-tmux r7 against runtime-proto.ts (the r8 creation fence)
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > the held create of a killed holder starts no session on a server that started after its fence 
Tests  4 passed (4)
~~~

`tokenonly`:

~~~text
== runtime-tmux r8, the compare names only the name option (review r7 M-3)
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > a create without an operation does not fall through to a plain create on a running server where the name is fenced
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name 
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the held launch keys of a killed holder do not reach a session that the next holder fenced 
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > control: a bootstrap create with no server starts the server and its session
× [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server PID is refused
→ production (runtime-tmux fenceName): server 3421383/1792676160, evidence {"pid":"3421384","startTime":"1792676160"}, fence {"fenced":true,"server":{"pid":"3421383","startTime":"1792676160"}}; the create created; session exists true: expected true to be fal
× [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server start time is refused
→ production (runtime-tmux fenceName): server 3421412/1792676160, evidence {"pid":"3421412","startTime":"1792676159"}, fence {"fenced":true,"server":{"pid":"3421412","startTime":"1792676160"}}; the create created; session exists true: expected true to be fal
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > control: a create with the evidence of its own fence creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: production (runtime-tmux fenceName): server 3421383/1792676160, evidence {"pid":"3421384","startTime":"1792676160"}, fence {"fenced":true,"server":{"pid":"3421383","startTime":"1792676160"}}; the create created; session exists true: expected tr
AssertionError: production (runtime-tmux fenceName): server 3421412/1792676160, evidence {"pid":"3421412","startTime":"1792676159"}, fence {"fenced":true,"server":{"pid":"3421412","startTime":"1792676160"}}; the create created; session exists true: expected tr
Tests  2 failed | 5 passed (7)
== runtime-tmux r7, the compare names only the name option (review r7 M-3)
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > control: the held create is a shell-shim client whose argv names new-session and the session
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > the held create of a killed holder starts no session after the next holder fenced the name
× [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > the held create of a killed holder starts no session on a server that started after its fence
→ production (runtime-tmux fenceName): server 3426410/1792676162 then 3426965/1792676162; the held call answered "ao-created:3426965"; session exists true: expected true to be false // Object.is equality
✓ [same-id R2] (R2b-2) OD-28 (b): the held create of a killed holder (real tmux) > control: a holder that is not superseded creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: production (runtime-tmux fenceName): server 3426410/1792676162 then 3426965/1792676162; the held call answered "ao-created:3426965"; session exists true: expected true to be false // Object.is equality
Tests  1 failed | 3 passed (4)
== runtime-tmux r7-fe5d6575, the compare names only the name option (review r7 M-3)
Tests  4 passed (4)
~~~

`p1allow`:

~~~text
== core r8 against the r7 barrier prototype (it takes P1 allows, review r7 M-3)
✓ control: a fault before any byte of the copy leaves no record archive, and the recovery finishes
✓ control: a fault after publication leaves a complete record archive that the recovery keeps unchanged
✓ control: a fault before the active unlink leaves a complete record archive that the recovery keeps unchanged
✓ control: a conflicting complete archive under the final name is damage and stays unchanged
✓ spawn fences the tmux name before it reserves the record, and creates with that operation
✓ orchestrator spawn fences the tmux name before its record write, and creates with that operation
✓ restore fences the tmux name before the record write of its launch, and creates with that operation
✓ control: no production module creates a tmux session through the raw core helper
× an allow for P1, P2 or P4 is refused, whatever its PID and start ticks
✓ an unreadable process blocks by P1u and by P3u, and only both allows admit it
✓ a P2u allow of a tmux server that no path reaches admits only that server
× an allow whose process ends after check 1 is reported as expired at check 2 and at admission
× an allowed process that opens a record after check 2 blocks at admission
× control: the allow callback of the r5 and r6 tests cannot allow P1
✓ control: a process that the test scope leaves out does not block (the scope is not an allow)
✓ a session whose fence was interrupted before any record write keeps its state
✓ a late bootstrap pane of a launch that was marked failed is stale
✓ control: a late bootstrap pane that no record names is unrecorded
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: barrier: production fleet-barrier; accepted: {"pid":3726215,"startTicks":"16981690","rule":"P1"} answered {"admitted":false,"blocking":[{"pid":3726215,"rule":"P3","comm":"node-MainThread"}]}; {"pid":1,"startTicks":"1","rule":"P1"} answered {"ad
AssertionError: barrier: production fleet-barrier; pid 3726232: {"admitted":true,"blocking":[]}: expected undefined to deeply equal [ { pid: 3726232, …(5) } ]
AssertionError: barrier: production fleet-barrier; pid 3726239, record opened true: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality
AssertionError: barrier: production fleet-barrier; pid 3726246: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality
Tests  4 failed | 25 passed (29)
== core r7 against the r7 barrier prototype (it takes P1 allows, review r7 M-3)
✓ control: a prune that waited for the launch transaction ends and removes nothing 
✓ control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing 
Tests  22 passed (22)
~~~

`anyerror`:

~~~text
== core r7, a spawn of a taken ID refuses with a lock timeout
↓ control: a fault before the record is published leaves no record and no launch file
↓ a fault after the link that published the record keeps the launch file that the record names
↓ a fault in the cleanup of the temporary record file keeps the launch file that the record names
↓ a re-read that cannot read the record keeps the launch file and refuses as unknown
↓ the latest archive of an ID is its record after the archive of a launch
↓ the archived record of a launch takes an update
↓ a restore of an archived launch copies the record back with a new launch
↓ two archives of one ID in the same millisecond keep both records and both inboxes under exact names
↓ control: the recovery of a pre-RW archive intent leaves a readable record archive
↓ a publish writes the records that its budget read and their cursor in one record write
↓ control: a prune that waited for the launch transaction ends and removes nothing
× control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing
↓ the barrier finds an AO-named pane on a server with another TMUX_TMPDIR and no -S
↓ the barrier keeps admission closed for a tmux server whose socket it cannot resolve
↓ the barrier finds a node process whose executable was unlinked
↓ the barrier blocks a process whose AO_* keys name a state root that it does not cover
↓ the barrier blocks a process whose environment and exe cannot be read (OD-27 (b))
↓ the barrier finds a JS runtime that starts after its last check read the process list
↓ an allow of a JS runtime for rule P3 does not cover its AO environment
↓ control: an allow with other start ticks does not admit a JS runtime
↓ control: an exact P3 allow admits a JS runtime that matches no other rule
↓ control: a server with another TMUX_TMPDIR and no AO-named session does not block
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: inbox: production inbox, B: {"error":"the record lock was not free in time"}: expected 'the record lock was not free in time' to match /\bis taken\b/
Tests  1 failed | 21 skipped (22)
== core r7-fe5d6575, a spawn of a taken ID refuses with a lock timeout
✓ control: a spawn of the same ID that waited for the launch transaction refuses and archives nothing 
Tests  1 passed | 21 skipped (22)
~~~

`fallthrough`:

~~~text
== runtime-tmux r8, a create without an operation runs the create of today
× [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > a create without an operation does not fall through to a plain create on a running server where the name is fenced
→ production (runtime-tmux fenceName): next holder ao-name-fenced:3521411; the create created; session exists true: expected true to be false // Object.is equality
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name 
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the held launch keys of a killed holder do not reach a session that the next holder fenced 
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > control: a bootstrap create with no server starts the server and its session
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server PID is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server start time is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > control: a create with the evidence of its own fence creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: production (runtime-tmux fenceName): next holder ao-name-fenced:3521411; the create created; session exists true: expected true to be false // Object.is equality
Tests  1 failed | 6 passed (7)
~~~

`plainbootstrap`:

~~~text
== runtime-tmux r8 with the prototype flag plainbootstrap
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > a create without an operation does not fall through to a plain create on a running server where the name is fenced
× [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name
→ production (runtime-tmux fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-qDCBNJ/held/tmux","new-session","-d","-s","e8f71a3d17b8-app-54f0","-c","/tmp/aosd8/tmp/ao-same-id-r8-tmux-qDCBNJ",";","set-option","-t","=e8f71a3d17b8-app-54f0:","@ao_op","5
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the held launch keys of a killed holder do not reach a session that the next holder fenced 
× [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > control: a bootstrap create with no server starts the server and its session
→ production (runtime-tmux fenceName): 930692065660-app-2c45: expected '' to be 'e1cd1c8aaa0348c3' // Object.is equality
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server PID is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server start time is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > control: a create with the evidence of its own fence creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: production (runtime-tmux fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-qDCBNJ/held/tmux","new-session","-d","-s","e8f71a3d17b8-app-54f0","-c","/tmp/aosd8/tmp/ao-same-id-r8-tmux-qDCBNJ",";","set-option","-t","=e8f71a3d17b8-app-54f0:"
AssertionError: production (runtime-tmux fenceName): 930692065660-app-2c45: expected '' to be 'e1cd1c8aaa0348c3' // Object.is equality
Tests  2 failed | 5 passed (7)
~~~

`nokeysguard`:

~~~text
== runtime-tmux r8 with the prototype flag nokeysguard
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > a create without an operation does not fall through to a plain create on a running server where the name is fenced
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name 
× [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > the held launch keys of a killed holder do not reach a session that the next holder fenced
→ production (runtime-tmux fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-IEVRbo/held/tmux","send-keys","-t","=18a40df908bf-app-17cc:","sleep 600","Enter"]; next holder ao-fenced:3523468; the held call answered ""; pane runs sleep: expected 'sleep
✓ [same-id R2] (R2b-2) M-2: a managed create and its fence (real tmux) > control: a bootstrap create with no server starts the server and its session
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server PID is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > a create whose evidence names another server start time is refused
✓ [same-id R2] (R2b-2) M-3: the server identity in the guarded create (real tmux) > control: a create with the evidence of its own fence creates its session
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
AssertionError: production (runtime-tmux fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-IEVRbo/held/tmux","send-keys","-t","=18a40df908bf-app-17cc:","sleep 600","Enter"]; next holder ao-fenced:3523468; the held call answered ""; pane runs sleep: exp
Tests  1 failed | 6 passed (7)
~~~

## 10. Tests of this round

Commits: `3b5aae09` (the two r8 files), `57d04dc8` (the r7 oracles), `28bc2457` (the message of the
forbidden-allow test), `48c26129` (the archive-update defect, and the short-copy fault writes the first bytes of
the data of the faulted write). Each `defect` is `it.fails` and runs as a plain test with `SAME_ID_DEFECTS=red`. The
failures below are the red runs on the tip; the code under test is that of `fe5d6575`.

### 10.1 `packages/core/src/__tests__/same-id-defects-r8.test.ts` (new)

The tests load the production module when its source exists (`../inbox.ts`, `../fleet-barrier.ts`,
`../retained-inventory.ts`, the runtime method `fenceName`). Until then they run a model of the previous design
text: design r7 for the inbox and the audit, the design r6 barrier model of the r7 file. The M-2 tests run the
real `createSessionManager` with the mock runtime of `test-utils.ts` and a `fenceName` spy; `execFile` fails in
them, so no git, gh, ps or tmux runs. The barrier tests start their own fixtures and give the barrier a
`processScope` of those PIDs.

Describes: `[same-id R3] (RW) M-1` (tests 1 to 11), `[same-id R2] (R2b-2) M-2` (12 to 15),
`[same-id R3] (RW) M-3` (16 to 22), `[same-id R2] (R2b-2) m-1` (23 to 29).

| Test | Kind on `fe5d6575` |
| --- | --- |
| control: a fault before any byte of the copy leaves no record archive, and the recovery finishes | control |
| a short copy of the record archive is never read as a record, and recoverArchive finishes the archive | defect |
| a short copy of the record archive is never read as a record, and pruneInbox finishes the archive | defect |
| a short copy of the record archive is never read as a record, and applyInbox finishes the archive | defect |
| a short copy of the record archive is never read as a record, and recoverInterruptedRecords finishes the archive | defect |
| a short copy of the record archive is never read as a record, and beginLaunch (a spawn of the same ID) finishes the archive | defect |
| control: a fault after publication leaves a complete record archive that the recovery keeps unchanged | control |
| control: a fault before the active unlink leaves a complete record archive that the recovery keeps unchanged | control |
| control: a conflicting complete archive under the final name is damage and stays unchanged | control |
| a temporary archive file of a dead archiver is removed and never read | defect |
| a short write of an update of the latest archive is never read as the latest archive | defect |
| spawn fences the tmux name before it reserves the record, and creates with that operation | defect |
| orchestrator spawn fences the tmux name before its record write, and creates with that operation | defect |
| restore fences the tmux name before the record write of its launch, and creates with that operation | defect |
| control: no production module creates a tmux session through the raw core helper | control |
| an allow for P1, P2 or P4 is refused, whatever its PID and start ticks | defect |
| an unreadable process blocks by P1u and by P3u, and only both allows admit it | defect |
| a P2u allow of a tmux server that no path reaches admits only that server | defect |
| an allow whose process ends after check 1 is reported as expired at check 2 and at admission | defect |
| an allowed process that opens a record after check 2 blocks at admission | defect |
| control: the allow callback of the r5 and r6 tests cannot allow P1 | control |
| control: a process that the test scope leaves out does not block (the scope is not an allow) | control |
| a healthy session of a launch is ok | defect |
| a healthy associated legacy session is ok | defect |
| a legacy session is legacy, not unrecorded | defect |
| a session whose fence was interrupted before any record write keeps its state | defect |
| a session of a launch that is still preparing is pending, not unrecorded | defect |
| a late bootstrap pane of a launch that was marked failed is stale | defect |
| control: a late bootstrap pane that no record names is unrecorded | control |

Failures (red mode, first line):

~~~text
a short copy of the record archive is never read as a record, and recoverArchive finishes the archive
  AssertionError: inbox: design r7 model (no inbox.ts); archive threw injected EIO (short copy); {"latest":{"launchId":"a"},"caller":"recoverArchive","result":"inbox damaged","after":{"launchId":"a"},"temps":[]}: expected { launchId: 'a' } to be null

a short copy of the record archive is never read as a record, and pruneInbox finishes the archive
  AssertionError: inbox: design r7 model (no inbox.ts); archive threw injected EIO (short copy); {"latest":{"launchId":"6"},"caller":"pruneInbox","result":[],"after":{"launchId":"6"},"temps":[]}: expected { launchId: '6' } to be null

a short copy of the record archive is never read as a record, and applyInbox finishes the archive
  AssertionError: inbox: design r7 model (no inbox.ts); archive threw injected EIO (short copy); {"latest":{"launchId":"1"},"caller":"applyInbox","result":{"archive":"inbox damaged"},"after":{"launchId":"1"},"temps":[]}: expected { launchId: '1' } to be null

a short copy of the record archive is never read as a record, and recoverInterruptedRecords finishes the archive
  AssertionError: inbox: design r7 model (no inbox.ts); archive threw injected EIO (short copy); {"latest":{"launchId":"d"},"caller":"recoverInterruptedRecords","result":[{"sessionId":"app-1","result":"inbox damaged"}],"after":{"launchId":"d"},"temps":[]}: expected { launchId: 'd' } to be null

a short copy of the record archive is never read as a record, and beginLaunch (a spawn of the same ID) finishes the archive
  AssertionError: inbox: design r7 model (no inbox.ts); archive threw injected EIO (short copy); {"latest":{"launchId":"e"},"caller":"beginLaunch (a spawn of the same ID)","result":"refused: inbox damaged","after":{"launchId":"e"},"temps":[]}: expected { launchId: 'e' } to be null

a temporary archive file of a dead archiver is removed and never read
  AssertionError: inbox: design r7 model (no inbox.ts); result finished; archive/ [".app-1_2026-10-22T13-56-10-166Z.tmp-999999-0dead0","app-1_2026-10-22T13-56-10-166Z"]: expected [ Array(1) ] to deeply equal []

a short write of an update of the latest archive is never read as the latest archive
  AssertionError: inbox: design r7 model (no inbox.ts); update threw injected EIO (short copy); archive/ ["app-1_2026-10-22T13-55-10-194Z","app-1_2026-10-22T13-55-10-194Z.tmp.3766763.1792677310197"]; after {"launchId":"4"}: expected [ …(2) ] to have a length of 1 but got 2

spawn fences the tmux name before it reserves the record, and creates with that operation
  AssertionError: fenceName calls []; create configs [{"sessionId":"456beaf578df-app-1"}]: expected +0 to be 1 // Object.is equality

orchestrator spawn fences the tmux name before its record write, and creates with that operation
  AssertionError: fenceName calls []; create configs [{"sessionId":"3c1823cf7568-app-orchestrator"}]: expected +0 to be 1 // Object.is equality

restore fences the tmux name before the record write of its launch, and creates with that operation
  AssertionError: fenceName calls []; create configs [{"sessionId":"hash-app-1"}]: expected +0 to be 1 // Object.is equality

an allow for P1, P2 or P4 is refused, whatever its PID and start ticks
  AssertionError: barrier: design r6 model of the r7 file (no fleet-barrier.ts); accepted: {"pid":3766852,"startTicks":"16996511","rule":"P1"} answered {"admitted":true,"blocking":[]}; {"pid":1,"startTicks":"1","rule":"P1"} answered {"admitted":false,"blocking":[{"pid":3766852,"rule":"P1"},{"pid":3766852,"rule":"P3"}]}; {"pid":3766852,"startTicks":"16996511","rule":"P2"} answered {"admitted":true,"blocking":[]}; {"pid":1,"startTicks":"1","rule":"P2"} answered {"admitted":false,"blocking":[{"pid":3766852,"rule":"P1"},{"pid":3766852,"rule":"P3"}]}; {"pid":3766852,"startTicks":"16996511","rule":"P4"} answered {"admitted":true,"blocking":[]}; {"pid":1,"startTicks":"1","rule":"P4"} answered {"admitted":false,"blocking":[{"pid":3766852,"rule":"P1"},{"pid":3766852,"rule":"P3"}]}: expected [ …(6) ] to deeply equal []

an unreadable process blocks by P1u and by P3u, and only both allows admit it
  AssertionError: barrier: design r6 model of the r7 file (no fleet-barrier.ts); pid 3766859: none {"admitted":true,"blocking":[]}; P1u {"admitted":true,"blocking":[]}; P3u {"admitted":true,"blocking":[]}; both {"admitted":true,"blocking":[]}: expected false to be true // Object.is equality

a P2u allow of a tmux server that no path reaches admits only that server
  AssertionError: barrier: design r6 model of the r7 file (no fleet-barrier.ts); server 3766862, removed socket: none {"admitted":true,"blocking":[]}; allowed {"admitted":true,"blocking":[]}: expected false to be true // Object.is equality

an allow whose process ends after check 1 is reported as expired at check 2 and at admission
  AssertionError: barrier: design r6 model of the r7 file (no fleet-barrier.ts); pid 3766866: {"admitted":true,"blocking":[]}: expected undefined to deeply equal [ { pid: 3766866, …(5) } ]

an allowed process that opens a record after check 2 blocks at admission
  AssertionError: barrier: design r6 model of the r7 file (no fleet-barrier.ts); pid 3766873, record opened true: {"admitted":true,"blocking":[]}: expected true to be false // Object.is equality

a healthy session of a launch is ok
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'ok' // Object.is equality

a healthy associated legacy session is ok
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'ok' // Object.is equality

a legacy session is legacy, not unrecorded
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'legacy' // Object.is equality

a session whose fence was interrupted before any record write keeps its state
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'ok' // Object.is equality

a session of a launch that is still preparing is pending, not unrecorded
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'pending' // Object.is equality

a late bootstrap pane of a launch that was marked failed is stale
  AssertionError: audit: design r7 model (no retained-inventory.ts): [{"socket":"/tmp/tmux-1000/default","name":"0123456789ab-app-1","sessionId":"app-1","state":"unrecorded"}]: expected 'unrecorded' to be 'stale' // Object.is equality
~~~

The forbidden-allow message lists each entry that the barrier took without the refusal; the r6 model admits the
process for each exact entry, whatever its rule.

### 10.2 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r8.test.ts` (new, real tmux)

Each test uses a private server at its own `-S` socket. The held call of a killed holder is a `/bin/sh` shim
client that waits for a release file. The next holder runs the tmux commands of the design itself
(`nameFence`, `sessionFence`), so the tests do not need production code for that holder. Until runtime-tmux has
`fenceName`, the old holder runs today's create.

| Test | Kind on `fe5d6575` |
| --- | --- |
| a create without an operation does not fall through to a plain create on a running server where the name is fenced | defect |
| the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name | defect |
| the held launch keys of a killed holder do not reach a session that the next holder fenced | defect |
| control: a bootstrap create with no server starts the server and its session | control |
| a create whose evidence names another server PID is refused | defect |
| a create whose evidence names another server start time is refused | defect |
| control: a create with the evidence of its own fence creates its session | control |

~~~text
a create without an operation does not fall through to a plain create on a running server where the name is fenced
  AssertionError: today's create (runtime-tmux has no fenceName): next holder ao-name-fenced:3770386; the create created; session exists true: expected true to be false // Object.is equality

the late bootstrap create of a holder that found no server starts no session on a server where the next holder fenced the name
  AssertionError: today's create (runtime-tmux has no fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-PGmdd5/held/tmux","new-session","-d","-s","d9bbd08432e9-app-e603","-c","/tmp/aosd8/tmp/ao-same-id-r8-tmux-PGmdd5"]; next holder ao-name-fenced:3770428; the held call answered ""; session exists true: expected true to be false // Object.is equality

the held launch keys of a killed holder do not reach a session that the next holder fenced
  AssertionError: today's create (runtime-tmux has no fenceName): held argv ["/tmp/aosd8/tmp/ao-same-id-r8-tmux-PGmdd5/held/tmux","send-keys","-t","=87f4fdab9b19-app-bbea:","sleep 600","Enter"]; next holder ao-fenced:3770457; the held call answered ""; pane runs sleep: expected 'sleep' not to be 'sleep' // Object.is equality

a create whose evidence names another server PID is refused
  AssertionError: today's create (runtime-tmux has no fenceName): server 3770521/1792677323, evidence {"pid":"3770522","startTime":"1792677323"}, fence ao-name-fenced:3770521; the create created; session exists true: expected true to be false // Object.is equality

a create whose evidence names another server start time is refused
  AssertionError: today's create (runtime-tmux has no fenceName): server 3770550/1792677323, evidence {"pid":"3770550","startTime":"1792677322"}, fence ao-name-fenced:3770550; the create created; session exists true: expected true to be false // Object.is equality
~~~

### 10.3 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts` (changed, `57d04dc8`)

What: the held create of `heldCreateOfKilledHolder` now carries a random operation; the restart test sets the
old holder's name option (`set-option -s @ao_name_<k> <op>`) on the new server before it releases the held
create; both held-create tests need the marker `ao-create-refused` in the held call's answer. Why: review r7
M-3 measured that a compare of the name option alone passed the old test, because the new server had no name
option. Now only the server PID and start time can refuse it (7.3, `tokenonly`). The two defects stay red on
`fe5d6575` for the same reason as in r7:

~~~text
the held create of a killed holder starts no session after the next holder fenced the name
  AssertionError: design r6 model (runtime-tmux has no fenceName): held client argv[0] /bin/sh, exe /usr/bin/dash; next holder no name fence (design r6); the held call answered ""; session exists true: expected true to be false // Object.is equality

the held create of a killed holder starts no session on a server that started after its fence
  AssertionError: design r6 model (runtime-tmux has no fenceName): server 3772478/1792677328 then 3772543/1792677329; the held call answered ""; session exists true: expected true to be false // Object.is equality
~~~

### 10.4 `packages/core/src/__tests__/same-id-defects-r7.test.ts` (changed, `57d04dc8`)

What: the control "a spawn of the same ID that waited for the launch transaction refuses and archives nothing"
needs `result.error` to match `/\bis taken\b/`, not any error. Why: review r7 M-3; a timeout or an unrelated
failure passed (7.3, `anyerror`). It stays a control: the r6 model refuses with "the ID is taken", and the r8
inbox with "the ID <id> is taken" (r7 3.2 step 2). The other 21 tests are unchanged; 15 defects and 7 controls,
as on `fe5d6575`.

### 10.5 Red counts (`/tmp/aosd8/scripts/redcount.sh`, at `48c26129`)

Against the counts on `fe5d6575` (`/tmp/aosd7/logs/redcount-fe5d6575.out`), `diff` gives only the two new files:

~~~text
7a8
> packages/core/src/__tests__/same-id-defects-r8.test.ts: R2 (R2b-2) 9 failed/2 passed, R3 (RW) 12 failed/6 passed
22a24
> packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r8.test.ts: R2 (R2b-2) 5 failed/2 passed
~~~

All files:

~~~text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects-r4.test.ts: R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/3 passed
packages/core/src/__tests__/same-id-defects-r5.test.ts: R3 (RW) 5 failed/5 passed
packages/core/src/__tests__/same-id-defects-r6.test.ts: R3 (RW) 5 failed/3 passed
packages/core/src/__tests__/same-id-defects-r7.test.ts: R3 (RW) 15 failed/7 passed
packages/core/src/__tests__/same-id-defects-r8.test.ts: R2 (R2b-2) 9 failed/2 passed, R3 (RW) 12 failed/6 passed
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
packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r8.test.ts: R2 (R2b-2) 5 failed/2 passed
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
~~~

### 10.6 Normal mode and the full run

Normal mode: core r8 `8 passed | 21 expected fail (29)`; core r7 `7 passed | 15 expected fail (22)`; tmux r8
`7 passed (7)`; tmux r7 `4 passed (4)` (runtime-tmux has vitest 3.2.4, which counts a failing `it.fails` as
passed). `pnpm typecheck` and `pnpm lint` (0 errors, the 5 warnings of `fe5d6575`) before each commit.

`pnpm -r --no-bail test` at `48c26129` under `env -i` (exit 0; earlier runs at `57d04dc8` and `28bc2457` gave
core 1430 and 70 with the 28 tests of core r8 then, and the same counts for every other package):

~~~text
packages/core test:       Tests  1430 passed | 71 expected fail (1501)
packages/plugins/agent-gemini test:       Tests  67 passed (67)
packages/plugins/agent-codex test:       Tests  220 passed (220)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:       Tests  49 passed (49)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/workspace-worktree test:       Tests  72 passed (72)
packages/plugins/runtime-tmux test:       Tests  127 passed (127)
packages/plugins/agent-opencode test:       Tests  322 passed (322)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:       Tests  269 passed (269)
exit 0
~~~

Against `fe5d6575`: core 1422 passed and 50 expected fail before, now 1430 and 71 (the 8 controls and 21
defects of core r8); runtime-tmux 120 before, now 127 (the 7 tests of tmux r8); every other package unchanged.

## 11. Section 0 evidence (at the end of the round)

Marker `/tmp/aosd8-marker`: 2026-10-22 09:03:53.58 EDT. Checked at 09:56 EDT, after the last test run.

`find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosd8-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'`
(exit 0):

~~~text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-55
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-52
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
~~~

Each entry, with its time (`stat`) and its writer. None is mine: every process of this round ran under `env -i`
with `HOME` under `/tmp/aosd8` and no `AO_*` variable, no script names the real state root, and I ran no `ao`.

| Entry | Time (EDT) | Writer |
| --- | --- | --- |
| `sessions/ao-52` | 09:03:54.45 | the dispatch of this brief by the real orchestrator, 0.9 s after the marker (the record keys, read with `cut -d= -f1`, include `promptDelivered`; values not read) |
| `sessions/ao-55` | 09:49:25.46 | the real session `ao-55` (R4) and its lifecycle |
| `sessions/ao-orchestrator` | 09:45:25.36 | the real orchestrator `60756641ca25-ao-orchestrator` and its lifecycle |
| `sessions` | 09:49:25.46 | the record writes above: a record write renames a temporary file in this directory |

My processes (`python3 -I /tmp/aosd8/scripts/sec0_procs.py`: argv that names `/tmp/aosd8` or `aosd8-`, a cwd or
exe under `/tmp/aosd8`, or `HOME=/tmp/aosd8...`; the scan and its ancestors excluded; it prints only matches):

~~~text
processes of uid 44402 that are mine (excluding this scan and its 5 ancestors): 0
~~~

No PID of the 45 in `/tmp/aosd8/logs/pids.txt` (the m2 servers) lives. No socket exists under `/tmp/aosd8`. In
`/tmp/tmux-44402/` no `aosd8` socket remains: the test shim left `aosd8-T` (09:38:09, no server:
`no server running on /tmp/tmux-44402/aosd8-T`), and I removed it after that query. The other sockets there are
not mine and stay. The full run at `48c26129` made `aosd8-T` again (09:54:09, no server); I removed it after
the same query.

`ls -la --time-style=full-iso ~/.ao/bin`, before (09:04) and after (09:56), the same (`diff` prints nothing):

~~~text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
~~~

The real lifecycle workers, from their pid files (`cat`) and `ps -o pid=,lstart=,comm=` (read only):

~~~text
2002324 Thu Oct 22 07:46:21 2026 node-MainThread
2002831 Thu Oct 22 07:46:24 2026 node-MainThread
~~~

No process scan of this round signalled, stopped or waited on a process that is not mine, or printed an
environment value of one. The branch: `git branch -r --contains HEAD` prints nothing; HEAD is `48c26129` on
`fe5d6575`; no push, no PR, no stash, no rebase, no amend.

## 12. Unclear or changed during the round

- `main` moved from `10039dd8` to `46f0940c` during the round. R4 landed in it (`193d2c9e`, with the R4 fix
  commits from `32c687b2` to `3cc358e2`); the other commits are docs. This file cites `46f0940c`; the branch of
  the tests stays on `fe5d6575`, as the brief says. R4's strict readers take the same archive names as before
  (section 1), and the spawn recheck uses R4's allocation reader (section 3).
- The R4 landing made me read the archive writers of `main` again. The update of the latest archive has its
  temporary name in the reader namespace (section 1). It is the M-1 failure through a second writer, so it is
  in M-1 with its own defect (`48c26129`).
- `28bc2457` and `48c26129` came after the first full run. The full run ran again at `48c26129`.
- The review names worker spawn and orchestrator spawn for M-2; the brief adds restore. Section 3 and the core
  r8 tests cover all three.
- The review asks for the four fault points through all callers. The r8 file has the short copy through 5
  callers and the other points through `recoverArchive`; the rest is in the RW acceptance list (7.1).

## 13. The scripts and prototypes in full

### /tmp/aosd8/scripts/m1_archive_publish.mjs

~~~js
// m1 (review r7 M-1; design r8 3.4): the publication of the record archive under faults, on the real built record
// functions of the worktree (fe5d6575), for the r7 rule (/tmp/aosd8/val/r7/inbox.js, a copy of the r7 prototype:
// the final name is written directly) and the r8 rule (/tmp/aosd8/val/dist/inbox.js: a temporary name, fsync, link,
// remove, then the active record). The faults are injected into node:fs (syncBuiltinESMExports):
//   A  the first write under archive/ fails with EIO before any byte
//   B  the first write under archive/ writes 10 bytes, then fails with EIO (the review's short copy)
//   C  the first mutating call after the final name exists fails with EIO (after publication)
//   D  the removal of the active record fails with EIO (before the active unlink)
//   E  the final name exists with other complete content (a conflicting committed archive)
//   F  a temporary file of the ID with 10 bytes remains from a dead archiver
// After each fault: what the latest-archive reader returns, the files in archive/, then one recovery and the state.
// For B the recovery runs through each caller (recoverArchive, pruneInbox, beginLaunch, applyInbox,
// recoverInterruptedRecords). Run: env -i HOME=/tmp/aosd8/home PATH=/tmp/aosd8/nodebin:/usr/bin:/bin LANG=C.UTF-8
// TMPDIR=/tmp/aosd8/tmp node /tmp/aosd8/scripts/m1_archive_publish.mjs
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import * as M from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js";
const root = fs.mkdtempSync("/tmp/aosd8/tmp/m1-");
const real = { ...fs };
const EIO = () => Object.assign(new Error("injected EIO"), { code: "EIO" });
function inject(d, point) {
  const fdPath = new Map();
  const state = { fired: false };
  const inArchive = (p) => typeof p === "string" && p.startsWith(join(d, "archive") + "/");
  const finalExists = () => real.existsSync(join(d, "archive")) && real.readdirSync(join(d, "archive")).some((f) => /^app-1_\d/.test(f));
  const live = fs;
  live.openSync = (p, ...a) => { const fd = real.openSync(p, ...a); fdPath.set(fd, String(p)); return fd; };
  const writeFault = (target, write) => {
    if (state.fired || !inArchive(target) || (point !== "A" && point !== "B")) return write();
    state.fired = true;
    if (point === "B") real.writeFileSync(target, real.readFileSync(join(d, "app-1"), "utf8").slice(0, 10));
    throw EIO();
  };
  live.writeFileSync = (p, data, ...a) => writeFault(typeof p === "number" ? fdPath.get(p) : p, () => real.writeFileSync(p, data, ...a));
  live.writeSync = (fd, ...a) => writeFault(fdPath.get(fd), () => real.writeSync(fd, ...a));
  for (const fn of ["unlinkSync", "rmSync", "renameSync", "linkSync", "fsyncSync"]) {
    live[fn] = (...a) => {
      if (!state.fired && point === "C" && finalExists()) { state.fired = true; throw EIO(); }
      if (!state.fired && point === "D" && fn === "unlinkSync" && a[0] === join(d, "app-1")) { state.fired = true; throw EIO(); }
      return real[fn](...a);
    };
  }
  syncBuiltinESMExports();
  return () => {
    for (const fn of ["openSync", "writeFileSync", "writeSync", "unlinkSync", "rmSync", "renameSync", "linkSync", "fsyncSync"]) live[fn] = real[fn];
    syncBuiltinESMExports();
    return state.fired;
  };
}
const view = (d) => {
  const a = M.readArchivedMetadataRaw(d, "app-1");
  const files = real.existsSync(join(d, "archive")) ? real.readdirSync(join(d, "archive")).sort() : [];
  return { latest: a ? { launchId: a.launchId, branch: a.branch } : null, archive: files, active: real.existsSync(join(d, "app-1")) };
};
const finalOf = (d) => { const f = real.readdirSync(join(d, "archive")).find((x) => /^app-1_\d/.test(x)); return f ? join(d, "archive", f) : null; };
const stamp = (p) => { if (!p) return null; const s = real.statSync(p, { bigint: true }); return `${s.ino}/${s.mtimeNs}`; };
async function setup(A, name) {
  const d = join(root, name); fs.mkdirSync(d, { recursive: true });
  const L = A.beginLaunch(d, "app-1", { spawn: true });
  A.publishLaunch(d, "app-1", L, { branch: "feat/kept-full-record", worktree: join(d, "ws") });
  return { d, L };
}
const callers = {
  recoverArchive: (A, d) => A.recoverArchive(d, "app-1"),
  pruneInbox: (A, d) => JSON.stringify(A.pruneInbox(d, "app-1")),
  beginLaunch: (A, d) => { try { return `began ${A.beginLaunch(d, "app-1", { spawn: true }).slice(0, 8)}`; } catch (e) { return `refused: ${e.message}`; } },
  applyInbox: (A, d) => JSON.stringify(A.applyInbox(d, "app-1")),
  recoverInterruptedRecords: (A, d) => JSON.stringify(A.recoverInterruptedRecords(d)),
};
for (const [rule, path] of [["r7", "/tmp/aosd8/val/r7/inbox.js"], ["r8", "/tmp/aosd8/val/dist/inbox.js"]]) {
  const A = await import(path);
  console.log(`== rule ${rule}`);
  for (const point of ["A", "B", "C", "D"]) {
    const list = point === "B" ? Object.keys(callers) : ["recoverArchive"];
    for (const caller of list) {
      const { d, L } = await setup(A, `${rule}-${point}-${caller}`);
      const undo = inject(d, point);
      let res; try { A.archiveLaunch(d, "app-1", L); res = "archived"; } catch (e) { res = `threw ${e.message}`; }
      const fired = undo();
      const after = view(d); const f = finalOf(d); const before = stamp(f);
      const bytes = f ? real.statSync(f).size : 0;
      const rec = callers[caller](A, d);
      const end = view(d); const f2 = finalOf(d);
      const kept = before !== null && stamp(f2) === before;
      console.log(`${point} fired ${fired}; archive ${res}; then: latest ${JSON.stringify(after.latest)}, final ${bytes} bytes, archive/ ${JSON.stringify(after.archive.map((x) => x.replace(/_\d.*?(\.tmp-.*)?$/, (m, t) => (t ? "_<ts>.tmp-*" : "_<ts>"))))}; ${caller}: ${rec}; end: latest ${JSON.stringify(end.latest)}, active ${end.active}, temps ${end.archive.filter((x) => x.startsWith(".")).length}${before !== null ? `, final kept unchanged ${kept}` : ""}`);
    }
  }
  for (const point of ["E", "F"]) {
    const { d, L } = await setup(A, `${rule}-${point}`);
    const ts = new Date(Date.now() + 5000).toISOString().replace(/[:.]/g, "-");
    M.updateMetadata(d, "app-1", { archiveIntent: ts });
    fs.mkdirSync(join(d, "archive"), { recursive: true });
    if (point === "E") real.writeFileSync(join(d, "archive", `app-1_${ts}`), "branch=feat/other-committed-archive\nlaunchId=other\n");
    else real.writeFileSync(join(d, "archive", `.app-1_${ts}.tmp-999999-dead`), "branch=fea");
    const f = point === "E" ? join(d, "archive", `app-1_${ts}`) : null; const before = stamp(f);
    const rec = A.recoverArchive(d, "app-1");
    const end = view(d);
    console.log(`${point} recoverArchive: ${rec}; end: latest ${JSON.stringify(end.latest)}, active ${end.active}, temps ${end.archive.filter((x) => x.startsWith(".")).length}${f ? `, conflicting archive unchanged ${stamp(f) === before}` : ""}`);
  }
}
fs.rmSync(root, { recursive: true, force: true });
~~~
### /tmp/aosd8/scripts/m2_bootstrap_fence.sh

~~~sh
#!/usr/bin/env bash
# m2 (review r7 M-2, M-3 and m-1; design r8 sections 5.3 to 5.5): the creation fence of runtime-tmux on a private
# tmux 3.4 server (-L aosd8-n1 only; every call with env -u TMUX and -f /dev/null).
#   a. the guarded bootstrap create of design r8 (start-server, then one if-shell -F that requires an EMPTY name
#      option) when no server runs: does it start the server and the session, and set the options?
#   b. the schedule of the review: H0 found no server and prepared its create; H1 starts a server and fences the
#      name; then H0's create runs. The plain create of design r7 5.4 against the guarded bootstrap of design r8.
#   c. the guarded create of design r7 5.3 with a wrong server PID, with a wrong start time, and the partial fix of
#      the review (a compare of the token only) on a successor server with the old name option restored
#   d. 40 pairs of competing guarded bootstrap creates, each pair with no server at its start: exactly one creates
#   e. the session options that the audit of design r8 5.5 reads: @ao_launch (the launch token) and @ao_op (the
#      fence), for a healthy session, after an interrupted session fence, and for a late bootstrap pane
#   f. the residual of design r8 5.4: H0's guarded bootstrap runs when no server runs, or on a successor server on
#      which nobody fenced the name
# Run: env -i HOME=/tmp/aosd8/home PATH=/usr/bin:/bin LANG=C.UTF-8 bash /tmp/aosd8/scripts/m2_bootstrap_fence.sh
set -u
SRV=aosd8-n1
SOCK=/tmp/tmux-$(id -u)/$SRV
[ -e "$SOCK" ] && { echo "$SOCK exists: not started by this script"; exit 1; }
t() { env -u TMUX /usr/bin/tmux -f /dev/null -L "$SRV" "$@"; }
N=cccccccccccc-app-1
K=$(printf %s "$N" | sha256sum | cut -c1-16)
OPT="@ao_name_$K"
ID='#{pid}/#{start_time}/#{'$OPT'}'
q() { printf '"%s"' "$1"; }
fence() { # fence <seen value> <op>: the name fence of design r7 5.3 (the CAS)
  t if-shell -F "#{==:$ID,$1}" "set-option -s $OPT $2 ; display-message -p $(q 'ao-name-fenced:#{pid}')" \
    "display-message -p $(q "ao-name-fence-refused:$ID")" 2>&1
}
create() { # create <server pid> <start> <op> <token>: the guarded create of design r7 5.3, with the token of 5.5
  t if-shell -F "#{==:$ID,$1/$2/$3}" \
    "new-session -d -s $N '/bin/sleep 600' ; set-option -t =$N: @ao_op $3 ; set-option -t =$N: @ao_launch $4 ; display-message -p $(q 'ao-created:#{pid}')" \
    "display-message -p $(q "ao-create-refused:$ID")" 2>&1
}
create_token_only() { # the partial fix of the review: the compare names only the name option
  t if-shell -F "#{==:#{$OPT},$3}" \
    "new-session -d -s $N '/bin/sleep 600' ; set-option -t =$N: @ao_op $3 ; display-message -p $(q 'ao-created:#{pid}')" \
    "display-message -p $(q "ao-create-refused:$ID")" 2>&1
}
bootstrap() { # bootstrap <op> <token>: the guarded bootstrap create of design r8 5.3
  t start-server \; if-shell -F "#{==:#{$OPT},}" \
    "new-session -d -s $N '/bin/sleep 600' ; set-option -s $OPT $1 ; set-option -t =$N: @ao_op $1 ; set-option -t =$N: @ao_launch $2 ; display-message -p $(q 'ao-created:#{pid}/#{start_time}')" \
    "display-message -p $(q "ao-create-refused:$ID")" 2>&1
}
plain() { t new-session -d -s "$N" '/bin/sleep 600' 2>&1; } # the plain create of today and of design r7 5.4
srv() { t display-message -p '#{pid} #{start_time}' 2>/dev/null; }
note() { echo "m2 $1 pid=$2" >> /tmp/aosd8/logs/pids.txt; }
has() { t has-session -t "=$N" 2>/dev/null && echo yes || echo no; }
running() { t list-sessions >/dev/null 2>&1 && echo yes || echo no; }
stop_srv() { # kill-server of the private server, then check that its PID ended and remove its socket
  local p; p=$(t display-message -p '#{pid}' 2>/dev/null)
  t kill-server 2>/dev/null
  for _ in $(seq 1 50); do [ -n "$p" ] && kill -0 "$p" 2>/dev/null || break; sleep 0.05; done
  [ -S "$SOCK" ] && ! t list-sessions >/dev/null 2>&1 && rm -f "$SOCK"
}
opts() { t list-sessions -F '#{session_name} launch=[#{@ao_launch}] op=[#{@ao_op}]' 2>&1 | grep -v '^anchor'; }

echo "== a. the guarded bootstrap with no server"
echo "server running before: $(running)"
out=$(bootstrap op0 T0); echo "bootstrap: $out"
read -r P S < <(srv); note a "$P"
echo "server running $(running), session exists $(has), name option [$(t show-options -sv "$OPT" 2>&1)], session: $(opts)"
stop_srv
echo "== b. the schedule of the review: H0 prepared with no server; H1 starts a server and fences; H0 runs late"
echo "H0 observation: server running $(running)"
t new-session -d -s anchor '/bin/sleep 600'; read -r P S < <(srv); note b "$P"
seen=$(t display-message -p "$ID"); echo "H1 fence: $(fence "$seen" op1)"
echo "H0 late guarded bootstrap (design r8): $(bootstrap op0 T0) | session exists $(has)"
echo "H0 late plain create (design r7 5.4): $(plain) exit $? | session exists $(has) | $(opts)"
t kill-session -t "=$N" 2>/dev/null
echo "== c. the guarded create with wrong evidence (server $P/$S; the name option is op1)"
echo "wrong PID $((P + 1))/$S: $(create $((P + 1)) "$S" op1 T1) | exists $(has)"
echo "wrong start time $P/$((S - 1)): $(create "$P" $((S - 1)) op1 T1) | exists $(has)"
echo "correct $P/$S: $(create "$P" "$S" op1 T1) | exists $(has)"
t kill-session -t "=$N" 2>/dev/null
P0=$P S0=$S
stop_srv
t new-session -d -s anchor '/bin/sleep 600'; read -r P S < <(srv); note c "$P"
t set-option -s "$OPT" op1
echo "successor server $P/$S with the old name option op1 restored:"
echo "  the guarded create of the old server $P0/$S0: $(create "$P0" "$S0" op1 T1) | exists $(has)"
t kill-session -t "=$N" 2>/dev/null
echo "  the token-only partial fix: $(create_token_only "$P0" "$S0" op1) | exists $(has)"
t kill-session -t "=$N" 2>/dev/null
echo "== e. the options that the audit reads"
t set-option -su "$OPT"
seen=$(t display-message -p "$ID"); fence "$seen" opH >/dev/null
echo "healthy create of holder opH: $(create "$P" "$S" opH TH) | $(opts)"
# An interrupted session fence: holder opX fences the existing session (r6 5.1), then dies before its record write.
t if-shell -F -t "=$N:" "#{==:#{@ao_op},opH}" "set-option -t =$N: @ao_op opX" "display-message -p refused"
echo "after the session fence of opX and no record write: $(opts)"
stop_srv
echo "== d. 40 pairs of competing guarded bootstraps"
won=0; bad=""
for i in $(seq 1 40); do
  ( bootstrap "a$i" "Ta$i" > /tmp/aosd8/tmp/m2-a ) & ( bootstrap "b$i" "Tb$i" > /tmp/aosd8/tmp/m2-b ) & wait
  n=$(cat /tmp/aosd8/tmp/m2-a /tmp/aosd8/tmp/m2-b | grep -c '^ao-created:')
  [ "$n" = 1 ] && won=$((won + 1)) || bad="$bad $i:[$(tr '\n' ' ' < /tmp/aosd8/tmp/m2-a)|$(tr '\n' ' ' < /tmp/aosd8/tmp/m2-b)]"
  read -r P S < <(srv); [ -n "${P:-}" ] && note d "$P"
  stop_srv
done
echo "pairs with exactly one created answer: $won of 40${bad:+; other pairs:$bad}"
echo "== f. the residual: H0's guarded bootstrap runs when no server runs, or on a successor where nobody fenced"
echo "no server: $(bootstrap op0 T0) | exists $(has) | $(opts)"
read -r P S < <(srv); note f1 "$P"; stop_srv
t new-session -d -s anchor '/bin/sleep 600'; read -r P S < <(srv); note f2 "$P"
echo "successor server, name not fenced: $(bootstrap op0 T0) | exists $(has)"
stop_srv
left=""; for p in $(grep -o 'm2 [a-z0-9]* pid=[0-9]*' /tmp/aosd8/logs/pids.txt | cut -d= -f2); do kill -0 "$p" 2>/dev/null && left="$left $p"; done
echo "socket left $( [ -e "$SOCK" ] && echo yes || echo no); server processes left:${left:- none}"
~~~
### /tmp/aosd8/scripts/m3_creation_callers.sh

~~~sh
#!/usr/bin/env bash
# m3 (review r7 M-2; design r8 5.3): every production call on main that creates a tmux session or calls a runtime
# create, read with git show main:<path> only (no checkout). It lists the runtime.create callers of core, the raw
# new-session calls, and the callers of core tmux.ts newSession (exported as newTmuxSession).
# Run: bash /tmp/aosd8/scripts/m3_creation_callers.sh
cd /home/taisung/.worktrees/agent-orchestrator/ao-52 || exit 1
echo "main = $(git rev-parse --short main)"
files=$(git ls-tree -r --name-only main -- packages | grep -E '/src/.*\.tsx?$' | grep -vE '__tests__|\.test\.tsx?$|\.test-d\.ts$')
for f in $files; do
  git show "main:$f" | grep -nE 'runtime\.create\(|"new-session"|new-session -|\bnewSession\(|newTmuxSession' | sed "s#^#$f:#"
done
echo "== the create calls of core session-manager.ts and the function that holds each"
git show main:packages/core/src/session-manager.ts | awk '/^  (async )?function [A-Za-z]+/ { fn = $0; sub(/\(.*/, "", fn); sub(/^ *(async )?function /, "", fn) } /plugins\.runtime\.create\(/ { print NR ": " fn }'
~~~
### /tmp/aosd8/scripts/val8.sh

~~~sh
#!/usr/bin/env bash
# val8.sh: run the same-ID test files of rounds r5 to r8 (core) and r6 to r8 (runtime-tmux) against the scratch
# prototypes of design r8, to check that a correct implementation of the r8 rules turns every defect green:
#   /tmp/aosd8/val/core/{inbox.ts,fleet-barrier.ts,retained-inventory.ts}, /tmp/aosd8/val/dist/inbox.js,
#   /tmp/aosd8/val/core/coresrc (a copy of core src whose session-manager.ts has the creation fence and whose
#   metadata.ts updates an archive through a dot temporary name, patch_sm.py; the core tests import its metadata.ts),
#   /tmp/aosd8/val/tmux/runtime-proto.ts with dist/runtime.js, and the unchanged session-fence prototype
#   assoc-proto.ts with dist/core.js.
# The test files are copied to /tmp/aosd8/val with sed; only import specifiers change. Nothing in the worktree
# changes. Red mode: every defect runs as a plain test. AOSD8_SCOPE_HOME=/tmp/aosd8/ limits a barrier call without
# a process scope to the processes whose HOME is under /tmp/aosd8 (validation only, see fleet-barrier.ts).
# With an argument, the M-3 discrimination runs instead (review r7 M-3):
#   tokenonly    the tmux r7 and r8 files with the running-server compare of the prototype reduced to the name
#                option (flag /tmp/aosd8/val/tmux/tokenonly)
#   fallthrough  the tmux r8 file with a create without an operation that runs the create of today
#   plainbootstrap  the tmux r8 file with the plain new-session of design r7 5.4 for a create with no server
#   nokeysguard  the tmux r8 file with launch keys that do not compare @ao_op
#   anyerror     the core r7 file and its fe5d6575 copy with a spawn of a taken ID that refuses with a lock
#                timeout (flag /tmp/aosd8/val/anyerror): the strengthened control must fail, the old one passes
#   (tokenonly also runs the fe5d6575 copy of the tmux r7 file: the old restart test passes there)
#   p1allow      the core r7 and r8 files against the r7 barrier prototype (it takes an allow for any rule and
#                the callback answer for P1; it has no allow states and no admission step)
set -e
S=/tmp/aosd8; V=$S/val; W=/home/taisung/.worktrees/agent-orchestrator/ao-52; C=$W/packages/core/src; T=$W/packages/plugins/runtime-tmux/src
mode=${1:-all}
mkdir -p $V/core/__tests__ $V/tmux/__tests__ $V/core-r7barrier/__tests__
for d in $V/core $V/core-r7barrier; do [ -e $d/node_modules ] || ln -s $W/packages/core/node_modules $d/node_modules; done
[ -e $V/tmux/node_modules ] || ln -s $W/packages/plugins/runtime-tmux/node_modules $V/tmux/node_modules
for f in inbox.ts retained-inventory.ts; do [ -e $V/core-r7barrier/$f ] || ln -s $V/core/$f $V/core-r7barrier/$f; done
python3 -I $S/scripts/patch_sm.py > /dev/null
touch $V/dist/inbox.js # not older than the in-process face
core() { sed -e "s#from \"\.\./session-manager\.js\"#from \"$V/core/coresrc/session-manager.ts\"#" \
  -e "s#from \"\.\./metadata\.js\"#from \"$V/core/coresrc/metadata.ts\"#" \
  -e "s#from \"\./test-utils\.js\"#from \"$C/__tests__/test-utils.ts\"#" \
  -e "s#from \"\.\./\([a-z-]*\)\.js\"#from \"$C/\1.ts\"#" \
  -e "s#new URL(\"\.\./\.\./dist/agent-workspace-hooks\.js\", import\.meta\.url)#new URL(\"file://$W/packages/core/dist/agent-workspace-hooks.js\")#" \
  -e "s#new URL(\"\.\./\.\./\.\./\", import\.meta\.url)#new URL(\"file://$W/packages/\")#" \
  -e 's#^      writer: AO_METADATA_HELPER,$#      writer: mod["WRITER"] as string,#' "$1" > "$2"; }
for r in r5 r6 r7 r8; do core $C/__tests__/same-id-defects-$r.test.ts $V/core/__tests__/same-id-defects-$r.test.ts; done
for r in r7 r8; do cp $V/core/__tests__/same-id-defects-$r.test.ts $V/core-r7barrier/__tests__/; done
(cd $W && git show fe5d6575:packages/core/src/__tests__/same-id-defects-r7.test.ts) > $S/tmp/core-r7-fe5d6575.ts
core $S/tmp/core-r7-fe5d6575.ts $V/core/__tests__/same-id-defects-r7-fe5d6575.test.ts
(cd $W && git show fe5d6575:packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r7.test.ts) |
  sed -e "s#from \"\.\./index\.js\"#from \"$V/tmux/runtime-proto.ts\"#" \
    -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"file://$V/tmux/dist/runtime.js\")#" \
    > $V/tmux/__tests__/same-id-defects-r7-fe5d6575.test.ts
for r in r7 r8; do
  sed -e "s#from \"\.\./index\.js\"#from \"$V/tmux/runtime-proto.ts\"#" \
    -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"file://$V/tmux/dist/runtime.js\")#" \
    $T/__tests__/same-id-defects-$r.test.ts > $V/tmux/__tests__/same-id-defects-$r.test.ts
done
sed -e 's#import \* as core from "@aoagents/ao-core";#import * as core from "../assoc-proto.ts";#' \
  -e "s#from \"\.\./index\.js\"#from \"$T/index.ts\"#" \
  -e "s#new URL(\"\.\./\.\./\.\./\.\./core/dist/index\.js\", import\.meta\.url)#new URL(\"file://$V/tmux/dist/core.js\")#" \
  -e "s#new URL(\"\.\./\.\./dist/index\.js\", import\.meta\.url)#new URL(\"file://$W/packages/plugins/runtime-tmux/dist/index.js\")#" \
  $T/__tests__/same-id-defects-r6.test.ts > $V/tmux/__tests__/same-id-defects-r6.test.ts
run() {
  (cd "$1" && env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp AOSD8_SCOPE_HOME=$S/ \
    PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run --root "$1" "${@:2}" 2>&1) |
    sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ *(×|↓)|^ *✓ .*(control|refused|fence|allow|admission|bootstrap|killed holder|taken)|→|^AssertionError|Tests ' | sed -e 's/^ *//' -e 's/ [0-9]*ms$//' | cut -c1-260
}
rm -f $V/tmux/tokenonly $V/tmux/fallthrough $V/tmux/plainbootstrap $V/tmux/nokeysguard $V/anyerror
case $mode in
all)
  for r in r8 r7 r6 r5; do echo "== core $r against the r8 prototypes"; run $V/core __tests__/same-id-defects-$r.test.ts; done
  echo "== runtime-tmux r6 against assoc-proto.ts (the session fence, unchanged)"; run $V/tmux __tests__/same-id-defects-r6.test.ts
  for r in r8 r7; do echo "== runtime-tmux $r against runtime-proto.ts (the r8 creation fence)"; run $V/tmux __tests__/same-id-defects-$r.test.ts; done
  ;;
tokenonly)
  touch $V/tmux/tokenonly
  for r in r8 r7 r7-fe5d6575; do echo "== runtime-tmux $r, the compare names only the name option (review r7 M-3)"; run $V/tmux __tests__/same-id-defects-$r.test.ts; done
  ;;
anyerror)
  touch $V/anyerror
  for r in r7 r7-fe5d6575; do echo "== core $r, a spawn of a taken ID refuses with a lock timeout"; run $V/core __tests__/same-id-defects-$r.test.ts -t 'spawn of the same ID that waited'; done
  ;;
fallthrough)
  touch $V/tmux/fallthrough
  echo "== runtime-tmux r8, a create without an operation runs the create of today"; run $V/tmux __tests__/same-id-defects-r8.test.ts
  ;;
plainbootstrap|nokeysguard)
  touch $V/tmux/$mode
  echo "== runtime-tmux r8 with the prototype flag $mode"; run $V/tmux __tests__/same-id-defects-r8.test.ts
  ;;
p1allow)
  for r in r8 r7; do echo "== core $r against the r7 barrier prototype (it takes P1 allows, review r7 M-3)"; run $V/core-r7barrier __tests__/same-id-defects-$r.test.ts; done
  ;;
esac
rm -f $V/tmux/tokenonly $V/tmux/fallthrough $V/tmux/plainbootstrap $V/tmux/nokeysguard $V/anyerror
~~~
### /tmp/aosd8/scripts/patch_sm.py

~~~python
# patch_sm.py: copy packages/core/src (without __tests__) of the worktree to /tmp/aosd8/val/core/coresrc; give its
# metadata.ts the archive update of design r8 1 (a dot temporary name in archive/, then a rename over the latest
# archive), and give its session-manager.ts the creation fence of design r8 3 at its three create callers, for
# validation only:
# spawn and orchestrator spawn call runtime.fenceName(<tmux name>, op) before the reservation of the record, restore
# calls it after it resolved its plugins and before its first record write, and each create gets
# operation { id: op, server }. Nothing in the worktree changes. Run: python3 -I /tmp/aosd8/scripts/patch_sm.py
import shutil
W = "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/src"
D = "/tmp/aosd8/val/core/coresrc"
shutil.rmtree(D, ignore_errors=True)
shutil.copytree(W, D, ignore=shutil.ignore_patterns("__tests__"))
m = D + "/metadata.ts"
t = open(m).read()
for a, b in [
    ("  rmSync,\n  realpathSync,\n} from \"node:fs\";", "  rmSync,\n  realpathSync,\n  renameSync,\n} from \"node:fs\";"),
    ("  atomicWriteFileSync(archivePath, serializeMetadata(written));\n  return true;\n}",
     "  const tmpPath = join(archiveDir, `.${latest}.upd-${process.pid}-${Date.now()}`); // design r8 1\n"
     "  try {\n    writeFileSync(tmpPath, serializeMetadata(written), \"utf-8\");\n    renameSync(tmpPath, archivePath);\n"
     "  } catch (err) {\n    rmSync(tmpPath, { force: true });\n    throw err;\n  }\n  return true;\n}"),
]:
    if t.count(a) != 1:
        raise SystemExit(f"metadata patch point found {t.count(a)} times: {a[:60]!r}")
    t = t.replace(a, b)
open(m, "w").write(t)
p = D + "/session-manager.ts"
s = open(p).read()
FENCE = "(plugins.runtime as unknown as { fenceName?: (n: string, op: string) => Promise<{ server: unknown }> })"
rep = [
    # spawn: the reservation loop takes a fence callback
    ("""    launchClaim: Record<string, string> | null,
  ): Promise<{
    num: number;
    sessionId: string;
    tmuxName: string | undefined;
    record: Record<string, string>;
  }> {
    const usedNumbers = new Set<number>();""",
     """    launchClaim: Record<string, string> | null,
    fence?: (name: string) => Promise<void>,
  ): Promise<{
    num: number;
    sessionId: string;
    tmuxName: string | undefined;
    record: Record<string, string>;
  }> {
    const usedNumbers = new Set<number>();"""),
    ("""      const record = usedNumbers.has(num)
        ? null
        : reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
      if (record) {
        return { num, sessionId, tmuxName, record };
      }

      usedNumbers.add(num);
      num += 1;
    }

    throw new Error(
      `Failed to reserve session ID after 10000 attempts (prefix: ${project.sessionPrefix})`,""",
     """      if (!usedNumbers.has(num) && !listMetadata(sessionsDir).includes(sessionId)) await fence?.(tmuxName ?? sessionId);
      const record = usedNumbers.has(num)
        ? null
        : reserveSessionRecord(sessionsDir, sessionId, launchClaim ?? undefined);
      if (record) {
        return { num, sessionId, tmuxName, record };
      }

      usedNumbers.add(num);
      num += 1;
    }

    throw new Error(
      `Failed to reserve session ID after 10000 attempts (prefix: ${project.sessionPrefix})`,"""),
    ("""    } = await reserveNextSessionIdentity(project, sessionsDir, launchClaim);""",
     """    } = await reserveNextSessionIdentity(project, sessionsDir, launchClaim, async (n) => {
      spawnFence = (await """ + FENCE + """.fenceName?.(n, spawnOp)) ?? null;
    });"""),
    ("""    const launchClaim = plugins.agent.prepareAgentSession ? await readLaunchClaim() : null;
    const {""", """    const launchClaim = plugins.agent.prepareAgentSession ? await readLaunchClaim() : null;
    const spawnOp = randomBytes(8).toString("hex");
    let spawnFence: { server: unknown } | null = null;
    const {"""),
    ("""      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId, // Use tmux name for runtime if available
        workspacePath,
        launchCommand,
        environment,
      });""", """      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId, // Use tmux name for runtime if available
        workspacePath,
        launchCommand,
        environment,
        ...({ operation: { id: spawnOp, server: spawnFence?.server ?? null } } as object),
      });"""),
    # orchestrator spawn (project mode): fence before the existing-record handling and the reservation
    ("""      branch = project.defaultBranch;
      workspacePath = project.path;
""", """      branch = project.defaultBranch;
      workspacePath = project.path;
      orchestratorFence = (await """ + FENCE + """.fenceName?.(tmuxName ?? sessionId, orchestratorOp)) ?? null;
"""),
    ("""    let sessionId: string;
    let tmuxName: string | undefined;
    let branch: string;
    let workspacePath: string;""", """    let sessionId: string;
    let tmuxName: string | undefined;
    let branch: string;
    let workspacePath: string;
    const orchestratorOp = randomBytes(8).toString("hex");
    let orchestratorFence: { server: unknown } | null = null;"""),
    ("""      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId,
        workspacePath,
        launchCommand,
        environment,
      });""", """      handle = await plugins.runtime.create({
        sessionId: tmuxName ?? sessionId,
        workspacePath,
        launchCommand,
        environment,
        ...({ operation: { id: orchestratorOp, server: orchestratorFence?.server ?? null } } as object),
      });"""),
    # restore: fence after the plugins are resolved, before the first record write
    ("""    const plugins = resolvePlugins(project, selection.agentName);
    await enrichSessionWithRuntimeState(session, plugins, true);
""", """    const plugins = resolvePlugins(project, selection.agentName);
    await enrichSessionWithRuntimeState(session, plugins, true);
    const restoreOp = randomBytes(8).toString("hex");
    const restoreFence = (await """ + FENCE + """.fenceName?.(raw["tmuxName"] ?? sessionId, restoreOp)) ?? null;
"""),
    ("""    const handle = await plugins.runtime.create({
      sessionId: tmuxName ?? sessionId,
      workspacePath,
      launchCommand,""", """    const handle = await plugins.runtime.create({
      ...({ operation: { id: restoreOp, server: restoreFence?.server ?? null } } as object),
      sessionId: tmuxName ?? sessionId,
      workspacePath,
      launchCommand,"""),
]
for a, b in rep:
    n = s.count(a)
    if n != 1:
        raise SystemExit(f"patch point found {n} times: {a[:80]!r}")
    s = s.replace(a, b)
if 'import { randomBytes' not in s and 'randomBytes' not in s.split("\n// ")[0][:4000]:
    s = 'import { randomBytes } from "node:crypto";\n' + s
open(p, "w").write(s)
print("patched", p)
~~~
### /tmp/aosd8/val/dist/inbox.js

~~~js
// Validation prototype (scratch only) of design r8 section 3: the inbox of RW, plain JS on the built record
// functions of the worktree (fe5d6575). Each operation runs in ONE record-lock hold; the recovery of an archive
// intent runs first. The r7 prototype (design r7 sections 3.2 to 3.6), with design r8 3.4 (review r7 M-1):
//   the record archive is published atomically: archive/.<id>_<ts>.tmp-<pid>-<hex> (outside every reader's name
//   rule) is written, fsynced and linked to archive/<id>_<ts> (link never replaces a name), then removed, then the
//   archive directory is fsynced, then the active record is removed. A final name with the same bytes is kept, not
//   written again; a final name with other bytes is "archive damaged" (nothing changes). A temporary file of the
//   ID under the lock belongs to a holder that died or failed in its own hold: the recovery removes it.
//   A spawn of an ID that has a record refuses with "the ID <id> is taken".
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
// Validation only: with /tmp/aosd8/val/anyerror, a spawn of a taken ID refuses with a lock timeout (val8.sh anyerror).
const ANY_ERROR = existsSync("/tmp/aosd8/val/anyerror");
import * as M from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/core/dist/metadata.js";

const RS = 0x1e, LF = 0x0a, CHUNK = 65536, MAX_REC = 4096, CAP = 1 << 20;
export const WRITER = readFileSync("/tmp/aosd8/val/i6_writer.sh", "utf8").replace(/\nao_inbox_append "\$@"\n$/, "\n").replace(/ao_inbox_append/g, "update_ao_metadata");
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

/** Design r8 3.4: publish the record archive under its fixed name, atomically; the caller holds the record lock. */
function publishArchive(d, id, ts, content) {
  const dir = join(d, "archive"), final = join(dir, `${id}_${ts}`);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.startsWith(`.${id}_${ts}.tmp-`)) unlinkSync(join(dir, f)); // a dead or failed holder's
  const same = () => readFileSync(final).equals(Buffer.from(content, "utf8"));
  if (existsSync(final)) return same() ? "kept" : "archive damaged";
  const tmp = join(dir, `.${id}_${ts}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
  const fd = openSync(tmp, "wx", 0o600);
  try {
    const buf = Buffer.from(content, "utf8");
    for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try { linkSync(tmp, final); }
  catch (e) { if (e.code !== "EEXIST") throw e; unlinkSync(tmp); return same() ? "kept" : "archive damaged"; }
  unlinkSync(tmp);
  syncDir(dir);
  return "published";
}
/** Design r8 3.4, the recovery of an archive intent; the caller holds the record lock. */
function finish(d, id) {
  const r = M.readMetadataRaw(d, id);
  if (!r?.archiveIntent) return "nothing";
  const ts = r.archiveIntent, dst = archivedInboxPath(d, id, ts); // the intent's own name, never a new one
  const src = existsSync(box(d, id)), moved = existsSync(dst);
  if (src && moved) return "inbox damaged";
  if (!src && !moved && r.launchId) return "inbox damaged";
  if (src) {
    mkdirSync(join(d, ".inbox-archive"), { recursive: true });
    renameSync(box(d, id), dst);
    syncDir(join(d, ".inbox-archive")); syncDir(join(d, ".inbox"));
  }
  const published = publishArchive(d, id, ts, readFileSync(join(d, id), "utf8"));
  if (published === "archive damaged") return published;
  M.deleteMetadata(d, id, false, { archiveIntent: ts });
  syncDir(d);
  return "finished";
}
export const recoverArchive = (d, id) => M.withRecordLock(d, id, () => finish(d, id));

export function beginLaunch(d, id, o = {}) {
  return M.withRecordLock(d, id, () => {
    const f0 = finish(d, id);
    if (f0.endsWith("damaged")) throw new Error(f0);
    const r = M.readMetadataRaw(d, id);
    const fresh = o.spawn || o.archived;
    if (fresh && r !== null && ANY_ERROR) throw new Error("the record lock was not free in time"); // val8.sh anyerror only
    if (fresh ? r !== null : r === null) throw new Error(fresh ? `the ID ${id} is taken` : "no record to restore");
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
    const f0 = finish(d, id);
    if (f0 !== "nothing") return { more: false, archive: f0 };
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
    if (finish(d, id).endsWith("damaged") || !existsSync(box(d, id))) return [];
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
### /tmp/aosd8/val/core/inbox.ts

~~~ts
// Validation prototype (scratch only) of design r8 section 3: the in-process face of /tmp/aosd8/val/dist/inbox.js
// (the child process of the core tests imports that file directly).
export * from "/tmp/aosd8/val/dist/inbox.js";
~~~
### /tmp/aosd8/val/core/fleet-barrier.ts

~~~ts
// Validation prototype (scratch only) of design r8 section 2.2: checkFleetAndFence. Check 1, the record step, the
// inbox directories, the fence by rename, check 2, the admission step; it never waits and never signals. Each check
// reads the process list until a read finds no new PID (at most 5 reads, else it blocks), and classifies each process
// of the uid (zombies are ended processes):
//   P1  an AO_* key in /proc/<pid>/environ (host-wide); P1u: the environment cannot be read
//   P2  a pane of an AO-named session on a tmux server that the check found (descriptor links, /proc/<pid>/net/unix,
//       a query that answers with that PID); P2u: a server that no path reaches
//   P3  a JS runtime (exe basename after " (deleted)", or comm node-MainThread); P3u: the exe cannot be read
//   P4  W1 and W2 of design r5 2.3 (as the r7 prototype) and W3: a descriptor on a record or its temporary file
// Allows (design r8 2.2, review r7 M-3): an entry { pid, startTicks, rule } for a rule outside P1u, P2u, P3, P3u is
// refused before any step; an entry matches only while that PID lives with those start ticks; the result reports the
// state of every entry at check 1, at check 2 and at admission. Admission: after check 2, every allowed process that
// still lives is classified again with every rule; a match that no entry allows blocks. The r5 and r6 test seam
// `allow` is filtered the same way (an answer for P1, P2 or P4 has no effect).
// Validation only: with AOSD8_SCOPE_HOME=<prefix> and no processScope, the check considers only the processes whose
// HOME starts with <prefix>. It compares the HOME value and prints no value. Not in the design.
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
type Entry = { pid: number; startTicks: string; rule: string };
type State = "matched" | "unused" | "expired" | "not run";
const ALLOWABLE = new Set(["P1u", "P2u", "P3", "P3u"]);
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

function check(o: Options, fenced: boolean, n: number, only?: number[]): { out: Blocking[]; used: Set<Entry> } {
  const current = new Map(o.install.map((f) => [real(f.path), existsSync(f.path) ? inode(f.path) : ""]));
  const names = new Set(o.install.map((f) => basename(f.path)));
  const sess = new Set(o.sessionsDirs.map(real));
  const prefix = process.env["AOSD8_SCOPE_HOME"];
  const homeIn = (pid: number) => { try { return readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").some((x) => x.startsWith(`HOME=${prefix}`)); } catch { return false; } };
  const scoped = (pid: number) => o.processScope ? o.processScope(pid) : prefix ? homeIn(pid) : true;
  const out: Blocking[] = [];
  const used = new Set<Entry>();
  const add = (pid: number, rule: string) => {
    let t = ""; try { const st = stat(pid); if (st.state === "Z") return; t = st.ticks; } catch { return; }
    const base = rule.split(" ")[0] ?? rule;
    if (ALLOWABLE.has(base) && o.allow?.({ pid, rule })) return;
    const e = (o.allowEntries ?? []).find((x) => x.pid === pid && x.rule === base && x.startTicks === t);
    if (e) { used.add(e); return; }
    out.push({ pid, rule, comm: comm(pid) });
  };
  // The process list, read until a read finds no new PID.
  const seen = new Set<string>();
  const pids: number[] = [];
  let settled = only !== undefined;
  if (only) for (const p of only) { try { if (stat(p).state !== "Z") pids.push(p); } catch { /* ended */ } }
  for (let listing = 1; listing <= 5 && !only; listing++) {
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
    let w3 = false;
    try {
      for (const fd of readdirSync(`/proc/${d}/fd`)) {
        let l = ""; try { l = readlinkSync(`/proc/${d}/fd/${fd}`); } catch { continue; }
        if (l.startsWith("/") && sess.has(real(dirname(l))) && /^\.?[^./][^/]*?(\.tmp(\.\d+)?|\.reserve-.*)?$/.test(basename(l))) w3 = true;
      }
    } catch { /* unreadable descriptors: the process is P1u and P3u (OD-27 (b)); ended: nothing */ }
    if (w3) add(pid, "P4 W3");
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
  return { out, used };
}

const live = (e: Entry) => { try { const st = stat(e.pid); return st.state !== "Z" && st.ticks === e.startTicks; } catch { return false; } };
const stateOf = (e: Entry, used: Set<Entry>): State => (!live(e) ? "expired" : used.has(e) ? "matched" : "unused");

export async function checkFleetAndFence(o: Options): Promise<{ admitted: boolean; blocking: Blocking[]; allows: Array<Entry & { check1: State; check2: State; admission: State }> }> {
  for (const e of o.allowEntries ?? []) {
    if (!ALLOWABLE.has(e.rule)) throw new Error(`the rule ${e.rule} cannot be allowed (design r8 2.2): ${e.pid}:${e.startTicks}:${e.rule}`);
  }
  const entries = o.allowEntries ?? [];
  const states = new Map(entries.map((e) => [e, { check1: "not run" as State, check2: "not run" as State, admission: "not run" as State }]));
  const report = () => entries.map((e) => ({ ...e, ...states.get(e)! }));
  const first = check(o, false, 1);
  for (const e of entries) states.get(e)!.check1 = stateOf(e, first.used);
  o.onCheck?.(1);
  if (first.out.length) return { admitted: false, blocking: first.out, allows: report() };
  for (const d of o.sessionsDirs) {
    const step = recoverInterruptedRecords(d) as Array<{ sessionId: string; result: string }>;
    if (step.some((s) => s.result.endsWith("damaged"))) return { admitted: false, blocking: [{ pid: 0, rule: "inbox damaged" }], allows: report() };
    mkdirSync(join(d, ".inbox"), { recursive: true });
    closeSync(openSync(join(d, ".inbox", "orphans.ndjson"), "a"));
  }
  for (const f of o.install) { writeFileSync(`${f.path}.ao-new`, f.content, { mode: f.mode }); renameSync(`${f.path}.ao-new`, f.path); }
  const second = check(o, true, 2);
  for (const e of entries) states.get(e)!.check2 = stateOf(e, second.used);
  o.onCheck?.(2);
  if (second.out.length) return { admitted: false, blocking: second.out, allows: report() };
  // Admission (design r8 2.3 step 8): every allowed process that still lives is classified again with every rule.
  const pids = [...new Set(entries.filter(live).map((e) => e.pid))];
  const last = check(o, true, 3, pids);
  for (const e of entries) states.get(e)!.admission = stateOf(e, last.used);
  return { admitted: last.out.length === 0, blocking: last.out, allows: report() };
}
~~~
### /tmp/aosd8/val/core/retained-inventory.ts

~~~ts
// Validation prototype (scratch only) of design r8 section 5: the audit classification (review r7 m-1). It
// compares the launch token of a session (#{@ao_launch}) with the durable token D of the active record that names
// the session. D, in this order: the top-level tmuxLaunchToken (the planned token that every launch record write
// stores before the create), the token of runtimeHandle.data.tmuxLaunchToken, the token of runtimeAssociation; an
// associationIntent token makes an association pending. It never compares @ao_op.
type Raw = Record<string, string>;
export function classifyRuntimeSessions(input: {
  records: Array<{ sessionId: string; raw: Raw }>;
  sessions: Array<{ socket: string; name: string; launchToken: string; op: string }>;
}): Array<{ socket: string; name: string; sessionId: string | null; state: string }> {
  const json = (v: string | undefined): Record<string, unknown> => {
    try { return v ? (JSON.parse(v) as Record<string, unknown>) : {}; } catch { return {}; }
  };
  return input.sessions.map((s) => {
    const rec = input.records.find(({ raw }) => {
      const h = json(raw["runtimeHandle"]); const data = (h["data"] ?? {}) as Record<string, unknown>;
      const name = (h["id"] as string | undefined) ?? raw["tmuxName"];
      const socket = data["tmuxSocket"] as string | undefined;
      return name === s.name && (socket === undefined || socket === s.socket);
    });
    if (!rec) return { socket: s.socket, name: s.name, sessionId: null, state: "unrecorded" };
    const h = json(rec.raw["runtimeHandle"]); const data = (h["data"] ?? {}) as Record<string, unknown>;
    const token = rec.raw["tmuxLaunchToken"] || (data["tmuxLaunchToken"] as string | undefined) ||
      (json(rec.raw["runtimeAssociation"])["token"] as string | undefined);
    const intent = json(rec.raw["associationIntent"])["token"] as string | undefined;
    let state: string;
    if (!token && intent) state = s.launchToken === "" || s.launchToken === intent ? "pending" : "stale";
    else if (!token) state = s.launchToken === "" ? "legacy" : "stale";
    else if (token !== s.launchToken) state = "stale";
    else if (rec.raw["launchState"] === "preparing") state = "pending";
    else if (rec.raw["launchState"] === "failed") state = "stale";
    else state = "ok";
    return { socket: s.socket, name: s.name, sessionId: rec.sessionId, state };
  });
}
~~~
### /tmp/aosd8/val/tmux/dist/runtime.js

~~~js
// Validation prototype (scratch only) of design r8 section 5.3: the creation fence of runtime-tmux (R2b-2,
// OD-28 (b), review r7 M-2), plain JS on the built runtime-tmux of the worktree (fe5d6575).
//   fenceName(name, op): read "#{pid}/#{start_time}/#{@ao_name_<k>}" (k: the first 16 hex digits of the SHA-256 of
//     the name), then one gated command that sets @ao_name_<k> to op when the three values are still the ones read;
//     up to 3 tries. No server runs: { fenced: false, server: null }.
//   create(config): a managed create needs config.operation = { id, server, launchToken? }; without it the create
//     throws and runs no tmux command (no fall-through to a plain create).
//     - server { pid, startTime }: ONE gated command that compares the server PID, its start time and
//       @ao_name_<k> with { server, id }, then runs new-session and sets @ao_op (and @ao_launch) of the new session.
//     - server null (the holder found no server): the guarded bootstrap, "start-server ;" then ONE gated command
//       that requires an EMPTY @ao_name_<k>, then runs new-session and sets @ao_name_<k>, @ao_op and @ao_launch.
//     The launch command goes in a command that compares @ao_op.
// Discrimination checks only (val8.sh): the flag file /tmp/aosd8/val/tmux/tokenonly makes the running-server
// compare name only the name option (the partial fix of review r7 M-3); /tmp/aosd8/val/tmux/fallthrough makes a
// create without an operation run the create of today; /tmp/aosd8/val/tmux/plainbootstrap makes a create with no
// server a plain new-session (design r7 5.4); /tmp/aosd8/val/tmux/nokeysguard sends the launch keys unguarded.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as base from "/home/taisung/.worktrees/agent-orchestrator/ao-52/packages/plugins/runtime-tmux/dist/index.js";

const run = promisify(execFile);
const TOKEN_ONLY = existsSync("/tmp/aosd8/val/tmux/tokenonly");
const FALL_THROUGH = existsSync("/tmp/aosd8/val/tmux/fallthrough");
const PLAIN_BOOTSTRAP = existsSync("/tmp/aosd8/val/tmux/plainbootstrap");
const NO_KEYS_GUARD = existsSync("/tmp/aosd8/val/tmux/nokeysguard");
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
      if (!op?.id) {
        if (FALL_THROUGH) return rt.create(config);
        throw new Error(`a managed create of ${config.sessionId} needs an operation (design r8 5.3)`);
      }
      const name = config.sessionId, opt = optOf(name);
      const id = `#{pid}/#{start_time}/#{${opt}}`;
      const token = op.launchToken ? ` ; set-option -t =${name}: @ao_launch ${op.launchToken}` : "";
      const make = `new-session -d -s ${name} -c ${q(config.workspacePath)} ; set-option -t =${name}: @ao_op ${op.id}${token}`;
      let out;
      if (op.server) {
        const compare = TOKEN_ONLY ? `#{==:#{${opt}},${op.id}}` : `#{==:${id},${op.server.pid}/${op.server.startTime}/${op.id}}`;
        out = await tmux(["if-shell", "-F", compare, `${make} ; display-message -p ${q("ao-created:#{pid}")}`,
          `display-message -p ${q(`ao-create-refused:${id}`)}`]);
      } else if (PLAIN_BOOTSTRAP) {
        out = await tmux(["new-session", "-d", "-s", name, "-c", config.workspacePath, ";", "set-option", "-t", `=${name}:`, "@ao_op", op.id, ";", "display-message", "-p", "ao-created:#{pid}"]);
      } else {
        out = await tmux(["start-server", ";", "if-shell", "-F", `#{==:#{${opt}},}`,
          `${make} ; set-option -s ${opt} ${op.id} ; display-message -p ${q("ao-created:#{pid}")}`,
          `display-message -p ${q(`ao-create-refused:${id}`)}`]);
      }
      if (!out.startsWith("ao-created:")) throw new Error(`the create of ${name} was refused: ${out}`);
      if (NO_KEYS_GUARD) await tmux(["send-keys", "-t", `=${name}:`, config.launchCommand, "Enter"]);
      else await tmux(["if-shell", "-F", "-t", `=${name}:`, `#{==:#{@ao_op},${op.id}}`,
        `send-keys -t =${name}: ${q(config.launchCommand)} Enter`, `display-message -p ${q("ao-refused")}`]);
      return { id: name, runtimeName: "tmux", data: { createdAt: Date.now(), workspacePath: config.workspacePath, tmuxLaunchToken: op.launchToken } };
    },
  };
}
export default { create };
~~~
### /tmp/aosd8/val/tmux/runtime-proto.ts

~~~ts
// Validation prototype (scratch only) of design r8 section 5.3: the in-process face of
// /tmp/aosd8/val/tmux/dist/runtime.js (the old holder of the tmux tests imports that file directly).
export * from "/tmp/aosd8/val/tmux/dist/runtime.js";
~~~

### The copies of r7 prototypes

These files are the r7 files of r7 section 12, with only their paths changed. Each `diff` of the `sed` output
against the copy prints nothing:

~~~sh
R7='-e s#/tmp/aosd7#/tmp/aosd8#g -e s#AOSD7_SCOPE_HOME#AOSD8_SCOPE_HOME#g -e s#aosd7-#aosd8-#g'
sed $R7 /tmp/aosd7/val/dist/inbox.js > /tmp/aosd8/val/r7/inbox.js       # the r7 rule of m1
sed $R7 /tmp/aosd7/val/i6_writer.sh > /tmp/aosd8/val/i6_writer.sh       # used by both inbox prototypes
sed $R7 /tmp/aosd7/val/tmux/dist/core.js > /tmp/aosd8/val/tmux/dist/core.js         # the session fence (r6 5.1)
sed $R7 /tmp/aosd7/val/tmux/assoc-proto.ts > /tmp/aosd8/val/tmux/assoc-proto.ts
# the r7 barrier of the p1allow discrimination: the r7 file, with its inbox import moved
sed $R7 /tmp/aosd7/val/core/fleet-barrier.ts |
  sed 's#from "./inbox.ts"#from "/tmp/aosd8/val/core/inbox.ts"#' > /tmp/aosd8/val/core-r7barrier/fleet-barrier.ts
~~~

### /tmp/aosd8/scripts/vt.sh

~~~sh
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd8
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
~~~
### /tmp/aosd8/scripts/redcount.sh

~~~sh
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged"), and per design
# round when the tag is followed by one in parentheses ("[same-id R3] (RW)").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd8/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd8/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd8/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
  python3 -I - "$f" "$json" >> "$OUT" <<'PY'
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
### /tmp/aosd8/scripts/quotes8.py

~~~python
# quotes8.py: make the failure quotes and the test tables of design r8 section 6 from the vitest JSON reports of
# the red runs (/tmp/aosd8/logs/red-<name>.json): fail-<name>.txt (each failed test and the first line of its
# failure, ANSI codes removed) and table-<name>.md (each test and its kind: a test that fails in red mode is a
# defect, one that passes is a control). Run: python3 -I /tmp/aosd8/scripts/quotes8.py
import json, re
for name in ("core-r8", "core-r7", "tmux-r8", "tmux-r7"):
    rep = json.load(open(f"/tmp/aosd8/logs/red-{name}.json"))
    fails, rows = [], []
    for f in rep["testResults"]:
        for t in f["assertionResults"]:
            title = " > ".join(t["ancestorTitles"][1:] + [t["title"]]) if len(t["ancestorTitles"]) > 1 else t["title"]
            kind = "defect" if t["status"] == "failed" else "control" if t["status"] == "passed" else t["status"]
            rows.append(f"| {title.replace('|', '/')} | {kind} |")
            if t["status"] == "failed":
                msg = re.sub(r"\x1b\[[0-9;]*m", "", t["failureMessages"][0]).splitlines()[0]
                fails.append(f"{title}\n  {msg}\n")
    open(f"/tmp/aosd8/logs/fail-{name}.txt", "w").write("\n".join(fails))
    open(f"/tmp/aosd8/logs/table-{name}.md", "w").write("\n".join(rows) + "\n")
    print(name, len(rows), "tests,", len(fails), "failed")
~~~
### /tmp/aosd8/scripts/sec0_procs.py

~~~python
# sec0_procs.py: list the processes of this uid that name /tmp/aosd8 or an aosd8- server in their argv, or whose
# cwd or exe lies under /tmp/aosd8, or that hold the marker HOME (HOME=/tmp/aosd8/...), excluding this scan and
# its ancestors. It prints PID and comm of a match only (a match is mine); it prints nothing of other processes.
# Run: python3 -I /tmp/aosd8/scripts/sec0_procs.py
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
        mine = b"/tmp/aosd8" in argv or b"aosd8-" in argv
        for link in ("cwd", "exe"):
            try: mine = mine or os.readlink(f"/proc/{d}/{link}").startswith("/tmp/aosd8")
            except OSError: pass
        try: mine = mine or b"\0HOME=/tmp/aosd8" in b"\0" + open(f"/proc/{d}/environ", "rb").read()
        except OSError: pass
        if mine: hits.append((int(d), open(f"/proc/{d}/comm").read().strip()))
    except OSError: continue
print(f"processes of uid {uid} that are mine (excluding this scan and its {len(anc)} ancestors): {len(hits)}")
for pid, comm in sorted(hits): print(pid, comm)
~~~
### /tmp/aosd8/scripts/assemble8.py

~~~~python
# assemble8.py: write the design file from /tmp/aosd8/doc/design.md, with each @@FILE path@@ marker replaced by
# the file's text (terminal colour codes removed) and each @@SCRIPT path@@ marker by a heading and a fenced copy
# of the file (the fence grows until the text does not contain it). The marker check runs on the source, so a
# pasted file may contain "@@". A @@FILE marker of a .md file under /tmp/aosd8/doc/ is a part of the source, and
# its markers are replaced too. A second run rebuilds the same file. Run: python3 -I /tmp/aosd8/scripts/assemble8.py
import os, re, sys

DESIGN = "/home/taisung/.worktrees/agent-orchestrator/ao-52/development/reviews/same_id_design_r8_opus.md"
SOURCE = "/tmp/aosd8/doc/design.md"
ESC = re.compile(r"\x1b\[[0-9;]*m")
MARKER = re.compile(r"@@(FILE|SCRIPT) ([^@\n]+)@@(\n?)")

def text(path):
    return ESC.sub("", open(path, encoding="utf-8", errors="replace").read()).rstrip("\n")

def paste(m):
    kind, path, nl = m.group(1), m.group(2), m.group(3)
    if kind == "FILE":
        if path.startswith("/tmp/aosd8/doc/") and path.endswith(".md"):
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
