# Same-ID R1, short re-check round 2 (ao-53)

Verdict: **LAND-SAFE**. Open findings: **0 B, 0 M, 0 m; 1 F**.
Round-2 range: `5b363474..4034ece7`; whole R1:
`c516cead..4034ece7`. Tip verified as `4034ece7`. Unchanged parts retain the
round-1 source/runtime review; this is not another full target sweep.

No source edits, commit, push, PR, network gh call or real-agent process.
Scratch: `/tmp/aosrv/ao53-r2`; empty inherited environment, fake HOME/TMPDIR,
local vitest, gh stub and private tmux shim. No agent executable on test PATH.
`/tmp/aosrv2-marker` created before investigation. Prior review left unchanged.

## Evidence recorded while working

- Round 2 changes nine allowed files, 155 insertions / 6 deletions: core tmux,
  codex/gemini/opencode isProcessRunning and five test files.
- Core validates opts.name before building/running new-session. All three agent
  methods build their target before the existing catch-all; the catch itself and
  non-tmux branches are unchanged. CLI production source is unchanged; new tests
  check the exact probe and both dead-record restore/live-exact delivery routes.
- Real ~/.ao/bin before work (`ls -la --time-style=full-iso ~/.ao/bin`):

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

- Frozen install and build passed again before runtime testing. Install used fake
  HOME and HUSKY=0 to avoid changing hook configuration (there are no commits).
- M-1 private live replay: both bad-name variants reject with the helper error;
  list-sessions is `keeper` before and after each. Valid kr-1 is created beside
  kr-10; its pane receives `echo MARKER` and the bystander remains empty. The
  positive pane runs a stdin receiver, so no agent or model is launched.
- Independent m-1 probe: each agent rejects five nonempty invalid names without
  tmux/ps calls. Valid-name present/absent results and herdr/PID routes pass;
  simulated tmux/ps errors still return false. The same invalid-handle codex
  record remains working after both lifecycle checks, and cleanup retains the
  record/workspace. No lifecycle worker process is started by this probe.

## Disposition of the round-1 findings

| Round-1 item | State | Evidence at 4034ece7 |
| --- | --- | --- |
| M-1, creation before refusal | Fixed | `packages/core/src/tmux.ts:133` validates before any subprocess. Both live reproductions leave the session list unchanged; removing the check fails six tests. |
| m-1, refusal becomes false liveness | Fixed | Target construction precedes the catch in codex `src/index.ts:547`, gemini `:178`, opencode `:1284`. All three reject without subprocesses. The codex lifecycle reproduction stays working through both checks. |
| m-2, CLI probe mutant survives | Fixed | `packages/cli/__tests__/commands/send.test.ts:404` checks exact probing and restore routing; `:419` checks live exact delivery. The original production mutant fails both. |

These are closure references to round-1 IDs, not new findings. There are no new
B-n, M-n or m-n findings, and no item blocks landing under the owner rule.

### M-1: independent live replay

After frozen install and a fresh build in this worktree, imported the exported
`newTmuxSession` from `packages/core/dist/index.js`. The fake HOME environment's
tmux shim ran `env -u TMUX /usr/bin/tmux -L aosrv-ao53-r2-live -f /dev/null`.
Reproducer calls:

```js
await newTmuxSession({ name: "bad name", cwd: scratch, command: "echo MARKER" });
await newTmuxSession({ name: "bad name", cwd: scratch });
// Catch each refusal and list sessions before/after each call.
// Positive: create kr-10, then create kr-1 with command "echo MARKER".
```

Observed output:

```text
CASE invalid name with command
list-sessions BEFORE: "keeper"
REJECT Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/
list-sessions AFTER: "keeper"
CASE invalid name without command
list-sessions BEFORE: "keeper"
REJECT Invalid tmux session name "bad name": must match /^[a-zA-Z0-9_-]+$/
list-sessions AFTER: "keeper"
CASE positive exact name; the longer-name pane is a bystander
list-sessions BEFORE: "keeper\nkr-10"
list-sessions AFTER: "keeper\nkr-1\nkr-10"
exact live: true
```

