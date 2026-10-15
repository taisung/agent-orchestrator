# I-2 round 5 re-check: `ece9372e..bfa5af45`

Reviewer: ao-26 (Claude Opus 5.5). Date: 2026-10-15. Reviewed commit: `bfa5af45 fix(core): keep unresolved
OpenCode launches safe during recovery` (author astra, ao-28). Whole increment: `49369f18..bfa5af45`.

## Verdict: LAND-SAFE

Round 5 fixes M-2, M-3, m-5 and m-7. It fixes m-6 when the tmux server of the failed pane still runs. I
found no blocker and no major finding. A protocol launcher can no longer bind another pane's session by any
order of creates in an ordinary host state. The residual cases need a non-protocol creator together with a
create that is in flight when its pane dies, or a contrived host state (list in item 1).

New findings: 0 B, 0 M, 1 m (m-8). Numbers continue from round 4.

- **m-8 (minor, availability only).** When the earlier pane was the last session on its tmux server, the
  server exits with the pane. Then no rule can prove that the pane is gone, and only `rm -r` clears the
  marker. The m-6 failure line promises automatic recovery in this state, and that is wrong. A protocol
  launcher in an ordinary host state can cause it (a host where no other tmux session runs on that server).
  It never binds a wrong session, and the refusal prints the exact command. Round 4 recovered one of these
  cases by rule 1, so this is the cost of the M-2 fix (my round-4 option 1, whose cost I did not see).

Under the owner's stop rule, m-8 is the only finding that a protocol launcher in an ordinary host state can
cause. It costs availability and one wrong operator line, not safety. I rate it minor and do not hold the
landing for it. The fix is small (see m-8).

**Isolation breach in this review (my error, not a code finding).** My first setup started the private tmux
server from my own shell. The panes then got my real `HOME`, and the pane's login shell put the real
`opencode` first on `PATH`. Two panes (fleet A on this build, fleet Old on the `main` build) created
sessions on the GLOBAL OpenCode service, and the real TUI ran the orchestrator `--prompt`. This made two
model turns, which the brief forbids. Details, cost and cleanup are in "Method, isolation and cleanup".
Both turns had ended when I found it and stopped both TUIs. I did not remove the two global sessions,
because the global service is read-only for me. The owner can remove `ses_ebe4c58ecffexfEl81wt8iCk4y` and
`ses_ebe4c1ae5ffeUF3dHbjY63ravQ`. I discarded that run and repeated it with a correct setup.

## Status of the round-4 findings

| Finding | Status | Evidence on `bfa5af45` |
| --- | --- | --- |
| M-2: rule 1 accepts a create that the earlier pane did not make | **Fixed** | `main`-build start and manual create: fleet B refuses while fleet A's pane lives (exit 1, 0.419 s and 0.362 s; again after A's late create landed: 0.363 s and 0.387 s). After `ao stop` of A, B recovers and stores its own pane's ID (1.673 s and 1.681 s) |
| M-3: the timeout text tells the operator to remove a live holder's marker | **Fixed** | Stopped holder: the waiter exits 1 after 30.416 s with `(<key>.lease) ... Held by PID 1472486; wait, or stop PID 1472486 first.` and no `rm`. After `rm -r` of the key directory and SIGCONT, the holder exits 0, keeps its pane and stores its pane's ID |
| m-5: a stall during an in-flight search loses the mapping | **Fixed** | Stop of 20 s while the search child ran (`Rl`): one final search at +20.07 s, the holder stores its own pane's ID |
| m-6: an uncertain runtime failure leaves a marker that only `rm -r` clears | **Partly fixed** | With other sessions on the server: handle and socket recorded, refusal before 25 s (0.563 s), recovery after 25 s (1.739 s). When the failed session was the server's last session: no socket, manual only, and the line is wrong (m-8) |
| m-7: N7 and N9 survive | **Fixed** | N7 (`statSync` for the root) is killed by `refuses a symlink lock root` (the symlink now points to an own 0700 directory). N9 (no 3 s grace) is killed by `preserves a young empty directory while its launcher publishes an owner` |

## New finding

### m-8: a marker whose tmux server exited needs `rm -r`, and the m-6 line then says it recovers

