# Herdr fit-2 design r8 review — 2026-10-22 (Muse Spark 1.3)

SOUND-WITH-CHANGES

The admission boundary, the qualified rollback rule and the handle-runtime dispatch answer review r7's
three majors and four minors at design level. Counts: **0 blocking, 0 major, 6 minor findings**.
Finding IDs are local to this review (B-n, M-n, m-n from 1). No implementation or live Herdr
measurement was performed; every check below is a source or fixture read at the review baseline.

Baseline: `0488d24d` (verified with `git log --oneline -1`; the task requires this commit or a later
docs-only commit of `main`). This review concerns only fit-2. RH-A/RH-B and fit-1 itself are out of
scope except where fit-2 depends on them; fit-1 is unlanded on this tip (its interim guard is absent
from the tree — see dependency note D-F1 below), so every fit-1-base claim is recorded as a
dependency, not as verified fact.

## Initial isolation evidence

Created `/tmp/aofr8m-marker` before reading the design. Initial `ls -la --time-style=full-iso ~/.ao/bin`:

```text
total 28
drwxr-xr-x 2 taisung users 4096 2026-10-16 12:16:13.968933443 -0400 .
drwxr-xr-x 3 taisung users 4096 2026-02-24 12:30:43.815475733 -0500 ..
-rwxr-xr-x 1 taisung users 5466 2026-10-16 12:16:13.966933494 -0400 ao-metadata-helper.sh
-rw-r--r-- 1 taisung users    5 2026-10-16 12:16:13.968933443 -0400 .ao-version
-rwxr-xr-x 1 taisung users 2213 2026-10-16 12:16:13.967933468 -0400 gh
-rwxr-xr-x 1 taisung users 3471 2026-10-16 12:16:13.968933443 -0400 git
```

## Review process

Read the r8 design, then review r7 in full, then r7-design sections 4.1–4.4, 5.1, 5.2, 5.5, 5.6, then
the fit-1 brief (`brief-aofork-herdr-fit1-impl.md`, incl. section 2 point 2, the interim guard), then
the R4 table (`docs/DEVELOPMENT.md` rows 8–9), `development/TODO_TRACKING.md` D-8, then the cited
product sources and the `r8_` fixtures, then `git show 0488d24d --stat`. Only afterward read the
author's r8 report and brief. M-1/M-2/M-3 closure assessments and all finding IDs were recorded
before that consultation. Two read-only helper passes gathered line citations; every numbered
spot-check in this file was re-verified first-hand (see tables). No `ao`, `gh`, network, tmux,
herdr, agent, model-turn, build or test command was run.

## Review r7 findings in r8

