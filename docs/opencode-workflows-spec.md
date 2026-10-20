# OpenCode Workflow Spec (Agent Orchestrator)

This document defines intended behavior for Agent Orchestrator when `agent: opencode` is selected, including edge cases and expected outcomes.

## Scope

- CLI workflows: `ao start`, `ao spawn`, `ao status`, `ao send`, `ao session cleanup`, `ao session restore`, `ao session remap`.
- Core lifecycle paths in `SessionManager` and plugin resolution.
- OpenCode session mapping and deletion semantics.

## Configuration Contract

- `defaults.agent: opencode` or `projects.<id>.agent: opencode` selects the OpenCode agent plugin.
- `projects.<id>.orchestratorSessionStrategy` controls orchestrator session behavior:
  - `reuse`: reuse existing alive orchestrator runtime; otherwise restart and reuse mapped OpenCode session id when available.
  - `delete`: destroy alive runtime, delete previously mapped OpenCode orchestrator sessions, then start fresh.
  - `ignore`: destroy alive runtime and start fresh without deleting prior OpenCode sessions.
  - `delete-new` and `kill-previous` normalize to `delete`.
  - `ignore-new` normalizes to `ignore`.
- `projects.<id>.opencodeIssueSessionStrategy` controls issue-session reuse for `ao spawn` with OpenCode:
  - `reuse` (default): reuse mapped OpenCode session for same issue when available.
  - `delete`: delete mapped OpenCode sessions for same issue, then spawn fresh.
  - `ignore`: spawn fresh without deleting prior issue sessions.

## Workflow Behavior

## 1) Plugin Resolution

- CLI must resolve `opencode` via `getAgentByName` and `getAgent` without error.
- Core plugin registry built-ins must include `@aoagents/ao-plugin-agent-opencode` under slot `agent`.
- Expected failure mode: unknown agent names fail fast with `Unknown agent plugin: <name>`.

## 2) `ao start` (orchestrator session)

- Always delegates orchestrator session lifecycle to `SessionManager.spawnOrchestrator`.
- For `orchestratorSessionStrategy: reuse`:
  - if existing runtime is alive, return existing session without creating a new runtime.
  - if existing runtime is dead and metadata contains `opencodeSessionId`, pass it to launch config for continuation.
- For `reuse`, the mapping is reused only when `session.get` finds the stored ID. A stored ID that is gone (404) or that `session.get` cannot check is not replaced by a title match.
- For `delete` strategy:
  - delete the OpenCode sessions whose IDs AO metadata stores for this orchestrator before launching new orchestrator. There is no title search: an older OpenCode session that no metadata stores is not deleted. An ID that another live AO session of the project stores is kept.
- For every strategy, when no stored ID is reused, `ao` creates the OpenCode session before the pane starts and stores its ID (see `ao spawn`). A failed gate, model check, create, readback or launch check fails the start: its prompt file, worktree and record are removed, and a session that this start created is removed.
- For `ignore` strategy:
  - do not delete old OpenCode sessions; launch fresh runtime.

## 3) `ao spawn`

- Uses selected agent (default/project/override) and launches OpenCode command from plugin launch config.
- OpenCode launch behavior: `ao` makes the OpenCode session ready in its own process before the pane starts, in this order:
  1. the version gate (`opencode --version` must print 2.0.29 or later);
  2. the model check, when a model is set: `opencode api model.list` must hold an entry with the same `providerID` and `id` (the `id` field, not `modelID`), that is not disabled, and that has the requested variant (`default` always passes). The answer is about 470 KB, so its stdout goes to a temporary file that only this call uses (not a pipe), and the file is removed after the read. An answer cut with exit 0 (empty or incomplete JSON) gets one more try, and a second cut fails the spawn. A model that the answer does not list fails the spawn;
  3. no mapped id: `opencode api session.create` with the title `AO:<session>`, the model, the agent and `location.directory` = the real path of the workspace. Mapped id (`agentConfig.opencodeSessionId`): `session.switchModel` and `session.switchAgent` for the settings that are set, and no create;
  4. when a model or an agent is set, `session.get` reads them back. A mismatch fails the spawn;
  5. mapped id: `session.message.list` reads the newest `user` message (its ID and `time.created`), the baseline for the prompt check below. A failed read does not fail the spawn.