**Files:** `packages/core/src/opencode-launch-lock.ts:144-168` (`paneDefinitelyGone`: only `can't find
session:` counts as gone), `:255` (both rules now need that answer), `:340-362` (`recordRuntime`: the
socket lookup fails when the server is gone); `packages/core/src/session-manager.ts:143-169`
(`recordFailedOpenCodeLaunch`: the tmux branch at `:156-159` always prints the 25 s recovery sentence);
`docs/opencode-workflows-spec.md:55` ("An unreachable server ... require[s] manual recovery").

tmux exits when its last session ends (`exit-empty` is on by default). tmux 3.4 leaves the socket file in
place. Then `tmux -S <socket> has-session` prints `no server running on <socket>` and exits 1. The code reads
that as "unknown", so neither rule can settle the marker.

**Reproducer 1 (M-2 cost; round 4 versus round 5).** One fresh private server for each build, which holds
only the orchestrator. Fleet A runs `ao start` with its pane's create delayed 18 s. The start returns with
no mapping (15.914 s and 15.745 s). The create lands at +19 s. `ao stop` ends the pane, and the server exits.
Then a fresh `ao start`:

| Build | Result |
| --- | --- |
| `ece9372e` | exit 0, 1.698 s: `recovered ...: earlier create finished (ses_ebe3f278effe...)` |
| `bfa5af45` | exit 1, 0.367 s: `Cannot safely launch ...: an earlier OpenCode launch is unresolved ... A live earlier pane or unverified pane death keeps its marker ...` |

With a hanging API (the pane never creates), both builds refuse (0.348 s and 0.491 s).

**Reproducer 2 (m-6 residual).** A fresh private server, an orchestrator start with one injected
`send-keys` failure: exit 1, 0.395 s. runtime-tmux kills the session, and the server exits. The
server-wide `display-message` then fails, so the marker has the handle but no `tmuxSocket`. The line still
says `A fresh start can recover once the recorded pane is proven gone and 25 s have elapsed since launch.`
A start 26 s later: exit 1, 0.360 s, "unresolved". Only the printed `rm -r` clears it.

**Stop-rule note:** a protocol launcher in an ordinary host state can cause this: `ao start` from a plain
terminal on a host where no other session runs on that tmux server. On this host the fleets share the
default server, which holds many sessions, so the server rarely exits there. The cost is availability: the
refusal names the exact `rm -r` command. No case binds a wrong session.

**Fix (small, keeps the safety rule):**

1. In `paneDefinitelyGone`, count `no server running on <recorded socket>` (exit 1) as gone. tmux prints it
   when the socket file exists but nothing listens on it, so the recorded pane cannot live there. Keep
   `error connecting to ... (No such file or directory)` and every other answer as unknown. The only false
   "gone" needs a live server whose socket file was deleted and replaced.
2. In `recordFailedOpenCodeLaunch`, print the 25 s sentence only when `tmuxSocket` was recorded. Otherwise
   print that only manual recovery is safe.

## Item 1: M-2

**Reproducer of round 4, `main`-build creator** (round-5 build for fleets A and B, a scratch export of the
fork `main` `e4a7b63e` for fleet Old; one isolated service, one private tmux server with a keepalive
session, one scratch repository, prefix `r5oc`):

1. Fleet A `ao start`, its pane's create delayed 40 s: exit 0, 15.872 s, no mapping. The marker holds the
   handle `f13ebdb8c6e8-r5oc-orchestrator` and `tmuxSocket` `/tmp/tmux-44402/ao26r5`.
2. Fleet Old (`main` build) `ao start`: exit 0, 0.717 s. Its pane creates `ses_ebe47dfe2ffeV6PaqFAHyVqmR5`
   with the title `AO:r5oc-orchestrator` in `/tmp/ao26r5/repo` at +26 s.
3. Fleet B at +28 s: exit 1, 0.419 s, `Cannot safely launch AO:r5oc-orchestrator in /tmp/ao26r5/repo: an
   earlier OpenCode launch is unresolved (...). A live earlier pane or unverified pane death keeps its
   marker, even if a matching session exists. After stopping and settling ... run rm -r -- '...'`.
4. Fleet A's late create lands at +40.6 s as `ses_ebe47a713ffe3JmOn3qq8lFnI0`. Fleet B at +45 s: exit 1,
   0.363 s, the same line. No fleet stores a wrong ID.
5. `ao stop` of fleet A (0.441 s), then fleet B: exit 0, 1.673 s, `recovered ...: earlier pane is gone and a
   matching create finished (ses_ebe47a713ffe..., ses_ebe47dfe2ffe...)`. B stores
   `ses_ebe47616bffeRM5mv5GfOlWU0p`, the session that its own pane opened. The lock made one call:
   `tmux -S /tmp/tmux-44402/ao26r5 has-session -t =f13ebdb8c6e8-r5oc-orchestrator`.