| Finding | State in r8 | Independent assessment |
| --- | --- | --- |
| **M-1** admission boundary (in-flight isolated launch, damaged records, no lock) | **Closed at design level** | Lock A per project over G and reservation (§5.3.1); reservation born with role, pending handle P and claim (§4.4); damaged known-Herdr and handleless-with-live-owner selected (§5.3.2 G1); revalidation with 3-round bound (G3); limits L-1–L-5 named; T-7.20/20b/21/22/23/24/25. Upgrade-window residual (L-2+L-5) is named, not hidden. |
| **M-2** unqualified ordinary rollback; `launch-refused` script deletion | **Closed at design level** | Rule Q with exactly Q0/Q1/Q2, each with r8-measured no-request evidence (§3.1, §4.3); everything else `workspace-unconfirmed`/`launch-unconfirmed`; `launch-refused` removed, script kept; T-4.1b near misses; T-4.3b records-then-errors stand-in. Residual R-Q named with OQ-F7. |
| **M-3** old-record dispatch after runtime change | **Closed at design level** | `runtimeForHandle` at startup branches, restore step 7, kill, list enrichment and classifier (§4.5); missing plugin of a set runtime is unknown, never fallback; mismatch blocks (OQ-F4 (a)), T-7.8 keeps "blocked"; T-7.8b/8c/8d cover concurrent branch, restore, kill/list. |
| **m-1** commit order not green | **Closed at design level** | All new types/exports in commit 1 before use; preflight member + `admission` kind + guards in commit 1, first use later; per-commit intermediate oracles named (§7). Green-ness itself is unproven until implementation (same caveat as review r7). |
| **m-2** contract docs, doctor distinction, file count | **Partly closed** | `Runtime.create` contract + `closed: "nothing"` + `preflight()` + admission texts specified (§4.2, §5.5); doctor comment-only change specified. But the file list omits two touched files — see m-1 below. |
| **m-3** two wrong code statements | **Closed** | §3.3 states both correctly (numeric `execFile` code; empty-ID reject only in Claude Code). First-hand re-check: `agent-codex/src/index.ts:681`, `agent-gemini/src/index.ts:294`, `agent-opencode/src/index.ts:1440` answer `false`; `agent-claude-code/src/index.ts:661-664` rejects. |
| **m-4** T-7.4 passes without the new handling | **Closed at design level** | T-7.4 asserts exact presentation (no "Failed to setup orchestrator:" prefix, same error object rethrown); T-7.4b adds CLI-to-real-core with persisted `killed` record; T-7.3b/3c add legacy exit-0 answers (red on `389b8dfe` by assertion). |
| "F-9 and owner recovery" section | **Closed at design level** | Accept/refuse lists (§5.4.2), removal scope (§5.4.2 step 9, project checkout kept), owner check (§5.4.3 incl. `workspace list` for empty ID and shell quoting via `shellEscape`), no other command gets the option (§5.4.1), launch-token race guard (OQ-F8 (a)), damaged-record by-hand path (§5.4.4). Residual as review r7 states it. |
| "Partial-create contract and retained-record consumers" | **Closed at design level** | One row per consumer with behavior + test (§5.2.6); `ao send` policy explicit (OQ-F5 (a), T-4.14 three cases). `status.ts:230` prints the failure line today (verified). |
| "Acceptance, API" (`HerdrPinError`, guard shape) | **Closed at design level** | Error table §4.1 gives `HerdrPinError` code `ERR_HERDR_PIN` (+ `isHerdrPinError` if missing); guards check code + whole shape, never `instanceof` alone. |
| Acceptance notes (T-4.8, T-4.10, T-7.14, T-3.6) | **Applied** | T-4.8/T-4.8b exact-Q1/Q2/compatible-false controls; T-4.10 terminal-handleless restore + T-4.10b second restore; T-7.14 ambient-healthy/selected-unavailable; T-3.6 both `admitted` values + control. |
| OQ-F1 (b), OQ-F2 (a), OQ-F3 (b) | **Applied** | §2.2; no retire-on-negative for Herdr (§4.6); F-9 with token; two rounds with fit-1 base table (§2.1) and removal list (§2.3). |

## Prior-review (r6/r5) closure update in light of r8

"Closed" means the design specifies an adequate correction, pending implementation. It does not mean
the behavior exists.

| Prior item | State after r8 (design level) |
| --- | --- |
| r6 M-1 partial create through core rollback | **Closed.** Q closes the unqualified ordinary-error escape that review r7 left open; T-4.3b is the records-then-errors test r7 required. |
| r6 M-2 terminal/status and isolated startup bypass | **Closed.** A+P+claim+G1+G3 close the admission gap; `runtimeForHandle` closes the dispatch gap. |
| r6 m-1 evidence wording | **Closed, preserved.** §3.3 + fixtures; no new quantitative claim beyond the counted 13 `connect()` calls (re-verified: 13 lines, all `AF_UNIX`). |
| r6 m-2 spawn caller + selected preflight | **Closed.** `runSpawnPreflight` via registry instance + `checkSelectedRuntime`; T-7.14. Commit placement fixed (member in commit 1). |
| r6 OQ-14 / OQ-F1 | **Decided (b) by owner**, applied. |
| r5 M-2 unbound create cleanup | **Closed.** Zero close sites in `create` (§5.2.1) + Q. |
| r5 M-3 executable/socket pin | **Closed** (fit-1 base; unchanged by fit-2 except `compatible` in Q0). |
| r5 M-4 conservative startup | **Closed.** G + classifier; OQ-F1 (b). |
| r5 m-2 doc 0004 wording | **Closed, preserved.** 0488d24d doc-0004 diff only adds fit pointers + r8 facts. |
| r6/r5 F-1, F-2, F-5, F-6 | **Closed** (fit-1 base; relied on, not re-verified — see D-F1). |
| r6/r5 F-3 | **Closed.** Unchanged from r7 except exact CLI text + `admitted` matrix (T-3.1–T-3.7). |
| r6/r5 F-4 | **Closed** (see r6 M-1 row). |
| r6/r5 F-7 | **Closed** (see r6 M-2 row). |
| r6/r5 F-8 | **Partly closed** — see m-1 (two files missing from the list). |
| W-4 | **Explicitly deferred** (§9). |

