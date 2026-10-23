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

### tmux Targets

Every tmux `-t` target goes through the core helpers `exactSessionTarget(name)` (`=name`, for
`has-session`, `kill-session` and `attach`) and `exactPaneTarget(name)` (`=name:`, for `list-panes`,
`send-keys`, `paste-buffer`, `capture-pane` and `display-message`). tmux 3.4 tries a plain target as an
exact name and then as the start of one session name, so while `kr-1` is dead, the target `kr-1` reaches a
live `kr-10`: a send types into it and a kill ends it. `=` matches the name exactly. A window or pane
target also needs the colon: without it, tmux first tries `=name` as a window name in the current
session. Both helpers throw for a name outside `[a-zA-Z0-9_-]` (also the empty name), because tmux reads
a dot or a colon in a target as a separator. For a target that does not exist, `display-message` prints
empty values and exits 0, so its callers read empty output as "gone", not as "unknown".

### `ao send` to a tmux pane

`ao send` clears the input line with `C-u`, types a message of up to 200 characters with no line break
with `send-keys -l`, and pastes a longer one with `load-buffer` and `paste-buffer -p`. `-p` puts the
bracketed-paste markers around the text when the pane's program asked for them (Claude Code, Codex and
Gemini do), so a line break in the text is not an Enter. `Enter` follows 300 ms later. Then the command
reads the pane up to three times, 2 s apart.

A Codex pane gets no further key: an `Enter` can submit text that another sender typed, or answer a
prompt. At each check the command first asks the Codex `detectActivity`, then reads the screen with
`readCodexScreen` of the Codex plugin, the parser that `detectActivity` uses too. It prints one of four
lines:

- `detectActivity` answers `waiting_input` (an approval prompt): "Message sent — the pane waits for an
  approval: check `<session>` (tmux pane `<pane>`)". This check comes before every other reading.
- The status block of a running turn is directly above the composer: "Message sent and processing".
- After the third check the composer still holds text that starts like the message, or a
  `[Pasted Content ...]` block: "Message not submitted: the text is still in the input box of
  `<session>` (tmux pane `<pane>`); check the pane and press Enter". The text match only chooses this
  line, and text of another sender can match. Capture the pane before you press `Enter`.
- Every other case (an empty composer with no running turn, other text, no composer in view, an unclear
  layout): "Message sent — could not confirm it was received". An emptied composer is no proof of
  delivery, and words on the screen are never "processing".

The exit code is 0 for all four lines (this change keeps the exit codes). Every other agent (Claude
Code, Gemini, OpenCode on the tmux path) uses one loop. At each check its `detectActivity` goes first:

- `waiting_input` (a dialog or a permission prompt): "Message sent — the pane waits for an answer: check
  `<session>` (tmux pane `<pane>`)", no key, exit code 0. An `Enter` there would answer the prompt with
  the option under the cursor.
- `active`: "Message sent and processing".
- Every other answer keeps the rules of `09546110`: "Message queued (session finishing previous task)"
  for `Press up to edit queued messages`, else one retry `Enter` after checks 1 and 2 (one at each check
  for a prompt with text above `tab to queue message`), and "Message sent — could not confirm it was
  received" after check 3. A retry `Enter` goes to a screen that read as not waiting; a dialog that
  opens after that read still gets it.

The Codex parser reads the composer at its own position: the prompt row with `›` in column 0, with only
indented or blank rows below it. Codex indents the further rows of the composer text by 2 columns, so an
indented `›` row is message text. A numbered prompt row is the cursor of a selection list only when a
numbered option row is next to it and the list shows a sign of a menu: a key hint such as `(y)` at the
end of a list row, an approval label (a list row that starts with `Yes,` or `No,`, as in
`No, and tell Codex what to do differently`), or a hint row below the list
(`Press enter to confirm or esc to go back`, `Press a number to choose · esc to dismiss`). Otherwise a
numbered list is composer text. The footer hint
`? for shortcuts` (empty composer) counts only in the last row, below a blank row under a one-row
composer. A running turn is only the status block of 0.163.0 directly above the prompt row, in this
order: the status row (a bullet `•` or `◦` in column 0, a word, `esc to interrupt` in parentheses, and
any text after the `)`, as in `• Working (3m 14s • esc to interrupt) · 2 background terminals running`),
then at most two `└` rows (two spaces, `└` and a space at the start of the row: the Tip row, and a
command row while Codex waits for a background terminal), then at most two blank rows. Six real captures of a running 0.163.0 pane
(`packages/plugins/agent-codex/src/__fixtures__/codex-0.163.0-running-01.txt` to `-06.txt`) set these
bounds: each one has two blank rows, and 0, 1 or 2 `└` rows. A row of any other kind between the
status row and the prompt row (a `Worked for` row, `+ Show details`, text) ends the block, so the
status row is then a transcript row. The words of the composer text, of the footer and of the
transcript ("Working tree clean.") never count. With no composer in view the parser reads no running
turn, and `detectActivity` keeps its older rules for that screen (a running word or `esc to interrupt`
in the last 8 rows is `active`). The idle wait before a send (without `--no-wait`) and the activity log
(`recordActivity`) read the same answer, so a running turn makes the send wait.

Limits of the status-block rule, with no real capture to check them:

- A status row that wraps in a narrow pane, or a queued message that Codex draws between the status
  block and the composer, puts a row of another kind into the block. The pane then reads as idle: the
  idle wait sends at once, `recordActivity` records `idle`, and the send never prints "processing" (it
  prints "could not confirm", or "not submitted" when the composer holds the message). The tests do not
  cover these layouts.
- A transcript row in the status-row form, followed by at most two `└` rows and at most two blank rows
  directly above the composer, reads as a running turn. The parser cannot tell it from a real status
  block. No real capture has this layout: in the two real idle captures, a `Worked for` row ends the
  finished turn.

### Claude Code screens (2.1.304 to 2.1.307)

The claude-code `detectActivity` reads the structure of the screen, not words. From the bottom, Claude
Code draws the footer (`⏵⏵ bypass permissions on (shift+tab to cycle)` in every session that ao starts:
a mode, not a prompt) and the status line, then the input box: a rule row (`─` only), the prompt row
(`❯` and a no-break space, then the input), a rule row. The plugin finds the box as the last rule row
with at most 4 rows below it, the rule row above it, and the prompt row directly below that one.

- With the box in view, the first column-0 row above it decides. Blank rows, indented rows (a `⎿  Tip:`
  row, the right-aligned token, effort, auto-compact and `Ctrl+Y` rows) and the rows of a panel note
  (`╭`, `│`, `╰`, the diff-panel note) are skipped. A spinner row (a spinner frame `·`, `✢`, `✳`, `✶`,
  `✻`, `✽` or `*`, a word that ends in `…`, then `(` and a time, as in
  `✻ Waddling… (15s · ↓ 692 tokens · thinking with xhigh effort)`) is `active`. Any other row (the
  `✻ Brewed for 4s · done` row of a finished turn, `●` for a message or a tool call, `❯` for a user turn)
  is `idle`. A transcript entry starts at column 0 and indents its other rows, so a spinner row, a
  prompt or a footer that a message quotes, and any text in the input box, do not change the answer.
- With no box in view, an open dialog is `waiting_input`: the last row that starts with `❯` is a cursor
  on a numbered choice (`❯ 1. Red`), a rule row (the top edge of the dialog) is above the cursor with no
  transcript entry (a `●` or `❯` row at column 0) between them, the dialog shows another numbered choice,
  and no `●` row follows the cursor. A numbered list that a message or a user turn quotes has no such
  rule row above it, or its entry row lies between, so it reads as the same screen without the list. The
  older rules stay for screens with no box: a bare prompt on the last row is `idle`,
  `Do you want to proceed?` or `(Y)es ... (N)o` in the last 5 rows is `waiting_input`, and everything
  else is `active`.

So a regular `ao send` sends at once to an idle pane, waits while a turn runs (and sends at the timeout
with "Sending anyway"), and waits at a dialog and refuses at the timeout with exit code 1 and no key.
After the send, a running turn prints "processing" at the first check, and a dialog prints the
waits-for-an-answer line. The fixtures are in `packages/plugins/agent-claude-code/src/__fixtures__/`:
real 2.1.306 and 2.1.307 panes (idle, idle with `paste again to expand`, running, running with the
diff-panel note) and 2.1.304 fullscreen captures (dialogs, running and idle screens).

Limits, with no real capture to check them:

- No real capture of a 2.1.30x permission prompt exists. Its `waiting_input` answer comes from the
  numbered-choice rule and a derived test.
- A row of another kind at column 0 between the spinner row and the box (for example a queued message,
  if Claude Code draws it at column 0) makes a running pane read `idle`. A spinner row with no time, a
  spinner word with `…` inside it, or a spinner row that wraps in a narrow pane reads as no spinner row.
- The bash-mode `!` prompt, the slash-command menu and more than 4 rows below the box hide the box, and
  the screen then reads by the older rules (mostly `active`).
- An old spinner row at column 0 that only blank or indented rows separate from the box reads `active`.

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

## Session relaunch (2026-10-22)

`ao session relaunch <id> [--continue]` (`relaunch` in `packages/core/src/session-manager.ts`, the command in `packages/cli/src/commands/session.ts`) starts the agent of a session again in its existing tmux pane after the agent process ended (Claude Code: `/exit`), for example to run a newer installed agent. It builds the launch command and the environment now, as `restore` does: the agent, runtime handle and spawn `model=` of the record (C-04), the persisted worker `permissions=`, and for an orchestrator the permissionless mode and a new orchestrator prompt in `orchestrator-prompt-<id>.md` (`--append-system-prompt "$(cat <file>)"`). It writes one launch script (`$TMPDIR/ao-launch-<uuid>.sh`, mode 0700, removed when it runs; a script that never runs, after a timeout or a SIGKILL of `ao`, stays) that changes to the workspace, exports `getEnvironment` plus the `AO_*` keys of a spawn, and runs the command. When the command is one simple command (Claude Code), the script runs it with `exec`, so the agent replaces the script's bash. Linux only: the shell, caller and hook checks read `/proc`; without it the relaunch refuses. No other OS was tested.