**Manual-create variant** (prefix `r5mf`): manual `session.create` at +16 s; fleet B refuses at +28 s
(0.362 s) and at +45 s after A's create landed (0.387 s); after `ao stop` of A, B recovers (1.681 s) and
stores its own pane's `ses_ebe465b5cffeAfFNmZF0Rm76H6`.

**Herdr, no handle, no socket:** the unit cases `refuses an outside matching create while the earlier pane
is live / no handle / no socket / herdr` pin the manual path. All four fail on the `ece9372e` sources.
Mutant P1 (rule 1 without the pane check) is killed by 5 tests: the four lock cases above and the
cross-fleet case `refuses an outside create while the earlier pane lives, then recovers after it stops
...`.

**Can a protocol launcher still bind another pane's session by any order of creates?** In an ordinary host
state, no. A successor stores only a session created at or after its own `startedAt`, and it takes that
time stamp only after it settled every earlier marker under the lease. An earlier pane's create can land
after that time stamp only if the marker was settled while that create could still come:

- Rule 1 needs the explicit negative for the recorded pane. With only protocol creators, the matching
  session is that pane's single create (one create, no retry in the pane script). No create can follow it.
- Rule 2 needs the same negative and an age of 25 s. A create can follow only if the OpenCode service
  received the dead pane's request and completes it more than 25 s after that pane's launch. That needs a
  stalled service (contrived host state; I could not make it in round 4).
- A tmux session with the same name on the recorded server answers "live", so it refuses. That is the safe
  direction.

**Known limits under the stop rule** (not findings):

1. A non-protocol create of the exact title and directory, plus an earlier pane that dies while its own
   create request is already inside the service. Rule 1 then settles at once, and the dead pane's late
   create can land in the successor's window before the successor's own create. The successor then stores
   the session of a dead pane. That session has no live pane, so a purge loses no live conversation, but
   the successor's mapping is wrong. This needs a non-protocol creator and a create in flight at the moment
   of the kill.
2. A clock step back: it can make an older same-title session count for rule 1. With the pane check, this
   only matters together with limit 1.
3. A live tmux server whose socket file was deleted and replaced (round 4).

**Availability cost of the fix:** a live earlier pane now blocks every other fresh start of the same title
and directory until that pane stops, also after its create landed. `ao session remap` in the earlier fleet
does not clear the marker. This is the case of two fleets with the same prefix in one project directory,
which is what the lock must stop, so I accept it. The refusal does not name the recorded pane (its tmux name
and socket are only in `pending.json`). A follow-up can print them.

## Item 2: M-3

**Stopped-holder reproducer** (prefix `r5cg`, create delayed 4 s):

1. Fleet A `ao start` (PID 1472486). I SIGSTOP it 0.4 s after its second discovery search starts. Its
   pane's create lands 4 s later (`ses_ebe45810fffeWjuza3M7dEkuLF`).
2. Fleet B `ao start`: one wait line `(/tmp/ao-opencode-launch-44402/e61403fe....lease)`, then exit 1 after
   30.416 s: `Timed out waiting for the OpenCode launch lock for AO:r5cg-orchestrator in /tmp/ao26r5/repo
   (/tmp/ao-opencode-launch-44402/e61403fe....lease); no pane was launched. Held by PID 1472486; wait, or stop
   PID 1472486 first.` The text has no `rm`.
3. The root then held `e61403fe...` (A's owner token and `pending.json`) and `e61403fe....lease` (A's lease
   token). I ran `rm -r -- /tmp/ao-opencode-launch-44402/e61403fe...` (the key directory), waited 6 s and
   sent SIGCONT.
4. Fleet A: exit 0, no warning. One search ran after SIGCONT and found the session. A stores
   `ses_ebe45810fffe...`, the session of its pane, and the pane `cf3d22e7de2d-r5cg-orchestrator` lives. The
   root is empty afterwards (A released the lease).

While A was stopped, its lease token kept every other launcher out, also after the key directory was gone.
So no second pane could start, and A's `complete()` could not remove another launcher's marker.

**Blocker names** (built module, test root): a live unrelated PID in `<key>.lease` gives `(<key>.lease) ...
Held by PID 1486000; wait, or stop PID 1486000 first.`; a live PID as owner of `<key>` without a lease gives
`(<key>) ... Held by PID 1486000 ...`. An empty young lease directory is replaced at once by the atomic
`rename`, which is correct.

