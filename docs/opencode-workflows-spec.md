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
- Launch ownership: right after it reserves the record (before the workspace), core writes `launchPid` (the PID of the `ao` process) and `launchPidStart` (its start time, field 22 of `/proc/<pid>/stat`) into it; before the prepare it adds the mapped id when one is reused. While that process runs with that start time, every check of a shared OpenCode ID (issue `delete`, orchestrator `delete`, `ao session cleanup`, `ao session kill --purge-session`, remap) counts the record as a live holder, also before its pane exists, and `ao session cleanup` does not kill the record. `ao session kill` (with or without `--purge-session`), `ao session restore`, `ao session remap` and `ao stop` of that record exit 1 with `Cannot <action> session <id>: ao process <pid> is still launching it. Stop ao process <pid> or wait for the launch to finish, then try again.` and change nothing; a project orchestrator start refuses to reuse or replace an orchestrator record whose launch is in progress the same way. The rule does not read `status`, so a `killed` status from the lifecycle's first poll does not change it (the lifecycle merges its status write and keeps the keys). After the launch check passes, core removes both keys and the pane rule applies; a failed spawn removes the whole record. A launcher that is gone, a zombie, or a PID that now has another start time, protects nothing. A record with launch keys but no runtime identity (no `runtimeHandle`, no `tmuxName`) whose launcher is dead is a dead holder: its id can be removed. Only an old record without launch keys and without runtime identity keeps its id as "liveness could not be checked". The pane command is exactly `exec opencode --session '<id>'`, plus `--prompt ...` when there is a prompt. It holds no `opencode api` call.
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

- Resolves agent by project config. `send()` never searches by title: a session without a stored ID sends without the OpenCode delivery check from `session.get`.
- Sends message through runtime plugin handle; fails if session/runtime cannot be resolved.
- Busy detection is plugin-driven (`detectActivity`).

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
  - `@aoagents/ao-core` tests: `session-manager.test.ts`, `plugin-registry.test.ts`.
  - `@aoagents/ao-cli` tests: `plugins.test.ts`, `start.test.ts`, `session.test.ts`, `send.test.ts`, `status.test.ts`.
  - `@aoagents/ao-integration-tests` with `test:integration` (includes `agent-opencode.integration.test.ts`, conditionally skipped tests where prerequisites are unavailable).
