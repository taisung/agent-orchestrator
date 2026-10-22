# RH design r6: the Herdr stop on Herdr 0.9.5, and how AO reads 0.9.5 answers (ao-65)

Author: ao-65 (Claude Code, Opus 5.5), 2026-10-22, 18:50 to 19:30 EDT. Base `9f37813a` (`main`). Answer to
review r5 (`development/reviews/rh_design_review_r5_astra6.md`, "review r5": NOT-SOUND, 1 blocking, 6 major, 2
minor). This file replaces RH design r5 (`development/reviews/rh_design_r5_opus.md`, "r5") as a whole; it is
not a diff.

Other inputs: design r4 section 7 and h5 (`same_id_design_r4_opus.md`), review r4 M-4
(`same_id_design_review_r4_astra6.md`), the owner decisions D-8 of `development/TODO_TRACKING.md` (OD-19 (a),
OD-24 (a)), the R4 table "Absence forms of the R4 reads" (`docs/DEVELOPMENT.md`, rows 8 and 9), the 0.9.5 live
check (`herdr_live_check_095_opus.md`, "step 1"), and the code at `9f37813a` (no product file changed since
`9846cf6a`). This is a design: no file under `packages/` changed, nothing was committed. Fixtures are in
`development/artifacts/herdr_095_live_check/`: step 1 names have no prefix, r5 names start with `r5_`, the new
names of this round start with `r6_` (section 9).

## 0. Review r5 findings and the prior M-4 points: state in r6

The bar for each row is the "Required" text of review r5.

| Item | What review r5 requires (short) | State in r6 | Where |
| --- | --- | --- | --- |
| **B-1** listener checks detect a wrong close after it happened | bind the endpoint before a destructive write; compare a peer helper, connect-then-check, a server-side condition, refusal-only; test a replacement between the last path check and connect/write with zero closes on B; residual as its own decision | **Closed at design level, qualified by measurement.** Chosen: the connected-socket guard CG (connect, check the listener again, then write on that socket). Measured live on real restarts: CG refused and B's pane lived (`r6_c_race_log` c1); the r5 order closed B's restored pane (c2, the control); a handoff between the checks is refused (`r6_d_handoff_log`). The CG residual is a separate owner decision (OQ-12). The close stays off until its gates pass (OQ-13) | 3, 4.7, 4.15, 10 |
| **M-1** cwd is no namespace proof; later `/proc` reads are not bound to a domain | record and check the observation domain before every negative; prove at create that herdr's PID is read in that domain; unsupported contexts stay `unknown`, also for existing records; no cwd proof; tests for a host-made record read in a container and a same-cwd PID collision | **Closed at design level.** The record keeps the domain (PID and user namespace, uid, boot ID); every negative first checks it (procfs type, `NSpid`, namespaces, uid, `hidepid`). The create proof is the shell's own environment (`HERDR_PANE_ID`, `HERDR_SOCKET_PATH`), its namespace and `NSpid`, not its cwd. Facts measured (`r6_g_proc_domain_log`) | 4.2 to 4.5, 4.14 |
| **M-2** F-5 leaves the create cleanup close | refuse the automatic create cleanup until it can use the bound stop; name the resources; audit both close sites; test a failed launch after a server replacement with zero closes | **Closed at design level.** F-4 removes the close; the error names the workspace, pane, terminal and socket. Audit: `index.ts:366` (create) and `:400`, `:402` (`destroy`) are the only Herdr close calls; core and CLI call none. RH-B later routes the cleanup through the bound stop | 6 F-4, F-5; 4.7 |
| **M-3** a saved bare `herdr` is no binary pin | resolve to an absolute path at create, use it everywhere (also attach); no silent PATH fallback; a path pin is no content pin; tests for PATH and cwd changes; preflight on the selected binary and endpoint | **Closed at design level** | 5.7, 6 F-6, F-7 |
| **M-4** preflight on the caller's endpoint does not protect a record pinned elsewhere | keep a Herdr record whose launch cannot be shown ended; parameterize preflight by binary and endpoint; tests with a healthy caller endpoint and an unreachable pinned one; core too | **Closed at design level.** Startup reads no-server as "gone" only for runtimes whose server holds every session (tmux); for Herdr it keeps the record and starts nothing, in core and in the CLI | 5.8, 6 F-7, OQ-7, OQ-14 |
| **M-5** RH-3 does not bind negative agent answers to S | qualify the answer's `shell_pid` against S and S's incarnation before an empty or a non-empty list; a missing pane while S runs is unknown; ship with RH-2 or keep and name the limitation | **Closed at design level.** The bound agent check is part of RH-A, with RH-2; the per-entry filter of r5 is dropped | 4.8 |
| **M-6** NM-1 before the close | measure the collateral effects; refuse the case if it is not safe; keep NM-3 apart | **Closed by measurement.** `pane.close` of the only pane of a primary with a linked worktree answers `confirmation_required` and closes nothing (workspaces, shells, worktrees and branches unchanged); herdr refuses `worktree create` from a workspace in a linked git worktree, so an AO worker workspace cannot become such a primary (`r6_e_nm1_log`). RH-B reads `confirmation_required` as `unknown`. NM-3 stays a separate gate | 2.2, 4.10, 4.15 |
| **m-1** framing contradicts its read loop; `pane_info` missing | one bounded rule; qualify real-server EOF; include `pane_info`; tests for a late second line, newline without EOF, invalid UTF-8, the create's two `pane_info` answers | **Closed by measurement and design.** herdr closes the connection 0.04 to 0.22 ms after its one line, for all 10 answer kinds measured; the reader reads to EOF under a 2 s deadline and a 64 KiB cap (`r6_a_framing_log`) | 2.2, 4.6 |
| **m-2** doc 0004 overstates two behaviors | scope "closes no Herdr workspace"; "on an error or empty output" | **Closed** (doc 0004 changed, uncommitted) | 8 |
| m-2, evidence claim 1 | "every CLI call is two connections" is too broad | **Closed**: stated for the measured pane operations only; a call whose ping fails sends one; `status server` is a ping | 2.1, 8 |
| m-2, evidence claim 2 | the fake-server `server_not_running` fixture does not pass the mapper | **Closed**: its message `fake server says so` fails the prefix rule; the text now says that a fake server could copy the prefix | 5.5 |
| Prior M-4: complete counter grammar | qualify pane rollover through `p0` and `p11` | **Closed by measurement**: `w4:pZ`, `w4:p0`, `w4:p11`, `w4:p12`, `w4:p13` (`r6_f_pane_counter_log`) | 2.5 |
| Prior M-4: version and executable | bind later requests (B-1); resolve the binary (M-3); name the trusted-server assumption | **Closed at design level** (CG, F-6, assumption A-1) | 3, 4.12, 5.7 |
| Prior M-4: h5 catch-all `/proc` | ENOENT is absence only in the recorded domain | **Closed at design level** (M-1) | 4.3, 4.5 |
| Prior M-4: malformed and partial answers | fix framing, test split chunks | **Closed** (m-1) | 4.6 |
| Prior M-4: nonexistence versus unreadability | restricted `/proc` and another namespace can give ENOENT | **Closed at design level** (M-1) | 4.3 |
| Prior M-4: peers that change between connections | prevent the wrong close, not only detect it | **Closed at design level for every herdr stop, restart, crash and handoff (measured); residual R-H2 is a deliberate same-uid act, owner decision OQ-12** | 3.4, 4.12 |
| Prior M-4: the points review r5 marks closed | keep as they are | unchanged from r5 (ID check, unknown codes, `EACCES`, no-connection branch, production classifier under test) | 4.6, 4.14, 5 |
| Review r5, identity assessment: R-H1 must name same-session survivors that ignore `SIGHUP`; a failed `/proc` read in the 5 s poll; UUID and decimal syntax; exec continuity | as stated | **Narrowed by measurement:** on `pane.close` herdr sends `SIGHUP`, then `SIGTERM`, then `SIGKILL` to the members of S's session; a child that ignores `HUP` and `TERM` ends, a child that called `setsid` survives (`r6_i_signals_log`, `r6_i_signals_setsid_log`). `absent` and `destroyed` now also need that no process of S's session remains, so R-H1 is only processes that left the session; OQ-10 asks for its acceptance after NM-3. Poll, syntax and exec rules are in 4.2, 4.7, 2.4 | 2.4, 4.5, 4.12, 10 |

## 1. Results

1. **B-1: the connected-socket guard CG.** For each request of a stop, AO connects first, then reads the
   listener check again, and writes only when the listener is still the one of LC0. A unix stream connection
   is queued on the listener that the path names at `connect()`; a later restart, crash or handoff cannot move
   it (measured: a connection made before a restart got EOF or `EPIPE`; nothing reached the new server). On
   real restarts, CG refused and the new server's pane lived; the r5 order closed the new server's restored
   pane (section 3.5). CG needs nothing new: Node `fs` and `net`, measured in Node 25.7. Its residual is a
   deliberate same-uid act on the socket path inside one stop (R-H2, OQ-12). A peer helper through `ss`
   works on this host (23 ms, the same PID as `SO_PEERCRED`) and is the option if the owner does not accept
   R-H2.
