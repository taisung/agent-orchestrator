# 0009 — Fit ao to the OpenCode 2.x API: survey results and a staged design

**Date**: 2026-10-14
**Context**: the host runs OpenCode 2.0.29 and stays on 2.x (owner decision, 2026-10-14). The three
`fix(agent-opencode)` rounds (`b90ac08f`, `6d204435`, `8ae92e83`) made OpenCode spawns work again
on 2.x, but ao still drives OpenCode the 1.x way for everything after the launch: `ao send` pastes
into the tmux pane, and activity, session info and cleanup read the CLI `session list`. The owner
chose one arc with four parts: (1) drop the 1.x branch, (2) `ao send`, activity state and cost
through the 2.x API, (3) fix the `ao start` install option, (4) a 2.x pane census for the OpenCode
rules of `~/agent-skills/scripts/fleet_watch.sh` (agent-skills decision D-28).
**Status**: phase 1 only: a read-only survey and this design. No source, test or config file
changed. The staged plan in §13 needs owner approval per increment; §14 lists the measurements that
need a model turn, and §15 the open questions.

All facts below carry their source. "Measured" means a command in this survey printed it.
"Read" means the text comes from a file, the OpenAPI document or the 2.0.29 binary, without a run
that shows the behavior. The survey ran on 2026-10-14 between 21:15 and 21:35 EDT (the first global `opencode api` read
of this survey is logged at `2026-10-15T01:15:54Z`).

---

## 1. Results

1. **The 2.x API covers every OpenCode operation that ao needs**, through `opencode api
   <operation>` against the background service: session create, get, list with search, remove,
   prompt (send), interrupt, active sessions, pending permissions and forms (questions), message
   history, and cost and tokens on the session record (§3, §4).
2. **An idle 2.x pane looks busy to ao today.** The plugin's `detectActivity` classified a
   captured idle 2.x TUI pane as `active` (measured, §5.1). By the code that reads it, `ao send`
   without `--no-wait` then waits its full 600 s timeout for an idle OpenCode worker, and the
   activity JSONL fallback keeps reporting `active`.
3. **Activity can come from positive API records**: `session.active` lists a session while its
   agent loop runs, `session.permission.list` and `session.form.list` list the pending permission
   prompts and questions, and the session record carries `time.idle` and `outcome`. Idle values are
   measured. Busy, permission, question and error values need a model turn (§5, §14).
4. **An attached TUI is invisible to the API.** With a TUI attached to an isolated session, no
   operation and no event changed (measured, §5.3). A spawn check must therefore read the pane
   process, and use the API only for the session.
5. **Cost and tokens are on the session record** (`cost` in USD, `tokens.input/output/reasoning/
   cache.read/cache.write`; as-63: `0.0014781`, 14499 input, 11 output, 130 reasoning). Today the
   plugin returns no cost, and no ao command prints cost (§7).
6. **npm does have OpenCode 2.x**, under another package name: `@opencode/cli` (latest `2.0.29`,
   bin `opencode` and `opencode2`, repository `anomalyco/opencode`). The round-1 audit row 11 and
   the agent-skills tracking entry say "npm has no 2.x release"; that is true only for
   `opencode-ai` (latest `1.19.0`). The host's binary most likely came from the v2 curl installer
   `https://opencode.ai/v2/install` (§8).
7. **On 2.x the TUI submits the launch prompt** (as-63: the 2134-character launch prompt is the
   first `user` message, written 1.5 s after the TUI started). The agent-skills text that calls
   OpenCode "patient" and says it "discards the spawn prompt" is wrong for 2.x (§10).
8. **`ao spawn` cannot see a failed launch script**: the tmux runtime types the script into an
   interactive shell and returns; nothing reads its exit status (§11). The fix needs the session
   to be created by ao in Node before the pane starts, then a positive check of the pane.

## 2. Method and safety

- **Global service, read only.** The survey ran only `opencode api` reads against the host's
  background service (PID 4171365): `GET /openapi.json`, `server.info`, `session.list`,
  `session.get`, `session.message.list`, `session.active`, `session.inbox.list`,
  `session.permission.list`, `session.form.list`, `permission.request.list`, `session.log`. It did
  not create, prompt, change, abort, share, fork, delete or summarize a global session, and it did
  not stop or signal the service.
- **Isolated service for writes.** Every operation that writes ran against an isolated store:
  `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` under `/tmp/ao1s-home`,
  a copy of the 2.0.29 binary, and port 49413 (`opencode service set port 49413`; `server.info` →
  `{"version":"2.0.29","pid":2440974,...}`). The isolated store had no provider credentials, and no
  operation started a model turn (`session.prompt` ran only with `"resume": false`).
- **No credential copy**, no `opencode auth`, no installer and no upgrade run. The v2 installer
  script was downloaded as text only (§8).
- Read-only sources: `~/.local/share/opencode/log/opencode.log` (26.5 MB), the npm registry
  (`npm view`), the ao source at `f5a87010`, the agent-skills files named in §9 and §10.
- The service needs HTTP basic auth (user `opencode`, the password in the store's
  `service.json`). Without it, and with a bearer header, the isolated service answered 401
  (measured). `opencode api` adds the auth itself, so ao never reads the password.

## 3. The API surface (survey item 1)

