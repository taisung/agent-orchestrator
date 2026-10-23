# Herdr fit-1 code review r1 (sol), 2026-10-22

NOT-LAND-SAFE

Two major findings and one minor finding; no blocking findings. F-1/F-2/F-5/F-6 work in the exercised paths and the required build/test gates pass. The interim startup protection does not meet this review's all-entry-point, no-second-orchestrator objective. M-2 is an explicitly acknowledged pre-existing gap, not a newly introduced source regression. F-3/F-4/the full F-7/F-9 remain deferred; this review does not demand their other behavior.

## Findings

### M-1 — The CLI discards a held Herdr record when its pane becomes reachable again

**Code:** `packages/cli/src/commands/start.ts:1067` (new terminal/alive filter), `:922` (terminal selection), `packages/cli/__tests__/commands/start.test.ts:1342` (the new killed/alive pass-over oracle).

A Herdr no-server answer now reaches the lifecycle outage bound and persists `killed`/`killedReason=runtime` (T-1.7). When the original server/pane becomes reachable again, the next `ao start` lists that record as terminal, checks it, receives `isAlive=true`, and removes it from `checked` at line 1067. It is neither reused nor treated as a blocker. Isolated core startup then creates the next orchestrator next to the known-live one. The same filter discards a persisted working record whose agent activity is `exited`, even when its runtime answers alive. A terminal status is not evidence that a Herdr launch ended.

This pass-over rule existed before the change, but fit-1's newly classified 0.9.5 failures make the persisted-killed/reconnection route reachable on 0.9.5. The added unit test explicitly requires another spawn for killed/alive in both modes. That is an unsafe oracle for the stated startup objective. Project mode's existing fixed-ID core check may still reuse/refuse the old record, so the decisive duplicate-launch reproducer uses isolated mode.

**Measured reproducer:** in a scratch copy, extend the existing real-core CLI harness `start-herdr-interim.test.ts`. Keep its scratch config, metadata and real session manager. Replace only `runtime.create` with a spy returning `{id:"w4:p1",runtimeName:"herdr",data:{}}`, and have the workspace spy return a new scratch directory. Seed `app-orchestrator-1` with the existing valid Herdr handle. Run `program.parseAsync(["node","test","start"])` for these cases:

| Persisted status / activity | Old runtime answer | Result |
| --- | --- | --- |
| killed / runtime kill | true | startup success; create once; both `app-orchestrator-1` and `app-orchestrator-2` exist |
| working / agent activity exited | true | same |
| done | F1 pane_not_found | same |
| done | F1 no-server | same |

The last two cases show the related terminal-selection bypass: `isHerdrProbeTerminal` excludes stored terminal statuses other than killed. There is no CLI startup liveness check for them, although list enrichment may read the pane. The owner decision says a Herdr negative is not startup retirement authority. The code instead permits another isolated launch by omitting that record from startup selection.

The original eight CLI integration tests passed; all four added `expect(runtime.create).not.toHaveBeenCalled()` assertions failed. A rerun selecting only reviewer cases printed, for example:

```text
{"kind":"killed-alive","result":"startup success","creates":1,"records":["app-orchestrator-1","app-orchestrator-2"]}
```

No agent or Herdr process ran: runtime creation was a stand-in. The real `list()`/`runStartup`/core isolated allocation path ran. The implementer's report, read after these probes, acknowledges the killed/alive duplicate as open question 2; it does not provide a safety argument for it.

**Required:** do not discard positive liveness for a held Herdr record. Reuse only where the reuse policy permits it, otherwise refuse before isolated allocation. Select retained Herdr records independently of terminal status when enforcing the stated no-second-launch policy. Change the new killed/alive spawn oracle and add CLI-to-real-core tests for recovery after the F1 outage bound and for activity-exited records. If other terminal statuses are intentionally excluded until fit-2, state that as an accepted safety limitation rather than claiming no Herdr answer permits a second launch.

### M-2 — Direct isolated core startup never reaches the interim guard

**Code:** `packages/core/src/session-manager.ts:2621`; compare the project-only calls to `isOrchestratorRuntimeAlive` at `:2528` and `:2589`. Tests `core/src/__tests__/session-manager/orchestrator-herdr-start.test.ts:8` and runtime-herdr `fit-startup-interim.test.ts:8` expressly exclude isolated core mode.

A caller of `sm.spawnOrchestrator` in isolated mode reserves the next ID without reading or probing any old orchestrator. The two changed liveness classifiers cannot protect a path that calls neither of them. This also means a future caller bypassing the CLI has none of the temporary protection, and the CLI gaps in M-1 have no core backstop.

