# I-2 round-3 review — Opus 5.5 (ao-26)

**Verdict: NOT-LAND-SAFE**

1 blocker, 1 major, 4 minor. Round-3 range `3c1d04c9..0080cf87`; whole increment `49369f18..0080cf87`.
HEAD checked: `git log --oneline -1` shows `0080cf87`. Reviewer: Claude Opus 5.5, cross-family to the
astra author (Codex `gpt-6-astra`, ao-25). I wrote no code and made no commit. I read the author report
only after items 1 to 4 of the brief, section 2.

The launch lock closes the round-2 ownership hole. In the sol-6-1 overlapping-start reproduction each
fleet now stores its own pane's ID, and a purge in fleet B touches only B's ID. The liveness guard keeps
an ID that a live `merged` holder uses, in purge, in archived remap and in cleanup. Both round-2 findings
are fixed for the normal case.

The new pending marker is the problem. It has no recovery from evidence, and the recovery text sends the
operator into a second, silent trap. The worst case is B-1 below: one transient `runtime.create` failure
blocks every later OpenCode worker spawn of the project, because the failed spawn frees its session
number and the next spawn takes the same number, title and worktree. I reproduced it in 0.5 s per
attempt. The same marker blocks every fresh orchestrator start of a project after one discovery failure,
also after its pane is gone or after its session was created and remapped (M-1). This code runs for every
OpenCode fleet on this host after a rebuild, so I do not accept the trade-off for a landing. The smallest
safe change is in "Judgment of the pending-marker trade-off".

## New findings

### B-1 — one failed launch blocks every later OpenCode worker spawn of the project

**Files:** `packages/core/src/session-manager.ts:1274-1276` (the marker is written before
`runtime.create`); `:1296` and `:1309` (on a `runtime.create` failure the lock is released with the
marker kept, and `deleteMetadata(..., false)` frees the reserved session number); `:1391` and `:1397`
(the post-launch failure path does the same); `:837-847` with `:246-257` (the next number is `max + 1`
over active and archived records, so the freed number comes back); `packages/core/src/opencode-launch-lock.ts:108`
(an ownerless key with `pending.json` refuses at once).

The worker title is `AO:<prefix>-<n>` and the workspace is `~/.worktrees/<project>/<prefix>-<n>`. Both
are a function of the number. When a spawn fails after `launchLock.start()`, the marker stays for that
number's key, and the failed spawn deletes its reserved record. The next `ao spawn` reserves the same
number, creates the same worktree path, computes the same key, and is refused. It deletes its reserved
record again, so every later OpenCode worker spawn of the project gets the same number and the same
refusal. No pane was ever launched in the case below, so the marker protects nothing. Numbers do not come
back after an archive (archived records count as used); they come back after a failed spawn.

**Reproduction (worktree build, isolated store, private tmux):** a `tmux` shim fails one `new-session`
call, as tmux does when its server is unreachable. A Herdr project whose `create` throws because its
server is stopped would take the same path (I did not run Herdr).

| Step | Result |
| --- | --- |
| `ao spawn` (r3wk-1) | exit 0, 1.633 s, own ID stored |
| `ao spawn` with one injected `new-session` failure | exit 1, 0.472 s; marker for `AO:r3wk-2` in `/tmp/ao26r3/home/.worktrees/r3wk/r3wk-2`; no pane, no `session.create` |
| `ao spawn` | exit 1, 0.498 s: `Cannot safely launch AO:r3wk-2 in .../r3wk-2: an earlier OpenCode launch is unresolved (...pending.json)` |
| `ao spawn` | exit 1, 0.427 s: the same refusal for `AO:r3wk-2` |
| sessions directory | only `r3wk-1` |

Reproducer: make `runtime.create` throw once after `launchLock.start()` (tmux shim or a stopped Herdr
server), then run `ao spawn` twice in the same project. A spawn with another agent in between ends the
block, because it consumes the number; with OpenCode only, the block stays until someone removes the
directory by hand.