The agent's pane: the pane that the last relaunch stored (`launchPane`, bound to the last launch time), else the only pane of the tmux session. A session with several panes that no relaunch named is refused (close the other panes first). A stored pane that no longer exists is refused before the claim, with no key sent (review r2 M-4): start the agent by hand in a pane of the session, or restore the session. The one-pane rule is only for a record that binds no pane. Every tmux call from the check to the Enter targets that pane ID (`%N`), so a change of the selected window or pane cannot redirect the text. Every reader of the agent uses the bound pane too (review r2 M-1): core puts it into the session's runtime handle in memory (`RuntimeHandle.data.agentPane`, never stored), and the process checks of claude-code, codex and gemini, their activity reads, runtime-tmux `getOutput` and `sendMessage` (the lifecycle's output and messages) and the readiness check of a session-manager send read that pane, not the session's current window. A tmux pane keeps its ID when it moves to another session (`join-pane`, `move-pane`), so the bound pane counts as the agent's pane only while it belongs to the session's tmux session (review r3 M-3): a pane that is gone, or that now belongs to another session, reads as "agent not running" in the process checks, gives no output to runtime-tmux `getOutput` (so the lifecycle records no activity from it), is "gone" for the readiness check of a session-manager send, and makes runtime-tmux `sendMessage` reject with no key sent. `getOutput` reads the pane's session and its rows in one tmux call (`display-message ... ; capture-pane`), so the pane cannot move between them. `sendMessage` checks the pane (`list-panes -t %N`) before its first key and again before its Enter; a pane that moves after a check and before the next key still gets that key, and a pane that moves after the text and before the Enter keeps the typed text without an Enter (the send then rejects with "the message was typed but not submitted"). The `ao send` path that types straight into a live tmux session (`packages/cli/src/commands/send.ts`) uses the bound pane too: it waits for the agent and reads the screen on that pane, types only into it, and checks it the same way before the wait, before its first key, before its Enter and before each further Enter. A moved, gone or unknown pane gives "Message not sent to <id>: <reason>" (or "Message typed into <id> but not submitted (no Enter)", or "Message sent to <id>, but no further Enter was pressed") and exit 1; it never falls back to the current pane. A session that no relaunch bound is read and sent to as before (the current window). As a moved pane reads as "agent not running", the lifecycle marks the session `killed` (`agent-exited`) at its second poll and runs that reaction while the moved agent still runs in the other session (measured by review r4): when you recover such a session, account for both processes.

Two callers, found only by comparing the caller's terminal (`/proc/self/fd/0`, else 2, else 1) with the pane's `#{pane_tty}` (never by `AO_SESSION` or `TMUX`):

- From another shell: the pane's own shell must wait for input (its process group is the foreground group of the pane's terminal, from `/proc/<pane_pid>/stat`). `Runtime.runInPane` checks that again, ends a copy mode, and sends C-c. That proves only that the shell owns the terminal, not that it drops its input on C-c, so it types nothing until it has evidence of a fresh, empty input line (review r2 M-2): after the first C-c the cursor row must be a prompt with nothing after the cursor and nothing below; after a second C-c that prompt must show the echo `^C` (or no echo) and the same prompt must stand on a later row, with the rows above it equal to those before, scrolled by the lines that the history gained (when the history is full, exactly one scroll must fit). A bash that drops its line on C-c gives that evidence at any cursor position and at a continuation (PS2) prompt, also with a prompt of two lines. A shell that ignores SIGINT (`trap '' INT`) leaves the screen as it is, and so does a SIGINT trap that reads input without printing a prompt (a consuming `read`): then nothing is typed, the relaunch reports that it could not start the agent (the end state "absent"), and the owner clears the line by hand. Then it types `bash '<script>'` and Enter.

Limit (review r3 M-1, not fixed; accepted for the landing by the owner on 2026-10-22): a SIGINT trap in the pane's shell that prints the prompt and reads input (for example `read -e -i`) passes the fresh-prompt check; prefilled text can run, or the launch line can be consumed. Relaunch only into a shell without such a trap. What can happen: the screen check takes the text that the trap prints for a prompt, so the relaunch types the launch line into the trap's `read`. With `read -e -i "<text>"` the prefilled text and the launch line run together as one command when the trap evaluates its input (measured by review r3: both marker files were made, and `runInPane` resolved). With a plain `read` the trap takes the launch line, the agent does not start, and the confirmation reports it absent, but whatever the trap does with the line has already happened. When: only in a pane whose shell has a SIGINT trap that prints a line equal to the prompt and then reads input. A shell without a SIGINT trap, and `trap '' INT`, are not affected. What the owner must avoid: a relaunch from another shell into such a pane. `trap -p INT` in the pane's shell prints its trap; remove it (`trap - INT`) or start the agent by hand there. The command exits 0 only when `isProcessRunning` is true within 15 s. That confirmation deadline covers `runInPane` and the process checks after it, which get only the time that is left. The preparation after the claim (the hook setup, the script) has its own 10 s bound, and `postLaunchSetup` another 10 s bound after the end state. The Claude Code plugin caches `ps` for 5 s, so the confirmation can take that long.

- From the session's own pane, as the foreground job: `ao` is the pane's foreground process, so typed keys would reach `ao`. It runs the script as its own child on the inherited terminal. The script execs the agent, so the child is the agent: `ao` ignores SIGINT and SIGQUIT (the terminal sends them to the agent too), passes SIGTERM and SIGHUP on to the agent, ends only after the agent ended, and exits with the agent's exit code. A launch command that is not one simple command (Gemini with a prompt file: `cp ... && gemini`) is refused here; relaunch it from another shell. An `ao` that runs in the background of its own pane (`&`; its process group is not the terminal's foreground group, from `/proc/self/stat`) does not own the terminal and is refused. The `ao` node process stays for the life of the agent (measured in scratch: 88 MiB to 91 MiB RSS for that `ao` process).

`--continue` resumes only the conversation that the agent of the session's last launch recorded. A spawn, an orchestrator start and a relaunch write a new launch token into the record (`launchToken`, with `launchTokenAt` equal to the launch's `createdAt` or `restoredAt`) and give it to the agent process alone (Claude Code: `env AO_LAUNCH_TOKEN=<token> claude ...`; never the tmux session environment, which every pane of the session inherits). The token is an identity binding against inherited environments, not a secret: it is in the record and the hook's side file (mode 0644 under a normal umask), in the agent's argv and environment, and in the launch script until it runs; any process of the same user can read it. A Claude Code `SessionStart` hook (`.claude/ao-session-start.sh`, an `async` entry with `timeout: 5` seconds, installed by `setupWorkspaceHooks` next to the PostToolUse hook) writes `<sessions dir>/.agent-conversations/<id>` at each start, resume, `/clear` and compact, only when the claude process has a launch token, no claude runs above it, and its stdin is the terminal of its tmux pane. It records the token and the pane ID. The hook takes the time of its event first (`EPOCHREALTIME`, the wall clock) and, under `flock` on a lock file next to the record, replaces the record only when it holds no later event (review r2 M-3): async hooks can end out of order, and an earlier startup or resume hook that ends after a later `/clear` hook changes nothing. The external steps have a 2 s budget each (`timeout` around cat, jq, grep, tmux, readlink, mkdir, mv and rm, and `flock -w 2`); without `timeout(1)` they run without one. The relaunch uses the record only when its token is exactly the token of the last launch, it was recorded in the agent's pane, and its transcript exists; else it refuses. A claude that someone starts in another pane or window has no token and writes nothing. A nested `claude -p` of the agent has the token, but the agent runs above it. A `restore` writes no token, so after a restore `--continue` is refused until a relaunch without `--continue`. It never takes the newest `.jsonl` (`getRestoreCommand` of `restore` still does). A session whose Claude Code started before this build has no usable record, so its first `--continue` is refused, and the relaunch without it starts a new conversation.

A hook of the launch's agent that cannot record its event tries to mark the records of that launch unusable (review r3 M-2): no `EPOCHREALTIME` (bash 5), no `flock`, a lock that stays busy for 2 s, a failed read of its input, of `/proc` or of tmux, an input without a conversation ID, a failed write or replace of the record, or a stop by SIGTERM, SIGHUP or SIGINT (a trap). It writes `<sessions dir>/.agent-conversations/.<id>.<launch token>.unusable` (a temp file, then mv) with the launch token, the reason and the pane. When that mark of the session's last launch exists, `--continue` refuses every record of that launch with that reason. Each launch has its own mark (review r4 M-1): the lookup reads only the mark whose name has the token of the last launch, so a late failed hook of an earlier launch writes its own mark and cannot remove or replace the mark of the current launch. Nothing removes a mark. The mark of a launch stays for that launch: a later event of the same agent that records does not remove it, so after one failed event `--continue` stays refused for that launch, and a relaunch without `--continue` (a new token) starts a new conversation. The marks of earlier launches stay on disk next to the record and the lock file (as these do after a kill) and do not count; as no code removes a mark, no cleanup can remove the mark of the current launch. A claude that is not the pane's agent (no token, a claude above it, another terminal) exits without a mark. A hook that cannot write the mark either, a hook that never starts, and a hook that SIGKILL stops leave no mark: see the limit of review r4 M-2 below. When Claude Code ends a hook at the `timeout: 5` of its entry, the hook writes the mark only if the signal is SIGTERM, SIGHUP or SIGINT; which signal Claude Code sends was not tested.

Limit (the residual of review r3 M-2, not fixed; accepted for the landing by the owner on 2026-10-22): the hook orders events by its own start time from the wall clock; a delay before the hook body starts, or a clock step back, can leave the older conversation as current. What can happen: `--continue` resumes the conversation from before a `/clear` (or another earlier conversation of the same launch) and reports success. When: the hook of an earlier event (start, resume) starts later than the hook of a later event (`/clear`, compact) of the same agent, which needs two events within about the delay of an async hook start (measured by review r3 with a 1.4 s delay and events 100 ms apart), or the system clock steps back (an NTP step, a manual change) between two events by more than the time between them. What the owner must avoid: `--continue` after two such events came within seconds of each other, or after a clock change during the agent's run; relaunch without `--continue` then and pick the conversation in the agent (Claude Code: `/resume`). The command prints the ID that it resumes (`Conversation: <id> (from <source>)`), but it does not stop for a wrong one.