## New findings

### m-1 — Product file list omits `status.ts` and the home of `launchToken`

**Design:** §4.7 (token printed by "Message M, the Herdr kill refusal and `ao status`"), §6 (14+1 files).
**Source:** `packages/cli/src/commands/status.ts:228-232` prints `launch failed: ...` from stored
`launchFailed` only; nothing prints a token today. `LAUNCH_IDENTITY_KEYS` lives in
`packages/core/src/metadata.ts:331-337` (verified), but no file in §6 is named as the home of the new
`launchToken()` function itself.

Either `status.ts` needs a change (read token helper, append to the failure line) or the token
reaches `ao status` through text core writes into `launchFailed` — but `launchFailed` is capped at
600 characters (`session-manager.ts:1980`, verified) and §4.7 says a `launchFailed` write does not
change the token, which only works if the token is not embedded in it. Both readings cannot hold at
once. Likewise `launchToken()` must be added to `metadata.ts` (new export, index re-export) or to
`session-manager.ts` (already listed) — the design never says which.

**Required:** name the home file of `launchToken()` (and its export path), and either add
`packages/cli/src/commands/status.ts` to the product file list (15 product files, 16 conditional)
or state precisely how the token is shown without touching it. Adjust the §1/§7 size and commit-1
content lines accordingly.

### m-2 — Q1's "the handle's pinned `herdrSocket`" does not exist yet at step 2

**Design:** §4.3 Q1 ("`socket` is the handle's pinned `herdrSocket`"), §5.2.1 step 2 (`workspace
create` → Q1/Q2 with `cli:workspace:create`).
**Source:** at step 2 no handle exists yet — the pin is what `create` is establishing. The socket
available is the freshly resolved endpoint socket from step 1 (which becomes `herdrSocket`).

**Required:** qualify Q1's socket as "the resolved endpoint socket of step 1 (the value stored as
`herdrSocket`)" for step 2, keeping "the handle's pinned `herdrSocket`" for step 5. No behavior
change; the implementer otherwise has to guess which value to compare at step 2, and the wrong
guess (e.g. a legacy ambient socket) would misqualify Q1.

### m-3 — §4.4 overstates the empty-ID safety claim (`recordMayOwnRuntime`)

**Design:** §4.4: "`recordMayOwnRuntime` never matches an empty ID."
**Source:** `packages/core/src/session-manager.ts:1652-1660` (`recordNamesRuntime`: `stored.id ===
handle.id && stored.runtimeName === handle.runtimeName`) and `:1673-1680` (`recordMayOwnRuntime`:
true when the record has no `runtimeHandle` at all). Two pending Herdr records both carry P
(`id: ""`, `runtimeName: "herdr"`), so P-vs-P **matches**; a handleless record matches anything.

The consequence is fail-safe — at `:1873` a match on a replaced record sets `keptBecause` and the
rollback keeps everything with a warning — so this is a justification bug, not a safety bug. But
the same paragraph is the safety argument for kill/cleanup/restore refusing P records, and a
future reader (or RH-B) relying on "never matches" will misreason about the replaced-record path.

**Required:** correct §4.4 to what holds: an empty-ID Herdr handle matches only another empty-ID
record of the same runtime (or a handleless record), and every such match resolves to keep-plus-warn
(`:1870-1886`), never to removal. Add a T-4.x assertion for the replaced-by-P case if not already
covered by T-4.7.

### m-4 — Name the merge conflict with the unlanded `ao session relaunch` branch

**Design:** §4.4 (`claimNeeded = !!plugins.agent.prepareAgentSession || isLaunchEndUnproven(...)`,
success-path `CLEARED_LAUNCH_CLAIM`, restore step 9 `...launchClaim`).
**Source:** on this tip both claim call sites read `plugins.agent.prepareAgentSession ? await
readLaunchClaim() : null` (`session-manager.ts:2055`, `:2458`, verified). The unlanded branch
`feat/session-relaunch` keeps those two lines but adds its own claim protocol around them: its own
launch-token keys (`LAUNCH_TOKEN_AT_KEY`, `LAUNCH_PANE_KEY`), `ownKeys` = PID+start, claim clearing
on confirm (`:2660`, `:3223` on that branch) and claim-checked restore settlement (`:5320-5340` on
that branch). Its review (`session_relaunch_review_r3_sol61.md`) leaves M-6 (restore/kill already
in flight) open by design — the same restore/kill paths fit-2's G, P-claim and F-9 touch.

