# 0005 — Personal-fork scope: trim AO around the workflow its skills actually use

**Date**: 2026-08-11
**Context**: the TypeScript fork is now a separately maintained product rather than a downstream branch that can
meaningfully converge with the current upstream AO. This plan derives the fork's target surface from the three AO
operator skills in active use: `ao-spawn`, `ao-communicate`, and `ao-lifecycle`.
**Status**: proposal, revised after adversarial internal review. No packages or commands have been removed. The
skill-derived product profile is a hypothesis, not evidence of actual usage; Phase -1 must inventory real configs,
sessions, and campaigns before any retirement decision. GitHub lifecycle, agent, runtime, notifier, and UI retention
remain open until that inventory is complete.

---

## 1. Decision frame

The goal is no longer to preserve feature parity with `github.com/ComposioHQ/agent-orchestrator` or its Go
successor. The goal is to make this fork small, reliable, and fitted to the way it is actually operated.

The three skills describe a consistent core workflow hypothesis:

1. Start an orchestrator for a local project.
2. Create an isolated git worktree for each worker.
3. Select the agent and model explicitly at launch.
4. Place a durable task brief in the worktree.
5. Run the agent under herdr, with tmux retained as a fallback.
6. Send short follow-ups and redirects without assuming that a terminal paste proves delivery.
7. Monitor activity, output, commits, and a durable report file.
8. Review the worker's diff and validation evidence.
9. Integrate a clean worker commit into the configured local integration branch.
10. Stop the session and remove its worktree and branch.

This is the clearest documented operator path, but it is not sufficient evidence that it is the whole product. The
skills are runbooks, not usage telemetry. They also mention issue-based spawning, PR claiming, PR/CI/review status,
and lifecycle reactions. Development note 0003 says explicitly that the PR/CI/lifecycle stack is “the actual reason
we run `ao`.” Recent fork history also added Gemini deliberately. Those facts directly challenge a premature
local-only conclusion.

The current monorepo additionally carries a web application, terminal servers, a marketplace, plugin scaffolding,
several external trackers, two SCM providers, six notifier integrations, two workspace modes, three runtimes, and
six agent plugins. Each remains a **retirement candidate**, not an approved deletion, until Phase -1 measures its
real use and the reduced profile has a functional replacement for consumer assumptions.

### Product principles

- **Local-first.** Local `main`, local worktrees, local commits, and local integration are authoritative. A remote is
  a publication target, not the source of truth for a newly spawned worker.
- **Durable control plane.** Task and report files are authoritative. Terminal messages are notifications and
  redirects, not durable records.
- **Runtime-agnostic commands.** Operator commands ask the selected runtime for output, liveness, delivery, and
  attach information. They do not reach around the runtime interface to call tmux directly.
- **Explicit launch configuration.** Agent, model, branch, base ref, and task input are resolved before the agent
  starts. Interactive slash commands are not configuration.
- **Honest status.** AO should report what it can establish and fail loudly when it cannot verify an important
  transition. It must not convert a successful paste into a claim that the agent received or acted on a message.
- **Personal distribution, modular internals.** Remove unused shipped packages and commands first. Do not collapse
  every core interface merely to save a few files; retaining a clean internal seam is cheaper than reintroducing one
  later.
- **Evidence before retirement.** Define a lookback period and removal thresholds before inspecting usage. Do not
  infer disuse from silence in skills, examples, or one project config.
- **Drain before removal.** A plugin cannot be removed while live or restorable sessions still reference it. Archived
  sessions need an explicit read-only compatibility policy even when their executable plugin is retired.
- **Resumable destruction.** Archive durable artifacts and record cleanup intent before destroying a runtime,
  worktree, or branch. A partial cleanup must be diagnosable and safely retryable.

---

## 2. What the AO skills require

| Capability                   | Evidence in the skills                                                                   | Product decision                           |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| Worktree sessions            | Every spawn, report, review, and cleanup path is worktree-based                          | **Keep and make first-class**              |
| Claude Code, Codex, OpenCode | These are the only agents covered by selection and delivery rules                        | **Keep**                                   |
| Per-spawn agent and model    | Skills forbid `/model` and require launch-time selection                                 | **Keep `--agent`; keep `--model`**         |
| Herdr and tmux               | Herdr fixes the measured runtime failures; skills still contain tmux fallback procedures | **Herdr primary; tmux fallback**           |
| Durable task brief           | `.agent_task.md` is the canonical non-trivial task-delivery mechanism                    | **Make native to `ao spawn`**              |
| Durable worker report        | `.agent_report.md` is authoritative because `ao send` notifications can be lost          | **Make native session state**              |
| Local integration base       | Skills repeatedly rebase workers because AO starts them from stale `origin/main`         | **Default to the configured local ref**    |
| Status and inspection        | `ao status`, session listing, pane output, git state, and reports drive supervision      | **Keep; make runtime-agnostic**            |
| Send and redirect            | Required for task-ready notifications, corrections, handoffs, and STOP orders            | **Keep; preserve verified herdr delivery** |
| Kill and cleanup             | Every completed or replaced worker must release runtime/worktree/branch resources        | **Keep and consolidate**                   |
| Batch spawn                  | Multi-worker campaigns are a normal operating mode and exposed several real defects      | **Keep**                                   |
| Local integration            | Skills inspect and cherry-pick worker commits rather than asking workers to push         | **Optimize for it**                        |

