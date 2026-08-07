# 0004 — Running `ao` on the herdr runtime: configuration, command surface, and switching

**Date**: 2026-08-07
**Context**: operator guide for the `runtime-herdr` plugin built in response to
[0003](0003_herdr_assessment_and_the_runtime_plugin_option.md). Supersedes 0003 §7 as the practical
instructions.
**Status**: usable. Verified against herdr 0.8.0 on Linux. Not yet run under a real multi-worker campaign.

Everything marked **verified** below was executed against a live herdr server; everything else is read from
source and labelled as such.

---

## 1. Prerequisites

A herdr **server** must be running — the binary alone is not enough. The plugin's `detect()` checks
`herdr status server` specifically:

```bash
herdr status server      # expect: status: running
```

Launching `herdr` (or `herdr server` for headless) starts one. The server is **shared** with whatever the
operator is doing in it by hand; the plugin creates and closes only its own workspaces and never stops the
server.

tmux is still required if any project remains on the tmux runtime. `ao spawn`'s preflight already gates its
tmux check on the resolved runtime, so a herdr-only project does not need tmux installed.

---

## 2. Configuration

`runtime` is a free-form string in the schema, so no config-format change was needed:

```yaml
defaults:
  runtime: herdr          # was: tmux

projects:
  my-app:
    repo: org/my-app
    runtime: herdr        # per-project — other projects can stay on tmux
    sessionPrefix: app
```

**Verified**: this loads, validates, and resolves to the herdr plugin via `loadFromConfig`.

Optional plugin settings, passed through the plugin config block:

| Key | Default | Purpose |
|---|---|---|
| `binPath` | `herdr` | Path to the herdr binary if not on `PATH` |
| `commandTimeoutMs` | `10000` | Per-CLI-call timeout |
| `settleTimeoutMs` | `15000` | How long `sendMessage` waits for the agent to settle before prompting (see §5) |

Note `agent-orchestrator.yaml.example` still documents `runtime: tmux # tmux | process` and should gain
`herdr`.

---

## 3. What is unchanged

The runtime slot sits below everything operators actually interact with, so most of `ao` is unaffected:

- **`ao spawn`** — creates a herdr workspace + pane and runs the agent's launch command **verbatim**, so
  `--model` and permission flags survive. (The plugin deliberately uses `pane run` rather than
  `herdr agent start`, which would run the bare executable and drop them — see 0003 §8.)
- **`ao send`** — works. `canUseTmux` is false for herdr, so the CLI routes through
  `sessionManager.send()` → the plugin's `sendMessage`, instead of pasting into tmux.
- **`ao status`, `ao session ls`** — session listing is metadata-based and runtime-agnostic.
- **Lifecycle, PR/CI reactions, trackers, notifiers, activity detection** — all runtime-agnostic.
  **Verified**: `getActivityState` returns `idle` for a live herdr session rather than `exited`.

---

## 4. What differs

### 4.1 Attaching

`ao open` now finds herdr sessions (it previously enumerated tmux only and reported "No sessions to open"),
but it **prints** the attach command rather than opening a tab — attach needs a TTY, and `ao` may be running
headless or inside another agent's session:

```
$ ao open app-1
  app-1 — attach with: herdr agent attach w9:p1
```

Directly:

```bash
herdr                        # attach to the server, navigate workspaces/tabs/panes
herdr agent attach w9:p1     # jump straight to one session's pane
```

The same invocation is what the plugin's `getAttachInfo()` returns.

### 4.2 `ao status` last-activity column

`status.ts` derives the per-session "last activity" timestamp from `getTmuxActivity(handle.id)`, which
returns nothing for a herdr pane, so that column goes blank. The **activity state** itself is unaffected —
that comes from the agent plugin's `getActivityState`, which is herdr-aware. Read from source; not
separately measured.

### 4.3 Terminal plugins

`terminal-iterm2` and `terminal-web` derive tmux session names directly and do not consult `AttachInfo` at
all (0003 §4.1). They are tmux-only. Use §4.1 instead.

---

## 5. The one behaviour to design around

**A prompt sent to a freshly launched agent is silently dropped** — no error anywhere (0003 §8.2). The plugin
mitigates this: `sendMessage` polls `pane get` until an agent is both *detected* and in a settled state
(`idle`, `done` or `blocked`) before prompting, up to `settleTimeoutMs`. If no agent is ever detected it
falls back to raw `pane send-text` + Enter.

It deliberately does **not** pass `herdr agent prompt --wait`, because `--wait` does not track turns: if the
agent is already working, an unrelated turn's completion can satisfy it.

Consequently **`ao send`'s "Message sent and processing" is still not evidence of delivery** — that is
[0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md) §3 and it is unchanged. Keep the
durable-sentinel protocol (`<worktree>/.agent_report.md`).

---

## 6. Can you switch between herdr and tmux?

Three different questions, three different answers.

### 6.1 Per-project — yes

Different projects can run different runtimes simultaneously. Dispatch comes from
`RuntimeHandle.runtimeName`, which is persisted per session.

**Verified**: two sessions created under different runtimes, driven through the *same* agent plugin, both
correctly reported running — one dispatched to herdr (`wA:p1`), one to tmux (`mix-tmux`).

### 6.2 Changing the default, with existing sessions running — yes

New sessions use the new runtime; existing sessions keep being driven by the runtime named on their handle.
Every dispatch site now prefers the handle:

| Site | Behaviour |
|---|---|
| `enrichSessionWithRuntimeState` | prefers `handle.runtimeName` |
| lifecycle poll loop (liveness + both `getOutput` calls) | prefers `handle.runtimeName` via `runtimeForSession()` |
| recovery validator / actions | prefer the persisted handle |
| `destroy`, `restore`, `ao send` | already preferred the handle |
| agent `isProcessRunning` | branches on `handle.runtimeName` across all six plugins |

Both the session-manager and lifecycle behaviours have regression tests that fail if resolution is reverted
to config.

Config is still correctly used where no handle exists yet: spawning a new session, fabricating a handle for
an externally created session, and `ao spawn`'s preflight.

### 6.3 Migrating a *running* session between runtimes — no

A live agent process cannot be moved between PTY servers. Switching an existing session means draining it —
let it finish, or kill and re-spawn. There is no in-place migration and none is planned.

**Practical consequence**: flipping `defaults.runtime` is safe, but it is a *forward* change. The fleet ends
up mixed until the older sessions retire, which is supported but means two attach mechanisms are in play at
once.

---

## 7. Suggested rollout

1. Confirm `herdr status server` reports running.
2. Set `runtime: herdr` on **one** project; leave the rest on tmux.
3. Spawn one or two workers there. Attach with `herdr agent attach <pane>` and confirm the agent launched
   with the expected model.
4. Watch `ao status` — activity state should move through active/ready/idle, not sit at `exited`.
5. Only then consider `defaults.runtime`.

---

## 8. Known gaps

- `ao status`'s last-activity column is blank for herdr sessions (§4.2).
- `terminal-iterm2` / `terminal-web` remain tmux-only (§4.3).
- The §5 settle gate is unit-tested and exercised in a single-agent smoke test, but **has not been run under
  a multi-worker campaign**, which is where 0001's delivery problems actually surfaced.
- `agent-orchestrator.yaml.example` does not mention `herdr`.
- herdr is young; `worktree create` has open correctness bugs upstream
  ([issue #729](https://github.com/ogulcancelik/herdr/issues/729)). AO does not use `herdr worktree` — the
  `workspace-worktree` plugin still creates worktrees, and the runtime only opens a workspace at that path —
  so that particular bug does not reach us.
