# Review — 0010 OpenCode 2.x model-turn measurements M-1 to M-8 (round 1)

**Reviewer**: DeepSeek V4.1 Flash
**File reviewed**: `development/0010_opencode_2x_model_turn_measurements.md`, commit `95a1328d`, range
`439c16fb..95a1328d` (one file).
**Worktree HEAD**: `95a1328d` (verified `git log --oneline -1`).
**Date**: 2026-10-15 (UTC).
**Method**: receipts review. Read-only `opencode api` reads against the running 2.0.29 service
(`session.get`, `session.list`, `session.active`, `config.get`, `agent.get`, `model.list`,
`GET /openapi.json`), the ao source at `95a1328d`, the global OpenCode log, the global config, the
process environment of the service PID, one private tmux probe, and the filesystem. No tracked file was
edited; nothing was committed. No session was created, prompted, changed, aborted, shared, forked,
deleted or removed; the service was not stopped or signalled; no `ao`, `claude`, `codex` or model CLI
was run; no pattern-based kill was used.

## Verdict

**ACCEPT**

0 majors, 7 minors. The note keeps its own standard: every measurement names its evidence, every
record carries the service's millisecond timestamps, and the conclusions are bounded to what one cheap
model on one host with eight throwaway sessions can show. I re-derived the externally checkable parts
of §5.1, §9, §11.1, §11.2, §11.3 and §12 and every one is true, including the two failure modes it
found (the `opencode api` pipe truncation and the tmux 3.4 `-e PATH` drop). The five plan changes the
brief asks about (I-2, I-3, I-4, I-5, I-7) and §9 are each supported by the evidence they cite. The
findings below are count, range and framing nits; none changes a decision.

## Findings

### m-1 — §1 result 8 and §10 disagree on the M-8 poll count (150 vs 152)

Section §1 (result 8) and §10. §1 says "`session.active` said `running` at each of **150** polls"; §10
says "Of 190 polls, **152** read `running`". The two counts are for the same run and cannot both be
right; §10's figure is the internally consistent one (190 polls × 2 s = 380 s, the poll window
02:53:29.137–02:58:31.169).

```
$ sed -n '47,49p;428,429p' development/0010_opencode_2x_model_turn_measurements.md
47: 8. **M-8, long tool call.** During a 300 s shell call, `session.active` said `running` at each of 150
48:    polls, ...
428: **Evidence** (measured): the shell tool ran from 02:53:31.017 to 02:58:31.042 ...
429: ... Of 190 polls, 152 read `running` (02:53:29.137 to 02:58:31.169).
```

The note's conclusions (R3, I-4, "the running tool part is the only API record") do not depend on the
count. Minor.

### m-2 — §2 `17 prompts, below the limit of 20`: the limit of 20 has no source

Section §2, "Model turns". "17 prompts, below the limit of 20." Neither the note, note 0009 §14, nor
this reviewer's brief names a limit of 20, and no command or document is given for it. It reads like a
constraint the author imposed (probably the dispatch brief), but by the note's own standard it should
carry a source. No decision depends on it. Minor.

### m-3 — §1 result 2 "6 to 18 ms after the final answer": the 18 ms is a different quantity

Section §1 (result 2), against §4, §6, §7.1, §7.3 and §8. The claim is that `time.idle` and `outcome` are
"written 6 to 18 ms after the final answer". The idle-after-answer deltas quoted in the note are:

```
S1  §3/§4   final answer 02:42:29.146 → idle 02:42:29.152   = 6 ms
S5  §5.3    user 02:49:00.583         → idle 02:49:00.590   = 7 ms (failed turn, no answer)
S6  §6      answer 02:49:54.742       → idle 02:49:54.750   = 8 ms
M6  §8      answer 02:57:33.147       → idle 02:57:33.156   = 9 ms
S7  §7.1    answer 02:52:46.563       → idle 02:52:46.573   = 10 ms
```

The only "18 ms" in the note is §7.3, "`experimental.session.wait` returned at 02:49:54.768, 18 ms
after the idle record" — the wait-vs-idle delta, not the idle-vs-answer delta. The quoted upper bound
therefore comes from a different measurement. The conclusion ("they describe the last finished turn")
holds. Minor.