- Every `opencode api` call of a spawn runs with the pane's environment (the map that core gives `runtime.create`, for example `AO_SESSION` of the new session), not with the environment of the `ao` process. This includes the reuse and delete calls of the issue and orchestrator strategies, which run before the prepare. Only the version gate runs with the `ao` process PATH (the pane PATH only puts `~/.ao/bin` first).
- Core writes the OpenCode session ID to the session record before `runtime.create`, so every session that a spawn created has a record.
- Launch ownership: core reserves the record (before the workspace) with `launchPid` (the PID of the `ao` process) and `launchPidStart` (its start time, field 22 of `/proc/<pid>/stat`) already in it: it writes them to a dot-named temp file in the sessions directory and hard-links that file to the record name, which fails like an exclusive create when the name exists. So no other process can read the record without the two keys. Before the prepare it adds the mapped id when one is reused. Without a readable start time the reservation is empty, as before, and one operator line says that the launch is unprotected. While that process runs with that start time, every check of a shared OpenCode ID (issue `delete`, orchestrator `delete`, `ao session cleanup`, `ao session kill --purge-session`, remap) counts the record as a live holder, also before its pane exists, and `ao session cleanup` does not kill the record. `ao session kill` (with or without `--purge-session`), `ao session restore`, `ao session remap` and `ao stop` of that record exit 1 with `Cannot <action> session <id>: ao process <pid> is still launching it. Stop ao process <pid> or wait for the launch to finish, then try again.` and change nothing; a project orchestrator start refuses to reuse or replace an orchestrator record whose launch is in progress the same way. The rule does not read `status`, so a `killed` status from the lifecycle's first poll does not change it (the lifecycle merges its status write and keeps the keys). After the launch check passes, core removes both keys and the pane rule applies; a failed spawn removes the whole record. A launcher that is gone, a zombie, or a PID that now has another start time, protects nothing. A record with launch keys but no runtime identity (no `runtimeHandle`, no `tmuxName`) whose launcher is dead is a dead holder: its id can be removed. Only an old record without launch keys and without runtime identity keeps its id as "liveness could not be checked". The pane command is exactly `exec opencode --session '<id>'`, plus `--prompt ...` when there is a prompt. It holds no `opencode api` call.
- Launch check: within 15 s, the pane must run an OpenCode process on the session, and the same process must still run 1 s later. The runtime gives the PIDs of the pane (tmux: the processes on the pane TTY from `ps`; Herdr: its foreground process list), and `/proc/<pid>/cmdline` gives each exact argument vector. A process counts only when argv[0] has the file name `opencode` or `.opencode` (any directory), or argv[0] is `node` or `bun` and argv[1], its main script, has such a file name (any interpreter option before the script, such as `--require <file>`, `-r`, `--import`, `--loader` or `-e`, makes the process not count), and `--session <id>` or `--session=<id>` is one of the options of that process (before `--`). A shell whose `-c` text names OpenCode does not count. A host without `/proc` cannot pass the check. A pane that is gone fails the check at once. Then, with a prompt, the spawn reads `session.message.list` for up to 10 s: for a created session, any `user` message counts; for a reused session, only a `user` message newer than the baseline counts, and a failed baseline read gives `promptDelivered=false` at once. Seen: `promptDelivered=true`. Not seen: `promptDelivered=false` and one operator line that names `ao session attach` and `ao send` (`ao spawn` adds no second warning); the spawn succeeds.
- Failure paths (exit 1):
  - the gate, the model check, the create or the readback fails: no pane starts; the workspace and the reserved record are removed. When the readback of a created session fails, that session is removed first.
  - `runtime.create` or the post-launch setup fails: the created session is removed (interrupt, then remove), then the workspace and the record.
  - the launch check fails: the runtime is destroyed first, then the created session is removed, then the workspace and the record.
  - a reused session ID is never removed.
  - a removal that fails twice prints one line with the `opencode api session.remove` command. A removal that times out is not retried.
- No title search runs during a spawn or an orchestrator start. The title stays `AO:<session>` for `ao session remap`.
- The I-2 launch lock and its `pending.json` marker are removed. Old `/tmp/ao-opencode-launch-<uid>/` directories are inert: no build from I-3 on reads or writes them, and an operator can remove them at any time.
- Issue reuse (`opencodeIssueSessionStrategy: reuse`) reuses a stored ID of an earlier session of the same issue only when `session.get` finds it. `delete` removes those stored IDs, except an ID that another live AO session stores or that a launch in progress holds (see launch ownership).
- The model and the subagent go into the OpenCode session through the API. The system prompt and the task prompt go into `--prompt`.