Limit (review r4 M-2, not fixed; accepted for the landing by the owner on 2026-10-22): when the hook cannot publish its failure mark, the older conversation stays current, and `--continue` resumes it with no warning. What can happen: after a `/clear` (or another new conversation) whose hook could not record it and could not write the mark either, the record still names the earlier conversation of the same launch, and `ao session relaunch <id> --continue` resumes that earlier conversation and reports success (measured by review r4 and in round 5 with mode 0500 on the scratch `.agent-conversations` directory). When: a write failure that hits both the record and the mark, because both live in the same directory (a directory of the conversation records that the hook cannot write, a read-only or full file system, a quota); a hook that Claude Code never starts (no bash on the PATH, the settings entry removed or changed); a hook that SIGKILL stops (or a signal that Claude Code may send at the entry's `timeout: 5` other than SIGTERM, SIGHUP or SIGINT). What the owner must avoid: if the directory of the conversation records, `~/.agent-orchestrator/<hash>-<project folder>/sessions/.agent-conversations/` (`<sessions dir>/.agent-conversations/`), could have refused writes during the agent's run, or a hook could have been stopped, relaunch without `--continue` and pick the conversation in the agent (Claude Code: `/resume`). The command prints the ID that it resumes (`Conversation: <id> (from <source>)`), but it does not stop for a wrong one.

Every check runs before the first write, and a refusal (exit 1) changes nothing: no active record (archived: use `ao session restore`), a terminal status (a `killed` record is accepted only for `killedReason` `agent-exited` or `runtime`, or a legacy kill without a PR), a runtime other than tmux (Herdr: the relaunch waits for the Herdr live check), a missing tmux session, unknown liveness (a rejection, a non-boolean answer, or no answer within 10 s), a running agent process (in the bound pane, else the current window), an unknown or gone agent pane, a pane whose shell does not wait for input, a background `ao` in the own pane, live launch keys, a reservation record, a last launch younger than `LAUNCH_GRACE_MS`, and `--continue` without a sound ID. Then one compare-and-set under the record lock writes the launch keys of the `ao` process, `restoredAt` (the launch grace of the lifecycle), the new launch token and the pane. A `restore`, `kill`, `remap`, orchestrator start or relaunch that starts after this write refuses while the keys live.

The end state: the launch keys are cleared at the end of every path that the `ao` process lives through. When the write fails (three failed compares, or an I/O error), `ao` prints a warning at once and tries again (1 s, then doubling to 30 s) while it runs; an `ao` that stays for the agent's life does not hold the keys for that life. An `ao` that ends (also by SIGKILL) leaves keys of a dead process, which do not block. Agent seen running: a recoverable `killed` status becomes `working`. Agent absent (a definite "not running" at the end of the bound, a failed start such as no fresh prompt line, or the child ended first): `restoredAt`, the token and the pane get their old values back. Unknown (no definite answer within the bound, the agent may run): the new values stay, and the command exits 1 with "could not tell". The status is never set to `spawning` by the relaunch (a record that was already `spawning` stays so).

Limit (review r1 M-6, not fixed; accepted for the landing by the owner on 2026-10-22): a restore or kill of the same session already in flight is not excluded (the fix needs a claim in `restore` and `kill`, same-ID arc R3 and more); do not relaunch while one runs. In detail: a `restore` or `kill` of the same session that started before the relaunch's claim is not excluded. Both check the launch keys only at their start and own no claim while they stop and create the runtime, so the relaunch can type into a pane that the older operation then destroys, and report success. The owner must not run a relaunch while a restore or a kill of that session runs: not right after `ao session restore` or `ao session kill` in another shell, and not while a lifecycle reaction restores it (a configured `send-to-agent` or restore reaction after `agent-exited`). `ao session ls` cannot show that no such operation runs: neither publishes a claim today. The fix is one exclusion protocol for all three operations: `restore` and `kill` each take the launch claim by compare-and-set (on the launch identity and the claim as read) before any awaited destructive or allocating step, carry that claim through their later ownership checks, hold no record lock across those awaits, and release only their own claim on every end path, also on the internal delivery-to-restore path and in their failure and retry handling. Then a relaunch refuses on their live claim or fails its own claim compare, and needs no change itself. It needs the claim in `kill` as well as in `restore`: the same-ID R3 work for launch claims of agents without `prepareAgentSession` does not give it alone; that work must cover `kill` (R2b/R3) and make every participating operation obey the same protocol.

The gap between `/exit` and the relaunch: the lifecycle marks the record `killed` (`agent-exited`) at its second poll and runs the `agent-exited` reaction (default: notify). `ao send` to a session whose tmux session is alive pastes straight into the agent's pane (`packages/cli/src/commands/send.ts`, the `sendViaTmux` path: the pane that the last relaunch bound, else the current pane), so in the gap the pane's shell runs the message as a command (measured: a short and a two-line message both ran). Relaunch at once after `/exit`, or stop the senders (watchers, scripts) first.

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

Record writes (`packages/core/src/metadata.ts`): every Node writer holds the record lock (in the same file: a Linux abstract Unix socket that the kernel frees when the process ends, so no lock file can stay behind) for its read, compare, write and rename, and every write of a record file increments the record key `generation`: an update, a full write, a reservation and a write of an archived copy. The archive copy that a kill or a cleanup makes keeps the generation of the version that it copies. No writer stores a `generation` that its caller passes. The active records of a session ID never repeat a generation: a record that starts (a reservation, an archive copy-back, a full write over a missing record) continues above the larger of the latest archived copy and the generation floor `<sessions>/.generations/<id>`, which every delete (with or without an archive) raises to the deleted generation before it removes the file. Each archived copy has its own series: it starts at the generation that it copies, and an archive write adds 1 without the floor and without the active record, so a number can be both an active record's and an archived copy's. A compare reads one file and so compares within one series; every compare that uses the generation reads the active record. No reader lists the floor directory as a session (dot names are skipped by `listMetadata` of this and earlier builds; the archive readers need `<id>_<digit>`; the bash helpers write only `<sessions>/<id>`). An earlier build does not raise the floor and writes records without a generation, so every compare that any Node write must cancel also compares the launch identity. The lock holds only one read-compare-write. An operation that reads a record, awaits a slow step (a checkout, `runtime.create`, a probe, a network call) and then writes passes the values that it decided from, and writes nothing (it fails, or skips the write) when the record no longer holds them: the lifecycle poll, the repair on read, a PR claim and the recovery actions compare the `generation` plus the launch identity (any other write since the read stops them); an automatic cleanup kill compares the facts of its decision (`pr`, `issue`, `status`) plus the launch identity; spawn, the orchestrator start, restore, a direct kill, remap and the archive marks compare the launch identity (`launchIdentity`: the reservation ID `reservationId`, `runtimeHandle`, `tmuxName`, `createdAt`, `restoredAt`), so only an archive, a new reservation or another launch or restore of the ID stops them, not a status or bookkeeping write. One step of restore compares more: the release of the archive copy-back of a refused restore deletes the record without an archive copy, so it compares the launch identity, the `generation` (review r2, M-1) and `pr`, `status` and `branch` (review r3, M-1: the bash helpers below write these three keys and keep the generation), and a record where one of them changed stays; a write of another key that keeps the generation, or an unlocked write between the locked read and the unlink, is not detected. Every reservation has its own random `reservationId` (the first launch write removes it), so a spawn tells its reservation from a new one of the same ID. Only a reservation (`reserveSessionRecord`: also the archive copy-back of a restore, never over an existing record) and an explicit full write (`writeMetadata`) create a record; `updateMetadata` and the conditional writers never create or recreate one. Each removal of session state (a runtime destroy, a worktree destroy, a record delete or archive, an agent-session removal, a delivery-ledger removal) reads the current record (and, where it matters, the latest archive and the other records that name the same agent session) again directly before the step, with no `await` between the check and the step except the step itself. A retry or a wait inside a step counts as an `await`: each OpenCode removal attempt has its own check, and a ledger removal checks again after it holds the ledger lock (a kept ledger keeps its key `opencodeLedgerPending` in the archive). This reaches into the plugins: core passes its check to `Workspace.destroy` (`stillOwned`) and to `PreparedAgentSession.discard` (`stillUnheld`), and the plugin runs it again directly before each of its own removal calls (the worktree plugin before `git worktree remove` and before its `rmSync` fallback; the OpenCode plugin before the interrupt and before each removal attempt). A check that answers no or throws keeps the resource. `destroy` resolves nothing (its type stays `Promise<void>`, so an older plugin or caller compiles unchanged): the caller knows from its own check that the worktree stayed (a kill then throws, a recovery cleanup fails with its record-changed error, a rollback leaves the worktree to the new launch), and `discard` keeps the session and names it to the operator. A check that cannot read a record answers "unknown", never "gone" or "no holder": a record that exists but cannot be read, a record path that cannot be checked (`existsSync` answers false for it, so only a missing file is gone), an entry that the record listing cannot check (`listMetadata` leaves it out, so the holder checks use a listing that throws), a record that the listing found but `readMetadataRaw` then answers null for, an archive that `readArchivedMetadataRaw` cannot read (it answers null or throws), and an archive directory that cannot be checked or read (`listArchivedSessionIds` answers "no archives" when `existsSync` cannot check it, so the prepared-session decision uses a listing for which only a missing directory, `ENOENT`, has no archives) all keep the resource. This holds for the holder checks of the launch rollback, the kill, the orchestrator `delete` strategy, the archived-session cleanup and the delivery-ledger removal, and a kill whose archive step cannot check the record fails instead of reporting it archived. Older lookups keep their older answer: the lists that only choose candidates (issue reuse, the archived IDs of the cleanup). Same-ID R4 made the next session number and the cleanup's dead-runtime check `hasOtherOpenCodeRecord` strict (the strict-reads paragraph below). A launch rollback then keeps the runtime, the prepared agent session, the workspace and the record, and names each one to the operator. The orchestrator start with the `delete` strategy skips its own ID when it compares the records that name a stored OpenCode session, so each removal attempt also needs that ID's record to be still the start's own reservation. A session that it keeps because that record is gone, replaced or unreadable is named to the operator with its removal command (`opencode api session.remove --param sessionID=<id>`): a later start finds a stored OpenCode session only while an active record or the latest archive of an ID names it, and another archive of the ID (for example an archived empty reservation) hides an older one. Two other kinds of removal read no record: a resource that only the call owns (a temp file, a tmux paste buffer, a helper process and its temp directory) and ledger compaction under the ledger lock (an empty ledger, the expired-ledger sweep). The exported raw `killTmuxSession` reads no record either; no core path calls it (the managers destroy runtimes through the runtime plugins). A spawn or restore that finds its record changed stops its own new runtime only when the record read directly before the destroy is gone or is a launched record that names another runtime (a reservation, or a record that names the same runtime by handle or tmux name, may own it: a tmux name is the same for every launch of an ID); otherwise the runtime stays and the error or warning names it. The worktree goes only when the record is still the launch's own or gone, and the prepared agent session only when no record other than the launch's own active record (compared by launch identity) and no latest archive of any session ID names it: issue reuse gives the session to another AO session, and a restore of an archived record runs on it. A destroy by tmux name keeps one window that no record compare can close: between the last record read and the tmux command (the kill's runtime destroy and restore step 7). Two limits: the bash metadata helpers (`~/.ao/bin/ao-metadata-helper.sh` and the claude-code PostToolUse hook) write `pr`, `status` and `branch` with `sed` and `mv` outside the lock and without a new generation, so a helper write and a Node write can still overwrite each other between the read and the rename of either (the lifecycle compares `pr` and `status` too, and the release of a restore copy-back compares `pr`, `status` and `branch`, which catches a helper write that came before its locked read). On a platform without abstract sockets (not Linux) the writers run without the lock.

