# 0008 — Model routing for `ao` workers: tiered assignment, the 2026-09-16 model comparison, and the single-source routing tables

**Date**: 2026-09-16
**Context**: the Nexus orchestrator (`nex-orchestrator`, Claude Fable 5.1) spent 2026-09-15/16 on which model an
`ao spawn` should launch for which task, after the owner set the tiered assignment (Astra / Fable 5.1 at the top),
configured OpenCode for Meta Muse Spark 1.3, and forwarded an orchestration-architecture proposal.
**Status**: landed in the skills repo (`~/agent-skills` `292328e`, `64e55bd`, local, not pushed) and in Nexus
(`development/1740_…`, `development/1741_…`, `development/artifacts/model_router_log/log.csv`). Nothing in `ao`
itself changed; §7 lists what `ao` could take from this.

This document is the summary for the `ao` repository. The full evidence lives in the Nexus docs named below.

---

## 1. What was done, in order

| When (EDT) | What | Where |
|---|---|---|
| 2026-09-15 | Probed every backend this host can launch (`claude -p --model`, `codex exec --model`, `opencode run -m`). Result in §2. | Nexus `TODO_TRACKING.md` item 1; memory `reference_model_backend_probe_2026_09_15` |
| 2026-09-15 | Owner ruled the tiers: Tier A `gpt-6-astra` (default) / `claude-fable-5-1[1m]` (Claude lens); Tier B `gpt-5.6-sol` / Opus 5; Tier C `gpt-5.6-terra`, Sonnet 5, `opencode-go/muse-spark-1.3-contributor` (OpenCode default) with `opencode-go/deepseek-v4-flash` as fallback. Reviewer = other model family, same tier or higher. | ao-spawn skill §Model heuristic |
| 2026-09-15 | Fable 5.1 headless MD-worker test (nex-2081): no refusal or classifier fallback across two rounds. Cost: shared claude.ai 5-hour meter 74 % → 94 % in ~25 min, $10.31 in 23 min with 0 lines written. | Nexus TODO item 6 |
| 2026-09-16 09:3x–09:5x | Seven-model comparison on one Artificial Analysis Intelligence Index v4.3 snapshot (§3). Muse Spark 1.3 xhigh placed Tier C. | Nexus `1740_agent_model_comparison_and_tier_assignment_2026_09_16.md` (`8b9a649d4`) |
| 2026-09-16 | Owner-forwarded architecture proposal assessed: roles, task taxonomy (domain × difficulty × risk), routing table, escalation, test hierarchy T0–T7 (+T-HBO, +T-REV), physics invariants as tests, task contract, empirical router. Five departures with evidence (§4). | Nexus `1741_orchestration_architecture_roles_taxonomy_verification_hierarchy.md` (`ab20865a6`), status PROPOSED |
| 2026-09-16 | ao-spawn skill gained "Routing by domain × difficulty × risk" (risk classes, table, six rules). Router log created and seeded with eleven sessions. | `~/agent-skills` `292328e`; Nexus `7c54ca864` |
| 2026-09-16 | Owner: "add a routing table/tables into the ao skill repo so that we can update the routing consistently/reliably … and commit them." → single-source YAML + renderer (§5). | `~/agent-skills` `64e55bd` (5 files, +938 / −69); Nexus `601e6babf` |

## 2. Backends on this host (probe 2026-09-15; opencode re-probed 2026-09-16 09:52:37)

| `ao spawn --agent` | `--model` | Serves | State |
|---|---|---|---|
| codex | `gpt-6-astra` (exact; `gpt-6.0-astra`, `gpt-6.0`, `gpt-6` are rejected on a ChatGPT account) | GPT-6 Astra | live |
| codex | `gpt-5.6-sol`, `gpt-5.6-terra` | GPT-5.6 Sol / Terra | live; `gpt-5.6-luna` not probed |
| claude-code | `'claude-fable-5-1[1m]'` (alias `fable`), `opus`, `sonnet` | Fable 5.1 / Opus 5 / Sonnet 5 | live; a claude-code spawn with NO `--model` inherits the global default (Fable 5.1) |
| opencode | `opencode-go/deepseek-v4-flash` | DeepSeek V4 Flash | live |
| opencode | `opencode-go/muse-spark-1.3-contributor` | Muse Spark 1.3 (xhigh, Contributor terms) | **gated**: "requires explicit opt in: https://opencode.ai/workspace/wrk_…/go" from both the config default and `-m … --variant xhigh`. The opt-in is a workspace setting on the OpenCode site; the config file cannot grant it. |
| opencode | Zen `opencode/*` (135 listed) | — | dead: "Insufficient balance" |
| gemini | any | — | dead: `~/bin/gemini` is a shim through a local proxy on `:4000` with nothing listening |
| codex profile `github` | `gpt-5.4` | — | dead: same proxy |

