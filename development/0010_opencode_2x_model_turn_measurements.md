# 0010 — OpenCode 2.x model-turn measurements M-1 to M-8

**Date**: 2026-10-14 (the run: 22:41 to 23:01 EDT; all times below are UTC on 2026-10-15)
**Context**: note 0009 §14 lists eight measurements that need a model turn. The owner's answer Q4
(0009 §18) allows them in throwaway sessions on the global service, with a unique title, on the flat
plan. The answers Q3 (poll first, decide on events after M-3) and Q5 (`ao send` default `queue`, M-5
before I-5) use the results.
**Status**: measurements only. No source, test or config file changed. M-1, M-2, M-4, M-5, M-6 and
M-8 are measured. M-3 is measured with polled records; its event-stream part is open, as the brief
says. M-7 cannot be forced and stays open. §13 lists the changes to the 0009 plan, §14 the open items.

All facts below carry their source. "Measured" means a command of this run printed it. "Read" means
the text comes from a file, the API document or the 2.0.29 binary. Record times are the service's own
millisecond timestamps; poll times are the start of a poll round.

---

## 1. Results

1. **M-1, busy.** `session.active` listed a TUI-started session for the whole turn, the 30 s and 300 s
   tool calls included. It also listed sessions that waited on a permission or a question. The only
   value seen is `{"type":"running"}` (§3).
2. **M-2, times.** `time.updated` moves when an input is admitted, when the model starts its output,
   when a step ends and when the final answer ends. It does not move during a tool call. Tokens and
   cost change only at the end of a step. `time.idle` and `outcome` are written 6 to 18 ms after the
   final answer, and they keep their old values while a later turn runs (§4).
3. **M-3, states.** Each state has a positive polled record: busy (`session.active`), permission
   (`session.permission.list`), question (`session.form.list`), failed (`outcome "failed"` and an
   `error {type, message}` on the idle message) and interrupted (`outcome "interrupted"`). On this
   host the global config allows every action: a write outside the session directory ran with no
   prompt. A session ruleset at `session.create` makes the session ask. The event-stream part is
   open (§5).
4. **M-4, send to an attached TUI.** A `session.prompt` to a session with an attached TUI shows in the
   TUI, and it runs once: 5 prompts gave 5 user, 5 assistant and 5 idle records (§6).
5. **M-5, queue and steer.** Neither delivery interrupts a running tool or a pending permission.
   `steer` enters the running turn at the next step boundary, and in 2 of 2 runs the model then
   answered only the steered text and dropped its own planned final answer. `queue` runs after the
   last answer of the turn, with no idle record between. `experimental.session.wait` returns 18 to
   19 ms after the idle record (§7).
6. **M-6, pointer title and no brief.** A 2.x Muse worker acts on the pointer title: it lists its
   worktree, then blocks in a shell loop that waits up to 90 min (`"timeout": 0`) for
   `.agent_task.md`. It changed no file. It read the brief 0.365 s after the file appeared, with no
   `ao send`. During the wait the session is `running` and no record changes (§8).
7. **M-7, backend errors.** Not forced. The global log has no backend error and no refusal since the
   2.0.29 start. A 2.x failure shows in five places, listed in §9; which one a provider error uses is
   open.
8. **M-8, long tool call.** During a 300 s shell call, `session.active` said `running` at each of 150
   polls, and `time.updated` and the tokens did not change. The tool part with `status "running"` in
   `session.message.list` is the only API record of the call (§10).
9. **Side results** (§11): `opencode api` output through a pipe can stop early with exit code 0 (an
   input for the I-2 helper); `session.create` accepts a model that does not exist; a tool runs with
   the environment of the attached TUI, and the global service itself carries the AO variables of
   the `nex-orchestrator` session; tmux 3.4 ignores `new-session -e PATH`, so `~/.ao/bin` does not
   reach the pane PATH; a pane census of 2.0.29 for I-7.

## 2. Method and safety

- **Sessions.** 8 sessions on the global service (PID 4171365, 2.0.29). Seven came from
  `opencode api session.create` with a title that starts with `AO-MEASURE-2026-10-14:`, agent
  `build`, model `opencode-go/deepseek-v4.1-flash` (S5: a model reference with no provider), and a
  directory `/tmp/ao1m-work/<name>` (a git repository with one empty commit). One came from
  `ao spawn` for M-6 (title `AO:ao1m1014m6-1`, Muse). §12 lists all of them, with the removal.
- **Model turns.** 17 prompts, below the limit of 20. One of them (S5) failed before any provider
  request. §12 lists each turn.
- **TUIs.** `opencode --session <id> [--prompt <text>]`, typed into a `bash --norc` pane on a private
  tmux server (`tmux -L ao1m-tui`, 200 × 50), with the real home directory, no XDG change and no
  `AO_*` variables. The TUIs were clients of the global service.
- **Poller.** Each round ran six reads in parallel for one session: `session.active`, `session.get`,
  `session.permission.list`, `session.form.list`, `session.inbox.list` and `session.message.list`
  (limit 50), plus `tmux capture-pane` of its TUI. A round took about 0.2 s; rounds started every
  1 s (M-8: 2 s).
- **Writes** went only to the 8 sessions: `session.create`, `session.prompt`,
  `session.permission.reply` (always `reject`), `session.form.cancel`, `session.interrupt` (S4 only)
  and `session.remove`. No session of anyone else was prompted, changed, aborted, shared, forked,
  deleted or summarized. The service was not stopped or signalled.
