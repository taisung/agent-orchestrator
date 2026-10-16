# Handover

**Last Updated**: 2026-10-16
**Latest Code Commit**: 0ec55a64 (fix(core): validate stored branch names before git to block option injection)
**Progress Tracker**: [TODO_TRACKING.md](TODO_TRACKING.md)
**Profile**: `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md`

## Current Status

The restore-identity and metadata-hardening series is on `main`, live and pushed: the restore model fix
(`854690c3`), the restore permission fix (`458786e6`, `120f500a`), option 1, which stores the spawn model and
mode of every worker (`5b488fdb`, `25a56f30`), the m-10 helper key limit (`5cbe84b3`) and the m-13 branch
check (`0ec55a64`). The Release workflow is removed (`14bb4670`). The last rebuild of the primary checkout
was on 2026-10-16 at 10:45 EDT, and the five lifecycle workers were restarted by exact PID at 10:45:11 to
10:45:24. `~/.ao/bin` holds 0.2.5 since 10:46:44. `origin/main` is `331d0c31` (CI green); `main` holds the
handover commit on top of it.

**Update 2026-10-16 12:15 EDT (priority 1 done except one check):** ao-32 reviewed
`ac0f662a..7f34bf4d`: LAND-SAFE, m-15 to m-17 fixed, new m-18 (bash `pr` checks depend on the locale) and
N-34 to N-38 (`branch_check_review_r2_opus.md`, TODO). `7f34bf4d` is on `main` as `cd39ea9d`. Both router
rows are closed. On the owner's word (2026-10-16: build, restart, push; m-18 stays open), the primary
checkout was rebuilt at 12:12 EDT (dist `WRAPPER_VERSION` 0.2.6), the five lifecycle workers were restarted
by exact PID at 12:13 EDT, and `main` was pushed. **New lifecycle PIDs:** agent-skills 3215891,
agent-orchestrator 3215991 (Nexus config) and 3216178 (this config), Nexus 3216043, VSF 3216103. No other
resident `ao` process ran. **Still open:** `cat ~/.ao/bin/.ao-version` shows 0.2.5 until the next Codex,
Gemini or OpenCode spawn; check that it shows 0.2.6 then. The watcher (PID 1710074) watches ao-32. The text
below is from before this update; its lifecycle PIDs are old.

**In flight: m-15 to m-17** (owner, 2026-10-16: "fix m-15 to m-17"; the m-13 review minors). ao-35 (Muse)
finished `7f34bf4d` (7 files: a refused spawn deletes its reserved record, a locale-independent bash branch
rule, the hook `pr` anchor tests, `WRAPPER_VERSION` 0.2.6; core 948 and claude-code 208 tests pass, its three
mutants fail tests, nothing written in the real state root, about 0.12 USD). It is **not reviewed, not on
`main`**. Against its brief, ao-35 pushed its branch and opened **PR #2** at 11:16 EDT (TODO Known Issues).
It stopped on the orchestrator's order and did not push again. On the owner's word PR #2 was closed and the
remote branch was deleted at 11:31 EDT; `7f34bf4d` stays in the local branch and the ao-35 worktree. The PR
CI passed except Dependency Review, which fails on a repository setting.

The OpenCode 2.x arc (note `0009` §13): I-1, I-2, I-6 and the `~/.ao/bin` PATH fix are on `main` and live.
I-3, I-4 and I-5 remain. Until 2026-10-15 `as-orchestrator` coordinated this work; it keeps I-7 (the
agent-skills protocol text) and the Sonnet 5.5 trial ledger.

## Live Sessions and Worktrees

All under `CONFIG_PATH` of the profile, tmux prefix `60756641ca25-`, worktrees in
`/home/taisung/.worktrees/agent-orchestrator/<id>`.

