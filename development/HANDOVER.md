# Handover

**Last Updated**: 2026-10-15
**Latest Code Commit**: 6abab58d (test(agent-opencode): pin the existing-session path in the probe test)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The OpenCode 2.x arc (note `0009`, increments I-0 to I-7) is half done. I-1 (drop 1.x, require 2.0.29)
and I-6 (`ao start` installs `@opencode/cli`) are on `main` and live: the primary checkout was rebuilt
on the owner's word on 2026-10-15 at 10:19 EDT, and the five lifecycle workers were restarted at 10:20.
Note `0010` (the M-1 to M-8 measurements) is on `main`. **I-2 landed** on `main` as
`f63b5b99..6d2e8262` after five rounds (Muse, Opus 5.5, then astra three times by the owner's name under
R3; reviews Sonnet 5.5 and V4.1 Flash, sol-6-1, Opus 5.5 three times); round 5 is LAND-SAFE under the
owner's stop rule. **The `~/.ao/bin` PATH fix landed** on `main` as `5884f9ad..9f06dc25` after four rounds
(Muse, then Opus 5.5 ao-19 three times; reviews Opus 5.5, then sol-6-1 three times); round 4 is LAND-SAFE
under the owner's stop rule. **Both are live**: on the owner's word the primary checkout was rebuilt on
2026-10-15 at 19:43 EDT (`pnpm build`, exit 0, no dependency change), and the five lifecycle workers were
restarted by exact PID at 19:43:19 to 19:43:32 (agent-skills 2210537, agent-orchestrator 2210632 for the
Nexus config and 2212230 for this config, Nexus 2210642, VSF 2210682). A module check of the new build
under a fake `HOME`: Codex `PATH` starts with `~/.ao/bin`; Claude Code removes both wrapper spellings and
`.` and sets an empty `GH_PATH`. The host's `~/.ao/bin` still holds 0.2.1 until the next spawn installs
0.2.3. **The onboarding CI cleanup landed** (`ebc8e25b`,
`c9a7ed93`, `19d99667`). On the owner's word, `main` was pushed to `origin` on 2026-10-15 at 12:42 EDT and again at 19:44 EDT, a
fast-forward `70d19d70..c831caff` (the CI cleanup, the PATH fix, I-2 and the docs). On the owner's word
the 13 finished worker sessions (ao-1, ao-16, ao-18 to ao-28) were killed at 19:40 after a check that
every branch is on `main` by patch and every review file equals its copy on `main`; ao-14, ao-15 and
ao-17 stay as `killed` records.

**Outage, 2026-10-15 11:41:47 EDT**: ao-16 ran `tmux kill-server` with `TMUX` set, which stopped the
host's default tmux server and every session of every fleet (TODO Known Issues). The owner restarted
both orchestrators at 11:42. This session (started 11:42:10) found the cause, and on the owner's word
restored ao-18 (11:49) and ao-16 (11:56), each with a `.agent_resume.md` that names the cause and the
tmux rule.

Until 2026-10-15 the agent-skills orchestrator (`as-orchestrator`) coordinated this work. From this
handover on, this fork's own orchestrator owns I-2 to I-5 and the PATH arc. `as-orchestrator` keeps I-7
(the agent-skills protocol text, CRITICAL there) and the Sonnet 5.5 trial ledger.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees in
`/home/taisung/.worktrees/agent-orchestrator/<id>`.