## 4) `ao send`

- Resolves agent by project config. `send()` never searches by title.
- An OpenCode session with a stored `opencodeSessionId` gets its messages through `opencode api session.prompt`, not through the pane. This covers `ao send` and core `send` (the lifecycle reactions and `ao review-check`). There is no idle wait, no tmux paste, no Enter and no screen check: the answer of `session.prompt` is the admitted inbox item (`Session.Inbox.User`), so each delivery has a positive record. In this order:
  1. Size, before any restore: the body `{"id": <input ID>, "text": <message>, "delivery": "queue"}` goes on the command line as `-d <json>`, because `opencode api` 2.0.32 has no file or stdin form for a body. Linux refuses one argument of 131072 bytes or more (`E2BIG`). A message whose JSON body is more than 131071 bytes (UTF-8) fails at once, and nothing is sent: no truncation, no tmux fallback. Core runs this check (`Agent.checkMessage`) before it prepares the session, so a message that can never go does not restore a dead session. This is true for `ao send` and for every core caller.
  2. TUI check: the pane must run an `opencode` process with `--session <stored id>` (the argument rule of the launch check, tmux and Herdr). Without one, `session.prompt` does not run. Reason (measured on 2.0.32, `development/TODO_TRACKING.md`, Known Issues, "Follow-ups after I-3"): the model tools of a turn run as children of the global service, and they get the worker's environment (its `AO_*` values and `~/.ao/bin` first on `PATH`) only while the worker's TUI is attached. Without a TUI, the tools get the service environment for that turn, and the `gh` and `git` wrappers record no PR. The environment of the `opencode api` client never reaches the tools, so `ao` does not set one. The check waits up to 10 s for the TUI (a restored pane runs its settings calls first). A TUI that is younger than 3 s gets the rest of that time before the send. The 10 s is a hard bound of the check: each pane lookup (`tmux`, `ps` or the Herdr call, each with its own 5 s timeout) and the age wait end at the deadline. A TUI that needs its 3 s age after the deadline fails the check.
  3. No TUI: core restores the session once and checks again. `restore` replaces the pane only when `isRestorable` is true: a terminal status (`killed`, `terminated`, `done`, `cleanup`, `errored`) or an exited agent, and never for `merged`. So a pane under a `working` record that still runs another OpenCode process (for example a TUI on another session) is not replaced: the send fails and names both reasons. A live pane under a `killed` or `done` record is replaced. This is the behavior of `restore()` before I-5, and I-5 does not change it. A second failed check after the restore fails the send.
  4. One read each of `session.permission.list`, `session.form.list` and `session.active`. A pending permission or question does not stop the send: the message waits until a human answers, and `ao send` prints one line that says so. For a busy session, `ao send` prints that the message goes in after the last answer of the running turn. The delivery is always `queue` (owner Q5): neither `queue` nor `steer` interrupts a running tool or a pending permission, and `steer` replaced the worker's own final answer (0010 section 7). A failed read leaves its line out and does not stop the send.
  5. Input ID: `ao` sends a client input ID in the body. 2.0.32 uses a given `id` as the ID of the input (`dH=S.id??Mo.create()` in the `session.prompt` handler). Before it admits, the service looks for that ID in the inbox and the messages of the session (`SessionInbox.reconcile`). When a `user` input of this session has the ID, the service answers that input (with its first creation time) and admits nothing. It does not compare the text. When another session or a record of another type has the ID, it answers 409 `ConflictError` ("Prompt message ID conflicts with an existing durable record"). `ao` makes the ID with a copy of the 2.0.32 generator (`mintOpenCodeMessageId`: `msg_`, then 12 hex digits of the time in ms times 4096 plus a counter, then 14 random base62 characters), so the ID has the form and the time order of the IDs that the service makes. Measured on an isolated store: an ID made between two prompts sorts between their IDs. `session.message.list` is in timeline order, not in ID order: an input with an older ID shows at the time of its admission, and its turn runs.
  6. Pending entry: core writes the ID to the session record before `session.prompt` runs. The key `pendingDeliveries` holds a JSON array of `{inputId, textSha256, at, state}` (`textSha256` is the SHA-256 of the UTF-8 text, `at` is the start of the first attempt). The state is `sending` while a call runs and `unknown` after a send whose admission stayed unknown. Core writes the key with `updateMetadata` (this key only, no other key changes) and removes the key when the array is empty. A later send of the same text to the same session uses the ID of the newest `unknown` entry that is younger than 10 min, and sets that entry to `sending`. The bound: the lifecycle polls every 30 s, and one poll that sends without a TUI takes about 1 to 2 min, so its retry of the same dispatch comes well inside 10 min. A human who reads the error and sends again also does so inside this time. Core removes older entries, and the same text then gets a new ID. A `sending` entry is never used again: a second send of the same text at the same time gets its own ID, and the service admits it as its own message. A different text gets a new ID. Core removes the entry when the send succeeds (admitted, recovered by the read-back, or a replay) and after a definite refusal. One record keeps at most 20 entries.
  7. One `session.prompt` with that ID. The errors that the 2.0.32 OpenAPI document declares fail the send, and nothing is sent: 404 `SessionNotFoundError` (the stored session ID is stale), 404 `LocationNotFoundError` (the directory of the session is gone), 409 `ConflictError`, 400 `InvalidRequestError` and 401 `UnauthorizedError`. A child that never started is also a definite refusal: `E2BIG` (the arguments and the environment together are more than the host limit, `ARG_MAX`), `ENOENT` (no `opencode` on `PATH`), `EACCES` and the other `spawn` errors before the child runs. There is no restore, no second prompt, no read-back and no tmux fallback after these errors.
  8. Unknown admission: a timeout (10 s), an answer cut with exit 0, a complete answer that is not the inbox item of this ID and session, a 5xx answer, or a child that a signal stopped. Then `ao` reads `session.inbox.list` once and `session.message.get` of the input ID once (an input to an idle session becomes a `user` message with the same ID). Only the input ID counts: an earlier input with the same text has another ID, so it is never taken for this send. Found: the send succeeds, and `ao send` says that it found the message by a read-back. Not found, or a failed read: the send fails, the entry becomes `unknown`, and `session.prompt` does not run again in this send. The next send of the same text uses the same ID, so a late admission of the first request and the retry give one input.
  9. Replay: when the answer of `session.prompt` is an input that the service created before this call started, an earlier attempt of this send admitted it. The send succeeds, and `ao send` prints `An earlier attempt of this send already admitted input <msg_id>; nothing new was admitted.`
