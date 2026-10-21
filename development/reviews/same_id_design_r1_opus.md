# Launches that share a tmux name, a tmux server and a worktree path: design r1 (ao-48, Opus 5.5)

- Date: 2026-10-21. Base: `ce49c9fd` (tip of the killed-status fix, ao-46 branch `0e3eabc2..ce49c9fd`;
  the orchestrator says that it has the same source as the new `main`). Worktree:
  `/home/taisung/.worktrees/agent-orchestrator/ao-48`, branch
  `feat/same-id-design-read-agent-task-md-in-your-worktree-and-execu`.
- Commit: `c516cead` (ten new test files only; this file is not committed). Range `ce49c9fd..c516cead`.
- Scope: design and investigation only. No source file changed. No `ao` command against the real config
  or the real state root. Every live run used the worktree build, a scratch config, the scratch state
  root `/tmp/ao48sd/state`, a fake `HOME` and private tmux servers (`-L ao48sd-P|Q|A|B|T`). One
  read-only `tmux ls` reached the default server by mistake (section 11).
- Host: Ubuntu 24.04.5, tmux 3.4 (`/usr/bin/tmux` only), Node 20+, Linux `/proc`.

## 0. Short answers

| Question | Answer |
| --- | --- |
| Q1 | 47 tmux call sites with a target or a server choice in production code (table in section 2). Every target is a plain name today, except `session-manager.ts:1033` (`=${handle.id}`). Session targets need `=name`. Window and pane targets need `=name:` (with the colon): without it tmux first tries a **window** name in the current session, and `list-panes -t =kr-1` matched the window `other:kr-1` (measured). `display-message` gives empty values and exit 0 for an unknown target (CANFAIL), so its two callers must read empty output as "gone". `=` (exact) exists since tmux 2.1 (2015); the host has only 3.4. tmux changes `.` and `:` in a new name to `_`, and `=a.b` splits at the dot ("can't find pane: b"), but AO names are limited to `[a-zA-Z0-9_-]`, so no AO target has a dot or a colon. The helper must refuse any other name. |
| Q2 | Recommended: all three, combined. At create, runtime-tmux reads back `#{socket_path} #{pid} #{start_time} #{session_id} #{session_created}` through the same client environment as `new-session`, and stores them in `handle.data`. Every later call passes `-S <socket>`. Destructive steps run as one server step: `if-shell -F -t =name: '#{==:#{session_created}/#{start_time},C/T}' 'kill-session -t =name'` (measured: a wrong value keeps the session, a missing target takes the else branch). A missing socket with a running recorded server PID (same start time) is a hidden socket: "unknown", never dead. A dead PID or another start time is authoritative "dead". Node must never compute the socket path: `-S` wins over `-L` (measured both orders), so a computed default path would bypass the scratch shims and reach the host's default server. Old records (no socket) keep the caller's server; a negative answer from a server that is not the uid's default socket counts as "unknown" (C-04: no change to the persisted handle). Per-command behavior for an unreachable server: table in section 3.5. |
| Q3 | Recommended (d): R2's identity check for tmux plus R3's per-ID operation lease plus three plugin-level fixes (F-1 one `git worktree add`, F-2 an ownership check before `postCreate`, F-3 a claim before the read) plus an `ao status` list of unowned runtimes (F-6) and the PID check (F-7). The lease closes F-5 among new-build actors for names and paths. The in-server guard closes the tmux part of F-5 against every actor, also old builds. The identity check alone (c) only moves the path part (git has no compare-and-act). An incarnation suffix (b) moves the conflict to the shared branch and breaks agent continuity. F-3: a claim before the read, with the existing `opencodeSessionId` key (old builds read it too); a per-ID lease does not help because the rollback and the reusing spawn have different IDs. Comparison table in section 4.2. |
| Q4 | None of the four D-D items goes away with the design. Each needs its own small change (R4): the session numbers read `listArchivedSessionIds` (`session-manager.ts:637`, `existsSync`), `hasOtherOpenCodeRecord` (`:971-985`) reads the same listing, the recovery validator uses `existsSync` (`recovery/validator.ts:81`) and the worktree plugin's `exists` (`workspace-worktree/src/index.ts:264-275`) also answers false on errors, and codex, gemini, opencode and runtime-herdr answer false when the check cannot run. R2 removes only the wrong-server part of the agents' false answers. |
| Q5 | R1 and R4 change no format. R2 adds five fields to `handle.data` at create; old readers ignore them; no backfill (it would change `runtimeHandle` and so the launch identity). R3 adds a new lock kind that old builds do not take, so every per-step check stays. No migration. After each round: rebuild the primary checkout, then restart every resident `ao` process (lifecycle workers 1470866 and 1471311 today), because each protection works only between processes that run the new build. |
| Q6 | Four rounds: **R1** exact targets (17 tests flip; low risk; S), **R2** server and launch identity (8 tests flip; HIGH risk; M-L; a prototype for runtime-tmux turns its 10 tests green), **R4** fail-open reads (11 tests flip; medium; S), **R3** one operation per ID (6 tests flip; HIGH risk; L). Recommended order R1, R2, R4, R3. Files and tests per round in section 7. |

## 1. Measured defects

### 1.1 D-A: a plain tmux target matches a longer name by prefix (raw tmux)

`repro_da.sh` (section 13) on the private server `ao48sd-P`, with only `kr-10` alive (a dead `kr-1`
has one live name that starts with it):

- `has-session -t kr-1` exits 0. `=kr-1` and `=kr-1:` give `can't find session: kr-1`.
- `display-message -p -t kr-1` prints `kr-10`. `=kr-1` and `=kr-1:` print an empty line, exit 0
  (`display-message` is CANFAIL: an unknown target gives empty format values, not an error).
- `list-panes`, `capture-pane`, `send-keys` and `paste-buffer` with the plain target all act on
  `kr-10` (the text sent to `kr-1` appears twice on the `kr-10` screen). With `=kr-1:` each one fails
  with `can't find session: kr-1`.
- `attach -t kr-1` resolves `kr-10` (`open terminal failed: not a terminal`); `=kr-1` gives
  `can't find session`.
- `kill-session -t kr-1` ends `kr-10`. `kill-session -t =kr-1` keeps it.
- With `kr-10` and `kr-11` alive, the plain target is ambiguous and fails (`can't find session: kr-1`).
  So the hazard is "exactly one longer live name", which is the normal case for `kr-1` .. `kr-9`
  while `kr-10` .. `kr-19` run.

`repro_formats.sh` section 1 (the current session `other` has a window named `kr-1`; no session
`kr-1`): `list-panes -t kr-1` and `list-panes -t =kr-1` both resolve `other:kr-1` (window targets
try a window name first, and `=` without a colon is applied to the window name). `list-panes -t
=kr-1:` fails. `send-keys -t =kr-1` gave `can't find pane: =kr-1`, and `send-keys -t =kr-1:` gave
`can't find session: kr-1`. So the safe form for every window and pane target is `=name:`.

Names: `new-session -s a.b` makes `a_b`, `-s c:d` makes `c_d`. `has-session -t =a.b` gives
`can't find pane: b`. A hash name such as `0123456789ab-kr-1` works with `=` and `=name:`.

### 1.2 D-A through `ao` (worktree build)

`repro_da_ao.sh`: record `kr-1` (tmux `838af4b8a754-kr-1`) is dead, and a plain shell session
`838af4b8a754-kr-10` lives on the same private server.

- `ao status` showed `kr-1 ... exited 1s ago`: the "1s ago" is the bystander's activity
  (`cli/src/lib/shell.ts:57`).
- `ao send --no-wait kr-1 "echo DA-PROBE-TEXT"` printed `Message sent and processing`, exit 0. The
  bystander screen then had two lines with the text (`cli/src/commands/send.ts:261` `has-session`
  succeeded by prefix; the keys went to `kr-10`).
- `ao session kill kr-1` printed `Session kr-1 killed.` and the bystander session ended (panes on A
  empty after the kill; `runtime-tmux/src/index.ts:170`).

### 1.3 D-B: `ao` with its tmux calls on another server (worktree build)

`repro_db.sh`: two live sessions `kr-1`, `kr-2` (and, in case 3, `kr-orchestrator`) on server A; each
command then runs with the tmux shim of server B. The scratch lifecycle worker was stopped before each
command (exact PID from its pid file).

- Case 1, B does not run: `ao status` changed nothing; `ao session cleanup` printed
  `No sessions to clean up.`; `ao send --no-wait kr-1` exited 1 with `Cannot send to session kr-1:
  session needed to be restarted before delivery (Session kr-1 cannot be restored: session is not in a
  terminal state)`. This is safe on `ce49c9fd`: the killed-status fix reads "no server" as unknown.
- Case 2, B runs one unrelated session: `ao session cleanup` printed `Cleaned: kr-1`, `Cleaned: kr-2`,
  `Cleanup complete. 2 sessions cleaned.` Both records went to the archive with `status=working`, the
  git worktree list had only `main`, and both panes on A still ran (agents without a worktree).
- Case 3, B runs one unrelated session: `ao send --no-wait kr-1` printed `Message sent and
  processing`; `kr-1` became `status=spawning` with a second pane `838af4b8a754-kr-1` on B while the
  pane on A still ran. `ao start kr` archived the live `kr-orchestrator`
  (`kr-orchestrator_2026-10-21T14-27-02-504Z`) and made a second orchestrator on B.

From code, not measured: `ao start` while the caller's server does not run also replaces the
orchestrator, because `isOrchestratorRuntimeAlive` maps "no server" to dead
(`session-manager.ts:539-555`, `:548`).

### 1.4 Server selection, identity read-back, guarded kill, hidden socket

`repro_formats.sh` sections 2 to 5 (private servers P with `alpha`, Q with `beta`):

- `-L P -S Q` and `-S Q -L P` both answer from Q: `-S` wins over `-L` in both orders.
- `TMUX=<Q>` with `-L P` answers from P: `-L` wins over `TMUX`.
- `TMUX=<Q>` with `TMUX_TMPDIR=/nowhere` answers from Q: `TMUX` wins over `TMUX_TMPDIR`.
- `TMUX_TMPDIR=<missing dir>` with `-L P` answers from P: tmux skips a `TMUX_TMPDIR` that does not
  exist and falls back to `/tmp/tmux-<uid>/`. Without `-L` that fallback is the host's default
  server (section 11). With an existing directory: `error connecting to
  /tmp/ao48sd/tt/tmux-44402/ao48sd-P (No such file or directory)`.
- A client that found the server through `-L` reads back `1757234 1792594523 $0 1792594523
  /tmp/tmux-44402/ao48sd-P` (pid, start_time, session_id, session_created, socket_path).
  `/proc/<pid>/stat` gives `btime + starttime/100 = 1792594522` (one second of rounding). The comm
  field is `(tmux: server)` with a space, so the fields must be split after the last `)`.
- `tmux -S <socket> display-message -t '$0'` reaches the session by its ID.
- Guarded kill (`if-shell -F`): a wrong `created/start` pair prints `ao-kept` and keeps the session; a
  missing target prints `ao-kept` (else branch, exit 0); the right pair ends the session. Not
  measured under contention. A format in the inner command is expanded first, and the `$0` of
  `#{session_id}` then gives `syntax error`, so the inner command must be fixed text
  (`kill-session -t =name`).