### Capabilities whose usage must be measured

The active skills do not make the following capabilities central to their main happy path:

- the Next.js dashboard or its terminal WebSocket servers;
- iTerm2 or web terminal plugins;
- the process runtime;
- clone-based workspaces;
- Aider, Cursor, or Gemini agents;
- Linear or GitLab trackers;
- GitLab SCM;
- Slack, Discord, Webhook, Composio, OpenClaw, or desktop notifications;
- the plugin marketplace, plugin installer, or plugin scaffolder;
- `ao verify`, `ao review-check`, or automatic PR/CI reaction handling.

This list is an inventory target, not a deletion authorization. There is direct counterevidence to treating it as a
non-use list: the skills contain issue, claim-PR, PR/CI/review, and notification concepts; development note 0003
calls the lifecycle stack AO's purpose; and Gemini is a recent fork-specific feature. Phase -1 must examine actual
configuration, live and archived metadata, command/campaign records where available, and operator intent.

Removal thresholds must be written before counts are examined. At minimum:

- **active dependency**: any current config or live session references the capability → keep or migrate;
- **restoration dependency**: any session expected to remain restorable references it → keep a compatibility path;
- **recent deliberate use**: any use inside the agreed lookback period → retain unless an explicit replacement is
  accepted;
- **no measured use**: eligible for retirement, but only after retained consumers pass without implicit fallback to
  the removed plugin.

---

## 3. Candidate personal distribution

### 3.1 Minimum retained kernel

```text
packages/core
packages/cli
packages/ao
packages/plugins/agent-claude-code
packages/plugins/agent-codex
packages/plugins/agent-opencode
packages/plugins/runtime-herdr
packages/plugins/runtime-tmux
packages/plugins/workspace-worktree
```

This is the minimum kernel needed by the skill-defined workflow hypothesis, not the complete approved package list.
Retain `packages/integration-tests`, but rewrite its matrix around the selected distribution. Tests should not keep
otherwise-unused plugins alive merely because the old integration suite imports them; equally, package deletion
must not be used to hide a failing test.

### 3.2 Profile-dependent packages

GitHub issue lookup, PR ownership, CI/review polling, and automatic reactions require:

```text
packages/plugins/tracker-github
packages/plugins/scm-github
```

If GitHub automation is removed, local mode must first become explicit in configuration and consumers. Today config
inference, spawn preflight, plugin lookup, status, lifecycle, and cleanup contain GitHub defaults or assumptions.
Deleting the packages without replacing those assumptions does **not** produce a functioning local-only AO.

The same evidence rule applies to notifier and agent retention. In particular, Gemini is a recent deliberate fork
addition and must not be removed merely because the three current AO skills do not discuss it.

### 3.3 Retirement candidates, subject to Phase -1

```text
packages/web
packages/plugins/agent-aider
packages/plugins/agent-cursor
packages/plugins/agent-gemini
packages/plugins/runtime-process
packages/plugins/workspace-clone
packages/plugins/tracker-linear
packages/plugins/tracker-gitlab
packages/plugins/scm-gitlab
packages/plugins/terminal-iterm2
packages/plugins/terminal-web
packages/plugins/notifier-composio
packages/plugins/notifier-desktop
packages/plugins/notifier-discord
packages/plugins/notifier-openclaw
packages/plugins/notifier-slack
packages/plugins/notifier-webhook
```

No package in this list is approved for removal yet. Retirement should be staged only after usage, persisted-session
references, and replacement behavior have been established. First remove a candidate from the selected profile's
CLI dependencies, registry, generated config, docs, and tests behind a branch that remains easy to restore. Delete
its directory only after the reduced build and live-session compatibility gates are green.

### 3.4 CLI surface to keep

```text
ao init
ao start
ao stop
ao doctor
ao spawn
ao batch-spawn
ao send
ao status
ao open
ao session ls
ao session output       # proposed
ao session report       # proposed
ao session attach
ao session kill
ao session finish       # proposed
ao session integrate    # proposed
ao session cleanup
ao session restore      # keep if resume is used and tested
ao config-help
```

`ao open` and `ao session attach` overlap. Once attach is runtime-aware, `open` can become a convenience alias or be
removed in a later cleanup.

The background supervisor is required even in local-only mode to poll agent activity and durable reports. Keep its
function, whether the internal command remains named `ao lifecycle-worker` or is renamed to `ao supervisor`.

### 3.5 CLI surface conditional on GitHub automation