**Measured reproducer:** extend the existing core `orchestrator-herdr-start` harness with this sequence (all plugins are its existing mocks):

```ts
config.projects["my-app"]!.orchestratorWorkspaceMode = "isolated";
writeMetadata(sessionsDir, "app-orchestrator-1", {
  worktree: ctx.tmpDir, branch: "orchestrator/app-orchestrator-1",
  status: "killed", role: "orchestrator", project: "my-app",
  runtimeHandle: JSON.stringify(HERDR_HANDLE),
});
vi.mocked(mockRuntime.isAlive).mockResolvedValue(false);
vi.mocked(mockRuntime.create).mockResolvedValue({ ...HERDR_HANDLE, id: "w4:p1" });
const sm = createSessionManager({ config, registry: mockRegistry });
await sm.spawnOrchestrator({ projectId: "my-app" });
```

Repeat for stored working/killed and for `isAlive=false`/a rejection with `ERR_RUNTIME_NO_SERVER`. All four returned `app-orchestrator-2`, made **zero liveness probes**, and called runtime create once. Thus these cases do not even consume the configured negative/no-server answer. Four reviewer no-create assertions failed; the original four tests passed.

This code is unchanged from the base. The implementer's brief and report explicitly defer the isolated check to fit-2; it is not evidence that the implementer accidentally omitted a promised full G implementation. It is nevertheless a concrete missed path under this review's requested direct-core/both-mode safety objective. Likewise, a project-mode start only inspects its fixed ID and does not protect retained numbered orchestrators after a workspace-mode change.

**Required for that objective:** put the conservative old-Herdr-record refusal before isolated allocation as well as project-mode replacement, and cover it through the public core API. Until that lands, scope the landing guarantee to the actual guarded paths and explicitly retain this limitation. The complete admission/concurrency design remains fit-2 work; the probes above are sequential and require no concurrency claim.

### m-1 — The strict F1 boundary lacks an extra-trailing-blank-line test

**Code:** `packages/core/src/__tests__/herdr.test.ts:389`, runtime-herdr `src/__tests__/fit-reads.test.ts:97`; implementation at `packages/core/src/herdr.ts:95`.

Current product code correctly removes at most one trailing LF. The near-miss tests exercise two JSON lines and CR, but not a single JSON envelope followed by two LF characters. A partial implementation that strips all trailing LF characters passes every existing test.

**Measured mutation, scratch only:** replace exactly

```ts
const line = err.stderr.endsWith("\n") ? err.stderr.slice(0, -1) : err.stderr;
```

with

```ts
const line = err.stderr.replace(/\n+$/, "");
```

Rebuild core, then run the entire `pnpm -r --no-bail test` suite. Exit 0, with the same 3,781 passes, one expected failure and 29 skips as the unmodified tip. A direct built-JS check of `readHerdrCliFailure({code:1,signal:null,killed:false,stdout:"",stderr:JSON.stringify({id:"cli:pane:get",error:{code:"pane_not_found",message:"gone"}})+"\n\n"}, "cli:pane:get")` returned `null` on tip and `{code:"pane_not_found",message:"gone"}` on the mutant.

**Required:** add the two-trailing-LF near miss to the shared reader and both R4 callers, with no absence or no-server classification. This is a test coverage finding; it is not a failure of today's parser.

## Review scope and correct behavior

Read the specified r7 sections and design review, the implementer brief and note 1, R4 rows 8/9 and CLAUDE's process-check contract, the complete product diff and changed test/oracle hunks, and the list/lifecycle/restore/kill/start/attach callers. Inspected the named 0.9.5 fixtures and ID rollover data. Only after that independent reading and the startup probes did I read ao-73's retained report. No other fit-1 review, worktree or pane was inspected.