- Hidden socket: after `rm` of Q's socket, `ls` gives `error connecting to /tmp/tmux-44402/ao48sd-Q
  (No such file or directory)` (runtime-tmux maps this to `ERR_RUNTIME_NO_SERVER`,
  `runtime-tmux/src/index.ts:55-56`), the server PID still runs, and after `kill -USR1 <pid>` the
  server makes its socket again and answers (`beta`).

### 1.5 D-C and D-D: measured with the new tests

The D-C items F-1, F-2, F-3, F-5 and the D-D items were measured with mocked runtime, agent and git
(no live process). Each test and its failure on `ce49c9fd` is in section 8. F-6 has no test (section
10, item 4). F-7 is the runtime-tmux R2 test.

## 2. Q1: the tmux call sites and the exact form each needs

Target kinds: **S** session target (`has-session`, `kill-session`, `attach`), **W** window target
(`list-panes`), **P** pane target (`send-keys`, `paste-buffer`, `capture-pane`, `display-message`),
**-** no target (the server choice only). "Server" means: the call must pass `-S <recorded socket>`
after R2.

| File:line | Command | Kind | Needed form | Note |
| --- | --- | --- | --- | --- |
| `plugins/runtime-tmux/src/index.ts:130` | `new-session -s name` | - | caller's server; then read back the identity | defines the recorded server |
| `runtime-tmux/src/index.ts:140`, `:142`, `:144` | `send-keys` (launch) | P | `=name:` + server | measured: the launch keys reach `kr-10` when the new session ended first |
| `runtime-tmux/src/index.ts:148` | `kill-session` (create cleanup) | S | `=name` + server, guarded by the read-back `session_created` | |
| `runtime-tmux/src/index.ts:170` | `kill-session` (destroy) | S | guarded `if-shell -F -t =name: ... 'kill-session -t =name'` + server | D-A, D-B, F-5 |
| `runtime-tmux/src/index.ts:178`, `:206`, `:212` | `send-keys` | P | `=name:` + server | |
| `runtime-tmux/src/index.ts:187`, `:188`, `:198` | `load-buffer`, `paste-buffer`, `delete-buffer` | -, P, - | server; `paste-buffer -t =name:` | buffers live on the server |
| `runtime-tmux/src/index.ts:217` | `capture-pane` | P | `=name:` + server | |
| `runtime-tmux/src/index.ts:225` | `has-session` (isAlive) | S | identity read with `display-message -t =name:` + server (empty = gone) | |
| `runtime-tmux/src/index.ts:241` | `list-sessions` (getMetrics) | - | server | already compares the name exactly |
| `runtime-tmux/src/index.ts:260` | `tmux attach -t id` (string) | S | `tmux -S <socket> attach -t =name` | |
| `core/src/session-manager.ts:522` | `display-message #{pane_current_command}` | P | `=name:` + server; empty output = gone | CANFAIL; used by `waitForInteractiveReadiness` `:3466` and `waitForRestoredSession` `:3513` |
| `core/src/session-manager.ts:1033` | `has-session -t =id` (OpenCode holder) | S | add server | already exact |
| `core/src/tmux.ts:71` | `has-session` | S | `=name` | exported (`index.ts:40-50`); no production caller found |
| `core/src/tmux.ts:131`, `:159`, `:169` | `send-keys` | P | `=name:` | exported |
| `core/src/tmux.ts:147`, `:148` | `load-buffer`, `paste-buffer` | -, P | server; `=name:` | exported |
| `core/src/tmux.ts:180` | `capture-pane` | P | `=name:` | exported |
| `core/src/tmux.ts:185` | `kill-session` | S | `=name` | exported |
| `core/src/tmux.ts:194` | `list-panes` | W | `=name:` | exported |
| `core/src/tmux.ts:26`, `:44`, `:94` | `list-sessions`, `new-session` | - | (server, when a handle is known) | |
| `plugins/agent-claude-code/src/index.ts:589` | `list-panes #{pane_tty}` | W | `=name:` + server | |
| `plugins/agent-codex/src/index.ts:553` | `list-panes` | W | `=name:` + server | |
| `plugins/agent-gemini/src/index.ts:184` | `list-panes` | W | `=name:` + server | |
| `plugins/agent-opencode/src/index.ts:662`, `:1290` | `list-panes` | W | `=name:` + server | `:662` maps "no server running" to `PaneGoneError` (`:670`) |
| `cli/src/lib/shell.ts:57` | `display-message #{session_activity}` | P | `=name:` + server; empty = `null` | CANFAIL; callers `status.ts:96`, `session.ts:95`, `status.ts:476` |
| `cli/src/lib/shell.ts:51` | `list-sessions` | - | caller's server | only the no-config fallback (`status.ts:456`) |
| `cli/src/commands/send.ts:108`, `:125`, `:129` | `send-keys` | P | `=name:` + server | raw tmux path of `ao send` |
| `cli/src/commands/send.ts:115`, `:116` | `load-buffer`, `paste-buffer` | -, P | server; `=name:` | |
| `cli/src/commands/send.ts:261` | `has-session` (`execSilent`: null on any error) | S | `=name` + server | measured D-A path |
| `cli/src/commands/send.ts:272` | `capture-pane` | P | `=name:` + server | |
| `cli/src/commands/send.ts:344`, `:349` | `send-keys Enter` | P | `=name:` + server | |
| `cli/src/commands/session.ts:191` | `attach -t target` | S | use the runtime's attach info (`=name` and `-S`) | today it takes only `target` |
| `integration-tests/src/helpers/tmux.ts:35`, `:73`, `:85` | `kill-session`, `capture-pane` | S, P | `=name`, `=name:` | test helpers; change for consistency |

Count: runtime-tmux 16 call lines, core 14, agents 5, CLI 12 (47), plus 3 test-helper lines.

Is `=name` safe on every host tmux version? The host has only tmux 3.4. tmux CHANGES: "If a
session/window target is prefixed with '=' then only an exact match is considered." (CHANGES FROM 2.0
TO 2.1, 18 October 2015), and "'if-shell' command now understands formats via -F" (CHANGES FROM 1.9a
TO 2.0). I did not find the version of the `#{==:a,b}` comparison in the part of CHANGES that I read;
it works on 3.4 (measured). The package declares no minimum tmux version.

Dots and colons: tmux changes them in a new session name to `_` (measured), and `=a.b` splits at the
dot. AO names cannot have them: runtime-tmux refuses a session ID outside `/^[a-zA-Z0-9_-]+$/`
(`SAFE_SESSION_ID`), and `tmuxName` is `<12 hex>-<prefix>-<num>` (`core/src/paths.ts:181`) with a
prefix in `[a-zA-Z0-9_-]`. The new core helpers (`exactSessionTarget(name)`, `exactPaneTarget(name)`)
must throw for any other name, so that a later change cannot build an unsafe target.

## 3. Q2: server identity

### 3.1 Options

1. **Record the socket and pass `-S`.** Every later call reaches the server that made the session,
   whatever the caller's environment is. Closes D-B for new records.
2. **Refuse destructive steps on a server mismatch.** Compare the recorded server with the server that
   answers; refuse `kill`, `cleanup`, `restore` and `start` replacement on a mismatch. Alone, this
   needs a reachable comparison and still leaves reads on the wrong server.
3. **Server PID and start time.** Tells "the server is gone" (authoritative dead) from "the socket
   is hidden" (unknown), and a restarted server at the same path (another start time) from the
   recorded one. Needed for F-7.

Recommended: 1 + 3, with 2 as the rule for old records (section 3.4).

### 3.2 The read-back at create

Directly after `new-session`, with the same client environment (the same `PATH`, so the same
shim), runtime-tmux runs:

```
display-message -p -t =<name>: '#{pid} #{start_time} #{session_id} #{session_created} #{socket_path}'
```

and stores in `handle.data`: `tmuxSocket`, `tmuxServerPid`, `tmuxServerStartTime`, `tmuxSessionId`,
`tmuxSessionCreated` (proposed names; the R2 tests use them). An empty line means that the session
ended before the read-back: create fails and sends no launch keys.

Do not compute the socket path in Node. `-S` wins over `-L` (measured), so a computed
`${TMUX_TMPDIR:-/tmp}/tmux-<uid>/default` passed as `-S` would bypass every scratch shim that adds `-L`
and reach the host's default server. The read-back gives the path of the server that the shim chose.

### 3.3 Later calls

- Every call: `tmux -S <tmuxSocket> <command> -t =<name>[:]`. Do not store or reuse `$N` as a target:
  a session ID is unique only for one server lifetime.
- `isAlive`: `display-message -p -t =<name>: '#{session_created} #{start_time}'`.
  - The recorded pair: alive.
  - Empty output (no such session on a server that answers): dead.
  - Another pair: dead for this launch (another launch of the name, or a restarted server at the
    path).
  - `no server running` / `error connecting ... (No such file or directory)` / `Connection
    refused`: read `/proc/<tmuxServerPid>/stat` (split after the last `)`, field 22, `btime +
    starttime/CLK_TCK`, 2 s tolerance).
    - The PID runs with the recorded start time: hidden socket. Reject with `ERR_RUNTIME_PROBE` and
      the hint `kill -USR1 <pid>`. Never "no server".
    - The PID is gone or has another start time: dead (`false`). The recorded server is gone, so its
      sessions are gone.
    - `/proc` cannot be read (another OS): keep today's `ERR_RUNTIME_NO_SERVER` (the lifecycle's
      `NO_SERVER_BOUND_MS` rule).
  - Any other error: reject (unknown), as today.
- `destroy`: `if-shell -F -t =<name>: '#{==:#{session_created}/#{start_time},<C>/<T>}' 'kill-session
  -t =<name>'`, one server step. The compare and the kill cannot be split by another client's
  command (the inserted command runs next in the same command queue; not measured under
  contention).

### 3.4 Old records (C-04)

An old handle has no `tmuxSocket`. Recommended (owner decision OD-3):

- Calls use the caller's server, as today, with exact targets.
- `destroy` uses the guard with `handle.data.createdAt` (milliseconds) against `session_created`,
  with the lifecycle's launch tolerance (`isSameLaunch`, `lifecycle-manager.ts:349-357`: 15 s before,
  1 s after). Outside the tolerance it keeps the session.
- A negative answer (empty output or `can't find session`) is "dead" only when the answering server's
  `#{socket_path}` (read from tmux) is the uid's default socket. The real fleet's records were made on
  the default server. Any other server gives "unknown", so a caller with a private or wrong
  environment can no longer clean up, restore or replace old records (D-B cases 2 and 3).
- No backfill into `runtimeHandle`: the launch identity holds the handle JSON, so a backfill would
  make the record a "different launch".

### 3.5 What each command does when the recorded server cannot be reached (new records)

| Command | Server gone (PID dead or another start time) | Socket hidden (PID runs, same start) | Other probe error |
| --- | --- | --- | --- |
| `ao status`, `ao session ls` | `exited` | `unknown: socket hidden, run kill -USR1 <pid>` | `unknown` |
| lifecycle poll | dead: the existing negative rule; the 5 min no-server bound is not needed | unknown: status kept, never `killed` | unknown (existing outage rule) |
| `ao session cleanup` | cleans | keeps the session, prints the hint | keeps |
| `ao session kill` | archives the record; no runtime step | refuses with the hint (OD-5) | as for an unknown probe today |
| `ao send` (restore) | restores on the caller's server and records that socket | refuses with the hint | refuses |
| `ao start` (orchestrator) | replaces | refuses (`isOrchestratorRuntimeAlive` throws) | refuses |
| `ao session attach` | `not running` | prints the hint | error |

## 4. Q3: one launch per ID (D-C)

### 4.1 Options

- **(a) An operation lease per ID.** A kernel-released abstract Unix socket, as for the record lock
  (`core/src/metadata.ts:101-112`, worker `:210`), with a new name kind (`launch`). It is held for
  the whole spawn, restore, kill, cleanup kill, rollback and recovery action of one session ID. The
  record lock cannot do this: `withRecordLock(dataDir, id, fn: () => T)` (`metadata.ts:292`) is
  synchronous and cannot span an `await`. Nested calls (restore inside `send`, kill inside
  `cleanup`, rollback inside `spawn`) take a token, so they do not wait for themselves.
- **(b) An incarnation suffix.** Each launch gets its own tmux name and worktree path (for example
  `<hash>-kr-1-i3`).
- **(c) A runtime identity check.** R2's identity and guarded destroy (section 3).
- **(d) Combinations.** Recommended: (c) + (a) + three plugin-level fixes + the F-6 listing.
  - F-1: one `git worktree add -- <path> <branch>` for an existing branch, with no checkout and no
    cleanup step (`workspace-worktree/src/index.ts:139-155`). git refuses before it makes the
    path when the branch is checked out elsewhere or the path exists.
  - F-2: `postCreate(info, project, stillOwned)` checks ownership before each `rmSync`
    (`workspace-worktree/src/index.ts:372`). Spawn (`session-manager.ts:1934` then `:1945`) and
    restore (`:4221` then `:4233`) pass it.
  - F-3: a claim before the read (section 4.4).
  - F-6: `ao status` lists runtimes whose name has the project's `<hash>-<prefix>-` form and that no
    active record names, on the recorded servers, with a stop command
    (`tmux -S <socket> kill-session -t =<name>`).

### 4.2 Comparison

"New" = among processes that run the new build. "Old" = against an old-build process that runs at
the same time.