```text
ao review-check
ao verify
ao session claim-pr
ao spawn --claim-pr
ao spawn --assign-on-github
ao spawn --decompose
ao batch-spawn <tracker-issue-list semantics>
```

Keep `batch-spawn` itself, but give it a per-worker manifest mode if tracker issue lists are removed. A single global
set of flags cannot describe a mixed-agent, mixed-model, multi-branch acceptance campaign.

### 3.6 CLI surface eligible for retirement after usage inventory

```text
ao dashboard
ao plugin ...
ao setup openclaw
ao update               # replace with the repository's ordinary local build/install procedure
```

---

## 4. Productize the skill workarounds

The skills are long because they compensate for product behavior. The highest-value changes are the ones that let
whole workaround sections disappear.

### 4.1 Atomic task-file spawning

Add:

```bash
ao spawn --agent codex --model gpt-5.6-terra \
  --task-file /absolute/path/to/task.md \
  --branch work/my-task
```

Required semantics:

1. Validate and read the source task file before allocating resources; record its size and cryptographic hash.
2. Reserve the session identity and create an AO-owned artifact directory outside the worktree, under the project's
   AO data directory.
3. Copy the canonical task into that artifact directory atomically.
4. Create the worktree.
5. Run all workspace symlink and post-create hooks. These hooks may run arbitrary commands, including `git clean`, so
   no earlier worktree copy is considered durable or verified.
6. Refuse to overwrite a user-owned `.agent_task.md` or `.agent_report.md`. Record ownership of every AO-created
   path in session metadata.
7. Materialize the worker-visible `.agent_task.md` from the canonical artifact after hooks complete, using an atomic
   temporary-file + rename sequence or an AO-owned symlink to the external artifact.
8. Exclude AO-owned task/report paths from git dirty-state checks without modifying tracked `.gitignore` content.
9. Re-hash the final worker-visible task immediately before runtime creation and compare it with the source hash.
10. Launch the runtime and agent only after steps 1–9 succeed.
11. Include a short initial instruction telling the agent to read `.agent_task.md` and execute it autonomously.
12. On any pre-launch failure, archive the failure state, remove only resources recorded as AO-owned, and do not
    start an agent.

This removes:

- staging briefs under `/tmp` and copying them after spawn;
- pointer titles;
- the race where an eager agent acts on a title before receiving its scope;
- the follow-up task-ready ping for Claude Code and Codex;
- unique-title gymnastics used solely to avoid branch collisions.

OpenCode may still require a post-launch prompt because it ignores the launch prompt. The task file should already be
present when that prompt is sent, and herdr's verified send path should carry the notification.

Positional task text and `--task-file` are mutually exclusive. Supplying both is an error rather than an implicit
precedence rule. Batch mode uses a per-worker manifest containing task source, name, branch, base, agent, and model.

### 4.2 Separate task text, display identity, and git branch

AO currently overloads a free-text spawn argument as task description, tracker identifier, and branch slug. Replace
that implicit coupling with explicit concepts:

```text
task source    --task-file or short positional text
display label  --name, defaulting to the session id or a short task label
git branch     --branch, defaulting to session/<session-id>
```

The task may be identical across several workers without creating a branch collision. A batch can intentionally run
several agents against the same brief while each receives a distinct session branch.

If an explicit branch already exists, spawn fails by default. Reusing it requires `--reuse-branch`, records that AO
does not own the branch, and verifies its current commit against the requested base. A base ref is never silently
ignored merely because a branch name already exists.

### 4.3 Make the configured local integration branch the default base

The worktree plugin currently prefers `origin/<defaultBranch>` whenever the remote ref exists, even when local
`<defaultBranch>` is ahead. The skills therefore require an orchestrator-side rebase after every spawn.

First add an explicit project field such as `integrationBranch`; do not hard-code `main` as both the git default and
the integration target. Change the default resolution order to:

1. explicit `--base <ref>`, if provided;
2. local `refs/heads/<integrationBranch>`;
3. local `refs/heads/<defaultBranch>` when no integration branch is configured;
4. `origin/<defaultBranch>` only when no selected local branch exists.

Do not fetch merely to spawn a local worker. Add an explicit remote mode for users who want it:

```bash
ao spawn --base origin/main ...
```

Acceptance requires the worker's initial `HEAD` to equal the resolved local integration ref without a post-spawn
rebase. The expected hash is written into session/task metadata for auditability, but it should no longer be a repair
instruction.

Branch names are not sufficient evidence of freshness. As of this plan revision, the checkout is on
`fix/backport-upstream-activity-metadata`, which is 17 commits ahead of local `main`; those commits include the Herdr
work and backports this plan intends to preserve. Phase -1 must name a canonical release-base SHA and place it on the
selected integration branch before any spawn campaign or trim implementation begins.

### 4.4 Promote the durable worker report into session state

Store the canonical report outside the disposable worktree in the AO-owned artifact directory. A worker-visible
`.agent_report.md` may be an AO-owned symlink or compatibility endpoint, but finishing a session must not destroy the
only copy. Archive the exact task and report bytes, their hashes, and their timestamps before cleanup.