**Required correction:** a spawn that leaves a marker must not free its number (archive the reserved
record, or keep it as `killed`), so the next spawn takes a new title and workspace. Better still, do not
leave a marker when `runtime.create` threw before any pane could run the launch command (see the
pending-marker judgment). Add a session-manager test: `runtime.create` rejects once, then a second spawn
of the same project succeeds or at least gets a new number.

### M-1 — the pending marker has no recovery from evidence, and the documented recovery leaves a 30 s trap

**Files:** `packages/core/src/opencode-launch-lock.ts:84-87` (the refusal names `pending.json` and says
"before clearing this marker"); `:107-108`; `:125-131` (an ownerless lock directory without
`pending.json` is never reclaimed: every caller waits 30 s and fails); `:155-160`;
`packages/core/src/opencode-api.ts:405-424` (the wait loop ends without a last search after a stalled
event loop); `packages/core/src/session-manager.ts:188`; `docs/opencode-workflows-spec.md:55`.

The orchestrator title `AO:<prefix>-orchestrator` and the project path are the same at every restart. So
after one discovery failure, every later fresh orchestrator start of that project is refused until an
operator removes a hash-named directory under `/tmp`. Fresh means: the old runtime is dead, or the
strategy is `ignore` or `delete` after `ao stop`. Measured on the worktree build:

| Case | What happened | Next fresh start |
| --- | --- | --- |
| a. All `opencode api` calls hang during one start | start exit 0 in 15.688 s, no mapping, marker; `ao stop` then destroyed the pane and its hanging create | exit 1 in 0.394 s, refused; the pane is gone, so no create can come |
| b. The pane's `session.create` fails (OpenCode fails at start) | start exit 0 in 15.732 s; pane shows `failed to create the OpenCode session AO:r3cf-orchestrator` and a shell | after `ao stop`: exit 1 in 0.417 s, refused; the create had failed 37 s earlier |
| c. SIGINT to `ao start` during its discovery wait (the CLI has no SIGINT handler, so `finally` does not run) | the pane created `ses_ebefcdbf0ffeWs5d1RMXUs32WQ` 4.6 s after the launch time; `ao session remap` stored it in 0.366 s | after `ao stop` with `ignore`: exit 1 in 0.374 s, refused, although the launch is settled and mapped |
| d. The launcher is stopped (SIGSTOP, as in a suspend or a stalled host) while it holds the lock | its pane created its session 4.2 s later; after SIGCONT the wait returned "not found" 14 ms later, with no last search, although the session had existed for about 26 s | marker kept; a fresh start would be refused |
| e. The operator does what the error says: removes the marker file named in it | the directory stays, empty and without an owner | exit 1 in 30.361 s and again in 30.387 s: `Timed out waiting for the OpenCode launch lock ... no pane was launched`. This text suggests that another start holds the lock. Only `rmdir` of the directory recovered (next start exit 0, 1.581 s, mapped) |
| f. A start waits for another start that holds the lock | the waiting start shows only `Creating orchestrator session` | 13.718 s, then the case-b refusal; with a frozen holder 30.326 s, then the timeout. No line names the lock, the holder or the wait |

Workers that fail discovery block only their own key, because their number stays used (case b with a
worker: the next spawn took `r3cf-2` and mapped in 1.550 s). Workers are blocked project-wide only
through B-1.

The spec (line 55) says to remove "the marker directory named in the error", but the error names the
file and says "clearing this marker". The error does not give a command. The warning at
`session-manager.ts:188` says further launches "are blocked until this launch is settled" but does not
say how to settle it.

## Judgment of the pending-marker trade-off (brief item 2)

The author's premise is correct: a discovery timeout alone does not prove that the earlier pane will not
create later, and the marker does stop the late-create misbind (the author's 17 s delayed-create run and
my case c both show a later colliding start refused). But the design treats every marker as unresolvable,
also when the evidence that it is resolved is one API call away, and the cost lands on the two most
common recovery paths: restarting an orchestrator, and retrying a spawn after a runtime error. With the
measured triggers (a hanging or restarting service, an OpenCode start failure, Ctrl-C, a stalled host, a
transient runtime error) and a recovery that needs manual `/tmp` work with misleading text, **the current
trade-off is not acceptable for a landing.**