| Session | Model | State | Branch tip | Disposition |
| --- | --- | --- | --- | --- |
| ao-1 | Claude Opus 5.5 | idle, done, NOT-LAND-SAFE | `3c1d04c9` | I-2 round 2 author; row closed; round 3 went to astra | brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r2.md`; model pinned in its worktree `.claude/settings.local.json`; its branch was moved to `main` (all old commits on `main` by patch) |
| ao-19 | Claude Opus 5.5 | idle, done, landed | `608b2b6b` | PATH fix landed as `5884f9ad..9f06dc25`; row closed; earlier: PATH round 4: physical resolution in `removeAoBinFromPath`, every relative entry removed for Claude Code launches, every `*/.ao/bin` reserved for ao (stated in the owner text); plan check passed; earlier: owner chose round 4 on 2026-10-15; fixes ao-23 r3 M-1 (relative entries), M-2 (symlink plus `..`), m-1 (`*/.ao/bin` rule); brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-aobin-path-r4.md`; stop rule: if the re-check finds only new contrived spellings, record them as known limits and land; earlier: PATH round 3: `removeAoBinFromPath` in core, Claude Code launches drop every inherited wrapper directory and set an empty `GH_PATH`; plan check passed; `f9e85891` alone fails lint, `4affc2e3` fixes it; earlier: round 2 failed sol-6-1 M-1 (nested Claude Code launches inherit the wrappers); brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-aobin-path-r3.md`; its context compacted before round 3 |
| ao-25 | GPT-6-Astra (Codex) | idle, done, NOT-LAND-SAFE | `0080cf87` | I-2 round 3 author; 92% of its context used; row closed; round 4 went to a new astra session ao-27; earlier: one `fix(core)` commit: a host-wide launch lock in `/tmp/ao-opencode-launch-<uid>` with a pending marker that has no expiry, and a liveness guard; plan check passed; earlier: owner-named (R3); fixes sol-6-1 B-1 and M-1; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r3.md`; reviewer Opus 5.5 |
| ao-23 | GPT-6.1-Sol (Codex) | idle, done, LAND-SAFE | `608b2b6b` | PATH round 4 LAND-SAFE under the owner stop rule; review `development/reviews/aobin_path_review_r4_sol61.md`; all its rows closed; earlier: brief `~/.cache/agent-skills-haiku55-arc/brief-review-aobin-path-r4-sol.md`, with the owner stop rule; context 67% at dispatch; earlier: PATH round 3: M-1 relative wrapper entries stay, M-2 symlink plus `..` hides the wrapper directory, m-1 every `*/.ao/bin` is removed; review `development/reviews/aobin_path_review_r3_sol61.md`; row closed; R7 next step is the owner; earlier: brief `~/.cache/agent-skills-haiku55-arc/brief-review-aobin-path-r3-sol.md`; earlier: PATH round 2: M-1 a Claude Code pane inherits the wrappers from a parent that has them; m-1, m-2; review `development/reviews/aobin_path_review_r2_sol61.md`; row closed; R7 next step is the owner |
| ao-24 | GPT-6.1-Sol (Codex) | idle, done, NOT-LAND-SAFE | `3c1d04c9` | I-2 round 2: B-1 overlapping starts with the same title and directory bind and purge the first pane's session; M-1 the shared-ID guard skips a live holder with a terminal status; review `development/reviews/i2_review_r2_sol61.md`; row closed; R7 next step is the owner |
| ao-26 | Claude Opus 5.5 | idle, done, LAND-SAFE | `bfa5af45` | I-2 round 5 LAND-SAFE under the owner stop rule, 1 minor m-8; its own isolation breach made 2 global OpenCode model turns (TODO Known Issues); review `development/reviews/i2_review_r5_opus.md`; all rows closed; earlier: under the owner stop rule; its context compacted before this round; brief `~/.cache/agent-skills-haiku55-arc/brief-review-i2-r5-opus.md`; earlier: I-2 round 4: M-2 evidence rule 1 accepts a non-protocol create (a `main`-build fleet or a manual create), M-3 the timeout text tells the operator to `rm` a live holder's marker, m-5 to m-7; review `development/reviews/i2_review_r4_opus.md`; both rows closed; earlier: brief `~/.cache/agent-skills-haiku55-arc/brief-review-i2-r4-opus.md`; asked to check the error-string classifier against the `runtime-tmux` on `main` (the PATH fix changed `create()`); earlier: I-2 round 3: B-1 a failed launch blocks every later worker spawn of the project, M-1 the pending marker has no recovery from evidence, 4 minors; its section "Judgment of the pending-marker trade-off" gives the smallest safe change; review `development/reviews/i2_review_r3_opus.md`; row closed; earlier: cross-family lens of the astra author; model pinned in its worktree; brief `~/.cache/agent-skills-haiku55-arc/brief-review-i2-r3-opus.md`; asked to judge the pending-marker trade-off closely |
| ao-27 | GPT-6-Astra (Codex) | idle, done, NOT-LAND-SAFE | `ece9372e` | I-2 round 4 author; 82% of its context used; row closed; round 5 went to ao-28; earlier: one `fix(core)` commit: markers clear on evidence (a finished create since `startedAt`, or a dead pane on its recorded tmux socket after 25 s), a pre-delivery runtime failure clears the marker, an uncertain one archives the worker as `killed`; plan check passed; earlier: owner chose round 4 by astra on 2026-10-15 (R3); a new session because ao-25 was at 92% context; spec is the ao-26 smallest-safe-change list plus m-1 to m-4; the brief warns that a lock root chosen from `XDG_RUNTIME_DIR` would split the lock between launchers; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r4.md`; re-check ao-26 |
| ao-28 | GPT-6-Astra (Codex) | idle, done, landed | `bfa5af45` | I-2 landed as `f63b5b99..6d2e8262`; row closed; earlier: one `fix(core)` commit: both recovery rules need an explicit tmux negative for the recorded earlier pane; live-holder timeout text with the PID and no `rm`; `ENOENT`-tolerant `complete` and `release`; plan check passed; earlier: owner chose round 5 by astra with a stop rule on 2026-10-15: if the re-check finds only cases that need a non-protocol creator or a contrived host state, record them as known limits and land; fixes ao-26 r4 M-2 (rule 1 only when the earlier pane is gone), M-3 (live-holder text, `ENOENT` tolerance), m-5 to m-7; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-i2-r5.md`; re-check ao-26 |
| ao-29 | Muse (OpenCode 2.x) | killed, replaced | `aa3609e0` | first spawn on the new build (0.2.3 wrappers installed, own `opencodeSessionId` stored, `~/.ao/bin` first on PATH); the spawn prompt made it poll 2 min for the brief, which came later; its record was `killed` by the first-poll race, so a send would have restored it, maybe on the default model; killed with no work, row closed |
| ao-30 | Muse (OpenCode 2.x) | idle, done, landed | `781a3a6e` | landed as `854690c3`; row closed; earlier: one code commit on top of the docs commits `09d70a7c..4da4a340`: `model=` stored at spawn, `resolveSelectionForSession` passes it for a worker, `getRestoreCommand(session, project, effectiveModel?)` in all four plugins; its report: live check on a fake `claude` keeps `--model claude-sonnet-5-5` through restore, and `main` loses it; about 0.10 USD (OpenCode record) |
| ao-31 | Muse (OpenCode 2.x) | idle, done, landed | `0bc46903` | landed as `14bb4670`; row closed; earlier: owner word "delete release.yml" (2026-10-15); python/L0/LOW, receipts only; `package.json` scripts and `.changeset/` stay; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-del-release.md` |
| ao-32 | Opus 5.5 (Claude Code) | idle, done: LAND-SAFE | at `781a3a6e` | 0 B, 0 M, 3 m, 5 notes; review copied to `main`; 5.06 USD; row closed; earlier: model pinned in `.claude/settings.local.json`; review file `development/reviews/restore_model_review_r1_opus.md`; brief `~/.cache/agent-skills-haiku55-arc/brief-review-restore-model-opus.md` |
| ao-20 | Muse (OpenCode 2.x) | idle, done, landed | `353ef189` | round 1 landed as `ebc8e25b`; round 2 restores a synchronous config-load step 6, deletes `port: 9000`, and removes the dead `packages/web` entries of `eslint.config.js`; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-ci-nodash-r2.md` |
| ao-21 | Claude Sonnet 5.5 | idle, done, LAND-SAFE | `353ef189` | lens 1 of 2; round 1 LAND-SAFE (M-1, m-1, m-2); brief `~/.cache/agent-skills-haiku55-arc/brief-review-ci-nodash-r2-sonnet.md` |
| ao-22 | V4.1 Flash (OpenCode 2.x) | idle, done, LAND-SAFE | `353ef189` | lens 2 of 2; round 1 LAND-SAFE (3 minors); brief `~/.cache/agent-skills-haiku55-arc/brief-review-ci-nodash-r2-v4flash.md` |
| ao-14 | Muse (OpenCode 2.x) | down since the outage, done | `1c2a93b6` | the round-1 author of I-2; R7 moved round 2 away; kill it when I-2 lands |
| ao-15 | Muse (OpenCode 2.x) | down since the outage, done | `345f1e6e` | the round-1 author of the PATH fix; kill it when the fix lands |
| ao-16 | Claude Sonnet 5.5 | idle, done | `1c2a93b6` | I-2 lens 1, verdict recorded, row closed, its scratch processes stopped; kill it when I-2 lands |
| ao-17 | V4.1 Flash (OpenCode 2.x) | down, done | `1c2a93b6` | I-2 lens 2, verdict recorded, row closed; kill it when I-2 lands |
| ao-18 | Claude Opus 5.5 | idle, done | `345f1e6e` | the PATH lens, verdict recorded, row closed; kill it when the fix lands |
| ao-orchestrator | Claude Opus 5.5 | this session, started 11:42:10 by the owner after the outage, in the primary checkout on `main` | `main` | the transcript of the session before the outage is `~/.claude/projects/-home-taisung-local-agent-orchestrator/ad7a5f39-b7cb-480d-93dc-576ac541a826.jsonl` |

