# Review — 0009 OpenCode 2.x API fit design (round 1)

**Reviewer**: DeepSeek V4.1 Flash
**File reviewed**: `development/0009_opencode_2x_api_fit_design.md`, commit `e38a8f1b`, range
`f5a87010..e38a8f1b`.
**Worktree HEAD**: `e38a8f1b` (verified `git log --oneline -1`).
**Date**: 2026-10-14.
**Method**: receipts review. Read-only `opencode api` calls against the running 2.0.29 service,
`npm view`, the v2 installer text, the ao source at `e38a8f1b`, the binary shim and `~/.bashrc`, the
OpenCode log, and the agent-skills files. No tracked file was edited; nothing was committed.

## Verdict

**ACCEPT**

The note is unusually well-sourced. Every load-bearing claim I sampled is true, and every
decision-relevant claim names a command+output, a `file:line`, or a document. The four parts of the
owner's scope are all covered (part 4 by plan, as phase 1 requires). The increments can be built and
reviewed alone in the stated order, the risk classes are right, and each measurement's dependence is
declared. The findings below are all minor (line-number drift and point-in-time figures); none
changes a decision.

## Findings

### m-1 — §4 row 12: `detect-agent.ts:21` is the plugin-name row, not the `detect()` call

Section §4, mapping row 12. The "Today" column says `cli/src/lib/detect-agent.ts:21` "calls
`detect()`". Line 21 is the `opencode` entry of the `AGENT_PLUGINS` array; the `detect()` call is at
line 36.

```
$ grep -n "detect()" packages/cli/src/lib/detect-agent.ts
36:      if (typeof mod?.detect === "function" && mod.detect()) {
$ sed -n '21p' packages/cli/src/lib/detect-agent.ts
  { name: "opencode", pkg: "@aoagents/ao-plugin-agent-opencode" },
```

The row's meaning is right (detection flows through row 7's `detect()`); only the line pointer is
off. Minor.

### m-2 — §5.4: the binary event-name list has no command or line

Section §5.4 lists the notification plugin's event→state map (`form.created`, `permission.asked`,
`session.execution.*`, and the other event names) with the source "read from the 2.0.29 binary". It
gives no command and no offset, so I could not sample it; it is also the one factual block explicitly
marked "needs M-3". Acceptable for a provisional block, but it differs from the note's own standard
("a command and its output, a `file:line`, or a document"). Minor.

### m-3 — §13 I-7 row does not restate the measurement dependencies that §9 gives it

Section §13, plan row I-7. §9 makes the census (and the rule replacements) depend on M-1 and M-2 (R1,
R2), M-7 (R4, R5) and M-8 (R3), but the I-7 row of the plan table names only "the 2.x pane census".
The dependency is stated in §9 and therefore not missing; a reader of the plan table alone would miss
it. Minor.

### m-4 — §5.2 point-in-time counts cannot be reproduced and have moved

Section §5.2. "Of 200 recent global sessions, 8 have an `outcome` (all `succeeded`)" and "200 sessions
in 6 `projectID` values". Re-running the same read-only call today gives 9 sessions with an outcome
(all `succeeded`) across 11 `projectID` values:

```
$ opencode api session.list --param limit=200 | node -e '...'
count: 200
projectIDs: 11
withOutcome: 9 succeeded: 9
```

The claim was true at survey time and the kind is unchanged (every outcome seen is `succeeded`); it is
only unreproducible now because the store grew. Not an error. Minor.

### m-5 — §5.1: the `dist/index.js` size cannot be re-checked (no build present)

Section §5.1. The note cites the built plugin `dist/index.js`, 27340 bytes, as the artifact that
printed `active`. `dist/` is not in this worktree (`ls packages/plugins/agent-opencode/dist/index.js`
→ No such file), so the byte size could not be sampled. The classification itself is reproducible by
reading `detectActivity`: the §5.1 capture's last line is not a bare `>`, `$` or `#` and matches none
of the four `waiting_input` patterns, so it returns `active`. Minor.

### m-6 — §12: line ranges name the leading doc-comment line, not the symbol line

Section §12. Several ranges start a few lines before the symbol, at its JSDoc/comment, while the
column says the symbol is at that line:

```
$ grep -n "buildSessionIdCaptureScript\|OPENCODE_API_MAJOR\|buildLegacySessionOptions" packages/plugins/agent-opencode/src/index.ts
82:function buildSessionIdCaptureScript(): string {
228:const OPENCODE_API_MAJOR = 2;
269:function buildLegacySessionOptions(model?: string, agent?: string): string[] {
```

The note writes `(:77-121)`, `(:221-237)` and `(:268-274)`; the function/const lines are 82, 228 and
269. The listed members, their uses (`:349`, `:455`), and every other §12 pointer check out. Harmless
if the convention is "range includes the comment", but it is not stated. Minor.

