# Same-ID R1 source and runtime review (ao-53)

NOT-LAND-SAFE

Range: `c516cead..5b363474`; tip verified `5b363474`. Findings: **0 B, 1 M, 2 m**;
**1 F** follow-up. **M-1 requires a fix before landing**: the exported core creator
can leave a live tmux session behind after the new target validation rejects it.
The target conversion itself is correct. All requested gates pass; this is a
missing boundary-validation case that those tests do not cover.
No code changes, commit, push, PR, or network gh call are authorized by this review.
All runs use `/tmp/aosrv/ao53`, a fake HOME, an empty inherited environment, a gh stub,
and a tmux shim selecting private server `aosrv-ao53`. Agent binaries are absent from
the test PATH. Live runs used a scratch stand-in named claude.

## Evidence recorded while working

- `/tmp/aosrv-marker` touched before investigation. Initial worktree status: only
  untracked `.agent_task.md` and `.agent_report.md`. No node_modules initially.
- The real `~/.ao/bin` listing before work:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

- Frozen-lockfile install passed using fake HOME and a PATH with only node/pnpm links,
  tmux/gh shims and `/usr/bin:/bin`; `HUSKY=0` skipped installation of git hooks (no commits
  are being made). Build passed in this worktree before any test or runtime run.
- Independent source search covered tmux strings, `-t`, generated command strings,
  CLI and `core/src/orchestrator-prompt.ts`. All executable production target sites
  found use the appropriate helper (full inventory follows). The prompt contains
  command names without target arguments, not a missed executable target.
- Foreground `TMUX_PANE_GONE` is consumed only by the two readiness waits; it is
  not consumed by cleanup or a record/worktree deletion. `getTmuxActivity` already
  mapped empty output to null at the base; R1 changes its target, not that mapping.

- Live built-plugin checks completed independently before consulting the author's report:
  dead `kr-1` with only `kr-10` live: runtime `isAlive=false`, destroy kept the bystander,
  send rejected before text, output empty, claude process check false, CLI send exit 1,
  activity null. With `other` / window `kr-1` added, the same negative outcomes held,
  including `getTmuxPaneTTY=null`. Screens remained `STANDIN READY` with no probe text.
  Exact-name positive create, liveness, claude process detection, short/multiline send,
  capture and CLI send all worked. Full per-case session listings are retained below.
- All nine requested package filters, lint and typecheck have passed. Full recursive
  test run is in progress. Every test uses local vitest through package scripts,
  a fake HOME and TMPDIR, no inherited AO variables and no agent binary in PATH.
- The author report was read after the independent target audit and live negative/
  delivery controls. Positive destruction and attach checks are being finished separately.
- Mutants run in a `git archive 5b363474` scratch tree. Dependency symlinks point to
  installed external packages and scratch workspace packages; copied worktree dist
  files provide plugin dependencies. No build is run outside this worktree. Helper
  mutants change both scratch source and the copied core dist so plugin imports are
  genuinely exercised; all scratch source files are restored after each variant.

- Base-versus-R1 refusal probe (own scratch test, actual source modules with only the
  child-process boundary mocked): for the same stored handle `bad name`, base core
  probes and all four agent process probes see the live target. R1 runtime and
  claude probes reject; codex/gemini/opencode probes return false without a tmux
  call. Two lifecycle checks change a codex record from working to killed in R1;
  the base keeps working. Cleanup still keeps the record/workspace because runtime
  `isAlive` rejects. This is a new refusal route into the older catch-all, not a
  claim that R1 created the general R4 subprocess-error behavior.
- Additional concern being verified: exported core `newSession` creates a session
  before calling the newly validating `sendKeys`, but does not validate the name
  first. A refused name can therefore leave a newly created pane behind after an
  error. Unlike a hand-made record, this can originate in the exported creation API.

## Findings confirmed so far

### M-1 — Creation validates after creating the pane, leaving a live session on rejection

- Location: `packages/core/src/tmux.ts:167` (new helper refusal), reached from
  `newSession` at `:147` and `:151`; exported as `newTmuxSession` by `core/src/index.ts:45`.
- Category: **made worse by R1**. The unchanged creator accepts arbitrary tmux names;
  R1 changes the called send helper so creation now fails after the side effect.
- Reproducer: on a private server, call the exported creator with
  `{name: "bad name", cwd: scratchPath, command: "echo REVIEW_CREATE_MARKER"}`.
  Base `c516cead` resolves. R1 creates the session and then rejects
  `Invalid tmux session name "bad name"`. `list-sessions` still prints `bad name`.
  R1 `hasSession("bad name")` returns false and `killSession("bad name")` rejects,
  so the caller cannot clean up through the same exported API. With no command,
  creation even resolves before returning an unmanageable session.
- Live evidence: before `[kr-1, kr-10, other]`, after R1 rejection
  `[bad name, kr-1, kr-10, other]`; capture shows an idle shell, no initial command.
  The extra pane was stopped by its recorded PID, not through a real fleet command.
- Fix: validate `opts.name` before `new-session`. Add a test asserting invalid
  creation, both with and without an initial command, makes no tmux call. This
  preserves the owner's required rejection instead of relaxing the helper.
- This is a landing issue in the public core API; no production internal caller of
  `newTmuxSession` was found. Normal runtime-plugin creation validates up front.

### m-1 — Agent callers turn the new refusal into false liveness

- Locations: `agent-codex/src/index.ts:554`, `agent-gemini/src/index.ts:185`,
  `agent-opencode/src/index.ts:1291` (all under `packages/plugins`).
- Category: **made worse by R1 for names newly rejected by the helper**. The general
  catch-all subprocess-error defect is pre-existing R4 work and is not being charged
  to this round.
- Same-name comparison with an existing `bad name` pane: base process probes return
  true; R1 returns false without querying tmux. An actual session-manager/lifecycle
  probe with only subprocess results mocked changed a stored codex record from
  working to killed after two checks; base retained working. Cleanup skipped it in
  both versions, preserving its record and workspace, since the runtime rejects.