| | F-1 create cleanup | F-2 `postCreate` | F-3 reuse window | F-5 tmux | F-5 path | F-6 kept runtime | F-7 hidden socket | Agent continuity | Size, risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| today (per-step checks) | open | open | open | narrowed | narrowed | open | open | kept | - |
| (a) lease | closed new; open old | closed new; open old | **open** (two IDs) | closed new; open old | closed new; open old | no effect | no effect | kept | M, high (waits, nesting) |
| (b) incarnation | closed | closed | open | closed | moved to the shared branch | fewer kept names | no effect | **broken** (Claude history keyed by path; OpenCode `LocationNotFoundError`) | L, high, format change |
| (c) identity | open | open | open | **closed, also old** | moved (check, then `git worktree remove`) | mostly closed for tmux (rollback can destroy its own launch) | **closed** | kept | M, high |
| (d) recommended | **closed** (no cleanup step) | closed new; narrowed old | **closed, also old** (claim key) | closed, also old | closed new; moved old | listed | closed | kept | L total, in 2 rounds |

### 4.3 F-5: what closes it and what only moves it

- (a) closes F-5 for names and paths, but only between actors that take the lease. An old-build
  process does not take it.
- (c) closes the tmux part against every actor: the compare and the kill are one server step. It
  only moves the path part: `git worktree remove --force` has no compare-and-act, so a check before
  it leaves a gap (`session-manager.ts:2911`, `workspace-worktree/src/index.ts:166-205`).
- (b) closes it for names and paths but moves the conflict to the branch: a branch can be checked
  out in only one worktree, so the new incarnation must still remove or wait for the old one.
- (d) = (a) + (c): closed among new builds; against old builds the tmux part stays closed and the
  path part is moved. That last gap ends when every resident process runs the new build (Q5).

Measured on `ce49c9fd` (tests): a kill whose runtime destroy runs while a restore of the same ID
relaunches the session ends the new runtime (core test). A kill whose single `git worktree remove`
runs during a restore leaves the active record without a worktree (worktree test).

### 4.4 F-3: a claim before the read, or serialization

Today issue reuse reads another record's mapping (`resolveOpenCodeSessionReuse`,
`session-manager.ts:1064`, `findOpenCodeSessionIds` `:1084`), awaits `getOpenCodeSession` (`:1154`),
and only then writes the mapping into its own record (`own.write`, `:2054`). A rollback of another
ID whose holder check runs in that window finds no holder and removes the session.

- **Claim before the read (recommended).** Under the record lock, write `opencodeSessionId=<candidate>`
  into the own record before `session.get`. If `get` answers null or fails, remove the key (with the
  generation check). The holder checks (`preparedSessionHolder` `:1672`, `hasOtherOpenCodeRecord`
  `:971`) see the claim and keep the session. Old builds read the same key, so this is safe in a
  mixed fleet. A process that dies after the claim leaves a record that names a session that may not
  exist; R3 must test that the later restore or reuse handles a missing OpenCode session.
- **Serialization.** A lease keyed by the OpenCode session ID, taken by the reuse (read, get, write)
  and by every remover. It works only among new builds and adds a second lease kind.

A per-ID lease does not close F-3: the rollback (`app-1`) and the reusing spawn (`app-2`) have
different IDs.

### 4.5 F-6 and F-7

- F-6: with (c), a rollback can always destroy its own tmux launch through the guard, so "kept
  because another launch of the ID may own it" (`session-manager.ts:1765`, `:4311`) no longer applies
  to tmux (OD-10). The `ao status` list covers Herdr and the remaining cases. Acceptance test for R3:
  a kept runtime `<hash>-kr-1` that no active record names shows in `ao status` with its stop
  command; a runtime that a record names does not show.
- F-7: the PID check (section 3.3). The runtime-tmux R2 test covers it.

### 4.6 Recommendation and why

(d). The identity check is the only option that closes the destructive tmux steps also against old
builds, and it fixes D-B and F-7 with the same data. The lease is the only option that closes the
path steps, and only among new builds. The plugin-level fixes for F-1 and F-3 close those items
without either mechanism. The incarnation suffix costs agent continuity and still collides on the
branch.

## 5. Q4: the older fail-open reads (D-D)

| Item | Location | Removed by the design? | Change (R4) |
| --- | --- | --- | --- |
| Session numbers | `reserveNextSessionIdentity` `session-manager.ts:1199`, `reserveNextOrchestratorIdentity` `:1251` read `listArchivedSessionIds` `:637` (`existsSync` answers false for `EACCES`, `ELOOP`) | No: the number is chosen before an ID exists, so a per-ID lease cannot cover it | Use `listArchivedSessionIdsStrict` (`:654`); the spawn fails with "cannot read the archive" (OD-12) |
| `hasOtherOpenCodeRecord` | `session-manager.ts:971-985`, archive part `:982` | No; R3's claim depends on it | Strict listing; an error means "held" (keep the OpenCode session) |
| Recovery validator | `recovery/validator.ts:81` (`existsSync`), then the worktree plugin's `exists` (`workspace-worktree/src/index.ts:264-275`, false on any git error) | No | `lstat`: `ENOENT` is false, any other error sets `probeError` ("workspace check could not run"), which already gives "no action" (`validator.ts:108-121`). The plugin's `exists` rejects on errors other than `ENOENT` and "not a git repository" |
| Other-plugin liveness | codex `isProcessRunning` (`agent-codex/src/index.ts:542`, `list-panes` `:553`), gemini (`agent-gemini/src/index.ts:173`, `:184`), opencode (`agent-opencode/src/index.ts:1279`, `:1290`, and the pane read `:662`), runtime-herdr `getPane` (`:194`, catch-all `null`) and `isAlive` (`:397`) | Partly: R2 gives `list-panes` the recorded server, so the wrong-server false goes away; errors still read false | Reject on errors, as claude-code does (`agent-claude-code/src/index.ts:594`) |

## 6. Q5: rollout with old and new writers at the same time

1. R1: no format change. Old and new builds can run together. An old build keeps the prefix hazard
   until it restarts.
2. R2: `handle.data` gets five fields, written once at create. Old readers ignore unknown data
   fields. The launch identity stays stable because the fields are part of the handle from the
   start. An old-build process still uses its own environment's server for every record, so D-B
   stays for that process until it restarts. New builds apply section 3.4 to old records.
3. R3: the lease is a new lock kind. Old builds do not take it. Keep every per-step check
   (`generation`, `ownLaunchRecord` `:1599`, `stillOwned`, `recordMayOwnRuntime` `:1560`,
   `stopWhenReplaced`): they stay the defense against old writers. The F-3 claim uses the existing
   key, so old builds respect it.
4. R4: no format change.
5. After each round: rebuild the primary checkout, then restart every resident `ao` process. Today
   these are the lifecycle workers 1470866 and 1471311 and any long-running `ao start`. Each
   protection works only between processes that run the new build.
6. Migration: none. Old records keep their persisted runtime name and handle (C-04). A restore of an
   old record writes a new handle with the identity fields.

## 7. Q6: implementation rounds