Smallest safe change, in order of value (each keeps the round-3 safety for launchers that use the
protocol):

1. **Resolve a marker by evidence of the earlier create.** On a collision, read `startedAt` from
   `pending.json` and run one bounded search for sessions with the same exact title and directory and
   `time.created >= startedAt`. A hit proves that the earlier pane's single create has finished: the pane
   script makes one `session.create` and no retry, and since `startedAt` no other protocol launcher could
   create for this key (the lock, then the marker, refused them). Remove the marker and continue. The new
   launch time is later than those sessions, so they cannot be bound. This fixes cases c, d and the
   author's late-create case with no time-based guess.
2. **Resolve a marker by evidence that no create can come.** After `runtime.create`, write the runtime
   handle into `pending.json`, or write "no pane" when `runtime.create` threw. Remove the marker when
   `runtime.create` threw, or when the recorded pane is proven gone by an explicit negative on its own
   server and the marker is older than the discovery window plus one API bound. The second condition
   bounds a request that the dead pane had already sent. Keep Herdr as "unknown". With the B-1 number fix,
   this removes the project-wide worker block and fixes cases a and b.
3. **Make the manual path safe.** Name the directory and the exact command (`rm -r <dir>`) in the
   refusal, the warning and the spec. Reclaim an ownerless directory without `pending.json` when its mtime
   is older than a few seconds: no live participant leaves one for more than microseconds. Print one line
   when a start begins to wait for the lock.
4. **Do one last search** in `waitForOpenCodeSession` when the window ended during a stall (case d).

Items 1 and 3 are local to `opencode-launch-lock.ts` and the two call sites. I-3 (create in Node) removes
the need for the marker, as the author says, but I-2 lands first.

### m-1 — a negative from another tmux server counts as proof that a live holder is dead

**File:** `packages/core/src/session-manager.ts:695-718`.

The extra `has-session -t =<id>` query has no `-L` or `-S`. It goes to the ambient server: the server
that `TMUX`, `TMUX_TMPDIR` and the uid select for the `ao` process, the same one that `runtime.isAlive`
uses. The persisted runtime handle stores no server identity (`runtime-tmux/src/index.ts:93-100`), so the
query cannot go to "the session's own persisted server". In every live run of this review it went to my
private server (the shim log shows `L=ao26r3` for each call). From a shell that points at another server,
the guard reads `no server running on ...` or `can't find session:` as proof of death and removes a live
holder's conversation. Round 2 kept the ID of a non-terminal holder without a check, so this is a
regression for that holder.

| Build | `ao session kill r3m-10 --purge-session` with the shim pointed at `-L ao26r3-none` | Holder |
| --- | --- | --- |
| `0080cf87` | exit 0, 0.628 s; `session.interrupt`, then `session.remove` of `ses_ebef9e7d2ffeRji7SspCRWZKz2` | `r3m-9`, status `spawning`, pane alive on the real server; its ID is now 404 |
| `3c1d04c9` | exit 0, 0.227 s; `ao: kept OpenCode session ses_ebef9baf9ffe... of r3m-12: live session r3m-11 uses it.` | `r3m-11`, kept |

