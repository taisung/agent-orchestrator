# 0006 — Phase −1 inventory: actual AO usage, persisted dependencies, and release baseline

**Date**: 2026-08-11
**Context**: execution of `0005` Phase −1 before any package retirement or behavioral implementation.
**Status**: evidence collection complete. The 2026-08-11 operator directive to finish trimming the existing AO
authorized implementation of the `retire candidate` slice after this inventory. Conditional/unknown surfaces remain
unresolved and are listed in §8.

---

## 1. Purpose

Determine what this personal AO fork actually needs from evidence rather than from the absence or presence of topics
in operator skills. The inventory must answer:

1. Which capabilities are configured now?
2. Which agents, runtimes, workspaces, trackers, SCMs, terminals, notifiers, UI paths, and lifecycle features were
   actually used?
3. Which live or archived sessions still depend on a plugin for status, cleanup, inspection, or restore?
4. Which capabilities have explicit future value despite sparse historical use?
5. Which branch and commit are the canonical baseline for implementation?
6. Which Herdr version/protocol is installed, and what compatibility contract exists?

No source package will be removed during this phase.

---

## 2. Frozen evidence policy

This policy was written before inspecting AO configuration and session counts.

### 2.1 Lookback window

Use **2026-04-01 through 2026-08-11**, inclusive. This spans the documented production-use period that led to the
current fork changes while remaining short enough to describe current practice. Evidence before the window is
historical context, not recent-use evidence.

### 2.2 Evidence grades

| Grade                         | Evidence                                                                         | What it establishes                                                  |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **A — live**                  | Running process/runtime, existing worktree, active session metadata              | Current operational dependency                                       |
| **B — persisted**             | Live or archived AO metadata with explicit plugin/session fields                 | Recorded historical or restore dependency                            |
| **C — configured/documented** | Active YAML config, durable task/report, campaign note, commit with measured run | Intended or documented use; may need corroboration                   |
| **D — inferred**              | Package installed, registry entry, example config, skill omission, code presence | Discovery lead only; never sufficient for retention or removal alone |

Configuration proves intent/configuration, not that a capability ran. Package presence proves neither intent nor use.
Absence from a skill or log proves neither disuse nor safe removal.

### 2.3 Retention states and thresholds

Classify every capability into exactly one current state:

- **retain — active**: any Grade A dependency; removal is blocked.
- **retain — restore**: a session the operator expects to resume or manage still requires it.
- **retain — used**: at least one corroborated successful use inside the lookback window, unless the operator
  explicitly chooses a replacement.
- **replace**: used or intended, but an accepted retained capability covers the need; migration and acceptance tests
  are required before removal.
- **retire candidate**: zero Grade A dependencies, zero required restore dependencies, zero corroborated recent use,
  and no explicit future intent.
- **unknown**: evidence is missing, contradictory, or not attributable. Unknown is not a retire candidate.

There is deliberately no “rare use” deletion threshold. A personal tool may have important low-frequency paths.
One corroborated successful use is retention evidence; the operator must explicitly decide whether its value is
superseded.

### 2.4 Persisted-session policy for this inventory

For each session, distinguish:

- **live/manageable**: runtime or worktree exists, or metadata status is non-terminal;
- **restore candidate**: metadata plus runtime/agent restore identifiers and required artifacts exist;
- **archive-inspection only**: terminal session retained only for metadata/task/report/history inspection;
- **disposable history**: explicitly approved for removal after a separate cleanup decision.

Do not infer that an archived session must remain executable. Do not infer that it is disposable merely because it
is archived.

### 2.5 Removal gate

A plugin or command is eligible for Phase 5 retirement only when all are true:

1. its state is `retire candidate` or an approved `replace` migration is complete;
2. no live session references it;
3. no required-restorable session references it;
4. retained profiles build and operate without implicit fallback to it;
5. archive inspection remains possible without executing it, or archives have an approved migration;
6. a focused acceptance test covers the removed consumer path.

---

## 3. Data collection rules