**First error kept:** `releaseOpenCodeLaunchLock` (`session-manager.ts:134-141`) only warns when the setup
already failed. The two post-launch blocks set `setupFailed` in their `catch` (`:1444`, `:1879`), and
`recordFailedOpenCodeLaunch` releases with `failed = true`. The unit cases `preserves the first worker /
orchestrator setup error when release also fails` pin it. Mutants P4, P12 and P13: all killed (P4 by both
first-error cases, P12 by the worker case, P13 by the orchestrator case).

**Note:** "stop PID n" can be read as SIGSTOP, which keeps the lock. The brief gave this wording.
"wait, or end PID n first" would be clearer. Not a finding.

## Item 3: m-5 to m-7

**m-5:** fleet A (PID 1493478, prefix `r5cd`) stopped when its pane's create started. Its first search
child was then running (`ps`: `opencode api session.list ...`, state `Rl`). Fleet B started at once. After
20.06 s, SIGCONT: fleet A ran one search (at +20.07 s), found its session and exited 0 with
`ses_ebe440102ffe5AuKPYi4Laz7BW`, the session of its own pane. Fleet B printed one wait line on the lease,
launched after A released, and stored its own `ses_ebe43bfcdffeqF4mrDrqMzec0m` (exit 0, 21.332 s). No marker
was left. The M-3 run above shows the same path. Code: `opencode-api.ts:410-438`; the final search runs
when an empty exit-0 answer comes after its own bound, or when the clock is past the deadline by more than
the search bound. Mutants P5 and P6: both killed, each by its own case of `makes one final search after
suspension during a search` (`empty exit 0` and `overdue timeout`).

**m-6, worker** (prefix `r5wk`): one injected `send-keys` failure: exit 1, 0.487 s. The marker holds
`{"id":"2eaf0f2d397d-r5wk-4","runtimeName":"tmux","data":{}}` and `tmuxSocket` `/tmp/tmux-44402/ao26r5`. The
shim log shows `L=ao26r5 display-message -p #{socket_path}`, the same `-L ao26r5` server that ran
`new-session`. The line: `ao: uncertain OpenCode launch 2eaf0f2d397d-r5wk-4. A fresh start can recover once
the recorded pane is proven gone and 25 s have elapsed since launch. After stopping ... run rm -r -- '...'`.
The record is archived with `status=killed`. No later launch uses the title `AO:r5wk-4`, because the number
stays used, so this marker stays in `/tmp` until the host clears it. That is harmless.

**m-6, orchestrator** (prefix `r5so`, then `r5sp`): exit 1, 0.421 s, the same line; the marker holds the
handle and the socket. Before 25 s: exit 1, 0.563 s, "unresolved". After 25 s: exit 0, 1.739 s,
`recovered ...: earlier pane is gone and its create window has elapsed.`, one `has-session` on the recorded
socket, and the start stores its own pane's ID. When the failed session was the last one on its server, the
fix does not work (m-8).

**Same server:** the lock runs `tmux display-message -p '#{socket_path}'` and `has-session` with the
process environment. runtime-tmux runs `new-session` with the same environment on this branch, and with
`{...process.env, PATH: panePath}` on `main`. `TMUX` and `TMUX_TMPDIR` are the same in both, and `-L`/`-S`
are not used, so both reach the same server. On `main` plus the increment, a `send-keys` failure recorded
`/tmp/tmux-44402/ao26r5` too.

**The lifecycle first-poll race** (out of scope) appeared after some orchestrator `send-keys` failures:
the lifecycle worker recreates the record with only `status=killed`, and the next `reuse` start fails with
`already exists but is not in a reusable state` before it reaches the lock. It hit 1 of 3 runs on each
build (`bfa5af45` and `ece9372e`), so round 5 does not make it more likely.

**m-7:** N7 (`statSync` for the root) is killed by `refuses a symlink lock root` (the symlink now points to
an own 0700 directory). N9 (no 3 s grace) is killed by `preserves a young empty directory while its launcher
publishes an owner`.

## Item 4: no regressions

**Round-4 cases a to f** (round-5 build, shared server with a keepalive session):

