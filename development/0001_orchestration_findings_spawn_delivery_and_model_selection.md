# 0001 — `ao` findings from a 9-worker production run: spawn delivery, model selection, and delivery verification

**Date**: 2026-07-11
**Context**: a real Nexus (CUDA MD engine) cleanup + bug-fix campaign driven entirely through `ao` —
nine worker sessions (nex-1556 … nex-1570) across all three agent types (claude-code, codex, opencode).
**Status**: three defects characterized; one feature (`ao spawn --model`) in flight on `feat/spawn-model-flag`.

This document records what was learned about **`ao` itself**. The orchestration-side protocol changes it motivated
live in the skills repo (`agent-skills/development/0008_ao_spawn_brief_delivery_race.md`).

---

## 1. `ao` derives the git branch name from the spawn title → identical titles hard-fail

**Severity: breaks any multi-worker batch that reuses a title.**

The spawn title is used to synthesize the branch name. Two spawns with the same title produce the same branch, and
the second one dies:

```
✖ Failed to create or initialize session
✗ Failed to checkout branch "feat/read-agent-task-md-in-your-worktree-and-execute-it-if-agent" in worktree:
fatal: 'feat/read-agent-task-md-in-your-worktree-and-execute-it-if-agent' is already used by
       worktree at '/home/taisung/.worktrees/Nexus/nex-1562'
```

