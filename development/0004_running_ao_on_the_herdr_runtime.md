# 0004 — Running `ao` on the herdr runtime: configuration, command surface, and switching

**Date**: 2026-08-07
**Context**: operator guide for the `runtime-herdr` plugin built in response to
[0003](0003_herdr_assessment_and_the_runtime_plugin_option.md). Supersedes 0003 §7 as the practical
instructions.
**Status**: usable. Verified against herdr 0.8.0 on Linux, including 6- and 9-worker concurrent campaigns
(0003 §9). 9 workers is the concurrency at which 0001's delivery failures surfaced in production.
**Re-checked on herdr 0.9.5 (protocol 22; 0.8.0 was protocol 19)** on 2026-10-22, on isolated scratch servers
with a stand-in claude: [the live check](reviews/herdr_live_check_095_opus.md) (step 1) and the measurements of
[RH design r5](reviews/rh_design_r5_opus.md) section 7 and [RH design r6](reviews/rh_design_r6_opus.md)
section 9, fixtures in `artifacts/herdr_095_live_check/` (`r5_*`, `r6_*`). The configuration, the command surface, the per-project switch and the
send-and-verify path hold on 0.9.5. What changed is marked **0.9.5** below; the older facts are kept and
marked **0.8.0**. The largest change: a failed CLI call now exits 1 with its error on stderr (§5a), which AO's
reads do not see yet (§5a, "What AO reads today").

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
operator is doing in it by hand; the plugin creates only its own workspaces and never stops the server.
Since same-ID R2a, **the stop of a Herdr session closes nothing**: `ao session kill`, cleanup and restore get
the stop answer `unknown` and keep the record and the worktree, and the operator closes the workspace by hand
after a check (the "Next" line of the refusal). Two older close paths of the plugin still exist (read from the
code): when the agent launch fails during a create, the plugin closes the workspace that it just created, by
its ID and without a check; and the plugin's `destroy` closes the recorded workspace (no core caller uses it,
because core calls `stop`). The "Herdr 0.9.5 fit" round and the optional round RH (designs, not built:
[RH design r6](reviews/rh_design_r6_opus.md)) would remove both and add a bound close.

**0.9.5: which server AO reaches.** AO runs plain `herdr`, so the caller's environment picks the server. The
CLI's order (measured, RH design r5 §2.1): `--session <name>` (AO never passes it), then `HERDR_SOCKET_PATH`,
then `HERDR_SESSION` (`$XDG_CONFIG_HOME/herdr/sessions/<name>/herdr.sock`), then
`$XDG_CONFIG_HOME/herdr/herdr.sock`, then `$HOME/.config/herdr/herdr.sock`. Every pane shell that was
measured (r5, r6) had `HERDR_SOCKET_PATH` and `HERDR_SESSION` in its environment, so an `ao` command that runs
inside a herdr pane talks to that pane's server, and an `ao` command in a plain terminal talks to the default
socket. Run every `ao` command of a Herdr project with the same herdr environment. AO records no socket per
session yet (the "Herdr 0.9.5 fit" round of RH design r6 would pin it).

**0.9.5: `herdr status server`.** With a server: `status: running`, then `version`, `endpoint_compatible`,
`private_protocol: 22`, `private_protocol_compatible` and `socket` lines. With no server: exit 0 and
`status: not running`. AO's check `/status:\s*running/` reads both right. `herdr status server --json` names
the `socket` with and without a server. `herdr server` now also prints "did you mean to open the Herdr TUI?".

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
| `deliveryTimeoutMs` | `12000` | How long to wait for evidence a prompt was consumed before re-sending (§5) |
| `sendAttempts` | `3` | Prompt attempts before falling back to raw terminal input (§5) |

Note `agent-orchestrator.yaml.example` still documents `runtime: tmux # tmux | process` and should gain
`herdr`.

---

## 3. What is unchanged

The runtime slot sits below everything operators actually interact with, so most of `ao` is unaffected:

- **`ao spawn`** — creates a herdr workspace + pane and runs the agent's launch command **verbatim**, so
  `--model` and permission flags survive. (The plugin deliberately uses `pane run` rather than
  `herdr agent start`, which would run the bare executable and drop them — see 0003 §8.)