| Case | Result |
| --- | --- |
| a. All API calls hang during a start; stop; start | Start: exit 0, 15.767 s, one unmapped line. At once after the stop: exit 1, 0.536 s, "unresolved". After 25 s: exit 0, 1.695 s, `earlier pane is gone and its create window has elapsed`, own ID |
| b. The pane's create fails | Start: exit 0, 15.890 s. Another fleet while the pane lives: exit 1, 0.357 s. After `ao stop`: exit 0, 1.658 s, `earlier pane is gone and its create window has elapsed`, own ID |
| c. SIGINT during discovery; remap; stop; start | SIGINT exit 130. Remap exit 0, 0.319 s. After stop: exit 0, 1.646 s, `earlier pane is gone and a matching create finished`, a new own ID |
| d. SIGSTOP during discovery while another fleet starts | See m-5: both fleets store their own IDs |
| e. Remove only `pending.json` | exit 0, 4.176 s, `reclaimed an empty OpenCode launch lock` |
| f. The holder is frozen | See M-3: 30.416 s, PID text, no `rm`; the holder keeps its pane |

**B-1:** one injected `new-session` failure: exit 1, 0.446 s, no marker. The next two spawns: exit 0,
1.611 s (`r5wk-2`) and 1.656 s (`r5wk-3`); each stores the ID of its own pane.

| Check | Result |
| --- | --- |
| sol-6-1 overlapping start (two fleets at the same instant, `ignore`) | A: exit 0, 2.720 s; B: exit 0, 1.518 s; each stores the ID that its own pane opened |
| 10 worker spawns | 10 of 10 mapped at return, each equal to its pane's ID; 1.514 to 1.637 s |
| Live `merged` holder, purge | exit 0, 0.252 s, `ao: kept OpenCode session ses_ebe3c5d55ffe... of r5ten-2: live session r5ten-1 uses it.`; no remove |
| Live `merged` holder, archived remap | exit 1, 0.338 s, `Cannot remap r5ten-7 to OpenCode session ses_ebe3c3837ffe...: live session r5ten-6 uses it.` |
| Live `merged` holder, cleanup | exit 0, 0.893 s; kept both shared IDs with one line each; both IDs still answer |
| m-1: purge with the shim on a socket with no server | exit 0, 0.237 s, `kept ... of r5ten-9: session r5ten-8 may still use it (liveness could not be checked).`; no remove |
| m-3: 0777 root, symlink root, symlink to an own 0700 directory | all three refused: `Unsafe OpenCode launch lock root ...` |
| Restore with OpenCode 1.18.35 | exit 1, 0.232 s: `ao needs OpenCode 2.0.29 or later (found opencode v1.18.35)` |
| Restore with a removed ID | exit 1, 0.551 s: `the stored OpenCode session ses_ebe3c5103ffe... is gone (session.get answered 404)` |

**Bounded time with a hanging API:**

| Operation | Exit / time |
| --- | --- |
| Fresh worker spawn | 0 / 15.785 s, one unmapped line, marker |
| Fresh orchestrator start | 0 / 15.807 s, the same |
| Restore with a stored ID, runtime gone | 1 / 10.330 s, one bounded `session.get` |
| `kill --purge-session` | 0 / 20.278 s, one warning |
| Three starts of one orchestrator at once | 0 / 15.742 s; 1 / 15.500 s; 1 / 15.177 s ("unresolved", no pane) |
| A start that waits for a frozen holder | 1 / 30.416 s |

The two waiting starts now refuse 10 to 15 s sooner than in round 4 (25.193 s and 30.422 s), because the
live-pane check runs before the evidence search, and that search would hang.

**2.x strings:** the plugin and `core/src/utils.ts` have no change since `0080cf87`. I transpiled the
`c949f902` plugin and compared it with the built plugin: 9 launch and resume cases and 2 restore cases
(with a real ID of the isolated store), `identical=11 different=0`.

## Item 5: tests

All runs used `env -i`, an empty fake `HOME` under `/tmp/ao26r5/thome`, no `AO_*` variable and a `tmux`
shim with `-L ao26r5t`. The present runs used the front to my isolated store.