**Access.** `opencode api [flags] <operation | method path...>`, with `--server`, `--standalone`,
`-d <json body>`, `-H`, `--param key=value` (`opencode api --help`, read). The CLI finds and
authenticates to the background service. When the service is missing, the CLI starts it: the log
line `2026-10-14T20:22:31.455Z ... message="background service starting" reason=missing` came from
a TUI start (read). One `opencode api` call takes about 140 ms: four consecutive calls started at
21:20:18.325, .469, .607 and .748 EDT (measured, isolated).

**Document.** `opencode api GET /openapi.json` returns OpenAPI 3.1.0, `info.title` "opencode
HttpApi", version 0.0.1, description "Experimental HttpApi surface for selected instance routes":
142 operations in 118 paths (measured; the global and isolated copies are byte-identical, 276536
bytes). `GET /doc` returns the web app HTML, not the document. "Experimental" means the surface
can change between 2.x releases, so every ao call must handle a schema change as an error, not as
an empty result.

**Operations that ao needs** (read from the document; "measured" where a call ran):

| Operation | Method and path | Use for ao | Notes |
|---|---|---|---|
| `session.create` | POST `/api/session` | spawn | body `id, parentID, title, agent, model, location, metadata, permissions`; in use since `b90ac08f` |
| `session.get` | GET `/api/session/{sessionID}` | readback, activity, cost | 404 `SessionNotFoundError` (measured after a remove) |
| `session.list` | GET `/api/session` | title search, remap | query `limit, order, search, parentID, directory, project, subpath, cursor`; returns `{data, cursor}` |
| `session.switchModel`, `session.switchAgent` | POST | existing session, restore | in use since `b90ac08f` |
| `session.prompt` | POST `/api/session/{id}/prompt` | `ao send` | body `text*` and `id, files, agents, skills, metadata, delivery (steer\|queue), resume`; "Durably admit one session input and schedule agent-loop execution unless resume is false"; 404, 409 `ConflictError` |
| `session.active` | GET `/api/session/active` | busy | "foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive"; value `{"type":"running"}` |
| `session.permission.list` / `.reply` | GET / POST | permission wait | pending requests of one session |
| `session.form.list` / `.reply` | GET / POST | question wait | `Form.Info {id, sessionID, title, metadata, fields}` |
| `session.inbox.list` / `.cancel` | GET / DELETE | send confirmation | admitted inputs that no turn took yet |
| `session.message.list` | GET `/api/session/{id}/message` | prompt delivery check, summary | query `limit, order, cursor, type` |
| `session.interrupt` | POST | kill, stop | `{"interrupted":false}` when idle (measured) |
| `session.remove` | DELETE | kill `--purge-session`, cleanup | 204 (measured) |
| `experimental.session.wait` | POST | send wait | "Wait for a session agent loop to become idle"; returned at once with exit 0 on an idle session (measured) |
| `event.subscribe` | GET `/api/event` (SSE) | optional push | "Volatile by contract: a slow consumer overflows and fails the stream"; payload type is only a JSON string in the document |
| `session.log` | GET `/api/experimental/session/{id}/log` (SSE) | none | see §5.2 |
| `experimental.session.stats` | GET | none now | aggregate tokens and cost over a range |
| `server.info` | GET | version check | `{"version":"2.0.29",...}` (measured) |

**`session.list` scope (measured).** The API list spans every project: `session.list --param
limit=200` from `/tmp` returned 200 sessions in 6 `projectID` values (Nexus, agent-skills,
`global` and others). The CLI `opencode session list` lists only the project of the current
directory (round-1 audit row 3). `search` matches a substring: `--param search=AO:as-6` returned
the session titled `AO:as-63`. A title lookup must therefore filter for the exact title after the
search.

**SSE through the CLI.** `opencode api` buffers an SSE response and loses it when `timeout` kills
the CLI (measured, isolated). A long-lived subscriber must use direct HTTP with the service
password, which ao does not have. §15 Q3 asks the owner about this.

## 4. Mapping: each ao use of OpenCode to a 2.x operation (survey item 2)

Rows 1 to 13 are the round-1 audit rows (`~/.cache/agent-skills-haiku55-arc/ao-1-report-r1.md`).
Rows 14 to 24 are the uses that the brief adds. "Keep" means no change for this arc.