- No record, worktree, runtime or OpenCode-session removal was observed from this
  refusal. This is minor because runtime-tmux has never created these names, and
  automatic cleanup still treats the runtime as unknown. Propagate helper refusal
  separately from the existing R4 catch-all; no broad R4 rewrite is needed here.

### m-2 — The CLI has-session exactness has no regression assertion

- Locations: `packages/cli/src/commands/send.ts:277` and
  `packages/cli/__tests__/same-id-defects.test.ts:137`.
- Category: **coverage left in changed tests**; current production target is correct.
- Mutating only `targets.session` back to `tmuxTarget` in has-session passes both
  CLI R1 tests and all 24 send-command tests. The following exact send call rejects
  before text reaches the bystander, so the negative test's empty-keys assertion
  still passes. For a dead recorded session, the mutant chooses direct delivery
  and fails instead of allowing the session manager to restore it.
- Add a routing assertion for the dead recorded name (or assert the has-session
  argument), with a live exact-name positive control. Full CLI confirms the gap: 21 test files / 267 tests pass with this mutant.


## Gate evidence

Commands ran from this worktree under:

```sh
env -i HOME=/tmp/aosrv/ao53/home \
  PATH=/tmp/aosrv/ao53/bin:/usr/bin:/bin \
  TMPDIR=/tmp/aosrv/ao53/tmp SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 \
  <command>
```

The scratch PATH has node and pnpm links, a gh stub accepting only `--version` and
`auth status`, and a tmux shim that removes TMUX and adds `-L aosrv-ao53 -f /dev/null`.
No agent executable is on the test PATH. Integration tests use this private
server; the last-session integration case also creates its own temporary socket
directory, still under the same explicit `-L`. Agent/model integration cases skip.

```
pnpm install --frozen-lockfile: exit 0 (fake HOME; HUSKY=0 for install only)
pnpm build: exit 0
filter-core exit=0
filter-cli exit=0
filter-plugins-runtime-tmux exit=0
filter-plugins-agent-claude-code exit=0
filter-plugins-agent-codex exit=0
filter-plugins-agent-gemini exit=0
filter-plugins-agent-opencode exit=0
filter-plugins-workspace-worktree exit=0
filter-integration-tests exit=0
lint exit=0
typecheck exit=0
full-test exit=0
```

Per-package filtered test summary lines:

```text
filter-cli: Test Files  21 passed (21); Tests  267 passed (267)
filter-core: Test Files  53 passed (53); Tests  1385 passed | 4 expected fail (1389)
filter-integration-tests: Test Files  10 passed | 3 skipped (13); Tests  91 passed | 24 skipped (115)
filter-plugins-agent-claude-code: Test Files  4 passed (4); Tests  214 passed (214)
filter-plugins-agent-codex: Test Files  4 passed (4); Tests  219 passed (219)
filter-plugins-agent-gemini: Test Files  2 passed (2); Tests  66 passed (66)
filter-plugins-agent-opencode: Test Files  6 passed (6); Tests  321 passed (321)
filter-plugins-runtime-tmux: Test Files  2 passed (2); Tests  52 passed (52)
filter-plugins-workspace-worktree: Test Files  3 passed (3); Tests  65 passed (65)
```

Full `pnpm -r --no-bail test` summary lines:

```text
packages/core test:  Test Files  53 passed (53)
packages/core test:       Tests  1385 passed | 4 expected fail (1389)
packages/plugins/agent-gemini test:  Test Files  2 passed (2)
packages/plugins/agent-gemini test:       Tests  66 passed (66)
packages/plugins/agent-codex test:  Test Files  4 passed (4)
packages/plugins/agent-codex test:       Tests  219 passed (219)
packages/plugins/notifier-desktop test:  Test Files  1 passed (1)
packages/plugins/notifier-desktop test:       Tests  26 passed (26)
packages/plugins/agent-claude-code test:  Test Files  4 passed (4)
packages/plugins/agent-claude-code test:       Tests  214 passed (214)
packages/plugins/runtime-herdr test:  Test Files  2 passed (2)
packages/plugins/runtime-herdr test:       Tests  38 passed (38)
packages/plugins/tracker-github test:  Test Files  1 passed (1)
packages/plugins/tracker-github test:       Tests  42 passed (42)
packages/plugins/scm-github test:  Test Files  3 passed (3)
packages/plugins/scm-github test:       Tests  140 passed | 5 skipped (145)
packages/plugins/runtime-tmux test:  Test Files  2 passed (2)
packages/plugins/runtime-tmux test:       Tests  52 passed (52)
packages/plugins/workspace-worktree test:  Test Files  3 passed (3)
packages/plugins/workspace-worktree test:       Tests  65 passed (65)
packages/plugins/agent-opencode test:  Test Files  6 passed (6)
packages/plugins/agent-opencode test:       Tests  321 passed (321)
packages/integration-tests test:  Test Files  10 passed | 3 skipped (13)
packages/integration-tests test:       Tests  91 passed | 24 skipped (115)
packages/cli test:  Test Files  21 passed (21)
packages/cli test:       Tests  267 passed (267)
```

`SAME_ID_DEFECTS=red`, local vitest `run same-id` in all nine packages:

```text
red-cli.json failed 0 passed 2
red-core.json failed 4 passed 5
red-plugins-agent-claude-code.json failed 1 passed 1
red-plugins-agent-codex.json failed 3 passed 1
red-plugins-agent-gemini.json failed 3 passed 1
red-plugins-agent-opencode.json failed 4 passed 1
red-plugins-runtime-herdr.json failed 2 passed 0
red-plugins-runtime-tmux.json failed 4 passed 6
red-plugins-workspace-worktree.json failed 4 passed 0
round failures {'R3': 6, 'R4': 11, 'R2': 8}

R1 0 failures; R2 8; R3 6; R4 11. Exactly the expected rounds remain red.
```


## Mutant table

Tests were run using each package's local vitest in an archived tip copy.
The plain-name and missing-colon variants ran all same-ID tests plus the changed
helper/foreground, CLI send/session/shell/probe-error, runtime and agent index tests.
No suite failed to import or collect. Failures below are assertions.