- **M-3 without the event stream.** No read of `~/.config/opencode/service.json`, no password, no
  direct HTTP. Only `opencode api`.
- **The S3 ruleset is an added test.** The brief says to stop the permission test when the global
  config allows the write. S2 stopped that way. S3 then asked through its own session ruleset
  (`ask`), with a harmless target under `/tmp/ao1m-outside` and only `reject` replies. It changed
  no global rule.
- **Read only otherwise:** `config.get`, `agent.get build`, `model.list`, `GET /openapi.json`, the
  global log, `/proc/<pid>/environ` of processes that this run started, and the `AO_*` variables and
  `PATH` entries of the service process (nothing else of that environment was printed).
- No credential copy, no `opencode auth`, no change to `~/.opencode/`, `~/.config/opencode/` or a
  global install.

## 3. M-1 — the busy record during a TUI-started turn

**Question.** Does `session.active` list a session while a TUI-started turn runs?

**Method as run.** S1: the TUI started with `--prompt "Use the shell tool to run the command `sleep
30`, then reply with the single word DONE."`. Poll every 1 s for 110 s.

**Evidence** (S1 `ses_ec290324effe9nZ0YVkIKuYSA9`, measured):

| UTC | Record |
|---|---|
| 02:41:51.897 | TUI command typed |
| 02:41:53.376 | `time.updated` (input admitted) |
| 02:41:53.391 | `user` message |
| 02:41:54.126 | first poll with `session.active` → `{"type":"running"}` |
| 02:41:57.668 – 02:42:27.686 | shell tool `sleep 30` (`"timeout": 60000`, chosen by the model) |
| 02:42:28.133 | last poll with `running` |
| 02:42:29.146 | final answer `DONE` complete |
| 02:42:29.152 | `time.idle`; `idle` message, `outcome "succeeded"` |

The next poll (started 02:42:29.133, answered after the idle record) had no entry for S1. The same
`running` value showed in every poll of S3 during its permission wait (02:45:12 to 02:45:32), of S4
during its question wait (02:46:40 to 02:46:47), of S7, of the M-8 run and of the M-6 wait loop. A
separate `session.active` call at 02:46:41.267 listed S4 and three other running sessions (not mine,
read only).

**Result.** `session.active` is a positive busy record for TUI-started turns, tool calls included.
The lag is at most one poll. A session that waits on a permission or a question is still `running`.

**Change to 0009.** §5.5 step 3 holds, and step 2 (the permission and form lists) must stay before
step 3. I-4 can use it for busy. §9 R1 can be replaced by this record. On the pane, 2.0.29 still shows
the R1 marker `esc interrupt` under the box border while a turn runs, but not while a permission or
question dialog is open (§11.5).

## 4. M-2 — how `time.updated` and `time.idle` move

**Question.** How do `time.updated` and `time.idle` move during a turn?

**Method as run.** The S1 run of §3, plus S3, S6 and the M-8 run (§10), all polled.

**Evidence** (measured):

- S1 `time.updated`: 02:41:39.785 (create) → 02:41:53.376 (input admitted) → 02:41:57.414 (first
  model part; the reasoning part starts 02:41:57.420) → 02:42:27.705 (the step with the tool call
  ends) → 02:42:29.146 (final answer ends). No change from 02:41:57.414 to 02:42:27.705, the tool
  call. `time.idle` 02:42:29.152.
- S1 tokens and cost: 0 until the step end; the poll at 02:42:28.133 read input 11230, output 57,
  reasoning 9, cache read 384, cost 0.001725252; the final record read 11404, 60, 9, cache read
  11904, cost 0.001787712. The second step had input 174 and cache read 11520: `input` does not
  include cache reads, so the 0009 §7 mapping (`input + cache.read + cache.write`) holds.
- S3: `time.updated` moved at each inbox admission while a permission waited (02:45:15.710 queue,
  02:45:23.866 steer).
- S6: while its second turn ran (poll 02:49:58.025), `time.idle` stayed 02:49:54.750 and `outcome`
  stayed `"succeeded"` from the first turn.
- A new session has no `time.idle` and no `outcome` until its first turn ends (S1 to S7).

**Result.** `time.updated` marks inputs, step starts and step ends, not progress inside a tool call.
`time.idle` and `outcome` describe the last finished turn.

**Change to 0009.** §5.5 step 5 (age of `time.idle` when not active) holds. Step 4 must compare
`time.idle` with the time of the last `user` message, as written, because `outcome` is stale while a
turn runs. Cost read between step ends is stale by one step, which is acceptable for `ao status`.
§9 R2 can be replaced (not active, `time.idle` age, report line not final).

## 5. M-3 — records for busy, permission, question and error

**Question.** Which records mark busy, permission, question and error?

**Method as run.** Polled records only (see §2). Busy is §3. One session per state: S2 and S3
(permission), S4 (question), S5 (error).

### 5.1 Permission (S2, S3)

- **Global rules (read).** `config.get` → document `/home/taisung/.config/opencode/opencode.json` with
  `"permissions": [{"action":"*","resource":"*","effect":"allow"}]`. `agent.get build` → the ruleset
  `*`/`*`/`allow`, `read *.env` `ask`, `read *.env.*` `ask`, `read *.env.example` `allow`,
  `question`/`*`/`allow`, `*`/`*`/`allow`, `browser`/`*`/`deny`, in this order.