Define a genuinely versioned canonical format, for example:

```json
{
  "version": 1,
  "state": "done",
  "commit": "<sha-or-null>",
  "summary": "one-line summary",
  "updatedAt": "<ISO-8601 timestamp>"
}
```

Preserve the existing one-line form as a legacy input format:

```text
running|<commit-or-none>|<summary>
done|<commit-or-none>|<summary>
partial|<commit-or-none>|<summary>
blocked|<commit-or-none>|<reason>
```

AO should:

- keep a generic background supervisor in both local and GitHub profiles; GitHub reactions are optional, local
  activity/report polling is not;
- accept worker writes through atomic temporary-file + rename where the agent can follow the protocol;
- use stable-read/retry logic so a partially written legacy report is never accepted as final;
- parse defensively with size limits, UTF-8 validation, control-character handling, and explicit legacy rules for
  delimiters and embedded newlines;
- surface report status, commit, summary, and modification time in `ao status --json`;
- display a concise report indicator in the normal status view;
- expose the full canonical record through `ao session report <session>` before and after cleanup;
- treat the file as authoritative completion evidence;
- treat worker-to-orchestrator `ao send` as an optional notification;
- never overwrite `SessionStatus` or `ActivityState` directly from the report;
- model report state separately as `TaskReportState = running | done | partial | blocked`;
- never mark a session integrated merely because a worker wrote `done`;
- validate any reported SHA with `git cat-file -e <sha>^{commit}` and verify that it belongs to the session's recorded
  work before presenting it as integration evidence.

The orchestrator must still inspect the commit and diff. A worker report is a state transition, not proof of plan
conformance or correctness.

### 4.5 Runtime-independent output and attachment

Add:

```bash
ao session output <session> [--lines N] [--follow]
ao session attach <session>
```

Both commands must resolve the runtime from the persisted `RuntimeHandle`, not current project defaults.

- `output` calls `Runtime.getOutput()`. Herdr returns `recent-unwrapped`; tmux uses capture-pane. The runtime result
  must distinguish successful empty output from unavailable/error; a bare empty string is insufficient.
- `attach` calls `Runtime.getAttachInfo()`. If the environment cannot open an interactive terminal, print the exact
  attach command rather than failing or silently falling back to tmux.

Replace the current misleading attach-type label with a runtime-neutral command description, for example
`{ command, args, requiresTty }`, or add an explicit Herdr type. The CLI must not treat Herdr's current `"process"`
label as permission to dispatch through the process runtime.

For `--follow`, define whether the runtime supplies a stream/cursor or the CLI polls snapshots and de-duplicates
them. A snapshot-only `getOutput()` contract cannot promise lossless follow behavior without additional state.

Once this exists, the generic lifecycle skill should not call `tmux capture-pane` directly. tmux commands remain a
runtime-specific recovery tool, not the normal operator API.

### 4.6 Make send results precise

Preserve the herdr plugin's send-and-verify behavior measured in 0003 and documented in 0004. Normalize CLI output
around three distinct outcomes:

```text
accepted       runtime observed evidence that the prompt was consumed
unverified     input was submitted but consumption could not be established
failed         runtime established non-delivery or the send operation failed
```

This requires an interface change. `Runtime.sendMessage(): Promise<void>` cannot carry outcome or evidence. Replace
or extend it with a result such as:

```ts
interface SendResult {
  outcome: "accepted" | "unverified" | "failed";
  evidence?: string;
  observedAt: string;
}
```

Likewise, output retrieval must return structured availability/error information rather than swallowing runtime
errors into `""`. Adapt Herdr and tmux together and add compatibility handling before retiring any other runtime.

Do not print “processing” unless a runtime produced evidence for that state. Even `accepted` is not proof that the
agent understood or completed the instruction; durable reports and artifacts remain the completion channel.

An unrelated pane redraw or activity transition is not consumption evidence. Tests must include a runtime that
changes output for unrelated reasons while discarding the message.

For critical mid-session redirects, the skill may continue to request an agent-authored ACK. That is semantic
acknowledgment and cannot be inferred from terminal state.

### 4.7 Record integration, then finish through a resumable cleanup transaction

Cherry-picking changes commit identity: worker commit `A` becomes integration commit `B`, so `A` is normally not an
ancestor of the integration branch. A simple reachability test is incompatible with the canonical workflow. Add an
integration operation that records what happened:

```bash
ao session integrate <session> --strategy cherry-pick
```

For an AO-executed integration, record:

- worker commit set and ordered patch identities;
- integration strategy (`cherry-pick`, `merge`, or `squash`);
- resulting integration commit(s) and target ref;
- pre/post target hashes;
- timestamp and verification outcome.

For integration performed manually outside AO, require an explicit `mark-integrated`/receipt flow that verifies
patch equivalence where possible and records user confirmation where equivalence is ambiguous. Multi-commit reorder
and squash cases must be defined explicitly; ancestry alone is never sufficient for cherry-picks.