| Mutation | Failing tests | Tests that catch it |
| --- | ---: | --- |
| Both helpers return plain name | 67 (all 17 R1 tests) | Core 18, CLI 15, runtime 17, claude 2, codex 1, gemini 1, opencode 13 |
| Pane helper returns `=name` without colon | 41 (0 R1 defect tests) | Core 11, CLI 10, runtime 7, claude 1, opencode 12; codex/gemini selected suites pass |
| Empty foreground output returns null again | 1 | `tmux-foreground.test.ts`: keeps waiting while tmux prints empty output for the pane |
| CLI has-session uses plain `tmuxTarget` | **0** | **Survives** all 267 CLI tests (21 files), including both R1 tests |
| Runtime attach command target unquoted | 1 | `runtime.getAttachInfo() returns tmux type and attach command` |

The missing-colon mutant is caught by exact-vector/unit assertions, but the 17
prefix tests do not simulate window-name lookup. The independent live window-name
case supplies behavioral evidence for the colon. Removing the CLI empty-output
check alone is not a meaningful R1 mutant: that check predates R1, and parseInt of
empty output also gives NaN, hence null.

Exact failed test names from the independent runs:

```text
MUTANT plain
plain-cli.json failed 15 passed 68
  runtime-tmux isAlive when tmux cannot answer does not report a live session dead when the tmux server cannot be reached
  runtime-tmux isAlive when tmux cannot answer does not report a live session dead when has-session times out
  [same-id R1] D-A: the CLI tmux calls match a longer session name by prefix getTmuxActivity of a dead name does not report another session's activity
  [same-id R1] D-A: the CLI tmux calls match a longer session name by prefix ao send --no-wait to a dead name types nothing into another session
  send command busy detection detects idle session via agent plugin
  send command busy detection detects busy session and waits via agent plugin
  send command busy detection skips busy detection with --no-wait
  send command message delivery uses send-keys for short messages
  send command message delivery clears partial input before sending
  send command session manager integration delivers tmux AO sessions directly after resolving metadata
  send command session manager integration waits for tmux AO sessions before direct delivery
  send command session manager integration passes file contents through direct tmux delivery for tmux AO sessions
  send through the OpenCode API (I-5) keeps the tmux path for an OpenCode session without a stored ID
  session attach attaches to resolved runtime target when session exists
  getTmuxActivity reads the exact pane of the session
plain-core.json failed 18 passed 30
  [same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix hasTmuxSession answers false for a dead name while one live name starts with it
  [same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix killTmuxSession of a dead name does not end the live session
  [same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix tmuxSendKeys to a dead name types nothing into another session
  [same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix tmuxCapturePane of a dead name does not read another session's screen
  [same-id R1] D-A: the exported core tmux helpers match a longer session name by prefix getTmuxPaneTTY of a dead name does not answer another session's pane
  exactSessionTarget and exactPaneTarget gives =name and =name: for app-1
  exactSessionTarget and exactPaneTarget gives =name and =name: for kr-10
  exactSessionTarget and exactPaneTarget gives =name and =name: for 0123456789ab-kr-1
  exactSessionTarget and exactPaneTarget gives =name and =name: for my_app-ORCH-2
  exactSessionTarget and exactPaneTarget gives =name and =name: for a
  hasSession returns true when session exists
  newSession sends initial command after creation
  sendKeys sends short text with send-keys
  sendKeys skips Enter when pressEnter=false
  sendKeys uses load-buffer with named buffer for long text
  capturePane captures pane output with default lines
  killSession kills a tmux session
  send: the tmux foreground read before delivery reads the foreground command of the exact pane
plain-plugins-agent-claude-code.json failed 2 passed 112
  isProcessRunning rejects when tmux command fails
  [same-id R1] D-A: the claude-code pane read matches a longer session name by prefix isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it
plain-plugins-agent-codex.json failed 1 passed 165
  [same-id R1] D-A: the codex pane read matches a longer session name by prefix isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it
plain-plugins-agent-gemini.json failed 1 passed 65
  [same-id R1] D-A: the gemini pane read matches a longer session name by prefix isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it
plain-plugins-agent-opencode.json failed 13 passed 216
  confirmLaunch (I-3) confirms when the pane runs opencode on the session and the process stays
  confirmLaunch (I-3) matches --session=<id> and the .opencode binary name
  confirmLaunch (I-3) accepts the wrapper row the real TUI argv of ao-37 and ao-39 (M-3) on tmux (M-1)
  confirmLaunch (I-3) accepts the wrapper row node on tmux (M-1)
  confirmLaunch (I-3) accepts the wrapper row bun on tmux (M-1)
  confirmLaunch (I-3) gives promptDelivered true when the session shows a user message, with the pane environment
  confirmLaunch (I-3) counts a failed read as not seen yet
  confirmLaunch (I-3) gives promptDelivered false when no user message shows within the bound
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered false when only the old message exists
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered true when a newer message arrives after the pane starts
  confirmLaunch (I-3) a reused session with older user messages (M-2) counts any message when the reused session had none
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered false at once when the baseline read failed
  [same-id R1] D-A: the opencode pane read matches a longer session name by prefix isProcessRunning answers false for a dead name while the agent runs in a session whose name starts with it
plain-plugins-runtime-tmux.json failed 17 passed 35
  runtime.create() runs the new-session client with the environment's PATH
  runtime.create() sends launch command via send-keys
  runtime.create() uses a temp launch script for long launch commands
  runtime.create() cleans up session if send-keys fails
  runtime.destroy() calls kill-session with the handle id
  runtime.sendMessage() sends short text with send-keys -l (literal) + Enter
  runtime.sendMessage() uses load-buffer + paste-buffer for long text (> 200 chars)
  runtime.getOutput() calls capture-pane with correct args and default lines
  runtime.getOutput() passes custom line count
  runtime.isAlive() returns true when has-session succeeds
  runtime.getAttachInfo() returns tmux type and attach command
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix isAlive answers false for a dead name while one live name starts with it
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix destroy of a dead name does not end the live session whose name starts with it
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix sendMessage to a dead name types nothing into another session
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix getOutput of a dead name does not read another session's screen
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix the attach target of a dead name resolves to no session
  [same-id R1] D-A: a plain tmux target matches a longer session name by prefix create: the launch keys never reach another session when the new session ends first
total failed 67 R1 failed 17

MUTANT no-colon
no-colon-cli.json failed 10 passed 73
  send command busy detection detects idle session via agent plugin
  send command busy detection detects busy session and waits via agent plugin
  send command busy detection skips busy detection with --no-wait
  send command message delivery uses send-keys for short messages
  send command message delivery clears partial input before sending
  send command session manager integration delivers tmux AO sessions directly after resolving metadata
  send command session manager integration waits for tmux AO sessions before direct delivery
  send command session manager integration passes file contents through direct tmux delivery for tmux AO sessions
  send through the OpenCode API (I-5) keeps the tmux path for an OpenCode session without a stored ID
  getTmuxActivity reads the exact pane of the session
no-colon-core.json failed 11 passed 37
  exactSessionTarget and exactPaneTarget gives =name and =name: for app-1
  exactSessionTarget and exactPaneTarget gives =name and =name: for kr-10
  exactSessionTarget and exactPaneTarget gives =name and =name: for 0123456789ab-kr-1
  exactSessionTarget and exactPaneTarget gives =name and =name: for my_app-ORCH-2
  exactSessionTarget and exactPaneTarget gives =name and =name: for a
  newSession sends initial command after creation
  sendKeys sends short text with send-keys
  sendKeys skips Enter when pressEnter=false
  sendKeys uses load-buffer with named buffer for long text
  capturePane captures pane output with default lines
  send: the tmux foreground read before delivery reads the foreground command of the exact pane
no-colon-plugins-agent-claude-code.json failed 1 passed 113
  isProcessRunning rejects when tmux command fails
no-colon-plugins-agent-codex.json failed 0 passed 166
no-colon-plugins-agent-gemini.json failed 0 passed 66
no-colon-plugins-agent-opencode.json failed 12 passed 217
  confirmLaunch (I-3) confirms when the pane runs opencode on the session and the process stays
  confirmLaunch (I-3) matches --session=<id> and the .opencode binary name
  confirmLaunch (I-3) accepts the wrapper row the real TUI argv of ao-37 and ao-39 (M-3) on tmux (M-1)
  confirmLaunch (I-3) accepts the wrapper row node on tmux (M-1)
  confirmLaunch (I-3) accepts the wrapper row bun on tmux (M-1)
  confirmLaunch (I-3) gives promptDelivered true when the session shows a user message, with the pane environment
  confirmLaunch (I-3) counts a failed read as not seen yet
  confirmLaunch (I-3) gives promptDelivered false when no user message shows within the bound
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered false when only the old message exists
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered true when a newer message arrives after the pane starts
  confirmLaunch (I-3) a reused session with older user messages (M-2) counts any message when the reused session had none
  confirmLaunch (I-3) a reused session with older user messages (M-2) gives promptDelivered false at once when the baseline read failed
no-colon-plugins-runtime-tmux.json failed 7 passed 45
  runtime.create() runs the new-session client with the environment's PATH
  runtime.create() sends launch command via send-keys
  runtime.create() uses a temp launch script for long launch commands
  runtime.sendMessage() sends short text with send-keys -l (literal) + Enter
  runtime.sendMessage() uses load-buffer + paste-buffer for long text (> 200 chars)
  runtime.getOutput() calls capture-pane with correct args and default lines
  runtime.getOutput() passes custom line count
total failed 41 R1 failed 0

MUTANT empty-unknown
empty-unknown-core.json failed 1 passed 3
  send: the tmux foreground read before delivery keeps waiting while tmux prints empty output for the pane (the session is gone)
total failed 1 R1 failed 0

MUTANT cli-send-plain
cli-send-plain-cli.json failed 0 passed 26
total failed 0 R1 failed 0

MUTANT attach-unquoted
attach-unquoted-plugins-runtime-tmux.json failed 1 passed 51
  runtime.getAttachInfo() returns tmux type and attach command
total failed 1 R1 failed 0
```


