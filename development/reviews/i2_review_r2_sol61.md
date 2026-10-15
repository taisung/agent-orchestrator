# I-2 round-2 review — sol61

NOT-LAND-SAFE

**1 blocker, 1 major, 0 new minor findings.** Round-2 range `3b2bb918..3c1d04c9`; whole increment `49369f18..3c1d04c9`. HEAD verified as `3c1d04c9`. Reviewed source, the three commits, and tests; ran independent live probes before reading the author report. No implementation change, commit, push, or PR.

The ordinary spawn race is repaired: 10/10 workers had their own stored OpenCode ID when `ao spawn` returned. The remaining ownership race is destructive: overlapping project-root orchestrator starts in two fleets can both bind the first pane's session, and a purge in the second fleet deletes the first fleet's conversation. The shared-ID guard also overlooks live holders with a terminal AO status, including a normal `merged` session.

## New findings

### B-1 — concurrent starts can still store, interrupt, and remove another fleet's session

**Files:** `packages/core/src/opencode-api.ts:412`–414 (returns immediately on the first single match); `packages/core/src/session-manager.ts:1685`–1707 (start discovery and persistence); `packages/core/src/session-manager.ts:1857`–1874 (purge and project-local holder guard).

The lower creation-time bound is not evidence that the caller's pane created the session. Two starts can both begin before either pane creates its session. If pane A creates first and pane B creates later, both searches see exactly one new exact-title session in the same directory and immediately store A's ID. The ambiguity branch never runs: B's session does not exist yet. The code comment at `opencode-api.ts:393` acknowledges concurrent fleets, but only handles both records already being visible in the same query.

**Independent real-2.0.29 reproduction:** two scratch configs, distinct config hashes and session stores, the same scratch git repository, `sessionPrefix: collision`, `orchestratorWorkspaceMode: project`, `orchestratorSessionStrategy: ignore`. Run both worktree-built `ao start` commands concurrently. The OpenCode front waits until both panes reach `api session.create`, then delays only B's real create by two seconds. Both use the unchanged real pane script; the front forwards API calls to the isolated real binary and suppresses the TUI.

| Event | Observed result |
| --- | --- |
| Both starts have launched their runtime | B metadata created `17:28:33.624Z`; A `17:28:33.723Z` |
| A's real create | `ses_ebf643694ffekWNiZTr77dGG50`, created `17:28:33.915Z` |
| Both starts return successfully | Both store `ses_ebf643694ffekWNiZTr77dGG50`; no warning |
| B's real create | `ses_ebf642ea3ffeJ32bYic4SwjZrQ`, created `17:28:35.950Z` |
| B: `ao session kill collision-orchestrator --purge-session` | Exit 0 in 1.098 s; interrupts and removes A's ID |
| After purge | A's ID is gone; B's actual ID still exists |

The logged calls were, in order:

```text
1792085359166  api session.interrupt --param sessionID=ses_ebf643694ffekWNiZTr77dGG50
1792085359415  api session.remove    --param sessionID=ses_ebf643694ffekWNiZTr77dGG50
```

A minimal reproducer for the timing control, inside an otherwise isolated `opencode` front, is:

```python
# Before forwarding api session.create to the real isolated binary:
ready[my_fleet].touch()
while not all(path.exists() for path in ready.values()):
    time.sleep(0.02)
if my_fleet == "B":
    time.sleep(2)
# exec the real OpenCode binary with unchanged arguments and isolated XDG_*.
```

Start `node <review-worktree>/packages/cli/dist/index.js start` once for each config, using the private tmux shim. Read the two metadata records, wait for B's create, then purge B. No model turn is needed. The two-second skew is a deterministic scheduling control; it does not change the API response or AO's launch command.

**Required correction:** correlate a mapping with this particular pane's create, or serialize colliding starts across config boundaries before recording their launch times. Seeing one qualifying record at one instant is insufficient. Waiting for one more quiet poll also cannot prove ownership when the second create is slower. Add an overlapping-start regression that introduces the second session only after the first search has found one. Original R1 B-2 is only partly fixed.

### M-1 — the shared-ID guard treats terminal metadata as proof that a holder is dead

**Files:** `packages/core/src/session-manager.ts:661` (excludes all terminal statuses), used by purge at `:1859` and archived cleanup at `:2016`; `packages/core/src/__tests__/session-manager/lifecycle.test.ts:350` (the terminal-holder test has no real liveness check).

`findLiveOpenCodeSessionHolder` skips a record with status `merged`, `done`, `killed`, `terminated`, or `cleanup`, without checking its runtime or agent. An active metadata record with one of those statuses can still have a live agent. The existing enrichment code explicitly describes that supported state at `session-manager.ts:965`–967: agents commonly keep working in tmux after their PR is merged. The separately reported first-poll race can also leave a running agent marked `killed`.