Then add a conservative finishing workflow:

```bash
ao session finish <session> --delete-branch
```

Default behavior:

1. Read and display the durable worker report.
2. Show the validated reported commit, integration receipt, and dirty-worktree state. Exclude only paths recorded as
   AO-owned; do not globally ignore similarly named user files.
3. Refuse destructive cleanup if non-AO uncommitted changes, unrecorded commits, or unresolved integration evidence
   exist.
4. Atomically archive session metadata, task, report, ownership records, runtime handle, branch/base hashes, and
   integration receipt **before** destructive work. If archival fails, leave runtime, worktree, and branch intact.
5. Persist a resumable cleanup state such as `archived -> runtime_destroyed -> workspace_destroyed -> complete`.
6. Destroy the runtime, then the worktree, updating cleanup state after each successful step. A retry resumes from the
   last durable state.
7. Delete the branch only with `--delete-branch`, only when metadata proves AO created it, and only when the
   integration receipt proves its work is represented on the configured integration branch. Patch-equivalent
   cherry-picks qualify; bare reachability is not the only test.
8. Never delete a reused or pre-existing branch without a separate explicit confirmation, even when it is merged.

`ao session kill` remains an explicit abort operation. `finish` is the safe normal path. This distinction removes
the skill's repeated “kill does not delete the branch” footgun without making branch deletion implicit.

Finishing must preserve `ao session report` and task retrieval from the archive. Byte-for-byte hashes should remain
available for handoff and audit after the worktree is gone.

---

## 5. Skill cleanup after product changes

The skills should become short descriptions of stable workflow, not an accumulating incident log.

### 5.1 Keep in the generic AO skills

- when to choose Claude Code, Codex, or OpenCode;
- launch-time agent and model selection;
- task-file construction and scope control;
- no initial ACK gate;
- send/redirect semantics;
- durable report format;
- status, output, handoff, finish, and cleanup procedures;
- generic multi-worker rules such as one writer per worktree;
- review-the-diff-before-integration discipline.

### 5.2 Move into a Nexus-specific operations skill

- `python3 build.py -b` as the mandatory build command;
- GPU 0/1/2/3 allocation policy;
- CUDA benchmark commands and locked-clock baselines;
- bit-identity and `D_sys` rules;
- singleton pinned-gate ordering examples from Nexus;
- `TODO_TRACKING.md` and numbered development-plan updates;
- Nexus session prefixes and historical `nex-*` incidents.

Those rules are valuable, but they describe how Nexus uses AO rather than how AO works. Separating them makes the AO
skills transferable and prevents a generic orchestration change from accidentally rewriting scientific validation
policy.

### 5.3 Resolve current contradictions

The next skill revision should explicitly remove these inconsistencies:

1. `ao-spawn` says never send `/model`, then its canonical sequence sends `/model sonnet`. Only `ao spawn --model`
   should remain.
2. `ao-spawn` alternates between mandatory pointer titles and descriptive Codex titles. Native `--task-file`
   removes both workaround branches.
3. `ao-communicate` initially says `ao send` provides proper delivery, then correctly documents false success.
   Replace this with the accepted/unverified/failed contract.
4. `ao-lifecycle` uses tmux capture commands as its normal inspection path even though herdr is now usable. Replace
   them with `ao session output` and runtime-aware attach.
5. References to unavailable `ao-race`, `/loop`, and `CronDelete` capabilities should either point to real installed
   skills/tools or be removed.
6. Destructive examples such as resetting an integrated default branch should be replaced with an explicit,
   recoverable revert or a delegated correction workflow.

Do not rewrite the skills before the relevant CLI behavior lands. Otherwise the skills will describe a desired API
rather than the installed tool and become a new source of operational error.

---

## 6. Implementation sequence

### Phase -1 — measure usage, persisted dependencies, and the release baseline

Write the lookback period and retention/removal thresholds **before** examining counts. Then inspect, read-only:

1. every active `agent-orchestrator.yaml` used by this installation;
2. live and archived AO metadata under each configured project data directory;
3. persisted agent, runtime, workspace, tracker, SCM, notifier, terminal, PR, issue, and restore references;
4. recorded campaigns and development notes for tracker spawns, PR claims/reactions, notifier delivery, dashboard
   use, and non-core agents such as Gemini;
5. any available command history or structured logs, without treating absence of logs as proof of absence of use;
6. explicit operator intent for capabilities whose historical use cannot be reconstructed.

Produce a retention matrix with `active`, `restorable`, `recently used`, `replace`, `retire`, and `unknown` states.
Unknown is not equivalent to retire.

At the same time:

- select the canonical integration branch and record its release-base SHA;
- reconcile the current fact that `fix/backport-upstream-activity-metadata` is 17 commits ahead of local `main`;
- confirm that the release base contains the backports and Herdr implementation being preserved;
- inventory all live/restorable sessions by persisted plugin identity;
- record the installed Herdr binary version and protocol.