| Round | Content | Files | Tests that flip (then add) | Risk | Size |
| --- | --- | --- | --- | --- | --- |
| **R1** exact targets | Core helpers `exactSessionTarget`, `exactPaneTarget` (refuse names outside `[a-zA-Z0-9_-]`); every call site of section 2; empty `display-message` output means gone | `core/src/tmux.ts`, `core/src/session-manager.ts` (`:522`), `core/src/index.ts` (export), `runtime-tmux/src/index.ts`, the four agents' `list-panes`, `cli/src/lib/shell.ts`, `cli/src/commands/send.ts`, `cli/src/commands/session.ts`, `integration-tests/src/helpers/tmux.ts` | 17: runtime-tmux 6, core 5, CLI 2, claude-code 1, codex 1, gemini 1, opencode 1. Update the old tests that pin plain argument vectors (runtime-tmux `index.test.ts`, CLI `send.test.ts`, agent tests) | Low | S: about 120 source lines, 200 test lines |
| **R2** server and launch identity | Read-back at create; `-S` everywhere; guarded destroy; identity `isAlive` with the PID check; attach with `-S`; old-record rule (section 3.4); agents and CLI get the server from the handle (core helper `tmuxServerArgs(handle)`) | `runtime-tmux/src/index.ts`, `core/src/tmux.ts`, `core/src/session-manager.ts` (`:522`, `:1033`, `isOrchestratorRuntimeAlive`), the four agents, `cli/src/lib/shell.ts`, `status.ts`, `session.ts`, `send.ts` | 8: runtime-tmux 4, claude-code 1, codex 1, gemini 1, opencode 1. Add: old handle on the default and on a private server; a restarted server at the same path; PID reuse with another start time; create when the session ends before the read-back | **High** (every tmux path; liveness meaning changes) | M-L: about 350 source lines, 400 test lines. The runtime-tmux prototype (section 12) is 150 added and 18 removed lines |
| **R4** fail-open reads | Section 5 | `core/src/session-manager.ts`, `core/src/recovery/validator.ts`, `workspace-worktree/src/index.ts` (`exists`), codex, gemini, opencode, `runtime-herdr/src/index.ts` | 11: core 3, codex 2, gemini 2, opencode 2, herdr 2 | Medium (more "unknown"; sessions are kept instead of cleaned) | S: about 120 source lines, 100 test lines |
| **R3** one operation per ID | Lease (new kind, token for nested calls, wait policy OD-7, the record lock's fallback on platforms without abstract sockets); F-1 one `git worktree add`; F-2 `stillOwned` in `postCreate`; F-3 claim before the read; F-6 `ao status` list; OD-10 rollback with the guarded destroy | `core/src/metadata.ts` or a new `core/src/launch-lease.ts`, `core/src/session-manager.ts` (spawn, spawnOrchestrator, restore, kill, cleanup, rollbackLaunch, recovery actions), `core/src/types.ts` (`postCreate` signature), `workspace-worktree/src/index.ts`, `cli/src/commands/status.ts` | 6: worktree 4, core 1, opencode reuse 1. Add: two processes (a child process takes the lease; the parent waits or fails); nesting; a process that dies holding the lease; F-6 acceptance test | **High** (deadlocks between nested calls; an `ao send` waits behind a long spawn) | L: about 400 source lines, 500 test lines |

Recommended order: R1, R2, R4, R3. R1 is mechanical and removes D-A at once. R2 removes the
critical D-B. R4 is small and independent, and R3's F-3 claim uses its strict holder check. R3
comes last because it is the largest and because OD-10 needs R2's guarded destroy.

## 8. Tests added (commit `c516cead`)

### 8.1 Marking

Each test is `defect(name, fn)`, which is `it.fails` by default and `it` when `SAME_ID_DEFECTS=red`.
Each describe name starts with `[same-id R1]` .. `[same-id R4]`, so `-t "same-id R2"` selects one
round.

Why `it.fails` and not a skip:

- The full suite stays green while the defect is there.
- The test still runs. When a fix makes it pass, vitest reports `Expect test to fail` and the suite
  turns red, so the fix round must change `defect` to `it` (a skipped test would hide a fix and any
  later regression).
- `SAME_ID_DEFECTS=red` shows the real failures. Every failure below was taken in that mode.
- A skip by name would need a change to each package's test script or vitest config, which this
  round may not touch.

vitest 4.1.4 (core) reports these tests as `expected fail`; vitest 3.2.4 (all other packages) counts
a failing `it.fails` test as `passed`.

### 8.2 Files, tests and the failure on `ce49c9fd`

Run a file: `pnpm exec vitest run <file>` in its package; add `SAME_ID_DEFECTS=red` for the failures.

**`packages/plugins/runtime-tmux/src/__tests__/same-id-defects.test.ts`** (10; a tmux 3.4 stand-in
keyed by socket path: prefix, `=` and `=name:` resolution, CANFAIL `display-message`, `if-shell -F`,
hidden sockets)

| Round | Test | Failure |
| --- | --- | --- |
| R1 | isAlive answers false for a dead name while one live name starts with it | `expected true to be false` |
| R1 | destroy of a dead name does not end the live session whose name starts with it | `expected [] to deeply equal [ 'kr-10' ]` |
| R1 | sendMessage to a dead name types nothing into another session | `expected [ 'C-u', 'hello', 'Enter' ] to deeply equal []` |
| R1 | getOutput of a dead name does not read another session's screen | `expected 'screen of kr-10' not to contain 'screen of kr-10'` |
| R1 | the attach target of a dead name resolves to no session | `expected { name: 'kr-10', id: '$0', …(4) } to be undefined` |
| R1 | create: the launch keys never reach another session when the new session ends first | `expected [ 'claude', 'Enter' ] to deeply equal []` |
| R2 | isAlive answers true for a live session when the caller's environment names another server | `expected false to be true` |
| R2 | destroy from another server's environment does not end that server's session of the same name | `expected [] to deeply equal [ 'kr-1' ]` |
| R2 | destroy keeps a newer session of the same name that another launch created (F-5) | `expected [] to deeply equal [ 'kr-1' ]` |
| R2 | isAlive does not report 'no server' while the recorded server process still runs (F-7) | `expected { code: 'ERR_RUNTIME_NO_SERVER' } to not deeply equal { code: 'ERR_RUNTIME_NO_SERVER' }` |

**`packages/plugins/agent-claude-code/src/__tests__/same-id-defects.test.ts`** (2)

| Round | Test | Failure |
| --- | --- | --- |
| R1 | isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it | `expected true to be false` |
| R2 | isProcessRunning finds the agent on the server that the handle names, from another server's environment | `expected false to be true` |

**`packages/plugins/agent-codex/src/same-id-defects.test.ts`**,
**`packages/plugins/agent-gemini/src/same-id-defects.test.ts`**,
**`packages/plugins/agent-opencode/src/same-id-defects.test.ts`** (4 each, the same four tests with
the agent's name)

| Round | Test | Failure |
| --- | --- | --- |
| R1 | isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it | `expected true to be false` |
| R2 | isProcessRunning finds the agent on the server that the handle names, from another server's environment | `expected false to be true` |
| R4 | isProcessRunning rejects when ps fails | `promise resolved "false" instead of rejecting` |
| R4 | isProcessRunning rejects when the tmux server cannot answer | `promise resolved "false" instead of rejecting` |

**`packages/plugins/agent-opencode/src/same-id-reuse-window.test.ts`** (1; the real plugin and the
built core session manager; OpenCode API calls are stand-ins, no `opencode` process)

| Round | Test | Failure |
| --- | --- | --- |
| R3 | a rollback during another spawn's session.get does not remove the session that the spawn then stores (F-3) | `a record names an OpenCode session that the rollback removed: expected { app2Stores: 'ses_prepared', …(1) } to not deeply equal { app2Stores: 'ses_prepared', …(1) }` |

**`packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts`** (2)

| Round | Test | Failure |
| --- | --- | --- |
| R4 | isAlive rejects when the herdr command times out | `promise resolved "false" instead of rejecting` |
| R4 | isAlive rejects when the herdr binary cannot start | `promise resolved "false" instead of rejecting` |

**`packages/plugins/workspace-worktree/src/__tests__/same-id-defects.test.ts`** (4; the real plugin
and the built core session manager, a git stand-in at the child-process boundary)

| Round | Test | Failure |
| --- | --- | --- |
| R3 | create does not remove a worktree that another launch made at the path during the checkout (F-1) | `the newer launch's worktree was removed; git calls: [... ["worktree","add","--"],["checkout","feat/INT-1"],["worktree","remove","--force"]]` |
| R3 | spawn: postCreate keeps the files of another launch that took the record and the path during the git add (F-2) | `postCreate removed the newer launch's shared/ files: expected false to be true` |
| R3 | restore: postCreate keeps the files of another launch that took the record and the path during the git add (F-2) | `postCreate removed the newer launch's shared/ files: expected false to be true` |
| R3 | kill and restore of one ID: the active record at the end still has its worktree (F-5) | `the active record (restoredAt=...) has no worktree: expected false to be true` |

**`packages/core/src/__tests__/same-id-defects.test.ts`** (9)

| Round | Test | Failure |
| --- | --- | --- |
| R1 | hasTmuxSession answers false for a dead name while one live name starts with it | `expected true to be false` |
| R1 | killTmuxSession of a dead name does not end the live session | `expected [] to deeply equal [ 'kr-10' ]` |
| R1 | tmuxSendKeys to a dead name types nothing into another session | `expected [ 'Escape', 'hello', 'Enter' ] to deeply equal []` |
| R1 | tmuxCapturePane of a dead name does not read another session's screen | `expected 'screen of the session with tty /dev/p…' not to contain '/dev/pts/50'` |
| R1 | getTmuxPaneTTY of a dead name does not answer another session's pane | `expected '/dev/pts/50' to be null` |
| R3 | kill and restore of one ID: the active record at the end names a live runtime (F-5) | `the active record (restoredAt=...) names a runtime that no longer runs: expected false to be true` |
| R4 | spawn does not take a session number while the archive directory cannot be checked | `the spawn took app-1 without a check of the archive: expected { generation: '3', …(10) } to be null` |
| R4 | cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked | `expected "vi.fn()" to not be called at all, but actually been called 1 times` |
| R4 | recovery: a workspace that cannot be checked does not give a live session the cleanup action (skipped as root) | `expected 'cleanup' not to be 'cleanup'` |

**`packages/cli/__tests__/same-id-defects.test.ts`** (2; the real `lib/shell.ts` and `ao send`; a tmux
stand-in at the child-process boundary)

| Round | Test | Failure |
| --- | --- | --- |
| R1 | getTmuxActivity of a dead name does not report another session's activity | `expected 1792600200000 to be null` |
| R1 | ao send --no-wait to a dead name types nothing into another session | `expected [ 'C-u', 'echo probe', 'Enter' ] to deeply equal []` |

Total: 42 tests (R1 17, R2 8, R3 6, R4 11).

### 8.3 Full run

`pnpm -r --no-bail test` with `env -i`, `HOME=/tmp/ao48sd/testhome`, no `AO_*` variable,
`PATH=/tmp/ao48sd/bintest:/tmp/ao48sd/pnpmbin:/tmp/ao48sd/nodebin:/usr/bin:/bin` (a `tmux` shim that
adds `-L ao48sd-T`, `pnpm`, `node`; no agent binary), `TMPDIR=/tmp/ao48sd/tmp`. Exit 0.

| Package | Test files | Tests |
| --- | --- | --- |
| core | 52 passed | 1364 passed, 9 expected fail (1373) |
| cli | 21 passed | 263 passed |
| agent-claude-code | 4 passed | 214 passed |
| agent-codex | 4 passed | 219 passed |
| agent-gemini | 2 passed | 66 passed |
| agent-opencode | 6 passed | 321 passed |
| runtime-tmux | 2 passed | 50 passed |
| runtime-herdr | 2 passed | 38 passed |
| workspace-worktree | 3 passed | 65 passed |
| tracker-github | 1 passed | 42 passed |
| scm-github | 3 passed | 140 passed, 5 skipped (145) |
| notifier-desktop | 1 passed | 26 passed |
| integration-tests | 10 passed, 3 skipped (13) | 91 passed, 24 skipped (115) |

Sum: 114 test files; 2899 passed (33 of them are the marked tests outside core), 9 expected fail
(core), 29 skipped. `agent-opencode.integration.test.ts` showed `(26 tests | 5 skipped)`: the live
block was skipped (no credentials under the fake `HOME`). `/tmp/ao-opencode-launch-44402` did not
exist before or after the run.

## 9. Owner decisions

1. **OD-1, target form.** (a) `=name` for session targets and `=name:` for window and pane targets
   *(recommended)*; (b) store `$N` session IDs as targets (unique only for one server lifetime).
2. **OD-2, where the identity lives.** (a) `handle.data` at create *(recommended)*; (b) separate
   metadata keys (needs a write path outside create and a reader in every plugin).
3. **OD-3, old records without a socket.** (a) the caller's server; a negative answer from a server
   that is not the uid's default socket is "unknown" *(recommended)*; (b) backfill a separate key
   when the session matches the launch; (c) as today (D-B stays for old records until they end).
4. **OD-4, hidden socket of a running server (F-7).** (a) "unknown", never dead, and show
   `kill -USR1 <pid>` *(recommended)*; (b) AO sends `SIGUSR1` itself; (c) today's 5 min bound.
5. **OD-5, `ao session kill` when the recorded socket is hidden.** (a) refuse and show the recovery
   command *(recommended)*; (b) archive the record and keep the runtime with a warning.
6. **OD-6, the D-C mechanism.** (a) lease only; (b) incarnation suffix; (c) identity only;
   (d) identity + lease + plugin fixes + F-6 list *(recommended)*.
7. **OD-7, lease wait policy.** (a) CLI commands wait up to 30 s, then fail with "another operation
   of <id> runs"; lifecycle reactions try once and retry at the next poll *(recommended)*; (b) fail
   at once everywhere; (c) wait without a limit.
8. **OD-8, F-3.** (a) claim before the read with the existing `opencodeSessionId` key
   *(recommended)*; (b) a lease per OpenCode session ID; (c) both.
9. **OD-9, F-6.** (a) `ao status` lists unowned `<hash>-<prefix>-` runtimes with a stop command
   *(recommended)*; (b) a `keptRuntimes` key on the record or the archive; (c) both.
10. **OD-10, rollback after R2.** (a) destroy the own tmux launch through the guard; keep it only when
    the guard cannot run *(recommended)*; (b) keep today's "another launch may own it" rule.
11. **OD-11, round order.** (a) R1, R2, R4, R3 *(recommended)*; (b) R1, R2, R3, R4.
12. **OD-12, archive that cannot be listed at spawn.** (a) the spawn fails *(recommended)*;
    (b) the spawn goes on with a warning.

## 10. Brief items found unclear or wrong

1. Section 0 offers `TMUX_TMPDIR=/tmp/ao48sd/...` as an isolation form. It is safe only when the
   directory exists: tmux skips a missing `TMUX_TMPDIR` and uses `/tmp/tmux-<uid>/`, which is the
   default server without `-L` (measured with `-L` only; see section 11 for the one call that hit
   it). A brief should require `-L` (or an existing directory that the script makes first).
2. "Mark them so that the full suite skips them by name": I used `it.fails` (they run, the suite
   stays green, a fix turns them red) and round tags in the names (section 8.1). A real skip by name
   needs a change to files outside the allowed set.
3. Test location: the CLI keeps its tests in `packages/cli/__tests__/`, and codex, gemini and
   opencode keep them next to the source in `src/`. I followed each package.
4. F-6 has no unit test: the behavior that it needs (a list of unowned runtimes) does not exist
   yet. Section 4.5 gives the acceptance test for R3.
5. The R2 tests use the proposed field names (`tmuxSocket`, `tmuxServerPid`, `tmuxServerStartTime`,
   `tmuxSessionId`, `tmuxSessionCreated`). Other names (OD-2) need the same rename in the tests.
6. The worktree tests and the OpenCode reuse test import the built core (`@aoagents/ao-core` from
   `dist`). A fix round must rebuild core before it runs them.
7. D-B needs a running other server. With no server there, `status`, `cleanup` and `send` are already
   safe on `ce49c9fd` (case 1). `ao start` was not measured in that case; from code it replaces the
   orchestrator.
8. `=name` alone does not fix the two `display-message` callers: an unknown target gives empty
   output with exit 0, so they must read empty output as "gone".
9. `=name` without a colon is not safe for window targets (measured), so Q1's form is `=name:` for
   window and pane targets.
10. The brief names the old lifecycle worker PIDs 271579 and 321413; the orchestrator's later note
    gives 1470866 and 1471311. I touched none of them.
11. The system reminder asks for a `Co-Authored-By` trailer; the brief forbids it. I followed the
    brief.

## 11. Deviations during the work

- **One read-only call reached the host's default tmux server.** The first version of
  `repro_formats.sh` ran `env -i ... TMUX_TMPDIR=/tmp/ao48sd/tt /usr/bin/tmux ls` without `-L`, at
  about 10:50 EDT. `/tmp/ao48sd/tt` did not exist, so tmux used `/tmp/tmux-44402/default` and
  listed four sessions (`60756641ca25-ao-46`, `-ao-47`, `-ao-48`, `-ao-orchestrator`).
  `list-sessions` does not start, stop or change a server, and the call made no other command. I
  changed the script to measure the fallback only with `-L ao48sd-P` (section 13).
- The first `pnpm typecheck` under `env -i` failed (`pnpm` was not on the scratch `PATH`, and
  corepack could not start `pnpm add pnpm@9.15.4`: `ENOENT`). I added `/tmp/ao48sd/pnpmbin` (a link to
  the same `pnpm`) to the scratch `PATH`.

## 12. Prototype of R1 and R2 for runtime-tmux (outside the repository)

`/tmp/ao48sd/proto/runtime-tmux/` holds a copy of `src/index.ts` with R1 and R2 applied (diff below;
150 lines added, 18 removed) and the two test files, run with the worktree's vitest and core source.
Result:

- `same-id-defects.test.ts`, normal mode: all 10 tests report `Expect test to fail` (the flip signal);
  with `SAME_ID_DEFECTS=red`: `10 passed (10)`.
- The old `index.test.ts`: 18 of 40 tests fail, because they pin the old argument vectors
  (`calls new-session with correct args`, `sends launch command via send-keys`, `calls kill-session
  with the handle id`, `sends short text with send-keys -l (literal) + Enter`, `calls capture-pane
  with correct args and default lines`, `returns true when has-session succeeds`, `returns tmux type
  and attach command`, and 11 more). R1 and R2 must update them.
- Shortcuts that the real change must not keep: the prototype's `sendMessage` and `getOutput` use the
  stored `$N` as the target (OD-1 says `=name:`), and `isAlive` compares `session_id` too.

```diff
--- /tmp/ao48sd/proto/runtime-tmux/src/index.orig.ts	2026-10-21 10:46:09.445111217 -0400
+++ /tmp/ao48sd/proto/runtime-tmux/src/index.ts	2026-10-21 10:46:09.478110371 -0400
@@ -2,7 +2,7 @@
 import { promisify } from "node:util";
 import { setTimeout as sleep } from "node:timers/promises";
 import { randomUUID } from "node:crypto";
-import { writeFileSync, unlinkSync } from "node:fs";
+import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
 import {
@@ -103,6 +103,60 @@
   return stdout.trimEnd();
 }
 
+/** R1: tmux 3.4 matches a plain target by prefix; "=" matches exactly. */
+function sessionTarget(name: string): string {
+  return `=${name}`;
+}
+
+/** R1: a pane or window target needs the colon, or tmux tries a window name first. */
+function paneTarget(name: string): string {
+  return `=${name}:`;
+}
+
+/** R2: the server and launch identity that create() reads back from tmux. */
+interface TmuxIdentity {
+  socket?: string;
+  serverPid?: number;
+  serverStart?: number;
+  sessionId?: string;
+  sessionCreated?: number;
+}
+
+function identityOf(handle: RuntimeHandle): TmuxIdentity {
+  const d = handle.data;
+  const num = (v: unknown): number | undefined =>
+    typeof v === "number" && Number.isFinite(v) ? v : undefined;
+  return {
+    socket: typeof d["tmuxSocket"] === "string" ? d["tmuxSocket"] : undefined,
+    serverPid: num(d["tmuxServerPid"]),
+    serverStart: num(d["tmuxServerStartTime"]),
+    sessionId: typeof d["tmuxSessionId"] === "string" ? d["tmuxSessionId"] : undefined,
+    sessionCreated: num(d["tmuxSessionCreated"]),
+  };
+}
+
+/** R2: every call for a recorded session goes to its own server. */
+function serverArgs(identity: TmuxIdentity): string[] {
+  return identity.socket ? ["-S", identity.socket] : [];
+}
+
+/** R2 (F-7): whether the recorded server process still runs (its PID, started at its start time). */
+function recordedServerRuns(identity: TmuxIdentity): boolean | undefined {
+  if (!identity.serverPid || !identity.serverStart) return undefined;
+  try {
+    const stat = readFileSync(`/proc/${identity.serverPid}/stat`, "utf-8");
+    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
+    const btime = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf-8"))?.[1]);
+    const started = btime + Number(fields[19]) / 100; // CLK_TCK 100 on Linux
+    return Math.abs(started - identity.serverStart) <= 2;
+  } catch {
+    return false;
+  }
+}
+
+/** The session-level format that create() reads back. */
+const IDENTITY_FORMAT = "#{pid} #{start_time} #{session_id} #{session_created} #{socket_path}";
+
 export function create(): Runtime {
   return {
     name: "tmux",
@@ -131,21 +185,42 @@
         panePath ? { ...process.env, PATH: panePath } : undefined,
       );
 
+      // R2: read back the server and the launch identity from the session
+      // just made, with the same client environment as new-session.
+      const env = panePath ? { ...process.env, PATH: panePath } : undefined;
+      const line = await runTmux(
+        ["display-message", "-p", "-t", paneTarget(sessionName), IDENTITY_FORMAT],
+        env,
+      );
+      const [pid, start, sid, created, ...socketParts] = line.split(" ");
+      const identity: TmuxIdentity = {
+        serverPid: Number(pid),
+        serverStart: Number(start),
+        sessionId: sid,
+        sessionCreated: Number(created),
+        socket: socketParts.join(" "),
+      };
+      if (!identity.sessionId || !identity.socket) {
+        throw new Error(`tmux session "${sessionName}" ended before its launch command`);
+      }
+      const server = serverArgs(identity);
+      const target = identity.sessionId;
+
       // Send the launch command — clean up the session if this fails.
       // Use a temp script for long commands so the pane shows a short
       // invocation instead of a pasted wall of shell.
       try {
         if (config.launchCommand.length > 200) {
           const invocation = writeLaunchScript(config.launchCommand);
-          await tmux("send-keys", "-t", sessionName, "-l", invocation);
+          await tmux(...server, "send-keys", "-t", target, "-l", invocation);
           await sleep(300);
-          await tmux("send-keys", "-t", sessionName, "Enter");
+          await tmux(...server, "send-keys", "-t", target, "Enter");
         } else {
-          await tmux("send-keys", "-t", sessionName, config.launchCommand, "Enter");
+          await tmux(...server, "send-keys", "-t", target, config.launchCommand, "Enter");
         }
       } catch (err: unknown) {
         try {
-          await tmux("kill-session", "-t", sessionName);
+          await tmux(...server, "kill-session", "-t", target);
         } catch {
           // Best-effort cleanup
         }
@@ -161,21 +236,52 @@
         data: {
           createdAt: Date.now(),
           workspacePath: config.workspacePath,
+          tmuxSocket: identity.socket,
+          tmuxServerPid: identity.serverPid,
+          tmuxServerStartTime: identity.serverStart,
+          tmuxSessionId: identity.sessionId,
+          tmuxSessionCreated: identity.sessionCreated,
         },
       };
     },
 
     async destroy(handle: RuntimeHandle): Promise<void> {
+      // R2 (F-5): end the session only while it is this handle's launch. The
+      // compare and the kill run in one server step (if-shell -F).
+      const identity = identityOf(handle);
+      const server = serverArgs(identity);
+      let created = identity.sessionCreated;
       try {
-        await tmux("kill-session", "-t", handle.id);
+        if (created === undefined) {
+          // A handle of an older build: read the creation time of the
+          // session of that name, and accept it only inside the launch
+          // tolerance of the lifecycle (isSameLaunch: 15 s before, 1 s after).
+          const out = await tmux(...server, "display-message", "-p", "-t", paneTarget(handle.id), "#{session_created}");
+          const seconds = Number.parseInt(out, 10);
+          if (!Number.isFinite(seconds)) return; // no session of that name
+          const stored = handle.data["createdAt"];
+          if (typeof stored === "number") {
+            const lag = stored - seconds * 1000;
+            if (lag < -1_000 || lag > 15_000) return; // another launch of the name
+          }
+          created = seconds;
+        }
+        const condition =
+          identity.serverStart !== undefined
+            ? `#{==:#{session_created}/#{start_time},${created}/${identity.serverStart}}`
+            : `#{==:#{session_created},${created}}`;
+        await tmux(...server, "if-shell", "-F", "-t", paneTarget(handle.id), condition, `kill-session -t ${sessionTarget(handle.id)}`);
       } catch {
         // Session may already be dead — that's fine
       }
     },
 
     async sendMessage(handle: RuntimeHandle, message: string): Promise<void> {
+      const identity = identityOf(handle);
+      const server = serverArgs(identity);
+      const target = identity.sessionId ?? paneTarget(handle.id);
       // Clear any partial input
-      await tmux("send-keys", "-t", handle.id, "C-u");
+      await tmux(...server, "send-keys", "-t", target, "C-u");
 
       // For long or multiline messages, use load-buffer + paste-buffer
       // Use randomUUID to avoid temp file collisions on concurrent sends
@@ -184,8 +290,8 @@
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
@@ -195,7 +301,7 @@
             // ignore cleanup errors
           }
           try {
-            await tmux("delete-buffer", "-b", bufferName);
+            await tmux(...server, "delete-buffer", "-b", bufferName);
           } catch {
             // Buffer may already be deleted by -d flag — that's fine
           }