## Spot checks

Legend: **T** = true, **F** = false, **C** = cannot check.

| # | Claim (section) | Source checked | Result |
|---|---|---|---|
| 1 | `ao spawn` reports success at `cli/src/commands/spawn.ts:127` (§11) | `grep -n "spinner.succeed" spawn.ts` → `127: spinner.succeed(\`Session ${...} spawned...\`)` | T |
| 2 | `sm.spawn(...)` at `spawn.ts:101` (§11) | `grep -n "sm.spawn(" spawn.ts` → `101`, plus `:258`, `:359` | T |
| 3 | `detectActivity` at `index.ts:527` returns `active` for the §5.1 idle capture (§5.1) | `grep -n "detectActivity(terminalOutput"` → `527`; code read: last line fails `^[>$#]\s*$` and all four `waiting_input` regexes → `active` | T |
| 4 | `getActivityState` at `index.ts:546-590`; cascade matches §5.5 baseline (§5.1, §5.5) | `sed -n '546,590p' index.ts`; step order process → JSONL → CLI `updated` → fallback → `null` | T |
| 5 | `deleteOpenCodeSession` at `core/src/session-manager.ts:91`; `fetchOpenCodeSessionList` at `:121` (§4 rows 9, 10) | `grep -n` → `91`, `121` | T |
| 6 | `ao start` install row is `npm install -g opencode-ai`, `start.ts:359-364` (§4 row 11, §8) | `sed -n '359,364p'` → `{ id: "opencode", ... args: ["install","-g","opencode-ai"] }`, `args` at `:363` | T |
| 7 | `sendViaTmux` at `send.ts:104`; the idle wait at `:178-206`; the 600 s give-up text at `:202` (§5.1) | `grep -n "sendViaTmux\|Timeout waiting for idle"` → `104`, `202`; wait loop `if (opts.wait !== false && canUseTmux)` at `:178` | T |
| 8 | `ao status` reads only `summary` from `getSessionInfo`, `status.ts:102`, `:513` (§7) | `status.ts:102` = `await agent.getSessionInfo(session)`, `:513` = `if (introspection?.summary)` | T |
| 9 | claude-code adds cache reads/writes at `agent-claude-code/src/index.ts:377-379` (§7) | `sed -n '377,379p'` → `inputTokens += input_tokens / cache_read_input_tokens / cache_creation_input_tokens` | T |
| 10 | npm `@opencode/cli` latest `2.0.29`, bin `{opencode, opencode2}`, repo `anomalyco/opencode`, maintainer `thdxr`, 12 platform `optionalDependencies` (§8) | `npm view @opencode/cli version bin`; `repository.url`, `maintainers`, `optionalDependencies` | T |
| 11 | npm `opencode-ai` latest `1.19.0`, `latest-1` `1.1.4`, 12243 versions, none `2.*`, same maintainer (§8) | `npm view opencode-ai version` → `1.19.0`; `dist-tags.latest-1` → `1.1.4`; `versions` count 12243, `2.x` count 0; `maintainers` → `thdxr` | T |
| 12 | `opencode api GET /openapi.json`: OpenAPI 3.1.0, title "opencode HttpApi", version 0.0.1, 142 operations in 118 paths, 276536 bytes (§3) | saved doc; `wc -c` → 276536; node count → paths 118, operations 142 | T |
| 13 | Every operation in the §3 table exists (§3) | operationIds include `session.create/get/list/prompt/interrupt/remove/active/switchModel/switchAgent`, `session.permission.list/reply`, `session.form.list/reply`, `session.inbox.list/cancel`, `session.message.list`, `experimental.session.wait`, `event.subscribe` (`/api/event`), `session.log`, `server.info` | T |
| 14 | `session.prompt` body `text*` + `id/files/agents/skills/metadata/delivery/resume`; `delivery` enum `steer|queue`; `session.active` value `{"type":"running"}` (§3) | requestBody schema; `Session.Inbox.Delivery` = `["steer","queue"]`; `SessionActive` = `{type:{enum:["running"]}}` | T |
| 15 | as-63 cost `0.0014781`, tokens input 14499/output 11/reasoning 130/cache 0,0, model `opencode-go/muse-spark-1.3-contributor` variant `default`, times 01:11:48.813 / 52.277 / 52.284 (§5.2, §7) | `opencode api session.get --param sessionID=ses_ec2e274caffejezR5IoGa0AgvB`; epoch→UTC via `date -u -d @...` | T |
| 16 | as-63 messages: `agent-switched` 50.586, `user` 50.668, `assistant` created 50.685 / streamed 52.255 / completed 52.277 / finish `stop`, `idle` 52.284 (§5.2) | `opencode api session.message.list` | T |
| 17 | as-63 `permission.list`/`form.list`/`inbox.list` empty; `permission.request.list` → `{"location":{"directory":"/home/taisung"},"data":[]}` (§5.2) | three `…list` reads | T |
| 18 | `session.list --param search=AO:as-6` returns `AO:as-63`; response is `{data,cursor}` (§3) | `opencode api session.list --param search=AO:as-6` → titles `["AO:as-63"]`, keys `["data","cursor"]` | T |
| 19 | §10 as-63 launch facts: TUI argv `["--session","ses_ec2e...","--prompt", <launch prompt>]` at 01:11:49.179Z; user msg 50.668Z; answer completed 52.277Z; first `cli starting` 2.0.29 at 20:22:31.408Z; `background service starting` 20:22:31.455Z; earlier `upgraded method=curl target=1.18.33/34/35` (§10, §3) | `grep` of `~/.local/share/opencode/log/opencode.log` (line 127298 etc.) | T |
| 20 | agent-skills `skills/ao-spawn/SKILL.md:79` opencode "Discards" row; `:81-87` "eager; opencode is patient"/"no-op"/"harmless to the patient one"; `:90-92` "OpenCode special handling"; `:94-110` "emits ONLY `--model`" / "never a variant/effort flag"; `:434` "**No** — discards the title entirely"/"sits at its splash screen"; `:436-438` "opencode is safe because it ignores everything" (§10) | `sed -n` on `/home/taisung/agent-skills/skills/ao-spawn/SKILL.md` | T |
| 21 | agent-skills `skills/ao-communicate/SKILL.md:151-170`: no-turn rule (line 151) and `esc interrupt` rule (line 167) (§10) | `sed -n '145,175p'` | T |
| 22 | agent-skills `skills/ao-lifecycle/SKILL.md:149-225`: OpenCode watcher rows (§10) | `sed -n '145,175p'` — OpenCode rows begin at 149 | T |
| 23 | agent-skills `development/TODO_TRACKING.md:383` D-28; `:490-491` "measured on the 1.18.34 layout only"; `:492-493` "landed in a bash prompt, because that pane ran no agent" (§9, §11, §16) | `sed -n '380,386p'`, `'487,495p'` | T |
| 24 | `fleet_watch.sh`: `pane_opencode_turn_runs` `:755-767` used `:921`; `opencode_spinner_frames` `:949` used `:1041`; R4 `:134-144`; `REFUSAL_RE` `:145`; `pane_has_refusal` `:1052`; used `:1227-1229`; R6 `:573-665`, `:739` (§9) | `sed -n` at each range | T |
| 25 | `~/.opencode/bin/opencode2` 47 bytes, body `#!/bin/sh` + `exec "$(dirname "$0")/opencode" "$@"`; `opencode` 211064288 bytes mtime 1985-10-26; `~/.bashrc:239` sets the PATH (§8) | `ls -l`, `wc -c`, `cat`, `sed -n '239p'` | T |
| 26 | v2 installer 488 lines, sha256 `bc70dd31…9d87`, `INSTALL_DIR=$HOME/.opencode/bin`, metadata from `https://opencode.ai/update/api/latest/cli/npm`, writes `opencode2`, `--no-modify-path` (§8) | `curl -fsSL https://opencode.ai/v2/install`; `wc -l`; `sha256sum`; `grep -n` | T |
| 27 | `core/src/plugin-registry.ts:46` is the opencode agent entry (§4 row 13) | `sed -n '46p'` | T |
| 28 | `runtime-tmux/src/index.ts:67-79`: `tmux new-session -d` then `send-keys` of the launch script (§11) | `sed -n '60,85p'` → new-session at 67, send-keys at 77/79 | T |
| 29 | §12 pointers: `parseUpdatedTimestamp:38`, `parseSessionList:62`, `buildSessionLookupScript:185`, `branchOnOpenCodeMajor:235`, uses of `buildLegacySessionOptions:349/:455`, `buildResumeCommand:344`, `findOpenCodeSession:372`, `detect():700` with the 1.x comment `:702-703` (§12) | `grep -n` + `sed` — all present (see m-6 for the comment-start drift) | T |
| 30 | `getSessionInfo` returns the title as `summary` with `summaryIsFallback: true` and no cost (`index.ts:656-665`); `getRestoreCommand` uses metadata ID then title (`:668-678`); `isProcessRunning` at `:599` (§4 rows 5, 8, 18, 19) | `sed` / `grep` | T |
| 31 | §13 I-4 "the seven required `getActivityState` tests (CLAUDE.md)" and "constraint C-02" | `CLAUDE.md:417-424` lists exactly 7 tests; `C-02` = "Test new command, lifecycle, and adapter behavior" | T |
| 32 | §11 spawn path: `session-manager.ts:959 spawn`, `:1134 plugins.runtime.create`, `:1203 postLaunchSetup`, `:1207-1219` title discovery, `:1224` post-launch catch; `:585-615 resolveOpenCodeSessionReuse`; `:2029 getOpenCodeSessionUpdatedAt`; `:2363-2379` remap (§11, §4) | `grep -n` + `sed` | T |
| 33 | §9/§1.4 "an attached TUI is invisible to the API" (§5.3) | would require attaching a TUI to a live session, outside the read-only rule | C |