This surfaced while adopting a **constant "pointer title"** across workers (a title whose only content is *"read
your brief file; if it isn't there yet, wait"*). The pattern is otherwise ideal — it's the fix for the
brief-delivery race in §4 — but a constant title is precisely what `ao` cannot tolerate.

**Workaround adopted**: prefix each pointer title with a unique per-worker slug (`nb-cleanup:`, `mdrunner-fix:`,
`npt-race:` …), which becomes a readable branch name.

**Suggested `ao` change**: decouple branch naming from the title, or de-duplicate automatically (append the session
id when the derived branch already exists). The title is a *task* signal; the branch name is an *identity* signal.
Conflating them means a task-neutral title is impossible.

---

## 2. Model selection is effectively broken: `/model` over `ao send` is interactive

**Severity: silently runs workers on the wrong model.**

Verified 2026-07-11 on both eager agents:

| Agent | What `ao send "/model <name>"` actually does |
|---|---|
| **claude-code** | Opens a **confirmation dialog** — `❯ 1. Yes, switch to Opus 4.8 / 2. No, go back`. The model does **NOT** change until someone answers. The session is left sitting in a modal. |
| **codex** | The inline arg is **ignored** — after `/model gpt-5.6-luna`, the picker still showed `gpt-5.6-sol (current)`. A bare `/model` opens an interactive numbered picker. Codex additionally **queues** slash commands behind the current turn (*"Messages to be submitted after next tool call"*), which claude-code does not. |

Both sessions had to be rescued with `tmux send-keys … Escape`. Worse: a modal swallows the *next* `ao send`, so a
`/model` send can silently eat the message that follows it.

**A `/model sonnet` send that appears to work is usually a no-op** — the worker was *already* Sonnet. This produced
a false "I downshifted two workers to Sonnet" claim during the run; nothing had actually been sent successfully.

### 2b. With no `model` in config, `ao` emits no `--model` — workers inherit the user's *global* CLI default

`agent-orchestrator.yaml` pinned `agent:` but not `model:`. With no model configured, `ao` passes **no `--model`
flag at all**, so each worker silently picks up whatever `~/.claude/settings.json` / `~/.codex/config.toml` says
**at spawn time**. The user changed their own claude-code default mid-session, and the workers followed: two
claude-code workers spawned minutes apart in the same session came up as **Opus 4.8** (nex-1560) and **Sonnet 5**
(nex-1566), with nothing sent to either.

**If the model is not pinned, you do not know what you are running.**

### 2c. The mechanism already exists — the CLI just can't reach it

`model` is a first-class config field (`AgentSpecificConfigSchema` / `RoleAgentSpecificConfigSchema`,
`packages/core/src/config.ts`), and **every agent plugin already emits it at launch**:

| Plugin | Source | Emits |
|---|---|---|
| `agent-claude-code` | `src/index.ts:662` | `--model <model>` |
| `agent-codex` | `src/index.ts:306` (`appendModelFlags`) | `--model <model>` + `-c model_reasoning_effort=…` |
| `agent-opencode` | `src/index.ts:246` | `--model <model>` |

Codex's own picker confirms launch-time is the supported path: *"Access legacy models by running
`codex -m <model_name>` or in your config.toml."*

The gap: **`model` is ROLE-scoped, but `--agent` is per-spawn overridable.** `worker.agentConfig.model` applies to
whatever agent the worker role launches — so pinning a codex model (`gpt-5.6-terra`) and then spawning
`--agent claude-code` hands claude-code an invalid `--model gpt-5.6-terra`. **Mixed-agent batches therefore cannot
be model-pinned at all today.**

### → Feature implemented: `ao spawn --model <name>`

In flight on branch **`feat/spawn-model-flag`**. It parallels the existing `--agent` exactly:

- `packages/cli/src/commands/spawn.ts` — `:168` already has `.option("--agent <name>", …)`; add
  `.option("--model <name>", …)` and thread `opts.model` through `spawnSession(...)` into
  `sm.spawn({ projectId, issueId, agent })`.
- `packages/core/src/session-manager.ts` — accept `model` in the spawn options and merge it into the session's
  `agentConfig` so the plugin's launch-command builder sees `config.model`.

**Required semantics** (the backwards-compat property that matters):
- explicit `--model` **wins** over role/project config;
- absent `--model`, fall back to config;
- absent both, **emit no `--model` flag at all** — do *not* invent a default, which would silently change the
  behavior of every existing spawn.

`AO_CONFIG_PATH` (`packages/core/src/config.ts:637`) is the zero-code-change fallback — alternate config files
selected per spawn — at the cost of a duplicated project config.

---

## 3. `ao send`'s status line is unreliable in BOTH directions

It reports what the tmux paste did, **not** what the agent received:

- `"Message sent and processing"` — for messages that were **silently dropped**.
- `"Message sent — could not confirm it was received"` — for a message that was **received and correctly
  executed**.

Consequence: **the status line cannot be used as a delivery signal.** The only trustworthy channel is a durable
one — the worker writing a sentinel file (`<worktree>/.agent_report.md`) that the orchestrator polls.

**Related**: a *blocking* `ao send` (without `--no-wait`) against a busy worker **hangs for the full timeout**
(observed: the entire 2-minute default) even while `ao status` reported the session `ready`. Worker-directed sends
should default to `--no-wait`.

**Suggested `ao` change**: make delivery verification real (e.g. confirm the agent's input box drained / a new turn
started), or stop asserting success in the status string. A confidently wrong success message is worse than none.

---

## 4. `ao status` misreports long-running turns, and the pane cannot be used to verify

Two related observability gaps:

- **`ao status` reported `exited`** for a session that was very much alive (121k tokens, mid-turn, actively
  running tools). It also reports `stuck` for sessions that are simply idle. Long turns at high reasoning effort
  (16+ minutes observed) confuse the activity classifier.
- **`tmux capture-pane` cannot see a claude-code worker's history at all.** These agents paint a full-screen TUI on
  tmux's *alternate screen*, so `capture-pane -p -S -2000` returns only the **~28 visible lines**. Any grep over
  "scrollback" therefore **always returns 0**. During this run that produced a confident, wrong, user-facing
  conclusion that "the briefs were never delivered" — they had been.

**Implication for `ao` itself**: any feature that tries to verify agent state by scraping the pane is
fundamentally unreliable for claude-code. Verification must come from durable artifacts (files, git, metadata).

---

## 5. The spawn-time brief-delivery race (drove the pointer-title protocol)

`ao spawn` synthesizes a system prompt containing `## Task: Work on issue: <title>`. **claude-code and codex begin
working on that title at t=0** — before the orchestrator can write the real brief. And a message sent to a
*mid-turn* agent is **queued, not injected**: if that first title-driven turn runs long (16+ min at xhigh effort),
the brief is not seen for the entire duration.

Observed damage in this run: **nex-1558 (codex) reached a `git commit` before it had ever seen its brief** — i.e.
without its scope boundaries, do-not-touch list, or acceptance gates. Two claude-code workers each burned ~200k
tokens exploring on a mental model their brief would later override.

**Measured agent behavior (all three types, this run):**

| Agent | Acts on the spawn title? | With no brief present |
|---|---|---|
| **claude-code** | Yes — starts working immediately | With a pointer title: *"…I'll wait and do nothing until it appears"* — 13 s, 54k tokens, **0 files touched** |
| **codex** | Yes — actively probes (`test -f .agent_task.md`), and self-reports its wait state to the orchestrator unprompted | 24.6k in / 1.5k out, ctx 99% left, **0 files** |
| **opencode** | **No** — discards the spawn prompt entirely; sits at its splash screen | **0 files** |

This upgrades **codex from "presumed" to verified** — it engages on the title just like claude-code.

**The orchestration-side fix** (pointer title + brief-written-before-spawn) is documented in
`agent-skills/development/0008_ao_spawn_brief_delivery_race.md`. It works, but it is a *workaround*.

**The right upstream fix is in `ao`**: let the caller seed the task file **before the agent's first turn**. Today
`ao spawn` creates the worktree *and* launches the agent in one step, and assigns the session id itself, so the
brief cannot be placed at `<worktree>/.agent_task.md` beforehand. A `--task-file <path>` flag (copy this file into
the new worktree before launching the agent) would eliminate the race entirely and make the pointer title
unnecessary.

---

## Suggested `ao` changes, ranked

1. **`ao spawn --model <name>`** — in flight (`feat/spawn-model-flag`). Without it, mixed-agent batches cannot pin
   models at all, and the only alternative (`/model` over `ao send`) is interactive and jams the session.
2. **`ao spawn --task-file <path>`** — seed the brief into the worktree before the agent's first turn. Removes the
   spawn-delivery race at the root (§5) instead of working around it.
3. **Decouple branch naming from the spawn title** (or auto-deduplicate) — §1. A task-neutral title is currently
   impossible.
4. **Fix or remove `ao send`'s success assertion** — §3. It is wrong in both directions today.
5. **Don't rely on pane scraping for agent state** — §4. It cannot work for alt-screen TUI agents.

## Operational note for anyone rebuilding `ao` mid-flight

`ao` runs from the built `packages/cli/dist/index.js`. **Running `npm run build` while sessions are live swaps the
CLI binary underneath the running orchestration** — a broken build would cost you the ability to manage in-flight
workers. Source edits are harmless (the running CLI is already built); only the build is dangerous. `npm run
typecheck` (`tsc --noEmit`), `npm run test` (vitest) and `npm run lint` all validate **without emitting**, so
development can proceed safely while workers run — defer only the build to a quiet fleet.