Reproducer: two workers share one stored ID; run the purge of one of them with `TMUX` set to, or
`TMUX_TMPDIR` pointed at, a socket where no AO session lives. **Fix for I-2:** treat `no server running`
and `error connecting` as unknown. Later, persist `#{socket_path}` in the tmux handle and pass `-S` (that
is a `runtime-tmux` change, outside this increment's files).

### m-2 — a Herdr OpenCode session with a dead runtime is never cleaned

**File:** `packages/core/src/session-manager.ts:2064-2080`, with `:700`.

The new cleanup branch runs `openCodeHolderReason` on the dead session itself, for every OpenCode
session, also when it stores no OpenCode ID. For Herdr the guard always answers "unknown" after a negative
`isAlive`, so `ao session cleanup` never archives a dead Herdr OpenCode session. It prints `kept <id>:
session <id> may still use it` on every run, a wrong reason when no ID is stored. A scratch test (the
existing "kills sessions with dead runtimes" test with `agent: opencode`, a Herdr handle and no stored ID,
cleanup run twice) gives `killed=[]` twice with two "kept" lines on `0080cf87`, and `killed=["app-1"]` on
`3c1d04c9`. **Fix:** run this check only when the session stores an ID that another active or archived
record also stores. The cost of "unknown" for a Herdr holder of a shared ID (the ID is kept until the
holder is killed by hand) is acceptable.

### m-3 — the lock root in `/tmp` is not checked for owner, mode or symlink

**File:** `packages/core/src/opencode-launch-lock.ts:17` and `:75`.

The root has a predictable name in world-writable `/tmp`, and `mkdirSync(root, { recursive: true, mode:
0o700 })` accepts any existing entry. With the injected root, a mode-0777 directory and a symlink were
both accepted without a complaint. This host has other login accounts (four other home directories under
`/home`). Another user can create
`/tmp/ao-opencode-launch-44402` first. A symlink there makes every OpenCode launch fail with `EACCES`
(`fs.protected_symlinks = 1`), and a 0777 directory of that user lets them rename lock directories (which
defeats the lock) or plant `pending.json` (which blocks a key). The files inside are created with `wx`,
so a symlinked file cannot redirect a write. **Fix:** `lstat` the root and require a real directory owned
by `process.getuid()` with no group or other bits, else refuse with a message. Prefer
`$XDG_RUNTIME_DIR` when it is set. Note: the systemd rule `D /tmp 1777 root root 30d` on this host removes
markers at boot and after 30 days. That is harmless, because panes do not survive a boot.

### m-4 — test gaps for the new failure paths

The six round-1 mutants stay killed. The new tests kill four of my eight new mutants (X1, X2, G1, G3).
G4 is near-equivalent. Three real gaps survive the whole core suite:

| Mutant | Result | What is not tested |
| --- | --- | --- |
| G2: Herdr negative goes on to `agent.isProcessRunning` | survives (250 of 250 in the session-manager set; core suite fails only in a file that cannot load in the scratch copy) | the Herdr "unknown" branch |
| G5: no tmux stderr ever counts as a negative | survives | a dead tmux holder with `can't find session` lets the purge proceed (I showed it live) |
| G6: cleanup never kills a dead OpenCode session | survives | the dead-runtime cleanup branch for OpenCode (I showed it live for tmux) |

There is also no session-manager test for a `runtime.create` failure under the lock (B-1), for an
ownerless lock directory (M-1 e), or for a marker from a pane that never created. The worker variant of
the cross-fleet test does not catch mutant X1 (launch time recorded before the lock); only the
orchestrator variant does.

## Status of round-2 B-1 and M-1

| R2 ID | Status | Evidence on `0080cf87` |
| --- | --- | --- |
| B-1: concurrent starts store and purge another fleet's session | **Fixed** for launchers that use the protocol | See the table below. The lock is taken before the launch time is recorded and is held through discovery, the metadata write and `complete()`. Limits: an older AO build or a manual create bypasses it (documented); the pending marker cost is B-1 and M-1 above |
| M-1: terminal status treated as death | **Fixed for tmux and mock runtimes; partly fixed overall** | Live `merged` holder kept in purge and in archived remap plus cleanup; dead holder does not block; a hanging check keeps the ID. Open: m-1 (another tmux server), m-2 (Herdr cleanup) |

**B-1, sol-6-1's reproduction** (two configs, distinct state roots, one scratch repository,
`orchestratorWorkspaceMode: project`, `orchestratorSessionStrategy: ignore`, concurrent `ao start`). The
front holds each pane's create at a barrier until both panes arrive (at most 4 s) and delays B's create by
2 s. On the fixed build the barrier times out, because B's pane cannot exist while A holds the lock.