**Watcher**: stopped on 2026-10-15 at 21:01 (no worker runs). The last one was PID 3005873, `~/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator
-w /home/taisung/.worktrees/agent-orchestrator --fallback ao-orchestrator -i 60 -s 20 --preseed
ao-30@... ao-32@...`, state `~/.cache/fleet_watch/ao-opencode2-2026-10-14/`, run with `AO_CONFIG_PATH` set to
`CONFIG_PATH`. It survived the outage (it is not in tmux). To add or remove a worker, stop it by the PID
in `watch.pid`, remove `watch.pid`, and start it again with the same options and the new `--preseed`
list.

**Lifecycle worker** of this project: PID 3876010 (started 2026-10-15 11:07:17, `AO_CONFIG_PATH` set to
`CONFIG_PATH`, cwd `REPO_PATH`). PID 3544115 no longer runs. The leaked scratch lifecycle worker of
ao-5 (PID 3062995, `/tmp/ao-i1/config`, cwd deleted) was stopped by exact PID on the owner's word at
12:25.

**Router rows**: in this fork's log (profile `ROUTER_LOG`), none is open (ao-29 to ao-32 closed); ao-19, ao-23 (three rows), ao-25, ao-26 (three rows), ao-27, ao-28, ao-1, ao-20, ao-21,
ao-22, ao-23 and ao-24 are closed; ao-16,
ao-17 and ao-18 (reviewers) are closed.
In the agent-skills log (`~/agent-skills/development/artifacts/model_router_log/log.csv`), ao-14 (I-2
author) and ao-15 (PATH author) are open; close them there with `~/agent-skills/scripts/router_log.py
close --log <that file>`.

