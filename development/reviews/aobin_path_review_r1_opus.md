# Review R1: the `~/.ao/bin` PATH fix (`825b0dbc..345f1e6e`) (reviewer: Claude Opus 5.5)

**Verdict: NOT-LAND-SAFE**

1 blocker, 4 major, 13 minor. The root-cause observation is right, and the hypothesis from the
orchestrator holds: tmux 3.4 replaces the PATH of a new pane with the PATH of the unattached client
that runs `new-session`. The fix does not use that cause. It types `export PATH=<built PATH>` into the
pane after the shell startup files run. That replaces the whole shell PATH with a PATH that has
`/usr/local/bin` in position 2. On this host, `/usr/local/bin/claude` is a stale Claude Code 1.0.112 that
crashes on Node v25. So after the rebuild, every new, restored or orchestrator Claude Code pane on every
fleet fails to start, and spawn then types the task prompt into `bash`, which runs it line by line (B-1).
Running the `tmux` client with the built PATH in its process environment fixes the cause and removes B-1
(M-1). The wrappers themselves work for the plain cases. Some branch and merge cases write wrong
session records (M-2, M-3), and the Claude Code part needs an owner decision (M-4).

Reviewed at `345f1e6e` (`git log --oneline -1` matches). Host: Linux, tmux 3.4, Node v25.7.0, login
shell `/bin/bash` (startup measured at 1.18 s with `bash -lic exit`), git 2.43.0, gh 2.45.0 at
`/usr/bin/gh`. I read the author's report only after items 1 to 3.

Isolation: every live run used `HOME` under `/tmp/pathrev-opus/`. Raw tmux tests used `tmux -L
pathrev-opus-raw` with `TMUX` removed. The runtime-tmux runs before 11:42 used a private server through
`env -u TMUX TMUX_TMPDIR=/tmp/pathrev-opus/tsock` (never the default socket), session names `pathrev-*`.
After the orchestrator's 11:42 rule, every tmux command used `env -u TMUX tmux -L <name>`, and the test
runs used a `tmux` shim that forces `-L pathrev-opus-test`. The 11:41 outage came from another shell
(resume note). The real `~/.ao/bin` is unchanged (listings at the end).

## Item 1: the root cause

Evidence on `tmux -L pathrev-opus-raw` (tmux 3.4). The server was started by a client with
`PATH=/srvA:/usr/bin:/bin`. Each pane command is `/usr/bin/env > file` (no shell).

| case | client PATH | `-e PATH` | client attached? | `show-environment` PATH | pane PATH | pane `FOO` |
| --- | --- | --- | --- | --- | --- | --- |
| t1 | `/cliB:…` | `/fromE:…` | no (`new-session -d`) | `/fromE:…` | `/cliB:…` | `fromE` |
| t2 | none (`env -u PATH`) | `/fromE2:…` | no | — | `/fromE2:…` | `fromE2` |
| t3 | `/builtC:…` | none | no | — | `/builtC:…` | — |
| t4 | `/cliD:…` | `/fromE4:…` | yes (`attach \; new-window -e …` under `script`) | — | `/fromE4:…` | `e4` |

So the pane PATH is neither the `-e` value nor the server global (`/srvA`). It is the PATH of the client
process, and only when that client is not attached (t4). The tmux 3.4 source says the same,
`spawn.c` at tag `3.4` (`https://raw.githubusercontent.com/tmux/tmux/3.4/spawn.c`):

```c
309	/* Create an environment for this pane. */
...
320	if (c != NULL && c->session == NULL) { /* only unattached clients */
321		ee = environ_find(c->environ, "PATH");
322		if (ee != NULL)
323			environ_set(child, "PATH", 0, "%s", ee->value);
```

`runtime-tmux` runs `tmux new-session -d` through `execFile` with the `ao` process environment
(`packages/plugins/runtime-tmux/src/index.ts:45-50`, `:67`). The pane therefore gets the PATH of the `ao`
process, and the login shell then prepends its own directories. That is the "`~/.local/bin` twice" that
the orchestrator measured.

**Which fix is right for this increment:** pass the built PATH in the `execFile` environment of the
`new-session` call, and remove the typed export. I ran that variant (a 10-line driver that calls
`execFile("tmux", ["new-session", …], { env: { ...process.env, PATH } })`) against the same private server,
with the real shell startup files in the pane:

