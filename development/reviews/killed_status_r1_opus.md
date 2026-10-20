# Stale `killed` status of live sessions: investigation r1 (ao-46, Opus 5.5)

- Date: 2026-10-20. Base: `main` `654b3d28`. Worktree:
  `/home/taisung/.worktrees/agent-orchestrator/ao-46`, branch
  `feat/killed-race-read-agent-task-md-in-your-worktree-and-execute`.
- Commit: `20b25e52` (two new test files only; this file is not committed).
- Scope: investigation only. No source file changed. No `ao` command against the real config or the
  real state root. Every live run used a scratch config, the scratch state root `/tmp/ao46kr/state`, a
  fake `HOME` and private tmux servers `-L ao46kr-A` / `-L ao46kr-B`.

## 0. Short answers

| Question | Answer |
| --- | --- |
| Q1 | The real lifecycle worker **271579**, on its **first poll**, wrote `status=killed` at 15:19:56.246Z through `checkSession` (`lifecycle-manager.ts:1195`). `determineStatus` returned `killed` at **`lifecycle-manager.ts:417`**: the runtime was alive (`has-session` exit 0), but the claude-code plugin reported `exited` because no `claude` process was on the pane TTY yet (`agent-claude-code/src/index.ts:843-844`). The `claude` process started at 11:19:57.09, 0.85 s after the write. Reproduced in scratch with a stub `claude` that starts 1 s or 3 s late; not with 0 s. F1b (agent-skills, worker 321413) is the same mechanism. Mechanism **M1**. |
| Q2 | No path moves `killed` back. `pollAll` skips a record whose status is terminal unless the in-memory tracked state differs (`lifecycle-manager.ts:1305-1309`), and even when it is checked, `determineStatus` falls back to the current status (`:561-569`). Only a later spawn write that replaces `status` restores a session (mechanism **M2**). Sessions that "returned to `working`" (F4) were hit by **M3**: the poll wrote `killed` into the still-empty reserved record, and the spawn's own full write replaced it a few ms later. Sessions that "stayed `killed`" were hit by M1, or by M3 when the poll's merge landed after the spawn's write. |
| Q3 | Only a lifecycle worker writes `killed`, and only for sessions that it already tracks (or that it sees for the first time with a live runtime and an `exited` agent). F3 was written by the real worker **3216178** for 7 sessions in one poll (18:56:51.268Z-.293Z), and by the agent-skills worker **3215891** for 7 sessions in one poll (18:57:03.827Z-.864Z): a host-wide probe outage of at least 12.5 s, for claude-code, codex and OpenCode sessions. Reproduced in scratch: hiding the tmux socket for 5 s, or making `ps` fail for 5 s, makes a long-running worker persist `killed` for every live session, and the record stays `killed` after the outage. Mechanism **M4**. A worker or command whose tmux calls go to *another* server does **not** write `killed`: `ao status`, `ao session ls` and a fresh worker write nothing; `ao send` relaunches the session on the other server; `ao session cleanup` archives the live session and removes its worktree; `ao spawn` and `ao start` start new panes and a worker on the other server. |
| Q4 | F1, F1b and F2 are M1. F4 is M1 and M3 (both measured live). F5 is M3 (from code: the reserved record holds only the launch keys during the OpenCode version probe; not run, because no `opencode` call is allowed). F3 is a different trigger (M4: a transient probe outage in a long-running worker). All four share the same persistence step (`lifecycle-manager.ts:1195`) and the same sink (M2). |
| Q5 | Write `status=working` into the two real orchestrator records with a one-key merge (temp file plus rename), after a read-only check that the pane runs `claude`. Do not use the agents' metadata helper (it accepts only `pr_open`). Do not use core `send` on these sessions before the correction: it restores, and the restore destroys the live pane (`session-manager.ts:2801-2822`, `:3419-3423`). After the recommended fix (M2 part), the next poll corrects such records without a manual write. Details in section 6. |

## 1. The four mechanisms

All `killed` writes for live sessions go through one line: `checkSession` persists the result of
`determineStatus` when it differs from the old status (`lifecycle-manager.ts:1195`,
`updateSessionMetadata(session, { status: newStatus })`, a read-merge-write through `updateMetadata`,
`metadata.ts:170-195`). `list()` and `get()` set `killed` only in memory
(`session-manager.ts:1237-1251`); they never persist it. No other writer writes `killed` into an active
record (the `:3360` line is a copy-back writer in `restore()`, see section 9).

- **M1, first poll before the agent process is visible.** `determineStatus` step 2 maps the agent's
  `exited` to `killed` with no grace for a just-launched session (`lifecycle-manager.ts:415-417`). The
  claude-code plugin returns `exited` when no process matching `/(?:^|\/)claude(?:\s|$)/` is on the pane
  TTY (`agent-claude-code/src/index.ts:843-844`, `:546`, `:567-593`). The tmux runtime sends the launch
  command with `send-keys` into a login shell (`runtime-tmux/src/index.ts:80-97`), so the agent process
  appears only after the shell startup. On this host that takes about 1.0-1.1 s (bash login with nvm).
  `ao start` starts the worker first (`start.ts:891`) and spawns the orchestrator after
  (`start.ts:950`); the parent writes the worker PID at once (`lifecycle-service.ts:203-205`), so
  `waitForLifecycleWorker` returns at once, and the worker's first poll runs about 0.1-0.3 s after the
  record is complete (`lifecycle-worker.ts:116`, `:137`; `lifecycle-manager.ts` `start()` polls
  immediately). So every `ao start` that starts a fresh worker hits the window.
- **M3, poll of a record that has no runtime handle yet.** A spawn first reserves the record: empty
  (`reserveSessionId` without `initial`, worker spawn and project-mode orchestrator spawn,
  `session-manager.ts:1014`, `:1077`, `:1826`) or holding only the launch-claim keys (prepared agents,
  OpenCode). It writes `tmuxName` and `runtimeHandle` only after `runtime.create`
  (`session-manager.ts:1636`, `:2119`). A poll that reads the record in that window gets a handle made
  from the session ID (`ensureHandleAndEnrich`, `session-manager.ts:1192-1197`, `id: sessionName`, not the
  tmux name `<hash>-<id>`). The enrichment does not trust such a handle (`handleFromMetadata` false,
  `session-manager.ts:1233-1237`), but `determineStatus` does not know that it is made up: it probes it
  (`lifecycle-manager.ts:385-391`), `tmux has-session -t kr-2` exits 1, and it returns `killed`. The merge
  then lands either in the empty record (the spawn's `writeMetadata` replaces it: the session returns to
  `working`) or, when the spawn wrote first, in the full record (the session stays `killed`).