## Live target evidence

Every runtime/CLI call below uses this worktree's built modules and private server
`aosrv-ao53-live`. The only agent is a Python stdin stand-in named `claude`; it
prints received lines and exposes `claude` in its argv for agent process detection.
Although it sets comm, tmux still reports the interpreter `python3` as foreground.
No real agent binary, model turn or OpenCode command is run.

```text

CASE isAlive(dead kr-1)
list-sessions BEFORE: "kr-10"
RESULT false
list-sessions AFTER: "kr-10"

CASE destroy(dead kr-1)
list-sessions BEFORE: "kr-10"
RESULT undefined
list-sessions AFTER: "kr-10"

CASE sendMessage(dead kr-1)
list-sessions BEFORE: "kr-10"
REJECT Command failed: tmux send-keys -t =kr-1: C-u
list-sessions AFTER: "kr-10"

CASE getOutput(dead kr-1)
list-sessions BEFORE: "kr-10"
RESULT ""
list-sessions AFTER: "kr-10"

CASE claude isProcessRunning(dead kr-1)
list-sessions BEFORE: "kr-10"
RESULT false
list-sessions AFTER: "kr-10"

CASE ao send --no-wait dead kr-1
list-sessions BEFORE: "kr-10"
RESULT {"code":1,"stdout":"","stderr":"Session 'kr-1' does not exist\n"}
list-sessions AFTER: "kr-10"

CASE getTmuxActivity(dead kr-1)
list-sessions BEFORE: "kr-10"
RESULT null
list-sessions AFTER: "kr-10"

CASE bystander content after dead-name calls
list-sessions BEFORE: "kr-10"
RESULT "STANDIN READY"
list-sessions AFTER: "kr-10"

CASE window kr-1 in other: isAlive kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT false
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: destroy kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT undefined
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: sendMessage kr-1
list-sessions BEFORE: "kr-10\nother"
REJECT Command failed: tmux send-keys -t =kr-1: C-u
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: getOutput kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT ""
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: claude process kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT false
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: getTmuxPaneTTY kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT null
list-sessions AFTER: "kr-10\nother"

CASE window kr-1 in other: ao send
list-sessions BEFORE: "kr-10\nother"
RESULT {"code":1,"stdout":"","stderr":"Session 'kr-1' does not exist\n"}
list-sessions AFTER: "kr-10\nother"

CASE other content after window-name calls
list-sessions BEFORE: "kr-10\nother"
RESULT "STANDIN READY"
list-sessions AFTER: "kr-10\nother"

CASE positive runtime.create kr-1
list-sessions BEFORE: "kr-10\nother"
RESULT {"id":"kr-1","runtimeName":"tmux","data":{"createdAt":1792601414876,"workspacePath":"/tmp/aosrv/ao53/repo"}}
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive isAlive
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT true
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive claude isProcessRunning
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT true
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive sendMessage short
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT undefined
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive sendMessage multiline
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT undefined
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive getOutput
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT "To run a command as administrator (user \"root\"), use \"sudo <command>\".\nSee \"man sudo_root\" for details.\n\nexec /tmp/aosrv/ao53/livebin/claude\ntaisung@rioja-rutgers-edu:/tmp/aosrv/ao53/repo$ exec /tmp/aosrv/ao53/livebin/cla\nude\nSTANDIN READY\nPOSITIVE_RUNTIME\nSTANDIN RECEIVED: POSITIVE_RUNTIME\nPOSITIVE_MULTI_1\nPOSITIVE_MULTI_2STANDIN RECEIVED: POSITIVE_MULTI_1\n\nSTANDIN RECEIVED: POSITIVE_MULTI_2"
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive getTmuxPaneTTY
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT "/dev/pts/10"
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive ao send --no-wait
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT {"stdout":"Message sent and processing\n","stderr":""}
list-sessions AFTER: "kr-1\nkr-10\nother"

CASE positive getOutput after CLI
list-sessions BEFORE: "kr-1\nkr-10\nother"
RESULT "To run a command as administrator (user \"root\"), use \"sudo <command>\".\nSee \"man sudo_root\" for details.\n\nexec /tmp/aosrv/ao53/livebin/claude\ntaisung@rioja-rutgers-edu:/tmp/aosrv/ao53/repo$ exec /tmp/aosrv/ao53/livebin/cla\nude\nSTANDIN READY\nPOSITIVE_RUNTIME\nSTANDIN RECEIVED: POSITIVE_RUNTIME\nPOSITIVE_MULTI_1\nPOSITIVE_MULTI_2STANDIN RECEIVED: POSITIVE_MULTI_1\n\nSTANDIN RECEIVED: POSITIVE_MULTI_2\nPOSITIVE_CLI\nSTANDIN RECEIVED: POSITIVE_CLI"
list-sessions AFTER: "kr-1\nkr-10\nother"
SESSIONS DIR /tmp/aosrv/ao53/home/.agent-orchestrator/a93e82f3ad58-repo/sessions
LEAVING kr-1, kr-10, other for attach and refusal checks; PIDs recorded.
```


