# 0003 — Herdr assessed: it competes with our runtime layer, not with `ao`, and that opens a third option

**Date**: 2026-08-07
**Context**: assessment of [herdr.dev](https://herdr.dev/) (`github.com/ogulcancelik/herdr`) against this fork and
against the upstream Go rewrite evaluated in
[0002](0002_upstream_divergence_backported_fixes_and_migration_assessment.md).
**Status**: assessment only. No prototype written.

The useful finding is a layering correction. **Herdr is not an alternative to `ao`. It is an alternative to `ao`'s
runtime plugin.** That distinction matters because all four defects recorded in
[0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md) are runtime-layer defects, and Herdr
addresses every one of them — which makes a `runtime-herdr` plugin a cheaper route to fixing them than either
staying put or migrating.

---

## 1. What Herdr is

A persistent background server that owns real PTYs for coding agents.

| Property | Value |
|---|---|
| Implementation | single Rust binary, ~10 MB, **no Electron** |
| License | **Apache 2.0** (verified against the raw `LICENSE` file — see §6) |
| Traction | ~25.5k GitHub stars |
| Platforms | macOS · Linux · Windows (beta) |
| Model | workspaces → tabs → panes; tmux-shaped, with tmux-style prefix keys *and* mouse |
| Agent state | `idle` / `working` / `blocked` / `unknown`, hook-derived |
| Agents | ~20 kinds (claude, codex, gemini, cursor, devin, agy, opencode, copilot, grok, droid, kimi, hermes, …), installed via `integration install <agent>` |
| Isolation | first-class `worktree create` / `list` / `open` / `remove` |
| Extensibility | socket API (`herdr api schema`) + out-of-process plugins (`herdr-plugin.toml`) |

Its stated pitch is durability: "close the lid, drop the network, restart the machine — agents keep working and
sessions come back." It explicitly does not wrap or replace the agents — "it just owns their terminals."

**What it has no concept of**: pull requests, CI, code review, issue trackers, merge, or a lifecycle state machine.
It is not the planner, the review system, or the merge authority.

---

## 2. Three-way comparison

| Layer | This fork | Upstream AO (Go rewrite) | Herdr |
|---|---|---|---|
| Terminal / PTY | tmux via `runtime-tmux` (**184 LOC**) | own PTY host, `runtimeselect` (tmux on unix, ConPTY on Windows) | **own server — this is the product** |
| Agent state | per-plugin JSONL parsing | hook-derived (`hooksjson`, `hookutil`, `activitystate`, `activitydispatch`) | hook-derived, plus `agent wait` / `agent prompt --wait` |
| Worktrees | `workspace-worktree` plugin | built in | `worktree create --branch` |
| Agent coverage | 6 plugins | 24 harnesses | ~20 kinds |
| Inter-agent coordination | none | none | **socket API — agents spawn panes, prompt each other, wait on state** |
| **PR / CI / review reactions** | **full lifecycle** | **full lifecycle** | **none** |
| Trackers / notifiers | GitHub, Linear, GitLab; 6 notifiers | yes | none |
| Language / license | TypeScript, MIT | Go + TS, Apache 2.0 | Rust, Apache 2.0 |

The value `ao` provides — the state machine that reacts to CI failures and review comments and drives a session to
merge — has no Herdr equivalent. Herdr sits strictly below that line. Note also that the upstream rewrite *built its
own version of Herdr in-house*: their PTY host and hook-derived activity state occupy the same layer.

---

## 3. Why this matters: 0001's defects are all runtime-layer

| 0001 defect | Herdr's answer |
|---|---|
| **§4** `tmux capture-pane` cannot see alt-screen TUI agents; greps over "scrollback" always return 0 — this produced a confident, wrong "the briefs were never delivered" conclusion | Herdr owns the PTY. `pane read` takes `--source visible \| recent \| recent-unwrapped \| detection`. `recent-unwrapped` is precisely the alt-screen case, and agent state comes from installed hooks rather than scraping at all |
| **§3** `ao send`'s status line is wrong in both directions; it reports what the tmux paste did, not what the agent received | `agent prompt --wait` and `agent wait` poll until the agent reaches a target state. This is actual delivery verification |
| **§5** spawn-time brief-delivery race — `ao spawn` fuses worktree creation and agent launch, so the brief cannot be placed beforehand | `worktree create`, `pane split`, and `agent start` are **separate commands**. Create the worktree, write the brief, then start the agent. The race becomes a composition choice, not a structural property |
| **§1** branch name derived from spawn title; identical titles hard-fail | `worktree create --branch NAME` is explicit. No title coupling |

Four for four. That is not a coincidence — it is what "the runtime layer done properly" looks like, and it is the
layer where all four defects live.

---

## 4. The third option: a `runtime-herdr` plugin

The fork's `Runtime` interface (`packages/core/src/types.ts:257`) is five required methods plus two optional. Each
maps near-1:1 onto a Herdr command:

| `Runtime` method | Herdr command | Note |
|---|---|---|
| `create(config)` | `agent start NAME --kind KIND --pane ID` | after `worktree create` / `pane split` |
| `destroy(handle)` | `pane close` / `pane release-agent` | |
| `sendMessage(handle, msg)` | `agent prompt --wait` | **fixes §3** |
| `getOutput(handle, lines)` | `pane read --source recent-unwrapped` | **fixes §4** |
| `isAlive(handle)` | `agent get` / `pane list` | |
| `getAttachInfo?(handle)` | `session attach` / `terminal attach` | |
| `getMetrics?(handle)` | `pane process-info` | |

**`runtime-tmux` is 184 lines.** A `runtime-herdr` plugin is plausibly 250–350 given Herdr's richer surface. That
buys fixes for §1, §3, §4 and §5 while keeping the PR/CI/lifecycle stack that is the actual reason we run `ao`.

A second-order opportunity: Herdr's `blocked` maps onto AO's `waiting_input`/`blocked`, and `working`/`idle` map
directly. An agent plugin could eventually source `getActivityState` from Herdr's hook-derived state instead of
parsing each agent's JSONL — which would retire the entire class of bug fixed in
[0002](0002_upstream_divergence_backported_fixes_and_migration_assessment.md) §2.1, where Codex's
`approval_request` branch was unreachable dead code. That is a larger change (the `Agent` slot is per-agent) and
should not be attempted in the same step.

### 4.1 Correction — the runtime slot is not as clean a seam as §4 implies

An earlier revision of this document claimed a `runtime-herdr` plugin would be ~300 LOC and that runtimes could be
swapped freely by config. **Both claims were checked against the code and are too optimistic.** The plugin *design*
supports swapping; the *implementation* carries tmux assumptions above and beside the runtime slot.

What genuinely works:

- Runtime is config-selected per project — `project.runtime ?? config.defaults.runtime` (`session-manager.ts:745`).
- `RuntimeHandle` carries `runtimeName`, and three paths correctly prefer it over config: destroy
  (`session-manager.ts:1725`), restore (`:1964`), and `ao send` (`cli/commands/send.ts:36`). Sessions created under
  tmux keep dispatching to tmux after the default is flipped.

What does not:

| Coupling | Location | Effect |
|---|---|---|
| **Agent plugins branch on the runtime name.** `findClaudeProcess` uses a tmux `list-panes` TTY lookup when `handle.runtimeName === "tmux"`, else a PID from `handle.data` | `agent-claude-code/src/index.ts:463` | A herdr handle matches neither branch → no `pid` → returns `null` → `isProcessRunning` false → **every session reports exited**. Needs a herdr branch in **all 6 agent plugins** |
| `enrichSessionWithRuntimeState` takes `plugins` from `resolvePlugins(project)` — config-resolved, not handle-resolved | `session-manager.ts:879` | After a config flip, liveness for tmux-created sessions is routed to the herdr plugin |
| Recovery resolves runtime from config, ignoring the handle | `recovery/validator.ts:32`, `recovery/actions.ts:116` | Same mis-routing during recovery |
| Hardcoded `handle.runtimeName === "tmux"` foreground-command branches; non-tmux falls back to `agentPlugin.processName` | `session-manager.ts:2026, 2073` | Degraded, not equivalent, behavior |
| Fabricated handles hardcode `runtimeName: "tmux"` | `cli/commands/status.ts:487`, `cli/commands/send.ts:51` | Wrong dispatch for non-tmux sessions |
| `tmux.ts` lives in **core**, not in `runtime-tmux`; tmux appears in **20 files** outside the plugin | `core/src/tmux.ts` et al. | The abstraction leaks |

**Revised scope**: one runtime plugin + six agent-plugin patches + ~4 core dispatch fixes ≈ **700–1000 LOC**.

**Revised claim about switching**: *per-project* selection (project A on tmux, project B on herdr) is close to
working and is the realistic target. *Live switching* of the default while tmux sessions are running would break
enrichment and recovery for those sessions until they drain. Reversibility is real but coarse — drain the fleet,
flip config — not a hot swap.

This does not sink option 1, but it roughly triples its cost and means the work touches the `Agent` slot, which §4
said to avoid in the first step. Sequencing that honestly: the agent-side `isProcessRunning` branch is not optional
follow-on work, it is a prerequisite.

---

## 5. How this changes the migration calculus

0002 framed the decision as fork-versus-rewrite. There are three options:

1. **Stay on the fork, swap the runtime.** ~700–1000 LOC per §4.1 (runtime plugin + 6 agent plugins + core dispatch
   fixes). Fixes §1/§3/§4/§5. Keeps patch-level control, stays TypeScript, no relicense, no Go. Adds a fast-moving
   external dependency.
2. **Migrate to the upstream Go rewrite** (0002 §5–6). Same defects fixed, plus 24 harnesses and active
   maintenance — but patch-level control drops and `--model` on spawn is missing.
3. **Stay as-is.** Every future fix is ours alone; the upstream TypeScript lineage ended at `5897b4e8d`.

Option 1 did not exist in 0002's analysis and is still the cheapest path to the pain we have actually measured — but
at ~3× the cost §4 originally claimed, the gap to option 2 is narrower than it first appeared. It also
**de-risks option 2**: if a Herdr runtime resolves §1/§3/§4/§5, the urgency behind migrating drops sharply and the
rewrite can be evaluated on its merits rather than under operational pressure.

Options 1 and 2 are not mutually exclusive in the long run, but they compete for the same effort now. Option 1
should still be tried first because it is smaller, coarsely reversible (drain the fleet, flip config — see §4.1),
and does not commit us to anyone else's roadmap. The honest counter-argument is that ~1000 LOC of runtime plumbing
we then maintain alone is a real fraction of what migrating would cost outright.

---

## 6. Method and caveats

- **License verified directly.** `raw.githubusercontent.com/ogulcancelik/herdr/master/LICENSE` is the Apache
  License 2.0 verbatim. Several third-party write-ups claim AGPL-3.0-or-later with a commercial option; **they are
  wrong**, but re-check before adopting, since projects do relicense.
- Herdr is young and moving fast. `worktree create` has open correctness bugs
  ([issue #729](https://github.com/ogulcancelik/herdr/issues/729): fails when the branch already exists locally).
  Taking it as our runtime means depending on a fast-moving project at a layer where failure is total.
- §1–§5 are from the site, the CLI reference, the repo, and the LICENSE file. **§8 is measured** — the spike was
  run against herdr 0.8.0 on 2026-08-07. The `Runtime` mapping in §4 remains a reading of both interfaces, not a
  working plugin. Star count and agent lists are as published and will drift.
- Windows support is beta; irrelevant to us today but relevant if the fleet ever moves.

---

## 7. Sequencing

Do **not** start with the plugin. Per §4.1 the full path is ~700–1000 LOC across three packages.

The premise was tested first with a throwaway CLI spike — results in §8. Given those results, the plugin work is
justified and should be sequenced: agent-side `isProcessRunning` first (it is the prerequisite, not follow-on work),
then the runtime plugin, then the core dispatch fixes in §4.1 — targeting *per-project* selection, not live
switching.

---

## 8. Spike results (measured, herdr 0.8.0, 2026-08-07)

Throwaway git repo in a scratch dir; `herdr worktree create` → `agent start --kind claude` → prompt → read. The
agent was **claude-code**, deliberately: it is the alt-screen TUI case that defeated `tmux capture-pane` in
[0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md) §4.

### 8.1 0001 §4 — terminal readback: **SOLVED, decisively**

Prompted the agent to emit `SPIKE-1` … `SPIKE-120`, one per line. Viewport was 62 rows, so most of the output
scrolled off. Reading back the same pane through each source:

| `--source` | matches | earliest reachable |
|---|---|---|
| `visible` | 54 | `SPIKE-67` |
| `recent` | **122** | **`SPIKE-1`** |
| `recent-unwrapped` | **122** | **`SPIKE-1`** |

`SPIKE-1, 2, 3, 60, 119, 120` were all individually retrievable. (122 vs 120 = the echoed prompt text also contains
two matches.)

`visible` is the tmux-equivalent view and reproduces exactly the 0001 §4 failure: a window onto the current screen
only. `recent`/`recent-unwrapped` return the **full history of an alt-screen TUI agent**. This kills the defect that
produced "a confident, wrong, user-facing conclusion that the briefs were never delivered" — a grep over agent
history now returns real results instead of always 0.

### 8.2 0001 §3 — delivery verification: **mostly solved, with a real race**

Two runs, opposite outcomes:

| Scenario | `--wait` returned | Actual state |
|---|---|---|
| Prompt issued **immediately after `agent start`** | `done` in **0.6 s** | **Prompt never delivered.** Agent still at splash screen, input box empty, **0 tokens** |
| Prompt issued to a **settled idle** agent | `done` in **4.2 s** | Correct — all 40 requested output lines already present at return |

On a settled agent this is genuine completion verification and is strictly better than `ao send`, which 0001 §3
found "wrong in BOTH directions." The output is fully materialized by the time `--wait` returns.

**But the first row is the same false-success class we already suffer from**, and worse — the prompt was dropped
*entirely*, not merely unverified. The cause is documented in `agent prompt --help`: `--wait` "does not track
turns", and after a non-working start it matches any observed state change within 5000 ms — here it matched the
agent's own startup transition (`state_change_seq` 1 → 3) rather than the prompt's turn.

**Mitigation for the plugin**: never prompt straight after `agent start`. Gate on `herdr agent wait <target>
--until idle` first, and treat `--wait` as necessary-but-not-sufficient — pair it with a durable sentinel exactly as
0001 §3 concluded. This is a bug we must design around, not one Herdr removes for us.

### 8.3 0001 §5 and §1 — structurally solved

`worktree create` and `agent start` are separate calls: the worktree existed on disk, on an explicitly named branch
(`--branch spike/eval`), and was writable **before** any agent process launched. The brief-before-first-turn
protocol composes naturally, and branch naming has no coupling to any title or display name.

### 8.4 Operational notes for a plugin implementer

- A herdr server was **already running** (v0.8.0, protocol 19, socket at `~/.config/herdr/herdr.sock`). The plugin
  must attach to an existing server, not assume ownership of one.
- **Every command returns structured JSON** with stable ids (`workspace_id`, `pane_id`, `terminal_id`,
  `agent_status`, `state_change_seq`). This maps cleanly onto `RuntimeHandle.data` and is far better to parse than
  tmux's text output.
- `agent start` took **3.0 s** to reach `interactive_ready`, and correctly reported `agent: claude`.
- `agent explain` gives the detection rule and its evidence string (e.g. `rule: live_prompt_box (priority=950)`,
  with the matched text). That is a genuinely useful debugging surface AO has no equivalent of.
- State vocabulary is `idle | working | blocked | done | unknown` — note **`done` is a fifth state** AO's
  `ActivityState` does not have, and it is distinct from `idle`. A mapping decision is required, not a rename.
- CLI wart: `worktree remove` takes `--workspace`, not `--path`, despite `create` accepting `--path`. Fell back to
  `git worktree remove`.

### 8.5 Verdict

Two of the four 0001 defects are eliminated outright (§4, §1), one is structurally enabled (§5), and one is
**improved but not solved** (§3 — the post-start race is real and reproducible). That is enough to justify the
plugin work in §7, provided the §8.2 mitigation is designed in from the start rather than discovered in production.
