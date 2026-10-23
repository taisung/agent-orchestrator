# 0013 — Running `ao` on Herdr: status assessment on 2026-10-23

**Date**: 2026-10-23, about 10:15 EDT
**Context**: the owner asked for an assessment of the current state of AO on the Herdr runtime, during
the Herdr 0.9.5 fit work (fit-1 landed on `main` today; fit-2a is in progress).
**Status**: assessment only. No source, test or config file changed. Each fact names its source: a file,
a commit, or a read-only check of the host by the orchestrator (no `herdr` and no `ao` command was run for
this note).

## 1. Summary

AO does not run on Herdr today, and real work should stay on tmux until fit-2b lands. A short trial on one
project becomes reasonable after the build of `main` with fit-1 (section 7).

## 2. The facts of the host

| Fact | Source |
| --- | --- |
| The project config selects tmux (`runtime: tmux`). | `agent-orchestrator.yaml` line 2 |
| No active session record names Herdr; 2 archived records do. | `grep -l -i herdr` over `~/.agent-orchestrator/*/sessions/` and `sessions/archive/` |
| The host has herdr 0.9.5 (protocol 22). | doc 0004 header; the live check of 2026-10-22 |
| The live `ao` is `packages/cli/dist/index.js` of the primary checkout, built 2026-10-22 17:53 EDT, before fit-1 and relaunch landed. | `readlink -f $(command -v ao)`; the `dist` file times |
| Local `main` holds relaunch (merge `7328d710`) and fit-1 (merge `6a5bd6a7`). `origin/main` is at `80ce3a89`: it holds relaunch, not fit-1. | `git log`, `git rev-parse origin/main` |
| CI is red on `80ce3a89`: the `afterAll` of `relaunch-pane-shell.test.ts` races `tmux kill-server` (`ENOTEMPTY`); all 116 runtime-tmux tests pass. A fix is in progress (ao-63). | CI run `39964135618` |

## 3. What works on herdr 0.9.5

The configuration, the command surface, the per-project switch and the send-and-verify path hold on 0.9.5
(measured on isolated scratch servers with a stand-in claude on 2026-10-22; doc 0004 header, §5a; the live
check `reviews/herdr_live_check_095_opus.md`).

## 4. The live build: what it reads wrong on 0.9.5

herdr 0.9.5 writes a failed call's error to stderr with exit 1; 0.8.0 wrote it to stdout with exit 0. The
live build reads stdout through `execFile`, which rejects on exit 1 (doc 0004 §5a, "What AO reads today"):

- `isAlive` rejects (unknown) for a closed pane or workspace, where 0.8.0 gave `false`.
- The agents' process check on a Herdr pane rejects for a closed pane, where 0.8.0 gave "no process".
- With no server, both reject without AO's no-server code. The lifecycle keeps a session whose workspace
  was closed, and `ao start` reads its orchestrator as unknown and stops.
- A record with no runtime handle yet gets a handle made from the session name, so the lifecycle calls
  `pane process-info --pane <session name>`, and herdr answers `pane_not_found`.

These misreads make AO refuse, or keep records too long. They do not make AO close a wrong workspace: since
same-ID R2a a Herdr stop answers `unknown` and closes nothing (doc 0004 §1).

## 5. `main` now: fit-1 (landed, not pushed, not built)

fit-1 (design `reviews/herdr_fit_design_r7_opus.md`; notes 2 and 3; merge check
`reviews/herdr_fit1_merge_check_sol61.md`, LAND-SAFE) takes effect with the next build:

- **F-1, F-2:** AO reads the 0.9.5 failure form, the no-server code and the pane ID grammar.
- **F-6:** each handle pins the herdr binary and the socket, so a session no longer depends on the
  environment of the caller.
- **F-5:** the plugin's `destroy` refuses.
- **The interim startup guard** (`docs/DEVELOPMENT.md`, the Herdr fit-1 startup rule): no Herdr answer
  retires an old orchestrator (owner decision OQ-F1 (b)). `isAlive` false and the no-server code are
  unknown. A held record whose pane still runs is never reused. When no other record can be reused,
  `ao start` exits 1 with the reason. Its documented limits until fit-2b:
  - a record whose status after core's read repair is terminal and not `killed` (`done`, `errored`,
    `terminated`, `cleanup`) is not probed;
  - a direct isolated core `spawnOrchestrator` reads no old record;
  - a record with no stored handle counts as unchecked and is reused without a probe.