2. **RH is split into RH-A and RH-B.** RH-A has no destructive request: S recorded at create, the domain
   gate, "the launch ended" as `absent` with no request (after OQ-10), `isAlive` from S, and the bound agent
   check. RH-B adds the close (`pane.close` under CG). RH-B is enabled only after its gates: NM-3 and OQ-10,
   OQ-12, and its live checks (section 7). Until then the stop of a running launch stays `unknown`
   (refusal-only for the close).
3. **M-1:** the record keeps the observation domain, and every negative checks it first. The create proves
   herdr's PID in AO's domain with the shell's own environment, not with its cwd.
4. **M-2, M-3, M-4** move into the fit round: no create cleanup close, `destroy` refuses, an absolute binary
   pin, partial pins reject, and a startup rule that keeps a Herdr record when its endpoint does not answer.
5. **M-5:** the agent check of a record with S accepts a list only when the answer shows S as the pane's
   shell; a missing pane while S runs rejects. It ships with RH-2 in RH-A.
6. **M-6, NM-1: measured and safe.** herdr refuses the close (`confirmation_required`) and closes nothing.
7. **m-1:** herdr closes each connection right after its one answer line (measured); the reader reads to EOF.
8. **R-H1 narrowed by measurement:** herdr's `pane.close` ends every process of S's session (`SIGHUP`,
   `SIGTERM`, `SIGKILL`, 0.53 s); only a process that left the session survives. `absent` and `destroyed` now
   need "S and its session ended" (a `/proc` scan of the session ID), so the residual is only processes that
   called `setsid`. Its acceptance (OQ-10) gates `absent` in RH-A and `destroyed` in RH-B.
9. **Fit round: M, 13 product files**, F-1 to F-8 with acceptance tests (section 6). RH-A: M. RH-B: S.

## 2. The 0.9.5 facts this design uses

### 2.1 The CLI (r5, corrected)

- **Connections.** Each measured pane operation of the CLI first sent `{"id":"api-client:status","method":
  "ping","params":{}}` on its own connection, then the request on a second one (`r5_b_cli_forms_log`). A call
  whose ping fails sends no request (`r5_b0_requests_log`), and `status server --json` is itself a ping.
- **Request IDs** (measured): `cli:pane:get`, `cli:pane:process_info`, `cli:pane:close`, `cli:pane:read`,
  `cli:workspace:create`, `cli:workspace:close`, `cli:agent:prompt`; `cli:request` for `pane run`,
  `send-text` and `send-keys` (`r5_b_req_*`, step 1 `closedpane_*`, `blocked_herdr_agent_prompt`). The CLI's own
  envelopes (`server_not_running`, `protocol_mismatch`) carry the command's ID.
- **Answer forms** (r5 section 2.1, table unchanged): a result: exit 0, stdout. An `error` object: exit 1,
  stdout empty, one line on stderr. Error and result: exit 1, both on stderr. No result and no error: exit 0.
  Another pane, another `id`: exit 0, not checked by the CLI. Two lines: the CLI reads the first. Garbage, a
  partial answer, a close: exit 1, Rust debug text. No answer: the CLI waits without a limit. Protocol 19:
  the CLI's `protocol_mismatch`. Version 0.9.4 with protocol 22: the request runs. No socket file, a missing
  directory, a stale socket, a regular file: the CLI's `server_not_running` with the message prefix `no herdr
  server is running at `. `EACCES`: `Error: Os { code: 13, kind: PermissionDenied, ... }`. A server that sends
  `server_not_running` itself: passed through (`r5_b_pane_get_server_not_running_from_server`; its message is
  `fake server says so`).
- **Socket path order:** `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > `$XDG_CONFIG_HOME/herdr/herdr.sock`
  > `$HOME/.config/herdr/herdr.sock` (`r5_path_*`). `status server --json` names the `socket` with and without
  a server.

### 2.2 The socket API

- One request line per connection, one answer line (r5). **New in r6** (`r6_a_framing_log`): herdr closes the
  connection 0.04 to 0.22 ms after the newline of its answer, with no byte after the newline, for `ping`,
  `workspace.create`, `pane.get`, `pane.process_info`, `workspace.list`, `pane.split`, `pane.close` (`ok` and
  `pane_not_found`), an unknown pane (`pane_not_found`) and an `invalid_request`. An answer line can come in
  two chunks. A connection that sends nothing is closed by the server after 5.0 s; a request written 0, 0.2,
  1 or 3 s after the connect is answered; one written after 10 s fails with `EPIPE`.
- Result types: `pong`, `workspace_created`, `pane_info` (from `pane.get` and `pane.split`, with `pane.pane_id`,
  `terminal_id`, `workspace_id`, `tab_id`), `pane_process_info` (`process_info.pane_id`, `shell_pid`,
  `foreground_process_group_id`, `foreground_processes`), `workspace_list`, `workspace_info`, `ok`.
- `pane.close` takes only `{pane_id}` (`api_schema.json`, `PaneTarget`); extra fields are ignored (r5). There
  is no server-side condition for a close.
- **New codes (r6):** `confirmation_required` ("closing this pane would close a worktree group") from
  `pane.close`; `linked_worktree_source` ("New and open worktree actions start from the repo parent
  workspace.") from `worktree.create` (`r6_e_nm1_log`).

### 2.3 The server, its listener, restarts and handoffs

- `/proc/net/unix` lists the listening socket of the path with the `LISTEN` flag (`0x00010000`), exactly one
  per running server (r5, r6). **New in r6:** across five restarts on this host, the socket file at the path
  kept the same `(dev, ino)` (66309:121256363; the file system reused the inode number), while the `LISTEN`
  socket inode changed each time (28911311, 28959870, 28897220, 28941986, 28956959, 28962630;
  `r6_c_race_log`, `r6_c_held_followup_log`). So the file inode alone does not show a restart; the `LISTEN`
  inode does.
- A live handoff changed both: file 121256363 to 121256372, `LISTEN` 28962630 to 28959716; the successor
  (parent 1, the `import_exe` copy) served the path; the pane shell kept its PID and start ticks
  (`r6_d_handoff_log`, as r5).
- A restart restores the workspaces with the same workspace and pane IDs and new shells; the old shells end
  (`r6_c_race_log`, as step 1).
- A connection made to a server that then stops gets EOF on read and `EPIPE` on write (raw socket,
  `r6_c_held_followup_log`); across a handoff, `EPIPE` (`r6_d_handoff_log`). In the Node client, a connection
  held across a restart got no event within its 3 s deadline (`r6_c_race_log` c3). In every case nothing
  reached the new server.
- `SO_PEERCRED` works in Python; Node 25.7 has no peer read and no `node:ffi` (`ERR_UNKNOWN_BUILTIN_MODULE`,
  `r6_h_exec_and_tools_log`). `ss -x -p -n -H src <socket>` lists the server side of an open connection with
  its peer inode and its holder: the holder PID equals the `SO_PEERCRED` PID; 22.9 ms (`r6_h_ss_peer_log`).

### 2.4 Pane shells and `/proc` (new in r6, `r6_g_proc_domain_log`, `r6_h_exec_and_tools_log`)

- The pane shell's `/proc/<pid>/environ` holds `HERDR_PANE_ID` (the pane ID), `HERDR_SOCKET_PATH` (the server's
  socket path), `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_SESSION`, `HERDR_BIN_PATH`, `HERDR_ENV=1`.
- Its parent is the server; its `NSpid` has one field; its PID and user namespaces are AO's
  (`pid:[4026531836]`, `user:[4026531837]` on this host); `/proc` is a plain `proc` mount with no `hidepid`;
  Node's `fs.statfsSync("/proc").type` is `0x9fa0` (`PROC_SUPER_MAGIC`); AO's own `NSpid` has one field.
- `exec sh` and `exec bash` in the pane keep the shell's PID and start ticks; `comm` changes to `bash`;
  `process_info.shell_pid` stays the same.
- When the shell of a workspace's only pane exits, herdr removes the pane and the workspace
  (`pane_not_found`, `workspace_not_found`).
- **`pane.close` and S's session** (`r6_i_session_log`, `r6_i_signals_log`, `r6_i_signals_setsid_log`,
  `r6_logs/strace_summary_part_i.txt`): herdr sends `SIGHUP`, then after 265 ms `SIGTERM`, then after 265 ms
  `SIGKILL` to each member of the pane shell's session (here a background job with its own process group in
  that session), and polls it with `kill(pid, 0)` in between. A child that logs and ignores `HUP` and `TERM`
  logged both and ended; two background jobs (`sleep`, and `sh` with `trap "" HUP`) ended. A child that forked
  and called `setsid()` (a new session, parent 1) got no signal and survived. Before the close, the members
  showed the shell's PID as their session ID (field 6 of `stat`); by the kernel's rule they keep it after the
  leader ends (not observed here, because they ended). What a server stop or a shell exit does to the
  session's other members was not measured.

### 2.5 IDs