The task brief asks for this check explicitly ("its M-6 design needs claims in restore and kill").
There is no semantic contradiction today (both use PID+start ownership), but whichever lands second
must reconcile: fit-2 writes claims for Herdr launches that relaunch's `prepareAgentSession`-gated
code assumes claimless, and relaunch's restore-settle `CLEARED_LAUNCH_CLAIM` write can clear a
claim fit-2's G relies on to see an in-flight restore.

**Required:** add one paragraph to §4.4 (or §11 deviations) naming the overlap — the two call
sites, the success-path clear, restore step 9 — and the rule that the second landing round keeps
both protocols' tests green (relaunch's M-6 probes + fit-2's T-7.20/26). No design change.

### m-5 — `r8_`-named evidence cited as files are sections of one log

**Design:** §3.1, §4.3, §5.2.1 cite `r8_ws_create_stale_socket_file`,
`r8_pane_run_stale_socket_file`, `r8_ws_create_ping_protocol_19`, `r8_ws_create_ping_protocol_23`,
`r8_pane_run_ping_protocol_19`, `r8_ws_create_server_sends_cli_no_server_text`,
`r8_pane_run_pane_not_found_after_request`.
**Fact:** `development/artifacts/herdr_095_live_check/` contains exactly five `r8_*` files
(`r8_cli_forms_log.txt`, `r8_forms_script.txt`, `r8_strace_connects.txt`,
`r8_status_json_ping_protocol_19.json`, `r8_status_json_ping_protocol_23.json`). All seven names
above are case sections inside `r8_cli_forms_log.txt` (lines 1–71, read in full), not files; globs
for them return nothing.

The evidence itself is intact (each section shows the stated connections/requests), so this is
documentation precision, but T-4.1b and the Q table point an implementer at filenames that do not
exist.

**Required:** cite them as sections (e.g. "`r8_cli_forms_log.txt`: `r8_ws_create_stale_socket_file`
section") or add the per-case files. One-line fix in each citing row.

### m-6 — State the probe timeouts that bound lock A's hold time

**Design:** §5.3.1: "A is held across G's one reuse probe", "never across an awaited create".
**Source:** G's probe is an awaited `isAlive` (execFile) call; no timeout is stated for it in §5.3,
while A refuses others after `admissionWaitMs` (default 30 s).

The failure direction is safe (a hung probe turns concurrent starters into `admission-busy`, never
into a second orchestrator), so this is not an admission gap. But the hold time of A is currently
"however long a Herdr probe can hang", and the 30 s waiter can expire while the holder still probes,
producing busy-retry loops under a wedged server.

**Required:** state the timeout of G's reuse probe (and of the post-A informational `answer`
probes), or bound A's hold with the same `admissionWaitMs` discipline. One sentence in §5.3.1.

## Dependency note (not a finding against r8)