- **S2, under the global rules (measured).** Prompt: write `/tmp/ao1m-outside/perm-global.txt`. The
  `write` tool ran at 02:44:20.528 with no permission request (16 polls, none with a request); the
  file appeared (1 byte, mtime 22:44:20.537 EDT). As the brief says, I stopped this test and removed
  the file.
- **S3, with a session ruleset (measured).** `session.create` with
  `"permissions": [{"action":"*","resource":"*","effect":"ask"}]` (the create response repeats it).
  This changes only that session. Prompt at 02:45:10.067. The poll at 02:45:12.254 read:
  `{"id":"per_13d730aa4001ox4SF0dNzL2u0Y","action":"external_directory","resources":["/tmp/ao1m-outside/*"],"save":["/tmp/ao1m-outside/*"],"source":{"type":"tool","messageID":"msg_13d73036c001uq5GEXoXMqaePC","id":"call_00_e0x9s6diyr5k47axephj9xn0"}}`.
  `session.active` said `running` during the whole wait. At 02:45:32.036 I sent
  `{"decision":"reject","message":"Refused by design: this is a measurement."}`. The tool part became
  `status "error"`, `error {"type":"permission.rejected","message":"Refused by design: this is a measurement."}`.
  No file was written. A guard rejected nothing more in the next 90 s (no new request came).
- **Pane (S3).** `△ Permission required`, `← Access external directory /tmp/ao1m-outside`,
  `Allow once   Always allow   Reject`; tab title prefix `!`; no `esc interrupt`.

### 5.2 Question (S4)

- Prompt at 02:46:37.181: ask one question with the question tool. The poll at 02:46:40.188 read a
  form: `{"id":"frm_13d7462330012xxAC8vI4RqqBG","title":"Questions","metadata":{"kind":"question","tool":{...}},"fields":[{"key":"q0","title":"Color preference","description":"Do you prefer red or blue?","type":"string","options":[{"value":"Red",...},{"value":"Blue",...}],"custom":true}]}`
  (shortened).
  `session.form.get` adds `"state":{"status":"pending"}`.
- The global `form.list` at 02:46:40.975 returned `{"location":{"directory":"/home/taisung"},"data":[]}`:
  it did not show the pending form. Only the per-session list did.
- I cancelled the form at 02:46:47.417 (`session.form.cancel`, `message` parameter). The tool part
  became `error {"type":"tool.execution","message":"Cancelled by design: this is a measurement."}`.
  The model then asked the same question again: a second form, `frm_13d7487af001pyoAWR4zVKXRaY`, at
  the 02:46:50.190 poll.
- I stopped the turn with `session.interrupt` at 02:48:08.793 → `{"interrupted":true}`. After it: the
  form list was empty, `session.active` had no S4 entry, `session.get` read `outcome "interrupted"`
  and `time.idle` 02:48:08.954, the last assistant message read `finish "error"`,
  `error {"type":"aborted","message":"Step interrupted"}`, and its question tool part read
  `error {"type":"aborted","message":"Tool execution interrupted"}`.
- **Pane (S4).** `Questions`, the numbered options, `↑↓ select  enter submit  esc dismiss`; tab title
  prefix `?`; no `esc interrupt`. After the interrupt: `... · interrupted` under the turn.

### 5.3 Error (S5)

- `session.create` with `"model":{"providerID":"ao1m-none","id":"none"}` returned exit 0 and a record
  with that model: create does not check the model. Before any turn, the TUI box read
  `Build · none (unavailable) ao1m-none`.
- Prompt at 02:49:00.552. `user` message 02:49:00.583, `idle` message 02:49:00.590 with
  `outcome "failed"` and `error {"type":"provider.no-route","message":"Model unavailable: ao1m-none/none"}`.
  `session.get`: `outcome "failed"`, tokens 0, cost 0. No poll saw `running` (the turn lasted 38 ms).
- Pane: a toast `Session failed` / `Model unavailable: ao1m-none/non…` at the 02:49:00.738 poll, gone
  at 02:49:05.740. Log: `level=ERROR ... message="Failed to drain Session"
  cause="SessionRunnerModel.ModelUnavailableError: Model unavailable: ao1m-none/none ..."`.
- No request left the host: the provider does not exist. This is not a backend error (M-7).

### 5.4 Result

| State | Polled record | Seen in |
|---|---|---|
| busy | `session.active` holds the ID, `{"type":"running"}` | S1, S3, S4, S7, M-6 |
| permission | `session.permission.list` not empty: `action`, `resources`, `source.type "tool"` | S3 |
| question | `session.form.list` not empty: `metadata.kind "question"`, `fields` | S4 |
| failed | `session.get` `outcome "failed"`; the `idle` message `error {type, message}` | S5 |
| interrupted | `outcome "interrupted"`; assistant `finish "error"`, `error.type "aborted"` | S4 |

Each record appeared at the first poll after its event (1 s rounds). The S5 turn was too short for
any poll to see it as `running`.

### 5.5 Change to 0009

- §5.5 cascade: confirmed. Add that `outcome "interrupted"` is not `blocked`; it decays by age like
  `succeeded`.
- Use the per-session lists only; the global `form.list` missed a pending form (this confirms the
  0009 §5.2 choice).
- With the global allow-all rules, `waiting_input` on this host most likely comes from questions.
  Whether the `read *.env` `ask` rule of `build` still asks after the later `*`/`*`/`allow` is not
  measured. A cancelled question can come back.
- I-3: `session.create` and a `session.get` readback cannot catch a model that does not exist. The
  first turn fails in tens of milliseconds with `outcome "failed"` and `provider.no-route`. I-3 needs
  a model check before the create (for example against `model.list`), or the launch check must read
  the first turn's outcome.