**Purge reproduction:** in the scratch fleet, let `rv-8` and `rv-9` store the same ID, `ses_ebf649dadffeBDZxhpfqHrw9PH`. Set `rv-8` to `merged`, leaving its runtime and front process alive. `sm.get("rv-8")` reported `status: merged`, `activity: ready`, a valid tmux runtime, and that stored agent session ID. Purging `rv-9` returned 0 in 0.598 s, with no kept-session warning. The ID then returned HTTP 404; `tmux has-session` through the private shim still returned 0 for `rv-8`.

**Archived-remap/cleanup reproduction:** `rv-4` was archived, while live `rv-5` stored its ID `ses_ebf64b684ffe0WTuZAOZ3L0f2x`. With the holder `working`, purge correctly kept the ID, archived remap succeeded, and cleanup kept it. Change only `rv-5`'s status to `merged`, keeping the runtime alive. Then:

```text
ao session remap rv-4 --force   # exit 0; stores the shared ID in the archive
ao session cleanup             # exit 0; prints "Cleaned: rv-4"
```

The shared ID now returns `SessionNotFoundError`/HTTP 404, although `rv-5`'s pane remains alive (`has-session` exit 0). Thus archived remap can bind an ID already used by another live AO session, and cleanup can remove it. The clearing of `opencodeCleanedAt` makes the removal eligible; the defective guard fails to protect it.

**Required correction:** protect an active holder whose runtime/agent is alive regardless of lifecycle status, and retain the ID when liveness cannot be established safely. Test a live `merged` holder in both purge and archived cleanup. This is an incomplete repair of R1 m-4, not a reason to reinstate title-based reuse.

## Status of every round-1 finding

| R1 Sonnet ID | Status | Evidence on this tree |
| --- | --- | --- |
| B-1: pane create loses the one-shot discovery race | Fixed for ordinary starts | 10/10 real worker spawns mapped at return; project-root orchestrator mapped; all three strategies exercised; 3/3 batch workers mapped. Independent concurrent ownership defect is B-1 above. |
| B-2: global title search binds another fleet | Partly fixed | Wrong-directory and pre-start same-directory decoys are excluded; symlinked workspace works; remap refuses ambiguity. Overlapping starts with the same directory still misbind and delete another fleet's ID. |
| M-1: missing mapping masks refused version | Fixed | No stored ID + fake `--version` `1.18.35`: version error, exit 1, old pane survives. |
| M-2: safety properties unpinned by tests | Fixed for the listed gaps | Six behavior-changing mutants killed; A independently confirmed equivalent. Real-child hang tests, real timeout shape, top-level interrupt shape, order assertions, and unconditional orchestrator-delete assertions are present. New concurrent-start and live-terminal-holder gaps remain as above. |
| m-1: 404 restore silently resumes gone ID | Fixed | Removed the stored ID in the isolated store; restore refuses with `the stored OpenCode session ... is gone`; old pane survives. |
| m-2: exact title beyond page 1 is missed | Fixed | Exact title found behind 60 newer substring matches on real 2.0.29; two API pages; page loop has a 20-page cap and a search-wide deadline. |
| m-3: dead parameters and stale spec | Fixed | Dead flag/voids removed; workflow spec updated. Orchestrator delete uses stored IDs only; unmapped old sessions remain, consistent with Q7. |
| m-4: shared ID can be purged | Partly fixed | Working active holder protects purge and archived cleanup; live terminal-status holder is unprotected (M-1 above). |
| m-5: failed purge silent / 41 s hang | Fixed | One warning with ID and cleanup hint; one bounded interrupt and one remove take 20.288 s; cleanup later removes the ID. |
| m-6: file scope/process/test isolation | Addressed for this review and current allowed scope | `session-manager.test.ts` is allowed by the R2 brief. All my tests use fake HOME/no inherited AO variables. The author's historical global-store/state-root writes remain recorded in its report; they cannot be undone by this source change. |

V4 Flash's R1 M-1 is the same version-order finding and is fixed. Its m-1 (ignored title-discovery flag/delete behavior) is addressed by removing the flag and documenting ID-only delete. Its m-2 (wrong interrupt mock shape) is fixed and killed by mutant E.

## Independent live checks

Environment: Node `v25.7.0`, pnpm `9.15.4`, OpenCode `2.0.29`. All state, fake HOME, configs, repository, worktrees, and four XDG directories lived under `/tmp/ao24-i2-jfdyinqi`. Real isolated service: port `49724`, PID `2419759`, checked with `server.info` before the first write; global read-only `server.info` reported PID `4171365`. No credentials copied, no `auth` or `service.json` read, no model turn. The front passed version/API calls to real OpenCode and replaced TUI execution with an idle process. `gh` was a local fixture, including read-only fixture issue JSON for batch checks; no real GitHub command ran.