| Command | Result |
| --- | --- |
| `pnpm install`, `pnpm build` | exit 0, exit 0 |
| `pnpm --filter @aoagents/ao-core test` | Test Files 33 passed (33); Tests 751 passed (751) |
| `pnpm --filter @aoagents/ao-core typecheck` | exit 0 |
| `pnpm --filter @aoagents/ao-plugin-agent-opencode test` | Test Files 1 passed (1); Tests 160 passed (160) |
| `pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck` | exit 0 |
| integration, opencode hidden | Test Files 10 passed, 3 skipped (13); Tests 95 passed, 24 skipped (119) |
| integration, opencode present | Test Files 10 passed, 3 skipped (13); Tests 95 passed, 24 skipped (119) |
| `pnpm lint` | 0 errors, 5 warnings (the known ones) |
| `pnpm typecheck` | exit 0 |
| full `pnpm test` | exit 0; core 751, Gemini 56, Claude Code 154, Codex 215, desktop 26, Herdr 36, GitHub SCM 140 + 5 skipped, GitHub tracker 42, worktree 46, tmux 26, OpenCode 160, integration 95 + 24 skipped, CLI 243 |

**New tests on the `ece9372e` sources:** with the three round-5 test files on the round-4 sources, 19 of 158
tests fail: the five outside-create refusals (four lock cases and the cross-fleet case), the two blocker
texts, the two removed-marker cases and the two pane-and-mapping cases, the two first-error cases, the two
suspension cases and the "no retry of a failed final search" case, the two failed-delivery cases and the
3 s grace case. They assert relations (the blocker path, the PID, no `rm`, the stored ID equal to the pane's
ID), not copies of source text. The symlink-root test passes on round 4, as it should: round 4 already
refused it, and the test now kills N7.

**Mutants** (scratch copy of `bfa5af45`; set: `opencode-api`, `opencode-launch-lock`, the `session-manager/`
directory and `session-manager.test.ts`; baseline 297 of 297 pass):

| Mutant | Failing tests | First killing test |
| --- | --- | --- |
| E | 1 | `reads the top-level shape that 2.0.29 answers` |
| G | 3 | `asks for a page size that keeps one answer far below the 262144-byte pipe size` |
| I | 2 | `purges mapped OpenCode session when requested` |
| K | 1 | `does not search by title on purge when no ID is stored (Q7)` |
| L | 1 | `does not reuse a stored ID that session.get cannot check (M-2 L)` |
| M | 1 | `does not replace a gone stored orchestrator ID with a title match (M-2 M)` |
| X1 | 2 | `serializes overlapping worker launches before the second pane creates its session` |
| X2 | 1 | `serializes aliases of a real directory until completion and release` |
| G1 | 18 | `keeps a live merged holder during purge and archived cleanup` |
| G2 | 1 | `keeps a Herdr holder after a negative runtime check without trusting the agent negative` |
| G3 | 1 | `keeps a merged holder with hang` |
| G4 | 1 | `keeps a holder when tmux reports unexpected exit code as false` |
| G5 | 1 | `removes the shared ID after tmux explicitly answers that the holder is gone` |
| G6 | 2 | `archives a dead Herdr OpenCode session with an unmapped ID` |
| N1 | 1 | `does not settle a marker using a old decoy` |
| N2 | 6 | `does not settle a marker using a old decoy` |
| N3 | 1 | `requires old-marker and own-server death evidence: unreachable` |
| N4 | 3 | `allows the next worker after a unknown runtime failure` |
| N5 | 2 | `allows the next worker after a before delivery runtime failure` |
| N6 | 1 | `refuses a writable lock root` |
| N7 | 1 | `refuses a symlink lock root` |
| N8 | 5 | `makes a final bounded search after suspension across the poll deadline` |
| N9 | 1 | `preserves a young empty directory while its launcher publishes an owner` |
| N10 | 2 | `allows the next worker after a unknown runtime failure` |
| N11 | 2 | `refuses an outside create while the earlier pane lives, then recovers after it stops without binding its la...` |
| N12 | 3 | `names the live PID and blocking lock without a removal command` |
| P1 rule 1 without the pane check | 5 | `refuses an outside matching create while the earlier pane is live` |
| P2 complete() throws ENOENT | 4 | `completes and releases after its marker was removed` |
| P3 release() throws ENOENT | 4 | `names the live PID and blocking lease without a removal command` |
| P4 release error replaces the first error | 2 | `preserves the first worker setup error when release also fails` |
| P5 no empty-after-timeout retry | 1 | `makes one final search after suspension during a search: empty exit 0` |
| P6 no overdue retry | 1 | `makes one final search after suspension during a search: overdue timeout` |
| P7 failed delivery records no handle | 2 | `records the known worker handle after failed delivery so its marker can recover` |
| P8 targeted display-message | 2 | `records the known worker handle after failed delivery so its marker can recover` |
| P9 timeout names the key path | 1 | `names the live PID and blocking lease without a removal command` |
| P10 timeout gives the rm hint | 2 | `names the live PID and blocking lock without a removal command` |
| P11 no uncertain-launch line | 2 | `records the known worker handle after failed delivery so its marker can recover` |
| P12 worker finally replaces the first error | 1 | `preserves the first worker setup error when release also fails` |
| P13 orchestrator finally replaces the first error | 1 | `preserves the first orchestrator setup error when release also fails` |