The persisted-record positive spawn/restore uses a local clone in scratch, its
own config/state root, and the same stand-in. No new source commit was made in it.
Its detached lifecycle worker was stopped by the exact PID from its scratch pid
file, after verifying the executable and scratch state root in /proc. An initial
harness invocation mistakenly treated `sp` as an issue argument; the gh stub
refused it (no network), and that worker was stopped too. Corrected run:

```text
list-sessions BEFORE spawn: "kr-1\nkr-10\nother"
ao spawn exit=0 elapsed=3.863s
  Attach:   ao session attach sp-1
SESSION=sp-1
- Creating session
✔ Session sp-1 spawned

stopped own lifecycle worker PID 3057065
list-sessions AFTER spawn: "5195c929cd7c-sp-1\nkr-1\nkr-10\nother"
spawn record status=spawning target=5195c929cd7c-sp-1
ao send --no-wait sp-1 SPAWN_CONTROL exit=0 elapsed=2.825s
Message sent and processing

spawn control capture=".\nSTANDIN RECEIVED: - Push your branch and create a PR when the implementation is\nready.\nSTANDIN RECEIVED: - Keep PRs focused — one issue per PR.\nSTANDIN RECEIVED:\nSTANDIN RECEIVED: ## PR Best Practices\nSTANDIN RECEIVED: - Write a clear PR title and description explaining what chang\ned and why.\nSTANDIN RECEIVED: - Link the issue in the PR description so it auto-closes when\nmerged.\nSTANDIN RECEIVED: - If the repo has CI checks, make sure they pass before reques\nting review.\nSTANDIN RECEIVED: - Respond to every review comment, even if just to acknowledge\n it.\nSTANDIN RECEIVED:\nSTANDIN RECEIVED: ## Project Context\nSTANDIN RECEIVED: - Project: sp\nSTANDIN RECEIVED: - Repository: scratch/sp\nSTANDIN RECEIVED: - Default branch: main\n\nSTANDIN RECEIVED: - Tracker: github\nSPAWN_CONTROL\nSTANDIN RECEIVED: SPAWN_CONTROL"
list-sessions BEFORE destroy positive: "5195c929cd7c-sp-1\nkr-1\nkr-10\nother"
list-sessions AFTER destroy positive: "kr-1\nkr-10\nother"
list-sessions BEFORE dead recorded send: "5195c929cd7c-sp-10\nkr-1\nkr-10\nother"
ao send --no-wait sp-1 RESTORE_CONTROL exit=0 elapsed=6.516s
Message sent and processing

list-sessions AFTER dead recorded send: "5195c929cd7c-sp-1\n5195c929cd7c-sp-10\nkr-1\nkr-10\nother"
bystander after restore="STANDIN READY"
restored exact target="To run a command as administrator (user \"root\"), use \"sudo <command>\".\nSee \"man sudo_root\" for details.\n\nclaude --dangerously-skip-permissions\ntaisung@rioja-rutgers-edu:~/.worktrees/sp/sp-1$ claude --dangerously-skip-permis\nsions\nSTANDIN READY\nRESTORE_CONTROL\nSTANDIN RECEIVED: RESTORE_CONTROL"
```

## Target inventory, scope and commits

Independent search: `rg -n 'tmux|"-t"| -t ' packages`, excluding dependencies,
dist and test files; then inspection of every constructed argument vector and command
string. These are all target-bearing production calls at the reviewed tip:

| File (under packages) | Lines / commands | Target form |
| --- | --- | --- |
| core/src/tmux.ts | 107 has-session; 221 kill-session | S, `=name` |
| core/src/tmux.ts | 167,195,205 send-keys; 184 paste-buffer; 216 capture-pane; 230/233 list-panes | P/W, `=name:` |
| core/src/session-manager.ts | 534 display-message | P, `=name:` |
| core/src/session-manager.ts | 1045 OpenCode holder has-session | S, `=name` |
| plugins/runtime-tmux/src/index.ts | 145,147,149 launch send-keys; 184,212,218 message send-keys; 194 paste-buffer; 223/226 capture-pane | P, `=name:` |
| plugins/runtime-tmux/src/index.ts | 153 create cleanup; 175 destroy; 237/239 isAlive; 271/276 attach | S, `=name`; attach command shell-quotes it |
| plugins/agent-claude-code/src/index.ts | 586/591 list-panes | W, `=name:` |
| plugins/agent-codex/src/index.ts | 554 list-panes | W, `=name:` |
| plugins/agent-gemini/src/index.ts | 185 list-panes | W, `=name:` |
| plugins/agent-opencode/src/index.ts | 663 launch check; 1291 process check, list-panes | W, `=name:` |
| cli/src/lib/shell.ts | 60/67 activity display-message | P, `=name:` |
| cli/src/commands/send.ts | 123,140,144,362,367 send-keys; 131 paste-buffer; 288 capture-pane | P, `=name:` |
| cli/src/commands/send.ts | 277 has-session | S, `=name` |
| cli/src/commands/session.ts | 194 attach | S, `=name` passed as an argv element |

Test helpers: `integration-tests/src/helpers/tmux.ts:36,86` kill-session use S;
`:74` capture-pane uses P. Targetless production calls (no helper needed):
core/tmux `:62,80` list-sessions, `:130` new-session, `:183` load-buffer;
runtime-tmux `:132` new-session, `:193` load-buffer, `:204` delete-buffer,
`:255` list-sessions; CLI shell `:52` list-sessions and send `:130` load-buffer.
Version checks in CLI start `:834,842`, preflight `:18`, detect-env `:41` have no
target. No extra executable production target site was found beyond the design's
inventory. The prompt text at core/orchestrator-prompt `:61` has no target argument.

`git diff c516cead..5b363474`: 30 files, 473 insertions, 127 deletions. All are in
the allowed set. No socket/server choice was introduced (`-S` in capture-pane is
its existing scrollback flag). No runtime data/record shape or types, config,
metadata, lifecycle, recovery, workspace-worktree, runtime-herdr, workflow,
CLAUDE.md or AGENTS.md change. Core index adds only the two helper exports.
Exactly 17 R1 calls flip from defect to it; R2/R3/R4 bodies and markings are unchanged.

Old assertions retain their strength: 7 core tmux tests (10 strings), 11 runtime
tests (16 strings), 9 CLI send tests (10 strings), 1 CLI attach (1), 2 CLI probe-error
(2), 1 claude error-message test (1), the OpenCode launch helper used by 12 tests (1),
and 1 integration attach test (1): 44 affected tests, 42 strings. The two CLI core
mocks now import the real helpers; this is necessary to avoid passing only because
of a missing-export exception. No tests or assertions were removed or weakened.

New/extended coverage: 12 core helper cases, 4 foreground-readiness cases, 2 runtime
invalid-handle cases, 3 CLI activity cases, 1 CLI invalid-name send case. There is no
invalid-name creation test, which is why M-1 passes the gates.

`git branch -r --contains 5b363474` produced no output. The parent chain is exactly:

```text
5b363474 -> 9c5c53d4 -> 02dd24ee -> bc927c65 -> c516cead
```

All four subjects are conventional, and each body explains why. No issue number,
Co-Authored-By trailer or emoji occurs. No commit/push/PR was made by this reviewer.

## Refusal and empty-output behavior

| Caller | Refused name at R1 | Consequence / comparison with base |
| --- | --- | --- |
| core hasSession / getPaneTTY | false / null without tmux | Base queries tmux and can find a space-containing name. No production caller found. Creation inconsistency is M-1. |
| core sendKeys / capturePane / killSession | rejects | No query, send or destruction; base accepts a space-containing name. |
| runtime isAlive | rejects outside catch | Unknown; cleanup and orchestrator replacement retain/refuse rather than delete. |
| runtime destroy | resolves without command | New helper error is swallowed as best effort; explicit kill may still remove a record/workspace as it already does on destroy errors. No supported runtime-created name is refused. |
| runtime sendMessage / getAttachInfo | rejects | No side effect. |
| runtime getOutput | empty string | No removal consumer; base could return a real pane's screen. |
| claude isProcessRunning | rejects outside catch | Unknown, not exited. |
| codex/gemini/opencode isProcessRunning | false | New invalid-name route to old catch-all; m-1 describes the measured false killed status. |
| OpenCode findPaneOpenCodeProcess | null, not PaneGoneError | Helper Error has no tmux missing-target stderr; launch check waits/retries. No newly introduced gone/deletion answer. |
| foreground command | null on helper refusal | Same unknown result as a command failure; no deletion consumer. |
| OpenCode holder check | unknown | Helper Error has no code=1/missing-session stderr; holder retained. Real runtime isAlive generally rejects before this fallback. |
| CLI activity | null | Display-only no activity; base could query the invalid name. |
| CLI send without record | does-not-exist, no query | Explicit owner-required refusal; no removal. |
| CLI send with record | session-manager path | Runtime/claude refusal is caught as unknown, then the send rejects; the codex false answer may invoke restore (m-1). |
| CLI attach | rejects | No spawned attach client and no removal. |
| integration helpers | kill catches; capture empty | Test cleanup only; names generated by the integration suite are valid. |

