# I-2 round 4 re-check: `0080cf87..ece9372e`

Reviewer: ao-26 (Claude Opus 5.5). Date: 2026-10-15. Reviewed commit: `ece9372e fix(core): recover
OpenCode launch markers from evidence` (author astra, ao-27). Whole increment: `49369f18..ece9372e`.

## Verdict: NOT-LAND-SAFE

Round 4 fixes B-1. It fixes M-1 for cases a to f, m-1 in the scope of the brief, m-2, m-3 and m-4. Every
mutant on the list is killed. Two new major findings stop the landing:

- **M-2.** Evidence rule 1 settles a marker with any session that has the exact title, the same directory
  and a later creation time. A create that the earlier pane did not make (a start from a `main` build of
  the same orchestrator, or a manual create) therefore counts as "earlier create finished" while the
  earlier pane's create is still in flight. The next launch then binds the earlier pane's late session. A
  purge in that fleet removes a live conversation of another fleet. I showed both steps live. The spec
  names this boundary. No operator line and no test does.
- **M-3.** The lock-timeout text tells the operator to `rm -r` the marker directory, also when a live
  process holds the lock. When the operator does this, the live holder fails with a raw `ENOENT`. If its
  discovery found its session, its catch destroys its own working pane. When the lease blocks, the same
  text names a directory that does not exist.

New findings: 0 B, 2 M (M-2, M-3), 3 m (m-5, m-6, m-7). Numbers continue from round 3.

Rule 1 is the rule that I proposed in round 3 (my M-1 list, item 1). The hole in M-2 is in my proposal,
not in the implementation. The implementation does what the brief asked.

## Status of the round-3 findings

| Finding | Status | Evidence on `ece9372e` |
| --- | --- | --- |
| B-1: a failed `runtime.create` blocks every later spawn | **Fixed** | One injected `new-session` failure: exit 1, 0.432 s, no marker left. The next two spawns: exit 0, 1.608 s and 1.619 s, `r4wk-2` and `r4wk-3`, each with its own ID. The same on `main` plus the increment (0.466 s, then `r4mp-2`, `r4mp-3`) |
| M-1: no recovery from evidence | **Fixed for cases a to f** | All six cases recover or refuse with a clear line (table in item 2). New gaps: M-2 (rule 1), M-3 (timeout text), m-5 (stall in a search), m-6 (marker without a handle) |
| m-1: ambient tmux negative counts as death | **Fixed in the scope of the brief** | Purge with the shim on a socket with no server: `kept ... (liveness could not be checked)`, 0.223 s. Residual, as round 3 planned: another tmux server that answers still counts as death (below) |
| m-2: a dead Herdr OpenCode session is never cleaned | **Fixed** | Scratch cleanup test: no ID, archived; unshared ID, archived and its ID removed; shared ID, kept with one line each |
| m-3: the lock root is not checked | **Fixed** | 0777 root, symlink root and a symlink to a 0700 directory of the same uid: all refused. One root for launchers with different `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR` and `AO_STATE_ROOT` |
| m-4: mutants G2, G5, G6 survive | **Fixed** | X1, X2, G1 to G6 and Sonnet E, G, I, K, L, M: all 14 killed, G4 too. Two of my 12 new mutants survive (m-7) |

## New findings

### M-2: evidence rule 1 accepts a create that the earlier pane did not make