| Build | A stores | B stores | B's purge |
| --- | --- | --- | --- |
| `3c1d04c9` | `ses_ebf01a252ffeO7L0f7KdnY9JJX` | the same A ID; B's real `ses_ebf019a63ffexQXheUZ3l2VUSa` was created 2 s later | not run (sol-6-1 showed it) |
| `0080cf87` | `ses_ebf015ed4ffeXpk1cpbfEnVQEY` | its own `ses_ebf015269ffeHrSHPMej1pfKZa` | interrupt 19:16:45.739 and remove 19:16:46.017 UTC of B's ID only; A's ID still answers `session.get`, B's answers 404 |

Order on the fixed build (UTC): both starts 19:16:26.761; A's runtime 19:16:27.431; A's create
19:16:31.700; A returned 19:16:32.238 (5.477 s); B's runtime 19:16:32.616, after A's return; B's create
19:16:34.875; B returned 19:16:35.409 (8.648 s).

Other ownership checks:

- **Symlinked workspace:** fleet B's project path was a symlink to fleet A's repository. B's create came
  after A returned; each fleet stored its own ID (5.418 s and 8.464 s).
- **Two titles in one directory:** prefixes `r3ta` and `r3tb`. The starts did not wait for each other
  (1.552 s and 3.522 s), and each stored its own ID through the exact-title filter.
- **Two concurrent worker spawns with the same title and directory:** with the worktree workspace the case
  cannot form. Both fleets share `~/.worktrees/<project>/<session>`, and the second `git worktree add`
  fails before the lock (`fatal: '.../r3sw-1' already exists`, exit 1 in 0.301 s); the other spawn mapped
  its own ID. The author built it with a fixture workspace; the lock covers it in principle.
- **A holder that dies after the launch:** case c of M-1. **Before the launch:** the author's child-process
  test kills the owner after `acquire` and before `start()`; the successor reclaims. The real window is
  microseconds.
- **PID reuse:** `kill(pid, 0)` succeeds for a reused PID, so the waiter times out after 30 s instead of
  stealing. This only applies in the window before `start()`; after it the marker decides. Correct and
  bounded.
- **Lock root controlled by another user or a symlink:** m-3. **`/tmp` cleaned at boot:** harmless (m-3).

**M-1, sol-6-1's reproductions on the worktree build** (13 workers `r3m-1` to `r3m-13`, IDs shared by
editing scratch metadata):

| Case | Result |
| --- | --- |
| Purge `r3m-2`; `r3m-1` holds the same ID, status `merged`, pane alive | exit 0, 0.265 s; `ao: kept OpenCode session ses_ebefb059effe... of r3m-2: live session r3m-1 uses it.`; no interrupt or remove; ID still answers |
| Purge `r3m-4`; holder `r3m-3` `merged`, pane stopped on the private server | exit 0, 0.560 s; `has-session -t =...-r3m-3` then `list-panes`, then interrupt and remove of the ID |
| Purge `r3m-5`; holder `r3m-6` `spawning` | kept, 0.272 s |
| Then `r3m-6` set to `merged`; `ao session remap r3m-5 --force` | exit 1, 0.410 s: `Cannot remap r3m-5 to OpenCode session ses_ebefaec4dffe...: live session r3m-6 uses it.` |
| `ao session cleanup` | exit 0, 0.965 s: `Cleaned: r3m-3` (dead tmux runtime, so the OpenCode dead-runtime branch archives it); both shared IDs kept with one line each; the ID of `r3m-6` still answers |
| Purge `r3m-8` while the fixture delays every `has-session` by 5 s; holder `r3m-7` `merged` | kept: `session r3m-7 may still use it (liveness could not be checked)`; the guard ends at its 2 s bound; the whole kill took 6.774 s because the kill path's own `has-session` was also delayed |