- Inventory is read-only except for this development note.
- Never print secrets, webhook URLs, tokens, environment values, or full agent-authored summaries into this note.
- Report config paths, project identifiers, plugin names, statuses, dates, and aggregate counts only.
- Treat missing logs as `unknown`, not zero use.
- De-duplicate session metadata by project data root + session id.
- Separate live `sessions/` metadata from `sessions/archive/`; do not combine them into one count.
- Validate runtime liveness independently where safe; metadata status alone is not liveness.
- Record filesystem and parsing failures explicitly.
- Do not run cleanup, restore, spawn, send, or other state-changing AO commands during the inventory.

---

## 4. Planned evidence sources

1. AO YAML configs discoverable under the user's active project trees.
2. `~/.agent-orchestrator/*/sessions/` and `archive/` metadata.
3. Existing AO-managed worktrees and persisted runtime handles.
4. Live tmux and Herdr server/session listings, queried read-only.
5. Git history and `development/0001`–`0005` for measured campaigns and fork-specific additions.
6. The three AO operator skills for explicit workflow claims, not frequency estimates.
7. Current git refs and ancestry for canonical-baseline selection.
8. Installed Herdr version, protocol, and server health.

---

## 5. Inventory results

Snapshot time for live-process facts: **2026-08-11T12:48:40-04:00**. Counts derived from archives use the latest
archive file per project-root + session id, as required by §3.

### 5.1 Config and data-root discovery

Three real config origins were found among a heavily test-polluted AO data directory:

| Config                                                               | Role                           | Persisted state                                                 |
| -------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| `/Data1/NgFEP/Nexus/agent-orchestrator.yaml`                         | Active production Nexus config | 14 live metadata records; 1,960 unique archived session ids     |
| `/home/taisung/agent-skills/skillsets/nexus/agent-orchestrator.yaml` | Older skillset-local config    | One killed orchestrator record from 2026-03-30; no live runtime |
| `/home/taisung/agent-orchestrator.yaml`                              | Generated `my-project` config  | No sessions or archives                                         |

The `.origin` census contained 136 files: 87 pointed into `/tmp`, 46 pointed to explicit `/fake/...` test paths,
and only the three above mapped to real configs. `~/.agent-orchestrator` contained **1,180 project roots**, of which
**1,174** used synthetic test names such as `observability`, `main-repo`, `project`, or `test-app`.

The entire data tree occupies only 27 MB, so disk pressure is not the immediate risk. The risk is evidence pollution
and accidental cleanup of real data. Future tests must use an isolated temporary AO data root before any cleanup of
the existing synthetic roots is considered.

### 5.2 Active production configuration

The production Nexus config resolves to:

| Setting                | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Runtime                | `tmux`                                                                      |
| Default agent          | `claude-code`                                                               |
| Worker agent           | `codex`                                                                     |
| Workspace              | `worktree`                                                                  |
| Notifier               | `desktop`                                                                   |
| Orchestrator workspace | project workspace                                                           |
| Tracker / SCM          | not explicit; current config loading infers GitHub from `repo: NgFEP/Nexus` |

The config says workers should commit locally and should not open PRs or push unless explicitly instructed. This is
evidence that the current default workflow is local-first; it does not erase the historical GitHub use in §5.5.

The worker role combines `agent: codex` with `agentConfig.model: opus`. Development note 0001 established that a
role-scoped model can be handed to the wrong per-spawn agent. Current metadata does not persist the effective model,
so whether every live Codex worker received a valid `--model` override is unknown and should be checked separately.

### 5.3 Live production fleet

At the snapshot:

- 14 live metadata records existed: 13 workers plus `nex-orchestrator`;
- all 14 persisted handles named the tmux runtime;
- all 14 corresponding tmux sessions existed;
- 13 AO Nexus worker worktrees existed;
- agent split: **6 Claude Code, 6 Codex, 2 OpenCode**;
- metadata status split: 9 `working`, 3 `stuck`, and 2 `killed`;
- every supposedly `killed` session still had a live tmux session, confirming that metadata status is not liveness;
- no live session carried a PR field.

The production lifecycle worker was running from `/Data1/NgFEP/Nexus` with `AO_CONFIG_PATH` set to the production
config. Its log contained notification, `ci_failed`, and `pr_open` activity patterns. Pattern counts establish that
those paths executed; they do not prove that a desktop notification was visibly delivered.