- `ao send` prints `Message admitted to <session> (input <msg_id>, delivery queue)` and exits 0, or prints `Message not sent to <session>: <error>` and exits 1. `--no-wait` and `--timeout` have no effect on this path, because the `queue` delivery handles a busy session.
- Upper bound of one send on this path, from its own waits: the wait of a `spawning` session (20 s), the TUI check (10 s), one restore with its ready wait (5 s), the second TUI check (10 s), the context reads (5 s, in parallel), `session.prompt` (10 s) and the read-back (2 x 10 s). That is 80 s, plus the time of the restore itself and the last poll round of each wait. A send to a session that is running and has a TUI takes the TUI check, the context reads and the prompt only.
- A session without a stored ID, and every other agent, keeps the pane path: busy detection with `detectActivity`, the tmux paste, and the screen check of the delivery.
- Lifecycle reactions: a send that fails keeps the dispatch hash, so the next poll sends again. A refused send admitted nothing, so this gives no second copy. After an unknown admission, the next poll sends the same text with the same input ID, so the service admits it at most once, also when it admits the first request later than the read-back. The dispatch hash is written after the send that succeeds.
- Known limits of this path:
  - The 3 s TUI age is a heuristic and was not measured. A process in the pane does not prove that the TUI is attached to the service. When `/proc` does not give the age, the check passes at once.
  - `tmux list-panes -t <runtime id>` gives all panes of the window. In a window that a human split, a TUI in another pane passes the check.
  - A TUI that exits while a queued input waits behind a long turn or a permission is not detected. The tools of that turn then get the service environment.
  - A `sending` entry that a stopped `ao` process left is never used again. It expires after 10 min, and the same text then gets a new ID.
  - Two processes that write the same record at the same time (for example `ao send` and the lifecycle worker) can lose one write, because `updateMetadata` reads and writes the file without a lock. This is true for every key of the record.

## 5) `ao status`

- Uses project/default configured agent for session enrichment and activity checks.
- Must not fail solely because project default agent is `opencode`.
- Fallback mode (no config) uses `claude-code` for best-effort tmux introspection only.

