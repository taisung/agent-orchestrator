# RH design r5: the Herdr stop on Herdr 0.9.5, and how AO reads 0.9.5 answers (ao-65)

Author: ao-65 (Claude Code, Opus 5.5), 2026-10-22, 17:55 to 18:40 EDT. Base `9846cf6a` (`main`). Step 2 of 3
of the owner's Herdr focus (answer "18a"; this author by answer "4 with ao-65").

Inputs: design r4 section 7 and its measurement h5 (`development/reviews/same_id_design_r4_opus.md`, called
"design r4"), review r4 M-4 (`development/reviews/same_id_design_review_r4_astra6.md`, "review r4"), the
owner decisions D-8 of `development/TODO_TRACKING.md` (OD-19 (a), OD-24 (a)), the R4 table "Absence forms of
the R4 reads" rows 8 and 9 (`docs/DEVELOPMENT.md`), the Herdr 0.9.5 live check
(`development/reviews/herdr_live_check_095_opus.md`, called "step 1"), and the code at `9846cf6a`.

This is a design. No file under `packages/` changed, and nothing was committed. Section 3 replaces design r4
section 7 (RH). Section 4 is the decision on how AO reads 0.9.5 answers outside RH. Section 5 is the fix plan
for W-1 to W-9 of step 1. All fixtures are in `development/artifacts/herdr_095_live_check/`: step 1 names have
no prefix, the names of this round start with `r5_` (section 7). A fixture `<name>` is `<name>.cmd` (command,
exit code, duration, stderr) with `<name>.json` or `<name>.txt` (stdout), or a `.txt` log.

## 0. Results

1. **RH r5 changes the launch identity.** Two facts that this round measured break the identity of design r4
   section 7.1:
   - **Node 25 has no call that reads the peer of a unix socket** (`r5_g_node_peer_api`: the only member of
     `net.Socket` with "peer" in its name is `_getpeername`, the path). The `SO_PEERCRED` read of design r4
     cannot be written in AO's language without a native addon or a helper process.
   - **A live handoff moves every pane to a new server process and gives every pane a new terminal ID, while
     the pane's shell keeps its PID and start ticks** (`r5_f_handoff_log`: server 56174 ended, server 59284
     serves, `w1:p1` stays `w1:p1`, terminal `term_65e752b0e435b1` became `term_65e752b14516d1`, the shell
     59278 kept its start ticks). `herdr update --handoff` names the same handoff in its usage text (not
     run). So design r4 ("another process, the recorded incarnation ended, `pane_info`: `other-launch`") and
     R4 row 9 ("another terminal: false") read a running launch as another launch or as gone after a handoff.

   RH r5 identifies a launch by **its pane shell process S = (PID, start ticks, boot ID)**, which AO reads at
   create. The negative evidence is "S ended", an exact `/proc` test, not a server answer. Each request of a
   stop is bound to one listening socket with `/proc/net/unix` (section 3.5), so no peer read is needed. The
   close is `pane.close` of the pane that shows S; `destroyed` needs S to end after the close.
2. **Review r4 M-4 is closed** point by point in section 1, each with a fixture. Two named measurements stay:
   NM-1 (`pane.close` of the only pane of a primary workspace that has a linked worktree workspace) and NM-3
   (a real Claude Code ends when its pane closes). RH reads both cases as `unknown` or depends on residual
   R-H1, so neither blocks the design.
3. **Qualified pair: herdr 0.9.5, protocol 22**, from the `ping` of the server behind the recorded socket at
   each stop. On another pair the stop answers `unknown` and closes nothing. "S ended" still answers `absent`,
   with no request to any server.
4. **Decision for the reads outside RH: option (a)**, the CLI with the error envelope read from stderr on exit
   1, accepted in one exact form (section 4.5), plus a pin of the socket and the binary per handle (4.7).
   `server_not_running` in that exact form maps to `RUNTIME_NO_SERVER_ERROR_CODE`. The CLI writes it only for
   `ENOENT` and `ECONNREFUSED` (`r5_c_*`); `EACCES` gives Rust debug text and stays a plain rejection.
5. **Fit round before RH** ("Herdr 0.9.5 fit"): W-1, W-2, W-6, W-8 (one exact reader and the pane ID check),
   W-3 (`agent_blocked`), W-5 (the create cleanup and `destroy`), the socket and binary pin, the Herdr preflight
   in `ao start`, and the comments W-7 and W-9. Size M (about 10 files), risk medium. W-4 (duplicate sends)
   goes to a later send round after a real-claude measurement. **RH needs only R2a and the fit round**; it does
   not need RW, R2b-1, R2b-2, R3a or R3b (section 3.13).
6. **Measured in this round** (section 7): the CLI's socket path order (`--session` > `HERDR_SOCKET_PATH` >
   `HERDR_SESSION` > `$XDG_CONFIG_HOME` > `$HOME/.config`); every CLI call is two connections (a `ping`, then
   the request); every CLI error form; `EACCES` and stale sockets; the 0.9.5 `invalid_request` forms; partial
   requests; the close forms over the socket; the environment of a pane; the peer executable after the binary
   is removed; one live handoff; `/proc/net/unix` after a socket rename.

## 1. Response to review r4 M-4

| M-4 point (review r4, line 194 to 211) | RH r5 answer | Evidence |
| --- | --- | --- |
| The ID check `^w[0-9]+:p[0-9]+$` rejects emitted IDs (`wA:p1`) | The check is the measured grammar `^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$`: bijective base 32 over `123456789ABCDEFGHJKMNPQRSTVWXYZ0` (`0` is the digit 32), uppercase only. Every non-empty string over these symbols is a counter value, so the class is the complete grammar of the counter, not a guess. It runs before any request (3.6, 4.5). `pane_not_found` alone is still no proof of a well-formed ID: herdr answers it for `not a pane`, a lowercase ID, `wI:p1`, `wL:p1`, a leading or trailing space | step 1 section 5.1 and `ids/` (workspaces 1 to 59, panes 1 to 15); `r5_d_socket_forms_log` (`d_pane_get_id_*`); step 1 `badid_*` |
| "Qualify the server's actual complete grammar (including the pane counter)" | The pane counter uses the same symbols per workspace (`w4:p1` to `w4:pF`); a reused workspace ID starts its panes at `p1` again. The terminal ID is `term_` + 13 hex digits of the creation time in microseconds + the terminal counter of the server run in hex (`^term_[0-9a-f]{14,}$`) | step 1 sections 5.1 and 5.3 |
| The executable and version qualification | The stop checks the `ping` answer of the server behind the recorded socket: `version` `"0.9.5"` and `protocol` `22` exactly, else `unknown` (3.9). The binary path is no proof: after the binary file is removed, the server still answers 0.9.5/22, `/proc/<pid>/exe` ends in ` (deleted)`, and `status server --json` keeps `server_binary_stale: false`. After a handoff the server runs the `import_exe` path. The CLI checks only the protocol: 0.9.4 with protocol 22 passes, protocol 19 gives `protocol_mismatch`. AO's two binaries differ today (core `herdr.ts:73` runs `herdr` from `PATH`, runtime-herdr runs `binPath`); the fit round pins one binary per handle (4.7). The production classifier is the code under test, not a copy of h5 (3.14) | `r5_e_exe_log`, `r5_e_status_json_copy_removed`, `r5_f_handoff_log`, `r5_b_ping_version_0_9_4`, `r5_b_ping_protocol_19` |
| h5 is weaker than its table: any `OSError` on `/proc` read as "gone"; a different peer with an unknown error read as absent; the no-connection branch broader than `ENOENT`/`ECONNREFUSED` | No catch-all. The only negative is "S ended", with an exact predicate (3.4): `ENOENT` or `ESRCH` on `/proc/<pid>/stat`, state `Z` or `X`, other start ticks, or another boot ID. Every other `/proc` error is `unknown`. No connection result and no server answer is ever a negative in r5 | 3.4, 3.7 table |
| `EACCES` | `unknown`. Measured: a socket file with mode 000 and a directory without search permission give `EACCES` (errno 13) to a raw client; the CLI prints `Error: Os { code: 13, kind: PermissionDenied, ... }` (not JSON) | `r5_c_socket_mode_000_cli`, `r5_c_dir_no_search_cli`, `r5_d_eacces_cli_pane_get`, `r5_d_socket_forms_log` (`d_eacces_socket_mode_000`) |
| Malformed and partial answers | `unknown` (3.6): no newline before EOF, a second line, more than 64 KiB, not UTF-8 or not JSON, not an object, an `id` that is not the request's, both `error` and `result`, an `error` that is not an object or has no text `code`, a result of another `type`, a missing or mistyped field. Measured server side: a request without a newline gets no answer (EOF); a second request on one connection resets it; an empty line closes it. Measured CLI side: a partial or non-JSON answer gives Rust debug text, a closed connection gives `EmptyResponse`, no answer makes the CLI wait without a limit | `r5_d_socket_forms_log` (`d_partial_*`, `d_two_requests_one_connection`, `d_empty_line`); `r5_b_pane_get_partial`, `_garbage`, `_close_no_answer`, `_hang`, `_two_lines` |
| Missing fields, unrecognized errors | `unknown`, and no close before C3 (3.7). Measured codes on AO's paths: `pane_not_found`, `workspace_not_found`, `agent_not_found`, `agent_blocked`, `workspace_group_close_required`, `invalid_request` (with `"id":""` when the request has no readable `id`), and the CLI codes `server_not_running` and `protocol_mismatch` | step 1 section 4.1; `r5_d_socket_forms_log`; `r5_b_ping_protocol_19` |
| Nonexistence versus unreadability | 3.4: only `ENOENT` and `ESRCH` mean "no such process"; `EACCES`, `EIO`, a line that does not parse, a missing boot ID file: `unknown` | 3.4 |
| Peers that change on each of the three connections | Each step checks the listening socket at the recorded path before and after each connection (3.5): the same socket file inode and exactly one `LISTEN` entry with the same socket inode. A restart, a second server bound at the path after a rename, a stop, or a handoff during a step changes one of them, and the step answers `unknown`. Measured: after a rename and a new bind, `/proc/net/unix` lists two `LISTEN` entries with the path | `r5_g2_rename_and_cost`, `r5_g_listener_after_handoff` |
| "Test the exact production parser" | 3.14 lists the tests; they run the production modules against a stand-in socket server and an injected `/proc` | 3.14 |