Exit gate: the profile decision is backed by measured evidence, every retirement candidate has a drain or
compatibility disposition, and the chosen integration ref names the actual code baseline rather than assuming a
branch called `main` is current.

### Phase 0 — define explicit profiles and remove implicit GitHub assumptions

Record these decisions:

1. **Lifecycle profile**: local-only, or local + GitHub issues/PR/CI/reviews.
2. **Agent set**: retain each measured agent; add or remove one only with a concrete use case and maintained
   activity/delivery tests.
3. **Runtime set**: Herdr primary and tmux fallback only if supported by usage and compatibility evidence.
4. **Notification profile**: pull-only status, desktop, or retained external notifier. Removing all notifiers is a
   visible behavior change, not packaging cleanup.
5. **Archive compatibility**: which operations remain available for sessions created with retired plugins.

If local-only is selected, implement it explicitly before removing GitHub packages:

- config must represent `lifecycle: local`/`tracker: none`/`scm: none` without inferring GitHub from `owner/repo`;
- spawn must not run `gh` authentication preflight;
- status, cleanup, recovery, and restore must work without an SCM object;
- local supervision must remain active;
- GitHub-specific commands must fail with a clear profile error rather than an unknown-plugin exception.

Exit gate: a minimal local config can spawn and report status while logged out of `gh` and with GitHub plugins
absent. If GitHub is retained, its commands and reaction loop have corresponding profile tests.

### Phase 1 — establish a reduced-distribution and retirement gate

Before behavioral changes:

1. Add a CI/test command that builds only the proposed retained packages.
2. Inventory imports from retained packages into retirement candidates.
3. Add end-to-end fixtures for Claude Code/Codex/OpenCode × herdr/tmux where practical; use mocked runtime tests for
   combinations that cannot run in CI.
4. Capture current CLI help and config-generation snapshots.
5. Mark retirement candidates as unsupported in the personal profile without deleting code.
6. Add a retirement report that lists live and archived sessions by persisted agent/runtime/workspace/tracker/SCM
   identity.
7. Define whether archived sessions support only metadata/task/report inspection or full restore after their plugin is
   retired.

Exit gate: the proposed retained package set builds, typechecks, and tests independently of the retirement set, and
no plugin is eligible for deletion while a live or required-restorable session references it.

### Phase 2 — close the spawn correctness gaps

Implement together because they share the spawn transaction:

1. external canonical task artifacts plus post-hook atomic worker-visible provisioning;
2. explicit `--branch` and task/branch decoupling;
3. explicit `--base` with configured local integration-branch precedence;
4. cleanup of partial workspaces when any pre-launch step fails;
5. explicit existing-branch ownership/reuse semantics;
6. a per-worker batch manifest supporting distinct task, name, branch, base, agent, and model values.

Exit gate: a zero-delay multi-worker campaign cannot start an agent before its brief exists, cannot collide merely
because task text is identical, and starts every worker on the recorded integration-base commit. A post-create hook
that deletes or mutates the brief causes spawn to repair from the canonical artifact or abort before runtime creation.

### Phase 3 — make supervision runtime-agnostic

1. Extend runtime send/output results to represent outcome, evidence, availability, and error explicitly.
2. Add `ao session output` through the structured runtime output contract.
3. Route `ao session attach` through a runtime-neutral attach command.
4. Dispatch status through each session's persisted agent and runtime identities, including mixed-agent campaigns.
5. Remove remaining normal-path tmux calls from status, send, open, recovery, and lifecycle code where a runtime
   method exists.
6. Add canonical/legacy report parsing and status enrichment while retaining the generic supervisor.
7. Normalize send outcomes without weakening Herdr's verified delivery.
8. Add Herdr version/protocol preflight and fail before resource creation on unsupported combinations.

Exit gate: the AO skills can monitor and redirect a herdr or tmux worker without naming either backend, except in a
runtime-specific troubleshooting appendix.

### Phase 4 — record integration and make completion transactional

1. Add durable task/report inspection before and after worktree cleanup.
2. Add `ao session integrate` and integration receipts for merge, cherry-pick, and squash paths.
3. Add `ao session finish` with AO-owned-path filtering, dirty/unintegrated-work protection, and branch-ownership
   checks.
4. Archive artifacts before destruction and implement resumable cleanup state.
5. Define the context-exhaustion handoff path using canonical task/report artifacts and local commits.

Exit gate: a completed worker leaves no orphan runtime, worktree, or AO-owned integrated branch; archives retain
byte-identical task/report artifacts; and AO refuses to discard work that lacks a valid integration receipt.

### Phase 5 — trim the distribution

Drain and remove one vertical slice per commit or small series:

1. dashboard + web terminals;
2. marketplace/setup/update commands;
3. unused notifier plugins;
4. unused tracker/SCM plugins, subject to the GitHub decision;
5. unused agent plugins;
6. process runtime and clone workspace;
7. stale docs, changesets, integration fixtures, dependencies, and generated-config alternatives.

