# Review R2: `~/.ao/bin` PATH fix

Verdict: **NOT-LAND-SAFE**

New findings: **0 blockers, 1 major, 2 minor**. The major is an incomplete implementation of the owner's Claude Code isolation decision: a Claude pane spawned by an ao process whose PATH already contains the wrappers inherits them. The ordinary clean-parent launches and the requested wrapper cases pass. The original broken `/usr/local/bin/claude` resolution is fixed on this host.

Reviewed HEAD: `b21bb304c9a41a071f35347ba0acb78614fc74c9`. Round 2: `4eadc823..b21bb304`; whole fix: `e674e84a..b21bb304`. Reviewer: ao-23, Codex. No code changed, no commit, no push, no PR. The author report was read after the independent pane, cause/caller, PATH-order and branch checks.

All tests and ao-module drivers used HOME under `/tmp/pathrev-sol23.88EW6E`, no real config, and a shim executing `unset TMUX; exec /usr/bin/tmux -L pathrev-sol23 "$@"`. Direct tmux invocations also removed TMUX and specified that label. No default-server command ran. AO_STATE_ROOT was unset for the test suites. No model turn ran. The pane's temporary `.bash_profile` sourced the real profile solely for the permitted command-resolution probes, then restored the temporary HOME before the probe or Node driver ran. Other reads of startup files used `grep -n PATH` only.

## New findings

### M-1: Claude Code inherits wrappers from a wrapper-enabled parent

Files: `packages/plugins/agent-claude-code/src/index.ts:699`, especially the omission at `:718`; `packages/plugins/runtime-tmux/src/index.ts:82`; `packages/core/src/session-manager.ts:1132` and `:1138`. The same launch-environment construction occurs for orchestrators and restore (`:1553`, `:2557`). This is R1 M-4 **partly fixed**, not fully fixed.

`getEnvironment()` omits PATH and GH_PATH, but omission does not remove inherited environment variables. With no explicit PATH, runtime-tmux starts its new client with `process.env`. tmux then puts that client's PATH into the child pane. A supported parent is a Codex, Gemini or OpenCode pane running `ao spawn --agent claude-code ...`; after this fix that parent has `~/.ao/bin` on PATH. Neither the session manager nor runtime strips it. An existing server environment can also retain GH_PATH; omission is not an unset operation.

Independent reproduction using the worktree's built plugins and runtime, temporary HOME, and the private server:

1. Install the current wrappers into the temporary HOME with `setupPathWrapperWorkspace(tempWorkspace)`.
2. Obtain a Codex environment with `codex.create().getEnvironment({ sessionId: "parent" })` and put its PATH into the driver's `process.env.PATH`, as a CLI called inside that pane would inherit it.
3. Call Claude Code's `getEnvironment({ sessionId: "child" })`; it has neither a PATH nor a GH_PATH property.
4. Pass that environment into the real `runtime.create()`, launching only a probe of `command -v claude codex gemini opencode git gh`.

Observed child resolution:

```text
/home/taisung/.local/bin/claude
/home/taisung/.nvm/versions/node/v25.7.0/bin/codex
/home/taisung/bin/gemini
/home/taisung/.opencode/bin/opencode
/tmp/pathrev-sol23.88EW6E/home/.ao/bin/git
/tmp/pathrev-sol23.88EW6E/home/.ao/bin/gh
```

The child's PATH had the wrapper directory at position 18. A separate driver launched from an actually attached private tmux pane confirmed that the parent was inside tmux and the child's wrapper resolution survived. The newly executed tmux client is still a separate unattached client; attachment of its parent is not a sanitizer.