## 2. The 0.9.5 facts this design uses

### 2.1 The CLI

- **Two connections per call.** The CLI first sends `{"id":"api-client:status","method":"ping","params":{}}` on
  its own connection, then the request on a second one (`r5_b0_requests_log`, `r5_b_cli_forms_log`). The
  request IDs are `cli:<group>:<command>` (`cli:pane:get`, `cli:pane:process_info`, `cli:workspace:close`) or
  `cli:request` (`pane send-text`, `send-keys`, `run`). The CLI checks no peer, so the two connections can reach
  two servers.
- **The requests of AO's calls** (`r5_b_req_*`): `pane run <p> <cmd...>` is `pane.send_input {pane_id, text:
  "<cmd...>", keys: ["Enter"]}` (it types into the pane); `workspace create` is `workspace.create {cwd, focus:
  false, label, env: {...}}`; `workspace close <w>` sends `{workspace_id}` with no `close_group`, and `--group`
  adds `close_group: true`; `pane close` is `pane.close {pane_id}`; `agent prompt` is `agent.prompt {target,
  text}`; `pane read` adds `format: "text"` and `strip_ansi: true`.
- **The CLI's answer forms** (fake server at `HERDR_SOCKET_PATH`, real 0.9.5 client):

| Server answer or transport state | Exit | stdout | stderr | Fixture |
| --- | --- | --- | --- | --- |
| a `result` | 0 | the line, keys sorted by the CLI | empty | `r5_b_pane_get_result` |
| an `error` object (any code) | **1** | empty | one line `{"error":{"code":...,"message":...},"id":"cli:pane:get"}` | `r5_b_pane_get_pane_not_found`, `_unknown_code` |
| `error` and `result` | 1 | empty | one line with `error`, `id` and `result` | `r5_b_pane_get_error_and_result` |
| `error` that is not an object; `error` without `code` | 1 | empty | one line, passed through | `r5_b_pane_get_error_not_object`, `_error_no_code` |
| neither `error` nor `result` | 0 | the line | empty | `r5_b_pane_get_no_result_no_error` |
| a result for another pane, another `id` | 0 | the line, unchecked | empty | `r5_b_pane_get_other_pane`, `_wrong_id` |
| two lines | as the first line | | | `r5_b_pane_get_two_lines` |
| not JSON; a partial line; a close without an answer | 1 | empty | `Error: Custom { kind: Other, error: Json(Error("...")) }`, `Error: Custom { kind: Other, error: EmptyResponse }` | `_garbage`, `_partial`, `_close_no_answer` |
| no answer | none: the CLI waits (killed by the capture at 45 s) | | | `r5_b_pane_get_hang`, `r5_b_ping_hang` |
| `ping` answers protocol 19 | 1 | empty | `{"id":"cli:pane:get","error":{"code":"protocol_mismatch",...}}`, made by the CLI; no request is sent | `r5_b_ping_protocol_19` |
| `ping` answers 0.9.4, protocol 22 | the request runs | | | `r5_b_ping_version_0_9_4` |
| `ping` answers an error envelope, garbage, or closes | 1 | empty | Rust debug text | `r5_b0_*`, `r5_b_ping_garbage`, `r5_b_ping_close` |
| no socket file; a missing directory | 1 | empty | `{"id":"cli:pane:get","error":{"code":"server_not_running","message":"no herdr server is running at <socket>; run ... to start or attach it"}}`, made by the CLI | `r5_path_base_pane_get`, `r5_c_missing_dir_cli` |
| a stale socket file; a regular file (`ECONNREFUSED`) | 1 | empty | the same `server_not_running` line | `r5_c_stale_socket_file_cli`, `r5_c_regular_file_cli` |
| `EACCES` (socket mode 000; a directory without search) | 1 | empty | `Error: Os { code: 13, kind: PermissionDenied, message: "Permission denied" }` | `r5_c_socket_mode_000_cli`, `r5_c_dir_no_search_cli`, `r5_d_eacces_cli_pane_get` |
| a server that answers `server_not_running` itself | 1 | empty | the code passed through (keys in sorted order: `error` before `id`) | `r5_b_pane_get_server_not_running_from_server` |

  The CLI's own envelopes put `id` first; the relayed ones put `error` first. AO must not depend on key order.

- **The socket path order** (`r5_path_*`; no server ran): `--session <n>` gives
  `$XDG_CONFIG_HOME/herdr/sessions/<n>/herdr.sock` and wins over everything; then `HERDR_SOCKET_PATH`; then
  `HERDR_SESSION` (the session path); then `$XDG_CONFIG_HOME/herdr/herdr.sock`; without `XDG_CONFIG_HOME`,
  `$HOME/.config/herdr/herdr.sock`. `HERDR_HOME`, `HERDR_CONFIG_PATH`, `HERDR_ENV` and `HERDR_PANE_ID` do not
  change the socket. `herdr status server --json` exits 0 with and without a server and names the `socket`
  (`r5_path_base`, `r5_d_status_server_json_running`).
- **Every pane has the socket in its environment** (`r5_d_pane_env`): `HERDR_SOCKET_PATH`, `HERDR_SESSION`,
  `HERDR_BIN_PATH`, `HERDR_ENV=1`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID`. So an `ao` command
  that runs inside a herdr pane talks to that pane's server, and an `ao` command in a plain terminal talks to
  the default socket. Today AO records no socket, so two `ao` processes with different environments read two
  servers for one record.

### 2.2 The socket API

- Unchanged since 0.8.0: one JSON request line per connection, one answer line, the error in the answer
  (`r5_d_socket_forms_log`; step 1 `sock_*`).