For each slice:

- prove zero live references and satisfy the archived-session compatibility policy;
- remove CLI dependencies and registry entries;
- remove config-generator/help references;
- update tests and integration fixtures;
- run the reduced-distribution gate;
- run the repository-wide typecheck/test/build while the full tree still exists;
- run status/send/kill/cleanup/restore compatibility tests against representative persisted handles;
- delete the package only after no retained package imports it and no required session depends on it.

Do not combine the entire deletion into one commit. A monolithic trim would make it difficult to distinguish a real
core dependency from stale test or packaging residue.

### Phase 6 — rewrite the skills against the new product

1. Shorten the three generic AO skills.
2. Move Nexus-specific material to a project skill.
3. Replace pointer-title, post-spawn rebase, tmux scrape, and manual branch-deletion procedures with the new commands.
4. Run a real multi-worker campaign using only the revised skill instructions.
5. Preserve incident history in `development/0001`–`0005`; do not keep it inline in operational skills.

---

## 7. Acceptance campaign

The final gate should reproduce the conditions that originally broke AO rather than relying only on unit tests.

### 7.1 Nine-worker spawn campaign

- Spawn nine workers concurrently with zero artificial delay.
- Reuse at least one identical task file across multiple workers.
- Mix Claude Code and Codex; include OpenCode if it remains supported.
- Select models per spawn.
- Use herdr for the primary run and a smaller tmux fallback run.
- Give each task a unique nonce and task-file hash that the agent must copy into its durable report.

Required results:

- **9/9** worktrees contain a task whose hash equals the canonical artifact before the agent process starts.
- **9/9** initial commits equal the recorded integration-base SHA.
- **0** branch collisions from identical task content or display labels.
- **9/9** runtime handles persist the correct runtime and remain correctly routed after changing the configured
  default for new sessions.
- **9/9** workers consume the task and return the correct agent-authored nonce/hash through the durable report.
- **9/9** reports remain retrievable and hash-valid after normal finish/archival.
- No send operation reports verified acceptance without runtime evidence.

Failed/blocked classification is tested in a separate induced-failure campaign. It does not substitute for success
in the nine-worker delivery gate; an implementation that drops all instructions and labels all sessions failed must
fail this campaign.

Negative cases:

- a fake runtime changes pane output for an unrelated redraw but discards the message → result is not `accepted`;
- a runtime submits input but has no consumption evidence → result is `unverified`;
- an unavailable runtime output endpoint → command fails explicitly rather than returning a successful blank result;
- a post-create hook deletes or mutates `.agent_task.md` → spawn repairs from the canonical artifact or aborts before
  runtime creation.

### 7.2 Completion and cleanup campaign

- Integrate workers through merge, one-to-one cherry-pick, multi-commit cherry-pick, and squash paths.
- Leave one worker dirty.
- Leave one worker with a clean but unintegrated commit.
- Block one worker deliberately.
- Reuse one pre-existing user branch.
- Inject an archive-write failure.
- Use a target repository that has no `.agent_task.md`/`.agent_report.md` ignore entries.

Required results:

- each integration receipt maps worker work to the correct target commit(s), including changed cherry-pick SHAs;
- `finish --delete-branch` succeeds only for safely integrated, AO-owned branches;
- a pre-existing/reused branch is retained unless separately confirmed;
- AO-owned task/report files do not make an otherwise clean worktree dirty;
- Dirty and unintegrated sessions are refused without losing files, commits, worktrees, or branches.
- Archive failure leaves runtime, worktree, metadata, artifacts, and branch intact.
- Interruption after each cleanup state can be retried without repeating unsafe destruction.
- The blocked report is visible in normal and JSON status.
- Exact task and report bytes/hashes remain retrievable after worktree removal.
- Runtime, worktree, metadata archive, and branch state match the command's printed result.

### 7.3 Profile, retirement, and Herdr compatibility campaign

- Build a local-only profile without GitHub tracker/SCM packages; use a repository whose `repo` resembles
  `owner/repo`, log out of `gh`, then run spawn, status, cleanup, and restore.
- Build the retained GitHub profile if selected and run issue/PR/CI/review reaction tests.
- Create representative sessions for every retirement-candidate agent/runtime/workspace, then run the reduced
  registry's status, send, kill, cleanup, archive inspection, and restore policy checks.
- Run doctor, spawn, send, output, attach, and destroy against the supported Herdr version/protocol and the next
  available version. Unsupported combinations fail preflight before worktree creation.
- Run status over a mixed Claude/Codex/OpenCode fleet and verify that each session resolves its persisted agent,
  rather than the project's current default agent.

Required results:

- no selected profile reaches an implicit GitHub plugin or `gh` check when GitHub is disabled;
- no plugin package is deleted with a live or required-restorable persisted reference;
- archived sessions retain the exact inspection/restore behavior promised by the compatibility policy;
- an unsupported Herdr version reports the version/protocol mismatch explicitly before resource allocation.