## 6) `ao session cleanup`

- Never cleans up orchestrator sessions (by explicit `role=orchestrator` or `-orchestrator` suffix).
- For OpenCode sessions with mapped `opencodeSessionId`:
  - on cleanup kill path, delete corresponding OpenCode session first, then archive AO session metadata.
  - archived sessions with mapping are cleaned once; `opencodeCleanedAt` prevents repeated deletion attempts.
- Purge and archived cleanup keep an ID held by another active metadata record whenever its runtime or agent is alive, regardless of lifecycle status (including `merged` and `killed`). Missing handles/plugins, failed checks and checks that exceed 2 s also keep it, with one operator line explaining why. A negative tmux check requires an explicit missing-session/server diagnostic; Herdr negative checks are conservatively treated as unavailable because its runtime conflates errors with absence.
- If OpenCode delete returns "session not found", treat as already cleaned.

## 7) `ao session restore`

- For OpenCode session restore, mapping is required. There is no title search.
- The plugin's `getRestoreCommand` runs the version gate first, so a refused binary names its version.
- If mapping missing: fail with `SessionNotRestorableError` that names `ao session remap <session>`.
- If `session.get` answers 404 for the stored ID: fail with `SessionNotRestorableError` (`the stored OpenCode session <id> is gone`).
- Core gets the restore command before it destroys the old runtime, so a refused restore keeps the old pane and does not copy an archived record back to active metadata.
- Restore must recreate runtime with preserved metadata/session fields and keep mapping persisted.

## 8) `ao session remap`

- Only valid for OpenCode sessions.
- Works on an active session and on the latest archived record of a killed session, so the remap hint of a refused restore works. On an archived record it also clears `opencodeCleanedAt`, so `cleanup` removes the new ID in its turn.
- `remap(session, force=false)`:
  - reuse existing mapping if present; otherwise discover and persist.
- `remap(session, force=true)`:
  - always re-discover and overwrite persisted mapping.
- Discovery accepts only the exact title `AO:<session>` with `location.directory` equal to the session's workspace. It follows `cursor.next`, because `search` is a substring and newer sessions such as `AO:<prefix>-10` can push the exact title to a later page.
- More than one candidate: refuse and print each candidate (ID, directory, created time). Remap never picks one.
- A candidate held by another live or unverifiable active AO session is refused before writing either active or archived metadata, including with `--force`.
- No candidate: return explicit mapping-missing error.

## Edge Cases and Expected Outcomes

- OpenCode binary missing or hanging: every `opencode api` call has a bound (10 s). A spawn fails with no pane when the gate, the model check or the create cannot finish. The launch check has its own bounds (15 s for the pane, 10 s for the prompt). Kill still succeeds and prints one line for the operator. A remove that times out is not retried. Restore and remap report the error.
- Corrupted `runtimeHandle` metadata: `send` fails with `Corrupted runtime handle`.
- Existing orchestrator metadata present but runtime dead under `reuse`: restart runtime and pass mapped `opencodeSessionId` when available.
- Duplicate OpenCode sessions with same AO title: a spawn does not search by title; it stores the ID that its own create returned. Remap accepts only the session's own workspace directory. More than one remaining candidate is refused; nothing picks by time.
- `ao session kill --purge-session` interrupts, then removes, the stored ID only. It keeps an ID that another live AO session stores (issue reuse) or that a launch in progress holds. A failed removal prints one line with the ID; `ao session cleanup` retries it.
- Archived OpenCode sessions already cleaned: `cleanup` skips duplicate deletion via `opencodeCleanedAt`.
- Unknown project/agent: fail fast with clear error.

## Revalidation Baseline (Current)

- Unit/integration validation that should remain green for OpenCode workflows:
  - `@aoagents/ao-plugin-agent-opencode` tests.
  - `@aoagents/ao-core` tests: `session-manager.test.ts`, `plugin-registry.test.ts`, `opencode-api.test.ts`, `session-manager/send-agent.test.ts`.
  - `@aoagents/ao-cli` tests: `plugins.test.ts`, `start.test.ts`, `session.test.ts`, `send.test.ts`, `status.test.ts`.
  - `@aoagents/ao-integration-tests` with `test:integration` (includes `agent-opencode.integration.test.ts`, conditionally skipped tests where prerequisites are unavailable).