- **M2, the sink.** A persisted `killed` is never re-evaluated: `pollAll` drops it
  (`lifecycle-manager.ts:1305-1309`) once the worker tracks `killed` or when a new worker starts (tracked
  undefined); if it is checked, `determineStatus` returns `session.status` (`:561-569`). `isRestorable()`
  treats it as terminal (`types.ts:140-146`), so core `send` restores it (`session-manager.ts:2816`), and
  the restore destroys the live pane first (`session-manager.ts:3419-3423`).
- **M4, one poll in which every probe fails.** A long-running worker tracks its sessions as `working`.
  When the probes fail for one poll, `determineStatus` returns `killed` for each of them and
  `checkSession` persists it, all in one `Promise.allSettled` (`lifecycle-manager.ts:1316`). The probes
  answer "dead" on errors: runtime-tmux `isAlive` returns `false` for any tmux error, also "no server
  running" and a timeout (`runtime-tmux/src/index.ts:175-182`); claude-code returns "no process" when
  `ps` fails (`agent-claude-code/src/index.ts:532-541`, `:581-582`, `:614-615`), which gives `exited`
  and line 417. The core already treats a *rejected* `isAlive` as alive (`lifecycle-manager.ts:389`,
  `.catch(() => true)`), but the plugins never reject.

## 2. Q1: evidence

### 2.1 Real events (read-only)

Clock anchor: `/proc/<pid>/stat` start times (10 ms) are 0.12 s early on this host. Two anchors agree:
the default tmux socket was created at 11:19:56.052 (`ls --time-style=full-iso`), and the tmux server
271595 and the first pane shell 271596 start at 11:19:55.930 in `/proc`; the parent `ao start` wrote the
worker PID file at 11:19:55.977 (directory mtime), and the worker 271579 starts at 11:19:55.850 in `/proc`.
The times below are corrected by +0.12 s where marked "proc".

F1, project agent-orchestrator:

| Time (EDT) | Event | Source |
| --- | --- | --- |
| 11:19:55.97 | worker 271579 forked by `ao start` | proc; base dir mtime 55.977 |
| 11:19:56.027 | old record archived | archive name and mtime |
| 11:19:56.028 | prompt file written (after the reserve) | `orchestrator-prompt-ao-orchestrator.md` mtime |
| 11:19:56.05 | tmux server and pane shell start (`new-session`) | socket ctime; proc |
| 11:19:56.073 | launched record written, `status=working` | `createdAt`, handle `data.createdAt` |
| 11:19:56.156 | worker writes its own PID file, then `lifecycle.start` polls | `lifecycle-worker.pid` mtime |
| 11:19:56.244 | record written with `status=killed` | record mtime; dir mtime |
| 11:19:56.246 | trace `lifecycle.transition` `ao-orchestrator` `working -> killed` | `60756641ca25-observability/processes/lifecycle-manager-271579.json` |
| 11:19:57.09 | `claude` process 271799 starts in the pane | proc |

F1b, project agent-skills (same pattern): archive and prompt file 11:25:31.142, `createdAt` .166,
worker 321413 PID file 11:25:31.328, `killed` write 11:25:31.415 (record and sessions dir mtime), pane
shell 321437 at 11:25:31.15 (proc), `claude` 322109 at 11:25:32.27 (proc). In both projects the
`killed` write comes 87-88 ms after the worker's own PID write, and before `claude` starts.

The record form also matches M1: `status=killed` stays at key position 3 (an in-place merge into the
launched record), and `prAutoDetect=off` is the last key (appended by the repair-on-read of the worker's
`list()`, `session-manager.ts:600-630`, which also resets the mtime, `:574-597`). The sessions directory
mtime of agent-skills (11:25:31.415) shows that no atomic write in that directory came after the
`killed` write.

### 2.2 Scratch reproduction (`repro_q1.sh`)

`ao start kr` (project mode, claude-code stub) on private server A; a 2 ms watcher on the record; `strace
-f -e trace=rename[,execve]` on the `ao` process tree. The temp file name of each atomic write carries the
writer PID and `Date.now()` (`atomic-write.ts:8`).

| Stub delay | Record versions (watcher) | Writer of `killed` | Stub visible as `claude` | Result after 40 s |
| --- | --- | --- | --- | --- |
| 3 s (`d3`) | 09.561 empty; 09.608 `working` (pid 565468 = `ao start`); 09.733 `+prAutoDetect` (worker, mtime reset to 09.607); 09.838 `killed` | worker 565501 | 12.685 | `killed` |
| 1 s (`d1`) | 02.403 empty; 02.452 `working`; 02.576 `+prAutoDetect`; 02.676 `killed` | worker 611421 | 03.558 | `killed` |
| 0 s (`d0`) | 21.435 `working`; 21.585 `+prAutoDetect` | none | 21.557 | `working` |
| 1 s (`d1x`, execve) | 49.475 `working`; 49.606 `+prAutoDetect`; 49.697 `killed` | worker 629965 | 50.6 | `killed` |
| 1 s (`final`, execve, the script as pasted below, 12:04) | 16.954 empty; 17.002 `working` (pid 1081353 = `ao start`); 17.150 `+prAutoDetect`; 17.248 `killed` | worker 1081365 | 18.119 | `killed` |

The `d1x` exec trace of the worker between the two writes (exit codes from `strace`):

```
11:42:49.609 tmux has-session -t 0e28352127dc-kr-orchestrator   exit 0   (list() enrichment: isAlive true)
11:42:49.621 tmux list-panes  -t 0e28352127dc-kr-orchestrator   exit 0   (claude-code isProcessRunning)
11:42:49.631 ps -eo pid,tty,args                                exit 0   (no claude on the TTY -> exited)
11:42:49.676 tmux has-session -t 0e28352127dc-kr-orchestrator   exit 0   (determineStatus :389 alive)
11:42:49.686 tmux list-panes  -t 0e28352127dc-kr-orchestrator   exit 0   (getActivityState -> exited -> :417)
11:42:49.697 rename kr-orchestrator.tmp.629965.1792510969696 -> kr-orchestrator
```