Herdr holders: no Herdr server was available, so I judged the cost from the code and the scratch test of
m-2. Keeping a shared ID while a Herdr holder record is active is acceptable. Never cleaning a dead
Herdr OpenCode session is not (m-2).

## Status of every earlier finding

| Finding | Status | Evidence on `0080cf87` |
| --- | --- | --- |
| R1 Sonnet B-1: pane create loses the discovery race | Fixed | 20 of 20 worker spawns stored their own ID at return, 1.545 to 1.633 s, mean 1.594 s |
| R1 Sonnet B-2: title search binds another fleet | Fixed for protocol launchers | R2 B-1 above; wrong-directory decoy `ses_ebeecf1bdffe...` (title `AO:r3m-13`, other directory) was not bound and survived; same-directory pre-start decoy `ses_ebf015ed4ffe...` was not bound by the next start of that fleet |
| R1 Sonnet M-1: missing mapping masks the refused version | Fixed | restore with a 1.18.35 front: exit 1, 0.209 s, `ao needs OpenCode 2.0.29 or later (found opencode v1.18.35)` |
| R1 Sonnet M-2: safety properties not pinned | Fixed for the listed mutants | E, G, I, K, L, M killed by the same tests as in round 2 (table below); new gaps in m-4 |
| R1 Sonnet m-1: 404 restore resumes a gone ID | Fixed | exit 1, 0.428 s, `the stored OpenCode session ses_ebeecede5ffe... is gone (session.get answered 404)`; archive unchanged |
| R1 Sonnet m-2: exact title beyond page 1 missed | Fixed | helper unchanged in round 3 except a comment; mutant G killed by the paging and cap tests |
| R1 Sonnet m-3: dead parameters, stale spec | Fixed | the spec now describes the lock and the guard (with the line-55 wording problem of M-1) |
| R1 Sonnet m-4: a purge removes a shared ID | Fixed for tmux and mock runtimes | R2 M-1 above; open parts m-1 and m-2 |
| R1 Sonnet m-5: failed purge silent, 41 s | Fixed | hanging service: exit 0, 20.221 s, one interrupt, one remove, one warning that names `ao session cleanup` |
| R1 Sonnet m-6: scope and test isolation | Addressed | 8 files, all allowed; my full suite left the host lock root unchanged |
| R1 V4 Flash M-1 | Fixed | same as Sonnet M-1 |
| R1 V4 Flash m-1: ignored flag | Fixed | flag removed in round 2 |
| R1 V4 Flash m-2: interrupt mock shape | Fixed | mutant E killed |
| R2 sol-6-1 B-1, M-1 | See above | |

**Remap with two visible candidates:** after a restart of fleet A of the B-1 run, `ao session remap
r3cbb-orchestrator --force` refused in 0.380 s and printed both IDs, the directory and the creation times
(19:38:41.358Z and 19:16:31.680Z).

## Bounded time with a hanging `opencode api` (brief item 5)

| Operation | Exit / time | Result |
| --- | --- | --- |
| Fresh worker spawn | 0 / 15.826 s | no mapping; one line names `ao session remap r3hg-1` and the block; marker left |
| Fresh orchestrator start | 0 / 15.688 s | the same; marker left |
| Restore with a stored ID, runtime already gone | 1 / 10.393 s | one bounded `session.get`, `OpenCodeApiTimeoutError`; archive unchanged. The author measured 30.4 s with a live pane (three bounded reads) |
| `kill --purge-session` | 0 / 20.221 s | one interrupt, one remove, one warning |
| Start while another start holds the lock in its discovery | 1 / 13.718 s | spinner only, then the marker refusal |
| Start while the lock holder is frozen | 1 / 30.326 s | spinner only, then `Timed out waiting for the OpenCode launch lock ... no pane was launched` |