This reinstates the two writers that the owner explicitly excluded. On the same temporary repository/record, the real current git wrapper executing `git checkout -b 'feat/quoted'` wrote `branch=feat/quoted`. Running the exported real Claude PostToolUse script with the equivalent Bash command `git checkout -b "feat/quoted"` then wrote `branch="feat/quoted"` (literal quotes). The hook also still wrote `status=merged` for a simulated successful direct `gh pr merge 42 --squash` tool result. Those hook defects are accepted pre-existing limitations; the newly inherited wrapper plus hook combination is contrary to the chosen increment. A further real script containing `git checkout main`, invoked as `bash <script>` in the simulated nested Claude environment, changed `branch=feat/quoted` to `branch=main`; the actual hook then returned `{}` and left it there. A hook-only pane does not parse a git invocation hidden in such a script. This extends branch writes and their PR-discovery consequences to Claude without the owner decision authorizing it. A nested Claude pane can also execute whichever shared wrapper version another installer last wrote, contrary to D9's stated insulation.

Required before landing: enforce the hook-only contract when the parent or server already carries wrapper environment, or obtain an explicit change to that contract. Add a launch-level regression with a wrapper-enabled parent; checking only the properties returned by `getEnvironment()` cannot catch it. If launch-boundary sanitization needs a file outside the author allowlist, expand that scope explicitly. No implementation change was made in this review.

### m-1: updated Codex tests still assert copies of shell source text

File: `packages/plugins/agent-codex/src/index.test.ts:1830` and `:1878` (also `:1837`, `:1848`, `:1854`, `:1885`, `:1892`). R1 m-9's important behavior gaps are repaired, but its source-literal concern remains.

A behavior-preserving mutation in the scratch copy changed:

```bash
[[ "$candidate" -ef "$0" ]] && return 1
```

to:

```bash
if [[ "$candidate" -ef "$0" ]]; then return 1; fi
```

With only that shell-text change in the current core source, the four real recursion tests passed (`4 passed | 35 skipped (39)`), while the two Codex tests named `skips every ao wrapper copy...` failed (`2 failed | 213 skipped (215)`). Their exact-string assertions reject equivalent code. These should delegate to the semantic wrapper coverage or assert observable behavior. The real execution tests in core are useful and substantially reduce the impact of this minor finding.

### m-2: stale Codex comment describes a removed mechanism

File: `packages/plugins/agent-codex/src/index.ts:386`.

Reproducer: read lines 385–388 alongside the new `AO_FIND_REAL_BIN` in `packages/core/src/agent-workspace-hooks.ts:156`. The comment says the wrappers strip their directory from PATH. They now retain PATH and select a candidate by file identity/header. The author correctly disclosed this, and the file is outside the allowed source list. Severity: minor documentation follow-up; it is not a reason to expand this implementation silently.

## Status of every R1 finding

The IDs in this table refer to R1, not the new findings above.

| R1 ID | Status | Independent evidence |
| --- | --- | --- |
| B-1 | Fixed for the host's normal launches | At both revisions all four agent binaries resolve to the same user installations, for each of the four plugins. No probe selects an agent under `/usr/local/bin`. |
| M-1 | Fixed | Client env.PATH is the plugin PATH; raw t1–t4 reproduce the tmux rule; parent attachment and a different server PATH do not defeat the new invocation. No typed export. |
| M-2 | Fixed for the specified operations | Real git/record matrix below: correct HEAD branch, detached/failed calls preserve the record, other worktree does not write. |
| M-3 | Fixed in the wrappers | Both merge forms exec the fake gh without any record change; create records URL and pr_open. Claude's existing hook remains outside this fix. |
| M-4 | Partly fixed | Clean-parent Claude has exactly the baseline PATH; nested wrapper-enabled parent defeats the hook-only decision (new M-1). |
| m-1 | Fixed | Clean-parent creates take 22–35 ms, no PATH-export sleep. The existing 300 ms for long launch commands/messages is separate. |
| m-2 | Fixed | Captures from all eight baseline/tip panes and the long-PATH pane contain no `export PATH`. |
| m-3 | Fixed | A 4533-byte supplied PATH reaches a live pane with its final dummy directory intact, and the probe runs. |
| m-4 | Not fixed; accepted record-only cost, reduced in measured cases | 100 calls each: status 5.25 ms real / 10.45 wrapped; rev-parse 4.29 / 9.12. Approximately 5 ms extra on a three-entry PATH; branch writes cost more. |
| m-5 | Fixed | Fake gh progress stays on stderr for create and merge; stdout is only the URL; failure code 4 stays 4. |
| m-6 | Fixed | `checkout -q -b`, `switch -q -c`, and `git -C <own repo> checkout -b` all record the new branch. |
| m-7 | Fixed for the requested spellings and copies | Both git and gh work with trailing slash, doubled slash, symlinked directory and another wrapper copy; self-referential GH_PATH is ignored. |
| m-8 | Not fixed; disclosed operational limit | Independent install sequence changes marker/content 0.2.3 → 0.2.1 → 0.2.3. Individual writes are atomic, not a fleet-wide version transaction. |
| m-9 | Partly fixed | Missing-helper tests fail when no-op blocks are removed; inode test fails with always-rewrite; versions are derived/exported. Source-text tests remain (new m-1). |
| m-10 | Fixed | resetAllMocks removes queued values. Baseline-source run has only the two intended runtime test failures, with no cascade. |
| m-11 | Partly fixed | tmux/core/Gemini mechanism comments are corrected. Codex's disclosed stale comment remains (new m-2); the absolute Claude exclusion claim needs new M-1 resolved. |
| m-12 | Fixed for the four new commits | All four are `fix(scope):` with explanatory bodies, no issue number/emoji/coauthor. The inherited round-1 `feat:` commit is unchanged, as instructed. |
| m-13 | Not fixed; still unverified, minor | Herdr has a different server/API; the tmux-specific replacement cannot be inferred there. No fleet uses it today; no shared Herdr state was changed. |