Workspace and pane counters: bijective base 32 over `123456789ABCDEFGHJKMNPQRSTVWXYZ0`. Measured: workspaces
through `w0`, `w11` (step 1); panes `p1` to `p9`, `pA` to `pZ` without `I`, `L`, `O`, `U`, then `p0`, `p11`,
`p12`, `p13` (`r6_f_pane_counter_log`). Longer IDs are an extrapolation of the same rule. The check is
`^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$`. No ID reuse within a server run; after a restart the IDs of
closed workspaces above the highest open one come back (step 1). The terminal ID (`term_` + 13 hex digits of
microseconds + a counter) is a consistency check within one create, not a global token (assumption A-2).

## 3. B-1: binding the close to the server that showed S

### 3.1 The defect, measured

r5 read the listener check (LC) before and after each connection. On a real restart this closes the wrong
pane: the client checked LC on server A, A stopped, B started and restored the same pane ID, the client
connected to B and wrote `pane.close`, B answered `ok` and closed its restored pane; LC changed only after the
close (`r6_c_race_log` c2: B's `w1:p1` gone, its shell 659885 ended, no workspace left). One ordinary restart
is enough.

### 3.2 The options

| Option | What it binds | What it needs | Measured | Residual |
| --- | --- | --- | --- | --- |
| **(A) peer helper**: read the peer of the open connection before the write: Python `SO_PEERCRED`, `ss -x -p` (iproute2), or a compiled helper | the connection to the server process (PID and start ticks); C2 and C3 on one process = one run = no ID reuse | a binary dependency (`python3` or `ss`) or a native build; a child process per request (23 ms with `ss`); a parser for `ss` output; a readable `fd` directory of the server | `SO_PEERCRED` (r5), `ss` peer and holder (`r6_h_ss_peer_log`) | the same-uid server is trusted (A-1); fails closed when the helper is missing |
| **(B) connected-socket guard CG**: connect, read LC again, write on that socket only when LC equals LC0 | the connection to the listener of LC0 (3.4) | nothing new: Node `fs` and `net` (`/proc/net/unix` 0.65 ms) | Node client on real restarts and a handoff (`r6_c_race_log`, `r6_d_handoff_log`), server timing (`r6_a_framing_log`) | R-H2 (3.4) |
| **(C) server-side conditional close** (`pane.close` with an expected shell or terminal) | the close to the launch, atomically | a herdr feature; `pane.close` takes only `pane_id` in 0.9.5 (`api_schema.json`) | not available | none for the close |
| **(D) refusal-only** | nothing is closed | nothing | | sessions whose launch runs are never stopped by AO |

### 3.3 Recommendation

**(B), CG**, as the binding of every request of RH-B and of the create read. It closes the measured defect,
it needs no new dependency, and its residual needs a deliberate act. (A) through `ss` is the fallback if the
owner does not accept R-H2 (OQ-12 (b)); it can be added as a second check before the write without other
changes. (C) is the long-term answer: ask herdr for a conditional close (OQ-11 (c)). If neither (B) nor (A) is
accepted, RH-B stays off: RH is refusal-only for running launches, and RH-A and the fit round still deliver
everything else (section 7).

### 3.4 The CG protocol and why it binds

`LC(path)` reads `lstat(path)` (a socket file of AO's uid; keep `(dev, ino)`) and `/proc/net/unix` (the entries
whose path field is exactly the text `path`; exactly one with the `LISTEN` flag; keep its socket inode L).
`LC0` is read once per stop, after "S runs". For each request Ck:

1. Pre-connect: `LC == LC0`, else `unknown` with no connect (an early refusal, not the binding).
2. `connect()` with a 2 s limit.
3. **Post-connect, before any byte is written: `LC == LC0`, else close the socket unwritten: `unknown`.**
4. Write the one request line; read the answer (4.6).
5. After the answer: read LC once more for the evidence text only. The binding was fixed at step 3.

Why step 3 binds. A unix stream `connect()` queues the connection on the listening socket K that the path
names at that moment. If K was bound with the path text P (as herdr binds; one entry with the exact text in
every measured restart and handoff), K is a `LISTEN` entry with text P. Step 3 sees exactly one such entry,
L0, after the connect. So either K = L0, or K stopped listening before step 3; a stopped listener resets its
queued connections, and a server that stops closes its accepted ones (measured: EOF, `EPIPE`), so the
request is never processed. A listener belongs to one server run: a restart and a handoff each make a new
one (measured, 2.3). C2 and C3 are both bound to L0, so they reach one run, in which herdr reuses no pane ID;
C3's `pane_id` names the pane that C2 showed with S, or no pane.

The file inode is kept in LC because it catches a socket file moved onto the path while L0 lives; it is not
the binding (the restart kept the inode number, 2.3).

**Residual R-H2** (replaces r5's R-H2). CG is defeated only by a same-uid act inside one stop, between AO's
connect and its post-connect check:

- a process binds a listener at the recorded location under another path text (a relative path, another
  spelling through a symlinked directory), while L0 still lists the recorded text; or
- a process binds a listener at the path, accepts AO's connection, stops listening while it keeps the
  accepted connection, and moves the old socket file back.

No herdr stop, restart, crash or handoff does either (measured: one entry with the exact text each time). A
second herdr server started by mistake with another spelling of the path is the only non-deliberate route,
and it must also move the first server's file inside the window. The `SO_PEERCRED` read of design r4 had no
such residual; Node cannot do it (2.3). OQ-12 is the owner's decision on R-H2.

Assumptions: **A-1** the herdr server at the endpoint is the owner's program and answers truthfully (as for
tmux); **A-2** the terminal ID is unique within a server run; **A-3** herdr keeps one listener per run and
does not pass it to a process that restored the panes with new shells (no such herdr behavior was seen).

### 3.5 Measured evidence for CG

| Case (fixture) | Sequence | Result |
| --- | --- | --- |
| c1 guarded (`r6_c_race_log`) | Node: pre-connect LC on A passes; A stops; B starts and restores `w1:p1`; Node connects (to B); post-connect LC | LC key `66309:121256363/28959870` differs from LC0 `.../28911311`: "refused after connect; nothing written"; B's `w1:p1` and its shell 659426 live |
| c2 unguarded, the control | the same with the r5 order (write at once) | B answered `ok`; B's `w1:p1` gone, its shell 659885 ended, no workspace left |
| c3 held | Node connects to A and passes the post-connect check; A stops; B starts; Node writes | no answer within 3 s; B's `w2:p1` and its shell 660039 live |
| held, raw (`r6_c_held_followup_log`) | connect to A; A stops; read / write | EOF / `EPIPE` then EOF |
| handoff (`r6_d_handoff_log`) | Node pre-connect check passes; live handoff; Node connects; also a raw connection held across it | post-connect LC differs (file and `LISTEN` inode both new): refused; the held connection: `EPIPE`; the shell kept PID and ticks |
| timing (`r6_a_framing_log`) | connect, wait, write | answered after 0 to 3 s; idle close at 5.0 s; CG needs about 1 ms between connect and write |

### 3.6 Stops that overlap

Two stops of one record each bind their C3 to the listener they checked. The second finds the launch ended
(`absent`), or `pane_not_found` at C2 while S runs (`unknown`), or `pane_not_found` at C3 and then the launch
ended (`absent`), or S still running after the first close (`unknown`). This is runtime-stop isolation only.
Same-ID workflow order (a stop and a restore of one ID) stays with R2a's launch-identity compare-and-set and
restore's stop-before-create; RH does not replace R3a.

## 4. RH r6 (replaces r5 section 3)

### 4.1 Scope, parts and gates

RH stays optional (OD-19 (a)). Until RH-A lands, the Herdr `stop` answers `unknown` and closes nothing
(`index.ts:418-433`).

- **RH-A (no destructive request):** S and the domain recorded at create (4.2 to 4.4), the predicates "S
  ended" and "the launch ended" (4.5), the stop's `absent` without any request when the launch ended (4.7
  steps 1 to 3), `isAlive` from S and the bound agent check (4.8).
- **RH-B (the close):** the stop of a running launch (4.7 steps 4 to 9) under CG, and the create cleanup through
  that stop.
- **Gate of RH-A's `absent`:** `absent` lets a caller remove the worktree, so it waits for OQ-10 (R-H1, after
  NM-3). Until then step 3 answers `unknown` with the evidence "the launch ended (S and its session); AO
  removes nothing on this evidence until the owner decides OQ-10". `isAlive` and the agent check do not wait.
- **Gates of RH-B** (it stays off until all pass): RH-A landed and its live checks pass; NM-1 (done, r6);
  NM-3 measured and OQ-10 decided; OQ-12 decided; the RH-B tests and live checks pass (4.14, 4.15). If OQ-12
  declines R-H2 and (A) is not chosen, RH-B stays off.

### 4.2 The record

| Key in `handle.data` | Value | Round |
| --- | --- | --- |
| `herdrBin` | the absolute path of the binary that the create resolved (5.7) | fit |
| `herdrSocket` | the absolute socket path of the create (5.7) | fit |
| `herdrShell` | `{ pid, startTicks, bootId, pidNs, userNs, uid }` | RH-A |
| `herdrQualified` | `"0.9.5/22"` from the create's ping (diagnostic) | RH-A |

