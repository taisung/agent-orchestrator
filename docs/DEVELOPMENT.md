# Development Guide

Architecture overview, code conventions, and patterns for contributors and AI agents working on this codebase.

## Architecture Overview

Agent Orchestrator is a headless monorepo with four package groups:

```
packages/
├── core/          # Types, services, config — the engine
├── cli/           # `ao` command (depends on core + retained plugins)
├── ao/            # Thin global CLI wrapper
├── integration-tests/
└── plugins/       # 10 retained plugin packages
```

**Build order matters**: core must be built before the CLI or plugins.

### Plugin slots

Every abstraction is a swappable plugin. All interfaces are defined in [`packages/core/src/types.ts`](../packages/core/src/types.ts).

| Slot      | Interface   | Default       | Alternatives                  |
| --------- | ----------- | ------------- | ----------------------------- |
| Runtime   | `Runtime`   | `tmux`        | `herdr`                       |
| Agent     | `Agent`     | `claude-code` | `codex`, `gemini`, `opencode` |
| Workspace | `Workspace` | `worktree`    | —                             |
| Tracker   | `Tracker`   | `github`      | —                             |
| SCM       | `SCM`       | `github`      | —                             |
| Notifier  | `Notifier`  | `desktop`     | —                             |
| Terminal  | `Terminal`  | none          | compatibility interface only  |
| Lifecycle | —           | (core)        | Non-pluggable                 |

### Hash-Based Namespacing

All runtime data paths are derived from a SHA-256 hash of the config file directory:

```typescript
const hash = sha256(path.dirname(configPath)).slice(0, 12); // e.g. "a3b4c5d6e7f8"
const instanceId = `${hash}-${projectId}`; // e.g. "a3b4c5d6e7f8-myapp"
const dataDir = `~/.agent-orchestrator/${instanceId}`;
```

`AO_STATE_ROOT` replaces the root when explicit isolation is needed. Under `NODE_ENV=test`, paths automatically
use a per-process root under `/tmp` so fixtures never pollute live AO evidence.

This means:

- Multiple orchestrator checkouts on the same machine never collide
- Session names are globally unique in tmux: `{hash}-{prefix}-{num}`
- User-facing names stay clean: `ao-1`, `myapp-2`

### Session Lifecycle

```
spawning → working → pr_open → ci_failed
                             → review_pending → changes_requested
                             → approved → mergeable → merged
                                                    ↓
                             cleanup → done (or killed/terminated)
```

Activity states (orthogonal to lifecycle): `active`, `ready`, `idle`, `waiting_input`, `blocked`, `exited`.

### Key Services

| File                                     | Purpose                                         |
| ---------------------------------------- | ----------------------------------------------- |
| `packages/core/src/session-manager.ts`   | Session CRUD: spawn, list, kill, send, restore  |
| `packages/core/src/lifecycle-manager.ts` | State machine, polling loop, reactions engine   |
| `packages/core/src/prompt-builder.ts`    | 3-layer prompt assembly (base + config + rules) |
| `packages/core/src/config.ts`            | Config loading and Zod validation               |
| `packages/core/src/plugin-registry.ts`   | Plugin discovery, loading, resolution           |
| `packages/core/src/agent-selection.ts`   | Resolves worker vs orchestrator agent roles     |
| `packages/core/src/observability.ts`     | Correlation IDs, structured logging, metrics    |
| `packages/core/src/paths.ts`             | Hash-based path and session name generation     |

---

## Getting Started

**Prerequisites**: Node.js 20+, pnpm 9.15+, Git 2.25+

```bash
git clone https://github.com/taisung/agent-orchestrator.git
cd agent-orchestrator
pnpm install
pnpm build
cp agent-orchestrator.yaml.example agent-orchestrator.yaml
$EDITOR agent-orchestrator.yaml
```

### Project structure

```
agent-orchestrator/
├── packages/
│   ├── core/              # Core types, services, config
│   ├── cli/               # CLI tool (ao command)
│   ├── ao/                # Global CLI wrapper
│   ├── plugins/           # All plugin packages
│   │   ├── runtime-*/     # Runtime plugins (tmux, herdr)
│   │   ├── agent-*/       # Agent adapters (claude-code, codex, gemini, opencode)
│   │   ├── workspace-*/   # Worktree workspace provider
│   │   ├── tracker-*/     # GitHub issue tracker
│   │   ├── scm-github/    # SCM adapter
│   │   ├── notifier-*/    # Notification channels
│   └── integration-tests/ # Integration tests
├── agent-orchestrator.yaml.example
└── docs/                  # Documentation
```