### 7.4 Repository gates

```bash
pnpm typecheck
pnpm test
pnpm --filter @aoagents/ao-web test    # only until the web package is retired
pnpm lint
pnpm format:check
pnpm build
```

Pre-existing failures must be fixed or explicitly baselined before removal work begins. The trim should reduce the
failure surface, not hide unrelated red tests by deleting their package.

---

## 8. Assumptions and edge cases to falsify

The implementation and acceptance fixtures must cover these cases rather than assuming a simple single-remote
repository:

- configured integration branch is absent, detached, behind another local branch, or not named `main`;
- repository has no remote, multiple remotes, a shallow clone, submodules, or linked worktrees;
- explicit base ref is missing or changes during concurrent batch reservation;
- requested branch already exists and is user-owned;
- target repository already owns `.agent_task.md`, `.agent_report.md`, or the proposed AO artifact path;
- post-create hooks run `git clean -fdx`, replace symlinks, or modify the brief;
- worker report is written partially, rewritten after `done`, contains delimiters/control characters, or names an
  unrelated commit;
- task/report archive succeeds but runtime destruction fails, or runtime destruction succeeds but worktree removal
  fails;
- integration uses reordered cherry-picks, conflict-resolved cherry-picks, squash, or manual edits that defeat naive
  patch-id equivalence;
- current config changes agent/runtime defaults while older sessions retain different persisted identities;
- Herdr server is absent, upgraded, downgraded, or protocol-incompatible;
- retired-plugin sessions remain in archives and a user asks to inspect, clean, or restore them;
- all external notifiers are removed and completion becomes pull-only.

Each assumption needs either a passing fixture, an explicit unsupported-case error before resource allocation, or a
documented operator decision. Silent fallback is not acceptable.

---

## 9. Non-goals

- Tracking or porting features from the upstream Go rewrite.
- Supporting live migration of a running process between tmux and herdr.
- Replacing coding-agent products themselves as part of this trim.
- Inferring task completion from terminal text alone.
- Automatically trusting or integrating a worker's `done` report.
- Building a new web UI during the trim.
- Preserving every historical config as a permanent executable compatibility obligation; archived artifact and
  metadata inspection remains a separate requirement.
- Removing plugin interfaces solely for aesthetic simplicity before the retained runtime/agent boundary is stable.

---

## 10. Profile decisions gated by Phase -1

GitHub lifecycle is the largest architectural choice, but it is not the only retention decision. Agent usage
(including Gemini), notifier behavior, UI use, runtime/workspace history, restore expectations, and the selected
integration branch must also be resolved from the Phase -1 evidence matrix.

### Option A — local-only AO (smallest, not yet justified)

Keep local git and arbitrary remotes, but remove tracker/SCM plugins and automated issue/PR/CI/review reactions.
Workers commit locally; the orchestrator reviews and integrates locally; pushing and PR creation remain explicit
human actions outside AO.

Benefits:

- much smaller core and CLI surface;
- cleanup no longer depends on remote issue/PR state;
- fewer credentials, network failures, caches, polling paths, and metadata fields;
- matches one prominent workflow encoded in the current skills.

Cost:

- no issue-id lookup, PR claiming, CI/review reaction loop, or automatic merge support.

### Option B — local + GitHub lifecycle

Retain `tracker-github`, `scm-github`, lifecycle polling/reactions, PR-enriched status, claim-PR commands, and the
minimum notifier behavior desired for failures or merge readiness. Remove the other trackers, SCM, and notifier
providers.

Benefits:

- preserves the original high-level AO value proposition after a worker opens a PR;
- keeps CI/review-driven follow-up automation.

Cost:

- retains a significant portion of session enrichment, lifecycle, recovery, cleanup, and configuration complexity;
- does not match the current skill rule that workers commit locally and do not create PRs or push.

Choose this option only if the automated PR lifecycle is used in practice, not because it may be useful someday.

Conversely, choose local-only only if measured evidence and operator intent establish that issue/PR/CI/review
automation is not part of the product. Development note 0003 currently provides explicit counterevidence, so the
burden of proof is not one-sided.

---

## 11. Recommendation

Do **not** select Option A or delete packages from the skill audit alone. Run Phase -1 first, reconcile the canonical
branch/SHA, and decide the supported profiles from measured use plus explicit operator intent. Then implement the
profile boundary and Phases 1–4 before deleting packages. Those phases turn today's operational workarounds into
stable product behavior and make later retirement testable and reversible.

The desired end state is not merely fewer packages. It is a tighter contract:

> AO creates a current local worktree, installs a durable task before launch, runs a deliberately selected coding
> agent under a reliable terminal runtime, exposes honest status and output, receives a durable report, and cleans
> up without losing unintegrated work.

This remains the minimum kernel hypothesis. Everything outside it should earn its place through measured use or an
explicit retained capability—but nothing should be removed merely because it was absent from an operational skill.