`TMUX_PANE_GONE` is confined to getTmuxForegroundCommand and the two comparisons in
waitForInteractiveReadiness (`session-manager.ts:3478,3485`) and waitForRestoredSession
(`:3526,3532`). Empty output now holds readiness until its 20s/5s bound; it does not
throw or trigger cleanup. The CLI's empty->null behavior predates R1 and its callers
in status/session-list only format activity times. A matching foreground process
still returns early (tested); a failed read remains null/unknown (tested). Direct
spawn/restore do not call these waits; send during spawning or after restore does.
The live stand-in is reported by tmux as `python3`, so the measured 6.516s restore
send includes the existing 5s non-matching-foreground bound; it is not evidence of
a new normal-agent delay. Real exact targets return nonempty foreground data.

## Follow-up list (does not change verdict)

- **F-1**, `packages/core/src/orchestrator-prompt.ts:61`: unchanged prompt permits
  read-only tmux capture without teaching `=name:`. An agent may still construct
  a prefix target when following this prose. This round did not modify the prompt
  and it is outside the allowed files, so this is follow-up, not a missed executable
  target. Reproducer: inspect the generated prompt; it names capture-pane but no
  exact target form. Add an exact-target example in a later documentation change.
- No generic R2/R3/R4 defect is charged to this round. Their 25 expected failures
  remain exactly as planned. m-1 is limited to the new helper-refusal route.

## Attach and final live controls

The CLI uses `spawn(command, args, {stdio: "inherit"})` (`session.ts:207`) without a
shell, so `=name` is an argv element and must not contain shell quote characters.
The runtime command string uses `shellEscape`, which is necessary for zsh's EQUALS
expansion. zsh 5.9 was not installed; Ubuntu packages were downloaded and extracted
only under scratch (no host installation). Both shell command and CLI attach tests
used controlling PTYs, verified the intended stand-in screen, detached, and reaped
their exact child PIDs. Initial harness errors (wrong extracted zsh path, a scratch
record written under fake-HOME state instead of explicit state, and detaching before
the client finished starting) were corrected. Final unmodified-product results:

```text
runtime command bash
list-sessions BEFORE: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
client PID: 3073060
screen contains STANDIN READY: True
client status: 0
list-sessions AFTER: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
runtime command zsh
list-sessions BEFORE: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
client PID: 3073106
screen contains STANDIN READY: True
client status: 0
list-sessions AFTER: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
ao session attach bash
list-sessions BEFORE: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
client PID: 3073301
screen contains STANDIN READY: True
client status: 0
list-sessions AFTER: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
ao session attach zsh
list-sessions BEFORE: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
client PID: 3073348
screen contains STANDIN READY: True
client status: 0
list-sessions AFTER: 5195c929cd7c-sp-1
5195c929cd7c-sp-10
kr-1
kr-10
other
unquoted zsh control: 1 zsh:1: kr-1 not found
```

Final independent no-command creation, positive destroy, and raw window-name
controls (the first harness attempt used the wrong export name; corrected to the
actual public `newTmuxSession` before this run):

```text
list-sessions BEFORE no-command create: "5195c929cd7c-sp-1\n5195c929cd7c-sp-10\nkr-1\nkr-10\nother"
no-command create resolved; hasTmuxSession: false
list-sessions AFTER no-command create: "5195c929cd7c-sp-1\n5195c929cd7c-sp-10\nbad empty\nkr-1\nkr-10\nother"
list-sessions BEFORE positive destroy kr-1: "5195c929cd7c-sp-1\n5195c929cd7c-sp-10\nkr-1\nkr-10\nother"
list-sessions AFTER positive destroy kr-1: "5195c929cd7c-sp-1\n5195c929cd7c-sp-10\nkr-10\nother"
positive destroy followed by isAlive: false
missing-colon raw control: window-control:kr-1
can't find session: kr-1
colon control rejects: can't find session: kr-1
```

M-1 also reproduces without an initial command: `newTmuxSession` resolves but
`hasTmuxSession` immediately says false while `list-sessions` shows the new pane.
The missing-colon control selects `window-control:kr-1`; the colon form rejects
with `can't find session: kr-1`. Exact runtime destroy ends kr-1 while keeping kr-10.

Refusal comparison used actual base and tip source modules with a tmux/ps stand-in
at the subprocess boundary, plus the real session manager/lifecycle with scratch
records. Selected raw outcomes:

```text

 RUN  v4.1.4 /tmp/aosrv/ao53/refusal

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE core hasSession true calls=[["tmux","has-session","-t","bad name"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE core getPaneTTY "/dev/pts/999" calls=[["tmux","list-panes","-t","bad name","-F","#{pane_tty}"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE core capturePane "READY\n" calls=[["tmux","capture-pane","-t","bad name","-p","-S","-30"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE core killSession undefined calls=[["tmux","kill-session","-t","bad name"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE core sendKeys undefined calls=[["tmux","send-keys","-t","bad name","Escape"],["tmux","send-keys","-t","bad name","-l","hello"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE runtime isAlive true calls=[["tmux","has-session","-t","bad name"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE runtime destroy undefined calls=[["tmux","kill-session","-t","bad name"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE runtime getOutput "READY" calls=[["tmux","capture-pane","-t","bad name","-p","-S","-50"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE runtime getAttachInfo {"type":"tmux","target":"bad name","command":"tmux attach -t bad name"} calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE runtime sendMessage undefined calls=[["tmux","send-keys","-t","bad name","C-u"],["tmux","send-keys","-t","bad name","-l","hello"],["tmux","send-keys","-t","bad name","Enter"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE claude-code isProcessRunning true calls=[["tmux","list-panes","-t","bad name","-F","#{pane_tty}"],["ps","-eo","pid,tty,args"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE codex isProcessRunning true calls=[["tmux","list-panes","-t","bad name","-F","#{pane_tty}"],["ps","-eo","pid,tty,args"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE gemini isProcessRunning true calls=[["tmux","list-panes","-t","bad name","-F","#{pane_tty}"],["ps","-eo","pid,tty,args"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE opencode isProcessRunning true calls=[["tmux","list-panes","-t","bad name","-F","#{pane_tty}"],["ps","-eo","pid,tty,args"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
BASE activity 12345000 calls=[["tmux","display-message","-t","bad name","-p","#{session_activity}"]]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 core hasSession false calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 core getPaneTTY null calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 core capturePane REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 core killSession REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 core sendKeys REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 runtime isAlive REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 runtime destroy undefined calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 runtime getOutput "" calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 runtime getAttachInfo REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 runtime sendMessage REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 claude-code isProcessRunning REJECT Error: Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/ calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 codex isProcessRunning false calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 gemini isProcessRunning false calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 opencode isProcessRunning false calls=[]

stdout | refusal.test.ts > compares every public target caller for the same invalid name
R1 activity null calls=[]

stdout | refusal.test.ts > compares removal and lifecycle effects for a stored codex handle with a space
BASE status after 2 checks working

stdout | refusal.test.ts > compares removal and lifecycle effects for a stored codex handle with a space
BASE cleanup {"killed":[],"skipped":["kr-1"],"errors":[]} destroyed []
BASE record present true workspace present true

stdout | refusal.test.ts > compares removal and lifecycle effects for a stored codex handle with a space
R1 status after 2 checks killed

stdout | refusal.test.ts > compares removal and lifecycle effects for a stored codex handle with a space
R1 cleanup {"killed":[],"skipped":["kr-1"],"errors":[]} destroyed []
R1 record present true workspace present true

 ✓ refusal.test.ts (2 tests) 517ms
   ✓ compares every public target caller for the same invalid name  423ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:53:44
   Duration  3.09s (transform 1.92s, setup 0ms, import 2.46s, tests 517ms, environment 0ms)

```