| # | ao use (file) | Today | 2.x operation | Decision | Reason |
|---|---|---|---|---|---|
| 1 | new-session launch (`agent-opencode/src/index.ts` `getLaunchCommand`) | pane script: 2.x `session.create` + `session.get` readback; 1.x `run --command true` | `session.create`, `session.get` from Node, before the pane starts | change (I-1, I-3) | spawn can fail on a failed create, and ao stores the ID it created (§11) |
| 2 | final TUI exec | `exec opencode --session "$SES_ID" [--prompt P]` | none: the TUI stays the runtime | keep | the TUI is what the human attaches to |
| 3 | 1.x title fallback in the launch | `opencode session list` + node lookup | none | remove (I-1) | 1.x only; it keeps the conversation-identity risk of the round-3 review |
| 4 | existing-session path | `switchModel`, `switchAgent`, `session.get` readback in the pane | same operations, from Node | keep in I-1, move in I-3 | already API on 2.x |
| 5 | `getRestoreCommand` | ID from metadata, else CLI list by title | `session.get` by stored ID | change (I-2) | no title guess on restore |
| 6 | `findOpenCodeSession` (activity, info, restore) | CLI `session list --format json`, then ID or title | `session.get` by ID | change (I-2) | the CLI list sees only the current directory's project |
| 7 | `detect()` | `opencode --version` exits 0 | same, plus major ≥ 2 | change (I-1) | after the drop, a 1.x binary must not count as available |
| 8 | `isProcessRunning` | pane tty + `ps` | none | keep | no API signal for an attached TUI (§5.3) |
| 9 | `deleteOpenCodeSession` (`core/src/session-manager.ts:91`) | CLI `session delete` | `session.remove` | change (I-2), low priority | one client path; CLI works on 2.x |
| 10 | `fetchOpenCodeSessionList` (`core/src/session-manager.ts:121`) | CLI `session list` | `session.get` by ID, or `session.list --param search=AO:<id>` + exact title | change (I-2) | project scope, exact match |
| 11 | `ao start` install (`cli/src/commands/start.ts:359-364`) | `npm install -g opencode-ai` (1.x) | none | change (I-6) | installs 1.19.0 (§8) |
| 12 | `cli/src/lib/detect-agent.ts:21` | calls `detect()` | through row 7 | through row 7 | |
| 13 | `core/src/plugin-registry.ts:46` | package name only | none | keep | |
| 14 | `ao send`, tmux (`cli/src/commands/send.ts:104` `sendViaTmux`, then up to 2 extra Enter keys) | paste into the pane | `session.prompt` | change (I-5), after M-4 | no paste, no Enter guess, an admitted-input ID |
| 15 | send through core (`core/src/session-manager.ts` `sendWithConfirmation`, `getOpenCodeSessionUpdatedAt` at :2029) | `runtime.sendMessage`, confirmation by CLI list `updated` | `session.prompt` returns `Session.Inbox.User {id, delivery}` | change (I-5) | the response confirms admission |
| 16 | `getActivityState` | AO JSONL from pane text, then CLI list `updated` | `session.active`, `session.get`, `session.permission.list`, `session.form.list` | change (I-4) | positive records (§5) |
| 17 | `detectActivity` / `recordActivity` | pane regexes | none | change (I-4) | returns `active` for an idle 2.x pane (§5.1) |
| 18 | cost and tokens (`getSessionInfo`) | none ("OpenCode doesn't expose token/cost data") | `session.get` `cost`, `tokens` | change (I-4) | §7 |
| 19 | summary (`getSessionInfo`) | session title `AO:<id>`, `summaryIsFallback: true` | `session.message.list` last assistant text, optional | keep in this arc | the title is ao's own label; a summary is a separate decision |
| 20 | `ao session kill --purge-session` (`session-manager.ts:1789-1812`) | CLI `session delete` | `session.interrupt`, then `session.remove` | change (I-2) | stop a running loop before the delete |
| 21 | `ao session cleanup` purge (`session-manager.ts:1934-1947`) | CLI `session delete` | `session.remove` | change (I-2) | same as row 9 |
| 22 | `ao session remap` (`session-manager.ts:2363-2379`, `cli/src/commands/session.ts:407`) | CLI list by title | `session.list --param search` + exact title | change (I-2) | keep only as a manual repair |
| 23 | title discovery after spawn and orchestrator start (`session-manager.ts:1207-1219`, `:1610-1623`) | CLI list by title, 10 s | none: the ID comes from the Node create | remove (I-3) | it can bind an older session with the same title |
| 24 | issue and orchestrator reuse (`resolveOpenCodeSessionReuse`, `:585-615`) | stored ID, then title discovery | `session.get` by stored ID | change (I-2), see Q7 | title reuse is the identity risk |

## 5. Activity state (survey item 3)

### 5.1 What ao does today

`getActivityState` (`index.ts:546-590`) checks the pane process, then the AO activity JSONL that
`recordActivity` writes from pane text, then the CLI list `updated` time, then the JSONL fallback.
`detectActivity` (`index.ts:527-544`) returns `idle` only when the last pane line is a bare
`>`, `$` or `#`, `waiting_input` for four 1.x prompt texts, and `active` for everything else.

Measured: the survey captured an idle 2.x TUI pane (isolated, no turn, empty inbox). Its last rows:

```
  ┃  Build · Muse Spark 1.3 Contributor OpenCode Go · xhigh
  ╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
  /tmp/ao1s-work:main                    shift+tab agents  ctrl+p commands    /tmp/ao1s-work:main
```

`create().detectActivity(<that capture>)` from the built plugin (`dist/index.js`, 27340 bytes)
printed `active`. Consequences: `ao send` without `--no-wait` (`send.ts:178-206`) waits the full
`--timeout` (default 600 s) and then prints "Timeout waiting for idle. Sending anyway."; and
`recordActivity` keeps writing `active` entries for the unchanged idle screen, so the JSONL
fallback keeps reporting `active`. These two effects are read from the code, with the measured
classification as input. The CLI list path still gives an age-based `ready`/`idle`, but only while
`opencode session list` from the ao process directory sees the session (row 6).

### 5.2 What the API shows (measured)

- **Idle session record** (as-63, global, read only): `outcome "succeeded"`, `time {created
  01:11:48.813Z, updated 01:11:52.277Z, idle 01:11:52.284Z}` (2026-10-15 UTC). `time.idle` is 7 ms
  after `time.updated`. Of 200 recent global sessions, 8 have an `outcome` (all `succeeded`); the
  other 192 have none, which fits sessions that were made before 2.x or never ran a turn.