The positive pane was `/bin/cat`, not a shell executing the marker. Its capture
began `^[echo MARKER\ncho MARKER\n`; the longer-name pane contained only blank
lines. Thus command bytes went to the exact pane, with no agent invocation.
The added positive unit test separately pins all four argv vectors: create,
Escape, literal command and Enter. Both invalid-name variants now fail before
creation, including the no-command case that previously resolved.

### m-1: independent refusal, normal-path and lifecycle checks

An isolated local-vitest probe imported actual tip agent, runtime, session-manager
and lifecycle-manager source. Only the child-process boundary was mocked; fake
metadata/workspace files lived below scratch TMPDIR. For each of codex, gemini
and opencode, `bad name`, `a.b`, `c:d`, `=kr-1` and `kr-1\n` rejected with the
helper error and `calls=[]`. A valid `kr-1` used these vectors:

```text
["tmux","list-panes","-t","=kr-1:","-F","#{pane_tty}"]
["ps","-eo","pid,tty,args"]
```

All three returned true for their process on the returned TTY, false when absent,
and false when either tmux or ps failed. Herdr handles containing punctuation
still used only Herdr, and a process-runtime handle pointing at the probe's own
live PID returned true without subprocesses. The original truthy-ID guard and
non-tmux branches are unchanged.

Reproducer for the lifecycle check: create an old `working` codex record with a
tmux runtime handle named `bad name`; call the real lifecycle manager's check
twice, then the real session manager's cleanup, all on the fake config/state.

```text
lifecycle check 1 status=working calls=[]
lifecycle check 2 status=working calls=[]
cleanup {"killed":[],"skipped":["kr-1"],"errors":[]}
record present=true; workspace present=true; destroyed=[]
Test Files  1 passed (1)
     Tests  4 passed (4)
```

The rejected observation remains unknown instead of becoming the false liveness
answer that previously changed this record to killed. Catch-all behavior for
actual subprocess failures remains R4 work, as requested.

## Tests and independent mutants

Used `git archive 4034ece7` in `/tmp/aosrv/ao53-r2/mutant`, linked installed
dependencies and copied this worktree's built package outputs. No scratch build.
Restored source between variants and used local vitest under the same fake HOME,
gh stub and private tmux shim. The three agent tests exercise their actual source;
the core test exercises its source, and CLI aliases point into the scratch copy.

| Mutation | Result | Test that detects it |
| --- | --- | --- |
| CLI `has-session`: `targets.session` back to `tmuxTarget` | 2 fail, 24 skipped | Both new routing tests, names below |
| Remove core's early `assertSafeTmuxName(opts.name)` | 6 fail, 36 pass | Six invalid-name creation cases, names below |
| Codex builds exact target inside catch again | 1 fail, 162 pass | Added refusal test |
| Gemini builds exact target inside catch again | 1 fail, 62 pass | Added refusal test |
| OpenCode builds exact target inside catch again | 1 fail, 224 pass | Added refusal test |
| Remove the CLI positive-control test only | 25 pass; survives | Deleting a test introduces no failing assertion in the remaining file |
| Supplement: fixture always answers missing, control retained | 1 fail, 1 pass, 24 skipped | Live exact delivery control |
| Same broken fixture, control removed | 1 pass, 24 skipped; survives | Dead-record test alone cannot distinguish this fixture bug |

Exact failed names (common CLI prefix: `send command session manager integration
a recorded session whose tmux session is gone while a longer name lives`):

```text
checks the exact name and sends through the session manager (restore), not directly
delivers directly when the session of the exact name lives (control)

newSession refuses the name "bad name" (command undefined) before any tmux call
newSession refuses the name "bad name" (command "echo MARKER") before any tmux call
newSession refuses the name "a.b" (command undefined) before any tmux call
newSession refuses the name "a.b" (command "echo MARKER") before any tmux call
newSession refuses the name "c:d" (command "echo MARKER") before any tmux call
newSession refuses the name "" (command "echo MARKER") before any tmux call

isProcessRunning rejects with the helper's error, before any tmux or ps call, for a name that is not a safe tmux name
```

The last name fails once in each agent. The CLI production mutant previously
passed all 267 CLI tests; it now fails both new tests. Test deletion alone is an
expected survivor, not a production finding. The supplemental fixture experiment
shows the positive control prevents a vacuous dead-session test. All twelve new
tests add assertions; no old test or assertion was removed or weakened.