No `capture-pane` runs (the terminal-output path `:435-437` is not used), and `has-session` succeeds
(so not `:390`). The scratch observability file has the same trace as the real one:
`{"operation":"lifecycle.transition","sessionId":"kr-orchestrator","data":{"oldStatus":"working","newStatus":"killed"}}`
at 15:42:49.697Z. The second poll (30 s later) skips the record (`:1305-1309`). The `final` run shows
this in its exec trace: at 12:04:47.159 the second poll runs only the `list()` probes (`has-session`
exit 0, `list-panes` exit 0, `ps` exit 0, and now `claude` is on the TTY), then no `determineStatus`
probe and no write follow; the record stays `killed`.

## 3. Q2: is there a path back?

- The skip: `lifecycle-manager.ts:1305-1309`. A worker that wrote `killed` tracks `killed`, so the record
  is skipped. A new worker has no tracked state and skips every terminal record. The enrichment can only
  move a status *to* `killed` (`session-manager.ts:1237-1246`).
- The fallback: if a `killed` record is checked (tracked state differs), `determineStatus` returns
  `session.status` (`:569`), so `killed` again, unless a PR state or `needs_input` applies.
- Recovery happens only when another writer replaces `status`: the spawn's `writeMetadata` (worker
  spawn `:1636`, orchestrator `:2119`), `restore()` (`status=spawning`, after it destroys the live pane),
  `claimPR` (`pr_open`), or a hook that writes `pr_open`. Then the next poll moves the record on
  (for example `spawning -> working` at `:562-567`).
- Measured (`repro_m3.sh`, worker polls every 100 ms, four `ao spawn`, `strace` on the worker):

