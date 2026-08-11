# AGENTS.md

> Full project context, architecture, conventions, and plugin standards are in **CLAUDE.md**.

## Commands

```bash
pnpm install                            # Install dependencies
pnpm build                              # Build all packages
pnpm typecheck                          # Type check all packages
pnpm test                               # All tests
pnpm lint                               # ESLint check
pnpm lint:fix                           # ESLint fix
pnpm format                             # Prettier format
```

## Architecture TL;DR

Headless pnpm monorepo with `core`, `cli`, `ao`, `integration-tests`, and retained packages under `plugins/*`.
Configuration flows through core's `loadConfig()` into the plugin registry, session manager, lifecycle worker, and
desktop notifier. Humans inspect and enter sessions with `ao status` and `ao session attach`. See CLAUDE.md for the
full architecture and plugin compatibility notes.

## Key Files

- `packages/core/src/types.ts` — All plugin interfaces (Agent, Runtime, Workspace, etc.)
- `packages/core/src/session-manager.ts` — Session CRUD
- `packages/core/src/lifecycle-manager.ts` — State machine + polling loop
- `packages/cli/src/program.ts` — CLI command registration
- `packages/cli/src/commands/start.ts` — Headless startup and shutdown