Runtime stops (same-ID R2a, `packages/core/src/runtime-stop.ts`): every core caller that stops a runtime goes through `stopRuntime(runtime, handle)`, which answers a `RuntimeStopOutcome` and never rejects: `destroyed`, `absent` (with its evidence), `other-launch` or `unknown` (with its detail). When AO cannot read the plugin or its answer (a getter or a conversion throws), the answer is `unknown` with a constant detail and the error as `cause`. Only `destroyed` and `absent` let a caller go on. On `other-launch` or `unknown` the caller removes no workspace, archives or deletes no record and creates no runtime for the ID: the kill throws `RuntimeStopUnconfirmedError` ("runtime stop unconfirmed (<outcome>): <detail>; record and worktree kept", with a `hint` that names the next action: the runtime's own `next` when it gave one, otherwise a check by hand and the command to try again), so `ao session kill`, `ao session restore` and `ao stop` exit 1 and print both (`ao stop` names `ao stop <project>` as the command to try again and leaves the lifecycle worker as it is); the cleanup keeps the session on each of its routes (runtime, merged PR, closed issue) and reports it as `kept: ...`, and on the runtime route a runtime probe that cannot answer keeps the session as before and is reported as `kept: ...` too; the launch rollback keeps the agent session, the workspace and the record, writes `launchFailed=<reason>` into the record while it is still the launch's own (`ao status` shows it), and keeps its separate `ownOrGone` workspace check and its conditional record release for a confirmed stop; the orchestrator start refuses to replace a live orchestrator (its record stays) or an orphan one (no reservation); restore decides the stop of the old runtime before it recreates a missing workspace, and it copies an archived record back as a reservation before the stop: while the copy-back exists, no other reservation of the ID can be made (a spawn, or the copy-back of a restore that read the archive before it), but it is not an operation lock, because an operation that reads it as an active record (another restore, an orchestrator start, a PR claim, a kill, a lifecycle write) can still act on it during the stop (one operation per ID is same-ID R3); a refusal removes that copy-back again only while it still holds the values that it was written with (its launch identity, its `generation`, and `pr`, `status` and `branch`; the record writes above name what this compare does not detect), so a refused restore with no other operation on the ID leaves the record, the archive and the workspace as they were and starts no second launch of the ID, and a copy-back that another operation replaced or wrote to during the stop (for example a PR claim, a status write or a metadata-helper write) stays with that write, and the refusal says so (N-2, review r1 M-1, review r2 M-1, review r3 M-1); the recovery cleanup fails and keeps both. A restore that finds its record changed after its create still stops its own new runtime, and its error says whether that stop was confirmed. A runtime with the optional `Runtime.stop` answers for itself: a `stop` that rejects, or that answers a value that is not a valid outcome, is `unknown`. A runtime without it is stopped by `destroy` and then `isAlive`: false after a resolved destroy is `destroyed`, false after a rejected destroy is `absent`, and true, a rejection or a value that is not a boolean is `unknown`, with one addition to design r2: a rejection with `RUNTIME_NO_SERVER_ERROR_CODE` after a destroy that resolved is `destroyed`, because tmux ends a server with its last session (after a destroy that rejected, "no server" stays unknown: a server whose socket is gone still runs its sessions). Compatibility limit: this fallback is useful only under an authoritative-false `isAlive` contract (false only when the runtime answered that the session does not exist, a rejection when it cannot tell); a plugin that answers false when its probe fails gains no stronger evidence from the wrap, and its false lets the caller remove the workspace of a session that may still run, so such a plugin needs its own `stop`. runtime-tmux has no `stop` yet (it needs the launch identity of R2b); its `destroy` resolves after `kill-session` and for tmux's "can't find session" or "no current target" answer, and rejects with the failure as `cause` for every other error (no server, a timeout, an unknown error). So while no tmux server runs at all (for example after a host restart, before any tmux session starts), a kill, a cleanup kill or a restore of a tmux session refuses until a server runs again and can answer for the session. runtime-herdr `stop` answers `unknown` and closes nothing, and its `destroy` throws with no herdr call (Herdr fit F-5; core never calls it) (same-ID review r2, B-2: herdr reuses pane and workspace IDs, and a check before the close cannot cover a replacement between the check and the close), so AO keeps the record and the worktree of every Herdr session until design r3 lands; the operator closes the workspace by hand. Its answer carries `next`, which the refusal shows instead of a retry, because a retry gives the same refusal. The lifecycle gate: an agent negative (`exited`, or `isProcessRunning()` false) counts only after the runtime probe of the same poll answered alive. While the runtime probe fails (or no runtime plugin can probe the stored handle) it keeps the status, and the probe outcome stays `failed`; agent positives still classify, "no server" still skips the agent check, and the two-negative confirmation is unchanged. No lifecycle reaction calls a kill or a cleanup (the reaction actions are `send-to-agent`, `notify` and `auto-merge`).

Strict reads (same-ID R4, design r2 section 3): a read that a destructive or allocating decision uses answers "gone" only for an explicit "does not exist", and every other failure is unknown (a rejection with the cause, `probeError` and the action `skip` in recovery, or "held" for an OpenCode removal). The explicit negatives are: a missing file or directory (`ENOENT`); tmux's `can't find session: <name>` for the handle's session or `no current target`, each as the whole diagnostic of a call that ended with exit code 1, from the server that the handle names; a well-formed `ps` list (its header, then one `PID TTY ARGS` row per process, each PID a positive safe integer) without the agent; the `pane_not_found` code of herdr's error envelope, without a result, from a command that exits 0, and a valid empty process list for the requested pane; the requested Herdr pane with another terminal; and git's exit 128 whose whole stderr, in the C locale, is its discovery diagnostic (`fatal: not a git repository (or any of the parent directories): .git`, or the `up to mount point` form). So `no server running`, `error connecting to`, a timeout, a signal, a binary that cannot start, text that is not JSON, another herdr error envelope, a reply without the expected fields, `EACCES`, `ELOOP` and I/O errors are unknown. Round 2 (review r1) adds the malformed or mismatched answers: a call that succeeds with empty or other text from tmux or a `ps` reply that is not a process list, a herdr command that fails whatever its message or binary path holds (also one that names `pane_not_found`), a Herdr entry with a field of the wrong type (it rejects the whole reply), a Herdr reply for another pane, and another git exit 128 (dubious ownership, also of a path that holds the words "not a git repository"). The reads: the next session number (worker spawn and isolated orchestrator start) lists the archive directory strictly and refuses before any reservation when it cannot (`Cannot choose a session number: ...; nothing was created`); the cleanup's `hasOtherOpenCodeRecord` lists the active records, reads each record and the latest archive of each ID strictly, and answers "held" when a read fails, so the cleanup keeps the session (`ao: kept <id>: ...`) unless its own liveness check finds it dead; the recovery validator checks the worktree path with `lstat` and keeps a rejected `workspace.exists` as unknown; workspace-worktree `exists` answers true only for `rev-parse --is-inside-work-tree` that prints `true`; core `getHerdrPaneProcesses` (and so every agent's `isProcessRunning` on a Herdr pane) and runtime-herdr `isAlive` reject when herdr cannot answer; codex, gemini and opencode `isProcessRunning` follow the claude-code rule (CLAUDE.md, "`isProcessRunning` must"); and OpenCode's pane check gives `PaneGoneError` (and so a send's one restore) only for tmux's explicit missing pane, and rejects a malformed `tmux` or `ps` answer instead of answering "no OpenCode". Availability: after a tmux server exit or a host reboot, `ao status` shows the codex, gemini and opencode tmux sessions as unknown (it showed exited), as it already did for claude-code, while the lifecycle still marks them killed after the no-server bound and recovery skips them as before; an OpenCode send stops at the first tmux failure that is not an explicit missing pane, with the cause and no restore (before, `no server running` asked for one restore at once, and another failure asked for it after the 10 s wait), and an OpenCode launch check fails at once on such a failure instead of polling until its bound. The delivery waits of runtime-herdr (`sendMessage`) still read a failed pane query as "not yet" and poll again, because no stop or removal decides from them. After round 2, a codex, gemini or opencode session whose `ps` or `tmux` answers malformed text stays `working` (two polls made it killed), an OpenCode send in that case stops with the cause instead of `AgentNotAttachedError`, and a restore of a workspace that git refuses (dubious ownership) refuses before any change. A herdr that fails with a non-zero exit is unknown also when its pane is gone; herdr answers a missing pane with the envelope and exit 0 (the comment of runtime-herdr `parseHerdrResult`). Round 3 (review r2) adds: a `ps` row whose PID is 0 or not a safe integer (the whole reply is unknown), a tmux missing-target line for another session, among other lines, with another exit code or none, or from a killed call (a timeout), a Herdr process list for another pane, a herdr answer with both an error and a result, a Herdr `terminal_id` that is not text, a `workspace.exists` answer that is not a boolean, and, for the cleanup's holder check, an active record or latest archive that is not a well-formed record (a line without `=`, an empty or other key, a key twice), which is "held". After round 3, a codex, gemini or opencode session for which `ps` answers an impossible PID, or tmux answers the missing-target line of another session, stays `working`, an OpenCode send in that case stops with the cause instead of `AgentNotAttachedError`, and the cleanup keeps an OpenCode session that a damaged record may name (a well-formed record without the mapping, an empty file, comments and blank lines still name nothing). The tmux forms are those of tmux 3.4; another wording (another tmux version) is unknown, so its dead pane does not count as gone in these reads (the runtime probe, runtime-tmux `isAlive`, is not one of them). Round 4 (review r3) adds: a runtime-herdr `pane get` body without a `result` object (none, null, a scalar or a list), also with a top-level `pane`, which is unknown (the other herdr commands keep their top-level fallback), and the key `__proto__` twice in a holder record, which is a key twice ("held").

Absence forms of the R4 reads (same-ID R4 round 3, owner answer "1a"). This table is the contract of the 11 reads: a read answers its negative ("gone", "no agent", "names nothing") only for the form in the third column, with the identity that the column names; every form that is not in the third or the fourth column takes the answer of the fifth. A test in the last column pins the gone form, and at least one near-miss test rejects (or holds). Round 4 (review r3) narrows row 9 to a pane inside a `result` object, holds rows 3 and 4 also for the key `__proto__` twice, and states the PID form of row 11 exactly.

| Read (file, function)                                                                                                                                                                                                 | It reads                                                                                                                                                                                                                                                                                         | Accepted "gone" (the whole form)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Accepted "present"                                                                                                                                                  | Every other form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tests: gone; near-miss                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Archive allocation: `core/src/session-manager.ts` `listArchivedSessionIdsForAllocation` (`listArchivedSessionIdsStrict`, `readdirOrEmpty`), for `reserveNextSessionIdentity` and `reserveNextOrchestratorIdentity` | `readdirSync(<sessions>/archive)`                                                                                                                                                                                                                                                                | The call fails with `code` `ENOENT`: no archives, so the allocation goes on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A list: each name that matches `^([a-zA-Z0-9_-]+)_\d` is an archived ID that the new number must not take.                                                          | Refuse before any reservation, workspace or runtime: `Cannot choose a session number: the archive directory <dir> could not be listed (<cause>) ...; nothing was created` (`EACCES`, `ELOOP`, `ENOTDIR`, I/O).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `control: a missing archive directory (ENOENT) has no archives, so spawn takes app-1`; `spawn refuses with the reason, before any reservation, workspace or runtime` (ELOOP), `spawn does not take a session number while the archive directory cannot be checked`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2. Active holder listing: `session-manager.ts` `listRecordIds`, in `hasOtherOpenCodeRecord`                                                                                                                           | `readdirSync(<sessions>)`, then `statSync` of each entry whose name matches `^[a-zA-Z0-9_-]+$` (not `archive`)                                                                                                                                                                                   | The directory read fails with `ENOENT` (no records); an entry's `statSync` fails with `ENOENT` (removed since the listing); an entry that is not a file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `statSync(...).isFile()` is true: the record is read (row 3).                                                                                                       | "Held": the cleanup keeps the session (`ao: kept <id>: ...`) for any other error of either call.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `control: no other record and no archive name the session, so the cleanup removes it`; `item 2: an active entry that cannot be checked (ELOOP) keeps the session, with the holder reason`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3. Active holder content: `core/src/metadata.ts` `readMetadataStrict` (round 3), in `hasOtherOpenCodeRecord`                                                                                                          | `readFileSync(<sessions>/<id>)`, parsed by `parseKeyValueContentStrict` (`core/src/key-value.ts`)                                                                                                                                                                                                | "Names nothing": the read fails with `ENOENT`; or a well-formed record (each line, after trim, is empty, a `#` comment, or `key=value` with a key that matches `^[A-Za-z0-9_.-]+$`; no key twice; an empty file counts) whose `opencodeSessionId` is not the requested OpenCode ID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | "Holder": a well-formed record whose `opencodeSessionId` is the requested ID.                                                                                       | "Held": any other read error (`EACCES`, `EISDIR`, I/O), a line without `=`, an empty or other key, a key twice (also `__proto__`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `round 3 (M-5) control: an active record with comments and blank lines that names another OpenCode session is not a holder, so the cleanup removes the session`; `round 3 (M-5): a malformed active record with a line without a delimiter (review r2) keeps the session, with the holder reason` (also an empty key, a key twice), `round 4 (review r3, m-1): a malformed active record with the key __proto__ twice keeps the session, with the holder reason`, `item 3: an active record that becomes unreadable (EACCES) after the cleanup listed it keeps the session, with the holder reason`; the `readMetadataStrict / readArchivedMetadataStrict` tests of `metadata.test.ts` (round 4: `throws for the key __proto__ twice with one value (review r3)`, also with two values; `control: one __proto__ line is a record that names nothing, with a plain prototype`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4. Latest archive content: `metadata.ts` `readArchivedMetadataStrict` (round 3), for each ID of `listArchivedSessionIdsStrict`, in `hasOtherOpenCodeRecord`                                                           | `readdirSync(<sessions>/archive)`; the lexicographically last `<id>_<digit>...` file; `readFileSync` of it, parsed as in row 3                                                                                                                                                                   | The archive directory read fails with `ENOENT` (no archives); or, for each archived ID, the latest archive is a well-formed record (as in row 3) that does not name the requested ID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | "Holder": the latest archive of an ID names the requested ID.                                                                                                       | "Held": another listing error, a latest archive that cannot be read, that is not a well-formed record, or that is gone after the listing (null).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `round 3 (M-5) control: an empty latest archive is not a holder, so the cleanup removes the session`, `control: no archive and no other record name the session: the cleanup removes it`; `round 3 (M-5): a malformed archive record with a line without a delimiter (review r2) keeps the session, with the holder reason`, `round 4 (review r3, m-1): a malformed archive record with the key __proto__ twice keeps the session, with the holder reason`, `cleanup keeps an OpenCode session that the unreadable latest archive of another ID may name`, `cleanup keeps an OpenCode session that an archive may name while the archive directory cannot be checked`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5. Recovery path: `core/src/recovery/validator.ts` `validateSession`                                                                                                                                                  | `lstatSync(<workspace path>)`                                                                                                                                                                                                                                                                    | The call fails with `ENOENT` (then row 6, when the workspace plugin has `exists`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `lstatSync` returns: the workspace exists.                                                                                                                          | `probeError` (`workspace path check could not run: <cause>`), so the session is `partial` with the action `skip` (`Liveness unknown (...); no action`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `control: a path that does not exist (ENOENT) is 'no workspace', not unknown`; `a path under a symlink loop (ELOOP) gives a live session no action`, `a path under a parent that cannot be read (EACCES) gives a live session no action`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6. Recovery workspace probe: `validator.ts` `validateSession`                                                                                                                                                         | `workspace.exists(<path>)`, only for a path that row 5 found missing                                                                                                                                                                                                                             | The call resolves `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | The call resolves `true`.                                                                                                                                           | `probeError`, so `skip`: a rejection (`workspace check could not run: <cause>`), and (round 3) a value that is not a boolean (`workspace check answered <value>, not true or false`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `control: a workspace.exists that answers false is an authoritative 'missing' (not unknown)`; `a workspace.exists that rejects (git could not start) gives a live session no action`, `round 3: a workspace.exists that answers a value that is not a boolean gives a live session no action`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7. Worktree exists: `workspace-worktree/src/index.ts` `exists`                                                                                                                                                        | `lstat(<path>)`; then `git rev-parse --is-inside-work-tree` with `cwd` the path and `LC_ALL=C`                                                                                                                                                                                                   | `lstat` fails with `ENOENT` (no git runs); or git fails with exit code 128 and its whole stderr (trimmed) is `fatal: not a git repository (or any of the parent directories): .git`, or `fatal: not a git repository (or any parent up to mount point <dir>)` with the one next line `Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | git exits 0 and its stdout (trimmed) is `true`.                                                                                                                     | Reject with the cause and git's first stderr line: another `lstat` error, another exit code, another stderr (dubious ownership, another line, a translation), no exit code (a timeout, a signal), a git that cannot start, exit 0 with other output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `control: git's exit 128 'not a git repository' answers false`, `control: git's exit 128 'up to mount point' diagnostic answers false`, `control: a missing path answers false and runs no git`, `control: a directory outside any repository answers false` (real git); `rejects git's exit 128 when the diagnostic comes with another line`, `rejects git's exit 128 for dubious ownership of a path that holds 'not a git repository'`, `rejects git's 'not a git repository' text with another exit code`, `rejects a repository at a path named 'not a git repository' that git refuses (dubious ownership)` (real git)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8. Core Herdr: `core/src/herdr.ts` `getHerdrPaneProcesses` and `isHerdrProcessRunning` (the agents' check on a Herdr pane)                                                                                            | `herdr pane process-info --pane <id>`, stdout as JSON                                                                                                                                                                                                                                            | `pane_not_found` as the `code` of herdr's error envelope, either on stdout with exit 0 and `result` absent or null (0.8.0), or in the 0.9.5 form (exit 1 with no signal and no timeout, empty stdout, one stderr line, with one trailing newline at most, that is a JSON object with exactly `id` `cli:pane:process_info` and `error`, and `error` an object with exactly a non-empty text `code` and a text `message`), for a pane ID in herdr's grammar (`^w[0-9A-HJKMNP-TV-Z]+:p[0-9A-HJKMNP-TV-Z]+$`): `[]`. An empty pane ID: `[]` with no call. Or exit 0 and `result.process_info` whose `pane_id`, when the answer has one, is the requested ID (text), with `foreground_processes` a list in which every entry is an object with a positive safe-integer `pid`, a text `name` and `cmdline` when present, an `argv` list of text when present, and a name or a command line: the list; "no agent" is such a list with no entry that the agent pattern matches. | Such a list with an entry that the agent pattern matches (its command line or its name).                                                                            | Reject (`herdr pane process-info --pane <id> could not answer: <detail>`): a command that fails in any other form (any exit code, a signal, a timeout, a herdr that cannot start, a stderr that is not exactly the 0.9.5 form), text that is not JSON or not an object, an `error` with a `result`, an `error` that is not an object, another error code (in the 0.9.5 form the detail is `herdr error <code>: <message>`, and the rejection has `herdrCode`), no `result`, `process_info` or list, an entry with a field of the wrong type, a `pane_id` of another pane or that is not text. The 0.9.5 form with `server_not_running` and the message prefix `no herdr server is running at `: reject with `code` `RUNTIME_NO_SERVER_ERROR_CODE`. A non-empty ID outside the grammar: reject with no call. A pinned handle (`herdrBin` and `herdrSocket` in its data, Herdr fit F-6) runs its `herdrBin` with `HERDR_SOCKET_PATH` set to `herdrSocket`; a handle without pins, or a pane ID string, runs `herdr` with the caller's environment; malformed pins (one pin only, a path that is not absolute, a control character, a value that is not text): reject with `HerdrPinError` (`code` `ERR_HERDR_PIN`) and no call. | `control: the pane_not_found envelope at exit 0 answers an empty list`, `control: a lone pane_not_found error with a null result answers an empty list`, `control: an empty list for the requested pane answers an empty list`, `T-1.2: closedpane_pane_process_info answers an empty list, and isHerdrProcessRunning false` (also `closedws_pane_process_info`), `T-1.5: the 0.8.0 envelopes at exit 0 keep their answers`; `rejects the process-info of another pane with an empty list`, `rejects an answer with the pane_not_found error and a result for the requested pane with an empty list`, `rejects a command that fails with the pane_not_found envelope (a non-zero exit)`, `rejects the whole reply for an entry with no pid`, `T-1.3: noserver_stopped_pane_process_info rejects with the no-server code`, `T-1.4: a near miss of the form (<label>) rejects with no herdrCode and no no-server code` (an extra key, another ID, exit 0, a signal, stdout text, two lines, ...), `T-1.4b: the form with another code (<label>) rejects with that herdrCode and no no-server code`, `T-2.1: "<id>" rejects with no call`, `T-6.7: malformed pins (<label>) throw HerdrPinError, and row 8 rejects with no call`                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9. Runtime Herdr: `runtime-herdr/src/index.ts` `isAlive` (`getPaneStrict`, `herdrResult`, `parseHerdrResult` with `requireResult`)                                                                                    | `herdr pane get <id>`, stdout as JSON                                                                                                                                                                                                                                                            | False: `pane_not_found` as in row 8, with `id` `cli:pane:get` for the 0.9.5 form, for a pane ID in the grammar; or exit 0 and a `result` object whose `pane` has `pane_id` the requested ID and a text `terminal_id` that is not the handle's non-empty `terminalId` (a replaced terminal).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | True: a `result` object whose `pane` has the requested `pane_id` and a `terminal_id` that is the handle's, absent, null or empty, or a handle without `terminalId`. | Reject: a command that fails in any other form (whatever its text or binary path holds), another error code (in the 0.9.5 form with `herdrCode` on the cause), an error without a code, an `error` that is not an object, an `error` with a `result`, a body without a `result` object (none, null, a scalar or a list), also with a top-level `pane` (round 4), no pane, a pane for another `pane_id`, a `terminal_id` that is not text. An empty ID or an ID outside the grammar: reject with no call. The no-server and pin rules of row 8 (the rejection of `isAlive` has the no-server `code`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `control: the pane_not_found envelope at exit 0 answers false`, `control: the same pane with a replaced terminal answers false`, `control: a lone pane_not_found error with a null result answers false`, `control: the same replaced terminal inside a result object answers false`, `control: the same replaced terminal inside a result object gives app-1 killed after two polls` (lifecycle), `T-1.1: closedpane_pane_get answers false` (also `closedws_pane_get`), `T-1.6: the 0.9.5 pane_not_found answer gives app-1 killed after two polls` (lifecycle); `rejects a top-level pane without a result (review r3)` (also with a null, a scalar or a list result), `keeps app-1 working over two polls when herdr answers a top-level pane without a result (review r3)` (lifecycle, also with a null or a scalar result), `rejects the pane_not_found error with a result for the requested pane with a replaced terminal`, `rejects a reply for another pane, also with another terminal`, `rejects the requested pane with a terminal_id that is not text`, `rejects when the herdr command fails with text that names pane_not_found`, `T-1.3: noserver_never_pane_get rejects with the no-server code at the top level`, `T-1.7: the 0.9.5 no-server answer keeps app-1 below NO_SERVER_BOUND_MS, then kills it (runtime)` (lifecycle), `T-1.4: a near miss of the form (<label>) rejects with no herdrCode and no no-server code`, `T-2.1: "<id>": isAlive and sendMessage reject, getOutput is empty, all with no call`, `T-6.7: malformed pins (<label>): isAlive and sendMessage reject, getOutput is empty, with no call` |
| 10. Agent liveness: `isProcessRunning` of agent-codex, agent-gemini and agent-opencode                                                                                                                                | tmux handle: `tmux list-panes -t =<name>: -F '#{pane_tty}'`, then `ps -eo pid,tty,args`; codex and gemini, for a pane `%N` that a relaunch bound (session relaunch): `tmux list-panes -t %N -F '#{pane_id} #{session_name} #{pane_tty}'`, then `ps` on the TTY of `%N` only; Herdr handle: row 8 | False: tmux fails with exit code 1, no signal, not killed, and its whole stderr (one trailing newline removed) is `can't find session: <name>` (the handle ID) or `no current target` (a server with no session; both forms of tmux 3.4). Or tmux exits 0 with one or more lines that are each `/dev/<path>`, and `ps` exits 0 with the header `PID`, `TT` or `TTY`, `ARGS`, `COMMAND` or `CMD`, then one or more rows `<pid> <tty> <args>`, each `<pid>` a positive safe integer without a leading zero, and no row on a pane TTY whose arguments the agent pattern matches. For a bound pane `%N` (codex, gemini) also: the whole stderr `can't find pane: %N`, or a list whose line for `%N` names another session (the pane moved, review r3 M-3); the form `can't find session: <name>` stays accepted there too, though tmux 3.4 does not answer it for a pane target.                                                                                            | True: such a list with a row on a pane TTY whose arguments the agent pattern matches.                                                                               | Reject with the cause: every other tmux failure (`no server running`, `error connecting to`, another session's name, `can't find window` or `can't find pane`, the line among other lines, another exit code or none, a signal, a timeout), tmux output that is not TTY paths, a `ps` that fails, a `ps` reply that is not such a list (a header only, a malformed row, PID 0, a PID that is not a safe integer); for a bound pane also a line that is not `%N <session> /dev/<path>`, and a list without a line for `%N`. Not an R4 read, unchanged: a handle that is neither a tmux nor a Herdr pane uses `process.kill(pid, 0)`: true when the call returns or fails with `EPERM`, false for any other error, and false with no positive PID; no retained runtime makes such a handle.                                                                                                                                                                                                                                                                                                                                                                                                                                     | `control: exit code 1 and 'can't find session: <name>' for this session answer false`, `returns false when a server with no session answers 'no current target'`, `control: a valid list on a Linux pane TTY without <agent> answers false`, `control: a valid process list without codex gives app-1 killed after two polls` (lifecycle); `rejects a tmux failure where the missing-target line names another session` (and the five other forms), `rejects a ps row with PID 0`, `rejects a ps row with a PID too large to be exact`, `rejects 'can't find window', which tmux does not answer for a session-only target (round 3, M-4)`, `keeps app-1 working over two polls when tmux answers the missing-target line for another session` (lifecycle); bound pane: `answers false when tmux answers that the agent's pane does not exist`, `answers false when the agent's pane now belongs to another session` (codex and gemini `agent-pane.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11. OpenCode send and launch: `agent-opencode/src/index.ts` `findPaneOpenCodeProcess` (send `waitForSendTui`, launch `waitForPaneOnSession`)                                                                          | tmux `list-panes` as in row 10; `ps -eo pid=,tty=`; `/proc/<pid>/cmdline` of each PID on a pane TTY; Herdr: the list of row 8                                                                                                                                                                    | Gone (`PaneGoneError`: a send gives `AgentNotAttachedError` "the pane is gone", which asks for one restore; a launch fails at once with "the pane of <id> is gone"): the tmux failure of row 10 (exit code 1, the whole diagnostic for this session or `no current target`). No OpenCode (null: a send gives `AgentNotAttachedError` after the wait; a launch polls to its bound): TTY paths as in row 10 and a `ps` reply of one or more rows `<pid> <tty>`, each `<pid>` a positive safe integer without a leading zero, with no PID on a pane TTY whose argument vector opens the requested OpenCode session; on Herdr, a list of row 8 with no such PID.                                                                                                                                                                                                                                                                                                            | A PID on a pane TTY (or in the Herdr list) whose argument vector opens the requested session (`opencode ... --session <id>`).                                       | Reject: a send stops with `cannot check the OpenCode TUI of <id>: ...` (no restore, no send), a launch fails at once with the cause: every other tmux failure, a malformed tmux or `ps` answer (also a PID with a leading zero, such as `01`), a `ps` that fails, a Herdr rejection. Limit (not changed in R4): a PID whose `/proc/<pid>/cmdline` cannot be read counts as "not OpenCode" (`readProcessArgv`; `ENOENT` means that the process ended).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `control: refuses a gone pane at once when tmux answers with exit code 1 that the session does not exist`, `control: fails at once when tmux answers with exit code 1 that the session does not exist`, `refuses a TUI on another session, an opencode api call and a shell that names the ID` (no OpenCode); `does not read the pane as gone or without a TUI when tmux answers the missing-target line for another session: no AgentNotAttachedError, no send`, `does not read the pane as gone or without a TUI when ps answers a PID too large to be exact: no AgentNotAttachedError, no send`, `does not read a tmux failure without an exit code as a gone pane (round 3, M-4)`, `does not read the pane as gone or without OpenCode at launch when ps answers PID 0 (round 3)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Rows 2 to 4 decide the gate of the cleanup's dead-runtime route. "Held" keeps the cleaned session while its own liveness is not certain (`openCodeHolderReason`: its runtime answers dead, but its agent check does not). When both answer dead, the cleanup kills the session, and the kill route removes the OpenCode session unless `findLiveOpenCodeSessionHolder` finds a live session that names it. That guard is not one of the 11 reads: it reads the active records with the lenient parser and leaves out an entry that it cannot check (follow-up F-5), so on that route a damaged record of another session does not keep the OpenCode session (measured in round 3 on 8e9efe95 and on the round 3 build alike; a follow-up).

Orchestrator start and stop (2026-10-22, defects A and B): `ao start` (`runStartup` in `packages/cli/src/commands/start.ts`) does not reuse an orchestrator record only because `sm.list` shows it as not terminal: `sm.list` keeps the stored status when `Runtime.isAlive` rejects or answers a value that is not a boolean (only `false` marks a record killed in `enrichSessionWithRuntimeState`, review r1 M-3). For each such record with a stored handle of a runtime outside `LAUNCH_END_UNPROVEN_RUNTIMES` (tmux; a Herdr record goes to core, below), `ao start` asks the runtime itself, with the rule of core `classifyOrchestratorLiveness`: true is alive; false, or a rejection with `RUNTIME_NO_SERVER_ERROR_CODE` (no server runs at all, so no session can exist), is gone; any other rejection, or an answer that is not a boolean, is unknown. A record with no stored handle is not probed (as in `sm.list`): it is unchecked. `ao start` then decides on all these records together (fit-1 note 3, review r2 m-2). When a record that is not terminal is alive or unchecked, `ao start` reuses the most recently active such record, as before, and an unknown or gone record next to it stops nothing. When no record can be reused and one is unknown, `ao start` starts no orchestrator, claims no reuse, prints the reason with "Check the runtime and run `ao start` again" and exits 1. When no record can be reused and none is unknown, `ao start` prints that each gone record does not run and calls `spawnOrchestrator`, which archives or replaces the record in project mode (no runtime stop: `stopRuntime` is not reached on that path) or starts the next ID in isolated mode (the lifecycle then marks the old record killed). In project mode core (`outsideSetOrchestratorAlive`) throws its "Cannot tell whether session ... is alive" error for an answer that is not a boolean, so `spawnOrchestrator` neither reuses nor replaces such a record either.

For a Herdr record, the Herdr fit-2 startup admission G applies (`development/reviews/herdr_fit2_design_r11_opus.md` section 5.3; owner decision OQ-F1 (b), 2026-10-22). Before RH no Herdr answer proves that a launch ended: a server can still run the launch where the selected socket does not reach it, so no server at that socket proves nothing, and herdr gives the same pane IDs to new terminals after a restart. So at startup core admits no second Herdr orchestrator launch next to an earlier Herdr orchestrator record of the project, whatever its status, and takes no Herdr answer as proof that a launch ended. Core `spawnOrchestrator` (both workspace modes, every strategy), `restore` of an orchestrator record and `findReusableOrchestrators` (the reuse decision, which admits nothing) run one admission procedure in `packages/core/src/session-manager.ts` (`runAdmission`):

1. Lock A. The procedure holds A, an abstract unix socket per sessions directory (`admissionLock` in `packages/core/src/delivery-lock.ts`), for its local work only, and waits at most 30 s for it. A start or restore on a platform without the lock refuses when it would create a Herdr launch or when G1 selects a record.
2. G1 selects, with strict reads, the orchestrator records that `isUnprovenLaunchRecord` accepts: a handle of a runtime in `LAUNCH_END_UNPROVEN_RUNTIMES`, or a handle that cannot be read when its text names herdr or the project selects herdr. It also selects a record without a handle whose launch claim names a process that runs.
3. G2 decides each selected record from its fields with the reuse predicate R: no live launch claim (R1), a well-formed handle (R2), no `createIncomplete` (R3), no `launchFailed` (R4), the project's selected runtime (R5), a status that is not terminal (R6), an `isAlive` true (R7), and for a start the fixed ID in project mode with a reuse strategy (R8). The `isAlive` probes run outside A, each with a 10 s bound (`classifyOrchestratorLiveness`), in at most 3 rounds. An answer counts only for the identity token that it probed, and the deciding round reads R1 to R6 again under A.
4. A record that R accepts is reused: core reuses its project-mode record, and the CLI reuses one in any workspace mode. Any other selected record blocks the start before any write.

A blocked start throws `OrchestratorStartBlockedError`. For `reason: "records"` its message is message M, one block per record (each value in a command is shell-quoted):

```text
No new orchestrator was started for project <project>: AO cannot tell that every earlier herdr orchestrator launch of the project ended.
<id>: <state>. Herdr pane <pane> (terminal <T>), workspace <ws>, worktree <path>, socket <socket>: <answer>.
  Check:  HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>
  If it runs, use it:  ao session attach <id>
  If it does not run, or after you close it:  ao session kill <id> --confirm-runtime-closed <identity-token>
Before RH, AO takes no herdr answer as proof that a launch ended. Then run ao start again.
```

`<state>` is `status <s>[, launch failed][, create <stage>][, <why it is not reused>]`, or `launch in progress by ao process <pid>`. An `in-progress` block says "Wait for ao process <pid>; if it hangs, stop that process, then run ao start again." and has no kill line. An empty pane ID gives the check `workspace list` (look for the label and the cwd); a pending handle P gives that check at the endpoint of the `ao` process that started the launch. A `damaged` block (a handle that cannot be read) names the by-hand recipe below, because F-9 refuses such a record. The other reasons print one sentence each: `records-unreadable`, `admission-busy` ("Another ao process is admitting an orchestrator for project <p> now. Run ao start again after it ends."), `admission-unsupported`, `admission-path` and `records-changed`.

`ao start` runs `ensureTmux` only when the project's runtime is tmux. It splits the candidates that `sm.list` shows as not terminal by G1's predicate: a Herdr record goes to core's reuse decision, a record with a stored handle of another runtime keeps the rule above, and a record without a handle stays unchecked. It reuses the most recently active record of the three groups ("Using existing orchestrator session: <id>"). Before it starts a new orchestrator, `ao start` asks the selected runtime's readiness (`preflight.checkSelectedRuntime` in `packages/cli/src/lib/preflight.ts`: `checkTmux` for tmux, else the plugin's `preflight()`); `ao spawn` asks the same before `sm.spawn`. runtime-herdr `preflight()` asks its own binary and the endpoint that a create uses, so `ao doctor`, which asks the bare `herdr` on PATH, can give another verdict. A blocked start prints "No new orchestrator was started" and the error's own message, with no "Failed to setup orchestrator:" prefix, and exits 1. With `--no-orchestrator`, nothing of this runs.

The limits of G (design 5.3.9):

- L-1: tmux orchestrator records are outside G. A tmux and a Herdr orchestrator, and two tmux orchestrators, of one project can still exist.
- L-2: G does not select an orchestrator record without a handle and without a live launch claim: a launch of a build before fit-2 that crashed inside a Herdr create. The CLI counts it as the existing orchestrator, so `ao start` then prints "Using existing orchestrator session" and starts none, also when no agent runs for it. **Upgrade step** (before the first fit-2 start): for each Herdr project, list the orchestrator records without `runtimeHandle` (for example `grep -L '^runtimeHandle=' <sessions dir>/*-orchestrator*`), check each with the owner's check below (`workspace list` by label and cwd), and retire each by hand (below).
- L-3: worker spawns have no project-wide admission rule.
- L-4: A is per sessions directory, so two AO configs in different directories for one repository are two projects.
- L-5: an `ao` build before fit-2 takes no A and writes no P. **Deployment step:** stop every `ao` process of the old build (lifecycle workers, resident `ao` processes, watchers that run `ao`) before the first fit-2 start.

**A kept failed launch and a crashed launch** (design 5.2.5). A failed Herdr create closes nothing. It throws a plain error only when no request of the create reached the server: the endpoint check (no server at the selected socket, or a server that is not compatible with this herdr client) and the herdr CLI's own refusals before its request. Every other failure is a `RuntimeCreatePartialError` with the handle of what may exist (`data.createIncomplete`: `workspace-unconfirmed`, `launch-not-submitted` or `launch-unconfirmed`). AO then keeps a kept failed launch: the record with the partial handle and `launchFailed` and no launch claim, the worktree, the agent session, the prompt file of an orchestrator, and for `launch-unconfirmed` the launch script in `$TMPDIR`. A spawn or start of a Herdr launch writes the pending handle P (`{"id":"","runtimeName":"herdr","data":{"createIncomplete":"create-pending"}}`) and its launch claim in its reservation, and a restore writes them in its transition write. An `ao` process that ends inside the launch leaves a crashed launch: P, the claim of a dead process and the launch fields (`worktree`, `branch`, `agent`, `createdAt`, `status`, `role` for an orchestrator). P names no pins, no pane and no launch script: look for the launch at the endpoint of the `ao` process that started it (its `HERDR_SOCKET_PATH`, else its `HERDR_SESSION`, else the default socket), with the record's `worktree` (else the managed path of the ID) as the cwd. `ao status` shows `launch failed: <text> (identity token <t>)` for a kept failed launch and `launch incomplete (<stage>; identity token <t>)` for a crashed launch; `ao status --json` adds `identityToken` and `createIncomplete`. `ao session kill <id>` refuses both (the Herdr stop answers `unknown`), and its hint names F-9 with the identity token. `ao session cleanup` keeps them. G blocks them at startup.

**Launch claims and the publication rule** (design 4.5). The operation that writes a launch claim (`launchPid`, `launchPidStart`) is its only owner, and only it clears the claim: `settleOwnClaim` compares the launch identity of its last own write and its own claim pair, so it never clears the claim of another operation or another launch. A launch keeps its claim until its success settlement, so G does not reuse a launch while its `postLaunchSetup` or `confirmLaunch` runs. AO puts the handle of a launch into its record with one conditional write on the identity before it. After a write that throws or answers `null`, one strict read decides: the new handle (written), the old identity (one retry), another launch or no record (not own), or a read that throws (unwritable). When the record cannot be read or written, AO removes nothing and warns once (`ao: the record of <id> could not be read or written (<error>), so AO removed nothing: ...`), with the handle in memory, the record file, the worktree, the agent session, and one of three variants: "AO cleared its launch claim while the record held this launch's state before the write (...). The handle above is not recorded.", "The record holds the handle above: the write took effect although it threw. AO cleared its launch claim.", or the variant that says the claim of ao process <pid> may remain and that the record may hold the pending handle or the handle above. Each variant ends with the F-9 line: "Check the runtime by hand (design 5.4.3), then retire the record: ao session kill <id> --confirm-runtime-closed <identity token>.", with the token of the record state that AO knows (both tokens in the third variant; `ao status` shows the current one). While the `ao` process of a claim that remains runs, AO treats the launch as in progress, and `ao start`, `ao session kill` and F-9 refuse it.

**F-9: retire a Herdr record on the owner's word** (design 5.4). `ao session kill <id> --confirm-runtime-closed <identity-token>` (core `kill(id, { confirmRuntimeClosed })`) retires a Herdr record whose stop cannot confirm. No other command passes the option: `cleanup`, `restore`, the lifecycle, `ao start` and the send path never do. Each refusal changes nothing. In order:

1. It reads the record. It accepts only a record whose `runtimeHandle` is a well-formed handle of a runtime in `LAUNCH_END_UNPROVEN_RUNTIMES`, with any status, a kept failed launch, P, an empty pane ID or malformed pins. It refuses a tmux record ("the tmux stop confirms itself"), a record without a handle and a handle that cannot be read (retire those by hand, below).
2. The token must equal `launchIdentityToken` of the record. Else it refuses with "the record now names another launch (identity token <new>); check it again before you retire it".
3. A live launch claim refuses, and so does a handle whose runtime plugin is not loaded.
4. It asks the stop. A confirmed stop (after RH) is a normal kill. Else it makes one `isAlive` with the pins and a 10 s bound. A pane that answers alive refuses ("herdr shows pane <pane> with its terminal at <socket>: the session runs; close it first"). Any other answer is the evidence for the owner's word.
5. One conditional write on the launch identity stores `retiredBy=owner`, `retiredAt`, `retireEvidence` (the answer of step 4, at most 200 characters) and `retiredIdentityToken`. A failed write stops it, with nothing written and nothing removed.
6. Then the kill runs as today, with its check of the launch identity before each removal: it removes a managed worktree (never the project checkout), removes the OpenCode session only with `--purge-session`, and archives the record with the retire keys.

F-9 keeps the project checkout, the agent session (without `--purge-session`), the herdr server, its workspaces and panes, and the prompt file. It sends no herdr request except the one read of step 4. **Residual:** a wrong attestation can remove a worktree that a hidden launch still uses. The token removes the race between the owner's check and the command only for the changes that AO records.

**The owner's check before F-9** (design 5.4.3). Message M, the kill refusal and `ao status` print what the check needs; the record file has the rest.

1. Read the stored handle in the record file (`runtimeHandle`): the pane ID, `terminalId`, `workspaceId`, `workspacePath`, the label (the session or tmux name), `herdrBin`, `herdrSocket`, `createIncomplete`.
2. At the pinned endpoint, run `HERDR_SOCKET_PATH=<socket> <bin> pane get <pane>` and `HERDR_SOCKET_PATH=<socket> <bin> pane process-info --pane <pane>`. Compare `terminal_id` with the stored one, and the processes and their cwd with the worktree.
3. With an empty pane ID, look for the label and the cwd in `HERDR_SOCKET_PATH=<socket> <bin> workspace list`.
4. With malformed pins or P, find the endpoint by hand (`<bin> status server --json` with a candidate `HERDR_SOCKET_PATH`); a failed AO read is not a check. For P, start with the endpoint of the `ao` process that started the launch (above).
5. A missing pane at the pinned endpoint does not find a hidden older server. Also check that no process has its working directory in the worktree, for example `find /proc/[0-9]*/cwd -maxdepth 0 -lname '<worktree>*' 2>/dev/null`.
6. Close the pane by hand only when it belongs to this launch. Then run F-9 with the identity token that the check used.

**Retire a Herdr record by hand** (design 5.4.4). F-9 refuses a record whose runtime handle cannot be read (a `damaged` block of message M) and a record without a handle (upgrade step L-2). Retire such a record by hand. These steps skip AO's record lock and its generation floor: use them only for such a record, as an emergency procedure. The shell lines need bash and GNU coreutils (`realpath`, `sha256sum`, `date`). First set the three values, and find the project's directories with core's rule (`packages/core/src/paths.ts`): the state root, then the first 12 hex digits of the SHA-256 of the directory of the config file's real path, `-`, and the base name of the project's `path`:

```sh
config=/path/to/agent-orchestrator.yaml # the config file that ao start used
project=/path/to/project                # the path of the project in that config
id=app-orchestrator                     # the session ID that message M names
base="$HOME/.agent-orchestrator/$(printf %s "$(dirname "$(realpath "$config")")" | sha256sum | cut -c1-12)-$(basename "$project")"
sessions="$base/sessions"
ls -l "$sessions/$id"
```

When AO ran with `AO_STATE_ROOT` set, use its absolute path in place of `$HOME/.agent-orchestrator`. Stop when `ls` reports no such file: the values do not name the record.

1. Stop the lifecycle worker of the project (the PID in `$base/lifecycle-worker.pid`).
2. Check the runtime as the owner's check above says. Close the pane in herdr only when it belongs to this launch.
3. Move the record into the archive. A fresh sessions directory has no `archive` directory, so create it first (fit-1 note 3, review r2 m-1). The destination is the name that a kill gives, `<id>_<UTC time>` with `-` for each `:` and `.` of the ISO time (for example `app-orchestrator_2026-10-22T21-30-00-000Z`), and the move runs only when no file has that name:

   ```sh
   mkdir -p "$sessions/archive"
   dest="$sessions/archive/${id}_$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)"
   test ! -e "$dest" && mv "$sessions/$id" "$dest"
   test ! -e "$sessions/$id" && ls -l "$dest"
   ```

   When that line exits 1 with no message, `test` found a file of that name, so the record did not move: set `dest` again and repeat the move. A failed `mv` prints its own error. The last line lists the archived record only when the active record is gone.

4. A managed worktree only (an isolated orchestrator or a worker): remove it with `git worktree remove <worktree>`. The project checkout of a project-mode orchestrator stays.

**Herdr fit-2: the send to a blocked agent and the runtime of an old record** (design 5.1 and 4.6).

1. A refused send to a blocked agent. When herdr shows the agent of the pane `blocked` (it waits for an answer to its own question), runtime-herdr `sendMessage` sends nothing more: no prompt, no raw text and no key, because each of them could answer the question. It throws `RuntimeSendRefusedError` (`reason` `agent_blocked`). Core passes it on with no restore. `ao send` prints `ao send: <id>: not sent: the agent in herdr pane <pane> is blocked and waits for input (agent_blocked). Answer it in the pane (ao session attach <id>), then send again.` on stderr and exits 1; when an earlier prompt of the same send may have reached the agent, the line adds `An earlier prompt of this send may have been delivered; check the pane before you send again.` Answer the question in the pane, then send again.
2. Restore and the runtime of an old record. Restore, the start's probe and stop, kill, list and the cleanup's dead-runtime rule go through the runtime of the stored handle (`runtimeForHandle`); a new launch still creates through the project's selected runtime. When the handle names herdr and no herdr plugin is loaded, no other runtime answers for it: the start's probe is unknown, the stops refuse, the kill refuses with "no runtime plugin herdr is loaded", and list and cleanup make no probe for it. Restore refuses at step 7, like an unconfirmed stop, a record whose `runtimeHandle` text gives no handle but names herdr (or that a Herdr project stored): "the runtime handle of <id> cannot be read (...); retire it by hand" (the by-hand recipe above). A second restore of a kept failed launch refuses at step 7 too (the Herdr stop answers `unknown`). After a failed workspace restore or a plain create error, restore writes its transition back (the earlier `runtimeHandle` and `restoredAt`; it clears only a claim that it took itself); when it cannot, it warns "AO could not write back the record of <id>; ...; check runtimeHandle, restoredAt, launchPid and launchPidStart, then retire it with F-9.", followed by the F-9 line with the identity token of its transition write.

`ao stop` (`registerStop`) kills the session first and stops the lifecycle worker only after a confirmed kill (same-ID R2a). The kill hangs up every pane of the killed session, so an `ao stop` that runs in one of them would end between the kill and the archive and lifecycle stop. A check of where the caller runs cannot be trusted (an empty `#{session_name}` answer, TMUX without TMUX_PANE, a tmux call that does not answer: review r1 M-1 and M-2), so there is none: the stop of every existing orchestrator record runs in a detached process, from inside the session and from outside (`startDetachedStop` in `packages/cli/src/lib/lifecycle-service.ts`: its own session, stdin closed, the caller's environment with TMUX and PATH unchanged, the hidden flag `--detached-stop-process`, and a stdout log and a stderr log of its own, `<project base>/orchestrator-stop-<time>-<caller PID>-<random>.stdout.log` and `.stderr.log`, created exclusively; when the next detached stop starts, it removes such logs older than 7 days: only regular files, found with `lstat` (a symlink is never removed or followed), with exactly that name grammar, so `orchestrator-stop.log` of round 1 and other files stay). The caller prints the heading and copies the detached stderr and stdout to its own stderr and stdout while the stop runs (stderr first on each copy, as the stop writes its spinner and refusal lines before its stdout lines). It copies all of both logs, also to a slow reader (review r2 M-1): each 64 KiB chunk is written, and its write has ended, before the next is read, and the caller sets `process.exitCode` to the detached exit code (1 when a signal ended it or it did not start) and returns, so Node ends the process only after every byte left. A stop from outside therefore gives the same end state, text and exit code as before. An error of the caller's own output (EPIPE when the reader closed, for example) ends the copy to that stream only: the caller reports it on the other stream with the log path, and the exit code stays the detached one. Inside the session, a confirmed kill ends the caller's pane and the detached process archives the record and stops the lifecycle worker; a refused kill keeps the session, the record and the lifecycle worker, and the caller prints the refusal and exits 1. Ctrl-C ends only the caller (exit 130) as soon as its note is written, or after 2 s when the reader does not take the note (a second Ctrl-C ends it at once): the detached stop goes on, the note names its PID and its logs, and output that a slow reader has not taken yet is dropped (at most one chunk for each stream is queued; the logs keep all of it). The caller waits for the detached stop with no deadline, as the result of the stop is not known before it ends; when the stop still runs after 30 s, the caller writes one note on stderr (on stdout when stderr has an output error, also one that the note's own write finds) that names the detached PID and the logs and says that Ctrl-C leaves the stop running. The note does not wait for the copy of the other stream; on its own stream it waits for the chunk write in progress, and it is not written when the stop has ended by then. Ending the caller does not cancel the stop. When no record exists, `ao stop` stops the lifecycle worker in its own process as before.

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