Every tmux call, including indirect calls from AO/tests, used a PATH shim that unsets `TMUX` and execs `/usr/bin/tmux -L ao24review -f /dev/null`. The private server used a clean bash command. No default-server tmux call ran.

### Spawn, strategies, ownership, and remap

- Ten initial workers: **10/10 mapped at return**, all own exact-title/workspace IDs. Total spawn times 1.517–1.690 s, mean 1.593 s. The first list ran before the pane's create; the next query started 654–687 ms later (mean 670 ms), consistent with the 500 ms pause plus API/process time. The added successful second lookup costs approximately 0.65–0.7 s relative to returning after the first empty lookup; this is a timing/log estimate, not a baseline-build A/B measurement.
- Ordinary `ao start`: mapped its own `ses_ebf64890bffem4d0O3kBA42osK`, exit 0 in 2.040 s.
- Fresh worker spawns and project-root orchestrator starts mapped under `reuse`, `delete`, and `ignore`. A clean batch of issues 811/812/813 produced **3/3 mapped workers** in 5.061 s. An earlier batch reused fixture branch names already checked out by other probes and correctly failed those checkouts; the fresh-issue rerun is the batch evidence.
- Wrong-directory `AO:rv-2` decoy `ses_ebf64c692ffejp1lZoWTGEJKA2` survived. The worker mapped its own `ses_ebf64c2fdffeWmqdrwf3wnoLlC`; its purge logged only interrupt, then remove, of that own ID, 189 ms apart.
- Same-directory pre-start `AO:older-orchestrator` decoy `ses_ebf637782ffeMLo8kmRVNjOoID` did not bind. The new start mapped `ses_ebf63740effe7Gfh0F2mWO7G4b`.
- Force-remap with those two same-directory candidates refused and printed both IDs, the directory, and creation times `17:29:22.832Z`/`17:29:23.714Z`.
- Replacing `rv-3`'s workspace metadata with a symlink to its actual worktree still remapped to its own ID.
- Exact title `AO:page-1`, oldest of **61** same-directory substring matches, was found as `ses_ebf636fa8ffeqlba4bexJGpamV` using the real API and built helper.

### Restore and bounded operations

| Operation | Exit / elapsed | Result |
| --- | --- | --- |
| Restore, old `1.18.35`, no stored ID | 1 / 0.348 s | `ao needs OpenCode 2.0.29 or later (found 1.18.35)`; pane survives |
| Restore, stored ID removed | 1 / 0.878 s | `Cannot restore: the stored OpenCode session ... is gone (session.get answered 404)`; pane survives |
| Fresh spawn, all API calls hang | 0 / 15.815 s | Two bounded list calls; no mapping; one line names `ao session remap hangfull-1` |
| Fresh orchestrator start, all API calls hang | 0 / 15.806 s | Same bounded wait; one line names `ao session remap hangfull-orchestrator` |
| Restore with stored ID, all API calls hang | 1 / 30.427 s | Three bounded gets: activity, info, restore check; old runtime retained |
| Purge with stored ID, all API calls hang | 0 / 20.288 s | One interrupt, one remove; one warning with ID and cleanup hint |
| Cleanup after service responds again | 0 / 0.836 s | Prints `Cleaned: rv-3`; removes the previously failed purge ID |

The 15 s window bounds discovery, not reuse checks or the entire CLI startup. Stored reuse candidates can each add a bounded 10 s lookup before discovery. No fresh title fallback is introduced on reuse/get/list/send/restore/purge. The normal and timeout tests agree with the helper caller-policy table. The lifecycle still performs three per-session API reads per tick; no I-4 optimization is included. I did not remeasure the separate `session ls` timing issue.

### Helper and command strings

`execFile("opencode", args, ...)` uses an argument array with `--param`, a finite timeout and captured pipes. A real child stderr marker was captured in the thrown error; HTTP 404 becomes null; other exec/parse failures retain their cause. Tests reject cut JSON and empty exit-0 results except remove's real 204 empty body. The top-level interrupt result is handled. Reuse checks only stored IDs and skips errors/404; no new title fallback was found.

I imported the `c949f902` plugin source after transpiling it in a scratch copy and compared it with this worktree's build: **identical=10, different=0** for eight launch/resume cases (including quotes, model, subagent, prompts, system prompt/file, mapped ID) and two successful stored-ID restore cases. Restore refusal behavior intentionally changes; successful 2.x command strings do not.