- Q3: polling saw every state within one poll. The event stream is not measured (open, §14).

## 6. M-4 — `session.prompt` to a session with an attached TUI

**Question.** Does a `session.prompt` to a session with an attached TUI show in the TUI and run once?

**Method as run.** S6: TUI attached with no prompt at 02:49:44.597 (footer `ctrl+p commands` 2 s
later). One prompt through the API: `{"text":"Reply with the single word PONG.","delivery":"queue"}`.

**Evidence** (measured): admitted 02:49:53.463 → `user` 02:49:53.521 → answer `PONG` complete
02:49:54.742 → `idle` 02:49:54.750. The pane at the 02:49:54.024 poll showed the user text and the
running row; the 02:49:58.025 capture showed `PONG` and `Build · DeepSeek V4.1 Flash · 1.2s · 2.5
tok/s`. All S6 prompts (5) gave 5 `user`, 5 `assistant` and 5 `idle` records. S3 and S7 also had a
TUI attached; each has 3 `user`, 3 `assistant` and 1 `idle` record, so no input ran twice.

**Result.** Positive: the TUI shows the API input and the answer; the turn runs once, in the service.

**Change to 0009.** The §6 condition "until M-4 passes, `ao send` keeps the tmux paste" is met. I-5
can start, with the M-5 results below.

## 7. M-5 — `queue` and `steer` during a turn and during a permission wait

**Question.** How do `steer` and `queue` behave during a turn, and during a permission prompt?

### 7.1 During a running tool (S7, measured)

| UTC | Record |
|---|---|
| 02:52:07.699 | TUI started with `--prompt` (`sleep 30` through the shell tool) |
| 02:52:09.520 | `user` message |
| 02:52:11.263 | shell tool runs |
| 02:52:16.500 | `queue` input admitted; inbox: the queue item |
| 02:52:23.480 | `steer` input admitted; inbox: both items |
| 02:52:41.283 | shell tool ends; the step ends 02:52:41.306 |
| 02:52:41.321 | the steered text becomes a `user` message (15 ms after the step); answer `STEERED` 02:52:45.155 |
| 02:52:45.167 | the queued text becomes a `user` message (12 ms after); answer `QUEUED` 02:52:46.563 |
| 02:52:46.573 | `idle`, `outcome "succeeded"` |

The planned answer `DONE` was never written. `session.active` said `running` from 02:52:09.907 to
02:52:45.914 without a gap. `experimental.session.wait`, called at 02:52:23.498, returned at
02:52:46.592. Pane: the steered text showed as a user message above the box; the queued text showed
as `1 queued · Reply with the single word QUEUED.`.

### 7.2 During a permission wait (S3, measured)

`queue` at 02:45:15.710 and `steer` at 02:45:23.866 both stayed in the inbox while the request
waited. The TUI showed the steered text but not the queued text (the dialog took the area). After the
reject at 02:45:32.036: the steered text became a `user` message at 02:45:32.191 (answer `STEERED`),
then the queued text at 02:45:33.617 (answer `QUEUED`), then `idle` at 02:45:35.271. The answer
`DONE` never came.

### 7.3 To an idle session (S6, measured)

`queue` admitted 02:50:22.567 → `user` 02:50:22.584; `steer` admitted 02:50:51.250 → `user`
02:50:51.274. Both start a turn at once. In M-4, `experimental.session.wait` returned at
02:49:54.768, 18 ms after the idle record.

### 7.4 Two turns without data

In S6, two prompts "Use the shell tool to run the command `sleep 20` ..." did not start the tool. The
model (DeepSeek V4.1 Flash) answered: "I can't run that. The shell tool isn't available in this mode —
Code Mode only exposes the `opencode` tools". Code Mode is a 2.x feature (an `execute` tool for
JavaScript; its prompt texts are in the binary, read). The shell tool was available: S1, S7 and M-8
used it. The `queue` and `steer` prompts that followed reached an idle session and became the §7.3
data. S7 then ran in a fresh session, started from
the TUI like S1, with a driver that stops if the tool does not start.

### 7.5 Result

- Neither delivery interrupts a running tool or a pending permission.
- `steer` goes in at the next step boundary of the running turn. In 2 of 2 runs the model then
  answered only the steered text and did not give the answer that the first prompt asked for.
- `queue` goes in after the last answer of the turn, inside the same run: there is no idle record
  between, and `session.active` has no gap.
- A send to a session that waits on a permission or a question waits until a human answers.

### 7.6 Change to 0009

- Q5: the evidence supports `queue` as the `ao send` default; `steer` replaced the worker's own final
  answer in both runs.
- I-5: when `session.permission.list` or `session.form.list` is not empty, `ao send` must say that
  the message waits behind the human answer. `experimental.session.wait` (one `opencode api` call
  that blocks until idle) can replace the 600 s pane wait of `ao send` without `--no-wait`. The
  answer to a `queue` send comes in the same run as the current turn.

## 8. M-6 — a 2.x Muse worker with a pointer title and no brief

**Question.** What does a 2.x Muse worker do with a pointer title and no brief?

