# 0007 — Retained-distribution trim execution

**Date**: 2026-08-11
**Context**: implementation of the evidence-approved retirement slice from `0006`, after the operator redirected
work from the clean-sheet CO project back to finishing this AO fork.
**Status**: implementation complete; final headless-profile verification is recorded in §5.

---

## 1. Authorized scope

The directive to finish AO trimming authorizes removal of capabilities already classified `retire candidate` by the
frozen Phase −1 policy. It does not silently convert `unknown` or `retain — used/active` capabilities into removal
candidates.

This execution therefore retains:

- Claude Code, Codex, Gemini, and OpenCode;
- tmux and Herdr;
- worktree workspaces;
- GitHub tracker/SCM/lifecycle;
- desktop notification;
- core, CLI, supervisor/lifecycle, integration tests, and internal adapter interfaces; and
- runtime-native `ao session attach` through tmux or Herdr as the human session path.

No production session, archive, worktree, tmux session, Herdr workspace, or configuration was mutated or cleaned.

## 2. Removed package slice

The following twelve package trees had zero live dependency, zero required-restoration dependency, and zero
corroborated use in the frozen window. They were removed together with their direct CLI/web/integration consumers:

```text
packages/plugins/agent-aider
packages/plugins/agent-cursor
packages/plugins/runtime-process
packages/plugins/workspace-clone
packages/plugins/tracker-linear
packages/plugins/tracker-gitlab
packages/plugins/scm-gitlab
packages/plugins/notifier-composio
packages/plugins/notifier-discord
packages/plugins/notifier-openclaw
packages/plugins/notifier-slack
packages/plugins/notifier-webhook
```

The later headless decision in §3 reduces the workspace to 15 projects: the root plus 14 packages. The CLI, core
built-in registry, lockfile, integration-test manifest, Changesets group, generated config help, and retained tests
now agree on the reduced profile.

## 3. Removed distribution workflow slice

The following code-only distribution surfaces also had no observed use and were retired:

- `ao setup openclaw` and its probe, credential injection, doctor special case, and tests;
- the root `openclaw-plugin/`, its bundled OpenClaw skill/config reference, setup guide, and deployment restart hook;
- `ao plugin ...` marketplace installation, update, search, and scaffolding;
- the bundled/remote marketplace catalog and AO-managed npm plugin store;
- `ao update` and `scripts/ao-update.sh`.

On 2026-08-11 the operator explicitly resolved the two remaining UI unknowns: remove the dashboard and both bundled
terminal packages. That decision retired:

- `packages/web`, including its Next.js UI, API/SSE routes, WebSocket/PTY servers, tests, screenshots, and build
  dependencies;
- `packages/plugins/terminal-iterm2` and `packages/plugins/terminal-web`, plus their integration tests;
- `ao dashboard`, `ao open`, dashboard startup/stop/running-state helpers, browser-opening behavior, and `ao spawn
--open`;
- the standalone `scripts/claude-dashboard` launcher and dashboard-specific deployment, CI, coverage, setup, and
  package-install hooks; and
- the `node-pty` rebuild/permission hooks that existed only for the browser terminal.

`ao start` now launches only the lifecycle worker and optional orchestrator. Spawn, restore, and start output direct
the operator to `ao session attach <session-id>`. A hidden `ao start --no-dashboard` no-op remains solely so old
automation does not fail during migration. Legacy YAML port keys and archived `dashboardPort` metadata remain
readable but are ignored, preserving compatibility with existing config and archive inspection.

The internal plugin interfaces and registry remain. Advanced `plugins:` entries may point to an already installed
npm package or a built local entrypoint. AO does not install, update, or scaffold those plugins, and `source:
registry` is no longer accepted.

## 4. Fail-closed compatibility behavior

- Existing native config that names a removed built-in does not fall back to another plugin; resolution fails with
  the missing identity.
- URL config generation accepts the retained GitHub SCM/tracker path. GitLab, Bitbucket, and unknown hosts fail
  explicitly instead of generating an unavailable plugin or silently selecting GitHub.
- Existing sessions continue to resolve their persisted agent/runtime identity. No removed identity appeared in the
  production live/archive inventory.
- Historical design and development notes remain as provenance. Current README, setup, CLI, config example, core
  README, and contributor architecture docs describe the retained distribution.

## 5. Test-state isolation and baseline repair

`packages/core/src/paths.ts` now centralizes the state root:

- production default: `~/.agent-orchestrator`;
- explicit override: `AO_STATE_ROOT`; and
- `NODE_ENV=test`: per-process `/tmp/.../.agent-orchestrator` root.

Project state, observability state, and recovery logs use the isolated root. This prevents future unit/integration
test failures from adding synthetic roots to production evidence. No historical synthetic root was deleted.

The three pre-existing core failures were stale prompt string assertions. The actual prompt already enforced source
delegation, `ao send`, raw-tmux messaging prohibition, and worker PR takeover. The assertions now test that current
contract.

Verification after the final headless implementation:

| Gate                               | Result                                         |
| ---------------------------------- | ---------------------------------------------- |
| Workspace build                    | passed across the 14-project recursive scope   |
| Workspace typecheck                | passed across the 14-project recursive scope   |
| Aggregate suite                    | 1,798 passed; 20 intentionally skipped         |
| Runtime-native attach focused test | 30/30 passed, including tmux and Herdr paths   |
| ESLint                             | 0 errors; 6 pre-existing warnings              |
| Prettier plus `git diff --check`   | touched files formatted; no whitespace errors  |
| Built CLI help/config smoke test   | passed; no retired commands/options advertised |

The aggregate suite also exposed stale tests that still spied on `console.log`/`console.warn` after retained
plugins had migrated to the log-level-aware `pluginLog` path. Those assertions now exercise stderr with an explicit
test log level; no production logging behavior changed.

## 6. Conditional decisions still required

These were not decided by code changes above:

1. preserve the evidenced GitHub issue/PR/CI/review lifecycle or declare it superseded;
2. keep desktop notification or migrate to pull-only status;
3. keep Gemini or explicitly replace its April/June use cases;
4. approve metadata-only inspection as the legacy archive policy;
5. fast-forward `main` to the verified trim tip after commit; and
6. separately authorize any cleanup of the 1,174 historical synthetic roots.

Under the frozen evidence policy, GitHub, desktop, and Gemini remain retained unless explicitly replaced. The
dashboard and terminal-package unknowns are closed by the explicit operator decision above.