- **`ao send`** — works for an `idle` or `done` agent. `canUseTmux` is false for herdr, so the CLI routes
  through `sessionManager.send()` → the plugin's `sendMessage`, instead of pasting into tmux. Two 0.9.5
  limits (measured with a stand-in claude, step 1 §3.4):
  - **A `blocked` agent** (a permission dialog): herdr refuses `agent prompt` with `agent_blocked` before it
    sends any input. AO's settle gate accepts `blocked`, so `ao send` then exits 1 with a stack trace and a
    wrong reason ("session needed to be restarted before delivery ... not in a terminal state"). No text
    reaches the dialog. Answer the dialog in herdr first.
  - **A very short turn can be delivered more than once.** From `done`, only `working` counts as delivery
    evidence. A 0.15 s turn was not visible as `working` in 4 of 6 tries, so AO sent the message again: one
    `ao send` delivered it 3 times. A real `/clear` or another instant command can do this; how often is not
    measured on a real claude.
- **`ao status`, `ao session ls`** — session listing is metadata-based and runtime-agnostic.
- **Lifecycle, PR/CI reactions, trackers, notifiers, activity detection** — all runtime-agnostic.
  **Verified**: `getActivityState` returns `idle` for a live herdr session rather than `exited`.

---

## 4. What differs

### 4.1 Attaching

**0.8.0** (and the upstream CLI): `ao open` found herdr sessions (it previously enumerated tmux only and
reported "No sessions to open"), but it **printed** the attach command rather than opening a tab — attach
needs a TTY, and `ao` may be running headless or inside another agent's session:

```
$ ao open app-1
  app-1 — attach with: herdr agent attach w9:p1
```

**This fork** has no `ao open`. `ao session attach <id>` runs `herdr agent attach <pane>` in the current
terminal (it inherits the terminal; `packages/cli/src/commands/session.ts`). **0.9.5** adds `--takeover` to
`herdr agent attach`; AO does not pass it.

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

**A prompt sent to a freshly launched agent is silently dropped** — no error anywhere (0003 §8.2).

The first mitigation was a settle gate: wait until herdr reports the agent `idle`, then prompt. **The 6-worker
campaign showed that does not work** (0003 §9). herdr reports `idle` as soon as it recognises the agent's prompt
box — roughly 2 s after launch, while claude is still on its splash screen with 0 tokens — so the gate opens
immediately and prompts go into the void. Measured: **0/6 delivered**, with `sendMessage` returning "ok" in 1.6 s
against a 15 s timeout.

`sendMessage` therefore **sends and verifies**:

1. Wait for a settled agent (`idle`, `done`, `blocked`) — up to `settleTimeoutMs`. This only decides *when to try*.
2. Send the prompt, then poll `pane get` for evidence it was consumed: the agent departing its pre-send state
   toward `working`, within `deliveryTimeoutMs`.
3. No evidence → let it settle again and re-send, up to `sendAttempts`.
4. Still nothing → fall back to raw `pane send-text` + Enter.
5. Still nothing → **throw**. A verified non-delivery is reported as a failure, never as success.

Re-measured under the same zero-delay condition: **3/3** at 6 workers and **6/6 at 9 workers** through
`sendMessage`, against **0/3** both times through raw `herdr agent prompt`. Expect a first send to cost ~15 s on a
cold agent — that is one discarded attempt being detected and retried, and it is the price of not losing the
message. At 9 workers the first attempt was swallowed in **every single case** (0003 §9.4), so that cost is the
norm at fleet scale, not an edge case.

**0.9.5** (step 1 §3.1, §3.2, §6.2; a stand-in claude, so the real-claude timings are not measured):

- herdr reports `idle` 3.6 to 4.1 s after `pane run` (0.8.0: roughly 2 s). `ao spawn` waits a fixed 3 s before
  its first `pane get`, then settles; a warm stand-in got the first prompt at once (spawn 5.9 s).
- The cold-start cost is the same: a stand-in that dropped input for 8 s cost 12.6 s from the first to the
  second attempt (spawn 18.5 s, 2 attempts).
- **The first task ends in `done`**, on an unfocused pane, and so does every later turn: `unknown` → `idle` →
  `working` → `done`. So every send after the first turn starts from `done`, where only `working` is evidence.
  For a 3 s turn herdr showed `working` 0.8 to 1.3 s after the prompt; for a very short turn, see §3.
- `herdr agent get` has new fields: `state_change_seq`, `completion_seq`, `interactive_ready`,
  `launch_pending`, `screen_detection_skipped`. With the stand-in, `interactive_ready` and `launch_pending` were
  absent, and the two counters moved only on the turns that herdr saw as `working`, so none is yet the "agent
  can accept input" signal of §8.
- `agent prompt` takes about 340 ms and now refuses a `blocked` agent (`agent_blocked`, §3).

