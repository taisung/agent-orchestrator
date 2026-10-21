# Same-ID design, revision r4: RW, R2b-1, R2b-2, R3a, R3b and RH after the re-check r3 (ao-52)

Author: ao-52 (Claude Code, Opus 5.5), 2026-10-21. Base `c8a35d47` (design r3 and its tests). Input: the
re-check of design r3 by ao-51 (`development/reviews/same_id_design_review_r3_astra6.md` on `main`,
called "the review" below), design r3 (`development/reviews/same_id_design_r3_opus.md`), and the owner
decisions "1a 2a 3a 4a" of 2026-10-21 (section 11).

This is a design. No source file changed. The commits `49b3b426` and `13c58b2c` change or add tests only.
R2a (ao-55) and R4 (design r2 section 3 with the m-1 change of design r3 section 4) are not designed again.
Sections 2 to 7 are self-contained for what changes; for the parts that do not change they name the
section of design r3.

Measurement names: `t4`, `t4b` (tmux 3.4 on private servers), `t5` (the shipped wrappers and the Claude
hook under bash), `t6` (the inbox append under bash and `strace`), `s1`, `s2` (process groups), `h5`
(Herdr 0.8.0 on isolated scratch servers). Section 9 has the commands and the output, section 15 the
scripts in full.

## 0. Response table

| Finding | Decision | Design r4 | Test (file: test) |
| --- | --- | --- | --- |
| **B-1** (RW) the drain misses the old `gh` wrapper that sourced the old helper | Accepted. The drain finds old writer code by process, not by name: every process with an open descriptor on an OLD inode of a wrapper, helper or hook file (the inodes are recorded before the barrier installs the new files by rename), plus each descendant and each member of its process group, with PID and start ticks. The barrier waits until none runs and never kills. Measured (t5): the wrapper's command line names only `gh`, the name rule of design r3 finds nothing, the inode rule finds it, and an orphaned `mv` keeps the wrapper's group. The Claude hook is installed by rename too: an in-place rewrite makes a running bash run the new file's text (t5 F) | 4.3, 8 | core r4: `(RW) B-1` "a Node write after the barrier installed a new helper is kept against a wrapper that started before" (defect); 1 control (command line, open descriptor, child) |
| **B-2** (R3a) one process group does not contain every descendant | Accepted as narrowed by the owner (OD-14, 2a): the guarantee covers hooks and children that stay in the hook's process group. A child that leaves it (`setsid`, double fork, detached) is outside the guarantee; the docs say so, and design r4 no longer calls the contract enforced. No cgroup or systemd scope. The other R3a points are answered: strict journal validation, PGID reuse (a leader that holds the group until the drain, s2), zombie-only groups, and a marker variable that finds most escaped children and keeps the ID busy (a diagnostic, not a guarantee, s1) | 5 | none new: an escaped child is outside the guarantee. The R3a plan has the tests (section 10); s1, s2 |
| **B-3** (R3b) the store of the lock is not bound to the API request | Accepted: refuse. AO cannot bind an `opencode api` request to a checked store: the CLI finds (or starts) its service for each call, the service is HTTP with a password that AO never reads, and no request names an expected service. R3b sends no OpenCode removal and no interrupt (none can be bound today), keeps the OpenCode session and lists it. A bound transport is a new optional round RO after an owner-approved qualification run (OD-22) | 6.1, 6.5 | core r4: `(R3b) B-3` "a kill with purge sends no removal to a store whose namespace holds a live holder of the session" (defect); 1 control (the stand-in on the real transport) |
| **B-4** (R2b-1) a legacy caller can destroy a new token launch | Accepted: the legacy guard moves into R2b-1 (the rounds stay separate, 2.1). From R2b-1 on, every legacy mutation (the kill, each key and paste step of a send, the attach, the raw core and CLI paths) is one client command whose mutation runs only on a session without a token. Measured (t4): in a race, 0 of 55 guarded legacy kills ended a token launch; a separate preflight read plus a kill ended 4 token launches in 63 kills | 2 | runtime-tmux r4: `(R2b-1) B-4` 2 defects (destroy and sendMessage with a legacy handle reach a later token launch); 2 controls |
| **M-1** (RW) the inbox lifetime | Accepted. The launch ID is in the record before the pane can start (the reservation write), with a launch state `preparing`, `published` or `failed`; lines of a preparing launch are held, and the publishing operation applies them; one inbox file per launch, so a line of another launch never reaches a record; records of at most 4096 bytes (one `write`, t6), hex values (exact for every byte, t6), a resync after an abandoned partial line, bounded processing, a size cap with a notice, a defined place for late lines after the archive, and the epoch check on the applier and on every record maintenance write | 4.2, 4.5 | core r4: `(RW) M-1` "a branch that the pane records while its launch is still preparing is in the record after the spawn" (defect); 1 control |
| **M-2** (R2b-2) a failed association has no recovery | Accepted. A durable association intent (with its token) is in the record BEFORE the tmux step. The tmux compare-and-set compares the server PID, `$N`, `pane_pid` and the token inside tmux; a retry with the intent's token adopts it; an owner-approved clear removes exactly that token. The record step compares the launch identity, not the generation, so a PR or status write no longer fails it. Retained legacy entries get the same protocol in the inventory (t4 part 4) | 3 | runtime-tmux r4: `(R2b-1) M-2` "destroy with the legacy handle keeps its session while a token that no record names is on it" (defect, the safety half); 3 association controls (set, adopt, refuse; another server, `$N` or `pane_pid`; the exact clear) |
| **M-3** (R3b) the holder and quarantine reconciliation | Accepted. In R3b: the own hold has the states `held` and `releasing`; a kill or cleanup releases it only after a proven stop (R2a `destroyed` or `absent`), under its own operation lock, together with the archive; `unknown` keeps it `held`. A hold whose record names the session with another launch identity blocks, as a live hold does, until the record's own next operation or `ao opencode reconcile` writes it again (that action takes the hold's operation lock first, then the store lock). A removed record makes its hold stale only for a strict "does not exist" (ENOENT); every other read error blocks. Every participating state root and configuration is registered in the namespace and backfilled before a reuse may trust a missing hold. The quarantine and its reconciliation move to RO with the bound removal: R3b sends no request whose completion can be unknown | 6.3, 6.5 | the R3b and RO plans (section 10) |
| **M-4** (RH) the bound close is not a complete stop protocol | Accepted. The creation-server incarnation (PID, start ticks, boot ID) is recorded from the peer of the create connection; every connection of the stop checks its peer; a negative answer counts only from the recorded incarnation, or after that incarnation ended; only `pane_not_found` is negative, after a check of the pane ID form (a malformed ID also answers `pane_not_found`, h5); every other answer is `unknown`. A moved socket gives `unknown` (h5: the other server answered `pane_not_found` for a pane that still ran on the hidden recorded server); the owner accepts that such a session stays `unknown` until the socket is right (OD-24). Version pin: 0.8.0, protocol 19 | 7 | the RH plan (section 10); h5 |
| **m-1** `any[]` in the Herdr r3 test | Fixed: `unknown[]` (commit `49b3b426`) | 13.3 | runtime-herdr r3: 4 tests, results unchanged |
| Review notes: the lock rules, `.ao-owner`, the rollout | Accepted: three lock rules with run-time checks (5.6); the owner marker on the actual canonical path at every entry point, created by `link()` so a partial marker cannot exist (5.7); the barrier stops old installers and resident workers, drains the real process trees, and opens admission only after exact checks (8) | 5.6, 5.7, 8 | the R3a plan; the barrier checks |

## 1. What changed from design r3

- **R2b-1** (section 2): the legacy guard (the token guard with an empty expected token) for every legacy
  mutation, in R2b-1 and not in R2b-2. Design r3's "legacy as after R2a" until R2b-2 is withdrawn.
- **R2b-2** (section 3): the association gets a durable intent, an adopt branch, an exact clear and a
  launch-identity compare; the legacy stop with the host assertion checks the `createdAt` window inside
  tmux (t4b), so design r3's residual R-3 (two client commands) is withdrawn.
- **RW** (section 4): the inbox is per launch, with a launch state; the drain is by open inode, process
  tree and process group; the hook is installed by rename; the wrapper version never goes down.
- **R3a** (section 5): the guarantee is narrowed (OD-14, 2a); the group leader holds the group until the
  drain; the journal rules for malformed entries, PGID reuse and zombies; three lock rules; the owner
  marker at every entry point.
- **R3b** (section 6): no unbound OpenCode removal or interrupt (B-3); the holds keep their place in the
  store (OD-21 (a)); the quarantine and the own-holder release move to the new optional round **RO**.
- **RH** (section 7): the stop protocol with incarnation-bound negative evidence.
- **Round claims** (section 8.2): design r3's sentence "each round is safe alone" is withdrawn. Each round
  now states what it protects and what it does not.

## 2. R2b-1: the legacy guard (B-4, OD-18 (a))

### 2.1 Decision: the guard moves into R2b-1

The review offers three ways: move the legacy refusal into R2b-1, join R2b-1 and R2b-2, or forbid every
legacy mutation of a target with a token, atomically. Design r4 takes the third way, in R2b-1:

- It closes B-4 in R2b-1 alone. A token launch exists only from R2b-1 on, and from the same round every
  legacy caller of an R2b-1 build checks the token inside tmux before it mutates.
- It is small. The legacy guard is the token guard of design r3 section 2.3 with an empty expected token:
  one builder, measured on tmux 3.4 (t4 part 2, the race of part 3, the attach of part 5).
- Joining the rounds would put the owner tools of R2b-2 (resolver kinds, audit, association, retire,
  inventory, `where`) into the round that changes every tmux path: one high-risk round of size L plus M.
  OD-18 (a) is decided (owner 3a), so R2b-2 has no open policy left that R2b-1 needs.

### 2.2 The legacy guard

The form (design r3 2.3 with `<token>` empty):

```text
display-message -p 'ao-server:#{pid}'
; has-session -t =<name>
; if-shell -F -t =<name>: '#{==:#{session_name},<name>}'
    'if-shell -F -t =<name>: "#{==:#{session_name},ao.cap.x}"
       { display-message -p "ao-refused:#{pid}" }
       { if-shell -F -t =<name>: "#{==:#{session_name}/#{@ao_launch},<name>/}"
           { <mutation> ; display-message -p "ao-done:#{pid}" }
           { display-message -p -t =<name>: "ao-kept:#{pid}:#{session_id}" } }'
    'display-message -p "ao-refused:#{pid}"'
; display-message -p ao-end
```

The mutation runs only when `@ao_launch` is unset or empty. Every rule of design r3 2.3 applies (the gate,
the explicit targets, the double-quoted formats, the text through `load-buffer`, `ao-end` last).

Measured (t4):

| Case | Answer | Effect |
| --- | --- | --- |
| a session with a token (a new launch) | `ao-server, ao-kept, ao-end`, exit 0 | no kill; no paste, no Enter |
| a session without a token | `ao-server, ao-done, ao-end`, exit 0 | the kill, or the paste and the Enter |
| no session of the name | `ao-server`, exit 1, `can't find session: <name>` | nothing |
| a token set to `""` | as no token | the mutation |
| race (part 3): a racer kills R and makes it again, with a token on every second launch, 200 tries | 55 `done` (0 with a token), 68 `kept`, 77 `absent` | no token launch ended |
| the same race with a preflight read, then a kill (two client commands) | 63 kills, **4 of a token launch** | why the check must be in the same command |
| legacy attach (part 5), with the tail `has-session -t %2147483647` (design r3 2.7) | a token session: no client, `ao-kept`, exit 1; a tokenless session: attached | the CLI exits 1 on `kept` |

### 2.3 Every legacy mutation path

A legacy handle is a handle without `tmuxLaunchToken` (design r3 2.8). From R2b-1 on, every mutation with
such a handle, or with only a session name, uses the legacy guard:

| Path (c8a35d47) | Mutations | R2b-1 |
| --- | --- | --- |
| runtime-tmux `destroy`, the new `stop` (`index.ts:173-175`) | `kill-session -t =<name>` | the legacy guard |
| runtime-tmux `sendMessage` (`index.ts:181-218`) | `C-u`, `load-buffer`/`paste-buffer`, `send-keys -l`, `Enter` | each step the legacy guard; the text always through a buffer |
| runtime-tmux `getAttachInfo`, CLI `session.ts:185-200` | `attach -t <target>` | `AttachInfo.args` with the legacy guard and the `%2147483647` tail |
| core `tmux.ts` `sendKeys`, `killSession` (`:165-226`; exported as `tmuxSendKeys`, `killTmuxSession`, no caller in the repository) | `Escape`, paste, `-l` text, `Enter`; `kill-session` | the legacy guard (they take a name only; the signatures stay, so the public API does not break) |
| CLI `send.ts` `sendViaTmux` (`:122-145`) and the Enter retries (`:362`, `:367`) | `C-u`, paste, `-l` text, `Enter` | the resolver kind decides: the token guard for a launch, the legacy guard for a legacy record. ao-54 changes this file now (its round 3): R2b-1 starts after that change lands |
| runtime-tmux `create`, its cleanup kill (`index.ts:153`) | `kill-session` | the token guard of its own new launch (design r3 2.2) |

The grep test of design r3 2.6 covers runtime-tmux, core `tmux.ts`, CLI `send.ts` and CLI `session.ts`: no
`send-keys`, `paste-buffer`, `kill-session` or `attach` outside the guard builders.

### 2.4 The answers of a legacy mutation in R2b-1

| Guard answer | `stop` (legacy) | `sendMessage`, attach (legacy) |
| --- | --- | --- |
| `done`, exit 0 | `destroyed` | delivered or attached |
| `kept` (the session has a token) | `unknown`: the token belongs to a newer launch or to a failed association, and the runtime cannot tell which (core may refine it with the record; it never removes a workspace on it) | rejected: "the session of `<name>` has a launch token; this legacy record cannot use it" |
| absent (`can't find session`) | as after R2a | rejected |
| `refused`, any other answer | `unknown` | rejected |

`destroy` with a legacy handle runs `stop` and rejects on `unknown` (design r3 2.5 for new handles). The
two B-4 defects and the M-2 defect of runtime-tmux r4 assert only that the token session stays; they
accept a rejection.

### 2.5 R-1 for the legacy guard

t4 part 6: a pane option `@ao_launch ""` shadows the session option in a format, so the legacy guard sees
no token and kills a token launch. AO never sets a pane option. Only a process of the same uid that edits
tmux on purpose can do it, the same trust level as editing a record. For a new launch the same shadow
gives only `kept` or `unknown` (design r3 R-1). The owner accepts or rejects this extended R-1 (OD-23).
tmux 3.4 has no format that reads only the session scope, and a `show-options` call cannot be a condition
without a wait point, so no atomic form avoids it.

### 2.6 What R2b-2 adds for legacy records

- **The legacy stop with the host assertion** (`legacyTmuxServer: default`): the createdAt window moves
  into the guard. The inner condition is
  `#{&&:#{==:#{session_name}/#{@ao_launch},<name>/},#{&&:#{e|>=:#{session_created},<createdAt-15>},#{e|<=:#{session_created},<createdAt+1>}}}`,
  and a second gate refuses when `#{e|>=:#{session_created},#{e|+:#{session_created},1}}` is TRUE (a tmux
  without the numeric operators). Measured (t4b): inside the window TRUE, outside FALSE, with a token
  FALSE, the gate FALSE on 3.4; an unknown `e|` operator gives FALSE (fail-closed); an unknown plain
  operator over a nested format gives TRUE, so the gate is needed. This removes design r3's residual R-3.
  Without the assertion, a legacy stop stays `unknown` (design r3 2.5).
- **The legacy send** (OD-18 (a), decided): the legacy guard (from R2b-1) plus the one-line notice once per
  session.
- A `$N` with digits stays literal in a branch string (t4b: `$11` compares equal; `$HOME` expands). The
  association forms still avoid `$` with `#{s/^.//:session_id}` (design r3 rule "no `$` in a branch").

## 3. R2b-2: the association with recovery (M-2)

### 3.1 The intent

A new record key `associationIntent` (JSON): the token `T` (128 random bits), the evidence (socket,
server PID, server start ticks, boot ID, `$N`, `pane_pid`, the pane process start ticks,
`#{session_created}`), the evidence hash, `createdAt`, and the PID of the writer. It joins
`LAUNCH_IDENTITY_KEYS` (`metadata.ts`), so an operation that read the record before the intent fails its
conditional write, as for a reservation.

### 3.2 `ao session associate <id> --evidence <hash>`

1. Read the record strictly. Its kind must be `legacy` (no association), or `associating` with the same
   evidence hash (a retry).
2. Check the evidence again (design r3 2.9): the server process (PID, ticks, boot ID) runs; `$N`,
   `pane_pid`, the pane start ticks and `#{session_created}` are unchanged. A change refuses: "the
   evidence changed; run `ao session audit` again".