---

## Development Workflow

1. **Create a feature branch**

   ```bash
   git checkout -b feat/your-feature
   ```

2. **Make your changes** — follow conventions below, add tests, update docs

3. **Build and test**

   ```bash
   pnpm build && pnpm test && pnpm lint && pnpm typecheck
   ```

4. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/)

   ```bash
   git commit -m "feat: add your feature"
   ```

   Pre-commit hook scans for secrets automatically.

5. **Push and open a PR**

---

## Keeping the local AO install current

This personal fork does not ship `ao update`. Refresh the checkout and build it with ordinary repository tooling:

```bash
git switch main
git status --short --branch
git pull --ff-only
pnpm install
pnpm build
pnpm typecheck
pnpm test
(cd packages/ao && npm link)
```

Do not run the pull step with a dirty checkout, and do not use this recipe to overwrite an installed feature branch
that the active fleet still depends on.

---

## Code Conventions

### TypeScript

```typescript
// ESM modules only — all packages use "type": "module"
// .js extension required on local imports
import { foo } from "./bar.js";
import type { Session } from "./types.js";

// node: prefix for builtins
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

// No `any` — use `unknown` + type guards
function processInput(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected string");
  return value.trim();
}

// Type-only imports for type-only usage
import type { PluginModule, Runtime } from "@aoagents/ao-core";
```

Formatting: semicolons, double quotes, 2-space indent, strict mode.

### Shell Commands

These rules prevent command injection. Follow them exactly.

```typescript
// Always execFile (never exec — exec runs a shell, enabling injection)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

// Always pass arguments as an array (never interpolate into strings)
await execFileAsync("git", ["checkout", "-b", branchName]);

// Always add timeouts
await execFileAsync("gh", ["pr", "create", "--title", title], {
  timeout: 30_000,
});

// Never use JSON.stringify for shell escaping — use the array form
// ❌ Bad
await execFileAsync("sh", ["-c", `git commit -m "${message}"`]);
// ✅ Good
await execFileAsync("git", ["commit", "-m", message]);
```

---

## Plugin Pattern

A plugin exports a `manifest`, a `create()` factory, and a default `PluginModule` export.

```typescript
// packages/plugins/runtime-myplugin/src/index.ts
import type { PluginModule, Runtime } from "@aoagents/ao-core";

export const manifest = {
  name: "myplugin",
  slot: "runtime" as const,
  description: "My custom runtime",
  version: "0.1.0",
};

export function create(): Runtime {
  return {
    name: "myplugin",
    async create(config) {
      /* start session */
    },
    async destroy(sessionName) {
      /* tear down */
    },
    async send(sessionName, text) {
      /* send input */
    },
    async isRunning(sessionName) {
      return false;
    },
  };
}

export default { manifest, create } satisfies PluginModule<Runtime>;
```

**Plugin package setup** — `package.json`:

```json
{
  "name": "@aoagents/ao-plugin-runtime-myplugin",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest"
  },
  "dependencies": {
    "@aoagents/ao-core": "workspace:*"
  }
}
```

After creating the package, add it to `packages/cli/package.json` and register it in `packages/core/src/plugin-registry.ts` inside `loadBuiltins()`.

---

## Spawn Flow

`session-manager.ts:spawn()` is the core path most features touch:

```
spawn(config)
  ├─ Validate issue (Tracker.getIssue) — fails fast, no resources created yet
  ├─ Reserve session ID
  ├─ Determine branch name
  ├─ Create workspace (Workspace.create)
  ├─ Generate issue prompt (Tracker.generatePrompt)
  ├─ Build agent launch command (Agent.getLaunchCommand)
  ├─ Assemble full prompt (prompt-builder.ts)
  ├─ Create runtime session (Runtime.create)
  ├─ Post-launch setup (Agent.postLaunchSetup, optional)
  └─ Write metadata file → return Session
```

If issue validation fails, nothing is created — fail before allocating resources.

---

## Prompt Assembly

Prompts are built in three layers (`packages/core/src/prompt-builder.ts`):

1. **Base agent guidance** — standard instructions for all sessions (git workflow, PR conventions, lifecycle hooks)
2. **Config context** — project-specific info (repo, branch, issue details, agent rules from `agentRules` / `agentRulesFile`)
3. **User rules** — inlined last, highest priority

Orchestrator sessions use a separate prompt from `packages/core/src/orchestrator-prompt.ts`.

---

## Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @aoagents/ao-core test