It deliberately does **not** pass `herdr agent prompt --wait`, because `--wait` does not track turns: if the
agent is already working, an unrelated turn's completion can satisfy it. **0.9.5:** `--wait` now needs an
observed `working` or `blocked` state within 5 s after the submission, else `agent_prompt_stalled`; it still
tracks the state, not the turn.

A fixed delay would also have passed this campaign, and would silently fail at a different agent, model, or machine
speed. The verification is the load-bearing part.

Note this makes `ao send` *fail loudly* on herdr rather than lie. It does **not** make success proof that the agent
understood or acted on the message — that is
[0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md) §3 and it is unchanged. Keep the
durable-sentinel protocol (`<worktree>/.agent_report.md`).

---

## 5a. Errors, reads and IDs (0.9.5)

**Errors.** **0.8.0:** a failed API call printed the error envelope `{"error":{"code",...}}` on **stdout**
with exit **0** (0003 §8; the R4 reads of `docs/DEVELOPMENT.md`, rows 8 and 9, accept that form).
**0.9.5:** a failed API call exits **1**, prints nothing on stdout, and prints one line
`{"error":{"code":...,"message":...},"id":"cli:<group>:<command>"}` on **stderr** (step 1 §4.1, §4.3; 21 of
AO's call answers changed). More 0.9.5 forms (RH design r5 §2.1):

- With no server (no socket file, or a stale one), the CLI itself writes the code `server_not_running`
  ("no herdr server is running at <socket>; ..."), exit 1.
- Each measured pane operation of the CLI first sent a `ping` on its own connection and then the request on a
  second one. A call whose `ping` fails sends no request, and `status server --json` is itself a `ping`. A
  server with another protocol gives the CLI's own `protocol_mismatch`, exit 1.
- `EACCES` on the socket, a partial or non-JSON answer, and a closed connection give Rust debug text on
  stderr (`Error: Os { code: 13, ... }`, `Error: Custom { ... }`), not JSON.
- The CLI has no timeout of its own: a server that never answers keeps the CLI waiting. AO's per-call limit
  (`commandTimeoutMs`, 10 s) still applies.
- The raw socket API did not change: the error is still an envelope in the answer line.

**What AO reads today** (step 1 §4.2, §10). AO reads stdout through `execFile`, which rejects on exit 1, so on
0.9.5:

- `isAlive` rejects (unknown) for a closed pane or a closed workspace, where 0.8.0 gave `false`. It still
  answers `false` for the same pane ID with another terminal (after a restart).
- The agents' process check on a Herdr pane (core `herdr.ts`) rejects for a closed pane, where 0.8.0 gave
  "no process".
- With no server, both reject without AO's "no server" code. So the lifecycle keeps a session whose
  workspace was closed, and `ao start` reads its orchestrator as `unknown` and stops.
- A record without a runtime handle (during a spawn) gets a handle made from the session name, so the
  lifecycle calls `pane process-info --pane <session name>`. herdr answers `pane_not_found` for any malformed
  ID.

The fix is the "Herdr 0.9.5 fit" round of RH design r6 (not built).

**`pane read --source recent-unwrapped`.** **0.8.0:** empty for a pane with no detected agent, so `getOutput`
fell back to `visible`. **0.9.5:** it returned the shell text of such a pane in the measured case, so the
fallback runs less often. `getOutput` still falls back to `visible` on an error or on an empty or
whitespace-only answer (read from the code).

**IDs.**

- Workspace and pane counters use bijective base 32 with the symbols `123456789ABCDEFGHJKMNPQRSTVWXYZ0` (no
  `I`, `L`, `O`, `U`; `0` is the digit 32): `w1` to `w9`, `wA` to `wZ`, `w0`, `w11`; panes `<workspace>:p1`,
  `:p2`, ... `:pZ`, `:p0`, `:p11` per workspace. Measured through `w11` (step 1) and `p13` (r6); longer IDs are
  an extrapolation of the same rule. IDs are case-sensitive. The 0.8.0 IDs had the same form.
- A terminal ID is `term_` + 13 hex digits of the creation time in microseconds + the terminal counter of
  the server run in hex.
- **Within one server run herdr reuses no workspace or pane ID.**
- **After a restart** every workspace and pane keeps its ID, every terminal ID is new, and the agents are gone
  (the panes run new shells). The workspace counter starts at the highest open ID plus one, so the IDs of
  closed workspaces above it come back: a new AO session got the pane ID of a closed one (step 1 §5.3, §5.4).
  AO stayed right because every caller checks the terminal ID first.
- **After a live handoff** (the API `server.live_handoff`, measured; `herdr update --handoff` names the same
  handoff in its usage text, not run): a new server process serves the same socket path with a new listening
  socket. In the two measured handoffs (one shell-only pane each, r5 and r6) the pane kept its ID and its
  shell process, but **its terminal ID changed**. AO compares terminal IDs, so after a handoff it would read
  every running session as gone. Read from the code, with the path that step 1 measured after a restart (§3.3, §3.4, §3.7): `ao
  status` shows `exited`, the lifecycle writes `killed` after its bound, and `ao send` refuses. Nothing is
  closed. AO was not run through a handoff. Do not run a live handoff while AO Herdr sessions run.

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

1. Confirm `herdr status server` reports running, in the same environment as your `ao` commands (§1: the
   environment picks the server).
2. Set `runtime: herdr` on **one** project; leave the rest on tmux.
3. Spawn one or two workers there. Attach with `herdr agent attach <pane>` and confirm the agent launched
   with the expected model.
4. Watch `ao status` — activity state should move through active/ready/idle, not sit at `exited`.
5. Only then consider `defaults.runtime`.

---

## 8. Known gaps

- `ao status`'s last-activity column is blank for herdr sessions (§4.2).
- `terminal-iterm2` / `terminal-web` remain tmux-only (§4.3).
- §5's send path costs ~15 s on a cold agent, because the first attempt is expected to be swallowed and is only
  detected by timing out. Measured at 9 workers, the agent becomes promptable somewhere between 1.7 s and 14.5 s,
  but the current `deliveryTimeoutMs` (12 s) waits out the whole window rather than finding that point. A shorter
  timeout with more attempts would likely converge faster; the crossover is unmeasured. If herdr ever exposes a
  true "agent can accept input" signal, the wait collapses entirely. **0.9.5** has the candidates
  `interactive_ready` and `launch_pending` in `agent get`; they were absent with the stand-in, and whether a
  real Claude Code fills them (perhaps only with herdr's claude integration) is not measured (§5).
- `agent-orchestrator.yaml.example` does not mention `herdr`.
- **0.9.5: the group close.** `workspace close` of a primary workspace that has a linked worktree workspace
  (made with `herdr worktree create`) fails with `workspace_group_close_required` (exit 1) and closes nothing;
  `--group` (`close_group: true` in the API) closes the whole group. An AO workspace is not linked and closes
  without `--group`, unless someone runs `herdr worktree create --workspace <AO workspace>`. herdr refuses that
  for a worker workspace, whose directory is a linked git worktree (`linked_worktree_source`, r6). It accepts
  it for a workspace in the main checkout (r6), and an orchestrator in `orchestratorWorkspaceMode: project`
  runs there (read from the code). No close removed a git worktree or a branch (step 1 §6.1, r6). AO must never pass `--group`: it would close the operator's linked
  workspaces.
- **0.9.5: closing the only pane.** A `pane close` of the only pane of a plain workspace closes the pane and
  the workspace at once, with `ui.confirm_close` on or off; the API never asks (step 1 §6.3). `confirm_close`
  is a TUI setting. **Exception:** for the only pane of a primary workspace that has a linked worktree
  workspace, `pane.close` answers `confirmation_required` ("closing this pane would close a worktree group")
  and closes nothing (r6, `r6_e_nm1_log`). herdr refuses `worktree create` from a workspace whose directory is
  a linked git worktree (`linked_worktree_source`), so an AO worker workspace cannot become such a primary.
- **0.9.5: a shell that exits.** When the shell of the only pane exits, herdr removes the pane and the
  workspace (r6, `r6_g_proc_domain_log`).
- **0.9.5: what a pane close ends.** `pane close` sends `SIGHUP`, then `SIGTERM`, then `SIGKILL` (about 0.27 s
  apart) to the processes of the pane shell's session, also to a background job that ignores `HUP` and
  `TERM`. A process that left the session (`setsid`) gets no signal and keeps running (r6, `r6_i_*`).
- **0.9.5: errors on stderr** (§5a): AO's liveness and process reads do not see `pane_not_found` or
  `server_not_running` yet.
- **0.9.5: a live handoff** changes every terminal ID, and AO then reads every running session as gone (§5a).
- **The server depends on the caller's environment** (§1): AO records no socket per session yet.
- herdr is young; `worktree create` has open correctness bugs upstream
  ([issue #729](https://github.com/ogulcancelik/herdr/issues/729)). AO does not use `herdr worktree` — the
  `workspace-worktree` plugin still creates worktrees, and the runtime only opens a workspace at that path —
  so that particular bug does not reach us.