## Pane resolution and tmux cause

Baseline sources were extracted from git into `/tmp`, transpiled there, and used for the baseline runtime and each plugin's environment. Baseline hooks/PATH builder were the baseline implementation. Unused plugin-local imports resolved to this worktree's built helper modules; none of their agent methods was invoked. Tip panes used the actual worktree `dist` runtime/plugins. No baseline build or write occurred in the primary checkout. The same temporary HOME and real startup behavior were used on both sides.

At `825b0dbc`, **each** of claude-code, codex, gemini and opencode resolved, in the requested order:

```text
claude    /home/taisung/.local/bin/claude
codex     /home/taisung/.nvm/versions/node/v25.7.0/bin/codex
gemini    /home/taisung/bin/gemini
opencode  /home/taisung/.opencode/bin/opencode
git       /usr/bin/git
gh        /usr/bin/gh
```

At `b21bb304`, the first four paths were identical for **each** plugin. Claude Code still resolved git/gh to `/usr/bin/git` and `/usr/bin/gh` with a clean parent. Each of Codex, Gemini and OpenCode resolved them to `<temporary HOME>/.ao/bin/git` and `.../gh`.

| revision | plugin | pane PATH bytes | wrapper position | create ms | typed export |
| --- | --- | ---: | --- | ---: | --- |
| 825b0dbc | claude-code | 3095 | absent | 31 | none |
| 825b0dbc | codex | 3095 | absent | 29 | none |
| 825b0dbc | gemini | 3095 | absent | 22 | none |
| 825b0dbc | opencode | 3095 | absent | 32 | none |
| b21bb304 | claude-code | 3095 | absent | 35 | none |
| b21bb304 | codex | 1416 | 18 | 34 | none |
| b21bb304 | gemini | 1416 | 18 | 30 | none |
| b21bb304 | opencode | 1416 | 18 | 35 | none |

The complete clean-parent Claude PATH strings were equal, not just equal in length. Current metadata for the stale `/usr/local` agent installations confirms claude 1.0.112, codex 0.104.0 and gemini 0.29.7. None was launched. The supplied 4533-byte PATH retained `/tmp/path-long-239` in the live pane; git/gh still resolved to the temporary wrappers.

Raw tests on tmux 3.4 used a server originally started with `/server-only:/usr/bin:/bin`:

| case | client PATH | explicit pane/session PATH | client attached | observed pane PATH |
| --- | --- | --- | --- | --- |
| t1 | /cliB:/usr/bin:/bin | /fromE:/usr/bin:/bin | no | /cliB:/usr/bin:/bin |
| t2 | absent | /fromE2:/usr/bin:/bin | no | /fromE2:/usr/bin:/bin |
| t3 | /builtC:/usr/bin:/bin | absent | no | /builtC:/usr/bin:/bin |
| t4 | /cliD:/usr/bin:/bin | /fromE4:/usr/bin:/bin | yes, attach followed by new-window in the same client | /fromE4:/usr/bin:/bin |