## Scope, remaining launch refusal, and commits

Round-2 diff: **9 files changed, 155 insertions, 6 deletions**. No change to
`session-manager.ts`, runtime-tmux, CLI production source, `core/src/index.ts`,
`types.ts`, `docs/DEVELOPMENT.md`, or `orchestrator-prompt.ts`. The name helpers and
the agent catch bodies are unchanged. In particular there is no R2 server/data
identity work or general R4 exception rewrite hidden in this patch.

`packages/plugins/agent-opencode/src/index.ts:663` still constructs its launch
probe target inside the existing catch. A refused name returns null; it does not
produce `PaneGoneError`, execute tmux/ps, or report a successful launch. The launch
wait at `:705` retries and ultimately throws its bounded timeout. The shared
send-TUI check at `:856` also withholds sending and eventually refuses with
`AgentNotAttachedError`. This loses the original validation diagnostic and can
delay refusal, but does not authorize a send or destruction. Supported runtime
creation already rejects such names. **Nonblocking**, consistent with the
round-1 disposition; no new finding. This path is unchanged in round 2 and does
not recreate the lifecycle false-killed result fixed by m-1.

The author report was read only after completing my own live M-1 replay, m-1
probe and CLI mutant. Its stated outcomes agree with these independent runs.

History is a straight line, with the parent printed beside each commit:

```text
c4495485 5b363474  fix(core): refuse an unsafe tmux name before newSession creates the pane
9181d70f c4495485  fix(agents): reject instead of answering false when a pane name is refused
4034ece7 9181d70f  test(cli): pin the exact has-session target and the routing of ao send
git branch -r --contains 4034ece7
<empty>
```

All three bodies explain the failed behavior and why the change fixes it. No
Co-Authored-By trailer, emoji or issue number. No commit was made in this review.

## Gates at 4034ece7

All commands ran in this worktree with an empty inherited environment:

```sh
env -i HOME=/tmp/aosrv/ao53-r2/home \
  PATH=/tmp/aosrv/ao53-r2/bin:/usr/bin:/bin \
  TMPDIR=/tmp/aosrv/ao53-r2/tmp SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 \
  <command>
```

`pnpm install --frozen-lockfile` (also HUSKY=0), `pnpm build`, each filter below,
`pnpm lint`, `pnpm typecheck`, and `pnpm -r --no-bail test` all exited **0**.
Build printed `build: Done` for all 12 buildable packages; typecheck printed
`typecheck: Done` for all 13 packages with that script. Build preceded live runs
and dependent tests. Package scripts invoke the local vitest binary.

Summary lines for `pnpm --filter ./packages/<package> test`:

| Package | Test Files | Tests |
| --- | --- | --- |
| core | 53 passed (53) | 1392 passed / 4 expected fail (1396) |
| cli | 21 passed (21) | 269 passed (269) |
| plugins/runtime-tmux | 2 passed (2) | 52 passed (52) |
| plugins/agent-claude-code | 4 passed (4) | 214 passed (214) |
| plugins/agent-codex | 4 passed (4) | 220 passed (220) |
| plugins/agent-gemini | 2 passed (2) | 67 passed (67) |
| plugins/agent-opencode | 6 passed (6) | 322 passed (322) |
| plugins/workspace-worktree | 3 passed (3) | 65 passed (65) |
| integration-tests | 10 passed / 3 skipped (13) | 91 passed / 24 skipped (115) |

Full recursive run repeated these summaries and added:

```text
notifier-desktop: Test Files 1 passed (1); Tests 26 passed (26)
runtime-herdr: Test Files 2 passed (2); Tests 38 passed (38)
scm-github: Test Files 3 passed (3); Tests 140 passed | 5 skipped (145)
tracker-github: Test Files 1 passed (1); Tests 42 passed (42)
```

Summed full result: **112 passed files, 3 skipped; 2938 passed tests,
4 expected fail, 29 skipped (2971 total)**. No unexpected failures. Integration
ran with no agent executable on PATH and tmux through the private shim; skipped
agent/model cases were not enabled. No real OpenCode binary was called.

