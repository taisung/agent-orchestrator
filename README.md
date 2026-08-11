# Agent Orchestrator — personal AO distribution

This repository is a focused TypeScript distribution of Agent Orchestrator for running parallel coding agents in
isolated local git worktrees. It is maintained independently from the current upstream project.

The retained profile is:

- agents: Claude Code, Codex, Gemini, and OpenCode;
- runtimes: tmux and Herdr;
- workspace: git worktrees;
- tracker/SCM lifecycle: GitHub;
- notifier: desktop;
- durable session metadata, lifecycle supervision, status, messaging, and cleanup; and
- native session attachment through tmux or Herdr.

AO no longer ships Aider, Cursor, process runtime, clone workspaces, Linear, GitLab, non-desktop notifiers, an
OpenClaw setup flow, a plugin marketplace/scaffolder, or the self-update command. Internal adapter interfaces remain
so the retained implementations stay testable. Explicit external npm/local plugin descriptors are advanced,
manually installed configuration—not a supported marketplace workflow.

The distribution is headless: the Next.js dashboard, browser terminal, iTerm2 terminal adapter, and their CLI
commands are not shipped.

## Install and verify

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

The global `ao` launcher in this checkout resolves to `packages/cli/dist/index.js`. Rebuild before exercising source
changes.

Required tools depend on the selected profile:

- Node.js 20+, pnpm 9, Git, and `gh`;
- tmux for the default runtime; or
- a compatible running Herdr server for `runtime: herdr`.

## Start

From an existing GitHub-backed repository:

```bash
ao start
```

Or clone and configure a GitHub repository:

```bash
ao start git@github.com:owner/repository.git
```

Attach to the orchestrator or a worker with `ao session attach <session-id>`.

## Configuration

Minimal `agent-orchestrator.yaml`:

```yaml
defaults:
  runtime: tmux # or herdr
  agent: claude-code # claude-code | codex | gemini | opencode
  workspace: worktree
  notifiers: [desktop]

projects:
  my-project:
    name: My Project
    repo: owner/repository
    path: /absolute/path/to/repository
    defaultBranch: main
    sessionPrefix: mp
    tracker:
      plugin: github
    scm:
      plugin: github

notifiers:
  desktop:
    plugin: desktop
```

State defaults to `~/.agent-orchestrator`. Set `AO_STATE_ROOT` to isolate it under another absolute root. Test
processes automatically use per-process temporary roots and must never write synthetic fixtures into live state.

Run `ao config-help` for the generated reference and `ao doctor` to verify the selected runtime and plugins.

## Core workflow

```text
ao start
  -> ao spawn / ao batch-spawn
  -> ao send / ao status / ao session attach
  -> review worker report, commit, and diff
  -> integrate locally or through the retained GitHub lifecycle
  -> ao session cleanup
```

Task and report files are durable evidence. Terminal input is a notification path, not proof that an agent consumed
or completed an instruction. Persisted runtime and agent identities, rather than current defaults, govern operations
on existing sessions.

## Development context

- [CLAUDE.md](CLAUDE.md) contains current architecture and conventions.
- [development/0005_personal_fork_scope_and_trim_plan.md](development/0005_personal_fork_scope_and_trim_plan.md)
  defines the trim strategy.
- [development/0006_phase_minus_1_usage_and_baseline_inventory.md](development/0006_phase_minus_1_usage_and_baseline_inventory.md)
  records the usage evidence and open conditional decisions.
- [docs/CLI.md](docs/CLI.md) is the operator command summary.

Historical upstream design documents remain in the repository as provenance; they do not override the retained
profile above.

## License

MIT