3. Write the intent, unless a retry: `updateMetadataIf(dir, id, launchIdentity(record), { associationIntent })`.
   The condition is the launch identity, not the generation. A PR, status or branch write changes no launch
   identity key (`metadata.ts` header), so it does not fail this step (the review: "a PR/status write is
   enough to make the record CAS fail").
4. The tmux compare-and-set (t4 part 4), with `IDENT = #{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}`:
   - `IDENT == <server PID>/<name>/<N>/<pane_pid>/` (no token): `set-option -t =<name>: @ao_launch T`,
     then `ao-assoc`;
   - else `IDENT == <server PID>/<name>/<N>/<pane_pid>/T`: `ao-assoc-adopt` (an earlier attempt set it;
     nothing changes);
   - else `ao-assoc-refused:<the values that tmux sees>`.
   The server gate and `has-session` of design r3 2.3 come first. The server PID is inside the check; its
   start ticks and boot ID are checked in step 2 and again in step 5. A process keeps its PID for its
   whole life, so the same PID with the same ticks before and after the command is the same server
   throughout.
5. After the command: the server PID and ticks, and the pane start ticks, again. A change: stop with
   `unknown`; the intent stays (3.3).
6. The record step: `updateMetadataIf(dir, id, launchIdentity(recordWithIntent), { runtimeAssociation: <T and the evidence>, associationIntent: "" })`.

Measured (t4 part 4): the design r3 form refuses a retry after a failed record step (the token stays,
stranded); the design r4 form sets the token, adopts it on a retry, refuses another token, refuses
evidence with another server PID, another `$N` or another `pane_pid`, refuses after `respawn-pane -k` and
after a new session of the name, and refuses evidence of another server whose `L` has the same `$0`.

### 3.3 Crash points and recovery

| Stop after | tmux | Record | Next action |
| --- | --- | --- | --- |
| step 3 | no token | intent `T` | `associate --resume`: steps 2 to 6 (the compare-and-set sets `T`); or `--abandon` (below) |
| step 4, answer lost | `T` | intent `T` | `--resume`: the compare-and-set answers `adopt`; then step 6 |
| step 5 or 6 (the launch identity changed: a restore or a kill read the record first) | `T` | another launch, or archived | the restore or kill ran its own stop with the resolver kind of the record that it read (3.4); `T` is then on a session that the stop ended, or the stop answered `unknown` and nothing went on (R2a) |
| step 2 or 4 refused (the evidence changed) | another token, or none | intent `T` | `--abandon`, then a new audit |

`ao session associate <id> --abandon --confirm`: the exact clear (t4 part 4): inside the same server gate,
`IDENT == <server PID>/<name>/<N>/<pane_pid>/T` gives `set-option -u -t =<name>: @ao_launch`; any other
value gives `ao-assoc-refused` and changes nothing. Then a conditional write removes the intent. A token
with no intent (only a same-uid actor can make one, R-1) is shown by the audit as "foreign token" with a
fingerprint (a hash of the token, never the token); `ao session clear-token <id> --fingerprint <f> --evidence <hash> --confirm`
reads the token from tmux, checks the fingerprint, and runs the same exact clear. No other operation
clears or kills a session that carries a token that no record names (the M-2 defect).

### 3.4 The resolver kind `associating`

`resolveRuntimeIdentity` (design r3 2.9) gets a fourth kind: a record with an intent. `stop` uses the
token guard with `T`; if the session has no token, the legacy rules (2.4, 2.6); if it has another token,
`unknown`. `send` and attach use the legacy guard, which answers `kept` once `T` is set: no message reaches
a session in the middle of an association. `ao status` shows "association pending: run `ao session associate <id> --resume` or `--abandon`".

### 3.5 Retained legacy entries

A `legacy-unproven` inventory entry (design r3 2.9) gets `ao session associate-retained <entry> --evidence <hash>`:
the same steps, with the intent and the association written into the inventory entry (write, fsync,
rename, directory fsync, under a record lock named for the entry). Then `stop-retained` uses the token
guard. Design r3's "associate first" is now this command.

## 4. RW: the supported writers (B-1, M-1, OD-20 (a))

Kept from design r3 5.6: the shell writers stop writing the record and append to an inbox; a Node applier
writes the record under the record lock; the keys and their checks stay as today (`pr`, `status` =
`pr_open` or `merged`, `branch`); `AO_LAUNCH_ID` and the record key `launchId`. Changed: everything below.

### 4.1 The writers and what they run

| Writer | How it runs (t5) | What runs old code after a file replace |
| --- | --- | --- |
| `~/.ao/bin/gh` (`GH_WRAPPER`) | `bash <path>/gh <args>`; it sources the helper (`agent-workspace-hooks.ts:418`), runs the real gh as a child (`:429`), then calls the in-memory `update_ao_metadata` (`:435-436`) | the wrapper process: bash keeps fd 255 open on the wrapper file, which reads `<path> (deleted)` after a replace by rename |
| `~/.ao/bin/git` (`GIT_WRAPPER`) | `bash <path>/git <args>`; it runs the real git, then sources the helper on a branch change (`:534`) | the same (t5 E) |
| `~/.ao/bin/ao-metadata-helper.sh` | sourced; not a process of its own | the wrapper that sourced it |
| `<worktree>/.claude/metadata-updater.sh` | `/bin/sh -c .claude/metadata-updater.sh`, then `bash .claude/metadata-updater.sh` (t5 D) | the bash process (fd 255 on the hook file) |

### 4.2 The launch ID and the launch state (M-1: publication)

The spawn makes the launch ID `L` (128 random bits, 32 hex digits) BEFORE the reservation write. The
reservation write (`reserveSessionRecord`) contains `launchId=L` and `launchState=preparing`, and Node
creates the empty inbox file of `L` (4.4) in the same step. The pane environment gets `AO_LAUNCH_ID=L`.
So no pane, hook or wrapper of `L` can start before the record names `L`.

| `launchState` | Set by | The applier |
| --- | --- | --- |
| `preparing` | the reservation write (spawn) or the pre-launch write of a restore | does not read the inbox of `L`: the lines wait in the file |
| `published` | the launch publish write (`ownLaunchRecord`, `session-manager.ts` near 1611) | applies the lines of `L` (4.5) |
| `failed` | the rollback of the launch | never applies them; they stay with the record or its archive and `ao status` lists them |

**The publish applies the held lines.** The publish write of the spawn (today the `launchedRecord` merge,
near `session-manager.ts:2157`) runs, in ONE record write under the record lock: the launch fields (as
today), then every complete line of `L` in file order, then `launchState=published` and the cursor. The
lines come after the launch fields, because they are newer facts from the pane. The M-1 defect of core r4
shows the loss today: the pane writes `branch` before the publish, and the publish writes
`branch=session/app-1` over it.

**A restore** (after R2a, ao-55 changes restore now): under its operation, it first applies every complete
line of the old launch, then writes the new `launchId=L'` and `launchState=preparing` with the launch
identity condition, then starts the pane with `AO_LAUNCH_ID=L'`. A later line of the old launch is a late
line (4.6).

`launchId` joins `LAUNCH_IDENTITY_KEYS` (`metadata.ts:331`). `launchState` and the cursor do not: they
change inside one launch.

**Panes from before RW** have no `AO_LAUNCH_ID`. Their lines go to the file `legacy.ndjson` (4.4). The
applier applies `legacy.ndjson` only to a record without `launchId`, which is a launch from before RW. A
record with `launchId` (every reservation from RW on) never takes a line of `legacy.ndjson`: such a line
is listed and never applied. This closes the review's case "an empty-launch entry from an older legacy pane
matches a new record that does not yet have launchId".

### 4.3 The drain of old writer code (B-1)

The barrier (section 8) closes admission, stops the old `ao` processes, and then:

1. **Record the old inodes.** Before it installs anything, it records `(dev, ino)` of
   `~/.ao/bin/ao-metadata-helper.sh`, `~/.ao/bin/git`, `~/.ao/bin/gh` and of
   `<worktree>/.claude/metadata-updater.sh` of every active record.
2. **Install by rename**, in this order: the helper, `git`, `gh`, the hooks, `.ao-version` last. Each file
   is a temporary file in the same directory, fsync, rename (4.7). The new helper keeps the function name
   `update_ao_metadata`, so an old wrapper that sources the new helper writes the inbox.
3. **Find the old writer processes** (one scan of `/proc` of the uid): a process is a **hit** when one of its
   open descriptors (`stat` of `/proc/<pid>/fd/<n>`, which follows the link also to a deleted file) has
   one of the recorded inodes, or its link text is `<one of the four paths> (deleted)` (a writer of an even
   older install).
4. **The drain set** `S`, with `(pid, start ticks)` for each member, built again at each poll (every 25 ms):
   - every hit;
   - every process whose parent is a member (the real gh, `tee`, the helper's `sed` and `mv`);
   - every process whose process group is the group of a member, and whose start ticks lie between the
     start of the first member of that group and the last poll that saw a member of that group alive
     (t5 C: a wrapper ended by SIGKILL leaves its `mv` child with parent 1 and the wrapper's group; only
     this rule finds it);
   - never a process that started before the first member of its group (the agent, its tool shell).
5. **Wait** until no member of `S` runs (a member is gone when its PID is absent or has other start ticks)
   and two scans, 100 ms apart, find no new member. The barrier never stops a member. After 10 minutes it
   stops waiting and shows each member (PID, command line, group, parent, age); the owner waits more or
   ends that agent by its exact PID.

Why this is enough for the supported writers: every old writer code that can still run is the text of one
of the four files, run by a bash that holds the file open (t5 A, D, E), or a child or group member of such
a run. A copy of a wrapper in another place, and a process that leaves its process group, are outside the
supported set (section 12).

The false positives are processes of the agent's process group that started during a wrapper run (for
example another tool command). The barrier waits for them too. This is safe, and they end with their
command.

Measured (t5): the review's case (A): the wrapper's command line is `bash /tmp/aosd4/rw/bin/gh pr create`;
the name rule of design r3 5.6 finds nothing; fd 255 has the old inode and reads `(deleted)`; the inode
rule finds the wrapper; the drain members are the wrapper, the real gh, `tee`, and a grandchild. With the
drain (B): 18 polls, 695 ms, 14 members recorded; the Node write after the drain keeps `runtimeHandle=new`
and the PR. Without it (A): the record has `runtimeHandle=old`.

### 4.4 The inbox files and the record format

- **Place:** `<sessions dir>/.inbox/<sessionId>/<launchId>.ndjson`, and `<sessions dir>/.inbox/<sessionId>/legacy.ndjson`
  for a pane without `AO_LAUNCH_ID`. Node creates the directory and the file of `L` with `O_EXCL` at the
  reservation; the RW barrier creates the directory and `legacy.ndjson` for every active record from
  before RW. **The writer never creates a directory.** It checks that the file exists (`[ -f ]`) and then
  appends; a missing file or directory (an archive moved it) makes it write the orphan file (4.6).
- **One record per append:** the writer builds the whole record in one variable and runs one
  `printf '%s' "$rec" >> "$file"`. bash 5.2.21 opens with `O_WRONLY|O_CREAT|O_APPEND` and writes a record
  of up to 4096 bytes with ONE `write()`; 4097 bytes take two (t6 part 1). The writer refuses a record over
  4000 bytes and a value over 1024 bytes, with a notice on stderr and exit status 0 (a refused write must not
  fail the user's `gh` or `git`).
- **Format:** `RS "1" SP <launch or "-"> SP <key> SP <hex value> SP <unix ms> LF`, with `RS` = byte 0x1e.
  The value is hex-encoded in pure bash (`LC_ALL=C`, `printf %02x "'$c"` per byte), exact for every byte
  0x01 to 0xff (t6 part 2), so no value can hold `RS`, `LF`, a quote or a backslash. A branch with a quote,
  a backslash and UTF-8 encodes as `666561742f6122625c632dc3a9` (t6).
- **Resync:** the applier splits the file at `RS`. A part without its final `LF` before the next `RS` is an
  abandoned fragment (a writer that died in a short write): the applier skips it, logs it, and the next
  record (which starts at its own `RS`) is intact. So a fragment never takes a valid record with it (the
  review's case "a writer dying midway through a line"). A part without `LF` at the end of the file can
  be a write in progress: the applier stops before it and reads it at the next call.
- **Parallel writers:** four writers of 500 records each gave 2000 well-formed lines (t6 part 3).
- **Size cap:** the writer refuses to append to a file of 1 MiB or more (a notice on stderr). `ao status`
  warns from 512 KiB. A new launch starts a new file, so the cap counts the writes of one launch (about
  7000 records of 150 bytes). No file is rotated, truncated or rewritten by anyone.

### 4.5 The applier (M-1: bounded processing, cursor, epoch)

`applyInbox(sessionId)` in core (new `core/src/inbox.ts`):

1. Read the build epoch (r3 5.7). A larger value, or an unreadable or malformed file: do nothing and log.
2. Take the record lock (`withRecordLock`, synchronous: no await inside, 5.6).
3. Read the record strictly (R4). `launchState` is not `published`: return (held, or failed).
4. Select the file: `<launchId>.ndjson` for a record with `launchId`, else `legacy.ndjson`.
5. Open it, `fstat`. The cursor is the record key `inboxCursor` = `{"launch":L,"dev":d,"ino":i,"off":n}`.
   No cursor: start at 0 and take the file's `(dev, ino)`. A cursor of another launch or another
   `(dev, ino)`, or an offset past the end: stop, log, and show "inbox replaced" in `ao status` (nothing
   writes an inbox file except by append, so this is damage, not a normal case).
6. Read at most 64 KiB from the offset (`readSync`). Apply each complete record of this launch with the
   checks of today's helper; a record of another launch (a damaged line) or a bad value: skip and log.
7. Read the epoch again; then ONE record write with the new values and the new cursor (the generation goes
   up as for every locked write).
8. Release the lock. Return the count and "more" when the 64 KiB limit stopped it.

Callers: the lifecycle poll (one call per session per poll); every mutating operation, under its operation
lock, before it reads the record for a decision (until no "more", at most 16 calls); the publish (4.2);
the restore (4.2); the archive (4.6). `ao status` stays read-only: it reads the pending records and shows
them as pending.

**Epoch:** the epoch check covers `applyInbox` and every record write of a worker (status, PR, activity,
recovery bookkeeping), not only the lifecycle reactions: a worker reads the epoch before each record write
(design r3 5.7 changed by this sentence). An epoch test with a newer epoch file covers `applyInbox` (R2a
plan, section 10).

**A backlog without an applier:** with no worker and no mutating command, the lines wait in the file up to
the cap. `ao status` shows them. The next applier applies them in order. Nothing expires.

### 4.6 The archive, late lines and orphans

- **Archive** (kill, cleanup, retire): under the operation, the record lock: apply the inbox to its end
  (`applyInbox` until no "more"), then rename `.inbox/<sessionId>/` to
  `<archive dir>/<sessionId>_<ts>.inbox/` in the same archive step that moves the record, with the cursor in
  the archived record.
- **Late lines:** a writer that opened the file before the rename appends to the archived file. Lines after
  the archived cursor are "late lines": `ao session show` of the archive and `ao status --archived` list
  them. Nothing applies them.
- **Orphans:** a writer that finds no inbox directory appends its record (with the session ID) to
  `<sessions dir>/.inbox/orphans.ndjson`, which the RW barrier creates. `ao status` lists the orphan count
  and the last records. Nothing applies them. An owner command `ao session inbox --orphans --clear --confirm`
  truncates the file after it prints it.
- **Restore of an archive:** a new launch `L'` with a new file. The archived late lines stay with the
  archive. A restore never reads them as current (the review's case "a restore can consume them as stale").

### 4.7 Installation

- **The hook by rename.** `setupHookInWorkspace` (`agent-claude-code/src/index.ts:684-697`) writes
  `metadata-updater.sh` with `writeFile` today: in place, the same inode. t5 F: a running bash script whose
  file is rewritten in place runs the NEW text from its current offset (a mix of two versions); a rewrite
  by rename keeps the old text for the run. RW writes the hook with the atomic temp-file-plus-rename write
  that `setupPathWrapperWorkspace` already uses (`atomicWriteFile`). `settings.json` keeps the same command
  path, so Claude Code needs no restart.
- **The wrapper version never goes down.** Today the check is an equality (`WRAPPER_VERSION` "0.2.6" against
  `.ao-version`), so an old build rewrites newer wrappers (host note). From RW: the installer rewrites only
  when the installed version is LOWER (numeric compare of each part); an equal or higher version, or an
  unreadable `.ao-version`, is left alone with a log line. An old build still has the equality check, so the
  barrier stops every old `ao` process before it installs (section 8), and checks the hashes of the
  installed files again after the new workers start.
- **The fixed temp name** `${metadata_file}.tmp` of the hook goes away with the record write.

### 4.8 What RW protects alone, and what it does not

Protects: no shell writer writes a record (no lost launch-identity write, no generation that goes back); a
pane line reaches only its own launch; a line of a preparing launch is applied by the publish; a legacy line
never reaches a new launch; the inbox is bounded; the epoch fences every worker write. Does not protect:
the tmux identity (R2b-1), a copy of a wrapper outside `~/.ao/bin`, a pane process that runs an old
wrapper text that it copied, and a process that left the process group of a wrapper run (section 12).

## 5. R3a: one operation per ID, with the narrowed child guarantee (B-2, OD-14 as narrowed)

Kept from design r3: the operation lock (5.1 there), the worktree policy (5.3, with 5.7 here), F-1 and F-2
(5.4), the rollback (5.5), the epoch (5.7, with 4.5 here).

### 5.1 The guarantee (owner decision 2a)

The docs (`docs/` page of R3a, and `agent-orchestrator.yaml.example` next to `postCreate`) say:

> AO supports `postCreate` hooks and other mutating children that do not start daemons: no `setsid`, no
> double fork, no detached process. AO records the hook's process group before the hook starts, and ends
> every process of that group when the hook ends. A process that leaves the process group is outside this
> guarantee: AO does not wait for it, does not end it, and it can change the worktree after the operation
> ends. AO shows such a process when it finds it.

Design r4 does not call the contract enforced. No cgroup and no systemd scope (owner decision 2a). The
OD-14 sub-option of design r3 (a systemd user scope) is withdrawn.

### 5.2 The leader holds the group (PGID reuse)

`runMutatingChild` (design r3 5.2) changes its first step. The leader is:

```sh
sh -c 'trap : TERM; IFS= read -r go || exit 99; "$@"; rc=$?; echo "rc=$rc"; IFS= read -r done; exit $rc' ao-leader <file> <args...>
```

spawned with `detached: true` (a new session and group; the group ID is the leader's PID) and
`AO_MUTATING_CHILD=<journal id>` in its environment. The leader does not `exec` the command: it runs it as
a child, prints its exit status, and waits for a second line. So the leader's PID, which is the group ID,
stays in use until AO writes `done`. `trap : TERM` is a handler, not an ignore, so the command (after its
`exec`) gets the default SIGTERM.

The steps:

1. Spawn the leader; write the journal entry (5.3); write `go`.
2. Read `rc=<n>` (the command ended) or reach the timeout (SIGTERM to `-pgid`, the grace time, SIGKILL to
   `-pgid`).
3. Drain the group: SIGTERM to `-pgid`; scan `/proc` for members (group = pgid, not the leader) until none
   runs; SIGKILL to `-pgid` after the grace time.
4. Scan `/proc` of the uid for `AO_MUTATING_CHILD=<journal id>` outside the group (an escaped process,
   5.4).
5. Write `done`; the leader exits; remove the journal entry (unless step 4 found a process); return.

**PGID reuse.** The leader is AO's child, so its PID stays allocated until AO reaps it. AO sends a signal to
`-pgid` only while the leader is not reaped (in Node: `child.exitCode === null && child.signalCode === null`;
libuv reaps the child and runs the exit callback in one step, so no JavaScript runs between them). A SIGKILL to the group also ends the leader. After
the leader's exit, AO never signals that group again. Recovery (5.3) never sends a signal. Measured (s2):
SIGTERM to the group ended the command and its grandchild, the leader stayed and printed `rc=143`, the group
then had only the leader, and `done` ended it; EOF before `go` gave exit 99 and no command; EOF after the
command (the supervisor died) ended the leader and left the grandchild in the group, which the journal
covers.

**Zombie members.** A member in state `Z` runs no code. The drain (step 3) and the recovery (5.3) count a
member as ended when two scans, 100 ms apart, find the same set of members and all of them are `Z`, and log
"zombie members <pids> of group <pgid>, parent <ppid>". s1 part 1: a zombie-only group answers
`kill(-pgid, 0)` = 0, so `kill(-pgid, 0)` alone is not used as the busy test. AO reaps its own leader; a
zombie's parent reaps the others (an orphan's parent is the subreaper).

### 5.3 The journal: strict entries and recovery

**Entry** `<project state dir>/children/<sessionId>/<journal id>.json` (the name is the random journal ID,
not the PGID, so a reused number never collides). Fields, all required: `version` (1), `journalId`, `pgid`,
`leaderStartTicks`, `bootId`, `aoPid`, `aoStartTicks` (for the diagnostics only: an entry stays after its
operation when step 4 of 5.2 found an escaped process), `kind`, `sessionId`, `argv`, `startedAt`. A Zod schema
checks each entry. Write, fsync, rename, directory fsync, before `go`.

**Recovery** (the next operation on the ID, under its operation lock, before it reads the record for a
decision). For each entry:

| Entry | Result |
| --- | --- |
| unreadable (any error other than ENOENT), not JSON, not the schema, an unknown version, a name that is not its `journalId` | **busy**: "journal entry <path> cannot be read; check it, then run `ao session children <id> --forget <journal id> --confirm`". Never stale |
| another boot ID | stale (a reboot ended every process): remove it |
| the leader (`pgid` with `leaderStartTicks`) runs | busy: the command or its group still runs; show the members |
| a process has the PID `pgid` with other start ticks | the old group is empty (Linux frees a PID number only when no task uses it as PID, thread group, process group or session: `kernel/pid.c`, `__change_pid` calls `free_pid` only when `pid_has_task` is false for every type), so a member with this group ID belongs to a later group; go to the escape check |
| no process has the PID `pgid`, and no process has the group `pgid` | the group is empty; go to the escape check |
| no process has the PID `pgid`, and processes have the group `pgid` | all `Z` in two scans: stale with the zombie log; else **busy** with their PIDs and command lines and the note "this can be a later group with the same number: if so, run `--forget`" (a false busy is possible only when a later group also lost its leader; it is visible and the owner decides) |
| escape check: a process of the uid has `AO_MUTATING_CHILD=<journal id>` in `/proc/<pid>/environ` | busy, with "a process left the hook's process group (unsupported, see the docs)" and its PID and command line |
| escape check finds nothing | stale: remove it |

The escape check is a diagnostic, not the guarantee: a process can drop its environment (s1: an `env -i`
child had no marker; it stayed in the group and the drain ended it). s1 part 4: a `setsid` child and a
double-forked daemon kept the marker, left the group, and were found by the marker scan 0.63 s after the
hook started.

`ao session children <id>` lists the entries and what runs. `--forget <journal id> --confirm` removes one
entry under the operation lock after it prints the processes.

### 5.4 What the supervisor cannot do

- A process that left the group and dropped the marker is not found. Outside the guarantee.
- unshare is blocked on this host (AppArmor `apparmor_restrict_unprivileged_userns=1`; a `uid_map` write is
  refused), so no test can force a PGID reuse in a PID namespace. The PGID rules rest on the kernel rule
  above and on the leader that holds the group, which s2 measures.

### 5.5 Unchanged parts of R3a

Design r3 5.1 (the operation lock, token release, no holder expiry), 5.4 (F-1, F-2) and 5.5 (rollback).

### 5.6 The lock rules (review notes)

1. **At most one operation lock per operation, and never an operation lock under the store lock or a record
   lock.** The operation lock module keeps the held locks of the current operation in an
   `AsyncLocalStorage` context. A call that takes an operation lock while the context holds an operation
   lock, a store lock (`opencode-session`) or a record lock throws a programming error at once. An action
   that needs another session's state (the reconcile of 6.3) is a separate operation: it takes that
   session's operation lock first, then the store lock.
2. **Forward the token.** A nested function takes the caller's token. A call that takes the operation lock
   of a subject that the context already holds throws "forward the token" at once (without this rule it
   waits 30 s for itself and then refuses).
3. **No await under the record lock.** `withRecordLock` (`metadata.ts:292`) takes a synchronous function. It
   throws a programming error (after the release) when the function returns a thenable. The store lock and
   the operation lock are asynchronous, so a synchronous function cannot take them: the record lock is
   always the innermost lock.

Order: operation (own) → `opencode-session` (store, S) → record. Tests (R3a plan): each rule has a test that
expects the throw, and a grep test that no `await` is inside a `withRecordLock` callback.

### 5.7 The owner marker at every entry point (review notes)

- **Create without a partial file:** write the content (version, canonical state root, config path hash,
  project ID, `createdAt`) to `.ao-owner.tmp.<random>` in the same directory, fsync, `link()` it to
  `.ao-owner` (EEXIST when another creator won), unlink the temporary file, fsync the directory. So
  `.ao-owner` never exists with partial content, which `O_EXCL` plus a write cannot give after a crash. The
  loser reads the winner's marker and compares.
- **Read strictly:** ENOENT is "no marker"; any other error, a parse error, a schema mismatch, an unknown
  version, or another owner: refuse.
- **No marker:** only the first spawn of a project (the project directory is new or empty) creates one. An
  existing project directory without a marker, after the R3a barrier wrote the markers, refuses.
- **The actual path:** every entry point that creates, removes or restores a worktree canonicalizes the path
  that it will touch (the record's `workspacePath`, the restored path, the plugin's argument), checks that it
  is `<canonical worktree root>/<projectId>/<sessionId>`, and reads the marker of that parent. A path
  outside this layout refuses. Entry points: workspace-worktree `create`, `destroy`, `restore`, `postCreate`;
  core spawn, kill, cleanup, restore, rollback; the recovery actions; `retire`. The plugin gets the owner
  identity from core in a new optional argument; a destructive plugin call without it refuses.

## 6. R3b: OpenCode with no unbound request (B-3, M-3)

### 6.1 Decision: refuse (B-3)

AO cannot bind an `opencode api` request to a store today:

- `callOpenCodeApi` (`opencode-api.ts:285-301`) runs `execFile("opencode", ["api", ...])` for each call.
  The CLI finds the background service for its environment, and starts one when none answers
  (`development/0009_opencode_2x_api_fit_design.md` section 3). Each call selects its service again.
- The service is HTTP on a TCP port with basic auth; the password is in the store's `service.json`, which AO
  never reads (note 0009 section 2). AO cannot make the request itself, and it has no socket peer to check.
- `opencode api` has `--server` and `--standalone` (note 0009 section 3, from `--help`), but no flag that
  names an expected service or store, and no run qualified them for this use.

So R3b sends **no** `session.remove` and **no** `session.interrupt`:

| Caller | c8a35d47 | R3b |
| --- | --- | --- |
| core kill with `purgeOpenCode`, cleanup purge (`deleteOpenCodeSession`, `session-manager.ts` near 410-458 and 2940) | interrupt, then remove | neither; the archived record keeps `opencodeSessionId`, the output says "OpenCode session <S> kept: AO cannot bind a removal to its store (see `ao status`)" |
| core rollback of a failed launch | interrupt or remove | neither; listed in the `launchFailed` notice |
| agent-opencode `discard` (`agent-opencode/src/index.ts:499-535`) | remove the session that this spawn created | keeps it, with the same notice |

The OpenCode session stays in its store: no data loss; the store keeps unused sessions. The runtime stop
(R2a) ends the agent process, so no interrupt is needed for a stop. The B-3 defect of core r4 turns green
with this rule (no removal reaches store B).

### 6.2 The holds, with the intended store

The holds namespace stays in the store (OD-21 (a), decided): `<store>/ao-holds/holds/<S>/<owner-key>.json`,
under the lock `opencode-session(<store key>, S)`. Because no service peer is checked (6.1), the store key
is the **intended** store: `<XDG_DATA_HOME, or HOME/.local/share>/opencode` from the environment that AO
gives the session's `opencode` processes, identified by its `(dev, ino)` and its canonical path. The
residual: a service that another environment started can answer a session's request (host note
"opencode api starts a service with the caller env"). The holds then protect the intended store, and the
reuse may split continuity. No data is lost, because R3b removes nothing.

### 6.3 Hold states and reconciliation (M-3)

| Hold | Meaning | A reuse of S by another session |
| --- | --- | --- |
| `held`, the record names S with the hold's launch identity | live holder | refuse |
| `held`, the record names S with another launch identity | a crash between the record write and the hold write | refuse ("pending reconcile"), as live |
| `releasing`, the record is in the archive or does not exist (ENOENT) | the release did not finish | stale: remove under the lock |
| `releasing`, the record names S with the hold's launch identity | the archive did not happen | back to `held` |
| any state, the active record does not exist (ENOENT) | a removed record | stale: remove under the lock |
| any state, the record or the hold cannot be read (other errors, malformed, another schema), the state root of the hold cannot be read | unknown | refuse |

- **Own release after a proven stop.** A kill or cleanup of the record that holds S: under its own operation
  lock, after R2a's stop answered `destroyed` or `absent`: write `releasing` (store lock), archive the record,
  remove the hold (store lock). `unknown` or `other-launch` keeps the record and the hold `held`.
- **Claim before publish.** A reuse or a restore that names S writes its hold (with the new launch
  identity) before it publishes the record. A record write that stops naming S removes the hold after it.
- **Reconcile.** The record's own next operation writes its hold again from the record. `ao opencode
  reconcile <S>` does the same for one hold: it takes the hold's session operation lock FIRST, then the store
  lock (5.6 rule 1), reads the record strictly, and writes or removes the hold.
- **Participants.** `<store>/ao-holds/participants.json` lists each (canonical state root, config path hash)
  that uses the store, with `backfilled: true|false`. The first R3b command of a configuration adds it with
  `false`; `ao opencode backfill-holds --confirm` writes a hold for every active record of every project of
  that configuration that names an OpenCode session, then sets `true`. A reuse refuses while any listed
  participant has `false`. The R3b barrier (section 8) runs the backfill for every state root and
  configuration that the owner names, and opens admission only when each is `true`. A configuration that the
  owner does not name is outside the coverage: the barrier prints the list for the owner.

### 6.4 R3b and the review's other R3b points

The core r3 B-4 test (cleanup of one project keeps an OpenCode session that another project names) turns
green with 6.1 (no removal) and stays a regression check for RO. Its control "another project that names
another OpenCode session does not stop the cleanup" stays: the cleanup still runs and archives; it only
sends no removal (13.7).

### 6.5 RO (new, optional): the bound OpenCode transport (OD-22)

RO starts only after a qualification run that the owner approves (an isolated store, no model turn, no
login; host note "isolated OpenCode store has free models": disable the provider). The run checks, in this
order of preference:

- **RO-1:** an upstream option that makes `opencode api` refuse when the service is not an expected PID or
  store (a request to upstream).
- **RO-2:** `opencode api --standalone` with `XDG_DATA_HOME` pinned: if it runs the request in its own
  process on the named store, the request is bound by construction.
- **RO-3:** `--server <url>` with `server.info` before and after (its `pid`, then `/proc/<pid>` start ticks
  and the data directory). Not exact: the service can change between the checks. Only with the owner's
  acceptance.

RO adds the removal with the quarantine of design r3 6 (step 4), and the reconciliation that the review asks
for (M-3 (2)): a quarantine entry is cleared only by a bound, authoritative answer: success, or "not
found" for a removal; for an interrupt, a proven stop of the session's runtime (an interrupt has no effect
after the agent ended) or a bound read that shows the session idle. When the quarantining process (PID and
start ticks) has ended, a later remover runs that bound read under the store lock. Without a bound transport,
the owner runs `ao opencode reconcile <S> --removed|--present --confirm` after a check by hand. A quarantine
never expires.

## 7. RH: the Herdr stop protocol (M-4)

RH stays optional (OD-19 (a), decided): until RH, Herdr `stop` answers `unknown` and closes nothing.

### 7.1 Records and the creation incarnation

At create, the record keeps the pane ID, the terminal ID, the socket path, and the **creation incarnation**:
the peer PID of the create connection (`SO_PEERCRED`), its start ticks (`/proc/<pid>/stat`) and the boot ID.

### 7.2 The stop

Before any request: the recorded pane ID must match `^w[0-9]+:p[0-9]+$` and the terminal ID
`^term_[0-9a-f]+$`; else `unknown` (h5: Herdr answers `pane_not_found` also for the ID `not a pane`, so the
answer alone does not prove absence).

Each connection (one request per connection, design r3 8.7) reads its peer, and AO compares it with the
recorded incarnation:

| Peer of the connection | Answer of `pane.get <pane>` | Stop result |
| --- | --- | --- |
| the recorded incarnation | `pane_info` with the recorded terminal | the close on a second connection, sent only when that connection's peer is the recorded incarnation (else `unknown`, no close); then `pane.get` on a third connection with the same peer check: `pane_not_found` gives `destroyed`; anything else `unknown` |
| the recorded incarnation | `pane_info` with another terminal | `other-launch`, no close |
| the recorded incarnation | error `pane_not_found` | `absent` |
| another process; the recorded incarnation ended (PID absent, or other start ticks, or another boot ID) | `pane_info` (any terminal) | `other-launch`, no close (h5 2b: the restored pane has a new terminal) |
| another process; the recorded incarnation ended | `pane_not_found` | `absent` |
| another process; the recorded incarnation runs | any | `unknown`, no close (h5 2c: the other server answered `pane_not_found` while the pane ran on the hidden recorded server) |
| no connection: `ECONNREFUSED`, `ENOENT` | - | `absent` if the recorded incarnation ended, else `unknown` |
| any | `invalid_request`, `workspace_not_found`, an unknown code, a malformed or partial envelope, a missing field, no answer before the timeout | `unknown` |
| the peer cannot be read (`SO_PEERCRED` or `/proc` fails) | - | `unknown` |

A reused PID has other start ticks, so it counts as "ended" only through the start ticks and boot ID, never
through the PID alone.

### 7.3 Versions

RH runs only on a qualified pair of version and protocol from `ping` (now 0.8.0 and protocol 19, h5 part 3),
on which a run measured the non-reuse of IDs within one server run (design r3 h1). Any other pair: `unknown`
(the behavior of H-a).

### 7.4 The same-uid socket rename (OD-24)

A process of the same uid can move the socket path, so that the recorded server is hidden and another server
answers at the path. With 7.2 this gives `unknown`, never `absent` or `destroyed`: no wrong close. The limit
is that such a session stays `unknown` (kept, not cleaned) until the owner puts the socket back or ends the
recorded server by hand. AO does not search other paths for the recorded server. The owner accepts this
limit (OD-24) or keeps RH off.

### 7.5 Tests

RH moves the Herdr stop tests to a socket stand-in (the r2 and r3 files mock `execFile`, which a socket
client does not use): a stand-in server that answers each envelope of h5, with a restart and a hidden server
between connections. The healthy close control comes back as a positive assertion (a close request and
`destroyed`), next to "zero close requests" for each `unknown` case.

## 8. Rollout and round claims

### 8.1 The barrier (corrected)

Every round after R2a needs it (R4: recommended). The steps:

1. **Close admission**: no mutating `ao` command (design r3 7 step 1 list, plus `associate`, `clear-token`,
   `children --forget`, `opencode reconcile`, `opencode backfill-holds`).
2. **Record the process trees** of every `ao` process (PID, parent, group, start ticks, command line).
3. **Stop the resident lifecycle workers** by exact PID (read their PID files on the day; today 3624110 and
   3626937).
4. **Drain the old `ao` trees** (design r3 5.7, children) and **check** that no process runs the old build
   (no `node` process whose command line names the primary checkout's `packages/cli` or `packages/ao`
   output). So no old installer can rewrite a wrapper after step 7.
5. **Record the old writer inodes** (4.3 step 1) (RW and later).
6. **Build** the new version.
7. **Round steps** (8.2 table): RW installs by rename (4.3 step 2), runs `ao session refresh-hooks --all`
   (hooks by rename), and drains the old writer code (4.3 steps 3 to 5).
8. **Raise the epoch** (RW and later).
9. **Restart the workers** with the new build; record the new PIDs.
10. **Exact checks**: the hashes of `~/.ao/bin/*` and of each hook equal the new build's (again after the
    workers started: no old installer ran); the old writer scan is empty again; no process of the old build;
    each worker's health is `ok` after two polls; `ao status` shows no unexpected `unknown`, no "inbox
    replaced", no orphan record.
11. **Open admission.**

### 8.2 What each round protects alone (item 3)

Design r3's sentence "each round is safe alone in this order" is withdrawn. Each row says what a deployment
up to that round protects, and what it does not.

| Round | Protects alone | Does not protect |
| --- | --- | --- |
| R2a (live) | no destructive caller goes on after an unconfirmed stop; a failed probe keeps the session; Herdr stop `unknown` | a tmux kill by name can reach another launch of the name; unlocked shell writers; no cross-process lock |
| R4 | uncertain reads keep resources (strict read chain) | as R2a |
| RW | no shell writer writes a record; pane lines reach only their own launch, also while the launch prepares; legacy lines never reach a new launch; a bounded inbox; the epoch fences every worker write; the barrier drains the real writer processes | the tmux identity; a copy of a wrapper elsewhere; a writer process that left its group |
| R2b-1 | every tmux mutation (new or legacy record) is one client command with the token check inside tmux: a new launch is mutated only through its token, a legacy record mutates only a session without a token (B-4); attach guarded; agent probes token-bound; Herdr `destroy` refuses | a legacy record can still reach a later tokenless session of the name (a launch from an old build, or an unmanaged session): no legacy session has provenance before R2b-2; R-1 for the legacy guard (2.5); no cross-process lock |
| R2b-2 | legacy records are `unknown` unless associated or asserted; the asserted legacy stop checks the createdAt window inside tmux; association with recovery (intent, adopt, exact clear); retire, inventory, `stop-retained`, `where`, the audit | the cross-process operation lock |
| R3a | one operation per ID across processes; the children of supported hooks end with the hook or are journaled; strict journal entries; PGID reuse never signals a later group; one owner per worktree directory, checked on the actual path at every entry point; the lock rules | a hook child that leaves its group (outside the guarantee, shown when found); OpenCode across projects |
| R3b | no OpenCode removal or interrupt reaches a store that AO did not check (none is sent); store-scoped holds with release, reconcile and participant coverage for reuse | OpenCode garbage stays in the store; a reuse may reach a service of another environment (continuity, not data); Herdr closes |
| RH (optional) | Herdr stop with incarnation-bound evidence: no close of another launch, no false `absent` from a hidden server | a moved socket leaves the session `unknown` (OD-24) |
| RO (optional) | a bound OpenCode removal with quarantine and reconciliation | as qualified (RO-3 only with the owner's acceptance of its gap) |

The order stays: R2a, R4, RW, R2b-1, R2b-2, R3a, R3b, then RH and RO when the owner wants them.

## 9. Measurements

### 9.1 Environment and isolation

- Host: Linux 6.8.0-147-generic, tmux 3.4, bash 5.2.21, Python 3 (`-I`), Node from the scratch `nodebin`,
  Herdr 0.8.0 (protocol 19). The host name is replaced by `<host>` in the outputs below.
- Scratch root `/tmp/aosd4`, marker `/tmp/aosd4-marker` (`2026-10-21 17:15:14.559453435 -0400`). Every script
  runs under `env -i` with `HOME` under `/tmp/aosd4` and a scratch `PATH` (the command line is in each
  script's header, section 15). No `AO_*` variable, no `TMUX`, no agent binary, no real `gh`.
- tmux: private servers `-L aosd4-t4a`, `aosd4-t4b`, `aosd4-t4r`, `aosd4-t4c` (t4, t4b) and `aosd4-T`
  (the `bintest/tmux` shim for vitest); the runtime-tmux r4 test uses `-S <its own temporary directory>/s`.
  Every server was ended through its own socket and by its exact PID; each script prints
  `still running: []`.
- Herdr (h5): `HOME` and every XDG directory under `/tmp/aosd4/herdrhome` and `/tmp/aosd4/herdrhome2`,
  `config.toml` with `[update] version_check = false, manifest_check = false` written before every start,
  sockets under `/tmp/aosd4` only, the whole server run under `strace -ff`; the script stops at once
  unless the server's only sockets are under `/tmp/aosd4` and it made no `AF_INET` connect. The real
  `~/.config/herdr` listing is compared before and after (unchanged). See section 12 for the first h5 run.
- Process groups (s1, s2): Python as a child subreaper (s1); every started PID logged in
  `/tmp/aosd4/logs/pids.txt` and stopped by its exact PID.

### 9.2 t4: the legacy guard, the race, the association r4, the attach, R-1 (tmux 3.4)

Command: `env -i HOME=/tmp/aosd4/home PATH=/tmp/aosd4/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd4/scripts/t4_legacy_guard_assoc.mjs`

```text
== 1. the review's B-4: a legacy kill by name ends a later token launch
  legacy record's session app (no token); has-session                      true
  another operation replaces app with a token launch                       exit 0 | out "ao-created:2287118|$2\nao-token:$2|df20782e871397f72a0059c06a4fa938" | err ""
  the pending legacy stop: kill-session -t =app                            exit 0 | out "" | err ""
  the token launch still exists                                            false
== 2. the legacy guard (the token guard with an empty expected token)
  legacy guard kill of a token launch                                      exit 0 | out "ao-server:2287118\nao-kept:2287118:$4\nao-end" | err ""
    answer marks; the token launch exists                                  ao-server,ao-kept,ao-end exit=0; true
  legacy guard kill of a tokenless session                                 exit 0 | out "ao-server:2287118\nao-done:2287118\nao-end" | err ""
    answer marks; the session exists                                       ao-server,ao-done,ao-end exit=0; false
  legacy guard kill of an absent session                                   exit 1 | out "ao-server:2287118" | err "can't find session: gone"
  set-option @ao_launch '' on emp                                          exit 0 | out "" | err ""
    legacy guard kill of emp: marks                                        ao-server,ao-done,ao-end exit=0
  legacy guard paste and Enter to legs: marks                              ao-server,ao-done,ao-end exit=0 / ao-server,ao-done,ao-end exit=0
    legs pane shows                                                        "legacy-message $HOME ; #{pid}\nlegacy-message $HOME ; #{pid}"
  legacy guard paste and Enter to toks: marks                              ao-server,ao-kept,ao-end exit=0 / ao-server,ao-kept,ao-end exit=0
    toks pane shows                                                        ""
  buffer ao-t4 left over                                                   false
== 3. the race: a racer replaces R between client commands (200 tries each)
  legacy guard, one command (200)                                          {"done":55,"doneWithToken":0,"kept":68,"absent":77,"other":0}
  client preflight read, then a kill (200)                                 {"killed":63,"killedWithToken":4,"skipped":69,"absent":68}
== 4. M-2: the association, design r3 against design r4
  a '$' in a nested format: #{==:#{session_id},$N} for the own $N          sid $0: plain "yes"; backslash "yes"; s/^.// "yes"
  audited evidence of L (server PID | $N | pane_pid)                       {"serverPid":"2290325","sid":"$0","panePid":"2290326"}
  r3: associate L                                                          ao-server,ao-assoc,ao-end exit=0
  r3: the record step fails; a retry with a new token: marks               ao-server,ao-assoc-refused,ao-end exit=0
  r3: L keeps the stranded token                                           true
  r3: the legacy guard kill of L (no record names the token): marks        ao-server,ao-kept,ao-end exit=0
    L exists                                                               true
  r4: associate L with the intent's token                                  exit 0 | out "ao-server:2290325\nao-assoc:2290325:$0\nao-end" | err ""
  r4: L has the intent's token                                             true
  r4: a retry with the intent's token (adopt): marks                       ao-server,ao-assoc-adopt,ao-end exit=0
  r4: an association with another token: marks                             ao-server,ao-assoc-refused,ao-end exit=0
  r4: L still has the intent's token                                       true
  r4: the evidence with another server PID: marks                          ao-server,ao-assoc-refused,ao-end exit=0
  r4: the evidence with another $N: marks                                  ao-server,ao-assoc-refused,ao-end exit=0
  r4: the evidence with another pane_pid: marks                            ao-server,ao-assoc-refused,ao-end exit=0
  r4: the guard with the intent's token acts on L (a display)              ao-server,own,ao-done,ao-end exit=0
  r4: clear with another token: marks                                      ao-server,ao-assoc-refused,ao-end exit=0
  r4: clear with the intent's token                                        exit 0 | out "ao-server:2290325\nao-assoc-cleared:2290325:$0:[]\nao-end" | err ""
  r4: L has no token; L exists                                             ""; true
  r4: after respawn-pane -k, the old evidence: marks                       ao-server,ao-assoc-refused,ao-end exit=0
  r4: after a new L, the old evidence: marks                               ao-server,ao-assoc-refused,ao-end exit=0
  server t4r: L, evidence                                                  {"serverPid":"2290386","sid":"$0","panePid":"2290387"}
  r4: t4r's evidence sent to server t4b's L: marks                         ao-server,ao-assoc-refused,ao-end exit=0
== 5. the legacy attach through the legacy guard (terminal of script)
  legacy guarded attach to tat: clients                                    ""
    script exit; client output                                             1; "ao-server:2287118\nao-kept:2287118:$9\nao-end\ncan't find pane: %2147483647\n"
  legacy guarded attach to lat: clients                                    "lat:2290515"
    script exit; client output                                             0; "\u001b=\u001b[>c\u001b[>q\u001b]10;?\u001b\\\u001b]11;?\u001b\\ao-done:2287118                                                       [1/1]ao-end\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n[lat] 0:[tmux]*                              \"<host>\" 17:31 "
== 6. R-1: a pane option @ao_launch '' shadows the session's token
  set-option -p -t =shd: @ao_launch ''                                     exit 0 | out "" | err ""
  #{@ao_launch} of shd now                                                 ""
  show-options -v -t =shd: @ao_launch (session scope)                      true
  legacy guard kill of shd: marks                                          ao-server,ao-done,ao-end exit=0
    shd exists                                                             false
  started PIDs: 25; still running: []; own sockets left: 
```

### 9.3 t4b: `$N` in a branch, numeric compares, the gate (tmux 3.4)

Command: as t4, with `t4b_numeric_forms.mjs`.

```text
== 1. $N with two digits (n11 is $11); HOME is set in the server environment
  #{==:#{session_id},$11} (plain)                                              TRUE
  #{==:#{session_id},\$11} (backslash)                                         TRUE
  #{==:#{s/^.//:session_id},11} (number only)                                  TRUE
  #{==:#{s/^.//:session_id},11} for n10 (another $N)                           FALSE
  #{==:x$HOME,x} ($HOME: a name that the server environment has)               FALSE
== 2. numeric compares inside tmux
  session_created of n11                                                       1792618344
  #{e|>=:#{session_created},1792618329} (createdAt - 15 s)                     TRUE
  #{e|<=:#{session_created},1792618345} (createdAt + 1 s)                      TRUE
  #{e|<=:#{session_created},1792618328} (before the window)                    FALSE
  no token AND inside [createdAt-15, createdAt+1]                              TRUE
  no token AND inside a window that ends before the session                    FALSE
  a token AND inside the window                                                FALSE
  gate: #{e|>=:#{session_created},#{e|+:#{session_created},1}} (x >= x+1)      FALSE
  gate with an unknown operator: #{e|zz:#{session_created},#{e|+:#{session_created},1}} FALSE
  gate with an unknown operator: #{nosuch:#{session_created},1}                TRUE
  started PIDs: 13; still running: []; own socket left: false
```

### 9.4 t5: the shipped wrappers and the Claude hook of c8a35d47, the drain (bash)

Command: `env -i HOME=/tmp/aosd4/home PATH=/tmp/aosd4/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp SHELL=/bin/sh node /tmp/aosd4/scripts/t5_wrapper_drain.mjs`

```text
== A. the review's case: the helper file is replaced while real gh runs
  real gh started (the wrapper sourced the helper first)             true
  the wrapper's command line                                         "bash /tmp/aosd4/rw/bin/gh pr create"
  matched by the name rule of design r3 5.6                          false
  open descriptors of the wrapper                                    ["255->/tmp/aosd4/rw/bin/gh (deleted)"]
  fd 255 inode equals the OLD bin/gh inode; bin/gh now another inode true; true
  the inode rule finds                                               ["2383671 fd 255 /tmp/aosd4/rw/bin/gh (deleted)"]
    drain member pid 2383671 ppid 2383511 pgid 2383671 start 11120135 S "bash /tmp/aosd4/rw/bin/gh pr create"
    drain member pid 2383675 ppid 2383671 pgid 2383671 start 11120136 S "/bin/bash /tmp/aosd4/rw/real/gh pr create"
    drain member pid 2383676 ppid 2383671 pgid 2383671 start 11120136 S "tee /tmp/aosd4/tmp/tmp.vV9R7Ig70Z"
    drain member pid 2383678 ppid 2383675 pgid 2383671 start 11120136 S "?"
  the old helper reached its mv (in-memory function)                 true
    drain member pid 2383671 ppid 2383511 pgid 2383671 S             "bash /tmp/aosd4/rw/bin/gh pr create"
    drain member pid 2383746 ppid 2383671 pgid 2383671 S             "/bin/bash /tmp/aosd4/rw/bin/mv /tmp/aosd4/rw/sessions/app-1.tmp.2383671 /tmp/aosd4/rw/sessions/app-1"
    drain member pid 2383750 ppid 2383746 pgid 2383671 S             "sleep 0.02"
  wrapper exit; record                                               0; "worktree=/tmp/aosd4/rw/repo\nbranch=main\nruntimeHandle=old\ngeneration=1\npr=https://github.com/org/app/pull/7\nstatus=pr_open\n"
== B. the drain of design r4: wait until the old writer set is empty, then write
  drain: polls; ms; members recorded                                 18; 695; 14
  Node write after the drain; wrapper exit; record                   0; "worktree=/tmp/aosd4/rw/repo\nbranch=main\nruntimeHandle=new\ngeneration=2\npr=https://github.com/org/app/pull/7\nstatus=pr_open\n"
== C. a wrapper killed while its mv child waits: the child keeps the process group
  before: drain members                                              ["2384821/2383511/2384821 bash /tmp/aosd4/rw/bin/gh","2384858/2384821/2384821 /bin/bash /tmp/aosd4/rw/bin/mv","2384861/2384858/2384821 ?"]
  wrapper ended by SIGKILL                                           SIGKILL
  the mv shim: ppid now; pgid now (the wrapper's pgid)               1; 2384821 (2384821)
  the inode rule now finds                                           []
  a tree walk from the wrapper finds the mv shim                     false
  the group rule finds the mv shim (pgid, started before)            true
  after the release: the record (the orphan wrote)                   "worktree=/tmp/aosd4/rw/repo\nbranch=main\nruntimeHandle=old\ngeneration=1\npr=https://github.com/org/app/pull/7\n"
== D. the Claude hook: command line, descriptor, rewrite in place against rename
  [in place] hook processes (pid/ppid/pgid args)                     ["2384967/2383511/2384967 /bin/sh -c .claude/metadata-updater.sh","2384968/2384967/2384967 bash .claude/metadata-updater.sh","2385003/2384968/2384967 /bin/bash /tmp/aosd4/rw/bin/mv /tmp/aosd4/rw/sessions/app-1.tmp /tmp/aosd4/rw/sessions/app-1"]
  [in place] the inode rule finds                                    ["2384968 fd 255 /tmp/aosd4/rw/ws/.claude/metadata-updater.sh"]
  [in place] the hook path inode is still the old one                true
  [in place] hook exit; output                                       0; "{\"systemMessage\": \"Updated metadata: PR created at https://github.com/org/app/pull/9\"}\n"
  [in place] the record has the PR; the new head ran; the new tail ran true; false; false
  [by rename] hook processes (pid/ppid/pgid args)                    ["2385050/2383511/2385050 /bin/sh -c .claude/metadata-updater.sh","2385051/2385050/2385050 bash .claude/metadata-updater.sh","2385105/2385051/2385050 /bin/bash /tmp/aosd4/rw/bin/mv /tmp/aosd4/rw/sessions/app-1.tmp /tmp/aosd4/rw/sessions/app-1","2385108/2385105/2385050 ?"]
  [by rename] the inode rule finds                                   ["2385051 fd 255 /tmp/aosd4/rw/ws/.claude/metadata-updater.sh"]
  [by rename] the hook path inode is still the old one               false
  [by rename] hook exit; output                                      0; "{\"systemMessage\": \"Updated metadata: PR created at https://github.com/org/app/pull/9\"}\n"
  [by rename] the record has the PR; the new head ran; the new tail ran true; false; false
== E. the git wrapper: git checkout -b in a scratch repository
  the old helper reached its mv                                      true
  git wrapper processes (pid/ppid/pgid args)                         ["2385138/2383511/2385138 bash /tmp/aosd4/rw/bin/git checkout -q -b feat/t5","2385173/2385138/2385138 /bin/bash /tmp/aosd4/rw/bin/mv /tmp/aosd4/rw/sessions/app-1.tmp.2385138 /tmp/aosd4/rw/sessions/app-1","2385179/2385173/2385138 ?"]
  the inode rule finds; the name rule matches                        ["2385138 fd 255 /tmp/aosd4/rw/bin/git (deleted)"]; false
  git wrapper exit; record branch line                               0; "branch=feat/t5"
== F. a bash script that reads on after a wait: a rewrite in place against a rewrite by rename
  [in place] exit; the old tail ran; the new tail ran                0; false; true
  [by rename] exit; the old tail ran; the new tail ran               0; true; false
  started PIDs: 31; still running: []
```

Note on D: in this run the hook had passed the text that the rewrite changed, so neither variant ran a new
tail; part F shows the general case on a script that waits before its tail.

### 9.5 t6: the inbox append under bash and `strace`

Command: `env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp bash /tmp/aosd4/scripts/t6_inbox_append.sh`

```text
bash 5.2.21(1)-release; Linux 6.8.0-147-generic
== 1. write() calls per appended record
    200 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 200); file size 200
   2048 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 2048); file size 2048
   4095 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 4095); file size 4095
   4096 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 1 (bytes 4096); file size 4096
   4097 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 2 (bytes 4096+1); file size 4097
   8192 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 2 (bytes 4096+4096); file size 8192
   9000 bytes: opens 1 flags O_WRONLY|O_CREAT|O_APPEND; write() calls 3 (bytes 4096+4096+808); file size 9000
== 2. hex encoding of every byte 0x01..0xff in bash (LC_ALL=C)
  bytes in the string: 255; hex digits: 510; equal to od: yes
  first difference: none
  a branch name with a quote, a backslash and UTF-8: 666561742f6122625c632dc3a9
== 3. four parallel writers, 500 records each
  lines 2000; well formed 2000; malformed 0; per writer 500/500/500/500; pad digit not the writer: 0
  writers left: none
```

### 9.6 s1: process groups (zombies, a dead leader, escaped children)

Command: `env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp /usr/bin/python3 -I /tmp/aosd4/scripts/s1_process_groups.py`

```text
== 1. a zombie-only group
  leader state; kill(-pgid, 0)                                           Z; 0 (a member exists)
  members of the group (pid state)                                       [(2425313, 'Z')]
  after the reap: kill(-pgid, 0)                                         ESRCH
== 2. a group whose leader ended while a member runs
  leader /proc entry exists; kill(-pgid, 0)                              False; 0 (a member exists)
  the member: ppid (this subreaper), pgid (the leader's PID)             2425311 (2425311), 2425383 (2425383)
  the member killed, not yet reaped: state; kill(-pgid, 0)               Z; 0 (a member exists)
== 3. an empty group
  kill(-pgid, 0) after the reap                                          ESRCH
== 4. a hook that leaves its process group
  children: pid, pgid (hook group = leader pid)                          {'setsid': (2425486, 2425486), 'daemon': (2425490, 2425488), 'envi': (2425492, 2425485), 'plain': (2425493, 2425485), 'leader': 2425485}
  after SIGTERM to the group and the drain: kill(-pgid, 0)               ESRCH
  still running (pid, pgid, sid, has the marker)                         [(2425486, 2425486, 2425486, True), (2425490, 2425488, 2425488, True)]
  the escaped ones by kind                                               {'setsid': True, 'daemon': True, 'envi': False, 'plain': False}
  seconds since the hook started                                         0.63
  started PIDs: 9; still present: []
```

PGID reuse in a PID namespace could not be forced: `unshare -U` is refused on this host
(`/proc/sys/kernel/apparmor_restrict_unprivileged_userns` = 1; the `uid_map` write is not permitted).

### 9.7 s2: the leader that holds the group

Command: `env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp /usr/bin/python3 -I /tmp/aosd4/scripts/s2_leader_holds_group.py`

```text
== 1. SIGTERM to the group: the command and its grandchild end, the leader stays
  members before (pid, state); leader pid                            [(2604603, 'S'), (2604604, 'S'), (2604605, 'S')]; 2604603
Terminated
  leader prints the exit status of the command                       rc=143
  members after SIGTERM (only the leader?)                           [(2604603, 'S')]
  the leader still runs; state                                       True; S
  after 'done': leader exit code                                     143
  kill(-pgid, 0) after the reap                                      no member (ESRCH)
== 2. EOF before go: exit 99, the command never runs
  exit code; the command ran                                         99; False
== 3. EOF after the command (the supervisor died): the leader exits, a grandchild remains
  leader prints                                                      rc=0
  leader exit code after EOF                                         0
  members of the group now (the journal keeps the ID busy)           [(2604609, 'S')]
  started PIDs: 5; still running: []
```

### 9.8 h5: Herdr 0.8.0 stop outcomes (isolated)

Command: `env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp /usr/bin/python3 -I /tmp/aosd4/scripts/h5_herdr_stop_outcomes.py`

```text
== 1. the answers of each failure (server A)
  server A: pid, sockets                                           2460869, ['/tmp/aosd4/herdrhome/.config/herdr/herdr-client.sock', '/tmp/aosd4/herdrhome/.config/herdr/herdr.sock']
  server A: outside paths (ENOENT only), bad, inet                 [], [], 0
  workspace.create on one connection                               peer 2460869: {"type": "workspace_created", "workspace": {"workspace_id": "w1", "number": 1, "label": "h5a", "focused": true, "pane_count": 1, "tab_count": 1, "acti
  the record: pane, terminal, creation server (pid, ticks)         w1:p1 term_65e609a1e4fd41 (2460869, '11151039')
  pane.get of the own pane                                         pane w1:p1 terminal term_65e609a1e4fd41
  pane.get of w9:p9 (never existed)                                error code='pane_not_found' message='pane w9:p9 not found'
  pane.get of 'not a pane' (malformed)                             error code='pane_not_found' message='pane not a pane not found'
  pane.get with no params                                          error code='invalid_request' message='invalid request: missing field `pane_id` at line 1 column 54'
  pane.get with pane_id 7 (a number)                               error code='invalid_request' message='invalid request: invalid type: integer `7`, expected a string at line '
  an unknown method pane.nosuch                                    error code='invalid_request' message='invalid request: unknown variant `pane.nosuch`, expected one of `ping`'
  workspace.get of w9 (never existed)                              error code='workspace_not_found' message='workspace w9 not found'
  a line that is not JSON                                          error code='invalid_request' message='invalid request: expected ident at line 1 column 2'
  connect to a socket file without a listener                      ConnectionRefusedError
  connect to a missing path                                        FileNotFoundError
== 2a. the stop protocol: the own pane, then again
  pane.split (a second pane, so the workspace stays)               {"type": "pane_info", "pane": {"pane_id": "w1:p2", "terminal_id": "term_65e609a1ee8952", "workspace_id": "w1", "tab_id":
  stop of the record                                               close {"type": "ok"}; check on the recorded server: pane_not_found: destroyed
  stop of the record again                                         pane_not_found from the recorded server: absent
  stop of a record of the second pane with a wrong terminal        pane w1:p2 terminal term_65e609a1ee8952 on the recorded server: other-launch, no close
== 2b. a restart with the saved session between the create and the stop
  server stop (CLI, server A's own environment)                    exit 0 ''
  server A 2460869 still runs                                      False
  server A2: pid, sockets                                          2461140, ['/tmp/aosd4/herdrhome/.config/herdr/herdr-client.sock', '/tmp/aosd4/herdrhome/.config/herdr/herdr.sock']
  server A2: outside paths (ENOENT only), bad, inet                ['/.git', '/HEAD', '/tmp/.git', '/tmp/HEAD'], [], 0
  get of the second pane on the restarted server                   pane w1:p2 terminal term_65e609a2447101
  stop of the record of the second pane (created on A)             recorded server ended; another server has pane w1:p2 terminal term_65e609a2447101: other-launch, no close
== 2c. a hidden recorded server: server B takes the socket path while A2 runs
  a record on A2                                                   w2:p1 term_65e609a28ff502 (2461140, '11151105')
  server B: pid, sockets                                           2461288, ['/tmp/aosd4/herdrhome2/.config/herdr/herdr-client.sock', '/tmp/aosd4/herdrhome2/.config/herdr/herdr.sock']
  server B: outside paths (ENOENT only), bad, inet                 [], [], 0
  server B: workspace.create                                       {"type": "workspace_created", "workspace": {"workspace_id": "w1", "number": 1, "label": "h5b", "focused": true, "pane_co
  the path of A now reaches                                        pid 2461288 (B is 2461288, A2 is 2461140)
  stop of the A2 record through the path                           peer 2461288 is not the recorded server 2461140, which runs: unknown, no close (error code='pane_not_found' message='pane w2:p1 not found')
  pane.get of the record's pane on B (what a check without the peer rule sees) error code='pane_not_found' message='pane w2:p1 not found'
  paths back; stop of the A2 record                                close {"type": "ok"}; check on the recorded server: pane_not_found: destroyed
== 3. the version in the ping answer
  ping                                                             {"type": "pong", "version": "0.8.0", "protocol": 19, "capabilities": {"live_handoff": true, "detached_server_daemon": fa
  started PIDs still present                                       []
  real ~/.config/herdr (named path, ls)                            unchanged
  whole-run traces: paths under /home; AF_INET connects            []; 0
```

The four outside paths of A2 (`/.git`, `/HEAD`, `/tmp/.git`, `/tmp/HEAD`) are `ENOENT` probes of the
restarted server, not under `/home`, and no file was opened there.

## 10. Round plan (item 4)

All rounds come after R2a (ao-55). R4 is unchanged (design r2 section 3 with design r3 section 4) and comes
directly after R2a. Sizes: S < M < L.

| Round | Content | Files | Tests that must turn green | Risk | Size | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| **RW** | 4.2 to 4.7: `launchId` and `launchState` in the reservation; `AO_LAUNCH_ID`; the per-launch inbox and its format; the writer in the helper and the hook; `applyInbox` (bounded, cursor, epoch); the publish and restore steps; archive, late lines, orphans; hook by rename; the monotonic wrapper version; the epoch module and the worker write fence; `ao session refresh-hooks --all`; the barrier drain tool (4.3) as `ao barrier writers --wait` | `core/src/agent-workspace-hooks.ts`, `core/src/metadata.ts`, new `core/src/inbox.ts`, new `core/src/build-epoch.ts`, new `core/src/writer-drain.ts`, `core/src/session-manager.ts` (reservation, publish, restore, archive), `core/src/lifecycle-manager.ts`, `agent-claude-code/src/index.ts`, CLI `session.ts`, a new CLI `barrier.ts` | core r4 `(RW)` B-1 and M-1 (2 defects; controls stay); core r3 B-5 (its control changes, 13.7). Add: a line of another launch and a `legacy.ndjson` line never reach a record with `launchId`; a held line of a failed launch is never applied; a fragment does not take the next record; a part at the end without `LF` waits; the 64 KiB limit; the cap refusal; the cursor `(dev, ino)` check; late lines after the archive and orphans are listed and never applied; a restore applies the old launch first; the hook is written by rename (inode changes); an equal or higher wrapper version is left alone; the drain finds a wrapper by its open inode, its children, and an orphan by its group (t5 as a test); the epoch fence for `applyInbox` and a status write | medium | L | R2a (restore) |
| **R2b-1** | design r3 2.1 to 2.8 and 2.12 for new launches; the legacy guard for every legacy mutation (2.2 to 2.4 here); `AttachInfo.args`; tmux `stop`; runtime-herdr `destroy` refuses (H-a) | `runtime-tmux/src/index.ts`, `runtime-herdr/src/index.ts`, `core/src/types.ts`, new `core/src/runtime-identity.ts`, `core/src/session-manager.ts`, `core/src/tmux.ts`, the four agents, CLI `send.ts` (after ao-54's change lands), `session.ts`, `status.ts` | runtime-tmux r4 `(R2b-1)`: 3 defects (B-4 destroy and send, M-2), 6 controls (the builders move into production, 13.7); runtime-tmux r3: 5 defects; runtime-tmux r2: 7 defects; runtime-herdr r3: 3 defects; runtime-herdr r2 N-1; `c516cead` R2: runtime-tmux 3, agents 4. Add: each legacy path of 2.3 with a token launch (no mutation), with a tokenless session (the mutation), and with an absent session; the grep test for unguarded `send-keys`, `paste-buffer`, `kill-session` and `attach` also in core `tmux.ts`, CLI `send.ts` and `session.ts`; the legacy attach exit 1 on `kept`; the race test of t4 part 3 as a real-tmux test | **high** | L | R2a, RW, ao-54 |
| **R2b-2** | design r3 2.9 to 2.11 with section 3 here (intent, adopt, exact clear, `--resume`, `--abandon`, `clear-token`, the kind `associating`, retained entries) and 2.6 here (the createdAt window in tmux, the second gate, the legacy send notice) | `core/src/runtime-identity.ts`, `core/src/metadata.ts` (`associationIntent` in `LAUNCH_IDENTITY_KEYS`), new `core/src/retained-inventory.ts`, `core/src/config.ts`, `runtime-tmux/src/index.ts`, CLI `session.ts`, `status.ts`, `send.ts` | `c516cead` R2 runtime-tmux F-5. Add: the crash table of 3.3 row by row (a fault after each step, then `--resume` and `--abandon`); the record step after a PR write still succeeds (launch identity, not generation); the exact clear refuses another token; `clear-token` refuses another fingerprint; the asserted legacy stop inside and outside the window and on a token session; the audit never mutates; `associate-retained` then `stop-retained` | high | M | R2b-1 |
| **R3a** | design r3 5.1, 5.3 to 5.5; 5.1 to 5.7 here (the narrowed guarantee and docs, the leader that holds the group, strict journal, recovery table, zombies, the escape marker, the lock rules with run-time checks, the owner marker by `link()` at every entry point) | `core/src/delivery-lock.ts`, new `core/src/operation-lock.ts`, new `core/src/mutating-child.ts`, `core/src/metadata.ts` (`withRecordLock` thenable check), `core/src/session-manager.ts`, `core/src/recovery/actions.ts`, `core/src/lifecycle-manager.ts`, `core/src/types.ts`, `workspace-worktree/src/index.ts`, CLI, `docs/` | workspace-worktree r3 B-3; `c516cead` R3: worktree 4, core 1. Add: s2 as tests (SIGTERM to the group keeps the leader; EOF before `go`; EOF after the command); a journal entry for each malformed form gives busy; a live PID `pgid` with other ticks gives stale; a zombie-only group gives stale with the log; an escaped `setsid` child with the marker gives busy; no signal after the leader's exit (a spy on `process.kill`); the three lock rules throw; the marker race (two `link()` creators); a partial temporary marker is ignored; a path outside the layout refuses; a plugin destroy without the owner identity refuses | **high** | L | R2a, R2b-1, R4 |
| **R3b** | 6.1 to 6.4: no OpenCode removal or interrupt; the kept-session notices; holds keyed by the intended store; the hold states; own release after a proven stop; claim before publish; `ao opencode reconcile`; participants and `backfill-holds` | `core/src/session-manager.ts`, `core/src/opencode-api.ts`, new `core/src/opencode-holds.ts`, `agent-opencode/src/index.ts`, CLI (`opencode` commands) | core r4 `(R3b)` B-3 (1 defect; its control stays); core r3 B-4 (1 defect; its control, 13.7); `c516cead` R3 opencode 1 (`same-id-reuse-window`). Add: no `opencode api session.remove` or `session.interrupt` call from any caller (a spy on `execFile`); the hold table of 6.3 row by row; a reuse refuses while a participant is not backfilled; reconcile takes the operation lock before the store lock | medium | M | R3a, R4 |
| **RH** (optional) | section 7 | `runtime-herdr/src/index.ts`, a new socket client module | the runtime-herdr r3 defects stay green with the bound close; the stop table of 7.2 on a socket stand-in, with a restart and a hidden server between connections; the healthy close control | medium | M | R2b-1, OD-24 |
| **RO** (optional) | 6.5 after the qualification run | `core/src/opencode-api.ts`, `core/src/opencode-holds.ts`, `core/src/session-manager.ts` | core r4 B-3 and core r3 B-4 stay green with the bound removal; quarantine on a timeout and on a kill; reconcile by a bound read; owner reconcile | high | M | R3b, OD-22 |

Order: R2a, R4, RW, R2b-1, R2b-2, R3a, R3b; RH and RO when the owner wants them. R2b-1 also waits for
ao-54's `send.ts` change.

## 11. Owner decisions

| OD | Status | Value |
| --- | --- | --- |
| OD-2 to OD-13, OD-15, OD-16 | **decided** (1a) | as design r3 section 10 |
| OD-14 child and request lifetime | **decided, narrowed** (2a) | the process-group supervisor with the write-ahead journal; only hooks and children that do not start daemons are supported; a child that leaves the group is outside the guarantee; no cgroup or scope (section 5) |
| OD-17 tmux identity | **decided** (b) | the stable name plus the token guard |
| OD-18 legacy send | **decided** (a) with the atomic no-token check (3a) | from R2b-1 every legacy mutation runs only on a session without a token, checked in the same client command (section 2); from R2b-2 the legacy send has the notice |
| OD-19 Herdr close | **decided** (a) (1a) | `unknown` until RH; RH optional (section 7) |
| OD-20 shell writers | **decided** (a) (1a) | the append-only inbox with the Node applier (section 4) |
| OD-21 OpenCode namespace | **decided** (a) (1a) | inside the store (section 6.2) |
| **OD-22** (new) OpenCode removal | open | (a) **recommended**: R3b sends no removal and no interrupt; the bound transport is the optional round RO after an owner-approved qualification run (RO-1, then RO-2, then RO-3 only with acceptance of its gap). (b) keep the unbound removal and accept B-3 (not recommended: it can remove a session that another store's live holder uses) |
| **OD-23** (new) R-1 for the legacy guard | open | (a) **recommended**: accept that a same-uid process that sets a pane option `@ao_launch ""` makes the legacy guard mutate a token launch (t4 part 6; AO never sets pane options; the same trust level as an edit of a record). (b) refuse every legacy mutation from R2b-1 until association (as the review's preferred OD-18 (b); it stops the live fleet's legacy sends) |
| **OD-24** (new) the Herdr socket rename limit | open, only for RH | (a) accept that a hidden recorded Herdr server leaves its session `unknown` until the owner fixes the socket (section 7.4); (b) keep RH off |

## 12. Brief items found unclear or wrong, and deviations

Unclear or wrong in the brief:

1. The round tags. The brief asks for "the round tags"; the existing scheme has only `[same-id R1]` to
   `[same-id R4]`. I keep it (`[same-id R2]` for R2b-1 and R2b-2, `[same-id R3]` for RW and R3b) and put the
   design round in parentheses after the tag, for example `[same-id R3] (RW) B-1`. `redcount.sh` counts by
   both (section 13.4).
2. "B-4 ... or join R2b-1 and R2b-2. Say which": I chose neither join nor refusal: the third form that the
   review offers (an atomic no-token guard) in R2b-1 (2.1). It matches owner decision 3a.
3. R2b-1 depends on CLI `send.ts` (the legacy send and the Enter retries, 2.3), which ao-54 changes in its
   round 3. The R2b-1 brief must start after that change lands.
4. "M-2 (a failed association)" as a failing test: the association does not exist on c8a35d47, so no test
   of the recovery can fail there for the measured reason. The failing test is the safety half that exists
   today: a legacy kill ends a session that carries a token that no record names (runtime-tmux r4 M-2).
   Its mechanism is the B-4 mechanism (a legacy kill by name). The recovery forms are controls on real
   tmux.
5. "B-3 (the request bound to another store)": the test shows the removal that reaches store B while store
   B's namespace has a live holder. It uses a stand-in `opencode` (no `opencode` call of any kind, section 0),
   which models the per-child selection with a locator file. It is a protocol test, not a run of a real
   OpenCode service.
6. "M-1 ... a backlog without an applier": the design answers it (4.5). No failing test can show it on
   c8a35d47, because there is no inbox.
7. No restore test for M-1: ao-55 changes restore now (R2a round 3), so a restore test on c8a35d47 would
   test code that changes. The restore rule is in 4.2 and in the RW plan.
8. A system reminder asks for a `Co-Authored-By` trailer in commits. The brief forbids it. The commits have
   none.

Deviations and slips:

1. **The first h5 run made network connections.** I did not write the Herdr `config.toml` with the update
   checks off before the first start (round 3's h1 did). The `strace` record shows a DNS lookup through
   `127.0.0.53:53`, connects to `172.64.80.1:443` (two completed), and `ENOENT` probes, among them
   `/home/taisung/.curlrc` and `/var/run/nscd/socket`. The script's isolation check stopped the run before
   the first client request and stopped the server by its PID. No real file was read (the probes were
   `ENOENT`), and the real `~/.config/herdr` listing is unchanged. The traces of that run are in
   `/tmp/aosd4/logs/h5-first-run/` (49 files). The script now writes `config.toml` before every start; the
   run of 9.8 has no path under `/home` and no `AF_INET` connect.
2. The first t5 run printed a wrong "still running" list (PIDs that had ended before they were recorded).
   I checked: all were gone. `track` now stores the start ticks, and the run of 9.4 prints
   `still running: []`.
3. The first s1 part 4 waited on the stdout pipe of the escaped children. The children now write to
   `/dev/null`; the run of 9.6 is the second run.
4. Changes to the r3 test files: only m-1 (`any[]` to `unknown[]` in the runtime-herdr r3 file, commit
   `49b3b426`). I found no inaccurate oracle in the r3 files to change; the review's notes on the r3
   controls (the C3 helper control, the Herdr close control) are changes for the implementing rounds
   (13.6), not oracle errors on c8a35d47.

## 13. Tests of this round

Commits: `49b3b426` (m-1), `13c58b2c` (the two new r4 files). Marking as in design r1 section 8.1:
`defect(...)` is `it.fails`, and `SAME_ID_DEFECTS=red` makes it a plain test. Each defect fails on
`c8a35d47` for the measured reason; the lines are from `SAME_ID_DEFECTS=red` runs at `13c58b2c`
(`/tmp/aosd4/scripts/vt.sh <package> <file>`).

### 13.1 `packages/core/src/__tests__/same-id-defects-r4.test.ts` (new)

| Test | Kind | Failure on c8a35d47 |
| --- | --- | --- |
| `[same-id R3] (RW) B-1` "a Node write after the barrier installed a new helper is kept against a wrapper that started before" | defect | `AssertionError: expected 'old' to be 'new'` |
| same describe: "control: the wrapper's command line names gh only, it keeps the wrapper file open, and real gh is its child" | control | passes |
| `[same-id R3] (RW) M-1` "a branch that the pane records while its launch is still preparing is in the record after the spawn" | defect | `AssertionError: expected 'session/app-1' to be 'feat/agent-switched'` |
| same describe: "control: the pane environment that create gets names the session's own record" | control | passes |
| `[same-id R3] (R3b) B-3` "a kill with purge sends no removal to a store whose namespace holds a live holder of the session" | defect | `AssertionError: requests: store A "session.interrupt ses_shared\n", store B "session.remove ses_shared\n": expected true to be false` |
| same describe: "control: the stand-in answers the real transport, and each request reaches the store that the locator names" | control | passes |

B-1 runs the shipped `GH_WRAPPER` and `AO_METADATA_HELPER` of c8a35d47 under bash with a stub real gh and
an `mv` shim; the barrier step (a new no-op helper by rename) comes while the real gh runs. M-1 runs the
shipped helper from the mock runtime's `create`, with the pane environment that spawn passes. B-3 uses a
stand-in `opencode` first on `PATH` (checked with `command -v`); the interrupt moves the locator to store B
(the per-child service selection), and the removal reaches store B while `storeB/ao-holds/holds/ses_shared/oth-1.json`
names a live record.

### 13.2 `packages/plugins/runtime-tmux/src/__tests__/same-id-defects-r4.test.ts` (new, real tmux)

| Test | Kind | Failure on c8a35d47 |
| --- | --- | --- |
| `[same-id R2] (R2b-1) B-4` "destroy with a legacy handle keeps a later launch that carries a launch token" | defect | `AssertionError: expected false to be true` (`destroy` ran `kill-session -t =<name>`; the token launch is gone) |
| same: "sendMessage with a legacy handle gives a later token launch no keys" | defect | `AssertionError: expected 'r4-legacy-message\nr4-legacy-message$' to be ''` |
| `[same-id R2] (R2b-1) M-2` "destroy with the legacy handle keeps its session while a token that no record names is on it" | defect | `AssertionError: expected false to be true` |
| `[same-id R2] (R2b-1, R2b-2)` 6 controls: the legacy guard kills a tokenless session; it gives a token session no kill and no keys; the association sets, adopts and refuses another token; it refuses another server PID, `$N` or `pane_pid`; the exact clear; the createdAt window and its gate | controls | pass |

The tests build the legacy handle explicitly (`{ id, runtimeName: "tmux", data: { createdAt, workspacePath } }`,
the c8a35d47 form), not with `create()`, because `create()` makes token launches from R2b-1 on. Every tmux
call goes through a shim to `-S <temporary directory>/s`; `beforeAll` checks that `tmux` on `PATH` is the
shim and that the server answers at that socket.

### 13.3 `packages/plugins/runtime-herdr/src/__tests__/same-id-defects-r3.test.ts` (changed, m-1)

Lines 30 and 37: `(...args: any[])` becomes `(...args: unknown[])`. No assertion changed; 4 tests, results
unchanged (3 defects fail in red mode, 1 control passes).

### 13.4 Red counts (`SAME_ID_DEFECTS=red`, failed/passed per tag and design round)

Baseline at `c8a35d47` (`/tmp/aosd4/logs/redcount-baseline.out`):

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

At `13c58b2c` (`/tmp/aosd4/logs/redcount-final.out`):

```text
packages/cli/__tests__/same-id-defects.test.ts: R1 0 failed/2 passed
packages/core/src/__tests__/same-id-defects-r2.test.ts: R2 9 failed/4 passed, R4 7 failed/5 passed
packages/core/src/__tests__/same-id-defects-r3.test.ts: R3 2 failed/2 passed
packages/core/src/__tests__/same-id-defects-r4.test.ts: R3 (R3b) 1 failed/1 passed, R3 (RW) 2 failed/2 passed
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
packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts: R1 0 failed/6 passed, R2 4 failed/0 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r2.test.ts: R4 2 failed/3 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects-r3.test.ts: R3 1 failed/1 passed
packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts: R3 4 failed/0 passed
```

The difference is exactly the two new files: core r4 `R3 (RW)` 2/2 and `R3 (R3b)` 1/1; runtime-tmux r4
`R2 (R2b-1)` 3/0 and `R2 (R2b-1, R2b-2)` 0/6. Every other line is equal.

### 13.5 Normal mode

`vt.sh` without `SAME_ID_DEFECTS`: core r4 `3 passed | 3 expected fail (6)`; runtime-tmux r4 `9 passed (9)`
(vitest 3.2.4 in this package counts an `it.fails` that fails as passed; core has vitest 4.1.4, which shows `expected fail`); runtime-herdr r3 `4 passed (4)`.

### 13.6 What each implementing round changes in these tests

Each round turns its `defect(...)` markings into plain tests. In addition:

| Round | Test | Change, and why |
| --- | --- | --- |
| RW | core r4 B-1 | the test installs the new helper by rename and then writes with Node; under RW the barrier drain (4.3) must also run between them: the test gets a call of the drain tool, which waits for the wrapper. The assertion stays |
| RW | core r4 M-1, core r3 B-5 control | the helper writes the inbox; the assertion reads the record after the publish (M-1) and after `applyInbox` (B-5 control), as design r3 13.7 says |
| R2b-1 | runtime-tmux r4 controls | the local builders (`guardArgs`, `associateArgs`, `clearArgs`, `gated`) become calls of the exported production builders, so the controls test production forms (the review's note on oracle controls) |
| R2b-1 | runtime-tmux r4 defects | the assertions stay; a rejection is accepted (`.catch`), as 2.4 gives `unknown` or a rejection on `kept` |
| R3b | core r4 B-3 | stays: no removal reaches either store. The control stays (it checks the stand-in) |
| R3b | core r3 B-4 control | "another project that names another OpenCode session does not stop the cleanup": the cleanup still archives; the assertion of a removal request changes to "no removal request, and the notice names the kept session" (6.1) |
| RO | core r4 B-3, core r3 B-4 | stay; RO adds a bound stand-in transport and the positive removal |

## 14. Full runs

Both runs: `env -i HOME=/tmp/aosd4/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp PATH=/tmp/aosd4/bintest:/tmp/aosd4/pnpmbin:/tmp/aosd4/nodebin:/usr/bin:/bin pnpm -r --no-bail test`
(fake `HOME`, no `AO_*`, no agent binary, tmux through the `aosd4-T` shim, the local vitest).

| Package | Baseline `c8a35d47` (17:47:25 to 17:48:51) | Final `13c58b2c` (17:55:03 to 17:56:30) |
| --- | --- | --- |
| `packages/core` | files 55 passed (55); tests 1403 passed, 22 expected fail (1425) | files 56 passed (56); tests 1406 passed, 25 expected fail (1431) |
| `packages/plugins/agent-claude-code` | files 4 passed (4); tests 214 passed (214) | files 4 passed (4); tests 214 passed (214) |
| `packages/plugins/agent-codex` | files 4 passed (4); tests 220 passed (220) | files 4 passed (4); tests 220 passed (220) |
| `packages/plugins/agent-gemini` | files 2 passed (2); tests 67 passed (67) | files 2 passed (2); tests 67 passed (67) |
| `packages/plugins/agent-opencode` | files 6 passed (6); tests 322 passed (322) | files 6 passed (6); tests 322 passed (322) |
| `packages/plugins/notifier-desktop` | files 1 passed (1); tests 26 passed (26) | files 1 passed (1); tests 26 passed (26) |
| `packages/plugins/runtime-herdr` | files 4 passed (4); tests 49 passed (49) | files 4 passed (4); tests 49 passed (49) |
| `packages/plugins/runtime-tmux` | files 4 passed (4); tests 91 passed (91) | files 5 passed (5); tests 100 passed (100) |
| `packages/plugins/scm-github` | files 3 passed (3); tests 140 passed, 5 skipped (145) | files 3 passed (3); tests 140 passed, 5 skipped (145) |
| `packages/plugins/tracker-github` | files 1 passed (1); tests 42 passed (42) | files 1 passed (1); tests 42 passed (42) |
| `packages/plugins/workspace-worktree` | files 5 passed (5); tests 72 passed (72) | files 5 passed (5); tests 72 passed (72) |
| `packages/integration-tests` | files 10 passed, 3 skipped (13); tests 91 passed, 24 skipped (115) | files 10 passed, 3 skipped (13); tests 91 passed, 24 skipped (115) |
| `packages/cli` | files 21 passed (21); tests 269 passed (269) | files 21 passed (21); tests 269 passed (269) |

Both runs exit 0. Logs: `/tmp/aosd4/logs/full-baseline.out`, `/tmp/aosd4/logs/full-final.out`.

`pnpm typecheck` exit 0; `pnpm lint` exit 0 with 5 warnings, all in files that this round did not change
(`cli/src/commands/spawn.ts:333`, `core/src/activity-log.ts:91`, `core/src/plugin-registry.ts:232`,
`core/src/session-manager.ts:2223,2230`); `prettier --check` of the three test files: clean. gitleaks
(`sh .husky/pre-commit` under `env -i`, before each commit): "no leaks found".

## 15. Reproducer scripts (outside the repository, `/tmp/aosd4/scripts/`)

`t1_exec.mjs` is the helper of t4 part 5: it runs one tmux argument list on the terminal of `script`.

### t4_legacy_guard_assoc.mjs

```js
// t4 (review r3 B-4, OD-18 (a) with the atomic no-token check, M-2): forms of design r4 on private
// tmux 3.4 servers (-L aosd4-t4a, aosd4-t4b, aosd4-t4r only). Run under the scratch environment:
//   env -i HOME=/tmp/aosd4/home PATH=/tmp/aosd4/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
//     SHELL=/bin/sh TERM=xterm-256color node /tmp/aosd4/scripts/t4_legacy_guard_assoc.mjs
//  1. the review's B-4: a legacy kill by name ends a later launch that has a token.
//  2. the legacy guard: the token guard of design r3 2.3 with an EMPTY expected token. It mutates
//     only a session without a token (kill, a paste of the message, Enter), in one client command.
//  3. a race: a racer replaces R with a token launch or a tokenless launch between client commands.
//     The legacy guard (one command) against a client-side preflight read plus a kill (two commands).
//  4. M-2: the association of design r3 (empty token only) against the association of design r4
//     (the server PID, $N and pane_pid inside the check; a retry with the intent's token adopts it;
//     a guarded clear removes exactly that token). Also: `$` in a branch, and `#{s/^.//:session_id}`.
//  5. the legacy attach through the legacy guard, on the terminal of `script`.
//  6. R-1: a pane option @ao_launch "" shadows the session's token for the legacy guard.
// Every server, pane, racer and client PID goes to /tmp/aosd4/logs/pids.txt; the script stops each
// by its exact PID and removes only the sockets that it created.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd4";
const A = "aosd4-t4a", B = "aosd4-t4b", R = "aosd4-t4r";
const sockOf = (srv) => `/tmp/tmux-${process.getuid()}/${srv}`;
for (const srv of [A, B, R]) if (existsSync(sockOf(srv))) throw new Error(`${sockOf(srv)} exists: not started by this script`);
const started = new Map();
const ownSockets = new Set();
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, what);
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t4 ${what} pid=${pid}\n`);
}
function tm(srv, args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", srv, ...args], { encoding: "utf8" });
  if (existsSync(sockOf(srv))) ownSockets.add(srv);
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
function remember(srv) {
  const pid = Number(tm(srv, ["display-message", "-p", "#{pid}"]).out);
  if (pid) track(pid, `tmux server ${srv}`);
  for (const p of tm(srv, ["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter(Boolean)) track(Number(p), `pane on ${srv}`);
}
function show(label, r) {
  const o = typeof r === "string" ? r : `exit ${r.code} | out ${JSON.stringify(r.out)} | err ${JSON.stringify(r.err)}`;
  console.log(`  ${label.padEnd(72)} ${o}`);
}
const token = () => randomBytes(16).toString("hex");
const q = (fmt) => `"${fmt}"`;
const has = (srv, name) => tm(srv, ["has-session", "-t", `=${name}`]).code === 0;
const tokOf = (srv, name) => tm(srv, ["display-message", "-p", "-t", `=${name}:`, "#{@ao_launch}"]).out;
function createArgs(name, tok, cmd = "/bin/sleep 600") {
  const base = ["new-session", "-d", "-P", "-F", "ao-created:#{pid}|#{session_id}", "-s", name, "-c", `${S}/home`, cmd];
  if (!tok) return base;
  return [...base, ";", "set-option", "-t", `=${name}:`, "@ao_launch", tok,
    ";", "display-message", "-p", "-t", `=${name}:`, "ao-token:#{session_id}|#{@ao_launch}"];
}
// The guard of design r3 section 2.3. With tok = "" it is the legacy guard of design r4 section 2.2:
// the TRUE branch runs only for a session whose @ao_launch is empty or unset.
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
function gated(name, inner) {
  const refused = `display-message -p ${q("ao-refused:#{pid}")}`;
  const gateFalse = `if-shell -F -t =${name}: ${q(`#{==:#{session_name},ao.cap.x}`)} { ${refused} } { ${inner} }`;
  return ["display-message", "-p", "ao-server:#{pid}", ";", "has-session", "-t", `=${name}`, ";",
    "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`, gateFalse, refused,
    ";", "display-message", "-p", "ao-end"];
}
// Design r3 section 2.9: a token only for the audited pane_pid of a session without a token.
function associateR3(name, panePid, tok) {
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p ${q("ao-assoc:#{pid}")}`;
  const no = `display-message -p -t =${name}: ${q("ao-assoc-refused:#{pid}:#{pane_pid}:#{@ao_launch}")}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:#{session_name}/#{pane_pid}/#{@ao_launch},${name}/${panePid}/}`)} { ${set} } { ${no} }`);
}
// Design r4 section 3.2: the server PID, the session name, the number of $N, the pane_pid and the token
// are compared inside tmux. An empty token: set the intent's token. The intent's token: adopt it (a
// retry after a lost answer or a failed record step). Else: refused, with the values that tmux sees.
const IDENT = "#{pid}/#{session_name}/#{s/^.//:session_id}/#{pane_pid}/#{@ao_launch}";
function associateR4(name, ev, tok) {
  const want = `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}`;
  const set = `set-option -t =${name}: @ao_launch ${tok} ; display-message -p -t =${name}: ${q("ao-assoc:#{pid}:#{session_id}")}`;
  const adopt = `display-message -p -t =${name}: ${q("ao-assoc-adopt:#{pid}:#{session_id}")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  const second = `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}/${tok}}`)} { ${adopt} } { ${no} }`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}/}`)} { ${set} } { ${second} }`);
}
// Design r4 section 3.2: the owner-approved clear of exactly the intent's token.
function clearR4(name, ev, tok) {
  const want = `${ev.serverPid}/${name}/${ev.sid.slice(1)}/${ev.panePid}/${tok}`;
  const clear = `set-option -u -t =${name}: @ao_launch ; display-message -p -t =${name}: ${q("ao-assoc-cleared:#{pid}:#{session_id}:[#{@ao_launch}]")}`;
  const no = `display-message -p -t =${name}: ${q(`ao-assoc-refused:${IDENT}`)}`;
  return gated(name, `if-shell -F -t =${name}: ${q(`#{==:${IDENT},${want}}`)} { ${clear} } { ${no} }`);
}
function evidence(srv, name) {
  const [serverPid, sid, panePid] = tm(srv, ["display-message", "-p", "-t", `=${name}:`, "#{pid}|#{session_id}|#{pane_pid}"]).out.split("|");
  return { serverPid, sid, panePid };
}
function marks(r) {
  return r.out.split("\n").map((l) => l.split(":")[0]).join(",") + ` exit=${r.code}`;
}

try {
  console.log("== 1. the review's B-4: a legacy kill by name ends a later token launch");
  tm(A, ["new-session", "-d", "-s", "keeper", "/bin/sleep 600"]);
  tm(A, createArgs("app", ""));
  remember(A);
  show("legacy record's session app (no token); has-session", String(has(A, "app")));
  tm(A, ["kill-session", "-t", "=app"]);
  const t1 = token();
  show("another operation replaces app with a token launch", tm(A, createArgs("app", t1)));
  remember(A);
  show("the pending legacy stop: kill-session -t =app", tm(A, ["kill-session", "-t", "=app"]));
  show("the token launch still exists", String(has(A, "app")));

  console.log("== 2. the legacy guard (the token guard with an empty expected token)");
  tm(A, createArgs("leg", ""));
  const t2 = token();
  tm(A, createArgs("tok", t2));
  remember(A);
  let r = tm(A, guardArgs("tok", "", "kill-session -t =tok"));
  show("legacy guard kill of a token launch", r);
  show("  answer marks; the token launch exists", `${marks(r)}; ${has(A, "tok")}`);
  r = tm(A, guardArgs("leg", "", "kill-session -t =leg"));
  show("legacy guard kill of a tokenless session", r);
  show("  answer marks; the session exists", `${marks(r)}; ${has(A, "leg")}`);
  r = tm(A, guardArgs("gone", "", "kill-session -t =gone"));
  show("legacy guard kill of an absent session", r);
  // A token set to "" or unset reads as no token.
  tm(A, createArgs("emp", token()));
  remember(A);
  show("set-option @ao_launch '' on emp", tm(A, ["set-option", "-t", "=emp:", "@ao_launch", ""]));
  show("  legacy guard kill of emp: marks", marks(tm(A, guardArgs("emp", "", "kill-session -t =emp"))));
  // The legacy send: the message through a buffer, then Enter, each step one guarded command.
  tm(A, createArgs("legs", "", "/bin/cat -v"));
  const t3 = token();
  tm(A, createArgs("toks", t3, "/bin/cat -v"));
  remember(A);
  writeFileSync(`${S}/tmp/t4-msg.txt`, "legacy-message $HOME ; #{pid}");
  for (const name of ["legs", "toks"]) {
    tm(A, ["load-buffer", "-b", "ao-t4", `${S}/tmp/t4-msg.txt`]);
    r = tm(A, guardArgs(name, "", `paste-buffer -d -b ao-t4 -t =${name}:`, "delete-buffer -b ao-t4"));
    const r2 = tm(A, guardArgs(name, "", `send-keys -t =${name}: Enter`));
    await sleep(200);
    show(`legacy guard paste and Enter to ${name}: marks`, `${marks(r)} / ${marks(r2)}`);
    show(`  ${name} pane shows`, JSON.stringify(tm(A, ["capture-pane", "-p", "-t", `=${name}:`]).out));
  }
  show("buffer ao-t4 left over", String(tm(A, ["list-buffers", "-F", "#{buffer_name}"]).out.split("\n").includes("ao-t4")));

  console.log("== 3. the race: a racer replaces R between client commands (200 tries each)");
  tm(R, ["new-session", "-d", "-s", "keeper", "/bin/sleep 600"]);
  remember(R);
  const stop = `${S}/tmp/t4-race-stop`;
  if (existsSync(stop)) unlinkSync(stop);
  const tmuxR = `/usr/bin/tmux -f /dev/null -L ${R}`;
  const racer = spawn("/bin/bash", ["-c",
    `i=0; while [ ! -e ${stop} ]; do i=$((i+1)); ${tmuxR} kill-session -t =R 2>/dev/null; ` +
    `if [ $((i % 2)) -eq 0 ]; then ${tmuxR} new-session -d -s R '/bin/sleep 600' \\; set-option -t =R: @ao_launch racer$i 2>/dev/null; ` +
    `else ${tmuxR} new-session -d -s R '/bin/sleep 600' 2>/dev/null; fi; done`], { stdio: "ignore" });
  track(racer.pid, "racer loop");
  const count = { guard: { done: 0, doneWithToken: 0, kept: 0, absent: 0, other: 0 }, preflight: { killed: 0, killedWithToken: 0, skipped: 0, absent: 0 } };
  for (let i = 0; i < 200; i++) {
    await sleep(Math.floor(Math.random() * 8));
    r = tm(R, guardArgs("R", "", `display-message -p -t =R: ${q("ao-victim:#{session_id}:[#{@ao_launch}]")} ; kill-session -t =R`));
    const victim = r.out.split("\n").find((l) => l.startsWith("ao-victim:"));
    if (victim) { count.guard.done++; if (!victim.endsWith("[]")) count.guard.doneWithToken++; }
    else if (r.out.includes("ao-kept:")) count.guard.kept++;
    else if (/can't find session/.test(r.err)) count.guard.absent++;
    else count.guard.other++;
  }
  for (let i = 0; i < 200; i++) {
    await sleep(Math.floor(Math.random() * 8));
    const pre = tm(R, ["display-message", "-p", "-t", "=R:", "#{session_name}|#{@ao_launch}"]);
    if (pre.code !== 0 || !pre.out.startsWith("R|")) { count.preflight.absent++; continue; }
    if (pre.out !== "R|") { count.preflight.skipped++; continue; }
    // The preflight saw no token. The kill is a second client command; it prints what it kills.
    r = tm(R, ["display-message", "-p", "-t", "=R:", "ao-victim:#{session_id}:[#{@ao_launch}]", ";", "kill-session", "-t", "=R"]);
    const victim = r.out.split("\n").find((l) => l.startsWith("ao-victim:"));
    if (victim) { count.preflight.killed++; if (!victim.endsWith("[]")) count.preflight.killedWithToken++; }
  }
  writeFileSync(stop, "");
  await new Promise((res) => racer.once("exit", res));
  show("legacy guard, one command (200)", JSON.stringify(count.guard));
  show("client preflight read, then a kill (200)", JSON.stringify(count.preflight));

  console.log("== 4. M-2: the association, design r3 against design r4");
  show("a '$' in a nested format: #{==:#{session_id},$N} for the own $N", (() => {
    tm(B, createArgs("L", ""));
    remember(B);
    const ev = evidence(B, "L");
    const a = tm(B, gated("L", `if-shell -F -t =L: ${q(`#{==:#{session_id},${ev.sid}}`)} { display-message -p yes } { display-message -p no }`));
    const b = tm(B, gated("L", `if-shell -F -t =L: ${q(`#{==:#{session_id},\\${ev.sid}}`)} { display-message -p yes } { display-message -p no }`));
    const c = tm(B, gated("L", `if-shell -F -t =L: ${q(`#{==:#{s/^.//:session_id},${ev.sid.slice(1)}}`)} { display-message -p yes } { display-message -p no }`));
    return `sid ${ev.sid}: plain ${JSON.stringify(a.out.split("\n")[1] ?? a.err)}; backslash ${JSON.stringify(b.out.split("\n")[1] ?? b.err)}; s/^.// ${JSON.stringify(c.out.split("\n")[1] ?? c.err)}`;
  })());
  let ev = evidence(B, "L");
  show("audited evidence of L (server PID | $N | pane_pid)", JSON.stringify(ev));
  const tA = token();
  show("r3: associate L", marks(tm(B, associateR3("L", ev.panePid, tA))));
  show("r3: the record step fails; a retry with a new token: marks", marks(tm(B, associateR3("L", ev.panePid, token()))));
  show("r3: L keeps the stranded token", String(tokOf(B, "L") === tA));
  show("r3: the legacy guard kill of L (no record names the token): marks", marks(tm(B, guardArgs("L", "", "kill-session -t =L"))));
  show("  L exists", String(has(B, "L")));
  // Design r4: start again from a tokenless L.
  tm(B, ["set-option", "-u", "-t", "=L:", "@ao_launch"]);
  ev = evidence(B, "L");
  const tI = token();
  show("r4: associate L with the intent's token", tm(B, associateR4("L", ev, tI)));
  show("r4: L has the intent's token", String(tokOf(B, "L") === tI));
  show("r4: a retry with the intent's token (adopt): marks", marks(tm(B, associateR4("L", ev, tI))));
  show("r4: an association with another token: marks", marks(tm(B, associateR4("L", ev, token()))));
  show("r4: L still has the intent's token", String(tokOf(B, "L") === tI));
  show("r4: the evidence with another server PID: marks", marks(tm(B, associateR4("L", { ...ev, serverPid: String(Number(ev.serverPid) + 1) }, tI))));
  show("r4: the evidence with another $N: marks", marks(tm(B, associateR4("L", { ...ev, sid: `$${Number(ev.sid.slice(1)) + 7}` }, tI))));
  show("r4: the evidence with another pane_pid: marks", marks(tm(B, associateR4("L", { ...ev, panePid: String(Number(ev.panePid) + 1) }, tI))));
  show("r4: the guard with the intent's token acts on L (a display)", marks(tm(B, guardArgs("L", tI, "display-message -p -t =L: own"))));
  show("r4: clear with another token: marks", marks(tm(B, clearR4("L", ev, token()))));
  show("r4: clear with the intent's token", tm(B, clearR4("L", ev, tI)));
  show("r4: L has no token; L exists", `${JSON.stringify(tokOf(B, "L"))}; ${has(B, "L")}`);
  // A replaced pane (respawn-pane -k): the same $N, another pane_pid.
  tm(B, ["respawn-pane", "-k", "-t", "=L:", "/bin/sleep 600"]);
  remember(B);
  show("r4: after respawn-pane -k, the old evidence: marks", marks(tm(B, associateR4("L", ev, tI))));
  // A replaced session: kill and new-session (another $N).
  tm(B, ["kill-session", "-t", "=L"]);
  tm(B, createArgs("L", ""));
  remember(B);
  show("r4: after a new L, the old evidence: marks", marks(tm(B, associateR4("L", ev, tI))));
  // Two servers with the same name and the same $N: the server PID decides.
  tm(R, ["kill-server"]);
  await sleep(150);
  tm(R, createArgs("L", ""));
  remember(R);
  const evR = evidence(R, "L");
  show("server t4r: L, evidence", JSON.stringify(evR));
  show("r4: t4r's evidence sent to server t4b's L: marks", marks(tm(B, associateR4("L", { ...evR, sid: evidence(B, "L").sid, panePid: evidence(B, "L").panePid }, tI))));

  console.log("== 5. the legacy attach through the legacy guard (terminal of script)");
  tm(A, createArgs("lat", ""));
  tm(A, createArgs("tat", token()));
  remember(A);
  for (const name of ["tat", "lat"]) {
    const argv = ["-f", "/dev/null", "-L", A, ...guardArgs(name, "", `attach-session -t =${name}`, "has-session -t %2147483647")];
    writeFileSync(`${S}/tmp/t4-attach.json`, JSON.stringify(argv));
    const child = spawn("/usr/bin/script", ["-qfec", `${S}/nodebin/node ${S}/scripts/t1_exec.mjs ${S}/tmp/t4-attach.json`, "/dev/null"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color" } });
    track(child.pid, "script (attach)");
    const exited = new Promise((res) => child.once("exit", (c) => res(c)));
    let got = ""; child.stdout.on("data", (d) => (got += d)); child.stderr.on("data", (d) => (got += d));
    let clients = "";
    for (let i = 0; i < 20 && !clients; i++) { await sleep(100); clients = tm(A, ["list-clients", "-F", "#{client_session}:#{client_pid}"]).out; }
    for (const l of clients.split("\n").filter(Boolean)) track(Number(l.split(":")[1]), "tmux client (attach)");
    show(`legacy guarded attach to ${name}: clients`, JSON.stringify(clients));
    if (clients) tm(A, ["detach-client", "-s", `=${name}`]);
    const code = await Promise.race([exited, sleep(3000).then(() => "timeout")]);
    if (code === "timeout") { try { process.kill(child.pid, "SIGKILL"); } catch {} }
    show(`  script exit; client output`, `${code}; ${JSON.stringify(got.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b[()][A-Z0-9]/g, "").replace(/\r/g, "").slice(0, 200))}`);
  }

  console.log("== 6. R-1: a pane option @ao_launch '' shadows the session's token");
  const t6 = token();
  tm(A, createArgs("shd", t6));
  remember(A);
  show("set-option -p -t =shd: @ao_launch ''", tm(A, ["set-option", "-p", "-t", "=shd:", "@ao_launch", ""]));
  show("#{@ao_launch} of shd now", JSON.stringify(tokOf(A, "shd")));
  show("show-options -v -t =shd: @ao_launch (session scope)", String(tm(A, ["show-options", "-v", "-t", "=shd:", "@ao_launch"]).out === t6));
  show("legacy guard kill of shd: marks", marks(tm(A, guardArgs("shd", "", "kill-session -t =shd"))));
  show("  shd exists", String(has(A, "shd")));
} finally {
  for (const srv of [A, B, R]) remember(srv);
  const servers = [...started].filter(([, w]) => w.startsWith("tmux server")).map(([p]) => p);
  for (const [p, w] of started) if (!w.startsWith("tmux server")) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  for (const p of servers) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(200);
  for (const srv of ownSockets) if (existsSync(sockOf(srv))) unlinkSync(sockOf(srv)); // sockets of servers that this script started
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own sockets left: ${[A, B, R].filter((s) => existsSync(sockOf(s)))}`);
}
```

### t1_exec.mjs

```js
// t1_exec: run /usr/bin/tmux with the argv list in a JSON file, on the terminal of `script` (t4 part 5).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
const r = spawnSync("/usr/bin/tmux", JSON.parse(readFileSync(process.argv[2], "utf8")), { stdio: "inherit" });
process.exit(r.status ?? 1);
```

### t4b_numeric_forms.mjs

```js
// t4b (design r4 sections 2.2 and 3.2): two forms on a private tmux 3.4 server (-L aosd4-t4c only).
// Run as t4. 1. A $N with two digits inside a nested format (a '$' in a branch string, design r3 t2).
// 2. Numeric compares inside tmux: #{e|>=:...}, #{e|<=:...}, #{&&:...}, and a capability gate for
//    them (a known operator gives FALSE for x >= x+1; an unknown operator over a nested format is TRUE).
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const S = "/tmp/aosd4";
const C = "aosd4-t4c";
const SOCK = `/tmp/tmux-${process.getuid()}/${C}`;
if (existsSync(SOCK)) throw new Error(`${SOCK} exists: not started by this script`);
const started = new Map();
let own = false;
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, what);
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t4b ${what} pid=${pid}\n`);
}
function tm(args) {
  const r = spawnSync("/usr/bin/tmux", ["-f", "/dev/null", "-L", C, ...args], { encoding: "utf8" });
  if (existsSync(SOCK)) own = true;
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}
function remember() {
  const pid = Number(tm(["display-message", "-p", "#{pid}"]).out);
  if (pid) track(pid, `tmux server ${C}`);
  for (const p of tm(["list-panes", "-a", "-F", "#{pane_pid}"]).out.split("\n").filter(Boolean)) track(Number(p), `pane on ${C}`);
}
const show = (l, v) => console.log(`  ${l.padEnd(76)} ${v}`);
const q = (f) => `"${f}"`;
// One nested if-shell inside a top-level branch string, as in the guards.
function nested(name, cond) {
  const r = tm(["has-session", "-t", `=${name}`, ";", "if-shell", "-F", "-t", `=${name}:`, `#{==:#{session_name},${name}}`,
    `if-shell -F -t =${name}: ${q(cond)} { display-message -p TRUE } { display-message -p FALSE }`, "display-message -p gate-false"]);
  return r.code === 0 ? r.out : `exit ${r.code} ${JSON.stringify(r.out)} ${JSON.stringify(r.err)}`;
}
try {
  for (let i = 0; i < 12; i++) tm(["new-session", "-d", "-s", `n${i}`, "/bin/sleep 600"]);
  remember();
  const sid = tm(["display-message", "-p", "-t", "=n11:", "#{session_id}"]).out;
  console.log(`== 1. $N with two digits (n11 is ${sid}); HOME is set in the server environment`);
  show(`#{==:#{session_id},${sid}} (plain)`, nested("n11", `#{==:#{session_id},${sid}}`));
  show(`#{==:#{session_id},\\${sid}} (backslash)`, nested("n11", `#{==:#{session_id},\\${sid}}`));
  show(`#{==:#{s/^.//:session_id},${sid.slice(1)}} (number only)`, nested("n11", `#{==:#{s/^.//:session_id},${sid.slice(1)}}`));
  show(`#{==:#{s/^.//:session_id},${sid.slice(1)}} for n10 (another $N)`, nested("n10", `#{==:#{s/^.//:session_id},${sid.slice(1)}}`));
  show("#{==:x$HOME,x} ($HOME: a name that the server environment has)", nested("n11", "#{==:x$HOME,x}"));

  console.log("== 2. numeric compares inside tmux");
  const created = Number(tm(["display-message", "-p", "-t", "=n11:", "#{session_created}"]).out);
  show("session_created of n11", String(created));
  show(`#{e|>=:#{session_created},${created - 15}} (createdAt - 15 s)`, nested("n11", `#{e|>=:#{session_created},${created - 15}}`));
  show(`#{e|<=:#{session_created},${created + 1}} (createdAt + 1 s)`, nested("n11", `#{e|<=:#{session_created},${created + 1}}`));
  show(`#{e|<=:#{session_created},${created - 16}} (before the window)`, nested("n11", `#{e|<=:#{session_created},${created - 16}}`));
  const win = (lo, hi) => `#{&&:#{==:#{session_name}/#{@ao_launch},n11/},#{&&:#{e|>=:#{session_created},${lo}},#{e|<=:#{session_created},${hi}}}}`;
  show("no token AND inside [createdAt-15, createdAt+1]", nested("n11", win(created - 15, created + 1)));
  show("no token AND inside a window that ends before the session", nested("n11", win(created - 30, created - 16)));
  tm(["set-option", "-t", "=n11:", "@ao_launch", "0123456789abcdef0123456789abcdef"]);
  show("a token AND inside the window", nested("n11", win(created - 15, created + 1)));
  show("gate: #{e|>=:#{session_created},#{e|+:#{session_created},1}} (x >= x+1)", nested("n11", "#{e|>=:#{session_created},#{e|+:#{session_created},1}}"));
  show("gate with an unknown operator: #{e|zz:#{session_created},#{e|+:#{session_created},1}}", nested("n11", "#{e|zz:#{session_created},#{e|+:#{session_created},1}}"));
  show("gate with an unknown operator: #{nosuch:#{session_created},1}", nested("n11", "#{nosuch:#{session_created},1}"));
} finally {
  remember();
  const server = [...started].find(([, w]) => w.startsWith("tmux server"))?.[0];
  for (const [p, w] of started) if (w.startsWith("pane")) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  if (server) try { process.kill(server, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(150);
  if (own && existsSync(SOCK)) unlinkSync(SOCK);
  const left = [...started.keys()].filter((p) => existsSync(`/proc/${p}`));
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}; own socket left: ${existsSync(SOCK)}`);
}
```

### t5_wrapper_drain.mjs

```js
// t5 (review r3 B-1, design r4 section 4.3): which processes still run old record-writer code after the
// RW barrier installs new wrapper files? The shipped GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER and the
// Claude METADATA_UPDATER_SCRIPT of the build at c8a35d47 run under bash with scratch values only. Run:
//   env -i HOME=/tmp/aosd4/home PATH=/tmp/aosd4/nodebin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
//     SHELL=/bin/sh node /tmp/aosd4/scripts/t5_wrapper_drain.mjs
//  A. the review's case: `gh pr create` through the wrapper; the helper file is replaced while real gh
//     runs. The command line, the open descriptors, the inode rule, the process tree, the lost write.
//  B. the same case with the drain of design r4: the Node write waits until the old writer set is empty.
//  C. a wrapper killed while its `mv` child waits: the child loses its parent but keeps its process group.
//  D. the Claude hook: its command line, its open descriptor; an in-place rewrite of the running hook
//     file against a rewrite by rename.
//  E. the git wrapper: `git checkout -b` in a scratch repository.
// The fd scan reads /proc/<pid>/fd only for the processes that this script started (descendants and
// members of their process groups); /proc/<pid>/stat is read for every process, as `ps` does.
// Every started PID goes to /tmp/aosd4/logs/pids.txt; the script stops each by its exact PID.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync,
  statSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

if (process.env.TMUX || Object.keys(process.env).some((k) => k.startsWith("AO_"))) throw new Error("not the scratch env");
const WT = "/home/taisung/.worktrees/agent-orchestrator/ao-52";
const { GH_WRAPPER, GIT_WRAPPER, AO_METADATA_HELPER } = await import(`${WT}/packages/core/dist/agent-workspace-hooks.js`);
const { METADATA_UPDATER_SCRIPT } = await import(`${WT}/packages/plugins/agent-claude-code/dist/index.js`);
const S = "/tmp/aosd4";
const root = `${S}/rw`;
rmSync(root, { recursive: true, force: true });
for (const d of ["bin", "real", "sessions", "home", "ws/.claude", "repo"]) mkdirSync(`${root}/${d}`, { recursive: true });
const record = `${root}/sessions/app-1`;
const started = new Map();
function track(pid, what) {
  if (!pid || started.has(pid)) return;
  started.set(pid, { what, start: stat(pid)?.start });
  appendFileSync(`${S}/logs/pids.txt`, `${new Date().toISOString().slice(11, 23)} t5 ${what} pid=${pid}\n`);
}
const show = (l, v) => console.log(`  ${l.padEnd(66)} ${v}`);
const env = { HOME: `${root}/home`, PATH: `${root}/bin:/usr/bin:/bin`, GH_PATH: `${root}/real/gh`, AO_STATE_ROOT: root,
  AO_DATA_DIR: `${root}/sessions`, AO_SESSION: "app-1", TMPDIR: `${S}/tmp`, LANG: "C" };
const writeAtomic = (path, text, mode) => { writeFileSync(`${path}.new`, text, { mode }); renameSync(`${path}.new`, path); };
const inode = (path) => { const s = statSync(path); return `${s.dev}:${s.ino}`; };
function install() {
  writeAtomic(`${root}/bin/gh`, GH_WRAPPER, 0o755);
  writeAtomic(`${root}/bin/git`, GIT_WRAPPER, 0o755);
  writeAtomic(`${root}/bin/ao-metadata-helper.sh`, AO_METADATA_HELPER, 0o644);
  writeAtomic(`${root}/ws/.claude/metadata-updater.sh`, METADATA_UPDATER_SCRIPT, 0o755);
}
// The new build of the barrier: here the same wrappers with a no-op helper (the review's replacement).
function installNew() {
  writeAtomic(`${root}/bin/ao-metadata-helper.sh`, "update_ao_metadata() { :; }\n", 0o644);
  writeAtomic(`${root}/bin/gh`, GH_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
  writeAtomic(`${root}/bin/git`, GIT_WRAPPER.replace("auto-updates session metadata", "NEW BUILD"), 0o755);
}
function hold(name) {
  // A shim first on PATH: it marks that it runs, then waits for a release file.
  writeFileSync(`${root}/bin/${name}`, `#!/bin/bash\ntouch '${root}/${name}-reached'\nwhile [ ! -e '${root}/${name}-release' ]; do sleep 0.02; done\nexec /usr/bin/${name} "$@"\n`, { mode: 0o755 });
}
function reset() {
  for (const f of ["loaded", "release-gh", "mv-reached", "mv-release"]) rmSync(`${root}/${f}`, { force: true });
  rmSync(`${root}/bin/mv`, { force: true });
  writeFileSync(record, `worktree=${root}/repo\nbranch=main\nruntimeHandle=old\ngeneration=1\n`);
}
writeFileSync(`${root}/real/gh`, `#!/bin/bash\ntouch '${root}/loaded'\nwhile [ ! -e '${root}/release-gh' ]; do sleep 0.02; done\nprintf 'https://github.com/org/app/pull/7\\n'\n`, { mode: 0o755 });
async function waitFile(f, ms = 4000) { for (let i = 0; i < ms / 10; i++) { if (existsSync(f)) return true; await sleep(10); } return false; }

// /proc/<pid>/stat: comm in parentheses, then state ppid pgrp session ... starttime (field 22).
function stat(pid) {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return { pid: Number(pid), state: f[0], ppid: Number(f[1]), pgid: Number(f[2]), sid: Number(f[3]), start: Number(f[19]) };
  } catch { return null; }
}
const allStats = () => readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(stat).filter(Boolean);
const args = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); } catch { return "?"; } };
function descendants(pids, stats) {
  const out = new Set(pids);
  for (let grew = true; grew; ) { grew = false; for (const s of stats) if (!out.has(s.pid) && out.has(s.ppid)) { out.add(s.pid); grew = true; } }
  return out;
}
// The candidates for the fd scan: the processes that this script started, their descendants, and the
// members of their process groups (the product scans every process of the uid).
function candidates(stats) {
  const mine = descendants([process.pid], stats);
  const groups = new Set([...mine].map((p) => stats.find((s) => s.pid === p)?.pgid).filter((g) => g && g !== process.pid));
  for (const s of stats) if (groups.has(s.pgid)) mine.add(s.pid);
  mine.delete(process.pid);
  return mine;
}
// The inode rule of design r4 4.3: a process with an open descriptor on an OLD inode of a writer file.
function findOld(oldInodes) {
  const stats = allStats();
  const hits = [];
  for (const pid of candidates(stats)) {
    let fds; try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) {
      let st; try { st = statSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      if (oldInodes.has(`${st.dev}:${st.ino}`)) { hits.push({ pid, fd, link: readlinkSync(`/proc/${pid}/fd/${fd}`) }); break; }
    }
  }
  return { hits, stats };
}
// The drain set: each hit, its descendants, and its process group; with the start ticks of each.
function drainSet(oldInodes) {
  const { hits, stats } = findOld(oldInodes);
  const tree = descendants(hits.map((h) => h.pid), stats);
  const groups = new Set(hits.map((h) => stats.find((s) => s.pid === h.pid)?.pgid));
  const procs = stats.filter((s) => tree.has(s.pid) || groups.has(s.pgid)).map((s) => ({ ...s, args: args(s.pid) }));
  return { hits, procs, groups };
}
const nameRule = (a) => /metadata-updater\.sh|ao-metadata-helper\.sh/.test(a); // the rule of design r3 5.6
const uptimeTicks = () => Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 100);

try {
  console.log("== A. the review's case: the helper file is replaced while real gh runs");
  install(); reset(); hold("mv");
  const oldInodes = new Set([`${root}/bin/gh`, `${root}/bin/git`, `${root}/bin/ao-metadata-helper.sh`].map(inode));
  const ghA = spawn(`${root}/bin/gh`, ["pr", "create"], { env, stdio: "ignore", detached: true });
  track(ghA.pid, "A gh wrapper");
  const doneA = new Promise((r) => ghA.once("exit", (c) => r(c)));
  show("real gh started (the wrapper sourced the helper first)", String(await waitFile(`${root}/loaded`)));
  installNew();
  show("the wrapper's command line", JSON.stringify(args(ghA.pid)));
  show("matched by the name rule of design r3 5.6", String(nameRule(args(ghA.pid))));
  const fds = readdirSync(`/proc/${ghA.pid}/fd`).map((fd) => `${fd}->${readlinkSync(`/proc/${ghA.pid}/fd/${fd}`)}`);
  show("open descriptors of the wrapper", JSON.stringify(fds.filter((f) => !f.includes("/dev/null"))));
  show("fd 255 inode equals the OLD bin/gh inode; bin/gh now another inode",
    `${(() => { const s = statSync(`/proc/${ghA.pid}/fd/255`); return `${s.dev}:${s.ino}`; })() === [...oldInodes][0]}; ${inode(`${root}/bin/gh`) !== [...oldInodes][0]}`);
  let ds = drainSet(oldInodes);
  show("the inode rule finds", JSON.stringify(ds.hits.map((h) => `${h.pid} fd ${h.fd} ${h.link}`)));
  for (const p of ds.procs) { track(p.pid, `A drain member ${p.args.split(" ")[0]}`); show(`  drain member pid ${p.pid} ppid ${p.ppid} pgid ${p.pgid} start ${p.start} ${p.state}`, JSON.stringify(p.args)); }
  writeFileSync(`${root}/release-gh`, "");
  show("the old helper reached its mv (in-memory function)", String(await waitFile(`${root}/mv-reached`)));
  ds = drainSet(oldInodes);
  for (const p of ds.procs) { track(p.pid, `A drain member ${p.args.split(" ")[0]}`); show(`  drain member pid ${p.pid} ppid ${p.ppid} pgid ${p.pgid} ${p.state}`, JSON.stringify(p.args)); }
  writeFileSync(record, `worktree=${root}/repo\nbranch=main\nruntimeHandle=new\ngeneration=2\n`);
  writeFileSync(`${root}/mv-release`, "");
  show("wrapper exit; record", `${await doneA}; ${JSON.stringify(readFileSync(record, "utf8"))}`);

  console.log("== B. the drain of design r4: wait until the old writer set is empty, then write");
  install(); reset(); hold("mv");
  const oldB = new Set([`${root}/bin/gh`, `${root}/bin/git`, `${root}/bin/ao-metadata-helper.sh`].map(inode));
  const ghB = spawn(`${root}/bin/gh`, ["pr", "create"], { env, stdio: "ignore", detached: true });
  track(ghB.pid, "B gh wrapper");
  const doneB = new Promise((r) => ghB.once("exit", (c) => r(c)));
  await waitFile(`${root}/loaded`);
  installNew();
  // The pane's work goes on: real gh answers after 300 ms, the mv shim waits 300 ms more.
  setTimeout(() => writeFileSync(`${root}/release-gh`, ""), 300);
  setTimeout(() => writeFileSync(`${root}/mv-release`, ""), 600);
  const t0 = Date.now();
  const first = drainSet(oldB);
  const recorded = new Map(first.procs.map((p) => [p.pid, p.start]));
  const groups = first.groups;
  let polls = 0, gone = null;
  for (;;) {
    polls++;
    const again = drainSet(oldB);
    for (const p of again.procs) { if (!recorded.has(p.pid)) { recorded.set(p.pid, p.start); track(p.pid, `B drain member ${p.args.split(" ")[0]}`); } }
    for (const g of again.groups) groups.add(g);
    const live = [...recorded].filter(([pid, start]) => stat(pid)?.start === start && stat(pid)?.state !== "Z");
    if (live.length === 0 && again.hits.length === 0) {
      gone ??= uptimeTicks();
      // A member of a recorded group that started before the set emptied may be an orphaned writer.
      const late = allStats().filter((s) => groups.has(s.pgid) && s.start <= gone && s.state !== "Z");
      if (late.length === 0) break;
    }
    await sleep(20);
  }
  show("drain: polls; ms; members recorded", `${polls}; ${Date.now() - t0}; ${recorded.size}`);
  writeFileSync(record, readFileSync(record, "utf8").replace("runtimeHandle=old", "runtimeHandle=new").replace("generation=1", "generation=2"));
  show("Node write after the drain; wrapper exit; record", `${await doneB}; ${JSON.stringify(readFileSync(record, "utf8"))}`);

  console.log("== C. a wrapper killed while its mv child waits: the child keeps the process group");
  install(); reset(); hold("mv");
  const oldC = new Set([`${root}/bin/gh`, `${root}/bin/ao-metadata-helper.sh`].map(inode));
  const ghC = spawn(`${root}/bin/gh`, ["pr", "create"], { env, stdio: "ignore", detached: true });
  track(ghC.pid, "C gh wrapper");
  const doneC = new Promise((r) => ghC.once("exit", (c, s) => r(s ?? c)));
  await waitFile(`${root}/loaded`);
  writeFileSync(`${root}/release-gh`, "");
  await waitFile(`${root}/mv-reached`);
  const before = drainSet(oldC);
  const mvC = before.procs.find((p) => p.args.includes(`${root}/bin/mv`));
  track(mvC?.pid, "C mv shim");
  show("before: drain members", JSON.stringify(before.procs.map((p) => `${p.pid}/${p.ppid}/${p.pgid} ${p.args.split(" ").slice(0, 2).join(" ")}`)));
  process.kill(ghC.pid, "SIGKILL");
  show("wrapper ended by SIGKILL", String(await doneC));
  await sleep(100);
  const after = stat(mvC.pid);
  show("the mv shim: ppid now; pgid now (the wrapper's pgid)", `${after?.ppid}; ${after?.pgid} (${ghC.pid})`);
  const afterSet = drainSet(oldC);
  show("the inode rule now finds", JSON.stringify(afterSet.hits));
  show("a tree walk from the wrapper finds the mv shim", String(descendants([ghC.pid], allStats()).has(mvC.pid)));
  show("the group rule finds the mv shim (pgid, started before)", String(allStats().some((s) => s.pid === mvC.pid && s.pgid === ghC.pid)));
  writeFileSync(`${root}/mv-release`, "");
  await sleep(300);
  show("after the release: the record (the orphan wrote)", JSON.stringify(readFileSync(record, "utf8")));

  console.log("== D. the Claude hook: command line, descriptor, rewrite in place against rename");
  for (const mode of ["in place", "by rename"]) {
    install(); reset(); hold("mv");
    const hookPath = `${root}/ws/.claude/metadata-updater.sh`;
    const oldHook = new Set([inode(hookPath)]);
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" }, tool_response: "https://github.com/org/app/pull/9", exit_code: 0 });
    const hook = spawn("/bin/sh", ["-c", ".claude/metadata-updater.sh"], { cwd: `${root}/ws`, env: { ...env, PATH: `${root}/bin:/usr/bin:/bin` }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    track(hook.pid, `D hook sh (${mode})`);
    let hookOut = ""; hook.stdout.on("data", (d) => (hookOut += d)); hook.stderr.on("data", (d) => (hookOut += d));
    const doneD = new Promise((r) => hook.once("exit", (c) => r(c)));
    hook.stdin.end(input);
    await waitFile(`${root}/mv-reached`);
    const dset = drainSet(oldHook);
    for (const p of dset.procs) track(p.pid, `D drain member ${p.args.split(" ")[0]}`);
    show(`[${mode}] hook processes (pid/ppid/pgid args)`, JSON.stringify(dset.procs.map((p) => `${p.pid}/${p.ppid}/${p.pgid} ${p.args}`)));
    show(`[${mode}] the inode rule finds`, JSON.stringify(dset.hits.map((h) => `${h.pid} fd ${h.fd} ${h.link}`)));
    // The new hook text: the same length class, with a marker command at its start.
    const newText = `#!/usr/bin/env bash\ntouch '${root}/new-hook-head-ran'\n` + "#".repeat(4000) + `\ntouch '${root}/new-hook-tail-ran'\necho '{}'\n`;
    rmSync(`${root}/new-hook-head-ran`, { force: true }); rmSync(`${root}/new-hook-tail-ran`, { force: true });
    if (mode === "in place") writeFileSync(hookPath, newText, { mode: 0o755 }); else writeAtomic(hookPath, newText, 0o755);
    show(`[${mode}] the hook path inode is still the old one`, String(inode(hookPath) === [...oldHook][0]));
    writeFileSync(`${root}/mv-release`, "");
    const code = await doneD;
    show(`[${mode}] hook exit; output`, `${code}; ${JSON.stringify(hookOut.slice(0, 160))}`);
    show(`[${mode}] the record has the PR; the new head ran; the new tail ran`, `${readFileSync(record, "utf8").includes("pull/9")}; ${existsSync(`${root}/new-hook-head-ran`)}; ${existsSync(`${root}/new-hook-tail-ran`)}`);
  }

  console.log("== E. the git wrapper: git checkout -b in a scratch repository");
  install(); reset(); hold("mv");
  const genv = { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t5", GIT_AUTHOR_EMAIL: "t5@example.invalid", GIT_COMMITTER_NAME: "t5", GIT_COMMITTER_EMAIL: "t5@example.invalid" };
  spawnSync("/usr/bin/git", ["init", "-q", "-b", "main", `${root}/repo`], { env: genv });
  spawnSync("/usr/bin/git", ["-C", `${root}/repo`, "commit", "-q", "--allow-empty", "-m", "base"], { env: genv });
  const oldE = new Set([`${root}/bin/git`, `${root}/bin/ao-metadata-helper.sh`].map(inode));
  const gitE = spawn(`${root}/bin/git`, ["checkout", "-q", "-b", "feat/t5"], { cwd: `${root}/repo`, env: genv, stdio: "ignore", detached: true });
  track(gitE.pid, "E git wrapper");
  const doneE = new Promise((r) => gitE.once("exit", (c) => r(c)));
  show("the old helper reached its mv", String(await waitFile(`${root}/mv-reached`)));
  installNew();
  const eset = drainSet(oldE);
  for (const p of eset.procs) track(p.pid, `E drain member ${p.args.split(" ")[0]}`);
  show("git wrapper processes (pid/ppid/pgid args)", JSON.stringify(eset.procs.map((p) => `${p.pid}/${p.ppid}/${p.pgid} ${p.args}`)));
  show("the inode rule finds; the name rule matches", `${JSON.stringify(eset.hits.map((h) => `${h.pid} fd ${h.fd} ${h.link}`))}; ${eset.procs.some((p) => nameRule(p.args))}`);
  writeFileSync(`${root}/mv-release`, "");
  show("git wrapper exit; record branch line", `${await doneE}; ${JSON.stringify(readFileSync(record, "utf8").split("\n").find((l) => l.startsWith("branch=")))}`);

  console.log("== F. a bash script that reads on after a wait: a rewrite in place against a rewrite by rename");
  for (const mode of ["in place", "by rename"]) {
    const script = `${root}/f.sh`;
    rmSync(`${root}/f-old-tail`, { force: true }); rmSync(`${root}/f-new-tail`, { force: true });
    const oldText = `#!/bin/bash\nwhile [ ! -e '${root}/f-release' ]; do sleep 0.02; done\ntouch '${root}/f-old-tail'\n`;
    writeAtomic(script, oldText, 0o755);
    rmSync(`${root}/f-release`, { force: true });
    const f = spawn(script, [], { env, stdio: "ignore", detached: true });
    track(f.pid, `F script (${mode})`);
    const doneF = new Promise((r) => f.once("exit", (c) => r(c)));
    await sleep(200);
    const newText = `#!/bin/bash\n# ${"x".repeat(oldText.length)}\ntouch '${root}/f-new-tail'\n`;
    if (mode === "in place") writeFileSync(script, newText, { mode: 0o755 }); else writeAtomic(script, newText, 0o755);
    writeFileSync(`${root}/f-release`, "");
    show(`[${mode}] exit; the old tail ran; the new tail ran`, `${await doneF}; ${existsSync(`${root}/f-old-tail`)}; ${existsSync(`${root}/f-new-tail`)}`);
  }
} finally {
  for (const f of ["release-gh", "mv-release"]) writeFileSync(`${root}/${f}`, "");
  await sleep(300);
  // Only a PID whose start ticks are still the recorded ones (never a reused PID).
  for (const [p, { start }] of started) if (start !== undefined && stat(p)?.start === start) try { process.kill(p, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") throw e; }
  await sleep(100);
  const left = [...started].filter(([p, { start }]) => start !== undefined && stat(p)?.start === start && stat(p)?.state !== "Z").map(([p]) => p);
  console.log(`  started PIDs: ${started.size}; still running: ${JSON.stringify(left)}`);
}
```

### t6_inbox_append.sh

```bash
#!/usr/bin/env bash
# t6 (review r3 M-1, design r4 section 4.2): how does the bash of this host append one inbox record?
# Run under the scratch environment:
#   env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
#     bash /tmp/aosd4/scripts/t6_inbox_append.sh
#  1. strace: the open flags and the number of write() calls of `printf '%s\n' "$rec" >> file`, for
#     records of 200 to 9000 bytes (bash builtin printf, stdio buffer).
#  2. hex encoding in bash (LC_ALL=C, printf %02x "'c") of every byte 0x01 to 0xff against od.
#  3. four writers append 500 records each in parallel: every line complete and well formed.
set -u
S=/tmp/aosd4
R=$S/inbox
rm -rf "$R"; mkdir -p "$R"
echo "bash $BASH_VERSION; $(uname -sr)"
rec() { # rec <total bytes>: one record line of exactly that many bytes, newline included
  local n=$1 head='{"v":1,"key":"branch","launch":"0123456789abcdef0123456789abcdef","hex":"' tail='"}'
  local pad=$(( n - ${#head} - ${#tail} - 1 ))
  printf '%s%s%s' "$head" "$(head -c "$pad" /dev/zero | tr '\0' 'a')" "$tail"
}
echo "== 1. write() calls per appended record"
for n in 200 2048 4095 4096 4097 8192 9000; do
  line=$(rec "$n")
  f=$R/in-$n
  strace -f -qq -e trace=openat,write -o "$R/strace-$n.txt" bash -c 'printf "%s\n" "$1" >> "$2"' _ "$line" "$f"
  opens=$(grep -c "openat(.*in-$n\"" "$R/strace-$n.txt")
  flags=$(grep "openat(.*in-$n\"" "$R/strace-$n.txt" | sed -E 's/.*", ([^,]+), .*/\1/' | head -1)
  fd=$(grep "openat(.*in-$n\"" "$R/strace-$n.txt" | sed -E 's/.*= ([0-9]+)$/\1/' | head -1)
  writes=$(grep -cE "write\((1|$fd), " "$R/strace-$n.txt")
  sizes=$(grep -E "write\((1|$fd), " "$R/strace-$n.txt" | sed -E 's/.* = ([0-9]+)$/\1/' | paste -sd+)
  printf '  %5d bytes: opens %s flags %s; write() calls %s (bytes %s); file size %s\n' "$n" "$opens" "$flags" "$writes" "$sizes" "$(stat -c %s "$f")"
done
echo "== 2. hex encoding of every byte 0x01..0xff in bash (LC_ALL=C)"
all=""
for ((b = 1; b < 256; b++)); do printf -v c "\\x$(printf %02x "$b")"; all+=$c; done
hexenc() { local LC_ALL=C v=$1 h="" i x; for ((i = 0; i < ${#v}; i++)); do printf -v x '%02x' "'${v:i:1}"; h+=$x; done; printf '%s' "$h"; }
mine=$(hexenc "$all")
ref=$(printf '%s' "$all" | od -An -v -tx1 | tr -d ' \n')
echo "  bytes in the string: $(LC_ALL=C; echo ${#all}); hex digits: ${#mine}; equal to od: $([ "$mine" = "$ref" ] && echo yes || echo no)"
first_bad=""; for ((i = 0; i < ${#ref}; i += 2)); do [ "${mine:i:2}" = "${ref:i:2}" ] || { first_bad="byte $((i / 2 + 1)): bash ${mine:i:2} od ${ref:i:2}"; break; }; done
echo "  first difference: ${first_bad:-none}"
echo "  a branch name with a quote, a backslash and UTF-8: $(hexenc 'feat/a"b\c-é')"
echo "== 3. four parallel writers, 500 records each"
f=$R/parallel
pids=()
for w in 1 2 3 4; do
  bash -c 'for ((i = 0; i < 500; i++)); do printf "{\"v\":1,\"w\":%s,\"i\":%s,\"pad\":\"%s\"}\n" "$1" "$i" "$2" >> "$3"; done' _ "$w" "$(head -c 300 /dev/zero | tr '\0' "$w")" "$f" &
  pids+=($!)
  echo "$(date +%T.%N | cut -c1-12) t6 writer $w pid=$!" >> "$S/logs/pids.txt"
done
wait "${pids[@]}"
lines=$(wc -l < "$f")
good=$(grep -cE '^\{"v":1,"w":([1-4]),"i":[0-9]+,"pad":"(1{300}|2{300}|3{300}|4{300})"\}$' "$f")
mixed=$(grep -vcE '^\{"v":1,"w":([1-4]),"i":[0-9]+,"pad":"(1{300}|2{300}|3{300}|4{300})"\}$' "$f")
per=$(for w in 1 2 3 4; do grep -c "\"w\":$w," "$f"; done | paste -sd/)
consistent=$(awk -F'"w":|,"i":|,"pad":"' '{ if (substr($4,1,1) != $2) bad++ } END { print bad + 0 }' "$f")
echo "  lines $lines; well formed $good; malformed $mixed; per writer $per; pad digit not the writer: $consistent"
for p in "${pids[@]}"; do [ -e "/proc/$p" ] && echo "  writer $p still runs"; done
echo "  writers left: none"
```

### s1_process_groups.py

```python
"""s1 (review r3 B-2 and the R3a notes, design r4 section 5): process-group facts for the supervisor.

Run under the scratch environment:
  env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
    /usr/bin/python3 -I /tmp/aosd4/scripts/s1_process_groups.py
This process is a child subreaper (prctl 36), so every orphan of its children comes back to it and
stays visible as its descendant; the scan reads /proc only for its own descendants.
 1. a zombie-only group: what kill(-pgid, 0) answers, and what /proc shows.
 2. a group whose leader ended while a member runs: kill(-pgid, 0), /proc/<pgid>.
 3. an empty group: kill(-pgid, 0).
 4. a hook that starts a setsid child, a double-forked daemon and an `env -i` child: after the
    supervisor ends the hook's group, which processes still run, and which keep the marker variable.
Every started PID goes to /tmp/aosd4/logs/pids.txt; each is stopped by its exact PID and reaped.
"""
import ctypes
import os
import signal
import subprocess
import sys
import time

S = "/tmp/aosd4"
LOG = S + "/logs/pids.txt"
assert not any(k.startswith("AO_") for k in os.environ) and "TMUX" not in os.environ, "not the scratch env"
assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0  # PR_SET_CHILD_SUBREAPER
started = {}


def stat(pid):
    try:
        s = open(f"/proc/{pid}/stat").read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    f = s[s.rindex(")") + 2:].split()
    return {"pid": pid, "state": f[0], "ppid": int(f[1]), "pgid": int(f[2]), "sid": int(f[3]), "start": int(f[19])}


def track(pid, what):
    st = stat(pid)
    if pid and pid not in started:
        started[pid] = (what, st and st["start"])
        open(LOG, "a").write(f"{time.strftime('%H:%M:%S')} s1 {what} pid={pid}\n")


def descendants():
    stats = [stat(int(d)) for d in os.listdir("/proc") if d.isdigit()]
    stats = [s for s in stats if s]
    out = {os.getpid()}
    grew = True
    while grew:
        grew = False
        for s in stats:
            if s["pid"] not in out and s["ppid"] in out:
                out.add(s["pid"])
                grew = True
    out.discard(os.getpid())
    return [s for s in stats if s["pid"] in out]


def killpg0(pgid):
    try:
        os.killpg(pgid, 0)
        return "0 (a member exists)"
    except ProcessLookupError:
        return "ESRCH"


def show(label, value):
    print(f"  {label:<70} {value}", flush=True)


def reap_all():
    while True:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            return


try:
    print("== 1. a zombie-only group")
    z = subprocess.Popen(["/bin/sh", "-c", "exit 0"], start_new_session=True)  # never waited: a zombie
    track(z.pid, "zombie leader")
    time.sleep(0.2)
    show("leader state; kill(-pgid, 0)", f"{stat(z.pid)['state']}; {killpg0(z.pid)}")
    show("members of the group (pid state)", [(s["pid"], s["state"]) for s in descendants() if s["pgid"] == z.pid])
    z.wait()
    show("after the reap: kill(-pgid, 0)", killpg0(z.pid))

    print("== 2. a group whose leader ended while a member runs")
    lead = subprocess.Popen(["/bin/sh", "-c", "/bin/sleep 2 & echo $!"], start_new_session=True, stdout=subprocess.PIPE)
    track(lead.pid, "leader of group 2")
    member = int(lead.stdout.readline())
    track(member, "member of group 2")
    lead.wait()
    time.sleep(0.1)
    show("leader /proc entry exists; kill(-pgid, 0)", f"{os.path.exists(f'/proc/{lead.pid}')}; {killpg0(lead.pid)}")
    show("the member: ppid (this subreaper), pgid (the leader's PID)", f"{stat(member)['ppid']} ({os.getpid()}), {stat(member)['pgid']} ({lead.pid})")
    os.kill(member, signal.SIGKILL)
    time.sleep(0.1)
    show("the member killed, not yet reaped: state; kill(-pgid, 0)", f"{stat(member)['state']}; {killpg0(lead.pid)}")
    os.waitpid(member, 0)

    print("== 3. an empty group")
    show("kill(-pgid, 0) after the reap", killpg0(lead.pid))

    print("== 4. a hook that leaves its process group")
    marker = "AO_MUTATING_CHILD=s1-journal-1"
    # The long children do not keep the hook's stdout pipe (else the read below waits for them).
    hook = (
        "/usr/bin/setsid /bin/sleep 30 >/dev/null 2>&1 & echo setsid $!; "
        "( /usr/bin/setsid /bin/sh -c '/bin/sleep 30 >/dev/null 2>&1 & echo daemon $!' & ) ; sleep 0.1; "
        "/usr/bin/env -i /bin/sleep 30 >/dev/null 2>&1 & echo envi $!; "
        "/bin/sleep 30 >/dev/null 2>&1 & echo plain $!; "
        "sleep 0.2"
    )
    t0 = time.monotonic()
    h = subprocess.Popen(["/bin/sh", "-c", hook], start_new_session=True, stdout=subprocess.PIPE, text=True,
                         env={"PATH": "/usr/bin:/bin", "HOME": S + "/home", marker.split("=")[0]: marker.split("=")[1]})
    track(h.pid, "hook leader")
    kids = {}
    for line in h.stdout:
        kind, pid = line.split()
        kids[kind] = int(pid)
    h.wait()
    time.sleep(0.2)
    for kind, pid in kids.items():
        track(pid, f"hook child {kind}")
    for d in descendants():
        if d["pid"] not in started:
            track(d["pid"], "hook descendant")
    show("children: pid, pgid (hook group = leader pid)", {k: (p, stat(p) and stat(p)["pgid"]) for k, p in kids.items()} | {"leader": h.pid})
    # The supervisor's step 5: end the hook's group, then wait until it is empty.
    try:
        os.killpg(h.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    for _ in range(50):
        reap_all()
        if killpg0(h.pid) == "ESRCH":
            break
        time.sleep(0.05)
    show("after SIGTERM to the group and the drain: kill(-pgid, 0)", killpg0(h.pid))
    live = [d for d in descendants() if d["state"] != "Z"]
    rows = []
    for d in live:
        try:
            env = open(f"/proc/{d['pid']}/environ", "rb").read().split(b"\0")
        except OSError as e:
            env = [repr(e).encode()]
        rows.append((d["pid"], d["pgid"], d["sid"], marker.encode() in env))
    show("still running (pid, pgid, sid, has the marker)", rows)
    show("the escaped ones by kind", {k: (p in [r[0] for r in rows]) for k, p in kids.items()})
    show("seconds since the hook started", f"{time.monotonic() - t0:.2f}")
finally:
    for pid, (what, start) in list(started.items()):
        st = stat(pid)
        if st and start is not None and st["start"] == start and st["state"] != "Z":
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    time.sleep(0.2)
    reap_all()
    left = [p for p, (w, start) in started.items() if (stat(p) or {}).get("start") == start and start is not None]
    print(f"  started PIDs: {len(started)}; still present: {left}")
```

### s2_leader_holds_group.py

```python
"""s2 (design r4 section 5.4): a group leader that stays alive until the supervisor has drained the group.

Run under the scratch environment:
  env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
    /usr/bin/python3 -I /tmp/aosd4/scripts/s2_leader_holds_group.py
The leader of design r4: sh -c 'trap : TERM; IFS= read -r go || exit 99; "$@"; rc=$?; echo "rc=$rc";
IFS= read -r done; exit $rc' ao-leader <command...>. It does not exec the command, so its PID (the PGID)
stays in use until the supervisor writes "done": every signal to -PGID before that reaches only this
group. `trap : TERM` (a handler, not SIG_IGN) is reset by exec, so the command gets the default SIGTERM.
 1. the command with a grandchild in the group: SIGTERM to the group ends both, the leader stays and
    prints the exit status; the group then has only the leader; "done" ends the leader.
 2. EOF before "go": the leader exits 99 and the command never runs.
 3. EOF after the command (the supervisor died): the leader exits; a grandchild still runs (the journal).
Every started PID goes to /tmp/aosd4/logs/pids.txt; each is stopped by its exact PID and reaped.
"""
import os
import signal
import subprocess
import time

S = "/tmp/aosd4"
assert not any(k.startswith("AO_") for k in os.environ) and "TMUX" not in os.environ, "not the scratch env"
LEADER = ['/bin/sh', '-c', 'trap : TERM; IFS= read -r go || exit 99; "$@"; rc=$?; echo "rc=$rc"; IFS= read -r done; exit $rc', 'ao-leader']
started = {}


def stat(pid):
    try:
        s = open(f"/proc/{pid}/stat").read()
    except OSError:
        return None
    f = s[s.rindex(")") + 2:].split()
    return {"pid": pid, "state": f[0], "ppid": int(f[1]), "pgid": int(f[2]), "start": int(f[19])}


def track(pid, what):
    st = stat(pid)
    if pid and pid not in started:
        started[pid] = (what, st and st["start"])
        open(f"{S}/logs/pids.txt", "a").write(f"{time.strftime('%H:%M:%S')} s2 {what} pid={pid}\n")


def members(pgid):
    out = []
    for d in os.listdir("/proc"):
        if d.isdigit():
            st = stat(int(d))
            if st and st["pgid"] == pgid:
                out.append((st["pid"], st["state"]))
    return sorted(out)


def show(label, value):
    print(f"  {label:<66} {value}", flush=True)


try:
    print("== 1. SIGTERM to the group: the command and its grandchild end, the leader stays")
    flag = f"{S}/tmp/s2-ran"
    if os.path.exists(flag):
        os.unlink(flag)
    cmd = ["/bin/sh", "-c", f": > {flag}; /bin/sleep 30 & echo $! > {S}/tmp/s2-grandchild; wait"]
    p = subprocess.Popen(LEADER + cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, start_new_session=True)
    track(p.pid, "leader 1")
    p.stdin.write("go\n"); p.stdin.flush()
    for _ in range(100):
        if os.path.exists(f"{S}/tmp/s2-grandchild") and open(f"{S}/tmp/s2-grandchild").read().strip():
            break
        time.sleep(0.02)
    g = int(open(f"{S}/tmp/s2-grandchild").read())
    track(g, "grandchild 1")
    show("members before (pid, state); leader pid", f"{members(p.pid)}; {p.pid}")
    os.killpg(p.pid, signal.SIGTERM)
    rc = p.stdout.readline().strip()
    time.sleep(0.2)
    show("leader prints the exit status of the command", rc)
    show("members after SIGTERM (only the leader?)", members(p.pid))
    show("the leader still runs; state", f"{stat(p.pid) is not None}; {stat(p.pid)['state']}")
    p.stdin.write("done\n"); p.stdin.flush()
    show("after 'done': leader exit code", str(p.wait(timeout=5)))
    show("kill(-pgid, 0) after the reap", (lambda: (os.killpg(p.pid, 0), "0")[1])() if members(p.pid) else "no member (ESRCH)")

    print("== 2. EOF before go: exit 99, the command never runs")
    os.unlink(flag)
    p2 = subprocess.Popen(LEADER + cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, start_new_session=True)
    track(p2.pid, "leader 2")
    p2.stdin.close()
    show("exit code; the command ran", f"{p2.wait(timeout=5)}; {os.path.exists(flag)}")

    print("== 3. EOF after the command (the supervisor died): the leader exits, a grandchild remains")
    os.unlink(f"{S}/tmp/s2-grandchild")
    cmd3 = ["/bin/sh", "-c", f"/bin/sleep 30 >/dev/null 2>&1 & echo $! > {S}/tmp/s2-grandchild"]
    p3 = subprocess.Popen(LEADER + cmd3, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, start_new_session=True)
    track(p3.pid, "leader 3")
    p3.stdin.write("go\n"); p3.stdin.flush()
    show("leader prints", p3.stdout.readline().strip())
    g3 = int(open(f"{S}/tmp/s2-grandchild").read())
    track(g3, "grandchild 3")
    p3.stdin.close()
    show("leader exit code after EOF", str(p3.wait(timeout=5)))
    show("members of the group now (the journal keeps the ID busy)", members(p3.pid))
finally:
    for pid, (what, start) in started.items():
        st = stat(pid)
        if st and start is not None and st["start"] == start and st["state"] != "Z":
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    time.sleep(0.2)
    while True:
        try:
            if os.waitpid(-1, os.WNOHANG)[0] == 0:
                break
        except ChildProcessError:
            break
    left = [p for p, (w, start) in started.items() if start is not None and (stat(p) or {}).get("start") == start and (stat(p) or {}).get("state") != "Z"]
    print(f"  started PIDs: {len(started)}; still running: {left}")
```

### h5_herdr_stop_outcomes.py

```python
#!/usr/bin/env python3
# h5 (review r3 M-4, design r4 section 7): Herdr 0.8.0 answers for the stop protocol of the optional RH,
# on ISOLATED scratch servers only (a byte copy of the binary, HOME and every XDG directory under
# /tmp/aosd4, sockets under /tmp/aosd4 only, the whole server run under strace -ff).
# Run: env -i HOME=/tmp/aosd4/home PATH=/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp/aosd4/tmp \
#        /usr/bin/python3 -I /tmp/aosd4/scripts/h5_herdr_stop_outcomes.py
#  1. which answer does each failure give: pane.get of a pane that never existed, a malformed ID, no
#     params, an unknown method, a line that is not JSON; connect to a path without a listener, to a
#     missing path. Only an explicit pane_not_found may count as negative evidence.
#  2. the stop protocol of design r4 7.2: the creation server incarnation (PID, start ticks, boot ID) is
#     recorded at create from the peer of the create connection; every connection of the stop checks
#     its peer; a negative answer counts only from the recorded incarnation, or when it has ended.
#     a. the own pane: destroyed; again: absent.
#     b. a restart with the saved session: the recorded server ended; the restored pane: other-launch.
#     c. a hidden recorded server: server B takes the socket path of server A while A runs: unknown.
#  3. the version and protocol of the ping answer (the RH allow list).
import glob, json, os, re, signal, socket, struct, subprocess, sys, time

S = "/tmp/aosd4"
BIN = f"{S}/herdrbin/herdr"  # a byte copy of ~/.local/bin/herdr (0.8.0), checked with cmp
LOG = f"{S}/logs"
REAL = "/home/taisung/.config/herdr"  # read with ls only, before and after
SYSTEM = re.compile(r"^/(tmp|tmp/aosd4|tmp/aosd4/.*|proc/.*|sys/.*|dev/.*|etc/.*|usr/.*|lib.*|bin/.*)$")
assert not any(k.startswith("AO_") for k in os.environ) and "TMUX" not in os.environ, "not the scratch env"
started = []


def env_of(home):
    return {"HOME": home, "XDG_CONFIG_HOME": f"{home}/.config", "XDG_DATA_HOME": f"{home}/.local/share",
            "XDG_STATE_HOME": f"{home}/.local/state", "XDG_CACHE_HOME": f"{home}/.cache",
            "XDG_RUNTIME_DIR": f"{home}/run", "PATH": "/usr/bin:/bin", "LANG": "C.UTF-8",
            "TERM": "xterm-256color", "SHELL": "/bin/sh"}


def sock_of(home):
    return f"{home}/.config/herdr/herdr.sock"


def show(label, value):
    print(f"  {label:<64} {value}", flush=True)


def logpid(what, pid):
    with open(f"{LOG}/pids.txt", "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} h5 {what} pid={pid}\n")


def incarnation(pid):
    try:
        ticks = open(f"/proc/{pid}/stat").read().rsplit(") ", 1)[1].split()[19]
    except (OSError, TypeError):
        return None
    return (pid, ticks, open("/proc/sys/kernel/random/boot_id").read().strip())


def start_server(label, home):
    os.makedirs(f"{home}/run", mode=0o700, exist_ok=True)
    # The update checks off before any server start (as h1 of design r3): without this file the
    # server's version and manifest checks connect to the network (the first h5 run, design r4 12).
    os.makedirs(f"{home}/.config/herdr", exist_ok=True)
    with open(f"{home}/.config/herdr/config.toml", "w") as f:
        f.write("[update]\nversion_check = false\nmanifest_check = false\n")
    for f in glob.glob(f"{LOG}/h5-strace-{label}.*"):
        os.unlink(f)
    if os.path.exists(sock_of(home)):
        os.unlink(sock_of(home))  # our own stale socket of an earlier scratch run
    tracer = subprocess.Popen(["/usr/bin/strace", "-ff", "-qq", "-e", "trace=%file,connect,bind", "-o",
                               f"{LOG}/h5-strace-{label}", BIN, "server"], env=env_of(home), cwd=home,
                              stdin=subprocess.DEVNULL, stdout=open(f"{LOG}/h5-server-{label}.log", "w"),
                              stderr=subprocess.STDOUT, start_new_session=True)
    logpid(f"strace of herdr server ({label})", tracer.pid)
    for _ in range(100):
        if os.path.exists(sock_of(home)):
            break
        time.sleep(0.05)
    time.sleep(0.2)
    kids = subprocess.run(["ps", "-o", "pid=", "--ppid", str(tracer.pid)], capture_output=True, text=True).stdout.split()
    spid = int(kids[0])
    logpid(f"herdr server ({label})", spid)
    started.append((tracer, spid))
    trace = "".join(open(f).read() for f in glob.glob(f"{LOG}/h5-strace-{label}.[0-9]*"))
    paths = sorted(set(re.findall(r'"(/[^"]*)"', trace)))
    outside = [p for p in paths if not SYSTEM.match(p)]
    bad = [p for p in outside if any("ENOENT" not in line for line in trace.splitlines() if f'"{p}"' in line)]
    inet = len(re.findall(r"connect\(\d+, \{sa_family=AF_INET", trace))
    ss = subprocess.run(["ss", "-xlpn"], capture_output=True, text=True).stdout
    socks = sorted({l.split()[4] for l in ss.splitlines() if f"pid={spid}," in l})
    show(f"server {label}: pid, sockets", f"{spid}, {socks}")
    show(f"server {label}: outside paths (ENOENT only), bad, inet", f"{outside}, {bad}, {inet}")
    if bad or inet or sock_of(home) not in socks or any(not x.startswith(f"{S}/") for x in socks):
        print("ISOLATION NOT SHOWN: abort")
        stop_all()
        sys.exit(1)
    return spid


def stop_all():
    for tracer, spid in started:
        for p in (spid, tracer.pid):
            if os.path.exists(f"/proc/{p}"):
                try:
                    os.kill(p, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for p in (spid, tracer.pid):
            for _ in range(40):
                if not os.path.exists(f"/proc/{p}"):
                    break
                time.sleep(0.05)
            if os.path.exists(f"/proc/{p}"):
                os.kill(p, signal.SIGKILL)
        try:
            tracer.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    time.sleep(0.2)


class Conn:
    def __init__(self, path):
        self.s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.s.settimeout(5)
        self.s.connect(path)
        pid, _uid, _gid = struct.unpack("3i", self.s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        self.peer = incarnation(pid)
        self.buf = b""

    def raw(self, data):
        try:
            self.s.sendall(data)
            while b"\n" not in self.buf:
                chunk = self.s.recv(65536)
                if not chunk:
                    return {"transport": "EOF"}
                self.buf += chunk
        except OSError as e:
            return {"transport": type(e).__name__}
        line = self.buf.split(b"\n", 1)[0]
        try:
            return json.loads(line)
        except ValueError:
            return {"unparsed": line[:120].decode(errors="replace")}

    def call(self, method, params=None):
        return self.raw(json.dumps({"id": "aosd4:h5", "method": method, "params": params or {}}).encode() + b"\n")


def short(a):
    if "error" in a:
        e = a["error"]
        return f"error code={e.get('code')!r} message={str(e.get('message'))[:70]!r}"
    if "transport" in a or "unparsed" in a:
        return json.dumps(a)
    r = a.get("result", {})
    if r.get("type") == "pane_info":
        p = r["pane"]
        return f"pane {p['pane_id']} terminal {p['terminal_id']}"
    return json.dumps(r)[:120]


def connect(path):
    try:
        return Conn(path), None
    except OSError as e:
        return None, type(e).__name__


def stop(path, rec):
    """The stop of design r4 7.2. rec: pane_id, terminal_id, server (the creation incarnation)."""
    def recorded_gone():
        now = incarnation(rec["server"][0])
        return now is None or now != rec["server"]
    c1, err = connect(path)
    if c1 is None:
        return f"connect {err}: " + ("absent (the recorded server ended)" if recorded_gone() else "unknown")
    g = c1.call("pane.get", {"pane_id": rec["pane_id"]})
    same = c1.peer == rec["server"]
    if not same:
        if not recorded_gone():
            return f"peer {c1.peer[0]} is not the recorded server {rec['server'][0]}, which runs: unknown, no close ({short(g)})"
        if "error" in g and g["error"].get("code") == "pane_not_found":
            return f"recorded server ended; another server: pane_not_found: absent"
        if g.get("result", {}).get("type") == "pane_info":
            return f"recorded server ended; another server has {short(g)}: other-launch, no close"
        return f"recorded server ended; another server answered {short(g)}: absent (the launch ended with its server)"
    if "error" in g:
        code = g["error"].get("code")
        return "pane_not_found from the recorded server: absent" if code == "pane_not_found" else f"{short(g)}: unknown"
    if g.get("result", {}).get("type") != "pane_info":
        return f"{short(g)}: unknown"
    if g["result"]["pane"]["terminal_id"] != rec["terminal_id"]:
        return f"{short(g)} on the recorded server: other-launch, no close"
    c2, err = connect(path)
    if c2 is None or c2.peer != rec["server"]:
        return f"close connection peer {c2 and c2.peer[0]} {err or ''}: unknown, no close sent"
    r = c2.call("pane.close", {"pane_id": rec["pane_id"]})
    c3, err = connect(path)
    after = c3.call("pane.get", {"pane_id": rec["pane_id"]}) if c3 else {"transport": err}
    if c3 is not None and c3.peer == rec["server"] and after.get("error", {}).get("code") == "pane_not_found":
        return f"close {short(r)}; check on the recorded server: pane_not_found: destroyed"
    return f"close {short(r)}; check peer {c3 and c3.peer[0]}: {short(after)}: unknown"


def ls_real():
    return subprocess.run(["ls", "-la", "--time-style=full-iso", REAL], capture_output=True, text=True).stdout


real_before = ls_real()
HA, HB = f"{S}/herdrhome", f"{S}/herdrhome2"
for h in (HA, HB):
    if os.path.exists(f"{h}/.config/herdr/session.json"):
        os.unlink(f"{h}/.config/herdr/session.json")  # our own saved session of an earlier scratch run
    os.makedirs(f"{h}/ws", exist_ok=True)
try:
    print("== 1. the answers of each failure (server A)")
    a = start_server("A", HA)
    SA = sock_of(HA)
    c = Conn(SA)
    ws = c.call("workspace.create", {"cwd": f"{HA}/ws", "label": "h5a", "focus": False})
    show("workspace.create on one connection", short(ws) if "error" in ws else f"peer {c.peer[0]}: {json.dumps(ws['result'])[:150]}")
    if "error" in ws or "transport" in ws:
        raise SystemExit("no workspace.create on the socket API")
    root = ws["result"]["root_pane"] if "root_pane" in ws["result"] else ws["result"]["workspace"]["root_pane"]
    rec = {"pane_id": root["pane_id"], "terminal_id": root["terminal_id"], "server": c.peer}
    show("the record: pane, terminal, creation server (pid, ticks)", f"{rec['pane_id']} {rec['terminal_id']} {rec['server'][:2]}")
    for label, data in [
        ("pane.get of the own pane", {"method": "pane.get", "params": {"pane_id": rec["pane_id"]}}),
        ("pane.get of w9:p9 (never existed)", {"method": "pane.get", "params": {"pane_id": "w9:p9"}}),
        ("pane.get of 'not a pane' (malformed)", {"method": "pane.get", "params": {"pane_id": "not a pane"}}),
        ("pane.get with no params", {"method": "pane.get", "params": {}}),
        ("pane.get with pane_id 7 (a number)", {"method": "pane.get", "params": {"pane_id": 7}}),
        ("an unknown method pane.nosuch", {"method": "pane.nosuch", "params": {}}),
        ("workspace.get of w9 (never existed)", {"method": "workspace.get", "params": {"workspace_id": "w9"}}),
    ]:
        show(label, short(Conn(SA).raw(json.dumps({"id": "aosd4:h5", **data}).encode() + b"\n")))
    show("a line that is not JSON", short(Conn(SA).raw(b"this is not json\n")))
    stale = f"{S}/tmp/h5-stale.sock"
    if os.path.exists(stale):
        os.unlink(stale)
    t = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); t.bind(stale); t.close()
    show("connect to a socket file without a listener", connect(stale)[1])
    os.unlink(stale)
    show("connect to a missing path", connect(f"{S}/tmp/h5-missing.sock")[1])

    print("== 2a. the stop protocol: the own pane, then again")
    sib = Conn(SA).call("pane.split", {"pane_id": rec["pane_id"], "direction": "right", "focus": False})
    show("pane.split (a second pane, so the workspace stays)", short(sib) if "error" in sib else json.dumps(sib["result"])[:120])
    show("stop of the record", stop(SA, rec))
    show("stop of the record again", stop(SA, rec))
    keep = sib["result"]["pane"]
    rec2 = {"pane_id": keep["pane_id"], "terminal_id": keep["terminal_id"], "server": rec["server"]}
    show("stop of a record of the second pane with a wrong terminal", stop(SA, {**rec2, "terminal_id": "term_0000000000000"}))

    print("== 2b. a restart with the saved session between the create and the stop")
    out = subprocess.run([BIN, "server", "stop"], env=env_of(HA), capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL)
    show("server stop (CLI, server A's own environment)", f"exit {out.returncode} {out.stdout.strip()[:60]!r}")
    for _ in range(60):
        if not os.path.exists(f"/proc/{a}"):
            break
        time.sleep(0.05)
    show(f"server A {a} still runs", str(os.path.exists(f"/proc/{a}")))
    a2 = start_server("A2", HA)
    show("get of the second pane on the restarted server", short(Conn(SA).call("pane.get", {"pane_id": rec2["pane_id"]})))
    show("stop of the record of the second pane (created on A)", stop(SA, rec2))

    print("== 2c. a hidden recorded server: server B takes the socket path while A2 runs")
    c = Conn(SA)
    ws3 = c.call("workspace.create", {"cwd": f"{HA}/ws", "label": "h5c", "focus": False})
    root3 = ws3["result"]["root_pane"] if "root_pane" in ws3["result"] else ws3["result"]["workspace"]["root_pane"]
    rec3 = {"pane_id": root3["pane_id"], "terminal_id": root3["terminal_id"], "server": c.peer}
    show("a record on A2", f"{rec3['pane_id']} {rec3['terminal_id']} {rec3['server'][:2]}")
    b = start_server("B", HB)
    SB = sock_of(HB)
    wsb = Conn(SB).call("workspace.create", {"cwd": f"{HB}/ws", "label": "h5b", "focus": False})
    show("server B: workspace.create", json.dumps(wsb.get("result", wsb))[:120])
    os.rename(SA, SA + ".hidden")  # both are sockets that this script's servers made
    os.rename(SB, SA)
    show("the path of A now reaches", f"pid {Conn(SA).peer[0]} (B is {b}, A2 is {a2})")
    show("stop of the A2 record through the path", stop(SA, rec3))
    show("pane.get of the record's pane on B (what a check without the peer rule sees)", short(Conn(SA).call("pane.get", {"pane_id": rec3["pane_id"]})))
    os.rename(SA, SB)
    os.rename(SA + ".hidden", SA)
    show("paths back; stop of the A2 record", stop(SA, rec3))

    print("== 3. the version in the ping answer")
    show("ping", short(Conn(SA).call("ping")))
finally:
    stop_all()
    left = [x for t, s in started for x in (s, t.pid) if os.path.exists(f"/proc/{x}")]
    show("started PIDs still present", str(left))
    for h in (HA, HB):
        for f in (sock_of(h), sock_of(h) + ".hidden"):
            if os.path.exists(f):
                os.unlink(f)  # sockets of the servers that this script started
    show("real ~/.config/herdr (named path, ls)", "unchanged" if ls_real() == real_before else "CHANGED")
    traces = glob.glob(f"{LOG}/h5-strace-*.[0-9]*")
    home = sorted(set(m for f in traces for m in re.findall(r'"(/home/[^"]*)"', open(f).read())))
    inet = sum(len(re.findall(r"connect\(\d+, \{sa_family=AF_INET", open(f).read())) for f in traces)
    show("whole-run traces: paths under /home; AF_INET connects", f"{home}; {inet}")
```

### redcount.sh

```bash
#!/usr/bin/env bash
# redcount.sh: for each same-id defect file, run it in red mode with the JSON reporter and count
# failed and passed tests per round tag ([same-id R1] .. [same-id R4], or "untagged"), and per design
# round when the tag is followed by one in parentheses ("[same-id R3] (RW)").
W=/home/taisung/.worktrees/agent-orchestrator/ao-52
OUT=${1:-/tmp/aosd4/logs/redcount.out}
: > "$OUT"
for f in $(cd $W && grep -rl 'SAME_ID_DEFECTS' packages --include=*.ts | grep -v node_modules | sort); do
  pkg=$(echo "$f" | sed -E 's#^(packages/(plugins/)?[^/]+)/.*#\1#')
  rel=${f#$pkg/}
  json=/tmp/aosd4/tmp/red-$(echo "$f" | tr '/' '_').json
  SAME_ID_DEFECTS=red /tmp/aosd4/scripts/vt.sh "$W/$pkg" "$rel" --reporter=json --outputFile="$json" >/dev/null 2>&1
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
```

### vt.sh

```bash
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/aosd4
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/pnpmbin:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
```

### bintest/tmux (the vitest shim)

```sh
#!/bin/sh
exec /usr/bin/tmux -L aosd4-T "$@"
```