Added time without contention: five spawns on each build in fresh scratch projects took a mean of
1.592 s on `0080cf87` and 1.581 s on `3c1d04c9` (+11 ms, inside the noise). Uncontended orchestrator
starts took 1.55 to 1.63 s. A contended start waits for the holder's whole launch and discovery.

## Helper and command strings (brief item 6)

Round 3 changes only a comment in `opencode-api.ts`. The helper still calls
`execFile("opencode", args)` with an argument array, a timeout on every call, a `maxBuffer`, and piped
stderr. A 404 becomes `null`, other errors are thrown with `cause`, an empty or cut answer throws (only
`session.remove` may be empty). The new guard's `tmux` call also uses `execFile` with an argument array
and a 1.5 s timeout. I transpiled the `c949f902` plugin source and compared it with this worktree's build:
**identical=11, different=0** (nine launch and resume cases with prompt quotes, model, subagent, system
prompt, system prompt file, permissionless and a stored ID; two successful stored-ID restores).

## Tests (brief item 7)

All runs used `env -i` with a new empty fake `HOME` per command, no `AO_*` variable, and a `tmux` shim
(`-L ao26r3t`). The "present" runs had my no-turn `opencode` front on `PATH`; the front sends every API
call to the isolated store.

```text
pnpm install                                   exit 0 (the known missing ao bin link warning)
pnpm build                                     exit 0
pnpm --filter @aoagents/ao-core test           Test Files 33 passed (33); Tests 704 passed (704)
pnpm --filter @aoagents/ao-core typecheck      exit 0
pnpm --filter @aoagents/ao-plugin-agent-opencode test       Tests 160 passed (160)
pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck  exit 0
integration, opencode hidden                   Test Files 10 passed | 3 skipped (13); Tests 95 passed | 24 skipped (119)
integration, opencode present                  Test Files 10 passed | 3 skipped (13); Tests 95 passed | 24 skipped (119)
pnpm lint                                      0 errors, 5 warnings (the existing ones; console calls now at session-manager 1420/1427)
pnpm typecheck                                 exit 0
pnpm test                                      exit 0 in 67 s; 1943 passed, 29 skipped
```

Full-suite counts: core 704; Gemini 56; Claude Code 154; Codex 215; desktop 26; Herdr 36; GitHub SCM
140 + 5 skipped; GitHub tracker 42; worktree 46; tmux 26; OpenCode 160; integration 95 + 24 skipped; CLI
243. The host lock root was the same before and after every suite.

**New tests on the `3c1d04c9` sources:** I copied the round-3 test files and the new lock module (so that
the imports resolve) onto the round-2 sources. **16 of the 16 new behavior tests fail** there: both
cross-fleet serialization tests, the late-create refusal, the five live terminal-holder cases, the six
"keeps a merged holder with ..." cases, the tmux operational-error case and the archived-remap refusal.
The six lock-module tests need the new module, so they cannot run on the old sources. The tests assert
relations (each fleet stores its own ID, A is stored before B's pane is launched, the kept ID still
exists, no API call was made, a wait ends near its injected bound), not copies of the 30 s or 2 s
literals.

**Mutants** (scratch copy of `0080cf87`, sanitized environment, the four OpenCode and session-manager
test files, 250 tests on the clean copy):

| Mutant | Result | Killing test |
| --- | --- | --- |
| E: top-level `interrupted` read as false | killed (1) | `reads the top-level shape that 2.0.29 answers` |
| G: no list `limit` | killed (3) | `asks for a page size that keeps one answer far below the 262144-byte pipe size`, paging, cap |
| I: remove before interrupt | killed (2) | `purges mapped OpenCode session when requested`, bounded purge |
| K: unmapped purge searches by title | killed (1) | `does not search by title on purge when no ID is stored (Q7)` |
| L: reuse after a failed `session.get` | killed (1) | `does not reuse a stored ID that session.get cannot check (M-2 L)` |
| M: gone orchestrator ID replaced by title | killed (1) | `does not replace a gone stored orchestrator ID with a title match (M-2 M)` |
| X1 (lock): launch time recorded before the lock | killed (1) | `serializes overlapping orchestrator launches before the second pane creates its session` (the worker variant passes) |
| X2 (lock): no `realpath` in the key | killed (1) | `serializes aliases of a real directory until completion and release` |
| G1 (guard): skip terminal statuses again | killed (13) | `keeps a live merged holder during purge and archived cleanup` and 12 more |
| G3 (guard): the 2 s timeout counts as dead | killed (1) | `keeps a merged holder with hang` |
| G4 (guard): drop the exit-code test | survives | near-equivalent: a matching diagnostic with another exit code does not occur |
| G2, G5, G6 | survive | m-4 |

