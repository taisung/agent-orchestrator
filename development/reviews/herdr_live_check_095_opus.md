# Herdr 0.9.5 live check: AO's herdr calls, the emitted IDs and the release-note paths (ao-65)

Author: ao-65 (Claude Code, Opus 5.5), 2026-10-22, 16:00 to 16:31 EDT. Base `d5b6a180` (`main`). Step 1 of
3 of the owner's Herdr focus (answer "18a"): measure, save the real answers, list what must change.

This is a measurement. No file under `packages/` changed, and nothing was committed or pushed. The raw
answers are in `development/artifacts/herdr_095_live_check/` (section 14). Each fixture `<name>` is a
pair: `<name>.json` or `<name>.txt` holds stdout as herdr printed it, and `<name>.cmd` holds the command,
the exit code, the start time, the duration and stderr. In this document a fixture is named in
`backticks` without its extension.

The 0.8.0 values come from doc 0004 (`development/0004_running_ao_on_the_herdr_runtime.md`), the R4 rows 8
and 9 (`docs/DEVELOPMENT.md`, "Absence forms of the R4 reads"), RH (design r4
`development/reviews/same_id_design_r4_opus.md` section 7 and its measurement h5 in section 9.8), review
r4 M-4, and the 0.8.0 spike notes in the comments of `packages/plugins/runtime-herdr/src/index.ts`. No
0.8.0 binary exists on the host, so no 0.8.0 answer was measured again.

## 0. Results

1. **Version and protocol.** `herdr 0.9.5`, protocol **22** (0.8.0: protocol 19). The socket `ping`
   answer has the same form, with four more capability keys (section 2).
2. **The main change: a CLI error now exits 1 and goes to stderr.** On 0.8.0 the CLI printed the error
   envelope `{"error":{"code",...}}` on stdout with exit 0 (index.ts lines 95-96, R4 rows 8 and 9). On
   0.9.5 every failed API call exits **1**, prints the same envelope on **stderr**, and prints nothing on
   stdout. AO reads stdout only, through `execFile`, which rejects on exit 1. So:
   - `isAlive` can no longer answer `false` for a closed pane or a closed workspace. It rejects
     (unknown). It still answers `false` for a pane ID with another terminal (after a restart).
   - `getHerdrPaneProcesses` can no longer answer `[]` for a closed pane. It rejects.
   - 21 answers of AO's call matrix changed from 0.8.0 (section 4.3).
   The raw socket API did not change: an error is still an `error` envelope in the answer line.
3. **IDs (M-4).** Workspace and pane counters use bijective base 32 with the symbols
   `123456789ABCDEFGHJKMNPQRSTVWXYZ0` (`I`, `L`, `O`, `U` are not used, `0` is the digit 32): `w1` to
   `w9`, `wA` to `wZ`, `w0`, `w11`, ..., `w1A`. Within one server run herdr reuses no workspace or pane
   ID. **After a restart herdr reuses workspace IDs**: the next new workspace is the highest open one
   plus one, so the IDs of closed workspaces above it come back (measured twice, section 5). A terminal
   ID is `term_` + 13 hex digits of the creation time in microseconds + the terminal counter of the
   server run in hex. Every restored pane gets a new terminal ID.
4. **Release-note paths.** `workspace close` of a primary workspace with a linked worktree workspace
   fails with `workspace_group_close_required` (exit 1) and closes nothing; `--group` closes the group.
   An AO workspace (created with `--cwd` on a git worktree) is not linked and closes without `--group`.
   An agent's first task ends in `done` (unfocused pane), and every later turn ends in `done` too. A
   `pane close` of the only pane of a workspace closes the pane and the workspace at once, with
   `ui.confirm_close` on and off; the API never asks.
5. **New answers on AO's paths.** `agent prompt` to a `blocked` agent is refused with `agent_blocked`
   (exit 1). AO's settle gate accepts `blocked`, so `ao send` then fails with a stack trace and a wrong
   reason (section 3.4). A 0.15 s turn was not visible in herdr's state in 4 of 6 tries, so AO's
   delivery check sends the message again: 3 deliveries of one `ao send` were measured.
6. **Detection.** herdr finds the agent by its process name only (`claude`); the screen rules of the
   bundled manifest `claude` 2026.10.11.1 decide the state. The stand-in is detected as Claude Code
   (section 7).
7. The send-and-check path of doc 0004 section 5 works on 0.9.5: a cold agent that drops the first
   prompt gets the second one (2 attempts, spawn 18.5 s).

## 1. Environment and isolation

- Host: Linux 6.8.0-147-generic. `~/.local/bin/herdr`: 30285672 bytes, mtime 2026-10-22 10:31:34 EDT,
  sha256 `14d9e8bc8b4a9e0118d77c32266f76d461f09b40342eb23752960bd89f59929d`, static-pie, not stripped.
- Marker: `/tmp/aohd-marker`, `2026-10-22 16:00:33.392493425 -0400`.
- `ls -la --time-style=full-iso ~/.ao/bin` at the start (the same at the end, section 12):

  ```text
  drwxr-xr-x 2 <user> users 4096 2026-10-16 12:16:13.968933443 -0400 .
  drwxr-xr-x 3 <user> users 4096 2026-02-24 12:30:43.815475733 -0500 ..
  -rwxr-xr-x 1 <user> users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
  -rw-r--r-- 1 <user> users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
  -rwxr-xr-x 1 <user> users 2213 2026-10-16 12:16:13.967933468 -0400 gh
  -rwxr-xr-x 1 <user> users 3471 2026-10-16 12:16:13.968933443 -0400 git
  ```

- Before any herdr call: `ps -o pid=,args= -C herdr` printed nothing (exit 1). No herdr server ran.

### 1.1 The update check

- 0.9.5 has the config keys `[update] version_check` and `manifest_check` (both `true` by default,
  `default_config`). The binary holds the URLs `https://herdr.dev/latest.json`, `preview.json`,
  `https://herdr.dev/agent-detection/index.toml`, and the strings of a `curl` child (`--retry`,
  `--connect-timeout`, `--max-time`, `curl stdout was not captured`). So the checks run `curl`.
- The scratch config (`_setup/herdr-config.toml`) set both keys to `false` before the first start.
- The scratch `PATH` held only listed tools (`_setup/run.sh`): no `curl`, `wget`, `npx` or `npm`.
- `unshare -rn true` failed: `unshare: write failed /proc/self/uid_map: Operation not permitted`
  (`kernel.apparmor_restrict_unprivileged_userns = 1`). So the evidence is `strace`.