| variant | pane PATH length | `~/.ao/bin` position | `claude` | `gemini` | create time |
| --- | --- | --- | --- | --- | --- |
| `825b0dbc` (all four agents) | 3405 | absent | `~/.local/bin/claude` | `~/bin/gemini` | 18-28 ms |
| `345f1e6e` (all four agents) | 636 | 1 | `/usr/local/bin/claude` | `/usr/local/bin/gemini` | 345-350 ms |
| `execFile` env (claude-code, codex) | 1177 | 18 | `~/.local/bin/claude` | `~/bin/gemini` | 21-28 ms |

In the `execFile` variant, no directory in positions 1 to 17 holds a `git` or `gh`, so the wrappers still
catch every call. Agent binaries resolve as they do today, because the startup files prepend
`~/.local/bin`, `~/bin` and `~/.opencode/bin` ahead of the built PATH. The variant also removes the
300 ms, the typed line, the 4 KB limit and the shell-syntax assumption (m-1 to m-3). One limit stays:
a startup file that resets PATH instead of prepending would drop `~/.ao/bin`. This host's files only
prepend or append (`grep -n PATH` of `~/.bash_profile` and `~/.bashrc`).

## Findings

### B-1: every new Claude Code pane starts a broken `/usr/local/bin/claude`, then runs its prompt in bash

- Files: `packages/plugins/runtime-tmux/src/index.ts:80-85` (the typed export replaces the whole shell
  PATH after the startup files ran), `packages/plugins/agent-claude-code/src/index.ts:725` (claude-code
  now supplies a PATH), `packages/core/src/agent-workspace-hooks.ts:56-57` (`/usr/local/bin` is put in
  position 2), `packages/plugins/agent-claude-code/src/index.ts:674` (the launch command calls bare
  `claude`).
- Host facts: `/usr/local/bin/claude` links to `/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js`,
  version `1.0.112`. `~/.local/bin/claude` is `2.1.301`. Under the built PATH:

      claude -> /usr/local/bin/claude
      $ claude --version   ->  exit=1
      TypeError: Cannot read properties of undefined (reading 'prototype')
          at file:///usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js:491:6240
      Node.js v25.7.0

- Pane evidence: the runtime-tmux driver with the claude-code `getEnvironment` (table in item 1) gives
  `claude=/usr/local/bin/claude` at `345f1e6e` and `claude=/home/taisung/.local/bin/claude` at `825b0dbc`.
- All three pane paths are affected: `spawn` (`packages/core/src/session-manager.ts:1134`),
  `spawnOrchestrator` (`:1562`, used by `ao start`, `packages/cli/src/commands/start.ts:950`) and
  `restore` (`:2570`). All of them call `runtime.create` with `agent.getEnvironment()`.