Durable worker artifacts were inconsistent:

- 12 of 13 worker worktrees had `.agent_task.md`;
- 11 had `.agent_report.md`;
- only 6 reports began with the canonical `done|...` shape;
- 5 reports began with unrecognized free-form content.

This corroborates 0005's proposal to make task/report artifacts native and versioned rather than relying on prompt
discipline alone.

### 5.4 Production archive

The production archive contains 2,173 files representing **1,960 unique session ids**; 213 files are repeated
archives of an already-seen id. Only the latest record per id was counted.

Full unique archive by agent:

| Agent                      | Sessions |
| -------------------------- | -------: |
| Claude Code                |    1,113 |
| Codex                      |      517 |
| OpenCode                   |      246 |
| Gemini                     |       16 |
| Missing legacy agent field |       68 |

Inside the frozen lookback window, the archive contains **1,779 sessions**:

| Agent       | Archived sessions, 2026-04-01 through 2026-08-11 |
| ----------- | -----------------------------------------------: |
| Claude Code |                                            1,085 |
| Codex       |                                              476 |
| OpenCode    |                                              214 |
| Gemini      |                                                4 |

After combining the 1,779 recent archived ids with the 14 live ids and de-duplicating `nex-orchestrator`, the
lookback has **1,792 recorded session ids**. Gemini's recent sessions occurred in April and June, so the Gemini
plugin has corroborated recent use rather than merely code presence.

Runtime/workspace evidence:

- all 1,779 recent archives persisted `runtimeName: tmux`;
- across the full archive, 1,892 persisted tmux and 68 legacy records lacked a runtime field;
- no production archive persisted Herdr or process runtime handles;
- 1,891 archives had `.worktrees/...` workspace paths, one had a project/other path, and 68 lacked a path;
- excluding the one current orchestrator id that also appears in the archive, archived worktree paths no longer
  exist.

The archive contains metadata only: no canonical task/report artifacts were found. The historical sessions are
therefore inspection records, not fully restorable task contexts. Their status values (`working`, `stuck`, etc.)
cannot be interpreted as live state after their worktrees and runtimes are gone.

### 5.5 GitHub tracker/SCM/lifecycle evidence

Across the full de-duplicated production archive:

- 45 sessions persisted GitHub PR URLs;
- one PR record used another/unclassified form; none was identified as GitLab;
- 13 sessions archived with `ci_failed`, 15 with `merged`, and 3 with `pr_open`;
- 25 numeric issue identifiers were recorded.

Within the lookback:

- 14 GitHub PR records, 6 `ci_failed`, and 1 `pr_open` occurred;
- 24 numeric issue identifiers occurred;
- every recent PR/lifecycle record was in April; no PR record was found from May through August.

This establishes real GitHub SCM/lifecycle use and likely GitHub tracker use. It also shows a temporal shift toward
the current local-first rule. Under the frozen policy, GitHub remains `retain — used` unless the operator explicitly
declares that the April workflow has been superseded by local-only integration.

Development note 0003 independently says the PR/CI/lifecycle stack is “the actual reason we run `ao`,” while the
current config forbids routine worker PRs. Both statements are true evidence from different stages; current intent
must resolve them.

### 5.6 Herdr evidence

Herdr was live and locally compatible at the snapshot:

| Field      | Value                                          |
| ---------- | ---------------------------------------------- |
| Binary     | `/home/taisung/.local/bin/herdr`               |
| Version    | 0.8.0                                          |
| Protocol   | 19                                             |
| Server     | running; CLI reports compatible                |
| Workspaces | 2, both labelled Nexus, agent status `unknown` |

No production AO metadata persisted a Herdr runtime handle. However, development notes 0003 and 0004 record
measured single-worker, six-worker, and nine-worker campaigns, including 6/6 verified plugin delivery at the
nine-worker load where raw prompting delivered 0/3. This is corroborated recent use, so Herdr is `retain — used`.

No code or config currently enforces a supported Herdr version/protocol range beyond the live compatibility/status
probe. That compatibility contract remains a Phase 3 implementation requirement.

### 5.7 Dashboard, terminal, notifier, and distribution evidence

