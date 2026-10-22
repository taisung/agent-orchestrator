# 0011 — Native Windows: feasibility, blockers, and porting plan

**Date**: 2026-10-21

**Source baseline**: `8070ff0aa4b4afe1669504877346cf827b883973`

**Owner goal**: run AO on native Windows. WSL does not satisfy this goal.

**Status**: analysis only; no Windows implementation or Windows validation has been performed.

**Revision**: r2, incorporating [review r1](reviews/0011_native_windows_review_r1_sol61.md) on
2026-10-21. Section 9 records the disposition of each comment; the revised plan has not been
independently re-reviewed.

## 1. Assessment and scope

Native Windows is a feasible direction for this fork. Herdr supplies a Windows terminal runtime,
and AO already selects it through the runtime plugin interface. The current implementation still
depends on Unix shells, Linux process inspection, and Linux locking outside that interface.
Changing `runtime: tmux` to `runtime: herdr` does not remove those dependencies.

The intended deployment has AO, Node.js, Herdr, Git, and the selected agent running as Windows
processes against Windows worktrees. A Windows terminal connected to Linux through SSH, or AO
running inside WSL, is a different deployment. Git Bash may be considered as an explicit dependency
for an initial native Windows profile; the owner has not selected that requirement. It would not
solve the Linux locking or process-inspection problems.

Retain the headless architecture. Herdr supplies session execution and native attachment; AO
continues to own worktrees, session records, agent configuration, delivery, and lifecycle policy.
No dashboard or terminal UI needs to be added to AO.

This document records source findings and a proposed implementation sequence. Windows support
remains unqualified; implementation must coordinate with the current same-ID safety work.

## 2. Evidence and limits

| Evidence                                                                                                                                | What was established                                                                                                                | Limit                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Current AO source at the baseline above                                                                                                 | Herdr is a registered runtime; the CLI depends on its package; spawn, send, output, status, and attachment have Herdr paths         | Source inspection on Linux, not Windows execution                                             |
| Earlier live work in [0003](0003_herdr_assessment_and_the_runtime_plugin_option.md) and [0004](0004_running_ao_on_the_herdr_runtime.md) | Herdr 0.8.0 was exercised on Linux, including concurrent workers and delivery retries                                               | Historical Linux evidence; some command and plugin descriptions predate the distribution trim |
| Host checks during this conversation                                                                                                    | `herdr --version` returned `herdr 0.8.0`; `herdr status server` returned `status: not running`; this checkout's config selects tmux | No live Herdr session was launched for this assessment                                        |
| Focused tests during this conversation                                                                                                  | Runtime plugin: 36 ordinary tests plus 2 expected-failure tests; core Herdr helper: 15 ordinary tests                               | Mocked CLI responses; no Windows or live-server coverage                                      |
| Checked-in CI workflows                                                                                                                 | Build, typecheck, test, and integration jobs use Ubuntu runners                                                                     | No Windows qualification exists in these workflows                                            |

The test runner printed 53 passed entries across the selected suites. Two are `it.fails` cases
that remain green because the defects still occur: Herdr liveness returns false on a timeout or
an executable-start failure. The ordinary passing-test count is **51**, not 53 fixed behaviors.
See [the defect tests](../packages/plugins/runtime-herdr/src/__tests__/same-id-defects.test.ts).

Commands used for those focused checks:

```bash
pnpm --filter @aoagents/ao-plugin-runtime-herdr test
pnpm --filter @aoagents/ao-core exec vitest run src/__tests__/herdr.test.ts
```

## 3. What Herdr provides on Windows

