# Review: 0010 OpenCode 2.x model-turn measurements (round 1, Muse)

Verdict: `ACCEPT`

Reviewer: Muse Spark 1.3 Contributor. Under review: `development/0010_opencode_2x_model_turn_measurements.md`
at commit `95a1328d` (range `439c16fb..95a1328d`, one file, 590 insertions). Worktree HEAD confirmed
`95a1328d`. Author: Claude Opus 5.5. Style: receipts. No tracked file edited, nothing committed,
no model turn run, read-only commands only.

0 majors, 6 minors. Every decision-relevant claim has a named source or is explicitly marked
open/inferred. All M-1..M-8 scope from 0009 §14 is covered as briefed; the two gaps (M-3 event
stream, M-7 forcing) are declared open in §1 and were excluded by the brief, not omitted.

## 1. Receipts — every result names its evidence

No result without a source. Each measurement section carries method-as-run plus a timestamped
evidence table or record dump with the section reference. The three places that go beyond direct
measurement are explicitly marked: §5.5 "most likely comes from questions" (hedged) plus "is not
measured" for the `read *.env` rule interaction; §11.2 "inferred; no record names the starter";
§8 "The writer of `killed` is not found ... Not analyzed." The §12 cost total names its source
(sum of `session.get` costs) but is not itemized (see m-2).

## 2. Consistency — times, counts, IDs agree; conclusions follow

Checked by recomputation from the note's own times (all order correctly, deltas match the claims):

- M-1: tool `sleep 30` ran 02:41:57.668–02:42:27.686 = 30.018 s; first/last `running` polls bracket
  it; idle 6 ms after the final answer. Permission (S3) and question (S4) waits also `running`.
  Conclusion (positive busy record incl. tool calls, permission/question still `running`) follows.
- M-2: `time.updated` chain create → input → step start → step end → final answer, flat across the
  tool call; token math closes exactly (input 11230 → 11404 = +174; cache read 384 → 11904 =
  +11520, i.e. `input` excludes cache reads, supporting the 0009 §7 mapping). S6 stale
  `idle`/`outcome` while a later turn runs supports the §5.5 step-4 comparison. Follows.
- M-3: permission record shape (`action`, `resources`, `source.type "tool"`), form record shape
  (`metadata.kind "question"`, `fields`, plus `state.pending` on `form.get`), S5 38 ms
  prompt-to-`failed` turn (02:49:00.552 → 02:49:00.590), S4 interrupt → `outcome "interrupted"`,
  `finish "error"`, `error.type "aborted"`. The global `form.list` miss vs per-session hit is
  recorded with both outputs. Follows, including the I-3 model-check change.
- M-4: admitted → `user` in 58 ms, answer → `idle` in 8 ms; 5/5/5 user/assistant/idle counts match
  the 5 S6 turns in §12 (rows 8–12). The "S3 and S7: 3 user, 3 assistant, 1 idle" cross-check also
  closes: 3 prompts each (§12 rows 3–5, 13–15), assistant records include the tool-call message, and
  exactly one `idle` because queue/steer landed inside the same run. Follows.
- M-5: S7 order queue-admit → steer-admit → tool end → steered `user` (+15 ms) → STEERED →
  queued `user` (+12 ms) → QUEUED → `idle`; `DONE` never written; `session.active` gapless.
  S3 permission-wait order likewise. `experimental.session.wait` latencies recompute to 19 ms
  (S7) and 18 ms (S6), matching "18 to 19 ms". "Steer replaced the planned answer 2 of 2" is
  exactly what both runs show. Queue-default (Q5) conclusion follows.
- M-6: spawn 02:54:17.346 → print 02:54:18.574 → session 02:54:19.628 → `user` 02:54:21.548, so
  "returned ~3.0 s before the prompt reached the session" checks out; brief written 02:57:31.555
  → tool end 02:57:31.920 = 0.365 s, matching "read the brief 0.365 s after". 90-min loop with
  `"timeout": 0`, `running` throughout, no file change (`git status` only `?? .ao/`, log only
  `init`). Follows.
- M-8: tool 02:53:31.017 → 02:58:31.042 = 300.025 s; 190 polls at 2 s over 380 s; 152 `running`;
  `time.updated`/tokens frozen, then moved at step end; running tool part quoted. Follows.
- Counts: 8 sessions in §12 (S1–S7 + M6), 17 prompt rows, "below the limit of 20" holds.

## 3. Spot checks (read-only, 22 checks)