- No AO dashboard/terminal listener was active on ports 3000, 3001, 14800, or 14801 at the snapshot.
- No AO web/dashboard process was active.
- Available shell history was small and contained only one `ao status`; it contained no usable spawn/dashboard/PR
  history and is insufficient to establish non-use.
- `ao start --dashboard` was a deliberate fork-specific feature committed on 2026-05-15, but no successful runtime
  use was found. Dashboard retention remains `unknown`, not a retire decision.
- Desktop is referenced by the active production config and the live lifecycle worker executed notification paths.
  Desktop therefore remains retained until config migration or an explicit pull-only decision.
- No real config or session evidence referenced Slack, Discord, Webhook, Composio, or OpenClaw.
- No real config or session evidence referenced Linear, GitLab tracker/SCM, process runtime, clone workspace, Aider,
  or Cursor.
- Terminal-plugin usage is not persisted and no active web terminal was found. iTerm2/web-terminal retention remains
  coupled to the unresolved dashboard/open workflow decision.

### 5.8 Data-quality limitations

- Cleanup archives metadata but not task/report artifacts, so historical intent and completion evidence are lossy.
- Agent model is not persisted.
- Tracker and SCM plugin identities are inferred from config and are not stored per session.
- Archive status does not mean liveness or restorability.
- Shell history is incomplete.
- Test fixtures polluted the real AO data root, requiring `.origin` filtering before counting.
- The live fleet changed during collection; live counts are a timestamped snapshot, not a stable total.

---

## 6. Retention matrix

| Capability                          | Strongest evidence                                  | Phase −1 state       | Immediate disposition                                      |
| ----------------------------------- | --------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `core`, CLI, lifecycle supervisor   | Active fleet and lifecycle worker                   | **retain — active**  | Keep                                                       |
| Claude Code                         | 6 live; 1,085 recent archived                       | **retain — active**  | Keep                                                       |
| Codex                               | 6 live; 476 recent archived                         | **retain — active**  | Keep                                                       |
| OpenCode                            | 2 live; 214 recent archived                         | **retain — active**  | Keep                                                       |
| Gemini                              | 4 recent archived; 16 total                         | **retain — used**    | Keep unless explicitly replaced                            |
| Aider                               | No real config/session evidence                     | **retire candidate** | Drain/consumer tests before removal                        |
| Cursor                              | No real config/session evidence                     | **retire candidate** | Drain/consumer tests before removal                        |
| tmux runtime                        | 14 live; 1,779 recent archived                      | **retain — active**  | Keep                                                       |
| Herdr runtime                       | Live server + measured August campaigns             | **retain — used**    | Keep; add version gate                                     |
| process runtime                     | No persisted use                                    | **retire candidate** | Verify 68 legacy missing-runtime records do not require it |
| worktree workspace                  | 13 live; 1,891 archived paths                       | **retain — active**  | Keep                                                       |
| clone workspace                     | No persisted use                                    | **retire candidate** | Verify integration tests and archived policy               |
| GitHub SCM/lifecycle                | 14 recent GitHub PR records; recent CI states       | **retain — used**    | Keep pending explicit supersession decision                |
| GitHub tracker                      | Active implicit config; 24 recent numeric issues    | **retain — used**    | Keep pending explicit local-profile decision               |
| Linear tracker                      | No real evidence                                    | **retire candidate** | Consumer tests before removal                              |
| GitLab tracker/SCM                  | No real evidence                                    | **retire candidate** | Consumer tests before removal                              |
| Desktop notifier                    | Active production config and notification log paths | **retain — active**  | Keep pending notification-profile decision                 |
| Other notifiers                     | No real config/session evidence                     | **retire candidate** | Confirm no external config before removal                  |
| Dashboard/web package               | Deliberate May feature; no observed run             | **unknown**          | Operator decision; do not remove yet                       |
| iTerm2/web terminal plugins         | No persisted evidence; coupled to dashboard/open    | **unknown**          | Resolve attach/dashboard workflow                          |
| Plugin marketplace/setup/update     | Code presence only                                  | **retire candidate** | Verify no explicit operator intent                         |
| Integration tests/plugin interfaces | Required to prove safe reduction                    | **retain — active**  | Keep through trim; simplify later                          |