### m-4 — §8/§1 result 6 "acts on the pointer title": the wait instruction arrives via the launch prompt

Section §8 and §1 (result 6). The result says a 2.x Muse worker "acts on the pointer title, starts no
work, and blocks in a shell loop". The worker's decision to wait, however, is carried by the launch
prompt, not the title alone: `buildPrompt` puts the spawn task string into a `## Task` line
`Work on issue: <title>` (`packages/core/src/prompt-builder.ts:87-91`), so the `ao spawn` argument
("... wait and do nothing until it appears") reaches the model as prompt text. The note itself shows
the `user` message as "the ao launch prompt, task line `Work on issue: ao1m-m6: Read .agent_task.md ...`",
so the mechanism is visible; the one-line result attributes it to the title. The operational
conclusion (no `ao send` is needed for the brief pickup) is unaffected. Minor.

```
$ sed -n '86,92p' packages/core/src/prompt-builder.ts
86:   if (issueId) {
87:     lines.push(`\n## Task`);
88:     lines.push(`Work on issue: ${issueId}`);
```

### m-5 — §14 open items 6, 7 and 8 name no decision for the owner

Section §14. The brief asks that each open item name what the owner must decide. Items 1–5 do (keep the
global allow-all rules or pass a session ruleset; decide Q3 or approve the event part; measure the
no-TUI tool environment before I-3/I-5; fix the pane PATH; keep the first real backend error). Items 6
("`status=killed` ... Not analyzed"), 7 ("`worktreeDir` ... Low") and 8 (DeepSeek V4.1 Flash refusal,
"Low") are leads or reliability notes with no decision attached. Minor.

### m-6 — §5.5/§13 I-3 "cannot catch a model that does not exist": one no-provider sample

Section §5.5 and §13 (I-3). The conclusion generalises from S5, whose model reference
`{providerID:"ao1m-none", id:"none"}` names a provider that does not exist at all. That shows
`session.create` does not validate a model and that a `session.get` readback echoes it; it is one
sample, and it does not distinguish "no such provider" from "known provider, unknown model id" (for
example `opencode-go/<garbage>`). The proposed fix (check against `model.list` first, or read the first
turn's outcome) is still the safe reading. Minor.

### m-7 — §5.5 "`outcome "interrupted"` decays by age like `succeeded`" is inferred, not measured

Section §5.5 (and §13, §5.4). The only measured fact is that `session.interrupt` on S4 produced
`outcome "interrupted"` (with `time.idle`); nothing in the run shows how an `interrupted` outcome ages,
so "decays by age like `succeeded`" is a design choice, not an observation. The note marks the other
inferences as such; this one is stated as fact. Minor.

## Spot checks

Legend: **T** = true, **F** = false, **C** = cannot check.

| # | Claim (section) | Source checked | Result |
|---|---|---|---|
| 1 | HEAD is `95a1328d` (§3 of the brief) | `git log --oneline -1` → `95a1328d docs(development): add 0010 ...` | T |
| 2 | Host is OpenCode 2.0.29, tmux 3.4, service PID 4171365 (§2, §11.3) | `opencode --version` → `2.0.29`; `tmux -V` → `3.4`; `ps -p 4171365` → `opencode serve --service`, started Wed Oct 14 16:22:30 2026 | T |
| 3 | All 8 listed sessions are gone (§12) | `opencode api session.get --param sessionID=<id>` for S1–S7 and M6 → `SessionNotFoundError` / `HTTP 404` on all 8 | T |
| 4 | The two title searches return nothing and no recent title matches (§12) | `session.list --param search=AO-MEASURE-2026-10-14:` → `{"data":[],...}`; `search=AO:ao1m1014m6` → `{"data":[],...}`; newest 200 titles → 0 hits for `AO-MEASURE\|ao1m` | T |
| 5 | `GET /openapi.json` is 276536 bytes with the named operations (§11.1, §3) | 276536 bytes, 118 paths, 142 operations; `session.active/get/create/prompt/interrupt/remove/message.list/permission.list/permission.reply/form.list/form.get/form.cancel/inbox.list/inbox.cancel/experimental.session.wait/model.list/config.get/agent.get/session.list` all present | T |
| 6 | `SessionActive` is `{"type":"running"}` only; `delivery` is `steer\|queue` (§1, §3, §5) | schema `SessionActive` = `{type:{enum:["running"]}}`; `Session.Inbox.Delivery` = `["steer","queue"]` | T |
| 7 | `opencode api` output through a pipe can stop early with exit 0 (§11.1) | 12 × `opencode api GET /openapi.json \| wc -c` → 276536 (7×) and 262144 (5×); direct `opencode api GET /openapi.json >/dev/null` → exit 0 | T (ratio differs from the note's 9/3; run-to-run variance) |
| 8 | `model.list` is 458888 bytes (§11.1) | `opencode api model.list \| wc -c` → 458888 | T |
| 9 | Since the 2.0.29 start the log has exactly four ERROR/WARN lines (§9) | `grep -E 'level=(ERROR\|WARN)'` in 2026-10-14T20:22:31Z‥2026-10-15T03:01Z → 20:38:24 `cli process failed`, 21:50:18 `cli process failed`, 01:18:16 `schema rejection`, 02:49:00.590 `Failed to drain Session` (S5) | T |
| 10 | The `service_overloaded`/`rate_limit_exceeded`/`opt in` hits are `message=evaluated` grep lines (§9) | `grep -c` → 5 / 3 / 3; each is `level=INFO ... message=evaluated permission=bash pattern="grep ..."` | T |
| 11 | The service process carries 9 `AO_*` variables of `nex-orchestrator` (§11.2) | `tr '\0' '\n' < /proc/4171365/environ \| grep '^AO_' \| wc -l` → 9, incl. `AO_SESSION_ID=nex-orchestrator`, `AO_CONFIG_PATH=/Data1/NgFEP/Nexus/agent-orchestrator.yaml` | T |
| 12 | tmux 3.4 stores `new-session -e PATH` but does not apply it to the pane (§11.3) | private server: pane `PATH` has no `/opt/ao1m` (0 matches) while `show-environment -t probe PATH` → `PATH=/opt/ao1m:/usr/bin:/bin`; `-e AO1M_PROBE=hello` did reach the pane | T |
| 13 | Global rules allow every action; the `build` ruleset is as listed (§5.1) | `config.get` → document `/home/taisung/.config/opencode/opencode.json`, `permissions [{"action":"*","resource":"*","effect":"allow"}]`; `agent.get build` → `*/*/allow`, `read *.env ask`, `read *.env.* ask`, `read *.env.example allow`, `question/*/allow`, `*/*/allow`, `browser/*/deny` | T |
| 14 | `session-manager.ts:1283-1285` is the launch-prompt branch that sets `promptDelivered` (§8) | `sed -n '1282,1287p'` → `1283 } else if (agentLaunchConfig.prompt) {` / `1284 session.metadata["promptDelivered"] = "true";` / `1285 }` | T |
| 15 | `workspace-worktree/src/index.ts:91-93` reads `worktreeDir` from plugin config (§8) | `sed -n '91,93p'` → `const worktreeBaseDir = config?.worktreeDir ? expandPath(...) : join(homedir(), ".worktrees");` | T |
| 16 | Cleanup: the scratch paths and tmux servers are gone and no `ao1m` process remains (§12) | `/tmp/ao1m-work`, `/tmp/ao1m-outside`, `/tmp/ao1m-spawn`, `~/.worktrees/ao1m-scratch` all absent; `tmux -L ao1m-tui/ao1m-spawn/ao1m-envtest ls` → no server; `ps -eo pid,cmd \| grep ao1m` → none; `~/.ao/bin/.ao-version` → `0.2.1` | T |
| 17 | The log still holds the removed sessions and their key events and times (§8, §12, §5.3, §7.1) | all 8 IDs present (214–1518 lines each); S1 create CLI 02:41:39.963; S5 `ao1m-none` create CLI 02:48:41.125 and the `Failed to drain Session` at 02:49:00.590; S7 `session.prompt` 02:52:16.473; M6 create CLI 02:54:19.581 and the exact loop `i=0; while [ ! -f .agent_task.md ] && [ $i -lt 1080 ]; ...` at 02:54:31.803 | T |
| 18 | `session.create` accepts `permissions` and `model` (the S3 and S5 shapes) (§5.1, §5.3) | `session.create` body properties include `permissions` (`Permission.Ruleset`) and `model`; the request shapes are valid. The S3 behaviour (a session ruleset makes it ask) and S5 (create exits 0) were not re-run: both need a write, outside the read-only rule | T (schema) |
| 19 | §11.5 pane census: the running, permission, question and failed renders (§11.5) | would need a live TUI render or a model turn, both excluded by the brief | C |
| 20 | §11.1 Node `execFile`/`spawn` rows (busy event loop, fd stdout) | not re-run: reproducing the busy-loop cases is out of scope for a receipts pass; the load-bearing pipe row (#7) reproduced | C |

**True: 18. False: 0. Cannot check: 2** (the pane census #19 and the Node-helper rows #20; both are
secondary).

## The changes to the 0009 plan (brief item 4)

Each proposed change is supported by the evidence it cites:

- **I-2** ("the helper writes `opencode api` stdout to a file or checks the JSON; exit 0 is not
  proof"). Supported by §11.1; I reproduced the truncation (spot check 7). This is the strongest of the
  side results and deserves to be in I-2's brief.
- **I-3** ("`session.create` accepts a model without a route; check the model before the create, or
  read the first turn's outcome"; set `promptDelivered` from the first `user` message; check the
  `status=killed` write). Supported by §5.3 (S5) and §8 (M-6: `ao spawn` printed 3.0 s before the
  prompt landed, and `promptDelivered=true` came from the branch at `session-manager.ts:1283-1285`).
  The model-check half rests on one no-provider sample (m-6); the safe reading stands.
- **I-4** (activity, cost and session info from the API). Supported by M-1 (`session.active` is the busy
  record), M-2 (`time.updated`/`time.idle` semantics), M-3 (per-session lists; `form.list` is the
  question record) and M-8 (the running tool part). The cascade change ("lists before `session.active`",
  timestamp "now" while active, compare `time.idle` with the last `user` message) follows.
- **I-5** (`ao send` through `session.prompt`, default `queue`, say when a send waits behind a pending
  permission or form, use `experimental.session.wait` for `--wait`). Supported by M-4 (a prompt to an
  attached TUI shows and runs once) and M-5 (neither delivery interrupts a running tool; `steer`
  replaced the model's own final answer in 2 of 2 runs). The note states the `steer` result as "2 of 2",
  which is honest for one model.
- **I-7** (OpenCode 2.x is eager and polls for the brief; no ping needed). Supported by M-6, subject to
  the m-4 framing nit; the operational point (no `ao send` after the brief) is what I-7 needs.
- **§9** (R1 → `session.active`; R2 → not active + `time.idle` age; R3 keep the pane rule, an API rule
  needs the running tool part; R4/R5 keep). R1 is backed by M-1, R2 by M-2, R3 by M-8 and M-6, and R4/R5
  stay on the pane because M-7 has no 2.x case. Consistent.

No change in the note asks for more than its evidence shows, and none is missing.

## Open items for the owner (brief item 5)

Items 1–5 are clear and each names a decision (see m-5 for the wording of items 6–8). Item 3 (the
no-TUI tool environment) is the one with a live dependency: §11.2 shows the service itself carries
`AO_*` of `nex-orchestrator`, so if an API-only tool inherited the service environment, the `gh`/`git`
wrappers would write metadata for `nex-orchestrator`. The note flags that this must be settled before
I-3 and I-5 land, which is the right gate.

## Notes

- Read-only discipline observed: only `opencode --version`, `api GET /openapi.json`, `session.get`,
  `session.list`, `config.get`, `agent.get` and `model.list` were run, plus one private tmux probe on a
  server I started and stopped, and file/log/`/proc` reads. No session was written, and the service was
  not touched.
- The log is an unusually good receipt for this note: because the worker removed the sessions but not
  the service, all eight IDs and their create/prompt/tool events survive, so §12's "removal" list and
  §8's M-6 sequence can be re-checked without a model turn (spot check 17).
- The two side results carry more weight than their "other results" heading suggests: §11.1 changes
  I-2's helper contract, and §11.3 affects every PATH-wrapper agent, not only this arc. Both are true
  here.