# Watch mode
pnpm --filter @aoagents/ao-core test -- --watch

# Integration tests
pnpm test:integration
```

Key test files in core (`src/__tests__/`):

- `session-manager.test.ts` — session CRUD and spawn flow
- `lifecycle-manager.test.ts` — state machine and reactions
- `plugin-registry.test.ts` — plugin loading and resolution
- `prompt-builder.test.ts` — prompt generation

Use mock plugins in tests — don't call real tmux or external services in unit tests.

---

## Common Development Tasks

### Add a field to Session

1. Edit `Session` interface in `packages/core/src/types.ts`
2. Initialize the field in `spawn()` in `session-manager.ts`
3. Rebuild: `pnpm --filter @aoagents/ao-core build`

### Add a new reaction

1. Add handler in `packages/core/src/lifecycle-manager.ts`
2. Wire it up in the polling loop
3. Add config schema in `packages/core/src/config.ts` if needed

### Add a new event type

1. Extend `EventType` union in `packages/core/src/types.ts`
2. Emit it via `eventEmitter.emit()` in the relevant service
3. Handle it in `lifecycle-manager.ts` if it should trigger a reaction

### Add a new CLI command

1. Add the command in `packages/cli/src/index.ts` using `commander`
2. Import from core services as needed
3. Update the CLI reference in `README.md`

### Debug a session

```bash
# Inspect raw metadata
cat ~/.agent-orchestrator/{hash}-{project}/sessions/{session-id}

# Inspect through the CLI and attach using the persisted runtime identity
ao status
ao session attach {session-id}

# Enable verbose logging
AO_LOG_LEVEL=debug ao start
```

---

## Working with Git Worktrees

This project uses itself to develop itself — agents work in git worktrees:

```bash
# Create a worktree for a feature branch
git worktree add ../ao-feature-x feat/feature-x
cd ../ao-feature-x

# Install and build in the worktree
pnpm install
pnpm build

# Copy config
cp ../agent-orchestrator/agent-orchestrator.yaml .

# Exercise the built CLI
node packages/cli/dist/index.js --help
```

---

## Security During Development

Pre-commit hooks scan for secrets automatically on every commit. If triggered:

1. Remove the secret from the file
2. Use environment variables: `${SECRET_NAME}`
3. Store real values in `.env.local` (gitignored)

To manually scan:

```bash
gitleaks detect --no-git   # scan current files
gitleaks protect --staged  # scan staged files (same as pre-commit)
```

To allow a false positive, add it to `.gitleaks.toml`:

```toml
[allowlist]
regexes = ['''your-pattern-here''']
```

---

## Environment Variables

```bash
# User integrations
GITHUB_TOKEN=ghp_...
ANTHROPIC_API_KEY=sk-ant-api03-...