| Session | Model | State | Branch tip | Disposition |
| --- | --- | --- | --- | --- |
| ao-35 | Muse (OpenCode 2.x) | idle, done, not reviewed | `7f34bf4d` (local only; PR #2 closed, remote branch deleted) | m-15 to m-17 author; brief `~/.cache/agent-skills-haiku55-arc/brief-aofork-branch-check-r2.md`; report `.agent_report.md` (section "Push and PR 2" says why it pushed); router row open; keep until the review; do not run `ao session cleanup` before then: its record still names the closed PR #2, so cleanup can kill it (the local branch would stay) |
| ao-32 | Opus 5.5 (Claude Code) | idle, done | `bb81cf7a` | the reviewer of the whole series (r1 to r4, helper keys, branch check); model pinned in `.claude/settings.local.json`; costs: 5.06, 5.16, 7.61, 4.43, 8.21, 8.84 USD; reuse it for the m-15 to m-17 review |
| ao-orchestrator | Opus 5.5 (Claude Code) | this session, in the primary checkout on `main` | `main` | transcripts: `~/.claude/projects/-home-taisung-local-agent-orchestrator/6e2c2229-0d62-4ce3-8428-c32ba7097a7a.jsonl` (this one) and `ad7a5f39-b7cb-480d-93dc-576ac541a826.jsonl` (before the 2026-10-15 outage) |

Killed at this handover, each after a check that its branch is on `main` by patch and that its worktree has
no tracked change: ao-14, ao-15, ao-17, ao-30, ao-31, ao-33, ao-34. Their reports and briefs are in
`~/.cache/agent-skills-haiku55-arc/reports/`. `ao-orchestrator-1` stays a `killed` record.

**Watcher**: stopped at this handover (last PID 1232701), because no worker runs. To start it again:
`FLEET_WATCH_STATE=/home/taisung/.cache/fleet_watch/ao-opencode2-2026-10-14 setsid nohup bash
/home/taisung/agent-skills/scripts/fleet_watch.sh -o ao-orchestrator -w /home/taisung/.worktrees/agent-orchestrator
--fallback ao-orchestrator -i 60 -s 20 --preseed <id>@/home/taisung/.worktrees/agent-orchestrator ...`
with `< /dev/null`. `--preseed` records the current first line as handled, so read a worker's report first.

**Lifecycle workers** (since 2026-10-16 10:45): agent-skills 1218013, agent-orchestrator 1218338 (Nexus
config) and 1219143 (this config), Nexus 1218695, VSF 1218968. Their logs use `"level":"error"` for normal
transitions. PID 1071300 (`bash /tmp/ao-launch-923451c1-....sh`, from 2026-10-15 12:34) belongs to another
fleet's session; leave it.

**Router rows** (profile `ROUTER_LOG`): only ao-35 (author, m-15 to m-17) is open. In the agent-skills log
(`~/agent-skills/development/artifacts/model_router_log/log.csv`), the rows of ao-14 (I-2 author) and ao-15
(PATH author) are still to be closed by `as-orchestrator`.

## Open and Blocked Items

**PR #2**: closed - on the owner's word at 11:31 EDT, PR #2 was closed with a comment and the remote branch
was deleted; the work stays local for the review.
**Dependency Review on PRs**: open - owner decision - it fails because the repository's Dependency graph
setting is off. Turn the setting on, or let a worker remove the job.
**Author brief template**: open - section 0 must forbid push and PR work and say that this overrides the
spawn prompt, and every live run must quote an empty `find ~/.agent-orchestrator -maxdepth 1 -newer
<marker>` (TODO Known Issues).
**Review minors kept open**: N-27 (the new error texts print a stored value raw, so an escape sequence reaches
the terminal), N-28 (core reads `pr` with the unanchored `parsePrFromUrl`), m-11 and m-12 (cosmetic, r4).
Known limits: m-9 (owner accepted), N-17 (an agent with shell access can write its record file directly).
**Project guide**: open - `CLAUDE.md` and `AGENTS.md` do not name `development/HANDOVER.md` as the first
read; `CLAUDE.md` still says "getEnvironment must include `~/.ao/bin`" and its core utilities list lacks
`removeAoBinFromPath`, `GH_WRAPPER` and `GIT_WRAPPER`. A worker change.
**Test isolation**: open - tests leave state in the real `~/.agent-orchestrator` (many `*-observability`,
`*-test-app` directories, 24 records with a JSON `pr` of `acme/app`) and 2243 `/tmp/ao-test-state-*`
directories; an inherited `AO_STATE_ROOT` is not removed by the test setup. A worker change.
**Other code items**: the hidden `--no-dashboard` option (`packages/cli/src/commands/start.ts:997`); the
lifecycle first-poll race (`spawning` to `killed`, seen on ao-29).
**agent-skills protocol text** (owned by `as-orchestrator`): `env -u TMUX` with every `tmux -L`, private
servers only from the scratch environment, the lifecycle-worker PID cleanup (N-6), and the no-push rule.
The m-14 note (the generic helper call in `skills/ao-lifecycle/SKILL.md:854-860`) was sent on 2026-10-16.
**Owner decisions carried forward**: the `AO_*` variables of nex-orchestrator in the global OpenCode
service environment; the global OpenCode permissions that allow every action; the orphan stash
(`stash@{0}` on `feat/opencode-gemini-plugins`); `0007` §6 decisions 1 to 4 and 6.
**Q3 event stream**: blocked by D-4 (no worker reads the service password) - I-4 polls.
**Minors kept open from I-1 and I-6**: I-6 m-7 and m-8, the `npm ls` timeout, the export surface, the picker
hint; I-1: the refusal message omits the probe's stderr, a refused spawn leaves its branch; for I-3:
`session.create` accepts a model with no provider route.

## Next Priorities

1. **Land m-15 to m-17** - review `ac0f662a..7f34bf4d`, land it, roll out 0.2.6.
   - Context: ao-35's report is final. Move ao-32 to `7f34bf4d` with `reset --keep` (first remove its
     untracked `development/reviews/branch_check_review_r1_opus.md` after `cmp` against `main`), write a
     brief from `~/.cache/agent-skills-haiku55-arc/brief-review-branch-check-opus.md` (review file
     `branch_check_review_r2_opus.md`, the m-15 to m-17 items, the new lifecycle PIDs), set line 1 of its
     report to `running|`, then `ao send --no-wait`. Read the Claude meter first (R3).
   - Expected outcome: LAND-SAFE; cherry-pick `7f34bf4d` onto `main`; on the owner's word `pnpm build`,
     restart the five lifecycle workers by exact PID (M-3: an old process writes 0.2.5 over 0.2.6), check
     `cat ~/.ao/bin/.ao-version` = 0.2.6 after the next Codex, Gemini or OpenCode spawn, push. Close the
     ao-35 router row with the landed SHA.