Lint summary: `5 problems (0 errors, 5 warnings)`. Existing warnings are
`cli/src/commands/spawn.ts:333`, `core/src/activity-log.ts:91`,
`core/src/plugin-registry.ts:232`, and `core/src/session-manager.ts:2223,2230`;
none of these lines changed in round 2. Existing ESLint ignore-file and Node URL
deprecation notices also appeared.

Red mode used `SAME_ID_DEFECTS=red ./node_modules/.bin/vitest run same-id` in the
nine relevant packages. Failed assertion counts from JSON results:

```text
R1 0
R2 8
R3 6
R4 11
```

In each of codex, gemini and opencode these two R4 tests still fail, six total:

```text
[same-id R4] D-D: the <agent> liveness answers false when it cannot check
  isProcessRunning rejects when ps fails
  isProcessRunning rejects when the tmux server cannot answer
```

Those six failures and the full R2/R3/R4 count match the intended deferred work;
the helper refusal changed without changing actual subprocess-error handling.

## Whole-R1 verdict and follow-up

**LAND-SAFE for `c516cead..4034ece7` under the owner's rule.** No open blocker,
major or minor made by R1, worsened by R1, or left in code changed by R1 was found.
The three round-1 landing findings are closed. The unchanged target sweep,
window/prefix isolation, attach, and readiness results carry forward from round 1;
this short re-check does not claim to repeat them or solve R2/R3/R4.

- **F-1**, `packages/core/src/orchestrator-prompt.ts:61`, unchanged older prose:
  read-only `tmux capture-pane` is permitted without teaching the exact `=name:`
  target. An agent following the prose may still choose a prefix target.
  Reproducer: inspect the generated prompt; it names capture-pane but supplies
  no exact-target rule. Follow-up only by the owner's explicit scope decision;
  it does not block this landing. No new F-n items.

Correct in this round: refusal precedes creation; each agent preserves unknown
on name-validation failure; ordinary valid/herdr/PID routes retain their behavior;
CLI tests check both restore and direct delivery; production scope stays narrow;
all required gates pass and the deferred defect counts stay unchanged.

## Cleanup and host-state check

All test/mutant/red-mode processes completed. No scratch lifecycle worker was
started. Stopped only the three recorded stand-in pane PIDs, **3461918, 3461935,
3461943**, with SIGTERM; their private server **3461917** then exited itself.
Every recorded PID was absent from /proc afterward, including zombie states.
An independent /proc scan for the scratch HOME found no remaining owned process
(excluding the checking process and its parent):

```text
remaining recorded processes: []
Own remaining scratch processes: []
aosrv-ao53-r2-live: exit 1, no server running on /tmp/tmux-44402/aosrv-ao53-r2-live
aosrv-ao53-r2-test: exit 1, no server running on /tmp/tmux-44402/aosrv-ao53-r2-test
```

Both server checks used `env -u TMUX /usr/bin/tmux -L <owned-name> list-sessions`
inside the fake environment. Removed those two stale owned socket files. No
fleet worker, watcher, other session, or default tmux server was touched.

After work, `ls -la --time-style=full-iso ~/.ao/bin` printed the same listing as
before, including all mtimes, sizes and modes:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

Required command and complete output, before removing the marker:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aosrv2-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

```text
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-50
```

Both entries are external fleet writes, not writes by this isolated review.
The ao-50 record now says `generation=7`, `status=stuck`; its mtime/birth time is
2026-10-21 13:36:04.542076550 -0400. Its parent directory has the same mtime,
consistent with atomic record replacement. This identifies the affected author
session and external lifecycle activity; stat does not establish the exact
writer PID. No real config/state ao command was run. Real files were only read
with the allowed shell commands; no service.json or auth.json contents were read.

Final cleanup removed only `/tmp/aosrv/ao53-r2` and `/tmp/aosrv2-marker`;
other scratch trees were untouched. Verification: `Scratch exists: false; marker
exists: false`; final owned-process list `[]`. Review evidence above was retained
before deleting scratch logs. `git diff --exit-code` and `git diff --check` both
exit 0. The round-1 review has the same Git blob as its copy at `40573472`.
Only the task/report and the two review files remain untracked; no tracked source
changes or commits.