**D-F1 — fit-1 base is unlanded and unverifiable on this tip.** The interim guard (§2.1 row 10:
"for a record whose runtime is Herdr, neither the no-server code nor `isAlive` false answers
'gone'") is absent from `isOrchestratorRuntimeAlive` (`session-manager.ts:562-584`, generic) and
from `checkOrchestratorLiveness` (`start.ts:895-928`, generic) — both verified first-hand. F-1/F-2
reads, pins and `HerdrPinError` are likewise not in the tree. Every §2.1 row, every §2.3 removal
claim, and the §7 commit-3 oracle note ("the interim guard refuses it as unknown instead of
'already exists…'") therefore depend on the fit-1 tip and its separate code review. Concretely,
§4.4's "every consumer already treats P safely after fit-1" (empty-ID reject in `isAlive`, `[]`
in row 8, `unknown` stop) is a fit-1 theorem this review could not check. If any §2.1 name differs
on the fit-1 tip, §7's G0 gate ("use fit-1's name; if a behavior differs, stop and report") is the
correct tripwire — keep it.

## Verification notes (by task section)

**Admission boundary (M-1).** A = `deliveryLockName("admission", realPath(sessionsDir))`, kind to
be added to the `"ledger" | "attempt" | "record"` union (`delivery-lock.ts:45`, verified absent =
change needed); kernel-released abstract socket, `EADDRINUSE` → busy, Linux-only
(`delivery-lock.ts:1-24`, `:33-34`, verified). Scope (every orchestrator start + orchestrator
restore; released in `finally`; never across create) is complete: worker spawns need no A (L-3, no
one-worker rule), and P+claim covers the post-release window. G1's damaged-record regex
`/"runtimeName"\s*:\s*"herdr"/` errs toward blocking; L-2 (pre-fit-2 handleless crashes) + L-5
(old binary during upgrade) leave the upgrade window open but named. T-7.21's two-process variant
shares one sessions dir → one lock name → serialized; correct. `recordLockName`
(`metadata.ts:234-241`, verified) already resolves non-existent paths via realpath-fallback, so
the naming precedent cited for A holds.

**Rule Q (M-2).** Each condition re-verified against `r8_cli_forms_log.txt` (71 lines, read in
full): Q1 stale-socket cases show 0 server connections with the exact pinned-socket + "; run
`herdr`…" text; Q2 protocol cases show exactly 1 (ping-only) connection with both "newer than"
and "older than" texts; the `zz_unknown_code`, server-sent-`server_not_running` (note: names
`elsewhere.sock`, no run-suffix) and `pane_not_found` cases show 2 connections with the
`workspace.create` / `pane.send_input` request present — so code-alone indeed proves nothing.
`r8_strace_connects.txt`: 13 `connect()` lines, 13 `AF_UNIX` (counted). Q0's `compatible !== true`
matches `r8_status_json_ping_protocol_{19,23}.json` (`running: true, compatible: false`, exit 0).
Removal of `launch-refused` + script-kept is exactly what review r7 M-2 required. R-Q is real but
narrow (a server must emit the CLI's exact strings through the F1 envelope); OQ-F7 (a) accepted.

**Dispatch (M-3).** Site list checked against sources: startup `:2465/:2509/:2570`, restore
`:4483`, kill `:3078-3105`, list `:1513-1516`, CLI `:906-907` — all verified present with the
stated today-behavior (project-runtime probe/stop, list fallback, kill skip-on-missing-plugin).
No other old-record probe/stop site found (lifecycle `:560` already handle-routed per §3.2; send
→ restore; cleanup → kill; attach is user-directed). `runtime-stop.ts:221` fallback row verified.
OQ-F4 (a) block: agreed (see OQ table).

**F-9 / F-3 / preflight / API.** F-9 steps 1–9 match every review-r7 safeguard; token construction
(SHA-256 over `LAUNCH_IDENTITY_KEYS`-ordered values, first 16 hex) is deterministic; keys verified
at `metadata.ts:331-337` (note: lines are 331–337, not 332–338 as cited — trivial). F-3 unchanged
from r7 except exact CLI text; `SETTLED_STATES` today includes `blocked` (`index.ts:62`,
verified) = change needed. `preflight.test.ts` (`checkHerdr`) oracle preservation is consistent
with doctor staying ambient. `index.ts` additions-only constraint stated (§5.5/§6 #3); public
`kill` options today end at `purgeOpenCode` (`types.ts:1723`, verified) = change needed. `CLAUDE.md`
plugin guidance changes specified; current Error Handling (`CLAUDE.md:227-232`) indeed lacks the
partial-error contract (verified).

**Implementability.** 14+1 file count verified arithmetically; m-1 adds up to two more names.
Every changed oracle found named (§5.2 table, §5.3.9, F-3 §5.1). Each acceptance test has a stated
pre-fit-2 red reason; T-7.3b/c and T-7.4b satisfy review r7 m-4. 8-commit order respects API-before-use
(commit 1: error types, `LAUNCH_END_UNPROVEN_RUNTIMES`, `preflight?`, Q, token, lock kind, exports).
Size L plausible for the mechanism (A+G ≈ 380 + F-4 ≈ 330 lines). No fit-2 item was found to depend
on RH: step-6 `pane get` is a check (RH B-2 stays open, stated §5.2.1); G takes no end-authority
(OQ-F1 (b)); confirmed-stop paths explicitly await "a later RH-B".

**Fit-1 base.** Table §2.1 is precise about names; G0 is the right tripwire. See D-F1: none of it
exists on this tip, so this review asserts fit-1-relative consistency only.

## Independent code-fact spot checks (first-hand reads on `0488d24d` tree)

| # | Claim checked | Evidence and result |
| --- | --- | --- |
| 1 | Claims only with `prepareAgentSession` today | `session-manager.ts:2055`, `:2458`: `plugins.agent.prepareAgentSession ? await readLaunchClaim() : null`. Supports §4.4's change premise. |
| 2 | `recordMayOwnRuntime` / `recordNamesRuntime` shape | `:1652-1660`, `:1673-1680`. Qualifies §4.4's "never matches empty ID" — see m-3. |
| 3 | Rollback stop gate + keep path | `:1867-1886`: runtime+handle → check → stop-or-keep-with-warning. Supports §5.2.3 step 1/3 composition. |
| 4 | Lock kinds; Linux-only | `delivery-lock.ts:45` union has no `"admission"`; `:33-34` `platform === "linux"`. Supports §5.3.1 change + OQ-F6. |
| 5 | `recordLockName` non-existent-path fallback | `metadata.ts:234-241` realpath-try/resolve-fallback. Supports §5.3.1 naming precedent. |
| 6 | `launchFailed` 600-char cap | `session-manager.ts:1980` `.slice(0, 600)`. Supports §5.2.6 readability claim. |
| 7 | Concurrent fixed-ID branch message | `session-manager.ts:2595` "already exists but is not in a reusable state". Supports §3.2/T-7.8b premise. |
| 8 | Runtime-herdr close sites + unknown stop | `index.ts:366`, `:400` close on failure paths; `:423` `outcome: "unknown"`. Supports §5.2/§3.2. |
| 9 | `SETTLED_STATES` includes `blocked` today | `index.ts:62`. Supports F-3 change premise. |
| 10 | `runtime-stop.ts` fallback row | `:221` `if (noServer && !destroyFailed) return { outcome: "destroyed" }`. Supports §5.3.6 guard. |
| 11 | CLI wraps spawn error with prefix today | `start.ts:1071-1075` "Failed to setup orchestrator: …". Supports T-7.4 exact-text change. |
| 12 | Core send retry + CLI send call site | `session-manager.ts:4005-4027`, `send.ts:355-359`. Supports F-3 interception points. |
| 13 | Kill options end at `purgeOpenCode` | `types.ts:1723`. Supports F-9 API addition. |
| 14 | `status.ts` failure line, no token | `status.ts:228-232`. Supports m-1. |

## Independent fixture spot checks (`development/artifacts/herdr_095_live_check/`)

| # | Claim checked | Fixture and result |
| --- | --- | --- |
| 1 | Q2 create ping-only, exact newer-text | `r8_cli_forms_log.txt:1-7`: exit 1, `cli:workspace:create`, "client protocol 22 is newer than server protocol 19", 1 connection (ping only), 1 `AF_UNIX` connect. |
| 2 | Q2 run ping-only | Same file, `r8_pane_run_ping_protocol_19` section: `cli:request`, 1 ping-only connection. |
| 3 | Q2 older-text variant | `r8_ws_create_ping_protocol_23` section: "older than server protocol 23", 1 connection. |
| 4 | Q1 zero-connection forms | Stale-socket sections (create + run): exact pinned-socket text with run-suffix, 0 connections, `ECONNREFUSED` in `r8_strace_connects.txt`. |
| 5 | Unknown code after request | `r8_ws_create_error_after_request`: `zz_unknown_code`, 2 connections, `workspace.create` present. Code-alone-proves-nothing confirmed. |
| 6 | Server-sent no-server text after request | `r8_ws_create_server_sends_cli_no_server_text`: `server_not_running` naming `elsewhere.sock` (no suffix), 2 connections. Near-miss correctly unqualified. |
| 7 | `pane_not_found` after admission | `r8_pane_run_pane_not_found_after_request`: 2 connections, `pane.send_input` present. `launch-unconfirmed` correct. |
| 8 | Status `compatible: false`, exit 0 | `r8_status_json_ping_protocol_{19,23}.json` + log sections: `running: true`, `compatible: false`. Q0 evidence confirmed. |
| 9 | 13 `connect()` calls, all `AF_UNIX` | `r8_strace_connects.txt`: 13 `connect(` lines, 13 `AF_UNIX`. Sum over cases (1+1+1+1+1+2+2+2+1+1) = 13. Confirmed. |

No fixture was rerun. Per-case names are log sections, not files — see m-5.

## Open questions

| Question | Reviewer recommendation |
| --- | --- |
| **OQ-F4** live Herdr record, project now selects another runtime | **(a) Block.** Agree: reuse would silently keep the old runtime while the new one cannot stop it; the owner either retires (F-9) or switches back. T-7.8 "blocked" + zero-call assertions are the right oracles. |
| **OQ-F5** `ao send` to a kept failed launch | **(a) No special policy.** Agree: the post-run check already prevents sends to a changed terminal; T-4.14's three cases pin the exact behavior. A quarantine guard would be a new feature, not a safety requirement. |
| **OQ-F6** platform without the abstract-socket lock | **(a) Refuse.** Agree: fail-closed matches the record-lock/delivery-ledger precedent; (b) would re-open M-1 on macOS silently. |
| **OQ-F7** R-Q residual | **(a) Qualify Q0/Q1/Q2.** Agree: each has measured no-request evidence; the imitator-server scenario needs exact-string forgery through the F1 envelope and is named. (b) would manufacture kept launches on every real protocol skew. |
| **OQ-F8** F-9 token | **(a) Required.** Agree: it enforces review r7's inspection-to-command race requirement for all AO-recorded changes; the residual (changes AO never records) is honestly stated. |

No owner decision was inferred from the author's report or recommendations.

## What is correct

- The M-1 composition (lock + born-with-P-and-claim + damaged/handleless selection + revalidation +
  named limits) closes the in-flight gap with tests at every level it claims (paused create, two
  simultaneous starts incl. two processes, mode change, revalidation, busy lock, no-lock platform).
- Rule Q is the right shape: three measured pre-request conditions, everything else kept; the
  near-miss table (T-4.1b) and the records-then-errors test (T-4.3b) are exactly what review r7 asked
  for; `launch-refused` removal + script retention matches the review's demand.
- `runtimeForHandle` with no-fallback-for-the-set at every old-record site, and the mismatch block,
  resolve M-3 without changing tmux/mock behavior (explicit control T-7.8d).
- F-9 follows the review's safeguard list point by point, including the token race guard, the
  `stopWhenReplaced` discipline, and the damaged-record by-hand path; no other command acquires the
  override.
- The design is honest about residuals (R-Q, hidden-server attestation risk, L-1–L-5, W-4, RH
  dependence of confirmed cleanup) and keeps retire authority off until RH.
- Commit 1 concentrates all API surface before use (m-1 fixed); gates (per-commit builds, final
  full run, `SAME_ID_DEFECTS=red` equality against the fit-1 G0 set, D2 non-vacuity) are the right
  ones; size L is plausible.

## Cleanup and verification

Final `ls -la --time-style=full-iso ~/.ao/bin` was byte-for-byte equal to the initial listing: the
same four files, sizes, permissions and 2026-10-16 modification times.

Cleanup scan, run exactly as requested:

```sh
find ~/.agent-orchestrator -maxdepth 3 -newer /tmp/aofr8m-marker -not -name 'lifecycle-manager-*.json' -not -path '*/processes*' -not -name 'lifecycle-worker.log'
```

It printed:

```text
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions
/home/taisung/.agent-orchestrator/6513108c38cb-Nexus/sessions/nex-2225
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/deliveries
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions
/home/taisung/.agent-orchestrator/60756641ca25-agent-orchestrator/sessions/ao-65
```

These paths changed during the review; no review command wrote them (no `ao`, build, test or agent
command was run). Their contents and other sessions' panes were not read. The unchanged-state claim
is confined to files this review controlled.

No Node/pnpm/herdr process was started by this review (no code was executed; all checks were
reads). A process scan shows only pre-existing processes (the real lifecycle worker, fleet-watch
scripts, other sessions' agents) — none is review-owned, and none was signaled. No `/tmp/aofr8m`
directory was made (only the marker file `/tmp/aofr8m-marker`, which the owner's cleanup owns with
the other markers).

Worktree writes: only this review file and the required `.agent_report.md`; `.agent_task.md` was
supplied externally and left unchanged. Final `git status --short` shows those two untracked paths
and no tracked modifications. `git diff --exit-code -- packages docs .github
agent-orchestrator.yaml` passes (no output). Builds and product tests were not run for this
review-only assignment.