No package deletion is authorized by this matrix yet. `Retire candidate` means eligible for Phase 1 dependency and
compatibility testing, not safe to delete immediately.

---

## 7. Baseline decision

Repository state at inventory time:

| Ref                                                      | Commit         | Relation                                         |
| -------------------------------------------------------- | -------------- | ------------------------------------------------ |
| Current branch `fix/backport-upstream-activity-metadata` | `cf081e164156` | Candidate implementation baseline; includes 0005 |
| Local `main`                                             | `7441e1f899d3` | 18 commits behind current HEAD                   |
| `fork/main`                                              | `7441e1f899d3` | Equal to local `main`                            |
| `fork/fix/backport-upstream-activity-metadata`           | `ed3bb9f6a307` | One commit behind current HEAD                   |

There is no `origin` remote; the configured remote is named `fork`. No fetch was performed during this read-only
inventory, so remote-ref claims are limited to the locally stored refs.

The 18 commits after `main` contain the activity/metadata/PR fixes, Herdr runtime and dispatch work, Herdr delivery
verification and campaigns, runtime preflight/doctor improvements, and the personal-fork plan. Implementing from
`main` would discard the exact work being retained.

**Recommended baseline**: after 0006 is finalized, use the resulting tip of
`fix/backport-upstream-activity-metadata` as the canonical release-base candidate, then fast-forward `main` to that
commit in a separately authorized integration step. Do not begin Phase 0 source work on `7441e1f899d3`.

The globally installed `ao` command resolves to this checkout's `packages/cli/dist/index.js` at version 0.2.2, so
the operating fleet already depends on the feature-branch build even though the branch named `main` is stale.

---

## 8. Unknowns requiring operator input

1. **GitHub lifecycle**: preserve issue/PR/CI/review automation, or declare the April usage superseded by the current
   local-only worker rule?
2. **Dashboard**: is the deliberately added opt-in dashboard still wanted, despite no active/runtime evidence?
3. **Terminal plugins**: retain any iTerm2/web attach workflow, or standardize on runtime-native tmux/Herdr attach?
4. **Desktop notifications**: keep desktop delivery, or accept a pull-only `ao status` workflow?
5. **Gemini**: the frozen policy retains it because of April/June use. Is it still a desired fourth agent, or should
   another retained agent replace its use case?
6. **Archive compatibility**: approve metadata-only inspection for the 1,959 non-live archived session ids whose
   worktrees and task/report artifacts no longer exist, or require a stronger compatibility promise?
7. **Baseline integration**: approve fast-forwarding `main` to the finalized Phase −1 feature tip before source
   implementation?
8. **Legacy/test data**: after test isolation is fixed, should a separately reviewed cleanup remove the 1,174
   synthetic AO roots and obsolete killed-config records?
9. **Worker model config**: should `worker.agentConfig.model: opus` be removed in favor of mandatory per-spawn model
   selection for the mixed-agent fleet?

---

## 9. Phase 0 go/no-go

### Go

- Keep the four evidenced agents: Claude Code, Codex, OpenCode, and Gemini.
- Keep both tmux and Herdr.
- Keep worktree workspace and the lifecycle supervisor.
- Begin Phase 1 dependency/drain analysis for Aider, Cursor, process runtime, clone workspace, Linear, GitLab, and
  unused notifier integrations.
- Fix test isolation so future test runs do not write synthetic roots into the real AO data directory.
- Design metadata-only archive inspection independently of executable plugin restore.

### Conditional go

- GitHub lifecycle, dashboard/web, terminal plugins, and desktop notification changes require the §8 operator
  decisions.
- Source implementation requires the baseline ref to be reconciled first.

### No-go

- No package deletion yet.
- No implementation from the stale `main` ref.
- No cleanup of synthetic or legacy data roots during Phase −1.
- No claim that archived `working`/`stuck` sessions are restorable.
- No claim that absence from shell history means absence of use.

Phase −1 evidence collection is complete, but the phase cannot be marked fully closed until the operator decisions
in §8 and the baseline integration decision are recorded.