All 39 mutants are killed: the 14 of round 4, my round-4 set N1 to N12 (N2 adapted to the new rule-2 form),
and 13 new mutants against round 5 (P1 to P13). P8 puts back the targeted `display-message -t =<id>`; the
failed-delivery cases kill it with a fixture that refuses a targeted query after the pane is gone.

## Item 6: scope

`bfa5af45` changes 7 files: `docs/opencode-workflows-spec.md`, `opencode-api.ts` and its test,
`opencode-launch-lock.ts` and its test, `session-manager.ts` and `__tests__/session-manager/spawn.test.ts`.
All are in the allowed list of the round-5 brief, section 4. The message is `fix(core): keep unresolved
OpenCode launches safe during recovery` with two WHY paragraphs, no `Co-Authored-By`, no emoji and no issue
number. `git branch -r --contains bfa5af45` prints nothing.

## Item 7: landing

The fork `main` is `e4a7b63e`. Since round 4 it added only `development/` documents; its last code commit is
still `9f06dc25`. Of the 16 files of the increment, `main` changes only `packages/core/src/index.ts` (+3
exports in another block). `git apply --check` of `49369f18..bfa5af45` on an export of `main` is clean. In
that scratch export (not a cherry-pick): build exit 0, `pnpm typecheck` exit 0, core 805, OpenCode 160, tmux
30 and Claude Code 167 tests pass. B-1 there: exit 1, 0.448 s, no marker, then `r5mp-2` and `r5mp-3`, each
with its own ID. A `send-keys` failure there recorded the handle and `/tmp/tmux-44402/ao26r5`.

The `main` PATH fix runs `new-session` with `{...process.env, PATH: panePath}`. It does not change
`err.cmd` (B-1), and the lock's `display-message` and `has-session` reach the same server (item 3). So a
cherry-pick of `49369f18..bfa5af45` onto `main` cannot change the reviewed behaviour. I did not
cherry-pick.

## What I found correct

- Both recovery rules start with the explicit `can't find session:` answer from the recorded socket. A live
  earlier pane keeps its marker whatever the store holds. Herdr, no handle, no socket and an unreachable
  server stay manual.
- The live-pane check runs before the evidence search, so a live pane gives a fast refusal (0.36 to 0.56 s),
  also with a hanging API.
- The timeout text names the real blocker (`.lease` or the key directory) and the holder PID, and it has no
  `rm` for a live holder.
- `complete()` and `release()` accept `ENOENT`. A removed marker cannot make a holder destroy its pane, and
  the holder's lease still keeps every other launcher out.
- A release error never replaces the first setup error. It becomes one warning line.
- The final search covers a stall during an in-flight search and stays bounded to one extra API bound.
- A failed delivery records the handle and the server-wide socket of the same server, so rule 2 settles the
  orchestrator marker after 25 s when that server still runs.
- The tests kill N7, N9 and all 39 mutants of my set, also my 13 new ones against round 5. The new tests fail
  on the round-4 sources.

## Method, isolation and cleanup

- Builds: this worktree (`pnpm install`, `pnpm build`); scratch exports of `ece9372e` (round-4 comparisons
  and the new tests on round-4 sources), `main` (fleet Old), `main` plus the increment, and `bfa5af45` (the
  mutants).
- One isolated OpenCode 2.0.29 service (PID 1332756, port 49857, the four `XDG_*` directories under
  `/tmp/ao26r5/iso`). Before the first write, its `server.info` PID was not the global PID 4171365.
- A front `opencode` that forwards `--version`, `api` and `session` to the isolated store and replaces the
  TUI with `sleep`. A `gh` stub that answers only `--version` and `auth status`. Live `ao` runs: `HOME` and
  `AO_STATE_ROOT` under `/tmp/ao26r5`, scratch configs, a scratch repository with a bare origin.