Validation in every reader (stop, `isAlive`, the agent check): `pid` a safe integer from 1 to 4194304
(`PID_MAX_LIMIT`); `startTicks` matches `^(0|[1-9][0-9]{0,19})$`; `bootId` matches
`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`; `pidNs` matches `^pid:\[[1-9][0-9]*\]$`;
`userNs` matches `^user:\[[1-9][0-9]*\]$`; `uid` a safe integer from 0; `herdrSocket` and `herdrBin` absolute. A record
with `herdrShell` that fails any check: stop `unknown`, `isAlive` rejects, the agent check rejects; no request
and no `/proc` read of the PID. A record without `herdrShell` keeps the fit-round behavior.

### 4.3 The observation domain (M-1)

Before every negative that comes from `/proc` (the stop's `absent` and `destroyed`, `isAlive` false, the agent
check's empty list for an ended S), AO checks that it reads the same process domain as at create:

1. `statfs("/proc").type` is `0x9fa0` (Node `fs.statfsSync`; measured).
2. `/proc/self/status` has one `NSpid` field, equal to `process.pid` (the mount belongs to AO's PID namespace;
   an ancestor's mount lists two or more).
3. `readlink("/proc/self/ns/pid")` equals `pidNs`; `readlink("/proc/self/ns/user")` equals `userNs`.
4. `process.getuid()` equals `uid`.
5. The `/proc` line of `/proc/self/mountinfo` has no `hidepid=` other than `0` or `off`, and no `subset=`.
6. `/proc/sys/kernel/random/boot_id` reads as a UUID.

Any failure or read error: `unknown` (stop), a rejection (`isAlive`, agent check). This holds for every record
with S, also ones made before a change of the reader's context: a record made on the host and read by AO in a
container (another PID namespace, a shared record) fails item 3, so ENOENT for the host shell never becomes
`absent`. Order: the domain, then the boot ID, then the PID; an ENOENT of the stat path never overrides a
failed domain or boot ID read. After a host restart the initial PID namespace has the same inode
(`4026531836`), so items 1 to 5 pass and the boot ID decides "ended"; a non-initial namespace gets a new inode,
item 3 fails, and the record stays `unknown` (conservative).

### 4.4 The create: reading S and proving its domain

After `workspace create` (pinned, 5.7) returned pane P, workspace W and terminal T, and **before** `pane run`:

1. The domain items 1 to 6 for AO itself; keep `pidNs`, `userNs`, `uid`, `bootId`.
2. LC0 on `herdrSocket`; C0 `ping` under CG: exactly `version` `"0.9.5"`, `protocol` `22`.
3. C1 `pane.get {P}` under CG: `pane_info` with `pane_id` P, `workspace_id` W, `terminal_id` T.
4. C2 `pane.process_info {P}` under CG: `process_info.pane_id` P and a `shell_pid` N in 1 to 4194304.
5. C3 `pane.get {P}` under CG: T again.
6. `/proc/N`: start ticks t1; `status` real uid equal to `uid`, one `NSpid` field equal to N; `ns/pid` equal
   to `pidNs`; `environ` contains exactly `HERDR_PANE_ID=P` and `HERDR_SOCKET_PATH=<herdrSocket>`; start ticks
   again equal to t1.
7. Record `herdrShell` and `herdrQualified`.

Any failure: no S, one log line with the reason, the create goes on (the session has the fit-round behavior;
its stop stays `unknown`). Why the environment and not the cwd: herdr writes the pane ID and its socket path
into the environment of the shell it starts (2.4); a process with the same number in another namespace, or an
unrelated local process, does not carry them. Two shells with the same cwd do not share them either. The
environment is read only here; later, S is the PID and start ticks, which survive an `exec` (2.4), so S is
never checked by name or executable.

### 4.5 The predicate "S ended"

After the domain check (4.3): read `boot_id`, then `/proc/<pid>/stat`, parsed after the last `)`.

| Read | Result |
| --- | --- |
| the domain check fails | **unknown** |
| `boot_id` unreadable or not a UUID | **unknown** |
| `boot_id` differs from `bootId` | **ended** (the host restarted) |
| `stat`: `ENOENT` or `ESRCH` | **ended** |
| state `Z` or `X` | **ended** |
| start ticks differ from `startTicks` | **ended** (the PID names another process) |
| start ticks equal, another state | **runs** |
| any other error (`EACCES`, `EIO`, a line that does not parse) | **unknown** |

**"The launch ended"** is "S ended" and, in the same domain, no process left in S's session: AO reads
`/proc/[0-9]*/stat` and looks for field 6 (the session ID) equal to S.pid. A process that ended during the
scan (`ENOENT`, `ESRCH`) is skipped; any other read error, or a line that does not parse, gives **unknown**. A
member found: **unknown** ("process <pid> of the launch's session still runs"). A new session leader that got
S's PID by reuse also counts as a member, so a reuse gives `unknown`, never a false "ended". `isAlive` uses
"S ended" alone (it reports the pane's terminal); the stop's `absent` and `destroyed` and the agent check's
`[]` use "the launch ended". The scan reads one `stat` file per process (about 1000 on this host); its time
was not measured (the r5 scan of 1801 fd links took 9 ms).

### 4.6 The socket client and the answer reader (m-1)

Each connection: CG (3.4), then write one line `{"id":"ao-rh-<random>","method":...,"params":{...}}`, then read
**until EOF** with one 2 s deadline for the whole read and a 64 KiB cap. The bytes count as an answer only when:

- EOF came before the deadline and within the cap;
- they decode as UTF-8 with a fatal decoder;
- they contain exactly one `\n`, and it is the last byte;
- the line parses as a JSON object (not an array, not null) whose `id` is the request's `id`;
- it has exactly one of `result` (an object) and `error` (an object with exactly the keys `code`, a non-empty
  string, and `message`, a string);
- a `result` has the expected `type` and fields: `pong` (`version` string, `protocol` integer);
  `pane_info` (`pane` object with string `pane_id`, `terminal_id`, `workspace_id`); `pane_process_info`
  (`process_info` object with string `pane_id`, `shell_pid` a safe integer from 1 to 4194304); `ok`.

Everything else is no answer (`unknown`): every connect error (`ENOENT`, `ECONNREFUSED`, `EACCES`, others), a
CG refusal, the deadline, EOF before the newline, bytes after the newline (also in a later chunk), a newline
and no EOF, a parse error, invalid UTF-8, a wrong `id`, both or neither of `result` and `error`, extra keys in
`error`, another `type`, a missing or mistyped field. Measured server behavior that this rule needs: EOF right
after the line, for every answer kind (2.2).

### 4.7 The stop

| Step | Action | Result |
| --- | --- | --- |
| 1 | record checks (4.2) | fail: `unknown`, nothing read or sent |
| 2 | domain (4.3) | fail: `unknown` |
| 3 | "S ended" and "the launch ended" (4.5) | the launch ended: **`absent`**, no request, the evidence names the test; S ended but a session member runs, or unknown: `unknown`; S runs: step 4 (RH-A: `unknown` "the pane shell <pid> of this launch still runs; close the pane by hand", nothing sent) |
| 4 | LC0 (RH-B) | fail: `unknown`, nothing sent |
| 5 | C1 `ping` under CG | not exactly `pong` 0.9.5/22: `unknown` |
| 6 | C2 `pane.process_info {pane_id}` under CG | `process_info.pane_id` the recorded ID and `shell_pid` = S.pid: step 7; `pane_not_found`, another shell, any other answer: `unknown` (S runs elsewhere or the pane moved; OD-24) |
| 7 | "S ended" again | runs: step 8; the launch ended: `absent`; otherwise `unknown` |
| 8 | C3 `pane.close {pane_id}` under CG (post-connect check before the write) | CG refuses: `unknown`, nothing written; `ok` or `pane_not_found`: step 9; `confirmation_required`, `workspace_group_close_required`, `invalid_request`, another code, no answer: `unknown` (written, not confirmed; for `confirmation_required` nothing was closed, measured) |
| 9 | "the launch ended" every 100 ms for up to 5 s (herdr's escalation takes about 0.53 s, 2.4) | ended after `ok`: **`destroyed`**; ended after `pane_not_found`: **`absent`**; a failed domain or `/proc` read in the poll is retried within the 5 s; no valid "ended" read by the end (S runs, or a session member runs): `unknown` |

Never `workspace.close`, never `close_group`, never `other-launch`. When the launch ended, `absent` is right
even if the pane ID now names another launch: RH sends nothing to it.

### 4.8 RH-2 and the bound agent check (M-5), together in RH-A

- **`isAlive`, record with S:** record checks, domain, "S ended": runs gives `true`, ended gives `false`,
  unknown rejects. No herdr call. After a handoff (S runs, new terminal ID) it stays `true`.
- **The agent check, record with S** (core `getHerdrPaneProcesses(handle)` and `isHerdrProcessRunning(handle,
  re)`; F-6 passes the handle):
  1. Record checks and domain; "the launch ended" (4.5) gives `[]` (no agent); S ended with a session member
     left, or unknown, rejects.
  2. S runs: `pane process-info` through the pinned CLI and the F1 reader (5.1). A result counts only when
     `process_info.pane_id` is the recorded ID and `shell_pid` equals S.pid; then "S ended" again must give
     runs with the same ticks; then the whole list is the answer, empty or not.
  3. While S runs, every other answer rejects without a code: `pane_not_found` ("S runs, but the endpoint does
     not show its pane"), `server_not_running` (never the no-server code, because S runs), another
     `shell_pid`, a malformed list. The list is never filtered to a smaller one.
- The CLI read is not bound to a connection, but its answer is: only the server that runs S's pane can show S
  as that pane's shell.
- **Lifecycle effect:** with S alive on a hidden server, `isAlive` is `true` and the agent check rejects, so
  the lifecycle keeps the status (no `killed`). This removes the false-killed path of review r5 M-5.
- r5's per-entry session filter (RH-3) is dropped.

### 4.9 Version and protocol

The qualified pair is `0.9.5` / `22`, checked by C0 (create) and C1 (stop) under CG. Another pair: the create
records no S; the stop of a record with S answers `unknown` from step 5 on, while steps 1 to 3 (`absent` when
the launch ended) and RH-2 do not depend on the version. The CLI reads keep the F1 rules (5.1). A new pair needs the
step 1 matrix, r5 parts B, D, F, r6 parts A, C, D, E, and the RH live checks again.

### 4.10 Close semantics

The only close is `pane.close` of the pane that showed S at C2. For a plain one-pane workspace it also
removes the workspace (step 1). For the only pane of a primary workspace with a linked worktree workspace,
herdr answers `confirmation_required` and closes nothing (NM-1, `r6_e_nm1_log`): RH-B reads it as `unknown`.
An AO worker workspace (its directory is a linked git worktree) cannot become such a primary
(`linked_worktree_source`); an orchestrator in `orchestratorWorkspaceMode: project` (its directory is the main
checkout, `session-manager.ts:2479-2485`) can, and then its stop is `unknown`. In a workspace that the
operator split, only the agent's pane closes.

### 4.11 Restart, reuse and handoff

| Event | Old record (RH-A and RH-B) | Evidence |
| --- | --- | --- |
| restart | S ended; with no session member left: `absent` (after OQ-10), no request; `isAlive` false. The restored workspace (a new shell, no agent) stays in herdr for the operator | step 1 5.3, `r6_c_race_log` |
| a closed workspace ID returns after a restart with a new claude | the old launch ended: `absent`, the new pane is never addressed | step 1 `falsealive_*` |
| live handoff, then a stop | S runs; LC0 is read after the handoff; the successor shows S: `destroyed` (RH-B) | r5 `r5_f_handoff_log`, `r6_d_handoff_log` |
| a handoff during a stop | CG refuses (LC changed): `unknown`, nothing written; a retry works | `r6_d_handoff_log` |
| the shell exits by itself | S ended; herdr removed the pane and workspace; `absent` when no session member is left | `r6_g_proc_domain_log` |

### 4.12 Residuals and assumptions

- **R-H1 (narrowed).** A descendant that left S's session (`setsid`, a daemon) and outlives S: "the launch
  ended" does not see it, `absent` or `destroyed` follows, and AO may remove the worktree under it (measured:
  such a child survives `pane.close`, 2.4). A survivor that stayed in S's session, also one that ignores
  `SIGHUP` or `SIGTERM`, now gives `unknown` (4.5); on `pane.close` herdr also ends it with `SIGKILL`. NM-3, in
  a run the owner approves: which processes a real Claude Code starts outside its session (background shells,
  MCP servers) and whether they outlive the close; it qualifies that workload only. The remaining residual is
  of the same kind as OD-14's exclusion ("a child that leaves the group is outside the guarantee"), but OD-14
  does not decide it: OQ-10.
- **R-H2.** The CG residual (3.4); OQ-12.
- **R-H3.** A handoff during a stop: `unknown` (measured, CG refuses).
- **R-H4.** Another PID or user namespace, another uid, a restricted `/proc`: `unknown`, also for existing
  records (4.3).
- **R-H5.** A pane moved to another ID (`pane.move` exists; not measured): stop `unknown` while S runs;
  `isAlive` `true`; the agent check rejects (4.8), so the status stays.
- **A-1 to A-3** (3.4).

### 4.13 What RH needs from RW, R2b and R3

RH needs R2a (the `stop` contract; only `destroyed` and `absent` let a caller go on; the launch-identity
compare-and-set) and the fit round (the pins, the reader, the ID check, no unbound close). It does not need RW
(RH writes only handle data), R2b-1 (its Herdr part, `destroy` refuses, is F-5), R2b-2 (records without S keep
the R2a stop), R3a (CG gives runtime-stop isolation, 3.6; an AO lock cannot order an external restart
anyway) or R3b.

### 4.14 Tests

New `packages/plugins/runtime-herdr/src/__tests__/rh.test.ts` and core tests. A stand-in server is a real unix
socket server in the test's temporary directory that answers lines copied from the fixtures and records every
request; it can be replaced by a second stand-in at the same path from a test hook. `/proc`, `statfs`,
`readlink` and `/proc/net/unix` go through an injected seam. The production modules run unchanged. Every
`unknown` case asserts the requests that were sent and zero `pane.close` unless the table of 4.7 says one was
written.

RH-A:

1. Record checks: a pane ID outside the grammar; a relative pin; a partial pin; `pid` 0 and 4194305; ticks
   with a sign, a leading zero, a letter; a boot ID with uppercase or wrong groups; `pidNs` and `userNs`
   malformed: stop `unknown` with no read, `isAlive` and the agent check reject.
2. Domain: `statfs` type other than `0x9fa0`; `NSpid` with two fields; `ns/pid` or `ns/user` different; another
   uid; `hidepid=2`, `hidepid=invisible`, `subset=pid`; `boot_id` missing: `unknown` or reject, also when the
   stat read would give ENOENT (a host-made record read in a container).
3. "S ended": `ENOENT`, `ESRCH`, `Z`, `X`, other ticks, other boot ID (domain passes, no session member):
   `absent` (after OQ-10), zero requests; `isAlive` false; the agent check `[]`.
4. `/proc` errors: `EACCES`, `EIO`, a stat line that does not parse: `unknown`, rejects.
5. A command name with spaces and `)` in `stat`: parsed after the last `)`.
5a. "The launch ended": S ended and no member: `absent` (after OQ-10; before it, `unknown` with the evidence);
    S ended and a member with session ID S.pid (also one that ignores `HUP`): `unknown`, naming the member; a
    member that ends during the scan (`ENOENT`): skipped; an `EIO` on a member: `unknown`; a new leader that
    reused S's PID: `unknown`; a process that called `setsid`: not seen (the R-H1 residual, asserted by a
    test so that a later change is visible).
6. The create: S only when C0 to C3, LC and every item of 4.4 step 6 pass; a same-cwd process with another
   environment; a process with the PID in another namespace (`ns/pid` differs); `NSpid` with two fields;
   `environ` unreadable; ticks changed between the two reads; `pane run` comes after the S read; each failure
   leaves no `herdrShell` and the create succeeds.
7. An `exec` keeps S: same PID and ticks, another `comm`: `isAlive` true, the agent check accepts the list.
8. RH-2: true, false, reject as in tests 2 to 4; no herdr call.
9. The bound agent check: S runs and the answer shows S: the list, also an empty list; S runs and
   `pane_not_found`, an empty list for another `shell_pid`, a foreign `shell_pid` with a claude, the
   `server_not_running` F1 form: reject without a code; the launch ended: `[]`; S ended with a member left:
   reject.
10. Lifecycle with S alive (RH-2 true): a missing, an empty-foreign and a no-server answer of the agent check
    keep the status over the bound; no `killed`.
11. A reused workspace ID with a new claude (`falsealive_*`): the old launch ended: `absent`, zero requests to
    that pane; the agent check `[]`, not the new claude.
12. The R2a control "core stopRuntime uses it instead of destroy: unknown, and no close" keeps its oracle for
    records without S.

RH-B:

13. A healthy stop: one `pane.close {pane_id}`, zero `workspace.close`, no `close_group`; `destroyed`.
14. **The B-1 interleaving:** a hook replaces stand-in A by stand-in B (same path, B shows the same pane ID with
    another shell) after the pre-connect check of C3 and before its connect: CG refuses; zero requests reach B.
    Also after C2's answer and before C3's pre-connect check; also between C1 and C2.
15. A replacement after C3's post-connect check: the request goes to A's connection; B gets nothing.
16. LC: no socket file, `EACCES`, not a socket, not ours, no `LISTEN` entry, two `LISTEN` entries,
    `/proc/net/unix` unreadable: `unknown`, zero requests.
17. C1: protocol 19, version 0.9.4, no `version`, an error, no answer: `unknown`, zero close.
18. Framing at C1, C2 and C3: a second line in a later chunk; a newline and no EOF (deadline); invalid UTF-8;
    more than 64 KiB; EOF before the newline; one line split in two chunks (accepted); a wrong `id`; extra keys
    in `error`; `error` and `result`; another `type`; `shell_pid` 0, negative, a float, text, 4194305; the
    create's two `pane_info` answers with T and with another T.
19. C2: `pane_not_found`, another shell: `unknown`, zero close.
20. C3: `ok` and the launch ends: `destroyed`; `ok`, S ends, a session member stays: `unknown`;
    `pane_not_found` and the launch ends: `absent`; `confirmation_required` (the line of
    `r6_e_nm1_log`), `workspace_group_close_required`, `invalid_request`, an unknown code, no answer: `unknown`;
    `ok` and S runs after 5 s: `unknown`; a domain failure in every poll: `unknown`; one failed poll read then
    "ended": `destroyed`.
21. After a handoff (LC0 new, stable through the stop, C2 shows S): `destroyed`.
22. The create cleanup of a failed `pane run` goes through this stop when S was recorded; without S it closes
    nothing (F-4).

### 4.15 Live checks

Scratch only, with the isolation of section 9 and the stand-in claude of step 1. RH-A: (1) `ao spawn`: the
record has S and the domain; (2) `herdr server stop`, then `ao session kill`: `absent`, zero herdr requests in
the shim log; (3) a restart and a new session with the reused workspace ID: the old record `absent`, the new
pane runs; (4) a live handoff: `ao status` alive, the agent check works; (5) the socket file moved away while
S runs: `isAlive` true, the agent check rejects, the status stays, the stop `unknown`; (5a) a stand-in child
in S's session that ignores `SIGHUP`, then `herdr server stop`: if it survives, the stop is `unknown` and names
it. RH-B: (6) `ao session kill`: `destroyed`; (7) the B-1 interleaving with a scratch hook between the checks and a second server:
`unknown`, the second server's pane lives; (8) a handoff, then a kill: `destroyed`; (9) a project-mode
orchestrator workspace with a linked worktree (operator `worktree create`): `unknown`, nothing closed; (10)
NM-3 with a real Claude Code, in a run the owner approves.

## 5. The reads outside RH: option (a), with the review r5 corrections

### 5.1 The F1 form

An `execFile` rejection with the numeric exit code 1 (no signal, not killed by the timeout), empty stdout, and
stderr that is exactly one line (one trailing `\n` allowed) that parses as a JSON object (not an array, not
null) with exactly the keys `id` and `error`, where `id` is **the measured ID of the command** (2.1) and
`error` is an object with exactly the keys `code` (a non-empty string) and `message` (a string). Its
`herdrCode` is `error.code`. Every other failure has no `herdrCode`: another exit code, a signal, a timeout,
stdout not empty, empty stderr, two lines, Rust debug text, a `result` key, another key, another `id` (also
`""` or another command's), `error` null, an array or without `code`. The 0.8.0 form (exit 0, the envelope
on stdout) stays accepted as the R4 contract. The CLI drops trailing server lines (`r5_b_pane_get_two_lines`),
so F1 trusts the CLI boundary; it does not qualify the wire frame.

### 5.2 Where it is used

`herdr()`, `herdrResult()`, `readPane()` (runtime-herdr) and `getHerdrPaneProcesses` (core). Only the failure
branch is classified: a successful `pane read` stays raw text. A wrapper error (`getPaneStrict`,
`herdrCannotAnswer`) copies `code` `RUNTIME_NO_SERVER_ERROR_CODE` to its own top level, because callers read
`err.code`, not the cause.

### 5.3 Rows 8 and 9 (new text)

- **Row 8**, third column: "`pane_not_found` as the `code` of herdr's error envelope, **either** on stdout with
  exit 0 and `result` absent or null (0.8.0) **or** in the F1 form with the ID `cli:pane:process_info` (0.9.5),
  for a pane ID in the grammar: `[]`. An empty pane ID: `[]` with no call." Fifth column, added: "a non-empty
  pane ID outside the grammar: reject with no call; the F1 form with `server_not_running` and the message
  prefix: reject with `RUNTIME_NO_SERVER_ERROR_CODE`; the F1 form with another code or another ID: reject."
- **Row 9**, third column: "False: `pane_not_found` as above on either channel, with the ID `cli:pane:get` for
  F1, for a pane ID in the grammar; or exit 0 and a `result` whose `pane` has the requested `pane_id` and a text
  `terminal_id` that is not the handle's non-empty `terminalId`." Fifth column, added: "an empty or
  non-grammar pane ID: reject with no call; the same no-server and other-code rules as row 8."
- Tests: the controls `closedpane_pane_process_info` (row 8 `[]`), `closedpane_pane_get` and `closedws_pane_get`
  (row 9 false); near misses: stdout not empty, two lines, exit 2, a signal, a `result` key, `id` `""`,
  `id` `cli:pane:get` on row 8, `error` null and an array, Rust `EACCES` text (`r5_c_socket_mode_000_cli`),
  `protocol_mismatch` (`r5_b_ping_protocol_19`); the code kept through `getPaneStrict` and through the lifecycle
  and `ao start`; the R4 near misses keep their oracles (`herdr.test.ts:163`, `:173`; `index.test.ts:449`,
  `:476`).
- The `isAlive` sentence of `CLAUDE.md`: "runtime-herdr `isAlive` likewise answers false only for the
  `pane_not_found` code of herdr's error envelope, on stdout at exit 0 (0.8.0) or in the exact stderr form at
  exit 1 with the command's ID (0.9.5), for a pane ID in herdr's grammar, or the requested pane with another
  terminal; a record with S answers from S (RH-A)".

### 5.4 The no-server code

Only exit 1, F1 with the command's ID, `code` `server_not_running` and a `message` that starts with `no herdr
server is running at ` give `RUNTIME_NO_SERVER_ERROR_CODE`. The CLI writes it for `ENOENT` and `ECONNREFUSED`
(`r5_path_base_pane_get`, `r5_c_missing_dir_cli`, `r5_c_stale_socket_file_cli`, `r5_c_regular_file_cli`).
`EACCES`, `protocol_mismatch`, signals, timeouts, extra output and other codes stay plain rejections. The code
means "no listener answers at the selected path", not "the launch ended": a hidden server can run.

### 5.5 Correction of an r5 evidence claim

r5 said that a server that sends `server_not_running` itself "passes too". The fixture
(`r5_b_pane_get_server_not_running_from_server`) has the message `fake server says so`, which fails the prefix
rule, so the mapper rejects it without the code. A fake server could copy the prefix; that is the same-uid
trust boundary (A-1), not a measured acceptance.

### 5.6 Why (a)

Unchanged from r5 and agreed by review r5: one small shared reader, one transport outside RH, every accepted
form measured, every other form fails closed. RH brings its own socket client (4.6) for the binding; whether
the reads move to it later is OQ-1.

### 5.7 The pins (M-3)

At create, before `workspace create`:

1. **The binary.** `binPath` absolute: normalize it and require an executable regular file. `binPath` a bare
   name (default `herdr`): search the absolute directories of the create process's `PATH` in order (skip empty
   and relative entries) for an executable regular file; keep that absolute path, without resolving symlinks.
   `binPath` relative with a slash: the plugin's `create(config)` warns, and every Herdr create fails with a
   message that names the setting (no guess from the cwd). Not found: the create fails before any herdr call.
2. **The endpoint.** `<herdrBin> status server --json` in the caller's environment: its `socket` must be an
   absolute path without control characters; the create fails otherwise.
3. `workspace create` and every later call for the handle run `herdrBin` with `HERDR_SOCKET_PATH=<herdrSocket>`
   in their environment: runtime-herdr, core `herdr.ts` (through the handle), the four agents' Herdr checks,
   and `ao session attach` (`session.ts:196-198`).

Per call: both keys present and absolute: use them. Neither key (every record before the fit round): today's
behavior, documented as environment-dependent. One key, or a key that is not an absolute path: reject with no
call, never a fall back to `PATH` or the caller's environment. A path pin is not a content or version pin: the
file at the path can change; RH still checks the server's ping (4.9). The pin names a path, not a server run.

### 5.8 The startup rule (M-4)

- **Old records.** A no-server rejection reads as "gone" at startup only for a runtime whose server holds all
  of its sessions (tmux: no server, no session). A new exported core constant
  `NO_SERVER_ENDS_SESSIONS_RUNTIMES = {"tmux"}` is used by core `isOrchestratorRuntimeAlive`
  (`session-manager.ts:562-584`) and by CLI `checkOrchestratorLiveness` (`start.ts:895-929`). For Herdr, the
  no-server code at startup is `unknown`: the record is kept, nothing is archived or created, and the message
  names the pinned socket ("start herdr at <socket>, or close and remove the session by hand"). The lifecycle
  keeps its outage rule (`NO_SERVER_BOUND_MS`), which is a status rule. Before RH-A, `pane_not_found` and a
  replaced terminal at a reachable pinned endpoint keep the R4 meaning "gone" (OQ-14). After RH-A, a record with
  S answers from S, and the no-server code never comes from it.
- **New creates.** The Herdr preflight runs in `ao start` only when an orchestrator will be created (not with
  `--no-orchestrator`), before any record change, with the binary and the endpoint that the create will pin
  (5.7 steps 1 and 2) and the project's runtime (`project.runtime ?? defaults.runtime`; today's `ensureTmux`
  reads only `defaults.runtime`, `start.ts:942`). It is a readiness check, not a proof of death. `ao spawn`
  uses the same parameterized check.
- **Direct core calls.** `spawnOrchestrator` holds the old-record rule itself, so a CLI-only preflight is not
  the only guard.

## 6. The fit round ("Herdr 0.9.5 fit"): F-1 to F-8

13 product files: core `herdr.ts`, `index.ts`, `types.ts`, `session-manager.ts`; `runtime-herdr/src/index.ts`;
the four agents' `src/index.ts`; CLI `send.ts`, `start.ts`, `session.ts`, `lib/preflight.ts`. Plus tests and the
docs (`docs/DEVELOPMENT.md`, `CLAUDE.md`, doc 0004). Each item has its own acceptance tests; F-4 to F-7 are
safety changes and are reviewed one by one.

| Item | Change | Files | Acceptance tests |
| --- | --- | --- | --- |
| **F-1** (W-1, W-2, W-6) | the F1 reader (5.1 to 5.4) in core, exported; used in the failure branches of runtime-herdr and core | core `herdr.ts`, `index.ts`; runtime-herdr | rows 8 and 9 tests of 5.3; the no-server code kept through `getPaneStrict`, `herdrCannotAnswer`, the lifecycle probe (two polls: "no-server") and `ao start` (Herdr: `unknown`, F-7); every F1 near miss rejects without a code; R4 near misses unchanged |
| **F-2** (W-8) | the pane ID grammar before any pane call; row 8 empty ID `[]` with no call; row 9 empty ID rejects with no call | runtime-herdr; core `herdr.ts` | zero `execFile` calls for `aohd-1`, `w1m:p1`, `wI:p1`, ` w1:p1`, `w1:p1 `; calls for `w1R:p1`, `w0:p1`, `w11:p13`, `w4:p0`; the lifecycle with a session-name handle makes no herdr call |
| **F-3** (W-3) | `blocked` at the gate, `blocked` seen in a settle or retry poll, or F1 `agent_blocked` at `agent prompt`: a typed `RuntimeSendRefusedError` (`reason` `agent_blocked`, `admitted` `none` or `earlier-attempt-unconfirmed`); no `send-text` fallback; no forced-restore retry in `send()`; `ao send` prints one line, exit 1; `blocked` leaves `SETTLED_STATES` | runtime-herdr (`:62`, `:447-477`); core `types.ts`, `session-manager.ts` (`:4005-4026`); CLI `send.ts` (`:356`) | blocked at the first gate: zero `agent prompt`, `send-text`, `send-keys`, `admitted: none`; blocked in a later poll after an earlier `agent prompt`: `admitted: earlier-attempt-unconfirmed`; the `blocked_herdr_agent_prompt` line: refusal, zero `send-text`; core: zero `restore`; CLI: exit 1, one line naming `agent_blocked`, no stack trace |
| **F-4** (W-5a, M-2) | the create cleanup closes nothing: a failed `pane run` after `workspace create` throws an error that names the workspace, pane, terminal and socket and the cause (the F1 code, or "transport failure: <first stderr line>"; no invented herdr code), with "AO did not close it; check it and close it by hand" | runtime-herdr (`:359-373`) | a failed `pane run` after a stand-in server replacement: zero `workspace close` and `pane close` calls; the error names all four resources; a Rust-text failure gives the transport text; a success unchanged |
| **F-5** (W-5b) | `destroy` throws the R2a refusal text and calls nothing | runtime-herdr (`:395-407`) | `destroy` rejects with zero calls for a workspace ID, a pane ID, an empty handle; the oracle changes of `index.test.ts:165-186` (three tests) and of the same-ID r2 N-1 control, approved in OQ-6; the stop's `unknown` control for legacy handles unchanged |
| **F-6** (M-3) | the pins of 5.7; core `herdr.ts` takes the handle; the four agents pass it; attach uses it | runtime-herdr; core `herdr.ts`, `index.ts`; agents claude-code (`:617`), codex (`:581`), gemini (`:194`), opencode (`:661`, `:1340`); CLI `session.ts` | `PATH` changed between create and a later call: the pinned binary runs; cwd changed with a relative `binPath`: no guess, the create fails; a legacy record (no keys): today's call; one key, a relative key, a key with a newline: reject with zero calls; every call of a pinned handle has `HERDR_SOCKET_PATH`; attach runs `herdrBin agent attach` with it |
| **F-7** (M-4) | the startup rule and the parameterized preflight of 5.8 | core `types.ts`, `index.ts`, `session-manager.ts` (`:562-584`, `:2509-2560`); CLI `start.ts`, `lib/preflight.ts` | a healthy caller endpoint and an unreachable pinned endpoint (a hidden live old server): the record unchanged, no new orchestrator, exit 1 with the socket named, in project and isolated mode, through the CLI and through a direct `spawnOrchestrator`; tmux no-server still "gone"; `--no-orchestrator` unchanged; no herdr server: the preflight stops before any record change; preflight uses the resolved binary and socket |
| **F-8** (W-7, W-9, comments) | `recent-unwrapped` comment (`index.ts:16-18`, `:479-482`: shell text in the measured case; the fallback on an error or an empty answer); ID comment (`:384-386`); `index.ts:94-97`; `herdr.ts:37`, `:91-92`; `lifecycle-manager.ts:214-222`; DEVELOPMENT.md rows 8 and 9; `CLAUDE.md` (5.3) | as named | review only |
| W-4 | later send round (OQ-5): from `done`, one attempt, no raw fallback, and "sent, not confirmed" that core's retry does not turn into a resend; `idle` resends keep a named duplicate risk | runtime-herdr, core, CLI `send.ts` | in that round |

## 7. Round plan and gates

| Round | Content | Risk | Size | Needs |
| --- | --- | --- | --- | --- |
| **Herdr 0.9.5 fit** | F-1 to F-8 | medium | **M**, 13 product files | R4 (landed); OQ-2, OQ-6, OQ-7, OQ-14 |
| **RH-A** | 4.2 to 4.6, 4.7 steps 1 to 3, 4.8 | medium (the liveness and the agent check of every Herdr session with S) | M (core `herdr-identity.ts` for the domain and the predicates, shared by core and the plugin; runtime-herdr `socket-client.ts`; runtime-herdr create, stop, `isAlive`; core agent check) | the fit round; OQ-3, OQ-4; `absent` also NM-3 and OQ-10 |
| **RH-B** | 4.7 steps 4 to 9, the create cleanup through the stop | high (a destructive request) | S | RH-A and its live checks; NM-1 (done); NM-3 and OQ-10; OQ-11, OQ-12; the RH-B tests and live checks |
| Herdr send (later) | W-4 | medium | S | a real-claude measurement of short turns |

Order inside each round: the production classifier tests first, then the isolated matrix, then the live
checks. Keep the no-handoff rule (OQ-9) for every record without S.

## 8. Doc 0004 (uncommitted)

- Section 1: "AO closes no Herdr workspace" now says "the stop of a Herdr session closes nothing", and names the
  two close paths that remain until the fit round: the create cleanup and the unused `destroy` (m-2).
- Section 5a: the `recent-unwrapped` sentence says that `getOutput` falls back on an error or on an empty or
  whitespace-only answer (m-2); "every CLI call is two connections" is stated for the measured pane
  operations (evidence claim 1).
- Section 1 and 5a: "every pane" and the handoff facts are stated for the measured sample; the counter
  grammar is measured through `w11` and `p13`, longer IDs are an extrapolation (review r5, doc 0004 assessment).
- Section 8: the only-pane close names the NM-1 exception (`confirmation_required`), the
  `linked_worktree_source` refusal, the project-mode orchestrator, a shell that exits by itself, and what a
  pane close ends (part I).
- Links name RH design r6; RH and the fit round stay designs, not built.

## 9. Measurements of this round (r6)

Only answers that steps 1 and 2 did not have. Isolation as the step 2 brief: marker `/tmp/aohd3-marker`
(`2026-10-22 18:59:35.148954275 -0400`), scratch root `/tmp/aohd3`, sessions `aohd3-1` and `aohd3-2`, no tmux
call, scratch `HOME` with a git identity in `.gitconfig` (written before any git call), scratch XDG
directories, the update checks off (`r6_setup/herdr-config.toml`), `GIT_CONFIG_NOSYSTEM=1`, a scratch `PATH` of
links (no `npx`, `npm`, `gh`, `tmux`, `curl`, `wget`; `git` and `ss` were linked for parts E and H), every
`herdr`, `python3`, `node` and `git` call under `env -i` (`r6_setup/run.sh`), every server under `strace -ff -e
trace=network,execve`, the driver's `git` calls under `strace -f -e trace=connect,socket`, the herdr client
calls through the shim. No `ao` command ran.

| Part | Script | What | Fixture |
| --- | --- | --- | --- |
| A | `r6_a_framing.py` | EOF after each answer kind; delayed writes; the idle close | `r6_a_framing_log` |
| C | `r6_c_race.py`, `r6_guard.mjs`, `r6_c2_held.py` | the B-1 interleaving on real restarts with the Node CG client (guarded, the r5 order, held); a held raw connection | `r6_c_race_log`, `r6_c_held_followup_log`, `r6_c_*_server_stop` |
| D | `r6_d_handoff.py` | LC across a live handoff; a held connection; the CG client | `r6_d_handoff_log` |
| E | `r6_e_nm1.py` | NM-1 on a primary at the repository root; `worktree create` from an AO-like workspace | `r6_e_nm1_log` |
| F, G | `r6_fg.py` | the pane counter through `p13`; the shell's environment, namespaces, `NSpid`; `/proc` mount and `statfs`; `exec sh`; a shell that exits | `r6_f_pane_counter_log`, `r6_g_proc_domain_log` |
| H | inline (in `r6_h_*`) | `exec bash`; `node:ffi`; the `ss` peer and holder | `r6_h_exec_and_tools_log`, `r6_h_ss_peer_log` |
| I | `r6_i_session.py`, `r6_i2_signals.py`, `r6_i3_setsid.py` | members of S's session at `pane.close`: two background jobs; a child that logs and ignores `HUP`, `TERM`, `INT`, `QUIT`, `USR1`; a child after `fork` and `setsid`; the server's `kill` calls (`strace -e kill`, with `-tt` for the last) | `r6_i_session_log`, `r6_i_signals_log`, `r6_i_signals_setsid_log`, `r6_logs/strace_summary_part_i.txt` |

`strace` (`r6_logs/strace_summary.txt`): 7 shim calls, every connect to a scratch socket; 731 server trace
files with 30 `AF_UNIX` sockets and no other family; zero non-`AF_UNIX` connects; outside `/tmp/aohd3` only the
local D-Bus system bus (8) and the local `nscd` socket (2); the driver's 8 `git` traces: no socket. Servers
(`r6_logs/pids.txt`): `aohd3-1` 642737, 659388, 659847, 660001 and 669211 each ended through `herdr server
stop` and were checked absent; 669304 ended in the handoff; its successor 677031 (parent 1, outside `strace`
from 19:03:38) ended through `herdr server stop`; `aohd3-2` 681160 ended through `herdr server stop`. Every
`strace` ended with its server.

Part I ran after the first cleanup, in a rebuilt minimal `/tmp/aohd3` with the same marker and the same rules
(`r6_logs/pids_part_i.txt`): servers `aohd3-3` 811572, `aohd3-4` 817019, `aohd3-5` 820719, each ended through
`herdr server stop` and checked absent; 186 trace files, 9 `AF_UNIX` sockets and no other family, zero
non-`AF_UNIX` connects, outside `/tmp/aohd3` only the D-Bus system bus (3). The `setsid` child 820767 that
part I started survived its pane, as the check expected; it logged and ignored `SIGTERM` from `kill 820767`
and ended on `kill -KILL 820767` (its exact PID, checked by its command line first).

## 10. Open questions for the owner

"Changed" marks a question that review r5 changed; "new" marks a question that r6 adds.

| OQ | Question | Options | Recommendation |
| --- | --- | --- | --- |
| OQ-1 | The reads outside RH | (a) the CLI with F1 (5.1); (b) the socket API | **(a)**, with the expected-ID check (unchanged; review r5 agrees) |
| OQ-2 (changed) | The pins | (a) in the fit round, with an absolute binary, partial pins rejected, legacy records named as environment-dependent; (b) in RH; (c) never | **(a)** |
| OQ-3 (changed) | The launch identity | (a) S with the recorded domain and the environment proof at create (4.2 to 4.4); (b) design r4's server incarnation | **(a)**. The binding of the close is a separate choice (OQ-11) |
| OQ-4 (changed) | RH-2 | (a) `isAlive` from S together with the bound agent check, in RH-A; (b) keep the terminal rule | **(a)**; RH-2 alone would bring back the false `killed` of review r5 M-5 |
| OQ-5 (changed) | W-4 | (a) a later send round: one attempt from `done`, no raw fallback, "sent, not confirmed" kept through core; the `idle` resend keeps a named duplicate risk; (b) keep; (c) `--wait` | **(a)** |
| OQ-6 (changed) | `destroy` and the create cleanup | (a) both refuse in the fit round (oracle changes of `index.test.ts:165-186` and the N-1 control; stray workspaces after a failed launch are named in the error); (b) only `destroy` | **(a)**; RH-B later routes the cleanup through the bound stop |
| OQ-7 (changed) | Startup | (a) the old-record rule of 5.8 in core and CLI, and the preflight with the pinned binary and endpoint; (b) the r5 preflight only | **(a)** |
| OQ-8 (changed) | Herdr in `AUTHORITATIVE_RUNTIMES` | (a) not now; (b) later, per handle with S, after RH-A's live checks | **(a)** |
| OQ-9 (changed) | No live handoff while AO Herdr sessions run | (a) the rule holds for every record without S, also after RH-A (old records and failed S reads); (b) drop it after RH-A | **(a)** |
| OQ-10 (changed) | R-H1, now narrowed: a descendant that left S's session (`setsid`, a daemon) and outlives it. Same-session survivors, also `SIGHUP`-ignoring ones, give `unknown` (4.5). It gates RH-A's `absent` and RH-B's `destroyed` | (a) accept after NM-3, with the guarantee written as "S and every process of S's session ended"; (b) also refuse while any process of AO's uid has its cwd inside the session's worktree (cheap; an owner shell in the worktree blocks too; unreadable cwds of non-dumpable processes are skipped and named); (c) check the agent process by name | **decide after NM-3**; then (a), or (a) with (b) if NM-3 shows Claude Code processes outside its session |
| OQ-11 (new) | B-1: the binding of the close | (a) a peer helper (`ss` or Python); (b) CG (3.4); (c) ask herdr for a conditional close; (d) refusal-only | **(b)** now; (c) as a request to herdr in parallel |
| OQ-12 (new) | R-H2, the CG residual: a deliberate same-uid listener under another path text, or an accept-then-stop with a file swap, inside one stop | (a) accept, as the same trust boundary as A-1 (a same-uid process can also close the pane itself); (b) add the `ss` peer check before each write where `ss` exists, and refuse the close where it does not; (c) keep RH-B off | **(a)** |
| OQ-13 (new) | Split RH into RH-A and RH-B with the gates of 4.1 | (a) yes; (b) one round | **(a)** |
| OQ-14 (new) | Before RH-A, at startup: `pane_not_found` or a replaced terminal at a reachable pinned endpoint | (a) "gone", the R4 rule (a hidden old server with a new server at the same path stays a named limit); (b) keep every Herdr record until RH-A | **(a)**; (b) would leave every Herdr orchestrator unknown after a herdr restart |

## 11. Deviations from the brief

- **D-1** `git` (part E) and `ss` (part H) were linked into the scratch `PATH`; the r5 run had neither. `git`
  is needed by `herdr worktree create` (NM-1), `ss` by the option comparison of B-1. The git identity was in
  the scratch `.gitconfig` before the first git call; no git call made a network connect (all traced).
- **D-2** The handoff successor 677031 ran outside `strace` (as in r5): a detached process with parent 1.
- **D-3** The control case c2 sent a destructive `pane.close` to a scratch server on purpose, to show the B-1
  race live. Scratch only.
- **D-4** The final process scan read the `environ` and `cmdline` of every process of my uid, also of real
  processes (read only, matched against the scratch name only).
- **D-5** `ss -x -p` reads the `fd` link names of every process of my uid to find holders (read only).
- **D-6** Part I ran after the first cleanup (I found the R-H1 question while I wrote section 4): I rebuilt a
  minimal `/tmp/aohd3` with the same marker and rules, ran it, and did the cleanup again.
- **D-7** Part I started a child that survives `pane.close` on purpose (`setsid`); I stopped it by its exact
  PID (820767), first with `SIGTERM` (which it ignores by design), then with `SIGKILL`. Part I's session scan
  read the `stat` files of all processes (read only).

## 12. Cleanup and the final checks

- Servers: each scratch server ended through `herdr server stop`, and each PID was checked absent (section 9).
  The scan of every process of my uid for `aohd3` in its environment or command line found only the scan's
  own shell.
- `/tmp/aohd3` was removed after each copy (32 MB, then 624 KB after part I); the marker `/tmp/aohd3-marker`
  stays.
- `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aohd3-marker` (without the lifecycle files) lists
  `6513108c38cb-Nexus/sessions` (19:17:40) with `nex-orchestrator` (19:17:40), `nex-2224` (19:04:39), `nex-2226`
  (19:11:10), `nex-2227` (19:03:09), and `60756641ca25-agent-orchestrator/sessions` with `ao-orchestrator`
  (19:03:26). None is mine: no `ao` command ran, and every scratch call had the scratch `HOME`.
- `find ~/.config/herdr ~/.local/share/herdr ~/.local/state/herdr ~/.cache/herdr -newer /tmp/aohd3-marker`: no
  output. `~/.ao/bin`: the same listing as at the start. The real lifecycle workers 4027448 and 4027591 still
  run; I did not touch them.
- `git status -s`: only this file, doc 0004, the new `r6_` fixtures and the `.agent_*` files;
  `git diff --exit-code -- packages` passes. `gitleaks detect --no-git` on the artifact folder: no leaks; no
  `r6_` fixture has a JSON field named `key` or `token`.