- Every server run (4 runs) ran under `strace -ff -e trace=network,execve`. Every herdr client call ran
  under `strace -f -e trace=connect,socket,execve` in the shim. Summary: `_logs/strace_summary.txt`.
  - herdr itself: **no `AF_INET` or `AF_INET6` socket** in any run, and no `curl` child. Per server
    run, one `connect` to the D-Bus system bus (`/var/run/dbus/system_bus_socket`, local) and `nscd`
    lookups (`/var/run/nscd/socket`, `ENOENT`).
  - 1733 client calls: 4360 `connect` calls, every one to
    `/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock`; only `AF_UNIX` sockets; only the herdr
    binary was executed.
  - Deviation (section 11, D-1): in server run 2, `git`, which `herdr worktree create` ran, sent a DNS
    query for the host's own name to the loopback resolver `127.0.0.53` and made a UDP `connect` without
    data to the host's own address `172.17.55.5` (source-address selection). The scratch `HOME` had no
    git identity, so git built one from the host name.

### 1.2 The private session and the shims

- Session `aohd-1` (0.9.5 has `--session <name>`). API socket
  `/tmp/aohd/xdg/config/herdr/sessions/aohd-1/herdr.sock`, client socket `herdr-client.sock` next to it,
  server log `herdr-server.log` there. The default socket of the scratch environment is
  `/tmp/aohd/xdg/config/herdr/herdr.sock` (`default_session_status_server_json`); no call reached it.