## Mutants and required checks

Mutants ran against an archived scratch copy of HEAD, never by editing tracked worktree files. Each used the same sanitized test runner as the main checks.

| Mutant | Result | Killing test |
| --- | --- | --- |
| A: add `stdio: "inherit"` to execFile | Equivalent; 23 helper tests pass | Independent Node process: child stderr `CAPTURE-MARKER` appears in callback stderr; parent's stderr is empty even with this option. Node 25.7.0 drops it. |
| E: top-level interrupt true becomes false | Killed (1) | `reads the top-level shape that 2.0.29 answers` |
| G: drop list limit | Killed (3) | `asks for a page size that keeps one answer far below the 262144-byte pipe size` (plus paging/cap tests) |
| I: remove before interrupt | Killed (2) | `purges mapped OpenCode session when requested` (plus bounded purge) |
| K: purge without ID searches by title | Killed (1) | `does not search by title on purge when no ID is stored (Q7)` |
| L: failed get still reuses candidate | Killed (1) | `does not reuse a stored ID that session.get cannot check (M-2 L)` |
| M: gone orchestrator ID replaced by title match | Killed (1) | `does not replace a gone stored orchestrator ID with a title match (M-2 M)` |

Tests assert the returned ownership relationship, operation order/absence, real timeout termination, and bounded page sizing rather than copying the default timeout literal. They do not cover the staggered concurrent-start race or the live-terminal-holder case.

All `pnpm test` invocations used a fake HOME and an allowlisted environment containing **no inherited `AO_*` or credential variables**, plus the private tmux shim. This includes root tests, both integration runs, and mutation tests.

```text
pnpm install                                      exit 0
pnpm build                                        exit 0
pnpm --filter @aoagents/ao-core test                Test Files 32 passed (32); Tests 682 passed (682)
pnpm --filter @aoagents/ao-core typecheck           exit 0
pnpm --filter @aoagents/ao-plugin-agent-opencode test
                                                   Test Files 1 passed (1); Tests 160 passed (160)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck
                                                   exit 0
integration, opencode present                      Test Files 10 passed | 3 skipped (13)
                                                   Tests 95 passed | 24 skipped (119)
integration, opencode hidden                       Test Files 10 passed | 3 skipped (13)
                                                   Tests 95 passed | 24 skipped (119)
pnpm lint                                         0 errors, 5 warnings
pnpm typecheck                                    exit 0
pnpm test                                         exit 0; 1921 passed, 29 skipped
```

Full-suite package counts: core 682; Gemini 56; Claude Code 154; Codex 215; desktop 26; Herdr 36; GitHub SCM 140 + 5 skipped; GitHub tracker 42; worktree 46; tmux 26; OpenCode 160; integration 95 + 24 skipped; CLI 243. Integration OpenCode live tests skip without credentials. Lint warnings are the existing non-null assertions in CLI spawn/core activity-log/plugin-registry and two existing console calls now at session-manager lines 1335/1342. Install's missing CLI-bin link warning occurred before the subsequent successful build.

## Scope, author observations, and correct behavior

- All 12 round-2 changed files are within the brief's allowed list. Core index changes are exports only. All three commits have a conventional type and a WHY body, no coauthor trailer, emoji, or issue number. `git branch -r --contains 3c1d04c9` prints nothing. **`docs:` without a scope has no severity:** the project permits it and the scope is optional in its examples.
- Author observation, first-poll `spawning` → `killed` race: **major, pre-existing; record separately**, because a running session can acquire a terminal status. It also exposes the new guard's status assumption. I did not change lifecycle code.
- Author observation, `/usr/local/bin` before caller PATH: **minor, pre-existing**. Verified in `buildAgentPath`; it can select a different pane binary than the caller's preferred one when a conflicting installation exists. No conflicting OpenCode binary was added to the host.
- Correct repairs include the ordinary spawn wait, filtering of wrong-directory/older records, symlink resolution, refusal to pick among visible duplicates, bounded pagination, version-first restore refusal before runtime destruction, 404 restore refusal, ID-only reuse/purge, top-level interrupt parsing, and timeout retry termination with a visible cleanup hint.

## Cleanup

Stopped the isolated OpenCode service PID 2419759 and private tmux server PID 2430844 by exact PID. Stopped the front processes logged by this run and the lifecycle workers identified by the scratch fleet PID files. All 22 private pane PIDs and all signaled PIDs were checked: no running survivor. Removed the scratch tree `/tmp/ao24-i2-jfdyinqi`, including stores, repositories, worktrees, mutation copies, logs, and fake homes, after recording this evidence. Only this review and the requested existing watcher report are written in the worktree; no tracked file is changed.