## Open and Blocked Items

**I-2 round 2**: running - ao-1 (Opus 5.5) - reviews `development/reviews/i2_review_r1_{sonnet,v4flash}.md`;
the round-2 review goes to sol-6-1 (`--agent codex --model gpt-6.1-sol`), Opus author at HIGH.
**PATH fix round 2**: running - ao-19 (Opus 5.5) - review `development/reviews/aobin_path_review_r1_opus.md`;
owner M-4 (a): Claude Code keeps its hook only; the round-2 review goes to sol-6-1. The fix touches no
file of I-2; if it needs `session-manager.ts` or the OpenCode plugin, it reports `partial`.
**Global OpenCode store**: closed - the owner keeps the 10 "Greeting request" sessions from the
integration live block (TODO Known Issues).
**Restore drops the spawn model**: open - TODO Known Issues - a worker fix in the claude-code
`getRestoreCommand` and the session metadata (HIGH).
**Tmux rule in the agent-skills protocol text**: open - the owner decides whether as-orchestrator adds
"`env -u TMUX` with every `tmux -L`" to the ao-spawn brief text.
**Owner decisions**: open - the `AO_*` variables of nex-orchestrator in the global OpenCode service
environment (restart the service from a clean shell, or not); the global OpenCode permissions that
allow every action (keep, or pass a session ruleset); the trailer rule for this fork (TODO Known
Issues); the orphan stash; `0007` §6 decisions 1-4 and 6.
**Q3 event stream**: blocked by fork D-4 (no worker reads the service password) - I-4 polls.
**Project guide does not name HANDOVER.md**: open - `CLAUDE.md` and `AGENTS.md` have no session-start
instruction - add "read `development/HANDOVER.md` first" to both in one commit.
**Minors kept open**: I-6 m-7 (watch the first CI run with secrets: its live OpenCode block now meets
2.0.29), I-6 m-8 (one test comment), the `npm ls` timeout, the export surface, the picker hint; I-1: the
lifecycle worker can mark a reserved ID `killed` during the 10 s probe (seen 1 of 2 runs), the refusal
message omits the probe's stderr, a refused spawn leaves its branch; for I-3: `session.create` accepts a
model with no provider route, and the `status=killed` write after the M-6 spawn.

## Next Priorities

