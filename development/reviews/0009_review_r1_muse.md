# Review R1: 0009 OpenCode 2.x API fit design (reviewer: Muse)

**Verdict: ACCEPT**

14 spot checks run: 13 true, 1 true-in-substance with an imprecise line number (m-1);
2 isolated-store measurements cannot be re-checked (disclosed single-witness, §5.2/§5.3/§6).
4 minor findings, 0 major. Scope fully covered; plan order and risks sound.

## Findings

### m-1 (§4 row 12): line reference imprecise — `cli/src/lib/detect-agent.ts:21`
- Note says row 12 "`cli/src/lib/detect-agent.ts:21` | calls `detect()`".
- Evidence: `sed -n '20,25p'` shows :21 is inside the `AGENT_PLUGINS` table entry;
  the actual `mod.detect()` call is at `:36`
  (`if (typeof mod?.detect === "function" && mod.detect())`).
- Substance is true (detection does go through each plugin's `detect()`), so no
  decision depends on it. Fix the line number when touching the table.

### m-2 (§15): Q5, Q6, Q9 carry no recommendation
- Q5 (queue vs steer default), Q6 (hide OpenCode on 1.x vs fail-with-message),
  Q9 (gate on major 2 vs floor 2.0.29) present two options with no recommended one.
- Q4 correctly has none (owner credentials involved). Q1/Q2/Q3/Q7/Q8 have one.
- Not blocking, but Q9 feeds directly into I-1's version gate (row 7 says
  "major ≥ 2"), so the owner should answer Q9 before I-1 starts. Recommend: state
  a default for Q5 (queue — non-interruptive) and Q9 (major 2, per row 7) in the
  increment briefs.

### m-3 (§13–§14): M-6 not listed as an input to any increment
- M-6 (what a 2.x Muse worker does with a pointer title and no brief) is queued
  as a free-floating measurement, but I-3's prompt-delivery check (§11 step 3:
  "`session.message.list` shows a `user` message ... core sets `promptDelivered`")
  and I-7's protocol-text rewrite both assume the worker waits for the brief.
  §10 itself says the pointer title "is what keeps the worker from acting before
  `.agent_task.md` exists."
- Suggest: list M-6 as a precondition for I-3 (or for the I-7 protocol text,
  whichever lands the eager-worker claim first).

### m-4 (§3, §5.2, §5.3, §6): isolated-store measurements are single-witness
- The byte-identical OpenAPI copies (276536 bytes), SSE buffering loss through
  the CLI, `session.log` replay failure, attached-TUI invisibility, and
  `session.prompt` admission with `resume:false` were measured against an isolated
  store (port 49413) that no longer runs, so they cannot be re-checked now.
- The note discloses the method for each, and every global-service re-checkable
  claim I sampled reproduced exactly, so this limits depth, not trust. No action;
  record M-1..M-5 as the re-verification path.

## Receipts (§1 of brief: claims without a source)
- None load-bearing. Every factual claim I sampled names a command, a `file:line`,
  the OpenAPI document, the 2.0.29 binary, or a named agent-skills file:line.
  Two hedges are explicit and correct to hedge: §8 "most likely came from the v2
  curl installer ... (read and inferred; no record names the command)" and §6/§14
  "not measured, because each one needs a model turn (M-4, M-5)".

## Spot checks (14)

1. **packages file:line — `ao spawn` success path** (§11): TRUE.
   `cli/src/commands/spawn.ts:101` `sm.spawn(...)`, `:127`
   `spinner.succeed("Session ... spawned")`; `core/src/session-manager.ts:1130`
   `try {` wraps `plugins.runtime.create`, `:1150-1170` catch removes workspace +
   reserved ID; `runtime-tmux/src/index.ts:67-79` types the script via `send-keys`
   with no exit-status read; `:1207-1219` 10 s title discovery. No step reads the
   script's exit status — the "reports success on a dead pane" claim holds.