- `HOME=/tmp/aohd/home`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`,
  `XDG_RUNTIME_DIR` under `/tmp/aohd/xdg`, `TMPDIR=/tmp/aohd/tmp`. herdr printed
  `Config: /tmp/aohd/xdg/config/herdr/config.toml` (`herdr --help`). The owner's `~/.config/herdr` was
  not read (the `strace` runs show no path under `/home` except the herdr binary).
- `herdr` shim (`_setup/herdr-shim.sh`): adds `--session aohd-1`, logs each call
  (`_logs/herdr-shim-calls.log`), runs the real binary under `strace`, and refuses `agent attach`
  (exit 97), so no client attached.
- `tmux` shim (`-L aohd-ao`): never called. AO on Herdr made no tmux call.
- `gh` stub: answers only `--version` and `auth status`. `claude` stand-in: `_setup/claude-standin.sh`
  (section 7).
- Every `ao`, `node`, `pnpm` and `herdr` call ran under `env -i` with only the scratch variables
  (`_setup/run.sh`) and `AO_CONFIG_PATH=/tmp/aohd/ao/agent-orchestrator.yaml`. AO ran from
  `packages/cli/dist/index.js` only. The scratch lifecycle worker (PID 2949663) had the scratch `HOME`,
  `PATH` and config (its `/proc/<pid>/environ`).
- Build: the global pnpm 10.30.3 failed offline (`ERR_PNPM_NO_OFFLINE_TARBALL` for
  `@clack/prompts@0.9.1`: the lockfile of this repository belongs to pnpm 9.15.4 and the v3 store). The
  cached pnpm 9.15.4 (`~/.local/share/pnpm/.tools/pnpm/9.15.4`) installed offline from the v3 store with
  `--ignore-scripts` (the `prepare` script `husky` writes the shared git config), and `pnpm build` passed.
  Both ran under `strace -f -e trace=connect`: 0 `connect` calls (`_logs/build.log`).
- Fixtures: `/home/<user>` is written `<home>`, and the shell prompt `<user>@<host>`. Nothing else is
  changed.

## 2. Version and protocol

| Item | 0.8.0 (source) | 0.9.5 (fixture) |
| --- | --- | --- |
| `herdr --version` | 0.8.0 | `herdr 0.9.5` |
| Protocol | 19 (h5 part 3, socket `ping`) | **22**: socket `ping` (`sock_ping`), `status server --json` (`live_status_server_json`), bundled schema (`api_schema`, `"protocol": 22`) |
| `ping` answer | `{"type":"pong","version":"0.8.0","protocol":19,"capabilities":{"live_handoff":true,"detached_server_daemon":false,...}}` | `{"type":"pong","version":"0.9.5","protocol":22,"capabilities":{"live_handoff":true,"detached_server_daemon":false,"endpoint_protocol_generation":1,"surface_interest":true,"health_check":true,"ssh_agent_registration":true}}` |
| A CLI `ping` | not recorded | none: `herdr api ping` exits 2 (`help_api_ping`); `herdr api` has `snapshot` and `schema` |
| `herdr status server` (AO's `detect` and preflight) | first line `status: running` (doc 0004 section 1) | first line `status: running`, then `version`, `endpoint_compatible`, `private_protocol: 22`, `private_protocol_compatible`, `socket` (`live_status_server`). With no server: exit **0**, `status: not running` (`noserver_never_status_server`). AO's regex `/status:\s*running/` reads both right |
| Socket transport | one request per connection, one JSON line (h5) | the same (`_setup/sock.py`, `sock_*`); the peer of `SO_PEERCRED` is the server PID, and `/proc/<pid>/stat` is readable |
| Socket path | `<HOME>/.config/herdr/herdr.sock` (h5) | default `$XDG_CONFIG_HOME/herdr/herdr.sock`; with `--session <n>`: `$XDG_CONFIG_HOME/herdr/sessions/<n>/herdr.sock` |

Help of every command that AO calls: `help_workspace_create`, `help_workspace_close`, `help_pane_get`,
`help_pane_run`, `help_pane_read`, `help_pane_close`, `help_pane_send_text`, `help_pane_send_keys`,
`help_pane_process_info`, `help_agent_prompt`, `help_agent_attach`, `help_status`, `help_server`,
`help_server_stop`, and the groups `help_workspace`, `help_pane`, `help_agent`. Also `herdr_skill`,
`default_config`, `api_schema` (the whole bundled schema). Changes on AO's paths in the help text:

- `workspace close <workspace_id>` shows no `--group`, but the flag works (section 6.1). The API has
  `workspace.close {workspace_id, close_group}`.
- `agent prompt`: "If the agent is already blocked, submission is rejected with agent_blocked before any
  input is sent." `--wait` now needs a `working` or `blocked` state within 5000 ms, else
  `agent_prompt_stalled`; it still does not track turns.
- The API has no `pane.run` method; the CLI `pane run` types the command into the pane.
- New agent fields in `agent get` (not in `pane get`): `state_change_seq`, `completion_seq`,
  `interactive_ready`, `launch_pending`, `screen_detection_skipped`. For the stand-in,
  `interactive_ready` and `launch_pending` were absent (section 7).

## 3. AO on a scratch config with `runtime: herdr`

Config: `_setup/agent-orchestrator.yaml` (runtime `herdr`, agent `claude-code`, no tracker, no
notifier). The stand-in is the `claude` on the scratch `PATH`. Timings are from the shim log
(`_logs/herdr-shim-calls.log`, the time each herdr call started).

### 3.1 `ao spawn` (warm agent) — `ao_spawn`

Exit 0 in 5916 ms: `Session aohd-1 spawned`, `SESSION=aohd-1`. The record has
`runtimeHandle={"id":"w1M:p1",...,"workspaceId":"w1M","terminalId":"term_65e7387f8075441",...}` and
`promptDelivered=true`.

| Time (16:15:) | herdr call |
| --- | --- |
| 55.48 | `status server` (preflight) |
| 55.64 | `workspace create --cwd <worktree> --label 4bb69d3e8656-aohd-1 --env ... --no-focus` |
| 55.71 | `pane run w1M:p1 bash <launch script>` |
| 55.74 | `pane process-info --pane aohd-1` (the lifecycle worker, with a handle made from the session name, section 10 W-8) |
| 58.76 | first `pane get` (AO waits a fixed 3 s first: `session-manager.ts:2370-2378`) |
| 58.76, 59.29, 59.83 | settle polls (500 ms); `idle` at the third |
| 59.89 | `agent prompt w1M:p1 <26 lines, 1347 characters>` |
| 60.28, 60.71, 61.15 | delivery polls (433 ms); evidence at 61.15 |

Settle: herdr reported `idle` 3.6 to 4.1 s after `pane run`, while the stand-in drew its prompt box at
once (also `_logs/poll-m2-launch.txt`: agent found after 0.3 s, `idle` after 3.6 s). One attempt. The
stand-in got the whole multi-line prompt as one message (`_logs/standin/claude-standin.2949743.log`).
0.8.0: `idle` "roughly 2 s after launch" (doc 0004 section 5).

### 3.2 `ao spawn` of a cold agent — `ao_spawn_2_cold_drop8`

The stand-in drew its prompt box at once and discarded input for 8 s (`/tmp/aohd/standin.drop`), as the
cold claude of doc 0004 section 5. Exit 0 in **18498 ms**, 2 attempts:

| Time (16:17:) | Event |
| --- | --- |
| 36.45 | `pane run w1N:p1` |
| 40.62 | attempt 1: `agent prompt` (the stand-in dropped 26 lines at 40.72 to 41.29) |
| 41.02 to 53.15 | 30 delivery polls, no evidence (12.5 s) |
| 53.18, 53.21 | settle again (`idle` at once) |
| 53.25 | attempt 2: `agent prompt`; the stand-in got it at 53.94 |
| 54.51 | evidence (`working`) |

0.8.0 (doc 0004 section 5, 0003 section 9): the first attempt was dropped in every case at 9 workers;
"expect a first send to cost ~15 s on a cold agent". On 0.9.5 the same cost: 12.6 s from attempt 1 to
attempt 2.

### 3.3 `ao status` — `ao_status_1`, `ao_status_2_blocked`, `restart2_after_ao_status`, `final_ao_status`

- Live session: Activity `idle`, Age `-`. Doc 0004 section 4.2 is unchanged (the Age column is blank).
- While herdr reported `blocked`: still `idle`. The claude-code activity comes from Claude's own JSONL,
  not from herdr; the stand-in writes no JSONL (section 7).
- With the server stopped: `unknown` (`noserver_stopped_ao_status`).
- After a restart (the restored panes run `bash`): `exited` (`restart2_after_ao_status`).
- Per session, `ao status` calls `pane get` and `pane process-info`.

### 3.4 `ao send` (scratch only)

| Case | Fixture | Result |
| --- | --- | --- |
| From `done` (a warm agent) | `ao_send_1_from_done` | exit 0 in 2277 ms, `Message sent and processing`. Settle at once (`done` is settled); `agent prompt` at 12.540 (the call takes 340 ms on 0.9.5, `live_agent_prompt`); evidence at 13.750 (`working`), 1.2 s after the prompt; 1 attempt |
| A `blocked` agent | `blocked_herdr_agent_prompt`, `ao_send_blocked` | herdr: exit 1, `{"error":{"code":"agent_blocked","message":"agent w1P:p1 is blocked and requires interactive input"}}`. `ao send`: exit 1 in 813 ms with an uncaught stack trace: `Error: Cannot send to session aohd-3: session needed to be restarted before delivery (Session aohd-3 cannot be restored: session is not in a terminal state)`. No text reached the permission prompt. No fallback ran |
| A 0.15 s turn, from `done` | `shortturn_ao_send_from_done`, `_logs/poll-shortturn.txt`, `_logs/standin/claude-standin.3056196.log` | exit 0 in 28145 ms, `Message sent and processing`, but **3 `agent prompt` calls** (16:24:56.80, 16:25:09.35, 16:25:21.90) and the stand-in **received the message 3 times**. herdr stayed `done` through turns 1 and 2 (100 ms poll); for turn 3 it showed `working` for 0.36 s, from about the end of that turn (the stand-in showed its working screen for 0.15 s) |
| No server (stopped) | `noserver_stopped_ao_send` | exit 1 in 15586 ms: the 15 s settle wait, the `pane send-text` fallback fails, then the same restore error and stack trace as the blocked case |
| An old record whose pane ID a new session took | `falsealive_ao_send_aohd3` | exit 1 in 292 ms: `session is not running (runtime stop unconfirmed (unknown) ...)`. `isAlive` saw the other terminal. The new session's stand-in got nothing |

### 3.5 `ao session kill` — `ao_session_kill_aohd1`

Exit **1** in 189 ms, no herdr call:

```text
Failed to kill session aohd-1: runtime stop unconfirmed (unknown): the Herdr close cannot yet check the terminal at close time (same-ID review r2, B-2): herdr reuses pane and workspace IDs, so a close of workspace w1M could reach another terminal; nothing was closed. Close it by hand in herdr after you check that it is this session; record and worktree kept
Next: Close herdr workspace w1M by hand after you check that it belongs to this session. AO cannot stop a Herdr session yet: a retry of this command gives the same refusal, and AO keeps the record and the worktree of this session until it can check the terminal at close time.
```

### 3.6 `ao session attach` — `ao_session_attach_aohd1`

AO called `pane get w1M:p1`, `pane process-info --pane w1M:p1`, `pane get w1M:p1`, then started
`herdr agent attach w1M:p1` with inherited stdio (`packages/cli/src/commands/session.ts:196-198`). The shim
refused it (exit 97), so AO printed `Failed to attach to session aohd-1: Error: herdr attach exited
with code 97` (exit 1). The attach info is `{type: "process", target: "w1M:p1", command: "herdr agent
attach w1M:p1"}` (index.ts:516-524). `agent attach` of 0.9.5 has a new `--takeover` option.

### 3.7 The lifecycle worker

Every 30 s: `pane get` and `pane process-info` twice per session. After restart 2 (16:21:47) the three
sessions answered "another terminal" (`false`, "ambiguous" because herdr is not in
`AUTHORITATIVE_RUNTIMES`), and no probed session answered alive, so the hold kept them `working`. A new
session answered alive at 16:23:56; at the next poll (16:24:26) the lifecycle wrote `killed`
(`killedReason=runtime`) for all three. This is the R2a/R4 design, not a 0.9.5 change.

## 4. Every herdr call of AO

The calls (`grep` of `packages/plugins/runtime-herdr/src/` and `packages/core/src/herdr.ts`, plus the
CLI): `workspace create` (create), `pane run` (create), `workspace close` (destroy, create cleanup),
`pane close` (destroy without a workspace ID), `pane get` (`getPaneStrict`, isAlive, the waits),
`pane read --source recent-unwrapped|visible --lines N` (getOutput), `agent prompt`, `pane send-text`,
`pane send-keys ... Enter` (sendMessage), `status server` (`detect`, `preflight.checkHerdr`),
`pane process-info --pane` (core), `agent attach` (CLI attach).

### 4.1 The matrix

Fixture prefixes: `live_`, `closedpane_` (a split pane, closed), `closedws_` (a closed workspace),
`otherterm_` (the same pane ID after a restart, with another terminal), `noserver_never_`,
`noserver_stopped_`. "env" means the envelope `{"error":{"code":...},"id":"cli:..."}`.

| Call | Live pane | Closed pane | Closed workspace | Another terminal | No server (never or stopped) |
| --- | --- | --- | --- | --- | --- |
| `pane get` | 0, `pane_info` (stdout) | **1**, env `pane_not_found` (stderr) | **1**, env `pane_not_found` | 0, `pane_info` with a new `terminal_id`, `agent` absent | 1, env `server_not_running` (stderr) |
| `pane process-info --pane` | 0, `pane_process_info`: `pane_id`, `shell_pid`, `foreground_process_group_id`, `foreground_processes[{pid,name,cmdline,argv,cwd}]` | **1**, env `pane_not_found` ("pane not found") | **1**, the same | 0, the list of the new terminal (`bash` only) | 1, `server_not_running` |
| `pane read ... recent-unwrapped` | 0, text | **1**, `pane_not_found` | **1**, the same | 0, **text** (the shell; no agent) | 1, `server_not_running` |
| `pane read ... visible` | 0, text | **1**, `pane_not_found` | **1**, the same | 0, text | 1, `server_not_running` |
| `agent prompt` | 0, `agent_prompted` (the state before), 340 ms | **1**, `agent_not_found` | **1**, `agent_not_found` | **1**, `agent_not_found` (no agent) | 1, `server_not_running` |
| `pane send-text` | 0, empty stdout | **1**, `pane_not_found` (`id: cli:request`) | **1**, the same | 0, empty | 1, `server_not_running` |
| `pane send-keys Enter` | 0, empty | **1**, `pane_not_found` | **1**, the same | 0, empty | 1, `server_not_running` |
| `pane run` | 0, empty | **1**, `pane_not_found` | **1**, the same | 0, empty | 1, `server_not_running` |
| `pane close` | 0, `{"type":"ok"}` (`closepane_pane_close_w3p2`) | **1**, `pane_not_found` | **1**, the same | not run | 1, `server_not_running` |
| `workspace close` | 0, `ok` (`closews_workspace_close_w2`) | - | **1**, `workspace_not_found` | not run | 1, `server_not_running` |
| `workspace create` | 0, `workspace_created` | - | - | - | 1, `server_not_running` |
| `status server` | 0, `status: running` | 0 | 0 | 0 | 0, `status: not running` |
| `server stop` | 0, empty, 8.1 to 9.4 s | - | - | - | 1, plain text on stderr: `server is not running or cannot be reached at <socket>: No such file or directory (os error 2)` |

Malformed and unknown IDs (`badid_*`): `aohd-1`, `not a pane`, `w9Z:p9`, the lowercase `w1m:p1`, and
the empty ID all give exit 1, `pane_not_found`; `workspace get w9Z` gives `workspace_not_found`. IDs are
case-sensitive. Over the socket the same errors are envelopes in the answer (`sock_pane_get_closed`,
`sock_pane_process_info_closed`, `sock_workspace_close_missing`).

### 4.2 Compared with R4 rows 8 and 9 and the `isAlive` rule

| Read | 0.8.0 form (R4) | 0.9.5 answer | What the code answers on 0.9.5 |
| --- | --- | --- | --- |
| Row 9, `isAlive` of a live pane | exit 0, `result.pane`, the same `terminal_id`: true | the same | true (right) |
| Row 9, `isAlive` of a closed pane or workspace | exit 0, `pane_not_found` without a result: **false** | exit **1**, the envelope on stderr, empty stdout | **rejects** ("could not answer"): a **false unknown**, where "gone" is expected |
| Row 9, another terminal (restart) | exit 0, `result.pane` with another text `terminal_id`: false | the same (`otherterm_pane_get`, `restart2_after_pane_get_aohd1`) | false (right) |
| Row 9, no server | a failed command: reject | exit 1, `server_not_running` on stderr | rejects (right by R4), but not as `RUNTIME_NO_SERVER_ERROR_CODE` (W-6) |
| Row 8, process list of a live pane | exit 0, `process_info` for the requested `pane_id` | the same; fields `pid`, `name`, `cmdline`, `argv`, `cwd`; `shell_pid`; no `tty` | the list; the stand-in matches `CLAUDE_PROCESS_RE` by name and command line (right) |
| Row 8, a closed pane | exit 0, `pane_not_found`: `[]` | exit **1**, stderr | **rejects** ("the command failed"): a **false unknown**, where `[]` is expected |
| Row 8, another terminal | not a row form (the list has no terminal identity) | exit 0, the list of the new terminal | the list: `false` for a shell, **`true` if the new terminal runs claude** (section 5.4) |

### 4.3 Answers that changed since 0.8.0

The 0.8.0 rule (0003 section 8, index.ts lines 95-96, R4 rows 8 and 9): an error is an envelope on
stdout with exit 0. Counted in the matrix of 4.1, 21 answers differ from that rule or from a recorded
0.8.0 value:

- closed pane: 9 (`pane get`, `pane process-info`, the two `pane read`, `agent prompt`, `pane
  send-text`, `pane send-keys`, `pane run`, `pane close`): exit 1, stderr;
- closed workspace: 10 (the same 9 and `workspace close`): exit 1, stderr;
- another terminal: 2 (`agent prompt`: exit 1, stderr; `pane read --source recent-unwrapped`: text,
  where 0.8.0 gave nothing for a pane without an agent).

Not counted, because no 0.8.0 value is recorded: the no-server answers (0.9.5: exit 1,
`server_not_running`), `agent_blocked`, and the close of the only pane. Also changed: protocol 19 to
22, the first task as `done`, and `workspace_group_close_required` (sections 2 and 6).

## 5. The IDs that herdr emits (M-4)

### 5.1 Grammar

- Workspace: `w` + counter. Measured 1 to 45 and on (`ids/workspace_create_g*.json`):
  `w1`...`w9`, `wA wB wC wD wE wF wG wH wJ wK wM wN wP wQ wR wS wT wV wW wX wY wZ`, `w0`, `w11`...`w19`,
  `w1A`...`w1D`, then `w1E`...`w1R` later. That is bijective base 32 over
  `123456789ABCDEFGHJKMNPQRSTVWXYZ0` (the Crockford symbols without `I L O U`; `0` stands for 32, so 32
  is `0`, 33 is `11`, 64 is `10`). M-4 found `wA`, `wB`, `wC` on 0.8.0; the same.
- Pane: `<workspace>:p` + a counter per workspace with the same symbols: `w4:p1`...`w4:p9`, `w4:pA`...
  `w4:pF` (`ids/pane_split_w4_*`).
- Tab: `<workspace>:t` + counter (`w1:t1`).
- Terminal: `term_` + **13 hex digits of the creation time in microseconds since the epoch** + the
  terminal counter of the server run in hex, without a separator or padding. Examples:
  `term_65e7369ca94591` = 16:07:29.397849 + counter 1; `term_65e73767b713910` = counter 0x10. The 0.8.0
  IDs of h5 have the same form (`term_65e609a1e4fd41`: 2026-10-21 17:40:55.813076 + 1).
- `pane_id` and `workspace_id` are stable within a run; the field `number` is the position and changes
  when a workspace closes (`onlypane_confirm_on_after_workspace_list`: `w3` has `number` 1).
- Server or session identity: none in `status server --json` or `ping` (no server ID). The identity
  available is the session name, the socket path, and the peer PID with its start ticks
  (`sock.py`: peer 2914035, start ticks 19262782, the server PID). Internal pane numbers (`pane_id=43`
  in the server log) are not in the API.

### 5.2 Reuse within one server run: none

- After `w1` and `w2` closed, the next workspace was `w4` (`reuse_workspace_create_after_w1_w2_closed`).
- After `w4:pE` closed, the next pane was `w4:pF`; after `w3:p2` closed, `w3:p3`
  (`reuse_pane_split_*`). This repeats design r3 h1 on 0.9.5.

### 5.3 Across a server restart

- `server stop` and a new start of the same session restore every workspace and pane with the **same
  workspace, pane and tab IDs and labels**, and **every terminal ID is new**; the agent processes are
  gone (the panes run a new shell; `resume_agents_on_restore` needs herdr's integrations, which AO does
  not install) (`restart_before_api_snapshot`, `restart_after_api_snapshot`: 43 workspaces, 57 panes, 0
  terminal IDs the same). This repeats h5 2b.
- The pane counter of each workspace is saved (`session.json`: `next_public_pane_number`): after the
  restart, `w3` split gave `w3:p4` (`restart_after_pane_split_w3`).
- The workspace counter is **not** saved. After restart 1 the next workspace was `w1E` (the highest open
  was `w1D`). Before restart 2, `w1Q` and `w1R` were made and closed while `w1P` was the highest open
  one; after restart 2 the next new workspace was **`w1Q` again** (`restart2_after_workspace_create_next`).
  After restart 3 the new AO session `aohd-4` got **`w1P:p1`**, the pane ID of the closed session
  `aohd-3` (`falsealive_ao_spawn_aohd4`), and `aohd-5` got `w1Q:p1` (used twice before).
- A reused workspace ID starts its panes at `p1` again.
- After `server stop` the socket files are removed: a client gets `ENOENT`.

### 5.4 Two records with one pane ID (`falsealive_*`)

After AO's own advice ("close it by hand"), the operator closed `w1P` of `aohd-3`; after a restart,
`aohd-4` got `w1P:p1`. The records of `aohd-3` (`terminalId term_65e73927afb5a43`) and `aohd-4`
(`term_65e73a3ad5f653c`) then name the same pane. `pane process-info --pane w1P:p1` lists the claude of
`aohd-4`. AO stayed right because every caller checks `isAlive` (with the terminal) first: `ao status`
showed `aohd-3` `exited`, and `ao send aohd-3` failed without a delivery. A `workspace close w1P` from the
record of `aohd-3` (the old `destroy`, or the operator who follows the "Next" text without a check) would
close `aohd-4`.

## 6. The three release-note paths

### 6.1 `workspace close` and `--group` (v0.9.0) — `group_*`

| Step | Answer |
| --- | --- |
| `workspace create --cwd /tmp/aohd/repo2` (primary), `--cwd /tmp/aohd/repo2-wt-ao` (a git worktree, as AO) | `w1G`, `w1H`; `worktree: null` for both at create; later `w1G` shows `worktree.is_linked_worktree: false` |
| `worktree create --workspace w1G --branch native1` | `w1J`, `worktree.is_linked_worktree: true`, `repo_key /tmp/aohd/repo2/.git` |
| `workspace close w1G` | exit **1**, `{"error":{"code":"workspace_group_close_required","message":"workspace has linked worktree workspaces; use --group (close_group=true in the API) to close the group"}}`; nothing closed |
| `workspace close w1J` (the linked one) | exit 0, `ok` |
| `workspace close w1G --group` (with a new linked `w1K`) | exit 0, `ok`; `w1G` and `w1K` closed; `w1H` (AO-like) stays |
| `workspace close wZ --group` (a plain workspace) | exit 0, `ok` |
| `workspace close w1H` (AO-like) | exit 0, `ok` |

No close removed a git worktree or a branch. What AO's `destroy` does now: an AO workspace is not a
primary, so `workspace close <id>` closes it. Only if someone runs `herdr worktree create --workspace
<AO workspace>` does the close fail with `workspace_group_close_required`; `destroy` then swallows the
error and closes nothing (W-5).

### 6.2 The first task counts as `done` (v0.9.2) — `_logs/poll-m3-*.txt`, `_logs/poll-m2-*.txt`

On an unfocused pane: `unknown` (0.3 s, agent found) → `idle` (3.6 s) → prompt → `working` (0.85 s after
the prompt) → **`done`** (0.6 s after the turn ended), and it stays `done`. Every later turn: `done` →
`working` → `done`. A pane that is the only workspace is focused even with `--no-focus`
(`live_workspace_create_m1`).

What AO reads then:

- Settle gate (`SETTLED_STATES` = `idle`, `done`, `blocked`): `done` is settled, so the gate opens at
  once for every send after the first turn.
- Delivery evidence (`promptWasConsumed`): from `done` only `working` counts. For a 3 s turn herdr
  showed `working` 0.8 to 1.3 s after the prompt. A 0.15 s turn showed no `working` in 4 of 6 tries
  (100 ms poll): then AO sends again (section 3.4, W-4). The shortest turn that herdr always shows was
  not measured.
- `agent get` has `state_change_seq` and `completion_seq`; in a second test of 3 short turns they moved
  only on the one turn that herdr saw as `working`, so they do not fix a short turn.

### 6.3 Closing the only pane (v0.9.4, `ui.confirm_close`) — `onlypane_*`

| `confirm_close` | Pane | Answer |
| --- | --- | --- |
| true | `w1:p1` (claude stand-in) | exit 0, `ok` in 125 ms; `w1` is gone |
| true | `wY:p1` (shell) | exit 0, `ok`; `workspace get wY`: `workspace_not_found` |
| false (after `server reload-config`: `applied`) | `wX:p1` (shell) | exit 0, `ok`; `wX` is gone |
| false | `w1Q:p1` (claude stand-in, `idle`) | exit 0, `ok`; the pane is gone |

The API call never asks and never waits; it closes the pane and its workspace. `workspace close` of a
workspace whose agent runs also closes at once (`closews_workspace_close_w2`). `confirm_close` is a TUI
setting.

## 7. How herdr classifies the stand-in

- The stand-in (`_setup/claude-standin.sh`) is a bash script named `claude`; its process has the name
  `claude` and the command line `/usr/bin/bash /tmp/aohd/bin/claude <args>`. It draws the forms of the
  bundled manifest (`_setup/claude_manifest_bundled_2026.10.11.1.toml`, extracted from the binary with
  `_setup/extract_manifest.py`): the terminal title `✳ Claude Code` (rule `osc_title_idle`), a prompt
  box `────` / `❯` / `────` (`live_prompt_box`, idle), a braille title `⠋ ...` and `✻ Thinking… (1s ·
  esc to interrupt)` while it works (`osc_title_working`, `live_turn_working`), and a Bash permission
  dialog (`bash_permission_prompt`, blocked). It must clear the `✻ …` line at the end of a turn, as a
  real claude does; else the pane stays `working`.
- Identity: herdr detects the agent from the process, not from the screen. The same script under the
  name `fakeagent` drew the same screen and got `agent: null` and `agent_status: unknown`
  (`detect_other_name_pane_get`, `detect_other_name_agent_explain`: `agent_not_found`).
- `agent explain -v` (`live_agent_explain_m1_text`) shows each rule and its evidence; `--json` also
  (`live_agent_explain_m1`, `blocked_agent_explain`).
- Limits of the stand-in:
  - AO's activity column for claude-code reads Claude's JSONL; the stand-in writes none, so `idle` in
    `ao status` says nothing about herdr's state.
  - `interactive_ready` and `launch_pending` were absent: herdr fills them perhaps only through its
    integrations (not installed). Whether a real claude reports them is open (section 13).
  - The cold-start drop is modelled (a fixed window), not measured on a real claude.
  - Real Claude timings (boot, turn length, how long `working` shows) were not measured.

## 8. What doc 0004 must change

1. Section 1 (prerequisites): name the session. A plain `herdr server` uses
   `$XDG_CONFIG_HOME/herdr/herdr.sock`; `herdr --session <name> server` uses
   `$XDG_CONFIG_HOME/herdr/sessions/<name>/herdr.sock`. AO calls plain `herdr`, so it reaches only the
   default session. `herdr server` now prints "did you mean to open the Herdr TUI?".
2. "Verified against herdr 0.8.0" must say which facts hold on 0.9.5 (protocol 22) and point to this
   document.
3. Sections 3 and 6.2: "`ao send` works" stays true for an idle or done agent, but add: a `blocked`
   agent refuses the prompt (`agent_blocked`) and `ao send` fails (W-3); a short turn can be delivered
   more than once (W-4).
4. Section 4.1: `ao open` / `ao session attach` start `herdr agent attach <pane>`; 0.9.5 adds
   `--takeover`.
5. Section 5: the cold-start cost on 0.9.5 is 12.6 s from the first to the second attempt (18.5 s
   spawn with AO's fixed 3 s wait); herdr reports `idle` 3.6 to 4.1 s after `pane run` (0.8.0: about
   2 s). The first task ends in `done`, and later sends start from `done`, where only `working` is
   evidence. For a 3 s turn herdr shows `working` 0.8 to 1.3 s after the prompt. `agent get` now has
   `interactive_ready`, `launch_pending`, `state_change_seq`, `completion_seq` (section 8 of 0004 asks
   for such a signal; not yet usable, section 7). `--wait` has a 5 s stall rule.
6. A new section on errors: a failed CLI call exits 1 and prints the envelope on stderr; with no server
   the code is `server_not_running`. 0003 section 8 and the comment in index.ts (lines 95-96) say exit
   0.
7. `pane read --source recent-unwrapped` returns the shell text for a pane with no agent; 0.8.0
   returned nothing (index.ts lines 16-18, 479-482).
8. IDs: "Pane ids are positional and can be reused after a workspace is closed" (index.ts:384-386):
   not within one run; yes after a restart, for workspaces above the highest open one (section 5.3).
9. Section 8 (known gaps): add the group close (section 6.1) and that a `pane close` of the only pane
   closes the workspace without a question (section 6.3).
10. `herdr status server` with no server exits 0 with `status: not running`; the text has more lines.

## 9. What RH (design r4 section 7) and review r4 M-4 need from these answers

1. **The ID check of 7.2.** `^w[0-9]+:p[0-9]+$` rejects `wA:p1` (M-4). The measured grammar is
   `^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$` (uppercase only; lowercase is `pane_not_found`). The
   terminal check `^term_[0-9a-f]+$` matches every emitted terminal ID (13 hex digits of time + a hex
   counter). `pane_not_found` still answers a malformed ID (`not a pane`, `aohd-1`, the empty ID), so the
   check before the request stays needed.
2. **7.3 versions.** The qualified pair must become `0.9.5` / protocol `22`. The socket `ping` gives
   both (`sock_ping`). Non-reuse within one run is measured on 0.9.5 (section 5.2).
3. **Reuse across a restart is real on 0.9.5.** The incarnation rule of 7.2 covers it: after a restart
   the peer is another process, `pane_info` with any terminal gives `other-launch`. The measured case
   (section 5.4: `aohd-4` on `aohd-3`'s pane ID) is that row. A test of RH must include a reused
   workspace ID with a new claude in it.
4. **The peer.** `SO_PEERCRED` gives the server PID (one process; `detached_server_daemon: false`), and
   its start ticks are readable. A stopped server removes its sockets: `ENOENT`.
5. **The socket envelopes did not change form**, so RH's socket client avoids the CLI exit-code change.
   The stand-in server of 7.5 must answer the 0.9.5 codes: `pane_not_found`, `workspace_not_found`,
   `agent_not_found`, `agent_blocked`, `workspace_group_close_required`, `invalid_request` (not
   re-measured), each an "unknown code" unless 7.2 names it. `server_not_running` is a CLI code only (no
   socket answers it).
6. **The close.** RH must never send `close_group: true`: it closes the operator's linked worktree
   workspaces. A `workspace.close` of an AO workspace that became a primary answers
   `workspace_group_close_required` and closes nothing: read it as `unknown`. A `pane.close` of the only
   pane closes the workspace too, with no question (section 6.3), so for AO's one-pane workspaces a
   pane close is a workspace close.
7. **M-4's other points** (EACCES, partial answers, peers that change on each connection) need the RH
   classifier; this check measured only real answers and does not cover them.
8. Until RH: the CLI path can no longer see `pane_not_found` (W-1, W-2). If the R4 reads keep the CLI,
   they must read the envelope from stderr when the exit code is 1, and accept only that form.

## 10. Code that reads a 0.9.5 answer wrongly

No fix was made. Each item names the answer and its fixture.

- **W-1** `packages/plugins/runtime-herdr/src/index.ts:219-222` (`herdrResult`), `:246-254`
  (`getPaneStrict`), `:497-508` (`isAlive`). Answer: `pane get` of a closed pane or workspace, exit 1,
  `{"error":{"code":"pane_not_found",...}}` on stderr (`closedpane_pane_get`, `closedws_pane_get`).
  `execFileAsync` rejects, the error has no `herdrCode`, so `isAlive` rejects ("could not answer")
  instead of `false`. Effects, from the code with this answer: the lifecycle keeps a session whose
  workspace the operator closed (`probe.outcome = "failed"`, lifecycle-manager.ts:640-644) for as long
  as the server runs; `ao send` reads the rejection as alive (`session-manager.ts:3804`,
  `.catch(() => true)`), waits the 15 s settle and fails in the fallback (as `noserver_stopped_ao_send`).
- **W-2** `packages/core/src/herdr.ts:72-78` (and the unreachable branch `:97-103`). Answer: `pane
  process-info --pane <closed>`, exit 1, `pane_not_found` on stderr (`closedpane_pane_process_info`,
  `closedws_pane_process_info`). It rejects ("the command failed") instead of `[]`; the agents'
  `isProcessRunning` on Herdr rejects.
- **W-3** `index.ts:62` (`SETTLED_STATES` has `blocked`), `:448-454` (`agent prompt`),
  `packages/core/src/session-manager.ts:4005-4026` (a send failure forces a restore), and
  `packages/cli/src/commands/send.ts:356` (no catch). Answer: `agent prompt` to a blocked agent, exit 1,
  `agent_blocked` (`blocked_herdr_agent_prompt`). `sendMessage` throws at the first attempt, no fallback
  runs, the restore refuses, and `ao send` exits 1 with a stack trace that names the restore, not
  `agent_blocked` (`ao_send_blocked`).
- **W-4** `index.ts:311-326` (`promptWasConsumed`) with `:451-458`. Answer: after the first task the state
  is `done`; for a 0.15 s turn it often stays `done` (4 of 6 tries, `_logs/poll-shortturn.txt`). AO reads no
  `working` as "not consumed" and sends again: 3 deliveries of one message
  (`shortturn_ao_send_from_done`, `_logs/standin/claude-standin.3056196.log`). A real `/clear` or a
  short slash command can do this.
- **W-5** `index.ts:395-407` (`destroy`) and `:364-369` (the cleanup in `create`). Answer: `workspace
  close` exit 1 with `workspace_group_close_required` (`group_workspace_close_primary_nogroup`) or
  `server_not_running`. Both read every failure as "already gone"; nothing was closed.
- **W-6** `index.ts:213-222` with `packages/core/src/lifecycle-manager.ts:226-233`. Answer: no server, exit
  1, `{"error":{"code":"server_not_running","message":"no herdr server is running at <socket>; ..."}}`
  on stderr (`noserver_never_pane_get`). The rejection has no `RUNTIME_NO_SERVER_ERROR_CODE`, so the
  lifecycle reads "failed" and `ao start` reads unknown (ao-64). 0.9.5 gives an explicit code that the
  plugin could map.
- **W-7** `index.ts:479-495` (`getOutput`) and its comment `:16-18`. Answer: `recent-unwrapped` of a pane
  without an agent returns the shell text (`otherterm_pane_read_recent_unwrapped`). The `visible`
  fallback is now reached only on an error. The result is right; the comment is wrong.
- **W-8** `packages/core/src/session-manager.ts:1482-1487`. A record without a runtime handle (during the
  spawn) gets the handle `{id: <session name>}`; the lifecycle worker then called `pane process-info
  --pane aohd-1` (16:15:55.74). Answer: exit 1, `pane_not_found` (`badid_pane_process_info_session_name`).
  On 0.8.0 the same call gave `[]` (no claude); on 0.9.5 it rejects. Not a wrong value now, but a call
  with a session name as a pane ID.
- **W-9** `index.ts:384-386` (comment: "Pane ids ... can be reused after a workspace is closed"). Not
  within a run; after a restart, workspace IDs are reused (section 5.3).

## 11. Deviations from the brief

- **D-1** Network: `git`, run by `herdr worktree create` in section 6.1, made a DNS query for the host's
  own name to the loopback resolver `127.0.0.53` and a UDP `connect` without data to the host's own
  address, because the scratch `HOME` had no git identity (`_logs/strace_summary.txt`). herdr made no
  `AF_INET` connection. The untraced `git` calls of AO's spawn (worktree and branch) and of the scratch
  repository setup ran with the same environment and may have made the same lookup. A next run should put
  `user.name` and `user.email` in the scratch `~/.gitconfig`.
- **D-2** `unshare -rn` is not permitted on this host (AppArmor). The isolation evidence is the config
  keys, a `PATH` without `curl`, and `strace` of every herdr process.
- **D-3** `ao send` ran only against the scratch config and the scratch sessions, because section 2.2
  asks for its timings. No `ao send` reached a real session or the orchestrator.
- **D-4** Build: pnpm 9.15.4 from its cache instead of the global pnpm 10.30.3, with `--ignore-scripts`
  (section 1.2). A first attempt with pnpm 10 left a partial `node_modules`; I removed it and installed
  again.
- **D-5** Not run: `pane close` and `workspace close` on the "another terminal" case (they would close the
  restored pane; the live close is the same call), `agent attach` (refused by the shim), the socket
  request `pane.get` without parameters and the other `invalid_request` forms of h5.
- **D-6** The first poller of `ao spawn` watched `w1L:p1`, an ID herdr never emits (`L` is not a symbol);
  `_logs/poll-ao-spawn.txt` holds only `pane_not_found` lines. The spawn timeline comes from the shim log.
- **D-7** One scratch shell received text that ran `command-not-found` and `snap advise-snap` (the
  `otherterm_` send). Neither made a network call (`_logs/strace_summary.txt`).

## 12. Cleanup and the final checks

- Stopped by exact PID (`_logs/pids.txt`): the scratch lifecycle worker 2949663 (the PID in its scratch
  pid file; its `HOME` and `AO_CONFIG_PATH` were checked first), then the herdr server 3043263 (run 4;
  its `strace` 3043254 ended with it). Server runs 1 to 3 (2842003, 2914035, 3025657) ended through
  `herdr server stop`. The pane shells and stand-ins ended with each server.
- A scan of every process of my user for `HOME=/tmp/aohd/home` in its environment or `/tmp/aohd` in its
  command line found only the scan itself: no process that I started runs. `ps -C herdr,strace` printed
  nothing. No private tmux server was started (the tmux shim was never called).
- `/tmp/aohd` (56 MB) was removed after the copy into `development/artifacts/herdr_095_live_check/`.
- `find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aohd-marker -not -name 'lifecycle-manager-*.json'
  -not -path '*/processes*' -not -name 'lifecycle-worker.log'`:

  ```text
  <home>/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
  <home>/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-66
  <home>/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-63
  ```

  None is my write; every `ao` call of mine used the scratch config and `HOME`, whose records were
  `aohd-1` to `aohd-5` under `/tmp/aohd`. `ao-66` is a new session of the real orchestrator
  (`createdAt=2026-10-22T20:20:07.086Z`, branch `feat/note-fix-...`, written 16:20:16); the `sessions`
  directory changed with it (16:20:16). `ao-63` was written at 16:00:44, 11 s after the marker and
  before my first `ao` call (16:15), by the real lifecycle or its own session.
- `find ~/.config/herdr ~/.local/share/herdr ~/.local/state/herdr ~/.cache/herdr -newer /tmp/aohd-marker
  2>/dev/null`: no output.
- `ls -la --time-style=full-iso ~/.ao/bin`: the same six lines as in section 1 (no change).
- The worktree: no file under `packages/` changed (`git status` shows only `.agent_report.md`,
  `.agent_task.md`, this document and the artifact folder; `node_modules` and `dist` from the build are
  ignored).

## 13. Open questions

1. Does a real Claude Code fill `interactive_ready` or `launch_pending` (perhaps only with herdr's
   claude integration installed)? If yes, AO's settle gate can use it (doc 0004 section 8).
2. What does a real claude do with `agent prompt` text while it shows a permission dialog on 0.8.0?
   On 0.9.5 herdr refuses it; on 0.8.0 the answer was not recorded.
3. How long does a real claude show `working` for `/clear` and other instant commands? This decides how
   often W-4 happens.
4. Should RH and the R4 reads move to the socket (unchanged envelopes) or read stderr from the CLI?

## 14. Fixtures

`development/artifacts/herdr_095_live_check/`: 212 `.cmd` files with their stdout files (76 `.json`, 136
`.txt`), `ids/` (108 files: 41 workspace creates and 13 pane splits with stdout and stderr), `_setup/`
(16 files: the shims, the stand-in, the scripts, the configs, the extracted manifest) and `_logs/` (28
files: the shim call log, the `strace` summary, the polls, the stand-in logs, the server log of the last
run, the build log, the PID log). Name prefixes: `help_*`, `live_*`, `closedpane_*`, `closedws_*`,
`otherterm_*`, `noserver_never_*`, `noserver_stopped_*`, `badid_*`, `sock_*`, `restart_*`, `restart2_*`,
`reuse_*`, `group_*`, `onlypane_*`, `confirm_*`, `blocked_*`, `shortturn_*`, `falsealive_*`, `detect_*`,
`ao_*`.

Fixtures with a JSON field named `key` or `token` (for the gitleaks hook): only `api_schema.json` (two
schema properties named `token`, `{"type": "string"}`, in `AgentViewField` and `AgentViewSortField`). No
fixture has a field named `key`. Fields with other names: `repo_key` (a path, in `group_*` and
`api_schema.json`) and `tokens` (`api_schema.json`). `gitleaks detect --no-git -c .gitleaks.toml` on the
folder: "no leaks found".