- **F-1:** numeric exit 1, no signal, no killed timeout, exactly empty stdout, one stderr line, exact object keys, command-specific ID, nonempty text code and text message are enforced. Rust EACCES text, protocol mismatch, wrong-command IDs and malformed envelopes do not become absence. No-server requires both the code and the measured CLI prefix. Core's process-info wrapper keeps `herdrCode` and the top-level no-server code; runtime `getPaneStrict` preserves the no-server code on its outer error and leaves other `herdrCode` values on the cause, as the tests expect. Legacy exit-0 forms stay unchanged.
- **F-2:** the grammar matches the measured alphabet, `w0`/`w11` and `p0`/`p13` rollovers. Core row 8 keeps empty ID → `[]` without a call. Nonempty invalid IDs reject; runtime liveness/send reject invalid or empty IDs, output returns empty, create rejects an invalid root pane before a pane call, attach rejects its invalid target. The real-list/lifecycle synthesized-session-name test passes with zero such Herdr calls.
- **F-6:** discovery resolves executable regular files through absolute PATH entries, keeps symlinks, normalizes absolute binPath, refuses relative paths with slashes, and validates the status socket/running types. New create calls and later runtime reads/sends/output use the pins. Both core helpers accept handles without breaking their string API. All four agent checks and OpenCode's second process-reader site pass handles; CLI attach spawns the pinned binary/environment. Missing/partial/malformed pins make zero calls (except the specifically preserved empty-ID row-8 result). Legacy handles retain ambient behavior. Pins are paths, not binary-content or server-run identities. No preflight API was added.
- **F-5:** destroy always refuses without I/O; stop remains unknown with zero closes. The changed destroy and same-ID N-1 oracles match that behavior. The pre-existing create-failure workspace close remains intentionally deferred to F-4; it uses the pins now. It is not mistaken here for a fixed cleanup path.
- **Lifecycle/other runtimes:** the real-plugin F1 closed-pane test kills after two polls with the positive control session kept. The F1 outage test keeps status before `NO_SERVER_BOUND_MS` and kills at the bound. Agent rejection remains unknown. The four agents' original empty-ID fallbacks are unchanged (Claude rejects; Codex/Gemini/OpenCode fall through to false). tmux source paths are untouched, the startup tmux controls pass, and private-server integration tests pass.
- **API:** `core/src/index.ts` has additions only; original exports remain. The helper parameter widening preserves string callers.
- **Documents/recovery:** R4 rows 8/9 accurately describe the new failure/pin forms. The startup text names the interim guard and manual recovery (stop the project lifecycle worker, close the pane, move the active record to `sessions/archive`, then remove an isolated worktree). It warns that hand edits bypass the lock/generation discipline. The document acknowledges the direct-isolated limitation; the broader CLAUDE startup sentence must be read with M-1/M-2. Existing runtime output comments still incorrectly claim recent-unwrapped is empty without an agent, whereas the saved fixture contains shell text; the lifecycle authority comment also predates R4. Those are unchanged documentation debt, not new functional findings.

## Changed oracles and baseline checks

Independently restored all changed product source files to `389b8dfe` in a scratch copy while retaining the tip's tests; built the base product before testing it. No test file failed to load. The selected 16 test files produced:

| Tests using base product | Passed | Failed |
| --- | ---: | ---: |
| core herdr + orchestrator-herdr-start | 62 | 46 |
| runtime-herdr, all seven files | 87 | 56 |
| CLI start + real-core startup + session | 124 | 20 |
| Gemini index | 84 | 1 |
| Codex index | 216 | 1 |
| Claude index | 138 | 1 |
| OpenCode index | 264 | 4 |
| Total | 975 | 129 |

Representative measured red reasons:

- F-1 row 8 T-1.2: `herdr pane process-info ... could not answer: the command failed`; row 9 T-1.1 rejects instead of resolving false. T-1.3 has no top-level `ERR_RUNTIME_NO_SERVER`, and T-1.4b has no classified `herdrCode`. T-1.6/T-1.7 leave status working instead of killed.
- F-2: core grammar exports do not exist on the base; runtime invalid-ID cases call Herdr instead of rejecting before I/O; T-2.3 observes calls for `app-3`. Some create tests turn red on discovery call counts before reaching their grammar oracle, so those baseline failures alone do not isolate root-pane validation.
- F-6: discovery/invocation helpers are absent; runtime create reads the queued status as the workspace answer; agent pin tests observe `herdr` instead of `/opt/herdr/bin/herdr`; attach ignores pins and accepts malformed pins; OpenCode's second reader receives a string rather than a handle.
- F-5: destroy resolves instead of rejecting and N-1 observes a close. Core's two guard tests replace the record instead of returning Error. CLI's mocked negative/no-server guard tests start an orchestrator instead of refusing. Real-core working/F1 tests can already pass on base because the old reader rejects unknown; their value is composition after F-1, not independent baseline redness.

The claim “each new test fails on base” is not literally true: near-miss and legacy regression controls pass there, deliberately. The implementer reports 121 new red tests plus 60 new controls and eight changed-oracle failures; the independently observed 129 failures agree with that distinction. I did not treat passing controls as proof of a new fix. The selected review runs total 1,104 tests; the report's 1,102 D1 total is a different selected-file count, not the full-suite gate.