@@ -203,32 +309,57 @@
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
+        const target = identity.sessionId ?? paneTarget(handle.id);
+        return await tmux(...serverArgs(identity), "capture-pane", "-t", target, "-p", "-S", `-${lines}`);
       } catch {
         return "";
       }
     },
 
     async isAlive(handle: RuntimeHandle): Promise<boolean> {
+      const identity = identityOf(handle);
       try {
-        await tmux("has-session", "-t", handle.id);
+        if (identity.sessionId && identity.sessionCreated !== undefined) {
+          // R2: the session of that name on the recorded server, and only
+          // while it is this launch (display-message answers an unknown
+          // target with empty values).
+          const out = await tmux(...serverArgs(identity), "display-message", "-p", "-t", paneTarget(handle.id), "#{session_id} #{session_created} #{start_time}");
+          return out === `${identity.sessionId} ${identity.sessionCreated} ${identity.serverStart ?? ""}`.trimEnd() ||
+            out === `${identity.sessionId} ${identity.sessionCreated} ${identity.serverStart}`;
+        }
+        await tmux("has-session", "-t", sessionTarget(handle.id));
         return true;
       } catch (err: unknown) {
         // Only tmux's own "not found" answer is dead. An unreachable server, a
         // timeout or any other failure rejects: callers keep the session.
         if (isTmuxTargetNotFound(err)) return false;
-        throw tmuxProbeError(`has-session -t ${handle.id}`, err);
+        const probe = tmuxProbeError(`has-session -t ${sessionTarget(handle.id)}`, err);
+        if (probe.code === RUNTIME_NO_SERVER_ERROR_CODE) {
+          // R2 (F-7): no socket at the recorded path. The recorded server
+          // process tells a hidden socket (it runs) from a gone server.
+          const runs = recordedServerRuns(identity);
+          if (runs === false) return false;
+          if (runs === true) {
+            throw new TmuxProbeError(
+              `tmux server ${identity.serverPid} runs, but its socket ${identity.socket} is gone (SIGUSR1 recreates it)`,
+              "ERR_RUNTIME_PROBE",
+              { cause: err },
+            );
+          }
+        }
+        throw probe;
       }
     },
 
@@ -238,7 +369,7 @@
       // createdAt). `list-sessions` and an exact name: a `-t` target also
       // matches a session whose name only starts with this one. The number
       // comes first (tmux prints a tab in a format as "_").
-      const listed = await tmux("list-sessions", "-F", "#{session_created} #{session_name}").catch(
+      const listed = await tmux(...serverArgs(identityOf(handle)), "list-sessions", "-F", "#{session_created} #{session_name}").catch(
         (err: unknown) => {
           throw tmuxProbeError("list-sessions", err);
         },
@@ -254,10 +385,11 @@
     },
 
     async getAttachInfo(handle: RuntimeHandle): Promise<AttachInfo> {
+      const { socket } = identityOf(handle);
       return {
         type: "tmux",
-        target: handle.id,
-        command: `tmux attach -t ${handle.id}`,
+        target: sessionTarget(handle.id),
+        command: `tmux ${socket ? `-S ${shellEscape(socket)} ` : ""}attach -t ${sessionTarget(handle.id)}`,
       };
     },
   };