**Method as run.** One `ao spawn` with my worktree's build (`packages/cli/dist`, no source newer than
the build), a scratch config (`/tmp/ao1m-spawn/agent-orchestrator.yaml`, project `ao1m-scratch`,
session prefix `ao1m1014m6`, no `agentRules`), a scratch repository `/tmp/ao1m-spawn/repo`,
`AO_STATE_ROOT=/tmp/ao1m-spawn/state`, a `tmux` wrapper for `tmux -L ao1m-spawn`, and the global
OpenCode store. Command: `ao spawn --agent opencode --model opencode-go/muse-spark-1.3-contributor
"ao1m-m6: Read .agent_task.md in your worktree and execute it. If .agent_task.md does not exist yet,
do NOT start any work — wait and do nothing until it appears."` (the `ao-spawn` pointer title with a
unique tag).

**Evidence** (OpenCode session `ses_ec2849a32ffeb2vmr5tLlzGnja`, measured):

| UTC | Record |
|---|---|
| 02:54:17.346 | `ao spawn` starts |
| 02:54:18.574 | `ao spawn` prints `Session ao1m1014m6-1 spawned`, exit 0 |
| 02:54:19.628 | OpenCode session created by the launch script (`AO:ao1m1014m6-1`, Muse, the worktree as location) |
| 02:54:21.548 | `user` message: the ao launch prompt, task line `Work on issue: ao1m-m6: Read .agent_task.md ...` |
| 02:54:26.740 | text `Waiting on your task file — checking if it's arrived.`; `read` of the worktree: `.ao/`, `.git` |
| 02:54:31.771 | shell tool starts: `i=0; while [ ! -f .agent_task.md ] && [ $i -lt 1080 ]; do sleep 5; i=$((i+1)); done; if [ -f .agent_task.md ]; then echo "FOUND"; ls -la; cat .agent_task.md; else echo "TIMEOUT_AFTER_90MIN"; ls -la; fi`, `"timeout": 0` |
| 02:57:31.555 | I wrote `.agent_task.md`: "Reply with the single word BRIEF-SEEN and then stop. Do not run any tool and do not change any file." |
| 02:57:31.920 | shell tool ends with `FOUND` and the file text |
| 02:57:33.147 | answer `BRIEF-SEEN` |
| 02:57:33.156 | `idle`, `outcome "succeeded"` |

- During the wait: `session.active` `running` at each poll; `time.updated` 02:54:27.490 and the
  tokens unchanged until 02:57:31.972.
- Cost: before the brief, input 11766, output 91, reasoning 11, cache read 1521, cost 0.0012000; at
  the end 27643, 284, 602, cache read 13395, cost 0.00296829.
