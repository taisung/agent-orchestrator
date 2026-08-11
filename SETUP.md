# Personal AO setup

This guide applies to the trimmed personal distribution in this repository, not the historical upstream package
matrix.

## Prerequisites

- Node.js 20 or newer
- pnpm 9.15.4
- Git 2.25 or newer
- GitHub CLI (`gh`), authenticated for retained issue/PR/CI workflows
- at least one retained coding agent: Claude Code, Codex, Gemini, or OpenCode
- tmux, unless every selected session uses a compatible Herdr server

Herdr support currently expects the locally validated protocol/version described in the latest development notes.
Run `ao doctor` before relying on it.

## Build from this checkout

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

The source-install launcher is `packages/cli/dist/index.js`. Rebuild after changing core, CLI, or retained plugin
sources. This fork has no `ao update` command; use ordinary reviewed Git and build operations.

## Configure a project

Run from an existing repository:

```bash
ao start
```

Or clone a GitHub repository and generate configuration:

```bash
ao start git@github.com:owner/repository.git
```

Automatic config generation rejects GitLab, Bitbucket, and unknown hosts because their SCM/tracker plugins are not
shipped. It does not silently substitute GitHub for another host.

Minimal `agent-orchestrator.yaml`:

```yaml
defaults:
  runtime: tmux
  agent: claude-code
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

Supported values in the shipped profile:

| Setting   | Values                                       |
| --------- | -------------------------------------------- |
| Agent     | `claude-code`, `codex`, `gemini`, `opencode` |
| Runtime   | `tmux`, `herdr`                              |
| Workspace | `worktree`                                   |
| Tracker   | `github`                                     |
| SCM       | `github`                                     |
| Notifier  | `desktop`                                    |

Use per-spawn `--agent` and `--model` values for mixed-agent fleets. Do not place a Claude-specific model such as
`opus` in a role that can select Codex, Gemini, or OpenCode.

## State isolation

AO derives project state under:

```text
~/.agent-orchestrator/<config-hash>-<project-id>/
```

Set an absolute state root when isolation is required:

```bash
AO_STATE_ROOT=/absolute/private/root ao status
```

Use the same root for every command and supervisor process managing those sessions. Never point tests at production
state. Vitest processes automatically use per-process roots under `/tmp`.

Legacy archives under the normal AO root are metadata-inspection records unless their runtime, worktree, and
artifacts are independently present. Archive status text is not proof of liveness or restorability.

## Runtime setup

### tmux

```bash
tmux -V
ao doctor
```

### Herdr

Start the Herdr server using its own installation instructions, then select it explicitly:

```yaml
defaults:
  runtime: herdr
```

Run `ao doctor` and confirm the server/protocol compatibility section before spawning. Existing sessions continue
to use their persisted runtime identity when defaults change.

## Session access

This distribution has no dashboard or bundled terminal UI. Use `ao status`, `ao status --watch`, and
`ao session attach <session-id>` to inspect and enter sessions through the selected runtime.

## Diagnostics

```bash
ao doctor
ao status
ao status --watch
ao session ls --json
```

If a retained adapter cannot be resolved, rebuild the workspace and verify the corresponding binary. Removed
adapters are not installable through AO; there is no marketplace, scaffolder, OpenClaw setup wizard, or self-update
workflow.

## Safety notes

- Task/report artifacts are stronger evidence than terminal paste/output.
- A successful send is not automatically verified consumption.
- Review worker commits and diffs before integration.
- Cleanup must not remove dirty or unintegrated worktrees/branches.
- Do not let legacy AO and a differently configured checkout mutate the same state root concurrently.