- **Message records** (as-63 `session.message.list`): `agent-switched` (01:11:50.586Z), `user` (the
  launch prompt, 01:11:50.668Z), `assistant` (`finish "stop"`, `time {created, streamed,
  completed}`, `cost`, `tokens`, text `OK`), `idle` (`outcome "succeeded"`, 01:11:52.284Z).
- **Idle reads**: `session.active` → `{"data":{}}`; `session.inbox.list`, `session.permission.list`
  and `session.form.list` on as-63 → empty; `permission.request.list` →
  `{"location":{"directory":"/home/taisung"},"data":[]}`. A `location=<path>` query gave 400
  "Expected object | undefined", so the per-session lists are the usable form.
- **Event stream** (`curl -sN /api/event`, isolated): `server.connected`, then `: heartbeat`
  comments, and these durable events with `durable {aggregateID, seq, version}`:
  `session.created` (with `title`, `agent`, `model`, `location`), `project.updated`,
  `session.inbox.enqueued` (with `item {type, payload.text}` and `delivery`), `session.renamed`,
  `session.agent.selected` (`agent`, `previous`), `session.inbox.cancelled`, `session.deleted`.
  The stream had no `location` filter and still delivered the isolated work directory's events.
- **`session.log` does not replay.** On as-63, `after=0`, `1` and `5` each returned only
  `{"type":"log.synced",...,"seq":13}`; `after=-1` gave 400. In the isolated run, a `follow=true`
  stream returned only `log.synced` seq 1 while seq 2 to 9 happened. ao cannot use it.