| # | Check (command / read) | Result |
|---|---|---|
| 1 | `git log --oneline -1` | `95a1328d` as expected |
| 2 | `git show --stat 95a1328d`, `git log --oneline 439c16fb..95a1328d` | one file, 590 insertions |
| 3 | `tmux -V` | `tmux 3.4` — matches §11.3 |
| 4 | `opencode --version` | `opencode v2.0.29` — matches context |
| 5 | `packages/core/src/session-manager.ts:1283-1285` | `else if (agentLaunchConfig.prompt)` sets `promptDelivered = "true"` — §8 citation exact; M-6 launch-check conclusion (record written without delivery check) stands |
| 6 | `packages/plugins/workspace-worktree/src/index.ts:91-93` | `worktreeDir` read from the plugin's own config — §8 citation exact |
| 7 | `packages/plugins/agent-claude-code/src/index.ts:377-379` | adds `input_tokens + cache_read + cache_creation` — §4 mapping citation exact |
| 8–15 | `opencode api session.get --param sessionID=<each of the 8 §12 IDs>` | all 8 → `SessionNotFoundError`, HTTP 404 — removal claim confirmed |
| 16 | `opencode api session.list --param search=AO-MEASURE-2026-10-14:` | `{"data":[]}` — 0 sessions |
| 17 | `opencode api session.list --param search=AO:ao1m1014m6` | `{"data":[]}` — 0 sessions |
| 18 | `opencode api GET /openapi.json` to a file | exactly 276536 bytes — reproduces the §11.1 size; all 14 API operations the note names present (`session.active/get/prompt/interrupt/remove/permission.list/form.list/inbox.list/message.list/create`, `config.get`, `agent.get`, `model.list`, `experimental.session.wait`); `session.retry.scheduled` absent, consistent with the note's "(event name in the binary)" |
| 19 | `grep "Failed to drain Session" ~/.local/share/opencode/log/opencode.log` | exactly 1 line: `2026-10-15T02:49:00.590Z ... Model unavailable: ao1m-none/none` — the S5 record, timestamp matching §5.3 to the millisecond |
| 20 | `grep -c service_overloaded / rate_limit_exceeded` on the log | 8 pre-run lines (5 + 3, all 2026-10-01 `evaluated permission=bash` patterns) — exactly the §9 counts; the 9th hit is the author's own post-run grep at 03:13:11Z, after the measurement window |
| 21 | `grep -c "Code Mode" ~/.opencode/bin/opencode` | 18 hits — §7.4 "Code Mode is a 2.x feature" corroborated in substance (the model's quoted sentence is not verbatim in the binary, see m-6) |
| 22 | recomputed deltas from note times | 0.365 s brief pickup; 18/19 ms wait latency; 30.018 s and 300.025 s tool runs; 38 ms S5 turn — all match |

## 4. Findings

### Minor

- **m-1 (§9, §13 R4/R5).** The five-places failure list item 3 (assistant `finish "error"` shape)
  is evidenced only by the S4 *interrupt*, not by a failure; S5 (the sole failure) showed items
  1, 2, 4, 5. The note does admit "which of 1 to 3 a provider error uses ... is open", so no
  correction to the note is required — but I-4 must not assume the item-3 shape for provider
  errors.
- **m-2 (§12).** Total cost USD 0.011947 names its source (sum of `session.get` `cost` values)
  but gives no per-session itemization; it is unverifiable now that the sessions are removed.
  Itemize per-session costs in future measurement notes.
- **m-3 (§13, §5.5/I-4 row).** Cites "(M-6, M-8)" for reading the running tool part, but §8 shows
  no `message.list` tool-part record during the M-6 wait (only active/updated/tokens plus tool
  start/end times). The tool-part evidence is M-8 only; drop the M-6 citation.
- **m-4 (§14 item 6).** `status=killed` item names no owner decision, unlike items 1–5 ("Decide
  Q3...", "Keep...", "Check..., then decide...", "Keep it, or..."). §13 routes it to I-3
  ("Check the `status=killed` write in I-3") — say that in the item.
- **m-5 (§1 M-2 summary).** "written 6 to 18 ms after the final answer": shown write deltas are
  6 ms (S1), 8 ms (S6), 10 ms (S7); the 18 ms figure is the `session.wait` return latency
  (§7.3), not an idle-write delta. The range still bounds every shown write; the "18" endpoint
  is a different quantity. One-word fix ("6 to ~10 ms; wait returns 18–19 ms after idle").
- **m-6 (§7.4).** The DeepSeek "Code Mode only exposes ..." refusal is quoted from a removed
  session's transcript and cannot be rechecked; binary corroboration is substance-level ("Code
  Mode" × 18 present, sentence not verbatim). Keep the reliability note but treat the mechanism
  as the model's own claim, not a measured 2.x fact.

## 5. Plan changes (§13) — evidence supports each one

- **§5.5 / I-4 cascade**: supported (M-1 running incl. permission/question waits; M-2 stale
  outcome; M-8 frozen timestamps → "now" while active; M-8 tool part for long-tool rule; lists
  before `session.active` per §5.1 S3/S4 evidence).
- **§6 / I-5, Q5 queue default**: supported (M-4 5/5/5 exactly-once; M-5 steer dropped the planned
  answer 2/2; sends wait behind permission/form with pane-visible markers).
- **I-2 helper**: supported (§11.1 table: exit 0 with truncated output across shell-pipe and
  Node-reader configurations; file-descriptor writes complete).
- **I-3 model check + `promptDelivered` from first `user` message + `killed` check**: supported
  (S5 create-accepts-bad-model → 38 ms `failed`; M-6 spawn returned before prompt with
  `promptDelivered=true` — code read at check 5 confirms the unguarded write path).
- **R1 → `session.active`, R2 → not-active + `time.idle` age**: supported (M-1, M-2).
- **R3 keep pane rule; API rule needs running tool part**: supported (M-8; modulo m-3's M-6
  citation).
- **R4/R5 stay on pane; toast ~5 s; `outcome "failed"` durable**: supported (M-7 log + S5; S4
  toast timing).
- **§10 / I-7 eager 2.x worker, no ping; pane census §11.5**: supported (M-6 0.365 s pickup,
  no `ao send`).
- **Q3 still open**: correct — polling covered all five states within one poll, event stream
  excluded by the brief.

## 6. Open items (§14) — clarity

Items 1–5 each name the owner decision (decide Q3 / preserve-first-error / approve API-only env
turn before I-3+I-5 / check fleet pane then decide PATH fix / keep-allow-all vs session
ruleset). Item 6 lacks one (see m-4). Items 7–8 are low-priority informational notes, fine as-is.