Two `ao`-relevant facts from the plugins: `agent-codex` emits `--model` plus `-c model_reasoning_effort=…`;
`agent-opencode` emits only `--model`, never a variant, so Muse's xhigh effort rests on
`~/.config/opencode/opencode.json` `provider.opencode-go.models.….options.reasoningEffort` and is UNVERIFIED
until the gate opens.

## 3. The numbers (AA Intelligence Index v4.3; Coding Agent Index snapshot 2026-09-15; read 2026-09-16)

| Model (variant) | Index (rank/199) | CAI (harness) | TB 4.0 | $ per index task | tok/s | Tier |
|---|---|---|---|---|---|---|
| Claude Fable 5.1 | 53 (#1) | 62.2 (Claude Code) | 55.1 | 7.63 | 65 | A (orchestrator + Claude lens) |
| GPT-6 Astra | 53 (#3) | 61.6 (Codex) | 59.6 | 3.26 | 53 | A (default worker) |
| Claude Opus 5 (xhigh) | 50 (#10) | 59.7 (Claude Code) | 51.8 | 4.88 | 49 | B (Claude lens) |
| Muse Spark 1.3 (max) — partner preview, not on this host | 48 (#13) | 54.3 (Muse Code) | — | 1.60 | 226 | — |
| GPT-5.6 Sol | 47 (#14) | 54.6 (Codex) | 37.3 | 1.99 | 65 | B (default) |
| Muse Spark 1.3 (xhigh) — what OpenCode Go serves | 45 (#18) | 48.3 (Muse Code) | — | 1.37 | 220 | C (gated) |
| GPT-5.6 Terra | 42 (#27) | not listed | — | 1.40 | 99 | C (default) |
| Claude Sonnet 5 (xhigh) | 35 (#48) | not listed | — | 2.87 | 62 | C (lens only) |
| DeepSeek V4 Flash | — | 38.7 (Codex) | — | — | — | C (fallback lens) |

Astra's cost advantage over Fable at the same list price is verbosity (60 M vs 190 M output tokens on the
index). AA's 2026-09-02 Muse article uses an older index scale (66 / 63 / 61 / 61) — never mix the two.
The ao-spawn hand table had already drifted: it quoted the max-variant 48 / 54 for the xhigh model OpenCode
serves. The single-source refresh (§5) corrected it to 45 / 48.3.

## 4. The routing policy (Nexus 1741 §2–§4, §8)

Every brief states domain, difficulty (L0 mechanical / L1 non-trivial / L2 expert), risk, and verification level.
**Risk is defined by the project's invariants, not intuition, and is independent of difficulty**: risk decides the
verification level and the review requirement; difficulty decides the model tier.

| Risk | Definition (Nexus) | First pass | Verification |
|---|---|---|---|
| CRITICAL | captured graph slot, per-step host↔device traffic on a force path (HBOv2), MINT/FixedPoint, integrator, thermostat/barostat, neighbor list, PME, any energy/virial path an MC decision consumes | Tier B minimum, brief carries the map | T0–T5 + T-HBO + T-REV, T6/T7 when applicable |
| HIGH | force/energy kernels, plugin registration, build system, CI gates, known-red list, bit-id baseline | cheapest capable | T0–T5 + T-HBO + T-REV |
| MEDIUM | tests, tooling, receipts scripts, skills | cheapest capable | T0–T2 + T5 + T-REV |
| LOW | documentation with no normative claim | cheapest capable | T0 (+T1 if code) |

Ten domain rows × three difficulty columns name the starting tier and the models in preference order (full table:
`skills/ao-spawn/routing/routing.yaml`). Six rules override the table:

1. **R1** Cheap-first is the escalation default ONLY for non-CRITICAL work; CRITICAL starts at Tier B with the
   derived map (a cheap first pass on the captured path is the half-fix trap — it passes value gates and fails one
   round later). Escalation goes up a tier and adds a cross-family lens, never down.
2. **R2** Sol is Tier B, not the physics authority (47 vs 53/53; no task data shows it ahead).
3. **R3** Fable 5.1 is the orchestrator and a Tier A lens, not an L2 implementer (shared 5-hour meter; Astra ties it
   at less than half the cost).
4. **R4** Sonnet 5 is lens-only (weakest on the index; out-reviewed by V4 Flash on a real review).
5. **R5** Every Muse cell is conditional on the OpenCode workspace opt-in; probe first, fall back to V4 Flash.
6. **R6** Log every session to `development/artifacts/model_router_log/log.csv`; after ~50 rows, replace cells with
   measured first-pass rates.

Reviewer rule: a different model family from the author, same tier or higher; V4 Flash (Muse when open) as the
second lens for panels. Capability rank did not predict review quality (Opus 5 said LAND-SAFE where codex Sol said
NOT-LAND-SAFE, and codex was right) — buy independence, then reconcile against the source.

## 5. The single-source mechanism (`~/agent-skills` `64e55bd`)

| File | Role |
|---|---|
| `skills/ao-spawn/routing/models.yaml` | registry: one row per model — backend, exact `model_string`, `pin` (the `ao spawn` flags), family, tier, effort, quota, `status` (live / gated / dead / unprobed), probe date + result, AA `numbers` with file-level `as_of_numbers`, roles, notes; plus the `dead:` backends |
| `skills/ao-spawn/routing/routing.yaml` | policy: tier defaults + lenses, the four risk classes (definition, first-pass floor, review, T-levels), the domain × difficulty cells (model ids in preference order, `not:` exclusions), rules R1–R6, the reviewer rule |
| `scripts/routing.py` | `render` writes the SKILL.md blocks between `<!-- models:begin/end -->` and `<!-- routing:begin/end -->`; `check` exits 1 on SKILL.md drift, 2 on an inconsistent registry (unknown id, tier mismatch, missing cell); `route --domain <id> --difficulty L0\|L1\|L2 --risk <RISK> [--author <id>]`; `models`; `domains` |
| `skills/ao-spawn/routing/README.md` | the update procedure and the re-probe rule |
| `skills/ao-spawn/SKILL.md` | the generated tables (136 lines changed); prose around them stays hand-written |

Can-go-red, both exercised on 2026-09-16: a one-token edit inside the rendered table → `check` exit 1 with a
diff; `astra` → `astro` in one cell → exit 2 `unknown model id 'astro'`. Both restored; `check` prints OK.

What `route` prints for `--domain cuda-captured --difficulty L0 --risk CRITICAL`: the cell (Tier B, sol, brief
carries the map), the author pin (`ao spawn --agent codex --model gpt-5.6-sol "<unique-tag>: Read
.agent_task.md …"`), the reviewer set (family ≠ openai, tier ≥ B, live: fable, opus), the second lens (v4flash;
muse flagged GATED with its fallback), the review requirement and the T-levels. With `--author fable` on a Python
L0 task it prints astra as the reviewer.

Update procedure: edit the YAML → `python3 scripts/routing.py render` → `check` prints OK → commit YAML and
SKILL.md together. Never edit the marker blocks by hand. Re-probe a model whose probe date is older than a week.
Refresh numbers a whole snapshot at a time and bump `as_of_numbers`.

## 6. The empirical router

`development/artifacts/model_router_log/log.csv` (Nexus, `7c54ca864`) — columns
`date,session,task_id,domain,difficulty,risk,role,model,effort,tier,context_used_pct,wall_min,cost_usd,rounds_to_land,B,N,verdict,landed,reds_introduced,stops_correct,notes`,
seeded with the eleven 2026-09-15/16 sessions (nex-2081 … nex-2087). Unknown fields stay empty, never estimated.
The 1741 §3 cells are priors; the log is what replaces them.

## 7. What `ao` itself could take from this (observations, not commitments)

- `ao spawn` could read `routing.yaml` + `models.yaml` (`--route <domain>/<difficulty>/<risk>`) and emit the pin,
  instead of the orchestrator copying the `route` output by hand.
- A spawn on a `gated` or `dead` registry entry could refuse at launch with the fallback named; today an opencode
  spawn on the Muse default dies at the first request.
- `agent-opencode` passes only `--model`; a `--variant`/effort passthrough would make the Muse xhigh effort
  verifiable from the spawn line.
- A spawn with no `--model` on claude-code silently inherits the global default; the registry's `pin` strings
  always carry the model for that reason.

## 8. Open items

- Owner decisions in Nexus 1741 §16 (five items), and whether the `needs_*` statuses + the task-contract header
  (1741 §11–§12) enter the skills after a blind review.
- OpenCode workspace opt-in for Muse Spark 1.3 Contributor (owner-only, on the OpenCode site).
- `~/agent-skills` `292328e` + `64e55bd` are local; push on request.
- The 1737 increment 0 worker (nex-2087, codex Astra) is the first session routed under this policy; its landing
  adds the first post-policy rows to the router log.