This matches the unattached-client conditional in [tmux 3.4 spawn.c](https://raw.githubusercontent.com/tmux/tmux/3.4/spawn.c). Running a fresh tmux executable from an attached pane creates a new command client; it does not turn that executable into the parent's attached client. I ran the actual runtime from such a pane while an attachment existed, and the new Codex pane kept the wrappers and all four correct agent paths.

Caller audit:

- Shell `ao spawn`: session-manager `:1132–1151` obtains the plugin environment and calls this runtime.create.
- `ao spawn` from an orchestrator pane: same source path and a separate execFile client. The attached-parent live driver passed. Parent environment inheritance still matters for Claude (new M-1).
- Restore: session-manager `:2557–2585` passes the same plugin environment into runtime.create. Its parent's PATH is replaced only when the plugin supplies PATH, so Codex/Gemini/OpenCode do not depend on server-global PATH.
- `ao start`: start.ts `:950` calls spawnOrchestrator; session-manager `:1553–1578` uses the same runtime.

No model agents were launched to exercise the entire spawn/start/restore CLI workflows. Their common runtime path was exercised live and their call sites inspected; package/integration tests cover the surrounding session code. The brief's phrase “lifecycle worker's restore” is not a current call path: the lifecycle worker instantiates a SessionManager but lifecycle-manager never calls its restore method. The only production `.restore(...)` call found is the `ao session restore` CLI (`session.ts:384`). This distinction also matters to restart planning below.

A startup file that replaces PATH can still discard the wrappers; a prepended directory containing its own git/gh can shadow them. This host's PATH exports preserve `$PATH`, and the measured prepended directories do not shadow git/gh. Do not generalize the host result to arbitrary shell startup code.

## `/usr/local/bin` and real gh

Removing promotion is right for this scope. An executable `/usr/local/bin/gh` still wins through GH_PATH, regardless of its PATH position. On this host it does not exist. With `GH_PATH=/usr/local/bin/gh`, the real current wrapper fell back to `/usr/bin/gh`, returned exit 0 and the exact normal gh 2.45.0 version output, with empty stderr. A fake gh on the private PATH was likewise selected and wrote the PR URL; it did not select the wrapper again.

The older promotion helped a host with a preferred gh under `/usr/local/bin` shadowed by e.g. linuxbrew, or absent from the inherited PATH. Explicit GH_PATH now handles that case. If that file is missing, keeping the inherited order selects the same available gh the user would normally run. The builder no longer adding `/usr/local/bin` can affect other names on hosts that relied on its implicit injection, but no such dependency was demonstrated here; promoting stale agent installations is not a sound way to select gh.

## Real git and metadata matrix

All rows used current scripts, real git 2.43.0, a real committed temporary repository and a real session file with its own `worktree=`. Initial branch metadata was `main` unless stated. “Unchanged” means no metadata content change; failed and detached cases leave the last recorded branch intact as specified.

| command | exit | HEAD afterwards | stored branch afterwards |
| --- | ---: | --- | --- |
| checkout -- src/a.txt | 0 | main | `branch=main` unchanged |
| switch --detach origin/main | 0 | detached | `branch=main` unchanged |
| checkout origin/main -- src/a.txt | 0 | main | `branch=main` unchanged |
| switch feat/worker-x | 0 | feat/worker-x | `branch=feat/worker-x` |
| then checkout main | 0 | main | `branch=main` |
| checkout feat/worker-x in another worktree, with this session's environment | 0 | other worktree: feat/worker-x; own: main | `branch=main` unchanged |
| checkout -q -b feat/q | 0 | feat/q | `branch=feat/q` |
| switch -q -c feat/sq | 0 | feat/sq | `branch=feat/sq` |
| -C <own repo> checkout -b feat/c, from outside the repo | 0 | feat/c | `branch=feat/c` |
| checkout -b feat/a | 0 | feat/a | `branch=feat/a` |
| switch -c feat/b | 0 | feat/b | `branch=feat/b` |
| checkout -B feat/big-b | 0 | feat/big-b | `branch=feat/big-b` |
| checkout no-such-branch | 1 | main | `branch=main` unchanged; normal git stderr |
| checkout origin/main | 0 | detached | `branch=main` unchanged |
| checkout -b feat/same, with tag feat/same already present | 0 | feat/same | `branch=feat/same`, without `heads/` |
| orchestrator record: cherry-pick topic | 0 | main | `branch=main` unchanged |
| orchestrator record: merge --ff-only topic | 0 | main | `branch=main` unchanged |

The package tests additionally start the detached cases from feature metadata and correctly retain `branch=feat/worker-x`. The full-ref symbolic-ref approach avoids the branch/tag ambiguity of `--short`.

Storing `main` is the explicit “branch HEAD now names” rule and is accurate for restore. It also changes PR fallback: lifecycle-manager `:452–475`, then scm-github `:517–541`, searches `gh pr list --head main` if no PR is stored. It will no longer discover the former feature branch's PR while the worker stays on main. Once `pr=` is recorded, that PR remains available independently of branch. This is an owner-facing behavioral limit, not a reason to restore the stale feature-branch heuristic. Agents should keep the feature branch until PR ownership is recorded, or claim the PR explicitly. A file checkout can refresh a stale branch value if it differs from actual HEAD; “file checkout never writes” is only true when the recorded branch already matches.

## gh, guard, missing files and install

Fake gh emitted `fake progress` to stderr, `https://github.com/o/r/pull/42` to stdout, captured every argument separated by NUL and copied stdin to a temporary file. Nothing contacted GitHub.

| call | outcome |
| --- | --- |
| pr create --title `it's a $title with spaces` --body-file - | Exit 0; all six arguments unchanged; stdin `body from stdin\n` unchanged; stdout URL only; stderr progress only; record gains `pr=https://github.com/o/r/pull/42` and `status=pr_open`. |
| pr create --fill, fake exit 4 | Exit 4; streams intact; no metadata write despite a printed URL. |
| pr merge 42 --squash | Exit 0; arguments/stdin/streams intact; no metadata write. |
| pr merge --auto --squash | Exit 0; arguments/stdin/streams intact; no metadata write. The real package test also checks a prior pr_open record stays pr_open. |
| pr create with missing metadata | Exit 0, normal output, no metadata record created. |

For **both** git and gh, trailing-slash PATH entries, doubled-slash entries, symlinked wrapper directories, and a second wrapper copy reached the real binary with exit 0 and empty stderr. GH_PATH pointed at each corresponding wrapper and was rejected. The normal version outputs were git 2.43.0 and gh 2.45.0. The second-line headers of 0.2.1/0.2.2/0.2.3 are compatible with the new header check. A manually corrupted header is not covered by the cross-copy guarantee, but the self-file identity test still rejects the same file.

With the helper removed, successful git branch creation still returned git's normal output/exit code and left metadata unchanged; gh create likewise kept its original stdout/stderr and wrote nothing. With a missing session record, both commands ran successfully and created no record. The no-op fallbacks are effective.

Current installation produced:

```text
version 0.2.3
helper 2350 bytes
gh     2213 bytes
git    3471 bytes
marker    5 bytes
```

A second install kept all four inodes unchanged (`121393278`, `121393279`, `121393280`, `121393281` in that run). Deleting git with a current marker repaired it. Editing gh with a current marker restored exact expected content. Source `agent-workspace-hooks.ts:367–374`, `:397–435` writes random-suffix temporary files beside each target, renames them, and writes the marker last. This prevents partial individual scripts, not mixtures across files or across installers. Helper content is unchanged from 0.2.1.

Independently running the baseline installer against the same temporary HOME changed marker/scripts back to 0.2.1 (gh 1758 bytes, git 1333 bytes); the next current install restored 0.2.3 and its sizes. A build alone does not install new wrappers, remove old loaded JavaScript, or update already-running pane environments. Every pane already using this shared directory sees the scripts currently installed on its next call, including a rollback to the old bad writes.

Installer/restart audit, exhaustive for the production call sites in this tree:

- The three wrapper-using plugins expose setupWorkspaceHooks and postLaunchSetup. Only these methods call setupPathWrapperWorkspace (`codex:658–676`, `gemini:263–269`, `opencode:704–710`). Claude's plugin does not call it.
- Worker spawn runs postLaunchSetup (`session-manager:1203`). `ao spawn` and an in-progress `ao batch-spawn` are installer hosts; a batch can retain old modules while later items start.
- Orchestrator creation runs setupWorkspaceHooks (`:1340`, `:1449`) and postLaunchSetup (`:1616`), so an in-progress `ao start` can install. The project-workspace reuse path can run setup before deciding an existing orchestrator is alive.
- Restore runs postLaunchSetup (`:2605`), so an in-progress `ao session restore`, or a persistent Node embedding of SessionManager that calls restore, can install old constants. Any other resident Node embedder calling spawn/spawnOrchestrator is the same risk.
- The resident lifecycle-worker holds loaded plugins/SessionManager, but **has no current spawn/restore/setup invocation**. The report's example of that worker installing scripts “on its next restore” is unsupported at this HEAD. Restart it for build consistency if desired; it is not a demonstrated installer today. Recovery actions only repair metadata, not launch/setup.
- tmux, Herdr, agent model processes and ordinary long-lived shells do not run this TypeScript installer themselves. A fresh ao CLI subprocess loads the build it resolves on disk. Ensure it resolves the rebuilt checkout/plugin store; merely restarting a shell does not select a new build. Existing wrapper calls load scripts from disk, not a JS snapshot.

Quiesce old in-progress installer-capable calls and replace any persistent embeddings or old-build launch paths before installing 0.2.3 for rollout. Restarting a selected daemon without checking those producers is insufficient.

## Tests and non-vacuity

All commands ran from this worktree (scratch package tests only for the explicitly required counterfactuals/mutations), with temporary HOME, TMUX removed, private shim first on PATH, and AO_STATE_ROOT unset. `pnpm install && pnpm build`: both exit 0. Full typecheck: exit 0, 13 `typecheck: Done` lines. Build: 12 `build: Done` lines. The five requested typecheck filters were also run explicitly and exited 0.

Requested package test summaries:

```text
core          Test Files 31 passed (31)   Tests 674 passed (674)
runtime-tmux  Test Files  1 passed (1)    Tests  29 passed (29)
claude-code   Test Files  3 passed (3)    Tests 155 passed (155)
codex         Test Files  3 passed (3)    Tests 215 passed (215)
gemini        Test Files  1 passed (1)    Tests  58 passed (58)
```

`pnpm lint`: exit 0, `6 problems (0 errors, 6 warnings)`, all outside changed files. `pnpm test`: exit 0. Package counts: core 674; Gemini 58; Claude Code 155; Codex 215; desktop 26; Herdr 36; SCM 140 + 5 skipped; tracker 42; worktree 46; tmux 29; OpenCode 159; integration 95 + 24 skipped; CLI 243. Total **1918 passed, 29 skipped (1947)**. Integration summary:

```text
Test Files 10 passed | 3 skipped (13)
Tests      95 passed | 24 skipped (119)
```

The 24 integration skips are prompt-delivery 4, Claude 10, Codex 5 and OpenCode 5; isolation removes credentials needed by the live blocks. No known-red exception was used. The known stale doctor launcher check was not pursued.

Counterfactual: git archive of `4eadc823` into the temporary scratch copy; copy only tip test files into it; link dependency directories from this worktree; point the scratch plugin test alias at the scratch core source so the tests do not accidentally use current core dist. No tracked worktree source changed.

| package | unmodified old sources, new tests |
| --- | --- |
| core, the two hook files | `22 failed | 20 passed (42)` |
| runtime-tmux | `2 failed | 27 passed (29)` |
| claude-code | `1 failed | 154 passed (155)` |
| codex | `10 failed | 205 passed (215)` |
| gemini | `58 passed (58)` |

Core's 22 failures consist of 18 behavior-related failures and four caused only by the formerly unexported WRAPPER_VERSION. I reran after adding **only an export of that existing constant**, leaving all old behavior intact: `18 failed | 24 passed (42)`; the version test file then passed. The 18 are: inherited PATH order; nine branch cases (`-q -b`, `-q -c`, `-C`, both file checkouts, both detached cases, main return, other worktree); four recursion cases; create stderr; both merges; the gh missing-helper test (its old-source failure is stderr mixing, not absence of the no-op).

Runtime's two failures are the env.PATH and long-PATH tests. On old code they exhaust their two queued success returns before the PATH assertions and fail inside create; no later test cascades because mocks reset. They discriminate call shape, though the baseline failure itself does not independently prove the env relation. The live raw/pane experiments provide that evidence. Claude's failure is the no-PATH/no-GH_PATH property test. Codex's ten are two PATH tests plus eight shell-text assertions. Gemini's changes derive constants/version and have no old-source behavior difference.

Independent discriminating mutations of tip source, only in the scratch copy:

- Remove both no-op fallback blocks: both missing-helper tests fail (`2 failed | 37 skipped (39)`).
- Force always-rewrite: the real inode test fails (`1 failed | 2 skipped (3)`).
- Equivalent `-ef` shell conditional: core's four real recursion tests pass; Codex's two source-literal tests fail (new m-1).

These results support the semantic tests and delimit what the text assertions actually establish. The missing inherited-parent test is why the green suite does not establish the full Claude isolation contract.

## Herdr, scope and commits

`runtime-herdr/src/index.ts:257–274` passes `--env KEY=VALUE` to `herdr workspace create`; `:289` runs the script with `herdr pane run ... bash ...`. The CLI helper (`:179`) does not override its own process environment. Herdr is not the tmux client/server implementation, so the particular spawn.c PATH replacement is not shown there. A shared-server or startup-file loss remains unmeasured. Severity: minor retained validation gap, not a demonstrated blocker. No Herdr command against the shared service was run.

The whole-fix diff contains exactly the ten allowed files: core hooks and its two tests; runtime-tmux and its test; Claude Code and its test; Codex test; Gemini and its test. Session-manager, OpenCode source, workflows and configs are unchanged. The four new commit subjects are:

```text
64128ff7 fix(runtime-tmux): give the pane the built PATH through the tmux client
d12021a6 fix(agent-claude-code): keep Claude Code panes on their login shell PATH
d0865789 fix(core): stop moving /usr/local/bin ahead of the inherited PATH
b21bb304 fix(core): make the ao git and gh wrappers write only true session values
```

Their bodies explain why, and have no Co-Authored-By trailer, emoji or issue number. `git branch -r --contains b21bb304` prints nothing. The original round-1 unscoped feat commit remains because the author was told not to amend/rebase it. My HEAD remains b21bb304 and tracked `git diff --exit-code` is clean.

## D9 sentence audit and corrected owner paragraph

D9's opening two sentences (“Claude Code panes ... no ao wrappers”; hook “only writer”) hold for clean-parent launches but fail for the inherited-parent reproduction. The next paragraph's host binary paths and normal wrapper selection reproduce; 5–6 ms extra reproduces for simple three-entry-PATH git calls, but is not a constant for all calls (checkout/switch read HEAD and may write metadata; PR create captures output). The two write categories are right, with conditions: create must emit a recognized github.com PR URL, and file checkout may refresh stale branch metadata. “Stores nothing” for failed or other-worktree checkout is right. The main-branch sentence is right but omits the PR-discovery consequence. The merge and stderr sentences are right for the wrappers; the unchanged Claude hook's merged write needs mention. The final version/restart paragraph correctly warns of downgrade, but should include restore and in-flight batch/start calls and should not rely on the report's nonexistent lifecycle-worker restore path. It also omits the startup PATH limit. Corrected text:

> After rebuilding, new and restored Codex, Gemini and OpenCode panes on this host receive `~/.ao/bin` behind the directories added by shell startup. The measured agent commands still select the same user installations. Git and gh go through shared ao scripts; simple git calls cost about 5 ms extra in this review, while branch tracking and PR creation do more work. Successful PR creation records a recognized GitHub PR URL and `pr_open`. Successful checkout or switch in the session's own worktree records the actual attached branch; detached, failed and other-worktree calls leave it alone. Returning to main records main, so a session with no recorded PR then searches for a PR by main instead of its former feature branch. The wrappers do not mark a session merged, and gh's error stream stays separate. Claude Code's plugin adds neither PATH nor GH_PATH, but the current code still inherits wrappers from a wrapper-enabled parent; the hook-only decision needs that launch case fixed before rollout. Its existing hook also still has the accepted branch-parsing and direct-merge limitations. The first relevant setup installs shared version 0.2.3; old in-progress spawn, batch, start or restore calls, old-build launch paths and resident SessionManager users can put 0.2.1 back, affecting every pane already using that directory. Quiesce or replace those installers before rollout. Existing pane PATHs do not change merely because the build changes. A shell startup file that resets PATH can still drop the wrappers.

## What is correct

- Passing PATH to the new tmux client addresses the measured cause, including a separately executed client inside an attached parent pane.
- Keeping inherited binary order prevents the old `/usr/local/bin` agent copies from winning in the measured panes; explicit GH_PATH and fallback handle gh selection.
- Reading the actual full HEAD ref and checking worktree identity fixes every requested R1 branch case without affecting cherry-pick/merge.
- Removing merge-status writes and separating gh stderr fix the metadata/stream defects in the wrappers.
- Identity/header checks stop the demonstrated spelling/cross-copy recursion; missing-helper fallbacks, content repair and individual atomic writes work.
- The full test/build/typecheck/lint gate passes under the required isolation, and the new real execution tests meaningfully fail on old behavior.

## Real `~/.ao/bin` integrity and cleanup

Before the first test/install:

```text
total 24
drwxr-xr-x 2 taisung users 4096 2026-09-16 13:01:16.796056907 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-09-16 13:01:16.796056907 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2350 2026-09-16 13:01:16.794056970 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 1758 2026-09-16 13:01:16.794056970 -0400 gh
-rwxr-xr-x 1 taisung users 1333 2026-09-16 13:01:16.795056939 -0400 git
89e9b7a95433d03c9e6a70996ea47c58  /home/taisung/.ao/bin/ao-metadata-helper.sh
dafbcf0fd58eb25b17fa60cefd0e5aa5  /home/taisung/.ao/bin/gh
ba65621595472c0d72f6ae274987f4c9  /home/taisung/.ao/bin/git
96a5d0f2a178420f4134741cf92b684c  /home/taisung/.ao/bin/.ao-version
```

After the last live/test run and private-server shutdown:

```text
total 24
drwxr-xr-x 2 taisung users 4096 2026-09-16 13:01:16.796056907 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-09-16 13:01:16.796056907 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2350 2026-09-16 13:01:16.794056970 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 1758 2026-09-16 13:01:16.794056970 -0400 gh
-rwxr-xr-x 1 taisung users 1333 2026-09-16 13:01:16.795056939 -0400 git
89e9b7a95433d03c9e6a70996ea47c58  /home/taisung/.ao/bin/ao-metadata-helper.sh
dafbcf0fd58eb25b17fa60cefd0e5aa5  /home/taisung/.ao/bin/gh
ba65621595472c0d72f6ae274987f4c9  /home/taisung/.ao/bin/git
96a5d0f2a178420f4134741cf92b684c  /home/taisung/.ao/bin/.ao-version
```

The two complete listings and all four hashes compare byte-for-byte equal (`cmp` exit 0). The private server PID 1970568 and every captured pane PID were checked after shutdown: none remained live. The attached clients detached and exited. No real global config, wrapper, startup file, plugin store, agent service or primary-checkout build was changed. Temporary scratch copies, test homes, state and private-server socket are removed at completion; only this review and the required `.agent_report.md` are deliverables. Dependencies and build output remain gitignored in this worktree.
