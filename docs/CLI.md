# AO CLI Reference

The `ao` CLI is the control interface for this headless personal Agent Orchestrator distribution.

## Commands humans use

```bash
ao start                               # Auto-detect config and start supervisor/orchestrator
ao start <github-url>                  # Clone a GitHub repo, auto-configure, and start
ao start ~/other-repo                  # Add a new project and start
ao stop                                # Stop the orchestrator and lifecycle worker
ao status                              # Overview of all sessions
ao status --watch                      # Live-updating terminal status view
ao session attach <session>            # Enter a session through tmux or Herdr
```

## Commands the orchestrator agent uses

These are primarily invoked by the orchestrator agent running inside a tmux session. You can use them manually if needed, but the orchestrator handles this automatically.

```bash
ao spawn [issue]                       # Spawn an agent (project auto-detected from cwd)
ao spawn 123 --agent codex             # Override agent for this session
ao batch-spawn 101 102 103             # Spawn agents for multiple issues at once
ao send <session> "Fix the tests"      # Send instructions to a running agent
ao session ls                          # List sessions
ao session ls --json                   # Machine-readable session inventory
ao session kill <session>              # Kill a session
ao session restore <session>           # Revive a crashed agent
```

## Maintenance commands

```bash
ao doctor                              # Check install, runtime, and stale temp issues
ao doctor --fix                        # Apply safe fixes automatically
ao config-help                         # Show full config schema reference
```

`ao doctor` checks PATH and launcher resolution, required binaries, configured plugin resolution, tmux and GitHub CLI health, config support directories, stale AO temp files, and core build/runtime sanity.

There is no self-update command. Update the checkout with ordinary Git operations, then run `pnpm install`,
`pnpm build`, and the verification gates before refreshing any global link.