Live M-1 comparison used archived `c516cead` source through local vitest, then the
current source, with real private tmux calls. No baseline build or production code
edit was needed. A minimal reproducer after installing/building this worktree is:

```js
// Run under env -i, fake HOME and a private-server tmux shim as above.
const core = await import("<this-worktree>/packages/core/dist/index.js");
await core.newTmuxSession({name: "bad name", cwd: "<scratch>", command: "echo marker"});
// R1 throws after new-session; private tmux list-sessions still contains "bad name".
// Record the private pane_pid and stop that exact PID after checking it.
```

No unknown-server or same-launch identity behavior was changed or tested against
real fleet state. The private live tests establish this round's target isolation;
they do not claim to resolve the later rounds.


## What is correct

- Session and pane/window targets use the owner's two distinct exact forms at all
  executable production sites, with no R2 server/identity work mixed in.
- Negative live calls leave both the longer-name session and same-name window
  alone; exact-name create/send/capture/process checks/destroy work.
- Persisted dead-session send restores the exact target and leaves its longer-name
  bystander unchanged. CLI and runtime attach both work from bash and zsh.
- The empty-foreground sentinel stays inside readiness; failed probes remain
  unknown. Existing assertions were retained, and all 17 R1 defect tests flip for
  their intended reason (all 17 fail with plain helpers).
- Build, all requested test filters, integration, lint, typecheck and the full
  recursive suite pass. Full suite: 112 passed test files / 3 skipped files;
  2926 passed tests / 4 expected failures / 29 skipped. Red mode has R1=0,
  R2=8, R3=6, R4=11 failures.

## Final cleanup and host-state evidence

All scratch lifecycle workers were stopped before the private live server.
Tracked workers: 3051389 (initial refused issue-form probe), 3057065 (successful
spawn). No real fleet worker, pane or watcher was touched. All started PTY attach
clients were waited/reaped; all test runners and foreground helpers exited.
The exact-PID cleanup log is:

```text
Recorded own server PIDs [2966235]
Recorded own worker PIDs [3051389, 3057065]
Recorded own pane and stand-in PIDs [2966236, 2966271, 2966315, 3045734, 3045801, 3057090, 3057105, 3057595, 3057647, 3057660, 3087660, 3087677]
SIGTERM own stand-in PID 2966236
SIGTERM own stand-in PID 2966271
SIGTERM own stand-in PID 3057595
SIGTERM own stand-in PID 3057660
SIGTERM own pane PID 3057647
SIGTERM own pane PID 3087677
SIGKILL own pane PID 3057647
SIGKILL own pane PID 3087677
Own running processes: []
Own exited processes awaiting host reaping: []
Private aosrv-ao53 list-sessions exit=1: no server running on /tmp/tmux-44402/aosrv-ao53
Private aosrv-ao53-live list-sessions exit=1: no server running on /tmp/tmux-44402/aosrv-ao53-live
```

An independent `ps -eo pid,ppid,stat,args` inspection for the scratch path after
cleanup returned no rows. The recorded-process check includes exited/zombie
entries, and both lists are empty. Private test-server sessions cleaned themselves
up through the test helpers; the recorded live-pane PIDs were stopped explicitly.
Only the two known private socket names were removed after confirming no server.

After listing (identical to the before listing; `diff -u` returned no output):

```sh
ls -la --time-style=full-iso ~/.ao/bin
```

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required real-state audit, run only as filesystem inspection (never via ao):

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosrv-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-50
```

Every printed path is accounted for:

- `.../sessions/ao-50`: the real fleet's lifecycle/status writer updated the author
  session to `status=stuck` (`generation=5`), mtime 2026-10-21 12:54:34.088517177 -0400.
  This is external fleet activity, not this review. The metadata and stat identify
  the record change; they do not establish the exact writer PID.
- `.../sessions`: the corresponding directory mtime is identical to that atomic
  record replacement. It is the same external write, not an additional scratch write.

No ao command used the real config/state root, and no test inherited real AO
variables. No real agent executable or network gh command ran. No service.json or
auth.json content was read; fake HOME had no such credentials. No host wrapper,
shell startup, tmux config, global ao link or agent settings were written.
The sole installed build is in this worktree; scratch mutant dependencies used
copies of that build. No repository source, lockfile or tracked file was changed.

The scratch directory `/tmp/aosrv/ao53` and marker are removed after copying this
evidence into the review. Only this uncommitted review and `.agent_report.md` are
review deliverables; `.agent_task.md` remains as supplied.

Cleanup completion verified: `/tmp/aosrv/ao53` and `/tmp/aosrv-marker` no longer exist.
The final deletion first verified every recorded PID was absent from /proc and
that the scratch directory and marker were not symlinks. `git diff --stat` and
`git diff --check` are empty; no production code change was made.