- Private tmux servers only: `-L ao26r5` (live runs), `ao26r5-solo`, `ao26r5-solo-r4`, `ao26r5-solo-r5`,
  `ao26r5-late-r4`, `ao26r5-late-r5` (one-session servers), `ao26r5-none` (no server), `ao26r5t` (tests),
  `ao26r5m` (mutants), `ao26r5x` (round-4 test sources). No command went to the default server.

**The isolation breach.** At about 18:34 I started `-L ao26r5` (PID 1379182) from my own shell with only
`TMUX` removed, to hold a keepalive session. The server's global environment then had my real `HOME`. tmux
3.4 gives a new pane the `PATH` of the `new-session` client, but the pane's login shell ran my real startup
files, and they put `/home/taisung/.opencode/bin` first on `PATH`. So in the first M-2 run (prefix `r5ob`),
the pane script and the TUI of fleet A (round-5 build) and fleet Old (`main` build) used the real `opencode`
and the global store:

- Global sessions: `ses_ebe4c58ecffexfEl81wt8iCk4y` (cost 0.0016251, 13524 input and 559 output tokens) and
  `ses_ebe4c1ae5ffeUF3dHbjY63ravQ` (cost 0.0032372, 30107 input and 686 output tokens). Title
  `AO:r5ob-orchestrator`, directory `/tmp/ao26r5/repo`, model `opencode-go/muse-spark-1.3-contributor`.
  Both turns ended (`outcome: succeeded`, idle) before I stopped the TUIs.
- I found it in the next check, stopped both TUI processes (PIDs 1387963 and 1394969) and their tmux
  sessions, and stopped the three lifecycle workers of that run. I read the two sessions with `session.get`
  only.
- Fleet A's scratch record got `opencodeSessionId=ses_ebe4c58ecffe...` from no command of mine. So the
  orchestrator model probably ran the global `ao` (the primary checkout's build) with the scratch
  `AO_CONFIG_PATH`. Checks: the scratch repository has only `.ao/` untracked and no new branch; no
  `r5ob` or `ao26r5` trace in `/home/taisung/.agent-orchestrator`; `~/.ao/bin` unchanged since 2026-09-16;
  no worker was spawned; the lock root held only my marker. I could not read the turns' tool calls,
  because a message read is not on the allowed list.
- Then I stopped that server by PID, started a new one from the scratch environment (PID 1447873), and
  checked every later pane with a script that fails on a non-scratch `HOME` or the real `opencode` binary.
  Every later check passed. I discarded the `r5ob` results and repeated the run with `r5oc`.
- I saved this lesson as a memory note for later sessions.

**Lock root:** empty before my work. My live runs left 17 markers: one from the discarded `r5ob` run
(removed at once, before I repeated the run) and 16 more. Each held a title with one of my prefixes and a
directory under `/tmp/ao26r5`; none held an owner token or a lease. I removed them by exact name after I
stopped my processes. In the M-3 run I also removed the key directory `e61403fe...` by hand, as a step of the
test. The root is empty again and stays in place. No test run left a marker in the host root.

**Cleanup.** I stopped, by PID: 41 lifecycle workers of my runs (each with `AO_STATE_ROOT` under
`/tmp/ao26r5`), the two real TUI processes of the breach (1387963, 1394969), the tmux servers `ao26r5`
(1379182, then 1447873) and `ao26r5-late-r4` (1573112), and a `sleep` that I used as a lease squatter. The
other one-session servers had exited on their own. I stopped the isolated service with `opencode service
stop` in its own `XDG_*` environment; its PID 1332756 and port 49857 were gone afterwards, and the global
service 4171365 still runs. A final scan found no process with my scratch `HOME`, `XDG_DATA_HOME` or
`AO_STATE_ROOT`. I removed by exact path the 10 launch scripts `/tmp/ao-launch-*.sh` of my failed
`send-keys` runs (each named `/tmp/ao26r5`), my 7 socket files in `/tmp/tmux-44402/` (each answered "no
server running"), and `/tmp/ao26r5`. Evidence copies are in
`/tmp/claude-44402/-home-taisung--worktrees-agent-orchestrator-ao-26/afe366e3-37a4-4135-ae07-5b9ed70f3da5/scratchpad/r5/`.

**Left for the owner:** the two global OpenCode sessions of the breach, `ses_ebe4c58ecffexfEl81wt8iCk4y`
and `ses_ebe4c1ae5ffeUF3dHbjY63ravQ` (project of `/tmp/ao26r5/repo`, which no longer exists).