# State isolation (tests do this automatically)
AO_STATE_ROOT=/absolute/private/root
```

Store secrets outside tracked files. Never commit real values.

---

## Key Design Decisions

**Why flat metadata files instead of a database?**
Debuggability: `cat ~/.agent-orchestrator/a3b4-myapp/sessions/ao-1` shows full state. No database to spin up, no schema to migrate, survives crashes.

Record writes (`packages/core/src/metadata.ts`): every Node writer holds the record lock (in the same file: a Linux abstract Unix socket that the kernel frees when the process ends, so no lock file can stay behind) for its read, compare, write and rename, and every write of a record file increments the record key `generation`: an update, a full write, a reservation and a write of an archived copy. The archive copy that a kill or a cleanup makes keeps the generation of the version that it copies. No writer stores a `generation` that its caller passes. The active records of a session ID never repeat a generation: a record that starts (a reservation, an archive copy-back, a full write over a missing record) continues above the larger of the latest archived copy and the generation floor `<sessions>/.generations/<id>`, which every delete (with or without an archive) raises to the deleted generation before it removes the file. Each archived copy has its own series: it starts at the generation that it copies, and an archive write adds 1 without the floor and without the active record, so a number can be both an active record's and an archived copy's. A compare reads one file and so compares within one series; every compare that uses the generation reads the active record. No reader lists the floor directory as a session (dot names are skipped by `listMetadata` of this and earlier builds; the archive readers need `<id>_<digit>`; the bash helpers write only `<sessions>/<id>`). An earlier build does not raise the floor and writes records without a generation, so every compare that any Node write must cancel also compares the launch identity. The lock holds only one read-compare-write. An operation that reads a record, awaits a slow step (a checkout, `runtime.create`, a probe, a network call) and then writes passes the values that it decided from, and writes nothing (it fails, or skips the write) when the record no longer holds them: the lifecycle poll, the repair on read, a PR claim and the recovery actions compare the `generation` plus the launch identity (any other write since the read stops them); an automatic cleanup kill compares the facts of its decision (`pr`, `issue`, `status`) plus the launch identity; spawn, the orchestrator start, restore, a direct kill, remap and the archive marks compare the launch identity (`launchIdentity`: the reservation ID `reservationId`, `runtimeHandle`, `tmuxName`, `createdAt`, `restoredAt`), so only an archive, a new reservation or another launch or restore of the ID stops them, not a status or bookkeeping write. Every reservation has its own random `reservationId` (the first launch write removes it), so a spawn tells its reservation from a new one of the same ID. Only a reservation (`reserveSessionRecord`: also the archive copy-back of a restore, never over an existing record) and an explicit full write (`writeMetadata`) create a record; `updateMetadata` and the conditional writers never create or recreate one. Each removal of session state (a runtime destroy, a worktree destroy, a record delete or archive, an agent-session removal, a delivery-ledger removal) reads the current record (and, where it matters, the latest archive and the other records that name the same agent session) again directly before the step, with no `await` between the check and the step except the step itself. A retry or a wait inside a step counts as an `await`: each OpenCode removal attempt has its own check, and a ledger removal checks again after it holds the ledger lock (a kept ledger keeps its key `opencodeLedgerPending` in the archive). This reaches into the plugins: core passes its check to `Workspace.destroy` (`stillOwned`) and to `PreparedAgentSession.discard` (`stillUnheld`), and the plugin runs it again directly before each of its own removal calls (the worktree plugin before `git worktree remove` and before its `rmSync` fallback; the OpenCode plugin before the interrupt and before each removal attempt). A check that answers no or throws keeps the resource: `destroy` resolves `"kept"` (a kill then throws, a recovery cleanup fails with its record-changed error, a rollback leaves the worktree to the new launch), and `discard` keeps the session and names it to the operator. The orchestrator start with the `delete` strategy skips its own ID when it compares the records that name a stored OpenCode session, so each removal attempt also needs that ID's record to be still the start's own reservation. Two other kinds of removal read no record: a resource that only the call owns (a temp file, a tmux paste buffer, a helper process and its temp directory) and ledger compaction under the ledger lock (an empty ledger, the expired-ledger sweep). The exported raw `killTmuxSession` reads no record either; no core path calls it (the managers destroy runtimes through the runtime plugins). A spawn or restore that finds its record changed stops its own new runtime only when the record read directly before the destroy is gone or is a launched record that names another runtime (a reservation, or a record that names the same runtime by handle or tmux name, may own it: a tmux name is the same for every launch of an ID); otherwise the runtime stays and the error or warning names it. The worktree goes only when the record is still the launch's own or gone, and the prepared agent session only when neither the record now there nor the latest archive names it. A destroy by tmux name keeps one window that no record compare can close: between the last record read and the tmux command (the kill's runtime destroy and restore step 7). Two limits: the bash metadata helpers (`~/.ao/bin/ao-metadata-helper.sh` and the claude-code PostToolUse hook) write `pr`, `status` and `branch` with `sed` and `mv` outside the lock and without a new generation, so a helper write and a Node write can still overwrite each other between the read and the rename of either (the lifecycle compares `pr` and `status` too, which catches a helper write that came before its locked read). On a platform without abstract sockets (not Linux) the writers run without the lock.

**Why polling instead of webhooks?**
Simpler local setup (no ngrok), survives orchestrator restarts, works offline. CI/review state is fetched, not pushed.

**Why plugin slots?**
The retained adapters stay mockable and runtime-independent without shipping a marketplace or every historical
implementation. Explicit external npm/local descriptors are advanced, manually installed configuration.

**Why hash-based namespacing?**
Multiple orchestrator checkouts on the same machine don't collide in tmux or on disk. Different checkouts get different hashes; projects within the same config share a hash.

**Why ESM with `.js` extensions?**
Node.js ESM requires explicit extensions on local imports. All packages use `"type": "module"`. Missing extensions cause runtime errors.

---

## Resources

- [`packages/core/README.md`](../packages/core/README.md) — Core service reference
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — Hash-based namespace design
- [`SETUP.md`](../SETUP.md) — Installation and configuration reference
- [`SECURITY.md`](../SECURITY.md) — Security practices
- [`agent-orchestrator.yaml.example`](../agent-orchestrator.yaml.example) — Full config reference