Herdr's current documentation describes native Windows support as generally available, with ConPTY
panes, persistent sessions, Windows Terminal/PowerShell application attachment, and agent process-tree
detection. It also lists direct `herdr terminal attach`, live server handoff, and Unix foreground
process groups as unsupported. [Herdr Windows support](https://herdr.dev/docs/windows-beta/), accessed
2026-10-21.

These are upstream capability claims, not results from this checkout. Pin and measure a Windows
Herdr version before implementing against it; the host's Linux 0.8.0 installation is not proof of
the current Windows command contract.

The existing AO adapter invokes the `herdr` executable rather than opening Herdr's transport itself.
That is a useful portability boundary: AO can initially leave transport differences to the Herdr
CLI. Capture real Windows responses for workspace creation, pane lookup, process information,
output reads, prompting, and close operations. Confirm that the identifiers and JSON fields match
what AO consumes.

AO's attachment command is `herdr agent attach <pane>`. Test that exact command on Windows; the
upstream limitation for `herdr terminal attach` alone neither proves nor disproves compatibility.
See [CLI attachment](../packages/cli/src/commands/session.ts) and
[the adapter](../packages/plugins/runtime-herdr/src/index.ts).

Record the elevation level of both the AO client and Herdr server in the Windows profile. Herdr
normally requires an administrator client for an elevated server. Test that an access refusal
remains an error/unknown result and cannot authorize cleanup; qualification does not require
enabling cross-elevation access. [Herdr Windows support](https://herdr.dev/docs/windows-beta/).

## 4. Confirmed source dependencies and their Windows consequences

The dependencies below are present in source. Their Windows consequences are code-based analysis;
they have not been reproduced on a Windows host.

| Area                                 | Source evidence                                                                                                                                                                                                                                              | Consequence / required work                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent launch                         | `writeLaunchScript()` writes a `.sh` file with `rm`, and `create()` executes `herdr pane run … bash <script>` in [runtime-herdr](../packages/plugins/runtime-herdr/src/index.ts)                                                                             | A default Windows shell cannot execute this contract. Choose an explicit compatible shell or a native launch representation.                                                               |
| Shell command strings                | [`shellEscape()`](../packages/core/src/utils.ts) implements POSIX quoting. Claude uses `$(cat …)` for prompt files; OpenCode emits `exec opencode …` in their launch commands                                                                                | Replacing `bash` with PowerShell or cmd.exe does not translate the command. Preserve argument boundaries, model, permission mode, prompt content, and exit status.                         |
| Environment and executable discovery | [`buildAgentPath()` and `removeAoBinFromPath()`](../packages/core/src/agent-workspace-hooks.ts) split/join on `:`; defaults include `/usr/bin:/bin` and `/usr/local/bin/gh`. [Codex discovery](../packages/plugins/agent-codex/src/index.ts) invokes `which` | Windows drive letters, `;`-separated PATH, `Path`/`PATH` casing, executable suffixes, and installed command locations need explicit handling.                                              |
| Metadata hooks                       | [Shared wrappers](../packages/core/src/agent-workspace-hooks.ts) generate Bash `git`/`gh` wrappers; [Claude hooks](../packages/plugins/agent-claude-code/src/index.ts) write `metadata-updater.sh` and parse Bash tool events                                | A pane that launches successfully can still miss branch/PR metadata. Port hook execution and event parsing with the existing key/status allowlists intact.                                 |
| Delivery locks                       | [`isDeliveryLockSupported()`](../packages/core/src/delivery-lock.ts) returns true only for Linux. [Session send](../packages/core/src/session-manager.ts) refuses an eligible agent API route without that lock                                              | This is an explicit feature refusal, currently relevant to OpenCode's delivery hook. It is not a blanket refusal of every runtime-based `ao send`.                                         |
| Session record locks                 | [Metadata writes](../packages/core/src/metadata.ts) run without the record lock when abstract sockets are unsupported                                                                                                                                        | Native Windows would lose concurrent-writer protection. Enabling startup without replacing this lock is insufficient.                                                                      |
| OpenCode launch verification         | `findPaneOpenCodeProcess()` obtains Herdr PIDs, then `readProcessArgv()` reads `/proc/<pid>/cmdline`; process-age checks also use `/proc` in [agent-opencode](../packages/plugins/agent-opencode/src/index.ts)                                               | Herdr selection does not remove the Linux dependency. Launch verification cannot establish the intended session through this path on native Windows; send checks have the same dependency. |
| Launch ownership                     | `processStartToken()` uses `/proc` or Unix `ps -o lstart=` in [session-manager](../packages/core/src/session-manager.ts)                                                                                                                                     | A missing start token produces a warning and leaves launch reservation protection absent. Windows needs a qualified process-creation identity.                                             |
| Workspace setup                      | [workspace-worktree](../packages/plugins/workspace-worktree/src/index.ts) invokes Git through argv, but runs `postCreate` with `sh -c` and creates symlinks with `symlinkSync()`                                                                             | Basic Git operations have a useful portable boundary. Hook shell selection, symlink/junction policy, path behavior, and cleanup need Windows tests.                                        |
| Operator tools                       | [The script runner](../packages/cli/src/lib/script-runner.ts) invokes Bash; [`ao doctor`](../packages/cli/src/commands/doctor.ts) uses it. [Startup](../packages/cli/src/commands/start.ts) generates a tmux default and contains WSL install hints          | Native onboarding and diagnostics must follow the selected runtime and supported Windows profile. Existing Windows install hints do not constitute Windows support.                        |
| Notifications                        | [notifier-desktop](../packages/plugins/notifier-desktop/src/index.ts) implements macOS/Linux and warns on other platforms                                                                                                                                    | Windows notifications are a separate feature gap; an initial profile may explicitly disable them.                                                                                          |
| Qualification                        | [CI](../.github/workflows/ci.yml) and [integration CI](../.github/workflows/integration-tests.yml) run on Ubuntu                                                                                                                                             | Add Windows execution and failure-path coverage before claiming support.                                                                                                                   |

The inventory also includes two data-format boundaries:

- **Worktree enumeration.** `Workspace.list()` in
  [workspace-worktree](../packages/plugins/workspace-worktree/src/index.ts) compares a raw path from
  `git worktree list --porcelain` with a directory constructed by native `join()`, using equality or
  a prefix ending in `/`. For example, `C:/Users/A/worktrees/demo/s1` fails the current comparison
  against `C:\Users\A\worktrees\demo`. This is a source-level counterexample; the output of the
  selected Git for Windows version still needs measurement. Parse the chosen porcelain format,
  normalize separators, and establish actual directory containment without admitting a sibling
  such as `demo-other`. Measure filesystem case behavior instead of lowercasing every path.
  Capture ordinary and `-z` output for supported space/non-ASCII paths. The Git manual specifies
  NUL delimiters for `-z`; its quoted-character rule concerns lock reasons, not a guarantee that
  worktree paths are quoted. Git 2.56.0's porcelain emitter writes the path directly. Do not add
  speculative path unquoting that changes literal path characters.
  [Git format documentation](https://git-scm.com/docs/git-worktree#_porcelain_format),
  [Git 2.56.0 emitter](https://github.com/git/git/blob/v2.56.0/builtin/worktree.c#L946-L974).
- **Agent session data and restore binding.** Measure each supported agent's native data location,
  filename/path convention, and conversation identifier. In
  [Claude Code](../packages/plugins/agent-claude-code/src/index.ts), `toClaudeProjectPath()` derives
  the log directory; a missing session file yields `idle`, and restore selects the latest file in
  that directory. [Codex](../packages/plugins/agent-codex/src/index.ts) starts from a fixed
  home-relative sessions directory, while [Gemini](../packages/plugins/agent-gemini/src/index.ts)
  tests whether its temporary directory has entries before permitting a latest-session restore.
  These are assumptions to qualify per agent, not measured Windows failures. A visible status row
  or an open restored pane does not establish correct activity or conversation continuity.

Execution and shutdown also need deliberate design:

- **Executable versus script launch.** AO uses `execFile()` for many tools. Windows package installs
  may expose `.cmd` shims, which Node cannot launch directly with `execFile()`. Resolve real
  executables or invoke scripts through a controlled, correctly quoted shell boundary. Do not
  apply `shell: true` to every command. [Node child-process documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows).
- **Lifecycle shutdown.** [The lifecycle service](../packages/cli/src/lib/lifecycle-service.ts)
  starts a detached Node worker and stops it with `SIGTERM`, then `SIGKILL`. On Windows, Node's
  emulated termination does not provide POSIX graceful-signal semantics. Validate terminal-close
  survival and use an acknowledged shutdown mechanism if final writes require cooperation.
  `process.kill(pid, 0)` alone also does not establish process identity.
  [Node signal documentation](https://nodejs.org/api/process.html#signal-events).

The TypeScript CLI and configuration model are reusable. Several files already contain Windows
branches or path normalization; this is not a claim that every layer must be rewritten. The gaps
are at specific operating-system boundaries and their callers.

## 5. Safety work that remains relevant on every platform

The current Herdr adapter catches lookup failures and can report a live session as absent. Its
`isAlive()` compares terminal IDs when available, but `destroy()` closes the recorded positional
workspace/pane ID without the same identity protection and swallows errors. A reused ID can target
a replacement workspace. The helper in [core/herdr.ts](../packages/core/src/herdr.ts) also turns
process-query errors into an empty process list.

These are existing defects, not Windows-specific discoveries. The ongoing same-ID work has proposed
conservative stop outcomes and stronger Herdr identity checks; those proposals must not be described
as already shipped at this source baseline. See [design r4](reviews/same_id_design_r4_opus.md) and
[review r4](reviews/same_id_design_review_r4_astra6.md).

Carry the intended guarantees into the Windows port:

- A failed probe means unknown; it must not authorize killing a session or deleting its worktree.
- Stop/send operations must identify the intended launch even after pane reuse or a server restart.
- Preserve persisted runtime and agent identity across config changes and restore.
- A delivered message needs evidence of consumption; retries must not silently duplicate work.
- Unknown ownership or stop completion keeps resources and gives an actionable refusal.

Any future Herdr implementation that talks directly to a Unix socket or relies on Unix peer/process
identity needs a Windows design too. A Windows implementation must establish equivalent guarantees;
it cannot inherit a Unix-only proof just because both transports expose a pane ID.

## 6. Proposed implementation approach

These are recommendations for a later implementation, not approved detailed designs.

**Launch and commands.** Introduce an executable/argv/environment/cwd representation where the
operation is a program invocation. Keep shell commands explicit for configured `postCreate` hooks
and other actual scripts. A Node-based pane launcher could replace the adapter's temporary Bash
script, but agent launch construction and prompt-file handling must be converted with it. Preserve
the existing Linux/tmux interface while consumers migrate. Record which Windows agent installation
formats are supported and how `.exe`, `.cmd`, and Node entrypoints are resolved.

Test each supported launch route with an argv-echo fixture through the actual AO → Herdr → launcher
chain. Compare the expected and received argument arrays, including empty arguments, embedded
quotes, trailing backslashes, multiline prompts, literal `%NAME%` and `!NAME!`, `&`, `|`, `$()`, and
backticks. Use harmless marker commands in the disposable fixture to detect unintended execution.
Passing spaces/non-ASCII tests alone does not qualify a shell bridge.

**Environment and metadata.** Centralize platform-aware PATH handling and executable resolution.
Resolve real Git/GitHub CLI commands without wrapper recursion. Move metadata update logic into a
portable helper, with shell-specific entrypoints only where required by an agent. Preserve branch/PR
tracking, allowed metadata fields, and the current ownership rules. Reconcile this with the planned
metadata-writer/inbox changes instead of creating another independent writer.

**Locks.** Define the delivery/record lock contract before selecting a Windows primitive: exclusive
ownership across processes and threads, release on process death, no accidental inheritance,
unambiguous owner identity, and safe handling of inaccessible owners. A Windows mutex or named-pipe
design needs concurrency and crash tests. Node supports Windows named-pipe IPC, but that alone does
not prove it can substitute for Linux socket-bind exclusivity. Never enable Windows by bypassing
the lock check. [Node IPC documentation](https://nodejs.org/api/net.html#ipc-support).

**Process identity.** Use a Windows process provider or qualified Herdr evidence to identify the
actual agent, its session arguments, and its creation identity. Audit the `foreground_processes`
JSON assumption against real Windows results; Herdr's Windows detection uses process trees rather
than Unix foreground groups. Preserve the distinction between an absent process and a failed check.
OpenCode also needs its specific session binding and age checks, not merely a matching executable
name. See [Herdr's platform behavior](https://herdr.dev/docs/windows-beta/).

**Agent introspection.** Bind activity and restore to the intended conversation using the measured
agent data/API contract. Validate `active`, `ready`, `idle`, `waiting_input`, `blocked`, and `exited`
with documented observation windows, as required by [CLAUDE.md](../CLAUDE.md). Missing logs during
a known active turn must not pass qualification as evidence of correct idle detection. Verify
restore against the recorded conversation identifier and a fact supplied only in that conversation;
neither a workspace file nor a replayed launch prompt may supply the fact. A fresh conversation is
the negative control. An agent that cannot meet these requirements remains unqualified for the
supported Windows profile.

**Lifecycle and workspace behavior.** Test detached workers, cooperative shutdown, interrupted
metadata writes, recovery, and owned-worktree deletion on Windows. Do not assume Unix signal,
rename/unlink, symlink, or process-group behavior. Desktop notification support can be a separate
increment with an explicit initial opt-out.

## 7. Staged work and acceptance criteria

| Stage                       | Work                                                                                                                                                                                               | Required evidence before advancing                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W0: native baseline         | Select Windows/tool versions and first agent; record executable/data locations and client/server elevation. Build and inspect failures with native Node; measure Herdr in an isolated environment. | Version record, raw responses, agent conversation identity, failure inventory, and confirmation that no WSL executable supplies a dependency.                                                             |
| W1: launch and environment  | Port argv/shell boundaries, PATH, executable discovery, prompt files, metadata hooks, and worktree inventory parsing for one agent.                                                                | Requested model/permissions and branch/PR hooks work; full-route argument round-trips and direct worktree enumeration/containment pass. Supervised disposable smoke test only.                            |
| W2: ownership and lifecycle | Implement qualified Windows locks, process identity, lifecycle stop/recovery, and Herdr error/stop behavior. Complete OpenCode-specific checks before enabling OpenCode.                           | Concurrent send/spawn/restore, crash release, access refusal, and replacement-session tests pass without lost records, duplicate admitted messages, or removal of another session's resources.            |
| W3: operator workflow       | Qualify start, spawn, send, output, status, attach, restore, kill, cleanup, and doctor; verify activity and conversation binding for the first agent.                                              | Direct inventory checks, all six activity states, and same-conversation restore controls pass on native Windows. Terminal reconnect preserves expected sessions; failures identify missing prerequisites. |
| W4: supported profile       | Add Windows CI/documentation; qualify remaining agents individually and collect release evidence.                                                                                                  | Linux regression and Windows checks pass; real native transcripts establish each supported profile/agent. Publish exact versions, shell requirements, limitations, and which evidence is mocked.          |

W0 and W1 use disposable repositories, a separate AO state root, and a separately isolated Herdr
server/profile. Verify isolation from the operator's existing server before creating a pane. W1
is supervised, with automatic cleanup and lifecycle reactions disabled until W2's ownership and
stop checks pass. Verify resources before manual teardown. If the selected tools cannot isolate
these probes, establish a disposable Windows environment before executing them.

Start with one agent to bound debugging, but do not silently declare all four retained agents
supported. Claude Code or Codex are candidates; select the first from W0 measurements and the
owner's priority. OpenCode has additional confirmed process and delivery dependencies. W0 measures
the first agent's data location and conversation identity as well as its executable. W1 must pass
the argv round-trip and direct worktree enumeration checks below. W3 must pass each activity and
same-conversation restore check; W4 repeats them for every additional supported agent.

The Windows validation matrix should include:

- Native PowerShell/Windows Terminal operation, with tmux and WSL unavailable to AO.
- A repository and user profile containing spaces/non-ASCII characters; drive-letter case,
  environment-key case, CRLF files, and a deliberately unsupported path form with a clear refusal.
- Direct `Workspace.list(projectId)` coverage: two known disposable worktrees must appear exactly
  once with the correct session IDs; a sibling project directory must be excluded. Compare the
  result with native Git's ordinary and NUL-delimited porcelain output, and retain a deterministic
  forward-slash-output/backslash-base regression case. Decode only formats actually specified or
  measured for the supported Git version; unsupported inputs must fail explicitly.
- Argument round-trips through every supported `.exe`, `.cmd`, and Node entrypoint route, using
  the fixture in section 6. The received argument array must match and no marker command may run.
- Parallel sessions, two AO processes addressing one session, and independent AO state roots.
- A process killed while holding each lock, an interrupted launch, a dead lifecycle worker, and
  restart recovery without stale ownership being treated as current.
- Herdr timeout, missing executable, malformed JSON, server restart, and reused pane/workspace IDs.
- An ordinary client denied access to an elevated disposable Herdr server under its default policy:
  report the access failure, preserve session metadata/worktrees, and issue no destructive fallback.
- Cold-agent and repeated message delivery, durable report-back, permission prompts, and agent exit.
- Native agent log/API evidence correlated with AO activity: a sustained turn, completion followed
  through the ready/idle thresholds, a controlled approval prompt, a controlled error, and process
  exit must produce the six required states within documented time bounds. Repeat with missing or
  unreadable logs during known activity to test the fallback/unknown behavior.
- Conversation continuity across terminal detach/reattach and, separately, stop/restore: resume
  the recorded agent conversation and recover its conversation-only fact. A fresh conversation
  must fail that control. Exercise a second conversation in the same workspace so that choosing
  the latest log cannot masquerade as restoring the intended one. Check persisted agent, runtime,
  model, and permission settings alongside the conversation identity.
- Worktree restore and cleanup while files are open; user changes and unrelated Herdr workspaces
  must survive refused or failed operations.
- Installation with and without optional Git Bash, according to the profile actually selected;
  bundled developer shells must not conceal undocumented prerequisites.

For each W3/W4 result, label the evidence as mocked, a deterministic local probe, or a real native
end-to-end run. Keep the exact Windows/tool versions, executable paths, client/server elevation,
command transcript, expected and observed outcomes, and agent/session identifiers in the release
evidence. Real agent/Herdr execution on the supported Windows profile is required even if Windows
CI passes. All new checks in this revision remain unrun.

Existing external fleet helpers and skills are a separate migration surface. The current
`~/agent-skills` watcher and some diagnostic recipes use Bash/tmux directly. A working native AO
binary would not make those scripts portable; audit them if the intended Windows workflow includes
automated fleet monitoring.

## 8. Decisions still needed when implementation starts

| Decision                    | Proposed starting point                                                                                                                   | Status                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Windows/CPU baseline        | Windows 11 x64 first; measure other targets separately                                                                                    | Proposal, not an owner constraint |
| Shell dependency            | Native AO core; decide explicitly whether Git Bash is an initial agent/hook prerequisite                                                  | Open                              |
| First agent                 | Choose Claude Code or Codex after W0; qualify OpenCode and Gemini separately                                                              | Open                              |
| Lock/process implementation | Prototype OS-backed ownership and Windows process identity before committing to a library or helper                                       | Open                              |
| Notifications               | Permit an explicit disabled notifier for the first supported profile                                                                      | Proposal                          |
| Version support             | Pin measured Node, Herdr, and agent releases; test the chosen Node baseline rather than assuming every `>=20` version behaves identically | Open                              |

The next concrete step is W0 on a native Windows machine. No such machine was exercised for this
analysis, so no execution estimate or native compatibility claim is justified yet. The present
task records the goal and findings; implementation remains outstanding.

## 9. Review r1 disposition

The [gpt-6.1-sol review](reviews/0011_native_windows_review_r1_sol61.md) assessed the original plan
whose SHA-256 was `3ea1e1f974695b9863e9733a8fd292cb4b68164b4f1d8f3e44080a8ee28584e1`.
Its verdict was ready for W0, with no critical issues. Source at review HEAD
`ad92d24ac83569fa7516f4d719db83d853a5fbb8` was unchanged from the baseline recorded above.
The following dispositions amend the plan; they do not close implementation defects or represent
a new reviewer verdict.

| Comment                                               | Disposition in r2                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Major 1: worktree inventory path handling             | Accepted. Section 4 identifies the raw/native path comparison; W1/W3 now require direct enumeration, containment, separator, and measured format checks. The review's quoted-path claim is narrowed: the cited Git rule describes lock reasons, and the checked 2.56.0 emitter writes paths directly.     |
| Major 2: agent introspection and conversation restore | Accepted. Sections 4, 6, and 7 require measured native data locations, all six activity states, explicit conversation binding, and a restore test with a fresh-conversation control. The suggested unsupported-state waiver is not adopted because CLAUDE.md requires all six states for retained agents. |
| Minor 3: metacharacter argument tests                 | Accepted. Sections 6 and 7 require an argv fixture through the complete launch route, with exact argument comparisons and checks for unintended commands.                                                                                                                                                 |
| Hidden assumptions: path identity and elevation       | Accepted. Measure Git, agent-data, and lock-identity boundaries separately; record privilege context and test access refusal without destructive fallback.                                                                                                                                                |
| Sequencing: W1 precedes W2 safeguards                 | Accepted. W0/W1 are isolated and disposable; W1 is supervised with automatic cleanup/reactions disabled until the relevant W2 checks pass.                                                                                                                                                                |
| Evidence: mocked versus native execution              | Accepted. W3/W4 distinguish evidence types and require a real native qualification transcript for each supported profile/agent.                                                                                                                                                                           |