Every migrated old oracle is accounted for:

- runtime-herdr create adds status discovery before workspace create, pane run and failure close: indices 0/1/2 become 1/2/3; mock responses add status first; fs mocks preserve real stat/access; a temporary executable stand-in makes binary discovery meaningful.
- Three destroy tests replace workspace/pane close or swallowed-error success with refusal/zero calls. The added pane-only/empty-handle test covers both forms. N-1 becomes a plain fixed test; its positive-close control becomes refusal. Stop's unknown control stays.
- CLI attach's old non-grammar stand-in `herdr-agent-2` becomes `w2:p1`, retaining the legacy ambient invocation oracle.
- OpenCode confirmLaunch/deliverMessage assertions now expect a handle, and the new pin test checks it. No tmux or process-check error oracle was weakened.
- The new killed/alive startup “control” is specifically challenged in M-1; it preserves an unsafe terminal rule rather than proving startup safety.

## Required gates on 9d51982b

All dependency/build output was kept in archived scratch copies. Tool/test environment:

```sh
env -i HOME=/tmp/aof1rs/home TMPDIR=/tmp/aof1rs/tmp \
  PATH=/tmp/aof1rs/bin CI=1 HUSKY=0 NPM_CONFIG_OFFLINE=true <command>
```

The scratch PATH contains links to Node 25.7.0, cached pnpm 9.15.4, raw system git/sh/bash and basic utilities; it has no npm/npx, agent binary or Herdr. Its gh stub succeeds only for `--version` and `auth status`; all other calls refuse without network. Its tmux shim unsets TMUX and always selects private `aof1rs-tests`. `/usr/bin` itself was never a PATH entry. Unit-test-local fake binaries are stand-ins.

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline --store-dir /home/taisung/.local/share/pnpm/store/v3` | exit 0; Husky explicitly skipped; expected pre-build ao entrypoint-link warning |
| `pnpm build` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; exactly five known warnings, no errors |
| `pnpm -r --no-bail test` | exit 0; 3,781 passed, one expected fail, 29 skipped |
| same-ID red run across all nine packages with same-ID files | exit 1 as expected; R2 15, R3 6, no R4 failures |
| `gitleaks git --log-opts=389b8dfe..9d51982b --redact` | exit 0; five commits scanned, no leaks |

Lint warnings are spawn.ts:333, activity-log.ts:91, plugin-registry.ts:232, and session-manager.ts:2402/2409. ESLint also emits its existing `.eslintignore` deprecation notice; that is not an additional lint finding.

Full-suite counts:

| Package | Result |
| --- | --- |
| core | 1,695 passed + one expected fail |
| runtime-herdr | 143 passed |
| CLI | 409 passed |
| Claude / Codex / Gemini / OpenCode | 319 / 308 / 89 / 365 passed |
| runtime-tmux / workspace-worktree | 69 / 85 passed |
| notifier-desktop / tracker-github | 26 / 42 passed |
| scm-github | 140 passed, five skipped |
| integration-tests | 91 passed, 24 skipped |

Core/runtime/CLI and all unit package totals match the implementer's report. Integration has **22 more passes and 22 fewer skips** than its 69/46: the private tmux shim enables runtime-tmux (9), CLI spawn/send/kill (5), session ls (3), and hash-based CLI/core (5) tests. No agent binary was enabled. All 115 integration tests remain accounted for.

The initial full attempt lacked grep/awk/jq links: core had 16 helper/wrapper failures (1,679 passes), Claude had 18 hook failures (301 passes), and Gemini had one helper failure (88 passes). Added only basic utility links and repeated the full gate successfully. These differences are reviewer PATH deficiencies, not product regressions. Runtime-herdr and CLI already matched 143/409 in that first attempt.

The red run used `SAME_ID_DEFECTS=red pnpm -r --no-bail --filter @aoagents/ao-core --filter @aoagents/ao-cli --filter '@aoagents/ao-plugin-agent-*' --filter @aoagents/ao-plugin-runtime-tmux --filter @aoagents/ao-plugin-runtime-herdr --filter @aoagents/ao-plugin-workspace-worktree exec vitest run same-id`. The normal suite's expected failure is core R3 F-5. Red failures are distributed as follows: core one R3; each of four agents one R2; OpenCode additionally one R3; runtime-tmux eleven R2; workspace-worktree four R3; runtime-herdr/CLI zero. The baseline comparison restores the original N-1 file, rather than running the new refusal control on old destroy. It measured R2 16 and R3 6 on the base, versus R2 15 and R3 6 on the tip. Comparing the complete failed-test names found exactly one removal (runtime-herdr N-1), and no additions.

## Formatting note and merge readiness

The final style commit touches exactly the specified five files. Base-to-tip numstats are Claude source +2/-1, Claude tests +35/-0, Codex source +3/-2, OpenCode source +5/-3, OpenCode tests +62/-2. Reading those diffs finds only fit-1 behavior, comments and tests.

`git diff -w --ignore-blank-lines e322e338 9d51982b` is not empty: Git does not match split/joined source lines, and the restoration also changes optional trailing commas. The remaining hunks restore Claude parseJsonlFileTail/extractSummary/import/regex-test formatting, Codex sessionFileMatchesCwd/cache/getActivityState formatting, OpenCode mock/restore/activity/restore-test formatting; OpenCode source only loses its final newline. An independent recursive TypeScript AST comparison (node kinds, literal/identifier text and ordered children, excluding source positions/comments and the SourceFile's full text) is equal for all five files. Thus this is behavior-neutral; “only whitespace and line breaks” should include optional trailing commas to be literally accurate. No new finding is assigned for that harmless qualification.

Read-only merge-tree results (no ref changed):

- `git merge-tree --write-tree main 9d51982b`: exit 0, tree `e655b1b9be772ed97ae5ec26cdd7ca699e5843b2`, no conflicts. Local main resolves to `9c1d117a6fb056f9ea223eacb31e8ca1f90c01b8`.
- `git merge-tree --write-tree feat/session-relaunch 9d51982b`: exit 1, tree `0a9271e6b9cc40b3090ab89af0b7e4b1aa6155fe`. Conflicting paths: `docs/DEVELOPMENT.md`, `packages/cli/__tests__/commands/start.test.ts`, `packages/cli/src/commands/start.ts`, `packages/core/src/session-manager.ts`. The three agent product files auto-merge. The local relaunch ref resolves to `7a20242ff6e70bd096fe191a215eca6fd2c8d5c5`.

## Isolation deviations and cleanup evidence

One intended scratch-baseline build was accidentally invoked from the review worktree, still with the sanitized HOME/PATH. It immediately failed at `tsc: not found` because the review worktree has no node_modules. No dist directory was created; `git diff --exit-code` passed. The actual baseline build subsequently passed in its scratch copy. No install or dependency copy occurred in the review worktree. All successful builds and every mutation/probe were in scratch. This failed invocation is disclosed rather than included as a successful gate.

The only intentional worktree writes are this review and the explicitly required `.agent_report.md`; the task file was supplied externally. The ignored `.ao/activity.jsonl` also advanced during the session (managed activity logging, not a review edit). No tracked product/doc file changed. No network, fetch/pull/rebase, branch mutation, commit, push, PR, ao command, inter-session send, real agent/Herdr process, or default-server tmux call was performed.

## Initial isolation evidence

`git log --oneline -1`: `9d51982b style: restore the base formatting of five agent files`.
Created `/tmp/aof1rs-marker` before review. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```