- **Inbox**: `session.create` with agent `plan` enqueued a synthetic steer item ("You are in Plan
  mode ..."), and `switchAgent` to `build` enqueued a second one ("You are NO LONGER in Plan
  mode"). `session.prompt` with `resume:false` admitted a `user` item with delivery `steer`; the
  message list did not show it, `session.active` stayed `{}`, and tokens stayed 0.

### 5.3 An attached TUI (measured, isolated)

The survey attached `opencode --session <id>` with no prompt on a private tmux server for about 5 s. During
the attach: `session.active` → `{}`, `pty.list` → `[]`, `server.experimental.persistentPty.list` →
`[]`, `session.get` `time` → `{created, updated}` with no `viewed`, and the event stream delivered
no event. The TUI is a client of the background service: in the as-63 log, the TUI run
(`role=cli`) logged "event stream connected component=client", and the service run (`role=server`)
booted the as-63 location at the same second (read).

### 5.4 State model from the 2.0.29 binary (read, needs M-3)

The binary's own notification plugin (`id:"opencode.notifications"`) maps events to states:
`form.created` → "Input needs response" (question); `permission.asked` → "Permission needs input";
`session.execution.started` → running; `session.execution.succeeded` and `.interrupted` → "Session
done"; `session.execution.failed` → `error.message` and "Session failed". Other event names in the
binary: `session.idle`, `session.status`, `session.error`, `session.step.started/ended/failed`,
`session.usage.updated` (with `cost` and `tokens`), `session.retry.scheduled`, `form.replied`,
`form.cancelled`, `permission.replied`, `session.inbox.delivered`.

### 5.5 Proposed `getActivityState` for 2.x

The CLAUDE.md cascade stays. Each step uses a positive record (D-28 shape: name the record that
proves the state):

1. Pane process not running → `exited` (unchanged).
2. `session.permission.list` or `session.form.list` not empty → `waiting_input`.
3. `session.active` holds the ID → `active`, timestamp now.
4. Not active and `outcome == "failed"` with `time.idle` newer than the last user input →
   `blocked` (M-3 decides the exact record).
5. Not active → age of `time.idle` (else `time.updated`): `active`/`ready`/`idle` by the existing
   windows.
6. API error or timeout → the JSONL fallback `getActivityFallbackState`, as required.
7. No data → `null`.

Cost per poll and session: four `opencode api` calls, about 0.6 s. `session.active` is one call for
all sessions; a later step can share it across sessions in one lifecycle tick.

## 6. Send through the API (survey item 4, open item)

Proposed method: `opencode api session.prompt --param sessionID=<id> -d '{"text":"<message>",
"delivery":"queue"}'`. The response is the admitted inbox item (`Session.Inbox.User {id,
sessionID, time, type, payload, delivery}`), so ao has a positive delivery record and needs no pane
paste, no Enter retry and no screen-diff confirmation.

Measured without a model turn: admission with `resume:false` works, the inbox shows the item, and
`session.inbox.cancel` removes it (§5.2). Not measured, because each one needs a model turn (M-4,
M-5): whether the attached TUI shows the admitted message and the streamed answer; that the turn
runs once (not once in the service and once in the TUI); `steer` against `queue` while a turn
runs; and a send while a permission prompt waits. Until M-4 passes, `ao send` keeps the tmux
paste for OpenCode.

## 7. Cost and tokens (survey item 5)

as-63 (global, read only), `session.get`: `cost 0.0014781`, `tokens {input 14499, output 11,
reasoning 130, cache {read 0, write 0}}`, model `opencode-go/muse-spark-1.3-contributor` variant
`default`. The single assistant message carries the same cost and tokens. Proposed mapping to
`CostEstimate`: `inputTokens = input + cache.read + cache.write` (the claude-code plugin adds its
cache reads and writes the same way, `agent-claude-code/src/index.ts:377-379`), `outputTokens =
output + reasoning` (see Q8), `estimatedCostUsd = cost`. No ao command prints `cost` today: `ao
status` reads only `summary` from `getSessionInfo` (`cli/src/commands/status.ts:102`, `:513`).

## 8. The `ao start` install (survey item 6)

Facts:

- `start.ts:359-364` offers `npm install -g opencode-ai` only when no agent is found and a prompt
  is possible (`promptInstallAgentRuntime`, `:367-403`).
- npm `opencode-ai`: `latest 1.19.0`, `latest-1 1.1.4`, 12243 versions, none `2.*` (`npm view`).
- npm `@opencode/cli`: `latest 2.0.29`, 1054 versions, `bin {opencode, opencode2}`, one
  `optionalDependencies` package per platform (`@opencode/cli-linux-x64` and 11 more), repository
  `git+https://github.com/anomalyco/opencode.git`, maintainer `thdxr`, the same maintainer as
  `opencode-ai` (`npm view`).
- The v2 installer (`curl -fsSL https://opencode.ai/v2/install`, saved as text only, 488 lines,
  sha256 `bc70dd31...9d87`) asks `https://opencode.ai/update/api/latest/cli/npm` for the version
  and package, downloads the npm tarball `@opencode/cli-<target>`, moves the binary to
  `INSTALL_DIR=$HOME/.opencode/bin`, writes the `opencode2` shim, and adds the directory to the
  shell rc unless `--no-modify-path`.
- The host: `~/.opencode/bin/opencode` (211064288 bytes, mtime 1985-10-26, the fixed mtime of npm
  tarball files), `~/.opencode/bin/opencode2` (47 bytes, 2026-10-14 16:22, content `#!/bin/sh` /
  `exec "$(dirname "$0")/opencode" "$@"`, identical to the installer's heredoc),
  `~/.bashrc:239 export PATH=/home/taisung/.opencode/bin:$PATH`. The first 2.0.29 log line is
  `2026-10-14T20:22:31.408Z ... "cli starting" version=2.0.29 channel=latest`. Earlier upgrades
  logged `message=upgraded method=curl target=1.18.33/34/35`. So the 2.0.29 install most likely
  came from the v2 curl installer at about 16:22 EDT (read and inferred; no record names the
  command).
- `opencode upgrade [target] [--method curl|npm|pnpm|bun|yarn|vp|brew|winget]` upgrades in place
  (`--help`, read). In the binary, the curl method downloads `https://opencode.ai/v2/install`, and
  the npm method runs `npm install --global [--force] <package>@<version>`, with `--force` when the
  installed package name differs (read).

Proposed change for I-6: replace the OpenCode row with `npm install -g @opencode/cli`, which keeps
the list npm-only, and print the curl installer as the alternative hint. After the install,
`detect()` must find a 2.x binary (row 7). Risks for the owner (Q1): a host with npm `opencode-ai`
has an `opencode` bin already, and npm can refuse the second package without `--force`; a host
with both `~/.opencode/bin` and the npm global bin runs whichever comes first in `PATH`.

## 9. `fleet_watch.sh` OpenCode rules and D-28 (survey item 7)

D-28 (`~/agent-skills/development/TODO_TRACKING.md:383`): "a pane-state rule needs positive
evidence of the state, not the absence of the other state's markers". The OpenCode rules in
`~/agent-skills/scripts/fleet_watch.sh` were measured on the 1.18.34 layout only
(`TODO_TRACKING.md:490-491`).

| Rule | Lines | Event | API replacement | Decision |
|---|---|---|---|---|
| R1 busy: `esc interrupt` status row under the input box border | `pane_opencode_turn_runs` :755-767, used at :921 | gates stall and idle | `session.active` holds the ID | replace after M-1; an API record is positive evidence |
| R2 idle without a final report | idle logic, `--idle-min` | `idle N min without a final report` | not active, `time.idle` age, report line not final | replace after M-1 and M-2 |
| R3 stall normalization: bar, token count and cost, spinner frames | :924-947, `opencode_spinner_frames` :949, used at :1041 | `stalled N min` | active while `time.updated` and `tokens` do not change | keep the pane rule until M-8 shows how often `updated` moves during a long tool call |
| R4 backend error texts (`[service_overloaded]`, `[rate_limit_exceeded]`) | :134-144 | `sent continue after backend error` | `outcome "failed"` / `session.execution.failed` `error.message` | keep until M-7 shows the 2.x error text |
| R5 data-collection refusal | `REFUSAL_RE` :145, `pane_has_refusal` :1052, :1227-1229 | `refusal text in pane` | same as R4 | keep until M-7 |
| R6 message-box quote for events | :573-665, :739 | text inside events | `session.message.list` last message | optional; the quote is for humans |

The pane census is still needed for every rule that stays on the pane (R3 to R6) and to check the
replacements. The census needs running renders, thus model turns. The captured idle 2.x pane
(§5.1) shows the 1.x elements that R1 reads: the `┃` box border, the `╹▀▀▀` bottom border, and
the status row under it. The running row is not measured. The `fleet_watch.sh` changes are
agent-skills work under its own review rules; this note only lists them.

## 10. The launch prompt on 2.x (survey item 8)

Facts: as-63 (2026-10-14 21:12 EDT, Muse, agent-skills config): the TUI started at 01:11:49.179Z
with `--session ses_ec2e274caffejezR5IoGa0AgvB --prompt "<launch prompt>"`, connected its event
stream at 01:11:50.340Z, and wrote the `user` message at 01:11:50.668Z; the answer `OK` completed
at 01:11:52.277Z (log and messages, read). On 1.18.35, `--prompt` with `--session` was not
submitted (round-1 finding). Thus a 2.x OpenCode worker is eager like claude-code and codex.

Effect on the pointer-title protocol: the pointer title now matters for OpenCode. It is what keeps
the worker from acting before `.agent_task.md` exists. What a Muse worker does with a pointer title
and no brief is not measured (M-6).

agent-skills text that must change (not edited here):

- `skills/ao-spawn/SKILL.md:79`, the opencode row: "**Discards** the spawn prompt entirely; sits at
  its splash screen until `ao send` arrives" and "Pointer title is a behavioral no-op here".
- `skills/ao-spawn/SKILL.md:81-87`: "claude-code and codex are eager; opencode is patient", "an
  opencode spawn title is a no-op", "harmless to the patient one".
- `skills/ao-spawn/SKILL.md:90-92`, "OpenCode special handling": "OpenCode agents discard the spawn
  prompt."
- `skills/ao-spawn/SKILL.md:94-110`, "Model and effort for OpenCode": "emits ONLY `--model`" and
  "never a variant/effort flag" are 1.x facts; on 2.x the model goes into `session.create` as
  `{providerID, id, variant}` from `provider/model#variant`.
- `skills/ao-spawn/SKILL.md:434` and `:436-438`, the measured table: "**No** — discards the title
  entirely", "sits at its splash screen", "opencode is safe because it ignores everything".
- `skills/ao-communicate/SKILL.md:151-170`: the no-turn rule after a send and the `esc interrupt`
  rule are 1.x pane facts; they stay until the 2.x census and I-5.
- `skills/ao-lifecycle/SKILL.md:149-225`: the OpenCode rows of the watcher description follow R1
  to R6.

## 11. Where `ao spawn` reports success (survey item 9)

The path (read): `cli/src/commands/spawn.ts:101` `sm.spawn(...)` → `core/src/session-manager.ts:959`
`spawn` → `:1134` `plugins.runtime.create` → `runtime-tmux/src/index.ts:67-79`: `tmux new-session
-d`, then `send-keys` of the launch script into the pane's interactive shell, and return → back in
core, metadata, `postLaunchSetup` (`:1203`), and a 10 s title discovery (`:1207-1219`) → `spawn.ts:127`
`spinner.succeed("Session <id> spawned")`. No step reads the script's exit status. When the script
exits 1 (for example the round-2 and round-3 failure paths: no session ID, a failed readback), the
pane shows the error above a shell prompt, and the spawn still reports success. The tracking entry
records the effect: a later send "landed in a bash prompt, because that pane ran no agent"
(`TODO_TRACKING.md:492-493`).

Proposed design (I-3):

1. **Create in Node.** Before `runtime.create`, core calls a new optional agent hook (proposed
   name `prepareAgentSession(config)`), which the OpenCode plugin implements with `session.create`
   and the `session.get` readback of model and agent. Core calls it inside the `try` that starts at
   `session-manager.ts:1130`, so on a failure the existing catch (`:1150-1170`) removes the
   workspace and the reserved ID, and `ao spawn` exits 1.
   On success core passes the ID as `agentConfig.opencodeSessionId`, the seam that the reuse path
   already uses (`:1113-1120`), and writes it to metadata at once. The pane command becomes
   `exec opencode --session <id> [--prompt P]`.
2. **Check the launch.** After `runtime.create`, a second optional hook (proposed name
   `confirmLaunch(session, timeoutMs)`) polls until the pane runs `opencode --session <id>`
   (`isProcessRunning` plus the ID in the process arguments) and the pane shows the TUI footer
   `ctrl+p commands` (seen in the measured idle pane), within a bound such as 15 s. On a timeout it
   throws; the existing post-launch catch (`:1224`) destroys the runtime and workspace, and the
   plugin removes the created session. This is positive evidence of the attached TUI, which the
   API cannot give (§5.3).
3. **Prompt delivery.** Optional: `session.message.list` shows a `user` message within a bound
   (1.5 s on as-63), and core sets `promptDelivered`, which `spawn.ts:131-140` already reports.

This also removes the title discovery after spawn (row 23), so a spawn never binds an older
session with the same `AO:<id>` title.

## 12. Drop 1.x (survey item 10)

Code in `packages/plugins/agent-opencode/src/index.ts` at `f5a87010`:

- `buildSessionIdCaptureScript` (:77-121), used only by the 1.x `run --format json` command.
- `buildSessionLookupScript` (:185-216), used only by the 1.x title fallback (`findByTitle`, :458).
- `OPENCODE_API_MAJOR`, `OPENCODE_MAJOR_PROBE`, `branchOnOpenCodeMajor` (:221-237).
- `buildLegacySessionOptions` (:268-274) and its uses at :349 and :455.
- In `buildResumeCommand` (:344-362): the legacy command and the branch. Without a model or agent
  the command stays `opencode --session <id> [--prompt P]`.
- In `getLaunchCommand` (:455-509): `legacyOptions`, `findByTitle`, `runCommand`, `legacyCommand`,
  and the probe and branch in the return value.
- The 1.x comment in `detect()` (:702-703); `detect()` gets a major-version check.

Not 1.x-only, removed later by I-2 and I-4: `parseUpdatedTimestamp` (:38-60), `parseSessionList`
(:62-75), `findOpenCodeSession` (:372-403).

Tests in `index.test.ts`:

- Remove: the group "session ID capture from JSON stream" (:842, 3 tests); the group "title-based
  fallback sorting with newest-first" (:870, 3 tests, which assert the 1.x lookup script in the
  launch command); the 1.x tests at :1476, :1503, :1539, :1559 and :1835.
- Rewrite: the group "getLaunchCommand" (:124-443, 35 tests). 39 of its lines assert 1.x text
  (`run --format json`, `--command true`, TUI `--agent`/`--model`). Each keeps its intent (prompt
  escaping, system prompt file, subagent) against the 2.x command.
- Add: `detect()` returns false for `1.18.35` and true for `opencode v2.0.29`; the launch command
  holds no version probe.

Core and CLI need no 1.x-specific change: their CLI calls (`session list`, `session delete`) work
on both versions (audit rows 9, 10) and move to the API in I-2.

## 13. Staged plan

Each increment is one commit series for one author and one reviewer. Each one keeps
`pnpm typecheck`, `pnpm lint` and `pnpm test` green and adds tests for its new behavior
(constraint C-02).

| Inc | Scope | Files | Risk | Tests | Live check |
|---|---|---|---|---|---|
| I-0 | this note | `development/0009_*.md` | none | none | none |
| I-1 | drop 1.x, version gate | `agent-opencode/src/index.ts`, `index.test.ts`, plugin CHANGELOG | LOW: a 1.x host loses OpenCode workers, by owner decision | §12 list; the existing 2.x shell-run tests stay | isolated store: launch command runs `session.create`, readback, TUI; no `opencode --version` probe in the pane |
| I-2 | one API helper; ID-based lookup; remove and interrupt | new `core/src/opencode-api.ts` (execFile `opencode api`, JSON parse, 404 → `null`, other errors thrown with `cause`), `core/src/index.ts` export, `session-manager.ts` rows 9, 10, 20-22, 24, plugin rows 5, 6 | MEDIUM: changes cleanup and reuse paths | helper unit tests with a mocked `execFile`; session-manager tests that mock `opencode session list/delete` (`__tests__/session-manager/*.test.ts`, `session-manager.test.ts`) | isolated store: kill `--purge-session` removes the session; remap finds the exact title only |
| I-3 | create in Node, launch check, no title discovery | `core/src/types.ts` (two optional `Agent` hooks), `session-manager.ts` spawn and orchestrator start, plugin hooks, `spawn.test.ts` | HIGH: the spawn path of every OpenCode worker | a failed create fails the spawn; a dead pane fails the spawn and removes the session; a good spawn stores the ID before the pane starts | isolated store: a forced bad model fails `ao spawn` with exit 1 and no pane; a good one passes. A real spawn needs an owner-approved probe (as-63 shape) |
| I-4 | activity, cost, session info from the API | plugin `getActivityState`, `getSessionInfo`, `detectActivity`; tests | MEDIUM: status and stuck detection | the seven required `getActivityState` tests (CLAUDE.md), now from mocked API records; cost mapping | needs M-1 to M-3 first |
| I-5 | `ao send` through `session.prompt` | an optional agent send hook in `types.ts`; `session-manager.ts` send; `cli/src/commands/send.ts` | HIGH: every message to an OpenCode worker | admitted ID returned; 404 and 409 handled; no tmux paste for OpenCode | needs M-4 and M-5 first |
| I-6 | install option | `cli/src/commands/start.ts`, its test | LOW | the OpenCode row names the chosen package | `npm view` only; no global install in a test |
| I-7 | agent-skills text and watcher rules | agent-skills repo, separate arc | per agent-skills rules (CRITICAL for the protocol text) | agent-skills fixtures | the 2.x pane census |

Order: I-1 and I-6 can go first; I-2 before I-3 and I-4; I-5 last. M-1 to M-8 can run at any time
after the owner approves the environment (Q4).

## 14. Measurements that need a model turn

Each one needs a real provider, thus the global service or an isolated store with the owner's own
login (Q4). Each one uses a throwaway session in a throwaway directory and a cheap model.

| ID | Question | Method |
|---|---|---|
| M-1 | Does `session.active` list a session while a TUI-started turn runs? | Start a TUI with a prompt that runs `sleep 30` through a tool; poll `session.active` every second; record the first and last `running` reads against the message times |
| M-2 | How do `time.updated` and `time.idle` move during a turn? | Same run; poll `session.get` every second |
| M-3 | Which events and records mark busy, permission, question and error? | Same run plus a prompt that needs a permission (a write outside the allowed paths) and one that asks a question; record `/api/event` with `curl -N` (direct HTTP, owner-approved password use) or poll the lists; for error, use a model reference that the provider rejects |
| M-4 | Does a `session.prompt` to a session with an attached TUI show in the TUI and run once? | Attach a TUI with no prompt; send one `session.prompt`; capture the pane; count assistant messages |
| M-5 | `steer` against `queue` during a turn, and a send during a permission prompt | Send during the M-1 `sleep`; send during the M-3 permission prompt |
| M-6 | What does a 2.x Muse worker do with a pointer title and no brief? | One `ao spawn` against a throwaway project (never a real config), as in the 2026-07-11 table of `ao-spawn` |
| M-7 | Which text does 2.x show and record for `[service_overloaded]`, `[rate_limit_exceeded]` and the refusal? | Cannot be forced; read `outcome`, `session.execution.failed` and the log when one happens in the fleet |
| M-8 | Does `time.updated` or `tokens` move during a long tool call? | Same as M-1 with a 5-minute `sleep` |

## 15. Open questions for the owner

- **Q1 install channel.** npm `@opencode/cli` (recommended: npm-only list, registry integrity) or
  the curl installer that this host used? Should ao pass `--force` when npm `opencode-ai` exists?
- **Q2 helper location.** One `opencode-api.ts` in core, used by core and the plugin
  (recommended), or a copy in each?
- **Q3 push or poll.** Polling with `opencode api` needs no password and costs about 0.6 s per
  session and tick. The event stream needs direct HTTP with the service password from
  `~/.config/opencode/service.json`. Recommended: poll in I-4; decide on events after M-3.
- **Q4 model-turn environment.** M-1 to M-8 need a provider. The brief forbids a credential copy.
  Options: a throwaway session on the global service (writes to the real store), or the owner logs
  in to an isolated store.
- **Q5 send delivery.** `queue` (wait for the running turn) or `steer` (enter the running turn) as
  the `ao send` default?
- **Q6 1.x host.** After I-1, should `detect()` hide OpenCode on a 1.x host (`ao start` then does
  not list it), or should the spawn fail with a message that names 2.x?
- **Q7 reuse by title.** `opencodeIssueSessionStrategy: reuse` (default) and the orchestrator reuse
  also accept a session found by title. Keep reuse by stored ID only (recommended), or keep the
  title search as a manual `ao session remap`?
- **Q8 output tokens.** Count `reasoning` in `outputTokens` (recommended: providers usually bill
  reasoning tokens as output; not checked for OpenCode Go)?
- **Q9 version floor.** Only 2.0.29 is measured. Gate on major 2, or on a minimum such as 2.0.29?

## 16. Corrections to earlier records

- Round-1 audit row 11 and `TODO_TRACKING.md` (agent-skills, part 3 of the arc): "npm has no 2.x
  release" holds for `opencode-ai` only; `@opencode/cli` has `2.0.29` (§8).
- `skills/ao-spawn/SKILL.md`: OpenCode is not patient on 2.x (§10).
- The plugin's `detectActivity` reports an idle 2.x pane as `active` (§5.1); this is not in the
  round-1 audit.

## 17. Review round 1 (added by the orchestrator, 2026-10-14)

Two receipts reviews of `e38a8f1b`, the router's pair for an L2 LOW note: Muse (ao-3) ACCEPT with 14
spot checks, 13 true and 1 true with a wrong line; DeepSeek V4.1 Flash (ao-4) ACCEPT with 32 spot checks,
all true. 0 majors. The design is confirmed, so no round 2 runs. The reviews are
`development/reviews/0009_review_r1_muse.md` and `development/reviews/0009_review_r1_v4flash.md`. The
minors, with the correction that each increment brief must use:

- §4 row 12: the `detect()` call is `cli/src/lib/detect-agent.ts:36`; `:21` is the `opencode` row of
  `AGENT_PLUGINS` (both reviewers).
- §12: several ranges start at the doc comment, not at the symbol (`buildSessionIdCaptureScript` `:82`,
  `OPENCODE_API_MAJOR` `:228`, `buildLegacySessionOptions` `:269` at `e38a8f1b`). Re-read each range
  before an increment edits it.
- §13: M-6 (a 2.x worker with a pointer title and no brief) is an input of I-3 and of the I-7 protocol
  text. A part of M-6 is measured: on 2026-10-14 both ao-3 and ao-4 found `.agent_task.md` through the
  pointer title with no `ao send`. The I-7 row also depends on M-1, M-2, M-7 and M-8 (§9).
- §15: Q5, Q6 and Q9 had no recommendation; Q9 decides the I-1 gate. The owner's answers are recorded
  below when given.
- §5.4: the event-name list from the binary has no command; M-3 checks it.
- §5.2: the counts are of their time (V4.1 Flash, later: 9 of 200 sessions with an `outcome`, all
  `succeeded`, in 11 `projectID` values).
- §3, §5.2, §5.3, §6: the isolated-store measurements cannot be checked again, because that service
  is gone; M-1 to M-5 measure them again.

## 18. The owner's answers to §15 (2026-10-14, about 21:55 EDT)

- **Q1:** `ao start` installs with `npm install -g @opencode/cli`. If npm `opencode-ai` is installed, it
  adds `--force` and says so.
- **Q2:** one `opencode-api.ts` helper in core, used by core and the plugin.
- **Q3:** poll with `opencode api` in I-4; decide on the event stream after M-3.
- **Q4:** the model-turn measurements M-1 to M-8 run in throwaway sessions on the global service, with
  a unique title, on the flat plan. The worker removes only the sessions that it created. No credential
  is copied.
- **Q5:** the `ao send` default is `queue`. M-5 measures `queue` and `steer` before I-5 lands.
- **Q6:** on a 1.x host, `detect()` reports OpenCode as missing, and an explicit
  `ao spawn --agent opencode` fails with a message that names 2.x.
- **Q7:** reuse a session by its stored ID only; no title search.
- **Q8:** count `reasoning` tokens in `outputTokens`.
- **Q9:** the gate is a MINIMUM version of 2.0.29, not only major 2. An older 2.x is refused with a
  message. (The Muse reviewer had suggested major 2; the owner chose the minimum.)