## Scope and commits (brief item 8)

`0080cf87` changes 8 files: the new `opencode-launch-lock.ts` and its test, `session-manager.ts`,
`opencode-api.ts` (a comment), three `__tests__/session-manager/*` files and
`docs/opencode-workflows-spec.md`. All are in the brief's allowed list. The message is `fix(core): ...`
with two WHY paragraphs, no `Co-Authored-By`, no emoji, no issue number. `git diff --check` is clean.
`git branch -r --contains 0080cf87` prints nothing.

## What I found correct

- The lock order: acquire, then `start()` writes the marker and returns a launch time strictly later than
  the acquisition, then `runtime.create`, discovery, the metadata write, `complete()`, and `release()` in
  `finally` (`session-manager.ts:1274-1276`, `:1372`, `:1397`; `:1718-1720`, `:1797`, `:1808`).
- The key: SHA-256 of the real directory and the exact title, outside every config hash and state root.
  Production refuses an unresolvable workspace.
- Owner files with unique names, a reaper that never retries `rmdir` after `ENOENT`, and a conservative
  PID check. The wait is bounded at 30 s and refuses before any pane is launched.
- The guard ignores lifecycle status, keeps the ID for live, unknown, failed and slow checks, prints one
  reason line per kept ID, and protects active and archived remap.
- Every round-2 repair that I checked stays: mapped spawns, decoy filters, the two-candidate refusal,
  version-first and 404 restore refusals, ID-only purge, and the timeout stop of the remove retries.
- The launch, resume and restore strings are byte-identical to `c949f902`.
- The new tests are real regressions: all 16 fail on the round-2 sources.

## Environment and cleanup

Node v25.7.0, pnpm 9.15.4, OpenCode 2.0.29, tmux 3.4. Scratch tree `/tmp/ao26r3`: fake `HOME`, two state
roots per run, configs, the scratch repository and its bare origin, the round-2 and mutant copies, and
logs. Isolated OpenCode service: PID 3621596, port 49826, the four `XDG_*` directories under
`/tmp/ao26r3/iso`. Before the first write its `server.info` PID differed from the global PID 4171365.
The global service got only `server.info`. No model turn, no credential, no `auth`, no read of a
`service.json`. The `opencode` front sent `--version`, `api` and `session` to the real binary with the
isolated `XDG_*` values pinned, and replaced the TUI with an idle process named `opencode`. The `gh` stub
answered only `--version` and `auth status`. Every tmux call, mine and the code's, went through a shim
that unsets `TMUX` and adds `-L ao26r3` (`-L ao26r3t` for the test suites). No default-server tmux
command ran.

Lock root `/tmp/ao-opencode-launch-44402`: absent before my work; my first live run created it (mode
0700). My runs left 7 lock directories, each with a `pending.json` whose directory is under `/tmp/ao26r3`.
I removed exactly those 7 by name. The root is now empty, and I left it in place.

I stopped by exact PID: 22 scratch lifecycle workers (each checked by its `/tmp/ao26r3` working
directory), the private tmux server 3678831 (30 sessions, no pane survivor), and the isolated service
3621596. No process with a `/tmp/ao26r3` working directory or environment remains. I removed the two dead
socket files of my private servers and the scratch tree. The only new file in the worktree is this review
(and the requested watcher report); no tracked file changed, and I made no commit, push or PR.