## Final cleanup measurements

The required real-state scan was:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aof1rs-marker \
  -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' \
  -not -name 'lifecycle-worker.log'
```

It printed exactly:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2237
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2234
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-orchestrator
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2224
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2230
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-78
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-73
```

All nine paths belong to external running projects, not this review's scratch state. The Nexus sessions directory and nex-2237/nex-2234/nex-orchestrator/nex-2224/nex-2230 are writes of the owner's active Nexus project; the agent-orchestrator sessions directory and ao-78/ao-73 belong to its orchestrator/lifecycle/session activity. No review command wrote any of them. The individual writer PIDs were not established: this attribution identifies the owning project and excludes review writes, rather than pretending the scan proves a particular external actor. No other session's contents or pane was read for attribution.

The final full-ISO `~/.ao/bin` listing matched the initial listing byte-for-byte. SHA-256 hashes of all four files (including `.ao-version`) also matched. A `/proc` scan for processes with scratch HOME or scratch cwd returned `REVIEW_PROCESSES []`, after all pnpm/Vitest cells finished. No process was signaled. The private-server check under the sanitized environment returned exit 1 with `no server running on /tmp/tmux-44402/aof1rs-tests`; no private server remains. No default server was inspected.

`/tmp/aof1rs` and `/tmp/aof1rs-marker` were removed with path-checked cleanup; final existence checks passed. `git diff --exit-code` passed, HEAD remained `9d51982b`, and only the supplied task, review and report were untracked. The initial shell removal command was rejected before execution; cleanup succeeded through the checked scratch path.