2. **packages file:line — `detectActivity` idle→active** (§5.1): TRUE.
   `agent-opencode/src/index.ts:527-544`: last-line `^[>$#]\s*$` test, four
   `waiting_input` regexes, else `active`. The §5.1 capture's last line is
   `/tmp/ao1s-work:main ... shift+tab agents ctrl+p commands ...` — matches
   neither branch, so `active`. (dist/ not built in this worktree; verified by
   executing the same logic. `send.ts:137` default `--timeout 600` confirms the
   600 s wait consequence.)
3. **npm claim** (§8): TRUE.
   `npm view @opencode/cli version` → `2.0.29`;
   `npm view @opencode/cli bin` → `{opencode, opencode2}`;
   repository → `git+https://github.com/anomalyco/opencode.git`, maintainer `thdxr`
   (also `opencode-ai`'s maintainer); 1054 versions, latest `2.0.29`.
   `npm view opencode-ai version` → `1.19.0`; 12243 versions, zero `2.*`;
   12 `optionalDependencies` (`-linux-x64` + 11); `opencode-ai` bin is `opencode` only.
4. **OpenAPI claim** (§3): TRUE (read-only `opencode api GET /openapi.json`).
   `openapi 3.1.0`, `info.title "opencode HttpApi"`, version `0.0.1`,
   description `"Experimental HttpApi surface for selected instance routes"`,
   **142 operations in 118 paths**, 276536 bytes. `session.active` description
   matches verbatim ("foreground Session drains ... absent ... inactive");
   `session.prompt` description matches ("Durably admit one session input ...");
   `event.subscribe` carries the volatile-consumer warning.
5. **agent-skills `ao-spawn/SKILL.md:79`** (§10): TRUE — line holds
   "**Discards** the spawn prompt entirely; sits at its splash screen until
   `ao send` arrives" verbatim.
6. **agent-skills `ao-spawn/SKILL.md:434,436-438`** (§10): TRUE — table holds
   "**No** — discards the title entirely" / "sits at its splash screen" and the
   "safe because it ignores everything" gloss verbatim; `:81-87`
   ("claude-code and codex are eager; opencode is patient") and `:90-92`,
   `:94-110` ("emits ONLY `--model`", "never a variant/effort flag") also exact.
7. **as-63 cost/tokens** (§7): TRUE (read-only `session.get`).
   `cost 0.0014781`, `tokens {input 14499, output 11, reasoning 130,
   cache {read 0, write 0}}`, model `opencode-go/muse-spark-1.3-contributor`
   variant `default`, `outcome "succeeded"`. `status.ts` contains no `cost`
   reference — "no ao command prints cost" holds. `agent-claude-code:377-379`
   adds `cache_read_input_tokens + cache_creation_input_tokens` to input — the
   mapping precedent is real.
8. **API vs CLI list scope** (§3, rows 6/10): TRUE.
   `session.list --param limit=200` → 200 rows across 11 `projectID`s;
   `--param search=AO:as-6` → the session titled `AO:as-63` (substring hazard
   real — exact-title filtering required). CLI `opencode session list`
   (`list ... in the current project, newest first` per `--help`) → 3 rows from
   both the worktree and `/tmp`, vs 200 via the API.
9. **`GET /doc` HTML** (§3): TRUE — `opencode api GET /doc` returns
   `<!doctype html>` web-app shell, not the document.
10. **Outcome census** (§5.2): TRUE — of the 200 listed sessions exactly 8 carry
    an `outcome`, all `"succeeded"`.
11. **Launch-prompt submission** (§10): TRUE — log shows the TUI starting at
    `01:11:49.179Z` with `--session ses_ec2e... --prompt "<2134-char prompt>"`;
    the `user` message is 2134 chars, ~1.5 s after TUI start; answer `OK`
    completes `01:11:52.277Z`. A 2.x worker is eager, not patient.
12. **Binary notification map** (§5.4): TRUE — `strings` on the installed binary
    finds plugin `opencode.notifications` with `form.created`→"Input needs
    response", `permission.asked`→"Permission needs input",
    `session.execution.started/succeeded/interrupted/failed`→running/"Session
    done"/"Session failed".
13. **Host install forensics** (§8): TRUE — `~/.opencode/bin/opencode`
    211064288 bytes mtime 1985-10-26 (npm-tarball fixed mtime), `opencode2`
    47-byte shim identical to the installer heredoc, `~/.bashrc:239` PATH export,
    first 2.0.29 log line `cli starting version=2.0.29 channel=latest`.
    v2 installer fetched as text: 488 lines, sha256 `bc70dd31…`, queries
    `update/api/latest/cli/npm`, `INSTALL_DIR=$HOME/.opencode/bin`.
14. **Idle API reads on as-63** (§5.2): TRUE — `session.active` does not contain
    as-63; `permission.list`, `form.list`, `inbox.list` all `{"data":[]}`;
    `session.log after=0` returns only `log.synced seq 13`, as the note says.
    Cannot-check (by design, no model turn run): busy/permission/question/error
    values, M-1..M-8, §5.3 attach, §6 TUI delivery — all explicitly marked
    unmeasured in the note.

## Scope (§3 of brief: the four owner parts)
1. **Drop the 1.x branch** — I-1, file list in §12 verified to exist
   (`buildSessionIdCaptureScript` :82, `buildSessionLookupScript` :185,
   `OPENCODE_API_MAJOR`/`branchOnOpenCodeMajor` :228-237,
   `buildLegacySessionOptions` :268, `buildResumeCommand` :344,
   `getLaunchCommand` :455-509, `detect()` :700-709). Covered.
2. **send / activity / cost via 2.x API** — I-4 (activity, cost, session info),
   I-5 (`session.prompt` send hook). Covered, ordered after its measurements.
3. **`ao start` install** — I-6 (`start.ts:359-364` verified offering
   `opencode-ai`). Covered.
4. **2.x pane census for `fleet_watch.sh`** — I-7 plus M-1/M-2/M-8; D-28
   (`TODO_TRACKING.md:383`), the 1.18.34-only caveat (`:490-491`), R1
   (`:755-767` used at `:921`), R4 (`:134-144`) all verified to read as cited.
   Covered (delegated to agent-skills with its own review rules, as stated).

## Plan (§4 of brief: I-1..I-7)
- Buildable alone in order: yes. I-1/I-6 independent first; I-2 (helper + ID
  lookup) before I-3 (Node-side create) and I-4 (API activity); I-5 last behind
  M-4/M-5. `core/src/opencode-api.ts` does not exist yet — correctly proposed as
  new; no `prepareAgentSession`/`confirmLaunch` hooks in `types.ts` yet — correctly
  proposed as new.
- Risk classes: LOW (I-1 owner-directed 1.x loss; I-6 npm row), MEDIUM (I-2
  cleanup/reuse; I-4 status), HIGH (I-3 spawn path; I-5 every send) — all
  proportionate. I-7 defers to agent-skills rules, correct for CRITICAL protocol text.
- Dependencies: I-4←M-1..M-3 and I-5←M-4/M-5 declared; M-6→I-3 missing (m-3).

## M-1..M-8 (§5 of brief)
- Each method is concrete (sleep-30 + 1 s polls; permission/question prompts;
  attach + one `session.prompt`; throwaway spawn; opportunistic error capture;
  5-min sleep) and runs read-only against the chosen environment. The credential
  boundary is stated once up front (global service vs owner login to isolated
  store, Q4) instead of per-row — acceptable, since Q4 governs all eight.

## Q1..Q9 (§6 of brief)
- Each needed and clearly posed; Q1/Q2/Q3/Q7/Q8 carry recommendations.
  Q4 rightly none. Q5/Q6/Q9 would benefit from one (m-2); Q9 must be answered
  before I-1 (gates on "major ≥ 2" per row 7).