```
kr-1  27.514 empty | 27.555 status=killed keys=[status] | 27.581 spawning (full) | 27.714 working   -> returns (M3, overwritten)
kr-4  38.542 empty | 38.584 status=killed keys=[status] | 38.593 spawning (full) | 43.050 working   -> returns (M3, overwritten)
kr-2  33.026 empty | 33.077 spawning (full) | 33.094 killed (full)                                 -> stays (M3, merged late)
      worker probes: list-panes -t kr-2 exit 1; has-session -t kr-2 exit 1; rename 33.095
kr-3  36.685 empty | 36.739 spawning (full) | 36.827 killed (full)                                 -> stays (M1)
      worker probes: has-session -t 0e28352127dc-kr-3 exit 0; list-panes ... exit 0; rename 36.828
kr-4' (second run) 40.414 spawning (full) | 40.425 killed; probes has-session -t kr-4 exit 1     -> stays (M3, merged late)
```

  (kr-1 and kr-4 are from the first run at 11:52, kr-2, kr-3 and kr-4' from the traced run at 11:53.)
  The spawn's later write (`promptDelivered`, `session-manager.ts:1729`) merges and keeps `killed`.
- So F4's two outcomes: "returned to `working` on the next poll" = M3 with the poll's write before the
  spawn's full write; "stayed `killed`" = M1, or M3 with the poll's write after the spawn's full write.
  ao-29 (OpenCode, F4) fits either; F5 (OpenCode version probe) fits M3, because during the probe the
  record holds only the launch keys (`readLaunchClaim`, `session-manager.ts:247-255`, no `tmuxName`).

## 4. Q3: what writes `killed` into every record at one moment (F3)

### 4.1 Real evidence (read-only)

The records of F3 were archived on 2026-10-19 at 20:52 (fleet cleanup), so their 14:56:51 mtime is
gone. The archive content shows `status=killed` at key position 3 (an in-place merge). The per-session
"last operation" in the real observability files keeps the moment:

```
60756641ca25-observability/processes/lifecycle-manager-3216178.json (worker of agent-orchestrator, 2026-10-16 12:13 to 2026-10-17 00:03)
  ao-38 18:56:51.268Z  ao-32 .269Z  ao-36 .271Z  ao-orchestrator .272Z  ao-37 .276Z  ao-39 .280Z  ao-40 .293Z   lifecycle.transition
f6790d5546be-observability/processes/lifecycle-manager-3215891.json (worker of agent-skills)
  as-71 18:57:03.827Z  as-70 .829Z  as-orchestrator .830Z  as-73 .848Z  as-72 .852Z  as-74 .861Z  as-75 .864Z   lifecycle.transition
```

No other project has a transition between 18:50Z and 19:10Z. The agents were claude-code (ao-32,
ao-36, ao-38), OpenCode (ao-37, ao-39) and codex (ao-40); the agent-skills records as-70 to as-75 also
ended `killed` (their archives read `killed`). So two independent long-running workers, 12.5 s apart
(one poll each at its own phase), saw every live session dead or exited. This needs a condition on the
whole host that lasted at least 12.5 s and broke a probe that all agents share: the tmux server
(`has-session`, `list-panes`) or `ps`. The exact trigger is not recoverable: the transition detail of
the traces is gone (ring of 80), and `lifecycle-worker.log` prints only error-level entries (`working ->
stuck`); `killed` is a warn-level transition, so it is not in the log.

### 4.2 Scratch reproduction (`repro_q3.sh`, phase 2)

Worker on server A (2 s interval), sessions on server A:

```
before outage   kr-1 working  kr-2 killed (setup race, M1)      panes A: kr-1 kr-2
11:48:58.673 socket of server A hidden (mv); 11:49:03.682 back
after outage    kr-1 killed mtime 11:49:00.381                  panes A: kr-1 kr-2   (panes ran all the time)
5 s later       kr-1 killed (2 more polls, no change)
kr-3 spawned    kr-3 working (not affected, as ao-41 in F3)
11:49:12.487 ps fails (shim); 11:49:17.494 ps back
after           kr-3 killed mtime 11:49:16.421 (runtime alive, agent exited -> :417), stays killed
```

### 4.3 Each command with its tmux calls on another server (phase 1)

Two live sessions on server A (kr-1 `working`, kr-2 `killed` by the setup race), each command run with
the tmux shim of server B:

| Command (tmux on B) | Output | Records after | Persists `killed`? |
| --- | --- | --- | --- |
| `ao status` | both `exited` | unchanged | no |
| `ao session ls` | both `[killed]` | unchanged | no |
| fresh `ao lifecycle-worker` on B, 4 polls | - | unchanged | no (`:1305-1309` skips untracked terminal) |
| `ao send --no-wait kr-1` | `Message sent and processing` | kr-1 `spawning`, then `working`; a second kr-1 pane on B, the pane on A still runs | no; it relaunches (core `send` -> `restore`) |
| `ao spawn` | new kr-3 on B; starts a worker on B | unchanged for kr-1/kr-2 | no |
| `ao start kr` | new kr-orchestrator on B | unchanged for kr-1/kr-2 | no |
| `ao session cleanup` | `Cleaned: kr-2` | kr-2 archived, its worktree removed, its pane on A still ran | no (moves the record) |

So the first candidate of the brief (a call whose tmux calls go to another server) does not produce F3:
none of these persists `killed` into `sessions/`. It produces other damage (a duplicate pane, a removed
worktree). A long-running worker cannot change its server during its life (its environment is fixed);
it can only lose it (socket gone, server unresponsive beyond the 5 s timeout, or `ps` failing), which is
M4.

### 4.4 The `:3360` default and records without a `status` line

- `session-manager.ts:3360` is not a reader default. It is in `restore()`, when the record is copied
  back from the archive: `status: raw["status"] ?? "killed"`. The restore then writes
  `status=spawning` after the relaunch (`:3450`, `:3458`).
- The reader default for a missing `status` line is `spawning` (`utils/session-from-metadata.ts:23`,
  `utils/validation.ts:41`); `readMetadata` gives `unknown` (`metadata.ts:88`).
- Writers that leave a record without `status`, even for a moment: `reserveSessionId` without `initial`
  (empty; worker spawn and project-mode orchestrator spawn; measured 40-60 ms in scratch, about 390 ms
  in F6); `reserveSessionId` with the launch claim (launch keys only; prepared agents, for the whole
  prepare phase, 10 s with the OpenCode version probe); the repair-on-read
  (`updateMetadataPreservingMtime`) when it reads an empty orchestrator record (it writes
  `role=orchestrator`, `prAutoDetect=off` only); `deleteMetadata(..., true)` copies such a record into the
  archive as it is (a later archive restore then writes `killed` at `:3360` for a moment).
- In that window the hazard is not the status default but the made-up handle (M3).

## 5. Q4: one mechanism or several

- F1, F1b, F2: M1 (fresh worker started by `ao start` just before the orchestrator spawn).
- F4: M1 and M3 (both measured; M3 explains the sessions that returned to `working`).
- F5: M3 (made-up handle during the OpenCode version probe; from code and F5, not run).
- F3: M4 (a host-wide probe outage of at least 12.5 s seen by two long-running workers). Different
  trigger, same persistence (`:1195`) and the same sink (M2).

## 6. Q5: a safe correction of the real records (for the orchestrator, on the owner's word; not run)

Records that read `killed` while their pane runs today: `60756641ca25-agent-orchestrator/sessions/ao-orchestrator`
and `f6790d5546be-agent-skills/sessions/as-orchestrator`. (`ao-orchestrator-1` is a stale record with no
worktree; leave it.)

1. Check read-only first, for each record: the tmux session named in `tmuxName` exists on the default
   server (`tmux has-session -t <tmuxName>`, run by the orchestrator, not by a worker), and a `claude`
   process is on its pane TTY (`ps -eo pid,tty,args`). Today: 271799 and 322109.
2. Value: `status=working` (what `spawnOrchestrator` writes at launch, `session-manager.ts:2103-2119`).
3. Writer: a one-key merge with an atomic replace, for example core `updateMetadata(sessionsDir, id,
   { status: "working" })` from the built core under `env -i HOME=$HOME` (no `AO_*` variable, so the
   real state root), or `awk` into a temp file in the same directory and `mv`. Keep every other key. Do not use
   `~/.ao/bin/ao-metadata-helper.sh` (it accepts only `status=pr_open`). Do not use `ao session restore`
   or core `send` (they relaunch the pane).
4. What happens next without a fix: worker 271579 tracks `killed` for `ao-orchestrator`, so its next
   poll checks the record, `determineStatus` gives `working` (or `stuck`/`needs_input` if the agent is
   idle past the threshold or waits for input), and `checkSession` writes it with a `session.working`
   notification (desktop, by routing). Worker 321413 (agent-skills) behaves the same. The correction then
   holds until the next M1/M3/M4 event (for example the next `ao start` of that project).
5. With the recommended fix (section 7, part C), the next poll corrects such records by itself, and no
   manual write is needed. Part A/B alone does not correct existing records.

## 7. Fix proposal

### 7.1 Options

| Option | What | Files | Covers | Risk |
| --- | --- | --- | --- | --- |
| A. Launch grace | In `determineStatus`, an `exited` agent (or the terminal fallback) with a live runtime does not give `killed` while `now - (restoredAt ?? createdAt) < launchGraceMs` (60 s default, config key optional); keep the current status | `lifecycle-manager.ts` (`:394-449`) | M1 | an agent that dies within 60 s of launch is found up to one grace later |
| B. No probe without a stored handle | `determineStatus` probes a runtime only when the record has `runtimeHandle` or `tmuxName` (the same rule as the enrichment, `session-manager.ts:1233-1237`); otherwise it returns the current status. `checkSession` writes the status only if the record still has the handle and status that the poll read (compare-and-set in a new `updateMetadataIf`) | `lifecycle-manager.ts` (`:384-392`, `:1188-1196`), `metadata.ts` (new helper) | M3, and every worker-vs-spawn read-merge-write race | a legacy record that never had a handle is never marked `killed` by the lifecycle (the enrichment already never trusts it) |
| C. Confirm and recover | (1) A negative probe (`isAlive` false or agent `exited`) persists `killed` only when the next poll confirms it; one poll in which every probed session (two or more) is negative is a probe outage: persist nothing, set health `warn`. (2) Write `killedReason=runtime|agent-exited|pr-closed`; `pollAll` also re-checks `killed` records whose reason is a probe (or that have no reason and no `pr`): runtime alive and agent running gives `killed -> working` | `lifecycle-manager.ts` (`:1188-1196`, `:1305-1309`, `:561-569`) | M4, M2, a fallback for M1 | real deaths are persisted one poll later (30 s), so the `agent-exited` reaction comes later; the recovery must not undo a `pr-closed` kill |
| D. Probes say "unknown" on errors | runtime-tmux `isAlive` returns `false` only for "can't find session", and rejects for "no server running", "error connecting", a timeout or another error; claude-code (and codex, gemini, opencode) process probes reject when `tmux list-panes` or `ps` cannot run | `runtime-tmux/src/index.ts:175-182`, `agent-claude-code/src/index.ts:507-617`, the same in the other agent plugins | M4 at its root | every caller of `isAlive` must handle a rejection (`session-manager.ts` send path already uses `.catch(() => true)`; cleanup has a `catch` that skips) |
| E. Reorder `ao start` | spawn the orchestrator before the worker | `start.ts:888-950` | nothing alone (the agent still needs about 1 s after the record is complete) | none, but it does not fix M1 |

### 7.2 Recommendation

**A + B + C in core, with D for runtime-tmux and claude-code in the same round.**

Why: the core part covers every agent and both runtimes at once and closes all four mechanisms at the
single persistence point; C also corrects the real records that read `killed` today without a manual
write; D removes the false "dead" answers at their source for the two plugins on the measured F3 path
(the other agent plugins can follow). A alone or B alone leaves M4 and M2; C alone delays M1 by one poll
but keeps the M3 merge race.

Order inside the round: B (smallest, removes the made-up handle probe), then A, then C, then D.

### 7.3 Tests that must turn green

- `packages/core/src/__tests__/killed-status-race.test.ts` (8 tests): M1 x2 by A (or C), M3 x2 by B,
  M2 x2 by C(2), M4 x2 by C(1).
- `packages/cli/__tests__/killed-status-probe-errors.test.ts` (3 tests): by D.
- Existing tests that the fix round must adapt (they expect `killed` from one `check()` of a session
  created just now): `lifecycle-manager.test.ts:145-154` ("detects killed state when runtime is dead"),
  `:190-199` ("... getActivityState returns exited"), `:201-212` ("... terminal fallback"). With C they
  need two polls, with A an old `createdAt`. `runtime-tmux/src/__tests__/index.test.ts:641-650`
  ("returns false when has-session fails") must use the "can't find session" message under D.
- New guard tests for the fix round: a session whose agent really exits is `killed` after two polls; a
  `pr-closed` kill is not recovered; "can't find session: x" still gives `isAlive` false.

## 8. Tests added (commit `20b25e52`)

New files only. Each test fails on `654b3d28` for the measured reason:

| File | Test | Failure on 654b3d28 |
| --- | --- | --- |
| `packages/core/src/__tests__/killed-status-race.test.ts` | M1: does not persist killed for 'app-orchestrator' 171 ms after launch while its runtime is alive | `expected 'killed' not to be 'killed'` |
| same | M1: ... for 'app-1' (status `spawning`) | `expected 'killed' not to be 'killed'` |
| same | M3: does not write killed into a reserved record that a spawn still owns | `expected 'killed' not to be 'killed'` (the probe used `{ id: "app-2" }`) |
| same | M3: does not merge killed into the launched record that the spawn writes during the probe | `expected 'killed' not to be 'killed'` |
| same | M2: moves a killed record back to working once the agent process is visible (same worker) | `expected 'killed' to be 'working'` |
| same | M2: moves a killed record back to working after a worker restart (F1 orchestrator today) | `expected 'killed' to be 'working'` |
| same | M4: keeps every live session working after a transient outage: tmux server unreachable | `expected { 'app-1': 'killed', ... } to deeply equal { 'app-1': 'working', ... }` |
| same | M4: ... ps fails (runtime alive, agent reported exited for all) | same |
| `packages/cli/__tests__/killed-status-probe-errors.test.ts` | runtime-tmux isAlive: does not report a live session dead when the tmux server cannot be reached | `expected { alive: false } to deeply equal { rejected: true }` |
| same | runtime-tmux isAlive: does not report a live session dead when has-session times out | same |
| same | claude-code isProcessRunning: does not report the agent gone when ps fails | same |

Full run (fake `HOME`, no `AO_*`, `PATH` without any agent binary, a guard `tmux` first on `PATH`,
`pnpm -r --no-bail test`): 2592 tests, **2531 passed, 11 failed, 50 skipped**. core 8 failed / 1098
passed; cli 3 failed / 257 passed; every other package passed (integration-tests 69 passed, 45
skipped; scm-github 140 passed, 5 skipped). The 11 failures are the tests above. The guard `tmux` logged
8 calls, all `tmux -V` (integration-test detection), so no test reached a real tmux server. `pnpm
typecheck` passes; `pnpm lint` gives 0 errors and the 5 old `no-console` warnings.

## 9. Brief items found unclear or wrong

1. `session-manager.ts:3360` is not "a record with no `status` line reads as `killed`". It is the
   archive copy-back writer in `restore()`. The reader default is `spawning`
   (`utils/validation.ts:41`). So F6's sentence "in that window the reader default of
   `session-manager.ts:3360` gives `killed`" is wrong; the hazard in that window is the made-up runtime
   handle (M3), measured live.
2. `lifecycle-manager.ts:1303` (a comment: "`list()` marks a dead runtime `killed`"): `list()` does so
   in memory only. Nothing in `list()` or `get()` persists a status; the only `killed` write for an
   active record is `checkSession` at `:1195`.
3. "The orchestrator record kept its 11:19:56.244 mtime" (F6): correct, but an orchestrator record's
   mtime is not always its last write. The repair-on-read writes it and resets the mtime
   (`updateMetadataPreservingMtime`, `session-manager.ts:574-597`). In F1 the repair came first and the
   `killed` write last, so the mtime is the `killed` write (the sessions directory mtime and the trace
   agree).
4. "The `lifecycle-worker.log` there has no timestamps": correct, and it also holds only error-level
   entries, so no `killed` transition is in it. The timestamped evidence is in
   `~/.agent-orchestrator/<hash>-observability/processes/lifecycle-manager-<pid>.json` (trace ring of 80
   entries and the last operation per session). The final `find` of section 0 excludes these files, as
   it should.
5. Section 0 says to read the real data "only with `cat`, `ls`, `stat`, `grep`". I also used read-only
   `python3 -I` (`json.load`) on the real observability files, `ps`, and `/proc/<pid>/stat` for the
   start times of real processes. Nothing was written.
6. The Q3 candidate ("a call whose tmux calls go to another server") does not write `killed` (4.3). It
   remains a real hazard of other kinds (duplicate pane by `ao send`, removed worktree by `ao session
   cleanup`).

## 10. Deviations during the work

- First Q1 run (`d3`, 11:36): the script looked for `<hash>-kr` but the project directory is
  `<hash>-repo`, so it did not read the worker PID and stopped private server A before the worker. I
  stopped that worker (565501) by its exact PID at about 11:39. Its tmux calls always went through the
  `-L ao46kr-A` shim, so it could not reach the default server.
- In the runs before 11:53 the watcher was started through a wrapper, so the script stopped the wrapper
  and the watcher ended at the end of its own duration (I stopped one, 849801, by PID). The scripts below
  now stop the watcher by its own PID file.
- I ran `npx vitest` once (11:57); npm printed an update notice, so it may have contacted the npm
  registry for that notice. All later runs used the local `vitest` binary.

## 11. Reproducer scripts (outside the repository, `/tmp/ao46kr/scripts/`)

Use: `/tmp/ao46kr/scripts/setup.sh` once; then `repro_q1.sh <delay> <label> [wait]` (Q1),
`repro_q3.sh [1]` (Q3; argument `1` runs phase 1 only), `repro_m3.sh [N]` (M3). Logs go to
`/tmp/ao46kr/logs/`.

### env.sh

```bash
# Scratch environment for ao-46 killed-status reproducers. Source it; never run ao outside it.
S=/tmp/ao46kr
WT=/home/taisung/.worktrees/agent-orchestrator/ao-46
NODE_BIN=$(dirname "$(command -v node)")
AO_JS=$WT/packages/cli/dist/index.js
# run_scratch <server-letter> <cmd...>: env -i with fake HOME, scratch PATH (tmux shim for server A or B)
run_scratch() {
  local srv=$1; shift
  env -i HOME=$S/home USER=$USER LOGNAME=$USER SHELL=/bin/bash TERM=xterm-256color LANG=C.UTF-8 \
    TMPDIR=$S/tmp PATH=$S/bin$srv:$S/bin:$NODE_BIN:/usr/bin:/bin \
    AO_STATE_ROOT=$S/state AO_CONFIG_PATH=$S/repo/agent-orchestrator.yaml \
    "$@"
}
ao_scratch() { local srv=$1; shift; run_scratch "$srv" node "$AO_JS" "$@"; }
tmuxA() { env -u TMUX /usr/bin/tmux -L ao46kr-A "$@"; }
tmuxB() { env -u TMUX /usr/bin/tmux -L ao46kr-B "$@"; }
```

### setup.sh

```bash
#!/usr/bin/env bash
# Build the scratch tree: fake HOME, stubs, tmux shims, scratch git repo and config.
set -euo pipefail
S=/tmp/ao46kr
mkdir -p $S/home $S/tmp $S/bin $S/binA $S/binB $S/state $S/logs
# tmux shims: every tmux call that ao makes goes to a private server.
for X in A B; do
  printf '#!/bin/sh\nexec /usr/bin/tmux -L ao46kr-%s "$@"\n' $X > $S/bin$X/tmux
  chmod +x $S/bin$X/tmux
done
# gh stub: never reach the network.
printf '#!/bin/sh\ncase "$1 $2" in\n  "--version "*) echo "gh version 0.0.0 (ao46kr stub)"; exit 0;;\n  "auth status") echo "stub: logged in" >&2; exit 0;;\nesac\necho "gh stub: offline" >&2\nexit 1\n' > $S/bin/gh
chmod +x $S/bin/gh
# claude stub: invisible to the claude process regex for $(cat $S/delay) seconds,
# then a long-running process whose args start with "claude".
cat > $S/bin/claude <<'STUB'
#!/bin/bash
d=$(cat /tmp/ao46kr/delay 2>/dev/null || echo 0)
a="$*"; a=${a//$'\n'/ }; echo "$(date +%T.%N | cut -c1-12) stub start delay=$d pid=$$ args=${a:0:60}" >> /tmp/ao46kr/logs/stub.log
exec -a ao46-starting /bin/bash -c "sleep $d; echo \"\$(date +%T.%N | cut -c1-12) stub exec claude pid=\$\$\" >> /tmp/ao46kr/logs/stub.log; exec -a claude /bin/sleep 1000000"
STUB
chmod +x $S/bin/claude
echo 0 > $S/delay
# scratch git repo with the config
if [ ! -d $S/repo/.git ]; then
  mkdir -p $S/repo && cd $S/repo
  git init -q -b main
  git -c user.name=scratch -c user.email=scratch@example.invalid commit -q --allow-empty -m init
fi
cat > $S/repo/agent-orchestrator.yaml <<CFG
defaults:
  runtime: tmux
  agent: claude-code
  workspace: worktree
  notifiers: []
projects:
  kr:
    name: kr
    repo: scratch/kr
    path: $S/repo
    defaultBranch: main
    sessionPrefix: kr
    orchestratorWorkspaceMode: project
CFG
echo setup done
# ps shim: passes through unless the flag file exists (simulates a failing `ps`).
printf '#!/bin/sh\n[ -e /tmp/ao46kr/psfail ] && { echo "ps shim: simulated failure" >&2; exit 1; }\nexec /usr/bin/ps "$@"\n' > $S/bin/ps
chmod +x $S/bin/ps
```

### watch.mjs

```js
// Read-only watcher: polls a sessions directory every 2 ms and logs each new
// version of each record (inode or mtime change) with a wall-clock timestamp.
import { readdirSync, statSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const [dir, out, durationMs, pidFile] = process.argv.slice(2);
if (pidFile) appendFileSync(pidFile, `${process.pid}\n`);
const seen = new Map();
const t = (d = new Date()) => d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
const end = Date.now() + Number(durationMs);
function tick() {
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name === "archive" || name.startsWith(".")) continue;
      let st;
      try { st = statSync(join(dir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      const key = `${st.ino}:${st.mtimeMs}:${st.size}`;
      if (seen.get(name) === key) continue;
      seen.set(name, key);
      let body = "";
      try { body = readFileSync(join(dir, name), "utf-8"); } catch { continue; }
      const kv = Object.fromEntries(body.split("\n").filter(Boolean).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));
      const keys = Object.keys(kv).join(",");
      appendFileSync(out, `${t()} ${name} ino=${st.ino} mtime=${t(st.mtime)} size=${st.size} status=${kv.status ?? "<none>"} keys=[${keys}]\n`);
    }
  }
  if (Date.now() < end) setTimeout(tick, 2);
}
tick();
```

### repro_q1.sh

```bash
#!/usr/bin/env bash
# Q1 reproducer: `ao start` (project mode, claude-code stub) in a scratch config,
# scratch state root and private tmux server A. The stub `claude` stays invisible
# to the claude process regex for DELAY seconds. A read-only watcher (2 ms poll)
# and `strace -f` (rename calls only) time-stamp every record write from outside
# the source. Usage: repro_q1.sh <delay-seconds> <label> [wait-seconds]
set -uo pipefail
source /tmp/ao46kr/scripts/env.sh
DELAY=${1:?delay}; LABEL=${2:?label}; WAIT=${3:-40}
L=$S/logs/q1-$LABEL; rm -rf "$L"; mkdir -p "$L"
# Preconditions: no private server A, no scratch worker, empty scratch state.
if tmuxA ls >/dev/null 2>&1; then echo "private server A already runs: stop it first"; exit 1; fi
for p in $S/state/*/lifecycle-worker.pid; do [ -f "$p" ] && kill -0 "$(cat "$p")" 2>/dev/null && { echo "scratch worker runs: $p"; exit 1; }; done
rm -rf "$S/state" && mkdir -p "$S/state"
rm -rf "$S/repo/.claude" "$S/repo/.ao"
echo "$DELAY" > "$S/delay"; : > "$S/logs/stub.log"
# Watcher on every scratch sessions dir (discovered after ao creates it).
run_scratch A node -e '
  const { readdirSync, existsSync } = require("node:fs");
  const { spawn } = require("node:child_process");
  const root = process.argv[1], out = process.argv[2], dur = process.argv[3];
  const t0 = Date.now();
  const iv = setInterval(() => {
    for (const d of existsSync(root) ? readdirSync(root) : []) {
      const dir = root + "/" + d + "/sessions";
      if (existsSync(dir)) { clearInterval(iv); spawn(process.execPath, ["/tmp/ao46kr/scripts/watch.mjs", dir, out, String(dur - (Date.now() - t0)), out + ".pid"], { stdio: "inherit" }); return; }
    }
  }, 1);
' "$S/state" "$L/records.log" $(( (WAIT + 20) * 1000 )) &
WATCH_PID=$!
sleep 0.3
echo "$(date +%T.%N | cut -c1-12) ao start begins" > "$L/events.log"
run_scratch A strace -f -tt --seccomp-bpf -e trace=${TRACE:-rename,renameat,renameat2} -e signal=none \
  -o "$L/strace.log" node "$AO_JS" start kr > "$L/ao-start.out" 2>&1 &
STRACE_PID=$!
# Wait for `ao start` itself (the first traced process) to print its summary.
for _ in $(seq 1 300); do grep -q 'Startup complete\|Failed\|Error' "$L/ao-start.out" && break; sleep 0.1; done
echo "$(date +%T.%N | cut -c1-12) ao start returned" >> "$L/events.log"
sleep "$WAIT"
HASHDIR=$(ls -d $S/state/*-repo)
WORKER_PID=$(cat "$HASHDIR/lifecycle-worker.pid" 2>/dev/null || echo "")
echo "worker pid: $WORKER_PID" >> "$L/events.log"
# Process start times of the worker, the pane shell and the stub (from /proc, 10 ms).
btime=$(awk '/^btime/{print $2}' /proc/stat)
pstart() { local st; st=$(awk '{print $22}' /proc/$1/stat 2>/dev/null) || return; local ms=$(( btime*1000 + st*10 )); printf '%s.%03d' "$(date -d @$((ms/1000)) +%T)" $((ms%1000)); }
{
  echo "proc-start worker $WORKER_PID $(pstart $WORKER_PID)"
  for pp in $(tmuxA list-panes -a -F '#{pane_pid}'); do
    echo "proc-start pane-shell $pp $(pstart $pp)"
    for c in $(pgrep -P "$pp"); do echo "proc-start pane-child $c $(pstart $c) $(tr '\0' ' ' < /proc/$c/cmdline | cut -c1-60)"; done
  done
  echo "socket: $(ls -la --time-style=full-iso /tmp/tmux-$(id -u)/ | grep ao46kr || true)"
} >> "$L/events.log"
cp "$S/logs/stub.log" "$L/stub.log"
cp "$HASHDIR/sessions/kr-orchestrator" "$L/final-record" 2>/dev/null
# Stop the scratch worker by its exact PID, then the private server A.
if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then kill "$WORKER_PID"; fi
for _ in $(seq 1 50); do kill -0 "$WORKER_PID" 2>/dev/null || break; sleep 0.1; done
tmuxA kill-server 2>/dev/null
for _ in $(seq 1 100); do kill -0 "$STRACE_PID" 2>/dev/null || break; sleep 0.1; done
kill "$(cat "$L/records.log.pid" 2>/dev/null)" "$WATCH_PID" 2>/dev/null; wait 2>/dev/null
# Summary: record versions and the PID that renamed each version into place.
echo "== records"; cat "$L/records.log"
echo "== renames onto kr-orchestrator (pid time tmp-name)"
grep -E 'rename.*kr-orchestrator"' "$L/strace.log" | grep -v archive | sed -E 's#/tmp/ao46kr/state/[^/]+/sessions/##g'
echo "== events"; cat "$L/events.log"; echo "== stub"; cat "$L/stub.log"
echo "== final record"; cat "$L/final-record"
```

### q3lib.sh

```bash
# Helpers for the Q3 reproducer. Source after env.sh.
SDIR() { ls -d $S/state/*-repo/sessions 2>/dev/null | head -1; }
ts() { date +%T.%N | cut -c1-12; }
snap() { # snap <label>: status, mtime and handle of each record, and the panes on A and B
  local d; d=$(SDIR); echo "--- snapshot $1 at $(ts)"
  for f in $(ls "$d" 2>/dev/null | grep -v archive); do
    [ -f "$d/$f" ] || continue
    printf '  %-16s %-16s mtime=%s handle=%s\n' "$f" "$(grep -m1 '^status=' "$d/$f" || echo 'status=<none>')" \
      "$(stat -c %y "$d/$f" | cut -c12-23)" "$(grep -m1 '^tmuxName=' "$d/$f" | cut -d= -f2)"
  done
  echo "  archive: $(ls "$d/archive" 2>/dev/null | tr '\n' ' ')"
  echo "  panes A: $(tmuxA ls -F '#{session_name}' 2>/dev/null | tr '\n' ' ')"
  echo "  panes B: $(tmuxB ls -F '#{session_name}' 2>/dev/null | tr '\n' ' ')"
}
stop_workers() { # stop every scratch lifecycle worker by the exact PID in its pid file
  for p in $S/state/*/lifecycle-worker.pid; do
    [ -f "$p" ] || continue; local pid; pid=$(cat "$p")
    if kill -0 "$pid" 2>/dev/null && tr '\0' ' ' < /proc/$pid/cmdline | grep -q "$WT/packages/cli/dist/index.js lifecycle-worker"; then
      kill "$pid"; for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      echo "  stopped worker $pid"
    fi
  done
}
wait_status() { # wait_status <session> <status> <timeout-s>
  local d; for _ in $(seq 1 $(( $3 * 10 ))); do d=$(SDIR); grep -q "^status=$2$" "$d/$1" 2>/dev/null && return 0; sleep 0.1; done
  echo "  timeout: $1 is not $2"; return 1
}
start_worker() { # start_worker <server-letter> <interval-ms>: scratch worker in the background
  ao_scratch "$1" lifecycle-worker kr --interval-ms "$2" >> $S/logs/worker-$1.log 2>&1 &
  echo "  started worker $! on server $1 (interval $2 ms)"; sleep 1.5
}
fresh_state() {
  for w in $(git -C $S/repo worktree list --porcelain | awk '/^worktree /{print $2}' | grep -v "^$S/repo$"); do git -C $S/repo worktree remove --force "$w"; done
  git -C $S/repo worktree prune; git -C $S/repo for-each-ref --format='%(refname:short)' refs/heads/session | xargs -r git -C $S/repo branch -q -D
  rm -rf "$S/state" && mkdir -p "$S/state"; rm -rf "$S/repo/.claude" "$S/repo/.ao"; rm -f /tmp/ao46kr/psfail; echo 0 > $S/delay; }
cleanup_all() { stop_workers; tmuxA kill-server 2>/dev/null; tmuxB kill-server 2>/dev/null; rm -f /tmp/ao46kr/psfail; return 0; }
```

### repro_q3.sh

```bash
#!/usr/bin/env bash
# Q3 reproducer. Phase 2: a long-running scratch worker on private server A loses
# its probes for a few seconds (A socket hidden, then `ps` failing) while two
# sessions run on A. Phase 1: with two live sessions on A, each ao command runs
# with its tmux calls on private server B. Every record change is shown by snapshots.
set -uo pipefail
source /tmp/ao46kr/scripts/env.sh; source /tmp/ao46kr/scripts/q3lib.sh
SOCK=/tmp/tmux-$(id -u)/ao46kr-A
two_sessions_on_A() { # fresh state, worker on A (2 s), kr-1 and kr-2 on A, both working
  fresh_state; start_worker A 2000
  ao_scratch A spawn > $S/logs/spawn1.out 2>&1; ao_scratch A spawn > $S/logs/spawn2.out 2>&1
  wait_status kr-1 working 20; wait_status kr-2 working 20
}
PHASE=${1:-all}
if [ "$PHASE" != 1 ]; then
echo "################ Phase 2a: socket of server A hidden for 5 s"
two_sessions_on_A; snap "before outage"
mv "$SOCK" "$SOCK.hidden"; echo "$(ts) socket hidden"; sleep 5
mv "$SOCK.hidden" "$SOCK"; echo "$(ts) socket back"; snap "after outage"
sleep 5; snap "5 s later (2 more polls)"
ao_scratch A spawn > $S/logs/spawn3.out 2>&1; wait_status kr-3 working 20; snap "after kr-3 spawn"
echo "################ Phase 2b: ps fails for 5 s (runtime alive)"
touch /tmp/ao46kr/psfail; echo "$(ts) ps fails"; sleep 5; rm -f /tmp/ao46kr/psfail; echo "$(ts) ps back"
snap "after ps outage"; sleep 5; snap "5 s later"
cleanup_all
fi
echo "################ Phase 1: commands with tmux calls on server B"
two_sessions_on_A; stop_workers; snap "setup (A worker stopped)"
for cmd in "status" "session ls"; do
  echo ">>> ao $cmd (server B)"; ao_scratch B $cmd > "$S/logs/q3-$(echo $cmd | tr ' ' _).out" 2>&1; echo "  exit=$?"
  grep -E 'kr-[0-9]' "$S/logs/q3-$(echo $cmd | tr ' ' _).out" | head -4 | sed 's/^/  out: /'
  snap "after ao $cmd"
done
echo ">>> fresh lifecycle worker on server B, 4 s at 1 s interval"
start_worker B 1000; sleep 3; stop_workers; snap "after B worker"
echo ">>> ao send --no-wait kr-1 (server B)"
ao_scratch B send --no-wait kr-1 "q3 probe" > $S/logs/q3-send.out 2>&1; echo "  exit=$?"; sed 's/^/  out: /' $S/logs/q3-send.out | head -6
snap "after ao send"; stop_workers
echo ">>> ao spawn (server B)"
ao_scratch B spawn > $S/logs/q3-spawn.out 2>&1; echo "  exit=$?"; sleep 3; snap "after ao spawn"; stop_workers
echo ">>> ao start kr (server B)"
ao_scratch B start kr > $S/logs/q3-start.out 2>&1; echo "  exit=$?"; sleep 3; snap "after ao start"; stop_workers
echo ">>> ao session cleanup (server B)"
ao_scratch B session cleanup > $S/logs/q3-cleanup.out 2>&1; echo "  exit=$?"; sed 's/^/  out: /' $S/logs/q3-cleanup.out | head -8
snap "after ao session cleanup"
d=$(SDIR); for f in $(ls $d/archive 2>/dev/null); do echo "  archive $f: $(grep -m1 '^status=' $d/archive/$f)"; done
cleanup_all; snap "end"
```

### repro_m3.sh

```bash
#!/usr/bin/env bash
# M3 reproducer: a scratch worker on private server A polls every 100 ms while
# `ao spawn` creates sessions. A poll that reads a record before the spawn has
# written its runtime handle uses a made-up handle (id = session ID, not the
# tmux name), finds it dead and merges status=killed into the record.
set -uo pipefail
source /tmp/ao46kr/scripts/env.sh; source /tmp/ao46kr/scripts/q3lib.sh
N=${1:-4}; L=$S/logs/m3; rm -rf $L; mkdir -p $L
fresh_state; mkdir -p $S/state/0e28352127dc-repo/sessions
run_scratch A node /tmp/ao46kr/scripts/watch.mjs $S/state/0e28352127dc-repo/sessions $L/records.log $(( (N * 6 + 15) * 1000 )) $L/watch.pid &
WATCH=$!
# The worker runs under strace (execve and rename only) to show the tmux target of each probe.
run_scratch A strace -f -tt --seccomp-bpf -e trace=execve,rename -e signal=none -o $L/worker-strace.log \
  node "$AO_JS" lifecycle-worker kr --interval-ms 100 >> $S/logs/worker-A.log 2>&1 &
STRACE=$!; sleep 1.5
for i in $(seq 1 $N); do ao_scratch A spawn > $L/spawn$i.out 2>&1; echo "$(ts) spawn $i exit=$?"; done
sleep 3; snap "end"; cleanup_all; kill $(cat $L/watch.pid) 2>/dev/null; wait 2>/dev/null
echo "== versions of each record (killed lines and their predecessors)"
for i in $(seq 1 $N); do echo "-- kr-$i"; grep " kr-$i ino" $L/records.log | sed -E 's/ino=[0-9]+ //' | cut -c1-190; done
```