- Files: `git status` before the brief showed only `?? .ao/` (ao's own directory); the repository
  log had only the `init` commit at the end.
- ao's own view: `ao status` (my build, scratch config, about 02:55:17) showed activity `ready`,
  `50s ago`, while the worker was inside the shell tool. The plugin reads the CLI list `updated`
  time (0009 §5.1).
- Metadata: `promptDelivered=true` (for a launch-prompt agent, `session-manager.ts:1283-1285` sets it
  whenever a prompt exists) and `status=killed` (read at about 02:55), while the pane and the TUI
  ran. The writer of `killed` is not found: the scratch lifecycle worker's log was empty. Not
  analyzed.
- The worktree was `/home/taisung/.worktrees/ao1m-scratch/ao1m1014m6-1`, not under `/tmp/ao1m-*`:
  the top-level `worktreeDir` key had no effect. The workspace plugin reads `worktreeDir` from its
  own plugin config (`workspace-worktree/src/index.ts:91-93`, read).

**Result.** A 2.x Muse worker is eager and polls by itself. It acts on the pointer title, starts no
work, and blocks in a shell loop for up to 90 min. It reads a brief within 5 s of its arrival, with no
`ao send`.

**Change to 0009.**

- I-7: the OpenCode rows of `ao-spawn` (0009 §10) become: eager like claude-code and codex, acts on
  the pointer title, waits in a shell loop, needs no `ao send` after the brief. A `queue` ping sent
  during the loop waits behind the tool (M-5) and arrives after the brief's turn.
- I-4 and §9 R2, R3: a waiting worker is `running` with no record change for up to 90 min. A stall
  rule needs the running tool part (name, command, `time.ran`) as positive evidence of a wait.
- I-3: `ao spawn` returned 3.0 s before the prompt reached the session and recorded
  `promptDelivered=true` without a check. The launch check of 0009 §11 step 3 (the first `user`
  message) gives a real value. Check the `status=killed` write in I-3 (§14).

## 9. M-7 — backend errors and refusals

**Question.** Which text does 2.x show and record for `[service_overloaded]`,
`[rate_limit_exceeded]` and the refusal?

**Method as run.** Not forced, as the brief says. The global log, read only:
`~/.local/share/opencode/log/opencode.log` (29298956 bytes, from 2026-09-25T06:15:43Z).

**Evidence** (read):

- The hits for `service_overloaded` (5), `rate_limit_exceeded` (3) and `requires explicit opt in`
  (3) are all `message=evaluated permission=bash` lines of other agents' `grep` commands on
  2026-10-01 and 2026-10-02, not errors.
- Since the 2.0.29 start (20:22:31Z), the log has four ERROR or WARN lines: two `cli process failed`
  (a 1.x `run --format json` call at 20:38:24Z and a `version` call with a bad `chdir` at
  21:50:18Z), one `schema rejection` (`after` below 0, the 0009 survey's own call at 01:18:16Z) and
  one `Failed to drain Session` (S5, 02:49:00.590Z).

**Result.** No backend error or refusal has happened on 2.x on this host. From S4 and S5, the text of
a failure appears in these places:

1. `session.get` `outcome "failed"`.
2. The `idle` message `error {type, message}`.
3. For an error inside a step: the assistant message `finish "error"` and `error {type, message}`
   (the S4 interrupt has this form).
4. The TUI toast `Session failed` with the message, for about 5 s.
5. The service log: `level=ERROR message="Failed to drain Session" cause="<class>: <message>"`.

Open: which of 1 to 3 a provider error uses, and whether a retry leaves a record
(`session.retry.scheduled` is an event name in the binary, 0009 §5.4).

**Change to 0009.** §9 R4 and R5 stay on the pane. But the toast lasts about 5 s, so a pane rule with
a slower poll can miss it; when I-4 lands, `outcome "failed"` with its error message is the durable
record.

## 10. M-8 — a long tool call

**Question.** Does `time.updated` or `tokens` move during a long tool call?

**Method as run.** S1 (TUI still attached), API prompt at 02:53:29.089: "Call the shell tool
directly, in the foreground, with the command `sleep 300` and a timeout of 400000 ms. Then reply with
the single word DONE." Poll every 2 s for 380 s.

**Evidence** (measured): the shell tool ran from 02:53:31.017 to 02:58:31.042 with
`{"command":"sleep 300","timeout":400000}`. Of 190 polls, 152 read `running` (02:53:29.137 to
02:58:31.169). During the tool, `time.updated` stayed 02:53:30.373 and the tokens stayed input 11404,
output 60, reasoning 9, for 300 s; both changed at 02:58:31.070. While the tool ran,
`session.message.list` showed the part `{"status":"running","input":{"command":"sleep 300","timeout":400000}}`.
No read failed. The pane spinner and progress bar moved.

**Result.** Nothing on the session record moves during a tool call. The running tool part is the only
API record of the call.

**Change to 0009.** §9 R3: keep the pane rule. An API replacement must read the running tool part:
"stalled" means active, no running tool part, and `time.updated` unchanged for N min; "long tool"
means a running tool part older than N min. I-4: the activity timestamp of an active session is "now"
(0009 §5.5 step 3), not `time.updated`.

## 11. Other results of this run

### 11.1 `opencode api` output through a pipe can stop early (input for I-2)

Measured with read-only operations (`GET /openapi.json`, 276536 bytes; `model.list`, 458888 bytes):

| Reader | Result |
|---|---|
| shell pipe to `wc -c`, 12 runs | 9 × 276536, 3 × 262144 bytes; exit 0 each time |
| shell pipe, the reader waits 0.3 s, 8 runs | 8 × 65536 bytes; exit 0 |
| Node `execFile` (`maxBuffer` 64 MiB), free event loop, 36 runs | all complete |
| Node `execFile`, event loop busy 400 ms or 1000 ms after the start, 10 runs | 10 × 146176 bytes; exit 0 |
| Node `spawn` with stdout to a file descriptor, busy 1000 ms, 5 runs | 5 × 276536 bytes |

**Result.** `opencode api` exits before all output is written when the reader is slow, and the exit
code stays 0. **Change to 0009:** the I-2 helper must write stdout to a file (or a file descriptor),
or treat a JSON parse error as an error and retry. It must not trust exit 0. Large reads, such as
message lists, have the highest risk, and the lifecycle worker's event loop is often busy.

### 11.2 The tool environment

- The M-6 shell tool process (PID 3239723) was a child of the global service (PID 4171365), but it
  had the TUI's environment: `AO_SESSION_ID=ao1m1014m6-1` and the scratch `AO_CONFIG_PATH` and
  `AO_STATE_ROOT`. Its variable names were the TUI's plus `AGENT`, `OPENCODE`,
  `OPENCODE_SESSION_ID` and `OPENCODE_TERMINAL` (measured).
- The service process has 9 `AO_*` variables of the `nex-orchestrator` session, among them
  `AO_SESSION_ID=nex-orchestrator` and `AO_CONFIG_PATH=/Data1/NgFEP/Nexus/agent-orchestrator.yaml`
  (read). The service started at 16:22:30 EDT, so the process that started it most likely had that
  session's environment (inferred; no record names the starter).
- Not measured: the environment of a tool in a session that has no attached TUI. I-5 sends through
  the API and I-3 changes the start. If such a tool gets the service's environment, the ao `gh` and
  `git` wrappers write metadata for `nex-orchestrator`. Open item (§14).

### 11.3 tmux 3.4 ignores `new-session -e PATH`

- ao passed `-e PATH=/home/taisung/.ao/bin:/usr/local/bin:...` to `tmux new-session` (M-6, from
  `/proc/<tmux pid>/cmdline`). `tmux show-environment -t <session> PATH` held that value. The pane
  shell started with the client's PATH, without `~/.ao/bin`, and so did the TUI and the tool.
- A probe on a private server (`tmux -L ao1m-envtest`, tmux 3.4, three sessions, with and without a
  command): `-e AO1M_PROBE=...` reached the pane; `-e PATH=...` did not.
- So on tmux 3.4, the `~/.ao/bin` wrappers are not on the PATH of the agent in a pane (measured on
  private servers only). This touches the metadata hooks of every PATH-wrapper agent (codex, gemini,
  opencode), not only this arc. Open item (§14).

### 11.4 `session.create` does not check the model

See §5.3. The TUI shows `none (unavailable)` in its box for such a session before any turn.

### 11.5 Pane census of 2.0.29 (input for I-7 and §9)

| State | Pane markers (measured) |
|---|---|
| idle | status row `<dir>:<branch> ... ctrl+p commands`; tab title without a prefix (before the first turn) or `•` (after a turn) |
| running | `⬝⬝⬝■■...` bar and `esc interrupt` under the `╹▀▀▀` border; spinner (`⠙`, `⠸`, ...) as tab-title prefix; `↓ 1 shell` while a shell tool runs; `Press ctrl+b to move running work to the background` |
| queued input | `N queued · <text>` above the border |
| steered input | the text as a user message above the box |
| permission | `△ Permission required`, `Allow once   Always allow   Reject`; title prefix `!`; no `esc interrupt` |
| question | `Questions`, the options, `↑↓ select  enter submit  esc dismiss`; title prefix `?`; no `esc interrupt` |
| failed | toast `Session failed` and the message, about 5 s; then the idle status row |
| finished turn | `<Agent> · <model> · <duration> · <rate> tok/s` under the answer; `· interrupted` after an interrupt |
| unknown model | `<Agent> · none (unavailable) <provider>` in the box |

## 12. Sessions, turns and cleanup

**Sessions created** (all on the global service; created time is the record's `time.created`):

| # | ID | Title | Directory | Created | Used for |
|---|---|---|---|---|---|
| S1 | `ses_ec290324effe9nZ0YVkIKuYSA9` | `AO-MEASURE-2026-10-14: m1-sleep30` | `/tmp/ao1m-work/m1-sleep30` | 02:41:39.785 | M-1, M-2, M-8 |
| S2 | `ses_ec28de455ffeTj6QycDcV0okM6` | `AO-MEASURE-2026-10-14: m3-perm-global` | `/tmp/ao1m-work/m3-perm-global` | 02:44:10.819 | M-3 permission, global rules |
| S3 | `ses_ec28d76a5ffehmSLbedfFz9Wb2` | `AO-MEASURE-2026-10-14: m3-perm-ask` | `/tmp/ao1m-work/m3-perm-ask` | 02:44:38.897 | M-3 permission, M-5 |
| S4 | `ses_ec28bcba5ffeLp7eY8gDncUm0E` | `AO-MEASURE-2026-10-14: m3-question` | `/tmp/ao1m-work/m3-question` | 02:46:28.224 | M-3 question, interrupt |
| S5 | `ses_ec289c441ffeBxUSEHIgcy8z3v` | `AO-MEASURE-2026-10-14: m3-error` | `/tmp/ao1m-work/m3-error` | 02:48:41.172 | M-3 error |
| S6 | `ses_ec288cedeffehMHGVXRbdBI664` | `AO-MEASURE-2026-10-14: m4-m5-attached` | `/tmp/ao1m-work/m4-m5-attached` | 02:49:43.994 | M-4, M-5 (idle) |
| S7 | `ses_ec286baf1ffeLG63JMmFNsIgVT` | `AO-MEASURE-2026-10-14: m5-queue-steer` | `/tmp/ao1m-work/m5-queue-steer` | 02:52:00.171 | M-5 |
| M6 | `ses_ec2849a32ffeb2vmr5tLlzGnja` | `AO:ao1m1014m6-1` | `/home/taisung/.worktrees/ao1m-scratch/ao1m1014m6-1` | 02:54:19.628 | M-6 |

**Removal** (measured): `session.remove` for each ID between 03:00:39.906 and 03:00:40.960, with no
output. After it: `session.get` returned `SessionNotFoundError` for all 8; `session.list
--param search=AO-MEASURE-2026-10-14:` and `--param search=AO:ao1m1014m6` each returned 0 sessions;
none of the newest 200 global sessions has `AO-MEASURE` or `ao1m` in its title.

**Model turns** (17 prompts):

| # | Session | Prompt | For |
|---|---|---|---|
| 1 | S1 | TUI `--prompt`: shell `sleep 30`, reply DONE | M-1, M-2 |
| 2 | S2 | API: write a file outside the directory | M-3 |
| 3 | S3 | API: the same write, session ruleset `ask` | M-3 |
| 4 | S3 | API `queue` during the permission wait | M-5 |
| 5 | S3 | API `steer` during the permission wait | M-5 |
| 6 | S4 | API: ask one question with the question tool | M-3 |
| 7 | S5 | API: reply OK, model without a provider (no provider request) | M-3 |
| 8 | S6 | API: reply PONG, TUI attached | M-4 |
| 9 | S6 | API: shell `sleep 20` (the model did not run the tool) | lost |
| 10 | S6 | API `queue`, the session idle | M-5 |
| 11 | S6 | API: shell `sleep 20` (the model did not run the tool) | lost |
| 12 | S6 | API `steer`, the session idle | M-5 |
| 13 | S7 | TUI `--prompt`: shell `sleep 30`, reply DONE | M-5 |
| 14 | S7 | API `queue` during the shell tool | M-5 |
| 15 | S7 | API `steer` during the shell tool | M-5 |
| 16 | S1 | API: shell `sleep 300`, timeout 400000 ms | M-8 |
| 17 | M6 | `ao spawn` launch prompt with the pointer title (the brief pickup ran in the same turn) | M-6 |

Cost (sum of the `session.get` `cost` values before the removal): USD 0.011947, on the flat plan.

**Other cleanup** (measured): the lifecycle worker that my `ao spawn` started (PID 3236141, my
build, `lifecycle-worker ao1m-scratch`, scratch environment) stopped by PID; the tmux servers
`ao1m-tui` (PID 3019814) and `ao1m-spawn` (PID 3236187) stopped with `kill-server`, with all their
panes; the probe server `ao1m-envtest` stopped; the three sockets removed; `/tmp/ao1m-work`,
`/tmp/ao1m-outside`, `/tmp/ao1m-spawn` and `~/.worktrees/ao1m-scratch` removed. No process has `ao1m`
in its environment. The global service (PID 4171365) still runs. Not changed: `~/.config/opencode/`
(`opencode.json` mtime 2026-09-20), `~/.ao/bin` (marker `0.2.1`, mtime 2026-09-16; the spawn skipped
the wrapper write because the marker matched), the primary checkout.

## 13. Changes to the 0009 plan

| 0009 item | Change from this run |
|---|---|
| §5.5, I-4 | Cascade confirmed (M-1, M-3). Lists before `session.active`. `outcome "interrupted"` is not `blocked`. Compare `time.idle` with the last `user` message (M-2). Timestamp "now" while active (M-8). Read the running tool part for long tools (M-6, M-8). |
| §6, I-5 | Unblocked: M-4 positive, M-5 measured. Default `queue` (Q5). Say when a send waits behind a pending permission or form. `experimental.session.wait` for the `--wait` path. |
| I-2 | The helper writes `opencode api` stdout to a file or checks the JSON; exit 0 is not proof (§11.1). |
| I-3 | `session.create` accepts a model without a route: check the model before the create, or read the first turn's outcome (§5.3). Set `promptDelivered` from the first `user` message (M-6). Check the `status=killed` write (§8). |
| §9 R1 | Replace with `session.active` (M-1). |
| §9 R2 | Replace with "not active" plus the `time.idle` age (M-2). |
| §9 R3 | Keep the pane rule; an API rule needs the running tool part (M-8, M-6). |
| §9 R4, R5 | Keep on the pane; no 2.x case yet; the toast lasts about 5 s (M-7). |
| §10, I-7 | OpenCode 2.x is eager and polls for the brief by itself; no ping needed (M-6). Pane census in §11.5. |
| Q3 | Still open: polling covers all five states within one poll; the event-stream part is not measured. |

## 14. Open items for the owner

1. **M-3 event stream.** Not run: it needs direct HTTP with the service password, which the brief
   excluded. Decide Q3 with §5.4 (polling covers all states within 1 s) or approve the event part.
2. **M-7.** Keep the first real backend error or refusal on 2.x: `session.get`, the last two
   messages and the log line, before anyone sends `continue`.
3. **Tool environment without a TUI (§11.2).** One model turn in an API-only session (`env` through
   the shell tool) answers it. Needed before I-3 and I-5 land, because the service carries the
   `nex-orchestrator` AO variables.
4. **`~/.ao/bin` missing from the pane PATH under tmux 3.4 (§11.3).** It touches all PATH-wrapper
   agents and PR metadata. Check a real fleet pane, then decide on a fix (for example an `export
   PATH=...` in the launch command).
5. **Permission rules.** The global config allows every action; the measured write outside the
   session directory did not ask. Keep it, or let ao pass a session ruleset at `session.create`
   (§5.1 shows that one works)?
6. **`status=killed` right after the M-6 spawn** while the pane ran (§8). Not analyzed.
7. **`worktreeDir`** belongs in the workspace plugin config, not at the top level (§8). Low.
8. **DeepSeek V4.1 Flash** refused the shell tool twice in one session and cited Code Mode (§7.4).
   A reliability note for the cheap OpenCode lens. Low.

## 15. Review round 1 (added by the orchestrator, 2026-10-14)

Two receipts reviews of `95a1328d`, the router's pair for an L2 LOW note: Muse (ao-11) ACCEPT, 0 majors,
6 minors, 22 read-only spot checks all true; DeepSeek V4.1 Flash (ao-12) ACCEPT, 0 majors, 7 minors, 20
spot checks (18 true, 0 false, 2 cannot check). The removed sessions cannot be re-run, so both reviewed by
receipts and consistency. No round 2 runs. The reviews are `development/reviews/0010_review_r1_muse.md`
and `development/reviews/0010_review_r1_v4flash.md`. The corrections that each increment brief must use:

- §1 result 2 and §7.3: `time.idle` is written about 6 to 10 ms after the final answer (S1 6 ms, S6 8 ms,
  S7 10 ms); 18 to 19 ms is the return latency of `session.wait`, a different quantity (both reviews).
- §1 result 8 and §10: the M-8 poll count is given as 150 and as 152; read the evidence, not the summary.
- §9 and §13 R4/R5: the failure shape `finish "error"` on the assistant message is shown only by the S4
  interrupt, not by a provider failure. I-4 must not assume that shape for provider errors (M-7 is open).
- §13, the I-4 row: the running tool part as evidence comes from M-8 only, not from M-6.
- §5.5 and §13 I-3: "the readback cannot catch a model that does not exist" rests on one no-provider
  sample; `outcome "interrupted"` decaying by age like `succeeded` is inferred, not measured.
- §8 and §1 result 6: the M-6 worker read its wait instruction in the launch prompt (the pointer title),
  then waited in a shell loop. Another run (ao-6 at about 22:45 EDT) ended its turn instead and needed an
  `ao send`, so the wait behavior varies by run.
- §2: the limit of 20 model turns came from the orchestrator's brief.
- §12: the total cost has no per-session list; give one in later measurement notes.
- §7.4: the "Code Mode" refusal text is the model's own claim, quoted from a removed session.
- §14 items 6 to 8 name no owner decision. Item 6 (`status=killed`) goes to I-3, as §13 says.