2. **I-3 and I-4, then I-5** (note `0009` §13) - route each with `~/agent-skills/scripts/routing.py route`;
   I-3 and I-5 are HIGH by the profile.

## First Actions

1. `cd /home/taisung/local/agent-orchestrator && git status -sb && git log --oneline -3` - expect `main`
   at the handover commit. ` D test-ao-config2.yaml` is an old working-tree deletion; leave it and never
   commit it.
2. `AO_CONFIG_PATH=/home/taisung/local/agent-orchestrator/agent-orchestrator.yaml ao status`, then
   `head -1 /home/taisung/.worktrees/agent-orchestrator/ao-35/.agent_report.md` and
   `git -C /home/taisung/.worktrees/agent-orchestrator/ao-35 log --oneline -1` (expect `7f34bf4d`).
3. Start priority 1.

## Key Files

- `development/reviews/branch_check_review_r1_opus.md` - m-15 to m-17 (section 3) and notes N-25 to N-33.
- `development/reviews/helper_keys_review_r1_opus.md`, `restore_model_review_r{1,2,3,4}_opus.md` - the series.
- `packages/core/src/utils/branch-name.ts` - `isSafeBranchName`, `isSafePrUrl`.
- `packages/core/src/agent-workspace-hooks.ts` - the `~/.ao/bin` helper and wrappers, `WRAPPER_VERSION`.
- `packages/core/src/session-manager.ts` - the branch gates (spawn, orchestrator spawn, `claim-pr`, restore).
- `packages/plugins/agent-claude-code/src/index.ts` - the Claude metadata hook script.
- `~/.cache/agent-skills-haiku55-arc/` - every brief of the arc, `reports/`, and `restart_lifecycle.py`
  (`<pid>` dry run, `<pid> --do`).