- `invalid_request` forms on 0.9.5: no `params` ("missing field `params`"), empty `params` ("missing field
  `pane_id`"), a number as `pane_id`, an unknown method, no `method`; not JSON, no `id`, or a number as `id`
  answer with `"id":""`. An empty line closes the connection with no answer. Extra fields are ignored. A list
  as `params` is read as the struct (`["w1:p1"]` answered `pane_not_found` for `w1:p1`).
- Partial requests: a request without the newline, followed by a write shutdown, gets no answer (EOF); so does
  a cut JSON text. Two requests on one connection reset the connection.
- The closes (`r5_d_socket_forms_log`): `pane.close` of a second pane answers `{"type":"ok"}`, again
  `pane_not_found`; `workspace.close {workspace_id, close_group: false}` answers `ok`, again
  `workspace_not_found`; `pane.close` of the only pane answers `ok` and the workspace is gone
  (`workspace_not_found`), as step 1 section 6.3 measured with the CLI.
- `pane.process_info` answers `{pane_id, shell_pid, foreground_process_group_id, foreground_processes: [{pid,
  name, argv, cmdline, cwd}]}`; no `tty` and no terminal ID.

### 2.3 The server process

- `SO_PEERCRED` gives the server PID in Python (`r5_d_socket_forms_log`: peer 4158055 on every connection),
  but Node 25 has no such call (`r5_g_node_peer_api`).
- `/proc/net/unix` lists the listening socket of the path with the `LISTEN` flag; exactly one process holds
  it, the server; the pane shells do not hold it (`r5_g_listener_after_handoff`). The kernel keeps the bind
  path: after a rename of the socket file and a new bind at the same path, two `LISTEN` entries carry the path
  (`r5_g2_rename_and_cost`). One read of `/proc/net/unix` (1054 lines) took 0.65 ms.
- The binary: see section 1, the executable row.
- **The live handoff** (`r5_f_handoff_log`): `server.live_handoff {import_exe, expected_version,
  expected_protocol}` answered `ok`. Then a new process (59284, parent 1, `herdr server --handoff-import ...`,
  executable the `import_exe` copy) served the same socket path; the old server (56174) had ended; the pane
  kept its ID `w1:p1`; its terminal ID changed; its shell (59278) kept its PID and start ticks. The `ping` of
  the new server answers `detached_server_daemon: true` (the first server answered `false`).
- After a restart (step 1 section 5.3): the same workspace, pane and tab IDs, **new terminal IDs and new pane
  shells** (the agents end with the old server), and the workspace counter starts at the highest open ID plus
  one, so the IDs of closed workspaces above it come back.

## 3. RH r5 (replaces design r4 section 7)

### 3.1 Scope

RH stays optional (OD-19 (a), decided): until RH lands, the Herdr `stop` answers `unknown` and closes nothing
(`index.ts:418-433`). RH r5 has two parts and one optional part:

- **RH-1, the bound stop** (3.2 to 3.7).
- **RH-2, liveness from S** (3.8): `isAlive` of a record with S reads S, not the terminal ID.
- **RH-3 (optional), the bound agent check** (3.8): the process list of a pane counts only for processes in
  S's session.

### 3.2 The launch identity S and the record

S is the shell that herdr starts in the root pane of the workspace that AO creates. AO's launch command runs
as a child of S (`pane run` types `bash <script>` into the pane), so the agent is in S's terminal session.
S lives as long as the pane's terminal: a pane close, a server stop and a restart end it (step 1 section 5.3:
the restored panes run new shells); a live handoff keeps it (`r5_f_handoff_log`).

New keys in the runtime handle data (`handle.data`), written by `create` (the record publishes the handle as
today):

| Key | Value | Round |
| --- | --- | --- |
| `herdrSocket` | the absolute socket path that the create used (4.7) | fit round |
| `herdrBin` | the herdr binary path that the create used (4.7) | fit round |
| `herdrShell` | `{ pid, startTicks, bootId }`: the PID (a positive safe integer), field 22 of `/proc/<pid>/stat` as decimal text, `/proc/sys/kernel/random/boot_id` | RH |
| `herdrQualified` | `"0.9.5/22"`, the pair of the create's `ping` (a diagnostic) | RH |

`paneId`, `workspaceId` and `terminalId` stay as today. A record without `herdrShell` (every record before RH,
and a create that could not bind S) keeps today's behaviour: its stop answers `unknown` with the R2a text.

### 3.3 The create: how AO reads S

After the CLI `workspace create` (pinned to the socket, 4.7) returned the root pane ID P and terminal ID T, and
**before** `pane run`:

1. Listener check LC0 on the recorded socket (3.5).
2. C0 `ping`: the exact `pong` with `version` `"0.9.5"` and `protocol` `22`.
3. C1 `pane.get {pane_id: P}`: a `pane_info` result for P with `terminal_id` T. T is new (the terminal counter
   and the microsecond time of this create), so the server behind the socket is the one that made the pane.
4. C2 `pane.process_info {pane_id: P}`: a `pane_process_info` result for P with a positive safe-integer
   `shell_pid`.
5. C3 `pane.get {pane_id: P}` again: T again.
6. LC after each connection equals LC0.
7. `/proc/<shell_pid>`: owned by AO's uid; `/proc/<shell_pid>/cwd` resolves to the real path of the
   workspace (the shell starts in `--cwd`; this also proves that AO and herdr see the same PID namespace); read
   the start ticks and the boot ID.

All steps pass: AO records `herdrShell` and `herdrQualified`. Any step fails: AO records neither, logs one line
with the reason, and the create goes on (the session works without RH; its stop stays `unknown`). Measured:
`process_info` answers the shell at once after the create (`r5_d_socket_forms_log`, `d_pane_process_info_root`:
`sh`, PID 4162344, cwd the workspace).

### 3.4 The predicate "S ended"

Read `/proc/sys/kernel/random/boot_id` and `/proc/<S.pid>/stat`. Parse the stat line after its **last** `)`
(the command name can hold spaces and brackets): the first field is the state, the 20th the start time.

| Read | Result |
| --- | --- |
| the boot ID differs from `S.bootId` | **ended** (the host restarted) |
| `/proc/<pid>/stat`: `ENOENT` or `ESRCH` | **ended** (no such process) |
| the state is `Z` or `X` | **ended** (the shell exited) |
| the start time differs from `S.startTicks` | **ended** (the PID now names another process) |
| the start time equals `S.startTicks` and the state is another letter | **runs** |
| any other error (`EACCES`, `EIO`, an unreadable boot ID, a line that does not parse) | **unknown** |

A PID alone never decides: a reused PID has other start ticks.

### 3.5 The listener check (replaces the peer read of design r4)

`LC(path)` reads, in this order:

1. `lstat(path)`: a socket file owned by AO's uid. Keep its `(dev, ino)`. `ENOENT`, `EACCES`, not a socket,
   another owner: **fail**.
2. `/proc/net/unix`: the entries whose path field (everything after the seventh field) is `path`. Exactly one
   entry with the `LISTEN` flag (`0x00010000`): keep its socket inode L. None, or two or more: **fail**
   (`r5_g2_rename_and_cost`: a renamed socket keeps its bind path, so a second server at the path gives two
   entries).
3. Diagnostic only: the processes of AO's uid that hold `socket:[L]` in `/proc/<pid>/fd` (measured: the
   server alone). It is not a gate, because the `fd` directory of a non-dumpable process of the same uid cannot
   be read.

`LC` is the pair `((dev, ino), L)`. A step is bound when `LC` before its connection equals `LC` after its
answer. The path is compared as the exact text of `herdrSocket`: the kernel prints the path that the server
passed to `bind`, and the CLI's `socket` field and the server use the same resolution, so the two texts match
(`r5_g_listener_after_handoff`). A server that bound another spelling of the path (a symlinked directory, a
relative path) makes step 2 find no entry, and LC fails closed. A restart, a stop, a handoff (if the
successor binds again), a second server after a rename, and a socket file moved onto the path all change `LC`
between two reads. Residual R-H2 (3.12): a same-uid process
that swaps socket files twice inside the microseconds between a check and a `connect` is not seen; the
`SO_PEERCRED` read of design r4 had no such window, and Node cannot do it (section 0).

### 3.6 The socket client and the answer reader

One request per connection, design r3 section 8.7. Per connection: `connect` with a 2 s limit, write one line
`{"id":"ao-rh-<n>","method":...,"params":{...}}`, read until the first newline with a 2 s limit and a 64 KiB
cap, then close. An answer counts only when:

- it ends with one newline and nothing follows it before EOF;
- it is UTF-8 JSON, an object, with `id` equal to the request's `id`;
- it has exactly one of `result` (an object) and `error` (an object with a text `code` and a text `message`);
- the `result` has the expected `type` (`pong`, `pane_process_info`, `ok`) and the fields of 3.7 with the
  right types.

Everything else is **no answer** (`unknown`): `ENOENT`, `ECONNREFUSED`, `EACCES`, any other connect error, a
timeout, EOF before the newline, a second line, more than 64 KiB, a parse error, a wrong `id`, both or neither
of `result` and `error`, an `error` that is not an object or has no text `code`, another `type`, a missing or
mistyped field. Before any request AO checks the record: the pane ID matches
`^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$`, `herdrSocket` is an absolute path, and `herdrShell` has a
positive safe-integer `pid`, a decimal `startTicks` and a boot ID of 36 characters. A record that fails is
`unknown` with no request.