1. **Rebuild and push** on the owner's word: `main` holds `854690c3` (the restore model fix, LAND-SAFE),
   `14bb4670` (the Release workflow removal) and docs. The fix is live only after `pnpm build` in the
   primary checkout and restarts of the five lifecycle workers by exact PID. A worker whose record says
   `killed` while its pane runs must not get an `ao send` (a send restores a `killed` session first);
   place a brief in the second that the spawn returns.
2. **The restore minors and notes** (TODO Known Issues): m-1 to m-3 and N-2 for a worker; N-1 for the owner.
3. **I-3 and I-4** (I-2 is on `main`), **then I-5** - route each with `~/agent-skills/scripts/routing.py
   route`; I-3 and I-5 are HIGH by the profile.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect
   `main`, ahead of `origin/main`, at the handover commit. `D test-ao-config2.yaml` in the status is an
   old working-tree deletion that this arc did not make; leave it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao status`, then read
   the first line of `.agent_report.md` of ao-16 and ao-18 (sentinels first).
3. Check the watcher: `ps -p $(cat ~/.cache/fleet_watch/ao-opencode2-2026-10-14/watch.pid)`.

## Key Files

- `development/0009_opencode_2x_api_fit_design.md` - §4 the mapping table, §13 the staged plan, §17 the
  review minors, §18 the owner's answers Q1 to Q9.
- `development/0010_opencode_2x_model_turn_measurements.md` - §11.1 pipe truncation, §13 plan changes,
  §15 review corrections.
- `packages/core/src/opencode-api.ts` (on ao-14's branch) - the I-2 helper.
- `~/.cache/agent-skills-haiku55-arc/` - every brief, report and review of the arc;
  `restart_lifecycle.py` there restarts one lifecycle worker by exact PID (`<pid>` dry run, `<pid> --do`).
- `~/agent-skills/skills/ao-spawn`, `ao-communicate`, `ao-lifecycle`, `handover` - the protocol.

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): the OpenCode 2.x plugin fix, 0009, I-6, I-1, the
  rebuilds of 2026-10-14 21:11 and 2026-10-15 10:19.
- [D-3](TODO_TRACKING.md#decisions) no worker builds in the primary checkout; [D-4](TODO_TRACKING.md#decisions)
  no worker reads the OpenCode service password.
- [Known Issues](TODO_TRACKING.md#known-issues): a rebuild does not reach running lifecycle workers; the
  second `agent-orchestrator` entry in the Nexus config.
- `~/agent-skills/development/TODO_TRACKING.md` Known Issues: the full arc history up to 2026-10-15.

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this
host runs from this checkout's `dist`, so every fleet (Nexus, VSF, agent-skills, this fork) runs what you
land after a rebuild, and only you rebuild, only on the owner's word (D-3). A rebuild does not reach a
running `ao lifecycle-worker`: restart each by exact PID with
`~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py`, on the owner's word.

The OpenCode 2.x arc follows note `0009` §13. I-1 and I-6 are live. I-2 round 2 is authored by ao-1
(Opus 5.5), and the `~/.ao/bin` PATH fix round 2 by ao-19 (Opus 5.5); both reviews go to sol-6-1. The
watcher already notifies this session, so your first action is to read the sentinels of ao-1 and
ao-19.

Landmines. OpenCode 2.x workers are eager: write `.agent_task.md` first, then send one `ao send
--no-wait`; a plain `ao send` waits 600 s, because the plugin still reads an idle 2.x pane as active
(I-4 fixes it). `ao spawn` bases a worktree on `origin/main` (`273b62c1`), so fast-forward each new
worktree to `main` before you write its brief. Before a new brief to a reused session, set line 1 of its
`.agent_report.md` to `running|...` (D-30 of agent-skills). Workers never push, never build in the
primary checkout, never write a global OpenCode file or `~/.ao/bin`, never read a `service.json`, and
write to OpenCode only on an isolated store (0009 §2). Every tmux command of a worker uses
`-L <unique-name>` with `TMUX` removed (`env -u TMUX`): `TMUX_TMPDIR` alone does not isolate inside a
pane, and on 2026-10-15 one `tmux kill-server` stopped every fleet. Do not send `/model` to a worker: it
rewrites the host-wide default in `~/.claude/settings.json`. `ao session restore` of a Claude worker
takes the host default model, so pin a model in the worktree's `.claude/settings.local.json` first.
Kill only exact PIDs; never `pkill`. No
`Co-Authored-By` trailer and no emoji. `ao send` text has no quotes, apostrophes, backticks, `$`,
parentheses or semicolons.

Ask the owner before any push. The open owner decisions are in Open and Blocked Items.