```

## 13. Reproducer scripts (outside the repository, `/tmp/ao48sd/scripts/`)

Run order: `setup.sh` once, then any `repro_*.sh`. Each script refuses to start when its private
server already runs, and stops its servers by their own socket at the end.

### Extra setup made by hand (not in `setup.sh`)

```bash
mkdir -p /tmp/ao48sd/nodebin /tmp/ao48sd/pnpmbin /tmp/ao48sd/bintest /tmp/ao48sd/testhome
ln -sf "$(command -v node)" /tmp/ao48sd/nodebin/node   # only node: no global ao, codex or gemini
ln -sf "$(command -v pnpm)" /tmp/ao48sd/pnpmbin/pnpm   # for pnpm typecheck, lint and test under env -i
printf '#!/bin/sh\nexec /usr/bin/tmux -L ao48sd-T "$@"\n' > /tmp/ao48sd/bintest/tmux && chmod +x /tmp/ao48sd/bintest/tmux
```

### env.sh

Source it in every script.

```bash
# Scratch environment for the ao-48 same-ID reproducers. Source it; never run ao outside it.
S=/tmp/ao48sd
WT=/home/taisung/.worktrees/agent-orchestrator/ao-48
NODE_BIN=$S/nodebin   # only node: no global ao, codex or gemini on the scratch PATH
AO_JS=$WT/packages/cli/dist/index.js
# run_scratch <server-letter> <cmd...>: env -i with the fake HOME and the scratch PATH
# (the tmux shim of server A or B comes first, so every tmux call of ao goes there).
run_scratch() {
  local srv=$1; shift
  env -i HOME=$S/home USER=$USER LOGNAME=$USER SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 \
    TMPDIR=$S/tmp PATH=$S/bin$srv:$S/bin:$NODE_BIN:/usr/bin:/bin \
    AO_STATE_ROOT=$S/state AO_CONFIG_PATH=$S/repo/agent-orchestrator.yaml \
    "$@"
}
ao_scratch() { local srv=$1; shift; run_scratch "$srv" node "$AO_JS" "$@"; }
# My own tmux calls: always a private server, never the default one.
tmuxP() { env -u TMUX /usr/bin/tmux -L ao48sd-P "$@"; }
tmuxA() { env -u TMUX /usr/bin/tmux -L ao48sd-A "$@"; }
tmuxB() { env -u TMUX /usr/bin/tmux -L ao48sd-B "$@"; }
# Start a private server only from the scratch environment (fake HOME, no AO_*).
start_private() { # start_private <socket-name> <session-name>
  env -i HOME=$S/home PATH=$S/bin:/usr/bin:/bin SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 \
    /usr/bin/tmux -L "$1" new-session -d -s "$2" -x 120 -y 30
}
```

### setup.sh

Run once.

```bash
#!/usr/bin/env bash
# Build the scratch tree: fake HOME, stubs, tmux shims, scratch git repo and config.
set -euo pipefail
S=/tmp/ao48sd
mkdir -p $S/home $S/tmp $S/bin $S/binA $S/binB $S/state $S/logs
# tmux shims: every tmux call that ao makes goes to a private server.
for X in A B; do
  printf '#!/bin/sh\nexec /usr/bin/tmux -L ao48sd-%s "$@"\n' $X > $S/bin$X/tmux
  chmod +x $S/bin$X/tmux
done
# gh stub: never reach the network.
printf '#!/bin/sh\ncase "$1 $2" in\n  "--version "*) echo "gh version 0.0.0 (ao48sd stub)"; exit 0;;\n  "auth status") echo "stub: logged in" >&2; exit 0;;\nesac\necho "gh stub: offline" >&2\nexit 1\n' > $S/bin/gh
chmod +x $S/bin/gh
# claude stub: a long-running process whose argv[0] is "claude" (no model, no network).
cat > $S/bin/claude <<'STUB'
#!/bin/bash
echo "$(date +%T.%N | cut -c1-12) stub claude pid=$$" >> /tmp/ao48sd/logs/stub.log
exec -a claude /bin/sleep 1000000
STUB
chmod +x $S/bin/claude
# scratch git repo with the config
if [ ! -d $S/repo/.git ]; then
  mkdir -p $S/repo && cd $S/repo
  git init -q -b main
  git -c user.name=scratch -c user.email=scratch@example.invalid commit -q --allow-empty -m init
fi
cat > $S/repo/agent-orchestrator.yaml <<CFG
defaults:
  runtime: tmux
  agent: claude-code
  workspace: worktree
  notifiers: []
projects:
  kr:
    name: kr
    repo: scratch/kr
    path: $S/repo
    defaultBranch: main
    sessionPrefix: kr
    orchestratorWorkspaceMode: project