- `development/0009_opencode_2x_api_fit_design.md` §13 - the staged plan for I-3 to I-5.

## Durable References

- [What Landed](TODO_TRACKING.md#what-landed): `854690c3`, `458786e6`, `120f500a`, `5b488fdb`, `25a56f30`,
  `5cbe84b3`, `0ec55a64`, `14bb4670`, with their reviews and rollouts.
- [Decisions](TODO_TRACKING.md#decisions): D-3 (no worker builds in the primary checkout), D-4 (no worker
  reads the OpenCode service password).
- [Known Issues](TODO_TRACKING.md#known-issues): the spawn prompt tells workers to push; a worker script
  wrote into the real state root; M-3 (a resident process reinstalls its own helper version).

## Next Session Start Prompt

You are the orchestrator of the personal `ao` fork at `/home/taisung/local/agent-orchestrator`. Read the
profile `~/agent-skills/skills/shared/ao-profiles/agent-orchestrator.md` once. The global `ao` of this host
runs from this checkout's `dist`, so every fleet (Nexus, VSF, agent-skills, this fork) runs what you land
after a rebuild. Only you rebuild, only on the owner's word (D-3). A rebuild does not reach a running
`ao lifecycle-worker`: restart each by exact PID with `~/.cache/agent-skills-haiku55-arc/restart_lifecycle.py`.
After a `WRAPPER_VERSION` bump this restart is required, because an old process writes its own helper over
the new one (M-3).

The metadata-hardening series is live up to m-13 (0.2.5). The m-15 to m-17 round by ao-35 (`7f34bf4d`)
waits for a blind review by ao-32 (Opus 5.5). ao-35 had opened PR #2 against its brief; the owner closed it. Your first action is First Actions 1 to 3, then priority 1. After that, I-3 and I-4 of the
OpenCode 2.x arc.

Landmines. Place a brief in the same command that spawns the worker: the spawn prompt waits only about 2
minutes. Never `ao send` to a session whose record says `killed` while its pane runs: send restores it
first. Before a new brief to a reused session, set line 1 of its `.agent_report.md` to `running|`. The
spawn prompt tells workers to push and open a PR: every brief must forbid it in section 0. Every live run
of a worker sets a scratch `AO_STATE_ROOT` and quotes an empty `find ~/.agent-orchestrator -maxdepth 1
-newer <marker>`; check it yourself after the report. Every tmux command uses `env -u TMUX tmux -L
<unique>`, and a private server starts only from the scratch environment. Every `pnpm test` runs with a fake
`HOME` and no `AO_*`. Workers never push, never build in the primary checkout, never write `~/.ao/bin`, a
global OpenCode store or `~/.claude/settings.json`, never read `service.json`, never `git stash` and never
`git worktree add`. Pin a Claude worker's model in its worktree's `.claude/settings.local.json`; never send
`/model`. Kill only exact PIDs; never `pkill` or `killall`. Commit messages are `docs(development): ...`
with no `Co-Authored-By` trailer and no emoji. `ao send` text has no quotes, apostrophes, backticks, `$`,
parentheses or semicolons; use `--no-wait`.

Ask the owner before any push. The open owner decisions are in Open and Blocked Items.