- Worse than a failed start: claude-code uses `promptDelivery: "post-launch"`. Spawn waits 3 s and then
  types the prompt with `runtime.sendMessage` (`session-manager.ts:1254-1266`). It does not check that the
  agent runs. With the agent dead, `bash` receives the prompt and runs each line. Reproducer (private
  server `tmux -L pathrev-opus-b1`, launch command `claude --version`, which crashes on load in the same
  way, then a 3-line prompt through `runtime.sendMessage`):

      $ Work on issue: demo. Read the task file and execute it.
      Command 'Work' not found, ...
      $ When done, the check `touch /tmp/pathrev-opus/b1-executed` must pass.
      Command 'When' not found, ...
      $ Use conventional commits (feat:, fix:).
      -bash: syntax error near unexpected token `('
      --- marker file created by bash from the prompt text: YES

  The backtick command in the prompt ran in the worker's worktree. Real task prompts contain backtick
  commands (`git ...`, `ao send ...`, paths), so after the rebuild any such command in a Claude Code task
  prompt runs as the owner. `ao spawn` reports success (`runtime.create` returns). The fleet watcher's
  idle rule fires after `--idle-min` (default 20 min). I did not check whether one of its error patterns
  matches the crash text earlier.
- Same mechanism, other agents: `gemini` resolves to `/usr/local/bin/gemini` 0.29.7 (the nvm copy is
  0.45.1, and today's panes run `~/bin/gemini`, a personal script). `codex` is not affected while
  `resolveCodexBinary` (`packages/plugins/agent-codex/src/index.ts:257-286`) finds an absolute path. Its
  bare fallback would run `/usr/local/bin/codex` 0.104.0. `opencode` has no copy in `/usr/local/bin`.
- Fix: M-1 (the `execFile` env) removes B-1 on this host, as measured in item 1. Also consider to stop
  the `/usr/local/bin` promotion in `buildAgentPath`: `GH_PATH` already selects gh, and this host has no
  `gh` in `/usr/local/bin`.

### M-1: the fix types into the pane instead of fixing the cause that tmux shows

- File: `packages/plugins/runtime-tmux/src/index.ts:73-85`.
- Evidence: item 1. The comment at `:73-79` and the commit body say that tmux "does not propagate PATH
  from `-e`". The tmux source and t1 to t4 show that tmux replaces it with the client PATH, and only for
  an unattached client. The typed export works around that, and it brings B-1, m-1, m-2 and m-3. It also
  needs a POSIX shell: `export PATH='…'` fails in a csh or tcsh login shell (not measured here, the host
  shell is bash).
- Fix: in `create()`, run `new-session` with `env: { ...process.env, PATH: config.environment.PATH }`
  when the environment has a PATH, and remove the `send-keys` block. Keep `-e PATH` if `show-environment`
  must show it. Change the test to assert the relation: the `env.PATH` of the `new-session` call equals
  `environment.PATH`, and no `send-keys` call contains `export`.

### M-2: the git wrapper writes a wrong `branch` for common commands, now on every agent

- File: `packages/core/src/agent-workspace-hooks.ts:256-264` (`GIT_WRAPPER`). This text is from before
  this commit, but this commit makes it run in every pane.
- Evidence (wrapper 0.2.2 under `HOME=/tmp/pathrev-opus/whome`, a real repository, a real metadata file):

  | command (exit 0) | real HEAD after | `branch=` written |
  | --- | --- | --- |
  | `git checkout -- src/a.txt` | `main` | `src/a.txt` |
  | `git switch --detach origin/main` | detached | `origin/main` |
  | `git checkout origin/main -- src/a.txt` | `main` | `origin/main` |
  | orchestrator: `git switch feat/worker-x`, then `git checkout main` | `main` | `feat/worker-x` (stays) |
  | `git checkout feat/worker-x` in a new worktree, as `workspace-worktree/src/index.ts:135` runs it during `ao spawn` from the orchestrator pane | — | `feat/worker-x` written into the orchestrator's record |

  The Claude Code hook alone does not write the first two rows (it skips a first argument that starts
  with `-`). It also writes `origin/main` for the third row.
- Effect: the lifecycle detects a PR by the stored branch when `pr` is missing
  (`packages/core/src/lifecycle-manager.ts:452-475`), and `restore` of a missing worktree checks out the
  stored branch (`packages/core/src/session-manager.ts:2496-2512`). `ao status` shows the live branch
  (`packages/cli/src/commands/status.ts:88-91`), so the display hides the wrong value.
- Fix: in the `checkout/*|switch/*` branch, skip when any argument is `--`, `--detach`, `-d`, or when the
  name is a remote-tracking ref (`git rev-parse --verify --quiet refs/remotes/<name>`). Better: after a
  successful checkout or switch, read `git symbolic-ref --short -q HEAD` and write that, or nothing when
  HEAD is detached.

### M-3: `gh pr merge` writes `status=merged` into the session that ran it

- File: `packages/core/src/agent-workspace-hooks.ts:196-198` (`GH_WRAPPER`).
- Evidence: from an orchestrator record (`role=orchestrator`), `gh pr merge 42 --squash` through the
  wrapper gives `status=merged` for the orchestrator. In a worker record with `status=pr_open`,
  `gh pr merge --auto --squash` gives `status=merged`, although auto-merge only queues the merge.
- Effect: `merged` is a terminal status (`packages/core/src/types.ts:113-120`). The lifecycle writes a
  status only on a transition (`lifecycle-manager.ts:1186-1195`), so a running lifecycle leaves the wrong
  value in the file. After a lifecycle restart the session is no longer polled
  (`lifecycle-manager.ts:1305-1309`): no CI or review forwarding, and it counts as complete for
  `summary.all_complete` (`:1339`).
- For Claude Code panes the PostToolUse hook already does this for a direct `gh pr merge` Bash call. The
  wrapper adds codex, gemini and opencode, and calls from scripts in every pane.
- Fix: do not write `merged` from the wrapper. Let the lifecycle find the PR state. At least skip
  `--auto`, and skip when the PR number or URL in the arguments is not the session's own `pr`.

### M-4: Claude Code panes get the wrappers without installing them, on top of the hook

- Files: `packages/plugins/agent-claude-code/src/index.ts:720-726` (PATH and GH_PATH),
  `:875-885` (`setupWorkspaceHooks` and `postLaunchSetup` install only the hook),
  `packages/core/src/agent-workspace-hooks.ts:8` (header still says Claude Code uses its own hook instead).
- Evidence: only codex, gemini and opencode call `setupPathWrapperWorkspace`. A fleet with only Claude
  Code workers keeps whatever `~/.ao/bin` holds (today 0.2.1 from 2026-09-16, or nothing on a new host).
  For the same commands, the hook and the wrapper write (hook run with a JSON input on stdin, wrapper run
  for real):

  | command | wrapper writes | hook writes | final (hook runs last) |
  | --- | --- | --- | --- |
  | `git checkout -b "feat/quoted"` | `feat/quoted` | `"feat/quoted"` (quotes kept) | `"feat/quoted"` |
  | `git checkout -- src/a.txt` | `src/a.txt` | nothing | `src/a.txt` |
  | `git switch --detach origin/main` | `origin/main` | nothing | `origin/main` |
  | `cd /x && gh pr create --fill` | `pr=<url>`, `status=pr_open` | same | same |
  | `gh pr merge 42 --squash` | `status=merged` | same | same |

  The two writes are sequential in one pane (wrapper during the Bash call, hook after it), so they do not
  race with each other. Each is a read-modify-write without a lock (wrapper temp `.tmp.$$`, hook temp a
  fixed `.tmp`), as before against the lifecycle writer. The PR values are equal. The wrapper adds the
  wrong `branch` cases of M-2 and the `merged` cases of M-3 from scripts, and 14 ms per `git` call (m-4).
- Recommendation: in this increment, keep Claude Code on its hook only: remove `PATH` and `GH_PATH` from
  its `getEnvironment`. If the owner wants the wrappers in Claude Code panes, install them from the
  Claude Code plugin and decide which writer owns which key.

### m-1: 300 ms more for every `runtime.create`

- File: `packages/plugins/runtime-tmux/src/index.ts:83`. Measured create time: 345-350 ms at `345f1e6e`
  against 18-28 ms at `825b0dbc` and in the `execFile` variant. This applies to spawn, orchestrator start
  and restore, in series for batch spawns.

### m-2: the typed export shows as a wall of text at the top of every pane

- At 80 columns the line takes 9 rows, and it shows twice: once from the tty echo while the shell starts,
  once from readline. The design note at `runtime-tmux/src/index.ts:69-71` exists to avoid exactly that.
- The ao classifiers do not change state for it. `detectActivity` of all four agents gives the same
  result for the `825b0dbc`, `345f1e6e` and `execFile` captures. `ao send` reads 20 lines
  (`packages/cli/src/commands/send.ts:178-188`), and the agent UI fills the bottom of the pane. The fleet
  watcher captures `-J -S -40` (`agent-skills/scripts/fleet_watch.sh:1169`), so the joined line can be
  inside its capture in the first screens of an inline UI. I did not run its classifier on this text.

### m-3: a typed export longer than 4095 bytes breaks the pane

- The keys arrive while the login shell still runs its startup files (1.18 s here), so the tty is in
  canonical mode and keeps at most 4095 bytes per line. Reproducer: runtime-tmux with a 4342-character
  PATH (export line 4356 bytes). The closing quote is lost, `bash` waits at the `>` prompt, the launch
  command becomes part of the string, the agent never starts, and `create()` returns success:

      $ export PATH='/tmp/pathrev-opus/long/dir-number-0000:...
      > printf '%s\n' "$PATH" > /tmp/pathrev-opus/out/long.txt
      >

- Not hit today: the built PATH after deduplication is 627 to 636 characters. A PATH with a quote, a
  space, `$`, `"` or a backtick round-trips exactly through `shellEscape`.

### m-4: the git wrapper adds about 14 ms to every `git` call in a pane

- Measured, 100 calls each in `/tmp/pathrev-opus/wrepo`: `git status --short` 5.7 ms without the wrapper,
  19.6 ms with it. `git rev-parse HEAD` 4.8 ms against 19.7 ms. This applies to every `git` that resolves
  through the pane PATH: the worker's calls, git hooks that call `git`, and the `ao` CLI when it runs in
  a pane (for example `ao status`, `ao spawn`).

### m-5: `gh pr create` and `gh pr merge` merge stderr into stdout

- File: `packages/core/src/agent-workspace-hooks.ts:183` (`"$real_gh" "$@" 2>&1 | tee "$tmpout"`).
- Evidence with a fake gh that writes one line to stderr: through the wrapper, that line arrives on
  stdout and stderr is empty. Other subcommands (`gh pr view`) keep stderr separate. gh's stdout is a
  pipe there, so gh sees no terminal. A caller that does `URL=$(gh pr create …)` gets gh's stderr text in
  the value. No script in `agent-skills/scripts` or `agent-skills/skills` does that today (grep).

### m-6: the git wrapper misses some branch creations

- `git checkout -q -b feat/q`, `git switch -q -c …` and `git -C <dir> checkout -b feat/c` write nothing
  (it matches only `$1/$2`). The author documents the `-C` case. The hook misses them too.

### m-7: the recursion guard depends on the exact spelling of the PATH entry

- File: `packages/core/src/agent-workspace-hooks.ts:227-229` (and `:147-148` for gh). The wrapper removes
  only the exact string of its own directory. With `PATH=$HOME/.ao/bin/:/usr/bin:/bin` (trailing slash),
  `command -v git` finds the wrapper again, without end. Reproducer under `prlimit --nproc=<current+80>`
  and `timeout -s KILL 4`: `git --version` never ran, stderr shows
  `…/.ao/bin/git: fork: retry: Resource temporarily unavailable`, no process stayed. Without a limit this
  uses up the user's process limit for every fleet. `buildAgentPath` does not create such an entry, so the
  risk is low, but a guard variable (for example `AO_WRAPPER_DEPTH`) costs one line.

### m-8: two builds with different `WRAPPER_VERSION` rewrite the shared directory in turns

- Evidence under `HOME=/tmp/pathrev-opus/whome2`: new build, then `825b0dbc` build, then new build gives
  marker `0.2.2` (git 1506 B), `0.2.1` (1333 B), `0.2.2` (1506 B). Each write is atomic, so a reader
  never sees a half file. It matters only while a long-lived process with the old build still spawns.

### m-9: tests copy source literals, and two behaviours have no discriminating test

- No test covers the new no-op `update_ao_metadata`. With both no-op blocks removed (mutation M3), core,
  codex, gemini and opencode tests all pass.
- `agent-workspace-hooks-version.test.ts:82-89`: `mtimeBefore` holds the marker content, not a time, so
  the test cannot see a rewrite. With "always rewrite" (mutation M2) it passes. Only the mocked core test
  "skips wrapper rewrite when version matches and files are current" catches M2.
- `"0.2.2"` is copied 12 times into 4 test files because `WRAPPER_VERSION` is not exported. For that
  reason the codex "repairs wrapper writes…" and gemini "repairs gh/git wrappers…" tests pass on
  `825b0dbc`: there they hit a version mismatch, not the repair path. With the version kept and the
  content check removed (mutation M1), they do fail, so they are not vacuous at `345f1e6e`. Export the
  version, or read it from the marker that a first install writes.
- `runtime-tmux/src/__tests__/index.test.ts:150-155` asserts the literal `export PATH='…'` string and has
  no PATH that needs quoting. `agent-claude-code/src/index.test.ts:275` and `agent-gemini/src/index.test.ts:265`
  copy `"/usr/local/bin/gh"` instead of importing `PREFERRED_GH_PATH`.

### m-10: the runtime-tmux tests clear mocks but keep queued once-values

- `runtime-tmux/src/__tests__/index.test.ts:58` uses `vi.clearAllMocks()`, and the helpers queue
  `mockResolvedValueOnce`. When `create()` makes fewer calls than queued, the rest feeds later tests. On
  `825b0dbc` sources the new test gives 7 failures in the full file and 1 alone. On `345f1e6e` the new
  tests use all their queued values: 5 runs with `--sequence.shuffle` (seeds 1 to 5) all pass 28/28. So
  no leak now, but one future failure in `create()` shows as a cascade. `vi.resetAllMocks()` or
  `mockReset` in `beforeEach` stops that.

### m-11: the comments and the commit body describe the wrong mechanism

- `runtime-tmux/src/index.ts:73-79`, `agent-workspace-hooks.ts:320-322` ("tmux panes lose PATH") and the
  commit body say that tmux does not deliver `-e PATH`. It delivers the client PATH instead (item 1). The
  author's report also says the pane PATH comes from the "global" environment; t1 shows it is the client.

### m-12: the commit subject has no scope, and the type is `feat` for a bug fix

- `feat: put ao wrappers on every agent pane PATH`. The fork format is `<type>(<scope>): <summary>`, for
  example `fix(runtime-tmux): …`. The body says WHY, has no trailer, no emoji and no issue number.

### m-13: Herdr is not covered

- `packages/plugins/runtime-herdr/src/index.ts:259-273` passes `--env PATH=…` to `herdr workspace
  create`. Whether that reaches the pane is not measured: the Herdr server is shared with the owner's
  workspaces, so I did not run it. Severity is low: both fleet configs say `runtime: tmux`
  (`/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml:2`, `/home/taisung/agent-skills/agent-orchestrator.yaml:2`),
  and a loss would only keep today's state (no wrappers). `newSession` in `packages/core/src/tmux.ts:93`
  has the same `-e PATH` pattern, but nothing calls it.

## Answers by item

**Item 2 (side effects of the typed export).** (a) typed line: m-2, no state change in the ao
classifiers. (b) 300 ms: m-1. (c) slow startup: the typed keys wait in the tty while `~/.bashrc` (nvm)
runs, and they work up to 4095 bytes (m-3). A non-POSIX shell cannot run them (M-1). (d) quote, space,
`$`: exact round-trip. (e) spawn, orchestrator start and restore all go through `runtime.create` (B-1).
Herdr: m-13.

**Item 3 (Claude Code with the wrappers).** M-4. The plugin does not install the wrappers. The hook and
the wrapper write the same PR values, one after the other. They differ for `branch`. They do not race with
each other. My recommendation is to keep Claude Code on its hook in this increment.

**Item 4 (install and version bump).** Each file is written to `<name>.tmp.<hex>` and renamed
(`agent-workspace-hooks.ts:299-304`), the helper first and the marker last (`:354-362`). A `git` call in
another pane sees the old or the new file, never a half file. A running `bash` keeps the old inode. Two
fleets at the same moment write the same content under different temp names, and the last rename wins.
The check compares the exact content of three files and the marker: 2 to 6 ms per call, measured. Note:
only a codex, gemini or opencode spawn runs the install, not a Claude Code spawn (M-4). Repair results,
under `HOME=/tmp/pathrev-opus/whome`:

| start state | `825b0dbc` build | `345f1e6e` build |
| --- | --- | --- |
| empty `~/.ao/bin` | writes 0.2.1 | writes helper 2350 B, gh 1930 B, git 1506 B, marker `0.2.2` |
| current marker and files | skips | skips (mtimes unchanged) |
| current marker, `git` missing | skips (git stays missing) | rewrites, `git` back |
| current marker, `gh` hand-edited | skips | rewrites `gh` |

I ran every `345f1e6e` cell and the first and third `825b0dbc` cells. The other two `825b0dbc` cells
follow from its marker-only check (`needsUpdate = false` when the marker matches).

The real `~/.ao/bin` holds the 0.2.1 constants of `825b0dbc` byte for byte (`cmp` on all four files).

**Item 5 (wrappers once active).** Wrapper 0.2.2 under `HOME=/tmp/pathrev-opus/whome`,
`PATH=$HOME/.ao/bin:/usr/bin:/bin`, `GH_PATH=/usr/local/bin/gh` (absent on this host, as in real panes):

| call | result |
| --- | --- |
| `git status` | exit 0, output equal to `/usr/bin/git status` |
| `echo "msg from stdin" \| git commit --allow-empty -F -` | exit 0, subject `msg from stdin` |
| `git checkout -b feat/a`, `git switch -c feat/b` | exit 0, `branch=feat/a`, then `branch=feat/b` |
| `git -C <repo> checkout -b feat/c` | exit 0, no write (m-6) |
| `git checkout no-such-branch` | exit 1, git's error on stderr, no write |
| `gh --version` (real gh) | exit 0, output equal to `/usr/bin/gh --version` (`gh version 2.45.0`) |
| `gh pr create --title "it's a $title with spaces" --body-file -` (fake gh first on PATH, body on stdin) | exit 0, 6 arguments unchanged, stdin passed, `pr=…/pull/42`, `status=pr_open`, stderr on stdout (m-5) |
| same with the fake exiting 4 | exit 4, no write |
| `gh pr merge 42 --squash` | `status=merged` (M-3) |
| `GH_PATH=$HOME/.ao/bin/gh gh api x` (self reference) | guard works, the fake gh runs, no loop |
| `AO_SESSION` without a metadata file | exit 0, git output only, no file created |
| no `AO_*` variables | exit 0, git output only |
| helper missing, wrapper 0.2.2 | exit 0, no extra stderr, no write |
| helper missing, wrapper 0.2.1 (today's host files) | exit 0, plus `…/git: line 26: update_ao_metadata: command not found` |
| trailing-slash PATH entry | endless recursion (m-7) |

Orchestrator commands through the wrapper with an orchestrator record: `git cherry-pick <sha>`,
`git merge --ff-only`, `git rebase main feat/worker-x`, `git worktree add -b`, `git checkout main` write
nothing. `git switch feat/worker-x`, a spawn-style `git checkout feat/worker-x` in a new worktree, and
`gh pr merge` write into the orchestrator's own record (M-2, M-3).

## Item 6: what changes for workers (for the owner, before the rebuild)

After the rebuild, each new or restored agent pane on every fleet has `~/.ao/bin` on its PATH, so each
`git` and `gh` call in the pane first runs a small ao script. The script runs the real `git` or `gh` with
the same arguments, input, output and exit code, and adds about 14 ms per call. After `git checkout -b`,
`git switch -c`, a switch to a branch name with `-` or `/`, `gh pr create` and `gh pr merge`, it also
writes the session record (branch, PR link, status). As committed, the change also makes new Claude Code
panes start an old, broken `claude` from `/usr/local/bin`, so those workers do not start and their task
text then runs as shell commands: this must be fixed before the rebuild. Even after that fix, some
commands write a wrong record: `git checkout -- <file>` stores the file name as the branch, and
`gh pr merge` (also with `--auto`, or when the orchestrator merges a worker's PR) marks the session that
ran it as merged. For `gh pr create` and `gh pr merge`, gh's error text also appears on standard output.

## Item 7: tests

All runs used `env -u TMUX -u ANTHROPIC_API_KEY -u OPENAI_API_KEY HOME=/tmp/pathrev-opus/testhome` and the
`tmux` shim that forces `-L pathrev-opus-test`.

- `pnpm install && pnpm build`: exit 0.
- Package tests: core `Test Files 31 passed (31)`, `Tests 646 passed (646)`. runtime-tmux `1 passed`,
  `28 passed (28)`. claude-code `3 passed`, `156 passed (156)`. codex `3 passed`, `215 passed (215)`.
  gemini `1 passed`, `58 passed (58)`.
- `typecheck` filters of the five packages: all exit 0. `pnpm lint`: exit 0, `6 problems (0 errors,
  6 warnings)`, none in a changed file. `prettier --check` warns on 3 changed files, and on the same 3
  files at `825b0dbc`, outside the changed lines.
- Full `pnpm test`: exit 0. Sum of the package summary lines: 1890 passed, 29 skipped (1919). Integration:
  `Test Files 10 passed | 3 skipped (13)`, `Tests 95 passed | 24 skipped (119)`. The 24 skipped are
  prompt-delivery 4, agent-claude-code 10, agent-codex 5, agent-opencode 5: they need API keys or
  OpenCode credentials under `HOME`, which my isolation removes. The author's run (real `HOME`) had
  15 skipped and 1899 passed, also 1919. The known baseline at `6abab58d` was 1890 + 20 = 1910, and this
  commit adds 9 tests.
- D2 to D7 of the author brief: D2 is right for the pane PATH, but it checks only that `~/.ao/bin` is
  present, not what the new PATH resolves, which hides B-1. D3 and D4 reproduce (item 4, item 5). D5:
  the author's listing matches mine. D6 and D7: below and above.
- Non-vacuity, new tests on `825b0dbc` sources (`/tmp/pathrev-opus/nv`): core 4 failed
  (`skips wrapper rewrite when version matches and files are current`, `leaves files untouched when the
  marker and all files are current`, `repairs wrapper files when the marker is current but files are
  stale or missing`, `replaces the pre-allowlist helper when the marker has the previous version`).
  claude-code 2 failed (PATH, GH_PATH). codex 1 failed (`writes version marker after installing
  wrappers`, literal only). gemini 2 failed (GH_PATH, dedupe). runtime-tmux 1 failed alone (`re-exports
  PATH…`), 7 in the full file (m-10). Mutations of `345f1e6e` are in m-9.

## Item 8: scope and commits

Changed files: `packages/core/src/agent-workspace-hooks.ts` and its two test files,
`packages/plugins/runtime-tmux/src/index.ts` and `src/__tests__/index.test.ts`, the `getEnvironment`
code (plus imports, and the removed `AO_BIN_DIR` constant of gemini) and the tests of claude-code and
gemini, and the codex test. All are allowed by the author brief. Neither `session-manager.ts` nor the
OpenCode plugin changed. The message has the WHY, no `Co-Authored-By`, no emoji and no issue number (m-12
for the format). `git branch -r --contains 345f1e6e` prints nothing.

## What I found correct

- The observation of cause 1 (PATH in `show-environment` but not in the pane, other `-e` variables in
  the pane) reproduces exactly.
- The install repair: an exact content check of three files and the marker, atomic temp-and-rename
  writes, the marker last, 2 to 6 ms. It repairs a missing and an edited file.
- The no-op `update_ao_metadata` removes the `command not found` line that the 0.2.1 wrappers print.
- The wrappers keep arguments (quote, space, `$`), stdin and exit codes. `git status` and `gh --version`
  output is unchanged. A missing metadata file is silent. The `GH_PATH` self-reference guard works.
- `shellEscape` round-trips a PATH with a quote, a space, `$`, `"` and a backtick.
- The gemini move to `buildAgentPath` (lazy `homedir`, deduplication) is right in itself.
- All three pane paths go through the one `runtime.create`, so one runtime fix covers them.
- Scope and commit hygiene, except m-12.

## For round 2

1. Replace the typed export with the `execFile` env of `new-session` (M-1). Re-run the pane check and
   print `command -v claude codex gemini opencode git gh` for each agent (B-1).
2. Decide M-4. My recommendation: no PATH change for Claude Code in this increment.
3. Fix or disable the wrong writes of M-2 and M-3 before the wrappers go live on all fleets.
4. Add tests for the no-op fallback and a rewrite-detecting "skip" test (m-9).

## Real `~/.ao/bin`, before and after

Before (2026-10-15 11:28 EDT) and after (after the last run) are identical:

    total 24
    drwxr-xr-x 2 taisung users 4096 2026-09-16 13:01:16.796056907 -0400 .
    drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
    -rwxr-xr-x 1 taisung users 2350 2026-09-16 13:01:16.794056970 -0400 ao-metadata-helper.sh
    -rw-r--r-- 1 taisung users    5 2026-09-16 13:01:16.796056907 -0400 .ao-version
    -rwxr-xr-x 1 taisung users 1758 2026-09-16 13:01:16.794056970 -0400 gh
    -rwxr-xr-x 1 taisung users 1333 2026-09-16 13:01:16.795056939 -0400 git