- **Retirement:** no AO command clears a Herdr record before F-9. Only the documented hand edit of the
  state directory does (the recipe in `docs/DEVELOPMENT.md`, with `sessions/archive` and an unused name).

## 6. What stays open

**Until fit-2a** (design `reviews/herdr_fit2_design_r11_opus.md` §8.1; ao-73 implements it on
`feat/herdr-fit2a`, size M):

- A blocked Herdr agent still gets a prompt (F-3).
- A failed create closes the new workspace by its ID with no check (F-4). With fit-2a, a failed create
  keeps the record (with the partial handle and `launchFailed`), the worktree, the agent session and the
  script.
- A probe or a stop of an old record goes through the configured runtime, not through the runtime of the
  record's handle.
- Restore does not refuse a damaged handle.

**Until fit-2b** (§8.2, designed, size M):

- No admission lock: two `ao start` runs at the same time can start two orchestrators.
- The interim guard and its limits (section 5) stay until G replaces them.
- No `ao session kill <id> --confirm-runtime-closed` (F-9, owner decision OQ-F2 (a)). `ao session kill`,
  cleanup and restore keep a Herdr record and its worktree, and the owner closes the workspace and retires
  the record by hand.
- `ao status` does not show the new launch states.

**With no round planned** (RH-A and RH-B are design only, `reviews/rh_design_r6_opus.md`):

- AO never closes a Herdr workspace itself (no bound close).
- After a herdr live handoff every terminal ID changes, and AO reads every running session as gone. Do not
  run a live handoff while AO Herdr sessions run (doc 0004 §5a).
- `ao session relaunch` refuses every runtime other than tmux, Herdr included ("the relaunch waits for the
  Herdr live check", `docs/DEVELOPMENT.md`, the relaunch section).
- The last-activity column of `ao status` is blank for Herdr sessions, and the first send to a cold agent
  takes about 15 s (doc 0004 §8).

## 7. Recommendation

1. Keep all real work on tmux until fit-2b lands.
2. After the build of `main` with fit-1 (owner decision: after green CI), a trial is reasonable. Follow doc
   0004 §7: one project with `runtime: herdr`, one or two workers.
3. During a trial, expect `ao session kill` to refuse. Close the panes in herdr and retire the records by
   hand, with the recipe of `docs/DEVELOPMENT.md`.

## 8. Doc follow-up

Doc 0004 §1 and §5a still say that fit-1 is "not on `main` at this writing", and §5a "What AO reads today"
describes the live build of section 4. Correct both when the fit-1 build is live, in the fit-2a docs commit
or in a separate docs-only edit.

**Done on 2026-10-23** (owner request), after the fit-1 build: doc 0004 §1, §5a (now "What AO reads", with
the forms before and since fit-1) and §8 describe the live build.

## 9. Update 2026-10-23 16:15 EDT: fit-1 and fit-2a are live

- The live `ao` is the build of 2026-10-23 16:09 of `b2064068` (`main` and `origin/main`; CI 4 of 4 success). It
  holds relaunch, fit-1 (since the 10:23 build of `e43db964`) and fit-2a (landed 15:14 as `a95608c1..5eda626c`;
  reviews `reviews/herdr_fit2a_code_review_r1_sol61.md`, `_r1_muse13.md` and `_r2_sol61.md`, the last one
  LAND-SAFE). The lifecycle workers 3539803 (agent-orchestrator) and 3540453 (agent-skills) run it; the Nexus
  worker 140323 stays on the build of `9846cf6a` (owner's choice; Nexus uses tmux).
- The four items of section 6 "Until fit-2a" are done: a blocked Herdr agent gets no prompt and no raw input
  (also when the pane names no agent); a failed create closes nothing and keeps the record, the worktree, the
  agent session and the script; the probes and stops of an old record go through its handle's runtime; restore
  refuses a damaged handle. Doc 0004 §1, §3, §5 and §5a describe the new build.
- The items "Until fit-2b" and "With no round planned" of section 6 are unchanged, and so is the
  recommendation of section 7: real work stays on tmux until fit-2b; a one-project trial is reasonable now.
