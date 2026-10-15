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
- For every strategy, when no stored ID is reused, the start waits up to 15 s for the pane to create its OpenCode session and stores its ID (see `ao spawn`).
- For `ignore` strategy:
  - do not delete old OpenCode sessions; launch fresh runtime.

## 3) `ao spawn`

- Uses selected agent (default/project/override) and launches OpenCode command from plugin launch config.
- OpenCode launch behavior:
  - no mapped id: the pane script creates the session with `opencode api session.create` (title `AO:<session>`, directory = the pane's working directory) and then starts `opencode --session <id>`.
  - mapped id (`agentConfig.opencodeSessionId`): launch directly with `--session <id>`.
- Fresh starts take a host-wide lock keyed by the real workspace directory and exact title, outside config hashes and state roots. They wait at most 30 s for a competing launch, then refuse before launching another pane. The launch timestamp is recorded only after acquiring the lock; it is held until discovery and metadata persistence finish.
- The pane creates the session only after `runtime.create` returns, so `spawn` waits for it: up to 15 s, one `session.list` search every 500 ms. It stores the ID only when exactly one session has the exact title `AO:<session>`, `location.directory` equal to the workspace (or its real path), and `time.created` at or after the spawn start. Two fleets with the same session prefix give the same title, so the title alone never selects a session.
- When the wait ends with no match or with more than one match, the spawn still succeeds without a mapping, and the operator gets one line on stderr that names `ao session remap <session>`.
- A failed discovery leaves `/tmp/ao-opencode-launch-<uid>/<workspace-title-hash>/pending.json`. On the next fresh start, a single bounded exact-title/real-directory search for `time.created >= startedAt` can settle the earlier create. The pane script makes one create with no retry. A match clears the marker; the next launch timestamp excludes that conversation. If no match is available, recovery requires both an age of at least 25 s (the 15 s discovery window plus one 10 s API bound) and an explicit missing-session answer from the recorded tmux socket. An unreachable server, an old marker with no socket, and Herdr are unknown. Elapsed time alone never clears a marker. Each wait or recovery prints the title and directory.
- A tmux `new-session` failure occurs before command delivery and clears its marker. A failure that may follow command delivery retains the marker and archives the worker's reserved number, so later workers use a new title/workspace. After runtime creation the marker records the handle and, when available, its tmux socket; no runtime plugin change is required.
- Manual recovery: stop and settle the earlier pane **and any in-flight create request**, then run `rm -r -- '/tmp/ao-opencode-launch-<uid>/<workspace-title-hash>'`, substituting the exact directory printed in the refusal or discovery warning. Those messages include the complete command. Removing only `pending.json` leaves an empty directory; a subsequent start reclaims it after three seconds. Killing only the launcher is insufficient. All colliding launchers must use the protocol; an older build or manual create can bypass it.
- A launcher suspended across its discovery deadline makes one last bounded search on resumption. This can add at most one 10 s API bound. A hanging search that exhausts the window is not retried.
- Issue reuse (`opencodeIssueSessionStrategy: reuse`) reuses a stored ID of an earlier session of the same issue only when `session.get` finds it. `delete` removes those stored IDs, except an ID that another live AO session stores.
- Model/subagent/system prompt inputs are forwarded into OpenCode launch command.

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

- OpenCode binary missing or hanging: every `opencode api` call has a bound (10 s; the spawn wait 15 s in total). Spawn and kill still succeed and print one line for the operator. A remove that times out is not retried. Restore and remap report the error.
- Corrupted `runtimeHandle` metadata: `send` fails with `Corrupted runtime handle`.
- Existing orchestrator metadata present but runtime dead under `reuse`: restart runtime and pass mapped `opencodeSessionId` when available.
- Duplicate OpenCode sessions with same AO title: the spawn wait and remap accept only the session's own workspace directory, and the spawn wait only sessions created after the spawn start. More than one remaining candidate is refused; nothing picks by time.
- `ao session kill --purge-session` interrupts, then removes, the stored ID only. It keeps an ID that another live AO session stores (issue reuse). A failed removal prints one line with the ID; `ao session cleanup` retries it.
- Archived OpenCode sessions already cleaned: `cleanup` skips duplicate deletion via `opencodeCleanedAt`.
- Unknown project/agent: fail fast with clear error.

## Revalidation Baseline (Current)

- Unit/integration validation that should remain green for OpenCode workflows:
  - `@aoagents/ao-plugin-agent-opencode` tests.
  - `@aoagents/ao-core` tests: `session-manager.test.ts`, `plugin-registry.test.ts`.
  - `@aoagents/ao-cli` tests: `plugins.test.ts`, `start.test.ts`, `session.test.ts`, `send.test.ts`, `status.test.ts`.
  - `@aoagents/ao-integration-tests` with `test:integration` (includes `agent-opencode.integration.test.ts`, conditionally skipped tests where prerequisites are unavailable).