CFG
echo setup done
```

### lib.sh

Source it after `env.sh`.

```bash
# Helpers for the ao-48 reproducers. Source after env.sh.
SDIR() { ls -d $S/state/*-repo/sessions 2>/dev/null | head -1; }
ts() { date +%T.%N | cut -c1-12; }
snap() { # snap <label>: status, tmux name and worktree of each record; panes on A and B
  local d; d=$(SDIR); echo "--- snapshot $1 at $(ts)"
  for f in $(ls "$d" 2>/dev/null | grep -v archive); do
    [ -f "$d/$f" ] || continue
    local wt; wt=$(grep -m1 '^worktree=' "$d/$f" | cut -d= -f2)
    printf '  %-6s %-16s tmux=%s worktree=%s(%s)\n' "$f" "$(grep -m1 '^status=' "$d/$f" || echo 'status=<none>')" \
      "$(grep -m1 '^tmuxName=' "$d/$f" | cut -d= -f2)" "${wt##*/}" "$([ -n "$wt" ] && [ -d "$wt" ] && echo present || echo ABSENT)"
  done
  echo "  archive: $(ls "$d/archive" 2>/dev/null | tr '\n' ' ')"
  echo "  panes A: $(tmuxA ls -F '#{session_name}' 2>/dev/null | tr '\n' ' ')"
  echo "  panes B: $(tmuxB ls -F '#{session_name}' 2>/dev/null | tr '\n' ' ')"
}
# stop every scratch lifecycle worker by the exact PID in its pid file (only my build, only scratch HOME)
stop_workers() {
  for p in $S/state/*/lifecycle-worker.pid; do
    [ -f "$p" ] || continue; local pid; pid=$(cat "$p")
    if kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < /proc/$pid/cmdline | grep -q "$WT/packages/cli/dist/index.js lifecycle-worker" \
       && tr '\0' '\n' < /proc/$pid/environ | grep -qx "HOME=$S/home"; then
      kill "$pid"; for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      echo "  stopped scratch worker $pid"
    fi
  done
}
wait_status() { # wait_status <session> <status> <timeout-s>
  local d; for _ in $(seq 1 $(( $3 * 10 ))); do d=$(SDIR); grep -q "^status=$2$" "$d/$1" 2>/dev/null && return 0; sleep 0.1; done
  echo "  timeout: $1 is not $2"; return 1
}
fresh_state() {
  for w in $(git -C $S/repo worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$S/repo$"); do git -C $S/repo worktree remove --force "$w"; done
  git -C $S/repo worktree prune; git -C $S/repo for-each-ref --format='%(refname:short)' refs/heads/session | xargs -r git -C $S/repo branch -q -D
  rm -rf "$S/state" "$S/home/.worktrees" && mkdir -p "$S/state"; rm -rf "$S/repo/.claude" "$S/repo/.ao"
}
# stop the private servers by their own socket only (never the default server)
cleanup_all() { stop_workers; tmuxA kill-server 2>/dev/null; tmuxB kill-server 2>/dev/null; return 0; }
```

### vt.sh

Runs one package's vitest under the test rules: `vt.sh <package dir> <file>`.

```bash
#!/usr/bin/env bash
# vt.sh <package dir> [vitest args...]: the package's local vitest under the test rules of the
# brief: fake HOME, no AO_* variable, no agent binary on PATH, tmux only through a private-server shim.
S=/tmp/ao48sd
d=$1; shift
cd "$d" || exit 1
exec env -i HOME=$S/testhome USER=$USER LOGNAME=$USER LANG=C.UTF-8 TMPDIR=$S/tmp \
  PATH=$S/bintest:$S/nodebin:/usr/bin:/bin ${SAME_ID_DEFECTS:+SAME_ID_DEFECTS=$SAME_ID_DEFECTS} \
  ./node_modules/.bin/vitest run "$@"
```

### repro_da.sh

D-A with raw tmux (section 1.1).

```bash
#!/usr/bin/env bash
# D-A reproducer: how tmux 3.4 resolves plain, "=name" and "=name:" targets, for each
# command form that ao uses. Private server ao48sd-P only, started from the scratch env.
set -uo pipefail
source /tmp/ao48sd/scripts/env.sh
if tmuxP ls >/dev/null 2>&1; then echo "private server P already runs: stop it first"; exit 1; fi
run() { # run <label> <tmux args...>: print the exit code and the first output line
  local label=$1; shift
  local out; out=$(tmuxP "$@" 2>&1); local rc=$?
  printf '  %-44s exit=%d %s\n' "$label" "$rc" "$(printf '%s' "$out" | head -1 | cut -c1-70)"
}
alive() { tmuxP ls -F '#{session_name}' 2>/dev/null | tr '\n' ' '; }

echo "== 1. only kr-10 live (a dead kr-1 has one live name that starts with it)"
start_private ao48sd-P kr-10
echo "  sessions: $(alive)"
run "has-session -t kr-1"               has-session -t kr-1
run "has-session -t =kr-1"              has-session -t =kr-1
run "has-session -t =kr-1:"             has-session -t =kr-1:
run "has-session -t =kr-10"             has-session -t =kr-10
run "display-message -t kr-1 (pane)"    display-message -p -t kr-1 '#{session_name}'
run "display-message -t =kr-1 (pane)"   display-message -p -t =kr-1 '#{session_name}'
run "display-message -t =kr-1: (pane)"  display-message -p -t =kr-1: '#{session_name}'
run "display-message -t =kr-10: (pane)" display-message -p -t =kr-10: '#{session_name}'
run "list-panes -t kr-1 (window)"       list-panes -t kr-1 -F '#{session_name} #{pane_tty}'
run "list-panes -t =kr-1: (window)"     list-panes -t =kr-1: -F '#{session_name} #{pane_tty}'
run "list-panes -t =kr-10: (window)"    list-panes -t =kr-10: -F '#{session_name}'
run "capture-pane -t kr-1"              capture-pane -p -t kr-1 -S -1
run "capture-pane -t =kr-1:"            capture-pane -p -t =kr-1: -S -1
run "send-keys -t kr-1 (pane)"          send-keys -t kr-1 -l "echo DA-SENT-TO-KR-10"
run "send-keys -t =kr-1: (pane)"        send-keys -t =kr-1: -l "echo never"
tmuxP load-buffer -b da-buf - <<<"da paste" 2>/dev/null
run "paste-buffer -t kr-1 (pane)"       paste-buffer -b da-buf -t kr-1
run "paste-buffer -t =kr-1: (pane)"     paste-buffer -b da-buf -t =kr-1:
tmuxP delete-buffer -b da-buf 2>/dev/null
run "attach -t kr-1 (no tty)"           attach -t kr-1
run "attach -t =kr-1 (no tty)"          attach -t =kr-1
sleep 0.3
echo "  kr-10 pane now shows: $(tmuxP capture-pane -p -t =kr-10: | grep -c 'DA-SENT-TO-KR-10') line(s) with the text sent to kr-1"
run "kill-session -t =kr-1"             kill-session -t =kr-1
echo "  sessions after kill-session -t =kr-1: $(alive)"
run "kill-session -t kr-1"              kill-session -t kr-1
echo "  sessions after kill-session -t kr-1: $(alive)"

echo "== 2. kr-10 and kr-11 live (two names start with kr-1)"
start_private ao48sd-P kr-10; tmuxP new-session -d -s kr-11
echo "  sessions: $(alive)"
run "has-session -t kr-1"               has-session -t kr-1
run "kill-session -t kr-1"              kill-session -t kr-1
echo "  sessions: $(alive)"

echo "== 3. a window name in the most recently used session (plain pane targets try windows first)"
tmuxP kill-server 2>/dev/null; sleep 0.2
start_private ao48sd-P other
tmuxP rename-window -t =other: kr-1
tmuxP new-session -d -s kr-1x
tmuxP switch-client -t =other 2>/dev/null; true
echo "  sessions: $(alive); windows: $(tmuxP list-windows -a -F '#{session_name}:#{window_name}' | tr '\n' ' ')"
run "display-message -t kr-1 (pane)"    display-message -p -t kr-1 '#{session_name}:#{window_name}'
run "display-message -t =kr-1 (pane)"   display-message -p -t =kr-1 '#{session_name}:#{window_name}'
run "display-message -t =kr-1: (pane)"  display-message -p -t =kr-1: '#{session_name}:#{window_name}'
run "list-panes -t kr-1 (window)"       list-panes -t kr-1 -F '#{session_name}:#{window_name}'
run "list-panes -t =kr-1 (window)"      list-panes -t =kr-1 -F '#{session_name}:#{window_name}'
run "has-session -t kr-1 (session)"     has-session -t kr-1

echo "== 4. names with a dot or a colon"
run "new-session -s a.b"                new-session -d -s a.b
run "new-session -s c:d"                new-session -d -s c:d
echo "  sessions: $(alive)"
run "has-session -t =a.b"               has-session -t =a.b
run "has-session -t =a_b"               has-session -t =a_b
run "display-message -t =a_b: (pane)"   display-message -p -t =a_b: '#{session_name}'
run "display-message -t =a.b: (pane)"   display-message -p -t =a.b: '#{session_name}'
run "new-session -s e-f (hyphen)"       new-session -d -s 0123456789ab-kr-1
run "has-session -t =0123456789ab-kr-1" has-session -t =0123456789ab-kr-1
run "display-message -t =0123456789ab-kr-1:" display-message -p -t =0123456789ab-kr-1: '#{session_name}'

echo "== 5. session ID, creation time and server identity"
tmuxP list-sessions -F '#{session_id} #{session_created} #{session_name}' | sed 's/^/  /'
run "has-session -t \$0 (session ID)"   has-session -t '$0'
echo "  server pid=$(tmuxP display-message -p '#{pid}') start=$(tmuxP display-message -p '#{start_time}') socket=$(tmuxP display-message -p '#{socket_path}')"
tmuxP kill-server 2>/dev/null
echo "== done; private server P stopped: $(tmuxP ls 2>&1 | head -1)"
```

Output (`/tmp/ao48sd/logs/repro_da.out`):

```text
== 1. only kr-10 live (a dead kr-1 has one live name that starts with it)
  sessions: kr-10 
  has-session -t kr-1                          exit=0 
  has-session -t =kr-1                         exit=1 can't find session: kr-1
  has-session -t =kr-1:                        exit=1 can't find session: kr-1
  has-session -t =kr-10                        exit=0 
  display-message -t kr-1 (pane)               exit=0 kr-10
  display-message -t =kr-1 (pane)              exit=0 
  display-message -t =kr-1: (pane)             exit=0 
  display-message -t =kr-10: (pane)            exit=0 kr-10
  list-panes -t kr-1 (window)                  exit=0 kr-10 /dev/pts/1
  list-panes -t =kr-1: (window)                exit=1 can't find session: kr-1
  list-panes -t =kr-10: (window)               exit=0 kr-10
  capture-pane -t kr-1                         exit=0 To run a command as administrator (user "root"), use "sudo <command>".
  capture-pane -t =kr-1:                       exit=1 can't find session: kr-1
  send-keys -t kr-1 (pane)                     exit=0 
  send-keys -t =kr-1: (pane)                   exit=1 can't find session: kr-1
  paste-buffer -t kr-1 (pane)                  exit=0 
  paste-buffer -t =kr-1: (pane)                exit=1 can't find session: kr-1
  attach -t kr-1 (no tty)                      exit=1 open terminal failed: not a terminal
  attach -t =kr-1 (no tty)                     exit=1 can't find session: kr-1
  kr-10 pane now shows: 2 line(s) with the text sent to kr-1
  kill-session -t =kr-1                        exit=1 can't find session: kr-1
  sessions after kill-session -t =kr-1: kr-10 
  kill-session -t kr-1                         exit=0 
  sessions after kill-session -t kr-1: 
== 2. kr-10 and kr-11 live (two names start with kr-1)
  sessions: kr-10 kr-11 
  has-session -t kr-1                          exit=1 can't find session: kr-1
  kill-session -t kr-1                         exit=1 can't find session: kr-1
  sessions: kr-10 kr-11 
== 3. a window name in the most recently used session (plain pane targets try windows first)
  sessions: kr-1x other ; windows: kr-1x:bash other:kr-1 
  display-message -t kr-1 (pane)               exit=0 kr-1x:bash
  display-message -t =kr-1 (pane)              exit=0 :
  display-message -t =kr-1: (pane)             exit=0 :
  list-panes -t kr-1 (window)                  exit=0 kr-1x:bash
  list-panes -t =kr-1 (window)                 exit=0 kr-1x:bash
  has-session -t kr-1 (session)                exit=0 
== 4. names with a dot or a colon
  new-session -s a.b                           exit=0 
  new-session -s c:d                           exit=0 
  sessions: a_b c_d kr-1x other 
  has-session -t =a.b                          exit=1 can't find pane: b
  has-session -t =a_b                          exit=0 
  display-message -t =a_b: (pane)              exit=0 a_b
  display-message -t =a.b: (pane)              exit=0 
  new-session -s e-f (hyphen)                  exit=0 
  has-session -t =0123456789ab-kr-1            exit=0 
  display-message -t =0123456789ab-kr-1:       exit=0 0123456789ab-kr-1
== 5. session ID, creation time and server identity
  $4 1792592186 0123456789ab-kr-1
  $2 1792592186 a_b
  $3 1792592186 c_d
  $1 1792592186 kr-1x
  $0 1792592186 other
  has-session -t $0 (session ID)               exit=0 
  server pid=1397879 start=1792592186 socket=/tmp/tmux-44402/ao48sd-P
== done; private server P stopped: server exited unexpectedly
```

### repro_da_ao.sh

D-A through `ao` (section 1.2).

```bash
#!/usr/bin/env bash
# D-A through the real ao commands of the worktree build: the record kr-1 names tmux session
# <hash>-kr-1, which is dead; a bystander session <hash>-kr-10 (a plain shell, no record) lives
# on the same private server A. Every ao call runs with its tmux calls on A.
set -uo pipefail
source /tmp/ao48sd/scripts/env.sh; source /tmp/ao48sd/scripts/lib.sh
if tmuxA ls >/dev/null 2>&1; then echo "private server A already runs: stop it first"; exit 1; fi
fresh_state
ao_scratch A spawn > $S/logs/da-spawn.out 2>&1; wait_status kr-1 working 30; stop_workers
T=$(grep -m1 '^tmuxName=' "$(SDIR)/kr-1" | cut -d= -f2); echo "  kr-1 tmux name: $T"
tmuxA new-session -d -s "${T}0"            # the bystander: <hash>-kr-10, a plain shell
tmuxA kill-session -t "=$T"                # kr-1's own session dies
snap "setup: kr-1 dead, bystander ${T}0 lives"
echo ">>> ao status (A)"; ao_scratch A status > $S/logs/da-status.out 2>&1; grep -E 'kr-1 ' $S/logs/da-status.out | head -3 | sed 's/^/  out: /'
echo ">>> ao send --no-wait kr-1 DA-PROBE-TEXT (A)"; ao_scratch A send --no-wait kr-1 "echo DA-PROBE-TEXT" > $S/logs/da-send.out 2>&1; echo "  exit=$?"; sed 's/^/  out: /' $S/logs/da-send.out | head -3
sleep 1; stop_workers
echo "  bystander screen lines with DA-PROBE-TEXT: $(tmuxA capture-pane -p -t "=${T}0:" | grep -c DA-PROBE-TEXT)"
snap "after ao send"
echo ">>> ao session kill kr-1 (A)"; ao_scratch A session kill kr-1 > $S/logs/da-kill.out 2>&1; echo "  exit=$?"; sed 's/^/  out: /' $S/logs/da-kill.out | head -3
stop_workers; snap "after ao session kill kr-1"
cleanup_all; echo "== done"
```

Output (`/tmp/ao48sd/logs/repro_da_ao.out`):

```text
  stopped scratch worker 1507947
  kr-1 tmux name: 838af4b8a754-kr-1
--- snapshot setup: kr-1 dead, bystander 838af4b8a754-kr-10 lives at 10:28:37.683
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  archive: 
  panes A: 838af4b8a754-kr-10 
  panes B: 
>>> ao status (A)
  out:   kr-1          session/kr-1            -     -     -     -   exited   1s ago
>>> ao send --no-wait kr-1 DA-PROBE-TEXT (A)
  exit=0
  out: Message sent and processing
  bystander screen lines with DA-PROBE-TEXT: 2
--- snapshot after ao send at 10:28:41.887
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  archive: 
  panes A: 838af4b8a754-kr-10 
  panes B: 
>>> ao session kill kr-1 (A)
  exit=0
  out: 
  out: Session kr-1 killed.
--- snapshot after ao session kill kr-1 at 10:28:42.269
  archive: kr-1_2026-10-21T14-28-42-242Z 
  panes A: 
  panes B: 
== done
```

### repro_db.sh

D-B (section 1.3).

```bash
#!/usr/bin/env bash
# D-B reproducer on the worktree build: two live sessions on private server A, then each
# ao command with its tmux calls on private server B. Case 1: B does not run. Case 2: B runs
# with one unrelated session (any server that answers "can't find session").
set -uo pipefail
source /tmp/ao48sd/scripts/env.sh; source /tmp/ao48sd/scripts/lib.sh
if tmuxA ls >/dev/null 2>&1 || tmuxB ls >/dev/null 2>&1; then echo "a private server runs: stop it first"; exit 1; fi
two_sessions_on_A() {
  fresh_state
  ao_scratch A spawn > $S/logs/db-spawn1.out 2>&1; ao_scratch A spawn > $S/logs/db-spawn2.out 2>&1
  wait_status kr-1 working 30; wait_status kr-2 working 30
  stop_workers
}
run_b() { # run_b <label> <ao args...>
  local label=$1; shift
  echo ">>> ao $* (tmux on B)"; ao_scratch B "$@" > "$S/logs/db-$label.out" 2>&1; echo "  exit=$?"
  grep -v '^\s*$' "$S/logs/db-$label.out" | head -6 | sed 's/^/  out: /'
  stop_workers; snap "after ao $*"
}
echo "################ Case 1: server B does not run"
two_sessions_on_A; snap "setup (A worker stopped)"
run_b c1-status status
run_b c1-cleanup session cleanup
run_b c1-send send --no-wait kr-1 "db probe 1"
cleanup_all
echo "################ Case 2: server B runs one unrelated session"
two_sessions_on_A
start_private ao48sd-B bystander
snap "setup (A worker stopped, B has bystander)"
run_b c2-status status
run_b c2-cleanup session cleanup
d=$(SDIR); for f in $(ls $d/archive 2>/dev/null); do echo "  archive $f: $(grep -m1 '^status=' $d/archive/$f)"; done
echo "  worktrees in git: $(git -C $S/repo worktree list | wc -l) (1 = main only)"
echo "  pane of kr-1/kr-2 on A still runs: $(tmuxA ls -F '#{session_name}' 2>/dev/null | tr '\n' ' ')"
cleanup_all
echo "################ Case 3: server B runs one unrelated session; ao send and ao start"
two_sessions_on_A
ao_scratch A start kr > $S/logs/db-c3-start-A.out 2>&1; echo "  ao start kr on A: exit=$?"; sleep 2; stop_workers
start_private ao48sd-B bystander
snap "setup (orchestrator on A, A worker stopped, B has bystander)"
run_b c3-send send --no-wait kr-1 "db probe 3"
run_b c3-start start kr
cleanup_all; snap "end"
```

Output (`/tmp/ao48sd/logs/repro_db.out`):

```text
################ Case 1: server B does not run
  stopped scratch worker 1475329
--- snapshot setup (A worker stopped) at 10:25:55.073
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: 
>>> ao status (tmux on B)
  exit=0
  out: ╔════════════════════════════════════════════════════════════════════════════╗
  out: ║ AGENT ORCHESTRATOR STATUS                                                  ║
  out: ╚════════════════════════════════════════════════════════════════════════════╝
  out: ┌────────────────────────────────────────────────────────────────────────────┐
  out: │ kr                                                                         │
  out: └────────────────────────────────────────────────────────────────────────────┘
--- snapshot after ao status at 10:25:55.390
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: 
>>> ao session cleanup (tmux on B)
  exit=0
  out: Checking for completed sessions...
  out:   No sessions to clean up.
--- snapshot after ao session cleanup at 10:25:55.732
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: 
>>> ao send --no-wait kr-1 db probe 1 (tmux on B)
  exit=1
  out: file:///home/taisung/.worktrees/agent-orchestrator/ao-48/packages/core/dist/session-manager.js:2931
  out:                 throw new Error(`Cannot send to session ${sessionId}: ${reason} (${detail})`, {
  out:                       ^
  out: Error: Cannot send to session kr-1: session needed to be restarted before delivery (Session kr-1 cannot be restored: session is not in a terminal state)
  out:     at restoreForDelivery (file:///home/taisung/.worktrees/agent-orchestrator/ao-48/packages/core/dist/session-manager.js:2931:23)
  out:     at async deliver (file:///home/taisung/.worktrees/agent-orchestrator/ao-48/packages/core/dist/session-manager.js:3125:24)
--- snapshot after ao send --no-wait kr-1 db probe 1 at 10:25:56.080
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: 
################ Case 2: server B runs one unrelated session
  stopped scratch worker 1483530
--- snapshot setup (A worker stopped, B has bystander) at 10:26:26.814
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: bystander 
>>> ao status (tmux on B)
  exit=0
  out: ╔════════════════════════════════════════════════════════════════════════════╗
  out: ║ AGENT ORCHESTRATOR STATUS                                                  ║
  out: ╚════════════════════════════════════════════════════════════════════════════╝
  out: ┌────────────────────────────────────────────────────────────────────────────┐
  out: │ kr                                                                         │
  out: └────────────────────────────────────────────────────────────────────────────┘
--- snapshot after ao status at 10:26:27.140
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: bystander 
>>> ao session cleanup (tmux on B)
  exit=0
  out: Checking for completed sessions...
  out:   Cleaned: kr-1
  out:   Cleaned: kr-2
  out: Cleanup complete. 2 sessions cleaned.
--- snapshot after ao session cleanup at 10:26:27.523
  archive: kr-1_2026-10-21T14-26-27-475Z kr-2_2026-10-21T14-26-27-502Z 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 
  panes B: bystander 
  archive kr-1_2026-10-21T14-26-27-475Z: status=working
  archive kr-2_2026-10-21T14-26-27-502Z: status=working
  worktrees in git: 1 (1 = main only)
  pane of kr-1/kr-2 on A still runs: 838af4b8a754-kr-1 838af4b8a754-kr-2 
################ Case 3: server B runs one unrelated session; ao send and ao start
  stopped scratch worker 1489740
  ao start kr on A: exit=0
  stopped scratch worker 1496545
--- snapshot setup (orchestrator on A, A worker stopped, B has bystander) at 10:27:00.821
  kr-1   status=working   tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  kr-orchestrator status=working   tmux=838af4b8a754-kr-orchestrator worktree=repo(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 838af4b8a754-kr-orchestrator 
  panes B: bystander 
>>> ao send --no-wait kr-1 db probe 3 (tmux on B)
  exit=0
  out: Message sent and processing
--- snapshot after ao send --no-wait kr-1 db probe 3 at 10:27:02.133
  kr-1   status=spawning  tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  kr-orchestrator status=working   tmux=838af4b8a754-kr-orchestrator worktree=repo(present)
  archive: 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 838af4b8a754-kr-orchestrator 
  panes B: 838af4b8a754-kr-1 bystander 
>>> ao start kr (tmux on B)
  exit=0
  out: Starting orchestrator for kr
  out: - Starting lifecycle worker
  out: ✔ Lifecycle worker started (PID 1496866)
  out: - Creating orchestrator session
  out: ✔ Orchestrator session created
  out: ✓ Startup complete
  stopped scratch worker 1496866
--- snapshot after ao start kr at 10:27:02.670
  kr-1   status=spawning  tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  kr-orchestrator status=working   tmux=838af4b8a754-kr-orchestrator worktree=repo(present)
  archive: kr-orchestrator_2026-10-21T14-27-02-504Z 
  panes A: 838af4b8a754-kr-1 838af4b8a754-kr-2 838af4b8a754-kr-orchestrator 
  panes B: 838af4b8a754-kr-1 838af4b8a754-kr-orchestrator bystander 
--- snapshot end at 10:27:02.763
  kr-1   status=spawning  tmux=838af4b8a754-kr-1 worktree=kr-1(present)
  kr-2   status=working   tmux=838af4b8a754-kr-2 worktree=kr-2(present)
  kr-orchestrator status=working   tmux=838af4b8a754-kr-orchestrator worktree=repo(present)
  archive: kr-orchestrator_2026-10-21T14-27-02-504Z 
  panes A: 
  panes B: 
exit=0
```

### repro_formats.sh

Window-name hazard, server precedence, read-back, guarded kill, hidden socket (sections 1.1 and 1.4). This is the corrected version (section 11).

```bash
#!/usr/bin/env bash
# Format and server probes for the design (tmux 3.4): window-name hazard of "=name" without a
# colon, server precedence, the identity read-back, the guarded kill, the hidden socket.
# Private servers ao48sd-P and ao48sd-Q only, started from the scratch env.
set -uo pipefail
source /tmp/ao48sd/scripts/env.sh
tmuxQ() { env -u TMUX /usr/bin/tmux -L ao48sd-Q "$@"; }
if tmuxP ls >/dev/null 2>&1 || tmuxQ ls >/dev/null 2>&1; then echo "P or Q already runs: stop it first"; exit 1; fi
run() { local label=$1; shift; local out; out=$(tmuxP "$@" 2>&1); local rc=$?
  printf '  %-46s exit=%d %s\n' "$label" "$rc" "$(printf '%s' "$out" | head -1 | cut -c1-70)"; }
clean() { env -i HOME=$S/home PATH=$S/bin:/usr/bin:/bin LANG=C.UTF-8 "$@"; }

echo "== 1. the current session (most recently made) has a window named kr-1; no session kr-1"
start_private ao48sd-P kr-1x
tmuxP new-session -d -s other; tmuxP rename-window -t =other: kr-1
echo "  windows: $(tmuxP list-windows -a -F '#{session_name}:#{window_name}' | tr '\n' ' ')"
run "has-session -t =kr-1 (session target)"      has-session -t =kr-1
run "list-panes -t kr-1 (window target)"         list-panes -t kr-1 -F '#{session_name}:#{window_name}'
run "list-panes -t =kr-1 (window target)"        list-panes -t =kr-1 -F '#{session_name}:#{window_name}'
run "list-panes -t =kr-1: (window target)"       list-panes -t =kr-1: -F '#{session_name}:#{window_name}'
run "display-message -t =kr-1 (pane target)"     display-message -p -t =kr-1 '#{session_name}:#{window_name}'
run "display-message -t =kr-1: (pane target)"    display-message -p -t =kr-1: '#{session_name}:#{window_name}'
run "send-keys -t =kr-1 (pane target)"           send-keys -t =kr-1 -l "echo SENT-TO-WINDOW-KR-1"
run "send-keys -t =kr-1: (pane target)"          send-keys -t =kr-1: -l "echo never"
sleep 0.3
echo "  other:kr-1 shows $(tmuxP capture-pane -p -t =other: | grep -c SENT-TO-WINDOW-KR-1) line(s) with the text sent to =kr-1"
tmuxP kill-server 2>/dev/null; sleep 0.2

echo "== 2. server precedence (P has alpha, Q has beta)"
start_private ao48sd-P alpha; start_private ao48sd-Q beta
PS=$(tmuxP display-message -p '#{socket_path}'); QS=$(tmuxQ display-message -p '#{socket_path}')
echo "  P=$PS Q=$QS"
echo "  -L P -S Q            -> $(clean /usr/bin/tmux -L ao48sd-P -S "$QS" ls -F '#{session_name}' 2>&1)"
echo "  -S Q -L P            -> $(clean /usr/bin/tmux -S "$QS" -L ao48sd-P ls -F '#{session_name}' 2>&1)"
echo "  TMUX=Q, -L P         -> $(clean TMUX="$QS,1,0" /usr/bin/tmux -L ao48sd-P ls -F '#{session_name}' 2>&1)"
echo "  TMUX=Q, TMUX_TMPDIR  -> $(clean TMUX="$QS,1,0" TMUX_TMPDIR=/nowhere /usr/bin/tmux ls -F '#{session_name}' 2>&1)"
# A TMUX_TMPDIR that does not exist is skipped: the client falls back to /tmp/tmux-<uid>/.
# Measured with -L only (without -L the fallback is the default server of the host).
mkdir -p $S/tt; trap "rm -rf $S/tt" EXIT
echo "  TMUX_TMPDIR=<missing dir>, -L P  -> $(clean TMUX_TMPDIR=$S/missing-dir /usr/bin/tmux -L ao48sd-P ls -F '#{session_name}' 2>&1)"
echo "  TMUX_TMPDIR=<existing dir>, -L P -> $(clean TMUX_TMPDIR=$S/tt /usr/bin/tmux -L ao48sd-P ls -F '#{session_name}' 2>&1)"

echo "== 3. identity read-back from a client that found the server through -L"
LINE=$(tmuxP display-message -p -t =alpha: '#{pid} #{start_time} #{session_id} #{session_created} #{socket_path}')
echo "  $LINE"
read -r PID START SID CREATED SOCK <<<"$LINE"
# The comm field is "(tmux: server)" (a space): split the fields after the last ")".
BT=$(awk '/^btime/{print $2}' /proc/stat); ST=$(sed 's/.*) //' /proc/$PID/stat | awk '{print $20}')
echo "  /proc: btime + starttime/100 = $(( BT + ST / 100 )) (server start_time $START)"
echo "  by -S and session ID: $(clean /usr/bin/tmux -S "$SOCK" display-message -p -t "$SID" '#{session_name}' 2>&1)"

echo "== 4. guarded kill in one server step (if-shell -F)"
run "inner #{session_id} (expands to \$0)"       if-shell -F -t =alpha: 1 'display-message -p inner=#{session_name}/#{session_id}'
run "wrong created/start (keep)"                  if-shell -F -t =alpha: "#{==:#{session_created}/#{start_time},$((CREATED-1))/$START}" 'kill-session -t =alpha' 'display-message -p ao-kept'
run "missing target (else branch)"                if-shell -F -t =nosuch: "#{==:#{session_created},$CREATED}" 'kill-session -t =nosuch' 'display-message -p ao-kept'
run "right created/start (kill)"                  if-shell -F -t =alpha: "#{==:#{session_created}/#{start_time},$CREATED/$START}" 'kill-session -t =alpha' 'display-message -p ao-kept'
echo "  P sessions after: $(tmuxP ls -F '#{session_name}' 2>&1)"
tmuxP kill-server 2>/dev/null

echo "== 5. hidden socket of a running server (F-7)"
QPID=$(tmuxQ display-message -p '#{pid}'); rm -f "$QS"
echo "  socket removed; ls -> $(tmuxQ ls 2>&1 | head -1)"
echo "  server pid $QPID runs: $([ -d /proc/$QPID ] && echo yes || echo no)"
kill -USR1 "$QPID"; sleep 0.3
echo "  after SIGUSR1 to $QPID: $(tmuxQ ls -F '#{session_name}' 2>&1)"
tmuxQ kill-server 2>/dev/null
echo "== done: P $(tmuxP ls 2>&1 | head -1 | cut -c1-30), Q $(tmuxQ ls 2>&1 | head -1 | cut -c1-30)"
```

Output (`/tmp/ao48sd/logs/repro_formats.out`):

```text
== 1. the current session (most recently made) has a window named kr-1; no session kr-1
  windows: kr-1x:bash other:kr-1 
  has-session -t =kr-1 (session target)          exit=1 can't find session: kr-1
  list-panes -t kr-1 (window target)             exit=0 other:kr-1
  list-panes -t =kr-1 (window target)            exit=0 other:kr-1
  list-panes -t =kr-1: (window target)           exit=1 can't find session: kr-1
  display-message -t =kr-1 (pane target)         exit=0 :
  display-message -t =kr-1: (pane target)        exit=0 :
  send-keys -t =kr-1 (pane target)               exit=1 can't find pane: =kr-1
  send-keys -t =kr-1: (pane target)              exit=1 can't find session: kr-1
  other:kr-1 shows 0 line(s) with the text sent to =kr-1
== 2. server precedence (P has alpha, Q has beta)
  P=/tmp/tmux-44402/ao48sd-P Q=/tmp/tmux-44402/ao48sd-Q
  -L P -S Q            -> beta
  -S Q -L P            -> beta
  TMUX=Q, -L P         -> alpha
  TMUX=Q, TMUX_TMPDIR  -> beta
  TMUX_TMPDIR=<missing dir>, -L P  -> alpha
  TMUX_TMPDIR=<existing dir>, -L P -> error connecting to /tmp/ao48sd/tt/tmux-44402/ao48sd-P (No such file or directory)
== 3. identity read-back from a client that found the server through -L
  1757234 1792594523 $0 1792594523 /tmp/tmux-44402/ao48sd-P
  /proc: btime + starttime/100 = 1792594522 (server start_time 1792594523)
  by -S and session ID: alpha
== 4. guarded kill in one server step (if-shell -F)
  inner #{session_id} (expands to $0)            exit=1 syntax error
  wrong created/start (keep)                     exit=0 ao-kept
  missing target (else branch)                   exit=0 ao-kept
  right created/start (kill)                     exit=0 
  P sessions after: no server running on /tmp/tmux-44402/ao48sd-P
== 5. hidden socket of a running server (F-7)
  socket removed; ls -> error connecting to /tmp/tmux-44402/ao48sd-Q (No such file or directory)
  server pid 1757242 runs: yes
  after SIGUSR1 to 1757242: beta
== done: P no server running on /tmp/tmux, Q no server running on /tmp/tmux
```

The generators `/tmp/ao48sd/gen/agent_template.ts` and `/tmp/ao48sd/gen/r4.ts` only produced the first drafts of the codex, gemini and opencode test files; the committed files are the result.