### 3.7 The stop

Steps:

1. The record checks (3.6). Fail: `unknown`, no request.
2. "S ended" (3.4). **Ended: `absent`**, with the evidence that names the test ("the pane shell 59278 of this
   launch ended: no such process"). No request, no close. Unknown: `unknown`.
3. S runs. `LC0` on `herdrSocket` (3.5). Fail: `unknown` ("no single listening herdr server at <path>, while
   the shell <pid> of this launch still runs; nothing was closed").
4. C1 `ping`: the exact `pong` with `version` `"0.9.5"` and `protocol` `22`; `LC` equal. Else `unknown`.
5. C2 `pane.process_info {pane_id}`: a `pane_process_info` result whose `process_info.pane_id` is the
   recorded pane ID and whose `shell_pid` is `S.pid`; `LC` equal; then "S ended" again gives "runs" (the
   shell is still the recorded process). Else `unknown`, no close.
6. C3 `pane.close {pane_id}` (never `workspace.close`, never `close_group`): `{"type":"ok"}`, or the error
   `pane_not_found` (someone closed the pane between C2 and C3); `LC` equal. Another answer: `unknown`.
7. Poll "S ended" every 100 ms for up to 5 s. Ended: **`destroyed`** after `ok`, **`absent`** after
   `pane_not_found` (the pane closed before the close request). Still runs: `unknown` ("the close of <pane>
   did not end its shell <pid>").

The outcomes:

| Situation | Outcome | Requests | Close |
| --- | --- | --- | --- |
| the record fails a check of 3.6 | `unknown` | none | no |
| S ended (3.4) | `absent` | none | no |
| the S read is unknown | `unknown` | none | no |
| S runs; LC0 fails (no socket file, `EACCES`, not a socket, no `LISTEN` entry, two `LISTEN` entries) | `unknown` | none | no |
| S runs; C1 connect fails, no answer, or not the exact `pong` 0.9.5/22 | `unknown` | `ping` | no |
| C2 shows the pane with S | go on | | |
| C2 shows the pane with another shell | `unknown`: S runs on another server (a hidden server or a moved socket, OD-24) | `ping`, `process_info` | no |
| C2 answers `pane_not_found` | `unknown`: S runs, and the server at the path does not hold the pane (OD-24) | `ping`, `process_info` | no |
| C2 any other answer, or no answer | `unknown` | `ping`, `process_info` | no |
| LC differs after C1 or C2 | `unknown` | as sent | no |
| C3 `ok`, LC equal, S ends within 5 s | `destroyed` | + `pane.close` | yes |
| C3 `pane_not_found`, LC equal, S ends within 5 s | `absent` (closed before the request) | + `pane.close` | no effect |
| C3 `ok` or `pane_not_found`, S still runs after 5 s | `unknown` | + `pane.close` | sent |
| C3 another code (`workspace_group_close_required`, `invalid_request`, an unknown code) or no answer | `unknown` | + `pane.close` | sent, not confirmed |
| LC differs after C3 | `unknown` ("the close may have reached another server") | + `pane.close` | sent |

RH r5 never answers `other-launch`. When S ended, the launch ended, so `absent` is right even if the pane ID now
names another launch (a restored pane, or a workspace ID that came back after a restart); RH sends nothing to
that pane.

### 3.8 Liveness from S (RH-2) and the bound agent check (RH-3)

- **RH-2.** `isAlive` of a record with `herdrShell` reads only "S ended": runs gives `true`, ended gives
  `false`, unknown rejects. No herdr call. This is correct after a live handoff (S runs, the terminal ID
  changed), on a hidden server (S runs), after a restart (S ended), and for a reused pane ID (the record's S
  ended). `true` says that the pane's terminal lives; the agent check says whether the agent runs, as with tmux.
  A record without `herdrShell` keeps the CLI forms of section 4.5. Not in RH-2: the lifecycle keeps herdr
  out of `AUTHORITATIVE_RUNTIMES` (OQ-8).
- **RH-3 (optional).** For a record with `herdrShell`, core `getHerdrPaneProcesses` keeps a listed foreground
  process only when field 6 of its `/proc/<pid>/stat` (the session ID) is `S.pid`; a listed process of another
  session makes the answer "another launch": the agent check rejects. This fixes step 1 section 5.4: the
  process list of the reused pane `w1P:p1` named the claude of `aohd-4`, so the agent check of the old record
  `aohd-3` alone would answer "running"; AO stayed right only because every caller checks `isAlive` first. A
  process that left S's session (`setsid`) is not seen: residual R-H1.

### 3.9 Version and protocol

- **Qualified pair: `0.9.5` / `22`** (step 1 section 2; `r5_d_socket_forms_log` `d_ping`). The stop (C1) and
  the create (C0) check it on the server behind the recorded socket, under the same LC as the following
  requests.
- **Another pair:** the create records no S, so the session keeps today's behaviour; the stop of a record with
  S answers `unknown` and closes nothing, except that "S ended" still answers `absent` with no request; RH-2
  reads `/proc` only and does not depend on the version.
- **The CLI reads** of section 4: the CLI itself refuses another protocol (`protocol_mismatch`, a rejection,
  `r5_b_ping_protocol_19`). Another version with protocol 22 passes the CLI (`r5_b_ping_version_0_9_4`); then
  only the exact forms of 4.5 count, and any other form rejects.
- **To qualify a new pair:** repeat the step 1 matrix, parts B, D and F of this round (section 7), and the RH
  live checks (3.15) on the new version, then add the pair. No pair is added from the version number alone.

### 3.10 Close semantics

- The only close is `pane.close {pane_id}` of the pane that showed S on C2. A `pane.close` of the only pane
  of a workspace closes the workspace too, with no question (step 1 section 6.3, `r5_d_socket_forms_log`
  `d_pane_close_only_pane`), so for AO's one-pane workspaces it is the workspace close. When the operator split
  the AO workspace, the other panes stay and only the agent's pane closes.
- **Never `close_group: true`.** It closes the operator's linked worktree workspaces (step 1 section 6.1).
  RH never sends `workspace.close`.
- `workspace_group_close_required` as the answer of C3: `unknown`. NM-1: whether a `pane.close` of the only
  pane of a primary workspace with a linked worktree workspace answers this code or closes; not measured. RH
  is right in both cases (the answer is `unknown`, or the close ends S and the result is `destroyed`).

### 3.11 Restart, workspace ID reuse and handoff

| Event | What happens to the old record | Evidence |
| --- | --- | --- |
| herdr restart (stop, start) | S ended (the old pane shells end with the server): stop `absent`, no request; `isAlive` false | step 1 section 5.3, `restart_*` |
| a closed workspace's ID comes back after a restart, with a new claude in it | the old record's S ended: stop `absent`, no request, the new session's pane is never addressed; RH-3: the new claude is in another session | step 1 section 5.4, `falsealive_*` |
| live handoff (the API call; `herdr update --handoff` by its usage text, not run) | S runs; the successor shows the pane with S: the stop closes it (`destroyed`); `isAlive` true | `r5_f_handoff_log` |
| a handoff during a stop | LC changes, or the C2 answer is from the old server and C3 reaches the new one with a new LC: `unknown`; a retry after the handoff works | 3.5 |

The server incarnation of design r4 is no longer part of the evidence: S belongs to the launch, not to the
server, so it covers the restart (S ended) and the handoff (S runs) with one rule.

### 3.12 OD-24 and the residuals

- **OD-24 (decided (a)) narrowed.** A moved or hidden socket gives `unknown` only while S runs (the session is
  kept until the owner fixes the socket). When S ended, the stop answers `absent` without the server, so a
  hidden server no longer blocks a session whose launch ended.
- **R-H1.** A descendant of S that outlives S (it ignores `SIGHUP`, calls `setsid`, or forks into the
  background) is not seen: S ended gives `absent`, and AO may remove the worktree under it. This is the same
  class as tmux `kill-session` and as the narrowed guarantee of OD-14. NM-3: a real Claude Code ends when its
  pane closes (the stand-in cannot prove it; it needs an owner-approved run).
- **R-H2.** A same-uid process that swaps socket files twice inside the window between an LC read and a
  `connect` can direct one request to another server (3.5). Same trust boundary as OD-23. If that request is
  C3, a pane of another server with the same pane ID can close.
- **R-H3.** A stop step that meets a handoff answers `unknown` (3.11).
- **R-H4.** AO in another PID namespace than herdr (a container): the cwd check of 3.3 fails, no S is recorded,
  the stop stays `unknown` as today.
- **R-H5.** A pane that the operator moves to another workspace may get another pane ID (`pane.move`; not
  measured). While S runs, C2 then finds no pane with S under the recorded ID, and the stop answers `unknown`;
  RH-2 still answers `true`. The operator closes such a pane by hand.

### 3.13 What RH needs from RW, R2b and R3

| Round | Does RH need it? | Why |
| --- | --- | --- |
| R2a (landed) | yes | the `stop` contract and its callers: only `destroyed` and `absent` let a caller remove the worktree or archive the record; the launch-identity compare-and-set of the record |
| Herdr 0.9.5 fit (section 6) | yes | the socket and binary pin (`herdrSocket`, `herdrBin`), the exact reader, the pane ID check, `destroy` refuses (no unbound close path is left) |
| RW (the shell writers' inbox, launch ID) | no | RH writes only handle data, from Node core, in the create's publish. RH does not use the launch ID |
| R2b-1 (tmux token guard; "runtime-herdr `destroy` refuses") | no | the Herdr part moves into the fit round (F-5). The tmux launch token has no Herdr counterpart; S has its role: it is made by the system, unique per boot, and checked at each step |
| R2b-2 (association of legacy records) | no | a record without S keeps the R2a stop (`unknown`); RH adds no association. An owner who wants old Herdr records stopped closes them by hand, as today |
| R3a (one operation per ID) | no | two stops of one record: the second finds S ended (`absent`). A stop and a restore: R2a's restore runs the stop first, and the stop closes only the pane with the record's S, never the new launch's pane |
| R3b (OpenCode holds) | no | unrelated to the runtime close |
| Claims or records beyond the handle | no | |

So RH can follow the fit round directly; the order R2a, R4, RW, R2b-1, R2b-2, R3a, R3b does not gate it.

### 3.14 Tests of the RH implementation

New file `packages/plugins/runtime-herdr/src/__tests__/rh.test.ts`. A stand-in server is a real unix socket
server in the test (in the test's temporary directory) that answers lines copied from the fixtures
(`r5_d_socket_forms_log`, step 1 `sock_*`) and records every request. `/proc` reads go through an injected seam
(`readStat`, `readBootId`, `readCwd`, `readNetUnix`, `lstat`). The production modules run unchanged. Every
`unknown` case asserts zero `pane.close` requests unless the table of 3.7 says one was sent.

1. Healthy stop: S runs, `pong` 0.9.5/22, `process_info` with S, `ok`, S ends: `destroyed`; exactly one
   request `pane.close {pane_id}`; zero `workspace.close`; no `close_group` in any request.
2. S ended before the stop: `ENOENT`; `ESRCH`; state `Z`; other start ticks; other boot ID: `absent`, zero
   requests, the evidence names the test.
3. The S read fails: `EACCES`; `EIO`; a stat line that does not parse; a missing boot ID: `unknown`, zero
   requests.
4. **A reused workspace ID with a new claude in it** (`falsealive_*`): the old record's S ended, the pane ID
   shows a new shell with a claude: `absent`, zero requests to that pane. The same with S still running (the
   stand-in shows another shell): `unknown`, zero close.
5. Hidden server: S runs, the server at the path answers `pane_not_found`: `unknown`, zero close.
6. LC: no socket file; `EACCES` on `lstat`; not a socket; no `LISTEN` entry; two `LISTEN` entries (the rename
   case); `/proc/net/unix` unreadable: `unknown`, zero requests.
7. LC changes between: LC0 and C1; C1 and C2; C2 and C3 (each of: socket file inode, L): `unknown`, zero close;
   after C3: `unknown`, one close sent.
8. C1: protocol 19; version 0.9.4; a `pong` without `version`; `error`; no answer: `unknown`, zero close.
9. Every malformed answer at C1, C2 and C3: not JSON; EOF before the newline; two lines; more than 64 KiB;
   empty; a timeout; another `id`; `error` with `result`; `error` not an object; `error` without `code`;
   `process_info` without `shell_pid`; `shell_pid` 0, negative, a float, text; `process_info.pane_id` of
   another pane; a result of another `type`: `unknown`; zero close at C1 and C2.
10. C3 answers: `pane_not_found` and S ends: `absent`; `workspace_group_close_required`: `unknown`;
    `invalid_request`: `unknown`; an unknown code: `unknown`; `ok` and S still runs after 5 s: `unknown`.
11. After a handoff (the holder diagnostic changes between create and stop, LC0 is new but stable through the
    stop, `process_info` shows S): `destroyed`.
12. The record checks: a pane ID outside the grammar (`aohd-1`, `w1m:p1`, `wI:p1`, ` w1:p1`); a relative
    `herdrSocket`; `herdrShell` with PID 0, ticks with a letter, a short boot ID; no `herdrShell` (the R2a
    text): `unknown`, zero requests. And the grammar accepts `w1R:p1`, `w0:p1`, `w11:pF`.
13. The create: S is recorded only when C0 to C3 and LC pass and the cwd is the workspace; each failure leaves
    no `herdrShell` and the create succeeds; `pane run` comes after the S read.
14. RH-2: `isAlive` true for S runs, false for each "ended" form of test 2, rejects for each form of test 3,
    and makes no herdr call; a record without S uses the fit round forms.
15. RH-3: a listed process with another session ID rejects; all in S's session gives the list.
16. The existing runtime-herdr R2a test "core stopRuntime uses it instead of destroy: unknown, and no close"
    keeps its oracle for a record without `herdrShell`; for a record with S it becomes test 1.

### 3.15 Live checks of RH

Scratch only, with the isolation of section 7 (private session, scratch `HOME` and XDG, update check off,
`strace`, `env -i`, the stand-in claude of step 1):

1. `ao spawn`, then `ao session kill`: `destroyed`, the workspace is gone, S ended, the record archived, the
   worktree removed.
2. `herdr server stop`, then `ao session kill`: `absent`, zero herdr requests in the shim log.
3. A restart, then a new session that gets the reused workspace ID with a stand-in claude, then `ao session
   kill` of the old record: `absent`, and the new session's pane still runs.
4. `server.live_handoff`, then `ao status` (`isAlive` true) and `ao session kill`: `destroyed`.
5. The socket moved while S runs: `unknown`, zero close, the record and worktree kept; the socket back: kill
   gives `destroyed`.
6. A second server bound at the path after a rename: `unknown`, zero requests.
7. A version other than 0.9.5 is not on the host; the stand-in server covers it (test 8).

## 4. Decision: how AO reads 0.9.5 answers outside RH

### 4.1 Today

On 0.9.5 the CLI writes every error envelope to stderr and exits 1 (step 1 section 4.3). AO reads stdout
through `execFile`, which rejects on exit 1, so:

- **W-1** `isAlive` (`index.ts:497-508` through `getPaneStrict` and `herdrResult`, `:219-222`, `:246-254`)
  rejects for a closed pane and a closed workspace, where R4 row 9 expects `false`;
- **W-2** core `getHerdrPaneProcesses` (`herdr.ts:72-78`) rejects for a closed pane, where row 8 expects `[]`;
- **W-6** with no server, both reject without `RUNTIME_NO_SERVER_ERROR_CODE`, so the lifecycle reads "failed"
  (`lifecycle-manager.ts:640-644`) and `ao start` reads `unknown` (`start.ts:895-929`).

### 4.2 Option (a): the CLI, with the envelope read from stderr on exit 1

One reader in core (`herdr.ts`, exported for runtime-herdr) turns the result of an `execFile` call into one of:
a stdout text (exit 0), or an error with `herdrCode` (the exact form of 4.5), or an error without `herdrCode`.
`herdr()`, `herdrResult()` and `readPane()` in runtime-herdr and `getHerdrPaneProcesses` use it. The 0.8.0
form (exit 0, the envelope on stdout) stays accepted as today.

### 4.3 Option (b): the socket API for the R4 reads and `isAlive`

A socket client in core sends `pane.get` and `pane.process_info` itself and reads the envelope from the
answer line (unchanged since 0.8.0). AO must then resolve the socket path itself (the order of 2.1), send its
own `ping` and check the protocol, and handle `ENOENT`, `ECONNREFUSED` and `EACCES` itself. The other calls
(create, send, read, close) stay on the CLI.

### 4.4 Comparison

| Criterion | (a) CLI, exact stderr form | (b) socket for the reads |
| --- | --- | --- |
| Code before RH | one reader of about 40 lines in core, used by both packages | a socket client, the socket path order and a `ping` check in core, used by core and the four agents |
| Socket path | the CLI resolves it; the pin (4.7) fixes it per handle | AO copies the measured order or uses the pin; a wrong copy reads another server |
| Protocol check | the CLI's `protocol_mismatch` (`r5_b_ping_protocol_19`) | AO's own `ping` per read (two connections, as the CLI) |
| Error forms | one exact JSON line or Rust debug text: the exact form or a rejection | the envelope in the answer line |
| Transport errors | `ENOENT` and `ECONNREFUSED` give the CLI's `server_not_running`; `EACCES`, partial or empty answers give Rust debug text (a rejection) | errno and EOF, exact |
| Timeout | the CLI has none (`r5_b_pane_get_hang`); AO's `execFile` limit (10 s) stays | AO's own |
| Version drift | the CLI's presentation changed once (0.8.0 to 0.9.x); another change fails closed (a rejection) | the documented API; envelopes unchanged since 0.8.0 |
| Transports in the plugin | one (the CLI) | two (reads on the socket, the rest on the CLI) |
| Peer binding | none, as on 0.8.0 (the R4 reads were never peer-bound) | possible in principle; Node has no `SO_PEERCRED` |
| Tests | `execFile` mocks as today, plus the stderr forms | a socket stand-in server in core and runtime-herdr tests |

### 4.5 Recommendation: (a), and the new accepted forms

**(a)**, because it is the smaller change before RH, it keeps one transport for every non-RH call, every
form that it accepts is measured, and every unmeasured form fails closed. RH brings the socket client for the
stop only, where the binding needs it. Whether the reads move to that client later is OQ-1.

**The exact 0.9.5 error form (F1).** An `execFile` rejection with exit code `1` (a number; no signal, not
killed by the timeout), stdout empty, and stderr that is exactly one line (one trailing newline allowed) that
parses as a JSON object with exactly the keys `id` (text) and `error`, where `error` is an object with exactly
the keys `code` (non-empty text) and `message` (text). Its `herdrCode` is `error.code`. Every other failure
has no `herdrCode`: another exit code, a signal, a timeout, stdout not empty, an empty stderr, two or more
lines, Rust debug text (`Error: ...`), a `result` key, another key, an `error` that is not an object, a
`code` that is not text.

**Before any call** (W-8 and M-4): a pane ID that is not empty and does not match
`^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$` rejects with no call ("<id> is not a herdr pane ID"). The empty
pane ID of row 8 keeps its rule (`[]` with no call).

**Row 8** (core `getHerdrPaneProcesses`, `isHerdrProcessRunning`), new text of the third column:

> Exit 0 and a JSON object whose `error` is an object with `code` `pane_not_found` and whose `result` is
> absent or null (0.8.0), **or the exact 0.9.5 error form (F1) with `code` `pane_not_found` (exit 1, stdout
> empty, stderr one line `{"id":...,"error":{"code":"pane_not_found","message":...}}`)**: `[]`. Or exit 0 and
> `result.process_info` ... (unchanged).

Fifth column, added: "the F1 form with `code` `server_not_running` and a `message` that starts with `no herdr
server is running at `: reject with `code` `RUNTIME_NO_SERVER_ERROR_CODE`; the F1 form with any other code:
reject; a pane ID outside the grammar: reject with no call." Tests (last column), added: `control: the exact
stderr pane_not_found envelope at exit 1 answers an empty list` (the line of `closedpane_pane_process_info`);
`rejects the stderr envelope with a result key`; `rejects Rust debug text on stderr`; `rejects the stderr
envelope with stdout not empty`; `rejects a stderr envelope on two lines`; `rejects the stderr envelope at exit
2`; `rejects with RUNTIME_NO_SERVER_ERROR_CODE for the exact server_not_running form`; `rejects a session name
as pane ID with no call`. The existing near-miss tests keep their oracles (`herdr.test.ts:163`, `:173`: the
envelope on stdout at exit 1 still rejects; the stderr envelope there has no `id` and still rejects).

**Row 9** (runtime-herdr `isAlive`), new third column:

> False: exit 0 and a JSON object whose `error` is an object with `code` `pane_not_found` and whose `result`
> is absent or null (0.8.0), **or the exact 0.9.5 error form (F1) with `code` `pane_not_found`** (both for a
> pane ID in the grammar); or exit 0 and a `result` object whose `pane` has `pane_id` the requested ID and a
> text `terminal_id` that is not the handle's non-empty `terminalId` (a replaced terminal).

Fifth column, added: the same three rejections as row 8. Tests, added: `control: the exact stderr
pane_not_found envelope answers false` (`closedpane_pane_get`), `control: ... for a closed workspace`
(`closedws_pane_get`), `rejects with RUNTIME_NO_SERVER_ERROR_CODE for the exact server_not_running form`
(`noserver_never_pane_get`, `r5_c_stale_socket_file_cli`), `rejects EACCES text without the no-server code`
(`r5_c_socket_mode_000_cli`), `rejects protocol_mismatch` (`r5_b_ping_protocol_19`), and the lifecycle
control `a stderr pane_not_found gives app-1 killed after two polls` (`lifecycle-pane-envelope.test.ts`).
Existing near misses keep their oracles (`index.test.ts:449`, `:476`).

**`isAlive` sentence of CLAUDE.md** ("runtime-herdr `isAlive` likewise answers false only for ..."): "only for
the `pane_not_found` code of herdr's error envelope, on stdout at exit 0 (0.8.0) or in the exact stderr form at
exit 1 (0.9.5), for a pane ID in herdr's grammar, or the requested pane with another terminal". After RH-2, a
record with `herdrShell` answers from S (3.8).

### 4.6 The no-server form and `ao start`

`RUNTIME_NO_SERVER_ERROR_CODE` only for the F1 form with `code` `server_not_running` and a `message` that
starts with `no herdr server is running at `. The CLI writes it for `ENOENT` (no socket file, a missing
directory) and `ECONNREFUSED` (a stale socket file, a regular file) only (`r5_path_base_pane_get`,
`r5_c_missing_dir_cli`, `r5_c_stale_socket_file_cli`, `r5_c_regular_file_cli`). `EACCES` gives Rust debug text,
a plain rejection (`r5_c_socket_mode_000_cli`). A process at the socket that answers this code itself passes
too (`r5_b_pane_get_server_not_running_from_server`); a real 0.9.5 server never sends it (the code names a
client state), so that case is the same-uid trust boundary. The message test makes the mapping fail closed if
a later CLI changes the text.

Effects:

- **Lifecycle.** With no server, every Herdr probe reads "no-server" and, after `NO_SERVER_BOUND_MS` (5 min),
  the lifecycle persists `killed` (`types.ts:118-127`). Today it reads "failed" and keeps the status. This is
  right when no server runs: a server stop ends every pane shell. With a hidden server (the socket moved or
  removed while the server runs) it is wrong for the status only: no close follows (the stop is `unknown`
  until RH; with RH, S runs, so `unknown`). The same limit as tmux (design r2 B-5).
- **`ao start` today** (`checkOrchestratorLiveness`, `start.ts:895-929`): with no herdr server, the
  orchestrator record reads `unknown`, and `ao start` stops ("neither reused nor replaced").
- **`ao start` with the mapping alone**: "gone"; `spawnOrchestrator` archives or deletes the old record (by
  the session strategy, `session-manager.ts:2553-2559`) and creates a new orchestrator, whose `workspace
  create` fails with `server_not_running` ("Orchestrator setup failed"). The old record is gone from
  `sessions/`, and when the owner starts herdr, the restored workspace of the old orchestrator stays in herdr
  (AO never closes it).
- **So the fit round also adds the Herdr preflight to `ao start`** (F-7): when the runtime is herdr,
  `preflight.checkHerdr()` (`preflight.ts:41`, as `spawn.ts:77`) runs before the liveness check; with no
  server, `ao start` stops before any record change. The mapping then decides `ao start` only in the race
  between the preflight and the liveness check, and when the record's pinned socket (4.7) differs from the
  caller's.

### 4.7 The pin of the socket and the binary

At create, the plugin runs `<bin> status server --json` (exit 0 with and without a server, `r5_path_base`,
`r5_d_status_server_json_running`) and keeps its `socket` (an absolute path) as `herdrSocket` and `<bin>` as
`herdrBin` in `handle.data`. Every later call for the handle, in the plugin, in core `herdr.ts` and in the CLI
attach (`session.ts:196-198`), runs `herdrBin` with `HERDR_SOCKET_PATH=<herdrSocket>` in its environment. The
CLI's order puts this variable above `HERDR_SESSION` and the XDG default, and below `--session`, which AO never
passes (`r5_path_env_socket_and_env_session`, `r5_path_env_socket_and_flag_session`). A record without
`herdrSocket` keeps today's behaviour (the caller's environment and `herdr` from `PATH` in core).

Why in the fit round: the fit round turns `pane_not_found` and `server_not_running` back into negatives. Without
the pin, an `ao` command whose environment names another socket (every herdr pane has `HERDR_SOCKET_PATH`,
2.1) reads another server and can call a live session gone; `ao start` would then start a second orchestrator.
It also fixes the binary split: core runs `herdr` from `PATH`, while the plugin runs `binPath`.

## 5. Fix plan for W-1 to W-9

| Item | Where | Change | Files | Tests |
| --- | --- | --- | --- | --- |
| W-1 | fit F-1 | the exact reader (4.5) in `herdr()`, `herdrResult()`, `readPane()` | `runtime-herdr/src/index.ts`; the reader in `core/src/herdr.ts`, exported in `core/src/index.ts` | row 9 tests of 4.5; the lifecycle control; existing R4 tests unchanged |
| W-2 | fit F-1 | the same reader in `getHerdrPaneProcesses` | `core/src/herdr.ts` | row 8 tests of 4.5 |
| W-6 | fit F-1 | the exact `server_not_running` form gives `code` `RUNTIME_NO_SERVER_ERROR_CODE` in `isAlive` and `getHerdrPaneProcesses` | as W-1, W-2 | the no-server tests of 4.5; lifecycle: two polls give the "no-server" outcome; CLI `start.test.ts`: the exact form reads "gone" |
| W-8 | fit F-2 | the pane ID check before any pane call | `runtime-herdr/src/index.ts`, `core/src/herdr.ts` | zero `execFile` calls for `aohd-1`, `w1m:p1`, `wI:p1`, ` w1:p1`; calls for `w1R:p1`, `w0:p1`, `w11:pF` |
| W-3 | fit F-3 | a pane in state `blocked` at the gate, or the F1 form with `agent_blocked` at `agent prompt`, throws a typed refusal (new core `RuntimeSendRefusedError`, `reason` `agent_blocked`, nothing admitted) with no `send-text` fallback; `blocked` is removed from `SETTLED_STATES`, and the gate refuses at once when it sees `blocked` instead of waiting (a wait would end in the fallback, which types into the dialog and presses Enter); `send()` runs no forced-restore retry for this refusal; `ao send` catches it and prints one line, exit 1 | `runtime-herdr/src/index.ts` (`:62`, `:447-477`), `core/src/types.ts`, `core/src/session-manager.ts` (`:4005-4026`), `cli/src/commands/send.ts` (`:356`) | herdr: `blocked` at the gate gives the refusal with zero `agent prompt`, `send-text`, `send-keys`; `agent_blocked` (the line of `blocked_herdr_agent_prompt`) gives the refusal and zero `send-text`; core: no `restore` call for the refusal; CLI: exit 1, the text names `agent_blocked`, no stack trace |
| W-5a | fit F-4 | the create cleanup (`:364-369`) reads the close with the reader and, on a failure, adds the workspace ID and the herdr code to the thrown error ("workspace w.. was not closed: <code>; close it by hand") | `runtime-herdr/src/index.ts` | the error names the workspace for `workspace_group_close_required` (`group_workspace_close_primary_nogroup`) and for `server_not_running` |
| W-5b | fit F-5 (OQ-6) | `destroy` (`:395-407`) refuses: it throws the R2a refusal text and calls nothing. Core uses `stop`, so no production caller changes | `runtime-herdr/src/index.ts` | `destroy` rejects with zero calls; same-ID r2 N-1 defect test turns green; its control "destroy closes the recorded workspace ..." and `index.test.ts:165-186` change their oracles (owner approval, OQ-6) |
| pin | fit F-6 (OQ-2) | 4.7 | `runtime-herdr/src/index.ts` (create and every call), `core/src/herdr.ts` (the socket and binary from the handle), the four agents' Herdr calls, `cli/src/commands/session.ts` (attach) | every call of a pinned handle has `HERDR_SOCKET_PATH` and `herdrBin`; a record without the keys has neither; the attach runs with the pin |
| start | fit F-7 (OQ-7) | 4.6 | `cli/src/commands/start.ts`, `cli/src/lib/preflight.ts` | `ao start` with no herdr server stops before the liveness check, the record unchanged; with a server, unchanged |
| W-7 | fit F-8, docs | comment: `recent-unwrapped` returns the shell text for a pane with no agent on 0.9.5 | `index.ts:16-18`, `:479-482` | none |
| W-9 | fit F-8, docs | comment: no ID reuse within a run; after a restart, closed workspace IDs above the highest open one come back | `index.ts:384-386` | none |
| (comments) | fit F-8, docs | `index.ts:94-97` (both error forms); `herdr.ts:37`, `:91-92`; `lifecycle-manager.ts:214-222` ("runtime-herdr isAlive still answer false on an error" and "claude-code ... answers 'no process' on an error" are out of date since R4); `docs/DEVELOPMENT.md` rows 8 and 9; the `isProcessRunning` sentence of `CLAUDE.md` | as named | none |
| W-4 | later send round (OQ-5) | resend only when the state before the send was `idle` (the cold-start case); from `done`, one attempt, and no `working` within the timeout gives "sent, not confirmed" instead of a resend | `runtime-herdr/src/index.ts` (`:311-326`, `:447-477`), `cli/src/commands/send.ts` | from `done` with no `working`: one `agent prompt`; from `idle` with no evidence: up to `sendAttempts`; first measure how long a real claude shows `working` for a short turn (step 1 open question 3) |
| RH | RH | section 3 | new `runtime-herdr/src/socket-client.ts` and `launch-identity.ts`; `runtime-herdr/src/index.ts` (create, stop, isAlive); `core/src/herdr.ts` (RH-3) | 3.14 |

## 6. Round plan

| Round | Content | Risk | Size | Needs |
| --- | --- | --- | --- | --- |
| **Herdr 0.9.5 fit** | F-1 to F-8 of section 5 | medium (it turns `pane_not_found` and `server_not_running` back into negatives; with the pin they come from the record's own server) | **M**: about 10 files (`core/src/herdr.ts`, `core/src/index.ts`, `core/src/types.ts`, `core/src/session-manager.ts`, `runtime-herdr/src/index.ts`, four agent call sites, `cli` `send.ts`, `start.ts`, `session.ts`, `preflight.ts`) plus docs; without F-5, F-6 and F-7 it is S | R4 (landed); OQ-2, OQ-6, OQ-7 |
| **RH** | section 3 (RH-1, RH-2; RH-3 optional) | **high** (the stop and the liveness of every Herdr session) | M | the fit round; OQ-3, OQ-4; NM-1 and NM-3 before the live run |
| Herdr send (later) | W-4 | medium | S | a real-claude measurement of short turns |

The fit round's acceptance: the step 1 matrix again on scratch (the closed-pane and closed-workspace rows give
`false` and `[]`, the no-server rows give the code), plus `ao send` to a blocked stand-in (one line, exit 1, no
stack trace) and `ao start` with no server (stops before any record change).

## 7. Measurements of this round (r5)

Only answers that step 1 did not measure, and that this design needs. Isolation as the step 1 brief, section 3,
with the names of this brief: marker `/tmp/aohd2-marker` (`2026-10-22 18:01:03.350111590 -0400`), scratch root
`/tmp/aohd2`, sessions `aohd2-1` to `aohd2-3`, no tmux (no tmux call at all), scratch `HOME`
(`/tmp/aohd2/home`, with `user.name` and `user.email` in `.gitconfig`; no git ran), scratch XDG directories,
the update check off (`r5_setup/herdr-config.toml`), a scratch `PATH` of links with no `npx`, `npm`, `gh`,
`tmux`, `git`, `curl` or `wget`, every `herdr`, `python3` and `node` call under `env -i`
(`r5_setup/run.sh`), every herdr client call through a shim under `strace -f -e trace=connect,socket,execve`
(`r5_setup/herdr-shim.sh`), every server under `strace -ff -e trace=network,execve`. No `ao` command ran in
this round.

| Part | Script | What | Fixtures |
| --- | --- | --- | --- |
| A | `r5_a_paths.py` | the socket path order, no server | `r5_path_*` |
| B | `r5_b0_probe.py`, `r5_b_cli_forms.py` | what the CLI sends; its answer forms (fake server) | `r5_b0_*`, `r5_b_*` |
| C | `r5_b_cli_forms.py` | stale socket, regular file, `EACCES` (mode 000, directory), missing directory; CLI and raw client | `r5_c_*` |
| D | `r5_d_socket.py` | 0.9.5 socket forms on server `aohd2-1`: `invalid_request`, ID forms, partial requests, closes, the pane environment, `EACCES`, `status server --json` | `r5_d_*` |
| E | `r5_e_exe.py` | a server from a byte copy of the binary, then the copy removed | `r5_e_*` |
| F | `r5_f_handoff.py` | one `server.live_handoff` on server `aohd2-3` | `r5_f_handoff_log` |
| G | `r5_g_listener.py`, `r5_g_node.mjs`, `r5_g_rename.py` | the holders of the listening socket; the Node socket API; `/proc/net/unix` after a rename, and the cost | `r5_g_*`, `r5_g2_rename_and_cost` |

`strace` (`r5_logs/strace_summary.txt`): the shim log has 63 client calls; the client section of the summary
covers the first 62 (it was written at 18:09, before the last `server stop` of `aohd2-3` at 18:16): 113
`AF_UNIX` sockets, every `connect` to a path under `/tmp/aohd2`, only the herdr binary executed. Three server
runs: zero `AF_INET` or `AF_INET6` lines; the only connects outside `/tmp/aohd2` were to the local D-Bus system
bus. The Python and Node scripts of parts A to G used only `AF_UNIX` sockets (their source is in `r5_setup/`)
and ran without `strace`. Servers (`r5_logs/pids.txt`):
`aohd2-1` 4158055 and `aohd2-2` 4174594 ended through `herdr server stop`; `aohd2-3` 56174 ended in the
handoff, and its successor 59284 ended through `herdr server stop`; each PID was checked absent after its stop,
and every `strace` ended with its server.

## 8. The update of doc 0004

`development/0004_running_ao_on_the_herdr_runtime.md` (uncommitted) has the 10 changes of step 1 section 8,
with the 0.8.0 facts kept and marked: the status line names both versions (change 2); section 1 names the
socket order, the sessions and `status server` (changes 1 and 10); section 3 names the `agent_blocked` refusal
and the duplicate delivery of a short turn (change 3); section 4.1 names `ao session attach` and `--takeover`
(change 4); section 5 has the 0.9.5 timings, `done` after the first task and the new agent fields (change 5);
a new section 5a on errors (change 6), with the read of `recent-unwrapped` (change 7) and the IDs (change 8);
section 8 has the group close, the close of the only pane and the handoff (change 9). Two facts outside the
list are corrected because they are wrong now and sit next to the changes: since R2a, AO closes no Herdr
workspace (section 1), and `ao open` is not in this fork (section 4.1). RH is described as a design, not as
built.

## 9. Open questions for the owner

| OQ | Question | Options | Recommendation |
| --- | --- | --- | --- |
| OQ-1 | How AO reads 0.9.5 answers outside RH | (a) the CLI with the exact stderr form (4.5); (b) the socket API for the R4 reads and `isAlive` | **(a)**; revisit after RH has a qualified socket client |
| OQ-2 | The socket and binary pin (4.7) | (a) in the fit round; (b) in RH; (c) never | **(a)**: the fit round makes negatives count again, and without the pin they can come from another server |
| OQ-3 | The RH launch identity | (a) the pane shell S, the listener check, `pane.close` (section 3); (b) design r4's server incarnation through `SO_PEERCRED`, which needs a helper process or a native addon, and reads every session as another launch after a live handoff | **(a)** |
| OQ-4 | RH-2: `isAlive` from S for records with S | (a) yes, in RH; (b) keep the terminal rule (a live handoff then reads every session as gone, killed after the bound) | **(a)** |
| OQ-5 | W-4 duplicate deliveries of short turns | (a) a later send round: resend only from `idle`, after a real-claude measurement; (b) keep; (c) `agent prompt --wait` (its 5 s stall rule is blind to short turns too) | **(a)** |
| OQ-6 | `destroy` refuses in the fit round (moves design r4's R2b-1 item) | (a) yes, with the oracle change of the N-1 control and `index.test.ts:165-186`; (b) keep for R2b-1 | **(a)**: no production caller uses it, and it is the last unbound close |
| OQ-7 | The Herdr preflight in `ao start` | (a) yes, in the fit round; (b) no | **(a)**: with the no-server mapping alone, `ao start` archives the orchestrator record and then fails |
| OQ-8 | Herdr in `AUTHORITATIVE_RUNTIMES` (a negative counts at once, not after the 5 min bound) | (a) not now; (b) after RH-2, for records with S | **(a)**; decide after the RH live run |
| OQ-9 | An operating rule until RH-2 lands | (a) no `herdr update --handoff` and no live handoff while AO Herdr sessions run (each session would read gone after the bound; nothing closes); (b) no rule | **(a)** |
| OQ-10 | Residual R-H1 (a descendant that outlives its pane shell) | (a) accept, as tmux `kill-session` and OD-14; (b) RH also checks the agent process before `absent` | **(a)**, after NM-3 on a real Claude Code (an owner-approved run) |
| OQ-11 | Residual R-H2 (a same-uid double socket swap inside the check window) | (a) accept, as OD-23; (b) a helper process that reads `SO_PEERCRED` (python3 or `ss`) | **(a)** |

## 10. Deviations from the brief

- **D-1** One `herdr` call ran outside `env -i`: `~/.local/bin/herdr --version` in the start check (it printed
  `herdr 0.9.5`; `--version` contacts no server). Every other herdr call ran under `env -i`.
- **D-2** The handoff (part F) and the Node and listener checks (part G) are measurements beyond the brief's
  examples. The design needed them: the first decides the launch identity, the second whether design r4's peer
  read can be written in Node.
- **D-3** The listener scan of part G read the `fd` link names of every process of my uid, also of real
  processes (read only, link names only, no content), as `ls -l /proc/<pid>/fd` does. One scan earlier also
  tried `/proc/<pid>/environ` of my processes to find scratch processes; some were not readable.
- **D-4** `r5_g2_rename_and_cost` is a transcription of the console output: the copy step missed the file
  (the glob `r5_g_*` does not match `r5_g2_*`), and `/tmp/aohd2` was already removed. The script is
  `r5_setup/r5_g_rename.py`.
- **D-5** In part D the mode of the scratch server's socket went from 000 back to 0700, not to its first mode
  (not recorded; the client socket next to it was 0600). Scratch only.
- **D-6** The doc 0004 update corrects two facts outside the step 1 list (section 8).

## 11. Cleanup and the final checks

- Processes: a scan of every process of my uid for `HOME=/tmp/aohd2/home` in its environment or `/tmp/aohd2`
  in its command line found only the scan itself; `ps -C herdr,herdr-real,strace` printed nothing.
- `/tmp/aohd2` (31 MB) was removed after the copy into the artifact folder; the marker `/tmp/aohd2-marker`
  stays.
- `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aohd2-marker -not -name 'lifecycle-manager-*.json' -not
  -path '*/processes*' -not -name 'lifecycle-worker.log'`:

  ```text
  <home>/.agent-orchestrator/6513108c38cb-Nexus/sessions
  <home>/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2223
  <home>/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
  <home>/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-orchestrator
  ```

  None is my write: no `ao` command ran in this round. `nex-2223` is a record of another project (written
  18:14:49), and `ao-orchestrator` was written at 18:16:55, by the real fleet.
- `find ~/.config/herdr ~/.local/share/herdr ~/.local/state/herdr ~/.cache/herdr -newer /tmp/aohd2-marker`: no
  output.
- `ls -la --time-style=full-iso ~/.ao/bin`: the same six lines as at the start (step 1 section 1).
- The real lifecycle workers 4027448 and 4027591 still run; I did not touch them.
- `git status -s`: only `.agent_report.md`, `.agent_task.md`, `.agent_task_rh_r5.md`, this file,
  `development/0004_running_ao_on_the_herdr_runtime.md`, and the new `r5_` fixtures; `git diff --exit-code --
  packages` passes. `gitleaks detect --no-git -c .gitleaks.toml` on the artifact folder: no leaks. No `r5_`
  fixture has a JSON field named `key` or `token`.
