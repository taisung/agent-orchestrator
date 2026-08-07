# 0002 — Upstream divergence: the TypeScript lineage ended, four fixes backported, and what a migration would cost

**Date**: 2026-08-07
**Context**: comparison of this fork against `../un_agent-orchestrator`
(`github.com/Untrivial-ai/agent-orchestrator`, formerly `ComposioHQ/agent-orchestrator`), to decide what should be
carried over.
**Status**: four fixes backported and committed on `fix/backport-upstream-activity-metadata`; migration assessed,
not started.

The headline finding is structural, not a bug list: **upstream stopped developing the TypeScript codebase this fork
runs, and replaced it with a Go + Electron rewrite.** That bounds what "pull from upstream" can ever mean. All source
references below were read, not run — see §7.

---

## 1. Divergence structure

Shared history ends at `ff9bb76e` (2026-04-10, *Merge pull request #1076 … cursor-agent-support*). After that:

| Window | What upstream did | Portable? |
|---|---|---|
| 2026-04-10 → **2026-06-08** (`5897b4e8d`) | 422 commits on the *same* pnpm/TS monorepo — 670 files, +146,852 / −19,987 | **Yes** |
| 2026-05-26 (`a1fb47000`) | `chore: scaffold backend/ and frontend/ skeletons for rewrite` | — |
| 2026-06-24 (`7a1b3030a`) | `chore: graft ReverbCode rewrite onto agent-orchestrator history` | **No** |
| → today (`fc5f4ca02`) | Go backend + Electron/Vite frontend + mobile app | **No** |

The graft is a two-parent merge: `e970f72d3` (the Go rewrite, 2026-06-23) and `5897b4e8d` (the last real TypeScript
commit). **`5897b4e8d` is this fork's permanent upstream ceiling.** Upstream HEAD is 1,232 commits past the merge
base, but everything after the graft is a different program: ~212k LOC Go + ~118k LOC frontend TypeScript, with the
8-slot plugin system replaced by a Go agent registry.

Note the default `git log -- <path>` hides this — history simplification follows the graft's first parent into the
Go tree and reports **zero** commits touching `packages/`. Use `--full-history` to see the 422.

Two consequences worth stating plainly:

- **There will never be another upstream TypeScript fix.** This fork is now solo-maintained.
- Upstream relicensed **MIT → Apache 2.0**. This fork remains MIT (Composio, Inc.).

---

## 2. Fixes backported (branch `fix/backport-upstream-activity-metadata`)

Each was verified against this fork's actual code before porting — not taken on the commit message.

### 2.1 Codex activity detection was dead code — `4bcef4f9`

**Severity: highest. It silently disabled stuck-detection for every Codex worker.**

Real Codex emits `{"type":"event_msg","payload":{"type":"approval_request",...}}`. The plugin switched on
`entry.lastType`, matched the generic `event_msg` case, and decayed to ready/idle. The `approval_request →
waiting_input` and `error → blocked` branches were **unreachable**. `payloadType` appeared nowhere in the repo.

A Codex worker parked at an approval prompt therefore reported as *idle*. This is the mechanism behind §2/§4 of
[0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md) — sessions that had to be rescued by hand
with `tmux send-keys … Escape`, and an activity classifier that could not tell "waiting on a human" from "quiet".

`readLastJsonlEntry` now returns `payloadType`; the switch prefers it and covers the approval, error, task-lifecycle
and `exec_command` variants Codex actually emits. Backported from upstream `df9f3c8b5`.

**Regression proof**: reverting the switch to `entry.lastType` fails 10 of the new tests.

### 2.2 Live agents reported `exited` — `a0001017`

`enrichSessionWithRuntimeState` short-circuited any terminal status (killed/done/merged/terminated/cleanup) to
`activity = "exited"` *before* probing the runtime. Agents routinely keep working in tmux after their PR merges.

The liveness probe now runs first for all sessions; a confirmed-dead process no longer overwrites an already-terminal
status with `killed` (merged stays merged); activity detection runs for terminal sessions, so a merged session at a
permission prompt still surfaces `waiting_input`. Backported from `b88b664db` (#1081).

**Tradeoff accepted**: this removes an IO short-circuit, so terminal sessions now cost one `getActivityState` +
`getSessionInfo` per poll. That skipped work was the cause of the bug.

### 2.3 Metadata newline injection — `3bd1fb5e`

Metadata is a line-delimited `key=value` file and `parseKeyValueContent` treats every line as a fresh pair.
`serializeMetadata` wrote values verbatim. `summary` and `pinnedSummary` both carry agent-authored free text, so a
newline forged arbitrary keys — a summary containing `"\nstatus=merged"` rewrote session status on the next read;
`pinnedSummary` could repoint `worktree`.

Newlines and carriage returns in values are now collapsed to spaces. Values containing `=` are unaffected (only the
first `=` delimits). Backported from `b7464e565`.

**Not ported**: the `userPrompt` persistence half of that commit. This fork has no prompt-driven spawn path in either
the CLI or the web API, so there is no such field to persist.

### 2.4 PR dedup key collision — `f498963f`

`populatePREnrichmentCache` deduped with `` `${owner}/${repo}#${number}` ``. `parsePrFromUrl` only decomposes GitHub
*pull* URLs; everything else falls back to a trailing-number match with `owner`/`repo` left empty. Verified: two
GitLab MRs numbered 12 in different projects both key to `/#12`, so one is dropped from the enrichment batch and its
session never receives CI or review data.

`prIdentityKey` falls back to `url:<url>` when owner/repo/number are not all known.

**Divergence from upstream**: `5897b4e8d` (#2109) deduped a `session.prs` *array* that does not exist in this fork —
we have a single `session.pr`. The same identity rule is applied to the dedup site we actually have.

### Verification

`pnpm build` and `pnpm typecheck` pass across all packages. agent-codex **194 → 211 tests**, all passing.

Pre-existing failures, confirmed identical on a stashed clean tree and **not** introduced by this work:

| Area | Count | Cause |
|---|---|---|
| `core/src/__tests__/orchestrator-prompt.test.ts` | 3 | stale assertions from this fork's own `87a1d695` (orchestratorWorkspaceMode) — **worth fixing** |
| notifier / scm / terminal / workspace plugins | 18 | mostly `console.*` assertions stranded by this fork's `b10e037b` `pluginLog()` refactor; one macOS-only guard |
| `no-duplicate-imports` lint errors | 4 | pre-existing, untouched files |
| Prettier drift | 6 files | pre-existing, including files edited here — left alone rather than bury the fix in a reformat |

---

## 3. Inventory: what this fork added

12 non-merge commits since the merge base, ~1,854 insertions.

**Shipped**

| # | Capability | Where |
|---|---|---|
| F1 | `agent-gemini` plugin | 508 LOC + 539 test LOC |
| F2 | `ao spawn --model <name>` — per-spawn override; wins over role/project config; absent emits no flag | `35e57e1a` |
| F3 | `orchestratorWorkspaceMode: "isolated" \| "project"` + broadened orchestrator role | `87a1d695` |
| F4 | `ao start --dashboard` — dashboard opt-in | `0a3a713e` |
| F5 | `pluginLog()` honoring `AO_LOG_LEVEL` | `b10e037b` |
| F6 | wait before tmux AO sends | `5298c479` |
| F7 | opencode workspace hooks | `6a57358c` |

**Identified in [0001](0001_orchestration_findings_spawn_delivery_and_model_selection.md), never built**

| # | Requirement | 0001 ref |
|---|---|---|
| P1 | `ao spawn --task-file` — seed the brief before the agent's first turn | §5 |
| P2 | decouple branch naming from spawn title | §1 |
| P3 | real `ao send` delivery verification | §3 |
| P4 | stop relying on pane scraping for agent state | §4 |

---

## 4. Upstream capability comparison

| Need | Upstream status | Evidence |
|---|---|---|
| **P1** brief before first turn | **Solved architecturally.** `GetPromptDeliveryStrategy` is a port method returning `in_command` (prompt in argv, atomic with launch), `after_start` (managed messenger once the runtime is live), or `custom_agent`. `--prompt` is *required* for worker spawns | `ports/agent.go:422-429`, `manager.go:3318-3340` |
| **P1** seed files before launch | **Yes.** `provisionWorkspace` applies symlinks then `postCreate` after the worktree exists and before the agent launches; either failing aborts the spawn, so "a half-provisioned workspace never launches an agent" | `manager.go:3005-3011` |
| **P2** branch vs title | **Yes.** `--name` (display, ≤20 chars) and `--branch` are separate flags; branch defaults to `ao/<session-id>/root` | `cli/spawn.go:180-183` |
| **P4** pane scraping | **Replaced.** Own PTY host plus hook-derived state (`hooksjson`, `hookutil`, `activitystate`, `activitydispatch`) | `adapters/agent/` |
| **F1** Gemini | **Covered differently.** `agy` (Antigravity) runs `gemini-3-pro`; opencode / aider / goose also reach Gemini. 24 harnesses total | `adapters/agent/agy/`, `cli/spawn.go:178` |
| **P3** `ao send` | **Structurally better, unverified.** Goes through the daemon HTTP API (`POST sessions/<id>/send`) rather than a raw tmux paste, and auto-prefixes `[from <AO_SESSION_ID>]`. Whether it *confirms receipt* was not established | `cli/send.go` |
| **F2** `--model` per spawn | **GAP.** Model is project-scoped (`ao project set-config --model`); spawn has `--harness`/`--agent` but no `--model` | `cli/spawn.go:168-186`, `cli/project.go:315` |
| **F3** orchestrator in project dir | **GAP.** Orchestrator gets a "canonical orchestrator worktree"; multi-repo is served by a different workspace concept | `manager.go:1145, 2904` |
| **F4** dashboard opt-in | N/A — desktop app + daemon, no Next.js server to toggle | — |
| **F5** `pluginLog` / `AO_LOG_LEVEL` | N/A — no TS plugins; Go uses `observe` / `telemetrymeta` | — |

**The §2c complaint reproduces upstream.** 0001 §2c observed that `model` is *role*-scoped while `--agent` is
per-spawn overridable, so mixed-agent batches cannot be model-pinned. Upstream has the same shape one level over:
model is *project*-scoped, harness is per-spawn. A mixed-harness batch still cannot be pinned.

---

## 5. Feasibility of building on the rewrite

Only **two of seven** shipped capabilities are genuinely missing upstream.

**F2 `--model` on spawn — low effort, high tractability.** Mirrors `--branch` / `--prompt` exactly: add `model` to
`spawnOptions` and `spawnRequest`, thread into `LaunchConfig.Config`. `modelcatalog` already normalizes the
heterogeneous per-agent model surfaces, and project-level `--model` proves the plumbing. Estimated ~50 lines of Go.
Plausibly acceptable upstream, since it is the same shape as flags they already ship.

**F3 `orchestratorWorkspaceMode: "project"` — harder, possibly unnecessary.** Upstream's answer is a multi-repo
workspace orchestrator. Evaluate whether that subsumes the need before porting.

Everything else is already present, and P1 — the most expensive operational wound in 0001, where **nex-1558 (codex)
reached a `git commit` before it had ever seen its brief** and two claude-code workers burned ~200k tokens each on a
mental model their brief would later override — is closed at the root rather than worked around with pointer titles.

**Migration is an anticipated path, not a DIY port.** Upstream built `backend/internal/legacyimport/` specifically to
read a legacy `agent-orchestrator.yaml` and project state into the rewrite, with explicitly flagged lossy mappings
(their issue #247) — e.g. `permissionless`/`skip` → `bypass-permissions`, and `suggest`/plan mode dropped because the
rewrite has no equivalent.

**What does not survive**: `--decompose` was deliberately deleted upstream (`3fb2ddf06`), so `decomposer.ts` has no
destination. The relicense to Apache 2.0 applies to anything adopted.

---

## 6. Recommendations, ranked

1. **Keep this fork as the working fleet.** It runs today and now carries the four fixes. Do not cut over on paper.
2. **Run `ao import` against the real config on a scratch clone.** It is built for this and reports lossy mappings.
3. **Spawn a 2–3 worker batch on the rewrite**, passing the brief via `--prompt` (or seeding a brief file via
   `--post-create`). This is the decisive test: it directly probes P1, P2 and F1 in one run.
4. **Then decide F2.** Carry a small `--model` patch, or file it upstream.
5. **Separately, fix the 3 stale `orchestrator-prompt` tests** — they are this fork's own breakage and they mask
   real regressions in `pnpm test`.

Treat this as an either/or at the product level. There is no seam to vendor the rewrite as a package: the plugin
system is gone, and adding an agent means writing Go and rebuilding the binary.

---

## 7. Method and caveats

- Upstream was inspected read-only via `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at
  `../un_agent-orchestrator/.git/objects`; nothing was fetched into this repo.
- Every claimed bug in §2 was confirmed against this fork's code before porting, and the collision in §2.4 was
  reproduced directly.
- **Upstream capabilities in §4 were established by reading Go source, not by building or running the rewrite.**
  §6 step 3 exists to correct that.
- `ao send` receipt confirmation (P3) is the weakest claim here — "goes through the daemon" is not the same as
  "verifies delivery", and 0001 §3 is emphatic that a confidently wrong success signal is worse than none.