**Files:** `packages/core/src/opencode-launch-lock.ts:248-264` (the comment at `:249-250` says "Exactly one
create and no retry in the pane script. A hit settles that attempt"); `docs/opencode-workflows-spec.md:55`
and `:57`.

The premise of rule 1 is: "since `startedAt` no other protocol launcher could create for this key". This
is true only when every creator of `AO:<session>` in that directory uses the protocol. A `main` build does
not use it. Its pane creates the same exact title in the same directory (`main`:
`packages/plugins/agent-opencode/src/index.ts:494-514`). Rule 1 cannot tell that session from the earlier
pane's session.

**Reproducer** (one isolated service, one private tmux server, one scratch repository, three state roots):

1. Fleet A (round-4 build) runs `ao start`. The front delays only its pane's create by 40 s. Result: exit 0,
   15.760 s, no mapping, a marker with the runtime handle and the socket.
2. Fleet Old (`main` build, same repository and prefix, own config and state) runs `ao start`. Result: exit
   0, 0.750 s. Its pane creates `ses_ebe9ff9a6ffeHeoB7bRlVjV9EG` with the title `AO:r4ob-orchestrator` in
   `/tmp/ao26r4/repo`.
3. At +28 s, fleet B (round-4 build) runs `ao start`. The front delays its own create by 25 s. Result:
   `ao: recovered the OpenCode launch marker for AO:r4ob-orchestrator in /tmp/ao26r4/repo: earlier create
   finished (ses_ebe9ff9a6ffeHeoB7bRlVjV9EG).`, exit 0, 14.099 s.
4. Fleet A's late create lands at +41 s as `ses_ebe9f9af5ffeNhbSstYwPlejuW`, and fleet A's TUI opens it.
   Fleet B stores `ses_ebe9f9af5ffeNhbSstYwPlejuW`. Fleet B's own pane runs `ses_ebe9f6ae7ffeE7xgwRpszXgXrp`.

A manual `opencode api session.create` with the same title and directory in place of step 2 gives the same
result (fleet B stored `ses_ebea6cedfffeOOqaWxwXCa9R6X`, fleet A's pane session). Then
`ao session kill r4mf-orchestrator --purge-session` in fleet B sent `session.interrupt` and `session.remove`
for fleet A's live session. `session.get` then answered `SessionNotFoundError`.

I forced the order of step 4 (fleet A's late create lands before fleet B's own create) with a front delay.
One slow service that serves the creates in order gives the same order without help.

**Cost:** a wrong binding, and then the loss of another fleet's live conversation by purge or cleanup.
This is the failure that the I-2 lock exists to stop. **Trigger:** an unresolved marker, one create of the
exact title in the same directory from outside the protocol, and a successor before the earlier create
lands. A pre-I-2 build on the same project and prefix is enough. This is the normal state while some
fleets still run `main`. The spec and the author report name the boundary ("All colliding launchers must
use the protocol; an older build or manual create can bypass it"). The recovery line does not.

**Clock step:** a backward step of the host clock can also make an older session with the same title
count. The `ignore` strategy makes one such session for each start. I did not change the host clock. This
follows from the code: the rule compares `time.created` with `startedAt` only.

**Fix options** (the brief keeps the pane command bytes unchanged):

1. Accept rule 1 only when the recorded pane is also gone on its recorded server (the rule-2 check without
   the age wait). Then a live earlier pane always keeps its marker. In this reproducer, fleet A's pane was
   live, so fleet B refuses. Case c still recovers after `ao stop`. A Herdr marker then has only the
   manual path.
2. Or record the decision that no pre-I-2 build may start OpenCode on a project and prefix that a round-4
   build also uses. Put the boundary in the recovery line.
3. Later: the pane writes its create result into the marker directory. Then a title search is not
   evidence.

### M-3: the lock-timeout text tells the operator to remove a live holder's marker

**Files:** `packages/core/src/opencode-launch-lock.ts:206` (the hint), `:216-219` (the timeout),
`:316-319` (`complete`), `:356-366` (`release`); `packages/core/src/session-manager.ts:1797-1846` (the
orchestrator post-launch `try`, `catch` and `finally`) and the worker block at `:1363-1430`.

The waiter knows that the blocker is live: it waits only while `definitelyDead(<owner pid>)` is false. The
timeout text still says "After stopping and settling the earlier pane and any in-flight create request,
run `rm -r -- '<lockPath>'`". It gives no PID. It does not say that a live process holds the lock.

**Reproducer:**

1. Fleet A runs `ao start`. I SIGSTOP the launcher right after its first discovery search. Its pane's
   create lands 4 s later.
2. Fleet B runs `ao start`. It prints one wait line, then exits 1 after 30.368 s: `Timed out waiting for
   the OpenCode launch lock ... no pane was launched. After stopping and settling ... run
   rm -r -- '/tmp/ao-opencode-launch-44402/b67d1db9...'`.
3. I run that exact command, then SIGCONT fleet A.
4. Fleet A exits 1: `Failed to setup orchestrator: ENOENT: no such file or directory, unlink
   '.../530443-9877e3ce-....owner'`. Its discovery found the session. `complete()` threw `ENOENT` on
   `pending.json`. The `catch` destroyed the working pane and removed the record. The `release()` error in
   `finally` replaced the first error. No tmux session and no record were left. The OpenCode session stays
   in the store with no mapping.

When discovery does not find the session, the `try` ends normally and only the `finally` throws. Then
`ao start` exits 1 although the pane and the record exist.

When the lease (`<lockPath>.lease`) blocks, the same text names `<lockPath>`, which then does not exist. A
stopped holder or a dead holder whose PID is reused makes this case. I put a token of a live unrelated PID
in a lease. The timeout text named `.../21d9bc3a...`. The root held only `21d9bc3a....lease`. The printed
command has no effect.

A Ctrl-Z on an `ao start` in a terminal makes the stopped-holder case. In my runs, a queue of healthy
launchers stayed inside the bound: three starts of one orchestrator with a hanging API ended in 15.764 s
(exit 0), 25.193 s and 30.422 s (both exit 1, "unresolved"). A healthy holder can pass 30 s only in a
corner case: an evidence search of up to 10 s, then a discovery whose last search completes at the
deadline and so gets one more full 10 s search.

**Fix:** for a live owner, print its PID and "wait, or stop PID <n> first", and no `rm` command. Name the
lease path when the lease blocks. Let `complete()` and `release()` accept `ENOENT` (the marker is already
gone), so that a removed marker can never destroy a good pane. Do not let a `finally` error replace the
first error.

### m-5: a stall during an in-flight search still loses the mapping

**File:** `packages/core/src/opencode-api.ts:409-431` (`waitForOpenCodeSession`).

The round-4 final search runs only when the deadline passes during a pause or after a completed search.
When the stall covers a search, Node runs the overdue `execFile` timer before it reads the finished child.
The callback then gets `err = null` and `stdout = ""`. I measured this with a 0.3 s child, a 2 s timeout
and a 4 s SIGSTOP: `{"ms":4060,"err":null,"stdout":""}`. Without the stop: `"payload\n"` after 312 ms.
The helper reports "returned empty output with exit 0", the search counts as failed, and the loop stops.

**Reproducer:** SIGSTOP fleet A's start for 20 s during its first search. Its pane's create lands during the
stop. Fleet A: exit 0, no mapping, `Last search error: opencode api session.list returned empty output with
exit 0`. No search ran after SIGCONT. Fleet B then recovered the marker by rule 1 (21.395 s) and stored its
own ID. When the stop fell in a pause instead, fleet A stored its own ID. So the fix covers only the stalls
that fall in a pause.

**Cost:** a missing mapping with a clear remap line. No wrong binding. **Fix:** when the clock is past the
deadline by more than the search bound, or when a search returns empty output with exit 0 after its own
timeout passed, make the one final search.

### m-6: an uncertain runtime failure leaves a marker that only `rm -r` can clear

**Files:** `packages/core/src/session-manager.ts:1318-1340` (worker), `:1766-1773` (orchestrator);
`packages/core/src/opencode-launch-lock.ts:141-149`.

On a `send-keys` failure, `runtime-tmux` kills the session that it made and throws. Core keeps the marker.
That is correct. But core records no runtime handle, so rule 2 can never apply. The failure output says
nothing about the marker.

- Orchestrator: the start exits 1 in 0.444 s with only the runtime error. A start 26 s later: exit 1,
  0.611 s, "unresolved". Only the printed `rm -r` cleared it (then exit 0, 1.584 s).
- Worker: exit 1, 0.499 s. The record is archived with `status=killed`. The next spawn got `r4wk-5`
  (correct). `ao session ls` does not show `r4wk-4`. `ao session cleanup` says "No sessions to clean up".
  `ao session restore r4wk-4` refuses in 0.339 s with a remap hint. The marker directory `e11d5071...` stays
  in the host root with no reader until the host clears `/tmp`.

**Fix:** in the `catch`, record the known handle (`{ id: tmuxName ?? sessionId, runtimeName }`) and the
socket, so that rule 2 settles the marker after 25 s. Print one line that names the marker.

### m-7: two lock properties have no test

- N7: `statSync` in place of `lstatSync` for the root passes all 279 tests of the set. The symlink test
  points at a 0755 directory, so the mode check refuses it. The real code refuses a symlink to a 0700
  directory of the same uid (I checked this with the built module).
- N9: no 3 s grace in `reclaimEmpty` passes all tests. The grace protects a round-3 launcher between its
  `mkdir` and its owner write.

## Item 1: B-1

| Step | Result |
| --- | --- |
| One injected `new-session` failure | exit 1, 0.432 s: `Command failed: tmux new-session -d -s fc834030f416-r4wk-2 ...`; the lock root has no marker |
| The next two spawns | exit 0, 1.608 s (`r4wk-2`, number used again) and 1.619 s (`r4wk-3`); each stores the ID that its pane opened |
| One injected `send-keys` failure (uncertain) | exit 1, 0.499 s; marker kept without a handle; archive `r4wk-4_...` with `status=killed`; the next spawn gets `r4wk-5` (m-6) |
| Orchestrator `send-keys` failure | exit 1, 0.444 s; 26 s later the start refuses; only `rm -r` clears it (m-6) |
| `main` plus the increment, one `new-session` failure | exit 1, 0.466 s; the next spawns get `r4mp-2` and `r4mp-3`; 3 IDs stored; no marker |

**`failedBeforeCommandDelivery()`** (`session-manager.ts:113-125`):

- tmux: on this branch and on `main` (`9f06dc25`), `new-session` runs through `execFile("tmux", args)`.
  Node sets `err.cmd = "tmux new-session ..."` for every error, also for `ENOENT` and a timeout. The
  `main` PATH fix changes only the `env` option, not `cmd`. The later calls are `send-keys` (wrapped as
  "Failed to send launch command", no `cmd`) and `kill-session` (errors swallowed). No later call can
  match. A `new-session` that times out after tmux made the session leaves a shell but no agent command,
  so the cancel is still correct.
- Herdr: `herdr error ` comes from `parseHerdrResult` for every call. In `create`, the only call before
  `pane run` is `workspace create`. A `pane run` error is wrapped as "Failed to launch agent in herdr pane"
  (`runtime-herdr/src/index.ts:287-300`), and `workspace close` errors are swallowed. So the three Herdr
  matches can come only from `workspace create`.
- A worker archived as `killed`: see m-6 for what the operator sees. Cleanup does not touch it, and that is
  correct, because its runtime is gone and its number must stay used.

## Item 2: M-1

**Cases a to f** (round-4 build, one isolated service, the real pane script with the TUI replaced):

| Case | Result and operator line |
| --- | --- |
| a. All API calls hang during a start; stop; start | Start: exit 0, 15.731 s, one line with the remap command and the `rm -r` command; the marker holds the handle and `tmuxSocket` `/tmp/tmux-44402/ao26r4`. A start at once after the stop: exit 1, 0.462 s, "unresolved". After 25 s: exit 0, 1.671 s, `recovered ...: earlier pane is gone and its create window has elapsed.` (one `tmux -S /tmp/tmux-44402/ao26r4 has-session -t =...`) |
| b. The pane's create fails | Start: exit 0, 15.780 s, no mapping. A start of another fleet while the pane lives: exit 1, 0.540 s, "unresolved". After `ao stop`: exit 0, 1.727 s, "earlier pane is gone" |
| c. SIGINT during discovery; remap; stop; start | SIGINT exit 130; the delayed create landed. `ao session remap`: exit 0, 0.350 s. After stop: exit 0, 1.721 s, `earlier create finished (ses_ebeab0facffe...)`; a new own ID |
| d. SIGSTOP during discovery while another fleet starts | The other fleet: one wait line, then `earlier create finished`, its own ID, 21.395 s. A stop in a pause: the stopped start stores its own ID (round-4 fix works). A stop in a search: no mapping (m-5) |
| e. Remove only `pending.json` | Next start: exit 0, 4.174 s, a wait line, then `reclaimed an empty OpenCode launch lock ...` |
| f. The holder is frozen | The waiter: exit 1, 30.368 s, `Timed out waiting ...; no pane was launched` with the `rm -r` hint. Following that hint destroys the holder's pane (M-3) |

**Rule 1** (title, directory, `time.created >= startedAt`): broken by a `main`-build start and by a manual
create (M-2). A clock step back has the same effect in theory (M-2).

**Rule 2** (recorded socket, `can't find session:`, age at least 25 s):

- A pane killed after it sent its create: I stopped the isolated service, started a create, killed the
  client after 3 s, and continued the service. No session appeared. A service that already read the
  request and then stalls for 24 s or more can still land it. I could not make that stall.
- Socket path reuse: a new server on the same path answers for its own sessions only. The same session
  name gives "live" and a refusal. No such name gives "gone", and that is correct, because the old server
  and its pane died. Only a live old server whose socket file was removed can give a false "gone". That
  needs the socket file to be deleted.
- A marker without a socket (round-3 marker, a failed `display-message`, Herdr): no rule-2 evidence; the
  unit tests "legacy" and "herdr" pin this.

**The lease:** two starts that recover one marker at once: one prints `recovered ...` (1.708 s); the other
prints a wait line and launches after it (2.917 s). Each stores its own ID. A stopped holder makes the
others wait up to 30 s and then refuse with no pane; the text is wrong (M-3). A dead lease holder is
reaped; a reused PID blocks until the PID ends (M-3).

**The 3 s reclaim:** `rmdir` cannot remove a directory that holds an owner token. Every round-4 participant
holds the lease while it touches the key directory. Only a round-3 launcher can be between `mkdir` and its
owner write without the lease. If that launcher stops there for more than 3 s, its owner write fails with
`ENOENT` and it throws before any pane (`0080cf87` `opencode-launch-lock.ts:91-98`). So the reclaim cannot
take a live participant's directory in a way that launches two panes.

## Item 3: m-1 to m-4

**m-1:** purge with the shim on `-L ao26r4-none` (no server): `ao: kept OpenCode session
ses_ebea50b40ffe... of r4m1-2: session r4m1-1 may still use it (liveness could not be checked).`, 0.223 s.
**Residual:** with the shim on `-L ao26r4-other` (a running server without the session), the purge of
`r4m1-4` sent interrupt and remove for `ses_ebea4fe8effe...`, the ID of the live holder `r4m1-3`. The brief
allows this ("Only `can't find session` from a server that answers counts as a negative"), and round 3
planned the socket in the handle for later (a `runtime-tmux` change). The marker now records the socket,
but the holder guard cannot use it, because the session record does not store it.

**m-2:** scratch tests in a copy, cleanup with a dead runtime and `runtimeName: "herdr"`:

| Record | Result |
| --- | --- |
| No stored ID | `killed=["app-1"]`; no API removal |
| Unshared stored ID | `killed=["app-1"]`; its ID removed |
| ID shared by two active Herdr records | both kept: `ao: kept app-1: session app-1 may still use it (liveness could not be checked).` |

**m-3:** a 0777 root, a symlink root and a symlink to an own 0700 directory: all refused with `Unsafe
OpenCode launch lock root ...: expected a real directory owned by uid 44402 with mode 0700.` Two launchers
with different `HOME`, `TMPDIR`, `XDG_RUNTIME_DIR` (one set, one unset) and `AO_STATE_ROOT` used the same
key directory: the second waited and timed out while the first held it. **Cost:** another local user who
makes `/tmp/ao-opencode-launch-44402` first blocks every OpenCode launch of this user. The message is
clear, but the victim cannot remove the directory (sticky `/tmp`) and there is no override. On a personal,
single-user host this is acceptable. The fixed root is host-local, and that is correct for the PID checks.

**m-4: mutants** (scratch copy of `ece9372e`; set: `opencode-api`, `opencode-launch-lock`, the
`session-manager/` directory and `session-manager.test.ts`; baseline 279 of 279 pass):

| Mutant | Failing tests | Killing test |
| --- | --- | --- |
| E: top-level `interrupted` read as false | 1 | `reads the top-level shape that 2.0.29 answers` |
| G: no list `limit` | 3 | the page-size, paging and cap tests |
| I: remove before interrupt | 2 | `purges mapped OpenCode session when requested`, bounded purge |
| K: unmapped purge searches by title | 1 | `does not search by title on purge when no ID is stored (Q7)` |
| L: reuse after a failed `session.get` | 1 | `does not reuse a stored ID that session.get cannot check (M-2 L)` |
| M: gone orchestrator ID replaced by title | 1 | `does not replace a gone stored orchestrator ID with a title match (M-2 M)` |
| X1: launch time taken before the lock | 2 | the worker and orchestrator overlap tests |
| X2: no `realpath` in the key | 1 | `serializes aliases of a real directory until completion and release` |
| G1: skip terminal statuses | 18 | `keeps a live merged holder during purge and archived cleanup` and 17 more |
| G2: Herdr negative goes on to the agent | 1 | `keeps a Herdr holder after a negative runtime check ...` |
| G3: the 2 s timeout counts as dead | 1 | `keeps a merged holder with hang` |
| G4: no exit-code test | 1 | the unexpected-exit-code case |
| G5: no stderr counts as a negative | 1 | `removes the shared ID after tmux explicitly answers that the holder is gone` |
| G6: cleanup never kills a dead OpenCode session | 2 | `archives a dead Herdr OpenCode session with an unmapped ID` / `unshared ID` |
| N1: rule 1 without `createdAtOrAfter` | 1 | `does not settle a marker using a old decoy` |
| N2: rule 2 without the age | 1 | `... death evidence: too young` |
| N3: any `has-session` failure counts as gone | 1 | `... death evidence: unreachable` |
| N4: every runtime failure cancels the marker | 1 | `allows the next worker after a unknown runtime failure` |
| N5: no runtime failure cancels the marker | 2 | the two "before delivery" cases |
| N6: no root mode check | 1 | `refuses a writable lock root` |
| N7: `stat` in place of `lstat` for the root | **0** | none (m-7) |
| N8: no final search | 2 | the two suspension tests |
| N9: no 3 s grace | **0** | none (m-7) |
| N10: a failed uncertain worker frees its number | 2 | the "unknown" and "post-launch" cases |
| N11: no `recordRuntime` | 1 | `recovers a pane never created marker on a fresh orchestrator start` |
| N12: no lease | 1 | `recovers a completed create once while concurrent successors serialize` |

## Item 4: no regressions

| Check | Result |
| --- | --- |
| sol-6-1 overlapping start (two fleets at the same instant, `ignore`) | A: exit 0, 1.475 s; B: exit 0, 2.642 s; each stores the ID that its own pane opened |
| 10 worker spawns | 10 of 10 mapped at return, each equal to its pane's ID; 1.512 to 1.644 s |
| Live `merged` holder, purge | `ao: kept OpenCode session ses_ebe92666affe... of r4ten-2: live session r4ten-1 uses it.`; no remove |
| Live `merged` holder, archived remap | exit 1, 0.413 s: `Cannot remap r4ten-5 to OpenCode session ses_ebe924d62ffe...: live session r4ten-4 uses it.` |
| Live `merged` holder, cleanup | exit 0, 0.911 s; `ao: kept OpenCode session ses_ebe924d62ffe... of r4ten-5: live session r4ten-4 uses it.`; the ID still answers |
| Restore with OpenCode 1.18.35 | exit 1, 0.312 s: `ao needs OpenCode 2.0.29 or later (found opencode v1.18.35)` |
| Restore with a removed ID | exit 1, 0.444 s: `the stored OpenCode session ses_ebe9259e3ffe... is gone (session.get answered 404)` |
| Restore with no stored ID | exit 1, 0.339 s, remap hint |

**Bounded time with a hanging API:**

| Operation | Exit / time |
| --- | --- |
| Fresh worker spawn | 0 / 15.820 s, one unmapped line, marker |
| Fresh orchestrator start | 0 / 15.806 s, the same |
| Restore with a stored ID, runtime gone | 1 / 10.326 s, one bounded `session.get` |
| `kill --purge-session` | 0 / 20.296 s, one interrupt, one remove, one warning |
| Three starts of one orchestrator at once | 0 / 15.764 s; 1 / 25.193 s; 1 / 30.422 s ("unresolved", no pane) |
| A start that waits for a frozen holder | 1 / 30.368 s |

## Item 5: tests

All runs used `env -i`, an empty fake `HOME` under `/tmp`, no `AO_*` variable, and a `tmux` shim with
`-L ao26r4t`. The present runs used the front to my isolated store.

| Command | Result |
| --- | --- |
| `pnpm install`, `pnpm build` | exit 0, exit 0 |
| `pnpm --filter @aoagents/ao-core test` | Test Files 33 passed (33); Tests 733 passed (733) |
| `pnpm --filter @aoagents/ao-core typecheck` | exit 0 |
| `pnpm --filter @aoagents/ao-plugin-agent-opencode test` | Test Files 1 passed (1); Tests 160 passed (160) |
| `pnpm --filter @aoagents/ao-plugin-agent-opencode typecheck` | exit 0 |
| integration, opencode hidden | Test Files 10 passed, 3 skipped (13); Tests 95 passed, 24 skipped (119) |
| integration, opencode present | Test Files 10 passed, 3 skipped (13); Tests 95 passed, 24 skipped (119) |
| `pnpm lint` | 0 errors, 5 warnings (the known ones) |
| `pnpm typecheck` | exit 0 |
| full `pnpm test` | exit 0; core 733, Gemini 56, Claude Code 154, Codex 215, desktop 26, Herdr 36, GitHub SCM 140 + 5 skipped, GitHub tracker 42, worktree 46, tmux 26, OpenCode 160, integration 95 + 24 skipped, CLI 243 |

**New tests on the `0080cf87` sources:** with the four round-4 test files on the round-3 sources, 23 of 189
tests fail. They are the B-1 retry cases, the m-2 cleanup cases, the m-1 "no server running" and "error
connecting" cases, both suspension tests, all six rule-2 cases, the concurrent recovery, the ownerless
reclaim, the late-result recovery and both root refusals. The new tests that pass there are the three decoy
refusals (round 3 refuses every marker) and the Herdr and explicit-negative cases, which pin behaviour that
round 3 already had and that mutants G2 and G5 now break.

The test runs left the host lock root unchanged.

## Item 6: scope

`ece9372e` changes 8 files: `docs/opencode-workflows-spec.md`, `opencode-api.ts` and its test,
`opencode-launch-lock.ts` and its test, `session-manager.ts`, `__tests__/session-manager/lifecycle.test.ts`
and `spawn.test.ts`. All are in the allowed list of the author brief, section 4. The message is
`fix(core): recover OpenCode launch markers from evidence` with two WHY paragraphs, no `Co-Authored-By`, no
emoji and no issue number. `git branch -r --contains ece9372e` prints nothing.

## Item 7: landing

```text
$ git -C /home/taisung/local/agent-orchestrator diff --stat 49369f18 main -- packages/core/src/session-manager.ts packages/core/src/index.ts packages/core/src/opencode-api.ts
 packages/core/src/index.ts | 3 +++
 1 file changed, 3 insertions(+)
```

`main` adds three exports (`removeAoBinFromPath`, `GH_WRAPPER`, `GIT_WRAPPER`) in another export block.
The only file that both `main` and the increment change is `index.ts`. `git apply --check` of
`49369f18..ece9372e` on an export of `main` is clean. In that scratch export (not a cherry-pick), the
build passes, `pnpm typecheck` passes, and the tests pass: core 787, OpenCode 160, tmux 30, Claude Code
167. The B-1 run on that build gives the same result as on the branch.

The `main` change in `runtime-tmux` (`5884f9ad..9f06dc25`) runs `new-session` with `env.PATH` set to the
pane PATH. It does not change `err.cmd`, and `display-message` and `has-session` keep the same server
because `TMUX` and `TMUX_TMPDIR` stay in that environment. So a cherry-pick of `49369f18..ece9372e` onto
`main` cannot change the reviewed behaviour. I did not cherry-pick.

## What I found correct

- The B-1 split: a known pre-delivery failure cancels the marker; any other failure keeps it and keeps
  the worker number. The `cmd` and Herdr prefixes match only pre-delivery calls, on the branch and on
  `main`.
- Rule 2 needs both the age and an explicit `can't find session:` from the recorded socket. An
  unreachable server, a missing socket and Herdr stay unknown. Time alone never clears a marker.
- The lease: a populated directory published by `rename`, a dead-owner reap that removes only the seen
  token, and no `rmdir` retry after `ENOENT`. Two recoverers never launch together.
- The fixed root with `lstat`, uid and mode checks, the same for every environment of the uid.
- The operator lines for waits, recoveries and refusals name the title, the real directory and the key
  directory.
- The holder guard keeps an ID on every uncertain answer, and the cleanup guard runs only for a shared
  ID. A dead unshared Herdr session is archived.
- All bounds hold: no command in my runs went past 30.5 s with a hanging API.
- The tests kill every listed mutant and 10 of my 12 new ones.

## Method, isolation and cleanup

- Builds: this worktree (`pnpm install`, `pnpm build`); scratch exports of `0080cf87`, `main`, and `main`
  plus the increment; a scratch copy of `ece9372e` for the mutants and the m-2 scratch tests.
- One isolated OpenCode 2.0.29 service (PID 487040, port 49827, the four `XDG_*` directories under
  `/tmp/ao26r4/iso`); before the first write, its `server.info` PID was not the global PID 4171365. The
  global service got one `server.info` read. No model turn, no credential, no `service.json` read.
- A front `opencode` that forwards `--version`, `api` and `session` to the isolated store and replaces the
  TUI with `sleep`. Private tmux servers only (`-L ao26r4`, `ao26r4-other`, `ao26r4t`; `ao26r4-none` had
  no server). A `gh` stub that answers only `--version` and `auth status`.
- Live `ao` runs: `HOME` and `AO_STATE_ROOT` under `/tmp/ao26r4`, scratch configs, a scratch repository
  with a bare origin.
- Lock root: before my work it was empty. After my work it held only four markers from my runs
  (`30b91020...`, `85c0ef86...`, `d54d87e9...`, `e11d5071...`). I removed them by exact name after I
  stopped my processes. The root is empty again.
