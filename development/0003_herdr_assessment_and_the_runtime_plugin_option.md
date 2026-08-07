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

---

## 5. How this changes the migration calculus

0002 framed the decision as fork-versus-rewrite. There are three options:

1. **Stay on the fork, swap the runtime.** ~300 LOC. Fixes §1/§3/§4/§5. Keeps patch-level control, stays
   TypeScript, no relicense, no Go. Adds a fast-moving external dependency.
2. **Migrate to the upstream Go rewrite** (0002 §5–6). Same defects fixed, plus 24 harnesses and active
   maintenance — but patch-level control drops and `--model` on spawn is missing.
3. **Stay as-is.** Every future fix is ours alone; the upstream TypeScript lineage ended at `5897b4e8d`.

Option 1 did not exist in 0002's analysis and is now the cheapest path to the pain we have actually measured. It
also **de-risks option 2**: if a Herdr runtime resolves §1/§3/§4/§5, the urgency behind migrating drops sharply and
the rewrite can be evaluated on its merits rather than under operational pressure.

Options 1 and 2 are not mutually exclusive in the long run, but they compete for the same effort now. Option 1
should be tried first because it is smaller, reversible (the runtime is a plugin slot — swap back by config), and
does not commit us to anyone else's roadmap.

---

## 6. Method and caveats

- **License verified directly.** `raw.githubusercontent.com/ogulcancelik/herdr/master/LICENSE` is the Apache
  License 2.0 verbatim. Several third-party write-ups claim AGPL-3.0-or-later with a commercial option; **they are
  wrong**, but re-check before adopting, since projects do relicense.
- Herdr is young and moving fast. `worktree create` has open correctness bugs
  ([issue #729](https://github.com/ogulcancelik/herdr/issues/729): fails when the branch already exists locally).
  Taking it as our runtime means depending on a fast-moving project at a layer where failure is total.
- **Nothing here was run.** This is from the site, the CLI reference, the repo, and the LICENSE file. The `Runtime`
  mapping in §4 is a reading of both interfaces, not a working plugin. Star count and agent lists are as published
  and will drift.
- Windows support is beta; irrelevant to us today but relevant if the fleet ever moves.

---

## 7. Recommended next step

Prototype `packages/plugins/runtime-herdr` using `runtime-tmux` as the template, and run one 2–3 worker batch
against it. That single run tests the §3 and §4 claims — the two that cost us a wrong user-facing conclusion during
the 9-worker run — at a cost of roughly a day. If `agent prompt --wait` and `pane read --source recent-unwrapped`
behave as documented, option 1 is settled and the migration question in 0002 can be deferred on our own schedule.