**True: 32. False: 0. Cannot check: 1** (plus the two time-dependent figures in m-4).

## Scope (brief item 3)

All four owner parts are covered:

1. drop the 1.x branch — §12 (code list) and I-1.
2. `ao send`, activity state and cost through the 2.x API — I-5 (send), I-4 (activity, cost, session
   info).
3. fix the `ao start` install — I-6.
4. 2.x pane census for the `fleet_watch.sh` OpenCode rules — §9, I-7, measurements M-1/M-2/M-7/M-8.

No part is missing. Part 4 is planned rather than executed, which is correct for a phase-1 survey:
the census needs running renders (M-1 to M-8), and Q4 gates the environment. The agent-skills edits
are correctly scoped out to a separate arc (I-7, per agent-skills' own review rules).

## The plan (brief item 4)

Each increment is one file-set for one author/reviewer and keeps `typecheck`/`lint`/`test` green with
new tests. Order: I-1/I-6 first; I-2 before I-3 and I-4; I-5 last. This holds. I-2's single API helper
is a prerequisite for I-3's `prepareAgentSession` hook and for I-4/I-5; I-3 and I-4 are independent
of each other; I-5 depends on M-4/M-5, which are declared in its row. Risk classes are right: I-3
(every OpenCode spawn) and I-5 (every message) are HIGH; I-2 and I-4 are MEDIUM; I-1 (a deliberate
owner decision to abandon 1.x) and I-6 are LOW.

No dependency is missing in the sense the brief asks about: every increment that needs a measurement
names it (I-4 → M-1..M-3; I-5 → M-4, M-5; I-7 → §9's M-1/M-2/M-7/M-8). The only friction is that the
I-7 row does not restate its M-dependencies inline (m-3). One decision pair, Q6 and Q9, must be
settled before I-1's `detect()` gate is final; both are in §15, and §13 already makes each increment
owner-approved.

## Measurements M-1 to M-8 (brief item 5)

Each method is clear and self-contained. M-1/M-2/M-8 share one run (a `sleep` turn with periodic
`session.active`/`session.get` polls); M-3 extends it with a permission prompt, a question and a
rejected model; M-4/M-5 exercise `session.prompt` against an attached TUI; M-6 is one throwaway
`ao spawn`; M-7 is observational (cannot be forced). None of them needs a change to a global store, a
global service, or the owner's login *except* where the note says the owner decides: §14 states that
every one needs a real provider and therefore either the global service (writes to the real store) or
an isolated store with the owner's login, which is exactly Q4. That caveat is stated up front, so the
question is answered the way the brief allows.

## Owner questions Q1 to Q9 (brief item 6)

Each question is needed, clear, and carries a recommendation where one is possible: Q1 (npm
`@opencode/cli`), Q2 (one `core/src/opencode-api.ts`), Q3 (poll in I-4), Q7 (stored ID only), Q8
(count `reasoning` in `outputTokens`). Q4/Q5/Q6/Q9 deliberately offer options without a
recommendation; Q4 depends on the owner's environment, Q5 on M-5, Q6 and Q9 on the owner's version
policy. No decision the owner must make before I-1 is missing — the ones that gate I-1 are Q6 (1.x
host behavior) and Q9 (major 2 vs a 2.0.29 floor), both listed. A reader could wish Q6/Q9 had a
recommendation, but the note is explicit that the owner decides.

## Notes

- Read-only discipline observed: only `opencode --version`, `opencode api --help`, `opencode api GET
  …`, and `opencode api <operation>` reads (`session.get`, `session.list`, `session.message.list`,
  `session.active`, `session.inbox.list`, `session.permission.list`, `session.form.list`,
  `permission.request.list`) were run. No session was created, prompted, changed, aborted, shared,
  forked or deleted, and the service was not stopped. No `ao` command, model CLI, installer run, or
  pattern-based kill was used.
- The one claim I could not re-sample (#33, §5.3) is a measured claim whose consequence — a spawn
  check must read the pane process, and the API confirms only the session (I-3 step 2) — is sound
  regardless.
